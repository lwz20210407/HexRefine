import type {Mesh, Point} from "./types.js";
import {H1_FACES} from "./topology.js";
import type {TwoToOneReplacement} from "./two-to-one.js";
import type {ReferencePoint3} from "./two-to-one-templates.js";

const CORNERS: readonly ReferencePoint3[] = [
  [-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],
  [-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]
];
const GAUSS = [(1-1/Math.sqrt(3))/2, (1+1/Math.sqrt(3))/2];
const subtract=(a:readonly number[],b:readonly number[])=>a.map((v,i)=>v-b[i]!);
const dot=(a:readonly number[],b:readonly number[])=>a.reduce((s,v,i)=>s+v*b[i]!,0);
const cross=(a:readonly number[],b:readonly number[])=>[
  a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!
];
const mix=(points:readonly Point[],weights:readonly number[])=>[0,1,2].map(a=>points.reduce((s,p,i)=>s+p[a]!*weights[i]!,0));

/** Oriented volume flux through a bilinear quad, relative to a shared origin. */
export function quadVolumeFlux(quad:readonly Point[],origin:readonly number[]):number {
  const p=quad.map(q=>subtract(q,origin));
  let sum=0;
  for(const u of GAUSS)for(const v of GAUSS){
    const x=mix(p,[(1-u)*(1-v),u*(1-v),u*v,(1-u)*v]);
    const du=mix(p,[-(1-v),1-v,v,-v]),dv=mix(p,[-(1-u),-u,u,1-u]);
    sum+=dot(x,cross(du,dv))/12;
  }
  return sum;
}

interface NodeRef {replacement:number;node:number;}
interface FacePatch {
  corners:number[];
  uv:Map<string,readonly [number,number]>;
  occurrences:Map<string,NodeRef[]>;
  polygons:string[][];
  signature:string;
}

function canonicalFace(ids:readonly number[]):number[]{
  const start=ids.indexOf(Math.min(...ids));
  const forward=Array.from({length:4},(_,i)=>ids[(start+i)%4]!);
  const backward=[forward[0]!,forward[3]!,forward[2]!,forward[1]!];
  return forward[1]!<backward[1]!?forward:backward;
}

function localBoundaryFaces(replacement:TwoToOneReplacement):number[][] {
  const incidence=new Map<string,{face:number[];count:number}>();
  for(const element of replacement.refinement.elements)for(const f of H1_FACES){
    const face=f.map(n=>element[n-1]!-1),key=[...face].sort((a,b)=>a-b).join(':');
    const entry=incidence.get(key)??{face,count:0};entry.count++;
    if(entry.count>2)throw new Error('conservative mapping received a nonmanifold local template');
    incidence.set(key,entry);
  }
  return [...incidence.values()].filter(e=>e.count===1).map(e=>e.face);
}

function collectPatches(mesh:Mesh,replacements:readonly TwoToOneReplacement[]):Map<string,FacePatch> {
  const patches=new Map<string,FacePatch>();
  replacements.forEach((replacement,index)=>{
    if(replacement.role==='selected')return;
    const reference=replacement.referenceNodes;
    if(!reference)throw new RangeError('conservative face mapping requires certified reference coordinates');
    const parent=mesh.elements[replacement.elementId-1]!,boundary=localBoundaryFaces(replacement);
    for(const face of H1_FACES){
      const fixed=[0,1,2].find(a=>face.every(n=>CORNERS[n-1]![a]===CORNERS[face[0]!-1]![a]));
      if(fixed===undefined)throw new Error('invalid source Hex face');
      const side=CORNERS[face[0]!-1]![fixed]!,polys=boundary.filter(f=>f.every(n=>reference[n]![fixed]===side));
      const corners=canonicalFace(face.map(n=>parent[n-1]!)),localCorners=corners.map(n=>parent.indexOf(n));
      const uv=new Map<string,readonly [number,number]>(),occurrences=new Map<string,NodeRef[]>();
      const keyByNode=new Map<number,string>();
      for(const node of new Set(polys.flat())){
        const r=reference[node]!,c0=CORNERS[localCorners[0]!]!,c1=CORNERS[localCorners[1]!]!,c3=CORNERS[localCorners[3]!]!;
        const uAxis=[0,1,2].find(a=>c0[a]!==c1[a])!,vAxis=[0,1,2].find(a=>c0[a]!==c3[a])!;
        const pair=[(r[uAxis]!-c0[uAxis]!)/(c1[uAxis]!-c0[uAxis]!),(r[vAxis]!-c0[vAxis]!)/(c3[vAxis]!-c0[vAxis]!)] as const,key=pair.join(':');
        uv.set(key,pair);keyByNode.set(node,key);occurrences.set(key,[{replacement:index,node}]);
      }
      const polygons=polys.map(poly=>{
        const p=poly.map(n=>keyByNode.get(n)!);
        const area=p.reduce((s,k,i)=>{const a=uv.get(k)!,b=uv.get(p[(i+1)%4]!)!;return s+a[0]*b[1]-a[1]*b[0];},0);
        if(!area)throw new Error('degenerate reference face partition');
        return area>0?p:[p[0]!,p[3]!,p[2]!,p[1]!];
      });
      const signature=polygons.map(p=>[...p].sort().join('|')).sort().join(';'),key=corners.join(':');
      const previous=patches.get(key);
      if(previous){
        if(previous.signature!==signature)throw new Error('conservative mapping found incompatible shared face partitions');
        for(const [k,refs] of occurrences)previous.occurrences.get(k)!.push(...refs);
      }else patches.set(key,{corners,uv,occurrences,polygons,signature});
    }
  });
  return patches;
}

