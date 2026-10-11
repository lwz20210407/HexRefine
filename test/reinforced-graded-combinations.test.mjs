import test from 'node:test';
import assert from 'node:assert/strict';
import {generateGradedReinforcedMesh as generate,planGradedReinforcement as plan,checkNoHangingNodes,meshToLsdynaMixedKeyword,parseNativeLsdynaMixedKeyword} from '../dist/index.js';
const concrete={fullSize:[40,32,12],refinedSize:[16,12],fineSize:1,coarseSize:2,reductions:{x:3,y:3,z:3},modelFraction:'half',transitionStages:1,thicknessTransition:true};
const base={concrete,rebarMeshSize:2,barCounts:[4,5,3],cover:[2,2,0,0,2,2],includeZBars:true,connectivity:'separate'};
const segments=r=>r.model.beams.map(b=>b.nodes.map(n=>r.model.nodes[n-1])).map(e=>e.map(p=>p.map(v=>+v.toFixed(9))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
const keys=s=>s.map(e=>JSON.stringify(e)).sort();
function audit(r,fraction){
  assert.ok(checkNoHangingNodes(r.concreteMesh,1e-7).ok);
  assert.ok(r.quality.minimumCornerScaledJacobian>0&&r.quality.minimumGaussDeterminant>0);
  assert.ok(r.quality.relativeVolumeError<1e-8);
  assert.ok(Math.abs(r.quality.volume-r.plan.actualSize.reduce((a,b)=>a*b,1)/({quarter:4,half:2,full:1}[fraction]))<1e-6);
  for(const beam of r.model.beams)for(const n of beam.nodes){
    const p=r.model.nodes[n-1];
    p.forEach((v,a)=>assert.ok(v>=r.plan.bounds[a][0]-1e-10&&v<=r.plan.bounds[a][1]+1e-10));
    assert.ok(n>r.concreteMesh.nodes.length);
  }
  assert.equal(r.model.beams.length,r.plan.beamCount);
  const back=parseNativeLsdynaMixedKeyword(meshToLsdynaMixedKeyword(r.model,{coordinateFormat:'compact'}));
  assert.deepEqual(back.beams,r.model.beams);assert.deepEqual(back.solids,r.model.solids);
}
for(const modelFraction of ['quarter','half','full'])for(const includeZBars of [true,false]){
  test(`graded reinforcement fraction ${modelFraction} Z=${includeZBars}`,()=>{
    const r=generate({...base,includeZBars,concrete:{...concrete,modelFraction}});audit(r,modelFraction);
    assert.equal(r.model.beams.length,({quarter:includeZBars?174:138,half:includeZBars?348:276,full:includeZBars?612:492})[modelFraction]);
  });
}
for(const modelFraction of ['half','full'])for(const angleDegrees of [-10,10]){
  test(`tilted concrete keeps axis-aligned steel ${modelFraction} ${angleDegrees}`,()=>{
    const spec={...base,concrete:{...concrete,modelFraction}},zero=generate(spec);
    const r=generate({...spec,concrete:{...spec.concrete,angleDegrees}});audit(r,modelFraction);
    assert.deepEqual(keys(segments(r)),keys(segments(zero)));
    assert.notDeepEqual(r.concreteMesh.nodes,zero.concreteMesh.nodes);
    assert.equal(r.plan.concrete.effectiveAngleDegrees,angleDegrees);
  });
}
test('quarter retains the rectangular forced-zero tilt rule and warning',()=>{
  const p=plan({...base,concrete:{...concrete,modelFraction:'quarter',angleDegrees:10}});
  assert.equal(p.concrete.effectiveAngleDegrees,0);assert.ok(p.warnings.some(w=>w.includes('forces')));
});
test('even rows, asymmetric covers and odd subdivisions are clipped from full layout',()=>{
  const spec={...base,concrete:{...concrete,fullSize:[40,42,12],refinedSize:[16,14]},barCounts:[4,4,3],cover:[2,2,2,4,2,2]};
  const full=generate({...spec,concrete:{...spec.concrete,modelFraction:'full'}});
  const half=generate(spec);audit(half,'half');audit(full,'full');
  const expected=[];
  for(const e of segments(full)){
    let [a,b]=e.map(p=>[...p]);if(a[1]<0&&b[1]<0)continue;
    if(a[1]<0||b[1]<0){const t=-a[1]/(b[1]-a[1]);const cut=a.map((v,i)=>v+t*(b[i]-v));cut[1]=0;if(a[1]<0)a=cut;else b=cut;}
    if(a.some((v,i)=>Math.abs(v-b[i])>1e-10))expected.push([a,b].map(p=>p.map(v=>+v.toFixed(9))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  }
  assert.deepEqual(keys(segments(half)),keys(expected));
  assert.equal(half.plan.axisCoordinates[1][1]-half.plan.axisCoordinates[1][0],1);
  assert.ok(half.plan.axisCoordinates[1].slice(2).every((v,i)=>Math.abs(v-half.plan.axisCoordinates[1][i+1]-2)<1e-10));
  assert.ok(half.plan.warnings.some(w=>w.includes('truncates')));
});
for(const configuration of [
  {modelFraction:'quarter',reductions:{x:2,y:2,z:2},thicknessTransition:true,angleDegrees:0},
  {modelFraction:'half',reductions:{x:3,y:3,z:3},thicknessTransition:true,angleDegrees:10},
  {modelFraction:'full',reductions:{x:2,y:3,z:2},thicknessTransition:false,angleDegrees:-10}]){
  test(`graded reinforcement native two-stage extension ${configuration.modelFraction}`,()=>{
    const r=generate({...base,concrete:{...concrete,fullSize:[80,80,16],refinedSize:[32,32],transitionStages:2,...configuration},
      rebarMeshSize:2,barCounts:[4,5,3],cover:[4,4,4,4,2,2]});
    audit(r,configuration.modelFraction);assert.ok(r.plan.sourceExtensions.some(w=>w.includes('Multi-stage')));
  });
}
