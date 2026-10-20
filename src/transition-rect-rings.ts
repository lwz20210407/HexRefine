import type {Mesh,Point} from "./types.js";
import {patchFor,type TransitionBandMesh} from "./transition-bands.js";
import {auditPlanarQuadMesh} from "./graded-quad.js";
import {checkNoHangingNodes} from "./conformance.js";
import {minElementEdgeLength} from "./mesh.js";

export interface RectangularTransitionRingsSpec {
  innerSize:readonly [number,number];
  fineSegments:readonly [number,number];
  stages:number;
  ratio?:2|3;
  rotationDegrees?:number;
  origin?:readonly [number,number];
  includeCore?:boolean;
  optimizeCorners?:boolean;
}
function pair(value:readonly number[],name:string,integer=false) {
  if(!Array.isArray(value)||value.length!==2||value.some(v=>!Number.isFinite(v)||v<=0||(integer&&!Number.isSafeInteger(v))))
    throw new RangeError(`${name} requires two positive ${integer?"integer ":""}values`);
}
export function planRectangularTransitionRings(spec:RectangularTransitionRingsSpec) {
  pair(spec.innerSize,"innerSize");pair(spec.fineSegments,"fineSegments",true);
  const ratio=spec.ratio??2,period=ratio===2?4:3;
  if(ratio!==2&&ratio!==3)throw new RangeError("rectangle ring ratio must be 2 or 3");
  if(spec.fineSegments.some(n=>n%period||n>100000))throw new RangeError(`each fine side count must be a bounded multiple of ${period}`);
  if(!Number.isSafeInteger(spec.stages)||spec.stages<1||spec.stages>8)throw new RangeError("stages must be an integer from 1 to 8");
  if(spec.includeCore!==undefined&&typeof spec.includeCore!=="boolean")throw new RangeError("includeCore must be boolean");
  if(spec.optimizeCorners!==undefined&&typeof spec.optimizeCorners!=="boolean")throw new RangeError("optimizeCorners must be boolean");
  const counts:[number,number][]=[[...spec.fineSegments]],frames=[];
  let half=[spec.fineSegments[0]/2,spec.fineSegments[1]/2],spacing=1,estimated=spec.includeCore?spec.fineSegments[0]*spec.fineSegments[1]:0;
  for(let stage=0;stage<spec.stages;stage++){
    const previous=counts[stage]!,padding=previous.map(n=>{
      for(let p=0;p<period;p++)if((n+2*p)%period===0)return p;
      throw new Error("no legal regular collar count");
    });
    const input=previous.map((n,a)=>n+2*padding[a]!) as [number,number];
    const collar=half.map((h,a)=>h+padding[a]!*spacing);
    const outer=collar.map(h=>h+ratio*spacing),coarse=input.map(n=>n/ratio+2) as [number,number];
    const collarElements=2*padding[0]!*previous[1]+2*padding[1]!*input[0];
    const transitionElements=ratio===2?3*(input[0]+input[1])+12:8*(input[0]+input[1])/3+4;
    estimated+=collarElements+transitionElements;
    frames.push({stage:stage+1,innerHalf:half,transitionHalf:collar,outerHalf:outer,spacing,padding,
      inputCounts:input,outputCounts:coarse,collarElements,transitionElements});
    counts.push(coarse);half=outer;spacing*=ratio;
  }
  if(estimated>1000000)throw new RangeError("rectangle ring allocation exceeds one million elements");
  const fineSpacing=spec.innerSize.map((length,a)=>length/spec.fineSegments[a]!) as [number,number];
  const outerSize=half.map((h,a)=>2*h*fineSpacing[a]!) as [number,number];
  if(outerSize.some(v=>!Number.isFinite(v)))throw new RangeError("rectangle ring dimensions overflow");
  return {mode:"rectangular-rings" as const,ratio,stageCount:spec.stages,counts,frames,fineSpacing,outerSize,
    innerSize:[...spec.innerSize],estimatedElements:estimated,includeCore:spec.includeCore??false,geometryChecked:false as const};
}

