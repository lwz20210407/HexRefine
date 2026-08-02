import type { Point } from "./types.js";
import type {
  CellId,
  RefinementSession,
  RefinementSessionCell,
  RefinementSessionCommand
} from "./refinement-session.js";
import type {
  MutableRefinementSessionCell,
  PreparedRefinementSessionActiveLeafBatchInternal,
  RefinementSessionStateWriter
} from "./refinement-session-state-internal.js";
import {
  assertRefinementSessionStateCellIdsEqualInternal,
  assertRefinementSessionStateOwnDataIdentityInternal,
  refinementSessionStateOrdinaryArrayLengthInternal,
  refinementSessionStateOrdinaryArrayValueInternal,
  refinementSessionStateCellFingerprintInternal,
  refinementSessionStateNodeFingerprintInternal,
  refinementSessionStateOwnDataValueInternal,
  registerRefinementSessionStateReferencePublisherInternal
} from "./refinement-session-state-internal.js";

const TRUSTED_ARRAY = Array;
const TRUSTED_MAP = Map;
const TRUSTED_NUMBER = Number;
const TRUSTED_OBJECT = Object;
const TRUSTED_REFLECT = Reflect;
const TRUSTED_SET = Set;
const TRUSTED_WEAK_MAP = WeakMap;
const TRUSTED_ARRAY_PROTOTYPE = TRUSTED_ARRAY.prototype;
const TRUSTED_ARRAY_IS_ARRAY = TRUSTED_ARRAY.isArray;
const TRUSTED_ARRAY_PUSH = TRUSTED_ARRAY_PROTOTYPE.push;
const TRUSTED_FUNCTION_CALL = Function.prototype.call;
const TRUSTED_REFLECT_APPLY = TRUSTED_REFLECT.apply;
const TRUSTED_REFLECT_DEFINE_PROPERTY = TRUSTED_REFLECT.defineProperty;
const TRUSTED_NUMBER_IS_SAFE_INTEGER = TRUSTED_NUMBER.isSafeInteger;
const TRUSTED_OBJECT_PROTOTYPE = TRUSTED_OBJECT.prototype;
const TRUSTED_OBJECT_FREEZE = TRUSTED_OBJECT.freeze;
const TRUSTED_OBJECT_GET_PROTOTYPE_OF = TRUSTED_OBJECT.getPrototypeOf;
const TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR =
  TRUSTED_OBJECT.getOwnPropertyDescriptor;
const TRUSTED_MAP_PROTOTYPE = TRUSTED_MAP.prototype;
const TRUSTED_MAP_SIZE_GETTER = TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
  TRUSTED_MAP_PROTOTYPE,
  "size"
)!.get!;
const TRUSTED_MAP_GET = TRUSTED_MAP_PROTOTYPE.get;
const TRUSTED_MAP_HAS = TRUSTED_MAP_PROTOTYPE.has;
const TRUSTED_MAP_SET = TRUSTED_MAP_PROTOTYPE.set;
const TRUSTED_MAP_DELETE = TRUSTED_MAP_PROTOTYPE.delete;
const TRUSTED_MAP_ENTRIES = TRUSTED_MAP_PROTOTYPE.entries;
const TRUSTED_SET_PROTOTYPE = TRUSTED_SET.prototype;
const TRUSTED_SET_SIZE_GETTER = TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
  TRUSTED_SET_PROTOTYPE,
  "size"
)!.get!;
const TRUSTED_SET_HAS = TRUSTED_SET_PROTOTYPE.has;
const TRUSTED_SET_ADD = TRUSTED_SET_PROTOTYPE.add;
const TRUSTED_SET_DELETE = TRUSTED_SET_PROTOTYPE.delete;
const TRUSTED_SET_VALUES = TRUSTED_SET_PROTOTYPE.values;
const TRUSTED_SET_ITERATOR_NEXT = TRUSTED_OBJECT_GET_PROTOTYPE_OF(
  TRUSTED_REFLECT_APPLY(TRUSTED_SET_VALUES, new TRUSTED_SET(), [])
).next as (this: SetIterator<unknown>) => IteratorResult<unknown>;
const TRUSTED_WEAK_MAP_PROTOTYPE = TRUSTED_WEAK_MAP.prototype;
const TRUSTED_WEAK_MAP_GET = TRUSTED_WEAK_MAP_PROTOTYPE.get;
const TRUSTED_WEAK_MAP_SET = TRUSTED_WEAK_MAP_PROTOTYPE.set;
const TRUSTED_WEAK_MAP_DELETE = TRUSTED_WEAK_MAP_PROTOTYPE.delete;

export interface RefinementSessionOverlayStats {
  readonly copiedBaseCellCount: number;
  readonly createdCellCount: number;
  readonly appendedNodeCount: number;
  readonly activeLeafAdditionCount: number;
  readonly activeLeafRemovalCount: number;
  readonly copiedNodeOwnerKeyCount: number;
  readonly referencedBaseCellCount: number;
  readonly referencedBaseNodeCount: number;
}

interface OverlayBaseline {
  readonly baseRevision: number;
  readonly baseNodes: RefinementSession["nodes"];
  readonly baseCells: RefinementSession["cells"];
  readonly baseActiveLeafIds: RefinementSession["activeLeafIds"];
  readonly baseActiveLeafIdsByNodeKey: RefinementSession["activeLeafIdsByNodeKey"];
  readonly baseSortedActiveLeafIds: RefinementSession["sortedActiveLeafIds"];
  readonly baseUndoStack: RefinementSession["undoStack"];
  readonly baseRedoStack: RefinementSession["redoStack"];
  readonly baseNodeCount: number;
  readonly baseCellCount: number;
  readonly baseActiveLeafCount: number;
  readonly baseOwnerKeyCount: number;
  readonly baseSortedActiveLeafCount: number;
  readonly baseUndoLength: number;
  readonly baseRedoLength: number;
  readonly baseSortedActiveLeafIdsDirty: boolean;
  readonly baseNextCommandId: number;
  readonly baseNextCellOrdinal: number | undefined;
}

interface OverlayStorage extends OverlayBaseline {
  readonly cellOverrides: Map<CellId, MutableRefinementSessionCell>;
  readonly createdCells: Map<CellId, MutableRefinementSessionCell>;
  readonly appendedNodes: Point[];
  readonly activeLeafAdditions: Set<CellId>;
  readonly activeLeafRemovals: Set<CellId>;
  readonly ownerOverridesByNodeKey: Map<string, CellId[]>;
  sortedActiveLeafIdsDirty: boolean;
  readonly appendedUndoCommands: RefinementSessionCommand[];
  clearRedo: boolean;
  nextCommandId: number;
  nextCellOrdinal: number;
  readonly referencedBaseCellIds: Set<CellId>;
  readonly referencedBaseNodeIds: Set<number>;
}

export interface RefinementSessionOverlayOptions {
  readonly nodeKey: (point: Point) => string;
  readonly cellNodeIds: (cell: RefinementSessionCell) => readonly number[];
}

export interface RefinementSessionOverlay extends RefinementSessionStateWriter {
  readonly storage: OverlayStorage;
  readonly options: RefinementSessionOverlayOptions;
}

declare const refinementSessionOverlayHistoryCheckpointBrand: unique symbol;

/** An opaque, immutable, single-use overlay history checkpoint. */
export interface RefinementSessionOverlayHistoryCheckpoint {
  readonly [refinementSessionOverlayHistoryCheckpointBrand]: true;
}

interface OverlayHistoryCheckpointOwner {
  readonly overlay: RefinementSessionOverlay;
  readonly storage: OverlayStorage;
  readonly baseSession: RefinementSession;
  readonly baselineValues: readonly unknown[];
  readonly appendedUndoCommands: RefinementSessionCommand[];
}

interface PreparedOverlayHistoryCheckpoint {
  readonly owner: OverlayHistoryCheckpointOwner;
  readonly commandPrefix: readonly RefinementSessionCommand[];
  readonly commandLength: number;
  readonly nextCommandId: number;
}

const overlayHistoryCheckpointOwners =
  new WeakMap<object, OverlayHistoryCheckpointOwner>();
const preparedOverlayHistoryCheckpoints =
  new WeakMap<object, PreparedOverlayHistoryCheckpoint>();
const OVERLAY_HISTORY_BASELINE_KEYS = TRUSTED_OBJECT_FREEZE([
  "baseRevision",
  "baseNodes",
  "baseCells",
  "baseActiveLeafIds",
  "baseActiveLeafIdsByNodeKey",
  "baseSortedActiveLeafIds",
  "baseUndoStack",
  "baseRedoStack",
  "baseNodeCount",
  "baseCellCount",
  "baseActiveLeafCount",
  "baseOwnerKeyCount",
  "baseSortedActiveLeafCount",
  "baseUndoLength",
  "baseRedoLength",
  "baseSortedActiveLeafIdsDirty",
  "baseNextCommandId",
  "baseNextCellOrdinal"
] as const);
const OVERLAY_HISTORY_DATA_INTRINSICS = [
  [TRUSTED_ARRAY, "prototype", TRUSTED_ARRAY_PROTOTYPE],
  [TRUSTED_ARRAY, "isArray", TRUSTED_ARRAY_IS_ARRAY],
  [TRUSTED_ARRAY_PROTOTYPE, "push", TRUSTED_ARRAY_PUSH],
  [TRUSTED_REFLECT, "apply", TRUSTED_REFLECT_APPLY],
  [TRUSTED_REFLECT, "defineProperty", TRUSTED_REFLECT_DEFINE_PROPERTY],
  [TRUSTED_NUMBER, "isSafeInteger", TRUSTED_NUMBER_IS_SAFE_INTEGER],
  [TRUSTED_OBJECT, "prototype", TRUSTED_OBJECT_PROTOTYPE],
  [TRUSTED_OBJECT, "freeze", TRUSTED_OBJECT_FREEZE],
  [TRUSTED_OBJECT, "getPrototypeOf", TRUSTED_OBJECT_GET_PROTOTYPE_OF],
  [TRUSTED_OBJECT, "getOwnPropertyDescriptor", TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR],
  [TRUSTED_MAP, "prototype", TRUSTED_MAP_PROTOTYPE],
  [TRUSTED_SET, "prototype", TRUSTED_SET_PROTOTYPE],
  [TRUSTED_WEAK_MAP, "prototype", TRUSTED_WEAK_MAP_PROTOTYPE],
  [TRUSTED_WEAK_MAP_PROTOTYPE, "get", TRUSTED_WEAK_MAP_GET],
  [TRUSTED_WEAK_MAP_PROTOTYPE, "set", TRUSTED_WEAK_MAP_SET],
  [TRUSTED_WEAK_MAP_PROTOTYPE, "delete", TRUSTED_WEAK_MAP_DELETE]
] as const;
const OVERLAY_HISTORY_GETTER_INTRINSICS = [
  [TRUSTED_MAP_PROTOTYPE, "size", TRUSTED_MAP_SIZE_GETTER],
  [TRUSTED_SET_PROTOTYPE, "size", TRUSTED_SET_SIZE_GETTER]
] as const;
const OVERLAY_HISTORY_LIVE_BASE_PROPERTIES = [
  ["revision", "baseRevision"],
  ["nodes", "baseNodes"],
  ["cells", "baseCells"],
  ["activeLeafIds", "baseActiveLeafIds"],
  ["activeLeafIdsByNodeKey", "baseActiveLeafIdsByNodeKey"],
  ["sortedActiveLeafIds", "baseSortedActiveLeafIds"],
  ["undoStack", "baseUndoStack"],
  ["redoStack", "baseRedoStack"],
  ["sortedActiveLeafIdsDirty", "baseSortedActiveLeafIdsDirty"],
  ["nextCommandId", "baseNextCommandId"],
  ["nextCellOrdinal", "baseNextCellOrdinal"]
] as const;
const OVERLAY_HISTORY_LIVE_BASE_COUNTS = [
  ["array", "nodes", "baseNodeCount"],
  ["map", "cells", "baseCellCount"],
  ["set", "activeLeafIds", "baseActiveLeafCount"],
  ["map", "activeLeafIdsByNodeKey", "baseOwnerKeyCount"],
  ["array", "sortedActiveLeafIds", "baseSortedActiveLeafCount"],
  ["array", "undoStack", "baseUndoLength"],
  ["array", "redoStack", "baseRedoLength"]
] as const;

interface OverlayDeltaCell {
  readonly id: CellId;
  readonly cell: RefinementSessionCell;
}

interface OverlayDeltaOwnerOverride {
  readonly key: string;
  readonly ownerIds: readonly CellId[];
}

interface BaseCellGuard {
  readonly id: CellId;
  /** This is a guard reference, not delta-owned data. */
  readonly cell: RefinementSessionCell;
  readonly fingerprint: string;
}

interface BaseNodeGuard {
  readonly nodeId: number;
  /** This is a guard reference, not delta-owned data. */
  readonly point: Point;
  readonly fingerprint: string;
}

interface BaseOwnerGuard {
  readonly key: string;
  /** This is a guard reference, not delta-owned data. */
  readonly ownerIds: readonly CellId[] | undefined;
  readonly fingerprint: string | undefined;
}

interface BaseActiveLeafGuard {
  readonly cellId: CellId;
  readonly active: boolean;
}

/** An immutable, sparse overlay result that may be committed exactly once. */
export interface RefinementSessionOverlayDelta {
  readonly baseSession: RefinementSession;
  readonly baseRevision: number;
  readonly baseNodes: RefinementSession["nodes"];
  readonly baseCells: RefinementSession["cells"];
  readonly baseActiveLeafIds: RefinementSession["activeLeafIds"];
  readonly baseActiveLeafIdsByNodeKey: RefinementSession["activeLeafIdsByNodeKey"];
  readonly baseSortedActiveLeafIds: RefinementSession["sortedActiveLeafIds"];
  readonly baseUndoStack: RefinementSession["undoStack"];
  readonly baseRedoStack: RefinementSession["redoStack"];
  readonly baseNodeCount: number;
  readonly baseCellCount: number;
  readonly baseActiveLeafCount: number;
  readonly baseOwnerKeyCount: number;
  readonly baseSortedActiveLeafCount: number;
  readonly baseUndoLength: number;
  readonly baseRedoLength: number;
  readonly baseSortedActiveLeafIdsDirty: boolean;
  readonly baseNextCommandId: number;
  readonly baseNextCellOrdinal: number | undefined;
  readonly cellOverrides: readonly OverlayDeltaCell[];
  readonly createdCells: readonly OverlayDeltaCell[];
  readonly appendedNodes: readonly Point[];
  readonly activeLeafAdditions: readonly CellId[];
  readonly activeLeafRemovals: readonly CellId[];
  readonly ownerOverrides: readonly OverlayDeltaOwnerOverride[];
  readonly appendedUndoCommands: readonly RefinementSessionCommand[];
  readonly clearRedo: boolean;
  readonly sortedActiveLeafIdsDirty: boolean;
  readonly nextCommandId: number;
  readonly nextCellOrdinal: number;
  readonly baseCellGuards: readonly BaseCellGuard[];
  readonly baseNodeGuards: readonly BaseNodeGuard[];
  readonly baseOwnerGuards: readonly BaseOwnerGuard[];
  readonly baseActiveLeafGuards: readonly BaseActiveLeafGuard[];
}

