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
  planRefinementSessionHistoryTransaction
} from "../dist/refinement-session.js";
import {
  RefinementCellGeometryIndex
} from "../dist/refinement-cell-geometry.js";
import {
  pattern3PairTemplateLibrary,
  regularSweepTemplateLibrary
} from "../dist/two-to-one-sweep-templates.js";
import {
  buildDirectTwoToOneHexPlan,
  buildTwoToOneHexReplacements
} from "../dist/two-to-one.js";
import { GeometricFaceIndex } from "../dist/geometric-face-index.js";
import {
  asTwoToOneFlatPlanningError,
  assertHexPatchQualitySummary,
  freezeTwoToOnePlanningErrorDiagnostic,
  HexPatchQualityError
} from "../dist/refinement-errors.js";
import {
  determinant3 as robustDeterminant3
} from "../dist/hex-numeric-internal.js";
import {
  createMergeBucketLayout,
  forEachCandidateMergeBucketKey,
  mergeBucketKey
} from "../dist/merge-buckets-internal.js";
import * as twoToOneModule from "../dist/two-to-one.js";
import * as twoToOnePlannerModule from "../dist/two-to-one-planner.js";
import * as twoToOneSweepModule from "../dist/two-to-one-sweep.js";

test("history reversal mutates through explicit session state", () => {
  const source = readFileSync(
    new URL("../src/refinement-session.ts", import.meta.url),
    "utf8"
  );
  const declaration = "function reverseRefinementHistoryCommands(";
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1);
  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1);
  let depth = 1;
  let bodyEnd = bodyStart + 1;
  while (depth > 0 && bodyEnd < source.length) {
    const character = source[bodyEnd];
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    bodyEnd += 1;
  }
  assert.equal(depth, 0);

  const body = source.slice(bodyStart + 1, bodyEnd - 1);
  assert.match(body, /state\.addActiveLeaf\(/);
  assert.match(body, /state\.removeActiveLeaf\(/);
  assert.match(body, /requiredStateMutableCell\(state, cellId\)/);
  assert.doesNotMatch(body, /requiredCell\(session,/);
  assert.match(
    source,
    /function requiredStateMutableCell\([\s\S]*?state\.cell\(cellId\)[\s\S]*?state\.mutableCell\(cellId\)/
  );
});

test("malformed history undo and redo preserve missing-cell errors atomically", () => {
  for (const operation of ["undo", "redo"]) {
    const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
    const command = refineSessionCell(session, "e1", refineHexTo27Hex);
    if (operation === "redo") {
      assert.equal(undoRefinementSession(session)?.id, command.id);
      session.redoStack[0] = Object.freeze({
        ...command,
        createdCellIds: Object.freeze(["missing"])
      });
    } else {
      session.undoStack[0] = Object.freeze({
        ...command,
        createdCellIds: Object.freeze(["missing"])
      });
    }
    const before = structuredClone(session);

    const error = captureError(() => operation === "undo"
      ? undoRefinementSession(session)
      : redoRefinementSession(session));

    assert.equal(error.message, "cell missing does not exist", operation);
    assert.deepEqual(session, before, operation);
  }
});

const {
  auditHexRefinementPatchQuality,
  auditHexRefinementQuality,
  findBoundaryPairs,
  checkNoHangingNodes,
  minElementEdgeLength,
  minNonzeroElementEdgeLength,
  mergeCoincidentNodes,
  mergeCoincidentNodesWithMap,
  boxDistance,
  circleDistance,
  createHexUnitCubeMesh,
  createQ1UnitSquareMesh,
  createRefinementSession,
  previewSessionPatch,
  previewHexRefinementByElementIds,
  previewRefinementByDistanceFunction,
  previewRefinementByBox,
  previewRefinementByElementIds,
  prepareSessionRefineSelection,
  refineByElementIds,
  refineByElementIdsWithReport,
  activeBuildCellIdByElementId,
  activeBuildElementIdByCellId,
  activeBuildHasSessionNodeIds,
  activeBuildSessionNodeIdsByNodeId,
  buildActiveMesh,
  buildActiveMeshWithMap,
  buildRefinementSessionExport,
  buildDefaultRefinementPlan,
  buildDefaultRefinementReplacements,
  buildHexClassifiedPlan,
  buildHexClassifiedReplacements,
  buildRefinementReplacements,
  checkRefinementSessionCommandConformance,
  validateRefinementSessionSelection,
  refineByBox,
  refineByDistanceFunctionWithReport,
  refineByBoxWithReport,
  defaultRefinementPlanner,
  meshToLsdynaKeyword,
  minimumOrientedHexCornerScaledJacobian,
  hexElementSignedVolume,
  cloneRefinementSessionCommand,
  cloneTwoToOneCapabilityReport,
  normalizeTwoToOneCompensation,
  planTwoToOneHexRefinement,
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
  refineHexByElementIdsWithReport,
  growQ1BoundaryLayer,
  replaceQ1BlockWithRectangleCircleTemplate,
  DirectTwoToOnePlanningError,
  TwoToOnePlanningError,
  undoRefinementSession
} = api;

function mutatePlanningDiagnostic(diagnostic) {
  diagnostic.conflictingCellIds.push(99);
  diagnostic.historyCommandIds?.push("cmd-mutated");
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

function assertFrozenPlanningDiagnostic(error) {
  const serialized = serializeTwoToOnePlanningError(error);
  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(Object.isFrozen(error.diagnostic), true);
  assert.equal(Object.isFrozen(error.diagnostic.conflictingCellIds), true);
  assert.equal(Object.isFrozen(error.diagnostic.conflictingInterfaces), true);
  assert.equal(Object.isFrozen(error.diagnostic.attemptedActions), true);
  if (error.diagnostic.historyCommandIds !== undefined) {
    assert.equal(Object.isFrozen(error.diagnostic.historyCommandIds), true);
    assert.throws(
      () => error.diagnostic.historyCommandIds.push("cmd-mutated"),
      TypeError
    );
  }
  assert.equal(Object.isFrozen(error.diagnostic.suggestion), true);
  assert.throws(
    () => error.diagnostic.conflictingCellIds.push("mutated"),
    TypeError
  );
  assert.throws(
    () => error.diagnostic.conflictingInterfaces.push({
      firstCellId: "mutated",
      faceNodeIds: []
    }),
    TypeError
  );
  assert.throws(
    () => error.diagnostic.attemptedActions.push({
      kind: "selection-expand",
      reason: "mutated",
      addedParentCellIds: [],
      replacedTransitionCellIds: []
    }),
    TypeError
  );
  assert.throws(() => {
    error.diagnostic.suggestion.kind = "reduce-level";
  }, TypeError);
  assert.deepEqual(serializeTwoToOnePlanningError(error), serialized);
}

function assertFrozenRecipe(recipe) {
  assert.equal(Object.isFrozen(recipe), true);
  assert.equal(Object.isFrozen(recipe.selectedCellIds), true);
  assert.equal(Object.isFrozen(recipe.selectedCellGeometry), true);
  assert.equal(Object.isFrozen(recipe.transitionSupportCellIds), true);
  assert.equal(Object.isFrozen(recipe.transitionSupportCellGeometry), true);
  assert.equal(Object.isFrozen(recipe.options), true);
  assert.equal(
    Object.isFrozen(recipe.options.hexTwoToOneCompensation),
    true
  );
  for (const geometry of [
    ...recipe.selectedCellGeometry,
    ...recipe.transitionSupportCellGeometry
  ]) {
    assert.equal(Object.isFrozen(geometry), true);
    assert.equal(Object.isFrozen(geometry.points), true);
    for (const point of geometry.points) {
      assert.equal(Object.isFrozen(point), true);
    }
  }
}

function createMergeCollapsedHexMesh() {
  return {
    kind: "H1",
    nodes: [
      [-0.19862831979990006, 0.07926663877442479, 0.3851875668391585],
      [0.4179745177738369, 0.31747906319797037, -0.279048830922693],
      [1.5279899718239904, 1.391131894942373, -0.09928947910666465],
      [0.46307154642418025, 0.6490932760760189, 0.06864200262352824],
      [-0.18730150423943995, -0.5530625863932073, 0.7816654140129685],
      [1.5065415038727223, 0.08001531064510345, 0.768233108241111],
      [1.497776602767408, 1.2830029870383441, 0.8302815672010183],
      [0.10892684245482087, 1.135718678124249, 1.2159863329492508]
    ],
    elements: [[1, 2, 3, 4, 5, 6, 7, 8]],
    data: {
      source: "merge-collapse-regression"
    }
  };
}

function createScaledHexMesh(scale) {
  const mesh = createHexUnitCubeMesh(1, 1, 1);
  mesh.nodes = mesh.nodes.map((point) =>
    point.map((coordinate) => coordinate * scale)
  );
  mesh.data = {
    source: "scaled-hex-quality",
    scale
  };
  return mesh;
}

function createNearlyTouchingHexMesh(gap = 4e-9) {
  return {
    kind: "H1",
    nodes: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
      [1 + gap, 0, 0],
      [2 + gap, 0, 0],
      [2 + gap, 1, 0],
      [1 + gap, 1, 0],
      [1 + gap, 0, 1],
      [2 + gap, 0, 1],
      [2 + gap, 1, 1],
      [1 + gap, 1, 1]
    ],
    elements: [
      [1, 2, 3, 4, 5, 6, 7, 8],
      [9, 10, 11, 12, 13, 14, 15, 16]
    ],
    data: {
      source: "near-interface-conformance"
    }
  };
}

function createAnisotropicHexVertices(
  xScale,
  yScale,
  zScale,
  transform = ([x, y, z]) => [x, y, z]
) {
  return [
    [0, 0, 0],
    [xScale, 0, 0],
    [xScale, yScale, 0],
    [0, yScale, 0],
    [0, 0, zScale],
    [xScale, 0, zScale],
    [xScale, yScale, zScale],
    [0, yScale, zScale]
  ].map(transform);
}

function createParallelepipedHexVertices(a, b, c, origin = [0, 0, 0]) {
  const point = (u, v, w) => origin.map((coordinate, index) =>
    coordinate + u * a[index] + v * b[index] + w * c[index]
  );
  return [
    point(0, 0, 0),
    point(1, 0, 0),
    point(1, 1, 0),
    point(0, 1, 0),
    point(0, 0, 1),
    point(1, 0, 1),
    point(1, 1, 1),
    point(0, 1, 1)
  ];
}

function createNearMaxSafeDuplicateQuadMesh(reverse = false) {
  const base = Number.MAX_SAFE_INTEGER - 5;
  const first = [
    [base, 0],
    [base + 4, 0],
    [base + 4, 4],
    [base, 4]
  ];
  const second = first.map(([x, y]) => [x + 1, y]);
  const blocks = reverse ? [second, first] : [first, second];
  return {
    kind: "Q1",
    nodes: blocks.flatMap((block) => block.map((point) => [...point])),
    elements: [
      [1, 2, 3, 4],
      [5, 6, 7, 8]
    ]
  };
}

function createSevenDistinctNodeHexMesh() {
  const mesh = createHexUnitCubeMesh(1, 1, 1);
  mesh.elements[0] = [1, 1, 3, 4, 5, 6, 7, 8];
  mesh.data = {
    source: "partial-zero-edge"
  };
  return mesh;
}

function createFourDimensionalLocalSweepMesh() {
  const mesh = createHexUnitCubeMesh(5, 5, 5);
  mesh.nodes = mesh.nodes.map((point) => [...point, 0]);
  mesh.data = {
    source: "four-dimensional-programming-invariant"
  };
  return mesh;
}

const EXISTING_TRANSITION_COLLISION_TEST_MESSAGE =
  "second-level local 2:1 refinement would create a nonconforming interface with an existing transition layer";

function createTwoToOneQualityFailureCase(kind) {
  const mesh = kind === "volume"
    ? createHexUnitCubeMesh(2, 2, 1)
    : createHexUnitCubeMesh(1, 1, 1);
  if (kind === "parent-jacobian") {
    mesh.nodes[0] = [1.5, 0, 0];
  } else if (kind === "child-jacobian") {
    mesh.nodes = [
      [0, 0, 0],
      [1.2489761001797772, -0.4782398313947985, -0.5198091936877567],
      [-0.23509787147026623, 1.5637821085447112, -0.03615258902851291],
      [1.1284237298803095, 0.4491931317512937, 0.24854395950469946],
      [0.10620194688409575, 0.3528084106180188, 0.9871484617037125],
      [1.4870707704693205, 0.28570873618419274, 0.6458316140019424],
      [-0.4819413859233276, 1.256529064964015, 0.5198665943563208],
      [0.9419042976425527, 0.6705364754575951, 1.2969270202018643]
    ];
  } else {
    mesh.nodes[1] = [0.5, -0.4, 0];
  }
  mesh.data = {
    source: `quality-${kind}`,
    materialIds: Array.from(
      { length: mesh.elements.length },
      (_, index) => index + 1
    )
  };
  return {
    mesh,
    selectedElementIds: [1],
    options: {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: kind === "volume",
      regularizeHexSelection: false,
      hexTwoToOneCompensation: {
        mode: "none"
      }
    }
  };
}

const ALL_QUAD_PERMUTATIONS = [
  [0, 1, 2, 3],
  [0, 1, 3, 2],
  [0, 2, 1, 3],
  [0, 2, 3, 1],
  [0, 3, 1, 2],
  [0, 3, 2, 1],
  [1, 0, 2, 3],
  [1, 0, 3, 2],
  [1, 2, 0, 3],
  [1, 2, 3, 0],
  [1, 3, 0, 2],
  [1, 3, 2, 0],
  [2, 0, 1, 3],
  [2, 0, 3, 1],
  [2, 1, 0, 3],
  [2, 1, 3, 0],
  [2, 3, 0, 1],
  [2, 3, 1, 0],
  [3, 0, 1, 2],
  [3, 0, 2, 1],
  [3, 1, 0, 2],
  [3, 1, 2, 0],
  [3, 2, 0, 1],
  [3, 2, 1, 0]
];

test("geometric face identity prefers exact ids and tolerates duplicate nodes", () => {
  const index = new GeometricFaceIndex(1e-8);
  const square = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0]
  ];
  index.add({
    owner: "a",
    nodeIds: [1, 2, 3, 4],
    points: square
  });

  assert.deepEqual(
    index.matches({
      owner: "b",
      nodeIds: [1, 2, 3, 4],
      points: square
    }).map((face) => face.owner),
    ["a"]
  );
  assert.deepEqual(
    index.matches({
      owner: "c",
      nodeIds: [11, 12, 13, 14],
      points: [
        [0, 0, 3e-9],
        [1, 0, -2e-9],
        [1, 1, 1e-9],
        [0, 1, -1e-9]
      ]
    }).map((face) => face.owner),
    ["a"]
  );
});

test("geometric face identity rejects near and ambiguous faces", () => {
  const index = new GeometricFaceIndex(1e-8);
  const square = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0]
  ];
  index.add({
    owner: "a",
    nodeIds: [1, 2, 3, 4],
    points: square
  });

  assert.deepEqual(index.matches({
    owner: "near",
    nodeIds: [21, 22, 23, 24],
    points: square.map(([x, y]) => [x, y, 2e-8])
  }), []);

  index.add({
    owner: "duplicate",
    nodeIds: [11, 12, 13, 14],
    points: square
  });
  const query = {
    owner: "query",
    nodeIds: [21, 22, 23, 24],
    points: square
  };
  const error = captureError(() => index.uniqueMatch(query));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_AMBIGUOUS_FACE");
  assert.equal(error.message, "face owned by query has 2 matches");
  assert.deepEqual(error.diagnostic, {
    conflictingCellIds: ["a", "duplicate", "query"],
    conflictingInterfaces: [
      {
        firstCellId: "query",
        secondCellId: "a",
        faceNodeIds: [1, 2, 3, 4]
      },
      {
        firstCellId: "query",
        secondCellId: "duplicate",
        faceNodeIds: [11, 12, 13, 14]
      }
    ],
    attemptedActions: []
  });

  error.diagnostic.conflictingCellIds.push("mutated");
  const secondError = captureError(() => index.uniqueMatch(query));
  assert.notEqual(secondError.diagnostic, error.diagnostic);
  assert.deepEqual(secondError.diagnostic.conflictingCellIds, ["a", "duplicate", "query"]);
});

test("geometric face identity rejects warped quads outside the corner-anchored plane", () => {
  const tolerance = 1e-8;
  const index = new GeometricFaceIndex(tolerance);
  const warpedQuad = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 3 * tolerance]
  ];
  index.add({
    owner: "warped",
    nodeIds: [1, 2, 3, 4],
    points: warpedQuad
  });

  assert.deepEqual(index.matches({
    owner: "warped-query",
    nodeIds: [11, 12, 13, 14],
    points: [[1e-9, 0, 0], warpedQuad[1], warpedQuad[2], warpedQuad[3]]
  }), []);
});

test("geometric face identity rejects invalid tolerances and malformed quads", () => {
  for (const tolerance of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => new GeometricFaceIndex(tolerance), RangeError);
  }

  const index = new GeometricFaceIndex(1e-8);
  assert.throws(() => index.add({
    owner: 1,
    nodeIds: [1, 2, 3],
    points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
  }), TypeError);
  assert.throws(() => index.add({
    owner: 1,
    nodeIds: [1, 2, 3, 4],
    points: [[0, 0, 0], [1, 0, 0], [1, 1, 0]]
  }), TypeError);
  assert.throws(() => index.matches({
    owner: 1,
    nodeIds: [1, 2, 3, 4],
    points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1]]
  }), TypeError);

  for (const invalidNodeId of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => index.add({
      owner: 1,
      nodeIds: [1, 2, 3, invalidNodeId],
      points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
    }), TypeError);
  }
  for (const invalidCoordinate of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => index.add({
      owner: 1,
      nodeIds: [1, 2, 3, 4],
      points: [[invalidCoordinate, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
    }), TypeError);
  }
});

test("geometric face identity accepts rotated and flipped point order", () => {
  const index = new GeometricFaceIndex(1e-8);
  const square = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0]
  ];
  index.add({
    owner: "a",
    nodeIds: [1, 2, 3, 4],
    points: square
  });

  assert.equal(index.uniqueMatch({
    owner: "rotated",
    nodeIds: [11, 12, 13, 14],
    points: [square[1], square[2], square[3], square[0]]
  })?.owner, "a");
  assert.equal(index.uniqueMatch({
    owner: "flipped",
    nodeIds: [21, 22, 23, 24],
    points: [square[0], square[3], square[2], square[1]]
  })?.owner, "a");
});

test("geometric face identity matches all 24 orders of a non-cyclic micro trapezoid", () => {
  assert.equal(ALL_QUAD_PERMUTATIONS.length, 24);
  assert.equal(new Set(ALL_QUAD_PERMUTATIONS.map((order) => order.join(":"))).size, 24);

  const index = new GeometricFaceIndex(1e-12);
  const trapezoid = [
    [0, 0, 0],
    [4e-6, 0, 0],
    [3.25e-6, 8e-7, 0],
    [0, 8e-7, 0]
  ];
  index.add({
    owner: "micro-trapezoid",
    nodeIds: [1, 2, 3, 4],
    points: [trapezoid[0], trapezoid[2], trapezoid[1], trapezoid[3]]
  });

  for (const [indexInSet, order] of ALL_QUAD_PERMUTATIONS.entries()) {
    assert.equal(index.uniqueMatch({
      owner: `permutation-${indexInSet}`,
      nodeIds: [11, 12, 13, 14],
      points: order.map((pointIndex) => trapezoid[pointIndex])
    })?.owner, "micro-trapezoid", `permutation ${order.join(":")} must match`);
  }
});

test("geometric face identity exact-matches a unit face with overflow-scale tolerance", () => {
  const points = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0]
  ];
  const index = new GeometricFaceIndex(1e200);
  index.add({
    owner: "unit",
    nodeIds: [1, 2, 3, 4],
    points
  });

  for (const order of ALL_QUAD_PERMUTATIONS) {
    assert.equal(index.uniqueMatch({
      owner: "unit-query",
      nodeIds: [11, 12, 13, 14],
      points: order.map((pointIndex) => points[pointIndex])
    })?.owner, "unit", `permutation ${order.join(":")} must exact-match`);
  }
});

test("geometric face identity exact-matches a 1e-200 face in every order", () => {
  const edge = 1e-200;
  const points = [
    [0, 0, 0],
    [edge, 0, 0],
    [edge, edge, 0],
    [0, edge, 0]
  ];
  const index = new GeometricFaceIndex(1e-14);
  index.add({
    owner: "micro",
    nodeIds: [1, 2, 3, 4],
    points
  });

  for (const order of ALL_QUAD_PERMUTATIONS) {
    assert.equal(index.uniqueMatch({
      owner: "micro-query",
      nodeIds: [11, 12, 13, 14],
      points: order.map((pointIndex) => points[pointIndex])
    })?.owner, "micro", `permutation ${order.join(":")} must exact-match`);
  }
});

test("geometric face identity permits an infinite tolerance ratio for exact valid geometry", () => {
  const edge = 1e-200;
  const points = [
    [0, 0, 0],
    [edge, 0, 0],
    [edge, edge, 0],
    [0, edge, 0]
  ];
  const index = new GeometricFaceIndex(1e200);
  index.add({
    owner: "infinite-ratio",
    nodeIds: [1, 2, 3, 4],
    points
  });

  assert.equal(index.uniqueMatch({
    owner: "infinite-ratio-query",
    nodeIds: [11, 12, 13, 14],
    points: [points[2], points[0], points[3], points[1]]
  })?.owner, "infinite-ratio");
});

test("geometric face identity matches all 24 orders of a warped noisy face", () => {
  const tolerance = 1e-8;
  const storedPoints = [
    [0, 0, 0],
    [2, 0, 2e-9],
    [1.8, 1, -1e-9],
    [0, 1, 1e-9]
  ];
  const noisyPoints = [
    [1e-10, 0, 1e-9],
    [2, 0, 1e-9],
    [1.8, 1, 0],
    [0, 1, 0]
  ];
  const index = new GeometricFaceIndex(tolerance);
  index.add({
    owner: "warped-noisy",
    nodeIds: [1, 2, 3, 4],
    points: [storedPoints[0], storedPoints[2], storedPoints[1], storedPoints[3]]
  });

  for (const order of ALL_QUAD_PERMUTATIONS) {
    assert.equal(index.uniqueMatch({
      owner: "warped-noisy-query",
      nodeIds: [11, 12, 13, 14],
      points: order.map((pointIndex) => noisyPoints[pointIndex])
    })?.owner, "warped-noisy", `permutation ${order.join(":")} must match`);
  }
});

test("geometric face identity limits non-planar exact-coordinate fallback to D4 face order", () => {
  const tolerance = 1e-8;
  const points = [
    [0, 0, 0],
    [2, 0, 0.1],
    [2, 1, -0.08],
    [0, 1, 0.12]
  ];
  const index = new GeometricFaceIndex(tolerance, {
    allowNonPlanarExactCoordinateMatches: true
  });
  index.add({
    owner: "stored",
    nodeIds: [1, 2, 3, 4],
    points
  });
  const dihedralOrders = [
    [0, 1, 2, 3],
    [1, 2, 3, 0],
    [2, 3, 0, 1],
    [3, 0, 1, 2],
    [0, 3, 2, 1],
    [3, 2, 1, 0],
    [2, 1, 0, 3],
    [1, 0, 3, 2]
  ];
  for (const order of dihedralOrders) {
    assert.equal(index.uniqueMatch({
      owner: `dihedral-${order.join("-")}`,
      nodeIds: [11, 12, 13, 14],
      points: order.map((pointIndex) => points[pointIndex])
    })?.owner, "stored");
  }
  assert.deepEqual(index.matches({
    owner: "non-dihedral",
    nodeIds: [21, 22, 23, 24],
    points: [points[0], points[2], points[1], points[3]]
  }), []);

  const invalidFaces = [
    {
      label: "bow-tie",
      points: [[0, 0, 0], [1, 1, 0], [0, 1, 0], [1, 0, 0.3]]
    },
    {
      label: "folded",
      points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 1]]
    },
    {
      label: "repeated-corner",
      points: [[0, 0, 0], [1, 0, 0], [1, 0, 0], [0, 1, 0]]
    },
    {
      label: "degenerate",
      points: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]
    },
    {
      label: "direction-inconsistent",
      points: [[0, 0, 0], [1, 0, 0], [1, 1, 1], [0.8, 0.2, -1]]
    }
  ];
  for (const invalid of invalidFaces) {
    const invalidIndex = new GeometricFaceIndex(tolerance, {
      allowNonPlanarExactCoordinateMatches: true
    });
    invalidIndex.add({
      owner: invalid.label,
      nodeIds: [1, 2, 3, 4],
      points: invalid.points
    });
    assert.deepEqual(invalidIndex.matches({
      owner: `${invalid.label}-query`,
      nodeIds: [11, 12, 13, 14],
      points: invalid.points
    }), [], invalid.label);
  }
});

test("geometric face identity preserves planar permutations when non-planar fallback is enabled", () => {
  const points = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0]
  ];
  const index = new GeometricFaceIndex(1e-8, {
    allowNonPlanarExactCoordinateMatches: true
  });
  index.add({
    owner: "planar",
    nodeIds: [1, 2, 3, 4],
    points
  });

  assert.equal(index.uniqueMatch({
    owner: "non-cyclic-planar-query",
    nodeIds: [11, 12, 13, 14],
    points: [points[0], points[2], points[1], points[3]]
  })?.owner, "planar");
});

test("geometric face identity rejects exact-coordinate collinear geometry fallback", () => {
  const points = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0]
  ];
  const index = new GeometricFaceIndex(1e-8);
  index.add({
    owner: "collinear",
    nodeIds: [1, 2, 3, 4],
    points
  });

  assert.deepEqual(index.matches({
    owner: "collinear-query",
    nodeIds: [11, 12, 13, 14],
    points: [points[2], points[0], points[3], points[1]]
  }), []);
});

test("geometric face identity rejects exact-coordinate coincident geometry fallback", () => {
  const points = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  const index = new GeometricFaceIndex(1e-8);
  index.add({
    owner: "coincident",
    nodeIds: [1, 2, 3, 4],
    points
  });

  assert.deepEqual(index.matches({
    owner: "coincident-query",
    nodeIds: [11, 12, 13, 14],
    points
  }), []);
});

test("geometric face identity rejects exact-coordinate collapsed-corner fallback", () => {
  const points = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 0],
    [0, 1, 0]
  ];
  const index = new GeometricFaceIndex(1e-8);
  index.add({
    owner: "collapsed",
    nodeIds: [1, 2, 3, 4],
    points
  });

  assert.deepEqual(index.matches({
    owner: "collapsed-query",
    nodeIds: [11, 12, 13, 14],
    points: [points[3], points[1], points[0], points[2]]
  }), []);
});

test("geometric face identity rejects approximate collapsed faces in both directions", () => {
  const tolerance = 1e-8;
  const collapsed = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 0],
    [0, 1, 0]
  ];
  const perturbed = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1e-10, 0],
    [0, 1, 0]
  ];
  const directions = [
    {
      label: "stored-collapsed",
      storedPoints: collapsed,
      queryPoints: perturbed
    },
    {
      label: "query-collapsed",
      storedPoints: perturbed,
      queryPoints: collapsed
    }
  ];

  for (const { label, storedPoints, queryPoints } of directions) {
    const index = new GeometricFaceIndex(tolerance);
    index.add({
      owner: label,
      nodeIds: [1, 2, 3, 4],
      points: storedPoints
    });

    assert.deepEqual(index.matches({
      owner: `${label}-query`,
      nodeIds: [11, 12, 13, 14],
      points: queryPoints
    }), [], `${label} must be rejected`);
  }
});

test("geometric face identity rejects all 24 exact orders of an over-warped face", () => {
  const tolerance = 1e-8;
  const points = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 3 * tolerance]
  ];
  const index = new GeometricFaceIndex(tolerance);
  index.add({
    owner: "over-warped",
    nodeIds: [1, 2, 3, 4],
    points
  });

  for (const order of ALL_QUAD_PERMUTATIONS) {
    assert.deepEqual(index.matches({
      owner: "over-warped-query",
      nodeIds: [11, 12, 13, 14],
      points: order.map((pointIndex) => points[pointIndex])
    }), [], `permutation ${order.join(":")} must be rejected`);
  }
});

test("geometric face identity keeps exact node ids authoritative for invalid geometry", () => {
  const points = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  const index = new GeometricFaceIndex(1e-8);
  index.add({
    owner: "exact-invalid",
    nodeIds: [1, 2, 3, 4],
    points
  });

  assert.equal(index.uniqueMatch({
    owner: "exact-invalid-query",
    nodeIds: [4, 3, 2, 1],
    points: [[100, 0, 0], [101, 0, 0], [101, 1, 0], [100, 1, 0]]
  })?.owner, "exact-invalid");
});

test("geometric face identity rejects a distinct tolerance-close set outside the anchor plane", () => {
  const tolerance = 1e-8;
  const index = new GeometricFaceIndex(tolerance);
  const first = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 3 * tolerance]
  ];
  const second = [
    [0, 0, 0.5 * tolerance],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 2.5 * tolerance]
  ];
  index.add({
    owner: "warped",
    nodeIds: [1, 2, 3, 4],
    points: first
  });

  for (let corner = 0; corner < 4; corner += 1) {
    assert.equal(
      Math.hypot(
        first[corner][0] - second[corner][0],
        first[corner][1] - second[corner][1],
        first[corner][2] - second[corner][2]
      ) <= tolerance,
      true
    );
  }
  assert.deepEqual(index.matches({
    owner: "warped-query",
    nodeIds: [11, 12, 13, 14],
    points: second
  }), []);
});

test("geometric face identity distinguishes degenerate and valid micro-scale quads", () => {
  const degenerateIndex = new GeometricFaceIndex(1e-8);
  const line = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0]
  ];
  degenerateIndex.add({
    owner: "line",
    nodeIds: [1, 2, 3, 4],
    points: line
  });
  assert.deepEqual(degenerateIndex.matches({
    owner: "line-copy",
    nodeIds: [11, 12, 13, 14],
    points: [[1e-9, 0, 0], line[1], line[2], line[3]]
  }), []);

  const microIndex = new GeometricFaceIndex(1e-8);
  const side = 1e-4;
  const microSquare = [
    [0, 0, 0],
    [side, 0, 0],
    [side, side, 0],
    [0, side, 0]
  ];
  microIndex.add({
    owner: "micro",
    nodeIds: [1, 2, 3, 4],
    points: microSquare
  });
  assert.equal(microIndex.uniqueMatch({
    owner: "micro-copy",
    nodeIds: [11, 12, 13, 14],
    points: microSquare.map(([x, y]) => [x, y, 1e-9])
  })?.owner, "micro");
});

test("geometric face identity compares tiny corner distances without squaring", () => {
  const tolerance = 1e-200;
  const index = new GeometricFaceIndex(tolerance);
  const square = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0]
  ];
  index.add({
    owner: "tiny-tolerance",
    nodeIds: [1, 2, 3, 4],
    points: square
  });

  assert.deepEqual(index.matches({
    owner: "outside-tolerance",
    nodeIds: [11, 12, 13, 14],
    points: [[2e-200, 0, 0], square[1], square[2], square[3]]
  }), []);
});

test("geometric face identity normalizes representable faces translated near 1e308", () => {
  const origin = 1e308;
  const edge = 8e292;
  const tolerance = 1e292;
  const square = [
    [origin, origin, origin],
    [origin + edge, origin, origin],
    [origin + edge, origin + edge, origin],
    [origin, origin + edge, origin]
  ];
  assert.equal(square[1][0] > origin, true);
  assert.equal(square[2][1] > origin, true);

  const index = new GeometricFaceIndex(tolerance);
  index.add({
    owner: "translated",
    nodeIds: [1, 2, 3, 4],
    points: square
  });

  assert.equal(index.uniqueMatch({
    owner: "translated-query",
    nodeIds: [11, 12, 13, 14],
    points: [square[2], square[0], square[3], square[1]]
  })?.owner, "translated");
});

test("geometric face identity fails closed when normalized deltas are not finite", () => {
  const tolerance = 4e292;
  const shiftedMaximum = 1e308 + 2e292;
  assert.equal(shiftedMaximum > 1e308, true);
  const index = new GeometricFaceIndex(tolerance);
  const unnormalizable = [
    [-1e308, -1e308, 0],
    [1e308, -1e308, 0],
    [1e308, 1e308, 0],
    [-1e308, 1e308, 0]
  ];
  index.add({
    owner: "extreme",
    nodeIds: [1, 2, 3, 4],
    points: unnormalizable
  });

  assert.deepEqual(index.matches({
    owner: "extreme-query",
    nodeIds: [11, 12, 13, 14],
    points: [
      unnormalizable[0],
      [shiftedMaximum, -1e308, 0],
      unnormalizable[2],
      unnormalizable[3]
    ]
  }), []);
});

test("geometric face identity rejects unsafe buckets atomically but preserves exact-first", () => {
  const index = new GeometricFaceIndex(Number.MIN_VALUE);
  const safePoints = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0]
  ];
  index.add({
    owner: "safe",
    nodeIds: [1, 2, 3, 4],
    points: safePoints
  });

  assert.throws(() => index.add({
    owner: "unsafe",
    nodeIds: [11, 12, 13, 14],
    points: safePoints.map(([x, y, z]) => [x + 1, y, z])
  }), RangeError);

  assert.deepEqual(index.matches({
    owner: "safe-query",
    nodeIds: [11, 12, 13, 14],
    points: safePoints
  }).map((face) => face.owner), ["safe"]);
  assert.deepEqual(index.matches({
    owner: "exact-query",
    nodeIds: [4, 3, 2, 1],
    points: safePoints.map(([x, y, z]) => [x + 1, y, z])
  }).map((face) => face.owner), ["safe"]);
});

test("geometric face identity includes a corrected face in ambiguity after bucket rejection", () => {
  const index = new GeometricFaceIndex(Number.MIN_VALUE);
  const safePoints = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0]
  ];
  index.add({
    owner: "origin",
    nodeIds: [1, 2, 3, 4],
    points: safePoints
  });
  const retriedFace = {
    owner: "retried",
    nodeIds: [11, 12, 13, 14],
    points: safePoints.map(([x, y, z]) => [x + 1, y, z])
  };

  assert.throws(() => index.add(retriedFace), RangeError);
  retriedFace.points = safePoints.map((point) => [...point]);
  index.add(retriedFace);

  const error = captureError(() => index.uniqueMatch({
    owner: "retried-query",
    nodeIds: [14, 13, 12, 11],
    points: safePoints
  }));
  assert.equal(error.code, "TWO_TO_ONE_AMBIGUOUS_FACE");
  assert.deepEqual(
    error.diagnostic.conflictingCellIds,
    ["origin", "retried", "retried-query"]
  );
});

test("geometric face identity returns fresh match arrays", () => {
  const index = new GeometricFaceIndex(1e-8);
  index.add({
    owner: "a",
    nodeIds: [1, 2, 3, 4],
    points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
  });
  const query = {
    owner: "query",
    nodeIds: [1, 2, 3, 4],
    points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
  };

  const firstMatches = index.matches(query);
  firstMatches.splice(0, firstMatches.length);
  const secondMatches = index.matches(query);

  assert.notEqual(secondMatches, firstMatches);
  assert.deepEqual(secondMatches.map((face) => face.owner), ["a"]);
});

test("geometric face identity deduplicates repeated exact face registrations by identity", () => {
  const index = new GeometricFaceIndex(1e-8);
  const face = {
    owner: "a",
    nodeIds: [1, 2, 3, 4],
    points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
  };
  index.add(face);
  for (let repeat = 0; repeat < 1000; repeat += 1) {
    index.add(face);
  }
  const query = {
    owner: "query",
    nodeIds: [1, 2, 3, 4],
    points: face.points
  };

  const matches = index.matches(query);

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.owner, "a");
  assert.equal(index.uniqueMatch(query), matches[0]);
});

test("geometric face identity treats returned stored snapshots as registered identities", () => {
  const index = new GeometricFaceIndex(1e-8);
  const points = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
  index.add({
    owner: "stored",
    nodeIds: [1, 2, 3, 4],
    points
  });
  const stored = index.uniqueMatch({
    owner: "geometry-query",
    nodeIds: [11, 12, 13, 14],
    points
  });
  assert.notEqual(stored, undefined);

  for (let repeat = 0; repeat < 1000; repeat += 1) {
    index.add(stored);
  }

  const exactMatches = index.matches({
    owner: "exact-query",
    nodeIds: [4, 3, 2, 1],
    points
  });
  assert.equal(exactMatches.length, 1);
  assert.equal(exactMatches[0], stored);
});

