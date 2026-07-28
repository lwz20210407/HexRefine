import type {
  HexRefinementQualitySummary,
  LocalRefinement,
  Mesh,
  Point
} from "./types.js";

export interface HexRefinementPatchEntry {
  elementId: number;
  refinement: LocalRefinement;
}

export interface HexRefinementQualityReport {
  ok: boolean;
  parentSignedVolume: number;
  childSignedVolume: number;
  relativeVolumeError: number;
  parentMinimumOrientedScaledJacobian: number;
  childMinimumOrientedScaledJacobian: number;
}

const CORNER_SIGNS: readonly [number, number, number][] = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1]
];

const GAUSS_POINTS = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)] as const;

export function auditHexRefinementQuality(
  parentVertices: readonly Point[],
  refinement: LocalRefinement,
  relativeVolumeTolerance = 1e-8
): HexRefinementQualityReport {
  assertHexVertices(parentVertices, "parent Hex");
  if (refinement.kind !== "H1") {
    throw new Error(`Hex quality audit requires H1 children, received ${refinement.kind}`);
  }
  const parentSignedVolume = hexElementSignedVolume(parentVertices);
  const orientation = parentSignedVolume < 0 ? -1 : 1;
  const parentMinimumOrientedScaledJacobian =
    minimumOrientedHexCornerScaledJacobian(parentVertices, orientation);
  let childSignedVolume = 0;
  let childMinimumOrientedScaledJacobian = Number.POSITIVE_INFINITY;
  for (const [index, element] of refinement.elements.entries()) {
    const vertices = element.map((nodeId) => {
      const point = refinement.nodes[nodeId - 1];
      if (!point) {
        throw new Error(
          `Hex child ${index + 1} references missing refinement node ${nodeId}`
        );
      }
      return point;
    });
    assertHexVertices(vertices, `Hex child ${index + 1}`);
    childSignedVolume += hexElementSignedVolume(vertices);
    childMinimumOrientedScaledJacobian = Math.min(
      childMinimumOrientedScaledJacobian,
      minimumOrientedHexCornerScaledJacobian(vertices, orientation)
    );
  }
  const relativeVolumeError = relativeVolumeErrorFor(
    parentSignedVolume,
    childSignedVolume
  );
  return {
    ok: Number.isFinite(parentSignedVolume)
      && Number.isFinite(childSignedVolume)
      && Number.isFinite(relativeVolumeError)
      && Number.isFinite(parentMinimumOrientedScaledJacobian)
      && Number.isFinite(childMinimumOrientedScaledJacobian)
      && parentMinimumOrientedScaledJacobian > 0
      && childMinimumOrientedScaledJacobian > 0
      && relativeVolumeError <= relativeVolumeTolerance,
    parentSignedVolume,
    childSignedVolume,
    relativeVolumeError,
    parentMinimumOrientedScaledJacobian,
    childMinimumOrientedScaledJacobian
  };
}

export function auditHexRefinementPatchQuality(
  mesh: Mesh,
  replacements: readonly HexRefinementPatchEntry[],
  relativeVolumeTolerance = 1e-8
): HexRefinementQualitySummary {
  if (replacements.length === 0) {
    throw new Error("Hex patch quality audit requires at least one replacement");
  }
  let parentOrientedVolume = 0;
  let childOrientedVolume = 0;
  let parentMinimumOrientedScaledJacobian = Number.POSITIVE_INFINITY;
  let childMinimumOrientedScaledJacobian = Number.POSITIVE_INFINITY;
  let childElementCount = 0;

  for (const replacement of replacements) {
    const parent = mesh.elements[replacement.elementId - 1];
    if (!parent) {
      throw new Error(
        `quality audit parent element ${replacement.elementId} is outside the mesh`
      );
    }
    const parentVertices = parent.map((nodeId) => {
      const point = mesh.nodes[nodeId - 1];
      if (!point) {
        throw new Error(
          `quality audit parent element ${replacement.elementId} references missing node ${nodeId}`
        );
      }
      return point;
    });
    const report = auditHexRefinementQuality(
      parentVertices,
      replacement.refinement,
      Number.POSITIVE_INFINITY
    );
    const orientation = report.parentSignedVolume < 0 ? -1 : 1;
    parentOrientedVolume += orientation * report.parentSignedVolume;
    childOrientedVolume += orientation * report.childSignedVolume;
    parentMinimumOrientedScaledJacobian = Math.min(
      parentMinimumOrientedScaledJacobian,
      report.parentMinimumOrientedScaledJacobian
    );
    childMinimumOrientedScaledJacobian = Math.min(
      childMinimumOrientedScaledJacobian,
      report.childMinimumOrientedScaledJacobian
    );
    childElementCount += replacement.refinement.elements.length;
  }

  const relativeVolumeError = relativeVolumeErrorFor(
    parentOrientedVolume,
    childOrientedVolume
  );
  return {
    ok: Number.isFinite(parentOrientedVolume)
      && Number.isFinite(childOrientedVolume)
      && Number.isFinite(relativeVolumeError)
      && Number.isFinite(parentMinimumOrientedScaledJacobian)
      && Number.isFinite(childMinimumOrientedScaledJacobian)
      && parentMinimumOrientedScaledJacobian > 0
      && childMinimumOrientedScaledJacobian > 0
      && relativeVolumeError <= relativeVolumeTolerance,
    parentElementCount: replacements.length,
    childElementCount,
    parentOrientedVolume,
    childOrientedVolume,
    relativeVolumeError,
    parentMinimumOrientedScaledJacobian,
    childMinimumOrientedScaledJacobian
  };
}

