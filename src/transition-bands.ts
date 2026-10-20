import type {Mesh, Point} from "./types.js";
import {refineQ1To4Q1} from "./templates.js";
import {regularSweepTemplateLibrary,markedCornerSignature} from "./two-to-one-sweep-templates.js";
import {H1_FACES} from "./topology.js";
import {auditPlanarQuadMesh} from "./graded-quad.js";
import {checkNoHangingNodes} from "./conformance.js";
import {minElementEdgeLength} from "./mesh.js";
import {hexElementSignedVolume,minimumHexCornerScaledJacobian} from "./hex-quality.js";

export interface TransitionBandSchedule {
  fineSegments:number;
  ratios:readonly (2|3)[];
  depth:number;
  stageDepths?:readonly number[];
}
export interface TransitionBandPlan {
  counts:number[]; ratios:(2|3)[]; requiredMultiple:number;
  stageDepths:number[]; boundaries:number[]; geometryChecked:false; stageCount:number;
}
export class TransitionBandCountError extends RangeError {
  constructor(readonly requiredMultiple:number,readonly nearbyCounts:number[]) {
    super(`Transition band count must be a multiple of ${requiredMultiple}; nearby counts: ${nearbyCounts.join(", ")}`);
    this.name="TransitionBandCountError";
  }
}
function positive(value:number,name:string) {
  if(!Number.isFinite(value)||value<=0)throw new RangeError(`${name} must be finite and positive`);
}
function finite(value:number,name:string) {
  if(!Number.isFinite(value))throw new RangeError(`${name} must be finite`);
}
function gcd(a:number,b:number):number {while(b){const r=a%b;a=b;b=r;}return a;}

/** Count feasibility is template-specific, not proof that the geometry meshes. */
export function planTransitionBand(spec:TransitionBandSchedule):TransitionBandPlan {
  if(!Number.isSafeInteger(spec.fineSegments)||spec.fineSegments<=0||spec.fineSegments>200000)
    throw new RangeError("fineSegments must be an integer in [1,200000]");
  if(!Array.isArray(spec.ratios)||spec.ratios.length<1||spec.ratios.length>8||spec.ratios.some(r=>r!==2&&r!==3))
    throw new RangeError("ratios must contain 1 to 8 entries, each 2 or 3");
  positive(spec.depth,"depth");
  // Work backwards: each stage input must tile its period AND supply the next.
  let required=1;
  for(const ratio of [...spec.ratios].reverse()){
    const period=ratio===2?4:3,need=ratio*required;
    required=period/gcd(period,need)*need;
  }
  if(spec.fineSegments%required){
    const below=Math.floor(spec.fineSegments/required)*required,above=below+required;
    throw new TransitionBandCountError(required,[below,above].filter(n=>n>0&&n<=200000));
  }
  const counts=[spec.fineSegments];
  for(const r of spec.ratios)counts.push(counts[counts.length-1]!/r);
  let widths:number[];
  if(spec.stageDepths!==undefined){
    if(!Array.isArray(spec.stageDepths)||spec.stageDepths.length!==spec.ratios.length)
      throw new RangeError("stageDepths must contain one width per stage");
    widths=[...spec.stageDepths];widths.forEach(v=>positive(v,"stage width"));
    if(Math.abs(widths.reduce((a,b)=>a+b,0)-spec.depth)>spec.depth*1e-10)
      throw new RangeError("stageDepths must sum to depth");
  }else{
    const pitches=counts.slice(0,-1).map(n=>spec.fineSegments/n),total=pitches.reduce((a,b)=>a+b,0);
    widths=pitches.map(p=>spec.depth*(p/total));
  }
  const boundaries=[0];
  for(const [i,w] of widths.entries()){
    const end=i===widths.length-1?spec.depth:boundaries[i]!+w;
    if(!(end>boundaries[i]!))throw new RangeError("stage width is not numerically resolvable");
    boundaries.push(end);widths[i]=end-boundaries[i]!;
  }
  return {counts,ratios:[...spec.ratios],requiredMultiple:required,stageDepths:widths,boundaries,geometryChecked:false,stageCount:spec.ratios.length};
}

