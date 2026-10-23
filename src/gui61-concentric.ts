import {planConcentricCircularMesh,generateConcentricCircularMesh,type ConcentricCircularSpec,type ConcentricTransitionRing} from "./concentric-circular.js";
import type {Gui61Request} from "./gui61-generators.js";
import {planConcentricRingWidths,type ConcentricWidthCriteria,type ConcentricWidthPlanningResult} from "./concentric-width-planner.js";

export const GUI_CONCENTRIC_ELEMENT_LIMIT=200000;
function parameters(request:Gui61Request):ConcentricCircularSpec {
  if(!request||request.schemaVersion!==1||request.kind!=="concentric-circular-solid"
    ||Object.keys(request).some(k=>!["schemaVersion","kind","parameters"].includes(k)))throw new RangeError("not a concentric GUI request");
  return request.parameters as unknown as ConcentricCircularSpec;
}
/** Cheap whole-model planning; never creates a reduced proxy of an oversized request. */
export function planGui61Concentric(request:Gui61Request){return planConcentricCircularMesh(parameters(request));}
export function gui61ConcentricStreamRequest(request:Gui61Request){
  const spec=parameters(request);planConcentricCircularMesh(spec);
  return {schemaVersion:1 as const,parameters:structuredClone(spec)};
}
export function planGui61ConcentricWidths(request:Gui61Request,criteria:ConcentricWidthCriteria){
  return planConcentricRingWidths({schemaVersion:1,parameters:parameters(request),criteria});
}
/** Proposals are tied to the unmodified source draft, never applied after an unrelated edit. */
export function applyGui61ConcentricWidthPlan(request:Gui61Request,proposal:ConcentricWidthPlanningResult):Gui61Request {
  const original=parameters(request);
  if(JSON.stringify(original)!==JSON.stringify(proposal.report.originalParameters))throw new RangeError("环宽建议已过期，请重新规划");
  const next=proposal.resolvedRequest.parameters;
  const frozen=(p:ConcentricCircularSpec)=>({...p,minimumCornerScaledJacobian:undefined,rings:p.rings.map(r=>({...r,outerRadius:undefined}))});
  if(JSON.stringify(frozen(original))!==JSON.stringify(frozen(next))
    ||(next.minimumCornerScaledJacobian??0)<(original.minimumCornerScaledJacobian??0))throw new RangeError("环宽建议改变了冻结参数或降低了质量条件");
  planConcentricCircularMesh(next);
  return {schemaVersion:1,kind:"concentric-circular-solid",parameters:structuredClone(next) as unknown as Record<string,unknown>};
}
export function generateGui61Concentric(spec:ConcentricCircularSpec){
  const plan=planConcentricCircularMesh(spec);
  if(plan.expectedElements>GUI_CONCENTRIC_ELEMENT_LIMIT)throw new RangeError(
    `完整模型 ${plan.expectedElements} 个单元，超过浏览器 ${GUI_CONCENTRIC_ELEMENT_LIMIT} 上限；请导出流式参数并使用 Node CLI。未修改几何或网格计数。`);
  return generateConcentricCircularMesh(spec);
}
/** Append/remove only the last ring; leave core, outer radius, height and seeds untouched. */
export function resizeGui61ConcentricRings(request:Gui61Request,delta:1|-1):Gui61Request {
  const spec=parameters(request),rings=spec.rings;
  if(!Array.isArray(rings)||rings.length<1||rings.length>8||(delta!==1&&delta!==-1)
    ||rings.length+delta<1||rings.length+delta>8)throw new RangeError("过渡环数量应为 1–8");
  const next=structuredClone(request),copy=next.parameters.rings as ConcentricTransitionRing[];
  if(delta<0)copy.pop();
  else{
    const last=rings.at(-1),width=spec.height/spec.axialSegments*2**(rings.length+1);
    if(!last||!Number.isFinite(last.outerRadius)||!Number.isFinite(width)||width<=0)throw new RangeError("先输入有效的厚度、轴向计数和末环外半径");
    copy.push({innerRadius:last.outerRadius,outerRadius:last.outerRadius+width,radialSize:width});
  }
  return next;
}
