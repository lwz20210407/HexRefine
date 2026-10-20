import test from 'node:test';
import assert from 'node:assert/strict';
import {createHexUnitCubeMesh,refineByElementIdsWithReport,previewRefinementByElementIds,refineHexWithTransitionClosure,
 refineHexMultilevel,classifyHexTransitionBoundary,checkNoHangingNodes,HexTransitionConformanceError,HexTransitionClosureError} from '../dist/index.js';
import {properCubeRotations} from '../dist/two-to-one-templates.js';
const mesh=createHexUnitCubeMesh(6,6,6),id=(x,y,z)=>1+x+6*(y+6*z);
const shapes={L:[[2,2,2],[3,2,2],[2,3,2]],edge:[[2,2,2],[3,3,2]],vertex:[[2,2,2],[3,3,3]],T:[[2,2,2],[3,2,2],[4,2,2],[3,3,2]],concave:[[2,2,2],[3,2,2],[2,3,2],[2,2,3]]};
for(const ratio of [2,3])for(const [name,coords] of Object.entries(shapes))test(`bounded ${ratio}:1 closes ${name} without global refinement`,()=>{
 const requested=coords.map(c=>id(...c)),before=structuredClone(mesh),r=refineHexWithTransitionClosure(mesh,requested,{ratio,maxAddedParents:8,maxStates:32});
 assert.deepEqual(mesh,before);assert.ok(checkNoHangingNodes(r.mesh,1e-8).ok);assert.ok(r.quality.ok);
 assert.ok(r.closure.addedParentIds.length<=8);assert.ok(r.closure.maxAddedLayer<=1);assert.ok(r.closure.preservedFarFieldParents>100);
 assert.equal(r.summary.selectedElementCount,r.closure.effectiveParentIds.length);
 for(const parent of r.closure.effectiveParentIds){
  const children=r.cellData.filter(c=>c.parentElementId===parent);assert.equal(children.length,ratio**3);assert.ok(children.every(c=>c.role==='selected'));
 }
 const sourceNodes=mesh.nodes.length;assert.deepEqual(r.mesh.nodes.slice(0,sourceNodes),mesh.nodes);
 for(const [i,c] of r.cellData.entries())if(c.role==='unchanged')assert.deepEqual(r.mesh.elements[i],mesh.elements[c.parentElementId-1]);
});

test('3:1 unsafe legacy L/edge previews and outputs now reject rather than return hanging meshes',()=>{
 const selected=shapes.L.map(c=>id(...c));
 for(const fn of [refineByElementIdsWithReport,previewRefinementByElementIds])assert.throws(()=>fn(mesh,selected,{hexRefinementRatio:3}),e=>e instanceof HexTransitionConformanceError&&e.code==='HEX_TRANSITION_CONFORMANCE'&&e.conflictingParentIds.length>0);
});

test('closure reports budgets/protected regions and never mutates input on failure',()=>{
 const selected=shapes.vertex.map(c=>id(...c)),before=structuredClone(mesh);
 for(const ratio of [2,3]){
  assert.throws(()=>refineHexWithTransitionClosure(mesh,selected,{ratio,maxAddedParents:0,maxStates:2}),HexTransitionClosureError);
  assert.throws(()=>refineHexWithTransitionClosure(mesh,selected,{ratio,maxAddedLayers:0,maxStates:2}),HexTransitionClosureError);
  assert.throws(()=>refineHexWithTransitionClosure(mesh,[id(2,2,2)],{ratio,allowedParentIds:[id(2,2,2)]}),e=>e.code==='HEX_CLOSURE_PROTECTED');
 }
 assert.deepEqual(mesh,before);
 for(const options of [{ratio:4},{ratio:2,maxStates:0},{ratio:3,maxAddedParents:-1},{ratio:3,mergeTolerance:Infinity}])assert.throws(()=>refineHexWithTransitionClosure(mesh,selected,options),RangeError);
 assert.throws(()=>refineHexWithTransitionClosure(mesh,[9999],{ratio:3}),RangeError);
 const inverted=structuredClone(mesh);inverted.elements[0]=[0,3,2,1,4,7,6,5].map(i=>mesh.elements[0][i]);
 assert.throws(()=>refineHexWithTransitionClosure(inverted,[87],{ratio:2}),/positively oriented/);
});

