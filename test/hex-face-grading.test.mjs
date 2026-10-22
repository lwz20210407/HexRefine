import test from 'node:test';
import assert from 'node:assert/strict';
import {auditHexFaceGrading} from '../dist/index.js';
import {properCubeRotations} from '../dist/two-to-one-templates.js';

function slabs(planes=[0,1,3]){
  const nodes=planes.flatMap(x=>[[x,0,0],[x,1,0],[x,0,1],[x,1,1]]);
  const elements=planes.slice(1).map((_,i)=>[1+4*i,5+4*i,6+4*i,2+4*i,3+4*i,7+4*i,8+4*i,4+4*i]);
  return {kind:'H1',nodes,elements};
}

test('face-local normal size ratio is exact for orthogonal adjacent bricks',()=>{
  const mesh=slabs(),copy=structuredClone(mesh),r=auditHexFaceGrading(mesh,{maximumNormalSizeRatio:2});
  assert.deepEqual(mesh,copy);
  assert.equal(r.interiorFacePairs,1);assert.equal(r.boundaryFaces,10);assert.equal(r.reviewedFacePairs,1);
  assert.equal(r.maximumNormalSizeRatio,2);assert.equal(r.maximumNonOrthogonalityDegrees,0);
  assert.equal(r.aboveRequestedLimitPairs,0);assert.equal(r.requestedLimitVerified,true);
  assert.equal(r.engineeringAcceptanceVerified,false);
  const w=r.worstNormalSizePairs[0];assert.deepEqual(w.elementIds,[1,2]);assert.deepEqual(w.localFaceIds,[5,6]);
  assert.deepEqual([...w.faceNodeIds].sort((a,b)=>a-b),[5,6,7,8]);
  const strict=auditHexFaceGrading(mesh,{maximumNormalSizeRatio:1.9});
  assert.equal(strict.aboveRequestedLimitPairs,1);assert.equal(strict.requestedLimitVerified,false);
});

test('centroid-line nonorthogonality is independent of the normal size ratio',()=>{
  const mesh=slabs([0,1,2]);mesh.nodes.forEach(p=>{if(p[0]===2)p[1]+=1;});
  const r=auditHexFaceGrading(mesh);
  assert.equal(r.maximumNormalSizeRatio,1);
  assert.ok(Math.abs(r.maximumNonOrthogonalityDegrees-Math.atan(.5)*180/Math.PI)<1e-12);
  assert.equal(r.requestedLimitVerified,null);assert.equal(r.aboveRequestedLimitPairs,null);
});

test('all48 cube frames and extreme finite scales preserve face-local measurements',()=>{
  for(const matrix of properCubeRotations())for(const reflect of [false,true]){
    const mesh=slabs();mesh.nodes=mesh.nodes.map(p=>matrix.map(row=>row.reduce((sum,v,i)=>sum+v*p[i],0)));
    if(reflect){mesh.nodes.forEach(p=>p[0]*=-1);mesh.elements=mesh.elements.map(e=>[0,3,2,1,4,7,6,5].map(i=>e[i]));}
    const r=auditHexFaceGrading(mesh);assert.equal(r.maximumNormalSizeRatio,2);assert.equal(r.maximumNonOrthogonalityDegrees,0);
  }
  for(const scale of [1e-200,1e-120,1,1e120,1e200]){
    const mesh=slabs();mesh.nodes=mesh.nodes.map(p=>p.map(v=>(v+4)*scale));
    const r=auditHexFaceGrading(mesh);assert.ok(Math.abs(r.maximumNormalSizeRatio-2)<1e-12);assert.equal(r.undefinedMetricPairs,0);
  }
});

