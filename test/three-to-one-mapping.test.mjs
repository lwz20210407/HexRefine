import test from 'node:test';
import assert from 'node:assert/strict';
import { refineHexTo4Hex, refineHexTo5Hex, refineHexTo13Hex } from '../dist/templates.js';
import { auditHexRefinementQuality } from '../dist/hex-quality.js';

const cube = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
function mapped(vertices, [u,v,w]) {
  const weights = [(1-u)*(1-v)*(1-w),u*(1-v)*(1-w),u*v*(1-w),(1-u)*v*(1-w),(1-u)*(1-v)*w,u*(1-v)*w,u*v*w,(1-u)*v*w];
  return [0,1,2].map(a=>vertices.reduce((s,p,i)=>s+weights[i]*p[a],0));
}
const factories = [refineHexTo4Hex, refineHexTo5Hex, refineHexTo13Hex];
for (const factory of factories) {
  test(`${factory.name} maps its reference nodes from the original warped parent`, () => {
    const vertices = cube.map(([x,y,z])=>[x + .23*y*z, y + .19*x*z, z + .17*x*y]);
    const reference = factory(cube, 1e-12);
    const result = factory(vertices, 1e-12);
    assert.deepEqual(result.elements, reference.elements);
    assert.equal(result.nodes.length, reference.nodes.length);
    result.nodes.forEach((p,i)=>{
      const expected = mapped(vertices, reference.nodes[i]);
      assert.ok(Math.hypot(...p.map((v,a)=>v-expected[a])) < 1e-12, `reference node ${i+1} deviates from the parent map`);
    });
  });
  test(`${factory.name} preserves volume in a tapered extruded parent`, () => {
    const vertices = cube.map(([x,y,z])=>[x*(1-.75*y), y, z]);
    const result = factory(vertices, 1e-12);
    const quality = auditHexRefinementQuality(vertices, result);
    assert.equal(quality.ok, true);
    assert.ok(quality.relativeVolumeError < 1e-12);
  });
}
