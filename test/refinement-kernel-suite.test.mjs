import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// HexRefine project refinement kernel suite.
// This file intentionally stays within the project-local runtime build.

import * as api from "../dist/index.js";
import {
  pattern3PairTemplateLibrary,
  regularSweepTemplateLibrary
} from "../dist/two-to-one-sweep-templates.js";
import {
  buildDirectTwoToOneHexPlan,
  buildTwoToOneHexReplacements
} from "../dist/two-to-one.js";
const {
  auditHexRefinementPatchQuality,
  findBoundaryPairs,
  checkNoHangingNodes,
  minElementEdgeLength,
  boxDistance,
  circleDistance,
  createHexUnitCubeMesh,
  createQ1UnitSquareMesh,
  createRefinementSession,
  previewSessionPatch,
  previewRefinementByDistanceFunction,
  previewRefinementByBox,
  previewRefinementByElementIds,
  prepareSessionRefineSelection,
  refineByElementIds,
  refineByElementIdsWithReport,
  activeBuildCellIdByElementId,
  activeBuildElementIdByCellId,
  buildActiveMesh,
  buildActiveMeshWithMap,
  buildRefinementSessionExport,
  buildDefaultRefinementPlan,
  buildDefaultRefinementReplacements,
  buildHexClassifiedPlan,
  buildRefinementReplacements,
  checkRefinementSessionCommandConformance,
  validateRefinementSessionSelection,
  refineByBox,
  refineByDistanceFunctionWithReport,
  refineByBoxWithReport,
  defaultRefinementPlanner,
  meshToLsdynaKeyword,
  minimumOrientedHexCornerScaledJacobian,
  cloneTwoToOneCapabilityReport,
  normalizeTwoToOneCompensation,
  replayHexRefineCommandScript,
  parseMeshText,
  refineHexTo13Hex,
  refineHexTo27Hex,
  refineHexTo5Hex,
  refineHexTo8Hex,
  redoRefinementSession,
  regularizeHexSessionSelection,
  regularizeHexSelection,
  regularizeTwoToOneHexSelection,
  remapSessionSetsToActiveMesh,
  serializeTwoToOnePlanningError,
  refineQ1To3x3,
  refineQ1To4Q1,
  refineQ1To5Q1,
  refineSessionCell,
  refineSessionCells,
  refineSessionPatch,
  growQ1BoundaryLayer,
  replaceQ1BlockWithRectangleCircleTemplate,
  DirectTwoToOnePlanningError,
  TwoToOnePlanningError,
  undoRefinementSession
} = api;

function mutatePlanningDiagnostic(diagnostic) {
  diagnostic.conflictingCellIds.push(99);
  diagnostic.conflictingInterfaces[0].firstCellId = 99;
  diagnostic.conflictingInterfaces[0].secondCellId = 98;
  diagnostic.conflictingInterfaces[0].faceNodeIds.push(99);
  diagnostic.conflictingInterfaces.push({
    firstCellId: 97,
    faceNodeIds: [5, 6, 7, 8]
  });
  diagnostic.attemptedActions[0].kind = "local-template";
  diagnostic.attemptedActions[0].reason = "mutated";
  diagnostic.attemptedActions[0].addedParentCellIds.push(96);
  diagnostic.attemptedActions[0].replacedTransitionCellIds.push(95);
  diagnostic.attemptedActions[0].templateId = "mutated-template";
  diagnostic.attemptedActions.push({
    kind: "transition-shell-rebuild",
    reason: "mutated action list",
    addedParentCellIds: [94],
    replacedTransitionCellIds: [93]
  });
  diagnostic.suggestion.kind = "reduce-level";
  diagnostic.suggestion.axis = 2;
  diagnostic.suggestion.side = -1;
  diagnostic.suggestion.parentCellIds.push(92);
}

function captureError(operation) {
  try {
    operation();
  } catch (error) {
    return error;
  }
  assert.fail("expected operation to throw");
}

test("Hex 2:1 capability reports deep-clone string id arrays and actions", () => {
  const report = {
    status: "compensated",
    topologyClass: "mixed-level",
    originalSelectedCellIds: ["e1/c1"],
    effectiveSelectedCellIds: ["e1/c2"],
    actions: [{
      kind: "transition-shell-rebuild",
      reason: "test",
      addedParentCellIds: ["e2"],
      replacedTransitionCellIds: ["e3"],
      templateId: "shell-template"
    }],
    affectedComponentCellIds: ["e1/c1", "e2", "e3"],
    preservedFarFieldCellCount: 12
  };
  const command = { twoToOne: report };
  const clonedCommand = {
    twoToOne: cloneTwoToOneCapabilityReport(command.twoToOne)
  };

  command.twoToOne.originalSelectedCellIds.push("mutated-original");
  command.twoToOne.effectiveSelectedCellIds.push("mutated-effective");
  command.twoToOne.affectedComponentCellIds.push("mutated-affected");
  command.twoToOne.actions[0].reason = "mutated";
  command.twoToOne.actions[0].addedParentCellIds.push("mutated-added");
  command.twoToOne.actions[0].replacedTransitionCellIds.push("mutated-replaced");
  command.twoToOne.actions.push({
    kind: "local-template",
    reason: "mutated action",
    addedParentCellIds: [],
    replacedTransitionCellIds: []
  });

  assert.deepEqual(clonedCommand.twoToOne, {
    status: "compensated",
    topologyClass: "mixed-level",
    originalSelectedCellIds: ["e1/c1"],
    effectiveSelectedCellIds: ["e1/c2"],
    actions: [{
      kind: "transition-shell-rebuild",
      reason: "test",
      addedParentCellIds: ["e2"],
      replacedTransitionCellIds: ["e3"],
      templateId: "shell-template"
    }],
    affectedComponentCellIds: ["e1/c1", "e2", "e3"],
    preservedFarFieldCellCount: 12
  });
});

test("Direct 2:1 planning errors copy conflicting element ids", () => {
  const conflictingElementIds = [9, 4];
  const error = new DirectTwoToOnePlanningError(
    "selection-signature",
    "selection cannot close",
    conflictingElementIds
  );
  conflictingElementIds.push(12);

  assert.equal(error.name, "DirectTwoToOnePlanningError");
  assert.equal(error.kind, "selection-signature");
  assert.equal(error.message, "selection cannot close");
  assert.deepEqual(error.conflictingElementIds, [9, 4]);
});

test("Hex 2:1 compensation options have bounded deterministic defaults", () => {
  assert.deepEqual(
    normalizeTwoToOneCompensation(8, {}),
    {
      mode: "local-topology",
      maxAddedParentLayers: 1,
      maxAddedParentCount: 32
    }
  );
  assert.deepEqual(
    normalizeTwoToOneCompensation(200, {
      hexTwoToOneCompensation: {
        mode: "selection",
        maxAddedParentLayers: 2,
        maxAddedParentCount: 17
      }
    }),
    {
      mode: "selection",
      maxAddedParentLayers: 2,
      maxAddedParentCount: 17
    }
  );
  assert.equal(
    normalizeTwoToOneCompensation(200, {}).maxAddedParentCount,
    50
  );
  assert.equal(
    normalizeTwoToOneCompensation(201, {}).maxAddedParentCount,
    51
  );
  assert.equal(
    normalizeTwoToOneCompensation(8, {
      hexTwoToOneCompensation: { mode: "none" }
    }).mode,
    "none"
  );
  assert.equal(
    normalizeTwoToOneCompensation(8, {
      hexTwoToOneCompensation: { mode: "selection" },
      rebuildExistingTransitions: false
    }).mode,
    "none"
  );
  assert.equal(
    normalizeTwoToOneCompensation(8, {
      hexTwoToOneCompensation: { mode: "selection" },
      rebuildExistingTransitions: true
    }).mode,
    "selection"
  );
  assert.equal(
    normalizeTwoToOneCompensation(8, {
      hexTwoToOneCompensation: { mode: "none" },
      rebuildExistingTransitions: true
    }).mode,
    "none"
  );
});

test("Hex 2:1 compensation options read own properties exactly once", () => {
  let modeReadCount = 0;
  const compensation = Object.defineProperty({}, "mode", {
    configurable: true,
    enumerable: true,
    get() {
      modeReadCount += 1;
      return modeReadCount === 1 ? "none" : "automatic";
    }
  });

  const normalized = normalizeTwoToOneCompensation(8, {
    hexTwoToOneCompensation: compensation
  });

  assert.equal(normalized.mode, "none");
  assert.equal(modeReadCount, 1);
});

test("Hex 2:1 compensation options ignore inherited compatibility properties", () => {
  const originalMode = Object.getOwnPropertyDescriptor(Object.prototype, "mode");
  const originalRebuild = Object.getOwnPropertyDescriptor(
    Object.prototype,
    "rebuildExistingTransitions"
  );

  try {
    Object.defineProperty(Object.prototype, "mode", {
      configurable: true,
      writable: true,
      value: "none"
    });
    Object.defineProperty(Object.prototype, "rebuildExistingTransitions", {
      configurable: true,
      writable: true,
      value: false
    });

    assert.equal(
      normalizeTwoToOneCompensation(8, {
        hexTwoToOneCompensation: {},
        rebuildExistingTransitions: true
      }).mode,
      "local-topology"
    );
    assert.equal(
      normalizeTwoToOneCompensation(8, {
        hexTwoToOneCompensation: { mode: "selection" }
      }).mode,
      "selection"
    );
  } finally {
    if (originalMode === undefined) {
      delete Object.prototype.mode;
    } else {
      Object.defineProperty(Object.prototype, "mode", originalMode);
    }
    if (originalRebuild === undefined) {
      delete Object.prototype.rebuildExistingTransitions;
    } else {
      Object.defineProperty(
        Object.prototype,
        "rebuildExistingTransitions",
        originalRebuild
      );
    }
  }
});

test("Hex 2:1 compensation options reject invalid runtime input", () => {
  for (const count of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => normalizeTwoToOneCompensation(count, {}),
      RangeError
    );
  }

  for (const options of [null, [], new Date(), () => undefined]) {
    assert.throws(
      () => normalizeTwoToOneCompensation(8, options),
      TypeError
    );
  }

  for (const compensation of [null, [], new Date()]) {
    assert.throws(
      () => normalizeTwoToOneCompensation(8, {
        hexTwoToOneCompensation: compensation
      }),
      TypeError
    );
  }

  assert.throws(
    () => normalizeTwoToOneCompensation(8, {
      hexTwoToOneCompensation: { mode: "automatic" }
    }),
    TypeError
  );
  assert.throws(
    () => normalizeTwoToOneCompensation(8, {
      rebuildExistingTransitions: "false"
    }),
    TypeError
  );

  for (const limit of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => normalizeTwoToOneCompensation(8, {
        hexTwoToOneCompensation: { maxAddedParentLayers: limit }
      }),
      RangeError
    );
    assert.throws(
      () => normalizeTwoToOneCompensation(8, {
        hexTwoToOneCompensation: { maxAddedParentCount: limit }
      }),
      RangeError
    );
  }
});

test("Hex 2:1 structured planning errors retain machine-readable diagnostics", () => {
  const diagnostic = {
    conflictingCellIds: [11, 12],
    conflictingInterfaces: [],
    attemptedActions: [],
    suggestion: {
      kind: "expand-selection",
      axis: 1,
      side: 1,
      parentCellIds: [13]
    }
  };
  const error = new TwoToOnePlanningError(
    "TWO_TO_ONE_UNSUPPORTED_PARITY",
    "odd periodic transition field",
    diagnostic
  );

  assert.equal(error.name, "TwoToOnePlanningError");
  assert.equal(error.code, "TWO_TO_ONE_UNSUPPORTED_PARITY");
  assert.deepEqual(error.diagnostic, diagnostic);
  assert.equal(error.diagnostic.suggestion.axis, 1);
  assert.equal(error instanceof Error, true);
  assert.equal(error instanceof TwoToOnePlanningError, true);

  const expectedDto = {
    name: "TwoToOnePlanningError",
    message: "odd periodic transition field",
    code: "TWO_TO_ONE_UNSUPPORTED_PARITY",
    diagnostic
  };
  assert.deepEqual(JSON.parse(JSON.stringify(error)), expectedDto);

  const serialized = serializeTwoToOnePlanningError(error);
  assert.equal(Object.getPrototypeOf(serialized), Object.prototype);
  assert.deepEqual(structuredClone(serialized), expectedDto);
});

test("Hex 2:1 structured planning errors isolate nested diagnostic snapshots", () => {
  const diagnostic = {
    conflictingCellIds: [11, 12],
    conflictingInterfaces: [{
      firstCellId: 11,
      secondCellId: 12,
      faceNodeIds: [1, 2, 3, 4]
    }],
    attemptedActions: [{
      kind: "selection-expand",
      reason: "close transition",
      addedParentCellIds: [13],
      replacedTransitionCellIds: [14],
      templateId: "selection-shell"
    }],
    suggestion: {
      kind: "expand-selection",
      axis: 1,
      side: 1,
      parentCellIds: [15]
    }
  };
  const expectedDiagnostic = structuredClone(diagnostic);
  const error = new TwoToOnePlanningError(
    "TWO_TO_ONE_COMPENSATION_LIMIT",
    "compensation budget exhausted",
    diagnostic
  );

  mutatePlanningDiagnostic(diagnostic);
  assert.notEqual(error.diagnostic, diagnostic);
  assert.deepEqual(error.diagnostic, expectedDiagnostic);

  const dto = error.toJSON();
  assert.notEqual(dto.diagnostic, error.diagnostic);
  mutatePlanningDiagnostic(dto.diagnostic);
  assert.deepEqual(error.diagnostic, expectedDiagnostic);

  const serialized = serializeTwoToOnePlanningError(error);
  assert.notEqual(serialized.diagnostic, error.diagnostic);
  assert.notEqual(serialized.diagnostic, dto.diagnostic);
  assert.deepEqual(serialized.diagnostic, expectedDiagnostic);
});

test("HexRefine offline memory planner selects a bounded heap from system RAM", async () => {
  const { offlineMemoryPlan } = await import("../scripts/offline-memory.mjs");
  const plan = offlineMemoryPlan();
  assert.equal(Number.isInteger(plan.totalMb), true);
  assert.equal(Number.isInteger(plan.maxOldSpaceMb), true);
  assert.equal(plan.maxOldSpaceMb >= 2048, true);
  assert.equal(plan.maxOldSpaceMb <= plan.totalMb, true);
  assert.equal(plan.currentHeapLimitMb > 0, true);
});

test("Q1 local templates match notebook element counts", () => {
  const quad = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1]
  ];

  assert.equal(refineQ1To3x3(quad).nodes.length, 16);
  assert.equal(refineQ1To3x3(quad).elements.length, 9);
  assert.equal(refineQ1To4Q1(quad).nodes.length, 8);
  assert.equal(refineQ1To4Q1(quad).elements.length, 4);
  assert.equal(refineQ1To5Q1(quad).nodes.length, 10);
  assert.equal(refineQ1To5Q1(quad).elements.length, 5);
});

test("Hex local templates match notebook element counts", () => {
  const hex = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1]
  ];

  assert.equal(refineHexTo27Hex(hex).nodes.length, 64);
  assert.equal(refineHexTo27Hex(hex).elements.length, 27);
  assert.equal(refineHexTo8Hex(hex).nodes.length, 27);
  assert.equal(refineHexTo8Hex(hex).elements.length, 8);
  assert.equal(refineHexTo5Hex(hex).nodes.length, 16);
  assert.equal(refineHexTo5Hex(hex).elements.length, 5);
  const h13 = refineHexTo13Hex(hex);
  assert.equal(h13.nodes.length, 32);
  assert.equal(h13.elements.length, 13);
  assert.equal(checkNoHangingNodes(refineHexTo5Hex(hex)).ok, true);
  assert.equal(checkNoHangingNodes(h13).ok, true);
});

test("Hex 2:1 Owen sweep template library covers every regular marked-corner signature", () => {
  const templates = [...regularSweepTemplateLibrary().values()];
  const counts = countBy(templates.map((template) => template.name));

  assert.equal(templates.length, 27);
  assert.equal(counts.get("pattern1"), 8);
  assert.equal(counts.get("pattern2"), 12);
  assert.equal(counts.get("pattern4"), 6);
  assert.equal(counts.get("uniform8"), 1);
  for (const template of templates) {
    assert.ok(template.elements.length > 0);
    for (const element of template.elements) {
      assert.equal(element.length, 8);
      assert.ok(element.every((nodeId) => nodeId >= 0 && nodeId < template.nodes.length));
    }
  }
});

test("Hex 2:1 paired pattern-3 library covers every marked-face frame", () => {
  const templates = [...pattern3PairTemplateLibrary().values()];

  assert.equal(templates.length, 24);
  for (const template of templates) {
    assert.equal(template.markedCorners.length, 3);
    assert.equal(template.faceCorners.length, 4);
    assert.equal(template.children.length, 2);
    assert.equal(template.mergeGroups.length, 2);
    assert.ok(template.children.every((child) => child.length === 8));
  }
});

test("LS-DYNA export writes a mesh-only fixed-field keyword deck", () => {
  const mesh = createHexUnitCubeMesh(1, 1, 1);
  const keyword = meshToLsdynaKeyword(mesh, { partId: 7 });
  const keywordLines = keyword
    .split(/\r?\n/)
    .filter((line) => line.startsWith("*"));

  assert.deepEqual(keywordLines, [
    "*KEYWORD",
    "*NODE",
    "*ELEMENT_SOLID",
    "*END"
  ]);
  assert.equal(keyword.includes("*PART"), false);
  assert.equal(keyword.includes("*SECTION"), false);

  const parsed = parseMeshText(keyword, "mesh.k");
  assert.deepEqual(parsed.nodes, mesh.nodes);
  assert.deepEqual(parsed.elements, mesh.elements);
});

test("Hex local template coordinates match notebook parameter positions", () => {
  const hex = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1]
  ];

  const h5 = refineHexTo5Hex(hex);
  assertPoint(h5.nodes[8], [0, 0, 1 / 3]);
  assertPoint(h5.nodes[9], [0, 0, 2 / 3]);
  assertPoint(h5.nodes[10], [0.5, 0, 2 / 3]);
  assertPoint(h5.nodes[11], [0.5, 0, 1 / 3]);
  assertPoint(h5.nodes[12], [0, 0.5, 1 / 3]);
  assertPoint(h5.nodes[13], [0, 0.5, 2 / 3]);

  const h13 = refineHexTo13Hex(hex);
  assertPoint(h13.nodes[12], [0, 1 / 3, 0.5]);
  assertPoint(h13.nodes[13], [1, 1 / 3, 0.5]);
  assertPoint(h13.nodes[14], [1, 2 / 3, 0.5]);
  assertPoint(h13.nodes[15], [0, 2 / 3, 0.5]);

  const h27 = refineHexTo27Hex(hex);
  assertPoint(h27.nodes[0], [0, 0, 0]);
  assertPoint(h27.nodes[1], [0, 0, 1 / 3]);
  assertPoint(h27.nodes[16], [1 / 3, 0, 0]);
  assertPoint(h27.nodes[21], [1 / 3, 1 / 3, 1 / 3]);
  assert.deepEqual(h27.elements[0], [1, 17, 21, 5, 2, 18, 22, 6]);
});

