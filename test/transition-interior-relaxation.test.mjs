import test from 'node:test';
import assert from 'node:assert/strict';
import {relaxTransitionInteriors} from '../dist/transition-interior-relaxation.js';
import {refineHexTo8Hex,checkNoHangingNodes,hexElementSignedVolume} from '../dist/index.js';
import {properCubeRotations} from '../dist/two-to-one-templates.js';

function fixture(){
  const source={kind:'H1',nodes:[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]],elements:[[1,2,3,4,5,6,7,8]]};
  const r=refineHexTo8Hex(source.nodes),nodes=structuredClone(source.nodes),ids=new Map(nodes.map((p,i)=>[p.join(':'),i+1]));
  const mapped=r.nodes.map(p=>{const key=p.join(':');if(!ids.has(key)){nodes.push([...p]);ids.set(key,nodes.length);}return ids.get(key);});
  const elements=r.elements.map(e=>e.map(n=>mapped[n-1])),center=nodes.findIndex(p=>p.every(v=>v===.5));
  nodes[center]=[.7,.6,.5];return {source,mesh:{kind:'H1',nodes,elements},center};
}
test('guarded interior relaxation improves a distorted patch without moving its boundary',()=>{
  const {source,mesh,center}=fixture(),before=structuredClone(mesh),r=relaxTransitionInteriors(source,mesh,Array(8).fill(1),Array(8).fill(false));
  assert.deepEqual(mesh,before);assert.deepEqual(r.mesh.elements,mesh.elements);assert.deepEqual(r.report.movedNodeIds,[center+1]);
  assert.ok(r.report.after.maximumNonOrthogonalityDegrees<r.report.before.maximumNonOrthogonalityDegrees);
  assert.ok(r.report.after.maximumNormalSizeRatio<=r.report.before.maximumNormalSizeRatio);
  assert.ok(r.report.minimumCornerAfter>=r.report.minimumCornerBefore);assert.ok(r.report.maximumIncidentEdgeFraction<=.25+1e-15);
  mesh.nodes.forEach((p,i)=>{if(i!==center)assert.deepEqual(r.mesh.nodes[i],p);});
  assert.ok(checkNoHangingNodes(r.mesh,1e-10).ok);
  assert.ok(Math.abs(r.mesh.elements.reduce((v,e)=>v+hexElementSignedVolume(e.map(n=>r.mesh.nodes[n-1])),0)-1)<1e-12);
  assert.ok(r.report.maximumParentRelativeVolumeError<1e-12);assert.equal(r.report.engineeringAcceptanceVerified,false);
});
test('uniform-core nodes remain frozen and no-op is explicit',()=>{
  const {source,mesh}=fixture(),uniform=[true,...Array(7).fill(false)],r=relaxTransitionInteriors(source,mesh,Array(8).fill(1),uniform);
  assert.equal(r.mesh,mesh);assert.equal(r.report.eligibleNodes,0);assert.equal(r.report.selectedStep,0);assert.deepEqual(r.report.movedNodeIds,[]);
  assert.throws(()=>relaxTransitionInteriors(source,mesh,[1],uniform),/lineage/);
  assert.throws(()=>relaxTransitionInteriors(source,mesh,Array(8).fill(2),uniform),/lineage/);
  assert.throws(()=>relaxTransitionInteriors({...source,nodes:source.nodes.map(p=>p.map(v=>v+1))},mesh,Array(8).fill(1),uniform),/source node/);
});
test('interior relaxation retains its guarantees under48 cube frames',()=>{
  for(const matrix of properCubeRotations())for(const reflect of [false,true]){
    const {source,mesh}=fixture(),map=p=>matrix.map((row,a)=>row.reduce((sum,v,i)=>sum+v*p[i],0)*(reflect&&a===0?-1:1));
    source.nodes=source.nodes.map(map);mesh.nodes=mesh.nodes.map(map);
    if(reflect){source.elements=source.elements.map(e=>[0,3,2,1,4,7,6,5].map(i=>e[i]));mesh.elements=mesh.elements.map(e=>[0,3,2,1,4,7,6,5].map(i=>e[i]));}
    const r=relaxTransitionInteriors(source,mesh,Array(8).fill(1),Array(8).fill(false));
    assert.ok(r.report.movedNodeIds.length>0);assert.ok(r.report.minimumCornerAfter>=r.report.minimumCornerBefore);
    assert.ok(r.report.maximumParentRelativeVolumeError<1e-12);assert.ok(checkNoHangingNodes(r.mesh,1e-10).ok);
  }
});
