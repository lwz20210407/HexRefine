import test from 'node:test';
import assert from 'node:assert/strict';
import {generateGradedReinforcedMesh,generateUniformReinforcedMesh,planUniformReinforcement,planGradedReinforcement,checkNoHangingNodes,meshToLsdynaMixedKeyword,parseNativeLsdynaMixedKeyword,validateLsdynaMixedSets} from '../dist/index.js';
import {auditReinforcementBeams} from '../dist/reinforcement-quality.js';

const base={concrete:{fullSize:[40,40,8],refinedSize:[8,8],fineSize:2,coarseSize:2,reductions:{x:3,y:3,z:3},thicknessTransition:true,transitionStages:1,modelFraction:'half'},
  rebarMeshSize:2,barCounts:[3,3,3],cover:[2,2,2,2,2,2],includeZBars:true,connectivity:'separate'};

for(const transitionStages of [1,2])for(const modelFraction of ['quarter','half','full']){
  test(`RC discrete control matrix stages=${transitionStages} fraction=${modelFraction}`,()=>{
    let attempts=0;
    for(const x of [2,3])for(const y of [2,3])for(const effectiveZ of [1,2,3])for(const includeZBars of [false,true]){
      const r=generateGradedReinforcedMesh({...base,includeZBars,concrete:{...base.concrete,transitionStages,modelFraction,
        reductions:{x,y,z:effectiveZ===1?3:effectiveZ},thicknessTransition:effectiveZ!==1}});
      attempts++;
      assert.ok(r.quality.minimumCornerScaledJacobian>0&&r.quality.minimumGaussDeterminant>0);
      assert.ok(r.quality.relativeVolumeError<1e-8);assert.ok(checkNoHangingNodes(r.concreteMesh,1e-7).ok);
      assert.equal(r.plan.beamCount,r.model.beams.length);
      assert.deepEqual(r.plan.axisBeamCounts,[r.quality.beamAxes.x.count,r.quality.beamAxes.y.count,r.quality.beamAxes.z.count]);
      assert.equal(r.quality.beamAxes.z.count>0,includeZBars);
      assert.ok(r.quality.minimumBeamLength>0&&r.quality.minimumBeamOrientationSine>0);
      assert.equal(r.quality.sharedEndpointNodes,0);assert.equal(r.quality.couplingVerified,false);
      const fraction={quarter:4,half:2,full:1}[modelFraction];
      assert.ok(Math.abs(r.quality.volume-40*40*8/fraction)<1e-6);
      const beamLength=(modelFraction==='quarter'?[20,20,8]:modelFraction==='half'?[40,20,8]:[40,40,8]);
      const familyLines=[r.plan.locations[1].length*r.plan.locations[2].length,r.plan.locations[0].length*r.plan.locations[2].length,includeZBars?r.plan.locations[0].length*r.plan.locations[1].length:0];
      for(const [i,axis] of ['x','y','z'].entries())assert.ok(Math.abs(r.quality.beamAxes[axis].totalLength-familyLines[i]*beamLength[i])<1e-8);
      const counts=new Map();for(const p of r.parentElementIds)counts.set(p,(counts.get(p)??0)+1);
      for(const p of r.coreParentIds)assert.equal(counts.get(p),(x*y*effectiveZ)**transitionStages);
      validateLsdynaMixedSets(r.model,{nodeSets:r.nodeSets,cellSets:r.cellSets});
      const back=parseNativeLsdynaMixedKeyword(meshToLsdynaMixedKeyword(r.model,{coordinateFormat:'compact'}));
      assert.deepEqual(back.solids,r.model.solids);assert.deepEqual(back.beams,r.model.beams);
    }
    assert.equal(attempts,24);
  });
}

test('uniform RC count/cover boundaries and strongly nonsquare dimensions',()=>{
  for(const connectivity of ['separate','shared'])for(const includeZBars of [false,true])for(const barCounts of [[2,2,2],[3,3,3],[6,4,5]]){
    const spec={size:[20,12,8],meshSize:1,barCounts,cover:[0,0,0],includeZBars,connectivity,dimensionPolicy:'preserve'};
    const r=generateUniformReinforcedMesh(spec);
    assert.deepEqual(r.plan.actualSize,spec.size);assert.equal(r.quality.beamCount,r.model.beams.length);
    assert.equal(r.quality.beamAxes.x.count,20*barCounts[1]*barCounts[2]);assert.equal(r.quality.beamAxes.y.count,12*barCounts[0]*barCounts[2]);
    assert.equal(r.quality.beamAxes.z.count,includeZBars?8*barCounts[0]*barCounts[1]:0);
    assert.equal(r.quality.minimumBeamLength,1);assert.equal(r.quality.maximumBeamLength,1);
    assert.equal(r.quality.sharedEndpointNodes>0,connectivity==='shared');
  }
  const spec={size:[20,12,8],meshSize:1,barCounts:[2,2,2],cover:[10,0,0],includeZBars:false,connectivity:'separate',dimensionPolicy:'preserve'};
  assert.throws(()=>planUniformReinforcement(spec),/spacing/);
  assert.throws(()=>planUniformReinforcement({...spec,cover:[0,0,0],barCounts:[1000000,2,2]}),/spacing|limit|dimension/);
});

test('graded covers reject impossible alignment and retain only clipped end segments',()=>{
  for(const patch of [{barCounts:[40,3,3],cover:[0,0,0,0,0,0]}, {cover:[20,20,2,2,2,2]},
    {barCounts:[3,3,10000000]}, {rebarMeshSize:100}, {cover:[2,2,-1,2,2,2]}])assert.throws(()=>planGradedReinforcement({...base,...patch}));
  const r=generateGradedReinforcedMesh({...base,concrete:{...base.concrete,fullSize:[40,42,8],refinedSize:[8,14]},barCounts:[3,4,3],cover:[2,2,2,4,2,2]});
  assert.equal(r.quality.beamAxes.y.minimumLength,1);assert.equal(r.quality.beamAxes.y.maximumLength,2);
});

test('beam quality audit reports invalid axis and identity policy rather than inventing coupling',()=>{
  const r=generateGradedReinforcedMesh(base),bad=structuredClone(r.model);
  bad.nodes[bad.beams[0].nodes[1]-1][0]+=.1;assert.throws(()=>auditReinforcementBeams(bad,'separate'),/aligned/);
  assert.throws(()=>auditReinforcementBeams(r.model,'shared'),/policy/);
});
