import {
  TwoToOnePlanningError,
  type TwoToOneEntityId
} from "./two-to-one-capability.js";
import type { Point } from "./types.js";

export interface GeometricFace<T> {
  owner: T;
  nodeIds: readonly number[];
  points: readonly Point[];
}

type BucketCoordinate = readonly [number, number, number];
type Vector3 = readonly [number, number, number];
type QuadOrder = readonly [number, number, number, number];
type PointCorrespondence = "none" | "approximate" | "exact";

interface NormalizedFacePair {
  first: readonly Vector3[];
  second: readonly Vector3[];
  toleranceRatio: number;
}

interface NormalizedSingleFace {
  points: readonly Vector3[];
  span: number;
}

interface FaceGeometry {
  normalLength: number;
  unitNormal: Vector3;
  area: number;
  perimeter: number;
}

interface GeometryCandidate {
  normal: Vector3;
  normalLength: number;
  area: number;
  perimeter: number;
  orderedPoints: readonly Vector3[];
}

const QUAD_PERMUTATIONS = [
  [0, 1, 2, 3],
  [0, 1, 3, 2],
  [0, 2, 1, 3],
  [0, 2, 3, 1],
  [0, 3, 1, 2],
  [0, 3, 2, 1],
  [1, 0, 2, 3],
  [1, 0, 3, 2],
  [1, 2, 0, 3],
  [1, 2, 3, 0],
  [1, 3, 0, 2],
  [1, 3, 2, 0],
  [2, 0, 1, 3],
  [2, 0, 3, 1],
  [2, 1, 0, 3],
  [2, 1, 3, 0],
  [2, 3, 0, 1],
  [2, 3, 1, 0],
  [3, 0, 1, 2],
  [3, 0, 2, 1],
  [3, 1, 0, 2],
  [3, 1, 2, 0],
  [3, 2, 0, 1],
  [3, 2, 1, 0]
] as const;

/**
 * Incremental face index for mesh construction. Call `uniqueMatch(query)`
 * before `add(query)`. Exact node-id identity is authoritative for a
 * registered face, so an exact hit never falls back to geometrically similar
 * faces carrying different node ids.
 */
export class GeometricFaceIndex<T extends TwoToOneEntityId> {
  private readonly exact = new Map<string, GeometricFace<T>[]>();
  private readonly buckets = new Map<string, GeometricFace<T>[]>();
  private readonly registrations = new WeakMap<GeometricFace<T>, GeometricFace<T>>();
  private readonly canonicalOrders = new WeakMap<GeometricFace<T>, QuadOrder | null>();
  private bucketOrigin: Vector3 | undefined;

  constructor(readonly tolerance: number) {
    if (!Number.isFinite(tolerance) || tolerance <= 0) {
      throw new RangeError("tolerance must be finite and greater than zero");
    }
  }

  add(face: GeometricFace<T>): void {
    assertFaceObject(face);
    const registered = this.registrations.get(face);
    if (registered !== undefined) {
      assertStoredValuesUnchanged(face, registered);
      return;
    }

    assertQuad(face);
    const stored = snapshotFace(face);
    const canonicalOrder = canonicalPointOrder(stored.points) ?? null;
    const minimum = minimumPoint(stored.points);
    const bucketOrigin = this.bucketOrigin ?? minimum;
    const bucketKey = coordinateKey(bucketCoordinate(
      minimum,
      bucketOrigin,
      this.tolerance
    ));
    const exactKey = nodeIdKey(stored.nodeIds);

    const exactFaces = this.exact.get(exactKey);
    if (exactFaces === undefined) {
      this.exact.set(exactKey, [stored]);
    } else {
      exactFaces.push(stored);
    }

    const bucketFaces = this.buckets.get(bucketKey);
    if (bucketFaces === undefined) {
      this.buckets.set(bucketKey, [stored]);
    } else {
      bucketFaces.push(stored);
    }

    this.bucketOrigin = bucketOrigin;
    this.registrations.set(face, stored);
    this.registrations.set(stored, stored);
    this.canonicalOrders.set(stored, canonicalOrder);
  }

