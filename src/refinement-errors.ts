import { auditHexRefinementPatchQuality } from "./hex-quality.js";
import {
  DirectTwoToOnePlanningError,
  TwoToOnePlanningError,
  type TwoToOnePlanningErrorCode
} from "./two-to-one-capability.js";
import type {
  HexRefinementQualitySummary,
  Mesh,
  ReplaceElement
} from "./types.js";

export type HexPatchQualityErrorCode =
  | "HEX_PATCH_PARENT_JACOBIAN"
  | "HEX_PATCH_CHILD_JACOBIAN"
  | "HEX_PATCH_VOLUME";

export class HexPatchQualityError extends Error {
  constructor(
    readonly code: HexPatchQualityErrorCode,
    message: string
  ) {
    super(message);
    this.name = "HexPatchQualityError";
  }
}

export function assertHexPatchQuality(
  sourceMesh: Mesh,
  replacements: readonly ReplaceElement[]
): HexRefinementQualitySummary {
  const quality = auditHexRefinementPatchQuality(sourceMesh, replacements);
  if (quality.parentMinimumOrientedScaledJacobian <= 0) {
    throw new HexPatchQualityError(
      "HEX_PATCH_PARENT_JACOBIAN",
      "refinement patch starts from a parent with non-positive scaled Jacobian " +
      `${quality.parentMinimumOrientedScaledJacobian}`
    );
  }
  if (quality.childMinimumOrientedScaledJacobian <= 0) {
    throw new HexPatchQualityError(
      "HEX_PATCH_CHILD_JACOBIAN",
      "refinement patch produced a non-positive scaled Jacobian " +
      `${quality.childMinimumOrientedScaledJacobian}`
    );
  }
  if (quality.relativeVolumeError > 1e-8) {
    throw new HexPatchQualityError(
      "HEX_PATCH_VOLUME",
      "refinement patch does not conserve parent volume; relative error is " +
      `${quality.relativeVolumeError}`
    );
  }
  return quality;
}

export function asTwoToOneFlatPlanningError(
  error: unknown,
  selectedElementIds: readonly number[]
): TwoToOnePlanningError<number> {
  if (error instanceof TypeError || error instanceof RangeError) {
    throw error;
  }
  if (error instanceof TwoToOnePlanningError) {
    return cloneNumericPlanningError(error, selectedElementIds);
  }
  if (error instanceof HexPatchQualityError) {
    return new TwoToOnePlanningError(
      qualityPlanningErrorCode(error.code),
      error.message,
      {
        conflictingCellIds: stableNumericIds(selectedElementIds),
        conflictingInterfaces: [],
        attemptedActions: []
      }
    );
  }
  const conflictingCellIds = error instanceof DirectTwoToOnePlanningError
    ? stableNumericIds(error.conflictingElementIds)
    : stableNumericIds(selectedElementIds);
  return new TwoToOnePlanningError(
    "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY",
    errorMessage(error),
    {
      conflictingCellIds:
        conflictingCellIds.length > 0
          ? conflictingCellIds
          : stableNumericIds(selectedElementIds),
      conflictingInterfaces: [],
      attemptedActions: [],
      suggestion: {
        kind: "remesh-source"
      }
    }
  );
}

export function qualityPlanningErrorCode(
  code: HexPatchQualityErrorCode
): TwoToOnePlanningErrorCode {
  if (code === "HEX_PATCH_PARENT_JACOBIAN") {
    return "TWO_TO_ONE_PARENT_JACOBIAN";
  }
  if (code === "HEX_PATCH_CHILD_JACOBIAN") {
    return "TWO_TO_ONE_CHILD_JACOBIAN";
  }
  return "TWO_TO_ONE_VOLUME";
}

function cloneNumericPlanningError(
  error: TwoToOnePlanningError<number>,
  selectedElementIds: readonly number[]
): TwoToOnePlanningError<number> {
  const diagnostic = error.diagnostic;
  const conflictingCellIds = stableNumericIds(
    diagnostic.conflictingCellIds
  );
  const suggestion = diagnostic.suggestion;
  return new TwoToOnePlanningError(
    error.code,
    error.message,
    {
      conflictingCellIds:
        conflictingCellIds.length > 0
          ? conflictingCellIds
          : stableNumericIds(selectedElementIds),
      conflictingInterfaces: diagnostic.conflictingInterfaces.map((entry) => ({
        firstCellId: entry.firstCellId,
        ...(entry.secondCellId === undefined
          ? {}
          : { secondCellId: entry.secondCellId }),
        faceNodeIds: stableNumericIds(entry.faceNodeIds)
      })),
      attemptedActions: diagnostic.attemptedActions.map((action) => ({
        kind: action.kind,
        reason: action.reason,
        addedParentCellIds: stableNumericIds(action.addedParentCellIds),
        replacedTransitionCellIds:
          stableNumericIds(action.replacedTransitionCellIds),
        ...(action.templateId === undefined
          ? {}
          : { templateId: action.templateId })
      })),
      ...(suggestion === undefined
        ? {}
        : {
            suggestion: {
              kind: suggestion.kind,
              ...(suggestion.axis === undefined
                ? {}
                : { axis: suggestion.axis }),
              ...(suggestion.side === undefined
                ? {}
                : { side: suggestion.side }),
              ...(suggestion.parentCellIds === undefined
                ? {}
                : {
                    parentCellIds:
                      stableNumericIds(suggestion.parentCellIds)
                  })
            }
          })
    }
  );
}

function stableNumericIds(values: readonly number[]): number[] {
  return [...new Set(values)].sort(compareNumbers);
}

function compareNumbers(first: number, second: number): number {
  if (Object.is(first, second)) {
    return 0;
  }
  if (Number.isNaN(first)) {
    return 1;
  }
  if (Number.isNaN(second)) {
    return -1;
  }
  return first - second;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