test('boundary taxonomy distinguishes face, edge, vertex and concave incidence',()=>{
 const s=classifyHexTransitionBoundary(mesh,shapes.L.map(c=>id(...c)));
 assert.ok(s.some(v=>v.kind==='concave-edge'));assert.ok(s.some(v=>v.kind==='face'));assert.ok(s.some(v=>v.kind==='edge'));assert.ok(s.some(v=>v.kind==='vertex'));
 const corner=classifyHexTransitionBoundary(mesh,[id(2,2,3),id(2,3,2),id(3,2,2)]);
 assert.ok(corner.some(v=>v.kind==='concave-vertex'));
});

for(const ratio of [2,3])test(`multilevel ${ratio}:1 balances support first and preserves exact finest core`,()=>{
 const m=createHexUnitCubeMesh(7,7,7),core=1+3+7*(3+7*3),before=structuredClone(m);
 const r=refineHexMultilevel(m,[{parentId:core,level:2}],{ratio,maxOutputElements:10000});
 assert.deepEqual(m,before);assert.ok(checkNoHangingNodes(r.mesh,1e-8).ok);assert.ok(r.report.quality.minimumCornerScaledJacobian>0);
 assert.ok(r.report.preservedFarFieldParents>200);assert.equal(r.report.balancedParentIds.length,26);
 const childIds=r.baseParentIds.flatMap((base,i)=>base===core?[i]:[]);assert.equal(childIds.length,ratio**6);
 assert.ok(childIds.every(i=>r.uniformCells[i]&&r.levels[i]===2));
 assert.deepEqual(r.mesh.nodes.slice(0,m.nodes.length),m.nodes);
 for(const i of childIds)for(const n of r.mesh.elements[i])for(const coordinate of r.mesh.nodes[n-1])assert.ok(Math.abs(coordinate*7*ratio**2-Math.round(coordinate*7*ratio**2))<1e-7);
});

test('multilevel failures respect balance, protected IDs and output allocation bounds',()=>{
 const m=createHexUnitCubeMesh(7,7,7),core=172,before=structuredClone(m);
 for(const patch of [{maxBalancedParents:0},{allowedBaseParentIds:[core]},{maxOutputElements:100},{maxLevel:1}])assert.throws(()=>refineHexMultilevel(m,[{parentId:core,level:2}],{ratio:3,...patch}));
 assert.deepEqual(m,before);
});

for(const ratio of [2,3])test(`${ratio}:1 vertex-star closure accepts all 48 cube frames including mirrors`,()=>{
 const selected=shapes.vertex.map(c=>id(...c)),reorder=[0,3,2,1,4,7,6,5];
 for(const rotation of properCubeRotations())for(const reflected of [false,true]){
  const m={kind:'H1',nodes:mesh.nodes.map(p=>rotation.map((row,a)=>row.reduce((s,v,i)=>s+v*p[i],0)*(reflected&&a===0?-1:1)+a+2)),
   elements:mesh.elements.map(e=>reflected?reorder.map(i=>e[i]):[...e])};
  const r=refineHexWithTransitionClosure(m,selected,{ratio,maxAddedParents:6,maxStates:8});
  assert.equal(r.closure.addedParentIds.length,6);assert.ok(r.quality.ok);assert.ok(checkNoHangingNodes(r.mesh,1e-8).ok);
 }
});

test('three consecutive 3:1 levels retain a 19683-cell finest core and a coarse far field',()=>{
 const m=createHexUnitCubeMesh(9,9,9),core=365;
 const r=refineHexMultilevel(m,[{parentId:core,level:3}],{ratio:3,maxOutputElements:100000,maxBalancedParents:150});
 assert.equal(r.baseParentIds.filter(id=>id===core).length,19683);assert.ok(r.report.preservedFarFieldParents>300);
 assert.ok(r.report.quality.relativeVolumeError<1e-8);assert.ok(r.report.quality.minimumCornerScaledJacobian>0);
});

test('warped paired support requires explicit redistribution consent; the uniform core is unchanged',()=>{
 const m=createHexUnitCubeMesh(5,5,5);m.nodes=m.nodes.map(([x,y,z])=>[x+.2*x*y,y+.1*x*z,z+.15*y*x]);
 assert.throws(()=>refineHexWithTransitionClosure(m,[63],{ratio:2,maxAddedParents:0,maxStates:1}),/explicit allowSupportRedistribution/);
 const r=refineHexWithTransitionClosure(m,[63],{ratio:2,allowSupportRedistribution:true});
 assert.ok(r.closure.supportRedistribution.length>0);assert.ok(r.closure.maximumSupportParentRelativeVolumeError>1e-8);
 assert.ok(r.closure.supportRedistribution.every(v=>v.parentId!==63));assert.ok(r.quality.relativeVolumeError<1e-8);
 assert.ok(checkNoHangingNodes(r.mesh,1e-8).ok);
});
