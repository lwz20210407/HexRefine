import type {Mesh,Point} from "./types.js";
import {minimumHexCornerScaledJacobian} from "./hex-quality.js";
import {sectionEdges,type ExtrudedSection,type SectionQuad} from "./ogrid-section.js";

function solve3(matrix:number[][],rhs:number[]){
  const a=matrix.map((row,i)=>[...row,rhs[i]!]);
  for(let c=0;c<3;c++){let pivot=c;for(let r=c+1;r<3;r++)if(Math.abs(a[r]![c]!)>Math.abs(a[pivot]![c]!))pivot=r;
    [a[c],a[pivot]]=[a[pivot]!,a[c]!];const d=a[c]![c]!;if(Math.abs(d)<1e-15)throw new RangeError('degenerate circular section fit');
    for(let j=c;j<4;j++)a[c]![j]!/=d;
    for(let r=0;r<3;r++)if(r!==c){const f=a[r]![c]!;for(let j=c;j<4;j++)a[r]![j]!-=f*a[c]![j]!;}
  }return a.map(row=>row[3]!);
}
function circleFit(points:readonly Point[],ids:readonly number[]){
  const origin=[0,0];for(const id of ids)for(let a=0;a<2;a++)origin[a]!+=points[id]![a]!/ids.length;
  let scale=0;for(const id of ids)scale=Math.max(scale,Math.hypot(points[id]![0]!-origin[0]!,points[id]![1]!-origin[1]!));
  if(!(scale>0))throw new RangeError('degenerate circular section');
  const m=Array.from({length:3},()=>[0,0,0]),b=[0,0,0];
  for(const id of ids){const x=(points[id]![0]!-origin[0]!)/scale,y=(points[id]![1]!-origin[1]!)/scale,row=[2*x,2*y,1],r=x*x+y*y;for(let i=0;i<3;i++){b[i]!+=row[i]!*r;for(let j=0;j<3;j++)m[i]![j]!+=row[i]!*row[j]!;}}
  const [nx,ny,c]=solve3(m,b),cx=origin[0]!+nx!*scale,cy=origin[1]!+ny!*scale,radius=Math.sqrt(c!+nx!*nx!+ny!*ny!)*scale;
  if(!(radius>0))throw new RangeError('invalid circle fit');
  const residual=Math.max(...ids.map(id=>Math.abs(Math.hypot(points[id]![0]!-cx!,points[id]![1]!-cy!)-radius)));
  if(residual>radius*1e-5)throw new RangeError('section boundary is not circular within the declared fitting contract');
  return {center:[cx!,cy!] as [number,number],radius,residual};
}
function harmonic(points:readonly Point[],quads:readonly SectionQuad[],boundary:Map<number,Point>,radius:number){
  const adjacency=points.map(()=>new Set<number>());for(const q of quads)q.forEach((a,i)=>{const b=q[(i+1)%4]!;adjacency[a]!.add(b);adjacency[b]!.add(a);});
  const interior=points.flatMap((_,i)=>boundary.has(i)?[]:[i]),index=new Map(interior.map((v,i)=>[v,i]));
  const diagonal=interior.map(v=>adjacency[v]!.size),neighbors=interior.map(v=>[...adjacency[v]!].filter(n=>index.has(n)).map(n=>index.get(n)!));
  const dot=(a:readonly number[],b:readonly number[])=>a.reduce((s,v,i)=>s+v*b[i]!,0);
  const multiply=(x:readonly number[])=>x.map((v,i)=>diagonal[i]!*v-neighbors[i]!.reduce((s,j)=>s+x[j]!,0));
  const output=points.map(p=>[...p]);for(const [v,p] of boundary)output[v]=[...p];let iterations=0;
  for(const axis of [0,1]){
    const rhs=interior.map(v=>[...adjacency[v]!].reduce((s,n)=>s+(boundary.get(n)?.[axis]??0),0));
    const x=interior.map(v=>points[v]![axis]!),mx=multiply(x),r=rhs.map((v,i)=>v-mx[i]!),z=r.map((v,i)=>v/diagonal[i]!),p=[...z];
    let rz=dot(r,z),converged=Math.sqrt(dot(r,r))<=radius*1e-11;
    for(let step=0;!converged&&step<Math.max(500,interior.length*8);step++){
      const ap=multiply(p),den=dot(p,ap);if(!(den>0))throw new RangeError('harmonic section solve lost positive definiteness');
      const alpha=rz/den;for(let i=0;i<x.length;i++){x[i]!+=alpha*p[i]!;r[i]!-=alpha*ap[i]!;}
      iterations++;converged=Math.sqrt(dot(r,r))<=radius*1e-11;if(converged)break;
      for(let i=0;i<z.length;i++)z[i]=r[i]!/diagonal[i]!;
      const next=dot(r,z),beta=next/rz;for(let i=0;i<p.length;i++)p[i]=z[i]!+beta*p[i]!;rz=next;
    }
    if(!converged)throw new RangeError('bounded harmonic redistribution did not converge');
    interior.forEach((v,i)=>{output[v]![axis]=x[i]!;});
  }return {points:output,iterations};
}

