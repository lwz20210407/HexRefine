import test from 'node:test';
import assert from 'node:assert/strict';
import {generateTransitionMeshRequest,parseMeshText,checkNoHangingNodes} from '../dist/index.js';

function request(mode,ratio=2,reverse=false){
 const parameters={fineSegments:ratio===2?64:72,ratios:[ratio,ratio]};
 if(mode==='planar')Object.assign(parameters,{length:24,depth:6,fineSide:reverse?'top':'bottom',rotationDegrees:30,origin:[3,-4]});
 else Object.assign(parameters,{innerRadius:10,outerRadius:22,seamAnglesDegrees:[15,105,195,285],startAngleDegrees:15});
 if(mode==='annular')parameters.fineSide=reverse?'outer':'inner';
 if(mode==='axial')Object.assign(parameters,{length:12,radialLayers:2,fineEnd:reverse?'end':'start',axis:[1,2,3],origin:[3,-4,5]});
 return {schemaVersion:1,kind:'transition-mesh',mode,parameters,...(mode!=='axial'?{extrusion:{height:3,layers:2}}:{})};
}

for(const mode of ['planar','annular','axial'])for(const ratio of [2,3])for(const reverse of [false,true])
 test(`solid ${mode} ${ratio}:1 reversed=${reverse} attaches regular cells without touching the transition`,()=>{
  const input=request(mode,ratio,reverse),base=generateTransitionMeshRequest(input),before=structuredClone(input);
  const result=generateTransitionMeshRequest({...input,regularRegions:{fine:{width:2,layers:2},coarse:{width:3,layers:1}}});
  assert.deepEqual(input,before);
  assert.deepEqual(result.mesh.nodes.slice(0,base.mesh.nodes.length),base.mesh.nodes);
  assert.deepEqual(result.mesh.elements.slice(0,base.mesh.elements.length),base.mesh.elements);
  assert.equal(result.plan.transitionNodesPreserved,base.mesh.nodes.length);
  assert.equal(result.plan.transitionElementsPreserved,base.mesh.elements.length);
  assert.equal(result.plan.existingModelReplacement,false);
  assert.ok(result.quality.minimumCornerScaledJacobian>0&&result.quality.minimumGaussDeterminant>0);
  assert.ok(result.quality.relativeVolumeError<1e-12);assert.ok(checkNoHangingNodes(result.mesh,1e-8).ok);
  const sets=JSON.parse(result.files['sets.json']);
  assert.ok(sets.cellSets['fine-regular'].length>0&&sets.cellSets['coarse-regular'].length>0);
  assert.equal(sets.cellSets.core,undefined);
  assert.equal(Object.values(sets.cellSets).flat().length,result.mesh.elements.length);
  assert.deepEqual(parseMeshText(result.files['mesh.k'],'solid.k').elements,result.mesh.elements);
  const lineage=JSON.parse(result.files['lineage.json']);
  assert.equal(lineage.elementRegions.length,result.mesh.elements.length);
  assert.ok(lineage.elementRegions.slice(base.mesh.elements.length).every(r=>r==='fine-regular'||r==='coarse-regular'));
 });

test('plate regular regions preserve exact physical volume and separate interfaces from exterior ends',()=>{
 const input=request('planar');input.parameters.rotationDegrees=0;input.parameters.origin=[0,0];
 const result=generateTransitionMeshRequest({...input,regularRegions:{fine:{width:2,layers:2},coarse:{width:4,layers:2}}});
 assert.ok(Math.abs(result.quality.volume-24*12*3)<1e-10);
 const sets=JSON.parse(result.files['sets.json']).nodeSets;
 for(const id of sets.fine_interface)assert.equal(result.mesh.nodes[id-1][1],0);
 for(const id of sets.fine_external)assert.equal(result.mesh.nodes[id-1][1],-2);
 for(const id of sets.coarse_external)assert.equal(result.mesh.nodes[id-1][1],10);
});

test('solid regular regions fail closed on invalid, excessive, axis-crossing or 2D input',()=>{
 const input=request('annular');
 for(const regularRegions of [{},{foo:{width:1,layers:1}},{fine:{width:0,layers:1}},{fine:{width:1,layers:1.2}},
  {fine:{width:1,layers:true}},{fine:{width:1,layers:1001}},{fine:{width:10,layers:1}},{fine:null}])
  assert.throws(()=>generateTransitionMeshRequest({...input,regularRegions}));
 const twoD=request('planar');delete twoD.extrusion;
 assert.throws(()=>generateTransitionMeshRequest({...twoD,regularRegions:{fine:{width:1,layers:1}}}),/solid/);
 assert.throws(()=>generateTransitionMeshRequest({...input,mode:'rectangular-rings',regularRegions:{fine:{width:1,layers:1}}}),/only/);
});
