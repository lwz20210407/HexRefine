import type { ElementKind } from "./types.js";
import type { NormalizedTwoToOneCompensation } from "./two-to-one-capability.js";
import type {
  CellId,
  RefinementSessionCellRole
} from "./refinement-session.js";

export interface RefinementCellGeometrySnapshot {
  readonly originalCellId: CellId;
  readonly kind: ElementKind;
  readonly level: number;
  readonly role: RefinementSessionCellRole;
  readonly points: readonly (readonly number[])[];
}

export interface RefinementSessionReplayOptionsV1 {
  readonly includeTransitions: boolean;
  readonly hexRefinementRatio: 2 | 3;
  readonly hexTwoToOneSelectionMode: "section" | "local";
  readonly hexTwoToOneCompensation: Readonly<NormalizedTwoToOneCompensation>;
  readonly rebuildExistingTransitions: boolean;
  readonly mergeTolerance?: number;
}

export interface RefinementSessionCommandRecipeV1 {
  readonly version: 1;
  readonly selectedCellIds: readonly CellId[];
  readonly selectedCellGeometry: readonly RefinementCellGeometrySnapshot[];
  readonly transitionSupportCellIds: readonly CellId[];
  readonly transitionSupportCellGeometry: readonly RefinementCellGeometrySnapshot[];
  readonly options: RefinementSessionReplayOptionsV1;
}

export function cloneRefinementSessionCommandRecipe(
  recipe: RefinementSessionCommandRecipeV1
): RefinementSessionCommandRecipeV1 {
  return {
    version: 1,
    selectedCellIds: [...recipe.selectedCellIds],
    selectedCellGeometry: recipe.selectedCellGeometry.map(
      cloneRefinementCellGeometrySnapshot
    ),
    transitionSupportCellIds: [...recipe.transitionSupportCellIds],
    transitionSupportCellGeometry:
      recipe.transitionSupportCellGeometry.map(
        cloneRefinementCellGeometrySnapshot
      ),
    options: {
      includeTransitions: recipe.options.includeTransitions,
      hexRefinementRatio: recipe.options.hexRefinementRatio,
      hexTwoToOneSelectionMode:
        recipe.options.hexTwoToOneSelectionMode,
      hexTwoToOneCompensation: {
        mode: recipe.options.hexTwoToOneCompensation.mode,
        maxAddedParentLayers:
          recipe.options.hexTwoToOneCompensation.maxAddedParentLayers,
        maxAddedParentCount:
          recipe.options.hexTwoToOneCompensation.maxAddedParentCount
      },
      rebuildExistingTransitions:
        recipe.options.rebuildExistingTransitions,
      ...(recipe.options.mergeTolerance === undefined
        ? {}
        : { mergeTolerance: recipe.options.mergeTolerance })
    }
  };
}

export function freezeRefinementSessionCommandRecipe(
  recipe: RefinementSessionCommandRecipeV1
): RefinementSessionCommandRecipeV1 {
  const cloned = cloneRefinementSessionCommandRecipe(recipe);
  for (const geometry of [
    ...cloned.selectedCellGeometry,
    ...cloned.transitionSupportCellGeometry
  ]) {
    for (const point of geometry.points) {
      Object.freeze(point);
    }
    Object.freeze(geometry.points);
    Object.freeze(geometry);
  }
  Object.freeze(cloned.selectedCellIds);
  Object.freeze(cloned.selectedCellGeometry);
  Object.freeze(cloned.transitionSupportCellIds);
  Object.freeze(cloned.transitionSupportCellGeometry);
  Object.freeze(cloned.options.hexTwoToOneCompensation);
  Object.freeze(cloned.options);
  return Object.freeze(cloned);
}

function cloneRefinementCellGeometrySnapshot(
  geometry: RefinementCellGeometrySnapshot
): RefinementCellGeometrySnapshot {
  if (geometry.points.length === 0) {
    throw new Error(
      `geometry for cell ${geometry.originalCellId} must contain at least one point`
    );
  }
  const points = Array.from(geometry.points, (point, pointIndex) => {
    if (point === undefined || point.length === 0) {
      throw new Error(
        `geometry for cell ${geometry.originalCellId} point ${pointIndex + 1} must contain at least one coordinate`
      );
    }
    return Array.from(point, (coordinate, coordinateIndex) => {
      if (!Number.isFinite(coordinate)) {
        throw new Error(
          `geometry for cell ${geometry.originalCellId} point ${pointIndex + 1} coordinate ${coordinateIndex + 1} must be finite`
        );
      }
      return coordinate;
    });
  });
  return {
    originalCellId: geometry.originalCellId,
    kind: geometry.kind,
    level: geometry.level,
    role: geometry.role,
    points
  };
}
