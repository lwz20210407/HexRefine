"""Pure structured axial cylindrical transition generator.

This is an offline HexRefine-side implementation of the AXIAL_SURFACE idea:
fine circumferential loop -> one or more periodic transition bands -> coarse
loop, then radial extrusion into H8 cells. It does not call Abaqus.
"""
from __future__ import division

import math

from .templates import tile_strip_quads, TemplateError


def _key(point):
    return tuple(round(float(value), 12) for value in point)


def _hex_center_det(points):
    # Node order: lower Q4 followed by the matching upper Q4.
    q = points
    a = tuple(q[1][i] - q[0][i] for i in range(3))
    b = tuple(q[3][i] - q[0][i] for i in range(3))
    c = tuple(q[4][i] - q[0][i] for i in range(3))
    cross = (b[1]*c[2] - b[2]*c[1],
             b[2]*c[0] - b[0]*c[2],
             b[0]*c[1] - b[1]*c[0])
    return sum(a[i] * cross[i] for i in range(3))


def _hex_center_jacobian(points):
    """Return the trilinear H8 Jacobian determinant at the element center."""
    signs = ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
             (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))
    columns = [[0.0, 0.0, 0.0] for _ in range(3)]
    for point, sign in zip(points, signs):
        for axis in range(3):
            weight = sign[axis] / 8.0
            for component in range(3):
                columns[axis][component] += weight * point[component]
    a, b, c = columns
    cross = (b[1]*c[2] - b[2]*c[1],
             b[2]*c[0] - b[0]*c[2],
             b[0]*c[1] - b[1]*c[0])
    return sum(a[i] * cross[i] for i in range(3))


def _face_key_counts(mesh):
    """Count H8 faces; a conforming mesh has no face with incidence > 2."""
    faces = ((0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
             (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0))
    counts = {}
    for conn in mesh['elements']:
        for face in faces:
            key = tuple(sorted(conn[index] for index in face))
            counts[key] = counts.get(key, 0) + 1
    return counts


def build_axial_cylinder(fine_segments=48, ratio=2, fine_z=3.0,
                         transition_z=7.0, total_z=10.0,
                         inner_radius=2.0, outer_radius=5.0,
                         regular_layers=6, radial_layers=2):
    fine_segments = int(fine_segments)
    ratio = int(ratio)
    if fine_segments <= 0 or fine_z <= 0 or transition_z <= fine_z or total_z <= transition_z:
        raise TemplateError('Invalid axial dimensions')
    coarse_segments = fine_segments // ratio
    if coarse_segments <= 0:
        raise TemplateError('Invalid coarse segment count')
    if ratio not in (2, 3) or fine_segments % (4 if ratio == 2 else 3):
        raise TemplateError('Fine segment count is incompatible with ratio')
    if inner_radius <= 0 or outer_radius <= inner_radius:
        raise TemplateError('Invalid cylinder radii')
    regular_layers = int(regular_layers)
    radial_layers = int(radial_layers)
    if regular_layers < 1 or radial_layers < 1:
        raise TemplateError('Layer counts must be positive')

    nodes = []
    node_map = {}

    def node(radius, theta, z):
        theta = theta % (2.0 * math.pi)
        point = (radius * math.cos(theta), radius * math.sin(theta), z)
        key = (round(radius, 12), round(theta, 12), round(z, 12))
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
            lower = [node(radii[radial], 2.0 * math.pi * u,
                          z) for u, z in q]
            upper = [node(radii[radial + 1], 2.0 * math.pi * u,
                          z) for u, z in q]
            conn = lower + upper
            if _hex_center_det([nodes[n - 1] for n in conn]) < 0:
                conn = [conn[0], conn[3], conn[2], conn[1],
                        conn[4], conn[7], conn[6], conn[5]]
            elements.append(conn)
            regions.append(region)

    def regular_band(z0, z1, count, label):
        for iz in range(regular_layers):
            za = z0 + (z1 - z0) * iz / regular_layers
            zb = z0 + (z1 - z0) * (iz + 1) / regular_layers
            for it in range(count):
                u0 = it / float(count)
                u1 = (it + 1) / float(count)
                add_surface_quad([(u0, za), (u1, za), (u1, zb), (u0, zb)], label)

    regular_band(0.0, fine_z, fine_segments, 'fine')
    transition = tile_strip_quads(ratio, fine_segments, float(fine_segments),
                                  transition_z - fine_z)
    for quad in transition:
        add_surface_quad([(u / float(fine_segments), fine_z + v)
                          for u, v in quad], 'transition')
    regular_band(transition_z, total_z, coarse_segments, 'coarse')

    if not elements or any(_hex_center_det([nodes[n - 1] for n in e]) <= 0 for e in elements):
        raise TemplateError('Generated axial cylinder contains a non-positive H8')
    return {
        'nodes': nodes, 'elements': elements, 'regions': regions,
        'fine_segments': fine_segments, 'coarse_segments': coarse_segments,
        'fine_z': fine_z, 'transition_z': transition_z, 'total_z': total_z,
        'inner_radius': inner_radius, 'outer_radius': outer_radius,
        'radial_layers': radial_layers, 'regular_layers': regular_layers,
    }


def audit_axial_cylinder(mesh):
    node_count = len(mesh['nodes'])
    if not mesh['elements']:
        raise TemplateError('Axial mesh contains no H8 elements')
    if any(len(conn) != 8 for conn in mesh['elements']):
        raise TemplateError('Axial mesh contains a non-H8 connectivity')
    if any(node < 1 or node > node_count
           for conn in mesh['elements'] for node in conn):
        raise TemplateError('Axial mesh contains an out-of-range node id')
    if len(set(tuple(conn) for conn in mesh['elements'])) != len(mesh['elements']):
        raise TemplateError('Axial mesh contains duplicate element connectivity')
    jacobians = [_hex_center_jacobian([mesh['nodes'][node - 1] for node in conn])
                 for conn in mesh['elements']]
    if min(jacobians) <= 0.0:
        raise TemplateError('Axial mesh contains a non-positive center Jacobian')
    face_counts = _face_key_counts(mesh)
    if max(face_counts.values()) > 2:
        raise TemplateError('Axial mesh contains a non-manifold face')
    regions = mesh['regions']
    counts = {name: regions.count(name) for name in ('fine', 'transition', 'coarse')}
    if any(value <= 0 for value in counts.values()):
        raise TemplateError('Each axial region must contain H8 cells')
    return dict(ok=True, nodes=len(mesh['nodes']), elements=len(mesh['elements']),
                region_elements=counts, fine_segments=mesh['fine_segments'],
                coarse_segments=mesh['coarse_segments'],
                transition_z=(mesh['fine_z'], mesh['transition_z']),
                min_center_jacobian=min(jacobians),
                internal_faces=sum(1 for value in face_counts.values() if value == 2),
                boundary_faces=sum(1 for value in face_counts.values() if value == 1),
                max_face_incidence=max(face_counts.values()))
