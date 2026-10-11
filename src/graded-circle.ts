import type {Mesh} from "./types.js";
import type {ModelFraction,TransitionReduction} from "./graded-rectangle-plan.js";
import {createHexUnitCubeMesh} from "./grid.js";
import {mergeCoincidentNodes} from "./mesh.js";
import {directionalThirdPass} from "./directional-third-internal.js";
import {applyMarkedHalfSweep} from "./two-to-one-sweep.js";
import {checkNoHangingNodes} from "./conformance.js";
import {H1_FACES} from "./topology.js";
import {hexElementSignedVolume,minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {hexJacobian} from "./hex-quality-internal.js";

export interface CircularGradingSpec {
  radius: number;
  thickness: number;
  coreHalfSize: number;
  fineSize: number;
  coarseSize: number;
  reductions: {x:TransitionReduction;y:TransitionReduction};
  modelFraction: ModelFraction;
  angleDegrees?: number;
}

/** Circular solid with fixed outer boundary; the recovered branch uses Z ratio 3. */
export function generateCircularGradedMesh(spec: CircularGradingSpec) {
  const allowed=new Set(["radius","thickness","coreHalfSize","fineSize","coarseSize","reductions","modelFraction","angleDegrees"]);
  const unknown=Object.keys(spec).filter(key=>!allowed.has(key));
  if(unknown.length)throw new RangeError(`unsupported circular options: ${unknown.join(", ")}`);
  for (const value of [spec.radius,spec.thickness,spec.coreHalfSize,spec.fineSize,spec.coarseSize]) {
    if (!(Number.isFinite(value) && value>0)) throw new RangeError("circular dimensions must be finite and positive");
  }
  const angle=spec.angleDegrees??0;
  if(!Number.isFinite(angle)||Math.abs(angle)>=90)throw new RangeError("circular angleDegrees must be finite and strictly between -90 and 90");
  if (!["quarter","half","full"].includes(spec.modelFraction)) throw new RangeError("invalid circular modelFraction");
  if(angle!==0&&spec.modelFraction==="quarter")throw new RangeError("tilted quarter-circle cut geometry is not defined by the recovered source; use half or full");
  const rx=spec.reductions?.x,ry=spec.reductions?.y;
  if (![2,3].includes(rx) || ![2,3].includes(ry)) throw new RangeError("circular X/Y reductions must be 2 or 3");
  if(Object.keys(spec.reductions).some(key=>key!=="x" && key!=="y"))throw new RangeError("circular thickness reduction is fixed at 3");
  const {radius:R,thickness:H,coreHalfSize:d}=spec;
  const offset=H*Math.tan(angle*Math.PI/180);
  if ((d+spec.coarseSize)**2+d*d>=R*R) throw new RangeError("circular transition band does not fit inside the radius");
  if((d+spec.coarseSize+Math.abs(offset)/2)**2+d*d>=R*R)throw new RangeError("circular tilt leaves insufficient room for the transition band");
  const requestedRadial=(R-d)/spec.coarseSize,radial=Math.round(requestedRadial);
  if (!Number.isSafeInteger(radial) || Math.abs(requestedRadial-radial)>1e-10 || radial<2) {
    throw new RangeError("circular outer width requires at least two integral coarse intervals");
  }
  const aligned=(extent:number,ratio:number)=>{
    const initial=Math.round(extent/spec.fineSize),multiple=ratio===2 ? 4:3;
    const count=Math.ceil(initial/multiple)*multiple;
    if (initial<1 || !Number.isSafeInteger(count)) throw new RangeError("invalid circular fine count");
    return count;
  };
  const fineCounts=[aligned(d,rx),aligned(d,ry),aligned(H,3)];
  const [nx,ny,nz]=[fineCounts[0]!/rx,fineCounts[1]!/ry,fineCounts[2]!/3];
  const xSigns=spec.modelFraction==="quarter" ? [1]:[1,-1];
  const ySigns=spec.modelFraction==="full" ? [1,-1]:[1];
  const baseCount=(nx*ny+radial*nx+radial*ny)*nz*xSigns.length*ySigns.length;
  if (!Number.isSafeInteger(baseCount) || baseCount*rx*ry*3>2000000) throw new RangeError("circular mesh exceeds the experimental allocation limit");
  const assembled:Mesh={kind:"H1",nodes:[],elements:[]};
  const coreParentIds:number[]=[];
  for (const sx of xSigns) for (const sy of ySigns) for (const region of ["D","B","C"]) {
    const grid=createHexUnitCubeMesh(region==="C" ? radial:nx,region==="B" ? radial:ny,nz);
    const nodes=grid.nodes.map(([u,v,w])=>{
      if (region==="D") return [sx*d*u!,sy*d*v!,H*w!];
      const angular=region==="B" ? u!:v!,r=region==="B" ? v!:u!;
      const a=R*Math.sin(Math.PI/4*angular),b=R*Math.cos(Math.PI/4*angular);
      const x=d*angular*(1-r)+a*r,y=d*(1-r)+b*r;
      return region==="B" ? [sx*x,sy*y,H*w!]:[sx*y,sy*x,H*w!];
    });
    const offset=assembled.nodes.length,flip=[1,0,3,2,5,4,7,6];
    const cells=grid.elements.map(e=>(sx*sy<0 ? flip.map(i=>e[i]!):e).map(n=>n+offset));
    if (region==="D") coreParentIds.push(...cells.map((_,i)=>assembled.elements.length+i+1));
    assembled.nodes.push(...nodes);assembled.elements.push(...cells);
  }
  // These blocks form one connected body; never use this merge policy across physical layers.
  const tolerance=Math.min(d/nx,d/ny,H/nz,spec.coarseSize)*1e-8;
  const baseMesh=mergeCoincidentNodes(assembled,tolerance);
  const core=new Set(coreParentIds);
  let current={mesh:baseMesh,lineage:baseMesh.elements.map((_,i)=>i+1)};
  for (const axis of [1,0] as const) {
    if ([rx,ry][axis]!==2) continue;
    const ids=new Set(current.mesh.elements.filter((_,i)=>core.has(current.lineage[i]!)).flat());
    const lower=axis===0 ? (spec.modelFraction==="quarter"?0:-d):(spec.modelFraction==="full"?-d:0);
    const step=d/[nx,ny][axis]!;
    const marks=[...ids].filter(n=>{
      const index=(current.mesh.nodes[n-1]![axis]!-lower)/step;
      return Math.abs(index-Math.round(index))<1e-7 && Math.round(index)%2===1;
    });
    const pass=applyMarkedHalfSweep(current.mesh,marks,tolerance);
    const lineage=new Array<number>(pass.mesh.elements.length);
    pass.parentToChildren.forEach((children,p)=>children.forEach(c=>lineage[c]=current.lineage[p]!));
    current={mesh:pass.mesh,lineage};
  }
  for (const axis of [0,1,2] as const) {
    if ([rx,ry,3][axis]===3) current=directionalThirdPass(current.mesh,current.lineage,core,axis,tolerance);
  }
  const children=new Map<number,number[]>();
  current.lineage.forEach((p,i)=>{const ids=children.get(p)??[];ids.push(i);children.set(p,ids);});
  const coreNodes=new Set(coreParentIds.flatMap(p=>baseMesh.elements[p-1]!));
  for (const [p,ids] of children) {
    if (ids.length>1 && !baseMesh.elements[p-1]!.some(n=>coreNodes.has(n))) throw new Error("circular refinement changed the far field");
    if (!core.has(p)) continue;
    if (ids.length!==rx*ry*3) throw new Error("circular core child count is incorrect");
    const vertices=baseMesh.elements[p-1]!.map(n=>baseMesh.nodes[n-1]!);
    const low=[0,1,2].map(a=>Math.min(...vertices.map(v=>v[a]!)));
    const high=[0,1,2].map(a=>Math.max(...vertices.map(v=>v[a]!)));
    for(const i of ids)for(const n of current.mesh.elements[i]!)for(const a of [0,1,2] as const){
      const t=(current.mesh.nodes[n-1]![a]!-low[a]!)/(high[a]!-low[a]!)*[rx,ry,3][a]!;
      if(Math.abs(t-Math.round(t))>1e-6 || t< -1e-6 || t>[rx,ry,3][a]!+1e-6)throw new Error("circular core is not tensor refined");
    }
  }
  if (children.size!==baseMesh.elements.length) throw new Error("circular refinement lost original parents");
  if(angle!==0){
    // Keep the zero-angle topology. The core undergoes affine shear, tapering to
    // zero displacement on the fixed circle; this is not a rigid rotation.
    const map=(p:readonly number[])=>{
      const m=Math.max(Math.abs(p[0]!),Math.abs(p[1]!)),r=Math.hypot(p[0]!,p[1]!);
      const weight=m<=d?1:Math.max(0,Math.min(1,(R-r)/(R-r*d/m)));
      return [p[0]!+offset*(p[2]!/H-.5)*weight,p[1]!,p[2]!];
    };
    current.mesh={...current.mesh,nodes:current.mesh.nodes.map(map)};
    baseMesh.nodes=baseMesh.nodes.map(map);
  }
  if (!checkNoHangingNodes(current.mesh,tolerance*10).ok) throw new Error("circular output is not conforming");
  const quality=auditCircularMesh(current.mesh,baseMesh,spec,tolerance*10);
  return {mesh:current.mesh,baseMesh,parentElementIds:current.lineage,coreParentIds,
    plan:{fineCounts,fineSpacing:[d/fineCounts[0]!,d/fineCounts[1]!,H/fineCounts[2]!],radialCount:radial,
      effectiveReductions:[rx,ry,3],modelFraction:spec.modelFraction,
      angleDegrees:angle,offset,
      mapping:angle===0?"equal-angle circular boundary with transfinite radial interpolation":"affine core shear with radially tapered displacement to the fixed circular boundary",
      warnings:spec.modelFraction==="quarter" ? ["Native quarter geometry is a quarter disk; recovered GUI vi=1 emits a half disk."]:[]},quality};
}

function auditCircularMesh(mesh:Mesh,base:Mesh,spec:CircularGradingSpec,tolerance:number) {
  let volume=0,minSJ=Infinity,minGauss=Infinity;
  const faces=new Map<string,{nodes:number[];count:number}>(),cells=new Set<string>();
  for (const e of mesh.elements) {
    if (new Set(e).size!==8) throw new Error("circular output has degenerate connectivity");
    const cellKey=[...e].sort((a,b)=>a-b).join(":");
    if(cells.has(cellKey))throw new Error("circular output has duplicate cells");cells.add(cellKey);
    const v=e.map(n=>mesh.nodes[n-1]!);
    volume+=hexElementSignedVolume(v);minSJ=Math.min(minSJ,minimumHexCornerScaledJacobian(v));
    for(const u of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const s of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const t of [-1/Math.sqrt(3),1/Math.sqrt(3)]){
      const [a,b,c]=hexJacobian(v,u,s,t);
      minGauss=Math.min(minGauss,a[0]!*(b[1]!*c[2]!-b[2]!*c[1]!)-a[1]!*(b[0]!*c[2]!-b[2]!*c[0]!)+a[2]!*(b[0]!*c[1]!-b[1]!*c[0]!));
    }
    for(const f of H1_FACES){const ns=f.map(n=>e[n-1]!);const key=[...ns].sort((a,b)=>a-b).join(":");const record=faces.get(key)??{nodes:ns,count:0};record.count++;faces.set(key,record);}
  }
  let externalFaces=0,radialBoundaryError=0;
  for(const f of faces.values()){
    if(f.count>2)throw new Error("circular output has a nonmanifold face");
    if(f.count!==1)continue;
    const v=f.nodes.map(n=>mesh.nodes[n-1]!);
    const radial=v.map(p=>Math.abs(Math.hypot(p[0]!,p[1]!)-spec.radius));
    const cylinder=radial.every(d=>d<tolerance);
    const plane=[0,spec.thickness].some(z=>v.every(p=>Math.abs(p[2]!-z)<tolerance))
      || (spec.modelFraction!=="full" && v.every(p=>Math.abs(p[1]!)<tolerance))
      || (spec.modelFraction==="quarter" && v.every(p=>Math.abs(p[0]!)<tolerance));
    if(!cylinder && !plane)throw new Error("circular output has an unexpected internal free face");
    if(cylinder)radialBoundaryError=Math.max(radialBoundaryError,...radial);
    externalFaces++;
  }
  const expected=base.elements.reduce((sum,e)=>sum+hexElementSignedVolume(e.map(n=>base.nodes[n-1]!)),0);
  const relativeDiscreteVolumeError=Math.abs(volume-expected)/expected;
  const divisor={quarter:4,half:2,full:1}[spec.modelFraction];
  const analytic=Math.PI*spec.radius**2*spec.thickness/divisor;
  if(!(minSJ>0 && minGauss>0 && expected>0 && relativeDiscreteVolumeError<1e-8))throw new Error("circular quality audit failed");
  return {minimumCornerScaledJacobian:minSJ,minimumGaussDeterminant:minGauss,volume,relativeDiscreteVolumeError,
    relativeAnalyticVolumeError:Math.abs(volume-analytic)/analytic,radialBoundaryError,externalFaces,
    warnings:minSJ<0.2?["Minimum corner scaled Jacobian is below 0.2; engineering quality review is required."]:[]};
}