interface Patch {nodes:Point[];elements:number[][];period:number}
function orient(points:readonly Point[]):number {
  const origin=points[0]!;
  return points.reduce((s,p,i)=>s+(p[0]!-origin[0]!)*(points[(i+1)%points.length]![1]!-origin[1]!)
    -(p[1]!-origin[1]!)*(points[(i+1)%points.length]![0]!-origin[0]!),0);
}
let pairedPatch:Patch|undefined;
export function patchFor(ratio:2|3):Patch {
  if(ratio===3){const r=refineQ1To4Q1([[0,0,0],[1,0,0],[1,1,0],[0,1,0]]);return {nodes:r.nodes,elements:r.elements.map(e=>[...e]),period:3};}
  if(pairedPatch)return pairedPatch;
  // Project the existing Owen pattern2 face, pair it with its reflection.
  // No TransitionMesh node or connection table is imported here.
  const source=regularSweepTemplateLibrary().get(markedCornerSignature([[-1,-1,-1],[1,-1,-1]]))!;
  const faces=source.elements.flatMap(e=>H1_FACES.map(f=>f.map(i=>e[i-1]!)))
    .filter(f=>f.every(i=>source.nodes[i]![0]===-1));
  const nodes:Point[]=[],elements:number[][]=[],ids=new Map<string,number>();
  for(const side of [0,1])for(const f of faces){
    let e=f.map(i=>{
      const p=source.nodes[i]!,u=(p[2]+1)/2,v=(p[1]+1)/2;
      const q=[(side===0?1-u:1+u)/2,v,0],key=q.join(":");
      if(!ids.has(key)){nodes.push(q);ids.set(key,nodes.length);}return ids.get(key)!;
    });
    if(orient(e.map(i=>nodes[i-1]!))<0)e=[e[0]!,e[3]!,e[2]!,e[1]!];
    elements.push(e);
  }
  if(elements.length!==6)throw new Error("existing pattern2 did not yield the paired six-quad band");
  return pairedPatch={nodes,elements,period:4};
}

