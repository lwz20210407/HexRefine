"""Independent Q4 band construction and through-thickness H8 extrusion."""
from __future__ import division

import math
from collections import Counter

from .planner import hybrid_split, _isfinite
from .templates import TemplateError, build_transition_patch, tile_strip_quads
from .cylindrical_axial import _jacobian, SIGNS, GAUSS


def _mesh(quad_points, boundary, periodic=None):
    nodes, quads, lookup = [], [], {}
    for quad in quad_points:
        conn = []
        for u, v in quad:
            key = (round(u, 13), round(v, 13))
            if periodic and key[0] == periodic:
                key = (0., key[1])
            if key not in lookup:
                lookup[key] = len(nodes) + 1
                nodes.append(key)
            conn.append(lookup[key])
        quads.append(conn)
    _audit_quads(nodes, quads, boundary, check_orientation=not periodic)
    return nodes, quads


def _audit_quads(nodes, quads, boundary, check_orientation=True):
    edges = Counter()
    for q in quads:
        if len(set(q)) != 4:
            raise TemplateError('Repeated node in a Q4')
        for i in range(4):
            a, b, c = [nodes[q[(i + j) % 4] - 1] for j in (-1, 0, 1)]
            area = (b[0]-a[0])*(c[1]-b[1]) - (b[1]-a[1])*(c[0]-b[0])
            if check_orientation and area <= 0:
                raise TemplateError('Non-positive Q4 corner Jacobian')
            edges[tuple(sorted((q[i], q[(i+1) % 4])))] += 1
    if any(n > 2 or (n == 1 and not boundary(nodes[a-1], nodes[b-1]))
           for (a, b), n in edges.items()):
        raise TemplateError('Nonconforming Q4 edges')


def build_planar_band(length, depth, fine_segments, ratio=2, coarse_segments=None,
                      order='3-then-2', reverse_axis=False):
    """Lay blocks in order from x=0, or from x=length if reverse_axis."""
    if not all(_isfinite(v) and v > 0 for v in (length, depth)):
        raise TemplateError('Planar band dimensions must be finite and positive')
    if int(fine_segments) != fine_segments or fine_segments < 1:
        raise TemplateError('Fine segments must be a positive integer')
    if coarse_segments is None:
        quads = tile_strip_quads(ratio, fine_segments, length, depth)
    else:
        if order not in ('3-then-2', '2-then-3'):
            raise TemplateError('Unknown hybrid order')
        split = hybrid_split(fine_segments, coarse_segments, order=order)
        if not split['ok']:
            raise TemplateError(split['error'])
        quads = []
        index, h = 0, length / fine_segments
        for block in split['blocks']:
            patch = build_transition_patch(3 if block == '3' else 2, h, depth)
            for conn in patch['quads']:
                quads.append(tuple((index*h + patch['vertices'][n][0],
                                    patch['vertices'][n][1]) for n in conn))
            index += patch['fine_segments']
    tol = max(length, depth) * 1e-11
    def boundary(a, b):
        return any(abs(a[i]-v) < tol and abs(b[i]-v) < tol
                   for i, v in ((0, 0), (0, length), (1, 0), (1, depth)))
    nodes, elements = _mesh(quads, boundary)
    if reverse_axis:
        nodes = [(length - x, y) for x, y in nodes]
        elements = [c[::-1] for c in elements]
    return dict(nodes=[p + (0.,) for p in nodes], elements=elements)


