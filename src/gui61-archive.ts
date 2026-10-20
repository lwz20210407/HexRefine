import {gui61Kinds,gui61Fields,gui61Value,type Gui61Request,type Gui61Generated} from "./gui61-generators.js";

const replayFiles=["node_sets.json","cell_sets.json","lineage.json"] as const;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
export interface Gui61ParameterImport {
  request:Gui61Request;
  exportK?:boolean;
  expectedFiles?:Record<string,unknown>;
}

/** Parse only; costly mesh generation remains in the worker, not file import. */
export function parseGui61ParameterFile(value:unknown):Gui61ParameterImport {
  if(!record(value))throw new RangeError("invalid GUI61 parameter file");
  const isArchive=!Object.hasOwn(value,"schemaVersion"),candidate=isArchive?value.request:value;
  if(isArchive){
    if(Object.keys(value).some(k=>!["archiveVersion","request","ui","files"].includes(k)))throw new RangeError("unknown GUI61 archive field");
    if(value.archiveVersion!==undefined&&value.archiveVersion!==1)throw new RangeError("unsupported GUI61 archive version");
    if(value.ui!==undefined&&(!record(value.ui)||Object.keys(value.ui).some(k=>k!=="exportK")||typeof value.ui.exportK!=="boolean"))throw new RangeError("invalid GUI61 archive UI state");
    if(value.files!==undefined&&(!record(value.files)||Object.values(value.files).some(v=>typeof v!=="string")))throw new RangeError("invalid GUI61 archive files");
    if(value.archiveVersion===1&&(!record(value.files)||typeof value.files["request.json"]!=="string"||typeof value.files["report.json"]!=="string"))throw new RangeError("incomplete versioned GUI61 archive");
  }
  if(!record(candidate)||candidate.schemaVersion!==1||!gui61Kinds.some(([k])=>k===candidate.kind)
    ||!record(candidate.parameters)||Object.keys(candidate).some(k=>!["schemaVersion","kind","parameters"].includes(k)))throw new RangeError("invalid GUI61 request");
  const request=candidate as unknown as Gui61Request;
  for(const field of gui61Fields(request)){
    const v=gui61Value(request,field.path);
    if(v===undefined&&field.optional)continue;
    if(field.type==="number"&&(typeof v!=="number"||!Number.isFinite(v)))throw new RangeError(`GUI61 field ${field.path} requires a finite number`);
    if(field.type==="choice"&&!field.options!.some(([option])=>v===option))throw new RangeError(`invalid GUI61 choice ${field.path}`);
    if(field.type==="toggle"&&v!==field.on&&v!==field.off)throw new RangeError(`invalid GUI61 toggle ${field.path}`);
  }
  const result:Gui61ParameterImport={request:structuredClone(request)};
  if(isArchive&&record(value.ui))result.exportK=value.ui.exportK as boolean;
  if(isArchive&&record(value.files)){
    const files=value.files;
    if(files["request.json"]!==undefined&&!same(JSON.parse(files["request.json"] as string),request))throw new Error("GUI61 archive request disagrees with request.json");
    if(files["report.json"]!==undefined&&!same(JSON.parse(files["report.json"] as string)?.request,request))throw new Error("GUI61 archive request disagrees with report.json");
    const expected:Record<string,unknown>={};
    for(const name of replayFiles)if(files[name]!==undefined)expected[name]=JSON.parse(files[name] as string);
    if(value.archiveVersion===1&&request.kind.startsWith("reinforced-")&&replayFiles.slice(0,2).some(name=>!Object.hasOwn(expected,name)))throw new Error("RC archive is missing named mesh sets");
    result.expectedFiles=expected;
  }
  return result;
}

/** Export geometry-independent state plus exact named sets; no solver K is lost or rewritten. */
export function createGui61ParameterArchive(result:Gui61Generated,exportK=true){
  if(!gui61Kinds.some(([kind])=>kind===result.request.kind))throw new RangeError("not a GUI61 generator result");
  if(typeof exportK!=="boolean")throw new TypeError("exportK must be boolean");
  return {archiveVersion:1 as const,request:structuredClone(result.request),ui:{exportK},
    files:Object.fromEntries(Object.entries(result.files).filter(([name])=>name!=="mesh.k"))};
}

/** Verify before displaying a replay; never silently replace stored RC sets. */
export function verifyGui61ParameterReplay(imported:Gui61ParameterImport,result:Gui61Generated):void {
  if(!same(imported.request,result.request))throw new Error("GUI61 replay request mismatch");
  for(const [name,expected] of Object.entries(imported.expectedFiles??{})){
    if(!result.files[name]||!same(expected,JSON.parse(result.files[name]!)))throw new Error(`GUI61 replay ${name} mismatch; stored mesh sets or lineage would change`);
  }
}

function same(a:unknown,b:unknown):boolean {
  if(a===b)return true;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]));
  if(!record(a)||!record(b))return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
}
