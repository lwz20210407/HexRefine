"""Interrupted-job HTTP retry is fresh regeneration, never checkpoint adoption."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request,urlopen
import uuid
from http.server import ThreadingHTTPServer

from tools.hexrefine_joint_server import JointJobs,handler_for
from tools.joint_session_store import write_record


@unittest.skipUnless(os.environ.get('HEXREFINE_JOINT_HTTP')=='1' and os.environ.get('HEXREFINE_NODE')
                     and importlib.util.find_spec('meshio'),'Explicit native HTTP runtime required')
class InterruptedRetryTests(unittest.TestCase):
    def setUp(self):
        root=os.environ.get('BOLTHEX_TEST_ROOT')
        if not root:self.skipTest('Explicit dated output directory required')
        self.tmp=tempfile.TemporaryDirectory(dir=root);self.output=Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        self.parent=uuid.uuid4().hex;directory=self.output/self.parent;directory.mkdir()
        self.request=dict(schemaVersion=1,parameters=dict(connection_mode='separate',taper_length=2.0))
        self.raw=json.dumps(self.request,indent=2).encode()
        (directory/'request.json').write_bytes(self.raw)
        (directory/'partial-output.txt').write_text('Retained partial output; not a result to resume.')
        write_record(directory/'job.json',dict(schemaVersion=1,id=self.parent,state='running',error=None,
            created=time.time(),pid=os.getpid(),requestSHA256=hashlib.sha256(self.raw).hexdigest()))
        with patch('tools.hexrefine_joint_server.kill_owned') as kill,patch('tools.hexrefine_joint_server.subprocess.Popen') as spawn:
            self.jobs=JointJobs(self.output,os.environ['HEXREFINE_NODE'],60)
            kill.assert_not_called();spawn.assert_not_called()
        self.addCleanup(self.jobs.close)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),handler_for(self.jobs))
        self.thread=threading.Thread(target=self.server.serve_forever);self.thread.start()
        self.addCleanup(self.stop_http)
        self.url=f'http://127.0.0.1:{self.server.server_port}'
        self.before=self.fingerprints()

    def stop_http(self):
        self.server.shutdown();self.thread.join();self.server.server_close()

    def fingerprints(self):
        directory=self.output/self.parent
        return {str(p.relative_to(directory)):(hashlib.sha256(p.read_bytes()).hexdigest(),p.stat().st_mtime_ns)
                for p in directory.rglob('*') if p.is_file()}

    def call(self,path,method='GET',body=None,headers=None):
        data=None if body is None else json.dumps(body).encode()
        with urlopen(Request(self.url+path,method=method,data=data,
                headers={'Content-Type':'application/json',**(headers or {})}),timeout=30) as response:
            return response.status,json.loads(response.read())

    def endpoint(self,identity=None):return '/api/native-joint/jobs/'+(identity or self.parent)+'/retry'

    def terminal(self,identity):
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            job=self.call('/api/native-joint/jobs/'+identity)[1]
            if job['state']!='running':return job
            time.sleep(.05)
        self.fail('Retry did not terminate')

    def error(self,code,path=None,body=None,headers=None):
        with self.assertRaises(HTTPError) as caught:self.call(path or self.endpoint(),'POST',{} if body is None else body,headers)
        self.assertEqual(caught.exception.code,code)

    def test_real_retry_new_uuid_exact_request_parent_unchanged_and_persisted_lineage(self):
        status,child=self.call(self.endpoint(),'POST',{})
        self.assertEqual(status,202);self.assertNotEqual(child['id'],self.parent)
        self.assertEqual(child['parentJobId'],self.parent);self.assertEqual(child['retryMode'],'fresh-regeneration')
        self.assertEqual((self.output/child['id']/'request.json').read_bytes(),self.raw)
        result=self.terminal(child['id']);self.assertEqual(result['state'],'succeeded',result)
        self.assertEqual(result['report']['quality']['elements'],10440)
        self.assertEqual(result['report']['parameters']['taper_length'],2.)
        self.assertEqual(result['report']['parameters']['connection_mode'],'separate')
        self.assertEqual(self.fingerprints(),self.before)
        self.assertNotIn('files',self.jobs.snapshot(self.parent))
        self.jobs.close()
        restored=JointJobs(self.output,os.environ['HEXREFINE_NODE'],60)
        try:
            self.assertEqual(restored.snapshot(child['id'])['parentJobId'],self.parent)
            self.assertEqual(restored.snapshot(child['id'])['state'],'succeeded')
            self.assertEqual(self.fingerprints(),self.before)
        finally:restored.close()

    def test_retry_cannot_override_request_or_cross_origin(self):
        with patch('tools.hexrefine_joint_server.subprocess.Popen') as spawn:
            for body in ({'parameters':{}},{'parentJobId':self.parent},[],True):self.error(400,body=body)
            self.error(403,headers={'Origin':'https://example.invalid'})
            self.error(404,path=self.endpoint('f'*32))
            spawn.assert_not_called()
        self.assertEqual(self.fingerprints(),self.before)

    def test_only_interrupted_state_is_retryable(self):
        with patch('tools.hexrefine_joint_server.subprocess.Popen') as spawn:
            for state in ('running','succeeded','failed','cancelled'):
                self.jobs.jobs[self.parent]['state']=state
                self.error(409)
            self.jobs.jobs[self.parent]['state']='interrupted';spawn.assert_not_called()

    def test_changed_request_rejects_without_new_folder_or_process(self):
        path=self.output/self.parent/'request.json';path.write_text(json.dumps(dict(schemaVersion=1,parameters={})))
        before=self.fingerprints()
        with patch('tools.hexrefine_joint_server.subprocess.Popen') as spawn:
            self.error(400);spawn.assert_not_called()
        self.assertEqual(self.fingerprints(),before);self.assertEqual(len(self.jobs.jobs),1)

    def test_session_disk_and_changed_budget_are_rechecked(self):
        with patch('tools.hexrefine_joint_server.subprocess.Popen') as spawn:
            self.jobs.started=32;self.error(409);self.jobs.started=0
            with patch('tools.hexrefine_joint_server.shutil.disk_usage',return_value=SimpleNamespace(free=0)):self.error(409)
            with patch.object(self.jobs,'plan',side_effect=ValueError('Current element budget exceeded')):self.error(400)
            spawn.assert_not_called()
        self.assertEqual(len(self.jobs.jobs),1);self.assertEqual(self.fingerprints(),self.before)

    def test_concurrent_retry_one_active_and_cancel_does_not_touch_source(self):
        release=threading.Event();original=self.jobs._watch
        def watch(job,log):release.wait(10);original(job,log)
        responses=[]
        def request():
            try:responses.append(self.call(self.endpoint(),'POST',{}))
            except HTTPError as exc:responses.append((exc.code,None))
        try:
            with patch.object(self.jobs,'_watch',side_effect=watch):
                threads=[threading.Thread(target=request) for _ in range(2)]
                for thread in threads:thread.start()
                for thread in threads:thread.join(30)
                self.assertEqual(sorted(status for status,_ in responses),[202,409])
                child=next(job for status,job in responses if status==202)
                self.call('/api/native-joint/jobs/'+child['id'],'DELETE')
        finally:release.set()
        done=self.terminal(child['id']);self.assertEqual(done['state'],'cancelled');self.assertNotIn('files',done)
        self.assertEqual(self.fingerprints(),self.before)

    def test_uuid_collision_cannot_overwrite_source(self):
        with patch('tools.hexrefine_joint_server.uuid.uuid4',return_value=SimpleNamespace(hex=self.parent)),patch('tools.hexrefine_joint_server.subprocess.Popen') as spawn:
            self.error(500);spawn.assert_not_called()
        self.assertEqual(self.fingerprints(),self.before)

    def test_spawn_failure_has_new_failed_record_and_keeps_parent(self):
        with patch('tools.hexrefine_joint_server.subprocess.Popen',side_effect=OSError('Retry spawn failed')):self.error(500)
        children=[p for p in self.output.iterdir() if p.is_dir() and p.name!=self.parent]
        self.assertEqual(len(children),1)
        record=json.loads((children[0]/'job.json').read_text())
        self.assertEqual(record['state'],'failed');self.assertEqual(record['parentJobId'],self.parent)
        self.assertEqual(self.fingerprints(),self.before)

    def test_interrupted_missing_request_is_visible_but_not_retryable(self):
        self.jobs.close();(self.output/self.parent/'request.json').unlink()
        restored=JointJobs(self.output,os.environ['HEXREFINE_NODE'],60)
        try:
            item=restored.inventory()[0]
            self.assertEqual(item['state'],'interrupted');self.assertFalse(item['retryAvailable'])
            with self.assertRaises(ValueError):restored.retry(self.parent)
        finally:restored.close()

    def test_legacy_interrupted_snapshot_is_pinned_without_rewriting_source(self):
        self.jobs.close();path=self.output/self.parent/'job.json'
        record=json.loads(path.read_text());record.pop('requestSHA256');path.write_text(json.dumps(record))
        before=self.fingerprints();restored=JointJobs(self.output,os.environ['HEXREFINE_NODE'],60)
        try:
            self.assertTrue(restored.inventory()[0]['retryAvailable']);self.assertEqual(self.fingerprints(),before)
            (self.output/self.parent/'request.json').write_text('{"schemaVersion":1,"parameters":{}}')
            with patch('tools.hexrefine_joint_server.subprocess.Popen') as spawn:
                with self.assertRaisesRegex(ValueError,'hash changed'):restored.retry(self.parent)
                spawn.assert_not_called()
        finally:restored.close()

    def test_recovery_rejects_forged_child_lineage_digest(self):
        self.jobs.close();path=self.output/self.parent/'job.json';record=json.loads(path.read_text())
        record.update(parentJobId=uuid.uuid4().hex,retryMode='fresh-regeneration',parentRequestSHA256='f'*64)
        path.write_text(json.dumps(record));restored=JointJobs(self.output,os.environ['HEXREFINE_NODE'],60)
        try:
            self.assertEqual(restored.snapshot(self.parent)['state'],'failed')
            self.assertIn('Invalid retry lineage',restored.snapshot(self.parent)['error'])
        finally:restored.close()


if __name__=='__main__':unittest.main()
