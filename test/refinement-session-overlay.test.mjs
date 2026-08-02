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
import * as refinementSessionOverlayInternal from "../dist/refinement-session-overlay-internal.js";
import {
  commitRefinementSessionOverlay,
  createRefinementSessionOverlay,
  forkRefinementSessionOverlay,
  refinementSessionOverlayStats,
  snapshotRefinementSessionOverlayDelta
} from "../dist/refinement-session-overlay-internal.js";
import {
  commitRefinementSessionStateReferenceBatchInternal,
  createDirectRefinementSessionState,
  prepareRefinementSessionStateReferenceBatchInternal,
  refinementSessionStateCellFingerprintInternal,
  refinementSessionStateNodeFingerprintInternal
} from "../dist/refinement-session-state-internal.js";
import {
  certifyRefinementSessionBaseline,
  ensureRefinementSessionBaselineConformanceCertificate,
  publishRefinementSessionConformanceCertificate,
  refinementSessionConformanceCertificate
} from "../dist/refinement-conformance-certificate-internal.js";

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

function planningReferenceBatch(session, overlay, cellIds, nodeIds) {
  return {
    baseSession: session,
    revision: overlay.revision,
    kind: overlay.kind,
    nodeCount: overlay.nodeCount,
    cellCount: overlay.cellCount,
    activeLeafCount: overlay.activeLeafCount,
    nextCommandId: overlay.nextCommandId,
    nextCellOrdinal: overlay.nextCellOrdinal,
    sortedActiveLeafIdsDirty: overlay.sortedActiveLeafIdsDirty,
    cells: cellIds.map((cellId) => {
      const identity = overlay.peekCell(cellId);
      return {
        cellId,
        fingerprint: refinementSessionStateCellFingerprintInternal(
          cellId,
          identity
        ),
        identity
      };
    }),
    nodes: nodeIds.map((nodeId) => {
      const identity = overlay.peekNode(nodeId);
      return {
        nodeId,
        fingerprint: refinementSessionStateNodeFingerprintInternal(identity),
        identity
      };
    }),
    activeMembership: cellIds.map((cellId) => ({
      cellId,
      active: overlay.hasActiveLeaf(cellId)
    })),
    activeLeafIds: [...overlay.activeLeafIds()],
    ownersByNodeKey: nodeIds.map((nodeId) => {
      const key = exactNodeKey(overlay.peekNode(nodeId));
      const identity = overlay.activeOwnersByNodeKey(key);
      return { key, owners: [...identity], identity };
    })
  };
}

const stateWriterMethods = new Set([
  "mutableCell",
  "appendNode",
  "setCell",
  "addActiveLeaf",
  "removeActiveLeaf",
  "prepareActiveLeafBatch",
  "commitActiveLeafBatch",
  "allocateCellOrdinal",
  "setNextCommandId",
  "appendUndoCommand",
  "clearRedoCommands"
]);

function countStateWriterCalls(state, readerOverrides = {}) {
  const calls = [];
  return {
    calls,
    state: new Proxy(state, {
      get(target, property, receiver) {
        if (Object.hasOwn(readerOverrides, property)) {
          return readerOverrides[property];
        }
        if (stateWriterMethods.has(property)) {
          return (...args) => {
            calls.push(property);
            return target[property](...args);
          };
        }
        return Reflect.get(target, property, receiver);
      }
    })
  };
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

function normalizedPatchPlanSemantics(plan) {
  const normalizeReplacements = (build, replacements) => replacements.map(
    (replacement) => ({
      parentId: activeBuildCellIdByElementId(build, replacement.elementId),
      role: replacement.role,
      templateCode: replacement.templateCode,
      refinement: structuredClone(replacement.refinement)
    })
  );
  return {
    replacements: normalizeReplacements(plan.planningActive, plan.replacements),
    sourceReplacements: normalizeReplacements(
      plan.sourceActive,
      plan.sourceReplacements
    ),
    hiddenCellIds: [...plan.hiddenCellIds],
    quality: plan.quality === undefined ? undefined : { ...plan.quality },
    twoToOne: plan.twoToOne === undefined
      ? undefined
      : structuredClone(plan.twoToOne),
    recipe: structuredClone(plan.recipe)
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

function assertPlanOwnedValuesFrozen(plan) {
  assert.ok(Object.isFrozen(plan));
  for (const replacements of [plan.replacements, plan.sourceReplacements]) {
    assert.ok(Object.isFrozen(replacements));
    for (const replacement of replacements) {
      assert.ok(Object.isFrozen(replacement));
      assert.ok(Object.isFrozen(replacement.refinement));
      assert.ok(Object.isFrozen(replacement.refinement.nodes));
      assert.ok(replacement.refinement.nodes.every(Object.isFrozen));
      assert.ok(Object.isFrozen(replacement.refinement.elements));
      assert.ok(replacement.refinement.elements.every(Object.isFrozen));
    }
  }
  assert.ok(Object.isFrozen(plan.hiddenCellIds));
  assert.ok(Object.isFrozen(plan.recipe));
  assert.ok(Object.isFrozen(plan.recipe.selectedCellIds));
  assert.ok(Object.isFrozen(plan.recipe.selectedCellGeometry));
  assert.ok(plan.recipe.selectedCellGeometry.every((geometry) =>
    Object.isFrozen(geometry)
    && Object.isFrozen(geometry.points)
    && geometry.points.every(Object.isFrozen)
  ));
  assert.ok(Object.isFrozen(plan.recipe.transitionSupportCellIds));
  assert.ok(Object.isFrozen(plan.recipe.transitionSupportCellGeometry));
  assert.ok(Object.isFrozen(plan.recipe.options));
  assert.ok(Object.isFrozen(plan.recipe.options.hexTwoToOneCompensation));
  if (plan.quality !== undefined) assert.ok(Object.isFrozen(plan.quality));
  if (plan.twoToOne !== undefined) {
    assert.ok(Object.isFrozen(plan.twoToOne));
    assert.ok(Object.isFrozen(plan.twoToOne.originalSelectedCellIds));
    assert.ok(Object.isFrozen(plan.twoToOne.effectiveSelectedCellIds));
    assert.ok(Object.isFrozen(plan.twoToOne.actions));
    assert.ok(Object.isFrozen(plan.twoToOne.affectedComponentCellIds));
    assert.ok(plan.twoToOne.actions.every((action) =>
      Object.isFrozen(action)
      && Object.isFrozen(action.addedParentCellIds)
      && Object.isFrozen(action.replacedTransitionCellIds)
    ));
  }
}

function assertDeeplyFrozenPlainValue(value) {
  if (value === null || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value));
  for (const nestedValue of Object.values(value)) {
    assertDeeplyFrozenPlainValue(nestedValue);
  }
}

function assertFreshOverlayState(overlay, session, beforeSession, beforeStats) {
  assertSessionStateUnchanged(session, beforeSession);
  assert.deepEqual(refinementSessionOverlayStats(overlay), beforeStats);
  assert.equal(overlay.nodeCount, session.nodes.length);
  assert.equal(overlay.cellCount, session.cells.size);
  assert.equal(overlay.nextCommandId, session.nextCommandId);
  assert.equal(overlay.nextCellOrdinal, session.nextCellOrdinal);
  assert.deepEqual([...overlay.undoCommands()], session.undoStack);
  assert.deepEqual([...overlay.redoCommands()], session.redoStack);
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
    overlayCommand.createdCellIds,
    Array.from({ length: 8 }, (_, index) => `e1/${index + 1}`)
  );
  assert.deepEqual(
    overlayCommand.createdCellIds.map((cellId) => overlay.cell(cellId).ordinal),
    [2, 3, 4, 5, 6, 7, 8, 9]
  );
  assert.deepEqual(
    overlayCommand.createdNodeIds,
    Array.from({ length: 27 }, (_, index) => index + 9)
  );
  assert.equal(overlay.nodeCount, 35);
  assert.equal(overlay.cellCount, 9);
  assert.equal(overlay.nextCommandId, 2);
  assert.equal(overlay.nextCellOrdinal, 10);
  assert.deepEqual([...overlay.undoCommands()].map((command) => command.id), ["cmd-1"]);
  assert.deepEqual([...overlay.redoCommands()], []);
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
  assert.deepEqual(delta.baseCellGuards.map((guard) => guard.id), ["e1"]);
  assert.deepEqual(
    delta.baseNodeGuards.map((guard) => guard.nodeId),
    [1, 2, 3, 4, 5, 6, 7, 8]
  );
  commitRefinementSessionOverlay(overlaySession, delta);
  assert.equal(overlaySession.revision, 1);
  assert.equal(overlaySession.cells.size, 9);
  assert.equal(overlaySession.nodes.length, 35);
  assert.equal(overlaySession.nextCommandId, 2);
  assert.equal(overlaySession.nextCellOrdinal, 10);
  assert.deepEqual(overlaySession.undoStack.map((command) => command.id), ["cmd-1"]);
  assert.deepEqual(overlaySession.redoStack, []);
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

test("reader patch planning matches concrete planning semantics", () => {
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local"
  };
  const directSession = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const overlaySession = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const overlay = createTestOverlay(overlaySession);

  const directPlan = refinementSessionInternal
    .buildRefinementSessionPatchPlanInternal(directSession, ["e1"], options);
  const overlayPlan = refinementSessionInternal
    .buildRefinementSessionPatchPlanFromStateInternal(overlay, ["e1"], options);

  assert.deepEqual(
    normalizedPatchPlanSemantics(overlayPlan),
    normalizedPatchPlanSemantics(directPlan)
  );
  assertPlanOwnedValuesFrozen(overlayPlan);
});

test("reader planning ignores a poisoned staged active-leaf iterator", () => {
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local"
  };
  const directSession = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const overlaySession = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const overlay = createTestOverlay(overlaySession);
  const originalIteratorDescriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    Symbol.iterator
  );
  const originalIterator = originalIteratorDescriptor.value;
  let directPlan;
  let overlayPlan;

  Object.defineProperty(Array.prototype, Symbol.iterator, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: function poisonedStagedActiveLeafIterator() {
      if (
        Object.isFrozen(this)
        && this.length === 2
        && this[0] === "e1"
        && this[1] === "e2"
      ) {
        return Reflect.apply(originalIterator, ["e1"], []);
      }
      return Reflect.apply(originalIterator, this, []);
    }
  });
  try {
    directPlan = refinementSessionInternal
      .buildRefinementSessionPatchPlanInternal(directSession, ["e1"], options);
    overlayPlan = refinementSessionInternal
      .buildRefinementSessionPatchPlanFromStateInternal(
        overlay,
        ["e1"],
        options
      );
  } finally {
    Object.defineProperty(
      Array.prototype,
      Symbol.iterator,
      originalIteratorDescriptor
    );
  }

  assert.deepEqual(
    normalizedPatchPlanSemantics(overlayPlan),
    normalizedPatchPlanSemantics(directPlan)
  );
  assert.deepEqual(refinementSessionOverlayStats(overlay), {
    copiedBaseCellCount: 0,
    createdCellCount: 0,
    appendedNodeCount: 0,
    activeLeafAdditionCount: 0,
    activeLeafRemovalCount: 0,
    copiedNodeOwnerKeyCount: 0,
    referencedBaseCellCount: 2,
    referencedBaseNodeCount: 12
  });
});

