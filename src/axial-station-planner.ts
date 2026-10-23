import type {Point} from "./types.js";
import {H1_FACES} from "./topology.js";
import {instantiateTwoWay7Template,type TwoWay7ReferenceTemplate} from "./two-to-one-templates.js";

const corners=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const edges=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
export interface StationPatch {group:string;template:TwoWay7ReferenceTemplate;fineFace:number;vertices:readonly Point[];}
export interface AxialStationProposal {stations:number[];earliest:number[];latest:number[];constraints:number;feasible:boolean;fixedShortEdges:number;}

/** Finite monotone axial proposals, not a quality proof on a tapered/warped physical cell. */
export function proposeAxialStations(patches:readonly StationPatch[],axis:0|1|2,minimumEdge:number):Map<string,AxialStationProposal>{
  const groups=new Map<string,StationPatch[]>();for(const p of patches){const g=groups.get(p.group)??[];g.push(p);groups.set(p.group,g);}
  const result=new Map<string,AxialStationProposal>();
  for(const [group,entries] of groups){
    const data=entries.map(p=>{
      const face=H1_FACES[p.fineFace]!,localAxis=[0,1,2].find(a=>face.every(n=>corners[n-1]![a]===corners[face[0]!-1]![a]))!,side=corners[face[0]!-1]![localAxis]!;
      const stations=p.template.nodes.map(n=>(1-side*n[localAxis]!)/2),height=Math.max(...p.vertices.map(n=>n[axis]!))-Math.min(...p.vertices.map(n=>n[axis]!));
      return {patch:p,stations,height,physical:instantiateTwoWay7Template(p.vertices,p.template).nodes};
    });
    const stations=[...new Set(data.flatMap(p=>p.stations))].sort((a,b)=>a-b),index=new Map(stations.map((s,i)=>[s,i]));
    if(stations.length>256||stations[0]!==0||stations.at(-1)!==1)throw new RangeError("axial station family exceeds its bounded reference contract");
    const bounds=new Map<string,{i:number;j:number;distance:number}>();let fixedShortEdges=0;
    const add=(i:number,j:number,distance:number)=>{const key=`${i}:${j}`,old=bounds.get(key);if(!old||old.distance<distance)bounds.set(key,{i,j,distance});};
    for(let j=1;j<stations.length;j++)add(j-1,j,1e-6);
    for(const p of data)for(const e of p.patch.template.elements)for(const [a,b] of edges){
      const first=e[a!]!,second=e[b!]!,i=index.get(p.stations[first]!)!,j=index.get(p.stations[second]!)!;
      const transverse=[0,1,2].filter(a=>a!==axis).reduce((s,a)=>s+(p.physical[first]![a]!-p.physical[second]![a]!)**2,0);
      if(i===j){if(transverse<minimumEdge**2)fixedShortEdges++;continue;}
      add(Math.min(i,j),Math.max(i,j),Math.sqrt(Math.max(0,minimumEdge**2-transverse))/p.height);
    }
    const rows=[...bounds.values()],earliest=stations.map(()=>0),latest=stations.map(()=>1);
    for(let j=1;j<stations.length;j++)for(const row of rows)if(row.j===j)earliest[j]=Math.max(earliest[j]!,earliest[row.i]!+row.distance);
    const feasible=Number.isFinite(earliest.at(-1))&&earliest.at(-1)!<=1;
    if(feasible){
      earliest[earliest.length-1]=1;
      for(let i=stations.length-2;i>=0;i--)for(const row of rows)if(row.i===i)latest[i]=Math.min(latest[i]!,latest[row.j]!-row.distance);
      latest[0]=0;
    }
    result.set(group,{stations,earliest,latest,constraints:rows.length,feasible,fixedShortEdges});
  }
  return result;
}
