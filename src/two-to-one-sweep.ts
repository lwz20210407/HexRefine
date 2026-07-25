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
  regularSweepCornerSigns,
  regularSweepTemplateLibrary,
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

interface SweepPassResult {
  mesh: Mesh;
  logicalCoordinates: LogicalPoint[];
  parentToChildren: number[][];
}

const AXIS_ORDER = [2, 1, 0] as const;

/**
 * Build a local mapped-box 2:1 transition using the Owen/Shih three-sweep
 * construction. Returns undefined when the input is not a complete mapped
 * rectangular selection so the caller can retain another strategy.
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
  const box = selectedIndexBox(selected, lattice);
  if (!box || spansFullSection(box, lattice.dimensions)) {
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
    const markedNodes = markedNodesForSweep(currentLogical, box, axis, tolerance);
    if (markedNodes.size === 0) {
      throw new Error(`local 2:1 logical sweep on axis ${axis + 1} selected no nodes`);
    }
    const planes = markPlanes(box, axis);
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
    box
  );
}

function selectedIndexBox(
  selected: readonly number[],
  lattice: HexElementLattice
): IndexBox | undefined {
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
  if (expected !== selected.length) {
    return undefined;
  }
  const selectedSet = new Set(selected);
  for (let k = min[2]; k <= max[2]; k += 1) {
    for (let j = min[1]; j <= max[1]; j += 1) {
      for (let i = min[0]; i <= max[0]; i += 1) {
        const elementId = lattice.elementIdByKey.get(indexKey([i, j, k]));
        if (!elementId || !selectedSet.has(elementId)) {
          return undefined;
        }
      }
    }
  }
  return { min, max };
}

function spansFullSection(box: IndexBox, dimensions: Index3): boolean {
  let completeAxes = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    if (box.min[axis] === 0 && box.max[axis] === dimensions[axis]! - 1) {
      completeAxes += 1;
    }
  }
  return completeAxes >= 2;
}

function logicalNodeCoordinates(
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

function markPlanes(box: IndexBox, axis: number): number[] {
  const planes: number[] = [];
  for (
    let plane = box.min[axis]! + 1;
    plane <= box.max[axis]! + 1;
    plane += 2
  ) {
    planes.push(plane);
  }
  return planes;
}

function markedNodesForSweep(
  logical: readonly LogicalPoint[],
  box: IndexBox,
  axis: number,
  tolerance: number
): Set<number> {
  const planes = markPlanes(box, axis);
  const crossAxes = [0, 1, 2].filter((candidate) => candidate !== axis);
  const marked = new Set<number>();
  logical.forEach((point, nodeIndex) => {
    const onPlane = planes.some((plane) => Math.abs(point[axis]! - plane) <= tolerance);
    if (!onPlane) {
      return;
    }
    const inside = crossAxes.every((crossAxis) =>
      point[crossAxis]! >= box.min[crossAxis]! - tolerance
      && point[crossAxis]! <= box.max[crossAxis]! + 1 + tolerance
    );
    if (inside) {
      marked.add(nodeIndex + 1);
    }
  });
  return marked;
}

function logicalPlaneQuads(
  mesh: Mesh,
  logical: readonly LogicalPoint[],
  axis: number,
  planes: readonly number[],
  tolerance: number
): number[][] {
  const quads = new Map<string, number[]>();
  for (const element of mesh.elements) {
    for (const faceTemplate of H1_FACES) {
      const face = faceTemplate.map((localId) => element[localId - 1]!);
      const coordinate = logical[face[0]! - 1]![axis]!;
      if (face.slice(1).some((nodeId) =>
        Math.abs(logical[nodeId - 1]![axis]! - coordinate) > tolerance
      )) {
        continue;
      }
      if (!planes.some((plane) => Math.abs(coordinate - plane) <= tolerance)) {
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
  const cornerSigns = regularSweepCornerSigns();
  const plans = mesh.elements.map((element, elementIndex) => {
    const marks = cornerSigns.filter((_, corner) => markedNodes.has(element[corner]!));
    if (marks.length === 0) {
      return undefined;
    }
    const plan = library.get(markedCornerSignature(marks));
    if (!plan) {
      throw new Error(
        `local 2:1 sweep element ${elementIndex + 1} has unsupported marked-corner signature ` +
        markedCornerSignature(marks)
      );
    }
    return plan;
  });

  const outputNodes: Point[] = mesh.nodes.map((point) => [...point]);
  const outputLogical: LogicalPoint[] = logical.map((point) => [...point]);
  const entityNodeId = new Map<string, number>();
  mesh.nodes.forEach((_, index) => entityNodeId.set(`vertex:${index + 1}`, index + 1));
  const outputElements: Element[] = [];
  const parentToChildren: number[][] = [];

  mesh.elements.forEach((element, parentIndex) => {
    const firstChild = outputElements.length;
    const plan = plans[parentIndex];
    if (!plan) {
      outputElements.push([...element]);
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

  return {
    mesh: { kind: "H1", nodes: outputNodes, elements: outputElements },
    logicalCoordinates: outputLogical,
    parentToChildren
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
  box: IndexBox
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
      : transitionRole(lattice.indicesByElementId.get(parentId)!, box);
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

function transitionRole(index: Index3, box: IndexBox): LocalTwoToOneReplacement["role"] {
  const outsideAxes = [0, 1, 2].filter((axis) =>
    index[axis]! < box.min[axis]! || index[axis]! > box.max[axis]!
  ).length;
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
