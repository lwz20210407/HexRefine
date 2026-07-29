export type TwoToOneEntityId = number | string;

/**
 * "none" disables compensation, "selection" may expand selected parents, and
 * "local-topology" may also rebuild a local transition shell or use templates.
 */
export type TwoToOneCompensationMode = "none" | "selection" | "local-topology";

export type TwoToOnePlanningStatus = "direct" | "compensated";

export type DirectTwoToOneFailureKind =
  | "selection-signature"
  | "parity"
  | "valence"
  | "topology";

export class DirectTwoToOnePlanningError extends Error {
  override readonly message: string;
  readonly kind: DirectTwoToOneFailureKind;
  readonly conflictingElementIds: number[];

  constructor(
    kind: DirectTwoToOneFailureKind,
    message: string,
    conflictingElementIds: readonly number[] = []
  ) {
    super(message);
    this.name = "DirectTwoToOnePlanningError";
    this.message = message;
    this.kind = kind;
    this.conflictingElementIds = [...conflictingElementIds];
  }
}

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
  /**
   * @deprecated Use `hexTwoToOneCompensation.mode`. False forces `"none"`;
   * true does not relax or override an explicit mode.
   */
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

export interface ReadonlyTwoToOneCompensationAction<
  TId extends TwoToOneEntityId = number
> {
  readonly kind: TwoToOneCompensationAction<TId>["kind"];
  readonly reason: string;
  readonly addedParentCellIds: readonly TId[];
  readonly replacedTransitionCellIds: readonly TId[];
  readonly templateId?: string;
}

export interface ReadonlyTwoToOneCapabilityReport<
  TId extends TwoToOneEntityId = number
> {
  readonly status: TwoToOnePlanningStatus;
  readonly topologyClass: TwoToOneTopologyClass;
  readonly originalSelectedCellIds: readonly TId[];
  readonly effectiveSelectedCellIds: readonly TId[];
  readonly actions: readonly ReadonlyTwoToOneCompensationAction<TId>[];
  readonly affectedComponentCellIds: readonly TId[];
  readonly preservedFarFieldCellCount: number;
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
  historyCommandIds?: string[];
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
    this.diagnostic = cloneTwoToOnePlanningDiagnostic(diagnostic);
  }

  toJSON(): TwoToOnePlanningErrorDto<TId> {
    return {
      name: "TwoToOnePlanningError",
      message: this.message,
      code: this.code,
      diagnostic: cloneTwoToOnePlanningDiagnostic(this.diagnostic)
    };
  }
}

export function serializeTwoToOnePlanningError<TId extends TwoToOneEntityId = number>(
  error: TwoToOnePlanningError<TId>
): TwoToOnePlanningErrorDto<TId> {
  return error.toJSON();
}

export function cloneTwoToOneCapabilityReport<TId extends TwoToOneEntityId>(
  report: ReadonlyTwoToOneCapabilityReport<TId>
): TwoToOneCapabilityReport<TId> {
  return {
    status: report.status,
    topologyClass: report.topologyClass,
    originalSelectedCellIds: [...report.originalSelectedCellIds],
    effectiveSelectedCellIds: [...report.effectiveSelectedCellIds],
    actions: report.actions.map((action) => ({
      kind: action.kind,
      reason: action.reason,
      addedParentCellIds: [...action.addedParentCellIds],
      replacedTransitionCellIds: [...action.replacedTransitionCellIds],
      ...(action.templateId === undefined ? {} : { templateId: action.templateId })
    })),
    affectedComponentCellIds: [...report.affectedComponentCellIds],
    preservedFarFieldCellCount: report.preservedFarFieldCellCount
  };
}

