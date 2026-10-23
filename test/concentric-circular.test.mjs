import test from 'node:test';
import assert from 'node:assert/strict';
import {planConcentricCircularMesh,prepareConcentricCircularMesh,generateConcentricCircularMesh,
  iterateConcentricCircularNodes,iterateConcentricCircularElements,generateMappedCircularCore,
  H1_FACES,hexElementSignedVolume,minimumHexCornerScaledJacobian,checkNoHangingNodes,meshToLsdynaKeyword,parseMeshText} from '../dist/index.js';

const base={radius:16,height:8,coreRadius:4,radiusSegments:20,arcSegments:32,axialSegments:16,modelFraction:'quarter',
  rings:[{innerRadius:4.5,outerRadius:5.5},{innerRadius:8.5,outerRadius:10.5}]};
const close=(x,y,t=1e-9)=>assert.ok(Math.abs(x-y)<=t,`${x} != ${y}`);
function verify(r){
  const {mesh,plan}=r,faces=new Map(),coords=new Set();let volume=0,sj=1;
  assert.equal(mesh.nodes.length,r.counts.nodes);assert.equal(mesh.elements.length,plan.expectedElements);
  for(const p of mesh.nodes){assert.ok(p.every(Number.isFinite));coords.add(p.map(x=>x.toFixed(10)).join(':'));}
  assert.equal(coords.size,mesh.nodes.length);
  for(const e of mesh.elements){
    assert.equal(new Set(e).size,8);assert.ok(e.every(n=>n>=1&&n<=mesh.nodes.length));
    const p=e.map(id=>mesh.nodes[id-1]);volume+=hexElementSignedVolume(p);sj=Math.min(sj,minimumHexCornerScaledJacobian(p));
    for(const f of H1_FACES){const ids=f.map(i=>e[i-1]),key=[...ids].sort((a,b)=>a-b).join(':');if(faces.has(key))faces.get(key).count++;else faces.set(key,{ids,count:1});}
  }
  for(const f of faces.values()){
    assert.ok(f.count===1||f.count===2);
    if(f.count===1){const p=f.ids.map(i=>mesh.nodes[i-1]);assert.ok(p.every(q=>q[2]===0)||p.every(q=>q[2]===plan.height)
      ||p.every(q=>Math.abs(Math.hypot(q[0],q[1])-plan.radius)<1e-9)
      ||(plan.modelFraction!=='full'&&p.every(q=>q[1]===0))||(plan.modelFraction==='quarter'&&p.every(q=>q[0]===0)));}
  }
  close(volume/plan.discreteVolume,1);close(sj,r.quality.minimumCornerScaledJacobian);
  assert.equal(checkNoHangingNodes(mesh,1e-8).ok,true);
}
for(const modelFraction of ['quarter','half','full'])test(`two coupled concentric rings ${modelFraction}: full topology, volume, core and K`,()=>{
  const r=generateConcentricCircularMesh({...base,modelFraction});verify(r);
  assert.deepEqual(r.plan.angularCountsPerQuarter,[32,16,8]);assert.deepEqual(r.plan.axialSpacings,[.5,1,2]);
  assert.equal(r.quality.periodicPartitionsIdentical,true);assert.equal(r.quality.engineeringAcceptanceVerified,false);
  const factor={quarter:1,half:2,full:4}[modelFraction];assert.equal(r.mesh.elements.length,8256*factor);
  assert.equal(r.plan.expectedCoreElements,384*16*factor);
  const parsed=parseMeshText(meshToLsdynaKeyword(r.mesh,{coordinateFormat:'compact'}),'circle.k');assert.deepEqual(parsed.elements,r.mesh.elements);
  const expected=generateMappedCircularCore({radius:4,radiusSegments:20,arcSegments:32,modelFraction:'quarter'}).mesh;
  const core=r.regions.filter(s=>s.name==='core');assert.equal(core.length,factor);
  const first=r.mesh.elements.slice(0,expected.elements.length);
  for(let i=0;i<first.length;i++){
    const p=first[i].map(n=>r.mesh.nodes[n-1]);
    for(let j=0;j<4;j++){assert.deepEqual(p[j].slice(0,2),expected.nodes[expected.elements[i][j]-1].slice(0,2));close(p[j][2],0);close(p[j+4][2],.5);}
  }
});

test('one ring, touching three rings and explicit radial policies retain concentric interfaces',()=>{
  for(const rings of [[{innerRadius:4,outerRadius:5}],
    [{innerRadius:4,outerRadius:5},{innerRadius:5,outerRadius:7},{innerRadius:7,outerRadius:11,radialSize:3}]]){
    const r=generateConcentricCircularMesh({...base,axialSegments:32,height:16,rings});verify(r);
    for(const ring of rings)for(const radius of [ring.innerRadius,ring.outerRadius])assert.ok(r.mesh.nodes.some(p=>Math.abs(Math.hypot(p[0],p[1])-radius)<1e-10));
    assert.equal(r.plan.angularCountsPerQuarter.length,rings.length+1);
  }
});

