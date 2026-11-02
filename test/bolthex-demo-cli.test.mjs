import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseNativeLsdynaMixedKeyword} from '../dist/lsdyna-mixed.js';

const project=fileURLToPath(new URL('../',import.meta.url)),python=process.env.BOLTHEX_PYTHON;
const run=args=>spawnSync(process.execPath,['scripts/generate-bolthex-demo.mjs',...args],{cwd:project,encoding:'utf8',timeout:120000});
test('recovered demo CLI writes verified K/INP, distinct PIDs, original surfaces, and refuses overwrite',
  {skip:!python},async()=>{
    const root=await fs.mkdtemp(path.join(process.env.BOLTHEX_TEST_ROOT??os.tmpdir(),'bolthex-cli-'));
    try{
      const out=path.join(root,'result'),r=run([out,'--python',python]);assert.equal(r.status,0,r.stderr);
      const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));
      assert.equal(report.nodes,46313);assert.equal(report.elements,40272);assert.equal(report.originalExecutableRequired,false);
      assert.equal(report.pythonBackend,true);assert.equal(report.guiPorted,false);
      assert.ok(report.minimumCornerScaledJacobian>=.15);assert.ok(report.maximumCoordinateReadbackError<1e-8);
      const inp=await fs.readFile(path.join(out,'model.inp'));
      assert.equal(createHash('sha256').update(inp).digest('hex'),report.inpSHA256);
      const canonicalWindowsText=inp.toString('utf8').replace(/\r?\n/g,'\r\n');
      assert.equal(createHash('sha256').update(canonicalWindowsText).digest('hex'),'7ff46daa0e757b0e46db305bdbdb5640cabb33a603fbfdc4d69df2aaa71af7e0');
      const k=await fs.readFile(path.join(out,'model.k'),'utf8'),model=parseNativeLsdynaMixedKeyword(k);
      assert.deepEqual([...new Set(model.solids.map(e=>e.partId))],[1,2,3]);assert.equal(model.beams.length,0);
      const parts=JSON.parse(await fs.readFile(path.join(out,'parts-and-surfaces.json'),'utf8'));
      assert.equal(parts.length,3);assert.ok(parts[0].abaqusSourceSurfaces.S_THREAD.length>0);
      const again=run([out,'--python',python]);assert.notEqual(again.status,0);assert.match(again.stderr,/overwrite/);
      assert.equal(await fs.readFile(path.join(out,'model.k'),'utf8'),k);
      assert.deepEqual(await fs.readdir(root),['result']);
    }finally{await fs.rm(root,{recursive:true,force:true});}
  });
test('recovered CLI rejects missing Python and malformed arguments without publishing a result',async()=>{
  const root=await fs.mkdtemp(path.join(process.env.BOLTHEX_TEST_ROOT??os.tmpdir(),'bolthex-invalid-'));
  try{
    assert.notEqual(run([path.join(root,'result'),'--python',path.join(root,'missing.exe')]).status,0);
    assert.notEqual(run([]).status,0);assert.deepEqual(await fs.readdir(root),[]);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('adapted femssc profile exports full bodies, INP, K and matching CAD section data',
  {skip:!python},async()=>{
    const root=await fs.mkdtemp(path.join(process.env.BOLTHEX_TEST_ROOT??os.tmpdir(),'profile-cli-'));
    try{
      const output=path.join(root,'result'),result=run([output,'--python',python,'--case','femssc']);
      assert.equal(result.status,0,result.stderr);
      const report=JSON.parse(await fs.readFile(path.join(output,'report.json'),'utf8'));
      assert.equal(report.nodes,40161);assert.equal(report.elements,36528);
      assert.equal(report.geometry,'femssc-profile-generic-full-pair');assert.ok(report.minimumCornerScaledJacobian>=.15);
      const geometry=JSON.parse(await fs.readFile(path.join(output,'geometry-sections.json'),'utf8'));
      assert.equal(geometry.parts.length,2);assert.equal(geometry.representation,'parameter-section-ruled-brep');
      assert.equal(geometry.analyticHelix,false);assert.equal(geometry.threaded,true);
      assert.match(geometry.source,/kycai\/femssc/);
      const model=parseNativeLsdynaMixedKeyword(await fs.readFile(path.join(output,'model.k'),'utf8'));
      assert.deepEqual([...new Set(model.solids.map(e=>e.partId))],[1,2]);
      assert.ok((await fs.readFile(path.join(output,'model.inp'),'utf8')).includes('*SURFACE'));
    }finally{await fs.rm(root,{recursive:true,force:true});}
  });
