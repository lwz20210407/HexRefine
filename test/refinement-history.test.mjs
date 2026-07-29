import assert from "node:assert/strict";
import test from "node:test";

import {
  cloneRefinementSessionCommandRecipe,
  freezeRefinementSessionCommandRecipe
} from "../dist/index.js";

function sampleGeometry(originalCellId, offset = 0) {
  return {
    originalCellId,
    kind: "H1",
    level: 0,
    role: "base",
    points: [
      [offset + 0, 0, 0],
      [offset + 1, 0, 0],
      [offset + 1, 1, 0],
      [offset + 0, 1, 0],
      [offset + 0, 0, 1],
      [offset + 1, 0, 1],
      [offset + 1, 1, 1],
      [offset + 0, 1, 1]
    ]
  };
}

function sampleRecipe() {
  return {
    version: 1,
    selectedCellIds: ["e2", "e1"],
    selectedCellGeometry: [
      sampleGeometry("e2", 1),
      sampleGeometry("e1")
    ],
    transitionSupportCellIds: ["e4", "e3"],
    transitionSupportCellGeometry: [
      sampleGeometry("e4", 3),
      sampleGeometry("e3", 2)
    ],
    options: {
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
    }
  };
}

function assertFrozenGeometry(geometry) {
  assert.equal(Object.isFrozen(geometry), true);
  assert.equal(Object.isFrozen(geometry.points), true);
  for (const point of geometry.points) {
    assert.equal(Object.isFrozen(point), true);
  }
}

test("recipe freeze snapshots the source and clone creates independent nested references", () => {
  const source = sampleRecipe();
  const expected = structuredClone(source);
  const frozen = freezeRefinementSessionCommandRecipe(source);

  source.selectedCellIds[0] = "mutated-selected";
  source.transitionSupportCellIds.push("mutated-support");
  source.selectedCellGeometry[0].originalCellId = "mutated-geometry";
  source.selectedCellGeometry[0].points[0][0] = 999;
  source.options.hexRefinementRatio = 3;
  source.options.hexTwoToOneCompensation.mode = "none";
  source.options.hexTwoToOneCompensation.maxAddedParentCount = 0;

  assert.deepEqual(frozen, expected);

  const cloned = cloneRefinementSessionCommandRecipe(frozen);
  assert.deepEqual(cloned, frozen);
  assert.equal(Object.isFrozen(cloned), false);
  assert.notStrictEqual(cloned, frozen);
  assert.notStrictEqual(cloned.selectedCellIds, frozen.selectedCellIds);
  assert.notStrictEqual(
    cloned.selectedCellGeometry,
    frozen.selectedCellGeometry
  );
  assert.notStrictEqual(
    cloned.selectedCellGeometry[0],
    frozen.selectedCellGeometry[0]
  );
  assert.notStrictEqual(
    cloned.selectedCellGeometry[0].points,
    frozen.selectedCellGeometry[0].points
  );
  assert.notStrictEqual(
    cloned.selectedCellGeometry[0].points[0],
    frozen.selectedCellGeometry[0].points[0]
  );
  assert.notStrictEqual(
    cloned.transitionSupportCellIds,
    frozen.transitionSupportCellIds
  );
  assert.notStrictEqual(
    cloned.transitionSupportCellGeometry,
    frozen.transitionSupportCellGeometry
  );
  assert.notStrictEqual(
    cloned.transitionSupportCellGeometry[0],
    frozen.transitionSupportCellGeometry[0]
  );
  assert.notStrictEqual(
    cloned.transitionSupportCellGeometry[0].points,
    frozen.transitionSupportCellGeometry[0].points
  );
  assert.notStrictEqual(
    cloned.transitionSupportCellGeometry[0].points[0],
    frozen.transitionSupportCellGeometry[0].points[0]
  );
  assert.notStrictEqual(cloned.options, frozen.options);
  assert.notStrictEqual(
    cloned.options.hexTwoToOneCompensation,
    frozen.options.hexTwoToOneCompensation
  );

  cloned.selectedCellGeometry[0].points[0][0] = -1;
  cloned.transitionSupportCellGeometry[0].points[0][0] = -2;
  cloned.options.hexTwoToOneCompensation.mode = "selection";
  assert.deepEqual(frozen, expected);
});

test("recipe freeze deeply freezes options, compensation, geometry arrays, and points", () => {
  const frozen = freezeRefinementSessionCommandRecipe(sampleRecipe());

  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(Object.isFrozen(frozen.selectedCellIds), true);
  assert.equal(Object.isFrozen(frozen.selectedCellGeometry), true);
  assert.equal(Object.isFrozen(frozen.transitionSupportCellIds), true);
  assert.equal(Object.isFrozen(frozen.transitionSupportCellGeometry), true);
  assert.equal(Object.isFrozen(frozen.options), true);
  assert.equal(
    Object.isFrozen(frozen.options.hexTwoToOneCompensation),
    true
  );
  for (const geometry of [
    ...frozen.selectedCellGeometry,
    ...frozen.transitionSupportCellGeometry
  ]) {
    assertFrozenGeometry(geometry);
  }
});

test("recipe cloning rejects non-finite coordinates with stable cell, point, and coordinate diagnostics", () => {
  for (const coordinate of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  ]) {
    const source = sampleRecipe();
    source.selectedCellGeometry[0].points[1][2] = coordinate;

    assert.throws(
      () => cloneRefinementSessionCommandRecipe(source),
      {
        message:
          "geometry for cell e2 point 2 coordinate 3 must be finite"
      }
    );
  }
});

test("recipe cloning rejects sparse coordinates with a stable finite diagnostic", () => {
  const source = sampleRecipe();
  source.selectedCellGeometry[0].points[1] = new Array(3);

  assert.throws(
    () => cloneRefinementSessionCommandRecipe(source),
    {
      message:
        "geometry for cell e2 point 2 coordinate 1 must be finite"
    }
  );
});

test("recipe cloning rejects sparse point arrays with a stable nonempty diagnostic", () => {
  const source = sampleRecipe();
  source.transitionSupportCellGeometry[0].points = new Array(1);

  assert.throws(
    () => cloneRefinementSessionCommandRecipe(source),
    {
      message:
        "geometry for cell e4 point 1 must contain at least one coordinate"
    }
  );
});

test("recipe cloning rejects empty geometry and point coordinate arrays", () => {
  const emptyGeometry = sampleRecipe();
  emptyGeometry.transitionSupportCellGeometry[0].points = [];
  assert.throws(
    () => cloneRefinementSessionCommandRecipe(emptyGeometry),
    {
      message:
        "geometry for cell e4 must contain at least one point"
    }
  );

  const emptyPoint = sampleRecipe();
  emptyPoint.selectedCellGeometry[0].points[0] = [];
  assert.throws(
    () => freezeRefinementSessionCommandRecipe(emptyPoint),
    {
      message:
        "geometry for cell e2 point 1 must contain at least one coordinate"
    }
  );
});
