import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { performance } from "node:perf_hooks";
import {
  createHexUnitCubeMesh, createRefinementSession, buildActiveMeshWithMap,
  refineSessionPatch, normalizeTwoToOneCompensation
} from "../dist/index.js";
import { planRefinementSessionHistoryTransaction } from "../dist/refinement-session.js";

const farDimension = Number(process.argv[2] ?? 14);
const output = resolve(process.argv[3] ?? `release/benchmarks/history-locality-${farDimension}.json`);
if (!Number.isSafeInteger(farDimension) || farDimension < 0 || farDimension > 100) {
  throw new Error("far-field dimension must be an integer from 0 to 100");
}

const started = performance.now();
const component = createHexUnitCubeMesh(7, 7, 7);
const far = farDimension > 0 ? createHexUnitCubeMesh(farDimension, farDimension, farDimension) : undefined;
const mesh = far === undefined ? component : {
  kind: "H1",
  nodes: [...component.nodes, ...far.nodes.map(([x, y, z]) => [
    x * farDimension / 7 + 2, y * farDimension / 7, z * farDimension / 7
  ])],
  elements: [...component.elements, ...far.elements.map((element) => element.map((id) => id + component.nodes.length))]
};
const session = createRefinementSession(mesh);
const core = [];
for (let k = 2; k <= 4; k += 1) {
  for (let j = 2; j <= 4; j += 1) {
    for (let i = 2; i <= 4; i += 1) core.push(`e${1 + i + j * 7 + k * 49}`);
  }
}
const options = {
  hexRefinementRatio: 2, hexTwoToOneSelectionMode: "local", includeTransitions: true,
  mergeTolerance: 1e-9
};
refineSessionPatch(session, core, options);
// Same fixed boundary-core cell as the conformance regression fixture.
const selected = ["e115/2"];
if (session.cells.get(selected[0])?.role !== "selected") throw new Error("benchmark fixture changed");
const activeBuild = buildActiveMeshWithMap(session, { mergeNodes: true, mergeTolerance: 1e-9 });
const geometry = activeBuild.geometryResolution;
const compensation = normalizeTwoToOneCompensation(1, options);
const resolvedOptions = {
  ...options, activeBuild, hexTwoToOneCompensation: compensation,
  normalizedTwoToOneCompensation: compensation
};
const faceResolution = {
  ...geometry, mergeTolerance: 1e-9,
  tolerance: Math.max(1e-9, geometry.minimumElementEdgeLength * 1e-8, geometry.coordinateScale * Number.EPSILON * 64)
};
const setupMs = performance.now() - started;
const samples = [];
for (const phase of ["cold", "warm"]) {
  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  const plan = planRefinementSessionHistoryTransaction(session, selected, resolvedOptions, faceResolution);
  samples.push({
    phase, elapsedMs: performance.now() - start,
    heapBeforeBytes: heapBefore, heapAfterBytes: process.memoryUsage().heapUsed,
    audit: plan.conformanceAudit, overlay: plan.overlayStats,
    localElementCount: plan.localBuild.mesh.elements.length,
    totalOutputElementCount: plan.preview.summary.outputElementCount
  });
}
const report = {
  nodeVersion: process.version, platform: process.platform,
  farDimension, farElementCount: farDimension ** 3,
  coarseCellSpacing: 1 / 7,
  activeInputElements: session.activeLeafIds.size, setupMs, samples,
  maxRssKiB: process.resourceUsage().maxRSS,
  scope: "Synthetic disconnected far field with aligned coarse-cell spacing; reports total internal history-planner time, not solver or export time."
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
