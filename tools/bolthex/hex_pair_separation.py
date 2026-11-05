"""Sufficient exact H8 separation certificates; failure means inconclusive.

Coordinates are interpreted as their exact binary64 read-back values. Floating
point LPs and polynomial evaluations only propose certificates. Every accepted
sign, including structural zeros on shared bilinear faces, uses Fraction.
This proves neither source-domain coverage nor CAD fidelity.
"""
from __future__ import annotations

from fractions import Fraction
from collections import defaultdict
from itertools import combinations, product

import numpy as np
from scipy.optimize import linprog

from .mesh_audit import FACES, SIGNS


GRID = tuple(product((0, .5, 1), repeat=3))
CORNER_BITS = ((SIGNS+1)/2).astype(int)
MAX_CELLS = 64
MAX_NODES = 8*MAX_CELLS


def _mesh_arrays(nodes, elements, max_cells=MAX_CELLS):
    if (isinstance(max_cells, (bool, np.bool_))
            or not isinstance(max_cells, (int, np.integer))
            or not 1 <= max_cells <= MAX_CELLS):
        raise ValueError('Cell budget must be an integer in 1..64, never bool')
    try:
        node_count, cell_count = len(nodes), len(elements)
    except TypeError as error:
        raise ValueError('Require sized node and H8 arrays') from error
    if not 1 <= node_count <= MAX_NODES:
        raise ValueError('Require 1..512 nodes, including unused nodes')
    if not 1 <= cell_count <= max_cells:
        raise ValueError('Require bounded nonempty H8 connectivity')
    raw_nodes = np.asarray(nodes)
    if raw_nodes.ndim != 2 or raw_nodes.shape[1] != 3:
        raise ValueError('Require finite Nx3 nodes')
    nodes = np.asarray(raw_nodes, dtype=float)
    cells = np.asarray(elements)
    if not np.isfinite(nodes).all():
        raise ValueError('Require finite Nx3 nodes')
    if (cells.ndim != 2 or cells.shape[1] != 8 or cells.dtype.kind not in 'iu'
            or np.any(cells < 0) or np.any(cells >= node_count)):
        raise ValueError('Require integer, in-range eight-slot connectivity')
    return nodes, cells


def _element_ids(values, count):
    if values is None:
        return list(range(1, count+1))
    ids = np.asarray(values, dtype=object)
    if ids.shape != (count,):
        raise ValueError('Require one integer element ID per cell')
    if any(isinstance(v, (bool, np.bool_)) or not isinstance(v, (int, np.integer)) for v in ids):
        raise ValueError('Element IDs must be integers, never bool or float')
    result = [int(v) for v in ids]
    if len(set(result)) != count:
        raise ValueError('Require distinct element IDs matching connectivity')
    return result


def _dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def _sub(a, b):
    return tuple(x-y for x, y in zip(a, b))


def _cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2],
            a[0]*b[1]-a[1]*b[0])


def _det(a, b, c):
    return _dot(a, _cross(b, c))


def _exact(values):
    return np.array([Fraction.from_float(float(x)) for x in np.asarray(values).flat],
                    dtype=object).reshape(np.shape(values))


def _vertices(values):
    p = np.asarray(values, dtype=float)
    if p.shape != (8, 3) or not np.isfinite(p).all():
        raise ValueError('Require eight finite XYZ vertices in standard H8 order')
    return p


def tensor_bernstein(values):
    """Degree-(2,2,2) coefficients from values at {0,1/2,1}^3."""
    out = np.array(values, copy=True)
    if out.shape != (3, 3, 3):
        raise ValueError('Require a 3 by 3 by 3 value tensor')
    if out.dtype.kind in 'iu':
        out = out.astype(float)
    for axis in range(3):
        moved = np.moveaxis(out, axis, 0)
        middle = 2*moved[1]-(moved[0]+moved[2])/2
        moved[1] = middle
    return out