test("overlay-built patch plan applies without changing its base session", () => {
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local"
  };
  const directSession = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const directPlan = refinementSessionInternal
    .buildRefinementSessionPatchPlanInternal(directSession, ["e1"], options);
  const directCommand = refinementSessionInternal
    .applyRefinementSessionPatchPlanInternal(directSession, directPlan);

  const baseSession = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const beforeBase = sessionStateSnapshot(baseSession);
  const overlay = createTestOverlay(baseSession);
  const overlayPlan = refinementSessionInternal
    .buildRefinementSessionPatchPlanFromStateInternal(overlay, ["e1"], options);
  const overlayCommand = refinementSessionInternal
    .applyRefinementSessionPatchPlanToStateInternal(overlay, overlayPlan);

  assert.deepEqual(overlayCommand, directCommand);
  assert.deepEqual(
    activeBuildStructure(
      refinementSessionInternal.buildActiveMeshWithMapFromSessionStateInternal(
        overlay
      )
    ),
    activeBuildStructure(
      refinementSessionInternal.buildActiveMeshWithMapFromSessionStateInternal(
        createDirectRefinementSessionState(directSession, exactNodeKey)
      )
    )
  );
  assertSessionStateUnchanged(baseSession, beforeBase);
  commitRefinementSessionOverlay(
    baseSession,
    snapshotRefinementSessionOverlayDelta(overlay)
  );
  assert.deepEqual(
    comparableSessionState(baseSession),
    comparableSessionState(directSession)
  );
});

test("reader patch planning sees cells and nodes created by an earlier overlay patch", () => {
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local"
  };
  const directSession = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  refineSessionPatch(directSession, ["e1"], options);
  const directSecondPlan = refinementSessionInternal
    .buildRefinementSessionPatchPlanInternal(directSession, ["e1/1"], options);
  refinementSessionInternal
    .applyRefinementSessionPatchPlanInternal(directSession, directSecondPlan);

  const baseSession = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const beforeBase = sessionStateSnapshot(baseSession);
  const overlay = createTestOverlay(baseSession);
  const firstPlan = refinementSessionInternal
    .buildRefinementSessionPatchPlanFromStateInternal(overlay, ["e1"], options);
  refinementSessionInternal
    .applyRefinementSessionPatchPlanToStateInternal(overlay, firstPlan);
  const overlayCreatedNodeCount = overlay.nodeCount - baseSession.nodes.length;

  const secondPlan = refinementSessionInternal
    .buildRefinementSessionPatchPlanFromStateInternal(overlay, ["e1/1"], options);
  refinementSessionInternal
    .applyRefinementSessionPatchPlanToStateInternal(overlay, secondPlan);

  assert.ok(overlayCreatedNodeCount > 0);
  assert.deepEqual(
    normalizedPatchPlanSemantics(secondPlan),
    normalizedPatchPlanSemantics(directSecondPlan)
  );
  assert.deepEqual(
    activeBuildStructure(
      refinementSessionInternal.buildActiveMeshWithMapFromSessionStateInternal(
        overlay
      )
    ),
    activeBuildStructure(buildActiveMeshWithMap(directSession))
  );
  assertSessionStateUnchanged(baseSession, beforeBase);
});

test("failed reader patch planning leaves overlay and base state unchanged", () => {
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local"
  };
  const baseSession = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const overlay = createTestOverlay(baseSession);
  const beforeBase = sessionStateSnapshot(baseSession);
  const beforeStats = refinementSessionOverlayStats(overlay);
  const beforeOverlay = {
    nodeCount: overlay.nodeCount,
    cellCount: overlay.cellCount,
    nextCommandId: overlay.nextCommandId,
    nextCellOrdinal: overlay.nextCellOrdinal,
    undoCommands: [...overlay.undoCommands()],
    redoCommands: [...overlay.redoCommands()]
  };

  assert.throws(
    () => refinementSessionInternal
      .buildRefinementSessionPatchPlanFromStateInternal(
        overlay,
        ["e1", "missing"],
        options
      ),
    /cells do not exist: missing/i
  );

  assert.deepEqual(refinementSessionOverlayStats(overlay), beforeStats);
  assert.equal(overlay.nodeCount, beforeOverlay.nodeCount);
  assert.equal(overlay.cellCount, beforeOverlay.cellCount);
  assert.equal(overlay.nextCommandId, beforeOverlay.nextCommandId);
  assert.equal(overlay.nextCellOrdinal, beforeOverlay.nextCellOrdinal);
  assert.deepEqual([...overlay.undoCommands()], beforeOverlay.undoCommands);
  assert.deepEqual([...overlay.redoCommands()], beforeOverlay.redoCommands);
  assertSessionStateUnchanged(baseSession, beforeBase);
});

test("successful reader patch planning publishes references for delta guards", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const overlay = createTestOverlay(session);

  refinementSessionInternal.buildRefinementSessionPatchPlanFromStateInternal(
    overlay,
    ["e1"],
    {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local"
    }
  );

  assert.deepEqual(refinementSessionOverlayStats(overlay), {
    copiedBaseCellCount: 0,
    createdCellCount: 0,
    appendedNodeCount: 0,
    activeLeafAdditionCount: 0,
    activeLeafRemovalCount: 0,
    copiedNodeOwnerKeyCount: 0,
    referencedBaseCellCount: 2,
    referencedBaseNodeCount: 12
  });
  const delta = snapshotRefinementSessionOverlayDelta(overlay);
  session.nodes[0][0] += 0.125;
  assert.throws(
    () => commitRefinementSessionOverlay(session, delta),
    /base node fingerprint changed for 1/i
  );
});