  /**
   * Returns exact node-id matches first. Geometry is consulted only when no
   * exact identity exists.
   */
  matches(face: GeometricFace<T>): GeometricFace<T>[] {
    const query = this.resolveFace(face);
    return this.matchesResolved(query);
  }

  uniqueMatch(face: GeometricFace<T>): GeometricFace<T> | undefined {
    const query = this.resolveFace(face);
    const matches = this.matchesResolved(query);
    if (matches.length === 0) {
      return undefined;
    }
    if (matches.length === 1) {
      return matches[0];
    }

    throw new TwoToOnePlanningError<T>(
      "TWO_TO_ONE_AMBIGUOUS_FACE",
      `face owned by ${query.owner} has ${matches.length} matches`,
      {
        conflictingCellIds: uniqueOwners([
          query.owner,
          ...matches.map((match) => match.owner)
        ]),
        conflictingInterfaces: [],
        attemptedActions: []
      }
    );
  }

  private resolveFace(face: GeometricFace<T>): GeometricFace<T> {
    assertFaceObject(face);
    const registered = this.registrations.get(face);
    if (registered !== undefined) {
      assertStoredValuesUnchanged(face, registered);
      return registered;
    }
    assertQuad(face);
    return face;
  }

  private matchesResolved(face: GeometricFace<T>): GeometricFace<T>[] {
    const exactFaces = this.exact.get(nodeIdKey(face.nodeIds));
    if (exactFaces !== undefined) {
      return [...exactFaces];
    }

    if (this.bucketOrigin === undefined) {
      return [];
    }

    const center = bucketCoordinate(
      minimumPoint(face.points),
      this.bucketOrigin,
      this.tolerance
    );
    let queryOrder = this.canonicalOrders.get(face);
    const getQueryOrder = (): QuadOrder | null => {
      if (queryOrder === undefined) {
        queryOrder = canonicalPointOrder(face.points) ?? null;
      }
      return queryOrder;
    };
    const seen = new Set<GeometricFace<T>>();
    const matches: GeometricFace<T>[] = [];
    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        for (let zOffset = -1; zOffset <= 1; zOffset += 1) {
          const neighbor = offsetBucket(center, xOffset, yOffset, zOffset);
          if (neighbor === undefined) {
            continue;
          }
          const candidates = this.buckets.get(coordinateKey(neighbor));
          if (candidates === undefined) {
            continue;
          }
          for (const candidate of candidates) {
            if (seen.has(candidate)) {
              continue;
            }
            seen.add(candidate);
            const candidateOrder = this.canonicalOrders.get(candidate) ?? null;
            if (geometricallySameFace(
              candidate.points,
              candidateOrder,
              face.points,
              getQueryOrder,
              this.tolerance
            )) {
              matches.push(candidate);
            }
          }
        }
      }
    }
    return matches;
  }
}

function assertFaceObject(face: unknown): asserts face is object {
  if (typeof face !== "object" || face === null) {
    throw new TypeError("face must be an object");
  }
}

function assertQuad<T>(face: GeometricFace<T>): void {
  assertFaceObject(face);
  assertOwner(face.owner);
  if (!Array.isArray(face.nodeIds) || !Array.isArray(face.points)) {
    throw new TypeError("face nodeIds and points must be arrays");
  }
  if (face.nodeIds.length !== 4 || face.points.length !== 4) {
    throw new TypeError("face must have exactly four node ids and four points");
  }

  for (const nodeId of face.nodeIds) {
    if (!Number.isSafeInteger(nodeId) || nodeId <= 0) {
      throw new TypeError("face node ids must be positive safe integers");
    }
  }
  if (new Set(face.nodeIds).size !== 4) {
    throw new TypeError("face node ids must be distinct");
  }
  for (const point of face.points) {
    if (!Array.isArray(point) || point.length < 3) {
      throw new TypeError("face points must have at least three coordinates");
    }
    for (let axis = 0; axis < 3; axis += 1) {
      const coordinate = point[axis];
      if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) {
        throw new TypeError("the first three face point coordinates must be finite numbers");
      }
    }
  }
}

