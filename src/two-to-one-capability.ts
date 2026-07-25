export type TwoToOneEntityId = number | string;

export type TwoToOneCompensationMode = "none" | "selection" | "local-topology";

export interface TwoToOneCompensationOptions {
  mode?: TwoToOneCompensationMode;
  maxAddedParentLayers?: number;
  maxAddedParentCount?: number;
}

export interface TwoToOneCompensationCarrier {
  hexTwoToOneCompensation?: TwoToOneCompensationOptions;
  rebuildExistingTransitions?: boolean;
}

export interface NormalizedTwoToOneCompensation {
  mode: TwoToOneCompensationMode;
  maxAddedParentLayers: number;
  maxAddedParentCount: number;
}

export interface TwoToOneCompensationAction<TId extends TwoToOneEntityId = TwoToOneEntityId> {
  kind: "selection-expand" | "transition-shell-rebuild" | "local-template";
  reason: string;
  addedParentCellIds: TId[];
  replacedTransitionCellIds: TId[];
  templateId?: string;
}

export interface TwoToOneCapabilityReport<TId extends TwoToOneEntityId = TwoToOneEntityId> {
  status: "direct" | "compensated";
  topologyClass: "structured" | "mapped" | "periodic-ogrid" | "mixed-level" | "unstructured";
  originalSelectedParentCellIds: TId[];
  effectiveSelectedParentCellIds: TId[];
  actions: TwoToOneCompensationAction<TId>[];
  affectedComponentCellIds: TId[];
  preservedFarFieldCellCount: number;
}

export type TwoToOnePlanningErrorCode =
  | "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY"
  | "TWO_TO_ONE_UNSUPPORTED_PARITY"
  | "TWO_TO_ONE_UNSUPPORTED_VALENCE"
  | "TWO_TO_ONE_AMBIGUOUS_FACE"
  | "TWO_TO_ONE_COMPENSATION_LIMIT"
  | "TWO_TO_ONE_HISTORY_CONFLICT"
  | "TWO_TO_ONE_CONFORMANCE"
  | "TWO_TO_ONE_PARENT_JACOBIAN"
  | "TWO_TO_ONE_CHILD_JACOBIAN"
  | "TWO_TO_ONE_VOLUME";

export interface TwoToOnePlanningDiagnostic<TId extends TwoToOneEntityId = TwoToOneEntityId> {
  conflictingCellIds: TId[];
  conflictingInterfaces: Array<{
    firstCellId: TId;
    secondCellId?: TId;
    faceNodeIds: number[];
  }>;
  attemptedActions: TwoToOneCompensationAction<TId>[];
  suggestion?: {
    kind: "expand-selection" | "reduce-level" | "remesh-source";
    axis?: 0 | 1 | 2;
    side?: -1 | 1;
    parentCellIds?: TId[];
  };
}

export class TwoToOnePlanningError<TId extends TwoToOneEntityId = TwoToOneEntityId> extends Error {
  readonly code: TwoToOnePlanningErrorCode;
  readonly diagnostic: TwoToOnePlanningDiagnostic<TId>;

  constructor(
    code: TwoToOnePlanningErrorCode,
    message: string,
    diagnostic: TwoToOnePlanningDiagnostic<TId>
  ) {
    super(message);
    this.name = "TwoToOnePlanningError";
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

export function normalizeTwoToOneCompensation(
  originalSelectedParentCount: number,
  options: TwoToOneCompensationCarrier
): NormalizedTwoToOneCompensation {
  const compensation = options.hexTwoToOneCompensation;
  const maxAddedParentLayers = compensation?.maxAddedParentLayers ?? 1;
  const maxAddedParentCount =
    compensation?.maxAddedParentCount
    ?? Math.max(32, Math.ceil(originalSelectedParentCount * 0.25));

  assertNonNegativeInteger(maxAddedParentLayers, "maxAddedParentLayers");
  assertNonNegativeInteger(maxAddedParentCount, "maxAddedParentCount");

  return {
    mode: options.rebuildExistingTransitions === false
      ? "none"
      : compensation?.mode ?? "local-topology",
    maxAddedParentLayers,
    maxAddedParentCount
  };
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}
