import fs from 'node:fs/promises';
import path from 'node:path';
import {generateTransitionMeshRequest} from '../dist/transition-mesh-request.js';
import {exampleTransitionMeshV11Request,generateTransitionMeshV11Request,
  transitionMeshV11Modes} from '../dist/transitionmesh-v11-request.js';

async function main(){
  const [input,output,...extra]=process.argv.slice(2);
  if(input==='--help'&&!output){
    console.log('Usage: node scripts/generate-transition-band.mjs request.json NEW_OUTPUT_DIRECTORY');
    console.log('Example request: node scripts/generate-transition-band.mjs --example-v11 MODE');
    console.log('V1.1 modes: '+transitionMeshV11Modes.join(', '));
    return;
  }
  if(input==='--example-v11'&&output&&!extra.length){
    console.log(JSON.stringify(exampleTransitionMeshV11Request(output),null,2));
    return;
  }
  if(!input||!output||extra.length)throw new Error('Usage: node scripts/generate-transition-band.mjs request.json NEW_OUTPUT_DIRECTORY');
  const request=JSON.parse((await fs.readFile(path.resolve(input),'utf8')).replace(/^\uFEFF/,''));
  const result=request?.kind==='transitionmesh-v11'
    ?generateTransitionMeshV11Request(request)
    :generateTransitionMeshRequest(request);
  const out=path.resolve(output);await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out);
  for(const [file,contents] of Object.entries(result.files))
    await fs.writeFile(path.join(out,file),contents,{flag:'wx'});
  const report=JSON.parse(result.files['report.json']);
  console.log(JSON.stringify({ok:true,output:out,nodes:report.nodes,elements:report.elements,counts:report.plan.counts}));
}
main().catch(error=>{console.error(JSON.stringify({ok:false,error:error.message,requiredMultiple:error.requiredMultiple,nearbyCounts:error.nearbyCounts}));process.exitCode=1;});
