import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import test from 'node:test';

const script=fileURLToPath(new URL('../scripts/export-cad-h8-binary.mjs',import.meta.url));
const points=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];

// Faults change real files/syscalls in an isolated child; the dist parser is never mocked.
const preload=String.raw`
import fs from 'node:fs';
import path from 'node:path';
import {registerHooks} from 'node:module';
const root=process.env.CAD_H8_ROOT,mode=process.env.CAD_H8_FAULT;
const read=fs.readFileSync,write=fs.writeSync,link=fs.linkSync;
registerHooks({resolve(specifier,context,next){
  if(specifier.endsWith('/lsdyna-mixed.js')){
    fs.appendFileSync(path.join(root,'parser-loads.txt'),'loaded\n');
    if(mode==='forbid-parser')throw new Error('default path loaded parser');
  }
  return next(specifier,context);
}});
let changed=false,writes=0;
fs.readFileSync=function(file,...args){
  if(path.basename(String(file))==='model.partial.k'){
    fs.appendFileSync(path.join(root,'partial-reads.txt'),'read\n');
    if(mode==='forbid-parser')throw new Error('default path read K');
    if(!changed){
      changed=true;
      let text=read.call(fs,file,'utf8'),lines=text.split('\n');
      const ni=lines.findIndex(l=>l==='*NODE')+1;
      const ei=lines.findIndex(l=>l==='*ELEMENT_SOLID')+1;
      const field=(line,index,width,value)=>line.slice(0,index)+String(value).padStart(width)+line.slice(index+width);
      if(mode==='node-id')lines[ni]=field(lines[ni],0,8,2);
      if(mode==='coordinate')lines[ni]=field(lines[ni],8,16,.25);
      if(mode==='pid')lines[ei]=field(lines[ei],8,8,2);
      if(mode==='element-id')lines[ei]=field(lines[ei],0,8,2);
      if(mode==='connectivity')lines[ei]=field(field(lines[ei],16,8,2),24,8,1);
      if(mode==='nonfinite')lines[ni]=field(lines[ni],8,16,'NaN');
      if(mode==='missing-node')lines.splice(ni+7,1);
      if(mode==='missing-solid')lines.splice(ei,1);
      if(mode==='extra-beam')lines.splice(-2,0,'*ELEMENT_BEAM',
        [2,1,1,2,3,0,0,0,0,2].map(v=>String(v).padStart(8)).join(''));
      if(mode==='solver-card')lines.splice(-2,0,'*PART');
      if(mode==='comment')lines.splice(-2,0,'$ changed after writing');
      if(mode==='replace-partial'){
        fs.renameSync(file,path.join(root,'moved-partial.k'));
        fs.writeFileSync(file,'FOREIGN PARTIAL: retain me');
      }else if(['node-id','coordinate','pid','element-id','connectivity','nonfinite',
               'missing-node','missing-solid','extra-beam','solver-card','comment'].includes(mode)){
        fs.writeFileSync(file,lines.join('\n'));
      }
    }
  }
  return read.call(fs,file,...args);
};
fs.writeSync=function(fd,buffer,offset,length,...args){
  writes++;
  if(mode==='write-failure'&&writes===2)throw new Error('injected write failure');
  if(mode==='zero-write')return 0;
  if(mode==='short-write')return write.call(fs,fd,buffer,offset,Math.max(1,Math.floor(length/2)),...args);
  return write.call(fs,fd,buffer,offset,length,...args);
};
fs.linkSync=function(src,dst,...args){
  if(mode==='race-target')fs.writeFileSync(dst,'FOREIGN TARGET: retain me',{flag:'wx'});
  if(mode==='publish-failure')throw new Error('injected publication failure');
  return link.call(fs,src,dst,...args);
};
`;

