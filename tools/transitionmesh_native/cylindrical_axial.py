"""Pure structured axial cylindrical transition generator.

This is an offline HexRefine-side implementation of the AXIAL_SURFACE idea:
fine circumferential loop -> one or more periodic transition bands -> coarse
loop, then radial extrusion into H8 cells. It does not call Abaqus.
"""
from __future__ import division

import math
from collections import Counter
from itertools import product

from .templates import tile_strip_quads, TemplateError
from .planner import ModePlanError, _isfinite, plan_counts, stage_boundaries


H8_FACES = ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
            (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7))
SIGNS = ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
         (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))
G = 1.0 / math.sqrt(3.0)
GAUSS = tuple(product((-G, G), repeat=3))


def _axial_pair():
    # One Q4 strip over a four-segment sector. Unlike a planar sketch,
    # both radial seam walls carry two axial edges in the swept solution.
    xy = ((0, 0), (1, 0), (2, 0), (3, 0), (4, 0),
          (0, .5), (4, .5), (0, 1), (2, 1), (4, 1),
          (1, .28), (2, .313), (3, .28), (2, .606))
    quads = ((0, 1, 10, 5), (1, 2, 11, 10), (2, 3, 12, 11),
             (3, 4, 6, 12), (5, 10, 11, 13), (11, 12, 6, 13),
             (5, 13, 8, 7), (13, 6, 9, 8))
    return [tuple(xy[i] for i in q) for q in quads]


def _corner_determinant(points):
    # Node order: lower Q4 followed by the matching upper Q4.
    q = points
    a = tuple(q[1][i] - q[0][i] for i in range(3))
    b = tuple(q[3][i] - q[0][i] for i in range(3))
    c = tuple(q[4][i] - q[0][i] for i in range(3))
    cross = (b[1]*c[2] - b[2]*c[1],
             b[2]*c[0] - b[0]*c[2],
             b[0]*c[1] - b[1]*c[0])
    return sum(a[i] * cross[i] for i in range(3))


def _jacobian(points, location):
    columns = [[0.0, 0.0, 0.0] for _ in range(3)]
    for point, sign in zip(points, SIGNS):
        for axis in range(3):
            weight = sign[axis] / 8.0
            for other in range(3):
                if other != axis:
                    weight *= 1 + sign[other] * location[other]
            for component in range(3):
                columns[axis][component] += weight * (point[component] - points[0][component])
    a, b, c = columns
    cross = (b[1]*c[2] - b[2]*c[1],
             b[2]*c[0] - b[0]*c[2],
             b[0]*c[1] - b[1]*c[0])
    det = sum(a[i] * cross[i] for i in range(3))
    lengths = [sum(x*x for x in vector) for vector in columns]
    norm = math.sqrt(lengths[0] * lengths[1] * lengths[2])
    return det, det / norm if norm else 0.0


def _positive_integer(value):
    if not _isfinite(value) or int(value) != value or value < 1:
        raise TemplateError('Mesh counts must be positive integers')
    return int(value)


