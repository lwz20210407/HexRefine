"""Experimental native boundary pillowing, not a mesh-quality acceptance API.

The three-prism seed is constructed from three quadrilateral sectors of a
hexagon, extruded one layer. No template table, executable, optimizer, or
filesystem path is used. Matching preserves literal vertex identities and
oriented Q4 cycles. Pillowing preserves every prescribed outer Q4 and its
coordinates, then initializes a new inner copy using a graph Laplacian.

Returned connectivity is LOCAL. Callers must allocate new global IDs above
their actual source maximum and independently check Jacobians, embedding,
volume, neighbours, engineering quality, and whole-model conformity. Even
an exactly matched boundary does not certify a valid geometric embedding.
"""
from collections import Counter, defaultdict, deque
from dataclasses import dataclass

import numpy as np

from .h8_quality_report import EDGES
from .mesh_audit import FACES


def _integer_array(values, width=None, name='connectivity'):
    a = np.asarray(values)
    if (a.dtype.kind not in 'iu' or not a.size or np.any(a < 0)
            or int(a.max()) > np.iinfo(np.int64).max):
        raise ValueError(f'{name} requires nonnegative int64 identities')
    if width is None:
        if a.ndim != 1:
            raise ValueError(f'{name} requires a one-dimensional identity array')
    elif a.ndim != 2 or a.shape[1] != width:
        raise ValueError(f'{name} requires rows of {width} identities')
    return a.astype(np.int64, copy=True)


def _cycle(face):
    q = tuple(map(int, face))
    return min(q[i:] + q[:i] for i in range(4))


def _face_map(faces):
    return {tuple(sorted(map(int, q))): _cycle(q) for q in faces}


def _connected(nodes, adjacency):
    nodes = set(nodes)
    if not nodes:
        return False
    seen = {min(nodes)}
    pending = deque(seen)
    while pending:
        for other in adjacency[pending.popleft()]:
            if other not in seen:
                seen.add(other)
                pending.append(other)
    return seen == nodes


def _surface(faces):
    q = _integer_array(faces, 4, 'boundary Q4')
    if len(q) > 128 or any(len(set(row)) != 4 for row in q):
        raise ValueError('Require bounded Q4 faces with four distinct identities')
    if len(_face_map(q)) != len(q):
        raise ValueError('Duplicate boundary face')
    edges = defaultdict(list)
    links = defaultdict(list)
    for fi, face in enumerate(q):
        for j, n in enumerate(face):
            n, other = int(n), int(face[(j + 1) % 4])
            edges[tuple(sorted((n, other)))].append((fi, n, other))
            links[n].append((int(face[j - 1]), other))
    face_adj = defaultdict(set)
    for rows in edges.values():
        if len(rows) != 2:
            raise ValueError('Boundary must be closed edge-manifold')
        first, second = rows
        if first[1:] != second[1:][::-1]:
            raise ValueError('Boundary edge orientations must be opposite')
        face_adj[first[0]].add(second[0])
        face_adj[second[0]].add(first[0])
    if not _connected(range(len(q)), face_adj):
        raise ValueError('Boundary must be a connected sphere')
    vertices = set(map(int, q.flat))
    if len(vertices) - len(edges) + len(q) != 2:
        raise ValueError('Boundary Euler characteristic must be two')
    for rows in links.values():
        counts = Counter(tuple(sorted(edge)) for edge in rows)
        adjacency = defaultdict(set)
        for a, b in rows:
            adjacency[a].add(b)
            adjacency[b].add(a)
        if (any(count != 1 for count in counts.values())
                or any(len(row) != 2 for row in adjacency.values())
                or not _connected(adjacency, adjacency)):
            raise ValueError('Every boundary vertex link must be one simple cycle')
    return q


def _hex_faces(elements):
    h = _integer_array(elements, 8, 'H8 connectivity')
    if len(h) > 128 or any(len(set(row)) != 8 for row in h):
        raise ValueError('Require bounded H8 with eight distinct identities')
    keys = [tuple(sorted(map(int, row))) for row in h]
    if len(set(keys)) != len(keys):
        raise ValueError('Duplicate H8 cell')
    owners = defaultdict(list)
    adjacency = defaultdict(set)
    for ei, cell in enumerate(h):
        for face in cell[FACES]:
            q = tuple(map(int, face))
            owners[tuple(sorted(q))].append((ei, q))
    for rows in owners.values():
        if len(rows) > 2:
            raise ValueError('Nonmanifold H8 face multiplicity')
        if len(rows) == 2:
            (a, qa), (b, qb) = rows
            if _cycle(qa) != _cycle(qb[::-1]):
                raise ValueError('Shared H8 face orientations must be opposite')
            adjacency[a].add(b)
            adjacency[b].add(a)
    return h, owners, adjacency


