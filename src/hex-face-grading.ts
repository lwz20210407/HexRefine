import type { Mesh } from "./types.js";
import { H1_FACES, boundaryKey } from "./topology.js";

export interface HexFaceGradingOptions {
  /** Review pairs incident to these1-based elements; topology is still checked globally. */
  reviewElementIds?: readonly number[];
  maximumNormalSizeRatio?: number;
  maximumWitnesses?: number;
}

export interface HexFaceGradingWitness {
  elementIds: [number, number];
  localFaceIds: [number, number];
  faceNodeIds: number[];
  normalSizeRatio: number;
  nonOrthogonalityDegrees: number;
  centroidsOnSameSide: boolean;
}

export interface HexFaceGradingReport {
  elementCount: number;
  interiorFacePairs: number;
  boundaryFaces: number;
  reviewedFacePairs: number;
  selection: "all-pairs" | "incident-to-reviewed-elements";
  maximumNormalSizeRatio: number | null;
  maximumNonOrthogonalityDegrees: number | null;
  undefinedMetricPairs: number;
  centroidsOnSameSidePairs: number;
  requestedNormalSizeLimit: number | null;
  aboveRequestedLimitPairs: number | null;
  /** Null without a requested limit; undefined metrics/same-side warnings prevent certification. */
  requestedLimitVerified: boolean | null;
  worstNormalSizePairs: HexFaceGradingWitness[];
  worstNonOrthogonalityPairs: HexFaceGradingWitness[];
  undefinedWitnesses: Array<{ elementIds: [number, number]; faceNodeIds: number[]; reason: string }>;
  engineeringAcceptanceVerified: false;
  method: string;
  limitation: string;
}

const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: readonly number[], b: readonly number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];

function sameCycle(a: readonly number[], b: readonly number[]): boolean {
  const start = b.indexOf(a[0]!);
  return start >= 0 && [1, -1].some(direction => a.every((v, i) => v === b[(start + direction * i + 8) % 4]));
}

function pairGeometry(mesh: Mesh, first: number, second: number, face: readonly number[]) {
  const origin = mesh.nodes[face[0]! - 1]!;
  const relative = (node: number) => mesh.nodes[node - 1]!.map((v, a) => v - origin[a]!);
  const raw = face.map(relative);
  const scale = raw.reduce((largest, p) => Math.max(largest, ...p.map(Math.abs)), 0);
  if (!(scale > 0) || !Number.isFinite(scale)) return { reason: "zero or unrepresentable face scale" };
  const q = raw.map(p => p.map(v => v / scale));
  // Cross-diagonals give the integrated bilinear area vector without squaring
  // physical lengths, which can overflow or underflow on otherwise finite input.
  const area = cross(q[2]!, q[3]!.map((v, a) => v - q[1]![a]!));
  const magnitude = Math.hypot(...area);
  if (!(magnitude > 0) || !Number.isFinite(magnitude)) return { reason: "zero or unrepresentable face area vector" };
  const normal = area.map(v => v / magnitude), center = [0, 1, 2].map(a => q.reduce((sum, p) => sum + p[a]! / 4, 0));
  const centroid = (element: number) => {
    const points = mesh.elements[element]!.map(relative);
    return [0, 1, 2].map(a => points.reduce((sum, p) => sum + (p[a]! / scale) / 8, 0) - center[a]!);
  };
  const a = centroid(first), b = centroid(second), da = dot(a, normal), db = dot(b, normal);
  if (![...a, ...b, da, db].every(Number.isFinite) || da === 0 || db === 0) return { reason: "zero or unrepresentable centroid standoff" };
  const ratio = Math.max(Math.abs(da), Math.abs(db)) / Math.min(Math.abs(da), Math.abs(db));
  const delta = b.map((v, i) => v - a[i]!), length = Math.hypot(...delta);
  const sameSide = Math.sign(da) === Math.sign(db);
  if (!Number.isFinite(ratio) || !(length > 0) || !Number.isFinite(length)) return { reason: "unrepresentable size ratio or centroid separation", sameSide };
  const cosine = Math.min(1, Math.max(0, Math.abs(dot(delta, normal)) / length));
  return { ratio, angle: Math.acos(cosine) * 180 / Math.PI, sameSide };
}

