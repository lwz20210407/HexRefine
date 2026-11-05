"""Engineering carrier budgets never waive raw/source evidence requirements."""
import copy
import importlib.util
import json
import math
import os
import unittest
from unittest.mock import patch

from tools.bolthex import native_cad_conditioning as conditioning
from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy
from tools.tests import test_native_cad_conditioning as carrier_fixtures


measured_fixture = carrier_fixtures.measured_fixture


def _edge_report(distance):
    report = measured_fixture()
    report['edgeReverse'][0]['sourceDistance'] = distance
    report['maximumReverseEdgeDistance'] = distance
    return report


def _engineering_report(distance=.0003, volume_error=5e-5):
    report = measured_fixture()
    for row in report['forward']:
        row['candidateDistance'] = row['sourceDistance'] + distance
    for row in report['sourceFaceWitnesses']:
        row['candidateDistance'] = distance
    for group in ('reverse', 'edgeReverse'):
        for row in report[group]:
            row['sourceDistance'] = distance
    for key in ('maximumSurfaceDistance', 'maximumBoundaryNodeControlDistance',
                'maximumSourceFaceDistance', 'maximumReverseDistance',
                'maximumReverseEdgeDistance'):
        report[key] = distance
    report['maximumControlDistanceError'] = max(
        abs(row['candidateDistance'] - row['sourceDistance'])
        for row in report['forward'] if row['role'] == 'control')
    report['candidateBounds'] = [value + distance for value in report['sourceBounds']]
    report['maximumCadBoundsDifference'] = max(abs(a - b) for a, b in zip(
        report['candidateBounds'], report['sourceBounds']))
    report['stepBrepVolume'] = report['sourceVolume'] * (1. + volume_error)
    report['relativeStepBrepVolumeError'] = abs(
        report['stepBrepVolume'] - report['sourceVolume']) / report['sourceVolume']
    report['strictStepCarrierVerified'] = False
    return report