def build_annular_band(fine_radius, coarse_radius, fine_segments, ratio=3):
    if not all(_isfinite(r) and r > 0 for r in (fine_radius, coarse_radius)) or fine_radius == coarse_radius:
        raise TemplateError('Provide two distinct positive radii')
    if ratio not in (2, 3) or fine_segments % (4 if ratio == 2 else 3) or fine_segments // ratio < 3:
        raise TemplateError('Annular count is incompatible with the closed ring')
    n = int(fine_segments)
    quads = tile_strip_quads(ratio, n, n, 1.)
    params, elements = _mesh(quads, lambda a, b: a[1] == b[1] and a[1] in (0., 1.),
                             periodic=n)
    nodes = []
    for u, v in params:
        r = fine_radius + (coarse_radius - fine_radius) * v
        angle = 2 * math.pi * u / n
        nodes.append((r * math.cos(angle), r * math.sin(angle), 0.))
    if coarse_radius > fine_radius:
        elements = [c[::-1] for c in elements]
    # The periodic parameter seam is checked above; validate mapped corners too.
    for c in elements:
        for i in range(4):
            a, b, d = [nodes[c[(i + j) % 4]-1] for j in (-1, 0, 1)]
            if (b[0]-a[0])*(d[1]-b[1]) - (b[1]-a[1])*(d[0]-b[0]) <= 0:
                raise TemplateError('Non-positive annular Q4 corner Jacobian')
    return dict(nodes=nodes, elements=elements)


def extrude_band(mesh, thickness, layers):
    if not _isfinite(thickness) or thickness <= 0 or int(layers) != layers or layers < 1:
        raise TemplateError('Extrusion requires positive thickness and integer layers')
    layers = int(layers)
    count = len(mesh['nodes'])
    nodes = [(x, y, z + thickness * i / layers)
             for i in range(layers + 1) for x, y, z in mesh['nodes']]
    cells = [[a + k * count for k in (i, i + 1) for a in q]
             for i in range(layers) for q in mesh['elements']]
    if any(_jacobian([nodes[i-1] for i in h], q)[0] <= 0
           for h in cells for q in SIGNS + GAUSS):
        raise TemplateError('Non-positive swept H8 Jacobian')
    return dict(nodes=nodes, elements=cells)


def build_rectangular_ring(hx, hy, nx, ny):
    """One-stage four-side 2:1 ring; each corner contributes one outer port."""
    if not all(_isfinite(v) and v > 0 for v in (hx, hy, nx, ny)) or nx % 4 or ny % 4:
        raise TemplateError('Invalid rectangle or fine counts (multiples of four required)')
    nx, ny = int(nx), int(ny)
    sx, sy = 2*hx/nx, 2*hy/ny
    # A 3-Q4 unit square has two ports on two adjacent sides, and one on
    # the others. Alternating its reflection joins each pair along equal ports.
    q = (((0,0), (.5,0), (.5,.5), (0,.5)),
         ((.5,0), (1,0), (1,1), (.5,.5)),
         ((0,.5), (.5,.5), (1,1), (0,1)))
    all_quads = []
    def add(mapping, flip=False):
        for c in q:
            p = [mapping(1-u if flip else u, v) for u, v in c]
            area = sum(p[i][0]*p[(i+1)%4][1]-p[(i+1)%4][0]*p[i][1] for i in range(4))
            all_quads.append(p if area > 0 else p[::-1])
    for sign in (-1, 1):
        for k in range(nx//2):
            add(lambda u,v: (-hx+2*sx*(k+u), sign*(hy+2*sy*v)), k % 2)
        for k in range(ny//2):
            add(lambda u,v: (sign*(hx+2*sx*v), -hy+2*sy*(k+u)), k % 2)
        for t in (-1, 1):
            add(lambda u,v: (sign*(hx+2*sx*u), t*(hy+2*sy*v)))
    tol = max(hx,hy)*1e-11
    def boundary(a,b):
        for axis, h, dh, span in ((0,hx,2*sx,hy), (1,hy,2*sy,hx)):
            for sign in (-1, 1):
                if all(abs(p[axis]-sign*(h+dh)) < tol for p in (a,b)):
                    return True
                if all(abs(p[axis]-sign*h) < tol and abs(p[1-axis]) <= span+tol for p in (a,b)):
                    return True
        return False
    nodes, elements = _mesh(all_quads, boundary)
    return dict(nodes=[p + (0.,) for p in nodes], elements=elements)
