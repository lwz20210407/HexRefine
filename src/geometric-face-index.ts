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

export class GeometricFaceIndex<T extends TwoToOneEntityId> {
  private readonly exact = new Map<string, GeometricFace<T>[]>();
  private readonly buckets = new Map<string, GeometricFace<T>[]>();

  constructor(readonly tolerance: number) {
    if (!Number.isFinite(tolerance) || tolerance <= 0) {
      throw new RangeError("tolerance must be finite and greater than zero");
    }
  }

  add(face: GeometricFace<T>): void {
    assertQuad(face);

    const exactKey = nodeIdKey(face.nodeIds);
    const exactFaces = this.exact.get(exactKey);
    if (exactFaces === undefined) {
      this.exact.set(exactKey, [face]);
    } else {
      exactFaces.push(face);
    }

    const bucketKey = coordinateKey(minimumBucket(face.points, this.tolerance));
    const bucketFaces = this.buckets.get(bucketKey);
    if (bucketFaces === undefined) {
      this.buckets.set(bucketKey, [face]);
    } else {
      bucketFaces.push(face);
    }
  }

  matches(face: GeometricFace<T>): GeometricFace<T>[] {
    assertQuad(face);

    const exactFaces = this.exact.get(nodeIdKey(face.nodeIds));
    if (exactFaces !== undefined) {
      return [...exactFaces];
    }

    const center = minimumBucket(face.points, this.tolerance);
    const seen = new Set<GeometricFace<T>>();
    const matches: GeometricFace<T>[] = [];
    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        for (let zOffset = -1; zOffset <= 1; zOffset += 1) {
          const candidates = this.buckets.get(coordinateKey([
            center[0] + xOffset,
            center[1] + yOffset,
            center[2] + zOffset
          ]));
          if (candidates === undefined) {
            continue;
          }
          for (const candidate of candidates) {
            if (seen.has(candidate)) {
              continue;
            }
            seen.add(candidate);
            if (geometricallySameFace(candidate.points, face.points, this.tolerance)) {
              matches.push(candidate);
            }
          }
        }
      }
    }
    return matches;
  }

  uniqueMatch(face: GeometricFace<T>): GeometricFace<T> | undefined {
    const matches = this.matches(face);
    if (matches.length === 0) {
      return undefined;
    }
    if (matches.length === 1) {
      return matches[0];
    }

    throw new TwoToOnePlanningError<T>(
      "TWO_TO_ONE_AMBIGUOUS_FACE",
      `face owned by ${face.owner} has ${matches.length} matches`,
      {
        conflictingCellIds: [face.owner, ...matches.map((match) => match.owner)],
        conflictingInterfaces: [],
        attemptedActions: []
      }
    );
  }
}

