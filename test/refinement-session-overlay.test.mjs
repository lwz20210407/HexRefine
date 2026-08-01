import assert from "node:assert/strict";
import test from "node:test";

import { createHexUnitCubeMesh, createRefinementSession } from "../dist/index.js";
import {
  createRefinementSessionOverlay,
  forkRefinementSessionOverlay,
  refinementSessionOverlayStats
} from "../dist/refinement-session-overlay-internal.js";
import { createDirectRefinementSessionState } from "../dist/refinement-session-state-internal.js";

function exactNodeKey(point) {
  const coordinates = point.map((coordinate) =>
    Object.is(coordinate, -0) ? 0 : coordinate
  );
  return `${point.length}|${coordinates.join(":")}`;
}

function activeStateSnapshot(session) {
  return {
    activeLeafIds: [...session.activeLeafIds],
    activeLeafIdsByNodeKey: [...session.activeLeafIdsByNodeKey].map(([key, ownerIds]) => [
      key,
      [...ownerIds]
    ]),
    sortedActiveLeafIdsDirty: session.sortedActiveLeafIdsDirty
  };
}

function cloneCell(cell, id, ordinal) {
  return {
    ...cell,
    id,
    ordinal,
    element: [...cell.element],
    children: [...cell.children]
  };
}

function createTestOverlay(session) {
  return createRefinementSessionOverlay(session, {
    nodeKey: exactNodeKey,
    cellNodeIds: (cell) => cell.element
  });
}

test("overlay pure reads copy nothing and first write clones one base cell", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(3, 3, 3));
  const overlay = createTestOverlay(session);
  const baseCell = session.cells.get("e14");

  assert.ok(baseCell);
  assert.strictEqual(overlay.cell("e14"), baseCell);
  assert.deepEqual(refinementSessionOverlayStats(overlay), {
    copiedBaseCellCount: 0,
    createdCellCount: 0,
    appendedNodeCount: 0,
    activeLeafAdditionCount: 0,
    activeLeafRemovalCount: 0,
    copiedNodeOwnerKeyCount: 0,
    referencedBaseCellCount: 1,
    referencedBaseNodeCount: 0
  });

  const mutable = overlay.mutableCell("e14");
  assert.notStrictEqual(mutable, baseCell);
  assert.notStrictEqual(mutable.element, baseCell.element);
  assert.notStrictEqual(mutable.children, baseCell.children);
  mutable.hidden = true;
  assert.equal(overlay.cell("e14")?.hidden, true);
  assert.equal(session.cells.get("e14")?.hidden, false);
  assert.strictEqual(overlay.mutableCell("e14"), mutable);
  assert.equal(refinementSessionOverlayStats(overlay).copiedBaseCellCount, 1);
});

test("overlay appends deterministic nodes without copying base points", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  const first = overlay.appendNode([0.25, 0.25, 0.25]);
  const second = overlay.appendNode([0.75, 0.75, 0.75]);

  assert.equal(first, session.nodes.length + 1);
  assert.equal(second, session.nodes.length + 2);
  assert.deepEqual(overlay.node(second), [0.75, 0.75, 0.75]);
  assert.strictEqual(overlay.node(1), session.nodes[0]);
});

test("overlay appendNode isolates retained mutable input", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  const point = [0.25, 0.5, 0.75];
  const nodeId = overlay.appendNode(point);

  point[0] = 99;
  assert.deepEqual(overlay.node(nodeId), [0.25, 0.5, 0.75]);
  assert.notStrictEqual(overlay.node(nodeId), point);
});

test("overlay setCell rejects duplicate base and created ids", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  const baseCell = session.cells.get("e1");
  assert.ok(baseCell);

  assert.throws(
    () => overlay.setCell(cloneCell(baseCell, "e1", 2)),
    /overlay cannot create duplicate cell e1/
  );

  const created = cloneCell(baseCell, "new", 2);
  overlay.setCell(created);
  assert.throws(
    () => overlay.setCell(cloneCell(baseCell, "new", 3)),
    /overlay cannot create duplicate cell new/
  );
  assert.strictEqual(overlay.cell("new"), created);
});

