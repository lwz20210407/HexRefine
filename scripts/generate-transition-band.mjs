import fs from 'node:fs/promises';
import path from 'node:path';
import {generateTransitionMeshRequest} from '../dist/index.js';

async function main(){
  const [input,output,...extra]=process.argv.slice(2);
  if(!input||!output||extra.length)throw new Error('Usage: node scripts/generate-transition-band.mjs request.json NEW_OUTPUT_DIRECTORY');
  const result=generateTransitionMeshRequest(JSON.parse(await fs.readFile(path.resolve(input),'utf8')));
  const out=path.resolve(output);await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out);
  for(const [file,contents] of Object.entries(result.files))
    await fs.writeFile(path.join(out,file),contents,{flag:'wx'});
  const report=JSON.parse(result.files['report.json']);
  console.log(JSON.stringify({ok:true,output:out,nodes:report.nodes,elements:report.elements,counts:report.plan.counts}));
}
main().catch(error=>{console.error(JSON.stringify({ok:false,error:error.message,requiredMultiple:error.requiredMultiple,nearbyCounts:error.nearbyCounts}));process.exitCode=1;});
