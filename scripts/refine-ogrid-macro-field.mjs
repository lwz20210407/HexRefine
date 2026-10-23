import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseMeshText,refineOgridMacroField,iterateLsdynaKeywordLines,minElementEdgeLength} from '../dist/index.js';
import {fixedInteger} from '../dist/lsdyna-format-internal.js';

function identities(text){
  const nodeIds=[],elementIds=[],pids=[];let section='';
  const integer=x=>/^\+?\d+$/.test(x)&&Number.isSafeInteger(Number(x))&&Number(x)>0;
  for(const raw of text.split(/\r?\n/)){
    const line=raw.split('$')[0];if(!line.trim())continue;
    if(line.trim().startsWith('*')){section=line.trim().toUpperCase();if(!['*KEYWORD','*TITLE','*NODE','*ELEMENT_SOLID','*END'].includes(section))throw new Error('Mesh-only input required; unsupported keyword '+section);continue;}
    if(section==='*TITLE')continue;
    if(section==='*NODE'){
      const fields=line.includes(',')?line.split(',').map(s=>s.trim()):line.length>=56?[line.slice(0,8).trim(),line.slice(8,24).trim(),line.slice(24,40).trim(),line.slice(40,56).trim(),...line.slice(56).trim().split(/\s+/).filter(Boolean)]:line.trim().split(/\s+/);
      if(!integer(fields[0]??'')||fields.slice(4).some(v=>Number(v)!==0))throw new Error('Source NODE IDs/constraint flags are outside the mesh-only contract');
      nodeIds.push(Number(fields[0]));
    }else if(section==='*ELEMENT_SOLID'){
      let fields=line.includes(',')?line.split(',').map(s=>s.trim()):(line.trimEnd().match(/.{1,8}/g)??[]).map(s=>s.trim());
      if(fields.length!==10||!fields.every(integer))fields=line.trim().split(/\s+/);
      if(fields.length!==10||!fields.every(integer))throw new Error('Macro CLI requires single-record eight-node solid connectivity');
      elementIds.push(Number(fields[0]));pids.push(Number(fields[1]));
    }else throw new Error('Unexpected data outside a mesh keyword');
  }
  if(!nodeIds.length||!elementIds.length||new Set(nodeIds).size!==nodeIds.length||new Set(elementIds).size!==elementIds.length||new Set(pids).size!==1)throw new Error('Source must have unique node/EIDs and one explicit specimen PID');
  return {nodeIds,elementIds,partId:pids[0]};
}
async function main(){
  const [input,destination,...extra]=process.argv.slice(2);
  if(!input||!destination||extra.length)throw new Error('Usage: node scripts/refine-ogrid-macro-field.mjs request.json NEW_OUTPUT_DIRECTORY');
  const out=path.resolve(destination);try{await fs.lstat(out);throw new Error('Output already exists; refusing to overwrite');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!(await fs.stat(path.dirname(out))).isDirectory())throw new Error('Output parent must exist');
  if((await fs.stat(input)).size>16*1024**2)throw new Error('Macro request exceeds16MiB');
  const request=JSON.parse(await fs.readFile(input,'utf8'));
  if(!request||request.schemaVersion!==1||request.kind!=='ogrid-macro-field'||typeof request.meshFile!=='string'||Object.keys(request).some(k=>!['schemaVersion','kind','meshFile','options','targetIdSpace'].includes(k)))throw new Error('Unsupported macro-field request');
  const targetIdSpace=request.targetIdSpace??'external';
  if(!['external','ordinal'].includes(targetIdSpace))throw new Error('targetIdSpace must be external or ordinal');
  const sourcePath=path.resolve(path.dirname(path.resolve(input)),request.meshFile);
  if((await fs.stat(sourcePath)).size>256*1024**2)throw new Error('Source mesh exceeds256MiB');
  const text=await fs.readFile(sourcePath,'utf8'),source=identities(text),mesh=parseMeshText(text,sourcePath);
  if(mesh.nodes.length!==source.nodeIds.length||mesh.elements.length!==source.elementIds.length)throw new Error('Source identity order does not match mesh import');
  if(!Array.isArray(request.options?.targets))throw new Error('Explicit target records are required');
  const index=new Map(source.elementIds.map((id,i)=>[id,i+1]));
  const options={...request.options,targets:request.options.targets.map(t=>{
    const id=targetIdSpace==='external'?index.get(t?.elementId):t?.elementId;
    if(id===undefined)throw new Error('Target external element ID was not found in the source mesh');
    return {...t,elementId:id};
  })};
  let result;
  try{result=refineOgridMacroField(mesh,options);}catch(e){
    e.sourceExternalParentIds=(e.parentIds??[]).map(id=>source.elementIds[id-1]??null);
    e.sourceExternalFaceNodeIds=(e.faceNodeIds??[]).map(id=>source.nodeIds[id-1]??null);throw e;
  }
  const maximum=ids=>ids.reduce((m,n)=>Math.max(m,n),0);
  const nextNode=maximum(source.nodeIds)+1,nextElement=maximum(source.elementIds)+1;
  const nodes=Array.from({length:result.mesh.nodes.length},(_,i)=>source.nodeIds[i]??nextNode+i-source.nodeIds.length);
  let created=0;const elements=result.sourceParentIds.map((p,i)=>result.roles[i]==='unchanged'?source.elementIds[p-1]:nextElement+created++);
  fixedInteger(maximum(nodes),8,'node ID');fixedInteger(maximum(elements),8,'element ID');
  let state='',ni=0,ei=0;const lines=[];
  for(const line of iterateLsdynaKeywordLines(result.mesh,{partId:source.partId,coordinateFormat:'compact'})){
    if(line.startsWith('*')){state=line;lines.push(line);continue;}
    if(state==='*NODE')lines.push(fixedInteger(nodes[ni++],8,'node ID')+line.slice(8));
    else if(state==='*ELEMENT_SOLID'){const e=result.mesh.elements[ei];lines.push([elements[ei++],source.partId,...e.map(n=>nodes[n-1])].map(n=>fixedInteger(n,8,'solid record')).join(''));}
  }
  const keyword=lines.join('\n')+'\n',back=parseMeshText(keyword,'mesh.k'),written=identities(keyword);
  if(JSON.stringify(back.elements)!==JSON.stringify(result.mesh.elements)||JSON.stringify(written.nodeIds)!==JSON.stringify(nodes)||JSON.stringify(written.elementIds)!==JSON.stringify(elements))throw new Error('K geometry/connectivity/external identity readback failed');
  let error=0;for(let i=0;i<back.nodes.length;i++)for(let a=0;a<3;a++)error=Math.max(error,Math.abs(back.nodes[i][a]-result.mesh.nodes[i][a]));
  if(error>minElementEdgeLength(result.mesh)*1e-8)throw new Error('K coordinate precision exceeds the unchanged scale-relative tolerance');
  const lineageText=JSON.stringify({sourceParentIds:result.sourceParentIds,uniformCells:result.uniformCells,roles:result.roles,
    sourceExternalNodeIds:source.nodeIds,sourceExternalElementIds:source.elementIds,outputExternalNodeIds:nodes,outputExternalElementIds:elements});
  const report={schemaVersion:1,source:{path:sourcePath,sha256:createHash('sha256').update(text).digest('hex'),partId:source.partId},targetIdSpace,
    nativeTargetIdSpace:'ordinal',requestedTargets:request.options.targets,...result.report,
    nativeTopologyIdSpace:'Source-parent/node indices and output cell indices are import-ordinal; external K identities are recorded in lineage.json.',
    readback:{nodes:back.nodes.length,elements:back.elements.length,maximumCoordinateError:error,sha256:createHash('sha256').update(keyword).digest('hex'),
      allSourceNodeIdsPreserved:true,farFieldExternalElementIdsPreserved:true,refinedChildrenUseFreshElementIds:true},
    keywordScope:'NODE + ELEMENT_SOLID, single inherited specimen PID; no solver cards, sets or analysis state migration.'};
  const reportText=JSON.stringify(report,null,2),requestText=JSON.stringify({...request,targetIdSpace,meshFile:path.relative(out,sourcePath)},null,2);
  const estimatedBytes=[keyword,lineageText,reportText,requestText].reduce((s,t)=>s+Buffer.byteLength(t),0),disk=await fs.statfs(path.dirname(out));
  if(disk.bavail*disk.bsize<estimatedBytes+1024**3)throw new Error('Insufficient disk including1GiB reserve; no candidate published');
  await fs.mkdir(out);
  await fs.writeFile(path.join(out,'mesh.k.partial'),keyword,{flag:'wx'});
  await fs.writeFile(path.join(out,'lineage.json'),lineageText,{flag:'wx'});
  await fs.writeFile(path.join(out,'report.json'),reportText,{flag:'wx'});
  await fs.writeFile(path.join(out,'request.json'),requestText,{flag:'wx'});
  await fs.rename(path.join(out,'mesh.k.partial'),path.join(out,'mesh.k'));
  console.log(JSON.stringify({ok:true,output:out,elements:back.elements.length,coreParents:report.coreParents,shellParents:report.shellParents,
    farFieldParents:report.farFieldParents,minimumSJ:report.minimumOverallCornerSJ,maximumParentVolumeError:report.maximumOriginalParentRelativeVolumeError}));
}
main().catch(e=>{console.error(JSON.stringify({ok:false,error:e.message,code:e.code??null,parentIds:e.parentIds??[],faceNodeIds:e.faceNodeIds??[],
  sourceExternalParentIds:e.sourceExternalParentIds??[],sourceExternalFaceNodeIds:e.sourceExternalFaceNodeIds??[],conflictingInterfaces:e.conflictingInterfaces??[],diagnostics:e.diagnostics??{}}));process.exitCode=1;});