/** Insert topological sheets, then redistribute the whole circular section, not a thin sliver. */
export function completeCircularSection(mesh:Mesh,section:ExtrudedSection,labels:readonly number[],minimumEdgeFraction=.1){
  for(let v=0;v<section.nodeIds.length;v++)for(const id of section.nodeIds[v]!)if(section.axes.some((a,j)=>Math.abs(mesh.nodes[id-1]![a]!-section.points[v]![j]!)>section.tolerance))throw new RangeError('circular-sheet completion requires a constant straight section; taper and twist are not redistributed');
  const originalEdges=sectionEdges(section.quads),cut=originalEdges.filter(e=>e.owners.length===2&&labels[e.owners[0]!.cell]!==labels[e.owners[1]!.cell]);
  if(!cut.length)throw new RangeError('circular completion needs an actual parity sheet');
  const boundaryIds=[...new Set(originalEdges.filter(e=>e.owners.length===1).flatMap(e=>e.vertices))];
  const fit=circleFit(section.points,boundaryIds),duplicates=new Map<number,number>(),points=section.points.map(p=>[...p]);
  for(const v of [...new Set(cut.flatMap(e=>e.vertices))].sort((a,b)=>a-b))duplicates.set(v,points.push([...section.points[v]!])-1);
  const quads:SectionQuad[]=section.quads.map((q,i)=>q.map(v=>labels[i]?duplicates.get(v)??v:v) as [number,number,number,number]);
  const sourceColumns:number[][]=section.quads.map((_,i)=>[i]);
  for(const edge of cut){const selected=edge.owners.find(o=>labels[o.cell]===1)!;
    const q=section.quads[selected.cell]!,a=q[selected.side]!,b=q[(selected.side+1)%4]!;
    quads.push([a,b,duplicates.get(b)!,duplicates.get(a)!]);sourceColumns.push(edge.owners.map(o=>o.cell));
  }
  const free=sectionEdges(quads).filter(e=>e.owners.length===1),next=new Map<number,number>();
  for(const edge of free){const owner=edge.owners[0]!,q=quads[owner.cell]!,a=q[owner.side]!,b=q[(owner.side+1)%4]!;
    if(next.has(a))throw new RangeError('completed section has a branched free boundary');next.set(a,b);}
  const cycle:number[]=[],start=Math.min(...next.keys());let cursor=start;
  do{if(cycle.includes(cursor)||!next.has(cursor))throw new RangeError('invalid completed boundary cycle');cycle.push(cursor);cursor=next.get(cursor)!;}while(cursor!==start);
  if(cycle.length!==next.size)throw new RangeError('circular completion does not support holes or disconnected sections');
  const step=2*Math.PI/cycle.length,angles:number[]=[];
  for(const v of cycle){let angle=Math.atan2(points[v]![1]!-fit.center[1],points[v]![0]!-fit.center[0]);while(angles.length&&angle<angles.at(-1)!-1e-10)angle+=2*Math.PI;angles.push(angle);}
  const phase=angles.reduce((sum,a,i)=>sum+a-i*step,0)/angles.length;
  const boundary=new Map(cycle.map((v,i)=>[v,[fit.center[0]+fit.radius*Math.cos(phase+i*step),fit.center[1]+fit.radius*Math.sin(phase+i*step)]]));
  const redistributed=harmonic(points,quads,boundary,fit.radius),originalLengths=originalEdges.map(e=>Math.hypot(...section.points[e.vertices[0]]!.map((v,a)=>v-section.points[e.vertices[1]]![a]!))).sort((a,b)=>a-b);
  const referenceEdge=originalLengths[Math.floor(originalLengths.length/2)]!,lengths=sectionEdges(quads).map(e=>Math.hypot(...redistributed.points[e.vertices[0]]!.map((v,a)=>v-redistributed.points[e.vertices[1]]![a]!)));
  const minimumEdge=Math.min(...lengths);if(minimumEdge<referenceEdge*minimumEdgeFraction)throw new RangeError('redistribution leaves a forbidden narrow section edge');
  for(const q of quads)for(let i=0;i<4;i++){const p=redistributed.points[q[i]!]!,a=redistributed.points[q[(i+1)%4]!]!,b=redistributed.points[q[(i+3)%4]!]!;
    if(!((a[0]!-p[0]!)*(b[1]!-p[1]!)-(a[1]!-p[1]!)*(b[0]!-p[0]!)>0))throw new RangeError('redistribution produces a concave or inverted quad');}
  const nodes=mesh.nodes.map(p=>[...p]),nodeIds=section.nodeIds.map(row=>[...row]);
  for(let vertex=0;vertex<points.length;vertex++){
    if(vertex>=section.points.length)nodeIds.push(section.planes.map(z=>{const p=[0,0,0];p[section.axis]=z;p[section.axes[0]]=redistributed.points[vertex]![0]!;p[section.axes[1]]=redistributed.points[vertex]![1]!;return nodes.push(p);}));
    else for(const id of nodeIds[vertex]!){nodes[id-1]![section.axes[0]]=redistributed.points[vertex]![0]!;nodes[id-1]![section.axes[1]]=redistributed.points[vertex]![1]!;}
  }
  const elements=mesh.elements.map(e=>[...e]),parentIds=section.parentIds.map(row=>[...row]),sourceParents:number[][]=mesh.elements.map((_,i)=>[i+1]);
  for(let column=0;column<quads.length;column++){
    if(column>=section.quads.length)parentIds.push([]);
    for(let layer=0;layer<section.planes.length-1;layer++){
      const q=quads[column]!,element=[...q.map(v=>nodeIds[v]![layer]!),...q.map(v=>nodeIds[v]![layer+1]!)];
      if(column<section.quads.length)elements[parentIds[column]![layer]!-1]=element;
      else{parentIds[column]!.push(elements.push(element));sourceParents.push(sourceColumns[column]!.map(c=>section.parentIds[c]![layer]!));}
    }
  }
  let minSJ=Infinity;for(const e of elements)minSJ=Math.min(minSJ,minimumHexCornerScaledJacobian(e.map(n=>nodes[n-1]!)));
  if(!(minSJ>0))throw new RangeError('completed coarse extrusion has a nonpositive Jacobian');
  const displacement=Math.max(...section.points.map((p,i)=>Math.hypot(...p.map((v,a)=>v-redistributed.points[i]![a]!))));
  return {mesh:{kind:"H1" as const,nodes,elements},parentIds,sourceParents,section:{...section,points:redistributed.points,quads,nodeIds,parentIds},
    report:{addedSectionColumns:cut.length,boundaryNodes:cycle.length,circleCenter:fit.center,circleRadius:fit.radius,circleFitResidual:fit.residual,
      maximumSectionDisplacement:displacement,minimumSectionEdge:minimumEdge,referenceSectionEdge:referenceEdge,edgeFraction:minimumEdge/referenceEdge,
      harmonicIterations:redistributed.iterations,minimumCompletedCornerSJ:minSJ}};
}
