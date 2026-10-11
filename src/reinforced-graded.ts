import type {Point} from "./types.js";
import type {RectangularGradingSpec} from "./graded-rectangle-plan.js";
import {planRectangularGrading} from "./graded-rectangle-plan.js";
import {generateRectangularGradedMesh} from "./graded-rectangle.js";
import type {LsdynaMixedMesh,MixedBeamRecord} from "./lsdyna-mixed.js";
import {validateLsdynaMixedMesh} from "./lsdyna-mixed.js";
import {minimumHexCornerScaledJacobian} from "./hex-quality.js";

export interface GradedReinforcementSpec {
  concrete: RectangularGradingSpec;
  rebarMeshSize: number;
  /** Full-body bar-position counts along X, Y and Z. */
  barCounts: readonly [number,number,number];
  /** X low/high, Y low/high, Z low/high. These locate orthogonal bar families. */
  cover: readonly [number,number,number,number,number,number];
  includeZBars: boolean;
  /** Independent endpoints; no implicit embedding, merging, or bond law. */
  connectivity: "separate";
  concretePartId?: number;
  rebarPartId?: number;
}

export function planGradedReinforcement(spec:GradedReinforcementSpec) {
  const allowed=new Set(["concrete","rebarMeshSize","barCounts","cover","includeZBars","connectivity","concretePartId","rebarPartId"]);
  if(Object.keys(spec).some(k=>!allowed.has(k)))throw new RangeError("unknown graded reinforcement option");
  const concrete=planRectangularGrading(spec.concrete);
  if(spec.concrete.modelFraction!=="half" || spec.concrete.transitionStages!==1 ||
    !spec.concrete.thicknessTransition || spec.concrete.reductions.z!==3 || (spec.concrete.angleDegrees??0)!==0)
    throw new RangeError("graded reinforcement currently requires a zero-tilt half model, one transition stage and Z reduction 3");
  if(spec.connectivity!=="separate")throw new RangeError("graded reinforcement requires separate nodes; mesh-coincident shared endpoints are not implemented");
  if(!Number.isFinite(spec.rebarMeshSize)||spec.rebarMeshSize<=0)throw new RangeError("rebarMeshSize must be positive");
  if(!Array.isArray(spec.barCounts)||spec.barCounts.length!==3||spec.barCounts.some(n=>!Number.isSafeInteger(n)||n<2))throw new RangeError("barCounts requires three integers of at least two");
  if(!Array.isArray(spec.cover)||spec.cover.length!==6||spec.cover.some(c=>!Number.isFinite(c)||c<0))throw new RangeError("cover requires six nonnegative distances");
  if(typeof spec.includeZBars!=="boolean")throw new TypeError("includeZBars must be boolean");
  if(spec.barCounts[1]%2!==1||spec.cover[2]!==spec.cover[3])throw new RangeError("half-model reinforcement requires odd full-body Y bar count and symmetric Y cover");
  const concretePartId=spec.concretePartId??3,rebarPartId=spec.rebarPartId??2;
  if([concretePartId,rebarPartId].some(n=>!Number.isSafeInteger(n)||n<1||n>99999999)||concretePartId===rebarPartId)throw new RangeError("distinct positive 8-column concrete/rebar PIDs required");
  const size=spec.concrete.fullSize;
  const counts=size.map(x=>Math.round(x/spec.rebarMeshSize));
  if(counts.some(n=>!Number.isSafeInteger(n)||n<1))throw new RangeError("invalid beam subdivision counts");
  if(counts[1]!%2!==0)throw new RangeError("half-model Y beam subdivisions require an even full-body count");
  const halfRows=(spec.barCounts[1]+1)/2;
  const requestedBeamCount=counts[0]!*halfRows*spec.barCounts[2]+counts[1]!/2*spec.barCounts[0]*spec.barCounts[2]
    +(spec.includeZBars?counts[2]!*spec.barCounts[0]*halfRows:0);
  if(!Number.isSafeInteger(requestedBeamCount)||requestedBeamCount>2000000)throw new RangeError("graded reinforcement exceeds beam allocation limit");
  const spacing=size.map((v,a)=>v/counts[a]!);
  const resolvedCover:number[]=[],coverCounts:number[][]=[],barSpacing:number[]=[],locations:number[][]=[];
  for(const a of [0,1,2] as const){
    const low=Math.round(spec.cover[2*a]!/spacing[a]!),high=Math.round(spec.cover[2*a+1]!/spacing[a]!);
    const interior=counts[a]!-low-high,intervals=spec.barCounts[a]-1;
    if(interior<=0)throw new RangeError("covers leave no reinforcement spacing");
    // Source alternates high then low cover reductions; Y additionally needs even spacing.
    const multiple=intervals*(a===1?2:1);
    const addition=(multiple-interior%multiple)%multiple;
    const lo=low-Math.floor(addition/2),hi=high-Math.ceil(addition/2);
    if(lo<0||hi<0)throw new RangeError("bar-count alignment would make a cover negative");
    if(a===1 && lo!==hi)throw new RangeError("Y cover alignment would move the bar row off the half-model symmetry plane");
    coverCounts.push([lo,hi]);resolvedCover.push(lo*spacing[a]!,hi*spacing[a]!);
    const step=(interior+addition)/intervals;
    barSpacing.push(step*spacing[a]!);
    const lower=a===0?-size[0]/2:a===1?-size[1]/2:0;
    const all=Array.from({length:spec.barCounts[a]},(_,i)=>lower+(lo+i*step)*spacing[a]!);
    locations.push(a===1?all.filter(v=>v>=-1e-10*size[1]).map(v=>Math.abs(v)<1e-10*size[1]?0:v):all);
  }
  const [bx,by,bz]=locations.map(v=>v.length);
  const axisBeamCounts=[counts[0]!*by!*bz!,counts[1]!/2*bx!*bz!,spec.includeZBars?counts[2]!*bx!*by!:0];
  const beamCount=axisBeamCounts.reduce((s,v)=>s+v,0);
  if(!Number.isSafeInteger(beamCount)||beamCount>2000000)throw new RangeError("graded reinforcement exceeds beam allocation limit");
  return {concrete,actualSize:[...size],counts,beamSpacing:spacing,coverCounts,resolvedCover,barSpacing,locations,
    axisBeamCounts,beamCount,concretePartId,rebarPartId,connectivity:spec.connectivity,
    warnings:["Independent beam nodes: no embedding, bond, or contact constraints are generated.",
      ...(resolvedCover.some((v,i)=>Math.abs(v-spec.cover[i]!)>1e-10*spec.rebarMeshSize)?["Cover distances adjusted to beam-count alignment; inspect resolvedCover."]:[])]};
}

