import assert from "node:assert/strict";
import test from "node:test";

import { createHexUnitCubeMesh, createRefinementSession } from "../dist/index.js";
import {
  createRefinementSessionOverlay,
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
