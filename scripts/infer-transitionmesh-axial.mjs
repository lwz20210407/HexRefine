import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inferAndPatchAxialTube} from '../dist/transitionmesh-infer-axial.js';

async function main() {
  const [source,destination,...extra]=process.argv.slice(2);
  if (!source||!destination||extra.length)
    throw new Error('Usage: node scripts/infer-transitionmesh-axial.mjs HOST.k NEW_OUTPUT_DIRECTORY|--preview');
  const input=await fs.readFile(source);
  const result=inferAndPatchAxialTube(input.toString('utf8'));
  const preview=destination==='--preview';
  const output=preview?null:path.resolve(destination);
  const report={ok:true,sourceSha256:createHash('sha256').update(input).digest('hex'),
    preview,output,...result.inference,...result.report};
  if (output) {
    await fs.mkdir(output);
    await fs.writeFile(path.join(output,'mesh.k'),result.keyword,{flag:'wx'});
    await fs.writeFile(path.join(output,'candidate.k'),result.candidate,{flag:'wx'});
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
  }
  console.log(JSON.stringify(report));
}

main().catch(error=>{
  console.error(JSON.stringify({ok:false,error:error.message}));
  process.exitCode=1;
});
