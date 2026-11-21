"""Independent Q4 band construction and through-thickness H8 extrusion."""
from __future__ import division

import math
from collections import Counter

from .planner import hybrid_split, _isfinite, plan_quad_counts
from .templates import TemplateError, build_transition_patch, tile_strip_quads
from .cylindrical_axial import _jacobian, SIGNS, GAUSS, axial_stage_plan, _positive_integer


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
                      order='3-then-2', reverse_axis=False, stages=1,
                      stage_widths=None, ratio_sequence=None):
    """Lay blocks in order from x=0, or from x=length if reverse_axis."""
    if not all(_isfinite(v) and v > 0 for v in (length, depth)):
        raise TemplateError('Planar band dimensions must be finite and positive')
    if int(fine_segments) != fine_segments or fine_segments < 1:
        raise TemplateError('Fine segments must be a positive integer')
    stages = _positive_integer(stages)
    if coarse_segments is None:
        counts, bounds = axial_stage_plan(fine_segments, ratio, stages, 0., depth,
                                          stage_widths, ratio_sequence)
        quads = _stacked_strips(length, counts, bounds)
    else:
        if stages != 1 or stage_widths is not None or ratio_sequence is not None:
            raise TemplateError('Within-band hybrid is single-stage only')
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
        counts, bounds = [fine_segments, coarse_segments], [0., depth]
    tol = max(length, depth) * 1e-11
    def boundary(a, b):
        return any(abs(a[i]-v) < tol and abs(b[i]-v) < tol
                   for i, v in ((0, 0), (0, length), (1, 0), (1, depth)))
    nodes, elements = _mesh(quads, boundary)
    if reverse_axis:
        nodes = [(length - x, y) for x, y in nodes]
        elements = [c[::-1] for c in elements]
    return dict(nodes=[p + (0.,) for p in nodes], elements=elements,
                stage_counts=counts, stage_levels=bounds)