export interface BandTopology {mesh:Mesh;stageIds:number[];nodeSets:Record<string,number[]>}
export interface TransitionBandMesh extends BandTopology {
  plan:{stageCount:number};
  quality:{area:number;minimumGaussDeterminant:number;warnings:readonly string[]};
  coreElementIds?:readonly number[];
}
interface BandBlock {ratio:2|3;start:number;stride:number}
function assemble(plan:TransitionBandPlan,closed:boolean,map:(u:number,d:number)=>Point):BandTopology {
  const n=plan.counts[0]!;
  const rows=plan.ratios.map((ratio,stage)=>{
    const count=plan.counts[stage]!,period=ratio===2?4:3,stride=n/count;
    return Array.from({length:count/period},(_,block)=>({ratio,start:block*period*stride,stride}));
  });
  return assembleRows(plan.counts,plan.boundaries,rows,closed,map);
}
function assembleRows(counts:readonly number[],boundaries:readonly number[],rows:readonly BandBlock[][],
    closed:boolean,map:(u:number,d:number)=>Point):BandTopology {
  const nodes:Point[]=[],elements:number[][]=[],stageIds:number[]=[],ids=new Map<string,number>();
  const levels=boundaries.map(()=>new Set<number>()),start=new Set<number>(),end=new Set<number>();
  const n=counts[0]!;
  for(const [stage,blocks] of rows.entries()){
    for(const block of blocks){
      const patch=patchFor(block.ratio);
      const local=patch.nodes.map(p=>{
        const offset=Math.round(p[0]!*patch.period);
        if(Math.abs(offset-p[0]!*patch.period)>1e-10)throw new Error("template does not align to the integer interface grid");
        const angular=block.start+offset*block.stride,v=p[1]!;
        const level=v===0?stage:v===1?stage+1:-1;
        const key=`${level<0?"m"+stage:"b"+level}:${closed?angular%n:angular}`;
        let id=ids.get(key);
        if(id===undefined){
          const point=map((closed&&angular===n?0:angular)/n,boundaries[stage]!+v*(boundaries[stage+1]!-boundaries[stage]!));
          if(point.length!==3||point.some(x=>!Number.isFinite(x)))throw new Error("nonfinite band geometry");
          nodes.push(point);id=nodes.length;ids.set(key,id);
        }
        if(level>=0)levels[level]!.add(id);
        if(!closed&&angular===0)start.add(id);
        if(!closed&&angular===n)end.add(id);
        return id;
      });
      for(const cell of patch.elements){
        let e=cell.map(i=>local[i-1]!);
        if(orient(e.map(i=>nodes[i-1]!))<0)e=[e[0]!,e[3]!,e[2]!,e[1]!];
        elements.push(e);stageIds.push(stage+1);
      }
    }
  }
  const nodeSets:Record<string,number[]>={fine:[...levels[0]!],coarse:[...levels[levels.length-1]!],start:[...start],end:[...end]};
  levels.forEach((nodes,i)=>{nodeSets[`interface_${i}`]=[...nodes];});
  for(const [i,level] of levels.entries())if(level.size!==counts[i]!+(closed?0:1))throw new Error("interface count mismatch");
  return {mesh:{kind:"Q1",nodes,elements},stageIds,nodeSets};
}
export function auditBand(result:BandTopology,expectedArea:number) {
  positive(expectedArea,"discrete boundary area");
  const sets=["fine","coarse","start","end"].map(name=>new Set(result.nodeSets[name]!));
  const quality=auditPlanarQuadMesh(result.mesh,expectedArea,ns=>sets.some(s=>ns.every(n=>s.has(n))));
  if(!checkNoHangingNodes(result.mesh,minElementEdgeLength(result.mesh)*1e-8).ok)throw new Error("transition band has hanging interfaces");
  return {...quality,warnings:quality.minimumCornerScaledJacobian<.2?["Low transition SJ: engineering review required."]:[]};
}
export interface PlanarTransitionBandSpec extends TransitionBandSchedule {
  length:number; rotationDegrees?:number; origin?:readonly [number,number]; fineSide?:"bottom"|"top";
}
function checkOrigin(value:readonly number[]) {
  if(!Array.isArray(value)||value.length!==2||value.some(v=>!Number.isFinite(v)))throw new RangeError("origin/center must have two finite coordinates");
}
export function generatePlanarTransitionBand(spec:PlanarTransitionBandSpec) {
  if(Object.keys(spec).some(k=>!["fineSegments","ratios","depth","stageDepths","length","rotationDegrees","origin","fineSide"].includes(k)))throw new RangeError("unsupported planar band option");
  positive(spec.length,"length");const origin=spec.origin??[0,0];checkOrigin(origin);
  const degrees=spec.rotationDegrees??0;finite(degrees,"rotationDegrees");const angle=(degrees%360)*Math.PI/180;
  const fineSide=spec.fineSide??"bottom";if(!["bottom","top"].includes(fineSide))throw new RangeError("invalid planar fineSide");
  const plan=planTransitionBand(spec);
  const result=assemble(plan,false,(u,d)=>{
    const x=u*spec.length,y=fineSide==="bottom"?d:spec.depth-d;
    return [origin[0]+x*Math.cos(angle)-y*Math.sin(angle),origin[1]+x*Math.sin(angle)+y*Math.cos(angle),0];
  });
  return {...result,plan:{...plan,mode:"planar" as const},quality:auditBand(result,spec.length*spec.depth)};
}

