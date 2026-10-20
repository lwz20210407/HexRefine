import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
import {createHexUnitCubeMesh,parseNativeLsdynaMixedKeyword} from '../dist/index.js';
test('closure CLI validates complete mesh-only K/PID/lineage outputs and refuses overwrite',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'hex-closure-cli-'));
 try{
  const mesh=createHexUnitCubeMesh(5,5,5),parentPartIds=mesh.elements.map((_,i)=>i<63?4:7),request={schemaVersion:1,kind:'hex-transition-closure',mesh,selection:[63],options:{ratio:2},parentPartIds};
  const file=path.join(temp,'request.json'),out=path.join(temp,'result');await fs.writeFile(file,JSON.stringify(request));
  const run=()=>spawnSync(process.execPath,['scripts/refine-hex-closure.mjs',file,out],{cwd:process.cwd(),encoding:'utf8'});
  const result=run();assert.equal(result.status,0,result.stderr);
  const model=parseNativeLsdynaMixedKeyword(await fs.readFile(path.join(out,'mesh.k'),'utf8')),lineage=JSON.parse(await fs.readFile(path.join(out,'lineage.json'),'utf8'));
  model.solids.forEach((e,i)=>assert.equal(e.partId,parentPartIds[lineage.baseParentIds[i]-1]));assert.equal(model.beams.length,0);
  assert.notEqual(run().status,0);const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));assert.match(report.keywordScope,/mesh only/);
  await fs.writeFile(file,JSON.stringify({...request,options:{ratio:2,allowSupportRedistribution:true}}));assert.match(run().stderr,/single material/);
  await fs.writeFile(file,JSON.stringify({...request,selection:[0]}));assert.notEqual(run().status,0);
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