interface MutableSessionForOverlayCommit {
  revision: number;
  nodes: Point[];
  cells: Map<CellId, MutableRefinementSessionCell>;
  activeLeafIds: Set<CellId>;
  sortedActiveLeafIds: CellId[];
  sortedActiveLeafIdsDirty: boolean;
  activeLeafIdsByNodeKey: Map<string, CellId[]>;
  undoStack: RefinementSessionCommand[];
  redoStack: RefinementSessionCommand[];
  nextCommandId: number;
  nextCellOrdinal: number;
}

interface PreparedOverlayCommit {
  readonly session: MutableSessionForOverlayCommit;
  readonly nodes: Point[];
  readonly cells: Map<CellId, MutableRefinementSessionCell>;
  readonly activeLeafIds: Set<CellId>;
  readonly activeLeafIdsByNodeKey: Map<string, CellId[]>;
  readonly undoStack: RefinementSessionCommand[];
  readonly cellOverrides: readonly [CellId, MutableRefinementSessionCell][];
  readonly createdCells: readonly [CellId, MutableRefinementSessionCell][];
  readonly appendedNodes: readonly Point[];
  readonly activeLeafAdditions: readonly CellId[];
  readonly activeLeafRemovals: readonly CellId[];
  readonly ownerOverrides: readonly [string, CellId[]][];
  readonly appendedUndoCommands: readonly RefinementSessionCommand[];
  readonly replacementRedoStack: RefinementSessionCommand[] | undefined;
  readonly sortedActiveLeafIdsDirty: boolean;
  readonly nextCommandId: number;
  readonly nextCellOrdinal: number;
  readonly nextRevision: number;
}

interface PreparedOverlayActiveLeafBatch {
  readonly activeLeafAdditionAdds: readonly CellId[];
  readonly activeLeafAdditionDeletes: readonly CellId[];
  readonly activeLeafRemovalAdds: readonly CellId[];
  readonly activeLeafRemovalDeletes: readonly CellId[];
  readonly ownerOverrides:
    readonly [string, CellId[] | undefined][];
  readonly referencedBaseCellIds: readonly CellId[];
  readonly referencedBaseNodeIds: readonly number[];
  readonly sortedActiveLeafIdsDirty: boolean;
}

function cloneCell(
  cell: RefinementSessionCell
): MutableRefinementSessionCell {
  return {
    ...cell,
    element: [...cell.element],
    children: [...cell.children]
  };
}

function overlayBaseline(baseSession: RefinementSession): OverlayBaseline {
  return {
    baseRevision: baseSession.revision,
    baseNodes: baseSession.nodes,
    baseCells: baseSession.cells,
    baseActiveLeafIds: baseSession.activeLeafIds,
    baseActiveLeafIdsByNodeKey: baseSession.activeLeafIdsByNodeKey,
    baseSortedActiveLeafIds: baseSession.sortedActiveLeafIds,
    baseUndoStack: baseSession.undoStack,
    baseRedoStack: baseSession.redoStack,
    baseNodeCount: baseSession.nodes.length,
    baseCellCount: baseSession.cells.size,
    baseActiveLeafCount: baseSession.activeLeafIds.size,
    baseOwnerKeyCount: baseSession.activeLeafIdsByNodeKey.size,
    baseSortedActiveLeafCount: baseSession.sortedActiveLeafIds.length,
    baseUndoLength: baseSession.undoStack.length,
    baseRedoLength: baseSession.redoStack.length,
    baseSortedActiveLeafIdsDirty: baseSession.sortedActiveLeafIdsDirty,
    baseNextCommandId: baseSession.nextCommandId,
    baseNextCellOrdinal: baseSession.nextCellOrdinal
  };
}

function overlayHistoryCheckpointError(message: string): never {
  throw new TypeError(
    `invalid refinement session overlay history checkpoint: ${message}`
  );
}

function historyOwnPropertyDescriptor(
  value: object,
  key: string
): PropertyDescriptor | undefined {
  return TRUSTED_REFLECT_APPLY(
    TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR,
    TRUSTED_OBJECT,
    [value, key]
  ) as PropertyDescriptor | undefined;
}

function historyOwnDataPropertyDescriptor(
  value: object,
  key: string
): (PropertyDescriptor & { readonly value: unknown }) | undefined {
  const descriptor = historyOwnPropertyDescriptor(value, key);
  if (descriptor === undefined
    || historyOwnPropertyDescriptor(descriptor, "value") === undefined) {
    return undefined;
  }
  return descriptor as PropertyDescriptor & { readonly value: unknown };
}

function historyOwnDataPropertyMatches(
  value: object,
  key: string,
  expected: unknown
): boolean {
  const descriptor = historyOwnDataPropertyDescriptor(value, key);
  return descriptor !== undefined && descriptor.value === expected;
}

function historyOwnGetterMatches(
  value: object,
  key: string,
  expected: unknown
): boolean {
  const descriptor = historyOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return false;
  const getter = historyOwnDataPropertyDescriptor(descriptor, "get");
  return getter !== undefined && getter.value === expected;
}

function assertTrustedOverlayHistoryCheckpointIntrinsics(): void {
  for (let index = 0; index < OVERLAY_HISTORY_DATA_INTRINSICS.length; index += 1) {
    const intrinsic = OVERLAY_HISTORY_DATA_INTRINSICS[index]!;
    if (!historyOwnDataPropertyMatches(intrinsic[0], intrinsic[1], intrinsic[2])) {
      overlayHistoryCheckpointError(
        "prototype intrinsics changed since module initialization"
      );
    }
  }
  for (let index = 0; index < OVERLAY_HISTORY_GETTER_INTRINSICS.length; index += 1) {
    const intrinsic = OVERLAY_HISTORY_GETTER_INTRINSICS[index]!;
    if (!historyOwnGetterMatches(intrinsic[0], intrinsic[1], intrinsic[2])) {
      overlayHistoryCheckpointError(
        "prototype intrinsics changed since module initialization"
      );
    }
  }
}

function historyOwnDataProperty<T>(
  value: object,
  key: string,
  label: string
): T {
  const descriptor = historyOwnDataPropertyDescriptor(value, key);
  if (descriptor === undefined) {
    overlayHistoryCheckpointError(`${label}.${key} must be an own data property`);
  }
  return descriptor.value as T;
}

function assertOverlayHistoryBaseline(
  owner: OverlayHistoryCheckpointOwner
): void {
  for (let index = 0; index < OVERLAY_HISTORY_BASELINE_KEYS.length; index += 1) {
    const key = OVERLAY_HISTORY_BASELINE_KEYS[index]!;
    if (historyOwnDataProperty(owner.storage, key, "overlay storage")
      !== owner.baselineValues[index]) {
      overlayHistoryCheckpointError("overlay baseline changed after creation");
    }
  }
}

function overlayHistoryArrayLength(value: unknown, label: string): number {
  if (!TRUSTED_ARRAY_IS_ARRAY(value)
    || TRUSTED_OBJECT_GET_PROTOTYPE_OF(value) !== TRUSTED_ARRAY_PROTOTYPE) {
    overlayHistoryCheckpointError(`${label} must be an ordinary Array`);
  }
  const descriptor = historyOwnDataPropertyDescriptor(value, "length");
  if (descriptor === undefined
    || typeof descriptor.value !== "number"
    || !TRUSTED_NUMBER_IS_SAFE_INTEGER(descriptor.value)
    || descriptor.value < 0) {
    overlayHistoryCheckpointError(`${label}.length must be a safe integer`);
  }
  return descriptor.value;
}

function overlayHistoryMapSize(value: unknown, label: string): number {
  if (value === null
    || typeof value !== "object"
    || TRUSTED_OBJECT_GET_PROTOTYPE_OF(value) !== TRUSTED_MAP_PROTOTYPE) {
    overlayHistoryCheckpointError(`${label} must be an ordinary Map`);
  }
  return TRUSTED_REFLECT_APPLY(TRUSTED_MAP_SIZE_GETTER, value, []) as number;
}

function overlayHistorySetSize(value: unknown, label: string): number {
  if (value === null
    || typeof value !== "object"
    || TRUSTED_OBJECT_GET_PROTOTYPE_OF(value) !== TRUSTED_SET_PROTOTYPE) {
    overlayHistoryCheckpointError(`${label} must be an ordinary Set`);
  }
  return TRUSTED_REFLECT_APPLY(TRUSTED_SET_SIZE_GETTER, value, []) as number;
}

function assertOverlayHistoryLiveBase(
  owner: OverlayHistoryCheckpointOwner
): void {
  const session = owner.baseSession;
  if (TRUSTED_OBJECT_GET_PROTOTYPE_OF(session) !== TRUSTED_OBJECT_PROTOTYPE) {
    overlayHistoryCheckpointError("live base session prototype changed");
  }
  const storage = owner.storage;
  for (let index = 0; index < OVERLAY_HISTORY_LIVE_BASE_PROPERTIES.length; index += 1) {
    const property = OVERLAY_HISTORY_LIVE_BASE_PROPERTIES[index]!;
    if (historyOwnDataProperty(session, property[0], "base session")
      !== historyOwnDataProperty(storage, property[1], "overlay storage")) {
      overlayHistoryCheckpointError("live base session changed after overlay creation");
    }
  }
  for (let index = 0; index < OVERLAY_HISTORY_LIVE_BASE_COUNTS.length; index += 1) {
    const count = OVERLAY_HISTORY_LIVE_BASE_COUNTS[index]!;
    const value = historyOwnDataProperty<unknown>(session, count[1], "base session");
    const label = `base session.${count[1]}`;
    const actual = count[0] === "array"
      ? overlayHistoryArrayLength(value, label)
      : count[0] === "map"
        ? overlayHistoryMapSize(value, label)
        : overlayHistorySetSize(value, label);
    if (actual !== historyOwnDataProperty(storage, count[2], "overlay storage")) {
      overlayHistoryCheckpointError("live base session changed after overlay creation");
    }
  }
}

function requireOverlayHistoryCheckpointOwner(
  overlay: RefinementSessionOverlay
): OverlayHistoryCheckpointOwner {
  const owner = TRUSTED_REFLECT_APPLY(
    TRUSTED_WEAK_MAP_GET,
    overlayHistoryCheckpointOwners,
    [overlay]
  ) as OverlayHistoryCheckpointOwner | undefined;
  if (owner === undefined || owner.overlay !== overlay) {
    overlayHistoryCheckpointError("overlay is not registered by this module");
  }
  if (TRUSTED_OBJECT_GET_PROTOTYPE_OF(overlay) !== TRUSTED_OBJECT_PROTOTYPE
    || TRUSTED_OBJECT_GET_PROTOTYPE_OF(owner.storage) !== TRUSTED_OBJECT_PROTOTYPE
    || historyOwnDataProperty(overlay, "storage", "overlay") !== owner.storage
    || historyOwnDataProperty(overlay, "baseSession", "overlay") !== owner.baseSession) {
    overlayHistoryCheckpointError("overlay or storage identity changed");
  }
  assertOverlayHistoryBaseline(owner);
  assertOverlayHistoryLiveBase(owner);
  const commands = historyOwnDataProperty<unknown>(
    owner.storage,
    "appendedUndoCommands",
    "overlay storage"
  );
  if (commands !== owner.appendedUndoCommands) {
    overlayHistoryCheckpointError("overlay command storage identity changed");
  }
  return owner;
}

function readOverlayHistoryState(owner: OverlayHistoryCheckpointOwner): {
  readonly commands: RefinementSessionCommand[];
  readonly length: number;
  readonly nextCommandId: number;
} {
  const commands = owner.appendedUndoCommands;
  if (!TRUSTED_ARRAY_IS_ARRAY(commands)
    || TRUSTED_OBJECT_GET_PROTOTYPE_OF(commands) !== TRUSTED_ARRAY_PROTOTYPE) {
    overlayHistoryCheckpointError(
      "overlay storage.appendedUndoCommands must be an ordinary Array"
    );
  }
  const lengthDescriptor = historyOwnDataPropertyDescriptor(
    commands,
    "length"
  );
  if (lengthDescriptor === undefined
    || !lengthDescriptor.writable
    || typeof lengthDescriptor.value !== "number"
    || !TRUSTED_NUMBER_IS_SAFE_INTEGER(lengthDescriptor.value)
    || lengthDescriptor.value < 0) {
    overlayHistoryCheckpointError(
      "overlay storage.appendedUndoCommands.length must be writable"
    );
  }
  const nextCommandIdDescriptor = historyOwnDataPropertyDescriptor(
    owner.storage,
    "nextCommandId"
  );
  if (nextCommandIdDescriptor === undefined
    || !nextCommandIdDescriptor.writable
    || typeof nextCommandIdDescriptor.value !== "number"
    || !TRUSTED_NUMBER_IS_SAFE_INTEGER(nextCommandIdDescriptor.value)
    || nextCommandIdDescriptor.value < 0) {
    overlayHistoryCheckpointError(
      "overlay storage.nextCommandId must be a writable non-negative safe integer"
    );
  }
  return {
    commands,
    length: lengthDescriptor.value,
    nextCommandId: nextCommandIdDescriptor.value
  };
}

function registerOverlayHistoryCheckpointOwner(
  overlay: RefinementSessionOverlay,
  storage: OverlayStorage,
  baseSession: RefinementSession,
  baseline: OverlayBaseline
): void {
  const baselineValues: unknown[] = [];
  for (let index = 0; index < OVERLAY_HISTORY_BASELINE_KEYS.length; index += 1) {
    const key = OVERLAY_HISTORY_BASELINE_KEYS[index]!;
    TRUSTED_REFLECT_APPLY(
      TRUSTED_ARRAY_PUSH,
      baselineValues,
      [historyOwnDataProperty(baseline, key, "overlay baseline")]
    );
  }
  const owner: OverlayHistoryCheckpointOwner = {
    overlay,
    storage,
    baseSession,
    baselineValues: TRUSTED_OBJECT_FREEZE(baselineValues),
    appendedUndoCommands: storage.appendedUndoCommands
  };
  TRUSTED_REFLECT_APPLY(
    TRUSTED_WEAK_MAP_SET,
    overlayHistoryCheckpointOwners,
    [overlay, owner]
  );
}

export function checkpointRefinementSessionOverlayHistory(
  overlay: RefinementSessionOverlay
): RefinementSessionOverlayHistoryCheckpoint {
  assertTrustedOverlayHistoryCheckpointIntrinsics();
  const owner = requireOverlayHistoryCheckpointOwner(overlay);
  const state = readOverlayHistoryState(owner);
  const commandPrefix: RefinementSessionCommand[] = [];
  for (let index = 0; index < state.length; index += 1) {
    const descriptor = historyOwnDataPropertyDescriptor(
      state.commands,
      String(index)
    );
    if (descriptor === undefined
      || !descriptor.enumerable) {
      overlayHistoryCheckpointError(
        `overlay command history has an unsafe entry at index ${index}`
      );
    }
    TRUSTED_REFLECT_APPLY(
      TRUSTED_ARRAY_PUSH,
      commandPrefix,
      [descriptor.value]
    );
  }
  const token = TRUSTED_OBJECT_FREEZE({}) as
    RefinementSessionOverlayHistoryCheckpoint;
  const prepared: PreparedOverlayHistoryCheckpoint = {
    owner,
    commandPrefix: TRUSTED_OBJECT_FREEZE(commandPrefix),
    commandLength: state.length,
    nextCommandId: state.nextCommandId
  };
  TRUSTED_REFLECT_APPLY(
    TRUSTED_WEAK_MAP_SET,
    preparedOverlayHistoryCheckpoints,
    [token, prepared]
  );
  return token;
}

