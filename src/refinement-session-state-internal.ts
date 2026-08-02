import type { Element, ElementKind, Point } from "./types.js";
import type {
  CellId,
  RefinementSession,
  RefinementSessionCell,
  RefinementSessionCellRole,
  RefinementSessionCommand
} from "./refinement-session.js";

const TRUSTED_ARRAY_IS_ARRAY = Array.isArray;
const TRUSTED_ARRAY_PROTOTYPE = Array.prototype;
const TRUSTED_ARRAY_PUSH = Array.prototype.push;
const TRUSTED_DATA_VIEW_GET_UINT8 = DataView.prototype.getUint8;
const TRUSTED_DATA_VIEW_SET_FLOAT64 = DataView.prototype.setFloat64;
const TRUSTED_MATH_IMUL = Math.imul;
const TRUSTED_NUMBER_TO_STRING = Number.prototype.toString;
const TRUSTED_NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR =
  Object.getOwnPropertyDescriptor;
const TRUSTED_OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const TRUSTED_OBJECT_PROTOTYPE = Object.prototype;
const TRUSTED_REFLECT_APPLY = Reflect.apply;
const TRUSTED_STRING_CHAR_CODE_AT = String.prototype.charCodeAt;
const TRUSTED_STRING_PAD_START = String.prototype.padStart;
const TRUSTED_MAP_SIZE_GETTER = Object.getOwnPropertyDescriptor(
  Map.prototype,
  "size"
)!.get!;
const TRUSTED_MAP_GET = Map.prototype.get;
const TRUSTED_MAP_SET = Map.prototype.set;
const TRUSTED_MAP_DELETE = Map.prototype.delete;
const TRUSTED_SET_HAS = Set.prototype.has;
const TRUSTED_SET_SIZE_GETTER = Object.getOwnPropertyDescriptor(
  Set.prototype,
  "size"
)!.get!;
const TRUSTED_SET_VALUES = Set.prototype.values;
const TRUSTED_SET_ITERATOR_NEXT = Object.getPrototypeOf(
  TRUSTED_REFLECT_APPLY(TRUSTED_SET_VALUES, new Set(), [])
).next as (this: SetIterator<unknown>) => IteratorResult<unknown>;
const TRUSTED_SET_ADD = Set.prototype.add;
const TRUSTED_SET_DELETE = Set.prototype.delete;
const TRUSTED_WEAK_MAP_GET = WeakMap.prototype.get;
const TRUSTED_WEAK_MAP_SET = WeakMap.prototype.set;
const TRUSTED_WEAK_MAP_DELETE = WeakMap.prototype.delete;

export interface MutableRefinementSessionCell {
  id: CellId;
  ordinal: number;
  parentId?: CellId;
  level: number;
  role: RefinementSessionCellRole;
  kind: ElementKind;
  element: Element;
  children: CellId[];
  active: boolean;
  hidden: boolean;
  sourceElementId?: number;
  template?: string;
}

export interface RefinementSessionStateReader {
  readonly baseSession: RefinementSession;
  readonly revision: number;
  readonly kind: ElementKind;
  readonly nodeCount: number;
  readonly cellCount: number;
  readonly activeLeafCount: number;
  readonly nextCommandId: number;
  readonly nextCellOrdinal: number;
  readonly sortedActiveLeafIdsDirty: boolean;
  peekNode(nodeId: number): Point | undefined;
  peekCell(cellId: CellId): RefinementSessionCell | undefined;
  node(nodeId: number): Point | undefined;
  cell(cellId: CellId): RefinementSessionCell | undefined;
  hasActiveLeaf(cellId: CellId): boolean;
  activeLeafIds(): Iterable<CellId>;
  activeOwnersByNodeKey(key: string): readonly CellId[];
  undoCommands(): Iterable<RefinementSessionCommand>;
  redoCommands(): Iterable<RefinementSessionCommand>;
}

export interface RefinementSessionStateCellFingerprintInternal {
  readonly cellId: CellId;
  readonly fingerprint: string;
  readonly identity: RefinementSessionCell;
}

export interface RefinementSessionStateNodeFingerprintInternal {
  readonly nodeId: number;
  readonly fingerprint: string;
  readonly identity: Point;
}

