import type {Mesh} from "./types.js";
import {createHexUnitCubeMesh} from "./grid.js";
import {buildDirectTwoToOneHexPlan,type TwoToOneReplacement} from "./two-to-one.js";
import type {ReferencePoint3} from "./two-to-one-templates.js";
import {conserveGeneratedCapFaceFlux} from "./transition-face-flux.js";
import {applyWithLineage} from "./directional-third-internal.js";
import {minElementEdgeLength} from "./mesh.js";
import {H1_FACES,boundaryKey} from "./topology.js";
import {checkNoHangingNodes} from "./conformance.js";
import {minimumHexCornerScaledJacobian,hexElementSignedVolume} from "./hex-quality.js";
import {hexJacobian} from "./hex-quality-internal.js";

/** A seven-block solid ball with a bounded +Z surface-cap refinement, not a hollow sphere. */
export interface SolidSphereGradingSpec {
  radius:number;
  faceSegments:number;
  radialSegments:number;
  capSegments:number;
  capLayers:number;
  cubeHalfWidthFraction?:number;
  minimumCornerScaledJacobian?:number;
  maximumFaceDisplacementFraction?:number;
  elementLimit?:number;
}

const EDGES=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]] as const;
const gauss=[-1/Math.sqrt(3),1/Math.sqrt(3)];
const signs=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];

function determinant(a:readonly number[],b:readonly number[],c:readonly number[]){
  return a[0]!*(b[1]!*c[2]!-b[2]!*c[1]!)-a[1]!*(b[0]!*c[2]!-b[2]!*c[0]!)+a[2]!*(b[0]!*c[1]!-b[1]!*c[0]!);
}
function checked(spec:SolidSphereGradingSpec){
  if(!spec||typeof spec!=="object"||Array.isArray(spec)||Object.keys(spec).some(k=>!["radius","faceSegments","radialSegments","capSegments","capLayers","cubeHalfWidthFraction","minimumCornerScaledJacobian","maximumFaceDisplacementFraction","elementLimit"].includes(k)))throw new RangeError("invalid solid sphere options");
  const {radius:r,faceSegments:n,radialSegments:m,capSegments:c,capLayers:d}=spec;
  if(!Number.isFinite(r)||r<=0||!Number.isFinite(4*Math.PI*r**3/3)||r**3<1e-150)throw new RangeError("invalid sphere radius/volume scale");
  if(![n,m,c,d].every(v=>Number.isSafeInteger(v))||n<6||n>24||n%2||m<4||m>24||c<2||c%2||c>n-4||d<1||d>m-2)throw new RangeError("sphere seeds require even faceSegments 6..24, even capSegments 2..n-4, radialSegments 4..24 and capLayers 1..m-2");
  const fraction=spec.cubeHalfWidthFraction??.4,minimumSJ=spec.minimumCornerScaledJacobian??.2,limit=spec.elementLimit??100000;
  if(!Number.isFinite(fraction)||fraction<.25||fraction>.5)throw new RangeError("cubeHalfWidthFraction must be in [0.25,0.5]");
  if(!Number.isFinite(minimumSJ)||minimumSJ<=0||minimumSJ>1)throw new RangeError("invalid minimum corner SJ");
  const maximumFaceDisplacementFraction=spec.maximumFaceDisplacementFraction??.002;
  if(!Number.isFinite(maximumFaceDisplacementFraction)||maximumFaceDisplacementFraction<=0||maximumFaceDisplacementFraction>.01)throw new RangeError("invalid sphere face displacement fraction");
  if(!Number.isSafeInteger(limit)||limit<1||limit>200000)throw new RangeError("invalid sphere element budget");
  const baseCount=n**3+6*n*n*m,maximumElements=baseCount+7*(c+2)**2*(d+1);
  if(maximumElements>limit)throw new RangeError(`conservative sphere allocation bound ${maximumElements} exceeds elementLimit`);
  return {r,n,m,c,d,fraction,minimumSJ,limit,baseCount,maximumElements,maximumFaceDisplacementFraction};
}

