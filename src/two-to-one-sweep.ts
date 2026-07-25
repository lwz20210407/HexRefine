import type {
  Element,
  LocalRefinement,
  Mesh,
  Point,
  RefinementRole,
  ReplaceElement
} from "./types.js";
import { minElementEdgeLength } from "./mesh.js";
import { inferHexElementLattice, type HexElementLattice } from "./regularization.js";
import { H1_FACES } from "./topology.js";
import {
  markedCornerSignature,
  pattern3PairTemplateLibrary,
  regularSweepCornerSigns,
  regularSweepTemplateLibrary,
  type Pattern3Half,
  type Pattern3Symbol,
  type RegularSweepTemplate
} from "./two-to-one-sweep-templates.js";

export interface LocalTwoToOneReplacement extends ReplaceElement {
  role: Exclude<RefinementRole, "unchanged">;
  templateCode: number;
}

type LogicalPoint = [number, number, number];
type Index3 = [number, number, number];

interface IndexBox {
  min: Index3;
  max: Index3;
}

interface LogicalSelection {
  cells: Index3[];
  cellKeys: ReadonlySet<string>;
  bounds: IndexBox;
  completeBox: boolean;
}

interface SweepPatch {
  axis: number;
  plane: number;
  firstCrossAxis: number;
  firstMin: number;
  secondCrossAxis: number;
  secondMin: number;
}

interface SweepPassResult {
  mesh: Mesh;
  logicalCoordinates: LogicalPoint[];
  parentToChildren: number[][];
}

const AXIS_ORDER = [2, 1, 0] as const;

/**
 * Build a local mapped-box 2:1 transition using the Owen/Shih three-sweep
 * construction. Returns undefined when the input is not a mapped logical
 * selection so the caller can retain another strategy.
 */
export function tryBuildLocalTwoToOneHexReplacements(
  mesh: Mesh,
  selectedElementIds: readonly number[]
): LocalTwoToOneReplacement[] | undefined {
  const selected = uniqueSorted(selectedElementIds);
  if (selected.length === 0) {
    return [];
  }
  const tolerance = minElementEdgeLength(mesh) * 0.000001;
  const lattice = inferHexElementLattice(mesh, tolerance);
  const logicalSelection = selectedLogicalSelection(selected, lattice);
  if (
    !logicalSelection
    || spansFullSection(logicalSelection, lattice.dimensions)
  ) {
    return undefined;
  }
  const logicalCoordinates = logicalNodeCoordinates(mesh, lattice, tolerance);
  if (!logicalCoordinates) {
    return undefined;
  }

  let currentMesh: Mesh = {
    kind: "H1",
    nodes: mesh.nodes.map((point) => [...point]),
    elements: mesh.elements.map((element) => [...element])
  };
  let currentLogical = logicalCoordinates;
  let lineage = mesh.elements.map((_, index) => index + 1);

  for (const axis of AXIS_ORDER) {
    const patches = sweepPatches(logicalSelection, axis);
    const markedNodes = markedNodesForSweep(currentLogical, patches, tolerance);
    if (markedNodes.size === 0) {
      throw new Error(`local 2:1 logical sweep on axis ${axis + 1} selected no nodes`);
    }
    const planes = uniqueSorted(patches.map((patch) => patch.plane));
    const quads = logicalPlaneQuads(
      currentMesh,
      currentLogical,
      axis,
      planes,
      tolerance
    );
    const normalizedMarks = normalizePlaneMarking(quads, markedNodes);
    const pass = applyRegularSweepPass(
      currentMesh,
      currentLogical,
      normalizedMarks,
      tolerance
    );
    const nextLineage = new Array<number>(pass.mesh.elements.length);
    pass.parentToChildren.forEach((childIndices, parentIndex) => {
      const originalParentId = lineage[parentIndex]!;
      for (const childIndex of childIndices) {
        nextLineage[childIndex] = originalParentId;
      }
    });
    if (nextLineage.some((parentId) => parentId === undefined)) {
      throw new Error("local 2:1 sweep lost original-parent lineage");
    }
    currentMesh = pass.mesh;
    currentLogical = pass.logicalCoordinates;
    lineage = nextLineage;
  }

  return regroupByOriginalParent(
    mesh,
    currentMesh,
    lineage,
    new Set(selected),
    lattice,
    logicalSelection
  );
}

