"""CAD transfer policies do not redefine source identity or mesh quality."""
import math
import unittest

from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy, DISTANCE_METRICS


class GeometryAccuracyPolicyTests(unittest.TestCase):
    def test_strict_regression_limits_are_unchanged(self):
        p=CadAccuracyPolicy();limits=p.carrier_limits()
        self.assertTrue(all(limits[k]==2e-6 for k in DISTANCE_METRICS))
        self.assertEqual(limits['maximumCadBoundsDifference'],1e-5)
        self.assertEqual(limits['relativeStepBrepVolumeError'],1e-7)

    def test_engineering_budgets_are_absolute_and_relative(self):
        p=CadAccuracyPolicy.engineering(.04)
        self.assertEqual(p.distance_budget_mm(),.0004)
        self.assertEqual(p.distance_budget_mm(critical=True),.0004)
        self.assertEqual(p.distance_budget_mm(local_target_size_mm=.01),.0001)
        p=CadAccuracyPolicy.engineering(1.)
        self.assertEqual(p.distance_budget_mm(),.001)
        self.assertEqual(p.distance_budget_mm(critical=True),.0005)

    def test_critical_local_size_gap_and_root_constraints_cannot_be_masked_by_global_size(self):
        p=CadAccuracyPolicy.engineering(.5,critical_target_size_mm=.02,
            minimum_functional_gap_mm=.001,minimum_root_radius_mm=.003)
        self.assertEqual(p.distance_budget_mm(),.001)
        self.assertAlmostEqual(p.distance_budget_mm(critical=True),.00003)
        self.assertAlmostEqual(p.distance_budget_mm(critical=True,local_target_size_mm=.0001),.000001)
        fine=CadAccuracyPolicy.engineering(.5,critical_target_size_mm=.001)
        self.assertEqual(fine.distance_budget_mm(critical=True,local_target_size_mm=.5),.00001)

    def test_all_surfaces_are_conservatively_critical_by_default(self):
        p=CadAccuracyPolicy.engineering(.2)
        self.assertEqual(p.carrier_limits()['maximumSurfaceDistance'],.0005)
        self.assertEqual(p.carrier_limits(all_surfaces_critical=False)['maximumSurfaceDistance'],.001)

    def test_source_integrity_is_not_relaxed_with_engineering_geometry(self):
        p=CadAccuracyPolicy.engineering(1.)
        self.assertEqual(p.carrier_limits()['maximumSourceReferenceError'],2e-6)
        m=p.manifest()
        self.assertTrue(m['sourceMathAndMeshValidityGatesUnchanged'])
        self.assertTrue(m['numericalLimitsAreProjectChoicesNotVendorMandates'])
        self.assertFalse(m['matingContactOrManufacturingConformityCertified'])

    def test_missing_nonfinite_negative_boolean_and_wrong_units_reject(self):
        with self.assertRaises(ValueError):CadAccuracyPolicy('engineering-cad-transfer')
        with self.assertRaises(ValueError):CadAccuracyPolicy('unknown')
        with self.assertRaises(ValueError):CadAccuracyPolicy(units='in')
        with self.assertRaises(ValueError):CadAccuracyPolicy(target_size_mm=.1)
        for name in ('target_size_mm','critical_target_size_mm','minimum_functional_gap_mm','minimum_root_radius_mm'):
            for value in (0,-1,True,False,math.nan,math.inf,'0.1'):
                values=dict(target_size_mm=.1);values[name]=value
                with self.subTest(name=name,value=value),self.assertRaises(ValueError):
                    CadAccuracyPolicy('engineering-cad-transfer',**values)

    def test_query_inputs_are_not_silently_coerced(self):
        p=CadAccuracyPolicy.engineering(.1)
        with self.assertRaises(ValueError):p.distance_budget_mm(critical=1)
        with self.assertRaises(ValueError):p.carrier_limits(all_surfaces_critical='yes')
        with self.assertRaises(ValueError):p.distance_budget_mm(local_target_size_mm=0)


if __name__=='__main__':unittest.main()