test("direct session state reads and writes through explicit accessors", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const state = createDirectRefinementSessionState(session, exactNodeKey);

  assert.equal(state.baseSession, session);
  assert.equal(state.revision, session.revision);
  assert.equal(state.kind, "H1");
  assert.equal(state.nodeCount, 8);
  assert.equal(state.cellCount, 1);
  assert.equal(state.activeLeafCount, 1);
  assert.equal(state.nextCommandId, session.nextCommandId);
  assert.equal(state.nextCellOrdinal, session.nextCellOrdinal);
  assert.equal(state.sortedActiveLeafIdsDirty, session.sortedActiveLeafIdsDirty);
  assert.equal(state.node(1), session.nodes[0]);
  assert.equal(state.node(9), undefined);
  assert.equal(state.cell("e1"), session.cells.get("e1"));
  assert.equal(state.cell("missing"), undefined);
  assert.equal(state.hasActiveLeaf("e1"), true);
  assert.equal(state.activeLeafIds(), session.activeLeafIds);
  assert.equal(state.undoCommands(), session.undoStack);
  assert.equal(state.redoCommands(), session.redoStack);

  const nodeId = state.appendNode([0.5, 0.5, 0.5]);
  assert.equal(nodeId, 9);
  assert.deepEqual(session.nodes[8], [0.5, 0.5, 0.5]);

  const cell = state.mutableCell("e1");
  cell.hidden = true;
  assert.equal(session.cells.get("e1")?.hidden, true);

  const secondCell = cloneCell(cell, "e2", 2);
  state.setCell(secondCell);
  assert.equal(state.cell("e2"), secondCell);

  session.nextCellOrdinal = undefined;
  assert.equal(state.nextCellOrdinal, session.cells.size + 1);
  assert.equal(state.allocateCellOrdinal(), session.cells.size + 1);
  assert.equal(session.nextCellOrdinal, session.cells.size + 2);

  state.setNextCommandId(17);
  assert.equal(session.nextCommandId, 17);

  const command = {
    id: "r16",
    kind: "refine",
    hiddenCellIds: [],
    createdCellIds: [],
    createdNodeIds: []
  };
  state.appendUndoCommand(command);
  assert.equal(session.undoStack.at(-1), command);

  session.redoStack = [command];
  const previousRedoStack = session.redoStack;
  state.clearRedoCommands();
  assert.deepEqual(session.redoStack, []);
  assert.notEqual(session.redoStack, previousRedoStack);
});

test("direct active updates preserve shared owners across remove and re-add", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const state = createDirectRefinementSessionState(session, exactNodeKey);
  const firstCell = state.mutableCell("e1");
  const secondCell = cloneCell(firstCell, "e2", 2);
  state.setCell(secondCell);
  const firstNodeKey = exactNodeKey(session.nodes[0]);

  session.sortedActiveLeafIdsDirty = false;
  state.addActiveLeaf("e2");
  assert.deepEqual(state.activeOwnersByNodeKey(firstNodeKey), ["e1", "e2"]);
  assert.equal(session.sortedActiveLeafIdsDirty, true);

  session.sortedActiveLeafIdsDirty = false;
  state.addActiveLeaf("e2");
  assert.deepEqual(state.activeOwnersByNodeKey(firstNodeKey), ["e1", "e2"]);
  assert.equal(session.sortedActiveLeafIdsDirty, false);

  state.removeActiveLeaf("e1");
  assert.deepEqual(state.activeOwnersByNodeKey(firstNodeKey), ["e2"]);
  assert.equal(session.sortedActiveLeafIdsDirty, true);

  session.sortedActiveLeafIdsDirty = false;
  state.removeActiveLeaf("e1");
  assert.deepEqual(state.activeOwnersByNodeKey(firstNodeKey), ["e2"]);
  assert.equal(session.sortedActiveLeafIdsDirty, false);

  state.addActiveLeaf("e1");
  assert.deepEqual(state.activeOwnersByNodeKey(firstNodeKey), ["e2", "e1"]);
  assert.equal(session.sortedActiveLeafIdsDirty, true);

  state.removeActiveLeaf("e2");
  assert.deepEqual(state.activeOwnersByNodeKey(firstNodeKey), ["e1"]);
});

test("direct active updates reject unknown cells without mutation", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const state = createDirectRefinementSessionState(session, exactNodeKey);
  session.sortedActiveLeafIdsDirty = false;
  const before = activeStateSnapshot(session);

  assert.throws(() => state.addActiveLeaf("missing"), /unknown refinement cell missing/);
  assert.deepEqual(activeStateSnapshot(session), before);
  assert.throws(() => state.removeActiveLeaf("missing"), /unknown refinement cell missing/);
  assert.deepEqual(activeStateSnapshot(session), before);
});