function assertOwner(owner: unknown): asserts owner is TwoToOneEntityId {
  if (
    typeof owner !== "string"
    && !(typeof owner === "number" && Number.isSafeInteger(owner))
  ) {
    throw new TypeError("face owner must be a string or safe integer");
  }
}

function snapshotFace<T>(face: GeometricFace<T>): GeometricFace<T> {
  const nodeIds = Object.freeze([...face.nodeIds]);
  const points = Object.freeze(face.points.map((point) => Object.freeze([
    point[0]!,
    point[1]!,
    point[2]!
  ])));
  return Object.freeze({
    owner: face.owner,
    nodeIds,
    points
  });
}

function assertStoredValuesUnchanged<T>(
  face: GeometricFace<T>,
  stored: GeometricFace<T>
): void {
  if (!sameStoredValues(face, stored)) {
    throw new TypeError("face was modified after it was added");
  }
}

function sameStoredValues<T>(
  face: GeometricFace<T>,
  stored: GeometricFace<T>
): boolean {
  if (
    !Object.is(face.owner, stored.owner)
    || !Array.isArray(face.nodeIds)
    || !Array.isArray(face.points)
    || face.nodeIds.length !== 4
    || face.points.length !== 4
  ) {
    return false;
  }

  for (let index = 0; index < 4; index += 1) {
    if (!Object.is(face.nodeIds[index], stored.nodeIds[index])) {
      return false;
    }
    const point = face.points[index];
    const storedPoint = stored.points[index]!;
    if (!Array.isArray(point) || point.length < 3) {
      return false;
    }
    for (let axis = 0; axis < 3; axis += 1) {
      if (!Object.is(point[axis], storedPoint[axis])) {
        return false;
      }
    }
  }
  return true;
}

function nodeIdKey(nodeIds: readonly number[]): string {
  return [...nodeIds].sort((first, second) => first - second).join(":");
}

function minimumPoint(points: readonly Point[]): Vector3 {
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let minimumZ = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const [x, y, z] = point3(point);
    minimumX = Math.min(minimumX, x);
    minimumY = Math.min(minimumY, y);
    minimumZ = Math.min(minimumZ, z);
  }
  return [minimumX, minimumY, minimumZ];
}

function bucketCoordinate(
  minimum: Vector3,
  origin: Vector3,
  tolerance: number
): BucketCoordinate {
  return [
    bucketAxis(minimum[0], origin[0], tolerance),
    bucketAxis(minimum[1], origin[1], tolerance),
    bucketAxis(minimum[2], origin[2], tolerance)
  ];
}

function bucketAxis(minimum: number, origin: number, tolerance: number): number {
  const offset = minimum - origin;
  const scaled = offset / tolerance;
  const bucket = Math.floor(scaled);
  if (
    !Number.isFinite(offset)
    || !Number.isFinite(scaled)
    || !Number.isSafeInteger(bucket)
  ) {
    throw new RangeError("face bucket coordinate exceeds the safe integer range");
  }
  return bucket;
}

function offsetBucket(
  center: BucketCoordinate,
  xOffset: number,
  yOffset: number,
  zOffset: number
): BucketCoordinate | undefined {
  const x = center[0] + xOffset;
  const y = center[1] + yOffset;
  const z = center[2] + zOffset;
  if (
    !Number.isSafeInteger(x)
    || !Number.isSafeInteger(y)
    || !Number.isSafeInteger(z)
  ) {
    return undefined;
  }
  return [x, y, z];
}

function coordinateKey(coordinate: BucketCoordinate): string {
  return coordinate.join(":");
}

