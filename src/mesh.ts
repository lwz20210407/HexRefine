import type {
  BoundaryPair,
  Element,
  ElementKind,
  LocalRefinement,
  Mesh,
  Point,
  ReadonlyMesh,
  ReplaceElement
} from "./types.js";
import { boundaryKey, boundariesOf, elementKindFromNodeCount } from "./topology.js";
import { centroid, pointEquals } from "./vector.js";
import {
  createMergeBucketLayout,
  forEachCandidateMergeBucketKey,
  mergeBucketKey,
  type MergeBucketLayout
} from "./merge-buckets-internal.js";

export interface NodeMergeResult {
  mesh: Mesh;
  nodeIdByInputNodeId: Map<number, number>;
  inputNodeIdsByNodeId: Map<number, number[]>;
  nodeIdByInputNodeIdArray?: number[];
  inputNodeIdsByNodeIdArray?: number[][];
}

export function inferMeshKind(mesh: ReadonlyMesh): ElementKind {
  if (mesh.kind) {
    return mesh.kind;
  }
  const first = mesh.elements[0];
  if (!first) {
    throw new Error("cannot infer element kind from an empty mesh");
  }
  return elementKindFromNodeCount(first.length);
}

export function elementVertices(mesh: ReadonlyMesh, element: Element): Point[] {
  return element.map((nodeId) => {
    const node = mesh.nodes[nodeId - 1];
    if (!node) {
      throw new Error(`element references missing node id ${nodeId}`);
    }
    return node;
  });
}

export function elementCenter(mesh: Mesh, element: Element): Point {
  return centroid(elementVertices(mesh, element));
}

export function elementCenters(mesh: Mesh): Point[] {
  return mesh.elements.map((element) => elementCenter(mesh, element));
}

export function selectElementsByPredicate(mesh: Mesh, predicate: (center: Point, element: Element, elementId: number) => boolean): number[] {
  return mesh.elements
    .map((element, index) => ({ element, elementId: index + 1, center: elementCenter(mesh, element) }))
    .filter(({ center, element, elementId }) => predicate(center, element, elementId))
    .map(({ elementId }) => elementId);
}

export function findBoundaryPairs(mesh: Mesh, selectedElementIds: readonly number[]): BoundaryPair[] {
  const selected = new Set(selectedElementIds);
  const kind = inferMeshKind(mesh);
  const selectedBoundaryOwner = new Map<string, Array<{ elementId: number; boundary: number[] }>>();
  const selectedBoundaryNodeIds = new Set<number>();

  for (const elementId of selected) {
    const element = mesh.elements[elementId - 1];
    if (!element) {
      continue;
    }
    for (const boundary of boundariesOf(element, kind)) {
      const key = boundaryKey(boundary);
      const owners = selectedBoundaryOwner.get(key) ?? [];
      owners.push({ elementId, boundary });
      selectedBoundaryOwner.set(key, owners);
      for (const nodeId of boundary) {
        selectedBoundaryNodeIds.add(nodeId);
      }
    }
  }

  const pairs: BoundaryPair[] = [];
  if (selectedBoundaryOwner.size === 0) {
    return pairs;
  }

  mesh.elements.forEach((element, index) => {
    const neighborElementId = index + 1;
    if (selected.has(neighborElementId)) {
      return;
    }
    if (!element.some((nodeId) => selectedBoundaryNodeIds.has(nodeId))) {
      return;
    }
    for (const neighborBoundary of boundariesOf(element, kind)) {
      const owners = selectedBoundaryOwner.get(boundaryKey(neighborBoundary));
      if (!owners) {
        continue;
      }
      for (const owner of owners) {
        pairs.push({
          selectedElementId: owner.elementId,
          neighborElementId,
          selectedBoundary: owner.boundary,
          neighborBoundary
        });
      }
    }
  });

  return pairs;
}

export function replaceElements(mesh: Mesh, replacements: readonly ReplaceElement[], mergeTolerance: number): Mesh {
  return mergeCoincidentNodes(
    assembleReplacementMesh(mesh, replacements),
    mergeTolerance
  );
}

