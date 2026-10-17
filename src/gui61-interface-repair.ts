import type {LocalRefinement, Mesh, Point, ReadonlyMesh} from "./types.js";
import {checkNoHangingNodes} from "./conformance.js";
import {H1_FACES} from "./topology.js";
import {refineHexTo5Hex} from "./templates.js";
import {auditHexRefinementQuality, hexElementSignedVolume, minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {hexJacobian} from "./hex-quality-internal.js";
import {minElementEdgeLength} from "./mesh.js";

export interface Gui61InterfaceRepairOptions {
  /** Dense, one-based mesh element IDs. Selection is explicit and never expands. */
  parentElementIds: readonly number[];
  /** Absolute coordinate tolerance, also used by the final conformance audit. */
  tolerance: number;
  /** Optional material/part isolation. Cross-part interface repair is rejected. */
  partIds?: readonly number[];
}

export interface Gui61InterfaceRepairResult {
  mesh: Mesh;
  /** For every output element, its original one-based parent element ID. */
  parentElementIds: number[];
  repairedParentIds: number[];
  addedNodeIds: number[];
  quality: {minimumCornerScaledJacobian: number; minimumGaussJacobian: number; maximumParentVolumeError: number};
}

const CUBE = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const reference = refineHexTo5Hex(CUBE);
const key = (ids: readonly number[]) => [...ids].sort((a,b)=>a-b).join(":");
const distance = (a: Point,b: Point) => Math.hypot(...a.map((v,i)=>v-b[i]!));
const reverse = (e: readonly number[]) => [e[1]!,e[0]!,e[3]!,e[2]!,e[5]!,e[4]!,e[7]!,e[6]!];

function frames(): number[][] {
  const result: number[][] = [];
  for (const a of [0,1,2]) for (const b of [0,1,2].filter(i=>i!==a)) {
    const axes = [a,b,3-a-b];
    for (let mask=0;mask<8;mask++) result.push(CUBE.map(p=>CUBE.findIndex(q=>
      q.every((v,i)=>v===((mask>>i)&1 ? 1-p[axes[i]!]! : p[axes[i]!]!)))));
  }
  return result;
}
const FRAMES = frames();

function boundaryFaces(elements: readonly (readonly number[])[]): number[][] {
  const all = new Map<string,number[][]>();
  for (const e of elements) for (const face of H1_FACES) {
    const ids=face.map(i=>e[i-1]!); const k=key(ids), entries=all.get(k)??[];
    entries.push(ids); all.set(k,entries);
    if(entries.length>2) throw new Error("non-manifold face: more than two owners");
  }
  return [...all.values()].filter(a=>a.length===1).map(a=>a[0]!);
}
const referenceBoundary = boundaryFaces(reference.elements);
const referenceWalls = H1_FACES.map(face=>{
  const axis=[0,1,2].find(a=>face.every(i=>CUBE[i-1]![a]===CUBE[face[0]!-1]![a]))!;
  const side=CUBE[face[0]!-1]![axis]!;
  return referenceBoundary.filter(f=>f.every(i=>Math.abs(reference.nodes[i-1]![axis]!-side)<1e-12));
});

function determinant(m: number[][]): number {
  const [a,b,c]=m as [number[],number[],number[]];
  return a[0]!*(b[1]!*c[2]!-b[2]!*c[1]!)-a[1]!*(b[0]!*c[2]!-b[2]!*c[0]!)+a[2]!*(b[0]!*c[1]!-b[1]!*c[0]!);
}
function quality(mesh: ReadonlyMesh) {
  let minimumCornerScaledJacobian=Infinity, minimumGaussJacobian=Infinity;
  for(const e of mesh.elements){
    const vertices=e.map(n=>mesh.nodes[n-1]!);
    minimumCornerScaledJacobian=Math.min(minimumCornerScaledJacobian,minimumHexCornerScaledJacobian(vertices));
    for(const x of [-1/Math.sqrt(3),1/Math.sqrt(3)])
      for(const y of [-1/Math.sqrt(3),1/Math.sqrt(3)])
        for(const z of [-1/Math.sqrt(3),1/Math.sqrt(3)])
          minimumGaussJacobian=Math.min(minimumGaussJacobian,determinant(hexJacobian(vertices,x,y,z)));
  }
  if(!Number.isFinite(minimumCornerScaledJacobian)||!Number.isFinite(minimumGaussJacobian)
      ||minimumCornerScaledJacobian<=0||minimumGaussJacobian<=0)
    throw new Error("repair requires positive corner and Gauss Jacobians");
  return {minimumCornerScaledJacobian,minimumGaussJacobian};
}
function validate(mesh: ReadonlyMesh): void {
  if(mesh.kind!=="H1"||!mesh.elements.length||mesh.nodes.some(p=>p.length!==3||p.some(v=>!Number.isFinite(v))))
    throw new Error("repair requires a nonempty finite H1 mesh");
  const seen=new Set<string>();
  for(const e of mesh.elements){
    if(e.length!==8||new Set(e).size!==8||e.some(n=>!Number.isSafeInteger(n)||n<1||n>mesh.nodes.length))
      throw new Error("invalid eight-node solid connectivity");
    if(seen.has(key(e)))throw new Error("duplicate solid element");
    seen.add(key(e));
  }
  boundaryFaces(mesh.elements);
  quality(mesh);
}

interface Candidate {refinement: LocalRefinement; ids: number[]; supports: string[]}

/** Bounded v16-like repair using the existing 5-Hex template, not a general mesher.
 * Existing IDs/coordinates are immutable; only interface nodes proved by the
 * selected face partitions may be reused. No global coordinate merge is used.
 */
export function repairGui61FiveHexInterfaces(mesh: ReadonlyMesh, options: Gui61InterfaceRepairOptions): Gui61InterfaceRepairResult {
  if(!options||!Number.isFinite(options.tolerance)||options.tolerance<=0)
    throw new RangeError("positive explicit repair tolerance is required");
  if(!Array.isArray(options.parentElementIds)||!options.parentElementIds.length
      ||new Set(options.parentElementIds).size!==options.parentElementIds.length
      ||options.parentElementIds.some(i=>!Number.isSafeInteger(i)||i<1||i>mesh.elements.length))
    throw new RangeError("unique in-range repair parent IDs are required");
  if(options.partIds&&(options.partIds.length!==mesh.elements.length||options.partIds.some(p=>!Number.isSafeInteger(p)||p<=0)))
    throw new RangeError("partIds must provide a positive part ID per element");
  validate(mesh);
  if(options.tolerance>minElementEdgeLength(mesh)*1e-3)
    throw new RangeError("repair tolerance exceeds 0.001 of the shortest mesh edge");
  const selected=new Set(options.parentElementIds), tolerance=options.tolerance;
  const requirements=new Map<number,Map<string,Set<string>>>();
  const allowedNodes=new Map<number,Set<number>>();
  for(const id of selected){requirements.set(id,new Map());allowedNodes.set(id,new Set(mesh.elements[id-1]!));}
  const inputReport=checkNoHangingNodes(mesh,tolerance);
  for(const issue of inputReport.hanging){
    if(issue.kind!=="overlapping-face")continue;
    const sides=[{id:issue.ownerElementId,face:issue.boundary,otherId:issue.otherElementId,other:issue.otherBoundary},
      {id:issue.otherElementId,face:issue.otherBoundary,otherId:issue.ownerElementId,other:issue.boundary}];
    for(const s of sides){
      if(!selected.has(s.id))continue;
      if(selected.has(s.otherId))throw new Error("adjacent damaged parents require a joint repair, unsupported by this bounded path");
      if(options.partIds&&options.partIds[s.id-1]!==options.partIds[s.otherId-1])throw new Error("cross-part repair is forbidden");
      const faces=requirements.get(s.id)!, k=key(s.face), targets=faces.get(k)??new Set<string>();
      targets.add(key(s.other));faces.set(k,targets);
      s.other.forEach(n=>allowedNodes.get(s.id)!.add(n));
    }
  }
  const chosen=new Map<number,Candidate>();
  for(const id of [...selected].sort((a,b)=>a-b)){
    const req=requirements.get(id)!;
    if(req.size!==2)throw new Error(`parent ${id}: expected exactly two subdivided interface faces`);
    const candidates=new Map<string,Candidate>();
    for(const frame of FRAMES){
      const corners=frame.map(i=>mesh.elements[id-1]![i]!);
      const refinement=refineHexTo5Hex(corners.map(n=>mesh.nodes[n-1]!));
      if(hexElementSignedVolume(refinement.elements[0]!.map(n=>refinement.nodes[n-1]!))<0)
        refinement.elements=refinement.elements.map(reverse);
      const ids=refinement.nodes.map((p,i)=>{
        if(i<8)return corners[i]!;
        const matches=[...allowedNodes.get(id)!].filter(n=>distance(mesh.nodes[n-1]!,p)<=tolerance);
        if(matches.length>1)throw new Error(`parent ${id}: ambiguous interface node match; reduce tolerance or fix duplicate IDs`);
        return matches[0]??0;
      });
      const partitions=new Map(H1_FACES.map((face,i)=>[key(face.map(n=>corners[n-1]!)),
        referenceWalls[i]!.map(f=>key(f.map(n=>ids[n-1]!))).sort().join("|")]));
      if(![...req].every(([face,target])=>[...target].sort().join("|")===partitions.get(face)))continue;
      const supports=reference.nodes.map(p=>corners.map((n,i)=>{
        const weight=CUBE[i]!.reduce((v,c,a)=>v*(c?p[a]!:1-p[a]!),1);
        return [n,Math.round(weight*1e12)];
      }).filter(([,w])=>w!==0).sort((a,b)=>a[0]!-b[0]!).map(([n,w])=>`${n}:${w}`).join(";"));
      const signature=refinement.elements.map(e=>e.map(n=>ids[n-1]?`n${ids[n-1]}`:`s${supports[n-1]}`).sort().join("/")).sort().join("|");
      candidates.set(signature,{refinement,ids,supports});
    }
    if(candidates.size!==1)throw new Error(`parent ${id}: ${candidates.size} distinct compatible 5-Hex repairs; exactly one required`);
    chosen.set(id,[...candidates.values()][0]!);
  }
  const nodes=mesh.nodes.map(p=>[...p]), elements:number[][]=[], parentElementIds:number[]=[];
  const newBySupport=new Map<string,number>();
  let maximumParentVolumeError=0;
  for(const [index,element] of mesh.elements.entries()){
    const candidate=chosen.get(index+1);
    if(!candidate){elements.push([...element]);parentElementIds.push(index+1);continue;}
    const ids=candidate.ids.map((n,i)=>{
      if(n)return n;
      const support=candidate.supports[i]!, existing=newBySupport.get(support);
      if(existing)return existing;
      nodes.push([...candidate.refinement.nodes[i]!]);newBySupport.set(support,nodes.length);return nodes.length;
    });
    const actual:LocalRefinement={...candidate.refinement,nodes:ids.map(n=>nodes[n-1]!)};
    const audit=auditHexRefinementQuality(element.map(n=>mesh.nodes[n-1]!),actual);
    if(!audit.ok)throw new Error(`parent ${index+1}: snapped template failed quality or volume conservation`);
    maximumParentVolumeError=Math.max(maximumParentVolumeError,audit.relativeVolumeError);
    elements.push(...candidate.refinement.elements.map(e=>e.map(n=>ids[n-1]!)));
    parentElementIds.push(...candidate.refinement.elements.map(()=>index+1));
  }
  const output:Mesh={kind:"H1",nodes,elements};
  validate(output);
  if(!checkNoHangingNodes(output,tolerance).ok)throw new Error("repair rejected: unresolved hanging interface remains; input unchanged");
  return {mesh:output,parentElementIds,repairedParentIds:[...chosen.keys()],
    addedNodeIds:nodes.slice(mesh.nodes.length).map((_,i)=>mesh.nodes.length+i+1),
    quality:{...quality(output),maximumParentVolumeError}};
}