test("Hex refinement handles repeated local refinement without node-merge blowup", () => {
  const scaleMesh = (source, scale) => ({
    ...source,
    nodes: source.nodes.map((point) => [
      point[0] * scale[0],
      point[1] * scale[1],
      point[2] * scale[2]
    ])
  });
  let mesh = scaleMesh(createHexUnitCubeMesh(10, 10, 10), [10, 10, 10]);

  for (let step = 1; step <= 3; step += 1) {
    const lower = 5 - 2 / step;
    const upper = 5 + 2 / step;
    const selected = mesh.elements
      .map((element, index) => ({
        elementId: index + 1,
        center: element.reduce((total, nodeId) => {
          const point = mesh.nodes[nodeId - 1];
          total[0] += point[0];
          total[1] += point[1];
          total[2] += point[2];
          return total;
        }, [0, 0, 0]).map((value) => value / element.length)
      }))
      .filter(({ center }) =>
        center[0] >= lower && center[0] <= upper &&
        center[1] >= lower && center[1] <= upper &&
        center[2] >= lower && center[2] <= upper
      )
      .map(({ elementId }) => elementId);

    mesh = refineByElementIdsWithReport(mesh, selected, {
      regularizeHexSelection: false,
      includeTransitions: true
    }).mesh;
  }

  assert.equal(mesh.elements.length, 68376);
  assert.equal(mesh.nodes.length, 68839);
  assert.ok(minElementEdgeLength(mesh) > 0);
});

test("Hierarchical refinement session hides mother cells and supports undo redo", () => {
  const mesh = createHexUnitCubeMesh(1, 1, 1);
  const session = createRefinementSession(mesh);

  assert.equal(buildActiveMesh(session).elements.length, 1);
  assert.deepEqual([...session.activeLeafIds], ["e1"]);

  const command = refineSessionCell(session, "e1", refineHexTo27Hex);
  const refined = buildActiveMesh(session);

  assert.equal(command.hiddenCellIds.length, 1);
  assert.equal(command.createdCellIds.length, 27);
  assert.equal(command.quality?.ok, true);
  assert.equal(command.quality?.parentElementCount, 1);
  assert.equal(command.quality?.childElementCount, 27);
  assert.equal(session.cells.get("e1").active, false);
  assert.equal(session.cells.get("e1").hidden, true);
  assert.equal(refined.kind, "H1");
  assert.equal(refined.elements.length, 27);
  assert.equal(refined.nodes.length, 64);

  const undone = undoRefinementSession(session);
  assert.equal(undone.id, command.id);
  assert.deepEqual([...session.activeLeafIds], ["e1"]);
  assert.equal(buildActiveMesh(session).elements.length, 1);

  const redone = redoRefinementSession(session);
  assert.equal(redone.id, command.id);
  assert.equal(buildActiveMesh(session).elements.length, 27);
});

test("Hierarchical refinement session rejects inverted Hex children atomically", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const before = {
    activeLeafIds: [...session.activeLeafIds],
    nodeCount: session.nodes.length,
    undoCount: session.undoStack.length
  };

  assert.throws(
    () => refineSessionCell(session, "e1", (vertices) => ({
      kind: "H1",
      source: "inverted_test_hex",
      nodes: vertices.map((point) => [...point]),
      elements: [[1, 4, 3, 2, 5, 8, 7, 6]]
    })),
    /non-positive scaled Jacobian/
  );
  assert.deepEqual({
    activeLeafIds: [...session.activeLeafIds],
    nodeCount: session.nodes.length,
    undoCount: session.undoStack.length
  }, before);
});

test("Hex patch quality audit rejects an empty replacement set", () => {
  assert.throws(
    () => auditHexRefinementPatchQuality(createHexUnitCubeMesh(1, 1, 1), []),
    /at least one replacement/
  );
});

test("Hex oriented corner Jacobian detects inversion in a negative-orientation element", () => {
  const vertices = [
    [0.7291564621031285, -0.3900730879046023, -0.3567997058853507],
    [2.6194058888591827, -0.7630019668489695, -1.7990245786495507],
    [0.06306805890053513, 0.4105861154384911, 0.3036449566483498],
    [-0.1286902033723891, 0.9890762763097882, 1.6386692524887623],
    [-1.6126564409583808, 1.4874584536068143, -0.7676654154434801],
    [1.774203643668443, 0.9698219172656536, 0.6766813143156469],
    [1.014555954374373, 2.599799705389887, -0.7455411959439517],
    [-0.9093339038081467, 2.033608446829021, 0.1498027783818543]
  ];

  assert.ok(minimumOrientedHexCornerScaledJacobian(vertices, -1) < 0);
});

test("Hierarchical refinement session rejects incomplete Hex replacement volume atomically", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const before = {
    activeLeafIds: [...session.activeLeafIds],
    nodeCount: session.nodes.length,
    undoCount: session.undoStack.length
  };

  assert.throws(
    () => refineSessionCell(session, "e1", (vertices) => {
      const refinement = refineHexTo8Hex(vertices);
      return {
        ...refinement,
        source: "incomplete_test_hex",
        elements: [refinement.elements[0]]
      };
    }),
    /does not conserve parent volume/
  );
  assert.deepEqual({
    activeLeafIds: [...session.activeLeafIds],
    nodeCount: session.nodes.length,
    undoCount: session.undoStack.length
  }, before);
});

test("Hierarchical refinement session validates every Hex parent before a batch mutation", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const before = {
    activeLeafIds: [...session.activeLeafIds],
    nodeCount: session.nodes.length,
    undoCount: session.undoStack.length
  };

  assert.throws(
    () => refineSessionCells(session, ["e1", "e2"], (vertices) => {
      const refinement = refineHexTo8Hex(vertices);
      const centerX = vertices.reduce((total, point) => total + point[0], 0)
        / vertices.length;
      return centerX < 0.5
        ? refinement
        : {
            ...refinement,
            source: "incomplete_batch_test_hex",
            elements: [refinement.elements[0]]
          };
    }),
    /does not conserve parent volume/
  );
  assert.deepEqual({
    activeLeafIds: [...session.activeLeafIds],
    nodeCount: session.nodes.length,
    undoCount: session.undoStack.length
  }, before);
});

test("Hierarchical refinement session assigns stable numeric cell ordinals", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  assert.equal(session.cells.get("e1").ordinal, 1);
  assert.equal(session.nextCellOrdinal, 2);

  refineSessionPatch(session, ["e1"]);
  const ordinals = [...session.cells.values()].map((cell) => cell.ordinal);
  assert.equal(new Set(ordinals).size, ordinals.length);
  assert.deepEqual(ordinals, [...ordinals].sort((a, b) => a - b));
  assert.equal(session.nextCellOrdinal, Math.max(...ordinals) + 1);

  undoRefinementSession(session);
  redoRefinementSession(session);
  buildActiveMeshWithMap(session, { mergeNodes: true });
});

test("Hierarchical active mesh build returns cell and node remaps", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const command = refineSessionCell(session, "e1", refineHexTo27Hex);
  const result = buildActiveMeshWithMap(session, { includeElementIdsByNodeId: true });
  const firstCellId = command.createdCellIds[0];
  const firstElementId = result.elementIdByCellId.get(firstCellId);
  assert.ok(firstElementId);
  assert.equal(result.mesh.elements.length, 27);
  assert.equal(result.cellIdByElementId.get(firstElementId), firstCellId);

  const firstSessionNodeId = session.cells.get(firstCellId).element[0];
  const outputNodeId = result.nodeIdBySessionNodeId.get(firstSessionNodeId);
  assert.ok(outputNodeId);
  assert.equal(result.sessionNodeIdByNodeId.get(outputNodeId), firstSessionNodeId);
  assert.deepEqual(result.sessionNodeIdsByNodeId.get(outputNodeId), [firstSessionNodeId]);
  assert.ok(result.elementIdsByNodeId.get(outputNodeId).includes(firstElementId));
});

test("Hierarchical active mesh build supports lean GUI cell remaps", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const command = refineSessionCell(session, "e1", refineHexTo27Hex);
  const result = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9,
    includeCellIdByElementId: false,
    includeElementIdByCellId: false
  });
  const firstCellId = command.createdCellIds[0];
  const firstElementId = activeBuildElementIdByCellId(session, result, firstCellId);
  assert.ok(firstElementId);
  assert.equal(result.cellIdByElementId.size, 0);
  assert.equal(result.elementIdByCellId.size, 0);
  assert.equal(activeBuildCellIdByElementId(result, firstElementId), firstCellId);
});

test("Hierarchical active mesh build composes node remaps after final merge", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  refineSessionCells(session, ["e1", "e2"], refineHexTo27Hex);
  const unmerged = buildActiveMeshWithMap(session);
  const merged = buildActiveMeshWithMap(session, { mergeNodes: true });
  assert.equal(unmerged.mesh.nodes.length, 128);
  assert.ok(merged.mesh.nodes.length < unmerged.mesh.nodes.length);
  assert.ok([...merged.sessionNodeIdsByNodeId.values()].some((sessionNodeIds) => sessionNodeIds.length > 1));

  for (const cellId of session.activeLeafIds) {
    for (const sessionNodeId of session.cells.get(cellId).element) {
      assert.ok(merged.nodeIdBySessionNodeId.get(sessionNodeId));
    }
  }
});

test("Hierarchical active mesh remaps stable cell and node sets for export", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const command = refineSessionCell(session, "e1", refineHexTo27Hex);
  const activeCellId = command.createdCellIds[0];
  const hiddenCellId = "e1";
  const sessionNodeId = session.cells.get(activeCellId).element[0];
  const inactiveNodeId = 999999;
  const build = buildActiveMeshWithMap(session, { mergeNodes: true });
  const activeElementId = build.elementIdByCellId.get(activeCellId);
  const activeNodeId = build.nodeIdBySessionNodeId.get(sessionNodeId);
  assert.ok(activeElementId);
  assert.ok(activeNodeId);
  const remap = remapSessionSetsToActiveMesh(build, {
    cellSets: new Map([
      ["ACTIVE_CORE", [activeCellId, activeCellId, hiddenCellId]]
    ]),
    nodeSets: {
      SELECTED_NODES: [sessionNodeId, sessionNodeId, inactiveNodeId]
    }
  });

  assert.deepEqual(remap.cellSets.get("ACTIVE_CORE"), [activeElementId]);
  assert.deepEqual(remap.missingCellIdsBySet.get("ACTIVE_CORE"), [hiddenCellId]);
  assert.deepEqual(remap.nodeSets.get("SELECTED_NODES"), [activeNodeId]);
  assert.deepEqual(remap.missingNodeIdsBySet.get("SELECTED_NODES"), [inactiveNodeId]);
});

test("Hierarchical export builds a merged flat mesh with remapped sets", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const command = refineSessionCells(session, ["e1", "e2"], refineHexTo27Hex);
  const cellId = command.createdCellIds[0];
  const nodeId = session.cells.get(cellId).element[0];
  const exported = buildRefinementSessionExport(session, {
    sets: {
      cellSets: { CORE: [cellId] },
      nodeSets: { CORNER: [nodeId] }
    }
  });
  const exportedElementId = exported.build.elementIdByCellId.get(cellId);
  const exportedNodeId = exported.build.nodeIdBySessionNodeId.get(nodeId);
  assert.ok(exportedElementId);
  assert.ok(exportedNodeId);

  assert.equal(exported.mesh.elements.length, 54);
  assert.ok(exported.mesh.nodes.length < buildActiveMeshWithMap(session).mesh.nodes.length);
  assert.deepEqual(exported.sets.cellSets.get("CORE"), [exportedElementId]);
  assert.deepEqual(exported.sets.nodeSets.get("CORNER"), [exportedNodeId]);
});

test("Refinement replacement plan exposes selected and transition templates", () => {
  const mesh = createHexUnitCubeMesh(2, 1, 1);
  const replacements = buildRefinementReplacements(mesh, [1], { includeTransitions: true });
  assert.equal(replacements.filter((replacement) => replacement.role === "selected").length, 1);
  assert.equal(replacements.filter((replacement) => replacement.role === "face-transition").length, 1);
});

test("Default refinement planner preserves Q1 and Hex template roles", () => {
  const q1 = createQ1UnitSquareMesh(2, 1);
  const q1Plan = buildDefaultRefinementReplacements(q1, [1], { includeTransitions: true })
    .map((replacement) => [replacement.role, replacement.templateCode]);
  assert.deepEqual(q1Plan, [
    ["selected", 9],
    ["edge-transition", 4]
  ]);

  const hex = createHexUnitCubeMesh(2, 1, 1);
  const hexPlan = defaultRefinementPlanner.plan(hex, [1], { includeTransitions: true })
    .map((replacement) => [replacement.role, replacement.templateCode]);
  assert.deepEqual(hexPlan, [
    ["selected", 27],
    ["face-transition", 13]
  ]);
});

test("HexRefine command script replays grid, refinement, sets, and materials", () => {
  const script = {
    format: "hexrefine-command-script",
    version: 1,
    app: "HexRefine",
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 2,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [2, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "refine.patch",
        payload: {
          cellIds: ["e1"],
          options: {
            includeTransitions: true,
            mergeTolerance: 1e-9
          }
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "CORE",
          cellIds: ["e1/1", "e1/2"],
          material: { name: "MAT-CORE", elasticModulus: 100, poissonRatio: 0.25 }
        }
      }
    ]
  };

  const replay = replayHexRefineCommandScript(script);
  assert.equal(replay.replayedCommandCount, 3);
  assert.equal(replay.warnings.length, 0);
  assert.equal(replay.mergeTolerance, 1e-9);
  assert.equal(replay.mesh.kind, "H1");
  assert.equal(replay.mesh.elements.length, 40);
  assert.deepEqual(replay.cellSets.get("CORE"), ["e1/1", "e1/2"]);
  assert.equal(replay.cellSetMaterials.get("CORE").name, "MAT-CORE");
  assert.equal(checkNoHangingNodes(replay.mesh).ok, true);
});

test("HexRefine command script reports the default grid merge tolerance", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 1,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [2, 2, 1] }
        }
      }
    ]
  });

  assert.equal(replay.replayedCommandCount, 1);
  assert.equal(replay.mergeTolerance, Math.hypot(2, 2, 1) * 1e-10);
});

test("HexRefine command script replays single-cell pick and hide-pick commands", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 3,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [3, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "select.pick",
        payload: {
          elementId: 2,
          selectionMode: "add"
        }
      },
      {
        kind: "view.hide-selected",
        payload: {}
      },
      {
        kind: "view.hide-elements",
        payload: {
          elementIds: [3]
        }
      },
      {
        kind: "select.all",
        payload: {
          target: "cells"
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "VISIBLE"
        }
      }
    ]
  }, { selectionStrategy: "replay" });

  assert.equal(replay.warnings.length, 0);
  assert.deepEqual(replay.cellSets.get("VISIBLE"), ["e1"]);
});

test("HexRefine command script can replay compact keep-mode deletion", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 3,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [3, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "delete.elements",
        payload: {
          mode: "keep",
          keptElementIds: [2],
          deletedElementCount: 2,
          sourceElementCount: 3
        }
      }
    ]
  });

  assert.equal(replay.replayedCommandCount, 2);
  assert.equal(replay.warnings.length, 0);
  assert.equal(replay.mesh.elements.length, 1);
  assert.equal(replay.mesh.elements[0].length, 8);
  assert.equal(replay.mesh.elements[0].every((nodeId) => nodeId >= 1 && nodeId <= replay.mesh.nodes.length), true);
});

test("HexRefine command script can replay delete undo and redo", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 3,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [3, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "delete.elements",
        payload: {
          mode: "delete",
          elementIds: [2],
          deletedElementCount: 1,
          sourceElementCount: 3
        }
      },
      {
        kind: "undo.delete"
      },
      {
        kind: "redo.delete"
      }
    ]
  });

  assert.equal(replay.replayedCommandCount, 4);
  assert.equal(replay.warnings.length, 0);
  assert.equal(replay.mesh.elements.length, 2);
  assert.equal(checkNoHangingNodes(replay.mesh).ok, true);
});

test("HexRefine command script remaps surviving cell sets after delete", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 3,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [3, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "DELETE_ME",
          cellIds: ["e1"]
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "KEEP_ME",
          cellIds: ["e3"]
        }
      },
      {
        kind: "delete.elements",
        payload: {
          mode: "delete",
          elementIds: [1],
          deletedElementCount: 1,
          sourceElementCount: 3
        }
      }
    ]
  });

  assert.equal(replay.mesh.elements.length, 2);
  assert.equal(replay.cellSets.has("DELETE_ME"), false);
  assert.deepEqual(replay.cellSets.get("KEEP_ME"), ["e2"]);
});

test("HexRefine command script can replay Q1 mesh-operation undo, redo, and set selection", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "Q1",
          nx: 2,
          ny: 2,
          bounds: { min: [0, 0, 0], max: [1, 1, 0] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "mesh.boundary-layer-grow",
        payload: {
          elementIds: [1, 2, 3, 4],
          height: 0.1,
          increments: 1,
          growthRatio: 1,
          nodeArrangement: 1,
          scaleMode: "none",
          setPrefix: "BL1"
        }
      },
      {
        kind: "undo.mesh-operation"
      },
      {
        kind: "redo.mesh-operation"
      },
      {
        kind: "select.cell-set",
        payload: {
          name: "BL1_ALL"
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "SELECTED_BL"
        }
      }
    ]
  }, { selectionStrategy: "replay" });

  assert.equal(replay.replayedCommandCount, 6);
  assert.equal(replay.warnings.length, 0);
  assert.equal(replay.mesh.kind, "Q1");
  assert.equal(replay.mesh.elements.length, 12);
  assert.deepEqual(replay.cellSets.get("SELECTED_BL"), replay.cellSets.get("BL1_ALL"));
  assert.equal(replay.cellSets.get("SELECTED_BL").length, 8);
  assert.equal(checkNoHangingNodes(replay.mesh, 1e-9).ok, true);
});

