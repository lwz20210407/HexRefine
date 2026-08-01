import type { Element, ElementKind, Point } from "./types.js";
import type {
  CellId,
  RefinementSession,
  RefinementSessionCell,
  RefinementSessionCellRole,
  RefinementSessionCommand
} from "./refinement-session.js";

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
  node(nodeId: number): Point | undefined;
  cell(cellId: CellId): RefinementSessionCell | undefined;
  hasActiveLeaf(cellId: CellId): boolean;
  activeLeafIds(): Iterable<CellId>;
  activeOwnersByNodeKey(key: string): readonly CellId[];
  undoCommands(): Iterable<RefinementSessionCommand>;
  redoCommands(): Iterable<RefinementSessionCommand>;
}

export interface RefinementSessionStateWriter extends RefinementSessionStateReader {
  mutableCell(cellId: CellId): MutableRefinementSessionCell;
  appendNode(point: Point): number;
  setCell(cell: MutableRefinementSessionCell): void;
  addActiveLeaf(cellId: CellId): void;
  removeActiveLeaf(cellId: CellId): void;
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

export function createDirectRefinementSessionState(
  session: RefinementSession,
  nodeKey: (point: Point) => string
): RefinementSessionStateWriter {
  const mutable = mutableSession(session);
  return {
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
}
