import test from 'node:test';
import assert from 'node:assert/strict';
import {generateRectangularGradedQuadMesh,meshToLsdynaShellKeyword,meshToLsdynaKeyword,parseMeshText,checkNoHangingNodes} from '../dist/index.js';
const base={positiveSize:[20,15],fineRegionSize:[7,6.25],coarseCounts:[10,6],reductions:{x:2,y:3},modelFraction:'half'};
for(const modelFraction of ['quarter','half','full'])for(const x of [2,3])for(const y of [2,3]){
  test(`2D rectangle ${modelFraction} ${x}/${y} aligns counts and exports actual shell cells`,()=>{
    const input={...base,modelFraction,reductions:{x,y}},before=structuredClone(input);
    const result=generateRectangularGradedQuadMesh(input);
    assert.deepEqual(input,before);
    assert.deepEqual(result.plan.coarseCoreCounts,[x===2?4:3,2]);
    assert.deepEqual(result.plan.fineRegionSize,[x===2?8:6,5]);
    assert.deepEqual(result.plan.fineCounts,[x===2?8:9,2*y]);
    assert.equal(result.mesh.kind,'Q1');
    assert.ok(result.mesh.nodes.every(p=>p.length===3 && p[2]===0));
    assert.ok(result.mesh.elements.every(e=>e.length===4));
    assert.equal(checkNoHangingNodes(result.mesh,1e-8).ok,true);
    assert.ok(result.quality.minimumGaussDeterminant>0);
    assert.ok(result.quality.relativeAreaError<1e-10);
    const counts=new Map();result.parentElementIds.forEach(p=>counts.set(p,(counts.get(p)??0)+1));
    for(const p of result.coreParentIds)assert.equal(counts.get(p),x*y);
    const keyword=meshToLsdynaShellKeyword(result.mesh,{coordinateFormat:'compact',partId:7});
    assert.ok(keyword.includes('*ELEMENT_SHELL'));
    assert.ok(!keyword.includes('*ELEMENT_SOLID'));
    assert.throws(()=>meshToLsdynaKeyword(result.mesh),/ELEMENT_SOLID/);
    const back=parseMeshText(keyword,'quad.k');
    assert.equal(back.kind,'Q1');assert.deepEqual(back.elements,result.mesh.elements);
  });
}

test('2D planner rejects invalid or unsupported inputs',()=>{
  assert.throws(()=>generateRectangularGradedQuadMesh({...base,fineRegionSize:[0.1,1]}),/aligned quad core/);
  assert.throws(()=>generateRectangularGradedQuadMesh({...base,fineRegionSize:[19,14]}),/outer coarse intervals/);
  assert.throws(()=>generateRectangularGradedQuadMesh({...base,coarseCounts:[10.5,6]}),/positive integers/);
  assert.throws(()=>generateRectangularGradedQuadMesh({...base,thickness:0.1}),/unsupported/);
});
