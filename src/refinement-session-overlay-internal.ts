import type { Point } from "./types.js";
import type {
  CellId,
  RefinementSession,
  RefinementSessionCell,
  RefinementSessionCommand
} from "./refinement-session.js";
import type {
  MutableRefinementSessionCell,
  RefinementSessionStateWriter
} from "./refinement-session-state-internal.js";

const TRUSTED_ARRAY_PUSH = Array.prototype.push;
const TRUSTED_FUNCTION_CALL = Function.prototype.call;
const TRUSTED_REFLECT_APPLY = Reflect.apply;
const TRUSTED_OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const TRUSTED_MAP_GET = Map.prototype.get;
const TRUSTED_MAP_HAS = Map.prototype.has;
const TRUSTED_MAP_SET = Map.prototype.set;
const TRUSTED_MAP_DELETE = Map.prototype.delete;
const TRUSTED_MAP_ENTRIES = Map.prototype.entries;
const TRUSTED_SET_HAS = Set.prototype.has;
const TRUSTED_SET_ADD = Set.prototype.add;
const TRUSTED_SET_DELETE = Set.prototype.delete;
const TRUSTED_SET_VALUES = Set.prototype.values;

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

interface OverlayStorage {
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

interface BaseHistoryGuard {
  /** This is a guard reference, not delta-owned data. */
  readonly command: RefinementSessionCommand;
  readonly fingerprint: string;
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
  readonly baseUndoGuards: readonly BaseHistoryGuard[];
  readonly baseRedoGuards: readonly BaseHistoryGuard[];
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
  readonly clearRedo: boolean;
  readonly sortedActiveLeafIdsDirty: boolean;
  readonly nextCommandId: number;
  readonly nextCellOrdinal: number;
  readonly nextRevision: number;
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

function assertOrdinaryArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || TRUSTED_OBJECT_GET_PROTOTYPE_OF(value) !== Array.prototype) {
    overlayDeltaError(`${label} must use the ordinary Array prototype`);
  }
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
  if (value === null || typeof value !== "object" || TRUSTED_OBJECT_GET_PROTOTYPE_OF(value) !== Set.prototype) {
    overlayDeltaError(`${label} must use the ordinary Set prototype`);
  }
  return value as Set<unknown>;
}

function mapSize(map: Map<unknown, unknown>): number {
  return Reflect.get(Map.prototype, "size", map) as number;
}

