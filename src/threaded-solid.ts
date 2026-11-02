import type {Mesh,Point} from "./types.js";
import {generateMappedCircularCore,planMappedCircularCore} from "./mapped-circular-core.js";
import {hexElementSignedVolume,minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {hexJacobian} from "./hex-quality-internal.js";

const MAX_ELEMENTS=200000;
const TAU=2*Math.PI;

/** Generic truncated-V geometry, not a certified ISO thread fit. All lengths use one unit. */
export interface HelicalThreadProfile {
  rootRadius:number;
  majorRadius:number;
  pitch:number;
  handedness:"right"|"left";
  crestFraction?:number;
  rootFraction?:number;
  phaseTurns?:number;
}
interface ThreadedSolidOptions {
  profile:HelicalThreadProfile;
  length:number;
  stepsPerTurn:number;
  minimumCornerScaledJacobian?:number;
  elementLimit?:number;
}
export interface ThreadedShaftSpec extends ThreadedSolidOptions {
  coreRadius:number;
  radiusSegments:number;
  arcSegments:number;
  surfaceLayers:number;
}
export interface ThreadedNutSpec extends ThreadedSolidOptions {
  acrossFlats:number;
  clearance:number;
  angularSegments:number;
  radialLayers:number;
}
export interface ThreadedSolidResult {
  mesh:Mesh;
  nodeSets:{bottom:number[];top:number[];thread_surface:number[]};
  quality:{minimumCornerScaledJacobian:number;minimumGaussDeterminant:number;volume:number;
    boundaryIntegratedVolume:number;relativeVolumeError:number;analyticVolume:number;relativeAnalyticVolumeError:number};
  plan:{axialSegments:number;angularSegments:number;expectedElementCount:number;expectedNodeCount:number};
  limitations:string[];
}

function keys(value:object,allowed:string[]) {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new TypeError("thread options must be an object");
  if(Object.keys(value).some(k=>!allowed.includes(k)))throw new RangeError("unsupported thread option");
}
function positive(x:number,name:string){if(!Number.isFinite(x)||x<=0)throw new RangeError(`${name} must be finite and positive`);}
function integer(x:number,name:string){if(!Number.isSafeInteger(x)||x<1)throw new RangeError(`${name} must be a positive safe integer`);}
function profile(p:HelicalThreadProfile) {
  keys(p,["rootRadius","majorRadius","pitch","handedness","crestFraction","rootFraction","phaseTurns"]);
  positive(p.rootRadius,"rootRadius");positive(p.majorRadius,"majorRadius");positive(p.pitch,"pitch");
  if(p.majorRadius<=p.rootRadius)throw new RangeError("majorRadius must exceed rootRadius");
  if(p.handedness!=="right"&&p.handedness!=="left")throw new RangeError("invalid thread handedness");
  const crest=p.crestFraction??.125,root=p.rootFraction??.25,phase=p.phaseTurns??0;
  if(!Number.isFinite(crest)||!Number.isFinite(root)||crest<=0||root<=0||crest+root>=1)throw new RangeError("thread flats must be positive and leave two flanks");
  if(!Number.isFinite(phase)||Math.abs(phase)>1e6)throw new RangeError("phaseTurns must be finite and bounded");
  return {...p,crestFraction:crest,rootFraction:root,phaseTurns:phase};
}
function radius(theta:number,z:number,p:ReturnType<typeof profile>) {
  const turn=z/p.pitch-(p.handedness==="right"?1:-1)*theta/TAU+p.phaseTurns;
  const phase=turn-Math.floor(turn),distance=Math.min(phase,1-phase);
  const rise=(1-p.rootFraction-p.crestFraction)/2;
  const height=Math.max(0,Math.min(1,(distance-p.rootFraction/2)/rise));
  return p.rootRadius+(p.majorRadius-p.rootRadius)*height;
}
/** Surface equation only. No DLL, executable, recovered bytecode or licensing dependency. */
export function helicalThreadRadius(theta:number,z:number,spec:HelicalThreadProfile):number {
  if(!Number.isFinite(theta)||Math.abs(theta)>1e6||!Number.isFinite(z)||Math.abs(z/spec.pitch)>1e6)throw new RangeError("thread evaluation coordinates are outside the bounded domain");
  return radius(theta,z,profile(spec));
}
function options(spec:ThreadedSolidOptions) {
  const p=profile(spec.profile);positive(spec.length,"length");integer(spec.stepsPerTurn,"stepsPerTurn");
  if(spec.stepsPerTurn<8)throw new RangeError("stepsPerTurn must be at least eight to resolve the profile");
  const turns=spec.length/p.pitch;
  if(!Number.isFinite(turns)||turns>1e6)throw new RangeError("thread length/pitch is outside the bounded domain");
  const nz=Math.ceil(turns*spec.stepsPerTurn);
  integer(nz,"axialSegments");
  const floor=spec.minimumCornerScaledJacobian??.15,limit=spec.elementLimit??MAX_ELEMENTS;
  if(!Number.isFinite(floor)||floor<.15||floor>1)throw new RangeError("minimumCornerScaledJacobian must be between 0.15 and 1");
  integer(limit,"elementLimit");if(limit>MAX_ELEMENTS)throw new RangeError("elementLimit exceeds the bounded implementation");
  return {p,nz,floor,limit};
}
function allocation(cells:number,nodes:number,limit:number) {
  if(!Number.isSafeInteger(cells)||!Number.isSafeInteger(nodes)||cells>limit||nodes>2*MAX_ELEMENTS)throw new RangeError("thread mesh allocation exceeds elementLimit or node budget");
}
function polygonArea(ids:readonly number[],points:readonly Point[]) {
  let area=0;
  for(let i=0;i<ids.length;i++){
    const a=points[ids[i]!-1]!,b=points[ids[(i+1)%ids.length]!-1]!;
    area+=(a[0]!*b[1]!-a[1]!*b[0]!)/2;
  }
  return area;
}
function meanSquaredRadius(p:ReturnType<typeof profile>,offset=0) {
  const a=p.rootRadius+offset,b=p.majorRadius+offset;
  return a*a*p.rootFraction+b*b*p.crestFraction+(a*a+a*b+b*b)*(1-p.crestFraction-p.rootFraction)/3;
}
function finish(sections:number[][][],quads:number[][],outer:number[],inner:number[],thread:number[],
  spec:ThreadedSolidOptions,nangle:number,floor:number,analyticVolume:number):ThreadedSolidResult {
  const sectionSize=sections[0]!.length,nz=sections.length-1;
  const mesh:Mesh={kind:"H1",nodes:sections.flat(),elements:[]};
  let sj=Infinity,gauss=Infinity,volume=0,boundaryVolume=0;
  for(let k=0;k<nz;k++){
    const lower=sections[k]!,upper=sections[k+1]!,mid=lower.map((p,i)=>p.map((v,a)=>(v+upper[i]![a]!)/2));
    const area=(nodes:readonly Point[])=>polygonArea(outer,nodes)-(inner.length?polygonArea(inner,nodes):0);
    boundaryVolume+=spec.length/nz*(area(lower)+4*area(mid)+area(upper))/6;
    for(const quad of quads){
      const e=[...quad.map(i=>i+k*sectionSize),...quad.map(i=>i+(k+1)*sectionSize)];
      const points=e.map(i=>mesh.nodes[i-1]!);
      const localSJ=minimumHexCornerScaledJacobian(points);
      if(!Number.isFinite(localSJ)||localSJ<floor)throw new RangeError(`thread element ${mesh.elements.length+1} has corner SJ ${localSJ} below ${floor}; increase resolution or change the blocking`);
      sj=Math.min(sj,localSJ);
      for(const u of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const v of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const w of [-1/Math.sqrt(3),1/Math.sqrt(3)]){
        const [a,b,c]=hexJacobian(points,u,v,w);
        const determinant=a[0]!*(b[1]!*c[2]!-b[2]!*c[1]!)-a[1]!*(b[0]!*c[2]!-b[2]!*c[0]!)+a[2]!*(b[0]!*c[1]!-b[1]!*c[0]!);
        if(!Number.isFinite(determinant)||determinant<=0)throw new RangeError("thread element has nonpositive Gauss Jacobian");
        gauss=Math.min(gauss,determinant);
      }
      volume+=hexElementSignedVolume(points);mesh.elements.push(e);
    }
  }
  const relative=Math.abs(volume-boundaryVolume)/boundaryVolume;
  if(!Number.isFinite(relative)||boundaryVolume<=0||relative>1e-10)throw new Error("thread discrete boundary/element volume mismatch");
  if(!Number.isFinite(analyticVolume)||analyticVolume<=0)throw new RangeError("invalid analytic thread volume");
  return {mesh,nodeSets:{bottom:Array.from({length:sectionSize},(_,i)=>i+1),
    top:Array.from({length:sectionSize},(_,i)=>nz*sectionSize+i+1),
    thread_surface:sections.flatMap((_,k)=>thread.map(i=>i+k*sectionSize))},
    quality:{minimumCornerScaledJacobian:sj,minimumGaussDeterminant:gauss,volume,
      boundaryIntegratedVolume:boundaryVolume,relativeVolumeError:relative,analyticVolume,
      relativeAnalyticVolumeError:Math.abs(volume-analyticVolume)/analyticVolume},
    plan:{axialSegments:nz,angularSegments:nangle,expectedElementCount:quads.length*nz,expectedNodeCount:sectionSize*(nz+1)},
    limitations:["Generic single-start truncated-V geometry, not certified ISO tolerances or contact fit.",
      "Flat-cut ends; no head, runout, chamfer, assembly, transition shell or GUI in this entry point.",
      "Positive corner and Gauss Jacobians are sampled quality checks, not a global injectivity proof."]};
}

/** A solid threaded gauge with a regular, unchanged inner core, not a hollow surrogate. */
export function generateThreadedShaft(spec:ThreadedShaftSpec):ThreadedSolidResult {
  keys(spec,["profile","length","stepsPerTurn","minimumCornerScaledJacobian","elementLimit","coreRadius","radiusSegments","arcSegments","surfaceLayers"]);
  const o=options(spec);positive(spec.coreRadius,"coreRadius");integer(spec.surfaceLayers,"surfaceLayers");
  if(spec.coreRadius>=o.p.rootRadius)throw new RangeError("coreRadius must be below thread rootRadius");
  const coreSpec={radius:spec.coreRadius,radiusSegments:spec.radiusSegments,arcSegments:spec.arcSegments,modelFraction:"full" as const,elementLimit:o.limit};
  const plan=planMappedCircularCore(coreSpec),nangle=spec.arcSegments*4;
  allocation((plan.expectedElementCount+nangle*spec.surfaceLayers)*o.nz,
    (plan.expectedNodeCount+nangle*spec.surfaceLayers)*(o.nz+1),o.limit);
  const core=generateMappedCircularCore(coreSpec),angles=(id:number)=>{
    const p=core.mesh.nodes[id-1]!;const a=Math.atan2(p[1]!,p[0]!);return a<0?a+TAU:a;
  };
  const boundary=[...core.nodeSets.circular_boundary].sort((a,b)=>angles(a)-angles(b));
  const count=core.mesh.nodes.length,quads=core.mesh.elements.map(e=>[...e]);
  const ring=(j:number,i:number)=>j===0?boundary[i]!:count+(j-1)*nangle+i+1;
  for(let j=0;j<spec.surfaceLayers;j++)for(let i=0;i<nangle;i++){
    const next=(i+1)%nangle;quads.push([ring(j,i),ring(j+1,i),ring(j+1,next),ring(j,next)]);
  }
  const sections=Array.from({length:o.nz+1},(_,k)=>{
    const z=spec.length*k/o.nz,nodes=core.mesh.nodes.map(p=>[p[0]!,p[1]!,z]);
    for(let j=1;j<=spec.surfaceLayers;j++)for(const id of boundary){
      const theta=angles(id),r=spec.coreRadius+(radius(theta,z,o.p)-spec.coreRadius)*j/spec.surfaceLayers;
      nodes.push([r*Math.cos(theta),r*Math.sin(theta),z]);
    }
    return nodes;
  });
  const outer=Array.from({length:nangle},(_,i)=>ring(spec.surfaceLayers,i));
  return finish(sections,quads,outer,[],outer,spec,nangle,o.floor,Math.PI*meanSquaredRadius(o.p)*spec.length);
}

/** Hexagonal exterior and a helical bore. Clearance is geometric, not a fit class. */
export function generateThreadedNut(spec:ThreadedNutSpec):ThreadedSolidResult {
  keys(spec,["profile","length","stepsPerTurn","minimumCornerScaledJacobian","elementLimit","acrossFlats","clearance","angularSegments","radialLayers"]);
  const o=options(spec);positive(spec.acrossFlats,"acrossFlats");integer(spec.angularSegments,"angularSegments");integer(spec.radialLayers,"radialLayers");
  if(!Number.isFinite(spec.clearance)||spec.clearance<0)throw new RangeError("clearance must be finite and nonnegative");
  if(spec.acrossFlats/2<=o.p.majorRadius+spec.clearance)throw new RangeError("thread bore must remain inside the hexagonal exterior");
  const n=spec.angularSegments;
  if(n<12||n%12!==0)throw new RangeError("angularSegments must be a multiple of twelve to align hexagon vertices");
  allocation(n*spec.radialLayers*o.nz,n*(spec.radialLayers+1)*(o.nz+1),o.limit);
  const ring=(j:number,i:number)=>j*n+i+1,quads:number[][]=[];
  for(let j=0;j<spec.radialLayers;j++)for(let i=0;i<n;i++){
    const next=(i+1)%n;quads.push([ring(j,i),ring(j+1,i),ring(j+1,next),ring(j,next)]);
  }
  const sections=Array.from({length:o.nz+1},(_,k)=>{
    const z=spec.length*k/o.nz,nodes:number[][]=[];
    for(let j=0;j<=spec.radialLayers;j++)for(let i=0;i<n;i++){
      const theta=TAU*i/n,a=(theta+Math.PI/6)%(Math.PI/3)-Math.PI/6;
      const inner=radius(theta,z,o.p)+spec.clearance,outer=spec.acrossFlats/(2*Math.cos(a));
      const r=j===spec.radialLayers?outer:inner+(outer-inner)*j/spec.radialLayers;
      nodes.push([r*Math.cos(theta),r*Math.sin(theta),z]);
    }
    return nodes;
  });
  const inner=Array.from({length:n},(_,i)=>ring(0,i)),outer=Array.from({length:n},(_,i)=>ring(spec.radialLayers,i));
  const area=Math.sqrt(3)*spec.acrossFlats**2/2-Math.PI*meanSquaredRadius(o.p,spec.clearance);
  return finish(sections,quads,outer,inner,inner,spec,n,o.floor,area*spec.length);
}
