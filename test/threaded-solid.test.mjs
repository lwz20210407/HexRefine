import test from 'node:test';
import assert from 'node:assert/strict';
import {generateThreadedShaft,generateThreadedNut,helicalThreadRadius,H1_FACES,
  checkNoHangingNodes,meshToLsdynaKeyword,parseMeshText,generateMappedCircularCore} from '../dist/index.js';

const profile={rootRadius:4.2,majorRadius:5,pitch:1.5,handedness:'right'};
const shaft={profile,length:1.5,stepsPerTurn:16,coreRadius:3.6,radiusSegments:4,arcSegments:4,surfaceLayers:3};
const nut={profile,length:1.5,stepsPerTurn:16,acrossFlats:17,clearance:.1,angularSegments:24,radialLayers:3};
const close=(a,b,tol=1e-10)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);

function topology(r,type,spec){
  const mesh=r.mesh,faces=new Map(),boundaryEdges=new Map(),vertices=new Set();
  assert.equal(mesh.kind,'H1');assert.equal(mesh.elements.length,r.plan.expectedElementCount);
  assert.equal(mesh.nodes.length,r.plan.expectedNodeCount);
  assert.ok(mesh.nodes.every(p=>p.length===3&&p.every(Number.isFinite)));
  const uniqueCells=new Set();
  for(const e of mesh.elements){
    assert.equal(new Set(e).size,8);
    assert.ok(e.every(i=>Number.isSafeInteger(i)&&i>0&&i<=mesh.nodes.length));
    uniqueCells.add([...e].sort((a,b)=>a-b).join(':'));
    for(const face of H1_FACES){
      const ids=face.map(i=>e[i-1]),key=[...ids].sort((a,b)=>a-b).join(':');
      const old=faces.get(key);if(old){old.count++;assert.ok(old.count<=2);}else faces.set(key,{ids,count:1});
    }
  }
  assert.equal(uniqueCells.size,mesh.elements.length);
  let boundary=0;
  for(const {ids,count} of faces.values())if(count===1){
    boundary++;const p=ids.map(i=>mesh.nodes[i-1]);
    const flat=p.every(q=>Math.abs(q[2])<1e-10)||p.every(q=>Math.abs(q[2]-spec.length)<1e-10);
    const thread=p.every(q=>Math.abs(Math.hypot(q[0],q[1])-helicalThreadRadius(Math.atan2(q[1],q[0]),q[2],spec.profile)-(type==='nut'?spec.clearance:0))<1e-10);
    const hex=type==='nut'&&p.every(q=>{
      let t=Math.atan2(q[1],q[0]);if(t<0)t+=2*Math.PI;
      const a=(t+Math.PI/6)%(Math.PI/3)-Math.PI/6;
      return Math.abs(Math.hypot(q[0],q[1])-spec.acrossFlats/(2*Math.cos(a)))<1e-10;
    });
    assert.ok(flat||thread||hex,'unexplained internal free face');
    for(let i=0;i<4;i++){
      vertices.add(ids[i]);const edge=[ids[i],ids[(i+1)%4]].sort((a,b)=>a-b).join(':');
      boundaryEdges.set(edge,(boundaryEdges.get(edge)??0)+1);
    }
  }
  assert.ok([...boundaryEdges.values()].every(c=>c===2),'open or nonmanifold surface');
  assert.equal(vertices.size-boundaryEdges.size+boundary,type==='nut'?0:2);
  assert.ok(r.quality.minimumCornerScaledJacobian>=.15&&r.quality.minimumGaussDeterminant>0);
  assert.ok(r.quality.relativeVolumeError<1e-10);
  assert.equal(checkNoHangingNodes(mesh,1e-8).ok,true);
  for(const ids of Object.values(r.nodeSets)){
    assert.equal(ids.length,new Set(ids).size);assert.ok(ids.every(i=>i>0&&i<=mesh.nodes.length));
  }
  const roundTrip=parseMeshText(meshToLsdynaKeyword(mesh,{coordinateFormat:'compact'}),'thread.k');
  assert.deepEqual(roundTrip.elements,mesh.elements);
  for(let i=0;i<mesh.nodes.length;i++)for(let a=0;a<3;a++)close(roundTrip.nodes[i][a],mesh.nodes[i][a],1e-8);
}

