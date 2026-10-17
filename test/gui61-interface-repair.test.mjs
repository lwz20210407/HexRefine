import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {repairGui61FiveHexInterfaces,refineHexTo5Hex,H1_FACES,minimumHexCornerScaledJacobian,checkNoHangingNodes} from '../dist/index.js';

const cube=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const flip=e=>[e[1],e[0],e[3],e[2],e[5],e[4],e[7],e[6]];
function fixture(){
  const r=refineHexTo5Hex(cube),nodes=cube.map(p=>[...p]),elements=[[1,2,3,4,5,6,7,8]];
  const add=p=>{let i=nodes.findIndex(q=>q.every((v,a)=>v===p[a]));if(i<0){nodes.push(p);i=nodes.length-1;}return i+1;};
  // Extrude the two subdivided template walls into valid neighboring solids,
  // but leave the middle coarse parent unmodified (the deliberately bad seam).
  for(const axis of [0,1])for(const e of r.elements)for(const f of H1_FACES){
    const face=f.map(n=>r.nodes[e[n-1]-1]);if(!face.every(p=>p[axis]===0))continue;
    const child=[...face.map(add),...face.map(p=>add(p.map((v,a)=>v-(a===axis?.5:0))))];
    elements.push(minimumHexCornerScaledJacobian(child.map(n=>nodes[n-1]))>0?child:flip(child));
  }
  return {kind:'H1',nodes,elements};
}
const options={parentElementIds:[1],tolerance:1e-9};

test('5-Hex repair preserves original nodes and unaffected cells with explicit lineage',()=>{
  const mesh=fixture(),before=structuredClone(mesh);
  assert.equal(checkNoHangingNodes(mesh,1e-9).ok,false);
  const r=repairGui61FiveHexInterfaces(mesh,options);
  assert.deepEqual(mesh,before);assert.deepEqual(r.mesh.nodes.slice(0,mesh.nodes.length),mesh.nodes);
  assert.deepEqual(r.mesh.elements.slice(5),mesh.elements.slice(1));
  assert.deepEqual(r.parentElementIds,[1,1,1,1,1,2,3,4,5,6,7,8,9]);
  assert.equal(r.addedNodeIds.length,2);assert.equal(r.mesh.elements.length,13);
  assert.ok(checkNoHangingNodes(r.mesh,1e-9).ok);assert.ok(r.quality.minimumGaussJacobian>0);
  assert.ok(r.quality.maximumParentVolumeError<1e-12);
});

test('repair matches all 48 rotated and reflected axis frames without moving original nodes',()=>{
  for(const a of [0,1,2])for(const b of [0,1,2].filter(x=>x!==a))for(let mask=0;mask<8;mask++){
    const mesh=fixture(),axes=[a,b,3-a-b];
    mesh.nodes=mesh.nodes.map(p=>axes.map((axis,i)=>((mask>>i)&1?-1:1)*p[axis]+3*i));
    mesh.elements=mesh.elements.map(e=>minimumHexCornerScaledJacobian(e.map(n=>mesh.nodes[n-1]))>0?e:flip(e));
    const r=repairGui61FiveHexInterfaces(mesh,options);
    assert.equal(r.mesh.elements.length,13);assert.deepEqual(r.mesh.nodes.slice(0,mesh.nodes.length),mesh.nodes);
  }
});

test('repair refuses invalid selection, wrong topology, nonmanifold and nonpositive input atomically',()=>{
  const mesh=fixture(),before=structuredClone(mesh);
  for(const parents of [[],[0],[100],[1,1],[2]])assert.throws(()=>repairGui61FiveHexInterfaces(mesh,{...options,parentElementIds:parents}));
  for(const tolerance of [0,-1,NaN,Infinity])assert.throws(()=>repairGui61FiveHexInterfaces(mesh,{...options,tolerance}));
  assert.throws(()=>repairGui61FiveHexInterfaces(mesh,{...options,tolerance:1}),/tolerance exceeds/);
  const duplicate=structuredClone(mesh);duplicate.elements.push([...duplicate.elements[0]]);
  assert.throws(()=>repairGui61FiveHexInterfaces(duplicate,options),/duplicate/);
  const inverted=structuredClone(mesh);inverted.elements[0]=flip(inverted.elements[0]);
  assert.throws(()=>repairGui61FiveHexInterfaces(inverted,options),/positive/);
  assert.deepEqual(mesh,before);
});

