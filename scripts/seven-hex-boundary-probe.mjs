import { twoWay7ReferenceTemplates, properCubeRotations, rotateTwoWay7Template, instantiateTwoWay7Template } from '../dist/two-to-one-templates.js';
import { auditHexRefinementQuality } from '../dist/hex-quality.js';

const FACES = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[1,2,6,5],[0,4,7,3]];
const AXES = [[2,-1],[2,1],[1,-1],[1,1],[0,1],[0,-1]];
const key = ids => [...ids].sort((a,b)=>a-b).join(':');
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);

function flux(points, origin) {
  let result=0;
  const signs=[[-1,-1],[1,-1],[1,1],[-1,1]];
  for (const u of [-1/Math.sqrt(3),1/Math.sqrt(3)]) for (const v of [-1/Math.sqrt(3),1/Math.sqrt(3)]) {
    const p=[0,0,0],du=[0,0,0],dv=[0,0,0];
    points.forEach((q,i)=>{
      const [su,sv]=signs[i];
      for(let a=0;a<3;a++){
        const x=q[a]-origin[a];
        p[a]+=x*(1+su*u)*(1+sv*v)/4;
        du[a]+=x*su*(1+sv*v)/4;dv[a]+=x*sv*(1+su*u)/4;
      }
    });
    result+=dot(p,cross(du,dv))/3;
  }
  return result;
}

function projectedResidual(points, target) {
  let u=.5,v=.5;
  const evaluate=()=>{
    const weights=[(1-u)*(1-v),u*(1-v),u*v,(1-u)*v];
    return [0,1,2].map(a=>points.reduce((s,p,i)=>s+p[a]*weights[i],0));
  };
  for(let iteration=0;iteration<25;iteration++){
    const p=evaluate(),r=p.map((x,a)=>x-target[a]);
    const du=[0,1,2].map(a=>(points[1][a]-points[0][a])*(1-v)+(points[2][a]-points[3][a])*v);
    const dv=[0,1,2].map(a=>(points[3][a]-points[0][a])*(1-u)+(points[2][a]-points[1][a])*u);
    const aa=dot(du,du),ab=dot(du,dv),bb=dot(dv,dv),det=aa*bb-ab*ab;
    if(det<=0)return Infinity;
    const ra=dot(du,r),rb=dot(dv,r),nu=Math.max(0,Math.min(1,u-(bb*ra-ab*rb)/det)),nv=Math.max(0,Math.min(1,v-(aa*rb-ab*ra)/det));
    const delta=Math.hypot(nu-u,nv-v);u=nu;v=nv;if(delta<1e-12)break;
  }
  return Math.hypot(...evaluate().map((x,a)=>x-target[a]));
}

