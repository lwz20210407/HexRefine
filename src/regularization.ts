import type { HexIndexRange, HexSelectionRegularizationOptions, Mesh, RegularizedHexSelection } from "./types.js";
import { elementCenter, inferMeshKind, minElementEdgeLength } from "./mesh.js";
import { H1_FACES, boundaryKey } from "./topology.js";

export interface HexElementLattice {
  elementIdByKey: Map<string, number>;
  indicesByElementId: Map<number, [number, number, number]>;
  dimensions: [number, number, number];
  warnings: string[];
}

interface HexFaceOwner {
  elementId: number;
  faceIndex: number;
}

interface HexNeighbor {
  elementId: number;
  delta: [number, number, number];
}

type HexAxis = 0 | 1 | 2;

const H1_FACE_DELTAS: readonly [number, number, number][] = [
  [0, 0, -1],
  [0, 0, 1],
  [0, -1, 0],
  [0, 1, 0],
  [1, 0, 0],
  [-1, 0, 0]
];

const topologyLatticeCache = new WeakMap<Mesh, HexElementLattice | null>();
const geometricTopologyLatticeCache = new WeakMap<Mesh, HexElementLattice | null>();

export function regularizeHexSelection(
  mesh: Mesh,
  candidateElementIds: readonly number[],
  options: HexSelectionRegularizationOptions = {}
): RegularizedHexSelection {
  if (inferMeshKind(mesh) !== "H1") {
    throw new Error("regularizeHexSelection requires an H1/Hex mesh");
  }

  const tolerance = options.tolerance ?? minElementEdgeLength(mesh) * 0.000001;
  const originalElementIds = uniqueSorted(candidateElementIds.filter((elementId) =>
    Number.isInteger(elementId) && elementId >= 1 && elementId <= mesh.elements.length
  ));
  if (originalElementIds.length === 0) {
    return {
      originalElementIds: [],
      selectedElementIds: [],
      addedElementIds: [],
      removedElementIds: [],
      warnings: []
    };
  }

  const lattice = inferHexElementLattice(mesh, tolerance);
  const candidateSet = new Set(originalElementIds);
  const candidateIndices = originalElementIds.map((elementId) => lattice.indicesByElementId.get(elementId));
  if (candidateIndices.some((indices) => indices === undefined)) {
    return {
      originalElementIds,
      selectedElementIds: [],
      addedElementIds: [],
      removedElementIds: originalElementIds,
      gridDimensions: lattice.dimensions,
      warnings: [...lattice.warnings, "some selected elements are outside the inferred regular Hex center lattice"]
    };
  }

  const initialRange = boundingIndexRange(candidateIndices as Array<[number, number, number]>);
  const range = options.boundaryShellOnly
    ? cropToCompleteBoundaryShell(initialRange, candidateSet, lattice)
    : cropToCompleteCandidateBlock(initialRange, candidateSet, lattice);
  if (!range) {
    return {
      originalElementIds,
      selectedElementIds: [],
      addedElementIds: [],
      removedElementIds: originalElementIds,
      gridDimensions: lattice.dimensions,
      warnings: [
        ...lattice.warnings,
        options.boundaryShellOnly
          ? "unable to crop the candidate selection to a complete regular Hex boundary shell"
          : "unable to crop the candidate selection to a complete regular Hex block"
      ]
    };
  }

  const selectedElementIds = idsInRange(range, lattice);
  const selectedSet = new Set(selectedElementIds);
  return {
    originalElementIds,
    selectedElementIds,
    addedElementIds: selectedElementIds.filter((elementId) => !candidateSet.has(elementId)),
    removedElementIds: originalElementIds.filter((elementId) => !selectedSet.has(elementId)),
    gridDimensions: lattice.dimensions,
    indexRange: range,
    warnings: lattice.warnings
  };
}

/**
 * Expand a structured Hex selection to the full transverse section required by
 * the one-direction 2:1 transition planner.
 */
