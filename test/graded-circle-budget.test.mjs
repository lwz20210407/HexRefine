import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCircularGradedMesh as generate} from '../dist/index.js';
const base={radius:20,thickness:6,coreHalfSize:8,fineSize:1,coarseSize:2,reductions:{x:3,y:3},modelFraction:'half'};

test('circular budget matches the measured source cap and approach results',()=>{
  const cap=generate({...base,elementLimit:800});
  assert.equal(cap.plan.elementBudget.stepIndex,24);assert.equal(cap.mesh.elements.length,720);
  assert.equal(cap.plan.elementBudget.effectiveFineSize,1.24);
  const approach=generate({...base,elementLimit:1500,approachElementLimit:true});
  assert.equal(approach.plan.elementBudget.stepIndex,-7);
  assert.ok(Math.abs(approach.plan.elementBudget.effectiveFineSize-.93)<1e-12);
  assert.equal(approach.mesh.elements.length,1404);
  assert.ok(generate({...base,fineSize:.92}).mesh.elements.length>1500);
  const unchanged=generate({...base,elementLimit:1500});
  assert.equal(unchanged.plan.elementBudget.stepIndex,0);
});
for(const modelFraction of ['quarter','half','full'])for(const x of [2,3])for(const y of [2,3]){
  test(`exact circular budget count ${modelFraction} ${x}/${y}/3`,()=>{
    const spec={...base,modelFraction,reductions:{x,y},elementLimit:1200,approachElementLimit:true};
    const r=generate(spec),p=r.plan.elementBudget;
    assert.equal(r.mesh.elements.length,p.expectedElements);
    assert.ok(r.mesh.elements.length<=1200&&r.quality.minimumCornerScaledJacobian>0);
    if(p.stepIndex>-99){
      const previous=generate({...base,modelFraction,reductions:{x,y},fineSize:base.fineSize*(1+(p.stepIndex-1)/100)});
      assert.ok(previous.mesh.elements.length>1200);
    }
  });
}
test('circular budget refuses impossible limits and malformed controls',()=>{
  for(const elementLimit of [0,-1,1.5,Infinity,1])assert.throws(()=>generate({...base,elementLimit}));
  assert.throws(()=>generate({...base,approachElementLimit:true}),/requires/);
  assert.throws(()=>generate({...base,elementLimit:1000,approachElementLimit:1}),/boolean/);
});
