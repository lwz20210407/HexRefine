import assert from 'node:assert/strict';
import test from 'node:test';
import {gui61CornerFourHexTemplate} from '../dist/gui61-repair-templates.js';
import {generateGui61Repair,parseNativeLsdynaMixedKeyword,repairGui61Interfaces,repairGui61FiveHexInterfaces,H1_FACES,minimumHexCornerScaledJacobian,auditHexRefinementQuality,checkNoHangingNodes} from '../dist/index.js';

const cube=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const flip=e=>[e[1],e[0],e[3],e[2],e[5],e[4],e[7],e[6]];
function fixture(a,b,axes){
  const template=gui61CornerFourHexTemplate(cube,a,b),nodes=cube.map(p=>[...p]),elements=[[1,2,3,4,5,6,7,8]];
  const add=p=>{let i=nodes.findIndex(q=>q.every((v,k)=>v===p[k]));if(i<0){nodes.push(p);i=nodes.length-1;}return i+1;};
  for(const axis of axes)for(const e of template.elements)for(const face of H1_FACES){
    const points=face.map(i=>template.nodes[e[i-1]-1]);if(!points.every(p=>p[axis]===0))continue;
    const child=[...points.map(add),...points.map(p=>add(p.map((v,i)=>v-(i===axis?.5:0))))];
    elements.push(minimumHexCornerScaledJacobian(child.map(n=>nodes[n-1]))>0?child:flip(child));
  }
  return {kind:'H1',nodes,elements};
}
const options={parentElementIds:[1],tolerance:1e-9};

for(const a of [1/3,1/2,2/3])for(const b of [1/3,1/2,2/3])test(`corner-four template and one/two/three-wall repairs: ${a}, ${b}`,()=>{
  const template=gui61CornerFourHexTemplate(cube,a,b);
  assert.equal(template.nodes.length,15);assert.equal(template.elements.length,4);
  assert.ok(auditHexRefinementQuality(cube,template).ok);
  for(const axes of [[2],[2,0],[2,0,1]]){
    const mesh=fixture(a,b,axes),before=structuredClone(mesh);
    const r=repairGui61Interfaces(mesh,options);
    assert.deepEqual(mesh,before);assert.deepEqual(r.mesh.nodes.slice(0,mesh.nodes.length),mesh.nodes);
    assert.equal(r.mesh.elements.length,mesh.elements.length+3);
    assert.equal(r.repairs[0].childElementCount,4);assert.ok(checkNoHangingNodes(r.mesh,1e-9).ok);
    assert.deepEqual(r.mesh.elements.slice(4),mesh.elements.slice(1));
    assert.throws(()=>repairGui61FiveHexInterfaces(mesh,options));
  }
});

test('corner repair rotates, mirrors and maps affine geometry without physical offset assumptions',()=>{
  for(const a of [0,1,2])for(const b of [0,1,2].filter(i=>i!==a))for(let mask=0;mask<8;mask++){
    const mesh=fixture(1/3,2/3,[2,0,1]);
    mesh.nodes=mesh.nodes.map(p=>{
      const q=[a,b,3-a-b].map((j,i)=>((mask>>i)&1?-1:1)*p[j]);
      return [2*q[0]+.2*q[2]+10,3*q[1]+.1*q[0]-5,.7*q[2]+2];
    });
    mesh.elements=mesh.elements.map(e=>minimumHexCornerScaledJacobian(e.map(n=>mesh.nodes[n-1]))>0?e:flip(e));
    const r=repairGui61Interfaces(mesh,options);assert.equal(r.mesh.elements.length,13);
    assert.ok(r.quality.maximumParentVolumeError<1e-12);
  }
});

test('corner template refuses unverified cut fractions',()=>{
  assert.throws(()=>gui61CornerFourHexTemplate(cube,.2,.5),/fractions/);
  assert.throws(()=>gui61CornerFourHexTemplate(cube,NaN,.5),/fractions/);
});

test('shared repair adapter preserves PIDs and replays its canonical browser request',()=>{
  const mesh=fixture(1/3,.5,[2,0]);
  const request={schemaVersion:1,mesh,repair:{...options,partIds:mesh.elements.map(()=>7)}};
  const before=structuredClone(request),r=generateGui61Repair(request);
  assert.deepEqual(request,before);assert.equal(r.request.kind,'interface-repair');
  const back=parseNativeLsdynaMixedKeyword(r.files['mesh.k']);assert.ok(back.solids.every(e=>e.partId===7));
  assert.equal(r.summary.solids,mesh.elements.length+3);assert.equal(r.summary.beams,0);
  assert.deepEqual(generateGui61Repair(r.request).mesh,r.mesh);
  const report=JSON.parse(r.files['report.json']);assert.equal(report.repairs[0].childElementCount,4);
  assert.throws(()=>generateGui61Repair({...request,solverSettings:{}}),/metadata/);
  assert.throws(()=>generateGui61Repair({...request,repair:{...request.repair,mergeParts:true}}),/metadata/);
  assert.throws(()=>generateGui61Repair({...request,kind:'circular-solid'}),/metadata/);
});