test("official reference batches reject late target corruption atomically", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  const prepared = prepareRefinementSessionStateReferenceBatchInternal(
    overlay,
    planningReferenceBatch(session, overlay, ["e1"], [1])
  );
  const references = overlay.storage.referencedBaseCellIds;
  const originalPrototype = Object.getPrototypeOf(references);

  try {
    Object.setPrototypeOf(references, {});
    assert.throws(
      () => commitRefinementSessionStateReferenceBatchInternal(
        overlay,
        prepared
      ),
      /reference|ordinary Set|prototype/i
    );
  } finally {
    Object.setPrototypeOf(references, originalPrototype);
  }
  assert.deepEqual(refinementSessionOverlayStats(overlay), {
    copiedBaseCellCount: 0,
    createdCellCount: 0,
    appendedNodeCount: 0,
    activeLeafAdditionCount: 0,
    activeLeafRemovalCount: 0,
    copiedNodeOwnerKeyCount: 0,
    referencedBaseCellCount: 0,
    referencedBaseNodeCount: 0
  });
});

test("official reference batches ignore late Set.add poisoning atomically", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  const prepared = prepareRefinementSessionStateReferenceBatchInternal(
    overlay,
    planningReferenceBatch(session, overlay, ["e1"], [1])
  );
  const originalSetAdd = Set.prototype.add;

  try {
    Set.prototype.add = function poisonedSetAdd() {
      throw new Error("poisoned Set.add");
    };
    commitRefinementSessionStateReferenceBatchInternal(overlay, prepared);
  } finally {
    Set.prototype.add = originalSetAdd;
  }
  assert.equal(refinementSessionOverlayStats(overlay).referencedBaseCellCount, 1);
  assert.equal(refinementSessionOverlayStats(overlay).referencedBaseNodeCount, 1);
});

test("reader patch planning fails closed for unregistered reader wrappers", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const overlay = createTestOverlay(session);
  const wrapped = new Proxy(overlay, {});
  const beforeStats = refinementSessionOverlayStats(overlay);

  assert.throws(
    () => refinementSessionInternal
      .buildRefinementSessionPatchPlanFromStateInternal(wrapped, ["e1"], {
        hexRefinementRatio: 2,
        hexTwoToOneSelectionMode: "local"
      }),
    /registered|official|unsupported.*reader/i
  );
  assert.deepEqual(refinementSessionOverlayStats(overlay), beforeStats);
});

test("reader patch planning rejects in-place state mutation before publication", () => {
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local"
  };
  const cases = [
    {
      label: "coordinate from owner callback",
      install(session, overlay) {
        const originalPeekNode = overlay.peekNode;
        const originalOwners = overlay.activeOwnersByNodeKey;
        let lastNodeId;
        let mutatedPoint;
        overlay.peekNode = (nodeId) => {
          lastNodeId = nodeId;
          return originalPeekNode(nodeId);
        };
        overlay.activeOwnersByNodeKey = (key) => {
          if (mutatedPoint === undefined && lastNodeId !== undefined) {
            mutatedPoint = originalPeekNode(lastNodeId);
            mutatedPoint[0] += 0.125;
          }
          return originalOwners(key);
        };
        return () => {
          if (mutatedPoint !== undefined) mutatedPoint[0] -= 0.125;
        };
      }
    },
    {
      label: "connectivity from owner callback",
      install(session, overlay) {
        const originalOwners = overlay.activeOwnersByNodeKey;
        const element = session.cells.get("e1").element;
        let mutated = false;
        overlay.activeOwnersByNodeKey = (key) => {
          if (!mutated) {
            [element[0], element[1]] = [element[1], element[0]];
            mutated = true;
          }
          return originalOwners(key);
        };
        return () => {
          if (mutated) {
            [element[0], element[1]] = [element[1], element[0]];
          }
        };
      }
    },
    {
      label: "active membership callback",
      install(session, overlay) {
        const originalHasActiveLeaf = overlay.hasActiveLeaf;
        let mutated = false;
        overlay.hasActiveLeaf = (cellId) => {
          const active = originalHasActiveLeaf(cellId);
          if (!mutated && cellId === "e1") {
            session.activeLeafIds.delete("e1");
            mutated = true;
          }
          return active;
        };
        return () => {
          if (mutated) session.activeLeafIds.add("e1");
        };
      }
    },
    {
      label: "owner mapping from later owner callback",
      install(session, overlay) {
        const original = overlay.activeOwnersByNodeKey;
        let observedOwners;
        let removedOwner;
        overlay.activeOwnersByNodeKey = (candidateKey) => {
          const result = original(candidateKey);
          if (observedOwners === undefined && result.length > 0) {
            observedOwners = result;
          } else if (
            observedOwners !== undefined
            && removedOwner === undefined
          ) {
            removedOwner = observedOwners.pop();
          }
          return result;
        };
        return () => {
          if (observedOwners !== undefined && removedOwner !== undefined) {
            observedOwners.push(removedOwner);
          }
        };
      }
    },
    {
      label: "counter from owner callback",
      install(_session, overlay) {
        const originalOwners = overlay.activeOwnersByNodeKey;
        let mutated = false;
        overlay.activeOwnersByNodeKey = (key) => {
          if (!mutated) {
            overlay.storage.nextCommandId += 1;
            mutated = true;
          }
          return originalOwners(key);
        };
        return () => {
          if (mutated) overlay.storage.nextCommandId -= 1;
        };
      }
    }
  ];

  for (const { label, install } of cases) {
    const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
    const overlay = createTestOverlay(session);
    const restore = install(session, overlay);
    const beforeStats = refinementSessionOverlayStats(overlay);
    let plan;
    try {
      assert.throws(
        () => {
          plan = refinementSessionInternal
            .buildRefinementSessionPatchPlanFromStateInternal(
            overlay,
            ["e1"],
            options
          );
        },
        /changed during planning/i,
        label
      );
      assert.equal(plan, undefined, label);
      assert.deepEqual(
        refinementSessionOverlayStats(overlay),
        beforeStats,
        label
      );
    } finally {
      restore();
    }
  }
});

test("trusted planning validation rejects a later cell accessor mutating an earlier cell", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const overlay = createTestOverlay(session);
  const firstCell = session.cells.get("e1");
  const laterCell = session.cells.get("e2");
  const originalId = Object.getOwnPropertyDescriptor(laterCell, "id");
  const originalLevel = firstCell.level;
  const beforeStats = refinementSessionOverlayStats(overlay);
  let accessorReads = 0;
  let plan;

  Object.defineProperty(laterCell, "id", {
    configurable: true,
    enumerable: true,
    get() {
      accessorReads += 1;
      firstCell.level = originalLevel + 1;
      return "e2";
    }
  });
  try {
    assert.throws(
      () => {
        plan = refinementSessionInternal
          .buildRefinementSessionPatchPlanFromStateInternal(
            overlay,
            ["e1"],
            {
              hexRefinementRatio: 2,
              hexTwoToOneSelectionMode: "local"
            }
          );
      },
      /changed during planning|own data property/i
    );
    assert.ok(accessorReads > 0);
    assert.equal(plan, undefined);
    assert.deepEqual(refinementSessionOverlayStats(overlay), beforeStats);
  } finally {
    firstCell.level = originalLevel;
    Object.defineProperty(laterCell, "id", originalId);
  }
});

test("trusted planning validation rejects replacement reference targets atomically", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const overlay = createTestOverlay(session);
  const laterCell = session.cells.get("e2");
  const originalId = Object.getOwnPropertyDescriptor(laterCell, "id");
  const originalTarget = overlay.storage.referencedBaseCellIds;
  const originalTargetDescriptor = Object.getOwnPropertyDescriptor(
    overlay.storage,
    "referencedBaseCellIds"
  );
  const replacementTarget = new Set();
  const beforeStats = refinementSessionOverlayStats(overlay);
  let accessorReads = 0;
  let plan;

  Object.defineProperty(laterCell, "id", {
    configurable: true,
    enumerable: true,
    get() {
      accessorReads += 1;
      overlay.storage.referencedBaseCellIds = replacementTarget;
      return "e2";
    }
  });
  try {
    assert.throws(
      () => {
        plan = refinementSessionInternal
          .buildRefinementSessionPatchPlanFromStateInternal(
            overlay,
            ["e1"],
            {
              hexRefinementRatio: 2,
              hexTwoToOneSelectionMode: "local"
            }
          );
      },
      /reference|storage|changed during planning/i
    );
    assert.ok(accessorReads > 0);
    assert.equal(plan, undefined);
    assert.equal(originalTarget.size, 0);
    assert.equal(replacementTarget.size, 0);
    assert.deepEqual(refinementSessionOverlayStats(overlay), beforeStats);
  } finally {
    Object.defineProperty(laterCell, "id", originalId);
    Object.defineProperty(
      overlay.storage,
      "referencedBaseCellIds",
      originalTargetDescriptor
    );
  }
});

