"""Source-Q4 support matching with separate, fail-closed CAD trim obligations."""
from pathlib import Path
import hashlib
import json
import math
import numpy as np
from scipy.spatial import cKDTree

from . import screw_tip_brep as cad


def _require(ok, message):
    if not ok:
        raise ValueError(message)


def _roundoff(*arrays):
    return 64*np.finfo(float).eps*max(1., *(float(np.abs(a).max()) for a in arrays))


def _frames(q):
    return [np.roll(row, i, axis=0) for row in (q, q[::-1]) for i in range(4)]


def match_supports(references, candidates):
    """Match only cyclic bilinear control nets, not arbitrary corner sets.

    The bound is fixed binary64 codec roundoff, not a configurable CAD tolerance.
    Ambiguous or missing counterparts reject; same support does NOT mean same trim.
    """
    _require(references and candidates, 'Nonempty support maps required')
    _require(len(references) <= 8192 and len(candidates) <= 16384, 'Support map count budget exceeded')
    _require(all(type(key) in (int, str) for key in references)
             and len({str(key) for key in references}) == len(references), 'Ambiguous reference identities')
    def validate(mapping):
        out = {}
        for key, value in mapping.items():
            raw = np.asarray(value)
            _require(raw.dtype.kind in 'fiu', 'Require numeric real control nets')
            q = raw.astype(float)
            _require(q.shape == (4, 3) and np.isfinite(q).all(), 'Require finite 4x3 control nets')
            _require(len({tuple(p) for p in q}) == 4, 'Collapsed support unsupported')
            out[key] = q
        return out
    refs, faces = validate(references), validate(candidates)
    ids = list(faces)
    centers = np.array([faces[i].mean(0) for i in ids])
    tree = cKDTree(centers)
    radius = _roundoff(*refs.values(), *faces.values())
    matches, used = {}, set()
    for key, q in refs.items():
        found = []
        for j in tree.query_ball_point(q.mean(0), radius*2):
            fid = ids[j]
            errors = [float(np.abs(q-frame).max()) for frame in _frames(faces[fid])]
            error = min(errors)
            if error <= _roundoff(q, faces[fid]):
                found.append((fid, errors.index(error), error))
        _require(len(found) == 1, 'Missing or ambiguous source support: '+str(key))
        fid, frame, error = found[0]
        _require(fid not in used, 'Two references resolve to the same CAD face')
        used.add(fid)
        matches[key] = dict(faceIndex=fid, cyclicFrame=frame, maximumPoleCodecDifferenceMM=error)
    return matches


def unit_square_chains(edges):
    """Certify straight PCurve controls and complete four-side interval cover.

    Each edge supplies actual endpoints and ALL polynomial/rational control
    points; nonnegative rational weights must be checked by the CAD adapter.
    Unknown curve representations are rejected by that adapter.
    """
    tol = _roundoff(np.array([1.]))
    intervals = [[] for _ in range(4)]
    for edge in edges:
        controls = np.asarray(edge['controls'], float)
        ends = np.asarray(edge['endpoints'], float)
        if (controls.ndim != 2 or controls.shape[1] != 2 or not len(controls)
                or ends.shape != (2, 2) or not np.isfinite(controls).all() or not np.isfinite(ends).all()):
            return dict(complete=False, reason='invalid-pcurve-controls')
        allpoints = np.vstack((controls, ends))
        side = [(axis, value) for axis in (0, 1) for value in (0., 1.)
                if np.all(np.abs(allpoints[:, axis]-value) <= tol)]
        if len(side) != 1:
            return dict(complete=False, reason='edge-not-on-one-source-side')
        axis, value = side[0]; other = 1-axis
        lo, hi = sorted(ends[:, other])
        if lo < -tol or hi > 1+tol or hi-lo <= tol:
            return dict(complete=False, reason='edge-interval-outside-source-side')
        if np.min(controls[:, other]) < lo-tol or np.max(controls[:, other]) > hi+tol:
            return dict(complete=False, reason='control-hull-backtracks-outside-interval')
        if abs(np.min(controls[:, other])-lo) > tol or abs(np.max(controls[:, other])-hi) > tol:
            return dict(complete=False, reason='endpoints-disagree-with-control-hull')
        differences = np.diff(controls[:, other])
        if not (np.all(differences >= -tol) or np.all(differences <= tol)):
            return dict(complete=False, reason='nonmonotone-pcurve-controls')
        intervals[axis*2+int(value)].append((float(lo), float(hi)))
    for values in intervals:
        values.sort()
        if not values or abs(values[0][0]) > tol or abs(values[-1][1]-1) > tol:
            return dict(complete=False, reason='source-side-not-covered')
        if any(abs(a[1]-b[0]) > tol for a, b in zip(values, values[1:])):
            return dict(complete=False, reason='source-side-gap-or-overlap')
    return dict(complete=True, reason=None, sideIntervals=[[list(pair) for pair in side] for side in intervals],
                requiresSplitEdgePlanning=any(len(v) > 1 for v in intervals))


def _edge_controls(k, face, edge):
    curve = k.BRep_Tool.CurveOnSurface_s(edge, face, 0., 0.)
    first, last = k.BRep_Tool.Range_s(edge, face)
    _require(math.isfinite(first) and math.isfinite(last) and first < last, 'Invalid PCurve range')
    endpoints = [[curve.Value(t).X(), curve.Value(t).Y()] for t in (first, last)]
    while curve.DynamicType().Name() == 'Geom2d_TrimmedCurve':
        curve = curve.BasisCurve()
    kind = curve.DynamicType().Name()
    if kind == 'Geom2d_Line':
        controls = endpoints
    elif kind in ('Geom2d_BSplineCurve', 'Geom2d_BezierCurve'):
        if curve.IsRational():
            _require(all(curve.Weight(i) > 0 for i in range(1, curve.NbPoles()+1)), 'Nonpositive PCurve weights')
        controls = [[curve.Pole(i).X(), curve.Pole(i).Y()] for i in range(1, curve.NbPoles()+1)]
    else:
        raise ValueError('Unsupported PCurve: '+kind)
    return dict(controls=controls, endpoints=endpoints)


