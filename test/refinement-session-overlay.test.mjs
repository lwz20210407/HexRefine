import assert from "node:assert/strict";
import test from "node:test";

import {
  activeBuildCellIdByElementId,
  activeBuildElementIdByCellId,
  buildActiveMeshWithMap,
  createHexUnitCubeMesh,
  createRefinementSession,
  refineSessionPatch,
  validateActiveBuildForSession
} from "../dist/index.js";
import * as publicApi from "../dist/index.js";
import * as refinementSessionInternal from "../dist/refinement-session.js";
import {
  commitRefinementSessionOverlay,
  createRefinementSessionOverlay,
  forkRefinementSessionOverlay,
  refinementSessionOverlayStats,
  snapshotRefinementSessionOverlayDelta
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

function activeBuildStructure(build) {
  return {
    mesh: build.mesh,
    mergeTolerance: build.mergeTolerance,
    geometryResolution: build.geometryResolution,
    cellIdByElementId: [...build.cellIdByElementId],
    elementIdByCellId: [...build.elementIdByCellId],
    cellIdsByElementIdArray: [...build.cellIdsByElementIdArray],
    elementIdByCellOrdinalArray: [...build.elementIdByCellOrdinalArray],
    nodeIdBySessionNodeId: [...build.nodeIdBySessionNodeId],
    sessionNodeIdByNodeId: [...build.sessionNodeIdByNodeId],
    sessionNodeIdsByNodeId: [...build.sessionNodeIdsByNodeId],
    elementIdsByNodeId: build.elementIdsByNodeId === undefined
      ? undefined
      : [...build.elementIdsByNodeId]
  };
}

function sessionStateSnapshot(session) {
  return {
    revision: session.revision,
    nodes: session.nodes,
    nodeValues: session.nodes.map((point) => [...point]),
    cells: session.cells,
    cellValues: [...session.cells].map(([id, cell]) => [
      id,
      { ...cell, element: [...cell.element], children: [...cell.children] }
    ]),
    activeLeafIds: session.activeLeafIds,
    activeLeafValues: [...session.activeLeafIds],
    ownerMap: session.activeLeafIdsByNodeKey,
    ownerValues: [...session.activeLeafIdsByNodeKey].map(([key, ids]) => [key, [...ids]]),
    undoStack: session.undoStack,
    undoValues: [...session.undoStack],
    redoStack: session.redoStack,
    redoValues: [...session.redoStack],
    sortedActiveLeafIdsDirty: session.sortedActiveLeafIdsDirty,
    nextCommandId: session.nextCommandId,
    nextCellOrdinal: session.nextCellOrdinal
  };
}

function assertSessionStateUnchanged(session, before) {
  assert.equal(session.revision, before.revision);
  assert.strictEqual(session.nodes, before.nodes);
  assert.deepEqual(session.nodes, before.nodeValues);
  assert.strictEqual(session.cells, before.cells);
  assert.deepEqual([...session.cells], before.cellValues);
  assert.strictEqual(session.activeLeafIds, before.activeLeafIds);
  assert.deepEqual([...session.activeLeafIds], before.activeLeafValues);
  assert.strictEqual(session.activeLeafIdsByNodeKey, before.ownerMap);
  assert.deepEqual([...session.activeLeafIdsByNodeKey], before.ownerValues);
  assert.strictEqual(session.undoStack, before.undoStack);
  assert.deepEqual(session.undoStack, before.undoValues);
  assert.strictEqual(session.redoStack, before.redoStack);
  assert.deepEqual(session.redoStack, before.redoValues);
  assert.equal(session.sortedActiveLeafIdsDirty, before.sortedActiveLeafIdsDirty);
  assert.equal(session.nextCommandId, before.nextCommandId);
  assert.equal(session.nextCellOrdinal, before.nextCellOrdinal);
}

function comparableSessionState(session) {
  return {
    nodes: session.nodes.map((point) => [...point]),
    cells: [...session.cells].map(([cellId, cell]) => [
      cellId,
      { ...cell, element: [...cell.element], children: [...cell.children] }
    ]),
    activeLeafIds: [...session.activeLeafIds],
    activeLeafIdsByNodeKey: [...session.activeLeafIdsByNodeKey]
      .map(([key, ownerIds]) => [key, [...ownerIds]])
      .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey)),
    undoStack: session.undoStack,
    redoStack: session.redoStack,
    sortedActiveLeafIdsDirty: session.sortedActiveLeafIdsDirty,
    nextCommandId: session.nextCommandId,
    nextCellOrdinal: session.nextCellOrdinal
  };
}

