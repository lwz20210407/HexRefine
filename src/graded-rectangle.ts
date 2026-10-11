import type { Mesh } from "./types.js";
import { planRectangularGrading, type RectangularGradingPlan, type RectangularGradingSpec } from "./graded-rectangle-plan.js";
import { createHexUnitCubeMesh } from "./grid.js";
import { applyWithLineage, directionalThirdPass } from "./directional-third-internal.js";
import { tryBuildDirectionalTwoToOneHexReplacements } from "./two-to-one-sweep.js";
import { checkNoHangingNodes } from "./conformance.js";
import { mergeCoincidentNodes, minElementEdgeLength } from "./mesh.js";
import { hexElementSignedVolume, minimumHexCornerScaledJacobian } from "./hex-quality.js";
import { hexJacobian } from "./hex-quality-internal.js";
import { H1_FACES } from "./topology.js";

export interface GradedRectangleResult {
  mesh: Mesh;
  plan: RectangularGradingPlan;
  parentElementIds: number[];
  coreParentIds: number[];
  baseMesh: Mesh;
  quality: {
    minimumCornerScaledJacobian: number;
    minimumGaussDeterminant: number;
    volume: number;
    relativeVolumeError: number;
    externalFaces: number;
    unchangedParents: number;
    expectedCoreChildren: number;
    warnings: string[];
  };
}

