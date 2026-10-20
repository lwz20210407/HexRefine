import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {checkNoHangingNodes,meshToLsdynaKeyword,parseMeshText,refineExtrudedOgrid} from '../dist/index.js';
import {extractExtrudedSection,planSectionParity} from '../dist/ogrid-section.js';
import * as publicApi from '../dist/index.js';

function cylinder(n=4,layers=12,axis=2,scale=1,shift=0,ny=n) {
  const nodes=[],elements=[],axes=axis===0?[1,2]:axis===1?[2,0]:[0,1];
  const id=(i,j,k)=>k*(n+1)*(ny+1)+j*(n+1)+i+1;
  for(let k=0;k<=layers;k++)for(let j=0;j<=ny;j++)for(let i=0;i<=n;i++) {
    let x=2*i/n-1,y=2*j/ny-1;
    if(i===0||i===n||j===0||j===ny){const r=Math.hypot(x,y);x/=r;y/=r;}
    const p=[0,0,0];p[axes[0]]=shift+x*scale;p[axes[1]]=shift+y*scale;p[axis]=k*scale;nodes.push(p);
  }
  for(let k=0;k<layers;k++)for(let j=0;j<ny;j++)for(let i=0;i<n;i++)elements.push([
    id(i,j,k),id(i+1,j,k),id(i+1,j+1,k),id(i,j+1,k),
    id(i,j,k+1),id(i+1,j,k+1),id(i+1,j+1,k+1),id(i,j+1,k+1)
  ]);
  return {kind:'H1',nodes,elements};
}

function verifyFullFinestCore(result) {
  const counts=new Map();result.completedParentIds.forEach((p,i)=>{const c=counts.get(p)??[];c.push(i);counts.set(p,c);});
  const target=Math.max(...result.report.requestedLayerTargets);
  const section=extractExtrudedSection(result.completedMesh,2);
  let checked=0;
  for(const row of section.parentIds)row.forEach((parent,k)=>{
    if(result.report.requestedLayerTargets[k]!==target)return;
    const children=counts.get(parent);assert.equal(children.length,8**target);
    assert.ok(children.every(i=>result.uniformCells[i]&&result.levels[i]===target));checked++;
  });
  assert.equal(checked,section.quads.length*result.report.requestedLayerTargets.filter(l=>l===target).length);
  assert.ok(result.report.coarseFarFieldParents>0);
  assert.equal(checkNoHangingNodes(result.mesh,1e-8).ok,true);
  assert.ok(result.report.quality.refinementRelativeVolumeError<1e-8);
}

test('full circular section: exact 1->8 core, unchanged far ends and K roundtrip',()=>{
  const source=cylinder(),copy=structuredClone(source);
  const result=refineExtrudedOgrid(source,{axis:2,bands:[{min:4,max:8,level:1}],completion:'none'});
  verifyFullFinestCore(result);assert.deepEqual(source,copy);
  assert.deepEqual(result.mesh.nodes.slice(0,source.nodes.length),source.nodes);
  assert.equal(result.report.requestedOriginalParentIds.length,64);
  result.completedParentIds.forEach((p,i)=>{if(result.levels[i]===0)assert.deepEqual(result.mesh.elements[i],source.elements[p-1]);});
  const reread=parseMeshText(meshToLsdynaKeyword(result.mesh),'roundtrip.k');
  assert.equal(reread.elements.length,result.mesh.elements.length);
  assert.deepEqual(reread.elements,result.mesh.elements);
});

test('weak full-band level-2 request gets bounded explicit support, never partial ROI',()=>{
  const source=cylinder();
  const result=refineExtrudedOgrid(source,{axis:2,bands:[{min:5,max:7,level:2}],completion:'none'});
  verifyFullFinestCore(result);
  assert.deepEqual(result.report.promotedSourceLayerIndices,[4,7]);
  assert.equal(result.report.requestedOriginalParentIds.length,32);
  assert.throws(()=>refineExtrudedOgrid(source,{axis:2,bands:[{min:5,max:7,level:2}],completion:'none',maxPromotedSourceLayers:0}),/maxPromotedSourceLayers/);
  assert.throws(()=>refineExtrudedOgrid(source,{axis:2,bands:[{min:5,max:7,level:2}],completion:'none',maxOutputElements:200}),/maxOutputElements/);
});

test('odd section requires explicit bounded completion and redistributes rather than exporting a sliver',()=>{
  const source=cylinder(3,12,2,1,0,4),section=extractExtrudedSection(source,2),plan=planSectionParity(section.quads);
  assert.ok(plan.oddOpenChords>0);assert.ok(plan.cutEdges.length>0);
  const request={axis:2,bands:[{min:4,max:8,level:1}],completion:'circular-sheet'};
  assert.throws(()=>refineExtrudedOgrid(source,{...request,completion:'none'}),/explicit circular-sheet/);
  assert.throws(()=>refineExtrudedOgrid(source,{...request,maxAddedSectionColumns:0}),/maxAddedSectionColumns/);
  const result=refineExtrudedOgrid(source,request);verifyFullFinestCore(result);
  assert.ok(result.report.completion.edgeFraction>=.1);
  assert.ok(result.report.completion.circleFitResidual<1e-9);
  assert.ok(Number.isFinite(result.report.quality.completionRelativeVolumeChange));
  assert.ok(result.report.completion.addedSectionColumns>0);
  const taper=structuredClone(source);taper.nodes.forEach(p=>{p[0]*=1+p[2]*.001;});
  assert.throws(()=>refineExtrudedOgrid(taper,request),/constant straight section/);
});