function signed(points:readonly Point[]):number {
  const o=points[0]!;return points.reduce((s,p,i)=>s+(p[0]!-o[0]!)*(points[(i+1)%points.length]![1]!-o[1]!)
    -(p[1]!-o[1]!)*(points[(i+1)%points.length]![0]!-o[0]!),0);
}
function score(points:readonly Point[],quads:readonly number[][]) {
  let worst=Infinity;
  for(const q of quads)for(let i=0;i<4;i++){
    const p=points[q[i]!-1]!,a=points[q[(i+1)%4]!-1]!,b=points[q[(i+3)%4]!-1]!;
    const u=[a[0]!-p[0]!,a[1]!-p[1]!],v=[b[0]!-p[0]!,b[1]!-p[1]!];
    worst=Math.min(worst,(u[0]!*v[1]!-u[1]!*v[0]!)/(Math.hypot(...u)*Math.hypot(...v)));
  }
  return worst;
}
/** Extract a three-quad corner from the repository's paired Owen face. */
function wedge(dx:number,dy:number,optimize:boolean) {
  const source=patchFor(2),points:Point[]=[],quads:number[][]=[],ids=new Map<number,number>();
  for(const cell of source.elements.slice(0,3)){
    let q=cell.map(n=>{
      if(!ids.has(n)){const p=source.nodes[n-1]!;points.push([1-2*p[0]!,p[1]!,0]);ids.set(n,points.length);}return ids.get(n)!;
    });
    if(signed(q.map(i=>points[i-1]!))<0)q=[q[0]!,q[3]!,q[2]!,q[1]!];quads.push(q);
  }
  const center=points.findIndex(p=>p[0]!>0&&p[0]!<1&&p[1]!>0&&p[1]!<1);
  if(center<0||points.length!==7)throw new Error("Owen corner extraction failed");
  if(optimize&&Math.abs(dx-dy)>1e-12*Math.max(dx,dy)){
    const scale=Math.max(dx,dy),physical=points.map(p=>[p[0]!*dx/scale,p[1]!*dy/scale,0]);
    let best=score(physical,quads),chosen=[.5,.5,0];
    for(let i=4;i<=16;i++)for(let j=4;j<=16;j++){
      const u=i/20,v=j/20;physical[center]=[u*dx/scale,v*dy/scale,0];
      const quality=score(physical,quads);
      if(quality>best+1e-10){best=quality;chosen=[u,v,0];}
    }
    points[center]=chosen;
  }
  return {points,quads,center};
}