function assertQuad<T>(face: GeometricFace<T>): void {
  if (typeof face !== "object" || face === null) {
    throw new TypeError("face must be an object");
  }
  if (!Array.isArray(face.nodeIds) || !Array.isArray(face.points)) {
    throw new TypeError("face nodeIds and points must be arrays");
  }
  if (face.nodeIds.length !== 4 || face.points.length !== 4) {
    throw new TypeError("face must have exactly four node ids and four points");
  }

  for (const nodeId of face.nodeIds) {
    if (typeof nodeId !== "number" || !Number.isFinite(nodeId)) {
      throw new TypeError("face node ids must be finite numbers");
    }
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

function nodeIdKey(nodeIds: readonly number[]): string {
  return [...nodeIds].sort((first, second) => first - second).join(":");
}

function minimumBucket(points: readonly Point[], tolerance: number): BucketCoordinate {
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let minimumZ = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const [x, y, z] = point3(point);
    minimumX = Math.min(minimumX, x);
    minimumY = Math.min(minimumY, y);
    minimumZ = Math.min(minimumZ, z);
  }
  return [
    Math.floor(minimumX / tolerance),
    Math.floor(minimumY / tolerance),
    Math.floor(minimumZ / tolerance)
  ];
}

function coordinateKey(coordinate: BucketCoordinate): string {
  return coordinate.join(":");
}

function geometricallySameFace(
  first: readonly Point[],
  second: readonly Point[],
  tolerance: number
): boolean {
  const toleranceSquared = tolerance * tolerance;
  if (!hasPointCorrespondence(first, second, toleranceSquared)) {
    return false;
  }

  const firstGeometry = faceGeometry(first);
  const secondGeometry = faceGeometry(second);
  if (
    firstGeometry.normalLength <= toleranceSquared
    || secondGeometry.normalLength <= toleranceSquared
  ) {
    return false;
  }

  const absoluteNormalDot = Math.abs(dot(firstGeometry.unitNormal, secondGeometry.unitNormal));
  if (absoluteNormalDot < 1 - 1e-8) {
    return false;
  }
  if (
    Math.abs(firstGeometry.area - secondGeometry.area)
    > tolerance * Math.max(firstGeometry.perimeter, 1)
  ) {
    return false;
  }

  for (const point of first) {
    if (pointToPlaneDistance(point, firstGeometry.centroid, firstGeometry.unitNormal) > tolerance) {
      return false;
    }
  }
  for (const point of second) {
    if (pointToPlaneDistance(point, firstGeometry.centroid, firstGeometry.unitNormal) > tolerance) {
      return false;
    }
  }
  return true;
}

function hasPointCorrespondence(
  first: readonly Point[],
  second: readonly Point[],
  toleranceSquared: number
): boolean {
  return QUAD_PERMUTATIONS.some((permutation) => permutation.every(
    (secondIndex, firstIndex) =>
      squaredDistance(first[firstIndex]!, second[secondIndex]!) <= toleranceSquared
  ));
}

function faceGeometry(points: readonly Point[]): {
  normalLength: number;
  unitNormal: Vector3;
  area: number;
  perimeter: number;
  centroid: Vector3;
} {
  const normal = newellNormal(points);
  const normalLength = Math.hypot(normal[0], normal[1], normal[2]);
  const unitNormal: Vector3 = normalLength === 0
    ? [0, 0, 0]
    : [
        normal[0] / normalLength,
        normal[1] / normalLength,
        normal[2] / normalLength
      ];
  return {
    normalLength,
    unitNormal,
    area: normalLength * 0.5,
    perimeter: facePerimeter(points),
    centroid: faceCentroid(points)
  };
}

function newellNormal(points: readonly Point[]): Vector3 {
  const origin = point3(points[0]!);
  let normalX = 0;
  let normalY = 0;
  let normalZ = 0;
  for (let index = 0; index < 4; index += 1) {
    const current = subtract(point3(points[index]!), origin);
    const next = subtract(point3(points[(index + 1) % 4]!), origin);
    normalX += (current[1] - next[1]) * (current[2] + next[2]);
    normalY += (current[2] - next[2]) * (current[0] + next[0]);
    normalZ += (current[0] - next[0]) * (current[1] + next[1]);
  }
  return [normalX, normalY, normalZ];
}

function facePerimeter(points: readonly Point[]): number {
  let perimeter = 0;
  for (let index = 0; index < 4; index += 1) {
    perimeter += Math.sqrt(squaredDistance(
      points[index]!,
      points[(index + 1) % 4]!
    ));
  }
  return perimeter;
}

function faceCentroid(points: readonly Point[]): Vector3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of points) {
    const coordinate = point3(point);
    x += coordinate[0];
    y += coordinate[1];
    z += coordinate[2];
  }
  return [x / 4, y / 4, z / 4];
}

function pointToPlaneDistance(point: Point, planePoint: Vector3, unitNormal: Vector3): number {
  return Math.abs(dot(subtract(point3(point), planePoint), unitNormal));
}

function squaredDistance(first: Point, second: Point): number {
  const firstCoordinate = point3(first);
  const secondCoordinate = point3(second);
  const deltaX = firstCoordinate[0] - secondCoordinate[0];
  const deltaY = firstCoordinate[1] - secondCoordinate[1];
  const deltaZ = firstCoordinate[2] - secondCoordinate[2];
  return deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
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
