import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultGui61Request,generateGui61,createGui61ParameterArchive,parseGui61ParameterFile,verifyGui61ParameterReplay,validateLsdynaMixedSets} from '../dist/index.js';

for(const kind of ['reinforced-uniform','reinforced-graded'])for(const includeZBars of [true,false]){
  test(`RC archive preserves mesh, steel, sets and export gate ${kind} Z=${includeZBars}`,()=>{
    const request=defaultGui61Request(kind);request.parameters.includeZBars=includeZBars;
    const result=generateGui61(request),archive=createGui61ParameterArchive(result,false);
    const imported=parseGui61ParameterFile(JSON.parse(JSON.stringify(archive))),replayed=generateGui61(imported.request);
    assert.equal(imported.exportK,false);verifyGui61ParameterReplay(imported,replayed);
    assert.equal(replayed.files['mesh.k'],result.files['mesh.k']);
    assert.deepEqual(replayed.model,result.model);
    for(const file of ['node_sets.json','cell_sets.json'])assert.deepEqual(JSON.parse(replayed.files[file]),JSON.parse(result.files[file]));
    const sets=JSON.parse(replayed.files['cell_sets.json']);assert.equal(sets.bars_z.length>0,includeZBars);
    validateLsdynaMixedSets(replayed.model,{nodeSets:JSON.parse(replayed.files['node_sets.json']),cellSets:sets});
    const tampered=structuredClone(archive),changed=JSON.parse(tampered.files['cell_sets.json']);changed.bars_x.pop();
    tampered.files['cell_sets.json']=JSON.stringify(changed);
    assert.throws(()=>verifyGui61ParameterReplay(parseGui61ParameterFile(tampered),replayed),/cell_sets.json mismatch/);
    delete tampered.files['node_sets.json'];assert.throws(()=>parseGui61ParameterFile(tampered),/missing named/);
  });
}

test('GUI61 request imports reject coercion and preserve disabled parameter state',()=>{
  const request=defaultGui61Request('reinforced-graded');request.parameters.concrete.thicknessTransition=false;request.parameters.concrete.reductions.z=2;
  assert.deepEqual(parseGui61ParameterFile(request).request,request);
  for(const patch of [r=>r.parameters.barCounts[0]='4',r=>r.parameters.includeZBars=1,
    r=>r.parameters.concrete.transitionStages=3,r=>r.parameters.connectivity='embedded',r=>r.parameters.rebarMeshSize=null]){
    const bad=structuredClone(request);patch(bad);assert.throws(()=>parseGui61ParameterFile(bad));
  }
  for(const bad of [null,[],{archiveVersion:2,request},{archiveVersion:1,request},
    {request,ui:{exportK:'false'}},{request,files:{'cell_sets.json':{}}}])assert.throws(()=>parseGui61ParameterFile(bad));
});

test('legacy archives remain replayable but cannot silently change stored sets or request',()=>{
  const request=defaultGui61Request('reinforced-uniform'),result=generateGui61(request),versioned=createGui61ParameterArchive(result);
  const legacy=structuredClone(versioned);delete legacy.archiveVersion;
  verifyGui61ParameterReplay(parseGui61ParameterFile(legacy),result);
  assert.throws(()=>parseGui61ParameterFile({...legacy,request:{...request,parameters:{...request.parameters,includeZBars:false}}}),/disagrees/);
  const imported=parseGui61ParameterFile(request),other=generateGui61({...request,parameters:{...request.parameters,includeZBars:false}});
  assert.throws(()=>verifyGui61ParameterReplay(imported,other),/request mismatch/);
});

test('mixed named sets distinguish global beam EIDs from dense solid indices',()=>{
  const r=generateGui61(defaultGui61Request('reinforced-uniform')),model=r.model;
  validateLsdynaMixedSets(model,{cellSets:{steel:[model.beams[0].id]},nodeSets:{n3:[model.beams[0].orientationNode]}});
  for(const sets of [{cellSets:{bad:[model.beams.at(-1).id+1]}},{nodeSets:{bad:[0]}},{nodeSets:{bad:[model.nodes.length+1]}},
    {cellSets:{repeat:[1,1]}},{nodeSets:{' ':[]}}, {nodeSets:[]}])assert.throws(()=>validateLsdynaMixedSets(model,sets));
});

test('valid minimal API requests replay without adding GUI demonstration defaults',()=>{
  for(const kind of ['reinforced-uniform','reinforced-graded']){
    const request=defaultGui61Request(kind);
    if(kind==='reinforced-uniform')for(const key of ['maximumRelativeDimensionChange','elementLimit','optimizeMeshSize'])delete request.parameters[key];
    else for(const key of ['angleDegrees','angleCorrection'])delete request.parameters.concrete[key];
    const result=generateGui61(request),archive=createGui61ParameterArchive(result),imported=parseGui61ParameterFile(archive);
    assert.deepEqual(imported.request,request);verifyGui61ParameterReplay(imported,generateGui61(imported.request));
  }
});