def build_axial_cylinder(fine_segments=48, ratio=2, fine_z=3.0,
                         transition_z=7.0, total_z=10.0,
                         inner_radius=2.0, outer_radius=5.0,
                         regular_layers=6, radial_layers=2,
                         coarse_layers=None, stages=1, stage_widths=None):
    """Create a full hollow cylinder with regular ends and a ratio cascade."""
    fine_segments = _positive_integer(fine_segments)
    ratio = _positive_integer(ratio)
    if not all(_isfinite(v) for v in (fine_z, transition_z, total_z,
                                         inner_radius, outer_radius)):
        raise TemplateError('Cylinder dimensions must be finite')
    if not 0 < fine_z < transition_z < total_z:
        raise TemplateError('Invalid axial dimensions')
    stages = _positive_integer(stages)
    counts, zlevels = axial_stage_plan(fine_segments, ratio, stages, fine_z,
                                       transition_z, stage_widths)
    coarse_segments = counts[-1]
    if coarse_segments < 3:
        raise TemplateError('A closed coarse ring needs at least three segments')
    if inner_radius <= 0 or outer_radius <= inner_radius:
        raise TemplateError('Invalid cylinder radii')
    regular_layers = _positive_integer(regular_layers)
    coarse_layers = regular_layers if coarse_layers is None else _positive_integer(coarse_layers)
    radial_layers = _positive_integer(radial_layers)

    nodes = []
    node_map = {}

    def node(radial, u, z):
        radius = radii[radial]
        u = round(u, 13) % 1.0
        theta = 2 * math.pi * u
        point = (radius * math.cos(theta), radius * math.sin(theta), z)
        key = (radial, u, z)
        if key not in node_map:
            node_map[key] = len(nodes) + 1
            nodes.append(point)
        return node_map[key]

    radii = [inner_radius + (outer_radius - inner_radius) * i / radial_layers
             for i in range(radial_layers + 1)]
    elements = []
    regions = []

    def add_surface_quad(q, region):
        # q is a list of normalized (circumferential fraction, z).
        for radial in range(radial_layers):
            lower = [node(radial, u, z) for u, z in q]
            upper = [node(radial + 1, u, z) for u, z in q]
            conn = lower + upper
            if _corner_determinant([nodes[n - 1] for n in conn]) < 0:
                conn = [conn[0], conn[3], conn[2], conn[1],
                        conn[4], conn[7], conn[6], conn[5]]
            elements.append(conn)
            regions.append(region)

    def regular_band(z0, z1, count, label, layers):
        levels = [z0 + (z1 - z0) * i / layers for i in range(layers)] + [z1]
        for za, zb in zip(levels, levels[1:]):
            for it in range(count):
                u0 = it / float(count)
                u1 = (it + 1) / float(count)
                add_surface_quad([(u0, za), (u1, za), (u1, zb), (u0, zb)], label)

    regular_band(0.0, fine_z, fine_segments, 'fine', regular_layers)
    stage_names = ['transition'] if stages == 1 else [
        'transition_%d' % (i + 1) for i in range(stages)]
    for n, z0, z1, label in zip(counts, zlevels, zlevels[1:], stage_names):
        if ratio == 2 and stages == 1:
            motif = _axial_pair()
            transition = [tuple((u + offset, v) for u, v in q)
                          for offset in range(0, n, 4) for q in motif]
        else:
            # V1.1 cascades seed one axial seam interval, unlike the
            # standalone 2:1 sweep with its extra seam midpoint.
            transition = tile_strip_quads(ratio, n, float(n), 1.0)
        for quad in transition:
            add_surface_quad([(u / float(n),
                               z1 if v == 1.0 else z0 + v * (z1 - z0))
                              for u, v in quad], label)
    regular_band(transition_z, total_z, coarse_segments, 'coarse', coarse_layers)

    if not elements or any(_corner_determinant([nodes[n - 1] for n in e]) <= 0 for e in elements):
        raise TemplateError('Generated axial cylinder contains a non-positive H8')
    return {
        'nodes': nodes, 'elements': elements, 'regions': regions,
        'fine_segments': fine_segments, 'coarse_segments': coarse_segments,
        'fine_z': fine_z, 'transition_z': transition_z, 'total_z': total_z,
        'inner_radius': inner_radius, 'outer_radius': outer_radius,
        'radial_layers': radial_layers, 'regular_layers': regular_layers,
        'coarse_layers': coarse_layers,
        'stage_counts': counts, 'stage_z': zlevels, 'stage_names': stage_names,
    }


def axial_stage_plan(fine_segments, ratio, stages, start, finish, widths, ratio_sequence=None):
    try:
        counts = plan_counts(fine_segments, stages, ratio, ratio_sequence)['counts']
        offsets = stage_boundaries(finish - start, counts, widths)
    except ModePlanError as exc:
        raise TemplateError(str(exc))
    return counts, [start + val for val in offsets[:-1]] + [finish]