export interface HybridTransitionBandSpec {
  fineSegments:number; coarseSegments:number; length:number; depth:number;
  order?:"grouped"|"interleave"; blocks?:readonly ("pair2"|"single3")[];
  rotationDegrees?:number; origin?:readonly [number,number]; fineSide?:"bottom"|"top";
}
/** Solve integer port balance; paired 2:1 blocks each consume 4 fine/2 coarse. */
export function planHybridTransitionBand(spec:HybridTransitionBandSpec) {
  const n=spec.fineSegments,m=spec.coarseSegments;
  if(!Number.isSafeInteger(n)||n<1||n>200000||!Number.isSafeInteger(m)||m<1||m>100000)
    throw new RangeError("hybrid fine/coarse counts must be positive bounded integers");
  const singles=n-2*m,pairs=(3*m-n)/2;
  if(singles<0||pairs<0||!Number.isInteger(pairs))throw new RangeError("hybrid port balance needs 2M <= N <= 3M and an even number of 2:1 columns");
  const order=spec.order??"grouped";
  if(!["grouped","interleave"].includes(order))throw new RangeError("invalid hybrid block order");
  let blocks:("pair2"|"single3")[];
  if(spec.blocks!==undefined){
    if(!Array.isArray(spec.blocks)||spec.blocks.some(b=>b!=="pair2"&&b!=="single3")
        ||spec.blocks.filter(b=>b==="single3").length!==singles||spec.blocks.filter(b=>b==="pair2").length!==pairs)
      throw new RangeError("explicit hybrid blocks do not match fine/coarse counts");
    blocks=[...spec.blocks];
  }else if(order==="grouped")blocks=[...Array(singles).fill("single3"),...Array(pairs).fill("pair2")];
  else{
    blocks=[];let used=0;
    for(let i=0;i<singles+pairs;i++){
      const target=Math.round((i+1)*pairs/(singles+pairs));
      if(target>used){blocks.push("pair2");used++;}else blocks.push("single3");
    }
  }
  return {mode:"hybrid" as const,stageCount:1,counts:[n,m],single3Count:singles,pair2Count:pairs,blocks,
    order:spec.blocks?"explicit":order,geometryChecked:false as const};
}
export function generateHybridTransitionBand(spec:HybridTransitionBandSpec) {
  if(Object.keys(spec).some(k=>!["fineSegments","coarseSegments","length","depth","order","blocks","rotationDegrees","origin","fineSide"].includes(k)))
    throw new RangeError("unsupported hybrid option");
  positive(spec.length,"length");positive(spec.depth,"depth");
  const plan=planHybridTransitionBand(spec),origin=spec.origin??[0,0];checkOrigin(origin);
  const degrees=spec.rotationDegrees??0;finite(degrees,"rotationDegrees");const angle=(degrees%360)*Math.PI/180;
  const fineSide=spec.fineSide??"bottom";if(!["bottom","top"].includes(fineSide))throw new RangeError("invalid hybrid fineSide");
  let start=0;
  const blocks=plan.blocks.map(kind=>{const ratio=kind==="pair2"?2:3;const block={ratio:ratio as 2|3,start,stride:1};start+=ratio===2?4:3;return block;});
  const result=assembleRows(plan.counts,[0,spec.depth],[blocks],false,(u,d)=>{
    const x=u*spec.length,y=fineSide==="bottom"?d:spec.depth-d;
    return [origin[0]+x*Math.cos(angle)-y*Math.sin(angle),origin[1]+x*Math.sin(angle)+y*Math.cos(angle),0];
  });
  return {...result,plan,quality:auditBand(result,spec.length*spec.depth)};
}
export interface AnnularTransitionBandSpec extends Omit<TransitionBandSchedule,"depth"> {
  innerRadius:number;outerRadius:number;fineSide?:"inner"|"outer";
  center?:readonly [number,number];startAngleDegrees?:number;sweepAngleDegrees?:number;
}
export function generateAnnularTransitionBand(spec:AnnularTransitionBandSpec) {
  if(Object.keys(spec).some(k=>!["fineSegments","ratios","stageDepths","innerRadius","outerRadius","fineSide","center","startAngleDegrees","sweepAngleDegrees"].includes(k)))throw new RangeError("unsupported annular band option");
  const {innerRadius:inner,outerRadius:outer}=spec;positive(inner,"innerRadius");positive(outer,"outerRadius");
  if(!(outer>inner))throw new RangeError("outerRadius must exceed innerRadius");
  const fineSide=spec.fineSide??"inner",center=spec.center??[0,0];checkOrigin(center);
  if(!["inner","outer"].includes(fineSide))throw new RangeError("invalid annular fineSide");
  const start=spec.startAngleDegrees??0,sweep=spec.sweepAngleDegrees??360;finite(start,"startAngleDegrees");positive(sweep,"sweepAngleDegrees");
  if(sweep>360)throw new RangeError("sweepAngleDegrees must not exceed 360");
  const plan=planTransitionBand({...spec,depth:outer-inner}),closed=sweep===360;
  if(sweep/plan.counts[plan.counts.length-1]!>90)throw new RangeError("coarse angular intervals must not exceed 90 degrees");
  const angle=sweep*Math.PI/180;
  const result=assemble(plan,closed,(u,d)=>{
    const r=fineSide==="inner"?inner+d:outer-d,theta=(start%360)*Math.PI/180+u*angle;
    return [center[0]+r*Math.cos(theta),center[1]+r*Math.sin(theta),0];
  });
  const fine=plan.counts[0]!,coarse=plan.counts[plan.counts.length-1]!;
  const ni=fineSide==="inner"?fine:coarse,no=fineSide==="inner"?coarse:fine;
  const discreteArea=(outer*outer*no*Math.sin(angle/no)-inner*inner*ni*Math.sin(angle/ni))/2;
  const analyticArea=(outer*outer-inner*inner)*angle/2;
  return {...result,plan:{...plan,mode:"annular" as const,closed,fineSide,innerSegments:ni,outerSegments:no},
    quality:{...auditBand(result,discreteArea),analyticArea,relativeAnalyticAreaError:Math.abs(discreteArea-analyticArea)/analyticArea}};
}

