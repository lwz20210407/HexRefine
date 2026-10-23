import fs from 'node:fs/promises';
import path from 'node:path';
import {planConcentricSeeds} from '../dist/index.js';

async function main(){
  const [input,output,...extra]=process.argv.slice(2);
  if(!input||!output||extra.length)throw new Error('Usage: node scripts/plan-concentric-seeds.mjs request.json NEW_OUTPUT_DIRECTORY');
  const out=path.resolve(output);
  try{await fs.lstat(out);throw new Error('Output already exists; refusing to overwrite');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!(await fs.stat(path.dirname(out))).isDirectory())throw new Error('Output parent must exist');
  if((await fs.stat(input)).size>65536)throw new Error('Seed request exceeds64KiB');
  const request=JSON.parse(await fs.readFile(input,'utf8')),result=planConcentricSeeds(request);
  await fs.mkdir(out);
  await fs.writeFile(path.join(out,'resolved-request.json'),JSON.stringify(result.resolvedRequest,null,2),{flag:'wx'});
  await fs.writeFile(path.join(out,'seed-report.json'),JSON.stringify({request,...result},null,2),{flag:'wx'});
  console.log(JSON.stringify({ok:true,output:out,elements:result.plan.expectedElements,changes:result.report.changes}));
}
main().catch(e=>{console.error(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;});
