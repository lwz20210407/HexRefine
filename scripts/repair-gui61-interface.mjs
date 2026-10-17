import fs from 'node:fs/promises';
import path from 'node:path';
import {
  repairGui61FiveHexInterfaces, meshToLsdynaMixedKeyword,
  parseNativeLsdynaMixedKeyword, checkNoHangingNodes, minElementEdgeLength
} from '../dist/index.js';

async function main() {
  const [inputPath, outputPath, ...extra] = process.argv.slice(2);
  if (!inputPath || !outputPath || extra.length)
    throw new Error('Usage: node scripts/repair-gui61-interface.mjs request.json NEW_OUTPUT_DIRECTORY');
  const request = JSON.parse(await fs.readFile(path.resolve(inputPath), 'utf8'));
  if (!request || request.schemaVersion !== 1 || !request.mesh || !request.repair
      || Object.keys(request).some(k => !['schemaVersion', 'mesh', 'repair'].includes(k))
      || Object.keys(request.mesh).some(k => !['kind', 'nodes', 'elements'].includes(k))
      || Object.keys(request.repair).some(k => !['parentElementIds', 'tolerance', 'partIds'].includes(k)))
    throw new Error('Expected schemaVersion=1 with mesh and repair; solver metadata is not accepted');
  const result = repairGui61FiveHexInterfaces(request.mesh, request.repair);
  const model = {
    nodes: result.mesh.nodes,
    solids: result.mesh.elements.map((nodes, i) => ({
      id: i + 1,
      partId: request.repair.partIds?.[result.parentElementIds[i] - 1] ?? 1,
      nodes
    })),
    beams: []
  };
  const keyword = meshToLsdynaMixedKeyword(model, {coordinateFormat: 'compact'});
  const back = parseNativeLsdynaMixedKeyword(keyword);
  if (JSON.stringify(back.solids) !== JSON.stringify(model.solids))
    throw new Error('Repair K connectivity/PID read-back failed');
  const maxError = back.nodes.reduce((error, p, i) =>
    Math.max(error, Math.hypot(...p.map((v, a) => v - model.nodes[i][a]))), 0);
  if (maxError > minElementEdgeLength(result.mesh) * 1e-8
      || !checkNoHangingNodes({kind: 'H1', nodes: back.nodes, elements: back.solids.map(e => e.nodes)}, request.repair.tolerance).ok)
    throw new Error('Repair K rounding/conformance read-back failed');
  const report = {
    schemaVersion: 1, implementation: 'typescript-native-five-hex-repair',
    inputNodes: request.mesh.nodes.length, outputNodes: result.mesh.nodes.length,
    inputElements: request.mesh.elements.length, outputElements: result.mesh.elements.length,
    repairedParentIds: result.repairedParentIds, addedNodeIds: result.addedNodeIds,
    quality: result.quality, readbackMaximumCoordinateError: maxError,
    numbering: 'Dense input node IDs preserved. Output EIDs are dense; lineage maps to dense input parent IDs, not source K EIDs.',
    partIds: request.repair.partIds ? 'Inherited through parent lineage' : 'Explicit default PID 1',
    scope: 'Mesh-only NODE/SOLID. No solver cards, beam/shell elements or sets are imported or inferred.'
  };
  const output = path.resolve(outputPath);
  await fs.mkdir(path.dirname(output), {recursive: true});
  await fs.mkdir(output); // Never overwrite a previous case or the input.
  for (const [name, text] of Object.entries({
    'mesh.k': keyword, 'mesh.json': JSON.stringify(result.mesh),
    'lineage.json': JSON.stringify({parentElementIds: result.parentElementIds}),
    'report.json': JSON.stringify(report, null, 2)
  })) await fs.writeFile(path.join(output, name), text, {flag: 'wx'});
  process.stdout.write(JSON.stringify(report) + '\n');
}
main().catch(error => { process.stderr.write(JSON.stringify({ok: false, error: error.message}) + '\n'); process.exitCode = 1; });
