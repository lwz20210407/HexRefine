"""Mesh-only diagnostics use exported EIDs and never require a solver."""
import unittest
import numpy as np
from tools.bolthex.native_joint import build_native_joint


class NativeJointQualityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.result=build_native_joint()

    def test_overall_and_part_counts_cover_the_same_complete_mesh(self):
        r=self.result;d=r['report']['qualityDiagnostics']
        self.assertEqual(d['overall']['elements'],len(r['elements']))
        self.assertEqual(sum(x['metrics']['elements'] for x in d['regions']),len(r['elements']))
        self.assertEqual({x['partId'] for x in d['regions']},set(map(int,np.unique(r['partIds']))))
        self.assertEqual(d['regionKey'],'partId')

    def test_reported_lowest_ids_are_global_and_belong_to_the_named_part(self):
        r=self.result
        for region in r['report']['qualityDiagnostics']['regions']:
            self.assertEqual(region['elementIDSpace'],'global exported K/merged INP')
            for metric in region['metrics']['metrics'].values():
                for eid in metric['lowestElementIDs']+metric['highestElementIDs']:
                    self.assertGreaterEqual(eid,1);self.assertLessEqual(eid,len(r['elements']))
                    self.assertEqual(int(r['partIds'][eid-1]),region['partId'])

    def test_no_solver_or_unclassified_focus_region_claims(self):
        d=self.result['report']['qualityDiagnostics']
        self.assertFalse(d['solverVerificationRequiredForMeshGeneration'])
        self.assertFalse(d['engineeringAnalysisVerified'])
        self.assertFalse(d['focusAndTransitionRegionsSeparatelyClassified'])
        for metrics in [d['overall'],*[r['metrics'] for r in d['regions']]]:
            self.assertFalse(metrics['engineeringQualityAccepted'])
            self.assertFalse(metrics['solverQualityVerified'])
            self.assertFalse(metrics['historicalProjectScreen']['officialVendorStandard'])

    def test_named_metrics_match_existing_geometry_audit_without_threshold_translation(self):
        report=self.result['report'];m=report['qualityDiagnostics']['overall']['metrics']
        self.assertAlmostEqual(m['cornerScaledJacobian']['minimum'],report['quality']['minimumCornerScaledJacobian'])
        self.assertAlmostEqual(m['cornerAndCenterScaledJacobian']['minimum'],report['quality']['minimumCornerAndCenterScaledJacobian'])
        self.assertIn('positiveGaussDetRatio',m);self.assertIn('positiveCornerDetRatio',m)


if __name__=='__main__':unittest.main()
