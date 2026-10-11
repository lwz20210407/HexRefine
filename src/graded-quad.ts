import type {Mesh} from "./types.js";
import type {ModelFraction,TransitionReduction} from "./graded-rectangle-plan.js";
import {generateRectangularGradedMesh} from "./graded-rectangle.js";
import {checkNoHangingNodes} from "./conformance.js";
import {H1_FACES} from "./topology.js";
import {minElementEdgeLength} from "./mesh.js";

export interface RectangularQuadSpec {
  /** Original 2D GUI lengths: positive-side extents, before symmetry copies. */
  positiveSize: readonly [number,number];
  fineRegionSize: readonly [number,number];
  coarseCounts: readonly [number,number];
  reductions: {x:TransitionReduction;y:TransitionReduction};
  modelFraction: ModelFraction;
}

export function generateRectangularGradedQuadMesh(spec:RectangularQuadSpec) {
  const allowed=new Set(["positiveSize","fineRegionSize","coarseCounts","reductions","modelFraction"]);
  if(Object.keys(spec).some(k=>!allowed.has(k)))throw new RangeError("unsupported rectangular-quad option");
  if(!Array.isArray(spec.positiveSize) || spec.positiveSize.length!==2
    || !Array.isArray(spec.fineRegionSize) || spec.fineRegionSize.length!==2
    || !Array.isArray(spec.coarseCounts) || spec.coarseCounts.length!==2)throw new RangeError("quad sizes and coarseCounts require two components");
  if([...spec.positiveSize,...spec.fineRegionSize].some(v=>!Number.isFinite(v)||v<=0))throw new RangeError("quad dimensions must be positive");
  if(spec.coarseCounts.some(n=>!Number.isSafeInteger(n)||n<1))throw new RangeError("quad coarse counts must be positive integers");
  const ratios=[spec.reductions?.x,spec.reductions?.y];
  if(ratios.some(n=>n!==2&&n!==3))throw new RangeError("quad reductions must be 2 or 3");
  if(Object.keys(spec.reductions).some(k=>k!=="x"&&k!=="y"))throw new RangeError("quad reductions have only X and Y components");
  if(!["quarter","half","full"].includes(spec.modelFraction))throw new RangeError("invalid quad modelFraction");
  const spacing=spec.positiveSize.map((v,a)=>v/spec.coarseCounts[a]!);
  const coarseCore=spec.fineRegionSize.map((v,a)=>{
    const value=v/spacing[a]!,floor=Math.floor(value);
    let count=value-floor<=.5 ? floor:floor+1;
    if(ratios[a]===2 && count%2!==0)count++;
    if(count<1 || spec.coarseCounts[a]!-count<2)throw new RangeError("aligned quad core must leave at least two outer coarse intervals");
    return count;
  });
  const designCore=coarseCore.map((n,a)=>n*ratios[a]!);
  const designSize=designCore.map((n,a)=>n+spec.coarseCounts[a]!-coarseCore[a]!);
  // A unit-height construction reuses the conforming XY engine; only Q1 faces leave this API.
  const volume=generateRectangularGradedMesh({fullSize:[2*designSize[0]!,2*designSize[1]!,1],
    refinedSize:[2*designCore[0]!,2*designCore[1]!],fineSize:1,coarseSize:1,
    reductions:{x:ratios[0]!,y:ratios[1]!,z:3},thicknessTransition:false,
    transitionStages:1,modelFraction:spec.modelFraction});
  const project=(source:Mesh):Mesh=>{
    const nodes:number[][]=[],ids=new Map<number,number>();
    const elements=source.elements.map(e=>{
      const faces=H1_FACES.map(f=>f.map(n=>e[n-1]!)).filter(f=>f.every(n=>source.nodes[n-1]![2]===0));
      if(faces.length!==1)throw new Error("quad extrusion did not have exactly one bottom face");
      const face=faces[0]!.map(n=>{
        let id=ids.get(n);
        if(id===undefined){
          const p=source.nodes[n-1]!;
          const xy=[0,1].map(a=>{
            const coordinate=Math.abs(p[a]!);
            const value=coordinate<=designCore[a]! ? coordinate/ratios[a]!*spacing[a]!
              : (coarseCore[a]!+coordinate-designCore[a]!)*spacing[a]!;
            return Math.sign(p[a]!)*value;
          });
          id=nodes.length+1;ids.set(n,id);nodes.push([xy[0]!,xy[1]!,0]);
        }
        return id;
      });
      return signedArea(face.map(n=>nodes[n-1]!))<0 ? [face[0]!,face[3]!,face[2]!,face[1]!]:face;
    });
    return {kind:"Q1",nodes,elements};
  };
  const mesh=project(volume.mesh),baseMesh=project(volume.baseMesh);
  const tolerance=minElementEdgeLength(mesh)*1e-8;
  if(!checkNoHangingNodes(mesh,tolerance).ok)throw new Error("quad mesh is not conforming");
  const bounds=[[spec.modelFraction==="quarter"?0:-spec.positiveSize[0],spec.positiveSize[0]],
    [spec.modelFraction==="full"?-spec.positiveSize[1]:0,spec.positiveSize[1]]];
  const expected=(bounds[0]![1]!-bounds[0]![0]!)*(bounds[1]![1]!-bounds[1]![0]!);
  const quality=auditPlanarQuadMesh(mesh,expected,ns=>bounds.some((levels,a)=>levels.some(v=>ns.every(n=>Math.abs(mesh.nodes[n-1]![a]!-v)<tolerance))));
  return {mesh,baseMesh,parentElementIds:volume.parentElementIds,coreParentIds:volume.coreParentIds,
    plan:{coarseCoreCounts:coarseCore,fineCounts:designCore,fineRegionSize:coarseCore.map((n,a)=>n*spacing[a]!),
      coarseSpacing:spacing,fineSpacing:spacing.map((v,a)=>v/ratios[a]!),bounds,
      rounding:"nearest coarse interval, ties downward; half-ratio core counts rounded upward to even"},quality};
}

