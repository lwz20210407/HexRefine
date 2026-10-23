import type {ConcentricCircularSpec,ConcentricCircularPlan,PreparedConcentricCircularMesh} from "./concentric-circular.js";
import {planConcentricCircularMesh,prepareConcentricCircularMesh} from "./concentric-circular.js";
import {generateMappedCircularCore} from "./mapped-circular-core.js";
import {twoWay7ReferenceTemplates} from "./two-to-one-templates.js";
import {hexElementSignedVolume,minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {hexJacobian} from "./hex-quality-internal.js";
import type {Point} from "./types.js";

export interface ConcentricWidthCriteria {
  minimumCornerScaledJacobian:number;
  maximumTransitionEdgeAspectRatio:number;
  minimumTransitionEdgeToCoreRatio:number;
  /** Defaults to the transition edge floor; prevents thin regular annuli left between rings. */
  minimumRegularEdgeToCoreRatio?:number;
}
export interface ConcentricWidthPlanningRequest {
  schemaVersion:1;
  parameters:ConcentricCircularSpec;
  criteria:ConcentricWidthCriteria;
  search?:{
    /** Multiples of each ring's coarse axial spacing; original width is also considered. */
    widthScales?:readonly number[];
    maximumLocalEvaluations?:number;
    maximumPlanChecks?:number;
    maximumFullAudits?:number;
  };
}
export interface ConcentricWidthCandidate {
  width:number;
  outerRadius:number;
  source:"original"|"scale";
  status:"not-evaluated"|"outside-window"|"screened-rejected"|"screened-accepted";
  reasons:string[];
  minimumCornerScaledJacobian?:number;
  minimumGaussDeterminant?:number;
  minimumEdge?:number;
  maximumEdgeAspectRatio?:number;
  minimumEdgeToCoreRatio?:number;
  followingRegularEdgeToCoreRatio?:number|null;
}
export interface ConcentricWidthDiagnostics {
  effectiveCriteria:ConcentricWidthCriteria&{minimumRegularEdgeToCoreRatio:number};
  coreMinimumEdge:number;
  coreMinimumCornerScaledJacobian:number;
  limits:{maximumLocalEvaluations:number;maximumPlanChecks:number;maximumFullAudits:number};
  localEvaluations:number;
  planChecks:number;
  fullAudits:number;
  candidates:ConcentricWidthCandidate[][];
  attempts:{widths:number[];status:"count-rejected"|"not-audited"|"audit-rejected"|"accepted";message?:string;elements?:number}[];
}
export type ConcentricWidthFailureCode="fixed-core-quality"|"fixed-collar-quality"|"no-local-candidate"|"search-budget-exhausted"|"no-validated-plan";
export class ConcentricWidthPlanningError extends Error {
  readonly diagnostics:ConcentricWidthDiagnostics;
  constructor(readonly code:ConcentricWidthFailureCode,message:string,diagnostics:ConcentricWidthDiagnostics){
    super(message);this.name="ConcentricWidthPlanningError";this.diagnostics=structuredClone(diagnostics);
  }
}
export interface ConcentricWidthPlanningResult {
  resolvedRequest:{schemaVersion:1;parameters:ConcentricCircularSpec};
  plan:ConcentricCircularPlan;
  quality:PreparedConcentricCircularMesh["quality"];
  counts:{nodes:number;elements:number};
  report:{
    schemaVersion:1;
    originalParameters:ConcentricCircularSpec;
    changes:{ring:number;oldOuterRadius:number;newOuterRadius:number;oldWidth:number;newWidth:number}[];
    originalMinimumCornerGate:number|null;
    actualCoreMinimumEdge:number;
    actualTransitionEdgeAspectRatio:number;
    actualTransitionEdgeToCoreRatio:number;
    actualRegularEdgeToCoreRatio:number|null;
    diagnostics:ConcentricWidthDiagnostics;
    coreAndSeedParametersUnchanged:true;
    innerRadiiAndOuterGeometryUnchanged:true;
    regularRadialPartitionsMayChange:true;
    originalElements:number;
    resolvedElements:number;
    optimalityClaim:"none; first fully audited candidate in bounded screened search";
    engineeringAcceptanceVerified:false;
  };
}

function object(value:unknown,keys:readonly string[],name:string):asserts value is Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw new RangeError(`invalid ${name} options`);
}
function positive(v:number,name:string){if(!Number.isFinite(v)||v<=0)throw new RangeError(`${name} must be finite and positive`);}
function limit(v:number|undefined,fallback:number,max:number,name:string){const n=v??fallback;
  if(!Number.isSafeInteger(n)||n<1||n>max)throw new RangeError(`${name} must be an integer in1..${max}`);return n;}

