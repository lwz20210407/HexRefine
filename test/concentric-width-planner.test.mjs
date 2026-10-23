import test from 'node:test';
import assert from 'node:assert/strict';
import {planConcentricRingWidths,ConcentricWidthPlanningError,planConcentricCircularMesh,prepareConcentricCircularMesh} from '../dist/index.js';

const base={schemaVersion:1,parameters:{radius:16,height:8,coreRadius:4,radiusSegments:20,arcSegments:32,axialSegments:16,modelFraction:'quarter',
  rings:[{innerRadius:4.5,outerRadius:5.5},{innerRadius:8.5,outerRadius:10.5}]},
  criteria:{minimumCornerScaledJacobian:.2,maximumTransitionEdgeAspectRatio:6,minimumTransitionEdgeToCoreRatio:1}};

for(const modelFraction of ['quarter','half','full'])test(`bounded width planning ${modelFraction} preserves the core and meets all actual gates`,()=>{
  const request={...structuredClone(base),parameters:{...structuredClone(base.parameters),modelFraction}},before=structuredClone(request);
  const result=planConcentricRingWidths(request);assert.deepEqual(request,before);
  const after=result.resolvedRequest.parameters;
  for(const key of Object.keys(request.parameters).filter(k=>k!=='rings'))assert.deepEqual(after[key],request.parameters[key]);
  assert.equal(after.minimumCornerScaledJacobian,.2);
  for(let i=0;i<after.rings.length;i++)assert.equal(after.rings[i].innerRadius,request.parameters.rings[i].innerRadius);
  assert.ok(result.quality.minimumCornerScaledJacobian>=.2);
  assert.ok(result.report.actualTransitionEdgeAspectRatio<=6&&result.report.actualTransitionEdgeToCoreRatio>=1);
  assert.ok(result.report.actualRegularEdgeToCoreRatio===null||result.report.actualRegularEdgeToCoreRatio>=1);
  assert.equal(result.quality.unexpectedInternalFreeFaces,0);assert.equal(result.quality.hangingCheckPassed,true);
  assert.equal(result.quality.periodicPartitionsIdentical,true);assert.ok(result.quality.relativeDiscreteVolumeError<1e-8);
  assert.equal(result.plan.expectedCoreElements,planConcentricCircularMesh(request.parameters).expectedCoreElements);
  assert.ok(result.report.diagnostics.fullAudits<=4&&result.report.diagnostics.localEvaluations<=128);
  assert.equal(result.report.engineeringAcceptanceVerified,false);assert.match(result.report.optimalityClaim,/none/);
  const replay=prepareConcentricCircularMesh(after);
  assert.deepEqual(replay.counts,result.counts);assert.deepEqual(replay.quality,result.quality);
  assert.equal(result.report.actualCoreMinimumEdge,replay.quality.regions.core.minimumEdge);
});

test('four rings remove short transition edges without modifying core, inner interfaces, dimensions or seeds',()=>{
  const request={...structuredClone(base),parameters:{radius:48,height:16,coreRadius:16,radiusSegments:40,arcSegments:64,axialSegments:32,modelFraction:'quarter',
    rings:[{innerRadius:16.5,outerRadius:17},{innerRadius:18.5,outerRadius:19.5},{innerRadius:22.5,outerRadius:24.5},{innerRadius:30.5,outerRadius:34.5}]},
    criteria:{minimumCornerScaledJacobian:.25,maximumTransitionEdgeAspectRatio:6,minimumTransitionEdgeToCoreRatio:1}};
  const r=planConcentricRingWidths(request);
  assert.deepEqual(r.report.changes.map(c=>c.newWidth),[1.25,2.5,5,12]);
  assert.equal(r.counts.elements,56640);assert.equal(r.plan.expectedCoreElements,49152);
  assert.ok(r.quality.minimumCornerScaledJacobian>.30);assert.ok(r.report.actualTransitionEdgeToCoreRatio>1.3);
  assert.ok(r.report.actualTransitionEdgeAspectRatio<4.000000000001);assert.ok(r.report.actualRegularEdgeToCoreRatio>=1);
});

test('deterministic finite search retains explicit radial policies and never reduces an existing SJ gate',()=>{
  const request=structuredClone(base);request.parameters.minimumCornerScaledJacobian=.21;
  request.parameters.radialSize=.45;request.parameters.rings[0].radialSize=.9;
  const a=planConcentricRingWidths(request),b=planConcentricRingWidths(request);
  assert.deepEqual(a,b);assert.equal(a.resolvedRequest.parameters.radialSize,.45);
  assert.equal(a.resolvedRequest.parameters.rings[0].radialSize,.9);
  assert.equal(a.report.diagnostics.effectiveCriteria.minimumCornerScaledJacobian,.21);
  assert.equal(a.resolvedRequest.parameters.minimumCornerScaledJacobian,.21);
});

test('original widths remain candidates and constrained families are not called globally infeasible',()=>{
  const request=structuredClone(base);request.search={widthScales:[4]};
  const r=planConcentricRingWidths(request);
  assert.ok(r.report.diagnostics.candidates.every(rows=>rows.some(c=>c.source==='original')));
  const impossible=structuredClone(base);impossible.criteria.minimumTransitionEdgeToCoreRatio=100;impossible.criteria.minimumRegularEdgeToCoreRatio=1;
  assert.throws(()=>planConcentricRingWidths(impossible),e=>e instanceof ConcentricWidthPlanningError&&e.code==='no-local-candidate'&&/finite width family/.test(e.message));
});

