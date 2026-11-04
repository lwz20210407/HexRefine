import json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from tools.hexrefine_jobs import NativeMeshJob


class StatusPersistenceTests(unittest.TestCase):
    def test_transient_windows_access_error_preserves_atomic_status(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as directory:
            job=NativeMeshJob.__new__(NativeMeshJob);job.directory=Path(directory);job._state={'status':'running'}
            target=job.directory/'status.json';target.write_text('{"status":"old"}')
            error=PermissionError('temporary access denial');error.winerror=5
            original=Path.replace;calls=[]
            def replace(path,destination):
                calls.append(path)
                if len(calls)<3:
                    self.assertEqual(json.loads(target.read_text()),{'status':'old'})
                    raise error
                return original(path,destination)
            with patch.object(Path,'replace',replace),patch('tools.hexrefine_jobs.time.sleep') as sleep:
                job._persist()
            self.assertEqual(len(calls),3);self.assertEqual(sleep.call_count,2)
            self.assertEqual(json.loads(target.read_text()),job._state)
            self.assertFalse((job.directory/'status.json.partial').exists())

    def test_permanent_windows_error_is_bounded_and_not_hidden(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as directory:
            job=NativeMeshJob.__new__(NativeMeshJob);job.directory=Path(directory);job._state={'status':'running'}
            error=PermissionError('persistent denial');error.winerror=5
            with patch.object(Path,'replace',side_effect=error) as replace,patch('tools.hexrefine_jobs.time.sleep') as sleep:
                with self.assertRaises(PermissionError):job._persist()
            self.assertEqual(replace.call_count,8);self.assertEqual(sleep.call_count,7)

    def test_other_permission_errors_are_not_retried(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as directory:
            job=NativeMeshJob.__new__(NativeMeshJob);job.directory=Path(directory);job._state={}
            with patch.object(Path,'replace',side_effect=PermissionError('unclassified denial')) as replace:
                with self.assertRaises(PermissionError):job._persist()
            self.assertEqual(replace.call_count,1)
