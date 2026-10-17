import type {LocalRefinement, Point} from "./types.js";
import {trilinear} from "./templates.js";

/** The 15-node corner pattern differs from the existing 16-node four-Hex slab.
 * Fractions describe the two cut edges in the reference bottom face; the
 * intermediate sheet is at half height. Map in reference space, not by adding
 * physical-space offsets (which only works for parallelepipeds).
 */
export function gui61CornerFourHexTemplate(vertices: readonly Point[], a: number, b: number): LocalRefinement {
  if(vertices.length!==8||vertices.some(p=>p.length!==3||p.some(v=>!Number.isFinite(v))))
    throw new Error("corner repair template requires eight finite 3D vertices");
  if(![a,b].every(v=>[1/3,1/2,2/3].some(x=>Math.abs(x-v)<1e-12)))
    throw new RangeError("corner repair supports only one-third, half and two-thirds cut fractions");
  const nodes=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1],
    [a,0,0],[0,b,0],[a,b,0],[0,0,.5],[0,b,.5],[a,0,.5],[a,b,.5]];
  return {kind:"H1",source:`Gui61Corner4(${a},${b})`,nodes:nodes.map(p=>trilinear(vertices,p[0]!,p[1]!,p[2]!)),
    elements:[[4,3,7,8,10,11,15,13],[3,2,6,7,11,9,14,15],
      [10,11,15,13,1,9,14,12],[5,8,7,6,12,13,15,14]]};
}