function populatedOverlay(session) {
  const overlay = createTestOverlay(session);
  const parent = overlay.mutableCell("e1");
  parent.hidden = true;
  parent.active = false;
  const created = cloneCell(parent, "created", session.nextCellOrdinal);
  created.hidden = false;
  created.active = true;
  created.element = [...created.element.slice(0, -1), overlay.appendNode([0.5, 0.5, 0.5])];
  overlay.setCell(created);
  overlay.removeActiveLeaf("e1");
  overlay.addActiveLeaf("created");
  overlay.appendUndoCommand({
    id: "r1",
    kind: "refine",
    hiddenCellIds: ["e1"],
    createdCellIds: ["created"],
    createdNodeIds: [session.nodes.length + 1],
    recipe: { version: 1, nested: { ids: ["e1", "created"] } }
  });
  overlay.clearRedoCommands();
  overlay.setNextCommandId(2);
  overlay.allocateCellOrdinal();
  return overlay;
}

test("reader active build matches concrete session without public provenance", () => {
  const buildFromState = refinementSessionInternal
    .buildActiveMeshWithMapFromSessionStateInternal;
  assert.equal(typeof buildFromState, "function");

  const session = createRefinementSession(createHexUnitCubeMesh(2, 2, 2));
  const overlay = createTestOverlay(session);
  const publicBuild = buildActiveMeshWithMap(session, {
    includeElementIdsByNodeId: true
  });
  const overlayBuild = buildFromState(overlay, {
    includeElementIdsByNodeId: true
  });

  assert.deepEqual(activeBuildStructure(overlayBuild), activeBuildStructure(publicBuild));
  assert.equal(overlayBuild.provenance, undefined);
  assert.equal(
    "buildActiveMeshWithMapFromSessionStateInternal" in publicApi,
    false
  );
});

test("reader active build represents sparse overlay cells and appended nodes", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const before = sessionStateSnapshot(session);
  const overlay = createTestOverlay(session);
  const hidden = overlay.mutableCell("e1");
  hidden.active = false;
  hidden.hidden = true;
  const appendedNodeId = overlay.appendNode([0.75, 0.75, 0.75]);
  const created = cloneCell(hidden, "overlay-cell", overlay.allocateCellOrdinal());
  created.active = true;
  created.hidden = false;
  created.element = [...created.element.slice(0, -1), appendedNodeId];
  const laterCreated = cloneCell(
    created,
    "later-overlay-cell",
    overlay.allocateCellOrdinal()
  );
  overlay.setCell(created);
  overlay.setCell(laterCreated);
  overlay.removeActiveLeaf("e1");
  overlay.addActiveLeaf("later-overlay-cell");
  overlay.addActiveLeaf("overlay-cell");

  const build = refinementSessionInternal
    .buildActiveMeshWithMapFromSessionStateInternal(overlay);

  assert.deepEqual(
    build.cellIdsByElementIdArray.slice(1),
    ["overlay-cell", "later-overlay-cell"]
  );
  assert.equal(build.elementIdByCellId.get("e1"), undefined);
  assert.equal(build.elementIdByCellId.get("overlay-cell"), 1);
  assert.equal(build.elementIdByCellId.get("later-overlay-cell"), 2);
  assert.ok(build.nodeIdBySessionNodeId.has(appendedNodeId));
  assert.ok(build.mesh.nodes.some((point) =>
    point[0] === 0.75 && point[1] === 0.75 && point[2] === 0.75
  ));
  assertSessionStateUnchanged(session, before);
});

