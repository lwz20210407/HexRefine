import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fixedInteger,fixedFloat} from '../dist/lsdyna-format-internal.js';

const root=path.resolve(process.argv[2]??'');
const meta=JSON.parse(fs.readFileSync(path.join(root,'mesh-binary.json'),'utf8'));
if(!meta||typeof meta!=='object'||Array.isArray(meta)||meta.schemaVersion!==1||!Number.isSafeInteger(meta.nodes)||!Number.isSafeInteger(meta.elements)||meta.nodes<8||meta.elements<1)throw new Error('Invalid H8 binary manifest');
for(const option of ['readback','inspectionOnly','developmentOnly']){
  if(meta[option]!==undefined&&typeof meta[option]!=='boolean')throw new Error(`${option} must be boolean`);
}
if(meta.readback===true&&meta.elements>200000)throw new Error('Native K readback is bounded to 200000 H8');
const reference=meta.geometryReference??'independent-step';
if(!['independent-step','analytic-thread-field'].includes(reference))throw new Error('Unsupported geometry reference');
const nodes=fs.readFileSync(path.join(root,'nodes.f64')),elements=fs.readFileSync(path.join(root,'elements.i32'));
if(nodes.length!==meta.nodes*24||elements.length!==meta.elements*32)throw new Error('Binary mesh length mismatch');
const target=path.join(root,'model.k');
if(fs.existsSync(target))throw new Error('Refusing to overwrite model.k');
const partial=path.join(root,'model.partial.k');
let fd=null,owned,published=false,completed=false;
const hash=createHash('sha256');
function owns(file){
  if(!owned)return false;
  try{
    const stat=fs.lstatSync(file,{bigint:true});
    return stat.isFile()&&stat.dev===owned.dev&&stat.ino===owned.ino;
  }catch(error){if(error.code==='ENOENT')return false;throw error;}
}
function write(text){
  const buffer=Buffer.from(text);
  let offset=0;
  while(offset<buffer.length){
    const written=fs.writeSync(fd,buffer,offset,buffer.length-offset);
    if(!Number.isInteger(written)||written<=0||written>buffer.length-offset)throw new Error('Incomplete native K write');
    offset+=written;
  }
  hash.update(buffer);
}
try{
  fd=fs.openSync(partial,'wx');owned=fs.fstatSync(fd,{bigint:true});
  const provenance=reference==='analytic-thread-field'
    ?'$ Mesh-only helical thread band; continuous radius field, not independent CAD; units mm.'
    :'$ Mesh-only mapped from independent design STEP; units mm.';
  write('*KEYWORD\n'+provenance+'\n*NODE\n');
  if(meta.inspectionOnly===true)write('$ INSPECTION SUBSET ONLY -- not a complete analysis model.\n');
  if(meta.developmentOnly===true)write('$ DEVELOPMENT TEST ONLY -- not production acceptance.\n');
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
  fs.closeSync(fd);fd=null;
  if(!owns(partial))throw new Error('Native K temporary file ownership changed');
  const kSHA256=hash.digest('hex');
  let nativeReadback;
  if(meta.readback===true){
    const {parseNativeLsdynaMixedKeyword}=await import('../dist/lsdyna-mixed.js');
    const keyword=fs.readFileSync(partial,'utf8');
    const read=parseNativeLsdynaMixedKeyword(keyword);
    if(read.nodes.length!==meta.nodes||read.solids.length!==meta.elements||read.beams.length)throw new Error('Native K readback counts differ');
    let error=0;
    for(let i=0;i<meta.nodes;i++)for(let a=0;a<3;a++)error=Math.max(error,Math.abs(read.nodes[i][a]-nodes.readDoubleLE(i*24+a*8)));
    if(error>1e-10)throw new Error('Native K readback coordinates differ');
    for(let i=0;i<meta.elements;i++){
      const solid=read.solids[i];
      if(solid.id!==i+1||solid.partId!==1||solid.nodes.some((n,a)=>n!==elements.readInt32LE(i*32+a*4)+1))throw new Error('Native K readback connectivity differs');
    }
    if(createHash('sha256').update(keyword).digest('hex')!==kSHA256)throw new Error('Native K readback bytes differ');
    nativeReadback={nodes:read.nodes.length,elements:read.solids.length,maximumCoordinateDifference:error};
  }
  if(!owns(partial))throw new Error('Native K temporary file ownership changed');
  // Same-directory hard linking publishes exclusively, without a rename overwrite race.
  fs.linkSync(partial,target);published=true;
  if(owns(partial))fs.unlinkSync(partial);
  console.log(JSON.stringify({kSHA256,nodes:meta.nodes,elements:meta.elements,...(nativeReadback?{nativeReadback}:{})}));
  completed=true;
}finally{
  if(fd!==null)fs.closeSync(fd);
  if(!completed&&published&&owns(target))fs.unlinkSync(target);
  if(owns(partial))fs.unlinkSync(partial);
}
