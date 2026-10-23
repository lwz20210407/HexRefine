import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {generateSolidSphereGradedMesh,meshToLsdynaKeyword,parseMeshText,H1_FACES,hexElementSignedVolume,minimumHexCornerScaledJacobian,checkNoHangingNodes} from '../dist/index.js';
const spec={radius:10,faceSegments:16,radialSegments:8,capSegments:8,capLayers:2};
const canonical=e=>[...e].sort((a,b)=>a-b).join(':');

test('solid sphere has a filled center, true eight-child cap, transition shell and exact coarse far field',()=>{
  const frozen=Object.freeze({...spec}),r=generateSolidSphereGradedMesh(frozen),{mesh,baseMesh,regions,parentElementIds}=r;
  assert.deepEqual(frozen,spec);assert.equal(mesh.kind,'H1');
  assert.equal(mesh.elements.length,18168);assert.equal(mesh.nodes.length,19139);
  assert.deepEqual(Object.fromEntries(Object.entries(regions).map(([key,ids])=>[key,ids.length])),{core:1024,transition:1056,far:16088});
  assert.equal(new Set(mesh.elements.map(canonical)).size,mesh.elements.length);
  assert.equal(new Set(mesh.nodes.map(p=>p.map(v=>v.toFixed(10)).join(':'))).size,mesh.nodes.length);
  assert.deepEqual(mesh.nodes.slice(0,baseMesh.nodes.length),baseMesh.nodes);
  assert.ok(mesh.nodes.some(p=>p.every(v=>v===0)),'the center must exist, not a hollow sphere');
  const counts=new Map();parentElementIds.forEach(p=>counts.set(p,(counts.get(p)??0)+1));
  assert.equal(counts.size,16384);for(const id of r.capCoreParentIds)assert.equal(counts.get(id),8);
  for(const id of regions.far)assert.deepEqual(mesh.elements[id-1],baseMesh.elements[parentElementIds[id-1]-1]);
  assert.equal(r.quality.referenceCoreTensorVerified,true);assert.ok(r.quality.coreMinimumCornerSJ>.96);
  assert.ok(r.quality.preProjectionMaximumParentVolumeError<1e-8);
  assert.ok(r.quality.conservativeFaceMapping.correctedFaces>0);
  assert.ok(r.quality.conservativeFaceMapping.maximumDisplacementFraction<=.002);
  assert.ok(r.quality.minimumCornerScaledJacobian>.217);assert.ok(r.quality.minimumGaussDeterminant>0);
  assert.ok(r.quality.relativeDiscreteVolumeError<1e-8);assert.ok(r.quality.relativeAnalyticVolumeError>.004&&r.quality.relativeAnalyticVolumeError<.005);
  assert.equal(r.quality.exteriorEulerCharacteristic,2);assert.equal(r.quality.hangingIncidences,0);
  assert.equal(checkNoHangingNodes(mesh,r.quality.minimumEdge*1e-8).ok,true);
  const faces=new Map();for(const e of mesh.elements)for(const f of H1_FACES){const ids=f.map(n=>e[n-1]),key=canonical(ids),record=faces.get(key)??{ids,count:0};record.count++;faces.set(key,record);}
  const exterior=[...faces.values()].filter(f=>f.count===1);
  assert.equal(exterior.length,1792);assert.ok([...faces.values()].every(f=>f.count===1||f.count===2));
  for(const f of exterior)for(const id of f.ids)assert.ok(Math.abs(Math.hypot(...mesh.nodes[id-1])-10)<1e-12);
  for(const id of r.projectedNodeIds){assert.ok(id>baseMesh.nodes.length);assert.ok(mesh.nodes[id-1][2]>8);}
  const parsed=parseMeshText(meshToLsdynaKeyword(mesh,{coordinateFormat:'compact'}),'sphere.k');
  assert.deepEqual(parsed.elements,mesh.elements);
  let volume=0,sj=1;for(const e of parsed.elements){const p=e.map(id=>parsed.nodes[id-1]);volume+=hexElementSignedVolume(p);sj=Math.min(sj,minimumHexCornerScaledJacobian(p));}
  assert.ok(Math.abs(volume-r.quality.volume)/volume<1e-8);assert.ok(sj>.217);
});