export function regularizeTwoToOneHexSelection(
  mesh: Mesh,
  candidateElementIds: readonly number[],
  options: HexSelectionRegularizationOptions = {}
): RegularizedHexSelection {
  const regularized = regularizeHexSelection(mesh, candidateElementIds, options);
  if (
    regularized.selectedElementIds.length === 0
    || !regularized.indexRange
    || !regularized.gridDimensions
  ) {
    return regularized;
  }

  const tolerance = options.tolerance ?? minElementEdgeLength(mesh) * 0.000001;
  const lattice = inferHexElementLattice(mesh, tolerance);
  const sourceRange = regularized.indexRange;
  const transitionAxis = selectTwoToOneTransitionAxis(
    sourceRange,
    lattice.dimensions,
    options.transitionAxis
  );
  const min = [...sourceRange.min] as [number, number, number];
  const max = [...sourceRange.max] as [number, number, number];

  for (const axis of [0, 1, 2] as const) {
    if (axis === transitionAxis) {
      if (min[axis] === 1) {
        min[axis] = 0;
      }
      if (max[axis] === lattice.dimensions[axis] - 2) {
        max[axis] = lattice.dimensions[axis] - 1;
      }
      continue;
    }
    min[axis] = 0;
    max[axis] = lattice.dimensions[axis] - 1;
  }

  const range = makeIndexRange(min, max);
  const selectedElementIds = idsInRange(range, lattice);
  const selectedSet = new Set(selectedElementIds);
  const originalSet = new Set(regularized.originalElementIds);
  return {
    originalElementIds: regularized.originalElementIds,
    selectedElementIds,
    addedElementIds: selectedElementIds.filter((elementId) => !originalSet.has(elementId)),
    removedElementIds: regularized.originalElementIds.filter((elementId) => !selectedSet.has(elementId)),
    gridDimensions: lattice.dimensions,
    indexRange: range,
    warnings: uniqueStrings([
      ...regularized.warnings,
      `completed the 2:1 selection across logical axes ${transverseAxes(transitionAxis)
        .map((axis) => axis + 1)
        .join(" and ")}; logical axis ${transitionAxis + 1} is the transition direction`
    ])
  };
}

function selectTwoToOneTransitionAxis(
  range: HexIndexRange,
  gridDimensions: [number, number, number],
  requestedAxis?: HexAxis
): HexAxis {
  const candidates = ([0, 1, 2] as const).map((axis) => {
    const min = range.min[axis] === 1 ? 0 : range.min[axis];
    const max = range.max[axis] === gridDimensions[axis] - 2
      ? gridDimensions[axis] - 1
      : range.max[axis];
    const axialLength = max - min + 1;
    const crossSectionSize = transverseAxes(axis)
      .reduce<number>((total, crossAxis) => total * gridDimensions[crossAxis]!, 1);
    return {
      axis,
      completedSize: axialLength * crossSectionSize,
      normalizedLength: range.dimensions[axis]! / gridDimensions[axis]!
    };
  });
  const eligible = candidates.filter(({ axis }) =>
    transverseAxes(axis).every((crossAxis) => gridDimensions[crossAxis] % 2 === 0)
  );
  if (requestedAxis !== undefined) {
    if (!eligible.some(({ axis }) => axis === requestedAxis)) {
      throw new Error(
        `2:1 logical transition axis ${requestedAxis + 1} requires even grid dimensions on both transverse axes`
      );
    }
    return requestedAxis;
  }
  if (eligible.length === 0) {
    throw new Error(
      "2:1 full-section completion requires two even transverse grid dimensions"
    );
  }
  eligible.sort((first, second) =>
    first.completedSize - second.completedSize
    || first.normalizedLength - second.normalizedLength
    || first.axis - second.axis
  );
  return eligible[0]!.axis;
}

function transverseAxes(axis: HexAxis): HexAxis[] {
  return ([0, 1, 2] as const).filter((candidate) => candidate !== axis);
}

export function inferHexElementLattice(mesh: Mesh, tolerance: number): HexElementLattice {
  const topologyLattice = inferHexTopologyLattice(mesh);
  if (topologyLattice) {
    return topologyLattice;
  }
  const geometricTopologyLattice = inferHexGeometricTopologyLattice(mesh, tolerance);
  if (geometricTopologyLattice) {
    return {
      ...geometricTopologyLattice,
      warnings: [
        ...geometricTopologyLattice.warnings,
        "recovered the Hex lattice from shared-face center directions because local corner orientations differ"
      ]
    };
  }
  const centerLattice = inferHexCenterLattice(mesh, tolerance);
  return {
    ...centerLattice,
    warnings: [
      ...centerLattice.warnings,
      "falling back to coordinate-center lattice because topology lattice inference failed"
    ]
  };
}