test("direct active add rejects missing nodes atomically", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const state = createDirectRefinementSessionState(session, exactNodeKey);
  const malformed = cloneCell(state.mutableCell("e1"), "bad", 2);
  malformed.element = [...malformed.element.slice(0, -1), 999];
  state.setCell(malformed);
  session.sortedActiveLeafIdsDirty = false;
  const before = activeStateSnapshot(session);

  assert.throws(
    () => state.addActiveLeaf("bad"),
    /active cell bad references missing node 999/
  );
  assert.deepEqual(activeStateSnapshot(session), before);
});

test("direct active remove rejects missing nodes atomically", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const state = createDirectRefinementSessionState(session, exactNodeKey);
  const cell = state.mutableCell("e1");
  cell.element = [...cell.element.slice(0, -1), 999];
  session.sortedActiveLeafIdsDirty = false;
  const before = activeStateSnapshot(session);

  assert.throws(
    () => state.removeActiveLeaf("e1"),
    /active cell e1 references missing node 999/
  );
  assert.deepEqual(activeStateSnapshot(session), before);
});

test("overlay active remove then add restores original membership without sparse changes", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  const key = exactNodeKey(session.nodes[0]);

  overlay.removeActiveLeaf("e1");
  overlay.addActiveLeaf("e1");

  assert.equal(refinementSessionOverlayStats(overlay).activeLeafAdditionCount, 0);
  assert.equal(refinementSessionOverlayStats(overlay).activeLeafRemovalCount, 0);
  assert.equal(refinementSessionOverlayStats(overlay).copiedNodeOwnerKeyCount, 0);
  assert.deepEqual(overlay.activeOwnersByNodeKey(key), session.activeLeafIdsByNodeKey.get(key));
});

test("overlay active cancellation restores shared base owner order and net dirty state", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const overlay = createTestOverlay(session);
  const [key, baseOwners] = [...session.activeLeafIdsByNodeKey]
    .find(([, owners]) => owners.length === 2);

  assert.deepEqual(baseOwners, ["e1", "e2"]);
  overlay.removeActiveLeaf("e1");
  overlay.addActiveLeaf("e1");

  assert.equal(refinementSessionOverlayStats(overlay).activeLeafAdditionCount, 0);
  assert.equal(refinementSessionOverlayStats(overlay).activeLeafRemovalCount, 0);
  assert.equal(refinementSessionOverlayStats(overlay).copiedNodeOwnerKeyCount, 0);
  assert.equal(overlay.sortedActiveLeafIdsDirty, false);
  assert.deepEqual(overlay.activeOwnersByNodeKey(key), baseOwners);
});

test("overlay idempotent and unknown active mutations leave sparse state untouched", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  const before = {
    additions: overlay.storage.activeLeafAdditions,
    removals: overlay.storage.activeLeafRemovals,
    owners: overlay.storage.ownerOverridesByNodeKey,
    additionsContent: [...overlay.storage.activeLeafAdditions],
    removalsContent: [...overlay.storage.activeLeafRemovals],
    ownersContent: [...overlay.storage.ownerOverridesByNodeKey],
    dirty: overlay.sortedActiveLeafIdsDirty
  };

  overlay.addActiveLeaf("e1");
  assert.throws(() => overlay.addActiveLeaf("missing"), /unknown refinement cell missing/);
  assert.throws(() => overlay.removeActiveLeaf("missing"), /unknown refinement cell missing/);

  assert.equal(overlay.storage.activeLeafAdditions, before.additions);
  assert.equal(overlay.storage.activeLeafRemovals, before.removals);
  assert.equal(overlay.storage.ownerOverridesByNodeKey, before.owners);
  assert.deepEqual([...overlay.storage.activeLeafAdditions], before.additionsContent);
  assert.deepEqual([...overlay.storage.activeLeafRemovals], before.removalsContent);
  assert.deepEqual([...overlay.storage.ownerOverridesByNodeKey], before.ownersContent);
  assert.equal(overlay.sortedActiveLeafIdsDirty, before.dirty);
});

test("overlay active methods work when extracted from the overlay", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  const add = overlay.addActiveLeaf;
  const remove = overlay.removeActiveLeaf;

  remove("e1");
  assert.equal(overlay.hasActiveLeaf("e1"), false);
  add("e1");
  assert.equal(overlay.hasActiveLeaf("e1"), true);
});

test("overlay active validation records base references only after success", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  const uniqueNodeIds = new Set(session.cells.get("e1").element);

  overlay.removeActiveLeaf("e1");
  assert.deepEqual([...overlay.storage.referencedBaseCellIds], ["e1"]);
  assert.deepEqual(
    [...overlay.storage.referencedBaseNodeIds].sort((left, right) => left - right),
    [...uniqueNodeIds].sort((left, right) => left - right)
  );
});

