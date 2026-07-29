import type {
  RefinementCellGeometrySnapshot
} from "./refinement-history.js";
import type {
  CellId,
  RefinementSession,
  RefinementSessionCellRole
} from "./refinement-session.js";
import type { ElementKind } from "./types.js";

const CELL_ROLES: ReadonlySet<RefinementSessionCellRole> = new Set([
  "base",
  "unchanged",
  "selected",
  "face-transition",
  "edge-transition",
  "corner-transition"
]);

interface IndexedCellGeometry {
  readonly cellId: CellId;
  readonly geometry: RefinementCellGeometrySnapshot;
  readonly metadataKey: string;
  readonly exactKey: string;
}

interface ExactBinary64 {
  readonly significand: bigint;
  readonly exponent: number;
}

const binary64View = new DataView(new ArrayBuffer(8));

export class RefinementCellGeometryMatchError extends Error {
  readonly cellIds: readonly CellId[];

  constructor(message: string, cellIds: readonly CellId[]) {
    super(message);
    this.name = "RefinementCellGeometryMatchError";
    this.cellIds = Object.freeze([...new Set(cellIds)].sort());
  }
}

export function snapshotRefinementCellGeometry(
  session: RefinementSession,
  cellId: CellId
): RefinementCellGeometrySnapshot {
  const cell = session.cells.get(cellId);
  if (cell === undefined) {
    throw new RefinementCellGeometryMatchError(
      `cannot snapshot missing cell ${cellId}`,
      [cellId]
    );
  }

  const points: number[][] = [];
  for (let index = 0; index < cell.element.length; index += 1) {
    const nodeId = cell.element[index];
    const point = nodeId === undefined
      ? undefined
      : session.nodes[nodeId - 1];
    if (point === undefined) {
      throw new RefinementCellGeometryMatchError(
        `cell ${cellId} references missing node ${String(nodeId)}`,
        [cellId]
      );
    }
    if (!Array.isArray(point)) {
      throw new RefinementCellGeometryMatchError(
        `cell ${cellId} point ${index + 1} must be an array`,
        [cellId]
      );
    }
    points.push([...point]);
  }

  return cloneAndValidateGeometry({
    originalCellId: cellId,
    kind: cell.kind,
    level: cell.level,
    role: cell.role,
    points
  }, cellId);
}

export class RefinementCellGeometryIndex {
  readonly tolerance: number;

  readonly #candidateByCellId = new Map<CellId, IndexedCellGeometry>();
  readonly #exactBuckets = new Map<string, IndexedCellGeometry[]>();
  readonly #metadataBuckets = new Map<string, IndexedCellGeometry[]>();

  constructor(tolerance: number) {
    if (!Number.isFinite(tolerance) || tolerance < 0) {
      throw new RangeError(
        "tolerance must be finite and nonnegative"
      );
    }
    this.tolerance = tolerance;
  }

  add(
    cellId: CellId,
    geometry: RefinementCellGeometrySnapshot
  ): void {
    assertCellId(cellId);
    if (this.#candidateByCellId.has(cellId)) {
      throw new RefinementCellGeometryMatchError(
        `duplicate candidate cell id ${cellId}`,
        [cellId]
      );
    }

    const snapshot = freezeGeometry(
      cloneAndValidateGeometry(geometry, cellId)
    );
    const candidate = Object.freeze({
      cellId,
      geometry: snapshot,
      metadataKey: geometryMetadataKey(snapshot),
      exactKey: exactGeometryKey(snapshot)
    });
    this.#candidateByCellId.set(cellId, candidate);
    appendBucket(
      this.#exactBuckets,
      candidate.exactKey,
      candidate
    );
    appendBucket(
      this.#metadataBuckets,
      candidate.metadataKey,
      candidate
    );
  }

  uniqueMatch(
    geometry: RefinementCellGeometrySnapshot
  ): CellId | undefined {
    const query = cloneAndValidateGeometry(
      geometry,
      diagnosticCellId(geometry)
    );
    const metadataKey = geometryMetadataKey(query);
    const original = this.#candidateByCellId.get(
      query.originalCellId
    );
    if (
      original !== undefined
      && original.metadataKey === metadataKey
      && pointSetsMatch(
        query.points,
        original.geometry.points,
        this.tolerance
      )
    ) {
      return original.cellId;
    }

    const exactMatches = (
      this.#exactBuckets.get(exactGeometryKey(query)) ?? []
    ).filter((candidate) =>
      candidate.metadataKey === metadataKey
      && pointSetsMatch(
        query.points,
        candidate.geometry.points,
        0
      )
    );
    const exact = uniqueCandidateId(exactMatches);
    if (exact !== undefined || exactMatches.length > 0) {
      return exact;
    }

