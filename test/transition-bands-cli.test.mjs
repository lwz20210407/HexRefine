import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseMeshText} from '../dist/index.js';

test('native band CLI exports readable K/INP with stage sets and refuses overwrites',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'band-cli-'));
  try{
    const input=path.join(folder,'request.json'),out=path.join(folder,'case');
    const request={schemaVersion:1,mode:'annular',parameters:{innerRadius:10,outerRadius:18,fineSegments:64,ratios:[2,2]},extrusion:{height:4,layers:3}};
    await fs.writeFile(input,JSON.stringify(request));
    const script=fileURLToPath(new URL('../scripts/generate-transition-band.mjs',import.meta.url));
    const run=()=>spawnSync(process.execPath,[script,input,out],{cwd:folder,encoding:'utf8'});
    const success=run();assert.equal(success.status,0,success.stderr);
    const k=await fs.readFile(path.join(out,'mesh.k'),'utf8'),inp=await fs.readFile(path.join(out,'mesh.inp'),'utf8');
    assert.deepEqual(parseMeshText(k,'case.k').elements,parseMeshText(inp,'case.inp').elements);
    assert.match(inp,/stage_1/);assert.match(inp,/stage_2/);
    const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));
    assert.deepEqual(report.plan.counts,[64,32,16]);assert.equal(report.elements,432);
    assert.notEqual(run().status,0);assert.equal(await fs.readFile(path.join(out,'mesh.k'),'utf8'),k);
    await fs.writeFile(input,JSON.stringify({...request,parameters:{...request.parameters,fineSegments:23}}));
    const bad=run();assert.notEqual(bad.status,0);assert.match(bad.stderr,/requiredMultiple/);
  }finally{assert.equal(path.dirname(folder),path.resolve(os.tmpdir()));await fs.rm(folder,{recursive:true,force:true});}
});
