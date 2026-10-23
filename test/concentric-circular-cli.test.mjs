import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseMeshText} from '../dist/index.js';
const script=fileURLToPath(new URL('../scripts/generate-concentric-circle.mjs',import.meta.url));
const spec={radius:16,height:8,coreRadius:4,radiusSegments:20,arcSegments:32,axialSegments:16,modelFraction:'quarter',
  rings:[{innerRadius:4.5,outerRadius:5.5},{innerRadius:8.5,outerRadius:10.5}]};
const run=(args,cwd)=>spawnSync(process.execPath,[script,...args],{cwd,encoding:'utf8'});
async function temporary(action){const parent=path.resolve(process.env.HEXREFINE_TEST_OUTPUT??os.tmpdir());await fs.mkdir(parent,{recursive:true});
  const root=await fs.mkdtemp(path.join(parent,'concentric-cli-'));try{await action(root);}finally{assert.equal(path.dirname(root),parent);await fs.rm(root,{recursive:true,force:true});}}
test('concentric CLI streams a complete K, independently readable motif and verified count/hash report',()=>temporary(async root=>{
  const input=path.join(root,'request.json'),out=path.join(root,'case');await fs.writeFile(input,JSON.stringify({schemaVersion:1,parameters:spec}));
  const result=run([input,out],root);assert.equal(result.status,0,result.stderr);
  const k=await fs.readFile(path.join(out,'mesh.k')),report=JSON.parse(await fs.readFile(path.join(out,'report.json')));
  const mesh=parseMeshText(k.toString(),'mesh.k');assert.equal(mesh.kind,'H1');assert.equal(mesh.elements.length,8256);
  assert.equal(mesh.nodes.length,report.counts.nodes);assert.equal(report.readback.sha256,createHash('sha256').update(k).digest('hex'));
  assert.equal(report.readback.allRecordsVerified,true);assert.equal(report.readback.bytes,k.length);
  assert.equal(report.quality.engineeringAcceptanceVerified,false);assert.equal(report.quality.hangingCheckPassed,true);
  assert.deepEqual(report.plan.angularCountsPerQuarter,[32,16,8]);assert.deepEqual(report.plan.axialSpacings,[.5,1,2]);
  assert.doesNotMatch(k.toString(),/\*MAT|\*CONTACT|\*BOUNDARY|\*SET/);
  const motif=parseMeshText(await fs.readFile(path.join(out,'motif.k'),'utf8'),'motif.k');assert.equal(motif.elements.length,report.motif.elements);
  await assert.rejects(fs.stat(path.join(out,'mesh.k.partial')),{code:'ENOENT'});
  const again=run([input,out],root);assert.notEqual(again.status,0);assert.match(again.stderr,/overwrite/);
  assert.deepEqual(await fs.readFile(path.join(out,'mesh.k')),k);
}));
for(const request of [{schemaVersion:2,parameters:spec},{schemaVersion:1,parameters:{...spec,axialSegments:15}},
  {schemaVersion:1,parameters:{...spec,minimumCornerScaledJacobian:.3}},
  {schemaVersion:1,parameters:{...spec,ratio:3}},{schemaVersion:1,parameters:spec,extra:1},null]){
  test(`concentric CLI refuses unsupported inputs without creating outputs ${JSON.stringify(request)}`,()=>temporary(async root=>{
    const input=path.join(root,'request.json'),out=path.join(root,'refused');await fs.writeFile(input,JSON.stringify(request));
    const r=run([input,out],root);assert.notEqual(r.status,0);assert.equal(JSON.parse(r.stderr).ok,false);
    await assert.rejects(fs.stat(out),{code:'ENOENT'});
  }));
}
test('concentric CLI rejects oversized request and nonexistent output parent',()=>temporary(async root=>{
  assert.notEqual(run([],root).status,0);
  const input=path.join(root,'request.json');await fs.writeFile(input,' '.repeat(65537));
  assert.match(run([input,path.join(root,'case')],root).stderr,/64KiB/);
  await fs.writeFile(input,JSON.stringify({schemaVersion:1,parameters:spec}));
  assert.notEqual(run([input,path.join(root,'missing','case')],root).status,0);
  await assert.rejects(fs.stat(path.join(root,'missing')),{code:'ENOENT'});
}));
