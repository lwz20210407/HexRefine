import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {checkNoHangingNodes,H1_FACES,hexElementSignedVolume,meshToLsdynaKeyword,parseMeshText,refineExtrudedOgrid} from '../dist/index.js';
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
  assert.throws(()=>refineExtrudedOgrid(source,{axis:2,bands:[{min:3,max:5,level:1}],completion:'none',balanceMode:'direct-macro'}),/explicit conservative-face-flux/);
});

test('direct127 shells preserve all three-level core tensor nodes without a uniform halo',()=>{
  const source=cylinder(2,8),copy=structuredClone(source);
  const result=refineExtrudedOgrid(source,{axis:2,bands:[{min:3,max:5,level:3}],completion:'none',transitionGeometry:'conservative-face-flux',balanceMode:'direct-macro',maxPromotedSourceLayers:0});
  verifyFullFinestCore(result);assert.deepEqual(source,copy);
  assert.deepEqual(result.report.promotedSourceLayerIndices,[]);
  assert.equal(result.report.macroFinalization.childrenPerShellParent,127);
  assert.deepEqual(result.report.macroFinalization.shellGroups,[{depth:3,parents:8,childrenPerParent:127}]);
  assert.deepEqual(result.mesh.nodes.slice(0,source.nodes.length),source.nodes);
  const indices=new Map();result.completedParentIds.forEach((p,i)=>{const cells=indices.get(p)??[];cells.push(i);indices.set(p,cells);});
  for(const [parent,children] of indices){
    if(children.length===1){assert.deepEqual(result.mesh.elements[children[0]],source.elements[parent-1]);continue;}
    if(children.length!==512){assert.equal(children.length,127);continue;}
    const vertices=source.elements[parent-1].map(n=>source.nodes[n-1]);
    const nodes=new Set(children.flatMap(i=>result.mesh.elements[i]));assert.equal(nodes.size,729);
    const signs=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
    const expected=[];for(let i=0;i<=8;i++)for(let j=0;j<=8;j++)for(let k=0;k<=8;k++){
      const r=[i/4-1,j/4-1,k/4-1],weights=signs.map(c=>c.reduce((s,v,a)=>s*(1+v*r[a])/2,1));
      expected.push([0,1,2].map(a=>vertices.reduce((s,p,c)=>s+p[a]*weights[c],0)));
    }
    for(const n of nodes)assert.ok(expected.some(p=>Math.hypot(...p.map((v,a)=>v-result.mesh.nodes[n-1][a]))<1e-10));
  }
});

test('independent level1/2/3 bands retain exact cores and do not bridge the coarse gap',()=>{
  const source=cylinder(2,18),result=refineExtrudedOgrid(source,{axis:2,bands:[{min:3,max:5,level:1},{min:7,max:9,level:2},{min:12,max:14,level:3}],completion:'none',transitionGeometry:'conservative-face-flux',balanceMode:'direct-macro',maxPromotedSourceLayers:0});
  verifyFullFinestCore(result);
  assert.deepEqual(result.report.requestedLayerTargets,result.report.effectiveLayerTargets);
  assert.equal(result.report.macroFinalization.childrenPerShellParent,null);
  assert.deepEqual(result.report.macroFinalization.shellGroups,[1,2,3].map(depth=>({depth,parents:8,childrenPerParent:2*4**depth-1})));
  const counts=new Map();result.completedParentIds.forEach(p=>counts.set(p,(counts.get(p)??0)+1));
  for(let k=0;k<18;k++)for(let c=0;c<4;c++){
    const level=result.report.requestedLayerTargets[k];
    const expected=level?8**level:Math.max(result.report.requestedLayerTargets[k-1]??0,result.report.requestedLayerTargets[k+1]??0);
    assert.equal(counts.get(1+4*k+c),level?expected:expected?2*4**expected-1:1);
  }
  assert.equal(result.report.coarseFarFieldParents,24);
  const reread=parseMeshText(meshToLsdynaKeyword(result.mesh),'separate-bands.k');
  assert.deepEqual(reread.elements,result.mesh.elements);
});

test('direct-band incompatibilities are rejected before shell/core promotion',()=>{
  const source=cylinder(2,12),options={axis:2,completion:'none',transitionGeometry:'conservative-face-flux',balanceMode:'direct-macro',maxPromotedSourceLayers:0};
  assert.throws(()=>refineExtrudedOgrid(source,{...options,bands:[{min:3,max:5,level:2},{min:5,max:8,level:3}]}),/different positive target/);
  assert.throws(()=>refineExtrudedOgrid(source,{...options,bands:[{min:3,max:5,level:3}],maxOutputElements:4500}),/before assembly/);
});