export function restoreRefinementSessionOverlayHistory(
  overlay: RefinementSessionOverlay,
  checkpoint: RefinementSessionOverlayHistoryCheckpoint
): void {
  assertTrustedOverlayHistoryCheckpointIntrinsics();
  const prepared = TRUSTED_REFLECT_APPLY(
    TRUSTED_WEAK_MAP_GET,
    preparedOverlayHistoryCheckpoints,
    [checkpoint]
  ) as PreparedOverlayHistoryCheckpoint | undefined;
  if (prepared === undefined) {
    overlayHistoryCheckpointError("token is forged, invalid, or already consumed");
  }
  const owner = requireOverlayHistoryCheckpointOwner(overlay);
  if (prepared.owner !== owner) {
    overlayHistoryCheckpointError("token belongs to a different overlay");
  }
  const state = readOverlayHistoryState(owner);
  if (state.length < prepared.commandLength) {
    overlayHistoryCheckpointError("overlay command history is shorter than its checkpoint");
  }
  for (let index = 0; index < prepared.commandLength; index += 1) {
    const descriptor = historyOwnDataPropertyDescriptor(
      state.commands,
      String(index)
    );
    if (descriptor === undefined
      || descriptor.value !== prepared.commandPrefix[index]) {
      overlayHistoryCheckpointError(
        `overlay command history prefix changed at index ${index}`
      );
    }
  }
  for (let index = prepared.commandLength; index < state.length; index += 1) {
    const descriptor = historyOwnDataPropertyDescriptor(
      state.commands,
      String(index)
    );
    if (descriptor === undefined
      || !descriptor.enumerable
      || !descriptor.configurable) {
      overlayHistoryCheckpointError(
        `overlay command history cannot be safely truncated at index ${index}`
      );
    }
  }

  TRUSTED_REFLECT_APPLY(
    TRUSTED_WEAK_MAP_DELETE,
    preparedOverlayHistoryCheckpoints,
    [checkpoint]
  );
  TRUSTED_REFLECT_DEFINE_PROPERTY(state.commands, "length", {
    value: prepared.commandLength
  });
  TRUSTED_REFLECT_DEFINE_PROPERTY(owner.storage, "nextCommandId", {
    value: prepared.nextCommandId
  });
}

function assertOverlayBaseline(
  baseSession: RefinementSession,
  storage: OverlayStorage,
  base: MutableSessionForOverlayCommit
): void {
  if (storage.baseRevision !== base.revision
    || storage.baseNodes !== baseSession.nodes
    || storage.baseCells !== baseSession.cells
    || storage.baseActiveLeafIds !== baseSession.activeLeafIds
    || storage.baseActiveLeafIdsByNodeKey !== baseSession.activeLeafIdsByNodeKey
    || storage.baseSortedActiveLeafIds !== baseSession.sortedActiveLeafIds
    || storage.baseUndoStack !== baseSession.undoStack
    || storage.baseRedoStack !== baseSession.redoStack
    || storage.baseNodeCount !== base.nodes.length
    || storage.baseCellCount !== mapSize(base.cells as Map<unknown, unknown>)
    || storage.baseActiveLeafCount !== setSize(base.activeLeafIds as Set<unknown>)
    || storage.baseOwnerKeyCount !== mapSize(base.activeLeafIdsByNodeKey as Map<unknown, unknown>)
    || storage.baseSortedActiveLeafCount !== base.sortedActiveLeafIds.length
    || storage.baseUndoLength !== base.undoStack.length
    || storage.baseRedoLength !== base.redoStack.length
    || storage.baseSortedActiveLeafIdsDirty !== base.sortedActiveLeafIdsDirty
    || storage.baseNextCommandId !== base.nextCommandId
    || storage.baseNextCellOrdinal !== base.nextCellOrdinal) {
    overlayDeltaError("overlay creation baseline changed before snapshot");
  }
}

type PlainPrimitive = string | number | boolean | null | undefined;

function overlayDeltaError(message: string): never {
  throw new Error(`invalid refinement session overlay delta: ${message}`);
}

function compareCodeUnits(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function ownDataProperty<T>(
  value: object,
  key: string,
  label: string
): T {
  const descriptor = TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    overlayDeltaError(`${label}.${key} must be an own data property`);
  }
  return descriptor.value as T;
}

function assertWritableDataProperty(value: object, key: string, label: string): void {
  const descriptor = TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
  if (descriptor === undefined || !("value" in descriptor) || !descriptor.writable) {
    overlayDeltaError(`${label}.${key} must be a writable own data property`);
  }
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || TRUSTED_OBJECT_GET_PROTOTYPE_OF(value) !== Object.prototype) {
    overlayDeltaError(`${label} must use the ordinary Object prototype`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    overlayDeltaError(`${label} must not contain symbol properties`);
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      overlayDeltaError(`${label}.${key} must be an enumerable data property`);
    }
  }
  return value as Record<string, unknown>;
}

function assertOrdinaryArray(
  value: unknown,
  label: string,
  verifyElements = true
): readonly unknown[] {
  if (!Array.isArray(value) || TRUSTED_OBJECT_GET_PROTOTYPE_OF(value) !== Array.prototype) {
    overlayDeltaError(`${label} must use the ordinary Array prototype`);
  }
  if (!verifyElements) return value;
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    overlayDeltaError(`${label} must not contain symbol properties`);
  }
  const length = value.length;
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== length + 1 || !names.includes("length")) {
    overlayDeltaError(`${label} must not contain holes or extra properties`);
  }
  for (let index = 0; index < length; index += 1) {
    const descriptor = TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      overlayDeltaError(`${label}[${index}] must be an enumerable data property`);
    }
  }
  return value;
}

function assertOrdinaryMap(value: unknown, label: string): Map<unknown, unknown> {
  if (value === null || typeof value !== "object" || TRUSTED_OBJECT_GET_PROTOTYPE_OF(value) !== Map.prototype) {
    overlayDeltaError(`${label} must use the ordinary Map prototype`);
  }
  return value as Map<unknown, unknown>;
}

function assertOrdinarySet(value: unknown, label: string): Set<unknown> {
  if (value === null || typeof value !== "object" || TRUSTED_OBJECT_GET_PROTOTYPE_OF(value) !== TRUSTED_SET_PROTOTYPE) {
    overlayDeltaError(`${label} must use the ordinary Set prototype`);
  }
  return value as Set<unknown>;
}

function mapSize(map: Map<unknown, unknown>): number {
  return TRUSTED_REFLECT_APPLY(TRUSTED_MAP_SIZE_GETTER, map, []) as number;
}

function setSize(set: Set<unknown>): number {
  return TRUSTED_REFLECT_APPLY(TRUSTED_SET_SIZE_GETTER, set, []) as number;
}

function mapGet(map: Map<unknown, unknown>, key: unknown): unknown {
  return TRUSTED_REFLECT_APPLY(TRUSTED_MAP_GET, map, [key]);
}

function mapHas(map: Map<unknown, unknown>, key: unknown): boolean {
  return TRUSTED_REFLECT_APPLY(TRUSTED_MAP_HAS, map, [key]) as boolean;
}

function setHas(set: Set<unknown>, value: unknown): boolean {
  return TRUSTED_REFLECT_APPLY(TRUSTED_SET_HAS, set, [value]) as boolean;
}

function setValues<T>(set: Set<T>): T[] {
  const values: T[] = [];
  const iterator = TRUSTED_REFLECT_APPLY(
    TRUSTED_SET_VALUES,
    set,
    []
  ) as SetIterator<T>;
  while (true) {
    const step = TRUSTED_REFLECT_APPLY(
      TRUSTED_SET_ITERATOR_NEXT,
      iterator,
      []
    ) as IteratorResult<T>;
    if (step.done) return values;
    TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, values, [step.value]);
  }
}

function isPlainPrimitive(value: unknown): value is PlainPrimitive {
  return value === null
    || value === undefined
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean";
}

function primitiveToken(value: PlainPrimitive): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `string:${value.length}:${value}`;
  if (typeof value === "boolean") return value ? "boolean:1" : "boolean:0";
  if (Number.isNaN(value)) return "number:NaN";
  if (Object.is(value, -0)) return "number:-0";
  return `number:${value}`;
}

function primitiveArrayFingerprint(value: unknown, label: string): string {
  const array = assertOrdinaryArray(value, label);
  const tokens: string[] = [];
  for (let index = 0; index < array.length; index += 1) {
    const item = ownDataProperty<unknown>(array as object, String(index), label);
    if (!isPlainPrimitive(item)) {
      overlayDeltaError(`${label}[${index}] must be primitive`);
    }
    tokens.push(primitiveToken(item));
  }
  return `[${tokens.join(",")}]`;
}

function primitiveObjectFingerprint(value: unknown, label: string): string {
  const object = assertPlainObject(value, label);
  const tokens: string[] = [];
  for (const key of Object.getOwnPropertyNames(object).sort(compareCodeUnits)) {
    const property = ownDataProperty<unknown>(object, key, label);
    const token = Array.isArray(property)
      ? primitiveArrayFingerprint(property, `${label}.${key}`)
      : isPlainPrimitive(property)
        ? primitiveToken(property)
        : overlayDeltaError(`${label}.${key} must be primitive or a primitive array`);
    tokens.push(`${key.length}:${key}=${token}`);
  }
  return `{${tokens.join(";")}}`;
}

function nodeFingerprint(point: unknown, label: string): string {
  const array = assertOrdinaryArray(point, label);
  const tokens: string[] = [];
  for (let index = 0; index < array.length; index += 1) {
    const coordinate = ownDataProperty<unknown>(array as object, String(index), label);
    if (typeof coordinate !== "number") {
      overlayDeltaError(`${label}[${index}] must be a number`);
    }
    tokens.push(primitiveToken(coordinate));
  }
  return `[${tokens.join(",")}]`;
}

function clonePlainValue(value: unknown, label: string): unknown {
  if (isPlainPrimitive(value)) return value;
  if (Array.isArray(value)) {
    const array = assertOrdinaryArray(value, label);
    const result: unknown[] = [];
    for (let index = 0; index < array.length; index += 1) {
      result.push(clonePlainValue(
        ownDataProperty<unknown>(array as object, String(index), label),
        `${label}[${index}]`
      ));
    }
    return result;
  }
  const object = assertPlainObject(value, label);
  const result: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(object)) {
    Object.defineProperty(result, key, {
      value: clonePlainValue(ownDataProperty<unknown>(object, key, label), `${label}.${key}`),
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return result;
}

function freezePlainValue<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      for (const item of value) freezePlainValue(item);
    } else {
      for (const key of Object.getOwnPropertyNames(value)) {
        freezePlainValue(ownDataProperty<unknown>(value, key, "owned snapshot"));
      }
    }
    Object.freeze(value);
  }
  return value;
}

function frozenClone<T>(value: T, label: string): T {
  return freezePlainValue(clonePlainValue(value, label) as T);
}

function frozenArray<T>(values: T[]): readonly T[] {
  return Object.freeze(values);
}

function assertCellShape(cell: unknown, label: string): RefinementSessionCell {
  const object = assertPlainObject(cell, label);
  const id = ownDataProperty<unknown>(object, "id", label);
  if (typeof id !== "string" || id.length === 0) {
    overlayDeltaError(`${label}.id must be a non-empty string`);
  }
  const ordinal = ownDataProperty<unknown>(object, "ordinal", label);
  if (typeof ordinal !== "number" || !Number.isSafeInteger(ordinal) || ordinal < 1) {
    overlayDeltaError(`${label}.ordinal must be a positive safe integer`);
  }
  const element = ownDataProperty<unknown>(object, "element", label);
  const children = ownDataProperty<unknown>(object, "children", label);
  primitiveArrayFingerprint(element, `${label}.element`);
  primitiveArrayFingerprint(children, `${label}.children`);
  return cell as RefinementSessionCell;
}

function cellNodeIds(cell: RefinementSessionCell, maximumNodeId: number, label: string): number[] {
  const element = assertOrdinaryArray(ownDataProperty<unknown>(cell as object, "element", label), `${label}.element`);
  const result: number[] = [];
  for (let index = 0; index < element.length; index += 1) {
    const nodeId = ownDataProperty<unknown>(element as object, String(index), `${label}.element`);
    if (typeof nodeId !== "number" || !Number.isSafeInteger(nodeId) || nodeId < 1 || nodeId > maximumNodeId) {
      overlayDeltaError(`${label}.element[${index}] references invalid node ${String(nodeId)}`);
    }
    result.push(nodeId);
  }
  return result;
}

function cloneMutableCell(cell: RefinementSessionCell, label: string): MutableRefinementSessionCell {
  // Commit copies every validated delta-owned field, unlike the sparse COW clone above.
  return clonePlainValue(cell, label) as MutableRefinementSessionCell;
}

function clonePoint(point: Point, label: string): Point {
  nodeFingerprint(point, label);
  return clonePlainValue(point, label) as Point;
}

function cloneCommand(command: RefinementSessionCommand, label: string): RefinementSessionCommand {
  assertPlainObject(command, label);
  return frozenClone(command, label) as RefinementSessionCommand;
}

function assertCounter(value: unknown, label: string, allowUndefined = false): asserts value is number | undefined {
  if (allowUndefined && value === undefined) return;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    overlayDeltaError(`${label} must be a non-negative safe integer`);
  }
}

