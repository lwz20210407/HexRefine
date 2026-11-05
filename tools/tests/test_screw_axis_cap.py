"""Research planner tests, not positive source replacement acceptance."""
from fractions import Fraction as Q
from itertools import product
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

from tools.bolthex.screw_axis_cap import upper_axis_endpoint_cone, plan_axis_scope, main
from tools.bolthex.mesh_audit import SIGNS
from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy


def tapered_tip(k=.125, height=.25):
    return np.array([[0, 0, 0], [1, 0, 0], [1, 1, k], [0, 0, k],
                     [0, 0, height], [.5, 0, height], [.5, .5, height+k], [0, 0, height+k]], float)


def verify_bound(test, vertices, certificate):
    p = [[Q.from_float(float(v)) for v in row] for row in vertices]
    normal = [Q(v) for v in certificate['exactTangentPlaneNormal']]
    C = Q(certificate['exactCuspBound']); zmax = p[7][2]
    for coordinates in product((Q(0), Q(1, 4), Q(1, 2), Q(3, 4), Q(1)), repeat=3):
        point = [Q(0)]*3
        for sign, vertex in zip(SIGNS.astype(int), p):
            weight = Q(1)
            for s, t in zip(sign, coordinates):
                weight *= t if s == 1 else 1-t
            for j in range(3):
                point[j] += weight*vertex[j]
        m = sum(a*b for a, b in zip(normal, point))
        test.assertLessEqual(abs(m), C*point[0]*(zmax-point[2]))


class EndpointTests(unittest.TestCase):
    def test_preferred_policy_name_rejects_invalid_input_before_source_read(self):
        for value in ({'profile':'engineering-cad-transfer'}, .001, True, 'engineering'):
            with patch('tools.bolthex.screw_axis_cap.read_keyword') as reader:
                with self.assertRaisesRegex(ValueError,'validated CadAccuracyPolicy'):
                    plan_axis_scope('unused.k',geometry_policy=value)
                reader.assert_not_called()

    def test_conflicting_policy_spellings_reject_before_source_read(self):
        with patch('tools.bolthex.screw_axis_cap.read_keyword') as reader:
            with self.assertRaisesRegex(ValueError,'not both'):
                plan_axis_scope('unused.k',CadAccuracyPolicy(),geometry_policy=CadAccuracyPolicy.engineering(.1))
            reader.assert_not_called()

    def test_unvalidated_policy_rejects_before_source_read(self):
        for value in ({'profile': 'engineering-cad-transfer'}, .001, True, 'engineering'):
            with patch('tools.bolthex.screw_axis_cap.read_keyword') as reader:
                with self.assertRaisesRegex(ValueError, 'validated CadAccuracyPolicy'):
                    plan_axis_scope('unused.k', validated_geometry_policy=value)
                reader.assert_not_called()

    def test_mutated_policy_fields_are_revalidated(self):
        p = CadAccuracyPolicy.engineering(.1)
        object.__setattr__(p, 'target_size_mm', True)
        with patch('tools.bolthex.screw_axis_cap.read_keyword') as reader:
            with self.assertRaises(ValueError):
                plan_axis_scope('unused.k', validated_geometry_policy=p)
            reader.assert_not_called()

    def test_underflowed_budget_rejects_before_source_read(self):
        p = CadAccuracyPolicy.engineering(float.fromhex('0x0.0000000000001p-1022'))
        with patch('tools.bolthex.screw_axis_cap.read_keyword') as reader:
            with self.assertRaisesRegex(ValueError, 'representable'):
                plan_axis_scope('unused.k', validated_geometry_policy=p)
            reader.assert_not_called()
    def test_exact_tapered_bound_has_nonnegative_height_coefficients(self):
        p = tapered_tip(); result = upper_axis_endpoint_cone(p)
        self.assertTrue(result['proved'])
        self.assertGreater(Q(result['exactC']), 0)
        self.assertTrue(all(Q(v) >= 0 for v in result['exactHeightDeficitBernsteinCoefficients']))
        verify_bound(self, p, result)

    def test_constant_flat_top_is_not_falsely_declared_cusp(self):
        self.assertFalse(upper_axis_endpoint_cone(tapered_tip(k=0))['proved'])

    def test_cell_proof_does_not_claim_full_source_isolation(self):
        result = upper_axis_endpoint_cone(tapered_tip())
        self.assertNotIn('globalExteriorCuspConfirmed', result)
        self.assertIn('until full-source isolation', result['scope'])

    def test_unsupported_chart_is_inconclusive(self):
        p = tapered_tip(); p[:, 0] -= 2
        self.assertFalse(upper_axis_endpoint_cone(p)['proved'])
        p = tapered_tip(); p[0, 0] = .1
        self.assertFalse(upper_axis_endpoint_cone(p)['proved'])

    def test_invalid_vertices_reject(self):
        for p in (np.zeros((7, 3)), np.full((8, 3), np.inf)):
            with self.assertRaises(ValueError):
                upper_axis_endpoint_cone(p)

    def test_unreviewed_source_does_not_get_original_layout_plan(self):
        with patch('tools.bolthex.screw_axis_cap.read_keyword', return_value=SimpleNamespace(source_sha256='different')):
            with self.assertRaisesRegex(ValueError, 'reviewed original'):
                plan_axis_scope('not-original.k')


