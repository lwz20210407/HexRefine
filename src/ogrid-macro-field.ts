import type {Mesh,RefinementRole} from "./types.js";
import {H1_FACES,boundaryKey} from "./topology.js";
import {minElementEdgeLength} from "./mesh.js";
import {compileGradedShellReferences,hierarchicalShellCount} from "./hierarchical-macro-library.js";
import {properCubeRotations,rotateTwoWay7Template,instantiateTwoWay7Template,type TwoWay7ReferenceTemplate,type ReferencePoint3} from "./two-to-one-templates.js";
import {solveAffineTemplateDomains} from "./two-to-one-affine-domains-internal.js";
import {buildAuditedHexRefinementOutput} from "./refinement-errors.js";
import type {TwoToOneReplacement} from "./two-to-one.js";
import {conserveTransitionFaceFlux} from "./transition-face-flux.js";
import {minimumHexCornerScaledJacobian,hexElementSignedVolume} from "./hex-quality.js";
import {checkNoHangingNodes} from "./conformance.js";
import {hexJacobian} from "./hex-quality-internal.js";
import {determinant3Scaled,scaledValueSign} from "./hex-numeric-internal.js";
import {proposeAxialStations} from "./axial-station-planner.js";

export interface OgridMacroFieldOptions {
  axis:0|1|2;
  targets:readonly {elementId:number;level:1|2|3}[];
  maxOutputElements?:number;
  maxShellParents?:number;
  maximumSearchDecisions?:number;
  transitionGeometry?:"trilinear"|"conservative-face-flux";
  maximumFaceDisplacementFraction?:number;
  minimumCornerScaledJacobian?:number;
  exteriorPhasePolicy?:"level-closed"|"unconstrained";
  symmetryPlanes?:readonly {axis:0|1|2;coordinate:number}[];
  /** Spread the finite level drop over up to three original-parent layers; default compact1. */
  shellLayers?:1|2|3;
  maxAdditionalShellParents?:number;
  minimumTransitionToCoreEdgeRatio?:number;
}
type Template=TwoWay7ReferenceTemplate;
const C:readonly ReferencePoint3[]=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const opposite=[1,0,3,2,5,4];
type Partition=readonly (readonly ReferencePoint3[])[];
const library=new Map<string,readonly {template:Template;partitions:Partition[]}[]>();
const uniformCache=new Map<number,Template>();
const EDGES=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
function edgeSizes(p:readonly (readonly number[])[]){let minimum=Infinity,maximum=0;for(const [a,b] of EDGES){const length=Math.hypot(...p[a!]!.map((v,i)=>v-p[b!]![i]!));minimum=Math.min(minimum,length);maximum=Math.max(maximum,length);}return{minimum,aspect:maximum/minimum};}
const gauss=[-1/Math.sqrt(3),1/Math.sqrt(3)];
function positiveGauss(points:readonly (readonly number[])[]){
  for(const u of gauss)for(const v of gauss)for(const w of gauss)if(scaledValueSign(determinant3Scaled(hexJacobian(points,u,v,w)))<=0)return false;
  return true;
}
function uniform(depth:number):Template {
  const cached=uniformCache.get(depth);if(cached)return cached;
  const n=2**depth,nodes:ReferencePoint3[]=[],elements:number[][]=[],id=(i:number,j:number,k:number)=>i+(n+1)*j+(n+1)**2*k;
  for(let k=0;k<=n;k++)for(let j=0;j<=n;j++)for(let i=0;i<=n;i++)nodes.push([2*i/n-1,2*j/n-1,2*k/n-1]);
  for(let k=0;k<n;k++)for(let j=0;j<n;j++)for(let i=0;i<n;i++)elements.push([id(i,j,k),id(i+1,j,k),id(i+1,j+1,k),id(i,j+1,k),id(i,j,k+1),id(i+1,j,k+1),id(i+1,j+1,k+1),id(i,j+1,k+1)]);
  const t={name:`tensor${n**3}`,nodes,elements};uniformCache.set(depth,t);return t;
}
function partitions(t:Template):Partition[]{
  const faces=new Map<string,{nodes:number[];count:number}>();
  for(const e of t.elements)for(const f of H1_FACES){const nodes=f.map(n=>e[n-1]!),key=boundaryKey(nodes),p=faces.get(key)??{nodes,count:0};p.count++;if(p.count>2)throw new Error("nonmanifold compiled macro");faces.set(key,p);}
  const result:ReferencePoint3[][][]=H1_FACES.map(()=>[]);
  for(const p of faces.values())if(p.count===1){
    const coords=p.nodes.map(n=>t.nodes[n]!);
    const face=H1_FACES.findIndex(f=>[0,1,2].some(a=>f.every(n=>C[n-1]![a]===C[f[0]!-1]![a])&&coords.every(q=>q[a]===C[f[0]!-1]![a])));
    if(face<0)throw new Error("compiled macro has an internal free face");result[face]!.push(coords);
  }
  return result;
}
function candidates(depth:1|2|3,coarseDepth:0|1|2){
  const key=`${depth}:${coarseDepth}`,cached=library.get(key);if(cached)return cached;
  const result:Array<{template:Template;partitions:Partition[]}>=[],seen=new Set<string>();
  for(const base of compileGradedShellReferences(depth,coarseDepth))for(const matrix of properCubeRotations()){
    const template=rotateTwoWay7Template(base,matrix),p=partitions(template);
    const key=p.map(f=>f.map(q=>q.map(n=>n.join(",")).sort().join("|")).sort().join(";")).join("/");
    if(!seen.has(key)){seen.add(key);result.push({template,partitions:p});}
  }
  library.set(key,result);return result;
}
function signature(parent:readonly number[],partition:Partition):string {
  return partition.map(q=>q.map(p=>C.map((c,i)=>({id:parent[i]!,w:c.reduce((v,s,a)=>v*(1+s*p[a]!)/2,1)}))
    .filter(v=>v.w!==0).sort((a,b)=>a.id-b.id).map(v=>`${v.id}:${v.w}`).join(",")).sort().join("|")).sort().join(";");
}
export class OgridMacroFieldError extends Error {
  constructor(readonly code:string,message:string,readonly parentIds:readonly number[]=[],readonly faceNodeIds:readonly number[]=[],
    readonly conflictingInterfaces:readonly {firstParentId:number;secondParentId:number;kind:"shared-face"|"exterior-phase";nodeIds:readonly number[]}[]=[]) {super(message);this.name="OgridMacroFieldError";}
}

