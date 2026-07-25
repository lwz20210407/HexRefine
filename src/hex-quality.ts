import type { LocalRefinement, Point } from "./types.js";

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
  const relativeVolumeError = Math.abs(childSignedVolume - parentSignedVolume)
    / Math.max(Math.abs(parentSignedVolume), Number.EPSILON);
  return {
    ok: parentMinimumOrientedScaledJacobian > 0
      && childMinimumOrientedScaledJacobian > 0
      && relativeVolumeError <= relativeVolumeTolerance,
    parentSignedVolume,
    childSignedVolume,
    relativeVolumeError,
    parentMinimumOrientedScaledJacobian,
    childMinimumOrientedScaledJacobian
  };
}

export function hexElementSignedVolume(vertices: readonly Point[]): number {
  assertHexVertices(vertices, "Hex");
  let volume = 0;
  for (const xi of GAUSS_POINTS) {
    for (const eta of GAUSS_POINTS) {
      for (const zeta of GAUSS_POINTS) {
        volume += determinant3(hexJacobian(vertices, xi, eta, zeta));
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

function minimumOrientedHexCornerScaledJacobian(
  vertices: readonly Point[],
  orientation: number
): number {
  assertHexVertices(vertices, "Hex");
  let minimum = Number.POSITIVE_INFINITY;
  for (const [xi, eta, zeta] of CORNER_SIGNS) {
    const jacobian = hexJacobian(vertices, xi, eta, zeta);
    const denominator = vectorLength(jacobian[0])
      * vectorLength(jacobian[1])
      * vectorLength(jacobian[2]);
    const scaled = denominator === 0
      ? Number.NEGATIVE_INFINITY
      : orientation * determinant3(jacobian) / denominator;
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
  const columns: [number[], number[], number[]] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  CORNER_SIGNS.forEach(([sx, sy, sz], corner) => {
    const derivatives = [
      sx * (1 + sy * eta) * (1 + sz * zeta) / 8,
      sy * (1 + sx * xi) * (1 + sz * zeta) / 8,
      sz * (1 + sx * xi) * (1 + sy * eta) / 8
    ];
    for (let axis = 0; axis < 3; axis += 1) {
      for (let component = 0; component < 3; component += 1) {
        columns[axis]![component] = columns[axis]![component]!
          + derivatives[axis]! * vertices[corner]![component]!;
      }
    }
  });
  return columns;
}

function determinant3(matrix: readonly number[][]): number {
  const [a, b, c] = matrix;
  return a![0]! * (b![1]! * c![2]! - b![2]! * c![1]!)
    - b![0]! * (a![1]! * c![2]! - a![2]! * c![1]!)
    + c![0]! * (a![1]! * b![2]! - a![2]! * b![1]!);
}

function vectorLength(vector: readonly number[]): number {
  return Math.hypot(...vector);
}

function assertHexVertices(vertices: readonly Point[], label: string): void {
  if (vertices.length !== 8 || vertices.some((point) => point.length < 3)) {
    throw new Error(`${label} quality audit requires eight three-dimensional vertices`);
  }
}
