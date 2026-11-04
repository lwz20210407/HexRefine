import unittest
from tools.hypermesh_geometry_probe import evaluate,evaluate_crosscheck,make_tcl,validate_reference


class NativeGeometryProbeTests(unittest.TestCase):
    reference=dict(points=[dict(point=[1,0,0],role='surface',sourceDistance=0),
                           dict(point=[0,0,1],role='control',sourceDistance=.5)])

    def test_positive_witness_and_control_do_not_claim_exact_brep_certification(self):
        result=evaluate(self.reference,'volume 1\n0 1e-8 1\n1 .5 2\ncomplete 2 failedQueries 0\n')
        self.assertTrue(result['sampledWitnessesPassed'])
        self.assertFalse(result['exactNativeCadCertified'])

    def test_small_volume_or_surface_residual_does_not_hide_failed_trim_control(self):
        result=evaluate(self.reference,'volume 1\n0 0 1\n1 0 2\ncomplete 2 failedQueries 0\n')
        self.assertFalse(result['sampledWitnessesPassed'])
        result=evaluate(self.reference,'volume 1\n0 .00003 1\n1 .5 2\ncomplete 2 failedQueries 0\n')
        self.assertEqual(result['failedSurfaceWitnesses'],1)
        self.assertFalse(result['sampledWitnessesPassed'])

    def test_missing_duplicate_or_failed_queries_are_not_accepted(self):
        for raw in ('volume 1\n0 0 1\ncomplete 2 failedQueries 0\n',
                    'volume 1\n0 0 1\n0 0 1\ncomplete 2 failedQueries 0\n',
                    'volume 1\nvolume 1\n0 0 1\n1 .5 2\ncomplete 2 failedQueries 0\n',
                    'volume 1\n0 0 1\n1 .5 2\ncomplete 2 failedQueries 1\n'):
            with self.subTest(raw=raw),self.assertRaises(ValueError):evaluate(self.reference,raw)

    def test_unwitnessed_source_and_nonfinite_coordinates_are_rejected(self):
        with self.assertRaises(ValueError):validate_reference(dict(points=self.reference['points'][:1]))
        with self.assertRaises(ValueError):validate_reference(dict(points=[dict(point=[1,float('nan'),0],role='surface',sourceDistance=0),self.reference['points'][1]]))

    def test_paths_are_encoded_not_evaluated(self):
        tcl=make_tcl('F:/case}; error injected; #.hm','F:/output.txt',self.reference)
        self.assertNotIn('error injected',tcl)
        self.assertIn('hm_findclosestpointonsurface',tcl)

    def test_query_crosscheck_cannot_choose_the_favorable_result(self):
        raw='volume 1\n0 .00003 1\ndistance 0 0 1\n1 .5 2\ndistance 1 .5 2\ncomplete 2 failedQueries 0\n'
        report=evaluate_crosscheck(self.reference,raw)
        self.assertTrue(report['distanceQuery']['sampledWitnessesPassed'])
        self.assertFalse(report['closestPointQuery']['sampledWitnessesPassed'])
        self.assertFalse(report['sampledWitnessesPassed']);self.assertFalse(report['queryAgreementPassed'])
        raw='volume 1\n0 0 1\ndistance 0 0 1\n1 .5 2\ndistance 1 0 2\ncomplete 2 failedQueries 0\n'
        report=evaluate_crosscheck(self.reference,raw)
        self.assertEqual(report['distanceQuery']['failedControls'],1)
        self.assertFalse(report['sampledWitnessesPassed'])

    def test_crosscheck_requires_complete_unique_records_from_both_methods(self):
        raw='volume 1\n0 0 1\ndistance 0 0 1\n1 .5 2\ncomplete 2 failedQueries 0\n'
        with self.assertRaises(ValueError):evaluate_crosscheck(self.reference,raw)
        with self.assertRaises(ValueError):evaluate_crosscheck(self.reference,raw.replace('distance 0 0 1','distance 0 0 1\ndistance 0 0 1'))
        good=raw.replace('1 .5 2\n','1 .5 2\ndistance 1 .5 2\n')
        self.assertTrue(evaluate_crosscheck(self.reference,good)['sampledWitnessesPassed'])
        tcl=make_tcl('F:/input.hm','F:/output.txt',self.reference,cross_check=True)
        self.assertIn('hm_getdistancefromnearestsurface',tcl)
        self.assertNotIn('@CROSSCHECK@',tcl)

    def test_missing_role_and_nonobject_rows_are_rejected(self):
        for reference in ([],dict(points=[None,self.reference['points'][1]]),
                          dict(points=[dict(point=[1,0,0],sourceDistance=0),self.reference['points'][1]])):
            with self.subTest(reference=reference),self.assertRaises(ValueError):validate_reference(reference)


if __name__=='__main__':unittest.main()
