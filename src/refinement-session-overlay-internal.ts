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

function cloneCell(
  cell: RefinementSessionCell
): MutableRefinementSessionCell {
  return {
    ...cell,
    element: [...cell.element],
    children: [...cell.children]
  };
}

function sameCellIds(left: readonly CellId[], right: readonly CellId[]): boolean {
  return left.length === right.length && left.every((cellId, index) => cellId === right[index]);
}

function activeNodeKeys(
  baseSession: RefinementSession,
  storage: OverlayStorage,
  options: RefinementSessionOverlayOptions,
  cell: RefinementSessionCell
): string[] {
  const keys = new Set<string>();
  for (const nodeId of options.cellNodeIds(cell)) {
    const point = nodeId >= 1 && nodeId <= baseSession.nodes.length
      ? baseSession.nodes[nodeId - 1]
      : storage.appendedNodes[nodeId - baseSession.nodes.length - 1];
    if (point === undefined) {
      throw new Error(`active cell ${cell.id} references missing node ${nodeId}`);
    }
    keys.add(options.nodeKey(point));
  }
  return [...keys];
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
    hasActiveLeaf(cellId) {
      if (storage.activeLeafAdditions.has(cellId)) {
        return true;
      }
      if (storage.activeLeafRemovals.has(cellId)) {
        return false;
      }
      return baseSession.activeLeafIds.has(cellId);
    },
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
      const wasActive = this.hasActiveLeaf(cellId);
      if (wasActive) return;
      const keys = activeNodeKeys(baseSession, storage, options, cell);
      const ownerUpdates = new Map<string, CellId[]>();
      for (const key of keys) {
        const owners = storage.ownerOverridesByNodeKey.get(key)
          ?? baseSession.activeLeafIdsByNodeKey.get(key)
          ?? [];
        ownerUpdates.set(key, owners.includes(cellId) ? [...owners] : [...owners, cellId]);
      }

      if (baseSession.activeLeafIds.has(cellId)) {
        storage.activeLeafRemovals.delete(cellId);
      } else {
        storage.activeLeafAdditions.add(cellId);
      }
      storage.sortedActiveLeafIdsDirty = true;
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
      const wasActive = this.hasActiveLeaf(cellId);
      if (!wasActive) return;
      const keys = activeNodeKeys(baseSession, storage, options, cell);
      const ownerUpdates = new Map<string, CellId[]>();
      for (const key of keys) {
        const owners = storage.ownerOverridesByNodeKey.get(key)
          ?? baseSession.activeLeafIdsByNodeKey.get(key)
          ?? [];
        ownerUpdates.set(key, owners.filter((ownerId) => ownerId !== cellId));
      }

      if (baseSession.activeLeafIds.has(cellId)) {
        storage.activeLeafRemovals.add(cellId);
      } else {
        storage.activeLeafAdditions.delete(cellId);
      }
      storage.sortedActiveLeafIdsDirty = true;
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
