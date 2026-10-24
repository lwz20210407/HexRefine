import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {planStagedBandPlate,generateStagedBandPlate,STAGED_BAND_ELEMENT_LIMIT,parseMeshText} from '../dist/index.js';

const fixture=JSON.parse(await fs.readFile(new URL('../examples/input/staged-band-plate.json',import.meta.url)));
const small=stages=>({fullSize:[12,30,12],coreWidth:6,coreRows:4,coarseSectionCounts:[2,2],outerRows:2,stages});
for(const a of [0,2])for(const b of [0,2])for(const r of [2,3])for(const s of [2,3])test(`staged band installs mixed ${a}:${r} then ${b}:${s} without treating cell counts as ratios`,()=>{
  const input=small([{axis:a,reduction:r,width:2},{axis:b,reduction:s,width:2}]),before=structuredClone(input),plan=planStagedBandPlate(input),result=generateStagedBandPlate(input);
  assert.deepEqual(input,before);assert.equal(result.mesh.elements.length,plan.expectedCells);
  assert.equal(result.regions.filter(r=>r==='core').length,plan.coreCells);
  assert.equal(result.regions.filter(r=>r==='far').length,plan.farCells);
  assert.ok(result.quality.minimumCornerScaledJacobian>0&&result.quality.minimumGaussDeterminant>0);
  assert.ok(result.quality.relativeVolumeError<1e-12);assert.equal(result.quality.unexpectedInternalFreeFaces,0);assert.equal(result.quality.boundaryEuler,2);
  assert.equal(plan.stagePlans[0].cellsPerSide,4*(r===2?3:4));
});
test('whole plate reproduces the complete mixed6x/3x refinement and three transition bands',()=>{
  const result=generateStagedBandPlate(fixture.parameters),p=result.plan;
  assert.equal(result.mesh.elements.length,8880);assert.equal(result.mesh.nodes.length,12128);
  assert.deepEqual(p.fineSectionCounts,[120,3]);assert.deepEqual(p.coreSpacing,[1,1,1]);assert.deepEqual(p.coarseSpacing,[6,5.8,3]);
  assert.deepEqual(p.stagePlans.map(s=>s.lowerRange),[[29,32],[32,38],[38,40]]);
  assert.deepEqual(Object.fromEntries(Object.entries(result.quality.byRegion).map(([k,v])=>[k,v.cells])),{far:200,'transition-1':160,'transition-2':360,'transition-3':960,core:7200});
  assert.ok(result.quality.minimumCornerScaledJacobian>.5547);assert.ok(Math.abs(result.quality.volume-36000)<1e-8);
  for(const [i,e] of result.mesh.elements.entries())if(result.regions[i]==='core')for(const n of e){const p=result.mesh.nodes[n-1];assert.ok(p[1]>=40&&p[1]<=60);for(const x of p)assert.ok(Math.abs(x-Math.round(x))<1e-12);}
});
test('band planning refuses incompatible seeds, invalid geometry and budgets before generation',()=>{
  const good=small([{axis:0,reduction:2,width:2}]);
  const invalid=[{...good,coarseSectionCounts:[3,2]},{...good,coreWidth:30},{...good,coreRows:0},{...good,stages:[]},
    {...good,stages:[{axis:1,reduction:2,width:2}]},{...good,stages:[{axis:0,reduction:4,width:2}]},
    {...good,stages:[{axis:0,reduction:3,width:12}]},{...good,stages:[{axis:0,reduction:3,width:2,middleFraction:0}]},
    {...good,stages:[{axis:0,reduction:3,width:2,unknown:1}]},{...good,elementLimit:1},{...good,elementLimit:STAGED_BAND_ELEMENT_LIMIT+1},
    {...good,minimumCornerScaledJacobian:true},{...good,fullSize:[Infinity,30,12]},{...good,unknown:1}];
  for(const input of invalid)assert.throws(()=>planStagedBandPlate(input));
  assert.throws(()=>generateStagedBandPlate({...good,minimumCornerScaledJacobian:.999}),/quality gate/);
  assert.ok(generateStagedBandPlate({...good,stages:[{axis:0,reduction:3,width:2,middleFraction:.5}]}).quality.minimumCornerScaledJacobian>0);
});
test('staged-band CLI writes a complete mesh-only K and refuses overwrites and unsupported input',async()=>{
  const root=await fs.mkdtemp(path.join(process.env.HEXREFINE_TEST_OUTPUT??os.tmpdir(),'staged-band-cli-'));
  try{
    const script=fileURLToPath(new URL('../scripts/generate-staged-band-plate.mjs',import.meta.url)),input=path.join(root,'request.json'),out=path.join(root,'out');
    const run=destination=>spawnSync(process.execPath,[script,input,destination],{encoding:'utf8',timeout:120000});
    await fs.writeFile(input,JSON.stringify(fixture));let r=run(out);assert.equal(r.status,0,r.stderr);
    const text=await fs.readFile(path.join(out,'mesh.k'),'utf8'),mesh=parseMeshText(text,'mesh.k'),report=JSON.parse(await fs.readFile(path.join(out,'report.json')));
    assert.equal(mesh.elements.length,8880);assert.equal(report.partId,2);assert.equal(report.sourceMeshImported,false);assert.ok(report.readback.minimumCornerScaledJacobian>=.55);
    assert.deepEqual([...text.matchAll(/^\*[^\n]+/gm)].map(m=>m[0]),['*KEYWORD','*NODE','*ELEMENT_SOLID','*END']);
    r=run(out);assert.notEqual(r.status,0);assert.equal(await fs.readFile(path.join(out,'mesh.k'),'utf8'),text);
    await fs.writeFile(input,JSON.stringify({...fixture,parameters:{...fixture.parameters,minimumCornerScaledJacobian:.999}}));
    r=run(path.join(root,'low-quality'));assert.notEqual(r.status,0);await assert.rejects(fs.stat(path.join(root,'low-quality')),{code:'ENOENT'});
    await fs.writeFile(input,JSON.stringify({...fixture,unknown:1}));r=run(path.join(root,'bad'));assert.notEqual(r.status,0);await assert.rejects(fs.stat(path.join(root,'bad')),{code:'ENOENT'});
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