test("trusted reference publication does not invoke late Array iterator poisoning", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const overlay = createTestOverlay(session);
  const firstCell = session.cells.get("e1");
  const originalLevel = firstCell.level;
  const batch = planningReferenceBatch(session, overlay, ["e1"], [1]);
  const originalIteratorDescriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    Symbol.iterator
  );
  const originalIterator = originalIteratorDescriptor.value;
  const beforeStats = refinementSessionOverlayStats(overlay);
  let phase = "prepare";
  let snapshotIteratorCalls = 0;
  let validationIteratorCalls = 0;
  let mutated = false;
  let publicationError;
  let observedLevel;
  let afterStats;

  Object.defineProperty(Array.prototype, Symbol.iterator, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: function poisonedArrayIterator() {
      if (phase === "prepare") {
        snapshotIteratorCalls += 1;
      } else {
        validationIteratorCalls += 1;
        if (validationIteratorCalls === 2) {
          firstCell.level = originalLevel + 1;
          mutated = true;
        }
      }
      return Reflect.apply(originalIterator, this, []);
    }
  });
  try {
    try {
      const prepared = prepareRefinementSessionStateReferenceBatchInternal(
        overlay,
        batch
      );
      phase = "validate";
      commitRefinementSessionStateReferenceBatchInternal(overlay, prepared);
    } catch (error) {
      publicationError = error;
    }
  } finally {
    observedLevel = firstCell.level;
    Object.defineProperty(
      Array.prototype,
      Symbol.iterator,
      originalIteratorDescriptor
    );
    firstCell.level = originalLevel;
  }
  afterStats = refinementSessionOverlayStats(overlay);

  assert.ifError(publicationError);
  assert.equal(snapshotIteratorCalls, 0);
  assert.equal(validationIteratorCalls, 0);
  assert.equal(mutated, false);
  assert.equal(observedLevel, originalLevel);
  assert.ok(
    afterStats.referencedBaseCellCount > beforeStats.referencedBaseCellCount
  );
  assert.ok(
    afterStats.referencedBaseNodeCount > beforeStats.referencedBaseNodeCount
  );
});

test("reader patch planning rejects caller-supplied active builds", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  const activeBuild = buildActiveMeshWithMap(session);

  assert.throws(
    () => refinementSessionInternal
      .buildRefinementSessionPatchPlanFromStateInternal(overlay, ["e1"], {
        hexRefinementRatio: 2,
        hexTwoToOneSelectionMode: "local",
        activeBuild
      }),
    /reader patch planning does not accept.*activeBuild/i
  );
});

test("reader patch planner is internal and mapping-only builds stay untrusted publicly", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  const mappingOnlyBuild = refinementSessionInternal
    .buildActiveMeshWithMapFromSessionStateInternal(overlay);

  assert.equal(
    Object.hasOwn(
      publicApi,
      "buildRefinementSessionPatchPlanFromStateInternal"
    ),
    false
  );
  assert.throws(
    () => refinementSessionInternal
      .buildRefinementSessionPatchPlanInternal(session, ["e1"], {
        hexRefinementRatio: 2,
        hexTwoToOneSelectionMode: "local",
        activeBuild: mappingOnlyBuild
      }),
    /mapping-only|session-state/i
  );
});

test("direct patch application accepts mergeTolerance zero", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const command = refineSessionPatch(session, ["e1"], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    mergeTolerance: 0
  });

  assert.equal(command.recipe.options.mergeTolerance, 0);
  assert.equal(session.revision, 1);
  assert.equal(session.activeLeafIds.size, 8);
});

test("overlay patch application with mergeTolerance zero matches direct state", () => {
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    mergeTolerance: 0
  };
  const directSession = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const directCommand = refineSessionPatch(directSession, ["e1"], options);
  const overlaySession = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const plan = refinementSessionInternal
    .buildRefinementSessionPatchPlanInternal(overlaySession, ["e1"], options);
  const overlay = createTestOverlay(overlaySession);
  const overlayCommand = refinementSessionInternal
    .applyRefinementSessionPatchPlanToStateInternal(overlay, plan);

  assert.equal(overlayCommand.recipe.options.mergeTolerance, 0);
  assert.deepEqual(overlayCommand, directCommand);
  commitRefinementSessionOverlay(
    overlaySession,
    snapshotRefinementSessionOverlayDelta(overlay)
  );
  assert.deepEqual(
    comparableSessionState(overlaySession),
    comparableSessionState(directSession)
  );
});

test("patch plans are authentic deeply frozen values", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const plan = refinementSessionInternal
    .buildRefinementSessionPatchPlanInternal(session, ["e1"], {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local"
    });
  assert.notEqual(plan.quality, undefined);
  assert.notEqual(plan.twoToOne, undefined);
  assertPlanOwnedValuesFrozen(plan);

  const originalCoordinate = plan.replacements[0].refinement.nodes[0][0];
  assert.throws(
    () => { plan.replacements[0].refinement.nodes[0][0] = 99; },
    TypeError
  );
  assert.equal(plan.replacements[0].refinement.nodes[0][0], originalCoordinate);

  const overlay = createTestOverlay(session);
  refinementSessionInternal
    .applyRefinementSessionPatchPlanToStateInternal(overlay, plan);
  assert.equal(overlay.cellCount, 9);
});

test("structured clones and hand-built patch plans are rejected before state access", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const plan = refinementSessionInternal
    .buildRefinementSessionPatchPlanInternal(session, ["e1"], {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local"
    });
  const candidates = [structuredClone(plan), { ...plan }];

  for (const candidate of candidates) {
    const overlay = createTestOverlay(session);
    const beforeSession = sessionStateSnapshot(session);
    const beforeStats = refinementSessionOverlayStats(overlay);
    let stateAccessed = false;
    const unreadableState = new Proxy(overlay, {
      get() {
        stateAccessed = true;
        throw new Error("state was accessed");
      }
    });

    assert.throws(
      () => refinementSessionInternal
        .applyRefinementSessionPatchPlanToStateInternal(unreadableState, candidate),
      /invalid refinement patch plan.*(authentic|trusted|brand)/i
    );
    assert.equal(stateAccessed, false);
    assertFreshOverlayState(overlay, session, beforeSession, beforeStats);
  }
});

test("patch plan branding resists WeakSet prototype poisoning", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const plan = refinementSessionInternal
    .buildRefinementSessionPatchPlanInternal(session, ["e1"], {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local"
    });
  const forged = {
    ...plan,
    replacements: plan.replacements.map((replacement) => ({
      ...replacement,
      refinement: {
        ...replacement.refinement,
        nodes: replacement.refinement.nodes.map((point) => [...point])
      }
    }))
  };
  forged.replacements[0].refinement.nodes[0] = [99, 99, 99];

  const overlay = createTestOverlay(session);
  const beforeSession = sessionStateSnapshot(session);
  const beforeStats = refinementSessionOverlayStats(overlay);
  const counted = countStateWriterCalls(overlay);
  const originalWeakSetHas = WeakSet.prototype.has;
  const originalWeakSetAdd = WeakSet.prototype.add;
  let planBuiltWithPoisonedAdd;
  let laterSession;

  try {
    WeakSet.prototype.has = () => true;
    WeakSet.prototype.add = function () { return this; };

    assert.throws(
      () => refinementSessionInternal
        .applyRefinementSessionPatchPlanToStateInternal(counted.state, forged),
      /invalid refinement patch plan.*(authentic|trusted|brand)/i
    );
    assert.deepEqual(counted.calls, []);
    assertFreshOverlayState(overlay, session, beforeSession, beforeStats);

    const genuineOverlay = createTestOverlay(session);
    refinementSessionInternal
      .applyRefinementSessionPatchPlanToStateInternal(genuineOverlay, plan);
    assert.equal(genuineOverlay.cellCount, 9);

    WeakSet.prototype.has = originalWeakSetHas;
    laterSession = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
    planBuiltWithPoisonedAdd = refinementSessionInternal
      .buildRefinementSessionPatchPlanInternal(laterSession, ["e1"], {
        hexRefinementRatio: 2,
        hexTwoToOneSelectionMode: "local"
      });
  } finally {
    WeakSet.prototype.has = originalWeakSetHas;
    WeakSet.prototype.add = originalWeakSetAdd;
  }

  const laterOverlay = createTestOverlay(laterSession);
  refinementSessionInternal
    .applyRefinementSessionPatchPlanToStateInternal(
      laterOverlay,
      planBuiltWithPoisonedAdd
    );
  assert.equal(laterOverlay.cellCount, 9);
});

