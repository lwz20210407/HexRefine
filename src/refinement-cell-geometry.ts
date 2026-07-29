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
  if (affineRank(points) < requiredRank) {
    throw geometryError(
      cellId,
      `${kind} geometry is collapsed`
    );
  }
}

function affineRank(
  points: readonly (readonly number[])[]
): number {
  const dimension = points[0]!.length;
  if (dimension === 0 || points.length < 2) {
    return 0;
  }

  const coordinateScales = Array.from(
    { length: dimension },
    (_, coordinateIndex) => Math.max(
      ...points.map((point) => Math.abs(point[coordinateIndex]!))
    )
  );
  const normalized = points
    .map((point) =>
      Array.from(
        { length: dimension },
        (_, index) => coordinateScales[index] === 0
          ? 0
          : point[index]! / coordinateScales[index]!
      )
    )
    .sort(comparePoints);
  const origin = normalized[0]!;
  const rows = normalized.slice(1).map((point) =>
    point.map((coordinate, index) => coordinate - origin[index]!)
  );
  for (
    let coordinateIndex = 0;
    coordinateIndex < dimension;
    coordinateIndex += 1
  ) {
    const span = Math.max(
      ...rows.map((row) => Math.abs(row[coordinateIndex]!))
    );
    if (span === 0) {
      continue;
    }
    for (const row of rows) {
      row[coordinateIndex] = row[coordinateIndex]! / span;
    }
  }
  const threshold = Number.EPSILON
    * Math.max(points.length, dimension)
    * 16;
  let rank = 0;

  for (
    let column = 0;
    column < dimension && rank < rows.length;
    column += 1
  ) {
    let pivotRow = rank;
    for (let row = rank + 1; row < rows.length; row += 1) {
      if (
        Math.abs(rows[row]![column]!)
        > Math.abs(rows[pivotRow]![column]!)
      ) {
        pivotRow = row;
      }
    }
    const pivot = rows[pivotRow]![column]!;
    if (Math.abs(pivot) <= threshold) {
      continue;
    }
    [rows[rank], rows[pivotRow]] = [rows[pivotRow]!, rows[rank]!];
    for (let row = rank + 1; row < rows.length; row += 1) {
      const rowValues = rows[row]!;
      const factor = rowValues[column]! / rows[rank]![column]!;
      for (
        let innerColumn = column;
        innerColumn < dimension;
        innerColumn += 1
      ) {
        rowValues[innerColumn] = rowValues[innerColumn]!
          - factor * rows[rank]![innerColumn]!;
      }
    }
    rank += 1;
  }
  return rank;
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

function comparePoints(
  first: readonly number[],
  second: readonly number[]
): number {
  for (let index = 0; index < first.length; index += 1) {
    const difference = first[index]! - second[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
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
