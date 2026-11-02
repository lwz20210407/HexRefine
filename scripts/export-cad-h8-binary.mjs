import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fixedInteger,fixedFloat} from '../dist/lsdyna-format-internal.js';

const root=path.resolve(process.argv[2]??'');
const meta=JSON.parse(fs.readFileSync(path.join(root,'mesh-binary.json'),'utf8'));
if(meta.schemaVersion!==1||!Number.isSafeInteger(meta.nodes)||!Number.isSafeInteger(meta.elements)||meta.nodes<8||meta.elements<1)throw new Error('Invalid H8 binary manifest');
const nodes=fs.readFileSync(path.join(root,'nodes.f64')),elements=fs.readFileSync(path.join(root,'elements.i32'));
if(nodes.length!==meta.nodes*24||elements.length!==meta.elements*32)throw new Error('Binary mesh length mismatch');
const target=path.join(root,'model.k');
if(fs.existsSync(target))throw new Error('Refusing to overwrite model.k');
const partial=path.join(root,'model.partial.k');
let fd=fs.openSync(partial,'wx');
const hash=createHash('sha256');
function write(text){fs.writeSync(fd,text);hash.update(text);}
try{
  write('*KEYWORD\n$ Mesh-only mapped from independent design STEP; units mm.\n*NODE\n');
  if(meta.inspectionOnly===true)write('$ INSPECTION SUBSET ONLY -- not a complete analysis model.\n');
  let lines=[];
  for(let i=0;i<meta.nodes;i++){
    lines.push(fixedInteger(i+1,8,'node')+[0,1,2].map(a=>fixedFloat(nodes.readDoubleLE(i*24+a*8),16,12,'compact')).join(''));
    if(lines.length===8192){write(lines.join('\n')+'\n');lines=[];}
  }
  if(lines.length)write(lines.join('\n')+'\n');
  write('*ELEMENT_SOLID\n');lines=[];
  for(let i=0;i<meta.elements;i++){
    const e=Array.from({length:8},(_,a)=>elements.readInt32LE(i*32+a*4));
    if(new Set(e).size!==8||e.some(n=>n<0||n>=meta.nodes))throw new Error('Invalid H8 binary connectivity');
    lines.push([i+1,1,...e.map(n=>n+1)].map(v=>fixedInteger(v,8,'solid')).join(''));
    if(lines.length===8192){write(lines.join('\n')+'\n');lines=[];}
  }
  if(lines.length)write(lines.join('\n')+'\n');
  write('*END\n');
  fs.closeSync(fd);fd=null;fs.renameSync(partial,target);
  console.log(JSON.stringify({kSHA256:hash.digest('hex'),nodes:meta.nodes,elements:meta.elements}));
}finally{if(fd!==null){fs.closeSync(fd);fs.unlinkSync(partial);}}
