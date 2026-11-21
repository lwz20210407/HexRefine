import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {refineSolidOgridKeyword} from '../dist/ogrid-solid-keyword.js';

async function main() {
  const [input,dest,fractionText='0.6',pidText,...extra]=process.argv.slice(2);
  if (!input||!dest||extra.length)
    throw new Error('Usage: node scripts/refine-solid-ogrid-keyword.mjs HOST.k NEW_DIRECTORY|--preview [fraction=0.6] [PID]');
  const file=await fs.readFile(input);
  const result=refineSolidOgridKeyword(file.toString('utf8'),{fraction:Number(fractionText),
    ...(pidText===undefined?{}:{partId:Number(pidText)})});
  const output=dest==='--preview'?null:path.resolve(dest);
  const report={ok:true,output,sourceSha256:createHash('sha256').update(file).digest('hex'),...result.report};
  if (output) {
    await fs.mkdir(output);
    await fs.writeFile(path.join(output,'mesh.k'),result.keyword,{flag:'wx'});
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
  }
  console.log(JSON.stringify({ok:true,output,pid:report.pid,roiParents:report.roiParentIds.length,
    specimenElements:report.specimenElements,minimumNewCornerSJ:report.minimumNewCornerSJ,
    minimumGaussDeterminant:report.installedQuality.minimumGaussDeterminant,scope:report.scope}));
}

main().catch(error=>{
  console.error(JSON.stringify({ok:false,error:error.message,code:error.code??null}));
  process.exitCode=1;
});