function inferHexGeometricTopologyLattice(
  mesh: Mesh,
  tolerance: number
): HexElementLattice | undefined {
  if (geometricTopologyLatticeCache.has(mesh)) {
    return geometricTopologyLatticeCache.get(mesh) ?? undefined;
  }
  const centers = mesh.elements.map((element) => elementCenter(mesh, element));
  const faceOwners = new Map<string, HexFaceOwner[]>();
  mesh.elements.forEach((element, index) => {
    const elementId = index + 1;
    H1_FACES.forEach((face, faceIndex) => {
      const key = boundaryKey(face.map((localId) => element[localId - 1]!));
      const owners = faceOwners.get(key) ?? [];
      owners.push({ elementId, faceIndex });
      faceOwners.set(key, owners);
    });
  });
  const interfaces: Array<{
    first: number;
    second: number;
    difference: [number, number, number];
  }> = [];
  for (const owners of faceOwners.values()) {
    if (owners.length !== 2) {
      continue;
    }
    const [first, second] = owners;
    if (!first || !second) {
      continue;
    }
    interfaces.push({
      first: first.elementId,
      second: second.elementId,
      difference: subtract3(
        centers[second.elementId - 1]!,
        centers[first.elementId - 1]!
      )
    });
  }
  const basis = independentDirectionBasis(
    interfaces.map((item) => item.difference),
    tolerance
  );
  if (!basis) {
    geometricTopologyLatticeCache.set(mesh, null);
    return undefined;
  }
  const neighbors = new Map<number, HexNeighbor[]>();
  for (const item of interfaces) {
    const delta = classifyDirectionDelta(item.difference, basis, tolerance);
    if (!delta) {
      geometricTopologyLatticeCache.set(mesh, null);
      return undefined;
    }
    addTopologyNeighbor(neighbors, item.first, item.second, delta);
    addTopologyNeighbor(neighbors, item.second, item.first, negateIndex(delta));
  }

  const rawIndices = new Map<number, [number, number, number]>();
  rawIndices.set(1, [0, 0, 0]);
  const queue = [1];
  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const elementId = queue[queueIndex++]!;
    const current = rawIndices.get(elementId)!;
    for (const neighbor of neighbors.get(elementId) ?? []) {
      const next = addIndex(current, neighbor.delta);
      const existing = rawIndices.get(neighbor.elementId);
      if (existing) {
        if (!sameIndex(existing, next)) {
          geometricTopologyLatticeCache.set(mesh, null);
          return undefined;
        }
        continue;
      }
      rawIndices.set(neighbor.elementId, next);
      queue.push(neighbor.elementId);
    }
  }
  if (rawIndices.size !== mesh.elements.length) {
    geometricTopologyLatticeCache.set(mesh, null);
    return undefined;
  }
  const normalized = normalizeTopologyIndices(rawIndices);
  if (normalized.warnings.length > 0) {
    geometricTopologyLatticeCache.set(mesh, null);
    return undefined;
  }
  geometricTopologyLatticeCache.set(mesh, normalized);
  return normalized;
}

function independentDirectionBasis(
  differences: readonly [number, number, number][],
  tolerance: number
): [[number, number, number], [number, number, number], [number, number, number]] | undefined {
  const first = differences.find((difference) =>
    normSquared3(difference) > tolerance * tolerance
  );
  if (!first) {
    return undefined;
  }
  const second = differences
    .map((difference) => ({
      difference,
      score: normSquared3(cross3(first, difference))
        / Math.max(normSquared3(difference), tolerance * tolerance)
    }))
    .sort((a, b) => b.score - a.score)[0];
  if (!second || second.score <= tolerance * tolerance) {
    return undefined;
  }
  const third = differences
    .map((difference) => ({
      difference,
      score: Math.abs(dot3(first, cross3(second.difference, difference)))
        / Math.max(Math.sqrt(normSquared3(difference)), tolerance)
    }))
    .sort((a, b) => b.score - a.score)[0];
  if (!third || third.score <= tolerance * tolerance) {
    return undefined;
  }
  return [first, second.difference, third.difference];
}

