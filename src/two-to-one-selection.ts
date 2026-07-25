import type { Mesh } from "./types.js";
import { DirectTwoToOnePlanningError } from "./two-to-one-capability.js";

declare const normalizedTwoToOneSelectionBrand: unique symbol;

/**
 * Trusted 2:1 solver input: validated against one mesh, deduplicated, sorted,
 * and immutable. Only a public boundary should create this snapshot.
 */
export type NormalizedTwoToOneSelection = ReadonlyArray<number> & {
  readonly [normalizedTwoToOneSelectionBrand]: true;
};

export function normalizeTwoToOneSelection(
  mesh: Mesh,
  selectedElementIds: readonly number[]
): NormalizedTwoToOneSelection {
  const invalidElementIds = [...new Set(selectedElementIds.filter((elementId) =>
    !Number.isSafeInteger(elementId)
    || elementId < 1
    || elementId > mesh.elements.length
  ))];
  if (invalidElementIds.length > 0) {
    throw new DirectTwoToOnePlanningError(
      "topology",
      `selected Hex element ids are out of range: ${invalidElementIds.join(", ")}`,
      invalidElementIds
    );
  }
  return Object.freeze(
    [...new Set(selectedElementIds)].sort((first, second) => first - second)
  ) as NormalizedTwoToOneSelection;
}
