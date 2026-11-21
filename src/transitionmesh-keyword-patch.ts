import {checkNoHangingNodes} from "./conformance.js";
import {hexElementSignedVolume} from "./hex-quality.js";
import {fixedFloat, fixedInteger} from "./lsdyna-format-internal.js";
import {minElementEdgeLength} from "./mesh.js";
import {auditSolidTransitionReadback} from "./transition-solid-regions.js";
import type {Mesh, Point} from "./types.js";

interface Solid {id: number; part: number; nodes: number[]; line: number}
const outwardFaces = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
const knownCards = new Set(["*KEYWORD", "*TITLE", "*NODE", "*ELEMENT_SOLID", "*SET_NODE_LIST", "*SET_SOLID_LIST", "*END"]);
const orderless = (xs: readonly number[]) => [...xs].sort((a,b) => a-b).join(":");
const pointKey = (p: Point) => p.join(":");

function id(text: string | undefined, label: string, allowZero = false) {
  const value = Number(text);
  if (!text || !/^\+?\d+$/.test(text) || !Number.isSafeInteger(value)
      || value < (allowZero ? 0 : 1) || value > 99999999)
    throw new Error(`invalid ${label}: ${text ?? "missing"}`);
  return value;
}

export function readTransitionPatchDeck(text: string, allowSets: boolean) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const nodes = new Map<number, Point>(), solids = new Map<number, Solid>();
  const nodeSet = new Set<number>(), solidSet = new Set<number>();
  let card = "", row = 0, end = -1;
  for (const [line, raw] of lines.entries()) {
    const v = raw.trim();
    if (!v || v.startsWith("$")) continue;
    if (end >= 0) throw new Error("unexpected record after *END");
    if (v.startsWith("*")) {
      if ((card === "*SET_NODE_LIST" || card === "*SET_SOLID_LIST") && row < 2)
        throw new Error(`incomplete ${card}`);
      card = v.toUpperCase();
      row = 0;
      if (!knownCards.has(card) || (!allowSets && card.startsWith("*SET_")))
        throw new Error(`unsupported card ${card}; use a mesh-only H8 deck`);
      if (card === "*END") end = line;
      continue;
    }
    if (card === "*TITLE") {
      if (row++) throw new Error("expected one *TITLE record");
      continue;
    }
    const csv = raw.includes(",") ? v.split(",").map(s=>s.trim()) : undefined;
    if (card === "*NODE") {
      const fields = csv ?? (raw.length >= 56
        ? [raw.slice(0,8),raw.slice(8,24),raw.slice(24,40),raw.slice(40,56)].map(s=>s.trim())
        : v.split(/\s+/));
      const n = id(fields[0],"node ID");
      const p = [1,2,3].map(i => Number((fields[i] ?? "0").replace(/[dD]/,"e")));
      if (fields.length < 4 || fields.length > 6 || p.some(x=>!Number.isFinite(x)) || nodes.has(n))
        throw new Error(`invalid or duplicate node ${n}`);
      nodes.set(n,p);
    } else if (card === "*ELEMENT_SOLID") {
      const fields = csv ?? (raw.length >= 80
        ? (raw.trimEnd().match(/.{1,8}/g) ?? []).map(s=>s.trim()) : v.split(/\s+/));
      if (fields.length !== 10) throw new Error("expected one-line eight-node *ELEMENT_SOLID record");
      const eid = id(fields[0],"element ID"), part = id(fields[1],"part ID");
      const conn = fields.slice(2).map(s=>id(s,"connectivity node ID"));
      if (solids.has(eid) || new Set(conn).size !== 8) throw new Error(`invalid or duplicate solid ${eid}`);
      solids.set(eid,{id:eid,part,nodes:conn,line});
    } else if (card === "*SET_NODE_LIST" || card === "*SET_SOLID_LIST") {
      const fields = csv ?? ((raw.trimEnd().match(/.{1,10}/g) ?? []).map(s=>s.trim()));
      if (row++ === 0) id(fields[0],"set ID");
      else for (const f of fields) {
        if (!f) continue;
        const value = id(f,"set member",true);
        if (value) (card==="*SET_NODE_LIST" ? nodeSet : solidSet).add(value);
      }
    } else {
      throw new Error(`unexpected data outside a supported record on line ${line+1}`);
    }
  }
  if (!nodes.size || !solids.size || end < 0) throw new Error("expected nonempty H8 mesh and *END");
  if (solids.size > 20000 || nodes.size > 160000)
    throw new RangeError("mesh patch supports at most 20000 H8 and 160000 nodes per input");
  for (const {nodes:conn,id:e} of solids.values())
    if (conn.some(n=>!nodes.has(n))) throw new Error(`solid ${e} refers to an undefined node`);
  if ([...nodeSet].some(n=>!nodes.has(n)) || [...solidSet].some(e=>!solids.has(e)))
    throw new Error("set references an undefined mesh entity");
  return {nodes,solids,nodeSet,solidSet,lines,eol,end};
}

