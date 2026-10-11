import test from 'node:test';
import assert from 'node:assert/strict';
import {gui61Kinds,defaultGui61Request,gui61Fields,gui61Value,updateGui61Value,generateGui61,parseMeshText,parseNativeLsdynaMixedKeyword} from '../dist/index.js';

for(const [kind] of gui61Kinds){
  test(`GUI61 native generator ${kind} preserves keyword semantics`,()=>{
    const request=defaultGui61Request(kind),before=structuredClone(request),r=generateGui61(request);
    assert.deepEqual(request,before);assert.ok(r.summary.nodes>0);
    const mesh=r.model?parseNativeLsdynaMixedKeyword(r.files['mesh.k']):parseMeshText(r.files['mesh.k'],'mesh.k');
    assert.equal(mesh.nodes.length,r.summary.nodes);
    assert.deepEqual(JSON.parse(r.files['request.json']),request);
    if(r.model){assert.equal(mesh.beams.length,r.summary.beams);assert.deepEqual(mesh.solids,r.model.solids);assert.deepEqual(mesh.beams,r.model.beams);}
    else assert.deepEqual(mesh.elements,r.mesh.elements);
    assert.ok(r.files['report.json']);
    for(const field of gui61Fields(request))assert.notEqual(gui61Value(request,field.path),undefined,field.path);
  });
}
test('GUI61 field state separates thickness enable, ratio, fraction and actual stages',()=>{
  let r=defaultGui61Request('rectangular-solid');r=updateGui61Value(r,'reductions.z',2);
  r=updateGui61Value(r,'thicknessTransition',false);
  assert.equal(gui61Fields(r).find(f=>f.path==='reductions.z').disabled,true);
  assert.equal(gui61Value(r,'reductions.z'),2);
  r=updateGui61Value(r,'transitionStages',2);assert.equal(gui61Value(r,'transitionStages'),2);
  r=updateGui61Value(r,'modelFraction','quarter');assert.equal(gui61Fields(r).find(f=>f.path==='angleDegrees').disabled,true);
  const c=defaultGui61Request('circular-solid');assert.ok(!gui61Fields(c).some(f=>f.path==='thicknessTransition'));
  assert.throws(()=>updateGui61Value(c,'__proto__.polluted',true),/unknown/);
});
test('GUI61 drafts and generation refuse silently unsupported options',()=>{
  const a=defaultGui61Request('rectangular-solid');a.parameters.fullSize[0]=123;
  assert.equal(defaultGui61Request('rectangular-solid').parameters.fullSize[0],80);
  assert.throws(()=>generateGui61({...a,extra:true}),/unknown/);
  const c=defaultGui61Request('circular-solid');c.parameters.modelFraction='quarter';c.parameters.angleDegrees=10;
  assert.throws(()=>generateGui61(c),/quarter/);
  c.parameters.angleDegrees=0;c.parameters.thicknessTransition=false;
  assert.throws(()=>generateGui61(c),/unsupported/);
});
