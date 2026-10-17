import {repairGui61Interfaces, type Gui61InterfaceRepairOptions} from "./gui61-interface-repair.js";
import {meshToLsdynaMixedKeyword,parseNativeLsdynaMixedKeyword} from "./lsdyna-mixed.js";
import {checkNoHangingNodes} from "./conformance.js";
import {minElementEdgeLength} from "./mesh.js";
import type {Mesh} from "./types.js";
import type {Gui61Generated} from "./gui61-generators.js";

export interface Gui61RepairRequest {
  schemaVersion: 1;
  kind: "interface-repair";
  mesh: Mesh;
  repair: Gui61InterfaceRepairOptions;
}
function record(value:unknown): value is Record<string,unknown> {
  return !!value&&typeof value==="object"&&!Array.isArray(value);
}
/** Shared browser/CLI adapter. Full solver decks and unknown metadata are refused. */
export function generateGui61Repair(input:unknown):Gui61Generated {
  if(!record(input)||input.schemaVersion!==1||(input.kind!==undefined&&input.kind!=="interface-repair")
      ||!record(input.mesh)||!record(input.repair)
      ||Object.keys(input).some(k=>!["schemaVersion","kind","mesh","repair"].includes(k))
      ||Object.keys(input.mesh).some(k=>!["kind","nodes","elements"].includes(k))
      ||Object.keys(input.repair).some(k=>!["parentElementIds","tolerance","partIds"].includes(k)))
    throw new Error("Expected schemaVersion=1 with mesh and repair; solver metadata is not accepted");
  const request=structuredClone({...input,kind:"interface-repair"}) as unknown as Gui61RepairRequest;
  const result=repairGui61Interfaces(request.mesh,request.repair);
  const model={nodes:result.mesh.nodes,solids:result.mesh.elements.map((nodes,i)=>({id:i+1,
    partId:request.repair.partIds?.[result.parentElementIds[i]!-1]??1,nodes})),beams:[]};
  const keyword=meshToLsdynaMixedKeyword(model,{coordinateFormat:"compact"});
  const back=parseNativeLsdynaMixedKeyword(keyword);
  if(JSON.stringify(back.solids)!==JSON.stringify(model.solids))throw new Error("Repair K connectivity/PID read-back failed");
  const maxError=back.nodes.reduce((error,p,i)=>Math.max(error,Math.hypot(...p.map((v,a)=>v-model.nodes[i]![a]!))),0);
  if(maxError>minElementEdgeLength(result.mesh)*1e-8
      ||!checkNoHangingNodes({kind:"H1",nodes:back.nodes,elements:back.solids.map(e=>e.nodes)},request.repair.tolerance).ok)
    throw new Error("Repair K rounding/conformance read-back failed");
  const summary={nodes:model.nodes.length,solids:model.solids.length,quads:0,beams:0,warnings:[]};
  const plan={repairedParentIds:result.repairedParentIds,addedNodeIds:result.addedNodeIds,repairs:result.repairs};
  const report={schemaVersion:1,implementation:"typescript-native-template-repair",request,plan,summary,
    inputNodes:request.mesh.nodes.length,outputNodes:result.mesh.nodes.length,
    inputElements:request.mesh.elements.length,outputElements:result.mesh.elements.length,
    ...plan,quality:result.quality,readbackMaximumCoordinateError:maxError,
    numbering:"Dense input node IDs preserved. Output EIDs are dense; lineage maps to dense input parent IDs, not source K EIDs.",
    partIds:request.repair.partIds?"Inherited through parent lineage":"Explicit default PID 1",
    scope:"Mesh-only NODE/SOLID. No solver cards, beam/shell elements or sets are imported or inferred."};
  return {request,mesh:result.mesh,model,plan,quality:result.quality,summary,files:{
    "mesh.k":keyword,"mesh.json":JSON.stringify(result.mesh),"request.json":JSON.stringify(request),
    "lineage.json":JSON.stringify({parentElementIds:result.parentElementIds}),"report.json":JSON.stringify(report,null,2)}};
}
