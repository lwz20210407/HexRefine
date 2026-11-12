"""Reviewed ring guards and one shared actual-case receipt, not repeated CAD builds."""
import copy
from dataclasses import replace
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import numpy as np

from tools.bolthex import source_ring_brep as ring
from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy


ROOT = os.environ.get('SOURCE_RING_TEST_ROOT')
ACTUAL = all(os.environ.get(key) for key in ('SOURCE_RING_ORIGINAL', 'SOURCE_RING_PHASE', 'SOURCE_RING_FROZEN', 'SOURCE_RING_TEST_ROOT'))


@unittest.skipUnless(ROOT and Path(ROOT).is_dir(), 'Explicit task-local SOURCE_RING_TEST_ROOT required')
class BoundedIOTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_json_limit_plus_one_prevents_parse_of_growing_input(self):
        path = self.root/'report.json'
        path.write_bytes(b'{"ok":true}')
        with self.assertRaisesRegex(ValueError, 'JSON input grew'):
            ring._json(path, 5)
        self.assertEqual(ring._json(path, 20), {'ok': True})

    def test_json_reads_only_limit_plus_one_bytes(self):
        class Stream(io.BytesIO):
            requests = []
            def read(self, n=-1):
                self.requests.append(n)
                return super().read(n)
        stream = Stream(b'x'*100)
        with patch.object(Path, 'open', return_value=stream):
            with self.assertRaisesRegex(ValueError, 'JSON input grew'):
                ring._json(self.root/'growth.json', 9)
        self.assertEqual(stream.requests, [10])

    def test_hash_stream_count_rejects_growth(self):
        path = self.root/'growing'
        path.write_bytes(b'0123456789')
        with patch.object(ring, 'MAX_INPUT_BYTES', 9):
            with self.assertRaisesRegex(ValueError, 'Hash input grew'):
                ring._sha(path)
        self.assertEqual(ring._sha(path), hashlib.sha256(path.read_bytes()).hexdigest())

    def test_duplicate_and_nonfinite_json_rejected(self):
        path = self.root/'bad.json'
        for text in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}', '[]'):
            with self.subTest(text=text):
                path.write_text(text)
                with self.assertRaises(ValueError):
                    ring._json(path)

    def test_invalid_policy_precedes_any_input_access(self):
        for policy in (CadAccuracyPolicy(), CadAccuracyPolicy.engineering(.3), CadAccuracyPolicy.engineering(.00486)):
            with self.subTest(policy=policy), patch.object(ring, '_sha', side_effect=AssertionError('No input hash allowed')):
                with self.assertRaisesRegex(ValueError, 'approved engineering'):
                    ring.build_source_ring('missing-raw', 'missing-phase', 'missing-frozen', self.root/'new', geometry_policy=policy)


