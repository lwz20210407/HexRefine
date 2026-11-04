import json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from tools.joint_session_store import write_record


@unittest.skipUnless(os.environ.get('BOLTHEX_TEST_ROOT'),'Explicit task output root required')
class JointStoreTests(unittest.TestCase):
    def test_transient_lock_keeps_old_record_until_atomic_replace(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as directory:
            target=Path(directory)/'job.json';write_record(target,{'state':'running'})
            replace=Path.replace;calls=[];error=PermissionError('lock');error.winerror=32
            def attempt(path,destination):
                calls.append(path)
                if len(calls)<3:
                    self.assertEqual(json.loads(target.read_text()),{'state':'running'});raise error
                return replace(path,destination)
            with patch.object(Path,'replace',attempt),patch('tools.joint_session_store.time.sleep'):
                write_record(target,{'state':'succeeded'})
            self.assertEqual(len(calls),3)
            self.assertEqual(json.loads(target.read_text()),{'state':'succeeded'})

    def test_persistent_lock_rejects_without_destroying_old_record(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as directory:
            target=Path(directory)/'job.json';write_record(target,{'state':'running'})
            error=PermissionError('lock');error.winerror=32
            with patch.object(Path,'replace',side_effect=error) as replace,patch('tools.joint_session_store.time.sleep'):
                with self.assertRaises(PermissionError):write_record(target,{'state':'succeeded'})
            self.assertEqual(replace.call_count,8)
            self.assertEqual(json.loads(target.read_text()),{'state':'running'})