    const toleranceMatches = (
      this.#metadataBuckets.get(metadataKey) ?? []
    ).filter((candidate) =>
      pointSetsMatch(
        query.points,
        candidate.geometry.points,
        this.tolerance
      )
    );
    return uniqueCandidateId(toleranceMatches);
  }
}

function uniqueCandidateId(
  candidates: readonly IndexedCellGeometry[]
): CellId | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  if (candidates.length === 1) {
    return candidates[0]!.cellId;
  }
  throw new RefinementCellGeometryMatchError(
    "cell geometry matches multiple candidate cells",
    candidates.map((candidate) => candidate.cellId)
  );
}

function cloneAndValidateGeometry(
  geometry: RefinementCellGeometrySnapshot,
  cellId: CellId
): RefinementCellGeometrySnapshot {
  if (geometry === null || typeof geometry !== "object") {
    throw geometryError(cellId, "geometry must be an object");
  }

  const originalCellId = geometry.originalCellId;
  const kind = geometry.kind;
  const level = geometry.level;
  const role = geometry.role;
  const sourcePoints = geometry.points;
  if (
    typeof originalCellId !== "string"
    || originalCellId.length === 0
  ) {
    throw geometryError(
      cellId,
      "originalCellId must be a nonempty string"
    );
  }
  if (kind !== "Q1" && kind !== "H1") {
    throw geometryError(cellId, "kind must be Q1 or H1");
  }
  if (!Number.isInteger(level) || level < 0) {
    throw geometryError(
      cellId,
      "level must be a nonnegative integer"
    );
  }
  if (!CELL_ROLES.has(role)) {
    throw geometryError(
      cellId,
      "role is not a supported refinement cell role"
    );
  }
  if (!Array.isArray(sourcePoints) || sourcePoints.length === 0) {
    throw geometryError(
      cellId,
      "geometry must contain at least one point"
    );
  }

  const points: number[][] = [];
  let dimension: number | undefined;
  for (let pointIndex = 0; pointIndex < sourcePoints.length; pointIndex += 1) {
    if (!(pointIndex in sourcePoints)) {
      throw geometryError(
        cellId,
        `points must be dense: missing index ${pointIndex}`
      );
    }
    const sourcePoint = sourcePoints[pointIndex];
    if (!Array.isArray(sourcePoint) || sourcePoint.length === 0) {
      throw geometryError(
        cellId,
        `point ${pointIndex + 1} must contain at least one coordinate`
      );
    }
    if (dimension === undefined) {
      dimension = sourcePoint.length;
    } else if (sourcePoint.length !== dimension) {
      throw geometryError(
        cellId,
        "points must have the same dimension"
      );
    }

    const point: number[] = [];
    for (
      let coordinateIndex = 0;
      coordinateIndex < sourcePoint.length;
      coordinateIndex += 1
    ) {
      if (!(coordinateIndex in sourcePoint)) {
        throw geometryError(
          cellId,
          `point ${pointIndex + 1} coordinates must be dense`
        );
      }
      const coordinate = sourcePoint[coordinateIndex];
      if (!Number.isFinite(coordinate)) {
        throw geometryError(
          cellId,
          `point ${pointIndex + 1} coordinates must be finite`
        );
      }
      point.push(coordinate);
    }
    points.push(point);
  }

  assertNotCollapsed(kind, points, cellId);
  return {
    originalCellId,
    kind,
    level,
    role,
    points
  };
}

function assertNotCollapsed(
  kind: ElementKind,
  points: readonly (readonly number[])[],
  cellId: CellId
): void {
  const pointKeys = new Set<string>();
  for (const point of points) {
    const key = exactPointKey(point);
    if (pointKeys.has(key)) {
      throw geometryError(
        cellId,
        `${kind} geometry is collapsed: repeated corners`
      );
    }
    pointKeys.add(key);
  }

  const requiredRank = kind === "Q1" ? 2 : 3;
  if (!hasExactAffineRankAtLeast(points, requiredRank)) {
    throw geometryError(
      cellId,
      `${kind} geometry is collapsed`
    );
  }
}

