import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultTransitionMeshRequest,generateTransitionMeshRequest,suggestTransitionMeshCounts,transitionMeshModes,parseMeshText} from '../dist/index.js';

for(const [mode] of transitionMeshModes)test(`shared ${mode} request generates readable K/INP and replays its archive request`,()=>{
  const request=defaultTransitionMeshRequest(mode),before=structuredClone(request),r=generateTransitionMeshRequest(request);
  assert.deepEqual(request,before);assert.equal(r.request.kind,'transition-mesh');
  assert.ok(r.summary.nodes>0);assert.equal(r.summary.beams,0);
  const k=parseMeshText(r.files['mesh.k'],'mesh.k'),inp=parseMeshText(r.files['mesh.inp'],'mesh.inp');
  assert.deepEqual(k.elements,inp.elements);assert.deepEqual(k.elements,r.mesh.elements);
  const replay=generateTransitionMeshRequest(JSON.parse(r.files['request.json']));assert.deepEqual(replay.mesh,r.mesh);
  assert.equal(JSON.parse(r.files['lineage.json']).stageIds.length,r.mesh.elements.length);
});

test('explicit suggestions repair template counts while preserving geometry and block sequence',()=>{
  const planar=defaultTransitionMeshRequest('planar');planar.parameters.fineSegments=23;planar.parameters.ratios=[2];
  const before=structuredClone(planar),a=suggestTransitionMeshCounts(planar);assert.equal(a.request.parameters.fineSegments,24);assert.deepEqual(planar,before);
  assert.equal(a.request.parameters.length,planar.parameters.length);assert.equal(a.geometryChecked,false);
  const hybrid=defaultTransitionMeshRequest('hybrid');hybrid.parameters.coarseSegments=5;
  assert.equal(suggestTransitionMeshCounts(hybrid).request.parameters.coarseSegments,6);
  hybrid.parameters.blocks=['single3','pair2','single3'];
  const b=suggestTransitionMeshCounts(hybrid);assert.deepEqual(b.request.parameters.blocks,hybrid.parameters.blocks);
  assert.equal(b.request.parameters.fineSegments,10);assert.equal(b.request.parameters.coarseSegments,4);
  assert.ok(generateTransitionMeshRequest(b.request).mesh.elements.length>0);
  const rect=defaultTransitionMeshRequest('rectangular-rings');rect.parameters.fineSegments=[10,7];
  assert.deepEqual(suggestTransitionMeshCounts(rect).request.parameters.fineSegments,[8,8]);
  planar.parameters.fineSegments='23';assert.throws(()=>suggestTransitionMeshCounts(planar),/integers/);
});

test('solid conversion, core sets and unsupported request fields are explicit',()=>{
  const request=defaultTransitionMeshRequest('rectangular-rings');request.extrusion={height:2,layers:2};
  const r=generateTransitionMeshRequest(request);assert.equal(r.mesh.kind,'H1');
  assert.match(r.files['mesh.inp'],/Elset, elset=core/i);
  const axial=defaultTransitionMeshRequest('axial');
  assert.throws(()=>generateTransitionMeshRequest({...axial,extrusion:{height:1,layers:1}}),/already/);
  assert.throws(()=>generateTransitionMeshRequest({...axial,unknown:true}),/Expected/);
  const a=defaultTransitionMeshRequest('planar');a.parameters.ratios[0]=3;
  assert.deepEqual(defaultTransitionMeshRequest('planar').parameters.ratios,[2,2]);
});
