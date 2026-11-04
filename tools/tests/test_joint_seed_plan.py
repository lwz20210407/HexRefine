from dataclasses import replace
import unittest
from tools.bolthex.joint_seed_plan import JointAxialSpec,plan_joint_axial


class JointSeedPlanningTests(unittest.TestCase):
    def test_exact_joint_matches_reference_axial_counts(self):
        result=plan_joint_axial()
        self.assertEqual(result['counts'],dict(thread=32,nut=26,shank=4,plate=2))
        self.assertEqual(result['intervals']['plates'],[[16.,20.],[20.,24.]])
        self.assertFalse(result['geometryChanged'])
        self.assertFalse(result['fullMeshVerified'])

    def test_default_preserves_dimensions_and_compensates_seeds(self):
        result=plan_joint_axial(replace(JointAxialSpec(),thread_length=16.1,nut_height=13.1,shank_length=8.2))
        self.assertEqual(result['effective'],dict(thread_length=16.1,nut_height=13.1,shank_length=8.2))
        self.assertEqual(result['seeds'],dict(axialPerPitch=20,axialPerPlate=20))
        self.assertFalse(result['geometryChanged'])
        self.assertEqual(result['counts']['thread'],161)
        self.assertEqual(result['counts']['shank'],41)
        self.assertAlmostEqual(result['headToPlateAxialGap'],.2)

    def test_dimension_snap_is_explicit_and_reports_changes(self):
        result=plan_joint_axial(replace(JointAxialSpec(),thread_length=16.1,nut_height=13.1,shank_length=8.2),'snap_dimensions')
        self.assertEqual(result['effective'],dict(thread_length=16.,nut_height=13.,shank_length=8.))
        self.assertTrue(result['geometryChanged'])
        self.assertAlmostEqual(result['dimensionChanges']['shank_length'],-.2)

    def test_fractional_alignment_does_not_allocate_an_unbounded_grid(self):
        with self.assertRaisesRegex(ValueError,'seed limit'):
            plan_joint_axial(replace(JointAxialSpec(),thread_length=16.000001))

    def test_invalid_geometry_and_counts_reject(self):
        for values in (dict(pitch=0),dict(pitch=float('nan')),dict(plate_count=True),
                       dict(nut_height=20),dict(shank_length=7),dict(axial_per_pitch=1)):
            with self.subTest(values=values),self.assertRaises(ValueError):plan_joint_axial(replace(JointAxialSpec(),**values))

    def test_zero_shank_without_plates_is_not_expanded(self):
        result=plan_joint_axial(replace(JointAxialSpec(),shank_length=0,plate_count=0))
        self.assertEqual(result['counts']['shank'],0)
        self.assertFalse(result['geometryChanged'])

    def test_unsafe_policy_and_layer_budget_reject(self):
        with self.assertRaises(ValueError):plan_joint_axial(policy='automatic_geometry_change')
        with self.assertRaisesRegex(ValueError,'layer budget'):plan_joint_axial(replace(JointAxialSpec(),layer_limit=10))

    def test_exact_layer_budget_and_separate_shank_snap(self):
        plan_joint_axial(replace(JointAxialSpec(),layer_limit=66))
        with self.assertRaises(ValueError):plan_joint_axial(replace(JointAxialSpec(),layer_limit=65))
        result=plan_joint_axial(replace(JointAxialSpec(),plate_count=0,shank_length=8.2),'snap_dimensions')
        self.assertEqual(result['counts']['shank'],4)


if __name__=='__main__':unittest.main()
