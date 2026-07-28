import type { Point } from "./types.js";

export function mergeBucketOrigin(points: readonly Point[]): Point {
  const dimensions = points.some((point) => point.length > 2) ? 3 : 2;
  const origin = Array.from(
    { length: dimensions },
    () => Number.POSITIVE_INFINITY
  );
  for (const point of points) {
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      const coordinate = point[dimension] ?? 0;
      origin[dimension] = Math.min(origin[dimension]!, coordinate);
    }
  }
  return origin.map((coordinate) =>
    Number.isFinite(coordinate) ? coordinate : 0
  );
}

export function mergeBucketKey(
  point: Point,
  origin: Point,
  tolerance: number
): string {
  return pointDimensions(point).map((dimension) =>
    axisBucket(point[dimension] ?? 0, origin[dimension] ?? 0, tolerance)
  ).join(":");
}

export function forEachCandidateMergeBucketKey(
  point: Point,
  origin: Point,
  tolerance: number,
  visit: (key: string) => void
): void {
  const candidates = pointDimensions(point).map((dimension) =>
    axisBucketCandidates(
      point[dimension] ?? 0,
      origin[dimension] ?? 0,
      tolerance
    )
  );
  if (candidates.length === 2) {
    for (const first of candidates[0]!) {
      for (const second of candidates[1]!) {
        visit(`${first}:${second}`);
      }
    }
    return;
  }
  for (const first of candidates[0]!) {
    for (const second of candidates[1]!) {
      for (const third of candidates[2]!) {
        visit(`${first}:${second}:${third}`);
      }
    }
  }
}

function axisBucketCandidates(
  coordinate: number,
  origin: number,
  tolerance: number
): string[] {
  const bucket = safeAxisBucket(coordinate, origin, tolerance);
  if (bucket.kind === "exact") {
    return [`e${bucket.coordinate}`];
  }
  return [
    `${bucket.kind}${bucket.index - 1}`,
    `${bucket.kind}${bucket.index}`,
    `${bucket.kind}${bucket.index + 1}`
  ];
}

function axisBucket(
  coordinate: number,
  origin: number,
  tolerance: number
): string {
  const bucket = safeAxisBucket(coordinate, origin, tolerance);
  return bucket.kind === "exact"
    ? `e${bucket.coordinate}`
    : `${bucket.kind}${bucket.index}`;
}

function safeAxisBucket(
  coordinate: number,
  origin: number,
  tolerance: number
):
  | { kind: "d" | "r"; index: number }
  | { kind: "exact"; coordinate: number } {
  const direct = Math.floor(coordinate / tolerance);
  if (isNeighborSafeInteger(direct)) {
    return { kind: "d", index: direct };
  }
  const relative = Math.floor((coordinate - origin) / tolerance);
  if (isNeighborSafeInteger(relative)) {
    return { kind: "r", index: relative };
  }
  return { kind: "exact", coordinate };
}

function isNeighborSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value)
    && Math.abs(value) < Number.MAX_SAFE_INTEGER;
}

function pointDimensions(point: Point): number[] {
  return point.length <= 2 ? [0, 1] : [0, 1, 2];
}