def _weights(exact):
    result = []
    for q in GRID:
        q = [Fraction.from_float(x) for x in q] if exact else q
        row = []
        for bits in CORNER_BITS:
            value = 1
            for axis, bit in enumerate(bits):
                value *= q[axis] if bit else 1-q[axis]
            row.append(value)
        result.append(row)
    return np.array(result, dtype=object if exact else float)


FLOAT_WEIGHTS = _weights(False)
EXACT_WEIGHTS = _weights(True)


def face_separator(quad, *, exact=True):
    """An exact plane or implicit bilinear-face quadric (not an inverse map)."""
    q = np.asarray(quad, dtype=float)
    if q.shape != (4, 3) or not np.isfinite(q).all():
        raise ValueError('Require four finite cyclic face vertices')
    if exact:
        q = _exact(q)
    a = tuple(q[0]); b = _sub(q[1], a); c = _sub(q[3], a)
    d = tuple(q[2]-q[1]-q[3]+q[0])
    m = _det(b, c, d)
    if m != 0:
        return dict(kind='quadric', origin=a, b=b, c=c, d=d, m=m)
    normals = [_cross(b, c), _cross(b, d), _cross(c, d)]
    normal = max(normals, key=lambda n: sum(float(v)**2 for v in n))
    if not any(v != 0 for v in normal):
        return None
    return dict(kind='plane', origin=a, normal=normal)


def _evaluate(separator, points):
    values = []
    for point in points:
        p = _sub(point, separator['origin'])
        if separator['kind'] == 'plane':
            values.append(_dot(separator['normal'], p))
        else:
            b, c, d, m = (separator[k] for k in ('b', 'c', 'd', 'm'))
            values.append(m*_det(b, c, p)-_det(p, c, d)*_det(b, p, d))
    return values


def mapped_face_bernstein(quad, vertices, *, exact=True):
    """Coefficients of F(H(r,s,t)), r,s,t in [0,1]. None for line faces."""
    p = _vertices(vertices)
    separator = face_separator(quad, exact=exact)
    if separator is None:
        return None
    points = EXACT_WEIGHTS @ _exact(p) if exact else FLOAT_WEIGHTS @ p
    values = np.array(_evaluate(separator, points), dtype=object if exact else float)
    return tensor_bernstein(values.reshape(3, 3, 3))


def _sign(coefficients):
    values = list(np.asarray(coefficients).flat)
    if min(values) >= 0 and max(values) > 0:
        return 1
    if max(values) <= 0 and min(values) < 0:
        return -1
    return 0


def _summary(coefficients):
    values = list(coefficients.flat)
    return dict(minimum=str(min(values)), maximum=str(max(values)),
                zeroCount=sum(v == 0 for v in values), sign=_sign(coefficients))


