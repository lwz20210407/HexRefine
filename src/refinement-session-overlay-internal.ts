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
    addActiveLeaf() {
      throw new Error("active overlay updates are not implemented");
    },
    removeActiveLeaf() {
      throw new Error("active overlay updates are not implemented");
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
