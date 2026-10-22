import type { Mesh, Point } from "../types.js";
import { H1_FACES, boundaryKey } from "../topology.js";
import { minimumHexCornerScaledJacobian, hexElementSignedVolume } from "../hex-quality.js";
import { hexJacobian } from "../hex-quality-internal.js";
import { checkNoHangingNodes } from "../conformance.js";
import { CINO_PRIMAL_SCHEMES, CINO_REFERENCE_COMMIT, CINO_REFERENCE_SHA256 } from "./cinolib-primal-data.js";

/** Reference-only primitives. No existing mesh, PID, core or far-field is installed here. */
export interface WeakBalanceReferenceTile { scheme: string; frame?: number }
type Primal = { points: number[][]; faces: number[][]; polys: number[][]; owners: number[][]; winds: boolean[][] };
const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const frames = permutations.flatMap(perm => [1, -1].flatMap(x => [1, -1].flatMap(y => [1, -1].map(z => {
  const signs = [x, y, z], inversions = perm.reduce((n, p, i) => n + perm.slice(i + 1).filter(q => p > q).length, 0);
  return { perm, signs, determinant: (-1) ** inversions * x * y * z };
}))));
const sorted = (values: Iterable<number>) => [...values].sort((a, b) => a - b);
const edges = (loop: readonly number[]) => loop.map((a, i) => sorted([a, loop[(i + 1) % loop.length]!]) as [number, number]);
function sameForward(a: readonly number[], b: readonly number[]) {
  return a.length === b.length && a.some((_, start) => a.every((v, i) => v === b[(start + i) % b.length]));
}
function cycleKey(values: readonly string[]) {
  return [values, [...values].reverse()].flatMap(loop => loop.map((_, i) => [...loop.slice(i), ...loop.slice(0, i)].join("|"))).sort()[0]!;
}
const determinant = ([a, b, c]: readonly number[][]) => a![0]! * (b![1]! * c![2]! - b![2]! * c![1]!) - a![1]! * (b![0]! * c![2]! - b![2]! * c![0]!) + a![2]! * (b![0]! * c![1]! - b![1]! * c![0]!);
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : Math.abs(a);

function assemble(tiles: readonly WeakBalanceReferenceTile[]): Primal {
  const result: Primal = { points: [], faces: [], polys: [], owners: [], winds: [] };
  const pointIds = new Map<string, number>(), faceIds = new Map<string, number>();
  tiles.forEach((tile, offset) => {
    if (!tile || Object.keys(tile).some(k => !["scheme", "frame"].includes(k))) throw new RangeError("unknown reference tile option");
    const data = CINO_PRIMAL_SCHEMES[tile.scheme], frameId = tile.frame ?? 0;
    if (!Object.hasOwn(CINO_PRIMAL_SCHEMES, tile.scheme) || !data) throw new RangeError("unknown primal scheme");
    if (!Number.isSafeInteger(frameId) || frameId < 0 || frameId >= 48) throw new RangeError("reference frame must be0..47");
    const frame = frames[frameId]!;
    const local = data.points.map(p => {
      const q = frame.perm.map((a, i) => frame.signs[i]! > 0 ? p[a]! : 20 - p[a]!); q[0]! += offset * 20;
      const key = q.join(","); let id = pointIds.get(key);
      if (id === undefined) { id = result.points.length; result.points.push(q); pointIds.set(key, id); }
      return id;
    });
    const mapping = data.faces.map(loop => {
      const mapped = loop.map(n => local[n]!), key = sorted(mapped).join(","); let id = faceIds.get(key), reverse = false;
      if (id === undefined) {
        id = result.faces.length; result.faces.push(mapped); result.owners.push([]); result.winds.push([]); faceIds.set(key, id);
      } else {
        const old = result.faces[id]!;
        if (!sameForward(old, mapped) && !sameForward(old, [...mapped].reverse())) throw new Error("crossed primal face cycles");
        reverse = !sameForward(old, mapped);
      }
      return { id, reverse };
    });
    data.polys.forEach((poly, index) => {
      const id = result.polys.length; result.polys.push(poly.map(f => mapping[f]!.id));
      poly.forEach((f, i) => {
        const target = mapping[f]!;
        let outward = data.winding[index]![i]!;
        if (frame.determinant < 0) outward = !outward;
        if (target.reverse) outward = !outward;
        result.owners[target.id]!.push(id); result.winds[target.id]!.push(outward);
      });
    });
  });
  result.faces.forEach((loop, f) => {
    const owners = result.owners[f]!, winds = result.winds[f]!;
    if (owners.length < 1 || owners.length > 2 || (owners.length === 2 && winds[0] === winds[1])) throw new Error("nonmanifold or inconsistently oriented primal face");
    if (owners.length === 1 && !boundaryPlane(loop.map(n => result.points[n]!), tiles.length * 20)) throw new Error("unmatched internal primal face: incompatible neighbouring partitions");
  });
  return result;
}

