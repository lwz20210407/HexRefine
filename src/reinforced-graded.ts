import type {Point} from "./types.js";
import type {RectangularGradingSpec} from "./graded-rectangle-plan.js";
import {planRectangularGrading} from "./graded-rectangle-plan.js";
import {generateRectangularGradedMesh} from "./graded-rectangle.js";
import type {LsdynaMixedMesh,MixedBeamRecord} from "./lsdyna-mixed.js";
import {validateLsdynaMixedMesh} from "./lsdyna-mixed.js";
import {minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {mergeCoincidentNodesWithMap,minElementEdgeLength} from "./mesh.js";

export interface GradedReinforcementSpec {
  concrete: RectangularGradingSpec;
  rebarMeshSize: number;
  /** Full-body bar-position counts along X, Y and Z. */
  barCounts: readonly [number,number,number];
  /** X low/high, Y low/high, Z low/high. These locate orthogonal bar families. */
  cover: readonly [number,number,number,number,number,number];
  includeZBars: boolean;
  /** Shared requires every endpoint to coincide with an active concrete node. */
  connectivity: "separate"|"shared";
  concretePartId?: number;
  rebarPartId?: number;
}

export function planGradedReinforcement(spec:GradedReinforcementSpec) {
  const allowed=new Set(["concrete","rebarMeshSize","barCounts","cover","includeZBars","connectivity","concretePartId","rebarPartId"]);
  if(Object.keys(spec).some(k=>!allowed.has(k)))throw new RangeError("unknown graded reinforcement option");
  const concrete=planRectangularGrading(spec.concrete);
  if(!["separate","shared"].includes(spec.connectivity))throw new RangeError("graded reinforcement connectivity must be separate or shared; embedding is not implemented");
  if(!Number.isFinite(spec.rebarMeshSize)||spec.rebarMeshSize<=0)throw new RangeError("rebarMeshSize must be positive");
  if(!Array.isArray(spec.barCounts)||spec.barCounts.length!==3||spec.barCounts.some(n=>!Number.isSafeInteger(n)||n<2))throw new RangeError("barCounts requires three integers of at least two");
  if(!Array.isArray(spec.cover)||spec.cover.length!==6||spec.cover.some(c=>!Number.isFinite(c)||c<0))throw new RangeError("cover requires six nonnegative distances");
  if(typeof spec.includeZBars!=="boolean")throw new TypeError("includeZBars must be boolean");
  const concretePartId=spec.concretePartId??3,rebarPartId=spec.rebarPartId??2;
  if([concretePartId,rebarPartId].some(n=>!Number.isSafeInteger(n)||n<1||n>99999999)||concretePartId===rebarPartId)throw new RangeError("distinct positive 8-column concrete/rebar PIDs required");
  const size=spec.concrete.fullSize;
  const counts=size.map(x=>Math.round(x/spec.rebarMeshSize));
  if(counts.some(n=>!Number.isSafeInteger(n)||n<1))throw new RangeError("invalid beam subdivision counts");
  const requestedBeamCount=counts[0]!*spec.barCounts[1]*spec.barCounts[2]+counts[1]!*spec.barCounts[0]*spec.barCounts[2]
    +(spec.includeZBars?counts[2]!*spec.barCounts[0]*spec.barCounts[1]:0);
  if(!Number.isSafeInteger(requestedBeamCount)||requestedBeamCount>2000000)throw new RangeError("graded reinforcement exceeds beam allocation limit");
  const fraction=spec.concrete.modelFraction;
  const bounds=[fraction==="quarter"?[0,size[0]/2]:[-size[0]/2,size[0]/2],
    fraction==="full"?[-size[1]/2,size[1]/2]:[0,size[1]/2],[0,size[2]]];
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
    coverCounts.push([lo,hi]);resolvedCover.push(lo*spacing[a]!,hi*spacing[a]!);
    const step=(interior+addition)/intervals;
    barSpacing.push(step*spacing[a]!);
    const lower=a===0?-size[0]/2:a===1?-size[1]/2:0;
    const all=Array.from({length:spec.barCounts[a]},(_,i)=>lower+(lo+i*step)*spacing[a]!);
    const tolerance=1e-10*size[a];
    locations.push(all.filter(v=>v>=bounds[a]![0]!-tolerance&&v<=bounds[a]![1]!+tolerance)
      .map(v=>Math.abs(v-bounds[a]![0]!)<tolerance?bounds[a]![0]!:Math.abs(v-bounds[a]![1]!)<tolerance?bounds[a]![1]!:v));
  }
  // Preserve full-body subdivision points. A symmetry cut may split just one segment.
  const axisCoordinates=counts.map((n,a)=>{
    const start=a===2?0:-size[a]!/2,lo=bounds[a]![0]!,hi=bounds[a]![1]!,tol=1e-10*size[a]!;
    return [lo,...Array.from({length:n+1},(_,i)=>start+i*spacing[a]!).filter(v=>v>lo+tol&&v<hi-tol),hi];
  });
  const axisCounts=axisCoordinates.map(v=>v.length-1);
  const [bx,by,bz]=locations.map(v=>v.length);
  const axisBeamCounts=[axisCounts[0]!*by!*bz!,axisCounts[1]!*bx!*bz!,spec.includeZBars?axisCounts[2]!*bx!*by!:0];
  const beamCount=axisBeamCounts.reduce((s,v)=>s+v,0);
  if(!Number.isSafeInteger(beamCount)||beamCount>2000000)throw new RangeError("graded reinforcement exceeds beam allocation limit");
  const sourceExtensions=[...(fraction!=="half"?["Correct full/quarter steel geometry by clipping the full-body layout; the source emits half-model steel."]:[]),
    ...(spec.concrete.transitionStages!==1||!spec.concrete.thicknessTransition||spec.concrete.reductions.z!==3?["Multi-stage or alternative thickness grading reuses the native concrete kernel; this extends Code_Creat5."]:[])];
  return {concrete,actualSize:[...size],counts,beamSpacing:spacing,coverCounts,resolvedCover,barSpacing,locations,bounds,axisCoordinates,
    barGeometry:"global-axis-aligned; concrete grading tilt does not rotate reinforcement",sourceExtensions,
    axisBeamCounts,beamCount,concretePartId,rebarPartId,connectivity:spec.connectivity,
    warnings:[spec.connectivity==="separate"?"Independent beam nodes: no embedding, bond, or contact constraints are generated.":
      "All beam endpoints must reuse active solid nodes. Shared translations are not an embedded or bond-slip formulation.",...concrete.warnings,...sourceExtensions,
      ...(axisCoordinates.some((v,a)=>v.some((x,i)=>i>0&&Math.abs(x-v[i-1]!-spacing[a]!)>1e-10*size[a]!))?["Symmetry clipping truncates boundary beam segments; interior segment spacing is unchanged."]:[]),
      ...(resolvedCover.some((v,i)=>Math.abs(v-spec.cover[i]!)>1e-10*spec.rebarMeshSize)?["Cover distances adjusted to beam-count alignment; inspect resolvedCover."]:[])]};
}

