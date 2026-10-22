import type {Mesh,RefinementRole} from "./types.js";
import {buildAuditedHexRefinementOutput} from "./refinement-errors.js";
import {buildFullSectionTwoToOneHexPlan} from "./two-to-one.js";
import {checkNoHangingNodes} from "./conformance.js";
import {hexElementSignedVolume,minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {minElementEdgeLength} from "./mesh.js";
import {auditHexFaceGrading} from "./hex-face-grading.js";
import {relaxTransitionInteriors} from "./transition-interior-relaxation.js";
import {extractExtrudedSection,planSectionParity} from "./ogrid-section.js";
import {completeCircularSection} from "./ogrid-completion.js";
import {conserveTransitionFaceFlux,type ConservativeFaceMappingReport} from "./transition-face-flux.js";
import {assembleReferenceStage,finalizeDirectShellMacros,prepareSharedAxialShells,type ReferenceSupport} from "./hierarchical-shell.js";

export interface OgridBand {min:number;max:number;level:1|2|3;}
export interface OgridRefinementOptions {
  axis:0|1|2;bands:readonly OgridBand[];
  /** Explicit permission to change coarse topology/XY coordinates on a circular extrusion. */
  completion:"none"|"circular-sheet";
  maxAddedSectionColumns?:number;maxPromotedSourceLayers?:number;maxOutputElements?:number;
  minimumEdgeFraction?:number;
  symmetryPlanes?:readonly {axis:0|1|2;coordinate:number}[];
  /** Opt in to a bounded change of NEW transition-face nodes, never source/core nodes. */
  transitionGeometry?:"trilinear"|"conservative-face-flux";
  maximumFaceDisplacementFraction?:number;
  balanceMode?:"strong-support"|"direct-macro";
  /** Original-parent support layers per intermediate level; strong-support mode only. */
  strongSupportLayers?:number;
  /** Optional strict face-local centroid-standoff ratio, not the nominal refinement ratio. */
  maximumAdjacentNormalSizeRatio?:number;
  transitionInteriorRelaxation?:"none"|"guarded-laplacian";
}
const volume=(mesh:Mesh)=>mesh.elements.reduce((sum,e)=>sum+hexElementSignedVolume(e.map(n=>mesh.nodes[n-1]!)),0);
const EDGES=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]] as const;
function sizeDistribution(mesh:Mesh,uniform:readonly boolean[],finestCore:(i:number)=>boolean){
  let coreMinimumEdge=Infinity,transitionMinimumEdge=Infinity,maximumTransitionEdgeAspect=0,transitionElements=0;
  mesh.elements.forEach((e,i)=>{
    if(uniform[i]&&!finestCore(i))return;
    let low=Infinity,high=0;
    for(const [a,b] of EDGES){const p=mesh.nodes[e[a]!-1]!,q=mesh.nodes[e[b]!-1]!,length=Math.hypot(p[0]!-q[0]!,p[1]!-q[1]!,p[2]!-q[2]!);low=Math.min(low,length);high=Math.max(high,length);}
    if(uniform[i])coreMinimumEdge=Math.min(coreMinimumEdge,low);
    else{transitionElements++;transitionMinimumEdge=Math.min(transitionMinimumEdge,low);maximumTransitionEdgeAspect=Math.max(maximumTransitionEdgeAspect,high/low);}
  });
  return {finestCoreMinimumEdge:coreMinimumEdge,transitionMinimumEdge,transitionToFinestCoreEdgeRatio:transitionMinimumEdge/coreMinimumEdge,
    maximumTransitionEdgeAspect,transitionElements,scope:'Part-wide edge statistics, not an adjacent-cell grading or engineering acceptance certificate.'};
}

