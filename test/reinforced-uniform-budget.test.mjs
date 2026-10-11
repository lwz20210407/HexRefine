import test from 'node:test';
import assert from 'node:assert/strict';
import {planUniformReinforcement as plan,generateUniformReinforcedMesh as generate,meshToLsdynaMixedKeyword,parseNativeLsdynaMixedKeyword,checkNoHangingNodes} from '../dist/index.js';
const base={size:[20,12,8],meshSize:1,barCounts:[4,3,3],cover:[1,1,1],includeZBars:true,connectivity:'separate',
  dimensionPolicy:'source-aligned',maximumRelativeDimensionChange:.2,elementLimit:1800,optimizeMeshSize:true};
for(const connectivity of ['separate','shared'])for(const includeZBars of [true,false]){
  test(`uniform quantity optimization ${connectivity} Z=${includeZBars}`,()=>{
    const spec={...base,connectivity,includeZBars},r=generate(spec),p=r.plan;
    assert.ok(Math.abs(p.effectiveMeshSize-1.171)<1e-12);
    assert.deepEqual(p.counts,[17,10,8]);assert.equal(p.solidCount,1360);assert.equal(p.beamCount,includeZBars?369:273);
    assert.ok(p.solidCount+p.beamCount<=1800&&p.totalRelativeDimensionChange<=.2);
    assert.ok(p.relativeDimensionChange.every(x=>Math.abs(x)<=.2));
    assert.ok(checkNoHangingNodes(r.concreteMesh,1e-7).ok);
    assert.ok(r.quality.minimumCornerScaledJacobian>.999&&r.quality.minimumGaussDeterminant>0&&r.quality.relativeVolumeError<1e-10);
    assert.ok(Math.abs(r.quality.minimumBeamLength-p.effectiveMeshSize)<1e-10);
    assert.ok(Math.abs(r.quality.maximumBeamLength-p.effectiveMeshSize)<1e-10);
    assert.ok(r.quality.minimumBeamOrientationSine>0);
    assert.equal(r.quality.sharedEndpointNodes>0,connectivity==='shared');
    const back=parseNativeLsdynaMixedKeyword(meshToLsdynaMixedKeyword(r.model,{coordinateFormat:'compact'}));
    assert.deepEqual(back.solids,r.model.solids);assert.deepEqual(back.beams,r.model.beams);
    assert.equal(spec.meshSize,1);
  });
}
test('search checks nonmonotone absolute dimensional errors instead of only element count',()=>{
  const chosen=plan(base);
  let first=null;
  for(let k=-500;k<=1000;k++){
    try{
      const candidate=plan({...base,meshSize:1+k*.001,optimizeMeshSize:false});
      if(candidate.totalRelativeDimensionChange<=.2+1e-12){first=candidate;break;}
    }catch{}
  }
  assert.ok(first);assert.equal(first.effectiveMeshSize,chosen.effectiveMeshSize);
  assert.ok(plan({...base,meshSize:1.1,optimizeMeshSize:false}).totalRelativeDimensionChange>.2);
});
test('exact limits, dimension preservation, and disabled optimization have explicit behavior',()=>{
  assert.equal(plan({...base,elementLimit:2340}).effectiveMeshSize,1);
  assert.throws(()=>plan({...base,dimensionPolicy:'preserve',maximumRelativeDimensionChange:0}),/no feasible/);
  const strict=plan({...base,elementLimit:2340,dimensionPolicy:'preserve',maximumRelativeDimensionChange:0});
  assert.equal(strict.effectiveMeshSize,1);assert.deepEqual(strict.actualSize,base.size);
  assert.throws(()=>plan({...base,optimizeMeshSize:false}),/exceeds elementLimit/);
  const off=plan({...base,optimizeMeshSize:false,elementLimit:3000});assert.equal(off.effectiveMeshSize,1);
});
test('uniform budget fails closed for impossible or malformed search contracts',()=>{
  for(const patch of [{elementLimit:undefined},{elementLimit:0},{elementLimit:1},{optimizeMeshSize:1},
    {meshSizeSearch:{minimum:1,maximum:1.1},maximumRelativeDimensionChange:0},
    {meshSizeSearch:{minimum:0,maximum:2}},{meshSizeSearch:{minimum:2,maximum:1}},
    {meshSizeSearch:{minimum:1,maximum:2,step:0}},{meshSizeSearch:{minimum:1,maximum:2,step:1e-9}},
    {meshSizeSearch:{minimum:1,maximum:2,maximumTotalRelativeDimensionChange:-1}},
    {meshSizeSearch:{minimum:1,maximum:2,unknown:true}},
    {optimizeMeshSize:false,meshSizeSearch:{minimum:1,maximum:2}}])assert.throws(()=>plan({...base,...patch}));
});
