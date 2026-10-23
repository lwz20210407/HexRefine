import type {Mesh,Point} from "./types.js";
import type {ModelFraction} from "./graded-rectangle-plan.js";
import {circularCorePoint,type CircularCorePatch} from "./circular-core-map-internal.js";
import {auditPlanarQuadMesh} from "./graded-quad.js";
import {checkNoHangingNodes} from "./conformance.js";

const MAX_ELEMENTS=2000000;
const SECTION_KEYS=["radius","radiusSegments","arcSegments","modelFraction","innerCornerFraction","elementLimit"];

export interface MappedCircularCoreSpec {
  radius:number;
  /** Segments on each complete quarter-model radius, not on a patch edge. */
  radiusSegments:number;
  /** Segments on the complete 90-degree arc; defaults to radiusSegments. */
  arcSegments?:number;
  modelFraction:ModelFraction;
  /** Coordinate of the symmetric internal patch join, divided by radius. */
  innerCornerFraction?:number;
  elementLimit?:number;
}

export interface MappedCircularCorePlan {
  radius:number;
  radiusSegments:number;
  arcSegments:number;
  modelFraction:ModelFraction;
  centerSegments:number;
  wingRadialSegments:number;
  axisExtent:number;
  innerCornerFraction:number;
  expectedNodeCount:number;
  expectedElementCount:number;
  discreteArea:number;
  analyticArea:number;
  radiusEdgeSpacing:number;
  arcEdgeChord:number;
  elementLimit:number;
}

export interface MappedCircularCoreQuality {
  area:number;
  relativeAreaError:number;
  relativeAnalyticAreaError:number;
  minimumCornerScaledJacobian:number;
  minimumGaussDeterminant:number;
  boundaryEdges:number;
  minimumAngleDegrees:number;
  maximumAngleDegrees:number;
  minimumEdge:number;
  maximumEdge:number;
  meanElementEdgeLength:number;
  warnings:string[];
}

export interface MappedCircularCoreResult {
  mesh:Mesh;
  plan:MappedCircularCorePlan;
  quality:MappedCircularCoreQuality;
  nodeSets:{plane_x0:number[];plane_y0:number[];circular_boundary:number[]};
  patchElementIds:Record<CircularCorePatch,number[]>;
}

export interface MappedCircularPrismSpec extends MappedCircularCoreSpec {
  height:number;
  axialSegments:number;
}

function objectOptions(value:object,allowed:readonly string[]) {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new TypeError("mapped circular options must be an object");
  if(Object.keys(value).some(k=>!allowed.includes(k)))throw new RangeError("unsupported mapped circular option");
}
function positive(value:number,name:string) {
  if(!Number.isFinite(value)||value<=0)throw new RangeError(`${name} must be finite and positive`);
}
function integer(value:number,name:string) {
  if(!Number.isSafeInteger(value)||value<1)throw new RangeError(`${name} must be a positive safe integer`);
}
function budget(value:number|undefined) {
  const result=value??MAX_ELEMENTS;
  integer(result,"elementLimit");
  if(result>MAX_ELEMENTS)throw new RangeError("elementLimit exceeds the two-million-cell bounded implementation");
  return result;
}