/** Straight +Z extrusion of a validated band, not a general curved sweep. */
export function extrudeTransitionBand<T extends TransitionBandMesh>(band:T,height:number,layers:number) {
  positive(height,"height");
  if(!Number.isSafeInteger(layers)||layers<1||layers*band.mesh.elements.length>1000000
      ||(layers+1)*band.mesh.nodes.length>2000000)throw new RangeError("invalid/excessive extrusion layers");
  // Re-audit caller-supplied data: a serialized result can have been modified.
  if(band.mesh.kind!=="Q1"||band.mesh.nodes.some(p=>p.length!==3||p[2]!==0))throw new Error("extrusion requires an XY planar Q1 band");
  const core=new Set(band.coreElementIds??[]);
  if(!Number.isSafeInteger(band.plan.stageCount)||band.plan.stageCount<1||band.plan.stageCount>8
      ||core.size!==(band.coreElementIds?.length??0)||[...core].some(i=>!Number.isSafeInteger(i)||i<1||i>band.mesh.elements.length))
    throw new Error("invalid transition core/stage metadata");
  if(band.stageIds.length!==band.mesh.elements.length||band.stageIds.some((stage,i)=>!Number.isSafeInteger(stage)||stage<0||stage>band.plan.stageCount||(stage===0)!==core.has(i+1)))
    throw new Error("invalid transition stage lineage");
  for(const ids of Object.values(band.nodeSets))if(ids.some(i=>!Number.isSafeInteger(i)||i<1||i>band.mesh.nodes.length))throw new Error("invalid band node set");
  const baseQuality=auditBand(band,band.quality.area),n=band.mesh.nodes.length;
  const nodes:Point[]=[],elements:number[][]=[],stageIds:number[]=[];
  for(let k=0;k<=layers;k++)for(const p of band.mesh.nodes)nodes.push([p[0]!,p[1]!,height*(k/layers)]);
  for(let k=0;k<layers;k++)for(const [i,e] of band.mesh.elements.entries()){
    elements.push([...e.map(j=>j+k*n),...e.map(j=>j+(k+1)*n)]);stageIds.push(band.stageIds[i]!);
  }
  const mesh:Mesh={kind:"H1",nodes,elements};
  let minSJ=Infinity,volume=0;
  for(const e of elements){const p=e.map(i=>nodes[i-1]!);minSJ=Math.min(minSJ,minimumHexCornerScaledJacobian(p));volume+=hexElementSignedVolume(p);}
  const expected=baseQuality.area*height,error=Math.abs(volume-expected)/expected;
  if(!(minSJ>0&&Number.isFinite(volume)&&error<1e-8)||!checkNoHangingNodes(mesh,minElementEdgeLength(mesh)*1e-8).ok)throw new Error("extruded band failed quality/volume/conformance");
  const nodeSets:Record<string,number[]>={bottom:Array.from({length:n},(_,i)=>i+1),top:Array.from({length:n},(_,i)=>i+1+layers*n)};
  for(const [name,ids] of Object.entries(band.nodeSets))nodeSets[name]=Array.from({length:layers+1},(_,k)=>ids.map(i=>i+k*n)).flat();
  return {mesh,stageIds,nodeSets,plan:{...band.plan,height,layers},quality:{volume,relativeVolumeError:error,minimumCornerScaledJacobian:minSJ,
    minimumGaussDeterminant:baseQuality.minimumGaussDeterminant*height/(2*layers),warnings:baseQuality.warnings}};
}
