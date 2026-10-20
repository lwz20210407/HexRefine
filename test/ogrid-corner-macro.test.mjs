import assert from 'node:assert/strict';
import test from 'node:test';
import {refineExtrudedOgrid,checkNoHangingNodes} from '../dist/index.js';

function extrude(points,quads,layers=8){
  const nodes=[],elements=[];
  for(let k=0;k<=layers;k++)for(const p of points)nodes.push([...p,k]);
  for(let k=0;k<layers;k++)for(const q of quads)elements.push([...q.map(n=>1+n+k*points.length),...q.map(n=>1+n+(k+1)*points.length)]);
  return {kind:'H1',nodes,elements};
}
function butterfly(){
  const points=[[0,0],[.5,.5],[0,.5],[-.5,.5],[-.5,0],[-.5,-.5],[0,-.5],[.5,-.5],[.5,0]];
  for(let i=0;i<8;i++){const t=Math.PI*(.25+.25*i);points.push([Math.cos(t),Math.sin(t)]);}
  return extrude(points,[[0,8,1,2],[0,2,3,4],[0,4,5,6],[0,6,7,8],...Array.from({length:8},(_,s)=>[1+(s+1)%8,1+s,9+s,9+(s+1)%8])]);
}

test('complete butterfly with all four trivalent corners uses whole31-Hex shell parents',()=>{
  const source=butterfly(),result=refineExtrudedOgrid(source,{axis:2,bands:[{min:3,max:5,level:2}],completion:'none',transitionGeometry:'conservative-face-flux',balanceMode:'direct-macro',maxPromotedSourceLayers:0});
  assert.equal(result.mesh.elements.length,2328);
  assert.equal(result.report.macroFinalization.shellParents,24);
  assert.deepEqual(result.report.promotedSourceLayerIndices,[]);
  assert.deepEqual(result.mesh.nodes.slice(0,source.nodes.length),source.nodes);
  assert.ok(checkNoHangingNodes(result.mesh,1e-8).ok);
  const counts=new Map();result.completedParentIds.forEach(p=>counts.set(p,(counts.get(p)??0)+1));
  for(const column of [0,1,2,3,4,5,6,7,8,9,10,11]){
    assert.equal(counts.get(1+2*12+column),31);
    assert.equal(counts.get(1+3*12+column),64);
    assert.equal(counts.get(1+4*12+column),64);
    assert.equal(counts.get(1+5*12+column),31);
  }
  assert.ok(result.report.quality.refinementRelativeVolumeError<1e-12);
});

test('unsupported isolated odd-valence stars are refused, not mislabeled as general coverage',()=>{
  for(const n of [3,5]){
    const points=[[0,0]],quads=[];
    for(let i=0;i<n;i++){const t=i*2*Math.PI/n;points.push([Math.cos(t),Math.sin(t)],[1.5*Math.cos(t+Math.PI/n),1.5*Math.sin(t+Math.PI/n)]);quads.push([0,1+2*i,2+2*i,1+2*((i+1)%n)]);}
    assert.throws(()=>refineExtrudedOgrid(extrude(points,quads),{axis:2,bands:[{min:3,max:5,level:2}],completion:'none',transitionGeometry:'conservative-face-flux',balanceMode:'direct-macro'}),/no level-closed/);
  }
});