test("geometric face identity stores immutable snapshots and rejects mutated re-adds", () => {
  const index = new GeometricFaceIndex(1e-8);
  const face = {
    owner: "original",
    nodeIds: [4, 1, 3, 2],
    points: [[0, 0, 0, 99], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
  };
  index.add(face);

  face.owner = "mutated";
  face.nodeIds[0] = 99;
  face.points[0][0] = 99;

  const [stored] = index.matches({
    owner: "query",
    nodeIds: [1, 2, 3, 4],
    points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
  });
  assert.notEqual(stored, face);
  assert.equal(stored.owner, "original");
  assert.deepEqual(stored.nodeIds, [4, 1, 3, 2]);
  assert.deepEqual(stored.points, [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
  assert.equal(Object.isFrozen(stored), true);
  assert.equal(Object.isFrozen(stored.nodeIds), true);
  assert.equal(stored.points.every((point) => Object.isFrozen(point)), true);
  assert.throws(() => index.add(face), {
    name: "TypeError",
    message: /modified after it was added/
  });
});

test("geometric face identity rejects owner, node, and point mutation during queries", () => {
  const mutations = [
    {
      label: "owner",
      mutate: (face) => {
        face.owner = "changed";
      }
    },
    {
      label: "node",
      mutate: (face) => {
        face.nodeIds[0] = 99;
      }
    },
    {
      label: "point",
      mutate: (face) => {
        face.points[0][0] = 0.25;
      }
    }
  ];

  for (const { label, mutate } of mutations) {
    const index = new GeometricFaceIndex(1e-8);
    const face = {
      owner: "original",
      nodeIds: [1, 2, 3, 4],
      points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
    };
    index.add(face);
    mutate(face);

    for (const method of ["matches", "uniqueMatch"]) {
      assert.throws(() => index[method](face), {
        name: "TypeError",
        message: /modified after it was added/
      }, `${method} must reject ${label} mutation`);
    }
  }
});

test("geometric face identity retains distinct exact faces with identical values", () => {
  const index = new GeometricFaceIndex(1e-8);
  const points = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
  const first = {
    owner: "same",
    nodeIds: [1, 2, 3, 4],
    points
  };
  const second = {
    owner: "same",
    nodeIds: [1, 2, 3, 4],
    points
  };
  index.add(first);
  index.add(second);
  const query = {
    owner: "query",
    nodeIds: [1, 2, 3, 4],
    points
  };

  const matches = index.matches(query);

  assert.equal(matches.length, 2);
  assert.notEqual(matches[0], first);
  assert.notEqual(matches[1], second);
  const error = captureError(() => index.uniqueMatch(query));
  assert.equal(error.code, "TWO_TO_ONE_AMBIGUOUS_FACE");
  assert.equal(error.message, "face owned by query has 2 matches");
  assert.deepEqual(error.diagnostic.conflictingCellIds, ["query", "same"]);
});

test("geometric face identity detects ambiguity behind exact hits in either insertion order", () => {
  const square = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0]
  ];
  const faces = {
    exact: {
      owner: "exact",
      nodeIds: [1, 2, 3, 4],
      points: square
    },
    near: {
      owner: "near",
      nodeIds: [11, 12, 13, 14],
      points: square.map(([x, y], index) => [
        x,
        y,
        [2e-9, -1e-9, 1e-9, -2e-9][index]
      ])
    }
  };
  for (const insertionOrder of [
    ["exact", "near"],
    ["near", "exact"]
  ]) {
    const index = new GeometricFaceIndex(1e-8);
    for (const key of insertionOrder) {
      index.add(faces[key]);
    }
    const error = captureError(() => index.uniqueMatch({
      owner: "query",
      nodeIds: [4, 3, 2, 1],
      points: square
    }));

    assert.equal(error instanceof TwoToOnePlanningError, true);
    assert.equal(error.code, "TWO_TO_ONE_AMBIGUOUS_FACE");
    assert.deepEqual(
      error.diagnostic.conflictingCellIds,
      ["exact", "near", "query"]
    );
  }
});

test("geometric face identity counts same-owner geometric records at face level", () => {
  const square = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0]
  ];
  const faces = {
    first: {
      owner: "shared-owner",
      nodeIds: [1, 2, 3, 4],
      points: square
    },
    second: {
      owner: "shared-owner",
      nodeIds: [11, 12, 13, 14],
      points: square
    }
  };

  const diagnosticsByQuery = new Map();
  for (const insertionOrder of [
    ["first", "second"],
    ["second", "first"]
  ]) {
    const index = new GeometricFaceIndex(1e-8);
    for (const key of insertionOrder) {
      index.add(faces[key]);
    }
    for (const query of [
      {
        owner: "exact-query",
        nodeIds: [4, 3, 2, 1],
        points: square
      },
      {
        owner: "geometry-query",
        nodeIds: [21, 22, 23, 24],
        points: square
      }
    ]) {
      assert.deepEqual(
        index.matches(query).map((face) => [...face.nodeIds]),
        [
          [1, 2, 3, 4],
          [11, 12, 13, 14]
        ]
      );
      const error = captureError(() => index.uniqueMatch(query));
      assert.equal(error.code, "TWO_TO_ONE_AMBIGUOUS_FACE");
      assert.deepEqual(
        error.diagnostic.conflictingCellIds,
        [query.owner, "shared-owner"].sort()
      );
      const diagnostics = diagnosticsByQuery.get(query.owner) ?? [];
      diagnostics.push(structuredClone(error.diagnostic));
      diagnosticsByQuery.set(query.owner, diagnostics);
    }
  }
  for (const diagnostics of diagnosticsByQuery.values()) {
    assert.deepEqual(diagnostics[1], diagnostics[0]);
    assert.deepEqual(
      diagnostics[0].conflictingInterfaces.map((entry) => entry.faceNodeIds),
      [
        [1, 2, 3, 4],
        [11, 12, 13, 14]
      ]
    );
  }
});

test("geometric face ambiguity diagnostics are sorted independently of insertion order", () => {
  const square = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0]
  ];
  const faces = [
    {
      owner: "z-owner",
      nodeIds: [1, 2, 3, 4],
      points: square
    },
    {
      owner: "a-owner",
      nodeIds: [11, 12, 13, 14],
      points: square
    }
  ];
  const diagnostics = [];
  for (const insertionOrder of [faces, [...faces].reverse()]) {
    const index = new GeometricFaceIndex(1e-8);
    for (const face of insertionOrder) {
      index.add(face);
    }
    const error = captureError(() => index.uniqueMatch({
      owner: "m-query",
      nodeIds: [21, 22, 23, 24],
      points: square
    }));
    diagnostics.push(structuredClone(error.diagnostic));
  }

  assert.deepEqual(diagnostics[1], diagnostics[0]);
  assert.deepEqual(diagnostics[0], {
    conflictingCellIds: ["a-owner", "m-query", "z-owner"],
    conflictingInterfaces: [
      {
        firstCellId: "m-query",
        secondCellId: "a-owner",
        faceNodeIds: [11, 12, 13, 14]
      },
      {
        firstCellId: "m-query",
        secondCellId: "z-owner",
        faceNodeIds: [1, 2, 3, 4]
      }
    ],
    attemptedActions: []
  });
});

test("geometric face identity keeps unique exact ids authoritative over unrelated geometry", () => {
  const index = new GeometricFaceIndex(1e-8);
  const square = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0]
  ];
  const farSquare = square.map(([x, y, z]) => [x + 100, y, z]);
  index.add({
    owner: "exact",
    nodeIds: [1, 2, 3, 4],
    points: square
  });
  index.add({
    owner: "unrelated-near-bucket",
    nodeIds: [11, 12, 13, 14],
    points: [
      square[0],
      square[1],
      square[2],
      [0, 1, 2e-8]
    ]
  });
  index.add({
    owner: "far-geometry",
    nodeIds: [21, 22, 23, 24],
    points: farSquare
  });

  assert.deepEqual(index.matches({
    owner: "near-query",
    nodeIds: [4, 3, 2, 1],
    points: square
  }).map((face) => face.owner), ["exact"]);
  assert.deepEqual(index.matches({
    owner: "far-query",
    nodeIds: [4, 3, 2, 1],
    points: farSquare
  }).map((face) => face.owner), ["exact"]);
});

test("geometric face identity requires four distinct positive safe node ids", () => {
  const points = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
  const invalidNodeIds = [
    [0, 2, 3, 4],
    [-1, 2, 3, 4],
    [1.5, 2, 3, 4],
    [Number.MAX_SAFE_INTEGER + 1, 2, 3, 4],
    [1, 1, 3, 4]
  ];

  for (const nodeIds of invalidNodeIds) {
    const index = new GeometricFaceIndex(1e-8);
    assert.throws(() => index.add({
      owner: "invalid",
      nodeIds,
      points
    }), TypeError);
  }
});

test("geometric face identity validates owners at runtime", () => {
  const points = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
  const invalidOwners = [
    {},
    null,
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    true
  ];

  for (const owner of invalidOwners) {
    const face = {
      owner,
      nodeIds: [1, 2, 3, 4],
      points
    };
    assert.throws(() => new GeometricFaceIndex(1e-8).add(face), TypeError);
    assert.throws(() => new GeometricFaceIndex(1e-8).matches(face), TypeError);
  }

  const index = new GeometricFaceIndex(1e-8);
  index.add({
    owner: "",
    nodeIds: [1, 2, 3, 4],
    points
  });
  assert.equal(index.uniqueMatch({
    owner: 0,
    nodeIds: [4, 3, 2, 1],
    points
  })?.owner, "");
});

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

for (const compatibilityCase of [
  {
    name: "Q1",
    createSession: () => createRefinementSession(createQ1UnitSquareMesh(1, 1)),
    options: {}
  },
  {
    name: "Hex ratio 3",
    createSession: () => createRefinementSession(createHexUnitCubeMesh(1, 1, 1)),
    options: {
      hexRefinementRatio: 3,
      includeTransitions: true
    }
  },
  {
    name: "raw Hex ratio 2",
    createSession: () => createRefinementSession(createHexUnitCubeMesh(1, 1, 1)),
    options: {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: false
    }
  }
]) {
  for (const operation of ["preview", "refine"]) {
    for (const compensationCase of ["undefined", "invalid mode getter"]) {
      test(`${compatibilityCase.name} ${operation} ignores ${compensationCase} compensation`, () => {
        const session = compatibilityCase.createSession();
        let modeReads = 0;
        const compensation = compensationCase === "undefined"
          ? undefined
          : Object.defineProperty({}, "mode", {
              enumerable: true,
              get() {
                modeReads += 1;
                throw new Error("non-target compensation probe");
              }
            });
        const options = {
          ...compatibilityCase.options,
          hexTwoToOneCompensation: compensation
        };

        const result = operation === "preview"
          ? previewSessionPatch(session, ["e1"], options)
          : refineSessionPatch(session, ["e1"], options);

        assert.equal(modeReads, 0);
        if (operation === "preview") {
          assert.ok(result.plan.length > 0);
        } else {
          assert.ok(result.createdCellIds.length > 0);
          assert.ok(result.recipe);
          const replaySession = compatibilityCase.createSession();
          const replayed = refineSessionPatch(
            replaySession,
            [...result.recipe.selectedCellIds],
            result.recipe.options
          );
          assert.deepEqual(replayed, result);
          assert.equal(modeReads, 0);
        }
      });
    }
  }
}

test("Hex 2:1 structured planning errors retain machine-readable diagnostics", () => {
  const diagnostic = {
    conflictingCellIds: [11, 12],
    conflictingInterfaces: [],
    attemptedActions: [],
    historyCommandIds: ["cmd-12", "cmd-2", "cmd-12"],
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
  assert.deepEqual(error.diagnostic, {
    ...diagnostic,
    historyCommandIds: ["cmd-12", "cmd-2"]
  });
  assert.equal(error.diagnostic.suggestion.axis, 1);
  assert.equal(error instanceof Error, true);
  assert.equal(error instanceof TwoToOnePlanningError, true);

  const expectedDto = {
    name: "TwoToOnePlanningError",
    message: "odd periodic transition field",
    code: "TWO_TO_ONE_UNSUPPORTED_PARITY",
    diagnostic: {
      ...diagnostic,
      historyCommandIds: ["cmd-12", "cmd-2"]
    }
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
    historyCommandIds: ["cmd-9", "cmd-3", "cmd-9"],
    suggestion: {
      kind: "expand-selection",
      axis: 1,
      side: 1,
      parentCellIds: [15]
    }
  };
  const expectedDiagnostic = {
    ...structuredClone(diagnostic),
    historyCommandIds: ["cmd-3", "cmd-9"]
  };
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

test("Hex 2:1 diagnostic freezing freezes retained history command id arrays", () => {
  const error = new TwoToOnePlanningError(
    "TWO_TO_ONE_HISTORY_CONFLICT",
    "support history conflict",
    {
      conflictingCellIds: [11],
      conflictingInterfaces: [],
      attemptedActions: [],
      historyCommandIds: ["cmd-9", "cmd-2", "cmd-9"]
    }
  );
  const retainedHistoryCommandIds = error.diagnostic.historyCommandIds;

  freezeTwoToOnePlanningErrorDiagnostic(error);

  assert.throws(
    () => retainedHistoryCommandIds.push("cmd-mutated"),
    TypeError
  );
  assert.deepEqual(error.diagnostic.historyCommandIds, ["cmd-2", "cmd-9"]);
});

test("Hex 2:1 flat mapper freezes nested diagnostics and isolates retries", () => {
  const createInternalError = () => new TwoToOnePlanningError(
    "TWO_TO_ONE_COMPENSATION_LIMIT",
    "compensation budget exhausted",
    {
      conflictingCellIds: [11, 12],
      conflictingInterfaces: [{
        firstCellId: 11,
        secondCellId: 12,
        faceNodeIds: [4, 3, 2, 1]
      }],
      attemptedActions: [{
        kind: "selection-expand",
        reason: "close transition",
        addedParentCellIds: [13],
        replacedTransitionCellIds: [14],
        templateId: "selection-shell"
      }],
      historyCommandIds: ["cmd-9", "cmd-2", "cmd-9"],
      suggestion: {
        kind: "expand-selection",
        axis: 1,
        side: 1,
        parentCellIds: [15]
      }
    }
  );
  const internalError = createInternalError();
  const mapped = asTwoToOneFlatPlanningError(internalError, [11, 12]);
  const expected = {
    name: "TwoToOnePlanningError",
    message: "compensation budget exhausted",
    code: "TWO_TO_ONE_COMPENSATION_LIMIT",
    diagnostic: {
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
      historyCommandIds: ["cmd-2", "cmd-9"],
      suggestion: {
        kind: "expand-selection",
        axis: 1,
        side: 1,
        parentCellIds: [15]
      }
    }
  };

  assert.equal(Object.isFrozen(mapped.diagnostic), true);
  assert.equal(Object.isFrozen(mapped.diagnostic.conflictingCellIds), true);
  assert.equal(Object.isFrozen(mapped.diagnostic.conflictingInterfaces), true);
  assert.equal(Object.isFrozen(mapped.diagnostic.conflictingInterfaces[0]), true);
  assert.equal(
    Object.isFrozen(mapped.diagnostic.conflictingInterfaces[0].faceNodeIds),
    true
  );
  assert.equal(Object.isFrozen(mapped.diagnostic.attemptedActions), true);
  assert.equal(Object.isFrozen(mapped.diagnostic.attemptedActions[0]), true);
  assert.equal(
    Object.isFrozen(mapped.diagnostic.attemptedActions[0].addedParentCellIds),
    true
  );
  assert.equal(Object.isFrozen(mapped.diagnostic.suggestion), true);
  assert.equal(
    Object.isFrozen(mapped.diagnostic.suggestion.parentCellIds),
    true
  );
  assert.notEqual(
    mapped.diagnostic.historyCommandIds,
    internalError.diagnostic.historyCommandIds
  );
  assert.deepEqual(mapped.diagnostic.historyCommandIds, ["cmd-2", "cmd-9"]);
  assert.throws(() => mutatePlanningDiagnostic(mapped.diagnostic), TypeError);

  mutatePlanningDiagnostic(internalError.diagnostic);
  assert.deepEqual(serializeTwoToOnePlanningError(mapped), expected);
  assert.deepEqual(
    serializeTwoToOnePlanningError(
      asTwoToOneFlatPlanningError(createInternalError(), [11, 12])
    ),
    expected
  );
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

test("refinement commands are deeply immutable without weakening undo redo", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const command = refineSessionCell(session, "e1", refineHexTo27Hex);
  const stable = structuredClone(command);

  assert.equal(Object.isFrozen(command), true);
  assert.equal(Object.isFrozen(command.createdCellIds), true);
  assert.equal(Object.isFrozen(command.quality), true);
  assert.throws(() => {
    command.createdCellIds.length = 0;
  }, TypeError);
  assert.throws(() => command.createdCellIds.push("tampered"), TypeError);
  assert.throws(() => command.hiddenCellIds.splice(0), TypeError);
  assert.throws(() => {
    command.quality.ok = false;
  }, TypeError);
  assert.deepEqual(command, stable);

  const undone = undoRefinementSession(session);
  assert.equal(undone, command);
  assert.deepEqual([...session.activeLeafIds], ["e1"]);
  const redone = redoRefinementSession(session);
  assert.equal(redone, command);
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

test("Hex volume remains stable for mixed exponents and axis permutations", () => {
  const base = createAnisotropicHexVertices(1e200, 1e-200, 1e-200);
  const swapped = createAnisotropicHexVertices(
    1e200,
    1e-200,
    1e-200,
    ([x, y, z]) => [y, x, z]
  );
  const cycled = createAnisotropicHexVertices(
    1e200,
    1e-200,
    1e-200,
    ([x, y, z]) => [y, z, x]
  );
  const warped = createAnisotropicHexVertices(
    1e200,
    1e-200,
    1e-200,
    ([x, y, z]) => [
      x,
      y * (x === 0 ? 1 : 1.125),
      z * (y === 0 ? 1 : 1.0625)
    ]
  );

  for (const [vertices, expected] of [
    [base, 1e-200],
    [swapped, -1e-200],
    [cycled, 1e-200]
  ]) {
    const volume = hexElementSignedVolume(vertices);
    assert.equal(Number.isFinite(volume), true);
    assert.equal(Math.abs(volume / expected - 1) < 1e-12, true);
  }
  const warpedVolume = hexElementSignedVolume(warped);
  assert.equal(Number.isFinite(warpedVolume), true);
  assert.equal(warpedVolume > 1e-200, true);
  assert.equal(warpedVolume < 1.3e-200, true);
});

test("Hex determinant preserves tiny components beside huge column components", () => {
  const columns = [
    [1e200, 0, 0],
    [0, 1e200, 0],
    [1e200, 1e200, 1e-200]
  ];
  const permutations = [
    { order: [0, 1, 2], sign: 1 },
    { order: [0, 2, 1], sign: -1 },
    { order: [1, 0, 2], sign: -1 },
    { order: [1, 2, 0], sign: 1 },
    { order: [2, 0, 1], sign: 1 },
    { order: [2, 1, 0], sign: -1 }
  ];

  for (const { order, sign } of permutations) {
    const vertices = createParallelepipedHexVertices(
      columns[order[0]],
      columns[order[1]],
      columns[order[2]]
    );
    const volume = hexElementSignedVolume(vertices);
    assert.equal(Number.isFinite(volume), true, `${order}`);
    assert.equal(Math.abs(volume / (sign * 1e200) - 1) < 1e-12, true, `${order}`);
  }

  const huge = 2 ** 665;
  const increment = 2 ** 614;
  const tiny = 2 ** -665;
  const cancellation = [
    [huge, huge, 0],
    [huge, huge + increment, 0],
    [0, 0, tiny]
  ];
  const cancellationDeterminant = robustDeterminant3(cancellation);
  assert.equal(Number.isFinite(cancellationDeterminant), true);
  assert.equal(
    Math.abs(cancellationDeterminant / increment - 1) < 1e-12,
    true
  );
  assert.equal(Object.is(robustDeterminant3([
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 0]
  ]), 0), true);
  assert.equal(Number.isNaN(robustDeterminant3([
    [Number.NaN, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ])), true);
  assert.equal(Number.isNaN(robustDeterminant3([
    [Number.POSITIVE_INFINITY, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ])), true);
});

test("Hex determinant preserves B=2**30 cancellation across every axis order", () => {
  const base = 2 ** 30;
  const columns = [
    [base + 1, base, base],
    [base, base + 1, base],
    [base, base, base + 1]
  ];
  const expected = 3 * base + 1;
  const permutations = [
    { order: [0, 1, 2], sign: 1 },
    { order: [0, 2, 1], sign: -1 },
    { order: [1, 0, 2], sign: -1 },
    { order: [1, 2, 0], sign: 1 },
    { order: [2, 0, 1], sign: 1 },
    { order: [2, 1, 0], sign: -1 }
  ];

  for (const { order, sign } of permutations) {
    const matrix = order.map((index) => columns[index]);
    assert.equal(robustDeterminant3(matrix), sign * expected, `${order}`);

    const vertices = createParallelepipedHexVertices(
      matrix[0],
      matrix[1],
      matrix[2]
    );
    const volume = hexElementSignedVolume(vertices);
    assert.equal(
      Math.abs(volume / (sign * expected) - 1) < 1e-6,
      true,
      `${order}`
    );
    const report = auditHexRefinementQuality(
      vertices,
      refineHexTo8Hex(vertices)
    );
    assert.equal(report.ok, true, `${order}`);
    assert.equal(
      Math.abs(report.parentSignedVolume / (sign * expected) - 1) < 1e-6,
      true,
      `${order}`
    );
    assert.equal(report.relativeVolumeError < 1e-12, true, `${order}`);
  }
});

test("Hex determinant retains a low-scale residual after high-scale cancellation", () => {
  const high = 2 ** 1000;
  const small = 2 ** -1000;
  const columns = [
    [high, high, small],
    [high, high, 0],
    [small, 0, small]
  ];
  const permutations = [
    { order: [0, 1, 2], sign: 1 },
    { order: [0, 2, 1], sign: -1 },
    { order: [1, 0, 2], sign: -1 },
    { order: [1, 2, 0], sign: 1 },
    { order: [2, 0, 1], sign: 1 },
    { order: [2, 1, 0], sign: -1 }
  ];

  for (const { order, sign } of permutations) {
    const matrix = order.map((index) => columns[index]);
    assert.equal(robustDeterminant3(matrix), sign * -small, `${order}`);
  }

  const vertices = createParallelepipedHexVertices(
    columns[0],
    columns[1],
    columns[2]
  );
  const volume = hexElementSignedVolume(vertices);
  assert.equal(Number.isFinite(volume), true);
  assert.equal(volume < 0, true);
  assert.equal(Math.abs(volume / (-small / 4) - 1) < 1e-12, true);

  const report = auditHexRefinementQuality(
    vertices,
    refineHexTo8Hex(vertices)
  );
  assert.equal(report.parentSignedVolume, volume);
  assert.equal(report.childSignedVolume < 0, true);
  assert.equal(
    Math.abs(report.relativeVolumeError - 0.75) < 1e-12,
    true
  );
  assert.equal(report.ok, false);
  assert.equal(report.parentMinimumOrientedScaledJacobian <= 0, true);
});

test("underflowed Hex volume retains orientation for quality checks", () => {
  const tiny = 2 ** -400;
  const positive = createAnisotropicHexVertices(tiny, tiny, tiny);
  const negative = createAnisotropicHexVertices(
    tiny,
    tiny,
    tiny,
    ([x, y, z]) => [y, x, z]
  );

  assert.equal(Object.is(hexElementSignedVolume(positive), 0), true);
  assert.equal(Object.is(hexElementSignedVolume(negative), -0), true);
  for (const vertices of [positive, negative]) {
    const report = auditHexRefinementQuality(
      vertices,
      refineHexTo8Hex(vertices)
    );
    assert.equal(report.ok, true);
    assert.equal(report.parentMinimumOrientedScaledJacobian > 0.99, true);
    assert.equal(report.childMinimumOrientedScaledJacobian > 0.99, true);
  }

  const negativeMesh = {
    kind: "H1",
    nodes: negative.map((point) => [...point]),
    elements: [[1, 2, 3, 4, 5, 6, 7, 8]]
  };
  const snapshot = structuredClone(negativeMesh);
  for (const entry of [
    previewRefinementByElementIds,
    refineByElementIdsWithReport
  ]) {
    const result = entry(negativeMesh, [1], {
      hexRefinementRatio: 3,
      includeTransitions: false,
      regularizeHexSelection: false,
      mergeTolerance: 0
    });
    assert.equal(result.quality.ok, true, entry.name);
    assert.equal(
      result.quality.childMinimumOrientedScaledJacobian > 0.99,
      true,
      entry.name
    );
    assert.deepEqual(negativeMesh, snapshot);
  }
});

test("session net quality rejects one retained child at underflow scale", async () => {
  const {
    auditNetHexCellReplacementQuality
  } = await import("../dist/refinement-session-quality-internal.js");
  const tiny = 2 ** -400;
  const vertices = createAnisotropicHexVertices(tiny, tiny, tiny);
  const refinement = refineHexTo8Hex(vertices);
  const parentSession = createRefinementSession({
    kind: "H1",
    nodes: vertices.map((point) => [...point]),
    elements: [[1, 2, 3, 4, 5, 6, 7, 8]]
  });
  const childSession = createRefinementSession({
    kind: "H1",
    nodes: refinement.nodes.map((point) => [...point]),
    elements: [[...refinement.elements[0]]]
  });
  const parentBefore = structuredClone(parentSession);
  const childBefore = structuredClone(childSession);

  const quality = auditNetHexCellReplacementQuality(
    parentSession,
    ["e1"],
    childSession,
    ["e1"]
  );
  assert.equal(Math.abs(quality.relativeVolumeError - 0.875) < 1e-12, true);
  assert.equal(quality.ok, false);
  const error = captureError(() =>
    assertHexPatchQualitySummary(quality, "underflow net replacement")
  );
  assert.equal(error instanceof HexPatchQualityError, true);
  assert.equal(error.code, "HEX_PATCH_VOLUME");
  assert.deepEqual(parentSession, parentBefore);
  assert.deepEqual(childSession, childBefore);
});

test("anisotropic Hex volume loss remains visible to the quality gate", () => {
  const vertices = createAnisotropicHexVertices(1e200, 1e-200, 1e-200);
  const complete = refineHexTo8Hex(vertices);
  const incomplete = {
    ...complete,
    source: "anisotropic_incomplete_hex",
    elements: [complete.elements[0]]
  };
  const report = auditHexRefinementQuality(vertices, incomplete);

  assert.equal(Number.isFinite(report.parentSignedVolume), true);
  assert.equal(Number.isFinite(report.childSignedVolume), true);
  assert.equal(Math.abs(report.relativeVolumeError - 0.875) < 1e-12, true);
  assert.equal(report.ok, false);
});

test("3:1 trilinear Hex refinement preserves extreme anisotropic quality", () => {
  for (const [xScale, yScale, zScale] of [
    [1e20, 1e-20, 1e-20],
    [1e100, 1e-100, 1e-100]
  ]) {
    const vertices = createAnisotropicHexVertices(xScale, yScale, zScale);
    const refinement = refineHexTo27Hex(vertices);
    const report = auditHexRefinementQuality(vertices, refinement);
    const expectedVolume = xScale * yScale * zScale;

    assert.equal(refinement.nodes.length, 64);
    assert.equal(refinement.elements.length, 27);
    assert.equal(report.ok, true);
    assert.equal(report.parentMinimumOrientedScaledJacobian > 0.99, true);
    assert.equal(report.childMinimumOrientedScaledJacobian > 0.5, true);
    assert.equal(report.relativeVolumeError < 1e-12, true);
    assert.equal(
      Math.abs(report.parentSignedVolume / expectedVolume - 1) < 1e-12,
      true
    );
    for (const value of Object.values(report).filter(
      (candidate) => typeof candidate === "number"
    )) {
      assert.equal(Number.isFinite(value), true);
    }
  }
});

test("3:1 trilinear interpolation preserves endpoints and shared faces", () => {
  const shared = 1e-50;
  const left = [
    [1e200, 0, 0],
    [shared, 0, 0],
    [shared, 3, 0],
    [1e200, 3, 0],
    [1e200, 0, 5],
    [shared, 0, 5],
    [shared, 3, 5],
    [1e200, 3, 5]
  ];
  const right = [
    [shared, 0, 0],
    [-1e200, 0, 0],
    [-1e200, 3, 0],
    [shared, 3, 0],
    [shared, 0, 5],
    [-1e200, 0, 5],
    [-1e200, 3, 5],
    [shared, 3, 5]
  ];
  const leftRefinement = refineHexTo27Hex(left);
  const rightRefinement = refineHexTo27Hex(right);
  const gridIndex = (i, j, k) => i * 16 + j * 4 + k;

  assert.deepEqual(leftRefinement.nodes[gridIndex(3, 0, 0)], left[1]);
  assert.deepEqual(leftRefinement.nodes[gridIndex(3, 3, 3)], left[6]);
  for (let j = 0; j <= 3; j += 1) {
    for (let k = 0; k <= 3; k += 1) {
      assert.deepEqual(
        leftRefinement.nodes[gridIndex(3, j, k)],
        rightRefinement.nodes[gridIndex(0, j, k)]
      );
    }
  }

  for (const invalid of [
    left.map((point, index) => index === 7 ? point.slice(0, 2) : point),
    left.map((point, index) => index === 4
      ? [point[0], Number.NaN, point[2]]
      : point)
  ]) {
    assert.throws(
      () => refineHexTo27Hex(invalid),
      /three-dimensional|finite|dimension/i
    );
  }
});

test("generic session Hex refinement rejects nonfinite quality before mutation", () => {
  const operations = [
    {
      name: "single",
      mesh: createScaledHexMesh(1e200),
      invoke: (session) => refineSessionCell(session, "e1", refineHexTo27Hex)
    },
    {
      name: "batch",
      mesh: (() => {
        const mesh = createHexUnitCubeMesh(2, 1, 1);
        mesh.nodes = mesh.nodes.map((point) =>
          point.map((coordinate) => coordinate * 1e200)
        );
        return mesh;
      })(),
      invoke: (session) =>
        refineSessionCells(session, ["e1", "e2"], refineHexTo27Hex)
    }
  ];

  for (const operation of operations) {
    const session = createRefinementSession(operation.mesh);
    const before = structuredClone(session);
    const error = captureError(() => operation.invoke(session));

    assert.equal(error instanceof HexPatchQualityError, true, operation.name);
    assert.equal(error.code, "HEX_PATCH_VOLUME");
    assert.match(error.message, /non-finite.*volume/i);
    assert.deepEqual(session, before);
  }
});

test("session batch aggregate quality rejects overflowing totals atomically", () => {
  const vertices = createAnisotropicHexVertices(1e308, 1, 1);
  const mesh = {
    kind: "H1",
    nodes: [
      ...vertices.map((point) => [...point]),
      ...vertices.map((point) => [...point])
    ],
    elements: [
      [1, 2, 3, 4, 5, 6, 7, 8],
      [9, 10, 11, 12, 13, 14, 15, 16]
    ]
  };
  const session = createRefinementSession(mesh);
  const before = structuredClone(session);
  const error = captureError(() =>
    refineSessionCells(session, ["e1", "e2"], (parentVertices) => ({
      kind: "H1",
      source: "identity_overflow_aggregate",
      nodes: parentVertices.map((point) => [...point]),
      elements: [[1, 2, 3, 4, 5, 6, 7, 8]]
    }))
  );

  assert.equal(error instanceof HexPatchQualityError, true);
  assert.equal(error.code, "HEX_PATCH_VOLUME");
  assert.match(error.message, /non-finite.*volume/i);
  assert.deepEqual(session, before);
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

test("HexRefine command replay applies selection compensation to a bounded 2:1 patch", () => {
  const replay = replayHexRefineCommandScript(twoToOneCompensationReplayScript({
    mode: "selection",
    maxAddedParentLayers: 1,
    maxAddedParentCount: 32
  }));
  const localTopologyReplay = replayHexRefineCommandScript(
    twoToOneCompensationReplayScript({
      mode: "local-topology",
      maxAddedParentLayers: 1,
      maxAddedParentCount: 32
    })
  );
  const command = replay.session.undoStack.at(-1);

  assert.equal(replay.warnings.length, 0);
  assert.equal(localTopologyReplay.session.undoStack.at(-1)?.twoToOne?.status, "compensated");
  assert.equal(command?.twoToOne?.status, "compensated");
  assert.deepEqual(command?.twoToOne?.originalSelectedCellIds, ["e5", "e6", "e7", "e8"]);
  assert.deepEqual(command?.twoToOne?.effectiveSelectedCellIds, [
    "e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"
  ]);
  assert.deepEqual(command?.twoToOne?.actions, [{
    kind: "selection-expand",
    reason: "completed a conforming one-layer 2:1 template field",
    addedParentCellIds: ["e1", "e2", "e3", "e4"],
    replacedTransitionCellIds: []
  }]);
  assert.equal(checkNoHangingNodes(replay.mesh, 1e-9).ok, true);
});

test("HexRefine command replay snapshots 2:1 compensation getters exactly once", () => {
  const reads = {
    mode: 0,
    maxAddedParentLayers: 0,
    maxAddedParentCount: 0
  };
  const compensation = {};
  Object.defineProperties(compensation, {
    mode: {
      enumerable: true,
      get() {
        reads.mode += 1;
        return reads.mode === 1 ? "selection" : "none";
      }
    },
    maxAddedParentLayers: {
      enumerable: true,
      get() {
        reads.maxAddedParentLayers += 1;
        return reads.maxAddedParentLayers === 1 ? 1 : 0;
      }
    },
    maxAddedParentCount: {
      enumerable: true,
      get() {
        reads.maxAddedParentCount += 1;
        return reads.maxAddedParentCount === 1 ? 32 : 0;
      }
    }
  });

  const replay = replayHexRefineCommandScript(
    twoToOneCompensationReplayScript(compensation)
  );

  assert.equal(replay.session.undoStack.at(-1)?.twoToOne?.status, "compensated");
  assert.deepEqual(reads, {
    mode: 1,
    maxAddedParentLayers: 1,
    maxAddedParentCount: 1
  });
});

test("HexRefine command replay retains a self-deleting none compensation descriptor", () => {
  let modeReads = 0;
  const compensation = {};
  Object.defineProperty(compensation, "mode", {
    configurable: true,
    enumerable: true,
    get() {
      modeReads += 1;
      delete compensation.mode;
      return "none";
    }
  });

  const replay = replayHexRefineCommandScript(
    twoToOneCompensationReplayScript(compensation)
  );

  assert.equal(modeReads, 1);
  assert.equal(replay.session.undoStack.length, 0);
  assert.match(
    replay.warnings.join("; "),
    /TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY/
  );
});

test("HexRefine command replay captures maxCount before the mode getter deletes it", () => {
  const reads = { mode: 0, maxAddedParentCount: 0 };
  const compensation = {};
  Object.defineProperties(compensation, {
    mode: {
      enumerable: true,
      get() {
        reads.mode += 1;
        delete compensation.maxAddedParentCount;
        return "selection";
      }
    },
    maxAddedParentCount: {
      configurable: true,
      enumerable: true,
      get() {
        reads.maxAddedParentCount += 1;
        return 0;
      }
    }
  });

  const replay = replayHexRefineCommandScript(
    twoToOneCompensationReplayScript(compensation)
  );

  assert.deepEqual(reads, { mode: 1, maxAddedParentCount: 1 });
  assert.equal(replay.session.undoStack.length, 0);
  assert.match(replay.warnings.join("; "), /TWO_TO_ONE_COMPENSATION_LIMIT/);
});

test("HexRefine command replay isolates mode from a mutating maxCount getter", () => {
  const reads = { mode: 0, maxAddedParentCount: 0 };
  const compensation = {};
  Object.defineProperties(compensation, {
    mode: {
      configurable: true,
      enumerable: true,
      get() {
        reads.mode += 1;
        return "selection";
      }
    },
    maxAddedParentCount: {
      enumerable: true,
      get() {
        reads.maxAddedParentCount += 1;
        Object.defineProperty(compensation, "mode", {
          configurable: true,
          enumerable: true,
          value: "none"
        });
        return 32;
      }
    }
  });

  const replay = replayHexRefineCommandScript(
    twoToOneCompensationReplayScript(compensation)
  );

  assert.deepEqual(reads, { mode: 1, maxAddedParentCount: 1 });
  assert.equal(replay.session.undoStack.at(-1)?.twoToOne?.status, "compensated");
  assert.equal(replay.warnings.length, 0);
});

test("HexRefine command replay propagates compensation getter parse errors once", () => {
  const getterError = new Error("compensation getter failed");
  const reads = { mode: 0, maxAddedParentLayers: 0 };
  const compensation = {};
  Object.defineProperties(compensation, {
    mode: {
      enumerable: true,
      get() {
        reads.mode += 1;
        throw getterError;
      }
    },
    maxAddedParentLayers: {
      enumerable: true,
      get() {
        reads.maxAddedParentLayers += 1;
        return 1;
      }
    }
  });

  const error = captureError(() => replayHexRefineCommandScript(
    twoToOneCompensationReplayScript(compensation)
  ));

  assert.equal(error, getterError);
  assert.deepEqual(reads, { mode: 1, maxAddedParentLayers: 0 });
});

test("HexRefine command replay rejects an invalid compensation mode before limit getters", () => {
  const limitError = new Error("limit getter must not run");
  const reads = { maxAddedParentLayers: 0, maxAddedParentCount: 0 };
  const compensation = {
    mode: "automatic",
    get maxAddedParentLayers() {
      reads.maxAddedParentLayers += 1;
      throw limitError;
    },
    get maxAddedParentCount() {
      reads.maxAddedParentCount += 1;
      return 32;
    }
  };

  const error = captureError(() => replayHexRefineCommandScript(
    twoToOneCompensationReplayScript(compensation)
  ));

  assert.equal(error instanceof TypeError, true);
  assert.equal(
    error.message,
    "hexTwoToOneCompensation.mode must be none, selection, or local-topology"
  );
  assert.deepEqual(reads, {
    maxAddedParentLayers: 0,
    maxAddedParentCount: 0
  });
});

test("HexRefine command replay preserves limit getter errors after a valid mode", () => {
  const limitError = new Error("valid-mode limit getter failed");
  const reads = {
    mode: 0,
    maxAddedParentLayers: 0,
    maxAddedParentCount: 0
  };
  const compensation = {
    get mode() {
      reads.mode += 1;
      return "selection";
    },
    get maxAddedParentLayers() {
      reads.maxAddedParentLayers += 1;
      throw limitError;
    },
    get maxAddedParentCount() {
      reads.maxAddedParentCount += 1;
      return 32;
    }
  };

  const error = captureError(() => replayHexRefineCommandScript(
    twoToOneCompensationReplayScript(compensation)
  ));

  assert.equal(error, limitError);
  assert.deepEqual(reads, {
    mode: 1,
    maxAddedParentLayers: 1,
    maxAddedParentCount: 0
  });
});

test("HexRefine command replay warns and preserves the session when strict 2:1 compensation is disabled", () => {
  const baseline = replayHexRefineCommandScript(twoToOneCompensationReplayScript(
    undefined,
    false
  ));
  const replay = replayHexRefineCommandScript(twoToOneCompensationReplayScript({
    mode: "none"
  }));

  assert.deepEqual(replay.session, baseline.session);
  assert.deepEqual(replay.mesh, baseline.mesh);
  assert.deepEqual(replay.warnings, [
    "refine.patch skipped after TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY: "
      + "2:1 transition element 1 reaches a free boundary on its coarse side"
  ]);
});

test("HexRefine command replay preserves delete redo history after a skipped 2:1 patch", () => {
  const script = twoToOneCompensationReplayScript({ mode: "none" });
  script.commands.splice(
    1,
    0,
    {
      kind: "delete.elements",
      payload: {
        mode: "delete",
        elementIds: [20],
        deletedElementCount: 1,
        sourceElementCount: 20
      }
    },
    { kind: "undo.delete" }
  );
  script.commands.push({ kind: "redo.delete" });

  const replay = replayHexRefineCommandScript(script);

  assert.equal(replay.mesh.elements.length, 19);
  assert.equal(replay.session.revision, 3);
  assert.deepEqual(replay.warnings, [
    "refine.patch skipped after TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY: "
      + "2:1 transition element 1 reaches a free boundary on its coarse side"
  ]);
});

test("HexRefine strict command replay retains 2:1 compensation diagnostics", () => {
  const strictError = captureError(() => replayHexRefineCommandScript(
    twoToOneCompensationReplayScript({ mode: "none" }),
    { strict: true }
  ));
  const limitError = captureError(() => replayHexRefineCommandScript(
    twoToOneCompensationReplayScript({
      mode: "selection",
      maxAddedParentLayers: 1,
      maxAddedParentCount: 0
    }),
    { strict: true }
  ));

  assert.equal(strictError instanceof TwoToOnePlanningError, true);
  assert.equal(strictError.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
  assert.deepEqual(strictError.diagnostic.conflictingCellIds, ["e5", "e6", "e7", "e8"]);
  assert.equal(limitError instanceof TwoToOnePlanningError, true);
  assert.equal(limitError.code, "TWO_TO_ONE_COMPENSATION_LIMIT");
  assert.ok(limitError.diagnostic.attemptedActions.length > 0);
  assert.deepEqual(
    limitError.diagnostic.attemptedActions[0].addedParentCellIds,
    ["e1", "e2", "e3", "e4"]
  );
});

test("HexRefine command replay strictly validates 2:1 compensation options", () => {
  const invalidCompensations = [
    null,
    [],
    { mode: "automatic" },
    { maxAddedParentLayers: -1 },
    { maxAddedParentLayers: 0.5 },
    { maxAddedParentLayers: "1" },
    { maxAddedParentLayers: Number.POSITIVE_INFINITY },
    { maxAddedParentCount: -1 },
    { maxAddedParentCount: 0.5 },
    { maxAddedParentCount: Number.MAX_SAFE_INTEGER + 1 },
    { maxAddedParentCount: Number.NaN }
  ];

  for (const compensation of invalidCompensations) {
    assert.throws(
      () => replayHexRefineCommandScript(twoToOneCompensationReplayScript(compensation)),
      /hexTwoToOneCompensation|maxAddedParent/
    );
  }
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
  assert.equal(replay.session.revision, 3);
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

test("HexRefine command script skips inactive cells when selecting a saved cell set", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 2,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [1, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "COARSE",
          cellIds: ["e1", "e2"]
        }
      },
      {
        kind: "refine.patch",
        payload: {
          cellIds: ["e1"],
          options: {
            includeTransitions: false,
            regularizeHexSelection: false
          }
        }
      },
      {
        kind: "select.cell-set",
        payload: {
          name: "COARSE"
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "ACTIVE_COARSE"
        }
      }
    ]
  }, { selectionStrategy: "replay" });

  assert.deepEqual(replay.cellSets.get("ACTIVE_COARSE"), ["e2"]);
  assert.equal(replay.warnings.length, 0);
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
    mergeTolerance: 1e-9,
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
    mergeTolerance: 1e-9,
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
    mergeTolerance: 1e-9,
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
    mergeTolerance: 1e-9,
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
  const result = refineByElementIdsWithReport(mesh, [selectedElementId], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    regularizeHexSelection: false
  });
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
  assert.equal(preview.summary.selectedElementCount, 1);
  assert.equal(result.summary.selectedElementCount, 1);
});

test("Hex 2:1 flat entry points map quality failures without mutating input", () => {
  const cases = [
    {
      kind: "parent-jacobian",
      code: "TWO_TO_ONE_PARENT_JACOBIAN",
      message: /parent with non-positive scaled Jacobian/
    },
    {
      kind: "child-jacobian",
      code: "TWO_TO_ONE_CHILD_JACOBIAN",
      message: /produced a non-positive scaled Jacobian/
    },
    {
      kind: "volume",
      code: "TWO_TO_ONE_VOLUME",
      message: /does not conserve parent volume/
    }
  ];
  const entries = [
    buildHexClassifiedPlan,
    buildDefaultRefinementPlan,
    buildHexClassifiedReplacements,
    buildDefaultRefinementReplacements,
    buildRefinementReplacements,
    previewRefinementByElementIds,
    previewHexRefinementByElementIds,
    refineByElementIdsWithReport,
    refineHexByElementIdsWithReport
  ];

  for (const qualityCase of cases) {
    for (const entry of entries) {
      const {
        mesh,
        selectedElementIds,
        options
      } = createTwoToOneQualityFailureCase(qualityCase.kind);
      const before = structuredClone(mesh);
      const error = captureError(() => entry(
        mesh,
        selectedElementIds,
        options
      ));

      assert.equal(error instanceof TwoToOnePlanningError, true);
      assert.equal(error.code, qualityCase.code);
      assert.match(error.message, qualityCase.message);
      assert.deepEqual(error.diagnostic.conflictingCellIds, [1]);
      assert.deepEqual(error.diagnostic.conflictingInterfaces, []);
      assert.deepEqual(error.diagnostic.attemptedActions, []);
      assert.equal(error.diagnostic.suggestion, undefined);
      assert.deepEqual(mesh, before);
    }
  }
});

test("Hex 2:1 flat boundaries preserve configuration TypeError and RangeError", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  const selectedElementIds = [5, 6, 7, 8];
  const entries = [
    buildHexClassifiedPlan,
    buildDefaultRefinementPlan,
    buildHexClassifiedReplacements,
    buildDefaultRefinementReplacements,
    buildRefinementReplacements,
    previewRefinementByElementIds,
    previewHexRefinementByElementIds,
    refineByElementIdsWithReport,
    refineHexByElementIdsWithReport
  ];
  const configurationCases = [
    {
      compensation: {
        mode: "automatic"
      },
      errorType: TypeError,
      message: /mode must be none, selection, or local-topology/
    },
    {
      compensation: {
        mode: "selection",
        maxAddedParentCount: -1
      },
      errorType: RangeError,
      message: /maxAddedParentCount must be a non-negative safe integer/
    }
  ];

  for (const entry of entries) {
    for (const configurationCase of configurationCases) {
      const before = structuredClone(mesh);
      const error = captureError(() => entry(mesh, selectedElementIds, {
        hexRefinementRatio: 2,
        hexTwoToOneSelectionMode: "local",
        includeTransitions: true,
        regularizeHexSelection: false,
        hexTwoToOneCompensation: configurationCase.compensation
      }));

      assert.equal(error instanceof configurationCase.errorType, true);
      assert.equal(error instanceof TwoToOnePlanningError, false);
      assert.match(error.message, configurationCase.message);
      assert.deepEqual(mesh, before);
    }
  }

  const includeTransitionsError = captureError(() =>
    planTwoToOneHexRefinement(mesh, selectedElementIds, {
      includeTransitions: false
    })
  );
  assert.equal(includeTransitionsError instanceof RangeError, true);
  assert.equal(includeTransitionsError instanceof TwoToOnePlanningError, false);
  assert.match(includeTransitionsError.message, /requires transitions/);
});

test("Hex 2:1 public transition planner rejects includeTransitions false", () => {
  const mesh = createHexUnitCubeMesh(5, 5, 5);
  const snapshot = structuredClone(mesh);

  assert.throws(
    () => planTwoToOneHexRefinement(mesh, [63], {
      includeTransitions: false
    }),
    {
      name: "RangeError",
      message: /requires transitions to be enabled/
    }
  );
  assert.deepEqual(mesh, snapshot);
});

test("Hex 2:1 selection compensation minimally expands one bounded parent layer", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  const original = idsInIndexBlock(2, 2, 5, [0, 0, 1], [1, 1, 1]);
  const expectedAdded = idsInIndexBlock(2, 2, 5, [0, 0, 0], [1, 1, 0]);
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    regularizeHexSelection: false,
    hexTwoToOneCompensation: {
      mode: "selection",
      maxAddedParentLayers: 1,
      maxAddedParentCount: 32
    }
  };
  const planned = planTwoToOneHexRefinement(mesh, original, options);
  const preview = previewRefinementByElementIds(mesh, original, options);
  const result = refineByElementIdsWithReport(mesh, original, options);
  const affectedParentIds = [
    ...new Set(planned.replacements.map((replacement) => replacement.elementId))
  ].sort((first, second) => first - second);

  assert.deepEqual(result.twoToOne, planned.report);
  assert.equal(result.twoToOne.status, "compensated");
  assert.equal(result.twoToOne.topologyClass, "periodic-ogrid");
  assert.deepEqual(result.twoToOne.originalSelectedCellIds, original);
  assert.deepEqual(
    result.twoToOne.effectiveSelectedCellIds,
    [...expectedAdded, ...original].sort((first, second) => first - second)
  );
  assert.deepEqual(result.twoToOne.actions, [{
    kind: "selection-expand",
    reason: "completed a conforming one-layer 2:1 template field",
    addedParentCellIds: expectedAdded,
    replacedTransitionCellIds: []
  }]);
  assert.deepEqual(result.twoToOne.affectedComponentCellIds, affectedParentIds);
  assert.equal(result.twoToOne.preservedFarFieldCellCount, 8);
  assert.equal(preview.summary.selectedElementCount, 8);
  assert.equal(result.summary.selectedElementCount, 8);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
  assert.equal(result.quality.ok, true);
  assert.ok(result.quality.childMinimumOrientedScaledJacobian > 0);
  const affectedParentIdSet = new Set(affectedParentIds);
  const farFieldParentIds = mesh.elements
    .map((_, index) => index + 1)
    .filter((parentElementId) => !affectedParentIdSet.has(parentElementId));
  assert.equal(farFieldParentIds.length, 8);
  for (const parentElementId of farFieldParentIds) {
    const resultElementIndices = result.cellData.flatMap((cell, index) =>
      cell.parentElementId === parentElementId ? [index] : []
    );
    assert.equal(resultElementIndices.length, 1);
    const [resultElementIndex] = resultElementIndices;
    assert.deepEqual(result.cellData[resultElementIndex], {
      parentElementId,
      role: "unchanged",
      templateCode: 0
    });
    assert.deepEqual(
      result.mesh.elements[resultElementIndex],
      mesh.elements[parentElementId - 1]
    );
  }
});

test("Hex 2:1 selection compensation audits a warped mapped 2x2x5 patch physically", () => {
  const base = createHexUnitCubeMesh(2, 2, 5);
  const mesh = {
    ...base,
    nodes: base.nodes.map(([x, y, z]) => [
      x + 0.025 * y * z,
      y + 0.020 * x * z,
      z + 0.015 * x * y
    ])
  };
  const original = idsInIndexBlock(2, 2, 5, [0, 0, 1], [1, 1, 1]);
  const expectedAdded = idsInIndexBlock(2, 2, 5, [0, 0, 0], [1, 1, 0]);
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    regularizeHexSelection: false,
    hexTwoToOneCompensation: {
      mode: "selection",
      maxAddedParentLayers: 1,
      maxAddedParentCount: 32
    }
  };
  const planned = planTwoToOneHexRefinement(mesh, original, options);
  const repeated = planTwoToOneHexRefinement(mesh, [...original].reverse(), options);
  const physicalQuality = auditHexRefinementPatchQuality(mesh, planned.replacements);
  const result = refineByElementIdsWithReport(mesh, original, options);

  assert.equal(planned.report.status, "compensated");
  assert.deepEqual(planned.report.actions[0].addedParentCellIds, expectedAdded);
  assert.deepEqual(repeated.report, planned.report);
  assert.deepEqual(repeated.replacements, planned.replacements);
  assert.deepEqual(result.quality, physicalQuality);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
  assert.ok(physicalQuality.childMinimumOrientedScaledJacobian > 0.1);
  assert.ok(minimumCornerScaledJacobian(result.mesh) > 0.1);
});

test("Hex 2:1 selection compensation is invariant across mapped mesh scales", () => {
  const reports = [1, 1e-100, 1e100].map((scale) => {
    const mesh = createAlternatelyOrientedHexBlock(2, 2, 5, scale);
    const planned = planTwoToOneHexRefinement(mesh, [5, 6, 7, 8], {
      hexTwoToOneCompensation: {
        mode: "selection",
        maxAddedParentLayers: 1,
        maxAddedParentCount: 32
      }
    });
    assert.equal(planned.report.status, "compensated");
    assert.deepEqual(
      planned.report.actions[0].addedParentCellIds,
      [1, 2, 3, 4]
    );
    return planned.report;
  });

  assert.deepEqual(reports[1], reports[0]);
  assert.deepEqual(reports[2], reports[0]);
});

test("Hex 2:1 planner rejects unresolved large-coordinate lattice precision", () => {
  const mesh = createAlternatelyOrientedHexBlock(2, 2, 5, 0.01, 1e12);
  const error = captureError(() => planTwoToOneHexRefinement(
    mesh,
    [5, 6, 7, 8],
    {
      hexTwoToOneCompensation: {
        mode: "selection",
        maxAddedParentLayers: 1,
        maxAddedParentCount: 32
      }
    }
  ));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
  assert.match(error.message, /lattice tolerance.*minimum edge.*resolution/i);
  assert.deepEqual(error.diagnostic.attemptedActions, []);
});

test("Hex 2:1 selection compensation preserves an already direct core", () => {
  const mesh = createHexUnitCubeMesh(5, 5, 5);
  const selectedElementId = elementIdAt(5, 5, 5, 2, 2, 2);
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    regularizeHexSelection: false,
    hexTwoToOneCompensation: {
      mode: "selection",
      maxAddedParentLayers: 1,
      maxAddedParentCount: 32
    }
  };
  const planned = planTwoToOneHexRefinement(mesh, [selectedElementId], options);

  assert.equal(planned.report.status, "direct");
  assert.deepEqual(planned.report.actions, []);
  assert.deepEqual(planned.report.originalSelectedCellIds, [selectedElementId]);
  assert.deepEqual(planned.report.effectiveSelectedCellIds, [selectedElementId]);
});

test("Hex 2:1 selection compensation limit is atomic and retains attempted actions", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  const snapshot = structuredClone(mesh);
  const original = idsInIndexBlock(2, 2, 5, [0, 0, 1], [1, 1, 1]);
  const error = captureError(() => refineByElementIdsWithReport(mesh, original, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    regularizeHexSelection: false,
    hexTwoToOneCompensation: {
      mode: "selection",
      maxAddedParentLayers: 1,
      maxAddedParentCount: 0
    }
  }));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_COMPENSATION_LIMIT");
  assert.ok(error.diagnostic.attemptedActions.length > 0);
  assert.equal(mesh.elements.length, 20);
  assert.deepEqual(mesh, snapshot);
});