function readSessionForOverlay(
  session: RefinementSession,
  label: string,
  requireWritable: boolean
): MutableSessionForOverlayCommit {
  const object = assertPlainObject(session, label);
  const nodes = ownDataProperty<unknown>(object, "nodes", label);
  const cells = ownDataProperty<unknown>(object, "cells", label);
  const activeLeafIds = ownDataProperty<unknown>(object, "activeLeafIds", label);
  const sortedActiveLeafIds = ownDataProperty<unknown>(object, "sortedActiveLeafIds", label);
  const activeLeafIdsByNodeKey = ownDataProperty<unknown>(object, "activeLeafIdsByNodeKey", label);
  const undoStack = ownDataProperty<unknown>(object, "undoStack", label);
  const redoStack = ownDataProperty<unknown>(object, "redoStack", label);
  const revision = ownDataProperty<unknown>(object, "revision", label);
  const sortedActiveLeafIdsDirty = ownDataProperty<unknown>(object, "sortedActiveLeafIdsDirty", label);
  const nextCommandId = ownDataProperty<unknown>(object, "nextCommandId", label);
  const nextCellOrdinal = ownDataProperty<unknown>(object, "nextCellOrdinal", label);
  assertOrdinaryArray(nodes, `${label}.nodes`, false);
  assertOrdinaryMap(cells, `${label}.cells`);
  assertOrdinarySet(activeLeafIds, `${label}.activeLeafIds`);
  assertOrdinaryArray(sortedActiveLeafIds, `${label}.sortedActiveLeafIds`, false);
  assertOrdinaryMap(activeLeafIdsByNodeKey, `${label}.activeLeafIdsByNodeKey`);
  assertOrdinaryArray(undoStack, `${label}.undoStack`, false);
  assertOrdinaryArray(redoStack, `${label}.redoStack`, false);
  assertCounter(revision, `${label}.revision`);
  if (typeof sortedActiveLeafIdsDirty !== "boolean") {
    overlayDeltaError(`${label}.sortedActiveLeafIdsDirty must be boolean`);
  }
  assertCounter(nextCommandId, `${label}.nextCommandId`);
  assertCounter(nextCellOrdinal, `${label}.nextCellOrdinal`, true);
  if (requireWritable) {
    for (const key of [
      "revision",
      "sortedActiveLeafIdsDirty",
      "nextCommandId",
      "nextCellOrdinal",
      "redoStack"
    ]) {
      assertWritableDataProperty(object, key, label);
    }
    for (const [collection, collectionLabel] of [
      [nodes, `${label}.nodes`],
      [undoStack, `${label}.undoStack`]
    ] as const) {
      if (!Object.isExtensible(collection)) {
        overlayDeltaError(`${collectionLabel} must be extensible`);
      }
      const length = TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(collection, "length");
      if (length === undefined || !("value" in length) || !length.writable) {
        overlayDeltaError(`${collectionLabel}.length must be writable`);
      }
    }
    for (const [collection, collectionLabel] of [
      [cells, `${label}.cells`],
      [activeLeafIds, `${label}.activeLeafIds`],
      [activeLeafIdsByNodeKey, `${label}.activeLeafIdsByNodeKey`]
    ] as const) {
      if (!Object.isExtensible(collection)) {
        overlayDeltaError(`${collectionLabel} must be extensible`);
      }
    }
  }
  return session as unknown as MutableSessionForOverlayCommit;
}

function assertTrustedCommitIntrinsics(): void {
  if (Function.prototype.call !== TRUSTED_FUNCTION_CALL
    || Reflect.apply !== TRUSTED_REFLECT_APPLY
    || Object.getPrototypeOf !== TRUSTED_OBJECT_GET_PROTOTYPE_OF
    || Object.getOwnPropertyDescriptor !== TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR
    || Array.prototype.push !== TRUSTED_ARRAY_PUSH
    || Map.prototype.get !== TRUSTED_MAP_GET
    || Map.prototype.has !== TRUSTED_MAP_HAS
    || Map.prototype.set !== TRUSTED_MAP_SET
    || Map.prototype.delete !== TRUSTED_MAP_DELETE
    || Set.prototype.has !== TRUSTED_SET_HAS
    || Set.prototype.add !== TRUSTED_SET_ADD
    || Set.prototype.delete !== TRUSTED_SET_DELETE) {
    overlayDeltaError("collection prototype intrinsics changed since module initialization");
  }
}

function assertAppendTarget(array: readonly unknown[], appendCount: number, label: string): void {
  if (!Object.isExtensible(array)) {
    overlayDeltaError(`${label} must be extensible`);
  }
  const length = TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(array, "length");
  if (length === undefined || !("value" in length) || !length.writable) {
    overlayDeltaError(`${label}.length must be writable`);
  }
  const initialLength = array.length;
  for (let offset = 0; offset < appendCount; offset += 1) {
    const key = String(initialLength + offset);
    if (TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(array, key) !== undefined) {
      overlayDeltaError(`${label}[${key}] already exists`);
    }
    let prototype = TRUSTED_OBJECT_GET_PROTOTYPE_OF(array) as object | null;
    while (prototype !== null) {
      if (TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(prototype, key) !== undefined) {
        overlayDeltaError(`${label}[${key}] has an unsafe inherited descriptor`);
      }
      prototype = TRUSTED_OBJECT_GET_PROTOTYPE_OF(prototype) as object | null;
    }
  }
}

function sortedMapEntries(map: Map<unknown, unknown>, label: string): [string, unknown][] {
  const entries: [string, unknown][] = [];
  for (const entry of TRUSTED_REFLECT_APPLY(TRUSTED_MAP_ENTRIES, map, []) as Iterable<[unknown, unknown]>) {
    const [key, value] = entry;
    if (typeof key !== "string") {
      overlayDeltaError(`${label} keys must be strings`);
    }
    entries.push([key, value]);
  }
  entries.sort(([left], [right]) => compareCodeUnits(left, right));
  return entries;
}

function sortedCellIds(set: Set<unknown>, label: string): CellId[] {
  const values: CellId[] = [];
  for (const value of TRUSTED_REFLECT_APPLY(TRUSTED_SET_VALUES, set, []) as Iterable<unknown>) {
    if (typeof value !== "string" || value.length === 0) {
      overlayDeltaError(`${label} must contain non-empty string cell ids`);
    }
    values.push(value);
  }
  values.sort(compareCodeUnits);
  return values;
}

function cloneCellIds(value: unknown, label: string): CellId[] {
  const array = assertOrdinaryArray(value, label);
  const result: CellId[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < array.length; index += 1) {
    const cellId = ownDataProperty<unknown>(array as object, String(index), label);
    if (typeof cellId !== "string" || cellId.length === 0 || seen.has(cellId)) {
      overlayDeltaError(`${label} must contain unique non-empty string cell ids`);
    }
    seen.add(cellId);
    result.push(cellId);
  }
  return result;
}

function ownerFingerprint(ownerIds: unknown, label: string): string {
  return primitiveArrayFingerprint(ownerIds, label);
}

function snapshotCellEntries(
  entries: readonly [string, unknown][],
  label: string,
  baseCells: Map<unknown, unknown>,
  requireBaseCell: boolean,
  baseNodeCount: number,
  maximumNodeId: number,
  referencedBaseNodeIds: Set<number>
): readonly OverlayDeltaCell[] {
  const result: OverlayDeltaCell[] = [];
  const seen = new Set<string>();
  for (const [cellId, value] of entries) {
    if (cellId.length === 0 || seen.has(cellId)) {
      overlayDeltaError(`${label} contains duplicate or empty cell ids`);
    }
    seen.add(cellId);
    const cell = assertCellShape(value, `${label}.${cellId}`);
    if (ownDataProperty<unknown>(cell as object, "id", `${label}.${cellId}`) !== cellId) {
      overlayDeltaError(`${label}.${cellId}.id must match its map key`);
    }
    if (mapHas(baseCells, cellId) !== requireBaseCell) {
      overlayDeltaError(requireBaseCell
        ? `${label}.${cellId} must override a base cell`
        : `${label}.${cellId} must not replace a base cell`);
    }
    for (const nodeId of cellNodeIds(cell, maximumNodeId, `${label}.${cellId}`)) {
      if (nodeId <= baseNodeCount) referencedBaseNodeIds.add(nodeId);
    }
    result.push(Object.freeze({ id: cellId, cell: frozenClone(cell, `${label}.${cellId}`) }));
  }
  return frozenArray(result);
}

/** Capture an immutable sparse delta without cloning the far field of the base session. */
export function snapshotRefinementSessionOverlayDelta(
  overlay: RefinementSessionOverlay
): RefinementSessionOverlayDelta {
  const baseSession = overlay.baseSession;
  const storage = assertPlainObject(overlay.storage, "overlay storage") as unknown as OverlayStorage;
  const base = readSessionForOverlay(baseSession, "base session", false);
  assertOverlayBaseline(baseSession, storage, base);
  const cellOverrides = assertOrdinaryMap(
    ownDataProperty<unknown>(storage, "cellOverrides", "overlay storage"),
    "overlay storage.cellOverrides"
  );
  const createdCells = assertOrdinaryMap(
    ownDataProperty<unknown>(storage, "createdCells", "overlay storage"),
    "overlay storage.createdCells"
  );
  const appendedNodes = assertOrdinaryArray(
    ownDataProperty<unknown>(storage, "appendedNodes", "overlay storage"),
    "overlay storage.appendedNodes"
  );
  const additions = assertOrdinarySet(
    ownDataProperty<unknown>(storage, "activeLeafAdditions", "overlay storage"),
    "overlay storage.activeLeafAdditions"
  );
  const removals = assertOrdinarySet(
    ownDataProperty<unknown>(storage, "activeLeafRemovals", "overlay storage"),
    "overlay storage.activeLeafRemovals"
  );
  const ownerOverrides = assertOrdinaryMap(
    ownDataProperty<unknown>(storage, "ownerOverridesByNodeKey", "overlay storage"),
    "overlay storage.ownerOverridesByNodeKey"
  );
  const commands = assertOrdinaryArray(
    ownDataProperty<unknown>(storage, "appendedUndoCommands", "overlay storage"),
    "overlay storage.appendedUndoCommands"
  );
  const referencedBaseCellIds = assertOrdinarySet(
    ownDataProperty<unknown>(storage, "referencedBaseCellIds", "overlay storage"),
    "overlay storage.referencedBaseCellIds"
  );
  const referencedBaseNodeIds = assertOrdinarySet(
    ownDataProperty<unknown>(storage, "referencedBaseNodeIds", "overlay storage"),
    "overlay storage.referencedBaseNodeIds"
  );
  const clearRedo = ownDataProperty<unknown>(storage, "clearRedo", "overlay storage");
  const nextCommandId = ownDataProperty<unknown>(storage, "nextCommandId", "overlay storage");
  const nextCellOrdinal = ownDataProperty<unknown>(storage, "nextCellOrdinal", "overlay storage");
  const storageDirty = ownDataProperty<unknown>(storage, "sortedActiveLeafIdsDirty", "overlay storage");
  if (typeof clearRedo !== "boolean" || typeof storageDirty !== "boolean") {
    overlayDeltaError("overlay history and dirty flags must be boolean");
  }
  assertCounter(nextCommandId, "overlay storage.nextCommandId");
  assertCounter(nextCellOrdinal, "overlay storage.nextCellOrdinal");

  const baseCells = storage.baseCells as Map<unknown, unknown>;
  const baseNodes = storage.baseNodes as unknown as readonly unknown[];
  const frozenNodes: Point[] = [];
  for (let index = 0; index < appendedNodes.length; index += 1) {
    frozenNodes.push(freezePlainValue(clonePoint(
      ownDataProperty<Point>(appendedNodes as object, String(index), "overlay storage.appendedNodes"),
      `overlay storage.appendedNodes[${index}]`
    )));
  }
  const maximumNodeId = storage.baseNodeCount + frozenNodes.length;
  const referencedNodeIds = new Set<number>();
  for (const nodeId of TRUSTED_REFLECT_APPLY(TRUSTED_SET_VALUES, referencedBaseNodeIds, []) as Iterable<number>) {
    if (!Number.isSafeInteger(nodeId) || nodeId < 1 || nodeId > storage.baseNodeCount) {
      overlayDeltaError(`overlay storage references invalid base node ${String(nodeId)}`);
    }
    referencedNodeIds.add(nodeId);
  }
  const overrideEntries = sortedMapEntries(cellOverrides, "overlay storage.cellOverrides");
  const createdEntries = sortedMapEntries(createdCells, "overlay storage.createdCells");
  const frozenOverrides = snapshotCellEntries(
    overrideEntries,
    "overlay storage.cellOverrides",
    baseCells,
    true,
    storage.baseNodeCount,
    maximumNodeId,
    referencedNodeIds
  );
  const frozenCreated = snapshotCellEntries(
    createdEntries,
    "overlay storage.createdCells",
    baseCells,
    false,
    storage.baseNodeCount,
    maximumNodeId,
    referencedNodeIds
  );
  const overriddenIds = new Set(frozenOverrides.map(({ id }) => id));
  for (const { id } of frozenCreated) {
    if (overriddenIds.has(id)) {
      overlayDeltaError(`cell ${id} cannot be both overridden and created`);
    }
  }

  const frozenAdditions = frozenArray(sortedCellIds(additions, "overlay storage.activeLeafAdditions"));
  const frozenRemovals = frozenArray(sortedCellIds(removals, "overlay storage.activeLeafRemovals"));
  const removalIds = new Set(frozenRemovals);
  for (const cellId of frozenAdditions) {
    if (removalIds.has(cellId)) {
      overlayDeltaError(`active cell ${cellId} cannot be both added and removed`);
    }
  }

  const baseOwnerMap = storage.baseActiveLeafIdsByNodeKey as Map<unknown, unknown>;
  const frozenOwnerOverrides: OverlayDeltaOwnerOverride[] = [];
  const baseOwnerGuards: BaseOwnerGuard[] = [];
  for (const [key, value] of sortedMapEntries(ownerOverrides, "overlay storage.ownerOverridesByNodeKey")) {
    const ownerIds = frozenArray(cloneCellIds(value, `overlay storage.ownerOverridesByNodeKey.${key}`));
    frozenOwnerOverrides.push(Object.freeze({ key, ownerIds }));
    const baseOwnerIds = mapGet(baseOwnerMap, key);
    if (baseOwnerIds !== undefined) {
      cloneCellIds(baseOwnerIds, `base session.activeLeafIdsByNodeKey.${key}`);
    }
    baseOwnerGuards.push(Object.freeze({
      key,
      ownerIds: baseOwnerIds as readonly CellId[] | undefined,
      fingerprint: baseOwnerIds === undefined
        ? undefined
        : ownerFingerprint(baseOwnerIds, `base session.activeLeafIdsByNodeKey.${key}`)
    }));
  }

  const baseCellIds = new Set<string>();
  for (const cellId of TRUSTED_REFLECT_APPLY(TRUSTED_SET_VALUES, referencedBaseCellIds, []) as Iterable<CellId>) {
    if (typeof cellId !== "string" || cellId.length === 0) {
      overlayDeltaError("overlay storage has an invalid referenced base cell id");
    }
    baseCellIds.add(cellId);
  }
  for (const { id } of frozenOverrides) baseCellIds.add(id);
  const baseCellGuards: BaseCellGuard[] = [];
  for (const cellId of [...baseCellIds].sort(compareCodeUnits)) {
    const cell = mapGet(baseCells, cellId);
    if (cell === undefined) {
      overlayDeltaError(`referenced base cell ${cellId} is missing`);
    }
    assertCellShape(cell, `base session.cells.${cellId}`);
    baseCellGuards.push(Object.freeze({
      id: cellId,
      cell: cell as RefinementSessionCell,
      fingerprint: primitiveObjectFingerprint(cell, `base session.cells.${cellId}`)
    }));
  }
  const baseNodeGuards: BaseNodeGuard[] = [];
  for (const nodeId of [...referencedNodeIds].sort((left, right) => left - right)) {
    const point = ownDataProperty<unknown>(baseNodes as object, String(nodeId - 1), "base session.nodes");
    baseNodeGuards.push(Object.freeze({
      nodeId,
      point: point as Point,
      fingerprint: nodeFingerprint(point, `base session.nodes[${nodeId - 1}]`)
    }));
  }

  const baseActiveLeaves = storage.baseActiveLeafIds as Set<unknown>;
  const baseActiveLeafGuards: BaseActiveLeafGuard[] = [];
  for (const cellId of frozenAdditions) {
    baseActiveLeafGuards.push(Object.freeze({ cellId, active: setHas(baseActiveLeaves, cellId) }));
  }
  for (const cellId of frozenRemovals) {
    baseActiveLeafGuards.push(Object.freeze({ cellId, active: setHas(baseActiveLeaves, cellId) }));
  }
  baseActiveLeafGuards.sort((left, right) => compareCodeUnits(left.cellId, right.cellId));

  const frozenCommands: RefinementSessionCommand[] = [];
  for (let index = 0; index < commands.length; index += 1) {
    frozenCommands.push(cloneCommand(
      ownDataProperty<RefinementSessionCommand>(commands as object, String(index), "overlay storage.appendedUndoCommands"),
      `overlay storage.appendedUndoCommands[${index}]`
    ));
  }
  return Object.freeze({
    baseSession,
    baseRevision: storage.baseRevision,
    baseNodes: storage.baseNodes,
    baseCells: storage.baseCells,
    baseActiveLeafIds: storage.baseActiveLeafIds,
    baseActiveLeafIdsByNodeKey: storage.baseActiveLeafIdsByNodeKey,
    baseSortedActiveLeafIds: storage.baseSortedActiveLeafIds,
    baseUndoStack: storage.baseUndoStack,
    baseRedoStack: storage.baseRedoStack,
    baseNodeCount: storage.baseNodeCount,
    baseCellCount: storage.baseCellCount,
    baseActiveLeafCount: storage.baseActiveLeafCount,
    baseOwnerKeyCount: storage.baseOwnerKeyCount,
    baseSortedActiveLeafCount: storage.baseSortedActiveLeafCount,
    baseUndoLength: storage.baseUndoLength,
    baseRedoLength: storage.baseRedoLength,
    baseSortedActiveLeafIdsDirty: storage.baseSortedActiveLeafIdsDirty,
    baseNextCommandId: storage.baseNextCommandId,
    baseNextCellOrdinal: storage.baseNextCellOrdinal,
    cellOverrides: frozenOverrides,
    createdCells: frozenCreated,
    appendedNodes: frozenArray(frozenNodes),
    activeLeafAdditions: frozenAdditions,
    activeLeafRemovals: frozenRemovals,
    ownerOverrides: frozenArray(frozenOwnerOverrides),
    appendedUndoCommands: frozenArray(frozenCommands),
    clearRedo,
    sortedActiveLeafIdsDirty: storageDirty || storage.baseSortedActiveLeafIdsDirty,
    nextCommandId,
    nextCellOrdinal,
    baseCellGuards: frozenArray(baseCellGuards),
    baseNodeGuards: frozenArray(baseNodeGuards),
    baseOwnerGuards: frozenArray(baseOwnerGuards),
    baseActiveLeafGuards: frozenArray(baseActiveLeafGuards)
  }) as RefinementSessionOverlayDelta;
}

