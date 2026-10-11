import type { Mesh } from "./types.js";
import { H1_FACES, boundaryKey } from "./topology.js";

type Index3 = [number, number, number];

export interface HexLogicalFrameRecovery {
  nodeCoordinates: Index3[];
  indicesByElementId: Map<number, Index3>;
  elementIdByKey: Map<string, number>;
  dimensions: Index3;
  warnings: string[];
}

const CORNERS: readonly Index3[] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
];
const FACES = H1_FACES.map(face => face.map(corner => corner - 1));

/** Transport discrete cube frames through shared faces, without physical-axis guesses. */
export function recoverHexLogicalFrames(mesh: Mesh): HexLogicalFrameRecovery | undefined {
  if (!mesh.elements.length) return undefined;
  const incidence = new Map<string, Array<{ element: number; face: number }>>();
  for (const [element, nodes] of mesh.elements.entries()) {
    if (nodes.length !== 8 || new Set(nodes).size !== 8
      || nodes.some(n => !Number.isInteger(n) || n < 1 || n > mesh.nodes.length)) {
      return undefined;
    }
    for (const [face, corners] of FACES.entries()) {
      const key = boundaryKey(corners.map(c => nodes[c]!));
      const owners = incidence.get(key) ?? [];
      owners.push({ element, face });
      if (owners.length > 2) return undefined;
      incidence.set(key, owners);
    }
  }
  const frames: Array<Index3[] | undefined> = new Array(mesh.elements.length).fill(undefined);
  const logical: Array<Index3 | undefined> = new Array(mesh.nodes.length).fill(undefined);
  const occupied = new Set<string>();
  const queue: number[] = [];
  const assign = (element: number, frame: Index3[]): boolean => {
    if (!isCubeFrame(frame)) return false;
    const existing = frames[element];
    if (existing) return existing.every((p, i) => equal(p, frame[i]!));
    const origin = [0, 1, 2].map(a => Math.min(...frame.map(p => p[a]!))) as Index3;
    if (occupied.has(origin.join(","))) return false;
    for (const [corner, node] of mesh.elements[element]!.entries()) {
      if (logical[node - 1] && !equal(logical[node - 1]!, frame[corner]!)) return false;
    }
    occupied.add(origin.join(","));
    frames[element] = frame;
    mesh.elements[element]!.forEach((n, c) => { logical[n - 1] = frame[c]!; });
    queue.push(element);
    return true;
  };
  if (!assign(0, CORNERS.map(p => [...p]))) return undefined;
  for (let offset = 0; offset < queue.length; offset += 1) {
    const element = queue[offset]!;
    const nodes = mesh.elements[element]!;
    const frame = frames[element]!;
    for (const [face, corners] of FACES.entries()) {
      const owners = incidence.get(boundaryKey(corners.map(c => nodes[c]!)))!;
      const neighbor = owners.find(owner => owner.element !== element);
      if (!neighbor) continue;
      const axis = [0, 1, 2].find(a => corners.every(c => frame[c]![a] === frame[corners[0]!]![a]))!;
      const plane = frame[corners[0]!]![axis]!;
      const minimum = Math.min(...frame.map(p => p[axis]!));
      const step = plane === minimum ? -1 : 1;
      const otherNodes = mesh.elements[neighbor.element]!;
      const otherFace = FACES[neighbor.face]!;
      const otherAxis = [0, 1, 2].find(a => otherFace.every(c => CORNERS[c]![a] === CORNERS[otherFace[0]!]![a]))!;
      const otherFrame = CORNERS.map((corner, c) => {
        const onFace = otherFace.find(f => CORNERS[f]!.every((v, a) => a === otherAxis || v === corner[a]));
        if (onFace === undefined) throw new Error("invalid Hex face corner table");
        const sharedNode = otherNodes[onFace]!;
        const p = frame[nodes.indexOf(sharedNode)]!;
        const result: Index3 = [...p];
        if (!otherFace.includes(c)) result[axis] = result[axis]! + step;
        return result;
      });
      if (!assign(neighbor.element, otherFrame)) return undefined;
    }
  }
  if (queue.length !== mesh.elements.length || logical.some(p => !p)) return undefined;
  const points = logical as Index3[];
  const minimum: Index3 = [Infinity, Infinity, Infinity];
  for (const p of points) for (const a of [0, 1, 2] as const) minimum[a] = Math.min(minimum[a], p[a]);
  const normalized = points.map(p => p.map((v, a) => v - minimum[a]!) as Index3);
  const dimensions: Index3 = [0, 0, 0];
  for (const p of normalized) for (const a of [0, 1, 2] as const) dimensions[a] = Math.max(dimensions[a], p[a]);
  const indicesByElementId = new Map<number, Index3>();
  const elementIdByKey = new Map<string, number>();
  mesh.elements.forEach((nodes, index) => {
    const origin = [0, 1, 2].map(a => Math.min(...nodes.map(n => normalized[n - 1]![a]!))) as Index3;
    indicesByElementId.set(index + 1, origin);
    elementIdByKey.set(origin.join(","), index + 1);
  });
  return {
    nodeCoordinates: normalized, indicesByElementId, elementIdByKey, dimensions,
    warnings: dimensions[0] * dimensions[1] * dimensions[2] === mesh.elements.length
      ? [] : ["topology indices do not fill a complete Hex lattice"]
  };
}

function isCubeFrame(frame: readonly Index3[]): boolean {
  const axes = [1, 3, 4].map(c => frame[c]!.map((v, a) => v - frame[0]![a]!));
  if (axes.some(v => v.reduce((s, x) => s + Math.abs(x), 0) !== 1)) return false;
  if (new Set(axes.map(v => v.findIndex(x => x !== 0))).size !== 3) return false;
  return frame.every((p, c) => p.every((v, a) =>
    v === frame[0]![a]! + CORNERS[c]!.reduce((s, x, i) => s + x * axes[i]![a]!, 0)
  ));
}

function equal(a: readonly number[], b: readonly number[]): boolean {
  return a.every((v, i) => v === b[i]);
}