export function hexElementSignedVolume(vertices: readonly Point[]): number {
  assertHexVertices(vertices, "Hex");
  let volume = 0;
  let correction = 0;
  for (const xi of GAUSS_POINTS) {
    for (const eta of GAUSS_POINTS) {
      for (const zeta of GAUSS_POINTS) {
        const determinant = determinant3(
          hexJacobian(vertices, xi, eta, zeta)
        );
        if (!Number.isFinite(volume) || !Number.isFinite(determinant)) {
          volume += determinant;
          correction = 0;
          continue;
        }
        const adjusted = determinant - correction;
        const next = volume + adjusted;
        correction = (next - volume) - adjusted;
        volume = next;
      }
    }
  }
  return volume;
}

export function minimumHexCornerScaledJacobian(
  vertices: readonly Point[]
): number {
  return minimumOrientedHexCornerScaledJacobian(vertices, 1);
}

export function minimumOrientedHexCornerScaledJacobian(
  vertices: readonly Point[],
  orientation: number
): number {
  assertHexVertices(vertices, "Hex");
  let minimum = Number.POSITIVE_INFINITY;
  for (const [xi, eta, zeta] of CORNER_SIGNS) {
    const jacobian = hexJacobian(vertices, xi, eta, zeta);
    const lengths = jacobian.map(vectorLength);
    const scaled = lengths.some((length) => length === 0)
      ? Number.NEGATIVE_INFINITY
      : orientation * determinant3(jacobian.map((column, index) =>
          column.map((component) => component / lengths[index]!)
        ));
    minimum = Math.min(minimum, scaled);
  }
  return minimum;
}

function hexJacobian(
  vertices: readonly Point[],
  xi: number,
  eta: number,
  zeta: number
): [number[], number[], number[]] {
  return [
    weightedHexEdgeDifferences(vertices, [
      [1, 0, (1 - eta) * (1 - zeta) / 8],
      [2, 3, (1 + eta) * (1 - zeta) / 8],
      [5, 4, (1 - eta) * (1 + zeta) / 8],
      [6, 7, (1 + eta) * (1 + zeta) / 8]
    ]),
    weightedHexEdgeDifferences(vertices, [
      [3, 0, (1 - xi) * (1 - zeta) / 8],
      [2, 1, (1 + xi) * (1 - zeta) / 8],
      [7, 4, (1 - xi) * (1 + zeta) / 8],
      [6, 5, (1 + xi) * (1 + zeta) / 8]
    ]),
    weightedHexEdgeDifferences(vertices, [
      [4, 0, (1 - xi) * (1 - eta) / 8],
      [5, 1, (1 + xi) * (1 - eta) / 8],
      [7, 3, (1 - xi) * (1 + eta) / 8],
      [6, 2, (1 + xi) * (1 + eta) / 8]
    ])
  ];
}

function weightedHexEdgeDifferences(
  vertices: readonly Point[],
  terms: readonly [number, number, number][]
): number[] {
  return [0, 1, 2].map((component) => {
    let sum = 0;
    let correction = 0;
    for (const [positive, negative, weight] of terms) {
      const difference = vertices[positive]![component]!
        - vertices[negative]![component]!;
      const value = difference * weight;
      const adjusted = value - correction;
      const next = sum + adjusted;
      correction = (next - sum) - adjusted;
      sum = next;
    }
    return sum;
  });
}

function determinant3(matrix: readonly number[][]): number {
  const normalized: number[][] = [];
  let totalExponent = 0;
  for (const column of matrix) {
    const maximum = Math.max(...column.map((component) => Math.abs(component)));
    if (maximum === 0) {
      return 0;
    }
    if (!Number.isFinite(maximum)) {
      return Number.NaN;
    }
    const exponent = Math.floor(Math.log2(maximum));
    const scale = 2 ** exponent;
    normalized.push(column.map((component) => component / scale));
    totalExponent += exponent;
  }
  return restoreBinaryExponent(
    determinant3Normalized(normalized),
    totalExponent
  );
}

function determinant3Normalized(matrix: readonly number[][]): number {
  const [a, b, c] = matrix;
  return a![0]! * (b![1]! * c![2]! - b![2]! * c![1]!)
    - b![0]! * (a![1]! * c![2]! - a![2]! * c![1]!)
    + c![0]! * (a![1]! * b![2]! - a![2]! * b![1]!);
}

function restoreBinaryExponent(value: number, exponent: number): number {
  if (value === 0 || !Number.isFinite(value)) {
    return value;
  }
  const valueExponent = Math.floor(Math.log2(Math.abs(value)));
  const mantissa = value / (2 ** valueExponent);
  const combinedExponent = exponent + valueExponent;
  if (combinedExponent > 1023) {
    return value < 0
      ? Number.NEGATIVE_INFINITY
      : Number.POSITIVE_INFINITY;
  }
  if (combinedExponent < -1074) {
    return value < 0 ? -0 : 0;
  }
  return mantissa * (2 ** combinedExponent);
}

function relativeVolumeErrorFor(
  parentVolume: number,
  childVolume: number
): number {
  const difference = Math.abs(childVolume - parentVolume);
  const denominator = Math.abs(parentVolume);
  if (denominator === 0) {
    return difference === 0 ? 0 : Number.POSITIVE_INFINITY;
  }
  return difference / denominator;
}

function vectorLength(vector: readonly number[]): number {
  return Math.hypot(...vector);
}

function assertHexVertices(vertices: readonly Point[], label: string): void {
  if (vertices.length !== 8 || vertices.some((point) => point.length < 3)) {
    throw new Error(`${label} quality audit requires eight three-dimensional vertices`);
  }
}