def bernstein_sign_certificate(coefficients, sign, *, strict=False, max_depth=6):
    """Bounded exact de Casteljau subdivision; no epsilon or sampling acceptance."""
    if sign not in (-1, 1) or not 0 <= max_depth <= 9:
        raise ValueError('Require sign +/-1 and subdivision depth 0..9')
    c = np.asarray(coefficients, dtype=object)*sign
    if c.ndim != 3 or any(n not in (2, 3) for n in c.shape):
        raise ValueError('Require a tensor of degree one or two in each axis')
    if any(not isinstance(v, (Fraction, int, np.integer)) for v in c.flat):
        raise ValueError('Require exact rational coefficients')
    visited, maximum = 0, 0
    factors = []
    if not strict:
        if min(c.flat) >= 0 and max(c.flat) > 0:
            return dict(certified=True, sign=sign, strict=False, boxesVisited=1,
                        maximumDepth=0, boundaryFactors=[])
        # Weak signs on subdivided boxes alone do not prove strict interior
        # signs: (u-1/2)^2 vanishes on an internal subdivision plane. Remove
        # only structural ORIGINAL boundary factors, then demand strict bounds.
        changed = True
        while changed:
            changed = False
            for axis in range(3):
                v = np.moveaxis(c, axis, 0)
                degree = len(v)-1
                if degree == 0:
                    continue
                for side in (0, 1):
                    if all(x == 0 for x in v[degree*side].flat):
                        if side == 0:
                            quotient = np.stack([v[i+1]*Fraction(degree, i+1) for i in range(degree)])
                        else:
                            quotient = np.stack([v[i]*Fraction(degree, degree-i) for i in range(degree)])
                        c = np.moveaxis(quotient, 0, axis)
                        factors.append(dict(axis=axis, side=side))
                        changed = True
                        break
        if min(c.flat) >= 0 and max(c.flat) > 0:
            return dict(certified=True, sign=sign, strict=False, boxesVisited=1,
                        maximumDepth=0, boundaryFactors=factors)

    def visit(values, depth):
        nonlocal visited, maximum
        visited += 1; maximum = max(maximum, depth)
        low, high = min(values.flat), max(values.flat)
        if low > 0:
            return True
        if high <= 0 or depth == max_depth:
            return False
        axis = depth % 3
        if values.shape[axis] == 1:
            candidates = [i for i in range(3) if values.shape[i] > 1]
            if not candidates:
                return False
            axis = candidates[0]
        v = np.moveaxis(values, axis, 0)
        if len(v) == 2:
            middle = (v[0]+v[1])*Fraction(1, 2)
            halves = (np.stack((v[0], middle)), np.stack((middle, v[1])))
        else:
            left = (v[0]+v[1])*Fraction(1, 2)
            right = (v[1]+v[2])*Fraction(1, 2)
            middle = (left+right)*Fraction(1, 2)
            halves = (np.stack((v[0], left, middle)), np.stack((middle, right, v[2])))
        return all(visit(np.moveaxis(half, 0, axis), depth+1) for half in halves)

    certified = visit(c, 0)
    return dict(certified=certified, sign=sign, strict=strict, boxesVisited=visited,
                maximumDepth=maximum, boundaryFactors=factors)


def _screen(a, b):
    evaluation = np.array([[1, 0, 0], [.25, .5, .25], [0, 0, 1.]])
    a, b = [np.einsum('ai,bj,ck,ijk->abc', evaluation, evaluation, evaluation, c) for c in (a, b)]
    magnitude = max(float(np.max(abs(a))), float(np.max(abs(b))), 1e-300)
    tolerance = magnitude*1e-10
    return ((a.min() >= -tolerance and a.max() > tolerance and
             b.max() <= tolerance and b.min() < -tolerance) or
            (b.min() >= -tolerance and b.max() > tolerance and
             a.max() <= tolerance and a.min() < -tolerance))


def _hull_separator(a, b):
    common = sorted(set(map(tuple, a)) & set(map(tuple, b)))
    origin = np.array(common[0]) if common else np.vstack((a, b)).mean(axis=0)
    scale = max(float(np.ptp(np.vstack((a, b)), axis=0).max()), 1e-300)
    aa, bb = (a-origin)/scale, (b-origin)/scale
    wa = np.array([0 if tuple(p) in common else 1 for p in a])
    wb = np.array([0 if tuple(p) in common else 1 for p in b])
    matrix = np.vstack((np.c_[-aa, np.ones(len(a)), wa], np.c_[bb, -np.ones(len(b)), wb]))
    answer = linprog([0, 0, 0, 0, -1], A_ub=matrix, b_ub=np.zeros(len(a)+len(b)),
                     bounds=[(-1, 1)]*3+[(None, None), (None, 1)], method='highs')
    if not answer.success:
        return None
    normal = tuple(_exact(answer.x[:3])); origin = tuple(_exact(origin))
    if common:
        origin = tuple(_exact(common[0])); basis = []
        for point in common[1:]:
            edge = _sub(tuple(_exact(point)), origin)
            if not any(edge):
                continue
            if not basis:
                basis.append(edge)
            elif len(basis) == 1 and any(_cross(basis[0], edge)):
                basis.append(edge)
            elif len(basis) == 2 and _det(basis[0], basis[1], edge) != 0:
                return None
        if len(basis) == 1:
            normal = _cross(basis[0], _cross(normal, basis[0]))
        elif len(basis) == 2:
            candidate = _cross(*basis)
            normal = candidate if _dot(normal, candidate) >= 0 else tuple(-v for v in candidate)
        offset = _dot(normal, origin)
    else:
        offset = _dot(normal, origin)+Fraction.from_float(float(answer.x[3]))*Fraction.from_float(scale)
    ca = np.array([_dot(normal, p)-offset for p in _exact(a)], dtype=object)
    cb = np.array([_dot(normal, p)-offset for p in _exact(b)], dtype=object)
    if _sign(ca)*_sign(cb) != -1:
        return None
    return dict(method='exact-hull-plane', normal=[str(v) for v in normal], offset=str(offset),
                first=_summary(ca), second=_summary(cb))


