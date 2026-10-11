import test from 'node:test';
import assert from 'node:assert/strict';
import {generateRectangularGradedMesh} from '../dist/graded-rectangle.js';
import {meshToLsdynaKeyword,parseMeshText} from '../dist/index.js';
import {tryBuildDirectionalTwoToOneHexReplacements} from '../dist/two-to-one-sweep.js';

const base={fullSize:[20,20,4],refinedSize:[8,8],fineSize:1,coarseSize:2,
  reductions:{x:3,y:3,z:3},thicknessTransition:true,transitionStages:1,modelFraction:'half'};
for (const modelFraction of ['quarter','half','full']) {
  for (const x of [2,3]) for (const y of [2,3]) for (const z of [1,2,3]) {
    test(`graded rectangle ${modelFraction} ${x}/${y}/${z}: tensor core, conforming shell, coarse far field`,()=>{
      const input={...base,modelFraction,reductions:{x,y,z:z===1 ? 3:z},thicknessTransition:z!==1};
      const before=structuredClone(input);
      const r=generateRectangularGradedMesh(input);
      assert.deepEqual(input,before);
      assert.equal(r.quality.expectedCoreChildren,x*y*z);
      assert.ok(r.quality.minimumCornerScaledJacobian>0.05);
      assert.ok(r.quality.minimumGaussDeterminant>0);
      assert.ok(r.quality.relativeVolumeError<1e-10);
      const offspring=new Map();
      r.parentElementIds.forEach((id,index)=>{const list=offspring.get(id)??[];list.push(index);offspring.set(id,list);});
      assert.equal(offspring.size,r.baseMesh.elements.length);
      for (const parent of r.coreParentIds) assert.equal(offspring.get(parent).length,x*y*z);
      const coreNodes=new Set(r.coreParentIds.flatMap(id=>r.baseMesh.elements[id-1]));
      let farCount=0;
      r.baseMesh.elements.forEach((e,i)=>{
        if (e.some(n=>coreNodes.has(n)))return;
        farCount+=1;
        assert.equal(offspring.get(i+1).length,1);
        const child=r.mesh.elements[offspring.get(i+1)[0]];
        assert.deepEqual(child.map(n=>r.mesh.nodes[n-1]),e.map(n=>r.baseMesh.nodes[n-1]));
      });
      assert.ok(farCount>0);
      if(z===1) {
        const layers=[...new Set(r.mesh.nodes.map(p=>p[2]))].sort((a,b)=>a-b);
        assert.equal(layers.length,r.plan.fineCounts[2]+1);
        assert.deepEqual(layers,[0,1,2,3,4]);
      }
      const back=parseMeshText(meshToLsdynaKeyword(r.mesh),'generated.k');
      assert.deepEqual(back.elements,r.mesh.elements);
      assert.equal(back.nodes.length,r.mesh.nodes.length);
    });
  }
}

test('graded rectangle rejects tilt that collapses a double band',()=>{
  assert.throws(()=>generateRectangularGradedMesh({...base,fullSize:[80,80,16],refinedSize:[32,32],transitionStages:2,angleDegrees:60}),/double-transition X band/);
});

for (const angleDegrees of [-10,10]) {
  test(`double-band tilt ${angleDegrees} preserves the measured intermediate offset`,()=>{
    const spec={...base,fullSize:[80,80,16],refinedSize:[32,32],transitionStages:2,modelFraction:'quarter'};
    // Half-model is required: the original quarter-model contract forces tilt to zero.
    const straight=generateRectangularGradedMesh({...spec,modelFraction:'half'});
    const r=generateRectangularGradedMesh({...spec,modelFraction:'half',angleDegrees});
    assert.deepEqual(r.mesh.elements,straight.mesh.elements);
    const middle=r.plan.blocks.find(b=>b.name==='C1').max[0];
    let checked=0;
    straight.mesh.nodes.forEach((p,i)=>{
      if (Math.abs(p[0])===middle && p[2]===16) {
        assert.ok(Math.abs(r.mesh.nodes[i][0]-p[0]-r.plan.intermediateOffset/2)<1e-10);
        checked++;
      }
    });
    assert.ok(checked>0);
    assert.ok(r.quality.minimumGaussDeterminant>0);
  });
}

for(const angleDegrees of [-12,12]) {
  test(`single-band tilt ${angleDegrees} shears the core and fixes the outer X faces`,()=>{
    const straight=generateRectangularGradedMesh(base);
    const tilted=generateRectangularGradedMesh({...base,angleDegrees});
    assert.deepEqual(tilted.mesh.elements,straight.mesh.elements);
    const offset=4*Math.tan(angleDegrees*Math.PI/180);
    straight.mesh.nodes.forEach((p,i)=>{
      const q=tilted.mesh.nodes[i];
      assert.equal(q[1],p[1]);assert.equal(q[2],p[2]);
      const weight=Math.abs(p[0])<=4 ? 1:(10-Math.abs(p[0]))/6;
      assert.ok(Math.abs(q[0]-p[0]-offset*(p[2]/4-.5)*weight)<1e-12);
    });
    assert.ok(tilted.quality.minimumGaussDeterminant>0);
    assert.ok(tilted.quality.relativeVolumeError<1e-10);
  });
}

for (const x of [2,3]) for (const y of [2,3]) for (const z of [1,2,3]) {
  test(`double rectangular bands ${x}/${y}/${z}: cumulative ratio and preserved outer field`,()=>{
    const r=generateRectangularGradedMesh({...base,fullSize:[80,80,16],refinedSize:[32,32],
      modelFraction:'quarter',transitionStages:2,reductions:{x,y,z:z===1?3:z},thicknessTransition:z!==1});
    assert.equal(r.quality.expectedCoreChildren,(x*y*z)**2);
    assert.ok(r.quality.minimumGaussDeterminant>0);
    assert.ok(r.quality.relativeVolumeError<1e-9);
    const c1=r.plan.blocks.find(b=>b.name==='C1');
    const b1=r.plan.blocks.find(b=>b.name==='B1');
    const firstCore=r.baseMesh.elements.flatMap((e,i)=>{
      const center=[0,1].map(a=>e.reduce((v,n)=>v+r.baseMesh.nodes[n-1][a]/8,0));
      return center[0]<c1.max[0] && center[1]<b1.max[1] ? [i+1]:[];
    });
    const supportNodes=new Set(firstCore.flatMap(id=>r.baseMesh.elements[id-1]));
    const counts=new Map();r.parentElementIds.forEach(p=>counts.set(p,(counts.get(p)??0)+1));
    for (const id of r.coreParentIds)assert.equal(counts.get(id),(x*y*z)**2);
    r.baseMesh.elements.forEach((e,i)=>{if(!e.some(n=>supportNodes.has(n)))assert.equal(counts.get(i+1),1);});
    if(z===1)assert.equal(new Set(r.mesh.nodes.map(p=>p[2])).size,17);
  });
}

test('graded rectangle rejects excessive counts before allocating grid arrays',()=>{
  assert.throws(()=>generateRectangularGradedMesh({...base,fullSize:[2e9,2e9,4],refinedSize:[1e9,1e9]}),/two-million-cell/);
});

test('directional half sweeps reject repeated, empty, and invalid axes',()=>{
  const mesh={kind:'H1',nodes:[],elements:[]};
  for(const axes of [[],[0,0],[3]]) assert.throws(()=>tryBuildDirectionalTwoToOneHexReplacements(mesh,[],axes),/distinct axes/);
});
