"""Explicit coincident-face compensation; no distance weld or mesh-quality claim."""
from dataclasses import replace
import hashlib
import numpy as np

from .mesh_audit import FACES
from .screw_interface import face_owners, _face_key


def _require(ok, message):
    if not ok:
        raise ValueError(message)


def _cycle(values):
    values = tuple(values)
    return min(values[i:]+values[:i] for i in range(len(values)))


def compensate_faces(mesh, face_pairs, *, allowed_element_ids):
    """Join explicitly paired Q4s, changing references only in the allowed scope.

    A face binding is (EID, one-based local face). Node coordinates must agree
    numerically exactly, not merely be near. All coordinate rows stay untouched.
    The result checks face incidence, NOT continuous Jacobians or global links.
    """
    _require(mesh.nodes.ndim == 2 and mesh.nodes.shape[1] == 3
             and mesh.nodes.dtype.kind in 'fiu', 'Require real Nx3 coordinates')
    _require(mesh.elements.ndim == 2 and mesh.elements.shape[1] == 8
             and mesh.elements.dtype.kind in 'iu'
             and len(mesh.elements) > 0 and mesh.elements.min() >= 0
             and mesh.elements.max() < len(mesh.nodes), 'Invalid H8 connectivity')
    _require(mesh.node_ids.shape == (len(mesh.nodes),) and mesh.node_ids.dtype.kind in 'iu'
             and mesh.element_ids.shape == mesh.part_ids.shape == (len(mesh.elements),)
             and mesh.element_ids.dtype.kind in 'iu' and mesh.part_ids.dtype.kind in 'iu'
             and mesh.node_ids.min() > 0 and mesh.element_ids.min() > 0 and mesh.part_ids.min() > 0,
             'Identity array dimensions differ')
    allowed = set(allowed_element_ids)
    _require(allowed and all(type(e) is int for e in allowed), 'Explicit integer scope required')
    index = {int(e): i for i, e in enumerate(mesh.element_ids)}
    _require(allowed <= index.keys(), 'Unknown allowed element')
    _require(face_pairs and len(face_pairs) <= 256, 'Require 1..256 explicit face pairs')
    _require(len(index) == len(mesh.elements) and len(set(map(int, mesh.node_ids))) == len(mesh.nodes),
             'Duplicate source identities')
    _require(np.isfinite(mesh.nodes).all(), 'Nonfinite coordinates')
    node_index = {int(n): i for i, n in enumerate(mesh.node_ids)}
    parent = {}

    def find(n):
        parent.setdefault(n, n)
        while parent[n] != n:
            parent[n] = parent[parent[n]]
            n = parent[n]
        return n

    def bind(binding):
        _require(len(binding) == 2 and all(type(x) is int for x in binding), 'Invalid face binding')
        eid, face = binding
        _require(eid in allowed and 1 <= face <= 6, 'Face outside explicit scope')
        return tuple(map(int, mesh.node_ids[mesh.elements[index[eid], FACES[face-1]]]))

    bindings, seen = [], set()
    for a, b in face_pairs:
        _require(tuple(a) != tuple(b), 'Cannot pair a face with itself')
        for binding in (a, b):
            _require(tuple(binding) not in seen, 'Repeated face binding')
            seen.add(tuple(binding))
        na, nb = bind(a), bind(b)
        pa = [tuple(mesh.nodes[node_index[n]]) for n in na]
        pb = [tuple(mesh.nodes[node_index[n]]) for n in nb]
        _require(len(set(pa)) == len(set(pb)) == 4, 'Degenerate physical Q4 unsupported')
        _require(_cycle(pa) == _cycle(pb[::-1]), 'Faces are not exact opposite geometric cycles')
        for n, point in zip(na, pa):
            other = nb[pb.index(point)]
            x, y = find(n), find(other)
            parent[max(x, y)] = min(x, y)
        bindings.append((na, nb))

    groups = {}
    for n in parent:
        groups.setdefault(find(n), []).append(n)
    protected_rows = np.array([int(e) not in allowed for e in mesh.element_ids])
    protected_nodes = set(map(int, mesh.node_ids[mesh.elements[protected_rows]].flat))
    aliases = {}
    for members in groups.values():
        fixed = protected_nodes & set(members)
        _require(len(fixed) <= 1, 'Both equivalent nodes are used by protected elements')
        master = next(iter(fixed)) if fixed else min(members)
        aliases.update({n: master for n in members if n != master})
    remap = np.arange(len(mesh.nodes))
    for slave, master in aliases.items():
        _require(np.array_equal(mesh.nodes[node_index[slave]], mesh.nodes[node_index[master]]),
                 'Node equivalence is not exact')
        remap[node_index[slave]] = node_index[master]
    elements = remap[mesh.elements]
    changed = np.any(elements != mesh.elements, axis=1)
    changed_ids = set(map(int, mesh.element_ids[changed]))
    _require(changed_ids <= allowed, 'Compensation reaches protected elements')
    _require(all(len(set(row)) == 8 for row in elements[changed]), 'Compensation collapses an H8 connectivity')
    _require(np.array_equal(mesh.nodes[elements], mesh.nodes[mesh.elements]), 'Element geometry changed')
    result = replace(mesh, nodes=mesh.nodes.copy(), node_ids=mesh.node_ids.copy(),
                     elements=elements, element_ids=mesh.element_ids.copy(), part_ids=mesh.part_ids.copy(),
                     element_cards=dict(mesh.element_cards))
    before, after = face_owners(mesh), face_owners(result)
    _require(all(len(rows) <= 2 for rows in after.values()), 'Nonmanifold face after compensation')
    def read(row, target):
        return tuple(map(int, target.node_ids[target.elements[index[row['eid']], FACES[row['localFace']-1]]]))
    def opposite(rows):
        return _cycle(read(rows[0], result)) == _cycle(read(rows[1], result)[::-1])
    for rows in before.values():
        if len(rows) == 2:
            keys = [tuple(sorted(read(row, result))) for row in rows]
            _require(keys[0] == keys[1], 'Existing shared face was broken')
    for rows in after.values():
        if len(rows) == 2:
            _require(opposite(rows), 'Shared face orientation mismatch')
    for na, nb in bindings:
        aa = tuple(aliases.get(n, n) for n in na)
        bb = tuple(aliases.get(n, n) for n in nb)
        _require(_cycle(aa) == _cycle(bb[::-1]) and len(after[_face_key(list(aa))]) == 2,
                 'Requested face pair did not close completely')
    _require(np.array_equal(elements[protected_rows], mesh.elements[protected_rows]), 'Protected connectivity changed')
    report = dict(schema='exact-face-compensation.v1',
        aliases=[dict(slave=n, master=m) for n, m in sorted(aliases.items())],
        allowedElementIDs=sorted(allowed), changedElementIDs=sorted(changed_ids),
        changedSlots=int(np.count_nonzero(elements != mesh.elements)),
        pairedFaces=len(bindings), coordinatesUnchanged=True, elementGeometryExactlyEqual=True,
        protectedConnectivityUnchanged=True, elementIDsAndPIDUnchanged=True,
        nodeCoordinateSHA256=hashlib.sha256(mesh.nodes.tobytes()).hexdigest(),
        faceIncidenceChecked=True, allExistingSharedFacesPreserved=True,
        facePairsBefore=sum(len(v) == 2 for v in before.values()),
        facePairsAfter=sum(len(v) == 2 for v in after.values()),
        distanceToleranceUsed=False, globalNodeWeld=False, globalManifoldCertified=False,
        continuousJacobianCertified=False, wholeMeshAccepted=False)
    return result, report
