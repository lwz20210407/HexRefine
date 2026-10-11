import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCircularGradedQuadMesh,checkNoHangingNodes,meshToLsdynaShellKeyword,parseMeshText} from '../dist/index.js';
const base={radius:20,refinedRadius:10,fineSize:1,coarseSize:2,modelFraction:'quarter'};
for(const [modelFraction,nodes,cells] of [['quarter',160,140],['half',302,280],['full',569,560]]){
  test(`2D circular ${modelFraction} uses the measured butterfly and radial growth`,()=>{
    const r=generateCircularGradedQuadMesh({...base,modelFraction});
    assert.equal(r.mesh.nodes.length,nodes);assert.equal(r.mesh.elements.length,cells);
    assert.equal(r.plan.fineCount,12);assert.equal(r.plan.radialCount,5);
    const intervals=r.plan.radialLevels.slice(1).map((v,i)=>v-r.plan.radialLevels[i]);
    for(let i=1;i<intervals.length;i++)assert.ok(Math.abs(intervals[i]/intervals[i-1]-1.1)<1e-12);
    assert.ok(r.quality.minimumGaussDeterminant>0);
    assert.ok(r.quality.relativeAreaError<1e-10);
    assert.equal(checkNoHangingNodes(r.mesh,1e-8).ok,true);
    assert.equal(r.plan.sourceNodeConstraintFlagsCopied,false);
    const counts=new Map();r.parentElementIds.forEach(p=>counts.set(p,(counts.get(p)??0)+1));
    for(const p of r.coreParentIds)assert.equal(counts.get(p),9);
    const k=meshToLsdynaShellKeyword(r.mesh,{coordinateFormat:'compact'});
    const parsed=parseMeshText(k,'circular.k');
    assert.equal(parsed.kind,'Q1');assert.deepEqual(parsed.elements,r.mesh.elements);
    assert.ok(r.nodeSets.plane_x0.length>0 && r.nodeSets.plane_y0.length>0);
  });
}

test('2D circular published-command dimensions produce the expected mesh',()=>{
  const r=generateCircularGradedQuadMesh({radius:50,refinedRadius:30,fineSize:2,coarseSize:5,modelFraction:'quarter'});
  assert.equal(r.plan.fineCount,18);assert.equal(r.plan.radialCount,4);
  assert.equal(r.mesh.nodes.length,311);assert.equal(r.mesh.elements.length,285);
});

test('2D circular generator rejects unsupported ratios and unresolved bias',()=>{
  assert.throws(()=>generateCircularGradedQuadMesh({...base,ratio:2}),/unsupported/);
  assert.throws(()=>generateCircularGradedQuadMesh({...base,coarseSize:.0001}),/allocation|excessive|unresolved/);
  assert.throws(()=>generateCircularGradedQuadMesh({...base,refinedRadius:21}),/invalid/);
});