/** Count/geometry validation only: rejects incompatible seeds before allocating. */
export function planMappedCircularCore(spec:MappedCircularCoreSpec):MappedCircularCorePlan {
  objectOptions(spec,SECTION_KEYS);
  positive(spec.radius,"radius");integer(spec.radiusSegments,"radiusSegments");
  const arc=spec.arcSegments??spec.radiusSegments;
  integer(arc,"arcSegments");
  if(arc%2!==0)throw new RangeError("arcSegments must be even to split the diagonal seam");
  if(!["quarter","half","full"].includes(spec.modelFraction))throw new RangeError("invalid mapped circular modelFraction");
  const n=arc/2,m=spec.radiusSegments-n;
  if(m<1)throw new RangeError("radiusSegments must exceed arcSegments/2; each wing needs at least one radial interval");
  const copies=spec.modelFraction==="quarter"?1:spec.modelFraction==="half"?2:4;
  const count=(n*n+2*n*m)*copies,limit=budget(spec.elementLimit);
  if(!Number.isSafeInteger(count)||count>limit)throw new RangeError("mapped circular allocation exceeds elementLimit");
  const quarterNodes=n*n+2*n*m+spec.radiusSegments+n+1;
  const nodes=copies===1?quarterNodes:copies===2?2*quarterNodes-spec.radiusSegments-1:4*quarterNodes-4*(spec.radiusSegments+1)+1;
  if(!Number.isSafeInteger(nodes))throw new RangeError("mapped circular node count is not a safe integer");
  const extent=spec.radius*(n/spec.radiusSegments);
  const fraction=spec.innerCornerFraction??Math.min(.84*extent/spec.radius,.625);
  const join=spec.radius*fraction;
  if(!Number.isFinite(fraction)||!(join>extent/2&&join<extent&&Math.SQRT2*join<spec.radius)) {
    throw new RangeError("innerCornerFraction must give a strictly convex central patch and remain inside the circle");
  }
  const analytic=Math.PI*spec.radius*spec.radius*copies/4;
  const area=.5*spec.radius*spec.radius*arc*Math.sin(Math.PI/(2*arc))*copies;
  positive(analytic,"analytic area");positive(area,"discrete area");
  const radiusEdgeSpacing=spec.radius/spec.radiusSegments,arcEdgeChord=2*spec.radius*Math.sin(Math.PI/(4*arc));
  positive(radiusEdgeSpacing,"radius edge spacing");positive(arcEdgeChord,"arc edge chord");
  return {radius:spec.radius,radiusSegments:spec.radiusSegments,arcSegments:arc,modelFraction:spec.modelFraction,
    centerSegments:n,wingRadialSegments:m,axisExtent:extent,innerCornerFraction:fraction,
    expectedNodeCount:nodes,expectedElementCount:count,discreteArea:area,analyticArea:analytic,
    radiusEdgeSpacing,arcEdgeChord,elementLimit:limit};
}

