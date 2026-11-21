import unittest

from tools.transitionmesh_native import audit_axial_cylinder, build_axial_cylinder
from tools.transitionmesh_native import TemplateError


class TransitionMeshAxialTests(unittest.TestCase):
    def test_axial_cylinder_has_fine_transition_coarse_regions(self):
        mesh = build_axial_cylinder(fine_segments=48, ratio=2,
                                    fine_z=3.0, transition_z=7.0,
                                    total_z=10.0)
        report = audit_axial_cylinder(mesh)
        self.assertTrue(report['ok'])
        self.assertEqual(report['fine_segments'], 48)
        self.assertEqual(report['coarse_segments'], 24)
        self.assertEqual(report['region_elements']['transition'], 192)
        self.assertEqual(report['interface_faces'], [96, 48])
        self.assertGreater(report['min_gauss_jacobian'], 0)
        self.assertGreater(report['region_elements']['fine'], 0)
        self.assertGreater(report['region_elements']['transition'], 0)
        self.assertGreater(report['region_elements']['coarse'], 0)
        self.assertEqual(len(mesh['nodes']), len(set(mesh['nodes'])))
        self.assertGreater(report['min_center_jacobian'], 0.0)
        self.assertEqual(report['max_face_incidence'], 2)
        self.assertGreater(report['internal_faces'], 0)

    def test_axial_three_to_one_matches_author_mode_contract(self):
        mesh = build_axial_cylinder(fine_segments=180, ratio=3,
                                    fine_z=3.0, transition_z=7.0,
                                    total_z=10.0, regular_layers=4,
                                    radial_layers=2)
        report = audit_axial_cylinder(mesh)
        self.assertEqual(report['fine_segments'], 180)
        self.assertEqual(report['coarse_segments'], 60)
        self.assertEqual(report['region_elements']['transition'], 480)
        self.assertGreater(report['min_center_jacobian'], 0.0)
        self.assertEqual(report['max_face_incidence'], 2)

    def test_deleted_cell_is_not_mistaken_for_conforming_boundary(self):
        mesh = build_axial_cylinder(16, regular_layers=2)
        del mesh['elements'][6]
        del mesh['regions'][6]
        with self.assertRaisesRegex(TemplateError, 'Unmatched internal face'):
            audit_axial_cylinder(mesh)


if __name__ == '__main__':
    unittest.main()
