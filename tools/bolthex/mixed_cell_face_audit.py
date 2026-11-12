"""Directed T4/P5 face gate before all-H8 conversion; not an overlap proof."""
from collections import Counter, defaultdict
from itertools import product

import numpy as np


FACES = {
    4: ((0, 2, 1), (0, 1, 3), (1, 2, 3), (2, 0, 3)),
    7: ((0, 3, 2, 1), (0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)),
}


def _cycle(face):
    return min(face[i:] + face[:i] for i in range(len(face)))


def _flux(points):
    if len(points) == 3:
        return float(np.dot(points[0], np.cross(points[1], points[2])) / 6)
    value = 0.
    for a, b in product((-1 / np.sqrt(3), 1 / np.sqrt(3)), repeat=2):
        u, v = (a + 1) / 2, (b + 1) / 2
        p = ((1-u)*(1-v)*points[0] + u*(1-v)*points[1]
             + u*v*points[2] + (1-u)*v*points[3])
        du = (1-v)*(points[1]-points[0]) + v*(points[2]-points[3])
        dv = (1-u)*(points[3]-points[0]) + u*(points[2]-points[1])
        value += float(np.dot(p, np.cross(du, dv)) / 12)
    return value


def audit_faces(nodes, node_ids, blocks):
    """Check literal directed incidences of Gmsh type4/type7 blocks.

    ``blocks`` maps each Gmsh type to ``(element_ids, literal_nid_rows)``.
    Counts, identities, distinct corners and references are checked before
    indexing. A two-owner face with equal direction is a rejection even when
    every cell's volume and sampled Jacobian happen to be positive.

    The flux residual is diagnostic only. Opposite local signed errors can
    sum to zero, so it never substitutes for checking every face. Global
    embedding, vertex links and continuous element Jacobians remain separate.
    """
    xyz, nids = np.asarray(nodes), np.asarray(node_ids)
    if (xyz.ndim != 2 or xyz.shape[1] != 3 or not len(xyz)
            or xyz.dtype.kind not in 'fiu' or not np.isfinite(xyz).all()
            or nids.shape != (len(xyz),) or nids.dtype.kind not in 'iu'
            or np.any(nids <= 0) or len(np.unique(nids)) != len(nids)):
        raise ValueError('Require finite XYZ and distinct positive integer NIDs')
    if not isinstance(blocks, dict) or not blocks or any(type(t) is not int or t not in FACES for t in blocks):
        raise ValueError('Require nonempty type4/type7 cell blocks')
    lookup = {int(n): i for i, n in enumerate(nids)}
    owned, identities, cell_keys = defaultdict(list), set(), set()
    prepared, count = [], 0
    for kind, block in blocks.items():
        if not isinstance(block, (tuple, list)) or len(block) != 2:
            raise ValueError('Require (EIDs, literal NID connectivity) blocks')
        eids, cells = map(np.asarray, block)
        width = 4 if kind == 4 else 5
        if (cells.ndim != 2 or cells.shape[1] != width or cells.dtype.kind not in 'iu'
                or eids.shape != (len(cells),) or eids.dtype.kind not in 'iu'
                or np.any(eids <= 0) or np.any(cells <= 0)
                or np.any(np.diff(np.sort(cells, axis=1), axis=1) == 0)):
            raise ValueError('Invalid cell IDs or distinct T4/P5 corner references')
        count += len(cells)
        if count > 500000:
            raise ValueError('Mixed-cell preflight exceeds cell budget')
        prepared.append((kind, eids, cells))
    if count == 0:
        raise ValueError('Require actual mixed-cell data')
    duplicate_cells = 0
    for kind, eids, cells in prepared:
        for eid, cell in zip(eids, cells):
            eid = int(eid)
            if eid in identities:
                raise ValueError('Duplicate element identity across blocks')
            identities.add(eid)
            if not all(int(n) in lookup for n in cell):
                raise ValueError('Missing literal node reference')
            key = (kind, *sorted(map(int, cell)))
            duplicate_cells += key in cell_keys
            cell_keys.add(key)
            for fi, local in enumerate(FACES[kind]):
                face = tuple(int(cell[i]) for i in local)
                owned[tuple(sorted(face))].append((eid, kind, fi, face))
    boundary, wrong, nonmanifold = [], [], []
    uncancelled_flux = 0.
    # A single common origin improves conditioning without changing a closed
    # skin's divergence flux; it also makes the diagnostic reproducible.
    try:
        with np.errstate(over='raise', invalid='raise'):
            origin = xyz.astype(float).mean(axis=0)
    except FloatingPointError as error:
        raise ValueError('Coordinate range exceeds finite flux arithmetic') from error
    def flux(face):
        try:
            with np.errstate(over='raise', invalid='raise'):
                value = _flux(np.array([xyz[lookup[n]] for n in face], float)-origin)
        except FloatingPointError as error:
            raise ValueError('Coordinate range exceeds finite flux arithmetic') from error
        if not np.isfinite(value):
            raise ValueError('Nonfinite face flux')
        return value
    for key, rows in owned.items():
        if len(rows) == 1:
            boundary.append(rows[0][3])
        elif len(rows) == 2:
            if _cycle(rows[0][3]) != _cycle(rows[1][3][::-1]):
                wrong.append(dict(nodeIDs=list(key), owners=[dict(eid=r[0], type=r[1], localFace=r[2]) for r in rows]))
                uncancelled_flux += sum(flux(r[3]) for r in rows)
        else:
            nonmanifold.append(dict(nodeIDs=list(key), owners=[r[0] for r in rows]))
            uncancelled_flux += sum(flux(r[3]) for r in rows)
    edge_owners = defaultdict(list)
    for face in boundary:
        for a, b in zip(face, face[1:]+face[:1]):
            edge_owners[tuple(sorted((a, b)))].append((a, b))
    bad_edges = sum(len(rows) != 2 or rows[0] != rows[1][::-1] for rows in edge_owners.values())
    skin_flux = sum(flux(face) for face in boundary)
    passed = not (duplicate_cells or wrong or nonmanifold or bad_edges)
    return dict(schema='mixed-t4-p5-directed-face-audit.v1', cells=count,
        cellTypes=dict(Counter(kind for kind, eids, _ in prepared for _ in eids)),
        boundaryPolygons=len(boundary), duplicateCells=int(duplicate_cells),
        misorientedInternalFaceCount=len(wrong), misorientedInternalFaces=wrong[:20],
        nonmanifoldFaceCount=len(nonmanifold), nonmanifoldFaces=nonmanifold[:20],
        badDirectedSkinEdgeCount=int(bad_edges), faceChecksPassed=bool(passed),
        directedSkinFluxVolume=float(skin_flux), internalUncancelledFlux=float(uncancelled_flux),
        summedCellFluxVolume=float(skin_flux+uncancelled_flux),
        diagnosticFluxOrigin=origin.tolist(),
        globalOverlapCertified=False, continuousJacobianCertified=False,
        engineeringQualityAccepted=False, wholeScrewAccepted=False)