export function assembleReplacementMesh(
  mesh: Mesh,
  replacements: readonly ReplaceElement[]
): Mesh {
  const replacedIds = new Set(replacements.map((replacement) => replacement.elementId));
  const nodes: Point[] = [...mesh.nodes];
  const elements: Element[] = mesh.elements.filter((_, index) => !replacedIds.has(index + 1)).map((element) => [...element]);

  for (const { refinement } of replacements) {
    const offset = nodes.length;
    nodes.push(...refinement.nodes);
    elements.push(...refinement.elements.map((element) => element.map((nodeId) => nodeId + offset)));
  }

  return mesh.kind ? { nodes, elements, kind: mesh.kind } : { nodes, elements };
}

export function mergeCoincidentNodes(mesh: Mesh, tolerance: number): Mesh {
  return mergeCoincidentNodesWithMap(mesh, tolerance).mesh;
}

export function mergeCoincidentNodesWithMap(mesh: Mesh, tolerance: number): NodeMergeResult {
  validateRequiredMergeTolerance(tolerance);
  assertFiniteMergeNodes(mesh.nodes);
  assertMergeToleranceBelowFinalEdgeLimit(mesh, tolerance);
  const nodes: Point[] = [];
  const oldToNewArray: number[] = new Array(mesh.nodes.length + 1);
  const inputNodeIdsByNodeIdArray: number[][] = [];
  const buckets = new Map<string, number[]>();
  const exactNodeIndexByKey = new Map<string, number>();
  const bucketLayout = createMergeBucketLayout(mesh.nodes, tolerance);

  mesh.nodes.forEach((node, oldIndex) => {
    const inputNodeId = oldIndex + 1;
    const exactKey = exactMergeKey(node);
    const exactCandidateIndex = exactNodeIndexByKey.get(exactKey);
    const exactIndex = exactCandidateIndex !== undefined
      && pointEquals(nodes[exactCandidateIndex]!, node, 0)
      ? exactCandidateIndex
      : undefined;
    const existingIndex = exactIndex ?? findCoincidentNodeIndex(
      node,
      nodes,
      buckets,
      bucketLayout,
      tolerance
    );
    const newNodeId = existingIndex === undefined ? nodes.length + 1 : existingIndex + 1;
    if (existingIndex === undefined) {
      nodes.push(node);
      exactNodeIndexByKey.set(exactKey, nodes.length - 1);
      addNodeToMergeBucket(
        node,
        nodes.length - 1,
        buckets,
        bucketLayout,
        tolerance
      );
    }
    oldToNewArray[inputNodeId] = newNodeId;
    const inputNodeIds = inputNodeIdsByNodeIdArray[newNodeId] ?? [];
    inputNodeIds.push(inputNodeId);
    inputNodeIdsByNodeIdArray[newNodeId] = inputNodeIds;
  });

  const elements = mesh.elements.map((element) =>
    element.map((nodeId) => {
      const mapped = oldToNewArray[nodeId];
      if (!mapped) {
        throw new Error(`element references missing node id ${nodeId}`);
      }
      return mapped;
    })
  );
  const oldToNew = new Map<number, number>();
  for (let inputNodeId = 1; inputNodeId < oldToNewArray.length; inputNodeId += 1) {
    const nodeId = oldToNewArray[inputNodeId];
    if (nodeId !== undefined) {
      oldToNew.set(inputNodeId, nodeId);
    }
  }
  const inputNodeIdsByNodeId = new Map<number, number[]>();
  for (let nodeId = 1; nodeId < inputNodeIdsByNodeIdArray.length; nodeId += 1) {
    const inputNodeIds = inputNodeIdsByNodeIdArray[nodeId];
    if (inputNodeIds) {
      inputNodeIdsByNodeId.set(nodeId, inputNodeIds);
    }
  }

  return {
    mesh: mesh.kind ? { nodes, elements, kind: mesh.kind } : { nodes, elements },
    nodeIdByInputNodeId: oldToNew,
    inputNodeIdsByNodeId,
    nodeIdByInputNodeIdArray: oldToNewArray,
    inputNodeIdsByNodeIdArray
  };
}

export function validateMergeTolerance(tolerance: unknown): asserts tolerance is number | undefined {
  if (tolerance === undefined) {
    return;
  }
  validateRequiredMergeTolerance(tolerance);
}

