import test from 'node:test';
import assert from 'node:assert/strict';
import {generateGradedReinforcedMesh as generate,meshToLsdynaMixedKeyword,parseNativeLsdynaMixedKeyword} from '../dist/index.js';
const base={concrete:{fullSize:[24,24,12],refinedSize:[12,12],fineSize:1,coarseSize:3,reductions:{x:3,y:3,z:3},
  modelFraction:'half',transitionStages:1,thicknessTransition:true},rebarMeshSize:3,barCounts:[3,3,3],cover:[0,0,0,0,0,0],includeZBars:true,connectivity:'shared'};
function physicalSegments(r){return r.model.beams.map(b=>b.nodes.map(n=>r.model.nodes[n-1]));}
for(const modelFraction of ['quarter','half','full'])for(const includeZBars of [false,true]){
  test(`shared graded reinforcement ${modelFraction} Z=${includeZBars}`,()=>{
    const spec={...base,includeZBars,concrete:{...base.concrete,modelFraction}},copy=structuredClone(spec);
    const separate=generate({...spec,connectivity:'separate'}),r=generate(spec);
    assert.deepEqual(spec,copy);assert.deepEqual(r.concreteMesh,separate.concreteMesh);
    assert.deepEqual(r.model.solids,separate.model.solids);assert.deepEqual(r.cellSets,separate.cellSets);
    assert.deepEqual(r.model.beams.map(b=>b.id),separate.model.beams.map(b=>b.id));
    const active=new Set(r.model.solids.flatMap(e=>e.nodes)),endpoints=new Set(r.model.beams.flatMap(e=>e.nodes));
    assert.ok([...endpoints].every(n=>active.has(n)));
    assert.ok(r.nodeSets.rebar_orientation.every(n=>!active.has(n)&&!endpoints.has(n)));
    assert.equal(r.quality.sharedEndpointNodes,endpoints.size);
    assert.equal(r.model.nodes.length,r.concreteMesh.nodes.length+r.nodeSets.rebar_orientation.length);
    const a=physicalSegments(r),b=physicalSegments(separate);
    a.forEach((e,i)=>e.forEach((p,j)=>p.forEach((v,k)=>assert.ok(Math.abs(v-b[i][j][k])<=r.quality.sharedEndpointTolerance))));
    assert.deepEqual(parseNativeLsdynaMixedKeyword(meshToLsdynaMixedKeyword(r.model,{coordinateFormat:'compact'})),r.model);
  });
}
test('shared mode refuses unmatched endpoints rather than silently snapping or partially coupling',()=>{
  for(const concrete of [{...base.concrete,angleDegrees:10},{...base.concrete,reductions:{x:2,y:3,z:3}}]){
    const spec={...base,concrete,rebarMeshSize:1,barCounts:[3,3,3]};
    assert.throws(()=>generate(spec),/without matching active solid nodes/);
  }
  assert.throws(()=>generate({...base,connectivity:'embedded'}),/embedding is not implemented/);
});
