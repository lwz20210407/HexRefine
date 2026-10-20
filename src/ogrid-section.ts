import type {Mesh,Point} from "./types.js";
import {H1_FACES} from "./topology.js";

export type SectionQuad=readonly [number,number,number,number];
export interface ExtrudedSection {
  axis:0|1|2;axes:readonly [number,number];planes:number[];points:Point[];quads:SectionQuad[];
  nodeIds:number[][];parentIds:number[][];tolerance:number;
}
export interface SectionEdge {vertices:[number,number];owners:Array<{cell:number;side:number}>;}
export function sectionEdges(quads:readonly SectionQuad[]):SectionEdge[]{
  const edges=new Map<string,SectionEdge>();
  quads.forEach((q,cell)=>q.forEach((a,side)=>{const b=q[(side+1)%4]!,vertices:[number,number]=a<b?[a,b]:[b,a],key=vertices.join(':');
    const entry=edges.get(key)??{vertices,owners:[]};entry.owners.push({cell,side});if(entry.owners.length>2)throw new RangeError('nonmanifold O-grid section edge');edges.set(key,entry);}));
  return [...edges.values()];
}

/** Constant-section straight extrusions only; no physical-axis guess on a tapered solid. */
export function extractExtrudedSection(mesh:Mesh,axis:0|1|2):ExtrudedSection{
  if(mesh.kind!=="H1"||!mesh.elements.length||![0,1,2].includes(axis))throw new RangeError('O-grid requires an H1 extrusion and an axis');
  const axes:readonly [number,number]=axis===0?[1,2]:axis===1?[2,0]:[0,1];
  if(mesh.nodes.some(p=>p.length!==3||p.some(v=>!Number.isFinite(v))))throw new RangeError('invalid extrusion coordinates');
  const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];for(const p of mesh.nodes)for(let a=0;a<3;a++){low[a]=Math.min(low[a]!,p[a]!);high[a]=Math.max(high[a]!,p[a]!);}
  const ranges=high.map((v,a)=>v-low[a]!);
  const scale=Math.max(...ranges),tolerance=scale*1e-8;if(!(scale>0))throw new RangeError('degenerate extrusion');
  const sorted=[...mesh.nodes.map(p=>p[axis]!)].sort((a,b)=>a-b),planes:number[]=[];
  for(const value of sorted)if(!planes.length||value-planes.at(-1)!>tolerance)planes.push(value);
  if(planes.length<4)throw new RangeError('extrusion needs at least three parent layers');
  const planeIndex=(z:number)=>{let lo=0,hi=planes.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(planes[mid]!<z-tolerance)lo=mid+1;else hi=mid;}if(Math.abs(planes[lo]!-z)>tolerance)throw new RangeError('inconsistent extrusion plane');return lo;};
  const parent=mesh.nodes.map((_,i)=>i),find=(v:number):number=>{while(parent[v]!==v){parent[v]=parent[parent[v]!]!;v=parent[v]!;}return v;};
  const localEdges=[[[0,1],[3,2],[4,5],[7,6]],[[0,3],[1,2],[4,7],[5,6]],[[0,4],[1,5],[2,6],[3,7]]];
  for(const e of mesh.elements){
    if(e.length!==8||new Set(e).size!==8||e.some(n=>!Number.isSafeInteger(n)||n<1||n>mesh.nodes.length))throw new RangeError('invalid extrusion connectivity');
    const alignment=localEdges.map(edges=>edges.reduce((s,[a,b])=>s+Math.abs(mesh.nodes[e[b!]!-1]![axis]!-mesh.nodes[e[a!]!-1]![axis]!),0));
    const order=[0,1,2].sort((a,b)=>alignment[b]!-alignment[a]!);if(alignment[order[0]!]!<=alignment[order[1]!]!+tolerance)throw new RangeError('no unique parent extrusion direction');
    for(const [a,b] of localEdges[order[0]!]!){const first=find(e[a!]!-1),second=find(e[b!]!-1);if(first!==second)parent[Math.max(first,second)]=Math.min(first,second);}
  }
  const roots=[...new Set(parent.map((_,i)=>find(i)))].sort((a,b)=>a-b),rootIndex=new Map(roots.map((v,i)=>[v,i]));
  const nodeIds:number[][]=roots.map(()=>Array(planes.length).fill(0)),vertexByNode:number[]=[];
  mesh.nodes.forEach((p,i)=>{const vertex=rootIndex.get(find(i))!,plane=planeIndex(p[axis]!);if(nodeIds[vertex]![plane])throw new RangeError('duplicate node in one topological extrusion column');nodeIds[vertex]![plane]=i+1;vertexByNode[i]=vertex;});
  if(nodeIds.some(row=>row.some(n=>!n)))throw new RangeError('not a complete extrusion (missing column planes)');
  const points:Point[]=nodeIds.map(row=>axes.map(a=>mesh.nodes[row[Math.floor(row.length/2)]!-1]![a]!));
  const quads:SectionQuad[]=[],parentIds:number[][]=[],columns=new Map<string,number>();
  mesh.elements.forEach((e,i)=>{
    if(e.length!==8||new Set(e).size!==8||e.some(n=>!Number.isSafeInteger(n)||n<1||n>mesh.nodes.length))throw new RangeError('invalid extruded Hex connectivity');
    const z=e.map(n=>planeIndex(mesh.nodes[n-1]![axis]!)),lo=Math.min(...z),hi=Math.max(...z);
    if(hi!==lo+1)throw new RangeError('a parent spans incompatible axial layers');
    const face=H1_FACES.find(f=>f.every(n=>z[n-1]===lo));if(!face)throw new RangeError('no complete source section face');
    let q=face.map(n=>vertexByNode[e[n-1]!-1]!) as [number,number,number,number];
    const area=q.reduce((s,n,j)=>{const p=points[n]!,r=points[q[(j+1)%4]!]!;return s+p[0]!*r[1]!-p[1]!*r[0]!;},0);
    if(area<0)q=[q[0],q[3],q[2],q[1]];
    const key=[...q].sort((a,b)=>a-b).join(':');let column=columns.get(key);
    if(column===undefined){column=quads.length;columns.set(key,column);quads.push(q);parentIds.push(Array(planes.length-1).fill(0));}
    if(parentIds[column]![lo])throw new RangeError('duplicate source extrusion parent');parentIds[column]![lo]=i+1;
  });
  if(parentIds.some(row=>row.some(n=>!n)))throw new RangeError('incomplete extrusion column');
  sectionEdges(quads);return {axis,axes,planes,points,quads,nodeIds,parentIds,tolerance};
}