test("HexRefine command script preserves cell sets through Q1 template replacement", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "Q1",
          nx: 4,
          ny: 4,
          bounds: { min: [0, 0, 0], max: [1, 1, 0] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "UNCHANGED",
          cellIds: ["e1"]
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "REPLACED",
          cellIds: ["e6"]
        }
      },
      {
        kind: "mesh.template-rectangle-circle",
        payload: {
          elementIds: [6, 7, 10, 11],
          innerSquareRatio: 0.24,
          innerCircleRatio: 0.42,
          outerCircleRatio: 0.7,
          squareToCircleLayers: 1,
          annulusLayers: 1,
          circleToSquareLayers: 1,
          omitCore: true,
          setPrefix: "TPL"
        }
      }
    ]
  });

  assert.deepEqual(replay.cellSets.get("UNCHANGED"), ["e1"]);
  assert.ok(replay.cellSets.get("REPLACED").length > 1);
  assert.deepEqual(replay.cellSets.get("REPLACED"), replay.cellSets.get("TPL_ALL"));
  assert.deepEqual(replay.cellSets.get("TPL_CORE"), []);
  assert.deepEqual(replay.cellSets.get("TPL_SQUARE_CIRCLE"), []);
  assert.equal(checkNoHangingNodes(replay.mesh, 1e-9).ok, true);
});

test("HexRefine command script can replay coordinate-box selection on a denser offline grid", () => {
  const script = {
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 2,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [2, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "select.coordinate-box",
        payload: {
          target: "cells",
          box: { min: [0, 0, 0], max: [1, 1, 1] }
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "LEFT",
          elementIds: [1]
        }
      },
      {
        kind: "refine.patch",
        payload: {
          elementIds: [1],
          options: {
            includeTransitions: true,
            mergeTolerance: 1e-9
          }
        }
      }
    ]
  };

  const recorded = replayHexRefineCommandScript(script, {
    gridOverride: { nx: 4, ny: 1, nz: 1 },
    selectionStrategy: "recorded"
  });
  const replayed = replayHexRefineCommandScript(script, {
    gridOverride: { nx: 4, ny: 1, nz: 1 },
    selectionStrategy: "replay"
  });

  assert.equal(recorded.cellSets.get("LEFT")?.length, 1);
  assert.equal(replayed.cellSets.get("LEFT")?.length, 2);
  assert.ok(replayed.mesh.elements.length > recorded.mesh.elements.length);
  assert.equal(checkNoHangingNodes(replayed.mesh).ok, true);
});

test("HexRefine command script can replay coordinate-box removal on a denser offline grid", () => {
  const script = {
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 2,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [2, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "select.all",
        payload: {
          target: "cells"
        }
      },
      {
        kind: "select.coordinate-box",
        payload: {
          target: "cells",
          mode: "remove",
          box: { min: [0, 0, 0], max: [1, 1, 1] }
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "RIGHT"
        }
      }
    ]
  };

  const replayed = replayHexRefineCommandScript(script, {
    gridOverride: { nx: 4, ny: 1, nz: 1 },
    selectionStrategy: "replay"
  });

  assert.equal(replayed.cellSets.get("RIGHT")?.length, 2);
  assert.equal(checkNoHangingNodes(replayed.mesh).ok, true);
});

test("HexRefine command script can replay screen-rect selection through recorded mesh-space bounds", () => {
  const script = {
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 2,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [2, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "select.screen-rect",
        payload: {
          target: "cells",
          additive: false,
          mode: "through",
          rect: { min: [100, 100], max: [260, 260] },
          meshBox: { min: [0, 0, 0], max: [1, 1, 1] }
        }
      },
      {
        kind: "refine.patch",
        payload: {
          elementIds: [1],
          options: {
            includeTransitions: true,
            mergeTolerance: 1e-9
          }
        }
      }
    ]
  };

  const recorded = replayHexRefineCommandScript(script, {
    gridOverride: { nx: 4, ny: 1, nz: 1 },
    selectionStrategy: "recorded"
  });
  const replayed = replayHexRefineCommandScript(script, {
    gridOverride: { nx: 4, ny: 1, nz: 1 },
    selectionStrategy: "replay"
  });

  assert.equal(recorded.mesh.elements.length, 42);
  assert.equal(replayed.warnings.length, 0);
  assert.equal(replayed.mesh.elements.length, 68);
  assert.equal(checkNoHangingNodes(replayed.mesh).ok, true);
});

test("HexRefine command script can replay screen-rect selection through recorded view parameters", () => {
  const script = {
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 4,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [4, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "select.screen-rect",
        payload: {
          target: "cells",
          additive: false,
          mode: "through",
          rect: { min: [300, 0], max: [500, 600] },
          viewSelection: {
            kind: "screen-ortho-view",
            projectionMode: "parallel",
            canvas: { width: 800, height: 600 },
            camera: {
              yaw: 0,
              pitch: 0,
              roll: 0,
              zoom: 100,
              center: [2, 0.5, 0.5]
            }
          },
          meshBox: { min: [0, 0, 0], max: [4, 1, 1] }
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "VIEW",
          elementIds: [2, 3]
        }
      }
    ]
  };

  const replayed = replayHexRefineCommandScript(script, {
    gridOverride: { nx: 8, ny: 1, nz: 1 },
    selectionStrategy: "replay"
  });

  assert.equal(replayed.cellSets.get("VIEW")?.length, 4);
  assert.deepEqual(replayed.cellSets.get("VIEW"), ["e3", "e4", "e5", "e6"]);
});

test("HexRefine offline replay filters transition and mixed-level cells before a second refine", () => {
  const script = {
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 2,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [2, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "refine.patch",
        payload: {
          elementIds: [1],
          options: {
            includeTransitions: true,
            mergeTolerance: 1e-9
          }
        }
      },
      {
        kind: "select.screen-rect",
        payload: {
          target: "cells",
          additive: false,
          mode: "through",
          rect: { min: [120, 120], max: [320, 320] },
          meshBox: { min: [0, 0, 0], max: [1, 1, 1] }
        }
      },
      {
        kind: "refine.patch",
        payload: {
          elementIds: [1],
          options: {
            includeTransitions: true,
            mergeTolerance: 1e-9
          }
        }
      }
    ]
  };

  const replayed = replayHexRefineCommandScript(script, {
    gridOverride: { nx: 4, ny: 1, nz: 1 },
    selectionStrategy: "replay"
  });

  assert.equal(replayed.mesh.elements.length > 68, true);
  assert.equal(
    replayed.warnings.some((warning) => warning.includes("offline replay shrank the refine core")),
    true
  );
  assert.equal(checkNoHangingNodes(replayed.mesh).ok, true);
});

test("HexRefine offline replay prefers current screen replay selection over stored refine patch ranges", () => {
  const replaySelection = {
    kind: "level-rank-range",
    level: 0,
    domainDimensions: [4, 1, 1],
    range: {
      min: [0, 0, 0],
      max: [0, 0, 0]
    },
    sourceElementCount: 1
  };
  const refinePatch = {
    kind: "refine.patch",
    payload: {
      elementIds: [1],
      replaySelection,
      options: {
        includeTransitions: true,
        mergeTolerance: 1e-9
      }
    }
  };
  const baseGrid = {
    kind: "grid.generate",
    payload: {
      kind: "H1",
      nx: 4,
      ny: 1,
      nz: 1,
      bounds: { min: [0, 0, 0], max: [4, 1, 1] },
      mergeTolerance: 1e-9
    }
  };
  const coarseScreenScript = {
    commands: [
      baseGrid,
      {
        kind: "select.screen-rect",
        payload: {
          target: "cells",
          additive: false,
          mode: "through",
          rect: { min: [300, 0], max: [500, 600] },
          viewSelection: {
            kind: "screen-ortho-view",
            canvas: { width: 800, height: 600 },
            camera: {
              yaw: 0,
              pitch: 0,
              roll: 0,
              zoom: 100,
              center: [2, 0.5, 0.5]
            }
          },
          meshBox: { min: [0, 0, 0], max: [4, 1, 1] }
        }
      },
      refinePatch
    ]
  };
  const directScript = {
    commands: [
      baseGrid,
      {
        kind: "select.screen-rect",
        payload: {
          target: "cells",
          additive: false,
          mode: "through",
          rect: { min: [300, 0], max: [500, 600] },
          viewSelection: {
            kind: "screen-ortho-view",
            canvas: { width: 800, height: 600 },
            camera: {
              yaw: 0,
              pitch: 0,
              roll: 0,
              zoom: 100,
              center: [2, 0.5, 0.5]
            }
          },
          meshBox: { min: [0, 0, 0], max: [4, 1, 1] }
        }
      },
      {
        kind: "refine.patch",
        payload: {
          options: {
            includeTransitions: true,
            mergeTolerance: 1e-9
          }
        }
      }
    ]
  };

  const coarseReplay = replayHexRefineCommandScript(coarseScreenScript, {
    gridOverride: { nx: 8, ny: 1, nz: 1 },
    selectionStrategy: "replay"
  });
  const directReplay = replayHexRefineCommandScript(directScript, {
    gridOverride: { nx: 8, ny: 1, nz: 1 },
    selectionStrategy: "replay"
  });

  assert.equal(coarseReplay.mesh.elements.length, directReplay.mesh.elements.length);
  assert.equal(JSON.stringify(coarseReplay.mesh.elements), JSON.stringify(directReplay.mesh.elements));
  assert.equal(checkNoHangingNodes(coarseReplay.mesh).ok, true);
});

test("HexRefine offline replay honors Hex regularization for scaled screen selections", () => {
  const baseCommands = [
    {
      kind: "grid.generate",
      payload: {
        kind: "H1",
        nx: 10,
        ny: 2,
        nz: 1,
        bounds: { min: [0, 0, 0], max: [10, 2, 1] },
        mergeTolerance: 1e-9
      }
    },
    {
      kind: "select.screen-rect",
      payload: {
        target: "cells",
        additive: false,
        mode: "through",
        rect: {
          min: [796.7999877929688, 420.3999938964844],
          max: [968, 741.2000122070312]
        },
        viewSelection: {
          kind: "screen-ortho-view",
          canvas: { width: 1180, height: 846 },
          camera: {
            yaw: 0,
            pitch: 0,
            roll: 0,
            zoom: 80.208,
            center: [5, 1, 0.5]
          }
        },
        meshBox: {
          min: [4.5, 0.5, 0.5],
          max: [5.5, 1.5, 0.5]
        },
        rankSelection: {
          kind: "level-rank-range",
          level: 0,
          domainDimensions: [10, 2, 1],
          range: {
            min: [4, 0, 0],
            max: [5, 1, 0]
          },
          sourceElementCount: 4
        }
      }
    }
  ];
  const replay = (regularizeHexSelection) => replayHexRefineCommandScript({
    commands: [
      ...baseCommands,
      {
        kind: "refine.patch",
        payload: {
          options: {
            includeTransitions: true,
            regularizeHexSelection,
            mergeTolerance: 1e-9
          }
        }
      }
    ]
  }, {
    gridOverride: { nx: 30, ny: 6, nz: 3 },
    selectionStrategy: "replay"
  });

  const rawReplay = replay(false);
  const regularizedReplay = replay(true);

  assert.equal(checkNoHangingNodes(rawReplay.mesh).ok, true);
  assert.equal(checkNoHangingNodes(regularizedReplay.mesh).ok, true);
  assert.ok(regularizedReplay.mesh.elements.length < rawReplay.mesh.elements.length);
  assert.equal(regularizedReplay.selectionDiagnostics.length, 1);
  assert.equal(regularizedReplay.selectionDiagnostics[0].commandKind, "refine.patch");
  assert.equal(regularizedReplay.selectionDiagnostics[0].selectionSource, "state.selected-elements");
  assert.equal(regularizedReplay.selectionDiagnostics[0].warnings.length, 0);
  assert.equal(
    regularizedReplay.selectionDiagnostics[0].notice,
    "Found a regular uvw shell from the selection, then refined its core."
  );
  assert.ok((regularizedReplay.selectionDiagnostics[0].sourceElementCount ?? 0) > 0);
  assert.equal(regularizedReplay.selectionDiagnostics[0].expandedCandidateCount, regularizedReplay.selectionDiagnostics[0].sourceElementCount);
  assert.ok((regularizedReplay.selectionDiagnostics[0].outerElementCount ?? 0) >= (regularizedReplay.selectionDiagnostics[0].preparedElementCount ?? 0));
  assert.equal(
    regularizedReplay.selectionDiagnostics[0].preparedElementCount,
    regularizedReplay.selectionDiagnostics[0].preparedCellCount
  );
  assert.equal(
    regularizedReplay.selectionDiagnostics[0].preparedCellCount,
    regularizedReplay.selectionDiagnostics[0].stabilizedCellCount
  );
  assert.equal(
    regularizedReplay.selectionDiagnostics[0].boundedCoreCount,
    regularizedReplay.selectionDiagnostics[0].preparedCellCount
  );
});

test("HexRefine offline export manifest includes replay selection diagnostics", async () => {
  const { runOfflineExportJob } = await import("../scripts/offline-export.mjs");
  const script = {
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 10,
          ny: 2,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [10, 2, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "select.screen-rect",
        payload: {
          target: "cells",
          additive: false,
          mode: "through",
          rect: {
            min: [796.7999877929688, 420.3999938964844],
            max: [968, 741.2000122070312]
          },
          viewSelection: {
            kind: "screen-ortho-view",
            canvas: { width: 1180, height: 846 },
            camera: {
              yaw: 0,
              pitch: 0,
              roll: 0,
              zoom: 80.208,
              center: [5, 1, 0.5]
            }
          }
        }
      },
      {
        kind: "refine.patch",
        payload: {
          options: {
            includeTransitions: true,
            regularizeHexSelection: true,
            mergeTolerance: 1e-9
          }
        }
      }
    ]
  };

  const result = await runOfflineExportJob(script, { scaleFactor: 3 });
  assert.equal(Array.isArray(result.manifest.selectionDiagnostics), true);
  assert.equal(result.manifest.selectionDiagnostics.length, 1);
  assert.equal(result.manifest.selectionDiagnostics[0].commandKind, "refine.patch");
  assert.equal(result.manifest.selectionDiagnostics[0].selectionSource, "state.selected-elements");
  assert.equal(Array.isArray(result.manifest.refinementQuality), true);
  assert.equal(result.manifest.refinementQuality.length, 1);
  assert.equal(result.manifest.refinementQuality[0].ok, true);
  assert.ok(result.manifest.refinementQuality[0].childMinimumOrientedScaledJacobian > 0);
  assert.ok(result.manifest.refinementQuality[0].relativeVolumeError < 1e-10);
});

test("HexRefine offline export defaults to VTK without INP output", async () => {
  const { runOfflineExportJob } = await import("../scripts/offline-export.mjs");
  const outputDir = await mkdtemp(join(tmpdir(), "hexrefine-offline-test-"));
  try {
    const result = await runOfflineExportJob({
      commands: [
        {
          kind: "grid.generate",
          payload: {
            kind: "H1",
            nx: 4,
            ny: 1,
            nz: 1,
            bounds: { min: [0, 0, 0], max: [4, 1, 1] },
            mergeTolerance: 1e-9
          }
        }
      ]
    }, {
      scaleFactor: 1.2,
      outputDir,
      baseName: "default-vtk-only"
    });

    assert.equal(result.manifest.includeInp, false);
    assert.equal("inpPath" in result, false);
    assert.equal(existsSync(join(outputDir, "default-vtk-only.inp")), false);
    assert.equal(existsSync(join(outputDir, "default-vtk-only.vtk")), true);
    assert.equal(existsSync(join(outputDir, "default-vtk-only-job.json")), true);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("HexRefine shared session selection prep matches the GUI Hex core workflow", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(10, 2, 1));
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    includeCellIdByElementId: false,
    includeElementIdByCellId: false,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false
  });
  const selectedElementIds = [5, 6, 15, 16];
  const prepared = prepareSessionRefineSelection(session, active, selectedElementIds, {
    includeTransitions: true,
    regularizeHexSelection: true,
    mergeTolerance: 1e-9
  });

  assert.deepEqual(prepared.elementIds, [...selectedElementIds].sort((a, b) => a - b));
  assert.deepEqual(prepared.cellIds, ["e5", "e6", "e15", "e16"]);
  assert.equal(prepared.expandedCandidateCount, 8);
  assert.equal(prepared.boundedCoreCount, 4);
  assert.equal(prepared.transitionEscapeCount, undefined);
  assert.equal(prepared.warnings.length, 0);

  refineSessionPatch(session, prepared.cellIds, {
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: active
  });
  const refined = buildActiveMesh(session, { mergeNodes: true });
  assert.equal(checkNoHangingNodes(refined).ok, true);
});

test("HexRefine shared session selection prep regularizes disconnected Hex regions independently", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(12, 6, 6));
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    includeCellIdByElementId: false,
    includeElementIdByCellId: false,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false
  });
  const leftBlock = idsInIndexBlock(12, 6, 6, [2, 2, 2], [3, 3, 3]);
  const rightBlock = idsInIndexBlock(12, 6, 6, [8, 2, 2], [9, 3, 3]);
  const selectedElementIds = [...leftBlock, ...rightBlock];

  const prepared = prepareSessionRefineSelection(session, active, selectedElementIds, {
    includeTransitions: true,
    regularizeHexSelection: true,
    mergeTolerance: 1e-9
  });

  assert.deepEqual(prepared.elementIds, [...selectedElementIds].sort((a, b) => a - b));
  assert.equal(prepared.regularization?.components?.length, 2);
  assert.equal(prepared.sourceElementCount, 16);
  assert.equal(prepared.boundedCoreCount, 16);
  assert.equal(prepared.regularization.selectedElementIds.length, 128);
  assert.match(prepared.notice, /2 disconnected uvw blocks/);
  assert.equal(prepared.warnings.length, 0);

  refineSessionPatch(session, prepared.cellIds, {
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: active
  });
  const refined = buildActiveMesh(session, { mergeNodes: true });
  assert.equal(checkNoHangingNodes(refined).ok, true);
});

test("HexRefine shared session selection prep uses a hollow uvw shell before growing outward", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(7, 7, 7));
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    includeCellIdByElementId: false,
    includeElementIdByCellId: false,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false
  });
  const coreIds = idsInIndexBlock(7, 7, 7, [2, 2, 2], [4, 4, 4]);
  const centerId = elementIdAt(7, 7, 7, 3, 3, 3);
  const shellIds = coreIds.filter((elementId) => elementId !== centerId);

  const prepared = prepareSessionRefineSelection(session, active, shellIds, {
    includeTransitions: true,
    regularizeHexSelection: true,
    mergeTolerance: 1e-9
  });

  assert.equal(prepared.expandedCandidateCount, 26);
  assert.equal(prepared.boundedCoreCount, 1);
  assert.equal(prepared.regularization.selectedElementIds.length, 27);
  assert.equal(prepared.elementIds.includes(centerId), true);
  assert.deepEqual(prepared.elementIds, [centerId]);
  assert.equal(prepared.warnings.length, 0);

  refineSessionPatch(session, prepared.cellIds, {
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: active
  });
  const refined = buildActiveMesh(session, { mergeNodes: true });
  assert.equal(checkNoHangingNodes(refined).ok, true);
});