function opposite(a: number[], b: number[]) {
  const start = b.indexOf(a[0]!);
  return start >= 0 && a.every((n,i)=>n===b[(start+4-i)%4]);
}

function sameCycle(a: number[], b: number[]) {
  const start = b.indexOf(a[0]!);
  return start >= 0 && a.every((n,i)=>n===b[(start+i)%4]);
}

function indexFaces(cells: readonly Solid[], requireConnected = false) {
  const owners = new Map<string,{ids:number[]; indices:number[]}>();
  const unique = new Set<string>();
  const neighbors = cells.map(()=>[] as number[]);
  for (const [i,cell] of cells.entries()) {
    const key = orderless(cell.nodes);
    if (unique.has(key)) throw new Error("duplicate H8 connectivity");
    unique.add(key);
    for (const face of outwardFaces) {
      const ids = face.map(j=>cell.nodes[j]!);
      const k = orderless(ids);
      const entry = owners.get(k);
      if (!entry) owners.set(k,{ids,indices:[i]});
      else {
        if (entry.indices.length !== 1 || !opposite(entry.ids,ids))
          throw new Error("nonmanifold or inconsistent shared face");
        neighbors[i]!.push(entry.indices[0]!);
        neighbors[entry.indices[0]!]!.push(i);
        entry.indices.push(i);
      }
    }
  }
  if (requireConnected) {
    const seen = new Set([0]), queue = [0];
    for (let i=0;i<queue.length;i++) for (const j of neighbors[queue[i]!]!) {
      if (!seen.has(j)) {seen.add(j); queue.push(j);}
    }
    if (queue.length !== cells.length) throw new Error("patch must be connected by complete faces");
  }
  return owners;
}

function boundaryOf(owners: ReturnType<typeof indexFaces>) {
  return new Map([...owners].filter(([,e])=>e.indices.length===1).map(([k,e])=>[k,e.ids]));
}

function inspectFaces(cells: readonly Solid[], requireConnected = false) {
  return boundaryOf(indexFaces(cells,requireConnected));
}

function compactMesh(nodes: ReadonlyMap<number,Point>, cells: readonly Solid[]): Mesh {
  const ids = new Map<number,number>(), points: Point[] = [];
  const elements = cells.map(cell=>cell.nodes.map(n=>{
    if (!ids.has(n)) {points.push(nodes.get(n)!); ids.set(n,points.length);}
    return ids.get(n)!;
  }));
  return {kind:"H1",nodes:points,elements};
}

function volume(mesh: Mesh) {
  return mesh.elements.reduce((sum,e)=>sum+hexElementSignedVolume(e.map(i=>mesh.nodes[i-1]!)),0);
}

function sameBoundary(a: Map<string,number[]>, b: Map<string,number[]>, label: string) {
  if (a.size !== b.size || [...a].some(([k,ids])=>{
    const other=b.get(k);
    return !other || !sameCycle(ids,other);
  })) throw new Error(`${label} boundary quadrilateral connectivity does not match`);
}

function pointIndex(nodes: ReadonlyMap<number,Point>) {
  const byPoint = new Map<string,number[]>();
  for (const [n,p] of nodes) {
    const key=pointKey(p), pool=byPoint.get(key)??[];
    pool.push(n); byPoint.set(key,pool);
  }
  return byPoint;
}