@unittest.skipUnless(os.environ.get('SCREW_ORACLE_K'), 'Set reviewed original source K')
class ActualSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = Path(os.environ['SCREW_ORACLE_K'])
        cls.report = plan_axis_scope(cls.path)
        cls.engineering = plan_axis_scope(cls.path, CadAccuracyPolicy.engineering(.04,
            minimum_functional_gap_mm=.004, minimum_root_radius_mm=.01))

    def test_axis_bad_components_and_other_bad_cells_are_preserved(self):
        r = self.report
        self.assertEqual(r['originalSourceCells'], 6128)
        self.assertEqual(r['originalNoncollapsedBadCount'], 2328)
        self.assertEqual(r['completeAxisBadCellCount'], 2232)
        self.assertEqual(sorted(c['sourceCells'] for c in r['sharedIDCellComponents']), [72, 2160])
        self.assertEqual(r['originalSelectedAxisEIDs'], list(range(2817, 5049)))
        self.assertEqual(r['fullBadComponentExpansionAddedEIDs'], [])
        self.assertEqual(r['originalBadCellsOutsideSelectionCount'], 132)
        self.assertEqual(r['selectedNoncollapsedOriginalBadCount'], 2196)
        self.assertFalse(r['actualReplacementApplied'])
        self.assertFalse(r['globalFreeSkinVerified'])

    def test_regular_bottom_cap_is_real_and_not_a_lower_helicoidal_cut(self):
        r = self.report
        self.assertEqual(r['regularAxisSupportCellCount'], 16)
        self.assertEqual(r['extendedSourceCellCount'], 2248)
        self.assertEqual(r['lowestRegularAxisSupportZ'], -.95)
        self.assertTrue(r['actualLowerEndpoint']['locallyTrueExteriorFlatCap'])
        self.assertGreater(Q(r['actualLowerEndpoint']['exactOtherAabbLInfinitySeparation']), 0)
        self.assertEqual(len(r['flatRegularBottomCapFaces']), 4)

    def test_global_upper_cusp_is_isolated_in_the_entire_source(self):
        r = self.report['fullSourceUpperEndpoint']
        self.assertEqual(r['aabbCandidateOriginalEIDs'], [5048])
        self.assertTrue(r['globalExteriorCuspConfirmed'])
        self.assertGreater(Q(r['exactIsolatingHeightGap']), 0)
        proof = r['cellConeCertificate']
        verify_bound(self, proof['actualSourceVertices'], proof)
        self.assertFalse(self.report['derivedGeometryRepairAuthorized'])
        self.assertFalse(self.report['toleranceBoundedDerivedGeometryRuledOut'])

    def test_engineering_budget_does_not_inherit_exact_domain_refusal(self):
        strict, engineering = self.report, self.engineering
        self.assertEqual(strict['fullSourceUpperEndpoint'], engineering['fullSourceUpperEndpoint'])
        self.assertTrue(strict['selectedPolicyExactObstruction'])
        self.assertFalse(engineering['selectedPolicyExactObstruction'])
        self.assertTrue(engineering['approximationRequiredNotYetSolved'])
        self.assertEqual(engineering['plannerStatus'], 'approximationRequiredNotYetSolved')
        self.assertFalse(engineering['exactObstructionRulesOutEngineeringApproximation'])
        self.assertTrue(engineering['derivedGeometryRepairAuthorized'])
        self.assertAlmostEqual(engineering['criticalGeometryBudgetMM'], .0001)
        self.assertTrue(engineering['validatedGeometryPolicy']['allSurfacesTreatedAsCritical'])
        self.assertEqual(engineering['unchangedHardGates']['minimumCornerSJ'], .15)
        self.assertEqual(engineering['unchangedHardGates']['relativeMeshVolumeLimit'], 1e-4)
        self.assertFalse(engineering['positiveSourceAcceptedReplacementImplemented'])
        self.assertFalse(engineering['globalFreeSkinVerified'])

    def test_geometry_policy_does_not_change_component_or_original_coordinates(self):
        for name in ('originalSelectedAxisEIDs', 'actualRetainedSharedIDHardFaces',
                     'sourceSHA256', 'originalBadCellsOutsideAxisSelection',
                     'oneTimeLowerRegularCapExtendedSelection'):
            self.assertEqual(self.report[name], self.engineering[name])

    def test_preferred_geometry_policy_preserves_pending_status_and_legacy_scope(self):
        policy=CadAccuracyPolicy.engineering(.04,minimum_functional_gap_mm=.004,minimum_root_radius_mm=.01)
        preferred=plan_axis_scope(self.path,geometry_policy=policy)
        self.assertEqual(preferred,self.engineering)
        self.assertEqual(preferred['plannerExitCode'],3)
        self.assertFalse(preferred['positiveSourceAcceptedReplacementImplemented'])
        self.assertFalse(preferred['actualReplacementApplied'])

    def test_cli_reports_refusal_without_writing_a_fake_replacement(self):
        root = os.environ.get('BOLTHEX_TEST_ROOT', os.environ.get('TEMP'))
        with tempfile.TemporaryDirectory(dir=root) as directory:
            out = Path(directory)/'plan'
            self.assertEqual(main([str(self.path), str(out)]), 2)
            self.assertEqual({p.name for p in out.iterdir()}, {'axis-scope-plan.json', 'result.txt'})
            self.assertFalse(json.loads((out/'axis-scope-plan.json').read_text())['positiveSourceAcceptedReplacementImplemented'])
            with self.assertRaises(FileExistsError):
                main([str(self.path), str(out)])

    def test_cli_h_selects_engineering_pending_not_exact_impossibility(self):
        root = os.environ.get('BOLTHEX_TEST_ROOT', os.environ.get('TEMP'))
        with tempfile.TemporaryDirectory(dir=root) as directory:
            out = Path(directory)/'plan'
            self.assertEqual(main([str(self.path), str(out), '--h', '.1',
                                  '--minimum-functional-gap-mm', '.004']), 3)
            r = json.loads((out/'axis-scope-plan.json').read_text())
            self.assertTrue(r['approximationRequiredNotYetSolved'])
            self.assertFalse(r['selectedPolicyExactObstruction'])
            self.assertAlmostEqual(r['criticalGeometryBudgetMM'], .0002)
            self.assertFalse(r['actualReplacementApplied'])

    def test_cli_missing_engineering_h_or_strict_h_rejects(self):
        root = os.environ.get('BOLTHEX_TEST_ROOT', os.environ.get('TEMP'))
        with tempfile.TemporaryDirectory(dir=root) as directory:
            out = Path(directory)/'plan'
            for flags in (['--accuracy-profile', 'engineering'],
                          ['--accuracy-profile', 'strict', '--h', '.1'],
                          ['--h', 'nan'], ['--h', '0']):
                with self.assertRaises(ValueError):
                    main([str(self.path), str(out), *flags])
                self.assertFalse(out.exists())


if __name__ == '__main__':
    unittest.main()
