import {generateAxialTransitionTube} from "./transition-axial-tube.js";
import {readTransitionPatchDeck,patchTransitionMeshKeyword} from "./transitionmesh-keyword-patch.js";
import {meshToLsdynaKeyword} from "./export.js";
import {H1_FACES} from "./topology.js";
import type {Point} from "./types.js";

type Deck = ReturnType<typeof readTransitionPatchDeck>;
type Section = {level:number; count:number; anchor:Point};
const key=(ids:readonly number[])=>[...ids].sort((a,b)=>a-b).join(":");
const tau=2*Math.PI;
const unit=(i:number)=>[0,1,2].map(j=>i===j?1:0) as [number,number,number];

function faceCounts(cells:readonly (readonly number[])[]) {
  const faces=new Map<string,{nodes:number[]; owners:number}>();
  for (const cell of cells) for (const face of H1_FACES) {
    const nodes=face.map(n=>cell[n-1]!);
    const k=key(nodes), prior=faces.get(k);
    if (prior) {
      if (++prior.owners>2) throw new Error("host contains a nonmanifold face");
    } else faces.set(k,{nodes,owners:1});
  }
  return faces;
}

function boundaryNodes(cells:readonly (readonly number[])[]) {
  return new Set([...faceCounts(cells).values()].filter(f=>f.owners===1).flatMap(f=>f.nodes));
}

function minEdge(deck:Deck) {
  let value=Infinity;
  for (const solid of deck.solids.values()) for (const f of H1_FACES)
    for (let i=0;i<4;i++) {
      const a=deck.nodes.get(solid.nodes[f[i]!-1]!)!;
      const b=deck.nodes.get(solid.nodes[f[(i+1)%4]!-1]!)!;
      value=Math.min(value,Math.hypot(...a.map((x,j)=>x-b[j]!)));
    }
  if (!(value>0&&Number.isFinite(value))) throw new Error("invalid host edge length");
  return value;
}

function capCenter(faces:readonly number[][], nodes:Deck["nodes"], axes:readonly number[]) {
  const edges=new Map<string,{a:number;b:number;n:number}>();
  for (const f of faces) for (let i=0;i<4;i++) {
    const a=f[i]!,b=f[(i+1)%4]!,k=key([a,b]),p=edges.get(k);
    if (p) p.n++; else edges.set(k,{a,b,n:1});
  }
  const adjacent=new Map<number,number[]>();
  for (const {a,b,n} of edges.values()) if (n===1) {
    adjacent.set(a,[...(adjacent.get(a)??[]),b]);
    adjacent.set(b,[...(adjacent.get(b)??[]),a]);
  }
  const seen=new Set<number>();
  let loops=0;
  for (const [n, neighbors] of adjacent) {
    if (neighbors.length!==2) throw new Error("cap boundary not a closed ring");
    if (seen.has(n)) continue;
    loops++;
    const queue=[n]; seen.add(n);
    for (let i=0;i<queue.length;i++) for (const m of adjacent.get(queue[i]!)??[]) {
      if (!seen.has(m)) {seen.add(m); queue.push(m);}
    }
  }
  if (loops!==2) throw new Error(`cap has ${loops} boundary loops; a hollow tube requires 2`);
  return axes.map(a=>[...adjacent.keys()].reduce((v,n)=>v+nodes.get(n)![a]!/adjacent.size,0));
}