function selectedLogicalSelection(
  selected: readonly number[],
  lattice: HexElementLattice
): LogicalSelection | undefined {
  const indices = selected.map((elementId) => lattice.indicesByElementId.get(elementId));
  if (indices.some((index) => index === undefined)) {
    return undefined;
  }
  const typed = indices as Index3[];
  const min = [0, 1, 2].map((axis) =>
    Math.min(...typed.map((index) => index[axis]!))
  ) as Index3;
  const max = [0, 1, 2].map((axis) =>
    Math.max(...typed.map((index) => index[axis]!))
  ) as Index3;
  const expected = (max[0] - min[0] + 1)
    * (max[1] - min[1] + 1)
    * (max[2] - min[2] + 1);
  const cellKeys = new Set(typed.map(indexKey));
  return {
    cells: typed.map((index) => [...index]),
    cellKeys,
    bounds: { min, max },
    completeBox: expected === selected.length
      && allCellsPresent({ min, max }, cellKeys)
  };
}

function spansFullSection(
  selection: LogicalSelection,
  dimensions: Index3
): boolean {
  if (!selection.completeBox) {
    return false;
  }
  let completeAxes = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    if (
      selection.bounds.min[axis] === 0
      && selection.bounds.max[axis] === dimensions[axis]! - 1
    ) {
      completeAxes += 1;
    }
  }
  return completeAxes >= 2;
}

function allCellsPresent(
  box: IndexBox,
  cellKeys: ReadonlySet<string>
): boolean {
  for (let k = box.min[2]; k <= box.max[2]; k += 1) {
    for (let j = box.min[1]; j <= box.max[1]; j += 1) {
      for (let i = box.min[0]; i <= box.max[0]; i += 1) {
        if (!cellKeys.has(indexKey([i, j, k]))) {
          return false;
        }
      }
    }
  }
  return true;
}

function logicalNodeCoordinates(
  mesh: Mesh,
  lattice: HexElementLattice,
  tolerance: number
): LogicalPoint[] | undefined {
  return logicalNodeCoordinatesFromConnectivity(mesh, lattice, tolerance)
    ?? logicalNodeCoordinatesFromLatticeGeometry(mesh, lattice, tolerance);
}

function logicalNodeCoordinatesFromConnectivity(
  mesh: Mesh,
  lattice: HexElementLattice,
  tolerance: number
): LogicalPoint[] | undefined {
  const logical: Array<LogicalPoint | undefined> = new Array(mesh.nodes.length);
  const offsets: readonly Index3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1]
  ];
  for (const [elementId, origin] of lattice.indicesByElementId) {
    const element = mesh.elements[elementId - 1];
    if (!element || element.length !== 8) {
      return undefined;
    }
    for (let corner = 0; corner < 8; corner += 1) {
      const nodeId = element[corner]!;
      const offset = offsets[corner]!;
      const candidate: LogicalPoint = [
        origin[0] + offset[0],
        origin[1] + offset[1],
        origin[2] + offset[2]
      ];
      const existing = logical[nodeId - 1];
      if (existing && !pointsEqual(existing, candidate, tolerance)) {
        return undefined;
      }
      logical[nodeId - 1] = candidate;
    }
  }
  if (logical.some((point) => point === undefined)) {
    return undefined;
  }
  return logical as LogicalPoint[];
}

