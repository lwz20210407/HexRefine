"""Loopback-only workbench host for the repository-native Python joint backend."""
import argparse,hashlib,importlib.util,json,os,shutil,signal,subprocess,sys,threading,uuid
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote,urlsplit

REPOSITORY=Path(__file__).resolve().parents[1]
ARTIFACTS={'model.k':'text/plain','merged.inp':'text/plain','parts.inp':'text/plain','report.json':'application/json'}


def kill_owned(process):
    if process.poll() is not None:return
    if os.name=='nt':
        startup=subprocess.STARTUPINFO();startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW;startup.wShowWindow=subprocess.SW_HIDE
        subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,startupinfo=startup,check=False)
    else:os.killpg(process.pid,signal.SIGTERM)


class JointJobs:
    def __init__(self,output,node,timeout=300):
        self.output=Path(output).resolve(strict=True);self.node=Path(node).resolve(strict=True)
        if not self.output.is_dir() or not self.node.is_file():raise ValueError('Explicit output directory and Node executable required')
        self.timeout=timeout;self.lock=threading.Lock();self.jobs={}

    def start(self,request):
        from tools.bolthex.native_joint import NativeJointSpec
        if not isinstance(request,dict) or set(request)!={'schemaVersion','parameters'} or type(request['schemaVersion']) is not int or request['schemaVersion']!=1:
            raise ValueError('Require version-1 native joint request')
        spec=NativeJointSpec.parse(request['parameters'])
        if type(spec.element_limit) is not int or not 1<=spec.element_limit<=200000:raise ValueError('GUI element budget is limited to 200000 H8')
        with self.lock:
            if any(j['state']=='running' for j in self.jobs.values()):raise RuntimeError('Another joint job is running')
            if len(self.jobs)>=32:raise RuntimeError('Session job limit reached; restart service with a new output directory')
            if shutil.disk_usage(self.output).free<256*1024*1024:raise RuntimeError('Insufficient output disk space')
            identity=uuid.uuid4().hex;directory=self.output/identity;directory.mkdir()
            source=directory/'request.json';source.write_text(json.dumps(request,allow_nan=False))
            log=(directory/'job.log').open('w',encoding='utf8')
            startup=None
            if os.name=='nt':
                startup=subprocess.STARTUPINFO();startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW;startup.wShowWindow=subprocess.SW_HIDE
            try:
                process=subprocess.Popen([sys.executable,'-B','-m','tools.bolthex.native_joint',str(source),str(directory/'result'),'--node',str(self.node)],
                    cwd=REPOSITORY,env={**os.environ,'TEMP':str(directory),'TMP':str(directory),'PYTHONDONTWRITEBYTECODE':'1'},
                    stdout=log,stderr=subprocess.STDOUT,startupinfo=startup,start_new_session=os.name!='nt')
            except Exception:log.close();raise
            job=dict(id=identity,state='running',error=None,directory=directory,process=process,cancel=False)
            self.jobs[identity]=job
        watcher=threading.Thread(target=self._watch,args=(job,log),daemon=False)
        job['watcher']=watcher;watcher.start()
        return self.snapshot(identity)

    def _watch(self,job,log):
        failure=None
        try:job['process'].wait(timeout=self.timeout)
        except subprocess.TimeoutExpired:
            kill_owned(job['process']);job['process'].wait();failure='Joint job exceeded bounded runtime'
        finally:log.close()
        with self.lock:
            if job['cancel']:job['state']='cancelled';return
            if failure or job['process'].returncode:
                lines=(job['directory']/'job.log').read_text(encoding='utf8',errors='replace').splitlines()
                job.update(state='failed',error=failure or ('\n'.join(lines[-3:])[-1500:] if lines else 'Native joint failed'))
                return
            try:
                directory=job['directory']/'result';report=json.loads((directory/'report.json').read_text())
                if report['quality']['minimumCornerScaledJacobian']<.15 or report['quality']['minimumGaussJacobian']<=0:raise ValueError('Incomplete native quality report')
                digest=hashlib.sha256()
                with (directory/'model.k').open('rb') as stream:
                    for block in iter(lambda:stream.read(1048576),b''):digest.update(block)
                if digest.hexdigest()!=report['kReadback']['sha256']:raise ValueError('Published K hash differs')
                if not all((directory/name).is_file() for name in ARTIFACTS):raise ValueError('Missing native artifacts')
                job.update(state='succeeded',report=report)
            except Exception as exc:job.update(state='failed',error=str(exc))

    def snapshot(self,identity):
        with self.lock:
            job=self.jobs.get(identity)
            if job is None:raise KeyError(identity)
            result=dict(id=identity,state=job['state'],error=job['error'])
            if job['state']=='succeeded':
                result['files']={name:f'/api/native-joint/jobs/{identity}/files/{name}' for name in ARTIFACTS}
                result['report']=job['report']
            return result

    def cancel(self,identity):
        with self.lock:
            job=self.jobs.get(identity)
            if job is None:raise KeyError(identity)
            if job['state']!='running':return False
            job['cancel']=True;process=job['process']
        kill_owned(process);return True

    def artifact(self,identity,name):
        with self.lock:
            job=self.jobs.get(identity)
            if job is None or job['state']!='succeeded' or name not in ARTIFACTS:raise KeyError(name)
            return job['directory']/'result'/name

    def close(self):
        for identity in list(self.jobs):self.cancel(identity)
        for job in self.jobs.values():
            if job['process'].poll() is None:job['process'].wait(timeout=20)
            job['watcher'].join(20)
            if job['watcher'].is_alive():raise RuntimeError('Joint monitor did not stop')