test("finite geometry tampering cannot be applied", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const plan = refinementSessionInternal
    .buildRefinementSessionPatchPlanInternal(session, ["e1"], {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local"
    });
  const tampered = {
    ...plan,
    replacements: plan.replacements.map((replacement) => ({
      ...replacement,
      refinement: {
        ...replacement.refinement,
        nodes: replacement.refinement.nodes.map((point) => [...point])
      }
    }))
  };
  tampered.replacements[0].refinement.nodes[0] = [99, 99, 99];
  const overlay = createTestOverlay(session);
  const beforeSession = sessionStateSnapshot(session);
  const beforeStats = refinementSessionOverlayStats(overlay);

  assert.throws(
    () => refinementSessionInternal
      .applyRefinementSessionPatchPlanToStateInternal(overlay, tampered),
    /invalid refinement patch plan.*(authentic|trusted|brand)/i
  );
  assertFreshOverlayState(overlay, session, beforeSession, beforeStats);
});

test("active-leaf callback failures precede all patch writer mutations", () => {
  const callbacks = [
    {
      label: "nodeKey",
      options: {
        nodeKey() { throw new Error("batch node key failure"); },
        cellNodeIds: (cell) => cell.element
      },
      error: /batch node key failure/
    },
    {
      label: "cellNodeIds",
      options: {
        nodeKey: exactNodeKey,
        cellNodeIds() { throw new Error("batch cell node ids failure"); }
      },
      error: /batch cell node ids failure/
    }
  ];

  for (const { label, options, error } of callbacks) {
    const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
    const plan = refinementSessionInternal
      .buildRefinementSessionPatchPlanInternal(session, ["e1"], {
        hexRefinementRatio: 2,
        hexTwoToOneSelectionMode: "local"
      });
    const overlay = createRefinementSessionOverlay(session, options);
    const beforeSession = sessionStateSnapshot(session);
    const beforeStats = refinementSessionOverlayStats(overlay);

    assert.throws(
      () => refinementSessionInternal
        .applyRefinementSessionPatchPlanToStateInternal(overlay, plan),
      error,
      label
    );
    assertFreshOverlayState(overlay, session, beforeSession, beforeStats);
  }
});

test("prepared multi-child active batch builds exact canonical owner lists", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const plan = refinementSessionInternal
    .buildRefinementSessionPatchPlanInternal(session, ["e1"], {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local"
    });
  const overlay = createTestOverlay(session);
  const command = refinementSessionInternal
    .applyRefinementSessionPatchPlanToStateInternal(overlay, plan);
  const expectedOwners = new Map();

  for (const cellId of command.createdCellIds) {
    const cell = overlay.cell(cellId);
    const keys = new Set(cell.element.map((nodeId) =>
      exactNodeKey(overlay.node(nodeId))
    ));
    for (const key of keys) {
      const owners = expectedOwners.get(key) ?? [];
      owners.push(cellId);
      expectedOwners.set(key, owners);
    }
  }

  assert.equal(expectedOwners.size, 27);
  for (const [key, ownerIds] of expectedOwners) {
    assert.deepEqual(overlay.activeOwnersByNodeKey(key), ownerIds, key);
  }
  assert.deepEqual(
    snapshotRefinementSessionOverlayDelta(overlay).ownerOverrides
      .map(({ key, ownerIds }) => [key, [...ownerIds]])
      .sort(([first], [second]) => first.localeCompare(second)),
    [...expectedOwners]
      .sort(([first], [second]) => first.localeCompare(second))
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
    const beforeStats = refinementSessionOverlayStats(overlay);
    const counted = countStateWriterCalls(overlay);

    assert.throws(
      () => refinementSessionInternal
        .applyRefinementSessionPatchPlanToStateInternal(counted.state, plan),
      /stale|changed|mapping|active|connectivity|geometry|ordinal/i,
      label
    );
    assert.deepEqual(counted.calls, [], label);
    assertSessionStateUnchanged(session, before);
    assert.deepEqual(
      refinementSessionOverlayStats(overlay),
      beforeStats,
      label
    );
  }
});

