"""Finite affine range transfer, without HM, SDK, fitting or capture mutation."""
import copy
import hashlib
import json
import math
import unittest
from unittest.mock import patch

import numpy as np

from tools.bolthex import native_curve_range as ranges
from tools.bolthex.cad_native_payload import evaluate_curve


def line_record():
    return dict(type=1, start=[1., 2., 3.], end=[3., -1., 5.], supported=True)


def nurbs_record():
    return dict(type=4, degree=2, rational=True,
                knots=[0., 0., 0., .17, .4, .4000000000001, 1., 1., 1.],
                poles=[[0., 0., 0.], [.4, 1., .5], [1., -.2, 1.5],
                       [1.7, .3, 2.], [2.5, 1.2, -.5], [3., 0., 3.]],
                weights=[1., .75, 2., .6, 1.2, 1.], supported=True)


def circle_record():
    return dict(type=2, center=[.5, .5, 0.], normal=[0., 0., 1.],
                radiusVector=[.25, 0., 0.], supported=True)


class CurveRangeMathTests(unittest.TestCase):
    def assert_map(self, original, result, old, new, count=65):
        for i, t in enumerate(np.linspace(*new, count)):
            s = old[0] if i == 0 else old[1] if i == count - 1 else (
                old[0] + (float(t) - new[0]) / (new[1] - new[0]) * (old[1] - old[0]))
            with self.subTest(parameter=float(t)):
                np.testing.assert_allclose(evaluate_curve(result, float(t)),
                                           evaluate_curve(original, s), atol=1e-10, rtol=0.)

    def test_nonuniform_rational_3d_nurbs_preserves_complete_support_and_controls(self):
        original = nurbs_record()
        result, trace = ranges.transfer_curve_range(original, [.1, .9], [-2., 3.])
        expected = [-2. + (k - .1) * 5. / .8 for k in original['knots']]
        np.testing.assert_allclose(result['knots'], expected, atol=1e-14, rtol=0.)
        self.assertEqual(result['poles'], original['poles'])
        self.assertEqual(result['weights'], original['weights'])
        self.assertIsNot(result['poles'], original['poles'])
        self.assertIsNot(result['weights'], original['weights'])
        self.assertEqual(result['degree'], original['degree'])
        self.assertTrue(result['rational'])
        self.assertEqual(trace['originalFullSupport'], [0., 1.])
        self.assertEqual(trace['transferredFullSupport'], [expected[0], expected[-1]])
        self.assertLess(expected[0], -2.)
        self.assertGreater(expected[-1], 3.)
        self.assert_map(original, result, [.1, .9], [-2., 3.])
        self.assert_map(original, result, [0., 1.], [expected[0], expected[-1]])

    def test_rational_quadratic_matches_independent_homogeneous_formula(self):
        original = dict(type=4, degree=2, rational=True, knots=[1., 1., 1., 4., 4., 4.],
                        poles=[[0., 0., 0.], [1., 2., 3.], [4., 1., 5.]],
                        weights=[1., .5, 2.], supported=True)
        result, _ = ranges.transfer_curve_range(original, [1., 4.], [-3., -2.])
        for fraction in np.linspace(0., 1., 33):
            basis = np.array([(1. - fraction) ** 2, 2. * fraction * (1. - fraction), fraction ** 2])
            homogeneous = basis * original['weights']
            expected = homogeneous @ np.array(original['poles']) / homogeneous.sum()
            np.testing.assert_allclose(evaluate_curve(result, -3. + float(fraction)),
                                       expected, atol=1e-10, rtol=0.)

    def test_nearby_distinct_knots_are_not_merged_or_rounded_to_one_knot(self):
        original = nurbs_record()
        result, trace = ranges.transfer_curve_range(original, [0., 1.], [0., 10.])
        self.assertLess(result['knots'][4], result['knots'][5])
        self.assertEqual(len(set(result['knots'])), len(set(original['knots'])))
        self.assertEqual(len(result['knots']), len(original['knots']))
        self.assertFalse(trace['knotMergingPerformed'])
        self.assert_map(original, result, [0., 1.], [0., 10.])

    def test_line_zero_one_to_zero_point_one_reparameterizes_geometry_not_just_range(self):
        original = line_record()
        result, _ = ranges.transfer_curve_range(original, [0., 1.], [0., .1])
        self.assertEqual(result['type'], 4)
        self.assertEqual(result['degree'], 1)
        self.assertEqual(result['knots'], [0., 0., .1, .1])
        self.assertEqual(result['poles'], [original['start'], original['end']])
        self.assertFalse(result['rational'])
        self.assertEqual(result['weights'], [])
        self.assert_map(original, result, [0., 1.], [0., .1])
        self.assertGreater(math.dist(evaluate_curve(original, .1),
                                     evaluate_curve(result, .1)), 1.)

    def test_line_finite_extrapolation_interval_preserves_its_entire_image(self):
        original = line_record()
        result, _ = ranges.transfer_curve_range(original, [-2., 3.], [7., 11.])
        np.testing.assert_array_equal(result['poles'][0], evaluate_curve(original, -2.))
        np.testing.assert_array_equal(result['poles'][1], evaluate_curve(original, 3.))
        self.assert_map(original, result, [-2., 3.], [7., 11.])

    def test_circle_negative_to_positive_period_keeps_uv_world_locus_and_z_zero(self):
        original = circle_record()
        result, trace = ranges.transfer_curve_range(original, [-math.tau, 0.], [0., math.tau])
        self.assertEqual(result['type'], 2)
        self.assertEqual(result['center'], original['center'])
        self.assertEqual(result['normal'], original['normal'])
        np.testing.assert_allclose(result['radiusVector'], original['radiusVector'], atol=1e-15, rtol=0.)
        self.assert_map(original, result, [-math.tau, 0.], [0., math.tau])
        self.assertTrue(all(row['transferredPoint'][2] == 0. for row in trace['witnesses']))

    def test_circle_general_phase_uses_actual_3d_radius_vector_and_normal(self):
        original = dict(type=2, center=[1., 2., 3.], normal=[0., .6, .8],
                        radiusVector=[2., 0., 0.], supported=True)
        result, _ = ranges.transfer_curve_range(original, [-1.25, .75], [2., 4.])
        phase = -1.25 - 2.
        expected = (np.array(original['radiusVector']) * math.cos(phase)
                    + np.cross(original['normal'], original['radiusVector']) * math.sin(phase))
        np.testing.assert_array_equal(result['radiusVector'], expected)
        self.assert_map(original, result, [-1.25, .75], [2., 4.])

    def test_identity_map_returns_new_pure_math_without_mutating_input(self):
        original = nurbs_record()
        previous = copy.deepcopy(original)
        result, trace = ranges.transfer_curve_range(original, [0., 1.], [0., 1.])
        self.assertEqual(original, previous)
        self.assertEqual(result, original)
        self.assertIsNot(result, original)
        result['poles'][0][0] += 100.
        self.assertEqual(original, previous)
        self.assertTrue(trace['inputDescriptorUnmodified'])

    def test_metadata_and_source_parameter_maps_are_hashed_but_never_relabelled(self):
        original = line_record()
        original.update(sourceMetadata={'capture': 'native SDK', 'observed': True},
                        sourceParameterMap={'kind': 'opaque-native-map'},
                        exactLocusConversion={'fittingPerformed': False},
                        nativeSamples=[{'parameter': .5, 'point': [2., .5, 4.]}],
                        origin='native-SDK-capture')
        previous = copy.deepcopy(original)
        expected_hash = hashlib.sha256(json.dumps(original, sort_keys=True, separators=(',', ':'),
                                                ensure_ascii=True, allow_nan=False).encode()).hexdigest()
        result, trace = ranges.transfer_curve_range(original, [0., 1.], [0., 2.])
        self.assertEqual(set(result), {'type', 'degree', 'rational', 'knots', 'poles', 'weights', 'supported'})
        self.assertEqual(original, previous)
        self.assertEqual(trace['originalDescriptorSHA256'], expected_hash)
        self.assertTrue(trace['analysisOnly'])
        self.assertFalse(trace['nativeHostVerified'])
        self.assertFalse(trace['fittingPerformed'])
        for key in ('sourceMetadataTransferred', 'sourceParameterMapTransferred', 'exactLocusConversionTransferred'):
            self.assertFalse(trace[key])
        self.assertIn('sourceMetadata', trace['droppedInputFields'])
        self.assertIn('sourceParameterMap', trace['droppedInputFields'])
        self.assertIn('not a complete Hausdorff', trace['certificateScope'])

    def test_trace_has_seventeen_endpoint_inclusive_cross_evaluations(self):
        original = line_record()
        result, trace = ranges.transfer_curve_range(original, [-2., 3.], [1., 2.])
        self.assertEqual(trace['oldRange'], [-2., 3.])
        self.assertEqual(trace['newRange'], [1., 2.])
        self.assertEqual(trace['witnessCount'], 17)
        self.assertEqual(len(trace['witnesses']), 17)
        self.assertEqual(trace['witnesses'][0]['oldParameter'], -2.)
        self.assertEqual(trace['witnesses'][-1]['oldParameter'], 3.)
        self.assertEqual(trace['witnesses'][0]['newParameter'], 1.)
        self.assertEqual(trace['witnesses'][-1]['newParameter'], 2.)
        self.assertLessEqual(trace['maximumCrossEvaluationError'], 1e-10)
        self.assertEqual(trace['parameterMap']['scale'], 5.)
        self.assert_map(original, result, [-2., 3.], [1., 2.])


