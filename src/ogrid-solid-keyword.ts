import {checkNoHangingNodes} from "./conformance.js";
import {hexElementSignedVolume,minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {fixedFloat,fixedInteger} from "./lsdyna-format-internal.js";
import {minElementEdgeLength} from "./mesh.js";
import {refineExtrudedOgrid} from "./ogrid-refinement.js";
import {extractExtrudedSection,sectionEdges} from "./ogrid-section.js";
import {auditSolidTransitionReadback} from "./transition-solid-regions.js";
import type {Mesh,Point} from "./types.js";

type Axis=0|1|2;
type Block={header:string; key:string; lines:string[]};
type Solid={id:number; pid:number; conn:number[]; raw:string[]; block:Block};
type MeshNode={p:Point; raw:string};
const positiveId=(s:string|undefined,label:string)=>{
  const i=Number(s);
  if (!s||!/^\+?\d+$/.test(s)||!Number.isSafeInteger(i)||i<=0||i>99999999)
    throw new Error(`invalid ${label}: ${s??"missing"}`);
  return i;
};
const positional=(line:string,w:number)=>line.includes(",")
  ?line.trim().split(",").map(x=>x.trim())
  :(line.trimEnd().match(new RegExp(`.{1,${w}}`,"g"))??[]).map(x=>x.trim());
const data=(b:Block)=>b.lines.filter(s=>s.trim()&&!s.trimStart().startsWith("$"));
const nodeSetKeys=new Set(["*SET_NODE_LIST","*SET_NODE_LIST_TITLE"]);
const solidSetKeys=new Set(["*SET_SOLID_LIST","*SET_SOLID_LIST_TITLE"]);

/** Deliberately a mesh-export parser, not a solver-deck rewrite. */
export function parseSolidOgridSource(text:string) {
  const blocks:Block[]=[];
  for (const raw of text.replace(/^\uFEFF/,"").split(/\r?\n/)) {
    if (raw.trimStart().startsWith("*")) blocks.push({header:raw,key:raw.trim().split(/\s+/)[0]!.toUpperCase(),lines:[]});
    else if (blocks.length) blocks.at(-1)!.lines.push(raw);
    else if (raw.trim()&&!raw.trimStart().startsWith("$")) throw new Error("data outside a keyword block");
  }
  if (blocks[0]?.key!=="*KEYWORD"||blocks.at(-1)?.key!=="*END"||data(blocks.at(-1)!).length)
    throw new Error("expected an inline *KEYWORD ... *END deck");
  const nodes=new Map<number,MeshNode>(), solids=new Map<number,Solid>();
  const nodeSets=new Map<number,{ids:Set<number>;title:string}>(), solidSets=new Map<number,Set<number>>();
  const namedSpecimens=new Set<number>();
  const omitted=new Set<string>();
  const symmetrySpc=new Map<number,Axis>();
  for (const b of blocks) {
    const rows=data(b);
    if (b.key==="*NODE") for (const line of rows) {
      const f=line.includes(",")?line.trim().split(",").map(s=>s.trim()):
        [line.slice(0,8),line.slice(8,24),line.slice(24,40),line.slice(40,56)].map(s=>s.trim());
      const id=positiveId(f[0],"node ID"), p=f.slice(1,4).map(s=>Number(s.replace(/[dD]/,"e")));
      if (p.length!==3||p.some(x=>!Number.isFinite(x))||nodes.has(id)) throw new Error("invalid or duplicate *NODE");
      nodes.set(id,{p,raw:line});
    } else if (b.key==="*ELEMENT_SOLID") {
      for (let i=0;i<rows.length;i++) {
        const first=rows[i]!, head=positional(first,8);
        let fields=head, raw=[first];
        if (head.length===2) {
          const next=rows[++i];
          if (!next) throw new Error("incomplete two-line solid record");
          const tail=positional(next,8);
          if (tail.length!==8&&(tail.length!==10||tail.slice(8).some(x=>Number(x)!==0)))
            throw new Error("unexpected nonzero extra solid node slots");
          fields=[...head,...tail.slice(0,8)]; raw.push(next);
        }
        if (fields.length!==10) throw new Error("unsupported *ELEMENT_SOLID record");
        const id=positiveId(fields[0],"solid ID"), pid=positiveId(fields[1],"PID");
        if (solids.has(id)) throw new Error("duplicate solid ID");
        solids.set(id,{id,pid,conn:fields.slice(2).map(x=>positiveId(x,"solid node ID")),raw,block:b});
      }
    } else if (nodeSetKeys.has(b.key)||solidSetKeys.has(b.key)) {
      const title=b.key.endsWith("_TITLE")?rows.shift()?.trim()??"":"";
      const sid=positiveId(positional(rows.shift()??"",10)[0],"set ID");
      const ids=new Set(rows.flatMap(x=>positional(x,10)).filter(x=>x&&Number(x)!==0).map(x=>positiveId(x,"set member")));
      if (nodeSetKeys.has(b.key)) {
        if (nodeSets.has(sid)) throw new Error("ambiguous node set ID");
        nodeSets.set(sid,{ids,title});
      } else {
        if (solidSets.has(sid)) throw new Error("ambiguous solid set ID");
        solidSets.set(sid,ids);
      }
    } else if (b.key==="*PART") {
      if (/^specimen$/i.test(rows[0]?.trim()??"")) namedSpecimens.add(positiveId(positional(rows[1]??"",10)[0],"PID"));
      omitted.add(b.key);
    } else if (b.key==="*BOUNDARY_SPC_SET") {
      for (const line of rows) {
        const values=positional(line,10).map(Number);
        if (values.length!==8||values[1]!==0||values.slice(2).some(v=>v!==0&&v!==1)) continue;
        const on=values.slice(2).flatMap((v,i)=>v?[i]:[]);
        if (on.length===1&&on[0]!<3) symmetrySpc.set(values[0]!,on[0] as Axis);
      }
      omitted.add(b.key);
    } else if (/^\*(INCLUDE|ELEMENT_|NODE_|SET_)/.test(b.key)) {
      throw new Error(`unsupported mesh dependency or set ${b.key}`);
    } else if (!["*KEYWORD","*END","*TITLE"].includes(b.key)) omitted.add(b.key);
  }
  if (!nodes.size||!solids.size) throw new Error("no inline solid mesh");
  for (const solid of solids.values())
    if (solid.conn.some(n=>!nodes.has(n))) throw new Error(`undefined node on solid ${solid.id}`);
  if ([...nodeSets.values()].some(s=>[...s.ids].some(n=>!nodes.has(n)))||
      [...solidSets.values()].some(s=>[...s].some(e=>!solids.has(e))))
    throw new Error("undefined set references");
  return {blocks,nodes,solids,nodeSets,solidSets,namedSpecimens,symmetrySpc,omitted};
}

function maxId(values:Iterable<number>) {
  let max=0; for (const n of values) max=Math.max(max,n); return max;
}
const pointKey=(p:Point)=>p.join(":");
const connKey=(e:readonly number[])=>[...e].sort((a,b)=>a-b).join(":");

export function refineSolidOgridKeyword(text:string,options:{fraction:number;partId?:number}) {
  if (!Number.isFinite(options.fraction)||options.fraction<=0||options.fraction>=1)
    throw new RangeError("fraction must be strictly between zero and one");
  const source=parseSolidOgridSource(text);
  const all=[...source.solids.values()];
  const pids=new Set(all.map(e=>e.pid));
  const pid=options.partId??(source.namedSpecimens.size===1?[...source.namedSpecimens][0]:
    pids.size===1?all[0]!.pid:undefined);
  if (pid===undefined||!pids.has(pid)) throw new Error("specify a unique existing specimen PID");
  const parent=all.filter(e=>e.pid===pid);
  if (parent.some(e=>new Set(e.conn).size!==8)) throw new Error("specimen PID must contain only H8");
  const originalIds=[...new Set(parent.flatMap(e=>e.conn))].sort((a,b)=>a-b);
  const local=new Map(originalIds.map((id,i)=>[id,i+1]));
  const mesh:Mesh={kind:"H1",nodes:originalIds.map(n=>source.nodes.get(n)!.p),
    elements:parent.map(e=>e.conn.map(n=>local.get(n)!))};
  const possibilities=([0,1,2] as const).flatMap(axis=>{
    try{return [extractExtrudedSection(mesh,axis)];} catch {return [];}
  });
  if (possibilities.length!==1) throw new Error("requires one unambiguous extruded section axis");
  const section=possibilities[0]!,axis=section.axis;
  const outer=sectionEdges(section.quads).filter(e=>e.owners.length===1);
  const graph=new Map<number,number[]>();
  for (const {vertices:[a,b]} of outer) for (const [p,q] of [[a,b],[b,a]] as const) graph.set(p,[...(graph.get(p)??[]),q]);
  if (!graph.size||[...graph.values()].some(n=>n.length!==2)) throw new Error("section must have one closed boundary");
  const first=graph.keys().next().value!, queue=[first], seen=new Set(queue);
  for (let i=0;i<queue.length;i++) for (const j of graph.get(queue[i]!)!) if (!seen.has(j)) {seen.add(j);queue.push(j);}
  if (seen.size!==graph.size) throw new Error("hollow or disconnected sections are not supported by the solid route");

  const a=section.planes[0]!, b=section.planes.at(-1)!;
  const lo=(a+b-(b-a)*options.fraction)/2, hi=(a+b+(b-a)*options.fraction)/2;
  const roi=section.planes.slice(1).flatMap((z,i)=>{
    const mid=(z+section.planes[i]!)/2;
    return mid>=lo-section.tolerance&&mid<=hi+section.tolerance?[i]:[];
  });
  if (roi.length<3||roi[0]===0||roi.at(-1)===section.planes.length-2)
    throw new Error("ROI needs interior core, two transition layers and retained ends");
  const core=roi.slice(1,-1), coreMin=section.planes[core[0]!]!,coreMax=section.planes[core.at(-1)!+1]!;
  const symmetryPlanes:{axis:Axis;coordinate:number}[]=[];
  for(const [sid,dir] of source.symmetrySpc) {
    if(dir===axis)continue;
    const set=source.nodeSets.get(sid)?.ids;
    if(!set?.size||[...set].some(n=>!local.has(n)))continue;
    const pts=[...set].map(n=>source.nodes.get(n)!.p[dir]!);
    const coord=pts[0]!;
    const coords=mesh.nodes.map(p=>p[dir]!);
    const edge=coords.every(v=>v>=coord-section.tolerance)||coords.every(v=>v<=coord+section.tolerance);
    if (edge&&pts.every(x=>Math.abs(x-coord)<=section.tolerance)&&
        originalIds.every((id,i)=>Math.abs(coords[i]!-coord)>section.tolerance||set.has(id)))
      symmetryPlanes.push({axis:dir,coordinate:coord});
  }
  const indices=new Set(roi);
  const expected=new Set(section.parentIds.flatMap(col=>col.filter((_,i)=>indices.has(i))));
  const expectedCore=new Set(section.parentIds.flatMap(col=>core.map(i=>col[i]!)));
  const removedIds=new Set([...expected].map(i=>parent[i-1]!.id));
  if ([...source.solidSets.values()].some(m=>[...m].some(e=>removedIds.has(e))))
    throw new Error("solid set references selected parents; explicit migration required");
  const prepared=refineExtrudedOgrid(mesh,{axis,bands:[{min:coreMin,max:coreMax,level:1}],
    completion:"none",maxPromotedSourceLayers:0,symmetryPlanes});
  const changed=new Set(prepared.completedParentIds.filter((_,i)=>prepared.levels[i]!==0));
  if (changed.size!==expected.size||[...expected].some(id=>!changed.has(id)))
    throw new Error("transition support did not stay inside the full authorized ROI");
  const coverage=new Map<number,number>();
  prepared.completedParentIds.forEach((pid,i)=>{
    if (!expectedCore.has(pid)) return;
    if (!prepared.uniformCells[i]||prepared.levels[i]!==1) throw new Error("transition entered the uniform core");
    coverage.set(pid,(coverage.get(pid)??0)+1);
  });
  if (coverage.size!==expectedCore.size||[...coverage.values()].some(n=>n!==8))
    throw new Error("core lacks eight uniform children per parent");

  const byPoint=new Map<string,number>();
  originalIds.forEach((id,i)=>{
    const k=pointKey(mesh.nodes[i]!);
    if(byPoint.has(k))throw new Error("coincident original specimen nodes");
    byPoint.set(k,id);
  });
  let nextNode=maxId(source.nodes.keys()),nextSolid=maxId(source.solids.keys());
  const newNodes:string[]=[];
  const outIds=prepared.mesh.nodes.map(p=>{
    const existing=byPoint.get(pointKey(p));
    if(existing!==undefined)return existing;
    const nid=++nextNode;
    newNodes.push(fixedInteger(nid,8,"node")+p.map(v=>fixedFloat(v,16,8,"compact")).join(""));
    return nid;
  });
  const newElements:string[]=[];
  const newElementIds:number[]=[],newParentIds:number[]=[],newRoles:string[]=[];
  const retainedSpecimen=new Set<number>();
  prepared.mesh.elements.forEach((conn,i)=>{
    const original=parent[prepared.completedParentIds[i]!-1]!;
    const ids=conn.map(n=>outIds[n-1]!);
    if (!prepared.levels[i]) {
      if (ids.some((n,j)=>n!==original.conn[j])) throw new Error("untouched original connectivity was changed");
      retainedSpecimen.add(original.id);
      return;
    }
    const eid=++nextSolid;
    newElementIds.push(eid);newParentIds.push(original.id);newRoles.push(prepared.roles[i]!);
    newElements.push([eid,pid,...ids].map(n=>fixedInteger(n,8,"solid")).join(""));
  });
  if (retainedSpecimen.size!==parent.length-expected.size) throw new Error("unexpected untouched-element count");
  const output=["*KEYWORD","$ HexRefine mesh and original sets only; solver controls and histories omitted."];
  for (const block of source.blocks) {
    if (block.key==="*NODE"||block.key==="*TITLE"||nodeSetKeys.has(block.key)||solidSetKeys.has(block.key)) {
      output.push(block.header,...block.lines);
    } else if (block.key==="*ELEMENT_SOLID") {
      output.push(block.header);
      for (const e of all) if (e.block===block&&!removedIds.has(e.id)) output.push(...e.raw);
    }
  }
  const keyword=[...output,"*NODE",...newNodes,"*ELEMENT_SOLID",...newElements,"*END",""].join(text.includes("\r\n")?"\r\n":"\n");
  const back=parseSolidOgridSource(keyword);
  const readbackAll=[...back.solids.values()];
  const backSpecimen=readbackAll.filter(e=>e.pid===pid);
  const denseIds=[...new Set(backSpecimen.flatMap(e=>e.conn))];
  const remap=new Map(denseIds.map((n,i)=>[n,i+1]));
  const kept=all.filter(e=>!removedIds.has(e.id));
  for (const e of kept) {
    const old=back.solids.get(e.id);
    if (!old||old.pid!==e.pid||old.conn.some((n,i)=>n!==e.conn[i])||old.raw.join("\n")!==e.raw.join("\n"))
      throw new Error("keyword readback changed an unselected record");
  }
  if ([...source.nodes].some(([id,node])=>back.nodes.get(id)?.raw!==node.raw))
    throw new Error("keyword readback changed an original node");
  const active=new Set(readbackAll.flatMap(e=>e.conn));
  const oldActive=new Set(all.flatMap(e=>e.conn));
  if ([...source.nodeSets.values()].some(s=>[...s.ids].some(n=>oldActive.has(n)&&!active.has(n))))
    throw new Error("a referenced node would be orphaned");
  const readSetBlocks=(d:typeof back)=>d.blocks.filter(b=>nodeSetKeys.has(b.key)||solidSetKeys.has(b.key)).map(b=>[b.header,...b.lines]);
  if (JSON.stringify(readSetBlocks(source))!==JSON.stringify(readSetBlocks(back))) throw new Error("original set blocks changed");
  const backMesh:Mesh={kind:"H1",nodes:denseIds.map(id=>back.nodes.get(id)!.p),
    elements:backSpecimen.map(e=>e.conn.map(n=>remap.get(n)!))};
  const oldVolume=prepared.report.quality.originalVolume;
  const edge=minElementEdgeLength(backMesh);
  if (!checkNoHangingNodes(backMesh,edge*1e-8).ok) throw new Error("specimen K readback has hanging interfaces");
  const quality=auditSolidTransitionReadback(backMesh,oldVolume);
  let newMin=Infinity;
  const installed:Mesh={...backMesh,elements:newElementIds.map(n=>back.solids.get(n)!.conn.map(x=>remap.get(x)!))};
  for (const e of installed.elements) newMin=Math.min(newMin,minimumHexCornerScaledJacobian(e.map(n=>installed.nodes[n-1]!)));
  if (!(newMin>=0.15)) throw new Error(`new H8 corner SJ ${newMin} is below the existing 0.15 gate`);
  const sourceRoiVolume=[...expected].reduce((s,i)=>s+hexElementSignedVolume(mesh.elements[i-1]!.map(n=>mesh.nodes[n-1]!)),0);
  const installedQuality=auditSolidTransitionReadback(installed,sourceRoiVolume);
  return {keyword,report:{mode:"solid-ogrid",ratio:2,pid,axis,requestedFraction:options.fraction,
    requestedBand:[lo,hi],roiLayers:roi,coreLayers:core,layerCount:section.planes.length-1,
    sectionColumns:section.quads.length,symmetryPlanes,roiParentIds:[...removedIds],
    coreParentIds:[...expectedCore].map(i=>parent[i-1]!.id),newElementIds,newParentIds,newRoles,
    retainedSpecimenElements:retainedSpecimen.size,retainedOtherPartElements:all.length-parent.length,
    originalNodeRecords:source.nodes.size,preservedNodeSets:source.nodeSets.size,preservedSolidSets:source.solidSets.size,
    newNodes:newNodes.length,specimenElements:backMesh.elements.length,outputNodes:back.nodes.size,
    outputElements:back.solids.size,minimumNewCornerSJ:newMin,minimumRequiredCornerSJ:.15,quality,installedQuality,
    omittedSolverCards:[...source.omitted],scope:"Mesh and original sets only; no solver controls or histories migrated."}};
}
