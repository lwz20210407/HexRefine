import type {Mesh,Point} from "./types.js";
import type {ModelFraction} from "./graded-rectangle-plan.js";
import {createQ1UnitSquareMesh} from "./grid.js";
import {mergeCoincidentNodes} from "./mesh.js";
import {refineQ1To4Q1} from "./templates.js";
import {checkNoHangingNodes} from "./conformance.js";
import {auditPlanarQuadMesh} from "./graded-quad.js";
import {circularPolarPoint as polar,circularCorePoint} from "./circular-core-map-internal.js";

export interface CircularQuadSpec {
  radius:number;
  refinedRadius:number;
  fineSize:number;
  coarseSize:number;
  modelFraction:ModelFraction;
}

export function generateCircularGradedQuadMesh(spec:CircularQuadSpec) {
  const allowed=new Set(["radius","refinedRadius","fineSize","coarseSize","modelFraction"]);
  if(Object.keys(spec).some(k=>!allowed.has(k)))throw new RangeError("unsupported circular-quad option; the source uses a fixed 3:1 transition");
  const {radius:R,refinedRadius:r}=spec;
  if([R,r,spec.fineSize,spec.coarseSize].some(v=>!Number.isFinite(v)||v<=0)||r>=R)throw new RangeError("invalid circular-quad radii or sizes");
  if(!["quarter","half","full"].includes(spec.modelFraction))throw new RangeError("invalid circular-quad modelFraction");
  const raw=Math.round(r/spec.fineSize),count=Math.ceil(raw/6)*6;
  const radialCount=Math.round((R-r)/spec.coarseSize),n=count/2,nc=count/6,angularCount=2*nc;
  const xSigns=spec.modelFraction==="quarter"?[1]:[1,-1],ySigns=spec.modelFraction==="full"?[1,-1]:[1];
  const copies=xSigns.length*ySigns.length;
  const estimate=(3*n*n+angularCount*(radialCount+3))*copies;
  if(raw<1||radialCount<1||!Number.isSafeInteger(estimate)||estimate>2000000)throw new RangeError("invalid or excessive circular-quad counts");
  const growth=1.1,power=growth**radialCount,firstStep=(R-r)*(growth-1)/(power-1);
  if(!Number.isFinite(power)||firstStep<1e-10*R)throw new RangeError("radial bias produces numerically unresolved tiny intervals");
  const radii=Array.from({length:radialCount+1},(_,i)=>i===radialCount?R:r+firstStep*(growth**i-1)/(growth-1));
  const base:Mesh={kind:"Q1",nodes:[],elements:[]},fine:Mesh={kind:"Q1",nodes:[],elements:[]};
  const parents:number[]=[],coreParentIds:number[]=[];
  const transition=refineQ1To4Q1([[1,0],[0,0],[0,1],[1,1]]);
  const coreMap=(region:string,u:number,v:number):Point=>{
    return circularCorePoint(r,.5*r,.42*r,region==="D"?"center":region==="B"?"y-wing":"x-wing",u,v);
  };
  const add=(mesh:Mesh,vertices:readonly Point[],sx:number,sy:number)=>{
    const offset=mesh.nodes.length;
    mesh.nodes.push(...vertices.map(p=>[sx*p[0]!,sy*p[1]!,0]));
    mesh.elements.push((sx*sy<0?[1,4,3,2]:[1,2,3,4]).map(i=>i+offset));
    return mesh.elements.length;
  };
  for(const sx of xSigns)for(const sy of ySigns){
    for(const region of ["D","B","C"]){
      const registry=new Map<string,number>();
      const coarseGrid=createQ1UnitSquareMesh(nc,nc);
      for(const e of coarseGrid.elements){
        const center=[0,1].map(a=>e.reduce((s,id)=>s+coarseGrid.nodes[id-1]![a]!/4,0));
        const key=`${Math.floor(center[0]!*nc)}:${Math.floor(center[1]!*nc)}`;
        const parent=add(base,e.map(id=>{const p=coarseGrid.nodes[id-1]!;return coreMap(region,p[0]!,p[1]!);}),sx,sy);
        registry.set(key,parent);coreParentIds.push(parent);
      }
      const grid=createQ1UnitSquareMesh(n,n);
      for(const e of grid.elements){
        const center=[0,1].map(a=>e.reduce((s,id)=>s+grid.nodes[id-1]![a]!/4,0));
        const key=`${Math.floor(center[0]!*nc)}:${Math.floor(center[1]!*nc)}`;
        add(fine,e.map(id=>{const p=grid.nodes[id-1]!;return coreMap(region,p[0]!,p[1]!);}),sx,sy);
        const parent=registry.get(key);if(parent===undefined)throw new Error("circular-quad lineage is incomplete");parents.push(parent);
      }
    }
    for(let i=0;i<radialCount;i++)for(let j=0;j<angularCount;j++){
      const vertices=[polar(radii[i]!,j/angularCount),polar(radii[i+1]!,j/angularCount),
        polar(radii[i+1]!,(j+1)/angularCount),polar(radii[i]!,(j+1)/angularCount)];
      const parent=add(base,vertices,sx,sy);
      if(i>0){add(fine,vertices,sx,sy);parents.push(parent);continue;}
      const nodes=transition.nodes.map(p=>polar(radii[0]!+p[1]!*(radii[1]!-radii[0]!),(j+p[0]!)/angularCount));
      for(const e of transition.elements){add(fine,e.map(id=>nodes[id-1]!),sx,sy);parents.push(parent);}
    }
  }
  const tolerance=Math.min(r/n,firstStep)*1e-8;
  const mesh=mergeCoincidentNodes(fine,tolerance),baseMesh=mergeCoincidentNodes(base,tolerance);
  const counts=new Map<number,number>();parents.forEach(p=>counts.set(p,(counts.get(p)??0)+1));
  if(coreParentIds.some(p=>counts.get(p)!==9)||counts.size!==baseMesh.elements.length)throw new Error("circular-quad core refinement is incorrect");
  if(!checkNoHangingNodes(mesh,tolerance*10).ok)throw new Error("circular-quad interfaces are not conforming");
  const expected=.5*R*R*angularCount*Math.sin(Math.PI/(2*angularCount))*copies;
  const boundary=(ns:number[])=>{
    const points=ns.map(n=>mesh.nodes[n-1]!);
    return points.every(p=>Math.abs(Math.hypot(p[0]!,p[1]!)-R)<tolerance*10)
      ||(spec.modelFraction!=="full"&&points.every(p=>Math.abs(p[1]!)<tolerance*10))
      ||(spec.modelFraction==="quarter"&&points.every(p=>Math.abs(p[0]!)<tolerance*10));
  };
  const quality=auditPlanarQuadMesh(mesh,expected,boundary);
  const analytic=Math.PI*R*R*copies/4;
  const nodeSets={plane_x0:mesh.nodes.flatMap((p,i)=>Math.abs(p[0]!)<tolerance?[i+1]:[]),
    plane_y0:mesh.nodes.flatMap((p,i)=>Math.abs(p[1]!)<tolerance?[i+1]:[])};
  return {mesh,baseMesh,parentElementIds:parents,coreParentIds,nodeSets,
    plan:{fineCount:count,coreAxisCount:n,radialCount,angularIntervalsPerQuadrant:angularCount,radialGrowth:growth,radialLevels:radii,
      geometryResampling:true,sourceNodeConstraintFlagsCopied:false,
      warnings:["Geometry only: source NODE TC/RC symmetry flags are not copied; plane node sets are provided separately."]},
    quality:{...quality,relativeAnalyticAreaError:Math.abs(quality.area-analytic)/analytic,
      warnings:quality.minimumCornerScaledJacobian<.2?["Low scaled Jacobian requires engineering review."]:[]}};
}
