import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planMappedCircularCore,generateMappedCircularCore,generateMappedCircularPrism,
  generateCircularGradedQuadMesh,checkNoHangingNodes,meshToLsdynaKeyword,meshToLsdynaShellKeyword,
  parseMeshText,hexElementSignedVolume,minimumHexCornerScaledJacobian,H1_FACES} from '../dist/index.js';
import {hexJacobian} from '../dist/hex-quality-internal.js';

const base={radius:24,radiusSegments:48,arcSegments:80,modelFraction:'quarter'};
const close=(actual,expected,tolerance=1e-10)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
function validIds(mesh){
  assert.ok(mesh.nodes.every(p=>p.length===3&&p.every(Number.isFinite)));
  assert.ok(mesh.elements.every(e=>new Set(e).size===e.length&&e.every(n=>Number.isSafeInteger(n)&&n>=1&&n<=mesh.nodes.length)));
}

for(const [radiusSegments,arcSegments] of [[2,2],[6,6],[6,8],[5,6],[48,48],[48,80]])for(const modelFraction of ['quarter','half','full']){
  test(`mapped circular ${modelFraction} radius/arc seeds ${radiusSegments}/${arcSegments}`,()=>{
    const spec={...base,radiusSegments,arcSegments,modelFraction},r=generateMappedCircularCore(spec),p=planMappedCircularCore(spec);
    const copies={quarter:1,half:2,full:4}[modelFraction],n=arcSegments/2,m=radiusSegments-n;
    assert.equal(r.mesh.kind,'Q1');validIds(r.mesh);
    assert.equal(r.mesh.elements.length,(n*n+2*n*m)*copies);
    assert.equal(r.mesh.nodes.length,p.expectedNodeCount);
    assert.equal(r.mesh.elements.length,p.expectedElementCount);
    close(r.quality.area,p.discreteArea,1e-9);
    assert.ok(r.quality.minimumCornerScaledJacobian>0&&r.quality.minimumGaussDeterminant>0);
    assert.ok(r.quality.relativeAreaError<1e-10);
    assert.ok(r.quality.minimumAngleDegrees>0&&r.quality.maximumAngleDegrees<180);
    assert.ok(r.quality.minimumEdge>0&&r.quality.maximumEdge>=r.quality.meanElementEdgeLength);
    assert.equal(checkNoHangingNodes(r.mesh,1e-8).ok,true);
    assert.equal(new Set(r.mesh.nodes.map(p=>p.map(x=>x.toFixed(11)).join(':'))).size,r.mesh.nodes.length);
    assert.equal(r.nodeSets.circular_boundary.length,copies*arcSegments+(modelFraction==='full'?0:1));
    assert.equal(new Set(r.nodeSets.circular_boundary).size,r.nodeSets.circular_boundary.length);
    for(const id of r.nodeSets.circular_boundary)close(Math.hypot(...r.mesh.nodes[id-1].slice(0,2)),24,1e-12);
    assert.equal(r.nodeSets.plane_x0.length,(modelFraction==='full'?2:1)*radiusSegments+1);
    assert.equal(r.nodeSets.plane_y0.length,(modelFraction==='quarter'?1:2)*radiusSegments+1);
    for(const id of r.nodeSets.plane_x0)assert.equal(r.mesh.nodes[id-1][0],0);
    for(const id of r.nodeSets.plane_y0)assert.equal(r.mesh.nodes[id-1][1],0);
    assert.equal(r.patchElementIds.center.length,n*n*copies);
    assert.equal(r.patchElementIds['x-wing'].length,n*m*copies);
    assert.equal(r.patchElementIds['y-wing'].length,n*m*copies);
    assert.equal(new Set(Object.values(r.patchElementIds).flat()).size,r.mesh.elements.length);
    const parsed=parseMeshText(meshToLsdynaShellKeyword(r.mesh,{coordinateFormat:'compact'}),'mapped.k');
    assert.equal(parsed.kind,'Q1');assert.deepEqual(parsed.elements,r.mesh.elements);
  });
}