/** Width-only bounded planning, not automatic remeshing or a global optimum solver. */
export function planConcentricRingWidths(request:ConcentricWidthPlanningRequest):ConcentricWidthPlanningResult {
  object(request,["schemaVersion","parameters","criteria","search"],"width request");
  if(request.schemaVersion!==1)throw new RangeError("unsupported concentric width request version");
  const original=structuredClone(request.parameters),baseline=planConcentricCircularMesh(original);
  object(request.criteria,["minimumCornerScaledJacobian","maximumTransitionEdgeAspectRatio","minimumTransitionEdgeToCoreRatio","minimumRegularEdgeToCoreRatio"],"width criteria");
  const criteria={...request.criteria,minimumRegularEdgeToCoreRatio:request.criteria.minimumRegularEdgeToCoreRatio===undefined?
    request.criteria.minimumTransitionEdgeToCoreRatio:request.criteria.minimumRegularEdgeToCoreRatio};
  positive(criteria.minimumCornerScaledJacobian,"minimumCornerScaledJacobian");
  if(criteria.minimumCornerScaledJacobian>1)throw new RangeError("minimumCornerScaledJacobian exceeds1");
  positive(criteria.maximumTransitionEdgeAspectRatio,"maximumTransitionEdgeAspectRatio");
  if(criteria.maximumTransitionEdgeAspectRatio<1)throw new RangeError("edge aspect ratio must be at least1");
  positive(criteria.minimumTransitionEdgeToCoreRatio,"minimumTransitionEdgeToCoreRatio");
  positive(criteria.minimumRegularEdgeToCoreRatio,"minimumRegularEdgeToCoreRatio");
  criteria.minimumCornerScaledJacobian=Math.max(criteria.minimumCornerScaledJacobian,original.minimumCornerScaledJacobian??0);
  if(request.search!==undefined)object(request.search,["widthScales","maximumLocalEvaluations","maximumPlanChecks","maximumFullAudits"],"width search");
  const search=request.search??{},scales=search.widthScales??[.5,.75,1,1.25,1.5,2,3,4];
  if(!Array.isArray(scales)||scales.length<1||scales.length>16)throw new RangeError("widthScales must contain1..16 positive values");
  for(const scale of scales)positive(scale,"width scale");
  const limits={maximumLocalEvaluations:limit(search.maximumLocalEvaluations,128,512,"maximumLocalEvaluations"),
    maximumPlanChecks:limit(search.maximumPlanChecks,32,256,"maximumPlanChecks"),maximumFullAudits:limit(search.maximumFullAudits,4,16,"maximumFullAudits")};
  const section=generateMappedCircularCore({radius:original.coreRadius,radiusSegments:original.radiusSegments,arcSegments:original.arcSegments,
    modelFraction:"quarter",...(original.innerCornerFraction===undefined?{}:{innerCornerFraction:original.innerCornerFraction})});
  const coreEdge=Math.min(section.quality.minimumEdge,baseline.fineAxialSpacing);
  const d:ConcentricWidthDiagnostics={effectiveCriteria:criteria,coreMinimumEdge:coreEdge,
    coreMinimumCornerScaledJacobian:section.quality.minimumCornerScaledJacobian,limits,localEvaluations:0,planChecks:0,fullAudits:0,candidates:[],attempts:[]};
  const fail=(code:ConcentricWidthFailureCode,message:string):never=>{throw new ConcentricWidthPlanningError(code,message,d);};
  if(section.quality.minimumCornerScaledJacobian<criteria.minimumCornerScaledJacobian)fail("fixed-core-quality","The frozen core cannot meet the requested SJ; width-only planning will not change its geometry or seeds.");
  if(original.rings[0]!.innerRadius>original.coreRadius&&regularEdge(original.coreRadius,original.rings[0]!.innerRadius,
    original.arcSegments,baseline.fineAxialSpacing,original.radialSize??baseline.fineAxialSpacing)/coreEdge<criteria.minimumRegularEdgeToCoreRatio){
    fail("fixed-collar-quality","The fixed inner collar violates the regular-edge floor; width-only planning will not move the core or the first ring's inner radius.");
  }
  const eligible:ConcentricWidthCandidate[][]=[];
  for(const [index,ring] of original.rings.entries()){
    const coarseZ=baseline.fineAxialSpacing*2**(index+1),oldWidth=ring.outerRadius-ring.innerRadius;
    const widths=new Set<number>([oldWidth]);
    for(const scale of scales){const width=scale*coarseZ;positive(width,"physical candidate width");widths.add(width);}
    const rows:ConcentricWidthCandidate[]=[];d.candidates.push(rows);
    for(const width of [...widths].sort((a,b)=>a-b)){
      const outerRadius=width===oldWidth?ring.outerRadius:ring.innerRadius+width;
      const row:ConcentricWidthCandidate={width,outerRadius,source:width===oldWidth?"original":"scale",status:"not-evaluated",reasons:[]};rows.push(row);
      if(!(outerRadius>ring.innerRadius)||outerRadius>(original.rings[index+1]?.innerRadius??original.radius)){
        row.status="outside-window";row.reasons.push("outside the fixed ring-inner-radius window");continue;
      }
      if(d.localEvaluations===limits.maximumLocalEvaluations)fail("search-budget-exhausted","Local screening budget exhausted; no infeasibility claim is made.");
      d.localEvaluations++;
      const metrics=screenRing(ring.innerRadius,outerRadius,original.arcSegments/2**(index+1),coarseZ);
      Object.assign(row,metrics,{minimumEdgeToCoreRatio:metrics.minimumEdge/coreEdge});
      const nextInner=original.rings[index+1]?.innerRadius??original.radius;
      row.followingRegularEdgeToCoreRatio=outerRadius===nextInner?null:
        regularEdge(outerRadius,nextInner,original.arcSegments/2**(index+1),coarseZ,ring.radialSize??coarseZ)/coreEdge;
      if(!(metrics.minimumCornerScaledJacobian>0&&metrics.minimumGaussDeterminant>0))row.reasons.push("nonpositive sampled Jacobian");
      if(metrics.minimumCornerScaledJacobian<criteria.minimumCornerScaledJacobian)row.reasons.push("corner SJ below criterion");
      if(metrics.maximumEdgeAspectRatio>criteria.maximumTransitionEdgeAspectRatio)row.reasons.push("transition edge aspect above criterion");
      if(metrics.minimumEdge/coreEdge<criteria.minimumTransitionEdgeToCoreRatio)row.reasons.push("transition edge shorter than the required core-edge ratio");
      if(row.followingRegularEdgeToCoreRatio!==null&&row.followingRegularEdgeToCoreRatio<criteria.minimumRegularEdgeToCoreRatio)row.reasons.push("following regular annulus edge below criterion");
      if(!Object.values(metrics).every(Number.isFinite))row.reasons.push("numerically unresolved screening geometry");
      row.status=row.reasons.length?"screened-rejected":"screened-accepted";
    }
    const accepted=rows.filter(r=>r.status==="screened-accepted").sort((a,b)=>b.minimumCornerScaledJacobian!-a.minimumCornerScaledJacobian!
      ||a.maximumEdgeAspectRatio!-b.maximumEdgeAspectRatio!||a.width-b.width);
    if(!accepted.length)fail("no-local-candidate",`Ring ${index+1} has no candidate meeting the explicit criteria in this finite width family; this is not a topology impossibility proof.`);
    eligible.push(accepted);
  }
  const queue:number[][]=[eligible.map(()=>0)],seen=new Set([JSON.stringify(queue[0])]);
  const score=(v:number[])=>Math.min(section.quality.minimumCornerScaledJacobian,...v.map((j,i)=>eligible[i]![j]!.minimumCornerScaledJacobian!));
  const rankOrder=(a:number[],b:number[])=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]!-b[i]!;return 0;};
  while(queue.length){
    if(d.planChecks===limits.maximumPlanChecks)fail("search-budget-exhausted","Plan-check budget exhausted; other candidate combinations may remain feasible.");
    queue.sort((a,b)=>score(b)-score(a)||a.reduce((s,x)=>s+x,0)-b.reduce((s,x)=>s+x,0)||rankOrder(a,b));
    const ranks=queue.shift()!;
    for(let i=0;i<ranks.length;i++)if(ranks[i]!+1<eligible[i]!.length){const next=[...ranks];next[i]=next[i]!+1;const key=JSON.stringify(next);if(!seen.has(key)){seen.add(key);queue.push(next);}}
    const chosen=ranks.map((j,i)=>eligible[i]![j]!),parameters:ConcentricCircularSpec={...structuredClone(original),
      minimumCornerScaledJacobian:criteria.minimumCornerScaledJacobian,rings:original.rings.map((r,i)=>({...r,outerRadius:chosen[i]!.outerRadius}))};
    const attempt:ConcentricWidthDiagnostics["attempts"][number]={widths:chosen.map(r=>r.width),status:"count-rejected"};d.attempts.push(attempt);d.planChecks++;
    try{attempt.elements=planConcentricCircularMesh(parameters).expectedElements;}catch(e){attempt.message=String(e);continue;}
    attempt.status="not-audited";
    if(d.fullAudits===limits.maximumFullAudits)fail("search-budget-exhausted","Complete native audit budget exhausted; no unaudited candidate is returned.");
    d.fullAudits++;attempt.status="audit-rejected";
    let prepared:PreparedConcentricCircularMesh;
    try{prepared=prepareConcentricCircularMesh(parameters);}catch(e){attempt.message=String(e);continue;}
    const transitions=Object.entries(prepared.quality.regions).filter(([k])=>k.startsWith("transition-")).map(([,r])=>r);
    const actualCoreEdge=prepared.quality.regions.core!.minimumEdge;
    const actualAspect=Math.max(...transitions.map(r=>r.maximumEdgeAspectRatio)),actualRatio=Math.min(...transitions.map(r=>r.minimumEdge))/actualCoreEdge;
    const regular=Object.entries(prepared.quality.regions).filter(([k])=>k.startsWith("regular-")).map(([,r])=>r);
    const actualRegularRatio=regular.length?Math.min(...regular.map(r=>r.minimumEdge))/actualCoreEdge:null;
    if(actualAspect>criteria.maximumTransitionEdgeAspectRatio||actualRatio<criteria.minimumTransitionEdgeToCoreRatio
      ||(actualRegularRatio!==null&&actualRegularRatio<criteria.minimumRegularEdgeToCoreRatio)){
      attempt.message="Full native edge metrics failed the criteria; local screening is not a certificate.";continue;
    }
    attempt.status="accepted";
    return {resolvedRequest:{schemaVersion:1,parameters},plan:prepared.plan,quality:prepared.quality,counts:prepared.counts,
      report:{schemaVersion:1,originalParameters:original,changes:original.rings.map((r,i)=>({ring:i+1,oldOuterRadius:r.outerRadius,newOuterRadius:parameters.rings[i]!.outerRadius,
        oldWidth:r.outerRadius-r.innerRadius,newWidth:parameters.rings[i]!.outerRadius-r.innerRadius})),originalMinimumCornerGate:original.minimumCornerScaledJacobian??null,actualCoreMinimumEdge:actualCoreEdge,
        actualTransitionEdgeAspectRatio:actualAspect,actualTransitionEdgeToCoreRatio:actualRatio,actualRegularEdgeToCoreRatio:actualRegularRatio,diagnostics:structuredClone(d),
        coreAndSeedParametersUnchanged:true,innerRadiiAndOuterGeometryUnchanged:true,regularRadialPartitionsMayChange:true,
        originalElements:baseline.expectedElements,resolvedElements:prepared.counts.elements,
        optimalityClaim:"none; first fully audited candidate in bounded screened search",engineeringAcceptanceVerified:false}};
  }
  return fail("no-validated-plan","All visited combinations were rejected by native planning/audit; this finite family is not a general infeasibility proof.");
}

