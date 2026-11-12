"""Reviewed phase Screw radial0.6..1 ring: source-derived BRep, not a mesh."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
from itertools import product
import json
import os
from pathlib import Path

import numpy as np

from . import screw_endpoint_contract as endpoint
from . import screw_tip_brep as cad
from . import native_trim_solid as solid
from .bilinear_interface_map import unit_square_chains, _edge_controls
from .geometry_accuracy_policy import CadAccuracyPolicy, validated_policy
from .mesh_audit import FACES, SIGNS
from .screw_interface import face_owners

MAX_INPUT_BYTES = 32 * 1024**2
MAX_POLICY_BYTES = 2 * 1024**2
MAX_OUTPUT_BYTES = 32 * 1024**2
MAX_BREP_BYTES = 16 * 1024**2
CONSTRUCTION_TOLERANCE_MM = 1e-7
SLICE_CODEC_RELATIVE_LIMIT = 1e-12
VOLUME_RELATIVE_LIMIT = 1e-7


def _require(ok, message):
    if not ok:
        raise ValueError(message)


def _sha(path):
    digest = hashlib.sha256()
    size = 0
    with Path(path).open('rb') as stream:
        for data in iter(lambda: stream.read(1024**2), b''):
            size += len(data)
            _require(size <= MAX_INPUT_BYTES, 'Hash input grew beyond32MiB: '+str(path))
            digest.update(data)
    return digest.hexdigest()


def _json(path, limit=MAX_INPUT_BYTES):
    def pairs(items):
        result = {}
        for key, value in items:
            _require(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result
    with Path(path).open('rb') as stream:
        data = stream.read(limit+1)
    _require(len(data) <= limit, 'JSON input grew beyond its byte limit')
    value = json.loads(data, object_pairs_hook=pairs)
    json.dumps(value, allow_nan=False)
    _require(isinstance(value, dict), 'Expected JSON object')
    return value


def _integrals(xyz, *, source_slice=False):
    result = np.zeros(len(xyz))
    minimum = float('inf')
    for u, v, w in product((-1/np.sqrt(3), 1/np.sqrt(3)), repeat=3):
        factor = .4 if source_slice else 1.
        if source_slice:
            u = .6 + .4*u
        derivative = np.column_stack((
            SIGNS[:, 0]*(1+SIGNS[:, 1]*v)*(1+SIGNS[:, 2]*w),
            SIGNS[:, 1]*(1+SIGNS[:, 0]*u)*(1+SIGNS[:, 2]*w),
            SIGNS[:, 2]*(1+SIGNS[:, 0]*u)*(1+SIGNS[:, 1]*v)))/8
        values = np.linalg.det(np.einsum('eni,nj->eij', xyz-xyz[:, :1], derivative))*factor
        result += values
        minimum = min(minimum, float(values.min()))
    return result, minimum


def _preflight(original_k, phase_k, frozen_directory, output, policy, phase_report):
    policy = validated_policy(policy)
    _require(policy.manifest() == CadAccuracyPolicy.engineering(.2).manifest(),
             'Only the approved engineering0.2/critical0.0005 policy is supported')
    original, phase, frozen = [Path(p).resolve(strict=True) for p in (original_k, phase_k, frozen_directory)]
    phase_report = Path(phase_report).resolve(strict=True) if phase_report is not None else phase.parent/'report.json'
    output = Path(output).absolute()
    _require(not output.exists() and not output.is_symlink() and output.parent.is_dir(),
             'Require a new output directory with an existing parent')
    _require(frozen.is_dir(), 'Frozen collar input must be a directory')
    roots = (original.parent, phase.parent, phase_report.parent, frozen)
    _require(not any(output.resolve().is_relative_to(p) for p in roots), 'Output must be outside immutable input bundles')
    paths = [original, phase, phase_report] + [frozen/name for name in
             ('handoff.json', 'report.json', 'composite.npz', 'node-supports.json')]
    # Complete size inventory before any hashing or parsing, including the loader's inputs.
    for path in paths:
        limit = MAX_POLICY_BYTES if path == phase_report else MAX_INPUT_BYTES
        _require(path.is_file() and 0 < path.stat().st_size <= limit, 'Missing/oversized input before hashing: '+str(path))
    hashes = {str(path): _sha(path) for path in paths}
    certificate = _json(phase_report, MAX_POLICY_BYTES)
    _require(certificate.get('geometryAccuracyPolicy') == policy.manifest(), 'Phase report policy differs from approved policy')
    _require(certificate.get('sourceSHA256') == hashes[str(original)]
             and certificate.get('outputKSHA256') == hashes[str(phase)], 'Phase report raw/phase hash mismatch')
    mesh, source, parents, child_parent, supports, loader_hashes = endpoint._load(original, phase, frozen)
    _require(all(hashes.get(path) == digest for path, digest in loader_hashes.items()), 'Loader input hash mismatch')
    return policy, output, hashes, mesh, source, parents, child_parent, supports


def _assemble(mesh, phase, parents, child_parent):
    """Pure data/ownership/integration guards; no optional CAD import."""
    _require({p['eid'] for p in parents} == set(range(2889, 5049)), 'Require all2160 reviewed BODY parents')
    coordinates = {int(n): p for n, p in zip(mesh.node_ids, mesh.nodes)}
    original_coordinates = {int(n): p for n, p in zip(phase.node_ids, phase.nodes)}
    by_eid = {int(e): i for i, e in enumerate(phase.element_ids)}
    outer_inner = {}
    for parent in parents:
        for outer, inner in zip(parent['macro'], parent['innerCoarseCorners']):
            _require(outer not in outer_inner or outer_inner[outer] == inner, 'Inconsistent ordered inner corner binding')
            outer_inner[outer] = inner
            expected = original_coordinates[outer].copy()
            expected[:2] *= .6
            _require(np.array_equal(coordinates[inner], expected), 'Frozen inner corner differs from source support')
    owners, rings, originals = defaultdict(list), [], []
    parent_by_eid = {p['eid']: p for p in parents}
    for eid in range(2889, 5049):
        original = phase.node_ids[phase.elements[by_eid[eid]]].tolist()
        nids = original.copy()
        for slot in np.flatnonzero(SIGNS[:, 0] == -1):
            opposite = SIGNS[slot].copy()
            opposite[0] = 1
            outer_slot = int(np.flatnonzero(np.all(SIGNS == opposite, axis=1))[0])
            nids[slot] = outer_inner[original[outer_slot]]
        rings.append(np.array([coordinates[n] for n in nids]))
        originals.append(phase.nodes[phase.elements[by_eid[eid]]])
        for fi, slots in enumerate(FACES, 1):
            q = [nids[i] for i in slots]
            owners[endpoint._key(q)].append(dict(eid=eid, pid=int(phase.part_ids[by_eid[eid]]), localFace=fi, nodeIDs=q))
    physical, side_pairs = [], []
    for rows in owners.values():
        _require(len(rows) in (1, 2), 'Nonmanifold ring face ownership: '+str(rows))
        if len(rows) == 2:
            _require(endpoint._cycle(rows[0]['nodeIDs']) == endpoint._cycle(rows[1]['nodeIDs'][::-1]),
                     'Internal ring side orientation mismatch: '+str(rows))
            side_pairs.append(rows)
        else:
            physical.append(rows[0])
    _require(len(side_pairs) == 4282 and len(physical) == 4396, 'Actual ring boundary counts differ')
    # face_owners uses a cyclic key; endpoint._key is an unordered key.
    phase_owners = {endpoint._key(rows[0]['nodeIDs']): rows for rows in face_owners(phase).values()}
    counts, hard = Counter(), 0
    for row in physical:
        eid, fi = row['eid'], row['localFace']
        parent = parent_by_eid[eid]
        original = phase.node_ids[phase.elements[by_eid[eid]]].tolist()
        if fi == 4:
            row['role'] = 'protected-outer-source'
            _require(row['nodeIDs'] == parent['nodeIDs'] == [original[i] for i in FACES[3]],
                     'Protected outer source binding or cycle changed: '+str(eid))
            retained = [p for p in phase_owners[endpoint._key(row['nodeIDs'])] if p['eid'] not in parent_by_eid]
            _require(retained == ([] if parent['retained'] is None else [parent['retained']]), 'Retained outer owner changed')
            if retained:
                _require(endpoint._cycle(row['nodeIDs']) == endpoint._cycle(retained[0]['nodeIDs'][::-1]), 'Retained outer opposite cycle differs')
                hard += 1
            row['retainedOwner'] = retained
        elif fi == 6:
            row['role'] = 'inner-core-interface'
            _require(endpoint._cycle(row['nodeIDs']) == endpoint._cycle(parent['innerCoarseCorners']), 'Inner ring cycle is not collar-outward')
            _require(endpoint._cycle(row['nodeIDs'][::-1]) == endpoint._cycle(parent['innerCoarseCornersCavityOutward']),
                     'Inner ring/core opposite cycle mismatch: '+str(eid))
            row['oppositeCoreNIDs'] = parent['innerCoarseCornersCavityOutward']
        else:
            row['role'] = 'annular-source-end'
            row['originalSourceNIDs'] = [original[i] for i in FACES[fi-1]]
        counts[row['role']] += 1
    _require(counts == {'protected-outer-source': 2160, 'inner-core-interface': 2160, 'annular-source-end': 76}
             and hard == 1080, 'Missing protected source/interface faces')
    physical.sort(key=lambda p: (p['eid'], p['localFace']))
    rings, originals = np.array(rings), np.array(originals)
    macro, minimum = _integrals(rings)
    restricted, restricted_min = _integrals(originals, source_slice=True)
    full, _ = _integrals(originals)
    relative = np.abs(macro-restricted)/restricted
    factor = np.abs(macro-.64*full)/(.64*full)
    maximum = 0.
    for i, param in enumerate(SIGNS):
        r = param.astype(float).copy()
        r[0] = .6 + .4*r[0]
        weights = np.prod(1+SIGNS*r, axis=1)/8
        predicted = np.einsum('n,pni->pi', weights, originals)
        maximum = max(maximum, float(np.linalg.norm(predicted-rings[:, i], axis=1).max()))
    codec = 64*np.finfo(float).eps*max(1., float(abs(rings).max()))
    _require(min(minimum, restricted_min) > 0 and np.isfinite(macro).all(), 'Nonpositive/nonfinite source-ring Gauss determinant')
    _require(maximum <= codec and relative.max() <= SLICE_CODEC_RELATIVE_LIMIT
             and factor.max() <= SLICE_CODEC_RELATIVE_LIMIT, 'Source radial-slice control net or integral mismatch')
    frozen_mask = np.isin(mesh.element_ids, list(child_parent))
    _require(frozen_mask.sum() == 15120, 'Frozen15120 child scope differs')
    transition, _ = _integrals(mesh.nodes[mesh.elements[frozen_mask]])
    integrals = dict(phaseBodyIntegral=float(full.sum()), sourceRingIntegral=float(macro.sum()),
        actualSourceRadialSliceIntegral=float(restricted.sum()), maximumParentSliceRelativeError=float(relative.max()),
        maximumParentPoint64RelativeError=float(factor.max()), phaseControlNetCodecGapMM=maximum, codecBoundMM=codec,
        minimumMacroGaussDeterminant=minimum, frozen15120Integral=float(transition.sum()),
        frozenMinusSourceRingIntegral=float(transition.sum()-macro.sum()), frozenMeshIsNotTheSourceRing=True,
        mathematicalRationalControlNetsNotClaimedIdenticalBeyondCodec=True)
    return dict(coordinates=coordinates, physical=physical, sidePairs=side_pairs, integrals=integrals)


def _face_binding_check(shape, assembly):
    """All actual poles/complete trims, not finite on-face witness sampling alone."""
    k = cad._kernel()
    faces = cad._entities(shape, k.TopAbs_FACE)
    _require(len(faces) == 4396, 'Ring physical face inventory changed')
    expected = {}
    for row in assembly['physical']:
        poles = np.array([assembly['coordinates'][n] for n in row['nodeIDs']])
        key = tuple(poles.ravel())
        _require(key not in expected, 'Duplicate source support control net')
        expected[key] = row
    bindings, used = [], set()
    for index, raw in enumerate(faces):
        face = k.TopoDS.Face_s(raw)
        surface = k.BRep_Tool.Surface_s(face)
        _require(surface.DynamicType().Name() == 'Geom_BezierSurface' and surface.UDegree() == surface.VDegree() == 1
                 and not surface.IsURational() and not surface.IsVRational(), 'Ring support no longer nonrational degree-one Bezier')
        poles = np.array([[surface.Pole(u, v).X(), surface.Pole(u, v).Y(), surface.Pole(u, v).Z()]
                          for u, v in ((1,1), (2,1), (2,2), (1,2))])
        key = tuple(poles.ravel())
        _require(key in expected and key not in used, 'Ring source corner/support changed or duplicated')
        used.add(key)
        _require(len(cad._entities(face, k.TopAbs_WIRE)) == 1, 'Ring trim has multiple wires')
        trim = unit_square_chains([_edge_controls(k, face, k.TopoDS.Edge_s(edge)) for edge in cad._entities(face, k.TopAbs_EDGE)])
        _require(trim['complete'] and not trim['requiresSplitEdgePlanning'], 'Ring complete source-square trim changed: '+str(expected[key]))
        bindings.append(dict(expected[key], ringFaceIndex=index, sourceSupportSHA256=solid._fingerprint(surface),
                             sourcePolesExactlyMatched=True, completeUnsplitSourceSquareTrim=True))
    _require(len(used) == 4396, 'Missing ring source face')
    return bindings


def _write_json(path, value):
    payload = (json.dumps(value, indent=2, allow_nan=False)+'\n').encode('utf8')
    with path.open('xb') as stream:
        stream.write(payload)
    return dict(path=path.name, bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest())


def build_source_ring(original_k, phase_k, frozen_directory, new_output, *, geometry_policy, phase_report=None):
    """One reviewed ring BRep in a fresh directory; no neck cut/whole mesh claims.

    phase_report defaults to phase_k.parent/report.json. The approved policy is
    explicit and must equal engineering(0.2). Sources and frozen files are read-only.
    """
    policy, output, hashes, mesh, phase, parents, child_parent, supports = _preflight(
        original_k, phase_k, frozen_directory, new_output, geometry_policy, phase_report)
    producer_sha = _sha(Path(__file__))
    def unchanged():
        _require(all(_sha(path) == digest for path, digest in hashes.items()), 'Ring input changed during construction/publication')
    try:
        assembly = _assemble(mesh, phase, parents, child_parent)
    finally:
        unchanged()
    output.mkdir()
    report = dict(schema='source-defined-reviewed-ring-brep.v1', ringGeometryChecksPassed=False, inputSHA256=hashes,
        phaseSHA256=phase.source_sha256, rawSHA256=hashes[str(Path(original_k).resolve())],
        geometryAccuracyPolicy=policy.manifest(), constructionToleranceMM=CONSTRUCTION_TOLERANCE_MM,
        radialInterval=[.6, 1.], sourceParents=2160, physicalFaces=4396, protectedOuterFaces=2160,
        oppositeCoreInterfaceFaces=2160, annularSourceEnds=76, actualIDInternalFacePairs=4282,
        independentDesignCAD=False, sourceMeshDefinesGeometry=True, wholeScrewAccepted=False,
        meshAccepted=False, coreMeshed=False, neckBooleanExecuted=False, engineeringGeometryAccepted=False,
        globalOverlapCertified=False, globalHausdorffCertified=False, integrals=assembly['integrals'])
    try:
        k = cad._kernel()
        faces = []
        for row in assembly['physical']:
            poles = k.TColgp_Array2OfPnt(1, 2, 1, 2)
            for uv, n in zip(((1,1), (2,1), (2,2), (1,2)), row['nodeIDs']):
                poles.SetValue(*uv, k.gp_Pnt(*assembly['coordinates'][n]))
            maker = k.BRepBuilderAPI_MakeFace(k.Geom_BezierSurface(poles), 0., 1., 0., 1., CONSTRUCTION_TOLERANCE_MM)
            _require(maker.IsDone(), 'Source ring face construction failed: '+str(row))
            faces.append(maker.Face())
        ring, sewing = cad._sew(faces, policy.distance_budget_mm(critical=True))
        report['sewing'] = sewing
        live_bindings = _face_binding_check(ring, assembly)
        # The existing readback helper keeps its stricter4MiB cap; this fixed case fits.
        cold, readback = cad._save_reopen(ring, output/'source-ring.brep', policy.distance_budget_mm(critical=True))
        _require(readback['bytes'] <= MAX_BREP_BYTES, 'Ring BRep exceeds16MiB')
        cold_bindings = _face_binding_check(cold, assembly)
        before = {(r['eid'], r['localFace']): r for r in live_bindings}
        _require(all(before[r['eid'], r['localFace']] == r for r in cold_bindings), 'Cold source face/support/trim binding changed')
        expected = assembly['integrals']['actualSourceRadialSliceIntegral']
        _require(all(abs(readback[stage]['volume']-expected)/expected <= VOLUME_RELATIVE_LIMIT for stage in ('before', 'after')),
                 'Ring BRep mass differs from actual2160 source-slice integral')
        report.update(ringGeometryChecksPassed=True, liveAndColdAll4396PolesAndTrimsMatched=True,
            sourceFilesUnchanged=True, readback=readback, outputBrepSHA256=readback['sha256'],
            outputToleranceMetadataMM=readback['after']['maximumOutputTolerance'],
            builderSHA256=producer_sha, producerFileCapturedBeforeConstruction=True, limitations=[
                'Reviewed source-derived ring only, not independent design CAD or whole Screw.',
                'The frozen15120 transition H8 mesh and this source-ring domain/volume are not identical.',
                'No neck cut, material partition acceptance, solver, K export or mesh acceptance.',
                'Codec math samples and volume agreement are not global overlap/Hausdorff certificates.'])
        bindings = _write_json(output/'source-face-bindings.json', cold_bindings)
        sides = _write_json(output/'internal-side-cycles.json', dict(internalPairs=assembly['sidePairs'],
            oppositeCyclesVerified=True, originalFENIDsMerged=False))
        report['artifacts'] = [bindings, sides, {key: readback[key] for key in ('path', 'bytes', 'sha256')}]
        _require(sum(p.stat().st_size for p in output.iterdir()) <= MAX_OUTPUT_BYTES, 'Ring output exceeds32MiB')
        pending = output/'report.pending.json'
        payload = (json.dumps(report, indent=2, allow_nan=False)+'\n').encode('utf8')
        pending_sha = hashlib.sha256(payload).hexdigest()
        with pending.open('xb') as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        unchanged()
        for artifact in report['artifacts']:
            path = output/artifact['path']
            _require(path.is_file() and not path.is_symlink() and path.stat().st_size == artifact['bytes']
                     and _sha(path) == artifact['sha256'], 'Ring artifact changed before publication: '+artifact['path'])
        _require(sum(p.stat().st_size for p in output.iterdir()) <= MAX_OUTPUT_BYTES, 'Ring report/output exceeds32MiB')
        _require(pending.is_file() and not pending.is_symlink() and pending.stat().st_size == len(payload)
                 and _sha(pending) == pending_sha, 'Pending ring report changed before publication')
        _require(_sha(Path(__file__)) == producer_sha, 'Ring producer changed before publication')
        os.link(pending, output/'report.json')
        try:
            pending.unlink()
        except OSError:
            pass
        return report
    except Exception as error:
        try:
            source_unchanged = all(_sha(path) == digest for path, digest in hashes.items())
        except (OSError, ValueError):
            source_unchanged = False
        report.update(ringGeometryChecksPassed=False, sourceFilesUnchanged=source_unchanged,
            wholeScrewAccepted=False, meshAccepted=False, engineeringGeometryAccepted=False,
            error=dict(type=type(error).__name__, message=str(error)))
        _write_json(output/'rejection.json', report)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('original_k', 'phase_k', 'frozen_directory', 'new_output'):
        parser.add_argument(name, type=Path)
    parser.add_argument('--phase-report', type=Path)
    parser.add_argument('--target-size-mm', type=float, required=True)
    args = parser.parse_args(argv)
    try:
        result = build_source_ring(args.original_k, args.phase_k, args.frozen_directory, args.new_output,
            geometry_policy=CadAccuracyPolicy.engineering(args.target_size_mm), phase_report=args.phase_report)
    except (ValueError, OSError, KeyError, TypeError, RuntimeError) as error:
        parser.exit(1, json.dumps(dict(ringGeometryChecksPassed=False, error=str(error)))+'\n')
    print(json.dumps(dict(output=str(args.new_output.absolute()), ringGeometryChecksPassed=True,
        faces=4396, volume=result['readback']['after']['volume'], brepSHA256=result['outputBrepSHA256'],
        wholeScrewAccepted=False, meshAccepted=False), indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