export function generateRectangularTransitionRings(spec:RectangularTransitionRingsSpec) {
  if(Object.keys(spec).some(k=>!["innerSize","fineSegments","stages","ratio","rotationDegrees","origin","includeCore","optimizeCorners"].includes(k)))
    throw new RangeError("unsupported rectangular ring option");
  const plan=planRectangularTransitionRings(spec),origin=spec.origin??[0,0];
  if(!Array.isArray(origin)||origin.length!==2||origin.some(v=>!Number.isFinite(v))||!Number.isFinite(spec.rotationDegrees??0))
    throw new RangeError("invalid rectangle transform");
  const nodes:Point[]=[],elements:number[][]=[],stageIds:number[]=[],elementRoles:string[]=[],ids=new Map<string,number>();
  const coreElementIds:number[]=[],nodeSets:Record<string,number[]>={start:[],end:[]};
  const [sx,sy]=plan.fineSpacing,angle=((spec.rotationDegrees??0)%360)*Math.PI/180;
  const addNode=(x:number,y:number,interior?:string)=>{
    const key=interior??`g:${Math.round(2*x)}:${Math.round(2*y)}`;
    if(!interior&&(Math.abs(2*x-Math.round(2*x))>1e-8||Math.abs(2*y-Math.round(2*y))>1e-8))throw new Error("noninteger rectangle half-grid index");
    let id=ids.get(key);
    if(id===undefined){
      const px=x*sx,py=y*sy;nodes.push([origin[0]+px*Math.cos(angle)-py*Math.sin(angle),origin[1]+px*Math.sin(angle)+py*Math.cos(angle),0]);
      id=nodes.length;ids.set(key,id);
    }
    return id;
  };
  const addQuad=(q:number[],stage:number,role:string)=>{
    if(signed(q.map(n=>nodes[n-1]!))<0)q=[q[0]!,q[3]!,q[2]!,q[1]!];
    elements.push(q);stageIds.push(stage);elementRoles.push(role);if(role==="core")coreElementIds.push(elements.length);
  };
  const regular=(xs:number[],ys:number[],stage:number,role:string)=>{
    for(let i=0;i<xs.length-1;i++)for(let j=0;j<ys.length-1;j++)addQuad([
      addNode(xs[i]!,ys[j]!),addNode(xs[i+1]!,ys[j]!),addNode(xs[i+1]!,ys[j+1]!),addNode(xs[i]!,ys[j+1]!)],stage,role);
  };
  const line=(min:number,max:number,count:number)=>Array.from({length:count+1},(_,i)=>min+(max-min)*i/count);
  const frame=(half:readonly number[],counts:readonly number[])=>{
    const result=new Set<number>();
    for(const x of line(-half[0]!,half[0]!,counts[0]!))for(const y of [-half[1]!,half[1]!])result.add(addNode(x,y));
    for(const y of line(-half[1]!,half[1]!,counts[1]!))for(const x of [-half[0]!,half[0]!])result.add(addNode(x,y));
    return [...result];
  };
  const half0=[spec.fineSegments[0]/2,spec.fineSegments[1]/2];
  nodeSets.fine=frame(half0,spec.fineSegments);nodeSets.interface_0=[...nodeSets.fine];
  if(spec.includeCore)regular(line(-half0[0]!,half0[0]!,spec.fineSegments[0]),line(-half0[1]!,half0[1]!,spec.fineSegments[1]),0,"core");
  const third=patchFor(3),strip3={points:third.nodes,quads:third.elements};
  const xy=plan.ratio===2?wedge(sx,sy,spec.optimizeCorners!==false):strip3;
  const yx=plan.ratio===2?wedge(sy,sx,spec.optimizeCorners!==false):strip3;
  const tile=(patch:{points:Point[];quads:number[][]},map:(u:number,v:number)=>[number,number],stage:number,role:string,label:string)=>{
    const local=patch.points.map((p,i)=>{
      const [x,y]=map(p[0]!,p[1]!);
      const internal=p[0]!>0&&p[0]!<1&&p[1]!>0&&p[1]!<1;
      return addNode(x,y,internal?`${label}:${i}`:undefined);
    });
    for(const q of patch.quads)addQuad(q.map(n=>local[n-1]!),stage,role);
  };
  for(const f of plan.frames){
    const [a,b]=f.transitionHalf as [number,number],[oldX,oldY]=f.innerHalf as [number,number],s=f.spacing;
    if(f.padding[0])regular(line(-a,-oldX,f.padding[0]),line(-oldY,oldY,plan.counts[f.stage-1]![1]),f.stage,"collar");
    if(f.padding[0])regular(line(oldX,a,f.padding[0]),line(-oldY,oldY,plan.counts[f.stage-1]![1]),f.stage,"collar");
    if(f.padding[1])regular(line(-a,a,f.inputCounts[0]),line(-b,-oldY,f.padding[1]),f.stage,"collar");
    if(f.padding[1])regular(line(-a,a,f.inputCounts[0]),line(oldY,b,f.padding[1]),f.stage,"collar");
    if(f.padding.some(Boolean))nodeSets[`collar_${f.stage}`]=frame(f.transitionHalf,f.inputCounts);
    const r=plan.ratio;
    for(const sign of [-1,1]){
      for(let k=0;k<f.inputCounts[0]/r;k++)tile(xy,(u,v)=>[-a+r*s*(k+(r===2&&k%2?1-u:u)),sign*(b+r*s*v)],f.stage,"strip",`s${f.stage}:h${sign}:${k}`);
      for(let k=0;k<f.inputCounts[1]/r;k++)tile(yx,(u,v)=>[sign*(a+r*s*v),-b+r*s*(k+(r===2&&k%2?1-u:u))],f.stage,"strip",`s${f.stage}:v${sign}:${k}`);
    }
    for(const x of [-1,1])for(const y of [-1,1]){
      if(r===2)tile(xy,(u,v)=>[x*(a+2*s*u),y*(b+2*s*v)],f.stage,"corner",`s${f.stage}:c${x}:${y}`);
      else addQuad([addNode(x*a,y*b),addNode(x*(a+3*s),y*b),addNode(x*(a+3*s),y*(b+3*s)),addNode(x*a,y*(b+3*s))],f.stage,"corner");
    }
    nodeSets[`interface_${f.stage}`]=frame(f.outerHalf,f.outputCounts);
  }
  nodeSets.coarse=[...nodeSets[`interface_${spec.stages}`]!];
  const mesh:Mesh={kind:"Q1",nodes,elements},fine=new Set(nodeSets.fine),coarse=new Set(nodeSets.coarse);
  if(elements.length!==plan.estimatedElements)throw new Error("rectangle ring element accounting mismatch");
  const expected=plan.outerSize[0]*plan.outerSize[1]-(spec.includeCore?0:spec.innerSize[0]*spec.innerSize[1]);
  const quality=auditPlanarQuadMesh(mesh,expected,edge=>edge.every(n=>coarse.has(n))||(!spec.includeCore&&edge.every(n=>fine.has(n))));
  if(!checkNoHangingNodes(mesh,minElementEdgeLength(mesh)*1e-8).ok)throw new Error("rectangle ring interfaces are not conforming");
  const result={mesh,plan,stageIds,nodeSets,elementRoles,coreElementIds,
    quality:{...quality,warnings:quality.minimumCornerScaledJacobian<.2?["Low rectangle-ring SJ requires review."]:[]}};
  return result satisfies TransitionBandMesh;
}