function logicalNodeCoordinatesFromLatticeGeometry(
  mesh: Mesh,
  lattice: HexElementLattice,
  tolerance: number
): LogicalPoint[] | undefined {
  const logical: Array<LogicalPoint | undefined> = new Array(mesh.nodes.length);
  const centers = mesh.elements.map((element) =>
    averagePoints(element.map((nodeId) => mesh.nodes[nodeId - 1]!))
  );

  for (const [elementId, origin] of lattice.indicesByElementId) {
    const element = mesh.elements[elementId - 1];
    const center = centers[elementId - 1];
    if (!element || element.length !== 8 || !center) {
      return undefined;
    }
    const directions = ([0, 1, 2] as const).map((axis) =>
      logicalAxisDirection(center, origin, axis, lattice, centers)
    );
    if (directions.some((direction) => direction === undefined)) {
      return undefined;
    }
    const typedDirections = directions as [Point, Point, Point];
    const cornerKeys = new Set<string>();
    for (const nodeId of element) {
      const point = mesh.nodes[nodeId - 1];
      if (!point) {
        return undefined;
      }
      const local = solveDirectionCoordinates(
        point.map((value, component) => value - center[component]!) as Point,
        typedDirections,
        tolerance
      );
      if (!local || local.some((value) => Math.abs(value) <= tolerance)) {
        return undefined;
      }
      const offset = local.map((value) => value > 0 ? 1 : 0) as Index3;
      const cornerKey = indexKey(offset);
      if (cornerKeys.has(cornerKey)) {
        return undefined;
      }
      cornerKeys.add(cornerKey);
      const candidate: LogicalPoint = [
        origin[0] + offset[0],
        origin[1] + offset[1],
        origin[2] + offset[2]
      ];
      const existing = logical[nodeId - 1];
      if (existing && !pointsEqual(existing, candidate, tolerance)) {
        return undefined;
      }
      logical[nodeId - 1] = candidate;
    }
    if (cornerKeys.size !== 8) {
      return undefined;
    }
  }
  return logical.some((point) => point === undefined)
    ? undefined
    : logical as LogicalPoint[];
}

function logicalAxisDirection(
  center: Point,
  origin: Index3,
  axis: 0 | 1 | 2,
  lattice: HexElementLattice,
  centers: readonly Point[]
): Point | undefined {
  const minus = [...origin] as Index3;
  const plus = [...origin] as Index3;
  minus[axis] -= 1;
  plus[axis] += 1;
  const minusId = lattice.elementIdByKey.get(indexKey(minus));
  const plusId = lattice.elementIdByKey.get(indexKey(plus));
  const minusCenter = minusId === undefined ? undefined : centers[minusId - 1];
  const plusCenter = plusId === undefined ? undefined : centers[plusId - 1];
  if (minusCenter && plusCenter) {
    return plusCenter.map((value, component) => value - minusCenter[component]!);
  }
  if (plusCenter) {
    return plusCenter.map((value, component) => value - center[component]!);
  }
  if (minusCenter) {
    return center.map((value, component) => value - minusCenter[component]!);
  }
  return undefined;
}

function solveDirectionCoordinates(
  delta: Point,
  directions: readonly [Point, Point, Point],
  tolerance: number
): LogicalPoint | undefined {
  const [u, v, w] = directions;
  const determinant = dot3(u, cross3(v, w));
  if (Math.abs(determinant) <= tolerance * tolerance * tolerance) {
    return undefined;
  }
  return [
    dot3(delta, cross3(v, w)) / determinant,
    dot3(u, cross3(delta, w)) / determinant,
    dot3(u, cross3(v, delta)) / determinant
  ];
}

function cross3(first: Point, second: Point): Point {
  return [
    first[1]! * second[2]! - first[2]! * second[1]!,
    first[2]! * second[0]! - first[0]! * second[2]!,
    first[0]! * second[1]! - first[1]! * second[0]!
  ];
}

function dot3(first: Point, second: Point): number {
  return first[0]! * second[0]!
    + first[1]! * second[1]!
    + first[2]! * second[2]!;
}

