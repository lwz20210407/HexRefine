import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../scripts/plan-concentric-seeds.mjs',import.meta.url));
test('seed CLI resolves count constraints, preserves failures and refuses overwrites',async()=>{
  const root=await fs.mkdtemp(path.join(process.env.HEXREFINE_TEST_OUTPUT??os.tmpdir(),'seed-cli-'));
  try{
    const input=path.join(root,'request.json'),out=path.join(root,'plan');
    const request={schemaVersion:1,parameters:{radius:16,height:8,coreRadius:4,radiusSegments:19,arcSegments:31,axialSegments:15,modelFraction:'quarter',
      rings:[{innerRadius:4.5,outerRadius:5.5},{innerRadius:8.5,outerRadius:10.5}]},
      targets:{maximumRadiusSpacing:.5,maximumArcSpacing:.5,maximumAxialSpacing:.5}};
    await fs.writeFile(input,JSON.stringify(request));
    const run=(output)=>spawnSync(process.execPath,[script,input,output],{cwd:root,encoding:'utf8'});
    let r=run(out);assert.equal(r.status,0,r.stderr);
    const content=await fs.readFile(path.join(out,'resolved-request.json'),'utf8');
    assert.equal(JSON.parse(content).parameters.arcSegments,32);
    r=run(out);assert.notEqual(r.status,0);assert.equal(await fs.readFile(path.join(out,'resolved-request.json'),'utf8'),content);
    request.parameters.elementLimit=1;await fs.writeFile(input,JSON.stringify(request));
    r=run(path.join(root,'refused'));assert.notEqual(r.status,0);
    await assert.rejects(fs.stat(path.join(root,'refused')),{code:'ENOENT'});
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