export function generateGradedReinforcedMesh(spec:GradedReinforcementSpec){
  const plan=planGradedReinforcement(spec);
  const concrete=generateRectangularGradedMesh(spec.concrete),mesh=concrete.mesh;
  if(mesh.elements.length+plan.beamCount>2000000)throw new RangeError("combined graded reinforcement exceeds allocation limit");
  const nodes:Point[]=mesh.nodes.map(p=>[...p]),beams:MixedBeamRecord[]=[];
  const lineSets:Record<string,number[]>={bars_x:[],bars_y:[],bars_z:[]};
  const endIds:number[]=[],orientationIds:number[]=[],[L,W,H]=plan.actualSize;
  const axisLengths=[L!,W!/2,H!],axisStarts=[-L!/2,0,0],axisCounts=[plan.counts[0]!,plan.counts[1]!/2,plan.counts[2]!];
  const addLine=(axis:0|1|2,start:number[])=>{
    const ids:number[]=[];
    for(let i=0;i<=axisCounts[axis]!;i++){
      const p=[...start];p[axis]=axisStarts[axis]!+axisLengths[axis]!*i/axisCounts[axis]!;
      ids.push(nodes.push(p));
    }
    endIds.push(...ids);
    const orientation=[...nodes[ids[0]!-1]!];orientation[(axis+1)%3]!+=plan.beamSpacing[axis]!;
    const orientationNode=nodes.push(orientation);orientationIds.push(orientationNode);
    for(let i=1;i<ids.length;i++){
      const id=mesh.elements.length+beams.length+1;
      beams.push({id,partId:plan.rebarPartId,nodes:[ids[i-1]!,ids[i]!],orientationNode});
      lineSets[["bars_x","bars_y","bars_z"][axis]!]!.push(id);
    }
  };
  for(const z of plan.locations[2]!)for(const x of plan.locations[0]!)addLine(1,[x,0,z]);
  if(spec.includeZBars)for(const y of plan.locations[1]!)for(const x of plan.locations[0]!)addLine(2,[x,y,0]);
  for(const z of plan.locations[2]!)for(const y of plan.locations[1]!)addLine(0,[0,y,z]);
  const model:LsdynaMixedMesh={nodes,solids:mesh.elements.map((e,i)=>({id:i+1,partId:plan.concretePartId,nodes:e})),beams};
  validateLsdynaMixedMesh(model);
  if(beams.length!==plan.beamCount)throw new Error("graded beam count disagrees with plan");
  const parents=new Map<number,number>();for(const id of concrete.parentElementIds)parents.set(id,(parents.get(id)??0)+1);
  const core=new Set(concrete.coreParentIds);
  const regions={core:{count:0,minimumCornerScaledJacobian:Infinity},transition:{count:0,minimumCornerScaledJacobian:Infinity},farField:{count:0,minimumCornerScaledJacobian:Infinity}};
  mesh.elements.forEach((e,i)=>{
    const p=concrete.parentElementIds[i]!,region=core.has(p)?regions.core:parents.get(p)!>1?regions.transition:regions.farField;
    region.count++;region.minimumCornerScaledJacobian=Math.min(region.minimumCornerScaledJacobian,minimumHexCornerScaledJacobian(e.map(n=>mesh.nodes[n-1]!)));
  });
  return {model,concreteMesh:mesh,plan,parentElementIds:concrete.parentElementIds,coreParentIds:concrete.coreParentIds,
    nodeSets:{concrete:mesh.nodes.map((_,i)=>i+1),rebar_endpoints:endIds,rebar_orientation:orientationIds},
    cellSets:{concrete:model.solids.map(e=>e.id),...lineSets},
    quality:{...concrete.quality,regions,sharedEndpointNodes:0,beamCount:beams.length,warnings:[...concrete.quality.warnings,...plan.warnings]}};
}
