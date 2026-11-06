"""Independent, small real-IGES controls; no host, solver, or source STEP input."""
import copy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy
from tools.bolthex import native_iges_solid as iges_solid


CAD = importlib.util.find_spec('OCP') is not None
SCRATCH = os.environ.get('BOLTHEX_TEST_ROOT')


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def mapped(shape, kind):
    from OCP.TopExp import TopExp
    from OCP.TopTools import TopTools_IndexedMapOfShape
    result = TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(shape, kind, result)
    return [result.FindKey(i) for i in range(1, result.Extent() + 1)]


def box_faces(origin=(0., 0., 0.)):
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
    from OCP.TopAbs import TopAbs_FACE
    from OCP.gp import gp_Pnt
    return mapped(BRepPrimAPI_MakeBox(gp_Pnt(*origin), 1., 1., 1.).Shape(), TopAbs_FACE)


def write_iges(path, variant='cube'):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy, BRepBuilderAPI_MakeEdge
    from OCP.IGESControl import IGESControl_Writer
    from OCP.gp import gp_Pnt
    faces = box_faces()
    if variant == 'missing':
        faces.pop()
    elif variant == 'duplicate':
        faces.append(BRepBuilderAPI_Copy(faces[0], True, False).Shape())
    elif variant == 'extra-open':
        faces.append(box_faces((3., 0., 0.))[0])
    elif variant == 'open-only':
        faces = faces[:1]
    elif variant == 'disjoint':
        faces.extend(box_faces((3., 0., 0.)))
    elif variant != 'cube' and variant != 'loose-edge':
        raise ValueError(variant)
    writer = IGESControl_Writer('MM', 0)
    for face in faces:
        if not writer.AddShape(face):
            raise AssertionError('Independent IGES face writer failed')
    if variant == 'loose-edge':
        edge = BRepBuilderAPI_MakeEdge(gp_Pnt(4., 0., 0.), gp_Pnt(5., 0., 0.)).Edge()
        if not writer.AddShape(edge):
            raise AssertionError('Independent IGES edge writer failed')
    writer.ComputeModel()
    if not writer.Write(str(path)):
        raise AssertionError('Independent IGES writer failed')
    return len(faces)