test("patch application rejects unsafe counters and command ids before writer mutation", () => {
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local"
  };
  const cases = [
    {
      label: "max revision",
      mutateSession(session) { session.revision = Number.MAX_SAFE_INTEGER; },
      error: /revision|safe/i
    },
    {
      label: "max next command id",
      mutateSession(session) { session.nextCommandId = Number.MAX_SAFE_INTEGER; },
      error: /command|safe|counter/i
    },
    {
      label: "duplicate next command id",
      mutateSession(session) {
        session.undoStack.push({
          id: "cmd-1",
          kind: "refine",
          hiddenCellIds: [],
          createdCellIds: [],
          createdNodeIds: []
        });
      },
      error: /command|duplicate|reused/i
    },
    {
      label: "stale next cell ordinal",
      mutateSession(session) { session.nextCellOrdinal += 1; },
      error: /ordinal|counter|stale/i
    },
    {
      label: "max next cell ordinal",
      mutateSession(session) { session.nextCellOrdinal = Number.MAX_SAFE_INTEGER; },
      error: /ordinal|safe|counter/i
    }
  ];

  for (const { label, mutateSession, error } of cases) {
    const planSession = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
    const plan = refinementSessionInternal
      .buildRefinementSessionPatchPlanInternal(planSession, ["e1"], options);
    const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
    mutateSession(session);
    const before = sessionStateSnapshot(session);
    const overlay = createTestOverlay(session);
    const beforeStats = refinementSessionOverlayStats(overlay);
    const counted = countStateWriterCalls(overlay);

    assert.throws(
      () => refinementSessionInternal
        .applyRefinementSessionPatchPlanToStateInternal(counted.state, plan),
      error,
      label
    );
    assert.deepEqual(counted.calls, [], label);
    assert.deepEqual(refinementSessionOverlayStats(overlay), beforeStats, label);
    assertSessionStateUnchanged(session, before);
  }

  const planSession = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const plan = refinementSessionInternal
    .buildRefinementSessionPatchPlanInternal(planSession, ["e1"], options);
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const before = sessionStateSnapshot(session);
  const overlay = createTestOverlay(session);
  const beforeStats = refinementSessionOverlayStats(overlay);
  const counted = countStateWriterCalls(overlay, {
    cellCount: Number.MAX_SAFE_INTEGER - 4,
    nextCellOrdinal: Number.MAX_SAFE_INTEGER - 3
  });

  assert.throws(
    () => refinementSessionInternal
      .applyRefinementSessionPatchPlanToStateInternal(counted.state, plan),
    /ordinal|range|safe|counter/i
  );
  assert.deepEqual(counted.calls, []);
  assert.deepEqual(refinementSessionOverlayStats(overlay), beforeStats);
  assertSessionStateUnchanged(session, before);
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

test("overlay history restore rewinds only speculative commands and command ids", () => {
  assert.equal(
    typeof refinementSessionOverlayInternal.checkpointRefinementSessionOverlayHistory,
    "function"
  );
  assert.equal(
    typeof refinementSessionOverlayInternal.restoreRefinementSessionOverlayHistory,
    "function"
  );

  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const originalCommand = { id: "original-command", kind: "original" };
  const redoCommand = { id: "redo-command", kind: "redo" };
  session.undoStack.push(originalCommand);
  session.redoStack.push(redoCommand);
  const overlay = createTestOverlay(session);
  const retainedCommand = { id: "retained-command", kind: "retained" };
  overlay.appendUndoCommand(retainedCommand);
  overlay.setNextCommandId(session.nextCommandId + 1);
  const checkpointNextCommandId = overlay.nextCommandId;
  const checkpoint = refinementSessionOverlayInternal
    .checkpointRefinementSessionOverlayHistory(overlay);

  assert.ok(Object.isFrozen(checkpoint));
  const temporaryCommands = [
    { id: "temporary-shell", kind: "shell" },
    { id: "temporary-current", kind: "current" }
  ];
  for (const command of temporaryCommands) overlay.appendUndoCommand(command);
  overlay.setNextCommandId(checkpointNextCommandId + temporaryCommands.length);
  overlay.clearRedoCommands();

  const parent = overlay.mutableCell("e1");
  parent.active = false;
  parent.hidden = true;
  const appendedNodeId = overlay.appendNode([0.25, 0.5, 0.75]);
  const created = cloneCell(
    parent,
    "checkpoint-created",
    overlay.allocateCellOrdinal()
  );
  created.active = true;
  created.hidden = false;
  created.element = [...created.element.slice(0, -1), appendedNodeId];
  overlay.setCell(created);
  overlay.removeActiveLeaf("e1");
  overlay.addActiveLeaf(created.id);
  const laterOrdinal = overlay.allocateCellOrdinal();
  const beforeRestoreStats = refinementSessionOverlayStats(overlay);
  const beforeRestoreOwners = [...overlay.storage.ownerOverridesByNodeKey]
    .map(([key, ownerIds]) => [key, [...ownerIds]]);
  const beforeRestoreRevision = session.revision;

  refinementSessionOverlayInternal.restoreRefinementSessionOverlayHistory(
    overlay,
    checkpoint
  );

  assert.deepEqual([...overlay.undoCommands()], [originalCommand, retainedCommand]);
  assert.deepEqual(overlay.storage.appendedUndoCommands, [retainedCommand]);
  assert.equal(overlay.nextCommandId, checkpointNextCommandId);
  assert.equal(overlay.storage.clearRedo, true);
  assert.deepEqual([...overlay.redoCommands()], []);
  assert.deepEqual(refinementSessionOverlayStats(overlay), beforeRestoreStats);
  assert.equal(overlay.nodeCount, session.nodes.length + 1);
  assert.deepEqual(overlay.node(appendedNodeId), [0.25, 0.5, 0.75]);
  assert.strictEqual(overlay.cell(created.id), created);
  assert.equal(overlay.hasActiveLeaf("e1"), false);
  assert.equal(overlay.hasActiveLeaf(created.id), true);
  assert.deepEqual(
    [...overlay.storage.ownerOverridesByNodeKey]
      .map(([key, ownerIds]) => [key, [...ownerIds]]),
    beforeRestoreOwners
  );
  assert.equal(overlay.sortedActiveLeafIdsDirty, true);
  assert.equal(overlay.nextCellOrdinal, laterOrdinal + 1);
  assert.equal(session.revision, beforeRestoreRevision);
});

test("overlay history owns deeply frozen command snapshots across restore and commit", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const beforeCommit = sessionStateSnapshot(session);
  const overlay = createTestOverlay(session);
  const command = {
    id: "retained-command",
    kind: "refine",
    hiddenCellIds: ["e1"],
    createdCellIds: ["e2"],
    createdNodeIds: [9],
    quality: {
      ok: true,
      parentElementCount: 1,
      childElementCount: 8,
      parentOrientedVolume: 1,
      childOrientedVolume: 1,
      relativeVolumeError: 0,
      parentMinimumOrientedScaledJacobian: 1,
      childMinimumOrientedScaledJacobian: 0.75
    },
    twoToOne: {
      status: "compensated",
      topologyClass: "mixed-level",
      originalSelectedCellIds: ["e1"],
      effectiveSelectedCellIds: ["e1", "e2"],
      actions: [{
        kind: "transition-shell-rebuild",
        reason: "preserve local balance",
        addedParentCellIds: ["e2"],
        replacedTransitionCellIds: ["e3"]
      }],
      affectedComponentCellIds: ["e1", "e2", "e3"],
      preservedFarFieldCellCount: 4
    },
    recipe: {
      version: 1,
      selectedCellIds: ["e1"],
      selectedCellGeometry: [{
        originalCellId: "e1",
        kind: "hex",
        level: 0,
        role: "regular",
        points: [[0, 0, 0], [1, 0, 0]]
      }],
      transitionSupportCellIds: ["e3"],
      transitionSupportCellGeometry: [],
      options: {
        includeTransitions: true,
        hexRefinementRatio: 2,
        hexTwoToOneSelectionMode: "local",
        hexTwoToOneCompensation: {
          mode: "local-topology",
          maxAddedParentLayers: 1,
          maxAddedParentCount: 8
        },
        rebuildExistingTransitions: true
      }
    }
  };
  const expectedCommand = structuredClone(command);

  overlay.appendUndoCommand(command);
  const retainedCommand = overlay.storage.appendedUndoCommands[0];
  const checkpoint = refinementSessionOverlayInternal
    .checkpointRefinementSessionOverlayHistory(overlay);
  overlay.appendUndoCommand({ id: "temporary-command" });

  command.quality.ok = false;
  command.twoToOne.actions[0].addedParentCellIds[0] = "mutated-parent";
  command.recipe.selectedCellGeometry[0].points[0][0] = 99;
  command.recipe.options.hexTwoToOneCompensation.mode = "none";

  refinementSessionOverlayInternal.restoreRefinementSessionOverlayHistory(
    overlay,
    checkpoint
  );

  assertSessionStateUnchanged(session, beforeCommit);
  assert.strictEqual(overlay.storage.appendedUndoCommands[0], retainedCommand);
  assert.notStrictEqual(retainedCommand, command);
  assert.deepEqual(retainedCommand, expectedCommand);
  assertDeeplyFrozenPlainValue(retainedCommand);
  assert.throws(() => {
    retainedCommand.twoToOne.actions[0].reason = "mutated through overlay";
  }, TypeError);

  const delta = snapshotRefinementSessionOverlayDelta(overlay);
  assertSessionStateUnchanged(session, beforeCommit);
  commitRefinementSessionOverlay(session, delta);

  const committedCommand = session.undoStack.at(-1);
  assert.deepEqual(committedCommand, expectedCommand);
  assertDeeplyFrozenPlainValue(committedCommand);
});

test("restored overlay commits retained history plus one final compound command", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  session.undoStack.push({ id: "original-command", kind: "original" });
  session.redoStack.push({ id: "redo-command", kind: "redo" });
  const overlay = createTestOverlay(session);
  overlay.appendUndoCommand({ id: "retained-command", kind: "retained" });
  overlay.setNextCommandId(session.nextCommandId + 1);
  const checkpoint = refinementSessionOverlayInternal
    .checkpointRefinementSessionOverlayHistory(overlay);

  overlay.appendUndoCommand({ id: "temporary-shell", kind: "shell" });
  overlay.appendUndoCommand({ id: "temporary-current", kind: "current" });
  overlay.setNextCommandId(overlay.nextCommandId + 2);
  overlay.clearRedoCommands();
  refinementSessionOverlayInternal.restoreRefinementSessionOverlayHistory(
    overlay,
    checkpoint
  );

  const compoundCommand = {
    id: "final-compound",
    kind: "compound",
    commandIds: ["temporary-shell", "temporary-current"]
  };
  overlay.appendUndoCommand(compoundCommand);
  overlay.setNextCommandId(overlay.nextCommandId + 1);
  const delta = snapshotRefinementSessionOverlayDelta(overlay);
  const beforeRevision = session.revision;

  assert.deepEqual(
    delta.appendedUndoCommands.map((command) => command.id),
    ["retained-command", "final-compound"]
  );
  commitRefinementSessionOverlay(session, delta);

  assert.deepEqual(
    session.undoStack.map((command) => command.id),
    ["original-command", "retained-command", "final-compound"]
  );
  assert.equal(
    session.undoStack.some((command) =>
      command.id === "temporary-shell" || command.id === "temporary-current"
    ),
    false
  );
  assert.equal(session.revision, beforeRevision + 1);
  assert.deepEqual(session.redoStack, []);
  assert.equal(session.nextCommandId, 3);
});

