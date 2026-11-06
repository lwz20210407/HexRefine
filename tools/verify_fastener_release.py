"""Bounded source-tree acceptance; no CAD, host or solver claims by inference."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import subprocess
import sys

STATUSES = {'pass', 'fail', 'not_run', 'unsupported', 'partial'}
ORACLES = {'cad', 'hm', 'gui', 'r11', 'independent_engine', 'contact_preload', 'screw'}
OPTIONAL_ORACLES = {'r11', 'independent_engine', 'contact_preload'}
MESH_ORACLES = ORACLES - OPTIONAL_ORACLES
MAX_JSON = 2 * 1024 * 1024
MAX_ARTIFACT = 16 * 1024 * 1024
COMMANDS = {
    'python_dimensions': ('python', ['-B', '-m', 'unittest', 'tools.tests.test_thread_dimensions', '-v']),
    'node_threaded': ('node', ['--test', 'test/threaded-solid.test.mjs']),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def keys(obj, expected):
    require(isinstance(obj, dict) and set(obj) == set(expected), 'unexpected or missing fields')


def read_json(path):
    require(path.stat().st_size <= MAX_JSON, 'JSON exceeds size budget')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'duplicate JSON key')
            result[key] = value
        return result
    return json.loads(path.read_text(encoding='utf-8-sig'), object_pairs_hook=unique)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def relative_path(name):
    require(isinstance(name, str) and name and ':' not in name and '\\' not in name,
            'paths must be relative POSIX paths')
    path = PurePosixPath(name)
    require(not path.is_absolute() and '..' not in path.parts, 'path traversal')
    require(bool(path.parts), 'artifact path must name a file')
    for part in path.parts:
        require(not part.endswith((' ', '.')) and
                not re.search(r'[<>"|?*\x00-\x1f]', part) and
                not PureWindowsPath(part).is_reserved(),
                'ambiguous or reserved Windows path component')
    return path


def confined(root, name):
    path = relative_path(name)
    resolved = (root / path).resolve()
    require(resolved.is_relative_to(root.resolve()), 'path escapes root')
    return resolved


def validate(manifest, evidence_root=None):
    keys(manifest, {'schema_version', 'scope', 'environment', 'artifacts',
                    'artifact_count', 'commands', 'oracles', 'pending_workstreams'})
    require(type(manifest['schema_version']) is int and manifest['schema_version'] == 1, 'schema version')
    require(manifest['scope'] == 'source-tree-bounded', 'unsupported release scope')
    keys(manifest['environment'], {'python', 'node'})
    for value in manifest['environment'].values():
        require(isinstance(value, str) and 0 < len(value) < 100, 'invalid version')
    artifacts = manifest['artifacts']
    require(isinstance(artifacts, list) and 0 < len(artifacts) <= 32, 'artifact budget')
    require(type(manifest['artifact_count']) is int and manifest['artifact_count'] == len(artifacts), 'artifact count mismatch')
    names = set()
    normalized_names = set()
    resolved_names = set()
    file_ids = set()
    for item in artifacts:
        keys(item, {'path', 'sha256', 'bytes', 'counts'})
        # Manifest identities are case-insensitive for portability to Windows.
        # Schema-only validation must not resolve paths against the caller's cwd.
        normalized = relative_path(item['path']).as_posix().casefold()
        require(normalized not in normalized_names, 'duplicate artifact alias')
        normalized_names.add(normalized)
        if evidence_root is not None:
            resolved = confined(evidence_root, item['path'])
            identity = resolved.as_posix().casefold()
            require(identity not in resolved_names, 'duplicate artifact alias')
            resolved_names.add(identity)
            if resolved.is_file():
                stat = resolved.stat()
                file_id = (stat.st_dev, stat.st_ino)
                if stat.st_ino:
                    require(file_id not in file_ids, 'duplicate physical artifact')
                    file_ids.add(file_id)
        names.add(item['path'])
        require(isinstance(item['sha256'], str) and re.fullmatch('[0-9a-f]{64}', item['sha256']), 'invalid hash')
        require(type(item['bytes']) is int and 0 <= item['bytes'] <= MAX_ARTIFACT, 'artifact byte budget')
        require(isinstance(item['counts'], dict) and len(item['counts']) <= 32, 'counts budget')
        for pointer, count in item['counts'].items():
            require(isinstance(pointer, str) and pointer.startswith('/') and len(pointer) < 256, 'invalid count pointer')
            require(type(count) is int and count >= 0, 'counts must be nonnegative integers')
    commands = manifest['commands']
    require(isinstance(commands, list) and len(commands) <= len(COMMANDS), 'command budget')
    require(all(isinstance(c, str) and c in COMMANDS for c in commands) and len(set(commands)) == len(commands), 'command not allowlisted')
    keys(manifest['oracles'], ORACLES)
    for item in manifest['oracles'].values():
        keys(item, {'status', 'reason', 'evidence'})
        # External reports are historical observations, never a live oracle pass.
        require(item['status'] in STATUSES - {'pass'}, 'external oracle cannot be declared pass')
        require(isinstance(item['reason'], str) and 0 < len(item['reason']) <= 1000, 'oracle reason required')
        require(isinstance(item['evidence'], list) and all(p in names for p in item['evidence']), 'unbound evidence')
        require(item['status'] != 'partial' or item['evidence'], 'partial needs evidence')
    pending = manifest['pending_workstreams']
    require(isinstance(pending, list) and len(pending) <= 64 and all(isinstance(s, str) and 0 < len(s) <= 300 for s in pending), 'pending workstreams')
    return manifest


def aggregate(statuses):
    if 'fail' in statuses:
        return 'fail'
    if statuses and all(s == 'pass' for s in statuses):
        return 'pass'
    if statuses and all(s == 'unsupported' for s in statuses):
        return 'unsupported'
    if not statuses or all(s == 'not_run' for s in statuses):
        return 'not_run'
    return 'partial'


def acceptance_tracks(environment, artifacts, commands, oracles, pending):
    required_paths = {path for name in MESH_ORACLES for path in oracles[name]['evidence']}
    optional_paths = {path for name in OPTIONAL_ORACLES for path in oracles[name]['evidence']}
    # Shared and unclassified artifacts remain required; only exclusive
    # supplemental references are excluded from mesh-delivery acceptance.
    optional_only = optional_paths - required_paths
    mesh_artifacts = [a for a in artifacts if a['path'] not in optional_only]
    supplemental_artifacts = [a for a in artifacts if a['path'] in optional_only]
    smoke_statuses = [v['status'] for v in environment.values()]
    smoke_statuses += [v['status'] for v in commands.values()]
    smoke_statuses += [a['status'] for a in mesh_artifacts]
    mesh_statuses = smoke_statuses + [oracles[name]['status'] for name in sorted(MESH_ORACLES)]
    if pending:
        mesh_statuses.append('partial')
    supplemental_statuses = [oracles[name]['status'] for name in sorted(OPTIONAL_ORACLES)]
    supplemental_statuses += [a['status'] for a in supplemental_artifacts]
    return {
        'source_tree_smoke_integrity': {'status': aggregate(smoke_statuses),
                                       'meaning': 'bounded tests and integrity, not full mesh acceptance'},
        'mesh_delivery': {'status': aggregate(mesh_statuses), 'required': True,
                          'oracle_names': sorted(MESH_ORACLES),
                          'artifact_paths': [a['path'] for a in mesh_artifacts],
                          'p0_quality_scope': ['geometry', 'H8 conformance', 'Jacobian', 'volume', 'IO'],
                          'solver_required': False},
        'supplemental_solver': {'status': aggregate(supplemental_statuses), 'required': False,
                                'oracle_names': sorted(OPTIONAL_ORACLES),
                                'artifact_paths': [a['path'] for a in supplemental_artifacts],
                                'affects_mesh_delivery': False},
    }


def check_artifact(root, item):
    result = {'path': item['path'], 'status': 'fail', 'meaning': 'artifact integrity only, not engineering acceptance'}
    try:
        path = confined(root, item['path'])
        if not path.is_file():
            return dict(result, status='not_run', reason='missing evidence artifact')
        require(path.stat().st_size == item['bytes'], 'byte count mismatch')
        require(digest(path) == item['sha256'], 'SHA256 mismatch')
        if item['counts']:
            data = read_json(path)
            for pointer, expected in item['counts'].items():
                actual = data
                for key in pointer[1:].split('/'):
                    actual = actual[key.replace('~1', '/').replace('~0', '~')]
                require(type(actual) is int and actual == expected, 'count mismatch: ' + pointer)
        return dict(result, status='pass', sha256=item['sha256'], counts=item['counts'])
    except (OSError, ValueError, KeyError, TypeError) as exc:
        return dict(result, reason=str(exc))


def run_fixed(executable, arguments, cwd, env, timeout):
    if not executable.is_absolute() or not executable.is_file():
        return {'status': 'not_run', 'reason': 'explicit runtime missing'}
    try:
        completed = subprocess.run([str(executable), *arguments], cwd=cwd, env=env,
                                   capture_output=True, text=True, errors='replace',
                                   timeout=timeout, shell=False)
        # Do not persist potentially sensitive raw child output.
        output = completed.stdout + completed.stderr
        skipped = bool(re.search(r'skipped=[1-9]|# skipped [1-9]|# tests 0|Ran 0 tests', output))
        return {'status': 'fail' if completed.returncode else ('partial' if skipped else 'pass'),
                'returncode': completed.returncode, 'output_sha256': hashlib.sha256(output.encode()).hexdigest(),
                'skips_or_empty_suite': skipped, '_stdout': completed.stdout.strip()}
    except subprocess.TimeoutExpired:
        return {'status': 'fail', 'reason': 'fixed command exceeded timeout'}
    except OSError:
        return {'status': 'not_run', 'reason': 'runtime could not start'}


def accept(manifest, evidence_root, output_root, run_name, repo, runtimes, execute=False):
    require(evidence_root.is_absolute() and evidence_root.is_dir(),
            'explicit existing absolute evidence root required')
    validate(manifest, evidence_root)
    require(output_root.is_absolute() and output_root.is_dir(), 'explicit existing absolute output root required')
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', run_name), 'invalid run name')
    target = confined(output_root, run_name)
    require(not target.exists(), 'run directory must be fresh')
    target.mkdir()
    env = os.environ.copy()
    for key in ('TEMP', 'TMP', 'TMPDIR', 'BOLTHEX_TEST_ROOT', 'HEXREFINE_TEST_OUTPUT'):
        env[key] = str(target)
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    env['HEXREFINE_NODE'] = str(runtimes['node'])
    env['PYTHONPATH'] = str(repo)
    for key in tuple(env):
        if key.startswith('HEXREFINE_RUN_SLOW'):
            env.pop(key)
    environment = {}
    for tool, expected in manifest['environment'].items():
        result = run_fixed(runtimes[tool], ['--version'], target, env, 10)
        actual = result.pop('_stdout', None)
        if result['status'] == 'pass' and actual != expected:
            result['status'] = 'fail'
        environment[tool] = dict(result, expected=expected, actual=actual, executable=str(runtimes[tool]))
    artifacts = [check_artifact(evidence_root, item) for item in manifest['artifacts']]
    commands = {}
    for name in manifest['commands']:
        tool, arguments = COMMANDS[name]
        if not execute or environment[tool]['status'] != 'pass':
            result = {'status': 'not_run', 'reason': 'execution disabled or runtime mismatch'}
        else:
            result = run_fixed(runtimes[tool], arguments, repo, env, 60)
            result.pop('_stdout', None)
        commands[name] = result
    report = {'schema_version': 1, 'scope': manifest['scope'], 'full_feature_release': False,
              'engineering_contact_preload_certified': False,
              'environment': environment, 'artifacts': artifacts, 'commands': commands,
              'oracles': manifest['oracles'], 'pending_workstreams': manifest['pending_workstreams'],
              'declared_artifact_count': manifest['artifact_count'],
              'verified_artifact_count': sum(a['status'] == 'pass' for a in artifacts),
              'manifest_sha256': hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest(),
              'harness_sha256': digest(Path(__file__)),
              'limits': {'artifact_bytes': MAX_ARTIFACT, 'command_seconds': 60, 'version_seconds': 10},
              'evidence_root': str(evidence_root.resolve()), 'repository': str(repo.resolve())}
    report['acceptance_policy'] = 'mesh-first-2026-11-06-v1'
    report['tracks'] = acceptance_tracks(environment, artifacts, commands,
                                         manifest['oracles'], manifest['pending_workstreams'])
    report['status'] = report['tracks']['mesh_delivery']['status']
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    (target / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ('manifest', 'evidence-root', 'output-root', 'python', 'node'):
        parser.add_argument('--' + arg, type=Path, required=True)
    parser.add_argument('--run-name', required=True)
    parser.add_argument('--execute-smoke', action='store_true')
    args = parser.parse_args()
    try:
        report = accept(read_json(args.manifest), args.evidence_root, args.output_root,
                        args.run_name, Path(__file__).resolve().parents[1],
                        {'python': args.python, 'node': args.node}, args.execute_smoke)
    except (ValueError, OSError, TypeError) as exc:
        parser.exit(2, 'Invalid release input: ' + str(exc) + '\n')
    print(json.dumps({'status': report['status'], 'full_feature_release': False}))
    return 0 if report['status'] == 'pass' else (1 if report['status'] == 'fail' else 3)


if __name__ == '__main__':
    sys.exit(main())
