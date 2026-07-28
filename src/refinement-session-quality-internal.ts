import {
  hexElementSignedVolumeScaled
} from "./hex-quality-internal.js";
import {
  minimumOrientedHexCornerScaledJacobian
} from "./hex-quality.js";
import {
  materializeScaledValue,
  relativeDifferenceRatioScaled,
  scaleScaledValue,
  scaledValueSign,
  sumScaledValues,
  type ScaledValue
} from "./hex-numeric-internal.js";
import type {
  CellId,
  RefinementSession
} from "./refinement-session.js";
import type {
  HexRefinementQualitySummary,
  Point
} from "./types.js";

export function auditNetHexCellReplacementQuality(
  parentSession: RefinementSession,
  parentCellIds: readonly CellId[],
  childSession: RefinementSession,
  childCellIds: readonly CellId[],
  relativeVolumeTolerance = 1e-8
): HexRefinementQualitySummary {
  if (parentCellIds.length === 0 || childCellIds.length === 0) {
    throw new Error(
      "net Hex replacement quality audit requires parent and child cells"
    );
  }
  const parent = summarizeHexSessionCells(parentSession, parentCellIds);
  const child = summarizeHexSessionCells(childSession, childCellIds);
  const parentOrientedVolume = materializeScaledValue(parent.orientedVolume);
  const childOrientedVolume = materializeScaledValue(child.orientedVolume);
  const relativeVolumeError = relativeDifferenceRatioScaled(
    parent.orientedVolume,
    child.orientedVolume
  );
  return {
    ok: Number.isFinite(parentOrientedVolume)
      && Number.isFinite(childOrientedVolume)
      && Number.isFinite(relativeVolumeError)
      && Number.isFinite(parent.minimumOrientedScaledJacobian)
      && Number.isFinite(child.minimumOrientedScaledJacobian)
      && parent.minimumOrientedScaledJacobian > 0
      && child.minimumOrientedScaledJacobian > 0
      && relativeVolumeError <= relativeVolumeTolerance,
    parentElementCount: parentCellIds.length,
    childElementCount: childCellIds.length,
    parentOrientedVolume,
    childOrientedVolume,
    relativeVolumeError,
    parentMinimumOrientedScaledJacobian:
      parent.minimumOrientedScaledJacobian,
    childMinimumOrientedScaledJacobian:
      child.minimumOrientedScaledJacobian
  };
}

function summarizeHexSessionCells(
  session: RefinementSession,
  cellIds: readonly CellId[]
): {
  orientedVolume: ScaledValue;
  minimumOrientedScaledJacobian: number;
} {
  const orientedVolumes: ScaledValue[] = [];
  let minimumOrientedScaledJacobian = Number.POSITIVE_INFINITY;
  for (const cellId of cellIds) {
    const cell = session.cells.get(cellId);
    if (!cell) {
      throw new Error(`net Hex replacement quality audit missing cell ${cellId}`);
    }
    if (cell.kind !== "H1") {
      throw new Error(
        `net Hex replacement quality audit received non-Hex cell ${cellId}`
      );
    }
    const vertices = cell.element.map((nodeId) => {
      const point = session.nodes[nodeId - 1];
      if (!point) {
        throw new Error(
          `net Hex replacement quality audit cell ${cellId} references missing node ${nodeId}`
        );
      }
      return point as Point;
    });
    const signedVolume = hexElementSignedVolumeScaled(vertices);
    const orientation = scaledValueSign(signedVolume);
    orientedVolumes.push(scaleScaledValue(signedVolume, orientation));
    minimumOrientedScaledJacobian = Math.min(
      minimumOrientedScaledJacobian,
      minimumOrientedHexCornerScaledJacobian(vertices, orientation)
    );
  }
  return {
    orientedVolume: sumScaledValues(orientedVolumes),
    minimumOrientedScaledJacobian
  };
}
