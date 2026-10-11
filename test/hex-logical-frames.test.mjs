import test from 'node:test';
import assert from 'node:assert/strict';
import { createHexUnitCubeMesh } from '../dist/grid.js';
import { h1Permutations } from '../dist/topology.js';
import { recoverHexLogicalFrames } from '../dist/hex-logical-frames-internal.js';
import { inferHexElementLattice } from '../dist/regularization.js';
import { refineByElementIdsWithReport, checkNoHangingNodes } from '../dist/index.js';

function reorient(mesh, reflected = false) {
  return { ...mesh, elements: mesh.elements.map((e, i) => {
    if (i === 0) return [...e];
    const rotated = h1Permutations(e)[(i * 13) % 24];
    return reflected && i % 2 ? [0, 3, 2, 1, 4, 7, 6, 5].map(c => rotated[c]) : rotated;
  }) };
}

test('shared-face frame transport recovers all rotations and reflections on curved Hex blocks', () => {
  const source = createHexUnitCubeMesh(5, 4, 3);
  for (const reflected of [false, true]) {
    const mesh = reorient({ ...source, nodes: source.nodes.map(([x, y, z]) => [
      (2 + x) * Math.cos(2 * y), (2 + x) * Math.sin(2 * y), z + x * y
    ]) }, reflected);
    const before = structuredClone(mesh);
    const result = recoverHexLogicalFrames(mesh);
    assert.ok(result);
    assert.deepEqual(result.dimensions, [5, 4, 3]);
    assert.deepEqual(result.warnings, []);
    result.nodeCoordinates.forEach((p, i) => assert.deepEqual(p, source.nodes[i].map((v, a) => Math.round(v * [5, 4, 3][a]))));
    assert.deepEqual(mesh, before);
  }
});

test('shared-face frame transport keeps an incomplete connected lattice incomplete', () => {
  const base = createHexUnitCubeMesh(4, 4, 2);
  const elements = base.elements.filter(e => {
    const center = e.map(n => base.nodes[n - 1]).reduce((s, p) => s.map((v, a) => v + p[a] / 8), [0, 0, 0]);
    return center[0] < .5 || center[1] < .5;
  });
  const ids = [...new Set(elements.flat())].sort((a, b) => a - b);
  const map = new Map(ids.map((id, i) => [id, i + 1]));
  const mesh = reorient({ kind: 'H1', nodes: ids.map(id => base.nodes[id - 1]), elements: elements.map(e => e.map(n => map.get(n))) });
  const result = recoverHexLogicalFrames(mesh);
  assert.equal(result.indicesByElementId.size, 24);
  assert.deepEqual(result.dimensions, [4, 4, 2]);
  assert.match(result.warnings.join(' '), /do not fill/);
});

test('shared-face frame transport rejects a three-valent singular edge and invalid incidence', () => {
  const xy = [[0, 0], ...Array.from({ length: 6 }, (_, i) => [Math.cos(i * Math.PI / 3), Math.sin(i * Math.PI / 3)])];
  const nodes = [0, 1].flatMap(z => xy.map(p => [...p, z]));
  const quads = [[1, 2, 3, 4], [1, 4, 5, 6], [1, 6, 7, 2]];
  assert.equal(recoverHexLogicalFrames({ nodes, elements: quads.map(q => [...q, ...q.map(n => n + 7)]) }), undefined);
  const cube = createHexUnitCubeMesh(1, 1, 1);
  assert.equal(recoverHexLogicalFrames({ ...cube, elements: Array(3).fill(cube.elements[0]) }), undefined);
  assert.equal(recoverHexLogicalFrames({ ...cube, elements: [[...cube.elements[0].slice(0, 7), 1]] }), undefined);
});

test('mixed local frames refine a curved local box without changing core size or far field', () => {
  const source = createHexUnitCubeMesh(6, 6, 6);
  const nodes = source.nodes.map(([x, y, z]) => [(2 + x) * Math.cos(2 * y), (2 + x) * Math.sin(2 * y), z]);
  const mesh = reorient({ ...source, nodes });
  assert.match(inferHexElementLattice(mesh, 1e-9).warnings.join(' '), /coordinate-center lattice/);
  const selected = source.elements.flatMap((e, i) => {
    const p = e.map(n => source.nodes[n - 1]).reduce((s, p) => s.map((v, a) => v + p[a] / 8), [0, 0, 0]);
    return p.every(v => v > 1 / 3 && v < 2 / 3) ? [i + 1] : [];
  });
  const options = { hexRefinementRatio: 2, regularizeHexSelection: false, hexTwoToOneSelectionMode: 'local' };
  const baseline = refineByElementIdsWithReport({ ...source, nodes }, selected, options);
  const result = refineByElementIdsWithReport(mesh, selected, options);
  assert.equal(result.quality.ok, true);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
  assert.equal(result.mesh.elements.length, baseline.mesh.elements.length);
  assert.equal(result.summary.unchangedElementCount, baseline.summary.unchangedElementCount);
  for (const parent of selected) assert.equal(result.cellData.filter(c => c.parentElementId === parent).length, 8);
  result.cellData.forEach((c, i) => {
    if (c.role === 'unchanged') assert.deepEqual(result.mesh.elements[i], mesh.elements[c.parentElementId - 1]);
  });
});