test("overlay history checkpoints reject wrong owners, forgery, and reuse", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  overlay.appendUndoCommand({ id: "retained-command" });
  const checkpoint = refinementSessionOverlayInternal
    .checkpointRefinementSessionOverlayHistory(overlay);
  overlay.appendUndoCommand({ id: "temporary-command" });
  overlay.setNextCommandId(11);
  const fork = forkRefinementSessionOverlay(overlay);
  const other = createTestOverlay(session);
  other.appendUndoCommand({ id: "other-command" });
  other.setNextCommandId(22);

  for (const wrongOverlay of [fork, other]) {
    const beforeCommands = [...wrongOverlay.storage.appendedUndoCommands];
    const beforeNextCommandId = wrongOverlay.nextCommandId;
    assert.throws(
      () => refinementSessionOverlayInternal
        .restoreRefinementSessionOverlayHistory(wrongOverlay, checkpoint),
      /different overlay|registered|invalid/i
    );
    assert.deepEqual(wrongOverlay.storage.appendedUndoCommands, beforeCommands);
    assert.equal(wrongOverlay.nextCommandId, beforeNextCommandId);
  }

  const forgedCheckpoint = Object.freeze({});
  const beforeForgeryCommands = [...overlay.storage.appendedUndoCommands];
  const beforeForgeryNextCommandId = overlay.nextCommandId;
  assert.throws(
    () => refinementSessionOverlayInternal
      .restoreRefinementSessionOverlayHistory(overlay, forgedCheckpoint),
    /forged|invalid|consumed/i
  );
  assert.deepEqual(overlay.storage.appendedUndoCommands, beforeForgeryCommands);
  assert.equal(overlay.nextCommandId, beforeForgeryNextCommandId);

  refinementSessionOverlayInternal.restoreRefinementSessionOverlayHistory(
    overlay,
    checkpoint
  );
  const afterRestoreCommands = [...overlay.storage.appendedUndoCommands];
  const afterRestoreNextCommandId = overlay.nextCommandId;
  assert.throws(
    () => refinementSessionOverlayInternal
      .restoreRefinementSessionOverlayHistory(overlay, checkpoint),
    /forged|invalid|consumed/i
  );
  assert.deepEqual(overlay.storage.appendedUndoCommands, afterRestoreCommands);
  assert.equal(overlay.nextCommandId, afterRestoreNextCommandId);
});

test("overlay history restore accepts an older compatible checkpoint", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  const retainedCommand = { id: "retained-command" };
  overlay.appendUndoCommand(retainedCommand);
  overlay.setNextCommandId(7);
  const olderCheckpoint = refinementSessionOverlayInternal
    .checkpointRefinementSessionOverlayHistory(overlay);

  overlay.appendUndoCommand({ id: "middle-command" });
  overlay.setNextCommandId(8);
  const newerCheckpoint = refinementSessionOverlayInternal
    .checkpointRefinementSessionOverlayHistory(overlay);
  overlay.appendUndoCommand({ id: "temporary-command" });
  overlay.setNextCommandId(9);

  refinementSessionOverlayInternal.restoreRefinementSessionOverlayHistory(
    overlay,
    olderCheckpoint
  );

  assert.deepEqual(overlay.storage.appendedUndoCommands, [retainedCommand]);
  assert.equal(overlay.nextCommandId, 7);
  const beforeStaleCommands = [...overlay.storage.appendedUndoCommands];
  const beforeStaleNextCommandId = overlay.nextCommandId;
  assert.throws(
    () => refinementSessionOverlayInternal
      .restoreRefinementSessionOverlayHistory(overlay, newerCheckpoint),
    /shorter|prefix|stale/i
  );
  assert.deepEqual(overlay.storage.appendedUndoCommands, beforeStaleCommands);
  assert.equal(overlay.nextCommandId, beforeStaleNextCommandId);
});

test("overlay history restore rejects live base staleness atomically", () => {
  const staleCases = [
    ["revision", (session) => {
      const original = session.revision;
      session.revision += 1;
      return () => { session.revision = original; };
    }],
    ["nodes identity", (session) => {
      const original = session.nodes;
      session.nodes = [...session.nodes];
      return () => { session.nodes = original; };
    }],
    ["node count", (session) => {
      session.nodes.push([...session.nodes[0]]);
      return () => { session.nodes.pop(); };
    }],
    ["cells identity", (session) => {
      const original = session.cells;
      session.cells = new Map(session.cells);
      return () => { session.cells = original; };
    }],
    ["cell count", (session) => {
      session.cells.set("external-cell", session.cells.get("e1"));
      return () => { session.cells.delete("external-cell"); };
    }],
    ["active leaf identity", (session) => {
      const original = session.activeLeafIds;
      session.activeLeafIds = new Set(session.activeLeafIds);
      return () => { session.activeLeafIds = original; };
    }],
    ["active leaf count", (session) => {
      session.activeLeafIds.add("external-cell");
      return () => { session.activeLeafIds.delete("external-cell"); };
    }],
    ["owner map identity", (session) => {
      const original = session.activeLeafIdsByNodeKey;
      session.activeLeafIdsByNodeKey = new Map(session.activeLeafIdsByNodeKey);
      return () => { session.activeLeafIdsByNodeKey = original; };
    }],
    ["owner map count", (session) => {
      session.activeLeafIdsByNodeKey.set("external-node", []);
      return () => { session.activeLeafIdsByNodeKey.delete("external-node"); };
    }],
    ["sorted active identity", (session) => {
      const original = session.sortedActiveLeafIds;
      session.sortedActiveLeafIds = [...session.sortedActiveLeafIds];
      return () => { session.sortedActiveLeafIds = original; };
    }],
    ["sorted active count", (session) => {
      session.sortedActiveLeafIds.push("external-cell");
      return () => { session.sortedActiveLeafIds.pop(); };
    }],
    ["sorted active dirty flag", (session) => {
      const original = session.sortedActiveLeafIdsDirty;
      session.sortedActiveLeafIdsDirty = !original;
      return () => { session.sortedActiveLeafIdsDirty = original; };
    }],
    ["undo stack identity", (session) => {
      const original = session.undoStack;
      session.undoStack = [...session.undoStack];
      return () => { session.undoStack = original; };
    }],
    ["undo stack length", (session) => {
      session.undoStack.push({ id: "external-undo" });
      return () => { session.undoStack.pop(); };
    }],
    ["redo stack identity", (session) => {
      const original = session.redoStack;
      session.redoStack = [...session.redoStack];
      return () => { session.redoStack = original; };
    }],
    ["redo stack length", (session) => {
      session.redoStack.push({ id: "external-redo" });
      return () => { session.redoStack.pop(); };
    }],
    ["next command id", (session) => {
      const original = session.nextCommandId;
      session.nextCommandId += 1;
      return () => { session.nextCommandId = original; };
    }],
    ["next cell ordinal", (session) => {
      const original = session.nextCellOrdinal;
      session.nextCellOrdinal += 1;
      return () => { session.nextCellOrdinal = original; };
    }]
  ];

  for (const [label, makeStale] of staleCases) {
    const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
    const overlay = createTestOverlay(session);
    const retainedCommand = { id: `retained-${label}` };
    overlay.appendUndoCommand(retainedCommand);
    overlay.setNextCommandId(13);
    const checkpoint = refinementSessionOverlayInternal
      .checkpointRefinementSessionOverlayHistory(overlay);
    overlay.appendUndoCommand({ id: `temporary-${label}` });
    overlay.setNextCommandId(14);
    const beforeCommands = overlay.storage.appendedUndoCommands;
    const beforeCommandValues = [...beforeCommands];
    const beforeNextCommandId = overlay.nextCommandId;
    const restoreBase = makeStale(session);

    assert.throws(
      () => refinementSessionOverlayInternal
        .restoreRefinementSessionOverlayHistory(overlay, checkpoint),
      /base|stale|changed/i,
      label
    );
    assert.strictEqual(overlay.storage.appendedUndoCommands, beforeCommands, label);
    assert.deepEqual(overlay.storage.appendedUndoCommands, beforeCommandValues, label);
    assert.equal(overlay.nextCommandId, beforeNextCommandId, label);

    restoreBase();
    refinementSessionOverlayInternal.restoreRefinementSessionOverlayHistory(
      overlay,
      checkpoint
    );
    assert.deepEqual(overlay.storage.appendedUndoCommands, [retainedCommand], label);
    assert.equal(overlay.nextCommandId, 13, label);
  }
});

