import {createHexUnitCubeMesh} from "./grid.js";
import type {Point} from "./types.js";
import type {LsdynaMixedMesh,MixedBeamRecord} from "./lsdyna-mixed.js";
import {validateLsdynaMixedMesh} from "./lsdyna-mixed.js";
import {hexElementSignedVolume,minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {hexJacobian} from "./hex-quality-internal.js";
import {auditReinforcementBeams} from "./reinforcement-quality.js";

export interface UniformReinforcementSpec {
  size:readonly [number,number,number];
  meshSize:number;
  /** Counts of bar positions along X, Y, Z; not the number of segments. */
  barCounts:readonly [number,number,number];
  cover:readonly [number,number,number];
  includeZBars:boolean;
  /** Separate leaves coupling unspecified; shared imposes common endpoint translations. */
  connectivity:"separate"|"shared";
  dimensionPolicy:"preserve"|"source-aligned";
  maximumRelativeDimensionChange?:number;
  concretePartId?:number;
  rebarPartId?:number;
  elementLimit?:number;
  optimizeMeshSize?:boolean;
  meshSizeSearch?:{
    minimum:number;
    maximum:number;
    step?:number;
    maximumTotalRelativeDimensionChange?:number;
  };
}

export function planUniformReinforcement(spec:UniformReinforcementSpec){
  const allowed=new Set(["size","meshSize","barCounts","cover","includeZBars","connectivity","dimensionPolicy","maximumRelativeDimensionChange","concretePartId","rebarPartId","elementLimit","optimizeMeshSize","meshSizeSearch"]);
  if(Object.keys(spec).some(k=>!allowed.has(k)))throw new RangeError("unknown uniform reinforcement option");
  for(const key of ["size","barCounts","cover"] as const)if(!Array.isArray(spec[key])||spec[key].length!==3)throw new RangeError(`${key} requires three components`);
  if([...spec.size,spec.meshSize].some(x=>!Number.isFinite(x)||x<=0))throw new RangeError("reinforced solid dimensions and mesh size must be positive");
  if(spec.cover.some(x=>!Number.isFinite(x)||x<0))throw new RangeError("cover must be nonnegative");
  if(spec.barCounts.some(n=>!Number.isSafeInteger(n)||n<2))throw new RangeError("bar counts must be integers of at least two");
  if(typeof spec.includeZBars!=="boolean")throw new TypeError("includeZBars must be boolean");
  if(!["separate","shared"].includes(spec.connectivity))throw new RangeError("connectivity must explicitly be separate or shared");
  if(!["preserve","source-aligned"].includes(spec.dimensionPolicy))throw new RangeError("dimensionPolicy must explicitly be preserve or source-aligned");
  const limit=spec.maximumRelativeDimensionChange??0;
  if(!Number.isFinite(limit)||limit<0||limit>=1)throw new RangeError("maximumRelativeDimensionChange must be in [0,1)");
  const concretePartId=spec.concretePartId??3,rebarPartId=spec.rebarPartId??2;
  if([concretePartId,rebarPartId].some(n=>!Number.isSafeInteger(n)||n<1||n>99999999)||concretePartId===rebarPartId)throw new RangeError("concrete and rebar need distinct positive 8-column PIDs");
  if(spec.elementLimit!==undefined&&(!Number.isSafeInteger(spec.elementLimit)||spec.elementLimit<1))throw new RangeError("elementLimit must be a positive safe integer");
  if(spec.optimizeMeshSize!==undefined&&typeof spec.optimizeMeshSize!=="boolean")throw new TypeError("optimizeMeshSize must be boolean");
  if(spec.optimizeMeshSize&&spec.elementLimit===undefined)throw new RangeError("optimizeMeshSize requires elementLimit");
  if(spec.meshSizeSearch!==undefined&&!spec.optimizeMeshSize)throw new RangeError("meshSizeSearch requires optimizeMeshSize");
  const search=spec.meshSizeSearch;
  if(search!==undefined&&(!search||typeof search!=="object"||Array.isArray(search)||Object.keys(search).some(k=>!["minimum","maximum","step","maximumTotalRelativeDimensionChange"].includes(k))))throw new RangeError("invalid meshSizeSearch options");
  const minimum=search?.minimum??spec.meshSize*.5,maximum=search?.maximum??spec.meshSize*2;
  const step=search?.step??10**(Math.trunc(Math.log10(spec.meshSize))-3);
  const totalLimit=search?.maximumTotalRelativeDimensionChange??limit;
  if(spec.optimizeMeshSize&&([minimum,maximum,step].some(v=>!Number.isFinite(v)||v<=0)||minimum>maximum||!Number.isFinite(totalLimit)||totalLimit<0||totalLimit>=3))throw new RangeError("invalid mesh size search range, step or total dimension-change bound");
  let effectiveMeshSize=spec.meshSize,evaluated=0;
  let resolved:ReturnType<typeof uniformCounts>;
  if(spec.optimizeMeshSize){
    const first=Math.ceil((minimum-spec.meshSize)/step-1e-9),last=Math.floor((maximum-spec.meshSize)/step+1e-9);
    if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||last<first||last-first+1>100000)throw new RangeError("mesh size search must contain 1 to 100000 safe lattice candidates");
    let selected:ReturnType<typeof uniformCounts>|undefined;
    for(let k=first;k<=last;k++){
      const size=spec.meshSize+k*step;
      if(size<minimum-1e-12*minimum||size>maximum+1e-12*maximum||!(size>0))continue;
      evaluated++;
      try{
        const candidate=uniformCounts(spec,size,limit);
        if(candidate.solidCount+candidate.beamCount>spec.elementLimit!||candidate.totalRelativeDimensionChange>totalLimit+1e-12)continue;
        selected=candidate;effectiveMeshSize=size;break;
      }catch(error){if(!(error instanceof RangeError))throw error;}
    }
    if(!selected)throw new RangeError("no feasible uniform reinforcement size in the declared search range and dimension bounds");
    resolved=selected;
  }else{
    resolved=uniformCounts(spec,effectiveMeshSize,limit);
    if(spec.elementLimit!==undefined&&resolved.solidCount+resolved.beamCount>spec.elementLimit)throw new RangeError("uniform reinforcement exceeds elementLimit; optimizeMeshSize is disabled");
  }
  const {relativeDimensionChange,cover}=resolved;
  return {...resolved,barCounts:[...spec.barCounts],concretePartId,rebarPartId,connectivity:spec.connectivity,dimensionPolicy:spec.dimensionPolicy,
    requestedMeshSize:spec.meshSize,effectiveMeshSize,
    optimization:{enabled:spec.optimizeMeshSize??false,elementLimit:spec.elementLimit??null,candidatesEvaluated:evaluated,
      search:spec.optimizeMeshSize?{minimum,maximum,step,maximumTotalRelativeDimensionChange:totalLimit}:null,
      objective:"Finest feasible candidate on the declared lattice; cap solid plus active beam count and bound absolute dimension changes."},
    warnings:[...(relativeDimensionChange.some(v=>Math.abs(v)>1e-12)?["Requested dimensions adjusted under explicit source-aligned policy."]:[]),
      ...(effectiveMeshSize!==spec.meshSize?[`Mesh size adjusted from ${spec.meshSize} to ${effectiveMeshSize}; inspect resolved dimensions and counts.`]:[]),
      ...(cover.some((v,a)=>Math.abs(v-spec.cover[a]!)>1e-12*effectiveMeshSize)?["Cover distances were aligned to mesh intervals; inspect the resolved cover before use."]:[]),
      spec.connectivity==="separate"?"Independent beam nodes: no embedding, bond, or contact constraints are generated.":"Shared endpoint nodes constrain translations; no bond-slip or material model is inferred."]};
}