test("reader active build matches both merged concrete-session paths", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const overlay = createTestOverlay(session);

  for (const options of [
    { mergeNodes: true },
    { mergeNodes: true, mergeTolerance: 1e-9 }
  ]) {
    const publicBuild = buildActiveMeshWithMap(session, options);
    const overlayBuild = refinementSessionInternal
      .buildActiveMeshWithMapFromSessionStateInternal(overlay, options);
    assert.deepEqual(activeBuildStructure(overlayBuild), activeBuildStructure(publicBuild));
  }
});

test("reader active build exposes trusted mappings without concrete-session trust", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlayBuild = refinementSessionInternal
    .buildActiveMeshWithMapFromSessionStateInternal(createTestOverlay(session), {
      includeCellIdByElementId: false,
      includeElementIdByCellId: false
    });

  assert.equal(overlayBuild.cellIdByElementId.size, 0);
  assert.equal(overlayBuild.elementIdByCellId.size, 0);
  assert.equal(activeBuildCellIdByElementId(overlayBuild, 1), "e1");
  assert.throws(
    () => validateActiveBuildForSession(session, overlayBuild),
    /mapping-only|session-state/i
  );
  assert.throws(
    () => activeBuildElementIdByCellId(session, overlayBuild, "e1"),
    /mapping-only|session-state/i
  );

  const publicBuild = buildActiveMeshWithMap(session);
  assert.strictEqual(validateActiveBuildForSession(session, publicBuild), publicBuild);
  assert.equal(activeBuildElementIdByCellId(session, publicBuild, "e1"), 1);
});

test("reader active build cannot forge concrete-session trust from public provenance", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const options = { includeElementIdsByNodeId: true };
  const overlayBuild = refinementSessionInternal
    .buildActiveMeshWithMapFromSessionStateInternal(
      createTestOverlay(session),
      options
    );
  const publicBuild = buildActiveMeshWithMap(session, options);

  assert.deepEqual(activeBuildStructure(overlayBuild), activeBuildStructure(publicBuild));
  overlayBuild.provenance = {
    ...publicBuild.provenance,
    geometryResolution: overlayBuild.geometryResolution
  };

  assert.throws(
    () => validateActiveBuildForSession(session, overlayBuild),
    /mapping-only|session-state/i
  );
  assert.throws(
    () => activeBuildElementIdByCellId(session, overlayBuild, "e1"),
    /mapping-only|session-state/i
  );
  assert.equal(activeBuildCellIdByElementId(overlayBuild, 1), "e1");
});

