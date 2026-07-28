import {
  determinant3Scaled,
  sumScaledValues,
  type ScaledValue
} from "./hex-numeric-internal.js";
import type { Point } from "./types.js";

const GAUSS_POINTS = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)] as const;

export function hexElementSignedVolumeScaled(
  vertices: readonly Point[]
): ScaledValue {
  const determinants: ScaledValue[] = [];
  for (const xi of GAUSS_POINTS) {
    for (const eta of GAUSS_POINTS) {
      for (const zeta of GAUSS_POINTS) {
        determinants.push(determinant3Scaled(
          hexJacobian(vertices, xi, eta, zeta)
        ));
      }
    }
  }
  return sumScaledValues(determinants);
}

export function hexJacobian(
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
