import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCircularGradedMesh as generate,checkNoHangingNodes} from '../dist/index.js';
const base={radius:20,thickness:6,coreHalfSize:8,fineSize:1,coarseSize:6,reductions:{x:3,y:3},modelFraction:'half'};

for(const x of [2,3])for(const y of [2,3])for(const sign of [-1,1]){
  test(`circular correction ${x}/${y}/3 sign=${sign}`,()=>{
    const requested=sign*60.07,spec={...base,reductions:{x,y},angleDegrees:requested};
    assert.throws(()=>generate(spec),/insufficient room/);
    assert.throws(()=>generate({...spec,angleCorrection:false}),/insufficient room/);
    const r=generate({...spec,angleCorrection:true});
    assert.equal(r.plan.requestedAngleDegrees,requested);
    assert.equal(r.plan.angleCorrection.applied,true);
    assert.ok(Math.abs(r.plan.angleDegrees-sign*55.27)<1e-9);
    assert.ok(Math.abs((Math.abs(requested)-Math.abs(r.plan.angleDegrees))*10-Math.round((Math.abs(requested)-Math.abs(r.plan.angleDegrees))*10))<1e-9);
    assert.ok(checkNoHangingNodes(r.mesh,1e-7).ok);
    assert.ok(r.quality.minimumCornerScaledJacobian>0&&r.quality.minimumGaussDeterminant>0);
    assert.ok(r.quality.relativeDiscreteVolumeError<1e-9);
    assert.ok(r.plan.warnings.some(w=>w.includes('not a quality optimizer')));
    const manual=generate({...spec,angleDegrees:r.plan.angleDegrees});
    assert.deepEqual(r.mesh,manual.mesh);
  });
}
test('circular correction leaves valid angles unchanged and validates its input',()=>{
  const a=generate({...base,angleDegrees:15}),b=generate({...base,angleDegrees:15,angleCorrection:true});
  assert.deepEqual(a.mesh,b.mesh);assert.equal(b.plan.angleCorrection.applied,false);
  assert.throws(()=>generate({...base,angleDegrees:60,angleCorrection:'yes'}),/boolean/);
  assert.throws(()=>generate({...base,modelFraction:'quarter',angleDegrees:60,angleCorrection:true}),/quarter/);
  assert.throws(()=>generate({...base,coreHalfSize:19,angleCorrection:true}),/does not fit/);
});
test('geometric angle correction never hides a failing final mesh audit',()=>{
  for(const sign of [-1,1])assert.throws(()=>generate({...base,coarseSize:2,angleDegrees:sign*80,angleCorrection:true}),/not conforming|quality audit failed/);
});
