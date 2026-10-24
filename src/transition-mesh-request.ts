import {generatePlanarTransitionBand,generateAnnularTransitionBand,generateHybridTransitionBand,extrudeTransitionBand,planTransitionBand,TransitionBandCountError} from "./transition-bands.js";
import {generateRectangularTransitionRings} from "./transition-rect-rings.js";
import {generateAxialTransitionTube} from "./transition-axial-tube.js";
import {meshToLsdynaKeyword,meshToLsdynaShellKeyword,preparedExportToInp,convertMeshForExport} from "./export.js";
import {parseMeshText} from "./mesh-io.js";
import {minElementEdgeLength} from "./mesh.js";
import type {Gui61Generated} from "./gui61-generators.js";
import {planTransitionAngularSeams,type TransitionAngularSeamOptions} from "./transition-angular-seams.js";
import {extendSolidTransitionRegions,auditSolidTransitionReadback,type SolidTransitionRegularRegions} from "./transition-solid-regions.js";

export const transitionMeshModes=[
  ["planar","平面直带"],["annular","圆环 / 扇区"],["hybrid","同层混合倍率"],
  ["rectangular-rings","四侧矩形环带"],["axial","圆柱轴向过渡"]
] as const;
export type TransitionMeshMode=typeof transitionMeshModes[number][0];
export interface TransitionMeshRequest {
  schemaVersion:1;kind:"transition-mesh";mode:TransitionMeshMode;parameters:Record<string,unknown>;
  extrusion?:{height:number;layers:number};
  regularRegions?:SolidTransitionRegularRegions;
}
const DEFAULTS:Record<TransitionMeshMode,Record<string,unknown>>={
  planar:{length:24,depth:6,fineSegments:32,ratios:[2,2],fineSide:"bottom",rotationDegrees:0,origin:[0,0]},
  annular:{innerRadius:10,outerRadius:18,fineSegments:64,ratios:[2,2],fineSide:"inner",startAngleDegrees:0,sweepAngleDegrees:360,center:[0,0]},
  hybrid:{length:14,depth:2,fineSegments:14,coarseSegments:6,order:"interleave",fineSide:"bottom",rotationDegrees:0,origin:[0,0]},
  "rectangular-rings":{innerSize:[12,8],fineSegments:[12,8],stages:2,ratio:2,includeCore:true,optimizeCorners:true,rotationDegrees:0,origin:[0,0]},
  axial:{innerRadius:10,outerRadius:12,length:6,radialLayers:2,fineSegments:72,ratios:[2,2],fineEnd:"start",startAngleDegrees:0,sweepAngleDegrees:360,axis:[0,0,1],origin:[0,0,0]}
};
export function defaultTransitionMeshRequest(mode:TransitionMeshMode):TransitionMeshRequest {
  if(!Object.hasOwn(DEFAULTS,mode))throw new RangeError("unknown transition mesh mode");
  return {schemaVersion:1,kind:"transition-mesh",mode,parameters:structuredClone(DEFAULTS[mode])};
}
function record(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==="object"&&!Array.isArray(value);}
export function normalizeTransitionMeshRequest(input:unknown):TransitionMeshRequest {
  if(!record(input)||input.schemaVersion!==1||(input.kind!==undefined&&input.kind!=="transition-mesh")
      ||!transitionMeshModes.some(([mode])=>mode===input.mode)||!record(input.parameters)
      ||Object.keys(input).some(k=>!["schemaVersion","kind","mode","parameters","extrusion","regularRegions"].includes(k)))
    throw new Error("Expected schemaVersion=1, supported mode and parameters");
  if(input.extrusion!==undefined&&(!record(input.extrusion)||Object.keys(input.extrusion).some(k=>k!=="height"&&k!=="layers")))
    throw new Error("invalid extrusion specification");
  if(input.mode==="axial"&&input.extrusion!==undefined)throw new Error("axial tube already has radial solid layers; extra extrusion is invalid");
  if(input.regularRegions!==undefined&&(!["planar","annular","axial"].includes(input.mode as string)||!record(input.regularRegions)))
    throw new RangeError("regularRegions is supported only for planar, annular and axial solid transitions");
  return structuredClone({...input,kind:"transition-mesh"}) as unknown as TransitionMeshRequest;
}

