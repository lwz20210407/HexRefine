import type {Mesh,Point} from "./types.js";
import {generatePlanarTransitionBand,planTransitionBand,type TransitionBandSchedule} from "./transition-bands.js";
import {hexElementSignedVolume,minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {hexJacobian} from "./hex-quality-internal.js";
import {determinant3Scaled,materializeScaledValue} from "./hex-numeric-internal.js";
import {checkNoHangingNodes} from "./conformance.js";
import {minElementEdgeLength} from "./mesh.js";
import {requireTransitionAngularSeams,type TransitionAngularSeamOptions} from "./transition-angular-seams.js";

export interface AxialTransitionTubeSpec extends Omit<TransitionBandSchedule,"depth">,TransitionAngularSeamOptions {
  innerRadius:number;outerRadius:number;length:number;radialLayers:number;
  fineEnd?:"start"|"end";startAngleDegrees?:number;sweepAngleDegrees?:number;
  origin?:readonly [number,number,number];axis?:readonly [number,number,number];
}
const FACES=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[1,2,6,5],[0,4,7,3]];
const cross=(a:readonly number[],b:readonly number[])=>[a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!];
const dot=(a:readonly number[],b:readonly number[])=>a.reduce((s,v,i)=>s+v*b[i]!,0);
function unit(value:readonly number[]) {
  if(!Array.isArray(value)||value.length!==3||value.some(v=>!Number.isFinite(v)))throw new RangeError("axis needs three finite components");
  const scale=Math.max(...value.map(Math.abs));if(!(scale>0))throw new RangeError("axis must be nonzero");
  const scaled=value.map(v=>v/scale),length=Math.hypot(...scaled);return scaled.map(v=>v/length);
}
function surfaceVolume(mesh:Mesh,boundarySets:Set<number>[]) {
  const faces=new Map<string,{ids:number[];count:number}>();
  for(const e of mesh.elements)for(const f of FACES){
    const ids=f.map(i=>e[i]!),key=[...ids].sort((a,b)=>a-b).join(":");
    const entry=faces.get(key)??{ids,count:0};entry.count++;faces.set(key,entry);
    if(entry.count>2)throw new Error("nonmanifold axial tube face");
  }
  const reference=mesh.nodes[0]!,signs=[[-1,-1],[1,-1],[1,1],[-1,1]],g=[-1/Math.sqrt(3),1/Math.sqrt(3)];
  let volume=0,boundaryFaces=0;
  for(const {ids,count} of faces.values()){
    if(count!==1)continue;boundaryFaces++;
    if(!boundarySets.some(set=>ids.every(i=>set.has(i))))throw new Error("unexpected axial tube free face");
    const points=ids.map(i=>mesh.nodes[i-1]!.map((v,a)=>v-reference[a]!));
    for(const u of g)for(const v of g){
      const x=[0,0,0],du=[0,0,0],dv=[0,0,0];
      for(let i=0;i<4;i++)for(let a=0;a<3;a++){
        const s=signs[i]!,p=points[i]![a]!;
        x[a]!+=p*(1+s[0]!*u)*(1+s[1]!*v)/4;
        du[a]!+=p*s[0]!*(1+s[1]!*v)/4;dv[a]!+=p*s[1]!*(1+s[0]!*u)/4;
      }
      volume+=dot(x,cross(du,dv))/3;
    }
  }
  return {volume,boundaryFaces};
}

