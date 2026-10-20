import type {LsdynaMixedMesh} from "./lsdyna-mixed.js";

/** Geometry/identity only; this is not an embedding or bond audit. */
export function auditReinforcementBeams(model:LsdynaMixedMesh,connectivity:"separate"|"shared"){
  const solidNodes=new Set<number>();for(const e of model.solids)for(const n of e.nodes)solidNodes.add(n);
  const endpoints=new Set<number>();
  const axes=[0,1,2].map(()=>({count:0,totalLength:0,minimumLength:Infinity,maximumLength:0}));
  let minimumLength=Infinity,maximumLength=0,minimumOrientationSine=Infinity;
  for(const beam of model.beams){
    const p=model.nodes[beam.nodes[0]-1]!,q=model.nodes[beam.nodes[1]-1]!,r=model.nodes[beam.orientationNode-1]!;
    const a=q.map((v,i)=>v-p[i]!),b=r.map((v,i)=>v-p[i]!);
    const length=Math.hypot(...a),orientationLength=Math.hypot(...b);
    const cross=[a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!];
    const sine=Math.hypot(...cross)/(length*orientationLength);
    if(!(length>0&&sine>1e-10))throw new Error("invalid reinforcement length or orientation");
    const axis=a.reduce((best,v,i)=>Math.abs(v)>Math.abs(a[best]!)?i:best,0);
    if(a.some((v,i)=>i!==axis&&Math.abs(v)>1e-9*length))throw new Error("reinforcement is not aligned to a global coordinate axis");
    const entry=axes[axis]!;entry.count++;entry.totalLength+=length;
    entry.minimumLength=Math.min(entry.minimumLength,length);entry.maximumLength=Math.max(entry.maximumLength,length);
    minimumLength=Math.min(minimumLength,length);maximumLength=Math.max(maximumLength,length);minimumOrientationSine=Math.min(minimumOrientationSine,sine);
    for(const n of beam.nodes)endpoints.add(n);
    if(solidNodes.has(beam.orientationNode))throw new Error("reinforcement orientation helper must not be a concrete node");
  }
  const sharedEndpointNodes=[...endpoints].filter(n=>solidNodes.has(n)).length;
  if(connectivity==="shared"?sharedEndpointNodes!==endpoints.size:sharedEndpointNodes!==0)throw new Error("reinforcement connectivity policy was violated");
  const normalize=(entry:typeof axes[number])=>({...entry,minimumLength:entry.count?entry.minimumLength:null,maximumLength:entry.count?entry.maximumLength:null});
  return {beamCount:model.beams.length,beamEndpointNodes:endpoints.size,sharedEndpointNodes,
    minimumBeamLength:model.beams.length?minimumLength:null,maximumBeamLength:model.beams.length?maximumLength:null,
    minimumBeamOrientationSine:model.beams.length?minimumOrientationSine:null,
    beamAxes:{x:normalize(axes[0]!),y:normalize(axes[1]!),z:normalize(axes[2]!)},
    couplingVerified:false as const};
}
