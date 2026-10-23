import fs from 'node:fs/promises';
import path from 'node:path';
import {planConcentricRingWidths,ConcentricWidthPlanningError} from '../dist/index.js';

async function main(){
  const [input,output,...extra]=process.argv.slice(2);
  if(!input||!output||extra.length)throw new Error('Usage: node scripts/plan-concentric-widths.mjs request.json NEW_OUTPUT_DIRECTORY');
  const out=path.resolve(output);
  try{await fs.lstat(out);throw new Error('Output already exists; refusing to overwrite');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!(await fs.stat(path.dirname(out))).isDirectory())throw new Error('Output parent must exist');
  if((await fs.stat(input)).size>65536)throw new Error('Width-planning request exceeds64KiB');
  const request=JSON.parse(await fs.readFile(input,'utf8')),result=planConcentricRingWidths(request);
  await fs.mkdir(out);
  await fs.writeFile(path.join(out,'resolved-request.json'),JSON.stringify(result.resolvedRequest,null,2),{flag:'wx'});
  const {resolvedRequest,...details}=result;
  await fs.writeFile(path.join(out,'planning-report.json'),JSON.stringify({schemaVersion:1,generator:'concentric-width-planner',request,...details},null,2),{flag:'wx'});
  console.log(JSON.stringify({ok:true,output:out,...result.counts,minimumCornerSJ:result.quality.minimumCornerScaledJacobian,
    transitionEdgeToCoreRatio:result.report.actualTransitionEdgeToCoreRatio,regularEdgeToCoreRatio:result.report.actualRegularEdgeToCoreRatio,
    maximumTransitionAspect:result.report.actualTransitionEdgeAspectRatio}));
}
main().catch(e=>{console.error(JSON.stringify({ok:false,code:e instanceof ConcentricWidthPlanningError?e.code:'invalid-request',error:e.message,
  ...(e instanceof ConcentricWidthPlanningError?{diagnostics:e.diagnostics}:{})}));process.exitCode=1;});
