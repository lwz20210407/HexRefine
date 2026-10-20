import type {Mesh,RefinementRole,RefinementCellData} from "./types.js";
import {refineHexWithTransitionClosure,vertexNeighbors,type HexTransitionClosureOptions} from "./hex-transition-closure.js";
import {checkNoHangingNodes} from "./conformance.js";
import {hexElementSignedVolume,minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {minElementEdgeLength} from "./mesh.js";

export interface HexTargetLevel {parentId:number;level:number;}
export interface HexMultilevelOptions extends Omit<HexTransitionClosureOptions,"allowedParentIds"> {
  maxLevel?:number;
  /** Budget for base parents promoted to any higher level by the balance closure. */
  maxBalancedParents?:number;
  allowedBaseParentIds?:readonly number[];
}

/** Base-parent target levels, balanced in vertex adjacency before any templates are installed. */
export function refineHexMultilevel(mesh:Mesh,targets:readonly HexTargetLevel[],options:HexMultilevelOptions){
  if(Object.keys(options).some(k=>!["ratio","maxAddedParents","maxAddedLayers","maxStates","maxOutputElements","mergeTolerance","maxLevel","maxBalancedParents","allowedBaseParentIds","allowSupportRedistribution"].includes(k)))throw new RangeError("unknown multilevel option");
  const maxLevel=options.maxLevel??3,budget=options.maxBalancedParents??128,limit=options.maxOutputElements??2000000;
  if(!Number.isSafeInteger(maxLevel)||maxLevel<1||maxLevel>4||!Number.isSafeInteger(budget)||budget<0)throw new RangeError("invalid multilevel depth or balance budget");
  if(!targets.length||targets.some(t=>!Number.isSafeInteger(t.parentId)||t.parentId<1||t.parentId>mesh.elements.length||!Number.isSafeInteger(t.level)||t.level<1||t.level>maxLevel||Object.keys(t).some(k=>k!=="parentId"&&k!=="level")))throw new RangeError("invalid target parent or level");
  const desired=new Map<number,number>();for(const t of targets)desired.set(t.parentId,Math.max(desired.get(t.parentId)??0,t.level));
  if((options.ratio!==2&&options.ratio!==3)||!Number.isSafeInteger(limit)||limit<1)throw new RangeError("invalid multilevel ratio or output limit");
  const lowerBound=[...desired.values()].reduce((sum,level)=>sum+options.ratio**(3*level),mesh.elements.length-desired.size);
  if(lowerBound>limit)throw new RangeError("requested core alone exceeds maxOutputElements");
  const levels=new Map(desired),neighbors=vertexNeighbors(mesh),allowed=new Set(options.allowedBaseParentIds??mesh.elements.map((_,i)=>i+1));
  if(options.allowedBaseParentIds?.some(id=>!Number.isSafeInteger(id)||id<1||id>mesh.elements.length)||[...desired.keys()].some(id=>!allowed.has(id)))throw new RangeError("invalid or protected target base parent");
  const added=new Set<number>();
  const promote=(id:number,level:number)=>{
    if((levels.get(id)??0)>=level)return;
    if(!allowed.has(id))throw new RangeError("multilevel balance reaches a protected base parent");
    if(level>(desired.get(id)??0))added.add(id);
    if(added.size>budget)throw new RangeError("multilevel balance exceeds maxBalancedParents");
    levels.set(id,level);
  };
  const depth=Math.max(...desired.values());
  for(let level=depth;level>1;level--)for(const [id,target] of [...levels])if(target>=level)for(const n of neighbors.get(id)??[])promote(n,level-1);
  // Lower-level compensation can add base parents; replan from the immutable input.
  const closureOptions:HexTransitionClosureOptions={ratio:options.ratio,maxAddedParents:options.maxAddedParents??16,
    maxAddedLayers:options.maxAddedLayers??1,maxStates:options.maxStates??64,maxOutputElements:limit,
    allowSupportRedistribution:options.allowSupportRedistribution??false,
    ...(options.mergeTolerance!==undefined?{mergeTolerance:options.mergeTolerance}:{})};
  for(let restart=0;restart<=budget;restart++){
    let current=mesh,baseIds=mesh.elements.map((_,i)=>i+1),cellLevels=mesh.elements.map(()=>0),uniform=mesh.elements.map(()=>true);
    let lastRoles:RefinementRole[]=mesh.elements.map(()=>"unchanged");
    const stages:unknown[]=[];let replan=false;
    for(let level=1;level<=depth;level++){
      const selected=baseIds.flatMap((base,i)=>(levels.get(base)??0)>=level&&uniform[i]&&cellLevels[i]===level-1?[i+1]:[]);
      if(!selected.length)throw new Error("multilevel closure lost requested uniform descendants");
      const valid=baseIds.flatMap((base,i)=>allowed.has(base)&&uniform[i]&&cellLevels[i]===level-1?[i+1]:[]);
      const r=refineUniformPatch(current,selected,valid,closureOptions);
      const newlyPromoted=r.closure.addedParentIds.map(id=>baseIds[id-1]!).filter(id=>(levels.get(id)??0)<level);
      if(newlyPromoted.length){for(const id of newlyPromoted)promote(id,level);replan=true;break;}
      const nextBase:number[]=[],nextLevels:number[]=[],nextUniform:boolean[]=[],nextRoles:RefinementRole[]=[];
      r.cellData.forEach(c=>{
        const i=c.parentElementId-1,changed=c.role!=="unchanged";
        nextBase.push(baseIds[i]!);nextLevels.push(cellLevels[i]!+(changed?1:0));
        nextUniform.push(uniform[i]!&&(!changed||c.role==="selected"));
        nextRoles.push(changed?c.role:lastRoles[i]!);
      });
      stages.push({level,inputElements:current.elements.length,outputElements:r.mesh.elements.length,closure:r.closure});
      current=r.mesh;baseIds=nextBase;cellLevels=nextLevels;uniform=nextUniform;lastRoles=nextRoles;
    }
    if(replan){
      for(let level=depth;level>1;level--)for(const [id,target] of [...levels])if(target>=level)for(const n of neighbors.get(id)??[])promote(n,level-1);
      continue;
    }
    const counts=new Map<number,number>(),unchanged=new Set<number>();
    baseIds.forEach((id,i)=>{counts.set(id,(counts.get(id)??0)+1);if(cellLevels[i]===0)unchanged.add(id);});
    for(const [id,target] of desired)if(target===depth){
      if(counts.get(id)!==options.ratio**(3*target))throw new Error("finest requested core has an incorrect descendant count");
      if(baseIds.some((base,i)=>base===id&&(!uniform[i]||cellLevels[i]!==target)))throw new Error("finest requested core contains transition cells");
    }
    const tolerance=(options.mergeTolerance??minElementEdgeLength(mesh)*1e-9)*10;
    if(!checkNoHangingNodes(current,tolerance).ok)throw new Error("multilevel final conformance failed");
    let volume=0,minSJ=Infinity,sourceVolume=0;
    for(const e of mesh.elements)sourceVolume+=hexElementSignedVolume(e.map(n=>mesh.nodes[n-1]!));
    for(const e of current.elements){const p=e.map(n=>current.nodes[n-1]!);volume+=hexElementSignedVolume(p);minSJ=Math.min(minSJ,minimumHexCornerScaledJacobian(p));}
    const volumeError=Math.abs(volume-sourceVolume)/Math.abs(sourceVolume);
    if(!(minSJ>0&&volumeError<1e-8))throw new Error("multilevel volume/Jacobian audit failed");
    return {mesh:current,baseParentIds:baseIds,levels:cellLevels,uniformCells:uniform,roles:lastRoles,
      report:{ratio:options.ratio,requestedTargets:[...desired].map(([parentId,level])=>({parentId,level})),
        effectiveTargets:[...levels].sort((a,b)=>a[0]-b[0]).map(([parentId,level])=>({parentId,level})),
        balancedParentIds:[...added].sort((a,b)=>a-b),preservedFarFieldParents:unchanged.size,restarts:restart,stages,
        quality:{minimumCornerScaledJacobian:minSJ,relativeVolumeError:volumeError,volume}}};
  }
  throw new Error("multilevel closure exceeded restart budget without changing input");
}

function refineUniformPatch(mesh:Mesh,selected:readonly number[],valid:readonly number[],options:HexTransitionClosureOptions){
  const parentSet=new Set(valid),nodeIds=[...new Set(valid.flatMap(id=>[...mesh.elements[id-1]!]))].sort((a,b)=>a-b);
  const localNode=new Map(nodeIds.map((id,i)=>[id,i+1])),localParent=new Map(valid.map((id,i)=>[id,i+1]));
  const patch:Mesh={kind:"H1",nodes:nodeIds.map(id=>mesh.nodes[id-1]!),elements:valid.map(id=>mesh.elements[id-1]!.map(n=>localNode.get(n)!))};
  const refined=refineHexWithTransitionClosure(patch,selected.map(id=>localParent.get(id)!),options);
  // Existing interface nodes retain identity; no coordinate welding across the patch boundary.
  for(let i=0;i<nodeIds.length;i++)if(refined.mesh.nodes[i]?.some((v,a)=>v!==patch.nodes[i]![a]))throw new Error("local closure renumbered or moved an existing interface node");
  const nodes=[...mesh.nodes,...refined.mesh.nodes.slice(nodeIds.length)];
  const globalNode=(id:number)=>id<=nodeIds.length?nodeIds[id-1]!:mesh.nodes.length+id-nodeIds.length;
  const untouched=mesh.elements.flatMap((e,i)=>parentSet.has(i+1)?[]:[{e,id:i+1}]);
  const cellData:RefinementCellData[]=[...untouched.map(v=>({parentElementId:v.id,role:"unchanged" as const,templateCode:0})),
    ...refined.cellData.map(c=>({...c,parentElementId:valid[c.parentElementId-1]!}))];
  const combined:Mesh={kind:"H1",nodes,elements:[...untouched.map(v=>v.e),...refined.mesh.elements.map(e=>e.map(globalNode))]};
  if(combined.elements.length>(options.maxOutputElements??2000000))throw new RangeError("multilevel closure exceeds maxOutputElements");
  if(!checkNoHangingNodes(combined,(options.mergeTolerance??minElementEdgeLength(mesh)*1e-9)*10).ok)throw new Error("local closure would alter its frozen external interface");
  const ids=(list:readonly number[])=>list.map(id=>valid[id-1]!);
  return {mesh:combined,cellData,closure:{...refined.closure,
    requestedParentIds:ids(refined.closure.requestedParentIds),effectiveParentIds:ids(refined.closure.effectiveParentIds),
    addedParentIds:ids(refined.closure.addedParentIds),affectedParentIds:ids(refined.closure.affectedParentIds),
    preservedFarFieldParents:mesh.elements.length-refined.closure.affectedParentIds.length,
    boundaryStates:refined.closure.boundaryStates.map(s=>({...s,parentId:valid[s.parentId-1]!})),
    supportRedistribution:refined.closure.supportRedistribution.map(s=>({...s,parentId:valid[s.parentId-1]!}))}};
}