def oriented_hex_boundary(elements):
    """Read literal outward Q4s, rejecting duplicate/nonmanifold/shared-cycle errors."""
    _, owners, _ = _hex_faces(elements)
    result = [rows[0][1] for rows in owners.values() if len(rows) == 1]
    if not result:
        raise ValueError('H8 seed has no exterior boundary')
    return np.array(result, dtype=np.int64)


def native_three_prism_seed():
    """Return the native3-sector, one-layer extrusion (14 vertices,3 H8)."""
    sectors = np.array([[0, 1, 2, 6], [2, 3, 4, 6], [4, 5, 0, 6]], dtype=np.int64)
    return np.column_stack((sectors, sectors + 7))


def _incidence(faces):
    graph = defaultdict(set)

    def join(a, b):
        graph[a].add(b)
        graph[b].add(a)

    for fi, face in enumerate(faces):
        face_node = (2, fi)
        for j, value in enumerate(face):
            a, b = int(value), int(face[(j + 1) % 4])
            edge = (1, *sorted((a, b)))
            join((0, a), edge)
            join((0, b), edge)
            join(face_node, edge)
            join(face_node, (0, a))
    return dict(graph)


def _refined_colors(first, second):
    graphs = first, second
    colors = [{n: n[0] for n in graph} for graph in graphs]
    for _ in range(len(first)):
        signatures = [{n: (color[n], tuple(sorted(color[v] for v in graph[n])))
                       for n in graph} for graph, color in zip(graphs, colors)]
        palette = {s: i for i, s in enumerate(sorted(set(signatures[0].values())
                                                    | set(signatures[1].values())))}
        updated = [{n: palette[s] for n, s in rows.items()} for rows in signatures]
        if updated == colors:
            break
        colors = updated
    return colors


def match_native_three_prism(boundary_faces, *, maximum_search_states=20000):
    """Match an oriented12Q/14V sphere by bounded typed V-E-F graph isomorphism.

    Graph matches are additionally checked against EVERY full face cycle;
    only a consistent global reflection is allowed. No coordinate welding or
    invented vertex IDs. Budget exhaustion is not a nonexistence proof.
    """
    target = _surface(boundary_faces)
    if len(target) != 12 or len(np.unique(target)) != 14:
        raise ValueError('Native three-prism boundary requires12 Q4 and14 vertices')
    if type(maximum_search_states) is not int or maximum_search_states < 1:
        raise ValueError('Require a positive integer graph-search budget')
    seed = native_three_prism_seed()
    canonical_faces = oriented_hex_boundary(seed)
    first, second = _incidence(canonical_faces), _incidence(target)
    ca, cb = _refined_colors(first, second)
    if Counter(ca.values()) != Counter(cb.values()):
        raise ValueError('Boundary has no native three-prism incidence isomorphism')
    candidates = {n: [v for v in sorted(second) if cb[v] == ca[n]] for n in first}
    expected = _face_map(target)
    mapping, used = {}, set()
    states = 0

    def search():
        nonlocal states
        states += 1
        if states > maximum_search_states:
            raise ValueError('Native prism graph-search budget exhausted; no nonexistence claim')
        if len(mapping) == len(first):
            vm = {n[1]: v[1] for n, v in mapping.items() if n[0] == 0}
            mapped = [[vm[int(n)] for n in face] for face in canonical_faces]
            positive = all(_cycle(q) == expected[tuple(sorted(q))] for q in mapped)
            reflected = all(_cycle(q[::-1]) == expected[tuple(sorted(q))] for q in mapped)
            if not (positive or reflected):
                return None
            result = np.array([[vm[int(n)] for n in cell] for cell in seed], dtype=np.int64)
            if reflected:
                result = result[:, [1, 0, 3, 2, 5, 4, 7, 6]]
            return result
        selected, options = None, None
        for node in sorted(first):
            if node in mapping:
                continue
            possible = [v for v in candidates[node] if v not in used and all(
                (other in first[node]) == (image in second[v])
                for other, image in mapping.items())]
            if not possible:
                return None
            if options is None or len(possible) < len(options):
                selected, options = node, possible
                if len(options) == 1:
                    break
        for image in options:
            mapping[selected] = image
            used.add(image)
            result = search()
            if result is not None:
                return result
            used.remove(image)
            del mapping[selected]
        return None

    matched = search()
    if matched is None:
        raise ValueError('Boundary has no oriented native three-prism face-cycle match')
    if _face_map(oriented_hex_boundary(matched)) != expected:
        raise ValueError('Native prism face-cycle readback mismatch')
    return matched


