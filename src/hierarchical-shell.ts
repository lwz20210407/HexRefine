import type {Mesh} from "./types.js";
import type {TwoToOneReplacement} from "./two-to-one.js";
import type {ReferencePoint3} from "./two-to-one-templates.js";
import {assembleReplacementMesh,mergeCoincidentNodesWithMap} from "./mesh.js";
import {refineHexTo8Hex} from "./templates.js";
import {assertHexPatchQuality,buildAuditedHexRefinementOutput} from "./refinement-errors.js";
import {minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {hexJacobian} from "./hex-quality-internal.js";
import {determinant3Scaled,scaledValueSign} from "./hex-numeric-internal.js";
import {conserveTransitionFaceFlux} from "./transition-face-flux.js";

const CORNERS:readonly ReferencePoint3[]=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const UNIFORM_REFERENCE=refineHexTo8Hex(CORNERS).nodes;
export type ReferenceSupport=Map<number,number>;
const shape=(r:readonly number[])=>CORNERS.map(c=>c.reduce((s,sign,a)=>s*(1+sign*r[a]!)/2,1));

function axialFrame(vertices:readonly (readonly number[])[],axis:0|1|2,tolerance:number){
  const low=Math.min(...vertices.map(p=>p[axis]!)),high=Math.max(...vertices.map(p=>p[axis]!));
  const axial=[0,1,2].find(a=>[1,-1].some(sign=>CORNERS.every((c,i)=>Math.abs(vertices[i]![axis]!-(c[a]===sign?high:low))<tolerance*10)));
  if(axial===undefined)throw new RangeError('direct shell macro has no certified source axial frame');
  return {axial,sign:CORNERS[vertices.findIndex(p=>p[axis]===high)]![axial]!};
}

/** Virtual half-columns only; final output is reassembled against whole source parents. */
export function prepareSharedAxialShells(source:Mesh,axis:0|1|2,layerByParent:ReadonlyMap<number,number>,targets:readonly number[],tolerance:number,outputLimit:number){
  const replacements:TwoToOneReplacement[]=[];
  for(let parent=1;parent<=source.elements.length;parent++){
    const layer=layerByParent.get(parent)!;
    if(targets[layer]||!(targets[layer-1]&&targets[layer+1]))continue;
    const vertices=source.elements[parent-1]!.map(n=>source.nodes[n-1]!),{axial}=axialFrame(vertices,axis,tolerance);
    // Two positive local-coordinate slabs, irrespective of physical axial sign.
    const refs:ReferencePoint3[]=[],elements:number[][]=[];
    const ids=new Map<string,number>();
    for(const [lo,hi] of [[-1,0],[0,1]]){
      const e=CORNERS.map(c=>{const r=[...c];r[axial]=c[axial]===-1?lo!:hi!;const key=r.join(':');let id=ids.get(key);
        if(id===undefined){id=refs.length+1;ids.set(key,id);refs.push(r as unknown as ReferencePoint3);}return id;});elements.push(e);
    }
    replacements.push({elementId:parent,role:'face-transition',templateCode:2,referenceNodes:refs,
      refinement:{kind:'H1',source:'virtual-axial-halves',nodes:refs.map(r=>{const w=shape(r);return [0,1,2].map(a=>vertices.reduce((s,p,i)=>s+p[a]!*w[i]!,0));}),elements}});
  }
  if(source.elements.length+replacements.length>outputLimit)throw new RangeError('shared-shell preparation exceeds maxOutputElements before assembly');
  const supports=source.nodes.map((_,i)=>new Map([[i+1,1]]));
  if(!replacements.length)return {mesh:source,supports,parentIds:source.elements.map((_,i)=>i+1),splitParents:[] as number[]};
  const result=assembleReferenceStage(source,replacements,supports,tolerance),split=new Set(replacements.map(r=>r.elementId));
  const parentIds=source.elements.flatMap((_,i)=>split.has(i+1)?[]:[i+1]);
  replacements.forEach(r=>parentIds.push(r.elementId,r.elementId));
  return {mesh:result.mesh,supports:result.supports,parentIds,splitParents:replacements.map(r=>r.elementId)};
}

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
  const fixed:TwoToOneReplacement[]=[],shells:Array<{parent:number;depth:number;lowDepth:number;highDepth:number;children:number[];references:number[][];globalIds:number[];elements:number[][];vertices:readonly (readonly number[])[];axial:number;sign:number;fineHigh:boolean;twoSided:boolean}>=[];
  const rawChildIndices=new Map<number,number[]>();
  for(let parent=1;parent<=source.elements.length;parent++){
    const children=groups.get(parent)!;if(children.length===1)continue;
    const layer=layerByParent.get(parent)!,coreDepth=targets[layer]!,isCore=coreDepth>0;
    const highDepth=targets[layer+1]??0,lowDepth=targets[layer-1]??0,fineHigh=highDepth>0,fineLow=lowDepth>0,twoSided=fineHigh&&fineLow;
    const shellDepth=Math.max(highDepth,lowDepth),shellCount=(lowDepth?2*4**lowDepth-1:0)+(highDepth?2*4**highDepth-1:0);
    const expected=isCore?8**coreDepth:shellCount;
    if(!isCore&&(!shellDepth||shellDepth>3))throw new RangeError('direct macro has no supported fine source interface');
    if(children.length!==expected)throw new RangeError('direct shell does not match its complete tensor-core/hierarchical-shell topology');
    const original=source.elements[parent-1]!,vertices=original.map(n=>source.nodes[n-1]!),globalIds=[...new Set(children.flatMap(i=>[...current.elements[i]!]))];
    const localIds=new Map(globalIds.map((n,i)=>[n,i+1])),elements=children.map(i=>current.elements[i]!.map(n=>localIds.get(n)!));
    const references=globalIds.map(n=>{
      const ref=[0,0,0];for(const [id,w] of supports[n-1]!){if(Math.abs(w)<1e-14)continue;const corner=original.indexOf(id);if(corner<0)throw new Error('macro node support escapes its original parent');for(let a=0;a<3;a++)ref[a]!+=CORNERS[corner]![a]!*w;}
      return ref;
    });
    rawChildIndices.set(parent,children);
    if(isCore){fixed.push({elementId:parent,role:'selected',templateCode:expected,referenceNodes:references as unknown as ReferencePoint3[],refinement:{kind:'H1',source:`uniform${expected}`,nodes:globalIds.map(n=>current.nodes[n-1]!),elements}});continue;}
    const {axial,sign}=axialFrame(vertices,axis,tolerance);
    shells.push({parent,depth:shellDepth,lowDepth,highDepth,children,references,globalIds,elements,vertices,axial,sign,fineHigh,twoSided});
  }
  const splitFraction=(shell:{lowDepth:number;highDepth:number},bias:number)=>.5+bias*Math.sign(shell.lowDepth-shell.highDepth);
  let best:{replacements:TwoToOneReplacement[];minimumSJ:number;exponent:number;interfaceBias:number;faceReport:ReturnType<typeof conserveTransitionFaceFlux>["report"]}|undefined;
  const trials:Array<{exponent:number;interfaceBias:number;minimumCornerSJ:number|null;positiveGaussSamples?:boolean;error?:string}>=[];
  const biases=shells.some(s=>s.twoSided&&s.lowDepth!==s.highDepth)?[0,.125,.25]:[0];
  for(const interfaceBias of biases)for(const exponent of [.25,.3,.4,.5,.65,.8,1]){
    const replacements=[...fixed];
    for(const shell of shells){
      const refs=shell.references.map(p=>{const r=[...p],w=(r[shell.axial]!*shell.sign+1)/2;
        if(w<0||w>1)throw new Error('direct macro reference point is outside the original parent');
        const split=splitFraction(shell,interfaceBias);
        const mapped=shell.twoSided?(w<=.5?split*(2*w)**exponent:1-(1-split)*(2*(1-w))**exponent):(shell.fineHigh?1-(1-w)**exponent:w**exponent);
        r[shell.axial]=(2*mapped-1)*shell.sign;return r as unknown as ReferencePoint3;
      });
      const nodes=refs.map(ref=>{const weights=shape(ref);return [0,1,2].map(a=>shell.vertices.reduce((s,p,i)=>s+p[a]!*weights[i]!,0));});
      const count=shell.children.length;
      replacements.push({elementId:shell.parent,role:'face-transition',templateCode:count,referenceNodes:refs,refinement:{kind:'H1',source:`hierarchical${count}`,nodes,elements:shell.elements}});
    }
    replacements.sort((a,b)=>a.elementId-b.elementId);
    try{
      const corrected=conserveTransitionFaceFlux(source,{strategy:'hierarchical-shell',replacements},maximumFaceFraction);
      let minimumSJ=Infinity,positiveGaussSamples=true;
      for(const r of corrected.replacements)if(r.role!=='selected')for(const e of r.refinement.elements){
        const vertices=e.map(n=>r.refinement.nodes[n-1]!);
        minimumSJ=Math.min(minimumSJ,minimumHexCornerScaledJacobian(vertices));
        for(const u of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const v of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const w of [-1/Math.sqrt(3),1/Math.sqrt(3)])
          if(scaledValueSign(determinant3Scaled(hexJacobian(vertices,u,v,w)))<=0)positiveGaussSamples=false;
      }
      trials.push({exponent,interfaceBias,minimumCornerSJ:minimumSJ,positiveGaussSamples});
      if(minimumSJ>0&&positiveGaussSamples&&(!best||minimumSJ>best.minimumSJ))best={replacements:corrected.replacements,minimumSJ,exponent,interfaceBias,faceReport:corrected.report};
    }catch(error){trials.push({exponent,interfaceBias,minimumCornerSJ:null,error:error instanceof Error?error.message:String(error)});}
  }
  if(!best)throw new RangeError('no positive conservative direct-shell macro mapping exists within the displacement budget');
  const final=buildAuditedHexRefinementOutput(source,best.replacements,tolerance,true,2);
  const stationary=best.exponent===1?0:best.exponent**(1/(1-best.exponent));
  const oneSideShift=best.exponent===1?0:stationary**best.exponent-stationary;
  const halfShift=(fraction:number)=>{
    if(best!.exponent===1)return Math.abs(fraction-.5);
    const q=(2*fraction*best!.exponent)**(1/(1-best!.exponent));
    return Math.max(Math.abs(fraction-.5),q<=1?Math.abs(fraction*q**best!.exponent-.5*q):0);
  };
  const maximumAxialShiftFraction=shells.reduce((maximum,s)=>{const split=splitFraction(s,best!.interfaceBias);return Math.max(maximum,s.twoSided?Math.max(halfShift(split),halfShift(1-split)):oneSideShift);},0);
  const replaced=new Set(best.replacements.map(r=>r.elementId)),indices:number[]=[];
  for(let parent=1;parent<=source.elements.length;parent++)if(!replaced.has(parent))indices.push(groups.get(parent)![0]!);
  for(const r of best.replacements)indices.push(...rawChildIndices.get(r.elementId)!);
  if(indices.length!==final.mesh.elements.length)throw new Error('direct macro lineage permutation failed');
  const oneSided=shells.filter(s=>!s.twoSided),twoSided=shells.filter(s=>s.twoSided);
  const shellDepths=[...new Set(oneSided.map(s=>s.depth))].sort((a,b)=>a-b),counts=[...new Set(shells.map(s=>s.children.length))];
  const pairKeys=[...new Set(twoSided.map(s=>`${s.lowDepth}:${s.highDepth}`))].sort();
  return {mesh:final.mesh,rawChildIndices:indices,report:{mode:'direct-hierarchical-shell' as const,shellParents:shells.length,
    childrenPerShellParent:counts.length===1?counts[0]!:null,
    shellGroups:shellDepths.map(depth=>({depth,parents:oneSided.filter(s=>s.depth===depth).length,childrenPerParent:2*4**depth-1})),
    twoSidedShellParents:twoSided.length,twoSidedShellGroups:pairKeys.map(key=>{const pair=twoSided.filter(s=>`${s.lowDepth}:${s.highDepth}`===key);return {lowDepth:pair[0]!.lowDepth,highDepth:pair[0]!.highDepth,parents:pair.length,childrenPerParent:pair[0]!.children.length,coarseInterfaceFractionOfParentHeight:splitFraction(pair[0]!,best!.interfaceBias)};}),selectedExponent:best.exponent,selectedInterfaceBias:best.interfaceBias,trials,
    axialStationWarp:{exponent:best.exponent,maximumPossibleFractionOfParentHeight:maximumAxialShiftFraction,originalParentPlanesFixed:true,uniformCoreGridFixed:true,virtualMidplanesRetained:twoSided.every(s=>splitFraction(s,best!.interfaceBias)===.5)},
    sourceParentQuality:final.quality,geometry:best.faceReport,wholeParentPromotions:0,
    limitation:'Full-section constant-level1/2/3 bands and axial two-sided shells only; no adjacent different positive levels or arbitrary CinoLib weak-balance edge/vertex schemes.'}};
}