test('thread equation has one pitch, both hands, explicit flats and bounded depth',()=>{
  close(helicalThreadRadius(0,0,profile),4.2);close(helicalThreadRadius(0,.75,profile),5);
  for(const handedness of ['left','right'])for(let i=-20;i<=20;i++){
    const p={...profile,handedness},t=.113*i,z=.071*i,r=helicalThreadRadius(t,z,p);
    assert.ok(r>=4.2&&r<=5);close(r,helicalThreadRadius(t,z+1.5,p));
    close(r,helicalThreadRadius(t+2*Math.PI,z,p));
    const sign=handedness==='right'?1:-1;
    close(r,helicalThreadRadius(t+.2,z+sign*1.5*.2/(2*Math.PI),p));
    close(r,helicalThreadRadius(-t,z,{...p,handedness:handedness==='right'?'left':'right'}));
  }
});
for(const handedness of ['right','left'])for(const type of ['shaft','nut'])test(`${type} ${handedness} is a closed, positive, conforming H8 solid and K round-trips`,()=>{
  const spec={...(type==='shaft'?shaft:nut),profile:{...profile,handedness}};
  topology((type==='shaft'?generateThreadedShaft:generateThreadedNut)(spec),type,spec);
});
test('shaft keeps every core node and element, at every axial station',()=>{
  const r=generateThreadedShaft(shaft),core=generateMappedCircularCore({radius:3.6,radiusSegments:4,arcSegments:4,modelFraction:'full'});
  const size=r.mesh.nodes.length/(r.plan.axialSegments+1),cells=r.mesh.elements.length/r.plan.axialSegments;
  for(let k=0;k<=r.plan.axialSegments;k++)for(let i=0;i<core.mesh.nodes.length;i++){
    assert.deepEqual(r.mesh.nodes[k*size+i].slice(0,2),core.mesh.nodes[i].slice(0,2));
  }
  for(let k=0;k<r.plan.axialSegments;k++)for(let i=0;i<core.mesh.elements.length;i++){
    assert.deepEqual(r.mesh.elements[k*cells+i].slice(0,4),core.mesh.elements[i].map(id=>id+k*size));
  }
});
test('nut exterior stays hexagonal and unrotated while its bore is helical',()=>{
  const r=generateThreadedNut(nut),n=nut.angularSegments,section=n*(nut.radialLayers+1);
  for(let k=1;k<=r.plan.axialSegments;k++)for(let i=0;i<n;i++){
    const j=nut.radialLayers*n+i;assert.deepEqual(r.mesh.nodes[k*section+j].slice(0,2),r.mesh.nodes[j].slice(0,2));
  }
  assert.notDeepEqual(r.mesh.nodes[0].slice(0,2),r.mesh.nodes[section*4].slice(0,2));
});
test('increasing angular/axial resolution reduces the analytic boundary error, without changing the SJ floor',()=>{
  const low=generateThreadedShaft(shaft),high=generateThreadedShaft({...shaft,radiusSegments:6,arcSegments:8,stepsPerTurn:32});
  assert.ok(high.quality.relativeAnalyticVolumeError<low.quality.relativeAnalyticVolumeError);
  assert.ok(high.quality.minimumCornerScaledJacobian>=.15);
});
test('inputs are immutable, repeated output deterministic, and an exact budget is allowed',()=>{
  const frozen=Object.freeze({...shaft,profile:Object.freeze({...profile})}),a=generateThreadedShaft(frozen),b=generateThreadedShaft(frozen);
  assert.deepEqual(a,b);assert.equal(a.mesh.elements.length,generateThreadedShaft({...shaft,elementLimit:a.mesh.elements.length}).mesh.elements.length);
});
test('both generators refuse a stricter unmet quality floor instead of lowering it',()=>{
  assert.throws(()=>generateThreadedShaft({...shaft,minimumCornerScaledJacobian:.99}),/corner SJ/);
  assert.throws(()=>generateThreadedNut({...nut,minimumCornerScaledJacobian:.99}),/corner SJ/);
});
for(const [name,patch] of [
  ['zero pitch',{profile:{...profile,pitch:0}}],['reversed radii',{profile:{...profile,rootRadius:5}}],
  ['bad hand',{profile:{...profile,handedness:'auto'}}],['bad flats',{profile:{...profile,rootFraction:.9,crestFraction:.2}}],
  ['bad phase',{profile:{...profile,phaseTurns:NaN}}],['unknown nested option',{profile:{...profile,standard:'ISO'}}],
  ['zero length',{length:0}],['infinite length',{length:Infinity}],['bad samples',{stepsPerTurn:7}],
  ['fractional samples',{stepsPerTurn:8.5}],['unsafe samples',{stepsPerTurn:2**54}],['overflow',{length:1e100}],
  ['relaxed SJ',{minimumCornerScaledJacobian:.01}],['bad SJ',{minimumCornerScaledJacobian:NaN}],
  ['zero limit',{elementLimit:0}],['huge limit',{elementLimit:200001}],['insufficient budget',{elementLimit:10}],
  ['unknown option',{optimize:true}]
])test(`thread generators reject ${name}`,()=>{
  assert.throws(()=>generateThreadedShaft({...shaft,...patch}));assert.throws(()=>generateThreadedNut({...nut,...patch}));
});
test('invalid section seeds, crossing bore, negative clearance and missing specs are rejected',()=>{
  for(const patch of [{coreRadius:4.2},{coreRadius:NaN},{surfaceLayers:0},{arcSegments:7},{radiusSegments:2},{surfaceLayers:1000000}])assert.throws(()=>generateThreadedShaft({...shaft,...patch}));
  for(const patch of [{acrossFlats:10},{clearance:-1},{angularSegments:25},{radialLayers:0},{radialLayers:1000000}])assert.throws(()=>generateThreadedNut({...nut,...patch}));
  for(const value of [undefined,null,[],4]){assert.throws(()=>generateThreadedShaft(value));assert.throws(()=>generateThreadedNut(value));}
  for(const x of [NaN,Infinity,1e12])assert.throws(()=>helicalThreadRadius(x,0,profile));
});