/** Explicit user action: suggest counts without changing geometry or block order. */
export function suggestTransitionMeshCounts(input:unknown) {
  const request=normalizeTransitionMeshRequest(input),p=request.parameters,changes:{field:string;before:unknown;after:unknown}[]=[];
  const integer=(v:unknown,max:number)=>{
    if(typeof v!=="number"||!Number.isSafeInteger(v)||v<1||v>max)throw new RangeError("count suggestions require positive bounded integers");return v;
  };
  const update=(field:string,next:unknown)=>{if(JSON.stringify(p[field])!==JSON.stringify(next)){changes.push({field,before:structuredClone(p[field]),after:structuredClone(next)});p[field]=next;}};
  if(request.mode==="hybrid"){
    if(p.blocks!==undefined){
      if(!Array.isArray(p.blocks)||!p.blocks.length||p.blocks.some(b=>b!=="pair2"&&b!=="single3"))throw new RangeError("invalid explicit hybrid blocks");
      update("fineSegments",integer(p.blocks.reduce((n,b)=>n+(b==="pair2"?4:3),0),200000));
      update("coarseSegments",integer(p.blocks.reduce((n,b)=>n+(b==="pair2"?2:1),0),100000));
    }else{
      const n=integer(p.fineSegments,200000),m=integer(p.coarseSegments,100000),legal=[];
      for(let candidate=Math.ceil(n/3);candidate<=Math.floor(n/2);candidate++)if((3*candidate-n)%2===0)legal.push(candidate);
      if(!legal.length)throw new RangeError("no paired-template coarse count fits this fine count; change the fine count");
      legal.sort((a,b)=>Math.abs(a-m)-Math.abs(b-m)||a-b);update("coarseSegments",legal[0]);
    }
  }else if(request.mode==="rectangular-rings"){
    if(!Array.isArray(p.fineSegments)||p.fineSegments.length!==2)throw new RangeError("rectangle suggestions need X/Y counts");
    const ratio=p.ratio??2;if(ratio!==2&&ratio!==3)throw new RangeError("invalid rectangle ratio");
    const period=ratio===2?4:3;
    update("fineSegments",p.fineSegments.map(v=>{
      const n=integer(v,100000),lo=Math.floor(n/period)*period,hi=lo+period;
      return [lo,hi].filter(k=>k>0&&k<=100000).sort((a,b)=>Math.abs(a-n)-Math.abs(b-n)||a-b)[0]!;
    }));
  }else{
    const n=integer(p.fineSegments,200000);
    try{planTransitionBand({fineSegments:n,ratios:p.ratios as (2|3)[],depth:1});}
    catch(e){if(!(e instanceof TransitionBandCountError))throw e;update("fineSegments",[...e.nearbyCounts].sort((a,b)=>Math.abs(a-n)-Math.abs(b-n)||a-b)[0]);}
    if((request.mode==="annular"||request.mode==="axial")&&p.seamAnglesDegrees!==undefined){
      const plan=planTransitionBand({fineSegments:p.fineSegments as number,ratios:p.ratios as (2|3)[],depth:1});
      const alignment=planTransitionAngularSeams(plan,p as TransitionAngularSeamOptions);
      if(alignment.conflicts.some(c=>c.reason==="outside-sector"))throw new RangeError("a declared seam is outside the requested sector; counts cannot fix its location");
      if(!alignment.compatible){
        const legal:number[]=[];
        for(let count=plan.requiredMultiple;count<=200000;count+=plan.requiredMultiple){
          const counts=[count];for(const r of plan.ratios)counts.push(counts.at(-1)!/r);
          if(planTransitionAngularSeams({counts,ratios:plan.ratios},p as TransitionAngularSeamOptions).compatible)legal.push(count);
        }
        if(!legal.length)throw new RangeError("no compatible whole-template seam count in the supported range [1,200000]");
        legal.sort((a,b)=>Math.abs(a-n)-Math.abs(b-n)||a-b);update("fineSegments",legal[0]);
      }
    }
  }
  return {request,changes,geometryChecked:false as const};
}