function inspectAxis(deck:Deck, faces:ReturnType<typeof faceCounts>, axial:number,tol:number) {
  const a=(axial+1)%3,b=(axial+2)%3;
  const table = new Map<number,number[][]>();
  let lo=Infinity,hi=-Infinity;
  const active = new Set([...deck.solids.values()].flatMap(e=>e.nodes));
  for (const i of active) {
    const z=deck.nodes.get(i)![axial]!;
    lo=Math.min(lo,z); hi=Math.max(hi,z);
  }
  if (hi-lo<=tol) throw new Error("zero axial span");
  // Do not group nearby planes. An axis-aligned source is expected to have
  // identical axial coordinates on each logical ring.
  for (const {nodes} of faces.values()) {
    const z=deck.nodes.get(nodes[0]!)![axial]!;
    if (!nodes.every(n=>deck.nodes.get(n)![axial]===z)) continue;
    const list=table.get(z)??[]; list.push(nodes); table.set(z,list);
  }
  const low=table.get(lo), high=table.get(hi);
  if (!low||!high) throw new Error("missing planar end sections");
  const [ca,cb]=capCenter(low,deck.nodes,[a,b]) as [number,number];
  const [ea,eb]=capCenter(high,deck.nodes,[a,b]) as [number,number];
  if (Math.hypot(ca-ea,cb-eb)>tol) throw new Error("cap centers differ");
  const polar=(p:Point)=>[Math.hypot(p[a]!-ca,p[b]!-cb),Math.atan2(p[b]!-cb,p[a]!-ca)] as const;
  const points=[...new Set(low.flat())].map(n=>deck.nodes.get(n)!);
  const radii=points.map(p=>polar(p)[0]).sort((x,y)=>x-y).filter((r,i,rr)=>i===0||r-rr[i-1]!>tol);
  const ri=radii[0]!,ro=radii.at(-1)!,walls=radii.length-1;
  if (!(ri>tol&&walls>=1)) throw new Error("missing nonzero inner wall");
  if (radii.some((r,i)=>Math.abs(r-(ri+(ro-ri)*i/walls))>tol))
    throw new Error("radial divisions are not uniform");

  function section(level:number, quads:number[][]):Section|undefined {
    if (quads.length%walls) return;
    const n=quads.length/walls;
    const nodes=[...new Set(quads.flat())];
    if (n<4||nodes.length!==n*(walls+1)) return;
    const rim=nodes.filter(id=>Math.abs(polar(deck.nodes.get(id)!)[0]-ro)<=tol);
    if (rim.length!==n) return;
    const anchor=deck.nodes.get(rim[0]!)!;
    const phase=polar(anchor)[1], logical=new Map<number,[number,number]>(), seen=new Set<string>();
    for (const id of nodes) {
      const [r,angle]=polar(deck.nodes.get(id)!);
      const layer=Math.round((r-ri)*walls/(ro-ri));
      const t=(angle-phase)*n/tau, index=Math.round(t);
      const j=(index%n+n)%n,k=`${layer}:${j}`;
      if (layer<0||layer>walls||Math.abs(r-radii[layer]!)>tol
          ||Math.abs(t-index)*tau*r/n>tol||seen.has(k)) return;
      seen.add(k); logical.set(id,[layer,j]);
    }
    const strips=new Set<string>();
    for (const q of quads) {
      const ij=q.map(id=>logical.get(id)!);
      const rs=[...new Set(ij.map(v=>v[0]))].sort((x,y)=>x-y), js=[...new Set(ij.map(v=>v[1]))];
      if (rs.length!==2||rs[1]!==rs[0]!+1||js.length!==2) return;
      const start=(js[0]!+1)%n===js[1]?js[0]:(js[1]!+1)%n===js[0]?js[1]:undefined;
      if (start===undefined||strips.has(`${rs[0]}:${start}`)) return;
      strips.add(`${rs[0]}:${start}`);
    }
    return {level,count:n,anchor};
  }

  const stations=[...table].map(([z,q])=>section(z,q)).filter((s):s is Section=>s!==undefined)
    .sort((x,y)=>x.level-y.level);
  if (stations.length<4||stations[0]!.level!==lo||stations.at(-1)!.level!==hi)
    throw new Error("no complete four-or-more section family");
  if (stations[0]!.count===stations.at(-1)!.count)
    throw new Error("end ring counts are equal; no unique fine-to-coarse band");
  if (stations[0]!.count<stations.at(-1)!.count) stations.reverse();
  let first=0,last=stations.length-1;
  while (first<last&&stations[first+1]!.count===stations[0]!.count) first++;
  while (last>first&&stations[last-1]!.count===stations.at(-1)!.count) last--;
  if (first===0||last===stations.length-1)
    throw new Error("requires regular fine and coarse regions outside the band");
  const selected=stations.slice(first,last+1);
  const ratios:(2|3)[]=[], widths:number[]=[];
  for (let i=1;i<selected.length;i++) {
    const f=selected[i-1]!,c=selected[i]!,r=f.count/c.count;
    if (r!==2&&r!==3) throw new Error("non-monotonic or unsupported stage count ratio");
    ratios.push(r); widths.push(Math.abs(f.level-c.level));
  }
  if (!ratios.length) throw new Error("no 2:1 or 3:1 section transitions");
  const start=selected[0]!.level, end=selected.at(-1)!.level, direction=Math.sign(end-start);
  const origin=[0,0,0] as [number,number,number];
  origin[a]=ca; origin[b]=cb; origin[axial]=start;
  const axis=unit(axial).map(t=>t*direction) as [number,number,number];
  const anchor=selected.at(-1)!.anchor;
  // Same frame convention as generateAxialTransitionTube.
  const ref=axial===0?1:0, tan=3-axial-ref;
  const sign=(axial+1)%3===ref?direction:-direction;
  const phase=Math.atan2(sign*(anchor[tan]!-origin[tan]!),anchor[ref]!-origin[ref]!)*180/Math.PI;
  return {axial,origin,axis,start,end,ri,ro,walls,phase,ratios,widths,stations:selected};
}

function pointMatcher(oldPoints:Point[],ref:Point,tol:number) {
  const index=new Map<string,Point[]>();
  const voxel=(p:Point)=>p.map((v,i)=>Math.floor((v-ref[i]!)/tol));
  for (const p of oldPoints) {
    const k=voxel(p).join(":"), bucket=index.get(k)??[]; bucket.push(p); index.set(k,bucket);
  }
  return (p:Point)=>{
    const [x,y,z]=voxel(p) as [number,number,number];
    const matches: {p:Point;d:number}[]=[];
    for (const i of [-1,0,1])for(const j of [-1,0,1])for(const k of [-1,0,1])
      for (const q of index.get(`${x+i}:${y+j}:${z+k}`)??[]) {
        const d=Math.hypot(...p.map((t,a)=>t-q[a]!));
        if (d<=tol) matches.push({p:q,d});
      }
    return matches;
  };
}