/** Exact node-ID face adjacency with geometric measurements, NOT a mesh-acceptance gate. */
export function auditHexFaceGrading(mesh: Mesh, options: HexFaceGradingOptions = {}): HexFaceGradingReport {
  if (Object.keys(options).some(key => !["reviewElementIds", "maximumNormalSizeRatio", "maximumWitnesses"].includes(key))) throw new RangeError("unknown face-grading option");
  const limit = options.maximumNormalSizeRatio, capacity = options.maximumWitnesses ?? 8;
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) throw new RangeError("maximumNormalSizeRatio must be finite and at least1");
  if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > 32) throw new RangeError("maximumWitnesses must be an integer from0 to32");
  if (mesh.kind !== undefined && mesh.kind !== "H1") throw new RangeError("face grading requires H8 elements");
  if (mesh.nodes.some(p => p.length !== 3 || p.some(v => !Number.isFinite(v)))) throw new RangeError("face grading requires finite3D coordinates");
  for (const [i, e] of mesh.elements.entries()) if (e.length !== 8 || new Set(e).size !== 8 || e.some(n => !Number.isSafeInteger(n) || n < 1 || n > mesh.nodes.length)) throw new RangeError(`invalid H8 connectivity at element${i + 1}`);
  const ids = options.reviewElementIds;
  if (ids !== undefined && (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(id) || id < 1 || id > mesh.elements.length))) throw new RangeError("invalid reviewElementIds");
  const selected = ids === undefined ? null : new Set(ids);
  const report: HexFaceGradingReport = {
    elementCount: mesh.elements.length, interiorFacePairs: 0, boundaryFaces: 0, reviewedFacePairs: 0,
    selection: selected === null ? "all-pairs" : "incident-to-reviewed-elements",
    maximumNormalSizeRatio: null, maximumNonOrthogonalityDegrees: null, undefinedMetricPairs: 0,
    centroidsOnSameSidePairs: 0, requestedNormalSizeLimit: limit ?? null, aboveRequestedLimitPairs: limit === undefined ? null : 0,
    requestedLimitVerified: null, worstNormalSizePairs: [], worstNonOrthogonalityPairs: [], undefinedWitnesses: [],
    engineeringAcceptanceVerified: false,
    method: "Ratio of absolute vertex-centroid standoffs to the shared quad's integrated bilinear area-vector plane; centroid-line nonorthogonality.",
    limitation: "Only identical node-ID quad faces are paired. Unpaired faces are not classified as physical or hanging boundaries. Measurements on warped/concave cells are not rigorous thickness, overlap or engineering certificates."
  };
  const keep = (list: HexFaceGradingWitness[], value: HexFaceGradingWitness, metric: "normalSizeRatio" | "nonOrthogonalityDegrees") => {
    if (!capacity) return;
    const compare = (a: HexFaceGradingWitness, b: HexFaceGradingWitness) => b[metric] - a[metric] || a.elementIds[0] - b.elementIds[0] || a.elementIds[1] - b.elementIds[1];
    if (list.length === capacity && compare(value, list[list.length - 1]!) >= 0) return;
    list.push(value); list.sort(compare); if (list.length > capacity) list.pop();
  };
  // Positive entry encodes the first owner/face, negative means already paired.
  // Retaining that marker also detects a third owner instead of hiding it.
  const owners = new Map<string, number>();
  mesh.elements.forEach((e, second) => H1_FACES.forEach((f, secondFace) => {
    const nodes = f.map(n => e[n - 1]!), key = boundaryKey(nodes), owner = owners.get(key);
    if (owner === undefined) { owners.set(key, second * 6 + secondFace + 1); return; }
    if (owner < 0) throw new RangeError(`nonmanifold shared quad at element${second + 1}`);
    const first = Math.floor((owner - 1) / 6), firstFace = (owner - 1) % 6;
    const firstNodes = H1_FACES[firstFace]!.map(n => mesh.elements[first]![n - 1]!);
    if (!sameCycle(firstNodes, nodes)) throw new RangeError(`incompatible shared-face cycles at elements${first + 1},${second + 1}`);
    owners.set(key, -owner); report.interiorFacePairs++;
    if (selected !== null && !selected.has(first + 1) && !selected.has(second + 1)) return;
    report.reviewedFacePairs++;
    const result = pairGeometry(mesh, first, second, firstNodes);
    if ("reason" in result) {
      report.undefinedMetricPairs++;
      if ("sameSide" in result && result.sameSide) report.centroidsOnSameSidePairs++;
      if (report.undefinedWitnesses.length < capacity) report.undefinedWitnesses.push({ elementIds: [first + 1, second + 1], faceNodeIds: firstNodes, reason: result.reason! });
      return;
    }
    report.maximumNormalSizeRatio = Math.max(report.maximumNormalSizeRatio ?? 1, result.ratio);
    report.maximumNonOrthogonalityDegrees = Math.max(report.maximumNonOrthogonalityDegrees ?? 0, result.angle);
    if (result.sameSide) report.centroidsOnSameSidePairs++;
    if (limit !== undefined && result.ratio > limit) report.aboveRequestedLimitPairs!++;
    const witness: HexFaceGradingWitness = { elementIds: [first + 1, second + 1], localFaceIds: [firstFace + 1, secondFace + 1], faceNodeIds: firstNodes,
      normalSizeRatio: result.ratio, nonOrthogonalityDegrees: result.angle, centroidsOnSameSide: result.sameSide };
    keep(report.worstNormalSizePairs, witness, "normalSizeRatio"); keep(report.worstNonOrthogonalityPairs, witness, "nonOrthogonalityDegrees");
  }));
  report.boundaryFaces = 6 * mesh.elements.length - 2 * report.interiorFacePairs;
  if (limit !== undefined) report.requestedLimitVerified = report.reviewedFacePairs > 0 && report.undefinedMetricPairs === 0 && report.centroidsOnSameSidePairs === 0 && report.aboveRequestedLimitPairs === 0;
  return report;
}
