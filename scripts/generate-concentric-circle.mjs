import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import {once} from 'node:events';
import {finished} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {prepareConcentricCircularMesh,iterateConcentricCircularNodes,iterateConcentricCircularElements,
  meshToLsdynaKeyword} from '../dist/index.js';
import {fixedFloat,fixedInteger} from '../dist/lsdyna-format-internal.js';

function progress(stage,completed,total){
  if(process.env.HEXREFINE_PROGRESS_JSONL==='1')console.error(JSON.stringify({schemaVersion:1,type:'progress',stage,
    ...(completed===undefined?{}:{completed,total})}));
}

async function main(){
  const [input,output,...extra]=process.argv.slice(2);
  if(!input||!output||extra.length)throw new Error('Usage: node scripts/generate-concentric-circle.mjs request.json NEW_OUTPUT_DIRECTORY');
  const out=path.resolve(output),parent=path.dirname(out);
  try{await fsp.lstat(out);throw new Error('Output already exists; refusing to overwrite');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!(await fsp.stat(parent)).isDirectory())throw new Error('Output parent must be an existing directory');
  if((await fsp.stat(input)).size>65536)throw new Error('Concentric request exceeds64KiB');
  const request=JSON.parse(await fsp.readFile(input,'utf8'));
  if(!request||typeof request!=='object'||Array.isArray(request)||request.schemaVersion!==1
    ||Object.keys(request).some(k=>!['schemaVersion','parameters'].includes(k)))throw new Error('Unsupported concentric request schema');
  progress('prepare');
  const p=prepareConcentricCircularMesh(request.parameters);
  progress('audit-complete',p.counts.elements,p.counts.elements);
  const minimumEdge=Math.min(...Object.values(p.quality.regions).map(r=>r.minimumEdge));
  const estimatedBytes=p.counts.nodes*57+p.counts.elements*81+512;
  const disk=await fsp.statfs(parent);
  if(disk.bavail*disk.bsize<estimatedBytes+1024**3)throw new Error('Insufficient free disk including1GiB reserve');
  await fsp.mkdir(out);
  const partial=path.join(out,'mesh.k.partial'),stream=fs.createWriteStream(partial,{flags:'wx',highWaterMark:4*1024**2});
  let buffer='*KEYWORD\n$ Native concentric circular mesh; geometry only. Units follow input.\n*NODE\n',bytes=0,failure;
  stream.on('error',e=>{failure=e;});
  async function flush(){if(failure)throw failure;if(!buffer)return;const text=buffer;buffer='';bytes+=Buffer.byteLength(text);if(!stream.write(text))await once(stream,'drain');}
  let nodes=0,elements=0;
  try{
    progress('nodes',0,p.counts.nodes);
    for(const point of iterateConcentricCircularNodes(p)){
      const xyz=point.map(v=>fixedFloat(v,16,12,'compact'));
      if(xyz.some((s,i)=>!Number.isFinite(Number(s))||Math.abs(Number(s)-point[i])>minimumEdge*1e-8))throw new Error('K coordinate precision is insufficient');
      buffer+=fixedInteger(++nodes,8,'node ID')+xyz.join('')+'\n';if(buffer.length>1024**2)await flush();
      if(nodes%8192===0)progress('nodes',nodes,p.counts.nodes);
    }
    progress('nodes',nodes,p.counts.nodes);progress('elements',0,p.counts.elements);
    buffer+='*ELEMENT_SOLID\n';
    for(const e of iterateConcentricCircularElements(p)){
      buffer+=fixedInteger(++elements,8,'element ID')+'       1'+e.map(id=>fixedInteger(id,8,'node ID')).join('')+'\n';
      if(buffer.length>1024**2)await flush();
      if(elements%8192===0)progress('elements',elements,p.counts.elements);
    }
    progress('elements',elements,p.counts.elements);
    buffer+='*END\n';await flush();stream.end();await finished(stream);
  }catch(e){stream.destroy();throw e;}
  if(nodes!==p.counts.nodes||elements!==p.counts.elements||(await fsp.stat(partial)).size!==bytes)throw new Error('Stream count/byte mismatch');
  // Full fixed-field readback against fresh iterators, without loading a large K in RAM.
  const reader=fs.createReadStream(partial),hash=createHash('sha256');reader.on('data',chunk=>hash.update(chunk));
  const lines=readline.createInterface({input:reader,crlfDelay:Infinity}),np=iterateConcentricCircularNodes(p),ep=iterateConcentricCircularElements(p);
  let state='',n=0,c=0,ended=false,maximumCoordinateError=0;
  progress('readback',0,nodes+elements);
  for await(const line of lines){
    if(line.startsWith('$')||!line.trim())continue;
    if(line==='*KEYWORD'){if(state)throw new Error('Unexpected K header');state='header';continue;}
    if(line==='*NODE'){if(state!=='header')throw new Error('Unexpected NODE section');state='nodes';continue;}
    if(line==='*ELEMENT_SOLID'){if(state!=='nodes'||n!==nodes)throw new Error('Missing node records');state='elements';continue;}
    if(line==='*END'){if(state!=='elements'||c!==elements)throw new Error('Missing element records');state='end';ended=true;continue;}
    if(state==='nodes'){
      const next=np.next();if(next.done||line.length!==56||Number(line.slice(0,8))!==++n)throw new Error('Invalid K node record');
      for(let a=0;a<3;a++){const x=Number(line.slice(8+16*a,24+16*a));if(!Number.isFinite(x))throw new Error('Invalid K coordinate');maximumCoordinateError=Math.max(maximumCoordinateError,Math.abs(x-next.value[a]));}
    }else if(state==='elements'){
      const next=ep.next();if(next.done||line.length!==80||Number(line.slice(0,8))!==++c||Number(line.slice(8,16))!==1)throw new Error('Invalid K element record');
      for(let a=0;a<8;a++)if(Number(line.slice(16+8*a,24+8*a))!==next.value[a])throw new Error('K connectivity readback mismatch');
    }else throw new Error('Unexpected K record');
    if((n+c)%8192===0)progress('readback',n+c,nodes+elements);
  }
  if(!ended||!np.next().done||!ep.next().done||maximumCoordinateError>minimumEdge*1e-8)throw new Error('Incomplete or imprecise K readback');
  progress('readback',n+c,nodes+elements);
  const sha256=hash.digest('hex');
  await fsp.writeFile(path.join(out,'motif.k'),meshToLsdynaKeyword(p.motif,{coordinateFormat:'compact'}),{flag:'wx'});
  const report={schemaVersion:1,generator:'concentric-circular',request,plan:p.plan,counts:p.counts,quality:p.quality,
    motif:{nodes:p.motif.nodes.length,elements:p.motif.elements.length,regions:p.regions},
    coreSection:planCore(p),readback:{allRecordsVerified:true,nodes:n,elements:c,maximumCoordinateError,bytes,sha256},
    scope:'Native coupled2:1 concentric bands. NODE+SOLID only; no materials, loads, contacts or inferred solver BCs. No GUI or arbitrary imported-mesh installation implied.'};
  await fsp.rename(partial,path.join(out,'mesh.k'));
  await fsp.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
  progress('complete',nodes+elements,nodes+elements);
  console.log(JSON.stringify({ok:true,output:out,...p.counts,minimumCornerSJ:p.quality.minimumCornerScaledJacobian,sha256}));
}
function planCore(p){return {...p.plan.core,axialSpacing:p.plan.fineAxialSpacing,fullHeightElements:p.plan.expectedCoreElements};}
main().catch(e=>{console.error(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;});