test("Hex 2:1 strict mode rejects a compensable selection without expansion", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  const snapshot = structuredClone(mesh);
  const original = idsInIndexBlock(2, 2, 5, [0, 0, 1], [1, 1, 1]);
  const error = captureError(() => refineByElementIdsWithReport(mesh, original, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    regularizeHexSelection: false,
    hexTwoToOneCompensation: {
      mode: "none"
    }
  }));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
  assert.deepEqual(error.diagnostic.conflictingCellIds, original);
  assert.deepEqual(error.diagnostic.attemptedActions, []);
  assert.deepEqual(mesh, snapshot);
});

test("Hex 2:1 selection compensation treats zero added layers as a limit", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  const original = idsInIndexBlock(2, 2, 5, [0, 0, 1], [1, 1, 1]);
  const error = captureError(() => planTwoToOneHexRefinement(mesh, original, {
    hexTwoToOneCompensation: {
      mode: "selection",
      maxAddedParentLayers: 0,
      maxAddedParentCount: 32
    }
  }));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_COMPENSATION_LIMIT");
  assert.ok(error.diagnostic.attemptedActions.length > 0);
});

test("Hex 2:1 selection compensation does not box-fill a non-rectangular selection", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  const nonRectangular = [5, 6, 8];
  const error = captureError(() => planTwoToOneHexRefinement(
    mesh,
    nonRectangular,
    {
      hexTwoToOneCompensation: {
        mode: "selection",
        maxAddedParentLayers: 1,
        maxAddedParentCount: 32
      }
    }
  ));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
  assert.deepEqual(error.diagnostic.conflictingCellIds, nonRectangular);
  assert.deepEqual(error.diagnostic.attemptedActions, []);
});

test("Hex 2:1 selection compensation skips incomplete logical expansion ranges", () => {
  const mesh = createButterflyOgridBar(5);
  const selected = [25, 26, 27, 28];
  const error = captureError(() => planTwoToOneHexRefinement(mesh, selected, {
    hexTwoToOneCompensation: {
      mode: "selection",
      maxAddedParentLayers: 1,
      maxAddedParentCount: 32
    }
  }));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
  assert.equal(
    error.diagnostic.attemptedActions.every(
      (action) => action.addedParentCellIds.length > 0
    ),
    true
  );
});

test("Hex 2:1 selection compensation does not scan candidates for parity failures", () => {
  const mesh = createHexUnitCubeMesh(3, 3, 3);
  const original = Array.from({ length: 9 }, (_, index) => index + 1);
  const error = captureError(() => planTwoToOneHexRefinement(mesh, original, {
    hexTwoToOneCompensation: {
      mode: "selection",
      maxAddedParentLayers: 1,
      maxAddedParentCount: 32
    }
  }));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_UNSUPPORTED_PARITY");
  assert.deepEqual(error.diagnostic.attemptedActions, []);
  assert.equal(error.diagnostic.suggestion.kind, "remesh-source");
});

test("Hex 2:1 planner maps invalid connectivity without entering compensation", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  mesh.elements[0] = mesh.elements[0].slice(0, 7);
  const snapshot = structuredClone(mesh);
  const error = captureError(() => planTwoToOneHexRefinement(mesh, [5, 6, 7, 8], {
    hexTwoToOneCompensation: { mode: "selection" }
  }));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
  assert.deepEqual(error.diagnostic.attemptedActions, []);
  assert.deepEqual(mesh, snapshot);
});

test("Hex 2:1 planner maps missing nodes without entering compensation", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  mesh.elements[0] = [
    ...mesh.elements[0].slice(0, 7),
    mesh.nodes.length + 1
  ];
  const snapshot = structuredClone(mesh);
  const error = captureError(() => planTwoToOneHexRefinement(mesh, [5, 6, 7, 8], {
    hexTwoToOneCompensation: { mode: "selection" }
  }));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
  assert.deepEqual(error.diagnostic.attemptedActions, []);
  assert.deepEqual(mesh, snapshot);
});

test("Hex 2:1 public planner maps valence failures without compensation", () => {
  const mesh = createButterflyOgridBar(3);
  const snapshot = structuredClone(mesh);
  const error = captureError(() => planTwoToOneHexRefinement(mesh, [13, 15], {
    hexTwoToOneCompensation: { mode: "selection" }
  }));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_UNSUPPORTED_VALENCE");
  assert.deepEqual(error.diagnostic.attemptedActions, []);
  assert.equal(error.diagnostic.suggestion.kind, "remesh-source");
  assert.deepEqual(mesh, snapshot);
});

test("Hex 2:1 public planner maps nonmanifold topology without compensation", () => {
  const mesh = createHexUnitCubeMesh(2, 1, 1);
  mesh.elements.push([...mesh.elements[1]]);
  const snapshot = structuredClone(mesh);
  const error = captureError(() => planTwoToOneHexRefinement(mesh, [1], {
    hexTwoToOneCompensation: { mode: "selection" }
  }));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
  assert.match(error.message, /nonmanifold/);
  assert.deepEqual(error.diagnostic.attemptedActions, []);
  assert.equal(error.diagnostic.suggestion.kind, "remesh-source");
  assert.deepEqual(mesh, snapshot);
});

test("Hex 2:1 planner prioritizes invalid selected ids over unrelated mesh defects", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  mesh.elements[0] = [
    ...mesh.elements[0].slice(0, 7),
    mesh.nodes.length + 1
  ];
  const error = captureError(() => planTwoToOneHexRefinement(mesh, [99], {
    hexTwoToOneCompensation: { mode: "selection" }
  }));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
  assert.deepEqual(error.diagnostic.conflictingCellIds, [99]);
  assert.deepEqual(error.diagnostic.attemptedActions, []);
  assert.match(error.message, /selected Hex element ids are out of range/);
});

test("Hex 2:1 planner does not convert ordinary direct invariants into compensation", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  const invariant = new Error("sentinel direct invariant");
  Object.defineProperty(mesh.nodes[0], 0, {
    get() {
      throw invariant;
    }
  });

  const error = captureError(() => planTwoToOneHexRefinement(mesh, [5, 6, 7, 8], {
    hexTwoToOneCompensation: { mode: "selection" }
  }));

  assert.equal(error, invariant);
});

test("Hex 2:1 selection compensation ranks multiple successful candidates deterministically", () => {
  const candidate = (
    name,
    addedCount,
    replacementCount,
    childMinimumOrientedScaledJacobian,
    effectiveSelectedCellIds
  ) => ({
    name,
    addedParentCellIds: Array.from(
      { length: addedCount },
      (_, index) => index + 1
    ),
    direct: {
      replacements: Array.from(
        { length: replacementCount },
        (_, index) => ({ elementId: index + 1 })
      )
    },
    childMinimumOrientedScaledJacobian,
    effectiveSelectedCellIds
  });
  const candidates = [
    candidate("more-added", 2, 2, 0.9, [1]),
    candidate("more-replacements", 1, 5, 0.9, [1]),
    candidate("lower-quality", 1, 4, 0.2, [1]),
    candidate("lexicographically-later", 1, 4, 0.3, [9]),
    candidate("lexicographically-first", 1, 4, 0.3, [2])
  ];

  const ranked = twoToOnePlannerModule
    .rankSuccessfulTwoToOneCandidates(candidates);

  assert.deepEqual(
    ranked.map((item) => item.name),
    [
      "lexicographically-first",
      "lexicographically-later",
      "lower-quality",
      "more-replacements",
      "more-added"
    ]
  );
  assert.deepEqual(
    candidates.map((item) => item.name),
    [
      "more-added",
      "more-replacements",
      "lower-quality",
      "lexicographically-later",
      "lexicographically-first"
    ]
  );
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

test("Hex 2:1 session selection compensation maps planning ids to cell ids", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  const session = createRefinementSession(mesh);
  const active = buildActiveMeshWithMap(session);
  const originalElementIds = idsInIndexBlock(
    2,
    2,
    5,
    [0, 0, 1],
    [1, 1, 1]
  );
  const addedElementIds = idsInIndexBlock(2, 2, 5, [0, 0, 0], [1, 1, 0]);
  const originalCellIds = originalElementIds.map((elementId) =>
    activeBuildCellIdByElementId(active, elementId)
  );
  const addedCellIds = addedElementIds.map((elementId) =>
    activeBuildCellIdByElementId(active, elementId)
  );
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    hexTwoToOneCompensation: {
      mode: "selection",
      maxAddedParentLayers: 1,
      maxAddedParentCount: 32
    },
    activeBuild: active
  };
  const preview = previewSessionPatch(session, originalCellIds, options);
  const command = refineSessionPatch(session, originalCellIds, options);
  const refined = buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });

  assert.deepEqual(preview.twoToOne, command.twoToOne);
  assert.equal(command.twoToOne.status, "compensated");
  assert.deepEqual(command.twoToOne.originalSelectedCellIds, originalCellIds);
  assert.deepEqual(command.twoToOne.actions[0].addedParentCellIds, addedCellIds);
  assert.deepEqual(
    command.twoToOne.effectiveSelectedCellIds,
    [...addedCellIds, ...originalCellIds]
  );
  assert.equal(command.twoToOne.preservedFarFieldCellCount, 8);
  assert.equal(command.quality.ok, true);
  assert.equal(checkNoHangingNodes(refined, 1e-9).ok, true);
  assert.ok(minimumCornerScaledJacobian(refined) > 0);
});

test("Hex 2:1 session maps quality failures and preserves complete state", () => {
  const cases = [
    {
      kind: "parent-jacobian",
      code: "TWO_TO_ONE_PARENT_JACOBIAN",
      message: /parent with non-positive scaled Jacobian/
    },
    {
      kind: "child-jacobian",
      code: "TWO_TO_ONE_CHILD_JACOBIAN",
      message: /produced a non-positive scaled Jacobian/
    },
    {
      kind: "volume",
      code: "TWO_TO_ONE_VOLUME",
      message: /does not conserve parent volume/
    }
  ];

  for (const qualityCase of cases) {
    const {
      mesh,
      selectedElementIds,
      options
    } = createTwoToOneQualityFailureCase(qualityCase.kind);
    const session = createRefinementSession(mesh);
    const active = buildActiveMeshWithMap(session);
    const selectedCellIds = selectedElementIds.map((elementId) =>
      activeBuildCellIdByElementId(active, elementId)
    );
    const before = structuredClone(session);
    const error = captureError(() => refineSessionPatch(
      session,
      selectedCellIds,
      {
        ...options,
        activeBuild: active
      }
    ));

    assert.equal(error instanceof TwoToOnePlanningError, true);
    assert.equal(error.code, qualityCase.code);
    assert.match(error.message, qualityCase.message);
    assert.deepEqual(error.diagnostic.conflictingCellIds, selectedCellIds);
    assert.deepEqual(error.diagnostic.conflictingInterfaces, []);
    assert.deepEqual(error.diagnostic.attemptedActions, []);
    assert.equal(error.diagnostic.suggestion, undefined);
    assert.deepEqual(session, before);
  }
});

test("Hex 2:1 session strict mode rejects selection compensation atomically", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  const session = createRefinementSession(mesh);
  const active = buildActiveMeshWithMap(session);
  const originalCellIds = idsInIndexBlock(
    2,
    2,
    5,
    [0, 0, 1],
    [1, 1, 1]
  ).map((elementId) => activeBuildCellIdByElementId(active, elementId));
  const before = structuredClone(session);
  const error = captureError(() => refineSessionPatch(
    session,
    originalCellIds,
    {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      hexTwoToOneCompensation: {
        mode: "none"
      },
      activeBuild: active
    }
  ));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
  assert.deepEqual(error.diagnostic.conflictingCellIds, originalCellIds);
  assert.deepEqual(session, before);
});

test("Hex 2:1 session compensation limit maps complete attempted actions atomically", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 2, 5));
  const active = buildActiveMeshWithMap(session);
  const selectedCellIds = [5, 6, 7, 8].map((elementId) =>
    activeBuildCellIdByElementId(active, elementId)
  );
  const before = structuredClone(session);
  const error = captureError(() => refineSessionPatch(
    session,
    selectedCellIds,
    {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      hexTwoToOneCompensation: {
        mode: "selection",
        maxAddedParentLayers: 1,
        maxAddedParentCount: 0
      },
      activeBuild: active
    }
  ));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_COMPENSATION_LIMIT");
  assert.deepEqual(error.diagnostic.conflictingCellIds, selectedCellIds);
  assert.deepEqual(error.diagnostic.attemptedActions[0].addedParentCellIds, [
    "e1",
    "e2",
    "e3",
    "e4"
  ]);
  assert.deepEqual(error.diagnostic.suggestion, {
    kind: "expand-selection",
    axis: 2,
    side: -1,
    parentCellIds: ["e1", "e2", "e3", "e4"]
  });
  const serialized = serializeTwoToOnePlanningError(error);
  assert.equal(Object.isFrozen(error.diagnostic), true);
  assert.equal(Object.isFrozen(error.diagnostic.attemptedActions), true);
  assert.equal(Object.isFrozen(error.diagnostic.attemptedActions[0]), true);
  assert.equal(
    Object.isFrozen(error.diagnostic.attemptedActions[0].addedParentCellIds),
    true
  );
  assert.equal(Object.isFrozen(error.diagnostic.suggestion), true);
  assert.equal(
    Object.isFrozen(error.diagnostic.suggestion.parentCellIds),
    true
  );
  assert.throws(
    () => error.diagnostic.attemptedActions[0].addedParentCellIds.push("e20"),
    TypeError
  );
  assert.deepEqual(session, before);

  const retryError = captureError(() => refineSessionPatch(
    session,
    selectedCellIds,
    {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      hexTwoToOneCompensation: {
        mode: "selection",
        maxAddedParentLayers: 1,
        maxAddedParentCount: 0
      },
      activeBuild: active
    }
  ));
  assert.deepEqual(serializeTwoToOnePlanningError(retryError), serialized);
  assert.deepEqual(session, before);
});

test("Hex 2:1 session legacy rebuild false normalizes to strict compensation", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  const session = createRefinementSession(mesh);
  const active = buildActiveMeshWithMap(session);
  const originalCellIds = idsInIndexBlock(
    2,
    2,
    5,
    [0, 0, 1],
    [1, 1, 1]
  ).map((elementId) => activeBuildCellIdByElementId(active, elementId));
  const before = structuredClone(session);
  const error = captureError(() => refineSessionPatch(
    session,
    originalCellIds,
    {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      rebuildExistingTransitions: false,
      activeBuild: active
    }
  ));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
  assert.deepEqual(error.diagnostic.conflictingCellIds, originalCellIds);
  assert.deepEqual(session, before);
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
    hexPlan.replacements.map(({ elementId, role, templateCode }) => ({
      elementId,
      role,
      templateCode
    })),
    [{
      elementId: selectedElementId,
      role: "selected",
      templateCode: 8
    }]
  );
  assert.equal(hexPlan.replacements[0].refinement.elements.length, 8);
  assert.deepEqual(
    defaultPlan.replacements.map((replacement) => replacement.elementId),
    [selectedElementId]
  );
  assert.deepEqual(
    sortedPlan.replacements.map((replacement) => replacement.elementId),
    [selectedElementId, selectedElementId + 1]
  );
  assert.deepEqual(
    buildDefaultRefinementReplacements(mesh, selected, {
      hexRefinementRatio: 2,
      includeTransitions: false
    }),
    defaultPlan.replacements
  );
  assert.equal(hexPlan.twoToOne, undefined);
  assert.equal(defaultPlan.twoToOne, undefined);
  assert.equal(preview.twoToOne, undefined);
  assert.equal(result.twoToOne, undefined);
  assert.equal(
    result.cellData.filter((cell) =>
      cell.parentElementId === selectedElementId
      && cell.role === "selected"
      && cell.templateCode === 8
    ).length,
    8
  );
  assert.equal(checkNoHangingNodes(result.mesh).ok, false);
});

test("Hex 2:1 normalized trusted paths match public and classified entries", () => {
  assert.equal(typeof twoToOneModule.normalizeTwoToOneSelection, "function");
  assert.equal(
    typeof twoToOneModule.buildDirectTwoToOneHexPlanFromNormalizedSelection,
    "function"
  );
  assert.equal(
    typeof twoToOneSweepModule.tryBuildLocalTwoToOneHexReplacements,
    "function"
  );
  assert.equal(
    typeof twoToOneSweepModule.tryBuildLocalTwoToOneHexReplacementsFromNormalizedSelection,
    "function"
  );

  const mesh = createHexUnitCubeMesh(5, 5, 5);
  const selectedElementId = elementIdAt(5, 5, 5, 2, 2, 2);
  const rawSelected = [
    selectedElementId + 1,
    selectedElementId,
    selectedElementId + 1
  ];
  const rawSnapshot = [...rawSelected];
  const normalized = twoToOneModule.normalizeTwoToOneSelection(mesh, rawSelected);
  const normalizedSnapshot = [...normalized];
  const publicPlan = buildDirectTwoToOneHexPlan(mesh, rawSelected);
  const trustedPlan =
    twoToOneModule.buildDirectTwoToOneHexPlanFromNormalizedSelection(
      mesh,
      normalized
    );
  const classifiedPlan = buildHexClassifiedPlan(mesh, rawSelected, {
    hexRefinementRatio: 2,
    includeTransitions: true
  });
  const publicSweep =
    twoToOneSweepModule.tryBuildLocalTwoToOneHexReplacements(mesh, rawSelected);
  const trustedSweep =
    twoToOneSweepModule.tryBuildLocalTwoToOneHexReplacementsFromNormalizedSelection(
      mesh,
      normalized
    );

  assert.deepEqual(normalized, [selectedElementId, selectedElementId + 1]);
  assert.deepEqual(trustedPlan, publicPlan);
  assert.deepEqual(classifiedPlan.replacements, publicPlan.replacements);
  assert.deepEqual(
    buildTwoToOneHexReplacements(mesh, rawSelected),
    publicPlan.replacements
  );
  assert.deepEqual(trustedSweep, publicSweep);
  assert.deepEqual(rawSelected, rawSnapshot);
  assert.deepEqual(normalized, normalizedSnapshot);
  assert.equal(Object.hasOwn(api, "normalizeTwoToOneSelection"), false);
  assert.equal(
    Object.hasOwn(api, "buildDirectTwoToOneHexPlanFromNormalizedSelection"),
    false
  );
  assert.equal(
    Object.hasOwn(api, "tryBuildLocalTwoToOneHexReplacementsFromNormalizedSelection"),
    false
  );
});

test("unchecked Hex planning internals are absent from the root runtime API", () => {
  for (const [namespace, uncheckedName] of [
    [api, "buildDefaultRefinementPlanUnchecked"],
    [api, "buildHexClassifiedPlanUnchecked"],
    [api.refinementPlanner, "buildDefaultRefinementPlanUnchecked"],
    [api.transitions, "buildHexClassifiedPlanUnchecked"]
  ]) {
    assert.equal(Object.hasOwn(namespace, uncheckedName), false);
  }
  for (const declarationFile of [
    "../dist/index.d.ts",
    "../dist/refinement-planner.d.ts",
    "../dist/transitions.d.ts"
  ]) {
    const declarations = readFileSync(
      new URL(declarationFile, import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(declarations, /PlanUnchecked/);
  }
});

test("refinement session public facade preserves the legacy API and hides history transactions", async () => {
  const publicRefinementSession = await import(
    "../dist/refinement-session-public.js"
  );
  const legacyRuntimeExports = [
    "activeBuildCellIdByElementId",
    "activeBuildElementIdByCellId",
    "activeBuildHasSessionNodeIds",
    "activeBuildSessionNodeIdsByNodeId",
    "buildActiveMesh",
    "buildActiveMeshWithMap",
    "buildRefinementSessionExport",
    "checkRefinementSessionCommandConformance",
    "cloneRefinementSessionCommand",
    "createRefinementSession",
    "isRefinableSessionCell",
    "previewSessionPatch",
    "redoRefinementSession",
    "refineSessionCell",
    "refineSessionCells",
    "refineSessionPatch",
    "remapSessionSetsToActiveMesh",
    "undoRefinementSession",
    "validateActiveBuildCellsForSession",
    "validateActiveBuildForSession",
    "validateRefinementSessionSelection"
  ];

  assert.deepEqual(
    Object.keys(publicRefinementSession).sort(),
    legacyRuntimeExports
  );
  assert.deepEqual(
    Object.keys(api.refinementSession).sort(),
    legacyRuntimeExports
  );
  for (const exportName of legacyRuntimeExports) {
    assert.equal(Object.hasOwn(api, exportName), true, exportName);
    assert.strictEqual(api[exportName], publicRefinementSession[exportName]);
    assert.strictEqual(
      api.refinementSession[exportName],
      publicRefinementSession[exportName]
    );
  }

  assert.equal(
    Object.hasOwn(api, "planRefinementSessionHistoryTransaction"),
    false
  );
  assert.equal(
    Object.hasOwn(
      api.refinementSession,
      "planRefinementSessionHistoryTransaction"
    ),
    false
  );
  assert.equal(
    typeof planRefinementSessionHistoryTransaction,
    "function"
  );
  assert.equal(
    Object.hasOwn(api, "TransitionHistoryComponent"),
    false
  );
  assert.equal(
    Object.hasOwn(
      api.refinementHistory,
      "TransitionHistoryComponent"
    ),
    false
  );
});

test("flat build preview refine and Hex entries reject invalid explicit merge tolerances", () => {
  const mesh = createHexUnitCubeMesh(1, 1, 1);
  mesh.data = {
    source: "invalid-merge-tolerance",
    nested: { stable: true }
  };
  const snapshot = structuredClone(mesh);
  const box = {
    min: [-1, -1, -1],
    max: [2, 2, 2]
  };
  const options = {
    hexRefinementRatio: 2,
    includeTransitions: false,
    regularizeHexSelection: false
  };
  const entries = [
    ["build default plan", (value) => buildDefaultRefinementPlan(mesh, [1], value)],
    ["build default replacements", (value) => buildDefaultRefinementReplacements(mesh, [1], value)],
    ["build Hex plan", (value) => buildHexClassifiedPlan(mesh, [1], value)],
    ["build Hex replacements", (value) => buildHexClassifiedReplacements(mesh, [1], value)],
    ["build replacements", (value) => buildRefinementReplacements(mesh, [1], value)],
    ["plan 2:1", (value) => planTwoToOneHexRefinement(mesh, [1], {
      ...value,
      includeTransitions: true
    })],
    ["preview ids", (value) => previewRefinementByElementIds(mesh, [1], value)],
    ["preview box", (value) => previewRefinementByBox(mesh, box, value)],
    ["preview distance", (value) => previewRefinementByDistanceFunction(mesh, () => -1, 0, value)],
    ["preview Hex ids", (value) => previewHexRefinementByElementIds(mesh, [1], value)],
    ["preview Hex box", (value) => api.previewHexRefinementByBox(mesh, box, value)],
    ["preview Hex distance", (value) => api.previewHexRefinementByDistanceFunction(mesh, () => -1, 0, value)],
    ["preview Hex candidates", (value) => api.previewHexCandidateIds(mesh, [1], value)],
    ["refine ids", (value) => refineByElementIds(mesh, [1], value)],
    ["refine ids report", (value) => refineByElementIdsWithReport(mesh, [1], value)],
    ["refine box", (value) => refineByBox(mesh, box, value)],
    ["refine box report", (value) => refineByBoxWithReport(mesh, box, value)],
    ["refine distance", (value) => api.refineByDistanceFunction(mesh, () => -1, 0, value)],
    ["refine distance report", (value) => refineByDistanceFunctionWithReport(mesh, () => -1, 0, value)],
    ["refine Hex ids", (value) => api.refineHexByElementIds(mesh, [1], value)],
    ["refine Hex ids report", (value) => refineHexByElementIdsWithReport(mesh, [1], value)],
    ["refine Hex box", (value) => api.refineHexByBox(mesh, box, value)],
    ["refine Hex box report", (value) => api.refineHexByBoxWithReport(mesh, box, value)],
    ["refine Hex distance", (value) => api.refineHexByDistanceFunction(mesh, () => -1, 0, value)],
    ["refine Hex distance report", (value) => api.refineHexByDistanceFunctionWithReport(mesh, () => -1, 0, value)],
    ["refine Hex candidates", (value) => api.refineHexCandidateIdsWithReport(mesh, [1], value)]
  ];

  for (const mergeTolerance of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1
  ]) {
    for (const [name, invoke] of entries) {
      const error = captureError(() => invoke({
        ...options,
        mergeTolerance
      }));
      assert.equal(error instanceof RangeError, true, `${name}:${mergeTolerance}`);
      assert.equal(error instanceof TwoToOnePlanningError, false, name);
      assert.match(error.message, /mergeTolerance must be finite and nonnegative/);
      assert.deepEqual(mesh, snapshot);
    }
  }

  for (const [name, invoke] of entries) {
    const error = captureError(() => invoke({
      ...options,
      mergeTolerance: "0"
    }));
    assert.equal(error instanceof TypeError, true, name);
    assert.equal(error instanceof TwoToOnePlanningError, false, name);
    assert.deepEqual(mesh, snapshot);
  }
});

test("flat merge tolerance enforces the unmerged final edge resolution limit", () => {
  const mesh = createHexUnitCubeMesh(1, 1, 1);
  mesh.data = { source: "merge-edge-limit" };
  const snapshot = structuredClone(mesh);
  const options = {
    hexRefinementRatio: 2,
    includeTransitions: false,
    regularizeHexSelection: false
  };
  const mergedEntries = [
    ["preview", (mergeTolerance) => previewRefinementByElementIds(mesh, [1], {
      ...options,
      mergeTolerance
    })],
    ["preview Hex", (mergeTolerance) => previewHexRefinementByElementIds(mesh, [1], {
      ...options,
      mergeTolerance
    })],
    ["refine", (mergeTolerance) => refineByElementIdsWithReport(mesh, [1], {
      ...options,
      mergeTolerance
    })],
    ["refine Hex", (mergeTolerance) => refineHexByElementIdsWithReport(mesh, [1], {
      ...options,
      mergeTolerance
    })]
  ];

  for (const mergeTolerance of [0.5, 0.25]) {
    for (const [name, invoke] of mergedEntries) {
      const error = captureError(() => invoke(mergeTolerance));
      assert.equal(error instanceof RangeError, true, `${name}:${mergeTolerance}`);
      assert.match(error.message, /less than half.*final.*edge/i);
      assert.deepEqual(mesh, snapshot);
    }
  }

  for (const mergeTolerance of [0, 0.25 - Number.EPSILON]) {
    const preview = mergedEntries[0][1](mergeTolerance);
    const result = mergedEntries[2][1](mergeTolerance);
    const hexPreview = mergedEntries[1][1](mergeTolerance);
    const hexResult = mergedEntries[3][1](mergeTolerance);
    assert.equal(preview.quality.ok, true);
    assert.deepEqual(preview.quality, result.quality);
    assert.deepEqual(hexPreview.quality, hexResult.quality);
    assert.deepEqual(hexResult.quality, result.quality);
    assert.equal(
      result.mesh.elements.every((element) => new Set(element).size === 8),
      true
    );
    assert.deepEqual(mesh, snapshot);
  }
});

test("flat 2:1 preview and refine audit the merged final Hex mesh", () => {
  const options = {
    hexRefinementRatio: 2,
    includeTransitions: false,
    regularizeHexSelection: false,
    mergeTolerance: 0.11
  };
  for (const entry of [
    previewRefinementByElementIds,
    previewHexRefinementByElementIds,
    refineByElementIdsWithReport,
    refineHexByElementIdsWithReport
  ]) {
    const mesh = createMergeCollapsedHexMesh();
    const snapshot = structuredClone(mesh);
    const error = captureError(() => entry(mesh, [1], options));

    assert.equal(error instanceof TwoToOnePlanningError, true, entry.name);
    assert.equal(error.code, "TWO_TO_ONE_CHILD_JACOBIAN");
    assert.match(error.message, /merged final Hex|distinct node ids/i);
    assert.deepEqual(error.diagnostic.conflictingCellIds, [1]);
    assert.deepEqual(mesh, snapshot);
  }
});

test("final merged Hex quality rejects nonfinite volume reports structurally and atomically", () => {
  const options = {
    hexRefinementRatio: 2,
    includeTransitions: false,
    regularizeHexSelection: false
  };
  for (const scale of [1e103, 1e200]) {
    for (const entry of [
      previewRefinementByElementIds,
      previewHexRefinementByElementIds,
      refineByElementIdsWithReport,
      refineHexByElementIdsWithReport
    ]) {
      const mesh = createScaledHexMesh(scale);
      const snapshot = structuredClone(mesh);
      const error = captureError(() => entry(mesh, [1], options));

      assert.equal(error instanceof TwoToOnePlanningError, true, `${entry.name}:${scale}`);
      assert.equal(error.code, "TWO_TO_ONE_VOLUME");
      assert.match(error.message, /nonfinite|non-finite|finite.*volume/i);
      assert.equal(Object.isFrozen(error.diagnostic), true);
      assert.deepEqual(error.diagnostic.conflictingCellIds, [1]);
      assert.deepEqual(mesh, snapshot);
    }
  }
});

test("edge resolution and default merge tolerance remain stable at extreme scales", () => {
  for (const scale of [1e200, 1e-200]) {
    const mesh = createScaledHexMesh(scale);
    const edge = minElementEdgeLength(mesh);
    const nonzeroEdge = minNonzeroElementEdgeLength(mesh);

    assert.equal(Number.isFinite(edge), true, `finite edge:${scale}`);
    assert.equal(edge > 0, true, `positive edge:${scale}`);
    assert.equal(edge, nonzeroEdge);
    assert.equal(Math.abs(edge / scale - 1) < 1e-12, true);

    if (scale === 1e-200) {
      for (const entry of [
        previewRefinementByElementIds,
        previewHexRefinementByElementIds,
        refineByElementIdsWithReport,
        refineHexByElementIdsWithReport
      ]) {
        const snapshot = structuredClone(mesh);
        const result = entry(mesh, [1], {
          hexRefinementRatio: 2,
          includeTransitions: false,
          regularizeHexSelection: false
        });
        assert.equal(result.quality.ok, true, entry.name);
        for (const value of [
          result.quality.parentOrientedVolume,
          result.quality.childOrientedVolume,
          result.quality.relativeVolumeError,
          result.quality.parentMinimumOrientedScaledJacobian,
          result.quality.childMinimumOrientedScaledJacobian
        ]) {
          assert.equal(Number.isFinite(value), true, `${entry.name}:${value}`);
        }
        assert.deepEqual(mesh, snapshot);
      }
    }
  }
});

test("indistinguishable element geometry is rejected explicitly", () => {
  const mesh = createScaledHexMesh(0);
  const snapshot = structuredClone(mesh);
  assert.equal(minElementEdgeLength(mesh), 0);
  assert.equal(minNonzeroElementEdgeLength(mesh), Number.POSITIVE_INFINITY);

  for (const entry of [mergeCoincidentNodes, mergeCoincidentNodesWithMap]) {
    const error = captureError(() => entry(mesh, 0));
    assert.equal(error instanceof RangeError, true, entry.name);
    assert.match(
      error.message,
      /zero-length Hex element edge|no distinguishable nonzero element edge/i
    );
  }

  const session = createRefinementSession(mesh);
  const before = structuredClone(session);
  for (const entry of [
    () => buildActiveMesh(session, { mergeNodes: true }),
    () => buildActiveMeshWithMap(session, { mergeNodes: true })
  ]) {
    const error = captureError(entry);
    assert.equal(error instanceof RangeError, true);
    assert.match(
      error.message,
      /zero-length Hex element edge|no distinguishable nonzero element edge/i
    );
    assert.deepEqual(session, before);
  }

  const error = captureError(() => previewRefinementByElementIds(mesh, [1], {
    hexRefinementRatio: 2,
    includeTransitions: false,
    regularizeHexSelection: false
  }));
  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_PARENT_JACOBIAN");
  assert.deepEqual(mesh, snapshot);
});

test("partial zero Hex edges are never hidden by the nonzero edge threshold", () => {
  const mesh = createSevenDistinctNodeHexMesh();
  const snapshot = structuredClone(mesh);
  assert.equal(minElementEdgeLength(mesh), 0);
  assert.equal(Number.isFinite(minNonzeroElementEdgeLength(mesh)), true);

  for (const entry of [mergeCoincidentNodes, mergeCoincidentNodesWithMap]) {
    const error = captureError(() => entry(mesh, 0));
    assert.equal(error instanceof RangeError, true, entry.name);
    assert.match(error.message, /zero-length Hex element edge/i);
    assert.deepEqual(mesh, snapshot);
  }

  const flatError = captureError(() => previewRefinementByElementIds(
    mesh,
    [1],
    {
      hexRefinementRatio: 3,
      includeTransitions: false,
      regularizeHexSelection: false
    }
  ));
  assert.equal(flatError instanceof RangeError, true);
  assert.match(flatError.message, /zero-length Hex element edge/i);
  assert.deepEqual(mesh, snapshot);

  for (const operation of ["build", "refine"]) {
    const session = createRefinementSession(mesh);
    const before = structuredClone(session);
    const error = captureError(() => operation === "build"
      ? buildActiveMesh(session, { mergeNodes: true, mergeTolerance: 0 })
      : refineSessionCell(session, "e1", refineHexTo27Hex));
    assert.equal(
      error instanceof RangeError || error instanceof HexPatchQualityError,
      true,
      operation
    );
    assert.deepEqual(session, before);
  }
});

test("low-level node merging requires a finite nonnegative tolerance", () => {
  const mesh = createHexUnitCubeMesh(1, 1, 1);
  const snapshot = structuredClone(mesh);
  for (const entry of [mergeCoincidentNodes, mergeCoincidentNodesWithMap]) {
    const missing = captureError(() => entry(mesh, undefined));
    assert.equal(missing instanceof TypeError, true, entry.name);
    assert.match(missing.message, /tolerance.*required|must be a number/i);
    for (const tolerance of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1
    ]) {
      const error = captureError(() => entry(mesh, tolerance));
      assert.equal(error instanceof RangeError, true, `${entry.name}:${tolerance}`);
      assert.match(error.message, /finite and nonnegative/);
    }
  }
  assert.deepEqual(mesh, snapshot);
});

