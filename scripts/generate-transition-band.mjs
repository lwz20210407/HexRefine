import fs from 'node:fs/promises';
import path from 'node:path';
import {generatePlanarTransitionBand,generateAnnularTransitionBand,extrudeTransitionBand,
  meshToLsdynaKeyword,meshToLsdynaShellKeyword,preparedExportToInp,convertMeshForExport,parseMeshText,minElementEdgeLength} from '../dist/index.js';

async function main(){
  const [input,output,...extra]=process.argv.slice(2);
  if(!input||!output||extra.length)throw new Error('Usage: node scripts/generate-transition-band.mjs request.json NEW_OUTPUT_DIRECTORY');
  const request=JSON.parse(await fs.readFile(path.resolve(input),'utf8'));
  if(!request||request.schemaVersion!==1||!['planar','annular'].includes(request.mode)
      ||!request.parameters||typeof request.parameters!=='object'||Array.isArray(request.parameters)
      ||Object.keys(request).some(k=>!['schemaVersion','mode','parameters','extrusion'].includes(k)))
    throw new Error('Expected schemaVersion=1, planar/annular mode, parameters and optional extrusion');
  if(request.extrusion!==undefined&&(!request.extrusion||typeof request.extrusion!=='object'
      ||Array.isArray(request.extrusion)||Object.keys(request.extrusion).some(k=>!['height','layers'].includes(k))))
    throw new Error('Invalid extrusion specification');
  const base=(request.mode==='planar'?generatePlanarTransitionBand:generateAnnularTransitionBand)(request.parameters);
  const result=request.extrusion?extrudeTransitionBand(base,request.extrusion.height,request.extrusion.layers):base;
  const keyword=(result.mesh.kind==='H1'?meshToLsdynaKeyword:meshToLsdynaShellKeyword)(result.mesh,{coordinateFormat:'compact'});
  const cellSets=new Map();result.stageIds.forEach((stage,i)=>{const name=`stage_${stage}`;if(!cellSets.has(name))cellSets.set(name,[]);cellSets.get(name).push(i+1);});
  const converted=convertMeshForExport(result.mesh);
  const inp=preparedExportToInp({...converted,sets:{nodeSets:new Map(Object.entries(result.nodeSets)),cellSets,
    missingCellIdsBySet:new Map(),missingNodeIdsBySet:new Map()}},{includeBoundarySets:false,title:'HexRefine native transition band'});
  const errors={};
  for(const [name,text] of [['mesh.k',keyword],['mesh.inp',inp]]){
    const back=parseMeshText(text,name);
    if(back.nodes.length!==result.mesh.nodes.length||JSON.stringify(back.elements)!==JSON.stringify(result.mesh.elements))throw new Error(`${name} connectivity read-back failed`);
    errors[name]=back.nodes.reduce((error,p,i)=>Math.max(error,Math.hypot(...p.map((v,a)=>v-result.mesh.nodes[i][a]))),0);
    if(errors[name]>minElementEdgeLength(result.mesh)*1e-8)throw new Error(`${name} coordinate precision failed`);
  }
  const report={schemaVersion:1,implementation:'native-existing-hexrefine-templates',request,
    nodes:result.mesh.nodes.length,elements:result.mesh.elements.length,kind:result.mesh.kind,
    plan:result.plan,quality:result.quality,baseGeometryQuality:base.quality,
    checks:{geometry:true,conformance:true,keywordReadback:true,inpReadback:true},coordinateErrors:errors,
    limitations:'Independent generated bands; not arbitrary old-Hex refinement or Abaqus CAD partitioning. K has only mesh cards; no loads/materials or solver coupling.'};
  const out=path.resolve(output);await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out);
  for(const [file,contents] of Object.entries({'mesh.k':keyword,'mesh.inp':inp,'request.json':JSON.stringify(request,null,2),
    'report.json':JSON.stringify(report,null,2),'sets.json':JSON.stringify({nodeSets:result.nodeSets,cellSets:Object.fromEntries(cellSets)})}))
    await fs.writeFile(path.join(out,file),contents,{flag:'wx'});
  console.log(JSON.stringify({ok:true,output:out,nodes:report.nodes,elements:report.elements,counts:result.plan.counts}));
}
main().catch(error=>{console.error(JSON.stringify({ok:false,error:error.message,requiredMultiple:error.requiredMultiple,nearbyCounts:error.nearbyCounts}));process.exitCode=1;});