class CurveRangeGuardTests(unittest.TestCase):
    def test_bad_ranges_reject_before_any_curve_evaluation(self):
        for interval in ([1., 1.], [2., 1.], [0., math.nan], [0., math.inf],
                         [False, 1.], [0., True], [0.], '0,1', [0., 1e13], [0, 10 ** 1000]):
            for which in ('old', 'new'):
                with self.subTest(interval=str(interval)[:100], which=which), patch.object(
                        ranges, 'evaluate_curve', side_effect=AssertionError('math before validation')) as evaluate:
                    args = (interval, [0., 1.]) if which == 'old' else ([0., 1.], interval)
                    with self.assertRaises(ValueError):
                        ranges.transfer_curve_range(line_record(), *args)
                    evaluate.assert_not_called()

    def test_circle_angular_scaling_even_one_ulp_is_explicitly_unsupported(self):
        for interval in ([0., .1], [0., math.tau], [0., math.nextafter(1., math.inf)]):
            with self.subTest(new=interval), self.assertRaises(ranges.UnsupportedCurveRangeTransfer):
                ranges.transfer_curve_range(circle_record(), [0., 1.], interval)

    def test_ellipse_and_unknown_curve_types_never_fall_back_to_fitting(self):
        for kind in (3, 5, 99):
            record = dict(type=kind, supported=True)
            with self.subTest(kind=kind), self.assertRaises(ranges.UnsupportedCurveRangeTransfer):
                ranges.transfer_curve_range(record, [0., 1.], [0., 1.])
        for kind in (True, 1., '1'):
            record = line_record()
            record['type'] = kind
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                ranges.transfer_curve_range(record, [0., 1.], [0., 1.])

    def test_oversize_poles_reject_before_hashing_or_mathematics(self):
        with patch.object(ranges, 'MAX_CONTROL_POLES', 5), patch.object(
                ranges, '_descriptor_sha256', side_effect=AssertionError('hash before count guard')) as digest:
            with self.assertRaises(ValueError):
                ranges.transfer_curve_range(nurbs_record(), [0., 1.], [0., 2.])
            digest.assert_not_called()

    def test_malformed_nurbs_counts_flags_knots_poles_and_weights_reject(self):
        corruptions = (
            ('degree', True), ('degree', 26), ('rational', 1),
            ('knots', [0., 0., 0., .4, .2, .6, 1., 1., 1.]),
            ('knots', [0., 0., .01, .17, .4, .6, 1., 1., 1.]),
            ('knots', [0., 0., 0., 0., .4, .6, 1., 1., 1.]),
            ('knots', [0., 0., 0., .17, .4, math.nan, 1., 1., 1.]),
            ('weights', [1., 1., 1., 1., 1.]),
            ('weights', [1., 1., 1., 0., 1., 1.]),
            ('weights', [1., 1., 1., True, 1., 1.]),
            ('poles', [[0., 0., 0.]] * 5),
            ('poles', [[0., 0., 0.]] * 5 + [[0., 0., False]]),
        )
        for key, value in corruptions:
            record = nurbs_record()
            record[key] = value
            with self.subTest(field=key, value=value), patch.object(
                    ranges, 'evaluate_curve', side_effect=AssertionError('math before preflight')) as evaluate:
                with self.assertRaises(ValueError):
                    ranges.transfer_curve_range(record, [0., 1.], [0., 2.])
                evaluate.assert_not_called()

    def test_nurbs_trim_outside_support_is_not_clamped_or_extrapolated(self):
        for interval in ([-.1, .9], [.1, 1.1]):
            with self.subTest(interval=interval), self.assertRaises(ValueError):
                ranges.transfer_curve_range(nurbs_record(), interval, [0., 1.])

    def test_numerically_collapsed_distinct_knots_are_rejected_not_merged(self):
        with self.assertRaisesRegex(ValueError, 'collapsed distinct knots'):
            ranges.transfer_curve_range(nurbs_record(), [0., 1.], [1e10, 1e10 + .1])

    def test_invalid_circle_frame_is_rejected_without_normalizing_source_axes(self):
        for key, value in (('normal', [0., 0., 2.]), ('normal', [False, 0., 1.]),
                           ('radiusVector', [0., 0., 0.]), ('radiusVector', [1., 0., .1]),
                           ('center', [0., math.inf, 0.])):
            original = circle_record()
            original[key] = value
            previous = copy.deepcopy(original)
            with self.subTest(field=key), self.assertRaises(ValueError):
                ranges.transfer_curve_range(original, [0., 1.], [1., 2.])
            self.assertEqual(original, previous)

    def test_nonfinite_coordinates_and_numeric_bools_are_rejected_before_math(self):
        for value in (math.nan, math.inf, True, '1'):
            original = line_record()
            original['start'][0] = value
            with self.subTest(value=value), patch.object(
                    ranges, 'evaluate_curve', side_effect=AssertionError('math before vector validation')) as evaluate:
                with self.assertRaises(ValueError):
                    ranges.transfer_curve_range(original, [0., 1.], [0., 2.])
                evaluate.assert_not_called()

    def test_unsafe_scaling_rejects_before_curve_evaluation(self):
        with patch.object(ranges, 'evaluate_curve', side_effect=AssertionError('unsafe arithmetic')) as evaluate:
            with self.assertRaises(ValueError):
                ranges.transfer_curve_range(line_record(), [0., math.ulp(0.)], [0., 1.])
            evaluate.assert_not_called()

    def test_ranges_with_too_few_representable_parameters_cannot_fake_seventeen_points(self):
        narrow = [1e10, math.nextafter(1e10, math.inf)]
        for old, new in ((narrow, [0., 1.]), ([0., 1.], narrow)):
            with self.subTest(old=old, new=new), self.assertRaisesRegex(ValueError, '17 distinct'):
                ranges.transfer_curve_range(line_record(), old, new)

    def test_cyclic_or_nonfinite_metadata_cannot_enter_the_hash_or_new_record(self):
        for kind in ('cycle', 'nonfinite', 'nonjson'):
            record = line_record()
            record['sourceMetadata'] = record if kind == 'cycle' else (
                {'value': math.nan} if kind == 'nonfinite' else object())
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                ranges.transfer_curve_range(record, [0., 1.], [0., 2.])

    def test_descriptor_byte_and_structure_budgets_precede_curve_evaluation(self):
        for setting, value in (('MAX_DESCRIPTOR_BYTES', 100), ('MAX_DESCRIPTOR_ITEMS', 10)):
            record = line_record()
            record['sourceMetadata'] = {'note': 'x' * 200}
            with self.subTest(setting=setting), patch.object(ranges, setting, value), patch.object(
                    ranges, 'evaluate_curve', side_effect=AssertionError('math before descriptor budget')) as evaluate:
                with self.assertRaises(ValueError):
                    ranges.transfer_curve_range(record, [0., 1.], [0., 2.])
                evaluate.assert_not_called()

    def test_cross_evaluation_mismatch_rejects_and_never_changes_input(self):
        record = line_record()
        previous = copy.deepcopy(record)

        def corrupted_evaluation(curve, parameter):
            point = evaluate_curve(curve, parameter)
            return point + np.array([1e-8, 0., 0.]) if curve['type'] == 4 else point

        with patch.object(ranges, 'evaluate_curve', side_effect=corrupted_evaluation):
            with self.assertRaisesRegex(ValueError, 'cross-evaluation'):
                ranges.transfer_curve_range(record, [0., 1.], [0., 2.])
        self.assertEqual(record, previous)


if __name__ == '__main__':
    unittest.main()