function geometricallySameFace(
  first: readonly Point[],
  firstOrder: QuadOrder | null,
  second: readonly Point[],
  getSecondOrder: () => QuadOrder | null,
  tolerance: number
): boolean {
  const correspondence = pointCorrespondence(first, second, tolerance);
  if (correspondence === "none") {
    return false;
  }
  const secondOrder = getSecondOrder();
  if (
    firstOrder === null
    || secondOrder === null
    || !isValidSingleFace(first, firstOrder, tolerance)
    || !isValidSingleFace(second, secondOrder, tolerance)
  ) {
    return false;
  }
  if (correspondence === "exact") {
    return true;
  }

  const normalized = normalizeFacePair(first, second, tolerance);
  if (normalized === undefined) {
    return false;
  }
  const firstGeometry = faceGeometry(normalized.first, firstOrder);
  const secondGeometry = faceGeometry(normalized.second, secondOrder);
  if (firstGeometry === undefined || secondGeometry === undefined) {
    return false;
  }

  const absoluteNormalDot = Math.abs(dot(firstGeometry.unitNormal, secondGeometry.unitNormal));
  if (!Number.isFinite(absoluteNormalDot) || absoluteNormalDot < 1 - 1e-8) {
    return false;
  }
  const areaDifference = Math.abs(firstGeometry.area - secondGeometry.area);
  const maximumPerimeter = Math.max(firstGeometry.perimeter, secondGeometry.perimeter);
  const areaTolerance = normalized.toleranceRatio * maximumPerimeter
    + normalized.toleranceRatio * normalized.toleranceRatio;
  if (
    !Number.isFinite(areaDifference)
    || !Number.isFinite(maximumPerimeter)
    || !Number.isFinite(areaTolerance)
    || areaDifference > areaTolerance
  ) {
    return false;
  }

  const planeOrigin = normalized.first[0]!;
  for (const point of normalized.first) {
    const distance = pointToPlaneDistance(point, planeOrigin, firstGeometry.unitNormal);
    if (!Number.isFinite(distance) || distance > normalized.toleranceRatio) {
      return false;
    }
  }
  for (const point of normalized.second) {
    const distance = pointToPlaneDistance(point, planeOrigin, firstGeometry.unitNormal);
    if (!Number.isFinite(distance) || distance > normalized.toleranceRatio) {
      return false;
    }
  }
  return true;
}

function pointCorrespondence(
  first: readonly Point[],
  second: readonly Point[],
  tolerance: number
): PointCorrespondence {
  let hasApproximateCorrespondence = false;
  for (const permutation of QUAD_PERMUTATIONS) {
    let permutationMatches = true;
    let permutationIsExact = true;
    for (let firstIndex = 0; firstIndex < 4; firstIndex += 1) {
      const secondIndex = permutation[firstIndex]!;
      const firstPoint = first[firstIndex]!;
      const secondPoint = second[secondIndex]!;
      const deltaX = firstPoint[0]! - secondPoint[0]!;
      const deltaY = firstPoint[1]! - secondPoint[1]!;
      const deltaZ = firstPoint[2]! - secondPoint[2]!;
      const cornerIsExact = deltaX === 0 && deltaY === 0 && deltaZ === 0;
      if (!cornerIsExact) {
        permutationIsExact = false;
        const distance = Math.hypot(deltaX, deltaY, deltaZ);
        if (!Number.isFinite(distance) || distance > tolerance) {
          permutationMatches = false;
          break;
        }
      }
    }
    if (permutationMatches && permutationIsExact) {
      return "exact";
    }
    if (permutationMatches) {
      hasApproximateCorrespondence = true;
    }
  }
  return hasApproximateCorrespondence ? "approximate" : "none";
}

function isValidSingleFace(
  points: readonly Point[],
  order: QuadOrder,
  tolerance: number
): boolean {
  if (!hasNoExactDuplicateCorners(points)) {
    return false;
  }
  const normalized = normalizeSingleFace(points);
  if (normalized === undefined) {
    return false;
  }
  const geometry = faceGeometry(normalized.points, order);
  if (geometry === undefined) {
    return false;
  }

  const toleranceRatio = tolerance / normalized.span;
  if (
    !Number.isFinite(toleranceRatio)
    && toleranceRatio !== Number.POSITIVE_INFINITY
  ) {
    return false;
  }
  const planeOrigin = normalized.points[0]!;
  for (const point of normalized.points) {
    const distance = pointToPlaneDistance(point, planeOrigin, geometry.unitNormal);
    if (!Number.isFinite(distance) || distance > toleranceRatio) {
      return false;
    }
  }
  return true;
}

