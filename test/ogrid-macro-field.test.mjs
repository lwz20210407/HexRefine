import test from 'node:test';
import assert from 'node:assert/strict';
import {compileHierarchicalShellReferences,compileGradedShellReferences} from '../dist/hierarchical-macro-library.js';
import {refineOgridMacroField,checkNoHangingNodes,createHexUnitCubeMesh,hexElementSignedVolume,minimumHexCornerScaledJacobian,mergeCoincidentNodes} from '../dist/index.js';
import {properCubeRotations} from '../dist/two-to-one-templates.js';
import {hexJacobian} from '../dist/hex-quality-internal.js';

function box(){const m=createHexUnitCubeMesh(2,2,8);m.nodes=m.nodes.map(p=>[2*p[0],2*p[1],8*p[2]]);return m;}
function targets(m,level){return m.elements.flatMap((e,i)=>{const z=e.reduce((s,n)=>s+m.nodes[n-1][2],0)/8;return z>=3&&z<5?[{elementId:i+1,level}]:[];});}
const options=(m,level=2)=>({axis:2,targets:targets(m,level),transitionGeometry:'conservative-face-flux'});
for(const depth of [1,2,3])test(`compiled complete depth${depth} parent tables are immutable dyadic volume-eight hex meshes`,()=>{
  const tables=compileHierarchicalShellReferences(depth);assert.equal(tables.length,4);
  for(const t of tables){assert.equal(t.elements.length,2*4**depth-1);assert.ok(Object.isFrozen(t)&&Object.isFrozen(t.nodes)&&Object.isFrozen(t.nodes[0]));
    assert.ok(Math.abs(t.elements.reduce((s,e)=>s+hexElementSignedVolume(e.map(n=>t.nodes[n])),0)-8)<1e-12);
    for(const e of t.elements){assert.equal(new Set(e).size,8);assert.ok(minimumHexCornerScaledJacobian(e.map(n=>t.nodes[n]))>0);}
  }
});
for(const level of [1,2,3])test(`direct depth${level} installation preserves all core and coarse parents without support promotion`,()=>{
  const m=box(),before=structuredClone(m),r=refineOgridMacroField(m,options(m,level));
  assert.deepEqual(m,before);assert.deepEqual(r.mesh.nodes.slice(0,m.nodes.length),m.nodes);
  const counts=new Map();r.sourceParentIds.forEach(p=>counts.set(p,(counts.get(p)??0)+1));
  for(const t of targets(m,level))assert.equal(counts.get(t.elementId),8**level);
  assert.equal(r.report.shellParents,8);assert.equal(r.report.farFieldParents,16);
  assert.equal(r.report.wholeParentPromotions,0);assert.equal(r.report.sourceTopologyCompensation,false);
  assert.equal(r.report.referenceExteriorPhaseClosureVerified,true);assert.ok(r.report.maximumCoreCoordinateError<1e-12);
  assert.ok(r.report.maximumOriginalParentRelativeVolumeError<1e-12);assert.ok(checkNoHangingNodes(r.mesh,1e-8).ok);
  r.report.farFieldParentIds.forEach((p,i)=>assert.deepEqual(r.mesh.elements[i],m.elements[p-1]));
  assert.ok(r.uniformCells.slice(0,16).every(Boolean));assert.ok(r.roles.slice(0,16).every(r=>r==='unchanged'));
  for(const e of r.mesh.elements){const p=e.map(n=>r.mesh.nodes[n-1]);for(const u of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const v of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const w of [-1/Math.sqrt(3),1/Math.sqrt(3)]){
    const [a,b,c]=hexJacobian(p,u,v,w);assert.ok(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0])>0);
  }}
});
test('all48 frames install on actual source connectivity, rather than just rotating a template certificate',()=>{
  const m=box(),request=options(m),frames=properCubeRotations();
  for(const matrix of frames)for(const reflected of [false,true]){
    const source=structuredClone(m);source.nodes=m.nodes.map(p=>matrix.map(row=>row.reduce((s,v,a)=>s+v*p[a],0)));
    if(reflected){source.nodes=source.nodes.map(p=>[-p[0],p[1],p[2]]);source.elements=source.elements.map(e=>[0,3,2,1,4,7,6,5].map(i=>e[i]));}
    const axis=matrix.findIndex(row=>row[2]!==0),r=refineOgridMacroField(source,{...request,axis});
    assert.equal(r.mesh.elements.length,776);assert.equal(r.report.coreParents,8);assert.equal(r.report.farFieldParents,16);
    assert.ok(r.report.maximumOriginalParentRelativeVolumeError<1e-12);
  }
});
test('odd-valence stars distinguish conforming installation from a level-closed exterior contract',()=>{
  for(const n of [3,5]){
    const section=[[0,0]],quads=[];
    for(let i=0;i<n;i++){const t=i*2*Math.PI/n;section.push([Math.cos(t),Math.sin(t)],[1.5*Math.cos(t+Math.PI/n),1.5*Math.sin(t+Math.PI/n)]);quads.push([0,1+2*i,2+2*i,1+2*((i+1)%n)]);}
    const source={kind:'H1',nodes:[],elements:[]};for(let k=0;k<=8;k++)for(const p of section)source.nodes.push([...p,k]);
    for(let k=0;k<8;k++)for(const q of quads)source.elements.push([...q.map(v=>1+v+k*section.length),...q.map(v=>1+v+(k+1)*section.length)]);
    assert.throws(()=>refineOgridMacroField(source,options(source)),e=>e.code==='incompatible-field');
    const r=refineOgridMacroField(source,{...options(source),exteriorPhasePolicy:'unconstrained'});
    assert.equal(r.report.referenceExteriorPhaseClosureVerified,false);assert.equal(r.report.cornerGroups.length,2);
    assert.ok(r.report.cornerGroups.every(g=>g.valence===n&&g.children===31*n&&g.completeOriginalParentsCovered));
    assert.ok(r.report.minimumOverallCornerSJ>.2);assert.ok(checkNoHangingNodes(r.mesh,1e-8).ok);
  }
});
test('budgets, conflicting cores and wrong-axis inputs fail without silently changing selection',()=>{
  const m=box(),before=structuredClone(m),o=options(m);
  assert.throws(()=>refineOgridMacroField(m,{...o,maxOutputElements:100}),e=>e.code==='output-budget');
  assert.throws(()=>refineOgridMacroField(m,{...o,maxShellParents:1}),e=>e.code==='shell-budget');
  assert.throws(()=>refineOgridMacroField(m,{...o,axis:0}),e=>e.code==='non-axial-interface');
  assert.throws(()=>refineOgridMacroField(m,{...o,targets:[...o.targets,o.targets[0]]}),/duplicate/);
  const adjacent=structuredClone(o);adjacent.targets[0].level=1;assert.throws(()=>refineOgridMacroField(m,adjacent),e=>e.code==='adjacent-core-levels');
  assert.throws(()=>refineOgridMacroField(m,{...o,minimumCornerScaledJacobian:.999}),e=>e.code==='requested-quality');
  assert.deepEqual(m,before);
});
for(const [fine,coarse,children] of [[2,1,32],[3,1,128],[3,2,160]])test(`complete graded parent ${fine}->${coarse} compiles ${children} hexes with both tensor interface contracts`,()=>{
  for(const t of compileGradedShellReferences(fine,coarse)){
    assert.equal(t.elements.length,children);assert.ok(Math.abs(t.elements.reduce((s,e)=>s+hexElementSignedVolume(e.map(n=>t.nodes[n])),0)-8)<1e-12);
    for(const e of t.elements)assert.ok(minimumHexCornerScaledJacobian(e.map(n=>t.nodes[n]))>0);
  }
});
test('layered direct macros expand only explicitly budgeted shell parents, never uniform target support',()=>{
  const m=createHexUnitCubeMesh(2,2,12);m.nodes=m.nodes.map(p=>[2*p[0],2*p[1],12*p[2]]);
  const target=m.elements.flatMap((e,i)=>{const z=e.reduce((s,n)=>s+m.nodes[n-1][2],0)/8;return z>=5&&z<7?[{elementId:i+1,level:2}]:[];});
  assert.throws(()=>refineOgridMacroField(m,{axis:2,targets:target,shellLayers:2}),e=>e.code==='shell-expansion-budget');
  const r=refineOgridMacroField(m,{axis:2,targets:target,shellLayers:2,maxAdditionalShellParents:8,transitionGeometry:'conservative-face-flux'});
  assert.equal(r.mesh.elements.length,848);assert.equal(r.report.shellExpansion.additionalParentIds.length,8);
  assert.equal(r.report.wholeParentPromotions,0);assert.equal(r.report.shellParents,16);
  assert.deepEqual(r.report.shellGroups.map(s=>s.childrenPerParent),[7,32]);assert.equal(r.report.coreParents,8);
  assert.ok(r.report.minimumOverallCornerSJ>.38);assert.ok(r.report.sizeDistribution.transitionToCoreMinimumEdgeRatio>1-1e-12);
  assert.ok(r.report.selectedStationBlend!==null);assert.ok(r.report.maximumOriginalParentRelativeVolumeError<1e-12);
  assert.ok(checkNoHangingNodes(r.mesh,1e-8).ok);
  assert.throws(()=>refineOgridMacroField(m,{axis:2,targets:target,shellLayers:4}),/invalid/);
  assert.throws(()=>refineOgridMacroField(m,{axis:2,targets:target,minimumTransitionToCoreEdgeRatio:100}),e=>e.code==='mapped-quality');
  const collide=m.elements.flatMap((e,i)=>{const z=e.reduce((s,n)=>s+m.nodes[n-1][2],0)/8;return (z>=3&&z<4)||(z>=6&&z<7)?[{elementId:i+1,level:2}]:[];});
  assert.throws(()=>refineOgridMacroField(m,{axis:2,targets:collide,shellLayers:2,maxAdditionalShellParents:32}),e=>e.code==='shell-collision');
});
test('complete supported five-valent O-grid installs a strict level-closed layered field on old connectivity',()=>{
  const nodes=[],elements=[],sectors=5;
  for(let s=0;s<sectors;s++){
    const p=[[0,0],[Math.cos(s*2*Math.PI/sectors),Math.sin(s*2*Math.PI/sectors)],
      [1.5*Math.cos((s+.5)*2*Math.PI/sectors),1.5*Math.sin((s+.5)*2*Math.PI/sectors)],
      [Math.cos((s+1)*2*Math.PI/sectors),Math.sin((s+1)*2*Math.PI/sectors)]],start=nodes.length,id=(i,j,k)=>start+1+9*k+3*j+i;
    for(let k=0;k<=8;k++)for(let j=0;j<=2;j++)for(let i=0;i<=2;i++){
      const u=i/2,v=j/2,w=[(1-u)*(1-v),u*(1-v),u*v,(1-u)*v];nodes.push([0,1].map(a=>p.reduce((sum,q,c)=>sum+q[a]*w[c],0)).concat(k));
    }
    for(let k=0;k<8;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++)elements.push([id(i,j,k),id(i+1,j,k),id(i+1,j+1,k),id(i,j+1,k),id(i,j,k+1),id(i+1,j,k+1),id(i+1,j+1,k+1),id(i,j+1,k+1)]);
  }
  const source=mergeCoincidentNodes({kind:'H1',nodes,elements},1e-10);
  const r=refineOgridMacroField(source,{...options(source),shellLayers:2,maxAdditionalShellParents:40});
  assert.equal(r.mesh.elements.length,4160);assert.equal(r.report.coreParents,40);assert.equal(r.report.farFieldParents,40);
  assert.equal(r.report.referenceExteriorPhaseClosureVerified,true);
  assert.equal(r.report.cornerGroups.filter(g=>g.valence===5&&g.children===160).length,2);
  assert.ok(checkNoHangingNodes(r.mesh,1e-8).ok);assert.ok(r.report.maximumOriginalParentRelativeVolumeError<1e-12);
});