/** Direct whole-original-parent installation. No original node movement or hidden core promotion. */
export function refineOgridMacroField(source:Mesh,options:OgridMacroFieldOptions){
  if(!options||Object.keys(options).some(k=>!["axis","targets","maxOutputElements","maxShellParents","maximumSearchDecisions","transitionGeometry","maximumFaceDisplacementFraction","minimumCornerScaledJacobian","exteriorPhasePolicy","symmetryPlanes","shellLayers","maxAdditionalShellParents","minimumTransitionToCoreEdgeRatio"].includes(k))||![0,1,2].includes(options.axis))throw new RangeError("invalid macro-field options");
  if(source.kind!=="H1"||!source.elements.length||source.nodes.some(p=>p.length!==3||p.some(v=>!Number.isFinite(v))))throw new RangeError("macro field requires finite 3D H8 input");
  const limit=options.maxOutputElements??2000000,shellLimit=options.maxShellParents??4096,searchLimit=options.maximumSearchDecisions??4096;
  if(![limit,shellLimit,searchLimit].every(n=>Number.isSafeInteger(n)&&n>0)||limit>2000000||shellLimit>8192||searchLimit>100000)throw new RangeError("invalid macro-field budgets");
  if(options.transitionGeometry!==undefined&&!["trilinear","conservative-face-flux"].includes(options.transitionGeometry))throw new RangeError("invalid transition geometry");
  if(options.maximumFaceDisplacementFraction!==undefined&&(options.transitionGeometry!=="conservative-face-flux"||!Number.isFinite(options.maximumFaceDisplacementFraction)||options.maximumFaceDisplacementFraction<=0||options.maximumFaceDisplacementFraction>.05))throw new RangeError("invalid conservative face budget");
  if(options.minimumCornerScaledJacobian!==undefined&&(!Number.isFinite(options.minimumCornerScaledJacobian)||options.minimumCornerScaledJacobian<=0||options.minimumCornerScaledJacobian>1))throw new RangeError("invalid minimum corner SJ");
  if(options.exteriorPhasePolicy!==undefined&&!["level-closed","unconstrained"].includes(options.exteriorPhasePolicy))throw new RangeError("invalid exterior phase policy");
  if(options.minimumTransitionToCoreEdgeRatio!==undefined&&(!Number.isFinite(options.minimumTransitionToCoreEdgeRatio)||options.minimumTransitionToCoreEdgeRatio<=0))throw new RangeError("invalid transition/core minimum edge ratio");
  const shellLayers=options.shellLayers??1,additionalLimit=options.maxAdditionalShellParents??0;
  if(![1,2,3].includes(shellLayers)||!Number.isSafeInteger(additionalLimit)||additionalLimit<0||additionalLimit>8192)throw new RangeError("invalid shell layer/expansion budget");
  const targets=new Map<number,1|2|3>();
  if(!Array.isArray(options.targets)||!options.targets.length)throw new RangeError("explicit target parents are required");
  for(const t of options.targets){if(!t||Object.keys(t).some(k=>!["elementId","level"].includes(k))||!Number.isSafeInteger(t.elementId)||t.elementId<1||t.elementId>source.elements.length||![1,2,3].includes(t.level)||targets.has(t.elementId))throw new RangeError("invalid or duplicate macro target");targets.set(t.elementId,t.level);}
  const incidence=new Map<string,{parent:number;face:number}[]>();
  source.elements.forEach((e,i)=>{
    if(e.length!==8||new Set(e).size!==8||e.some(n=>!Number.isSafeInteger(n)||n<1||n>source.nodes.length))throw new RangeError("invalid source H8 connectivity");
    for(const [face,f] of H1_FACES.entries()){const key=boundaryKey(f.map(n=>e[n-1]!)),owners=incidence.get(key)??[];owners.push({parent:i+1,face});if(owners.length>2)throw new RangeError("nonmanifold source face");incidence.set(key,owners);}
  });
  const shells=new Map<number,{face:number;depth:1|2|3;coarseDepth:0|1|2;layer:number}>();
  for(const [key,owners] of incidence)if(owners.length===2){const [a,b]=owners;const da=targets.get(a!.parent),db=targets.get(b!.parent);
    if(da&&db&&da!==db)throw new OgridMacroFieldError("adjacent-core-levels","Different exact tensor cores cannot share an unsplit source face; provide a transition parent between them.",[a!.parent,b!.parent]);
    if(!!da===!!db)continue;
    const owner=da?b!:a!,depth=(da??db)!;
    if(shells.has(owner.parent))throw new OgridMacroFieldError("multiple-fine-faces","This whole-parent library requires one fine interface per shell parent; dedicated edge/two-front vocabularies are still needed.",[owner.parent],key.split(":").map(Number));
    shells.set(owner.parent,{face:owner.face,depth,coarseDepth:(shellLayers>1?depth-1:0) as 0|1|2,layer:1});
  }
  const initialShellParents=[...shells.keys()],queue=[...initialShellParents];
  for(let i=0;i<queue.length;i++){
    const parent=queue[i]!,shell=shells.get(parent)!;if(shell.coarseDepth===0)continue;
    const key=boundaryKey(H1_FACES[opposite[shell.face]!]!.map(n=>source.elements[parent-1]![n-1]!)),owners=incidence.get(key)!;
    if(owners.length!==2)throw new OgridMacroFieldError("insufficient-shell-depth","The requested layered shell reaches the specimen end before its level drop is complete.",[parent]);
    const other=owners.find(o=>o.parent!==parent)!;
    if(targets.has(other.parent)||shells.has(other.parent))throw new OgridMacroFieldError("shell-collision","Layered shells collide; no automatic merging or core/far-field swallowing is allowed.",[parent,other.parent]);
    if(shells.size-initialShellParents.length>=additionalLimit)throw new OgridMacroFieldError("shell-expansion-budget","Layered macro installation requires explicit additional transition-parent budget.",[other.parent]);
    const depth=shell.coarseDepth,layer=shell.layer+1,coarseDepth=(layer<shellLayers?depth-1:0) as 0|1|2;
    shells.set(other.parent,{face:other.face,depth,coarseDepth,layer});queue.push(other.parent);
  }
  if(!shells.size||shells.size>shellLimit)throw new OgridMacroFieldError("shell-budget","No shell was selected or maxShellParents was exceeded.");
  const count=source.elements.length+[...targets.values()].reduce((s,d)=>s+8**d-1,0)+[...shells.values()].reduce((s,v)=>s+hierarchicalShellCount(v.depth,v.coarseDepth)-1,0);
  if(!Number.isSafeInteger(count)||count>limit)throw new OgridMacroFieldError("output-budget","Complete core and shell exceed maxOutputElements before allocation.");
  if(targets.size+shells.size>=source.elements.length)throw new OgridMacroFieldError("no-far-field","The requested patch consumes all coarse far-field parents.");
  const tolerance=minElementEdgeLength(source)*1e-8;
  if(!(tolerance>0)||!checkNoHangingNodes(source,tolerance).ok)throw new RangeError("source interfaces must be conforming");
  for(const [id,shell] of shells){const z=H1_FACES[shell.face]!.map(n=>source.nodes[source.elements[id-1]![n-1]!-1]![options.axis]!);
    if(Math.max(...z)-Math.min(...z)>tolerance*100)throw new OgridMacroFieldError("non-axial-interface","A fine source interface is not perpendicular to the declared extrusion axis.",[id]);
  }
  const sourceMinimumSJ:number[]=[];
  for(const e of source.elements){const points=e.map(n=>source.nodes[n-1]!),sj=minimumHexCornerScaledJacobian(points);sourceMinimumSJ.push(sj);if(!(sj>0)||!positiveGauss(points))throw new RangeError("source has a nonpositive sampled Jacobian");}
  if(options.symmetryPlanes){
    if(!Array.isArray(options.symmetryPlanes))throw new RangeError("invalid symmetry planes");
    for(const p of options.symmetryPlanes){
      if(!p||Object.keys(p).some(k=>!["axis","coordinate"].includes(k))||![0,1,2].includes(p.axis)||p.axis===options.axis||!Number.isFinite(p.coordinate))throw new RangeError("invalid lateral symmetry plane");
      let lo=Infinity,hi=-Infinity;for(const n of source.nodes){lo=Math.min(lo,n[p.axis]!);hi=Math.max(hi,n[p.axis]!);}
      if(Math.min(Math.abs(p.coordinate-lo),Math.abs(p.coordinate-hi))>tolerance*100)throw new RangeError("symmetry phase exemption must be an exterior coordinate plane");
    }
  }
  const parentIds=[...shells.keys()].sort((a,b)=>a-b),variable=new Map(parentIds.map((p,i)=>[p,i]));
  const local=parentIds.map(id=>{
    const {depth,coarseDepth,face}=shells.get(id)!,op=opposite[face]!;
    return candidates(depth,coarseDepth).filter(c=>c.partitions[face]!.length===4**depth&&c.partitions[op]!.length===4**coarseDepth);
  });
  const signatures=local.map((cs,i)=>cs.map(c=>c.partitions.map(p=>signature(source.elements[parentIds[i]!-1]!,p))));
  let domains=local.map(cs=>cs.map((_,i)=>i));
  const constraints:Array<{first:number;second:number;firstFace:number;secondFace:number;nodeIds:number[];phase?:boolean}>=[];
  const tensorFaces=new Map<number,Partition[]>();
  for(const d of [1,2,3])tensorFaces.set(d,partitions(uniform(d)));
  for(const owners of incidence.values())if(owners.length===2){
    const [a,b]=owners,v=variable.get(a!.parent),w=variable.get(b!.parent);
    if(v!==undefined&&w!==undefined){constraints.push({first:v,second:w,firstFace:a!.face,secondFace:b!.face,nodeIds:H1_FACES[a!.face]!.map(n=>source.elements[a!.parent-1]![n-1]!)});continue;}
    if(v===undefined&&w===undefined)continue;
    const vi=v??w!,here=v!==undefined?a!:b!,other=v!==undefined?b!:a!,depth=targets.get(other.parent);
    const p=depth?tensorFaces.get(depth)![other.face]!:[H1_FACES[other.face]!.map(n=>C[n-1]!)];
    const fixed=signature(source.elements[other.parent-1]!,p);
    domains[vi]=domains[vi]!.filter(c=>signatures[vi]![c]![here.face]===fixed);
    if(!domains[vi]!.length)throw new OgridMacroFieldError("fixed-boundary","No compiled macro matches a protected core/far-field face.",[here.parent,other.parent]);
  }
  const freeFaces=parentIds.map(()=>[] as number[]);
  for(const owners of incidence.values())if(owners.length===1){const o=owners[0]!,v=variable.get(o.parent);if(v===undefined)continue;
    const entry=shells.get(o.parent)!;if(o.face===entry.face||o.face===opposite[entry.face])continue;
    const face=H1_FACES[o.face]!.map(n=>source.nodes[source.elements[o.parent-1]![n-1]!-1]!);
    if(!options.symmetryPlanes?.some(p=>face.every(n=>Math.abs(n[p.axis]!-p.coordinate)<=tolerance*100)))freeFaces[v]!.push(o.face);
  }
  const phase=(v:number,c:number,face:number)=>{
    const fineFace=H1_FACES[shells.get(parentIds[v]!)!.face]!,axial=[0,1,2].find(a=>fineFace.every(n=>C[n-1]![a]===C[fineFace[0]!-1]![a]))!,side=C[fineFace[0]!-1]![axial]!;
    const edges=new Map<string,readonly [ReferencePoint3,ReferencePoint3]>();
    for(const quad of local[v]![c]!.partitions[face]!)quad.forEach((a,i)=>{const b=quad[(i+1)%4]!;edges.set([a.join(","),b.join(",")].sort().join("|"),[a,b]);});
    return [...edges.values()].filter(([a,b])=>a[axial]!==b[axial]&&[0,1,2].some(k=>k!==axial&&a[k]!==b[k]))
      .map(([a,b])=>[(1+side*a[axial]!)/2,(1+side*b[axial]!)/2].sort((a,b)=>a-b).join(":")).sort().join(",");
  };
  const phaseSignatures=local.map((cs,v)=>cs.map((_,c)=>freeFaces[v]!.map(f=>phase(v,c,f))));
  if((options.exteriorPhasePolicy??"level-closed")==="level-closed"){
    domains=domains.map((values,v)=>values.filter(c=>new Set(phaseSignatures[v]![c]).size<=1));
    if(domains.some(v=>!v.length))throw new OgridMacroFieldError("exterior-phase","A shell parent has no level-closed exterior trace in this vocabulary.",parentIds);
    const sets=parentIds.map((_,i)=>i),find=(i:number):number=>{while(sets[i]!==i){sets[i]=sets[sets[i]!]!;i=sets[i]!;}return i;};
    for(const c of constraints){const a=shells.get(parentIds[c.first]!)!,b=shells.get(parentIds[c.second]!)!;
      if(a.depth===b.depth&&a.coarseDepth===b.coarseDepth&&c.firstFace!==a.face&&c.firstFace!==opposite[a.face])sets[find(c.first)]=find(c.second);
    }
    const groups=new Map<number,number[]>();parentIds.forEach((_,v)=>{if(freeFaces[v]!.length){const group=groups.get(find(v))??[];group.push(v);groups.set(find(v),group);}});
    for(const group of groups.values())for(const v of group.slice(1))constraints.push({first:group[0]!,second:v,firstFace:0,secondFace:0,nodeIds:[],phase:true});
  }
  const value=(v:number,c:number,face:number,isPhase:boolean|undefined)=>isPhase?phaseSignatures[v]![c]![0]!:signatures[v]![c]![face]!;
  let decisions=0;
  const encounteredConflicts=new Set<number>();
  const supports=constraints.map(c=>new Map(domains[c.first]!.map(a=>[a,new Set(domains[c.second]!.filter(b=>value(c.first,a,c.firstFace,c.phase)===value(c.second,b,c.secondFace,c.phase)))])));
  const solve=(values:number[][]):number[]|undefined=>{
    let changed=true;
    while(changed){changed=false;for(const [i,c] of constraints.entries()){
      const a=values[c.first]!.filter(a=>values[c.second]!.some(b=>supports[i]!.get(a)?.has(b))),b=values[c.second]!.filter(b=>a.some(a=>supports[i]!.get(a)?.has(b)));
      if(!a.length||!b.length){encounteredConflicts.add(i);return undefined;}
      if(a.length!==values[c.first]!.length||b.length!==values[c.second]!.length){changed=true;values[c.first]=a;values[c.second]=b;}
    }}
    const affine=solveAffineTemplateDomains(values,constraints,supports);
    if(affine.kind==="satisfiable")return affine.solution;
    if(affine.kind==="unsatisfiable"){affine.constraintIndices.forEach(i=>encounteredConflicts.add(i));return undefined;}
    const unresolved=values.map((v,i)=>({i,n:v.length})).filter(v=>v.n>1).sort((a,b)=>a.n-b.n)[0];
    if(!unresolved)return values.map(v=>v[0]!);
    for(const candidate of values[unresolved.i]!){if(++decisions>searchLimit)throw new OgridMacroFieldError("search-budget","Macro-field search budget exhausted; no infeasibility claim is made.");
      const next=values.map(v=>[...v]);next[unresolved.i]=[candidate];const result=solve(next);if(result)return result;
    }return undefined;
  };
  const solution=solve(domains);
  if(!solution){
    const conflicts=[...encounteredConflicts].sort((a,b)=>a-b).map(i=>constraints[i]!).map(c=>({firstParentId:parentIds[c.first]!,secondParentId:parentIds[c.second]!,kind:c.phase?"exterior-phase" as const:"shared-face" as const,nodeIds:c.nodeIds}));
    throw new OgridMacroFieldError("incompatible-field","No complete shared-face macro field exists in the compiled finite vocabulary. Encountered conflicts are not claimed minimal.",
      [...new Set(conflicts.flatMap(c=>[c.firstParentId,c.secondParentId]))],conflicts.find(c=>c.nodeIds.length)?.nodeIds??[],conflicts);
  }
  for(const c of constraints)if(value(c.first,solution[c.first]!,c.firstFace,c.phase)!==value(c.second,solution[c.second]!,c.secondFace,c.phase))throw new Error("macro field witness failed exact constraint verification");
  const core:TwoToOneReplacement[]=[...targets].sort(([a],[b])=>a-b).map(([id,depth])=>{
    const t=uniform(depth);return {elementId:id,role:"selected",templateCode:8**depth,referenceNodes:t.nodes,refinement:instantiateTwoWay7Template(source.elements[id-1]!.map(n=>source.nodes[n-1]!),t,t.name)};
  });
  let coreMinimumEdge=Infinity;
  for(const r of core)for(const e of r.refinement.elements){const points=e.map(n=>r.refinement.nodes[n-1]!);if(!positiveGauss(points))throw new OgridMacroFieldError("core-quality","Exact tensor core has a nonpositive Gauss sample.",[r.elementId]);coreMinimumEdge=Math.min(coreMinimumEdge,edgeSizes(points).minimum);}
  const groupKey=(id:number)=>{const shell=shells.get(id)!;return`${shell.depth}:${shell.coarseDepth}`;};
  const stationPatches=parentIds.map((id,v)=>({group:groupKey(id),template:local[v]![solution[v]!]!.template,
    fineFace:shells.get(id)!.face,vertices:source.elements[id-1]!.map(n=>source.nodes[n-1]!)}));
  const requestedStationEdge=coreMinimumEdge*(options.minimumTransitionToCoreEdgeRatio??1);
  let stationProposals=proposeAxialStations(stationPatches,options.axis,requestedStationEdge*1.01),stationMargin=1.01;
  if([...stationProposals.values()].some(p=>!p.feasible)){stationProposals=proposeAxialStations(stationPatches,options.axis,requestedStationEdge);stationMargin=1;}
  let best:{replacements:TwoToOneReplacement[];minimumSJ:number;exponent:number|null;stationBlend:number|null;geometry:unknown;edgeRatio:number;edgeAspect:number}|undefined;
  const trials:Array<{exponent?:number;stationBlend?:number;minimumSJ?:number;edgeRatio?:number;error?:string}>=[];
  const mappings=[...([.25,.3,.4,.5,.65,.8,1].map(exponent=>({exponent,stationBlend:null as number|null}))),
    ...([...stationProposals.values()].every(p=>p.feasible)?[.1,.25,.5,.75,.9].map(stationBlend=>({exponent:null,stationBlend})):[])];
  for(const mapping of mappings){
    const {exponent,stationBlend}=mapping;
    const replacements=[...core];
    for(const [v,id] of parentIds.entries()){
      const entry=shells.get(id)!,candidate=local[v]![solution[v]!]!,face=H1_FACES[entry.face]!;
      const axial=[0,1,2].find(a=>face.every(n=>C[n-1]![a]===C[face[0]!-1]![a]))!,side=C[face[0]!-1]![axial]!;
      const proposal=stationProposals.get(groupKey(id))!,positions=new Map(proposal.stations.map((s,i)=>[s,proposal.earliest[i]!+(stationBlend??0)*(proposal.latest[i]!-proposal.earliest[i]!)]));
      const nodes=candidate.template.nodes.map(p=>{const q=[...p],w=(1-side*q[axial]!)/2,mapped=exponent===null?positions.get(w)!:w**exponent;q[axial]=side*(1-2*mapped);return q as unknown as ReferencePoint3;});
      const t={...candidate.template,nodes};replacements.push({elementId:id,role:"face-transition",templateCode:t.elements.length,referenceNodes:nodes,refinement:instantiateTwoWay7Template(source.elements[id-1]!.map(n=>source.nodes[n-1]!),t,t.name)});
    }
    replacements.sort((a,b)=>a.elementId-b.elementId);
    try{
      const mapped=options.transitionGeometry==="conservative-face-flux"?conserveTransitionFaceFlux(source,{strategy:"hierarchical-shell",replacements},options.maximumFaceDisplacementFraction):null;
      const used=mapped?.replacements??replacements;
      let sj=Infinity,positive=true,edge=Infinity,aspect=0;for(const r of used)if(r.role!=="selected")for(const e of r.refinement.elements){const points=e.map(n=>r.refinement.nodes[n-1]!);sj=Math.min(sj,minimumHexCornerScaledJacobian(points));if(!positiveGauss(points))positive=false;const sizes=edgeSizes(points);edge=Math.min(edge,sizes.minimum);aspect=Math.max(aspect,sizes.aspect);}
      const edgeRatio=edge/coreMinimumEdge,edgeOk=edgeRatio>=(options.minimumTransitionToCoreEdgeRatio??0),label=exponent===null?{stationBlend:stationBlend!}:{exponent};
      trials.push({...label,minimumSJ:sj,edgeRatio,...(!positive?{error:"nonpositive Gauss sample"}:!edgeOk?{error:"transition/core edge gate failed"}:{})});
      if(sj>0&&positive&&edgeOk&&(!best||sj>best.minimumSJ))best={replacements:used,minimumSJ:sj,exponent,stationBlend,geometry:mapped?.report??null,edgeRatio,edgeAspect:aspect};
    }catch(e){trials.push({...exponent===null?{stationBlend:stationBlend!}:{exponent},error:String(e)});}
  }
  if(!best)throw new OgridMacroFieldError("mapped-quality","No mapped candidate meets positive sampled Jacobians and the configured edge floor in this finite station family. "+JSON.stringify(trials.slice(0,2)),parentIds);
  if(options.minimumCornerScaledJacobian!==undefined&&best.minimumSJ<options.minimumCornerScaledJacobian)throw new OgridMacroFieldError("requested-quality","Best sampled shell SJ is below the requested gate.",parentIds);
  const result=buildAuditedHexRefinementOutput(source,best.replacements,tolerance,true,2),replaced=new Set(best.replacements.map(r=>r.elementId));
  const outputParents=source.elements.flatMap((_,i)=>replaced.has(i+1)?[]:[i+1]);for(const r of best.replacements)for(const _ of r.refinement.elements)outputParents.push(r.elementId);
  if(result.mesh.elements.length!==count||outputParents.length!==count)throw new Error("direct macro count differs from the complete preflight");
  if(JSON.stringify(result.mesh.nodes.slice(0,source.nodes.length))!==JSON.stringify(source.nodes))throw new Error("installation changed original source nodes");
  const farField=source.elements.flatMap((_,i)=>replaced.has(i+1)?[]:[i+1]);
  farField.forEach((id,i)=>{if(JSON.stringify(result.mesh.elements[i])!==JSON.stringify(source.elements[id-1]))throw new Error("far-field connectivity changed");});
  let minimumOverallSJ=result.quality.childMinimumOrientedScaledJacobian;for(const id of farField)minimumOverallSJ=Math.min(minimumOverallSJ,sourceMinimumSJ[id-1]!);
  if(options.minimumCornerScaledJacobian!==undefined&&minimumOverallSJ<options.minimumCornerScaledJacobian)throw new OgridMacroFieldError("requested-quality","Core or far-field SJ is below the requested gate.");
  let offset=farField.length,maximumCoreCoordinateError=0,maximumParentRelativeVolumeError=0,actualCoreEdge=Infinity,actualTransitionEdge=Infinity,actualTransitionAspect=0;
  for(const r of best.replacements){
    let childVolume=0;const expectedNodes=r.refinement.nodes;
    for(const child of r.refinement.elements){
      const element=result.mesh.elements[offset++]!,points=element.map(n=>result.mesh.nodes[n-1]!);childVolume+=hexElementSignedVolume(points);
      if(!positiveGauss(points))throw new OgridMacroFieldError("final-gauss","Merged output has a nonpositive Gauss sample.",[r.elementId]);
      const sizes=edgeSizes(points);if(r.role==="selected")actualCoreEdge=Math.min(actualCoreEdge,sizes.minimum);else{actualTransitionEdge=Math.min(actualTransitionEdge,sizes.minimum);actualTransitionAspect=Math.max(actualTransitionAspect,sizes.aspect);}
      if(r.role==="selected")for(let i=0;i<8;i++)for(let a=0;a<3;a++)maximumCoreCoordinateError=Math.max(maximumCoreCoordinateError,Math.abs(result.mesh.nodes[element[i]!-1]![a]!-expectedNodes[child[i]!-1]![a]!));
    }
    const parentVolume=hexElementSignedVolume(source.elements[r.elementId-1]!.map(n=>source.nodes[n-1]!)),error=Math.abs(childVolume-parentVolume)/Math.abs(parentVolume);
    maximumParentRelativeVolumeError=Math.max(maximumParentRelativeVolumeError,error);
    if(error>1e-8)throw new OgridMacroFieldError("parent-volume","An installed macro fails its original-parent volume contract.",[r.elementId]);
  }
  if(maximumCoreCoordinateError>tolerance/100)throw new OgridMacroFieldError("protected-core","Node merging changed the exact tensor core beyond the protected precision budget.");
  const actualEdgeRatio=actualTransitionEdge/actualCoreEdge;
  if(options.minimumTransitionToCoreEdgeRatio!==undefined&&actualEdgeRatio<options.minimumTransitionToCoreEdgeRatio)throw new OgridMacroFieldError("final-edge-floor","Merged output fails the unchanged transition/core edge floor.");
  const edgeTemplates=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]],edgeParents=new Map<string,number[]>(),freeEdges=new Set<string>();
  for(const owners of incidence.values())if(owners.length===1){const o=owners[0]!,e=source.elements[o.parent-1]!,f=H1_FACES[o.face]!;f.forEach((n,i)=>freeEdges.add(boundaryKey([e[n-1]!,e[f[(i+1)%4]!-1]!])));}
  source.elements.forEach((e,i)=>{for(const [a,b] of edgeTemplates){const key=boundaryKey([e[a!]!,e[b!]!]),owners=edgeParents.get(key)??[];owners.push(i+1);edgeParents.set(key,owners);}});
  const cornerGroups=[];
  for(const [key,owners] of edgeParents)if((owners.length===3||owners.length===5)&&!freeEdges.has(key)&&owners.every(p=>shells.has(p))){
    const ids=key.split(":").map(Number),p=source.nodes[ids[0]!-1]!,q=source.nodes[ids[1]!-1]!;
    if(Math.abs(p[options.axis]!-q[options.axis]!)<=tolerance)continue;
    cornerGroups.push({sourceEdgeNodeIds:ids,valence:owners.length,sourceParentIds:owners,
      children:owners.reduce((s,p)=>s+hierarchicalShellCount(shells.get(p)!.depth,shells.get(p)!.coarseDepth),0),completeOriginalParentsCovered:true,sharedFaceFieldVerified:true});
  }
  const cornerParents=new Set(cornerGroups.flatMap(g=>g.sourceParentIds));
  return {mesh:result.mesh,sourceParentIds:outputParents,uniformCells:outputParents.map(p=>!shells.has(p)),
    roles:outputParents.map((p):RefinementRole=>targets.has(p)?"selected":shells.has(p)?cornerParents.has(p)?"corner-transition":"face-transition":"unchanged"),
    report:{implementation:"native-compiled-parent-field",axis:options.axis,originalElements:source.elements.length,outputElements:count,targets:options.targets.map(t=>({...t})),
      coreParents:targets.size,shellParents:shells.size,farFieldParents:farField.length,farFieldParentIds:farField,
      originalNodesUnchanged:true,farFieldConnectivityUnchanged:true,wholeParentPromotions:0,sourceTopologyCompensation:false,
      exactSharedFaceConstraints:constraints.filter(c=>!c.phase).length,exteriorPhaseConstraints:constraints.filter(c=>c.phase).length,
      exteriorPhasePolicy:options.exteriorPhasePolicy??"level-closed",referenceExteriorPhaseClosureVerified:(options.exteriorPhasePolicy??"level-closed")==="level-closed",searchDecisions:decisions,
      shellGroups:[...new Set([...shells.values()].map(s=>`${s.depth}:${s.coarseDepth}`))].sort().map(key=>{const [depth,coarseDepth]=key.split(":").map(Number);return {depth,coarseDepth,parents:[...shells.values()].filter(s=>s.depth===depth&&s.coarseDepth===coarseDepth).length,childrenPerParent:hierarchicalShellCount(depth!,coarseDepth!)};}),
      shellExpansion:{requestedLayers:shellLayers,initialParentIds:initialShellParents,additionalParentIds:queue.slice(initialShellParents.length),additionalParentBudget:additionalLimit,policy:"opposite axial faces only; no uniform support-parent promotion"},
      selectedExponent:best.exponent,trials,geometry:best.geometry,quality:result.quality,
      selectedStationBlend:best.stationBlend,stationProposals:Object.fromEntries(stationProposals),stationProposalEdgeMargin:stationMargin,
      sizeDistribution:{coreMinimumEdge:actualCoreEdge,transitionMinimumEdge:actualTransitionEdge,transitionToCoreMinimumEdgeRatio:actualEdgeRatio,maximumTransitionEdgeAspectRatio:actualTransitionAspect,
        requestedMinimumRatio:options.minimumTransitionToCoreEdgeRatio??null,minimumRatioVerified:options.minimumTransitionToCoreEdgeRatio===undefined?null:actualEdgeRatio>=options.minimumTransitionToCoreEdgeRatio},
      minimumOverallCornerSJ:minimumOverallSJ,maximumCoreCoordinateError,maximumOriginalParentRelativeVolumeError:maximumParentRelativeVolumeError,
      cornerGroups,
      limitation:"One fine face per whole source shell parent; no adjacent unequal exact cores, two-front shells or arbitrary CinoLib WB edge/vertex installation. Exterior phase certificate concerns normalized reference stations; no universal physical-surface quality is implied.",
      engineeringAcceptanceVerified:false}};
}
