import type {Mesh} from "./types.js";
import type {TwoToOneReplacement} from "./two-to-one.js";
import type {ReferencePoint3} from "./two-to-one-templates.js";
import {assembleReplacementMesh,mergeCoincidentNodesWithMap} from "./mesh.js";
import {refineHexTo8Hex} from "./templates.js";
import {assertHexPatchQuality,buildAuditedHexRefinementOutput} from "./refinement-errors.js";
import {minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {conserveTransitionFaceFlux} from "./transition-face-flux.js";

const CORNERS:readonly ReferencePoint3[]=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const UNIFORM_REFERENCE=refineHexTo8Hex(CORNERS).nodes;
export type ReferenceSupport=Map<number,number>;
const shape=(r:readonly number[])=>CORNERS.map(c=>c.reduce((s,sign,a)=>s*(1+sign*r[a]!)/2,1));

/** Carry the exact in-tree interpolation provenance through the existing merge map. */
export function assembleReferenceStage(mesh:Mesh,replacements:readonly TwoToOneReplacement[],supports:readonly ReferenceSupport[],tolerance:number){
  const merged=mergeCoincidentNodesWithMap(assembleReplacementMesh(mesh,replacements),tolerance);
  const mergeMap=merged.nodeIdByInputNodeIdArray;
  if(!mergeMap)throw new Error('direct shell needs the authoritative node merge map');
  const quality=assertHexPatchQuality(mesh,replacements,merged.mesh,true);
  const next:ReferenceSupport[]=Array(merged.mesh.nodes.length);
  supports.forEach((s,i)=>{next[mergeMap[i+1]!-1]=s;});
  let offset=mesh.nodes.length;
  for(const r of replacements){
    const refs=r.referenceNodes??(r.role==='selected'?UNIFORM_REFERENCE:undefined),parent=mesh.elements[r.elementId-1]!;
    if(!refs||refs.length!==r.refinement.nodes.length)throw new RangeError('direct shells require trusted reference coordinates');
    refs.forEach((ref,j)=>{
      const combined:ReferenceSupport=new Map();shape(ref).forEach((w,k)=>{if(w)for(const [n,value] of supports[parent[k]!-1]!)combined.set(n,(combined.get(n)??0)+w*value);});
      const id=mergeMap[offset+j+1]!-1,existing=next[id];
      if(existing){
        if([...new Set([...combined.keys(),...existing.keys()])].some(n=>Math.abs((combined.get(n)??0)-(existing.get(n)??0))>1e-12))throw new Error('merged node has incompatible original reference supports');
      }else next[id]=combined;
    });
    offset+=refs.length;
  }
  for(let i=0;i<next.length;i++)if(!next[i])throw new Error('missing direct-shell node provenance');
  return {mesh:merged.mesh,quality,supports:next};
}

/**
 * Complete7/31/127-Hex original-parent macros, not the incomplete9-Hex harvest.
 * One common exponent per interface field preserves shared-wall stations.
 */
export function finalizeDirectShellMacros(
  source:Mesh,current:Mesh,parents:readonly number[],supports:readonly ReferenceSupport[],axis:0|1|2,
  layerByParent:ReadonlyMap<number,number>,targets:readonly number[],tolerance:number,maximumFaceFraction:number
){
  const groups=new Map<number,number[]>();parents.forEach((p,i)=>{const g=groups.get(p)??[];g.push(i);groups.set(p,g);});
  const fixed:TwoToOneReplacement[]=[],shells:Array<{parent:number;depth:number;children:number[];references:number[][];globalIds:number[];elements:number[][];vertices:readonly (readonly number[])[];axial:number;sign:number;fineHigh:boolean}>=[];
  const rawChildIndices=new Map<number,number[]>();
  for(let parent=1;parent<=source.elements.length;parent++){
    const children=groups.get(parent)!;if(children.length===1)continue;
    const layer=layerByParent.get(parent)!,coreDepth=targets[layer]!,isCore=coreDepth>0;
    const fineHigh=(targets[layer+1]??0)>0,fineLow=(targets[layer-1]??0)>0;
    const shellDepth=fineHigh?targets[layer+1]!:fineLow?targets[layer-1]!:0;
    const expected=isCore?8**coreDepth:2*4**shellDepth-1;
    if(!isCore&&(fineHigh===fineLow||shellDepth<1||shellDepth>3))throw new RangeError('direct macro needs exactly one fine source interface');
    if(children.length!==expected)throw new RangeError('direct shell does not match its complete tensor-core/hierarchical-shell topology');
    const original=source.elements[parent-1]!,vertices=original.map(n=>source.nodes[n-1]!),globalIds=[...new Set(children.flatMap(i=>[...current.elements[i]!]))];
    const localIds=new Map(globalIds.map((n,i)=>[n,i+1])),elements=children.map(i=>current.elements[i]!.map(n=>localIds.get(n)!));
    const references=globalIds.map(n=>{
      const ref=[0,0,0];for(const [id,w] of supports[n-1]!){if(Math.abs(w)<1e-14)continue;const corner=original.indexOf(id);if(corner<0)throw new Error('macro node support escapes its original parent');for(let a=0;a<3;a++)ref[a]!+=CORNERS[corner]![a]!*w;}
      return ref;
    });
    rawChildIndices.set(parent,children);
    if(isCore){fixed.push({elementId:parent,role:'selected',templateCode:expected,referenceNodes:references as unknown as ReferencePoint3[],refinement:{kind:'H1',source:`uniform${expected}`,nodes:globalIds.map(n=>current.nodes[n-1]!),elements}});continue;}
    const low=Math.min(...vertices.map(p=>p[axis]!)),high=Math.max(...vertices.map(p=>p[axis]!));
    const axial=[0,1,2].find(a=>[1,-1].some(sign=>CORNERS.every((c,i)=>Math.abs(vertices[i]![axis]!-(c[a]===sign?high:low))<tolerance*10)));
    if(axial===undefined)throw new RangeError('direct shell macro has no certified source axial frame');
    const sign=CORNERS[vertices.findIndex(p=>p[axis]===high)]![axial]!;
    shells.push({parent,depth:shellDepth,children,references,globalIds,elements,vertices,axial,sign,fineHigh});
  }
  let best:{replacements:TwoToOneReplacement[];minimumSJ:number;exponent:number;faceReport:ReturnType<typeof conserveTransitionFaceFlux>["report"]}|undefined;
  const trials:Array<{exponent:number;minimumCornerSJ:number|null;error?:string}>=[];
  for(const exponent of [.25,.3,.4,.5,.65,.8,1]){
    const replacements=[...fixed];
    for(const shell of shells){
      const refs=shell.references.map(p=>{const r=[...p],w=(r[shell.axial]!*shell.sign+1)/2;
        if(w<0||w>1)throw new Error('direct macro reference point is outside the original parent');
        const mapped=shell.fineHigh?1-(1-w)**exponent:w**exponent;r[shell.axial]=(2*mapped-1)*shell.sign;return r as unknown as ReferencePoint3;
      });
      const nodes=refs.map(ref=>{const weights=shape(ref);return [0,1,2].map(a=>shell.vertices.reduce((s,p,i)=>s+p[a]!*weights[i]!,0));});
      const count=2*4**shell.depth-1;
      replacements.push({elementId:shell.parent,role:'face-transition',templateCode:count,referenceNodes:refs,refinement:{kind:'H1',source:`hierarchical${count}`,nodes,elements:shell.elements}});
    }
    replacements.sort((a,b)=>a.elementId-b.elementId);
    try{
      const corrected=conserveTransitionFaceFlux(source,{strategy:'hierarchical-shell',replacements},maximumFaceFraction);
      let minimumSJ=Infinity;for(const r of corrected.replacements)if(r.role!=='selected')for(const e of r.refinement.elements)minimumSJ=Math.min(minimumSJ,minimumHexCornerScaledJacobian(e.map(n=>r.refinement.nodes[n-1]!)));
      trials.push({exponent,minimumCornerSJ:minimumSJ});
      if(minimumSJ>0&&(!best||minimumSJ>best.minimumSJ))best={replacements:corrected.replacements,minimumSJ,exponent,faceReport:corrected.report};
    }catch(error){trials.push({exponent,minimumCornerSJ:null,error:error instanceof Error?error.message:String(error)});}
  }
  if(!best)throw new RangeError('no positive conservative direct-shell macro mapping exists within the displacement budget');
  const final=buildAuditedHexRefinementOutput(source,best.replacements,tolerance,true,2);
  const stationary=best.exponent===1?0:best.exponent**(1/(1-best.exponent));
  const maximumAxialShiftFraction=best.exponent===1?0:stationary**best.exponent-stationary;
  const replaced=new Set(best.replacements.map(r=>r.elementId)),indices:number[]=[];
  for(let parent=1;parent<=source.elements.length;parent++)if(!replaced.has(parent))indices.push(groups.get(parent)![0]!);
  for(const r of best.replacements)indices.push(...rawChildIndices.get(r.elementId)!);
  if(indices.length!==final.mesh.elements.length)throw new Error('direct macro lineage permutation failed');
  const shellDepths=[...new Set(shells.map(s=>s.depth))].sort((a,b)=>a-b);
  return {mesh:final.mesh,rawChildIndices:indices,report:{mode:'direct-hierarchical-shell' as const,shellParents:shells.length,
    childrenPerShellParent:shellDepths.length===1?2*4**shellDepths[0]!-1:null,
    shellGroups:shellDepths.map(depth=>({depth,parents:shells.filter(s=>s.depth===depth).length,childrenPerParent:2*4**depth-1})),selectedExponent:best.exponent,trials,
    axialStationWarp:{exponent:best.exponent,maximumPossibleFractionOfParentHeight:maximumAxialShiftFraction,originalParentPlanesFixed:true,uniformCoreGridFixed:true},
    sourceParentQuality:final.quality,geometry:best.faceReport,wholeParentPromotions:0,
    limitation:'Separated full-section constant-level1/2/3 bands only; no shared two-sided shell, no arbitrary CinoLib weak-balance edge/vertex schemes.'}};
}
