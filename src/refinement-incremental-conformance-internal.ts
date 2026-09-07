import { checkNoHangingNodes, type ConformanceReport } from "./conformance.js";
import { boundariesOf, boundaryKey } from "./topology.js";
import type { Point, ReadonlyMesh } from "./types.js";

export interface ConformanceSpatialCell {
  readonly id: string;
  readonly ordinal: number;
  readonly points: readonly Readonly<Point>[];
}

type Bounds = readonly [number, number, number, number, number, number];
interface Entry {
  readonly id: string;
  readonly ordinal: number;
  readonly bounds: Bounds;
}
interface Tree {
  readonly entry: Entry;
  readonly left: Tree | undefined;
  readonly right: Tree | undefined;
  readonly height: number;
  readonly bounds: Bounds;
}
export interface ConformanceSpatialIndex {
  readonly root: Tree | undefined;
}
export interface ConformanceAuditMesh {
  readonly cellIds: readonly string[];
  readonly mesh: ReadonlyMesh;
}
export interface IncrementalConformanceAudit {
  readonly report: ConformanceReport;
  readonly nextIndex: ConformanceSpatialIndex;
  readonly checkedCellIds: readonly string[];
  readonly requiredInterfaceCount: number;
  readonly interfaceError?: string;
}

function boundsOf(cell: ConformanceSpatialCell): Bounds {
  if (cell.points.length !== 8 || !Number.isSafeInteger(cell.ordinal) || cell.ordinal < 1) {
    throw new Error(`invalid indexed Hex cell ${cell.id}`);
  }
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const point of cell.points) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = point[axis];
      if (value === undefined || !Number.isFinite(value)) {
        throw new Error(`non-finite indexed Hex cell ${cell.id}`);
      }
      bounds[axis] = Math.min(bounds[axis]!, value);
      bounds[axis + 3] = Math.max(bounds[axis + 3]!, value);
    }
  }
  return Object.freeze(bounds) as unknown as Bounds;
}

function entryOf(cell: ConformanceSpatialCell): Entry {
  return Object.freeze({ id: cell.id, ordinal: cell.ordinal, bounds: boundsOf(cell) });
}

function node(entry: Entry, left?: Tree, right?: Tree): Tree {
  const bounds = [...entry.bounds];
  for (const child of [left, right]) {
    if (child === undefined) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      bounds[axis] = Math.min(bounds[axis]!, child.bounds[axis]!);
      bounds[axis + 3] = Math.max(bounds[axis + 3]!, child.bounds[axis + 3]!);
    }
  }
  return Object.freeze({
    entry, left, right, height: 1 + Math.max(left?.height ?? 0, right?.height ?? 0),
    bounds: Object.freeze(bounds) as unknown as Bounds
  });
}

function rotateLeft(root: Tree): Tree {
  const right = root.right!;
  return node(right.entry, node(root.entry, root.left, right.left), right.right);
}

function rotateRight(root: Tree): Tree {
  const left = root.left!;
  return node(left.entry, left.left, node(root.entry, left.right, root.right));
}

function balanced(entry: Entry, left?: Tree, right?: Tree): Tree {
  let root = node(entry, left, right);
  const balance = (left?.height ?? 0) - (right?.height ?? 0);
  if (balance > 1) {
    if ((left!.right?.height ?? 0) > (left!.left?.height ?? 0)) {
      root = node(entry, rotateLeft(left!), right);
    }
    return rotateRight(root);
  }
  if (balance < -1) {
    if ((right!.left?.height ?? 0) > (right!.right?.height ?? 0)) {
      root = node(entry, left, rotateRight(right!));
    }
    return rotateLeft(root);
  }
  return root;
}

function insert(root: Tree | undefined, entry: Entry): Tree {
  if (root === undefined) return node(entry);
  if (entry.ordinal === root.entry.ordinal) throw new Error(`duplicate spatial ordinal ${entry.ordinal}`);
  return entry.ordinal < root.entry.ordinal
    ? balanced(root.entry, insert(root.left, entry), root.right)
    : balanced(root.entry, root.left, insert(root.right, entry));
}

function remove(root: Tree | undefined, entry: Pick<Entry, "id" | "ordinal">): Tree | undefined {
  if (root === undefined) throw new Error(`missing spatial cell ${entry.id}`);
  if (entry.ordinal < root.entry.ordinal) return balanced(root.entry, remove(root.left, entry), root.right);
  if (entry.ordinal > root.entry.ordinal) return balanced(root.entry, root.left, remove(root.right, entry));
  if (entry.id !== root.entry.id) throw new Error(`spatial cell identity mismatch ${entry.id}`);
  if (root.left === undefined) return root.right;
  if (root.right === undefined) return root.left;
  let successor = root.right;
  while (successor.left !== undefined) successor = successor.left;
  return balanced(successor.entry, root.left, remove(root.right, successor.entry));
}

function overlaps(a: Bounds, b: Bounds, padding: number): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    if (a[axis]! > b[axis + 3]! + padding || b[axis]! > a[axis + 3]! + padding) return false;
  }
  return true;
}

