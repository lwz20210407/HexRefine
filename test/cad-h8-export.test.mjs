import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {parseNativeLsdynaMixedKeyword} from '../dist/lsdyna-mixed.js';

test('CAD H8 binary bridge writes actual mesh-only K and rejects malformed connectivity without publishing',async()=>{
  const root=await fs.mkdtemp(path.join(process.env.BOLTHEX_TEST_ROOT??os.tmpdir(),'cad-h8-export-'));
  const script=fileURLToPath(new URL('../scripts/export-cad-h8-binary.mjs',import.meta.url));
  try{
    const points=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
    const n=Buffer.alloc(8*24),e=Buffer.alloc(32);
    points.forEach((p,i)=>p.forEach((x,a)=>n.writeDoubleLE(x,i*24+a*8)));
    for(let i=0;i<8;i++)e.writeInt32LE(i,i*4);
    await fs.writeFile(path.join(root,'mesh-binary.json'),JSON.stringify({schemaVersion:1,nodes:8,elements:1,inspectionOnly:true}));
    await fs.writeFile(path.join(root,'nodes.f64'),n);await fs.writeFile(path.join(root,'elements.i32'),e);
    let run=spawnSync(process.execPath,[script,root],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    const keyword=await fs.readFile(path.join(root,'model.k'),'utf8');
    assert.match(keyword,/INSPECTION SUBSET ONLY/);
    const parsed=parseNativeLsdynaMixedKeyword(keyword);
    assert.deepEqual(parsed.nodes,points);assert.equal(parsed.solids.length,1);
    assert.deepEqual(parsed.solids[0].nodes,[1,2,3,4,5,6,7,8]);
    run=spawnSync(process.execPath,[script,root],{encoding:'utf8'});
    assert.notEqual(run.status,0);assert.match(run.stderr,/overwrite/);
    await fs.unlink(path.join(root,'model.k'));e.writeInt32LE(0,4);
    await fs.writeFile(path.join(root,'elements.i32'),e);
    run=spawnSync(process.execPath,[script,root],{encoding:'utf8'});
    assert.notEqual(run.status,0);assert.match(run.stderr,/Invalid H8/);
    assert.equal(await fs.stat(path.join(root,'model.k')).then(()=>true,()=>false),false);
    assert.equal(await fs.stat(path.join(root,'model.partial.k')).then(()=>true,()=>false),false);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