test("session active mesh merging enforces the unmerged active edge limit", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const before = structuredClone(session);
  for (const mergeTolerance of [0, 0.5 - Number.EPSILON]) {
    const build = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance
    });
    assert.equal(build.mesh.elements.length, 1);
    assert.equal(new Set(build.mesh.elements[0]).size, 8);
    assert.deepEqual(session, before);
  }
  for (const mergeTolerance of [0.5, 0.5 + Number.EPSILON]) {
    for (const entry of [
      () => buildActiveMesh(session, { mergeNodes: true, mergeTolerance }),
      () => buildActiveMeshWithMap(session, { mergeNodes: true, mergeTolerance }),
      () => previewSessionPatch(session, ["e1"], {
        hexRefinementRatio: 2,
        includeTransitions: false,
        mergeTolerance
      }),
      () => refineSessionPatch(session, ["e1"], {
        hexRefinementRatio: 2,
        includeTransitions: false,
        mergeTolerance
      })
    ]) {
      const error = captureError(entry);
      assert.equal(error instanceof RangeError, true, `${mergeTolerance}`);
      assert.match(error.message, /less than half.*edge/i);
      assert.deepEqual(session, before);
    }
  }

  const unmerged = buildActiveMesh(session, {
    mergeNodes: false,
    mergeTolerance: 1
  });
  assert.equal(unmerged.elements.length, 1);
  assert.deepEqual(session, before);
});

test("session default and explicit merge tolerances remain stable at extreme scales", () => {
  for (const scale of [1e200, 1e-200]) {
    const session = createRefinementSession(createScaledHexMesh(scale));
    const before = structuredClone(session);
    for (const options of [
      { mergeNodes: true },
      { mergeNodes: true, mergeTolerance: scale * 1e-4 }
    ]) {
      const build = buildActiveMeshWithMap(session, options);
      assert.equal(build.mesh.elements.length, 1);
      assert.equal(new Set(build.mesh.elements[0]).size, 8);
      assert.deepEqual(session, before);
    }
  }
});

test("extreme anisotropic node buckets merge duplicate Hex geometry correctly", () => {
  const vertices = createAnisotropicHexVertices(1e200, 1e-200, 1e-200)
    .map(([x, y, z]) => [x - 1e200, y, z]);
  const mesh = {
    kind: "H1",
    nodes: [
      ...vertices.map((point) => [...point]),
      ...vertices.map((point) => [...point])
    ],
    elements: [
      [1, 2, 3, 4, 5, 6, 7, 8],
      [9, 10, 11, 12, 13, 14, 15, 16]
    ]
  };
  const tolerance = 1e-202;
  const merged = mergeCoincidentNodesWithMap(mesh, tolerance);
  assert.equal(merged.mesh.nodes.length, 8);
  assert.deepEqual(merged.mesh.elements[0], merged.mesh.elements[1]);

  const session = createRefinementSession(mesh);
  const before = structuredClone(session);
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: tolerance
  });
  assert.equal(active.mesh.nodes.length, 8);
  assert.deepEqual(active.mesh.elements[0], active.mesh.elements[1]);
  assert.deepEqual(session, before);
});

test("merge buckets use one stable axis mode near MAX_SAFE_INTEGER", () => {
  for (const reverse of [false, true]) {
    const mesh = createNearMaxSafeDuplicateQuadMesh(reverse);
    const snapshot = structuredClone(mesh);
    const merged = mergeCoincidentNodesWithMap(mesh, 1);

    assert.equal(merged.mesh.nodes.length, 4, `${reverse}`);
    assert.deepEqual(merged.mesh.elements[0], merged.mesh.elements[1]);
    assert.deepEqual(mesh, snapshot);

    const session = createRefinementSession(mesh);
    const before = structuredClone(session);
    const active = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance: 1
    });
    assert.equal(active.mesh.nodes.length, 4, `${reverse}`);
    assert.deepEqual(active.mesh.elements[0], active.mesh.elements[1]);
    assert.deepEqual(session, before);
  }
});

test("BigInt merge buckets preserve neighbors and negative floor boundaries", () => {
  const layout = createMergeBucketLayout([
    [-1e308, 0],
    [1e308, 0]
  ], 1);
  for (const [first, second] of [
    [[0.75, 0], [1.25, 0]],
    [[-1.25, 0], [-0.75, 0]],
    [[-1, 0], [0, 0]]
  ]) {
    const candidates = [];
    forEachCandidateMergeBucketKey(second, layout, (key) => {
      candidates.push(key);
    });
    assert.equal(candidates.includes(mergeBucketKey(first, layout)), true);

    for (const reverse of [false, true]) {
      const pair = reverse ? [second, first] : [first, second];
      const merged = mergeCoincidentNodesWithMap({
        kind: "Q1",
        nodes: [
          [-1e308, 100],
          ...pair.map((point) => [...point]),
          [1e308, 100]
        ],
        elements: []
      }, 1);
      assert.equal(merged.mesh.nodes.length, 3, `${first}:${second}:${reverse}`);
    }
  }
  assert.equal(mergeBucketKey([-1.25, 0], layout).startsWith("b-2:"), true);
  assert.equal(mergeBucketKey([-1, 0], layout).startsWith("b-1:"), true);
  assert.equal(mergeBucketKey([0, 0], layout).startsWith("b0:"), true);
  assert.equal(mergeBucketKey([1, 0], layout).startsWith("b1:"), true);
});

test("session explicit-tolerance merging preserves point dimensions", () => {
  const mesh = {
    kind: "Q1",
    nodes: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [0, 0, 0],
      [4, 0, 0],
      [4, 4, 0],
      [0, 4, 0]
    ],
    elements: [
      [1, 2, 3, 4],
      [5, 6, 7, 8]
    ]
  };
  const snapshot = structuredClone(mesh);
  const lowLevel = mergeCoincidentNodesWithMap(mesh, 0.25);
  assert.equal(lowLevel.mesh.nodes.length, 8);

  const session = createRefinementSession(mesh);
  const before = structuredClone(session);
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 0.25
  });
  assert.equal(active.mesh.nodes.length, lowLevel.mesh.nodes.length);
  assert.deepEqual(active.mesh.elements, lowLevel.mesh.elements);
  assert.deepEqual(mesh, snapshot);
  assert.deepEqual(session, before);
});

test("exact node merging keeps coincident 3D and 4D Q1 nodes distinct", () => {
  const mesh = {
    kind: "Q1",
    nodes: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 0, 7],
      [1, 0, 0, 7],
      [1, 1, 0, 7],
      [0, 1, 0, 7]
    ],
    elements: [
      [1, 2, 3, 4],
      [5, 6, 7, 8]
    ]
  };
  const snapshot = structuredClone(mesh);

  const merged = mergeCoincidentNodesWithMap(mesh, 0);

  assert.equal(merged.mesh.nodes.length, 8);
  assert.deepEqual(merged.mesh.elements, mesh.elements);
  const session = createRefinementSession(mesh);
  const before = structuredClone(session);
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 0
  });
  assert.equal(active.mesh.nodes.length, 8);
  assert.deepEqual(active.mesh.elements, mesh.elements);
  assert.deepEqual(mesh, snapshot);
  assert.deepEqual(session, before);
});

test("exact node merging compares every coordinate of 4D Q1 nodes", () => {
  const mesh = {
    kind: "Q1",
    nodes: [
      [0, 0, 0, 7],
      [1, 0, 0, 7],
      [1, 1, 0, 7],
      [0, 1, 0, 7],
      [0, 0, 0, 8],
      [1, 0, 0, 8],
      [1, 1, 0, 8],
      [0, 1, 0, 8]
    ],
    elements: [
      [1, 2, 3, 4],
      [5, 6, 7, 8]
    ]
  };
  const snapshot = structuredClone(mesh);

  const merged = mergeCoincidentNodesWithMap(mesh, 0);
  const session = createRefinementSession(mesh);
  const before = structuredClone(session);
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 0
  });

  assert.equal(merged.mesh.nodes.length, 8);
  assert.deepEqual(merged.mesh.elements, mesh.elements);
  assert.equal(active.mesh.nodes.length, 8);
  assert.deepEqual(active.mesh.elements, mesh.elements);
  assert.deepEqual(mesh, snapshot);
  assert.deepEqual(session, before);
});

test("node merging rejects empty unreferenced coordinate arrays", () => {
  const mesh = {
    kind: "Q1",
    nodes: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      []
    ],
    elements: [[1, 2, 3, 4]]
  };
  const snapshot = structuredClone(mesh);
  const error = captureError(() => mergeCoincidentNodesWithMap(mesh, 0));

  assert.equal(error instanceof Error, true);
  assert.match(error.message, /node id 5/i);
  assert.match(error.message, /coordinates must be a non-empty array/i);
  assert.deepEqual(mesh, snapshot);
});

for (const [label, coordinate] of [
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["-Infinity", Number.NEGATIVE_INFINITY]
]) {
  test(`node merging rejects unreferenced ${label} coordinates before merge inspection`, () => {
    const mesh = {
      kind: "Q1",
      nodes: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [coordinate, 2]
      ],
      elements: [[1, 2, 3, 4]]
    };
    const snapshot = structuredClone(mesh);
    const error = captureError(() => mergeCoincidentNodesWithMap(mesh, 0));

    assert.equal(error instanceof Error, true);
    assert.match(error.message, /node id 5/i);
    assert.match(error.message, /axis 0/i);
    assert.deepEqual(mesh, snapshot);
  });
}

for (const tolerance of [0, 0.1]) {
  test(`node merging rejects sparse outer nodes before edge inspection at tolerance ${tolerance}`, () => {
    const nodes = createHexUnitCubeMesh(1, 1, 1).nodes.map((point) => [...point]);
    nodes.length = 9;
    const mesh = {
      kind: "H1",
      nodes,
      elements: [[1, 1, 1, 1, 1, 1, 1, 1]]
    };
    const snapshot = structuredClone(mesh);

    const error = captureError(() =>
      mergeCoincidentNodesWithMap(mesh, tolerance)
    );

    assert.equal(
      error.message,
      "mesh node id 9 coordinates must be a non-empty array"
    );
    assert.deepEqual(mesh, snapshot);
  });
}

test("final conformance failures use structured conformance diagnostics", () => {
  const options = {
    hexRefinementRatio: 2,
    includeTransitions: true,
    regularizeHexSelection: false,
    mergeTolerance: 0
  };
  for (const entry of [
    previewRefinementByElementIds,
    previewHexRefinementByElementIds,
    refineByElementIdsWithReport,
    refineHexByElementIdsWithReport
  ]) {
    const mesh = createNearlyTouchingHexMesh();
    const snapshot = structuredClone(mesh);
    const error = captureError(() => entry(mesh, [1, 2], options));

    assert.equal(error instanceof TwoToOnePlanningError, true, entry.name);
    assert.equal(error.code, "TWO_TO_ONE_CONFORMANCE");
    assert.deepEqual(error.diagnostic.conflictingCellIds, [1, 2]);
    assert.equal(error.diagnostic.conflictingInterfaces.length > 0, true);
    for (const diagnostic of error.diagnostic.conflictingInterfaces) {
      assert.equal([1, 2].includes(diagnostic.firstCellId), true);
      assert.equal([1, 2].includes(diagnostic.secondCellId), true);
      assert.equal(diagnostic.faceNodeIds.length, 4);
      assert.equal(Object.isFrozen(diagnostic.faceNodeIds), true);
      assert.equal(Object.isFrozen(diagnostic), true);
    }
    assert.equal(Object.isFrozen(error.diagnostic), true);
    assert.throws(
      () => error.diagnostic.conflictingInterfaces[0].faceNodeIds.push(99),
      TypeError
    );
    assert.deepEqual(mesh, snapshot);
  }
});

test("session preflight planning diagnostics are cloned and deeply frozen", () => {
  for (const operation of ["preview", "refine"]) {
    const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
    const active = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance: 1e-6
    });
    const before = structuredClone(session);
    const invoke = operation === "preview"
      ? () => previewSessionPatch(session, ["e1"], {
          includeTransitions: false,
          mergeTolerance: 1e-8,
          activeBuild: active
        })
      : () => refineSessionPatch(session, ["e1"], {
          includeTransitions: false,
          mergeTolerance: 1e-8,
          activeBuild: active
        });
    const error = captureError(invoke);

    assertFrozenPlanningDiagnostic(error);
    assert.deepEqual(error.diagnostic.conflictingCellIds, ["e1"]);
    assert.deepEqual(error.diagnostic.suggestion, { kind: "remesh-source" });
    assert.deepEqual(session, before);
  }

  const source = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const build = structuredClone(buildActiveMeshWithMap(source, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  }));
  const other = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const validatorError = captureError(() =>
    api.validateActiveBuildForSession(other, build)
  );
  assertFrozenPlanningDiagnostic(validatorError);
  assert.deepEqual(validatorError.diagnostic.conflictingCellIds, []);
  assert.deepEqual(validatorError.diagnostic.suggestion, {
    kind: "remesh-source"
  });
});

test("ordinary local sweep invariant errors escape flat and session boundaries unchanged", () => {
  const flatMesh = createFourDimensionalLocalSweepMesh();
  const flatSnapshot = structuredClone(flatMesh);
  const selectedElementId = elementIdAt(5, 5, 5, 2, 2, 2);
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    regularizeHexSelection: false
  };
  for (const entry of [
    buildHexClassifiedPlan,
    buildDefaultRefinementPlan,
    buildHexClassifiedReplacements,
    buildDefaultRefinementReplacements,
    buildRefinementReplacements,
    previewRefinementByElementIds,
    previewHexRefinementByElementIds,
    refineByElementIdsWithReport,
    refineHexByElementIdsWithReport
  ]) {
    const error = captureError(() =>
      entry(flatMesh, [selectedElementId], options)
    );
    assert.equal(error.constructor, Error, entry.name);
    assert.equal(error instanceof TwoToOnePlanningError, false, entry.name);
    assert.equal(
      error.message,
      "local 2:1 sweep entity vertex:80 maps inconsistently"
    );
    assert.deepEqual(flatMesh, flatSnapshot);
  }

  for (const operation of ["preview", "refine"]) {
    const session = createRefinementSession(
      createFourDimensionalLocalSweepMesh()
    );
    const active = buildActiveMeshWithMap(session);
    const cellId = activeBuildCellIdByElementId(active, selectedElementId);
    const before = structuredClone(session);
    const invoke = operation === "preview"
      ? () => previewSessionPatch(session, [cellId], {
          ...options,
          activeBuild: active
        })
      : () => refineSessionPatch(session, [cellId], {
          ...options,
          activeBuild: active
        });
    const error = captureError(invoke);

    assert.equal(error.constructor, Error, operation);
    assert.equal(error instanceof TwoToOnePlanningError, false, operation);
    assert.equal(
      error.message,
      "local 2:1 sweep entity vertex:75 maps inconsistently"
    );
    assert.deepEqual(session, before);
  }
});

test("strict and non-strict replay both propagate programming errors", () => {
  for (const strict of [true, false]) {
    const programmingError = new Error(
      `programming option getter failed:${strict}`
    );
    const script = twoToOneCompensationReplayScript({
      get mode() {
        throw programmingError;
      }
    });
    const error = captureError(() =>
      replayHexRefineCommandScript(script, { strict })
    );

    assert.equal(error, programmingError);
    assert.equal(error instanceof TwoToOnePlanningError, false);
  }
});

test("Hex 2:1 entry points reject invalid ids as topology without mutation", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 2);
  mesh.data = {
    source: "structured-rejection-snapshot",
    materialIds: Array.from({ length: mesh.elements.length }, (_, index) => index + 1)
  };
  const snapshot = structuredClone(mesh);
  const invalidElementIds = [0, mesh.elements.length + 1, Number.NaN, 1.5];

  for (const includeTransitions of [true, false]) {
    for (const invalidElementId of invalidElementIds) {
      for (const entry of [
        buildHexClassifiedPlan,
        buildDefaultRefinementPlan,
        buildHexClassifiedReplacements,
        buildDefaultRefinementReplacements,
        buildRefinementReplacements,
        previewRefinementByElementIds,
        previewHexRefinementByElementIds,
        refineByElementIdsWithReport,
        refineHexByElementIdsWithReport
      ]) {
        const error = captureError(() => entry(
          mesh,
          [invalidElementId],
          {
            hexRefinementRatio: 2,
            includeTransitions,
            regularizeHexSelection: false
          }
        ));
        assert.equal(error instanceof TwoToOnePlanningError, true);
        assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
        assert.equal(error.diagnostic.conflictingCellIds.length, 1);
        assert.equal(
          Object.is(
            error.diagnostic.conflictingCellIds[0],
            invalidElementId
          ),
          true
        );
        assert.deepEqual(error.diagnostic.attemptedActions, []);
        assert.deepEqual(error.diagnostic.suggestion, {
          kind: "remesh-source"
        });
      }
    }
  }

  for (const entry of [
    buildDirectTwoToOneHexPlan,
    buildTwoToOneHexReplacements,
    twoToOneSweepModule.tryBuildLocalTwoToOneHexReplacements
  ]) {
    const error = captureError(() => entry(mesh, [0]));
    assert.equal(error instanceof DirectTwoToOnePlanningError, true);
    assert.equal(error.kind, "topology");
    assert.deepEqual(error.conflictingElementIds, [0]);
  }
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
  assert.deepEqual(error.conflictingElementIds, [13, 14, 15]);
  assert.deepEqual(mesh, snapshot);
});

test("Hex 2:1 solver valence errors retain every owner of the first conflict", () => {
  const mesh = createButterflyOgridBar(3);
  const snapshot = structuredClone(mesh);
  const error = captureError(() =>
    buildDirectTwoToOneHexPlan(mesh, [2, 4, 5])
  );

  assert.equal(error instanceof DirectTwoToOnePlanningError, true);
  assert.equal(error.kind, "valence");
  assert.deepEqual(error.conflictingElementIds, [1, 2, 4, 5]);
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

test("refinement command recipe snapshots immutable replay inputs across history paths", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(3, 3, 3));
  const activeBuild = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const selectedCellId = activeBuildCellIdByElementId(
    activeBuild,
    elementIdAt(3, 3, 3, 1, 1, 1)
  );
  assert.ok(selectedCellId);
  const selectedCellIds = [selectedCellId, selectedCellId];
  const transitionSupportCellIds = ["e3", "e1", "e3"];
  const compensationValues = {
    mode: "local-topology",
    maxAddedParentLayers: 1,
    maxAddedParentCount: 32
  };
  const compensationReads = {
    mode: 0,
    maxAddedParentLayers: 0,
    maxAddedParentCount: 0
  };
  const compensation = {};
  for (const key of Object.keys(compensationValues)) {
    Object.defineProperty(compensation, key, {
      enumerable: true,
      get() {
        compensationReads[key] += 1;
        return compensationValues[key];
      },
      set(value) {
        compensationValues[key] = value;
      }
    });
  }
  const options = {
    includeTransitions: true,
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    hexTwoToOneCompensation: compensation,
    rebuildExistingTransitions: true,
    transitionSupportCellIds,
    mergeTolerance: 1e-9,
    activeBuild
  };

  const command = refineSessionPatch(session, selectedCellIds, options);
  assert.deepEqual(compensationReads, {
    mode: 1,
    maxAddedParentLayers: 1,
    maxAddedParentCount: 1
  });
  assert.equal(command.recipe.version, 1);
  assert.deepEqual(command.recipe.selectedCellIds, [selectedCellId]);
  assert.equal(command.recipe.selectedCellGeometry.length, 1);
  assert.equal(command.recipe.selectedCellGeometry[0].points.length, 8);
  assert.deepEqual(command.recipe.transitionSupportCellIds, ["e1", "e3"]);
  assert.deepEqual(
    command.recipe.transitionSupportCellGeometry.map(
      (geometry) => geometry.originalCellId
    ),
    ["e1", "e3"]
  );
  assert.deepEqual(Object.keys(command.recipe.options).sort(), [
    "hexRefinementRatio",
    "hexTwoToOneCompensation",
    "hexTwoToOneSelectionMode",
    "includeTransitions",
    "mergeTolerance",
    "rebuildExistingTransitions"
  ]);
  assert.equal(Object.hasOwn(command.recipe.options, "activeBuild"), false);
  assert.equal(
    Object.hasOwn(command.recipe.options, "transitionSupportCellIds"),
    false
  );
  assert.equal(
    Object.hasOwn(command.recipe.options, "normalizedTwoToOneCompensation"),
    false
  );
  assert.deepEqual(command.recipe.options, {
    includeTransitions: true,
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    hexTwoToOneCompensation: {
      mode: "local-topology",
      maxAddedParentLayers: 1,
      maxAddedParentCount: 32
    },
    rebuildExistingTransitions: true,
    mergeTolerance: 1e-9
  });
  assertFrozenRecipe(command.recipe);

  selectedCellIds.push("mutated-selected");
  transitionSupportCellIds[0] = "mutated-support";
  compensation.mode = "none";
  compensation.maxAddedParentLayers = 99;
  options.includeTransitions = false;
  options.hexRefinementRatio = 3;
  assert.deepEqual(command.recipe.selectedCellIds, [selectedCellId]);
  assert.deepEqual(command.recipe.transitionSupportCellIds, ["e1", "e3"]);
  assert.equal(command.recipe.options.includeTransitions, true);
  assert.equal(command.recipe.options.hexRefinementRatio, 2);
  assert.deepEqual(command.recipe.options.hexTwoToOneCompensation, {
    mode: "local-topology",
    maxAddedParentLayers: 1,
    maxAddedParentCount: 32
  });
  assert.deepEqual(compensationReads, {
    mode: 1,
    maxAddedParentLayers: 1,
    maxAddedParentCount: 1
  });

  const clonedCommand = cloneRefinementSessionCommand(command);
  assert.deepEqual(clonedCommand.recipe, command.recipe);
  assert.notStrictEqual(clonedCommand.recipe, command.recipe);
  assert.notStrictEqual(
    clonedCommand.recipe.selectedCellGeometry,
    command.recipe.selectedCellGeometry
  );
  assert.notStrictEqual(
    clonedCommand.recipe.selectedCellGeometry[0].points[0],
    command.recipe.selectedCellGeometry[0].points[0]
  );
  assert.notStrictEqual(
    clonedCommand.recipe.options,
    command.recipe.options
  );
  assertFrozenRecipe(clonedCommand.recipe);

  const structuredCommand = structuredClone(command);
  assert.deepEqual(structuredCommand.recipe, command.recipe);
  assert.notStrictEqual(structuredCommand.recipe, command.recipe);
  assert.notStrictEqual(
    structuredCommand.recipe.selectedCellGeometry[0].points[0],
    command.recipe.selectedCellGeometry[0].points[0]
  );
  const restoredStructuredCommand =
    cloneRefinementSessionCommand(structuredCommand);
  assertFrozenRecipe(restoredStructuredCommand.recipe);

  const structuredSession = structuredClone(session);
  const structuredSessionRecipe = structuredSession.undoStack[0].recipe;
  assert.deepEqual(structuredSessionRecipe, command.recipe);
  assert.notStrictEqual(structuredSessionRecipe, command.recipe);
  assert.notStrictEqual(
    structuredSessionRecipe.transitionSupportCellGeometry[0].points[0],
    command.recipe.transitionSupportCellGeometry[0].points[0]
  );
  assertFrozenRecipe(
    cloneRefinementSessionCommand(structuredSession.undoStack[0]).recipe
  );

  const undone = undoRefinementSession(session);
  assert.deepEqual(undone.recipe, command.recipe);
  assertFrozenRecipe(undone.recipe);
  const redone = redoRefinementSession(session);
  assert.deepEqual(redone.recipe, command.recipe);
  assertFrozenRecipe(redone.recipe);
});

test("refinement recipes reject inactive transition support atomically", () => {
  const session = createRefinementSession(
    createHexUnitCubeMesh(1, 1, 1)
  );
  const first = refineSessionPatch(session, ["e1"], {
    hexRefinementRatio: 2,
    includeTransitions: false
  });
  const selectedCellId = first.createdCellIds[0];
  assert.ok(selectedCellId);
  assert.equal(session.activeLeafIds.has("e1"), false);
  const before = structuredClone(session);
  const options = {
    hexRefinementRatio: 2,
    includeTransitions: false,
    transitionSupportCellIds: ["e1"]
  };

  for (const operation of [
    () => previewSessionPatch(session, [selectedCellId], options),
    () => refineSessionPatch(session, [selectedCellId], options)
  ]) {
    const error = captureError(operation);
    assert.equal(error instanceof TwoToOnePlanningError, true);
    assert.equal(error.code, "TWO_TO_ONE_HISTORY_CONFLICT");
    assert.deepEqual(error.diagnostic.conflictingCellIds, ["e1"]);
    assert.deepEqual(session, before);
  }
});

test("selection compensation command recipe replays through the public session API", () => {
  const sourceSession = createRefinementSession(
    createHexUnitCubeMesh(2, 2, 5)
  );
  const selectedCellIds = ["e5", "e6", "e7", "e8"];
  const compensationReads = {
    mode: 0,
    maxAddedParentLayers: 0,
    maxAddedParentCount: 0
  };
  const compensation = {};
  Object.defineProperties(compensation, {
    mode: {
      enumerable: true,
      get() {
        compensationReads.mode += 1;
        return "selection";
      }
    },
    maxAddedParentLayers: {
      enumerable: true,
      get() {
        compensationReads.maxAddedParentLayers += 1;
        return 1;
      }
    },
    maxAddedParentCount: {
      enumerable: true,
      get() {
        compensationReads.maxAddedParentCount += 1;
        return 32;
      }
    }
  });
  const sourceCommand = refineSessionPatch(
    sourceSession,
    selectedCellIds,
    {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      hexTwoToOneCompensation: compensation
    }
  );

  assert.equal(sourceCommand.twoToOne.status, "compensated");
  assert.deepEqual(sourceCommand.recipe.selectedCellIds, selectedCellIds);
  assert.deepEqual(compensationReads, {
    mode: 1,
    maxAddedParentLayers: 1,
    maxAddedParentCount: 1
  });

  const replaySession = createRefinementSession(
    createHexUnitCubeMesh(2, 2, 5)
  );
  const replayCommand = refineSessionPatch(
    replaySession,
    [...sourceCommand.recipe.selectedCellIds],
    sourceCommand.recipe.options
  );

  assert.equal(
    sourceCommand.recipe.options.rebuildExistingTransitions,
    true
  );
  assert.equal(replayCommand.twoToOne.status, "compensated");
  assert.deepEqual(replayCommand, sourceCommand);
  assert.deepEqual(
    buildActiveMeshWithMap(replaySession).mesh,
    buildActiveMeshWithMap(sourceSession).mesh
  );
  assert.deepEqual(compensationReads, {
    mode: 1,
    maxAddedParentLayers: 1,
    maxAddedParentCount: 1
  });
});

test("command recipes directly replay all normalized compensation modes", () => {
  for (const mode of ["local-topology", "selection", "none"]) {
    const sourceSession = createRefinementSession(
      createHexUnitCubeMesh(1, 1, 1)
    );
    const sourceCommand = refineSessionPatch(sourceSession, ["e1"], {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      hexTwoToOneCompensation: { mode }
    });

    assert.equal(
      sourceCommand.recipe.options.rebuildExistingTransitions,
      mode !== "none",
      mode
    );

    const replaySession = createRefinementSession(
      createHexUnitCubeMesh(1, 1, 1)
    );
    const replayCommand = refineSessionPatch(
      replaySession,
      [...sourceCommand.recipe.selectedCellIds],
      sourceCommand.recipe.options
    );

    assert.deepEqual(replayCommand, sourceCommand, mode);
    assert.deepEqual(
      buildActiveMeshWithMap(replaySession).mesh,
      buildActiveMeshWithMap(sourceSession).mesh,
      mode
    );
  }
});

test("generic session refinement factories do not attach replay recipes", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const command = refineSessionCells(session, ["e1"], refineHexTo8Hex);

  assert.equal(Object.hasOwn(command, "recipe"), false);
});

test("refinement command recipe survives internal session cloning", () => {
  const {
    session,
    firstRefined,
    candidate
  } = createTransitionShellRegressionFixture();
  const originalCommand = session.undoStack.at(-1);
  assert.ok(originalCommand?.recipe);
  const originalRecipe = originalCommand.recipe;

  const compoundCommand = refineSessionPatch(session, [candidate], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: firstRefined
  });
  const clonedHistoricalCommand = session.undoStack.find(
    (command) => command.id === originalCommand.id
  );

  assert.equal(compoundCommand.twoToOne.status, "compensated");
  assert.ok(compoundCommand.recipe);
  assert.ok(clonedHistoricalCommand?.recipe);
  assert.deepEqual(clonedHistoricalCommand.recipe, originalRecipe);
  assert.notStrictEqual(clonedHistoricalCommand, originalCommand);
  assert.notStrictEqual(clonedHistoricalCommand.recipe, originalRecipe);
  assert.notStrictEqual(
    clonedHistoricalCommand.recipe.selectedCellGeometry[0].points[0],
    originalRecipe.selectedCellGeometry[0].points[0]
  );
  assertFrozenRecipe(clonedHistoricalCommand.recipe);
  assertFrozenRecipe(compoundCommand.recipe);
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
    patchPreview.twoToOne.affectedComponentCellIds.length,
    affectedCellCount
  );
  assert.equal(affectedCellCount, 26);
  assert.equal(patchPreview.twoToOne.preservedFarFieldCellCount, 1145);
  assert.ok(patchPreview.twoToOne.preservedFarFieldCellCount >= 0);
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
  assert.equal(Object.isFrozen(command.twoToOne), true);
  assert.equal(Object.isFrozen(command.twoToOne.actions), true);
  assert.throws(() => command.twoToOne.actions.push({
    kind: "local-template",
    reason: "tampered",
    addedParentCellIds: [],
    replacedTransitionCellIds: []
  }), TypeError);
  assert.deepEqual(command.twoToOne, stableTwoToOne);
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

