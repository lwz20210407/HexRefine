"""Independent native-input integrity regressions, not solid acceptance.

Contradictions may raise ValueError or retain trim-only geometry with explicit
failed input evidence. Missing canonical 3D proof is not itself a contradiction.
"""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

from tools.bolthex import native_trim_brep as native
from tools.tests import test_native_trim_brep as fixtures


CAD = importlib.util.find_spec('OCP') is not None
SCRATCH = os.environ.get('BOLTHEX_TEST_ROOT')


@unittest.skipUnless(CAD and SCRATCH, 'OCCT and explicit dated BOLTHEX_TEST_ROOT required')
class NativeTrimIntegrityTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(dir=SCRATCH)
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        control = self.root / 'control.json'
        control.write_text(json.dumps(fixtures.calibration()), encoding='utf-8')
        self.conventions = native.load_conventions(
            control, source_label='independent synthetic native convention control',
            expected_sha256=hashlib.sha256(control.read_bytes()).hexdigest())
        self.capture_number = 0

    def _capture_file(self, document):
        self.capture_number += 1
        path = self.root / ('capture-' + str(self.capture_number) + '.json')
        path.write_text(json.dumps(document, allow_nan=False), encoding='utf-8')
        return path

    def _load(self, path):
        return native.load_capture(
            path, source_label='independent explicitly labelled native annulus capture',
            conventions=self.conventions,
            expected_sha256=hashlib.sha256(path.read_bytes()).hexdigest())

    def _assert_no_product_acceptance(self, report):
        self.assertIs(report['fullModelAcceptance'], False)
        self.assertIs(report['productAcceptance'], False)
        for key in ('nativeHmVerified', 'closedBrepImplemented'):
            if key in report:
                self.assertIs(report[key], False)

    def _assert_contradiction_rejected(self, document, *, canonical=False):
        original = copy.deepcopy(document)
        path = self._capture_file(document)
        before = path.read_bytes()
        try:
            try:
                model = native.reconstruct_trim(self._load(path))
            except ValueError:
                return
            if model is False:
                return
            # A still-queryable trim is allowed, but generic product=False or
            # missing proof alone must not hide an explicitly contradictory input.
            report = model.report
            self.assertIs(report.get('inputEvidenceConsistent'), False)
            failures = report.get('inputEvidenceFailures')
            self.assertIsInstance(failures, list)
            self.assertGreater(len(failures), 0)
            self._assert_no_product_acceptance(report)
            if canonical:
                self.assertIsNot(report.get('canonical3dEvidenceVerified'), True)
        finally:
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(document, original)

    def test_untampered_annulus_has_real_trim_material_and_preserves_capture(self):
        document = fixtures.annulus()
        original = copy.deepcopy(document)
        path = self._capture_file(document)
        before = path.read_bytes()
        model = native.reconstruct_trim(self._load(path))
        self.assertTrue(model.report['completeNativeFaceCoverage'])
        self.assertFalse(model.report['uvRectangleUsedAsTrim'])
        self._assert_no_product_acceptance(model.report)
        self.assertAlmostEqual(model.query([0., 0., 0.])['witness']['distance'], 1.)
        self.assertLessEqual(model.query([1.5, 0., 0.])['witness']['distance'], 1e-10)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(document, original)

    def test_explicit_source_ocp_origin_conflicts_are_not_accepted_as_native_capture(self):
        conflicts = (
            dict(origin='source-OCP'),
            dict(dataOrigin='source-OCP'),
            dict(idNamespace='source-TopoDS-IsSame-zero-based'),
            dict(origin='source-OCP', dataOrigin='source-OCP',
                 idNamespace='source-TopoDS-IsSame-zero-based'),
        )
        for conflict in conflicts:
            document = fixtures.annulus()
            document.update(conflict)
            with self.subTest(conflict=conflict):
                self._assert_contradiction_rejected(document)

    def test_ordinary_endpoint_coordinate_conflict_is_not_a_verified_native_input(self):
        document = fixtures.annulus()
        vertex = document['faces'][0]['loops'][0]['coedges'][0]['vertices'][0]
        vertex['point'] = [99., 99., 99.]
        self._assert_contradiction_rejected(document)

    def test_consistent_vertex_copies_still_must_bind_actual_trim_endpoints(self):
        document = fixtures.annulus()
        vertex_id = document['faces'][0]['loops'][0]['coedges'][0]['vertices'][0]['nativeVertexId']
        changed = 0
        for face in document['faces']:
            for loop in face['loops']:
                for coedge in loop['coedges']:
                    for vertex in coedge['vertices']:
                        if vertex['nativeVertexId'] == vertex_id:
                            vertex['point'] = [99., 99., 99.]
                            changed += 1
        self.assertGreaterEqual(changed, 2)
        self._assert_contradiction_rejected(document)

    def test_changed_single_endpoint_identity_breaks_captured_id_cycle(self):
        document = fixtures.annulus()
        coedges = document['faces'][0]['loops'][0]['coedges']
        self.assertEqual(coedges[0]['vertices'][0]['nativeVertexId'],
                         coedges[-1]['vertices'][1]['nativeVertexId'])
        # IDs may be sparse: the contradiction is the broken shared identity,
        # not an assumed maximum ID or a coordinate-nearest equivalencing rule.
        coedges[0]['vertices'][0]['nativeVertexId'] = 999999
        self._assert_contradiction_rejected(document)

    def test_canonical_c3d_shift_of_one_hundred_mm_cannot_be_accepted_as_bound_evidence(self):
        document = fixtures.annulus()
        coedge = document['faces'][0]['loops'][0]['coedges'][0]
        self.assertEqual(coedge['curve3d']['type'], 1)
        frozen_trim = copy.deepcopy(coedge['onSurfaceSamples'])
        for key in ('start', 'end'):
            coedge['curve3d'][key][0] += 100.
        self.assertEqual(coedge['onSurfaceSamples'], frozen_trim)
        self._assert_contradiction_rejected(document, canonical=True)

    def test_absent_canonical_proof_preserves_honest_trim_only_coverage(self):
        document = fixtures.annulus()
        for face in document['faces']:
            for loop in face['loops']:
                for coedge in loop['coedges']:
                    coedge.pop('curve3d')
        original = copy.deepcopy(document)
        path = self._capture_file(document)
        before = path.read_bytes()
        model = native.reconstruct_trim(self._load(path))
        report = model.report
        self.assertTrue(report['completeNativeFaceCoverage'])
        self.assertIs(report.get('canonical3dEvidenceVerified'), False)
        self.assertIs(report.get('inputEvidenceConsistent'), True)
        self.assertEqual(report.get('inputEvidenceFailures'), [])
        self._assert_no_product_acceptance(report)
        self.assertAlmostEqual(model.query([0., 0., 0.])['witness']['distance'], 1.)
        self.assertLessEqual(model.query([1.5, 0., 0.])['witness']['distance'], 1e-10)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(document, original)


if __name__ == '__main__':
    unittest.main()
