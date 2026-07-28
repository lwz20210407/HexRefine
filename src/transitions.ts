import type { Mesh, RefineOptions } from "./types.js";
import { validateMergeTolerance } from "./mesh.js";
import {
  buildHexClassifiedPlanInternal,
  type ClassifiedHexPlan,
  type ClassifiedHexReplacement
} from "./transitions-internal.js";
import {
  asTwoToOneFlatPlanningError,
  assertHexPatchQuality
} from "./refinement-errors.js";

export type {
  ClassifiedHexPlan,
  ClassifiedHexReplacement
} from "./transitions-internal.js";

export {
  buildThreeToOneHexClassifiedReplacements,
  hexEdgeTransitionReplacements,
  hexFaceTransitionReplacements
} from "./transitions-internal.js";

export function buildHexClassifiedPlan(
  mesh: Mesh,
  selected: readonly number[],
  options: RefineOptions = {}
): ClassifiedHexPlan {
  validateMergeTolerance(options.mergeTolerance);
  if ((options.hexRefinementRatio ?? 3) !== 2) {
    return buildHexClassifiedPlanInternal(mesh, selected, options);
  }
  try {
    const plan = buildHexClassifiedPlanInternal(mesh, selected, options);
    if (plan.replacements.length > 0) {
      assertHexPatchQuality(mesh, plan.replacements);
    }
    return plan;
  } catch (error) {
    throw asTwoToOneFlatPlanningError(error, selected);
  }
}

export function buildHexClassifiedReplacements(
  mesh: Mesh,
  selected: readonly number[],
  options: RefineOptions = {}
): ClassifiedHexReplacement[] {
  return buildHexClassifiedPlan(mesh, selected, options).replacements;
}
