import type {Point} from "./types.js";

export type CircularCorePatch = "center" | "x-wing" | "y-wing";

export function circularPolarPoint(radius:number,t:number):Point {
  return t===0?[radius,0,0]:t===1?[0,radius,0]
    :t===.5?[radius*Math.SQRT1_2,radius*Math.SQRT1_2,0]
    :[radius*Math.cos(Math.PI/2*t),radius*Math.sin(Math.PI/2*t),0];
}

/** Three conforming mapped quads; u/v follow physical X/Y logical axes. */
export function circularCorePoint(radius:number,axisExtent:number,join:number,patch:CircularCorePatch,u:number,v:number):Point {
  if(patch==="center")return [axisExtent*u+(join-axisExtent)*u*v,axisExtent*v+(join-axisExtent)*u*v,0];
  const t=patch==="y-wing"?u:v,s=patch==="y-wing"?v:u;
  const inner=patch==="y-wing"?[join*t,axisExtent+(join-axisExtent)*t]:[axisExtent+(join-axisExtent)*t,join*t];
  const outer=circularPolarPoint(radius,patch==="y-wing"?1-t/2:t/2);
  return [inner[0]!*(1-s)+outer[0]!*s,inner[1]!*(1-s)+outer[1]!*s,0];
}
