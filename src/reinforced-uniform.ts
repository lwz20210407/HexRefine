import {createHexUnitCubeMesh} from "./grid.js";
import type {Point} from "./types.js";
import type {LsdynaMixedMesh,MixedBeamRecord} from "./lsdyna-mixed.js";
import {validateLsdynaMixedMesh} from "./lsdyna-mixed.js";
import {hexElementSignedVolume,minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {hexJacobian} from "./hex-quality-internal.js";

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
}

export function planUniformReinforcement(spec:UniformReinforcementSpec){
  const allowed=new Set(["size","meshSize","barCounts","cover","includeZBars","connectivity","dimensionPolicy","maximumRelativeDimensionChange","concretePartId","rebarPartId"]);
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
  const nearest=(x:number)=>Math.round(x),ceiling=(x:number)=>Math.ceil(x-1e-12*Math.max(1,Math.abs(x)));
  const coverCounts=spec.cover.map((c,a)=>(a===2?ceiling:nearest)(c/spec.meshSize));
  const spacingCounts=coverCounts.map((n,a)=>(a===2?ceiling:nearest)((spec.size[a]!/spec.meshSize-2*n)/(spec.barCounts[a]!-1)));
  if(spacingCounts.some(n=>!Number.isSafeInteger(n)||n<1))throw new RangeError("bar placement has no positive mesh-aligned spacing");
  const counts=coverCounts.map((n,a)=>2*n+spacingCounts[a]!*(spec.barCounts[a]!-1));
  if(counts.some(n=>!Number.isSafeInteger(n)||n<1))throw new RangeError("invalid reinforced solid counts");
  const actualSize=counts.map(n=>n*spec.meshSize),cover=coverCounts.map(n=>n*spec.meshSize);
  const relativeDimensionChange=actualSize.map((x,a)=>(x-spec.size[a]!)/spec.size[a]!);
  if(relativeDimensionChange.some(v=>Math.abs(v)>(spec.dimensionPolicy==="preserve"?1e-12:limit+1e-12)))throw new RangeError("mesh-aligned dimensions exceed the explicitly permitted dimension change");
  const [nx,ny,nz]=counts,[bx,by,bz]=spec.barCounts;
  const solidCount=nx!*ny!*nz!,beamCount=ny!*bx*bz+nx!*by*bz+(spec.includeZBars?nz!*bx*by:0);
  if(!Number.isSafeInteger(solidCount+beamCount)||solidCount+beamCount>2000000)throw new RangeError("reinforcement exceeds the experimental allocation limit");
  return {actualSize,counts,cover,coverCounts,barCounts:[...spec.barCounts],spacingCounts,
    barSpacing:spacingCounts.map(n=>n*spec.meshSize),relativeDimensionChange,solidCount,beamCount,
    concretePartId,rebarPartId,connectivity:spec.connectivity,dimensionPolicy:spec.dimensionPolicy,
    warnings:[...(relativeDimensionChange.some(v=>Math.abs(v)>1e-12)?["Requested dimensions adjusted under explicit source-aligned policy."]:[]),
      ...(cover.some((v,a)=>Math.abs(v-spec.cover[a]!)>1e-12*spec.meshSize)?["Cover distances were aligned to mesh intervals; inspect the resolved cover before use."]:[]),
      spec.connectivity==="separate"?"Independent beam nodes: no embedding, bond, or contact constraints are generated.":"Shared endpoint nodes constrain translations; no bond-slip or material model is inferred."]};
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
    const p=[...nodes[ids[0]!-1]!];p[(axis+1)%3]!+=spec.meshSize;
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
  let volume=0,minSJ=Infinity,minGauss=Infinity,minBeamLength=Infinity,maxBeamLength=0,minOrientationSine=Infinity;
  for(const e of concreteMesh.elements){
    const v=e.map(n=>nodes[n-1]!);volume+=hexElementSignedVolume(v);minSJ=Math.min(minSJ,minimumHexCornerScaledJacobian(v));
    for(const u of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const s of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const t of [-1/Math.sqrt(3),1/Math.sqrt(3)]){
      const [a,b,c]=hexJacobian(v,u,s,t);
      minGauss=Math.min(minGauss,a[0]!*(b[1]!*c[2]!-b[2]!*c[1]!)-a[1]!*(b[0]!*c[2]!-b[2]!*c[0]!)+a[2]!*(b[0]!*c[1]!-b[1]!*c[0]!));
    }
  }
  for(const beam of beams){
    const p=nodes[beam.nodes[0]-1]!,q=nodes[beam.nodes[1]-1]!,r=nodes[beam.orientationNode-1]!;
    const a=q.map((x,i)=>x-p[i]!),b=r.map((x,i)=>x-p[i]!);
    const length=Math.hypot(...a),cross=[a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!];
    minBeamLength=Math.min(minBeamLength,length);maxBeamLength=Math.max(maxBeamLength,length);
    minOrientationSine=Math.min(minOrientationSine,Math.hypot(...cross)/(length*Math.hypot(...b)));
  }
  const relativeVolumeError=Math.abs(volume-L*W*H)/(L*W*H);
  if(!(minSJ>0&&minGauss>0&&relativeVolumeError<1e-8))throw new Error("reinforced concrete volume audit failed");
  if(Math.max(Math.abs(minBeamLength-spec.meshSize),Math.abs(maxBeamLength-spec.meshSize))>1e-8*spec.meshSize)throw new Error("beam subdivision does not follow its physical axis");
  const endIds=[...beamEndNodes],shared=endIds.filter(n=>n<=concreteMesh.nodes.length).length;
  if(spec.connectivity==="shared"?shared!==endIds.length:shared!==0)throw new Error("reinforcement connectivity policy was violated");
  return {model,concreteMesh,plan,nodeSets:{concrete:concreteMesh.nodes.map((_,i)=>i+1),rebar_endpoints:endIds,rebar_orientation:orientationNodes},
    cellSets:{concrete:model.solids.map(e=>e.id),...lineSets},
    quality:{volume,relativeVolumeError,minimumCornerScaledJacobian:minSJ,minimumGaussDeterminant:minGauss,sharedEndpointNodes:shared,beamEndNodes:endIds.length,
      minimumBeamLength:minBeamLength,maximumBeamLength:maxBeamLength,minimumBeamOrientationSine:minOrientationSine,warnings:plan.warnings}};
}
