import type {Mesh,Point} from "./types.js";
import {hexElementSignedVolume,minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {hexJacobian} from "./hex-quality-internal.js";
import {determinant3Scaled,materializeScaledValue} from "./hex-numeric-internal.js";
import {checkNoHangingNodes} from "./conformance.js";
import {minElementEdgeLength} from "./mesh.js";

export interface SolidTransitionRegularRegion {width:number;layers:number}
export interface SolidTransitionRegularRegions {
  fine?:SolidTransitionRegularRegion;
  coarse?:SolidTransitionRegularRegion;
}
interface SolidBand {
  mesh:Mesh;stageIds:number[];nodeSets:Record<string,number[]>;
  quality:{warnings:readonly string[]};plan:object;
}
const FACES=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[1,2,6,5],[0,4,7,3]];
const key=(ids:readonly number[])=>[...ids].sort((a,b)=>a-b).join(":");
const cross=(a:readonly number[],b:readonly number[])=>[a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!];

function faceOwners(mesh:Mesh) {
  const faces=new Map<string,{ids:number[];count:number}>();
  for(const e of mesh.elements)for(const f of FACES){
    const ids=f.map(i=>e[i]!),k=key(ids),entry=faces.get(k)??{ids,count:0};
    if(++entry.count>2)throw new Error("nonmanifold solid transition interface");faces.set(k,entry);
  }
  return faces;
}

export function auditSolidTransitionReadback(mesh:Mesh,expectedVolume:number) {
  let volume=0,minimumCornerScaledJacobian=Infinity,minimumGaussDeterminant=Infinity;
  const g=[-1/Math.sqrt(3),1/Math.sqrt(3)];
  for(const cell of mesh.elements){
    const points=cell.map(id=>mesh.nodes[id-1]!);
    volume+=hexElementSignedVolume(points);
    minimumCornerScaledJacobian=Math.min(minimumCornerScaledJacobian,minimumHexCornerScaledJacobian(points));
    for(const u of g)for(const v of g)for(const w of g)minimumGaussDeterminant=Math.min(minimumGaussDeterminant,
      materializeScaledValue(determinant3Scaled(hexJacobian(points,u,v,w))));
  }
  const relativeVolumeError=Math.abs(volume-expectedVolume)/expectedVolume;
  if(!(minimumCornerScaledJacobian>0&&minimumGaussDeterminant>0&&Number.isFinite(volume)&&volume>0&&relativeVolumeError<1e-8))
    throw new Error("formatted solid transition readback failed Jacobian or volume verification");
  return {volume,relativeVolumeError,minimumCornerScaledJacobian,minimumGaussDeterminant};
}