@dataclass(frozen=True)
class BoundaryPillow:
    """Local recipe and immutable-at-return arrays; no new global IDs assigned."""
    boundary_node_ids: tuple
    nodes: np.ndarray
    elements: np.ndarray
    boundary_faces: np.ndarray
    seed_elements: np.ndarray

    @property
    def interior_node_indices(self):
        return tuple(range(len(self.boundary_node_ids), len(self.nodes)))

    def to_contract(self):
        """Return a fresh JSON-compatible experimental contract, never accepted geometry."""
        return dict(schema='experimental-h8-boundary-pillow.v1',
                    boundaryBindings=[dict(nodeID=n, localIndex=i)
                                      for i, n in enumerate(self.boundary_node_ids)],
                    nodes=self.nodes.tolist(), elements=self.elements.tolist(),
                    prescribedBoundaryFaces=self.boundary_faces.tolist(),
                    interiorLocalIndices=list(self.interior_node_indices),
                    initialization='unweighted-H8-edge-graph-harmonic',
                    globalNodeIDsAssigned=False, prescribedBoundaryMatchedAtConstruction=True,
                    protectedBoundaryCoordinatesPreservedAtConstruction=True,
                    continuousJacobianCertified=False, globalOverlapCertified=False,
                    shapeAccepted=False, engineeringQualityAccepted=False,
                    wholeModelAccepted=False)


def pillow_boundary(boundary_node_ids, boundary_nodes, boundary_faces, seed_elements):
    """Wrap a boundary-only H8 seed in one complete unsplit-Q4 pillow layer.

    Boundary faces and seed elements reference literal input identities. The
    returned arrays use local indices, with the protected boundary first and
    one new volume point per boundary point second. Seed vertices must ALL
    belong to the boundary. The full-boundary construction is deliberately
    not independent1-to7 subdivision of each possibly degenerate seed H8.
    """
    ids = _integer_array(boundary_node_ids, name='boundary node IDs')
    points = np.asarray(boundary_nodes)
    if (points.shape != (len(ids), 3) or points.dtype.kind not in 'fiu'
            or not np.isfinite(points).all() or len(ids) > 128):
        raise ValueError('Require bounded finite real boundary XYZ')
    if len(set(map(int, ids))) != len(ids):
        raise ValueError('Duplicate boundary node identity; welding is not allowed')
    target = _surface(boundary_faces)
    if set(map(int, target.flat)) != set(map(int, ids)):
        raise ValueError('Boundary identities must match supplied coordinates exactly')
    seed, _, adjacency = _hex_faces(seed_elements)
    if set(map(int, seed.flat)) != set(map(int, ids)):
        raise ValueError('Seed must use exactly the prescribed boundary identities')
    if not _connected(range(len(seed)), adjacency):
        raise ValueError('Seed cells must be face-connected')
    if _face_map(oriented_hex_boundary(seed)) != _face_map(target):
        raise ValueError('Seed does not match every oriented boundary face cycle')
    lookup = {int(n): i for i, n in enumerate(ids)}
    local_faces = np.array([[lookup[int(n)] for n in q] for q in target], dtype=np.int64)
    local_seed = np.array([[lookup[int(n)] for n in q] for q in seed], dtype=np.int64)
    nb = len(ids)
    shell = np.array([[f[0], f[3], f[2], f[1], f[0] + nb, f[3] + nb,
                       f[2] + nb, f[1] + nb] for f in local_faces], dtype=np.int64)
    elements = np.vstack((shell, local_seed + nb))
    if _face_map(oriented_hex_boundary(elements)) != _face_map(local_faces):
        raise ValueError('Constructed pillow violates prescribed outer face cycles')
    neighbours = [set() for _ in range(2 * nb)]
    for cell in elements:
        for a, b in cell[EDGES]:
            neighbours[int(a)].add(int(b))
            neighbours[int(b)].add(int(a))
    protected = points.astype(float, copy=True)
    if points.dtype.kind in 'iu':
        exact = all(int(a) == int(b) for a, b in zip(protected.flat, points.flat))
    else:
        exact = np.array_equal(protected.astype(points.dtype), points)
    if not exact:
        raise ValueError('Protected XYZ must be exactly representable as float64')
    origin = protected[0].copy()
    matrix, rhs = np.zeros((nb, nb)), np.zeros((nb, 3))
    for n in range(nb, 2 * nb):
        matrix[n - nb, n - nb] = len(neighbours[n])
        for other in neighbours[n]:
            if other < nb:
                rhs[n - nb] += protected[other] - origin
            else:
                matrix[n - nb, other - nb] -= 1
    try:
        inner = np.linalg.solve(matrix, rhs) + origin
    except np.linalg.LinAlgError as exc:
        raise ValueError('Pillow graph initialization is singular') from exc
    nodes = np.vstack((protected, inner))
    if not np.isfinite(nodes).all():
        raise ValueError('Pillow initialization produced nonfinite coordinates')
    for array in (nodes, elements, local_faces, local_seed):
        array.setflags(write=False)
    return BoundaryPillow(tuple(map(int, ids)), nodes, elements, local_faces, local_seed)