function assertFiniteMergeNodes(nodes: readonly Point[]): void {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const nodeId = index + 1;
    if (!Array.isArray(node) || node.length === 0) {
      throw new TypeError(
        `mesh node id ${nodeId} coordinates must be a non-empty array`
      );
    }
    for (let axis = 0; axis < node.length; axis += 1) {
      const coordinate = node[axis];
      if (coordinate === undefined || !Number.isFinite(coordinate)) {
        throw new RangeError(
          `mesh node id ${nodeId} axis ${axis} coordinate must be finite`
        );
      }
    }
  }
}

export function validateRequiredMergeTolerance(
  tolerance: unknown
): asserts tolerance is number {
  if (typeof tolerance !== "number") {
    throw new TypeError("mergeTolerance must be a number");
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new RangeError("mergeTolerance must be finite and nonnegative");
  }
}

export function assertMergeToleranceBelowFinalEdgeLimit(
  mesh: ReadonlyMesh,
  tolerance: number
): void {
  validateRequiredMergeTolerance(tolerance);
  if (mesh.elements.length === 0) {
    return;
  }
  if (inferMeshKind(mesh) === "H1" && minElementEdgeLength(mesh) === 0) {
    throw new RangeError(
      "unmerged mesh contains a zero-length Hex element edge"
    );
  }
  const minimumFinalEdge = minNonzeroElementEdgeLength(mesh);
  if (!Number.isFinite(minimumFinalEdge)) {
    throw new RangeError(
      "unmerged mesh has no distinguishable nonzero element edge"
    );
  }
  if (tolerance === 0) {
    return;
  }
  if (
    tolerance >= minimumFinalEdge / 2
  ) {
    throw new RangeError(
      `mergeTolerance ${tolerance} must be less than half the unmerged final mesh minimum nonzero edge ${minimumFinalEdge}`
    );
  }
}

function findCoincidentNodeIndex(
  node: Point,
  nodes: readonly Point[],
  buckets: ReadonlyMap<string, readonly number[]>,
  layout: MergeBucketLayout,
  tolerance: number
): number | undefined {
  let bestIndex: number | undefined;
  forEachCandidateMergeBucketKey(node, layout, (key) => {
    for (const candidateIndex of buckets.get(key) ?? []) {
      if (
        (bestIndex === undefined || candidateIndex < bestIndex) &&
        pointEquals(nodes[candidateIndex]!, node, tolerance)
      ) {
        bestIndex = candidateIndex;
      }
    }
  });
  return bestIndex;
}

function addNodeToMergeBucket(
  node: Point,
  nodeIndex: number,
  buckets: Map<string, number[]>,
  layout: MergeBucketLayout,
  tolerance: number
): void {
  const key = mergeBucketKey(node, layout);
  const bucket = buckets.get(key) ?? [];
  bucket.push(nodeIndex);
  buckets.set(key, bucket);
}

function exactMergeKey(node: Point): string {
  const coordinates = node.map((coordinate) =>
    Object.is(coordinate, -0) ? 0 : coordinate
  );
  return `${node.length}|${coordinates.join(":")}`;
}

export function minElementEdgeLength(mesh: ReadonlyMesh): number {
  return minimumElementEdgeLength(mesh, false);
}

export function minNonzeroElementEdgeLength(mesh: ReadonlyMesh): number {
  return minimumElementEdgeLength(mesh, true);
}

function minimumElementEdgeLength(
  mesh: ReadonlyMesh,
  nonzeroOnly: boolean
): number {
  const kind = inferMeshKind(mesh);
  const localEdges = kind === "Q1"
    ? [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0]
      ]
    : [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 4],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7]
      ];
  let minimum = Infinity;
  for (const element of mesh.elements) {
    const vertices = elementVertices(mesh, element);
    for (const [a, b] of localEdges) {
      if (a === undefined || b === undefined) {
        throw new Error("invalid local edge definition");
      }
      const pa = vertices[a]!;
      const pb = vertices[b]!;
      const deltas = pa.map((coordinate, dimension) =>
        coordinate - (pb[dimension] ?? 0)
      );
      const length = Math.hypot(...deltas);
      if (!nonzeroOnly || length > 0) {
        minimum = Math.min(minimum, length);
      }
    }
  }
  return minimum;
}

export function instantiateOnElement(mesh: Mesh, elementId: number, factory: (vertices: Point[]) => LocalRefinement): ReplaceElement {
  const element = mesh.elements[elementId - 1];
  if (!element) {
    throw new Error(`element id ${elementId} is out of range`);
  }
  return {
    elementId,
    refinement: factory(elementVertices(mesh, element))
  };
}
