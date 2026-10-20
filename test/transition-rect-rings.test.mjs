import test from 'node:test';
import assert from 'node:assert/strict';
import {planRectangularTransitionRings,generateRectangularTransitionRings,extrudeTransitionBand,checkNoHangingNodes} from '../dist/index.js';

test('four-side planner preserves initial resolution and inserts only necessary stage collars',()=>{
  const spec={innerSize:[12,8],fineSegments:[12,8],stages:2};
  const p=planRectangularTransitionRings(spec);
  assert.deepEqual(p.counts,[[12,8],[8,6],[6,6]]);assert.deepEqual(p.outerSize,[24,24]);
  assert.deepEqual(p.frames.map(f=>f.padding),[[0,0],[0,1]]);assert.equal(p.estimatedElements,148);
  const q=planRectangularTransitionRings({innerSize:[8,8],fineSegments:[8,8],stages:3});
  assert.deepEqual(q.counts,[[8,8],[6,6],[6,6],[6,6]]);
  assert.deepEqual(q.frames.map(f=>f.padding),[[0,0],[1,1],[1,1]]);assert.equal(q.estimatedElements,236);
});

for(const [innerSize,fineSegments,stages] of [[[12,8],[12,8],2],[[8,8],[8,8],3],[[10,4],[12,8],2]])
for(const includeCore of [false,true])test(`four-side closed ring ${innerSize}/${stages} core=${includeCore}`,()=>{
  const spec={innerSize,fineSegments,stages,includeCore,rotationDegrees:30,origin:[-7,11]},before=structuredClone(spec);
  const r=generateRectangularTransitionRings(spec);assert.deepEqual(spec,before);
  assert.equal(r.coreElementIds.length,includeCore?fineSegments[0]*fineSegments[1]:0);
  assert.equal(new Set(r.mesh.elements.flat()).size,r.mesh.nodes.length);
  assert.equal(r.nodeSets.fine.length,2*(fineSegments[0]+fineSegments[1]));
  assert.ok(r.elementRoles.includes('corner'));assert.ok(r.elementRoles.includes('collar'));
  assert.ok(checkNoHangingNodes(r.mesh,1e-9).ok);assert.ok(r.quality.relativeAreaError<1e-12);
  assert.ok(r.quality.minimumGaussDeterminant>0);
  const solid=extrudeTransitionBand(r,2,2);
  assert.equal(solid.mesh.elements.length,2*r.mesh.elements.length);
  assert.equal(solid.stageIds.filter(s=>s===0).length,2*r.coreElementIds.length);
  assert.ok(solid.quality.relativeVolumeError<1e-12);
});

test('isotropic rectangle reference cases reproduce complete node and cell counts',()=>{
  const a=generateRectangularTransitionRings({innerSize:[12,8],fineSegments:[12,8],stages:2});
  const b=generateRectangularTransitionRings({innerSize:[8,8],fineSegments:[8,8],stages:3});
  assert.equal(a.mesh.nodes.length,180);assert.equal(a.mesh.elements.length,148);
  assert.equal(b.mesh.nodes.length,264);assert.equal(b.mesh.elements.length,236);
});

test('corner placement optimization preserves boundary nodes and does not degrade minimum SJ',()=>{
  const spec={innerSize:[12,3],fineSegments:[8,8],stages:2};
  const base=generateRectangularTransitionRings({...spec,optimizeCorners:false});
  const improved=generateRectangularTransitionRings(spec);
  assert.ok(improved.quality.minimumCornerScaledJacobian>=base.quality.minimumCornerScaledJacobian);
  for(const name of ['fine','coarse']){
    const key=p=>p.join(':');
    assert.deepEqual(base.nodeSets[name].map(i=>key(base.mesh.nodes[i-1])).sort(),improved.nodeSets[name].map(i=>key(improved.mesh.nodes[i-1])).sort());
  }
});

test('unsupported ring counts and geometry fail before allocation',()=>{
  const valid={innerSize:[12,8],fineSegments:[12,8],stages:2};
  for(const replacement of [{fineSegments:[10,8]},{stages:0},{stages:2.3},{stages:true},{innerSize:[0,8]},
    {fineSegments:[100000,100000],includeCore:true},{ratio:4},{origin:[NaN,0]}])
    assert.throws(()=>generateRectangularTransitionRings({...valid,...replacement}));
});

test('3:1 rings insert enough regular collars to preserve every prior interface',()=>{
  for(const stages of [1,2,3])for(const includeCore of [false,true]){
    const r=generateRectangularTransitionRings({innerSize:[9,9],fineSegments:[9,9],ratio:3,stages,includeCore});
    assert.deepEqual(r.plan.counts,[[9,9],...Array.from({length:stages},()=>[5,5])]);
    assert.equal(r.mesh.elements.length,52+(stages-1)*108+(includeCore?81:0));
    if(stages>1)assert.deepEqual(r.plan.frames[1].padding,[2,2]);
    assert.ok(r.quality.minimumCornerScaledJacobian>0);assert.ok(checkNoHangingNodes(r.mesh,1e-9).ok);
    assert.ok(extrudeTransitionBand(r,2,2).quality.relativeVolumeError<1e-12);
  }
});