export interface RefinementSessionStateActiveMembershipInternal {
  readonly cellId: CellId;
  readonly active: boolean;
}

export interface RefinementSessionStateOwnerSnapshotInternal {
  readonly key: string;
  readonly owners: readonly CellId[];
  readonly identity: readonly CellId[];
}

export interface RefinementSessionStateReferenceBatchInternal {
  readonly baseSession: RefinementSession;
  readonly revision: number;
  readonly kind: ElementKind;
  readonly nodeCount: number;
  readonly cellCount: number;
  readonly activeLeafCount: number;
  readonly nextCommandId: number;
  readonly nextCellOrdinal: number;
  readonly sortedActiveLeafIdsDirty: boolean;
  readonly cells: readonly RefinementSessionStateCellFingerprintInternal[];
  readonly nodes: readonly RefinementSessionStateNodeFingerprintInternal[];
  readonly activeMembership:
    readonly RefinementSessionStateActiveMembershipInternal[];
  readonly activeLeafIds: readonly CellId[];
  readonly ownersByNodeKey:
    readonly RefinementSessionStateOwnerSnapshotInternal[];
}

export interface RefinementSessionStateReferencePublisherInternal {
  validateAndPublish(batch: RefinementSessionStateReferenceBatchInternal): void;
}

declare const PREPARED_STATE_REFERENCE_BATCH_INTERNAL: unique symbol;

export interface PreparedRefinementSessionStateReferenceBatchInternal {
  readonly [PREPARED_STATE_REFERENCE_BATCH_INTERNAL]: true;
}

interface RegisteredStateReferencePublisher {
  readonly validateAndPublish:
    RefinementSessionStateReferencePublisherInternal["validateAndPublish"];
}

interface PreparedStateReferenceBatch {
  readonly state: RefinementSessionStateReader;
  readonly publisher: RegisteredStateReferencePublisher;
  readonly batch: RefinementSessionStateReferenceBatchInternal;
}

const stateReferencePublishers =
  new WeakMap<RefinementSessionStateReader, RegisteredStateReferencePublisher>();
const preparedStateReferenceBatches =
  new WeakMap<object, PreparedStateReferenceBatch>();

export function registerRefinementSessionStateReferencePublisherInternal(
  state: RefinementSessionStateReader,
  publisher: RefinementSessionStateReferencePublisherInternal
): void {
  if (TRUSTED_REFLECT_APPLY(
    TRUSTED_WEAK_MAP_GET,
    stateReferencePublishers,
    [state]
  ) !== undefined) {
    throw new TypeError("refinement session state reference publisher is already registered");
  }
  TRUSTED_REFLECT_APPLY(
    TRUSTED_WEAK_MAP_SET,
    stateReferencePublishers,
    [state, Object.freeze({ validateAndPublish: publisher.validateAndPublish })]
  );
}

export function assertRefinementSessionStateReferencePublisherInternal(
  state: RefinementSessionStateReader
): void {
  if (TRUSTED_REFLECT_APPLY(
    TRUSTED_WEAK_MAP_GET,
    stateReferencePublishers,
    [state]
  ) === undefined) {
    throw new TypeError(
      "unsupported refinement session state reader: no registered reference publisher"
    );
  }
}