def audit_axial_cylinder(mesh):
    nodes = mesh['nodes']
    node_count = len(nodes)
    if len(set(nodes)) != node_count or any(not all(_isfinite(x) for x in p) for p in nodes):
        raise TemplateError('Axial mesh contains coincident or invalid nodes')
    if not mesh['elements']:
        raise TemplateError('Axial mesh contains no H8 elements')
    if any(len(conn) != 8 or len(set(conn)) != 8 for conn in mesh['elements']):
        raise TemplateError('Axial mesh contains a non-H8 connectivity')
    if any(node < 1 or node > node_count
           for conn in mesh['elements'] for node in conn):
        raise TemplateError('Axial mesh contains an out-of-range node id')
    if len(set(tuple(sorted(conn)) for conn in mesh['elements'])) != len(mesh['elements']):
        raise TemplateError('Axial mesh contains duplicate element connectivity')
    regions = mesh['regions']
    if len(regions) != len(mesh['elements']):
        raise TemplateError('Region labels do not match the elements')
    face_counts = Counter()
    face_owners = {}
    min_center, min_corner, min_gauss = float('inf'), float('inf'), float('inf')
    min_sj = {}
    stage_quality = {}
    volume = 0.0
    for conn, region in zip(mesh['elements'], regions):
        points = [nodes[i - 1] for i in conn]
        center = _jacobian(points, (0, 0, 0))[0]
        corners = [_jacobian(points, q) for q in SIGNS]
        gauss = [_jacobian(points, q)[0] for q in GAUSS]
        min_center = min(min_center, center)
        min_corner = min(min_corner, min(j for j, sj in corners))
        min_gauss = min(min_gauss, min(gauss))
        min_sj[region] = min(min_sj.get(region, 1.0), min(sj for j, sj in corners))
        quality = stage_quality.setdefault(region, dict(center=float('inf'),
                                                        corner=float('inf'),
                                                        gauss=float('inf')))
        quality['center'] = min(quality['center'], center)
        quality['corner'] = min(quality['corner'], min(j for j, sj in corners))
        quality['gauss'] = min(quality['gauss'], min(gauss))
        volume += sum(gauss)
        for face in H8_FACES:
            key = tuple(sorted(conn[i] for i in face))
            face_counts[key] += 1
            face_owners.setdefault(key, []).append(region)
    if min(min_center, min_corner, min_gauss) <= 0.0:
        raise TemplateError('Non-positive H8 Jacobian at a corner, center or Gauss point')
    if max(face_counts.values()) > 2:
        raise TemplateError('Axial mesh contains a non-manifold face')
    zi = mesh.get('stage_z', [mesh['fine_z'], mesh['transition_z']])
    counts_expected = mesh.get('stage_counts', [mesh['fine_segments'], mesh['coarse_segments']])
    order = ['fine'] + mesh.get('stage_names', ['transition']) + ['coarse']
    pairs = {frozenset(pair): z for pair, z in zip(zip(order, order[1:]), zi)}
    radii = mesh['inner_radius'], mesh['outer_radius']
    radial = mesh['radial_layers']
    rvals = [math.hypot(p[0], p[1]) for p in nodes]
    tol = max(mesh['total_z'], radii[1]) * 1e-10
    interfaces = Counter()
    for face, owners in face_owners.items():
        if len(owners) == 1:
            if not (any(all(abs(rvals[i-1] - r) <= tol for i in face) for r in radii)
                    or any(all(abs(nodes[i-1][2] - z) <= tol for i in face)
                           for z in (0, mesh['total_z']))):
                raise TemplateError('Unmatched internal face (through-wall, interface or seam)')
        elif owners[0] != owners[1]:
            level = pairs.get(frozenset(owners))
            if level is None or not all(abs(nodes[i-1][2] - level) <= tol for i in face):
                raise TemplateError('Shared transition face is outside its axial interface')
            interfaces[level] += 1
    if [interfaces[z] for z in zi] != [n * radial for n in counts_expected]:
        raise TemplateError('Incorrect number of conforming interface faces')
    counts = {name: regions.count(name) for name in order}
    if any(value <= 0 for value in counts.values()):
        raise TemplateError('Each axial region must contain H8 cells')
    return dict(ok=True, nodes=len(mesh['nodes']), elements=len(mesh['elements']),
                region_elements=counts, fine_segments=mesh['fine_segments'],
                coarse_segments=mesh['coarse_segments'],
                transition_z=(mesh['fine_z'], mesh['transition_z']),
                stage_z=zi, stage_counts=counts_expected,
                min_center_jacobian=min_center, min_corner_jacobian=min_corner,
                min_gauss_jacobian=min_gauss, min_scaled_jacobian=min_sj,
                region_min_jacobians=stage_quality,
                volume=volume, interface_faces=[interfaces[z] for z in zi],
                internal_faces=sum(1 for value in face_counts.values() if value == 2),
                boundary_faces=sum(1 for value in face_counts.values() if value == 1),
                max_face_incidence=max(face_counts.values()))