test("patch plans apply identically through direct and overlay state writers", () => {
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local"
  };
  const publicSession = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const publicCommand = refineSessionPatch(publicSession, ["e1"], options);
  assert.equal(publicSession.revision, 1);

  const prebuiltSession = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const prebuiltPlan = refinementSessionInternal
    .buildRefinementSessionPatchPlanInternal(prebuiltSession, ["e1"], options);
  const prebuiltCommand = refinementSessionInternal
    .applyRefinementSessionPatchPlanInternal(prebuiltSession, prebuiltPlan);
  assert.equal(prebuiltSession.revision, 1);
  assert.deepEqual(prebuiltCommand, publicCommand);
  assert.deepEqual(
    comparableSessionState(prebuiltSession),
    comparableSessionState(publicSession)
  );

  const stateSession = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const statePlan = refinementSessionInternal
    .buildRefinementSessionPatchPlanInternal(stateSession, ["e1"], options);
  const stateCommand = refinementSessionInternal
    .applyRefinementSessionPatchPlanToStateInternal(
      createDirectRefinementSessionState(stateSession, exactNodeKey),
      statePlan
    );
  assert.equal(stateSession.revision, 0);
  assert.deepEqual(stateCommand, publicCommand);
  assert.deepEqual(
    comparableSessionState(stateSession),
    comparableSessionState(publicSession)
  );

  const overlaySession = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlayPlan = refinementSessionInternal
    .buildRefinementSessionPatchPlanInternal(overlaySession, ["e1"], options);
  const overlay = createTestOverlay(overlaySession);
  const beforeOverlay = sessionStateSnapshot(overlaySession);
  const overlayCommand = refinementSessionInternal
    .applyRefinementSessionPatchPlanToStateInternal(overlay, overlayPlan);

  assert.equal(overlay.revision, 0);
  assert.equal(overlaySession.revision, 0);
  assertSessionStateUnchanged(overlaySession, beforeOverlay);
  assert.deepEqual(overlayCommand, publicCommand);
  assert.ok(Object.isFrozen(overlayCommand));
  assert.ok(Object.isFrozen(overlayCommand.hiddenCellIds));
  assert.ok(Object.isFrozen(overlayCommand.createdCellIds));
  assert.ok(Object.isFrozen(overlayCommand.createdNodeIds));
  assert.ok(Object.isFrozen(overlayCommand.recipe));
  assert.deepEqual(
    activeBuildStructure(
      refinementSessionInternal.buildActiveMeshWithMapFromSessionStateInternal(overlay)
    ),
    activeBuildStructure(
      refinementSessionInternal.buildActiveMeshWithMapFromSessionStateInternal(
        createDirectRefinementSessionState(publicSession, exactNodeKey)
      )
    )
  );

  const delta = snapshotRefinementSessionOverlayDelta(overlay);
  commitRefinementSessionOverlay(overlaySession, delta);
  assert.equal(overlaySession.revision, 1);
  assert.deepEqual(
    comparableSessionState(overlaySession),
    comparableSessionState(publicSession)
  );
  assert.equal(
    Object.hasOwn(publicApi, "applyRefinementSessionPatchPlanToStateInternal"),
    false
  );
  assert.equal(
    Object.hasOwn(publicApi, "buildRefinementSessionPatchPlanInternal"),
    false
  );
});

test("patch plan state preflight rejects stale parents before writer mutation", () => {
  const planSession = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const plan = refinementSessionInternal
    .buildRefinementSessionPatchPlanInternal(planSession, ["e1"], {
      hexRefinementRatio: 2
    });
  const staleCases = [
    ["ordinal", (session) => { session.cells.get("e1").ordinal = 2; }],
    ["active leaf", (session) => { session.cells.get("e1").active = false; }],
    ["connectivity", (session) => {
      const cell = session.cells.get("e1");
      [cell.element[0], cell.element[1]] = [cell.element[1], cell.element[0]];
    }],
    ["geometry", (session) => { session.nodes[0][0] += 0.125; }]
  ];

  for (const [label, makeStale] of staleCases) {
    const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
    makeStale(session);
    const before = sessionStateSnapshot(session);
    const overlay = createTestOverlay(session);
    const writerCalls = [];
    const countedState = new Proxy(overlay, {
      get(target, property, receiver) {
        if ([
          "mutableCell",
          "appendNode",
          "setCell",
          "addActiveLeaf",
          "removeActiveLeaf",
          "allocateCellOrdinal",
          "appendUndoCommand",
          "clearRedoCommands",
          "setNextCommandId"
        ].includes(property)) {
          return (...args) => {
            writerCalls.push(property);
            return target[property](...args);
          };
        }
        return Reflect.get(target, property, receiver);
      }
    });

    assert.throws(
      () => refinementSessionInternal
        .applyRefinementSessionPatchPlanToStateInternal(countedState, plan),
      /stale|changed|mapping|active|connectivity|geometry|ordinal/i,
      label
    );
    assert.deepEqual(writerCalls, [], label);
    assertSessionStateUnchanged(session, before);
    assert.deepEqual(
      {
        copiedBaseCellCount: refinementSessionOverlayStats(overlay).copiedBaseCellCount,
        createdCellCount: refinementSessionOverlayStats(overlay).createdCellCount,
        appendedNodeCount: refinementSessionOverlayStats(overlay).appendedNodeCount,
        activeLeafAdditionCount: refinementSessionOverlayStats(overlay).activeLeafAdditionCount,
        activeLeafRemovalCount: refinementSessionOverlayStats(overlay).activeLeafRemovalCount,
        copiedNodeOwnerKeyCount: refinementSessionOverlayStats(overlay).copiedNodeOwnerKeyCount
      },
      {
        copiedBaseCellCount: 0,
        createdCellCount: 0,
        appendedNodeCount: 0,
        activeLeafAdditionCount: 0,
        activeLeafRemovalCount: 0,
        copiedNodeOwnerKeyCount: 0
      },
      label
    );
  }
});

