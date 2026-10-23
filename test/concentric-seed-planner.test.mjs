import test from 'node:test';
import assert from 'node:assert/strict';
import {planConcentricSeeds,prepareConcentricCircularMesh} from '../dist/index.js';

const request={schemaVersion:1,parameters:{radius:16,height:8,coreRadius:4,radiusSegments:19,arcSegments:31,axialSegments:15,modelFraction:'quarter',
  rings:[{innerRadius:4.5,outerRadius:5.5},{innerRadius:8.5,outerRadius:10.5}]},
  targets:{maximumRadiusSpacing:.5,maximumArcSpacing:.5,maximumAxialSpacing:.5}};
for(const fraction of ['quarter','half','full'])test(`seed proposal ${fraction} repairs divisibility without changing geometry`,()=>{
  const r=structuredClone(request);r.parameters.modelFraction=fraction;const before=structuredClone(r),result=planConcentricSeeds(r);
  assert.deepEqual(r,before);const p=result.resolvedRequest.parameters;
  assert.equal(p.radiusSegments,19);assert.equal(p.arcSegments,32);assert.equal(p.axialSegments,16);
  for(const k of Object.keys(p).filter(k=>!k.endsWith('Segments')))assert.deepEqual(p[k],r.parameters[k]);
  for(const [k,value] of Object.entries(result.report.nominalSpacings))assert.ok(value<=.5,k);
  assert.equal(result.report.topologyAndQualityAudited,false);
  const mesh=prepareConcentricCircularMesh(p);assert.equal(mesh.counts.elements,result.plan.expectedElements);
  assert.equal(mesh.quality.hangingCheckPassed,true);assert.ok(mesh.quality.relativeDiscreteVolumeError<1e-8);
});
test('target-driven counts, patch compatibility and stronger existing seeds are explicit',()=>{
  const r=structuredClone(request);r.targets.maximumArcSpacing=.15;
  const out=planConcentricSeeds(r);assert.equal(out.resolvedRequest.parameters.arcSegments,44);
  assert.equal(out.resolvedRequest.parameters.radiusSegments,23);
  assert.equal(out.report.changes.length,3);
  assert.ok(out.report.nominalSpacings.arcLength<=.15);
  const again=planConcentricSeeds({...r,parameters:out.resolvedRequest.parameters});assert.equal(again.report.changes.length,0);
});
test('counts never silently coarsen to fit an element or motif budget',()=>{
  const r=structuredClone(request);r.parameters.elementLimit=1;assert.throws(()=>planConcentricSeeds(r),/exceeds/);
  delete r.parameters.elementLimit;r.parameters.motifElementLimit=1;assert.throws(()=>planConcentricSeeds(r),/exceeds/);
});
for(const value of [0,-1,NaN,Infinity,'0.5',null])test(`invalid nominal target ${String(value)} rejected`,()=>{
  const r=structuredClone(request);r.targets.maximumAxialSpacing=value;assert.throws(()=>planConcentricSeeds(r));
});
test('strict schema, missing targets, unsupported rings and unsafe counts fail before allocation',()=>{
  assert.throws(()=>planConcentricSeeds({...request,extra:true}));
  assert.throws(()=>planConcentricSeeds({...request,targets:{}}));
  assert.throws(()=>planConcentricSeeds({...request,schemaVersion:2}));
  const r=structuredClone(request);r.targets.maximumArcSpacing=Number.MIN_VALUE;assert.throws(()=>planConcentricSeeds(r),/safe integer/);
  r.targets.maximumArcSpacing=.5;r.parameters.rings=[];assert.throws(()=>planConcentricSeeds(r));
});
