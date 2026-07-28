import type {
  BoxRange,
  HexSelectionRegularizationOptions,
  Mesh,
  Point,
  RefineOptions,
  RefinementCellData,
  RefinementPlanItem,
  RefinementPreview,
  RefinementResult,
  RefinementRole,
  RegularizedHexSelection
} from "./types.js";
import {
  inferMeshKind,
  minElementEdgeLength,
  selectElementsByPredicate,
  validateMergeTolerance
} from "./mesh.js";
import { type DistanceFunction, type DistanceSelection } from "./distance.js";
import {
  buildHexClassifiedPlan as buildSharedHexClassifiedPlan,
  buildHexClassifiedReplacements as buildSharedHexClassifiedReplacements,
  type ClassifiedHexReplacement
} from "./transitions.js";
import {
  regularizeHexSelection as regularizeHexSelectionCore,
  regularizeTwoToOneHexSelection
} from "./regularization.js";
import {
  pointInBox as pointInBoxCore,
  selectElementsByDistanceFunction as selectElementsByDistanceFunctionCore
} from "./mesh-selection.js";
import type { TwoToOneCapabilityReport } from "./two-to-one-capability.js";
import {
  asTwoToOneFlatPlanningError,
  buildAuditedHexRefinementOutput
} from "./refinement-errors.js";

export {
  regularizeHexSessionSelection,
  type HexSessionSelectionRegularizationOptions,
  type RegularizedHexSessionSelection
} from "./session-regularization.js";

export type { ClassifiedHexReplacement } from "./transitions.js";

export function refineHexByElementIds(mesh: Mesh, selectedElementIds: readonly number[], options: RefineOptions = {}): Mesh {
  return refineHexByElementIdsWithReport(mesh, selectedElementIds, options).mesh;
}

export function refineHexByElementIdsWithReport(
  mesh: Mesh,
  selectedElementIds: readonly number[],
  options: RefineOptions = {}
): RefinementResult {
  assertHexMesh(mesh);
  return atHexTwoToOneBoundary(mesh, selectedElementIds, options, () => {
    validateMergeTolerance(options.mergeTolerance);
    const selected = uniqueSorted(selectedElementIds);
    if (selected.length === 0) {
      return buildHexRefinementResult(mesh, mesh, [], 0);
    }

    const mergeTolerance =
      options.mergeTolerance ?? minElementEdgeLength(mesh) * 0.0005;
    const plan = buildSharedHexClassifiedPlan(mesh, selected, {
      ...options,
      mergeTolerance
    });
    const replacements = plan.replacements;
    const output = buildAuditedHexRefinementOutput(
      mesh,
      replacements,
      mergeTolerance,
      (options.includeTransitions ?? true)
        && options.hexRefinementRatio === 2
    );
    return buildHexRefinementResult(
      mesh,
      output.mesh,
      replacements,
      selected.length,
      plan.twoToOne,
      output.quality
    );
  });
}

export function refineHexByBox(mesh: Mesh, box: BoxRange, options: RefineOptions = {}): Mesh {
  return refineHexByBoxWithReport(mesh, box, options).mesh;
}

export function refineHexByBoxWithReport(mesh: Mesh, box: BoxRange, options: RefineOptions = {}): RefinementResult {
  assertHexMesh(mesh);
  const candidateIds = selectElementsByPredicate(mesh, (center) => pointInBox(center, box));
  return refineHexCandidateIdsWithReport(mesh, candidateIds, options);
}

export function refineHexByDistanceFunction(
  mesh: Mesh,
  distanceFunction: DistanceFunction,
  distValue = 0,
  options: RefineOptions = {}
): Mesh {
  return refineHexByDistanceFunctionWithReport(mesh, distanceFunction, distValue, options).mesh;
}

export function refineHexByDistanceFunctionWithReport(
  mesh: Mesh,
  distanceFunction: DistanceFunction,
  distValue = 0,
  options: RefineOptions = {}
): RefinementResult {
  assertHexMesh(mesh);
  const selection = selectHexElementsByDistanceFunction(mesh, distanceFunction, distValue);
  return refineHexCandidateIdsWithReport(mesh, selection.inside, options);
}

