import {
  checkNoHangingNodes,
  type HangingEntity
} from "./conformance.js";
import {
  auditHexRefinementPatchQuality,
  hexElementSignedVolume,
  minimumOrientedHexCornerScaledJacobian,
  type HexRefinementQualityReport
} from "./hex-quality.js";
import {
  minNonzeroElementEdgeLength,
  replaceElements
} from "./mesh.js";
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
  replacements: readonly ReplaceElement[],
  finalMesh?: Mesh,
  requireConforming = false
): HexRefinementQualitySummary {
  const quality = finalMesh === undefined
    ? auditHexRefinementPatchQuality(sourceMesh, replacements)
    : auditFinalHexPatchQuality(sourceMesh, replacements, finalMesh);
  assertHexPatchQualitySummary(quality);
  if (finalMesh !== undefined && requireConforming) {
    const minimumEdge = minNonzeroElementEdgeLength(finalMesh);
    const tolerance = Number.isFinite(minimumEdge)
      ? minimumEdge * 1e-8
      : 1e-9;
    const conformance = checkNoHangingNodes(finalMesh, tolerance);
    if (!conformance.ok) {
      throw finalConformancePlanningError(
        sourceMesh,
        replacements,
        finalMesh,
        conformance.hanging,
        "merged final Hex mesh contains a nonconforming interface: " +
        conformance.hanging[0]!.message
      );
    }
  }
  return quality;
}

export function assertHexRefinementQualityReport(
  quality: HexRefinementQualityReport,
  label = "refinement"
): void {
  assertHexQualityMetrics(
    quality.parentSignedVolume,
    quality.childSignedVolume,
    quality.relativeVolumeError,
    quality.parentMinimumOrientedScaledJacobian,
    quality.childMinimumOrientedScaledJacobian,
    quality.ok,
    label
  );
}

export function assertHexPatchQualitySummary(
  quality: HexRefinementQualitySummary,
  label = "refinement patch"
): void {
  if (
    !Number.isFinite(quality.parentElementCount)
    || !Number.isFinite(quality.childElementCount)
    || !Number.isFinite(quality.parentOrientedVolume)
    || !Number.isFinite(quality.childOrientedVolume)
    || !Number.isFinite(quality.relativeVolumeError)
  ) {
    throw new HexPatchQualityError(
      "HEX_PATCH_VOLUME",
      `${label} produced a non-finite count, oriented volume, or relative volume error`
    );
  }
  assertHexQualityMetrics(
    quality.parentOrientedVolume,
    quality.childOrientedVolume,
    quality.relativeVolumeError,
    quality.parentMinimumOrientedScaledJacobian,
    quality.childMinimumOrientedScaledJacobian,
    quality.ok,
    label
  );
}

function assertHexQualityMetrics(
  parentVolume: number,
  childVolume: number,
  relativeVolumeError: number,
  parentMinimumOrientedScaledJacobian: number,
  childMinimumOrientedScaledJacobian: number,
  ok: boolean,
  label: string
): void {
  if (
    !Number.isFinite(parentVolume)
    || !Number.isFinite(childVolume)
    || !Number.isFinite(relativeVolumeError)
  ) {
    throw new HexPatchQualityError(
      "HEX_PATCH_VOLUME",
      `${label} produced a non-finite volume or relative volume error`
    );
  }
  if (!Number.isFinite(parentMinimumOrientedScaledJacobian)) {
    throw new HexPatchQualityError(
      "HEX_PATCH_PARENT_JACOBIAN",
      `${label} parent scaled Jacobian is non-finite`
    );
  }
  if (!Number.isFinite(childMinimumOrientedScaledJacobian)) {
    throw new HexPatchQualityError(
      "HEX_PATCH_CHILD_JACOBIAN",
      `${label} child scaled Jacobian is non-finite`
    );
  }
  if (parentMinimumOrientedScaledJacobian <= 0) {
    throw new HexPatchQualityError(
      "HEX_PATCH_PARENT_JACOBIAN",
      `${label} starts from a parent with non-positive scaled Jacobian ` +
      `${parentMinimumOrientedScaledJacobian}`
    );
  }
  if (childMinimumOrientedScaledJacobian <= 0) {
    throw new HexPatchQualityError(
      "HEX_PATCH_CHILD_JACOBIAN",
      `${label} produced a non-positive scaled Jacobian ` +
      `${childMinimumOrientedScaledJacobian}`
    );
  }
  if (relativeVolumeError > 1e-8 || !ok) {
    throw new HexPatchQualityError(
      "HEX_PATCH_VOLUME",
      `${label} does not conserve parent volume; relative error is ` +
      `${relativeVolumeError}`
    );
  }
}