function signedArea(v:readonly (readonly number[])[]):number {
  const origin=v[0]!;
  return v.reduce((sum,p,i)=>sum+(p[0]!-origin[0]!)*(v[(i+1)%4]![1]!-origin[1]!)
    -(p[1]!-origin[1]!)*(v[(i+1)%4]![0]!-origin[0]!),0)/2;
}

/** Internal audit shared by the generated planar domains. */
export function auditPlanarQuadMesh(mesh:Mesh,expected:number,isBoundaryEdge:(nodes:number[])=>boolean) {
  let area=0,minSJ=Infinity,minGauss=Infinity;
  const edges=new Map<string,{nodes:number[];count:number}>(),cells=new Set<string>();
  const signs=[[-1,-1],[1,-1],[1,1],[-1,1]];
  for(const e of mesh.elements){
    const key=[...e].sort((a,b)=>a-b).join(":");
    if(e.length!==4 || new Set(e).size!==4 || cells.has(key))throw new Error("invalid or repeated quadrilateral");cells.add(key);
    const v=e.map(n=>mesh.nodes[n-1]!);area+=signedArea(v);
    for(let i=0;i<4;i++){
      const p=v[i]!,next=v[(i+1)%4]!,previous=v[(i+3)%4]!;
      const a=[next[0]!-p[0]!,next[1]!-p[1]!],b=[previous[0]!-p[0]!,previous[1]!-p[1]!];
      minSJ=Math.min(minSJ,(a[0]!*b[1]!-a[1]!*b[0]!)/(Math.hypot(...a)*Math.hypot(...b)));
      const ns=[e[i]!,e[(i+1)%4]!],edgeKey=[...ns].sort((a,b)=>a-b).join(":");
      const record=edges.get(edgeKey)??{nodes:ns,count:0};record.count++;edges.set(edgeKey,record);
    }
    for(const u of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const w of [-1/Math.sqrt(3),1/Math.sqrt(3)]){
      const du=[0,0],dv=[0,0];
      for(let i=0;i<4;i++)for(let a=0;a<2;a++){
        du[a]!+=(v[i]![a]!-v[0]![a]!)*signs[i]![0]!*(1+signs[i]![1]!*w)/4;
        dv[a]!+=(v[i]![a]!-v[0]![a]!)*signs[i]![1]!*(1+signs[i]![0]!*u)/4;
      }
      minGauss=Math.min(minGauss,du[0]!*dv[1]!-du[1]!*dv[0]!);
    }
  }
  let boundaryEdges=0;
  for(const edge of edges.values()){
    if(edge.count>2)throw new Error("nonmanifold quad edge");
    if(edge.count!==1)continue;
    if(!isBoundaryEdge(edge.nodes))throw new Error("unexpected internal quad boundary");
    boundaryEdges++;
  }
  const relativeAreaError=Math.abs(area-expected)/expected;
  if(!(minSJ>0 && minGauss>0 && relativeAreaError<1e-8))throw new Error("quad quality audit failed");
  return {area,relativeAreaError,minimumCornerScaledJacobian:minSJ,minimumGaussDeterminant:minGauss,boundaryEdges};
}