test("HexRefine shared session selection prep accepts a solid 3x3x3 layer and refines only its center", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(7, 7, 7));
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    includeCellIdByElementId: false,
    includeElementIdByCellId: false,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false
  });
  const layerIds = idsInIndexBlock(7, 7, 7, [2, 2, 2], [4, 4, 4]);
  const centerId = elementIdAt(7, 7, 7, 3, 3, 3);

  const prepared = prepareSessionRefineSelection(session, active, layerIds, {
    includeTransitions: true,
    regularizeHexSelection: true,
    mergeTolerance: 1e-9
  });

  assert.equal(prepared.expandedCandidateCount, 27);
  assert.equal(prepared.boundedCoreCount, 1);
  assert.equal(prepared.regularization.selectedElementIds.length, 27);
  assert.deepEqual(prepared.elementIds, [centerId]);
  assert.equal(prepared.warnings.length, 0);
});

test("HexRefine shared session selection prep omits transition support on model boundaries", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(7, 7, 7));
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    includeCellIdByElementId: false,
    includeElementIdByCellId: false,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false
  });
  const boundaryCoreIds = idsInIndexBlock(7, 7, 7, [0, 2, 2], [2, 4, 4]);
  const centerId = elementIdAt(7, 7, 7, 1, 3, 3);
  const shellIds = boundaryCoreIds.filter((elementId) => elementId !== centerId);

  const prepared = prepareSessionRefineSelection(session, active, shellIds, {
    includeTransitions: true,
    regularizeHexSelection: true,
    mergeTolerance: 1e-9
  });

  assert.equal(prepared.expandedCandidateCount, 26);
  assert.equal(prepared.boundedCoreCount, 2);
  assert.deepEqual(prepared.regularization.indexRange.dimensions, [3, 3, 3]);
  assert.equal(prepared.elementIds.includes(centerId), true);
  assert.deepEqual(prepared.elementIds, [
    elementIdAt(7, 7, 7, 0, 3, 3),
    centerId
  ]);
  assert.equal(prepared.warnings.length, 0);

  refineSessionPatch(session, prepared.cellIds, {
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: active
  });
  const refined = buildActiveMesh(session, { mergeNodes: true });
  assert.equal(checkNoHangingNodes(refined).ok, true);
});

test("HexRefine shared session selection prep handles folded uvw support blocks from imported VTK", () => {
  const mesh = parseMeshText(
    readFileSync(join("Test uvw Block", "Test1-ConformHex.vtk"), "utf8"),
    "Test1-ConformHex.vtk"
  );
  const cases = [
    {
      selected: [1, 2, 3, 4, 5, 6],
      core: [1, 2, 3, 4, 5, 6],
      support: [1, 2, 3, 4, 5, 6, 7, 9, 10]
    },
    {
      selected: [14, 15, 16, 17],
      core: [14, 15, 16, 17],
      support: [10, 11, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23]
    },
    {
      selected: [1, 2, 3, 4, 5, 6, 7, 9, 10],
      core: [1, 2, 3, 4, 5, 6],
      support: [1, 2, 3, 4, 5, 6, 7, 9, 10]
    },
    {
      selected: [10, 11, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23],
      core: [14, 15, 16, 17],
      support: [10, 11, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23]
    }
  ];

  assert.equal(checkNoHangingNodes(mesh).ok, true);
  for (const item of cases) {
    const session = createRefinementSession(mesh);
    const active = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance: 1e-9
    });
    const prepared = prepareSessionRefineSelection(session, active, item.selected, {
      includeTransitions: true,
      regularizeHexSelection: true,
      mergeTolerance: 1e-9
    });

    assert.deepEqual(prepared.elementIds, item.core);
    assert.deepEqual(prepared.outerElementIds, item.support);
    assert.deepEqual(prepared.warnings, []);

    refineSessionPatch(session, prepared.cellIds, {
      includeTransitions: true,
      transitionSupportCellIds: prepared.outerCellIds,
      mergeTolerance: 1e-9,
      activeBuild: active
    });
    const refined = buildActiveMesh(session, {
      mergeNodes: true,
      mergeTolerance: 1e-9
    });
    assert.equal(checkNoHangingNodes(refined, 1e-8).ok, true);
  }
});

test("HexRefine shared session selection prep keeps uvw domains local after distant refinement", () => {
  const mesh = createHexUnitCubeMesh(8, 3, 3);
  const session = createRefinementSession(mesh);
  let active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const firstCommand = refineSessionPatch(session, ["e1"], {
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: active
  });
  const firstSelectedChildren = firstCommand.createdCellIds
    .filter((cellId) => session.cells.get(cellId)?.role === "selected");

  active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const beforeFarElementIds = firstSelectedChildren
    .map((cellId) => activeBuildElementIdByCellId(session, active, cellId))
    .filter((elementId) => elementId !== undefined)
    .sort((a, b) => a - b);
  const beforeFar = prepareSessionRefineSelection(session, active, beforeFarElementIds, {
    includeTransitions: true,
    regularizeHexSelection: true,
    mergeTolerance: 1e-9
  });

  refineSessionPatch(session, ["e72"], {
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: active
  });
  active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const afterFarElementIds = firstSelectedChildren
    .map((cellId) => activeBuildElementIdByCellId(session, active, cellId))
    .filter((elementId) => elementId !== undefined)
    .sort((a, b) => a - b);
  const afterFar = prepareSessionRefineSelection(session, active, afterFarElementIds, {
    includeTransitions: true,
    regularizeHexSelection: true,
    mergeTolerance: 1e-9
  });

  assert.equal(firstSelectedChildren.length, 27);
  assert.equal(beforeFar.elementIds.length, 8);
  assert.equal(afterFar.elementIds.length, beforeFar.elementIds.length);
  assert.equal(afterFar.outerElementIds.length, beforeFar.outerElementIds.length);
  assert.deepEqual(afterFar.warnings, []);
});

test("Hierarchical patch refinement creates selected and transition children", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const command = refineSessionPatch(session, ["e1"], { includeTransitions: true });
  const active = buildActiveMesh(session, { mergeNodes: true });
  const localCheck = checkRefinementSessionCommandConformance(session, command);
  const selectedChildren = command.createdCellIds.filter((cellId) => session.cells.get(cellId).role === "selected");
  const transitionChildren = command.createdCellIds.filter((cellId) => session.cells.get(cellId).role === "face-transition");

  assert.equal(command.hiddenCellIds.length, 2);
  assert.equal(selectedChildren.length, 27);
  assert.equal(transitionChildren.length, 13);
  assert.equal(active.elements.length, 40);
  assert.equal(checkNoHangingNodes(active).ok, true);
  assert.equal(localCheck.report.ok, true);
  assert.ok(localCheck.checkedCellIds.length <= active.elements.length);
  assert.throws(
    () => refineSessionPatch(session, [transitionChildren[0]], { includeTransitions: true }),
    /transition layer cells cannot be refined/
  );
});

test("Hierarchical patch refinement can reuse a prebuilt active mesh", () => {
  const sessionA = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const sessionB = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const prebuilt = buildActiveMeshWithMap(sessionB, { mergeNodes: true, mergeTolerance: 1e-9 });

  const commandA = refineSessionPatch(sessionA, ["e1"], { includeTransitions: true, mergeTolerance: 1e-9 });
  const commandB = refineSessionPatch(sessionB, ["e1"], {
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: prebuilt
  });
  const activeA = buildActiveMesh(sessionA, { mergeNodes: true });
  const activeB = buildActiveMesh(sessionB, { mergeNodes: true });

  assert.deepEqual(commandB.hiddenCellIds, commandA.hiddenCellIds);
  assert.equal(commandB.createdCellIds.length, commandA.createdCellIds.length);
  assert.equal(activeB.nodes.length, activeA.nodes.length);
  assert.equal(activeB.elements.length, activeA.elements.length);
  assert.equal(checkNoHangingNodes(activeB).ok, true);
});

test("Hierarchical patch refinement local active build matches global rebuild after prior refinement", () => {
  const sessionA = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const sessionB = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const firstA = refineSessionPatch(sessionA, ["e1"], { includeTransitions: true, mergeTolerance: 1e-9 });
  refineSessionPatch(sessionB, ["e1"], { includeTransitions: true, mergeTolerance: 1e-9 });
  const childId = firstA.createdCellIds.find((cellId) => sessionA.cells.get(cellId).role === "selected");
  assert.ok(childId);

  const commandA = refineSessionPatch(sessionA, [childId], { includeTransitions: true, mergeTolerance: 1e-9 });
  const prebuilt = buildActiveMeshWithMap(sessionB, {
    mergeNodes: true,
    mergeTolerance: 1e-9,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false
  });
  const commandB = refineSessionPatch(sessionB, [childId], {
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: prebuilt
  });
  const activeA = buildActiveMesh(sessionA, { mergeNodes: true, mergeTolerance: 1e-9 });
  const activeB = buildActiveMesh(sessionB, { mergeNodes: true, mergeTolerance: 1e-9 });

  assert.deepEqual(commandA.hiddenCellIds, commandB.hiddenCellIds);
  assert.equal(commandA.createdCellIds.length, commandB.createdCellIds.length);
  assert.equal(activeA.nodes.length, activeB.nodes.length);
  assert.equal(activeA.elements.length, activeB.elements.length);
  assert.equal(checkNoHangingNodes(activeA).ok, true);
  assert.equal(checkNoHangingNodes(activeB).ok, true);
});

test("Hierarchical local conformance check catches missing transition layers", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const command = refineSessionCell(session, "e1", refineHexTo27Hex);
  const localCheck = checkRefinementSessionCommandConformance(session, command);

  assert.equal(localCheck.report.ok, false);
  assert.ok(localCheck.report.hanging.length > 0);
  assert.ok(localCheck.checkedCellIds.includes("e2"));
});

test("Hierarchical refinement session only refines active cells on the same level", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const command = refineSessionCell(session, "e1", refineHexTo27Hex);
  const childId = command.createdCellIds[0];

  assert.equal(validateRefinementSessionSelection(session, [childId]).ok, true);

  const crossLevel = validateRefinementSessionSelection(session, [childId, "e2"]);
  assert.equal(crossLevel.ok, false);
  assert.deepEqual(crossLevel.mixedLevelCellIds, ["e2"]);
  assert.match(crossLevel.errors.join("; "), /crosses levels/);
  assert.throws(
    () => refineSessionCells(session, [childId, "e2"], refineHexTo27Hex),
    /crosses levels/
  );
});

test("Hierarchical refinement session rejects transition-layer cells as refine cores", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const command = refineSessionCell(session, "e1", refineHexTo27Hex);
  const transitionCellId = command.createdCellIds[0];
  session.cells.get(transitionCellId).role = "face-transition";

  const validation = validateRefinementSessionSelection(session, [transitionCellId]);
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.transitionCellIds, [transitionCellId]);
  assert.match(validation.errors.join("; "), /transition layer cells cannot be refined/);
  assert.throws(
    () => refineSessionCell(session, transitionCellId, refineHexTo27Hex),
    /transition layer cells cannot be refined/
  );
});

test("Hex session regularization uses active same-level refinable cells", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const command = refineSessionCell(session, "e1", refineHexTo27Hex);
  const childId = command.createdCellIds[0];

  const childSelection = regularizeHexSessionSelection(session, [childId]);
  assert.equal(childSelection.ok, true);
  assert.equal(childSelection.level, 1);
  assert.deepEqual(childSelection.originalCellIds, [childId]);
  assert.ok(childSelection.selectedCellIds.includes(childId));

  const mixedLevelSelection = regularizeHexSessionSelection(session, [childId, "e2"]);
  assert.equal(mixedLevelSelection.ok, true);
  assert.equal(mixedLevelSelection.level, 1);
  assert.deepEqual(mixedLevelSelection.ignoredCellIds, ["e2"]);
  assert.equal(mixedLevelSelection.selectedCellIds.includes(childId), true);
  assert.match(mixedLevelSelection.warnings.join("; "), /multiple refinement levels/);

  session.cells.get(command.createdCellIds[1]).role = "edge-transition";
  const transitionSelection = regularizeHexSessionSelection(session, [command.createdCellIds[1], childId, "e2"]);
  assert.equal(transitionSelection.ok, true);
  assert.equal(transitionSelection.level, 1);
  assert.deepEqual(transitionSelection.ignoredCellIds, [command.createdCellIds[1], "e2"]);
  assert.equal(transitionSelection.selectedCellIds.includes(childId), true);

  const onlyTransitionSelection = regularizeHexSessionSelection(session, [command.createdCellIds[1]]);
  assert.equal(onlyTransitionSelection.ok, false);
  assert.deepEqual(onlyTransitionSelection.ignoredCellIds, [command.createdCellIds[1]]);
});

test("Hex session regularization can grow a local topology layer before uvw crop", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(3, 1, 1));
  const grown = regularizeHexSessionSelection(session, ["e2"], { growTopologyLayers: 1 });

  assert.equal(grown.ok, true);
  assert.deepEqual(grown.sourceCellIds, ["e2"]);
  assert.deepEqual(grown.expandedCellIds, ["e1", "e2", "e3"]);
  assert.deepEqual(grown.selectedCellIds, ["e1", "e2", "e3"]);
  assert.match(grown.warnings.join("; "), /grew selection by topology layer/);
});

test("Q1 mesh refinement adds transition elements on the boundary", () => {
  const mesh = {
    kind: "Q1",
    nodes: [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1]
    ],
    elements: [
      [1, 2, 5, 4],
      [2, 3, 6, 5]
    ]
  };

  const pairs = findBoundaryPairs(mesh, [1]);
  assert.equal(pairs.length, 1);

  const refined = refineByElementIds(mesh, [1]);
  assert.equal(refined.kind, "Q1");
  assert.equal(refined.elements.length, 13);
  assert.ok(refined.nodes.length > mesh.nodes.length);
  assert.equal(checkNoHangingNodes(refined).ok, true);
});

test("Q1 boundary layer grow appends offset layers from selected boundary cells", () => {
  const mesh = createQ1UnitSquareMesh(2, 2);
  const result = growQ1BoundaryLayer(mesh, [1, 2], {
    height: 0.25,
    increments: 2
  });

  assert.equal(result.boundaryEdgeCount, 4);
  assert.equal(result.layerElementIds.length, 2);
  assert.equal(result.generatedElementIds.length, 8);
  assert.equal(result.mesh.elements.length, mesh.elements.length + 8);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
});

test("Q1 boundary layer grow supports boundary node arrangement bias", () => {
  const mesh = createQ1UnitSquareMesh(4, 1);
  const selected = [1, 2, 3, 4];
  const equal = growQ1BoundaryLayer(mesh, selected, {
    height: 0.1,
    increments: 1,
    nodeArrangement: 1
  });
  const corner = growQ1BoundaryLayer(mesh, selected, {
    height: 0.1,
    increments: 1,
    nodeArrangement: 0.5
  });
  const center = growQ1BoundaryLayer(mesh, selected, {
    height: 0.1,
    increments: 1,
    nodeArrangement: 2
  });

  const equalTop = topBoundaryXs(equal.mesh);
  const cornerTop = topBoundaryXs(corner.mesh);
  const centerTop = topBoundaryXs(center.mesh);
  assert.equal(equalTop.length, 5);
  assert.equal(cornerTop.length, 5);
  assert.equal(centerTop.length, 5);
  assert.ok(cornerTop[1] - cornerTop[0] < equalTop[1] - equalTop[0]);
  assert.ok(centerTop[1] - centerTop[0] > equalTop[1] - equalTop[0]);
});

test("Q1 boundary layer grow can fit back to the original boundary or preserve area", () => {
  const mesh = createQ1UnitSquareMesh(2, 2);
  const all = [1, 2, 3, 4];
  const fitted = growQ1BoundaryLayer(mesh, all, {
    height: 0.25,
    increments: 1,
    scaleMode: "fit-bounds"
  });
  const sameArea = growQ1BoundaryLayer(mesh, all, {
    height: 0.25,
    increments: 1,
    scaleMode: "preserve-area"
  });

  assert.deepEqual(q1Bounds(fitted.mesh), q1Bounds(mesh));
  assert.ok(Math.abs(q1Area(sameArea.mesh) - q1Area(mesh)) < 1e-10);
});

test("Q1 rectangle-circle template replacement creates selectable region sets", () => {
  const mesh = createQ1UnitSquareMesh(4, 4);
  const selected = idsInIndexBlock(4, 4, 1, [1, 1, 0], [2, 2, 0]);
  const result = replaceQ1BlockWithRectangleCircleTemplate(mesh, selected, {
    squareToCircleLayers: 1,
    annulusLayers: 2,
    circleToSquareLayers: 1
  });
  const regionCount = Object.values(result.regionElementIds)
    .reduce((total, ids) => total + ids.length, 0);

  assert.deepEqual(result.blockDimensions, [2, 2]);
  assert.equal(result.replacedElementIds.length, 4);
  assert.equal(regionCount, result.generatedElementIds.length);
  assert.ok(result.regionElementIds.core.length > 0);
  assert.ok(result.regionElementIds.annulus.length > 0);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
});

test("Q1 rectangle-circle template replacement accepts a deformed topological block", () => {
  const base = createQ1UnitSquareMesh(3, 2);
  const mesh = {
    ...base,
    nodes: base.nodes.map(([x, y]) => [
      x + 0.35 * y,
      0.18 * x + 1.1 * y
    ])
  };
  const selected = mesh.elements.map((_, index) => index + 1);
  const originalBoundaryNodes = [1, 2, 3, 4, 8, 12, 11, 10, 9, 5];
  const result = replaceQ1BlockWithRectangleCircleTemplate(mesh, selected, {
    squareToCircleLayers: 1,
    annulusLayers: 2,
    circleToSquareLayers: 1
  });

  assert.deepEqual(result.blockDimensions, [3, 2]);
  assert.equal(result.replacedElementIds.length, 6);
  for (const nodeId of originalBoundaryNodes) {
    const original = mesh.nodes[nodeId - 1];
    assert.ok(result.mesh.nodes.some((point) =>
      Math.hypot(point[0] - original[0], point[1] - original[1]) < 1e-9
    ));
  }
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
});

test("Q1 rectangle-circle template keeps annulus radii regular on a deformed block", () => {
  const base = createQ1UnitSquareMesh(3, 2);
  const mesh = {
    ...base,
    nodes: base.nodes.map(([x, y]) => [
      x + 0.35 * y,
      0.18 * x + 1.1 * y
    ])
  };
  const result = replaceQ1BlockWithRectangleCircleTemplate(mesh, mesh.elements.map((_, index) => index + 1), {
    innerCircleRatio: 0.35,
    outerCircleRatio: 0.55,
    squareToCircleLayers: 1,
    annulusLayers: 1,
    circleToSquareLayers: 1,
    omitCore: true
  });
  const annulusNodeIds = new Set(result.regionElementIds.annulus.flatMap((elementId) => result.mesh.elements[elementId - 1]));
  const center = [0.675, 0.64];
  const axisU = [0.5, 0.09];
  const axisV = [0.175, 0.55];
  const determinant = axisU[0] * axisV[1] - axisV[0] * axisU[1];
  const radii = [...annulusNodeIds].map((nodeId) => {
    const point = result.mesh.nodes[nodeId - 1];
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    const u = (dx * axisV[1] - axisV[0] * dy) / determinant;
    const v = (axisU[0] * dy - dx * axisU[1]) / determinant;
    return Math.hypot(u, v);
  });

  assert.ok(radii.every((radius) =>
    Math.abs(radius - 0.35) < 1e-10 || Math.abs(radius - 0.55) < 1e-10
  ));
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
});