function sweepPatches(
  selection: LogicalSelection,
  axis: number
): SweepPatch[] {
  const crossAxes = [0, 1, 2].filter((candidate) => candidate !== axis);
  const cellsByCrossSection = new Map<string, Index3[]>();
  for (const cell of selection.cells) {
    const key = `${cell[crossAxes[0]!]!}:${cell[crossAxes[1]!]!}`;
    const cells = cellsByCrossSection.get(key) ?? [];
    cells.push(cell);
    cellsByCrossSection.set(key, cells);
  }
  const patches: SweepPatch[] = [];
  for (const cells of cellsByCrossSection.values()) {
    const axial = [...new Set(cells.map((cell) => cell[axis]!))].sort((a, b) => a - b);
    const sample = cells[0]!;
    let runStart = axial[0]!;
    let runEnd = runStart;
    const emitRun = (): void => {
      for (let plane = runStart + 1; plane <= runEnd + 1; plane += 2) {
        patches.push({
          axis,
          plane,
          firstCrossAxis: crossAxes[0]!,
          firstMin: sample[crossAxes[0]!]!,
          secondCrossAxis: crossAxes[1]!,
          secondMin: sample[crossAxes[1]!]!
        });
      }
    };
    for (const coordinate of axial.slice(1)) {
      if (coordinate === runEnd + 1) {
        runEnd = coordinate;
        continue;
      }
      emitRun();
      runStart = coordinate;
      runEnd = coordinate;
    }
    emitRun();
  }
  return patches.sort((first, second) =>
    first.plane - second.plane
    || first.firstCrossAxis - second.firstCrossAxis
    || first.firstMin - second.firstMin
    || first.secondMin - second.secondMin
  );
}

function markedNodesForSweep(
  logical: readonly LogicalPoint[],
  patches: readonly SweepPatch[],
  tolerance: number
): Set<number> {
  const axis = patches[0]?.axis;
  if (axis === undefined) {
    return new Set();
  }
  const cellsByPlane = new Map<number, Set<string>>();
  for (const patch of patches) {
    const cells = cellsByPlane.get(patch.plane) ?? new Set<string>();
    cells.add(`${patch.firstMin}:${patch.secondMin}`);
    cellsByPlane.set(patch.plane, cells);
  }
  const marked = new Set<number>();
  logical.forEach((point, nodeIndex) => {
    const plane = Math.round(point[axis]!);
    if (Math.abs(point[axis]! - plane) > tolerance) {
      return;
    }
    const cells = cellsByPlane.get(plane);
    if (!cells) {
      return;
    }
    const firstCrossAxis = patches[0]!.firstCrossAxis;
    const secondCrossAxis = patches[0]!.secondCrossAxis;
    const firstCandidates = containingLogicalCells(point[firstCrossAxis]!, tolerance);
    const secondCandidates = containingLogicalCells(point[secondCrossAxis]!, tolerance);
    if (firstCandidates.some((first) =>
      secondCandidates.some((second) => cells.has(`${first}:${second}`))
    )) {
      marked.add(nodeIndex + 1);
    }
  });
  return marked;
}

function containingLogicalCells(
  coordinate: number,
  tolerance: number
): number[] {
  const rounded = Math.round(coordinate);
  if (Math.abs(coordinate - rounded) <= tolerance) {
    return [rounded - 1, rounded];
  }
  return [Math.floor(coordinate)];
}

function logicalPlaneQuads(
  mesh: Mesh,
  logical: readonly LogicalPoint[],
  axis: number,
  planes: readonly number[],
  tolerance: number
): number[][] {
  const quads = new Map<string, number[]>();
  const planeSet = new Set(planes);
  for (const element of mesh.elements) {
    for (const faceTemplate of H1_FACES) {
      const face = faceTemplate.map((localId) => element[localId - 1]!);
      const coordinate = logical[face[0]! - 1]![axis]!;
      if (face.slice(1).some((nodeId) =>
        Math.abs(logical[nodeId - 1]![axis]! - coordinate) > tolerance
      )) {
        continue;
      }
      const roundedPlane = Math.round(coordinate);
      if (
        Math.abs(coordinate - roundedPlane) > tolerance
        || !planeSet.has(roundedPlane)
      ) {
        continue;
      }
      quads.set([...face].sort((a, b) => a - b).join(":"), face);
    }
  }
  return [...quads.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([, face]) => face);
}

