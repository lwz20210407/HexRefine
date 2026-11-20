import unittest

from tools.transitionmesh_native import (
    audit_tiled_strip, build_transition_patch, tile_strip_quads,
)


class TransitionMeshTemplateTests(unittest.TestCase):
    def test_single_period_topologies(self):
        two = build_transition_patch(2, 1.0, 2.0)
        three = build_transition_patch(3, 1.0, 2.0)
        self.assertEqual((len(two['quads']), two['fine_segments'], two['coarse_segments']), (6, 4, 2))
        self.assertEqual((len(three['quads']), three['fine_segments'], three['coarse_segments']), (4, 3, 1))

    def test_tiled_2to1_strip_is_positive_and_area_conservative(self):
        quads = tile_strip_quads(2, 40, 40.0, 2.0)
        result = audit_tiled_strip(quads, 2, 40, 40.0, 2.0)
        self.assertTrue(result['ok'])
        self.assertEqual(result['quads'], 60)
        self.assertAlmostEqual(result['area'], result['target_area'])

    def test_tiled_3to1_strip_is_positive_and_area_conservative(self):
        quads = tile_strip_quads(3, 48, 48.0, 3.0)
        result = audit_tiled_strip(quads, 3, 48, 48.0, 3.0)
        self.assertTrue(result['ok'])
        self.assertEqual(result['quads'], 64)
        self.assertAlmostEqual(result['area'], result['target_area'])


if __name__ == '__main__':
    unittest.main()