test("Q1 rectangle-circle template shifts ring away from a non-smooth block side", () => {
  const base = createQ1UnitSquareMesh(3, 2);
  const mesh = {
    ...base,
    nodes: base.nodes.map((point, index) => index === 4 ? [-0.5, point[1]] : point)
  };
  const options = {
    innerCircleRatio: 0.35,
    outerCircleRatio: 0.55,
    squareToCircleLayers: 1,
    annulusLayers: 1,
    circleToSquareLayers: 1,
    omitCore: true
  };
  const unbiased = replaceQ1BlockWithRectangleCircleTemplate(mesh, mesh.elements.map((_, index) => index + 1), {
    ...options,
    irregularBoundaryBias: 0
  });
  const result = replaceQ1BlockWithRectangleCircleTemplate(mesh, mesh.elements.map((_, index) => index + 1), options);
  const averageAnnulusX = (replacement) => {
    const annulusNodeIds = new Set(replacement.regionElementIds.annulus.flatMap((elementId) => replacement.mesh.elements[elementId - 1]));
    return [...annulusNodeIds]
      .reduce((total, nodeId) => total + replacement.mesh.nodes[nodeId - 1][0], 0) / annulusNodeIds.size;
  };
  const unbiasedAverageX = averageAnnulusX(unbiased);
  const averageX = averageAnnulusX(result);

  assert.ok(averageX > unbiasedAverageX + 0.03);
  assert.ok(averageX > 0.54);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
});

test("Q1 rectangle-circle template negative irregular bias reverses the shift direction", () => {
  const base = createQ1UnitSquareMesh(3, 2);
  const mesh = {
    ...base,
    nodes: base.nodes.map((point, index) => index === 4 ? [-0.5, point[1]] : point)
  };
  const options = {
    innerCircleRatio: 0.35,
    outerCircleRatio: 0.55,
    squareToCircleLayers: 1,
    annulusLayers: 1,
    circleToSquareLayers: 1,
    omitCore: true
  };
  const unbiased = replaceQ1BlockWithRectangleCircleTemplate(mesh, mesh.elements.map((_, index) => index + 1), {
    ...options,
    irregularBoundaryBias: 0
  });
  const reversed = replaceQ1BlockWithRectangleCircleTemplate(mesh, mesh.elements.map((_, index) => index + 1), {
    ...options,
    irregularBoundaryBias: -1
  });
  const averageAnnulusX = (replacement) => {
    const annulusNodeIds = new Set(replacement.regionElementIds.annulus.flatMap((elementId) => replacement.mesh.elements[elementId - 1]));
    return [...annulusNodeIds]
      .reduce((total, nodeId) => total + replacement.mesh.nodes[nodeId - 1][0], 0) / annulusNodeIds.size;
  };

  assert.ok(averageAnnulusX(reversed) < averageAnnulusX(unbiased) - 0.03);
  assert.equal(checkNoHangingNodes(reversed.mesh, 1e-9).ok, true);
});

test("Q1 rectangle-circle template accepts absolute ring radii in model units", () => {
  const mesh = createQ1UnitSquareMesh(4, 4);
  const selected = idsInIndexBlock(4, 4, 1, [0, 0, 0], [3, 3, 0]);
  const result = replaceQ1BlockWithRectangleCircleTemplate(mesh, selected, {
    innerCircleRadius: 0.2,
    outerCircleRadius: 0.3,
    squareToCircleLayers: 1,
    annulusLayers: 1,
    circleToSquareLayers: 1
  });
  const center = [0.5, 0.5];
  const radii = result.mesh.nodes.map((point) => Math.hypot(point[0] - center[0], point[1] - center[1]));

  assert.ok(radii.some((radius) => Math.abs(radius - 0.2) < 1e-10));
  assert.ok(radii.some((radius) => Math.abs(radius - 0.3) < 1e-10));
});

test("Q1 rectangle-circle template can omit the filled core and internal transition", () => {
  const mesh = createQ1UnitSquareMesh(4, 4);
  const selected = idsInIndexBlock(4, 4, 1, [1, 1, 0], [2, 2, 0]);
  const filled = replaceQ1BlockWithRectangleCircleTemplate(mesh, selected, {
    squareToCircleLayers: 1,
    annulusLayers: 1,
    circleToSquareLayers: 1
  });
  const ringOnly = replaceQ1BlockWithRectangleCircleTemplate(mesh, selected, {
    squareToCircleLayers: 1,
    annulusLayers: 1,
    circleToSquareLayers: 1,
    omitCore: true
  });
  const ringCount = ringOnly.regionElementIds.annulus.length
    + ringOnly.regionElementIds.circleToSquare.length;
  const generatedNodeIds = new Set(
    ringOnly.generatedElementIds.flatMap((elementId) => ringOnly.mesh.elements[elementId - 1])
  );
  const center = [0.5, 0.5];
  const minGeneratedRadius = Math.min(...[...generatedNodeIds].map((nodeId) => {
    const point = ringOnly.mesh.nodes[nodeId - 1];
    return Math.hypot(point[0] - center[0], point[1] - center[1]);
  }));

  assert.equal(ringOnly.regionElementIds.core.length, 0);
  assert.equal(ringOnly.regionElementIds.squareToCircle.length, 0);
  assert.equal(ringOnly.generatedElementIds.length, ringCount);
  assert.equal(filled.generatedElementIds.length - ringOnly.generatedElementIds.length, 12);
  assert.ok(Math.abs(minGeneratedRadius - 0.1125) < 1e-10);
  assert.equal(checkNoHangingNodes(ringOnly.mesh, 1e-9).ok, true);
});

test("Hex mesh refinement adds face transition elements on the boundary", () => {
  const nodes = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [2, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [2, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
    [2, 1, 1]
  ];
  const mesh = {
    kind: "H1",
    nodes,
    elements: [
      [1, 2, 5, 4, 7, 8, 11, 10],
      [2, 3, 6, 5, 8, 9, 12, 11]
    ]
  };

  const refined = refineByElementIds(mesh, [1]);
  assert.equal(refined.kind, "H1");
  assert.equal(refined.elements.length, 40);
  assert.ok(refined.nodes.length > mesh.nodes.length);
});

test("Hex corner transition layer has no hanging nodes", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 2);
  const refined = refineByElementIds(mesh, [1]);
  const report = checkNoHangingNodes(refined, 1e-9);

  assert.equal(refined.kind, "H1");
  assert.equal(report.hanging.length, 0);
  assert.equal(report.ok, true);
});

test("Hex 2:1 refinement builds a level-closed full-section transition", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  const selected = idsInIndexBlock(2, 2, 5, [0, 0, 2], [1, 1, 2]);
  const result = refineByElementIdsWithReport(mesh, selected, {
    hexRefinementRatio: 2,
    regularizeHexSelection: false
  });
  const templateCounts = countBy(result.cellData.map((cell) => cell.templateCode));

  assert.equal(result.mesh.elements.length, 96);
  assert.equal(result.summary.selectedElementCount, 4);
  assert.equal(result.summary.faceTransitionElementCount, 8);
  assert.equal(result.summary.edgeTransitionElementCount, 0);
  assert.equal(result.summary.cornerTransitionElementCount, 0);
  assert.equal(templateCounts.get(8), 32);
  assert.equal(templateCounts.get(7), 56);
  assert.equal(templateCounts.get(0), 8);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
});

test("Hex 2:1 refinement closes a genuinely local structured box in three directions", () => {
  const mesh = createHexUnitCubeMesh(5, 5, 5);
  const selectedElementId = elementIdAt(5, 5, 5, 2, 2, 2);
  const result = refineByElementIdsWithReport(mesh, [selectedElementId], {
    hexRefinementRatio: 2,
    regularizeHexSelection: false
  });
  const repeated = refineByElementIdsWithReport(mesh, [selectedElementId], {
    hexRefinementRatio: 2,
    regularizeHexSelection: false
  });
  const selectedChildren = result.cellData.filter((cell) =>
    cell.parentElementId === selectedElementId && cell.role === "selected"
  );
  const selectedNodeIds = new Set(
    result.mesh.elements
      .filter((_, index) =>
        result.cellData[index]?.parentElementId === selectedElementId
        && result.cellData[index]?.role === "selected"
      )
      .flat()
  );

  assert.equal(selectedChildren.length, 8);
  assert.equal(result.mesh.elements.length, 283);
  assert.equal(result.summary.unchangedElementCount, 99);
  assert.equal(
    result.summary.faceTransitionElementCount
      + result.summary.edgeTransitionElementCount
      + result.summary.cornerTransitionElementCount,
    25
  );
  assert.deepEqual(repeated.mesh, result.mesh);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
  assert.ok(Math.abs(hexMeshVolume(result.mesh) - 1) < 1e-10);
  assert.ok(minimumCornerScaledJacobian(result.mesh) > 0);
  for (const nodeId of selectedNodeIds) {
    for (const coordinate of result.mesh.nodes[nodeId - 1]) {
      assert.ok(Math.abs(coordinate * 10 - Math.round(coordinate * 10)) < 1e-10);
    }
  }
});

test("Hex 2:1 direct flat plan reports a mapped local-sweep capability", () => {
  const mesh = createHexUnitCubeMesh(5, 5, 5);
  const selectedElementId = elementIdAt(5, 5, 5, 2, 2, 2);
  const preview = previewRefinementByElementIds(mesh, [selectedElementId], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    regularizeHexSelection: false
  });
  const direct = buildDirectTwoToOneHexPlan(mesh, [selectedElementId]);
  const affectedParentIds = [
    ...new Set(preview.plan.map((item) => item.parentElementId))
  ].sort((first, second) => first - second);

  assert.equal(direct.strategy, "local-sweep");
  assert.deepEqual(
    buildTwoToOneHexReplacements(mesh, [selectedElementId]),
    direct.replacements
  );
  assert.equal(preview.planMode, "per-parent");
  assert.deepEqual(preview.twoToOne, {
    status: "direct",
    topologyClass: "mapped",
    originalSelectedCellIds: [selectedElementId],
    effectiveSelectedCellIds: [selectedElementId],
    actions: [],
    affectedComponentCellIds: affectedParentIds,
    preservedFarFieldCellCount: mesh.elements.length - affectedParentIds.length
  });
});

test("Hex 2:1 direct session plan maps and deep-copies capability ids", () => {
  const mesh = createHexUnitCubeMesh(5, 5, 5);
  const session = createRefinementSession(mesh);
  const active = buildActiveMeshWithMap(session);
  const selectedElementId = elementIdAt(5, 5, 5, 2, 2, 2);
  const selectedCellId = activeBuildCellIdByElementId(active, selectedElementId);
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: active
  };
  const preview = previewSessionPatch(session, [selectedCellId], options);
  const command = refineSessionPatch(session, [selectedCellId], options);

  assert.equal(preview.twoToOne.status, "direct");
  assert.equal(preview.twoToOne.topologyClass, "mapped");
  assert.deepEqual(preview.twoToOne.originalSelectedCellIds, [selectedCellId]);
  assert.deepEqual(preview.twoToOne.effectiveSelectedCellIds, [selectedCellId]);
  assert.deepEqual(preview.twoToOne, command.twoToOne);
  assert.notEqual(preview.twoToOne, command.twoToOne);
  assert.notEqual(
    preview.twoToOne.affectedComponentCellIds,
    command.twoToOne.affectedComponentCellIds
  );
});

test("Hex 2:1 direct flat plan without transitions deduplicates selected ids", () => {
  const mesh = createHexUnitCubeMesh(5, 5, 5);
  const selectedElementId = elementIdAt(5, 5, 5, 2, 2, 2);
  const selected = [selectedElementId, selectedElementId, selectedElementId];
  const hexPlan = buildHexClassifiedPlan(mesh, selected, {
    hexRefinementRatio: 2,
    includeTransitions: false
  });
  const defaultPlan = buildDefaultRefinementPlan(mesh, selected, {
    hexRefinementRatio: 2,
    includeTransitions: false
  });
  const preview = previewRefinementByElementIds(mesh, selected, {
    hexRefinementRatio: 2,
    includeTransitions: false,
    regularizeHexSelection: false
  });
  const result = refineByElementIdsWithReport(mesh, selected, {
    hexRefinementRatio: 2,
    includeTransitions: false,
    regularizeHexSelection: false
  });
  const sortedPlan = buildHexClassifiedPlan(
    mesh,
    [selectedElementId + 1, selectedElementId, selectedElementId + 1],
    {
      hexRefinementRatio: 2,
      includeTransitions: false
    }
  );

  assert.deepEqual(
    hexPlan.replacements.map((replacement) => replacement.elementId),
    [selectedElementId]
  );
  assert.deepEqual(
    defaultPlan.replacements.map((replacement) => replacement.elementId),
    [selectedElementId]
  );
  assert.deepEqual(
    sortedPlan.replacements.map((replacement) => replacement.elementId),
    [selectedElementId, selectedElementId + 1]
  );
  assert.deepEqual(hexPlan.twoToOne, defaultPlan.twoToOne);
  assert.deepEqual(
    buildDefaultRefinementReplacements(mesh, selected, {
      hexRefinementRatio: 2,
      includeTransitions: false
    }),
    defaultPlan.replacements
  );
  assert.deepEqual(preview.twoToOne, {
    status: "direct",
    topologyClass: "mapped",
    originalSelectedCellIds: [selectedElementId],
    effectiveSelectedCellIds: [selectedElementId],
    actions: [],
    affectedComponentCellIds: [selectedElementId],
    preservedFarFieldCellCount: mesh.elements.length - 1
  });
  assert.deepEqual(result.twoToOne, preview.twoToOne);
});

test("Hex 2:1 classified plans reject invalid ids as topology without mutation", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 2);
  const snapshot = structuredClone(mesh);
  const error = captureError(() => buildHexClassifiedPlan(mesh, [0], {
    hexRefinementRatio: 2,
    includeTransitions: false
  }));

  assert.equal(error instanceof DirectTwoToOnePlanningError, true);
  assert.equal(error.kind, "topology");
  assert.deepEqual(error.conflictingElementIds, [0]);
  assert.deepEqual(mesh, snapshot);
});

test("Hex 2:1 empty preview/result are no-ops without capability reports", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 2);
  const classified = buildHexClassifiedPlan(mesh, [], {
    hexRefinementRatio: 2
  });
  const preview = previewRefinementByElementIds(mesh, [], {
    hexRefinementRatio: 2,
    regularizeHexSelection: false
  });
  const result = refineByElementIdsWithReport(mesh, [], {
    hexRefinementRatio: 2,
    regularizeHexSelection: false
  });

  assert.deepEqual(classified.replacements, []);
  assert.equal(Object.hasOwn(classified, "twoToOne"), false);
  assert.deepEqual(preview.plan, []);
  assert.equal(Object.hasOwn(preview, "twoToOne"), false);
  assert.deepEqual(result.mesh, mesh);
  assert.equal(Object.hasOwn(result, "twoToOne"), false);
});

test("Hex 2:1 solver classifies a free coarse boundary selection signature", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  const snapshot = structuredClone(mesh);
  const error = captureError(() =>
    buildDirectTwoToOneHexPlan(mesh, [5, 6, 7, 8])
  );

  assert.equal(error instanceof DirectTwoToOnePlanningError, true);
  assert.equal(error.kind, "selection-signature");
  assert.match(error.message, /reaches a free boundary on its coarse side/);
  assert.deepEqual(error.conflictingElementIds, [1]);
  assert.deepEqual(mesh, snapshot);
});

test("Hex 2:1 solver classifies an odd full-section field as parity", () => {
  const mesh = createHexUnitCubeMesh(3, 3, 3);
  const snapshot = structuredClone(mesh);
  const error = captureError(() =>
    buildDirectTwoToOneHexPlan(
      mesh,
      Array.from({ length: 9 }, (_, index) => index + 1)
    )
  );

  assert.equal(error instanceof DirectTwoToOnePlanningError, true);
  assert.equal(error.kind, "parity");
  assert.equal(error.message, "no level-closed 2:1 seven-hex transition field exists");
  assert.deepEqual(
    error.conflictingElementIds,
    Array.from({ length: 9 }, (_, index) => index + 10)
  );
  assert.deepEqual(mesh, snapshot);
});

test("Hex 2:1 solver valence errors retain both owners and the transition", () => {
  const mesh = createButterflyOgridBar(3);
  const snapshot = structuredClone(mesh);
  const selected = [13, 15];
  const error = captureError(() =>
    buildDirectTwoToOneHexPlan(mesh, selected)
  );
  selected.push(99);

  assert.equal(error instanceof DirectTwoToOnePlanningError, true);
  assert.equal(error.kind, "valence");
  assert.match(error.message, /transition columns overlap at element 14/);
  assert.deepEqual(error.conflictingElementIds, [13, 14, 15]);
  assert.deepEqual(mesh, snapshot);
});

test("Hex 2:1 solver leaves sweep invariants as ordinary errors", () => {
  const base = createHexUnitCubeMesh(5, 5, 5);
  const mesh = {
    ...base,
    nodes: base.nodes.map((point) => [...point, 0])
  };
  const snapshot = structuredClone(mesh);
  const error = captureError(() =>
    buildDirectTwoToOneHexPlan(mesh, [elementIdAt(5, 5, 5, 2, 2, 2)])
  );

  assert.equal(error instanceof Error, true);
  assert.equal(error instanceof DirectTwoToOnePlanningError, false);
  assert.match(error.message, /local 2:1 sweep entity vertex:\d+ maps inconsistently/);
  assert.deepEqual(mesh, snapshot);
});

test("Hex 3:1 and Q1 preview/result omit twoToOne", () => {
  const hex = createHexUnitCubeMesh(3, 3, 3);
  const hexElementId = elementIdAt(3, 3, 3, 1, 1, 1);
  const hexOptions = {
    hexRefinementRatio: 3,
    includeTransitions: false,
    regularizeHexSelection: false
  };
  const hexPreview = previewRefinementByElementIds(hex, [hexElementId], hexOptions);
  const hexResult = refineByElementIdsWithReport(hex, [hexElementId], hexOptions);
  const q1 = createQ1UnitSquareMesh(2, 2);
  const q1Options = {
    hexRefinementRatio: 2,
    includeTransitions: true
  };
  const q1Preview = previewRefinementByElementIds(q1, [1], q1Options);
  const q1Result = refineByElementIdsWithReport(q1, [1], q1Options);

  assert.equal(Object.hasOwn(hexPreview, "twoToOne"), false);
  assert.equal(Object.hasOwn(hexResult, "twoToOne"), false);
  assert.equal(Object.hasOwn(q1Preview, "twoToOne"), false);
  assert.equal(Object.hasOwn(q1Result, "twoToOne"), false);
});