function normalizePlaneMarking(
  quads: readonly (readonly number[])[],
  markedNodes: ReadonlySet<number>
): Set<number> {
  const marks = new Set(markedNodes);
  const edgeOwners = new Map<string, number[]>();
  quads.forEach((quad, faceIndex) => {
    if (quad.length !== 4 || new Set(quad).size !== 4) {
      throw new Error(`logical sweep face ${faceIndex} is not a four-node quadrilateral`);
    }
    for (let corner = 0; corner < 4; corner += 1) {
      const key = edgeKey(quad[corner]!, quad[(corner + 1) % 4]!);
      const owners = edgeOwners.get(key) ?? [];
      owners.push(faceIndex);
      edgeOwners.set(key, owners);
    }
  });
  if ([...edgeOwners.values()].some((owners) => owners.length > 2)) {
    throw new Error("logical sweep plane has a nonmanifold quadrilateral edge");
  }

  while (true) {
    let changed = false;
    for (const quad of quads) {
      const markedCorners = quad
        .map((nodeId, corner) => marks.has(nodeId) ? corner : -1)
        .filter((corner) => corner >= 0);
      if (
        markedCorners.length === 2
        && (markedCorners[1]! - markedCorners[0]!) % 2 === 0
      ) {
        quad.forEach((nodeId) => marks.add(nodeId));
        changed = true;
      }
    }
    if (changed) {
      continue;
    }

    const threeFaces = new Map<number, number>();
    quads.forEach((quad, faceIndex) => {
      if (quad.filter((nodeId) => marks.has(nodeId)).length === 3) {
        threeFaces.set(faceIndex, quad.find((nodeId) => !marks.has(nodeId))!);
      }
    });
    let repairedNode: number | undefined;
    for (const [faceIndex, unmarked] of threeFaces) {
      const quad = quads[faceIndex]!;
      const corner = quad.indexOf(unmarked);
      const incidentEdges = [
        edgeKey(quad[(corner + 3) % 4]!, unmarked),
        edgeKey(unmarked, quad[(corner + 1) % 4]!)
      ];
      const hasMatchingNeighbor = incidentEdges.some((edge) =>
        (edgeOwners.get(edge) ?? [])
          .filter((owner) => owner !== faceIndex)
          .some((owner) => threeFaces.get(owner) === unmarked)
      );
      if (hasMatchingNeighbor) {
        repairedNode = unmarked;
        break;
      }
    }
    if (repairedNode !== undefined) {
      marks.add(repairedNode);
      continue;
    }
    return marks;
  }
}

