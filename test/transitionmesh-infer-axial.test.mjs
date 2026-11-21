import test from 'node:test';
import assert from 'node:assert/strict';
import {inferAndPatchAxialTube} from '../dist/transitionmesh-infer-axial.js';
import {generateTransitionMeshV11Request} from '../dist/transitionmesh-v11-request.js';
import {createHexUnitCubeMesh} from '../dist/grid.js';
import {meshToLsdynaKeyword} from '../dist/export.js';

function fixture(axis,ratios,n) {
  return generateTransitionMeshV11Request({
    schemaVersion:1,kind:'transitionmesh-v11',mode:'AXIAL_SURFACE',
    parameters:{innerRadius:2,outerRadius:4,length:4,radialLayers:2,
      fineSegments:n,ratios,stageDepths:[1,3],axis,origin:[1,2,3]},
    regularRegions:{fine:{width:1,layers:1},coarse:{width:2,layers:1}},
  });
}

test('infer two 2:1 stages from K only and preserve regular ends',()=>{
  const original=fixture([0,0,1],[2,2],32);
  const result=inferAndPatchAxialTube(original.files['mesh.k']);
  assert.deepEqual(result.inference.counts,[32,16,8]);
  assert.deepEqual(result.inference.axialLevels,[3,4,7]);
  assert.deepEqual(result.inference.axis,[0,0,1]);
  assert.equal(result.report.selectionMode,'inferred-axial');
  assert.equal(result.report.preservedElements,80);
  assert.equal(result.report.sharedFaces,80);
  assert.equal(result.report.newNodes,0);
  assert.ok(result.report.minimumGaussDeterminant>0);
});

test('infer reverse direction and 3:1 chain along a different global axis',()=>{
  const original=fixture([0,-1,0],[3,3],54);
  const result=inferAndPatchAxialTube(original.files['mesh.k']);
  assert.deepEqual(result.inference.counts,[54,18,6]);
  assert.deepEqual(result.inference.axis.map(n=>n||0),[0,-1,0]);
  assert.deepEqual(result.inference.axialLevels,[2,1,-2]);
  assert.ok(result.report.relativeVolumeError<1e-12);
  assert.ok(result.inference.maxBoundaryCorrection<=result.inference.coordinateTolerance);
});

test('reject solid core, edited barrel boundary and locked solid sets',()=>{
  const solid=meshToLsdynaKeyword(createHexUnitCubeMesh(3,3,6),{coordinateFormat:'compact'});
  assert.throws(()=>inferAndPatchAxialTube(solid),/cap has 1 boundary loops/);
  const original=fixture([0,0,1],[2,2],32);
  const bad=structuredClone(original.mesh);
  const ch=bad.nodes.findIndex(([x,y,z])=>Math.abs(Math.hypot(x-1,y-2)-4)<1e-8 && z>3.01 && z<3.99);
  assert.ok(ch>=0);
  bad.nodes[ch][0]+=.001;
  assert.throws(()=>inferAndPatchAxialTube(meshToLsdynaKeyword(bad,{coordinateFormat:'compact'})),/inferred axial band rejected/);
  assert.throws(()=>inferAndPatchAxialTube(original.files['mesh.k'].replace('*END','*SET_SOLID_LIST\n31,0,0,0,0\n1\n*END')),/solid set/);
});

test('do not invent a transition region in a uniform hollow tube',()=>{
  const n=12, nodes=[], elements=[];
  for(let z=0;z<=3;z++)for(const r of [2,3])for(let k=0;k<n;k++){
    const angle=2*Math.PI*k/n;nodes.push([r*Math.cos(angle),r*Math.sin(angle),z]);
  }
  for(let z=0;z<3;z++)for(let k=0;k<n;k++){
    const j=(k+1)%n;
    const q=[k,n+k,n+j,j].map(i=>1+2*n*z+i);
    elements.push([...q,...q.map(i=>i+2*n)]);
  }
  assert.throws(()=>inferAndPatchAxialTube(meshToLsdynaKeyword({kind:'H1',nodes,elements},
    {coordinateFormat:'compact'})),/end ring counts are equal/);
});