export function prepareRefinementSessionStateReferenceBatchInternal(
  state: RefinementSessionStateReader,
  batch: RefinementSessionStateReferenceBatchInternal
): PreparedRefinementSessionStateReferenceBatchInternal {
  const publisher = TRUSTED_REFLECT_APPLY(
    TRUSTED_WEAK_MAP_GET,
    stateReferencePublishers,
    [state]
  ) as RegisteredStateReferencePublisher | undefined;
  if (publisher === undefined) {
    throw new TypeError(
      "unsupported refinement session state reader: no registered reference publisher"
    );
  }
  const snapshot: RefinementSessionStateReferenceBatchInternal =
    Object.freeze({
      baseSession: batch.baseSession,
      revision: batch.revision,
      kind: batch.kind,
      nodeCount: batch.nodeCount,
      cellCount: batch.cellCount,
      activeLeafCount: batch.activeLeafCount,
      nextCommandId: batch.nextCommandId,
      nextCellOrdinal: batch.nextCellOrdinal,
      sortedActiveLeafIdsDirty: batch.sortedActiveLeafIdsDirty,
      cells: Object.freeze(batch.cells.map((entry) => Object.freeze({
        cellId: entry.cellId,
        fingerprint: entry.fingerprint,
        identity: entry.identity
      }))),
      nodes: Object.freeze(batch.nodes.map((entry) => Object.freeze({
        nodeId: entry.nodeId,
        fingerprint: entry.fingerprint,
        identity: entry.identity
      }))),
      activeMembership: Object.freeze(
        batch.activeMembership.map((entry) => Object.freeze({
          cellId: entry.cellId,
          active: entry.active
        }))
      ),
      activeLeafIds: Object.freeze([...batch.activeLeafIds]),
      ownersByNodeKey: Object.freeze(
        batch.ownersByNodeKey.map((entry) => Object.freeze({
          key: entry.key,
          owners: Object.freeze([...entry.owners]),
          identity: entry.identity
        }))
      )
    });
  const token = Object.freeze({}) as
    PreparedRefinementSessionStateReferenceBatchInternal;
  TRUSTED_REFLECT_APPLY(
    TRUSTED_WEAK_MAP_SET,
    preparedStateReferenceBatches,
    [token, { state, publisher, batch: snapshot }]
  );
  return token;
}

export function commitRefinementSessionStateReferenceBatchInternal(
  state: RefinementSessionStateReader,
  token: PreparedRefinementSessionStateReferenceBatchInternal
): void {
  const prepared = TRUSTED_REFLECT_APPLY(
    TRUSTED_WEAK_MAP_GET,
    preparedStateReferenceBatches,
    [token]
  ) as PreparedStateReferenceBatch | undefined;
  if (prepared === undefined || prepared.state !== state) {
    throw new TypeError("invalid or consumed refinement session state reference batch");
  }
  TRUSTED_REFLECT_APPLY(
    TRUSTED_WEAK_MAP_DELETE,
    preparedStateReferenceBatches,
    [token]
  );
  TRUSTED_REFLECT_APPLY(
    prepared.publisher.validateAndPublish,
    undefined,
    [prepared.batch]
  );
}

class RefinementSessionStateFingerprintInternal {
  private first = 0x811c9dc5;
  private second = 0x9e3779b9;
  private readonly numberBytes = new DataView(new ArrayBuffer(8));

  private addByte(value: number): void {
    this.first = TRUSTED_MATH_IMUL(this.first ^ value, 0x01000193) >>> 0;
    this.second = TRUSTED_MATH_IMUL(this.second ^ value, 0x85ebca6b) >>> 0;
  }

  private addUint32(value: number): void {
    for (let shift = 24; shift >= 0; shift -= 8) {
      this.addByte((value >>> shift) & 0xff);
    }
  }

  add(value: unknown): void {
    if (value === undefined) {
      this.addByte(0);
    } else if (typeof value === "boolean") {
      this.addByte(value ? 3 : 2);
    } else if (typeof value === "number") {
      this.addByte(4);
      TRUSTED_REFLECT_APPLY(
        TRUSTED_DATA_VIEW_SET_FLOAT64,
        this.numberBytes,
        [0, value, false]
      );
      for (let index = 0; index < 8; index += 1) {
        this.addByte(TRUSTED_REFLECT_APPLY(
          TRUSTED_DATA_VIEW_GET_UINT8,
          this.numberBytes,
          [index]
        ) as number);
      }
    } else if (typeof value === "string") {
      this.addByte(5);
      this.addUint32(value.length);
      for (let index = 0; index < value.length; index += 1) {
        this.addUint32(TRUSTED_REFLECT_APPLY(
          TRUSTED_STRING_CHAR_CODE_AT,
          value,
          [index]
        ) as number);
      }
    } else if (TRUSTED_ARRAY_IS_ARRAY(value)) {
      this.addByte(6);
      this.addUint32(value.length);
      for (let index = 0; index < value.length; index += 1) {
        this.add(value[index]);
      }
    } else {
      throw new TypeError(
        `unsupported refinement state fingerprint value: ${typeof value}`
      );
    }
  }

