import {generateRectangularGradedMesh} from "./graded-rectangle.js";
import {generateCircularGradedMesh} from "./graded-circle.js";
import {generateCylindricalGradedMesh} from "./graded-cylinder.js";
import {generateUniformReinforcedMesh} from "./reinforced-uniform.js";
import {generateGradedReinforcedMesh} from "./reinforced-graded.js";
import {generateRectangularGradedQuadMesh} from "./graded-quad.js";
import {generateCircularGradedQuadMesh} from "./graded-circle-quad.js";
import {meshToLsdynaKeyword,meshToLsdynaShellKeyword} from "./export.js";
import {meshToLsdynaMixedKeyword,parseNativeLsdynaMixedKeyword,validateLsdynaMixedSets} from "./lsdyna-mixed.js";
import {parseMeshText} from "./mesh-io.js";
import {minElementEdgeLength} from "./mesh.js";
import type {Mesh} from "./types.js";
import type {LsdynaMixedMesh} from "./lsdyna-mixed.js";
import type {Gui61RepairRequest} from "./gui61-repair.js";
import type {TransitionMeshRequest} from "./transition-mesh-request.js";

export const gui61Kinds=[
  ["rectangular-solid","矩形靶板"],["circular-solid","圆形靶板"],["cylindrical-solid","圆柱壳体"],
  ["reinforced-uniform","钢筋混凝土算法1"],["reinforced-graded","钢筋混凝土算法2"],
  ["circular-quad","2D圆面"],["rectangular-quad","2D矩形"]
] as const;
export type Gui61Kind=typeof gui61Kinds[number][0];
export interface Gui61Request {schemaVersion:1;kind:Gui61Kind;parameters:Record<string,unknown>;}
export interface Gui61Field {
  path:string;label:string;group:string;type:"number"|"choice"|"toggle";
  options?:readonly (readonly [string|number,string])[];
  on?:boolean|number;off?:boolean|number;disabled?:boolean;
  optional?:boolean;
}
// Match kernel defaults, not the larger demonstration values in the GUI presets.
const optionalFields:Partial<Record<Gui61Kind,Record<string,number|boolean|undefined>>>={
  "rectangular-solid":{angleDegrees:0,angleCorrection:false},
  "circular-solid":{angleDegrees:0,angleCorrection:false,elementLimit:undefined,approachElementLimit:false},
  "reinforced-uniform":{maximumRelativeDimensionChange:0,elementLimit:undefined,optimizeMeshSize:false},
  "reinforced-graded":{"concrete.angleDegrees":0,"concrete.angleCorrection":false}
};
const rectangle={fullSize:[80,80,16],refinedSize:[32,32],fineSize:1,coarseSize:2,reductions:{x:3,y:3,z:3},
  thicknessTransition:true,transitionStages:1,modelFraction:"half",angleDegrees:0,angleCorrection:false};