function deltaProperty<T>(delta: Record<string, unknown>, key: string): T {
  return ownDataProperty<T>(delta, key, "overlay delta");
}

function assertDeltaCounter(value: unknown, label: string): number {
  assertCounter(value, label);
  return value as number;
}

function assertDeltaReference(
  actual: unknown,
  expected: unknown,
  label: string
): void {
  if (actual !== expected) {
    overlayDeltaError(`${label} changed since the snapshot`);
  }
}

function assertSortedIds(ids: readonly string[], label: string): void {
  for (let index = 1; index < ids.length; index += 1) {
    if (compareCodeUnits(ids[index - 1]!, ids[index]!) >= 0) {
      overlayDeltaError(`${label} must be strictly sorted`);
    }
  }
}

function assertBaseCellGuards(value: unknown, cells: Map<unknown, unknown>): void {
  const guards = assertOrdinaryArray(value, "overlay delta.baseCellGuards");
  const ids: string[] = [];
  for (let index = 0; index < guards.length; index += 1) {
    const guard = assertPlainObject(
      ownDataProperty<unknown>(guards as object, String(index), "overlay delta.baseCellGuards"),
      `overlay delta.baseCellGuards[${index}]`
    );
    const id = ownDataProperty<unknown>(guard, "id", `overlay delta.baseCellGuards[${index}]`);
    const cell = ownDataProperty<unknown>(guard, "cell", `overlay delta.baseCellGuards[${index}]`);
    const fingerprint = ownDataProperty<unknown>(guard, "fingerprint", `overlay delta.baseCellGuards[${index}]`);
    if (typeof id !== "string" || typeof fingerprint !== "string") {
      overlayDeltaError("base cell guards must have string ids and fingerprints");
    }
    ids.push(id);
    if (mapGet(cells, id) !== cell
      || primitiveObjectFingerprint(cell, `base session.cells.${id}`) !== fingerprint) {
      overlayDeltaError(`base cell fingerprint changed for ${id}`);
    }
  }
  assertSortedIds(ids, "overlay delta.baseCellGuards");
}

function assertBaseNodeGuards(value: unknown, nodes: readonly unknown[]): void {
  const guards = assertOrdinaryArray(value, "overlay delta.baseNodeGuards");
  let previousNodeId = 0;
  for (let index = 0; index < guards.length; index += 1) {
    const guard = assertPlainObject(
      ownDataProperty<unknown>(guards as object, String(index), "overlay delta.baseNodeGuards"),
      `overlay delta.baseNodeGuards[${index}]`
    );
    const nodeId = ownDataProperty<unknown>(guard, "nodeId", `overlay delta.baseNodeGuards[${index}]`);
    const point = ownDataProperty<unknown>(guard, "point", `overlay delta.baseNodeGuards[${index}]`);
    const fingerprint = ownDataProperty<unknown>(guard, "fingerprint", `overlay delta.baseNodeGuards[${index}]`);
    if (typeof nodeId !== "number" || !Number.isSafeInteger(nodeId) || nodeId <= previousNodeId || typeof fingerprint !== "string") {
      overlayDeltaError("base node guards must have sorted node ids and fingerprints");
    }
    previousNodeId = nodeId;
    if (nodeId > nodes.length
      || ownDataProperty<unknown>(nodes as object, String(nodeId - 1), "base session.nodes") !== point
      || nodeFingerprint(point, `base session.nodes[${nodeId - 1}]`) !== fingerprint) {
      overlayDeltaError(`base node fingerprint changed for ${nodeId}`);
    }
  }
}

function assertBaseOwnerGuards(value: unknown, owners: Map<unknown, unknown>): void {
  const guards = assertOrdinaryArray(value, "overlay delta.baseOwnerGuards");
  const keys: string[] = [];
  for (let index = 0; index < guards.length; index += 1) {
    const guard = assertPlainObject(
      ownDataProperty<unknown>(guards as object, String(index), "overlay delta.baseOwnerGuards"),
      `overlay delta.baseOwnerGuards[${index}]`
    );
    const key = ownDataProperty<unknown>(guard, "key", `overlay delta.baseOwnerGuards[${index}]`);
    const ownerIds = ownDataProperty<unknown>(guard, "ownerIds", `overlay delta.baseOwnerGuards[${index}]`);
    const fingerprint = ownDataProperty<unknown>(guard, "fingerprint", `overlay delta.baseOwnerGuards[${index}]`);
    if (typeof key !== "string" || (fingerprint !== undefined && typeof fingerprint !== "string")) {
      overlayDeltaError("base owner guards must have string keys and fingerprints");
    }
    keys.push(key);
    const current = mapGet(owners, key);
    if (current !== ownerIds
      || (current !== undefined && ownerFingerprint(current, `base session.activeLeafIdsByNodeKey.${key}`) !== fingerprint)) {
      overlayDeltaError(`base owner list changed for ${key}`);
    }
  }
  assertSortedIds(keys, "overlay delta.baseOwnerGuards");
}

function assertBaseActiveLeafGuards(value: unknown, activeLeafIds: Set<unknown>): void {
  const guards = assertOrdinaryArray(value, "overlay delta.baseActiveLeafGuards");
  const ids: string[] = [];
  for (let index = 0; index < guards.length; index += 1) {
    const guard = assertPlainObject(
      ownDataProperty<unknown>(guards as object, String(index), "overlay delta.baseActiveLeafGuards"),
      `overlay delta.baseActiveLeafGuards[${index}]`
    );
    const cellId = ownDataProperty<unknown>(guard, "cellId", `overlay delta.baseActiveLeafGuards[${index}]`);
    const active = ownDataProperty<unknown>(guard, "active", `overlay delta.baseActiveLeafGuards[${index}]`);
    if (typeof cellId !== "string" || typeof active !== "boolean") {
      overlayDeltaError("base active leaf guards must have string cell ids and boolean state");
    }
    ids.push(cellId);
    if (setHas(activeLeafIds, cellId) !== active) {
      overlayDeltaError(`base active leaf state changed for ${cellId}`);
    }
  }
  assertSortedIds(ids, "overlay delta.baseActiveLeafGuards");
}

function prepareDeltaCells(
  value: unknown,
  label: string,
  cells: Map<unknown, unknown>,
  expectedBaseCell: boolean,
  maximumNodeId: number
): readonly [CellId, MutableRefinementSessionCell][] {
  const entries = assertOrdinaryArray(value, label);
  const result: [CellId, MutableRefinementSessionCell][] = [];
  const ids: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = assertPlainObject(
      ownDataProperty<unknown>(entries as object, String(index), label),
      `${label}[${index}]`
    );
    const id = ownDataProperty<unknown>(entry, "id", `${label}[${index}]`);
    const sourceCell = ownDataProperty<unknown>(entry, "cell", `${label}[${index}]`);
    if (typeof id !== "string" || id.length === 0) {
      overlayDeltaError(`${label}[${index}].id must be a non-empty string`);
    }
    ids.push(id);
    const cell = assertCellShape(sourceCell, `${label}[${index}].cell`);
    if (ownDataProperty<unknown>(cell as object, "id", `${label}[${index}].cell`) !== id) {
      overlayDeltaError(`${label}[${index}].cell.id must match its id`);
    }
    if (mapHas(cells, id) !== expectedBaseCell) {
      overlayDeltaError(expectedBaseCell
        ? `${label}[${index}] must refer to an existing base cell`
        : `${label}[${index}] must create a new cell`);
    }
    cellNodeIds(cell, maximumNodeId, `${label}[${index}].cell`);
    result.push([id, cloneMutableCell(cell, `${label}[${index}].cell`)]);
  }
  assertSortedIds(ids, label);
  return result;
}

function prepareAppendedNodes(value: unknown): readonly Point[] {
  const nodes = assertOrdinaryArray(value, "overlay delta.appendedNodes");
  const result: Point[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    result.push(clonePoint(
      ownDataProperty<Point>(nodes as object, String(index), "overlay delta.appendedNodes"),
      `overlay delta.appendedNodes[${index}]`
    ));
  }
  return result;
}

function prepareCommands(value: unknown): readonly RefinementSessionCommand[] {
  const commands = assertOrdinaryArray(value, "overlay delta.appendedUndoCommands");
  const result: RefinementSessionCommand[] = [];
  for (let index = 0; index < commands.length; index += 1) {
    result.push(cloneCommand(
      ownDataProperty<RefinementSessionCommand>(commands as object, String(index), "overlay delta.appendedUndoCommands"),
      `overlay delta.appendedUndoCommands[${index}]`
    ));
  }
  return result;
}

