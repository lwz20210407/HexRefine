import fs from 'node:fs/promises';
import path from 'node:path';
import {generateMappedCircularCore,generateMappedCircularPrism,meshToLsdynaKeyword,
  meshToLsdynaShellKeyword,convertMeshForExport,preparedExportToInp,parseMeshText} from '../dist/index.js';

async function main(){
  const [input,output,...extra]=process.argv.slice(2);
  if(!input||!output||extra.length)throw new Error('Usage: node scripts/generate-mapped-circle.mjs request.json NEW_OUTPUT_DIRECTORY');
  const out=path.resolve(output);
  try{await fs.lstat(out);throw new Error('Output already exists; refusing to overwrite');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const file=path.resolve(input);
  if((await fs.stat(file)).size>65536)throw new Error('Mapped-circle request exceeds64KiB');
  const request=JSON.parse(await fs.readFile(file,'utf8'));
  if(!request||typeof request!=='object'||Array.isArray(request)||request.schemaVersion!==1
      ||Object.keys(request).some(k=>!['schemaVersion','mode','parameters'].includes(k)))throw new Error('Unsupported mapped-circle request schema');
  if(request.mode!=='section'&&request.mode!=='prism')throw new Error('Mapped-circle mode must be section or prism');
  const result=request.mode==='section'?generateMappedCircularCore(request.parameters):generateMappedCircularPrism(request.parameters);
  const keyword=result.mesh.kind==='Q1'?meshToLsdynaShellKeyword(result.mesh,{coordinateFormat:'compact'})
    :meshToLsdynaKeyword(result.mesh,{coordinateFormat:'compact'});
  const inp=preparedExportToInp({...convertMeshForExport(result.mesh),sets:{
    nodeSets:new Map(Object.entries(result.nodeSets)),cellSets:new Map(Object.entries(result.patchElementIds)),
    missingCellIdsBySet:new Map(),missingNodeIdsBySet:new Map()
  }},{includeBoundarySets:false,title:'Mapped circular core'});
  const reference=result.mesh;
  const minimumEdge=result.mesh.kind==='Q1'?result.quality.minimumEdge:Math.min(result.sectionQuality.minimumEdge,result.quality.axialSpacing);
  let maximumCoordinateError=0;
  for(const [text,name] of [[keyword,'mesh.k'],[inp,'mesh.inp']]){
    const parsed=parseMeshText(text,name);
    if(parsed.kind!==reference.kind||parsed.nodes.length!==reference.nodes.length
        ||JSON.stringify(parsed.elements)!==JSON.stringify(reference.elements))throw new Error('Export readback topology mismatch');
    for(let i=0;i<parsed.nodes.length;i++)for(let a=0;a<3;a++)maximumCoordinateError=Math.max(maximumCoordinateError,Math.abs(parsed.nodes[i][a]-reference.nodes[i][a]));
  }
  if(maximumCoordinateError>minimumEdge*1e-8)throw new Error('Export coordinate precision is insufficient');
  const report={schemaVersion:1,generator:'mapped-circular-core',request,plan:result.plan,quality:result.quality,
    ...(result.sectionQuality?{sectionQuality:result.sectionQuality}:{}),
    kind:result.mesh.kind,nodes:result.mesh.nodes.length,elements:result.mesh.elements.length,
    nodeSets:result.nodeSets,patchElementIds:result.patchElementIds,
    readback:{kAndInpVerified:true,maximumCoordinateError},engineeringAcceptanceVerified:false,
    scope:'Geometry and mesh only; sets are metadata, not solver boundary conditions. No annular transition bands or GUI integration are implied.'};
  // Require the output parent to exist; never create a directory tree for a typo.
  await fs.access(path.dirname(out));await fs.mkdir(out);
  for(const [name,content] of [['mesh.k',keyword],['mesh.inp',inp],['report.json',JSON.stringify(report,null,2)]]){
    await fs.writeFile(path.join(out,name),content,{flag:'wx'});
  }
  console.log(JSON.stringify({ok:true,output:out,kind:reference.kind,nodes:report.nodes,elements:report.elements}));
}
main().catch(error=>{console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;});
