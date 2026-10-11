import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHexUnitCubeMesh,meshToLsdynaKeyword,parseMeshText,parseNativeLsdynaMixedKeyword} from '../dist/index.js';

test('K coordinate precision is opt-in and remains within sixteen columns',()=>{
  const mesh=createHexUnitCubeMesh(1,1,1);
  mesh.nodes=mesh.nodes.map(p=>[p[0]-38/3,p[1]+17/9,p[2]+11/9]);
  const normal=meshToLsdynaKeyword(mesh);
  const precise=meshToLsdynaKeyword(mesh,{coordinatePrecision:10});
  const a=parseMeshText(normal,'a.k'),b=parseMeshText(precise,'b.k');
  assert.ok(Math.abs(b.nodes[0][0]-mesh.nodes[0][0])<Math.abs(a.nodes[0][0]-mesh.nodes[0][0]));
  assert.equal(precise.split('\n')[2].length,56);
  assert.equal(meshToLsdynaKeyword(mesh,{coordinatePrecision:8}),normal);
  assert.throws(()=>meshToLsdynaKeyword(mesh,{coordinatePrecision:0}),/coordinatePrecision/);
  mesh.nodes=mesh.nodes.map(p=>[p[0]*1000,p[1],p[2]]);
  const compact=meshToLsdynaKeyword(mesh,{coordinateFormat:'compact'});
  const back=parseMeshText(compact,'compact.k');
  assert.ok(Math.abs(back.nodes[0][0]-mesh.nodes[0][0])<1e-9);
  assert.equal(compact.split('\n')[2].length,56);
});

const cli=fileURLToPath(new URL('../scripts/generate-graded-rectangle.mjs',import.meta.url));
test('versioned native rectangle CLI emits mesh-only K and refuses an existing output directory',async t=>{
  const root=await fs.mkdtemp(path.join(tmpdir(),'hex-graded-cli-'));
  t.after(async()=>{
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep));
    await fs.rm(root,{recursive:true,force:true});
  });
  const input=path.join(root,'request.json'),output=path.join(root,'mesh');
  const request={schemaVersion:1,kind:'rectangular-solid',parameters:{
    fullSize:[20,20,4],refinedSize:[8,8],fineSize:1,coarseSize:2,reductions:{x:2,y:3,z:3},
    thicknessTransition:false,transitionStages:1,modelFraction:'half'}};
  await fs.writeFile(input,JSON.stringify(request));
  const report=JSON.parse(execFileSync(process.execPath,[cli,input,output],{encoding:'utf8'}));
  assert.equal(report.implementation,'typescript-native');
  assert.deepEqual(report.runtimeDependencies,['node']);
  assert.equal(report.quality.expectedCoreChildren,6);
  const keyword=await fs.readFile(path.join(output,'mesh.k'),'utf8');
  assert.deepEqual(keyword.split(/\r?\n/).filter(l=>l.startsWith('*')),['*KEYWORD','*NODE','*ELEMENT_SOLID','*END']);
  const repeat=spawnSync(process.execPath,[cli,input,output],{encoding:'utf8'});
  assert.notEqual(repeat.status,0);
  assert.equal(await fs.readFile(path.join(output,'mesh.k'),'utf8'),keyword);
  await fs.writeFile(input,JSON.stringify({...request,schemaVersion:2}));
  const invalid=spawnSync(process.execPath,[cli,input,path.join(root,'bad')],{encoding:'utf8'});
  assert.notEqual(invalid.status,0);
  await assert.rejects(fs.access(path.join(root,'bad')));
  await fs.writeFile(input,JSON.stringify({schemaVersion:1,kind:'circular-solid',parameters:{
    radius:20,thickness:6,coreHalfSize:8,fineSize:1,coarseSize:2,reductions:{x:2,y:3},modelFraction:'half'}}));
  const circular=JSON.parse(execFileSync(process.execPath,[cli,input,path.join(root,'circle')],{encoding:'utf8'}));
  assert.equal(circular.kind,'circular-solid');
  assert.equal(circular.nodes,1672);assert.equal(circular.elements,1304);
  await fs.writeFile(input,JSON.stringify({schemaVersion:1,kind:'circular-quad',parameters:{
    radius:20,refinedRadius:10,fineSize:1,coarseSize:2,modelFraction:'quarter'}}));
  const quadOut=path.join(root,'circle-quad');
  const quad=JSON.parse(execFileSync(process.execPath,[cli,input,quadOut],{encoding:'utf8'}));
  assert.equal(quad.nodes,160);assert.equal(quad.elements,140);
  const quadK=await fs.readFile(path.join(quadOut,'mesh.k'),'utf8');
  assert.ok(quadK.includes('*ELEMENT_SHELL')&&!quadK.includes('*ELEMENT_SOLID'));
  const sets=JSON.parse(await fs.readFile(path.join(quadOut,'node_sets.json'),'utf8'));
  assert.ok(sets.plane_x0.length>0);
  await fs.writeFile(input,JSON.stringify({schemaVersion:1,kind:'cylindrical-solid',parameters:{
    outerRadius:20,thickness:3,length:40,coreArcLength:12,coreLength:12,fineSize:1,radialSize:1,
    coarseSize:3,thicknessTransition:true,layers:2,modelFraction:'quarter'}}));
  const cylinderOut=path.join(root,'cylinder');
  const cylinder=JSON.parse(execFileSync(process.execPath,[cli,input,cylinderOut],{encoding:'utf8'}));
  assert.equal(cylinder.nodes,1568);assert.equal(cylinder.elements,904);
  const layerSets=JSON.parse(await fs.readFile(path.join(cylinderOut,'cell_sets.json'),'utf8'));
  assert.equal(layerSets.layer_1.length,452);assert.equal(layerSets.layer_2.length,452);
  await fs.writeFile(input,JSON.stringify({schemaVersion:1,kind:'reinforced-uniform',parameters:{
    size:[4,4,4],meshSize:1,barCounts:[2,2,2],cover:[1,1,1],includeZBars:true,connectivity:'separate',dimensionPolicy:'preserve'}}));
  const reinforcedOut=path.join(root,'reinforced');
  const reinforced=JSON.parse(execFileSync(process.execPath,[cli,input,reinforcedOut],{encoding:'utf8'}));
  assert.deepEqual(reinforced.elementCounts,{solid:64,beam:48});
  const rcModel=parseNativeLsdynaMixedKeyword(await fs.readFile(path.join(reinforcedOut,'mesh.k'),'utf8'));
  assert.equal(rcModel.beams.length,48);
  await assert.rejects(fs.access(path.join(reinforcedOut,'lineage.json')));
});
