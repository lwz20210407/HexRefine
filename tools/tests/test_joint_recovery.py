import importlib.util,json,os,tempfile,time,unittest,uuid
from unittest.mock import patch
from pathlib import Path
from tools.hexrefine_joint_server import JointJobs
from tools.joint_session_store import write_record


@unittest.skipUnless(os.environ.get('HEXREFINE_JOINT_HTTP')=='1' and os.environ.get('HEXREFINE_NODE') and importlib.util.find_spec('meshio'),
                     'Recovery integration requires configured native generation')
class JointRecoveryTests(unittest.TestCase):
    def setUp(self):
        if not os.environ.get('BOLTHEX_TEST_ROOT'):self.skipTest('Explicit output root required')
        self.tmp=tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT'])
        self.addCleanup(self.tmp.cleanup)
        self.node=os.environ['HEXREFINE_NODE'];self.output=Path(self.tmp.name)

    def service(self):
        jobs=JointJobs(self.output,self.node,60);self.addCleanup(jobs.close);return jobs

    def completed(self,jobs):
        started=jobs.start(dict(schemaVersion=1,parameters={'connection_mode':'separate'}))
        job=jobs.jobs[started['id']];job['watcher'].join(60)
        result=jobs.snapshot(started['id']);self.assertEqual(result['state'],'succeeded',result)
        return started['id']

    def test_restart_reopens_hash_bound_actual_result(self):
        first=self.service();identity=self.completed(first)
        before=first.snapshot(identity);first.close()
        second=self.service();after=second.snapshot(identity)
        self.assertEqual(before,after)
        self.assertTrue(second.inventory()[0]['restored'])
        self.assertTrue(second.artifact(identity,'model.k').is_file())
        self.assertTrue(after['report']['nodeOwnership']['componentNodeSetsDisjoint'])

    def test_running_records_become_interrupted_without_pid_killing(self):
        identity=uuid.uuid4().hex;directory=self.output/identity;directory.mkdir()
        write_record(directory/'job.json',dict(schemaVersion=1,id=identity,state='running',error=None,created=time.time()))
        jobs=self.service();snapshot=jobs.snapshot(identity)
        self.assertEqual(snapshot['state'],'interrupted');self.assertNotIn('files',snapshot)
        self.assertIn('not resumed automatically',snapshot['error'])

    def test_tampered_artifact_is_rejected_on_restart_and_download(self):
        first=self.service();identity=self.completed(first)
        path=first.jobs[identity]['directory']/'result'/'merged.inp'
        with path.open('a') as stream:stream.write('** changed after audit\n')
        with self.assertRaisesRegex(RuntimeError,'changed after audit'):first.artifact(identity,'merged.inp')
        self.assertNotIn('files',first.snapshot(identity));first.close()
        second=self.service();self.assertEqual(second.snapshot(identity)['state'],'failed');second.close()
        # Restore a success claim with the original hashes: recovery must verify,
        # not trust the state field or the files merely being present.
        record=json.loads((path.parent.parent/'job.json').read_text())
        record.update(state='succeeded',hashes=first.jobs[identity]['hashes'])
        write_record(path.parent.parent/'job.json',record)
        third=self.service();self.assertEqual(third.snapshot(identity)['state'],'failed')
        self.assertIn('hash differs',third.snapshot(identity)['error'])

    def test_same_output_directory_cannot_have_two_live_owners(self):
        first=self.service()
        with self.assertRaisesRegex(RuntimeError,'already owned'):JointJobs(self.output,self.node)
        first.close();second=self.service();self.assertEqual(second.inventory(),[])

    def test_spawn_failure_persists_failure_not_a_running_record(self):
        jobs=self.service()
        with patch('tools.hexrefine_joint_server.subprocess.Popen',side_effect=OSError('spawn rejected')):
            with self.assertRaisesRegex(OSError,'spawn rejected'):jobs.start(dict(schemaVersion=1,parameters={}))
        jobs.close();restored=self.service()
        self.assertEqual(len(restored.inventory()),1)
        record=restored.snapshot(restored.inventory()[0]['id'])
        self.assertEqual(record['state'],'failed');self.assertNotIn('files',record)

    def test_initial_persistence_failure_does_not_launch_a_child(self):
        jobs=self.service()
        with patch('tools.hexrefine_joint_server.write_record',side_effect=PermissionError('disk rejected')),patch('tools.hexrefine_joint_server.subprocess.Popen') as spawn:
            with self.assertRaises(PermissionError):jobs.start(dict(schemaVersion=1,parameters={}))
            spawn.assert_not_called()

    def test_terminal_persistence_failure_does_not_publish_files(self):
        jobs=self.service();identity=uuid.uuid4().hex;directory=self.output/identity;directory.mkdir()
        job=dict(id=identity,state='succeeded',error=None,created=time.time(),directory=directory,hashes={})
        jobs.jobs[identity]=job
        with patch('tools.hexrefine_joint_server.write_record',side_effect=PermissionError('disk rejected')):jobs._finish(job)
        self.assertEqual(jobs.snapshot(identity)['state'],'failed')
        self.assertNotIn('files',jobs.snapshot(identity))