export function previewHexRefinementByElementIds(
  mesh: Mesh,
  selectedElementIds: readonly number[],
  options: RefineOptions = {}
): RefinementPreview {
  assertHexMesh(mesh);
  return atHexTwoToOneBoundary(mesh, selectedElementIds, options, () => {
    validateMergeTolerance(options.mergeTolerance);
    const selected = uniqueSorted(selectedElementIds);
    const plan = buildSharedHexClassifiedPlan(mesh, selected, options);
    return buildHexRefinementPreview(
      mesh,
      plan.replacements,
      plan.twoToOne,
      options
    );
  });
}

export function previewHexRefinementByBox(mesh: Mesh, box: BoxRange, options: RefineOptions = {}): RefinementPreview {
  assertHexMesh(mesh);
  const candidateIds = selectElementsByPredicate(mesh, (center) => pointInBox(center, box));
  return previewHexCandidateIds(mesh, candidateIds, options);
}

export function previewHexRefinementByDistanceFunction(
  mesh: Mesh,
  distanceFunction: DistanceFunction,
  distValue = 0,
  options: RefineOptions = {}
): RefinementPreview {
  assertHexMesh(mesh);
  const selection = selectHexElementsByDistanceFunction(mesh, distanceFunction, distValue);
  return previewHexCandidateIds(mesh, selection.inside, options);
}

export function selectHexElementsByDistanceFunction(
  mesh: Mesh,
  distanceFunction: DistanceFunction,
  distValue = 0
): DistanceSelection {
  assertHexMesh(mesh);
  return selectElementsByDistanceFunctionCore(mesh, distanceFunction, distValue);
}

export function regularizeHexSelection(
  mesh: Mesh,
  candidateElementIds: readonly number[],
  options: HexSelectionRegularizationOptions = {}
): RegularizedHexSelection {
  assertHexMesh(mesh);
  return regularizeHexSelectionCore(mesh, candidateElementIds, options);
}

export function refineHexCandidateIdsWithReport(
  mesh: Mesh,
  candidateIds: readonly number[],
  options: RefineOptions
): RefinementResult {
  return atHexTwoToOneBoundary(mesh, candidateIds, options, () => {
    const shouldRegularize = options.regularizeHexSelection ?? true;
    if (!shouldRegularize) {
      return refineHexByElementIdsWithReport(mesh, candidateIds, options);
    }
    const regularizationOptions = refinementRegularizationOptions(options);
    const regularization = regularizeCandidateSelection(
      mesh,
      candidateIds,
      options,
      regularizationOptions
    );
    const result = refineHexByElementIdsWithReport(
      mesh,
      regularization.selectedElementIds,
      {
        ...options,
        regularizeHexSelection: false
      }
    );
    return {
      ...result,
      regularization
    };
  });
}

export function previewHexCandidateIds(mesh: Mesh, candidateIds: readonly number[], options: RefineOptions): RefinementPreview {
  return atHexTwoToOneBoundary(mesh, candidateIds, options, () => {
    const shouldRegularize = options.regularizeHexSelection ?? true;
    if (!shouldRegularize) {
      return previewHexRefinementByElementIds(mesh, candidateIds, options);
    }
    const regularizationOptions = refinementRegularizationOptions(options);
    const regularization = regularizeCandidateSelection(
      mesh,
      candidateIds,
      options,
      regularizationOptions
    );
    const preview = previewHexRefinementByElementIds(
      mesh,
      regularization.selectedElementIds,
      {
        ...options,
        regularizeHexSelection: false
      }
    );
    return {
      ...preview,
      regularization
    };
  });
}

export function buildHexClassifiedReplacements(
  mesh: Mesh,
  selected: readonly number[],
  options: RefineOptions
): ClassifiedHexReplacement[] {
  return buildSharedHexClassifiedReplacements(mesh, selected, options);
}

function regularizeCandidateSelection(
  mesh: Mesh,
  candidateElementIds: readonly number[],
  options: RefineOptions,
  regularizationOptions: HexSelectionRegularizationOptions
): RegularizedHexSelection {
  return options.hexRefinementRatio === 2
    && options.hexTwoToOneSelectionMode !== "local"
    ? regularizeTwoToOneHexSelection(mesh, candidateElementIds, regularizationOptions)
    : regularizeHexSelectionCore(mesh, candidateElementIds, regularizationOptions);
}