function classifyDirectionDelta(
  difference: [number, number, number],
  basis: readonly [
    [number, number, number],
    [number, number, number],
    [number, number, number]
  ],
  tolerance: number
): [number, number, number] | undefined {
  const coordinates = solveBasisCoordinates(difference, basis, tolerance);
  if (!coordinates) {
    return undefined;
  }
  const ranked = coordinates
    .map((value, axis) => ({ axis, value, magnitude: Math.abs(value) }))
    .sort((first, second) => second.magnitude - first.magnitude);
  const dominant = ranked[0];
  const runnerUp = ranked[1];
  if (
    !dominant
    || dominant.magnitude <= tolerance
    || (runnerUp && dominant.magnitude <= runnerUp.magnitude * 1.5)
  ) {
    return undefined;
  }
  const delta = [0, 0, 0] as [number, number, number];
  delta[dominant.axis] = dominant.value > 0 ? 1 : -1;
  return delta;
}

function solveBasisCoordinates(
  vector: [number, number, number],
  basis: readonly [
    [number, number, number],
    [number, number, number],
    [number, number, number]
  ],
  tolerance: number
): [number, number, number] | undefined {
  const [u, v, w] = basis;
  const determinant = dot3(u, cross3(v, w));
  if (Math.abs(determinant) <= tolerance * tolerance * tolerance) {
    return undefined;
  }
  return [
    dot3(vector, cross3(v, w)) / determinant,
    dot3(u, cross3(vector, w)) / determinant,
    dot3(u, cross3(v, vector)) / determinant
  ];
}

function subtract3(
  second: readonly number[],
  first: readonly number[]
): [number, number, number] {
  return [
    second[0]! - first[0]!,
    second[1]! - first[1]!,
    second[2]! - first[2]!
  ];
}

function negateIndex(
  index: readonly [number, number, number]
): [number, number, number] {
  return [-index[0], -index[1], -index[2]];
}

function cross3(
  first: readonly [number, number, number],
  second: readonly [number, number, number]
): [number, number, number] {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0]
  ];
}

function dot3(
  first: readonly [number, number, number],
  second: readonly [number, number, number]
): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function normSquared3(vector: readonly [number, number, number]): number {
  return dot3(vector, vector);
}

function inferHexTopologyLattice(mesh: Mesh): HexElementLattice | undefined {
  if (topologyLatticeCache.has(mesh)) {
    return topologyLatticeCache.get(mesh) ?? undefined;
  }
  const neighbors = buildHexTopologyNeighbors(mesh);
  const seedElementId = findTopologyCornerSeed(neighbors);
  if (seedElementId === undefined) {
    topologyLatticeCache.set(mesh, null);
    return undefined;
  }

  const rawIndices = new Map<number, [number, number, number]>();
  const queue: number[] = [seedElementId];
  const warnings: string[] = [];
  rawIndices.set(seedElementId, [0, 0, 0]);

  while (queue.length > 0) {
    const elementId = queue.shift()!;
    const current = rawIndices.get(elementId)!;
    for (const neighbor of neighbors.get(elementId) ?? []) {
      const next = addIndex(current, neighbor.delta);
      const existing = rawIndices.get(neighbor.elementId);
      if (existing) {
        if (!sameIndex(existing, next)) {
          warnings.push(`conflicting topology indices for element ${neighbor.elementId}`);
        }
        continue;
      }
      rawIndices.set(neighbor.elementId, next);
      queue.push(neighbor.elementId);
    }
  }

  if (rawIndices.size !== mesh.elements.length) {
    warnings.push("topology lattice did not reach every Hex element");
  }
  if (warnings.length > 0) {
    topologyLatticeCache.set(mesh, null);
    return undefined;
  }

  const normalized = normalizeTopologyIndices(rawIndices);
  const fatalWarnings = normalized.warnings.filter((warning) =>
    warning !== "topology indices do not fill a complete Hex lattice"
  );
  const lattice = fatalWarnings.length === 0 ? normalized : undefined;
  topologyLatticeCache.set(mesh, lattice ?? null);
  return lattice;
}

