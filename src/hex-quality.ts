import type {
  HexRefinementQualitySummary,
  LocalRefinement,
  Mesh,
  Point
} from "./types.js";
import {
  determinant3Scaled,
  materializeScaledValue,
  relativeDifferenceRatioScaled,
  scaleScaledValue,
  scaledValueSign,
  sumScaledValues,
  type ScaledValue
} from "./hex-numeric-internal.js";

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
  return auditHexRefinementQualityInternal(
    parentVertices,
    refinement,
    relativeVolumeTolerance
  ).report;
}

function auditHexRefinementQualityInternal(
  parentVertices: readonly Point[],
  refinement: LocalRefinement,
  relativeVolumeTolerance: number
): {
  report: HexRefinementQualityReport;
  parentVolume: ScaledValue;
  childVolume: ScaledValue;
  orientation: number;
} {
  assertHexVertices(parentVertices, "parent Hex");
  if (refinement.kind !== "H1") {
    throw new Error(`Hex quality audit requires H1 children, received ${refinement.kind}`);
  }
  const parentVolume = hexElementSignedVolumeScaled(parentVertices);
  const parentSignedVolume = materializeScaledValue(parentVolume);
  const orientation = scaledValueSign(parentVolume) < 0 ? -1 : 1;
  const parentMinimumOrientedScaledJacobian =
    minimumOrientedHexCornerScaledJacobian(parentVertices, orientation);
  const childVolumes: ScaledValue[] = [];
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
    childVolumes.push(hexElementSignedVolumeScaled(vertices));
    childMinimumOrientedScaledJacobian = Math.min(
      childMinimumOrientedScaledJacobian,
      minimumOrientedHexCornerScaledJacobian(vertices, orientation)
    );
  }
  const childVolume = sumScaledValues(childVolumes);
  const childSignedVolume = materializeScaledValue(childVolume);
  const relativeVolumeError = relativeDifferenceRatioScaled(
    parentVolume,
    childVolume
  );
  const report = {
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
  return {
    report,
    parentVolume,
    childVolume,
    orientation
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
  const parentVolumes: ScaledValue[] = [];
  const childVolumes: ScaledValue[] = [];
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
    const audited = auditHexRefinementQualityInternal(
      parentVertices,
      replacement.refinement,
      Number.POSITIVE_INFINITY
    );
    const { report, orientation } = audited;
    parentVolumes.push(scaleScaledValue(audited.parentVolume, orientation));
    childVolumes.push(scaleScaledValue(audited.childVolume, orientation));
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

  const parentOrientedVolumeScaled = sumScaledValues(parentVolumes);
  const childOrientedVolumeScaled = sumScaledValues(childVolumes);
  const parentOrientedVolume = materializeScaledValue(
    parentOrientedVolumeScaled
  );
  const childOrientedVolume = materializeScaledValue(
    childOrientedVolumeScaled
  );
  const relativeVolumeError = relativeDifferenceRatioScaled(
    parentOrientedVolumeScaled,
    childOrientedVolumeScaled
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
  return materializeScaledValue(hexElementSignedVolumeScaled(vertices));
}

function hexElementSignedVolumeScaled(
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
      : orientation * materializeScaledValue(
          determinant3Scaled(jacobian.map((column, index) =>
            column.map((component) => component / lengths[index]!)
          ))
        );
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

function vectorLength(vector: readonly number[]): number {
  return Math.hypot(...vector);
}

function assertHexVertices(vertices: readonly Point[], label: string): void {
  if (vertices.length !== 8 || vertices.some((point) => point.length < 3)) {
    throw new Error(`${label} quality audit requires eight three-dimensional vertices`);
  }
}
