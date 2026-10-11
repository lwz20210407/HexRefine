import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMeshText } from '../dist/index.js';

const points=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const integer=n=>String(n).padStart(8);
const coordinate=n=>(n?'1.000000e+00':'0.000000e+00').padStart(16);

test('K import separates fixed-width coordinates from adjacent decimal constraint fields',()=>{
  const nodes=points.map((p,i)=>integer(i+1)+p.map(coordinate).join('')+'0.0000000.000000');
  const mesh=parseMeshText(['*NODE',...nodes,'*ELEMENT_SOLID','1,1,1,2,3,4,5,6,7,8','*END'].join('\n'),'repair.k');
  assert.deepEqual(mesh.nodes,points);
});

test('K fixed-width node records retain blank zero coordinates even when flags add tokens',()=>{
  const nodes=points.map((p,i)=>integer(i+1)+p.map(n=>n?coordinate(n):' '.repeat(16)).join('')+integer(2)+integer(3));
  const mesh=parseMeshText(['*NODE',...nodes,'*ELEMENT_SOLID','1,1,1,2,3,4,5,6,7,8','*END'].join('\n'),'blank.k');
  assert.deepEqual(mesh.nodes,points);
});

for(const multiline of [false,true])test(`K import parses adjacent eight-column solid IDs (multiline=${multiline})`,()=>{
  const ids=points.map((_,i)=>10000001+i);
  const nodes=points.map((p,i)=>[ids[i],...p].join(','));
  const head=[20000001,1].map(integer).join('');
  const body=ids.map(integer).join('');
  const mesh=parseMeshText(['*NODE',...nodes,'*ELEMENT_SOLID',head+(multiline?'\n':'')+body,'*END'].join('\n'),'fixed.k');
  assert.deepEqual(mesh.elements,[[1,2,3,4,5,6,7,8]]);
});