function buildHexTopologyNeighbors(mesh: Mesh): Map<number, HexNeighbor[]> {
  const faceOwners = new Map<string, HexFaceOwner[]>();
  mesh.elements.forEach((element, index) => {
    const elementId = index + 1;
    H1_FACES.forEach((face, faceIndex) => {
      const key = boundaryKey(face.map((localId) => element[localId - 1]!));
      const owners = faceOwners.get(key) ?? [];
      owners.push({ elementId, faceIndex });
      faceOwners.set(key, owners);
    });
  });

  const neighbors = new Map<number, HexNeighbor[]>();
  for (const owners of faceOwners.values()) {
    if (owners.length !== 2) {
      continue;
    }
    const [a, b] = owners;
    if (!a || !b) {
      continue;
    }
    addTopologyNeighbor(neighbors, a.elementId, b.elementId, H1_FACE_DELTAS[a.faceIndex]!);
    addTopologyNeighbor(neighbors, b.elementId, a.elementId, H1_FACE_DELTAS[b.faceIndex]!);
  }
  return neighbors;
}

function addTopologyNeighbor(
  neighbors: Map<number, HexNeighbor[]>,
  elementId: number,
  neighborElementId: number,
  delta: [number, number, number]
): void {
  const list = neighbors.get(elementId) ?? [];
  list.push({ elementId: neighborElementId, delta });
  neighbors.set(elementId, list);
}

function findTopologyCornerSeed(neighbors: ReadonlyMap<number, readonly HexNeighbor[]>): number | undefined {
  const required = new Set(["1,0,0", "0,1,0", "0,0,1"]);
  for (const elementId of neighbors.keys()) {
    const deltas = new Set((neighbors.get(elementId) ?? []).map((neighbor) => neighbor.delta.join(",")));
    if ([...required].every((delta) => deltas.has(delta))) {
      return elementId;
    }
  }
  return 1;
}

function normalizeTopologyIndices(rawIndices: ReadonlyMap<number, [number, number, number]>): HexElementLattice {
  const mins = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY] as [number, number, number];
  const maxes = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY] as [number, number, number];
  for (const index of rawIndices.values()) {
    for (let axis = 0; axis < 3; axis += 1) {
      mins[axis] = Math.min(mins[axis]!, index[axis]!);
      maxes[axis] = Math.max(maxes[axis]!, index[axis]!);
    }
  }

  const elementIdByKey = new Map<string, number>();
  const indicesByElementId = new Map<number, [number, number, number]>();
  const warnings: string[] = [];
  for (const [elementId, rawIndex] of rawIndices) {
    const index = [
      rawIndex[0] - mins[0],
      rawIndex[1] - mins[1],
      rawIndex[2] - mins[2]
    ] as [number, number, number];
    const key = indexKey(index);
    if (elementIdByKey.has(key)) {
      warnings.push(`multiple elements map to Hex topology index ${key}`);
      continue;
    }
    elementIdByKey.set(key, elementId);
    indicesByElementId.set(elementId, index);
  }

  const dimensions = [
    maxes[0] - mins[0] + 1,
    maxes[1] - mins[1] + 1,
    maxes[2] - mins[2] + 1
  ] as [number, number, number];
  if (dimensions[0] * dimensions[1] * dimensions[2] !== rawIndices.size) {
    warnings.push("topology indices do not fill a complete Hex lattice");
  }

  return {
    elementIdByKey,
    indicesByElementId,
    dimensions,
    warnings: uniqueStrings(warnings)
  };
}