test("explicit reader merge visits only unique active nodes", () => {
  const mesh = createHexUnitCubeMesh(1, 1, 1);
  for (let index = 0; index < 4096; index += 1) {
    mesh.nodes.push([1000 + index, -1000 - index, 2000 + index]);
  }
  const session = createRefinementSession(mesh);
  const overlay = createTestOverlay(session);
  const nodeCalls = [];
  const countedState = new Proxy(overlay, {
    get(target, property, receiver) {
      if (property === "node") {
        return (nodeId) => {
          nodeCalls.push(nodeId);
          return target.node(nodeId);
        };
      }
      return Reflect.get(target, property, receiver);
    }
  });

  refinementSessionInternal.buildActiveMeshWithMapFromSessionStateInternal(
    countedState,
    { mergeNodes: true, mergeTolerance: 1e-9 }
  );

  const activeNodeIds = [...new Set(session.cells.get("e1").element)];
  assert.ok(countedState.nodeCount > 4000);
  assert.deepEqual(nodeCalls, activeNodeIds);
});

test("explicit reader merge matches an independent tolerance-boundary golden", () => {
  const tolerance = 0.125;
  const insideShift = tolerance - 1e-9;
  const outsideShift = tolerance + 1e-9;
  const mesh = createHexUnitCubeMesh(1, 1, 1);
  mesh.nodes.push([1e200, -1e200, 1e200], [-1e200, 1e200, -1e200]);
  const firstInactiveNodeId = mesh.nodes.length - 1;
  const session = createRefinementSession(mesh);
  const overlay = createTestOverlay(session);
  const baseCell = overlay.cell("e1");
  assert.ok(baseCell);
  const created = cloneCell(
    baseCell,
    "tolerance-boundary-cell",
    overlay.allocateCellOrdinal()
  );
  const appendedNodeIds = baseCell.element.map((nodeId, index) => {
    const point = overlay.node(nodeId);
    assert.ok(point);
    const shift = index === baseCell.element.length - 1
      ? outsideShift
      : insideShift;
    return overlay.appendNode([point[0] + shift, point[1], point[2]]);
  });
  created.element = appendedNodeIds;
  overlay.setCell(created);
  overlay.addActiveLeaf(created.id);

  const build = refinementSessionInternal
    .buildActiveMeshWithMapFromSessionStateInternal(overlay, {
      mergeNodes: true,
      mergeTolerance: tolerance
    });
  const firstElement = baseCell.element.map((_, index) => index + 1);
  const secondElement = baseCell.element.map((_, index) =>
    index === baseCell.element.length - 1 ? baseCell.element.length + 1 : index + 1
  );
  const expectedNodes = baseCell.element.map((nodeId) => [...session.nodes[nodeId - 1]]);
  const outsideBasePoint = session.nodes[baseCell.element.at(-1) - 1];
  expectedNodes.push([
    outsideBasePoint[0] + outsideShift,
    outsideBasePoint[1],
    outsideBasePoint[2]
  ]);

  assert.deepEqual(build.mesh, {
    kind: "H1",
    nodes: expectedNodes,
    elements: [firstElement, secondElement]
  });
  assert.deepEqual(build.cellIdsByElementIdArray.slice(1), [
    "e1",
    "tolerance-boundary-cell"
  ]);
  for (let index = 0; index < appendedNodeIds.length; index += 1) {
    assert.equal(
      build.nodeIdBySessionNodeId.get(appendedNodeIds[index]),
      secondElement[index]
    );
  }
  assert.equal(build.nodeIdBySessionNodeId.has(firstInactiveNodeId), false);
  assert.equal(build.nodeIdBySessionNodeId.has(firstInactiveNodeId + 1), false);
  assert.ok(build.geometryResolution.coordinateScale < 2);
});

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