/** Generate one connected rectangular solid, not a replacement for arbitrary-mesh refinement. */
export function generateRectangularGradedMesh(spec: RectangularGradingSpec): GradedRectangleResult {
  const plan = planRectangularGrading(spec);
  if (plan.issues.length) throw new RangeError(plan.issues.map(i => i.message).join("; "));
  const [rx,ry,rz] = plan.effectiveReductions;
  const [nx,ny,nz] = plan.fineCounts;
  const [cx,cy] = plan.outerCounts;
  const [length,width,height] = plan.spec.fullSize;
  const [fineLength,fineWidth] = plan.spec.refinedSize;
  const stages=spec.transitionStages;
  const b1=plan.blocks.find(b=>b.name==="B1"),c1=plan.blocks.find(b=>b.name==="C1");
  const innerX=stages===2 ? c1!.max[0]:fineLength/2;
  const innerY=stages===2 ? b1!.max[1]:fineWidth/2;
  const xSegments: [number,number][] = stages===1 ? [[fineLength/2,nx/rx],[length/2,cx]]
    : [[fineLength/2,nx/rx**2],[innerX,c1!.counts[0]/rx],[length/2,plan.blocks.find(b=>b.name==="C2")!.counts[0]]];
  const ySegments: [number,number][] = stages===1 ? [[fineWidth/2,ny/ry],[width/2,cy]]
    : [[fineWidth/2,ny/ry**2],[innerY,b1!.counts[1]/ry],[width/2,plan.blocks.find(b=>b.name==="B2")!.counts[1]]];
  const baseCount=xSegments.reduce((s,v)=>s+v[1],0)*(spec.modelFraction!=="quarter" ? 2:1)
    *ySegments.reduce((s,v)=>s+v[1],0)*(spec.modelFraction==="full" ? 2:1)*(nz/rz**stages);
  if (!Number.isSafeInteger(baseCount) || baseCount * (rx*ry*rz)**stages > 2000000) {
    throw new RangeError("generated mesh estimate exceeds the two-million-cell experimental limit");
  }
  const x=fullAxis(xSegments,spec.modelFraction!=="quarter");
  const y=fullAxis(ySegments,spec.modelFraction==="full");
  const z=Array.from({length:nz/rz**stages+1},(_,i)=>height*i/(nz/rz**stages));
  const baseMesh = createHexUnitCubeMesh(x.length-1,y.length-1,z.length-1);
  baseMesh.nodes = baseMesh.nodes.map(([u,v,w]) => [x[Math.round(u!*(x.length-1))]!,y[Math.round(v!*(y.length-1))]!,z[Math.round(w!*(z.length-1))]!]);
  const coreParentIds=selectInnerBox(baseMesh,fineLength/2,fineWidth/2);
  const firstCore=selectInnerBox(baseMesh,innerX,innerY);
  const tolerance = minElementEdgeLength(baseMesh) * 1e-8;
  let current=refineBlock(baseMesh,firstCore,plan.effectiveReductions,tolerance);
  if (stages===2) {
    // The second pass sees only the first pass's uniform interior, not its transition shell.
    const firstParents=new Set(firstCore);
    const patchIndices=current.lineage.flatMap((p,i)=>firstParents.has(p) ? [i]:[]);
    const patchSet=new Set(patchIndices);
    const patch=canonicalCartesianPatch(current.mesh,patchIndices,tolerance);
    const selected=selectInnerBox(patch,fineLength/2,fineWidth/2);
    const refined=refineBlock(patch,selected,plan.effectiveReductions,tolerance);
    const offset=current.mesh.nodes.length;
    const nodes=[...current.mesh.nodes,...refined.mesh.nodes];
    const elements=[...current.mesh.elements.filter((_,i)=>!patchSet.has(i)),
      ...refined.mesh.elements.map(e=>e.map(n=>n+offset))];
    const lineage=[...current.lineage.filter((_,i)=>!patchSet.has(i)),
      ...refined.lineage.map(p=>current.lineage[patchIndices[p-1]!]!)];
    current={mesh:mergeCoincidentNodes({kind:"H1",nodes,elements},tolerance),lineage};
  }
  const expectedCoreChildren=(rx*ry*rz)**stages;
  const children = new Map<number,number[]>();
  current.lineage.forEach((parent,i) => {const list=children.get(parent) ?? [];list.push(i);children.set(parent,list);});
  if (children.size!==baseMesh.elements.length) throw new Error("generated rectangle lost original parents");
  const coreNodes=new Set(firstCore.flatMap(parent=>baseMesh.elements[parent-1]!));
  for (const [parent,childIds] of children) {
    if (childIds.length>1 && !baseMesh.elements[parent-1]!.some(n=>coreNodes.has(n))) {
      throw new Error("directional transitions extended beyond the one-parent support ring");
    }
  }
  for (const parent of coreParentIds) {
    if (children.get(parent)?.length !== expectedCoreChildren) throw new Error(`core parent ${parent} has an incorrect child count`);
    const vertices = baseMesh.elements[parent-1]!.map(n => baseMesh.nodes[n-1]!);
    const low=[0,1,2].map(a => Math.min(...vertices.map(p => p[a]!)));
    const high=[0,1,2].map(a => Math.max(...vertices.map(p => p[a]!)));
    for (const child of children.get(parent)!) for (const nodeId of current.mesh.elements[child]!) {
      const point = current.mesh.nodes[nodeId-1]!;
      for (const a of [0,1,2] as const) {
        const divisions=plan.effectiveReductions[a]**stages;
        const index=(point[a]!-low[a]!)/(high[a]!-low[a]!)*divisions;
        if (Math.abs(index-Math.round(index))>1e-6 || index < -1e-6 || index > divisions+1e-6) {
          throw new Error(`core parent ${parent} is not on the requested tensor grid`);
        }
      }
    }
  }
  if (plan.effectiveAngleDegrees!==0) {
    // GUI D/B translate through thickness; C/A taper the shift to fixed outer X faces.
    const map=(point: readonly number[])=>{
      const coordinate=Math.abs(point[0]!);
      const middleWeight=stages===2 ? plan.intermediateOffset/plan.offset:0;
      const weight=coordinate<=fineLength/2 ? 1
        : stages===1 ? (length/2-coordinate)/(length/2-fineLength/2)
        : coordinate<=innerX ? 1+(middleWeight-1)*(coordinate-fineLength/2)/(innerX-fineLength/2)
        : middleWeight*(length/2-coordinate)/(length/2-innerX);
      return [point[0]!+plan.offset*(point[2]!/height-0.5)*weight,point[1]!,point[2]!];
    };
    current.mesh={...current.mesh,nodes:current.mesh.nodes.map(map)};
    baseMesh.nodes=baseMesh.nodes.map(map);
  }
  const conformity = checkNoHangingNodes(current.mesh,tolerance*10);
  if (!conformity.ok) throw new Error(`generated rectangle has ${conformity.hanging.length} hanging incidences`);
  const bounds = [[x[0]!,x.at(-1)!],[y[0]!,y.at(-1)!],[0,height]];
  const exterior = exteriorFaceCount(current.mesh,bounds,tolerance*10);
  let volume=0, minimumCornerScaledJacobian=Infinity, minimumGaussDeterminant=Infinity;
  for (const element of current.mesh.elements) {
    const vertices = element.map(n => current.mesh.nodes[n-1]!);
    volume += hexElementSignedVolume(vertices);
    minimumCornerScaledJacobian=Math.min(minimumCornerScaledJacobian,minimumHexCornerScaledJacobian(vertices));
    for (const u of [-1/Math.sqrt(3),1/Math.sqrt(3)]) for (const v of [-1/Math.sqrt(3),1/Math.sqrt(3)]) for (const w of [-1/Math.sqrt(3),1/Math.sqrt(3)]) {
      const [a,b,c] = hexJacobian(vertices,u,v,w);
      const det=a[0]!*(b[1]!*c[2]!-b[2]!*c[1]!)-a[1]!*(b[0]!*c[2]!-b[2]!*c[0]!)+a[2]!*(b[0]!*c[1]!-b[1]!*c[0]!);
      minimumGaussDeterminant=Math.min(minimumGaussDeterminant,det);
    }
  }
  const expectedVolume=(x.at(-1)!-x[0]!)*(y.at(-1)!-y[0]!)*height;
  const relativeVolumeError=Math.abs(volume-expectedVolume)/expectedVolume;
  if (!(minimumCornerScaledJacobian>0 && minimumGaussDeterminant>0 && relativeVolumeError<1e-8)) {
    throw new Error("generated rectangle failed volume/Jacobian audit");
  }
  return {mesh:current.mesh,plan,parentElementIds:current.lineage,coreParentIds,baseMesh,
    quality:{minimumCornerScaledJacobian,minimumGaussDeterminant,volume,relativeVolumeError,
      externalFaces:exterior,unchangedParents:[...children.values()].filter(c=>c.length===1).length,expectedCoreChildren,
      warnings:minimumCornerScaledJacobian<0.2 ? ["Minimum corner scaled Jacobian is below 0.2; engineering quality review is required."]:[]}};
}