def pair_separation(first, second, *, float_screen=True):
    """Certify disjoint material interiors, or return inconclusive, never overlap.

    Shared points/edges/faces may remain in F=0. At every reference-interior
    point all tensor Bernstein basis functions are positive, hence a weakly
    signed coefficient tensor with at least one strict coefficient is strict.
    """
    a, b = _vertices(first), _vertices(second)
    plane = _hull_separator(a, b)
    if plane is not None:
        return dict(certified=True, **plane)
    attempted = 0
    for owner, source in enumerate((a, b)):
        for face_index, slots in enumerate(FACES):
            quad = source[slots]
            if float_screen:
                fa = mapped_face_bernstein(quad, a, exact=False)
                fb = mapped_face_bernstein(quad, b, exact=False)
                if fa is None or fb is None or not _screen(fa, fb):
                    continue
            ca = mapped_face_bernstein(quad, a)
            cb = mapped_face_bernstein(quad, b)
            if ca is None or cb is None:
                continue
            attempted += 1
            centre_weights = np.array([Fraction(1, 4), Fraction(1, 2), Fraction(1, 4)], dtype=object)
            centre = sum(ca[i, j, k]*centre_weights[i]*centre_weights[j]*centre_weights[k]
                         for i, j, k in product(range(3), repeat=3))
            sign = 1 if centre > 0 else -1 if centre < 0 else 0
            if not sign:
                continue
            first_certificate = bernstein_sign_certificate(ca, sign)
            second_certificate = bernstein_sign_certificate(cb, -sign)
            if first_certificate['certified'] and second_certificate['certified']:
                return dict(certified=True, method='exact-face-polynomial',
                            separatorOwner=owner, localFace=face_index+1,
                            polynomialKind=face_separator(quad)['kind'],
                            first=_summary(ca), second=_summary(cb),
                            firstSubdivision=first_certificate, secondSubdivision=second_certificate)
    return dict(certified=False, method='inconclusive', exactFaceCandidatesTested=attempted,
                note='No separation certificate is not an overlap witness.')


def determinant_certificate(vertices):
    """Exact tensor Bernstein sufficient certificate of det(dH/d[0,1]^3)>0."""
    p = _exact(_vertices(vertices))
    values = []
    for coordinates in GRID:
        q = [Fraction.from_float(x) for x in coordinates]
        derivatives = []
        for bits in CORNER_BITS:
            row = []
            for j in range(3):
                value = 1 if bits[j] else -1
                for k in range(3):
                    if k != j:
                        value *= q[k] if bits[k] else 1-q[k]
                row.append(value)
            derivatives.append(row)
        jacobian = np.array(derivatives, dtype=object).T @ (p-p[0])
        values.append(_det(*jacobian))
    coefficients = tensor_bernstein(np.array(values, dtype=object).reshape(3, 3, 3))
    return dict(certified=bool(min(coefficients.flat) > 0),
                reference='[0,1]^3', integratedVolumeExact=str(sum(coefficients.flat)/27),
                **_summary(coefficients))


def _face_embedding(quad):
    p = _exact(quad)
    normals = [_cross(_sub(p[(j+1) % 4], p[j]), _sub(p[j-1], p[j])) for j in range(4)]
    raw = np.array(normals, dtype=float)
    lengths = np.linalg.norm(raw, axis=1)
    if np.any(lengths == 0):
        return False
    raw /= lengths[:, None]
    answer = linprog([0, 0, 0, -1], A_ub=np.c_[-raw, np.ones(4)], b_ub=np.zeros(4),
                     bounds=[(-1, 1)]*3+[(None, None)], method='highs')
    return bool(answer.success and min(_dot(_exact(answer.x[:3]), n) for n in normals) > 0)