test("overlay delta snapshot is deeply frozen and detached from overlay and base state", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = populatedOverlay(session);
  const delta = snapshotRefinementSessionOverlayDelta(overlay);
  const baseCell = session.cells.get("e1");

  assert.ok(Object.isFrozen(delta));
  assert.ok(Object.isFrozen(delta.cellOverrides));
  assert.ok(Object.isFrozen(delta.cellOverrides[0]));
  assert.ok(Object.isFrozen(delta.cellOverrides[0].cell));
  assert.ok(Object.isFrozen(delta.cellOverrides[0].cell.element));
  assert.ok(Object.isFrozen(delta.appendedNodes[0]));
  assert.ok(Object.isFrozen(delta.ownerOverrides[0].ownerIds));
  assert.ok(Object.isFrozen(delta.appendedUndoCommands[0]));
  assert.ok(Object.isFrozen(delta.appendedUndoCommands[0].recipe.nested.ids));
  assert.notStrictEqual(delta.cellOverrides[0].cell, overlay.storage.cellOverrides.get("e1"));
  assert.notStrictEqual(delta.cellOverrides[0].cell, baseCell);
  assert.throws(() => { delta.cellOverrides[0].cell.element[0] = 999; }, TypeError);
  assert.notEqual(delta.cellOverrides[0].cell.element[0], 999);
  assert.notEqual(baseCell.element[0], 999);
});

test("overlay delta rejects stale revisions atomically and cannot be applied twice", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const delta = snapshotRefinementSessionOverlayDelta(populatedOverlay(session));
  const beforeStale = sessionStateSnapshot(session);
  session.revision += 1;

  assert.throws(() => commitRefinementSessionOverlay(session, delta), /revision/i);
  assertSessionStateUnchanged(session, { ...beforeStale, revision: beforeStale.revision + 1 });

  const fresh = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const freshDelta = snapshotRefinementSessionOverlayDelta(populatedOverlay(fresh));
  commitRefinementSessionOverlay(fresh, freshDelta);
  const afterFirst = sessionStateSnapshot(fresh);
  assert.throws(() => commitRefinementSessionOverlay(fresh, freshDelta), /revision|stale/i);
  assertSessionStateUnchanged(fresh, afterFirst);
});

test("overlay delta guards replaced base collections and history atomically", () => {
  const replacements = [
    ["cells", (session) => { session.cells = new Map(session.cells); }],
    ["nodes", (session) => { session.nodes = [...session.nodes]; }],
    ["active leaves", (session) => { session.activeLeafIds = new Set(session.activeLeafIds); }],
    ["owner map", (session) => { session.activeLeafIdsByNodeKey = new Map(session.activeLeafIdsByNodeKey); }],
    ["undo history", (session) => { session.undoStack = [...session.undoStack]; }],
    ["redo history", (session) => { session.redoStack = [...session.redoStack]; }]
  ];

  for (const [, replace] of replacements) {
    const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
    const delta = snapshotRefinementSessionOverlayDelta(populatedOverlay(session));
    replace(session);
    const before = sessionStateSnapshot(session);
    assert.throws(() => commitRefinementSessionOverlay(session, delta), /changed|guard|base|stale/i);
    assertSessionStateUnchanged(session, before);
  }
});