function prepareOverlayCommit(
  session: RefinementSession,
  delta: RefinementSessionOverlayDelta
): PreparedOverlayCommit {
  const deltaObject = assertPlainObject(delta, "overlay delta");
  if (!Object.isFrozen(delta)) {
    overlayDeltaError("overlay delta must be immutable");
  }
  if (deltaProperty<unknown>(deltaObject, "baseSession") !== session) {
    overlayDeltaError("base session identity does not match the commit target");
  }
  const target = readSessionForOverlay(session, "target session", true);
  const baseRevision = assertDeltaCounter(deltaProperty<unknown>(deltaObject, "baseRevision"), "overlay delta.baseRevision");
  if (baseRevision !== target.revision) {
    overlayDeltaError("base session revision changed since the snapshot");
  }
  const references: readonly [string, unknown, unknown][] = [
    ["nodes", target.nodes, deltaProperty<unknown>(deltaObject, "baseNodes")],
    ["cells", target.cells, deltaProperty<unknown>(deltaObject, "baseCells")],
    ["activeLeafIds", target.activeLeafIds, deltaProperty<unknown>(deltaObject, "baseActiveLeafIds")],
    ["activeLeafIdsByNodeKey", target.activeLeafIdsByNodeKey, deltaProperty<unknown>(deltaObject, "baseActiveLeafIdsByNodeKey")],
    ["sortedActiveLeafIds", target.sortedActiveLeafIds, deltaProperty<unknown>(deltaObject, "baseSortedActiveLeafIds")],
    ["undoStack", target.undoStack, deltaProperty<unknown>(deltaObject, "baseUndoStack")],
    ["redoStack", target.redoStack, deltaProperty<unknown>(deltaObject, "baseRedoStack")]
  ];
  for (const [label, actual, expected] of references) {
    assertDeltaReference(actual, expected, `target session.${label}`);
  }
  const countGuards: readonly [string, number, unknown][] = [
    ["baseNodeCount", target.nodes.length, deltaProperty<unknown>(deltaObject, "baseNodeCount")],
    ["baseCellCount", mapSize(target.cells as Map<unknown, unknown>), deltaProperty<unknown>(deltaObject, "baseCellCount")],
    ["baseActiveLeafCount", setSize(target.activeLeafIds as Set<unknown>), deltaProperty<unknown>(deltaObject, "baseActiveLeafCount")],
    ["baseOwnerKeyCount", mapSize(target.activeLeafIdsByNodeKey as Map<unknown, unknown>), deltaProperty<unknown>(deltaObject, "baseOwnerKeyCount")],
    ["baseSortedActiveLeafCount", target.sortedActiveLeafIds.length, deltaProperty<unknown>(deltaObject, "baseSortedActiveLeafCount")],
    ["baseUndoLength", target.undoStack.length, deltaProperty<unknown>(deltaObject, "baseUndoLength")],
    ["baseRedoLength", target.redoStack.length, deltaProperty<unknown>(deltaObject, "baseRedoLength")]
  ];
  for (const [label, actual, expected] of countGuards) {
    if (assertDeltaCounter(expected, `overlay delta.${label}`) !== actual) {
      overlayDeltaError(`${label} changed since the snapshot`);
    }
  }
  if (deltaProperty<unknown>(deltaObject, "baseSortedActiveLeafIdsDirty") !== target.sortedActiveLeafIdsDirty
    || deltaProperty<unknown>(deltaObject, "baseNextCommandId") !== target.nextCommandId
    || deltaProperty<unknown>(deltaObject, "baseNextCellOrdinal") !== target.nextCellOrdinal) {
    overlayDeltaError("base session counters changed since the snapshot");
  }
  assertBaseCellGuards(deltaProperty<unknown>(deltaObject, "baseCellGuards"), target.cells as Map<unknown, unknown>);
  assertBaseNodeGuards(deltaProperty<unknown>(deltaObject, "baseNodeGuards"), target.nodes);
  assertBaseOwnerGuards(deltaProperty<unknown>(deltaObject, "baseOwnerGuards"), target.activeLeafIdsByNodeKey as Map<unknown, unknown>);
  assertBaseActiveLeafGuards(deltaProperty<unknown>(deltaObject, "baseActiveLeafGuards"), target.activeLeafIds as Set<unknown>);

  const appendedNodes = prepareAppendedNodes(deltaProperty<unknown>(deltaObject, "appendedNodes"));
  const maximumNodeId = target.nodes.length + appendedNodes.length;
  const cellOverrides = prepareDeltaCells(
    deltaProperty<unknown>(deltaObject, "cellOverrides"),
    "overlay delta.cellOverrides",
    target.cells as Map<unknown, unknown>,
    true,
    maximumNodeId
  );
  const createdCells = prepareDeltaCells(
    deltaProperty<unknown>(deltaObject, "createdCells"),
    "overlay delta.createdCells",
    target.cells as Map<unknown, unknown>,
    false,
    maximumNodeId
  );
  const createdIds = new Set(createdCells.map(([id]) => id));
  for (const [id] of cellOverrides) {
    if (createdIds.has(id)) {
      overlayDeltaError(`cell ${id} cannot be both overridden and created`);
    }
  }
  const activeLeafAdditions = cloneCellIds(
    deltaProperty<unknown>(deltaObject, "activeLeafAdditions"),
    "overlay delta.activeLeafAdditions"
  );
  const activeLeafRemovals = cloneCellIds(
    deltaProperty<unknown>(deltaObject, "activeLeafRemovals"),
    "overlay delta.activeLeafRemovals"
  );
  assertSortedIds(activeLeafAdditions, "overlay delta.activeLeafAdditions");
  assertSortedIds(activeLeafRemovals, "overlay delta.activeLeafRemovals");
  const removalIds = new Set(activeLeafRemovals);
  for (const cellId of activeLeafAdditions) {
    if (removalIds.has(cellId) || setHas(target.activeLeafIds as Set<unknown>, cellId)) {
      overlayDeltaError(`invalid active leaf addition ${cellId}`);
    }
    if (!mapHas(target.cells as Map<unknown, unknown>, cellId) && !createdIds.has(cellId)) {
      overlayDeltaError(`active leaf addition ${cellId} references an unknown cell`);
    }
  }
  for (const cellId of activeLeafRemovals) {
    if (!setHas(target.activeLeafIds as Set<unknown>, cellId)) {
      overlayDeltaError(`invalid active leaf removal ${cellId}`);
    }
    if (!mapHas(target.cells as Map<unknown, unknown>, cellId)) {
      overlayDeltaError(`active leaf removal ${cellId} references an unknown base cell`);
    }
  }

  const ownerEntries = assertOrdinaryArray(deltaProperty<unknown>(deltaObject, "ownerOverrides"), "overlay delta.ownerOverrides");
  const ownerOverrides: [string, CellId[]][] = [];
  const ownerKeys: string[] = [];
  const additions = new Set(activeLeafAdditions);
  for (let index = 0; index < ownerEntries.length; index += 1) {
    const entry = assertPlainObject(
      ownDataProperty<unknown>(ownerEntries as object, String(index), "overlay delta.ownerOverrides"),
      `overlay delta.ownerOverrides[${index}]`
    );
    const key = ownDataProperty<unknown>(entry, "key", `overlay delta.ownerOverrides[${index}]`);
    if (typeof key !== "string") {
      overlayDeltaError(`overlay delta.ownerOverrides[${index}].key must be a string`);
    }
    ownerKeys.push(key);
    const ownerIds = cloneCellIds(
      ownDataProperty<unknown>(entry, "ownerIds", `overlay delta.ownerOverrides[${index}]`),
      `overlay delta.ownerOverrides[${index}].ownerIds`
    );
    for (const ownerId of ownerIds) {
      const active = additions.has(ownerId)
        || (setHas(target.activeLeafIds as Set<unknown>, ownerId) && !removalIds.has(ownerId));
      if (!active || (!mapHas(target.cells as Map<unknown, unknown>, ownerId) && !createdIds.has(ownerId))) {
        overlayDeltaError(`owner override ${key} references inactive or unknown cell ${ownerId}`);
      }
    }
    ownerOverrides.push([key, ownerIds]);
  }
  assertSortedIds(ownerKeys, "overlay delta.ownerOverrides");
  const clearRedo = deltaProperty<unknown>(deltaObject, "clearRedo");
  const sortedActiveLeafIdsDirty = deltaProperty<unknown>(deltaObject, "sortedActiveLeafIdsDirty");
  if (typeof clearRedo !== "boolean" || typeof sortedActiveLeafIdsDirty !== "boolean") {
    overlayDeltaError("overlay delta flags must be boolean");
  }
  const nextCommandId = assertDeltaCounter(deltaProperty<unknown>(deltaObject, "nextCommandId"), "overlay delta.nextCommandId");
  const nextCellOrdinal = assertDeltaCounter(deltaProperty<unknown>(deltaObject, "nextCellOrdinal"), "overlay delta.nextCellOrdinal");
  const appendedUndoCommands = prepareCommands(deltaProperty<unknown>(deltaObject, "appendedUndoCommands"));
  assertAppendTarget(target.nodes, appendedNodes.length, "target session.nodes");
  assertAppendTarget(target.undoStack, appendedUndoCommands.length, "target session.undoStack");
  assertTrustedCommitIntrinsics();
  if (target.revision >= Number.MAX_SAFE_INTEGER) {
    overlayDeltaError("target session revision cannot be incremented safely");
  }
  return {
    session: target,
    nodes: target.nodes,
    cells: target.cells,
    activeLeafIds: target.activeLeafIds,
    activeLeafIdsByNodeKey: target.activeLeafIdsByNodeKey,
    undoStack: target.undoStack,
    cellOverrides,
    createdCells,
    appendedNodes,
    activeLeafAdditions,
    activeLeafRemovals,
    ownerOverrides,
    appendedUndoCommands,
    replacementRedoStack: clearRedo ? [] : undefined,
    sortedActiveLeafIdsDirty,
    nextCommandId,
    nextCellOrdinal,
    nextRevision: target.revision + 1
  };
}

/**
 * Apply a validated sparse overlay delta. Every potentially fallible operation is
 * completed before the first mutation, leaving only native bounded mutations here.
 */
export function commitRefinementSessionOverlay(
  session: RefinementSession,
  delta: RefinementSessionOverlayDelta
): void {
  const prepared = prepareOverlayCommit(session, delta);
  const target = prepared.session;
  for (let index = 0; index < prepared.appendedNodes.length; index += 1) {
    TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, prepared.nodes, [prepared.appendedNodes[index]!]);
  }
  for (let index = 0; index < prepared.cellOverrides.length; index += 1) {
    const entry = prepared.cellOverrides[index]!;
    TRUSTED_REFLECT_APPLY(TRUSTED_MAP_SET, prepared.cells, [entry[0], entry[1]]);
  }
  for (let index = 0; index < prepared.createdCells.length; index += 1) {
    const entry = prepared.createdCells[index]!;
    TRUSTED_REFLECT_APPLY(TRUSTED_MAP_SET, prepared.cells, [entry[0], entry[1]]);
  }
  for (let index = 0; index < prepared.activeLeafRemovals.length; index += 1) {
    TRUSTED_REFLECT_APPLY(TRUSTED_SET_DELETE, prepared.activeLeafIds, [prepared.activeLeafRemovals[index]!]);
  }
  for (let index = 0; index < prepared.activeLeafAdditions.length; index += 1) {
    TRUSTED_REFLECT_APPLY(TRUSTED_SET_ADD, prepared.activeLeafIds, [prepared.activeLeafAdditions[index]!]);
  }
  for (let index = 0; index < prepared.ownerOverrides.length; index += 1) {
    const entry = prepared.ownerOverrides[index]!;
    if (entry[1].length === 0) {
      TRUSTED_REFLECT_APPLY(TRUSTED_MAP_DELETE, prepared.activeLeafIdsByNodeKey, [entry[0]]);
    } else {
      TRUSTED_REFLECT_APPLY(TRUSTED_MAP_SET, prepared.activeLeafIdsByNodeKey, [entry[0], entry[1]]);
    }
  }
  target.sortedActiveLeafIdsDirty = prepared.sortedActiveLeafIdsDirty;
  if (prepared.replacementRedoStack !== undefined) {
    target.redoStack = prepared.replacementRedoStack;
  }
  for (let index = 0; index < prepared.appendedUndoCommands.length; index += 1) {
    TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, prepared.undoStack, [prepared.appendedUndoCommands[index]!]);
  }
  target.nextCommandId = prepared.nextCommandId;
  target.nextCellOrdinal = prepared.nextCellOrdinal;
  target.revision = prepared.nextRevision;
}

function sameCellIds(left: readonly CellId[], right: readonly CellId[]): boolean {
  return left.length === right.length && left.every((cellId, index) => cellId === right[index]);
}

function canonicalOwnerIds(
  ownerIds: readonly CellId[],
  baseOwners: readonly CellId[]
): CellId[] {
  const remaining = new Set(ownerIds);
  const canonical = baseOwners.filter((cellId) => remaining.delete(cellId));
  for (const cellId of ownerIds) {
    if (remaining.delete(cellId)) canonical.push(cellId);
  }
  return canonical;
}

function activeNodeKeys(
  baseSession: RefinementSession,
  storage: OverlayStorage,
  options: RefinementSessionOverlayOptions,
  cell: RefinementSessionCell
): { keys: string[]; referencedBaseNodeIds: Set<number> } {
  const keys = new Set<string>();
  const referencedBaseNodeIds = new Set<number>();
  for (const nodeId of options.cellNodeIds(cell)) {
    const isBaseNode = nodeId >= 1 && nodeId <= storage.baseNodeCount;
    const point = isBaseNode
      ? baseSession.nodes[nodeId - 1]
      : storage.appendedNodes[nodeId - storage.baseNodeCount - 1];
    if (point === undefined) {
      throw new Error(`active cell ${cell.id} references missing node ${nodeId}`);
    }
    if (isBaseNode) referencedBaseNodeIds.add(nodeId);
    keys.add(options.nodeKey(point));
  }
  return { keys: [...keys], referencedBaseNodeIds };
}

function batchActiveNodeKeys(
  baseSession: RefinementSession,
  storage: OverlayStorage,
  options: RefinementSessionOverlayOptions,
  cell: RefinementSessionCell,
  appendedNodes: readonly Point[]
): { keys: string[]; referencedBaseNodeIds: Set<number> } {
  const keys = new Set<string>();
  const referencedBaseNodeIds = new Set<number>();
  const currentNodeCount =
    storage.baseNodeCount + storage.appendedNodes.length;
  for (const nodeId of options.cellNodeIds(cell)) {
    const isBaseNode = nodeId >= 1 && nodeId <= storage.baseNodeCount;
    const point = isBaseNode
      ? baseSession.nodes[nodeId - 1]
      : nodeId <= currentNodeCount
        ? storage.appendedNodes[nodeId - storage.baseNodeCount - 1]
        : appendedNodes[nodeId - currentNodeCount - 1];
    if (point === undefined) {
      throw new Error(
        `active cell ${cell.id} references missing node ${nodeId}`
      );
    }
    if (isBaseNode) referencedBaseNodeIds.add(nodeId);
    keys.add(options.nodeKey(point));
  }
  return { keys: [...keys], referencedBaseNodeIds };
}

function requiredCell(
  baseSession: RefinementSession,
  storage: OverlayStorage,
  cellId: CellId
): RefinementSessionCell {
  const cell = storage.createdCells.get(cellId)
    ?? storage.cellOverrides.get(cellId)
    ?? baseSession.cells.get(cellId);
  if (cell === undefined) {
    throw new Error(`unknown refinement cell ${cellId}`);
  }
  return cell;
}

