import type {Point} from "./types.js";
import {fixedInteger,fixedFloat} from "./lsdyna-format-internal.js";

export interface MixedSolidRecord {id:number;partId:number;nodes:readonly number[];}
export interface MixedBeamRecord {id:number;partId:number;nodes:readonly [number,number];orientationNode:number;}
/** Dense one-based node IDs; explicit, globally distinct element IDs and per-element PIDs. */
export interface LsdynaMixedMesh {
  nodes:readonly Point[];
  solids:readonly MixedSolidRecord[];
  beams:readonly MixedBeamRecord[];
}
export interface MixedKeywordOptions {coordinatePrecision?:number;coordinateFormat?:"scientific"|"compact";}

export function validateLsdynaMixedMesh(model:LsdynaMixedMesh):void {
  if(!model.nodes.length||!model.solids.length)throw new Error("mixed mesh requires nodes and solid elements");
  for(const p of model.nodes)if(p.length!==3||p.some(x=>!Number.isFinite(x)))throw new Error("mixed mesh requires finite 3D nodes");
  const usedIds=new Set<number>();
  const node=(id:number)=>{
    if(!Number.isSafeInteger(id)||id<1||id>model.nodes.length)throw new Error("mixed element references an invalid node");
    return model.nodes[id-1]!;
  };
  const record=(e:{id:number;partId:number})=>{
    fixedInteger(e.id,8,"element ID");fixedInteger(e.partId,8,"part ID");
    if(usedIds.has(e.id))throw new Error("mixed mesh has duplicate element IDs");usedIds.add(e.id);
  };
  const solids=new Set<string>(),beams=new Set<string>();
  for(const e of model.solids){
    record(e);if(e.nodes.length!==8||new Set(e.nodes).size!==8)throw new Error("invalid eight-node solid connectivity");
    e.nodes.forEach(node);const key=[...e.nodes].sort((a,b)=>a-b).join(":");
    if(solids.has(key))throw new Error("duplicate solid connectivity");solids.add(key);
  }
  for(const e of model.beams){
    record(e);if(e.nodes.length!==2||e.nodes[0]===e.nodes[1])throw new Error("invalid beam endpoint connectivity");
    const p=node(e.nodes[0]),q=node(e.nodes[1]),r=node(e.orientationNode);
    const a=q.map((x,i)=>x-p[i]!),b=r.map((x,i)=>x-p[i]!);
    const la=Math.hypot(...a),lb=Math.hypot(...b);
    const cross=[a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!];
    if(!(la>0&&lb>0&&Math.hypot(...cross)/(la*lb)>1e-10))throw new Error("beam has zero length or collinear orientation node");
    const key=[...e.nodes].sort((x,y)=>x-y).join(":");
    if(beams.has(key))throw new Error("duplicate beam connectivity");beams.add(key);
  }
}

/** Mesh-only ordinary beams; no section, material, releases, or coupling is inferred. */
export function meshToLsdynaMixedKeyword(model:LsdynaMixedMesh,options:MixedKeywordOptions={}):string {
  if(Object.keys(options).some(k=>k!=="coordinatePrecision"&&k!=="coordinateFormat"))throw new RangeError("unknown mixed keyword option");
  const precision=options.coordinatePrecision??8,format=options.coordinateFormat??"scientific";
  if(!Number.isInteger(precision)||precision<1||precision>12)throw new RangeError("invalid mixed coordinatePrecision");
  if(format!=="scientific"&&format!=="compact")throw new RangeError("invalid mixed coordinateFormat");
  validateLsdynaMixedMesh(model);
  const lines=["*KEYWORD","*NODE"];
  model.nodes.forEach((p,i)=>lines.push(fixedInteger(i+1,8,"node ID")+p.map(v=>fixedFloat(v,16,precision,format)).join("")));
  lines.push("*ELEMENT_SOLID");
  for(const e of model.solids)lines.push([e.id,e.partId,...e.nodes].map(n=>fixedInteger(n,8,"solid record")).join(""));
  if(model.beams.length){
    lines.push("*ELEMENT_BEAM");
    for(const e of model.beams)lines.push([e.id,e.partId,...e.nodes,e.orientationNode,0,0,0,0,2]
      .map(n=>n===0?"       0":fixedInteger(n,8,"beam record")).join(""));
  }
  lines.push("*END");return lines.join("\n")+"\n";
}

/** Strict read-back for this native mesh-only subset; never silently discards solver cards. */
export function parseNativeLsdynaMixedKeyword(text:string):LsdynaMixedMesh {
  const nodes:Point[]=[],solids:MixedSolidRecord[]=[],beams:MixedBeamRecord[]=[];
  let section="",started=false,ended=false;
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();if(!line||line.startsWith("$"))continue;
    if(ended)throw new Error("data after mixed keyword END");
    if(line.startsWith("*")){
      if(line==="*KEYWORD"&&!started){started=true;continue;}
      if(!started)throw new Error("mixed deck must start with KEYWORD");
      if(line==="*END"){ended=true;continue;}
      if(!["*NODE","*ELEMENT_SOLID","*ELEMENT_BEAM"].includes(line))throw new Error(`unsupported mixed keyword ${line}`);
      section=line;continue;
    }
    if(!section)throw new Error("mixed data outside a supported keyword");
    let fields:string[];
    if(raw.includes(","))fields=raw.split(",").map(s=>s.trim());
    else if(section==="*NODE"){
      if(raw.length!==56)throw new Error("native mixed NODE must have four fixed fields");
      fields=[raw.slice(0,8),raw.slice(8,24),raw.slice(24,40),raw.slice(40,56)].map(s=>s.trim());
    }else fields=(raw.match(/.{1,8}/g)??[]).map(s=>s.trim());
    if(fields.some(s=>!s||!Number.isFinite(Number(s))))throw new Error("invalid native mixed numeric field");
    const values=fields.map(Number);
    if(section==="*NODE"){
      if(values.length!==4||values[0]!==nodes.length+1)throw new Error("native mixed NODE IDs must be dense and ordered");
      nodes.push(values.slice(1));
    }else{
      if(values.length!==10||!values.every(Number.isSafeInteger))throw new Error("native mixed element requires ten integer fields");
      if(section==="*ELEMENT_SOLID")solids.push({id:values[0]!,partId:values[1]!,nodes:values.slice(2)});
      else{
        if(values.slice(5,9).some(v=>v!==0)||values[9]!==2)throw new Error("native beam read-back does not support release/local overrides");
        beams.push({id:values[0]!,partId:values[1]!,nodes:[values[2]!,values[3]!],orientationNode:values[4]!});
      }
    }
  }
  if(!started||!ended)throw new Error("native mixed keyword framing is incomplete");
  const result={nodes,solids,beams};validateLsdynaMixedMesh(result);return result;
}