test('shared original parents host two conforming half-shells without promoting either core',()=>{
  for(const [lowDepth,highDepth] of [[1,1],[1,2],[2,2],[3,1],[2,3],[3,3]]){
    const source=cylinder(2,8),copy=structuredClone(source),options={axis:2,bands:[{min:2,max:3,level:lowDepth},{min:4,max:5,level:highDepth}],completion:'none',transitionGeometry:'conservative-face-flux',balanceMode:'direct-macro',maxPromotedSourceLayers:0};
    const result=refineExtrudedOgrid(source,options);verifyFullFinestCore(result);
    assert.deepEqual(source,copy);assert.deepEqual(result.mesh.nodes.slice(0,source.nodes.length),source.nodes);
    assert.deepEqual(result.report.requestedLayerTargets,result.report.effectiveLayerTargets);
    assert.deepEqual(result.report.promotedSourceLayerIndices,[]);
    assert.deepEqual(result.report.sharedShellSourceParentIds,[13,14,15,16]);
    const split=.5+result.report.macroFinalization.selectedInterfaceBias*Math.sign(lowDepth-highDepth);
    assert.deepEqual(result.report.macroFinalization.twoSidedShellGroups,[{lowDepth,highDepth,parents:4,childrenPerParent:2*4**lowDepth+2*4**highDepth-2,coarseInterfaceFractionOfParentHeight:split}]);
    assert.equal(result.report.macroFinalization.twoSidedShellParents,4);
    assert.equal(result.report.macroFinalization.axialStationWarp.originalParentPlanesFixed,true);
    const groups=new Map();result.completedParentIds.forEach((p,i)=>{const cells=groups.get(p)??[];cells.push(i);groups.set(p,cells);});
    for(let layer=0;layer<8;layer++)for(let c=0;c<4;c++){
      const parent=1+4*layer+c,cells=groups.get(parent);
      const expected=layer===2?8**lowDepth:layer===4?8**highDepth:layer===3?2*4**lowDepth+2*4**highDepth-2:layer===1?2*4**lowDepth-1:layer===5?2*4**highDepth-1:1;
      assert.equal(cells.length,expected);
      if(layer===2||layer===4){
        const depth=layer===2?lowDepth:highDepth;assert.ok(cells.every(i=>result.uniformCells[i]&&result.levels[i]===depth));
        const vertices=source.elements[parent-1].map(n=>source.nodes[n-1]),points=[...new Set(cells.flatMap(i=>result.mesh.elements[i]))].map(n=>result.mesh.nodes[n-1]);
        const key=p=>p.map(v=>v.toFixed(10)).join(':'),expected=new Set(),signs=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
        for(let i=0;i<=2**depth;i++)for(let j=0;j<=2**depth;j++)for(let k=0;k<=2**depth;k++){
          const r=[i,j,k].map(v=>2*v/2**depth-1),weights=signs.map(c=>c.reduce((s,v,a)=>s*(1+v*r[a])/2,1));expected.add(key([0,1,2].map(a=>vertices.reduce((s,p,c)=>s+p[a]*weights[c],0))));
        }
        assert.equal(points.length,(2**depth+1)**3);assert.deepEqual(new Set(points.map(key)),expected);
      }
      if(layer===3){
        // The new coarse interface remains one Q1 quad on original parent edges.
        const vertices=source.elements[parent-1].map(n=>source.nodes[n-1]);
        const points=[...new Set(cells.flatMap(i=>result.mesh.elements[i]))].map(n=>result.mesh.nodes[n-1]);
        for(let i=0;i<4;i++){const midpoint=vertices[i].map((v,a)=>(1-split)*v+split*vertices[i+4][a]);assert.ok(points.some(p=>Math.hypot(...p.map((v,a)=>v-midpoint[a]))<1e-11));}
        assert.equal(points.filter(p=>Math.abs(p[2]-(3+split))<1e-11).length,4);
        const midfaces=cells.flatMap(i=>H1_FACES.map(f=>f.map(n=>result.mesh.elements[i][n-1]))).filter(f=>f.every(n=>Math.abs(result.mesh.nodes[n-1][2]-(3+split))<1e-11));
        assert.equal(midfaces.length,2);assert.deepEqual([...midfaces[0]].sort((a,b)=>a-b),[...midfaces[1]].sort((a,b)=>a-b));
      }
      if(expected===1)assert.deepEqual(result.mesh.elements[cells[0]],source.elements[parent-1]);
    }
    const reread=parseMeshText(meshToLsdynaKeyword(result.mesh),'two-sided.k');assert.deepEqual(reread.elements,result.mesh.elements);
    assert.equal(result.report.macroFinalization.trials.find(t=>t.exponent===result.report.macroFinalization.selectedExponent&&t.interfaceBias===result.report.macroFinalization.selectedInterfaceBias).positiveGaussSamples,true);
  }
});