/** Full section and full requested bands, including bounded balance completion of weak requests. */
export function refineExtrudedOgrid(mesh:Mesh,options:OgridRefinementOptions){
  if(Object.keys(options).some(k=>!["axis","bands","completion","maxAddedSectionColumns","maxPromotedSourceLayers","maxOutputElements","minimumEdgeFraction","symmetryPlanes","transitionGeometry","maximumFaceDisplacementFraction","balanceMode","strongSupportLayers","maximumAdjacentNormalSizeRatio","transitionInteriorRelaxation"].includes(k)))throw new RangeError('unknown O-grid option');
  if(options.transitionInteriorRelaxation!==undefined&&!["none","guarded-laplacian"].includes(options.transitionInteriorRelaxation))throw new RangeError('invalid transitionInteriorRelaxation');
  if(options.maximumAdjacentNormalSizeRatio!==undefined&&(!Number.isFinite(options.maximumAdjacentNormalSizeRatio)||options.maximumAdjacentNormalSizeRatio<1))throw new RangeError('maximumAdjacentNormalSizeRatio must be finite and at least1');
  if(options.balanceMode!==undefined&&!["strong-support","direct-macro"].includes(options.balanceMode))throw new RangeError('invalid O-grid balance mode');
  if(options.transitionGeometry!==undefined&&!["trilinear","conservative-face-flux"].includes(options.transitionGeometry))throw new RangeError('invalid transition geometry policy');
  if(options.maximumFaceDisplacementFraction!==undefined&&(options.transitionGeometry!=="conservative-face-flux"||!Number.isFinite(options.maximumFaceDisplacementFraction)||options.maximumFaceDisplacementFraction<=0||options.maximumFaceDisplacementFraction>.05))throw new RangeError('invalid conservative face displacement budget');
  if(options.completion!=="none"&&options.completion!=="circular-sheet")throw new RangeError('explicit O-grid completion policy is required');
  if(!Array.isArray(options.bands)||!options.bands.length||options.bands.some(b=>Object.keys(b).some(k=>!["min","max","level"].includes(k))||!Number.isFinite(b.min)||!Number.isFinite(b.max)||b.min>=b.max||![1,2,3].includes(b.level)))throw new RangeError('invalid O-grid target bands');
  const columnLimit=options.maxAddedSectionColumns??128,layerLimit=options.maxPromotedSourceLayers??8,outputLimit=options.maxOutputElements??2000000,edgeFraction=options.minimumEdgeFraction??.1;
  if([columnLimit,layerLimit,outputLimit].some(v=>!Number.isSafeInteger(v)||v<0)||outputLimit<1||!Number.isFinite(edgeFraction)||edgeFraction<=0||edgeFraction>1)throw new RangeError('invalid O-grid budgets');
  const section=extractExtrudedSection(mesh,options.axis),tol=section.tolerance;
  if(options.symmetryPlanes){
    if(!Array.isArray(options.symmetryPlanes)||options.symmetryPlanes.some(p=>!p||Object.keys(p).some(k=>!["axis","coordinate"].includes(k))||![0,1,2].includes(p.axis)||p.axis===options.axis||!Number.isFinite(p.coordinate)))throw new RangeError('invalid lateral symmetry planes');
    for(const plane of options.symmetryPlanes){let lo=Infinity,hi=-Infinity;for(const p of mesh.nodes){lo=Math.min(lo,p[plane.axis]!);hi=Math.max(hi,p[plane.axis]!);}if(Math.min(Math.abs(plane.coordinate-lo),Math.abs(plane.coordinate-hi))>tol)throw new RangeError('symmetry phase exemption must coincide with an exterior coordinate plane');}
  }
  if(options.bands.some(b=>b.min<section.planes[0]!-tol||b.max>section.planes.at(-1)!+tol))throw new RangeError('requested band exceeds the original specimen extent');
  if(!checkNoHangingNodes(mesh,tol*.01).ok)throw new RangeError('source O-grid has nonconforming interfaces');
  for(const e of mesh.elements)if(!(minimumHexCornerScaledJacobian(e.map(n=>mesh.nodes[n-1]!))>0))throw new RangeError('source has a nonpositive corner Jacobian');
  const requested=section.planes.slice(1).map((z,i)=>options.bands.reduce((level,b)=>{const center=(z+section.planes[i]!)/2;return center>=b.min-tol&&center<=b.max+tol?Math.max(level,b.level):level;},0));
  if(!requested.some(v=>v>0))throw new RangeError('requested bands select no source layer');
  const targets=[...requested],depth=Math.max(...targets);
  const direct=options.balanceMode==="direct-macro";
  const strongSupportLayers=options.strongSupportLayers??1;
  if(!Number.isSafeInteger(strongSupportLayers)||strongSupportLayers<1||strongSupportLayers>8)throw new RangeError('strongSupportLayers must be an integer from1 to8');
  if(direct&&options.strongSupportLayers!==undefined)throw new RangeError('strongSupportLayers is not valid for direct-macro mode');
  if(direct){
    if(options.transitionGeometry!=="conservative-face-flux")throw new RangeError('direct macro requires explicit conservative-face-flux geometry');
    // A zero-target parent between two bands can host two virtual half-shells;
    // an abrupt nonzero-to-nonzero change still needs a different vocabulary.
    for(let i=0;i<requested.length;i++){
      const level=requested[i]!;
      if(level&&i&&requested[i-1]&&requested[i-1]!==level)throw new RangeError('direct macro cannot join adjacent bands with different positive target levels');
    }
  }else for(let level=depth;level>1;level--)for(let i=0;i<targets.length;i++)if(targets[i]!>=level)for(let distance=1;distance<=strongSupportLayers;distance++)for(const neighbor of [i-distance,i+distance])if(neighbor>=0&&neighbor<targets.length)targets[neighbor]=Math.max(targets[neighbor]!,level-1);
  const promoted=targets.flatMap((level,i)=>level>requested[i]!?[i]:[]);
  if(promoted.length>layerLimit)throw new RangeError('weak-band completion exceeds maxPromotedSourceLayers');
  if(!targets.some(v=>v===0))throw new RangeError('completion would consume the entire coarse far field');
  const parity=planSectionParity(section.quads);
  if(parity.cutEdges.length>columnLimit)throw new RangeError('parity completion exceeds maxAddedSectionColumns');
  if(parity.cutEdges.length&&options.completion==="none")throw new RangeError(`section has ${parity.oddOpenChords} odd open chords; explicit circular-sheet completion is required`);
  if(mesh.elements.length+parity.cutEdges.length*(section.planes.length-1)>outputLimit)throw new RangeError('completed coarse extrusion exceeds maxOutputElements');
  const completed=parity.cutEdges.length?completeCircularSection(mesh,section,parity.labels,edgeFraction):null;
  const coarse=completed?.mesh??mesh,topology=completed?.section??section;
  const completeParity=planSectionParity(topology.quads);if(completeParity.oddOpenChords)throw new Error('section parity completion failed its own witness check');
  const layerByParent=new Map<number,number>();topology.parentIds.forEach(row=>row.forEach((id,i)=>layerByParent.set(id,i)));
  const sourceProvenance=completed?.sourceParents??mesh.elements.map((_,i)=>[i+1]);
  const mergeTolerance=minElementEdgeLength(coarse)*1e-8;
  const prepared=direct?prepareSharedAxialShells(coarse,options.axis,layerByParent,targets,mergeTolerance,outputLimit):null;
  let current=prepared?.mesh??coarse,parentIds=prepared?.parentIds??coarse.elements.map((_,i)=>i+1),levels=current.elements.map(()=>0),uniform=current.elements.map(()=>true),roles:RefinementRole[]=current.elements.map(()=>"unchanged");
  let supports:ReferenceSupport[]|undefined=prepared?.supports;
  const stages:Array<{level:number;selectedParents:number;outputElements:number;changedSourceLayerIndices:number[];geometry:ConservativeFaceMappingReport|null;quality:unknown}>=[];
  for(let level=1;level<=depth;level++){
    const baseCount=coarse.elements.reduce((s,_,i)=>s+(targets[layerByParent.get(i+1)!]!>=level?1:0),0);
    const selected=parentIds.flatMap((id,i)=>targets[layerByParent.get(id)!]!>=level&&uniform[i]&&levels[i]===level-1?[i+1]:[]);
    if(selected.length!==baseCount*8**(level-1))throw new Error('full requested ROI lost uniform descendants before the next level');
    if(current.elements.length+selected.length*7>outputLimit)throw new RangeError('requested full core exceeds maxOutputElements');
    const plan=buildFullSectionTwoToOneHexPlan(current,selected,{...(options.symmetryPlanes?{exemptPlanes:options.symmetryPlanes}:{})});
    const expectedCount=current.elements.length+plan.replacements.reduce((s,r)=>s+r.refinement.elements.length-1,0);
    if(expectedCount>outputLimit)throw new RangeError('transition field exceeds maxOutputElements before assembly');
    const geometry=options.transitionGeometry==="conservative-face-flux"?conserveTransitionFaceFlux(current,plan,options.maximumFaceDisplacementFraction):null;
    const replacements=geometry?.replacements??plan.replacements;
    // Only trusted in-tree templates reach this gate; it is not an external macro installer.
    const referenceStage=supports?assembleReferenceStage(current,replacements,supports,mergeTolerance):null;
    const result=referenceStage??buildAuditedHexRefinementOutput(current,replacements,mergeTolerance,true,2);
    if(referenceStage)supports=referenceStage.supports;
    if(result.mesh.elements.length!==expectedCount)throw new Error('transition output count differs from the exact plan');
    const replaced=new Set(plan.replacements.map(r=>r.elementId));
    const cellData=current.elements.flatMap((_,i)=>replaced.has(i+1)?[]:[{parentElementId:i+1,role:"unchanged" as RefinementRole}]);
    for(const r of replacements)for(const _ of r.refinement.elements)cellData.push({parentElementId:r.elementId,role:r.role});
    const changedSourceLayerIndices=[...new Set(plan.replacements.map(r=>layerByParent.get(parentIds[r.elementId-1]!)!))].sort((a,b)=>a-b);
    const nextParents:number[]=[],nextLevels:number[]=[],nextUniform:boolean[]=[],nextRoles:RefinementRole[]=[];
    cellData.forEach(c=>{const i=c.parentElementId-1,changed=c.role!=="unchanged";nextParents.push(parentIds[i]!);nextLevels.push(levels[i]!+(changed?1:0));nextUniform.push(uniform[i]!&&(!changed||c.role==="selected"));nextRoles.push(changed?c.role:roles[i]!);});
    current=result.mesh;parentIds=nextParents;levels=nextLevels;uniform=nextUniform;roles=nextRoles;
    stages.push({level,selectedParents:selected.length,outputElements:current.elements.length,changedSourceLayerIndices,geometry:geometry?.report??null,quality:result.quality});
  }
  let macroReport:ReturnType<typeof finalizeDirectShellMacros>["report"]|null=null;
  if(direct){
    const macro=finalizeDirectShellMacros(coarse,current,parentIds,supports!,options.axis,layerByParent,targets,mergeTolerance,options.maximumFaceDisplacementFraction??.001);
    current=macro.mesh;parentIds=macro.rawChildIndices.map(i=>parentIds[i]!);levels=macro.rawChildIndices.map(i=>levels[i]!);
    uniform=macro.rawChildIndices.map(i=>uniform[i]!);roles=macro.rawChildIndices.map(i=>roles[i]!);macroReport=macro.report;
  }
  const counts=new Map<number,number>();parentIds.forEach(id=>counts.set(id,(counts.get(id)??0)+1));
  const requestedOriginalIds=section.parentIds.flatMap(row=>row.filter((_,layer)=>requested[layer]!>0));
  const coveredOriginalIds=new Set([...counts.keys()].flatMap(id=>sourceProvenance[id-1]!));
  if(requestedOriginalIds.some(id=>!coveredOriginalIds.has(id)))throw new Error('selected original parent provenance is incomplete');
  for(let parent=1;parent<=coarse.elements.length;parent++)if(targets[layerByParent.get(parent)!]===depth){
    if(counts.get(parent)!==8**depth)throw new Error('finest O-grid core does not have the exact tensor child count');
  }
  if(parentIds.some((p,i)=>targets[layerByParent.get(p)!]===depth&&(!uniform[i]||levels[i]!==depth)))throw new Error('a transition leaked into the requested finest core');
  const relaxed=options.transitionInteriorRelaxation==="guarded-laplacian"?relaxTransitionInteriors(coarse,current,parentIds,uniform):null;
  if(relaxed)current=relaxed.mesh;
  if(!checkNoHangingNodes(current,mergeTolerance*10).ok)throw new Error('final O-grid is not conforming');
  const originalVolume=volume(mesh),completedVolume=volume(coarse),finalVolume=volume(current),refinementError=Math.abs(finalVolume-completedVolume)/Math.abs(completedVolume);
  if(!(refinementError<1e-8))throw new Error('O-grid refinement failed completed-parent volume conservation');
  let minSJ=Infinity;for(const e of current.elements)minSJ=Math.min(minSJ,minimumHexCornerScaledJacobian(e.map(n=>current.nodes[n-1]!)));
  const preserved=parentIds.filter((_,i)=>levels[i]===0);
  if(!preserved.length)throw new Error('no coarse far field remains');
  const sizes=sizeDistribution(current,uniform,i=>targets[layerByParent.get(parentIds[i]!)!]===depth&&levels[i]===depth);
  const adjacencyGrading=auditHexFaceGrading(current,{reviewElementIds:uniform.flatMap((value,i)=>value?[]:[i+1]),
    ...(options.maximumAdjacentNormalSizeRatio===undefined?{}:{maximumNormalSizeRatio:options.maximumAdjacentNormalSizeRatio})});
  if(options.maximumAdjacentNormalSizeRatio!==undefined&&!adjacencyGrading.requestedLimitVerified)throw new RangeError('requested adjacent normal-size limit was not verified: '+JSON.stringify({limit:options.maximumAdjacentNormalSizeRatio,maximum:adjacencyGrading.maximumNormalSizeRatio,undefinedPairs:adjacencyGrading.undefinedMetricPairs,sameSidePairs:adjacencyGrading.centroidsOnSameSidePairs,aboveLimitPairs:adjacencyGrading.aboveRequestedLimitPairs,worstPair:adjacencyGrading.worstNormalSizePairs[0]?.elementIds??null}));
  const warnings:string[]=[];
  if(minSJ<.15)warnings.push("Minimum corner SJ is below0.15; topology/volume pass is NOT engineering acceptance.");
  if(sizes.transitionToFinestCoreEdgeRatio<1-1e-8)warnings.push("Some transition edges are shorter than the finest-core minimum edge; compact topology can worsen size grading and explicit time steps. Review the transition shape, not just conformance/volume.");
  return {mesh:current,completedMesh:coarse,completedParentIds:parentIds,levels,uniformCells:uniform,roles,sourceParentProvenance:sourceProvenance,
    report:{implementation:"native-typescript",originalElements:mesh.elements.length,completedElements:coarse.elements.length,outputElements:current.elements.length,
      requestedBands:options.bands,requestedLayerTargets:requested,effectiveLayerTargets:targets,promotedSourceLayerIndices:promoted,
      requestedOriginalParentIds:requestedOriginalIds,fullSelectedOriginalParentsCovered:true,originalPhysicalRoiCoverageVerified:false,
      selectionPolicy:"source-layer-centroid",selectedLayerIntervals:section.planes.slice(1).flatMap((z,i)=>requested[i]!?[{min:section.planes[i],max:z,level:requested[i]}]:[]),
      targetLevelSemantics:"minimum requested level; lower-level bands may provide finer transition support; only the finest core is exact tensor refinement",
      coreChildrenPerFinestParent:8**depth,
      transitionGeometry:options.transitionGeometry??"trilinear",
      transitionInteriorRelaxation:relaxed?.report??null,
      balanceMode:options.balanceMode??"strong-support",macroFinalization:macroReport,
      sharedShellSourceParentIds:prepared?.splitParents??[],
      strongSupportLayers:direct?null:strongSupportLayers,
      coarseFarFieldParents:new Set(preserved).size,parity:{oddOpenChords:parity.oddOpenChords,cutEdges:parity.cutEdges.length,searchCandidates:parity.searchCandidates},
      completion:completed?.report??null,stages,quality:{minimumCornerSJ:minSJ,originalVolume,completedVolume,finalVolume,refinementRelativeVolumeError:refinementError,sizeDistribution:sizes,adjacencyGrading,engineeringAcceptanceVerified:false,
        completionRelativeVolumeChange:(completedVolume-originalVolume)/originalVolume},
      balancePolicy:direct?"direct whole-parent hierarchical shells for separated full-section level1/2/3 bands; no whole-parent promotion; not arbitrary CinoLib WB schemes":"weak requested axial levels are conservatively completed to separated strong-balance support; not arbitrary CinoLib WB schemes",
      qualityWarnings:warnings,
      warning:(completed?"Circular completion changes coarse section topology/coordinates and discrete polygonal volume. Analytic circle and axial planes are retained. ":"Source vertices are retained. ")+(direct?"Direct hierarchical macros reparameterize NEW axial stations within each original shell parent; original planes and uniform core grid stay fixed. ":"")+(options.transitionGeometry==="conservative-face-flux"?"New transition-face interior nodes use bounded conservative flux mapping, not exact original bilinear surfaces. The normal correction budget is separate from axial station reparameterization. ":"")+"Symmetry phase exemptions do not exempt interface-conformance checks. Mesh-only output; solver state is not migrated."}};
}