async function fixture(t,meta={}){
  const root=await fs.mkdtemp(path.join(process.env.BOLTHEX_TEST_ROOT??os.tmpdir(),'cad-readback-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const n=Buffer.alloc(192),e=Buffer.alloc(32);
  points.forEach((p,i)=>p.forEach((x,a)=>n.writeDoubleLE(x,i*24+a*8)));
  for(let i=0;i<8;i++)e.writeInt32LE(i,i*4);
  await fs.writeFile(path.join(root,'nodes.f64'),n);
  await fs.writeFile(path.join(root,'elements.i32'),e);
  await fs.writeFile(path.join(root,'preload.mjs'),preload);
  const manifest={schemaVersion:1,nodes:8,elements:1,...meta};
  await fs.writeFile(path.join(root,'mesh-binary.json'),JSON.stringify(manifest));
  return {root,manifest,n,e};
}

function run(root,mode='',flags=[]){
  return spawnSync(process.execPath,[...flags,'--import',pathToFileURL(path.join(root,'preload.mjs')).href,script,root],{
    cwd:root,encoding:'utf8',timeout:60000,
    env:{...process.env,TEMP:root,TMP:root,CAD_H8_ROOT:root,CAD_H8_FAULT:mode},
  });
}

async function missing(root,file){
  await assert.rejects(fs.stat(path.join(root,file)),{code:'ENOENT'});
}

async function rejected(root,result){
  assert.ifError(result.error);
  assert.notEqual(result.status,0,result.stdout);
  assert.equal(result.stdout,'');
  await missing(root,'model.k');await missing(root,'model.partial.k');
}

test('readback true reads real K coordinates, IDs/PID/connectivity and binds published SHA',async t=>{
  const {root}=await fixture(t,{readback:true});
  const result=run(root);
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(result.stdout),keyword=await fs.readFile(path.join(root,'model.k'));
  assert.deepEqual(report.nativeReadback,{nodes:8,elements:1,maximumCoordinateDifference:0});
  assert.equal(report.kSHA256,createHash('sha256').update(keyword).digest('hex'));
  assert.match(await fs.readFile(path.join(root,'parser-loads.txt'),'utf8'),/loaded/);
  assert.match(await fs.readFile(path.join(root,'partial-reads.txt'),'utf8'),/read/);
  await missing(root,'model.partial.k');
});

for(const [fault,expected] of [
  ['node-id',/NODE IDs/],['coordinate',/coordinates differ/],['pid',/connectivity differs/],
  ['element-id',/connectivity differs/],['connectivity',/connectivity differs/],
  ['nonfinite',/numeric field/],['missing-node',/invalid node|counts differ/],
  ['missing-solid',/requires nodes and solid/],['extra-beam',/counts differ/],
  ['solver-card',/unsupported mixed keyword/],['comment',/bytes differ/],
]){
  test(`readback rejects actual serialized ${fault} corruption without publishing`,async t=>{
    const {root}=await fixture(t,{readback:true});
    const result=run(root,fault);
    await rejected(root,result);assert.match(result.stderr,expected);
  });
}

test('readback rejects real formatter precision loss beyond unchanged absolute 1e-10',async t=>{
  const {root,n}=await fixture(t,{readback:true});
  n.writeDoubleLE(123456789012345.67,0);
  await fs.writeFile(path.join(root,'nodes.f64'),n);
  const result=run(root);await rejected(root,result);
  assert.match(result.stderr,/coordinates differ/);
});

test('failure leaves a pre-existing partial file untouched',async t=>{
  const {root}=await fixture(t,{readback:true});
  const previous=Buffer.from('OLD PARTIAL: retain me');
  await fs.writeFile(path.join(root,'model.partial.k'),previous);
  const result=run(root);
  assert.notEqual(result.status,0);assert.match(result.stderr,/EEXIST/);
  assert.deepEqual(await fs.readFile(path.join(root,'model.partial.k')),previous);
  await missing(root,'model.k');
});

test('failure leaves a pre-existing model untouched',async t=>{
  const {root}=await fixture(t,{readback:true});
  const previous=Buffer.from('OLD MODEL: retain me');
  await fs.writeFile(path.join(root,'model.k'),previous);
  const result=run(root);
  assert.notEqual(result.status,0);assert.match(result.stderr,/overwrite/);
  assert.deepEqual(await fs.readFile(path.join(root,'model.k')),previous);
  await missing(root,'model.partial.k');
});

test('exclusive publication does not overwrite a model appearing after validation',async t=>{
  const {root}=await fixture(t,{readback:true});
  const result=run(root,'race-target');
  assert.notEqual(result.status,0);assert.match(result.stderr,/EEXIST/);
  assert.equal(await fs.readFile(path.join(root,'model.k'),'utf8'),'FOREIGN TARGET: retain me');
  await missing(root,'model.partial.k');
});

test('failed readback does not delete a replacement partial owned by another writer',async t=>{
  const {root}=await fixture(t,{readback:true});
  const result=run(root,'replace-partial');
  assert.notEqual(result.status,0);
  assert.equal(await fs.readFile(path.join(root,'model.partial.k'),'utf8'),'FOREIGN PARTIAL: retain me');
  await missing(root,'model.k');
});

for(const fault of ['write-failure','zero-write','publish-failure']){
  test(`${fault} cleans only this invocation's partial and publishes no K`,async t=>{
    const {root}=await fixture(t,{readback:true});const result=run(root,fault);
    await rejected(root,result);
    assert.match(result.stderr,fault==='write-failure'?/injected write failure/:
      fault==='zero-write'?/Incomplete native K write/:/injected publication failure/);
  });
}

test('short synchronous writes are completed before real readback',async t=>{
  const {root}=await fixture(t,{readback:true});
  const result=run(root,'short-write');assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(result.stdout);
  assert.equal(report.nativeReadback.maximumCoordinateDifference,0);
  assert.equal(report.kSHA256,createHash('sha256').update(await fs.readFile(path.join(root,'model.k'))).digest('hex'));
});

test('all optional boolean fields reject ambiguous values before creating output',async t=>{
  for(const option of ['readback','inspectionOnly','developmentOnly']){
    for(const value of [null,0,1,'true','false',[],{}]){
      await t.test(`${option}=${JSON.stringify(value)}`,async sub=>{
        const {root}=await fixture(sub,{[option]:value});const result=run(root);
        await rejected(root,result);assert.match(result.stderr,new RegExp(`${option} must be boolean`));
      });
    }
  }
});

test('true readback has an inclusive 200000-H8 preflight limit',async t=>{
  for(const elements of [200000,200001]){
    const {root}=await fixture(t,{elements,readback:true});
    await fs.unlink(path.join(root,'nodes.f64'));
    const result=run(root);await rejected(root,result);
    // Missing input proves the 200000 boundary passes the guard, not mesh acceptance.
    assert.match(result.stderr,elements===200000?/ENOENT/:/bounded to 200000/);
  }
});

test('omitted and false readback never load the parser or read the emitted K',async t=>{
  for(const meta of [{},{readback:false,inspectionOnly:false,developmentOnly:false}]){
    const {root}=await fixture(t,meta);
    const result=run(root,'forbid-parser');assert.equal(result.status,0,result.stderr);
    assert.equal(JSON.parse(result.stdout).nativeReadback,undefined);
    await missing(root,'parser-loads.txt');await missing(root,'partial-reads.txt');
  }
});

test('default over-200k streaming path runs under a 64 MiB JS heap without parsing',async t=>{
  const elements=200001,{root,e}=await fixture(t,{elements});
  // Repeated records exercise streaming/count policy only, not full-mesh validity.
  const records=Buffer.alloc(elements*32);
  for(let i=0;i<elements;i++)e.copy(records,i*32);
  await fs.writeFile(path.join(root,'elements.i32'),records);
  const result=run(root,'forbid-parser',['--max-old-space-size=64']);
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).elements,elements);
  assert.equal(JSON.parse(result.stdout).nativeReadback,undefined);
  assert.ok((await fs.stat(path.join(root,'model.k'))).size>16_000_000);
  await missing(root,'parser-loads.txt');await missing(root,'partial-reads.txt');
});