test("overlay delta fingerprints touched base cells and referenced base nodes", () => {
  for (const mutate of [
    (session) => { session.cells.get("e1").hidden = true; },
    (session) => { session.nodes[0][0] += 0.125; }
  ]) {
    const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
    const delta = snapshotRefinementSessionOverlayDelta(populatedOverlay(session));
    mutate(session);
    const before = sessionStateSnapshot(session);
    assert.throws(() => commitRefinementSessionOverlay(session, delta), /fingerprint|base/i);
    assertSessionStateUnchanged(session, before);
  }
});

test("overlay delta rejects hostile target shapes before mutation", () => {
  const hostileCases = [
    (session) => { session.cells = new (class extends Map {})(session.cells); },
    (session) => { session.activeLeafIds = new (class extends Set {})(session.activeLeafIds); },
    (session) => { session.nodes = new (class extends Array {})(...session.nodes); },
    (session) => Object.setPrototypeOf(session, { forged: true })
  ];
  for (const makeHostile of hostileCases) {
    const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
    const delta = snapshotRefinementSessionOverlayDelta(populatedOverlay(session));
    makeHostile(session);
    const before = sessionStateSnapshot(session);
    assert.throws(() => commitRefinementSessionOverlay(session, delta), /plain|prototype|ordinary|guard/i);
    assertSessionStateUnchanged(session, before);
  }
});

test("overlay delta commits sparse changes to a 10x10x10 session without cloning far field", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(10, 10, 10));
  session.redoStack.push({ id: "redo", kind: "refine", hiddenCellIds: [], createdCellIds: [], createdNodeIds: [] });
  const overlay = populatedOverlay(session);
  const delta = snapshotRefinementSessionOverlayDelta(overlay);
  const farCell = session.cells.get("e1000");
  const nodes = session.nodes;
  const cells = session.cells;
  const activeLeafIds = session.activeLeafIds;
  const owners = session.activeLeafIdsByNodeKey;
  const undo = session.undoStack;
  const redo = session.redoStack;

  commitRefinementSessionOverlay(session, delta);

  assert.equal(session.revision, 1);
  assert.strictEqual(session.nodes, nodes);
  assert.strictEqual(session.cells, cells);
  assert.strictEqual(session.activeLeafIds, activeLeafIds);
  assert.strictEqual(session.activeLeafIdsByNodeKey, owners);
  assert.strictEqual(session.undoStack, undo);
  assert.notStrictEqual(session.redoStack, redo);
  assert.strictEqual(session.cells.get("e1000"), farCell);
  assert.equal(session.cells.get("e1").hidden, true);
  assert.equal(session.cells.get("e1").active, false);
  assert.ok(session.cells.has("created"));
  assert.equal(session.cells.get("created").hidden, false);
  assert.equal(session.cells.get("created").active, true);
  assert.equal(session.nodes.length, 1332);
  assert.equal(session.activeLeafIds.has("e1"), false);
  assert.equal(session.activeLeafIds.has("created"), true);
  assert.deepEqual(session.activeLeafIdsByNodeKey.get(exactNodeKey(session.nodes[0])), ["created"]);
  assert.equal(session.sortedActiveLeafIdsDirty, true);
  assert.equal(session.undoStack.at(-1).id, "r1");
  assert.deepEqual(session.redoStack, []);
  assert.equal(session.nextCommandId, 2);
  assert.equal(session.nextCellOrdinal, 1002);
});

test("overlay delta rejects mutable built-in Map prototypes before any mutation", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const delta = snapshotRefinementSessionOverlayDelta(populatedOverlay(session));
  const before = sessionStateSnapshot(session);
  const originalSet = Map.prototype.set;

  Map.prototype.set = function poisonedMapSet() {
    throw new Error("poisoned Map.set");
  };
  try {
    assert.throws(() => commitRefinementSessionOverlay(session, delta), /prototype|intrinsic|poisoned/i);
  } finally {
    Map.prototype.set = originalSet;
  }
  assertSessionStateUnchanged(session, before);
});

