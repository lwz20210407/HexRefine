import type {Mesh,RefinementRole} from "./types.js";
import {buildAuditedHexRefinementOutput} from "./refinement-errors.js";
import {buildDirectTwoToOneHexPlan} from "./two-to-one.js";
import {checkNoHangingNodes} from "./conformance.js";
import {hexElementSignedVolume,minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {minElementEdgeLength} from "./mesh.js";
import {extractExtrudedSection,planSectionParity} from "./ogrid-section.js";
import {completeCircularSection} from "./ogrid-completion.js";

export interface OgridBand {min:number;max:number;level:1|2|3;}
export interface OgridRefinementOptions {
  axis:0|1|2;bands:readonly OgridBand[];
  /** Explicit permission to change coarse topology/XY coordinates on a circular extrusion. */
  completion:"none"|"circular-sheet";
  maxAddedSectionColumns?:number;maxPromotedSourceLayers?:number;maxOutputElements?:number;
  minimumEdgeFraction?:number;
  symmetryPlanes?:readonly {axis:0|1|2;coordinate:number}[];
}
const volume=(mesh:Mesh)=>mesh.elements.reduce((sum,e)=>sum+hexElementSignedVolume(e.map(n=>mesh.nodes[n-1]!)),0);

/** Full section and full requested bands, including bounded balance completion of weak requests. */
export function refineExtrudedOgrid(mesh:Mesh,options:OgridRefinementOptions){
  if(Object.keys(options).some(k=>!["axis","bands","completion","maxAddedSectionColumns","maxPromotedSourceLayers","maxOutputElements","minimumEdgeFraction","symmetryPlanes"].includes(k)))throw new RangeError('unknown O-grid option');
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
  for(let level=depth;level>1;level--)for(let i=0;i<targets.length;i++)if(targets[i]!>=level)for(const neighbor of [i-1,i+1])if(neighbor>=0&&neighbor<targets.length)targets[neighbor]=Math.max(targets[neighbor]!,level-1);
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
  let current=coarse,parentIds=coarse.elements.map((_,i)=>i+1),levels=coarse.elements.map(()=>0),uniform=coarse.elements.map(()=>true),roles:RefinementRole[]=coarse.elements.map(()=>"unchanged");
  const stages:Array<{level:number;selectedParents:number;outputElements:number;changedSourceLayerIndices:number[];quality:unknown}>=[];
  const mergeTolerance=minElementEdgeLength(coarse)*1e-8;
  for(let level=1;level<=depth;level++){
    const baseCount=coarse.elements.reduce((s,_,i)=>s+(targets[layerByParent.get(i+1)!]!>=level?1:0),0);
    const selected=parentIds.flatMap((id,i)=>targets[layerByParent.get(id)!]!>=level&&uniform[i]&&levels[i]===level-1?[i+1]:[]);
    if(selected.length!==baseCount*8**(level-1))throw new Error('full requested ROI lost uniform descendants before the next level');
    if(current.elements.length+selected.length*7>outputLimit)throw new RangeError('requested full core exceeds maxOutputElements');
    const plan=buildDirectTwoToOneHexPlan(current,selected,{...(options.symmetryPlanes?{exemptPlanes:options.symmetryPlanes}:{})});
    const expectedCount=current.elements.length+plan.replacements.reduce((s,r)=>s+r.refinement.elements.length-1,0);
    if(expectedCount>outputLimit)throw new RangeError('transition field exceeds maxOutputElements before assembly');
    // Only trusted in-tree templates reach this gate; it is not an external macro installer.
    const result=buildAuditedHexRefinementOutput(current,plan.replacements,mergeTolerance,true,2);
    if(result.mesh.elements.length!==expectedCount)throw new Error('transition output count differs from the exact plan');
    const replaced=new Set(plan.replacements.map(r=>r.elementId));
    const cellData=current.elements.flatMap((_,i)=>replaced.has(i+1)?[]:[{parentElementId:i+1,role:"unchanged" as RefinementRole}]);
    for(const r of plan.replacements)for(const _ of r.refinement.elements)cellData.push({parentElementId:r.elementId,role:r.role});
    const changedSourceLayerIndices=[...new Set(plan.replacements.map(r=>layerByParent.get(parentIds[r.elementId-1]!)!))].sort((a,b)=>a-b);
    const nextParents:number[]=[],nextLevels:number[]=[],nextUniform:boolean[]=[],nextRoles:RefinementRole[]=[];
    cellData.forEach(c=>{const i=c.parentElementId-1,changed=c.role!=="unchanged";nextParents.push(parentIds[i]!);nextLevels.push(levels[i]!+(changed?1:0));nextUniform.push(uniform[i]!&&(!changed||c.role==="selected"));nextRoles.push(changed?c.role:roles[i]!);});
    current=result.mesh;parentIds=nextParents;levels=nextLevels;uniform=nextUniform;roles=nextRoles;
    stages.push({level,selectedParents:selected.length,outputElements:current.elements.length,changedSourceLayerIndices,quality:result.quality});
  }
  const counts=new Map<number,number>();parentIds.forEach(id=>counts.set(id,(counts.get(id)??0)+1));
  const requestedOriginalIds=section.parentIds.flatMap(row=>row.filter((_,layer)=>requested[layer]!>0));
  const coveredOriginalIds=new Set([...counts.keys()].flatMap(id=>sourceProvenance[id-1]!));
  if(requestedOriginalIds.some(id=>!coveredOriginalIds.has(id)))throw new Error('selected original parent provenance is incomplete');
  for(let parent=1;parent<=coarse.elements.length;parent++)if(targets[layerByParent.get(parent)!]===depth){
    if(counts.get(parent)!==8**depth)throw new Error('finest O-grid core does not have the exact tensor child count');
  }
  if(parentIds.some((p,i)=>targets[layerByParent.get(p)!]===depth&&(!uniform[i]||levels[i]!==depth)))throw new Error('a transition leaked into the requested finest core');
  if(!checkNoHangingNodes(current,mergeTolerance*10).ok)throw new Error('final O-grid is not conforming');
  const originalVolume=volume(mesh),completedVolume=volume(coarse),finalVolume=volume(current),refinementError=Math.abs(finalVolume-completedVolume)/Math.abs(completedVolume);
  if(!(refinementError<1e-8))throw new Error('O-grid refinement failed completed-parent volume conservation');
  let minSJ=Infinity;for(const e of current.elements)minSJ=Math.min(minSJ,minimumHexCornerScaledJacobian(e.map(n=>current.nodes[n-1]!)));
  const preserved=parentIds.filter((_,i)=>levels[i]===0);
  if(!preserved.length)throw new Error('no coarse far field remains');
  return {mesh:current,completedMesh:coarse,completedParentIds:parentIds,levels,uniformCells:uniform,roles,sourceParentProvenance:sourceProvenance,
    report:{implementation:"native-typescript",originalElements:mesh.elements.length,completedElements:coarse.elements.length,outputElements:current.elements.length,
      requestedBands:options.bands,requestedLayerTargets:requested,effectiveLayerTargets:targets,promotedSourceLayerIndices:promoted,
      requestedOriginalParentIds:requestedOriginalIds,fullSelectedOriginalParentsCovered:true,originalPhysicalRoiCoverageVerified:false,
      selectionPolicy:"source-layer-centroid",selectedLayerIntervals:section.planes.slice(1).flatMap((z,i)=>requested[i]!?[{min:section.planes[i],max:z,level:requested[i]}]:[]),
      targetLevelSemantics:"minimum requested level; lower-level bands may provide finer transition support; only the finest core is exact tensor refinement",
      coreChildrenPerFinestParent:8**depth,
      coarseFarFieldParents:new Set(preserved).size,parity:{oddOpenChords:parity.oddOpenChords,cutEdges:parity.cutEdges.length,searchCandidates:parity.searchCandidates},
      completion:completed?.report??null,stages,quality:{minimumCornerSJ:minSJ,originalVolume,completedVolume,finalVolume,refinementRelativeVolumeError:refinementError,
        completionRelativeVolumeChange:(completedVolume-originalVolume)/originalVolume},
      balancePolicy:"weak requested axial levels are conservatively completed to separated strong-balance support; not arbitrary CinoLib WB schemes",
      warning:completed?"Circular completion changes coarse section topology/coordinates and discrete polygonal volume. Analytic circle and axial planes are retained. Mesh-only output; solver state is not migrated.":"Source geometry is retained. Symmetry phase exemptions do not exempt any interface-conformance checks. Mesh-only output; solver state is not migrated."}};
}
