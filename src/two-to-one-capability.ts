export type TwoToOneEntityId = number | string;

/**
 * "none" disables compensation, "selection" may expand selected parents, and
 * "local-topology" may also rebuild a local transition shell or use templates.
 */
export type TwoToOneCompensationMode = "none" | "selection" | "local-topology";

export type TwoToOnePlanningStatus = "direct" | "compensated";

export type TwoToOneTopologyClass =
  | "structured"
  | "mapped"
  | "periodic-ogrid"
  | "mixed-level"
  | "unstructured";

export interface TwoToOneCompensationOptions {
  mode?: TwoToOneCompensationMode;
  /** Parent-cell layers that compensation may add. Defaults to 1. */
  maxAddedParentLayers?: number;
  /** Parent cells that compensation may add. Defaults to max(32, ceil(selected / 4)). */
  maxAddedParentCount?: number;
}

export interface TwoToOneCompensationCarrier {
  hexTwoToOneCompensation?: TwoToOneCompensationOptions;
  /** Compatibility switch: false forces compensation mode to "none". */
  rebuildExistingTransitions?: boolean;
}

export interface NormalizedTwoToOneCompensation {
  mode: TwoToOneCompensationMode;
  maxAddedParentLayers: number;
  maxAddedParentCount: number;
}

export interface TwoToOneCompensationAction<TId extends TwoToOneEntityId = number> {
  kind: "selection-expand" | "transition-shell-rebuild" | "local-template";
  reason: string;
  addedParentCellIds: TId[];
  replacedTransitionCellIds: TId[];
  templateId?: string;
}

export interface TwoToOneCapabilityReport<TId extends TwoToOneEntityId = number> {
  status: TwoToOnePlanningStatus;
  topologyClass: TwoToOneTopologyClass;
  originalSelectedCellIds: TId[];
  effectiveSelectedCellIds: TId[];
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

export interface TwoToOnePlanningDiagnostic<TId extends TwoToOneEntityId = number> {
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

export interface TwoToOnePlanningErrorDto<TId extends TwoToOneEntityId = number> {
  name: "TwoToOnePlanningError";
  message: string;
  code: TwoToOnePlanningErrorCode;
  diagnostic: TwoToOnePlanningDiagnostic<TId>;
}

export class TwoToOnePlanningError<TId extends TwoToOneEntityId = number> extends Error {
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

  toJSON(): TwoToOnePlanningErrorDto<TId> {
    return {
      name: "TwoToOnePlanningError",
      message: this.message,
      code: this.code,
      diagnostic: this.diagnostic
    };
  }
}

export function serializeTwoToOnePlanningError<TId extends TwoToOneEntityId = number>(
  error: TwoToOnePlanningError<TId>
): TwoToOnePlanningErrorDto<TId> {
  return error.toJSON();
}

export function normalizeTwoToOneCompensation(
  originalSelectedParentCount: number,
  options: TwoToOneCompensationCarrier
): NormalizedTwoToOneCompensation {
  assertNonNegativeSafeInteger(originalSelectedParentCount, "originalSelectedParentCount");
  assertPlainObject(options, "options");

  let compensation: TwoToOneCompensationOptions | undefined;
  if (Object.hasOwn(options, "hexTwoToOneCompensation")) {
    const candidate: unknown = options.hexTwoToOneCompensation;
    assertPlainObject(candidate, "hexTwoToOneCompensation");
    compensation = candidate as TwoToOneCompensationOptions;
  }

  if (
    compensation !== undefined
    && Object.hasOwn(compensation, "mode")
    && compensation.mode !== "none"
    && compensation.mode !== "selection"
    && compensation.mode !== "local-topology"
  ) {
    throw new TypeError("hexTwoToOneCompensation.mode must be none, selection, or local-topology");
  }
  if (
    Object.hasOwn(options, "rebuildExistingTransitions")
    && typeof options.rebuildExistingTransitions !== "boolean"
  ) {
    throw new TypeError("rebuildExistingTransitions must be a boolean");
  }

  const maxAddedParentLayers =
    compensation !== undefined && Object.hasOwn(compensation, "maxAddedParentLayers")
      ? compensation.maxAddedParentLayers
      : 1;
  const maxAddedParentCount =
    compensation !== undefined && Object.hasOwn(compensation, "maxAddedParentCount")
      ? compensation.maxAddedParentCount
      : Math.max(32, Math.ceil(originalSelectedParentCount * 0.25));

  assertNonNegativeSafeInteger(maxAddedParentLayers, "maxAddedParentLayers");
  assertNonNegativeSafeInteger(maxAddedParentCount, "maxAddedParentCount");

  return {
    mode: options.rebuildExistingTransitions === false
      ? "none"
      : compensation?.mode ?? "local-topology",
    maxAddedParentLayers,
    maxAddedParentCount
  };
}

function assertNonNegativeSafeInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function assertPlainObject(value: unknown, name: string): asserts value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${name} must be a non-null plain object`);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${name} must be a non-null plain object`);
  }
}