function setSize(set: Set<unknown>): number {
  return Reflect.get(Set.prototype, "size", set) as number;
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

function plainDataFingerprint(value: unknown, label: string): string {
  if (isPlainPrimitive(value)) return primitiveToken(value);
  if (Array.isArray(value)) {
    const array = assertOrdinaryArray(value, label);
    const values: string[] = [];
    for (let index = 0; index < array.length; index += 1) {
      values.push(plainDataFingerprint(
        ownDataProperty<unknown>(array as object, String(index), label),
        `${label}[${index}]`
      ));
    }
    return `[${values.join(",")}]`;
  }
  const object = assertPlainObject(value, label);
  const values: string[] = [];
  for (const key of Object.getOwnPropertyNames(object).sort(compareCodeUnits)) {
    values.push(`${key.length}:${key}=${plainDataFingerprint(
      ownDataProperty<unknown>(object, key, label),
      `${label}.${key}`
    )}`);
  }
  return `{${values.join(";")}}`;
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
  assertOrdinaryArray(nodes, `${label}.nodes`);
  assertOrdinaryMap(cells, `${label}.cells`);
  assertOrdinarySet(activeLeafIds, `${label}.activeLeafIds`);
  assertOrdinaryArray(sortedActiveLeafIds, `${label}.sortedActiveLeafIds`);
  assertOrdinaryMap(activeLeafIdsByNodeKey, `${label}.activeLeafIdsByNodeKey`);
  assertOrdinaryArray(undoStack, `${label}.undoStack`);
  assertOrdinaryArray(redoStack, `${label}.redoStack`);
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

function snapshotHistoryGuards(
  history: readonly RefinementSessionCommand[],
  label: string
): readonly BaseHistoryGuard[] {
  const array = assertOrdinaryArray(history, label);
  const guards: BaseHistoryGuard[] = [];
  for (let index = 0; index < array.length; index += 1) {
    const command = ownDataProperty<unknown>(array as object, String(index), label);
    guards.push(Object.freeze({
      command: command as RefinementSessionCommand,
      fingerprint: plainDataFingerprint(command, `${label}[${index}]`)
    }));
  }
  return frozenArray(guards);
}

/** Capture an immutable sparse delta without cloning the far field of the base session. */
export function snapshotRefinementSessionOverlayDelta(
  overlay: RefinementSessionOverlay
): RefinementSessionOverlayDelta {
  const baseSession = overlay.baseSession;
  const base = readSessionForOverlay(baseSession, "base session", false);
  const storage = assertPlainObject(overlay.storage, "overlay storage");
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

  const baseCells = base.cells as Map<unknown, unknown>;
  const baseNodes = base.nodes as unknown as readonly unknown[];
  const frozenNodes: Point[] = [];
  for (let index = 0; index < appendedNodes.length; index += 1) {
    frozenNodes.push(freezePlainValue(clonePoint(
      ownDataProperty<Point>(appendedNodes as object, String(index), "overlay storage.appendedNodes"),
      `overlay storage.appendedNodes[${index}]`
    )));
  }
  const maximumNodeId = baseNodes.length + frozenNodes.length;
  const referencedNodeIds = new Set<number>();
  for (const nodeId of TRUSTED_REFLECT_APPLY(TRUSTED_SET_VALUES, referencedBaseNodeIds, []) as Iterable<number>) {
    if (!Number.isSafeInteger(nodeId) || nodeId < 1 || nodeId > baseNodes.length) {
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
    baseNodes.length,
    maximumNodeId,
    referencedNodeIds
  );
  const frozenCreated = snapshotCellEntries(
    createdEntries,
    "overlay storage.createdCells",
    baseCells,
    false,
    baseNodes.length,
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

  const baseOwnerMap = base.activeLeafIdsByNodeKey as Map<unknown, unknown>;
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

  const baseActiveLeaves = base.activeLeafIds as Set<unknown>;
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
    baseRevision: base.revision,
    baseNodes: baseSession.nodes,
    baseCells: baseSession.cells,
    baseActiveLeafIds: baseSession.activeLeafIds,
    baseActiveLeafIdsByNodeKey: baseSession.activeLeafIdsByNodeKey,
    baseSortedActiveLeafIds: baseSession.sortedActiveLeafIds,
    baseUndoStack: baseSession.undoStack,
    baseRedoStack: baseSession.redoStack,
    baseNodeCount: base.nodes.length,
    baseCellCount: mapSize(baseCells),
    baseActiveLeafCount: setSize(baseActiveLeaves),
    baseOwnerKeyCount: mapSize(baseOwnerMap),
    baseSortedActiveLeafCount: base.sortedActiveLeafIds.length,
    baseUndoLength: base.undoStack.length,
    baseRedoLength: base.redoStack.length,
    baseSortedActiveLeafIdsDirty: base.sortedActiveLeafIdsDirty,
    baseNextCommandId: base.nextCommandId,
    baseNextCellOrdinal: ownDataProperty<number | undefined>(baseSession as object, "nextCellOrdinal", "base session"),
    cellOverrides: frozenOverrides,
    createdCells: frozenCreated,
    appendedNodes: frozenArray(frozenNodes),
    activeLeafAdditions: frozenAdditions,
    activeLeafRemovals: frozenRemovals,
    ownerOverrides: frozenArray(frozenOwnerOverrides),
    appendedUndoCommands: frozenArray(frozenCommands),
    clearRedo,
    sortedActiveLeafIdsDirty: storageDirty || base.sortedActiveLeafIdsDirty,
    nextCommandId,
    nextCellOrdinal,
    baseCellGuards: frozenArray(baseCellGuards),
    baseNodeGuards: frozenArray(baseNodeGuards),
    baseOwnerGuards: frozenArray(baseOwnerGuards),
    baseActiveLeafGuards: frozenArray(baseActiveLeafGuards),
    baseUndoGuards: snapshotHistoryGuards(baseSession.undoStack, "base session.undoStack"),
    baseRedoGuards: snapshotHistoryGuards(baseSession.redoStack, "base session.redoStack")
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

function assertBaseHistoryGuards(
  value: unknown,
  history: readonly RefinementSessionCommand[],
  label: string
): void {
  const guards = assertOrdinaryArray(value, label);
  if (guards.length !== history.length) {
    overlayDeltaError(`${label} length changed since the snapshot`);
  }
  for (let index = 0; index < guards.length; index += 1) {
    const guard = assertPlainObject(
      ownDataProperty<unknown>(guards as object, String(index), label),
      `${label}[${index}]`
    );
    const command = ownDataProperty<unknown>(guard, "command", `${label}[${index}]`);
    const fingerprint = ownDataProperty<unknown>(guard, "fingerprint", `${label}[${index}]`);
    const current = ownDataProperty<unknown>(history as object, String(index), `base session.${label}`);
    if (typeof fingerprint !== "string"
      || current !== command
      || plainDataFingerprint(current, `base session.${label}[${index}]`) !== fingerprint) {
      overlayDeltaError(`${label} changed at history slot ${index}`);
    }
  }
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
  assertBaseHistoryGuards(deltaProperty<unknown>(deltaObject, "baseUndoGuards"), target.undoStack, "undo history");
  assertBaseHistoryGuards(deltaProperty<unknown>(deltaObject, "baseRedoGuards"), target.redoStack, "redo history");

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
    clearRedo,
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
    const isBaseNode = nodeId >= 1 && nodeId <= baseSession.nodes.length;
    const point = isBaseNode
      ? baseSession.nodes[nodeId - 1]
      : storage.appendedNodes[nodeId - baseSession.nodes.length - 1];
    if (point === undefined) {
      throw new Error(`active cell ${cell.id} references missing node ${nodeId}`);
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

export function createRefinementSessionOverlay(
  baseSession: RefinementSession,
  options: RefinementSessionOverlayOptions
): RefinementSessionOverlay {
  const storage: OverlayStorage = {
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

  return {
    storage,
    options,
    baseSession,
    get revision() {
      return baseSession.revision;
    },
    get kind() {
      return baseSession.kind;
    },
    get nodeCount() {
      return baseSession.nodes.length + storage.appendedNodes.length;
    },
    get cellCount() {
      return baseSession.cells.size + storage.createdCells.size;
    },
    get activeLeafCount() {
      return baseSession.activeLeafIds.size
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
        || baseSession.sortedActiveLeafIdsDirty;
    },
    node(nodeId) {
      if (nodeId >= 1 && nodeId <= baseSession.nodes.length) {
        storage.referencedBaseNodeIds.add(nodeId);
        return baseSession.nodes[nodeId - 1];
      }
      return storage.appendedNodes[nodeId - baseSession.nodes.length - 1];
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
      return baseSession.nodes.length + storage.appendedNodes.length;
    },
    setCell(cell) {
      if (baseSession.cells.has(cell.id) || storage.createdCells.has(cell.id)) {
        throw new Error(`overlay cannot create duplicate cell ${cell.id}`);
      }
      storage.createdCells.set(cell.id, cell);
    },
    hasActiveLeaf,
    *activeLeafIds() {
      for (const cellId of baseSession.activeLeafIds) {
        if (!storage.activeLeafRemovals.has(cellId)) {
          yield cellId;
        }
      }
      yield* storage.activeLeafAdditions;
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
    allocateCellOrdinal() {
      const ordinal = storage.nextCellOrdinal;
      storage.nextCellOrdinal += 1;
      return ordinal;
    },
    setNextCommandId(value) {
      storage.nextCommandId = value;
    },
    *undoCommands() {
      yield* baseSession.undoStack;
      yield* storage.appendedUndoCommands;
    },
    *redoCommands() {
      if (!storage.clearRedo) {
        yield* baseSession.redoStack;
      }
    },
    appendUndoCommand(command) {
      storage.appendedUndoCommands.push(command);
    },
    clearRedoCommands() {
      storage.clearRedo = true;
    }
  };
}

export function forkRefinementSessionOverlay(
  parent: RefinementSessionOverlay
): RefinementSessionOverlay {
  const fork = createRefinementSessionOverlay(parent.baseSession, parent.options);
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