def cell_embedding_certificate(vertices):
    """Sufficient exact own-face-factor and Jacobian certificate; not necessary."""
    p = _vertices(vertices)
    determinant = determinant_certificate(p)
    faces = []
    for local_face, slots in enumerate(FACES):
        bits = CORNER_BITS[slots]
        axis = next(k for k in range(3) if np.ptp(bits[:, k]) == 0)
        side = int(bits[0, axis])
        coefficients = mapped_face_bernstein(p[slots], p)
        if coefficients is None:
            faces.append(dict(localFace=local_face+1, certified=False))
            continue
        c = np.moveaxis(coefficients, axis, 0)
        structural_zero = all(v == 0 for v in c[2*side].flat)
        quotient = np.stack((2*c[1], c[2])) if side == 0 else np.stack((c[0], 2*c[1]))
        sign = 1 if sum(quotient.flat) > 0 else -1
        remainder = bernstein_sign_certificate(quotient, sign, strict=True)
        strict = remainder['certified']
        embedding = _face_embedding(p[slots])
        faces.append(dict(localFace=local_face+1, certified=structural_zero and strict and embedding,
                          structuralFaceZero=structural_zero, quotientStrictSign=strict,
                          projectedQ4Embedding=embedding, quotient=_summary(quotient),
                          quotientSubdivision=remainder))
    return dict(certified=determinant['certified'] and all(f['certified'] for f in faces),
                determinant=determinant, faces=faces,
                note='Inconclusive if any sufficient condition fails; never declares a fold or overlap.')