test("Hex 2:1 three-level history preserves transition shells through undo redo and replay", () => {
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
  assert.equal(
    command.twoToOne.effectiveSelectedCellIds.length,
    8
  );
  assert.equal(
    command.twoToOne.effectiveSelectedCellIds.every((cellId) => {
      const cell = session.cells.get(cellId);
      return cell?.active === true
        && cell.hidden === false
        && cell.level === 2
        && cell.role === "selected"
        && session.activeLeafIds.has(cellId);
    }),
    true
  );
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
  assert.equal(Object.isFrozen(command.twoToOne), true);
  assert.equal(Object.isFrozen(command.twoToOne.actions), true);
  assert.equal(Object.isFrozen(command.twoToOne.actions[0]), true);
  assert.equal(Object.isFrozen(command.twoToOne.actions[0].addedParentCellIds), true);
  assert.throws(() => {
    command.twoToOne.actions[0].reason = "tampered";
  }, TypeError);
  assert.throws(() => command.twoToOne.actions[0].addedParentCellIds.push("tampered"), TypeError);
  assert.deepEqual(command.twoToOne, stableTwoToOne);
  const conformanceBuild = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9,
    includeElementIdsByNodeId: true
  });
  const localConformance = checkRefinementSessionCommandConformance(
    session,
    command,
    1e-9,
    conformanceBuild
  );
  assert.equal(localConformance.seedCellIds.length, command.activeCreatedCellIds.length);
  assert.equal(localConformance.report.ok, true);
  const {
    activeCreatedCellIds: ignoredActiveCreatedCellIds,
    ...legacyCompoundCommand
  } = command;
  assert.ok(ignoredActiveCreatedCellIds.length > 0);
  const legacyConformance = checkRefinementSessionCommandConformance(
    session,
    legacyCompoundCommand,
    1e-9,
    conformanceBuild
  );
  assert.equal(legacyConformance.seedCellIds.length, command.activeCreatedCellIds.length);
  assert.equal(legacyConformance.report.ok, true);
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
  const thirdOptions = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: secondRefinedBuild
  };
  assert.equal(
    protectedFarFieldCellIds.every(
      (cellId) => session.activeLeafIds.has(cellId)
    ),
    true
  );
  const farFieldBefore = snapshotRefinementCells(
    session,
    protectedFarFieldCellIds
  );
  const thirdPreview = previewSessionPatch(
    session,
    [thirdLevelCandidate],
    thirdOptions
  );
  const affectedBefore = new Set(
    thirdPreview.twoToOne.affectedComponentCellIds
  );
  assert.ok(affectedBefore.size > 0);
  assert.ok(affectedBefore.size < session.activeLeafIds.size);
  assert.deepEqual(
    protectedFarFieldCellIds.filter(
      (cellId) => affectedBefore.has(cellId)
    ),
    []
  );
  const baseState = snapshotActiveRefinementState(session);
  const baseNodeCount = session.nodes.length;
  const baseUndoIds = session.undoStack.map((entry) => entry.id);
  const baseRevision = session.revision;
  const {
    resolvedOptions: thirdResolvedOptions,
    faceResolution: thirdFaceResolution
  } = createHistoryTransactionRequest(session);
  const thirdTransaction =
    planRefinementSessionHistoryTransaction(
      session,
      [thirdLevelCandidate],
      thirdResolvedOptions,
      thirdFaceResolution
    );
  assert.deepEqual(
    thirdTransaction.historyClosure.supportCommandIds,
    [command.id]
  );
  assert.equal(
    [
      ...thirdTransaction.historyClosure.supportCommandIds,
      ...thirdTransaction.historyClosure.downstreamCommandIds
    ].filter((commandId) => commandId === command.id).length,
    1
  );
  assert.equal(thirdTransaction.command.recipe?.version, 1);

  const thirdCommand = refineSessionPatch(session, [thirdLevelCandidate], {
    ...thirdOptions
  });
  const thirdRefined = buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const finalState = snapshotActiveRefinementState(session);
  const finalNodeCount = session.nodes.length;
  const finalUndoIds = session.undoStack.map((entry) => entry.id);
  let expectedRevision = baseRevision + 1;

  assert.ok(finalNodeCount > baseNodeCount);
  assert.equal(session.revision, expectedRevision);
  assert.equal(thirdCommand.recipe?.version, 1);
  assert.equal(thirdCommand.twoToOne.status, "compensated");
  assert.equal(
    thirdCommand.twoToOne.actions.some(
      (action) => action.kind === "transition-shell-rebuild"
    ),
    true
  );
  assert.deepEqual(
    thirdCommand.twoToOne,
    thirdTransaction.command.twoToOne
  );
  assert.equal(thirdCommand.quality?.ok, true);
  assert.equal(checkNoHangingNodes(thirdRefined, 1e-9).ok, true);
  assert.ok(Math.abs(hexMeshVolume(thirdRefined) - 1) < 1e-10);
  assert.ok(minimumCornerScaledJacobian(thirdRefined) > 0);
  assert.deepEqual(
    snapshotRefinementCells(session, protectedFarFieldCellIds),
    farFieldBefore
  );
  assert.equal(undoRefinementSession(session)?.id, thirdCommand.id);
  expectedRevision += 1;
  assert.equal(session.revision, expectedRevision);
  assert.equal(session.nodes.length, finalNodeCount);
  assert.deepEqual(snapshotActiveRefinementState(session), baseState);
  assert.deepEqual(
    session.undoStack.map((entry) => entry.id),
    baseUndoIds
  );
  assert.equal(session.redoStack.at(-1)?.id, thirdCommand.id);
  assert.equal(redoRefinementSession(session)?.id, thirdCommand.id);
  expectedRevision += 1;
  assert.equal(session.revision, expectedRevision);
  assert.equal(session.nodes.length, finalNodeCount);
  assert.deepEqual(snapshotActiveRefinementState(session), finalState);
  assert.deepEqual(
    session.undoStack.map((entry) => entry.id),
    finalUndoIds
  );
  assert.equal(session.redoStack.length, 0);

  assert.equal(undoRefinementSession(session)?.id, thirdCommand.id);
  expectedRevision += 1;
  assert.equal(session.revision, expectedRevision);
  assert.equal(session.nodes.length, finalNodeCount);
  assert.deepEqual(snapshotActiveRefinementState(session), baseState);
  assert.equal(redoRefinementSession(session)?.id, thirdCommand.id);
  expectedRevision += 1;
  assert.equal(session.revision, expectedRevision);
  assert.equal(session.nodes.length, finalNodeCount);
  assert.deepEqual(snapshotActiveRefinementState(session), finalState);

  const threeLevelReplayCommands = [
    ...replayCommands,
    {
      kind: "refine.patch",
      payload: {
        cellIds: [thirdLevelCandidate],
        options: {
          hexRefinementRatio: 2,
          hexTwoToOneSelectionMode: "local",
          includeTransitions: true,
          mergeTolerance: 1e-9
        }
      }
    }
  ];
  const firstThreeLevelReplay = replayHexRefineCommandScript({
    format: "hexrefine-command-script",
    version: 1,
    app: "HexRefine",
    commands: threeLevelReplayCommands
  });
  const secondThreeLevelReplay = replayHexRefineCommandScript({
    format: "hexrefine-command-script",
    version: 1,
    app: "HexRefine",
    commands: threeLevelReplayCommands
  });
  assert.deepEqual(firstThreeLevelReplay.warnings, []);
  assert.deepEqual(secondThreeLevelReplay.warnings, []);
  assert.deepEqual(firstThreeLevelReplay.mesh, thirdRefined);
  assert.deepEqual(
    firstThreeLevelReplay.mesh,
    secondThreeLevelReplay.mesh
  );
  assert.deepEqual(
    firstThreeLevelReplay.session.undoStack,
    secondThreeLevelReplay.session.undoStack
  );
  assert.equal(
    checkNoHangingNodes(firstThreeLevelReplay.mesh, 1e-9).ok,
    true
  );
});

test("Hex 2:1 transition-shell rebuilding recognizes near-coincident duplicate interface nodes", () => {
  const {
    session,
    candidate
  } = createTransitionShellRegressionFixture();
  const perturbedOwner = duplicateOneNearCoincidentNeighborFace(
    session,
    candidate
  );
  const perturbedParent = session.cells.get(perturbedOwner).parentId;
  assert.ok(perturbedParent);
  const perturbedActive = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-8
  });

  const command = refineSessionPatch(session, [candidate], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-8,
    activeBuild: perturbedActive
  });
  const refined = buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-8
  });

  assert.equal(command.twoToOne.status, "compensated");
  assert.equal(
    command.twoToOne.actions[0].replacedTransitionCellIds.includes(
      perturbedParent
    ),
    true
  );
  assert.equal(
    command.twoToOne.affectedComponentCellIds.includes(perturbedOwner),
    true
  );
  assert.equal(checkNoHangingNodes(refined, 1e-8).ok, true);
  assert.ok(minimumCornerScaledJacobian(refined) > 0);
});

test("Hex 2:1 transition-shell rebuilding inherits an external activeBuild merge tolerance", () => {
  const {
    session,
    candidate
  } = createTransitionShellRegressionFixture();
  const perturbedOwner = duplicateOneNearCoincidentNeighborFace(
    session,
    candidate,
    [5e-7, -2.5e-7, 2.5e-7]
  );
  const perturbedParent = session.cells.get(perturbedOwner).parentId;
  assert.ok(perturbedParent);
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-6
  });

  const command = refineSessionPatch(session, [candidate], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: active
  });

  assert.equal(active.mergeTolerance, 1e-6);
  assert.equal(command.twoToOne.status, "compensated");
  assert.equal(
    command.twoToOne.actions[0].replacedTransitionCellIds.includes(
      perturbedParent
    ),
    true
  );
  assert.equal(
    command.twoToOne.affectedComponentCellIds.includes(perturbedOwner),
    true
  );
});

test("Hex 2:1 transition-shell rebuilding rejects inconsistent or unproven activeBuild tolerance atomically", () => {
  for (const mode of ["inconsistent", "unproven"]) {
    const {
      session,
      candidate
    } = createTransitionShellRegressionFixture();
    duplicateOneNearCoincidentNeighborFace(
      session,
      candidate,
      [5e-7, -2.5e-7, 2.5e-7]
    );
    const active = mode === "unproven"
      ? buildActiveMeshWithMap(session, { mergeNodes: false })
      : buildActiveMeshWithMap(session, {
          mergeNodes: true,
          mergeTolerance: 1e-6
        });
    const before = structuredClone(session);

    const error = captureError(() => refineSessionPatch(session, [candidate], {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      ...(mode === "inconsistent" ? { mergeTolerance: 1e-8 } : {}),
      activeBuild: active
    }));

    assert.equal(error instanceof TwoToOnePlanningError, true);
    assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
    assert.match(error.message, /activeBuild.*merge tolerance/i);
    assert.deepEqual(session, before);
  }
});

test("session patch direct refine and preview reject activeBuild tolerance mismatch before planning", () => {
  for (const operation of ["refine", "preview"]) {
    const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
    const active = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance: 1e-6
    });
    const before = structuredClone(session);
    const invoke = operation === "refine"
      ? () => refineSessionPatch(session, ["e1"], {
          includeTransitions: false,
          mergeTolerance: 1e-8,
          activeBuild: active
        })
      : () => previewSessionPatch(session, ["e1"], {
          includeTransitions: false,
          mergeTolerance: 1e-8,
          activeBuild: active
        });

    const error = captureError(invoke);

    assert.equal(error instanceof TwoToOnePlanningError, true);
    assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
    assert.match(error.message, /activeBuild.*merge tolerance/i);
    assert.deepEqual(session, before);
  }
});

test("session patch rejects stale active cell planning metadata before direct refine and preview", () => {
  for (const operation of ["refine", "preview"]) {
    const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
    const active = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance: 1e-9
    });
    session.cells.get("e1").ordinal = 2;
    const before = structuredClone(session);
    const invoke = operation === "refine"
      ? () => refineSessionPatch(session, ["e1"], {
          includeTransitions: false,
          activeBuild: active
        })
      : () => previewSessionPatch(session, ["e1"], {
          includeTransitions: false,
          activeBuild: active
        });

    const error = captureError(invoke);

    assert.equal(error instanceof TwoToOnePlanningError, true);
    assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
    assert.match(error.message, /activeBuild.*stale|expected element/i);
    assert.deepEqual(session, before);
    assert.equal(session.cells.get("e2").active, true);
    assert.equal(session.cells.get("e2").hidden, false);
  }
});

test("session patch rejects every invalid active cell ordinal without mapping fallback", () => {
  const invalidOrdinals = [
    0,
    -1,
    999,
    Number.NaN,
    1.5,
    Number.MAX_SAFE_INTEGER + 1
  ];
  for (const ordinal of invalidOrdinals) {
    for (const operation of ["refine", "preview"]) {
      const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
      const active = buildActiveMeshWithMap(session, {
        mergeNodes: true,
        mergeTolerance: 1e-9
      });
      session.cells.get("e1").ordinal = ordinal;
      const before = structuredClone(session);
      const invoke = operation === "refine"
        ? () => refineSessionPatch(session, ["e1"], {
            includeTransitions: false,
            activeBuild: active
          })
        : () => previewSessionPatch(session, ["e1"], {
            includeTransitions: false,
            activeBuild: active
          });

      const error = captureError(invoke);

      assert.equal(error instanceof TwoToOnePlanningError, true, `${operation}: ${ordinal}`);
      assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
      assert.match(error.message, /ordinal|expected element|activeBuild.*stale/i);
      assert.deepEqual(session, before);
      assert.equal(session.cells.get("e2").active, true);
      assert.equal(session.cells.get("e2").hidden, false);
    }
  }
});

test("structured-cloned builds reject stale active cell planning metadata", () => {
  for (const mutation of ["role", "level", "parentId"]) {
    for (const operation of ["refine", "preview"]) {
      const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
      const active = structuredClone(buildActiveMeshWithMap(session, {
        mergeNodes: true,
        mergeTolerance: 1e-9
      }));
      const cell = session.cells.get("e1");
      if (mutation === "role") {
        cell.role = "face-transition";
      } else if (mutation === "level") {
        cell.level = 1;
      } else {
        cell.parentId = "e2";
      }
      const before = structuredClone(session);
      const invoke = operation === "refine"
        ? () => refineSessionPatch(session, ["e1"], {
            includeTransitions: false,
            activeBuild: active
          })
        : () => previewSessionPatch(session, ["e1"], {
            includeTransitions: false,
            activeBuild: active
          });

      const error = captureError(invoke);

      assert.equal(error instanceof TwoToOnePlanningError, true, mutation);
      assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
      assert.match(error.message, /activeBuild.*stale|session.*changed/i);
      assert.deepEqual(session, before);
      assert.equal(session.cells.get("e2").active, true);
      assert.equal(session.cells.get("e2").hidden, false);
    }
  }
});

test("session revision invalidates builds across refine undo and redo", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  assert.equal(session.revision, 0);
  const initial = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });

  refineSessionPatch(session, ["e1"], {
    includeTransitions: false,
    activeBuild: initial
  });
  assert.equal(session.revision, 1);
  const refined = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });

  undoRefinementSession(session);
  assert.equal(session.revision, 2);
  assert.throws(
    () => previewSessionPatch(session, [], { activeBuild: refined }),
    (error) => error instanceof TwoToOnePlanningError
      && error.code === "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY"
  );
  const undone = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });

  redoRefinementSession(session);
  assert.equal(session.revision, 3);
  assert.throws(
    () => previewSessionPatch(session, [], { activeBuild: undone }),
    (error) => error instanceof TwoToOnePlanningError
      && error.code === "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY"
  );
});

test("structured-cloned active builds validate once and remain reusable in an equivalent realm", () => {
  const workerSession = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const mainSession = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const workerBuild = buildActiveMeshWithMap(workerSession, {
    mergeNodes: true,
    mergeTolerance: 1e-9,
    includeCellIdByElementId: false,
    includeElementIdByCellId: false,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false
  });
  const transferredBuild = structuredClone(workerBuild);
  const firstPoint = mainSession.nodes[0];
  const firstCoordinate = firstPoint[0];
  let coordinateReads = 0;
  Object.defineProperty(firstPoint, 0, {
    configurable: true,
    enumerable: true,
    get() {
      coordinateReads += 1;
      return firstCoordinate;
    }
  });

  assert.throws(
    () => previewSessionPatch(mainSession, ["missing"], { activeBuild: transferredBuild }),
    /missing|does not exist/
  );
  assert.ok(coordinateReads > 0);
  coordinateReads = 0;

  assert.throws(
    () => previewSessionPatch(mainSession, ["missing"], { activeBuild: transferredBuild }),
    /missing|does not exist/
  );
  assert.equal(coordinateReads, 0);
  const command = refineSessionPatch(mainSession, ["e1"], {
    includeTransitions: false,
    activeBuild: transferredBuild
  });
  assert.ok(command.createdCellIds.length > 0);
  assert.equal(mainSession.revision, 1);
  assert.throws(
    () => previewSessionPatch(mainSession, [], { activeBuild: transferredBuild }),
    (error) => error instanceof TwoToOnePlanningError
      && error.code === "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY"
  );
});

test("same-realm active build validation does not iterate session geometry", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const nodes = session.nodes;
  const nodeIterator = nodes[Symbol.iterator].bind(nodes);
  let nodeIterations = 0;
  Object.defineProperty(nodes, Symbol.iterator, {
    configurable: true,
    value() {
      nodeIterations += 1;
      return nodeIterator();
    }
  });

  assert.throws(
    () => previewSessionPatch(session, ["missing"], { activeBuild: active }),
    /missing|does not exist/
  );
  assert.throws(
    () => previewSessionPatch(session, ["missing"], { activeBuild: active }),
    /missing|does not exist/
  );

  assert.equal(nodeIterations, 0);
});

test("same-realm active build validation does not iterate active leaves or cells", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(8, 8, 8));
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const activeIterator = session.activeLeafIds[Symbol.iterator].bind(session.activeLeafIds);
  const cellIterator = session.cells[Symbol.iterator].bind(session.cells);
  let activeLeafIterations = 0;
  let cellIterations = 0;
  Object.defineProperty(session.activeLeafIds, Symbol.iterator, {
    configurable: true,
    value() {
      activeLeafIterations += 1;
      return activeIterator();
    }
  });
  Object.defineProperty(session.cells, Symbol.iterator, {
    configurable: true,
    value() {
      cellIterations += 1;
      return cellIterator();
    }
  });

  assert.throws(
    () => previewSessionPatch(session, ["missing"], { activeBuild: active }),
    /missing|does not exist/
  );

  assert.equal(activeLeafIterations, 0);
  assert.equal(cellIterations, 0);
});

test("same-realm builds reject selected planning metadata changes atomically", () => {
  const mutations = [
    ["id", (cell) => {
      cell.id = "tampered";
    }],
    ["kind", (cell) => {
      cell.kind = "Q1";
    }],
    ["level", (cell) => {
      cell.level += 1;
    }],
    ["role", (cell) => {
      cell.role = "face-transition";
    }],
    ["parentId", (cell) => {
      cell.parentId = "e2";
    }],
    ["element", (cell) => {
      cell.element = [
        cell.element[1],
        cell.element[0],
        ...cell.element.slice(2)
      ];
    }]
  ];
  for (const [mutationName, mutate] of mutations) {
    for (const operation of ["refine", "preview"]) {
      const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
      const active = buildActiveMeshWithMap(session, {
        mergeNodes: true,
        mergeTolerance: 1e-9
      });
      mutate(session.cells.get("e1"));
      const before = structuredClone(session);
      const invoke = operation === "refine"
        ? () => refineSessionPatch(session, ["e1"], {
            includeTransitions: false,
            activeBuild: active
          })
        : () => previewSessionPatch(session, ["e1"], {
            includeTransitions: false,
            activeBuild: active
          });

      const error = captureError(invoke);

      assert.equal(error instanceof TwoToOnePlanningError, true, `${mutationName}:${operation}`);
      assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
      assert.match(error.message, /activeBuild.*stale|selected cell.*changed/i);
      assert.deepEqual(session, before);
    }
  }
});

test("same-realm builds reject selected shared-node coordinate changes atomically", () => {
  for (const operation of ["refine", "preview"]) {
    const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
    const active = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance: 1e-9
    });
    const selected = session.cells.get("e1");
    const sharedNodeId = selected.element.find((nodeId) =>
      session.cells.get("e2").element.includes(nodeId)
    );
    assert.ok(sharedNodeId);
    const point = session.nodes[sharedNodeId - 1];
    session.nodes[sharedNodeId - 1] = [point[0], point[1] + 0.01, point[2]];
    const before = structuredClone(session);
    const invoke = operation === "refine"
      ? () => refineSessionPatch(session, ["e1"], {
          includeTransitions: false,
          activeBuild: active
        })
      : () => previewSessionPatch(session, ["e1"], {
          includeTransitions: false,
          activeBuild: active
        });

    const error = captureError(invoke);

    assert.equal(error instanceof TwoToOnePlanningError, true, operation);
    assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
    assert.match(error.message, /activeBuild.*stale|selected cell.*changed/i);
    assert.deepEqual(session, before);
  }
});

test("session patch revalidates nonselected replacement parents before preview and apply", () => {
  for (const mutation of ["metadata", "connectivity"]) {
    for (const operation of ["refine", "preview"]) {
      const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
      const active = buildActiveMeshWithMap(session, {
        mergeNodes: true,
        mergeTolerance: 1e-9
      });
      const neighbor = session.cells.get("e2");
      if (mutation === "metadata") {
        neighbor.level += 1;
      } else {
        neighbor.element = [
          neighbor.element[1],
          neighbor.element[0],
          ...neighbor.element.slice(2)
        ];
      }
      const before = structuredClone(session);
      const invoke = operation === "refine"
        ? () => refineSessionPatch(session, ["e1"], {
            includeTransitions: true,
            activeBuild: active
          })
        : () => previewSessionPatch(session, ["e1"], {
            includeTransitions: true,
            activeBuild: active
          });

      const error = captureError(invoke);

      assert.equal(error instanceof TwoToOnePlanningError, true, `${mutation}:${operation}`);
      assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
      assert.match(error.message, /activeBuild.*stale|replacement parent.*changed/i);
      assert.deepEqual(session, before);
    }
  }
});

test("same-realm builds reject collection cardinality changes atomically", () => {
  const mutations = [
    ["cell-delete", (session) => {
      Map.prototype.delete.call(session.cells, "e2");
    }],
    ["cell-add", (session) => {
      Map.prototype.set.call(session.cells, "tampered", {
        id: "tampered",
        ordinal: 3,
        level: 0,
        role: "base",
        kind: "H1",
        element: [...session.cells.get("e1").element],
        children: [],
        active: false,
        hidden: true
      });
    }],
    ["active-leaf-delete", (session) => {
      Set.prototype.delete.call(session.activeLeafIds, "e2");
    }]
  ];
  for (const [mutationName, mutate] of mutations) {
    for (const operation of ["refine", "preview"]) {
      const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
      const active = buildActiveMeshWithMap(session, {
        mergeNodes: true,
        mergeTolerance: 1e-9
      });
      mutate(session);
      const before = structuredClone(session);
      const invoke = operation === "refine"
        ? () => refineSessionPatch(session, ["e1"], {
            includeTransitions: false,
            activeBuild: active
          })
        : () => previewSessionPatch(session, ["e1"], {
            includeTransitions: false,
            activeBuild: active
          });

      const error = captureError(invoke);

      assert.equal(error instanceof TwoToOnePlanningError, true, `${mutationName}:${operation}`);
      assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
      assert.match(error.message, /activeBuild.*stale|collection.*changed/i);
      assert.deepEqual(session, before);
    }
  }
});

test("structured-cloned active build validation scans linearly once then caches trust", () => {
  const workerSession = createRefinementSession(createHexUnitCubeMesh(8, 8, 8));
  const session = createRefinementSession(createHexUnitCubeMesh(8, 8, 8));
  const active = structuredClone(buildActiveMeshWithMap(workerSession, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  }));
  const activeIterator = session.activeLeafIds[Symbol.iterator].bind(session.activeLeafIds);
  const cellIterator = session.cells[Symbol.iterator].bind(session.cells);
  let activeLeafIterations = 0;
  let cellIterations = 0;
  Object.defineProperty(session.activeLeafIds, Symbol.iterator, {
    configurable: true,
    value() {
      activeLeafIterations += 1;
      return activeIterator();
    }
  });
  Object.defineProperty(session.cells, Symbol.iterator, {
    configurable: true,
    value() {
      cellIterations += 1;
      return cellIterator();
    }
  });

  assert.throws(
    () => previewSessionPatch(session, ["missing"], { activeBuild: active }),
    /missing|does not exist/
  );
  assert.equal(activeLeafIterations, 0);
  assert.ok(cellIterations <= 1);

  activeLeafIterations = 0;
  cellIterations = 0;
  assert.throws(
    () => previewSessionPatch(session, ["missing"], { activeBuild: active }),
    /missing|does not exist/
  );
  assert.equal(activeLeafIterations, 0);
  assert.equal(cellIterations, 0);
});

test("structured-cloned mapping tamper is rejected before selection and remap consumers", () => {
  const tamperers = [
    ["cell map", (active) => {
      active.elementIdByCellId.set("e1", 2);
    }],
    ["ordinal array", (active) => {
      active.elementIdByCellOrdinalArray[1] = 2;
    }],
    ["node map", (active) => {
      active.nodeIdBySessionNodeId.set(1, 999);
    }],
    ["element owner map", (active) => {
      active.elementIdsByNodeId.set(1, [999]);
    }]
  ];
  for (const [tamperName, tamper] of tamperers) {
    for (const consumer of ["selection", "remap"]) {
      const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
      const active = structuredClone(buildActiveMeshWithMap(session, {
        mergeNodes: true,
        mergeTolerance: 1e-9,
        includeElementIdsByNodeId: true
      }));
      tamper(active);
      const invoke = consumer === "selection"
        ? () => prepareSessionRefineSelection(session, active, [1], {
            regularizeHexSelection: false
          })
        : () => remapSessionSetsToActiveMesh(active, {
            cellSets: { CORE: ["e1"] },
            nodeSets: { CORNER: [1] }
          });

      const error = captureError(invoke);

      assert.equal(error instanceof TwoToOnePlanningError, true, `${tamperName}:${consumer}`);
      assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
      assert.match(error.message, /activeBuild.*tamper|mapping.*fingerprint/i);
    }
  }
});

test("active cell lookup returns undefined for a valid inactive session cell", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const initial = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  refineSessionPatch(session, ["e1"], {
    includeTransitions: false,
    activeBuild: initial
  });
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });

  assert.equal(session.cells.get("e1").active, false);
  assert.equal(activeBuildElementIdByCellId(session, active, "e1"), undefined);
  assert.equal(activeBuildElementIdByCellId(session, active, "e2"), 1);
});

test("selection preparation validates worker builds before nonregularized early return", () => {
  const workerSession = createRefinementSession(createHexUnitCubeMesh(3, 1, 1));
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const active = structuredClone(buildActiveMeshWithMap(workerSession, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  }));
  const before = structuredClone(session);

  const error = captureError(() => prepareSessionRefineSelection(
    session,
    active,
    [1],
    { regularizeHexSelection: false }
  ));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
  assert.match(error.message, /activeBuild.*stale|session.*changed/i);
  assert.deepEqual(session, before);
});

test("selection preparation validates mapped cells before every regularization path", () => {
  const mutations = [
    ["level", (session, cell) => {
      cell.level += 1;
    }],
    ["role", (session, cell) => {
      cell.role = "face-transition";
    }],
    ["connectivity", (session, cell) => {
      cell.element[0] = cell.element[1];
    }],
    ["coordinate", (session, cell) => {
      session.nodes[cell.element[0] - 1][0] += 0.125;
    }],
    ["active state", (session, cell) => {
      cell.active = false;
      cell.hidden = true;
    }]
  ];
  for (const regularizeHexSelection of [false, true]) {
    for (const [mutationName, mutate] of mutations) {
      const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
      const active = buildActiveMeshWithMap(session, {
        mergeNodes: true,
        mergeTolerance: 1e-9
      });
      mutate(session, session.cells.get("e1"));
      const before = structuredClone(session);

      const error = captureError(() => prepareSessionRefineSelection(
        session,
        active,
        [1],
        { regularizeHexSelection }
      ));

      assert.equal(
        error instanceof TwoToOnePlanningError,
        true,
        `${regularizeHexSelection}:${mutationName}`
      );
      assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
      assert.match(error.message, /activeBuild.*stale|selected cell.*changed/i);
      assert.deepEqual(session, before);
    }
  }
});

test("local command conformance rejects stale active-created coordinates", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const initial = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const command = refineSessionPatch(session, ["e1"], {
    includeTransitions: false,
    activeBuild: initial
  });
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9,
    includeElementIdsByNodeId: true
  });
  const activeCreatedCellId = command.activeCreatedCellIds?.[0]
    ?? command.createdCellIds.find((cellId) => session.activeLeafIds.has(cellId));
  assert.ok(activeCreatedCellId);
  const activeCreatedCell = session.cells.get(activeCreatedCellId);
  session.nodes[activeCreatedCell.element[0] - 1][0] += 0.125;
  const before = structuredClone(session);

  const error = captureError(() =>
    checkRefinementSessionCommandConformance(session, command, 1e-9, active)
  );

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
  assert.match(error.message, /activeBuild.*stale|selected cell.*changed/i);
  assert.deepEqual(session, before);
});

test("local command conformance requires every recorded active-created cell to remain active", () => {
  const mutations = [
    ["active flag", (session, cellId, cell) => {
      cell.active = false;
    }],
    ["hidden flag", (session, cellId, cell) => {
      cell.hidden = true;
    }],
    ["active leaf membership", (session, cellId) => {
      Set.prototype.delete.call(session.activeLeafIds, cellId);
    }]
  ];
  for (const [mutationName, mutate] of mutations) {
    const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
    const initial = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance: 1e-9
    });
    const command = refineSessionPatch(session, ["e1"], {
      includeTransitions: false,
      activeBuild: initial
    });
    const recordedCommand = {
      ...command,
      activeCreatedCellIds: [...command.createdCellIds]
    };
    const active = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance: 1e-9,
      includeElementIdsByNodeId: true
    });
    const cellId = recordedCommand.activeCreatedCellIds[0];
    const cell = session.cells.get(cellId);
    mutate(session, cellId, cell);

    const error = captureError(() =>
      checkRefinementSessionCommandConformance(
        session,
        recordedCommand,
        1e-9,
        active
      )
    );

    assert.equal(error instanceof TwoToOnePlanningError, true, mutationName);
    assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
    assert.match(error.message, /activeBuild.*stale|active-leaf state changed/i);
  }
});

test("local command conformance rejects recorded active cells missing from a current build", () => {
  for (const buildMode of ["omitted", "rebuilt"]) {
    const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
    const initial = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance: 1e-9
    });
    const command = refineSessionPatch(session, ["e1"], {
      includeTransitions: false,
      activeBuild: initial
    });
    const recordedCommand = {
      ...command,
      activeCreatedCellIds: [...command.createdCellIds]
    };
    const cellId = recordedCommand.activeCreatedCellIds[0];
    Set.prototype.delete.call(session.activeLeafIds, cellId);
    const active = buildMode === "rebuilt"
      ? buildActiveMeshWithMap(session, {
          mergeNodes: true,
          mergeTolerance: 1e-9,
          includeElementIdsByNodeId: true
        })
      : undefined;

    const error = captureError(() =>
      checkRefinementSessionCommandConformance(
        session,
        recordedCommand,
        1e-9,
        active
      )
    );

    assert.equal(error instanceof TwoToOnePlanningError, true, buildMode);
    assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
    assert.match(error.message, /recorded active cell|active element/i);
  }
});

test("trusted active builds isolate planning and remap from public mapping tamper", () => {
  for (const transfer of ["same-realm", "structured-clone"]) {
    const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
    const built = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance: 1e-9,
      includeElementIdsByNodeId: true
    });
    const active = transfer === "same-realm" ? built : structuredClone(built);
    if (transfer === "structured-clone") {
      assert.throws(
        () => previewSessionPatch(session, ["missing"], { activeBuild: active }),
        /missing|does not exist/
      );
    }

    Map.prototype.set.call(active.cellIdByElementId, 1, "e2");
    Map.prototype.set.call(active.elementIdByCellId, "e1", 2);
    Map.prototype.set.call(active.nodeIdBySessionNodeId, 1, 999);
    Map.prototype.set.call(active.elementIdsByNodeId, 1, [999]);
    active.elementIdByCellOrdinalArray[session.cells.get("e1").ordinal] = 2;

    assert.equal(activeBuildCellIdByElementId(active, 1), "e1");
    assert.equal(activeBuildElementIdByCellId(session, active, "e1"), 1);
    const remapped = remapSessionSetsToActiveMesh(active, {
      cellSets: { CORE: ["e1"] },
      nodeSets: { CORNER: [1] }
    });
    assert.deepEqual(remapped.cellSets.get("CORE"), [1]);
    assert.deepEqual(remapped.nodeSets.get("CORNER"), [1]);
    const local = checkRefinementSessionCommandConformance(session, {
      id: "mapping-cache-probe",
      kind: "refine",
      hiddenCellIds: [],
      createdCellIds: ["e1"],
      createdNodeIds: []
    }, 1e-9, active);
    assert.equal(local.checkedElementIds.includes(999), false);

    const command = refineSessionPatch(session, ["e1"], {
      includeTransitions: false,
      activeBuild: active
    });
    assert.ok(command.createdCellIds.length > 0);
    assert.equal(session.cells.get("e1").hidden, true);
    assert.equal(session.cells.get("e2").hidden, false);
  }
});

test("active build provenance stays scalar-sized and survives structured clone", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(8, 8, 8));
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const provenance = active.provenance;

  assert.ok(provenance);
  assert.deepEqual(Object.keys(provenance).sort(), [
    "geometryResolution",
    "mappingFingerprint",
    "mergeTolerance",
    "sessionFingerprint",
    "sessionRevision",
    "version"
  ]);
  assert.equal(provenance.version, 1);
  assert.equal(provenance.sessionRevision, session.revision);
  assert.equal(typeof provenance.sessionFingerprint, "string");
  assert.equal(typeof provenance.mappingFingerprint, "string");
  assert.equal(Object.values(provenance).some(Array.isArray), false);
  assert.equal(Object.values(provenance).some((value) => value instanceof Map), false);
  assert.deepEqual(structuredClone(provenance), provenance);
  assert.equal(
    Reflect.ownKeys(active).some((key) => /snapshot|cells|nodes/i.test(String(key))),
    false
  );
});

test("structured-clone mapping fingerprint distinguishes sparse index zero values", () => {
  for (const indexZeroValue of [undefined, null, Number.NaN]) {
    const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
    const active = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance: 1e-9
    });
    const transferredBuild = structuredClone(active);
    assert.equal(0 in transferredBuild.cellIdsByElementIdArray, false);
    transferredBuild.cellIdsByElementIdArray[0] = indexZeroValue;
    const before = structuredClone(session);

    const error = captureError(() => previewSessionPatch(session, [], {
      activeBuild: transferredBuild
    }));

    assert.equal(error instanceof TwoToOnePlanningError, true);
    assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
    assert.match(error.message, /mapping.*fingerprint|metadata.*tamper/i);
    assert.deepEqual(session, before);
  }
});

test("active mesh builds snapshot geometry before deferred metadata reads", () => {
  const firstSession = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const secondSession = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const first = buildActiveMeshWithMap(firstSession, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const second = buildActiveMeshWithMap(secondSession, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const firstResolution = first.geometryResolution;
  const originalNode = [...second.mesh.nodes[0]];

  firstSession.nodes[0] = [
    firstSession.nodes[0][0] + 10,
    firstSession.nodes[0][1],
    firstSession.nodes[0][2]
  ];
  secondSession.nodes[0][0] += 10;

  assert.deepEqual(second.mesh.nodes[0], originalNode);
  assert.deepEqual(second.geometryResolution, firstResolution);
  assert.equal(Object.isFrozen(second.mesh), true);
  assert.equal(Object.isFrozen(second.mesh.nodes), true);
  assert.equal(Object.isFrozen(second.mesh.nodes[0]), true);
  assert.equal(Object.isFrozen(second.mesh.elements), true);
  assert.equal(Object.isFrozen(second.mesh.elements[0]), true);
  assert.equal(Object.isFrozen(second.geometryResolution), true);
});

test("session patch rejects stale activeBuild geometry, connectivity, and active leaves atomically", () => {
  for (const mutation of [
    "node-in-place",
    "node-replacement",
    "connectivity",
    "active-leaf"
  ]) {
    for (const operation of ["refine", "preview"]) {
      const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
      const active = buildActiveMeshWithMap(session, {
        mergeNodes: true,
        mergeTolerance: 1e-9
      });
      const transferredBuild = structuredClone(active);
      const secondCell = session.cells.get("e2");
      const firstCellNodeIds = new Set(session.cells.get("e1").element);
      const secondOnlyNodeId = secondCell.element.find(
        (nodeId) => !firstCellNodeIds.has(nodeId)
      );
      assert.ok(secondOnlyNodeId);
      if (mutation === "node-in-place") {
        session.nodes[secondOnlyNodeId - 1][0] += 0.01;
      } else if (mutation === "node-replacement") {
        const point = session.nodes[secondOnlyNodeId - 1];
        session.nodes[secondOnlyNodeId - 1] = [
          point[0] + 0.01,
          point[1],
          point[2]
        ];
      } else if (mutation === "connectivity") {
        secondCell.element = [
          secondCell.element[1],
          secondCell.element[0],
          ...secondCell.element.slice(2)
        ];
      } else {
        session.activeLeafIds.delete("e2");
      }
      const before = structuredClone(session);
      const invoke = operation === "refine"
        ? () => refineSessionPatch(session, ["e1"], {
            includeTransitions: false,
            activeBuild: transferredBuild
          })
        : () => previewSessionPatch(session, ["e1"], {
            includeTransitions: false,
            activeBuild: transferredBuild
          });

      const error = captureError(invoke);

      assert.equal(error instanceof TwoToOnePlanningError, true, mutation);
      assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
      assert.match(error.message, /activeBuild.*stale|session.*changed/i);
      assert.deepEqual(session, before);
    }
  }
});

test("session patch invalidates an activeBuild after a successful session revision", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  refineSessionPatch(session, ["e1"], {
    includeTransitions: false,
    activeBuild: active
  });
  const before = structuredClone(session);

  const error = captureError(() => previewSessionPatch(session, ["e2"], {
    includeTransitions: false,
    activeBuild: active
  }));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
  assert.match(error.message, /activeBuild.*stale|session.*revision/i);
  assert.deepEqual(session, before);
});

test("active mesh build metadata is immutable and mapping tamper is rejected", () => {
  const immutableSession = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const immutableBuild = buildActiveMeshWithMap(immutableSession, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  assert.throws(() => {
    immutableBuild.geometryResolution.coordinateScale = 99;
  }, TypeError);
  assert.throws(() => {
    Object.defineProperty(immutableBuild, "mergeTolerance", {
      value: 99
    });
  }, TypeError);
  assert.throws(() => {
    immutableBuild.cellIdByElementId.set(1, "tampered");
  }, TypeError);
  assert.throws(() => {
    immutableBuild.cellIdsByElementIdArray[1] = "tampered";
  }, TypeError);

  for (const tamper of ["map", "array"]) {
    const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
    const active = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance: 1e-9
    });
    const transferredBuild = structuredClone(active);
    if (tamper === "map") {
      transferredBuild.cellIdByElementId.set(1, "tampered");
    } else {
      transferredBuild.cellIdsByElementIdArray[1] = "tampered";
    }
    const before = structuredClone(session);

    const error = captureError(() => refineSessionPatch(session, ["e1"], {
      includeTransitions: false,
      activeBuild: transferredBuild
    }));

    assert.equal(error instanceof TwoToOnePlanningError, true);
    assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
    assert.match(error.message, /activeBuild.*metadata|activeBuild.*tamper/i);
    assert.deepEqual(session, before);
  }
});