test('non-dyadic physical dimensions use exact logical sharing, not a rounded global coordinate lattice',()=>{
  const scale=.37,spec={...base,radius:base.radius*scale,height:base.height*scale,coreRadius:base.coreRadius*scale,
    rings:base.rings.map(r=>({innerRadius:r.innerRadius*scale,outerRadius:r.outerRadius*scale}))};
  const a=generateConcentricCircularMesh(spec);verify(a);close(a.plan.fineAxialSpacing,.5*scale);
  assert.ok(a.quality.relativeDiscreteVolumeError<1e-12);
});

test('R200/H600 planning preserves the successful three-ring count and exposes bounded streaming',()=>{
  const spec={radius:200,height:600,coreRadius:24,radiusSegments:48,arcSegments:80,axialSegments:1200,modelFraction:'quarter',
    rings:[{innerRadius:24.5,outerRadius:25.5},{innerRadius:32.5,outerRadius:34.5},{innerRadius:64.5,outerRadius:72.5}]};
  const p=planConcentricCircularMesh(spec);assert.equal(p.expectedElements,3310500);assert.equal(p.expectedCoreElements,2688000);
  assert.deepEqual(p.angularCountsPerQuarter,[80,40,20,10]);assert.deepEqual(p.axialSpacings,[.5,1,2,4]);
  assert.throws(()=>generateConcentricCircularMesh(spec),/stream/);
});

test('streaming iterators are deterministic and do not retain expanded copies',()=>{
  const p=prepareConcentricCircularMesh(base),n=[...iterateConcentricCircularNodes(p)],e=[...iterateConcentricCircularElements(p)];
  assert.deepEqual([...iterateConcentricCircularNodes(p)],n);assert.deepEqual([...iterateConcentricCircularElements(p)],e);
  assert.ok(p.motif.elements.length<e.length);assert.equal(e.length,p.counts.elements);
});

for(const [name,patch] of [
  ['no rings',{rings:[]}],['too many rings',{rings:Array.from({length:9},()=>({innerRadius:5,outerRadius:6}))}],
  ['odd angular closure',{arcSegments:30}],['unsupported period',{axialSegments:15}],['too few axial layers',{axialSegments:4}],
  ['overlap',{rings:[{innerRadius:4.5,outerRadius:8},{innerRadius:7,outerRadius:9}]}],
  ['outside radius',{rings:[{innerRadius:4,outerRadius:17}]}],['inside core',{rings:[{innerRadius:3,outerRadius:5}]}],
  ['zero width',{rings:[{innerRadius:4,outerRadius:4}]}],['zero radialSize',{radialSize:0}],
  ['ring bad radialSize',{rings:[{innerRadius:4,outerRadius:5,radialSize:NaN}]}],['unknown ring option',{rings:[{innerRadius:4,outerRadius:5,ratio:3}]}],
  ['not finite',{height:Infinity}],['underflow',{height:1e-300}],['bad fraction',{modelFraction:'1/4'}],
  ['element budget',{elementLimit:10}],['motif budget',{motifElementLimit:10}],['unsafe budget',{elementLimit:20000001}],
  ['unknown option',{ratio:3}],['unsafe regular count',{radialSize:Number.MIN_VALUE}],['null rings',{rings:null}]
])test(`concentric planner rejects ${name} before allocation`,()=>assert.throws(()=>planConcentricCircularMesh({...base,...patch})));

test('geometrically inverted curved transitions are refused without relaxing Jacobian thresholds',()=>{
  assert.throws(()=>prepareConcentricCircularMesh({...base,radius:12,coreRadius:3,radiusSegments:6,arcSegments:8,
    rings:[{innerRadius:3.5,outerRadius:4.5},{innerRadius:6.5,outerRadius:8.5}]}),/Jacobian/);
});

test('an explicit engineering quality gate refuses a geometrically valid low-SJ mesh',()=>{
  assert.throws(()=>prepareConcentricCircularMesh({...base,minimumCornerScaledJacobian:.3}),/violates requested limit/);
  const r=prepareConcentricCircularMesh({...base,minimumCornerScaledJacobian:.2});
  assert.ok(r.quality.minimumCornerScaledJacobian>=.2);
  for(const value of [0,-1,NaN,Infinity,1.01])assert.throws(()=>planConcentricCircularMesh({...base,minimumCornerScaledJacobian:value}));
});

test('four concentric stages simultaneously coarsen both directions and retain the mapped core',()=>{
  const r=prepareConcentricCircularMesh({radius:48,height:16,coreRadius:16,radiusSegments:40,arcSegments:64,axialSegments:32,
    modelFraction:'quarter',minimumCornerScaledJacobian:.2,
    rings:[{innerRadius:16.5,outerRadius:17.5},{innerRadius:18.5,outerRadius:20.5},{innerRadius:22.5,outerRadius:26.5},{innerRadius:30.5,outerRadius:38.5}]});
  assert.deepEqual(r.plan.angularCountsPerQuarter,[64,32,16,8,4]);assert.deepEqual(r.plan.axialSpacings,[.5,1,2,4,8]);
  assert.equal(r.plan.expectedCoreElements,1536*32);assert.equal(r.quality.unexpectedInternalFreeFaces,0);
});