/** Map an angular/axial transition strip through the wall of a hollow cylinder. */
export function generateAxialTransitionTube(spec:AxialTransitionTubeSpec) {
  if(Object.keys(spec).some(k=>!["innerRadius","outerRadius","length","radialLayers","fineSegments","ratios","stageDepths",
    "fineEnd","startAngleDegrees","sweepAngleDegrees","origin","axis","seamAnglesDegrees"].includes(k)))throw new RangeError("unsupported axial tube option");
  if([spec.innerRadius,spec.outerRadius,spec.length].some(v=>!Number.isFinite(v)||v<=0)||spec.outerRadius<=spec.innerRadius)
    throw new RangeError("axial tube needs positive length and ordered positive radii");
  if(!Number.isSafeInteger(spec.radialLayers)||spec.radialLayers<1||spec.radialLayers>1000)throw new RangeError("invalid radial layer count");
  const fineEnd=spec.fineEnd??"start",sweep=spec.sweepAngleDegrees??360,start=spec.startAngleDegrees??0;
  if(!["start","end"].includes(fineEnd)||!Number.isFinite(sweep)||sweep<=0||sweep>360||!Number.isFinite(start))throw new RangeError("invalid axial end or angles");
  const schedule={fineSegments:spec.fineSegments,ratios:spec.ratios,depth:spec.length,
    ...(spec.stageDepths!==undefined?{stageDepths:spec.stageDepths}:{})};
  const plan=planTransitionBand(schedule);
  const seamAlignment=requireTransitionAngularSeams(plan,spec);
  if(sweep/plan.counts.at(-1)!>90)throw new RangeError("coarse angular intervals must not exceed 90 degrees");
  const expectedCells=plan.ratios.reduce((sum,r,i)=>sum+plan.counts[i]!*(r===2?1.5:4/3),0)*spec.radialLayers;
  if(expectedCells>1000000)throw new RangeError("axial tube exceeds one million hexes");
  const origin=spec.origin??[0,0,0];
  if(!Array.isArray(origin)||origin.length!==3||origin.some(v=>!Number.isFinite(v)))throw new RangeError("invalid axial tube origin");
  const axis=unit(spec.axis??[0,0,1]),seed=Math.abs(axis[0]!)<.9?[1,0,0]:[0,1,0],projection=dot(seed,axis);
  const radial=unit(seed.map((v,a)=>v-projection*axis[a]!)),tangent=cross(axis,radial);
  const angle=sweep*Math.PI/180,arc=(spec.innerRadius+(spec.outerRadius-spec.innerRadius)/2)*angle;
  const strip=generatePlanarTransitionBand({...schedule,length:arc,fineSide:fineEnd==="start"?"bottom":"top"});
  const alias=new Map<number,number>(),closed=sweep===360;
  if(closed){
    const first=new Set(strip.nodeSets.start),last=new Set(strip.nodeSets.end);
    for(let i=0;i<=plan.stageCount;i++){
      const level=strip.nodeSets[`interface_${i}`]!,a=level.filter(n=>first.has(n)),b=level.filter(n=>last.has(n));
      if(a.length!==1||b.length!==1)throw new Error("axial seam phase is ambiguous");alias.set(b[0]!,a[0]!);
    }
    if(alias.size!==last.size||alias.size!==first.size)throw new Error("axial seam contains unsupported side subdivisions");
  }
  const base:Point[]=[],byRoot=new Map<number,number>(),local=strip.mesh.nodes.map((_,i)=>{
    const root=alias.get(i+1)??i+1;
    if(!byRoot.has(root)){base.push(strip.mesh.nodes[root-1]!);byRoot.set(root,base.length);}return byRoot.get(root)!;
  });
  const n=base.length;
  if(n*(spec.radialLayers+1)>2000000)throw new RangeError("axial tube exceeds node allocation limit");
  const nodes:Point[]=[],elements:number[][]=[],stageIds:number[]=[];
  for(let k=0;k<=spec.radialLayers;k++){
    const radius=spec.innerRadius+(spec.outerRadius-spec.innerRadius)*(k/spec.radialLayers);
    for(const p of base){
      const theta=(start%360)*Math.PI/180+p[0]!/arc*angle;
      const q=origin.map((v,a)=>v+radius*(Math.cos(theta)*radial[a]!+Math.sin(theta)*tangent[a]!)+p[1]!*axis[a]!);
      if(q.some(v=>!Number.isFinite(v)))throw new Error("axial tube coordinates overflow");nodes.push(q);
    }
  }
  for(let k=0;k<spec.radialLayers;k++)for(const [i,cell] of strip.mesh.elements.entries()){
    const q=cell.map(id=>local[id-1]!);elements.push([...q.map(id=>id+k*n),...q.map(id=>id+(k+1)*n)]);stageIds.push(strip.stageIds[i]!);
  }
  const nodeSets:Record<string,number[]>={inner:Array.from({length:n},(_,i)=>i+1),outer:Array.from({length:n},(_,i)=>i+1+spec.radialLayers*n)};
  const throughWall=(ids:readonly number[])=>[...new Set(Array.from({length:spec.radialLayers+1},(_,k)=>ids.map(i=>local[i-1]!+k*n)).flat())];
  nodeSets.fine=throughWall(strip.nodeSets.fine!);nodeSets.coarse=throughWall(strip.nodeSets.coarse!);
  nodeSets.axis_start=fineEnd==="start"?nodeSets.fine:nodeSets.coarse;nodeSets.axis_end=fineEnd==="end"?nodeSets.fine:nodeSets.coarse;
  nodeSets.sector_start=closed?[]:throughWall(strip.nodeSets.start!);nodeSets.sector_end=closed?[]:throughWall(strip.nodeSets.end!);
  for(let i=0;i<=plan.stageCount;i++)nodeSets[`interface_${i}`]=throughWall(strip.nodeSets[`interface_${i}`]!);
  const mesh:Mesh={kind:"H1",nodes,elements};
  let volume=0,minSJ=Infinity,minGauss=Infinity;
  for(const cell of elements){
    if(new Set(cell).size!==8)throw new Error("axial seam creates degenerate hexes");
    const p=cell.map(i=>nodes[i-1]!);volume+=hexElementSignedVolume(p);minSJ=Math.min(minSJ,minimumHexCornerScaledJacobian(p));
    for(const x of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const y of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const z of [-1/Math.sqrt(3),1/Math.sqrt(3)])
      minGauss=Math.min(minGauss,materializeScaledValue(determinant3Scaled(hexJacobian(p,x,y,z))));
  }
  const boundary=surfaceVolume(mesh,["inner","outer","axis_start","axis_end","sector_start","sector_end"].map(k=>new Set(nodeSets[k]!)));
  const error=Math.abs(volume-boundary.volume)/volume;
  if(!(minSJ>0&&minGauss>0&&Number.isFinite(volume)&&volume>0&&error<1e-8))throw new Error("axial tube Jacobian or boundary-volume audit failed");
  if(!checkNoHangingNodes(mesh,minElementEdgeLength(mesh)*1e-8).ok)throw new Error("axial tube has hanging interfaces");
  const analyticVolume=angle/2*(spec.outerRadius-spec.innerRadius)*(spec.outerRadius+spec.innerRadius)*spec.length;
  return {mesh,nodeSets,stageIds,plan:{...plan,mode:"axial" as const,closed,fineEnd,axis,origin:[...origin],radialLayers:spec.radialLayers,length:spec.length,seamAlignment},
    quality:{volume,discreteBoundaryVolume:boundary.volume,relativeVolumeError:error,minimumCornerScaledJacobian:minSJ,minimumGaussDeterminant:minGauss,
      analyticVolume,relativeAnalyticVolumeError:Math.abs(volume-analyticVolume)/analyticVolume,boundaryFaces:boundary.boundaryFaces,
      warnings:minSJ<.2?["Low axial-tube SJ requires engineering review."]:[]}};
}
