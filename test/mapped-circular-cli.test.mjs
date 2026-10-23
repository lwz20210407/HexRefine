import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseMeshText} from '../dist/index.js';

const script=fileURLToPath(new URL('../scripts/generate-mapped-circle.mjs',import.meta.url));
const run=(args,cwd)=>spawnSync(process.execPath,[script,...args],{cwd,encoding:'utf8'});
async function temporary(action){
  const parent=path.resolve(process.env.HEXREFINE_TEST_OUTPUT??os.tmpdir());await fs.mkdir(parent,{recursive:true});
  const folder=await fs.mkdtemp(path.join(parent,'mapped-core-cli-'));
  try{await action(folder);}finally{assert.equal(path.dirname(folder),parent);await fs.rm(folder,{recursive:true,force:true});}
}

for(const mode of ['section','prism'])test(`mapped-circle ${mode} CLI produces consistent K/INP/report and refuses overwrite`,()=>temporary(async folder=>{
  const parameters={radius:4,radiusSegments:8,arcSegments:12,modelFraction:'half',...(mode==='prism'?{height:2,axialSegments:4}:{})};
  const input=path.join(folder,'request.json'),output=path.join(folder,'new-result');
  await fs.writeFile(input,JSON.stringify({schemaVersion:1,mode,parameters}));
  const generated=run([input,output],folder);assert.equal(generated.status,0,generated.stderr);
  const k=await fs.readFile(path.join(output,'mesh.k'),'utf8'),inp=await fs.readFile(path.join(output,'mesh.inp'),'utf8');
  const a=parseMeshText(k,'mesh.k'),b=parseMeshText(inp,'mesh.inp');assert.deepEqual(a.elements,b.elements);
  assert.equal(a.kind,mode==='section'?'Q1':'H1');assert.doesNotMatch(k,/\*MAT|\*BOUNDARY|\*CONTACT/);
  const report=JSON.parse(await fs.readFile(path.join(output,'report.json'),'utf8'));
  assert.equal(report.schemaVersion,1);assert.equal(report.engineeringAcceptanceVerified,false);
  assert.equal(report.readback.kAndInpVerified,true);assert.equal(report.elements,a.elements.length);
  for(const ids of Object.values(report.nodeSets))assert.ok(ids.every(i=>i>=1&&i<=a.nodes.length));
  assert.deepEqual(Object.values(report.patchElementIds).flat().sort((a,b)=>a-b),Array.from({length:a.elements.length},(_,i)=>i+1));
  const repeat=run([input,output],folder);assert.notEqual(repeat.status,0);assert.match(repeat.stderr,/overwrite/);
  assert.equal(await fs.readFile(path.join(output,'mesh.k'),'utf8'),k);
}));

for(const request of [
  {schemaVersion:2,mode:'section',parameters:{}},
  {schemaVersion:1,mode:'unknown',parameters:{}},
  {schemaVersion:1,mode:'section',parameters:{radius:1,radiusSegments:4,arcSegments:5,modelFraction:'quarter'}},
  {schemaVersion:1,mode:'prism',parameters:{radius:1,radiusSegments:4,modelFraction:'quarter'}},
  {schemaVersion:1,mode:'section',parameters:{radius:1,radiusSegments:4,modelFraction:'quarter'},extra:true},
  null
])test(`mapped-circle CLI rejects invalid request without creating output ${JSON.stringify(request)}`,()=>temporary(async folder=>{
  const file=path.join(folder,'bad.json'),out=path.join(folder,'refused');await fs.writeFile(file,JSON.stringify(request));
  const rejected=run([file,out],folder);assert.notEqual(rejected.status,0);assert.equal(JSON.parse(rejected.stderr.trim()).ok,false);
  await assert.rejects(fs.stat(out),{code:'ENOENT'});
}));

test('mapped-circle CLI has bounded input, explicit arguments and existing-parent output semantics',()=>temporary(async folder=>{
  assert.notEqual(run([],folder).status,0);
  const input=path.join(folder,'request.json');await fs.writeFile(input,' '.repeat(65537));
  const out=path.join(folder,'large');assert.match(run([input,out],folder).stderr,/64KiB/);
  await assert.rejects(fs.stat(out),{code:'ENOENT'});
  await fs.writeFile(input,JSON.stringify({schemaVersion:1,mode:'section',parameters:{radius:1,radiusSegments:4,modelFraction:'quarter'}}));
  const missing=path.join(folder,'missing','case');assert.notEqual(run([input,missing],folder).status,0);
  await assert.rejects(fs.stat(path.join(folder,'missing')),{code:'ENOENT'});
}));
