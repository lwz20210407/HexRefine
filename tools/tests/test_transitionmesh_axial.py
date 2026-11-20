import unittest

from tools.transitionmesh_native import audit_axial_cylinder, build_axial_cylinder


class TransitionMeshAxialTests(unittest.TestCase):
    def test_axial_cylinder_has_fine_transition_coarse_regions(self):
        mesh = build_axial_cylinder(fine_segments=48, ratio=2,
                                    fine_z=3.0, transition_z=7.0,
                                    total_z=10.0)
        report = audit_axial_cylinder(mesh)
        self.assertTrue(report['ok'])
        self.assertEqual(report['fine_segments'], 48)
        self.assertEqual(report['coarse_segments'], 24)
        self.assertGreater(report['region_elements']['fine'], 0)
        self.assertGreater(report['region_elements']['transition'], 0)
        self.assertGreater(report['region_elements']['coarse'], 0)
        self.assertEqual(len(mesh['nodes']), len(set(mesh['nodes'])))


if __name__ == '__main__':
    unittest.main()
