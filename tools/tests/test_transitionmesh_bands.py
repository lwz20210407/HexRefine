import unittest

from tools.transitionmesh_native import (
    TemplateError, build_planar_band, build_annular_band,
    build_rectangular_ring, extrude_band, plan_transition,
)


class TransitionMeshBandsTests(unittest.TestCase):
    def test_v11_hybrid_orders_and_width(self):
        self.assertEqual(plan_transition('PLANAR', 14, hybrid=True, width=4,
                                         coarse_seeds=6)['widths'], [4])
        for order, first_width in [('3-then-2', 3), ('2-then-3', 4)]:
            mesh = build_planar_band(14, 4, 14, coarse_segments=6, order=order)
            self.assertEqual(len(mesh['elements']), 20)
            self.assertIn((first_width, 4., 0.), mesh['nodes'])
        with self.assertRaises(TemplateError):
            build_planar_band(14, 4, 14, coarse_segments=5)
        reverse = build_planar_band(14, 4, 14, coarse_segments=6, reverse_axis=True)
        top = sorted(x for x, y, _ in reverse['nodes'] if y == 4.)
        self.assertEqual(top, [0, 2, 4, 6, 8, 11, 14])

    def test_annular_closure_and_radial_sweep(self):
        part = build_annular_band(4, 7, 36, 3)
        self.assertEqual((len(part['nodes']), len(part['elements'])), (72, 48))
        reversed_band = build_annular_band(7, 4, 36, 3)
        self.assertEqual(len(reversed_band['elements']), 48)
        h8 = extrude_band(build_annular_band(4, 7, 48, 2), 12, 2)
        self.assertEqual(len(h8['elements']), 144)

    def test_rectangle_corner_ports(self):
        plan = plan_transition('PLANAR_QUAD_FOUR', 16)
        self.assertEqual(plan['chain']['counts'], [16, 10])
        mesh = build_rectangular_ring(4, 3, 16, 12)
        self.assertEqual((len(mesh['nodes']), len(mesh['elements'])), (142, 96))


if __name__ == '__main__':
    unittest.main()