test('axis permutations preserve complete ROI and input contracts reject interior symmetry cuts',()=>{
  for(const axis of [0,1,2]) {
    const result=refineExtrudedOgrid(cylinder(4,12,axis),{axis,bands:[{min:4,max:8,level:1}],completion:'none'});
    assert.ok(result.report.quality.minimumCornerSJ>0);
    assert.equal(result.report.requestedOriginalParentIds.length,64);
  }
  assert.throws(()=>refineExtrudedOgrid(cylinder(),{axis:2,bands:[{min:4,max:8,level:1}],completion:'none',symmetryPlanes:[{axis:0,coordinate:0}]}),/exterior coordinate plane/);
});

test('quarter O-grid symmetry cuts are not part of the curved-boundary phase ring',()=>{
  const {points,quads}=JSON.parse(readFileSync(new URL('./fixtures/lsdyna/quarter-compression-section.json',import.meta.url),'utf8'));
  const nodes=[],elements=[],layers=8;
  for(let k=0;k<=layers;k++)for(const [x,y] of points)nodes.push([x,y,k*.025]);
  for(let k=0;k<layers;k++)for(const q of quads)elements.push([...q.map(v=>v+1+k*points.length),...q.map(v=>v+1+(k+1)*points.length)]);
  const mesh={kind:'H1',nodes,elements},options={axis:2,bands:[{min:.05,max:.15,level:1}],completion:'none'};
  assert.throws(()=>refineExtrudedOgrid(mesh,options),/no level-closed/);
  const result=refineExtrudedOgrid(mesh,{...options,symmetryPlanes:[{axis:0,coordinate:0},{axis:1,coordinate:0}]});
  verifyFullFinestCore(result);
  assert.equal(result.report.requestedOriginalParentIds.length,4*quads.length);
  assert.equal(result.report.completion,null);
  assert.deepEqual(result.mesh.nodes.slice(0,nodes.length),nodes);
});

test('parent selection coverage is not an original physical-domain certificate',()=>{
  const result=refineExtrudedOgrid(cylinder(2,8),{axis:2,bands:[{min:2.75,max:5.25,level:1}],completion:'none'});
  assert.equal(result.report.fullSelectedOriginalParentsCovered,true);
  assert.equal(result.report.originalPhysicalRoiCoverageVerified,false);
  assert.equal('fullOriginalRoiCovered' in result.report,false);
  assert.deepEqual(result.report.selectedLayerIntervals,[{min:3,max:4,level:1},{min:4,max:5,level:1}]);
  assert.ok(result.report.stages[0].changedSourceLayerIndices.includes(2));
  assert.ok(result.report.targetLevelSemantics.includes('minimum'));
  assert.equal('applyClassifiedRefinementPlan' in publicApi,false);
  assert.equal('applyClassifiedRefinementPlan' in publicApi.refinementOps,false);
});

test('exact transition count refuses a core-only budget before assembly',()=>{
  assert.throws(()=>refineExtrudedOgrid(cylinder(2,8),{axis:2,bands:[{min:3,max:5,level:1}],completion:'none',maxOutputElements:100}),/before assembly/);
});

test('complete31-Hex direct shells bridge a full level2 band without whole-parent promotions',()=>{
  const source=cylinder(2,8),result=refineExtrudedOgrid(source,{axis:2,bands:[{min:3,max:5,level:2}],completion:'none',transitionGeometry:'conservative-face-flux',balanceMode:'direct-macro',maxPromotedSourceLayers:0});
  verifyFullFinestCore(result);
  assert.deepEqual(result.report.promotedSourceLayerIndices,[]);
  assert.deepEqual(result.report.requestedLayerTargets,result.report.effectiveLayerTargets);
  assert.equal(result.report.macroFinalization.childrenPerShellParent,31);
  assert.equal(result.report.macroFinalization.wholeParentPromotions,0);
  assert.equal(result.report.macroFinalization.trials.length,7);
  assert.ok(result.report.quality.minimumCornerSJ>.15);
  assert.deepEqual(result.mesh.nodes.slice(0,source.nodes.length),source.nodes);
  const counts=new Map();result.completedParentIds.forEach(p=>counts.set(p,(counts.get(p)??0)+1));
  assert.deepEqual([...new Set(counts.values())].sort((a,b)=>a-b),[1,31,64]);
  assert.throws(()=>refineExtrudedOgrid(source,{axis:2,bands:[{min:3,max:5,level:1}],completion:'none',transitionGeometry:'conservative-face-flux',balanceMode:'direct-macro'}),/contiguous level2/);
});
