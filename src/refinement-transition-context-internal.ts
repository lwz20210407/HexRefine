import type { Point } from "./types.js";
import type { CellId } from "./refinement-session.js";

export interface ImmutableBoundaryFacePartition {
  readonly ownerCellId: CellId;
  readonly adjacentComponentCellId: CellId;
  readonly nodeIds: readonly number[];
  readonly points: readonly Readonly<Point>[];
}

export interface TransitionRebuildFaceResolution {
  readonly tolerance: number;
  readonly minimumElementEdgeLength: number;
  readonly coordinateScale: number;
  readonly mergeTolerance?: number;
}

export interface TransitionRebuildContext {
  readonly selectedCellIds: readonly CellId[];
  readonly supportCellIds: readonly CellId[];
  readonly ancestorCellIds: readonly CellId[];
  readonly boundaryCellIds: readonly CellId[];
  readonly activeComponentCellIds: readonly CellId[];
  readonly referencedNodeIds: readonly number[];
  readonly supportCommandIds: readonly string[];
  readonly downstreamCommandIds: readonly string[];
  readonly boundaryFaces: readonly ImmutableBoundaryFacePartition[];
  readonly faceResolution: TransitionRebuildFaceResolution;
}

export interface TransitionRebuildContextInput {
  readonly selectedCellIds: readonly CellId[];
  readonly supportCellIds: readonly CellId[];
  readonly ancestorCellIds: readonly CellId[];
  readonly boundaryCellIds: readonly CellId[];
  readonly activeComponentCellIds: readonly CellId[];
  readonly referencedNodeIds: readonly number[];
  readonly supportCommandIds: readonly string[];
  readonly downstreamCommandIds: readonly string[];
  readonly boundaryFaces: readonly ImmutableBoundaryFacePartition[];
  readonly faceResolution: TransitionRebuildFaceResolution;
}

export function createTransitionRebuildContextInternal(
  input: TransitionRebuildContextInput
): TransitionRebuildContext {
  const boundaryFaces = input.boundaryFaces.map((face) => {
    if (face.nodeIds.length !== face.points.length) {
      throw new Error("transition boundary face node and point counts differ");
    }
    const nodeIds = Object.freeze([...face.nodeIds]);
    const points = Object.freeze(face.points.map((point) =>
      Object.freeze([...point]) as Readonly<Point>
    ));
    return Object.freeze({
      ownerCellId: face.ownerCellId,
      adjacentComponentCellId: face.adjacentComponentCellId,
      nodeIds,
      points
    });
  });
  const faceResolution = Object.freeze({
    tolerance: input.faceResolution.tolerance,
    minimumElementEdgeLength:
      input.faceResolution.minimumElementEdgeLength,
    coordinateScale: input.faceResolution.coordinateScale,
    ...(input.faceResolution.mergeTolerance === undefined
      ? {}
      : { mergeTolerance: input.faceResolution.mergeTolerance })
  });
  return Object.freeze({
    selectedCellIds: frozenUnique(input.selectedCellIds),
    supportCellIds: frozenUnique(input.supportCellIds),
    ancestorCellIds: frozenUnique(input.ancestorCellIds),
    boundaryCellIds: frozenUnique(input.boundaryCellIds),
    activeComponentCellIds: frozenUnique(
      input.activeComponentCellIds
    ),
    referencedNodeIds: frozenUnique(input.referencedNodeIds),
    supportCommandIds: frozenUnique(input.supportCommandIds),
    downstreamCommandIds: frozenUnique(input.downstreamCommandIds),
    boundaryFaces: Object.freeze(boundaryFaces),
    faceResolution
  });
}

function frozenUnique<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)]);
}
