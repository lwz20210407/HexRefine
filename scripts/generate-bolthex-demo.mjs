import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {meshToLsdynaMixedKeyword,parseNativeLsdynaMixedKeyword} from '../dist/lsdyna-mixed.js';
import {minimumHexCornerScaledJacobian,hexElementSignedVolume} from '../dist/hex-quality.js';

const args=process.argv.slice(2);
if(![3,5].includes(args.length)||args[1]!=='--python'||(args.length===5&&args[3]!=='--case'))throw new Error('Usage: node scripts/generate-bolthex-demo.mjs NEW_OUTPUT_DIRECTORY --python PYTHON_EXECUTABLE [--case original|femssc|femssc-left|plain]');
const caseName=args[4]??'original';
if(!['original','femssc','femssc-left','plain','rounded','rounded-left'].includes(caseName))throw new Error('Unknown demo case');
const output=path.resolve(args[0]),parent=path.dirname(output),python=path.resolve(args[2]);
const project=fileURLToPath(new URL('../',import.meta.url));
if(!(await fs.stat(parent)).isDirectory())throw new Error('Output parent must exist');
if(await fs.lstat(output).then(()=>true,e=>e.code==='ENOENT'?false:Promise.reject(e)))throw new Error('Refusing to overwrite an output');
await fs.access(python);
const stage=await fs.mkdtemp(path.join(parent,'.bolthex-'));
try{
  const result=spawnSync(python,['-B','-m','tools.bolthex.bridge',stage,'--case',caseName],{cwd:project,encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
  if(result.error||result.status!==0)throw new Error(`Recovered Python generator failed: ${result.error?.message??result.stderr}`);
  const bridge=JSON.parse(await fs.readFile(path.join(stage,'bridge.json'),'utf8')),model=bridge.model;
  const keyword=meshToLsdynaMixedKeyword(model,{coordinatePrecision:12,coordinateFormat:'compact'});
  const parsed=parseNativeLsdynaMixedKeyword(keyword);
  if(JSON.stringify(parsed.solids)!==JSON.stringify(model.solids)||parsed.nodes.length!==model.nodes.length)throw new Error('K connectivity/PID round-trip failed');
  let coordinateError=0,sj=Infinity,volume=0;
  for(let i=0;i<model.nodes.length;i++)for(let a=0;a<3;a++)coordinateError=Math.max(coordinateError,Math.abs(model.nodes[i][a]-parsed.nodes[i][a]));
  if(coordinateError>1e-8)throw new Error('K coordinate read-back error exceeds 1e-8');
  for(const e of parsed.solids){const p=e.nodes.map(n=>parsed.nodes[n-1]);sj=Math.min(sj,minimumHexCornerScaledJacobian(p));volume+=hexElementSignedVolume(p);}
  if(!Number.isFinite(sj)||sj<.15||!Number.isFinite(volume)||volume<=0)throw new Error('Recovered demo failed quality checks');
  await fs.writeFile(path.join(stage,'model.k'),keyword);
  await fs.writeFile(path.join(stage,'parts-and-surfaces.json'),JSON.stringify(bridge.parts,null,2)+'\n');
  const report={schemaVersion:1,generator:bridge.generator,geometry:bridge.geometry,nodes:parsed.nodes.length,
    elements:parsed.solids.length,parts:bridge.parts.map(p=>({partId:p.partId,name:p.name})),
    minimumCornerScaledJacobian:sj,volume,maximumCoordinateReadbackError:coordinateError,
    kSHA256:createHash('sha256').update(keyword).digest('hex'),
    inpSHA256:createHash('sha256').update(await fs.readFile(path.join(stage,'model.inp'))).digest('hex'),
    originalExecutableRequired:false,pythonBackend:true,guiPorted:false,
    limitations:['Fixed built-in demo, not arbitrary request planning.','Source surface labels retain Abaqus face semantics in a sidecar; not solver contact cards.','Full conformance/solver acceptance is separate.']};
  await fs.writeFile(path.join(stage,'report.json'),JSON.stringify(report,null,2)+'\n');
  await fs.unlink(path.join(stage,'bridge.json'));
  await fs.rename(stage,output);console.log(JSON.stringify(report,null,2));
}catch(error){
  const actual=await fs.realpath(stage);
  if(path.dirname(actual)!==await fs.realpath(parent)||!path.basename(actual).startsWith('.bolthex-'))throw new Error('Unexpected staging directory; refusing cleanup',{cause:error});
  await fs.rm(actual,{recursive:true,force:true});throw error;
}
