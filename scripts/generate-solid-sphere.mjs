import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {generateSolidSphereGradedMesh,meshToLsdynaKeyword,parseMeshText} from '../dist/index.js';

const [input,destination,...extra]=process.argv.slice(2);
try {
  if(!input||!destination||extra.length)throw new Error('Usage: node scripts/generate-solid-sphere.mjs request.json NEW_OUTPUT_DIRECTORY');
  const request=JSON.parse(await fs.readFile(input,'utf8'));
  if(!request||request.schemaVersion!==1||request.kind!=='solid-sphere-surface-cap'||Object.keys(request).some(k=>!['schemaVersion','kind','options','partId'].includes(k)))throw new Error('Invalid version1 solid-sphere-surface-cap request');
  const partId=request.partId??1;if(!Number.isSafeInteger(partId)||partId<1||partId>99999999)throw new Error('Invalid partId');
  const out=path.resolve(destination);
  try {await fs.lstat(out);throw new Error('Refusing to overwrite an existing output path');}catch(error){if(error.code!=='ENOENT')throw error;}
  const result=generateSolidSphereGradedMesh(request.options);
  const keyword=meshToLsdynaKeyword(result.mesh,{partId,coordinateFormat:'compact'}),base=meshToLsdynaKeyword(result.baseMesh,{partId,coordinateFormat:'compact'});
  const parsed=parseMeshText(keyword,'mesh.k'),tolerance=result.quality.minimumEdge*1e-8;
  if(JSON.stringify(parsed.elements)!==JSON.stringify(result.mesh.elements)||parsed.nodes.length!==result.mesh.nodes.length||parsed.nodes.some((p,i)=>p.some((v,j)=>Math.abs(v-result.mesh.nodes[i][j])>tolerance)))throw new Error('Sphere K readback failed');
  const lineage={sourceParentIds:result.parentElementIds,coreParentIds:result.capCoreParentIds,regions:result.regions,projectedNodeIds:result.projectedNodeIds};
  const report={schemaVersion:1,kind:request.kind,options:request.options,partId,plan:result.plan,quality:result.quality,warnings:result.warnings,
    nodes:result.mesh.nodes.length,elements:result.mesh.elements.length,regionCounts:Object.fromEntries(Object.entries(result.regions).map(([key,ids])=>[key,ids.length])),
    kReadback:{connectivity:true,maximumCoordinateError:parsed.nodes.reduce((error,p,i)=>Math.max(error,...p.map((v,j)=>Math.abs(v-result.mesh.nodes[i][j]))),0)},
    sha256:createHash('sha256').update(keyword).digest('hex')};
  const files={'mesh.k':keyword,'source-coarse.k':base,'lineage.json':JSON.stringify(lineage),'report.json':JSON.stringify(report,null,2)+'\n','request.json':JSON.stringify(request,null,2)+'\n'};
  const bytes=Object.values(files).reduce((sum,text)=>sum+Buffer.byteLength(text),0),disk=await fs.statfs(path.dirname(out));
  if(disk.bavail*disk.bsize<bytes+64*1024**2)throw new Error('Insufficient disk space for sphere output and reserve');
  await fs.mkdir(out);
  for(const [name,text] of Object.entries(files))await fs.writeFile(path.join(out,name==='mesh.k'?'mesh.k.partial':name),text,{flag:'wx'});
  await fs.rename(path.join(out,'mesh.k.partial'),path.join(out,'mesh.k'));
  console.log(JSON.stringify(report));
}catch(error){console.error(error.message);process.exitCode=1;}
