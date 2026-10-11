import test from 'node:test';
import assert from 'node:assert/strict';
import {planUniformReinforcement,generateUniformReinforcedMesh,meshToLsdynaMixedKeyword,parseNativeLsdynaMixedKeyword,validateLsdynaMixedMesh,checkNoHangingNodes} from '../dist/index.js';

const spec={size:[20,12,8],meshSize:1,barCounts:[4,3,3],cover:[1,1,1],includeZBars:true,connectivity:'separate',dimensionPolicy:'preserve'};

for(const connectivity of ['separate','shared'])for(const includeZBars of [true,false]){
  test(`uniform RC fixes nonsquare directional counts, ${connectivity}, Z=${includeZBars}`,()=>{
    const result=generateUniformReinforcedMesh({...spec,connectivity,includeZBars});
    const {model,plan,quality}=result;
    assert.deepEqual(plan.actualSize,spec.size);assert.deepEqual(plan.counts,[20,12,8]);
    assert.deepEqual(plan.barSpacing,[6,5,3]);assert.equal(model.solids.length,1920);
    assert.equal(model.beams.length,includeZBars?420:324);
    assert.equal(result.cellSets.bars_x.length,180);assert.equal(result.cellSets.bars_y.length,144);
    assert.equal(result.cellSets.bars_z.length,includeZBars?96:0);
    assert.ok(quality.minimumCornerScaledJacobian>.999);assert.ok(quality.minimumGaussDeterminant>0);
    assert.ok(quality.relativeVolumeError<1e-10);assert.ok(checkNoHangingNodes(result.concreteMesh,1e-8).ok);
    assert.ok(Math.abs(quality.minimumBeamLength-1)<1e-10 && Math.abs(quality.maximumBeamLength-1)<1e-10);
    assert.ok(quality.minimumBeamOrientationSine>0);
    const solidNodes=new Set(model.solids.flatMap(e=>e.nodes)),beamNodes=new Set(model.beams.flatMap(e=>e.nodes));
    assert.ok([...beamNodes].every(n=>solidNodes.has(n)===(connectivity==='shared')));
    const allIds=[...model.solids,...model.beams].map(e=>e.id);assert.equal(new Set(allIds).size,allIds.length);
    assert.ok(model.solids.every(e=>e.partId===3));assert.ok(model.beams.every(e=>e.partId===2));
    const text=meshToLsdynaMixedKeyword(model,{coordinateFormat:'compact'});
    assert.deepEqual(parseNativeLsdynaMixedKeyword(text),model);
    assert.deepEqual(text.split('\n').filter(l=>l.startsWith('*')),['*KEYWORD','*NODE','*ELEMENT_SOLID','*ELEMENT_BEAM','*END']);
  });
}

test('RC dimension adjustment needs explicit opt-in and bounds both growth and shrinkage',()=>{
  const input={...spec,size:[20.5,12,8]};
  assert.throws(()=>planUniformReinforcement(input),/dimension change/);
  assert.throws(()=>planUniformReinforcement({...input,dimensionPolicy:'source-aligned',maximumRelativeDimensionChange:.01}),/dimension change/);
  const plan=planUniformReinforcement({...input,dimensionPolicy:'source-aligned',maximumRelativeDimensionChange:.03});
  assert.equal(plan.actualSize[0],20);assert.ok(plan.relativeDimensionChange[0]<0);
  const growth=planUniformReinforcement({...spec,size:[20,12,8.1],dimensionPolicy:'source-aligned',maximumRelativeDimensionChange:.25});
  assert.equal(growth.actualSize[2],10);assert.ok(growth.relativeDimensionChange[2]>0);
});

test('RC reports mesh-aligned cover and refuses implicit connectivity or unsupported controls',()=>{
  const plan=planUniformReinforcement({...spec,cover:[1.2,1.2,.2]});
  assert.deepEqual(plan.cover,[1,1,1]);assert.match(plan.warnings.join(' '),/Cover distances/);
  for(const patch of [{connectivity:undefined},{connectivity:'embedded'},{barCounts:[1,3,3]},
    {includeZBars:1},{cover:[11,1,1]},{meshSize:0},{concretePartId:2},{dimensionPolicy:undefined},
    {maximumRelativeDimensionChange:-1},{size:[20,12]},{elementLimit:0}]){
    assert.throws(()=>planUniformReinforcement({...spec,...patch}));
  }
});

test('mixed writer rejects ID collisions, missing nodes, and invalid orientation geometry',()=>{
  const {model}=generateUniformReinforcedMesh({...spec,size:[4,4,4],barCounts:[2,2,2]});
  const bad=()=>structuredClone(model);
  let m=bad();m.beams[0].id=m.solids[0].id;assert.throws(()=>validateLsdynaMixedMesh(m),/duplicate element IDs/);
  m=bad();m.beams[0].orientationNode=m.beams[0].nodes[0];assert.throws(()=>validateLsdynaMixedMesh(m),/orientation/);
  m=bad();m.beams[0].nodes[1]=999999;assert.throws(()=>validateLsdynaMixedMesh(m),/invalid node/);
  m=bad();m.solids[0].nodes[0]=m.solids[0].nodes[1];assert.throws(()=>validateLsdynaMixedMesh(m),/solid connectivity/);
  m=bad();m.nodes[0][0]=NaN;assert.throws(()=>validateLsdynaMixedMesh(m),/finite/);
  assert.throws(()=>meshToLsdynaMixedKeyword(model,{partId:1}),/unknown/);
  assert.throws(()=>meshToLsdynaMixedKeyword(model,{coordinatePrecision:100}),/Precision/);
});

test('native mixed reader never silently discards conditions or beam releases',()=>{
  const {model}=generateUniformReinforcedMesh({...spec,size:[4,4,4],barCounts:[2,2,2]});
  const text=meshToLsdynaMixedKeyword(model,{coordinateFormat:'compact'});
  assert.throws(()=>parseNativeLsdynaMixedKeyword(text.replace('*END','*MAT_ELASTIC\n*END')),/unsupported/);
  assert.throws(()=>parseNativeLsdynaMixedKeyword(text.replace('*END','')),/framing/);
  const lines=text.split('\n'),i=lines.indexOf('*ELEMENT_BEAM')+1;
  lines[i]=lines[i].slice(0,40)+'       1'+lines[i].slice(48);
  assert.throws(()=>parseNativeLsdynaMixedKeyword(lines.join('\n')),/release/);
});