test('pair filtering and witness budgets are explicit and never hide nonmanifold topology',()=>{
  const mesh=slabs([0,1,3,7]);
  const selected=auditHexFaceGrading(mesh,{reviewElementIds:[1,1],maximumWitnesses:1});
  assert.equal(selected.interiorFacePairs,2);assert.equal(selected.reviewedFacePairs,1);assert.equal(selected.boundaryFaces,14);
  assert.equal(selected.worstNormalSizePairs.length,1);assert.deepEqual(selected.worstNormalSizePairs[0].elementIds,[1,2]);
  const disabled=auditHexFaceGrading(mesh,{maximumWitnesses:0});assert.equal(disabled.reviewedFacePairs,2);assert.deepEqual(disabled.worstNormalSizePairs,[]);
  const empty=auditHexFaceGrading(mesh,{reviewElementIds:[],maximumNormalSizeRatio:2});
  assert.equal(empty.reviewedFacePairs,0);assert.equal(empty.maximumNormalSizeRatio,null);assert.equal(empty.requestedLimitVerified,false);
  const malformed=slabs();malformed.elements.push(malformed.elements[0]);
  assert.throws(()=>auditHexFaceGrading(malformed,{reviewElementIds:[]}),/nonmanifold/);
});

test('warped shared quads use the same physical face and do not claim a thickness proof',()=>{
  const mesh=slabs();mesh.nodes[7][0]+=.1;
  const r=auditHexFaceGrading(mesh);assert.equal(r.reviewedFacePairs,1);assert.equal(r.undefinedMetricPairs,0);
  assert.ok(Number.isFinite(r.maximumNormalSizeRatio));assert.equal(r.engineeringAcceptanceVerified,false);
  assert.match(r.limitation,/warped\/concave/);
});

test('undefined metrics and same-side centroids cannot certify a requested limit',()=>{
  const collapsed=slabs([0,1,1]),r=auditHexFaceGrading(collapsed,{maximumNormalSizeRatio:2});
  assert.equal(r.undefinedMetricPairs,1);assert.equal(r.maximumNormalSizeRatio,null);assert.equal(r.requestedLimitVerified,false);
  assert.match(r.undefinedWitnesses[0].reason,/centroid standoff/);
  const same=auditHexFaceGrading(slabs([0,1,0]),{maximumNormalSizeRatio:2});
  assert.equal(same.centroidsOnSameSidePairs,1);assert.equal(same.requestedLimitVerified,false);
  const overlapping=auditHexFaceGrading(slabs([0,1,-1]),{maximumNormalSizeRatio:2});
  assert.equal(overlapping.centroidsOnSameSidePairs,1);assert.equal(overlapping.undefinedMetricPairs,0);assert.equal(overlapping.requestedLimitVerified,false);
  const flat=slabs([0,1,3,7]);flat.nodes.forEach(p=>p[1]=0);
  const area=auditHexFaceGrading(flat,{maximumNormalSizeRatio:2,maximumWitnesses:1});
  assert.equal(area.undefinedMetricPairs,2);assert.equal(area.undefinedWitnesses.length,1);assert.match(area.undefinedWitnesses[0].reason,/face area vector/);
  assert.equal(area.maximumNormalSizeRatio,null);assert.equal(area.requestedLimitVerified,false);
  assert.doesNotThrow(()=>JSON.parse(JSON.stringify(r)));
});

test('face cycle mismatch and malformed input are rejected instead of paired by node set alone',()=>{
  const mesh=slabs();[mesh.elements[1][4],mesh.elements[1][7]]=[mesh.elements[1][7],mesh.elements[1][4]];
  assert.throws(()=>auditHexFaceGrading(mesh),/incompatible shared-face cycles/);
  assert.throws(()=>auditHexFaceGrading(slabs(),{reviewElementIds:[3]}),/reviewElementIds/);
  assert.throws(()=>auditHexFaceGrading(slabs(),{maximumNormalSizeRatio:.5}),/maximumNormalSizeRatio/);
  assert.throws(()=>auditHexFaceGrading(slabs(),{maximumWitnesses:33}),/maximumWitnesses/);
  assert.throws(()=>auditHexFaceGrading(slabs(),{unexpected:true}),/unknown/);
  assert.throws(()=>auditHexFaceGrading({kind:'Q1',nodes:[],elements:[]}),/H8/);
  const bad=slabs();bad.nodes[0][0]=NaN;assert.throws(()=>auditHexFaceGrading(bad),/finite3D/);
  const empty=auditHexFaceGrading({kind:'H1',nodes:[],elements:[]});assert.equal(empty.boundaryFaces,0);assert.equal(empty.maximumNormalSizeRatio,null);
});