export function generateSolidSphereGradedMesh(spec:SolidSphereGradingSpec){
  const {r,n,m,c,d,fraction,minimumSJ,baseCount,maximumElements,maximumFaceDisplacementFraction}=checked(spec),a=r*fraction;
  const baseMesh=createHexUnitCubeMesh(n,n,n);
  baseMesh.nodes=baseMesh.nodes.map(p=>p.map(v=>a*(2*v-1)));
  const shared=new Map<string,number>();
  const gridKey=(k:number,g:readonly number[])=>`${k}:${g.join(":")}`;
  let next=0;
  for(let k=0;k<=n;k++)for(let j=0;j<=n;j++)for(let i=0;i<=n;i++)shared.set(gridKey(0,[i,j,k]),++next);
  const patches:number[][]=[];
  for(const axis of [0,1,2])for(const sign of [-1,1]){
    const ids:number[]=[],parents:number[]=[],b=(axis+1)%3,cc=(axis+2)%3;
    for(let k=0;k<=m;k++)for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){
      const g=[0,0,0];g[axis]=sign===1?n:0;g[b]=i;g[cc]=j;
      const key=gridKey(k,g);let id=shared.get(key);
      if(id===undefined){
        const q=g.map(v=>a*(2*v/n-1)),t=k/m,s=1-t+t*r/Math.hypot(...q);
        baseMesh.nodes.push(q.map(v=>v*s));id=baseMesh.nodes.length;shared.set(key,id);
      }
      ids.push(id);
    }
    const id=(i:number,j:number,k:number)=>ids[i+(n+1)*j+(n+1)**2*k]!;
    for(let k=0;k<m;k++)for(let j=0;j<n;j++)for(let i=0;i<n;i++){
      let e=[id(i,j,k),id(i+1,j,k),id(i+1,j+1,k),id(i,j+1,k),id(i,j,k+1),id(i+1,j,k+1),id(i+1,j+1,k+1),id(i,j+1,k+1)];
      if(sign===-1)e=[e[1]!,e[0]!,e[3]!,e[2]!,e[5]!,e[4]!,e[7]!,e[6]!];
      baseMesh.elements.push(e);parents.push(baseMesh.elements.length);
    }
    patches.push(parents);
  }
  if(baseMesh.elements.length!==baseCount)throw new Error("sphere base count mismatch");

  // Only +Z changes. Its two-cell lateral buffer keeps every inter-block wall coarse.
  const reference=createHexUnitCubeMesh(n,n,m),first=(n-c)/2;
  const selected:number[]=[];
  for(let k=m-d;k<m;k++)for(let j=first;j<first+c;j++)for(let i=first;i<first+c;i++)selected.push(i+n*j+n*n*k+1);
  const plan=buildDirectTwoToOneHexPlan(reference,selected);
  const refined=applyWithLineage(reference,reference.elements.map((_,i)=>i+1),plan.replacements,minElementEdgeLength(reference)*1e-8);
  const counts=new Map<number,number>();for(const parent of refined.lineage)counts.set(parent,(counts.get(parent)??0)+1);
  const selectedSet=new Set(selected),sourceCap=patches[5]!;
  for(const parent of selected)if(counts.get(parent)!==8)throw new Error("sphere cap was not refined exactly once");
  const referenceChildren=new Map<number,(readonly number[])[]>();
  refined.mesh.elements.forEach((e,i)=>{const parent=refined.lineage[i]!;if(selectedSet.has(parent)){const list=referenceChildren.get(parent)??[];list.push(e);referenceChildren.set(parent,list);}});
  for(const parent of selected){
    const q=parent-1,ijk=[q%n,Math.floor(q/n)%n,Math.floor(q/(n*n))],expected=new Set<string>(),actual=new Set<string>(),points=new Set<string>();
    for(let k=0;k<2;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++)expected.add(signs.map(s=>`${i+(s[0]!+1)/2}:${j+(s[1]!+1)/2}:${k+(s[2]!+1)/2}`).sort().join("|"));
    for(const e of referenceChildren.get(parent)!){
      const keys=e.map(id=>{
        const uvw=refined.mesh.nodes[id-1]!.map((v,axis)=>2*(v*(axis===2?m:n)-ijk[axis]!));
        if(uvw.some(v=>Math.abs(v-Math.round(v))>1e-7||v< -1e-7||v>2+1e-7))throw new Error("sphere core is not on its half-grid");
        const key=uvw.map(Math.round).join(":");points.add(key);return key;
      });actual.add(keys.sort().join("|"));
    }
    if(points.size!==27||actual.size!==8||[...actual].some(key=>!expected.has(key)))throw new Error("sphere core tensor connectivity mismatch");
  }
  for(const replacement of plan.replacements){
    const q=replacement.elementId-1,i=q%n,j=Math.floor(q/n)%n,k=Math.floor(q/(n*n));
    if(i<first-1||i>first+c||j<first-1||j>first+c||k<m-d-1)throw new Error("sphere transition escaped its declared one-parent support");
  }
  const capCoreParentIds=selected.map(id=>sourceCap[id-1]!);
  const physicalReplacements:TwoToOneReplacement[]=plan.replacements.map(replacement=>{
    const q=replacement.elementId-1,ijk=[q%n,Math.floor(q/n)%n,Math.floor(q/(n*n))];
    const referenceNodes=replacement.refinement.nodes.map(p=>p.map((v,axis)=>2*(v*(axis===2?m:n)-ijk[axis]!)-1) as unknown as ReferencePoint3);
    const vertices=baseMesh.elements[sourceCap[q]!-1]!.map(id=>baseMesh.nodes[id-1]!);
    const physical=referenceNodes.map(p=>[0,1,2].map(axis=>vertices.reduce((sum,v,i)=>sum+v[axis]!*signs[i]!.reduce((w,s,a)=>w*(1+s*p[a]!)/2,1),0)));
    return {...replacement,elementId:sourceCap[q]!,referenceNodes,refinement:{...replacement.refinement,nodes:physical}};
  });
  const conservative=conserveGeneratedCapFaceFlux(baseMesh,physicalReplacements,maximumFaceDisplacementFraction);
  const applied=applyWithLineage(baseMesh,baseMesh.elements.map((_,i)=>i+1),conservative.replacements,minElementEdgeLength(baseMesh)*1e-8);
  const mesh=applied.mesh,{nodes,elements}=mesh,parentElementIds=applied.lineage,projectedNodeIds:number[]=[];
  const beforeProjection=new Map<number,number>();
  elements.forEach((e,i)=>{const parent=parentElementIds[i]!;beforeProjection.set(parent,(beforeProjection.get(parent)??0)+hexElementSignedVolume(e.map(id=>nodes[id-1]!)));});
  const sourceVolumes=baseMesh.elements.map(e=>hexElementSignedVolume(e.map(id=>baseMesh.nodes[id-1]!)));
  let preProjectionMaximumParentVolumeError=0;
  for(const [parent,volume] of beforeProjection)preProjectionMaximumParentVolumeError=Math.max(preProjectionMaximumParentVolumeError,Math.abs(volume-sourceVolumes[parent-1]!)/sourceVolumes[parent-1]!);
  if(preProjectionMaximumParentVolumeError>1e-8)throw new Error("sphere pre-projection parent volume gate failed");
  const faceIncidence=new Map<string,{ids:number[];count:number}>();
  for(const e of elements)for(const f of H1_FACES){const ids=f.map(i=>e[i-1]!),key=boundaryKey(ids),record=faceIncidence.get(key)??{ids,count:0};record.count++;faceIncidence.set(key,record);}
  const newExterior=new Set([...faceIncidence.values()].filter(f=>f.count===1).flatMap(f=>f.ids.filter(id=>id>baseMesh.nodes.length)));
  for(const id of newExterior){const p=nodes[id-1]!;if(!(p[2]!>0))throw new Error("new sphere boundary outside the +Z cap");const scale=r/Math.hypot(...p);nodes[id-1]=p.map(v=>v*scale);projectedNodeIds.push(id);}
  const coreGlobal=new Set(capCoreParentIds),regions:{core:number[];transition:number[];far:number[]}={core:[],transition:[],far:[]};
  const changedGlobal=new Set(physicalReplacements.map(replacement=>replacement.elementId));
  parentElementIds.forEach((parent,i)=>regions[coreGlobal.has(parent)?"core":changedGlobal.has(parent)?"transition":"far"].push(i+1));
  const quality=auditSolidSphere(mesh,r,minimumSJ);
  if(mesh.elements.length>maximumElements||regions.core.length!==8*c*c*d)throw new Error("sphere result count mismatch");
  const children=new Map<number,number[]>();parentElementIds.forEach((p,i)=>{const list=children.get(p)??[];list.push(i);children.set(p,list);});
  if(children.size!==baseCount)throw new Error("sphere lost source parents");
  for(const parent of children.keys())if(children.get(parent)!.length===1){
    const e=elements[children.get(parent)![0]!]!,original=baseMesh.elements[parent-1]!;
    if(e.some((id,i)=>id!==original[i]))throw new Error("sphere coarse far-field connectivity changed");
  }
  const sourceVolume=baseMesh.elements.reduce((sum,e)=>sum+hexElementSignedVolume(e.map(id=>baseMesh.nodes[id-1]!)),0);
  return {mesh,baseMesh,parentElementIds,capCoreParentIds,regions,projectedNodeIds,
    plan:{kind:"solid-sphere-surface-cap" as const,refinementRatio:2 as const,faceSegments:n,radialSegments:m,
      capSegments:c,capLayers:d,cubeHalfWidth:a,sourceElementCount:baseCount,coreParentCount:c*c*d,
      expectedCoreChildren:8*c*c*d,maximumElements,transitionStrategy:plan.strategy,
      attentionRegion:"+Z face-block central parameter rectangle, outermost radial parent layers"},
    quality:{...quality,sourceDiscreteVolume:sourceVolume,projectionVolumeChange:quality.volume-sourceVolume,
      conservativeFaceMapping:conservative.report,preProjectionMaximumParentVolumeError,
      coreMinimumCornerSJ:regions.core.reduce((lo,id)=>Math.min(lo,minimumHexCornerScaledJacobian(elements[id-1]!.map(nid=>nodes[nid-1]!))),Infinity),
      referenceCoreTensorVerified:true},
    warnings:["The cap footprint is a block-coordinate rectangle, not an arbitrary circular geodesic cap or concentric spherical shell.",
      "Boundary nodes lie on the analytic sphere; H8 boundary faces are a discrete approximation. Analytic volume error is reported separately.",
      "2:1 denotes one tensor 1-to-8 split in the cap reference coordinates, not equal physical edges on a curved surface."]};
}