  digest(): string {
    const first = TRUSTED_REFLECT_APPLY(
      TRUSTED_NUMBER_TO_STRING,
      this.first,
      [16]
    ) as string;
    const second = TRUSTED_REFLECT_APPLY(
      TRUSTED_NUMBER_TO_STRING,
      this.second,
      [16]
    ) as string;
    return `${TRUSTED_REFLECT_APPLY(
      TRUSTED_STRING_PAD_START,
      first,
      [8, "0"]
    )}${TRUSTED_REFLECT_APPLY(
      TRUSTED_STRING_PAD_START,
      second,
      [8, "0"]
    )}`;
  }
}

function refinementSessionStateFingerprintInternal(value: unknown): string {
  const fingerprint = new RefinementSessionStateFingerprintInternal();
  fingerprint.add(value);
  return fingerprint.digest();
}

export function refinementSessionStateOwnDataValueInternal(
  value: object,
  key: PropertyKey,
  label: string
): unknown {
  const descriptor = TRUSTED_REFLECT_APPLY(
    TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR,
    undefined,
    [value, key]
  ) as PropertyDescriptor | undefined;
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError(
      `refinement session state ${label} must be an own data property`
    );
  }
  return descriptor.value;
}

export function assertRefinementSessionStateOwnDataIdentityInternal(
  owner: object,
  key: PropertyKey,
  expected: unknown,
  label: string
): void {
  if (refinementSessionStateOwnDataValueInternal(owner, key, label) !== expected) {
    throw new Error(`refinement session state ${label} changed during planning`);
  }
}

function refinementSessionStateMapSizeInternal(map: Map<unknown, unknown>): number {
  return TRUSTED_REFLECT_APPLY(TRUSTED_MAP_SIZE_GETTER, map, []) as number;
}

function refinementSessionStateSetSizeInternal(set: Set<unknown>): number {
  return TRUSTED_REFLECT_APPLY(TRUSTED_SET_SIZE_GETTER, set, []) as number;
}

function refinementSessionStateSetValuesInternal<T>(set: Set<T>): T[] {
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

function refinementSessionStateOrdinaryArraySnapshotInternal(
  value: unknown,
  label: string
): unknown[] {
  const length = refinementSessionStateOrdinaryArrayLengthInternal(
    value,
    label
  );
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const entry = refinementSessionStateOwnDataValueInternal(
      value as object,
      index,
      `${label}[${index}]`
    );
    TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, snapshot, [entry]);
  }
  return snapshot;
}

export function refinementSessionStateOrdinaryArrayLengthInternal(
  value: unknown,
  label: string
): number {
  if (
    !TRUSTED_ARRAY_IS_ARRAY(value)
    || TRUSTED_REFLECT_APPLY(
      TRUSTED_OBJECT_GET_PROTOTYPE_OF,
      undefined,
      [value]
    ) !== TRUSTED_ARRAY_PROTOTYPE
  ) {
    throw new TypeError(
      `refinement session state ${label} must be an ordinary Array`
    );
  }
  const length = refinementSessionStateOwnDataValueInternal(
    value as object,
    "length",
    `${label}.length`
  );
  if (!TRUSTED_NUMBER_IS_SAFE_INTEGER(length) || (length as number) < 0) {
    throw new TypeError(
      `refinement session state ${label}.length must be a safe non-negative integer`
    );
  }
  return length as number;
}

export function refinementSessionStateOrdinaryArrayValueInternal(
  value: unknown,
  index: number,
  label: string
): unknown {
  const length = refinementSessionStateOrdinaryArrayLengthInternal(
    value,
    label
  );
  if (!TRUSTED_NUMBER_IS_SAFE_INTEGER(index) || index < 0 || index >= length) {
    return undefined;
  }
  return refinementSessionStateOwnDataValueInternal(
    value as object,
    index,
    `${label}[${index}]`
  );
}

