import type {Mesh,RefinementResult} from "./types.js";
import {minElementEdgeLength} from "./mesh.js";
import {H1_FACES} from "./topology.js";
import {checkNoHangingNodes} from "./conformance.js";
import {refineByElementIdsWithReport} from "./refinement-ops.js";
import {buildDirectTwoToOneHexPlan} from "./two-to-one.js";
import {DirectTwoToOnePlanningError,TwoToOnePlanningError} from "./two-to-one-capability.js";
import {HexPatchQualityError,HexTransitionConformanceError} from "./refinement-errors.js";
import {minimumHexCornerScaledJacobian,hexElementSignedVolume} from "./hex-quality.js";
const H1_EDGES:readonly (readonly number[])[]=[[1,2],[2,3],[3,4],[4,1],[5,6],[6,7],[7,8],[8,5],[1,5],[2,6],[3,7],[4,8]];

export interface HexTransitionClosureOptions {
  ratio:2|3;
  maxAddedParents?:number;
  maxAddedLayers?:number;
  maxStates?:number;
  maxOutputElements?:number;
  /** Only these parents may be refined or replaced by transition templates. */
  allowedParentIds?:readonly number[];
  mergeTolerance?:number;
  /** Paired macros may repartition support parents, never the selected core. Single material only. */
  allowSupportRedistribution?:boolean;
}
export interface HexBoundaryState {
  parentId:number;selectedFaces:number;selectedEdges:number;markedVertices:number;
  kind:"face"|"edge"|"vertex"|"concave-edge"|"concave-vertex"|"compound";
}
export class HexTransitionClosureError extends Error {
  constructor(readonly code:"HEX_CLOSURE_LIMIT"|"HEX_CLOSURE_UNSUPPORTED"|"HEX_CLOSURE_PROTECTED",message:string,
    readonly diagnostic:{requestedParentIds:number[];attemptedStates:number;conflictingParentIds:number[]}){
    super(message);this.name="HexTransitionClosureError";
  }
}

/** Topological taxonomy, not a promise that every state has a native template. */
export function classifyHexTransitionBoundary(mesh:Mesh,selectedIds:readonly number[]):HexBoundaryState[]{
  const selected=new Set(selectedIds),marks=new Set<number>();
  for(const id of selected)for(const n of mesh.elements[id-1]??[])marks.add(n);
  const refinedFaces=new Set<string>(),refinedEdges=new Set<string>();
  for(const id of selected){const e=mesh.elements[id-1]!;
    for(const face of H1_FACES)refinedFaces.add(key(face.map(n=>e[n-1]!)));
    for(const edge of H1_EDGES)refinedEdges.add(key(edge.map(n=>e[n-1]!)));
  }
  const result:HexBoundaryState[]=[];
  mesh.elements.forEach((e,i)=>{
    if(selected.has(i+1))return;
    const markedVertices=e.filter(n=>marks.has(n)).length;if(!markedVertices)return;
    const selectedFaces=H1_FACES.filter(f=>refinedFaces.has(key(f.map(n=>e[n-1]!)))).length;
    const selectedEdges=H1_EDGES.filter(f=>refinedEdges.has(key(f.map(n=>e[n-1]!)))).length;
    const kind=selectedFaces>=3?"concave-vertex":selectedFaces===2?"concave-edge":selectedFaces===1?"face":
      selectedEdges>1?"compound":selectedEdges===1?"edge":"vertex";
    result.push({parentId:i+1,selectedFaces,selectedEdges,markedVertices,kind});
  });
  return result;
}