test("Hex 2:1 local sweep uniformly refines a mixed odd-even rectangular core", () => {
  const mesh = createHexUnitCubeMesh(7, 7, 7);
  const selected = idsInIndexBlock(7, 7, 7, [2, 2, 2], [4, 3, 4]);
  const result = refineByElementIdsWithReport(mesh, selected, {
    hexRefinementRatio: 2,
    regularizeHexSelection: false
  });

  for (const parentElementId of selected) {
    assert.equal(
      result.cellData.filter((cell) =>
        cell.parentElementId === parentElementId && cell.role === "selected"
      ).length,
      8
    );
  }
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
  assert.ok(Math.abs(hexMeshVolume(result.mesh) - 1) < 1e-10);
  assert.ok(minimumCornerScaledJacobian(result.mesh) > 0);
});

test("Hex 2:1 local sweep follows a warped mapped block", () => {
  const base = createHexUnitCubeMesh(5, 5, 5);
  const mesh = {
    ...base,
    nodes: base.nodes.map(([x, y, z]) => [
      x + 0.015 * y * z,
      y + 0.010 * x * z,
      z + 0.012 * x * y
    ])
  };
  const selectedElementId = elementIdAt(5, 5, 5, 2, 2, 2);
  const result = refineByElementIdsWithReport(mesh, [selectedElementId], {
    hexRefinementRatio: 2,
    regularizeHexSelection: false
  });

  assert.equal(
    result.cellData.filter((cell) =>
      cell.parentElementId === selectedElementId && cell.role === "selected"
    ).length,
    8
  );
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
  assert.ok(Math.abs(hexMeshVolume(result.mesh) - hexMeshVolume(mesh)) < 1e-10);
  assert.ok(minimumCornerScaledJacobian(result.mesh) > 0);
});

test("Hex 2:1 local sweep closes an L-shaped core with paired pattern-3 templates", () => {
  const mesh = createHexUnitCubeMesh(5, 5, 2);
  const selected = [
    ...idsInIndexBlock(5, 5, 2, [0, 0, 0], [3, 1, 1]),
    ...idsInIndexBlock(5, 5, 2, [0, 2, 0], [1, 3, 1])
  ];
  const result = refineByElementIdsWithReport(mesh, selected, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    regularizeHexSelection: false
  });

  for (const parentElementId of selected) {
    assert.equal(
      result.cellData.filter((cell) =>
        cell.parentElementId === parentElementId && cell.role === "selected"
      ).length,
      8
    );
  }
  assert.equal(result.mesh.elements.length, 328);
  assert.equal(result.mesh.nodes.length, 473);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
  assert.ok(Math.abs(hexMeshVolume(result.mesh) - 1) < 1e-10);
  assert.ok(minimumCornerScaledJacobian(result.mesh) > 0);
});

test("Hex 2:1 local sweep refines two disjoint logical cores in one operation", () => {
  const mesh = createHexUnitCubeMesh(9, 9, 9);
  const selected = [
    ...idsInIndexBlock(9, 9, 9, [1, 1, 2], [2, 2, 3]),
    ...idsInIndexBlock(9, 9, 9, [6, 6, 2], [7, 7, 3])
  ];
  const result = refineByElementIdsWithReport(mesh, selected, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    regularizeHexSelection: false
  });

  for (const parentElementId of selected) {
    assert.equal(
      result.cellData.filter((cell) =>
        cell.parentElementId === parentElementId && cell.role === "selected"
      ).length,
      8
    );
  }
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
  assert.ok(Math.abs(hexMeshVolume(result.mesh) - 1) < 1e-10);
  assert.ok(minimumCornerScaledJacobian(result.mesh) > 0);
});

test("Hex 2:1 O-grid direct plan reports periodic strategy capability", () => {
  const mesh = createButterflyOgridBar(6);
  const selected = Array.from({ length: 24 }, (_, index) => 25 + index);
  const direct = buildDirectTwoToOneHexPlan(mesh, selected);
  const result = refineByElementIdsWithReport(mesh, selected, {
    hexRefinementRatio: 2,
    regularizeHexSelection: false
  });
  const templateCounts = countBy(result.cellData.map((cell) => cell.templateCode));

  assert.equal(direct.strategy, "seven-hex");
  assert.equal(result.mesh.elements.length, 384);
  assert.equal(result.summary.selectedElementCount, 24);
  assert.equal(result.summary.faceTransitionElementCount, 24);
  assert.equal(templateCounts.get(8), 192);
  assert.equal(templateCounts.get(7), 168);
  assert.equal(templateCounts.get(0), 24);
  assert.equal(result.twoToOne.status, "direct");
  assert.equal(result.twoToOne.topologyClass, "periodic-ogrid");
  assert.deepEqual(result.twoToOne.originalSelectedCellIds, selected);
  assert.deepEqual(result.twoToOne.effectiveSelectedCellIds, selected);
  assert.deepEqual(result.twoToOne.actions, []);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
  assert.ok(Math.abs(hexMeshVolume(result.mesh) - hexMeshVolume(mesh)) < 1e-10);
  assert.ok(minimumCornerScaledJacobian(result.mesh) > 0);
});

test("Hex 2:1 box refinement completes a local pick to a full section", () => {
  const mesh = createHexUnitCubeMesh(4, 4, 7);
  const result = refineByBoxWithReport(mesh, {
    min: [0.3, 0.3, 0.45],
    max: [0.45, 0.45, 0.55]
  }, {
    hexRefinementRatio: 2,
    regularizeHexSelection: true
  });

  assert.ok(result.regularization);
  assert.deepEqual(result.regularization.indexRange?.dimensions, [4, 4, 1]);
  assert.equal(result.regularization.originalElementIds.length, 1);
  assert.equal(result.regularization.selectedElementIds.length, 16);
  assert.equal(result.regularization.addedElementIds.length, 15);
  assert.equal(result.summary.selectedElementCount, 16);
  assert.equal(result.summary.faceTransitionElementCount, 32);
  assert.equal(result.mesh.elements.length, 416);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
});

test("Hex 2:1 box refinement can preserve a genuinely local regularized core", () => {
  const mesh = createHexUnitCubeMesh(5, 5, 5);
  const result = refineByBoxWithReport(mesh, {
    min: [0.45, 0.45, 0.45],
    max: [0.55, 0.55, 0.55]
  }, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    regularizeHexSelection: true
  });

  assert.ok(result.regularization);
  assert.deepEqual(result.regularization.indexRange?.dimensions, [1, 1, 1]);
  assert.equal(result.regularization.selectedElementIds.length, 1);
  assert.equal(result.summary.selectedElementCount, 1);
  assert.equal(result.mesh.elements.length, 283);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
});

test("Hex 2:1 section completion chooses an axis with even transverse counts", () => {
  const mesh = createHexUnitCubeMesh(8, 5, 6);
  const selectedElementId = elementIdAt(8, 5, 6, 3, 2, 2);
  const regularized = regularizeTwoToOneHexSelection(
    mesh,
    [selectedElementId]
  );

  assert.deepEqual(regularized.indexRange?.dimensions, [8, 1, 6]);
  assert.equal(regularized.selectedElementIds.length, 48);
});

test("Hex 2:1 section completion honors an explicit logical transition axis", () => {
  const mesh = createHexUnitCubeMesh(8, 6, 6);
  const selectedElementId = elementIdAt(8, 6, 6, 3, 2, 2);
  const regularized = regularizeTwoToOneHexSelection(
    mesh,
    [selectedElementId],
    { transitionAxis: 2 }
  );

  assert.deepEqual(regularized.indexRange?.dimensions, [8, 6, 1]);
  assert.equal(regularized.selectedElementIds.length, 48);
  assert.match(regularized.warnings.join("\n"), /logical axis 3 is the transition direction/);
});

test("Hex 2:1 section completion rejects grids without an even transverse pair", () => {
  const mesh = createHexUnitCubeMesh(4, 3, 7);
  const selectedElementId = elementIdAt(4, 3, 7, 1, 1, 3);

  assert.throws(
    () => regularizeTwoToOneHexSelection(mesh, [selectedElementId]),
    /requires two even transverse grid dimensions/
  );
});

test("Hex 2:1 session preparation completes a local pick to a full section", () => {
  const mesh = createHexUnitCubeMesh(4, 4, 7);
  const session = createRefinementSession(mesh);
  const active = buildActiveMeshWithMap(session);
  const selectedElementId = elementIdAt(4, 4, 7, 1, 1, 3);
  const prepared = prepareSessionRefineSelection(session, active, [selectedElementId], {
    hexRefinementRatio: 2,
    regularizeHexSelection: true
  });

  assert.deepEqual(prepared.regularization?.indexRange?.dimensions, [4, 4, 1]);
  assert.equal(prepared.elementIds.length, 16);
  assert.equal(prepared.cellIds.length, 16);

  refineSessionPatch(session, prepared.cellIds, {
    hexRefinementRatio: 2,
    includeTransitions: true,
    activeBuild: active
  });
  const refined = buildActiveMesh(session, { mergeNodes: true, mergeTolerance: 1e-9 });
  assert.equal(refined.elements.length, 416);
  assert.equal(checkNoHangingNodes(refined, 1e-9).ok, true);
});

test("Hex 2:1 session preparation can keep a local box core", () => {
  const mesh = createHexUnitCubeMesh(5, 5, 5);
  const session = createRefinementSession(mesh);
  const active = buildActiveMeshWithMap(session);
  const selectedElementId = elementIdAt(5, 5, 5, 2, 2, 2);
  const prepared = prepareSessionRefineSelection(session, active, [selectedElementId], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    regularizeHexSelection: true
  });

  assert.deepEqual(prepared.regularization?.indexRange?.dimensions, [1, 1, 1]);
  assert.equal(prepared.elementIds.length, 1);
  assert.equal(prepared.cellIds.length, 1);

  refineSessionPatch(session, prepared.cellIds, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: active
  });
  const refined = buildActiveMesh(session, { mergeNodes: true, mergeTolerance: 1e-9 });
  assert.equal(refined.elements.length, 283);
  assert.equal(checkNoHangingNodes(refined, 1e-9).ok, true);
});

test("Hex 2:1 session refinement preserves an explicit L-shaped core", () => {
  const mesh = createHexUnitCubeMesh(5, 5, 2);
  const session = createRefinementSession(mesh);
  const active = buildActiveMeshWithMap(session);
  const selectedElementIds = [
    ...idsInIndexBlock(5, 5, 2, [0, 0, 0], [3, 1, 1]),
    ...idsInIndexBlock(5, 5, 2, [0, 2, 0], [1, 3, 1])
  ];
  const selectedCellIds = selectedElementIds
    .map((elementId) => activeBuildCellIdByElementId(active, elementId))
    .filter(Boolean);

  refineSessionPatch(session, selectedCellIds, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: active
  });
  const refined = buildActiveMesh(session, { mergeNodes: true, mergeTolerance: 1e-9 });

  assert.equal(refined.elements.length, 328);
  assert.equal(refined.nodes.length, 473);
  assert.equal(checkNoHangingNodes(refined, 1e-9).ok, true);
});

test("Hex 2:1 session preparation supports a second level inside the refined core", () => {
  const mesh = createHexUnitCubeMesh(4, 4, 7);
  const session = createRefinementSession(mesh);
  const initial = buildActiveMeshWithMap(session);
  const firstCoreElementIds = idsInIndexBlock(4, 4, 7, [0, 0, 2], [3, 3, 4]);
  const firstCoreCellIds = firstCoreElementIds
    .map((elementId) => activeBuildCellIdByElementId(initial, elementId))
    .filter(Boolean);

  refineSessionPatch(session, firstCoreCellIds, {
    hexRefinementRatio: 2,
    includeTransitions: true,
    activeBuild: initial
  });

  const firstRefined = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const secondLevelCandidates = firstRefined.mesh.elements
    .map((element, index) => {
      const elementId = index + 1;
      const cellId = activeBuildCellIdByElementId(firstRefined, elementId);
      const cell = cellId ? session.cells.get(cellId) : undefined;
      const centerZ = element.reduce(
        (total, nodeId) => total + firstRefined.mesh.nodes[nodeId - 1][2],
        0
      ) / element.length;
      return cell?.level === 1
        && cell.role === "selected"
        && centerZ > 0.45
        && centerZ < 0.5
        ? elementId
        : undefined;
    })
    .filter((elementId) => elementId !== undefined);
  assert.equal(secondLevelCandidates.length, 64);

  const prepared = prepareSessionRefineSelection(
    session,
    firstRefined,
    [secondLevelCandidates[0]],
    {
      hexRefinementRatio: 2,
      regularizeHexSelection: true
    }
  );
  assert.equal(prepared.elementIds.length, 64);

  refineSessionPatch(session, prepared.cellIds, {
    hexRefinementRatio: 2,
    includeTransitions: true,
    activeBuild: firstRefined
  });
  const twiceRefined = buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  assert.equal(twiceRefined.elements.length, 1856);
  assert.equal(checkNoHangingNodes(twiceRefined, 1e-9).ok, true);
});

test("Hex 2:1 local refinement supports a second level inside a uniform refined core", () => {
  const mesh = createHexUnitCubeMesh(7, 7, 7);
  const session = createRefinementSession(mesh);
  const initial = buildActiveMeshWithMap(session);
  const firstCoreElementIds = idsInIndexBlock(7, 7, 7, [2, 2, 2], [4, 4, 4]);
  const firstCoreCellIds = firstCoreElementIds
    .map((elementId) => activeBuildCellIdByElementId(initial, elementId))
    .filter(Boolean);

  refineSessionPatch(session, firstCoreCellIds, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: initial
  });

  const firstRefined = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const centerCandidate = firstRefined.mesh.elements
    .map((element, index) => {
      const elementId = index + 1;
      const cellId = activeBuildCellIdByElementId(firstRefined, elementId);
      const cell = cellId ? session.cells.get(cellId) : undefined;
      const center = [0, 1, 2].map((axis) => element.reduce(
        (total, nodeId) => total + firstRefined.mesh.nodes[nodeId - 1][axis],
        0
      ) / element.length);
      const distanceSquared = center.reduce((total, coordinate) =>
        total + ((coordinate - 0.5) ** 2), 0);
      return cell?.level === 1 && cell.role === "selected"
        ? { elementId, distanceSquared }
        : undefined;
    })
    .filter(Boolean)
    .sort((left, right) => left.distanceSquared - right.distanceSquared)[0];
  assert.ok(centerCandidate);

  const prepared = prepareSessionRefineSelection(
    session,
    firstRefined,
    [centerCandidate.elementId],
    {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      regularizeHexSelection: true
    }
  );
  assert.equal(prepared.elementIds.length, 1);
  assert.deepEqual(prepared.regularization?.gridDimensions, [6, 6, 6]);
  assert.deepEqual(prepared.regularization?.indexRange?.dimensions, [1, 1, 1]);
  assert.deepEqual(prepared.warnings, []);
  const beforePreview = {
    activeLeafCount: session.activeLeafIds.size,
    nodeCount: session.nodes.length,
    undoCount: session.undoStack.length
  };
  const patchOptions = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: firstRefined
  };
  const patchPreview = previewSessionPatch(session, prepared.cellIds, patchOptions);
  assert.equal(patchPreview.summary.selectedElementCount, 1);
  const affectedCellCount = new Set(
    patchPreview.twoToOne.affectedComponentCellIds
  ).size;
  assert.equal(beforePreview.activeLeafCount, 1171);
  assert.equal(
    patchPreview.twoToOne.preservedFarFieldCellCount,
    beforePreview.activeLeafCount - affectedCellCount
  );
  assert.deepEqual({
    activeLeafCount: session.activeLeafIds.size,
    nodeCount: session.nodes.length,
    undoCount: session.undoStack.length
  }, beforePreview);

  const command = refineSessionPatch(session, prepared.cellIds, patchOptions);
  assert.deepEqual(command.twoToOne, patchPreview.twoToOne);
  assert.notEqual(command.twoToOne, patchPreview.twoToOne);
  assert.notEqual(
    command.twoToOne.affectedComponentCellIds,
    patchPreview.twoToOne.affectedComponentCellIds
  );
  assert.deepEqual(command.quality, patchPreview.quality);
  assert.equal(command.quality?.ok, true);
  assert.equal(command.quality?.parentElementCount, patchPreview.plan.length);
  assert.ok((command.quality?.childMinimumOrientedScaledJacobian ?? 0) > 0);
  assert.ok((command.quality?.relativeVolumeError ?? 1) < 1e-10);
  const selectedChildren = command.createdCellIds
    .map((cellId) => session.cells.get(cellId))
    .filter((cell) => cell?.role === "selected");
  const twiceRefined = buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });

  assert.equal(selectedChildren.length, 8);
  assert.equal(
    command.createdCellIds.length,
    patchPreview.plan.reduce((total, item) => total + item.outputElementCount, 0)
  );
  assert.equal(checkNoHangingNodes(twiceRefined, 1e-9).ok, true);
  assert.ok(Math.abs(hexMeshVolume(twiceRefined) - 1) < 1e-10);
  assert.ok(minimumCornerScaledJacobian(twiceRefined) > 0);

  const stableTwoToOne = structuredClone(command.twoToOne);
  const undoneCommand = undoRefinementSession(session);
  assert.equal(undoneCommand?.id, command.id);
  assert.deepEqual(undoneCommand?.twoToOne, stableTwoToOne);
  assert.deepEqual(buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  }), firstRefined.mesh);
  const redoneCommand = redoRefinementSession(session);
  assert.equal(redoneCommand?.id, command.id);
  assert.deepEqual(redoneCommand?.twoToOne, stableTwoToOne);
  const redone = buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  assert.deepEqual(redone, twiceRefined);

  const exportedCellId = selectedChildren[0].id;
  const exportedSessionNodeId = session.cells.get(exportedCellId).element[0];
  const exported = buildRefinementSessionExport(session, {
    mergeTolerance: 1e-9,
    sets: {
      cellSets: { LEVEL_TWO_CORE: [exportedCellId] },
      nodeSets: { LEVEL_TWO_NODE: [exportedSessionNodeId] }
    }
  });
  assert.equal(exported.sets.cellSets.get("LEVEL_TWO_CORE").length, 1);
  assert.equal(exported.sets.nodeSets.get("LEVEL_TWO_NODE").length, 1);
});