function boundaryPlane(points: readonly number[][], xmax: number): string | null {
  const planes = [0, 1, 2].flatMap(a => [0, a === 0 ? xmax : 20].filter(side => points.every(p => p[a] === side)).map(side => `${a}:${side / 20}`));
  return planes.length === 1 ? planes[0]! : null;
}

function cubeOrder(graph: Map<number, Set<number>>, nodes: Point[]): number[] {
  if (graph.size !== 8 || [...graph.values()].some(n => n.size !== 3)) throw new Error("primal vertex does not have an eight-node cubic dual graph");
  const intersection = (a: number, b: number, omit: number) => sorted([...graph.get(a)!].filter(n => n !== omit && graph.get(b)!.has(n)));
  for (const zero of sorted(graph.keys())) {
    const adjacent = sorted(graph.get(zero)!);
    for (const perm of permutations) {
      const [one, three, four] = perm.map(i => adjacent[i]!) as [number, number, number];
      const two = intersection(one, three, zero), five = intersection(one, four, zero), seven = intersection(three, four, zero);
      if (two.length !== 1 || five.length !== 1 || seven.length !== 1) continue;
      const six = sorted([...graph.get(two[0]!)!].filter(n => graph.get(five[0]!)!.has(n) && graph.get(seven[0]!)!.has(n)));
      if (six.length !== 1) continue;
      const order = [zero, one, two[0]!, three, four, five[0]!, six[0]!, seven[0]!];
      if (new Set(order).size !== 8) continue;
      // Explicit graph verification avoids accepting an unrelated cubic graph.
      const hexEdges = [...H1_FACES.flatMap(face => edges(face.map(n => order[n - 1]!)))];
      if (hexEdges.some(([a, b]) => !graph.get(a)!.has(b))) continue;
      if (minimumHexCornerScaledJacobian(order.map(n => nodes[n]!)) > 0) return order;
    }
  }
  throw new Error("cubic dual graph has no positive corner-Jacobian ordering");
}

/**
 * Joint clipped dual of one unit primal brick or two X-adjacent bricks.
 * Exact integer-twentieth primal entities, not geometric tolerance welding.
 * Experimental deep import only; deliberately absent from the public index.
 */
