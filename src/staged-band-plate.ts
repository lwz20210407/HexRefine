import type {Mesh,Point} from "./types.js";
import {createHexUnitCubeMesh} from "./grid.js";
import {refineQ1To4Q1} from "./templates.js";
import {regularSweepTemplateLibrary} from "./two-to-one-sweep-templates.js";
import {H1_FACES,boundaryKey} from "./topology.js";
import {mergeCoincidentNodes} from "./mesh.js";
import {checkNoHangingNodes} from "./conformance.js";
import {hexElementSignedVolume,minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {hexJacobian} from "./hex-quality-internal.js";
import {determinant3Scaled,materializeScaledValue,scaledValueSign} from "./hex-numeric-internal.js";

export const STAGED_BAND_ELEMENT_LIMIT=200000;
export interface StagedBandTransition {
  axis:0|2;
  reduction:2|3;
  width:number;
  /** Normal station measured from coarse to fine; defaults to1/2 for2:1,1/3 for3:1. */
  middleFraction?:number;
}
export interface StagedBandPlateSpec {
  fullSize:readonly [number,number,number];
  coreWidth:number;
  coreRows:number;
  coarseSectionCounts:readonly [number,number];
  outerRows:number;
  /** Ordered from the outer coarse region toward the centered Y-normal core band. */
  stages:readonly StagedBandTransition[];
  minimumCornerScaledJacobian?:number;
  elementLimit?:number;
}
const positive=(v:number)=>Number.isFinite(v)&&v>0;
const integer=(v:number)=>Number.isSafeInteger(v)&&v>0;
function keys(value:object,allowed:readonly string[]){
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw new RangeError("unsupported staged-band option");
}
export function planStagedBandPlate(spec:StagedBandPlateSpec){
  keys(spec,["fullSize","coreWidth","coreRows","coarseSectionCounts","outerRows","stages","minimumCornerScaledJacobian","elementLimit"]);
  if(!Array.isArray(spec.fullSize)||spec.fullSize.length!==3||!spec.fullSize.every(positive)||!positive(spec.coreWidth)||spec.coreWidth>=spec.fullSize[1])throw new RangeError("invalid staged-band dimensions");
  if(!Array.isArray(spec.coarseSectionCounts)||spec.coarseSectionCounts.length!==2||!spec.coarseSectionCounts.every(integer)||!integer(spec.coreRows)||!integer(spec.outerRows))throw new RangeError("invalid staged-band counts");
  const limit=spec.elementLimit??STAGED_BAND_ELEMENT_LIMIT;
  if(!integer(limit)||limit>STAGED_BAND_ELEMENT_LIMIT)throw new RangeError("invalid staged-band element limit");
  if(spec.minimumCornerScaledJacobian!==undefined&&(!positive(spec.minimumCornerScaledJacobian)||spec.minimumCornerScaledJacobian>1))throw new RangeError("invalid staged-band minimum SJ");
  if(!Array.isArray(spec.stages)||spec.stages.length<1||spec.stages.length>4)throw new RangeError("staged-band requires one to four explicit stages");
  const fullSize=[...spec.fullSize] as [number,number,number],coreRange=[(fullSize[1]-spec.coreWidth)/2,(fullSize[1]+spec.coreWidth)/2] as const;
  let transitionWidth=0;
  for(const s of spec.stages){keys(s,["axis","reduction","width","middleFraction"]);if(![0,2].includes(s.axis)||![2,3].includes(s.reduction)||!positive(s.width)||s.middleFraction!==undefined&&(!positive(s.middleFraction)||s.middleFraction>=1))throw new RangeError("invalid staged-band transition");transitionWidth+=s.width;}
  const outerWidth=coreRange[0]-transitionWidth,expectedVolume=fullSize.reduce((a,b)=>a*b,1);
  if(!positive(outerWidth)||!positive(expectedVolume))throw new RangeError("transition bands leave no resolved coarse outer region");
  let counts=[...spec.coarseSectionCounts] as [number,number],normal=outerWidth;
  const stagePlans=spec.stages.map((s,index)=>{
    const before=[...counts] as [number,number],slot=s.axis===0?0:1;
    if(s.reduction===2&&before[slot]%2)throw new RangeError("this symmetric2:1 band family requires an even active coarse count; odd open-boundary variants are not implemented");
    counts[slot]*=s.reduction;
    const normalRange=[normal,normal+s.width] as const;normal+=s.width;
    return {index,axis:s.axis,reduction:s.reduction,width:s.width,middleFraction:s.middleFraction??(s.reduction===2?.5:1/3),
      beforeCounts:before,afterCounts:[...counts] as [number,number],lowerRange:normalRange,upperRange:[fullSize[1]-normalRange[1],fullSize[1]-normalRange[0]] as const,
      cellsPerSide:before[0]*before[1]*(s.reduction===2?3:4)};
  });
  const coreCells=counts[0]*spec.coreRows*counts[1],farCells=2*spec.coarseSectionCounts[0]*spec.outerRows*spec.coarseSectionCounts[1];
  const expectedCells=coreCells+farCells+2*stagePlans.reduce((sum,s)=>sum+s.cellsPerSide,0);
  if(!integer(expectedCells)||expectedCells>limit)throw new RangeError("staged-band output exceeds its element budget before allocation");
  const coreSpacing=[fullSize[0]/counts[0],spec.coreWidth/spec.coreRows,fullSize[2]/counts[1]] as const;
  const coarseSpacing=[fullSize[0]/spec.coarseSectionCounts[0],outerWidth/spec.outerRows,fullSize[2]/spec.coarseSectionCounts[1]] as const;
  const minimumSpacing=Math.min(...coreSpacing,...coarseSpacing,...stagePlans.map(s=>s.width*Math.min(s.middleFraction,1-s.middleFraction)));
  if(!(minimumSpacing>Math.max(...fullSize)*1e-12))throw new RangeError("staged-band dimensions contain numerically unresolved intervals");
  return {fullSize,coreRange,outerWidth,coreRows:spec.coreRows,outerRows:spec.outerRows,coarseSectionCounts:[...spec.coarseSectionCounts] as [number,number],
    fineSectionCounts:counts,coreSpacing,coarseSpacing,minimumSpacing,stagePlans,coreCells,farCells,expectedCells,expectedVolume,elementLimit:limit};
}

type Quad=readonly (readonly [number,number])[];
let halfQuads:readonly Quad[]|undefined;
function transitionQuads(reduction:2|3):readonly Quad[]{
  if(reduction===3){const t=refineQ1To4Q1([[1,0],[0,0],[0,1],[1,1]]);return t.elements.map(e=>e.map(n=>[t.nodes[n-1]![0]!,1-t.nodes[n-1]![1]!] as const));}
  if(halfQuads)return halfQuads;
  // Reuse the audited3-Hex directional prism; project a complete extrusion wall.
  for(const t of regularSweepTemplateLibrary().values())if(t.name==="pattern2"&&t.nodes.every(p=>Math.abs(p[0])===1)){
    const q=t.elements.map(e=>H1_FACES.map(f=>f.map(n=>t.nodes[e[n-1]!]!)).find(points=>points.every(p=>p[0]===-1))!.map(p=>[(p[2]+1)/2,(1-p[1])/2] as const));
    const count=(v:number)=>q.reduce((sum,f)=>sum+f.filter((p,i)=>p[1]===v&&f[(i+1)%4]![1]===v).length,0);
    if(count(0)===1&&count(1)===2){halfQuads=q;return q;}
  }
  throw new Error("native directional half-prism is unavailable");
}

/** New rectangular geometry, not a local-refinement installer for an imported mesh. */
export function generateStagedBandPlate(spec:StagedBandPlateSpec){
  const plan=planStagedBandPlate(spec),raw:Mesh={kind:"H1",nodes:[],elements:[]},regions:string[]=[];
  const append=(input:readonly Point[],region:string)=>{
    const points=hexElementSignedVolume(input)<0?[0,3,2,1,4,7,6,5].map(i=>input[i]!):input;
    const start=raw.nodes.length;raw.nodes.push(...points.map(p=>[...p]));raw.elements.push([1,2,3,4,5,6,7,8].map(n=>n+start));regions.push(region);
  };
  const box=(lo:readonly number[],hi:readonly number[],counts:readonly [number,number,number],region:string)=>{
    const m=createHexUnitCubeMesh(...counts);
    for(const e of m.elements)append(e.map(n=>m.nodes[n-1]!.map((u,a)=>lo[a]!+u*(hi[a]!-lo[a]!))),region);
  };
  const [length,width,height]=plan.fullSize,[cx,cz]=plan.coarseSectionCounts;
  box([0,0,0],[length,plan.outerWidth,height],[cx,plan.outerRows,cz],"far");
  box([0,width-plan.outerWidth,0],[length,width,height],[cx,plan.outerRows,cz],"far");
  for(const s of plan.stagePlans){
    const axis=s.axis,other=axis===0?2:0,n=s.beforeCounts[axis===0?0:1],no=s.beforeCounts[other===0?0:1],extent=plan.fullSize[axis]!,otherExtent=plan.fullSize[other]!;
    for(const upper of [false,true])for(let j=0;j<n;j++)for(let k=0;k<no;k++)for(const quad of transitionQuads(s.reduction)){
      const points=quad.map(([uu,v])=>{
        const u=s.reduction===2&&j%2===1?1-uu:uu,point=[0,s.lowerRange[0]+(v===.5?s.middleFraction:v)*s.width,0];
        point[axis]=(j+u)*extent/n;point[other]=k*otherExtent/no;if(upper)point[1]=width-point[1]!;return point;
      });
      append([...points,...points.map(p=>p.map((v,a)=>a===other?(k+1)*otherExtent/no:v))],`transition-${s.index+1}`);
    }
  }
  box([0,plan.coreRange[0],0],[length,plan.coreRange[1],height],[plan.fineSectionCounts[0],plan.coreRows,plan.fineSectionCounts[1]],"core");
  const tolerance=plan.minimumSpacing*1e-8,mesh=mergeCoincidentNodes(raw,tolerance);
  if(mesh.elements.length!==plan.expectedCells||regions.length!==mesh.elements.length||!checkNoHangingNodes(mesh,tolerance).ok)throw new Error("staged-band count or shared-face conformity failure");
  let minimumSJ=Infinity,minimumGauss=Infinity,volume=0;
  const qualityByRegion:Record<string,{cells:number;minimumCornerSJ:number}>={},faces=new Map<string,{nodes:number[];count:number}>();
  for(const [i,e] of mesh.elements.entries()){
    if(e.length!==8||new Set(e).size!==8)throw new Error("staged-band produced a degenerate Hex");
    const p=e.map(n=>mesh.nodes[n-1]!),sj=minimumHexCornerScaledJacobian(p),region=qualityByRegion[regions[i]!]??{cells:0,minimumCornerSJ:Infinity};
    region.cells++;region.minimumCornerSJ=Math.min(region.minimumCornerSJ,sj);qualityByRegion[regions[i]!]=region;
    minimumSJ=Math.min(minimumSJ,sj);volume+=hexElementSignedVolume(p);
    for(const u of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const v of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const w of [-1/Math.sqrt(3),1/Math.sqrt(3)]){
      const determinant=determinant3Scaled(hexJacobian(p,u,v,w)),value=materializeScaledValue(determinant);
      if(scaledValueSign(determinant)<=0||!positive(value))throw new Error("staged-band has a nonpositive/unresolved Gauss sample");minimumGauss=Math.min(minimumGauss,value);
    }
    for(const f of H1_FACES){const nodes=f.map(n=>e[n-1]!),key=boundaryKey(nodes),entry=faces.get(key)??{nodes,count:0};entry.count++;if(entry.count>2)throw new Error("nonmanifold staged-band face");faces.set(key,entry);}
  }
  if(!positive(minimumSJ)||minimumSJ<(spec.minimumCornerScaledJacobian??0))throw new Error(`staged-band minimum SJ ${minimumSJ} fails the requested quality gate`);
  const relativeVolumeError=Math.abs(volume/plan.expectedVolume-1);if(relativeVolumeError>1e-8)throw new Error("staged-band discrete volume failure");
  let externalFaces=0;const edges=new Map<string,number>(),boundaryNodes=new Set<number>();
  for(const f of faces.values())if(f.count===1){
    if(![0,1,2].some(a=>[0,plan.fullSize[a]!].some(level=>f.nodes.every(n=>Math.abs(mesh.nodes[n-1]![a]!-level)<=tolerance))))throw new Error("staged-band has an unexpected internal free face");
    externalFaces++;for(const [i,n] of f.nodes.entries()){boundaryNodes.add(n);const key=boundaryKey([n,f.nodes[(i+1)%4]!]);edges.set(key,(edges.get(key)??0)+1);}
  }
  const boundaryEuler=boundaryNodes.size-edges.size+externalFaces;
  if(boundaryEuler!==2||[...edges.values()].some(n=>n!==2))throw new Error("staged-band exterior is not a closed quad sphere");
  return {mesh,plan,regions,quality:{minimumCornerScaledJacobian:minimumSJ,minimumGaussDeterminant:minimumGauss,volume,relativeVolumeError,
    externalFaces,boundaryEuler,unexpectedInternalFreeFaces:0,byRegion:qualityByRegion},
    limitation:"New Y-normal symmetric rectangular band only; no imported-node preservation, CAD sweep, mixed wedges, general3D WB, or GUI integration."};
}
