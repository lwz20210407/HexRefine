import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {planConcentricCircularMesh,parseMeshText} from '../dist/index.js';
const script=fileURLToPath(new URL('../scripts/plan-concentric-widths.mjs',import.meta.url));
const generator=fileURLToPath(new URL('../scripts/generate-concentric-circle.mjs',import.meta.url));
const request={schemaVersion:1,parameters:{radius:16,height:8,coreRadius:4,radiusSegments:20,arcSegments:32,axialSegments:16,modelFraction:'quarter',
  rings:[{innerRadius:4.5,outerRadius:5.5},{innerRadius:8.5,outerRadius:10.5}]},
  criteria:{minimumCornerScaledJacobian:.2,maximumTransitionEdgeAspectRatio:6,minimumTransitionEdgeToCoreRatio:1}};
const run=(file,args,cwd)=>spawnSync(process.execPath,[file,...args],{cwd,encoding:'utf8'});
async function temporary(action){const parent=path.resolve(process.env.HEXREFINE_TEST_OUTPUT??os.tmpdir());await fs.mkdir(parent,{recursive:true});
  const root=await fs.mkdtemp(path.join(parent,'width-cli-'));try{await action(root);}finally{assert.equal(path.dirname(root),parent);await fs.rm(root,{recursive:true,force:true});}}

test('width CLI produces a native-schema request that the real streaming K generator accepts',()=>temporary(async root=>{
  const input=path.join(root,'request.json'),out=path.join(root,'plan');await fs.writeFile(input,JSON.stringify(request));
  const result=run(script,[input,out],root);assert.equal(result.status,0,result.stderr);
  const spec=JSON.parse(await fs.readFile(path.join(out,'resolved-request.json'))),report=JSON.parse(await fs.readFile(path.join(out,'planning-report.json')));
  assert.equal(spec.schemaVersion,1);assert.deepEqual(Object.keys(spec).sort(),['parameters','schemaVersion']);
  assert.equal(report.quality.engineeringAcceptanceVerified,false);assert.ok(report.report.actualTransitionEdgeToCoreRatio>=1);
  assert.equal(report.counts.elements,planConcentricCircularMesh(spec.parameters).expectedElements);
  const meshOut=path.join(root,'mesh'),generated=run(generator,[path.join(out,'resolved-request.json'),meshOut],root);
  assert.equal(generated.status,0,generated.stderr);
  const k=parseMeshText(await fs.readFile(path.join(meshOut,'mesh.k'),'utf8'),'mesh.k');assert.equal(k.elements.length,report.counts.elements);
  assert.equal(k.nodes.length,report.counts.nodes);
  const old=await fs.readFile(path.join(out,'resolved-request.json'));assert.notEqual(run(script,[input,out],root).status,0);
  assert.deepEqual(await fs.readFile(path.join(out,'resolved-request.json')),old);
}));

for(const [name,patch,code] of [
  ['bad-version',r=>({...r,schemaVersion:2}),'invalid-request'],
  ['fixed-core',r=>({...r,criteria:{...r.criteria,minimumCornerScaledJacobian:.95}}),'fixed-core-quality'],
  ['short-edge',r=>({...r,criteria:{...r.criteria,minimumTransitionEdgeToCoreRatio:100,minimumRegularEdgeToCoreRatio:1}}),'no-local-candidate'],
  ['fixed-collar',r=>({...r,parameters:{...r.parameters,rings:[{innerRadius:4.001,outerRadius:5.5},r.parameters.rings[1]]}}),'fixed-collar-quality'],
  ['budget',r=>({...r,search:{maximumLocalEvaluations:1}}),'search-budget-exhausted']
])test(`width CLI gives structured ${name} rejection without an output directory`,()=>temporary(async root=>{
  const input=path.join(root,'request.json'),out=path.join(root,'refused');await fs.writeFile(input,JSON.stringify(patch(structuredClone(request))));
  const result=run(script,[input,out],root);assert.notEqual(result.status,0);
  const failure=JSON.parse(result.stderr);assert.equal(failure.code,code);if(code!=='invalid-request')assert.ok(failure.diagnostics);
  await assert.rejects(fs.stat(out),{code:'ENOENT'});
}));

test('width CLI rejects oversized requests, missing arguments and nonexistent parents',()=>temporary(async root=>{
  assert.notEqual(run(script,[],root).status,0);
  const input=path.join(root,'request.json');await fs.writeFile(input,' '.repeat(65537));
  assert.match(run(script,[input,path.join(root,'large')],root).stderr,/64KiB/);
  await fs.writeFile(input,JSON.stringify(request));assert.notEqual(run(script,[input,path.join(root,'missing','out')],root).status,0);
  await assert.rejects(fs.stat(path.join(root,'missing')),{code:'ENOENT'});
}));