test("session patch direct refine and preview use the nonuniform full-geometry default tolerance", () => {
  const mesh = { kind: "H1", nodes: [], elements: [] };
  const appendCube = (offset, size) => {
    const cube = createHexUnitCubeMesh(1, 1, 1);
    const nodeOffset = mesh.nodes.length;
    mesh.nodes.push(...cube.nodes.map((point) => point.map(
      (coordinate, axis) => offset[axis] + coordinate * size
    )));
    mesh.elements.push(...cube.elements.map((element) =>
      element.map((nodeId) => nodeId + nodeOffset)
    ));
  };
  appendCube([0, 0, 0], 1);
  appendCube([1 + 5e-9, 0, 0], 1);
  appendCube([3, 0, 0], 0.01);

  for (const operation of ["refine", "preview"]) {
    const implicitSession = createRefinementSession(mesh);
    const explicitSession = createRefinementSession(mesh);
    const localToleranceSession = createRefinementSession(mesh);
    const implicitOptions = { includeTransitions: true };
    const explicitOptions = {
      includeTransitions: true,
      mergeTolerance: 1e-10
    };
    const localToleranceOptions = {
      includeTransitions: true,
      mergeTolerance: 1e-8
    };
    assert.equal(Object.hasOwn(implicitOptions, "activeBuild"), false);
    assert.equal(Object.hasOwn(implicitOptions, "mergeTolerance"), false);

    const implicitResult = operation === "refine"
      ? refineSessionPatch(implicitSession, ["e1"], implicitOptions)
      : previewSessionPatch(implicitSession, ["e1"], implicitOptions);
    const explicitResult = operation === "refine"
      ? refineSessionPatch(explicitSession, ["e1"], explicitOptions)
      : previewSessionPatch(explicitSession, ["e1"], explicitOptions);
    const localToleranceResult = operation === "refine"
      ? refineSessionPatch(localToleranceSession, ["e1"], localToleranceOptions)
      : previewSessionPatch(localToleranceSession, ["e1"], localToleranceOptions);

    if (operation === "refine") {
      assert.ok(implicitResult.recipe);
      assert.ok(explicitResult.recipe);
      assert.notEqual(
        implicitResult.recipe.options.mergeTolerance,
        explicitResult.recipe.options.mergeTolerance
      );
      assert.equal(
        explicitResult.recipe.options.mergeTolerance,
        explicitOptions.mergeTolerance
      );
      assert.ok(
        Math.abs(
          implicitResult.recipe.options.mergeTolerance
          - explicitOptions.mergeTolerance
        ) <= Number.EPSILON
      );

      const comparableImplicitResult = structuredClone(implicitResult);
      comparableImplicitResult.recipe.options.mergeTolerance =
        explicitResult.recipe.options.mergeTolerance;
      assert.deepEqual(comparableImplicitResult, explicitResult);

      const comparableImplicitSession = structuredClone(implicitSession);
      comparableImplicitSession.undoStack[0].recipe.options.mergeTolerance =
        explicitSession.undoStack[0].recipe.options.mergeTolerance;
      assert.deepEqual(comparableImplicitSession, explicitSession);
    } else {
      assert.deepEqual(implicitResult, explicitResult);
      assert.deepEqual(implicitSession, explicitSession);
    }
    assert.notDeepEqual(implicitResult, localToleranceResult);
    assert.equal(Object.hasOwn(implicitOptions, "activeBuild"), false);
    assert.equal(Object.hasOwn(implicitOptions, "mergeTolerance"), false);
  }
});

test("active mesh build and session patch reject invalid recorded merge tolerances", () => {
  for (const mergeTolerance of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
    assert.throws(
      () => buildActiveMeshWithMap(session, {
        mergeNodes: true,
        mergeTolerance
      }),
      {
        name: "RangeError",
        message: /mergeTolerance must be finite and nonnegative/
      }
    );

    const active = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance: 1e-9
    });
    const transferredBuild = structuredClone(active);
    transferredBuild.mergeTolerance = mergeTolerance;
    if (transferredBuild.provenance) {
      transferredBuild.provenance.mergeTolerance = mergeTolerance;
    }
    for (const operation of ["refine", "preview"]) {
      const before = structuredClone(session);
      const invoke = operation === "refine"
        ? () => refineSessionPatch(session, ["e1"], {
            includeTransitions: false,
            activeBuild: transferredBuild
          })
        : () => previewSessionPatch(session, ["e1"], {
            includeTransitions: false,
            activeBuild: transferredBuild
          });

      const error = captureError(invoke);

      assert.equal(error instanceof TwoToOnePlanningError, true);
      assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
      assert.match(error.message, /activeBuild.*merge tolerance/i);
      assert.deepEqual(session, before);
    }
  }
});

test("session patch maps non-finite complete geometry to a structured atomic error", () => {
  for (const operation of ["refine", "preview"]) {
    const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
    session.nodes[0] = [Number.NaN, 0, 0];
    const before = structuredClone(session);
    const invoke = operation === "refine"
      ? () => refineSessionPatch(session, ["e1"], { includeTransitions: false })
      : () => previewSessionPatch(session, ["e1"], { includeTransitions: false });

    const error = captureError(invoke);

    assert.equal(error instanceof TwoToOnePlanningError, true);
    assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
    assert.match(error.message, /non-finite coordinate/i);
    assert.deepEqual(session, before);
  }
});

test("Hex 2:1 transition-shell rebuilding does not connect faces beyond the effective tolerance", () => {
  const {
    session,
    candidate
  } = createTransitionShellRegressionFixture();
  const separatedOwner = addAmbiguousSupportFaceCell(
    session,
    candidate,
    [2e-8, -1e-8, 1e-8]
  );
  const separatedActive = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-8
  });

  const command = refineSessionPatch(session, [candidate], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-8,
    activeBuild: separatedActive
  });

  assert.equal(command.twoToOne.status, "compensated");
  assert.equal(command.twoToOne.affectedComponentCellIds.includes(separatedOwner), false);
  assert.equal(session.cells.get(separatedOwner).active, false);
  assert.equal(session.cells.get(separatedOwner).hidden, true);
});

test("Hex 2:1 transition-shell rebuilding rejects ambiguous face ownership atomically", () => {
  const diagnostics = [];
  for (let repeat = 0; repeat < 2; repeat += 1) {
    const {
      session,
      candidate
    } = createTransitionShellRegressionFixture();
    const ambiguousOwner = addAmbiguousSupportFaceCell(session, candidate);
    const active = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance: 1e-8
    });
    const before = structuredClone(session);

    const error = captureError(() => refineSessionPatch(session, [candidate], {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      mergeTolerance: 1e-8,
      activeBuild: active
    }));

    assert.equal(error instanceof TwoToOnePlanningError, true);
    assert.equal(error.code, "TWO_TO_ONE_AMBIGUOUS_FACE");
    assert.equal(error.diagnostic.conflictingCellIds.includes(ambiguousOwner), true);
    assert.equal(error.diagnostic.conflictingCellIds.length, 3);
    assert.ok(error.diagnostic.conflictingInterfaces.length > 0);
    assert.equal(
      error.diagnostic.conflictingInterfaces.every((entry) =>
        error.diagnostic.conflictingCellIds.includes(entry.firstCellId)
        && (
          entry.secondCellId === undefined
          || error.diagnostic.conflictingCellIds.includes(entry.secondCellId)
        )
        && entry.faceNodeIds.length === 4
      ),
      true
    );
    assert.deepEqual(session, before);
    diagnostics.push(structuredClone(error.diagnostic));
  }
  assert.deepEqual(diagnostics[1], diagnostics[0]);
});

test("Hex 2:1 connected support detects ambiguity hidden behind exact node IDs atomically", () => {
  const {
    session,
    candidate
  } = createTransitionShellRegressionFixture();
  const owners = addExactFirstSupportAmbiguity(session, candidate);
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-8
  });
  const before = structuredClone(session);

  const error = captureError(() => refineSessionPatch(session, [candidate], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-8,
    activeBuild: active
  }));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_AMBIGUOUS_FACE");
  assert.deepEqual(error.diagnostic.conflictingCellIds, [
    owners.exactStored,
    owners.nearStored,
    owners.exactQuery
  ]);
  assert.deepEqual(session, before);
});

test("Hex 2:1 connected support rejects a collapsed same-owner face pair atomically", () => {
  const {
    session,
    candidate
  } = createTransitionShellRegressionFixture();
  const collapsedOwner = addCollapsedSupportCell(session, candidate);
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const before = structuredClone(session);

  const error = captureError(() => refineSessionPatch(session, [candidate], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: active
  }));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_AMBIGUOUS_FACE");
  assert.deepEqual(error.diagnostic.conflictingCellIds, [collapsedOwner]);
  assert.deepEqual(session, before);
});

test("Hex 2:1 transition-shell rebuilding reuses immutable active geometry resolution metadata", () => {
  const {
    session,
    candidate,
    firstRefined
  } = createTransitionShellRegressionFixture();
  const resolution = firstRefined.geometryResolution;
  assert.ok(resolution);
  assert.equal(Object.isFrozen(resolution), true);

  const command = refineSessionPatch(session, [candidate], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: firstRefined
  });

  assert.equal(command.twoToOne.status, "compensated");
  assert.equal(firstRefined.geometryResolution, resolution);
  assert.ok(command.twoToOne.affectedComponentCellIds.length > 0);
});

test("Hex 2:1 transition-shell rebuilding geometrically matches valid coincident faces with distinct node IDs", () => {
  const {
    session,
    candidate
  } = createTransitionShellRegressionFixture();
  const ambiguousOwner = addAmbiguousSupportFaceCell(
    session,
    candidate,
    [0, 0, 0]
  );
  const selected = session.cells.get(candidate);
  const duplicate = session.cells.get(ambiguousOwner);
  assert.deepEqual(
    duplicate.element.map((nodeId) => session.nodes[nodeId - 1]),
    selected.element.map((nodeId) => session.nodes[nodeId - 1])
  );
  assert.equal(
    duplicate.element.some((nodeId) => selected.element.includes(nodeId)),
    false
  );
  const before = structuredClone(session);

  const error = captureError(() => refineSessionPatch(session, [candidate], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-8
  }));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_AMBIGUOUS_FACE");
  assert.equal(error.diagnostic.conflictingCellIds.includes(ambiguousOwner), true);
  assert.deepEqual(session, before);
});

test("Hex 2:1 transition-shell rebuilding rejects degenerate coincident faces before exact matching", () => {
  const {
    session,
    candidate
  } = createTransitionShellRegressionFixture();
  const degenerateOwners = addCoincidentDegenerateSupportCells(
    session,
    candidate,
    3
  );
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-8
  });

  const command = refineSessionPatch(session, [candidate], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-8,
    activeBuild: active
  });
  const refined = buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-8
  });

  assert.equal(command.twoToOne.status, "compensated");
  assert.equal(checkNoHangingNodes(refined, 1e-8).ok, true);
  for (const owner of degenerateOwners) {
    assert.equal(command.twoToOne.affectedComponentCellIds.includes(owner), false);
    assert.equal(session.cells.get(owner).active, false);
    assert.equal(session.cells.get(owner).hidden, true);
  }
});

test("Hex 2:1 transition-shell rebuilding rejects invalid requested merge tolerances", () => {
  const {
    session,
    candidate,
    firstRefined
  } = createTransitionShellRegressionFixture();
  const before = structuredClone(session);

  for (const mergeTolerance of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => previewSessionPatch(session, [candidate], {
        hexRefinementRatio: 2,
        hexTwoToOneSelectionMode: "local",
        includeTransitions: true,
        mergeTolerance,
        activeBuild: firstRefined
      }),
      {
        name: "RangeError",
        message: /mergeTolerance must be finite and nonnegative/
      }
    );
    assert.deepEqual(session, before);
  }
});

test("Hex 2:1 transition-shell rebuilding rejects a precision floor wider than tiny edges", () => {
  const {
    session,
    candidate
  } = createTransitionShellRegressionFixture();
  addActiveResolutionProbeCell(session, [-1e-12, -1e-12, -1e-12], 1e-16);
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-20
  });
  const before = structuredClone(session);

  const error = captureError(() => refineSessionPatch(session, [candidate], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-20,
    activeBuild: active
  }));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
  assert.match(error.message, /face tolerance.*minimum edge.*resolution/i);
  assert.deepEqual(session, before);
});

test("Hex 2:1 transition-shell rebuilding rejects a large-coordinate precision floor wider than edges", () => {
  const {
    session,
    candidate
  } = createTransitionShellRegressionFixture();
  addActiveResolutionProbeCell(session, [1e12, 1e12, 1e12], 0.01);
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-6
  });
  const before = structuredClone(session);

  const error = captureError(() => refineSessionPatch(session, [candidate], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-6,
    activeBuild: active
  }));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY");
  assert.match(error.message, /face tolerance.*minimum edge.*resolution/i);
  assert.deepEqual(session, before);
});

test("Hex 2:1 transition-shell rebuilding rejects a requested tolerance that overlaps edge resolution", () => {
  const {
    session,
    candidate
  } = createTransitionShellRegressionFixture();
  const before = structuredClone(session);

  const error = captureError(() => refineSessionPatch(session, [candidate], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-2
  }));

  assert.equal(error instanceof RangeError, true);
  assert.equal(error instanceof TwoToOnePlanningError, false);
  assert.match(error.message, /less than half.*edge/i);
  assert.deepEqual(session, before);
});

const expectedTransitionShellRegressionAction = {
  kind: "transition-shell-rebuild",
  reason: "the nested core reached an existing 2:1 transition component",
  addedParentCellIds: [
    "e66",
    "e73",
    "e108",
    "e114",
    "e121",
    "e157",
    "e163",
    "e170"
  ],
  replacedTransitionCellIds: [
    "e66",
    "e73",
    "e108",
    "e114",
    "e121",
    "e157",
    "e163",
    "e170"
  ]
};

for (const limitCase of [
  { maxAddedParentLayers: 0, maxAddedParentCount: 32 },
  { maxAddedParentLayers: 1, maxAddedParentCount: 0 }
]) {
  test(`Hex 2:1 transition-shell rebuilding obeys compensation bounds ${JSON.stringify(limitCase)}`, () => {
    const {
      session,
      firstRefined,
      candidate
    } = createTransitionShellRegressionFixture();
    const before = structuredClone(session);
    const options = {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      hexTwoToOneCompensation: {
        mode: "local-topology",
        ...limitCase
      },
      activeBuild: firstRefined
    };

    const errors = [
      () => previewSessionPatch(session, [candidate], options),
      () => refineSessionPatch(session, [candidate], options)
    ].map((operation) => {
      const error = captureError(operation);
      assert.equal(error instanceof TwoToOnePlanningError, true);
      assert.equal(error.code, "TWO_TO_ONE_COMPENSATION_LIMIT");
      assert.deepEqual(
        error.diagnostic.attemptedActions,
        [expectedTransitionShellRegressionAction]
      );
      assert.deepEqual(session, before);
      return error;
    });
    assert.deepEqual(
      errors[1].diagnostic.attemptedActions,
      errors[0].diagnostic.attemptedActions
    );
  });
}

test("Hex 2:1 shell collision discovery honors an explicit parent-count limit", () => {
  const mesh = createHexUnitCubeMesh(7, 7, 7);
  const session = createRefinementSession(mesh);
  const initial = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const firstCore = idsInIndexBlock(
    7,
    7,
    7,
    [2, 2, 2],
    [4, 4, 4]
  ).map((elementId) =>
    activeBuildCellIdByElementId(initial, elementId)
  ).filter(Boolean);
  refineSessionPatch(session, firstCore, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: initial
  });
  const targetZ = 2.75 / 7;
  const selectedCellIds = [...session.activeLeafIds]
    .filter((cellId) => {
      const cell = session.cells.get(cellId);
      if (cell?.level !== 1 || cell.role !== "selected") {
        return false;
      }
      const centerZ = cell.element.reduce(
        (sum, nodeId) => sum + session.nodes[nodeId - 1][2] / 8,
        0
      );
      return Math.abs(centerZ - targetZ) < 1e-12;
    })
    .sort();
  assert.equal(selectedCellIds.length, 36);
  const before = structuredClone(session);

  const preview = previewSessionPatch(session, selectedCellIds, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-9,
    hexTwoToOneCompensation: {
      mode: "local-topology",
      maxAddedParentLayers: 1,
      maxAddedParentCount: 36
    }
  });

  assert.equal(preview.planMode, "aggregate");
  assert.equal(preview.twoToOne.status, "compensated");
  assert.deepEqual(session, before);
});

test("Hex 2:1 shell fallback snapshots compensation getters once per operation", () => {
  const diagnostics = [];
  for (const operation of ["preview", "refine"]) {
    const {
      session,
      firstRefined,
      candidate
    } = createTransitionShellRegressionFixture();
    const before = structuredClone(session);
    const reads = {
      mode: 0,
      maxAddedParentLayers: 0,
      maxAddedParentCount: 0
    };
    const compensation = {};
    Object.defineProperties(compensation, {
      mode: {
        enumerable: true,
        get() {
          reads.mode += 1;
          return reads.mode === 1 ? "local-topology" : "none";
        }
      },
      maxAddedParentLayers: {
        enumerable: true,
        get() {
          reads.maxAddedParentLayers += 1;
          return reads.maxAddedParentLayers === 1 ? 0 : 1;
        }
      },
      maxAddedParentCount: {
        enumerable: true,
        get() {
          reads.maxAddedParentCount += 1;
          return reads.maxAddedParentCount === 1 ? 32 : 0;
        }
      }
    });
    const options = {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      hexTwoToOneCompensation: compensation,
      activeBuild: firstRefined
    };
    const error = captureError(() => operation === "preview"
      ? previewSessionPatch(session, [candidate], options)
      : refineSessionPatch(session, [candidate], options));

    assert.equal(error instanceof TwoToOnePlanningError, true);
    assert.equal(error.code, "TWO_TO_ONE_COMPENSATION_LIMIT");
    assert.deepEqual(reads, {
      mode: 1,
      maxAddedParentLayers: 1,
      maxAddedParentCount: 1
    });
    assert.deepEqual(
      error.diagnostic.attemptedActions,
      [expectedTransitionShellRegressionAction]
    );
    assert.deepEqual(session, before);
    diagnostics.push(serializeTwoToOnePlanningError(error).diagnostic);
  }
  assert.deepEqual(diagnostics[1], diagnostics[0]);
});

test("Hex 2:1 shell fallback preserves dirty active-leaf caches on limit failure", () => {
  for (const operation of ["preview", "refine"]) {
    const {
      session,
      candidate
    } = createTransitionShellRegressionFixture();
    const command = session.undoStack.at(-1);
    assert.ok(command);
    assert.equal(undoRefinementSession(session)?.id, command.id);
    assert.equal(redoRefinementSession(session)?.id, command.id);
    assert.equal(session.sortedActiveLeafIdsDirty, true);
    const before = structuredClone(session);
    const options = {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      hexTwoToOneCompensation: {
        mode: "local-topology",
        maxAddedParentLayers: 0,
        maxAddedParentCount: 32
      }
    };

    const error = captureError(() => operation === "preview"
      ? previewSessionPatch(session, [candidate], options)
      : refineSessionPatch(session, [candidate], options));

    assert.equal(error instanceof TwoToOnePlanningError, true);
    assert.equal(error.code, "TWO_TO_ONE_COMPENSATION_LIMIT");
    assert.deepEqual(
      error.diagnostic.attemptedActions,
      [expectedTransitionShellRegressionAction]
    );
    assert.equal(session.revision, before.revision);
    assert.equal(session.sortedActiveLeafIdsDirty, true);
    assert.deepEqual(session, before);
  }
});

test("Hex 2:1 transition-shell rebuilding reports an untraceable support cell as a history conflict", () => {
  const {
    session,
    firstRefined,
    candidate
  } = createTransitionShellRegressionFixture();
  const supportCommand = session.undoStack.find((command) =>
    command.createdCellIds.includes(candidate)
  );
  assert.ok(supportCommand);
  replaceSessionCommand(session, supportCommand, {
    createdCellIds: supportCommand.createdCellIds.filter(
      (cellId) => cellId !== candidate
    )
  });
  const before = structuredClone(session);
  const options = transitionShellRegressionOptions(firstRefined);

  for (const operation of [
    () => previewSessionPatch(session, [candidate], options),
    () => refineSessionPatch(session, [candidate], options)
  ]) {
    const error = captureError(operation);
    assert.equal(
      error instanceof TwoToOnePlanningError,
      true,
      `${error?.constructor?.name}: ${error?.message}`
    );
    assert.equal(error.code, "TWO_TO_ONE_HISTORY_CONFLICT");
    assertFrozenPlanningDiagnostic(error);
    assert.match(
      error.message,
      /cannot trace cell .* to a refinement command/
    );
    assert.deepEqual(error.diagnostic.conflictingCellIds, [candidate]);
    assert.deepEqual(error.diagnostic.historyCommandIds, []);
    assert.deepEqual(session, before);
  }
});

test("Hex 2:1 transition-shell rebuilding joins connected support commands", () => {
  const {
    session,
    firstRefined
  } = createTransitionShellRegressionFixture();
  const boundaryCellIds = activeBoundaryCoreCellIds(session);
  const options = transitionShellRegressionOptions(firstRefined);
  const selectedCellIds = ["e115/2", "e164/2"];
  assert.equal(
    selectedCellIds.every((cellId) =>
      boundaryCellIds.includes(cellId)
    ),
    true
  );
  const supportCommand = session.undoStack.find((command) =>
    selectedCellIds.every((cellId) => command.createdCellIds.includes(cellId))
  );
  assert.ok(supportCommand);
  const splitCellId = selectedCellIds[1];
  const syntheticCommandId = "cmd-99";
  replaceSessionCommand(session, supportCommand, {
    createdCellIds: supportCommand.createdCellIds.filter(
      (cellId) => cellId !== splitCellId
    ),
    activeCreatedCellIds:
      supportCommand.activeCreatedCellIds?.filter(
        (cellId) => cellId !== splitCellId
      )
  });
  session.undoStack.push(Object.freeze({
    ...supportCommand,
    id: syntheticCommandId,
    hiddenCellIds: Object.freeze([]),
    createdCellIds: Object.freeze([splitCellId]),
    activeCreatedCellIds: Object.freeze([splitCellId]),
    createdNodeIds: Object.freeze([])
  }));
  const before = structuredClone(session);

  const preview = previewSessionPatch(
    session,
    selectedCellIds,
    options
  );
  assert.equal(preview.planMode, "aggregate");
  assert.equal(preview.twoToOne.status, "compensated");
  assert.deepEqual(session, before);

  const command = refineSessionPatch(
    session,
    selectedCellIds,
    options
  );
  const finalMesh = buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  assert.deepEqual(command.twoToOne, preview.twoToOne);
  assert.equal(checkNoHangingNodes(finalMesh, 1e-9).ok, true);
});

test("Hex 2:1 modified support routes through the public history transaction", () => {
  const {
    session,
    firstRefined
  } = createTransitionShellRegressionFixture();
  const supportCommand = session.undoStack.at(-1);
  assert.equal(supportCommand?.id, "cmd-1");
  const boundaryCellId = activeBoundaryCoreCellIds(session)[0];
  assert.ok(boundaryCellId);
  const centerCellId = supportCommand.createdCellIds
    .map((cellId) => {
      const cell = session.cells.get(cellId);
      if (
        cell?.level !== 1
        || cell.role !== "selected"
        || !session.activeLeafIds.has(cellId)
      ) {
        return undefined;
      }
      const center = cell.element.reduce((sum, nodeId) => {
        const point = session.nodes[nodeId - 1];
        return [
          sum[0] + point[0] / cell.element.length,
          sum[1] + point[1] / cell.element.length,
          sum[2] + point[2] / cell.element.length
        ];
      }, [0, 0, 0]);
      return {
        cellId,
        distance: center.reduce(
          (total, coordinate) => total + (coordinate - 0.5) ** 2,
          0
        )
      };
    })
    .filter(Boolean)
    .sort((first, second) => first.distance - second.distance)[0]?.cellId;
  assert.ok(centerCellId);
  assert.notEqual(centerCellId, boundaryCellId);

  const modifyingCommand = refineSessionPatch(session, [centerCellId], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: firstRefined
  });
  assert.equal(modifyingCommand.id, "cmd-2");
  assert.equal(modifyingCommand.hiddenCellIds.includes(centerCellId), true);
  assert.equal(
    checkNoHangingNodes(
      buildActiveMesh(session, {
        mergeNodes: true,
        mergeTolerance: 1e-9
      }),
      1e-9
    ).ok,
    true
  );
  const before = structuredClone(session);

  const preview = previewSessionPatch(
    session,
    [boundaryCellId],
    transitionShellRegressionOptions()
  );

  assert.equal(preview.planMode, "aggregate");
  assert.deepEqual(preview.compound, {
    kind: "transition-shell-rebuild"
  });
  assert.deepEqual(
    preview.twoToOne.originalSelectedCellIds,
    [boundaryCellId]
  );
  assert.equal(
    preview.twoToOne.effectiveSelectedCellIds.length,
    8
  );
  assert.deepEqual(session, before);
});

test("Hex 2:1 history transactions reject a nonconforming final replay atomically", () => {
  const {
    session,
    boundaryCellId
  } = createConsumedSupportHistoryFixture({
    rawNonconformingDownstream: true
  });
  const before = structuredClone(session);
  const options = transitionShellRegressionOptions();

  for (const operation of [
    () => previewSessionPatch(session, [boundaryCellId], options),
    () => refineSessionPatch(session, [boundaryCellId], options)
  ]) {
    const error = captureError(operation);
    assert.equal(
      error instanceof TwoToOnePlanningError,
      true,
      `${error?.constructor?.name}: ${error?.message}`
    );
    assert.equal(error.code, "TWO_TO_ONE_CONFORMANCE");
    assertFrozenPlanningDiagnostic(error);
    assert.deepEqual(error.diagnostic.conflictingCellIds, [boundaryCellId]);
    assert.deepEqual(session, before);
  }
});

test("Hex 2:1 history transaction planner replays a consumed support component atomically", () => {
  const mesh = createHexUnitCubeMesh(7, 7, 7);
  const session = createRefinementSession(mesh);
  const initial = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const firstCoreCellIds = idsInIndexBlock(
    7,
    7,
    7,
    [2, 2, 2],
    [4, 4, 4]
  ).map((elementId) =>
    activeBuildCellIdByElementId(initial, elementId)
  ).filter(Boolean);
  const supportCommand = refineSessionPatch(
    session,
    firstCoreCellIds,
    {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      activeBuild: initial
    }
  );
  const boundaryCellId = firstActiveBoundaryCoreCell(session);
  const centerCellId = supportCommand.createdCellIds
    .map((cellId) => {
      const cell = session.cells.get(cellId);
      if (
        cell?.level !== 1
        || cell.role !== "selected"
        || !session.activeLeafIds.has(cellId)
      ) {
        return undefined;
      }
      const center = cell.element.reduce((sum, nodeId) => {
        const point = session.nodes[nodeId - 1];
        return [
          sum[0] + point[0] / cell.element.length,
          sum[1] + point[1] / cell.element.length,
          sum[2] + point[2] / cell.element.length
        ];
      }, [0, 0, 0]);
      return {
        cellId,
        distance: center.reduce(
          (total, coordinate) => total + (coordinate - 0.5) ** 2,
          0
        )
      };
    })
    .filter(Boolean)
    .sort((first, second) => first.distance - second.distance)[0]?.cellId;
  assert.ok(boundaryCellId);
  assert.ok(centerCellId);
  assert.notEqual(boundaryCellId, centerCellId);

  const firstRefined = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const replayedCommand = refineSessionPatch(session, [centerCellId], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: firstRefined,
    mergeTolerance: 1e-9
  });
  assert.equal(replayedCommand.id, "cmd-2");
  assert.equal(session.cells.get(centerCellId)?.active, false);
  assert.equal(
    checkNoHangingNodes(
      buildActiveMesh(session, {
        mergeNodes: true,
        mergeTolerance: 1e-9
      }),
      1e-9
    ).ok,
    true
  );

  const farFieldCellIds = [...new Set([
    ...idsInIndexBlock(7, 7, 7, [6, 0, 0], [6, 6, 6]),
    ...idsInIndexBlock(7, 7, 7, [0, 6, 0], [6, 6, 6]),
    ...idsInIndexBlock(7, 7, 7, [0, 0, 6], [6, 6, 6])
  ])].map((elementId) =>
    activeBuildCellIdByElementId(initial, elementId)
  ).filter(Boolean);
  assert.equal(
    farFieldCellIds.every((cellId) => session.activeLeafIds.has(cellId)),
    true
  );

  const currentActive = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const requestOptions = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-9
  };
  const sourceSnapshot = structuredClone(session);
  const originalActiveCellIds =
    [...session.activeLeafIds].sort();
  const originalUndoCommandIds =
    session.undoStack.map((command) => command.id);
  const originalNextCommandId = session.nextCommandId;
  const originalNextCellOrdinal = session.nextCellOrdinal;
  const publicPreview = previewSessionPatch(
    session,
    [boundaryCellId],
    {
      ...requestOptions,
      activeBuild: currentActive
    }
  );
  assert.equal(publicPreview.planMode, "aggregate");
  assert.deepEqual(publicPreview.compound, {
    kind: "transition-shell-rebuild"
  });
  assert.deepEqual(session, sourceSnapshot);

  const compensation = normalizeTwoToOneCompensation(
    1,
    requestOptions
  );
  const resolution = currentActive.geometryResolution;
  assert.ok(resolution);
  const faceResolution = {
    tolerance: Math.max(
      1e-9,
      resolution.minimumElementEdgeLength * 1e-8,
      resolution.coordinateScale * Number.EPSILON * 64
    ),
    minimumElementEdgeLength:
      resolution.minimumElementEdgeLength,
    coordinateScale: resolution.coordinateScale,
    mergeTolerance: 1e-9
  };
  const transaction = planRefinementSessionHistoryTransaction(
    session,
    [boundaryCellId],
    {
      ...requestOptions,
      activeBuild: currentActive,
      hexTwoToOneCompensation: compensation,
      normalizedTwoToOneCompensation: compensation
    },
    faceResolution
  );

  assert.deepEqual(session, sourceSnapshot);
  assert.notStrictEqual(transaction.finalSession, session);
  assert.deepEqual(
    transaction.historyClosure.supportCommandIds,
    [supportCommand.id]
  );
  assert.deepEqual(
    transaction.historyClosure.downstreamCommandIds,
    [replayedCommand.id]
  );
  assert.deepEqual(
    transaction.finalSession.undoStack.map((command) => command.id),
    [supportCommand.id, replayedCommand.id, "cmd-3"]
  );
  assert.equal(transaction.finalSession.redoStack.length, 0);
  assert.equal(
    transaction.finalSession.nextCommandId,
    originalNextCommandId + 1
  );
  assert.equal(
    transaction.finalSession.nextCellOrdinal
      > originalNextCellOrdinal,
    true
  );
  assert.equal(transaction.command.id, "cmd-3");
  assert.strictEqual(
    transaction.finalSession.undoStack.at(-1),
    transaction.command
  );
  assert.equal(Object.isFrozen(transaction.command), true);
  assert.equal(
    transaction.finalSession.undoStack.some(
      (command) => Number(command.id.slice(4)) > 3
    ),
    false
  );
  assert.deepEqual(
    transaction.finalSession.undoStack[0].recipe,
    supportCommand.recipe
  );
  assert.deepEqual(
    transaction.finalSession.undoStack[1].recipe,
    replayedCommand.recipe
  );
  assert.notStrictEqual(
    transaction.finalSession.undoStack[0].recipe,
    supportCommand.recipe
  );
  assertFrozenRecipe(transaction.finalSession.undoStack[0].recipe);
  assertFrozenRecipe(transaction.finalSession.undoStack[1].recipe);
  assertFrozenRecipe(transaction.command.recipe);
  assert.equal(
    farFieldCellIds.every(
      (cellId) => transaction.finalSession.activeLeafIds.has(cellId)
    ),
    true
  );

  const finalMesh = buildActiveMesh(
    transaction.finalSession,
    {
      mergeNodes: true,
      mergeTolerance: 1e-9
    }
  );
  const finalActiveCellIds = [
    ...transaction.finalSession.activeLeafIds
  ].sort();
  const finalSortedActiveLeafIds = [
    ...transaction.finalSession.sortedActiveLeafIds
  ];
  const finalNextCommandId =
    transaction.finalSession.nextCommandId;
  const finalNextCellOrdinal =
    transaction.finalSession.nextCellOrdinal;
  assert.equal(
    transaction.finalSession.sortedActiveLeafIdsDirty,
    false
  );
  assert.deepEqual(transaction.preview.quality, transaction.command.quality);
  assert.deepEqual(
    transaction.preview.twoToOne,
    transaction.command.twoToOne
  );
  assert.deepEqual(
    publicPreview.twoToOne,
    transaction.preview.twoToOne
  );
  assert.deepEqual(
    publicPreview.quality,
    transaction.preview.quality
  );
  assert.deepEqual(
    publicPreview.summary,
    transaction.preview.summary
  );
  assert.deepEqual(transaction.preview.summary, {
    inputElementCount: currentActive.mesh.elements.length,
    changedInputElementCount: transaction.command.hiddenCellIds.length,
    preservedInputElementCount:
      currentActive.mesh.elements.length
      - transaction.command.hiddenCellIds.length,
    outputElementCount: finalMesh.elements.length
  });
  assert.equal(
    undoRefinementSession(transaction.finalSession)?.id,
    transaction.command.id
  );
  assert.deepEqual(
    [...transaction.finalSession.activeLeafIds].sort(),
    originalActiveCellIds
  );
  assert.equal(
    transaction.finalSession.sortedActiveLeafIdsDirty,
    true
  );
  assert.deepEqual(
    transaction.finalSession.sortedActiveLeafIds,
    finalSortedActiveLeafIds
  );
  assert.equal(
    transaction.finalSession.nextCommandId,
    finalNextCommandId
  );
  assert.equal(
    transaction.finalSession.nextCellOrdinal,
    finalNextCellOrdinal
  );
  assert.deepEqual(
    transaction.finalSession.undoStack.map(
      (command) => command.id
    ),
    originalUndoCommandIds
  );
  assert.deepEqual(
    buildActiveMesh(transaction.finalSession, {
      mergeNodes: true,
      mergeTolerance: 1e-9
    }),
    currentActive.mesh
  );
  const originalSortedActiveLeafIds = [
    ...transaction.finalSession.sortedActiveLeafIds
  ];
  assert.equal(
    redoRefinementSession(transaction.finalSession)?.id,
    transaction.command.id
  );
  assert.deepEqual(
    [...transaction.finalSession.activeLeafIds].sort(),
    finalActiveCellIds
  );
  assert.equal(
    transaction.finalSession.sortedActiveLeafIdsDirty,
    true
  );
  assert.deepEqual(
    transaction.finalSession.sortedActiveLeafIds,
    originalSortedActiveLeafIds
  );
  assert.equal(
    transaction.finalSession.nextCommandId,
    finalNextCommandId
  );
  assert.equal(
    transaction.finalSession.nextCellOrdinal,
    finalNextCellOrdinal
  );
  assert.deepEqual(
    buildActiveMesh(transaction.finalSession, {
      mergeNodes: true,
      mergeTolerance: 1e-9
    }),
    finalMesh
  );
});

test("Hex 2:1 history transactions replay none selection and local compensation without recursive fallback", () => {
  for (const mode of [
    "none",
    "selection",
    "local-topology"
  ]) {
    const {
      session,
      boundaryCellId,
      replayedCommand
    } = createConsumedSupportHistoryFixture({
      downstreamCompensationMode: mode
    });
    const {
      resolvedOptions,
      faceResolution
    } = createHistoryTransactionRequest(session, {
      hexTwoToOneCompensation: { mode },
      rebuildExistingTransitions: mode !== "none"
    });
    const before = structuredClone(session);
    const originalCommandCount = session.undoStack.length;
    const nextCommandId = session.nextCommandId;

    assert.equal(
      replayedCommand.recipe.options
        .hexTwoToOneCompensation.mode,
      mode
    );
    assert.equal(
      replayedCommand.recipe.options
        .rebuildExistingTransitions,
      mode !== "none"
    );
    assert.equal(replayedCommand.twoToOne?.status, "direct");

    const transaction =
      planRefinementSessionHistoryTransaction(
        session,
        [boundaryCellId],
        resolvedOptions,
        faceResolution
      );

    assert.deepEqual(session, before, mode);
    assert.equal(
      transaction.finalSession.undoStack.length,
      originalCommandCount + 1,
      mode
    );
    assert.deepEqual(
      transaction.finalSession.undoStack
        .slice(0, originalCommandCount)
        .map((command) => command.id),
      session.undoStack.map((command) => command.id),
      mode
    );
    assert.equal(
      transaction.finalSession.undoStack.some(
        (command) =>
          Number(command.id.slice(4)) > nextCommandId
      ),
      false,
      mode
    );
    assert.equal(
      transaction.command.twoToOne.status,
      "compensated",
      mode
    );
    assert.deepEqual(
      transaction.command.twoToOne.originalSelectedCellIds,
      [boundaryCellId],
      mode
    );
    assert.equal(
      transaction.command.twoToOne.effectiveSelectedCellIds
        .length,
      8,
      mode
    );
    assert.equal(
      transaction.command.twoToOne.effectiveSelectedCellIds
        .every((cellId) => {
          const cell =
            transaction.finalSession.cells.get(cellId);
          return cell?.active === true
            && cell.hidden === false
            && cell.role === "selected"
            && transaction.finalSession.activeLeafIds.has(cellId);
        }),
      true,
      mode
    );
  }
});

test("Hex 2:1 history transaction planner treats a real Stage A compound as support", () => {
  const {
    session,
    boundaryCellId,
    compoundCommand,
    resolvedOptions,
    faceResolution
  } = createCompoundDownstreamHistoryFixture();
  assert.equal(
    compoundCommand.twoToOne.actions.some(
      (action) => action.kind === "transition-shell-rebuild"
    ),
    true
  );
  assert.notDeepEqual(
    [...compoundCommand.activeCreatedCellIds].sort(),
    [...compoundCommand.createdCellIds].sort()
  );
  const publicHistoryClosure = api.buildRefinementHistoryClosure(
    api.buildRefinementHistoryIndex(
      session.undoStack,
      [...session.cells.keys()]
    ),
    {
      seedCellIds: compoundCommand.recipe.selectedCellIds,
      componentCellIds: new Set(session.cells.keys())
    }
  );
  assert.deepEqual(
    publicHistoryClosure.downstreamCommandIds,
    [compoundCommand.id]
  );
  const before = structuredClone(session);

  const error = captureError(() =>
    planRefinementSessionHistoryTransaction(
      session,
      [boundaryCellId],
      resolvedOptions,
      faceResolution
    )
  );

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(
    error.code,
    "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY",
    error.message
  );
  assert.notEqual(
    error.diagnostic.historyCommandIds?.includes(
      compoundCommand.id
    ),
    true
  );
  assert.deepEqual(session, before);
});

test("history replay eligibility accepts ordinary and selection-compensated commands", async () => {
  const directSessionModule = await import(
    "../dist/refinement-session.js"
  );
  const isEligible =
    directSessionModule
      .isRefinementSessionHistoryCommandRecipeReplayEligible;
  assert.equal(typeof isEligible, "function");

  const ordinarySession = createRefinementSession(
    createHexUnitCubeMesh(1, 1, 1)
  );
  const ordinaryCommand = refineSessionPatch(
    ordinarySession,
    ["e1"],
    {
      hexRefinementRatio: 2,
      includeTransitions: false
    }
  );
  assert.equal(isEligible(ordinaryCommand), true);

  const selectionSession = createRefinementSession(
    createHexUnitCubeMesh(2, 2, 5)
  );
  const selectionCommand = refineSessionPatch(
    selectionSession,
    ["e5", "e6", "e7", "e8"],
    {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      hexTwoToOneCompensation: {
        mode: "selection"
      }
    }
  );
  assert.equal(selectionCommand.twoToOne.status, "compensated");
  assert.equal(isEligible(selectionCommand), true);

  const {
    compoundCommand
  } = createCompoundDownstreamHistoryFixture();
  assert.equal(isEligible(compoundCommand), false);
});

