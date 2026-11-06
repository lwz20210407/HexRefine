import copy
import json
import os
import re
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools import verify_fastener_release as release


def explicit_test_root():
    value = os.environ.get('BOLTHEX_TEST_ROOT')
    if value:
        root = Path(value)
        if root.is_absolute() and root.is_dir():
            root = root.resolve()
            parts = root.parts
            if any(parts[i].casefold() == 'temp' and
                   re.fullmatch(r'\d{8}-.+', parts[i + 1])
                   for i in range(len(parts) - 1)):
                return root
    raise unittest.SkipTest('Set BOLTHEX_TEST_ROOT to an existing absolute temp/YYYYMMDD-task directory or descendant')


class ScratchGuardTests(unittest.TestCase):
    def test_no_temp_allocation_without_explicit_dated_scratch(self):
        for value in [None, '', 'relative/path', str(Path(__file__).resolve().parent),
                      str(Path(__file__).resolve().parent / 'absent')]:
            with self.subTest(value=value), patch.dict(os.environ, {}, clear=True):
                if value is not None:
                    os.environ['BOLTHEX_TEST_ROOT'] = value
                with patch.object(tempfile, 'TemporaryDirectory') as allocate:
                    with self.assertRaises(unittest.SkipTest):
                        ReleaseTests().setUp()
                    allocate.assert_not_called()


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=explicit_test_root())
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.evidence = self.root / 'm6.json'
        self.evidence.write_text('{"H8":333824,"cad":{"faces":94}}', encoding='utf-8')
        self.manifest = {
            'schema_version': 1, 'scope': 'source-tree-bounded',
            'environment': {'python': 'Python 3.12.13', 'node': 'v24.13.0'},
            'artifacts': [{'path': 'm6.json', 'sha256': release.digest(self.evidence),
                           'bytes': self.evidence.stat().st_size,
                           'counts': {'/H8': 333824, '/cad/faces': 94}}],
            'artifact_count': 1, 'commands': [],
            'oracles': {key: {'status': 'not_run', 'reason': 'not executed', 'evidence': []}
                        for key in release.ORACLES},
            'pending_workstreams': ['Screw finite-axis core and endpoints'],
        }

    def test_status_algebra(self):
        for inputs, expected in [([], 'not_run'), (['pass'], 'pass'),
                                 (['pass', 'not_run'], 'partial'),
                                 (['unsupported'], 'unsupported'),
                                 (['partial', 'fail'], 'fail')]:
            self.assertEqual(release.aggregate(inputs), expected)

    def test_optional_solver_states_do_not_gate_mesh_delivery(self):
        # Synthetic reducer inputs exercise gating, not externally declared passes.
        oracles = {name: {'status': 'pass', 'evidence': []} for name in release.ORACLES}
        for state in ['not_run', 'unsupported', 'partial', 'fail']:
            for name in release.OPTIONAL_ORACLES:
                oracles[name]['status'] = state
            tracks = release.acceptance_tracks({}, [], {}, oracles, [])
            self.assertEqual(tracks['mesh_delivery']['status'], 'pass')
            self.assertEqual(tracks['supplemental_solver']['status'], state)
            self.assertFalse(tracks['mesh_delivery']['solver_required'])

    def test_optional_missing_artifact_does_not_gate_but_shared_one_does(self):
        oracles = {name: {'status': 'pass', 'evidence': []} for name in release.ORACLES}
        oracles['independent_engine'] = {'status': 'not_run', 'evidence': ['optional.json']}
        artifacts = [{'path': 'mesh.json', 'status': 'pass'},
                     {'path': 'optional.json', 'status': 'not_run'}]
        tracks = release.acceptance_tracks({}, artifacts, {}, oracles, [])
        self.assertEqual(tracks['mesh_delivery']['status'], 'pass')
        self.assertEqual(tracks['mesh_delivery']['artifact_paths'], ['mesh.json'])
        oracles['cad']['evidence'] = ['optional.json']
        tracks = release.acceptance_tracks({}, artifacts, {}, oracles, [])
        self.assertEqual(tracks['mesh_delivery']['status'], 'partial')

    def test_required_failure_and_pending_workstreams_still_gate(self):
        oracles = {name: {'status': 'pass', 'evidence': []} for name in release.ORACLES}
        tracks = release.acceptance_tracks({}, [], {}, oracles, ['Screw core'])
        self.assertEqual(tracks['mesh_delivery']['status'], 'partial')
        oracles['screw']['status'] = 'fail'
        tracks = release.acceptance_tracks({}, [], {}, oracles, [])
        self.assertEqual(tracks['mesh_delivery']['status'], 'fail')

    def test_integrity_and_counts(self):
        artifact = self.manifest['artifacts'][0]
        self.assertEqual(release.check_artifact(self.root, artifact)['status'], 'pass')
        artifact['counts']['/H8'] = 1
        self.assertEqual(release.check_artifact(self.root, artifact)['status'], 'fail')

    def test_missing_and_modified_artifacts(self):
        artifact = self.manifest['artifacts'][0]
        artifact['sha256'] = '0' * 64
        self.assertEqual(release.check_artifact(self.root, artifact)['status'], 'fail')
        self.evidence.unlink()
        self.assertEqual(release.check_artifact(self.root, artifact)['status'], 'not_run')

    def test_reject_commands_and_unknown_fields(self):
        for change in [{'commands': ['echo stolen']}, {'shell': 'cmd'},
                       {'artifact_count': 2}, {'scope': 'all-features'}]:
            manifest = dict(self.manifest, **change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                release.validate(manifest)

    def test_no_declared_oracle_pass(self):
        for oracle in release.ORACLES:
            manifest = copy.deepcopy(self.manifest)
            manifest['oracles'][oracle]['status'] = 'pass'
            with self.subTest(oracle=oracle), self.assertRaises(ValueError):
                release.validate(manifest)

    def test_partial_needs_bound_evidence(self):
        self.manifest['oracles']['hm']['status'] = 'partial'
        with self.assertRaises(ValueError):
            release.validate(self.manifest)
        self.manifest['oracles']['hm']['evidence'] = ['m6.json']
        release.validate(self.manifest)

    def test_paths(self):
        for name in ['../escape', '/absolute', 'C:/escape', 'a\\b']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                release.confined(self.root, name)

    def test_normalized_case_insensitive_aliases_rejected(self):
        for first, second in [('a//b.json', 'a/b.json'), ('A.json', 'a.json'),
                              ('./m6.json', 'm6.json')]:
            manifest = copy.deepcopy(self.manifest)
            manifest['artifacts'][0]['path'] = first
            manifest['artifacts'].append(dict(manifest['artifacts'][0], path=second))
            manifest['artifact_count'] = 2
            with self.subTest(paths=(first, second)), self.assertRaisesRegex(ValueError, 'alias'):
                release.validate(manifest)

    def test_windows_ambiguous_and_device_paths_rejected(self):
        for name in ['m6.json.', 'm6.json ', 'folder./m6.json', 'CON',
                     'NUL.json', 'dir/COM1.txt', 'x\x00.json', 'a?.json', '.']:
            manifest = copy.deepcopy(self.manifest)
            manifest['artifacts'][0]['path'] = name
            with self.subTest(path=name), self.assertRaises(ValueError):
                release.validate(manifest)

    def test_resolved_alias_rejected_inside_evidence_root(self):
        self.manifest['artifacts'].append(dict(self.manifest['artifacts'][0], path='link.json'))
        self.manifest['artifact_count'] = 2
        # Model a resolved link without requiring Windows symlink privileges.
        with patch.object(release, 'confined', return_value=self.evidence):
            with self.assertRaisesRegex(ValueError, 'alias'):
                release.validate(self.manifest, self.root)

    def test_outside_resolved_target_rejected_before_file_inspection(self):
        outside = self.root.parent / 'outside.json'
        original = Path.resolve
        def resolve(path, *args, **kwargs):
            return outside if path == self.evidence else original(path, *args, **kwargs)
        with patch.object(Path, 'resolve', resolve), patch.object(Path, 'is_file') as inspect:
            with self.assertRaisesRegex(ValueError, 'escapes root'):
                release.validate(self.manifest, self.root)
            inspect.assert_not_called()

    def test_optional_evidence_integrity_does_not_gate_actual_report(self):
        optional = dict(self.manifest['artifacts'][0], path='optional.json')
        self.manifest['artifacts'].append(optional)
        self.manifest['artifact_count'] = 2
        self.manifest['oracles']['independent_engine']['evidence'] = ['optional.json']
        for state in ['missing', 'corrupt']:
            if state == 'corrupt':
                (self.root / 'optional.json').write_text('wrong')
            with patch.object(release, 'run_fixed', side_effect=[
                    {'status': 'pass', '_stdout': 'Python 3.12.13'},
                    {'status': 'pass', '_stdout': 'v24.13.0'}]):
                report = release.accept(self.manifest, self.root, self.root, state, self.root,
                                        {'python': Path(sys.executable), 'node': Path(sys.executable)})
            self.assertEqual(report['status'], 'partial')
            self.assertEqual(report['tracks']['source_tree_smoke_integrity']['status'], 'pass')
            self.assertEqual(report['tracks']['supplemental_solver']['status'],
                             'not_run' if state == 'missing' else 'fail')
            self.assertFalse(report['full_feature_release'])

    def test_unclassified_artifact_failure_remains_required(self):
        oracles = {name: {'status': 'pass', 'evidence': []} for name in release.ORACLES}
        tracks = release.acceptance_tracks({}, [{'path': 'unclassified.json', 'status': 'fail'}],
                                           {}, oracles, [])
        self.assertEqual(tracks['mesh_delivery']['status'], 'fail')

    def test_hardlink_alias_rejected_before_output_creation(self):
        alias = self.root / 'alias.json'
        os.link(self.evidence, alias)
        self.manifest['artifacts'].append(dict(self.manifest['artifacts'][0], path=alias.name))
        self.manifest['artifact_count'] = 2
        with self.assertRaisesRegex(ValueError, 'physical artifact'):
            release.accept(self.manifest, self.root, self.root, 'rejected', self.root, {})
        self.assertFalse((self.root / 'rejected').exists())

    def test_schema_validation_does_not_resolve_against_cwd(self):
        with patch.object(release, 'confined', side_effect=AssertionError('unexpected filesystem resolution')):
            release.validate(self.manifest)

    def test_distinct_artifacts_remain_valid(self):
        other = self.root / 'other.json'
        other.write_bytes(self.evidence.read_bytes())
        self.manifest['artifacts'].append(dict(self.manifest['artifacts'][0], path=other.name))
        self.manifest['artifact_count'] = 2
        release.validate(self.manifest, self.root)

    def test_duplicate_json_rejected(self):
        self.evidence.write_text('{"a":1,"a":2}')
        with self.assertRaises(ValueError):
            release.read_json(self.evidence)

    def test_budget_and_bool_count(self):
        for field, value in [('bytes', release.MAX_ARTIFACT + 1), ('counts', {'/H8': True})]:
            manifest = copy.deepcopy(self.manifest)
            manifest['artifacts'][0][field] = value
            with self.assertRaises(ValueError):
                release.validate(manifest)

    def test_missing_runtime_partial_and_fresh_directory(self):
        runtimes = {'python': self.root / 'missing.exe', 'node': self.root / 'missing.exe'}
        result = release.accept(self.manifest, self.root, self.root, 'run', self.root, runtimes)
        self.assertEqual(result['status'], 'partial')
        self.assertFalse(result['full_feature_release'])
        self.assertEqual(result['environment']['python']['status'], 'not_run')
        self.assertEqual(json.loads((self.root / 'run/report.json').read_text())['verified_artifact_count'], 1)
        with self.assertRaises(ValueError):
            release.accept(self.manifest, self.root, self.root, 'run', self.root, runtimes)

    def test_version_mismatch_is_failure(self):
        with patch.object(release, 'run_fixed', return_value={'status': 'pass', '_stdout': 'wrong'}):
            result = release.accept(self.manifest, self.root, self.root, 'version', self.root,
                                    {'python': Path('/python'), 'node': Path('/node')})
        self.assertEqual(result['status'], 'fail')

    def test_skipped_or_empty_test_suite_never_passes(self):
        for output in ['OK (skipped=1)', '# skipped 2', 'Ran 0 tests', '# tests 0']:
            child = subprocess.CompletedProcess([], 0, output, '')
            with patch.object(release.subprocess, 'run', return_value=child):
                result = release.run_fixed(Path(sys.executable), [], self.root, {}, 1)
            self.assertEqual(result['status'], 'partial')

    def test_timeout_and_nonzero_fail(self):
        with patch.object(release.subprocess, 'run', side_effect=subprocess.TimeoutExpired('fixed', 1)):
            self.assertEqual(release.run_fixed(Path(sys.executable), [], self.root, {}, 1)['status'], 'fail')
        child = subprocess.CompletedProcess([], 1, '', 'failed')
        with patch.object(release.subprocess, 'run', return_value=child) as run:
            self.assertEqual(release.run_fixed(Path(sys.executable), [], self.root, {}, 1)['status'], 'fail')
            self.assertFalse(run.call_args.kwargs['shell'])

    def test_disabled_execution_does_not_run_test_command(self):
        self.manifest['commands'] = ['python_dimensions']
        with patch.object(release, 'run_fixed', side_effect=[
                {'status': 'pass', '_stdout': 'Python 3.12.13'},
                {'status': 'pass', '_stdout': 'v24.13.0'}]) as run:
            result = release.accept(self.manifest, self.root, self.root, 'disabled', self.root,
                                    {'python': Path(sys.executable), 'node': Path(sys.executable)})
        self.assertEqual(run.call_count, 2)
        self.assertEqual(result['commands']['python_dimensions']['status'], 'not_run')

    def test_output_root_must_exist_and_run_name_cannot_escape(self):
        for root, name in [(self.root / 'absent', 'run'), (self.root, '../escape')]:
            with self.assertRaises(ValueError):
                release.accept(self.manifest, self.root, root, name, self.root, {})


if __name__ == '__main__':
    unittest.main()
