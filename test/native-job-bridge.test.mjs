import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('standard-library Python bridge runs real native success/failure/cancellation contract tests',()=>{
  const python=process.env.HEXREFINE_PYTHON??(process.platform==='win32'?'C:\\Users\\yuguo\\.conda\\envs\\py3.11env\\python.exe':'python3');
  const root=fileURLToPath(new URL('../',import.meta.url));
  const r=spawnSync(python,['-B',path.join(root,'tools/tests/test_hexrefine_jobs.py')],{cwd:root,encoding:'utf8',timeout:180000,
    env:{...process.env,HEXREFINE_NODE:process.execPath,HEXREFINE_TEST_OUTPUT:process.env.HEXREFINE_TEST_OUTPUT??os.tmpdir()}});
  assert.equal(r.status,0,r.stderr??String(r.error));assert.match(r.stderr,/Ran 6 tests/);assert.match(r.stderr,/OK/);
});