def inspect_brep(path, references, *, geometry_policy):
    """Read one valid solid and return installation obligations, never mesh success.

    Reference values are authoritative ordered Q4 coordinates in world mm.
    The caller owns mesh/source provenance; this API binds the BRep and references.
    """
    from .geometry_accuracy_policy import validated_policy
    policy = validated_policy(geometry_policy)
    _require(references and len(references) <= 8192, 'Nonempty bounded reference map required')
    _require(all(type(key) in (int, str) for key in references)
             and len({str(key) for key in references}) == len(references), 'Ambiguous reference identities')
    copied = {}
    for key, value in references.items():
        q = np.asarray(value)
        _require(q.shape == (4, 3) and q.dtype.kind in 'fiu' and np.isfinite(q).all(),
                 'Require finite numeric 4x3 reference control nets')
        copied[key] = q.astype(float, copy=True)
    references = copied
    path = Path(path).resolve(strict=True)
    _require(path.is_file() and path.stat().st_size <= 16*1024**2, 'Missing or oversized BRep')
    data = path.read_bytes(); digest = hashlib.sha256(data).hexdigest()
    k = cad._kernel(); shape = k.TopoDS_Shape()
    _require(k.BRepTools.Read_s(shape, str(path), k.BRep_Builder()), 'BRep read failed')
    shape = cad._one_solid(shape)
    state, _ = cad._state(shape, policy.distance_budget_mm(critical=True))
    faces = cad._entities(shape, k.TopAbs_FACE)
    candidates = {}; excluded = []
    for i, raw in enumerate(faces):
        face = k.TopoDS.Face_s(raw); surface = k.BRep_Tool.Surface_s(face)
        if surface.DynamicType().Name() != 'Geom_BezierSurface':
            excluded.append(dict(faceIndex=i,reason='not-bilinear-Bezier-support'))
            continue
        if surface.UDegree() != 1 or surface.VDegree() != 1 or surface.IsURational() or surface.IsVRational():
            excluded.append(dict(faceIndex=i,reason='not-nonrational-degree-one-support'))
            continue
        poles = [[surface.Pole(u,v).X(), surface.Pole(u,v).Y(), surface.Pole(u,v).Z()]
                 for u,v in ((1,1),(2,1),(2,2),(1,2))]
        if len({tuple(p) for p in poles}) != 4:
            excluded.append(dict(faceIndex=i,reason='collapsed-support-not-reference-Q4'))
            continue
        candidates[i] = poles
    matched = match_supports(references, candidates)
    rows = []
    for key, row in matched.items():
        face = k.TopoDS.Face_s(faces[row['faceIndex']])
        vertices = cad._entities(face, k.TopAbs_VERTEX)
        points = np.array([[p.X(),p.Y(),p.Z()] for p in
                          (k.BRep_Tool.Pnt_s(k.TopoDS.Vertex_s(v)) for v in vertices)])
        q = np.asarray(references[key], float)
        gaps = np.linalg.norm(q[:,None,:]-points[None,:,:], axis=2).min(1)
        wires = cad._entities(face, k.TopAbs_WIRE)
        try:
            _require(len(wires) == 1, 'Multiple trim wires')
            edges = cad._entities(face, k.TopAbs_EDGE)
            chain = unit_square_chains([_edge_controls(k, face, k.TopoDS.Edge_s(e)) for e in edges])
        except ValueError as error:
            chain = dict(complete=False, reason=str(error))
        corners = bool(np.all(gaps <= _roundoff(q, points)))
        direct = corners and len(vertices) == 4 and chain['complete'] and not chain['requiresSplitEdgePlanning']
        rows.append(dict(referenceID=key, **row, vertexCount=len(vertices),
            sourceCornerToTrimVertexMaximumMM=float(gaps.max()), sourceCornersPreservedAtCodecRoundoff=corners,
            sourceSquareTrim=chain, directFourCornerInstallEligible=direct,
            action='direct-four-corner' if direct else 'explicit-trim-or-edge-chain-reconstruction-required'))
    _require(hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'BRep changed during inspection')
    return dict(schema='bilinear-interface-map.v1', brepPath=str(path), brepSHA256=digest,
        inputReferenceSHA256=hashlib.sha256(json.dumps(
            {str(key):np.asarray(value,float).tolist() for key,value in references.items()},sort_keys=True).encode()).hexdigest(),
        geometryPolicy=policy.manifest(), validSolidState=state, references=len(rows),
        matchedSupports=len(rows), physicalFaceCount=len(faces), excludedFromQ4Matching=excluded,
        directInstallCount=sum(r['directFourCornerInstallEligible'] for r in rows),
        unresolvedCount=sum(not r['directFourCornerInstallEligible'] for r in rows), interfaces=rows,
        matchingUsesCodecRoundoffNotEngineeringDistance=True, sourceOrCandidateModified=False,
        referenceSnapshotUsed=True, callerReferenceMutationMonitored=False,
        meshInstalled=False, wholeMeshAccepted=False, exact3DEdgeIdentityCertified=False,
        finalGeneratedMeshBoundaryAndJacobianChecksRequired=True,
        directEligibilityMeansTopologyPlanNotMeshAcceptance=True)