/** Bounded finite-state completion; it never falls back to a bounding box or full refinement. */
export function refineHexWithTransitionClosure(mesh:Mesh,requestedIds:readonly number[],options:HexTransitionClosureOptions){
  const requested=validate(mesh,requestedIds,options),tolerance=options.mergeTolerance??minElementEdgeLength(mesh)*1e-9;
  if(mesh.elements.length+(options.ratio**3-1)*requested.length>(options.maxOutputElements??2000000))throw new RangeError("requested core alone exceeds maxOutputElements");
  if(!checkNoHangingNodes(mesh,tolerance*10).ok)throw new RangeError("closure requires a conforming input Hex mesh");
  const maxAdded=options.maxAddedParents??16,maxLayers=options.maxAddedLayers??1,maxStates=options.maxStates??64;
  const graph=vertexNeighbors(mesh),distances=distanceLayers(graph,requested,maxLayers);
  const allowed=new Set(options.allowedParentIds??mesh.elements.map((_,i)=>i+1));
  if(requested.some(id=>!allowed.has(id)))throw new RangeError("requested parents must belong to allowedParentIds");
  const queue=[requested],seen=new Set([key(requested)]),priority=new Set<string>();let attemptedStates=0,lastConflicts:number[]=[],protectedFailure=false,lastReason="";
  while(queue.length&&attemptedStates<maxStates){
    queue.sort((a,b)=>Number(priority.has(key(b)))-Number(priority.has(key(a)))||a.length-b.length);const selected=queue.shift()!;attemptedStates++;
    let result:RefinementResult|undefined,conflicts:number[]=[];
    try{
      if(options.ratio===2)buildDirectTwoToOneHexPlan(mesh,selected);
      result=refineByElementIdsWithReport(mesh,selected,{hexRefinementRatio:options.ratio,mergeTolerance:tolerance,
        regularizeHexSelection:false,hexTwoToOneCompensation:{mode:"none"}});
    }catch(error){
      if(error instanceof DirectTwoToOnePlanningError){
        if(error.kind!=="selection-signature")throw new HexTransitionClosureError("HEX_CLOSURE_UNSUPPORTED",error.message,
          {requestedParentIds:requested,attemptedStates,conflictingParentIds:[...error.conflictingElementIds]});
        conflicts=error.conflictingElementIds;
      }else if(error instanceof HexTransitionConformanceError)conflicts=error.conflictingParentIds;
      else if(error instanceof TwoToOnePlanningError&&error.code==="TWO_TO_ONE_CONFORMANCE")conflicts=error.diagnostic.conflictingCellIds;
      else if(error instanceof HexPatchQualityError)throw error;
      else throw error;
    }
    if(result){
      if(mesh.nodes.some((p,i)=>!result!.mesh.nodes[i]||p.some((v,a)=>v!==result!.mesh.nodes[i]![a])))throw new Error("closure must preserve original node identity; coincident disconnected nodes need a partition-aware path");
      const affected=new Set(result.cellData.filter(c=>c.role!=="unchanged").map(c=>c.parentElementId));
      if([...affected].some(id=>!allowed.has(id))){protectedFailure=true;continue;}
      if(result.mesh.elements.length>(options.maxOutputElements??2000000))throw new RangeError("closure exceeds maxOutputElements");
      const volumes=new Map<number,number>();
      result.cellData.forEach((c,i)=>{const volume=hexElementSignedVolume(result!.mesh.elements[i]!.map(n=>result!.mesh.nodes[n-1]!));volumes.set(c.parentElementId,(volumes.get(c.parentElementId)??0)+volume);});
      const supportRedistribution:Array<{parentId:number;relativeVolumeChange:number;signedVolumeChange:number}>=[];
      for(const parentId of affected){
        const original=hexElementSignedVolume(mesh.elements[parentId-1]!.map(n=>mesh.nodes[n-1]!)),delta=volumes.get(parentId)!-original,relative=delta/original;
        if(Math.abs(relative)<=1e-8)continue;
        if(selected.includes(parentId))throw new HexTransitionClosureError("HEX_CLOSURE_UNSUPPORTED","uniform core volume changes within an individual parent",{requestedParentIds:requested,attemptedStates,conflictingParentIds:[parentId]});
        supportRedistribution.push({parentId,relativeVolumeChange:relative,signedVolumeChange:delta});
      }
      if(supportRedistribution.length&&!options.allowSupportRedistribution){
        conflicts=supportRedistribution.map(r=>r.parentId);result=undefined;
        lastReason=" Paired support redistribution needs explicit allowSupportRedistribution within one material.";
      }else{
      const added=selected.filter(id=>!requested.includes(id));
      return {...result,closure:{ratio:options.ratio,requestedParentIds:requested,effectiveParentIds:selected,
        addedParentIds:added,attemptedStates,maxAddedLayer:Math.max(0,...added.map(id=>distances.get(id)!)),
        affectedParentIds:[...affected].sort((a,b)=>a-b),preservedFarFieldParents:mesh.elements.length-affected.size,
        boundaryStates:classifyHexTransitionBoundary(mesh,selected),supportRedistribution,
        maximumSupportParentRelativeVolumeError:Math.max(0,...supportRedistribution.map(r=>Math.abs(r.relativeVolumeChange)))}};
      }
    }
    lastConflicts=[...new Set(conflicts)].sort((a,b)=>a-b);
    if(selected.length-requested.length>=maxAdded)continue;
    const states=classifyHexTransitionBoundary(mesh,selected),selectedSet=new Set(selected);
    // Complete compound marked-corner stars before installing single-face/edge templates.
    // These are bounded promotions, not CinoLib polyhedra mistaken for Hex cells.
    const strong=states.filter(s=>s.selectedFaces>=2||s.markedVertices>=5);
    const compound=(strong.length?strong:states.filter(s=>s.markedVertices===3||s.selectedFaces===0&&s.selectedEdges>1))
      .map(s=>s.parentId).filter(id=>allowed.has(id)&&distances.has(id));
    if(compound.length){
      const complete=[...new Set([...selected,...compound])].sort((a,b)=>a-b),signature=key(complete);
      if(complete.length-requested.length<=maxAdded&&!seen.has(signature)){seen.add(signature);priority.add(signature);queue.push(complete);}
    }
    const candidates=new Set<number>(conflicts.filter(id=>!selectedSet.has(id)));
    // A conflict in a selected parent can require completion in one of its incident neighbors.
    if(!candidates.size)for(const id of conflicts)for(const n of graph.get(id)??[])if(!selectedSet.has(n))candidates.add(n);
    const rank=new Map(states.map(s=>[s.parentId,s.selectedFaces*100+s.selectedEdges*10+s.markedVertices]));
    for(const id of [...candidates].sort((a,b)=>(rank.get(b)??0)-(rank.get(a)??0)||a-b)){
      if(!distances.has(id)||!allowed.has(id))continue;
      const next=[...selected,id].sort((a,b)=>a-b),signature=key(next);
      if(!seen.has(signature)){seen.add(signature);queue.push(next);}
    }
  }
  throw new HexTransitionClosureError(protectedFailure?"HEX_CLOSURE_PROTECTED":queue.length?"HEX_CLOSURE_LIMIT":"HEX_CLOSURE_UNSUPPORTED",
    "No conforming transition closure within the declared state, layer and parent budgets; input is unchanged."+lastReason,
    {requestedParentIds:requested,attemptedStates,conflictingParentIds:lastConflicts});
}

