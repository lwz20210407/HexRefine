import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseMeshText} from '../dist/mesh-io.js';
import {H1_FACES} from '../dist/topology.js';

const script = fileURLToPath(new URL('../scripts/generate-transition-band.mjs', import.meta.url));
const q4Edges = [[1, 2], [2, 3], [3, 4], [4, 1]];
const fixtures = [
  ['PLANAR', 'Q1', 126, [48, 24, 12, 6], [24, 12]],
  ['PLANAR_ANNULAR', 'Q1', 336, [128, 64, 32, 16], [64, 32]],
  ['PLANAR_QUAD_FOUR', 'Q1', 436, [[54, 54], [20, 20], [8, 8], [4, 4]], [80, 32]],
  ['ANNULAR_RADIAL', 'H1', 672, [128, 64, 32, 16], [128, 64]],
  ['AXIAL_SURFACE', 'H1', 736, [64, 32, 16, 8], [64, 32]],
  ['AXIAL_SURFACE', 'H1', 1504, [108, 36, 12, 4], [72, 24]],
];

async function withFolder(run) {
  const base = path.resolve(os.tmpdir());
  const folder = await fs.mkdtemp(path.join(base, 'transitionmesh-v11-cli-'));
  try { await run(folder); }
  finally {
    assert.equal(path.dirname(folder), base);
    await fs.rm(folder, {recursive:true, force:true});
  }
}

function interfaceOwners(mesh, ids) {
  const selected = new Set(ids);
  const owners = new Map();
  const facets = mesh.kind === 'H1' ? H1_FACES : q4Edges;
  for (const conn of mesh.elements) for (const face of facets) {
    const nodes = face.map(i => conn[i - 1]);
    if (!nodes.every(n => selected.has(n))) continue;
    const key = nodes.sort((a,b) => a-b).join(':');
    owners.set(key, (owners.get(key) ?? 0) + 1);
  }
  return [...owners.values()];
}

for (const [mode, kind, count, counts, shared] of fixtures) {
  test(`V1.1 CLI ${mode} / ${count} from three stages`, async () => {
    await withFolder(async folder => {
      const run = (...args) => spawnSync(process.execPath, [script, ...args], {cwd:folder, encoding:'utf8'});
      const example = run('--example-v11', mode);
      assert.equal(example.status, 0, example.stderr);
      const request = JSON.parse(example.stdout);
      if (mode === 'AXIAL_SURFACE' && count === 1504) {
        request.parameters.fineSegments = 108;
        request.parameters.ratios = [3,3,3];
        request.regularRegions.fine.layers = 5;
      }
      const inFile = path.join(folder, 'case.json'), out = path.join(folder, 'mesh');
      const read = filename => fs.readFile(path.join(out, filename), 'utf8');
      await fs.writeFile(inFile, '\uFEFF' + JSON.stringify(request));
      const generated = run(inFile, out);
      assert.equal(generated.status, 0, generated.stderr);
      const [k, inp, report, sets, archived] = await Promise.all(
        ['mesh.k','mesh.inp','report.json','sets.json','request.json'].map(read));
      const keyword = parseMeshText(k, 'mesh.k');
      assert.deepEqual(keyword.elements, parseMeshText(inp, 'mesh.inp').elements);
      assert.equal(keyword.kind, kind);
      assert.equal(keyword.elements.length, count);
      const measured = JSON.parse(report);
      assert.equal(measured.adapter, 'transitionmesh-v11');
      assert.deepEqual(measured.plan.counts, counts);
      assert.ok(measured.quality.minimumCornerScaledJacobian > 0);
      if (kind === 'H1') assert.ok(measured.quality.minimumGaussDeterminant > 0);
      assert.deepEqual(JSON.parse(archived), request);
      const {nodeSets, cellSets} = JSON.parse(sets);
      for (const [i, n] of shared.entries()) {
        const owners = interfaceOwners(keyword, nodeSets[`interface_${i+1}`]);
        assert.equal(owners.length, n);
        assert.ok(owners.every(x => x === 2));
      }
      for (let i = 1; i <= 3; i++) assert.ok(cellSets[`stage_${i}`].length);
      assert.notEqual(run(inFile, out).status, 0);
      assert.equal(await read('mesh.k'), k);
    });
  });
}

test('V1.1 CLI rejects an unswept radial request without writing output', async () => {
  await withFolder(async folder => {
    const run = (...args) => spawnSync(process.execPath, [script, ...args], {cwd:folder, encoding:'utf8'});
    const request = JSON.parse(run('--example-v11', 'ANNULAR_RADIAL').stdout);
    delete request.extrusion;
    const input = path.join(folder, 'invalid.json'), output = path.join(folder, 'mesh');
    await fs.writeFile(input, JSON.stringify(request));
    const result = run(input, output);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ANNULAR_RADIAL requires extrusion/);
    await assert.rejects(fs.stat(output), {code:'ENOENT'});
  });
});