function uniformCounts(spec:UniformReinforcementSpec,meshSize:number,limit:number){
  const nearest=(x:number)=>Math.round(x),ceiling=(x:number)=>Math.ceil(x-1e-12*Math.max(1,Math.abs(x)));
  const coverCounts=spec.cover.map((c,a)=>(a===2?ceiling:nearest)(c/meshSize));
  const spacingCounts=coverCounts.map((n,a)=>(a===2?ceiling:nearest)((spec.size[a]!/meshSize-2*n)/(spec.barCounts[a]!-1)));
  if(spacingCounts.some(n=>!Number.isSafeInteger(n)||n<1))throw new RangeError("bar placement has no positive mesh-aligned spacing");
  const counts=coverCounts.map((n,a)=>2*n+spacingCounts[a]!*(spec.barCounts[a]!-1));
  if(counts.some(n=>!Number.isSafeInteger(n)||n<1))throw new RangeError("invalid reinforced solid counts");
  const actualSize=counts.map(n=>n*meshSize),cover=coverCounts.map(n=>n*meshSize);
  const relativeDimensionChange=actualSize.map((x,a)=>(x-spec.size[a]!)/spec.size[a]!);
  if(relativeDimensionChange.some(v=>Math.abs(v)>(spec.dimensionPolicy==="preserve"?1e-12:limit+1e-12)))throw new RangeError("mesh-aligned dimensions exceed the explicitly permitted dimension change");
  const [nx,ny,nz]=counts,[bx,by,bz]=spec.barCounts;
  const solidCount=nx!*ny!*nz!,beamCount=ny!*bx*bz+nx!*by*bz+(spec.includeZBars?nz!*bx*by:0);
  if(!Number.isSafeInteger(solidCount+beamCount)||solidCount+beamCount>2000000)throw new RangeError("reinforcement exceeds the experimental allocation limit");
  return {actualSize,counts,cover,coverCounts,spacingCounts,
    barSpacing:spacingCounts.map(n=>n*meshSize),relativeDimensionChange,
    totalRelativeDimensionChange:relativeDimensionChange.reduce((sum,v)=>sum+Math.abs(v),0),solidCount,beamCount};
}