test("Hex 2:1 history transaction planner replays three ordinary downstream commands", () => {
  const dimension = 9;
  const session = createRefinementSession(
    createHexUnitCubeMesh(
      dimension,
      dimension,
      dimension
    )
  );
  const initial = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const firstCoreCellIds = idsInIndexBlock(
    dimension,
    dimension,
    dimension,
    [2, 2, 2],
    [6, 6, 6]
  ).map((elementId) =>
    activeBuildCellIdByElementId(initial, elementId)
  ).filter(Boolean);
  refineSessionPatch(session, firstCoreCellIds, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: initial,
    mergeTolerance: 1e-9
  });
  const boundaryCellId = firstActiveBoundaryCoreCell(session);
  assert.ok(boundaryCellId);
  const replayedCommand = refineSessionPatch(
    session,
    centralActiveSelectedCellBlock(session, 1, 4),
    {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      activeBuild: buildActiveMeshWithMap(session, {
        mergeNodes: true,
        mergeTolerance: 1e-9
      }),
      mergeTolerance: 1e-9
    }
  );
  const secondDownstream = refineSessionPatch(
    session,
    centralActiveSelectedCellBlock(session, 2, 4),
    {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      activeBuild: buildActiveMeshWithMap(session, {
        mergeNodes: true,
        mergeTolerance: 1e-9
      }),
      mergeTolerance: 1e-9
    }
  );
  const thirdDownstream = refineSessionPatch(
    session,
    centralActiveSelectedCellBlock(session, 3, 3),
    {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      activeBuild: buildActiveMeshWithMap(session, {
        mergeNodes: true,
        mergeTolerance: 1e-9
      }),
      mergeTolerance: 1e-9
    }
  );
  const {
    resolvedOptions,
    faceResolution
  } = createHistoryTransactionRequest(session);
  const before = structuredClone(session);

  const transaction =
    planRefinementSessionHistoryTransaction(
      session,
      [boundaryCellId],
      resolvedOptions,
      faceResolution
    );

  assert.deepEqual(session, before);
  assert.deepEqual(
    transaction.historyClosure.downstreamCommandIds,
    [
      replayedCommand.id,
      secondDownstream.id,
      thirdDownstream.id
    ]
  );
  assert.deepEqual(
    transaction.finalSession.undoStack
      .slice(0, -1)
      .map((command) => command.id),
    session.undoStack.map((command) => command.id)
  );
});

test("activated-cell hierarchy checks do not scan unrelated far-field cells", async () => {
  const directSessionModule = await import(
    "../dist/refinement-session.js"
  );
  const assertActivatedCells =
    directSessionModule
      .assertActivatedRefinementSessionCellsHaveNoActiveRelations;
  assert.equal(typeof assertActivatedCells, "function");

  const cells = new Map([
    ["root", {
      id: "root",
      active: false,
      hidden: true,
      children: ["activated"]
    }],
    ["activated", {
      id: "activated",
      parentId: "root",
      active: true,
      hidden: false,
      children: ["descendant"]
    }],
    ["descendant", {
      id: "descendant",
      parentId: "activated",
      active: false,
      hidden: true,
      children: []
    }]
  ]);
  let unrelatedCellReads = 0;
  for (let ordinal = 0; ordinal < 5000; ordinal += 1) {
    const id = `far-${ordinal}`;
    cells.set(id, new Proxy({
      id,
      active: true,
      hidden: false,
      children: []
    }, {
      get(target, property, receiver) {
        unrelatedCellReads += 1;
        return Reflect.get(target, property, receiver);
      }
    }));
  }
  const originalValues = cells.values.bind(cells);
  let valuesCallCount = 0;
  Object.defineProperty(cells, "values", {
    value() {
      valuesCallCount += 1;
      return originalValues();
    }
  });
  const session = { cells };

  assert.doesNotThrow(() =>
    assertActivatedCells(session, ["activated"])
  );
  assert.equal(valuesCallCount, 0);
  assert.equal(unrelatedCellReads, 0);

  cells.get("root").active = true;
  cells.get("root").hidden = false;
  assert.throws(
    () => assertActivatedCells(session, ["activated"]),
    /active cell root has active descendant activated/
  );
  cells.get("root").active = false;
  cells.get("root").hidden = true;
  cells.get("descendant").active = true;
  cells.get("descendant").hidden = false;
  assert.throws(
    () => assertActivatedCells(session, ["activated"]),
    /active cell activated has active descendant descendant/
  );
  assert.equal(valuesCallCount, 0);
  assert.equal(unrelatedCellReads, 0);
});

test("Hex 2:1 history transaction planner maps a real generic command without a recipe atomically", () => {
  const {
    session,
    boundaryCellId,
    replayedCommand,
    resolvedOptions,
    faceResolution
  } = createConsumedSupportHistoryFixture({
    genericDownstream: true
  });
  assert.equal(Object.hasOwn(replayedCommand, "recipe"), false);
  const before = structuredClone(session);

  const error = captureError(() =>
    planRefinementSessionHistoryTransaction(
      session,
      [boundaryCellId],
      resolvedOptions,
      faceResolution
    )
  );

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_HISTORY_CONFLICT");
  assert.deepEqual(
    error.diagnostic.historyCommandIds,
    [replayedCommand.id]
  );
  assert.deepEqual(error.diagnostic.conflictingCellIds, []);
  assert.deepEqual(session, before);
});

test("Hex 2:1 history transactions reject unsupported recipe versions atomically", () => {
  const {
    session,
    boundaryCellId,
    replayedCommand
  } = createConsumedSupportHistoryFixture();
  assert.ok(replayedCommand.recipe);
  replaceSessionCommand(session, replayedCommand, {
    recipe: Object.freeze({
      ...replayedCommand.recipe,
      version: 2
    })
  });
  const before = structuredClone(session);
  const options = transitionShellRegressionOptions();

  for (const operation of [
    () => previewSessionPatch(session, [boundaryCellId], options),
    () => refineSessionPatch(session, [boundaryCellId], options)
  ]) {
    const error = captureError(operation);
    assert.equal(error instanceof TwoToOnePlanningError, true);
    assert.equal(error.code, "TWO_TO_ONE_HISTORY_CONFLICT");
    assert.deepEqual(
      error.diagnostic.historyCommandIds,
      [replayedCommand.id]
    );
    assert.deepEqual(session, before);
  }
});

test("Hex 2:1 untouched support rejects unsupported recipe versions atomically", () => {
  const {
    session,
    candidate: boundaryCellId
  } = createTransitionShellRegressionFixture();
  const supportCommand = session.undoStack.at(-1);
  assert.ok(supportCommand?.recipe);
  replaceSessionCommand(session, supportCommand, {
    recipe: Object.freeze({
      ...supportCommand.recipe,
      version: 2
    })
  });
  const before = structuredClone(session);
  const options = transitionShellRegressionOptions();

  for (const operation of [
    () => previewSessionPatch(session, [boundaryCellId], options),
    () => refineSessionPatch(session, [boundaryCellId], options)
  ]) {
    const error = captureError(operation);
    assert.equal(error instanceof TwoToOnePlanningError, true);
    assert.equal(error.code, "TWO_TO_ONE_HISTORY_CONFLICT");
    assert.deepEqual(
      error.diagnostic.historyCommandIds,
      [supportCommand.id]
    );
    assert.deepEqual(session, before);
  }
});

test("history recipe remapping converts real zero and duplicate geometry matches to history conflicts", async () => {
  const directSessionModule = await import(
    "../dist/refinement-session.js"
  );
  const remap =
    directSessionModule.remapRefinementSessionHistoryRecipeCells;
  assert.equal(typeof remap, "function");

  const session = createRefinementSession(
    createHexUnitCubeMesh(1, 1, 1)
  );
  const command = refineSessionPatch(session, ["e1"], {
    hexRefinementRatio: 2,
    includeTransitions: false
  });
  const geometry = command.recipe.selectedCellGeometry[0];
  const historyCommandIds = [command.id];

  const noMatchError = captureError(() =>
    remap(
      new RefinementCellGeometryIndex(1e-9),
      command.recipe.selectedCellIds,
      command.recipe.selectedCellGeometry,
      "selection",
      historyCommandIds
    )
  );
  assert.equal(noMatchError.code, "TWO_TO_ONE_HISTORY_CONFLICT");
  assert.deepEqual(
    noMatchError.diagnostic.conflictingCellIds,
    ["e1"]
  );
  assert.deepEqual(
    noMatchError.diagnostic.historyCommandIds,
    historyCommandIds
  );

  const duplicateIndex = new RefinementCellGeometryIndex(1e-9);
  duplicateIndex.add("duplicate-a", geometry);
  duplicateIndex.add("duplicate-b", geometry);
  const ambiguousError = captureError(() =>
    remap(
      duplicateIndex,
      command.recipe.selectedCellIds,
      command.recipe.selectedCellGeometry,
      "selection",
      historyCommandIds
    )
  );
  assert.equal(
    ambiguousError.code,
    "TWO_TO_ONE_HISTORY_CONFLICT"
  );
  assert.deepEqual(
    ambiguousError.diagnostic.conflictingCellIds,
    ["e1", "duplicate-a", "duplicate-b"]
  );
  assert.deepEqual(
    ambiguousError.diagnostic.historyCommandIds,
    historyCommandIds
  );
});

test("Hex 2:1 history transaction rejects ambiguous active replay geometry atomically", () => {
  const {
    session,
    boundaryCellId,
    supportCommand,
    replayedCommand
  } = createConsumedSupportHistoryFixture();
  const sourceCell = session.cells.get(boundaryCellId);
  assert.ok(sourceCell);
  const duplicateCellId = `${boundaryCellId}-duplicate`;
  const duplicateOrdinal = session.nextCellOrdinal;
  session.nextCellOrdinal += 1;
  session.cells.set(duplicateCellId, {
    ...sourceCell,
    id: duplicateCellId,
    ordinal: duplicateOrdinal,
    parentId: undefined,
    element: [...sourceCell.element],
    children: [],
    active: false,
    hidden: true
  });
  const independentCommand = refineSessionPatch(
    session,
    ["e343"],
    {
      hexRefinementRatio: 2,
      includeTransitions: false
    }
  );
  replaceSessionCommand(session, independentCommand, {
    hiddenCellIds: [
      ...independentCommand.hiddenCellIds,
      duplicateCellId
    ]
  });
  session.sortedActiveLeafIdsDirty = true;
  const {
    resolvedOptions,
    faceResolution
  } = createHistoryTransactionRequest(session);
  const before = structuredClone(session);
  const expectedConflictingCellIds = [
    boundaryCellId,
    "e115/15",
    duplicateCellId
  ];

  for (const operation of [
    () => planRefinementSessionHistoryTransaction(
      session,
      [boundaryCellId],
      resolvedOptions,
      faceResolution
    ),
    () => previewSessionPatch(
      session,
      [boundaryCellId],
      {
        ...resolvedOptions,
        activeBuild: resolvedOptions.activeBuild
      }
    )
  ]) {
    const error = captureError(operation);
    assert.equal(error instanceof TwoToOnePlanningError, true);
    assert.equal(
      error.code,
      "TWO_TO_ONE_HISTORY_CONFLICT",
      error.message
    );
    assert.deepEqual(
      error.diagnostic.conflictingCellIds,
      expectedConflictingCellIds
    );
    assert.deepEqual(
      error.diagnostic.historyCommandIds,
      [supportCommand.id, replayedCommand.id]
    );
    assert.deepEqual(session, before);
  }
});

test("Hex 2:1 history transaction planner preserves an independent later command", () => {
  const dimension = 7;
  const component = createHexUnitCubeMesh(
    dimension,
    dimension,
    dimension
  );
  const nodeOffset = component.nodes.length;
  const elementOffset = component.elements.length;
  const session = createRefinementSession({
    kind: "H1",
    nodes: [
      ...component.nodes.map((point) => [...point]),
      ...component.nodes.map(([x, y, z]) => [
        x + 2,
        y,
        z
      ])
    ],
    elements: [
      ...component.elements.map((element) => [...element]),
      ...component.elements.map((element) =>
        element.map((nodeId) => nodeId + nodeOffset)
      )
    ]
  });
  const initial = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const supportCommand = refineSessionPatch(
    session,
    idsInIndexBlock(
      dimension,
      dimension,
      dimension,
      [2, 2, 2],
      [4, 4, 4]
    ).map((elementId) =>
      activeBuildCellIdByElementId(initial, elementId)
    ).filter(Boolean),
    {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      activeBuild: initial,
      mergeTolerance: 1e-9
    }
  );
  const boundaryCellId = firstActiveBoundaryCoreCell(session);
  assert.ok(boundaryCellId);
  const nestedCellId = nearestActiveSelectedCreatedCell(
    session,
    supportCommand,
    [0.5, 0.5, 0.5]
  );
  const replayedCommand = refineSessionPatch(
    session,
    [nestedCellId],
    {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      activeBuild: buildActiveMeshWithMap(session, {
        mergeNodes: true,
        mergeTolerance: 1e-9
      }),
      mergeTolerance: 1e-9
    }
  );
  const independentCommand = refineSessionCells(
    session,
    component.elements.map((_, index) =>
      activeBuildCellIdByElementId(
        initial,
        index + 1 + elementOffset
      )
    ).filter(Boolean),
    refineHexTo8Hex
  );
  const independentActiveCellIds =
    independentCommand.createdCellIds.filter(
      (cellId) => session.activeLeafIds.has(cellId)
    );
  const currentActive = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const requestOptions = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-9
  };
  const compensation = normalizeTwoToOneCompensation(
    1,
    requestOptions
  );
  const resolution = currentActive.geometryResolution;
  assert.ok(resolution);
  const before = structuredClone(session);

  const transaction = planRefinementSessionHistoryTransaction(
    session,
    [boundaryCellId],
    {
      ...requestOptions,
      activeBuild: currentActive,
      hexTwoToOneCompensation: compensation,
      normalizedTwoToOneCompensation: compensation
    },
    {
      tolerance: Math.max(
        1e-9,
        resolution.minimumElementEdgeLength * 1e-8,
        resolution.coordinateScale * Number.EPSILON * 64
      ),
      minimumElementEdgeLength:
        resolution.minimumElementEdgeLength,
      coordinateScale: resolution.coordinateScale,
      mergeTolerance: 1e-9
    }
  );

  assert.deepEqual(session, before);
  assert.deepEqual(
    transaction.historyClosure.preservedCommandIds,
    [independentCommand.id]
  );
  assert.deepEqual(
    transaction.finalSession.undoStack.map((command) => command.id),
    [
      supportCommand.id,
      replayedCommand.id,
      independentCommand.id,
      "cmd-4"
    ]
  );
  assert.equal(
    independentActiveCellIds.every((cellId) =>
      transaction.finalSession.activeLeafIds.has(cellId)
    ),
    true
  );
  assert.deepEqual(
    transaction.finalSession.undoStack[2].recipe,
    independentCommand.recipe
  );
  assert.deepEqual(
    transaction.finalSession.undoStack
      .slice(0, -1)
      .map((command) => command.id),
    session.undoStack.map((command) => command.id)
  );
  assert.deepEqual(
    independentCommand.createdCellIds
      .filter((cellId) =>
        transaction.finalSession.activeLeafIds.has(cellId)
      )
      .sort(),
    independentActiveCellIds.sort()
  );
});

test("Hex 2:1 history transaction planning preserves dirty source caches on success and failure", () => {
  for (const outcome of ["success", "limit"]) {
    const {
      session,
      boundaryCellId,
      replayedCommand,
      resolvedOptions,
      faceResolution
    } = createConsumedSupportHistoryFixture();
    assert.equal(
      undoRefinementSession(session)?.id,
      replayedCommand.id
    );
    assert.equal(
      redoRefinementSession(session)?.id,
      replayedCommand.id
    );
    assert.equal(session.sortedActiveLeafIdsDirty, true);
    const before = structuredClone(session);

    if (outcome === "success") {
      const transaction =
        planRefinementSessionHistoryTransaction(
          session,
          [boundaryCellId],
          resolvedOptions,
          faceResolution
        );
      assert.ok(transaction.command);
    } else {
      const compensation = {
        mode: "local-topology",
        maxAddedParentLayers: 1,
        maxAddedParentCount: 0
      };
      const error = captureError(() =>
        planRefinementSessionHistoryTransaction(
          session,
          [boundaryCellId],
          {
            ...resolvedOptions,
            hexTwoToOneCompensation: compensation,
            normalizedTwoToOneCompensation: compensation
          },
          faceResolution
        )
      );
      assert.equal(
        error.code,
        "TWO_TO_ONE_COMPENSATION_LIMIT"
      );
    }

    assert.deepEqual(session, before, outcome);
    assert.equal(session.sortedActiveLeafIdsDirty, true);
  }
});

test("Hex 2:1 history transaction planning clears only the cloned redo history", () => {
  const {
    session,
    boundaryCellId,
    supportCommand,
    replayedCommand
  } = createConsumedSupportHistoryFixture();
  assert.equal(
    undoRefinementSession(session)?.id,
    replayedCommand.id
  );
  const {
    resolvedOptions,
    faceResolution
  } = createHistoryTransactionRequest(session);
  const before = structuredClone(session);

  const transaction =
    planRefinementSessionHistoryTransaction(
      session,
      [boundaryCellId],
      resolvedOptions,
      faceResolution
    );

  assert.deepEqual(session, before);
  assert.deepEqual(
    session.redoStack.map((command) => command.id),
    [replayedCommand.id]
  );
  assert.deepEqual(
    transaction.historyClosure.supportCommandIds,
    [supportCommand.id]
  );
  assert.deepEqual(
    transaction.historyClosure.downstreamCommandIds,
    []
  );
  assert.deepEqual(
    transaction.finalSession.undoStack.map(
      (command) => command.id
    ),
    [supportCommand.id, "cmd-3"]
  );
  assert.deepEqual(transaction.finalSession.redoStack, []);
});

test("Hex 2:1 history transaction clones named sets and extra session structure", () => {
  const {
    session,
    boundaryCellId,
    resolvedOptions,
    faceResolution
  } = createConsumedSupportHistoryFixture();
  session.namedSets = {
    cellSets: new Map([
      ["REQUEST", [boundaryCellId]]
    ]),
    nodeSets: {
      CORNER: [1, 2, 3]
    }
  };
  session.extra = {
    labels: ["source"],
    nested: {
      retained: true
    }
  };
  session.baseMesh.namedSets = {
    BASE: ["e1"]
  };
  const before = structuredClone(session);

  const transaction =
    planRefinementSessionHistoryTransaction(
      session,
      [boundaryCellId],
      resolvedOptions,
      faceResolution
    );

  assert.deepEqual(session, before);
  assert.deepEqual(
    transaction.finalSession.namedSets,
    session.namedSets
  );
  assert.deepEqual(
    transaction.finalSession.extra,
    session.extra
  );
  assert.deepEqual(
    transaction.finalSession.baseMesh.namedSets,
    session.baseMesh.namedSets
  );
  assert.notStrictEqual(
    transaction.finalSession.namedSets,
    session.namedSets
  );
  assert.notStrictEqual(
    transaction.finalSession.namedSets.cellSets,
    session.namedSets.cellSets
  );
  assert.notStrictEqual(
    transaction.finalSession.extra.nested,
    session.extra.nested
  );
  assert.notStrictEqual(
    transaction.finalSession.baseMesh.namedSets,
    session.baseMesh.namedSets
  );
});

test("Hex 2:1 history transaction planner preserves untouched support components and rejects compensation overflow atomically", () => {
  {
    const mesh = createHexUnitCubeMesh(9, 9, 9);
    const session = createRefinementSession(mesh);
    const initial = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance: 1e-9
    });
    const firstCoreCellIds = [
      ...idsInIndexBlock(9, 9, 9, [1, 1, 2], [2, 2, 3]),
      ...idsInIndexBlock(9, 9, 9, [6, 6, 2], [7, 7, 3])
    ].map((elementId) =>
      activeBuildCellIdByElementId(initial, elementId)
    ).filter(Boolean);
    const supportCommand = refineSessionPatch(
      session,
      firstCoreCellIds,
      {
        hexRefinementRatio: 2,
        hexTwoToOneSelectionMode: "local",
        includeTransitions: true,
        activeBuild: initial
      }
    );
    const classified = supportCommand.createdCellIds
      .map((cellId) => {
        const cell = session.cells.get(cellId);
        if (
          !cell?.active
          || cell.level !== 1
          || cell.role !== "selected"
        ) {
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
        return { cellId, center };
      })
      .filter(Boolean);
    const leftCandidate = classified
      .filter(({ center }) => center[0] < 0.5)
      .sort((first, second) =>
        first.center.reduce((sum, value) => sum + value, 0)
        - second.center.reduce((sum, value) => sum + value, 0)
      )[0]?.cellId;
    const rightComponentCellIds = classified
      .filter(({ center }) =>
        center[0] > 0.5 && center[1] > 0.5
      )
      .map(({ cellId }) => cellId);
    const rightComponentParentIds = new Set(
      rightComponentCellIds
        .map((cellId) => session.cells.get(cellId)?.parentId)
        .filter(Boolean)
    );
    assert.ok(leftCandidate);
    assert.ok(rightComponentCellIds.length > 0);
    const activeBuild = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance: 1e-9
    });
    const requestOptions = {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      mergeTolerance: 1e-9
    };
    const compensation = normalizeTwoToOneCompensation(
      1,
      requestOptions
    );
    const resolution = activeBuild.geometryResolution;
    assert.ok(resolution);
    const before = structuredClone(session);

    const transaction =
      planRefinementSessionHistoryTransaction(
        session,
        [leftCandidate],
        {
          ...requestOptions,
          activeBuild,
          hexTwoToOneCompensation: compensation,
          normalizedTwoToOneCompensation: compensation
        },
        {
          tolerance: Math.max(
            1e-9,
            resolution.minimumElementEdgeLength * 1e-8,
            resolution.coordinateScale * Number.EPSILON * 64
          ),
          minimumElementEdgeLength:
            resolution.minimumElementEdgeLength,
          coordinateScale: resolution.coordinateScale,
          mergeTolerance: 1e-9
        }
      );

    assert.deepEqual(session, before);
    assert.deepEqual(
      transaction.historyClosure.supportCommandIds,
      [supportCommand.id]
    );
    assert.deepEqual(
      transaction.historyClosure.downstreamCommandIds,
      []
    );
    assert.equal(
      transaction.historyClosure.affectedInputCellIds.every(
        (cellId) => !rightComponentParentIds.has(cellId)
      ),
      true
    );
    assert.equal(
      rightComponentCellIds.every((cellId) =>
        transaction.finalSession.activeLeafIds.has(cellId)
      ),
      true
    );
    assert.equal(
      rightComponentCellIds.every((cellId) =>
        !transaction.command.hiddenCellIds.includes(cellId)
      ),
      true
    );
  }

  {
    const {
      session,
      boundaryCellId,
      resolvedOptions,
      faceResolution
    } = createConsumedSupportHistoryFixture();
    const compensation = {
      mode: "local-topology",
      maxAddedParentLayers: 1,
      maxAddedParentCount: 0
    };
    const before = structuredClone(session);

    const error = captureError(() =>
      planRefinementSessionHistoryTransaction(
        session,
        [boundaryCellId],
        {
          ...resolvedOptions,
          hexTwoToOneCompensation: compensation,
          normalizedTwoToOneCompensation: compensation
        },
        faceResolution
      )
    );

    assert.equal(
      error.code,
      "TWO_TO_ONE_COMPENSATION_LIMIT"
    );
    assert.deepEqual(session, before);
  }
});

test("Hex 2:1 transition-shell rebuilding reports a modified support layer as a history conflict", () => {
  const {
    session,
    candidate
  } = createTransitionShellRegressionFixture();
  const supportCommand = session.undoStack.find((command) =>
    command.createdCellIds.includes(candidate)
  );
  assert.ok(supportCommand);
  const modifiedCellId = supportCommand.createdCellIds.find((cellId) => {
    const cell = session.cells.get(cellId);
    return cellId !== candidate
      && cell?.level === 1
      && session.activeLeafIds.has(cellId);
  });
  assert.ok(modifiedCellId);
  const modifiedCell = session.cells.get(modifiedCellId);
  modifiedCell.active = false;
  modifiedCell.hidden = true;
  session.activeLeafIds.delete(modifiedCellId);
  session.sortedActiveLeafIdsDirty = true;
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const before = structuredClone(session);
  const options = transitionShellRegressionOptions(active);

  for (const operation of [
    () => previewSessionPatch(session, [candidate], options),
    () => refineSessionPatch(session, [candidate], options)
  ]) {
    const error = captureError(operation);
    assert.equal(
      error instanceof TwoToOnePlanningError,
      true,
      `${error?.constructor?.name}: ${error?.message}`
    );
    assert.equal(error.code, "TWO_TO_ONE_HISTORY_CONFLICT");
    assert.match(error.message, /requires an untouched supporting layer/);
    assert.deepEqual(
      error.diagnostic.conflictingCellIds,
      [modifiedCellId]
    );
    assert.deepEqual(
      error.diagnostic.historyCommandIds,
      [supportCommand.id]
    );
    assert.deepEqual(session, before);
  }
});

test("Hex 2:1 transition-shell rebuilding reports unauthorized support completion as a history conflict", () => {
  const {
    session,
    candidate
  } = createTransitionShellRegressionFixture();
  const supportCommand = session.undoStack.find((command) =>
    command.createdCellIds.includes(candidate)
  );
  assert.ok(supportCommand);
  for (const cellId of session.activeLeafIds) {
    const cell = session.cells.get(cellId);
    if (cell?.level === 0) {
      cell.parentId = "synthetic-history-root";
    }
  }
  const before = structuredClone(session);
  const options = transitionShellRegressionOptions();

  for (const operation of [
    () => previewSessionPatch(session, [candidate], options),
    () => refineSessionPatch(session, [candidate], options)
  ]) {
    const error = captureError(operation);
    assert.equal(
      error instanceof TwoToOnePlanningError,
      true,
      `${error?.constructor?.name}: ${error?.message}`
    );
    assert.equal(error.code, "TWO_TO_ONE_HISTORY_CONFLICT");
    assert.match(error.message, /cross the authorized support component/);
    assert.deepEqual(error.diagnostic.conflictingCellIds, ["e58"]);
    assert.deepEqual(
      error.diagnostic.historyCommandIds,
      [supportCommand.id]
    );
    assert.deepEqual(session, before);
  }
});

test("Hex 2:1 transition-shell rebuilding reports crossed command provenance as a history conflict", () => {
  const {
    session,
    candidate
  } = createTransitionShellRegressionFixture();
  const supportCommand = session.undoStack.find((command) =>
    command.createdCellIds.includes(candidate)
  );
  assert.ok(supportCommand);
  const provenanceCellId = "e2";
  const provenanceCell = session.cells.get(provenanceCellId);
  assert.ok(provenanceCell);
  provenanceCell.parentId = "synthetic-history-root";
  const before = structuredClone(session);
  const options = transitionShellRegressionOptions();

  for (const operation of [
    () => previewSessionPatch(session, [candidate], options),
    () => refineSessionPatch(session, [candidate], options)
  ]) {
    const error = captureError(operation);
    assert.equal(
      error instanceof TwoToOnePlanningError,
      true,
      `${error?.constructor?.name}: ${error?.message}`
    );
    assert.equal(error.code, "TWO_TO_ONE_HISTORY_CONFLICT");
    assert.match(error.message, /cross refinement-command provenance/);
    assert.deepEqual(
      error.diagnostic.conflictingCellIds,
      [provenanceCellId]
    );
    assert.deepEqual(
      error.diagnostic.historyCommandIds,
      [supportCommand.id]
    );
    assert.deepEqual(session, before);
  }
});

test("Hex 2:1 transition-shell rebuilding preserves unknown planner errors by identity", () => {
  for (const operation of ["preview", "refine"]) {
    const {
      session,
      firstRefined,
      candidate
    } = createTransitionShellRegressionFixture();
    const supportCommandIndex = session.undoStack.findIndex((command) =>
      command.createdCellIds.includes(candidate)
    );
    assert.notEqual(supportCommandIndex, -1);
    const supportCommand = session.undoStack[supportCommandIndex];
    const before = structuredClone(session);
    const invariant = new Error("planner invariant probe");
    session.undoStack[supportCommandIndex] = new Proxy(supportCommand, {
      get(target, property, receiver) {
        if (property === "createdCellIds") {
          throw invariant;
        }
        return Reflect.get(target, property, receiver);
      }
    });
    const options = transitionShellRegressionOptions(firstRefined);
    const invoke = operation === "preview"
      ? () => previewSessionPatch(session, [candidate], options)
      : () => refineSessionPatch(session, [candidate], options);

    const error = captureError(invoke);

    session.undoStack[supportCommandIndex] = supportCommand;
    assert.equal(error, invariant);
    assert.deepEqual(session, before);
  }
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
  const before = structuredClone(session);
  const error = captureError(() => refineSessionPatch(
    session,
    [boundaryCandidate.cellId],
    {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      hexTwoToOneCompensation: {
        mode: "none"
      },
      activeBuild: firstRefined
    }
  ));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_CONFORMANCE");
  assert.match(
    error.message,
    /would create a nonconforming interface with an existing transition layer/
  );
  assert.deepEqual(error.diagnostic.conflictingCellIds, [
    boundaryCandidate.cellId
  ]);
  assert.deepEqual(error.diagnostic.conflictingInterfaces, []);
  assert.deepEqual(error.diagnostic.attemptedActions, []);
  assert.deepEqual(error.diagnostic.suggestion, {
    kind: "expand-selection"
  });
  assert.deepEqual(session, before);
  assert.equal(checkNoHangingNodes(firstRefined.mesh, 1e-9).ok, true);

  const script = {
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
  };
  const strictError = captureError(() => replayHexRefineCommandScript(
    script,
    { strict: true }
  ));
  assert.equal(strictError instanceof TwoToOnePlanningError, true);
  assert.equal(strictError.code, "TWO_TO_ONE_CONFORMANCE");
  assert.deepEqual(strictError.diagnostic.conflictingCellIds, [
    boundaryCandidate.cellId
  ]);

  const baseline = replayHexRefineCommandScript({
    ...script,
    commands: script.commands.slice(0, 2)
  });
  const replay = replayHexRefineCommandScript(script);
  assert.deepEqual(replay.session, baseline.session);
  assert.deepEqual(replay.mesh, baseline.mesh);
  assert.deepEqual(replay.warnings, [
    "refine.patch skipped after TWO_TO_ONE_CONFORMANCE: "
      + EXISTING_TRANSITION_COLLISION_TEST_MESSAGE
  ]);
});

test("Hex 2:1 selection compensation never rebuilds an existing transition shell", () => {
  const {
    session,
    firstRefined,
    candidate
  } = createTransitionShellRegressionFixture();
  const before = structuredClone(session);
  const error = captureError(() => refineSessionPatch(session, [candidate], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    hexTwoToOneCompensation: {
      mode: "selection",
      maxAddedParentLayers: 1,
      maxAddedParentCount: 32
    },
    activeBuild: firstRefined
  }));

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(error.code, "TWO_TO_ONE_CONFORMANCE");
  assert.deepEqual(error.diagnostic.conflictingCellIds, [candidate]);
  assert.deepEqual(error.diagnostic.conflictingInterfaces, []);
  assert.deepEqual(error.diagnostic.attemptedActions, []);
  assert.deepEqual(session, before);
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
  const boundaryCellForFaceDiagnostic = session.cells.get(boundaryCellId);
  const transitionFaceByCoordinate = new Map();
  for (const transitionCellId of session.activeLeafIds) {
    const transitionCell = session.cells.get(transitionCellId);
    if (!String(transitionCell?.role).includes("transition")) {
      continue;
    }
    for (const face of H1_TEST_FACES) {
      transitionFaceByCoordinate.set(
        testFaceCoordinateKey(session, transitionCell, face),
        { cell: transitionCell, face }
      );
    }
  }
  const sharedFaceDiagnostic = H1_TEST_FACES
    .map((face) => ({
      selectedFace: face,
      transition: transitionFaceByCoordinate.get(
        testFaceCoordinateKey(session, boundaryCellForFaceDiagnostic, face)
      )
    }))
    .find(({ transition }) => transition !== undefined);
  assert.ok(sharedFaceDiagnostic);
  const selectedFaceNodeIds = sharedFaceDiagnostic.selectedFace.map(
    (localIndex) => boundaryCellForFaceDiagnostic.element[localIndex]
  );
  const transitionFaceNodeIds = sharedFaceDiagnostic.transition.face.map(
    (localIndex) => sharedFaceDiagnostic.transition.cell.element[localIndex]
  );
  const effectiveFaceTolerance = Math.max(
    minElementEdgeLength(firstRefined.mesh) * 1e-8,
    Math.max(
      1,
      ...firstRefined.mesh.nodes.flatMap((point) => point.map(Math.abs))
    ) * Number.EPSILON * 64
  );
  assert.equal(
    Math.abs(effectiveFaceTolerance - 1.7857420733989507e-10)
      <= Number.EPSILON * 1.7857420733989507e-10,
    true
  );
  assert.equal(
    selectedFaceNodeIds.some((nodeId) => transitionFaceNodeIds.includes(nodeId)),
    false
  );
  assert.equal(
    testFaceCoordinateKey(
      session,
      boundaryCellForFaceDiagnostic,
      sharedFaceDiagnostic.selectedFace
    ),
    testFaceCoordinateKey(
      session,
      sharedFaceDiagnostic.transition.cell,
      sharedFaceDiagnostic.transition.face
    )
  );
  const diagnosticIndex = new GeometricFaceIndex(effectiveFaceTolerance, {
    allowNonPlanarExactCoordinateMatches: true
  });
  diagnosticIndex.add({
    owner: boundaryCellId,
    nodeIds: selectedFaceNodeIds,
    points: selectedFaceNodeIds.map((nodeId) => session.nodes[nodeId - 1])
  });
  assert.equal(diagnosticIndex.uniqueMatch({
    owner: sharedFaceDiagnostic.transition.cell.id,
    nodeIds: transitionFaceNodeIds,
    points: transitionFaceNodeIds.map((nodeId) => session.nodes[nodeId - 1])
  })?.owner, boundaryCellId);
  assert.deepEqual(
    warpedShellBaselineDiagnostics(session, boundaryCellId),
    {
      supportLayerCellCount: 952,
      originalSupportParentCount: 124,
      authorizedCompletionParentCount: 272
    }
  );

  const beforeVolumeRejection = structuredClone(session);
  const volumeError = captureError(() => refineSessionPatch(
    session,
    [boundaryCellId],
    {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      rebuildExistingTransitions: false,
      activeBuild: firstRefined
    }
  ));
  assert.equal(volumeError instanceof TwoToOnePlanningError, true);
  assert.equal(volumeError.code, "TWO_TO_ONE_VOLUME");
  assert.match(volumeError.message, /does not conserve parent volume/);
  assert.deepEqual(volumeError.diagnostic.conflictingCellIds, [boundaryCellId]);
  assert.deepEqual(volumeError.diagnostic.conflictingInterfaces, []);
  assert.deepEqual(volumeError.diagnostic.attemptedActions, []);
  assert.deepEqual(session, beforeVolumeRejection);
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
  const beforeRejectedDistortion = structuredClone(session);
  assert.throws(
    () => refineSessionPatch(session, [boundaryCellId], {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      activeBuild: distortedActive
    }),
    /could not preserve the selected fine-cell geometry|failed its net quality gate/
  );
  assert.deepEqual(session, beforeRejectedDistortion);
  for (const [nodeId, point] of originalCoincidentPoints) {
    session.nodes[nodeId - 1] = point;
  }
  const restoredWarpOptions = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true
  };
  assert.equal(Object.hasOwn(restoredWarpOptions, "mergeTolerance"), false);
  assert.equal(Object.hasOwn(restoredWarpOptions, "activeBuild"), false);
  const command = refineSessionPatch(
    session,
    [boundaryCellId],
    restoredWarpOptions
  );
  const twiceRefined = buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });

  assert.deepEqual(command.twoToOne.actions[0], {
    kind: "transition-shell-rebuild",
    reason: "the nested core reached an existing 2:1 transition component",
    addedParentCellIds: ["e66", "e108", "e114"],
    replacedTransitionCellIds: ["e66", "e108", "e114"]
  });
  assert.equal(command.hiddenCellIds.length, 1037);
  assert.equal(command.activeCreatedCellIds.length, 1534);
  assert.equal(command.reactivatedCellIds.length, 1);
  assert.equal(command.twoToOne.affectedComponentCellIds.length, 2572);
  assert.equal(command.twoToOne.preservedFarFieldCellCount, 134);
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
  const initial = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
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
    directTwoToOne.affectedComponentCellIds.length,
    directAffectedCount
  );
  assert.equal(firstRefined.mesh.elements.length, 1171);
  assert.equal(directAffectedCount, 26);
  assert.equal(directTwoToOne.preservedFarFieldCellCount, 1145);
  assert.ok(directTwoToOne.preservedFarFieldCellCount >= 0);
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

test("public history fallback previews and executes one aggregate transaction", () => {
  const {
    session,
    boundaryCellId,
    supportCommand,
    replayedCommand
  } = createConsumedSupportHistoryFixture();
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: active
  };
  const sourceSnapshot = structuredClone(session);
  const sourceActiveCellIds = [...session.activeLeafIds].sort();
  const sourceCommandIds = session.undoStack.map((command) => command.id);
  const sourceMesh = structuredClone(active.mesh);

  const preview = previewSessionPatch(
    session,
    [boundaryCellId],
    options
  );
  const expectedPreview = structuredClone(preview);

  assert.deepEqual(session, sourceSnapshot);
  assert.equal(preview.planMode, "aggregate");
  assert.deepEqual(preview.plan, []);
  assert.deepEqual(preview.compound, {
    kind: "transition-shell-rebuild"
  });

  preview.plan.push({ caller: "mutated" });
  preview.summary.outputElementCount = -1;
  preview.compound.kind = "caller-mutated";
  preview.twoToOne.effectiveSelectedCellIds.push(
    "caller-mutated"
  );
  preview.twoToOne.actions[0].reason = "caller-mutated";
  preview.twoToOne.actions[0].addedParentCellIds.push(
    "caller-mutated"
  );
  if (preview.quality) {
    preview.quality.parentElementCount = -1;
  }

  const command = refineSessionPatch(
    session,
    [boundaryCellId],
    options
  );
  const finalMesh = buildActiveMesh(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const finalActiveCellIds = [...session.activeLeafIds].sort();
  const finalSortedActiveLeafIds = [
    ...session.sortedActiveLeafIds
  ];
  const finalNextCommandId = session.nextCommandId;
  const finalNextCellOrdinal = session.nextCellOrdinal;

  assert.deepEqual(command.twoToOne, expectedPreview.twoToOne);
  assert.deepEqual(command.quality, expectedPreview.quality);
  assert.equal(command.recipe?.version, 1);
  assert.deepEqual(
    session.undoStack.map((entry) => entry.id),
    [supportCommand.id, replayedCommand.id, command.id]
  );
  assert.equal(session.redoStack.length, 0);
  assert.equal(
    expectedPreview.summary.outputElementCount,
    finalMesh.elements.length
  );
  assert.deepEqual(expectedPreview.summary, {
    inputElementCount: active.mesh.elements.length,
    changedInputElementCount: command.hiddenCellIds.length,
    preservedInputElementCount:
      active.mesh.elements.length - command.hiddenCellIds.length,
    outputElementCount: finalMesh.elements.length
  });
  assert.equal(
    command.twoToOne.effectiveSelectedCellIds.every(
      (cellId) => session.activeLeafIds.has(cellId)
    ),
    true
  );
  const hiddenIntermediateIds = command.createdCellIds.filter(
    (cellId) => !session.activeLeafIds.has(cellId)
  );
  assert.equal(
    command.twoToOne.effectiveSelectedCellIds.some(
      (cellId) => hiddenIntermediateIds.includes(cellId)
    ),
    false
  );

  assert.equal(undoRefinementSession(session)?.id, command.id);
  assert.deepEqual(
    [...session.activeLeafIds].sort(),
    sourceActiveCellIds
  );
  assert.equal(session.sortedActiveLeafIdsDirty, true);
  assert.deepEqual(
    session.sortedActiveLeafIds,
    finalSortedActiveLeafIds
  );
  assert.equal(session.nextCommandId, finalNextCommandId);
  assert.equal(session.nextCellOrdinal, finalNextCellOrdinal);
  assert.deepEqual(
    session.undoStack.map((entry) => entry.id),
    sourceCommandIds
  );
  assert.deepEqual(
    buildActiveMesh(session, {
      mergeNodes: true,
      mergeTolerance: 1e-9
    }),
    sourceMesh
  );
  const sourceSortedActiveLeafIds = [
    ...session.sortedActiveLeafIds
  ];

  assert.equal(redoRefinementSession(session)?.id, command.id);
  assert.deepEqual(
    [...session.activeLeafIds].sort(),
    finalActiveCellIds
  );
  assert.equal(session.sortedActiveLeafIdsDirty, true);
  assert.deepEqual(
    session.sortedActiveLeafIds,
    sourceSortedActiveLeafIds
  );
  assert.equal(session.nextCommandId, finalNextCommandId);
  assert.equal(session.nextCellOrdinal, finalNextCellOrdinal);
  assert.deepEqual(
    buildActiveMesh(session, {
      mergeNodes: true,
      mergeTolerance: 1e-9
    }),
    finalMesh
  );
});