test('repair supports affine skew and checks ambiguous interface identities',()=>{
  const mesh=fixture();
  mesh.nodes=mesh.nodes.map(([x,y,z])=>[2*x+.2*z+10,3*y+.1*x-7,.8*z+4]);
  const r=repairGui61FiveHexInterfaces(mesh,options);
  assert.ok(r.quality.minimumCornerScaledJacobian>0);
  const broken=fixture(),node=broken.elements[1][1];
  broken.nodes.push([...broken.nodes[node-1]]);
  broken.elements[1]=broken.elements[1].map(n=>n===node?broken.nodes.length:n);
  assert.throws(()=>repairGui61FiveHexInterfaces(broken,options),/ambiguous|compatible|subdivided/);
});

test('repair does not weld distinct parts or reuse orphan coincident nodes',()=>{
  const mesh=fixture();
  assert.throws(()=>repairGui61FiveHexInterfaces(mesh,{...options,partIds:[1,...Array(8).fill(2)]}),/cross-part/);
  assert.throws(()=>repairGui61FiveHexInterfaces(mesh,{...options,partIds:[1]}),/partIds/);
  mesh.nodes.push([.5,.5,1/3]); // Not an actual interface node; must remain unused.
  const orphanId=mesh.nodes.length;
  const r=repairGui61FiveHexInterfaces(mesh,{...options,partIds:Array(9).fill(4)});
  assert.equal(r.addedNodeIds.length,2);
  assert.ok(r.mesh.elements.every(e=>!e.includes(orphanId)));
});

test('repair fails closed if a second unresolved patch is not selected',()=>{
  const mesh=fixture(),other=fixture(),offset=mesh.nodes.length;
  mesh.nodes.push(...other.nodes.map(p=>[p[0]+5,p[1],p[2]]));
  mesh.elements.push(...other.elements.map(e=>e.map(n=>n+offset)));
  const before=structuredClone(mesh);
  assert.throws(()=>repairGui61FiveHexInterfaces(mesh,options),/unresolved hanging/);
  assert.deepEqual(mesh,before);
  const r=repairGui61FiveHexInterfaces(mesh,{...options,parentElementIds:[1,10]});
  assert.equal(r.mesh.elements.length,26);assert.equal(r.addedNodeIds.length,4);
});

test('repair CLI preserves PIDs, refuses unsupported metadata and never overwrites outputs',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'gui61-repair-'));
  try {
    const request={schemaVersion:1,mesh:fixture(),repair:{...options,partIds:Array(9).fill(7)}};
    const input=path.join(folder,'input.json'),output=path.join(folder,'output');
    const script=fileURLToPath(new URL('../scripts/repair-gui61-interface.mjs',import.meta.url));
    const run=()=>spawnSync(process.execPath,[script,input,output],{cwd:folder,encoding:'utf8'});
    await fs.writeFile(input,JSON.stringify({...request,materials:[{}]}));
    const rejected=run();assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/metadata/);
    await assert.rejects(fs.access(output));
    await fs.writeFile(input,JSON.stringify(request));
    const success=run();assert.equal(success.status,0,success.stderr);
    const report=JSON.parse(await fs.readFile(path.join(output,'report.json'),'utf8'));
    assert.equal(report.outputElements,13);assert.equal(report.partIds,'Inherited through parent lineage');
    const keyword=await fs.readFile(path.join(output,'mesh.k'),'utf8');
    const {parseNativeLsdynaMixedKeyword}=await import('../dist/index.js');
    assert.ok(parseNativeLsdynaMixedKeyword(keyword).solids.every(e=>e.partId===7));
    const again=run();assert.notEqual(again.status,0);
    assert.equal(await fs.readFile(path.join(output,'mesh.k'),'utf8'),keyword);
  } finally {
    assert.equal(path.dirname(folder),path.resolve(os.tmpdir()));
    await fs.rm(folder,{recursive:true,force:true});
  }
});