export function generateUniformReinforcedMesh(spec:UniformReinforcementSpec){
  const plan=planUniformReinforcement(spec),[nx,ny,nz]=plan.counts as [number,number,number];
  const [L,W,H]=plan.actualSize as [number,number,number];
  const concreteMesh=createHexUnitCubeMesh(nx,ny,nz);
  concreteMesh.nodes=concreteMesh.nodes.map(p=>[p[0]!*L-L/2,p[1]!*W-W/2,p[2]!*H-H]);
  const nodes:Point[]=concreteMesh.nodes.map(p=>[...p]),beams:MixedBeamRecord[]=[];
  const lineSets:Record<string,number[]>={bars_x:[],bars_y:[],bars_z:[]};
  const orientationNodes:number[]=[],beamEndNodes=new Set<number>();
  const cubeNode=(v:readonly number[])=>v[2]!*(ny+1)*(nx+1)+v[1]!*(nx+1)+v[0]!+1;
  const locations=plan.barCounts.map((n,a)=>Array.from({length:n},(_,i)=>plan.coverCounts[a]!+i*plan.spacingCounts[a]!));
  const addLine=(axis:0|1|2,start:number[])=>{
    // Separate mode preserves distinct bar intersections, just like the reference mesh.
    const ids:number[]=[];
    for(let i=0;i<=plan.counts[axis]!;i++){
      const logical=[...start];logical[axis]=i;const source=cubeNode(logical);
      const id=spec.connectivity==="shared"?source:nodes.push([...concreteMesh.nodes[source-1]!]);
      ids.push(id);beamEndNodes.add(id);
    }
    const p=[...nodes[ids[0]!-1]!];p[(axis+1)%3]!+=plan.effectiveMeshSize;
    const orientationNode=nodes.push(p);orientationNodes.push(orientationNode);
    for(let i=1;i<ids.length;i++){
      const id=concreteMesh.elements.length+beams.length+1;
      beams.push({id,partId:plan.rebarPartId,nodes:[ids[i-1]!,ids[i]!],orientationNode});lineSets[["bars_x","bars_y","bars_z"][axis]!]!.push(id);
    }
  };
  for(const z of locations[2]!)for(const x of locations[0]!)addLine(1,[x,0,z]);
  if(spec.includeZBars)for(const y of locations[1]!)for(const x of locations[0]!)addLine(2,[x,y,0]);
  for(const z of locations[2]!)for(const y of locations[1]!)addLine(0,[0,y,z]);
  const model:LsdynaMixedMesh={nodes,solids:concreteMesh.elements.map((e,i)=>({id:i+1,partId:plan.concretePartId,nodes:e})),beams};
  validateLsdynaMixedMesh(model);
  if(beams.length!==plan.beamCount||model.solids.length!==plan.solidCount)throw new Error("reinforcement counts disagree with plan");
  let volume=0,minSJ=Infinity,minGauss=Infinity;
  for(const e of concreteMesh.elements){
    const v=e.map(n=>nodes[n-1]!);volume+=hexElementSignedVolume(v);minSJ=Math.min(minSJ,minimumHexCornerScaledJacobian(v));
    for(const u of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const s of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const t of [-1/Math.sqrt(3),1/Math.sqrt(3)]){
      const [a,b,c]=hexJacobian(v,u,s,t);
      minGauss=Math.min(minGauss,a[0]!*(b[1]!*c[2]!-b[2]!*c[1]!)-a[1]!*(b[0]!*c[2]!-b[2]!*c[0]!)+a[2]!*(b[0]!*c[1]!-b[1]!*c[0]!));
    }
  }
  const beamQuality=auditReinforcementBeams(model,spec.connectivity);
  const relativeVolumeError=Math.abs(volume-L*W*H)/(L*W*H);
  if(!(minSJ>0&&minGauss>0&&relativeVolumeError<1e-8))throw new Error("reinforced concrete volume audit failed");
  if(Math.max(Math.abs(beamQuality.minimumBeamLength!-plan.effectiveMeshSize),Math.abs(beamQuality.maximumBeamLength!-plan.effectiveMeshSize))>1e-8*plan.effectiveMeshSize)throw new Error("beam subdivision does not follow its physical axis");
  const endIds=[...beamEndNodes];
  return {model,concreteMesh,plan,nodeSets:{concrete:concreteMesh.nodes.map((_,i)=>i+1),rebar_endpoints:endIds,rebar_orientation:orientationNodes},
    cellSets:{concrete:model.solids.map(e=>e.id),...lineSets},
    quality:{volume,relativeVolumeError,minimumCornerScaledJacobian:minSJ,minimumGaussDeterminant:minGauss,...beamQuality,beamEndNodes:endIds.length,warnings:plan.warnings}};
}