test('mapped circular core reproduces the successful R24/48/80 seed geometry without a fixture',()=>{
  const r=generateMappedCircularCore(base);
  assert.equal(r.mesh.elements.length,2240);assert.equal(r.mesh.nodes.length,2329);
  assert.equal(r.plan.centerSegments,40);assert.equal(r.plan.wingRadialSegments,8);
  assert.equal(r.plan.axisExtent,20);assert.equal(r.plan.innerCornerFraction,.625);
  close(r.quality.minimumCornerScaledJacobian,.8,1e-12);
  close(r.quality.minimumEdge,.34834957055,1e-7);
  close(r.quality.maximumEdge,.62861797256,1e-7);
  assert.ok(r.quality.meanElementEdgeLength>.4&&r.quality.meanElementEdgeLength<.5);
  assert.ok(r.quality.maximumAngleDegrees<130);
});

test('equal three-edge seeding does not claim equal physical edge sizes',()=>{
  const r=generateMappedCircularCore({...base,arcSegments:48});
  close(r.plan.radiusEdgeSpacing,.5);close(r.plan.arcEdgeChord,.7853631180713654);
  assert.equal(r.plan.axisExtent,12);close(r.plan.innerCornerFraction,.42);
  assert.equal(r.mesh.elements.length,1728);
  assert.ok(r.quality.warnings.some(w=>w.includes('not constrained')));
});

test('mapped circular parameters are deterministic, immutable and independently auditable',()=>{
  const spec=Object.freeze({...base});const a=generateMappedCircularCore(spec),b=generateMappedCircularCore(spec);
  assert.deepEqual(a,b);assert.deepEqual(spec,base);
  const explicit=generateMappedCircularCore({...base,innerCornerFraction:.62});
  assert.equal(explicit.plan.innerCornerFraction,.62);
  assert.ok(explicit.quality.minimumCornerScaledJacobian>0);
  assert.notDeepEqual(explicit.mesh.nodes,a.mesh.nodes);
});

for(const [name,patch] of [
  ['zero radius',{radius:0}],['negative radius',{radius:-1}],['NaN radius',{radius:NaN}],['infinite radius',{radius:Infinity}],
  ['area overflow',{radius:1e308}],['area underflow',{radius:1e-300}],['fractional seeds',{radiusSegments:3.5}],
  ['zero seeds',{radiusSegments:0}],['unsafe seeds',{radiusSegments:2**54}],['odd arc',{arcSegments:79}],
  ['zero arc',{arcSegments:0}],['no wing',{arcSegments:96}],['incompatible seeds',{arcSegments:98}],
  ['wrong fraction',{modelFraction:'1/4'}],['zero join',{innerCornerFraction:0}],['collapsed join',{innerCornerFraction:10/24}],
  ['outside join',{innerCornerFraction:.9}],['NaN join',{innerCornerFraction:NaN}],['unknown option',{optimize:true}],
  ['zero budget',{elementLimit:0}],['oversized budget',{elementLimit:2000001}],['insufficient budget',{elementLimit:2239}],
  ['huge counts',{radiusSegments:1000000,arcSegments:1000000}]
])test(`mapped circle rejects ${name} before mesh allocation`,()=>{
  assert.throws(()=>planMappedCircularCore({...base,...patch}));
  assert.throws(()=>generateMappedCircularCore({...base,...patch}));
});
test('mapped circle refuses nonobject options and permits an exact element budget',()=>{
  for(const input of [null,undefined,[],4])assert.throws(()=>generateMappedCircularCore(input),/object/);
  assert.equal(generateMappedCircularCore({...base,elementLimit:2240}).mesh.elements.length,2240);
});