def _stacked_strips(length, counts, bounds):
    for n, m, a, b in zip(counts, counts[1:], bounds, bounds[1:]):
        for q in tile_strip_quads(n//m, n, length, 1.):
            yield tuple((u, b if v == 1 else a + (b-a)*v) for u, v in q)


def build_annular_band(fine_radius, coarse_radius, fine_segments, ratio=3,
                       stages=1, stage_widths=None, ratio_sequence=None):
    if not all(_isfinite(r) and r > 0 for r in (fine_radius, coarse_radius)) or fine_radius == coarse_radius:
        raise TemplateError('Provide two distinct positive radii')
    counts, bounds = axial_stage_plan(_positive_integer(fine_segments), ratio,
                                     _positive_integer(stages), 0.,
                                     abs(coarse_radius-fine_radius), stage_widths,
                                     ratio_sequence)
    if counts[-1] < 3:
        raise TemplateError('Annular count is incompatible with the closed ring')
    quads = _stacked_strips(1., counts, bounds)
    outer_levels = (0., round(bounds[-1],13))
    params, elements = _mesh(quads, lambda a, b: a[1] == b[1] and a[1] in outer_levels,
                             periodic=1.)
    nodes = []
    direction = 1 if coarse_radius > fine_radius else -1
    for u, v in params:
        r = fine_radius + direction * v
        angle = 2 * math.pi * u
        nodes.append((r * math.cos(angle), r * math.sin(angle), 0.))
    if coarse_radius > fine_radius:
        elements = [c[::-1] for c in elements]
    # The periodic parameter seam is checked above; validate mapped corners too.
    for c in elements:
        for i in range(4):
            a, b, d = [nodes[c[(i + j) % 4]-1] for j in (-1, 0, 1)]
            if (b[0]-a[0])*(d[1]-b[1]) - (b[1]-a[1])*(d[0]-b[0]) <= 0:
                raise TemplateError('Non-positive annular Q4 corner Jacobian')
    return dict(nodes=nodes, elements=elements, stage_counts=counts,
                stage_levels=[fine_radius+direction*v for v in bounds])


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
    result = dict(mesh, nodes=nodes, elements=cells)
    result['sweep_layers'] = layers
    return result


def build_radial_band(radii, fine_segments, ratio, thickness, axial_layers):
    """Sweep explicit monotonic radius stages through a constant axial span."""
    if len(radii) < 2 or not all(_isfinite(r) and r > 0 for r in radii):
        raise TemplateError('Radial band requires at least two finite positive radii')
    direction = 1 if radii[-1] > radii[0] else -1
    widths = [(b-a)*direction for a,b in zip(radii,radii[1:])]
    return extrude_band(build_annular_band(radii[0], radii[-1], fine_segments,
                                          ratio, stages=len(widths), stage_widths=widths),
                        thickness, axial_layers)


def build_rectangular_ring(hx, hy, nx, ny, stages=1, ratio=2):
    """Conforming rectangular ring cascade, including 2:1 parity collars."""
    if not all(_isfinite(v) and v > 0 for v in (hx, hy)):
        raise TemplateError('Invalid inner rectangle')
    nx, ny = _positive_integer(nx), _positive_integer(ny)
    stages = _positive_integer(stages)
    if ratio not in (2,3):
        raise TemplateError('Rectangle ratio must be 2 or 3')
    try:
        px, py = (plan_quad_counts(n,stages,ratio) for n in (nx,ny))
    except ValueError as exc:
        raise TemplateError(str(exc))
    sx, sy = 2*hx/nx, 2*hy/ny
    # A 3-Q4 unit square has two ports on two adjacent sides, and one on
    # the others. Alternating its reflection joins each pair along equal ports.
    q = (((0,0), (.5,0), (.5,.5), (0,.5)),
         ((.5,0), (1,0), (1,1), (.5,.5)),
         ((0,.5), (.5,.5), (1,1), (0,1)))
    all_quads = []
    def add(p):
        area = sum(p[i][0]*p[(i+1)%4][1]-p[(i+1)%4][0]*p[i][1] for i in range(4))
        all_quads.append(p if area > 0 else p[::-1])

    def regular(xs, ys):
        for a,b in zip(xs,xs[1:]):
            for c,d in zip(ys,ys[1:]):
                add([(a,c),(b,c),(b,d),(a,d)])

    origin = (hx,hy)
    frames = [origin]
    collars = []
    for i in range(stages):
        nx,ny = px['counts'][i],py['counts'][i]
        if ratio == 2:
            cx,cy = px['collars'][i],py['collars'][i]
            if cx:
                ys = [-hy+j*sy for j in range(ny+1)]
                regular([-hx-sx,-hx],ys)
                regular([hx,hx+sx],ys)
                hx,nx = hx+sx,nx+2
            if cy:
                xs = [-hx+j*sx for j in range(nx+1)]
                regular(xs,[-hy-sy,-hy])
                regular(xs,[hy,hy+sy])
                hy,ny = hy+sy,ny+2
            if cx or cy:
                collars.append(dict(stage=i+1, size=(hx,hy), counts=(nx,ny)))
            H,V = hx+2*sx,hy+2*sy
            for sign in (-1,1):
                for k in range(nx//2):
                    for c in q:
                        add([(-hx+2*sx*(k+(1-u if k%2 else u)),sign*(hy+2*sy*v)) for u,v in c])
                for k in range(ny//2):
                    for c in q:
                        add([(sign*(hx+2*sx*v),-hy+2*sy*(k+(1-u if k%2 else u))) for u,v in c])
                for t in (-1,1):
                    for c in q:
                        add([(sign*(hx+2*sx*u),t*(hy+2*sy*v)) for u,v in c])
        else:
            H,V = hx+3*sx,hy+3*sy
            x,y = origin
            strips = (tile_strip_quads(3,nx-(2 if i else 0),2*x,V-hy),
                      tile_strip_quads(3,ny-(2 if i else 0),2*y,H-hx))
            # The two inherited corner ports must survive the next merge.
            # A diagonal divides the resulting L-shaped corner into two Q4.
            corners = [[(hx,hy),(H,hy),(H,V),(hx,V)]] if i == 0 else [
                [(x,hy),(hx,hy),(H,V),(x,V)],
                [(hx,y),(H,y),(H,V),(hx,hy)]]
            for sign in (-1,1):
                for c in strips[0]:
                    add([(u-x,sign*(hy+v)) for u,v in c])
                for c in strips[1]:
                    add([(sign*(hx+v),u-y) for u,v in c])
                for t in (-1,1):
                    for c in corners:
                        add([(sign*u,t*v) for u,v in c])
        hx,hy,sx,sy = H,V,ratio*sx,ratio*sy
        frames.append((hx,hy))
    tol = max(hx,hy)*1e-11
    def boundary(a,b):
        for axis, h, outer, span in ((0,origin[0],hx,origin[1]),
                                    (1,origin[1],hy,origin[0])):
            for sign in (-1, 1):
                if all(abs(p[axis]-sign*outer) < tol for p in (a,b)):
                    return True
                if all(abs(p[axis]-sign*h) < tol and abs(p[1-axis]) <= span+tol for p in (a,b)):
                    return True
        return False
    nodes, elements = _mesh(all_quads, boundary)
    return dict(nodes=[p + (0.,) for p in nodes], elements=elements,
                stage_frames=frames, stage_counts=list(zip(px['counts'],py['counts'])),
                collars=collars)


def rectangular_ring_partition_segments(mesh):
    """CAD sketch segments for a ring returned by build_rectangular_ring.

    Draw these inside a face whose inner and outer loops already exist.
    All stages, corner diagonals and collar splits are included. Boundary
    edges are omitted so the sketch does not retrace existing CAD edges.
    """
    owners = Counter(tuple(sorted((q[i - 1], q[i])))
                     for q in mesh['elements'] for i in range(4))
    nodes = mesh['nodes']
    return [(nodes[a - 1][:2], nodes[b - 1][:2])
            for (a, b), count in sorted(owners.items()) if count == 2]