function hasNoExactDuplicateCorners(points: readonly Point[]): boolean {
  for (let first = 0; first < 4; first += 1) {
    for (let second = first + 1; second < 4; second += 1) {
      const firstPoint = points[first]!;
      const secondPoint = points[second]!;
      if (
        firstPoint[0] === secondPoint[0]
        && firstPoint[1] === secondPoint[1]
        && firstPoint[2] === secondPoint[2]
      ) {
        return false;
      }
    }
  }
  return true;
}

function normalizeFacePair(
  first: readonly Point[],
  second: readonly Point[],
  tolerance: number
): NormalizedFacePair | undefined {
  const origin = point3(first[0]!);
  const firstOffsets: Vector3[] = [];
  const secondOffsets: Vector3[] = [];
  let span = 0;

  for (const [points, offsets] of [
    [first, firstOffsets],
    [second, secondOffsets]
  ] as const) {
    for (const point of points) {
      const offset = finiteOffset(point, origin);
      if (offset === undefined) {
        return undefined;
      }
      const distance = Math.hypot(offset[0], offset[1], offset[2]);
      if (!Number.isFinite(distance)) {
        return undefined;
      }
      span = Math.max(span, distance);
      offsets.push(offset);
    }
  }

  if (!Number.isFinite(span) || span <= 0) {
    return undefined;
  }
  const toleranceRatio = tolerance / span;
  if (!Number.isFinite(toleranceRatio)) {
    return undefined;
  }

  const normalizedFirst = normalizeOffsets(firstOffsets, span);
  const normalizedSecond = normalizeOffsets(secondOffsets, span);
  if (normalizedFirst === undefined || normalizedSecond === undefined) {
    return undefined;
  }
  return {
    first: normalizedFirst,
    second: normalizedSecond,
    toleranceRatio
  };
}

function finiteOffset(point: Point, origin: Vector3): Vector3 | undefined {
  const offset: Vector3 = [
    point[0]! - origin[0],
    point[1]! - origin[1],
    point[2]! - origin[2]
  ];
  return offset.every(Number.isFinite) ? offset : undefined;
}

function normalizeOffsets(
  offsets: readonly Vector3[],
  span: number
): Vector3[] | undefined {
  const normalized: Vector3[] = [];
  for (const offset of offsets) {
    const point: Vector3 = [
      offset[0] / span,
      offset[1] / span,
      offset[2] / span
    ];
    if (!point.every(Number.isFinite)) {
      return undefined;
    }
    normalized.push(point);
  }
  return normalized;
}

function canonicalPointOrder(points: readonly Point[]): QuadOrder | undefined {
  const normalized = normalizeSingleFace(points);
  if (normalized === undefined) {
    return undefined;
  }

  let best: GeometryCandidate | undefined;
  let bestOrder: QuadOrder | undefined;
  for (const permutation of QUAD_PERMUTATIONS) {
    const candidate = geometryCandidate(normalized.points, permutation);
    if (candidate === undefined) {
      return undefined;
    }
    if (
      best === undefined
      || candidate.normalLength > best.normalLength
      || (
        candidate.normalLength === best.normalLength
        && comparePointOrders(candidate.orderedPoints, best.orderedPoints) < 0
      )
    ) {
      best = candidate;
      bestOrder = permutation;
    }
  }

  return best !== undefined && best.normalLength > 0 ? bestOrder : undefined;
}

function normalizeSingleFace(points: readonly Point[]): NormalizedSingleFace | undefined {
  const origin = point3(points[0]!);
  const offsets: Vector3[] = [];
  let span = 0;
  for (const point of points) {
    const offset = finiteOffset(point, origin);
    if (offset === undefined) {
      return undefined;
    }
    const distance = Math.hypot(offset[0], offset[1], offset[2]);
    if (!Number.isFinite(distance)) {
      return undefined;
    }
    span = Math.max(span, distance);
    offsets.push(offset);
  }
  if (!Number.isFinite(span) || span <= 0) {
    return undefined;
  }
  const normalized = normalizeOffsets(offsets, span);
  return normalized === undefined ? undefined : {
    points: normalized,
    span
  };
}