function refinementSessionStateCellDataInternal(
  cell: RefinementSessionCell,
  label: string
): readonly unknown[] {
  if (
    cell === null
    || typeof cell !== "object"
    || TRUSTED_REFLECT_APPLY(
      TRUSTED_OBJECT_GET_PROTOTYPE_OF,
      undefined,
      [cell]
    ) !== TRUSTED_OBJECT_PROTOTYPE
  ) {
    throw new TypeError(
      `refinement session state ${label} must be an ordinary Object`
    );
  }
  const required = (key: PropertyKey): unknown =>
    refinementSessionStateOwnDataValueInternal(cell, key, `${label}.${String(key)}`);
  const optional = (key: PropertyKey): unknown => {
    const descriptor = TRUSTED_REFLECT_APPLY(
      TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR,
      undefined,
      [cell, key]
    ) as PropertyDescriptor | undefined;
    if (descriptor === undefined) return undefined;
    if (!("value" in descriptor)) {
      throw new TypeError(
        `refinement session state ${label}.${String(key)} must be an own data property`
      );
    }
    return descriptor.value;
  };
  return [
    required("id"),
    required("ordinal"),
    optional("parentId"),
    required("level"),
    required("role"),
    required("kind"),
    refinementSessionStateOrdinaryArraySnapshotInternal(
      required("element"),
      `${label}.element`
    ),
    refinementSessionStateOrdinaryArraySnapshotInternal(
      required("children"),
      `${label}.children`
    ),
    required("active"),
    required("hidden"),
    optional("sourceElementId"),
    optional("template")
  ];
}

export function refinementSessionStateCellFingerprintInternal(
  cellId: CellId,
  cell: RefinementSessionCell
): string {
  return refinementSessionStateFingerprintInternal([
    cellId,
    ...refinementSessionStateCellDataInternal(cell, `cell ${cellId}`)
  ]);
}

export function refinementSessionStateNodeFingerprintInternal(
  point: Point
): string {
  return refinementSessionStateFingerprintInternal(
    refinementSessionStateOrdinaryArraySnapshotInternal(point, "node")
  );
}

export function assertRefinementSessionStateCellIdsEqualInternal(
  actual: readonly CellId[],
  expected: readonly CellId[],
  label: string
): void {
  const actualSnapshot = refinementSessionStateOrdinaryArraySnapshotInternal(
    actual,
    label
  );
  const expectedSnapshot = refinementSessionStateOrdinaryArraySnapshotInternal(
    expected,
    `expected ${label}`
  );
  if (actualSnapshot.length !== expectedSnapshot.length) {
    throw new Error(`refinement session state ${label} changed during planning`);
  }
  for (let index = 0; index < actualSnapshot.length; index += 1) {
    if (actualSnapshot[index] !== expectedSnapshot[index]) {
      throw new Error(`refinement session state ${label} changed during planning`);
    }
  }
}

export interface RefinementSessionActiveLeafBatchInternal {
  readonly additions: readonly RefinementSessionCell[];
  readonly removals: readonly CellId[];
  readonly appendedNodes: readonly Point[];
}

declare const PREPARED_ACTIVE_LEAF_BATCH_INTERNAL: unique symbol;

export interface PreparedRefinementSessionActiveLeafBatchInternal {
  readonly [PREPARED_ACTIVE_LEAF_BATCH_INTERNAL]: true;
}

export interface RefinementSessionStateWriter extends RefinementSessionStateReader {
  mutableCell(cellId: CellId): MutableRefinementSessionCell;
  appendNode(point: Point): number;
  setCell(cell: MutableRefinementSessionCell): void;
  addActiveLeaf(cellId: CellId): void;
  removeActiveLeaf(cellId: CellId): void;
  prepareActiveLeafBatch(
    batch: RefinementSessionActiveLeafBatchInternal
  ): PreparedRefinementSessionActiveLeafBatchInternal;
  commitActiveLeafBatch(
    prepared: PreparedRefinementSessionActiveLeafBatchInternal
  ): void;
  allocateCellOrdinal(): number;
  setNextCommandId(value: number): void;
  appendUndoCommand(command: RefinementSessionCommand): void;
  clearRedoCommands(): void;
}

interface MutableSessionShape {
  nodes: Point[];
  cells: Map<CellId, MutableRefinementSessionCell>;
  activeLeafIds: Set<CellId>;
  activeLeafIdsByNodeKey: Map<string, CellId[]>;
  undoStack: RefinementSessionCommand[];
  redoStack: RefinementSessionCommand[];
  nextCommandId: number;
  nextCellOrdinal: number;
  sortedActiveLeafIdsDirty: boolean;
}