export function vertexNeighbors(mesh:Mesh):Map<number,Set<number>>{
  const owners=new Map<number,number[]>(),neighbors=new Map<number,Set<number>>();
  mesh.elements.forEach((e,i)=>{neighbors.set(i+1,new Set());for(const n of e){const list=owners.get(n)??[];list.push(i+1);owners.set(n,list);}});
  for(const list of owners.values())for(const a of list)for(const b of list)if(a!==b)neighbors.get(a)!.add(b);
  return neighbors;
}
function distanceLayers(graph:Map<number,Set<number>>,seeds:readonly number[],limit:number){
  const distance=new Map(seeds.map(id=>[id,0])),queue=[...seeds];
  for(let i=0;i<queue.length;i++){const id=queue[i]!,d=distance.get(id)!;if(d===limit)continue;
    for(const n of graph.get(id)??[])if(!distance.has(n)){distance.set(n,d+1);queue.push(n);}}
  return distance;
}
function validate(mesh:Mesh,ids:readonly number[],options:HexTransitionClosureOptions){
  if(mesh.kind!=="H1"||!mesh.elements.length||mesh.elements.some(e=>e.length!==8||new Set(e).size!==8||e.some(n=>!Number.isSafeInteger(n)||n<1||n>mesh.nodes.length)))throw new RangeError("closure requires valid H1 connectivity");
  if(mesh.nodes.some(p=>p.length!==3||p.some(v=>!Number.isFinite(v))))throw new RangeError("closure requires finite 3D coordinates");
  const faces=new Map<string,number>(),cells=new Set<string>();
  for(const e of mesh.elements){const cell=key(e);if(cells.has(cell))throw new RangeError("duplicate closure input cell");cells.add(cell);
    if(!(minimumHexCornerScaledJacobian(e.map(n=>mesh.nodes[n-1]!))>0))throw new RangeError("closure requires positively oriented source Hex cells");
    for(const f of H1_FACES){const signature=key(f.map(n=>e[n-1]!)),count=(faces.get(signature)??0)+1;faces.set(signature,count);if(count>2)throw new RangeError("nonmanifold closure input face");}}
  if(Object.keys(options).some(k=>!["ratio","maxAddedParents","maxAddedLayers","maxStates","maxOutputElements","allowedParentIds","mergeTolerance","allowSupportRedistribution"].includes(k)))throw new RangeError("unknown closure option");
  if(options.allowSupportRedistribution!==undefined&&typeof options.allowSupportRedistribution!=="boolean")throw new TypeError("allowSupportRedistribution must be boolean");
  if(options.ratio!==2&&options.ratio!==3)throw new RangeError("closure ratio must be 2 or 3");
  for(const [k,v] of Object.entries({maxAddedParents:options.maxAddedParents??16,maxAddedLayers:options.maxAddedLayers??1,maxStates:options.maxStates??64,maxOutputElements:options.maxOutputElements??2000000}))if(!Number.isSafeInteger(v)||v<(k==="maxAddedParents"||k==="maxAddedLayers"?0:1))throw new RangeError(`invalid ${k}`);
  for(const list of [ids,...(options.allowedParentIds?[options.allowedParentIds]:[])])if(!Array.isArray(list)||list.some(n=>!Number.isSafeInteger(n)||n<1||n>mesh.elements.length))throw new RangeError("invalid closure parent IDs");
  if(!ids.length)throw new RangeError("closure selection must not be empty");
  if(options.mergeTolerance!==undefined&&(!Number.isFinite(options.mergeTolerance)||options.mergeTolerance<=0))throw new RangeError("invalid mergeTolerance");
  return [...new Set(ids)].sort((a,b)=>a-b);
}
const key=(ids:readonly number[])=>[...ids].sort((a,b)=>a-b).join(":");
