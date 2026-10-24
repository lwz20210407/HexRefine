import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {generateStagedBandPlate,iterateLsdynaKeywordLines,parseMeshText,minimumHexCornerScaledJacobian,hexElementSignedVolume} from '../dist/index.js';
import {hexJacobian} from '../dist/hex-quality-internal.js';
import {determinant3Scaled,materializeScaledValue,scaledValueSign} from '../dist/hex-numeric-internal.js';

async function main(){
  const [input,destination,...extra]=process.argv.slice(2);
  if(!input||!destination||extra.length)throw new Error('Usage: node scripts/generate-staged-band-plate.mjs REQUEST.json NEW_OUTPUT_DIRECTORY');
  const out=path.resolve(destination);try{await fs.lstat(out);throw new Error('Output already exists; refusing to overwrite');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!(await fs.stat(path.dirname(out))).isDirectory())throw new Error('Output parent must exist');
  if((await fs.stat(input)).size>1024**2)throw new Error('Staged-band request exceeds1MiB');
  const request=JSON.parse(await fs.readFile(input,'utf8'));
  if(!request||request.schemaVersion!==1||request.kind!=='staged-band-plate'||Object.keys(request).some(k=>!['schemaVersion','kind','partId','parameters'].includes(k)))throw new Error('Unsupported staged-band request');
  const partId=request.partId??1;if(!Number.isSafeInteger(partId)||partId<1||partId>99999999)throw new Error('Invalid staged-band PID');
  const result=generateStagedBandPlate(request.parameters),keyword=[...iterateLsdynaKeywordLines(result.mesh,{partId,coordinateFormat:'compact'})].join('\n')+'\n';
  const back=parseMeshText(keyword,'mesh.k');
  if(JSON.stringify(back.elements)!==JSON.stringify(result.mesh.elements))throw new Error('Staged-band K connectivity readback failed');
  let error=0,sj=Infinity,gauss=Infinity,volume=0;
  for(let i=0;i<back.nodes.length;i++)for(let a=0;a<3;a++)error=Math.max(error,Math.abs(back.nodes[i][a]-result.mesh.nodes[i][a]));
  if(error>result.plan.minimumSpacing*1e-8)throw new Error('Staged-band K coordinate precision failed');
  for(const e of back.elements){
    const p=e.map(n=>back.nodes[n-1]);sj=Math.min(sj,minimumHexCornerScaledJacobian(p));volume+=hexElementSignedVolume(p);
    for(const u of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const v of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const w of [-1/Math.sqrt(3),1/Math.sqrt(3)]){
      const d=determinant3Scaled(hexJacobian(p,u,v,w)),value=materializeScaledValue(d);if(scaledValueSign(d)<=0||!(value>0))throw new Error('Staged-band K Gauss positivity failed');gauss=Math.min(gauss,value);
    }
  }
  if(!(sj>0)||sj<(request.parameters.minimumCornerScaledJacobian??0)||Math.abs(volume/result.plan.expectedVolume-1)>1e-8)throw new Error('Staged-band K quality/volume readback failed');
  const report={schemaVersion:1,implementation:'native-staged-band-plate',sourceMeshImported:false,partId,nodes:back.nodes.length,elements:back.elements.length,
    plan:result.plan,quality:result.quality,limitation:result.limitation,
    readback:{maximumCoordinateError:error,minimumCornerScaledJacobian:sj,minimumGaussDeterminant:gauss,volume,connectivityExact:true,sha256:createHash('sha256').update(keyword).digest('hex')},
    keywordScope:'NODE + ELEMENT_SOLID only; fresh node/element IDs, requested PID; no material/BC/contact migration',engineeringAcceptanceVerified:false};
  const reportText=JSON.stringify(report,null,2),regions=JSON.stringify(result.regions),requestText=JSON.stringify(request,null,2),disk=await fs.statfs(path.dirname(out));
  if(disk.bavail*disk.bsize<[keyword,reportText,regions,requestText].reduce((s,v)=>s+Buffer.byteLength(v),0)+1024**3)throw new Error('Insufficient disk including1GiB reserve');
  await fs.mkdir(out);await fs.writeFile(path.join(out,'mesh.k.partial'),keyword,{flag:'wx'});
  await fs.writeFile(path.join(out,'report.json'),reportText,{flag:'wx'});await fs.writeFile(path.join(out,'regions.json'),regions,{flag:'wx'});await fs.writeFile(path.join(out,'request.json'),requestText,{flag:'wx'});
  await fs.rename(path.join(out,'mesh.k.partial'),path.join(out,'mesh.k'));
  console.log(JSON.stringify({ok:true,output:out,nodes:back.nodes.length,elements:back.elements.length,minimumSJ:sj}));
}
main().catch(error=>{console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;});