function regularEdge(inner:number,outer:number,angular:number,hz:number,radialSize:number){
  return Math.min((outer-inner)/Math.ceil((outer-inner)/radialSize),2*inner*Math.sin(Math.PI/(4*angular)),hz);
}

/** Four checker parities are rotationally representative, but acceptance still needs the full native audit. */
function screenRing(inner:number,outer:number,angular:number,hz:number){
  const templates=twoWay7ReferenceTemplates(),checker=[[0,1],[3,2]],edges=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  let minimumCornerScaledJacobian=Infinity,minimumGaussDeterminant=Infinity,minimumEdge=Infinity,maximumEdgeAspectRatio=0;
  for(let k=0;k<2;k++)for(let i=0;i<Math.min(2,angular);i++){
    const template=templates[checker[k]![i]!]!,points:Point[]=template.nodes.map(([u,v,w])=>{
      const r=inner+(1-w)*(outer-inner)/2,a=(i+(u+1)/2)/angular*Math.PI/2;
      return [r*Math.cos(a),r*Math.sin(a),(k+(v+1)/2)*hz];
    });
    for(const e of template.elements){
      let p=e.map(j=>points[j]!);if(hexElementSignedVolume(p)<0)p=[0,3,2,1,4,7,6,5].map(j=>p[j]!);
      minimumCornerScaledJacobian=Math.min(minimumCornerScaledJacobian,minimumHexCornerScaledJacobian(p));
      const lengths=edges.map(([a,b])=>Math.hypot(...p[a!]!.map((x,j)=>x-p[b!]![j]!))),lo=Math.min(...lengths);
      minimumEdge=Math.min(minimumEdge,lo);maximumEdgeAspectRatio=Math.max(maximumEdgeAspectRatio,Math.max(...lengths)/lo);
      for(const u of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const v of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const w of [-1/Math.sqrt(3),1/Math.sqrt(3)]){
        const [a,b,c]=hexJacobian(p,u,v,w);const det=a![0]!*(b![1]!*c![2]!-b![2]!*c![1]!)-a![1]!*(b![0]!*c![2]!-b![2]!*c![0]!)+a![2]!*(b![0]!*c![1]!-b![1]!*c![0]!);minimumGaussDeterminant=Math.min(minimumGaussDeterminant,det);
      }
    }
  }
  return {minimumCornerScaledJacobian,minimumGaussDeterminant,minimumEdge,maximumEdgeAspectRatio};
}