function createRefinementSessionOverlayWithBaseline(
  baseSession: RefinementSession,
  options: RefinementSessionOverlayOptions,
  baseline: OverlayBaseline
): RefinementSessionOverlay {
  const storage: OverlayStorage = {
    ...baseline,
    cellOverrides: new Map(),
    createdCells: new Map(),
    appendedNodes: [],
    activeLeafAdditions: new Set(),
    activeLeafRemovals: new Set(),
    ownerOverridesByNodeKey: new Map(),
    sortedActiveLeafIdsDirty: false,
    appendedUndoCommands: [],
    clearRedo: false,
    nextCommandId: baseSession.nextCommandId,
    nextCellOrdinal: baseSession.nextCellOrdinal ?? baseSession.cells.size + 1,
    referencedBaseCellIds: new Set(),
    referencedBaseNodeIds: new Set()
  };
  const registeredPlanningStorage = Object.freeze({
    cellOverrides: storage.cellOverrides,
    createdCells: storage.createdCells,
    appendedNodes: storage.appendedNodes,
    activeLeafAdditions: storage.activeLeafAdditions,
    activeLeafRemovals: storage.activeLeafRemovals,
    ownerOverridesByNodeKey: storage.ownerOverridesByNodeKey,
    referencedBaseCellIds: storage.referencedBaseCellIds,
    referencedBaseNodeIds: storage.referencedBaseNodeIds,
    baseNodes: baseSession.nodes,
    baseCells: baseSession.cells,
    baseActiveLeafIds: baseSession.activeLeafIds,
    baseActiveLeafIdsByNodeKey: baseSession.activeLeafIdsByNodeKey
  });
  const assertRegisteredPlanningStorage = (): void => {
    if (
      TRUSTED_OBJECT_GET_PROTOTYPE_OF(storage) !== TRUSTED_OBJECT_PROTOTYPE
      || TRUSTED_OBJECT_GET_PROTOTYPE_OF(baseSession)
        !== TRUSTED_OBJECT_PROTOTYPE
    ) {
      throw new TypeError(
        "refinement session state registered storage prototype changed during planning"
      );
    }
    const assertStorageIdentity = (
      key: keyof typeof registeredPlanningStorage
    ): void => {
      assertRefinementSessionStateOwnDataIdentityInternal(
        storage,
        key,
        registeredPlanningStorage[key],
        `overlay storage.${key}`
      );
    };
    assertStorageIdentity("cellOverrides");
    assertStorageIdentity("createdCells");
    assertStorageIdentity("appendedNodes");
    assertStorageIdentity("activeLeafAdditions");
    assertStorageIdentity("activeLeafRemovals");
    assertStorageIdentity("ownerOverridesByNodeKey");
    assertStorageIdentity("referencedBaseCellIds");
    assertStorageIdentity("referencedBaseNodeIds");
    assertStorageIdentity("baseNodes");
    assertStorageIdentity("baseCells");
    assertStorageIdentity("baseActiveLeafIds");
    assertStorageIdentity("baseActiveLeafIdsByNodeKey");
    const assertBaseIdentity = (
      key: "nodes" | "cells" | "activeLeafIds" | "activeLeafIdsByNodeKey",
      expected: unknown
    ): void => {
      assertRefinementSessionStateOwnDataIdentityInternal(
        baseSession,
        key,
        expected,
        `overlay base session.${key}`
      );
    };
    assertBaseIdentity("nodes", registeredPlanningStorage.baseNodes);
    assertBaseIdentity("cells", registeredPlanningStorage.baseCells);
    assertBaseIdentity(
      "activeLeafIds",
      registeredPlanningStorage.baseActiveLeafIds
    );
    assertBaseIdentity(
      "activeLeafIdsByNodeKey",
      registeredPlanningStorage.baseActiveLeafIdsByNodeKey
    );
  };
  const storageData = (key: keyof OverlayStorage): unknown =>
    refinementSessionStateOwnDataValueInternal(
      storage,
      key,
      `overlay storage.${String(key)}`
    );
  const baseSessionData = (key: keyof RefinementSession): unknown =>
    refinementSessionStateOwnDataValueInternal(
      baseSession,
      key,
      `overlay base session.${String(key)}`
    );
  const hasActiveLeaf = (cellId: CellId): boolean => {
    if (storage.activeLeafAdditions.has(cellId)) return true;
    if (storage.activeLeafRemovals.has(cellId)) return false;
    return baseSession.activeLeafIds.has(cellId);
  };
  const recordActiveReferences = (
    cellId: CellId,
    referencedBaseNodeIds: ReadonlySet<number>
  ): void => {
    if (baseSession.cells.has(cellId)) {
      storage.referencedBaseCellIds.add(cellId);
    }
    for (const nodeId of referencedBaseNodeIds) {
      storage.referencedBaseNodeIds.add(nodeId);
    }
  };
  const preparedActiveLeafBatches =
    new WeakMap<object, PreparedOverlayActiveLeafBatch>();
  const prepareActiveLeafBatch = (
    batch: Parameters<RefinementSessionStateWriter["prepareActiveLeafBatch"]>[0]
  ): PreparedRefinementSessionActiveLeafBatchInternal => {
    const nextAdditions = new Set(storage.activeLeafAdditions);
    const nextRemovals = new Set(storage.activeLeafRemovals);
    const activeOverrides = new Map<CellId, boolean>();
    const ownerUpdates = new Map<string, CellId[]>();
    const referencedBaseCellIds = new Set<CellId>();
    const referencedBaseNodeIds = new Set<number>();
    const addedCells = new Map(
      batch.additions.map((cell) => [cell.id, cell])
    );
    const isActive = (cellId: CellId): boolean =>
      activeOverrides.get(cellId) ?? hasActiveLeaf(cellId);
    const ownersForKey = (key: string): readonly CellId[] =>
      ownerUpdates.get(key)
        ?? storage.ownerOverridesByNodeKey.get(key)
        ?? baseSession.activeLeafIdsByNodeKey.get(key)
        ?? [];
    const recordReferences = (
      cellId: CellId,
      nodeIds: ReadonlySet<number>
    ): void => {
      if (baseSession.cells.has(cellId)) {
        referencedBaseCellIds.add(cellId);
      }
      for (const nodeId of nodeIds) referencedBaseNodeIds.add(nodeId);
    };

    for (const cell of batch.additions) {
      if (isActive(cell.id)) continue;
      const validation = batchActiveNodeKeys(
        baseSession,
        storage,
        options,
        cell,
        batch.appendedNodes
      );
      recordReferences(cell.id, validation.referencedBaseNodeIds);
      activeOverrides.set(cell.id, true);
      if (baseSession.activeLeafIds.has(cell.id)) {
        nextRemovals.delete(cell.id);
      } else {
        nextAdditions.add(cell.id);
      }
      for (const key of validation.keys) {
        const owners = ownersForKey(key);
        const baseOwners = baseSession.activeLeafIdsByNodeKey.get(key) ?? [];
        ownerUpdates.set(
          key,
          canonicalOwnerIds(
            owners.includes(cell.id) ? owners : [...owners, cell.id],
            baseOwners
          )
        );
      }
    }

    for (const cellId of batch.removals) {
      const cell = addedCells.get(cellId)
        ?? requiredCell(baseSession, storage, cellId);
      if (!isActive(cellId)) continue;
      const validation = batchActiveNodeKeys(
        baseSession,
        storage,
        options,
        cell,
        batch.appendedNodes
      );
      recordReferences(cellId, validation.referencedBaseNodeIds);
      activeOverrides.set(cellId, false);
      if (baseSession.activeLeafIds.has(cellId)) {
        nextRemovals.add(cellId);
      } else {
        nextAdditions.delete(cellId);
      }
      for (const key of validation.keys) {
        const baseOwners = baseSession.activeLeafIdsByNodeKey.get(key) ?? [];
        ownerUpdates.set(
          key,
          canonicalOwnerIds(
            ownersForKey(key).filter((ownerId) => ownerId !== cellId),
            baseOwners
          )
        );
      }
    }

    const ownerOverrides = [...ownerUpdates].map(
      ([key, owners]): [string, CellId[] | undefined] => {
        const baseOwners = baseSession.activeLeafIdsByNodeKey.get(key) ?? [];
        return [key, sameCellIds(owners, baseOwners) ? undefined : owners];
      }
    );
    const prepared: PreparedOverlayActiveLeafBatch = {
      activeLeafAdditionAdds: [...nextAdditions].filter(
        (cellId) => !storage.activeLeafAdditions.has(cellId)
      ),
      activeLeafAdditionDeletes: [...storage.activeLeafAdditions].filter(
        (cellId) => !nextAdditions.has(cellId)
      ),
      activeLeafRemovalAdds: [...nextRemovals].filter(
        (cellId) => !storage.activeLeafRemovals.has(cellId)
      ),
      activeLeafRemovalDeletes: [...storage.activeLeafRemovals].filter(
        (cellId) => !nextRemovals.has(cellId)
      ),
      ownerOverrides,
      referencedBaseCellIds: [...referencedBaseCellIds],
      referencedBaseNodeIds: [...referencedBaseNodeIds],
      sortedActiveLeafIdsDirty:
        nextAdditions.size > 0 || nextRemovals.size > 0
    };
    const token = Object.freeze({}) as
      PreparedRefinementSessionActiveLeafBatchInternal;
    TRUSTED_REFLECT_APPLY(
      TRUSTED_WEAK_MAP_SET,
      preparedActiveLeafBatches,
      [token, prepared]
    );
    return token;
  };
  const commitActiveLeafBatch = (
    token: PreparedRefinementSessionActiveLeafBatchInternal
  ): void => {
    const prepared = TRUSTED_REFLECT_APPLY(
      TRUSTED_WEAK_MAP_GET,
      preparedActiveLeafBatches,
      [token]
    ) as PreparedOverlayActiveLeafBatch | undefined;
    if (prepared === undefined) {
      throw new TypeError("invalid or consumed active-leaf batch token");
    }
    TRUSTED_REFLECT_APPLY(
      TRUSTED_WEAK_MAP_DELETE,
      preparedActiveLeafBatches,
      [token]
    );
    for (const cellId of prepared.activeLeafAdditionDeletes) {
      TRUSTED_REFLECT_APPLY(
        TRUSTED_SET_DELETE,
        storage.activeLeafAdditions,
        [cellId]
      );
    }
    for (const cellId of prepared.activeLeafAdditionAdds) {
      TRUSTED_REFLECT_APPLY(
        TRUSTED_SET_ADD,
        storage.activeLeafAdditions,
        [cellId]
      );
    }
    for (const cellId of prepared.activeLeafRemovalDeletes) {
      TRUSTED_REFLECT_APPLY(
        TRUSTED_SET_DELETE,
        storage.activeLeafRemovals,
        [cellId]
      );
    }
    for (const cellId of prepared.activeLeafRemovalAdds) {
      TRUSTED_REFLECT_APPLY(
        TRUSTED_SET_ADD,
        storage.activeLeafRemovals,
        [cellId]
      );
    }
    for (const [key, owners] of prepared.ownerOverrides) {
      if (owners === undefined) {
        TRUSTED_REFLECT_APPLY(
          TRUSTED_MAP_DELETE,
          storage.ownerOverridesByNodeKey,
          [key]
        );
      } else {
        TRUSTED_REFLECT_APPLY(
          TRUSTED_MAP_SET,
          storage.ownerOverridesByNodeKey,
          [key, owners]
        );
      }
    }
    for (const cellId of prepared.referencedBaseCellIds) {
      TRUSTED_REFLECT_APPLY(
        TRUSTED_SET_ADD,
        storage.referencedBaseCellIds,
        [cellId]
      );
    }
    for (const nodeId of prepared.referencedBaseNodeIds) {
      TRUSTED_REFLECT_APPLY(
        TRUSTED_SET_ADD,
        storage.referencedBaseNodeIds,
        [nodeId]
      );
    }
    storage.sortedActiveLeafIdsDirty =
      prepared.sortedActiveLeafIdsDirty;
  };

  const overlay: RefinementSessionOverlay = {
    storage,
    options,
    baseSession,
    get revision() {
      return storage.baseRevision;
    },
    get kind() {
      return baseSession.kind;
    },
    get nodeCount() {
      return storage.baseNodeCount + storage.appendedNodes.length;
    },
    get cellCount() {
      return storage.baseCellCount + storage.createdCells.size;
    },
    get activeLeafCount() {
      return storage.baseActiveLeafCount
        - storage.activeLeafRemovals.size
        + storage.activeLeafAdditions.size;
    },
    get nextCommandId() {
      return storage.nextCommandId;
    },
    get nextCellOrdinal() {
      return storage.nextCellOrdinal;
    },
    get sortedActiveLeafIdsDirty() {
      return storage.sortedActiveLeafIdsDirty
        || storage.baseSortedActiveLeafIdsDirty;
    },
    peekNode(nodeId) {
      if (nodeId >= 1 && nodeId <= storage.baseNodeCount) {
        return baseSession.nodes[nodeId - 1];
      }
      return storage.appendedNodes[nodeId - storage.baseNodeCount - 1];
    },
    peekCell(cellId) {
      return storage.createdCells.get(cellId)
        ?? storage.cellOverrides.get(cellId)
        ?? baseSession.cells.get(cellId);
    },
    node(nodeId) {
      if (nodeId >= 1 && nodeId <= storage.baseNodeCount) {
        storage.referencedBaseNodeIds.add(nodeId);
        return baseSession.nodes[nodeId - 1];
      }
      return storage.appendedNodes[nodeId - storage.baseNodeCount - 1];
    },
    cell(cellId) {
      const created = storage.createdCells.get(cellId);
      if (created !== undefined) {
        return created;
      }
      const overridden = storage.cellOverrides.get(cellId);
      if (overridden !== undefined) {
        return overridden;
      }
      const base = baseSession.cells.get(cellId);
      if (base !== undefined) {
        storage.referencedBaseCellIds.add(cellId);
      }
      return base;
    },
    mutableCell(cellId) {
      const existing = storage.createdCells.get(cellId)
        ?? storage.cellOverrides.get(cellId);
      if (existing !== undefined) {
        return existing;
      }
      const base = baseSession.cells.get(cellId);
      if (base === undefined) {
        throw new Error(`unknown refinement cell ${cellId}`);
      }
      const cloned = cloneCell(base);
      storage.cellOverrides.set(cellId, cloned);
      return cloned;
    },
    appendNode(point) {
      storage.appendedNodes.push([...point]);
      return storage.baseNodeCount + storage.appendedNodes.length;
    },
    setCell(cell) {
      if (baseSession.cells.has(cell.id) || storage.createdCells.has(cell.id)) {
        throw new Error(`overlay cannot create duplicate cell ${cell.id}`);
      }
      storage.createdCells.set(cell.id, cell);
    },
    hasActiveLeaf,
    activeLeafIds() {
      const activeIds: CellId[] = [];
      const baseActiveIds = setValues(
        baseSession.activeLeafIds as Set<CellId>
      );
      const baseActiveIdCount =
        refinementSessionStateOrdinaryArrayLengthInternal(
          baseActiveIds,
          "overlay reader base active ids"
        );
      for (let index = 0; index < baseActiveIdCount; index += 1) {
        const cellId = refinementSessionStateOrdinaryArrayValueInternal(
          baseActiveIds,
          index,
          "overlay reader base active ids"
        ) as CellId;
        if (!setHas(storage.activeLeafRemovals, cellId)) {
          TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, activeIds, [cellId]);
        }
      }
      const addedActiveIds = setValues(storage.activeLeafAdditions);
      const addedActiveIdCount =
        refinementSessionStateOrdinaryArrayLengthInternal(
          addedActiveIds,
          "overlay reader added active ids"
        );
      for (let index = 0; index < addedActiveIdCount; index += 1) {
        TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, activeIds, [
          refinementSessionStateOrdinaryArrayValueInternal(
            addedActiveIds,
            index,
            "overlay reader added active ids"
          )
        ]);
      }
      return activeIds;
    },
    activeOwnersByNodeKey(key) {
      return storage.ownerOverridesByNodeKey.get(key)
        ?? baseSession.activeLeafIdsByNodeKey.get(key)
        ?? [];
    },
    addActiveLeaf(cellId) {
      const cell = requiredCell(baseSession, storage, cellId);
      const wasActive = hasActiveLeaf(cellId);
      if (wasActive) return;
      const validation = activeNodeKeys(baseSession, storage, options, cell);
      const ownerUpdates = new Map<string, CellId[]>();
      for (const key of validation.keys) {
        const owners = storage.ownerOverridesByNodeKey.get(key)
          ?? baseSession.activeLeafIdsByNodeKey.get(key)
          ?? [];
        const baseOwners = baseSession.activeLeafIdsByNodeKey.get(key) ?? [];
        ownerUpdates.set(
          key,
          canonicalOwnerIds(
            owners.includes(cellId) ? owners : [...owners, cellId],
            baseOwners
          )
        );
      }

      recordActiveReferences(cellId, validation.referencedBaseNodeIds);
      if (baseSession.activeLeafIds.has(cellId)) {
        storage.activeLeafRemovals.delete(cellId);
      } else {
        storage.activeLeafAdditions.add(cellId);
      }
      storage.sortedActiveLeafIdsDirty = storage.activeLeafAdditions.size > 0
        || storage.activeLeafRemovals.size > 0;
      for (const [key, owners] of ownerUpdates) {
        const baseOwners = baseSession.activeLeafIdsByNodeKey.get(key) ?? [];
        if (sameCellIds(owners, baseOwners)) {
          storage.ownerOverridesByNodeKey.delete(key);
        } else {
          storage.ownerOverridesByNodeKey.set(key, owners);
        }
      }
    },
    removeActiveLeaf(cellId) {
      const cell = requiredCell(baseSession, storage, cellId);
      const wasActive = hasActiveLeaf(cellId);
      if (!wasActive) return;
      const validation = activeNodeKeys(baseSession, storage, options, cell);
      const ownerUpdates = new Map<string, CellId[]>();
      for (const key of validation.keys) {
        const owners = storage.ownerOverridesByNodeKey.get(key)
          ?? baseSession.activeLeafIdsByNodeKey.get(key)
          ?? [];
        const baseOwners = baseSession.activeLeafIdsByNodeKey.get(key) ?? [];
        ownerUpdates.set(
          key,
          canonicalOwnerIds(
            owners.filter((ownerId) => ownerId !== cellId),
            baseOwners
          )
        );
      }

      recordActiveReferences(cellId, validation.referencedBaseNodeIds);
      if (baseSession.activeLeafIds.has(cellId)) {
        storage.activeLeafRemovals.add(cellId);
      } else {
        storage.activeLeafAdditions.delete(cellId);
      }
      storage.sortedActiveLeafIdsDirty = storage.activeLeafAdditions.size > 0
        || storage.activeLeafRemovals.size > 0;
      for (const [key, owners] of ownerUpdates) {
        const baseOwners = baseSession.activeLeafIdsByNodeKey.get(key) ?? [];
        if (sameCellIds(owners, baseOwners)) {
          storage.ownerOverridesByNodeKey.delete(key);
        } else {
          storage.ownerOverridesByNodeKey.set(key, owners);
        }
      }
    },
    prepareActiveLeafBatch,
    commitActiveLeafBatch,
    allocateCellOrdinal() {
      const ordinal = storage.nextCellOrdinal;
      storage.nextCellOrdinal += 1;
      return ordinal;
    },
    setNextCommandId(value) {
      storage.nextCommandId = value;
    },
    undoCommands() {
      const commands: RefinementSessionCommand[] = [];
      const baseCommandCount =
        refinementSessionStateOrdinaryArrayLengthInternal(
          baseSession.undoStack,
          "overlay reader base undo commands"
        );
      for (let index = 0; index < baseCommandCount; index += 1) {
        TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, commands, [
          refinementSessionStateOrdinaryArrayValueInternal(
            baseSession.undoStack,
            index,
            "overlay reader base undo commands"
          )
        ]);
      }
      const appendedCommandCount =
        refinementSessionStateOrdinaryArrayLengthInternal(
          storage.appendedUndoCommands,
          "overlay reader appended undo commands"
        );
      for (let index = 0; index < appendedCommandCount; index += 1) {
        TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, commands, [
          refinementSessionStateOrdinaryArrayValueInternal(
            storage.appendedUndoCommands,
            index,
            "overlay reader appended undo commands"
          )
        ]);
      }
      return commands;
    },
    redoCommands() {
      const commands: RefinementSessionCommand[] = [];
      if (storage.clearRedo) return commands;
      const commandCount = refinementSessionStateOrdinaryArrayLengthInternal(
        baseSession.redoStack,
        "overlay reader redo commands"
      );
      for (let index = 0; index < commandCount; index += 1) {
        TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, commands, [
          refinementSessionStateOrdinaryArrayValueInternal(
            baseSession.redoStack,
            index,
            "overlay reader redo commands"
          )
        ]);
      }
      return commands;
    },
    appendUndoCommand(command) {
      const ownedCommand = cloneCommand(command, "overlay appended undo command");
      storage.appendedUndoCommands.push(ownedCommand);
    },
    clearRedoCommands() {
      storage.clearRedo = true;
    }
  };
  registerRefinementSessionStateReferencePublisherInternal(overlay, {
    validateAndPublish(batch) {
      assertRegisteredPlanningStorage();
      const referencedBaseCellIds = assertOrdinarySet(
        registeredPlanningStorage.referencedBaseCellIds,
        "overlay referenced base cell ids"
      ) as Set<CellId>;
      const referencedBaseNodeIds = assertOrdinarySet(
        registeredPlanningStorage.referencedBaseNodeIds,
        "overlay referenced base node ids"
      ) as Set<number>;
      const createdCells = assertOrdinaryMap(
        registeredPlanningStorage.createdCells,
        "overlay created cells"
      );
      const cellOverrides = assertOrdinaryMap(
        registeredPlanningStorage.cellOverrides,
        "overlay cell overrides"
      );
      const activeLeafAdditions = assertOrdinarySet(
        registeredPlanningStorage.activeLeafAdditions,
        "overlay active leaf additions"
      ) as Set<CellId>;
      const activeLeafRemovals = assertOrdinarySet(
        registeredPlanningStorage.activeLeafRemovals,
        "overlay active leaf removals"
      ) as Set<CellId>;
      const ownerOverridesByNodeKey = assertOrdinaryMap(
        registeredPlanningStorage.ownerOverridesByNodeKey,
        "overlay owner overrides"
      );
      const baseCells = assertOrdinaryMap(
        registeredPlanningStorage.baseCells,
        "overlay base cells"
      );
      const baseActiveLeafIds = assertOrdinarySet(
        registeredPlanningStorage.baseActiveLeafIds,
        "overlay base active leaf ids"
      ) as Set<CellId>;
      const baseOwnersByNodeKey = assertOrdinaryMap(
        registeredPlanningStorage.baseActiveLeafIdsByNodeKey,
        "overlay base active owners"
      );
      const appendedNodeCount =
        refinementSessionStateOrdinaryArrayLengthInternal(
          registeredPlanningStorage.appendedNodes,
          "overlay appended nodes"
        );
      if (
        batch.baseSession !== baseSession
        || batch.revision !== storageData("baseRevision")
        || batch.kind !== baseSessionData("kind")
        || batch.nodeCount
          !== (storageData("baseNodeCount") as number) + appendedNodeCount
        || batch.cellCount
          !== (storageData("baseCellCount") as number) + mapSize(createdCells)
        || batch.activeLeafCount
          !== (storageData("baseActiveLeafCount") as number)
            - setSize(activeLeafRemovals)
            + setSize(activeLeafAdditions)
        || batch.nextCommandId !== storageData("nextCommandId")
        || batch.nextCellOrdinal !== storageData("nextCellOrdinal")
        || batch.sortedActiveLeafIdsDirty
          !== ((storageData("sortedActiveLeafIdsDirty") as boolean)
            || (storageData("baseSortedActiveLeafIdsDirty") as boolean))
      ) {
        throw new Error(
          "refinement session state counters changed during planning"
        );
      }
      const cellIds: CellId[] = [];
      const nodeIds: number[] = [];
      const cellExpectationCount =
        refinementSessionStateOrdinaryArrayLengthInternal(
          batch.cells,
          "overlay planning cells"
        );
      for (let index = 0; index < cellExpectationCount; index += 1) {
        const expected = refinementSessionStateOrdinaryArrayValueInternal(
          batch.cells,
          index,
          "overlay planning cells"
        ) as (typeof batch.cells)[number];
        const cell = (mapGet(createdCells, expected.cellId)
          ?? mapGet(cellOverrides, expected.cellId)
          ?? mapGet(baseCells, expected.cellId)) as
            RefinementSessionCell | undefined;
        if (
          cell === undefined
          || cell !== expected.identity
          || refinementSessionStateCellFingerprintInternal(
            expected.cellId,
            cell
          ) !== expected.fingerprint
        ) {
          throw new Error(
            `refinement session state cell ${expected.cellId} changed during planning`
          );
        }
        if (
          mapHas(baseCells, expected.cellId)
          && !setHas(referencedBaseCellIds, expected.cellId)
        ) {
          TRUSTED_REFLECT_APPLY(
            TRUSTED_ARRAY_PUSH,
            cellIds,
            [expected.cellId]
          );
        }
      }
      const nodeExpectationCount =
        refinementSessionStateOrdinaryArrayLengthInternal(
          batch.nodes,
          "overlay planning nodes"
        );
      for (let index = 0; index < nodeExpectationCount; index += 1) {
        const expected = refinementSessionStateOrdinaryArrayValueInternal(
          batch.nodes,
          index,
          "overlay planning nodes"
        ) as (typeof batch.nodes)[number];
        const baseNodeCount = storageData("baseNodeCount") as number;
        const point = expected.nodeId >= 1
          && expected.nodeId <= baseNodeCount
          ? refinementSessionStateOrdinaryArrayValueInternal(
            registeredPlanningStorage.baseNodes,
            expected.nodeId - 1,
            "overlay base nodes"
          )
          : refinementSessionStateOrdinaryArrayValueInternal(
            registeredPlanningStorage.appendedNodes,
            expected.nodeId - baseNodeCount - 1,
            "overlay appended nodes"
          );
        if (
          point === undefined
          || point !== expected.identity
          || refinementSessionStateNodeFingerprintInternal(point as Point)
            !== expected.fingerprint
        ) {
          throw new Error(
            `refinement session state node ${expected.nodeId} changed during planning`
          );
        }
        if (
          TRUSTED_NUMBER_IS_SAFE_INTEGER(expected.nodeId)
          && expected.nodeId >= 1
          && expected.nodeId <= baseNodeCount
          && !setHas(referencedBaseNodeIds, expected.nodeId)
        ) {
          TRUSTED_REFLECT_APPLY(
            TRUSTED_ARRAY_PUSH,
            nodeIds,
            [expected.nodeId]
          );
        }
      }
      const membershipExpectationCount =
        refinementSessionStateOrdinaryArrayLengthInternal(
          batch.activeMembership,
          "overlay planning active membership"
        );
      for (let index = 0; index < membershipExpectationCount; index += 1) {
        const expected = refinementSessionStateOrdinaryArrayValueInternal(
          batch.activeMembership,
          index,
          "overlay planning active membership"
        ) as (typeof batch.activeMembership)[number];
        const active = setHas(activeLeafAdditions, expected.cellId)
          || (!setHas(activeLeafRemovals, expected.cellId)
            && setHas(baseActiveLeafIds, expected.cellId));
        if (active !== expected.active) {
          throw new Error(
            `refinement session state active membership for ${expected.cellId} changed during planning`
          );
        }
      }
      const activeLeafIds: CellId[] = [];
      const baseActiveIds = setValues(baseActiveLeafIds);
      const baseActiveIdCount =
        refinementSessionStateOrdinaryArrayLengthInternal(
          baseActiveIds,
          "overlay base active ids"
        );
      for (let index = 0; index < baseActiveIdCount; index += 1) {
        const cellId = refinementSessionStateOrdinaryArrayValueInternal(
          baseActiveIds,
          index,
          "overlay base active ids"
        ) as CellId;
        if (!setHas(activeLeafRemovals, cellId)) {
          TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, activeLeafIds, [cellId]);
        }
      }
      const addedActiveIds = setValues(activeLeafAdditions);
      const addedActiveIdCount =
        refinementSessionStateOrdinaryArrayLengthInternal(
          addedActiveIds,
          "overlay added active ids"
        );
      for (let index = 0; index < addedActiveIdCount; index += 1) {
        const cellId = refinementSessionStateOrdinaryArrayValueInternal(
          addedActiveIds,
          index,
          "overlay added active ids"
        ) as CellId;
        TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, activeLeafIds, [cellId]);
      }
      assertRefinementSessionStateCellIdsEqualInternal(
        activeLeafIds,
        batch.activeLeafIds,
        "active leaf iteration"
      );
      const ownerExpectationCount =
        refinementSessionStateOrdinaryArrayLengthInternal(
          batch.ownersByNodeKey,
          "overlay planning owners"
        );
      for (let index = 0; index < ownerExpectationCount; index += 1) {
        const expected = refinementSessionStateOrdinaryArrayValueInternal(
          batch.ownersByNodeKey,
          index,
          "overlay planning owners"
        ) as (typeof batch.ownersByNodeKey)[number];
        const owners = (mapGet(ownerOverridesByNodeKey, expected.key)
          ?? mapGet(baseOwnersByNodeKey, expected.key)
          ?? undefined) as readonly CellId[] | undefined;
        if (owners !== undefined && owners !== expected.identity) {
          throw new Error(
            `refinement session state owner mapping ${expected.key} changed during planning`
          );
        }
        assertRefinementSessionStateCellIdsEqualInternal(
          owners ?? [],
          expected.owners,
          `owner mapping ${expected.key}`
        );
      }
      assertRegisteredPlanningStorage();
      const publishCellReferences = assertOrdinarySet(
        registeredPlanningStorage.referencedBaseCellIds,
        "overlay referenced base cell ids"
      );
      const publishNodeReferences = assertOrdinarySet(
        registeredPlanningStorage.referencedBaseNodeIds,
        "overlay referenced base node ids"
      );
      if (
        publishCellReferences !== referencedBaseCellIds
        || publishNodeReferences !== referencedBaseNodeIds
      ) {
        throw new Error(
          "refinement session state reference targets changed during planning"
        );
      }
      const cellReferenceCount =
        refinementSessionStateOrdinaryArrayLengthInternal(
          cellIds,
          "overlay cell references"
        );
      for (let index = 0; index < cellReferenceCount; index += 1) {
        TRUSTED_REFLECT_APPLY(
          TRUSTED_SET_ADD,
          publishCellReferences,
          [refinementSessionStateOrdinaryArrayValueInternal(
            cellIds,
            index,
            "overlay cell references"
          )]
        );
      }
      const nodeReferenceCount =
        refinementSessionStateOrdinaryArrayLengthInternal(
          nodeIds,
          "overlay node references"
        );
      for (let index = 0; index < nodeReferenceCount; index += 1) {
        TRUSTED_REFLECT_APPLY(
          TRUSTED_SET_ADD,
          publishNodeReferences,
          [refinementSessionStateOrdinaryArrayValueInternal(
            nodeIds,
            index,
            "overlay node references"
          )]
        );
      }
    }
  });
  registerOverlayHistoryCheckpointOwner(
    overlay,
    storage,
    baseSession,
    baseline
  );
  return overlay;
}