function discoverSelection(cells: readonly Solid[], hostFaces: ReturnType<typeof indexFaces>,
    candidateBoundary: Map<string,number[]>, candidateNodes: ReadonlyMap<number,Point>,
    hostByPoint: Map<string,number[]>) {
  const barrier = new Map<string,number[]>();
  const insideOwners = new Set<number>();
  const outsideOwners = new Set<number>();
  for (const face of candidateBoundary.values()) {
    const ids=face.map(n=>{
      const matches=hostByPoint.get(pointKey(candidateNodes.get(n)!));
      if (matches?.length!==1)
        throw new Error("automatic selection requires each boundary node to uniquely match one host node");
      return matches[0]!;
    });
    const key=orderless(ids), match=hostFaces.get(key);
    if (!match || barrier.has(key))
      throw new Error("automatic selection requires each complete boundary face in the host");
    const i=sameCycle(match.ids,ids)?0:opposite(match.ids,ids)?1:-1;
    const inside=match.indices[i];
    const outside=match.indices[1-i];
    if (inside===undefined)
      throw new Error("automatic selection cannot identify the interior side of a boundary face");
    insideOwners.add(inside);
    if (outside!==undefined) outsideOwners.add(outside);
    barrier.set(key,ids);
  }
  // The oriented boundary determines the seed; do not flood across its faces.
  const seed=insideOwners.values().next().value!;
  const found=new Set<number>([seed]), queue=[seed];
  for (let i=0;i<queue.length;i++) {
    const here=queue[i]!, cell=cells[here]!;
    for (const face of outwardFaces) {
      const key=orderless(face.map(j=>cell.nodes[j]!));
      if (barrier.has(key)) continue;
      for (const n of hostFaces.get(key)!.indices) {
        if (!found.has(n)) {found.add(n); queue.push(n);}
      }
    }
  }
  if ([...insideOwners].some(i=>!found.has(i)) || [...outsideOwners].some(i=>found.has(i)))
    throw new Error("automatic selection boundary does not enclose one unambiguous connected cavity");
  const picked=cells.filter((_,i)=>found.has(i));
  sameBoundary(barrier,inspectFaces(picked),"automatic selection");
  return picked.map(e=>e.id);
}