export function buildWeakBalanceReference(tiles: readonly WeakBalanceReferenceTile[]) {
  if (!Array.isArray(tiles) || tiles.length < 1 || tiles.length > 2) throw new RangeError("reference requires one or two X-adjacent unit tiles");
  const primal = assemble(tiles), boundary = new Set(primal.owners.flatMap((o, i) => o.length === 1 ? [i] : []));
  const edgeFaces = new Map<string, { ends: [number, number]; faces: number[] }>();
  primal.faces.forEach((loop, f) => edges(loop).forEach(ends => {
    const key = ends.join(","), entry = edgeFaces.get(key) ?? { ends, faces: [] };
    entry.faces.push(f); edgeFaces.set(key, entry);
  }));
  const plane = (f: number) => boundaryPlane(primal.faces[f]!.map(n => primal.points[n]!), 20 * tiles.length)!;
  const sharp = [...edgeFaces.values()].filter(e => {
    const surface = e.faces.filter(f => boundary.has(f));
    return surface.length === 2 && plane(surface[0]!) !== plane(surface[1]!);
  }).sort((a, b) => a.ends[0] - b.ends[0] || a.ends[1] - b.ends[1]);
  const nodes: Point[] = [], rationalPointKeys: string[] = [];
  const centroid = (ids: readonly number[]) => {
    const sums = [0, 1, 2].map(a => ids.reduce((n, id) => n + primal.points[id]![a]!, 0)), denominator = 20 * ids.length;
    const id = nodes.length;
    nodes.push(sums.map(n => n / denominator));
    rationalPointKeys.push(sums.map(n => { const g = gcd(n, denominator); return `${n / g}/${denominator / g}`; }).join(","));
    return id;
  };
  const polyDual = primal.polys.map(poly => centroid(sorted(new Set(poly.flatMap(f => primal.faces[f]!)))));
  const faceDual = new Map([...boundary].map(f => [f, centroid(primal.faces[f]!)]));
  const edgeDual = new Map(sharp.map(e => [e.ends.join(","), centroid(e.ends)]));
  const vertexDual = new Map<number, number>();
  primal.points.forEach((_, v) => { if (sharp.filter(e => e.ends.includes(v)).length > 2) vertexDual.set(v, centroid([v])); });
  const elements = primal.points.map((_, v) => {
    const graph = new Map<number, Set<number>>();
    const include = (id: number) => { if (!graph.has(id)) graph.set(id, new Set()); };
    const connect = (a: number, b: number) => { include(a); include(b); graph.get(a)!.add(b); graph.get(b)!.add(a); };
    primal.faces.forEach((loop, f) => {
      if (!loop.includes(v)) return;
      const owners = primal.owners[f]!;
      if (owners.length === 2) connect(polyDual[owners[0]!]!, polyDual[owners[1]!]!);
      else connect(polyDual[owners[0]!]!, faceDual.get(f)!);
    });
    for (const [key, edge] of edgeFaces) {
      if (!edge.ends.includes(v)) continue;
      const surface = edge.faces.filter(f => boundary.has(f));
      if (surface.length !== 2) continue;
      const a = faceDual.get(surface[0]!)!, b = faceDual.get(surface[1]!)!, middle = edgeDual.get(key);
      if (middle === undefined) connect(a, b);
      else { connect(a, middle); connect(b, middle); }
    }
    const incident = sharp.filter(e => e.ends.includes(v)).map(e => edgeDual.get(e.ends.join(","))!);
    const corner = vertexDual.get(v);
    if (corner !== undefined) incident.forEach(id => connect(corner, id));
    else if (incident.length === 2) connect(incident[0]!, incident[1]!);
    return cubeOrder(graph, nodes).map(n => n + 1);
  });
  const mesh: Mesh = { kind: "H1", nodes, elements };
  let volume = 0, minimumCornerSJ = Infinity, minimumGaussDeterminant = Infinity;
  const faceOwners = new Map<string, { nodes: number[]; count: number }>();
  elements.forEach(e => {
    const p = e.map(n => nodes[n - 1]!); volume += hexElementSignedVolume(p);
    minimumCornerSJ = Math.min(minimumCornerSJ, minimumHexCornerScaledJacobian(p));
    for (const u of [-1 / Math.sqrt(3), 1 / Math.sqrt(3)]) for (const v of [-1 / Math.sqrt(3), 1 / Math.sqrt(3)]) for (const w of [-1 / Math.sqrt(3), 1 / Math.sqrt(3)]) minimumGaussDeterminant = Math.min(minimumGaussDeterminant, determinant(hexJacobian(p, u, v, w)));
    H1_FACES.forEach(f => {
      const loop = f.map(n => e[n - 1]!), key = boundaryKey(loop), old = faceOwners.get(key);
      if (!old) faceOwners.set(key, { nodes: loop, count: 1 });
      else {
        if (++old.count > 2 || (!sameForward(old.nodes, loop) && !sameForward(old.nodes, [...loop].reverse()))) throw new Error("nonmanifold or crossed H8 face");
      }
    });
  });
  const boundaryPartitions: Record<string, string[]> = {}, surfaceEdges = new Map<string, number>(), surfaceVertices = new Set<number>();
  for (const face of faceOwners.values()) if (face.count === 1) {
    const planeId = boundaryPlane(face.nodes.map(n => nodes[n - 1]!.map(x => x * 20)), 20 * tiles.length);
    if (planeId === null) throw new Error("unexpected internal free H8 face");
    (boundaryPartitions[planeId] ??= []).push(cycleKey(face.nodes.map(n => rationalPointKeys[n - 1]!)));
    face.nodes.forEach(n => surfaceVertices.add(n));
    edges(face.nodes).forEach(e => { const key = e.join(","); surfaceEdges.set(key, (surfaceEdges.get(key) ?? 0) + 1); });
  }
  const boundaryCount = Object.values(boundaryPartitions).reduce((n, p) => n + p.length, 0);
  if (Object.keys(boundaryPartitions).length !== 6 || [...surfaceEdges.values()].some(n => n !== 2) || surfaceVertices.size - surfaceEdges.size + boundaryCount !== 2) throw new Error("reference boundary is not a closed quad sphere");
  Object.values(boundaryPartitions).forEach(p => p.sort());
  if (!(minimumCornerSJ > 0 && minimumGaussDeterminant > 0) || Math.abs(volume - tiles.length) > 1e-10 || !checkNoHangingNodes(mesh, 1e-10).ok) throw new Error("reference dual failed quality, volume or conformance");
  const interfaceBridgingHexes = tiles.length === 1 ? 0 : elements.filter(e => e.some(n => nodes[n - 1]![0]! < 1) && e.some(n => nodes[n - 1]![0]! > 1)).length;
  if (tiles.length === 2 && interfaceBridgingHexes === 0) throw new Error("joint dual did not cross the primal interface");
  return { mesh, rationalPointKeys, boundaryPartitions, certificate: {
    scope: "reference-only-joint-primal-dual", sourceCommit: CINO_REFERENCE_COMMIT, sourceSha256: CINO_REFERENCE_SHA256,
    tiles: tiles.map(t => ({ scheme: t.scheme, frame: t.frame ?? 0 })), primalVertices: primal.points.length, primalPolyhedra: primal.polys.length,
    hexes: elements.length, nodes: nodes.length, volume, minimumCornerSJ, minimumGaussDeterminant, interfaceBridgingHexes,
    boundaryFaceCounts: Object.fromEntries(Object.entries(boundaryPartitions).map(([key, faces]) => [key, faces.length])),
    readyForOriginalMeshInstaller: false, engineeringAcceptanceVerified: false,
    limitation: "No original coarse/fine interface, protected core, far-field ID, physical mapping or solver-state preservation is certified. Corner/Gauss samples are not global Jacobian positivity proofs."
  } };
}

export const weakBalanceReferenceSchemeNames: readonly string[] = Object.freeze(Object.keys(CINO_PRIMAL_SCHEMES));
