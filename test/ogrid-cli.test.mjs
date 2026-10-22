import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHexUnitCubeMesh} from '../dist/index.js';

test('O-grid CLI enforces explicit face-local limits before export and rechecks keyword readback',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'hexrefine-ogrid-grading-'));
  try{
    const source=createHexUnitCubeMesh(2,2,8);source.nodes=source.nodes.map(([x,y,z])=>[x*2,y*2,z*8]);
    await fs.writeFile(path.join(folder,'source.json'),JSON.stringify(source));
    const request={schemaVersion:1,kind:'extruded-ogrid',meshFile:'source.json',options:{axis:2,bands:[{min:3,max:5,level:2}],completion:'none',transitionGeometry:'conservative-face-flux',maximumAdjacentNormalSizeRatio:1}};
    const input=path.join(folder,'request.json');await fs.writeFile(input,JSON.stringify(request));
    const script=fileURLToPath(new URL('../scripts/refine-ogrid.mjs',import.meta.url));
    const rejected=path.join(folder,'rejected'),bad=spawnSync(process.execPath,[script,input,rejected],{encoding:'utf8'});
    assert.equal(bad.status,1);assert.match(bad.stderr,/adjacent normal-size limit was not verified/);
    await assert.rejects(fs.access(rejected));
    request.options.maximumAdjacentNormalSizeRatio=100;await fs.writeFile(input,JSON.stringify(request));
    const accepted=path.join(folder,'accepted'),good=spawnSync(process.execPath,[script,input,accepted],{encoding:'utf8'});
    assert.equal(good.status,0,good.stderr);
    const report=JSON.parse(await fs.readFile(path.join(accepted,'report.json'),'utf8'));
    assert.equal(report.quality.adjacencyGrading.requestedLimitVerified,true);
    assert.equal(report.readbackAdjacencyGrading.requestedLimitVerified,true);
    assert.equal(report.readbackAdjacencyGrading.requestedNormalSizeLimit,100);
    assert.equal(report.quality.engineeringAcceptanceVerified,false);
    assert.ok(Math.abs(report.quality.adjacencyGrading.maximumNormalSizeRatio-report.readbackAdjacencyGrading.maximumNormalSizeRatio)<1e-10);
  }finally{
    const root=path.resolve(os.tmpdir())+path.sep;
    assert.ok(path.resolve(folder).startsWith(root));
    await fs.rm(folder,{recursive:true,force:true});
  }
});