/** Replace a face-connected H8 cavity. The full discrete boundary, not just its envelope, is locked. */
export function patchTransitionMeshKeyword(hostText: string, candidateText: string, replaceElementIds: readonly number[]|"auto") {
  const host = readTransitionPatchDeck(hostText,true), candidate=readTransitionPatchDeck(candidateText,false);
  const all = [...host.solids.values()], hostFaces=indexFaces(all);
  const candidateBoundary = inspectFaces([...candidate.solids.values()],true);
  const hostByPoint=pointIndex(host.nodes);
  const selectedIds=replaceElementIds==="auto"
    ?discoverSelection(all,hostFaces,candidateBoundary,candidate.nodes,hostByPoint)
    :replaceElementIds;
  const selection=new Set(selectedIds);
  if (!selection.size || selection.size!==selectedIds.length
      || selection.size>=host.solids.size || [...selection].some(n=>!host.solids.has(n)))
    throw new Error("select distinct existing element IDs forming a proper subset");
  if ([...selection].some(e=>host.solidSet.has(e)))
    throw new Error("a replaced element belongs to a solid set; explicit set migration is required");
  const removed=all.filter(e=>selection.has(e.id));
  const kept = all.filter(e=>!selection.has(e.id));
  const part=removed[0]!.part;
  if (removed.some(e=>e.part!==part) || new Set([...candidate.solids.values()].map(e=>e.part)).size!==1)
    throw new Error("only single-part replacement is supported");
  const oldBoundary = inspectFaces(removed,true);
  const fullBoundary = boundaryOf(hostFaces);
  const boundaryIds=new Set([...oldBoundary.values()].flat());
  if (![...oldBoundary.keys()].some(k=>!fullBoundary.has(k)))
    throw new Error("patch has no shared face with the retained mesh");
  const candidateBoundaryIds=new Set([...candidateBoundary.values()].flat());
  const keptNodes=new Set(kept.flatMap(e=>e.nodes));
  const removedNodes=new Set(removed.flatMap(e=>e.nodes));
  const map = new Map<number,number>(), extra = new Map<number,Point>(), seen = new Set<string>();
  let nextNode=maxId(host.nodes),nextElement=maxId(host.solids);
  const candidateNodes=new Set([...candidate.solids.values()].flatMap(e=>e.nodes));
  for (const n of candidateNodes) {
    const p=candidate.nodes.get(n)!, key=pointKey(p), pool=hostByPoint.get(key)??[];
    if (seen.has(key)) throw new Error("candidate has coincident distinct nodes");
    seen.add(key);
    if (candidateBoundaryIds.has(n)) {
      if (pool.length!==1 || !boundaryIds.has(pool[0]!))
        throw new Error("candidate boundary node does not exactly identify one cavity node");
      map.set(n,pool[0]!);
    } else if (pool.length) {
      const old=pool[0]!;
      if (pool.length!==1 || boundaryIds.has(old) || keptNodes.has(old) || !removedNodes.has(old))
        throw new Error("interior candidate node would connect to unselected or ambiguous geometry");
      map.set(n,old);
    } else {
      extra.set(++nextNode,p); map.set(n,nextNode);
    }
  }
  const installed = [...candidate.solids.values()].map(e=>({
    id:++nextElement,part,nodes:e.nodes.map(n=>map.get(n)!),line:-1,
  }));
  sameBoundary(oldBoundary,inspectFaces(installed,true),"replacement");
  const finalCells=[...kept,...installed];
  const finalNodes=new Map([...host.nodes,...extra]);
  const active=new Set(finalCells.flatMap(e=>e.nodes));
  if ([...host.nodeSet].some(n=>removedNodes.has(n)&&!active.has(n)))
    throw new Error("a node-set member would be orphaned by the replacement");
  const oldMesh=compactMesh(host.nodes,removed), newMesh=compactMesh(finalNodes,installed);
  const removedVolume=volume(oldMesh);
  auditSolidTransitionReadback(oldMesh,removedVolume);
  auditSolidTransitionReadback(newMesh,removedVolume);
  sameBoundary(fullBoundary,inspectFaces(finalCells),"whole mesh");
  const skip=new Set(removed.map(e=>e.line));
  const generated=[
    ...(extra.size ? ["*NODE",...[...extra].map(([n,p])=>
      fixedInteger(n,8,"node ID")+p.map(x=>fixedFloat(x,16,8,"compact")).join(""))] : []),
    "*ELEMENT_SOLID",...installed.map(e=>[e.id,e.part,...e.nodes].map(n=>fixedInteger(n,8,"solid field")).join("")),
  ];
  const keyword=[...host.lines.slice(0,host.end).filter((_,i)=>!skip.has(i)),...generated,...host.lines.slice(host.end)].join(host.eol);
  const back=readTransitionPatchDeck(keyword,true);
  const backInstalled=installed.map(e=>back.solids.get(e.id)!);
  sameBoundary(fullBoundary,inspectFaces([...back.solids.values()]),"export readback");
  const backMesh=compactMesh(back.nodes,[...back.solids.values()]);
  if (!checkNoHangingNodes(backMesh,minElementEdgeLength(backMesh)*1e-8).ok)
    throw new Error("export readback contains hanging nodes");
  const quality = auditSolidTransitionReadback(compactMesh(back.nodes,backInstalled),removedVolume);
  return {keyword,report:{selectionMode:replaceElementIds==="auto"?"boundary":"manual",
    removedElementIds:[...selection],newElementIds:installed.map(e=>e.id),
    preservedElements:kept.length,preservedNodeRecords:host.nodes.size,newNodes:extra.size,
    sharedFaces:[...oldBoundary.keys()].filter(k=>!fullBoundary.has(k)).length,
    lockedBoundaryFaces:oldBoundary.size,partId:part,removedVolume,...quality}};
}

function maxId(records: ReadonlyMap<number,unknown>) {
  let max=0;
  for (const i of records.keys()) max=Math.max(i,max);
  return max;
}