/** Finite GF(2) sheet completion. A witness is verified again, never assumed optimal. */
export function planSectionParity(quads:readonly SectionQuad[]){
  if(quads.length>4096)throw new RangeError('parity section exceeds the4096-column dense budget');
  const edges=sectionEdges(quads),boundary=new Set(edges.filter(e=>e.owners.length===1).flatMap(e=>e.vertices));
  const stars=new Map<number,Set<number>>();quads.forEach((q,c)=>q.forEach(v=>{const s=stars.get(v)??new Set<number>();s.add(c);stars.set(v,s);}));
  const graph=Array.from({length:quads.length*2},()=>new Set<number>());
  for(const e of edges)if(e.owners.length===2){const [a,b]=e.owners;graph[2*a!.cell+a!.side%2]!.add(2*b!.cell+b!.side%2);graph[2*b!.cell+b!.side%2]!.add(2*a!.cell+a!.side%2);}
  const boundarySegments=new Set(edges.filter(e=>e.owners.length===1).map(e=>e.owners[0]!.cell*4+e.owners[0]!.side));
  const visited=new Set<number>(),chords:Array<{segments:number[];ends:number[];closed:boolean}>=[];
  for(let seed=0;seed<graph.length;seed++)if(!visited.has(seed)){
    const stack=[seed],segments:number[]=[];while(stack.length){const s=stack.pop()!;if(visited.has(s))continue;visited.add(s);segments.push(s);stack.push(...graph[s]!);}
    const ends=segments.filter(s=>{const cell=s>>1,p=s%2;return [p,p+2].some(side=>boundarySegments.has(cell*4+side));});
    chords.push({segments,ends,closed:ends.length===0});
  }
  const oddOpen=chords.filter(c=>!c.closed&&c.segments.length%2).length;
  if(chords.some(c=>c.closed&&c.segments.length%2))throw new RangeError('open parity sheets cannot repair an odd closed chord');
  if(!oddOpen)return {labels:quads.map(()=>0),cutEdges:[] as SectionEdge[],oddOpenChords:0,searchCandidates:0};
  const rows:Array<{mask:bigint;rhs:number}>=[],add=(ids:readonly number[],rhs:number)=>rows.push({mask:ids.reduce((m,id)=>m^(1n<<BigInt(id)),0n),rhs});
  for(const [v,cells] of stars)if(!boundary.has(v)){const ids=[...cells];if(ids.length===4)add(ids,0);else for(const id of ids.slice(1))add([ids[0]!,id],0);}
  for(const c of chords)if(!c.closed){if(c.ends.length!==2)throw new RangeError('unsupported open chord endpoint structure');add(c.ends.map(s=>s>>1),c.segments.length%2);}
  add([0],0);
  const basis=new Map<number,{mask:bigint;rhs:number}>();
  for(const source of rows){let {mask,rhs}=source;for(let bit=0;bit<quads.length&&mask;bit++)if(mask&(1n<<BigInt(bit))){const pivot=basis.get(bit);if(pivot){mask^=pivot.mask;rhs^=pivot.rhs;}else{basis.set(bit,{mask,rhs});mask=0n;rhs=0;break;}}if(!mask&&rhs)throw new RangeError('no parity-sheet field satisfies the section constraints');}
  const pivots=[...basis.keys()].sort((a,b)=>b-a),solve=(free:bigint)=>{let x=free;for(const bit of pivots){const row=basis.get(bit)!;let mask=row.mask&x,parity=0;while(mask){mask&=mask-1n;parity^=1;}if(parity!==row.rhs)x^=1n<<BigInt(bit);}return x;};
  const origin=solve(0n),nulls=quads.flatMap((_,i)=>basis.has(i)?[]:[solve(1n<<BigInt(i))^origin]);
  if(nulls.length>128)throw new RangeError('parity null-space exceeds bounded optimization budget');
  const labels=(x:bigint)=>quads.map((_,i)=>Number((x>>BigInt(i))&1n));
  const assess=(x:bigint)=>{
    const values=labels(x),cut=edges.filter(e=>e.owners.length===2&&values[e.owners[0]!.cell]!==values[e.owners[1]!.cell]);
    const degree=new Map<number,number>();cut.forEach(e=>e.vertices.forEach(v=>degree.set(v,(degree.get(v)??0)+1)));
    let invalid=0;for(const [v,d] of degree)if(d!==(boundary.has(v)?1:2))invalid++;
    const adjacency=new Map<number,number[]>();for(const e of cut)for(const [a,b] of [e.vertices,[e.vertices[1],e.vertices[0]]]){const list=adjacency.get(a!)??[];list.push(b!);adjacency.set(a!,list);}
    const seen=new Set<number>();for(const seed of adjacency.keys())if(!seen.has(seed)){const stack=[seed];let ends=0;while(stack.length){const v=stack.pop()!;if(seen.has(v))continue;seen.add(v);if(boundary.has(v))ends++;stack.push(...adjacency.get(v)!);}if(ends!==2)invalid++;}
    return {score:invalid*100000+cut.length,values,cut,invalid};
  };
  let best=origin,bestState=assess(best),evaluated=1,seed=123456789;
  for(let start=0;start<12;start++){
    let x=start?origin:best;if(start)for(const n of nulls){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;if(seed&1)x^=n;}
    let state=assess(x);for(let pass=0;pass<32;pass++){let changed=false;
      for(const n of nulls){const next=assess(x^n);evaluated++;if(next.score<state.score){x^=n;state=next;changed=true;}}
      if(!changed)break;
    }
    if(state.score<bestState.score){best=x;bestState=state;}
    if(!bestState.invalid&&bestState.cut.length<=Math.max(1,oddOpen))break;
  }
  if(bestState.invalid)throw new RangeError('bounded parity witness branches or terminates internally');
  for(const row of rows){let mask=row.mask&best,p=0;while(mask){mask&=mask-1n;p^=1;}if(p!==row.rhs)throw new Error('parity witness verification failed');}
  return {labels:bestState.values,cutEdges:bestState.cut,oddOpenChords:oddOpen,searchCandidates:evaluated};
}
