import type { Point } from "./types.js";

interface RelativeBucketAxis {
  kind: "relative";
  origin: number;
}

interface BinaryBucketAxis {
  kind: "binary";
}

interface ExactBucketAxis {
  kind: "exact";
}

type MergeBucketAxis =
  | RelativeBucketAxis
  | BinaryBucketAxis
  | ExactBucketAxis;

export interface MergeBucketLayout {
  dimensions: 2 | 3;
  tolerance: number;
  axes: readonly MergeBucketAxis[];
}

export function createMergeBucketLayout(
  points: readonly Point[],
  tolerance: number
): MergeBucketLayout {
  const dimensions = points.some((point) => point.length > 2) ? 3 : 2;
  const axes = Array.from(
    { length: dimensions },
    (_, dimension): MergeBucketAxis => {
      if (tolerance === 0) {
        return { kind: "exact" };
      }
      let minimum = Number.POSITIVE_INFINITY;
      let maximum = Number.NEGATIVE_INFINITY;
      for (const point of points) {
        const coordinate = point[dimension] ?? 0;
        minimum = Math.min(minimum, coordinate);
        maximum = Math.max(maximum, coordinate);
      }
      const extent = maximum - minimum;
      const bucketSpan = extent / tolerance;
      if (
        Number.isFinite(minimum)
        && Number.isFinite(maximum)
        && Number.isFinite(bucketSpan)
        && bucketSpan <= Number.MAX_SAFE_INTEGER - 2
      ) {
        return { kind: "relative", origin: minimum };
      }
      return { kind: "binary" };
    }
  );
  return {
    dimensions,
    tolerance,
    axes
  };
}

export function mergeBucketKey(
  point: Point,
  layout: MergeBucketLayout
): string {
  return layout.axes.map((axis, dimension) =>
    axisBucket(point[dimension] ?? 0, axis, layout.tolerance)
  ).join(":");
}

export function forEachCandidateMergeBucketKey(
  point: Point,
  layout: MergeBucketLayout,
  visit: (key: string) => void
): void {
  const candidates = layout.axes.map((axis, dimension) =>
    axisBucketCandidates(
      point[dimension] ?? 0,
      axis,
      layout.tolerance
    )
  );
  if (layout.dimensions === 2) {
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
  axis: MergeBucketAxis,
  tolerance: number
): string[] {
  if (axis.kind === "exact" || !Number.isFinite(coordinate)) {
    return [`e${coordinate}`];
  }
  if (axis.kind === "relative") {
    const index = Math.floor((coordinate - axis.origin) / tolerance);
    return [
      `r${index - 1}`,
      `r${index}`,
      `r${index + 1}`
    ];
  }
  const index = floorFiniteRatioToBigInt(coordinate, tolerance);
  return [
    `b${index - 1n}`,
    `b${index}`,
    `b${index + 1n}`
  ];
}

function axisBucket(
  coordinate: number,
  axis: MergeBucketAxis,
  tolerance: number
): string {
  if (axis.kind === "exact" || !Number.isFinite(coordinate)) {
    return `e${coordinate}`;
  }
  if (axis.kind === "relative") {
    return `r${Math.floor((coordinate - axis.origin) / tolerance)}`;
  }
  return `b${floorFiniteRatioToBigInt(coordinate, tolerance)}`;
}

function floorFiniteRatioToBigInt(
  numeratorValue: number,
  denominatorValue: number
): bigint {
  if (numeratorValue === 0) {
    return 0n;
  }
  const numerator = binaryMagnitude(Math.abs(numeratorValue));
  const denominator = binaryMagnitude(denominatorValue);
  const exponent = numerator.exponent - denominator.exponent;
  const dividend = exponent >= 0
    ? numerator.significand << BigInt(exponent)
    : numerator.significand;
  const divisor = exponent >= 0
    ? denominator.significand
    : denominator.significand << BigInt(-exponent);
  const quotient = dividend / divisor;
  const remainder = dividend % divisor;
  if (numeratorValue > 0) {
    return quotient;
  }
  return remainder === 0n ? -quotient : -quotient - 1n;
}

function binaryMagnitude(value: number): {
  significand: bigint;
  exponent: number;
} {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  const high = view.getUint32(0, false);
  const low = view.getUint32(4, false);
  const exponentBits = (high >>> 20) & 0x7ff;
  const fraction = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
  if (exponentBits === 0) {
    return {
      significand: fraction,
      exponent: -1074
    };
  }
  return {
    significand: (1n << 52n) | fraction,
    exponent: exponentBits - 1023 - 52
  };
}