function lockSourceNodes(nodes:Point[],cells:readonly (readonly number[])[],oldBoundary:Point[],interior:Point[],tol:number) {
  const boundary=boundaryNodes(cells);
  if (boundary.size!==oldBoundary.length) throw new Error("candidate changes the number of locked boundary nodes");
  const matchBoundary=pointMatcher(oldBoundary,oldBoundary[0]!,tol);
  const matchInterior=pointMatcher(interior,oldBoundary[0]!,tol);
  const used=new Set<Point>();
  let maxBoundaryCorrection=0, interiorNodesReused=0;
  for (const [i,p] of nodes.entries()) {
    const outer=boundary.has(i+1), matches=(outer?matchBoundary:matchInterior)(p);
    if (!outer&&!matches.length) continue;
    if (matches.length!==1||used.has(matches[0]!.p))
      throw new Error("candidate boundary cannot be paired bijectively within existing coordinate precision");
    used.add(matches[0]!.p);
    if (outer) maxBoundaryCorrection=Math.max(maxBoundaryCorrection,matches[0]!.d);
    else interiorNodesReused++;
    nodes[i]=matches[0]!.p;
  }
  return {maxBoundaryCorrection,interiorNodesReused};
}

/** Rebuild an existing band, never choose an engineering ROI in a uniform source mesh. */
export function inferAndPatchAxialTube(hostText:string) {
  const deck=readTransitionPatchDeck(hostText,true);
  const all=[...deck.solids.values()];
  const tol=minEdge(deck)*1e-8;
  const faces=faceCounts(all.map(e=>e.nodes));
  const interpretations:ReturnType<typeof inspectAxis>[] = [];
  const rejected:string[]=[];
  for (const dim of [0,1,2]) {
    try {interpretations.push(inspectAxis(deck,faces,dim,tol));}
    catch (error) {rejected.push(`${"XYZ"[dim]}: ${(error as Error).message}`);}
  }
  if (interpretations.length!==1)
    throw new Error(interpretations.length?"ambiguous axial direction":`no supported hollow-tube band (${rejected.join("; ")})`);
  const plan=interpretations[0]!;
  const lo=Math.min(plan.start,plan.end),hi=Math.max(plan.start,plan.end);
  const selected=all.filter(e=>{
    const zz=e.nodes.map(n=>deck.nodes.get(n)![plan.axial]!);
    const a=Math.min(...zz),b=Math.max(...zz);
    if (b<=lo||a>=hi) return false;
    if (a<lo||b>hi) throw new Error("an original H8 crosses a locked interface plane");
    return true;
  });
  if (!selected.length||selected.length===all.length) throw new Error("no bounded internal band to replace");
  const heldIds=boundaryNodes(selected.map(e=>e.nodes));
  const held=[...heldIds].map(n=>deck.nodes.get(n)!);
  const selectedIds=new Set(selected.map(e=>e.id));
  const outsideIds=new Set(all.filter(e=>!selectedIds.has(e.id)).flatMap(e=>e.nodes));
  const interior=[...new Set(selected.flatMap(e=>e.nodes))].filter(n=>!heldIds.has(n)&&!outsideIds.has(n))
    .map(n=>deck.nodes.get(n)!);
  const counts=plan.stations.map(s=>s.count);
  const failures:string[]=[];
  for (const phase of plan.ratios.at(-1)===2?[plan.phase,plan.phase+360/counts.at(-1)!]:[plan.phase]) {
    try {
      const geometry=generateAxialTransitionTube({innerRadius:plan.ri,outerRadius:plan.ro,
        length:hi-lo,radialLayers:plan.walls,fineSegments:counts[0]!,ratios:plan.ratios,
        stageDepths:plan.widths,axis:plan.axis,origin:plan.origin,startAngleDegrees:phase});
      const locked=lockSourceNodes(geometry.mesh.nodes,geometry.mesh.elements,held,interior,tol);
      const candidate=meshToLsdynaKeyword(geometry.mesh,{coordinateFormat:"compact"});
      const installed=patchTransitionMeshKeyword(hostText,candidate,selected.map(e=>e.id));
      return {...installed,report:{...installed.report,selectionMode:"inferred-axial" as const},
        candidate,inference:{axis:plan.axis,origin:plan.origin,counts,ratios:plan.ratios,
        axialLevels:plan.stations.map(s=>s.level),stageDepths:plan.widths,radialLayers:plan.walls,
        radii:[plan.ri,plan.ro],coordinateTolerance:tol,...locked,stageIds:geometry.stageIds}};
    } catch (error) {failures.push((error as Error).message);}
  }
  throw new Error(`inferred axial band rejected: ${failures.join("; ")}`);
}