test("Hex 2:1 local refinement supports a second level in a warped mapped core", () => {
  const base = createHexUnitCubeMesh(7, 7, 7);
  const mesh = {
    ...base,
    nodes: base.nodes.map(([x, y, z]) => [
      x + 0.015 * y * z,
      y + 0.010 * x * z,
      z + 0.012 * x * y
    ])
  };
  const session = createRefinementSession(mesh);
  const initial = buildActiveMeshWithMap(session);
  const firstCoreCellIds = idsInIndexBlock(7, 7, 7, [2, 2, 2], [4, 4, 4])
    .map((elementId) => activeBuildCellIdByElementId(initial, elementId))
    .filter(Boolean);
  refineSessionPatch(session, firstCoreCellIds, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: initial
  });

  const firstRefined = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const centerCellId = firstRefined.mesh.elements
    .map((element, index) => {
      const elementId = index + 1;
      const cellId = activeBuildCellIdByElementId(firstRefined, elementId);
      const cell = cellId ? session.cells.get(cellId) : undefined;
      const distanceSquared = [0, 1, 2].reduce((total, axis) => {
        const coordinate = element.reduce(
          (sum, nodeId) => sum + firstRefined.mesh.nodes[nodeId - 1][axis],
          0
        ) / element.length;
        return total + ((coordinate - 0.5) ** 2);
      }, 0);
      return cell?.level === 1 && cell.role === "selected"
        ? { cellId, distanceSquared }
        : undefined;
    })
    .filter(Boolean)
    .sort((left, right) => left.distanceSquared - right.distanceSquared)[0]?.cellId;
  assert.ok(centerCellId);
  refineSessionPatch(session, [centerCellId], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: firstRefined
  });
  const twiceRefined = buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });

  assert.equal(checkNoHangingNodes(twiceRefined, 1e-9).ok, true);
  assert.ok(Math.abs(hexMeshVolume(twiceRefined) - hexMeshVolume(mesh)) < 1e-10);
  assert.ok(minimumCornerScaledJacobian(twiceRefined) > 0);
});

test("Hex 2:1 transition-shell rebuilding previews a shell reached by a second-level core", () => {
  const mesh = createHexUnitCubeMesh(7, 7, 7);
  const session = createRefinementSession(mesh);
  const initial = buildActiveMeshWithMap(session);
  const firstCoreCellIds = idsInIndexBlock(7, 7, 7, [2, 2, 2], [4, 4, 4])
    .map((elementId) => activeBuildCellIdByElementId(initial, elementId))
    .filter(Boolean);
  refineSessionPatch(session, firstCoreCellIds, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: initial
  });

  const firstRefined = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const firstCoarseCellCount = [...session.activeLeafIds].filter((cellId) => {
    const cell = session.cells.get(cellId);
    return cell?.level === 0 && cell.role === "base";
  }).length;
  const protectedFarFieldCellIds = [...new Set([
    ...idsInIndexBlock(7, 7, 7, [6, 0, 0], [6, 6, 6]),
    ...idsInIndexBlock(7, 7, 7, [0, 6, 0], [6, 6, 6]),
    ...idsInIndexBlock(7, 7, 7, [0, 0, 6], [6, 6, 6])
  ])].map((elementId) => activeBuildCellIdByElementId(initial, elementId)).filter(Boolean);
  assert.equal(protectedFarFieldCellIds.length, 127);
  const boundaryCandidate = firstRefined.mesh.elements
    .map((element, index) => {
      const elementId = index + 1;
      const cellId = activeBuildCellIdByElementId(firstRefined, elementId);
      const cell = cellId ? session.cells.get(cellId) : undefined;
      const centerTotal = element.reduce(
        (total, nodeId) => total + firstRefined.mesh.nodes[nodeId - 1].reduce(
          (sum, coordinate) => sum + coordinate,
          0
        ),
        0
      ) / element.length;
      return cell?.level === 1 && cell.role === "selected"
        ? { cellId, centerTotal }
        : undefined;
    })
    .filter(Boolean)
    .sort((left, right) => left.centerTotal - right.centerTotal)[0];
  assert.ok(boundaryCandidate);

  const beforePreview = {
    activeLeafCount: session.activeLeafIds.size,
    nodeCount: session.nodes.length,
    undoCount: session.undoStack.length
  };
  const patchOptions = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: firstRefined
  };
  const singleSelectionPreview = previewSessionPatch(
    session,
    [boundaryCandidate.cellId],
    patchOptions
  );
  const preview = previewSessionPatch(
    session,
    [boundaryCandidate.cellId, boundaryCandidate.cellId],
    patchOptions
  );
  assert.deepEqual({
    activeLeafCount: session.activeLeafIds.size,
    nodeCount: session.nodes.length,
    undoCount: session.undoStack.length
  }, beforePreview);

  const command = refineSessionPatch(session, [
    boundaryCandidate.cellId,
    boundaryCandidate.cellId
  ], {
    ...patchOptions
  });
  const twiceRefined = buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });

  assert.equal(command.quality?.ok, true);
  assert.equal(command.quality?.parentElementCount, command.hiddenCellIds.length);
  assert.equal(
    command.quality?.childElementCount,
    (command.activeCreatedCellIds?.length ?? command.createdCellIds.length)
      + (command.reactivatedCellIds?.length ?? 0)
  );
  assert.deepEqual(preview.quality, command.quality);
  assert.deepEqual(preview.twoToOne, singleSelectionPreview.twoToOne);
  assert.deepEqual(preview.twoToOne, command.twoToOne);
  assert.equal(preview.twoToOne.status, "compensated");
  assert.equal(preview.twoToOne.topologyClass, "mixed-level");
  assert.deepEqual(preview.twoToOne.originalSelectedCellIds, [boundaryCandidate.cellId]);
  assert.equal(preview.twoToOne.actions.length, 1);
  assert.deepEqual(preview.twoToOne.actions[0], command.twoToOne.actions[0]);
  assert.equal(
    preview.twoToOne.preservedFarFieldCellCount,
    beforePreview.activeLeafCount - command.hiddenCellIds.length
  );
  assert.equal(preview.planMode, "aggregate");
  assert.deepEqual(preview.plan, []);
  assert.ok(twiceRefined.elements.length > firstRefined.mesh.elements.length);
  assert.deepEqual(preview.summary, {
    inputElementCount: firstRefined.mesh.elements.length,
    changedInputElementCount: command.hiddenCellIds.length,
    preservedInputElementCount: firstRefined.mesh.elements.length - command.hiddenCellIds.length,
    outputElementCount: twiceRefined.elements.length
  });
  assert.equal("selectedElementCount" in preview.summary, false);
  assert.equal("faceTransitionElementCount" in preview.summary, false);
  assert.deepEqual(preview.compound, {
    kind: "transition-shell-rebuild"
  });
  const twiceRefinedCoarseCellCount = [...session.activeLeafIds].filter((cellId) => {
    const cell = session.cells.get(cellId);
    return cell?.level === 0 && cell.role === "base";
  }).length;
  assert.ok(twiceRefinedCoarseCellCount > 100);
  assert.ok(twiceRefinedCoarseCellCount < firstCoarseCellCount);
  assert.equal(
    protectedFarFieldCellIds.every((cellId) => session.activeLeafIds.has(cellId)),
    true
  );
  assert.equal(checkNoHangingNodes(twiceRefined, 1e-9).ok, true);
  assert.ok(Math.abs(hexMeshVolume(twiceRefined) - 1) < 1e-10);
  assert.ok(minimumCornerScaledJacobian(twiceRefined) > 0);

  const stableTwoToOne = structuredClone(command.twoToOne);
  const undoneCommand = undoRefinementSession(session);
  assert.equal(undoneCommand?.id, command.id);
  assert.deepEqual(undoneCommand?.twoToOne, stableTwoToOne);
  assert.deepEqual(buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  }), firstRefined.mesh);
  const redoneCommand = redoRefinementSession(session);
  assert.equal(redoneCommand?.id, command.id);
  assert.deepEqual(redoneCommand?.twoToOne, stableTwoToOne);
  assert.deepEqual(buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  }), twiceRefined);

  const replayCommands = [
    {
      kind: "grid.generate",
      payload: {
        kind: "H1",
        nx: 7,
        ny: 7,
        nz: 7,
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        mergeTolerance: 1e-9
      }
    },
    {
      kind: "refine.patch",
      payload: {
        cellIds: firstCoreCellIds,
        options: {
          hexRefinementRatio: 2,
          hexTwoToOneSelectionMode: "local",
          includeTransitions: true,
          mergeTolerance: 1e-9
        }
      }
    },
    {
      kind: "refine.patch",
      payload: {
        cellIds: [boundaryCandidate.cellId],
        options: {
          hexRefinementRatio: 2,
          hexTwoToOneSelectionMode: "local",
          includeTransitions: true,
          mergeTolerance: 1e-9
        }
      }
    }
  ];
  const replay = replayHexRefineCommandScript({
    format: "hexrefine-command-script",
    version: 1,
    app: "HexRefine",
    commands: replayCommands
  });
  assert.deepEqual(replay.warnings, []);
  assert.deepEqual(replay.mesh, twiceRefined);
  assert.deepEqual(replay.session.undoStack.at(-1)?.twoToOne, stableTwoToOne);

  const snapshotReplay = replayHexRefineCommandScript({
    format: "hexrefine-command-script",
    version: 1,
    app: "HexRefine",
    commands: [
      ...replayCommands,
      {
        kind: "delete.elements",
        payload: {
          mode: "delete",
          elementIds: [1],
          deletedElementCount: 1,
          sourceElementCount: twiceRefined.elements.length
        }
      },
      { kind: "undo.delete" },
      { kind: "undo.refine" },
      { kind: "redo.refine" }
    ]
  });
  assert.deepEqual(snapshotReplay.warnings, []);
  assert.deepEqual(snapshotReplay.mesh, twiceRefined);
  assert.deepEqual(snapshotReplay.session.undoStack.at(-1)?.twoToOne, stableTwoToOne);
  assert.equal(checkNoHangingNodes(snapshotReplay.mesh, 1e-9).ok, true);

  const secondRefinedBuild = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const thirdLevelCandidate = secondRefinedBuild.mesh.elements
    .map((element, index) => {
      const cellId = activeBuildCellIdByElementId(secondRefinedBuild, index + 1);
      const cell = cellId ? session.cells.get(cellId) : undefined;
      const centerTotal = element.reduce(
        (total, nodeId) => total + secondRefinedBuild.mesh.nodes[nodeId - 1].reduce(
          (sum, coordinate) => sum + coordinate,
          0
        ),
        0
      ) / element.length;
      return cell?.level === 2 && cell.role === "selected"
        ? { cellId, centerTotal }
        : undefined;
    })
    .filter(Boolean)
    .sort((left, right) => left.centerTotal - right.centerTotal)[0]?.cellId;
  assert.ok(thirdLevelCandidate);
  const thirdCommand = refineSessionPatch(session, [thirdLevelCandidate], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: secondRefinedBuild
  });
  const thirdRefined = buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  assert.equal(thirdCommand.quality?.ok, true);
  assert.equal(checkNoHangingNodes(thirdRefined, 1e-9).ok, true);
  assert.ok(Math.abs(hexMeshVolume(thirdRefined) - 1) < 1e-10);
  assert.ok(minimumCornerScaledJacobian(thirdRefined) > 0);
  assert.equal(undoRefinementSession(session)?.id, thirdCommand.id);
  assert.deepEqual(buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  }), twiceRefined);
  assert.equal(redoRefinementSession(session)?.id, thirdCommand.id);
  assert.deepEqual(buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  }), thirdRefined);
});

test("Hex 2:1 local refinement can reject rebuilding an existing transition shell", () => {
  const mesh = createHexUnitCubeMesh(7, 7, 7);
  const session = createRefinementSession(mesh);
  const initial = buildActiveMeshWithMap(session);
  const firstCoreCellIds = idsInIndexBlock(7, 7, 7, [2, 2, 2], [4, 4, 4])
    .map((elementId) => activeBuildCellIdByElementId(initial, elementId))
    .filter(Boolean);
  refineSessionPatch(session, firstCoreCellIds, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: initial
  });

  const firstRefined = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const boundaryCandidate = firstRefined.mesh.elements
    .map((element, index) => {
      const elementId = index + 1;
      const cellId = activeBuildCellIdByElementId(firstRefined, elementId);
      const cell = cellId ? session.cells.get(cellId) : undefined;
      const centerTotal = element.reduce(
        (total, nodeId) => total + firstRefined.mesh.nodes[nodeId - 1].reduce(
          (sum, coordinate) => sum + coordinate,
          0
        ),
        0
      ) / element.length;
      return cell?.level === 1 && cell.role === "selected"
        ? { cellId, centerTotal }
        : undefined;
    })
    .filter(Boolean)
    .sort((left, right) => left.centerTotal - right.centerTotal)[0];
  assert.ok(boundaryCandidate);
  const before = {
    activeLeafCount: session.activeLeafIds.size,
    nodeCount: session.nodes.length,
    undoCount: session.undoStack.length
  };

  assert.throws(
    () => refineSessionPatch(session, [boundaryCandidate.cellId], {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      rebuildExistingTransitions: false,
      activeBuild: firstRefined
    }),
    (error) => !(error instanceof DirectTwoToOnePlanningError)
      && error?.code === "EXISTING_TRANSITION_COLLISION"
      && /would create a nonconforming interface with an existing transition layer/.test(error.message)
  );
  assert.deepEqual({
    activeLeafCount: session.activeLeafIds.size,
    nodeCount: session.nodes.length,
    undoCount: session.undoStack.length
  }, before);
  assert.equal(checkNoHangingNodes(firstRefined.mesh, 1e-9).ok, true);

  assert.throws(
    () => replayHexRefineCommandScript({
      format: "hexrefine-command-script",
      version: 1,
      app: "HexRefine",
      commands: [
        {
          kind: "grid.generate",
          payload: {
            kind: "H1",
            nx: 7,
            ny: 7,
            nz: 7,
            bounds: { min: [0, 0, 0], max: [1, 1, 1] },
            mergeTolerance: 1e-9
          }
        },
        {
          kind: "refine.patch",
          payload: {
            cellIds: firstCoreCellIds,
            options: {
              hexRefinementRatio: 2,
              hexTwoToOneSelectionMode: "local",
              includeTransitions: true,
              mergeTolerance: 1e-9
            }
          }
        },
        {
          kind: "refine.patch",
          payload: {
            cellIds: [boundaryCandidate.cellId],
            options: {
              hexRefinementRatio: 2,
              hexTwoToOneSelectionMode: "local",
              includeTransitions: true,
              rebuildExistingTransitions: false,
              mergeTolerance: 1e-9
            }
          }
        }
      ]
    }),
    /would create a nonconforming interface with an existing transition layer/
  );
});

test("Hex 2:1 transition-shell rebuilding preserves a warped mapped block", () => {
  const base = createHexUnitCubeMesh(7, 7, 7);
  const mesh = {
    ...base,
    nodes: base.nodes.map(([x, y, z]) => [
      x + 0.015 * y * z,
      y + 0.010 * x * z,
      z + 0.012 * x * y
    ])
  };
  const session = createRefinementSession(mesh);
  const initial = buildActiveMeshWithMap(session);
  const firstCoreCellIds = idsInIndexBlock(7, 7, 7, [2, 2, 2], [4, 4, 4])
    .map((elementId) => activeBuildCellIdByElementId(initial, elementId))
    .filter(Boolean);
  refineSessionPatch(session, firstCoreCellIds, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: initial
  });
  const firstRefined = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const boundaryCellId = firstRefined.mesh.elements
    .map((element, index) => {
      const cellId = activeBuildCellIdByElementId(firstRefined, index + 1);
      const cell = cellId ? session.cells.get(cellId) : undefined;
      const centerTotal = element.reduce(
        (total, nodeId) => total + firstRefined.mesh.nodes[nodeId - 1].reduce(
          (sum, coordinate) => sum + coordinate,
          0
        ),
        0
      ) / element.length;
      return cell?.level === 1 && cell.role === "selected"
        ? { cellId, centerTotal }
        : undefined;
    })
    .filter(Boolean)
    .sort((left, right) => left.centerTotal - right.centerTotal)[0]?.cellId;
  assert.ok(boundaryCellId);

  assert.throws(
    () => refineSessionPatch(session, [boundaryCellId], {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      rebuildExistingTransitions: false,
      activeBuild: firstRefined
    }),
    (error) => error?.code === "HEX_PATCH_VOLUME"
      && /does not conserve parent volume/.test(error.message)
  );
  const boundaryCell = session.cells.get(boundaryCellId);
  const perturbedPoint = [...session.nodes[boundaryCell.element[0] - 1]];
  const coincidentSessionNodeIds = session.nodes
    .map((point, index) => point.every(
      (coordinate, axis) => Math.abs(coordinate - perturbedPoint[axis]) < 1e-14
    ) ? index + 1 : undefined)
    .filter(Boolean);
  const originalCoincidentPoints = coincidentSessionNodeIds.map((nodeId) => [
    nodeId,
    [...session.nodes[nodeId - 1]]
  ]);
  for (const nodeId of coincidentSessionNodeIds) {
    const point = session.nodes[nodeId - 1];
    session.nodes[nodeId - 1] = [
      point[0] + 0.03,
      point[1] - 0.012,
      point[2] + 0.0075
    ];
  }
  const distortedActive = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const beforeRejectedDistortion = {
    activeLeafCount: session.activeLeafIds.size,
    nodeCount: session.nodes.length,
    undoCount: session.undoStack.length
  };
  assert.throws(
    () => refineSessionPatch(session, [boundaryCellId], {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      activeBuild: distortedActive
    }),
    /could not preserve the selected fine-cell geometry|failed its net quality gate/
  );
  assert.deepEqual({
    activeLeafCount: session.activeLeafIds.size,
    nodeCount: session.nodes.length,
    undoCount: session.undoStack.length
  }, beforeRejectedDistortion);
  for (const [nodeId, point] of originalCoincidentPoints) {
    session.nodes[nodeId - 1] = point;
  }
  const command = refineSessionPatch(session, [boundaryCellId], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: firstRefined
  });
  const twiceRefined = buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });

  assert.equal(command.quality?.ok, true);
  assert.equal(checkNoHangingNodes(twiceRefined, 1e-9).ok, true);
  assert.ok(Math.abs(hexMeshVolume(twiceRefined) - hexMeshVolume(mesh)) < 1e-10);
  assert.ok(minimumCornerScaledJacobian(twiceRefined) > 0);
});