export function buildAuditedHexRefinementOutput(
  sourceMesh: Mesh,
  replacements: readonly ReplaceElement[],
  mergeTolerance: number,
  requireConforming: boolean
): { mesh: Mesh; quality: HexRefinementQualitySummary } {
  const mesh = replaceElements(sourceMesh, replacements, mergeTolerance);
  return {
    mesh,
    quality: assertHexPatchQuality(
      sourceMesh,
      replacements,
      mesh,
      requireConforming
    )
  };
}

export function asTwoToOneFlatPlanningError(
  error: unknown,
  selectedElementIds: readonly number[]
): TwoToOnePlanningError<number> {
  if (error instanceof TypeError || error instanceof RangeError) {
    throw error;
  }
  if (error instanceof TwoToOnePlanningError) {
    return freezeTwoToOnePlanningErrorDiagnostic(
      cloneNumericPlanningError(error, selectedElementIds)
    );
  }
  if (error instanceof HexPatchQualityError) {
    return freezeTwoToOnePlanningErrorDiagnostic(
      new TwoToOnePlanningError(
        qualityPlanningErrorCode(error.code),
        error.message,
        {
          conflictingCellIds: stableNumericIds(selectedElementIds),
          conflictingInterfaces: [],
          attemptedActions: []
        }
      )
    );
  }
  if (error instanceof DirectTwoToOnePlanningError) {
    const conflictingCellIds = stableNumericIds(
      error.conflictingElementIds
    );
    return freezeTwoToOnePlanningErrorDiagnostic(
      new TwoToOnePlanningError(
        "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY",
        error.message,
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
      )
    );
  }
  throw error;
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

export function freezeTwoToOnePlanningErrorDiagnostic<
  TId extends number | string
>(error: TwoToOnePlanningError<TId>): TwoToOnePlanningError<TId> {
  const diagnostic = error.diagnostic;
  for (const entry of diagnostic.conflictingInterfaces) {
    Object.freeze(entry.faceNodeIds);
    Object.freeze(entry);
  }
  for (const action of diagnostic.attemptedActions) {
    Object.freeze(action.addedParentCellIds);
    Object.freeze(action.replacedTransitionCellIds);
    Object.freeze(action);
  }
  const suggestion = diagnostic.suggestion;
  if (suggestion !== undefined) {
    if (suggestion.parentCellIds !== undefined) {
      Object.freeze(suggestion.parentCellIds);
    }
    Object.freeze(suggestion);
  }
  if (diagnostic.historyCommandIds !== undefined) {
    Object.freeze(diagnostic.historyCommandIds);
  }
  Object.freeze(diagnostic.conflictingCellIds);
  Object.freeze(diagnostic.conflictingInterfaces);
  Object.freeze(diagnostic.attemptedActions);
  Object.freeze(diagnostic);
  return error;
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
      ...(diagnostic.historyCommandIds === undefined
        ? {}
        : {
            historyCommandIds: [
              ...new Set(diagnostic.historyCommandIds)
            ].sort()
          }),
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

function auditFinalHexPatchQuality(
  sourceMesh: Mesh,
  replacements: readonly ReplaceElement[],
  finalMesh: Mesh
): HexRefinementQualitySummary {
  const replacedIds = new Set(
    replacements.map((replacement) => replacement.elementId)
  );
  let childOffset = sourceMesh.elements.length - replacedIds.size;
  const finalReplacements = replacements.map((replacement) => {
    const childCount = replacement.refinement.elements.length;
    const elements = finalMesh.elements
      .slice(childOffset, childOffset + childCount)
      .map((element) => [...element]);
    childOffset += childCount;
    return {
      elementId: replacement.elementId,
      refinement: {
        kind: "H1" as const,
        source: replacement.refinement.source,
        nodes: finalMesh.nodes,
        elements
      }
    };
  });
  const quality = auditHexRefinementPatchQuality(
    sourceMesh,
    finalReplacements
  );
  let finalMinimumOrientedScaledJacobian = Number.POSITIVE_INFINITY;
  for (const [index, element] of finalMesh.elements.entries()) {
    if (element.length !== 8 || new Set(element).size !== 8) {
      throw new HexPatchQualityError(
        "HEX_PATCH_CHILD_JACOBIAN",
        `merged final Hex element ${index + 1} must contain eight distinct node ids`
      );
    }
    const vertices = element.map((nodeId) => {
      const point = finalMesh.nodes[nodeId - 1];
      if (!point) {
        throw new HexPatchQualityError(
          "HEX_PATCH_CHILD_JACOBIAN",
          `merged final Hex element ${index + 1} references missing node ${nodeId}`
        );
      }
      return point;
    });
    const signedVolume = hexElementSignedVolume(vertices);
    const orientation = signedVolume < 0 || Object.is(signedVolume, -0)
      ? -1
      : 1;
    finalMinimumOrientedScaledJacobian = Math.min(
      finalMinimumOrientedScaledJacobian,
      minimumOrientedHexCornerScaledJacobian(vertices, orientation)
    );
  }
  const childMinimumOrientedScaledJacobian = Math.min(
    quality.childMinimumOrientedScaledJacobian,
    finalMinimumOrientedScaledJacobian
  );
  return {
    ...quality,
    ok: Number.isFinite(quality.parentOrientedVolume)
      && Number.isFinite(quality.childOrientedVolume)
      && Number.isFinite(quality.relativeVolumeError)
      && Number.isFinite(quality.parentMinimumOrientedScaledJacobian)
      && Number.isFinite(childMinimumOrientedScaledJacobian)
      && quality.parentMinimumOrientedScaledJacobian > 0
      && childMinimumOrientedScaledJacobian > 0
      && quality.relativeVolumeError <= 1e-8,
    childMinimumOrientedScaledJacobian
  };
}

function finalConformancePlanningError(
  sourceMesh: Mesh,
  replacements: readonly ReplaceElement[],
  finalMesh: Mesh,
  hanging: readonly HangingEntity[],
  message: string
): TwoToOnePlanningError<number> {
  const sourceElementIdByFinalElementId = new Map<number, number>();
  const replacedElementIds = new Set(
    replacements.map((replacement) => replacement.elementId)
  );
  let finalElementId = 1;
  for (
    let sourceElementId = 1;
    sourceElementId <= sourceMesh.elements.length;
    sourceElementId += 1
  ) {
    if (!replacedElementIds.has(sourceElementId)) {
      sourceElementIdByFinalElementId.set(finalElementId, sourceElementId);
      finalElementId += 1;
    }
  }
  for (const replacement of replacements) {
    for (let index = 0; index < replacement.refinement.elements.length; index += 1) {
      sourceElementIdByFinalElementId.set(finalElementId, replacement.elementId);
      finalElementId += 1;
    }
  }
  if (finalElementId - 1 !== finalMesh.elements.length) {
    throw new Error("final Hex conformance element provenance is inconsistent");
  }

  const interfacesByKey = new Map<string, {
    firstCellId: number;
    secondCellId: number;
    faceNodeIds: number[];
  }>();
  for (const issue of hanging) {
    const owner = sourceElementIdByFinalElementId.get(issue.ownerElementId);
    const other = sourceElementIdByFinalElementId.get(issue.otherElementId);
    if (owner === undefined || other === undefined) {
      throw new Error("final Hex conformance references an unmapped element");
    }
    const firstCellId = Math.min(owner, other);
    const secondCellId = Math.max(owner, other);
    const faceNodeIds = stableNumericIds(issue.boundary);
    const key = `${firstCellId}:${secondCellId}:${faceNodeIds.join(",")}`;
    interfacesByKey.set(key, {
      firstCellId,
      secondCellId,
      faceNodeIds
    });
  }
  const conflictingInterfaces = [...interfacesByKey.values()].sort(
    (first, second) =>
      compareNumbers(first.firstCellId, second.firstCellId)
      || compareNumbers(first.secondCellId, second.secondCellId)
      || compareNumericArrays(first.faceNodeIds, second.faceNodeIds)
  );
  const conflictingCellIds = stableNumericIds(
    conflictingInterfaces.flatMap((entry) => [
      entry.firstCellId,
      entry.secondCellId
    ])
  );
  return freezeTwoToOnePlanningErrorDiagnostic(
    new TwoToOnePlanningError(
      "TWO_TO_ONE_CONFORMANCE",
      message,
      {
        conflictingCellIds,
        conflictingInterfaces,
        attemptedActions: [],
        suggestion: {
          kind: "expand-selection",
          parentCellIds: conflictingCellIds
        }
      }
    )
  );
}

function compareNumericArrays(
  first: readonly number[],
  second: readonly number[]
): number {
  const length = Math.min(first.length, second.length);
  for (let index = 0; index < length; index += 1) {
    const compared = compareNumbers(first[index]!, second[index]!);
    if (compared !== 0) {
      return compared;
    }
  }
  return first.length - second.length;
}
