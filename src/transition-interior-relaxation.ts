import type { Mesh } from "./types.js";
import { H1_FACES, boundaryKey } from "./topology.js";
import { hexElementSignedVolume, minimumHexCornerScaledJacobian } from "./hex-quality.js";
import { hexJacobian } from "./hex-quality-internal.js";
import { auditHexFaceGrading } from "./hex-face-grading.js";

const EDGES = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]] as const;
const det = ([a,b,c]: number[][]) => a![0]!*(b![1]!*c![2]!-b![2]!*c![1]!)-a![1]!*(b![0]!*c![2]!-b![2]!*c![0]!)+a![2]!*(b![0]!*c![1]!-b![1]!*c![0]!);
function samples(mesh: Mesh, ids: readonly number[]) {
  let corner = Infinity, gauss = Infinity, edge = Infinity, aspect = 0;
  for (const id of ids) {
    const p = mesh.elements[id]!.map(n => mesh.nodes[n-1]!);
    corner = Math.min(corner, minimumHexCornerScaledJacobian(p));
    for (const u of [-1/Math.sqrt(3),1/Math.sqrt(3)]) for (const v of [-1/Math.sqrt(3),1/Math.sqrt(3)]) for (const w of [-1/Math.sqrt(3),1/Math.sqrt(3)]) gauss = Math.min(gauss,det(hexJacobian(p,u,v,w)));
    const lengths = EDGES.map(([a,b]) => Math.hypot(...p[a]!.map((v,i)=>v-p[b]![i]!)));
    const low = Math.min(...lengths); edge = Math.min(edge, low); aspect = Math.max(aspect,Math.max(...lengths)/low);
  }
  return {corner,gauss,edge,aspect};
}