test("Hex 2:1 transition-shell rebuilding leaves a disjoint support component untouched", () => {
  const mesh = createHexUnitCubeMesh(9, 9, 9);
  const session = createRefinementSession(mesh);
  const initial = buildActiveMeshWithMap(session);
  const firstCoreCellIds = [
    ...idsInIndexBlock(9, 9, 9, [1, 1, 2], [2, 2, 3]),
    ...idsInIndexBlock(9, 9, 9, [6, 6, 2], [7, 7, 3])
  ].map((elementId) => activeBuildCellIdByElementId(initial, elementId)).filter(Boolean);
  const firstCommand = refineSessionPatch(session, firstCoreCellIds, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: initial
  });
  const firstRefined = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const classified = firstCommand.createdCellIds
    .map((cellId) => {
      const cell = session.cells.get(cellId);
      if (!cell?.active || cell.level !== 1) {
        return undefined;
      }
      const center = cell.element.reduce((total, nodeId) => {
        const point = session.nodes[nodeId - 1];
        return [
          total[0] + point[0] / cell.element.length,
          total[1] + point[1] / cell.element.length,
          total[2] + point[2] / cell.element.length
        ];
      }, [0, 0, 0]);
      return { cellId, cell, center };
    })
    .filter(Boolean);
  const leftCandidate = classified
    .filter(({ cell, center }) => cell.role === "selected" && center[0] < 0.5)
    .sort((left, right) =>
      left.center.reduce((sum, value) => sum + value, 0)
      - right.center.reduce((sum, value) => sum + value, 0)
    )[0];
  assert.ok(leftCandidate);
  const untouchedRightCellIds = classified
    .filter(({ center }) => center[0] > 0.5 && center[1] > 0.5)
    .map(({ cellId }) => cellId);
  assert.ok(untouchedRightCellIds.length > 0);

  const command = refineSessionPatch(session, [leftCandidate.cellId], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: firstRefined
  });
  const refined = buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });

  assert.equal(untouchedRightCellIds.every((cellId) => session.activeLeafIds.has(cellId)), true);
  assert.equal(untouchedRightCellIds.every((cellId) => !command.hiddenCellIds.includes(cellId)), true);
  assert.equal(checkNoHangingNodes(refined, 1e-9).ok, true);
  assert.ok(Math.abs(hexMeshVolume(refined) - 1) < 1e-10);
  assert.ok(minimumCornerScaledJacobian(refined) > 0);
});

test("HexRefine command script replays a second-level local 2:1 patch exactly", () => {
  const mesh = createHexUnitCubeMesh(7, 7, 7);
  const session = createRefinementSession(mesh);
  const initial = buildActiveMeshWithMap(session);
  const firstCoreCellIds = idsInIndexBlock(7, 7, 7, [2, 2, 2], [4, 4, 4])
    .map((elementId) => activeBuildCellIdByElementId(initial, elementId))
    .filter(Boolean);
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-9
  };
  refineSessionPatch(session, firstCoreCellIds, {
    ...options,
    activeBuild: initial
  });
  const firstRefined = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const centerCellId = firstRefined.mesh.elements
    .map((element, index) => {
      const elementId = index + 1;
      const cellId = activeBuildCellIdByElementId(firstRefined, elementId);
      const cell = cellId ? session.cells.get(cellId) : undefined;
      const distanceSquared = [0, 1, 2].reduce((total, axis) => {
        const coordinate = element.reduce(
          (sum, nodeId) => sum + firstRefined.mesh.nodes[nodeId - 1][axis],
          0
        ) / element.length;
        return total + ((coordinate - 0.5) ** 2);
      }, 0);
      return cell?.level === 1 && cell.role === "selected"
        ? { cellId, distanceSquared }
        : undefined;
    })
    .filter(Boolean)
    .sort((left, right) => left.distanceSquared - right.distanceSquared)[0]?.cellId;
  assert.ok(centerCellId);
  refineSessionPatch(session, [centerCellId], {
    ...options,
    activeBuild: firstRefined
  });
  const directTwoToOne = structuredClone(session.undoStack.at(-1)?.twoToOne);
  const directAffectedCount = new Set(
    directTwoToOne.affectedComponentCellIds
  ).size;
  assert.equal(
    directTwoToOne.preservedFarFieldCellCount,
    firstRefined.mesh.elements.length - directAffectedCount
  );
  const directMesh = buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });

  const replay = replayHexRefineCommandScript({
    format: "hexrefine-command-script",
    version: 1,
    app: "HexRefine",
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 7,
          ny: 7,
          nz: 7,
          bounds: { min: [0, 0, 0], max: [1, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "refine.patch",
        payload: {
          cellIds: firstCoreCellIds,
          options
        }
      },
      {
        kind: "refine.patch",
        payload: {
          cellIds: [centerCellId],
          options
        }
      }
    ]
  });

  assert.deepEqual(replay.warnings, []);
  assert.deepEqual(replay.mesh, directMesh);
  assert.deepEqual(replay.session.undoStack.at(-1)?.twoToOne, directTwoToOne);
  assert.equal(checkNoHangingNodes(replay.mesh, 1e-9).ok, true);
});

test("Hex refinement report identifies automatic transition templates", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 2);
  const result = refineByElementIdsWithReport(mesh, [1]);
  const templateCounts = countBy(result.cellData.map((cell) => cell.templateCode));

  assert.equal(result.cellData.length, result.mesh.elements.length);
  assert.equal(result.summary.selectedElementCount, 1);
  assert.equal(result.summary.faceTransitionElementCount, 3);
  assert.equal(result.summary.edgeTransitionElementCount, 3);
  assert.equal(result.summary.unchangedElementCount, 1);
  assert.equal(result.quality?.ok, true);
  assert.equal(result.quality?.parentElementCount, 7);
  assert.equal(result.quality?.childElementCount, 81);
  assert.ok((result.quality?.childMinimumOrientedScaledJacobian ?? 0) > 0);
  assert.ok((result.quality?.relativeVolumeError ?? 1) < 1e-10);
  assert.equal(templateCounts.get(27), 27);
  assert.equal(templateCounts.get(13), 39);
  assert.equal(templateCounts.get(5), 15);
  assert.equal(templateCounts.get(0), 1);
});

test("Hex refinement preview reports transition templates without replacing mesh", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 2);
  const result = refineByElementIdsWithReport(mesh, [1]);
  const preview = previewRefinementByElementIds(mesh, [1]);
  const templateCounts = countBy(preview.plan.map((item) => item.templateCode));

  assert.equal(preview.kind, "H1");
  assert.equal(preview.planMode, "per-parent");
  assert.ok(preview.plan.length > 0);
  assert.equal(preview.plan.length, 7);
  assert.equal(preview.summary.selectedElementCount, 1);
  assert.equal(preview.summary.faceTransitionElementCount, 3);
  assert.equal(preview.summary.edgeTransitionElementCount, 3);
  assert.equal(preview.summary.unchangedElementCount, 1);
  assert.equal(preview.summary.estimatedOutputElementCount, result.mesh.elements.length);
  assert.equal(preview.quality?.ok, true);
  assert.equal(preview.quality?.parentElementCount, 7);
  assert.equal(preview.quality?.childElementCount, 81);
  assert.ok((preview.quality?.childMinimumOrientedScaledJacobian ?? 0) > 0);
  assert.ok((preview.quality?.relativeVolumeError ?? 1) < 1e-10);
  assert.equal(templateCounts.get(27), 1);
  assert.equal(templateCounts.get(13), 3);
  assert.equal(templateCounts.get(5), 3);
});

test("Hex selection regularization crops to a complete uvw block", () => {
  const mesh = createHexUnitCubeMesh(4, 4, 4);
  const ids = idsInIndexBlock(4, 4, 4, [1, 1, 1], [3, 3, 3]);
  const missingCenter = ids.filter((elementId) => elementId !== elementIdAt(4, 4, 4, 2, 2, 2));
  const regularized = regularizeHexSelection(mesh, missingCenter);

  assert.equal(regularized.addedElementIds.length, 0);
  assert.ok(regularized.removedElementIds.length > 0);
  assert.ok(regularized.selectedElementIds.length > 0);
  assert.ok(regularized.selectedElementIds.length < missingCenter.length);
  assert.equal(regularized.selectedElementIds.length, regularized.indexRange.dimensions.reduce((total, value) => total * value, 1));
  assert.equal(regularized.selectedElementIds.every((elementId) => missingCenter.includes(elementId)), true);
});

test("Hex selection regularization can fill a block interior from a complete uvw boundary shell", () => {
  const mesh = createHexUnitCubeMesh(5, 5, 5);
  const ids = idsInIndexBlock(5, 5, 5, [1, 1, 1], [3, 3, 3]);
  const centerId = elementIdAt(5, 5, 5, 2, 2, 2);
  const shellIds = ids.filter((elementId) => elementId !== centerId);
  const regularized = regularizeHexSelection(mesh, shellIds, {
    boundaryShellOnly: true
  });

  assert.deepEqual(regularized.indexRange.dimensions, [3, 3, 3]);
  assert.equal(regularized.selectedElementIds.length, 27);
  assert.deepEqual(regularized.addedElementIds, [centerId]);
  assert.equal(regularized.removedElementIds.length, 0);
});

test("Hex selection regularization does not require shell cells on model-boundary sides", () => {
  const mesh = createHexUnitCubeMesh(5, 5, 5);
  const ids = idsInIndexBlock(5, 5, 5, [0, 1, 1], [3, 3, 3]);
  const boundaryFaceInteriorIds = ids.filter((elementId) => {
    const zeroBased = elementId - 1;
    const i = zeroBased % 5;
    const j = Math.floor(zeroBased / 5) % 5;
    const k = Math.floor(zeroBased / 25);
    return i === 0 && j > 1 && j < 3 && k > 1 && k < 3;
  });
  const candidateIds = ids.filter((elementId) => !boundaryFaceInteriorIds.includes(elementId));
  const regularized = regularizeHexSelection(mesh, candidateIds, {
    boundaryShellOnly: true
  });

  assert.deepEqual(regularized.indexRange.dimensions, [4, 3, 3]);
  assert.equal(regularized.selectedElementIds.length, 36);
  assert.deepEqual(regularized.addedElementIds, boundaryFaceInteriorIds);
  assert.equal(regularized.removedElementIds.length, 0);
});

test("Hex selection regularization infers uvw from topology on a deformed structured block", () => {
  const mesh = createDeformedHexBlock(4, 4, 4);
  const ids = idsInIndexBlock(4, 4, 4, [1, 1, 1], [2, 3, 2]);
  const regularized = regularizeHexSelection(mesh, ids);

  assert.deepEqual(regularized.gridDimensions, [4, 4, 4]);
  assert.deepEqual(regularized.indexRange.dimensions, [2, 3, 2]);
  assert.deepEqual(regularized.selectedElementIds, ids);
  assert.equal(regularized.removedElementIds.length, 0);
  assert.equal(regularized.warnings.some((warning) => warning.includes("falling back")), false);
});

test("Hex box refinement uses regularized selection metadata", () => {
  const mesh = createHexUnitCubeMesh(10, 10, 10);
  const result = refineByBoxWithReport(mesh, {
    min: [0.18, 0.18, 0.18],
    max: [0.72, 0.62, 0.52]
  });

  assert.ok(result.regularization);
  assert.deepEqual(result.regularization.indexRange.dimensions, [5, 4, 3]);
  assert.equal(result.summary.selectedElementCount, 60);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-8).ok, true);
});

test("Hex box preview includes regularized selection metadata", () => {
  const mesh = createHexUnitCubeMesh(10, 10, 10);
  const preview = previewRefinementByBox(mesh, {
    min: [0.18, 0.18, 0.18],
    max: [0.72, 0.62, 0.52]
  });

  assert.ok(preview.regularization);
  assert.deepEqual(preview.regularization.indexRange.dimensions, [5, 4, 3]);
  assert.equal(preview.summary.selectedElementCount, 60);
  assert.equal(preview.summary.estimatedOutputElementCount, 3880);
});

test("Distance-function refinement uses inside set and automatic transitions", () => {
  const mesh = createHexUnitCubeMesh(10, 10, 10);
  const result = refineByDistanceFunctionWithReport(mesh, boxDistance([0, 0, 0], [0.5, 0.5, 0.5]), -0.1);
  const preview = previewRefinementByDistanceFunction(mesh, boxDistance([0, 0, 0], [0.5, 0.5, 0.5]), -0.1);

  assert.equal(result.summary.selectedElementCount, 125);
  assert.equal(result.summary.faceTransitionElementCount, 75);
  assert.equal(result.summary.edgeTransitionElementCount, 15);
  assert.equal(preview.summary.estimatedOutputElementCount, result.mesh.elements.length);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-8).ok, true);
});


test("Q1 distance-function refinement supports circular regions", () => {
  const mesh = {
    kind: "Q1",
    nodes: [
      [0, 0],
      [0.5, 0],
      [1, 0],
      [0, 0.5],
      [0.5, 0.5],
      [1, 0.5],
      [0, 1],
      [0.5, 1],
      [1, 1]
    ],
    elements: [
      [1, 2, 5, 4],
      [2, 3, 6, 5],
      [4, 5, 8, 7],
      [5, 6, 9, 8]
    ]
  };
  const result = refineByDistanceFunctionWithReport(mesh, circleDistance([0.25, 0.25], 0.2));

  assert.equal(result.summary.selectedElementCount, 1);
  assert.equal(result.summary.edgeTransitionElementCount, 2);
  assert.equal(result.summary.cornerTransitionElementCount, 0);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
});

test("Hex block refinement examples have no hanging nodes", () => {
  const oneEighth = refineByBox(createHexUnitCubeMesh(10, 10, 10), {
    min: [0, 0, 0],
    max: [0.5, 0.5, 0.5]
  });
  const middleCube = refineByBox(createHexUnitCubeMesh(10, 10, 10), {
    min: [0.3, 0.3, 0.3],
    max: [0.7, 0.7, 0.7]
  });

  assert.equal(checkNoHangingNodes(oneEighth, 1e-8).ok, true);
  assert.equal(checkNoHangingNodes(middleCube, 1e-8).ok, true);
});


function assertPoint(actual, expected, tolerance = 1e-12) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    assert.ok(Math.abs(actual[i] - expected[i]) <= tolerance, `coordinate ${i}: ${actual[i]} != ${expected[i]}`);
  }
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function q1Area(mesh) {
  return mesh.elements.reduce((total, element) => {
    const points = element.map((nodeId) => mesh.nodes[nodeId - 1]);
    let twiceArea = 0;
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      twiceArea += a[0] * b[1] - b[0] * a[1];
    }
    return total + Math.abs(twiceArea * 0.5);
  }, 0);
}

function topBoundaryXs(mesh) {
  const maxY = Math.max(...mesh.nodes.map((point) => point[1]));
  return mesh.nodes
    .filter((point) => Math.abs(point[1] - maxY) < 1e-9)
    .map((point) => point[0])
    .sort((a, b) => a - b);
}

function q1Bounds(mesh) {
  const xs = mesh.nodes.map((point) => point[0]);
  const ys = mesh.nodes.map((point) => point[1]);
  return {
    min: [Math.min(...xs), Math.min(...ys)],
    max: [Math.max(...xs), Math.max(...ys)]
  };
}

function elementIdAt(nx, ny, _nz, i, j, k) {
  return k * nx * ny + j * nx + i + 1;
}

function idsInIndexBlock(nx, ny, nz, min, max) {
  const ids = [];
  for (let k = min[2]; k <= max[2]; k += 1) {
    for (let j = min[1]; j <= max[1]; j += 1) {
      for (let i = min[0]; i <= max[0]; i += 1) {
        ids.push(elementIdAt(nx, ny, nz, i, j, k));
      }
    }
  }
  return ids;
}

function createDeformedHexBlock(nx, ny, nz) {
  const mesh = createHexUnitCubeMesh(nx, ny, nz);
  return {
    ...mesh,
    nodes: mesh.nodes.map(([x, y, z]) => [
      x + 0.15 * y + 0.07 * z * z,
      y + 0.11 * x * z,
      z + 0.09 * x * y
    ])
  };
}

function hexMeshVolume(mesh) {
  const gauss = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  return mesh.elements.reduce((total, element) => {
    const vertices = element.map((nodeId) => mesh.nodes[nodeId - 1]);
    let volume = 0;
    for (const xi of gauss) {
      for (const eta of gauss) {
        for (const zeta of gauss) {
          volume += determinant3(hexJacobian(vertices, xi, eta, zeta));
        }
      }
    }
    return total + volume;
  }, 0);
}

function minimumCornerScaledJacobian(mesh) {
  const signs = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1]
  ];
  let minimum = Infinity;
  for (const element of mesh.elements) {
    const vertices = element.map((nodeId) => mesh.nodes[nodeId - 1]);
    for (const [xi, eta, zeta] of signs) {
      const jacobian = hexJacobian(vertices, xi, eta, zeta);
      const denominator = vectorLength(jacobian[0])
        * vectorLength(jacobian[1])
        * vectorLength(jacobian[2]);
      minimum = Math.min(minimum, determinant3(jacobian) / denominator);
    }
  }
  return minimum;
}

function hexJacobian(vertices, xi, eta, zeta) {
  const signs = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1]
  ];
  const columns = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  signs.forEach(([sx, sy, sz], corner) => {
    const derivatives = [
      sx * (1 + sy * eta) * (1 + sz * zeta) / 8,
      sy * (1 + sx * xi) * (1 + sz * zeta) / 8,
      sz * (1 + sx * xi) * (1 + sy * eta) / 8
    ];
    for (let axis = 0; axis < 3; axis += 1) {
      for (let component = 0; component < 3; component += 1) {
        columns[axis][component] += derivatives[axis] * vertices[corner][component];
      }
    }
  });
  return columns;
}

function determinant3(matrix) {
  const [a, b, c] = matrix;
  return a[0] * (b[1] * c[2] - b[2] * c[1])
    - b[0] * (a[1] * c[2] - a[2] * c[1])
    + c[0] * (a[1] * b[2] - a[2] * b[1]);
}

function vectorLength(vector) {
  return Math.hypot(...vector);
}

function createButterflyOgridBar(layers) {
  const ringTheta = Array.from(
    { length: 8 },
    (_, step) => Math.PI * (0.25 + 0.25 * step)
  );
  const centerRing = [
    [0.5, 0.5],
    [0, 0.5],
    [-0.5, 0.5],
    [-0.5, 0],
    [-0.5, -0.5],
    [0, -0.5],
    [0.5, -0.5],
    [0.5, 0]
  ];
  const sectionPoints = [
    [0, 0],
    ...centerRing,
    ...ringTheta.map((theta) => [Math.cos(theta), Math.sin(theta)])
  ];
  const quads = [
    [0, 8, 1, 2],
    [0, 2, 3, 4],
    [0, 4, 5, 6],
    [0, 6, 7, 8],
    ...Array.from({ length: 8 }, (_, side) => [
      1 + ((side + 1) % 8),
      1 + side,
      9 + side,
      9 + ((side + 1) % 8)
    ])
  ];
  const nodes = [];
  for (let layer = 0; layer <= layers; layer += 1) {
    for (const [x, y] of sectionPoints) {
      nodes.push([x, y, layer]);
    }
  }
  const stride = sectionPoints.length;
  const elements = [];
  for (let layer = 0; layer < layers; layer += 1) {
    for (const quad of quads) {
      elements.push([
        ...quad.map((node) => layer * stride + node + 1),
        ...quad.map((node) => (layer + 1) * stride + node + 1)
      ]);
    }
  }
  return { kind: "H1", nodes, elements };
}