function auditSolidSphere(mesh:Mesh,radius:number,minimumSJ:number){
  const faces=new Map<string,{ids:number[];count:number}>(),cells=new Set<string>();
  let volume=0,minSJ=Infinity,minGauss=Infinity,minEdge=Infinity,maxAspect=0;
  for(const e of mesh.elements){
    if(e.length!==8||new Set(e).size!==8||e.some(id=>!Number.isSafeInteger(id)||id<1||id>mesh.nodes.length))throw new Error("invalid sphere H8 connectivity");
    const key=boundaryKey(e);if(cells.has(key))throw new Error("duplicate sphere element");cells.add(key);
    const p=e.map(id=>mesh.nodes[id-1]!);volume+=hexElementSignedVolume(p);minSJ=Math.min(minSJ,minimumHexCornerScaledJacobian(p));
    for(const u of gauss)for(const v of gauss)for(const w of gauss){const [a,b,c]=hexJacobian(p,u,v,w);minGauss=Math.min(minGauss,determinant(a,b,c));}
    const lengths=EDGES.map(([a,b])=>Math.hypot(...p[a]!.map((v,i)=>v-p[b]![i]!))),lo=Math.min(...lengths);
    minEdge=Math.min(minEdge,lo);maxAspect=Math.max(maxAspect,Math.max(...lengths)/lo);
    for(const f of H1_FACES){const ids=f.map(n=>e[n-1]!),key=boundaryKey(ids),record=faces.get(key)??{ids,count:0};record.count++;if(record.count>2)throw new Error("nonmanifold sphere face");faces.set(key,record);}
  }
  if(!Number.isFinite(volume)||!(minSJ>=minimumSJ&&minGauss>0&&minEdge>0))throw new Error(`sphere quality gate failed: minimum corner SJ ${minSJ}, required ${minimumSJ}`);
  const external=[...faces.values()].filter(f=>f.count===1),edges=new Map<string,number>(),vertices=new Set<number>();
  let surfaceVolume=0,maximumBoundaryRadiusError=0;
  for(const f of external){
    const p=f.ids.map(id=>{vertices.add(id);const q=mesh.nodes[id-1]!;maximumBoundaryRadiusError=Math.max(maximumBoundaryRadiusError,Math.abs(Math.hypot(...q)-radius));return q;});
    for(let i=0;i<4;i++){const key=boundaryKey([f.ids[i]!,f.ids[(i+1)%4]!]);edges.set(key,(edges.get(key)??0)+1);}
    for(const u of gauss)for(const v of gauss){
      const st=[[-1,-1],[1,-1],[1,1],[-1,1]],x=[0,0,0],du=[0,0,0],dv=[0,0,0];
      st.forEach(([s,t],i)=>{for(let axis=0;axis<3;axis++){x[axis]!+=p[i]![axis]!*(1+s!*u)*(1+t!*v)/4;du[axis]!+=p[i]![axis]!*s!*(1+t!*v)/4;dv[axis]!+=p[i]![axis]!*(1+s!*u)*t!/4;}});
      // Convex ball boundary faces are outward after correcting the face winding.
      surfaceVolume+=Math.abs(determinant(x,du,dv))/3;
    }
  }
  const relativeDiscreteVolumeError=Math.abs(volume-surfaceVolume)/surfaceVolume;
  if(edges.size===0||[...edges.values()].some(v=>v!==2)||vertices.size-edges.size+external.length!==2)throw new Error("sphere exterior is not a closed quadrilateral two-manifold");
  if(!Number.isFinite(surfaceVolume)||!Number.isFinite(relativeDiscreteVolumeError)||maximumBoundaryRadiusError>radius*1e-12||relativeDiscreteVolumeError>1e-8)throw new Error("sphere boundary/volume gate failed");
  const conformity=checkNoHangingNodes(mesh,minEdge*1e-8);if(!conformity.ok)throw new Error("sphere has hanging/internal unmatched faces");
  return {volume,minimumCornerScaledJacobian:minSJ,minimumGaussDeterminant:minGauss,minimumEdge:minEdge,maximumEdgeAspect:maxAspect,
    surfaceIntegratedVolume:surfaceVolume,relativeDiscreteVolumeError,analyticVolume:4*Math.PI*radius**3/3,
    relativeAnalyticVolumeError:Math.abs(volume-4*Math.PI*radius**3/3)/(4*Math.PI*radius**3/3),
    maximumBoundaryRadiusError,exteriorFaces:external.length,exteriorEulerCharacteristic:2,hangingIncidences:0};
}
