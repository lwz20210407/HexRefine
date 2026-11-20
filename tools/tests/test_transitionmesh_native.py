import unittest

from tools.transitionmesh_native import (
    ModePlanError, angular_fit, capability, hybrid_split, plan_counts,
    plan_quad_counts, plan_transition,
)


class TransitionMeshNativeTests(unittest.TestCase):
    def test_all_five_modes_have_explicit_capability(self):
        modes = ("PLANAR", "PLANAR_ANNULAR", "PLANAR_QUAD_FOUR",
                 "ANNULAR_RADIAL", "AXIAL_SURFACE")
        for mode in modes:
            self.assertEqual(capability(mode, 2, 1)["status"], "ok")

    def test_standard_and_mixed_stage_counts(self):
        self.assertEqual(plan_counts(40, 2, 2)["counts"], [40, 20, 10])
        self.assertEqual(plan_counts(36, 2, 3)["counts"], [36, 12, 4])
        self.assertEqual(plan_quad_counts(40, 2, 2)["counts"], [40, 22, 14])
        with self.assertRaises(ModePlanError):
            plan_counts(10, 2, 2)

    def test_hybrid_requires_paired_two_to_one_groups(self):
        result = hybrid_split(80, 30)
        self.assertTrue(result["ok"])
        self.assertEqual(result["a"], 20)
        self.assertEqual(result["b"], 10)
        self.assertEqual(sum(result["ports"]), 80)
        self.assertFalse(hybrid_split(10, 3)["ok"])

    def test_mode_specific_plans(self):
        for mode in ("PLANAR", "PLANAR_ANNULAR", "PLANAR_QUAD_FOUR",
                     "ANNULAR_RADIAL", "AXIAL_SURFACE"):
            result = plan_transition(mode, 40, 2, 2, width=20.0,
                                     quad=(mode == "PLANAR_QUAD_FOUR"),
                                     seam_angles_deg=[0.0, 45.0])
            self.assertEqual(result["mode"], mode)
            self.assertEqual(result["layers"], 2)

    def test_cylinder_seam_fit_is_not_silently_accepted(self):
        result = plan_transition("AXIAL_SURFACE", 40, 2, 1,
                                 seam_angles_deg=[17.0])
        self.assertEqual(result["angular_fit"]["verdict"], "warn")

    def test_hybrid_is_planar_single_layer_only(self):
        with self.assertRaises(ModePlanError):
            plan_transition("PLANAR_ANNULAR", 80, 2, 1,
                            hybrid=True, coarse_seeds=30)
        with self.assertRaises(ModePlanError):
            plan_transition("PLANAR", 80, 2, 2,
                            hybrid=True, coarse_seeds=30)


if __name__ == "__main__":
    unittest.main()
