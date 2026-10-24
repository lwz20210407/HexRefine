import test from 'node:test';
import assert from 'node:assert/strict';
import {planTransitionBand,planTransitionAngularSeams,generateAnnularTransitionBand,generateAxialTransitionTube,
  defaultTransitionMeshRequest,generateTransitionMeshRequest,suggestTransitionMeshCounts,checkNoHangingNodes} from '../dist/index.js';

test('radial cuts must coincide with complete motifs at every stage, not only interface nodes',()=>{
  const plan=planTransitionBand({fineSegments:64,ratios:[2,2],depth:8});
  const valid=planTransitionAngularSeams(plan,{seamAnglesDegrees:[0,90,180,270,360,-360]});
  assert.equal(valid.compatible,true);assert.equal(valid.seams.length,4);
  assert.equal(valid.geometryChecked,false);assert.equal(valid.existingMeshStitched,false);
  const invalid=planTransitionAngularSeams(plan,{seamAnglesDegrees:[22.5]});
  assert.deepEqual(invalid.conflicts,[{angleDegrees:22.5,stage:2,reason:'inside-template'}]);
  // 22.5 degrees is nevertheless a node on both coarse interfaces.
  assert.ok(plan.counts.every(n=>Number.isInteger(22.5*n/360)));
});

test('existing aligned planes are accepted, even if no new plane is needed',()=>{
  const a=generateAnnularTransitionBand({innerRadius:10,outerRadius:20,fineSegments:16,ratios:[2],seamAnglesDegrees:[0,90,180,270]});
  assert.equal(a.plan.seamAlignment.compatible,true);assert.ok(checkNoHangingNodes(a.mesh,1e-8).ok);
});

test('phase-aware sectors wrap through zero and explicitly reject cuts outside the sector',()=>{
  const p=planTransitionBand({fineSegments:24,ratios:[2,3],depth:4});
  const a=planTransitionAngularSeams(p,{startAngleDegrees:350,sweepAngleDegrees:30,seamAnglesDegrees:[350,365,380]});
  assert.equal(a.compatible,true);assert.deepEqual(a.seams.map(s=>s.offsetDegrees).sort((a,b)=>a-b),[0,15,30]);
  assert.equal(planTransitionAngularSeams(p,{startAngleDegrees:350,sweepAngleDegrees:30,seamAnglesDegrees:[180]}).conflicts[0].reason,'outside-sector');
});

for(const mode of ['annular','axial'])test(`${mode} rejects incompatible seams before generation and suggests a legal unchanged-phase chain`,()=>{
  const request=defaultTransitionMeshRequest(mode);
  Object.assign(request.parameters,{fineSegments:72,ratios:[2,3],seamAnglesDegrees:[0,90,180,270]});
  const before=structuredClone(request);
  assert.throws(()=>generateTransitionMeshRequest(request),/seam.*stage/i);
  const suggestion=suggestTransitionMeshCounts(request);
  assert.deepEqual(request,before);assert.equal(suggestion.request.parameters.fineSegments,48);
  assert.deepEqual(suggestion.request.parameters.ratios,[2,3]);
  assert.deepEqual(suggestion.request.parameters.seamAnglesDegrees,request.parameters.seamAnglesDegrees);
  const result=generateTransitionMeshRequest(suggestion.request);
  assert.equal(result.plan.seamAlignment.compatible,true);
  assert.ok(checkNoHangingNodes(result.mesh,1e-8).ok);
  assert.throws(()=>suggestTransitionMeshCounts({...request,parameters:{...request.parameters,sweepAngleDegrees:90,seamAnglesDegrees:[180]}}),/outside/);
});

test('declared cuts contain actual shared radial faces in the complete 3D tube',()=>{
  const result=generateAxialTransitionTube({innerRadius:10,outerRadius:12,length:6,radialLayers:2,
    fineSegments:144,ratios:[2,3],seamAnglesDegrees:[0,90,180,270]});
  const faces=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[1,2,6,5],[0,4,7,3]],owners=new Map();
  for(const cell of result.mesh.elements)for(const face of faces){
    const ids=face.map(i=>cell[i]),key=[...ids].sort((a,b)=>a-b).join(':');
    const entry=owners.get(key)??{ids,count:0};entry.count++;owners.set(key,entry);
  }
  for(const [axis,sign] of [[0,1],[0,-1],[1,1],[1,-1]]){
    const on=[...owners.values()].filter(({ids})=>ids.every(id=>Math.abs(result.mesh.nodes[id-1][1-axis])<1e-10&&result.mesh.nodes[id-1][axis]*sign>0));
    assert.equal(on.length,4);assert.ok(on.every(f=>f.count===2));
  }
});

test('seam validation rejects malformed inputs and preserves no-seam legacy results',()=>{
  const p=planTransitionBand({fineSegments:16,ratios:[2],depth:1});
  for(const seamAnglesDegrees of [null,[NaN],[Infinity],['90'],Array(4097).fill(0)])
    assert.throws(()=>planTransitionAngularSeams(p,{seamAnglesDegrees}));
  for(const bad of [{counts:[16,7],ratios:[2]},{counts:[16],ratios:[2]},{counts:[true,1],ratios:[2]}])
    assert.throws(()=>planTransitionAngularSeams(bad,{}));
  const spec={innerRadius:10,outerRadius:20,fineSegments:64,ratios:[2,2]};
  const a=generateAnnularTransitionBand(spec),b=generateAnnularTransitionBand({...spec,seamAnglesDegrees:[]});
  assert.deepEqual(a.mesh,b.mesh);assert.deepEqual(a.plan,b.plan);
});