function addIndex(a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sameIndex(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function inferHexCenterLattice(mesh: Mesh, tolerance: number): HexElementLattice {
  const centers = mesh.elements.map((element) => elementCenter(mesh, element));
  const axisValues = [0, 1, 2].map((axis) =>
    uniqueCoordinateValues(centers.map((center) => center[axis] ?? 0), tolerance)
  );
  const dimensions = axisValues.map((values) => values.length) as [number, number, number];
  const warnings: string[] = [];
  if (dimensions[0] * dimensions[1] * dimensions[2] !== mesh.elements.length) {
    warnings.push("element centers do not fill a complete rectilinear Hex lattice");
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if (!isUniform(axisValues[axis]!, tolerance)) {
      warnings.push(`axis ${axis} center spacing is not uniform within tolerance`);
    }
  }

  const elementIdByKey = new Map<string, number>();
  const indicesByElementId = new Map<number, [number, number, number]>();
  centers.forEach((center, index) => {
    const indices = [0, 1, 2].map((axis) =>
      nearestCoordinateIndex(axisValues[axis]!, center[axis] ?? 0, tolerance)
    ) as [number, number, number];
    if (indices.some((value) => value < 0)) {
      return;
    }
    const key = indexKey(indices);
    if (elementIdByKey.has(key)) {
      warnings.push(`multiple elements map to Hex lattice index ${key}`);
      return;
    }
    const elementId = index + 1;
    elementIdByKey.set(key, elementId);
    indicesByElementId.set(elementId, indices);
  });

  return {
    elementIdByKey,
    indicesByElementId,
    dimensions,
    warnings: uniqueStrings(warnings)
  };
}

function uniqueCoordinateValues(values: readonly number[], tolerance: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const unique: number[] = [];
  for (const value of sorted) {
    const last = unique[unique.length - 1];
    if (last === undefined || Math.abs(value - last) > tolerance) {
      unique.push(value);
    }
  }
  return unique;
}

function nearestCoordinateIndex(values: readonly number[], value: number, tolerance: number): number {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  values.forEach((candidate, index) => {
    const distance = Math.abs(candidate - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestDistance <= tolerance ? bestIndex : -1;
}

function isUniform(values: readonly number[], tolerance: number): boolean {
  if (values.length <= 2) {
    return true;
  }
  const expected = values[1]! - values[0]!;
  for (let i = 2; i < values.length; i += 1) {
    if (Math.abs((values[i]! - values[i - 1]!) - expected) > tolerance) {
      return false;
    }
  }
  return true;
}

function boundingIndexRange(indices: readonly [number, number, number][]): HexIndexRange {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY] as [number, number, number];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY] as [number, number, number];
  for (const index of indices) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, index[axis]!);
      max[axis] = Math.max(max[axis]!, index[axis]!);
    }
  }
  return makeIndexRange(min, max);
}

function cropToCompleteCandidateBlock(
  initialRange: HexIndexRange,
  candidateSet: ReadonlySet<number>,
  lattice: HexElementLattice
): HexIndexRange | undefined {
  let range: HexIndexRange | undefined = initialRange;
  let guard = rangeVolume(initialRange) + 1;
  while (range && guard > 0) {
    const stats = rangeStats(range, candidateSet, lattice);
    if (stats.missing === 0) {
      return rangeVolume(range) > 0 ? range : undefined;
    }
    const candidates = shrinkCandidates(range)
      .map((candidate) => ({ range: candidate, stats: rangeStats(candidate, candidateSet, lattice) }))
      .filter((candidate) => rangeVolume(candidate.range) > 0)
      .sort((a, b) =>
        a.stats.missing - b.stats.missing ||
        b.stats.present - a.stats.present ||
        b.stats.volume - a.stats.volume
      );
    range = candidates[0]?.range;
    guard -= 1;
  }
  return undefined;
}

function cropToCompleteBoundaryShell(
  initialRange: HexIndexRange,
  candidateSet: ReadonlySet<number>,
  lattice: HexElementLattice
): HexIndexRange | undefined {
  let range: HexIndexRange | undefined = initialRange;
  let guard = rangeVolume(initialRange) + 1;
  while (range && guard > 0) {
    const stats = boundaryShellStats(range, candidateSet, lattice);
    if (stats.missingDomain === 0 && stats.missingShell === 0) {
      return rangeVolume(range) > 0 ? range : undefined;
    }
    const candidates = shrinkCandidates(range)
      .map((candidate) => ({ range: candidate, stats: boundaryShellStats(candidate, candidateSet, lattice) }))
      .filter((candidate) => rangeVolume(candidate.range) > 0)
      .sort((a, b) =>
        (a.stats.missingDomain + a.stats.missingShell) - (b.stats.missingDomain + b.stats.missingShell) ||
        b.stats.presentShell - a.stats.presentShell ||
        b.stats.volume - a.stats.volume
      );
    range = candidates[0]?.range;
    guard -= 1;
  }
  return undefined;
}

