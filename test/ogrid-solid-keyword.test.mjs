import assert from 'node:assert/strict';
import test from 'node:test';
import {meshToLsdynaKeyword} from '../dist/export.js';
import {parseSolidOgridSource,refineSolidOgridKeyword} from '../dist/ogrid-solid-keyword.js';

function source(layerHeight=1) {
  const nodes=[],elements=[];
  const id=(i,j,k)=>1+k*9+j*3+i;
  for(let k=0;k<=8;k++)for(let j=0;j<3;j++)for(let i=0;i<3;i++){
    let x=i-1,y=j-1;
    if(x||y){const r=Math.hypot(x,y);x/=r;y/=r;}
    nodes.push([x,y,k*layerHeight]);
  }
  for(let k=0;k<8;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++){
    const quad=[id(i,j,k),id(i+1,j,k),id(i+1,j+1,k),id(i,j+1,k)];
    elements.push([...quad,...quad.map(n=>n+9)]);
  }
  return meshToLsdynaKeyword({kind:'H1',nodes,elements},{partId:7,coordinateFormat:'compact'})
    .replace('*END','*SET_NODE_LIST_TITLE\nkeep axial ends\n41,0,0,0,0\n1,73\n*END');
}

test('old solid extruded O-grid discovers axis, builds core and retains end records',()=>{
  const original=source(),before=parseSolidOgridSource(original);
  const result=refineSolidOgridKeyword(original,{fraction:.6});
  const after=parseSolidOgridSource(result.keyword);
  assert.equal(result.report.axis,2);
  assert.equal(result.report.pid,7);
  assert.equal(result.report.roiParentIds.length,16);
  assert.equal(result.report.coreParentIds.length,8);
  assert.equal(result.report.specimenElements,136);
  assert.equal(result.report.retainedSpecimenElements,16);
  assert.ok(result.report.minimumNewCornerSJ>=.15);
  assert.ok(result.report.installedQuality.minimumGaussDeterminant>0);
  assert.ok(result.report.installedQuality.relativeVolumeError<1e-8);
  assert.deepEqual(after.nodeSets,before.nodeSets);
  assert.ok([...before.nodes].every(([id,n])=>after.nodes.get(id).raw===n.raw));
  assert.ok([...before.solids].every(([id,e])=>result.report.roiParentIds.includes(id)
    ||after.solids.get(id).raw.join('\n')===e.raw.join('\n')));
});

test('reject absent core, dependencies, and sets that reference a changed element',()=>{
  const original=source();
  assert.throws(()=>refineSolidOgridKeyword(original,{fraction:.1}),/ROI needs/);
  assert.throws(()=>refineSolidOgridKeyword(source(1/3),{fraction:.6}),/below the existing 0.15 gate/);
  assert.throws(()=>parseSolidOgridSource(original.replace('*END','*INCLUDE\nother.k\n*END')),/unsupported mesh dependency/);
  assert.throws(()=>refineSolidOgridKeyword(original.replace('*END','*SET_SOLID_LIST\n43,0,0,0,0\n9\n*END'),
    {fraction:.6}),/solid set references selected parents/);
});

test('legacy two-line solid records coexist with new one-line H8 and unchanged titled sets',()=>{
  const legacy=source().replace(/\*ELEMENT_SOLID\n([\s\S]*?)(?=\*SET_NODE_LIST_TITLE)/,(_,body)=>{
    return '*ELEMENT_SOLID (ten nodes format)\n'+body.trimEnd().split('\n').map(line=>
      line.slice(0,16)+'\n'+line.slice(16)+'       0       0').join('\n')+'\n';
  });
  const old=parseSolidOgridSource(legacy);
  const result=refineSolidOgridKeyword(legacy,{fraction:.6});
  const after=parseSolidOgridSource(result.keyword);
  assert.equal(after.solids.get(1).raw.length,2);
  assert.deepEqual(after.solids.get(1).raw,old.solids.get(1).raw);
  assert.equal(after.solids.get(result.report.newElementIds[0]).raw.length,1);
  assert.deepEqual(after.nodeSets,old.nodeSets);
});