test('frozen core quality and local screening exhaustion have distinct diagnostic codes',()=>{
  const a=structuredClone(base);a.parameters.minimumCornerScaledJacobian=.95;
  assert.throws(()=>planConcentricRingWidths(a),e=>e.code==='fixed-core-quality'&&e.diagnostics.fullAudits===0);
  const b=structuredClone(base);b.search={maximumLocalEvaluations:1};
  assert.throws(()=>planConcentricRingWidths(b),e=>e.code==='search-budget-exhausted'&&e.diagnostics.localEvaluations===1&&e.diagnostics.fullAudits===0
    &&e.diagnostics.candidates[0].at(-1).status==='not-evaluated');
});

test('fixed narrow collars and candidate-created thin regular annuli are not hidden by a good transition SJ',()=>{
  const a=structuredClone(base);a.parameters.rings[0].innerRadius=4.001;
  assert.throws(()=>planConcentricRingWidths(a),e=>e.code==='fixed-collar-quality'&&e.diagnostics.fullAudits===0);
  const b=structuredClone(base);b.parameters.rings[1].innerRadius=5.751;
  b.parameters.rings[1].outerRadius=7.751;
  const r=planConcentricRingWidths(b);
  const thin=r.report.diagnostics.candidates[0].find(c=>c.width===1.25);
  assert.equal(thin.status,'screened-rejected');assert.ok(thin.reasons.some(s=>s.includes('regular annulus')));
  assert.ok(r.report.actualRegularEdgeToCoreRatio>=1);
});

test('plan-count budgets reject without auditing when narrow acceptable widths exceed the original count cap',()=>{
  const r=structuredClone(base);r.parameters.rings=[{innerRadius:4.5,outerRadius:7},{innerRadius:8.5,outerRadius:12.5}];
  r.parameters.elementLimit=planConcentricCircularMesh(r.parameters).expectedElements;r.search={maximumPlanChecks:1};
  assert.throws(()=>planConcentricRingWidths(r),e=>e instanceof ConcentricWidthPlanningError&&e.code==='search-budget-exhausted'
    &&e.diagnostics.planChecks===1&&e.diagnostics.fullAudits===0&&e.diagnostics.attempts[0].status==='count-rejected');
});

test('bounded combination search skips over-budget choices and validates a later feasible plan',()=>{
  const r=structuredClone(base);r.parameters.radius=15.4;r.parameters.rings[1].outerRadius=11.5;
  r.parameters.elementLimit=planConcentricCircularMesh(r.parameters).expectedElements;
  const result=planConcentricRingWidths(r),d=result.report.diagnostics;
  assert.equal(result.counts.elements,8224);assert.equal(result.resolvedRequest.parameters.elementLimit,8224);
  assert.deepEqual(d.attempts.map(a=>a.status),['count-rejected','count-rejected','accepted']);
  assert.equal(d.fullAudits,1);assert.deepEqual(result.report.changes.map(c=>c.newWidth),[1.25,3]);
});

test('an exhausted finite family is distinguished from an exhausted search budget',()=>{
  const r=structuredClone(base);r.parameters.rings=[{innerRadius:4.5,outerRadius:7},{innerRadius:8.5,outerRadius:12.5}];
  r.parameters.elementLimit=planConcentricCircularMesh(r.parameters).expectedElements;r.search={widthScales:[1.25]};
  assert.throws(()=>planConcentricRingWidths(r),e=>e.code==='no-validated-plan'&&e.diagnostics.fullAudits===0
    &&e.diagnostics.attempts.every(a=>a.status==='count-rejected'));
});

for(const [name,change] of [
  ['null',()=>null],['version',r=>({...r,schemaVersion:2})],['extra envelope',r=>({...r,extra:true})],
  ['missing criteria',r=>({...r,criteria:undefined})],['extra criteria',r=>({...r,criteria:{...r.criteria,optimize:true}})],
  ['zero SJ',r=>({...r,criteria:{...r.criteria,minimumCornerScaledJacobian:0}})],['SJ above1',r=>({...r,criteria:{...r.criteria,minimumCornerScaledJacobian:2}})],
  ['aspect below1',r=>({...r,criteria:{...r.criteria,maximumTransitionEdgeAspectRatio:.5}})],
  ['negative edge ratio',r=>({...r,criteria:{...r.criteria,minimumTransitionEdgeToCoreRatio:-1}})],
  ['zero regular-edge ratio',r=>({...r,criteria:{...r.criteria,minimumRegularEdgeToCoreRatio:0}})],
  ['null search',r=>({...r,search:null})],['unknown search',r=>({...r,search:{optimize:true}})],
  ['empty scales',r=>({...r,search:{widthScales:[]}})],['nonpositive scale',r=>({...r,search:{widthScales:[0]}})],
  ['NaN scale',r=>({...r,search:{widthScales:[NaN]}})],['string scale',r=>({...r,search:{widthScales:['1']}})],
  ['too many scales',r=>({...r,search:{widthScales:Array(17).fill(1)}})],
  ['invalid local limit',r=>({...r,search:{maximumLocalEvaluations:513}})],['zero plan limit',r=>({...r,search:{maximumPlanChecks:0}})],
  ['invalid full limit',r=>({...r,search:{maximumFullAudits:17}})],['unknown native input',r=>({...r,parameters:{...r.parameters,ratio:3}})]
])test(`width planner rejects ${name}`,()=>assert.throws(()=>planConcentricRingWidths(change(structuredClone(base)))));
