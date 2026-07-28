import { auditHexRefinementPatchQuality } from "./hex-quality.js";
import { minElementEdgeLength } from "./mesh.js";
import { inferHexElementLattice, type HexElementLattice } from "./regularization.js";
import {
  DirectTwoToOnePlanningError,
  normalizeTwoToOneCompensation,
  TwoToOnePlanningError,
  type TwoToOneCapabilityReport,
  type TwoToOneCompensationAction,
  type TwoToOneCompensationCarrier,
  type TwoToOnePlanningErrorCode,
  type TwoToOneTopologyClass
} from "./two-to-one-capability.js";
import {
  buildDirectTwoToOneHexPlan,
  type DirectTwoToOnePlan,
  type TwoToOneReplacement
} from "./two-to-one.js";
import type { Mesh, RefineOptions } from "./types.js";

export type TwoToOnePlanningOptions =
  & Omit<RefineOptions, "includeTransitions">
  & TwoToOneCompensationCarrier
  & { includeTransitions?: true };

export interface PlannedTwoToOneHexRefinement {
  replacements: TwoToOneReplacement[];
  report: TwoToOneCapabilityReport<number>;
}

interface LogicalExpansionCandidate {
  effectiveSelectedCellIds: number[];
  addedParentCellIds: number[];
  axis: 0 | 1 | 2;
  side: -1 | 1;
}

interface SuccessfulCandidate extends LogicalExpansionCandidate {
  direct: DirectTwoToOnePlan;
  childMinimumOrientedScaledJacobian: number;
}

interface RankableSuccessfulCandidate {
  addedParentCellIds: readonly number[];
  direct: {
    replacements: readonly unknown[];
  };
  childMinimumOrientedScaledJacobian: number;
  effectiveSelectedCellIds: readonly number[];
}

export function planTwoToOneHexRefinement(
  mesh: Mesh,
  selectedElementIds: readonly number[],
  options: TwoToOnePlanningOptions = {}
): PlannedTwoToOneHexRefinement {
  if ((options as RefineOptions).includeTransitions === false) {
    throw new RangeError(
      "planTwoToOneHexRefinement requires transitions to be enabled"
    );
  }
  const original = uniqueSorted(selectedElementIds);
  const compensation = normalizeTwoToOneCompensation(original.length, options);

  let directFailure: DirectTwoToOnePlanningError;
  try {
    const direct = buildDirectTwoToOneHexPlan(mesh, original);
    return plannedResult(mesh, original, original, direct, "direct");
  } catch (error) {
    if (!(error instanceof DirectTwoToOnePlanningError)) {
      throw error;
    }
    directFailure = error;
  }

  if (
    compensation.mode === "none"
    || directFailure.kind !== "selection-signature"
  ) {
    throw publicPlanningError(directFailure, original, []);
  }

  const candidates = oneLayerLogicalExpansionCandidates(mesh, original);
  const attemptedActions = candidates.map((candidate) =>
    attemptedSelectionExpansion(candidate, directFailure.message)
  );
  const eligible = compensation.maxAddedParentLayers >= 1
    ? candidates.filter((candidate) =>
        candidate.addedParentCellIds.length <= compensation.maxAddedParentCount
      )
    : [];
  const successful: SuccessfulCandidate[] = [];

  for (const candidate of eligible) {
    let direct: DirectTwoToOnePlan;
    try {
      direct = buildDirectTwoToOneHexPlan(mesh, candidate.effectiveSelectedCellIds);
    } catch (error) {
      if (error instanceof DirectTwoToOnePlanningError) {
        continue;
      }
      throw error;
    }
    const quality = auditHexRefinementPatchQuality(mesh, direct.replacements);
    if (!quality.ok) {
      continue;
    }
    successful.push({
      ...candidate,
      direct,
      childMinimumOrientedScaledJacobian:
        quality.childMinimumOrientedScaledJacobian
    });
  }

  const selected = rankSuccessfulTwoToOneCandidates(successful)[0];
  if (selected) {
    return plannedResult(
      mesh,
      original,
      selected.effectiveSelectedCellIds,
      selected.direct,
      "compensated",
      [{
        kind: "selection-expand",
        reason: "completed a conforming one-layer 2:1 template field",
        addedParentCellIds: [...selected.addedParentCellIds],
        replacedTransitionCellIds: []
      }]
    );
  }

  if (candidates.length > 0 && eligible.length === 0) {
    throw new TwoToOnePlanningError(
      "TWO_TO_ONE_COMPENSATION_LIMIT",
      "2:1 selection compensation exceeds the configured parent limits",
      planningDiagnostic(original, attemptedActions, candidates[0])
    );
  }
  throw publicPlanningError(
    directFailure,
    original,
    attemptedActions,
    candidates[0]
  );
}