def handler_for(jobs):
    class Handler(BaseHTTPRequestHandler):
        def _json(self,status,data):
            body=json.dumps(data,allow_nan=False).encode()
            self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)

        def _local(self):
            port=self.server.server_port
            if self.headers.get('Host') not in (f'127.0.0.1:{port}',f'localhost:{port}'):return False
            origin=self.headers.get('Origin')
            return origin is None or origin in (f'http://127.0.0.1:{port}',f'http://localhost:{port}')

        def _route(self,method):
            if not self._local():self._json(403,dict(error='Loopback same-origin requests only'));return
            path=urlsplit(self.path).path
            try:
                if method=='GET' and path=='/api/native-joint/capabilities':
                    self._json(200,dict(available=True,schemaVersion=1,elementLimit=200000));return
                if method=='GET' and path=='/favicon.ico':
                    self.send_response(204);self.end_headers();return
                if method=='GET' and path=='/examples/browser/runtime-config.js':
                    body=b'window.HEXREFINE_RUNTIME={appMode:"internal",guiElementLimit:null,nativeJointAvailable:true};window.COMFORMHEX_RUNTIME=window.HEXREFINE_RUNTIME;'
                    self.send_response(200);self.send_header('Content-Type','text/javascript; charset=utf-8')
                    self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
                if method=='POST' and path=='/api/native-joint/jobs':
                    if self.headers.get('Content-Type','').split(';')[0]!='application/json':raise ValueError('JSON request required')
                    length=int(self.headers.get('Content-Length','0'))
                    if not 0<length<=65536:raise ValueError('Request length must be 1..65536 bytes')
                    def reject_constant(value):raise ValueError('Nonfinite JSON number')
                    request=json.loads(self.rfile.read(length),parse_constant=reject_constant)
                    self._json(202,jobs.start(request));return
                tokens=path.strip('/').split('/')
                if len(tokens)>=4 and tokens[:3]==['api','native-joint','jobs']:
                    identity=tokens[3]
                    if method=='GET' and len(tokens)==4:self._json(200,jobs.snapshot(identity));return
                    if method=='DELETE' and len(tokens)==4:
                        jobs.cancel(identity);self._json(202,jobs.snapshot(identity));return
                    if method=='GET' and len(tokens)==6 and tokens[4]=='files':
                        file=jobs.artifact(identity,tokens[5]);self._file(file,ARTIFACTS[tokens[5]]);return
                    raise KeyError(path)
                if method=='GET':
                    if path=='/':
                        self.send_response(302);self.send_header('Location','/examples/browser/refinement-gui.html');self.end_headers();return
                    decoded=unquote(path)
                    for prefix in ('/examples/browser/','/examples/output/','/dist/'):
                        if decoded.startswith(prefix):
                            base=REPOSITORY/prefix.strip('/');file=(base/decoded[len(prefix):]).resolve()
                            if not file.is_relative_to(base.resolve()) or not file.is_file():raise KeyError(path)
                            import mimetypes
                            self._file(file,mimetypes.guess_type(file.name)[0] or 'application/octet-stream');return
                raise KeyError(path)
            except (ValueError,TypeError,json.JSONDecodeError) as exc:self._json(400,dict(error=str(exc)))
            except KeyError:self._json(404,dict(error='Not found'))
            except RuntimeError as exc:self._json(409,dict(error=str(exc)))
            except Exception as exc:self._json(500,dict(error=str(exc)))

        def _file(self,path,mime):
            self.send_response(200);self.send_header('Content-Type',mime+'; charset=utf-8')
            self.send_header('Content-Length',str(path.stat().st_size));self.send_header('Cache-Control','no-store');self.end_headers()
            with path.open('rb') as stream:shutil.copyfileobj(stream,self.wfile)

        def do_GET(self):self._route('GET')
        def do_POST(self):self._route('POST')
        def do_DELETE(self):self._route('DELETE')
    return Handler


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output-root',type=Path,required=True)
    parser.add_argument('--node',type=Path,required=True);parser.add_argument('--port',type=int,default=8797)
    args=parser.parse_args()
    if importlib.util.find_spec('meshio') is None:parser.error('Use the configured Python environment with NumPy and meshio')
    jobs=JointJobs(args.output_root,args.node);server=ThreadingHTTPServer(('127.0.0.1',args.port),handler_for(jobs))
    print(f'Native joint workbench: http://127.0.0.1:{server.server_port}',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close();jobs.close()


if __name__=='__main__':main()
