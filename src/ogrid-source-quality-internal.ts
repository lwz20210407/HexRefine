import type {Mesh} from "./types.js";
import {minimumHexCornerScaledJacobian} from "./hex-quality.js";

// Dimensionless arithmetic allowance, fixed and not an engineering quality floor.
export const CORE_SJ_ROUNDOFF=4096*Number.EPSILON;
export class SourcePreservingQualityError extends Error {
  constructor(readonly code:string,message:string,readonly parentIds:readonly number[]=[],readonly diagnostics:Readonly<Record<string,unknown>>={}){super(message);this.name="SourcePreservingQualityError";}
}

/** Also used after K readback: never substitute a global minimum for per-parent checks. */
export function auditOgridSourcePreservingQuality(source:Mesh,output:Mesh,parentIds:readonly number[],cores:ReadonlyMap<number,number>,shells:ReadonlySet<number>,minimumTransitionSJ:number,sourceMinimumSJ?:readonly number[]){
  if(!Number.isFinite(minimumTransitionSJ)||minimumTransitionSJ<=0||minimumTransitionSJ>1)throw new RangeError("invalid minimum transition corner SJ");
  if(source.kind!=="H1"||output.kind!=="H1"||parentIds.length!==output.elements.length||!cores.size||!shells.size)throw new RangeError("invalid source-preserving quality domains");
  if(output.nodes.length<source.nodes.length||source.nodes.some((p,i)=>p.length!==output.nodes[i]!.length||p.some((v,a)=>v!==output.nodes[i]![a])))throw new SourcePreservingQualityError("protected-source-nodes","Original source coordinates changed; inherited-quality acceptance is not applicable.");
  const oldSJ=sourceMinimumSJ??source.elements.map(e=>minimumHexCornerScaledJacobian(e.map(n=>source.nodes[n-1]!)));
  if(oldSJ.length!==source.elements.length||oldSJ.some(v=>!Number.isFinite(v)||!(v>0)))throw new RangeError("invalid original-parent corner quality");
  for(const [id,level] of cores)if(!Number.isSafeInteger(id)||id<1||id>source.elements.length||![1,2,3].includes(level)||shells.has(id))throw new RangeError("invalid source-preserving core");
  for(const id of shells)if(!Number.isSafeInteger(id)||id<1||id>source.elements.length)throw new RangeError("invalid source-preserving shell");
  const counts=new Uint32Array(source.elements.length),minimumByParent=new Float64Array(source.elements.length).fill(Infinity);
  let minimumCore=Infinity,minimumTransition=Infinity,minimumFar=Infinity,worstTransition=0;
  for(const [i,e] of output.elements.entries()){
    const id=parentIds[i]!;
    if(!Number.isSafeInteger(id)||id<1||id>source.elements.length||e.length!==8||e.some(n=>!Number.isSafeInteger(n)||n<1||n>output.nodes.length))throw new RangeError("invalid source-preserving lineage/connectivity");
    const sj=minimumHexCornerScaledJacobian(e.map(n=>output.nodes[n-1]!));
    if(!(sj>0))throw new SourcePreservingQualityError("final-corner","Output has a nonpositive corner sample.",[id]);
    counts[id-1]=counts[id-1]!+1;minimumByParent[id-1]=Math.min(minimumByParent[id-1]!,sj);
    if(cores.has(id))minimumCore=Math.min(minimumCore,sj);
    else if(shells.has(id)){if(sj<minimumTransition){minimumTransition=sj;worstTransition=id;}}
    else{
      if(e.some((n,a)=>n!==source.elements[id-1]![a]))throw new SourcePreservingQualityError("protected-far-field","Original far-field connectivity changed.",[id]);
      minimumFar=Math.min(minimumFar,sj);
    }
  }
  let maximumCoreLoss=0,worstCoreParent=0,farCount=0;
  for(let i=0;i<source.elements.length;i++){
    const id=i+1,level=cores.get(id),expected=level===undefined?shells.has(id)?null:1:8**level;
    if(counts[i]===0||(expected!==null&&counts[i]!==expected))throw new SourcePreservingQualityError("protected-parent-count","Source core/far-field parent coverage changed.",[id]);
    if(level!==undefined){const loss=oldSJ[i]!-minimumByParent[i]!;if(loss>maximumCoreLoss){maximumCoreLoss=loss;worstCoreParent=id;}}
    else if(!shells.has(id))farCount++;
  }
  if(maximumCoreLoss>CORE_SJ_ROUNDOFF)throw new SourcePreservingQualityError("core-quality-regression","A protected core parent's child minimum corner SJ is worse than that original parent's minimum.",[worstCoreParent],
    {sourceMinimumCornerSJ:oldSJ[worstCoreParent-1],childMinimumCornerSJ:minimumByParent[worstCoreParent-1],loss:maximumCoreLoss,numericalRoundoffAllowance:CORE_SJ_ROUNDOFF,outputGenerated:false});
  if(minimumTransition<minimumTransitionSJ)throw new SourcePreservingQualityError("transition-quality","Merged or written transition fails its requested minimum corner SJ.",[worstTransition],
    {requiredMinimumTransitionCornerSJ:minimumTransitionSJ,actualMinimumTransitionCornerSJ:minimumTransition,outputGenerated:false});
  return {scope:"transition-floor-with-source-nonregression" as const,passed:true,requiredMinimumTransitionCornerSJ:minimumTransitionSJ,
    minimumCoreCornerSJ:minimumCore,minimumTransitionCornerSJ:minimumTransition,minimumFarFieldCornerSJ:minimumFar,
    checkedCoreParents:cores.size,checkedFarFieldParents:farCount,maximumCoreParentCornerSJLoss:maximumCoreLoss,worstCoreParentId:worstCoreParent||null,
    numericalRoundoffAllowance:CORE_SJ_ROUNDOFF,originalSourceNodesExact:true,farFieldConnectivityExact:true,coreParentCountsExact:true,
    globalMinimumCornerSJ:Math.min(minimumCore,minimumTransition,minimumFar),globalMinimumFloorImplied:false};
}