test('sphere scale covariance and deterministic replay',()=>{
  const small={...spec,radius:1,faceSegments:8,radialSegments:6,capSegments:2,capLayers:1,minimumCornerScaledJacobian:.15};
  const a=generateSolidSphereGradedMesh(small),b=generateSolidSphereGradedMesh({...small,radius:2});
  assert.deepEqual(a.mesh.elements,b.mesh.elements);assert.deepEqual(a.parentElementIds,b.parentElementIds);
  assert.deepEqual(b.mesh.nodes,a.mesh.nodes.map(p=>p.map(v=>2*v)));
  assert.ok(Math.abs(b.quality.volume/a.quality.volume-8)<1e-10);
  assert.deepEqual(a,generateSolidSphereGradedMesh(small));
});

for(const [name,patch] of [
  ['zero radius',{radius:0}],['NaN radius',{radius:NaN}],['overflow radius',{radius:1e200}],['underflow radius',{radius:1e-200}],
  ['odd face seed',{faceSegments:15}],['odd cap',{capSegments:7}],['seam-reaching cap',{capSegments:14}],
  ['too deep cap',{capLayers:7}],['fractional layers',{capLayers:1.5}],['boolean count',{capLayers:true}],
  ['no radial buffer',{radialSegments:2}],['excessive seeds',{faceSegments:26}],['budget',{elementLimit:18167}],
  ['unknown option',{ratio:3}],['collapsed cube',{cubeHalfWidthFraction:.6}],['bad SJ',{minimumCornerScaledJacobian:0}],
  ['bad face budget',{maximumFaceDisplacementFraction:.02}],['insufficient face freedom budget',{maximumFaceDisplacementFraction:.00001}],
  ['unmet SJ',{minimumCornerScaledJacobian:.9}]
])test(`sphere refuses ${name} without weakening its gates`,()=>assert.throws(()=>generateSolidSphereGradedMesh({...spec,...patch})));

test('sphere rejects nonobject options',()=>{for(const x of [null,undefined,[],3])assert.throws(()=>generateSolidSphereGradedMesh(x));});

test('sphere CLI K, report and replay are real; existing outputs and invalid requests are refused',async()=>{
  const root=await fs.mkdtemp(path.join(process.env.HEXREFINE_TEST_OUTPUT??os.tmpdir(),'solid-sphere-'));
  try{
    const request={schemaVersion:1,kind:'solid-sphere-surface-cap',options:{...spec,faceSegments:8,radialSegments:6,capSegments:2,capLayers:1,minimumCornerScaledJacobian:.15},partId:7};
    const input=path.join(root,'input.json'),out=path.join(root,'result');await fs.writeFile(input,JSON.stringify(request));
    const cli=fileURLToPath(new URL('../scripts/generate-solid-sphere.mjs',import.meta.url));
    const run=(i,o)=>spawnSync(process.execPath,[cli,i,o],{cwd:root,encoding:'utf8'});
    let proc=run(input,out);assert.equal(proc.status,0,proc.stderr);
    const data=await fs.readFile(path.join(out,'mesh.k'),'utf8'),report=JSON.parse(await fs.readFile(path.join(out,'report.json')));
    assert.equal(report.partId,7);assert.equal(parseMeshText(data,'sphere.k').elements.length,report.elements);
    assert.ok(report.kReadback.maximumCoordinateError<1e-8);assert.equal(report.plan.refinementRatio,2);
    proc=run(path.join(out,'request.json'),path.join(root,'replay'));assert.equal(proc.status,0,proc.stderr);
    assert.equal(await fs.readFile(path.join(root,'replay','mesh.k'),'utf8'),data);
    proc=run(input,out);assert.notEqual(proc.status,0);assert.match(proc.stderr,/overwrite/);assert.equal(await fs.readFile(path.join(out,'mesh.k'),'utf8'),data);
    await fs.writeFile(input,JSON.stringify({...request,options:{...request.options,minimumCornerScaledJacobian:.99}}));
    proc=run(input,path.join(root,'bad'));assert.notEqual(proc.status,0);await assert.rejects(fs.stat(path.join(root,'bad')),{code:'ENOENT'});
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
