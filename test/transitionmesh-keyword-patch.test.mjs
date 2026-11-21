import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createHexUnitCubeMesh} from '../dist/grid.js';
import {meshToLsdynaKeyword} from '../dist/export.js';
import {parseLsdynaKeywordMesh} from '../dist/mesh-io.js';
import {patchTransitionMeshKeyword} from '../dist/transitionmesh-keyword-patch.js';
import {generateTransitionMeshV11Request} from '../dist/transitionmesh-v11-request.js';

const mesh = createHexUnitCubeMesh(2,1,1);
const write = m => meshToLsdynaKeyword(m,{coordinateFormat:'compact'});
const source = write(mesh);
const first = {...mesh,nodes:mesh.elements[0].map(n=>mesh.nodes[n-1]),elements:[[1,2,3,4,5,6,7,8]]};
const keep = source.split('\n').at(-3);

function withSets(deck, solid, node) {
  return deck.replace('*END',`*SET_NODE_LIST\n41,0,0,0,0\n${node}\n*SET_SOLID_LIST\n43,0,0,0,0\n${solid}\n*END`);
}

const shell=[[1,2,3,4],[5,8,7,6],[1,5,6,2],[2,6,7,3],[3,7,8,4],[4,8,5,1]];
const nested = {...first,
  nodes:[...first.nodes,...first.nodes.map(p=>p.map((v,a)=>(v+[.25,.5,.5][a])/2))],
  elements:[[9,10,11,12,13,14,15,16],...shell.map(f=>[...f,...f.map(j=>j+8)])]};

test('patch preserves retained keyword records, external IDs and sets while replacing one H8 with seven',()=>{
  const host = withSets(source,2,mesh.elements[0][0]);
  const result = patchTransitionMeshKeyword(host,write(nested),[1]);
  assert.equal(result.report.preservedElements,1);
  assert.equal(result.report.sharedFaces,1);
  assert.equal(result.report.lockedBoundaryFaces,6);
  assert.equal(result.report.newNodes,8);
  assert.deepEqual(result.report.newElementIds,[3,4,5,6,7,8,9]);
  assert.ok(result.report.minimumCornerScaledJacobian>0);
  assert.ok(result.report.minimumGaussDeterminant>0);
  assert.ok(result.report.relativeVolumeError<1e-12);
  assert.ok(result.keyword.includes(keep));
  assert.ok(result.keyword.includes(host.slice(host.indexOf('*SET_NODE_LIST'),host.indexOf('*END'))));
  assert.equal(parseLsdynaKeywordMesh(result.keyword).elements.length,8);
});

test('reject references to deleted elements, unmatched boundary, and unsupported solver cards',()=>{
  assert.throws(()=>patchTransitionMeshKeyword(withSets(source,1,1),write(nested),[1]),/solid set/);
  const shifted={...first,nodes:first.nodes.map(([x,y,z])=>[x+.01,y,z])};
  assert.throws(()=>patchTransitionMeshKeyword(source,write(shifted),[1]),/cavity node/);
  assert.throws(()=>patchTransitionMeshKeyword(source.replace('*END','*INCLUDE\ninput.k\n*END'),
    write(nested),[1]),/unsupported card \*INCLUDE/);
  assert.throws(()=>patchTransitionMeshKeyword(source,write(nested),[1,2]),/proper subset/);
});

test('oriented candidate boundary discovers a multi-cell patch without touching either neighbor',()=>{
  const host=createHexUnitCubeMesh(4,1,1);
  const meshCells=host.elements.slice(1,3);
  const ids=[...new Set(meshCells.flat())];
  const local=new Map(ids.map((n,i)=>[n,i+1]));
  const candidate={...host,nodes:ids.map(i=>host.nodes[i-1]),elements:meshCells.map(c=>c.map(i=>local.get(i)))};
  const text=withSets(write(host),4,host.elements[1][0]);
  const result=patchTransitionMeshKeyword(text,write(candidate),'auto');
  assert.equal(result.report.selectionMode,'boundary');
  assert.deepEqual(result.report.removedElementIds,[2,3]);
  assert.equal(result.report.lockedBoundaryFaces,10);
  assert.equal(result.report.sharedFaces,2);
  assert.equal(result.keyword,patchTransitionMeshKeyword(text,write(candidate),[2,3]).keyword);
});

test('automatic selection rejects ambiguous coordinates, wrong orientation and whole-mesh replacements',()=>{
  const duplicate=source.replace('*ELEMENT_SOLID',`999,${first.nodes[0].join(',')}\n*ELEMENT_SOLID`);
  assert.throws(()=>patchTransitionMeshKeyword(duplicate,write(first),'auto'),/uniquely match/);
  const shifted={...first,nodes:first.nodes.map(([x,y,z])=>[x+1e-12,y,z])};
  assert.throws(()=>patchTransitionMeshKeyword(source,write(shifted),'auto'),/uniquely match/);
  const inverted={...first,elements:[[4,3,2,1,8,7,6,5]]};
  assert.throws(()=>patchTransitionMeshKeyword(source,write(inverted),'auto'),/interior side/);
  assert.throws(()=>patchTransitionMeshKeyword(source,source,'auto'),/proper subset/);
  assert.throws(()=>patchTransitionMeshKeyword(withSets(source,1,1),write(nested),'auto'),/solid set/);
});

test('CLI can preview and install directly from a V1.1 H8 request',async()=>{
  const base=path.resolve(os.tmpdir());
  const dir=await fs.mkdtemp(path.join(base,'transition-auto-'));
  try {
    const cli=fileURLToPath(new URL('../scripts/patch-transitionmesh.mjs',import.meta.url));
    const candidate={schemaVersion:1,kind:'transitionmesh-v11',mode:'PLANAR',
      parameters:{length:4,depth:1,fineSegments:8,ratios:[2]},extrusion:{height:1,layers:1}};
    const host=generateTransitionMeshV11Request({...candidate,
      regularRegions:{fine:{width:1,layers:1},coarse:{width:1,layers:1}}}).files['mesh.k'];
    const hostHash=createHash('sha256').update(host).digest('hex');
    const put=async (name,text)=>fs.writeFile(path.join(dir,name),text);
    await put('host.k',host);
    await put('candidate.json',JSON.stringify(candidate));
    const request={schemaVersion:1,autoSelect:true,expectedHostSha256:hostHash};
    await put('selection.json',JSON.stringify(request));
    const run=pathOrPreview=>spawnSync(process.execPath,
      [cli,'host.k','candidate.json','selection.json',pathOrPreview],{cwd:dir,encoding:'utf8'});
    const draft=run('--preview');
    assert.equal(draft.status,0,draft.stderr);
    const preview=JSON.parse(draft.stdout);
    assert.equal(preview.preview,true);
    assert.equal(preview.candidateSource,'transitionmesh-v11');
    assert.equal(preview.sharedFaces,12);
    assert.equal(preview.removedElementIds.length,12);
    assert.deepEqual((await fs.readdir(dir)).sort(),['candidate.json','host.k','selection.json']);
    const result=run('output');
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).removedElementIds,preview.removedElementIds);
    await put('selection.json',JSON.stringify({...request,expectedHostSha256:'0'.repeat(64)}));
    const stale=run('stale-output');
    assert.notEqual(stale.status,0);
    assert.match(stale.stderr,/SHA-256/);
    await assert.rejects(fs.stat(path.join(dir,'stale-output')),{code:'ENOENT'});
  } finally {
    assert.equal(path.dirname(dir),base);
    await fs.rm(dir,{recursive:true,force:true});
  }
});
