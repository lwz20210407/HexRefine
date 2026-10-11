import test from 'node:test';
import assert from 'node:assert/strict';
import {planRectangularGrading,generateRectangularGradedMesh} from '../dist/index.js';
const base={fullSize:[80,80,16],refinedSize:[32,32],fineSize:1,coarseSize:2,reductions:{x:3,y:3,z:3},
  thicknessTransition:true,transitionStages:2,modelFraction:'half'};

test('angle correction is opt-in and moves either tilt sign toward zero',()=>{
  for(const angle of [85,-85]){
    assert.throws(()=>planRectangularGrading({...base,angleDegrees:angle}),/tilt/i);
    const plan=planRectangularGrading({...base,angleDegrees:angle,angleCorrection:true});
    assert.equal(plan.effectiveAngleDegrees,Math.sign(angle)*44.9);
    assert.equal(plan.spec.angleDegrees,angle);assert.match(plan.warnings.join(' '),/Tilt reduced/);
    assert.ok(Math.abs(plan.offset)<16);
  }
});

test('valid tilts and quarter geometry are not changed by enabling correction',()=>{
  for(const angle of [0,10,-10]){
    const p=planRectangularGrading({...base,angleDegrees:angle,angleCorrection:true});
    assert.equal(p.effectiveAngleDegrees,angle);
    assert.ok(!p.warnings.some(s=>s.includes('Tilt reduced')));
  }
  assert.equal(planRectangularGrading({...base,modelFraction:'quarter',angleDegrees:85,angleCorrection:true}).effectiveAngleDegrees,0);
  assert.throws(()=>planRectangularGrading({...base,angleCorrection:1}),/boolean/);
  assert.throws(()=>planRectangularGrading({...base,angleDegrees:90,angleCorrection:true}),/angleDegrees/);
});

test('corrected single-band geometry still passes mapped volume and Jacobian checks',()=>{
  const r=generateRectangularGradedMesh({...base,fullSize:[20,20,4],refinedSize:[8,8],transitionStages:1,
    angleDegrees:85,angleCorrection:true});
  assert.equal(r.plan.effectiveAngleDegrees,71.5);
  assert.ok(r.quality.minimumCornerScaledJacobian>0 && r.quality.minimumGaussDeterminant>0);
  assert.ok(r.quality.relativeVolumeError<1e-8);
});