const defaults:Record<Gui61Kind,Record<string,unknown>>={
  "rectangular-solid":rectangle,
  "circular-solid":{radius:20,thickness:6,coreHalfSize:8,fineSize:1,coarseSize:2,reductions:{x:3,y:3},modelFraction:"half",angleDegrees:0,angleCorrection:false,elementLimit:100000,approachElementLimit:false},
  "cylindrical-solid":{outerRadius:20,thickness:3,length:40,coreArcLength:12,coreLength:12,fineSize:1,radialSize:1,coarseSize:3,layers:1,modelFraction:"quarter",thicknessTransition:true},
  "reinforced-uniform":{size:[20,12,8],meshSize:1,barCounts:[4,3,3],cover:[1,1,1],includeZBars:true,connectivity:"separate",dimensionPolicy:"source-aligned",maximumRelativeDimensionChange:.2,elementLimit:100000,optimizeMeshSize:false},
  "reinforced-graded":{concrete:{...rectangle,fullSize:[40,32,12],refinedSize:[16,12]},rebarMeshSize:2,barCounts:[4,5,3],cover:[2,2,0,0,2,2],includeZBars:true,connectivity:"separate"},
  "circular-quad":{radius:20,refinedRadius:10,fineSize:1,coarseSize:2,modelFraction:"quarter"},
  "rectangular-quad":{positiveSize:[20,15],fineRegionSize:[8,6],coarseCounts:[10,10],reductions:{x:3,y:3},modelFraction:"quarter"}
};
export function defaultGui61Request(kind:Gui61Kind):Gui61Request {
  if(!Object.hasOwn(defaults,kind))throw new RangeError("unknown GUI61 generator");
  return {schemaVersion:1,kind,parameters:structuredClone(defaults[kind])};
}
export function gui61Value(request:Gui61Request,path:string):unknown {
  let value:unknown=request.parameters;
  for(const key of path.split(".")){if(!value||typeof value!=="object")return undefined;value=(value as Record<string,unknown>)[key];}
  return value===undefined?optionalFields[request.kind]?.[path]:value;
}
export function updateGui61Value(request:Gui61Request,path:string,value:unknown):Gui61Request {
  if(!gui61Fields(request).some(f=>f.path===path))throw new RangeError("unknown GUI61 field");
  const next=structuredClone(request),keys=path.split(".");
  let target=next.parameters;
  for(const key of keys.slice(0,-1))target=target[key] as Record<string,unknown>;
  if(value===undefined&&Object.hasOwn(optionalFields[request.kind]??{},path))delete target[keys.at(-1)!];
  else target[keys.at(-1)!]=value;
  return next;
}
export function gui61Fields(request:Gui61Request):Gui61Field[]{
  const fields:Gui61Field[]=[];
  const n=(path:string,label:string,group="几何与网格")=>fields.push({path,label,group,type:"number"});
  const choice=(path:string,label:string,options:Gui61Field["options"],group="过渡与份额")=>fields.push({path,label,group,type:"choice",options:options!});
  const toggle=(path:string,label:string,on:boolean|number=true,off:boolean|number=false,group="过渡与份额")=>fields.push({path,label,group,type:"toggle",on,off});
  const fraction=(path="modelFraction")=>choice(path,"模型份额",[["quarter","1/4"],["half","1/2"],["full","完整"]]);
  const ratio=(path:string,label:string)=>choice(path,label,[[3,"3→1"],[2,"4→2"]]);
  const bars=(graded:boolean)=>{
    const group="钢筋";["X","Y","Z"].forEach((a,i)=>n(`barCounts.${i}`,`${a}向位置数`,group));
    (graded?["X负侧","X正侧","Y负侧","Y正侧","Z下侧","Z上侧"]:["X","Y","Z"]).forEach((a,i)=>n(`cover.${i}`,`${a}保护层`,group));
    toggle("includeZBars","隐藏Z向钢筋",false,true,group);
    choice("connectivity","节点连接",[["separate","独立节点"],["shared","严格共节点 · 原生扩展"]],group);
  };
  if(request.kind==="rectangular-solid"||request.kind==="reinforced-graded"){
    const p=request.kind==="reinforced-graded"?"concrete.":"";
    ["X全长","Y全宽","厚度"].forEach((a,i)=>n(`${p}fullSize.${i}`,a));
    n(p+"refinedSize.0","加密区X全长");n(p+"refinedSize.1","加密区Y全宽");n(p+"fineSize","细网格目标尺寸");n(p+"coarseSize","粗网格尺寸");
    for(const a of ["x","y","z"])ratio(p+"reductions."+a,a.toUpperCase()+"向倍率");
    toggle(p+"thicknessTransition","纵向（厚度）过渡");toggle(p+"transitionStages",p?"双层过渡 · 原生扩展":"双层过渡",2,1);
    fraction(p+"modelFraction");n(p+"angleDegrees","倾角（度）","过渡与份额");toggle(p+"angleCorrection","自动修正倾角");
    if(p){n("rebarMeshSize","钢筋段长","钢筋");bars(true);}
    fields.find(f=>f.path===p+"reductions.z")!.disabled=!gui61Value(request,p+"thicknessTransition");
    const quarter=gui61Value(request,p+"modelFraction")==="quarter";
    fields.find(f=>f.path===p+"angleDegrees")!.disabled=quarter;
    fields.find(f=>f.path===p+"angleCorrection")!.disabled=quarter;
  }else if(request.kind==="circular-solid"){
    for(const [p,l] of [["radius","外半径"],["thickness","厚度"],["coreHalfSize","中心方块半边长"],["fineSize","细网格目标尺寸"],["coarseSize","粗网格尺寸"]])n(p!,l!);
    ratio("reductions.x","B / X向倍率");ratio("reductions.y","C / Y向倍率");fraction();n("angleDegrees","倾角（度）","过渡与份额");toggle("angleCorrection","自动修正倾角");
    n("elementLimit","单元数量上限","数量控制");toggle("approachElementLimit","逼近数量上限",true,false,"数量控制");
  }else if(request.kind==="cylindrical-solid"){
    for(const [p,l] of [["outerRadius","外半径"],["thickness","单层壁厚"],["length","轴向全长"],["coreArcLength","加密区周向弧长"],["coreLength","加密区轴向全长"],["fineSize","细网格目标尺寸"],["radialSize","厚度目标尺寸"],["coarseSize","粗网格目标尺寸"],["layers","物理层数"]])n(p!,l!);
    fraction();toggle("thicknessTransition","厚度过渡");
  }else if(request.kind==="reinforced-uniform"){
    ["X全长","Y全宽","厚度"].forEach((a,i)=>n(`size.${i}`,a));n("meshSize","网格目标尺寸");bars(false);
    choice("dimensionPolicy","尺寸处理",[["preserve","保持尺寸"],["source-aligned","按网格对齐尺寸"]],"数量控制");
    n("maximumRelativeDimensionChange","尺寸调整阈值","数量控制");n("elementLimit","实体+梁数量上限","数量控制");toggle("optimizeMeshSize","数量优化",true,false,"数量控制");
  }else if(request.kind==="circular-quad"){
    for(const [p,l] of [["radius","外半径"],["refinedRadius","加密半径"],["fineSize","细网格目标尺寸"],["coarseSize","粗网格目标尺寸"]])n(p!,l!);fraction();
  }else if(request.kind==="rectangular-quad"){
    for(const [p,l] of [["positiveSize","正半轴范围"],["fineRegionSize","加密区正半轴范围"],["coarseCounts","粗网格计数"]])for(const [i,a] of ["X","Y"].entries())n(`${p}.${i}`,a+l);
    ratio("reductions.x","X向倍率");ratio("reductions.y","Y向倍率");fraction();
  }else throw new RangeError("unknown GUI61 generator");
  for(const field of fields)if(Object.hasOwn(optionalFields[request.kind]??{},field.path))field.optional=true;
  return fields;
}
export interface Gui61Generated {
  request:Gui61Request|Gui61RepairRequest|TransitionMeshRequest;mesh:Mesh;model?:LsdynaMixedMesh;plan:unknown;quality:unknown;
  files:Record<string,string>;summary:{nodes:number;solids:number;beams:number;quads:number;warnings:string[]};
}
export function generateGui61(request:Gui61Request):Gui61Generated {
  if(!request||request.schemaVersion!==1||!request.parameters||typeof request.parameters!=="object"||Array.isArray(request.parameters))throw new RangeError("invalid GUI61 request");
  if(Object.keys(request).some(k=>!["schemaVersion","kind","parameters"].includes(k)))throw new RangeError("unknown GUI61 request field");
  const generators={"rectangular-solid":generateRectangularGradedMesh,"circular-solid":generateCircularGradedMesh,"cylindrical-solid":generateCylindricalGradedMesh,
    "reinforced-uniform":generateUniformReinforcedMesh,"reinforced-graded":generateGradedReinforcedMesh,"circular-quad":generateCircularGradedQuadMesh,"rectangular-quad":generateRectangularGradedQuadMesh};
  const generator=generators[request.kind];if(!generator)throw new RangeError("unknown GUI61 generator");
  // Native entry points own parameter validation; never drop unknown fields here.
  const r=generator(request.parameters as never);
  const mesh="mesh" in r?r.mesh:r.concreteMesh,model="model" in r?r.model:undefined;
  if(model&&"nodeSets" in r&&"cellSets" in r)validateLsdynaMixedSets(model,{nodeSets:r.nodeSets,cellSets:r.cellSets});
  const keyword=model?meshToLsdynaMixedKeyword(model,{coordinateFormat:"compact"}):mesh.kind==="Q1"?meshToLsdynaShellKeyword(mesh,{coordinateFormat:"compact"}):meshToLsdynaKeyword(mesh,{coordinateFormat:"compact"});
  const back=model?parseNativeLsdynaMixedKeyword(keyword):parseMeshText(keyword,"generated.k");
  const points=model?model.nodes:mesh.nodes;
  const same=model?JSON.stringify((back as LsdynaMixedMesh).solids)===JSON.stringify(model.solids)&&JSON.stringify((back as LsdynaMixedMesh).beams)===JSON.stringify(model.beams):JSON.stringify((back as Mesh).elements)===JSON.stringify(mesh.elements);
  if(!same||back.nodes.length!==points.length)throw new Error("GUI61 K read-back connectivity mismatch");
  let error=0;back.nodes.forEach((p,i)=>p.forEach((v,a)=>{error=Math.max(error,Math.abs(v-points[i]![a]!));}));
  if(error>minElementEdgeLength(mesh)*1e-8)throw new Error("GUI61 K coordinate precision failed");
  const warnings=[...("warnings" in r.plan?r.plan.warnings:[]),...("warnings" in r.quality?r.quality.warnings:[])];
  const summary={nodes:points.length,solids:mesh.kind==="H1"?mesh.elements.length:0,quads:mesh.kind==="Q1"?mesh.elements.length:0,beams:model?.beams.length??0,warnings:[...new Set(warnings)]};
  const files:Record<string,string>={"mesh.k":keyword,"request.json":JSON.stringify(request,null,2),"report.json":JSON.stringify({request,plan:r.plan,quality:r.quality,summary,readbackMaximumCoordinateError:error},null,2)};
  if("nodeSets" in r)files["node_sets.json"]=JSON.stringify(r.nodeSets);
  if("cellSets" in r)files["cell_sets.json"]=JSON.stringify(r.cellSets);
  if("parentElementIds" in r)files["lineage.json"]=JSON.stringify({parentElementIds:r.parentElementIds,coreParentIds:r.coreParentIds});
  return {request:structuredClone(request),mesh,...(model?{model}:{}),plan:r.plan,quality:r.quality,files,summary};
}