export function normalizeTwoToOneCompensation(
  originalSelectedParentCount: number,
  options: TwoToOneCompensationCarrier
): NormalizedTwoToOneCompensation {
  assertNonNegativeSafeInteger(originalSelectedParentCount, "originalSelectedParentCount");
  assertPlainObject(options, "options");

  let compensation: TwoToOneCompensationOptions | undefined;
  if (Object.hasOwn(options, "hexTwoToOneCompensation")) {
    const compensationValue: unknown = options.hexTwoToOneCompensation;
    assertPlainObject(compensationValue, "hexTwoToOneCompensation");
    compensation = compensationValue as TwoToOneCompensationOptions;
  }

  let mode: TwoToOneCompensationMode | undefined;
  if (compensation !== undefined && Object.hasOwn(compensation, "mode")) {
    const modeValue: unknown = compensation.mode;
    if (!isTwoToOneCompensationMode(modeValue)) {
      throw new TypeError("hexTwoToOneCompensation.mode must be none, selection, or local-topology");
    }
    mode = modeValue;
  }

  let rebuildExistingTransitions: boolean | undefined;
  if (Object.hasOwn(options, "rebuildExistingTransitions")) {
    const rebuildValue: unknown = options.rebuildExistingTransitions;
    if (typeof rebuildValue !== "boolean") {
      throw new TypeError("rebuildExistingTransitions must be a boolean");
    }
    rebuildExistingTransitions = rebuildValue;
  }

  let maxAddedParentLayers: unknown = 1;
  if (compensation !== undefined && Object.hasOwn(compensation, "maxAddedParentLayers")) {
    maxAddedParentLayers = compensation.maxAddedParentLayers;
  }
  let maxAddedParentCount: unknown =
    Math.max(32, Math.ceil(originalSelectedParentCount * 0.25));
  if (compensation !== undefined && Object.hasOwn(compensation, "maxAddedParentCount")) {
    maxAddedParentCount = compensation.maxAddedParentCount;
  }

  assertNonNegativeSafeInteger(maxAddedParentLayers, "maxAddedParentLayers");
  assertNonNegativeSafeInteger(maxAddedParentCount, "maxAddedParentCount");

  return {
    mode: rebuildExistingTransitions === false
      ? "none"
      : mode ?? "local-topology",
    maxAddedParentLayers,
    maxAddedParentCount
  };
}

function cloneTwoToOnePlanningDiagnostic<TId extends TwoToOneEntityId>(
  diagnostic: TwoToOnePlanningDiagnostic<TId>
): TwoToOnePlanningDiagnostic<TId> {
  const conflictingInterfaces = diagnostic.conflictingInterfaces.map((entry) => {
    const secondCellId = entry.secondCellId;
    return {
      firstCellId: entry.firstCellId,
      ...(secondCellId === undefined ? {} : { secondCellId }),
      faceNodeIds: [...entry.faceNodeIds]
    };
  });
  const attemptedActions = diagnostic.attemptedActions.map((action) => {
    const templateId = action.templateId;
    return {
      kind: action.kind,
      reason: action.reason,
      addedParentCellIds: [...action.addedParentCellIds],
      replacedTransitionCellIds: [...action.replacedTransitionCellIds],
      ...(templateId === undefined ? {} : { templateId })
    };
  });
  const suggestion = diagnostic.suggestion;
  const historyCommandIds = diagnostic.historyCommandIds;
  const clonedSuggestion = suggestion === undefined
    ? undefined
    : {
        kind: suggestion.kind,
        ...(suggestion.axis === undefined ? {} : { axis: suggestion.axis }),
        ...(suggestion.side === undefined ? {} : { side: suggestion.side }),
        ...(suggestion.parentCellIds === undefined
          ? {}
          : { parentCellIds: [...suggestion.parentCellIds] })
      };

  const cloned: TwoToOnePlanningDiagnostic<TId> = {
    conflictingCellIds: [...diagnostic.conflictingCellIds],
    conflictingInterfaces,
    attemptedActions,
    ...(clonedSuggestion === undefined ? {} : { suggestion: clonedSuggestion })
  };
  if (historyCommandIds !== undefined) {
    const clonedHistoryCommandIds = [...new Set(historyCommandIds)].sort();
    // Existing diagnostic freezing is shallow; freeze this nested snapshot
    // lazily once its owning diagnostic has been frozen.
    Object.defineProperty(cloned, "historyCommandIds", {
      configurable: true,
      enumerable: true,
      get(): string[] {
        if (
          Object.isFrozen(cloned)
          && !Object.isFrozen(clonedHistoryCommandIds)
        ) {
          Object.freeze(clonedHistoryCommandIds);
        }
        return clonedHistoryCommandIds;
      }
    });
  }
  return cloned;
}

function isTwoToOneCompensationMode(value: unknown): value is TwoToOneCompensationMode {
  return value === "none" || value === "selection" || value === "local-topology";
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