@unittest.skipUnless(ACTUAL, 'Explicit reviewed raw/phase/frozen paths required')
class ReviewedRingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = Path(os.environ['SOURCE_RING_ORIGINAL'])
        cls.phase = Path(os.environ['SOURCE_RING_PHASE'])
        cls.frozen = Path(os.environ['SOURCE_RING_FROZEN'])
        cls.policy_report = cls.phase.parent/'report.json'
        cls.policy = CadAccuracyPolicy.engineering(.2)
        cls.tmp = tempfile.TemporaryDirectory(prefix='ring-tests-', dir=ROOT)
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.work = Path(cls.tmp.name)
        cls.preflight = ring._preflight(cls.original, cls.phase, cls.frozen, cls.work/'unused', cls.policy, None)
        _, _, cls.hashes, cls.mesh, cls.source, cls.parents, cls.child_parent, cls.supports = cls.preflight
        cls.assembly = ring._assemble(cls.mesh, cls.source, cls.parents, cls.child_parent)

    @classmethod
    def tearDownClass(cls):
        if any(ring._sha(path) != digest for path, digest in cls.hashes.items()):
            raise AssertionError('Reviewed source/frozen inputs changed')

    def setUp(self):
        self.case_tmp = tempfile.TemporaryDirectory(dir=self.work)
        self.addCleanup(self.case_tmp.cleanup)
        self.case = Path(self.case_tmp.name)
        self.output = self.case/'output'

    def test_all2160_face_graph_and_internal_side_cycles(self):
        a = self.assembly
        self.assertEqual(len(a['physical']), 4396)
        self.assertEqual(len(a['sidePairs']), 4282)
        for rows in a['sidePairs']:
            self.assertEqual(ring.endpoint._cycle(rows[0]['nodeIDs']), ring.endpoint._cycle(rows[1]['nodeIDs'][::-1]))
        counts = {name: sum(p['role'] == name for p in a['physical']) for name in ('protected-outer-source', 'inner-core-interface', 'annular-source-end')}
        self.assertEqual(counts, {'protected-outer-source': 2160, 'inner-core-interface': 2160, 'annular-source-end': 76})

    def test_actual_slice_volume_and_frozen_mesh_are_distinct(self):
        v = self.assembly['integrals']
        self.assertAlmostEqual(v['sourceRingIntegral'], 14.089699692691257, places=11)
        self.assertLess(v['maximumParentSliceRelativeError'], 1e-12)
        self.assertLess(v['maximumParentPoint64RelativeError'], 1e-12)
        self.assertLessEqual(v['phaseControlNetCodecGapMM'], v['codecBoundMM'])
        self.assertGreater(v['minimumMacroGaussDeterminant'], 0)
        self.assertNotEqual(v['frozen15120Integral'], v['sourceRingIntegral'])

    def test_wrong_frozen_inner_corner_rejected_without_kernel(self):
        parents = copy.deepcopy(self.parents)
        parents[0]['innerCoarseCorners'][0], parents[0]['innerCoarseCorners'][1] = parents[0]['innerCoarseCorners'][1], parents[0]['innerCoarseCorners'][0]
        with patch.object(ring.cad, '_kernel', side_effect=AssertionError('CAD must not start')):
            with self.assertRaisesRegex(ValueError, 'inner corner|ordered inner'):
                ring._assemble(self.mesh, self.source, parents, self.child_parent)

    def test_protected_outer_source_cycle_rejected_without_kernel(self):
        parents = copy.deepcopy(self.parents)
        parents[0]['nodeIDs'].reverse()
        with patch.object(ring.cad, '_kernel', side_effect=AssertionError('CAD must not start')):
            with self.assertRaisesRegex(ValueError, 'Protected outer'):
                ring._assemble(self.mesh, self.source, parents, self.child_parent)

    def test_invalid_internal_side_orientation_rejected_without_kernel(self):
        faces = ring.FACES.copy()
        faces[0] = faces[0][::-1]
        with patch.object(ring, 'FACES', faces), patch.object(ring.cad, '_kernel', side_effect=AssertionError('CAD must not start')):
            with self.assertRaisesRegex(ValueError, 'side orientation'):
                ring._assemble(self.mesh, self.source, self.parents, self.child_parent)

    def test_inner_core_opposite_cycle_rejected_without_kernel(self):
        parents = copy.deepcopy(self.parents)
        parents[0]['innerCoarseCornersCavityOutward'].reverse()
        with patch.object(ring.cad, '_kernel', side_effect=AssertionError('CAD must not start')):
            with self.assertRaisesRegex(ValueError, 'core opposite cycle'):
                ring._assemble(self.mesh, self.source, parents, self.child_parent)

    def test_existing_output_unchanged(self):
        self.output.mkdir()
        sentinel = self.output/'keep'
        sentinel.write_text('user data')
        with self.assertRaisesRegex(ValueError, 'new output directory'):
            ring.build_source_ring(self.original, self.phase, self.frozen, self.output, geometry_policy=self.policy)
        self.assertEqual(sentinel.read_text(), 'user data')

    def test_immutable_input_directory_output_rejected(self):
        for parent in (self.original.parent, self.phase.parent, self.frozen):
            destination = parent/(self.case.name+'-forbidden')
            self.assertFalse(destination.exists())
            with self.assertRaisesRegex(ValueError, 'outside immutable'):
                ring.build_source_ring(self.original, self.phase, self.frozen, destination, geometry_policy=self.policy)
            self.assertFalse(destination.exists())

    def test_prehash_size_inventory_all_inputs(self):
        original_stat = Path.stat
        for chosen in (self.original, self.phase, self.policy_report, self.frozen/'report.json', self.frozen/'node-supports.json', self.frozen/'composite.npz'):
            def stat(path, *args, **kwargs):
                value = original_stat(path, *args, **kwargs)
                if path == chosen:
                    fields = list(value)
                    fields[6] = ring.MAX_INPUT_BYTES+1
                    return os.stat_result(fields)
                return value
            with self.subTest(path=chosen), patch.object(Path, 'stat', autospec=True, side_effect=stat), patch.object(ring, '_sha', side_effect=AssertionError('Oversized input must not be hashed')):
                with self.assertRaisesRegex(ValueError, 'oversized input before hashing'):
                    ring.build_source_ring(self.original, self.phase, self.frozen, self.output, geometry_policy=self.policy)

    def test_negative_policy_report_hash_rejected_before_loader(self):
        folder = self.case/'inputs'
        folder.mkdir()
        path = folder/'report.json'
        value = json.loads(self.policy_report.read_bytes())
        value['outputKSHA256'] = '0'*64
        path.write_text(json.dumps(value))
        with patch.object(ring.endpoint, '_load', side_effect=AssertionError('Loader must not run')):
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                ring.build_source_ring(self.original, self.phase, self.frozen, self.output, geometry_policy=self.policy, phase_report=path)
        self.assertFalse(self.output.exists())

    def test_negative_frozen_artifact_hash_rejected_before_kernel(self):
        frozen = self.case/'frozen'
        frozen.mkdir()
        (frozen/'handoff.json').write_text(json.dumps({'artifacts': {name: {'sha256': '0'*64} for name in ('report.json', 'composite.npz', 'node-supports.json')}}))
        for name in ('report.json', 'composite.npz', 'node-supports.json'):
            (frozen/name).write_bytes(b'{}')
        with patch.object(ring.cad, '_kernel', side_effect=AssertionError('Kernel must not run')):
            with self.assertRaisesRegex(ValueError, 'Frozen artifact hash mismatch'):
                ring.build_source_ring(self.original, self.phase, frozen, self.output, geometry_policy=self.policy)
        self.assertFalse(self.output.exists())

    def _publication_fault(self, stage):
        """Publication unit controls use mock CAD bytes, never fake actual-case evidence."""
        fake_data = b'UNIT TEST SYNTHETIC BYTES ONLY\n'
        fake_hash = hashlib.sha256(fake_data).hexdigest()
        state = dict(volume=self.assembly['integrals']['actualSourceRadialSliceIntegral'], maximumOutputTolerance=1e-7)
        receipt = dict(path='source-ring.brep', bytes=len(fake_data), sha256=fake_hash, before=state, after=state)
        assembly = dict(coordinates={}, physical=[], sidePairs=[], integrals=self.assembly['integrals'])
        hashes = dict(self.hashes)
        control = self.case/'owned-control-input.json'
        control.write_bytes(b'{"value":1}')
        if stage == 'input':
            hashes[str(control)] = ring._sha(control)
        values = (self.policy, self.output, hashes, self.mesh, self.source, self.parents, self.child_parent, self.supports)
        def save(*args):
            (self.output/'source-ring.brep').write_bytes(fake_data)
            return object(), copy.deepcopy(receipt)
        count = [0]
        def check(*args):
            count[0] += 1
            if stage == 'after-cold' and count[0] == 2:
                (self.output/'source-ring.brep').write_bytes(fake_data+b'changed')
            return []
        original_fsync = ring.os.fsync
        original_sha = ring._sha
        producer_hashes = [0]
        def sha(path):
            if Path(path).resolve() == Path(ring.__file__).resolve():
                producer_hashes[0] += 1
                if stage == 'producer' and producer_hashes[0] == 2:
                    return '0'*64
            return original_sha(path)
        def fsync(fd):
            original_fsync(fd)
            if stage == 'artifact':
                (self.output/'source-ring.brep').write_bytes(fake_data+b'changed')
            elif stage == 'pending':
                path = self.output/'report.pending.json'
                payload = path.read_bytes()
                self.assertIn(b'"ringGeometryChecksPassed": true', payload)
                # Same-length, valid JSON mutation: a byte-count check alone is insufficient.
                path.write_bytes(payload.replace(b'"radialInterval":', b'"radialIntervaL":', 1))
            elif stage == 'input':
                control.write_bytes(b'{"value":2}')
        with patch.object(ring, '_preflight', return_value=values), patch.object(ring, '_assemble', return_value=assembly), \
                patch.object(ring.cad, '_kernel', return_value=MagicMock()), patch.object(ring.cad, '_sew', return_value=(object(), {})), \
                patch.object(ring, '_face_binding_check', side_effect=check), patch.object(ring.cad, '_save_reopen', side_effect=save), \
                patch.object(ring.os, 'fsync', side_effect=fsync), patch.object(ring, '_sha', side_effect=sha):
            with self.assertRaisesRegex(ValueError, 'input changed during' if stage == 'input' else 'changed before publication'):
                ring.build_source_ring(self.original, self.phase, self.frozen, self.output, geometry_policy=self.policy)
        self.assertFalse((self.output/'report.json').exists())
        rejection = json.loads((self.output/'rejection.json').read_bytes())
        self.assertFalse(rejection['ringGeometryChecksPassed'])
        self.assertEqual(rejection['sourceFilesUnchanged'], stage != 'input')
        for name in ('wholeScrewAccepted', 'meshAccepted', 'engineeringGeometryAccepted'):
            self.assertFalse(rejection[name])

    def test_fsync_artifact_mutation_blocks_publication(self):
        self._publication_fault('artifact')

    def test_after_cold_before_manifest_mutation_blocks_publication(self):
        self._publication_fault('after-cold')

    def test_same_size_pending_report_mutation_blocks_publication(self):
        self._publication_fault('pending')

    def test_publication_input_change_rejection_does_not_claim_unchanged(self):
        self._publication_fault('input')

    def test_producer_change_blocks_publication_without_editing_repo(self):
        self._publication_fault('producer')

    @unittest.skipUnless(os.environ.get('SOURCE_RING_ACTUAL_REPORT'), 'One existing actual CLI output receipt required')
    def test_one_actual4396_face_cold_receipt_and_bound_artifacts(self):
        path = Path(os.environ['SOURCE_RING_ACTUAL_REPORT'])
        r = json.loads(path.read_bytes())
        self.assertTrue(r['ringGeometryChecksPassed'])
        self.assertEqual(r['builderSHA256'], ring._sha(Path(ring.__file__)))
        self.assertTrue(r['producerFileCapturedBeforeConstruction'])
        self.assertEqual(r['geometryAccuracyPolicy'], self.policy.manifest())
        self.assertEqual(r['constructionToleranceMM'], 1e-7)
        self.assertEqual(r['sewing']['inputFaces'], 4396)
        self.assertEqual(r['sewing']['freeEdges'], 0)
        self.assertEqual(r['sewing']['multipleEdges'], 0)
        self.assertEqual(r['sewing']['deletedFaces'], 0)
        self.assertTrue(r['liveAndColdAll4396PolesAndTrimsMatched'])
        state = r['readback']['after']
        self.assertEqual(state['topology']['faces'], 4396)
        self.assertEqual(state['topology']['solids'], 1)
        self.assertEqual(state['topology']['shells'], 1)
        self.assertEqual(state['topology']['physicalEdges'], 8792)
        self.assertEqual(state['maximumOutputTolerance'], 1e-7)
        self.assertEqual(r['readback']['relativeVolumeChange'], 0.)
        self.assertAlmostEqual(state['volume'], 14.089699692691264, places=11)
        for artifact in r['artifacts']:
            output = path.parent/artifact['path']
            self.assertEqual(output.stat().st_size, artifact['bytes'])
            self.assertEqual(ring._sha(output), artifact['sha256'])
        brep = next(a for a in r['artifacts'] if a['path'] == 'source-ring.brep')
        self.assertEqual(brep['sha256'], r['readback']['before']['stateSHA256'])
        bindings = json.loads((path.parent/'source-face-bindings.json').read_bytes())
        self.assertEqual(len(bindings), 4396)
        self.assertTrue(all(row['sourcePolesExactlyMatched'] and row['completeUnsplitSourceSquareTrim'] for row in bindings))
        self.assertEqual(len(json.loads((path.parent/'internal-side-cycles.json').read_bytes())['internalPairs']), 4282)
        for name in ('independentDesignCAD', 'wholeScrewAccepted', 'meshAccepted', 'coreMeshed', 'neckBooleanExecuted', 'engineeringGeometryAccepted', 'globalOverlapCertified'):
            self.assertFalse(r[name], name)


if __name__ == '__main__':
    unittest.main(verbosity=2)
