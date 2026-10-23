import {planConcentricCircularMesh,type ConcentricCircularSpec,type ConcentricCircularPlan} from "./concentric-circular.js";

export interface ConcentricSeedPlanningRequest {
  schemaVersion:1;
  parameters:ConcentricCircularSpec;
  /** Nominal boundary intervals, not a guarantee on every mapped interior edge. */
  targets:{maximumRadiusSpacing:number;maximumArcSpacing:number;maximumAxialSpacing:number};
}
export interface ConcentricSeedPlanningResult {
  resolvedRequest:{schemaVersion:1;parameters:ConcentricCircularSpec};
  plan:ConcentricCircularPlan;
  report:{
    schemaVersion:1;
    changes:{field:"radiusSegments"|"arcSegments"|"axialSegments";before:number;after:number}[];
    multiples:{arcSegments:number;axialSegments:number};
    nominalSpacings:{radius:number;arcLength:number;arcChord:number;axial:number};
    geometryAndRingsUnchanged:true;
    existingSeedsNeverReduced:true;
    topologyAndQualityAudited:false;
    allInteriorEdgesWithinTargets:false;
  };
}

/** A count-only proposal for new generation. Never coarsens supplied seeds to meet a budget. */
export function planConcentricSeeds(request:ConcentricSeedPlanningRequest):ConcentricSeedPlanningResult {
  const exact=(value:unknown,keys:string[])=>{
    if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw new RangeError("invalid seed planning options");
  };
  exact(request,["schemaVersion","parameters","targets"]);
  if(request.schemaVersion!==1)throw new RangeError("unsupported seed planning version");
  exact(request.targets,["maximumRadiusSpacing","maximumArcSpacing","maximumAxialSpacing"]);
  for(const v of Object.values(request.targets))if(!Number.isFinite(v)||v<=0)throw new RangeError("seed targets must be finite and positive");
  for(const k of ["maximumRadiusSpacing","maximumArcSpacing","maximumAxialSpacing"] as const)
    if(!(request.targets[k]>0))throw new RangeError(`missing target ${k}`);
  const p=structuredClone(request.parameters);
  if(!p||!Array.isArray(p.rings)||p.rings.length<1||p.rings.length>8)throw new RangeError("provide one to eight rings");
  for(const v of [p.coreRadius,p.height])if(!Number.isFinite(v)||v<=0)throw new RangeError("positive core radius and height required");
  for(const k of ["radiusSegments","arcSegments","axialSegments"] as const)
    if(!Number.isSafeInteger(p[k])||p[k]<1)throw new RangeError("existing seeds must be positive safe integers");
  const up=(value:number,multiple:number)=>{
    const result=Math.ceil(value/multiple)*multiple;
    if(!Number.isSafeInteger(result)||result<1)throw new RangeError("seed proposal exceeds safe integer range");
    return result;
  };
  const multiples={arcSegments:2**p.rings.length,axialSegments:2**(p.rings.length+1)};
  p.arcSegments=up(Math.max(p.arcSegments,Math.PI*p.coreRadius/(2*request.targets.maximumArcSpacing)),multiples.arcSegments);
  p.radiusSegments=up(Math.max(p.radiusSegments,p.coreRadius/request.targets.maximumRadiusSpacing,p.arcSegments/2+1),1);
  p.axialSegments=up(Math.max(p.axialSegments,p.height/request.targets.maximumAxialSpacing),multiples.axialSegments);
  const plan=planConcentricCircularMesh(p);
  const changes=(["radiusSegments","arcSegments","axialSegments"] as const)
    .filter(field=>p[field]!==request.parameters[field]).map(field=>({field,before:request.parameters[field],after:p[field]}));
  return {resolvedRequest:{schemaVersion:1,parameters:p},plan,report:{schemaVersion:1,changes,multiples,
    nominalSpacings:{radius:p.coreRadius/p.radiusSegments,arcLength:Math.PI*p.coreRadius/(2*p.arcSegments),
      arcChord:plan.core.arcEdgeChord,axial:plan.fineAxialSpacing},geometryAndRingsUnchanged:true,existingSeedsNeverReduced:true,
    topologyAndQualityAudited:false,allInteriorEdgesWithinTargets:false}};
}
