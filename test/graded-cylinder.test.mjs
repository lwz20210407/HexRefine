import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCylindricalGradedMesh,meshToLsdynaKeyword,parseMeshText,checkNoHangingNodes} from '../dist/index.js';

const base={outerRadius:20,thickness:3,length:40,coreArcLength:12,coreLength:12,fineSize:1,radialSize:1,
  coarseSize:3,thicknessTransition:true,layers:1,modelFraction:'quarter'};

for(const modelFraction of ['quarter','half','full'])for(const thicknessTransition of [false,true]){
  test(`native solid cylinder ${modelFraction} radial transition=${thicknessTransition}`,()=>{
    const r=generateCylindricalGradedMesh({...base,modelFraction,thicknessTransition});
    assert.equal(r.mesh.kind,'H1');
    assert.deepEqual(r.plan.fineCounts,[6,6,3]);
    assert.deepEqual(r.plan.outerCounts,[8,5,thicknessTransition?1:3]);
    assert.ok(r.quality.minimumCornerScaledJacobian>0);
    assert.ok(r.quality.minimumGaussDeterminant>0);
    assert.ok(r.quality.relativeBoundaryVolumeError<1e-10);
    assert.ok(r.quality.radialBoundaryError<1e-12);
    assert.ok(r.quality.relativeAnalyticVolumeError<.02);
    assert.ok(checkNoHangingNodes(r.mesh,1e-7).ok);
    const childCount=new Map();r.parentElementIds.forEach(p=>childCount.set(p,(childCount.get(p)??0)+1));
    assert.equal(childCount.size,r.baseMesh.elements.length);
    for(const p of r.coreParentIds)assert.equal(childCount.get(p),thicknessTransition?27:9);
    assert.ok([...childCount.values()].some(n=>n===1));
    const xyz=r.mesh.nodes;
    const bounds=[0,1,2].map(a=>[Math.min(...xyz.map(p=>p[a])),Math.max(...xyz.map(p=>p[a]))]);
    assert.deepEqual(bounds[1],modelFraction==='full'?[-20,20]:[0,20]);
    assert.ok(Math.abs(bounds[2][0]+20)<1e-10 && Math.abs(bounds[2][1]-20)<1e-10);
    assert.ok(Math.abs(bounds[0][0]-(modelFraction==='quarter'?0:-20))<1e-10);
    const back=parseMeshText(meshToLsdynaKeyword(r.mesh,{coordinateFormat:'compact'}),'cylinder.k');
    assert.deepEqual(back.elements,r.mesh.elements);
  });
}

test('separated physical cylinder layers keep distinct nodes, parents, and geometry',()=>{
  const r=generateCylindricalGradedMesh({...base,layers:2});
  assert.deepEqual(r.plan.layerRadii,[{outer:20,inner:17},{outer:16,inner:13}]);
  const first=new Set(r.nodeSets.layer_1),second=new Set(r.nodeSets.layer_2);
  assert.ok([...first].every(n=>!second.has(n)));
  for(const [name,ids] of Object.entries(r.cellSets)){
    const nodes=new Set(r.nodeSets[name]);
    for(const id of ids)assert.ok(r.mesh.elements[id-1].every(n=>nodes.has(n)));
  }
  assert.equal(first.size+second.size,r.mesh.nodes.length);
  assert.ok([...first].every(n=>Math.hypot(r.mesh.nodes[n-1][0],r.mesh.nodes[n-1][2])>=17-1e-10));
  assert.ok([...second].every(n=>Math.hypot(r.mesh.nodes[n-1][0],r.mesh.nodes[n-1][2])<=16+1e-10));
});

test('full cylinder corrects source vi=3 coverage, with deterministic symmetry ratios',()=>{
  const q=generateCylindricalGradedMesh(base);
  const h=generateCylindricalGradedMesh({...base,modelFraction:'half'});
  const f=generateCylindricalGradedMesh({...base,modelFraction:'full'});
  assert.equal(h.mesh.elements.length,q.mesh.elements.length*2);
  assert.equal(f.mesh.elements.length,q.mesh.elements.length*4);
  assert.ok(Math.abs(f.quality.volume/q.quality.volume-4)<1e-10);
  assert.match(f.plan.warnings.join(' '),/vi=3/);
});

test('cylinder fails closed for unsupported switches or physically impossible dimensions',()=>{
  for(const change of [{layers:0},{layers:6},{layers:1.5},{coreArcLength:200},{coreLength:40},
    {thickness:21},{radialSize:100},{coarseSize:20},{reductions:{x:2,y:2}},
    {transitionStages:2},{modelFraction:'invalid'},{thicknessTransition:1}]){
    assert.throws(()=>generateCylindricalGradedMesh({...base,...change}));
  }
});