class EngineeringCarrierPolicyTests(unittest.TestCase):
    def setUp(self):
        self.policy = CadAccuracyPolicy.engineering(.1)

    def test_complete_raw_engineering_measurements_pass_but_strict_still_fails(self):
        report = _engineering_report()
        self.assertTrue(conditioning.step_carrier_acceptance(report, self.policy))
        self.assertFalse(conditioning.step_carrier_acceptance(report))
        self.assertFalse(conditioning.step_carrier_acceptance(report, None))
        self.assertFalse(conditioning.step_carrier_acceptance(report, CadAccuracyPolicy()))

    def test_acceptance_does_not_rewrite_raw_evidence_or_strict_diagnostic(self):
        report = _engineering_report()
        before = copy.deepcopy(report)
        strict_limits = dict(conditioning.LIMITS)
        self.assertTrue(conditioning.step_carrier_acceptance(report, policy=self.policy))
        self.assertEqual(report, before)
        self.assertEqual(conditioning.LIMITS, strict_limits)
        self.assertFalse(report['strictStepCarrierVerified'])
        self.assertEqual(conditioning.LIMITS['maximumReverseEdgeDistance'], 2e-6)
        self.assertEqual(conditioning.LIMITS['relativeStepBrepVolumeError'], 1e-7)

    def test_summary_consistency_epsilon_is_not_an_extra_acceptance_budget(self):
        policy=CadAccuracyPolicy.engineering(.04)
        for kind in ('edge','bounds','volume','controls'):
            report=measured_fixture()
            if kind=='edge':
                report['maximumReverseEdgeDistance']=.0004
                report['edgeReverse'][0]['sourceDistance']=.0004+5e-13
            elif kind=='bounds':
                report['maximumCadBoundsDifference']=.0004
                report['candidateBounds'][0]+=.0004+5e-13
            elif kind=='volume':
                report['relativeStepBrepVolumeError']=1e-4
                report['stepBrepVolume']=1.+1e-4+5e-13
            else:
                report['maximumControlDistanceError']=.0004
                report['forward'][2]['candidateDistance']+=.0004+5e-13
            with self.subTest(kind=kind):
                self.assertFalse(conditioning.step_carrier_acceptance(report,policy))

    def test_all_surfaces_are_critical_unless_explicitly_declared_otherwise(self):
        report = _edge_report(.00075)
        self.assertFalse(conditioning.step_carrier_acceptance(report, self.policy))
        self.assertFalse(conditioning.step_carrier_acceptance(
            report, self.policy, all_surfaces_critical=True))
        self.assertTrue(conditioning.step_carrier_acceptance(
            report, self.policy, all_surfaces_critical=False))

    def test_four_e_minus_four_budget_is_closed_at_its_exact_boundary(self):
        policy = CadAccuracyPolicy.engineering(.04)
        budget = 4e-4
        self.assertEqual(policy.carrier_limits()['maximumReverseEdgeDistance'], budget)
        for distance, accepted in ((math.nextafter(budget, 0.), True),
                                   (budget, True),
                                   (math.nextafter(budget, math.inf), False)):
            with self.subTest(distance=distance):
                self.assertEqual(conditioning.step_carrier_acceptance(
                    _edge_report(distance), policy), accepted)
                self.assertFalse(conditioning.step_carrier_acceptance(_edge_report(distance)))

    def test_ordinary_absolute_cap_and_critical_absolute_cap_remain_distinct(self):
        policy = CadAccuracyPolicy.engineering(1.)
        for critical, budget in ((False, .001), (True, .0005)):
            with self.subTest(critical=critical):
                self.assertTrue(conditioning.step_carrier_acceptance(
                    _edge_report(budget), policy, all_surfaces_critical=critical))
                self.assertFalse(conditioning.step_carrier_acceptance(
                    _edge_report(math.nextafter(budget, math.inf)), policy,
                    all_surfaces_critical=critical))

    def test_gap_root_and_critical_size_limits_bind_carrier_acceptance(self):
        cases = (
            (dict(minimum_functional_gap_mm=.004), .05 * .004),
            (dict(minimum_root_radius_mm=.01), .01 * .01),
            (dict(critical_target_size_mm=.01), .01 * .01),
            (dict(minimum_functional_gap_mm=.008,
                  minimum_root_radius_mm=.04), 4e-4),
        )
        for arguments, budget in cases:
            policy = CadAccuracyPolicy.engineering(.1, **arguments)
            with self.subTest(arguments=arguments):
                self.assertTrue(conditioning.step_carrier_acceptance(_edge_report(budget), policy))
                above = _edge_report(math.nextafter(budget, math.inf))
                self.assertFalse(conditioning.step_carrier_acceptance(above, policy))
                self.assertTrue(conditioning.step_carrier_acceptance(
                    above, policy, all_surfaces_critical=False))

    def test_engineering_brep_volume_limit_does_not_replace_strict_limit(self):
        report = measured_fixture()
        report.update(sourceVolume=10000., stepBrepVolume=10001.,
                      relativeStepBrepVolumeError=1e-4)
        self.assertTrue(conditioning.step_carrier_acceptance(report, self.policy))
        self.assertFalse(conditioning.step_carrier_acceptance(report))
        report['stepBrepVolume'] = 10001.0001
        report['relativeStepBrepVolumeError'] = abs(
            report['stepBrepVolume'] - report['sourceVolume']) / report['sourceVolume']
        self.assertFalse(conditioning.step_carrier_acceptance(report, self.policy))
        report['relativeStepBrepVolumeError'] = 0.
        self.assertFalse(conditioning.step_carrier_acceptance(report, self.policy))

    def test_missing_witness_coverage_cannot_be_waived_by_engineering_policy(self):
        for field in ('forward', 'sourceFaceWitnesses', 'reverse', 'edgeReverse'):
            report = measured_fixture()
            report[field] = []
            with self.subTest(field=field):
                self.assertFalse(conditioning.step_carrier_acceptance(report, self.policy))
        report = measured_fixture()
        report['completeWitnessCoverage'] = False
        self.assertFalse(conditioning.step_carrier_acceptance(report, self.policy))
        report = measured_fixture()
        report['failedWitnesses'] = [dict(kind='source-face', index=0, error='missing interior')]
        self.assertFalse(conditioning.step_carrier_acceptance(report, self.policy))

    def test_forged_summary_maxima_cannot_hide_raw_distances_within_engineering_budget(self):
        for group, field in (('forward', 'candidateDistance'),
                             ('sourceFaceWitnesses', 'candidateDistance'),
                             ('reverse', 'sourceDistance'), ('edgeReverse', 'sourceDistance')):
            report = measured_fixture()
            report[group][0][field] = .0003
            with self.subTest(group=group):
                self.assertFalse(conditioning.step_carrier_acceptance(report, self.policy))
        report = measured_fixture()
        report['forward'][2]['candidateDistance'] += .0003
        self.assertFalse(conditioning.step_carrier_acceptance(report, self.policy))
        report = measured_fixture()
        report['candidateBounds'][0] += .0003
        self.assertFalse(conditioning.step_carrier_acceptance(report, self.policy))

    def test_source_reference_evidence_keeps_its_two_e_minus_six_limit(self):
        for error, accepted in ((2e-6, True), (math.nextafter(2e-6, math.inf), False)):
            report = measured_fixture()
            report['forward'][0]['referenceDistance'] = error
            report['maximumSourceReferenceError'] = error
            with self.subTest(error=error):
                self.assertEqual(conditioning.step_carrier_acceptance(
                    report, self.policy), accepted)

    def test_source_boundary_distance_cannot_use_the_candidate_engineering_budget(self):
        for role in ('surface', 'mesh-boundary-node'):
            report = measured_fixture()
            row = next(r for r in report['forward'] if r['role'] == role)
            row.update(sourceDistance=3e-6, referenceDistance=3e-6)
            with self.subTest(role=role):
                self.assertFalse(conditioning.step_carrier_acceptance(report, self.policy))

    def test_validity_ownership_and_immutable_inputs_remain_hard_requirements(self):
        for field in ('inputsUnchanged', 'sourceValid', 'candidateValid',
                      'allCandidateFacesOwnedBySingleSolid'):
            report = measured_fixture()
            report[field] = False
            with self.subTest(field=field):
                self.assertFalse(conditioning.step_carrier_acceptance(report, self.policy))
        report = measured_fixture()
        report['nativeApproxVolumeUsedForAcceptance'] = True
        self.assertFalse(conditioning.step_carrier_acceptance(report, self.policy))


