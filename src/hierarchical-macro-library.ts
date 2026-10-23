import type {Mesh} from "./types.js";
import {buildFullSectionTwoToOneHexPlan} from "./two-to-one.js";
import {assembleReferenceStage,type ReferenceSupport} from "./hierarchical-shell.js";
import type {ReferencePoint3,TwoWay7ReferenceTemplate} from "./two-to-one-templates.js";

const CORNERS:readonly ReferencePoint3[]=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const cache=new Map<string,readonly TwoWay7ReferenceTemplate[]>();

/** Compile complete parent shells from trusted seven-Hex fields, not incomplete harvested cells. */
export function compileHierarchicalShellReferences(depth:1|2|3):readonly TwoWay7ReferenceTemplate[]{
  return compileGradedShellReferences(depth,0);
}

export function hierarchicalShellCount(fine:number,coarse:number){return 8**coarse+4**coarse*(2*4**(fine-coarse)-2);}

/** Tensor coarse face and finer tensor face; complete original-parent coverage at both ends. */
export function compileGradedShellReferences(depth:1|2|3,coarseDepth:0|1|2):readonly TwoWay7ReferenceTemplate[]{
  if(![1,2,3].includes(depth)||!Number.isInteger(coarseDepth)||coarseDepth<0||coarseDepth>=depth)throw new RangeError("unsupported hierarchical shell depths");
  const key=`${depth}:${coarseDepth}`,cached=cache.get(key);if(cached)return cached;
  const source:Mesh={kind:"H1",nodes:[],elements:[]};
  const node=(i:number,j:number,k:number)=>1+i+3*j+9*k;
  for(let k=0;k<=9;k++)for(let j=0;j<=2;j++)for(let i=0;i<=2;i++)source.nodes.push([i,j,k]);
  for(let k=0;k<9;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++)source.elements.push([
    node(i,j,k),node(i+1,j,k),node(i+1,j+1,k),node(i,j+1,k),node(i,j,k+1),node(i+1,j,k+1),node(i+1,j+1,k+1),node(i,j+1,k+1)]);
  let mesh=source,parents=source.elements.map((_,i)=>i+1),uniform=parents.map(()=>true);
  let supports:ReferenceSupport[]=source.nodes.map((_,i)=>new Map([[i+1,1]]));
  for(let level=1;level<=depth;level++){
    const selected=parents.flatMap((p,i)=>{
      const distance=Math.abs(Math.floor((p-1)/4)-4),target=distance===0?depth:Math.max(0,coarseDepth-distance+1);
      return target>=level&&uniform[i]?[i+1]:[];
    });
    const plan=buildFullSectionTwoToOneHexPlan(mesh,selected),changed=new Map(plan.replacements.map(r=>[r.elementId,r]));
    const output=assembleReferenceStage(mesh,plan.replacements,supports,1e-10);
    const nextParents:number[]=[],nextUniform:boolean[]=[];
    mesh.elements.forEach((_,i)=>{if(!changed.has(i+1)){nextParents.push(parents[i]!);nextUniform.push(uniform[i]!);}});
    for(const r of plan.replacements)for(const _ of r.refinement.elements){nextParents.push(parents[r.elementId-1]!);nextUniform.push(uniform[r.elementId-1]!&&r.role==="selected");}
    mesh=output.mesh;supports=output.supports;parents=nextParents;uniform=nextUniform;
  }
  const templates:TwoWay7ReferenceTemplate[]=[];
  for(let parent=13;parent<=16;parent++){
    const childIds=parents.flatMap((p,i)=>p===parent?[i]:[]),ids=[...new Set(childIds.flatMap(i=>[...mesh.elements[i]!]))];
    if(childIds.length!==hierarchicalShellCount(depth,coarseDepth))throw new Error("compiled shell does not cover a complete source parent");
    const local=new Map(ids.map((n,i)=>[n,i])),corners=source.elements[parent-1]!;
    const nodes=ids.map(n=>{
      const p=[0,0,0];for(const [id,w] of supports[n-1]!){if(!w)continue;const c=corners.indexOf(id);
        if(c<0)throw new Error("compiled shell support leaves its original parent");
        for(let a=0;a<3;a++)p[a]!+=w*CORNERS[c]![a]!;
      }
      if(p.some(v=>!Number.isInteger(v*2**(6*depth))))throw new Error("compiled reference is not dyadic");
      return p as unknown as ReferencePoint3;
    });
    templates.push({name:`hierarchical${childIds.length}_${parent}`,nodes,elements:childIds.map(i=>mesh.elements[i]!.map(n=>local.get(n)!))});
  }
  for(const t of templates){for(const p of t.nodes)Object.freeze(p);for(const e of t.elements)Object.freeze(e);Object.freeze(t.nodes);Object.freeze(t.elements);Object.freeze(t);}
  Object.freeze(templates);cache.set(key,templates);return templates;
}