function oneLayerLogicalExpansionCandidates(
  mesh: Mesh,
  selectedElementIds: readonly number[]
): LogicalExpansionCandidate[] {
  if (selectedElementIds.length === 0) {
    return [];
  }
  const latticeMesh = normalizedLatticeInferenceMesh(mesh, selectedElementIds);
  const tolerance = Math.max(
    minElementEdgeLength(latticeMesh) * 1e-8,
    Number.EPSILON * 64
  );
  const lattice = inferHexElementLattice(latticeMesh, tolerance);
  const indices = selectedElementIds.map((elementId) =>
    lattice.indicesByElementId.get(elementId)
  );
  if (indices.some((index) => index === undefined)) {
    return [];
  }

  const range = boundingRange(indices as Array<[number, number, number]>);
  const selectedSet = new Set(selectedElementIds);
  const rangeIds = idsInRange(lattice, range.min, range.max);
  if (
    rangeIds.length !== selectedElementIds.length
    || rangeIds.some((elementId) => !selectedSet.has(elementId))
  ) {
    return [];
  }

  const candidates: LogicalExpansionCandidate[] = [];
  for (const axis of [0, 1, 2] as const) {
    for (const side of [-1, 1] as const) {
      const min = [...range.min] as [number, number, number];
      const max = [...range.max] as [number, number, number];
      if (side === -1) {
        if (min[axis] === 0) {
          continue;
        }
        min[axis] -= 1;
      } else {
        if (max[axis] === lattice.dimensions[axis] - 1) {
          continue;
        }
        max[axis] += 1;
      }
      const effectiveSelectedCellIds = idsInRange(lattice, min, max);
      if (effectiveSelectedCellIds.length === 0) {
        continue;
      }
      const addedParentCellIds = effectiveSelectedCellIds.filter(
        (elementId) => !selectedSet.has(elementId)
      );
      candidates.push({
        effectiveSelectedCellIds,
        addedParentCellIds,
        axis,
        side
      });
    }
  }

  const unique = new Map<string, LogicalExpansionCandidate>();
  for (const candidate of candidates) {
    const key = candidate.effectiveSelectedCellIds.join(",");
    if (!unique.has(key)) {
      unique.set(key, candidate);
    }
  }
  return [...unique.values()].sort((first, second) =>
    compareNumberArrays(
      first.effectiveSelectedCellIds,
      second.effectiveSelectedCellIds
    )
    || first.axis - second.axis
    || first.side - second.side
  );
}

function normalizedLatticeInferenceMesh(
  mesh: Mesh,
  selectedElementIds: readonly number[]
): Mesh {
  const minimumEdge = minElementEdgeLength(mesh);
  let coordinateScale = 0;
  for (const point of mesh.nodes) {
    for (const coordinate of point) {
      if (!Number.isFinite(coordinate)) {
        throw latticeResolutionError(
          selectedElementIds,
          "2:1 compensation lattice inference requires finite coordinates"
        );
      }
      coordinateScale = Math.max(coordinateScale, Math.abs(coordinate));
    }
  }
  const precisionFloor = coordinateScale * Number.EPSILON * 64;
  if (
    !Number.isFinite(minimumEdge)
    || minimumEdge <= 0
    || !Number.isFinite(precisionFloor)
    || precisionFloor >= minimumEdge / 2
  ) {
    throw latticeResolutionError(
      selectedElementIds,
      `2:1 compensation lattice tolerance ${precisionFloor} reaches minimum edge ${minimumEdge} resolution limit`
    );
  }

  const origin = mesh.nodes[0] ?? [];
  const normalized: Mesh = {
    ...mesh,
    nodes: mesh.nodes.map((point) =>
      point.map((coordinate, axis) =>
        (coordinate - (origin[axis] ?? 0)) / minimumEdge
      )
    ),
    elements: mesh.elements
  };
  const normalizedMinimumEdge = minElementEdgeLength(normalized);
  const normalizedTolerance = Math.max(
    normalizedMinimumEdge * 1e-8,
    Number.EPSILON * 64
  );
  if (
    !Number.isFinite(normalizedMinimumEdge)
    || normalizedMinimumEdge <= 0
    || normalizedTolerance >= normalizedMinimumEdge / 2
  ) {
    throw latticeResolutionError(
      selectedElementIds,
      `2:1 compensation lattice tolerance ${normalizedTolerance} reaches minimum edge ${normalizedMinimumEdge} resolution limit`
    );
  }
  return normalized;
}

function latticeResolutionError(
  selectedElementIds: readonly number[],
  message: string
): TwoToOnePlanningError<number> {
  return new TwoToOnePlanningError(
    "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY",
    message,
    planningDiagnostic(selectedElementIds, [])
  );
}

