"""Explicit finite engineering-budget audit of all frozen Screw end annuli.

This does not change the exact endpoint planner, source CAD, mesh or policy.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
import os
from pathlib import Path

import numpy as np

from . import screw_endpoint_contract as endpoint
from . import h8_quality_report as h8_quality
from .geometry_accuracy_policy import CadAccuracyPolicy, validated_policy
from .mesh_audit import FACES
from .screw_interface import extract_cavity, face_owners

MAX_SOURCE_BYTES = 32 * 1024**2
MAX_JSON_BYTES = 2 * 1024**2
MAX_MEASUREMENTS_BYTES = 2 * 1024**2
MAX_REPORT_BYTES = 128 * 1024
FACE_TOLERANCE_MM = 1e-9
DISTANCE_DEFLECTION_MM = 1e-12


def _require(ok, message):
    if not ok:
        raise ValueError(message)


def _check_file(path, limit):
    _require(path.is_file() and 0 < path.stat().st_size <= limit, 'Missing/oversized input: ' + str(path))


def _digest(path, limit):
    _check_file(path, limit)
    result = hashlib.sha256()
    count = 0
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            count += len(block)
            _require(count <= limit, 'Input grew beyond byte budget')
            result.update(block)
    return result.hexdigest()


def _json(path, limit):
    _check_file(path, limit)
    with path.open('rb') as stream:
        data = stream.read(limit + 1)
    _require(len(data) <= limit, 'JSON grew beyond byte budget')
    def pairs(items):
        result = {}
        for key, value in items:
            _require(key not in result, 'Duplicate JSON field')
            result[key] = value
        return result
    result = json.loads(data, object_pairs_hook=pairs)
    _require(isinstance(result, dict), 'JSON root must be an object')
    json.dumps(result, allow_nan=False)
    return result


def _unchanged(hashes, limits):
    try:
        return all(_digest(path, limits[path]) == value for path, value in hashes.items())
    except (OSError, ValueError):
        return False


def _bits(a, b):
    a, b = np.asarray(a), np.asarray(b)
    return a.dtype == b.dtype and a.shape == b.shape and a.tobytes() == b.tobytes()


def _frozen_inputs(raw_path, phase_path, folder, caps, hashes):
    mesh, phase, parents, child_parent, supports, loaded_hashes = endpoint._load(raw_path, phase_path, folder)
    _require(all(hashes[Path(p)] == value for p, value in loaded_hashes.items()), 'Frozen loader binding differs')
    raw = endpoint.collar.read_keyword(raw_path)
    _require(raw.source_sha256 == hashes[raw_path], 'Raw source changed while parsing')
    for source in (raw, phase):
        _require(_bits(mesh.nodes[:len(source.nodes)], source.nodes)
                 and _bits(mesh.node_ids[:len(source.node_ids)], source.node_ids), 'Original node rows changed')
    owners = face_owners(mesh)
    by_nodes = {tuple(sorted(key)): rows for key, rows in owners.items()}
    parent_boundary = defaultdict(list)
    for rows in owners.values():
        _require(len(rows) <= 2, 'Nonmanifold frozen face')
        for row in rows:
            parent = child_parent.get(row['eid'])
            if parent is not None and sum(child_parent.get(other['eid']) == parent for other in rows) == 1:
                parent_boundary[parent].append(row)
    sources = {'raw': raw, 'phase': phase}
    indices = {name: {int(e): i for i, e in enumerate(source.element_ids)} for name, source in sources.items()}
    hard = endpoint_hard = 0
    for parent in parents:
        if parent['retained'] is None:
            continue
        expected = parent['nodeIDs']
        for name, source in sources.items():
            actual = source.node_ids[source.elements[indices[name][parent['eid']], FACES[3]]]
            _require(endpoint._cycle(actual) == endpoint._cycle(expected), 'Protected raw/phase root binding changed')
        actual = by_nodes.get(tuple(sorted(expected)), [])
        own = [r for r in actual if r['eid'] in parent['childEids']]
        other = [r for r in actual if r['eid'] not in parent['childEids']]
        _require(len(own) == len(other) == 1 and other[0] == parent['retained'], 'Protected retained owner changed')
        _require(endpoint._cycle(own[0]['nodeIDs']) == endpoint._cycle(expected)
                 == endpoint._cycle(other[0]['nodeIDs'][::-1]), 'Protected root cycle changed')
        hard += 1
        endpoint_hard += parent['eid'] in endpoint.ENDPOINT_PARENTS
    _require((hard, endpoint_hard) == (1080, 37), 'Incomplete protected root coverage')
    actual_ends = [r['selected'] for r in extract_cavity(phase, endpoint.collar.BODY_IDS)['boundary']
                   if r['selected']['localFace'] != 4 and r['geometry']['q4Area'] > 1e-14]
    expected = {(r['eid'], r['localFace']): r for r in actual_ends}
    groups = caps['endGroups']
    _require(len(actual_ends) == len(expected) == len(groups) == 76, 'Incomplete 76 end inventory')
    seen, children = set(), set()
    parent_map = {r['eid']: r for r in parents}
    for group in groups:
        binding = group['phaseSourceEndFace']['selected']
        key = binding['eid'], binding['localFace']
        _require(key not in seen and binding == expected.get(key), 'Wrong or duplicate source end binding')
        seen.add(key)
        root = set(binding['nodeIDs']) & set(parent_map[binding['eid']]['macro'])
        _require(len(root) == 2, 'Missing actual source root edge')
        faces = [r for r in parent_boundary[binding['eid']] if all(
            {n for n, _ in supports[v][1]} <= root for v in r['nodeIDs'])]
        declared = group['collarAnnularFaceBindings']
        _require(len(faces) == len(declared) and len(faces) in (4, 5)
                 and {(r['eid'], r['localFace']): r for r in faces}
                 == {(r['eid'], r['localFace']): r for r in declared}, 'Actual annular child binding differs')
        for row in faces:
            ref = row['eid'], row['localFace']
            _require(ref not in children, 'Duplicate annular child face')
            children.add(ref)
        q = phase.nodes[phase.elements[indices['phase'][binding['eid']], FACES[binding['localFace']-1]]]
        _require(_bits(q, np.asarray(group['phaseSourceEndFaceXYZ'], dtype=float)), 'Recorded phase face coordinates differ')
        _require(group['end'] == ('lower' if q[:, 2].mean() < 6 else 'upper'), 'Wrong endpoint label')
    _require(len(children) == 308 and Counter(len(g['collarAnnularFaceBindings']) for g in groups) == {4: 72, 5: 4},
             'Incomplete 308 annular Q4 inventory')
    return mesh, sources, indices, groups


def _annulus(points):
    q = np.asarray(points, dtype=float)
    _require(q.shape == (4, 3) and np.isfinite(q).all(), 'Invalid source Q4')
    axis = [i for i, p in enumerate(q) if np.array_equal(p[:2], [0., 0.])]
    _require(len(axis) == 2, 'Source end needs two actual axis corners')
    result = q.copy()
    for i in axis:
        outer = [j for j in ((i-1) % 4, (i+1) % 4) if j not in axis and q[j, 2] == q[i, 2]]
        _require(len(outer) == 1, 'Axis corner lacks unique same-Z adjacent outer corner')
        result[i] = q[outer[0]]
        result[i, :2] *= .6
    return result


def _face(points):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.Geom import Geom_BezierSurface
    from OCP.TColgp import TColgp_Array2OfPnt
    from OCP.gp import gp_Pnt
    poles = TColgp_Array2OfPnt(1, 2, 1, 2)
    for (u, v), point in zip(((1, 1), (2, 1), (2, 2), (1, 2)), points):
        poles.SetValue(u, v, gp_Pnt(*map(float, point)))
    surface = Geom_BezierSurface(poles)
    maker = BRepBuilderAPI_MakeFace(surface, 0., 1., 0., 1., FACE_TOLERANCE_MM)
    _require(maker.IsDone(), 'Trimmed Bezier face construction failed')
    face = maker.Face()
    _require(BRepCheck_Analyzer(face, True, False, True).IsValid(), 'Invalid actual trimmed Q4')
    return face, surface


def _distance(point, boundary):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
    from OCP.BRepExtrema import BRepExtrema_DistShapeShape
    from OCP.gp import gp_Pnt
    vertex = BRepBuilderAPI_MakeVertex(gp_Pnt(*map(float, point))).Vertex()
    query = BRepExtrema_DistShapeShape(vertex, boundary, DISTANCE_DEFLECTION_MM)
    _require(query.IsDone() and query.NbSolution() > 0, 'Trimmed-boundary distance failed')
    return float(query.Value())


def _sample(surface, own_face, target, grid):
    worst = None
    for u in np.linspace(0, 1, grid):
        for v in np.linspace(0, 1, grid):
            p = surface.Value(float(u), float(v))
            point = [p.X(), p.Y(), p.Z()]
            value = _distance(point, target)
            _require(type(value) in (int, float) and math.isfinite(value) and value >= 0, 'Nonfinite/negative boundary distance')
            if worst is None or value > worst['distanceMM']:
                worst = dict(uv=[float(u), float(v)], point=point, distanceMM=value)
    residual = _distance(worst['point'], own_face)
    _require(math.isfinite(residual) and 0 <= residual <= FACE_TOLERANCE_MM, 'Sample is not on its own trimmed face')
    return dict(count=grid*grid, maximumMM=worst['distanceMM'], worst=worst, ownFaceResidualMM=residual)


def _measure(mesh, sources, indices, groups):
    from OCP.BRep import BRep_Builder
    from OCP.TopoDS import TopoDS_Compound
    coordinates = {int(n): p for n, p in zip(mesh.node_ids, mesh.nodes)}
    variants = {}
    for name, source in sources.items():
        rows = []
        for group in groups:
            binding = group['phaseSourceEndFace']['selected']
            eid, local = binding['eid'], binding['localFace']
            q = source.nodes[source.elements[indices[name][eid], FACES[local-1]]]
            annulus = _annulus(q)
            face, surface = _face(annulus)
            compound = TopoDS_Compound()
            builder = BRep_Builder()
            builder.MakeCompound(compound)
            children = []
            for child in group['collarAnnularFaceBindings']:
                actual, geometry = _face(np.asarray([coordinates[n] for n in child['nodeIDs']]))
                builder.Add(compound, actual)
                children.append(dict(binding=child, forward=_sample(geometry, actual, face, 5)))
            rows.append(dict(end=group['end'], parentEID=eid, sourceLocalFace=local,
                sourceNodeIDs=source.node_ids[source.elements[indices[name][eid], FACES[local-1]]].tolist(),
                sourceOriginalQ4=q.tolist(), sourceAnnulusQ4=annulus.tolist(),
                children=children, reverse=_sample(surface, face, compound, 9)))
        variants[name] = rows
    return variants


def _summarize(rows, budget):
    _require(len(rows) == 76 and sum(len(g['children']) for g in rows) == 308, 'Incomplete measured inventory')
    forward = [dict(parentEID=g['parentEID'], sourceLocalFace=g['sourceLocalFace'], end=g['end'],
                    childBinding=c['binding'], **c['forward']) for g in rows for c in g['children']]
    reverse = [dict(parentEID=g['parentEID'], sourceLocalFace=g['sourceLocalFace'], end=g['end'], **g['reverse']) for g in rows]
    _require(all(r['count'] == 25 for r in forward) and all(r['count'] == 81 for r in reverse), 'Missing boundary samples')
    for row in forward + reverse:
        value = row['maximumMM']
        _require(type(value) in (int, float) and math.isfinite(value) and value >= 0
                 and value == row['worst']['distanceMM'], 'Invalid measured maximum')
    fw, rv = max(forward, key=lambda r: r['maximumMM']), max(reverse, key=lambda r: r['maximumMM'])
    return dict(endGroups=76, childQ4s=308, forwardSamples=7700, reverseSamples=6156,
        forwardWorst=fw, reverseWorst=rv, maximumMM=max(fw['maximumMM'], rv['maximumMM']),
        sampledWithinBudget=max(fw['maximumMM'], rv['maximumMM']) <= budget,
        overBudgetForwardFaces=sum(r['maximumMM'] > budget for r in forward),
        overBudgetReverseAnnuli=sum(r['maximumMM'] > budget for r in reverse))


def _metric_summary(values, eids):
    values, eids = np.asarray(values), np.asarray(eids)
    finite = np.isfinite(values)
    nonpositive = finite & (values <= 0)
    return dict(finiteCount=int(finite.sum()), nonfiniteCount=int((~finite).sum()),
        finitePositiveCount=int((finite & (values > 0)).sum()), finiteNonpositiveCount=int(nonpositive.sum()),
        finiteZeroCount=int((finite & (values == 0)).sum()), finiteNegativeCount=int((finite & (values < 0)).sum()),
        finiteMinimum=float(values[finite].min()) if finite.any() else None,
        finiteMaximum=float(values[finite].max()) if finite.any() else None,
        allFinitePositive=bool(finite.all() and (values > 0).all()),
        firstFiniteNonpositiveEIDs=eids[nonpositive][:12].tolist(),
        firstNonfiniteEIDs=eids[~finite][:12].tolist())


def _retained_quality(mesh, raw, raw_sha, frozen_sha):
    """Named actual metrics; sampled Gauss positivity is not corner positivity."""
    implementation_sha = _digest(Path(h8_quality.__file__), MAX_SOURCE_BYTES)
    _require(np.array_equal(np.unique(raw.part_ids), [1]) and np.array_equal(np.unique(mesh.part_ids), [1]),
             'The frozen actual case must retain numeric PID 1')
    raw_values = h8_quality.measure_h8(raw.nodes, raw.elements)
    retained = ~np.isin(raw.element_ids, endpoint.collar.BODY_IDS)
    retained_ids = raw.element_ids[retained]
    lookup = {int(e): i for i, e in enumerate(mesh.element_ids)}
    indices = np.array([lookup[int(e)] for e in retained_ids])
    _require(len(indices) == 3968 and np.array_equal(raw.part_ids[retained], mesh.part_ids[indices])
             and np.array_equal(raw.node_ids[raw.elements[retained]], mesh.node_ids[mesh.elements[indices]]),
             'Retained head/neck/tooth connectivity or PID changed')
    frozen_values = h8_quality.measure_h8(mesh.nodes, mesh.elements[indices])
    names = ('cornerScaledJacobian', 'cornerAndCenterScaledJacobian',
             'minimumCornerDeterminant', 'minimumGaussDeterminant')
    _require(all(np.array_equal(raw_values[name][retained], frozen_values[name], equal_nan=True) for name in names),
             'Actual retained-region metric arrays changed')
    def region(values, ids, mask):
        selected = ids[mask]
        return dict(elements=len(selected), pidValues=[1],
                    elementIDsSHA256=hashlib.sha256(selected.astype('<i8').tobytes()).hexdigest(),
                    metrics={name: _metric_summary(values[name][mask], selected) for name in names})
    regions = {name: dict(eidRange=[lo, hi], **region(raw_values, raw.element_ids,
               (raw.element_ids >= lo) & (raw.element_ids <= hi)))
               for name, lo, hi in (('head', 1, 2816), ('neck', 2817, 2888), ('body', 2889, 5048), ('tooth', 5049, 6128))}
    retained_raw = {name: values[retained] for name, values in raw_values.items()}
    scopes = {}
    for name, mask in (('includingNeck3968', np.ones(len(retained_ids), dtype=bool)),
                       ('excludingNeck3896', (retained_ids < 2817) | (retained_ids > 2888))):
        scopes[name] = dict(raw=region(retained_raw, retained_ids, mask), frozen=region(frozen_values, retained_ids, mask),
                            metricArraysEqualIncludingNaNs=True, diagnosticSelectionOnlyNoElementsRemoved=True)
    _require(scopes['excludingNeck3896']['raw']['elements'] == 3896, 'Wrong retained diagnostic subset')
    _require(_digest(Path(h8_quality.__file__), MAX_SOURCE_BYTES) == implementation_sha,
             'Quality implementation changed during measurement')
    return dict(implementation='tools.bolthex.h8_quality_report.measure_h8',
        implementationSHA256=implementation_sha,
        independentlyRecomputedByThisAPI=True,
        rawSourceSHA256=raw_sha, frozenCompositeSHA256=frozen_sha,
        sourceRegions=regions, retainedScopes=scopes, retainedConnectivityAndPIDUnchanged=True,
        definitions=dict(cornerScaledJacobian='minimum det(J)/product(column norms) at 8 corners; zero denominator can yield NaN',
            cornerAndCenterScaledJacobian='minimum scaled Jacobian at 8 corners plus centre',
            minimumCornerDeterminant='minimum det(J) at 8 corners',
            minimumGaussDeterminant='minimum det(J) at 8 Gauss points; not a scaled Jacobian or determinant ratio'),
        regionClassification='EID ranges, not PID names; all actual PID values are 1',
        rawBodyReferenceOnlyNotRetained=True, nonfiniteNotCountedAsFiniteNonpositive=True,
        gaussPositivityDoesNotCertifyCornerPositivity=True, finiteSamplingOnly=True,
        solverInvalidityDetermined=False, engineeringQualityAccepted=False,
        headOrNeckShapeOrFieldsChanged=False)


def _context(frozen_report, phase_report, retained_quality, *, frozen_report_sha, phase_report_sha):
    collar = frozen_report['legacyProjectQualityAudit']
    composite = frozen_report['compositeLegacyQualityAudit']
    raw, phase = phase_report['originalIntegratedCellVolume'], phase_report['derivedIntegratedCellVolume']
    return dict(reportedContextProvenance=dict(
            kind='hash-bound legacy/frozen report context, not newly measured collar quality or whole-model volume',
            frozenReportSHA256=frozen_report_sha, phaseReportSHA256=phase_report_sha,
            collarQualityJSONPath='rawQualityMetrics',
            collarVolumeJSONPath='legacyProjectQualityAudit.integratedVolume',
            compositeVolumeJSONPath='compositeLegacyQualityAudit.integratedVolume',
            sourceVolumeJSONPaths=dict(raw='originalIntegratedCellVolume', phase='derivedIntegratedCellVolume'),
            relativeVolumeDifferences='arithmetic on reported volumes only',
            collarQualityIndependentlyRecomputed=False, wholeModelVolumeIndependentlyRecomputed=False),
        collarH8=15120, compositeCells=19088, collarIntegratedVolume=collar['integratedVolume'],
        compositeIntegratedVolume=composite['integratedVolume'], rawIntegratedVolume=raw, phaseIntegratedVolume=phase,
        relativeCompositeMinusRaw=(composite['integratedVolume']-raw)/raw,
        relativeCompositeMinusPhase=(composite['integratedVolume']-phase)/phase,
        volumeSemantics=frozen_report['volumeSemantics'], cellIntegralSumsNotUnionVolume=True,
        missingCoreNotIgnored=True, sourceDomainVolumePreserved=frozen_report['sourceDomainVolumePreserved'],
        collarQuality=frozen_report['rawQualityMetrics'], collarMinimumGaussDet=collar['minimumGaussJacobian'],
        legacyReportMinimumCornerSJ=composite['minimumCornerScaledJacobian'],
        legacyReportAxisCollapsedPositionCells=len(composite['axisCollapsedElementIDs']),
        legacyCollapsedCountIsNotAllCornerIssues=True, actualNamedQuality=retained_quality,
        coreFilled=False, globalOverlapCertified=False, wholeScrewAccepted=False)


def _encoded(data, limit):
    payload = (json.dumps(data, separators=(',', ':'), allow_nan=False) + '\n').encode('utf8')
    _require(len(payload) <= limit, 'Output JSON byte budget exceeded')
    return payload


def _write(path, payload):
    with path.open('xb') as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())


def audit_boundary_budget(raw_k, phase_k, phase_report, collar_directory, new_output, *, geometry_policy):
    """Measure all 76/308 annuli; publish only hash-bound finite-sampling evidence."""
    _require(geometry_policy is not None, 'Explicit geometry policy required')
    policy = validated_policy(geometry_policy)
    _require(policy == CadAccuracyPolicy.engineering(.2), 'Require existing declared .2 mm engineering policy')
    raw_k, phase_k, phase_report, folder = [Path(p).resolve() for p in (raw_k, phase_k, phase_report, collar_directory)]
    output = Path(new_output).absolute()
    _require(not os.path.lexists(output) and output.parent.is_dir(), 'Require fresh output directory under existing parent')
    _require(not any(output.resolve().is_relative_to(p) for p in (raw_k.parent, phase_k.parent, phase_report.parent, folder)),
             'Output must be outside immutable input bundles')
    limits = {raw_k: MAX_SOURCE_BYTES, phase_k: MAX_SOURCE_BYTES, phase_report: MAX_JSON_BYTES,
        folder/'handoff.json': MAX_JSON_BYTES, folder/'report.json': 16*1024**2,
        folder/'node-supports.json': 8*1024**2, folder/'caps.json': MAX_JSON_BYTES,
        folder/'composite.npz': MAX_SOURCE_BYTES}
    _require(len(limits) == 8, 'Input paths must be distinct')
    for path, limit in limits.items():
        _check_file(path, limit)
    hashes = {p: _digest(p, limit) for p, limit in limits.items()}
    pr = _json(phase_report, MAX_JSON_BYTES)
    _require(pr.get('geometryAccuracyPolicy') == policy.manifest()
             and pr.get('sourceSHA256') == hashes[raw_k] and pr.get('outputKSHA256') == hashes[phase_k],
             'Phase policy/source binding differs')
    handoff = _json(folder/'handoff.json', MAX_JSON_BYTES)
    for name in ('report.json', 'node-supports.json', 'caps.json', 'composite.npz'):
        _require(handoff['artifacts'][name]['sha256'] == hashes[folder/name], 'Frozen artifact hash mismatch: '+name)
    frozen_report = _json(folder/'report.json', limits[folder/'report.json'])
    caps = _json(folder/'caps.json', MAX_JSON_BYTES)
    mesh, sources, indices, groups = _frozen_inputs(raw_k, phase_k, folder, caps, hashes)
    retained_quality = _retained_quality(mesh, sources['raw'], hashes[raw_k], hashes[folder/'composite.npz'])
    context = _context(frozen_report, pr, retained_quality,
                       frozen_report_sha=hashes[folder/'report.json'], phase_report_sha=hashes[phase_report])
    _require(_unchanged(hashes, limits), 'Input changed during frozen validation')
    output.mkdir()
    report = dict(schema='screw-boundary-budget.v1', sampledBoundaryBudgetPassed=False,
        exactSourceSupportVerified=False, exactSupportTested=False, existingExactDefaultChanged=False,
        globalHausdorffCertified=False, wholeScrewAccepted=False, coreFilled=False,
        engineeringQualityAccepted=False, sourceCADOrNodesModified=False,
        geometryAccuracyPolicy=policy.manifest(), distanceBudgetMM=policy.distance_budget_mm(critical=True),
        inputSHA256={str(p): h for p, h in hashes.items()}, producerSHA256=_digest(Path(__file__), MAX_SOURCE_BYTES),
        inventory=dict(endGroups=76, distinctParents=74, childQ4s=308, retainedHardFaces=1080,
                       endpointRetainedHardFaces=37, retainedOutsideCells=3968, originalNodeRowsBitwiseUnchanged=True),
        measurement=dict(faceCreationToleranceMM=FACE_TOLERANCE_MM, distanceDeflectionMM=DISTANCE_DEFLECTION_MM,
            forwardGrid=[5, 5], reverseGrid=[9, 9], sourceRadialRestriction=[.6, 1.],
            rawAndPhaseComparedDirectly=True, errorBudgetsAddedTogether=False, boundaryCompoundNotSolid=True,
            mergeSewHealOrToleranceIncrease=False, actualTrimmedBezierFaces=True),
        wholeCollarContext=context)
    try:
        measured = _measure(mesh, sources, indices, groups)
        report['variants'] = {name: _summarize(measured[name], report['distanceBudgetMM']) for name in ('raw', 'phase')}
        payload = _encoded(measured, MAX_MEASUREMENTS_BYTES)
        artifact = dict(path='measurements.json', bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest())
        _write(output/artifact['path'], payload)
        report.update(sampledBoundaryBudgetPassed=all(v['sampledWithinBudget'] for v in report['variants'].values()),
                      measurementsArtifact=artifact, inputFilesUnchanged=True,
                      limitations=['Finite samples are not a continuous/global Hausdorff certificate.',
                          'Exact support identity is not assessed or replaced by this API.',
                          'Missing core volume, finite nonpositive corner metrics and nonfinite corner metrics are distinct unresolved diagnostics, not solver verdicts.',
                          'No K, CAD substitute, core fill, global overlap or solver certification is produced.'])
        report['status'] = 'sampled-budget-passed' if report['sampledBoundaryBudgetPassed'] else 'sampled-budget-exceeded'
        report_payload = _encoded(report, MAX_REPORT_BYTES)
        _write(output/'report.pending.json', report_payload)
        _require(_unchanged(hashes, limits), 'Input changed before publication')
        _require(_digest(Path(h8_quality.__file__), MAX_SOURCE_BYTES) == retained_quality['implementationSHA256'],
                 'Quality implementation changed before publication')
        path = output/artifact['path']
        _require(not path.is_symlink() and path.stat().st_size == artifact['bytes']
                 and _digest(path, MAX_MEASUREMENTS_BYTES) == artifact['sha256'], 'Measurement artifact changed before publication')
        pending = output/'report.pending.json'
        _require(not pending.is_symlink() and _digest(pending, MAX_REPORT_BYTES)
                 == hashlib.sha256(report_payload).hexdigest(), 'Pending report changed before publication')
        os.link(output/'report.pending.json', output/'report.json')
        try:
            (output/'report.pending.json').unlink()
        except OSError:
            pass
        return report
    except Exception as error:
        rejection = dict(schema=report['schema'], status='rejected', sampledBoundaryBudgetPassed=False,
            exactSourceSupportVerified=False, globalHausdorffCertified=False, wholeScrewAccepted=False, coreFilled=False,
            inputSHA256=report['inputSHA256'], inputFilesUnchanged=_unchanged(hashes, limits),
            error=dict(type=type(error).__name__, message=str(error)))
        _write(output/'rejection.json', _encoded(rejection, MAX_REPORT_BYTES))
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('raw_k', 'phase_k', 'phase_report', 'collar_directory', 'new_output'):
        parser.add_argument(name, type=Path)
    parser.add_argument('--target-size-mm', type=float, required=True)
    args = parser.parse_args()
    result = audit_boundary_budget(args.raw_k, args.phase_k, args.phase_report, args.collar_directory, args.new_output,
                                   geometry_policy=CadAccuracyPolicy.engineering(args.target_size_mm))
    print(json.dumps({key: result[key] for key in ('status', 'sampledBoundaryBudgetPassed', 'wholeScrewAccepted')}))
    return 0 if result['sampledBoundaryBudgetPassed'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