/** One native implementation for CLI, HTTP worker and offline browser generation. */
export function generateTransitionMeshRequest(input:unknown):Gui61Generated {
  const request=normalizeTransitionMeshRequest(input);
  const generators={planar:generatePlanarTransitionBand,annular:generateAnnularTransitionBand,
    hybrid:generateHybridTransitionBand,"rectangular-rings":generateRectangularTransitionRings};
  const base=request.mode==="axial"?generateAxialTransitionTube(request.parameters as never):generators[request.mode](request.parameters as never);
  const band=request.extrusion&&base.mesh.kind==="Q1"
    ?extrudeTransitionBand(base as Exclude<typeof base,ReturnType<typeof generateAxialTransitionTube>>,request.extrusion.height,request.extrusion.layers):base;
  const extended=request.regularRegions?extendSolidTransitionRegions(band,request.mode as "planar"|"annular"|"axial",request.parameters,request.regularRegions):undefined;
  const result=extended??band;
  const keyword=(result.mesh.kind==="H1"?meshToLsdynaKeyword:meshToLsdynaShellKeyword)(result.mesh,{coordinateFormat:"compact"});
  const cellSets=new Map<string,number[]>();
  const regionNames=extended?.elementRegions;
  result.stageIds.forEach((stage,i)=>{const name=regionNames?.[i]??(stage===0?"core":`stage_${stage}`);if(!cellSets.has(name))cellSets.set(name,[]);cellSets.get(name)!.push(i+1);});
  const converted=convertMeshForExport(result.mesh);
  const inp=preparedExportToInp({...converted,sets:{nodeSets:new Map(Object.entries(result.nodeSets)),cellSets,
    missingCellIdsBySet:new Map(),missingNodeIdsBySet:new Map()}},{includeBoundarySets:false,title:"HexRefine native transition mesh"});
  const coordinateErrors:Record<string,number>={};
  const solidReadback:Record<string,ReturnType<typeof auditSolidTransitionReadback>>={};
  for(const [name,text] of [["mesh.k",keyword],["mesh.inp",inp]] as const){
    const back=parseMeshText(text,name);
    if(back.nodes.length!==result.mesh.nodes.length||JSON.stringify(back.elements)!==JSON.stringify(result.mesh.elements))throw new Error(`${name} connectivity read-back failed`);
    coordinateErrors[name]=back.nodes.reduce((error,p,i)=>Math.max(error,Math.hypot(...p.map((v,a)=>v-result.mesh.nodes[i]![a]!))),0);
    if(coordinateErrors[name]!>minElementEdgeLength(result.mesh)*1e-8)throw new Error(`${name} coordinate precision failed`);
    if(extended)solidReadback[name]=auditSolidTransitionReadback(back,extended.quality.volume);
  }
  const summary={nodes:result.mesh.nodes.length,solids:result.mesh.kind==="H1"?result.mesh.elements.length:0,
    quads:result.mesh.kind==="Q1"?result.mesh.elements.length:0,beams:0,warnings:[...result.quality.warnings]};
  const report={schemaVersion:1,implementation:"native-existing-hexrefine-templates",request,nodes:summary.nodes,elements:result.mesh.elements.length,
    kind:result.mesh.kind,summary,plan:result.plan,quality:result.quality,baseGeometryQuality:base.quality,
    checks:{geometry:true,conformance:true,keywordReadback:true,inpReadback:true},coordinateErrors,...(extended?{solidReadback}:{}),
    limitations:"Independent generated mesh. No solver material, load, coupling or existing-model replacement is inferred."};
  return {request,mesh:result.mesh,plan:result.plan,quality:result.quality,summary,files:{
    "mesh.k":keyword,"mesh.inp":inp,"request.json":JSON.stringify(request,null,2),"report.json":JSON.stringify(report,null,2),
    "sets.json":JSON.stringify({nodeSets:result.nodeSets,cellSets:Object.fromEntries(cellSets)}),
    "lineage.json":JSON.stringify({stageIds:result.stageIds,...("elementRegions" in result?{elementRegions:result.elementRegions}:{}),...("elementRoles" in base?{baseElementRoles:base.elementRoles}:{})})}};
}