test("overlay cancellation preserves base owners before shared overlay-only owners", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const overlay = createTestOverlay(session);
  const extra = cloneCell(overlay.mutableCell("e1"), "extra", 3);
  overlay.setCell(extra);
  const [key] = [...session.activeLeafIdsByNodeKey]
    .find(([, owners]) => owners.length === 2);

  overlay.removeActiveLeaf("e1");
  overlay.addActiveLeaf("extra");
  overlay.addActiveLeaf("e1");

  assert.deepEqual(overlay.activeOwnersByNodeKey(key), ["e1", "e2", "extra"]);
});

test("overlay tracks independent active deltas through partial cancellation", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const overlay = createTestOverlay(session);
  const extra = cloneCell(overlay.mutableCell("e1"), "extra", 3);
  overlay.setCell(extra);

  overlay.removeActiveLeaf("e1");
  overlay.addActiveLeaf("extra");
  assert.equal(overlay.sortedActiveLeafIdsDirty, true);
  assert.equal(overlay.activeLeafCount, 2);
  assert.deepEqual([...overlay.activeLeafIds()], ["e2", "extra"]);

  overlay.addActiveLeaf("e1");
  assert.equal(overlay.sortedActiveLeafIdsDirty, true);
  assert.equal(overlay.activeLeafCount, 3);
  assert.deepEqual([...overlay.activeLeafIds()], ["e1", "e2", "extra"]);

  overlay.removeActiveLeaf("extra");
  assert.equal(overlay.sortedActiveLeafIdsDirty, false);
  assert.equal(overlay.activeLeafCount, 2);
  assert.deepEqual([...overlay.activeLeafIds()], ["e1", "e2"]);
});

test("overlay active mutations reject malformed or late-throwing keys atomically", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  let throwLate = false;
  let nodeKeyCalls = 0;
  const overlay = createRefinementSessionOverlay(session, {
    nodeKey: (point) => {
      if (throwLate && ++nodeKeyCalls === 4) throw new Error("late node key failure");
      return exactNodeKey(point);
    },
    cellNodeIds: (cell) => cell.element
  });
  const malformed = cloneCell(overlay.mutableCell("e1"), "bad", 2);
  malformed.element = [...malformed.element.slice(0, -1), 999];
  overlay.setCell(malformed);
  const beforeStorage = overlay.storage;
  const beforeStats = refinementSessionOverlayStats(overlay);
  const beforeCollections = {
    additions: beforeStorage.activeLeafAdditions,
    removals: beforeStorage.activeLeafRemovals,
    owners: beforeStorage.ownerOverridesByNodeKey,
    baseCells: beforeStorage.referencedBaseCellIds,
    baseNodes: beforeStorage.referencedBaseNodeIds,
    baseCellIds: [...beforeStorage.referencedBaseCellIds],
    baseNodeIds: [...beforeStorage.referencedBaseNodeIds]
  };

  assert.throws(() => overlay.addActiveLeaf("bad"), /missing node 999/);
  assert.deepEqual(refinementSessionOverlayStats(overlay), beforeStats);
  assert.equal(overlay.storage.activeLeafAdditions, beforeCollections.additions);
  assert.equal(overlay.storage.activeLeafRemovals, beforeCollections.removals);
  assert.equal(overlay.storage.ownerOverridesByNodeKey, beforeCollections.owners);
  assert.equal(overlay.storage.referencedBaseCellIds, beforeCollections.baseCells);
  assert.equal(overlay.storage.referencedBaseNodeIds, beforeCollections.baseNodes);
  assert.deepEqual([...overlay.storage.referencedBaseCellIds], beforeCollections.baseCellIds);
  assert.deepEqual([...overlay.storage.referencedBaseNodeIds], beforeCollections.baseNodeIds);

  throwLate = true;
  assert.throws(() => overlay.removeActiveLeaf("e1"), /late node key failure/);
  assert.deepEqual(refinementSessionOverlayStats(overlay), beforeStats);
  assert.equal(overlay.storage.activeLeafAdditions, beforeCollections.additions);
  assert.equal(overlay.storage.activeLeafRemovals, beforeCollections.removals);
  assert.equal(overlay.storage.ownerOverridesByNodeKey, beforeCollections.owners);
  assert.equal(overlay.storage.referencedBaseCellIds, beforeCollections.baseCells);
  assert.equal(overlay.storage.referencedBaseNodeIds, beforeCollections.baseNodes);
  assert.deepEqual([...overlay.storage.referencedBaseCellIds], beforeCollections.baseCellIds);
  assert.deepEqual([...overlay.storage.referencedBaseNodeIds], beforeCollections.baseNodeIds);
});

