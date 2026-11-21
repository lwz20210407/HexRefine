import unittest
from collections import Counter

from tools.transitionmesh_native import (
    TemplateError, audit_axial_cylinder, build_annular_band, build_axial_cylinder,
    build_planar_band, build_radial_band, build_rectangular_ring,
)


class TransitionMeshMultistageTests(unittest.TestCase):
    def test_axial_cascades_match_stage_interface_counts(self):
        for ratio, counts, widths, expected in (
                (2, [48, 24, 12], [2, 4], [144, 72]),
                (3, [54, 18, 6], [1.5, 4.5], [144, 48])):
            mesh = build_axial_cylinder(counts[0], ratio, 2, 8, 12, 4, 7, 2, 2, 1,
                                        stages=2, stage_widths=widths)
            audit = audit_axial_cylinder(mesh)
            self.assertEqual(audit['stage_counts'], counts)
            self.assertEqual(audit['stage_z'], [2, 2+widths[0], 8])
            self.assertEqual(audit['interface_faces'], [2*n for n in counts])
            self.assertEqual([audit['region_elements']['transition_%d' % i]
                              for i in (1,2)], expected)
            self.assertGreater(audit['min_gauss_jacobian'], 0)
            self.assertTrue(all(min(row.values()) > 0
                                for row in audit['region_min_jacobians'].values()))

    def test_invalid_second_stage_does_not_fall_back(self):
        with self.assertRaises(TemplateError):
            build_axial_cylinder(20, 2, stages=2)
        with self.assertRaises(TemplateError):
            build_axial_cylinder(48, 2, stages=2, stage_widths=[1, 2])
        with self.assertRaises(TemplateError):
            build_radial_band([4,6,5], 48, 2, 12, 2)

    def test_other_modes_have_real_second_band(self):
        planar = build_planar_band(12,6,24,stages=2)
        self.assertEqual(planar['stage_counts'], [24,12,6])
        edges = Counter(tuple(sorted((c[i-1],c[i]))) for c in planar['elements'] for i in range(4))
        middle = [n for (a,b),n in edges.items()
                  if all(planar['nodes'][p-1][1] == 2 for p in (a,b))]
        self.assertEqual(middle, [2]*12)
        annular = build_annular_band(7,4,48,2,stages=2)
        self.assertEqual(annular['stage_levels'], [7,6,4])
        self.assertEqual(len(annular['elements']),108)
        radial = build_radial_band([4,5,7],64,2,12,2)
        self.assertEqual(radial['stage_counts'], [64,32,16])
        self.assertEqual(len(radial['elements']), 288)
        rect2 = build_rectangular_ring(4,3,16,12,stages=2)
        self.assertEqual(rect2['stage_counts'], [(16,12),(10,8),(8,6)])
        self.assertEqual(rect2['collars'][0]['counts'], (12,8))
        self.assertEqual(len(rect2['elements']), 184)
        rect3 = build_rectangular_ring(4,3,18,18,stages=2,ratio=3)
        self.assertEqual(rect3['stage_counts'], [(18,18),(8,8),(4,4)])
        self.assertEqual(len(rect3['elements']), 140)

    def test_three_stage_geometry_has_no_hardcoded_two_stage_limit(self):
        axial = build_axial_cylinder(64, 2, regular_layers=2, stages=3)
        self.assertEqual(audit_axial_cylinder(axial)['interface_faces'], [128,64,32,16])
        planar = build_planar_band(12,6,54,3,stages=3)
        annular = build_annular_band(4,10,216,3,stages=3)
        radial = build_radial_band([4,5,7,11],216,3,12,2)
        rectangle = build_rectangular_ring(4,3,54,54,stages=3,ratio=3)
        self.assertEqual(planar['stage_counts'], [54,18,6,2])
        self.assertEqual(annular['stage_counts'], [216,72,24,8])
        self.assertEqual(radial['stage_counts'], [216,72,24,8])
        self.assertEqual(rectangle['stage_counts'], [(54,54),(20,20),(8,8),(4,4)])

    def test_three_stage_axial_cae_fixture_contract(self):
        # The reference tubes were meshed in Abaqus 2020 after prepartitioning
        # four azimuthal quadrants. Compare ports, not free-sweep cell counts.
        for ratio, seeds, fine_layers, counts, facets, native_cells in (
                (2, 64, 3, [64, 32, 16, 8], [128, 64, 32, 16], 736),
                (3, 108, 5, [108, 36, 12, 4], [216, 72, 24, 8], 1504)):
            with self.subTest(ratio=ratio):
                mesh = build_axial_cylinder(seeds, ratio, 2, 8, 12, 4, 7,
                                            fine_layers, 2, 1, stages=3,
                                            stage_widths=[1, 2, 3])
                audit = audit_axial_cylinder(mesh)
                self.assertEqual(audit['stage_counts'], counts)
                self.assertEqual(audit['stage_z'], [2, 3, 5, 8])
                self.assertEqual(audit['interface_faces'], facets)
                self.assertEqual(audit['elements'], native_cells)
                for stage in range(1, 4):
                    label = 'transition_%d' % stage
                    self.assertGreater(audit['region_elements'][label], 0)
                    self.assertGreater(min(audit['region_min_jacobians'][label].values()), 0)