function query(root: Tree | undefined, bounds: Bounds, padding: number, result: Map<string, Entry>): void {
  if (root === undefined || !overlaps(root.bounds, bounds, padding)) return;
  if (overlaps(root.entry.bounds, bounds, padding)) result.set(root.entry.id, root.entry);
  query(root.left, bounds, padding, result);
  query(root.right, bounds, padding, result);
}

export function buildConformanceSpatialIndex(cells: Iterable<ConformanceSpatialCell>): ConformanceSpatialIndex {
  const entries = Array.from(cells, entryOf).sort((a, b) => a.ordinal - b.ordinal);
  const ids = new Set<string>();
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    if (ids.has(entry.id) || entries[i - 1]?.ordinal === entry.ordinal) {
      throw new Error(`duplicate indexed cell ${entry.id}`);
    }
    ids.add(entry.id);
  }
  const build = (start: number, end: number): Tree | undefined => {
    if (start === end) return undefined;
    const mid = (start + end) >>> 1;
    return node(entries[mid]!, build(start, mid), build(mid + 1, end));
  };
  return Object.freeze({ root: build(0, entries.length) });
}

interface FaceOwner { readonly cellId: string; readonly faceIndex: number }
function faceOwners(build: ConformanceAuditMesh): Map<string, FaceOwner[]> {
  if (build.mesh.kind !== "H1" || build.cellIds.length !== build.mesh.elements.length) {
    throw new Error("incremental conformance requires mapped Hex elements");
  }
  const owners = new Map<string, FaceOwner[]>();
  build.mesh.elements.forEach((element, index) => {
    boundariesOf(element, "H1").forEach((face, faceIndex) => {
      const key = boundaryKey(face);
      const entries = owners.get(key) ?? [];
      entries.push({ cellId: build.cellIds[index]!, faceIndex });
      owners.set(key, entries);
    });
  });
  return owners;
}

/** Spatial broad phase includes all old cells near changed geometry, including
 * tolerant interfaces and edge/corner neighbors; the tree is path-copied. */
export function auditIncrementalConformance(
  index: ConformanceSpatialIndex,
  removed: readonly ConformanceSpatialCell[],
  added: readonly ConformanceSpatialCell[],
  tolerance: number,
  buildBefore: (ids: readonly string[]) => ConformanceAuditMesh,
  buildAfter: (ids: readonly string[]) => ConformanceAuditMesh
): IncrementalConformanceAudit {
  if (!Number.isFinite(tolerance) || tolerance < 0 || !Number.isFinite(tolerance * 4)) {
    throw new Error("invalid incremental conformance tolerance");
  }
  const removedIds = new Set(removed.map((cell) => cell.id));
  const neighbors = new Map<string, Entry>();
  // Allow for coordinate merging on both sides plus the face comparison tolerance.
  for (const cell of [...removed, ...added]) query(index.root, boundsOf(cell), tolerance * 4, neighbors);
  for (const cell of removed) neighbors.set(cell.id, entryOf(cell));
  const beforeIds = [...neighbors.values()].sort((a, b) => a.ordinal - b.ordinal).map((entry) => entry.id);
  const afterEntries = [...neighbors.values()].filter((entry) => !removedIds.has(entry.id));
  afterEntries.push(...added.map(entryOf));
  afterEntries.sort((a, b) => a.ordinal - b.ordinal);
  const afterIds = afterEntries.map((entry) => entry.id);
  if (new Set(afterIds).size !== afterIds.length) throw new Error("duplicate incremental output cell");
  const before = buildBefore(beforeIds);
  const after = buildAfter(afterIds);
  const beforeOwners = faceOwners(before);
  const afterOwners = faceOwners(after);
  const required: FaceOwner[] = [];
  for (const owners of beforeOwners.values()) {
    if (owners.length === 2 && owners.some((owner) => removedIds.has(owner.cellId))) {
      for (const owner of owners) if (!removedIds.has(owner.cellId)) required.push(owner);
    }
  }
  let interfaceError: string | undefined;
  const elementById = new Map(afterIds.map((id, i) => [id, after.mesh.elements[i]!]));
  for (const owner of required) {
    const element = elementById.get(owner.cellId);
    const face = element === undefined ? undefined : boundariesOf(element, "H1")[owner.faceIndex];
    const owners = face === undefined ? undefined : afterOwners.get(boundaryKey(face));
    if (owners?.length !== 2 || owners[0]!.cellId === owners[1]!.cellId) {
      interfaceError = `incremental interface at ${owner.cellId} face ${owner.faceIndex} lost paired ownership`;
      break;
    }
  }
  if ([...afterOwners.values(), ...beforeOwners.values()].some((owners) => owners.length > 2)) {
    interfaceError = "incremental interface has nonmanifold ownership";
  }
  const checked = checkNoHangingNodes(after.mesh, tolerance);
  const report = interfaceError === undefined ? checked : {
    ...checked, ok: false, unmatchedInteriorBoundaryCount: checked.unmatchedInteriorBoundaryCount + 1
  };
  let root = index.root;
  if (report.ok) {
    for (const cell of removed) root = remove(root, cell);
    for (const cell of added) root = insert(root, entryOf(cell));
  }
  return {
    report, nextIndex: Object.freeze({ root }), checkedCellIds: Object.freeze(afterIds),
    requiredInterfaceCount: required.length,
    ...(interfaceError === undefined ? {} : { interfaceError })
  };
}
