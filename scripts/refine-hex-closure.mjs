import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseMeshText,meshFromSerializable,refineHexWithTransitionClosure,refineHexMultilevel,meshToLsdynaMixedKeyword,parseNativeLsdynaMixedKeyword,minElementEdgeLength} from '../dist/index.js';

async function main(){
 const [input,output,...extra]=process.argv.slice(2);
 if(!input||!output||extra.length)throw Error('Usage: node scripts/refine-hex-closure.mjs request.json NEW_OUTPUT_DIRECTORY');
 const file=path.resolve(input),request=JSON.parse(await fs.readFile(file,'utf8'));
 if(request.schemaVersion!==1||request.kind!=='hex-transition-closure'||Object.keys(request).some(k=>!['schemaVersion','kind','meshFile','mesh','selection','targets','options','partId','parentPartIds'].includes(k)))throw Error('Invalid hex-transition-closure request');
 if((request.meshFile!==undefined)===(request.mesh!==undefined)||(request.selection!==undefined)===(request.targets!==undefined))throw Error('Supply exactly one mesh source and one selection or target-level list');
 let mesh,source;
 if(request.meshFile!==undefined){
  if(typeof request.meshFile!=='string')throw Error('meshFile must be a path');
  const sourcePath=path.resolve(path.dirname(file),request.meshFile),text=await fs.readFile(sourcePath,'utf8');
  mesh=parseMeshText(text,sourcePath);source={file:sourcePath,sha256:createHash('sha256').update(text).digest('hex')};
 }else{mesh=meshFromSerializable(request.mesh);source={embedded:true};}
 const pids=request.parentPartIds??Array(mesh.elements.length).fill(request.partId??1);
 if(request.parentPartIds!==undefined&&request.partId!==undefined)throw Error('partId and parentPartIds are mutually exclusive');
 if(!Array.isArray(pids)||pids.length!==mesh.elements.length||pids.some(n=>!Number.isSafeInteger(n)||n<1||n>99999999))throw Error('One valid PID is required per input parent');
 if(request.options?.allowSupportRedistribution&&new Set(pids).size!==1)throw Error('Support redistribution is restricted to a single material/PID mesh');
 const result=request.targets!==undefined?refineHexMultilevel(mesh,request.targets,request.options):refineHexWithTransitionClosure(mesh,request.selection,request.options);
 const parents=result.baseParentIds??result.cellData.map(c=>c.parentElementId);
 const model={nodes:result.mesh.nodes,solids:result.mesh.elements.map((nodes,i)=>({id:i+1,partId:pids[parents[i]-1],nodes})),beams:[]};
 const keyword=meshToLsdynaMixedKeyword(model,{coordinateFormat:'compact'}),back=parseNativeLsdynaMixedKeyword(keyword);
 if(JSON.stringify(back.solids)!==JSON.stringify(model.solids))throw Error('K connectivity/PID roundtrip mismatch');
 let coordinateError=0;back.nodes.forEach((p,i)=>p.forEach((v,a)=>coordinateError=Math.max(coordinateError,Math.abs(v-model.nodes[i][a]))));
 if(coordinateError>minElementEdgeLength(result.mesh)*1e-8)throw Error('K coordinate roundtrip exceeds scale tolerance');
 const report={schemaVersion:1,source,inputNodes:mesh.nodes.length,inputElements:mesh.elements.length,
  outputNodes:result.mesh.nodes.length,outputElements:result.mesh.elements.length,
  plan:result.report??result.closure,quality:result.quality??result.report.quality,readbackMaximumCoordinateError:coordinateError,
  keywordScope:'NODE + ELEMENT_SOLID mesh only. Element IDs are renumbered; parent IDs refer to imported mesh order. No materials, sets, loads or contacts are migrated.',
  partPolicy:request.parentPartIds?'explicit per-parent PIDs':'explicit single PID, default 1; source solver PID cards are not inferred'};
 const out=path.resolve(output);await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out);
 await fs.writeFile(path.join(out,'mesh.k'),keyword,{flag:'wx'});
 await fs.writeFile(path.join(out,'lineage.json'),JSON.stringify({baseParentIds:parents,levels:result.levels??null,uniformCells:result.uniformCells??null,roles:result.roles??result.cellData.map(c=>c.role)}),{flag:'wx'});
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
 await fs.writeFile(path.join(out,'request.json'),JSON.stringify(request,null,2),{flag:'wx'});
 console.log(JSON.stringify({ok:true,output:out,elements:result.mesh.elements.length}));
}
main().catch(error=>{console.error(JSON.stringify({ok:false,error:error.message,code:error.code??null,diagnostic:error.diagnostic??null}));process.exitCode=1;});