test('shared-shell virtual preparation refuses a too-small budget before assembly',()=>{
  const source=cylinder(2,8),copy=structuredClone(source);
  assert.throws(()=>refineExtrudedOgrid(source,{axis:2,bands:[{min:2,max:3,level:2},{min:4,max:5,level:2}],completion:'none',transitionGeometry:'conservative-face-flux',balanceMode:'direct-macro',maxOutputElements:32}),/shared-shell preparation.*before assembly/);
  assert.deepEqual(source,copy);
});

test('mapped shared shells preserve per-parent volume through physical axes and reversed local axial frames',()=>{
  for(const axis of [0,1,2])for(const reflected of [false,true]){
    const source=cylinder(2,8,axis),cross=axis===0?[1,2]:axis===1?[2,0]:[0,1];
    source.nodes=source.nodes.map(p=>{const q=[...p],x=p[cross[0]],y=p[cross[1]],z=p[axis]/8;
      q[cross[0]]+=.001*(x+1)*(y+1)*z;q[cross[1]]+=.001*x*y*z*z;
      if(reflected)q[cross[0]]*=-1;return q;});
    if(reflected)source.elements=source.elements.map(e=>[0,3,2,1,4,7,6,5].map(i=>e[i]));
    source.elements=source.elements.map(e=>(reflected?[4,5,1,0,7,6,2,3]:[0,4,5,1,3,7,6,2]).map(i=>e[i]));
    const copy=structuredClone(source),result=refineExtrudedOgrid(source,{axis,bands:[{min:2,max:3,level:1},{min:4,max:5,level:2}],completion:'none',transitionGeometry:'conservative-face-flux',balanceMode:'direct-macro',maxPromotedSourceLayers:0});
    assert.deepEqual(source,copy);assert.deepEqual(result.mesh.nodes.slice(0,source.nodes.length),source.nodes);
    assert.equal(result.report.macroFinalization.twoSidedShellParents,4);
    assert.ok(checkNoHangingNodes(result.mesh,1e-8).ok);
    const volumes=source.elements.map(()=>0);result.completedParentIds.forEach((p,i)=>volumes[p-1]+=hexElementSignedVolume(result.mesh.elements[i].map(n=>result.mesh.nodes[n-1])));
    volumes.forEach((volume,i)=>assert.ok(Math.abs(volume-hexElementSignedVolume(source.elements[i].map(n=>source.nodes[n-1])))/volume<1e-8));
    assert.equal(result.report.macroFinalization.trials.find(t=>t.exponent===result.report.macroFinalization.selectedExponent&&t.interfaceBias===result.report.macroFinalization.selectedInterfaceBias).positiveGaussSamples,true);
  }
});

test('explicit strong support width separates the two2:1 stages without changing the requested core',()=>{
  const source=cylinder(2,14),copy=structuredClone(source),options={axis:2,bands:[{min:6,max:8,level:2}],completion:'none',transitionGeometry:'conservative-face-flux',strongSupportLayers:2};
  const result=refineExtrudedOgrid(source,options);verifyFullFinestCore(result);
  assert.deepEqual(source,copy);assert.equal(result.mesh.elements.length,912);
  assert.deepEqual(result.report.promotedSourceLayerIndices,[4,5,8,9]);
  assert.equal(result.report.strongSupportLayers,2);assert.equal(result.report.coarseFarFieldParents,24);
  assert.equal(result.report.quality.engineeringAcceptanceVerified,false);
  assert.ok(result.report.quality.sizeDistribution.transitionElements>0);
  assert.ok(result.report.quality.sizeDistribution.transitionToFinestCoreEdgeRatio>0);
  const counts=new Map();result.completedParentIds.forEach(p=>counts.set(p,(counts.get(p)??0)+1));
  for(const layer of [4,9])for(let c=0;c<4;c++)assert.equal(counts.get(1+4*layer+c),8);
  assert.throws(()=>refineExtrudedOgrid(source,{...options,maxPromotedSourceLayers:3}),/maxPromotedSourceLayers/);
  for(const n of [0,1.5,9])assert.throws(()=>refineExtrudedOgrid(source,{...options,strongSupportLayers:n}),/strongSupportLayers/);
  assert.throws(()=>refineExtrudedOgrid(source,{...options,balanceMode:'direct-macro'}),/not valid for direct-macro/);
});