function fullAxis(segments: readonly [number,number][], mirrored: boolean): number[] {
  const positive=[0];
  for (const [end,count] of segments) {
    const start=positive.at(-1)!;
    for (let i=1;i<=count;i+=1) positive.push(start+(end-start)*i/count);
  }
  return mirrored ? [...positive.slice(1).reverse().map(v=>-v),...positive] : positive;
}

function selectInnerBox(mesh: Mesh, x: number, y: number): number[] {
  return mesh.elements.flatMap((e,i)=>{
    const center=[0,1].map(a=>e.reduce((s,n)=>s+mesh.nodes[n-1]![a]!/8,0));
    return Math.abs(center[0]!)<x && Math.abs(center[1]!)<y ? [i+1]:[];
  });
}

function refineBlock(mesh: Mesh, selected: number[], ratios: readonly number[], tolerance: number) {
  let current={mesh,lineage:mesh.elements.map((_,i)=>i+1)};
  const halfAxes=([2,1,0] as const).filter(axis=>ratios[axis]===2);
  if (halfAxes.length) {
    const replacements=tryBuildDirectionalTwoToOneHexReplacements(mesh,selected,halfAxes);
    if (!replacements) throw new Error("rectangular half-ratio sweep could not recover its logical grid");
    current=applyWithLineage(current.mesh,current.lineage,replacements,tolerance);
  }
  const core=new Set(selected);
  for (const axis of [0,1,2] as const) {
    if (ratios[axis]===3) current=directionalThirdPass(current.mesh,current.lineage,core,axis,tolerance);
  }
  return current;
}

function canonicalCartesianPatch(mesh: Mesh, indices: number[], tolerance: number): Mesh {
  const corners=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const ids=[...new Set(indices.flatMap(i=>mesh.elements[i]!))];
  const mapped=new Map(ids.map((n,i)=>[n,i+1]));
  const nodes=ids.map(n=>mesh.nodes[n-1]!);
  const elements=indices.map(i=>{
    const element=mesh.elements[i]!;
    const low=[0,1,2].map(a=>Math.min(...element.map(n=>mesh.nodes[n-1]![a]!)));
    const high=[0,1,2].map(a=>Math.max(...element.map(n=>mesh.nodes[n-1]![a]!)));
    const ordered=corners.map(c=>element.find(n=>c.every((side,a)=>
      Math.abs(mesh.nodes[n-1]![a]!-(side ? high[a]!:low[a]!))<tolerance)));
    if (ordered.some(n=>n===undefined) || new Set(ordered).size!==8) throw new Error("nested generation patch is not Cartesian");
    return ordered.map(n=>mapped.get(n!)!);
  });
  return {kind:"H1",nodes,elements};
}

function exteriorFaceCount(mesh: Mesh, bounds: number[][], tolerance: number): number {
  const faces = new Map<string,{nodes:number[];count:number}>();
  const elements = new Set<string>();
  for (const element of mesh.elements) {
    if (new Set(element).size!==8) throw new Error("generated mesh has degenerate connectivity");
    const cellKey=[...element].sort((a,b)=>a-b).join(":");
    if (elements.has(cellKey)) throw new Error("generated mesh has duplicate elements");
    elements.add(cellKey);
    for (const face of H1_FACES) {
      const nodes=face.map(n=>element[n-1]!);const key=[...nodes].sort((a,b)=>a-b).join(":");
      const record=faces.get(key) ?? {nodes,count:0};record.count+=1;faces.set(key,record);
    }
  }
  let count=0;
  for (const face of faces.values()) {
    if (face.count>2) throw new Error("generated mesh has a nonmanifold face");
    if (face.count!==1) continue;
    if (!bounds.some((levels,a)=>levels.some(v=>face.nodes.every(n=>Math.abs(mesh.nodes[n-1]![a]!-v)<=tolerance)))) {
      throw new Error("generated rectangle has an unexpected interior free face");
    }
    count+=1;
  }
  return count;
}