function hasExactAffineRankAtLeast(
  points: readonly (readonly number[])[],
  requiredRank: number
): boolean {
  const dimension = points[0]!.length;
  const rowCount = points.length - 1;
  if (
    requiredRank <= 0
    || Math.min(rowCount, dimension) < requiredRank
  ) {
    return requiredRank <= 0;
  }

  const matrix = exactAffineDifferenceMatrix(points);
  let pivotRow = 0;
  for (
    let column = 0;
    column < dimension && pivotRow < rowCount;
    column += 1
  ) {
    let sourceRow = pivotRow;
    while (
      sourceRow < rowCount
      && matrix[sourceRow]![column] === 0n
    ) {
      sourceRow += 1;
    }
    if (sourceRow === rowCount) {
      continue;
    }
    if (sourceRow !== pivotRow) {
      [matrix[pivotRow], matrix[sourceRow]] = [
        matrix[sourceRow]!,
        matrix[pivotRow]!
      ];
    }
    reduceIntegerRow(matrix[pivotRow]!, column);
    const pivot = matrix[pivotRow]![column]!;
    for (let rowIndex = pivotRow + 1; rowIndex < rowCount; rowIndex += 1) {
      const row = matrix[rowIndex]!;
      const factor = row[column]!;
      if (factor === 0n) {
        continue;
      }
      const commonFactor = bigintGcd(
        bigintAbs(pivot),
        bigintAbs(factor)
      );
      const pivotMultiplier = pivot / commonFactor;
      const rowMultiplier = factor / commonFactor;
      for (
        let innerColumn = column + 1;
        innerColumn < dimension;
        innerColumn += 1
      ) {
        row[innerColumn] = pivotMultiplier * row[innerColumn]!
          - rowMultiplier * matrix[pivotRow]![innerColumn]!;
      }
      row[column] = 0n;
      reduceIntegerRow(row, column + 1);
    }
    pivotRow += 1;
    if (pivotRow >= requiredRank) {
      return true;
    }
  }
  return false;
}

function exactAffineDifferenceMatrix(
  points: readonly (readonly number[])[]
): bigint[][] {
  const rowCount = points.length - 1;
  const dimension = points[0]!.length;
  const matrix = Array.from(
    { length: rowCount },
    () => Array.from({ length: dimension }, () => 0n)
  );

  for (
    let coordinateIndex = 0;
    coordinateIndex < dimension;
    coordinateIndex += 1
  ) {
    const decomposed = points.map((point) =>
      decomposeFiniteBinary64(point[coordinateIndex]!)
    );
    let minimumExponent = Number.POSITIVE_INFINITY;
    for (const value of decomposed) {
      if (value.significand !== 0n) {
        minimumExponent = Math.min(
          minimumExponent,
          value.exponent
        );
      }
    }
    if (!Number.isFinite(minimumExponent)) {
      continue;
    }
    const scaledCoordinates = decomposed.map((value) =>
      value.significand === 0n
        ? 0n
        : value.significand
          << BigInt(value.exponent - minimumExponent)
    );
    const base = scaledCoordinates[0]!;
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      matrix[rowIndex]![coordinateIndex] =
        scaledCoordinates[rowIndex + 1]! - base;
    }
  }
  return matrix;
}

function decomposeFiniteBinary64(value: number): ExactBinary64 {
  binary64View.setFloat64(0, value, false);
  const highBits = binary64View.getUint32(0, false);
  const lowBits = binary64View.getUint32(4, false);
  const exponentBits = (highBits >>> 20) & 0x7ff;
  const fraction = (
    BigInt(highBits & 0x000fffff) << 32n
  ) | BigInt(lowBits);
  if (exponentBits === 0 && fraction === 0n) {
    return { significand: 0n, exponent: 0 };
  }
  if (exponentBits === 0x7ff) {
    throw new Error("exact affine rank requires finite coordinates");
  }

  let significand = exponentBits === 0
    ? fraction
    : (1n << 52n) | fraction;
  let exponent = exponentBits === 0
    ? -1074
    : exponentBits - 1075;
  while ((significand & 1n) === 0n) {
    significand >>= 1n;
    exponent += 1;
  }
  if ((highBits & 0x80000000) !== 0) {
    significand = -significand;
  }
  return { significand, exponent };
}

function reduceIntegerRow(
  row: bigint[],
  startColumn: number
): void {
  let divisor = 0n;
  for (let column = startColumn; column < row.length; column += 1) {
    divisor = bigintGcd(divisor, bigintAbs(row[column]!));
    if (divisor === 1n) {
      break;
    }
  }
  if (divisor > 1n) {
    for (let column = startColumn; column < row.length; column += 1) {
      row[column] = row[column]! / divisor;
    }
  }
  const firstNonzero = row
    .slice(startColumn)
    .find((value) => value !== 0n);
  if (firstNonzero !== undefined && firstNonzero < 0n) {
    for (let column = startColumn; column < row.length; column += 1) {
      row[column] = -row[column]!;
    }
  }
}