function mutableSession(session: RefinementSession): MutableSessionShape {
  return session as unknown as MutableSessionShape;
}

function requiredMutableCell(
  session: RefinementSession,
  cellId: CellId
): MutableRefinementSessionCell {
  const cell = mutableSession(session).cells.get(cellId);
  if (cell === undefined) {
    throw new Error(`unknown refinement cell ${cellId}`);
  }
  return cell;
}

function activeNodeKeys(
  session: RefinementSession,
  cell: MutableRefinementSessionCell,
  nodeKey: (point: Point) => string
): Iterable<string> {
  const keys = new Set<string>();
  for (const nodeId of cell.element) {
    const point = session.nodes[nodeId - 1];
    if (point === undefined) {
      throw new Error(`active cell ${cell.id} references missing node ${nodeId}`);
    }
    keys.add(nodeKey(point));
  }
  return keys;
}

interface DirectPreparedActiveLeafBatch {
  readonly additions: readonly CellId[];
  readonly removals: readonly CellId[];
  readonly ownerUpdates: readonly [string, CellId[]][];
  readonly dirty: boolean;
}

function preparedBatchToken(): PreparedRefinementSessionActiveLeafBatchInternal {
  return Object.freeze({}) as PreparedRefinementSessionActiveLeafBatchInternal;
}