function rangeStats(range: HexIndexRange, candidateSet: ReadonlySet<number>, lattice: HexElementLattice): { volume: number; present: number; missing: number } {
  let present = 0;
  let missing = 0;
  forEachIndexInRange(range, (indices) => {
    const elementId = lattice.elementIdByKey.get(indexKey(indices));
    if (elementId !== undefined && candidateSet.has(elementId)) {
      present += 1;
    } else {
      missing += 1;
    }
  });
  return {
    volume: rangeVolume(range),
    present,
    missing
  };
}

function boundaryShellStats(
  range: HexIndexRange,
  candidateSet: ReadonlySet<number>,
  lattice: HexElementLattice
): { volume: number; presentShell: number; missingShell: number; missingDomain: number } {
  let presentShell = 0;
  let missingShell = 0;
  let missingDomain = 0;
  forEachIndexInRange(range, (indices) => {
    const elementId = lattice.elementIdByKey.get(indexKey(indices));
    if (elementId === undefined) {
      missingDomain += 1;
      return;
    }
    if (!isRequiredTransitionShellIndex(indices, range, lattice.dimensions)) {
      return;
    }
    if (candidateSet.has(elementId)) {
      presentShell += 1;
    } else {
      missingShell += 1;
    }
  });
  return {
    volume: rangeVolume(range),
    presentShell,
    missingShell,
    missingDomain
  };
}

function isRequiredTransitionShellIndex(
  indices: readonly [number, number, number],
  range: HexIndexRange,
  gridDimensions: readonly [number, number, number]
): boolean {
  return (
    (indices[0] === range.min[0] && range.min[0] > 0) ||
    (indices[0] === range.max[0] && range.max[0] < gridDimensions[0] - 1) ||
    (indices[1] === range.min[1] && range.min[1] > 0) ||
    (indices[1] === range.max[1] && range.max[1] < gridDimensions[1] - 1) ||
    (indices[2] === range.min[2] && range.min[2] > 0) ||
    (indices[2] === range.max[2] && range.max[2] < gridDimensions[2] - 1)
  );
}

function shrinkCandidates(range: HexIndexRange): HexIndexRange[] {
  const candidates: HexIndexRange[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    if (range.min[axis]! < range.max[axis]!) {
      const minShrinkMin = [...range.min] as [number, number, number];
      minShrinkMin[axis] = minShrinkMin[axis]! + 1;
      candidates.push(makeIndexRange(minShrinkMin, range.max));

      const maxShrinkMax = [...range.max] as [number, number, number];
      maxShrinkMax[axis] = maxShrinkMax[axis]! - 1;
      candidates.push(makeIndexRange(range.min, maxShrinkMax));
    }
  }
  return candidates;
}

function idsInRange(range: HexIndexRange, lattice: HexElementLattice): number[] {
  const ids: number[] = [];
  forEachIndexInRange(range, (indices) => {
    const elementId = lattice.elementIdByKey.get(indexKey(indices));
    if (elementId !== undefined) {
      ids.push(elementId);
    }
  });
  return uniqueSorted(ids);
}

function forEachIndexInRange(range: HexIndexRange, callback: (indices: [number, number, number]) => void): void {
  for (let i = range.min[0]; i <= range.max[0]; i += 1) {
    for (let j = range.min[1]; j <= range.max[1]; j += 1) {
      for (let k = range.min[2]; k <= range.max[2]; k += 1) {
        callback([i, j, k]);
      }
    }
  }
}

function makeIndexRange(min: readonly [number, number, number], max: readonly [number, number, number]): HexIndexRange {
  return {
    min: [min[0], min[1], min[2]],
    max: [max[0], max[1], max[2]],
    dimensions: [
      max[0] - min[0] + 1,
      max[1] - min[1] + 1,
      max[2] - min[2] + 1
    ]
  };
}

function rangeVolume(range: HexIndexRange): number {
  return range.dimensions[0] * range.dimensions[1] * range.dimensions[2];
}

function indexKey(indices: readonly [number, number, number]): string {
  return `${indices[0]}:${indices[1]}:${indices[2]}`;
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
