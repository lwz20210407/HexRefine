import type { Element, ElementKind, Point } from "./types.js";
import type {
  CellId,
  RefinementSession,
  RefinementSessionCell,
  RefinementSessionCellRole,
  RefinementSessionCommand
} from "./refinement-session.js";

const TRUSTED_REFLECT_APPLY = Reflect.apply;
const TRUSTED_MAP_SET = Map.prototype.set;
const TRUSTED_MAP_DELETE = Map.prototype.delete;
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

export interface RefinementSessionStateReferenceBatchInternal {
  readonly cellIds: readonly CellId[];
  readonly nodeIds: readonly number[];
}

export interface RefinementSessionStateReferencePublisherInternal {
  prepare(batch: RefinementSessionStateReferenceBatchInternal): unknown;
  commit(prepared: unknown): void;
}

declare const PREPARED_STATE_REFERENCE_BATCH_INTERNAL: unique symbol;

export interface PreparedRefinementSessionStateReferenceBatchInternal {
  readonly [PREPARED_STATE_REFERENCE_BATCH_INTERNAL]: true;
}

interface RegisteredStateReferencePublisher {
  readonly prepare: RefinementSessionStateReferencePublisherInternal["prepare"];
  readonly commit: RefinementSessionStateReferencePublisherInternal["commit"];
}

interface PreparedStateReferenceBatch {
  readonly state: RefinementSessionStateReader;
  readonly publisher: RegisteredStateReferencePublisher;
  readonly prepared: unknown;
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
    [state, Object.freeze({
      prepare: publisher.prepare,
      commit: publisher.commit
    })]
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
  const snapshot = Object.freeze({
    cellIds: Object.freeze([...batch.cellIds]),
    nodeIds: Object.freeze([...batch.nodeIds])
  });
  const prepared = TRUSTED_REFLECT_APPLY(
    publisher.prepare,
    undefined,
    [snapshot]
  );
  const token = Object.freeze({}) as
    PreparedRefinementSessionStateReferenceBatchInternal;
  TRUSTED_REFLECT_APPLY(
    TRUSTED_WEAK_MAP_SET,
    preparedStateReferenceBatches,
    [token, { state, publisher, prepared }]
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
    prepared.publisher.commit,
    undefined,
    [prepared.prepared]
  );
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
    prepare() {
      return undefined;
    },
    commit() {}
  });
  return state;
}