export interface ConservativeFaceMappingReport {
  policy:"conservative-face-flux";
  inspectedFaces:number;
  correctedFaces:number;
  correctedNodeOccurrences:number;
  maximumDisplacement:number;
  maximumDisplacementFraction:number;
  maximumNormalizedFluxResidual:number;
  /** The correction preserves flux, not pointwise equality to the old Q1 surface. */
  exactOriginalBilinearSurfaceRetained:false;
}

/**
 * One canonical correction per shared face. Original corners/edges and uniform
 * core nodes are fixed. The Q1 boundary approximation changes explicitly, while
 * its integral flux equals the source face. This is not a global volume fudge.
 */
export function conserveTransitionFaceFlux(mesh:Mesh,plan:{strategy:string;replacements:readonly TwoToOneReplacement[]},maximumFraction=1e-3){
  if(!Number.isFinite(maximumFraction)||maximumFraction<=0||maximumFraction>.05)throw new RangeError('invalid conservative face displacement budget');
  if(!['seven-hex','hierarchical-shell'].includes(plan.strategy))throw new RangeError('conservative face mapping is restricted to certified seven-Hex/hierarchical fields');
  const patches=collectPatches(mesh,plan.replacements);
  const replacements=plan.replacements.map(r=>r.role==='selected'?r:{...r,refinement:{...r.refinement,nodes:r.refinement.nodes.map(p=>[...p])}});
  const report:ConservativeFaceMappingReport={policy:"conservative-face-flux",inspectedFaces:patches.size,correctedFaces:0,
    correctedNodeOccurrences:0,maximumDisplacement:0,maximumDisplacementFraction:0,maximumNormalizedFluxResidual:0,exactOriginalBilinearSurfaceRetained:false};
  for(const patch of patches.values()){
    // Tensor rectangles are exact restrictions of the parent Q1 surface.
    // In particular, never perturb the uniform core interface for roundoff.
    const tensor=patch.polygons.every(poly=>new Set(poly.map(k=>patch.uv.get(k)![0])).size===2&&new Set(poly.map(k=>patch.uv.get(k)![1])).size===2);
    if(tensor)continue;
    const corners=patch.corners.map(n=>mesh.nodes[n-1]!),origin=corners[0]!;
    const lengths=corners.map((p,i)=>Math.hypot(...subtract(p,corners[(i+1)%4]!))),length=Math.min(...lengths);
    if(!(length>0))throw new RangeError('degenerate source face');
    const points=new Map([...patch.uv].map(([key,[u,v]])=>[key,mix(corners,[(1-u)*(1-v),u*(1-v),u*v,(1-u)*v])]));
    const flux=()=>patch.polygons.reduce((s,p)=>s+quadVolumeFlux(p.map(k=>points.get(k)!),origin),0);
    const target=quadVolumeFlux(corners,origin),initial=flux(),delta=target-initial,scale=length**3;
    if(Math.abs(delta)<=scale*1e-13)continue;
    const a=subtract(corners[1]!,origin),b=subtract(corners[3]!,origin),c=corners[2]!.map((v,i)=>v-corners[1]![i]!-corners[3]![i]!+origin[i]!);
    const area=cross(a,b).map((v,i)=>v+(cross(a,c)[i]!+cross(c,b)[i]!)/2),norm=Math.hypot(...area),normal=area.map(v=>v/norm);
    if(!(norm>0))throw new RangeError('conservative mapping found a degenerate face normal');
    let chosen:string|undefined,derivative=0;
    for(const [key,[u,v]] of [...patch.uv].sort(([a],[b])=>a.localeCompare(b))){
      if(u<=0||u>=1||v<=0||v>=1)continue;
      const p=points.get(key)!;
      points.set(key,p.map((x,i)=>x+length*normal[i]!));const d=(flux()-initial)/length;points.set(key,p);
      if(Math.abs(d)>Math.abs(derivative)){chosen=key;derivative=d;}
    }
    if(chosen===undefined||Math.abs(derivative)<length*length*1e-12)throw new RangeError('face partition has no conservative interior-node freedom');
    const distance=delta/derivative,fraction=Math.abs(distance)/length;
    if(fraction>maximumFraction)throw new RangeError('conservative face mapping exceeds its displacement budget');
    const point=points.get(chosen)!.map((v,i)=>v+distance*normal[i]!);points.set(chosen,point);
    const residual=Math.abs(flux()-target)/scale;
    if(!(residual<1e-12))throw new Error('conservative face flux certificate failed');
    for(const ref of patch.occurrences.get(chosen)!)replacements[ref.replacement]!.refinement.nodes[ref.node]=[...point];
    report.correctedFaces++;report.correctedNodeOccurrences+=patch.occurrences.get(chosen)!.length;
    report.maximumDisplacement=Math.max(report.maximumDisplacement,Math.abs(distance));
    report.maximumDisplacementFraction=Math.max(report.maximumDisplacementFraction,fraction);
    report.maximumNormalizedFluxResidual=Math.max(report.maximumNormalizedFluxResidual,residual);
  }
  return {replacements,report};
}
