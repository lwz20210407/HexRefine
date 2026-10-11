import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCircularGradedMesh,checkNoHangingNodes} from '../dist/index.js';
import {applyMarkedHalfSweep} from '../dist/two-to-one-sweep.js';
const base={radius:20,thickness:6,coreHalfSize:8,fineSize:1,coarseSize:2,reductions:{x:3,y:3},modelFraction:'half'};

for(const modelFraction of ['quarter','half','full'])for(const x of [2,3])for(const y of [2,3]){
  test(`circular ${modelFraction} ${x}/${y}/3 preserves core, boundary, and discrete volume`,()=>{
    const input={...base,modelFraction,reductions:{x,y}},before=structuredClone(input);
    const r=generateCircularGradedMesh(input);
    assert.deepEqual(input,before);
    assert.ok(r.quality.minimumCornerScaledJacobian>0.1);
    assert.ok(r.quality.minimumGaussDeterminant>0);
    assert.ok(r.quality.relativeDiscreteVolumeError<1e-10);
    assert.ok(r.quality.radialBoundaryError<1e-12);
    assert.ok(r.quality.relativeAnalyticVolumeError>0 && r.quality.relativeAnalyticVolumeError<0.03);
    assert.equal(checkNoHangingNodes(r.mesh,1e-7).ok,true);
    const counts=new Map();r.parentElementIds.forEach(p=>counts.set(p,(counts.get(p)??0)+1));
    assert.equal(counts.size,r.baseMesh.elements.length);
    for(const p of r.coreParentIds)assert.equal(counts.get(p),x*y*3);
    const support=new Set(r.coreParentIds.flatMap(p=>r.baseMesh.elements[p-1]));
    r.baseMesh.elements.forEach((e,i)=>{if(!e.some(n=>support.has(n)))assert.equal(counts.get(i+1),1);});
    if(modelFraction==='quarter')assert.ok(r.mesh.nodes.every(p=>p[0]>=-1e-10 && p[1]>=-1e-10));
    if(modelFraction!=='full')assert.ok(r.mesh.nodes.every(p=>p[1]>=-1e-10));
    if(modelFraction==='half' && x===3 && y===3) {
      assert.equal(r.mesh.nodes.length,1784);assert.equal(r.mesh.elements.length,1404);
    }
    if(modelFraction==='half' && x===2 && y===3) {
      assert.equal(r.mesh.nodes.length,1672);assert.equal(r.mesh.elements.length,1304);
    }
    if(modelFraction==='full' && x===3 && y===3) {
      assert.equal(r.mesh.nodes.length,3391);assert.equal(r.mesh.elements.length,2808);
    }
  });
}

test('circular generator refuses unsupported GUI options instead of ignoring them',()=>{
  assert.throws(()=>generateCircularGradedMesh({...base,angleDegrees:10}),/tilt/);
  assert.throws(()=>generateCircularGradedMesh({...base,thicknessTransition:false}),/unsupported circular options/);
  assert.throws(()=>generateCircularGradedMesh({...base,reductions:{x:3,y:3,z:2}}),/fixed at 3/);
  assert.throws(()=>generateCircularGradedMesh({...base,elementLimit:500}),/unsupported circular options/);
  assert.throws(()=>generateCircularGradedMesh({...base,radius:10}),/does not fit/);
});

test('marked half-sweep rejects bad IDs and invalid tolerances',()=>{
  const mesh={kind:'H1',nodes:[],elements:[]};
  assert.throws(()=>applyMarkedHalfSweep(mesh,[1],1e-8),/invalid/);
  assert.throws(()=>applyMarkedHalfSweep(mesh,[],0),/invalid/);
});
