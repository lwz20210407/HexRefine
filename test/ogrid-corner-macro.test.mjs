import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {refineExtrudedOgrid,checkNoHangingNodes,H1_FACES,hexElementSignedVolume,minimumHexCornerScaledJacobian,mergeCoincidentNodes} from '../dist/index.js';
import {hexJacobian} from '../dist/hex-quality-internal.js';

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

test('five-valent corner with its complete support ring has a conforming full-section shell',()=>{
  const nodes=[],elements=[],n=5;
  for(let s=0;s<n;s++){
    const p=[[0,0],[Math.cos(s*2*Math.PI/n),Math.sin(s*2*Math.PI/n)],
      [1.5*Math.cos((s+.5)*2*Math.PI/n),1.5*Math.sin((s+.5)*2*Math.PI/n)],
      [Math.cos((s+1)*2*Math.PI/n),Math.sin((s+1)*2*Math.PI/n)]],start=nodes.length;
    const id=(i,j,k)=>start+1+9*k+3*j+i;
    for(let k=0;k<=8;k++)for(let j=0;j<=2;j++)for(let i=0;i<=2;i++){
      const u=i/2,v=j/2,w=[(1-u)*(1-v),u*(1-v),u*v,(1-u)*v];nodes.push([0,1].map(a=>p.reduce((sum,q,c)=>sum+q[a]*w[c],0)).concat(k));
    }
    for(let k=0;k<8;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++)elements.push([id(i,j,k),id(i+1,j,k),id(i+1,j+1,k),id(i,j+1,k),id(i,j,k+1),id(i+1,j,k+1),id(i+1,j+1,k+1),id(i,j+1,k+1)]);
  }
  const source=mergeCoincidentNodes({kind:'H1',nodes,elements},1e-10),result=refineExtrudedOgrid(source,{axis:2,bands:[{min:3,max:5,level:2}],completion:'none',balanceMode:'direct-macro',transitionGeometry:'conservative-face-flux',maxPromotedSourceLayers:0});
  assert.equal(result.mesh.elements.length,3880);
  assert.equal(result.report.macroFinalization.shellParents,40);
  assert.equal(result.report.quality.engineeringAcceptanceVerified,false);
  assert.equal(result.report.qualityWarnings.some(w=>w.includes('shorter than the finest-core')),result.report.quality.sizeDistribution.transitionToFinestCoreEdgeRatio<1-1e-8);
  assert.equal(result.report.qualityWarnings.some(w=>w.includes('corner SJ is below')),false);
  assert.ok(result.report.quality.minimumCornerSJ>.2);
  assert.ok(checkNoHangingNodes(result.mesh,1e-8).ok);
  assert.deepEqual(result.report.promotedSourceLayerIndices,[]);
  assert.deepEqual(result.mesh.nodes.slice(0,source.nodes.length),source.nodes);
  const counts=new Map();result.completedParentIds.forEach(p=>counts.set(p,(counts.get(p)??0)+1));
  source.elements.forEach((e,i)=>{
    const layer=Math.min(...e.map(n=>source.nodes[n-1][2]));
    assert.equal(counts.get(i+1),layer===2||layer===5?31:layer===3||layer===4?64:1);
  });
});

test('complete corner reference tables certify each whole parent, all Gauss samples and manifold boundary',()=>{
  for(const name of ['complete31-parent','complete93-trivalent-star','complete155-pentavalent-star']){
    const data=JSON.parse(readFileSync(new URL(`./fixtures/lsdyna/hierarchical-macros/${name}.json`,import.meta.url),'utf8'));
    const {nodes,hexes,parents,childParentIds}=data,volumes=parents.map(()=>0),faces=new Map();
    hexes.forEach((e,i)=>{
      assert.equal(new Set(e).size,8);assert.ok(e.every(n=>Number.isSafeInteger(n)&&n>=0&&n<nodes.length));
      const p=e.map(n=>nodes[n]);assert.ok(minimumHexCornerScaledJacobian(p)>0);
      volumes[childParentIds[i]]+=hexElementSignedVolume(p);
      for(const u of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const v of [-1/Math.sqrt(3),1/Math.sqrt(3)])for(const w of [-1/Math.sqrt(3),1/Math.sqrt(3)]){
        const [a,b,c]=hexJacobian(p,u,v,w);assert.ok(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0])>0);
      }
      for(const f of H1_FACES){const q=f.map(n=>e[n-1]),key=[...q].sort((a,b)=>a-b).join(':');const entry=faces.get(key)??{q,count:0};entry.count++;assert.ok(entry.count<=2);faces.set(key,entry);}
    });
    volumes.forEach((volume,i)=>assert.ok(Math.abs(volume-hexElementSignedVolume(parents[i]))/volume<1e-12));
    const boundary=[...faces.values()].filter(f=>f.count===1).map(f=>f.q),edges=new Map();
    boundary.forEach(q=>q.forEach((a,i)=>{const key=[a,q[(i+1)%4]].sort((a,b)=>a-b).join(':');edges.set(key,(edges.get(key)??0)+1);}));
    assert.ok([...edges.values()].every(c=>c===2));
    assert.equal(new Set(boundary.flat()).size-edges.size+boundary.length,2);
    assert.equal(data.certificate.hexes,hexes.length);
    assert.equal(data.certificate.nodes,nodes.length);
  }
});
