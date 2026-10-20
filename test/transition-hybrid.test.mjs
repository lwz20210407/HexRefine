import test from 'node:test';
import assert from 'node:assert/strict';
import {planHybridTransitionBand,generateHybridTransitionBand,extrudeTransitionBand,checkNoHangingNodes} from '../dist/index.js';

test('same-stage hybrid planning balances real template ports and preserves explicit order',()=>{
  const spec={fineSegments:14,coarseSegments:6,length:14,depth:2};
  const plan=planHybridTransitionBand(spec);
  assert.deepEqual(plan.blocks,['single3','single3','pair2','pair2']);
  assert.equal(plan.single3Count,2);assert.equal(plan.pair2Count,2);assert.equal(plan.stageCount,1);
  const explicit=['pair2','single3','pair2','single3'];
  assert.deepEqual(planHybridTransitionBand({...spec,blocks:explicit}).blocks,explicit);
  for(const [fineSegments,coarseSegments] of [[14,5],[10,6],[20,4],[14.1,6],[true,1]])
    assert.throws(()=>planHybridTransitionBand({...spec,fineSegments,coarseSegments}));
  assert.throws(()=>planHybridTransitionBand({...spec,blocks:['single3','pair2']}),/blocks/);
});

for(const order of ['grouped','interleave'])for(const fineSide of ['bottom','top'])
test(`hybrid ${order}/${fineSide} has nonuniform coarse widths, valid joins and Hex extrusion`,()=>{
  const spec={fineSegments:14,coarseSegments:6,length:14,depth:2,order,fineSide};
  const original=structuredClone(spec),r=generateHybridTransitionBand(spec);
  assert.deepEqual(spec,original);assert.equal(r.mesh.elements.length,20);
  assert.equal(r.nodeSets.fine.length,15);assert.equal(r.nodeSets.coarse.length,7);
  const coarse=r.nodeSets.coarse.map(i=>r.mesh.nodes[i-1][0]).sort((a,b)=>a-b);
  const widths=coarse.slice(1).map((x,i)=>x-coarse[i]);
  assert.equal(widths.filter(x=>Math.abs(x-2)<1e-10).length,4);
  assert.equal(widths.filter(x=>Math.abs(x-3)<1e-10).length,2);
  assert.ok(checkNoHangingNodes(r.mesh,1e-9).ok);assert.ok(r.quality.minimumGaussDeterminant>0);
  const solid=extrudeTransitionBand(r,1,2);
  assert.equal(solid.mesh.elements.length,40);assert.ok(solid.stageIds.every(i=>i===1));
  assert.ok(solid.quality.relativeVolumeError<1e-12);
});

test('hybrid pure endpoints and transformed explicit blocks remain conforming',()=>{
  for(const [fineSegments,coarseSegments] of [[12,6],[12,4],[14,6]]){
    const r=generateHybridTransitionBand({fineSegments,coarseSegments,length:14,depth:3,
      rotationDegrees:30,origin:[-5,7]});
    assert.ok(r.quality.relativeAreaError<1e-12);
    assert.ok(checkNoHangingNodes(r.mesh,1e-9).ok);
  }
});