test("overlay delta replaces redo history before mutation when redo entries cannot be truncated", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const redo = { id: "redo", kind: "refine", hiddenCellIds: [], createdCellIds: [], createdNodeIds: [] };
  session.redoStack.push(redo);
  Object.defineProperty(session.redoStack, "0", {
    configurable: false,
    enumerable: true,
    writable: true,
    value: redo
  });
  const delta = snapshotRefinementSessionOverlayDelta(populatedOverlay(session));
  const before = sessionStateSnapshot(session);

  assert.doesNotThrow(() => commitRefinementSessionOverlay(session, delta));
  assert.notStrictEqual(session.redoStack, before.redoStack);
  assert.deepEqual(session.redoStack, []);
});

test("overlay delta rejects poisoned Function.prototype.call before any mutation", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const delta = snapshotRefinementSessionOverlayDelta(populatedOverlay(session));
  const before = sessionStateSnapshot(session);
  const originalCall = Function.prototype.call;
  const originalMapSet = Map.prototype.set;

  Function.prototype.call = function poisonedFunctionCall(receiver, ...args) {
    if (this === originalMapSet) throw new Error("poisoned Map.set call");
    return Reflect.apply(originalCall, this, [receiver, ...args]);
  };
  try {
    assert.throws(() => commitRefinementSessionOverlay(session, delta), /intrinsic|call|prototype/i);
  } finally {
    Function.prototype.call = originalCall;
  }
  assertSessionStateUnchanged(session, before);
});

test("overlay snapshots stay pinned to creation baseline after another overlay commits", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const originalNodeCount = session.nodes.length;
  const first = createTestOverlay(session);
  const firstNodeId = first.appendNode([0.25, 0.25, 0.25]);
  first.mutableCell("e1").hidden = true;
  const second = createTestOverlay(session);
  second.appendNode([0.75, 0.75, 0.75]);
  second.mutableCell("e1").hidden = true;

  commitRefinementSessionOverlay(session, snapshotRefinementSessionOverlayDelta(second));

  assert.equal(firstNodeId, originalNodeCount + 1);
  assert.deepEqual(first.node(firstNodeId), [0.25, 0.25, 0.25]);
  const before = sessionStateSnapshot(session);
  assert.throws(() => snapshotRefinementSessionOverlayDelta(first), /baseline|revision|changed/i);
  assertSessionStateUnchanged(session, before);
});

test("overlay snapshot rejects a direct revision change after creation", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  const nodeId = overlay.appendNode([0.25, 0.25, 0.25]);
  session.revision += 1;
  const before = sessionStateSnapshot(session);

  assert.equal(nodeId, 9);
  assert.throws(() => snapshotRefinementSessionOverlayDelta(overlay), /baseline|revision|changed/i);
  assertSessionStateUnchanged(session, before);
});

test("overlay delta rejects inherited append setters before any mutation", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const baseCommand = { id: "base", kind: "refine", hiddenCellIds: [], createdCellIds: [], createdNodeIds: [] };
  while (session.undoStack.length < 32) session.undoStack.push(baseCommand);
  const delta = snapshotRefinementSessionOverlayDelta(populatedOverlay(session));
  const before = sessionStateSnapshot(session);
  const appendIndex = String(session.undoStack.length);

  Object.defineProperty(Object.prototype, appendIndex, {
    configurable: true,
    set() { throw new Error("poisoned inherited append setter"); }
  });
  try {
    assert.throws(() => commitRefinementSessionOverlay(session, delta), /append|unsafe|setter/i);
  } finally {
    delete Object.prototype[appendIndex];
  }
  assertSessionStateUnchanged(session, before);
});