function refinementRegularizationOptions(
  options: RefineOptions
): HexSelectionRegularizationOptions {
  return {
    ...(options.regularizationTolerance === undefined
      ? {}
      : { tolerance: options.regularizationTolerance }),
    ...(options.hexTransitionAxis === undefined
      ? {}
      : { transitionAxis: options.hexTransitionAxis })
  };
}

export function assertHexMesh(mesh: Mesh): void {
  if (inferMeshKind(mesh) !== "H1") {
    throw new Error("hex-refinement requires an H1/Hex mesh");
  }
}

function buildHexRefinementResult(
  inputMesh: Mesh,
  mesh: Mesh,
  replacements: readonly ClassifiedHexReplacement[],
  selectedElementCount: number,
  twoToOne?: TwoToOneCapabilityReport<number>,
  quality?: RefinementResult["quality"]
): RefinementResult {
  const replacedIds = new Set(replacements.map((replacement) => replacement.elementId));
  const cellData: RefinementCellData[] = [];

  for (let index = 0; index < inputMesh.elements.length; index += 1) {
    const elementId = index + 1;
    if (!replacedIds.has(elementId)) {
      cellData.push({
        parentElementId: elementId,
        role: "unchanged",
        templateCode: 0
      });
    }
  }

  for (const replacement of replacements) {
    for (let i = 0; i < replacement.refinement.elements.length; i += 1) {
      cellData.push({
        parentElementId: replacement.elementId,
        role: replacement.role,
        templateCode: replacement.templateCode
      });
    }
  }

  const countRole = (role: RefinementRole) => replacements.filter((replacement) => replacement.role === role).length;
  return {
    mesh,
    cellData,
    summary: {
      selectedElementCount,
      faceTransitionElementCount: countRole("face-transition"),
      edgeTransitionElementCount: countRole("edge-transition"),
      cornerTransitionElementCount: countRole("corner-transition"),
      unchangedElementCount: cellData.filter((cell) => cell.role === "unchanged").length,
      outputNodeCount: mesh.nodes.length,
      outputElementCount: mesh.elements.length
    },
    ...(quality ? { quality } : {}),
    ...(twoToOne ? { twoToOne } : {})
  };
}

function buildHexRefinementPreview(
  mesh: Mesh,
  replacements: readonly ClassifiedHexReplacement[],
  twoToOne: TwoToOneCapabilityReport<number> | undefined,
  options: RefineOptions
): RefinementPreview {
  const replacedIds = new Set(replacements.map((replacement) => replacement.elementId));
  const quality = replacements.length > 0
    ? buildAuditedHexRefinementOutput(
        mesh,
        replacements,
        options.mergeTolerance ?? minElementEdgeLength(mesh) * 0.0005,
        (options.includeTransitions ?? true)
          && options.hexRefinementRatio === 2
      ).quality
    : undefined;
  const plan: RefinementPlanItem[] = replacements
    .map((replacement) => ({
      parentElementId: replacement.elementId,
      role: replacement.role,
      templateCode: replacement.templateCode,
      outputElementCount: replacement.refinement.elements.length
    }))
    .sort((a, b) => a.parentElementId - b.parentElementId || a.templateCode - b.templateCode);
  const countRole = (role: RefinementRole) => plan.filter((item) => item.role === role).length;
  const unchangedElementCount = mesh.elements.length - replacedIds.size;
  return {
    kind: "H1",
    planMode: "per-parent",
    plan,
    summary: {
      selectedElementCount: countRole("selected"),
      faceTransitionElementCount: countRole("face-transition"),
      edgeTransitionElementCount: countRole("edge-transition"),
      cornerTransitionElementCount: countRole("corner-transition"),
      unchangedElementCount,
      estimatedOutputElementCount: unchangedElementCount + plan.reduce((total, item) => total + item.outputElementCount, 0)
    },
    ...(quality ? { quality } : {}),
    ...(twoToOne ? { twoToOne } : {})
  };
}

function pointInBox(point: Point, box: BoxRange): boolean {
  return pointInBoxCore(point, box);
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function atHexTwoToOneBoundary<T>(
  mesh: Mesh,
  selectedElementIds: readonly number[],
  options: RefineOptions,
  operation: () => T
): T {
  if (
    options.hexRefinementRatio !== 2
    || inferMeshKind(mesh) !== "H1"
  ) {
    return operation();
  }
  try {
    return operation();
  } catch (error) {
    throw asTwoToOneFlatPlanningError(error, selectedElementIds);
  }
}
