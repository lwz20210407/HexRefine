import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultGui61Request,planGui61ConcentricWidths,applyGui61ConcentricWidthPlan,generateGui61} from '../dist/index.js';
const criteria={minimumCornerScaledJacobian:.2,maximumTransitionEdgeAspectRatio:6,minimumTransitionEdgeToCoreRatio:1};
test('GUI width proposal is nonmutating, explicit, replayable and invalidated by stale drafts',()=>{
  const r=defaultGui61Request('concentric-circular-solid'),before=structuredClone(r);
  const proposal=planGui61ConcentricWidths(r,criteria);assert.deepEqual(r,before);
  const next=applyGui61ConcentricWidthPlan(r,proposal);assert.deepEqual(next.parameters,proposal.resolvedRequest.parameters);
  assert.deepEqual(r,before);const mesh=generateGui61(next);assert.equal(mesh.summary.solids,proposal.counts.elements);
  const stale=structuredClone(r);stale.parameters.height=16;
  assert.throws(()=>applyGui61ConcentricWidthPlan(stale,proposal),/过期/);
  const tampered=structuredClone(proposal);tampered.resolvedRequest.parameters.coreRadius=3;
  assert.throws(()=>applyGui61ConcentricWidthPlan(r,tampered),/冻结/);
  const lowered=structuredClone(proposal);lowered.resolvedRequest.parameters.minimumCornerScaledJacobian=0;
  assert.throws(()=>applyGui61ConcentricWidthPlan({...r,parameters:{...r.parameters,minimumCornerScaledJacobian:.2}},lowered));
});
test('GUI width proposal failure never becomes an automatic edit or exports a guessed result',()=>{
  const r=defaultGui61Request('concentric-circular-solid'),before=structuredClone(r);
  assert.throws(()=>planGui61ConcentricWidths(r,{...criteria,minimumTransitionEdgeToCoreRatio:100}));
  assert.deepEqual(r,before);
  assert.throws(()=>planGui61ConcentricWidths(defaultGui61Request('rectangular-solid'),criteria));
});
