import importlib.util,json,os,tempfile,threading,time,unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request,urlopen
from http.server import ThreadingHTTPServer
from tools.hexrefine_joint_server import JointJobs,handler_for


@unittest.skipUnless(os.environ.get('HEXREFINE_JOINT_HTTP')=='1' and os.environ.get('HEXREFINE_NODE') and importlib.util.find_spec('meshio'),
                     'HTTP native-generation integration requires explicit HEXREFINE_JOINT_HTTP=1')
class JointHttpTests(unittest.TestCase):
    def setUp(self):
        parent=os.environ.get('BOLTHEX_TEST_ROOT')
        if not parent:self.skipTest('Explicit task output root required')
        self.tmp=tempfile.TemporaryDirectory(dir=parent)
        self.jobs=JointJobs(self.tmp.name,os.environ['HEXREFINE_NODE'],60)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),handler_for(self.jobs))
        self.thread=threading.Thread(target=self.server.serve_forever);self.thread.start()
        self.url=f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown();self.thread.join();self.server.server_close();self.jobs.close();self.tmp.cleanup()

    def call(self,path,method='GET',data=None,headers=None):
        content=None if data is None else json.dumps(data).encode()
        h={'Content-Type':'application/json',**(headers or {})}
        with urlopen(Request(self.url+path,data=content,method=method,headers=h),timeout=30) as response:
            return response.status,response.read()

    def terminal(self,identity):
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            job=json.loads(self.call('/api/native-joint/jobs/'+identity)[1])
            if job['state']!='running':return job
            time.sleep(.1)
        self.fail('Native job did not terminate')

    def test_real_generation_and_artifacts(self):
        job=json.loads(self.call('/api/native-joint/jobs','POST',dict(schemaVersion=1,parameters={}))[1])
        done=self.terminal(job['id']);self.assertEqual(done['state'],'succeeded',done)
        self.assertEqual(done['report']['quality']['elements'],10440)
        k=self.call(done['files']['model.k'])[1];self.assertIn(b'*ELEMENT_SOLID',k)
        parts=self.call(done['files']['parts.inp'])[1];self.assertEqual(parts.count(b'*INSTANCE,'),4)

    def test_invalid_cross_origin_and_traversal_are_rejected(self):
        for path,method,data,headers,code in [
            ('/api/native-joint/jobs','POST',dict(schemaVersion=1,parameters={}),{'Origin':'https://example.invalid'},403),
            ('/api/native-joint/jobs','POST',dict(schemaVersion=True,parameters={}),{},400),
            ('/api/native-joint/jobs','POST',dict(schemaVersion=1,parameters={'element_limit':200001}),{},400),
            ('/dist/%2e%2e/%2e%2e/AGENTS.md','GET',None,{},404),
            ('/api/native-joint/jobs/not-a-job/files/../README.md','GET',None,{},404)]:
            with self.subTest(path=path),self.assertRaises(HTTPError) as caught:self.call(path,method,data,headers)
            self.assertEqual(caught.exception.code,code)
        self.assertEqual(len(self.jobs.jobs),0)

    def test_cancel_and_failure_do_not_publish_downloads(self):
        request=dict(schemaVersion=1,parameters={})
        job=json.loads(self.call('/api/native-joint/jobs','POST',request)[1])
        self.call('/api/native-joint/jobs/'+job['id'],'DELETE')
        done=self.terminal(job['id']);self.assertEqual(done['state'],'cancelled');self.assertNotIn('files',done)
        self.assertIsNotNone(self.jobs.jobs[job['id']]['process'].poll())
        bad=json.loads(self.call('/api/native-joint/jobs','POST',dict(schemaVersion=1,parameters={'plate_x':20}))[1])
        failed=self.terminal(bad['id']);self.assertEqual(failed['state'],'failed');self.assertNotIn('files',failed)