test("forked overlays isolate parent sparse state and report copied base cells", () => {
  const base = createRefinementSession(createHexUnitCubeMesh(10, 10, 10));
  const parent = createTestOverlay(base);
  const parentE1 = parent.mutableCell("e1");
  parentE1.children.push("parent-child");
  const created = cloneCell(parentE1, "created", 2);
  parent.setCell(created);
  parent.appendNode([0.25, 0.25, 0.25]);
  parent.removeActiveLeaf("e1");
  const child = forkRefinementSessionOverlay(parent);
  const childE2 = child.mutableCell("e2");
  childE2.children.push("child-child");
  child.mutableCell("e1").children.push("child-e1");
  child.cell("created").children.push("child-created");
  child.storage.appendedNodes[0][0] += 10;
  child.addActiveLeaf("e1");
  child.appendUndoCommand({ id: "child-command" });

  assert.equal(refinementSessionOverlayStats(child).copiedBaseCellCount, 2);
  assert.equal(base.cells.size, 1000);
  assert.deepEqual(parent.mutableCell("e1").children, ["parent-child"]);
  assert.deepEqual(base.cells.get("e1").children, []);
  assert.deepEqual(parent.mutableCell("e2").children, []);
  assert.deepEqual(parent.cell("created").children, ["parent-child"]);
  assert.equal(parent.storage.appendedNodes[0][0], 0.25);
  assert.equal(parent.hasActiveLeaf("e1"), false);
  assert.notEqual(child.mutableCell("e1"), parent.mutableCell("e1"));
  assert.notEqual(child.activeOwnersByNodeKey(exactNodeKey(base.nodes[0])), parent.activeOwnersByNodeKey(exactNodeKey(base.nodes[0])));
  assert.notEqual(child.storage.appendedUndoCommands, parent.storage.appendedUndoCommands);
});

test("fork preserves the base-appended node boundary and isolated undo history", () => {
  const base = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const parent = createTestOverlay(base);
  parent.appendNode([0.25, 0.25, 0.25]);
  parent.appendUndoCommand({ id: "parent-command" });
  const child = forkRefinementSessionOverlay(parent);

  assert.strictEqual(child.node(base.nodes.length), base.nodes.at(-1));
  assert.deepEqual(child.node(base.nodes.length + 1), [0.25, 0.25, 0.25]);
  assert.deepEqual([...child.undoCommands()], [...parent.undoCommands()]);

  child.appendUndoCommand({ id: "child-command" });
  assert.equal([...parent.undoCommands()].length, base.undoStack.length + 1);
  assert.equal([...child.undoCommands()].length, base.undoStack.length + 2);
});

test("fork isolates active sparse collections, references, flags, and counters", () => {
  const base = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const parent = createTestOverlay(base);
  const extra = cloneCell(parent.mutableCell("e1"), "extra", 3);
  parent.setCell(extra);
  parent.removeActiveLeaf("e1");
  parent.addActiveLeaf("extra");
  parent.clearRedoCommands();
  parent.allocateCellOrdinal();
  parent.setNextCommandId(42);
  const child = forkRefinementSessionOverlay(parent);
  const [[key]] = [...parent.storage.ownerOverridesByNodeKey];

  child.storage.ownerOverridesByNodeKey.get(key).push("child-owner");
  child.storage.activeLeafAdditions.add("child-addition");
  child.storage.activeLeafRemovals.delete("e1");
  child.storage.referencedBaseCellIds.add("child-cell");
  child.storage.referencedBaseNodeIds.add(999);
  child.storage.clearRedo = false;
  child.storage.nextCellOrdinal += 1;
  child.storage.nextCommandId += 1;

  assert.notDeepEqual(
    child.storage.ownerOverridesByNodeKey.get(key),
    parent.storage.ownerOverridesByNodeKey.get(key)
  );
  assert.equal(parent.storage.activeLeafAdditions.has("child-addition"), false);
  assert.equal(parent.storage.activeLeafRemovals.has("e1"), true);
  assert.equal(parent.storage.referencedBaseCellIds.has("child-cell"), false);
  assert.equal(parent.storage.referencedBaseNodeIds.has(999), false);
  assert.equal(parent.storage.clearRedo, true);
  assert.equal(parent.storage.nextCellOrdinal, 4);
  assert.equal(parent.storage.nextCommandId, 42);
});