/** Internal O-grid postprocess. No topology changes or source-parent boundary motion. */
export function relaxTransitionInteriors(source: Mesh, mesh: Mesh, parents: readonly number[], uniform: readonly boolean[]) {
  if (parents.length !== mesh.elements.length || uniform.length !== parents.length || uniform.some(v=>typeof v!=="boolean") || parents.some(p=>!Number.isSafeInteger(p)||p<1||p>source.elements.length)) throw new RangeError("invalid trusted interior-relaxation lineage");
  if (source.nodes.some((p,i)=>p.some((v,a)=>v!==mesh.nodes[i]?.[a]))) throw new RangeError("interior relaxation must retain source node IDs/coordinates");
  const frozen = new Uint8Array(mesh.nodes.length), low = new Int32Array(mesh.nodes.length).fill(source.elements.length+1), high = new Int32Array(mesh.nodes.length);
  frozen.fill(1,0,source.nodes.length);
  const faces = new Map<string,{nodes:number[];count:number}>(), reviewed: number[] = [];
  mesh.elements.forEach((e,i)=>{
    e.forEach(n=>{low[n-1]=Math.min(low[n-1]!,parents[i]!);high[n-1]=Math.max(high[n-1]!,parents[i]!);if(uniform[i])frozen[n-1]=1;});
    if(uniform[i])return;
    reviewed.push(i+1);
    for(const f of H1_FACES){const nodes=f.map(n=>e[n-1]!),key=boundaryKey(nodes),old=faces.get(key);if(old){if(++old.count>2)throw new Error("nonmanifold transition submesh");}else faces.set(key,{nodes,count:1});}
  });
  // Boundary of the transition union, plus every source-parent interface, is fixed.
  for(const face of faces.values())if(face.count===1)face.nodes.forEach(n=>{frozen[n-1]=1;});
  const eligible = mesh.nodes.flatMap((_,i)=>!frozen[i]&&low[i]===high[i]&&high[i]!>0?[i]:[]);
  const movable = new Set(eligible), neighbors = new Map(eligible.map(n=>[n,new Set<number>()]));
  mesh.elements.forEach(e=>EDGES.forEach(([a,b])=>{const x=e[a]!-1,y=e[b]!-1;if(movable.has(x))neighbors.get(x)!.add(y);if(movable.has(y))neighbors.get(y)!.add(x);}));
  const affected = mesh.elements.flatMap((e,i)=>e.some(n=>movable.has(n-1))?[i]:[]);
  const before = auditHexFaceGrading(mesh,{reviewElementIds:reviewed});
  const baseline = affected.length?samples(mesh,affected):null;
  const report = {policy:"guarded-parent-interior-laplacian",eligibleNodes:eligible.length,movedNodeIds:[] as number[],affectedElements:affected.length,
    selectedStep:0,maximumDisplacement:0,maximumIncidentEdgeFraction:0,maximumAllowedIncidentEdgeFraction:.25,
    before,after:before,minimumCornerBefore:baseline?.corner??null,minimumCornerAfter:baseline?.corner??null,
    maximumParentRelativeVolumeError:0,originalNodesFixed:true,uniformNodesFixed:true,sourceParentBoundaryFixed:true,
    connectivityUnchanged:true,engineeringAcceptanceVerified:false,trials:[] as Array<{step:number;accepted:boolean;reason:string;angle?:number}>};
  if(!baseline||!eligible.length)return {mesh,report};
  const displacement = new Map<number,number[]>(), localEdge = new Map<number,number>();
  for(const id of eligible){
    const adjacent=[...neighbors.get(id)!],p=mesh.nodes[id]!,mean=[0,1,2].map(a=>adjacent.reduce((s,n)=>s+(mesh.nodes[n]![a]!-p[a]!)/adjacent.length,0));
    const length=Math.min(...adjacent.map(n=>Math.hypot(...mesh.nodes[n]!.map((v,a)=>v-p[a]!)))),norm=Math.hypot(...mean),factor=norm>0?Math.min(1,.25*length/norm):0;
    displacement.set(id,mean.map(v=>v*factor));localEdge.set(id,length);
  }
  const parentSet=new Set(affected.map(i=>parents[i]!)),sourceVolumes=new Map<number,number>(),baseVolumes=new Map<number,number>();
  for(const p of parentSet)sourceVolumes.set(p,hexElementSignedVolume(source.elements[p-1]!.map(n=>source.nodes[n-1]!)));
  mesh.elements.forEach((e,i)=>{const p=parents[i]!;if(parentSet.has(p))baseVolumes.set(p,(baseVolumes.get(p)??0)+hexElementSignedVolume(e.map(n=>mesh.nodes[n-1]!)));});
  const oldAffectedVolumes=affected.map(i=>hexElementSignedVolume(mesh.elements[i]!.map(n=>mesh.nodes[n-1]!)));
  let bestMesh=mesh;
  for(const step of [.05,.1,.2,.3,.5,.75,1]){
    const nodes=[...mesh.nodes];eligible.forEach(id=>{nodes[id]=mesh.nodes[id]!.map((v,a)=>v+step*displacement.get(id)![a]!);});
    const candidate:Mesh={...mesh,nodes};let stable=false;
    for(let pass=0;pass<12;pass++){
      const bad=affected.filter(i=>minimumHexCornerScaledJacobian(mesh.elements[i]!.map(n=>nodes[n-1]!))<baseline.corner);
      if(!bad.length){stable=true;break;}
      for(const i of bad)for(const n of mesh.elements[i]!)if(movable.has(n-1))nodes[n-1]=mesh.nodes[n-1]!;
    }
    if(!stable){report.trials.push({step,accepted:false,reason:"corner-quality rollback did not converge"});continue;}
    const q=samples(candidate,affected);
    if(q.corner<baseline.corner||q.gauss<baseline.gauss||q.edge<baseline.edge||q.aspect>baseline.aspect){report.trials.push({step,accepted:false,reason:"corner/Gauss/short-edge/aspect regression"});continue;}
    const sums=new Map(baseVolumes);
    affected.forEach((id,i)=>{const p=parents[id]!;sums.set(p,sums.get(p)!+hexElementSignedVolume(mesh.elements[id]!.map(n=>nodes[n-1]!))-oldAffectedVolumes[i]!);});
    const error=Math.max(...[...sums].map(([p,v])=>Math.abs(v-sourceVolumes.get(p)!)/Math.abs(sourceVolumes.get(p)!)));
    if(!(error<1e-8)){report.trials.push({step,accepted:false,reason:"source-parent volume conservation failed"});continue;}
    const grading=auditHexFaceGrading(candidate,{reviewElementIds:reviewed});
    const improves=grading.undefinedMetricPairs===0&&grading.centroidsOnSameSidePairs===0&&grading.maximumNormalSizeRatio!==null&&before.maximumNormalSizeRatio!==null
      &&grading.maximumNormalSizeRatio<=before.maximumNormalSizeRatio&&grading.maximumNonOrthogonalityDegrees!==null&&report.after.maximumNonOrthogonalityDegrees!==null
      &&grading.maximumNonOrthogonalityDegrees<report.after.maximumNonOrthogonalityDegrees;
    report.trials.push({step,accepted:improves,reason:improves?"strict nonorthogonality improvement with fixed boundaries":"no guarded grading improvement",...(grading.maximumNonOrthogonalityDegrees===null?{}:{angle:grading.maximumNonOrthogonalityDegrees})});
    if(!improves)continue;
    bestMesh=candidate;report.selectedStep=step;report.after=grading;report.minimumCornerAfter=q.corner;report.maximumParentRelativeVolumeError=error;
  }
  report.movedNodeIds=eligible.filter(id=>mesh.nodes[id]!.some((v,a)=>v!==bestMesh.nodes[id]![a])).map(id=>id+1);
  for(const id of report.movedNodeIds){const distance=Math.hypot(...bestMesh.nodes[id-1]!.map((v,a)=>v-mesh.nodes[id-1]![a]!));report.maximumDisplacement=Math.max(report.maximumDisplacement,distance);report.maximumIncidentEdgeFraction=Math.max(report.maximumIncidentEdgeFraction,distance/localEdge.get(id-1)!);}
  return {mesh:bestMesh,report};
}
