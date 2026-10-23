import test from 'node:test';
import assert from 'node:assert/strict';
import {gui61Kinds,defaultGui61Request,gui61Fields,gui61Value,updateGui61Value,generateGui61,
  resizeGui61ConcentricRings,planGui61Concentric,gui61ConcentricStreamRequest,GUI_CONCENTRIC_ELEMENT_LIMIT,
  parseGui61ParameterFile,createGui61ParameterArchive,verifyGui61ParameterReplay,parseMeshText} from '../dist/index.js';
const kind='concentric-circular-solid';
const large={radius:200,height:600,coreRadius:24,radiusSegments:48,arcSegments:80,axialSegments:1200,modelFraction:'quarter',
  minimumCornerScaledJacobian:.2,rings:[{innerRadius:24.5,outerRadius:25.5},{innerRadius:32.5,outerRadius:34.5},{innerRadius:64.5,outerRadius:72.5}]};

test('concentric GUI is an explicit native extension, with seeds and rings rather than fake ratio/tilt switches',()=>{
  assert.match(gui61Kinds.find(([k])=>k===kind)[1],/原生2:1/);
  const r=defaultGui61Request(kind),fields=gui61Fields(r).map(f=>f.path);
  assert.ok(fields.includes('rings.1.innerRadius')&&fields.includes('axialSegments'));
  for(const path of ['angleDegrees','thicknessTransition','transitionStages','reductions.z'])assert.ok(!fields.includes(path));
  assert.deepEqual(planGui61Concentric(r).angularCountsPerQuarter,[32,16,8]);
});

test('ring append/remove is immutable, preserves requested geometry/counts and exposes every new structured field',()=>{
  const a=defaultGui61Request(kind),before=structuredClone(a),b=resizeGui61ConcentricRings(a,1);
  assert.deepEqual(a,before);assert.equal(b.parameters.rings.length,3);
  assert.deepEqual(b.parameters.rings[2],{innerRadius:10.5,outerRadius:14.5,radialSize:4});
  for(const key of ['radius','height','coreRadius','radiusSegments','arcSegments','axialSegments'])assert.equal(b.parameters[key],a.parameters[key]);
  assert.ok(gui61Fields(b).some(f=>f.path==='rings.2.outerRadius'));
  const c=updateGui61Value(b,'rings.2.outerRadius',15);assert.equal(c.parameters.rings[2].outerRadius,15);
  assert.equal(b.parameters.rings[2].outerRadius,14.5);assert.deepEqual(resizeGui61ConcentricRings(c,-1),a);
  assert.throws(()=>updateGui61Value(a,'rings.9.outerRadius',99),/unknown/);
});

test('ring-count bounds and unrelated requests are refused without modifying drafts',()=>{
  let r=defaultGui61Request(kind);r=resizeGui61ConcentricRings(r,-1);assert.throws(()=>resizeGui61ConcentricRings(r,-1));
  for(let i=1;i<8;i++)r=resizeGui61ConcentricRings(r,1);
  assert.throws(()=>resizeGui61ConcentricRings(r,1));assert.throws(()=>resizeGui61ConcentricRings(r,0));
  assert.throws(()=>resizeGui61ConcentricRings(defaultGui61Request('circular-solid'),1));
  assert.throws(()=>planGui61Concentric({...r,extra:true}));
});

test('CLI schema imports retain exact parameters and optional fields do not inject demonstration defaults',()=>{
  const p=structuredClone(large),imported=parseGui61ParameterFile({schemaVersion:1,parameters:p});
  assert.equal(imported.request.kind,kind);assert.deepEqual(imported.request.parameters,p);
  assert.deepEqual(gui61ConcentricStreamRequest(imported.request),{schemaVersion:1,parameters:p});
  const small=defaultGui61Request(kind);
  for(const path of ['innerCornerFraction','radialSize','minimumCornerScaledJacobian','elementLimit','motifElementLimit']){
    const next=updateGui61Value(small,path,undefined);assert.ok(!Object.hasOwn(next.parameters,path));
    assert.deepEqual(parseGui61ParameterFile(next).request,next);
  }
  const r=updateGui61Value(small,'rings.0.radialSize',undefined);
  assert.ok(!Object.hasOwn(r.parameters.rings[0],'radialSize'));assert.equal(gui61Value(r,'rings.0.radialSize'),undefined);
  assert.deepEqual(parseGui61ParameterFile(r).request,r);
});

test('oversized GUI requests remain plannable/exportable for CLI but cannot materialize a substitute preview',()=>{
  const request={schemaVersion:1,kind,parameters:structuredClone(large)},before=structuredClone(request);
  assert.equal(planGui61Concentric(request).expectedElements,3310500);assert.equal(GUI_CONCENTRIC_ELEMENT_LIMIT,200000);
  assert.throws(()=>generateGui61(request),/3310500.*200000/);assert.deepEqual(request,before);
  assert.deepEqual(gui61ConcentricStreamRequest(request),{schemaVersion:1,parameters:large});
});

test('native request/CLI import rejects malformed rings, unknown envelope fields and non-finite controls',()=>{
  for(const rings of [null,[],{},Array(9).fill({innerRadius:5,outerRadius:6}),[null]]){
    const request=defaultGui61Request(kind);request.parameters.rings=rings;assert.throws(()=>parseGui61ParameterFile(request));
  }
  const request=defaultGui61Request(kind);request.parameters.arcSegments='32';assert.throws(()=>parseGui61ParameterFile(request));
  assert.throws(()=>parseGui61ParameterFile({schemaVersion:1,parameters:large,extra:true}));
  assert.throws(()=>gui61ConcentricStreamRequest({schemaVersion:1,kind,parameters:{...large,ratio:3}}));
});

test('concentric GUI K is the complete model and archives replay its original request exactly',()=>{
  const request=defaultGui61Request(kind),r=generateGui61(request),back=parseMeshText(r.files['mesh.k'],'generated.k');
  assert.equal(r.summary.solids,8256);assert.deepEqual(back.elements,r.mesh.elements);
  assert.equal(r.summary.nodes,9284);assert.equal(r.model,undefined);
  assert.equal(r.plan.height,8);assert.equal(r.plan.expectedCoreElements,6144);
  assert.deepEqual(JSON.parse(r.files['concentric-stream-request.json']),{schemaVersion:1,parameters:request.parameters});
  const imported=parseGui61ParameterFile(createGui61ParameterArchive(r,false)),replay=generateGui61(imported.request);
  assert.equal(imported.exportK,false);verifyGui61ParameterReplay(imported,replay);assert.equal(replay.files['mesh.k'],r.files['mesh.k']);
});

test('requested SJ gates and incompatible rings are not silently repaired by GUI dispatch',()=>{
  const r=defaultGui61Request(kind);r.parameters.minimumCornerScaledJacobian=.3;
  assert.throws(()=>generateGui61(r),/violates requested/);
  r.parameters.minimumCornerScaledJacobian=.2;r.parameters.rings[1].innerRadius=5;
  assert.throws(()=>generateGui61(r),/nonoverlapping/);
});