export function generateGradedReinforcedMesh(spec:GradedReinforcementSpec){
  const plan=planGradedReinforcement(spec);
  const concrete=generateRectangularGradedMesh(spec.concrete),mesh=concrete.mesh;
  if(mesh.elements.length+plan.beamCount>2000000)throw new RangeError("combined graded reinforcement exceeds allocation limit");
  let nodes:Point[]=mesh.nodes.map(p=>[...p]);
  const beams:MixedBeamRecord[]=[];
  const lineSets:Record<string,number[]>={bars_x:[],bars_y:[],bars_z:[]};
  const endIds:number[]=[],orientationIds:number[]=[];
  const addLine=(axis:0|1|2,start:number[])=>{
    const ids:number[]=[];
    for(const coordinate of plan.axisCoordinates[axis]!){
      const p=[...start];p[axis]=coordinate;
      ids.push(nodes.push(p));
    }
    for(const id of ids)endIds.push(id);
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
  let sharedEndpointNodes=0,sharedEndpointTolerance=0;
  if(spec.connectivity==="shared"){
    sharedEndpointTolerance=minElementEdgeLength(mesh)*1e-9;
    const active=new Set<number>();for(const e of mesh.elements)for(const n of e)active.add(n);
    // Lookup only: do not replace concrete coordinates/connectivity or merge N3 helpers.
    const lookup=mergeCoincidentNodesWithMap({kind:"H1",nodes:[...mesh.nodes,...endIds.map(n=>nodes[n-1]!)],elements:mesh.elements},sharedEndpointTolerance);
    for(let n=1;n<=mesh.nodes.length;n++)if(lookup.nodeIdByInputNodeId.get(n)!==n)throw new Error("shared-node lookup would renumber concrete nodes");
    const remap=new Map<number,number>(),missing:number[]=[];
    endIds.forEach((n,i)=>{
      const target=lookup.nodeIdByInputNodeId.get(mesh.nodes.length+i+1)!;
      if(!active.has(target))missing.push(n);else remap.set(n,target);
    });
    if(missing.length)throw new RangeError(`shared reinforcement has ${missing.length} endpoints without matching active solid nodes; first coordinate: ${nodes[missing[0]!-1]!.join(", ")}`);
    const nextNodes:Point[]=mesh.nodes.map(p=>[...p]);
    const nextOrientations=orientationIds.map(n=>{const id=nextNodes.push([...nodes[n-1]!]);remap.set(n,id);return id;});
    for(const beam of beams){beam.nodes=[remap.get(beam.nodes[0])!,remap.get(beam.nodes[1])!];beam.orientationNode=remap.get(beam.orientationNode)!;}
    const uniqueEndpoints=new Set(endIds.map(n=>remap.get(n)!));
    endIds.length=0;for(const n of uniqueEndpoints)endIds.push(n);
    orientationIds.length=0;for(const n of nextOrientations)orientationIds.push(n);
    nodes=nextNodes;sharedEndpointNodes=endIds.length;
  }
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
    nodeSets:{concrete:mesh.nodes.map((_,i)=>i+1),rebar_endpoints:endIds,rebar_orientation:orientationIds,
      rebar_cut_x0:spec.concrete.modelFraction==="quarter"?endIds.filter(n=>Math.abs(nodes[n-1]![0]!)<1e-10*plan.actualSize[0]!):[],
      rebar_cut_y0:spec.concrete.modelFraction!=="full"?endIds.filter(n=>Math.abs(nodes[n-1]![1]!)<1e-10*plan.actualSize[1]!):[]},
    cellSets:{concrete:model.solids.map(e=>e.id),...lineSets},
    quality:{...concrete.quality,regions,
      regionClassification:"core / refined outside-core support (including intermediate uniform cells in two-stage meshes) / unchanged far field",
      sharedEndpointNodes,sharedEndpointTolerance,beamEndpointNodes:endIds.length,beamCount:beams.length,warnings:[...concrete.quality.warnings,...plan.warnings]}};
}
