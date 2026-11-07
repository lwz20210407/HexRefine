"""Small controls plus opt-in full actual 76/308 raw/phase regressions."""
import copy
from dataclasses import replace
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from tools.bolthex import screw_boundary_budget as audit
from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy

POLICY = CadAccuracyPolicy.engineering(.2)
ENV = ('SCREW_ORACLE_K', 'SCREW_PHASE_K', 'SCREW_BOUNDARY_POLICY_REPORT', 'SCREW_COLLAR_DIR', 'BOLTHEX_TEST_ROOT')
READY = all(os.environ.get(k) for k in ENV) and importlib.util.find_spec('OCP') is not None


class BoundaryBudgetControls(unittest.TestCase):
    def test_explicit_existing_policy_required_before_any_file_read(self):
        with patch.object(audit, '_check_file', side_effect=AssertionError('file read')):
            for policy in (None, {}, CadAccuracyPolicy(), CadAccuracyPolicy.engineering(.3),
                           CadAccuracyPolicy.engineering(.2, critical_target_size_mm=.01)):
                with self.subTest(policy=policy), self.assertRaises(ValueError):
                    audit.audit_boundary_budget('raw', 'phase', 'policy', 'collar', 'out', geometry_policy=policy)
        with self.assertRaises(TypeError):
            audit.audit_boundary_budget('raw', 'phase', 'policy', 'collar', 'out')

    def test_subclass_budget_and_manifest_overrides_are_not_executed(self):
        class Untrusted(CadAccuracyPolicy):
            def manifest(self, **kwargs):
                raise AssertionError('subclass manifest')
            def distance_budget_mm(self, **kwargs):
                raise AssertionError('subclass budget')
        with patch.object(audit, '_check_file', side_effect=ValueError('file gate reached')):
            with self.assertRaisesRegex(ValueError, 'file gate reached'):
                audit.audit_boundary_budget('raw', 'phase', 'policy', 'collar', Path.cwd().parent/'boundary-budget-never-created',
                                            geometry_policy=Untrusted.engineering(.2))

    def test_actual_radial_restriction_preserves_outer_and_z_without_mutation(self):
        q = np.array([[0., 0., 0.], [1., 0., 0.], [1., 1., .2], [0., 0., .2]])
        before = q.copy()
        restricted = audit._annulus(q)
        np.testing.assert_array_equal(q, before)
        np.testing.assert_array_equal(restricted[[1, 2]], q[[1, 2]])
        np.testing.assert_array_equal(restricted[:, 2], q[:, 2])
        np.testing.assert_array_equal(restricted[[0, 3], :2], .6*q[[1, 2], :2])
        for bad in (np.full((4, 3), np.nan), q[:3], np.ones((4, 3))):
            with self.assertRaises(ValueError):
                audit._annulus(bad)
        q[0, 2] = .01
        with self.assertRaisesRegex(ValueError, 'same-Z'):
            audit._annulus(q)

    def test_incomplete_measurement_inventory_is_never_summarized_as_pass(self):
        with self.assertRaisesRegex(ValueError, 'Incomplete measured'):
            audit._summarize([], .0005)

    def test_named_metric_does_not_fold_nan_into_zero_or_gauss_positivity(self):
        corner = audit._metric_summary(np.array([np.nan, 0., -.2, .8]), np.arange(1, 5))
        gauss = audit._metric_summary(np.array([.1, .2, .3, .4]), np.arange(1, 5))
        self.assertEqual((corner['finiteNonpositiveCount'], corner['nonfiniteCount']), (2, 1))
        self.assertEqual((corner['finiteZeroCount'], corner['finiteNegativeCount']), (1, 1))
        self.assertEqual(corner['firstNonfiniteEIDs'], [1])
        self.assertFalse(corner['allFinitePositive'])
        self.assertTrue(gauss['allFinitePositive'])


