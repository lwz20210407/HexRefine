import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseMeshText,refineExtrudedOgrid,meshToLsdynaKeyword,minElementEdgeLength,auditHexFaceGrading} from '../dist/index.js';

async function main() {
  const [requestFile,destination,...extra]=process.argv.slice(2);
  if(!requestFile||!destination||extra.length)throw Error('Usage: node scripts/refine-ogrid.mjs request.json NEW_OUTPUT_DIRECTORY');
  const file=path.resolve(requestFile),request=JSON.parse(await fs.readFile(file,'utf8'));
  if(request.schemaVersion!==1||request.kind!=='extruded-ogrid'||Object.keys(request).some(k=>!['schemaVersion','kind','meshFile','partId','options'].includes(k))||typeof request.meshFile!=='string')throw Error('Invalid extruded-ogrid request');
  const partId=request.partId??1;
  if(!Number.isSafeInteger(partId)||partId<1||partId>99999999)throw Error('An explicit single specimen PID is required (default 1)');
  const sourcePath=path.resolve(path.dirname(file),request.meshFile),text=await fs.readFile(sourcePath,'utf8');
  const mesh=parseMeshText(text,sourcePath),result=refineExtrudedOgrid(mesh,request.options);
  const keyword=meshToLsdynaKeyword(result.mesh,{partId,coordinateFormat:'compact'}),back=parseMeshText(keyword,'mesh.k');
  if(JSON.stringify(back.elements)!==JSON.stringify(result.mesh.elements))throw Error('K connectivity roundtrip failed');
  let coordinateError=0;back.nodes.forEach((p,i)=>p.forEach((v,a)=>coordinateError=Math.max(coordinateError,Math.abs(v-result.mesh.nodes[i][a]))));
  if(coordinateError>minElementEdgeLength(result.mesh)*1e-8)throw Error('K coordinate roundtrip exceeds scale tolerance');
  const readbackGrading=request.options.maximumAdjacentNormalSizeRatio===undefined?null:auditHexFaceGrading(back,{
    reviewElementIds:result.uniformCells.flatMap((uniform,i)=>uniform?[]:[i+1]),maximumNormalSizeRatio:request.options.maximumAdjacentNormalSizeRatio});
  if(readbackGrading&&!readbackGrading.requestedLimitVerified)throw Error('K readback failed the requested adjacent normal-size limit');
  const out=path.resolve(destination);await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out);
  const write=(name,value)=>fs.writeFile(path.join(out,name),value,{flag:'wx'});
  await write('mesh.k',keyword);
  await write('completed.k',meshToLsdynaKeyword(result.completedMesh,{partId,coordinateFormat:'compact'}));
  await write('lineage.json',JSON.stringify({completedParentIds:result.completedParentIds,levels:result.levels,uniformCells:result.uniformCells,roles:result.roles,sourceParentProvenance:result.sourceParentProvenance}));
  await write('report.json',JSON.stringify({schemaVersion:1,source:{path:sourcePath,sha256:createHash('sha256').update(text).digest('hex')},partId,
    keywordScope:'Mesh only: NODE + ELEMENT_SOLID. Single specimen PID; materials/sets/loads/contacts and solver state are NOT migrated.',
    readbackMaximumCoordinateError:coordinateError,readbackAdjacencyGrading:readbackGrading,...result.report},null,2));
  await write('request.json',JSON.stringify(request,null,2));
  console.log(JSON.stringify({ok:true,output:out,elements:result.mesh.elements.length,quality:result.report.quality}));
}
main().catch(error=>{console.error(JSON.stringify({ok:false,error:error.message,code:error.code??null}));process.exitCode=1;});