test("Stage A shell fallback uses a one-support zero-downstream history closure", () => {
  const {
    session,
    candidate
  } = createTransitionShellRegressionFixture();
  const supportCommand = session.undoStack.at(-1);
  assert.ok(supportCommand);
  const selectedLevel = session.cells.get(candidate)?.level;
  assert.ok(selectedLevel !== undefined);
  const expectedAffectedInputCellIds =
    commandInputAncestorsForCells(
      session,
      supportCommand,
      supportCommand.createdCellIds.filter((cellId) => {
        const cell = session.cells.get(cellId);
        return cell?.level === selectedLevel
          && cell.parentId !== undefined;
      })
    );
  const {
    resolvedOptions,
    faceResolution
  } = createHistoryTransactionRequest(session);
  const before = structuredClone(session);

  const transaction = planRefinementSessionHistoryTransaction(
    session,
    [candidate],
    resolvedOptions,
    faceResolution
  );

  assert.deepEqual(session, before);
  assert.deepEqual(
    transaction.historyClosure.supportCommandIds,
    [supportCommand.id]
  );
  assert.deepEqual(
    transaction.historyClosure.downstreamCommandIds,
    []
  );
  assert.ok(
    transaction.historyClosure.affectedInputCellIds.length > 0
  );
  assert.equal(
    transaction.historyClosure.affectedInputCellIds.every(
      (cellId) => supportCommand.hiddenCellIds.includes(cellId)
    ),
    true
  );
  const affectedInputCellIdSet = new Set(
    transaction.historyClosure.affectedInputCellIds
  );
  assert.equal(
    transaction.historyClosure.boundaryCellIds.every(
      (cellId) => affectedInputCellIdSet.has(cellId)
    ),
    true
  );
  assert.deepEqual(
    transaction.historyClosure.affectedInputCellIds,
    expectedAffectedInputCellIds
  );
  assert.deepEqual(
    transaction.historyClosure.boundaryCellIds,
    transaction.historyClosure.affectedInputCellIds
  );
  assert.equal(
    transaction.command.twoToOne.effectiveSelectedCellIds.length,
    8
  );
  assert.equal(
    transaction.command.twoToOne.effectiveSelectedCellIds.every(
      (cellId) => {
        const cell = transaction.finalSession.cells.get(cellId);
        return cell?.active === true
          && cell.hidden === false
          && cell.level === 2
          && cell.role === "selected"
          && transaction.finalSession.activeLeafIds.has(cellId);
      }
    ),
    true
  );
});

test("Stage A shell fallback traces compound support inputs through cell ancestry", () => {
  const {
    session,
    compoundCommand,
    resolvedOptions,
    faceResolution
  } = createCompoundDownstreamHistoryFixture();
  const before = structuredClone(session);
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const candidate = active.mesh.elements
    .map((element, index) => {
      const cellId = activeBuildCellIdByElementId(active, index + 1);
      const cell = cellId
        ? session.cells.get(cellId)
        : undefined;
      const centerTotal = element.reduce(
        (total, nodeId) =>
          total + active.mesh.nodes[nodeId - 1].reduce(
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
    .sort((left, right) =>
      left.centerTotal - right.centerTotal
    )[0]?.cellId;
  assert.ok(candidate);
  const supportLevel = session.cells.get(candidate)?.level;
  assert.ok(supportLevel !== undefined);
  const supportLayerCellIds = compoundCommand.createdCellIds.filter(
    (cellId) => {
      const cell = session.cells.get(cellId);
      return cell?.level === supportLevel
        && cell.parentId !== undefined;
    }
  );
  const expectedAffectedInputCellIds =
    commandInputAncestorsForCells(
      session,
      compoundCommand,
      supportLayerCellIds
    );
  assert.ok(expectedAffectedInputCellIds.length > 0);

  const transaction = planRefinementSessionHistoryTransaction(
    session,
    [candidate],
    resolvedOptions,
    faceResolution
  );

  assert.deepEqual(session, before);
  assert.deepEqual(
    transaction.historyClosure.supportCommandIds,
    [compoundCommand.id]
  );
  assert.deepEqual(
    transaction.historyClosure.downstreamCommandIds,
    []
  );
  assert.deepEqual(
    transaction.historyClosure.affectedInputCellIds,
    expectedAffectedInputCellIds
  );
  assert.deepEqual(
    transaction.historyClosure.boundaryCellIds,
    expectedAffectedInputCellIds
  );
});

test("mixed traceable and untraceable support cells reject history rebuilding atomically", () => {
  const {
    session,
    boundaryCellId,
    supportCommand
  } = createConsumedSupportHistoryFixture();
  const rogueCellId = supportCommand.createdCellIds.find(
    (cellId) => cellId !== boundaryCellId
      && session.activeLeafIds.has(cellId)
  );
  assert.ok(rogueCellId);
  const rogueCell = session.cells.get(rogueCellId);
  assert.ok(rogueCell);
  rogueCell.active = false;
  rogueCell.hidden = true;
  session.activeLeafIds.delete(rogueCellId);
  session.sortedActiveLeafIdsDirty = true;
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: active
  };
  const before = structuredClone(session);

  for (const operation of [
    () => previewSessionPatch(session, [boundaryCellId], options),
    () => refineSessionPatch(session, [boundaryCellId], options)
  ]) {
    const error = captureError(operation);
    assert.equal(error instanceof TwoToOnePlanningError, true);
    assert.equal(
      error.code,
      "TWO_TO_ONE_HISTORY_CONFLICT",
      error.message
    );
    assert.deepEqual(
      error.diagnostic.conflictingCellIds,
      [rogueCellId]
    );
    assert.deepEqual(session, before);
  }
});

test("cross-component history replay is rejected atomically by public and script APIs", () => {
  const {
    session,
    boundaryCellId,
    crossingCommand,
    replayCommands
  } = createCrossComponentHistoryConflictFixture();
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const options = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: active
  };
  const before = structuredClone(session);

  const previewError = captureError(() =>
    previewSessionPatch(session, [boundaryCellId], options)
  );
  assert.equal(
    previewError instanceof TwoToOnePlanningError,
    true
  );
  assert.equal(
    previewError.code,
    "TWO_TO_ONE_HISTORY_CONFLICT",
    previewError.message
  );
  assert.deepEqual(
    previewError.diagnostic.historyCommandIds,
    [crossingCommand.id],
    previewError.message
  );
  assert.deepEqual(session, before);

  const executionError = captureError(() =>
    refineSessionPatch(session, [boundaryCellId], options)
  );
  assert.equal(
    executionError.code,
    "TWO_TO_ONE_HISTORY_CONFLICT"
  );
  assert.deepEqual(
    executionError.diagnostic.historyCommandIds,
    [crossingCommand.id]
  );
  assert.deepEqual(session, before);

  const script = {
    format: "hexrefine-command-script",
    version: 1,
    app: "HexRefine",
    commands: [
      ...replayCommands,
      {
        kind: "refine.patch",
        payload: {
          cellIds: [boundaryCellId],
          options: {
            hexRefinementRatio: 2,
            hexTwoToOneSelectionMode: "local",
            includeTransitions: true,
            mergeTolerance: 1e-9
          }
        }
      }
    ]
  };
  const strictError = captureError(() =>
    replayHexRefineCommandScript(script, { strict: true })
  );
  assert.equal(
    strictError instanceof TwoToOnePlanningError,
    true
  );
  assert.equal(
    strictError.code,
    "TWO_TO_ONE_HISTORY_CONFLICT"
  );
  assert.deepEqual(
    strictError.diagnostic,
    executionError.diagnostic
  );
  assert.deepEqual(
    strictError.diagnostic.historyCommandIds,
    [crossingCommand.id]
  );
  assert.equal(
    Object.isFrozen(strictError.diagnostic.historyCommandIds),
    true
  );
  const serialized = serializeTwoToOnePlanningError(strictError);
  serialized.diagnostic.historyCommandIds.push("caller-mutated");
  assert.deepEqual(
    strictError.diagnostic.historyCommandIds,
    [crossingCommand.id]
  );

  const baseline = replayHexRefineCommandScript({
    ...script,
    commands: replayCommands
  });
  assert.equal(
    baseline.session.undoStack.every(
      (command) => command.recipe?.version === 1
    ),
    true
  );
  const replay = replayHexRefineCommandScript(script);
  assert.deepEqual(replay.session, baseline.session);
  assert.deepEqual(replay.mesh, baseline.mesh);
  assert.deepEqual(replay.warnings, [
    `refine.patch skipped after ${strictError.code}: ${strictError.message}`
  ]);
});

test("cross-component diagnostics retain commands that cross only through replay recipes", () => {
  const {
    session,
    boundaryCellId,
    crossingCommand
  } = createCrossComponentHistoryConflictFixture();
  const leftChildId = nearestActiveSelectedCreatedCell(
    session,
    crossingCommand,
    [0.5, 0.5, 0.5]
  );
  const rightChildId = nearestActiveSelectedCreatedCell(
    session,
    crossingCommand,
    [2.5, 0.5, 0.5]
  );
  const recipeOnlyCrossingCommand = refineSessionPatch(
    session,
    [leftChildId],
    {
      hexRefinementRatio: 2,
      includeTransitions: false,
      mergeTolerance: 1e-9
    }
  );
  assert.ok(recipeOnlyCrossingCommand.recipe);
  replaceSessionCommand(session, recipeOnlyCrossingCommand, {
    recipe: Object.freeze({
      ...recipeOnlyCrossingCommand.recipe,
      transitionSupportCellIds: Object.freeze([rightChildId]),
      transitionSupportCellGeometry: Object.freeze([
        recipeOnlyCrossingCommand.recipe.selectedCellGeometry[0]
      ])
    })
  });
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const before = structuredClone(session);
  const error = captureError(() =>
    previewSessionPatch(session, [boundaryCellId], {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      includeTransitions: true,
      mergeTolerance: 1e-9,
      activeBuild: active
    })
  );

  assert.equal(error instanceof TwoToOnePlanningError, true);
  assert.equal(
    error.code,
    "TWO_TO_ONE_HISTORY_CONFLICT",
    error.message
  );
  assert.deepEqual(
    error.diagnostic.historyCommandIds,
    [crossingCommand.id, recipeOnlyCrossingCommand.id]
  );
  assert.deepEqual(session, before);
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

const H1_TEST_FACES = [
  [0, 1, 2, 3],
  [4, 7, 6, 5],
  [0, 4, 5, 1],
  [1, 5, 6, 2],
  [2, 6, 7, 3],
  [3, 7, 4, 0]
];

function testFaceCoordinateKey(session, cell, face) {
  return face
    .map((localIndex) => session.nodes[cell.element[localIndex] - 1]
      .map((coordinate) => coordinate.toPrecision(17))
      .join(","))
    .sort()
    .join("|");
}

function activeBoundaryCoreCellIds(session, level = 1) {
  const transitionFaceKeys = new Set([...session.activeLeafIds]
    .map((cellId) => session.cells.get(cellId))
    .filter((cell) => cell && String(cell.role).includes("transition"))
    .flatMap((cell) => H1_TEST_FACES.map((face) =>
      testFaceCoordinateKey(session, cell, face)
    )));
  return [...session.activeLeafIds]
    .map((cellId) => {
      const cell = session.cells.get(cellId);
      if (cell?.level !== level || cell.role !== "selected") {
        return undefined;
      }
      const transitionFaceCount = H1_TEST_FACES.filter((face) =>
        transitionFaceKeys.has(testFaceCoordinateKey(session, cell, face))
      ).length;
      if (transitionFaceCount !== 1) {
        return undefined;
      }
      const centerTotal = cell.element.reduce(
        (total, nodeId) => total + session.nodes[nodeId - 1].reduce(
          (sum, coordinate) => sum + coordinate,
          0
        ),
        0
      ) / cell.element.length;
      return { cellId, centerTotal };
    })
    .filter(Boolean)
    .sort((a, b) => a.centerTotal - b.centerTotal)
    .map(({ cellId }) => cellId);
}

function firstActiveBoundaryCoreCell(session, level = 1) {
  return activeBoundaryCoreCellIds(session, level)[0];
}

function duplicateOneNearCoincidentNeighborFace(
  session,
  selectedCellId,
  translation = [2e-10, -1e-10, 1e-10]
) {
  const selected = session.cells.get(selectedCellId);
  const selectedFaces = new Set(H1_TEST_FACES.map((face) =>
    testFaceCoordinateKey(session, selected, face)
  ));
  for (const neighborId of session.activeLeafIds) {
    const neighbor = session.cells.get(neighborId);
    if (
      !neighbor
      || neighbor.id === selectedCellId
      || !String(neighbor.role).includes("transition")
    ) {
      continue;
    }
    for (const face of H1_TEST_FACES) {
      if (!selectedFaces.has(testFaceCoordinateKey(session, neighbor, face))) {
        continue;
      }
      for (const localIndex of face) {
        const sourceNodeId = neighbor.element[localIndex];
        const source = session.nodes[sourceNodeId - 1];
        session.nodes.push([
          source[0] + translation[0],
          source[1] + translation[1],
          source[2] + translation[2]
        ]);
        neighbor.element[localIndex] = session.nodes.length;
      }
      const selectedFaceLocalIndices = new Set(face);
      for (let localIndex = 0; localIndex < neighbor.element.length; localIndex += 1) {
        if (selectedFaceLocalIndices.has(localIndex)) {
          continue;
        }
        const source = session.nodes[neighbor.element[localIndex] - 1];
        session.nodes.push([
          source[0] + 2e-8,
          source[1] - 1e-8,
          source[2] + 1e-8
        ]);
        neighbor.element[localIndex] = session.nodes.length;
      }
      return neighbor.id;
    }
  }
  throw new Error("selected core cell has no transition-face neighbor");
}

function createTransitionShellRegressionFixture() {
  const mesh = createHexUnitCubeMesh(7, 7, 7);
  const session = createRefinementSession(mesh);
  const initial = buildActiveMeshWithMap(session);
  const firstCore = idsInIndexBlock(
    7,
    7,
    7,
    [2, 2, 2],
    [4, 4, 4]
  ).map((elementId) =>
    activeBuildCellIdByElementId(initial, elementId)
  ).filter(Boolean);
  refineSessionPatch(session, firstCore, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    activeBuild: initial
  });
  const firstRefined = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  return {
    session,
    firstRefined,
    candidate: firstActiveBoundaryCoreCell(session)
  };
}

function createConsumedSupportHistoryFixture({
  downstreamCompensationMode,
  genericDownstream = false,
  rawNonconformingDownstream = false
} = {}) {
  const {
    session,
    firstRefined,
    candidate: boundaryCellId
  } = createTransitionShellRegressionFixture();
  const supportCommand = session.undoStack.at(-1);
  assert.ok(supportCommand);
  const centerCellId = supportCommand.createdCellIds
    .map((cellId) => {
      const cell = session.cells.get(cellId);
      if (
        cell?.level !== 1
        || cell.role !== "selected"
        || !session.activeLeafIds.has(cellId)
      ) {
        return undefined;
      }
      const center = cell.element.reduce((sum, nodeId) => {
        const point = session.nodes[nodeId - 1];
        return [
          sum[0] + point[0] / cell.element.length,
          sum[1] + point[1] / cell.element.length,
          sum[2] + point[2] / cell.element.length
        ];
      }, [0, 0, 0]);
      return {
        cellId,
        distance: center.reduce(
          (total, coordinate) =>
            total + (coordinate - 0.5) ** 2,
          0
        )
      };
    })
    .filter(Boolean)
    .sort((first, second) =>
      first.distance - second.distance
    )[0]?.cellId;
  assert.ok(centerCellId);
  const replayedCommand = genericDownstream
    ? refineSessionCells(
        session,
        [centerCellId],
        refineHexTo8Hex
      )
    : refineSessionPatch(
        session,
        [centerCellId],
        rawNonconformingDownstream
          ? {
              hexRefinementRatio: 2,
              includeTransitions: false
            }
          : {
              hexRefinementRatio: 2,
              hexTwoToOneSelectionMode: "local",
              includeTransitions: true,
              activeBuild: firstRefined,
              ...(downstreamCompensationMode === undefined
                ? {}
                : {
                    rebuildExistingTransitions:
                      downstreamCompensationMode !== "none",
                    hexTwoToOneCompensation: {
                      mode: downstreamCompensationMode
                    }
                  }),
              mergeTolerance: 1e-9
            }
      );
  const transactionRequest =
    createHistoryTransactionRequest(session);
  return {
    session,
    boundaryCellId,
    centerCellId,
    supportCommand,
    replayedCommand,
    ...transactionRequest
  };
}

function createCrossComponentHistoryConflictFixture() {
  const dimension = 7;
  const component = createHexUnitCubeMesh(
    dimension,
    dimension,
    dimension
  );
  const nodeOffset = component.nodes.length;
  const elementOffset = component.elements.length;
  const mesh = {
    kind: "H1",
    nodes: [
      ...component.nodes.map((point) => [...point]),
      ...component.nodes.map(([x, y, z]) => [x + 2, y, z])
    ],
    elements: [
      ...component.elements.map((element) => [...element]),
      ...component.elements.map((element) =>
        element.map((nodeId) => nodeId + nodeOffset)
      )
    ]
  };
  const session = createRefinementSession(mesh);
  const leftCoreCellIds = idsInIndexBlock(
    dimension,
    dimension,
    dimension,
    [2, 2, 2],
    [4, 4, 4]
  ).map((elementId) => `e${elementId}`);
  const rightCoreCellIds = component.elements.map(
    (_, index) => `e${elementOffset + index + 1}`
  );
  const patchOptions = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-9
  };
  const replayCommands = [{
    kind: "grid.import",
    payload: {
      mesh,
      mergeTolerance: 1e-9
    }
  }];

  const leftActive = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const leftSupportCommand = refineSessionPatch(
    session,
    leftCoreCellIds,
    {
      ...patchOptions,
      activeBuild: leftActive
    }
  );
  replayCommands.push({
    kind: "refine.patch",
    payload: {
      cellIds: leftCoreCellIds,
      options: patchOptions
    }
  });

  const rightActive = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const rightSupportCommand = refineSessionPatch(
    session,
    rightCoreCellIds,
    {
      hexRefinementRatio: 2,
      includeTransitions: false,
      mergeTolerance: 1e-9,
      activeBuild: rightActive
    }
  );
  replayCommands.push({
    kind: "refine.patch",
    payload: {
      cellIds: rightCoreCellIds,
      options: {
        hexRefinementRatio: 2,
        includeTransitions: false,
        mergeTolerance: 1e-9
      }
    }
  });

  const leftBoundaryCellIds = activeBoundaryCoreCellIds(session)
    .filter((cellId) =>
      leftSupportCommand.createdCellIds.includes(cellId)
    );
  assert.ok(leftBoundaryCellIds.length > 0);
  const boundaryCellId = leftBoundaryCellIds[0];
  const leftCenterCellId = nearestActiveSelectedCreatedCell(
    session,
    leftSupportCommand,
    [0.5, 0.5, 0.5]
  );
  const rightCenterCellId = nearestActiveSelectedCreatedCell(
    session,
    rightSupportCommand,
    [2.5, 0.5, 0.5]
  );
  assert.notEqual(boundaryCellId, leftCenterCellId);

  const crossingCellIds = [
    leftCenterCellId,
    rightCenterCellId
  ];
  const crossingOptions = {
    hexRefinementRatio: 2,
    includeTransitions: false,
    mergeTolerance: 1e-9
  };
  const crossingCommand = refineSessionPatch(
    session,
    crossingCellIds,
    crossingOptions
  );
  replayCommands.push({
    kind: "refine.patch",
    payload: {
      cellIds: crossingCellIds,
      options: crossingOptions
    }
  });

  return {
    session,
    boundaryCellId,
    crossingCommand,
    replayCommands
  };
}

function nearestActiveSelectedCreatedCell(
  session,
  command,
  target
) {
  const nearest = command.createdCellIds
    .map((cellId) => {
      const cell = session.cells.get(cellId);
      if (
        cell?.role !== "selected"
        || !session.activeLeafIds.has(cellId)
      ) {
        return undefined;
      }
      const center = cell.element.reduce(
        (sum, nodeId) => {
          const point = session.nodes[nodeId - 1];
          return [
            sum[0] + point[0] / cell.element.length,
            sum[1] + point[1] / cell.element.length,
            sum[2] + point[2] / cell.element.length
          ];
        },
        [0, 0, 0]
      );
      return {
        cellId,
        distance: center.reduce(
          (total, coordinate, axis) =>
            total + (coordinate - target[axis]) ** 2,
          0
        )
      };
    })
    .filter(Boolean)
    .sort((first, second) =>
      first.distance - second.distance
    )[0]?.cellId;
  assert.ok(nearest);
  return nearest;
}

function createCompoundDownstreamHistoryFixture() {
  const {
    session,
    firstRefined,
    candidate
  } = createTransitionShellRegressionFixture();
  const compoundCommand = refineSessionPatch(
    session,
    [candidate],
    transitionShellRegressionOptions(firstRefined)
  );
  const boundaryCellId = activeBoundaryCoreCellIds(session)
    .find((cellId) =>
      compoundCommand.createdCellIds.includes(cellId)
    );
  assert.ok(boundaryCellId);
  return {
    session,
    boundaryCellId,
    compoundCommand,
    ...createHistoryTransactionRequest(session)
  };
}

function firstActiveSelectedCreatedCell(session, command) {
  const cellId = command.createdCellIds.find((candidate) => {
    const cell = session.cells.get(candidate);
    return session.activeLeafIds.has(candidate)
      && cell?.role === "selected";
  });
  assert.ok(cellId);
  return cellId;
}

function centralActiveSelectedCellBlock(
  session,
  level,
  axisCellCount
) {
  const cells = [...session.activeLeafIds]
    .map((cellId) => {
      const cell = session.cells.get(cellId);
      if (
        cell?.level !== level
        || cell.role !== "selected"
      ) {
        return undefined;
      }
      const center = cell.element.reduce(
        (sum, nodeId) => {
          const point = session.nodes[nodeId - 1];
          return sum.map(
            (coordinate, axis) =>
              coordinate + point[axis] / cell.element.length
          );
        },
        [0, 0, 0]
      );
      return { cellId, center };
    })
    .filter(Boolean);
  const selectedAxisCoordinates = [0, 1, 2].map(
    (axis) =>
      [...new Set(cells.map(({ center }) => center[axis]))]
        .sort((first, second) =>
          Math.abs(first - 0.5) - Math.abs(second - 0.5)
        )
        .slice(0, axisCellCount)
  );
  const selectedCellIds = cells
    .filter(({ center }) =>
      selectedAxisCoordinates.every(
        (coordinates, axis) =>
          coordinates.some(
            (coordinate) =>
              Math.abs(coordinate - center[axis]) < 1e-12
          )
      )
    )
    .map(({ cellId }) => cellId)
    .sort();
  assert.ok(selectedCellIds.length > 0);
  return selectedCellIds;
}

function commandInputAncestorsForCells(session, command, cellIds) {
  const commandInputCellIds = [
    ...new Set([
      ...command.hiddenCellIds,
      ...(command.reactivatedCellIds ?? [])
    ])
  ];
  const commandInputCellIdSet = new Set(commandInputCellIds);
  const reachedInputCellIds = new Set();
  const ancestorGeometryKeys = new Set();
  for (const cellId of cellIds) {
    let currentCellId = cellId;
    const visitedCellIds = new Set();
    while (!visitedCellIds.has(currentCellId)) {
      visitedCellIds.add(currentCellId);
      const currentCell = session.cells.get(currentCellId);
      assert.ok(currentCell);
      ancestorGeometryKeys.add(
        testCellGeometryKey(session, currentCell)
      );
      if (commandInputCellIdSet.has(currentCellId)) {
        reachedInputCellIds.add(currentCellId);
        break;
      }
      const parentId = currentCell.parentId;
      if (parentId === undefined) {
        break;
      }
      currentCellId = parentId;
    }
  }
  for (const commandInputCellId of commandInputCellIds) {
    const inputCell = session.cells.get(commandInputCellId);
    assert.ok(inputCell);
    if (
      ancestorGeometryKeys.has(
        testCellGeometryKey(session, inputCell)
      )
    ) {
      reachedInputCellIds.add(commandInputCellId);
    }
  }
  return commandInputCellIds.filter((cellId) =>
    reachedInputCellIds.has(cellId)
  );
}

function testCellGeometryKey(session, cell) {
  return cell.element
    .map((nodeId) =>
      session.nodes[nodeId - 1]
        .map((coordinate) => coordinate.toPrecision(17))
        .join(",")
    )
    .sort()
    .join("|");
}

function snapshotRefinementCells(session, cellIds) {
  return [...cellIds].sort().map((cellId) => {
    const cell = session.cells.get(cellId);
    assert.ok(cell);
    return {
      id: cell.id,
      element: [...cell.element],
      role: cell.role,
      level: cell.level,
      active: cell.active,
      hidden: cell.hidden,
      points: cell.element.map((nodeId) => [
        ...session.nodes[nodeId - 1]
      ])
    };
  });
}

function snapshotActiveRefinementState(session) {
  const activeCellIds = [...session.activeLeafIds];
  const activeNodeIds = [
    ...new Set(activeCellIds.flatMap((cellId) => {
      const cell = session.cells.get(cellId);
      assert.ok(cell);
      return cell.element;
    }))
  ].sort((left, right) => left - right);
  return {
    nodes: activeNodeIds.map((nodeId) => ({
      id: nodeId,
      point: [...session.nodes[nodeId - 1]]
    })),
    activeCells: snapshotRefinementCells(
      session,
      activeCellIds
    ),
    commandRecipes: session.undoStack.map((command) => ({
      id: command.id,
      recipe: command.recipe === undefined
        ? undefined
        : structuredClone(command.recipe)
    }))
  };
}

function createHistoryTransactionRequest(
  session,
  requestOverrides = {}
) {
  const activeBuild = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const requestOptions = {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    mergeTolerance: 1e-9,
    ...requestOverrides
  };
  const compensation = normalizeTwoToOneCompensation(
    1,
    requestOptions
  );
  const resolution = activeBuild.geometryResolution;
  assert.ok(resolution);
  return {
    resolvedOptions: {
      ...requestOptions,
      activeBuild,
      hexTwoToOneCompensation: compensation,
      normalizedTwoToOneCompensation: compensation
    },
    faceResolution: {
      tolerance: Math.max(
        1e-9,
        resolution.minimumElementEdgeLength * 1e-8,
        resolution.coordinateScale * Number.EPSILON * 64
      ),
      minimumElementEdgeLength:
        resolution.minimumElementEdgeLength,
      coordinateScale: resolution.coordinateScale,
      mergeTolerance: 1e-9
    }
  };
}

function transitionShellRegressionOptions(activeBuild) {
  return {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    ...(activeBuild === undefined ? {} : { activeBuild })
  };
}

function replaceSessionCommand(session, command, replacements) {
  const index = session.undoStack.indexOf(command);
  assert.notEqual(index, -1);
  session.undoStack[index] = Object.freeze({
    ...command,
    ...replacements,
    hiddenCellIds: Object.freeze([
      ...(replacements.hiddenCellIds ?? command.hiddenCellIds)
    ]),
    createdCellIds: Object.freeze([
      ...(replacements.createdCellIds ?? command.createdCellIds)
    ]),
    createdNodeIds: Object.freeze([
      ...(replacements.createdNodeIds ?? command.createdNodeIds)
    ])
  });
}

function addAmbiguousSupportFaceCell(
  session,
  selectedCellId,
  translation = [2e-10, -1e-10, 1e-10]
) {
  const selected = session.cells.get(selectedCellId);
  const supportCommand = [...session.undoStack]
    .reverse()
    .find((command) => command.createdCellIds.includes(selectedCellId));
  assert.ok(selected);
  assert.ok(supportCommand);
  const duplicateNodeIds = selected.element.map((sourceNodeId) => {
    const source = session.nodes[sourceNodeId - 1];
    session.nodes.push([
      source[0] + translation[0],
      source[1] + translation[1],
      source[2] + translation[2]
    ]);
    return session.nodes.length;
  });
  const cellId = "e999999/1";
  session.cells.set(cellId, {
    ...selected,
    id: cellId,
    ordinal: session.nextCellOrdinal,
    element: duplicateNodeIds,
    children: [],
    active: false,
    hidden: true
  });
  session.nextCellOrdinal += 1;
  replaceSyntheticSupportCommand(
    session,
    supportCommand,
    [cellId],
    duplicateNodeIds
  );
  return cellId;
}

function addCoincidentDegenerateSupportCells(
  session,
  selectedCellId,
  count
) {
  const selected = session.cells.get(selectedCellId);
  const supportCommand = [...session.undoStack]
    .reverse()
    .find((command) => command.createdCellIds.includes(selectedCellId));
  assert.ok(selected);
  assert.ok(supportCommand);
  const owners = [];
  for (let duplicateIndex = 0; duplicateIndex < count; duplicateIndex += 1) {
    const duplicateNodeIds = Array.from({ length: 8 }, (_, nodeIndex) => {
      session.nodes.push([10 + nodeIndex, 20, 30]);
      return session.nodes.length;
    });
    const cellId = `e${999997 + duplicateIndex}/1`;
    session.cells.set(cellId, {
      ...selected,
      id: cellId,
      ordinal: session.nextCellOrdinal,
      element: duplicateNodeIds,
      children: [],
      active: false,
      hidden: true
    });
    session.nextCellOrdinal += 1;
    owners.push(cellId);
  }
  replaceSyntheticSupportCommand(
    session,
    supportCommand,
    owners,
    owners.flatMap((cellId) => session.cells.get(cellId).element)
  );
  return owners;
}

function addExactFirstSupportAmbiguity(session, selectedCellId) {
  const selected = session.cells.get(selectedCellId);
  const supportCommand = [...session.undoStack]
    .reverse()
    .find((command) => command.createdCellIds.includes(selectedCellId));
  assert.ok(selected);
  assert.ok(supportCommand);
  const sharedNodeIds = [
    [10, 20, 30],
    [11, 20, 30],
    [11, 21, 30],
    [10, 21, 30],
    [10, 20, 31],
    [11, 20, 31],
    [11, 21, 31],
    [10, 21, 31]
  ].map((point) => {
    session.nodes.push(point);
    return session.nodes.length;
  });
  const nearNodeIds = sharedNodeIds.map((nodeId) => {
    const point = session.nodes[nodeId - 1];
    session.nodes.push([
      point[0] + 2e-10,
      point[1] - 1e-10,
      point[2] + 1e-10
    ]);
    return session.nodes.length;
  });
  const owners = {
    exactStored: "e999997/1",
    nearStored: "e999998/1",
    exactQuery: "e999999/1"
  };
  for (const [cellId, element] of [
    [owners.exactStored, sharedNodeIds],
    [owners.nearStored, nearNodeIds],
    [owners.exactQuery, sharedNodeIds]
  ]) {
    session.cells.set(cellId, {
      ...selected,
      id: cellId,
      ordinal: session.nextCellOrdinal,
      element,
      children: [],
      active: false,
      hidden: true
    });
    session.nextCellOrdinal += 1;
  }
  replaceSyntheticSupportCommand(
    session,
    supportCommand,
    Object.values(owners),
    [...sharedNodeIds, ...nearNodeIds]
  );
  return owners;
}

function addCollapsedSupportCell(session, selectedCellId) {
  const selected = session.cells.get(selectedCellId);
  const supportCommand = [...session.undoStack]
    .reverse()
    .find((command) => command.createdCellIds.includes(selectedCellId));
  assert.ok(selected);
  assert.ok(supportCommand);
  const points = [
    [10, 20, 30],
    [11, 20, 30],
    [11, 21, 30],
    [10, 21, 30],
    [10, 20, 30],
    [11, 20, 30],
    [11, 21, 30],
    [10, 21, 30]
  ];
  const nodeIds = points.map((point) => {
    session.nodes.push(point);
    return session.nodes.length;
  });
  const cellId = "e999996/1";
  session.cells.set(cellId, {
    ...selected,
    id: cellId,
    ordinal: session.nextCellOrdinal,
    element: nodeIds,
    children: [],
    active: false,
    hidden: true
  });
  session.nextCellOrdinal += 1;
  replaceSyntheticSupportCommand(session, supportCommand, [cellId], nodeIds);
  return cellId;
}

function replaceSyntheticSupportCommand(
  session,
  command,
  createdCellIds,
  createdNodeIds
) {
  const index = session.undoStack.indexOf(command);
  assert.notEqual(index, -1);
  session.undoStack[index] = Object.freeze({
    ...command,
    createdCellIds: Object.freeze([
      ...command.createdCellIds,
      ...createdCellIds
    ]),
    createdNodeIds: Object.freeze([
      ...command.createdNodeIds,
      ...createdNodeIds
    ])
  });
}

function addActiveResolutionProbeCell(session, origin, edge) {
  const [x, y, z] = origin;
  const nodeIds = [
    [x, y, z],
    [x + edge, y, z],
    [x + edge, y + edge, z],
    [x, y + edge, z],
    [x, y, z + edge],
    [x + edge, y, z + edge],
    [x + edge, y + edge, z + edge],
    [x, y + edge, z + edge]
  ].map((point) => {
    session.nodes.push(point);
    return session.nodes.length;
  });
  const cellId = "e999999";
  session.cells.set(cellId, {
    id: cellId,
    ordinal: session.nextCellOrdinal,
    level: 0,
    role: "base",
    kind: "H1",
    element: nodeIds,
    children: [],
    active: true,
    hidden: false,
    template: "resolution-probe"
  });
  session.nextCellOrdinal += 1;
  session.activeLeafIds.add(cellId);
  session.sortedActiveLeafIdsDirty = true;
}

function warpedShellBaselineDiagnostics(session, selectedCellId) {
  const selected = session.cells.get(selectedCellId);
  const supportCommand = [...session.undoStack]
    .reverse()
    .find((command) => command.createdCellIds.includes(selectedCellId));
  assert.ok(selected);
  assert.ok(supportCommand);
  const supportLayerCellIds = supportCommand.createdCellIds.filter((cellId) => {
    const cell = session.cells.get(cellId);
    return cell?.level === selected.level && cell.parentId !== undefined;
  });
  const adjacency = new Map(
    supportLayerCellIds.map((cellId) => [cellId, new Set()])
  );
  const ownersByFace = new Map();
  for (const cellId of supportLayerCellIds) {
    const cell = session.cells.get(cellId);
    for (const face of H1_TEST_FACES) {
      const key = testFaceCoordinateKey(session, cell, face);
      const owners = ownersByFace.get(key) ?? [];
      for (const owner of owners) {
        adjacency.get(cellId).add(owner);
        adjacency.get(owner).add(cellId);
      }
      owners.push(cellId);
      ownersByFace.set(key, owners);
    }
  }
  const supportComponent = new Set();
  const queue = [selectedCellId];
  while (queue.length > 0) {
    const cellId = queue.pop();
    if (supportComponent.has(cellId)) {
      continue;
    }
    supportComponent.add(cellId);
    for (const neighborId of adjacency.get(cellId) ?? []) {
      queue.push(neighborId);
    }
  }
  const originalSupportParentIds = new Set(
    [...supportComponent].map((cellId) => session.cells.get(cellId).parentId)
  );
  assert.equal(originalSupportParentIds.has(undefined), false);
  const boundaryFaceKeys = new Set(
    [...originalSupportParentIds].flatMap((cellId) => {
      const cell = session.cells.get(cellId);
      return H1_TEST_FACES.map((face) =>
        testFaceCoordinateKey(session, cell, face)
      );
    })
  );
  const restoredActiveLeafIds = new Set(session.activeLeafIds);
  for (const cellId of supportComponent) {
    restoredActiveLeafIds.delete(cellId);
  }
  for (const cellId of originalSupportParentIds) {
    restoredActiveLeafIds.add(cellId);
  }
  const supportCreatedCellIds = new Set(supportCommand.createdCellIds);
  const authorizedCompletionParentIds = new Set(originalSupportParentIds);
  for (const cellId of restoredActiveLeafIds) {
    if (authorizedCompletionParentIds.has(cellId)) {
      continue;
    }
    const cell = session.cells.get(cellId);
    if (
      cell.level !== selected.level - 1
      || String(cell.role).includes("transition")
      || !(
        cell.parentId === undefined
        || supportCreatedCellIds.has(cellId)
      )
    ) {
      continue;
    }
    if (H1_TEST_FACES.some((face) =>
      boundaryFaceKeys.has(testFaceCoordinateKey(session, cell, face))
    )) {
      authorizedCompletionParentIds.add(cellId);
    }
  }
  return {
    supportLayerCellCount: supportComponent.size,
    originalSupportParentCount: originalSupportParentIds.size,
    authorizedCompletionParentCount: authorizedCompletionParentIds.size
  };
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

function twoToOneCompensationReplayScript(compensation, includeRefine = true) {
  return {
    format: "hexrefine-command-script",
    version: 1,
    app: "HexRefine",
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 2,
          ny: 2,
          nz: 5,
          bounds: { min: [0, 0, 0], max: [1, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      ...(includeRefine
        ? [{
            kind: "refine.patch",
            payload: {
              cellIds: ["e5", "e6", "e7", "e8"],
              options: {
                includeTransitions: true,
                regularizeHexSelection: false,
                hexRefinementRatio: 2,
                hexTwoToOneSelectionMode: "local",
                hexTwoToOneCompensation: compensation,
                mergeTolerance: 1e-9
              }
            }
          }]
        : [])
    ]
  };
}

function createAlternatelyOrientedHexBlock(nx, ny, nz, scale = 1, origin = 0) {
  const mesh = createHexUnitCubeMesh(nx, ny, nz);
  const rotatedLocalOrder = [5, 4, 7, 6, 1, 0, 3, 2];
  return {
    ...mesh,
    nodes: mesh.nodes.map((point) =>
      point.map((coordinate) => origin + coordinate * scale)
    ),
    elements: mesh.elements.map((element, index) =>
      index % 2 === 0
        ? element
        : rotatedLocalOrder.map((localIndex) => element[localIndex])
    )
  };
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