function faceGeometry(
  points: readonly Vector3[],
  order: QuadOrder
): FaceGeometry | undefined {
  const candidate = geometryCandidate(points, order);
  if (candidate === undefined || candidate.normalLength <= 0) {
    return undefined;
  }
  const unitNormal: Vector3 = [
    candidate.normal[0] / candidate.normalLength,
    candidate.normal[1] / candidate.normalLength,
    candidate.normal[2] / candidate.normalLength
  ];
  if (!unitNormal.every(Number.isFinite)) {
    return undefined;
  }
  return {
    normalLength: candidate.normalLength,
    unitNormal,
    area: candidate.area,
    perimeter: candidate.perimeter
  };
}

function geometryCandidate(
  points: readonly Vector3[],
  order: QuadOrder
): GeometryCandidate | undefined {
  const orderedPoints = order.map((index) => points[index]!);
  const normal = newellNormal(orderedPoints);
  const normalLength = Math.hypot(normal[0], normal[1], normal[2]);
  const area = normalLength * 0.5;
  const perimeter = facePerimeter(orderedPoints);
  if (
    !normal.every(Number.isFinite)
    || !Number.isFinite(normalLength)
    || !Number.isFinite(area)
    || !Number.isFinite(perimeter)
  ) {
    return undefined;
  }
  return {
    normal,
    normalLength,
    area,
    perimeter,
    orderedPoints
  };
}

function comparePointOrders(
  first: readonly Vector3[],
  second: readonly Vector3[]
): number {
  for (let pointIndex = 0; pointIndex < 4; pointIndex += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const firstValue = first[pointIndex]![axis]!;
      const secondValue = second[pointIndex]![axis]!;
      if (firstValue < secondValue) {
        return -1;
      }
      if (firstValue > secondValue) {
        return 1;
      }
    }
  }
  return 0;
}

function newellNormal(points: readonly Vector3[]): Vector3 {
  const origin = points[0]!;
  let normalX = 0;
  let normalY = 0;
  let normalZ = 0;
  for (let index = 0; index < 4; index += 1) {
    const current = subtract(points[index]!, origin);
    const next = subtract(points[(index + 1) % 4]!, origin);
    normalX += (current[1] - next[1]) * (current[2] + next[2]);
    normalY += (current[2] - next[2]) * (current[0] + next[0]);
    normalZ += (current[0] - next[0]) * (current[1] + next[1]);
  }
  return [normalX, normalY, normalZ];
}

function facePerimeter(points: readonly Vector3[]): number {
  let perimeter = 0;
  for (let index = 0; index < 4; index += 1) {
    perimeter += pointDistance(
      points[index]!,
      points[(index + 1) % 4]!
    );
  }
  return perimeter;
}

function pointToPlaneDistance(point: Point, planePoint: Vector3, unitNormal: Vector3): number {
  return Math.abs(dot(subtract(point3(point), planePoint), unitNormal));
}

function pointDistance(first: Point, second: Point): number {
  const firstCoordinate = point3(first);
  const secondCoordinate = point3(second);
  const deltaX = firstCoordinate[0] - secondCoordinate[0];
  const deltaY = firstCoordinate[1] - secondCoordinate[1];
  const deltaZ = firstCoordinate[2] - secondCoordinate[2];
  return Math.hypot(deltaX, deltaY, deltaZ);
}

function subtract(first: Vector3, second: Vector3): Vector3 {
  return [
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2]
  ];
}

function dot(first: Vector3, second: Vector3): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function point3(point: Point): Vector3 {
  return [point[0]!, point[1]!, point[2]!];
}

function uniqueOwners<T extends TwoToOneEntityId>(owners: readonly T[]): T[] {
  return [...new Set(owners)];
}
