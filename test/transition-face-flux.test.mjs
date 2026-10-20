import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {twoWay7ReferenceTemplates,properCubeRotations,rotateTwoWay7Template,instantiateTwoWay7Template} from '../dist/two-to-one-templates.js';
import {auditHexRefinementQuality} from '../dist/hex-quality.js';
import {conserveTransitionFaceFlux,quadVolumeFlux} from '../dist/transition-face-flux.js';
import {replaceElements} from '../dist/mesh.js';
import {checkNoHangingNodes} from '../dist/conformance.js';

const unit=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const warped=unit.map(([u,v,w])=>[u+.02*v*w,v+.03*u*w,w+.04*u*v+.01*u*v*w]);
function plan(vertices,template){return {strategy:'seven-hex',replacements:[{elementId:1,role:'face-transition',templateCode:7,referenceNodes:template.nodes,refinement:instantiateTwoWay7Template(vertices,template)}]};}

test('all192 oriented/reflected seven-Hex frames conserve a warped parent without relaxing tolerance',()=>{
  const mesh={kind:'H1',nodes:warped,elements:[[1,2,3,4,5,6,7,8]]};
  for(const rotation of properCubeRotations())for(const base of twoWay7ReferenceTemplates()){
    const template=rotateTwoWay7Template(base,rotation),source=plan(warped,template),before=structuredClone(source);
    const result=conserveTransitionFaceFlux(mesh,source,.05),ref=result.replacements[0].refinement;
    const q=auditHexRefinementQuality(warped,ref,1e-12);
    assert.ok(q.ok,JSON.stringify(q));assert.ok(result.report.correctedFaces>0);
    assert.ok(result.report.maximumNormalizedFluxResidual<1e-12);assert.deepEqual(source,before);
    template.nodes.forEach((p,i)=>{
      // Parent edges and both coarse/fine interface planes must remain fixed.
      if(p.filter(v=>Math.abs(v)===1).length>=2)assert.deepEqual(ref.nodes[i],source.replacements[0].refinement.nodes[i]);
      const fineAxis=rotation.findIndex(row=>row[2]!==0),fineSide=rotation[fineAxis][2];
      if(p[fineAxis]===fineSide)assert.deepEqual(ref.nodes[i],source.replacements[0].refinement.nodes[i]);
    });
  }
});

test('planar/affine Hexes remain unchanged and excessive face corrections are refused',()=>{
  const template=twoWay7ReferenceTemplates()[0],mesh={kind:'H1',nodes:unit,elements:[[1,2,3,4,5,6,7,8]]},p=plan(unit,template);
  const result=conserveTransitionFaceFlux(mesh,p);
  assert.equal(result.report.correctedFaces,0);assert.deepEqual(result.replacements,p.replacements);
  assert.throws(()=>conserveTransitionFaceFlux({...mesh,nodes:warped},plan(warped,template),1e-10),/displacement budget/);
  assert.throws(()=>conserveTransitionFaceFlux(mesh,{strategy:'local-sweep',replacements:[]}),/restricted/);
});

test('bilinear face flux is translation invariant when using the same local origin',()=>{
  const q=[[0,0,0],[2,0,0],[2,3,.2],[0,3,0]],shift=[51,-27,93];
  const translated=q.map(p=>p.map((v,i)=>v+shift[i]));
  assert.ok(Math.abs(quadVolumeFlux(q,q[0])-quadVolumeFlux(translated,translated[0]))<1e-13);
  assert.ok(Math.abs(quadVolumeFlux(q,q[0])+quadVolumeFlux([q[0],q[3],q[2],q[1]],q[0]))<1e-14);
});

test('adjacent mirrored warped parents share the identical corrected face',()=>{
  const nodes=[];for(let k=0;k<=1;k++)for(let j=0;j<=1;j++)for(let i=0;i<=2;i++)nodes.push([i+.02*j*k,j+.03*i*k,k+.04*i*j+.01*i*j*k]);
  const elements=[[1,2,5,4,7,8,11,10],[2,3,6,5,8,9,12,11]],mesh={kind:'H1',nodes,elements};
  const replacements=elements.map((e,i)=>({...plan(e.map(n=>nodes[n-1]),twoWay7ReferenceTemplates()[i]).replacements[0],elementId:i+1}));
  const result=conserveTransitionFaceFlux(mesh,{strategy:'seven-hex',replacements},.05);
  result.replacements.forEach((r,i)=>assert.ok(auditHexRefinementQuality(elements[i].map(n=>nodes[n-1]),r.refinement,1e-12).ok));
  const assembled=replaceElements(mesh,result.replacements,1e-9);
  assert.ok(checkNoHangingNodes(assembled,1e-8).ok);
  assert.deepEqual(assembled.nodes.slice(0,nodes.length),nodes);
});

test('actual TC4 warped support parent fails unchanged1e-8 gate before correction and passes after',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/lsdyna/tc4-warped-transition-parent.json',import.meta.url),'utf8'));
  const [,label,rotation]=fixture.template.match(/^two_way7_([a-h])_r(\d+)$/);
  const base=twoWay7ReferenceTemplates()[label.charCodeAt(0)-97],template=rotateTwoWay7Template(base,properCubeRotations()[Number(rotation)]);
  const original=plan(fixture.vertices,template),before=auditHexRefinementQuality(fixture.vertices,original.replacements[0].refinement);
  assert.equal(before.ok,false);assert.ok(before.relativeVolumeError>1e-5);
  const corrected=conserveTransitionFaceFlux({kind:'H1',nodes:fixture.vertices,elements:[[1,2,3,4,5,6,7,8]]},original);
  const after=auditHexRefinementQuality(fixture.vertices,corrected.replacements[0].refinement);
  assert.ok(after.ok);assert.ok(after.relativeVolumeError<1e-12);
  assert.ok(corrected.report.maximumDisplacementFraction<=.001);
});