@unittest.skipUnless(READY, 'Actual raw/phase/policy/frozen paths, OCP and explicit scratch required')
class ActualBoundaryBudgetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw, cls.phase, cls.policy, cls.collar, root = [Path(os.environ[k]) for k in ENV]
        cls.directory = tempfile.TemporaryDirectory(prefix='boundary-budget-', dir=root)
        cls.addClassCleanup(cls.directory.cleanup)
        cls.root = Path(cls.directory.name)
        cls.output = cls.root/'baseline'
        cls.result = audit.audit_boundary_budget(cls.raw, cls.phase, cls.policy, cls.collar, cls.output,
                                                 geometry_policy=POLICY)
        cls.measured = json.loads((cls.output/'measurements.json').read_bytes())
        cls.bindings = cls.result['inputSHA256']

    @classmethod
    def tearDownClass(cls):
        for path, digest in cls.bindings.items():
            if hashlib.sha256(Path(path).read_bytes()).hexdigest() != digest:
                raise AssertionError('Actual input changed: ' + path)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=self.root)
        self.addCleanup(self.temp.cleanup)
        self.case = Path(self.temp.name)
        self.output = self.case/'result'

    def run_audit(self, **kwargs):
        return audit.audit_boundary_budget(kwargs.pop('raw_k', self.raw), self.phase, self.policy, self.collar,
                                            self.output, geometry_policy=POLICY, **kwargs)

    def assert_no_success(self):
        self.assertFalse((self.output/'report.json').exists())
        rejection = self.output/'rejection.json'
        if rejection.exists():
            self.assertIs(json.loads(rejection.read_bytes())['sampledBoundaryBudgetPassed'], False)

    def test_actual_all_76_308_geometry_and_frozen_interfaces(self):
        r = self.result
        self.assertIs(r['sampledBoundaryBudgetPassed'], True)
        self.assertEqual(r['geometryAccuracyPolicy'], POLICY.manifest())
        self.assertEqual(r['distanceBudgetMM'], .0005)
        self.assertEqual((r['inventory']['retainedHardFaces'], r['inventory']['endpointRetainedHardFaces']), (1080, 37))
        self.assertIs(r['inventory']['originalNodeRowsBitwiseUnchanged'], True)
        for name in ('raw', 'phase'):
            rows = self.measured[name]
            self.assertEqual(len(rows), 76)
            children = [c['binding'] for g in rows for c in g['children']]
            self.assertEqual(len(children), 308)
            self.assertEqual(len({(c['eid'], c['localFace']) for c in children}), 308)
            summary = r['variants'][name]
            self.assertEqual((summary['forwardSamples'], summary['reverseSamples']), (7700, 6156))
            self.assertEqual(summary['overBudgetForwardFaces'], 0)
            self.assertEqual(summary['overBudgetReverseAnnuli'], 0)
        self.assertAlmostEqual(r['variants']['raw']['maximumMM'], .0003128281287837287, delta=1e-10)
        self.assertAlmostEqual(r['variants']['phase']['maximumMM'], .00018436464207869562, delta=1e-10)
        self.assertEqual(r['variants']['raw']['reverseWorst']['parentEID'], 5013)
        self.assertEqual(r['variants']['phase']['forwardWorst']['parentEID'], 2912)

    def test_report_and_measurement_payload_hashes_are_bound(self):
        output = self.root/'baseline'
        self.assertEqual(json.loads((output/'report.json').read_bytes()), self.result)
        artifact = self.result['measurementsArtifact']
        data = (output/artifact['path']).read_bytes()
        self.assertEqual(len(data), artifact['bytes'])
        self.assertEqual(hashlib.sha256(data).hexdigest(), artifact['sha256'])
        self.assertLessEqual(len(data), audit.MAX_MEASUREMENTS_BYTES)
        self.assertEqual({p.name for p in output.iterdir()}, {'measurements.json', 'report.json'})

    def test_local_budget_never_promotes_exact_support_or_hollow_composite(self):
        for key in ('exactSourceSupportVerified', 'exactSupportTested', 'existingExactDefaultChanged',
                    'globalHausdorffCertified', 'wholeScrewAccepted', 'coreFilled', 'engineeringQualityAccepted'):
            self.assertIs(self.result[key], False, key)
        context = self.result['wholeCollarContext']
        provenance = context['reportedContextProvenance']
        self.assertEqual(provenance['frozenReportSHA256'], self.bindings[str(self.collar/'report.json')])
        self.assertEqual(provenance['phaseReportSHA256'], self.bindings[str(self.policy)])
        self.assertEqual(provenance['collarQualityJSONPath'], 'rawQualityMetrics')
        self.assertFalse(provenance['collarQualityIndependentlyRecomputed'])
        self.assertFalse(provenance['wholeModelVolumeIndependentlyRecomputed'])
        self.assertEqual(context['legacyReportAxisCollapsedPositionCells'], 36)
        self.assertIs(context['legacyCollapsedCountIsNotAllCornerIssues'], True)
        self.assertAlmostEqual(context['relativeCompositeMinusRaw'], -.1945054107573323)
        self.assertAlmostEqual(context['collarQuality']['trilinearCornerAndCentre9MinimumScaledJacobian'], .14476584291234454)
        self.assertIs(context['missingCoreNotIgnored'], True)
        self.assertIs(context['sourceDomainVolumePreserved'], False)

    def test_actual_named_quality_preserves_head_neck_and_retained_distinctions(self):
        q = self.result['wholeCollarContext']['actualNamedQuality']
        self.assertTrue(q['independentlyRecomputedByThisAPI'])
        self.assertEqual(q['implementation'], 'tools.bolthex.h8_quality_report.measure_h8')
        self.assertEqual(q['implementationSHA256'], hashlib.sha256(Path(audit.h8_quality.__file__).read_bytes()).hexdigest())
        self.assertEqual(q['rawSourceSHA256'], self.bindings[str(self.raw)])
        self.assertEqual(q['frozenCompositeSHA256'], self.bindings[str(self.collar/'composite.npz')])
        expected = {'head': (2816, 64, 0), 'neck': (72, 36, 36), 'body': (2160, 2160, 0), 'tooth': (1080, 0, 0)}
        for name, (count, nonpositive, nonfinite) in expected.items():
            row = q['sourceRegions'][name]
            corner = row['metrics']['cornerScaledJacobian']
            gauss = row['metrics']['minimumGaussDeterminant']
            self.assertEqual(row['elements'], count)
            self.assertEqual(row['pidValues'], [1])
            self.assertEqual((corner['finiteNonpositiveCount'], corner['nonfiniteCount']), (nonpositive, nonfinite))
            self.assertTrue(gauss['allFinitePositive'])
            self.assertEqual((gauss['finiteNonpositiveCount'], gauss['nonfiniteCount']), (0, 0))
        self.assertEqual(q['sourceRegions']['body']['metrics']['cornerScaledJacobian']['finiteMaximum'], 0.)
        for name, count, nonpositive, nonfinite in (('includingNeck3968', 3968, 100, 36), ('excludingNeck3896', 3896, 64, 0)):
            scope = q['retainedScopes'][name]
            self.assertTrue(scope['metricArraysEqualIncludingNaNs'])
            self.assertEqual(scope['raw'], scope['frozen'])
            self.assertEqual(scope['raw']['elements'], count)
            corner = scope['raw']['metrics']['cornerScaledJacobian']
            self.assertEqual((corner['finiteNonpositiveCount'], corner['nonfiniteCount']), (nonpositive, nonfinite))
            self.assertTrue(scope['raw']['metrics']['minimumGaussDeterminant']['allFinitePositive'])
        for key in ('solverInvalidityDetermined', 'engineeringQualityAccepted', 'headOrNeckShapeOrFieldsChanged'):
            self.assertIs(q[key], False)

    def test_wrong_bound_policy_report_rejects_before_frozen_geometry(self):
        actual = audit._json
        def changed(path, limit):
            value = actual(path, limit)
            if path == self.policy.resolve():
                value['geometryAccuracyPolicy'] = CadAccuracyPolicy.engineering(.3).manifest()
            return value
        with patch.object(audit, '_json', side_effect=changed), patch.object(audit.endpoint, '_load') as load:
            with self.assertRaisesRegex(ValueError, 'policy/source'):
                self.run_audit()
            load.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_changed_source_bytes_and_stale_frozen_hash_reject(self):
        inbox = self.case/'inbox'
        inbox.mkdir()
        bad = inbox/'raw.k'
        bad.write_bytes(b'not the approved source')
        with self.assertRaisesRegex(ValueError, 'policy/source'):
            self.run_audit(raw_k=bad)
        actual = audit._digest
        with patch.object(audit, '_digest', side_effect=lambda p, n: '0'*64 if p == self.collar/'report.json' else actual(p, n)):
            with self.assertRaisesRegex(ValueError, 'Frozen artifact hash'):
                self.run_audit()
        self.assertFalse(self.output.exists())

    def test_changed_original_node_rows_reject_even_after_loader_return(self):
        actual = audit.endpoint._load
        def changed(*args):
            loaded = list(actual(*args))
            nodes = loaded[0].nodes.copy()
            nodes[0, 0] += .001
            loaded[0] = replace(loaded[0], nodes=nodes)
            return tuple(loaded)
        with patch.object(audit.endpoint, '_load', side_effect=changed), patch.object(audit, '_measure') as measure:
            with self.assertRaisesRegex(ValueError, 'Original node rows'):
                self.run_audit()
            measure.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_changed_protected_owner_is_not_an_interface_match(self):
        actual = audit.endpoint._load
        def changed(*args):
            loaded = list(actual(*args))
            loaded[2] = copy.deepcopy(loaded[2])
            parent = next(r for r in loaded[2] if r['retained'] is not None)
            parent['retained']['nodeIDs'].reverse()
            return tuple(loaded)
        with patch.object(audit.endpoint, '_load', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'Protected retained owner'):
                self.run_audit()
        self.assertFalse(self.output.exists())

    def test_caps_semantics_must_match_actual_faces(self):
        actual = audit._json
        def changed(path, limit):
            value = actual(path, limit)
            if path == self.collar/'caps.json':
                value['endGroups'][0]['collarAnnularFaceBindings'][0]['nodeIDs'].reverse()
            return value
        with patch.object(audit, '_json', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'annular child binding'):
                self.run_audit()
        self.assertFalse(self.output.exists())

    def test_finite_overbudget_measurement_is_diagnostic_failure_not_exact_pass(self):
        actual = audit._distance
        calls = 0
        def one_bad(point, target):
            nonlocal calls
            calls += 1
            return .0006 if calls == 1 else actual(point, target)
        with patch.object(audit, '_distance', side_effect=one_bad):
            report = self.run_audit()
        self.assertIs(report['sampledBoundaryBudgetPassed'], False)
        self.assertEqual(report['status'], 'sampled-budget-exceeded')
        self.assertEqual(report['variants']['raw']['forwardWorst']['maximumMM'], .0006)
        self.assertIs(report['wholeScrewAccepted'], False)
        self.assertIs(report['exactSourceSupportVerified'], False)

    def test_nonfinite_distance_does_not_publish_report(self):
        with patch.object(audit, '_distance', return_value=float('nan')):
            with self.assertRaisesRegex(ValueError, 'Nonfinite/negative'):
                self.run_audit()
        self.assert_no_success()

    def test_existing_output_missing_parent_and_size_preflight(self):
        self.output.mkdir()
        sentinel = self.output/'keep.txt'
        sentinel.write_bytes(b'unchanged')
        with self.assertRaisesRegex(ValueError, 'fresh output'):
            self.run_audit()
        self.assertEqual(sentinel.read_bytes(), b'unchanged')
        self.output = self.case/'missing'/'result'
        with self.assertRaisesRegex(ValueError, 'existing parent'):
            self.run_audit()
        self.output = self.case/'new'
        actual = Path.stat
        raw_path = self.raw.resolve()
        def too_large(path, *args, **kwargs):
            value = actual(path, *args, **kwargs)
            if path == raw_path:
                fields = list(value)
                fields[6] = audit.MAX_SOURCE_BYTES + 1
                return os.stat_result(fields)
            return value
        with patch.object(Path, 'stat', too_large), patch.object(audit, '_digest') as digest:
            with self.assertRaisesRegex(ValueError, 'oversized'):
                self.run_audit()
            digest.assert_not_called()

    def test_changed_measurement_file_after_fsync_blocks_publication(self):
        actual = audit.os.fsync
        injected = []
        def mutate(fd):
            actual(fd)
            if (self.output/'report.pending.json').exists() and not injected:
                (self.output/'measurements.json').write_bytes(b'{}')
                injected.append(True)
        with patch.object(audit, '_measure', return_value=self.measured), patch.object(audit.os, 'fsync', side_effect=mutate):
            with self.assertRaisesRegex(ValueError, 'Measurement artifact changed'):
                self.run_audit()
        self.assertTrue(injected)
        self.assert_no_success()

    def test_input_hash_change_at_publication_rejects_and_records_false(self):
        actual = audit._digest
        def changed(path, limit):
            if path == self.raw.resolve() and (self.output/'report.pending.json').exists():
                return '0'*64
            return actual(path, limit)
        with patch.object(audit, '_measure', return_value=self.measured), patch.object(audit, '_digest', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'Input changed before publication'):
                self.run_audit()
        self.assert_no_success()
        self.assertIs(json.loads((self.output/'rejection.json').read_bytes())['inputFilesUnchanged'], False)

    def test_measurement_output_byte_limit_rejects_without_success(self):
        with patch.object(audit, '_measure', return_value=self.measured), patch.object(audit, 'MAX_MEASUREMENTS_BYTES', 32):
            with self.assertRaisesRegex(ValueError, 'Output JSON byte budget'):
                self.run_audit()
        self.assert_no_success()

    def test_changed_pending_report_is_not_published(self):
        actual = audit.os.fsync
        injected = []
        def mutate(fd):
            actual(fd)
            pending = self.output/'report.pending.json'
            if pending.exists() and not injected:
                with pending.open('ab') as stream:
                    stream.write(b' ')
                injected.append(True)
        with patch.object(audit, '_measure', return_value=self.measured), patch.object(audit.os, 'fsync', side_effect=mutate):
            with self.assertRaisesRegex(ValueError, 'Pending report changed'):
                self.run_audit()
        self.assertTrue(injected)
        self.assert_no_success()

    def test_atomic_publication_failure_resets_pass_flag(self):
        with patch.object(audit, '_measure', return_value=self.measured), patch.object(audit.os, 'link', side_effect=OSError('publication failed')):
            with self.assertRaisesRegex(OSError, 'publication failed'):
                self.run_audit()
        self.assert_no_success()


if __name__ == '__main__':
    unittest.main(verbosity=2)