/** Structured three-patch circular core. No optimization or coordinate welding. */
export function generateMappedCircularCore(spec:MappedCircularCoreSpec):MappedCircularCoreResult {
  const plan=planMappedCircularCore(spec),n=plan.centerSegments,m=plan.wingRadialSegments;
  const quarter:Mesh={kind:"Q1",nodes:[],elements:[]},registry=new Map<string,number>();
  const quarterOuter=new Set<number>(),quarterRoles:CircularCorePatch[]=[];
  const node=(patch:CircularCorePatch,i:number,j:number)=>{
    const nx=patch==="x-wing"?m:n,ny=patch==="y-wing"?m:n;
    let key:string;
    if(patch==="center")key=i===n&&j===n?"join":i===n?`x:${j}`:j===n?`y:${i}`:`center:${i}:${j}`;
    else if(patch==="x-wing")key=i===m?`arc:${j}`:i===0&&j===n?"join":j===n?`diagonal:${i}`:i===0?`x:${j}`:`x-wing:${i}:${j}`;
    else key=j===m?`arc:${2*n-i}`:i===n&&j===0?"join":i===n?`diagonal:${j}`:j===0?`y:${i}`:`y-wing:${i}:${j}`;
    const p=circularCorePoint(plan.radius,plan.axisExtent,plan.innerCornerFraction*plan.radius,patch,i/nx,j/ny);
    const old=registry.get(key);
    if(old!==undefined){
      if(p.some((v,a)=>Math.abs(v-quarter.nodes[old-1]![a]!)>16*Number.EPSILON*plan.radius))throw new Error("incompatible mapped patch seam");
      return old;
    }
    const id=quarter.nodes.length+1;registry.set(key,id);quarter.nodes.push(p);
    if(key.startsWith("arc:"))quarterOuter.add(id);
    return id;
  };
  for(const patch of ["center","x-wing","y-wing"] as const){
    const nx=patch==="x-wing"?m:n,ny=patch==="y-wing"?m:n;
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      quarter.elements.push([node(patch,i,j),node(patch,i+1,j),node(patch,i+1,j+1),node(patch,i,j+1)]);
      quarterRoles.push(patch);
    }
  }
  const mesh:Mesh={kind:"Q1",nodes:[],elements:[]},copies=new Map<string,number>(),outer=new Set<number>();
  const patchElementIds:Record<CircularCorePatch,number[]>={center:[],"x-wing":[],"y-wing":[]};
  const xs=spec.modelFraction==="quarter"?[1]:[1,-1],ys=spec.modelFraction==="full"?[1,-1]:[1];
  for(const sx of xs)for(const sy of ys){
    const ids=quarter.nodes.map((p,i)=>{
      const key=p[0]===0&&p[1]===0?"origin":p[0]===0?`y:${sy}:${i}`:p[1]===0?`x:${sx}:${i}`:`${sx}:${sy}:${i}`;
      let id=copies.get(key);
      if(id===undefined){id=mesh.nodes.length+1;copies.set(key,id);mesh.nodes.push([p[0]===0?0:sx*p[0]!,p[1]===0?0:sy*p[1]!,0]);}
      if(quarterOuter.has(i+1))outer.add(id);return id;
    });
    for(const [i,e] of quarter.elements.entries()){
      mesh.elements.push((sx*sy<0?[e[0]!,e[3]!,e[2]!,e[1]!]:e).map(k=>ids[k-1]!));
      patchElementIds[quarterRoles[i]!]!.push(mesh.elements.length);
    }
  }
  if(mesh.nodes.length!==plan.expectedNodeCount||mesh.elements.length!==plan.expectedElementCount)throw new Error("mapped circle count mismatch");
  const outerSet=new Set(outer),quality=auditPlanarQuadMesh(mesh,plan.discreteArea,ns=>
    ns.every(i=>outerSet.has(i))||(spec.modelFraction!=="full"&&ns.every(i=>mesh.nodes[i-1]![1]===0))
    ||(spec.modelFraction==="quarter"&&ns.every(i=>mesh.nodes[i-1]![0]===0)));
  let minimumEdge=Infinity,maximumEdge=0,sum=0,minimumAngleDegrees=180,maximumAngleDegrees=0;
  for(const e of mesh.elements)for(let i=0;i<4;i++){
    const p=mesh.nodes[e[i]!-1]!,q=mesh.nodes[e[(i+1)%4]!-1]!,r=mesh.nodes[e[(i+3)%4]!-1]!;
    const a=[q[0]!-p[0]!,q[1]!-p[1]!],b=[r[0]!-p[0]!,r[1]!-p[1]!],length=Math.hypot(...a),other=Math.hypot(...b);
    minimumEdge=Math.min(minimumEdge,length);maximumEdge=Math.max(maximumEdge,length);sum+=length;
    const angle=Math.acos(Math.max(-1,Math.min(1,(a[0]!*b[0]!+a[1]!*b[1]!)/(length*other))))*180/Math.PI;
    minimumAngleDegrees=Math.min(minimumAngleDegrees,angle);maximumAngleDegrees=Math.max(maximumAngleDegrees,angle);
  }
  if(!checkNoHangingNodes(mesh,minimumEdge*1e-8).ok)throw new Error("mapped circle has a hanging interface");
  const circularBoundary=[...outer].sort((a,b)=>{
    const angle=(id:number)=>{const p=mesh.nodes[id-1]!;const value=Math.atan2(p[1]!,p[0]!);return value<0?value+2*Math.PI:value;};
    return angle(a)-angle(b);
  });
  const warnings=["Edge sizes are mapped, not constrained to equal the radius-edge target; this is not an engineering quality certification."];
  if(quality.minimumCornerScaledJacobian<.2)warnings.push("Low scaled Jacobian requires engineering review.");
  return {mesh,plan,patchElementIds,nodeSets:{plane_x0:mesh.nodes.flatMap((p,i)=>p[0]===0?[i+1]:[]),
    plane_y0:mesh.nodes.flatMap((p,i)=>p[1]===0?[i+1]:[]),circular_boundary:circularBoundary},
    quality:{...quality,relativeAnalyticAreaError:Math.abs(quality.area-plan.analyticArea)/plan.analyticArea,
      minimumEdge,maximumEdge,meanElementEdgeLength:sum/(4*mesh.elements.length),minimumAngleDegrees,maximumAngleDegrees,warnings}};
}

