import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHexUnitCubeMesh,refineExtrudedOgrid,H1_FACES,hexElementSignedVolume,minimumHexCornerScaledJacobian} from '../dist/index.js';
import {hexJacobian} from '../dist/hex-quality-internal.js';

const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
function area(q){const value=[0,0,0];q.forEach((p,i)=>cross(sub(p,q[0]),sub(q[(i+1)%4],q[0])).forEach((v,a)=>value[a]+=v/2));return Math.hypot(...value);}
function contains(q,points){const normal=cross(sub(q[1],q[0]),sub(q[3],q[0])),length=Math.hypot(...normal),n=normal.map(v=>v/length);
  return points.every(p=>Math.abs(dot(sub(p,q[0]),n))<1e-11&&q.every((a,i)=>dot(cross(sub(q[(i+1)%4],a),sub(p,a)),n)>-1e-11));}
function extract(source,result,parentIds,label){
  const selected=new Set(parentIds),indices=result.completedParentIds.flatMap((p,i)=>selected.has(p)?[i]:[]),ids=[...new Set(indices.flatMap(i=>result.mesh.elements[i]))],local=new Map(ids.map((n,i)=>[n,i]));
  const nodes=ids.map(n=>result.mesh.nodes[n-1]),hexes=indices.map(i=>result.mesh.elements[i].map(n=>local.get(n)));
  const expected=new Map();for(const parentId of parentIds)for(let face=0;face<6;face++){
    const f=H1_FACES[face].map(n=>source.elements[parentId-1][n-1]),key=[...f].sort((a,b)=>a-b).join(':');
    if(expected.has(key))expected.delete(key);else expected.set(key,{parentId,face,vertices:f.map(n=>source.nodes[n-1]),quads:[],coveredArea:0});
  }
  const faces=new Map();hexes.forEach((e,owner)=>{for(const f of H1_FACES){const face=f.map(n=>e[n-1]),key=[...face].sort((a,b)=>a-b).join(':');if(faces.has(key))faces.delete(key);else faces.set(key,{face,owner});}});
  for(const {face,owner} of faces.values()){
    const parentId=result.completedParentIds[indices[owner]],q=face.map(n=>nodes[n]);
    const matches=[...expected.values()].filter(e=>e.parentId===parentId&&contains(e.vertices,q));
    assert.equal(matches.length,1,`${label}: boundary face not on the original macro exterior`);matches[0].quads.push(face);matches[0].coveredArea+=area(q);
  }
  for(const e of expected.values())assert.ok(Math.abs(e.coveredArea-area(e.vertices))/area(e.vertices)<1e-12);
  const originalVolume=parentIds.reduce((s,p)=>s+hexElementSignedVolume(source.elements[p-1].map(n=>source.nodes[n-1])),0);
  const childVolume=hexes.reduce((s,e)=>s+hexElementSignedVolume(e.map(n=>nodes[n])),0);
  assert.ok(Math.abs(childVolume-originalVolume)/originalVolume<1e-12);
  let minSJ=Infinity,minGauss=Infinity;for(const e of hexes){const p=e.map(n=>nodes[n]);minSJ=Math.min(minSJ,minimumHexCornerScaledJacobian(p));for(const x of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const y of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const z of [-1/Math.sqrt(3),1/Math.sqrt(3)]){const j=hexJacobian(p,x,y,z);minGauss=Math.min(minGauss,dot(j[0],cross(j[1],j[2])));}}
  assert.ok(minSJ>0&&minGauss>0);
  const edges=new Map();for(const {face} of faces.values())face.forEach((a,i)=>{const key=[a,face[(i+1)%4]].sort((a,b)=>a-b).join(':');edges.set(key,(edges.get(key)??0)+1);});
  assert.ok([...edges.values()].every(c=>c===2));const euler=new Set([...faces.values()].flatMap(e=>e.face)).size-edges.size+faces.size;assert.equal(euler,2);
  return {schemaVersion:1,label,indexBase:0,source:'Native complete two-level hierarchical field; not TrueGrid nine-Hex sampling',
    coordinateSystem:'Generated model world coordinates; see parents for complete original H8 vertices.',
    qualityWarning:minSJ<.15?'Topology reference only: minimum corner SJ below0.15, not engineering accepted.':null,
    limitation:'Complete reference example, not an unconditional local-installer template. Shared-wall field compatibility must be solved.',
    selectedExponent:result.report.macroFinalization.selectedExponent,nodes,hexes,childParentIds:indices.map(i=>parentIds.indexOf(result.completedParentIds[i])),
    parents:parentIds.map(p=>source.elements[p-1].map(n=>source.nodes[n-1])),boundaryPartitions:[...expected.values()],
    certificate:{hexes:hexes.length,nodes:nodes.length,parents:parentIds.length,sourceVolume:originalVolume,childVolume,minimumCornerSJ:minSJ,minimumGaussDeterminant:minGauss,boundaryEuler:euler,completeSourceBoundaryAreas:true}};
}
async function main(){
  const [destination,...extra]=process.argv.slice(2);if(!destination||extra.length)throw Error('Usage: node scripts/generate-hierarchical-macro-references.mjs NEW_DIRECTORY');
  const options={axis:2,bands:[{min:3,max:5,level:2}],completion:'none',transitionGeometry:'conservative-face-flux',balanceMode:'direct-macro',maxPromotedSourceLayers:0};
  const cube=createHexUnitCubeMesh(2,2,8);cube.nodes=cube.nodes.map(([x,y,z])=>[x*2,y*2,z*8]);
  const one=extract(cube,refineExtrudedOgrid(cube,options),[9],'complete31-parent');assert.equal(one.hexes.length,31);
  const points=[[0,0],[.5,.5],[0,.5],[-.5,.5],[-.5,0],[-.5,-.5],[0,-.5],[.5,-.5],[.5,0]];
  for(let i=0;i<8;i++){const t=Math.PI*(.25+.25*i);points.push([Math.cos(t),Math.sin(t)]);}
  const quads=[[0,8,1,2],[0,2,3,4],[0,4,5,6],[0,6,7,8],...Array.from({length:8},(_,s)=>[1+(s+1)%8,1+s,9+s,9+(s+1)%8])],nodes=[],elements=[];
  for(let k=0;k<=8;k++)for(const p of points)nodes.push([...p,k]);
  for(let k=0;k<8;k++)for(const q of quads)elements.push([...q.map(n=>1+n+k*points.length),...q.map(n=>1+n+(k+1)*points.length)]);
  const ogrid={kind:'H1',nodes,elements},star=extract(ogrid,refineExtrudedOgrid(ogrid,options),[25,29,36],'complete93-trivalent-star');assert.equal(star.hexes.length,93);
  const out=path.resolve(destination);await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out);
  for(const model of [one,star])await fs.writeFile(path.join(out,`${model.label}.json`),JSON.stringify(model,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify([one.certificate,star.certificate]));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