export function createDirectRefinementSessionState(
  session: RefinementSession,
  nodeKey: (point: Point) => string
): RefinementSessionStateWriter {
  const mutable = mutableSession(session);
  const registeredPlanningStorage = Object.freeze({
    nodes: session.nodes,
    cells: session.cells,
    activeLeafIds: session.activeLeafIds,
    activeLeafIdsByNodeKey: session.activeLeafIdsByNodeKey
  });
  const assertRegisteredPlanningStorage = (): void => {
    if (TRUSTED_REFLECT_APPLY(
      TRUSTED_OBJECT_GET_PROTOTYPE_OF,
      undefined,
      [session]
    ) !== TRUSTED_OBJECT_PROTOTYPE) {
      throw new TypeError(
        "refinement session state registered direct storage prototype changed during planning"
      );
    }
    for (const key of [
      "nodes",
      "cells",
      "activeLeafIds",
      "activeLeafIdsByNodeKey"
    ] as const) {
      assertRefinementSessionStateOwnDataIdentityInternal(
        session,
        key,
        registeredPlanningStorage[key],
        `direct session.${key}`
      );
    }
  };
  const sessionData = (key: keyof RefinementSession): unknown =>
    refinementSessionStateOwnDataValueInternal(
      session,
      key,
      `direct session.${String(key)}`
    );
  const preparedActiveLeafBatches =
    new WeakMap<object, DirectPreparedActiveLeafBatch>();
  const state: RefinementSessionStateWriter = {
    baseSession: session,
    get revision() { return session.revision; },
    get kind() { return session.kind; },
    get nodeCount() { return session.nodes.length; },
    get cellCount() { return session.cells.size; },
    get activeLeafCount() { return session.activeLeafIds.size; },
    get nextCommandId() { return session.nextCommandId; },
    get nextCellOrdinal() {
      return mutable.nextCellOrdinal ?? session.cells.size + 1;
    },
    get sortedActiveLeafIdsDirty() { return session.sortedActiveLeafIdsDirty; },
    peekNode: (nodeId) => session.nodes[nodeId - 1],
    peekCell: (cellId) => session.cells.get(cellId),
    node: (nodeId) => session.nodes[nodeId - 1],
    cell: (cellId) => session.cells.get(cellId),
    hasActiveLeaf: (cellId) => session.activeLeafIds.has(cellId),
    activeLeafIds: () => session.activeLeafIds,
    activeOwnersByNodeKey: (key) => session.activeLeafIdsByNodeKey.get(key) ?? [],
    undoCommands: () => session.undoStack,
    redoCommands: () => session.redoStack,
    mutableCell: (cellId) => requiredMutableCell(session, cellId),
    appendNode(point) {
      mutable.nodes.push([...point]);
      return mutable.nodes.length;
    },
    setCell(cell) {
      mutable.cells.set(cell.id, cell);
    },
    addActiveLeaf(cellId) {
      const cell = requiredMutableCell(session, cellId);
      if (mutable.activeLeafIds.has(cellId)) return;
      const keys = activeNodeKeys(session, cell, nodeKey);

      mutable.activeLeafIds.add(cellId);
      mutable.sortedActiveLeafIdsDirty = true;
      for (const key of keys) {
        const owners = mutable.activeLeafIdsByNodeKey.get(key) ?? [];
        if (!owners.includes(cellId)) {
          mutable.activeLeafIdsByNodeKey.set(key, [...owners, cellId]);
        }
      }
    },
    removeActiveLeaf(cellId) {
      const cell = requiredMutableCell(session, cellId);
      if (!mutable.activeLeafIds.has(cellId)) return;
      const keys = activeNodeKeys(session, cell, nodeKey);

      mutable.activeLeafIds.delete(cellId);
      mutable.sortedActiveLeafIdsDirty = true;
      for (const key of keys) {
        const owners = mutable.activeLeafIdsByNodeKey.get(key);
        if (owners === undefined) continue;
        const next = owners.filter((ownerId) => ownerId !== cellId);
        if (next.length === 0) {
          mutable.activeLeafIdsByNodeKey.delete(key);
        } else {
          mutable.activeLeafIdsByNodeKey.set(key, next);
        }
      }
    },
    prepareActiveLeafBatch(batch) {
      const initialNodeCount = session.nodes.length;
      const activeOverrides = new Map<CellId, boolean>();
      const ownerUpdates = new Map<string, CellId[]>();
      const additions: CellId[] = [];
      const removals: CellId[] = [];
      const addedCells = new Map(
        batch.additions.map((cell) => [cell.id, cell])
      );
      const keysForCell = (cell: RefinementSessionCell): string[] => {
        const keys = new Set<string>();
        for (const nodeId of cell.element) {
          const point = nodeId <= initialNodeCount
            ? session.nodes[nodeId - 1]
            : batch.appendedNodes[nodeId - initialNodeCount - 1];
          if (point === undefined) {
            throw new Error(
              `active cell ${cell.id} references missing node ${nodeId}`
            );
          }
          keys.add(nodeKey(point));
        }
        return [...keys];
      };
      const currentOwners = (key: string): readonly CellId[] =>
        ownerUpdates.get(key)
          ?? mutable.activeLeafIdsByNodeKey.get(key)
          ?? [];
      const isActive = (cellId: CellId): boolean =>
        activeOverrides.get(cellId) ?? mutable.activeLeafIds.has(cellId);

      for (const cell of batch.additions) {
        if (isActive(cell.id)) continue;
        const keys = keysForCell(cell);
        activeOverrides.set(cell.id, true);
        additions.push(cell.id);
        for (const key of keys) {
          const owners = currentOwners(key);
          ownerUpdates.set(
            key,
            owners.includes(cell.id) ? [...owners] : [...owners, cell.id]
          );
        }
      }
      for (const cellId of batch.removals) {
        if (!isActive(cellId)) continue;
        const cell = addedCells.get(cellId) ?? requiredMutableCell(session, cellId);
        const keys = keysForCell(cell);
        activeOverrides.set(cellId, false);
        removals.push(cellId);
        for (const key of keys) {
          ownerUpdates.set(
            key,
            currentOwners(key).filter((ownerId) => ownerId !== cellId)
          );
        }
      }

      const token = preparedBatchToken();
      TRUSTED_REFLECT_APPLY(
        TRUSTED_WEAK_MAP_SET,
        preparedActiveLeafBatches,
        [token, {
          additions,
          removals,
          ownerUpdates: [...ownerUpdates],
          dirty: additions.length > 0 || removals.length > 0
        }]
      );
      return token;
    },
    commitActiveLeafBatch(token) {
      const prepared = TRUSTED_REFLECT_APPLY(
        TRUSTED_WEAK_MAP_GET,
        preparedActiveLeafBatches,
        [token]
      ) as DirectPreparedActiveLeafBatch | undefined;
      if (prepared === undefined) {
        throw new TypeError("invalid or consumed active-leaf batch token");
      }
      TRUSTED_REFLECT_APPLY(
        TRUSTED_WEAK_MAP_DELETE,
        preparedActiveLeafBatches,
        [token]
      );
      for (const cellId of prepared.additions) {
        TRUSTED_REFLECT_APPLY(TRUSTED_SET_ADD, mutable.activeLeafIds, [cellId]);
      }
      for (const cellId of prepared.removals) {
        TRUSTED_REFLECT_APPLY(TRUSTED_SET_DELETE, mutable.activeLeafIds, [cellId]);
      }
      for (const [key, owners] of prepared.ownerUpdates) {
        if (owners.length === 0) {
          TRUSTED_REFLECT_APPLY(
            TRUSTED_MAP_DELETE,
            mutable.activeLeafIdsByNodeKey,
            [key]
          );
        } else {
          TRUSTED_REFLECT_APPLY(
            TRUSTED_MAP_SET,
            mutable.activeLeafIdsByNodeKey,
            [key, owners]
          );
        }
      }
      if (prepared.dirty) mutable.sortedActiveLeafIdsDirty = true;
    },
    allocateCellOrdinal() {
      const ordinal = mutable.nextCellOrdinal ?? session.cells.size + 1;
      mutable.nextCellOrdinal = ordinal + 1;
      return ordinal;
    },
    setNextCommandId(value) {
      mutable.nextCommandId = value;
    },
    appendUndoCommand(command) {
      mutable.undoStack.push(command);
    },
    clearRedoCommands() {
      mutable.redoStack = [];
    }
  };
  registerRefinementSessionStateReferencePublisherInternal(state, {
    validateAndPublish(batch) {
      assertRegisteredPlanningStorage();
      const nodeCount = refinementSessionStateOrdinaryArrayLengthInternal(
        registeredPlanningStorage.nodes,
        "direct session nodes"
      );
      if (
        batch.baseSession !== session
        || batch.revision !== sessionData("revision")
        || batch.kind !== sessionData("kind")
        || batch.nodeCount !== nodeCount
        || batch.cellCount !== refinementSessionStateMapSizeInternal(
          registeredPlanningStorage.cells as Map<unknown, unknown>
        )
        || batch.activeLeafCount !== refinementSessionStateSetSizeInternal(
          registeredPlanningStorage.activeLeafIds as Set<unknown>
        )
        || batch.nextCommandId !== sessionData("nextCommandId")
        || batch.nextCellOrdinal
          !== sessionData("nextCellOrdinal")
        || batch.sortedActiveLeafIdsDirty
          !== sessionData("sortedActiveLeafIdsDirty")
      ) {
        throw new Error(
          "refinement session state counters changed during planning"
        );
      }
      for (const expected of batch.cells) {
        const cell = TRUSTED_REFLECT_APPLY(
          TRUSTED_MAP_GET,
          registeredPlanningStorage.cells,
          [expected.cellId]
        ) as RefinementSessionCell | undefined;
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
      }
      for (const expected of batch.nodes) {
        const point = refinementSessionStateOrdinaryArrayValueInternal(
          registeredPlanningStorage.nodes,
          expected.nodeId - 1,
          "direct session nodes"
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
      }
      for (const expected of batch.activeMembership) {
        const active = TRUSTED_REFLECT_APPLY(
          TRUSTED_SET_HAS,
          registeredPlanningStorage.activeLeafIds,
          [expected.cellId]
        ) as boolean;
        if (active !== expected.active) {
          throw new Error(
            `refinement session state active membership for ${expected.cellId} changed during planning`
          );
        }
      }
      assertRefinementSessionStateCellIdsEqualInternal(
        refinementSessionStateSetValuesInternal(
          registeredPlanningStorage.activeLeafIds as Set<CellId>
        ),
        batch.activeLeafIds,
        "active leaf iteration"
      );
      for (const expected of batch.ownersByNodeKey) {
        const owners = TRUSTED_REFLECT_APPLY(
          TRUSTED_MAP_GET,
          registeredPlanningStorage.activeLeafIdsByNodeKey,
          [expected.key]
        ) as readonly CellId[] | undefined;
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
    }
  });
  return state;
}
