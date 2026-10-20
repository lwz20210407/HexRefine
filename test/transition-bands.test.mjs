import test from 'node:test';
import assert from 'node:assert/strict';
import {planTransitionBand,TransitionBandCountError,generatePlanarTransitionBand,generateAnnularTransitionBand,extrudeTransitionBand,
  checkNoHangingNodes,meshToLsdynaKeyword,meshToLsdynaShellKeyword,parseMeshText} from '../dist/index.js';

test('band planner enforces exact template divisibility and supplies unbounded-distance legal suggestions',()=>{
  assert.deepEqual(planTransitionBand({fineSegments:72,ratios:[2,3],depth:9}).counts,[72,36,12]);
  assert.deepEqual(planTransitionBand({fineSegments:72,ratios:[3,2],depth:8}).stageDepths,[2,6]);
  assert.throws(()=>planTransitionBand({fineSegments:100,ratios:Array(8).fill(3),depth:1}),e=>
    e instanceof TransitionBandCountError&&e.requiredMultiple===6561&&e.nearbyCounts[0]===6561);
  assert.throws(()=>planTransitionBand({fineSegments:23,ratios:[2],depth:1}),e=>e.requiredMultiple===4&&String(e.nearbyCounts)==='20,24');
  for(const n of [24.9,true,0,NaN,Infinity,200001])assert.throws(()=>planTransitionBand({fineSegments:n,ratios:[2],depth:1}));
  for(const ratios of [[],[1],[4],[true],Array(9).fill(2)])assert.throws(()=>planTransitionBand({fineSegments:24,ratios,depth:1}));
  assert.throws(()=>planTransitionBand({fineSegments:24,ratios:[2,3],depth:3,stageDepths:[1,1]}),/sum/);
  assert.deepEqual(planTransitionBand({fineSegments:24,ratios:[2,3],depth:3,stageDepths:[1,2]}).boundaries,[0,1,3]);
});

for(const ratios of [[2],[3],[2,2],[3,3],[2,3],[3,2],[2,2,2]])test(`planar bands preserve count chain ${ratios}`,()=>{
  for(const fineSide of ['bottom','top'])for(const rotationDegrees of [0,30,-45]){
    const b=generatePlanarTransitionBand({length:24,depth:4,fineSegments:ratios.length===3?64:72,ratios,fineSide,rotationDegrees,origin:[13,-21]});
    const expected=ratios.reduce((sum,r,i)=>sum+b.plan.counts[i]*(r===2?1.5:4/3),0);
    assert.equal(b.mesh.elements.length,expected);
    b.plan.counts.forEach((n,i)=>assert.equal(b.nodeSets[`interface_${i}`].length,n+1));
    assert.ok(checkNoHangingNodes(b.mesh,1e-9).ok);
    assert.ok(b.quality.minimumGaussDeterminant>0);assert.ok(b.quality.relativeAreaError<1e-12);
    const back=parseMeshText(meshToLsdynaShellKeyword(b.mesh,{coordinateFormat:'compact'}),'band.k');assert.deepEqual(back.elements,b.mesh.elements);
  }
});

for(const fineSide of ['inner','outer'])for(const sweep of [90,180,360])test(`annular ${fineSide}-fine ${sweep} degrees is seam-conforming`,()=>{
  const b=generateAnnularTransitionBand({innerRadius:10,outerRadius:18,fineSegments:72,ratios:[2,3],fineSide,
    sweepAngleDegrees:sweep,startAngleDegrees:30,center:[3,-4]});
  assert.equal(b.plan.closed,sweep===360);const closed=sweep===360;
  b.plan.counts.forEach((n,i)=>assert.equal(b.nodeSets[`interface_${i}`].length,n+(closed?0:1)));
  const radius=fineSide==='inner'?10:18;
  for(const id of b.nodeSets.fine){const p=b.mesh.nodes[id-1];assert.ok(Math.abs(Math.hypot(p[0]-3,p[1]+4)-radius)<1e-12);}
  assert.equal(new Set(b.mesh.nodes.map(p=>p.map(x=>x.toFixed(9)).join(','))).size,b.mesh.nodes.length);
  assert.ok(b.quality.relativeAreaError<1e-12);assert.ok(b.quality.relativeAnalyticAreaError>0);
  assert.ok(checkNoHangingNodes(b.mesh,1e-9).ok);
  const solid=extrudeTransitionBand(b,2,3);
  assert.equal(solid.mesh.elements.length,3*b.mesh.elements.length);assert.equal(solid.mesh.nodes.length,4*b.mesh.nodes.length);
  assert.ok(solid.quality.relativeVolumeError<1e-12);assert.ok(solid.quality.minimumGaussDeterminant>0);
  const back=parseMeshText(meshToLsdynaKeyword(solid.mesh,{coordinateFormat:'compact'}),'solid.k');assert.deepEqual(back.elements,solid.mesh.elements);
});

test('invalid curved geometry and tampered extrusion fail closed',()=>{
  const a={innerRadius:10,outerRadius:18,fineSegments:24,ratios:[2]};
  for(const input of [{innerRadius:0},{outerRadius:5},{fineSide:'inside'},{sweepAngleDegrees:361},{center:[NaN,0]},{unknown:1}])
    assert.throws(()=>generateAnnularTransitionBand({...a,...input}));
  assert.throws(()=>generateAnnularTransitionBand({...a,outerRadius:10.00001}),/area|quality/);
  assert.throws(()=>generateAnnularTransitionBand({...a,fineSegments:12,ratios:[3,3]}));
  const b=generatePlanarTransitionBand({length:8,depth:2,fineSegments:8,ratios:[2]});
  assert.throws(()=>extrudeTransitionBand(b,1,1.2));assert.throws(()=>extrudeTransitionBand(b,-1,2));
  assert.throws(()=>extrudeTransitionBand({...b,stageIds:[]},1,2),/lineage/);
  const altered=structuredClone(b);altered.mesh.elements[0]=[...altered.mesh.elements[0]].reverse();
  assert.throws(()=>extrudeTransitionBand(altered,1,2),/quality/);
  assert.equal(b.plan.geometryChecked,false);
});