function bigintGcd(first: bigint, second: bigint): bigint {
  let a = first;
  let b = second;
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

function bigintAbs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function pointSetsMatch(
  query: readonly (readonly number[])[],
  candidate: readonly (readonly number[])[],
  tolerance: number
): boolean {
  if (
    query.length !== candidate.length
    || query[0]!.length !== candidate[0]!.length
  ) {
    return false;
  }
  const candidatesByQueryPoint = query.map((queryPoint) =>
    candidate.flatMap((candidatePoint, candidateIndex) =>
      pointsWithinTolerance(queryPoint, candidatePoint, tolerance)
        ? [candidateIndex]
        : []
    )
  );
  if (candidatesByQueryPoint.some((indices) => indices.length === 0)) {
    return false;
  }
  return hasCompletePointMatching(
    candidatesByQueryPoint,
    candidate.length
  );
}

function pointsWithinTolerance(
  first: readonly number[],
  second: readonly number[],
  tolerance: number
): boolean {
  if (first.length !== second.length) {
    return false;
  }
  if (tolerance === 0) {
    return first.every(
      (coordinate, index) => coordinate === second[index]
    );
  }

  const scaledDeltas: number[] = [];
  for (let index = 0; index < first.length; index += 1) {
    const delta = Math.abs(first[index]! - second[index]!);
    if (!Number.isFinite(delta) || delta > tolerance) {
      return false;
    }
    scaledDeltas.push(delta / tolerance);
  }
  return Math.hypot(...scaledDeltas) <= 1;
}

function hasCompletePointMatching(
  candidatesByQueryPoint: readonly (readonly number[])[],
  candidateCount: number
): boolean {
  if (candidatesByQueryPoint.length !== candidateCount) {
    return false;
  }
  const sortedCandidatesByQueryPoint = candidatesByQueryPoint.map(
    (candidates) => [...candidates].sort((a, b) => a - b)
  );
  const queryOrder = sortedCandidatesByQueryPoint
    .map((candidates, queryIndex) => ({
      queryIndex,
      candidateCount: candidates.length
    }))
    .sort((first, second) =>
      first.candidateCount - second.candidateCount
      || first.queryIndex - second.queryIndex
    );
  const matchedQueryByCandidate = Array.from(
    { length: candidateCount },
    () => -1
  );
  const tryAugment = (
    queryIndex: number,
    visitedCandidates: boolean[]
  ): boolean => {
    for (
      const candidateIndex of
        sortedCandidatesByQueryPoint[queryIndex]!
    ) {
      if (visitedCandidates[candidateIndex]) {
        continue;
      }
      visitedCandidates[candidateIndex] = true;
      const matchedQuery = matchedQueryByCandidate[candidateIndex]!;
      if (
        matchedQuery === -1
        || tryAugment(matchedQuery, visitedCandidates)
      ) {
        matchedQueryByCandidate[candidateIndex] = queryIndex;
        return true;
      }
    }
    return false;
  };

  let matchingSize = 0;
  for (const { queryIndex } of queryOrder) {
    const visitedCandidates = Array.from(
      { length: candidateCount },
      () => false
    );
    if (tryAugment(queryIndex, visitedCandidates)) {
      matchingSize += 1;
    }
  }
  return matchingSize === candidatesByQueryPoint.length;
}

function geometryMetadataKey(
  geometry: RefinementCellGeometrySnapshot
): string {
  return JSON.stringify([
    geometry.kind,
    geometry.level,
    geometry.role,
    geometry.points.length,
    geometry.points[0]!.length
  ]);
}

function exactGeometryKey(
  geometry: RefinementCellGeometrySnapshot
): string {
  return JSON.stringify([
    geometryMetadataKey(geometry),
    geometry.points.map(exactPointKey).sort()
  ]);
}

function exactPointKey(point: readonly number[]): string {
  return JSON.stringify(
    point.map((coordinate) => coordinate === 0 ? 0 : coordinate)
  );
}

function appendBucket(
  buckets: Map<string, IndexedCellGeometry[]>,
  key: string,
  candidate: IndexedCellGeometry
): void {
  const bucket = buckets.get(key);
  if (bucket === undefined) {
    buckets.set(key, [candidate]);
  } else {
    bucket.push(candidate);
  }
}

function freezeGeometry(
  geometry: RefinementCellGeometrySnapshot
): RefinementCellGeometrySnapshot {
  for (const point of geometry.points) {
    Object.freeze(point);
  }
  Object.freeze(geometry.points);
  return Object.freeze(geometry);
}

function assertCellId(cellId: CellId): void {
  if (typeof cellId !== "string" || cellId.length === 0) {
    throw new RefinementCellGeometryMatchError(
      "candidate cell id must be a nonempty string",
      []
    );
  }
}

function diagnosticCellId(
  geometry: RefinementCellGeometrySnapshot
): CellId {
  return geometry !== null
    && typeof geometry === "object"
    && typeof geometry.originalCellId === "string"
    && geometry.originalCellId.length > 0
    ? geometry.originalCellId
    : "";
}

function geometryError(
  cellId: CellId,
  message: string
): RefinementCellGeometryMatchError {
  return new RefinementCellGeometryMatchError(
    cellId.length === 0 ? message : `cell ${cellId} ${message}`,
    cellId.length === 0 ? [] : [cellId]
  );
}
