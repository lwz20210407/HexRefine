import type {Mesh,Point} from "./types.js";
import type {ModelFraction} from "./graded-rectangle-plan.js";
import {planMappedCircularCore,generateMappedCircularCore,type MappedCircularCorePlan} from "./mapped-circular-core.js";
import {circularPolarPoint} from "./circular-core-map-internal.js";
import {twoWay7ReferenceTemplates} from "./two-to-one-templates.js";
import {hexElementSignedVolume,minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {hexJacobian} from "./hex-quality-internal.js";
import {H1_FACES} from "./topology.js";
import {checkNoHangingNodes} from "./conformance.js";

export interface ConcentricTransitionRing {
  innerRadius:number;
  outerRadius:number;
  /** Maximum radial interval in the regular annulus outside this transition. */
  radialSize?:number;
}
export interface ConcentricCircularSpec {
  radius:number;
  height:number;
  coreRadius:number;
  radiusSegments:number;
  arcSegments:number;
  axialSegments:number;
  modelFraction:ModelFraction;
  rings:readonly ConcentricTransitionRing[];
  innerCornerFraction?:number;
  /** Maximum radial interval before the first transition; defaults to core Z spacing. */
  radialSize?:number;
  elementLimit?:number;
  motifElementLimit?:number;
  /** Optional engineering gate, in addition to mandatory strictly positive sampled Jacobians. */
  minimumCornerScaledJacobian?:number;
}
export interface ConcentricCircularBand {
  kind:"regular"|"transition";
  innerRadius:number;
  outerRadius:number;
  angularSegments:number;
  axialStride:number;
  radialSegments:number;
  elementsPerQuadrantPeriod:number;
}
export interface ConcentricCircularPlan {
  core:MappedCircularCorePlan;
  radius:number;
  height:number;
  modelFraction:ModelFraction;
  fineAxialSpacing:number;
  axialSegments:number;
  periodFineLayers:number;
  periodHeight:number;
  repetitions:number;
  angularCountsPerQuarter:number[];
  axialSpacings:number[];
  bands:ConcentricCircularBand[];
  expectedMotifElements:number;
  expectedElements:number;
  expectedCoreElements:number;
  elementLimit:number;
  motifElementLimit:number;
  discreteVolume:number;
  analyticVolume:number;
}
export interface ConcentricRegionQuality {
  elements:number;
  minimumCornerScaledJacobian:number;
  minimumEdge:number;
  maximumEdge:number;
  maximumEdgeAspectRatio:number;
}
export interface PreparedConcentricCircularMesh {
  motif:Mesh;
  plan:ConcentricCircularPlan;
  layout:{bottomNodeIds:number[];interiorNodeIds:number[];planeIndexByNode:number[];
    interiorIndexByNode:number[];fineLayerByNode:number[]};
  regions:{name:string;startElementId:number;endElementId:number}[];
  counts:{nodes:number;elements:number};
  quality:{minimumCornerScaledJacobian:number;minimumGaussDeterminant:number;volume:number;
    relativeDiscreteVolumeError:number;relativeAnalyticVolumeError:number;
    unexpectedInternalFreeFaces:number;hangingCheckPassed:true;periodicPartitionsIdentical:true;
    regions:Record<string,ConcentricRegionQuality>;warnings:string[];engineeringAcceptanceVerified:false};
}
const SPEC_KEYS=["radius","height","coreRadius","radiusSegments","arcSegments","axialSegments","modelFraction","rings",
  "innerCornerFraction","radialSize","elementLimit","motifElementLimit","minimumCornerScaledJacobian"];
const MAX_ELEMENTS=20000000,MAX_MOTIF=200000;
function options(value:object,allowed:readonly string[]){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new TypeError("concentric options must be an object");
  if(Object.keys(value).some(k=>!allowed.includes(k)))throw new RangeError("unsupported concentric option");
}
function positive(v:number,name:string){if(!Number.isFinite(v)||v<=0)throw new RangeError(`${name} must be finite and positive`);}
function integer(v:number,name:string){if(!Number.isSafeInteger(v)||v<1)throw new RangeError(`${name} must be a positive safe integer`);}
function copies(f:ModelFraction){return f==="quarter"?1:f==="half"?2:4;}

/** Counts only; no radius/seed rounding, no implicit core enlargement. */
export function planConcentricCircularMesh(spec:ConcentricCircularSpec):ConcentricCircularPlan {
  options(spec,SPEC_KEYS);
  positive(spec.radius,"radius");positive(spec.height,"height");integer(spec.axialSegments,"axialSegments");
  if(!Array.isArray(spec.rings)||spec.rings.length<1||spec.rings.length>8)throw new RangeError("provide one to eight coupled 2:1 transition rings");
  const core=planMappedCircularCore({radius:spec.coreRadius,radiusSegments:spec.radiusSegments,arcSegments:spec.arcSegments,
    modelFraction:"quarter",...(spec.innerCornerFraction===undefined?{}:{innerCornerFraction:spec.innerCornerFraction})});
  if(!["quarter","half","full"].includes(spec.modelFraction))throw new RangeError("invalid concentric modelFraction");
  const limit=spec.elementLimit??8000000,motifLimit=spec.motifElementLimit??MAX_MOTIF;
  integer(limit,"elementLimit");integer(motifLimit,"motifElementLimit");
  if(limit>MAX_ELEMENTS||motifLimit>MAX_MOTIF)throw new RangeError("concentric allocation limit exceeds supported bounds");
  if(spec.minimumCornerScaledJacobian!==undefined&&(!Number.isFinite(spec.minimumCornerScaledJacobian)
    ||spec.minimumCornerScaledJacobian<=0||spec.minimumCornerScaledJacobian>1))throw new RangeError("minimumCornerScaledJacobian must be in (0,1]");
  const periodFineLayers=2**(spec.rings.length+1),repetitions=spec.axialSegments/periodFineLayers;
  if(!Number.isSafeInteger(repetitions)||repetitions<1)throw new RangeError("axialSegments must be divisible by twice the final 2:1 stride for this periodic implementation");
  if(spec.arcSegments%2**spec.rings.length!==0)throw new RangeError("arcSegments must be divisible by every ring's cumulative 2:1 ratio");
  const fine=spec.height/spec.axialSegments;
  positive(fine,"fine axial spacing");positive(spec.height*spec.radius*spec.radius,"volume scale");
  const angular=[spec.arcSegments],axial=[fine],bands:ConcentricCircularBand[]=[];
  let radius=spec.coreRadius,level=0,radialSize=spec.radialSize??fine;
  positive(radialSize,"radialSize");
  const regular=(outer:number)=>{
    if(outer===radius)return;
    const n=Math.ceil((outer-radius)/radialSize),angularSegments=spec.arcSegments/2**level,stride=2**level;
    integer(n,"regular radial count");
    bands.push({kind:"regular",innerRadius:radius,outerRadius:outer,angularSegments,axialStride:stride,radialSegments:n,
      elementsPerQuadrantPeriod:n*angularSegments*periodFineLayers/stride});radius=outer;
  };
  for(const ring of spec.rings){
    options(ring,["innerRadius","outerRadius","radialSize"]);
    positive(ring.innerRadius,"ring innerRadius");positive(ring.outerRadius,"ring outerRadius");
    if(ring.innerRadius<radius||ring.outerRadius<=ring.innerRadius||ring.outerRadius>spec.radius)throw new RangeError("rings must be ordered, nonoverlapping and inside radius");
    regular(ring.innerRadius);level++;
    const n=spec.arcSegments/2**level,stride=2**level;
    bands.push({kind:"transition",innerRadius:ring.innerRadius,outerRadius:ring.outerRadius,angularSegments:n,
      axialStride:stride,radialSegments:1,elementsPerQuadrantPeriod:7*n*periodFineLayers/stride});
    radius=ring.outerRadius;radialSize=ring.radialSize??fine*stride;positive(radialSize,"ring radialSize");
    angular.push(n);axial.push(fine*stride);
  }
  regular(spec.radius);
  const c=copies(spec.modelFraction),corePeriod=core.expectedElementCount*periodFineLayers;
  const motif=(corePeriod+bands.reduce((s,b)=>s+b.elementsPerQuadrantPeriod,0))*c,total=motif*repetitions;
  if(!Number.isSafeInteger(motif)||motif>motifLimit||!Number.isSafeInteger(total)||total>limit)throw new RangeError("concentric mesh exceeds motifElementLimit or elementLimit before allocation");
  const n=angular[angular.length-1]!,discreteVolume=.5*spec.radius**2*n*Math.sin(Math.PI/(2*n))*spec.height*c;
  const analyticVolume=Math.PI*spec.radius**2*spec.height*c/4;
  positive(discreteVolume,"discrete volume");positive(analyticVolume,"analytic volume");
  return {core,radius:spec.radius,height:spec.height,modelFraction:spec.modelFraction,fineAxialSpacing:fine,axialSegments:spec.axialSegments,
    periodFineLayers,periodHeight:spec.height*(periodFineLayers/spec.axialSegments),repetitions,angularCountsPerQuarter:angular,
    axialSpacings:axial,bands,expectedMotifElements:motif,expectedElements:total,
    expectedCoreElements:core.expectedElementCount*spec.axialSegments*c,elementLimit:limit,motifElementLimit:motifLimit,discreteVolume,analyticVolume};
}

/** Audited periodic topology; streaming expands this motif without a full-model mesh in memory. */
export function prepareConcentricCircularMesh(spec:ConcentricCircularSpec):PreparedConcentricCircularMesh {
  const plan=planConcentricCircularMesh(spec),section=generateMappedCircularCore({radius:spec.coreRadius,radiusSegments:spec.radiusSegments,
    arcSegments:spec.arcSegments,modelFraction:"quarter",...(spec.innerCornerFraction===undefined?{}:{innerCornerFraction:spec.innerCornerFraction})});
  const quarter:Mesh={kind:"H1",nodes:[],elements:[]},registry=new Map<string,number>(),footprints:string[]=[],zs:number[]=[];
  const quarterRegions:{name:string;startElementId:number;endElementId:number}[]=[];
  const node=(key:string,z:number,p:Point)=>{
    if(!Number.isSafeInteger(z)||z<0||z>plan.periodFineLayers)throw new Error("unresolved axial template coordinate");
    const full=`${key}|${z}`,old=registry.get(full);
    if(old!==undefined)return old;
    const id=quarter.nodes.length+1;registry.set(full,id);quarter.nodes.push(p);footprints.push(key);zs.push(z);return id;
  };
  const core=(id:number,z:number)=>node(`K:${id}`,z,[section.mesh.nodes[id-1]![0]!,section.mesh.nodes[id-1]![1]!,spec.height*(z/spec.axialSegments)]);
  for(let k=0;k<plan.periodFineLayers;k++)for(const e of section.mesh.elements)quarter.elements.push([k,k+1].flatMap(z=>e.map(id=>core(id,z))));
  quarterRegions.push({name:"core",startElementId:1,endElementId:quarter.elements.length});
  const references=twoWay7ReferenceTemplates(),checker=[[0,1],[3,2]];
  const radiusKeys=new Map<number,string>([[spec.coreRadius,"core"]]);
  const boundaryKey=(r:number)=>{let key=radiusKeys.get(r);if(key===undefined){key=`B:${radiusKeys.size}`;radiusKeys.set(r,key);}return key;};
  for(const [bi,band] of plan.bands.entries()){
    const start=quarter.elements.length+1,lo=boundaryKey(band.innerRadius),hi=boundaryKey(band.outerRadius);
    const at=(U:number,r:number,z:number,rkey:string)=>{
      if(!Number.isSafeInteger(U))throw new Error("unresolved angular template coordinate");
      if(rkey==="core")return core(section.nodeSets.circular_boundary[U]!,z);
      const xy=circularPolarPoint(r,U/spec.arcSegments);
      return node(`${rkey}:${U}`,z,[xy[0]!,xy[1]!,spec.height*(z/spec.axialSegments)]);
    };
    const stride=band.axialStride;
    if(band.kind==="regular"){
      for(let k=0;k<plan.periodFineLayers/stride;k++)for(let j=0;j<band.radialSegments;j++)for(let i=0;i<band.angularSegments;i++){
        const ids=[k,k+1].flatMap(Z=>[[i,j],[i+1,j],[i+1,j+1],[i,j+1]].map(([u,v])=>{
          const radial=v!,r=radial===0?band.innerRadius:radial===band.radialSegments?band.outerRadius:
            band.innerRadius+(band.outerRadius-band.innerRadius)*radial/band.radialSegments;
          return at(u!*stride,r,Z*stride,radial===0?lo:radial===band.radialSegments?hi:`R:${bi}:${radial}`);
        }));
        quarter.elements.push(ids);
      }
    }else{
      for(let k=0;k<plan.periodFineLayers/stride;k++)for(let i=0;i<band.angularSegments;i++){
        const template=references[checker[k%2]![i%2]!]!;
        const ids=template.nodes.map(([u,v,w])=>{
          const t=(1-w)/2,r=t===0?band.innerRadius:t===1?band.outerRadius:band.innerRadius+t*(band.outerRadius-band.innerRadius);
          return at((i+(u+1)/2)*stride,r,(k+(v+1)/2)*stride,t===0?lo:t===1?hi:`T:${bi}:${t*4}`);
        });
        quarter.elements.push(...template.elements.map(e=>e.map(id=>ids[id]!)));
      }
    }
    quarterRegions.push({name:`${band.kind}-${bi}`,startElementId:start,endElementId:quarter.elements.length});
  }
  // The reference chart is (angle, Z, inward radius); correct its physical orientation.
  for(let i=0;i<quarter.elements.length;i++)if(hexElementSignedVolume(quarter.elements[i]!.map(id=>quarter.nodes[id-1]!))<0){
    const e=quarter.elements[i]!;quarter.elements[i]=[0,3,2,1,4,7,6,5].map(j=>e[j]!);
  }
  const motif:Mesh={kind:"H1",nodes:[],elements:[]},lookup=new Map<string,number>(),xyKeys:string[]=[],fineLayerByNode:number[]=[],regions:PreparedConcentricCircularMesh["regions"]=[];
  const xs=spec.modelFraction==="quarter"?[1]:[1,-1],ys=spec.modelFraction==="full"?[1,-1]:[1];
  for(const sx of xs)for(const sy of ys){
    const ids=quarter.nodes.map((p,i)=>{
      const key=`${footprints[i]}:${p[0]===0?0:sx}:${p[1]===0?0:sy}`,whole=`${key}|${zs[i]}`;
      let id=lookup.get(whole);
      if(id===undefined){id=motif.nodes.length+1;lookup.set(whole,id);motif.nodes.push([p[0]===0?0:sx*p[0]!,p[1]===0?0:sy*p[1]!,p[2]!]);xyKeys.push(key);fineLayerByNode.push(zs[i]!);}
      return id;
    });
    const offset=motif.elements.length;
    for(const e of quarter.elements)motif.elements.push((sx*sy<0?[e[0]!,e[3]!,e[2]!,e[1]!,e[4]!,e[7]!,e[6]!,e[5]!]:e).map(id=>ids[id-1]!));
    regions.push(...quarterRegions.map(r=>({...r,startElementId:r.startElementId+offset,endElementId:r.endElementId+offset})));
  }
  if(motif.elements.length!==plan.expectedMotifElements)throw new Error("concentric motif count disagrees with plan");
  const bottomNodeIds:number[]=[],interiorNodeIds:number[]=[],planeIndexByNode=new Array<number>(motif.nodes.length).fill(-1),
    interiorIndexByNode=new Array<number>(motif.nodes.length).fill(-1),bottom=new Map<string,number>();
  fineLayerByNode.forEach((z,i)=>{if(z===0){planeIndexByNode[i]=bottomNodeIds.length;bottom.set(xyKeys[i]!,bottomNodeIds.length);bottomNodeIds.push(i+1);}
    else if(z!==plan.periodFineLayers){interiorIndexByNode[i]=interiorNodeIds.length;interiorNodeIds.push(i+1);}});
  fineLayerByNode.forEach((z,i)=>{if(z===plan.periodFineLayers){const idx=bottom.get(xyKeys[i]!);if(idx===undefined)throw new Error("unmatched periodic top node");planeIndexByNode[i]=idx;
    const p=motif.nodes[bottomNodeIds[idx]!-1]!;if(p[0]!==motif.nodes[i]![0]||p[1]!==motif.nodes[i]![1])throw new Error("periodic geometry mismatch");}});
  if(motif.nodes.length!==2*bottomNodeIds.length+interiorNodeIds.length)throw new Error("periodic node layout mismatch");
  const quality=auditMotif(motif,plan,regions,planeIndexByNode);
  if(spec.minimumCornerScaledJacobian!==undefined&&quality.minimumCornerScaledJacobian<spec.minimumCornerScaledJacobian){
    throw new Error(`concentric minimum corner SJ ${quality.minimumCornerScaledJacobian} violates requested limit ${spec.minimumCornerScaledJacobian}`);
  }
  const nodes=(plan.repetitions+1)*bottomNodeIds.length+plan.repetitions*interiorNodeIds.length;
  if(!Number.isSafeInteger(nodes)||nodes>99999999||plan.expectedElements>99999999)throw new RangeError("ordinary LS-DYNA ID field overflow");
  return {motif,plan,layout:{bottomNodeIds,interiorNodeIds,planeIndexByNode,interiorIndexByNode,fineLayerByNode},regions,
    counts:{nodes,elements:plan.expectedElements},quality};
}

function auditMotif(mesh:Mesh,plan:ConcentricCircularPlan,regions:PreparedConcentricCircularMesh["regions"],plane:number[]):PreparedConcentricCircularMesh["quality"] {
  const faces=new Map<string,{ids:number[];count:number}>(),cells=new Set<string>(),stats:Record<string,ConcentricRegionQuality>={};
  const edges=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  let minSJ=Infinity,minGauss=Infinity,volume=0,correction=0,region=0,minEdge=Infinity;
  for(const [i,e] of mesh.elements.entries()){
    while(i+1>regions[region]!.endElementId)region++;
    const key=[...e].sort((a,b)=>a-b).join(":");
    if(new Set(e).size!==8||cells.has(key))throw new Error("duplicate or degenerate concentric cell");cells.add(key);
    const p=e.map(id=>mesh.nodes[id-1]!),sj=minimumHexCornerScaledJacobian(p),v=hexElementSignedVolume(p),y=v-correction,t=volume+y;
    correction=(t-volume)-y;volume=t;minSJ=Math.min(minSJ,sj);
    const lengths=edges.map(([a,b])=>Math.hypot(...p[a!]!.map((x,j)=>x-p[b!]![j]!))),lo=Math.min(...lengths),hi=Math.max(...lengths);
    minEdge=Math.min(minEdge,lo);
    const s=stats[regions[region]!.name]??={elements:0,minimumCornerScaledJacobian:Infinity,minimumEdge:Infinity,maximumEdge:0,maximumEdgeAspectRatio:0};
    s.elements++;s.minimumCornerScaledJacobian=Math.min(s.minimumCornerScaledJacobian,sj);s.minimumEdge=Math.min(s.minimumEdge,lo);s.maximumEdge=Math.max(s.maximumEdge,hi);s.maximumEdgeAspectRatio=Math.max(s.maximumEdgeAspectRatio,hi/lo);
    for(const u of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const vv of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const w of [-1/Math.sqrt(3),1/Math.sqrt(3)]){
      const [a,b,c]=hexJacobian(p,u,vv,w);const det=a![0]!*(b![1]!*c![2]!-b![2]!*c![1]!)-a![1]!*(b![0]!*c![2]!-b![2]!*c![0]!)+a![2]!*(b![0]!*c![1]!-b![1]!*c![0]!);minGauss=Math.min(minGauss,det);
    }
    for(const f of H1_FACES){const ids=f.map(j=>e[j-1]!),key=[...ids].sort((a,b)=>a-b).join(":"),old=faces.get(key);if(old){if(++old.count>2)throw new Error("nonmanifold concentric face");}else faces.set(key,{ids,count:1});}
  }
  if(!(minSJ>0&&minGauss>0&&Number.isFinite(volume)&&Number.isFinite(minGauss)))throw new Error("nonpositive or unresolved concentric Jacobian");
  let unexpected=0;const lower:string[]=[],upper:string[]=[];
  for(const f of faces.values())if(f.count===1){
    const p=f.ids.map(id=>mesh.nodes[id-1]!),bottom=p.every(q=>q[2]===0),top=p.every(q=>q[2]===plan.periodHeight);
    if(bottom||top)(bottom?lower:upper).push(f.ids.map(id=>plane[id-1]!).sort((a,b)=>a-b).join(":"));
    else if(!(p.every(q=>Math.abs(Math.hypot(q[0]!,q[1]!)-plan.radius)<plan.radius*1e-12)
      ||(plan.modelFraction!=="full"&&p.every(q=>q[1]===0))||(plan.modelFraction==="quarter"&&p.every(q=>q[0]===0))))unexpected++;
  }
  if(unexpected)throw new Error(`concentric motif has ${unexpected} unmatched internal faces`);
  if(JSON.stringify(lower.sort())!==JSON.stringify(upper.sort()))throw new Error("concentric periodic face partitions mismatch");
  if(!checkNoHangingNodes(mesh,minEdge*1e-8).ok)throw new Error("concentric motif has hanging nodes");
  const totalVolume=volume*plan.repetitions,error=Math.abs(totalVolume/plan.discreteVolume-1);
  if(!Number.isFinite(error)||error>1e-8)throw new Error("concentric discrete volume mismatch");
  const warnings=["Outer angular, radial and axial sizes are reported separately; no isotropic outer-size guarantee.",
    "Periodic transition traces are closed repeating patterns, not a promise of one horizontal surface phase."];
  if(minSJ<.2)warnings.push("Low transition SJ requires engineering review.");
  return {minimumCornerScaledJacobian:minSJ,minimumGaussDeterminant:minGauss,volume:totalVolume,
    relativeDiscreteVolumeError:error,relativeAnalyticVolumeError:Math.abs(totalVolume/plan.analyticVolume-1),unexpectedInternalFreeFaces:0,
    hangingCheckPassed:true,periodicPartitionsIdentical:true,regions:stats,warnings,engineeringAcceptanceVerified:false};
}

export function* iterateConcentricCircularNodes(prepared:PreparedConcentricCircularMesh):Generator<Point> {
  const {motif,plan,layout:l}=prepared;
  for(let k=0;k<=plan.repetitions;k++)for(const id of l.bottomNodeIds){const p=motif.nodes[id-1]!;yield [p[0]!,p[1]!,plan.height*(k*plan.periodFineLayers/plan.axialSegments)];}
  for(let k=0;k<plan.repetitions;k++)for(const id of l.interiorNodeIds){const p=motif.nodes[id-1]!;yield [p[0]!,p[1]!,plan.height*((k*plan.periodFineLayers+l.fineLayerByNode[id-1]!)/plan.axialSegments)];}
}
export function* iterateConcentricCircularElements(prepared:PreparedConcentricCircularMesh):Generator<number[]> {
  const {motif,plan,layout:l}=prepared,n=l.bottomNodeIds.length,m=l.interiorNodeIds.length;
  for(let k=0;k<plan.repetitions;k++){
    const ids=motif.nodes.map((_,i)=>l.planeIndexByNode[i]!>=0?
      (k+(l.fineLayerByNode[i]===plan.periodFineLayers?1:0))*n+l.planeIndexByNode[i]!+1:
      (plan.repetitions+1)*n+k*m+l.interiorIndexByNode[i]!+1);
    for(const e of motif.elements)yield e.map(id=>ids[id-1]!);
  }
}
/** Convenience materialization for small models; use the iterators for large K exports. */
export function generateConcentricCircularMesh(spec:ConcentricCircularSpec) {
  const plan=planConcentricCircularMesh(spec);
  if(plan.expectedElements>2000000)throw new RangeError("materialized mesh exceeds two million cells; use prepareConcentricCircularMesh and streaming iterators");
  const result=prepareConcentricCircularMesh(spec);
  return {...result,mesh:{kind:"H1" as const,nodes:[...iterateConcentricCircularNodes(result)],elements:[...iterateConcentricCircularElements(result)]}};
}
