import type {TransitionBandPlan} from "./transition-bands.js";

export interface TransitionAngularSeamOptions {
  startAngleDegrees?:number;
  sweepAngleDegrees?:number;
  /** Absolute radial cut angles in the generator's local radial frame. */
  seamAnglesDegrees?:readonly number[];
}

export interface TransitionAngularSeamPlan {
  compatible:boolean;
  geometryChecked:false;
  existingMeshStitched:false;
  angleToleranceDegrees:number;
  seams:{angleDegrees:number;offsetDegrees:number;blockIndices:number[]}[];
  conflicts:{angleDegrees:number;stage:number;reason:"outside-sector"|"inside-template"}[];
}

const ANGLE_TOLERANCE=1e-9;
const normalize=(angle:number)=>((angle%360)+360)%360;

/** A conservative cut contract: a declared radial wall must be a whole motif boundary at EVERY level. */
export function planTransitionAngularSeams(plan:Pick<TransitionBandPlan,"counts"|"ratios">,
    options:TransitionAngularSeamOptions):TransitionAngularSeamPlan {
  const start=options.startAngleDegrees??0,sweep=options.sweepAngleDegrees??360;
  if(typeof start!=="number"||!Number.isFinite(start)||typeof sweep!=="number"||!Number.isFinite(sweep)||sweep<=0||sweep>360)
    throw new RangeError("invalid angular seam frame");
  const angles=options.seamAnglesDegrees===undefined?[]:options.seamAnglesDegrees;
  if(!Array.isArray(angles)||angles.length>4096||angles.some(a=>typeof a!=="number"||!Number.isFinite(a)))
    throw new RangeError("seamAnglesDegrees must contain at most 4096 finite angles");
  if(!Array.isArray(plan.ratios)||!plan.ratios.length||!Array.isArray(plan.counts)||plan.counts.length!==plan.ratios.length+1
      ||plan.counts.some(n=>!Number.isSafeInteger(n)||n<=0||n>200000)
      ||plan.ratios.some((r,i)=>(r!==2&&r!==3)||plan.counts[i]!% (r===2?4:3)!==0||plan.counts[i]!/r!==plan.counts[i+1]))
    throw new RangeError("angular seams require a valid complete-template count chain");
  const seams:TransitionAngularSeamPlan["seams"]=[],conflicts:TransitionAngularSeamPlan["conflicts"]=[];
  for(const angle of [...new Set(angles.map(normalize))].sort((a,b)=>a-b)){
    let offset=normalize(angle-normalize(start));
    if(360-offset<=ANGLE_TOLERANCE||offset<=ANGLE_TOLERANCE)offset=0;
    if(Math.abs(offset-sweep)<=ANGLE_TOLERANCE)offset=sweep;
    const blockIndices:number[]=[];
    if(offset>sweep+ANGLE_TOLERANCE){
      conflicts.push({angleDegrees:angle,stage:0,reason:"outside-sector"});
    }else for(const [i,ratio] of plan.ratios.entries()){
      const period=ratio===2?4:3,spacing=sweep*period/plan.counts[i]!,index=Math.round(offset/spacing);
      blockIndices.push(index);
      if(Math.abs(offset-index*spacing)>ANGLE_TOLERANCE)
        conflicts.push({angleDegrees:angle,stage:i+1,reason:"inside-template"});
    }
    seams.push({angleDegrees:angle,offsetDegrees:offset,blockIndices});
  }
  return {compatible:conflicts.length===0,geometryChecked:false,existingMeshStitched:false,
    angleToleranceDegrees:ANGLE_TOLERANCE,seams,conflicts};
}

export function requireTransitionAngularSeams(plan:Pick<TransitionBandPlan,"counts"|"ratios">,options:TransitionAngularSeamOptions) {
  const result=planTransitionAngularSeams(plan,options);
  const first=result.conflicts[0];
  if(first)throw new RangeError(`Radial seam ${first.angleDegrees} degrees ${first.reason=== "outside-sector"
    ?"lies outside the requested sector":`cuts a transition template at stage ${first.stage}`}; change the counts or angular phase explicitly`);
  return result;
}
