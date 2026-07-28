import type { Mesh, RefineOptions } from "./types.js";
import { inferMeshKind, validateMergeTolerance } from "./mesh.js";
import {
  buildDefaultRefinementPlanInternal,
  type ClassifiedRefinementPlan,
  type ClassifiedReplacement
} from "./refinement-planner-internal.js";
import {
  asTwoToOneFlatPlanningError,
  assertHexPatchQuality
} from "./refinement-errors.js";

export type {
  ClassifiedRefinementPlan,
  ClassifiedReplacement
} from "./refinement-planner-internal.js";

export interface RefinementPlanner {
  plan(
    mesh: Mesh,
    selectedElementIds: readonly number[],
    options?: RefineOptions
  ): ClassifiedReplacement[];
}

export const defaultRefinementPlanner: RefinementPlanner = {
  plan: buildDefaultRefinementReplacements
};

export function buildDefaultRefinementReplacements(
  mesh: Mesh,
  selectedElementIds: readonly number[],
  options: RefineOptions = {}
): ClassifiedReplacement[] {
  return buildDefaultRefinementPlan(
    mesh,
    selectedElementIds,
    options
  ).replacements;
}

export function buildDefaultRefinementPlan(
  mesh: Mesh,
  selectedElementIds: readonly number[],
  options: RefineOptions = {}
): ClassifiedRefinementPlan {
  validateMergeTolerance(options.mergeTolerance);
  const kind = inferMeshKind(mesh);
  if (kind !== "H1" || options.hexRefinementRatio !== 2) {
    return buildDefaultRefinementPlanInternal(
      mesh,
      selectedElementIds,
      options
    );
  }
  try {
    const plan = buildDefaultRefinementPlanInternal(
      mesh,
      selectedElementIds,
      options
    );
    if (plan.replacements.length > 0) {
      assertHexPatchQuality(mesh, plan.replacements);
    }
    return plan;
  } catch (error) {
    throw asTwoToOneFlatPlanningError(error, selectedElementIds);
  }
}