function applyRegularSweepPass(
  mesh: Mesh,
  logical: readonly LogicalPoint[],
  markedNodes: ReadonlySet<number>,
  tolerance: number
): SweepPassResult {
  const library = regularSweepTemplateLibrary();
  const pattern3Library = pattern3PairTemplateLibrary();
  const cornerSigns = regularSweepCornerSigns();
  const plans: Array<RegularSweepTemplate | Pattern3Half | undefined> =
    mesh.elements.map((element, elementIndex) => {
      const marks = cornerSigns.filter((_, corner) => markedNodes.has(element[corner]!));
      if (marks.length === 0) {
        return undefined;
      }
      const signature = markedCornerSignature(marks);
      const plan = library.get(signature) ?? pattern3Library.get(signature);
      if (!plan) {
        throw new Error(
          `local 2:1 sweep element ${elementIndex + 1} has unsupported marked-corner signature ` +
          signature
        );
      }
      return plan;
    });
  const unpairedFaces = new Map<string, number>();
  plans.forEach((plan, elementIndex) => {
    if (!isPattern3Half(plan)) {
      return;
    }
    const element = mesh.elements[elementIndex]!;
    const faceKey = plan.faceCorners
      .map((corner) => element[corner]!)
      .sort((a, b) => a - b)
      .join(":");
    if (unpairedFaces.has(faceKey)) {
      unpairedFaces.delete(faceKey);
    } else {
      unpairedFaces.set(faceKey, elementIndex + 1);
    }
  });
  if (unpairedFaces.size > 0) {
    throw new Error(
      "local 2:1 pattern-3 elements have no partner sharing their marked face: " +
      [...unpairedFaces.values()].sort((a, b) => a - b).join(", ")
    );
  }

  const outputNodes: Point[] = mesh.nodes.map((point) => [...point]);
  const outputLogical: LogicalPoint[] = logical.map((point) => [...point]);
  const entityNodeId = new Map<string, number>();
  mesh.nodes.forEach((_, index) => entityNodeId.set(`vertex:${index + 1}`, index + 1));
  const outputElements: Element[] = [];
  const parentToChildren: number[][] = [];
  const mergeGroups = new Map<string, number[]>();

  const internNode = (
    key: string,
    physical: Point,
    logicalPoint: LogicalPoint
  ): number => {
    const existingNodeId = entityNodeId.get(key);
    if (existingNodeId !== undefined) {
      if (
        !pointsEqual(outputNodes[existingNodeId - 1]!, physical, tolerance)
        || !pointsEqual(outputLogical[existingNodeId - 1]!, logicalPoint, tolerance)
      ) {
        throw new Error(`local 2:1 sweep entity ${key} maps inconsistently`);
      }
      return existingNodeId;
    }
    const nodeId = outputNodes.length + 1;
    outputNodes.push(physical);
    outputLogical.push(logicalPoint);
    entityNodeId.set(key, nodeId);
    return nodeId;
  };

  mesh.elements.forEach((element, parentIndex) => {
    const firstChild = outputElements.length;
    const plan = plans[parentIndex];
    if (!plan) {
      outputElements.push([...element]);
    } else if (isPattern3Half(plan)) {
      const resolve = (item: Pattern3Symbol): number => {
        const nodeIds = item.corners
          .map((corner) => element[corner]!)
          .sort((a, b) => a - b);
        if (item.kind === "corner") {
          return nodeIds[0]!;
        }
        const physical = averagePoints(nodeIds.map((nodeId) => mesh.nodes[nodeId - 1]!));
        const logicalPoint = averagePoints(
          nodeIds.map((nodeId) => logical[nodeId - 1]!)
        ) as LogicalPoint;
        return internNode(`${item.kind}:${nodeIds.join(":")}`, physical, logicalPoint);
      };
      for (const child of plan.children) {
        outputElements.push(child.map(resolve));
      }
      for (const group of plan.mergeGroups) {
        const nodeIds = group.map(resolve).sort((a, b) => a - b);
        mergeGroups.set(nodeIds.join(":"), nodeIds);
      }
    } else {
      const localToGlobal = plan.nodes.map((reference) => {
        const physical = trilinearMap(
          element.map((nodeId) => mesh.nodes[nodeId - 1]!),
          reference
        );
        const logicalPoint = trilinearMap(
          element.map((nodeId) => logical[nodeId - 1]!),
          reference
        ) as LogicalPoint;
        const key = referenceEntityKey(element, reference, parentIndex);
        return internNode(key, physical, logicalPoint);
      });
      for (const child of plan.elements) {
        outputElements.push(child.map((localNodeId) => localToGlobal[localNodeId]!));
      }
    }
    parentToChildren.push(
      Array.from(
        { length: outputElements.length - firstChild },
        (_, offset) => firstChild + offset
      )
    );
  });

  const merged = mergePattern3Nodes(
    outputNodes,
    outputLogical,
    outputElements,
    [...mergeGroups.values()],
    mesh.nodes.length
  );
  return {
    mesh: { kind: "H1", nodes: merged.nodes, elements: merged.elements },
    logicalCoordinates: merged.logicalCoordinates,
    parentToChildren
  };
}

function isPattern3Half(
  plan: RegularSweepTemplate | Pattern3Half | undefined
): plan is Pattern3Half {
  return plan?.name === "pattern3pair";
}