for(const modelFraction of ['quarter','half','full'])test(`mapped prism ${modelFraction} has shared nodes, positive H8s and faithful K output`,()=>{
  const r=generateMappedCircularPrism({...base,radius:2,radiusSegments:6,arcSegments:8,modelFraction,height:2.5,axialSegments:5});
  validIds(r.mesh);assert.equal(r.mesh.kind,'H1');assert.equal(r.mesh.elements.length,r.plan.expectedElementCount);
  assert.equal(r.mesh.nodes.length,r.plan.expectedNodeCount);assert.equal(r.nodeSets.bottom.length*6,r.mesh.nodes.length);
  const faces=new Map();let volume=0,sj=Infinity,gauss=Infinity;
  for(const e of r.mesh.elements){
    const p=e.map(i=>r.mesh.nodes[i-1]);volume+=hexElementSignedVolume(p);sj=Math.min(sj,minimumHexCornerScaledJacobian(p));
    for(const u of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const v of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const w of [-1/Math.sqrt(3),1/Math.sqrt(3)]){
      const [a,b,c]=hexJacobian(p,u,v,w);const det=a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]);
      gauss=Math.min(gauss,det);assert.ok(det>0);
    }
    for(const f of H1_FACES){const ids=f.map(i=>e[i-1]),key=[...ids].sort((a,b)=>a-b).join(':');const old=faces.get(key);if(old){old.count++;assert.ok(old.count<=2);}else faces.set(key,{ids,count:1});}
  }
  close(volume,r.quality.volume,1e-10);close(sj,r.quality.minimumCornerScaledJacobian,1e-12);
  close(gauss,r.quality.minimumGaussDeterminant,1e-12);
  for(const f of faces.values())if(f.count===1){
    const p=f.ids.map(i=>r.mesh.nodes[i-1]);
    assert.ok(p.every(q=>q[2]===0)||p.every(q=>q[2]===2.5)||p.every(q=>Math.abs(Math.hypot(q[0],q[1])-2)<1e-10)
      ||(modelFraction!=='full'&&p.every(q=>q[1]===0))||(modelFraction==='quarter'&&p.every(q=>q[0]===0)));
  }
  for(const ids of Object.values(r.nodeSets)){assert.equal(ids.length,new Set(ids).size);assert.ok(ids.every(i=>i>=1&&i<=r.mesh.nodes.length));}
  for(const i of r.nodeSets.outer_cylinder)close(Math.hypot(...r.mesh.nodes[i-1].slice(0,2)),2,1e-12);
  for(const i of r.nodeSets.bottom)assert.equal(r.mesh.nodes[i-1][2],0);
  for(const i of r.nodeSets.top)assert.equal(r.mesh.nodes[i-1][2],2.5);
  assert.equal(checkNoHangingNodes(r.mesh,1e-8).ok,true);
  const parsed=parseMeshText(meshToLsdynaKeyword(r.mesh,{coordinateFormat:'compact'}),'mapped.k');
  assert.equal(parsed.kind,'H1');assert.deepEqual(parsed.elements,r.mesh.elements);
});

test('mapped prism R24 core stencil has exact0.5mm axial spacing without rerefinement',()=>{
  const r=generateMappedCircularPrism({...base,height:8,axialSegments:16});
  assert.equal(r.mesh.elements.length,35840);assert.equal(r.mesh.nodes.length,2329*17);
  assert.equal(r.plan.axialSegments,16);close(r.quality.axialSpacing,.5);
  assert.ok(r.mesh.nodes.every(p=>Math.abs(p[2]*2-Math.round(p[2]*2))<1e-12));
  close(r.quality.minimumCornerScaledJacobian,.8,1e-12);
});

for(const patch of [{height:0},{height:Infinity},{height:1e308},{height:Number.MIN_VALUE},{axialSegments:0},{axialSegments:1.5},{axialSegments:Infinity},{height:600,axialSegments:1200},{elementLimit:2239}]){
  test(`mapped prism rejects invalid geometry/count/budget ${JSON.stringify(patch)}`,()=>{
    assert.throws(()=>generateMappedCircularPrism({...base,height:8,axialSegments:16,...patch}));
  });
}

for(const [modelFraction,hash] of [
  ['quarter','b814e8fd20fd3b1eb38c5ff2cf281db4100645c8169458399f097a1dbc1731af'],
  ['half','236cbec44ed44fafbd0d28780c8459308bf0447440f73cfd745e6cfed5e6e0f4'],
  ['full','7064cee69b44f91a0e26c87bb862954aa57ad26ff1e8ad1db658764dff84a7a7']
])test(`shared map helper leaves legacy3:1 circle ${modelFraction} byte-level geometry unchanged`,()=>{
  const r=generateCircularGradedQuadMesh({radius:20,refinedRadius:10,fineSize:1,coarseSize:2,modelFraction});
  assert.equal(createHash('sha256').update(JSON.stringify([r.mesh.nodes,r.mesh.elements])).digest('hex'),hash);
});