/** Independently generated regular regions, not a replacement/merge operation on an imported model. */
export function extendSolidTransitionRegions<T extends SolidBand>(base:T,mode:"planar"|"annular"|"axial",
    parameters:Record<string,unknown>,spec:SolidTransitionRegularRegions) {
  if(!spec||typeof spec!=="object"||Array.isArray(spec)||Object.keys(spec).some(k=>k!=="fine"&&k!=="coarse")||!Object.keys(spec).length)
    throw new RangeError("regularRegions needs fine and/or coarse solid region specifications");
  if(base.mesh.kind!=="H1")throw new RangeError("regularRegions requires a solid H8 transition mesh");
  for(const region of Object.values(spec)){
    if(!region||typeof region!=="object"||Array.isArray(region)||Object.keys(region).some(k=>k!=="width"&&k!=="layers")
        ||typeof region.width!=="number"||!Number.isFinite(region.width)||region.width<=0
        ||!Number.isSafeInteger(region.layers)||region.layers<1||region.layers>1000)
      throw new RangeError("regular region width must be positive and layers an integer in [1,1000]");
  }
  const nodes=base.mesh.nodes.map(p=>[...p]),elements=base.mesh.elements.map(e=>[...e]),stageIds=[...base.stageIds];
  const nodeSets=Object.fromEntries(Object.entries(base.nodeSets).map(([name,ids])=>[name,[...ids]]));
  const elementRegions=base.stageIds.map(stage=>stage===0?"core":`stage_${stage}`);
  const originalFaces=faceOwners(base.mesh),expectedBoundary=new Set([...originalFaces].filter(([,f])=>f.count===1).map(([k])=>k));
  const baseElements=elements.length,baseNodes=nodes.length;
  const sourceFaces=new Map<string,number[][]>();
  let predicted=baseElements,predictedNodes=baseNodes;
  for(const side of ["fine","coarse"] as const){
    if(!spec[side])continue;
    const set=new Set(base.nodeSets[side]),faces=[...originalFaces.values()].filter(f=>f.count===1&&f.ids.every(id=>set.has(id))).map(f=>f.ids);
    if(!faces.length)throw new Error(`no complete ${side} boundary faces available for the regular region`);
    sourceFaces.set(side,faces);predicted+=faces.length*spec[side]!.layers;
    predictedNodes+=new Set(faces.flat()).size*spec[side]!.layers;
  }
  if(predicted>1000000||predictedNodes>2000000)throw new RangeError("solid regular regions exceed mesh allocation limits");
  const move=(p:Point,side:"fine"|"coarse",distance:number):number[]=>{
    const sign=side==="fine"?-1:1;
    if(mode==="planar"){
      const a=Number(parameters.rotationDegrees??0)*Math.PI/180,s=(parameters.fineSide??"bottom")==="bottom"?sign:-sign;
      return [p[0]!-s*distance*Math.sin(a),p[1]!+s*distance*Math.cos(a),p[2]!];
    }
    if(mode==="annular"){
      const center=(parameters.center??[0,0]) as number[],dx=p[0]!-center[0]!,dy=p[1]!-center[1]!,radius=Math.hypot(dx,dy);
      const s=(parameters.fineSide??"inner")==="inner"?sign:-sign,next=radius+s*distance;
      if(!(next>0))throw new RangeError("regular radial region reaches or crosses the cylinder axis");
      return [center[0]!+dx*next/radius,center[1]!+dy*next/radius,p[2]!];
    }
    const axis=(base.plan as {axis:number[]}).axis,s=(parameters.fineEnd??"start")==="start"?sign:-sign;
    return p.map((v,a)=>v+s*distance*axis[a]!);
  };
  for(const side of ["fine","coarse"] as const){
    const region=spec[side];if(!region)continue;
    let faces=sourceFaces.get(side)!;
    for(const face of faces){if(!expectedBoundary.delete(key(face)))throw new Error("overlapping solid attachment faces");}
    const originalIds=[...new Set(faces.flat())],current=new Map(originalIds.map(id=>[id,id]));
    const logicalFaces=faces.map(f=>[...f]);
    const perimeter=new Map<string,{ids:number[];count:number}>();
    for(const face of logicalFaces)for(let i=0;i<4;i++){
      const ids=[face[i]!,face[(i+1)%4]!],k=key(ids),entry=perimeter.get(k)??{ids,count:0};entry.count++;perimeter.set(k,entry);
    }
    for(let layer=1;layer<=region.layers;layer++){
      const next=new Map<number,number>();
      for(const original of originalIds){
        const p=move(base.mesh.nodes[original-1]!,side,region.width*layer/region.layers);
        if(p.some(v=>!Number.isFinite(v))||Math.hypot(...p.map((v,a)=>v-nodes[current.get(original)!-1]![a]!))===0)
          throw new RangeError("regular region layer is not numerically resolvable");
        nodes.push(p);next.set(original,nodes.length);
      }
      for(const face of logicalFaces){
        elements.push([...face.map(id=>current.get(id)!),...face.map(id=>next.get(id)!)]);
        stageIds.push(0);elementRegions.push(`${side}-regular`);
      }
      for(const {ids,count} of perimeter.values()){
        if(count>2)throw new Error("nonmanifold attachment perimeter");
        if(count===1)expectedBoundary.add(key([current.get(ids[0]!)!,current.get(ids[1]!)!,next.get(ids[1]!)!,next.get(ids[0]!)!]));
      }
      current.clear();for(const [id,newId] of next)current.set(id,newId);
    }
    faces=logicalFaces.map(f=>f.map(id=>current.get(id)!));
    for(const face of faces)expectedBoundary.add(key(face));
    nodeSets[`${side}_interface`]=[...base.nodeSets[side]!];
    nodeSets[`${side}_external`]=[...current.values()];
  }
  const mesh:Mesh={kind:"H1",nodes,elements},owners=faceOwners(mesh),boundary=[...owners].filter(([,f])=>f.count===1);
  if(boundary.length!==expectedBoundary.size||boundary.some(([k])=>!expectedBoundary.has(k)))throw new Error("unexpected internal free face after regular-region attachment");
  if(new Set(elements.map(key)).size!==elements.length)throw new Error("duplicate regular-region hexes");
  let volume=0,minSJ=Infinity,minGauss=Infinity,regularMinimumSJ=Infinity,boundaryVolume=0;
  const g=[-1/Math.sqrt(3),1/Math.sqrt(3)],signs=[[-1,-1],[1,-1],[1,1],[-1,1]],origin=nodes[0]!;
  for(const [i,e] of elements.entries()){
    const points=e.map(id=>nodes[id-1]!),sj=minimumHexCornerScaledJacobian(points);
    minSJ=Math.min(minSJ,sj);if(i>=baseElements)regularMinimumSJ=Math.min(regularMinimumSJ,sj);
    volume+=hexElementSignedVolume(points);
    for(const u of g)for(const v of g)for(const w of g)minGauss=Math.min(minGauss,materializeScaledValue(determinant3Scaled(hexJacobian(points,u,v,w))));
  }
  for(const [,face] of boundary){
    const p=face.ids.map(id=>nodes[id-1]!.map((v,a)=>v-origin[a]!));
    for(const u of g)for(const v of g){
      const x=[0,0,0],du=[0,0,0],dv=[0,0,0];
      for(let i=0;i<4;i++)for(let a=0;a<3;a++){
        const s=signs[i]!,value=p[i]![a]!;
        x[a]!+=value*(1+s[0]!*u)*(1+s[1]!*v)/4;
        du[a]!+=value*s[0]!*(1+s[1]!*v)/4;dv[a]!+=value*s[1]!*(1+s[0]!*u)/4;
      }
      const normal=cross(du,dv);boundaryVolume+=x.reduce((sum,value,a)=>sum+value*normal[a]!,0)/3;
    }
  }
  const relativeVolumeError=Math.abs(volume-boundaryVolume)/volume;
  if(!(volume>0&&Number.isFinite(volume)&&minSJ>0&&minGauss>0&&relativeVolumeError<1e-8)
      ||!checkNoHangingNodes(mesh,minElementEdgeLength(mesh)*1e-8).ok)throw new Error("solid regular-region quality or conformance audit failed");
  return {...base,mesh,stageIds,nodeSets,elementRegions,plan:{...base.plan,regularRegions:structuredClone(spec),
    transitionNodesPreserved:baseNodes,transitionElementsPreserved:baseElements,existingModelReplacement:false},
    quality:{volume,discreteBoundaryVolume:boundaryVolume,relativeVolumeError,minimumCornerScaledJacobian:minSJ,minimumGaussDeterminant:minGauss,
      regularMinimumCornerScaledJacobian:regularMinimumSJ,warnings:[...base.quality.warnings],boundaryFaces:boundary.length}};
}