function mergePattern3Nodes(
  nodes: readonly Point[],
  logical: readonly LogicalPoint[],
  elements: readonly Element[],
  groups: readonly (readonly number[])[],
  sourceNodeCount: number
): {
  nodes: Point[];
  logicalCoordinates: LogicalPoint[];
  elements: Element[];
} {
  if (groups.length === 0) {
    return {
      nodes: nodes.map((point) => [...point]),
      logicalCoordinates: logical.map((point) => [...point]),
      elements: elements.map((element) => [...element])
    };
  }
  const parent = Array.from({ length: nodes.length + 1 }, (_, nodeId) => nodeId);
  const find = (nodeId: number): number => {
    let root = nodeId;
    while (parent[root] !== root) {
      root = parent[root]!;
    }
    while (parent[nodeId] !== nodeId) {
      const next = parent[nodeId]!;
      parent[nodeId] = root;
      nodeId = next;
    }
    return root;
  };
  const unite = (first: number, second: number): void => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot === secondRoot) {
      return;
    }
    const keep = Math.min(firstRoot, secondRoot);
    const retire = Math.max(firstRoot, secondRoot);
    if (keep <= sourceNodeCount || retire <= sourceNodeCount) {
      throw new Error("local 2:1 pattern-3 merge cannot retire a source node");
    }
    parent[retire] = keep;
  };
  for (const group of groups) {
    for (const nodeId of group.slice(1)) {
      unite(group[0]!, nodeId);
    }
  }

  const membersByRoot = new Map<number, number[]>();
  for (let nodeId = 1; nodeId <= nodes.length; nodeId += 1) {
    const root = find(nodeId);
    const members = membersByRoot.get(root) ?? [];
    members.push(nodeId);
    membersByRoot.set(root, members);
  }
  const compactNodeIdByRoot = new Map<number, number>();
  const compactNodes: Point[] = [];
  const compactLogical: LogicalPoint[] = [];
  for (let nodeId = 1; nodeId <= nodes.length; nodeId += 1) {
    const root = find(nodeId);
    if (compactNodeIdByRoot.has(root)) {
      continue;
    }
    const members = membersByRoot.get(root)!;
    compactNodeIdByRoot.set(root, compactNodes.length + 1);
    compactNodes.push(averagePoints(members.map((member) => nodes[member - 1]!)));
    compactLogical.push(
      averagePoints(members.map((member) => logical[member - 1]!)) as LogicalPoint
    );
  }
  return {
    nodes: compactNodes,
    logicalCoordinates: compactLogical,
    elements: elements.map((element) =>
      element.map((nodeId) => compactNodeIdByRoot.get(find(nodeId))!)
    )
  };
}

function referenceEntityKey(
  parent: Element,
  reference: readonly number[],
  parentIndex: number
): string {
  const rounded = reference.map((value) => Math.round(value));
  if (reference.some((value, axis) => Math.abs(value - rounded[axis]!) > 1e-12)) {
    throw new Error(`regular 2:1 sweep reference point ${reference.join(",")} is not tensor-aligned`);
  }
  const zeroCount = rounded.filter((value) => value === 0).length;
  const matchingCorners = regularSweepCornerSigns()
    .map((sign, corner) => ({ sign, corner }))
    .filter(({ sign }) => rounded.every((value, axis) =>
      value === 0 || sign[axis] === value
    ))
    .map(({ corner }) => parent[corner]!)
    .sort((a, b) => a - b);
  if (zeroCount === 0) {
    return `vertex:${matchingCorners[0]!}`;
  }
  if (zeroCount === 1) {
    return `edge:${matchingCorners.join(":")}`;
  }
  if (zeroCount === 2) {
    return `face:${matchingCorners.join(":")}`;
  }
  return `cell:${parentIndex}`;
}