/** Bounded uniform +Z extrusion of this mapped core, not annular refinement. */
export function generateMappedCircularPrism(spec:MappedCircularPrismSpec) {
  objectOptions(spec,[...SECTION_KEYS,"height","axialSegments"]);
  positive(spec.height,"height");integer(spec.axialSegments,"axialSegments");
  const {height,axialSegments,...sectionSpec}=spec;
  const plan=planMappedCircularCore(sectionSpec);
  const count=plan.expectedElementCount*axialSegments,nodes=plan.expectedNodeCount*(axialSegments+1);
  if(!Number.isSafeInteger(count)||count>plan.elementLimit||!Number.isSafeInteger(nodes))throw new RangeError("mapped prism allocation exceeds elementLimit");
  positive(plan.discreteArea*height,"extruded volume");
  const section=generateMappedCircularCore(sectionSpec),n=section.mesh.nodes.length;
  const levels=Array.from({length:axialSegments+1},(_,k)=>height*(k/axialSegments));
  if(levels.some((z,i)=>i>0&&!(z>levels[i-1]!)))throw new RangeError("axial intervals are numerically unresolved");
  const minimumGaussDeterminant=section.quality.minimumGaussDeterminant*height/(2*axialSegments);
  positive(minimumGaussDeterminant,"extruded Gauss determinant");
  const mesh:Mesh={kind:"H1",nodes:[],elements:[]};
  for(const z of levels)for(const p of section.mesh.nodes)mesh.nodes.push([p[0]!,p[1]!,z]);
  for(let k=0;k<axialSegments;k++)for(const e of section.mesh.elements)mesh.elements.push([...e.map(i=>i+k*n),...e.map(i=>i+(k+1)*n)]);
  const expand=(ids:readonly number[])=>levels.flatMap((_,k)=>ids.map(i=>i+k*n));
  const patchElementIds:Record<CircularCorePatch,number[]>={center:[],"x-wing":[],"y-wing":[]};
  for(const name of ["center","x-wing","y-wing"] as const)patchElementIds[name]=levels.slice(1).flatMap((_,k)=>section.patchElementIds[name].map(i=>i+k*section.mesh.elements.length));
  return {mesh,plan:{...plan,height,axialSegments,expectedNodeCount:nodes,expectedElementCount:count},patchElementIds,
    nodeSets:{plane_x0:expand(section.nodeSets.plane_x0),plane_y0:expand(section.nodeSets.plane_y0),
      outer_cylinder:expand(section.nodeSets.circular_boundary),bottom:Array.from({length:n},(_,i)=>i+1),top:Array.from({length:n},(_,i)=>i+1+axialSegments*n)},
    sectionQuality:section.quality,
    quality:{volume:section.quality.area*height,relativeVolumeError:section.quality.relativeAreaError,
      minimumCornerScaledJacobian:section.quality.minimumCornerScaledJacobian,minimumGaussDeterminant,
      axialSpacing:height/axialSegments,method:"audited planar Q1 section and exact straight-extrusion Jacobian/volume identities" as const,
      warnings:[...section.quality.warnings]}};
}