def boundary_degree_certificate(nodes, elements):
    """Exact embedded-sphere/positive-Jacobian degree-one sufficient proof.

    This can succeed even when extending one warped shared face to a quadric
    fails to separate a particular pair. No source-material test is implied.
    """
    nodes, cells = _mesh_arrays(nodes, elements)
    owners = defaultdict(list)
    for cell in cells:
        for slots in FACES:
            face = tuple(map(int, cell[slots]))
            owners[tuple(sorted(face))].append(face)

    def cycle(face):
        return min(face[i:]+face[:i] for i in range(len(face)))

    if any(len(v) > 2 for v in owners.values()):
        return dict(certified=False, reason='Nonmanifold cell face ownership')
    if any(cycle(v[0]) != cycle(v[1][::-1]) for v in owners.values() if len(v) == 2):
        return dict(certified=False, reason='Internal face orientations do not cancel')
    boundary = [v[0] for v in owners.values() if len(v) == 1]
    if not boundary:
        return dict(certified=False, reason='No boundary')
    edges, links = defaultdict(list), defaultdict(list)
    for i, face in enumerate(boundary):
        for j, a in enumerate(face):
            b = face[(j+1) % 4]
            edges[tuple(sorted((a, b)))].append((i, a, b))
            links[a].append((face[j-1], b))
    if any(len(v) != 2 or v[0][1:] != v[1][1:][::-1] for v in edges.values()):
        return dict(certified=False, reason='Boundary is not closed and consistently oriented')
    for vertex_links in links.values():
        graph = defaultdict(list)
        for a, b in vertex_links:
            graph[a].append(b); graph[b].append(a)
        seen, stack = set(), [next(iter(graph))]
        while stack:
            v = stack.pop()
            if v not in seen:
                seen.add(v); stack.extend(graph[v])
        if any(len(v) != 2 for v in graph.values()) or len(seen) != len(graph):
            return dict(certified=False, reason='Nonmanifold boundary vertex link')
    adjacency = defaultdict(set)
    for pair in edges.values():
        a, b = pair[0][0], pair[1][0]
        adjacency[a].add(b); adjacency[b].add(a)
    seen, stack = set(), [0]
    while stack:
        v = stack.pop()
        if v not in seen:
            seen.add(v); stack.extend(adjacency[v])
    euler = len(links)-len(edges)+len(boundary)
    if len(seen) != len(boundary) or euler != 2:
        return dict(certified=False, reason='Boundary is not one topological sphere')
    determinants = [determinant_certificate(nodes[cell]) for cell in cells]
    if not all(c['certified'] for c in determinants):
        return dict(certified=False, reason='Global positive determinant not certified')
    quads = [nodes[list(f)] for f in boundary]
    if not all(_face_embedding(q) for q in quads):
        return dict(certified=False, reason='Individual boundary Q4 embedding not certified')
    proofs, unresolved = [], []
    for i, j in combinations(range(len(boundary)), 2):
        common_ids = set(boundary[i]) & set(boundary[j])
        common_xyz = set(map(tuple, quads[i])) & set(map(tuple, quads[j]))
        allowed_xyz = {tuple(nodes[v]) for v in common_ids}
        if len(common_ids) > 2 or common_xyz != allowed_xyz:
            unresolved.append([i, j]); continue
        if len(common_ids) == 2 and any(not any(set((f[k], f[(k+1) % 4])) == common_ids for k in range(4))
                                        for f in (boundary[i], boundary[j])):
            unresolved.append([i, j]); continue
        proof = _hull_separator(quads[i], quads[j])
        if (proof is None or proof['first']['zeroCount'] != len(common_ids)
                or proof['second']['zeroCount'] != len(common_ids)):
            unresolved.append([i, j]); continue
        proofs.append(dict(firstFace=i, secondFace=j, allowedSharedNodeIndices=sorted(common_ids), **proof))
    volume = sum(Fraction(c['integratedVolumeExact']) for c in determinants)
    return dict(certified=not unresolved and volume > 0, boundaryFaces=len(boundary),
                boundaryConnectivity=[list(f) for f in boundary], boundaryEuler=euler,
                orientedInternalFacesCancel=sum(len(v) == 2 for v in owners.values()),
                boundaryPairCertificates=proofs, unresolvedBoundaryPairs=unresolved,
                positiveDeterminantCertificates=determinants, exactPositiveOrientedVolume=str(volume),
                proof='Consistent embedded sphere has degree +1 inside, 0 outside (positive exact flux fixes orientation). Internal face chains cancel. Everywhere-positive cell Jacobians give positive multiplicities, so two material-interior preimages would contradict degree one.',
                scope='Only this candidate; neither source occupancy nor retained-original collision acceptance.')


def mesh_pair_separations(nodes, elements, element_ids=None, *, max_cells=MAX_CELLS):
    """Bounded pairwise material-interior separation and individual embedding."""
    nodes, cells = _mesh_arrays(nodes, elements, max_cells)
    ids = _element_ids(element_ids, len(cells))
    individual = [dict(eid=ids[i], **cell_embedding_certificate(nodes[cell])) for i, cell in enumerate(cells)]
    pairs = [dict(firstEID=ids[i], secondEID=ids[j], **pair_separation(nodes[cells[i]], nodes[cells[j]]))
             for i, j in combinations(range(len(cells)), 2)]
    pairwise_complete = all(p['certified'] for p in pairs) and all(c['certified'] for c in individual)
    degree = boundary_degree_certificate(nodes, cells) if not pairwise_complete else None
    return dict(schemaVersion=1, cells=len(cells), pairs=len(pairs),
                certifiedPairs=sum(p['certified'] for p in pairs),
                unresolvedPairs=[p for p in pairs if not p['certified']],
                cellEmbeddingCertificates=individual, pairCertificates=pairs,
                pairwiseProofComplete=pairwise_complete, boundaryDegreeCertificate=degree,
                internalMaterialNonoverlapCertified=pairwise_complete or bool(degree and degree['certified']),
                exactArithmetic='Fraction.from_float on read-back binary64 coordinates; float proposals never certify signs.',
                scope='Material interiors only. No source coverage, retained-domain collision, ID conformity or CAD acceptance.',
                sourceAccepted=False)
