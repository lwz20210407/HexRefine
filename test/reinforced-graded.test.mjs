import test from 'node:test';
import assert from 'node:assert/strict';
import {generateGradedReinforcedMesh,planGradedReinforcement,meshToLsdynaMixedKeyword,parseNativeLsdynaMixedKeyword,checkNoHangingNodes} from '../dist/index.js';

const concrete={fullSize:[40,32,12],refinedSize:[16,12],fineSize:1,coarseSize:2,reductions:{x:3,y:3,z:3},
  modelFraction:'half',transitionStages:1,thicknessTransition:true};
const base={concrete,rebarMeshSize:2,barCounts:[4,5,3],cover:[2,2,0,0,2,2],includeZBars:true,connectivity:'separate'};
for(const x of [2,3])for(const y of [2,3])for(const includeZBars of [false,true]){
  test(`graded reinforced half ${x}/${y}/3 Z=${includeZBars}`,()=>{
    const r=generateGradedReinforcedMesh({...base,includeZBars,concrete:{...concrete,reductions:{x,y,z:3}}});
    assert.deepEqual(r.plan.counts,[20,16,6]);
    assert.deepEqual(r.plan.resolvedCover,base.cover);
    assert.deepEqual(r.plan.locations, [[-18,-6,6,18],[0,8,16],[2,6,10]]);
    assert.equal(r.model.beams.length,includeZBars?348:276);
    assert.equal(r.cellSets.bars_z.length,includeZBars?72:0);
    assert.ok(checkNoHangingNodes(r.concreteMesh,1e-7).ok);
    assert.ok(r.quality.minimumCornerScaledJacobian>0&&r.quality.minimumGaussDeterminant>0);
    assert.ok(r.quality.relativeVolumeError<1e-9);
    assert.ok(Math.abs(r.quality.volume-40*16*12)<1e-6);
    assert.equal(r.quality.regions.core.minimumCornerScaledJacobian,1);
    assert.ok(r.quality.regions.transition.count>0&&r.quality.regions.farField.count>0);
    assert.equal(r.parentElementIds.length,r.model.solids.length);
    assert.ok(r.nodeSets.rebar_endpoints.every(n=>n>r.concreteMesh.nodes.length));
    assert.deepEqual(new Set(r.model.solids.map(e=>e.partId)),new Set([3]));
    for(const b of r.model.beams){
      assert.equal(b.partId,2);
      const [a,c]=b.nodes.map(n=>r.model.nodes[n-1]);
      assert.ok(Math.abs(Math.hypot(...a.map((v,i)=>v-c[i]))-2)<1e-10);
      for(const p of [a,c])assert.ok(p[0]>=-20&&p[0]<=20&&p[1]>=0&&p[1]<=16&&p[2]>=0&&p[2]<=12);
    }
    const back=parseNativeLsdynaMixedKeyword(meshToLsdynaMixedKeyword(r.model,{coordinateFormat:'compact'}));
    assert.deepEqual(back.solids,r.model.solids);assert.deepEqual(back.beams,r.model.beams);
  });
}
test('graded reinforcement fixes undefined source Z cover counter and reports adjustments',()=>{
  const p=planGradedReinforcement({...base,barCounts:[4,5,4]});
  assert.deepEqual(p.resolvedCover,[2,2,0,0,0,0]);
  assert.deepEqual(p.locations[2],[0,4,8,12]);
  assert.equal(p.beamCount,440);assert.ok(p.warnings.some(s=>s.includes('adjusted')));
});
test('graded reinforcement refuses unsafe or unverified combinations explicitly',()=>{
  for(const patch of [{connectivity:'shared'},{includeZBars:1},{rebarMeshSize:0},{barCounts:[4,4,3]},
    {cover:[0,0,0,0,0,0],barCounts:[8,5,3]},
    {cover:[2,2,-1,0,2,2]},{barCounts:[1000000000,5,3]},{concretePartId:2},{unknown:true}]){
    assert.throws(()=>planGradedReinforcement({...base,...patch}));
  }
  for(const patch of [{modelFraction:'invalid'},{transitionStages:3},{angleDegrees:90},{thicknessTransition:1},{reductions:{x:3,y:3,z:4}}]){
    assert.throws(()=>planGradedReinforcement({...base,concrete:{...concrete,...patch}}));
  }
});