function boundingRange(indices: Array<[number, number, number]>): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const first = indices[0]!;
  const min: [number, number, number] = [...first];
  const max: [number, number, number] = [...first];
  for (const index of indices.slice(1)) {
    for (const axis of [0, 1, 2] as const) {
      min[axis] = Math.min(min[axis], index[axis]);
      max[axis] = Math.max(max[axis], index[axis]);
    }
  }
  return { min, max };
}

function idsInRange(
  lattice: HexElementLattice,
  min: readonly [number, number, number],
  max: readonly [number, number, number]
): number[] {
  const ids: number[] = [];
  for (let k = min[2]; k <= max[2]; k += 1) {
    for (let j = min[1]; j <= max[1]; j += 1) {
      for (let i = min[0]; i <= max[0]; i += 1) {
        const elementId = lattice.elementIdByKey.get(`${i}:${j}:${k}`);
        if (elementId === undefined) {
          return [];
        }
        ids.push(elementId);
      }
    }
  }
  return ids.sort((first, second) => first - second);
}

function attemptedSelectionExpansion(
  candidate: LogicalExpansionCandidate,
  reason: string
): TwoToOneCompensationAction<number> {
  return {
    kind: "selection-expand",
    reason,
    addedParentCellIds: [...candidate.addedParentCellIds],
    replacedTransitionCellIds: []
  };
}

function plannedResult(
  mesh: Mesh,
  original: readonly number[],
  effective: readonly number[],
  direct: DirectTwoToOnePlan,
  status: "direct" | "compensated",
  actions: TwoToOneCompensationAction<number>[] = []
): PlannedTwoToOneHexRefinement {
  const affectedComponentCellIds = uniqueSorted(
    direct.replacements.map((replacement) => replacement.elementId)
  );
  return {
    replacements: direct.replacements,
    report: {
      status,
      topologyClass: topologyClass(direct),
      originalSelectedCellIds: [...original],
      effectiveSelectedCellIds: [...effective],
      actions,
      affectedComponentCellIds,
      preservedFarFieldCellCount:
        mesh.elements.length - affectedComponentCellIds.length
    }
  };
}

function topologyClass(direct: DirectTwoToOnePlan): TwoToOneTopologyClass {
  return direct.strategy === "local-sweep" ? "mapped" : "periodic-ogrid";
}

function publicPlanningError(
  failure: DirectTwoToOnePlanningError,
  original: readonly number[],
  attemptedActions: TwoToOneCompensationAction<number>[],
  candidate?: LogicalExpansionCandidate
): TwoToOnePlanningError<number> {
  return new TwoToOnePlanningError(
    planningErrorCode(failure),
    failure.message,
    planningDiagnostic(original, attemptedActions, candidate)
  );
}

function planningErrorCode(
  failure: DirectTwoToOnePlanningError
): TwoToOnePlanningErrorCode {
  if (failure.kind === "parity") {
    return "TWO_TO_ONE_UNSUPPORTED_PARITY";
  }
  if (failure.kind === "valence") {
    return "TWO_TO_ONE_UNSUPPORTED_VALENCE";
  }
  return "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY";
}

function planningDiagnostic(
  original: readonly number[],
  attemptedActions: TwoToOneCompensationAction<number>[],
  candidate?: LogicalExpansionCandidate
) {
  return {
    conflictingCellIds: [...original],
    conflictingInterfaces: [],
    attemptedActions,
    suggestion: candidate
      ? {
          kind: "expand-selection" as const,
          axis: candidate.axis,
          side: candidate.side,
          parentCellIds: [...candidate.addedParentCellIds]
        }
      : {
          kind: "remesh-source" as const
        }
  };
}

/** @internal Exported for deterministic contract testing, not from the package root. */
export function rankSuccessfulTwoToOneCandidates<
  TCandidate extends RankableSuccessfulCandidate
>(candidates: readonly TCandidate[]): TCandidate[] {
  return [...candidates].sort(compareSuccessfulCandidates);
}

function compareSuccessfulCandidates(
  first: RankableSuccessfulCandidate,
  second: RankableSuccessfulCandidate
): number {
  return first.addedParentCellIds.length - second.addedParentCellIds.length
    || first.direct.replacements.length - second.direct.replacements.length
    || second.childMinimumOrientedScaledJacobian
      - first.childMinimumOrientedScaledJacobian
    || compareNumberArrays(
      first.effectiveSelectedCellIds,
      second.effectiveSelectedCellIds
    );
}

function compareNumberArrays(
  first: readonly number[],
  second: readonly number[]
): number {
  const length = Math.min(first.length, second.length);
  for (let index = 0; index < length; index += 1) {
    const difference = first[index]! - second[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return first.length - second.length;
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((first, second) => first - second);
}