@unittest.skipUnless(importlib.util.find_spec('build123d') and os.environ.get('BOLTHEX_TEST_ROOT'),
                     'Explicit CAD runtime and dated scratch required')
class ActualEngineeringCarrierPolicyTests(unittest.TestCase):
    def setUp(self):
        # Reuse only the existing owned-file fixture, not its inherited test cases.
        carrier_fixtures.TinyActualStepCarrierTests.setUp(self)
        self.policy = CadAccuracyPolicy.engineering(.1)

    def test_actual_translated_step_passes_engineering_but_not_strict(self):
        from build123d import Box, Location, export_step
        from tools.hypermesh_geometry_probe import sha
        export_step(Box(2, 2, 2).moved(Location((.0003, 0., 0.))), self.carrier)
        before = {p: sha(p) for p in (self.source, self.carrier, self.ref)}
        report = conditioning.audit_step_carrier(
            self.source, self.carrier, self.ref, accuracy_policy=self.policy)
        original = copy.deepcopy(report)
        self.assertTrue(report['completeWitnessCoverage'])
        self.assertGreater(report['maximumReverseEdgeDistance'], 2e-6)
        self.assertLess(report['maximumReverseEdgeDistance'], .0005)
        self.assertFalse(report['strictStepCarrierVerified'])
        self.assertTrue(report['selectedGeometryPolicyVerified'])
        self.assertTrue(report['engineeringStepCarrierVerified'])
        self.assertTrue(report['geometryAccuracyPolicy'][
            'numericalLimitsAreProjectChoicesNotVendorMandates'])
        self.assertTrue(conditioning.step_carrier_acceptance(report, self.policy))
        self.assertFalse(conditioning.step_carrier_acceptance(report))
        self.assertFalse(report['nativeHmVerified'])
        self.assertFalse(report['fullModelAcceptance'])
        self.assertEqual(report, original)
        for path, digest in before.items():
            self.assertEqual(sha(path), digest)

    def test_stale_source_hash_rejects_before_any_engineering_acceptance_or_cad_read(self):
        reference = json.loads(self.ref.read_text())
        reference['sourceStepSHA256'] = '0' * 64
        self.ref.write_text(json.dumps(reference))
        with patch('build123d.import_step') as reader, patch.object(
                conditioning, 'step_carrier_acceptance') as acceptance:
            with self.assertRaises(ValueError):
                conditioning.audit_step_carrier(
                    self.source, self.carrier, self.ref, accuracy_policy=self.policy)
            reader.assert_not_called()
            acceptance.assert_not_called()

    def test_missing_actual_face_interior_coverage_still_rejects_engineering(self):
        with patch.object(conditioning, '_interior_point',
                          side_effect=ValueError('unverified interior')):
            report = conditioning.audit_step_carrier(
                self.source, self.carrier, self.ref, accuracy_policy=self.policy)
        self.assertFalse(report['completeWitnessCoverage'])
        self.assertEqual(len(report['failedWitnesses']), 12)
        self.assertEqual(len(report['edgeReverse']), 60)
        self.assertFalse(report['selectedGeometryPolicyVerified'])
        self.assertFalse(report['engineeringStepCarrierVerified'])
        self.assertFalse(conditioning.step_carrier_acceptance(report, self.policy))


if __name__ == '__main__':
    unittest.main()
