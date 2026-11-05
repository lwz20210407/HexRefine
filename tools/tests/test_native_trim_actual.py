"""Optional full saved-M6 native capture, not a product or solid certificate."""
import hashlib
import json
import os
from pathlib import Path
import unittest

from tools.bolthex import native_trim_brep as native


CAPTURE=os.environ.get('HEXREFINE_NATIVE_FULL_CAPTURE')
CONTROL=os.environ.get('HEXREFINE_NATIVE_CONVENTIONS')
EXPECTED='23cf0300af1cb9485978f1ae64b6c53b432b20550a892af6e5fb76ef6692a7b3'


@unittest.skipUnless(CAPTURE and CONTROL,'Actual full SDK capture and convention control required')
class FullSavedM6TrimTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path=Path(CAPTURE)
        cls.before=cls.path.read_bytes()
        conventions=native.load_conventions(CONTROL,source_label='actual installed HyperMesh SDK convention control')
        cls.capture=native.load_capture(cls.path,source_label='actual complete saved M6 native API HM capture',
            conventions=conventions,expected_sha256=EXPECTED)
        cls.model=native.reconstruct_trim(cls.capture)

    @classmethod
    def tearDownClass(cls):
        if cls.path.read_bytes()!=cls.before:raise AssertionError('Readonly actual capture changed')

    def test_every_actual_face_is_reconstructed_without_source_surface_substitution(self):
        r=self.model.report
        self.assertEqual(hashlib.sha256(self.before).hexdigest(),EXPECTED)
        self.assertEqual((r['nativeFaces'],r['reconstructedTrimDomains']),(94,94))
        self.assertEqual(r['unsupported'],[])
        self.assertTrue(r['completeNativeFaceCoverage'])
        self.assertFalse(r['uvRectangleUsedAsTrim'])
        self.assertFalse(r['sourceSurfaceSubstitution'])
        self.assertEqual(set(self.model.faces),set(range(94)))

    def test_actual_native_support_and_pcurve_observations_match_the_captured_math(self):
        r=self.model.report
        self.assertLessEqual(max(f['nativeSupportSampleError'] for f in r['faces']),native.MATH_LIMIT)
        self.assertLessEqual(max(f['nativePcSampleError'] for f in r['faces']),native.MATH_LIMIT)
        self.assertTrue(r['inputSampleParameterRoundoff'])
        for row in r['inputSampleParameterRoundoff']:
            self.assertFalse(row['parameterClamped'])
            a,b=row['finiteRange']
            self.assertLessEqual(min(abs(row['parameter']-a),abs(row['parameter']-b)),row['arithmeticBound'])

    def test_natural_pole_charts_do_not_invent_physical_edges(self):
        transitions=[t for f in self.model.report['faces'] for t in f['naturalPoleChartTransitions']]
        self.assertEqual(len(transitions),2)
        for t in transitions:
            self.assertFalse(t['physical3dEdgeAdded'])
            self.assertFalse(t['capturedCoedgeClaimed'])
            self.assertLessEqual(t['analyticWorldDistanceBound'],native.MATH_LIMIT)

    def test_actual_pole_queries_return_trimmed_witnesses_and_no_unreported_failures(self):
        for point in ([0.,0.,9.75],[0.,0.,8.75],[.6410906364,-2.9307000522,0.]):
            with self.subTest(point=point):
                q=self.model.query(point)
                self.assertEqual(q['queryFailures'],[])
                self.assertEqual(q['unsupportedFaceCount'],0)
                self.assertIsNotNone(q['witness'])
                self.assertLess(q['witness']['distance'],.0004)
                self.assertNotIn('certifiedGlobalNearest',q)

    def test_trim_only_coverage_never_claims_closed_solid_or_product_acceptance(self):
        self.assertFalse(self.model.report['fullModelAcceptance'])
        self.assertFalse(self.model.report['productAcceptance'])
        self.assertNotEqual(self.model.report.get('independentBrepSolidValid'),True)
        self.assertEqual(json.loads(self.before)['faceCount'],94)


if __name__=='__main__':unittest.main()
