import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHexUnitCubeMesh,meshToLsdynaKeyword,parseMeshText} from '../dist/index.js';
const script=fileURLToPath(new URL('../scripts/refine-ogrid-macro-field.mjs',import.meta.url));
test('macro CLI preserves noncontiguous original node/far-field EIDs and inherited PID',async()=>{
  const root=await fs.mkdtemp(path.join(process.env.HEXREFINE_TEST_OUTPUT??os.tmpdir(),'macro-cli-'));
  try{
    const mesh=createHexUnitCubeMesh(2,2,8);mesh.nodes=mesh.nodes.map(p=>[2*p[0],2*p[1],8*p[2]]);
    const nodeIds=mesh.nodes.map((_,i)=>17+2*i),elementIds=mesh.elements.map((_,i)=>11+5*i),field=n=>String(n).padStart(8);
    let section='',ni=0,ei=0;
    const keyword=meshToLsdynaKeyword(mesh,{partId:7,coordinateFormat:'compact'}).trimEnd().split('\n').map(line=>{
      if(line.startsWith('*')){section=line;return line;}
      if(section==='*NODE')return field(nodeIds[ni++])+line.slice(8);
      return field(elementIds[ei])+field(7)+mesh.elements[ei++].map(n=>field(nodeIds[n-1])).join('');
    }).join('\n')+'\n';
    const targets=mesh.elements.flatMap((e,i)=>{const z=e.reduce((s,n)=>s+mesh.nodes[n-1][2],0)/8;return z>=3&&z<5?[{elementId:i+1,level:1}]:[];});
    const request={schemaVersion:1,kind:'ogrid-macro-field',meshFile:'source.k',options:{axis:2,targets:targets.map(t=>({...t,elementId:elementIds[t.elementId-1]})),transitionGeometry:'conservative-face-flux'}};
    const input=path.join(root,'request.json'),source=path.join(root,'source.k'),out=path.join(root,'result');
    await fs.writeFile(source,keyword);await fs.writeFile(input,JSON.stringify(request));
    const run=destination=>spawnSync(process.execPath,[script,input,destination],{cwd:root,encoding:'utf8'});
    let r=run(out);assert.equal(r.status,0,r.stderr);
    const data=await fs.readFile(path.join(out,'mesh.k'),'utf8'),lineage=JSON.parse(await fs.readFile(path.join(out,'lineage.json'))),report=JSON.parse(await fs.readFile(path.join(out,'report.json')));
    assert.equal(report.source.partId,7);assert.equal(report.targetIdSpace,'external');assert.equal(report.readback.allSourceNodeIdsPreserved,true);
    assert.equal(report.nativeTargetIdSpace,'ordinal');assert.deepEqual(report.requestedTargets,request.options.targets);
    assert.deepEqual(report.targets,targets);
    assert.deepEqual(lineage.outputExternalNodeIds.slice(0,nodeIds.length),nodeIds);
    for(let i=0;i<lineage.roles.length;i++)if(lineage.roles[i]==='unchanged')assert.equal(lineage.outputExternalElementIds[i],elementIds[lineage.sourceParentIds[i]-1]);
    else assert.ok(lineage.outputExternalElementIds[i]>Math.max(...elementIds));
    assert.equal(new Set(lineage.outputExternalElementIds).size,lineage.roles.length);
    const back=parseMeshText(data,'mesh.k');assert.equal(back.elements.length,136);
    r=run(out);assert.notEqual(r.status,0);assert.match(r.stderr,/overwrite/);assert.equal(await fs.readFile(path.join(out,'mesh.k'),'utf8'),data);
    r=spawnSync(process.execPath,[script,path.join(out,'request.json'),path.join(root,'replayed')],{cwd:root,encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);assert.equal(await fs.readFile(path.join(root,'replayed','mesh.k'),'utf8'),data);
    await fs.writeFile(input,JSON.stringify({...request,targetIdSpace:'ordinal',options:{...request.options,targets}}));
    r=run(path.join(root,'ordinal'));assert.equal(r.status,0,r.stderr);assert.equal(await fs.readFile(path.join(root,'ordinal','mesh.k'),'utf8'),data);
    const bad={...request,options:{...request.options,targets:[{elementId:999999,level:1}]}};
    await fs.writeFile(input,JSON.stringify(bad));r=run(path.join(root,'bad-id'));assert.notEqual(r.status,0);assert.match(r.stderr,/not found/);
    await assert.rejects(fs.stat(path.join(root,'bad-id')),{code:'ENOENT'});await fs.writeFile(input,JSON.stringify(request));
    const preload=path.join(root,'low-space.mjs');await fs.writeFile(preload,"import fs from 'node:fs/promises';fs.statfs=async()=>({bavail:0,bsize:4096});");
    r=spawnSync(process.execPath,['--import',pathToFileURL(preload).href,script,input,path.join(root,'low-space')],{cwd:root,encoding:'utf8'});
    assert.notEqual(r.status,0);assert.match(r.stderr,/Insufficient disk/);await assert.rejects(fs.stat(path.join(root,'low-space')),{code:'ENOENT'});
    await assert.rejects(fs.stat(path.join(out,'mesh.k.partial')),{code:'ENOENT'});
    await fs.writeFile(input,JSON.stringify({...request,options:{...request.options,minimumCornerScaledJacobian:.999}}));
    r=run(path.join(root,'quality-refusal'));assert.notEqual(r.status,0);
    const refusal=JSON.parse(r.stderr.trim());assert.equal(refusal.code,'requested-quality');
    assert.equal(refusal.diagnostics.requiredMinimumCornerSJ,.999);
    assert.ok(refusal.diagnostics.bestSampledShellSJ<.999);assert.equal(refusal.diagnostics.outputGenerated,false);
    await assert.rejects(fs.stat(path.join(root,'quality-refusal')),{code:'ENOENT'});
    await fs.writeFile(input,JSON.stringify(request));
    await fs.writeFile(source,keyword.replace('*END','*MAT_ELASTIC\n1,1,1\n*END'));
    r=run(path.join(root,'refused'));assert.notEqual(r.status,0);assert.match(r.stderr,/Mesh-only/);
    await assert.rejects(fs.stat(path.join(root,'refused')),{code:'ENOENT'});
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
