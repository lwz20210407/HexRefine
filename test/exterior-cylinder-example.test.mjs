import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseMeshText,checkNoHangingNodes} from '../dist/index.js';

const run=(args)=>spawnSync(process.execPath,['scripts/generate-exterior-cylinder-example.mjs',...args],{encoding:'utf8',timeout:120000});
test('fixed exterior-dense example emits a complete native H8 K, not an HM export',async()=>{
  const root=await fs.mkdtemp(path.join(process.env.HEXREFINE_TEST_OUTPUT??os.tmpdir(),'exterior-cylinder-'));
  try{
    const out=path.join(root,'generated'),result=run([out]);assert.equal(result.status,0,result.stderr);
    const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8')),text=await fs.readFile(path.join(out,'mesh.k'),'utf8'),mesh=parseMeshText(text,'mesh.k');
    assert.equal(mesh.kind,'H1');assert.equal(mesh.elements.length,8700);assert.equal(mesh.nodes.length,10010);
    assert.equal(report.sectionQuads,348);assert.equal(report.axialLayers,25);assert.equal(report.axialGrading,false);
    assert.deepEqual(report.coarseToFineAngularIntervalsPerQuadrant,[6,18]);assert.ok(report.minimumCornerSJ>.64);
    assert.ok(report.relativeDiscreteVolumeError<1e-12);assert.equal(report.engineeringAcceptanceVerified,false);
    assert.equal(report.readback.sha256,createHash('sha256').update(text).digest('hex'));assert.ok(checkNoHangingNodes(mesh,1e-8).ok);
    const before=text,refused=run([out]);assert.notEqual(refused.status,0);assert.match(refused.stderr,/refusing to overwrite/);
    assert.equal(await fs.readFile(path.join(out,'mesh.k'),'utf8'),before);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('fixed example refuses missing arguments and an absent output parent',async()=>{
  assert.notEqual(run([]).status,0);
  const root=await fs.mkdtemp(path.join(process.env.HEXREFINE_TEST_OUTPUT??os.tmpdir(),'exterior-cylinder-refusal-'));
  try{const result=run([path.join(root,'absent','output')]);assert.notEqual(result.status,0);assert.deepEqual(await fs.readdir(root),[]);}
  finally{await fs.rm(root,{recursive:true,force:true});}
});