test("overlay history checkpoints reject stale or shortened prefixes atomically", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const staleOverlay = createTestOverlay(session);
  const retainedCommand = { id: "retained-command" };
  staleOverlay.appendUndoCommand(retainedCommand);
  const ownedRetainedCommand = staleOverlay.storage.appendedUndoCommands[0];
  const staleCheckpoint = refinementSessionOverlayInternal
    .checkpointRefinementSessionOverlayHistory(staleOverlay);
  staleOverlay.appendUndoCommand({ id: "temporary-command" });
  staleOverlay.setNextCommandId(19);
  staleOverlay.storage.appendedUndoCommands[0] = { id: "replacement-command" };
  const beforeStaleCommands = [...staleOverlay.storage.appendedUndoCommands];
  const beforeStaleNextCommandId = staleOverlay.nextCommandId;

  assert.throws(
    () => refinementSessionOverlayInternal
      .restoreRefinementSessionOverlayHistory(staleOverlay, staleCheckpoint),
    /prefix|changed|stale/i
  );
  assert.deepEqual(staleOverlay.storage.appendedUndoCommands, beforeStaleCommands);
  assert.equal(staleOverlay.nextCommandId, beforeStaleNextCommandId);

  staleOverlay.storage.appendedUndoCommands[0] = ownedRetainedCommand;
  refinementSessionOverlayInternal.restoreRefinementSessionOverlayHistory(
    staleOverlay,
    staleCheckpoint
  );
  assert.deepEqual(staleOverlay.storage.appendedUndoCommands, [retainedCommand]);

  const shortOverlay = createTestOverlay(session);
  shortOverlay.appendUndoCommand({ id: "retained-command" });
  const shortCheckpoint = refinementSessionOverlayInternal
    .checkpointRefinementSessionOverlayHistory(shortOverlay);
  shortOverlay.storage.appendedUndoCommands.length = 0;
  shortOverlay.setNextCommandId(23);
  const beforeShortCommands = [...shortOverlay.storage.appendedUndoCommands];
  const beforeShortNextCommandId = shortOverlay.nextCommandId;

  assert.throws(
    () => refinementSessionOverlayInternal
      .restoreRefinementSessionOverlayHistory(shortOverlay, shortCheckpoint),
    /shorter|prefix|stale/i
  );
  assert.deepEqual(shortOverlay.storage.appendedUndoCommands, beforeShortCommands);
  assert.equal(shortOverlay.nextCommandId, beforeShortNextCommandId);
});

test("overlay history restore prevalidates truncation and resists token prototype poisoning", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const hostileOverlay = createTestOverlay(session);
  hostileOverlay.appendUndoCommand({ id: "retained-command" });
  const hostileCheckpoint = refinementSessionOverlayInternal
    .checkpointRefinementSessionOverlayHistory(hostileOverlay);
  const hostileCommand = { id: "non-configurable-temporary-command" };
  hostileOverlay.appendUndoCommand(hostileCommand);
  hostileOverlay.setNextCommandId(29);
  Object.defineProperty(hostileOverlay.storage.appendedUndoCommands, "1", {
    configurable: false,
    enumerable: true,
    writable: true,
    value: hostileCommand
  });
  const beforeHostileCommands = [...hostileOverlay.storage.appendedUndoCommands];
  const beforeHostileNextCommandId = hostileOverlay.nextCommandId;

  assert.throws(
    () => refinementSessionOverlayInternal
      .restoreRefinementSessionOverlayHistory(hostileOverlay, hostileCheckpoint),
    /truncate|safe|configurable/i
  );
  assert.deepEqual(hostileOverlay.storage.appendedUndoCommands, beforeHostileCommands);
  assert.equal(hostileOverlay.nextCommandId, beforeHostileNextCommandId);

  const overlay = createTestOverlay(session);
  const checkpoint = refinementSessionOverlayInternal
    .checkpointRefinementSessionOverlayHistory(overlay);
  overlay.appendUndoCommand({ id: "temporary-command" });
  overlay.setNextCommandId(31);
  const forgedCheckpoint = Object.freeze({});
  const originalWeakMapGet = WeakMap.prototype.get;
  let poisonedError;

  Object.prototype.owner = overlay;
  WeakMap.prototype.get = function forgedWeakMapGet() {
    return { owner: overlay, commandLength: 0, nextCommandId: 0 };
  };
  try {
    assert.throws(
      () => refinementSessionOverlayInternal
        .restoreRefinementSessionOverlayHistory(overlay, forgedCheckpoint),
      (error) => {
        poisonedError = error;
        return /intrinsic|prototype|invalid/i.test(error.message);
      }
    );
  } finally {
    WeakMap.prototype.get = originalWeakMapGet;
    delete Object.prototype.owner;
  }
  assert.ok(poisonedError instanceof Error);
  assert.deepEqual(
    overlay.storage.appendedUndoCommands.map((command) => command.id),
    ["temporary-command"]
  );
  assert.equal(overlay.nextCommandId, 31);

  refinementSessionOverlayInternal.restoreRefinementSessionOverlayHistory(
    overlay,
    checkpoint
  );
  assert.deepEqual(overlay.storage.appendedUndoCommands, []);
  assert.equal(overlay.nextCommandId, session.nextCommandId);
});

test("overlay history intrinsic validation does not invoke poisoned accessors", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const overlay = createTestOverlay(session);
  overlay.appendUndoCommand({ id: "retained-command" });
  const checkpoint = refinementSessionOverlayInternal
    .checkpointRefinementSessionOverlayHistory(overlay);
  overlay.appendUndoCommand({ id: "temporary-command" });
  overlay.setNextCommandId(41);
  const beforeCommands = overlay.storage.appendedUndoCommands;
  const beforeCommandValues = [...beforeCommands];
  const beforeNextCommandId = overlay.nextCommandId;
  const pushDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "push");
  let accessorCalls = 0;
  let restoreError;

  Object.defineProperty(Array.prototype, "push", {
    configurable: true,
    get() {
      accessorCalls += 1;
      overlay.storage.appendedUndoCommands.length = 0;
      overlay.storage.nextCommandId = 999;
      return pushDescriptor.value;
    }
  });
  try {
    refinementSessionOverlayInternal.restoreRefinementSessionOverlayHistory(
      overlay,
      checkpoint
    );
  } catch (error) {
    restoreError = error;
  } finally {
    Object.defineProperty(Array.prototype, "push", pushDescriptor);
  }

  assert.ok(restoreError instanceof Error);
  assert.match(restoreError.message, /intrinsic|prototype|invalid/i);
  assert.equal(accessorCalls, 0);
  assert.strictEqual(overlay.storage.appendedUndoCommands, beforeCommands);
  assert.deepEqual(overlay.storage.appendedUndoCommands, beforeCommandValues);
  assert.equal(overlay.nextCommandId, beforeNextCommandId);
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

test("conformance certificate is revision, tolerance, identity, and length scoped", () => {
  const metadata = {
    tolerance: 1e-9,
    coordinateScale: 2,
    minimumElementEdgeLength: 0.5
  };

  for (const invalidate of [
    (session) => { session.revision += 1; },
    (session) => { session.nodes = [...session.nodes]; },
    (session) => { session.cells = new Map(session.cells); },
    (session) => { session.activeLeafIds = new Set(session.activeLeafIds); },
    (session) => { session.nodes.push([2, 2, 2]); },
    (session) => { session.cells.delete("e1"); },
    (session) => { session.activeLeafIds.delete("e1"); }
  ]) {
    const session = createRefinementSession(createHexUnitCubeMesh(2, 2, 2));
    const certificate = certifyRefinementSessionBaseline(session, metadata);
    publishRefinementSessionConformanceCertificate(session, certificate);

    assert.strictEqual(
      refinementSessionConformanceCertificate(session, metadata.tolerance),
      certificate
    );
    assert.equal(
      refinementSessionConformanceCertificate(session, metadata.tolerance * 10),
      undefined
    );

    invalidate(session);
    assert.equal(
      refinementSessionConformanceCertificate(session, metadata.tolerance),
      undefined
    );
  }
});

test("baseline conformance wrapper audits once and rejects failing reports", () => {
  const metadata = {
    tolerance: 1e-9,
    coordinateScale: 1,
    minimumElementEdgeLength: 0.5
  };
  const session = createRefinementSession(createHexUnitCubeMesh(2, 2, 2));
  let auditCount = 0;
  const buildAndCheck = () => {
    auditCount += 1;
    return { ok: true, hanging: [], unmatchedInteriorBoundaryCount: 0 };
  };

  const first = ensureRefinementSessionBaselineConformanceCertificate(
    session,
    metadata,
    buildAndCheck
  );
  const second = ensureRefinementSessionBaselineConformanceCertificate(
    session,
    metadata,
    buildAndCheck
  );

  assert.strictEqual(second, first);
  assert.equal(auditCount, 1);
  assert.equal(Object.isFrozen(first), true);

  const failingSession = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  assert.throws(
    () => ensureRefinementSessionBaselineConformanceCertificate(
      failingSession,
      metadata,
      () => ({
        ok: false,
        hanging: [{
          kind: "node-on-edge",
          nodeId: 9,
          ownerElementId: 1,
          otherElementId: 2,
          boundary: [1, 2],
          otherBoundary: [1, 9, 2],
          message: "test hanging node"
        }],
        unmatchedInteriorBoundaryCount: 0
      })
    ),
    /conform|hanging|audit/i
  );
  assert.equal(
    refinementSessionConformanceCertificate(failingSession, metadata.tolerance),
    undefined
  );
});