export function createRefinementSessionOverlay(
  baseSession: RefinementSession,
  options: RefinementSessionOverlayOptions
): RefinementSessionOverlay {
  return createRefinementSessionOverlayWithBaseline(
    baseSession,
    options,
    overlayBaseline(baseSession)
  );
}

export function forkRefinementSessionOverlay(
  parent: RefinementSessionOverlay
): RefinementSessionOverlay {
  const fork = createRefinementSessionOverlayWithBaseline(parent.baseSession, parent.options, parent.storage);
  const source = parent.storage;
  const target = fork.storage;
  for (const [cellId, cell] of source.cellOverrides) {
    target.cellOverrides.set(cellId, cloneCell(cell));
  }
  for (const [cellId, cell] of source.createdCells) {
    target.createdCells.set(cellId, cloneCell(cell));
  }
  target.appendedNodes.push(...source.appendedNodes.map((point) => [...point] as Point));
  for (const cellId of source.activeLeafAdditions) target.activeLeafAdditions.add(cellId);
  for (const cellId of source.activeLeafRemovals) target.activeLeafRemovals.add(cellId);
  for (const [key, owners] of source.ownerOverridesByNodeKey) {
    target.ownerOverridesByNodeKey.set(key, [...owners]);
  }
  target.sortedActiveLeafIdsDirty = source.sortedActiveLeafIdsDirty;
  target.appendedUndoCommands.push(...source.appendedUndoCommands);
  target.clearRedo = source.clearRedo;
  target.nextCommandId = source.nextCommandId;
  target.nextCellOrdinal = source.nextCellOrdinal;
  for (const cellId of source.referencedBaseCellIds) target.referencedBaseCellIds.add(cellId);
  for (const nodeId of source.referencedBaseNodeIds) target.referencedBaseNodeIds.add(nodeId);
  return fork;
}

export function refinementSessionOverlayStats(
  overlay: RefinementSessionOverlay
): RefinementSessionOverlayStats {
  const storage = overlay.storage;
  return {
    copiedBaseCellCount: storage.cellOverrides.size,
    createdCellCount: storage.createdCells.size,
    appendedNodeCount: storage.appendedNodes.length,
    activeLeafAdditionCount: storage.activeLeafAdditions.size,
    activeLeafRemovalCount: storage.activeLeafRemovals.size,
    copiedNodeOwnerKeyCount: storage.ownerOverridesByNodeKey.size,
    referencedBaseCellCount: storage.referencedBaseCellIds.size,
    referencedBaseNodeCount: storage.referencedBaseNodeIds.size
  };
}