export function probeSevenHexBoundary(mesh, plan, originalIds) {
  const incidence=new Map();
  mesh.elements.forEach((e,i)=>FACES.forEach(f=>{
    const k=key(f.map(c=>e[c])), owners=incidence.get(k)??[];
    owners.push(i+1);incidence.set(k,owners);
  }));
  const templates=twoWay7ReferenceTemplates(), rotations=properCubeRotations();
  const rows=[];
  for(const r of plan.replacements){
    if(r.templateCode!==7)continue;
    const [,name,rotation]=r.refinement.source.match(/^(two_way7_[a-h])_r(\d+)$/);
    const reference=rotateTwoWay7Template(templates.find(t=>t.name===name),rotations[Number(rotation)]);
    const childIncidence=new Map();
    reference.elements.forEach(e=>FACES.forEach(f=>{
      const face=f.map(c=>e[c]),k=key(face),owners=childIncidence.get(k)??[];
      owners.push(face);childIncidence.set(k,owners);
    }));
    const parent=mesh.elements[r.elementId-1],vertices=parent.map(n=>mesh.nodes[n-1]),origin=vertices[0];
    for(let f=0;f<6;f++){
      const [axis,side]=AXES[f];
      const faces=[...childIncidence.values()].filter(v=>v.length===1).map(v=>v[0]).filter(face=>face.every(n=>reference.nodes[n][axis]===side));
      const before=flux(FACES[f].map(c=>vertices[c]),origin);
      const after=faces.reduce((s,face)=>s+flux(face.map(n=>r.refinement.nodes[n]),origin),0);
      const exterior=incidence.get(key(FACES[f].map(c=>parent[c]))).length===1;
      if(Math.abs(after-before)<1e-16)continue;
      const crossAxes=[0,1,2].filter(a=>a!==axis);
      const internalNodes=[...new Set(faces.flat())].filter(n=>crossAxes.every(a=>Math.abs(reference.nodes[n][a])<1-1e-12));
      rows.push({parent:originalIds[r.elementId-1],face:f,exterior,before,after,delta:after-before,internalNodes,
        childFaces:faces,reference,vertices,origin,refinement:r.refinement,crossAxes});
    }
  }
  const summary={freeDelta:rows.filter(r=>r.exterior).reduce((s,r)=>s+r.delta,0),internalDelta:rows.filter(r=>!r.exterior).reduce((s,r)=>s+r.delta,0),
    freeFaces:rows.filter(r=>r.exterior).length,freeFacesWithoutInteriorNode:rows.filter(r=>r.exterior&&!r.internalNodes.length).length};
  let maximumSampleDeviation=0,maximumProjectedResidual=0;
  for(const row of rows.filter(r=>r.exterior))for(const face of row.childFaces){
    for(const u of [0,.2113248654051871,.5,.7886751345948129,1])for(const v of [0,.2113248654051871,.5,.7886751345948129,1]){
      const weights=[(1-u)*(1-v),u*(1-v),u*v,(1-u)*v];
      const q=[0,1,2].map(a=>face.reduce((sum,n,i)=>sum+row.reference.nodes[n][a]*weights[i],0));
      const expected=instantiateTwoWay7Template(row.vertices,{name:'sample',nodes:[q],elements:[]}).nodes[0];
      const actual=[0,1,2].map(a=>face.reduce((sum,n,i)=>sum+row.refinement.nodes[n][a]*weights[i],0));
      maximumSampleDeviation=Math.max(maximumSampleDeviation,Math.hypot(...actual.map((x,a)=>x-expected[a])));
      maximumProjectedResidual=Math.max(maximumProjectedResidual,projectedResidual(FACES[row.face].map(c=>row.vertices[c]),actual));
    }
  }
  summary.maximumCorrespondingSurfaceSampleDeviation=maximumSampleDeviation;
  summary.maximumProjectedSurfaceSampleResidual=maximumProjectedResidual;
  summary.deviationScope='5x5 samples per child quad on volume-affected free faces. Corresponding-parameter difference includes reparameterization; projected residual uses clamped Gauss-Newton on the original bilinear face. Neither is a global Hausdorff bound.';
  const worst=rows.filter(r=>r.exterior).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta))[0];
  if(!worst)return summary;
  const trials=[];
  for(const node of worst.internalNodes)for(const u of [-.8,-.4,0,.4,.8])for(const v of [-.8,-.4,0,.4,.8]){
    const nodes=worst.reference.nodes.map(p=>[...p]);nodes[node][worst.crossAxes[0]]=u;nodes[node][worst.crossAxes[1]]=v;
    const candidate=instantiateTwoWay7Template(worst.vertices,{...worst.reference,nodes});
    const after=worst.childFaces.reduce((s,f)=>s+flux(f.map(n=>candidate.nodes[n]),worst.origin),0);
    const sj=auditHexRefinementQuality(worst.vertices,candidate).childMinimumOrientedScaledJacobian;
    if(sj>0)trials.push({node,u,v,delta:after-worst.before,sj});
  }
  return {...summary,worst:{parent:worst.parent,face:worst.face,delta:worst.delta,internalNodes:worst.internalNodes.map(n=>({node:n,reference:worst.reference.nodes[n]}))},trials};
}
