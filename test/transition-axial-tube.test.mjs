import test from 'node:test';
import assert from 'node:assert/strict';
import {generateAxialTransitionTube,checkNoHangingNodes,meshToLsdynaKeyword,parseMeshText} from '../dist/index.js';

for(const ratios of [[2],[3],[2,2],[3,3],[2,3]])for(const fineEnd of ['start','end'])
test(`axial ${ratios} fine at ${fineEnd}: closed seam, positive hexes and boundary volume`,()=>{
  const spec={innerRadius:10,outerRadius:12,length:6,radialLayers:2,fineSegments:72,ratios,fineEnd};
  const before=structuredClone(spec),r=generateAxialTransitionTube(spec);assert.deepEqual(spec,before);
  const expected=ratios.reduce((sum,ratio,i)=>sum+r.plan.counts[i]*(ratio===2?1.5:4/3),0)*2;
  assert.equal(r.mesh.elements.length,expected);assert.equal(r.plan.closed,true);
  assert.equal(new Set(r.mesh.nodes.map(p=>p.map(v=>v.toFixed(9)).join(':'))).size,r.mesh.nodes.length);
  assert.ok(checkNoHangingNodes(r.mesh,1e-9).ok);assert.ok(r.quality.minimumCornerScaledJacobian>0);
  assert.ok(r.quality.minimumGaussDeterminant>0);assert.ok(r.quality.relativeVolumeError<1e-12);
  assert.ok(r.quality.relativeAnalyticVolumeError>0);
  for(const id of r.nodeSets.fine)assert.ok(Math.abs(r.mesh.nodes[id-1][2]-(fineEnd==='start'?0:6))<1e-12);
  for(let level=0;level<=ratios.length;level++){
    const ids=r.nodeSets[`interface_${level}`],height=fineEnd==='start'?r.plan.boundaries[level]:6-r.plan.boundaries[level];
    assert.equal(ids.length,r.plan.counts[level]*3);
    for(const id of ids)assert.ok(Math.abs(r.mesh.nodes[id-1][2]-height)<1e-12);
  }
  for(const name of ['inner','outer'])for(const id of r.nodeSets[name]){
    const p=r.mesh.nodes[id-1];assert.ok(Math.abs(Math.hypot(p[0],p[1])-(name==='inner'?10:12))<1e-12);
  }
  const back=parseMeshText(meshToLsdynaKeyword(r.mesh,{coordinateFormat:'compact'}),'tube.k');assert.deepEqual(back.elements,r.mesh.elements);
});

test('axial sector accepts arbitrary spatial axes and both geometric end planes',()=>{
  const axis=[1,2,3],norm=Math.hypot(...axis),unit=axis.map(x=>x/norm),origin=[4,-7,2];
  const r=generateAxialTransitionTube({innerRadius:10,outerRadius:12,length:6,radialLayers:2,
    fineSegments:24,ratios:[2,3],sweepAngleDegrees:90,startAngleDegrees:30,axis,origin});
  assert.equal(r.plan.closed,false);assert.ok(r.nodeSets.sector_start.length>0);assert.ok(r.nodeSets.sector_end.length>0);
  for(const [name,distance] of [['axis_start',0],['axis_end',6]])for(const id of r.nodeSets[name]){
    const p=r.mesh.nodes[id-1];assert.ok(Math.abs(p.reduce((s,v,a)=>s+(v-origin[a])*unit[a],0)-distance)<1e-11);
  }
  assert.ok(r.quality.relativeVolumeError<1e-12);assert.ok(checkNoHangingNodes(r.mesh,1e-9).ok);
});

test('axial tube rejects invalid counts, radii, frames and layer limits',()=>{
  const spec={innerRadius:10,outerRadius:12,length:6,radialLayers:2,fineSegments:24,ratios:[2]};
  for(const change of [{innerRadius:0},{outerRadius:9},{axis:[0,0,0]},{axis:[NaN,0,1]},{origin:[0,0]},
    {radialLayers:1.2},{radialLayers:1001},{sweepAngleDegrees:0},{fineEnd:'bottom'},{fineSegments:23},{unknown:1}])
    assert.throws(()=>generateAxialTransitionTube({...spec,...change}));
});