function regroupByOriginalParent(
  sourceMesh: Mesh,
  refinedMesh: Mesh,
  lineage: readonly number[],
  selected: ReadonlySet<number>,
  lattice: HexElementLattice,
  logicalSelection: LogicalSelection
): LocalTwoToOneReplacement[] {
  const childIndicesByParent = new Map<number, number[]>();
  lineage.forEach((parentId, childIndex) => {
    const children = childIndicesByParent.get(parentId) ?? [];
    children.push(childIndex);
    childIndicesByParent.set(parentId, children);
  });
  const replacements: LocalTwoToOneReplacement[] = [];
  for (const [parentId, childIndices] of childIndicesByParent) {
    if (childIndices.length === 1) {
      continue;
    }
    const refinement = localRefinement(refinedMesh, childIndices, parentId);
    const role = selected.has(parentId)
      ? "selected"
      : transitionRole(lattice.indicesByElementId.get(parentId)!, logicalSelection.cells);
    replacements.push({
      elementId: parentId,
      refinement,
      role,
      templateCode: refinement.elements.length
    });
  }

  for (const selectedParentId of selected) {
    const replacement = replacements.find((item) => item.elementId === selectedParentId);
    if (!replacement || replacement.refinement.elements.length !== 8) {
      throw new Error(
        `local 2:1 core parent ${selectedParentId} must have exactly 8 children`
      );
    }
  }
  if (replacements.some((replacement) => !sourceMesh.elements[replacement.elementId - 1])) {
    throw new Error("local 2:1 sweep produced an invalid original-parent id");
  }
  return replacements.sort((first, second) => first.elementId - second.elementId);
}

function localRefinement(
  mesh: Mesh,
  childIndices: readonly number[],
  parentId: number
): LocalRefinement {
  const globalToLocal = new Map<number, number>();
  const nodes: Point[] = [];
  const elements = childIndices.map((childIndex) =>
    mesh.elements[childIndex]!.map((globalNodeId) => {
      let localNodeId = globalToLocal.get(globalNodeId);
      if (localNodeId === undefined) {
        localNodeId = nodes.length + 1;
        globalToLocal.set(globalNodeId, localNodeId);
        nodes.push([...mesh.nodes[globalNodeId - 1]!]);
      }
      return localNodeId;
    })
  );
  return {
    kind: "H1",
    source: `two_to_one_sweep_parent_${parentId}`,
    nodes,
    elements
  };
}

function transitionRole(
  index: Index3,
  selectedCells: readonly Index3[]
): LocalTwoToOneReplacement["role"] {
  const nearest = selectedCells
    .map((selected) => {
      const distances = [0, 1, 2].map((axis) =>
        Math.abs(index[axis]! - selected[axis]!)
      );
      return {
        maximumDistance: Math.max(...distances),
        totalDistance: distances.reduce((sum, value) => sum + value, 0),
        outsideAxes: distances.filter((distance) => distance > 0).length
      };
    })
    .sort((first, second) =>
      first.maximumDistance - second.maximumDistance
      || first.totalDistance - second.totalDistance
      || first.outsideAxes - second.outsideAxes
    )[0];
  const outsideAxes = nearest?.outsideAxes ?? 1;
  if (outsideAxes <= 1) {
    return "face-transition";
  }
  if (outsideAxes === 2) {
    return "edge-transition";
  }
  return "corner-transition";
}

function trilinearMap(
  vertices: readonly Point[],
  reference: readonly number[]
): Point {
  const [xi, eta, zeta] = reference;
  const signs = regularSweepCornerSigns();
  const result = [0, 0, 0];
  for (let corner = 0; corner < 8; corner += 1) {
    const sign = signs[corner]!;
    const weight = (1 + sign[0] * xi!)
      * (1 + sign[1] * eta!)
      * (1 + sign[2] * zeta!)
      / 8;
    for (let component = 0; component < 3; component += 1) {
      result[component] = result[component]! + weight * vertices[corner]![component]!;
    }
  }
  return result;
}

function averagePoints(points: readonly Point[]): Point {
  const sum = [0, 0, 0];
  for (const point of points) {
    for (let component = 0; component < 3; component += 1) {
      sum[component] = sum[component]! + point[component]!;
    }
  }
  return sum.map((value) => value / points.length);
}

function pointsEqual(
  first: readonly number[],
  second: readonly number[],
  tolerance: number
): boolean {
  return first.length === second.length
    && first.every((value, index) => Math.abs(value - second[index]!) <= tolerance);
}

function edgeKey(first: number, second: number): string {
  return first < second ? `${first}:${second}` : `${second}:${first}`;
}

function indexKey(index: Index3): string {
  return `${index[0]}:${index[1]}:${index[2]}`;
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}
