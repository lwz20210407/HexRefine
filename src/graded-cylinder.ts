import type {Mesh} from "./types.js";
import type {ModelFraction} from "./graded-rectangle-plan.js";
import {generateRectangularGradedMesh} from "./graded-rectangle.js";
import {mergeCoincidentNodes,minElementEdgeLength} from "./mesh.js";
import {checkNoHangingNodes} from "./conformance.js";
import {H1_FACES} from "./topology.js";
import {hexElementSignedVolume,minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {hexJacobian} from "./hex-quality-internal.js";

export interface CylindricalGradingSpec {
  outerRadius:number;
  thickness:number;
  length:number;
  /** Full fine-region spans on the outermost cylinder, before symmetry copies. */
  coreArcLength:number;
  coreLength:number;
  fineSize:number;
  radialSize:number;
  coarseSize:number;
  thicknessTransition:boolean;
  layers:number;
  modelFraction:ModelFraction;
}

/** Thick solid cylinders with disconnected physical layers, not shell elements. */
export function generateCylindricalGradedMesh(spec:CylindricalGradingSpec) {
  const allowed=new Set(["outerRadius","thickness","length","coreArcLength","coreLength","fineSize","radialSize","coarseSize","thicknessTransition","layers","modelFraction"]);
  if(Object.keys(spec).some(k=>!allowed.has(k)))throw new RangeError("unsupported cylindrical grading option");
  const values=[spec.outerRadius,spec.thickness,spec.length,spec.coreArcLength,spec.coreLength,spec.fineSize,spec.radialSize,spec.coarseSize];
  if(values.some(v=>!Number.isFinite(v)||v<=0))throw new RangeError("cylinder dimensions must be finite and positive");
  if(!Number.isSafeInteger(spec.layers)||spec.layers<1)throw new RangeError("physical layer count must be a positive integer");
  if(typeof spec.thicknessTransition!=="boolean")throw new TypeError("thicknessTransition must be boolean");
  if(!["quarter","half","full"].includes(spec.modelFraction))throw new RangeError("invalid cylinder modelFraction");
  const R=spec.outerRadius,H=spec.thickness,L=spec.length,dx=spec.coreArcLength/2,dy=spec.coreLength/2;
  const alpha=dx/R,ox=R*Math.PI/2-dx,oy=L/2-dy;
  const innermost=R-(spec.layers-1)*(H+spec.fineSize)-H;
  if(!(innermost>0))throw new RangeError("physical cylinder layers reach or cross the axis");
  if(!(ox>spec.coarseSize && oy>spec.coarseSize))throw new RangeError("cylinder core must leave usable outer bands in both directions");
  const aligned=(v:number)=>{const n=Math.round(v),result=Math.ceil(n/3)*3;
    if(n<1||!Number.isSafeInteger(result))throw new RangeError("invalid cylinder fine count");return result;};
  // This branch always aligns radial counts to three, even when radial transition is off.
  const [nx,ny,nz]=[aligned(dx/spec.fineSize),aligned(dy/spec.fineSize),aligned(H/spec.radialSize)];
  const [cx,cy]=[Math.round(ox/spec.coarseSize),Math.round(oy/spec.coarseSize)];
  if(![cx,cy].every(n=>Number.isSafeInteger(n)&&n>=2))throw new RangeError("cylinder needs at least two outer intervals");
  const sx=spec.modelFraction==="quarter"?[1]:[1,-1];
  const sy=spec.modelFraction==="full"?[1,-1]:[1];
  const copies=sx.length*sy.length*2;
  if(!Number.isSafeInteger((nx+3*cx)*(ny+3*cy)*nz*copies*spec.layers)
    || (nx+3*cx)*(ny+3*cy)*nz*copies*spec.layers>2000000)throw new RangeError("cylinder exceeds the experimental allocation limit");
  // Synthetic lengths encode the independently rounded counts; physical mapping follows below.
  const logical=generateRectangularGradedMesh({fullSize:[2*(nx+3*cx),2*(ny+3*cy),nz],
    refinedSize:[2*nx,2*ny],fineSize:1,coarseSize:3,reductions:{x:3,y:3,z:3},
    thicknessTransition:spec.thicknessTransition,transitionStages:1,modelFraction:"quarter"});
  const mesh:Mesh={kind:"H1",nodes:[],elements:[]},baseMesh:Mesh={kind:"H1",nodes:[],elements:[]};
  const parentElementIds:number[]=[],coreParentIds:number[]=[];
  const nodeSets:Record<string,number[]>={},cellSets:Record<string,number[]>={};
  const layerRadii:Array<{outer:number;inner:number}>=[];
  const tolerance=Math.min(spec.fineSize,spec.radialSize,spec.coarseSize,innermost,H)*1e-8;
  const append=(target:Mesh,source:Mesh)=>{const offset=target.nodes.length;target.nodes.push(...source.nodes);
    target.elements.push(...source.elements.map(e=>e.map(n=>n+offset)));};
  for(let layer=0;layer<spec.layers;layer++){
    const outer=R-layer*(H+spec.fineSize),inner=outer-H;
    layerRadii.push({outer,inner});
    const assembled:Mesh={kind:"H1",nodes:[],elements:[]},base:Mesh={kind:"H1",nodes:[],elements:[]};
    for(const xsign of sx)for(const ysign of sy)for(const zsign of [1,-1]){
      const mapped=(source:Mesh):Mesh=>{
        const nodes=source.nodes.map(p=>{
          const angle=p[0]!<=nx ? alpha*p[0]!/nx:alpha+(Math.PI/2-alpha)*(p[0]!-nx)/(3*cx);
          const axial=p[1]!<=ny ? dy*p[1]!/ny:dy+oy*(p[1]!-ny)/(3*cy);
          const radius=inner+H*p[2]!/nz;
          return [xsign*radius*Math.sin(angle),ysign*axial,zsign*radius*Math.cos(angle)];
        });
        const flip=[1,0,3,2,5,4,7,6];
        return {kind:"H1",nodes,elements:source.elements.map(e=>xsign*ysign*zsign<0?flip.map(i=>e[i]!):[...e])};
      };
      const offset=baseMesh.elements.length+base.elements.length;
      parentElementIds.push(...logical.parentElementIds.map(p=>p+offset));
      coreParentIds.push(...logical.coreParentIds.map(p=>p+offset));
      append(base,mapped(logical.baseMesh));append(assembled,mapped(logical.mesh));
    }
    // Merge only symmetry copies of THIS physical layer. Never merge across the layer gap.
    const merged=mergeCoincidentNodes(assembled,tolerance),mergedBase=mergeCoincidentNodes(base,tolerance);
    const name=`layer_${layer+1}`;
    nodeSets[name]=merged.nodes.map((_,i)=>mesh.nodes.length+i+1);
    cellSets[name]=merged.elements.map((_,i)=>mesh.elements.length+i+1);
    append(mesh,merged);append(baseMesh,mergedBase);
  }
  const quality=auditCylinder(mesh,spec,layerRadii,tolerance*10);
  return {mesh,baseMesh,parentElementIds,coreParentIds,nodeSets,cellSets,
    plan:{fineCounts:[nx,ny,nz],outerCounts:[cx,cy,spec.thicknessTransition?nz/3:nz],
      fineSpacing:[dx/nx,dy/ny,H/nz],coarseSpacing:[ox/cx,oy/cy],effectiveReductions:[3,3,spec.thicknessTransition?3:1],
      alpha,layerGap:spec.fineSize,layerRadii,modelFraction:spec.modelFraction,
      coverage:spec.modelFraction==="quarter"?"X>=0, Y>=0, both Z signs":spec.modelFraction==="half"?"full circumference, Y>=0":"full circumference, both Y signs",
      mapping:"angle/radius mapping of a conforming logical mesh; all radial boundary nodes on analytic cylinders",
      warnings:spec.modelFraction==="full"?["Native full cylinder fixes the recovered vi=3 half-circumference output."]:[]},quality};
}

function auditCylinder(mesh:Mesh,spec:CylindricalGradingSpec,radii:readonly {outer:number;inner:number}[],tolerance:number) {
  if(!checkNoHangingNodes(mesh,Math.min(tolerance,minElementEdgeLength(mesh)*1e-7)).ok)throw new Error("cylinder has hanging incidences");
  const faces=new Map<string,{nodes:number[];center:number[];count:number}>(),cells=new Set<string>();
  let volume=0,minSJ=Infinity,minGauss=Infinity;
  for(const e of mesh.elements){
    if(e.length!==8||new Set(e).size!==8)throw new Error("invalid cylinder hex");
    const key=[...e].sort((a,b)=>a-b).join(":");if(cells.has(key))throw new Error("duplicate cylinder hex");cells.add(key);
    const v=e.map(n=>mesh.nodes[n-1]!);
    volume+=hexElementSignedVolume(v);minSJ=Math.min(minSJ,minimumHexCornerScaledJacobian(v));
    for(const u of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const s of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const t of [-1/Math.sqrt(3),1/Math.sqrt(3)]){
      const [a,b,c]=hexJacobian(v,u,s,t);minGauss=Math.min(minGauss,dot(a,cross(b,c)));
    }
    const center=[0,1,2].map(a=>v.reduce((sum,p)=>sum+p[a]!/8,0));
    for(const f of H1_FACES){const nodes=f.map(n=>e[n-1]!),k=[...nodes].sort((a,b)=>a-b).join(":");
      const record=faces.get(k)??{nodes,center,count:0};record.count++;faces.set(k,record);}
  }
  let exteriorFaces=0,radialBoundaryError=0,boundaryVolume=0;
  for(const face of faces.values()){
    if(face.count>2)throw new Error("nonmanifold cylinder face");if(face.count!==1)continue;
    const v=face.nodes.map(n=>mesh.nodes[n-1]!);
    const radial=radii.flatMap(r=>[r.inner,r.outer]).find(r=>v.every(p=>Math.abs(Math.hypot(p[0]!,p[2]!)-r)<tolerance));
    const axial=[spec.length/2,...(spec.modelFraction==="full"?[-spec.length/2]:[0])].some(y=>v.every(p=>Math.abs(p[1]!-y)<tolerance));
    const cut=spec.modelFraction==="quarter"&&v.every(p=>Math.abs(p[0]!)<tolerance);
    if(radial===undefined&&!axial&&!cut)throw new Error("unexpected internal cylinder free face");
    if(radial!==undefined)for(const p of v)radialBoundaryError=Math.max(radialBoundaryError,Math.abs(Math.hypot(p[0]!,p[2]!)-radial));
    boundaryVolume+=faceFlux(v,face.center);exteriorFaces++;
  }
  const relativeBoundaryVolumeError=Math.abs(volume-boundaryVolume)/volume;
  const fraction={quarter:.25,half:.5,full:1}[spec.modelFraction];
  const analyticVolume=radii.reduce((sum,r)=>sum+Math.PI*(r.outer**2-r.inner**2)*spec.length*fraction,0);
  if(!(minSJ>0&&minGauss>0&&volume>0&&relativeBoundaryVolumeError<1e-8))throw new Error("cylinder failed volume/Jacobian audit");
  return {minimumCornerScaledJacobian:minSJ,minimumGaussDeterminant:minGauss,volume,boundaryVolume,relativeBoundaryVolumeError,
    analyticVolume,relativeAnalyticVolumeError:Math.abs(volume-analyticVolume)/analyticVolume,radialBoundaryError,exteriorFaces,
    warnings:minSJ<.2?["Minimum corner scaled Jacobian is below 0.2; engineering quality review is required."]:[]};
}

function cross(a:readonly number[],b:readonly number[]):number[]{return [a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!];}
function dot(a:readonly number[],b:readonly number[]):number{return a.reduce((s,v,i)=>s+v*b[i]!,0);}

/** Integrate the bilinear outer skin, distinct from the analytic cylinder volume. */
function faceFlux(v:readonly (readonly number[])[],cellCenter:readonly number[]):number {
  const signs=[[-1,-1],[1,-1],[1,1],[-1,1]];
  let flux=0;
  for(const u of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const w of [-1/Math.sqrt(3),1/Math.sqrt(3)]){
    const p=[0,0,0],du=[0,0,0],dv=[0,0,0];
    for(let i=0;i<4;i++)for(let a=0;a<3;a++){
      p[a]!+=v[i]![a]!*(1+signs[i]![0]!*u)*(1+signs[i]![1]!*w)/4;
      du[a]!+=(v[i]![a]!-v[0]![a]!)*signs[i]![0]!*(1+signs[i]![1]!*w)/4;
      dv[a]!+=(v[i]![a]!-v[0]![a]!)*signs[i]![1]!*(1+signs[i]![0]!*u)/4;
    }
    const normal=cross(du,dv),out=p.map((x,a)=>x-cellCenter[a]!);
    flux+=dot(p,normal)*Math.sign(dot(out,normal))/3;
  }
  return flux;
}
