"""Independent STEP-carrier measurements for native CAD conditioning trials.

No transforms, host callbacks, source repairs or approximate host masses are
used here. A passing finite audit is not a native-HM or standards certificate.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from tools.hypermesh_geometry_probe import sha, validate_reference
from tools.hypermesh_probe_reference import TrimmedFaceDistances
from .native_cad_audit import _bounds, _interior_point
from .standard_cad import _mass


LIMITS = dict(maximumSurfaceDistance=2e-6, maximumBoundaryNodeControlDistance=2e-6,
              maximumSourceFaceDistance=2e-6, maximumControlDistanceError=2e-6,
              maximumReverseDistance=2e-6, maximumReverseEdgeDistance=2e-6,
              maximumSourceReferenceError=2e-6, maximumCadBoundsDifference=1e-5,
              relativeStepBrepVolumeError=1e-7)


def _finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def step_carrier_acceptance(report):
    """Require complete evidence, raw coverage and every unchanged metric gate."""
    if (report.get('completeWitnessCoverage') is not True or report.get('sourceValid') is not True
            or report.get('candidateValid') is not True or report.get('inputsUnchanged') is not True
            or report.get('nativeApproxVolumeUsedForAcceptance') is not False
            or report.get('allCandidateFacesOwnedBySingleSolid') is not True
            or type(report.get('sourceSolids')) is not int or report['sourceSolids'] != 1
            or type(report.get('candidateSolids')) is not int or report['candidateSolids'] != 1
            or report.get('failedWitnesses')):
        return False
    for key, limit in LIMITS.items():
        value = report.get(key)
        if not _finite(value) or not 0 <= value <= limit:
            return False
    for key in ('sourceVolume', 'stepBrepVolume'):
        if not _finite(report.get(key)) or report[key] <= 0:
            return False
    if abs(abs(report['stepBrepVolume']-report['sourceVolume'])/report['sourceVolume']
           -report['relativeStepBrepVolumeError']) > 1e-12:
        return False
    forward = report.get('forward', [])
    n = report.get('referencePoints')
    if (type(n) is not int or n < 2 or len(forward) != n
            or any(type(r.get('index')) is not int for r in forward)
            or [r.get('index') for r in forward] != list(range(n))):
        return False
    for key, count_key, entity in (('sourceFaceWitnesses', 'sourceFaces', 'face'),
                                    ('reverse', 'candidateFaces', 'face'),
                                    ('edgeReverse', 'candidateEdges', 'edge')):
        count, rows = report.get(count_key), report.get(key, [])
        if (type(count) is not int or count < 1 or not rows
                or any(type(r.get(entity)) is not int for r in rows)
                or {r.get(entity) for r in rows} != set(range(count))):
            return False
        if key != 'edgeReverse' and len(rows) != count:
            return False
    near = [r for r in forward if r.get('role') == 'control' and _finite(r.get('sourceDistance'))
            and 4e-6 < r['sourceDistance'] < .001]
    nodes = [r for r in forward if r.get('role') == 'mesh-boundary-node']
    far = [r for r in forward if r.get('role') == 'control' and _finite(r.get('sourceDistance')) and r['sourceDistance'] > .02]
    if len(near) < 6 or not far or not nodes or report.get('boundaryNodeControls') != len(nodes):
        return False
    groups = [('maximumSurfaceDistance', [r for r in forward if r.get('role') != 'control'], 'candidateDistance'),
              ('maximumBoundaryNodeControlDistance', nodes, 'candidateDistance'),
              ('maximumSourceFaceDistance', report['sourceFaceWitnesses'], 'candidateDistance'),
              ('maximumReverseDistance', report['reverse'], 'sourceDistance'),
              ('maximumReverseEdgeDistance', report['edgeReverse'], 'sourceDistance')]
    for metric, rows, field in groups:
        if not rows or any(not _finite(r.get(field)) or r[field] < 0 for r in rows):
            return False
        if abs(max(r[field] for r in rows)-report[metric]) > 1e-12:
            return False
    for rows in (forward, report['sourceFaceWitnesses'], report['reverse'], report['edgeReverse']):
        for row in rows:
            p = row.get('point')
            if not isinstance(p, list) or len(p) != 3 or not all(_finite(v) for v in p):
                return False
    for r in forward:
        if (not _finite(r.get('sourceDistance')) or r['sourceDistance'] < 0
                or not _finite(r.get('referenceDistance')) or r['referenceDistance'] < 0
                or not _finite(r.get('candidateDistance')) or r['candidateDistance'] < 0):
            return False
        if r.get('role') != 'control' and r['sourceDistance'] > 2e-6:
            return False
    controls = [abs(r['candidateDistance']-r['sourceDistance']) for r in forward if r.get('role') == 'control']
    rechecks = [abs(r['referenceDistance']-r['sourceDistance']) for r in forward]
    bounds = [report.get(k) for k in ('sourceBounds', 'candidateBounds')]
    if any(not isinstance(b, list) or len(b) != 6 or not all(_finite(v) for v in b)
           or any(b[i] >= b[i+3] for i in range(3)) for b in bounds):
        return False
    if abs(max(abs(a-b) for a,b in zip(*bounds))-report['maximumCadBoundsDifference']) > 1e-12:
        return False
    return (bool(controls) and abs(max(controls)-report['maximumControlDistanceError']) <= 1e-12
            and abs(max(rechecks)-report['maximumSourceReferenceError']) <= 1e-12)


def audit_step_carrier(source_step, carrier_step, reference_file, output=None, progress=None):
    """Audit every physical face/edge plus calibrated/nodal controls, read-only.

    Missing strict-IN face witnesses are recorded and reject the carrier, but
    do not prevent collecting the remaining physical-edge negative evidence.
    """
    source_step, carrier_step, reference_file = map(lambda p: Path(p).resolve(),
                                                   (source_step, carrier_step, reference_file))
    if output is not None:
        output = Path(output).resolve()
        if output.exists() or not output.parent.is_dir():
            raise ValueError('Require a fresh audit output in an existing directory')
    for p, budget in ((source_step, 16*1024**2), (carrier_step, 64*1024**2), (reference_file, 2*1024**2)):
        if not p.is_file() or not 0 < p.stat().st_size <= budget:
            raise ValueError('Missing or oversized STEP-carrier audit input')
    hashes = {p: sha(p) for p in (source_step, carrier_step, reference_file)}
    reference = json.loads(reference_file.read_text())
    validate_reference(reference)
    if reference.get('sourceStepSHA256') != hashes[source_step]:
        raise ValueError('Source STEP/reference hash mismatch')
    near = [r for r in reference['points'] if r['role'] == 'control' and 4e-6 < r['sourceDistance'] < .001]
    if len(near) < 6 or not any(r['role'] == 'mesh-boundary-node' for r in reference['points']):
        raise ValueError('Require six calibrated near controls and actual boundary-node controls')
    from build123d import Compound, import_step
    from OCP.BRep import BRep_Builder, BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.TopoDS import TopoDS_Compound
    source, candidate = import_step(source_step), import_step(carrier_step)
    source_faces, candidate_faces = list(source.faces()), list(candidate.faces())
    if not 1 <= len(source_faces) <= 1024 or not 1 <= len(candidate_faces) <= 1024:
        raise ValueError('STEP-carrier audit requires 1..1024 faces per representation')
    def physical(faces):
        compound = TopoDS_Compound();builder = BRep_Builder();builder.MakeCompound(compound)
        for face in faces:
            builder.Add(compound, face.wrapped)
        return Compound(compound)
    # Auxiliary lines never enter physical bounds or physical-edge inventories.
    sp, cp = physical(source_faces), physical(candidate_faces)
    if not source.is_valid or not candidate.is_valid or not sp.is_valid or not cp.is_valid:
        rejected = dict(schemaVersion=1, purpose='independent-STEP-carrier-precision-audit',
            sourceStepSHA256=hashes[source_step], carrierStepSHA256=hashes[carrier_step], referenceSHA256=hashes[reference_file],
            sourceValid=bool(source.is_valid), candidateValid=bool(candidate.is_valid),
            sourcePhysicalFacesValid=bool(sp.is_valid), candidatePhysicalFacesValid=bool(cp.is_valid),
            sourceSolids=len(source.solids()), candidateSolids=len(candidate.solids()),
            sourceFaces=len(source_faces), candidateFaces=len(candidate_faces), candidateEdges=len(cp.edges()),
            preflightRejected=True, completeWitnessCoverage=False, strictStepCarrierVerified=False,
            failedWitnesses=[dict(kind='preflight-validity', index=0, detail='Invalid source/carrier or physical trimmed-face complex')],
            referencePoints=len(reference['points']), boundaryNodeControls=0, forward=[], sourceFaceWitnesses=[], reverse=[], edgeReverse=[],
            sourceVolume=None, stepBrepVolume=None, allCandidateFacesOwnedBySingleSolid=False,
            nativeApproxVolumeUsedForAcceptance=False, freeAuxiliaryCurvesExcluded=True,
            exactNativeCadCertified=False, nativeHmVerified=False, fullModelAcceptance=False,
            inputsUnchanged=all(sha(p) == h for p,h in hashes.items()), **{key: None for key in LIMITS})
        if output is not None:
            with output.open('x', encoding='utf8') as stream:
                json.dump(rejected, stream, indent=2, allow_nan=False)
        return rejected
    sd, cd = TrimmedFaceDistances(sp), TrimmedFaceDistances(cp)
    failures = []
    def attempt(kind, index, fn):
        try:
            return fn()
        except Exception as error:
            failures.append(dict(kind=kind, index=index, error=type(error).__name__, detail=str(error)))
            return None
    report = dict(schemaVersion=1, purpose='independent-STEP-carrier-precision-audit',
        sourceStepSHA256=hashes[source_step], carrierStepSHA256=hashes[carrier_step], referenceSHA256=hashes[reference_file],
        sourceValid=bool(source.is_valid), candidateValid=bool(candidate.is_valid),
        sourceSolids=len(source.solids()), candidateSolids=len(candidate.solids()),
        sourceFaces=len(source_faces), candidateFaces=len(candidate_faces), failedWitnesses=failures,
        referencePoints=len(reference['points']), nativeApproxVolumeUsedForAcceptance=False,
        freeAuxiliaryCurvesExcluded=True, exactNativeCadCertified=False, nativeHmVerified=False,
        fullModelAcceptance=False, sourceOriginCertified=False)
    solids = list(candidate.solids())
    owned = list(solids[0].faces()) if len(solids) == 1 else []
    report['allCandidateFacesOwnedBySingleSolid'] = bool(owned) and all(
        any(face.wrapped.IsSame(other.wrapped) for other in owned) for face in candidate_faces)
    report['sourceVolume'] = attempt('source-volume', 0, lambda: _mass(source))
    report['stepBrepVolume'] = attempt('step-volume', 0, lambda: _mass(solids[0])) if len(solids) == 1 else None
    forward = []
    for i, row in enumerate(reference['points']):
        p = row['point']
        values = attempt('forward', i, lambda: (sd(p), cd(p)))
        if values is not None:
            forward.append(dict(index=i, role=row['role'], point=p, referenceDistance=row['sourceDistance'],
                                sourceDistance=values[0], candidateDistance=values[1]))
        if progress is not None and i % 64 == 0:
            progress('forward', i+1, len(reference['points']))
    source_rows, reverse = [], []
    for faces, rows, name, distance in ((source_faces, source_rows, 'source-face', cd),
                                        (candidate_faces, reverse, 'candidate-face', sd)):
        for i, face in enumerate(faces):
            p = attempt(name, i, lambda: _interior_point(face))
            if p is not None:
                d = attempt(name+'-distance', i, lambda: distance(p))
                if d is not None:
                    rows.append(dict(face=i, point=p, **{'candidateDistance' if name == 'source-face' else 'sourceDistance': d}))
    edges = list(cp.edges())
    if not 1 <= len(edges) <= 2048:
        raise ValueError('STEP-carrier audit requires 1..2048 physical boundary edges')
    edge_rows = []
    for i, edge in enumerate(edges):
        def samples():
            if BRep_Tool.Degenerated_s(edge.wrapped):
                points = [[v.X, v.Y, v.Z] for v in edge.vertices()]
            else:
                c = BRepAdaptor_Curve(edge.wrapped);a,b = c.FirstParameter(), c.LastParameter()
                if not math.isfinite(a) or not math.isfinite(b):
                    raise ValueError('Unbounded physical edge')
                points = []
                for t in (0., .25, .5, .75, 1.):
                    p = c.Value(a+(b-a)*t);points.append([p.X(), p.Y(), p.Z()])
            if not points:
                raise ValueError('Physical edge has no verifiable points')
            return [dict(edge=i, point=p, sourceDistance=sd(p)) for p in points]
        measured = attempt('edge', i, samples)
        if measured is not None:
            edge_rows.extend(measured)
        if progress is not None and i % 64 == 0:
            progress('edges', i+1, len(edges))
    def maximum(rows, key):
        return max((r[key] for r in rows), default=None)
    report.update(forward=forward, sourceFaceWitnesses=source_rows, reverse=reverse, edgeReverse=edge_rows,
        candidateEdges=len(edges), boundaryNodeControls=sum(r['role'] == 'mesh-boundary-node' for r in forward),
        nearBoundaryControls=len(near), sourceBounds=_bounds(sp), candidateBounds=_bounds(cp),
        maximumSurfaceDistance=maximum([r for r in forward if r['role'] != 'control'], 'candidateDistance'),
        maximumBoundaryNodeControlDistance=maximum([r for r in forward if r['role'] == 'mesh-boundary-node'], 'candidateDistance'),
        maximumSourceFaceDistance=maximum(source_rows, 'candidateDistance'), maximumReverseDistance=maximum(reverse, 'sourceDistance'),
        maximumReverseEdgeDistance=maximum(edge_rows, 'sourceDistance'),
        maximumControlDistanceError=max((abs(r['candidateDistance']-r['sourceDistance']) for r in forward if r['role'] == 'control'), default=None),
        maximumSourceReferenceError=max((abs(r['sourceDistance']-r['referenceDistance']) for r in forward), default=None))
    report['maximumCadBoundsDifference'] = max(abs(a-b) for a,b in zip(report['sourceBounds'], report['candidateBounds']))
    sv, cv = report['sourceVolume'], report['stepBrepVolume']
    report['relativeStepBrepVolumeError'] = abs(cv-sv)/sv if sv and cv else None
    report['completeWitnessCoverage'] = (not failures and len(forward) == report['referencePoints']
        and len(source_rows) == len(source_faces) and len(reverse) == len(candidate_faces)
        and {r['edge'] for r in edge_rows} == set(range(len(edges))))
    report['inputsUnchanged'] = all(sha(p) == h for p,h in hashes.items())
    report['strictStepCarrierVerified'] = step_carrier_acceptance(report)
    if output is not None:
        with output.open('x', encoding='utf8') as stream:
            json.dump(report, stream, indent=2, allow_nan=False)
    return report


if __name__ == '__main__':
    import argparse
    import sys
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'carrier', 'reference', 'output'):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    def progress(kind, done, total):
        print(json.dumps(dict(stage=kind, done=done, total=total)), file=sys.stderr, flush=True)
    measured = audit_step_carrier(args.source, args.carrier, args.reference, args.output, progress)
    print(json.dumps({k: v for k, v in measured.items() if k not in
                      ('forward', 'sourceFaceWitnesses', 'reverse', 'edgeReverse')}, allow_nan=False))
    raise SystemExit(0 if measured['strictStepCarrierVerified'] else 2)