@unittest.skipUnless(CAD and SCRATCH, 'OCCT and explicit BOLTHEX_TEST_ROOT required')
class NativeIgesSolidTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='native-iges-', dir=SCRATCH)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.hm = self.root / 'bound.hm'
        # Opaque binding evidence, deliberately not a genuine host database.
        self.hm.write_bytes(b'synthetic readonly HM binding; not native verification\n')
        self.iges = self.root / 'faces.iges'
        self.manifest = self.root / 'manifest.json'
        self.output = self.root / 'carrier'
        self.policy = CadAccuracyPolicy()
        self.doc = dict(nativeHmPath=str(self.hm), nativeHmSHA256=digest(self.hm),
                        igesPath=str(self.iges), igesSHA256='', nativeFaces=6,
                        solids=1, optimizationDisabled=True,
                        nativeVolumeBefore=1., nativeVolumeAfter=1.)

    def fixture(self, variant='cube'):
        self.doc['nativeFaces'] = write_iges(self.iges, variant)
        self.doc['igesSHA256'] = digest(self.iges)
        self.save_manifest()

    def save_manifest(self):
        self.manifest.write_text(json.dumps(self.doc), encoding='utf8')

    def construct(self, **options):
        options.setdefault('geometry_policy', self.policy)
        options.setdefault('sewing_tolerance', 1e-6)
        return iges_solid.reconstruct_iges_solid(self.manifest, self.output, **options)

    def no_certificate(self):
        self.assertFalse((self.output / 'reconstruction.json').exists())
        rejection = self.output / 'rejection.json'
        if rejection.exists():
            report = json.loads(rejection.read_text(encoding='utf8'))
            self.assertIs(report['reconstructionVerified'], False)
            self.assertIs(report['nativeHmVerified'], False)
            self.assertIs(report['productAcceptance'], False)

    def reject(self, *, preflight=False, pattern=None, **options):
        context = self.assertRaisesRegex(ValueError, pattern) if pattern else self.assertRaises(ValueError)
        with context:
            self.construct(**options)
        self.no_certificate()
        if preflight:
            self.assertFalse(self.output.exists())

    def test_real_cube_has_independent_brep_topology_mass_and_bound_report(self):
        from OCP.BRepCheck import BRepCheck_Analyzer
        from OCP.BRepGProp import BRepGProp
        from OCP.BRep import BRep_Builder, BRep_Tool
        from OCP.BRepTools import BRepTools
        from OCP.GProp import GProp_GProps
        from OCP.TopoDS import TopoDS_Shape
        from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID, TopAbs_SHELL, TopAbs_EDGE
        self.fixture()
        before = {p: p.read_bytes() for p in (self.hm, self.iges, self.manifest)}
        report = self.construct()
        saved = json.loads((self.output / 'reconstruction.json').read_text(encoding='utf8'))
        self.assertEqual(report, saved)
        for name in ('reconstructionVerified', 'supportsUnchanged', 'sourceInputsUnchanged'):
            self.assertIs(report[name], True)
        for name in ('nativeHmVerified', 'productAcceptance', 'sourceGeometryUsedInConstruction',
                     'meshUsedInConstruction', 'approximateHostVolumeUsedForAcceptance'):
            self.assertIs(report[name], False)
        carrier = self.output / report['carrierFile']
        self.assertEqual(report['carrierFile'], 'reconstructed.brep')
        self.assertEqual(report['carrierFormat'], 'occt-brep')
        self.assertNotIn('carrierStepSHA256', report)
        self.assertFalse((self.output / 'reconstructed.step').exists())
        for key, path in (('carrierBrepSHA256', carrier), ('sourceHmSHA256', self.hm),
                          ('igesSHA256', self.iges), ('manifestSHA256', self.manifest)):
            self.assertEqual(report[key], digest(path))
        self.assertEqual(report['nativeFaces'], 6)
        self.assertEqual(report['geometryAccuracyPolicy'], self.policy.manifest())
        self.assertEqual(report['sewingToleranceMM'], 1e-6)
        rows = report['faceCorrespondence']
        self.assertEqual(len(rows), 6)
        for key in ('sourceFace', 'carrierFace'):
            self.assertEqual(sorted(row[key] for row in rows), list(range(6)))
        self.assertEqual(len({row['supportSHA256'] for row in rows}), 6)
        for key in ('freeEdges', 'multipleEdges', 'deletedFaces'):
            self.assertEqual(report['sewing'][key], 0)
        shape = TopoDS_Shape()
        self.assertTrue(BRepTools.Read_s(shape, str(carrier), BRep_Builder()))
        self.assertTrue(BRepCheck_Analyzer(shape, True, False, True).IsValid())
        self.assertEqual(len(mapped(shape, TopAbs_SOLID)), 1)
        self.assertEqual(len(mapped(shape, TopAbs_FACE)), 6)
        self.assertEqual(len(mapped(shape, TopAbs_EDGE)), 12)
        shells = mapped(shape, TopAbs_SHELL)
        self.assertEqual(len(shells), 1)
        self.assertTrue(BRep_Tool.IsClosed_s(shells[0]))
        props = GProp_GProps()
        error = BRepGProp.VolumeProperties_s(shape, props, 1e-10, True, False)
        self.assertTrue(math.isfinite(error))
        self.assertLessEqual(error, 1e-10)
        self.assertAlmostEqual(props.Mass(), 1., places=11)
        for key in ('volumeIntegrations', 'readbackVolumeIntegrations'):
            self.assertGreaterEqual(len(report[key]), 2)
            for row in report[key]:
                self.assertAlmostEqual(row['volume'], props.Mass(), places=11)
                self.assertLessEqual(row['estimatedRelativeError'], row['requestedRelativeError'])
        self.assertLessEqual(report['relativeBrepRoundtripVolumeError'], report['brepRoundtripVolumeLimit'])
        for path, raw in before.items():
            self.assertEqual(path.read_bytes(), raw)
        self.assertFalse((self.output / 'rejection.json').exists())

    def test_real_invalid_face_sets_are_rejected_without_retry(self):
        from OCP.BRepBuilderAPI import BRepBuilderAPI_Sewing
        actual_perform = BRepBuilderAPI_Sewing.Perform
        for variant in ('missing', 'duplicate', 'extra-open', 'open-only', 'disjoint'):
            with self.subTest(variant=variant):
                self.output = self.root / ('reject-' + variant)
                self.fixture(variant)
                before = {p: p.read_bytes() for p in (self.hm, self.iges, self.manifest)}
                calls = []
                def perform(sewing, *args, **kwargs):
                    calls.append(sewing)
                    return actual_perform(sewing, *args, **kwargs)
                with patch.object(BRepBuilderAPI_Sewing, 'Perform', perform):
                    self.reject()
                    self.assertEqual(len(calls), 1)
                for path, raw in before.items():
                    self.assertEqual(path.read_bytes(), raw)

    def test_explicit_options_reject_before_input_or_kernel(self):
        options = [dict(sewing_tolerance=v) for v in
                   (None, True, '1e-6', 0., -1., float('nan'), float('inf'), 0.5e-7,
                    math.nextafter(self.policy.distance_budget_mm(critical=True), math.inf))]
        options += [dict(geometry_policy=v) for v in (None, {}, 'strict')]
        critical = CadAccuracyPolicy.engineering(.04, critical_target_size_mm=.0001)
        options.append(dict(geometry_policy=critical, sewing_tolerance=2e-6))
        for option in options:
            with self.subTest(option=option), patch.object(iges_solid, '_kernel',
                                                         side_effect=AssertionError('kernel before options')):
                self.reject(preflight=True, **option)
        for kwargs in ({}, {'geometry_policy': self.policy}, {'sewing_tolerance': 1e-6}):
            with self.assertRaises(TypeError):
                iges_solid.reconstruct_iges_solid(self.manifest, self.output, **kwargs)

    def test_manifest_required_fields_and_strict_values(self):
        self.fixture()
        original = dict(self.doc)
        invalid = [('nativeFaces', v) for v in (True, 0, -1, 257, 6., '6')]
        invalid += [('solids', v) for v in (True, 0, 2, 1.)]
        invalid += [('optimizationDisabled', v) for v in (False, 1, 'true')]
        invalid += [(key, v) for key in ('nativeVolumeBefore', 'nativeVolumeAfter')
                    for v in (True, 0., -1., float('nan'), float('inf'), '1', 2.)]
        invalid += [(key, '0' * 64) for key in ('nativeHmSHA256', 'igesSHA256')]
        invalid += [('sourceStepPath', 'not-permitted.step')]
        for key, value in invalid:
            with self.subTest(key=key, value=value):
                self.doc = {**original, key: value}
                self.save_manifest()
                self.reject(preflight=True)
        for key in original:
            with self.subTest(missing=key):
                self.doc = dict(original)
                del self.doc[key]
                self.save_manifest()
                self.reject(preflight=True)

    def test_invalid_json_duplicate_keys_and_manifest_byte_limit(self):
        self.fixture()
        for raw in ('{', '[]', 'null', '{"nativeFaces":6,"nativeFaces":6}', ' ' * 65537):
            with self.subTest(size=len(raw)):
                self.manifest.write_text(raw, encoding='utf8')
                self.reject(preflight=True)

    def test_hash_mismatch_after_stale_manifest_rejects(self):
        self.fixture()
        for path in (self.hm, self.iges):
            original = path.read_bytes()
            with self.subTest(path=path.name):
                path.write_bytes(original + b' changed')
                self.reject(preflight=True, pattern='hash')
                self.assertEqual(path.read_bytes(), original + b' changed')
                path.write_bytes(original)

    def test_actual_iges_face_count_must_match_manifest(self):
        self.fixture()
        self.doc['nativeFaces'] = 5
        self.save_manifest()
        self.reject(pattern='face count')

    def test_existing_output_and_missing_parent_are_not_modified(self):
        self.fixture()
        self.output.mkdir()
        self.reject(pattern='fresh output')
        sentinel = self.output / 'reconstruction.json'
        sentinel.write_bytes(b'user-owned existing output')
        with self.assertRaises(ValueError):
            self.construct()
        self.assertEqual(sentinel.read_bytes(), b'user-owned existing output')
        self.output = self.root / 'existing-file'
        self.output.write_bytes(b'keep')
        with self.assertRaises(ValueError):
            self.construct()
        self.assertEqual(self.output.read_bytes(), b'keep')
        self.output = self.root / 'absent-parent' / 'carrier'
        self.reject(preflight=True)
        self.assertFalse(self.output.parent.exists())

    def test_oversized_iges_is_rejected_using_stat_without_large_fixture(self):
        self.fixture()
        actual_stat = Path.stat
        target = self.iges.resolve()
        def oversized(path, *args, **kwargs):
            result = actual_stat(path, *args, **kwargs)
            if path == target:
                fields = list(result)
                fields[6] = 32 * 1024 * 1024 + 1
                return os.stat_result(fields)
            return result
        with patch.object(Path, 'stat', oversized):
            self.reject(preflight=True, pattern='budget')

    def test_input_mutations_during_reconstruction_do_not_receive_certificate(self):
        actual_volume = iges_solid._volume
        for name in ('hm', 'iges', 'manifest'):
            with self.subTest(input=name):
                self.fixture()
                self.output = self.root / ('mutated-' + name)
                path = getattr(self, name)
                raw = path.read_bytes()
                mutated = False
                def mutate(shape):
                    nonlocal mutated
                    result = actual_volume(shape)
                    if not mutated:
                        path.write_bytes(raw + b' ')
                        mutated = True
                    return result
                with patch.object(iges_solid, '_volume', side_effect=mutate):
                    self.reject(pattern='inputs changed')
                self.assertTrue(mutated)
                self.assertEqual(path.read_bytes(), raw + b' ')
                rejection = json.loads((self.output / 'rejection.json').read_text())
                self.assertIs(rejection['sourceInputsUnchanged'], False)
                path.write_bytes(raw)

    def test_failed_mass_and_brep_readback_never_receive_certificate(self):
        self.fixture()
        with patch.object(iges_solid, '_volume', side_effect=ValueError('mass did not converge')):
            self.reject(pattern='mass did not converge')
        self.output = self.root / 'bad-readback'
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
        from OCP.BRepTools import BRepTools
        wrong = self.root / 'wrong-volume.brep'
        self.assertTrue(BRepTools.Write_s(BRepPrimAPI_MakeBox(2., 1., 1.).Shape(), str(wrong)))
        read = BRepTools.Read_s
        with patch.object(BRepTools, 'Read_s', side_effect=lambda shape, path, builder:
                          read(shape, str(wrong), builder)):
            self.reject()

    def test_same_mass_moved_readback_cannot_reuse_verification(self):
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
        from OCP.BRepTools import BRepTools
        from OCP.gp import gp_Pnt
        self.fixture()
        moved = self.root / 'moved.brep'
        self.assertTrue(BRepTools.Write_s(BRepPrimAPI_MakeBox(gp_Pnt(5., 0., 0.), 1., 1., 1.).Shape(), str(moved)))
        read = BRepTools.Read_s
        with patch.object(BRepTools, 'Read_s', side_effect=lambda shape, path, builder:
                          read(shape, str(moved), builder)):
            self.reject()

    def test_auxiliary_iges_edge_is_counted_without_changing_physical_faces(self):
        self.fixture()
        baseline = self.construct()
        self.assertEqual(baseline['auxiliaryGeometry']['freeEdgesExcluded'], 0)
        self.fixture('loose-edge')
        self.output = self.root / 'with-auxiliary-edge'
        before = {p: p.read_bytes() for p in (self.hm, self.iges, self.manifest)}
        report = self.construct()
        self.assertIs(report['reconstructionVerified'], True)
        self.assertIs(report['nativeHmVerified'], False)
        self.assertIs(report['productAcceptance'], False)
        auxiliary = report['auxiliaryGeometry']
        self.assertEqual(auxiliary['freeEdgesExcluded'], 1)
        # Endpoints of an auxiliary edge are not standalone free vertices.
        self.assertEqual(auxiliary['freeVerticesExcluded'], 0)
        self.assertEqual(auxiliary['physicalFacesExcluded'], 0)
        self.assertIs(auxiliary['wholeIgesFileHashBound'], True)
        self.assertEqual(report['igesSHA256'], digest(self.iges))
        self.assertNotEqual(report['igesSHA256'], baseline['igesSHA256'])
        self.assertEqual(report['nativeFaces'], 6)
        self.assertEqual(report['sewing']['faces'], 6)
        self.assertEqual(report['sewing']['freeEdges'], 0)
        self.assertEqual(report['faceCorrespondence'], baseline['faceCorrespondence'])
        self.assertEqual(report['solidState'], baseline['solidState'])
        self.assertEqual(self.validate(report), self.output / 'reconstructed.brep')
        for path, raw in before.items():
            self.assertEqual(path.read_bytes(), raw)

    def validate(self, report, **options):
        options.setdefault('geometry_policy', self.policy)
        options.setdefault('sewing_tolerance', 1e-6)
        return iges_solid.validate_reconstruction(report, self.manifest, self.output, **options)

    def test_report_binding_and_structured_evidence_tampering_reject(self):
        self.fixture()
        report = self.construct()
        self.assertEqual(self.validate(report), self.output / 'reconstructed.brep')
        changes = [((key,), '0' * 64) for key in
                   ('carrierBrepSHA256', 'sourceHmSHA256', 'igesSHA256', 'manifestSHA256')]
        changes += [((key,), False) for key in
                    ('reconstructionVerified', 'sourceInputsUnchanged', 'supportsUnchanged', 'nativeTopologyReconstructed')]
        changes += [((key,), True) for key in
                    ('nativeHmVerified', 'productAcceptance', 'meshUsedInConstruction', 'sourceGeometryUsedInConstruction')]
        changes += [(('carrierFile',), '../reconstructed.brep'), (('carrierFormat',), 'step'),
                    (('nativeFaces',), 5), (('nativeFaces',), True),
                    (('geometryAccuracyPolicy',), {}), (('sewingToleranceMM',), 2e-6),
                    (('auxiliaryGeometry', 'freeEdgesExcluded'), -1),
                    (('auxiliaryGeometry', 'freeVerticesExcluded'), True),
                    (('auxiliaryGeometry', 'physicalFacesExcluded'), 1),
                    (('auxiliaryGeometry', 'wholeIgesFileHashBound'), False),
                    (('sewing', 'freeEdges'), 1), (('sewing', 'multipleEdges'), 1),
                    (('sewing', 'deletedFaces'), 1), (('sewing', 'faces'), 5),
                    (('faceCorrespondence', 0, 'sourceFace'), 1),
                    (('faceCorrespondence', 0, 'carrierFace'), report['faceCorrespondence'][1]['carrierFace']),
                    (('faceCorrespondence', 0, 'sourceFace'), True),
                    (('faceCorrespondence', 0, 'supportSHA256'), 'short'),
                    (('faceCorrespondence',), report['faceCorrespondence'][:-1]),
                    (('solidState', 'topology', 'solids'), 2),
                    (('readbackSolidState', 'topology', 'faces'), 5),
                    (('solidState', 'maximumOutputTolerance'), float('nan')),
                    (('readbackSolidState', 'maximumOutputTolerance'), .1),
                    (('volumeIntegrations', 0, 'volume'), float('nan')),
                    (('volumeIntegrations', 1, 'volume'), 2.),
                    (('readbackVolumeIntegrations', 0, 'estimatedRelativeError'), .1),
                    (('readbackVolumeIntegrations',), []),
                    (('relativeBrepRoundtripVolumeError',), .1), (('brepRoundtripVolumeLimit',), 1.)]
        for keys, value in changes:
            with self.subTest(path=keys, value=value):
                altered = copy.deepcopy(report)
                target = altered
                for key in keys[:-1]:
                    target = target[key]
                target[keys[-1]] = value
                with self.assertRaises(ValueError):
                    self.validate(altered)
        for options in (dict(sewing_tolerance=2e-6), dict(geometry_policy=CadAccuracyPolicy.engineering(.04))):
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.validate(report, **options)
        self.assertEqual(report, json.loads((self.output / 'reconstruction.json').read_text()))

    def test_validator_rejects_stale_files_without_rewriting_them(self):
        self.fixture()
        report = self.construct()
        for path in (self.hm, self.iges, self.manifest, self.output / 'reconstructed.brep'):
            with self.subTest(path=path.name):
                raw = path.read_bytes()
                path.write_bytes(raw + b' ')
                with self.assertRaises(ValueError):
                    self.validate(report)
                self.assertEqual(path.read_bytes(), raw + b' ')
                path.write_bytes(raw)
        self.assertEqual(self.validate(report), self.output / 'reconstructed.brep')

    def test_actual_brep_source_step_audit_uses_canonical_brep_evidence(self):
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
        from OCP.BRepTools import BRepTools
        from OCP.gp import gp_Pnt
        from tools.tests.test_native_cad_conditioning import TinyActualStepCarrierTests
        from tools.bolthex.native_cad_conditioning import audit_brep_carrier, carrier_acceptance
        fixture = TinyActualStepCarrierTests()
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        carrier = self.root / 'independent.brep'
        shape = BRepPrimAPI_MakeBox(gp_Pnt(-1., -1., -1.), 2., 2., 2.).Shape()
        self.assertTrue(BRepTools.Write_s(shape, str(carrier)))
        before = {p: digest(p) for p in (fixture.source, fixture.ref, carrier)}
        output = self.root / 'brep-audit.json'
        report = audit_brep_carrier(fixture.source, carrier, fixture.ref, output)
        self.assertEqual(report, json.loads(output.read_text()))
        self.assertEqual(report['carrierFormat'], 'occt-brep')
        self.assertIs(report['candidateExactBrepCheck'], True)
        self.assertIs(report['strictCarrierVerified'], True)
        self.assertTrue(carrier_acceptance(report))
        self.assertIs(report['nativeHmVerified'], False)
        self.assertIs(report['fullModelAcceptance'], False)
        self.assertEqual(report['carrierBrepSHA256'], digest(carrier))
        self.assertAlmostEqual(report['carrierBrepVolume'], 8., places=10)
        self.assertAlmostEqual(report['relativeCarrierVolumeError'], 0., places=10)
        self.assertEqual((report['candidateFaces'], report['candidateEdges']), (6, 12))
        for old in ('carrierStepSHA256', 'stepBrepVolume', 'relativeStepBrepVolumeError',
                    'strictStepCarrierVerified', 'engineeringStepCarrierVerified'):
            self.assertNotIn(old, report)
            polluted = {**report, old: True}
            self.assertFalse(carrier_acceptance(polluted))
        self.assertFalse(carrier_acceptance({**report, 'candidateExactBrepCheck': False}))
        for path, expected in before.items():
            self.assertEqual(digest(path), expected)

    def test_interrupted_success_report_write_never_publishes_certificate(self):
        self.fixture()
        actual_dump = json.dump
        interrupted = []
        def fail_certificate(value, stream, *args, **kwargs):
            if value.get('reconstructionVerified') is True:
                stream.write('{"reconstructionVerified": true,')
                stream.flush()
                interrupted.append(Path(stream.name))
                raise OSError('injected certificate write failure')
            return actual_dump(value, stream, *args, **kwargs)
        with patch.object(iges_solid.json, 'dump', side_effect=fail_certificate):
            with self.assertRaisesRegex(OSError, 'certificate write failure'):
                self.construct()
        self.assertEqual(len(interrupted), 1)
        rejection = json.loads((self.output / 'rejection.json').read_text())
        self.assertIs(rejection['reconstructionVerified'], False)
        self.assertEqual(rejection['status'], 'rejected')
        self.no_certificate()

    def test_failed_atomic_link_never_publishes_certificate(self):
        self.fixture()
        before = {p: p.read_bytes() for p in (self.hm, self.iges, self.manifest)}
        with patch.object(iges_solid.os, 'link', side_effect=OSError('injected publication failure')) as link:
            with self.assertRaisesRegex(OSError, 'publication failure'):
                self.construct()
        link.assert_called_once_with(self.output / 'reconstruction.pending.json',
                                     self.output / 'reconstruction.json')
        rejection = json.loads((self.output / 'rejection.json').read_text())
        self.assertIs(rejection['reconstructionVerified'], False)
        self.assertEqual(rejection['status'], 'rejected')
        self.no_certificate()
        for path, raw in before.items():
            self.assertEqual(path.read_bytes(), raw)


if __name__ == '__main__':
    unittest.main(verbosity=2)
