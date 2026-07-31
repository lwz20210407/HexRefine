import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

import {
  buildRefinementHistoryClosure,
  buildRefinementHistoryIndex,
  cloneRefinementSessionCommandRecipe,
  freezeRefinementSessionCommandRecipe,
  RefinementCellGeometryIndex,
  RefinementCellGeometryMatchError,
  snapshotRefinementCellGeometry,
  RefinementHistoryClosureError
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

function q1GeometryInDimension(originalCellId, dimension) {
  const point = (x, y) => {
    const coordinates = Array.from(
      { length: dimension },
      () => 0
    );
    coordinates[0] = x;
    coordinates[1] = y;
    return coordinates;
  };
  return {
    originalCellId,
    kind: "Q1",
    level: 0,
    role: "base",
    points: [
      point(0, 0),
      point(1, 0),
      point(1, 1),
      point(0, 1)
    ]
  };
}

function defineReadOnce(
  target,
  key,
  value,
  reads,
  label
) {
  const readKey = `${label}.${String(key)}`;
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get() {
      reads[readKey] = (reads[readKey] ?? 0) + 1;
      assert.equal(
        reads[readKey],
        1,
        `${readKey} was read more than once`
      );
      return value;
    }
  });
}

function readOnceArray(values, reads, label) {
  const result = new Array(values.length);
  values.forEach((value, index) => {
    defineReadOnce(result, index, value, reads, label);
  });
  return result;
}

function readOnceGeometry(source, reads, label) {
  const points = readOnceArray(
    source.points.map((point, pointIndex) =>
      readOnceArray(
        point,
        reads,
        `${label}.points[${pointIndex}]`
      )
    ),
    reads,
    `${label}.points`
  );
  const result = {};
  for (const [key, value] of Object.entries({
    originalCellId: source.originalCellId,
    kind: source.kind,
    level: source.level,
    role: source.role,
    points
  })) {
    defineReadOnce(result, key, value, reads, label);
  }
  return result;
}

function supplyArrayIndexFromPrototype(array, index, value) {
  delete array[index];
  const prototype = Object.create(Array.prototype);
  Object.defineProperty(prototype, index, {
    configurable: true,
    value
  });
  Object.setPrototypeOf(array, prototype);
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

function command(
  id,
  hiddenCellIds,
  createdCellIds,
  {
    recipe = true,
    reactivatedCellIds = []
  } = {}
) {
  return {
    id,
    kind: "refine",
    hiddenCellIds,
    createdCellIds,
    ...(reactivatedCellIds.length === 0
      ? {}
      : { reactivatedCellIds }),
    createdNodeIds: [],
    ...(recipe
      ? {
          recipe: {
            version: 1,
            selectedCellIds: hiddenCellIds,
            selectedCellGeometry: hiddenCellIds.map((cellId) =>
              sampleGeometry(cellId)
            ),
            transitionSupportCellIds: [],
            transitionSupportCellGeometry: [],
            options: {
              includeTransitions: true,
              hexRefinementRatio: 2,
              hexTwoToOneSelectionMode: "local",
              hexTwoToOneCompensation: {
                mode: "local-topology",
                maxAddedParentLayers: 1,
                maxAddedParentCount: 32
              },
              rebuildExistingTransitions: true
            }
          }
        }
      : {})
  };
}

function sampleHistory() {
  const commands = [
    command("cmd-1", ["e1"], ["e1/1", "e1/2"]),
    command("cmd-2", ["e1/1"], ["e1/1/1"]),
    command("cmd-3", ["e9"], ["e9/1"])
  ];
  const knownCellIds = [
    "e1",
    "e1/1",
    "e1/2",
    "e1/1/1",
    "e9",
    "e9/1"
  ];
  return {
    commands,
    knownCellIds,
    componentCellIds: new Set([
      "e1",
      "e1/1",
      "e1/2",
      "e1/1/1"
    ])
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

test("version 2 recipes are rejected by cloning and history index construction", () => {
  const recipe = {
    ...sampleRecipe(),
    version: 2
  };
  const expectedError = {
    message: "unsupported refinement session command recipe version 2"
  };

  assert.throws(
    () => cloneRefinementSessionCommandRecipe(recipe),
    expectedError
  );

  const source = command("cmd-version-2", [], []);
  source.recipe = recipe;
  assert.throws(
    () => buildRefinementHistoryIndex([source], []),
    expectedError
  );
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

test("history index records stable creator and unique consumer provenance", () => {
  const { commands, knownCellIds } = sampleHistory();
  commands[1].reactivatedCellIds = ["e1/1"];
  const index = buildRefinementHistoryIndex(commands, knownCellIds);

  assert.deepEqual(
    index.commands.map((entry) => entry.id),
    ["cmd-1", "cmd-2", "cmd-3"]
  );
  assert.equal(index.commandById.get("cmd-2"), index.commands[1]);
  assert.equal(index.creatorCommandIdByCellId.get("e1/1"), "cmd-1");
  assert.deepEqual(
    index.consumerCommandIdsByCellId.get("e1/1"),
    ["cmd-2"]
  );
  assert.equal(index.commandOrdinalById.get("cmd-3"), 2);
});

test("history closure reaches the minimum dependent fixed point", () => {
  const { commands, knownCellIds, componentCellIds } = sampleHistory();
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const closure = buildRefinementHistoryClosure(index, {
    seedCellIds: ["e1/1"],
    componentCellIds
  });

  assert.deepEqual(closure.supportCommandIds, ["cmd-1"]);
  assert.deepEqual(closure.downstreamCommandIds, ["cmd-2"]);
  assert.deepEqual(
    closure.affectedInputCellIds,
    ["e1", "e1/1"]
  );
  assert.deepEqual(closure.preservedCommandIds, ["cmd-3"]);
  assert.deepEqual(closure.boundaryCellIds, ["e1"]);
});

test("history closure output is independent of seed order", () => {
  const { commands, knownCellIds, componentCellIds } = sampleHistory();
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const forward = buildRefinementHistoryClosure(index, {
    seedCellIds: ["e1/1", "e1/2"],
    componentCellIds
  });
  const reverse = buildRefinementHistoryClosure(index, {
    seedCellIds: ["e1/2", "e1/1"],
    componentCellIds
  });

  assert.deepEqual(reverse, forward);
});

test("history closure replays consumers of reactivated state versions", () => {
  const commands = [
    command("s1", ["a"], ["x"]),
    command("s2", ["x"], ["y"], {
      reactivatedCellIds: ["a"]
    }),
    command("s3", ["a"], ["z"])
  ];
  const knownCellIds = ["a", "x", "y", "z"];
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const closure = buildRefinementHistoryClosure(index, {
    seedCellIds: ["y"],
    componentCellIds: new Set(knownCellIds)
  });

  assert.deepEqual(closure.supportCommandIds, ["s1"]);
  assert.deepEqual(closure.downstreamCommandIds, ["s2", "s3"]);
  assert.deepEqual(closure.affectedInputCellIds, ["a", "x"]);
  assert.deepEqual(closure.preservedCommandIds, []);
  assert.deepEqual(closure.boundaryCellIds, ["a"]);
});

test("history closure classifies later seed consumers as downstream", () => {
  const commands = [
    command("s1", ["a"], ["x"]),
    command("s2", ["x"], ["y"], {
      reactivatedCellIds: ["a"]
    }),
    command("s3", ["a"], ["z"])
  ];
  const knownCellIds = ["a", "x", "y", "z"];
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const closure = buildRefinementHistoryClosure(index, {
    seedCellIds: ["a"],
    componentCellIds: new Set(knownCellIds)
  });

  assert.deepEqual(closure.supportCommandIds, ["s1"]);
  assert.deepEqual(closure.downstreamCommandIds, ["s2", "s3"]);
  assert.deepEqual(closure.preservedCommandIds, []);
});

test("history closure does not cross unrelated state versions", () => {
  const commands = [
    command("u1", ["a"], ["p"]),
    command("u2", [], ["y"], {
      reactivatedCellIds: ["a"]
    }),
    command("u3", ["a"], ["z"])
  ];
  const knownCellIds = ["a", "p", "y", "z"];
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const closure = buildRefinementHistoryClosure(index, {
    seedCellIds: ["y"],
    componentCellIds: new Set(knownCellIds)
  });

  assert.deepEqual(closure.supportCommandIds, ["u2"]);
  assert.deepEqual(closure.downstreamCommandIds, ["u3"]);
  assert.deepEqual(closure.preservedCommandIds, ["u1"]);
});

test("history closure starts from the latest reactivated active version", () => {
  const commands = [
    command("i1", [], ["y"], {
      reactivatedCellIds: ["a"]
    }),
    command("i2", ["a"], ["z"]),
    command("i3", [], ["w"], {
      reactivatedCellIds: ["a"]
    }),
    command("i4", ["a"], ["q"])
  ];
  const knownCellIds = ["a", "y", "z", "w", "q"];
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const closure = buildRefinementHistoryClosure(index, {
    seedCellIds: ["w"],
    componentCellIds: new Set(knownCellIds)
  });

  assert.deepEqual(closure.supportCommandIds, ["i3"]);
  assert.deepEqual(closure.downstreamCommandIds, ["i4"]);
  assert.deepEqual(closure.preservedCommandIds, ["i1", "i2"]);
});

test("history closure keeps interleaved cell state versions separate", () => {
  const commands = [
    command("a1", [], ["ay"], {
      reactivatedCellIds: ["a"]
    }),
    command("b1", [], ["by"], {
      reactivatedCellIds: ["b"]
    }),
    command("a2", ["a"], ["az"]),
    command("b2", ["b"], ["bz"]),
    command("a3", [], ["aw"], {
      reactivatedCellIds: ["a"]
    }),
    command("b3", [], ["bw"], {
      reactivatedCellIds: ["b"]
    }),
    command("a4", ["a"], ["aq"]),
    command("b4", ["b"], ["bq"])
  ];
  const knownCellIds = [
    "a",
    "b",
    "ay",
    "by",
    "az",
    "bz",
    "aw",
    "bw",
    "aq",
    "bq"
  ];
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const closure = buildRefinementHistoryClosure(index, {
    seedCellIds: ["aw"],
    componentCellIds: new Set(knownCellIds)
  });

  assert.deepEqual(closure.supportCommandIds, ["a3"]);
  assert.deepEqual(closure.downstreamCommandIds, ["a4"]);
  assert.deepEqual(
    closure.preservedCommandIds,
    ["a1", "b1", "a2", "b2", "b3", "b4"]
  );
});

test("history closure follows chronological active versions", () => {
  const commands = [
    command("create", ["root-a"], ["a"]),
    command("old-hide", ["a"], ["old"]),
    command("input", ["root-t"], ["t"]),
    command("reactivate", ["t"], ["w"], {
      reactivatedCellIds: ["a"]
    }),
    command("new-hide", ["a"], ["q"]),
    command("far", ["far-root"], ["far-cell"])
  ];
  const knownCellIds = [
    "root-a",
    "a",
    "old",
    "root-t",
    "t",
    "w",
    "q",
    "far-root",
    "far-cell"
  ];
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const componentCellIds = new Set(
    knownCellIds.filter((cellId) => !cellId.startsWith("far"))
  );
  const newVersion = buildRefinementHistoryClosure(index, {
    seedCellIds: ["w"],
    componentCellIds
  });
  assert.deepEqual(newVersion.supportCommandIds, ["input"]);
  assert.deepEqual(
    newVersion.downstreamCommandIds,
    ["reactivate", "new-hide"]
  );
  assert.deepEqual(
    newVersion.preservedCommandIds,
    ["create", "old-hide", "far"]
  );

  const allEvents = buildRefinementHistoryClosure(index, {
    seedCellIds: ["a"],
    componentCellIds
  });
  assert.deepEqual(allEvents.supportCommandIds, ["create", "input"]);
  assert.deepEqual(
    allEvents.downstreamCommandIds,
    ["old-hide", "reactivate", "new-hide"]
  );
  assert.deepEqual(allEvents.preservedCommandIds, ["far"]);
});

test("reactivation without a global creator is a legal active version", () => {
  const commands = [
    command("reactivate", [], ["w"], {
      reactivatedCellIds: ["a"]
    }),
    command("hide", ["a"], ["q"])
  ];
  const knownCellIds = ["a", "w", "q"];
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const closure = buildRefinementHistoryClosure(index, {
    seedCellIds: ["w"],
    componentCellIds: new Set(knownCellIds)
  });

  assert.equal(index.creatorCommandIdByCellId.has("a"), false);
  assert.deepEqual(closure.supportCommandIds, ["reactivate"]);
  assert.deepEqual(closure.downstreamCommandIds, ["hide"]);
  assert.deepEqual(closure.preservedCommandIds, []);
});

test("active history diamond is minimal and seed-order independent", () => {
  const commands = [
    command("left", ["root-left"], ["left-cell"]),
    command("right", ["root-right"], ["right-cell"]),
    command(
      "join",
      ["left-cell", "right-cell"],
      ["a", "b"]
    ),
    command("consume-a", ["a"], ["out-a"]),
    command("consume-b", ["b"], ["out-b"]),
    command("far", ["far-root"], ["far-cell"])
  ];
  const knownCellIds = [
    "root-left",
    "left-cell",
    "root-right",
    "right-cell",
    "a",
    "b",
    "out-a",
    "out-b",
    "far-root",
    "far-cell"
  ];
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const componentCellIds = new Set(
    knownCellIds.filter((cellId) => !cellId.startsWith("far"))
  );
  const forward = buildRefinementHistoryClosure(index, {
    seedCellIds: ["out-a", "out-b"],
    componentCellIds
  });
  const reverse = buildRefinementHistoryClosure(index, {
    seedCellIds: ["out-b", "out-a"],
    componentCellIds
  });

  assert.deepEqual(forward.supportCommandIds, ["left", "right"]);
  assert.deepEqual(
    forward.downstreamCommandIds,
    ["join", "consume-a", "consume-b"]
  );
  assert.deepEqual(forward.preservedCommandIds, ["far"]);
  assert.deepEqual(reverse, forward);
});

test("seeding one output keeps a multi-output command unsplit", () => {
  const commands = [
    command("producer", ["root"], ["x", "y"]),
    command("consume-x", ["x"], ["out-x"]),
    command("consume-y", ["y"], ["out-y"]),
    command("far", ["far-root"], ["far-cell"])
  ];
  const knownCellIds = [
    "root",
    "x",
    "y",
    "out-x",
    "out-y",
    "far-root",
    "far-cell"
  ];
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const closure = buildRefinementHistoryClosure(index, {
    seedCellIds: ["x"],
    componentCellIds: new Set([
      "root",
      "x",
      "y",
      "out-x",
      "out-y"
    ])
  });

  assert.deepEqual(closure.supportCommandIds, ["producer"]);
  assert.deepEqual(
    closure.downstreamCommandIds,
    ["consume-x", "consume-y"]
  );
  assert.deepEqual(closure.preservedCommandIds, ["far"]);
});

test("history index rejects duplicate command ids before other provenance", () => {
  assert.throws(
    () => buildRefinementHistoryIndex([
      command("cmd-1", ["e1"], ["e1/1"]),
      command("cmd-1", ["e2"], ["e2/1"])
    ], ["e1", "e1/1", "e2", "e2/1"]),
    { message: "duplicate refinement command id cmd-1" }
  );
});

test("history index rejects a cell with multiple creators", () => {
  assert.throws(
    () => buildRefinementHistoryIndex([
      command("cmd-1", ["e1"], ["shared"]),
      command("cmd-2", ["e2"], ["shared"])
    ], ["e1", "e2", "shared"]),
    {
      message:
        "cell shared has multiple creators: cmd-1, cmd-2"
    }
  );
});

test("history index rejects created cells outside the known universe", () => {
  assert.throws(
    () => buildRefinementHistoryIndex([
      command("cmd-missing-created", ["e1"], ["missing-created"])
    ], ["e1"]),
    {
      message:
        "command cmd-missing-created creates missing cell missing-created"
    }
  );
});

test("history index rejects missing hidden and reactivated references", () => {
  assert.throws(
    () => buildRefinementHistoryIndex([
      command("cmd-hidden", ["missing-hidden"], ["e1/1"])
    ], ["e1/1"]),
    {
      message:
        "command cmd-hidden references missing cell missing-hidden"
    }
  );

  assert.throws(
    () => buildRefinementHistoryIndex([
      command("cmd-reactivated", ["e1"], ["e1/1"], {
        reactivatedCellIds: ["missing-reactivated"]
      })
    ], ["e1", "e1/1"]),
    {
      message:
        "command cmd-reactivated references missing cell missing-reactivated"
    }
  );
});

test("history index snapshots each command field getter exactly once", () => {
  const readCounts = new Map();
  const changingGetter = (name, firstValue, laterValue) => ({
    enumerable: true,
    get() {
      const count = (readCounts.get(name) ?? 0) + 1;
      readCounts.set(name, count);
      return count === 1 ? firstValue : laterValue;
    }
  });
  const source = {};
  Object.defineProperties(source, {
    id: changingGetter("id", "cmd-once", ""),
    kind: changingGetter("kind", "refine", "changed"),
    hiddenCellIds: changingGetter(
      "hiddenCellIds",
      ["root"],
      ["missing-hidden"]
    ),
    createdCellIds: changingGetter(
      "createdCellIds",
      ["created"],
      ["missing-created"]
    ),
    activeCreatedCellIds: changingGetter(
      "activeCreatedCellIds",
      ["created"],
      ["missing-active"]
    ),
    reactivatedCellIds: changingGetter(
      "reactivatedCellIds",
      [],
      ["missing-reactivated"]
    ),
    createdNodeIds: changingGetter(
      "createdNodeIds",
      [],
      ["changed-node"]
    ),
    quality: changingGetter(
      "quality",
      { marker: "first" },
      { marker: "later" }
    ),
    twoToOne: changingGetter(
      "twoToOne",
      { marker: "first" },
      { marker: "later" }
    ),
    recipe: changingGetter(
      "recipe",
      sampleRecipe(),
      sampleRecipe()
    )
  });

  const index = buildRefinementHistoryIndex(
    [source],
    ["root", "created"]
  );
  const snapshot = index.commands[0];

  assert.equal(snapshot.id, "cmd-once");
  assert.deepEqual(snapshot.hiddenCellIds, ["root"]);
  assert.deepEqual(snapshot.createdCellIds, ["created"]);
  assert.deepEqual(snapshot.activeCreatedCellIds, ["created"]);
  assert.equal(snapshot.quality.marker, "first");
  assert.equal(snapshot.twoToOne.marker, "first");
  assert.deepEqual(
    Object.fromEntries(readCounts),
    {
      id: 1,
      kind: 1,
      hiddenCellIds: 1,
      createdCellIds: 1,
      activeCreatedCellIds: 1,
      reactivatedCellIds: 1,
      createdNodeIds: 1,
      quality: 1,
      twoToOne: 1,
      recipe: 1
    }
  );
});

test("history index rejects sparse top-level and command cell arrays", () => {
  const sparseArray = () => new Array(1);
  assert.throws(
    () => buildRefinementHistoryIndex(sparseArray(), []),
    { message: "commands must be dense: missing index 0" }
  );
  assert.throws(
    () => buildRefinementHistoryIndex([], sparseArray()),
    { message: "knownCellIds must be dense: missing index 0" }
  );

  for (const field of [
    "hiddenCellIds",
    "createdCellIds",
    "reactivatedCellIds",
    "activeCreatedCellIds"
  ]) {
    const source = {
      ...command("cmd-sparse", [], [], { recipe: false }),
      [field]: sparseArray()
    };
    assert.throws(
      () => buildRefinementHistoryIndex([source], []),
      {
        message:
          `command cmd-sparse ${field} must be dense: missing index 0`
      }
    );
  }
});

test("history index rejects invalid command and cell ids", () => {
  assert.throws(
    () => buildRefinementHistoryIndex([
      {
        ...command("", [], [], { recipe: false })
      }
    ], []),
    {
      message:
        "command at index 0 id must be a nonempty string"
    }
  );
  assert.throws(
    () => buildRefinementHistoryIndex([
      {
        ...command(7, [], [], { recipe: false })
      }
    ], []),
    {
      message:
        "command at index 0 id must be a nonempty string"
    }
  );
  assert.throws(
    () => buildRefinementHistoryIndex([], [""]),
    {
      message:
        "knownCellIds[0] must be a nonempty string"
    }
  );

  for (const field of [
    "hiddenCellIds",
    "createdCellIds",
    "reactivatedCellIds",
    "activeCreatedCellIds"
  ]) {
    const source = {
      ...command("cmd-invalid", [], [], { recipe: false }),
      [field]: [42]
    };
    assert.throws(
      () => buildRefinementHistoryIndex([source], []),
      {
        message:
          `command cmd-invalid ${field}[0] must be a nonempty string`
      }
    );
  }
});

test("history index validates active created cells against known creations", () => {
  const source = {
    ...command("cmd-active", [], ["created"], { recipe: false }),
    activeCreatedCellIds: ["missing-active"]
  };
  assert.throws(
    () => buildRefinementHistoryIndex([source], ["created"]),
    {
      message:
        "command cmd-active references missing active created cell missing-active"
    }
  );

  source.activeCreatedCellIds = ["known-not-created"];
  assert.throws(
    () => buildRefinementHistoryIndex(
      [source],
      ["created", "known-not-created"]
    ),
    {
      message:
        "command cmd-active active created cell known-not-created is not listed in createdCellIds"
    }
  );
});

test("history closure reports a missing seed cell deterministically", () => {
  const { commands, knownCellIds, componentCellIds } = sampleHistory();
  const index = buildRefinementHistoryIndex(commands, knownCellIds);

  assert.throws(
    () => buildRefinementHistoryClosure(index, {
      seedCellIds: ["missing-seed", "missing-seed"],
      componentCellIds
    }),
    (error) => {
      assert.equal(error instanceof RefinementHistoryClosureError, true);
      assert.equal(error.name, "RefinementHistoryClosureError");
      assert.equal(
        error.message,
        "history closure references missing seed cells"
      );
      assert.deepEqual(error.commandIds, []);
      assert.deepEqual(error.cellIds, ["missing-seed"]);
      assert.equal(Object.isFrozen(error.commandIds), true);
      assert.equal(Object.isFrozen(error.cellIds), true);
      return true;
    }
  );
});

test("history closure rejects a command that crosses the component", () => {
  const commands = [
    command("cmd-crossing", ["e1"], ["e1/1", "e9/1"]),
    command("cmd-local", ["e1/1"], ["e1/1/1"])
  ];
  const index = buildRefinementHistoryIndex(commands, [
    "e1",
    "e1/1",
    "e1/1/1",
    "e9/1"
  ]);

  assert.throws(
    () => buildRefinementHistoryClosure(index, {
      seedCellIds: ["e1/1"],
      componentCellIds: new Set(["e1", "e1/1", "e1/1/1"])
    }),
    (error) => {
      assert.equal(error instanceof RefinementHistoryClosureError, true);
      assert.equal(
        error.message,
        "history closure crosses the component boundary"
      );
      assert.deepEqual(error.commandIds, ["cmd-crossing"]);
      assert.deepEqual(error.cellIds, ["e9/1"]);
      return true;
    }
  );
});

test("history closure rejects every included command without a recipe", () => {
  const commands = [
    command("cmd-1", ["e1"], ["e1/1"]),
    command("cmd-2", ["e1/1"], ["e1/1/1"], { recipe: false })
  ];
  const index = buildRefinementHistoryIndex(commands, [
    "e1",
    "e1/1",
    "e1/1/1"
  ]);

  assert.throws(
    () => buildRefinementHistoryClosure(index, {
      seedCellIds: ["e1/1"],
      componentCellIds: new Set(["e1", "e1/1", "e1/1/1"])
    }),
    (error) => {
      assert.equal(error instanceof RefinementHistoryClosureError, true);
      assert.equal(
        error.message,
        "history closure includes commands without replay recipes"
      );
      assert.deepEqual(error.commandIds, ["cmd-2"]);
      assert.deepEqual(error.cellIds, []);
      return true;
    }
  );
});

test("history index snapshots command and consumer arrays", () => {
  const source = command(
    "cmd-shared",
    ["e1", "e2"],
    ["e1/1", "e2/1"]
  );
  const sourceCommands = [source];
  const index = buildRefinementHistoryIndex(sourceCommands, [
    "e1",
    "e2",
    "e1/1",
    "e2/1"
  ]);
  const indexed = index.commandById.get("cmd-shared");
  assert.ok(indexed);
  const e1Consumers = index.consumerCommandIdsByCellId.get("e1");
  const e2Consumers = index.consumerCommandIdsByCellId.get("e2");

  assert.notStrictEqual(index.commands, sourceCommands);
  assert.notStrictEqual(indexed, source);
  assert.notStrictEqual(indexed.hiddenCellIds, source.hiddenCellIds);
  assert.notStrictEqual(indexed.createdCellIds, source.createdCellIds);
  assert.notStrictEqual(
    indexed.recipe.selectedCellIds,
    source.recipe.selectedCellIds
  );
  assert.notStrictEqual(e1Consumers, e2Consumers);
  assert.equal(Object.isFrozen(index.commands), true);
  assert.equal(Object.isFrozen(indexed), true);
  assert.equal(Object.isFrozen(indexed.hiddenCellIds), true);
  assert.equal(Object.isFrozen(indexed.createdCellIds), true);
  assert.equal(Object.isFrozen(e1Consumers), true);
  assert.equal(Object.isFrozen(e2Consumers), true);

  source.hiddenCellIds.push("mutated-hidden");
  source.createdCellIds.push("mutated-created");
  source.recipe.selectedCellIds.push("mutated-selected");
  sourceCommands.push(command("mutated-command", [], []));

  assert.equal(index.commands.length, 1);
  assert.deepEqual(indexed.hiddenCellIds, ["e1", "e2"]);
  assert.deepEqual(indexed.createdCellIds, ["e1/1", "e2/1"]);
  assert.deepEqual(indexed.recipe.selectedCellIds, ["e1", "e2"]);
  assert.deepEqual(e1Consumers, ["cmd-shared"]);
  assert.deepEqual(e2Consumers, ["cmd-shared"]);
});

test("history index exposes read-only map facades at runtime", () => {
  const { commands, knownCellIds } = sampleHistory();
  const index = buildRefinementHistoryIndex(commands, knownCellIds);

  for (const map of [
    index.commandById,
    index.creatorCommandIdByCellId,
    index.consumerCommandIdsByCellId,
    index.commandOrdinalById
  ]) {
    assert.equal(map.set, undefined);
    assert.equal(map.delete, undefined);
    assert.equal(map.clear, undefined);
    assert.equal(Object.isFrozen(map), true);
    assert.throws(
      () => Map.prototype.set.call(map, "mutated", "value"),
      TypeError
    );
    map.forEach((_value, _key, callbackMap) => {
      assert.equal(callbackMap, map);
      assert.equal(callbackMap.set, undefined);
    });
  }
});

test("history closure is isolated from read-only facade prototype changes", () => {
  const { commands, knownCellIds, componentCellIds } = sampleHistory();
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const prototype = Object.getPrototypeOf(index.commandById);
  const originalGet = Object.getOwnPropertyDescriptor(
    prototype,
    "get"
  );
  assert.ok(originalGet);

  try {
    const replaced = Reflect.set(
      prototype,
      "get",
      () => {
        throw new Error("poisoned public facade");
      }
    );
    assert.equal(replaced, false);
    assert.equal(Object.isFrozen(prototype), true);

    const closure = buildRefinementHistoryClosure(index, {
      seedCellIds: ["e1/1"],
      componentCellIds
    });
    assert.deepEqual(closure.supportCommandIds, ["cmd-1"]);
    assert.deepEqual(closure.downstreamCommandIds, ["cmd-2"]);
    assert.deepEqual(
      [...index.commandById].map(([commandId]) => commandId),
      ["cmd-1", "cmd-2", "cmd-3"]
    );
  } finally {
    if (!Object.isFrozen(prototype)) {
      Object.defineProperty(prototype, "get", originalGet);
    }
  }
});

test("history index builds 20k hidden fanout without fanout-sized sorts", () => {
  const childScript = `
    import assert from "node:assert/strict";
    import {
      buildRefinementHistoryIndex
    } from "./dist/index.js";

    const fanout = 20_000;
    const inputCellIds = Array.from(
      { length: fanout },
      (_, index) => \`input-\${index}\`
    );
    const commands = [
      {
        id: "producer",
        kind: "refine",
        hiddenCellIds: ["root"],
        createdCellIds: inputCellIds,
        createdNodeIds: []
      },
      ...inputCellIds.map((cellId, index) => ({
        id: \`consumer-\${index}\`,
        kind: "refine",
        hiddenCellIds: [cellId],
        createdCellIds: [\`output-\${index}\`],
        createdNodeIds: []
      }))
    ];
    const knownCellIds = [
      "root",
      ...inputCellIds,
      ...Array.from(
        { length: fanout },
        (_, index) => \`output-\${index}\`
      )
    ];
    const originalSort = Array.prototype.sort;
    Array.prototype.sort = function (...args) {
      if (this.length >= fanout) {
        throw new Error(
          \`unexpected fanout-sized sort: \${this.length}\`
        );
      }
      return Reflect.apply(originalSort, this, args);
    };
    try {
      const index = buildRefinementHistoryIndex(
        commands,
        knownCellIds
      );
      assert.equal(index.commands.length, fanout + 1);
      assert.deepEqual(
        index.consumerCommandIdsByCellId.get("input-0"),
        ["consumer-0"]
      );
      assert.deepEqual(
        index.consumerCommandIdsByCellId.get(
          \`input-\${fanout - 1}\`
        ),
        [\`consumer-\${fanout - 1}\`]
      );
    } finally {
      Array.prototype.sort = originalSort;
    }
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", childScript],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );

  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n")
  );
});

test("history closure completes a 10k active dependency chain", () => {
  const commandCount = 10_000;
  const commands = Array.from({ length: commandCount }, (_, index) =>
    command(
      `chain-${index}`,
      [index === 0 ? "root" : `cell-${index - 1}`],
      [`cell-${index}`]
    )
  );
  const knownCellIds = [
    "root",
    ...Array.from(
      { length: commandCount },
      (_, index) => `cell-${index}`
    )
  ];
  const historyIndex = buildRefinementHistoryIndex(
    commands,
    knownCellIds
  );
  const closure = buildRefinementHistoryClosure(historyIndex, {
    seedCellIds: [`cell-${commandCount - 1}`],
    componentCellIds: new Set(knownCellIds)
  });

  assert.deepEqual(closure.supportCommandIds, ["chain-0"]);
  assert.equal(
    closure.downstreamCommandIds.length,
    commandCount - 1
  );
  assert.equal(closure.downstreamCommandIds[0], "chain-1");
  assert.equal(
    closure.downstreamCommandIds.at(-1),
    `chain-${commandCount - 1}`
  );
  assert.deepEqual(closure.preservedCommandIds, []);
});

test("history index maps are read-only in the public TypeScript API", () => {
  const virtualFileName = resolve(
    "test",
    "__refinement-history-api-typecheck.ts"
  );
  const source = `
    import { buildRefinementHistoryIndex } from "../dist/index.js";
    const index = buildRefinementHistoryIndex([], []);
    type Assert<T extends true> = T;
    type IsReadonlyMap<T> =
      T extends ReadonlyMap<unknown, unknown> ? true : false;
    type HasNoMapMutators<T> =
      Extract<"set" | "delete" | "clear", keyof T> extends never
        ? true
        : false;
    type CommandMap = Assert<IsReadonlyMap<typeof index.commandById>>;
    type CreatorMap = Assert<
      IsReadonlyMap<typeof index.creatorCommandIdByCellId>
    >;
    type ConsumerMap = Assert<
      IsReadonlyMap<typeof index.consumerCommandIdsByCellId>
    >;
    type OrdinalMap = Assert<
      IsReadonlyMap<typeof index.commandOrdinalById>
    >;
    type CommandMapMutators = Assert<
      HasNoMapMutators<typeof index.commandById>
    >;
    type CreatorMapMutators = Assert<
      HasNoMapMutators<typeof index.creatorCommandIdByCellId>
    >;
    type ConsumerMapMutators = Assert<
      HasNoMapMutators<typeof index.consumerCommandIdsByCellId>
    >;
    type OrdinalMapMutators = Assert<
      HasNoMapMutators<typeof index.commandOrdinalById>
    >;
  `;
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const isVirtualFile = (fileName) =>
    resolve(fileName) === virtualFileName;
  host.fileExists = (fileName) =>
    isVirtualFile(fileName) || fileExists(fileName);
  host.readFile = (fileName) =>
    isVirtualFile(fileName) ? source : readFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError) =>
    isVirtualFile(fileName)
      ? ts.createSourceFile(
          fileName,
          source,
          languageVersion,
          true,
          ts.ScriptKind.TS
        )
      : getSourceFile(fileName, languageVersion, onError);
  const program = ts.createProgram([virtualFileName], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);

  assert.deepEqual(
    diagnostics.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
    ),
    []
  );
});

test("cell geometry remapping prefers the compatible original active id", () => {
  const index = new RefinementCellGeometryIndex(1e-8);
  index.add("duplicate", sampleGeometry("duplicate"));
  index.add("e1", sampleGeometry("e1"));

  assert.equal(index.uniqueMatch(sampleGeometry("e1")), "e1");
});

test("cell geometry remapping prefers a tolerance-compatible original id over another exact candidate", () => {
  const index = new RefinementCellGeometryIndex(1e-8);
  const original = sampleGeometry("e1");
  original.points[0][0] += 5e-9;
  index.add("e1", original);
  index.add("exact", sampleGeometry("exact"));

  assert.equal(index.uniqueMatch(sampleGeometry("e1")), "e1");
});

test("cell geometry remapping finds one exact corner set without node-id semantics", () => {
  const points = sampleGeometry("source").points;
  const session = {
    nodes: [
      ...points.map((point) => [...point]),
      ...points.map((point) => [...point])
    ],
    cells: new Map([
      ["old", {
        id: "old",
        kind: "H1",
        level: 0,
        role: "base",
        element: [1, 2, 3, 4, 5, 6, 7, 8]
      }],
      ["replacement", {
        id: "replacement",
        kind: "H1",
        level: 0,
        role: "base",
        element: [16, 15, 14, 13, 12, 11, 10, 9]
      }]
    ])
  };
  const candidate = snapshotRefinementCellGeometry(
    session,
    "replacement"
  );
  const query = snapshotRefinementCellGeometry(session, "old");
  candidate.points[0][0] = -0;
  const index = new RefinementCellGeometryIndex(0);
  index.add("replacement", candidate);

  assert.equal(index.uniqueMatch(query), "replacement");
});

test("cell geometry remapping tolerates noise on every coordinate and local corner reordering", () => {
  const index = new RefinementCellGeometryIndex(1e-8);
  index.add("replacement", sampleGeometry("replacement"));
  const source = sampleGeometry("old");
  const order = [6, 0, 5, 3, 1, 7, 2, 4];
  source.points = order.map((pointIndex, orderIndex) =>
    source.points[pointIndex].map((coordinate, coordinateIndex) =>
      coordinate
        + ((orderIndex + coordinateIndex) % 2 === 0 ? 2e-10 : -2e-10)
    )
  );

  assert.equal(index.uniqueMatch(source), "replacement");
});

test("cell geometry remapping reports sorted frozen ambiguity and no-match undefined", () => {
  const index = new RefinementCellGeometryIndex(1e-8);
  index.add("b", sampleGeometry("b"));
  index.add("a", sampleGeometry("a"));

  assert.throws(
    () => index.uniqueMatch(sampleGeometry("old")),
    (error) => {
      assert.equal(
        error instanceof RefinementCellGeometryMatchError,
        true
      );
      assert.equal(error.name, "RefinementCellGeometryMatchError");
      assert.deepEqual(error.cellIds, ["a", "b"]);
      assert.equal(Object.isFrozen(error.cellIds), true);
      return true;
    }
  );
  assert.equal(
    index.uniqueMatch(sampleGeometry("far", 10)),
    undefined
  );
});

test("cell geometry remapping requires compatible metadata, point count, dimension, and tolerance", () => {
  const index = new RefinementCellGeometryIndex(1e-8);
  index.add("candidate", sampleGeometry("candidate"));

  const incompatible = [
    {
      ...sampleGeometry("old"),
      kind: "Q1",
      points: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0]
      ]
    },
    { ...sampleGeometry("old"), level: 1 },
    { ...sampleGeometry("old"), role: "selected" },
    {
      ...sampleGeometry("old"),
      points: sampleGeometry("old").points.map((point) => [
        ...point,
        0
      ])
    }
  ];
  for (const query of incompatible) {
    assert.equal(index.uniqueMatch(query), undefined);
  }

  const overTolerance = sampleGeometry("old");
  overTolerance.points[0][0] = 2e-8;
  assert.equal(index.uniqueMatch(overTolerance), undefined);
});

test("cell geometry remapping rejects malformed and collapsed geometry", () => {
  const malformed = [];
  malformed.push({
    geometry: { ...sampleGeometry("empty"), points: [] },
    message: /at least one point/
  });
  const sparsePoints = sampleGeometry("sparse-points");
  sparsePoints.points = new Array(8);
  malformed.push({
    geometry: sparsePoints,
    message: /points must be dense/
  });
  const sparseCoordinate = sampleGeometry("sparse-coordinate");
  sparseCoordinate.points[0] = new Array(3);
  malformed.push({
    geometry: sparseCoordinate,
    message: /coordinates must be dense/
  });
  const nonfinite = sampleGeometry("nonfinite");
  nonfinite.points[1][2] = Number.POSITIVE_INFINITY;
  malformed.push({
    geometry: nonfinite,
    message: /coordinates must be finite/
  });
  const uneven = sampleGeometry("uneven");
  uneven.points[2] = [1, 1];
  malformed.push({
    geometry: uneven,
    message: /same dimension/
  });

  for (const { geometry, message } of malformed) {
    const index = new RefinementCellGeometryIndex(1e-8);
    assert.throws(
      () => index.add(geometry.originalCellId, geometry),
      (error) =>
        error instanceof RefinementCellGeometryMatchError
        && message.test(error.message)
    );
  }

  const repeated = sampleGeometry("repeated");
  repeated.points[1] = [...repeated.points[0]];
  const zeroAreaQ1 = {
    originalCellId: "zero-area",
    kind: "Q1",
    level: 0,
    role: "base",
    points: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0]
    ]
  };
  const coplanarH1 = sampleGeometry("coplanar");
  coplanarH1.points = coplanarH1.points.map(([x, y]) => [x, y, 0]);

  for (const geometry of [repeated, zeroAreaQ1, coplanarH1]) {
    const index = new RefinementCellGeometryIndex(1e-8);
    assert.throws(
      () => index.add(geometry.originalCellId, geometry),
      (error) =>
        error instanceof RefinementCellGeometryMatchError
        && error.cellIds[0] === geometry.originalCellId
        && /collapsed/.test(error.message)
    );
  }
});

test("cell geometry remapping accepts finite 4D cells and treats dimension and extra coordinates as geometry", () => {
  const candidate = sampleGeometry("candidate");
  candidate.points = candidate.points.map((point, index) => [
    ...point,
    index
  ]);
  const reordered = {
    ...sampleGeometry("old"),
    points: [7, 3, 5, 1, 6, 2, 4, 0].map((index) => [
      ...sampleGeometry("old").points[index],
      index
    ])
  };
  const index = new RefinementCellGeometryIndex(1e-8);
  index.add("candidate", candidate);

  assert.equal(index.uniqueMatch(reordered), "candidate");
  assert.equal(
    index.uniqueMatch(sampleGeometry("three-dimensional")),
    undefined
  );
  reordered.points[0][3] += 2e-8;
  assert.equal(index.uniqueMatch(reordered), undefined);
});

test("cell geometry validation computes affine rank across every finite 4D coordinate", () => {
  const q1 = {
    originalCellId: "q1-xw",
    kind: "Q1",
    level: 0,
    role: "base",
    points: [
      [0, 0, 0, 0],
      [1e200, 0, 0, 0],
      [1e200, 0, 0, 1e-200],
      [0, 0, 0, 1e-200]
    ]
  };
  const h1 = {
    originalCellId: "h1-xyw",
    kind: "H1",
    level: 0,
    role: "base",
    points: [
      [0, 0, 0, 0],
      [1e200, 0, 0, 0],
      [1e200, 1e-200, 0, 0],
      [0, 1e-200, 0, 0],
      [0, 0, 0, 1],
      [1e200, 0, 0, 1],
      [1e200, 1e-200, 0, 1],
      [0, 1e-200, 0, 1]
    ]
  };
  const index = new RefinementCellGeometryIndex(0);
  index.add("q1-xw", q1);
  index.add("h1-xyw", h1);

  assert.equal(
    index.uniqueMatch({
      ...q1,
      originalCellId: "old-q1",
      points: [...q1.points].reverse()
    }),
    "q1-xw"
  );
  assert.equal(
    index.uniqueMatch({
      ...h1,
      originalCellId: "old-h1",
      points: [...h1.points].reverse()
    }),
    "h1-xyw"
  );
});

test("cell geometry validation rejects truly low-rank 4D corner sets", () => {
  const lowRankQ1 = {
    originalCellId: "low-rank-q1",
    kind: "Q1",
    level: 0,
    role: "base",
    points: [
      [0, 0, 0, 0],
      [1, 0, 0, 2],
      [2, 0, 0, 4],
      [3, 0, 0, 6]
    ]
  };
  const lowRankH1 = {
    originalCellId: "low-rank-h1",
    kind: "H1",
    level: 0,
    role: "base",
    points: [
      [0, 0, 0, 0],
      [1, 0, 0, 1],
      [1, 1, 0, 2],
      [0, 1, 0, 1],
      [2, 0, 0, 2],
      [2, 1, 0, 3],
      [3, 0, 0, 3],
      [3, 1, 0, 4]
    ]
  };

  for (const geometry of [lowRankQ1, lowRankH1]) {
    assert.throws(
      () => new RefinementCellGeometryIndex(0).add(
        geometry.originalCellId,
        geometry
      ),
      (error) =>
        error instanceof RefinementCellGeometryMatchError
        && /collapsed/.test(error.message)
    );
  }
});

test("cell geometry exact affine rank accepts a binary64-nonzero 1e-14 Q1 residual", () => {
  const geometry = {
    originalCellId: "near-line-q1",
    kind: "Q1",
    level: 0,
    role: "base",
    points: [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3 + 1e-14]
    ]
  };
  const index = new RefinementCellGeometryIndex(0);
  index.add("near-line-q1", geometry);

  assert.equal(
    index.uniqueMatch({
      ...geometry,
      originalCellId: "old-q1",
      points: [...geometry.points].reverse()
    }),
    "near-line-q1"
  );
});

test("cell geometry exact affine rank accepts a binary64-nonzero 5e-14 H1 residual", () => {
  const points = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [2, 0],
    [2, 1],
    [0, 2],
    [1, 2]
  ].map(([x, y], index) => [
    x,
    y,
    x + y + (index === 7 ? 5e-14 : 0)
  ]);
  const geometry = {
    originalCellId: "near-plane-h1",
    kind: "H1",
    level: 0,
    role: "base",
    points
  };
  const index = new RefinementCellGeometryIndex(0);
  index.add("near-plane-h1", geometry);

  assert.equal(
    index.uniqueMatch({
      ...geometry,
      originalCellId: "old-h1",
      points: [...geometry.points].reverse()
    }),
    "near-plane-h1"
  );
});

test("cell geometry exact affine rank rejects rotated translated low-rank 4D cells", () => {
  const base = [
    2 ** 500,
    -(2 ** 500),
    2 ** 400,
    -(2 ** 400)
  ];
  const firstDirection = [
    2 ** 470,
    2 ** 469,
    -(2 ** 370),
    2 ** 369
  ];
  const secondDirection = [
    -(2 ** 466),
    2 ** 465,
    2 ** 366,
    2 ** 365
  ];
  const point = (first, second = 0) =>
    base.map((coordinate, index) =>
      coordinate
        + first * firstDirection[index]
        + second * secondDirection[index]
    );
  const collinearQ1 = {
    originalCellId: "translated-line-q1",
    kind: "Q1",
    level: 0,
    role: "base",
    points: [0, 1, 2, 3].map((coefficient) =>
      point(coefficient)
    )
  };
  const coplanarH1 = {
    originalCellId: "translated-plane-h1",
    kind: "H1",
    level: 0,
    role: "base",
    points: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 0],
      [0, 2],
      [2, 1],
      [1, 2]
    ].map(([first, second]) => point(first, second))
  };

  for (const geometry of [collinearQ1, coplanarH1]) {
    assert.throws(
      () => new RefinementCellGeometryIndex(0).add(
        geometry.originalCellId,
        geometry
      ),
      (error) =>
        error instanceof RefinementCellGeometryMatchError
        && /collapsed/.test(error.message)
    );
  }
});

test("cell geometry exact affine rank preserves MIN_VALUE mixed-exponent H1 geometry", () => {
  const points = [];
  for (const x of [0, 1e308]) {
    for (const y of [0, 1e-300]) {
      for (const w of [0, Number.MIN_VALUE]) {
        points.push([x, y, 0, w]);
      }
    }
  }
  const geometry = {
    originalCellId: "mixed-exponent-h1",
    kind: "H1",
    level: 0,
    role: "base",
    points
  };
  const index = new RefinementCellGeometryIndex(0);
  index.add("mixed-exponent-h1", geometry);

  assert.equal(
    index.uniqueMatch({
      ...geometry,
      originalCellId: "old-mixed",
      points: [...geometry.points].reverse()
    }),
    "mixed-exponent-h1"
  );
});

test("cell geometry index validates tolerance and ids and snapshots candidates on add", () => {
  for (const tolerance of [
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  ]) {
    assert.throws(
      () => new RefinementCellGeometryIndex(tolerance),
      RangeError
    );
  }
  assert.doesNotThrow(() => new RefinementCellGeometryIndex(0));

  const index = new RefinementCellGeometryIndex(1e-8);
  assert.throws(
    () => index.add("", sampleGeometry("source")),
    RefinementCellGeometryMatchError
  );
  const source = sampleGeometry("source");
  const expected = structuredClone(source);
  index.add("candidate", source);
  assert.throws(
    () => index.add("candidate", sampleGeometry("other", 4)),
    (error) =>
      error instanceof RefinementCellGeometryMatchError
      && error.cellIds.join(",") === "candidate"
      && /duplicate candidate cell id/.test(error.message)
  );

  source.kind = "Q1";
  source.level = 7;
  source.role = "selected";
  source.points[0][0] = 100;
  source.points.reverse();
  assert.equal(index.uniqueMatch(expected), "candidate");
});

test("cell geometry index tolerance cannot be reassigned or shadow internal matching behavior", () => {
  const index = new RefinementCellGeometryIndex(1e-8);
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(index),
    "tolerance"
  );

  assert.equal(typeof descriptor?.get, "function");
  assert.equal(descriptor?.set, undefined);
  assert.equal(Object.hasOwn(index, "tolerance"), false);
  assert.throws(() => {
    index.tolerance = Infinity;
  }, TypeError);
  assert.equal(Reflect.set(index, "tolerance", Infinity), false);
  assert.equal(index.tolerance, 1e-8);

  index.add("candidate", sampleGeometry("candidate"));
  assert.equal(
    index.uniqueMatch(sampleGeometry("far", 10)),
    undefined
  );
});

test("cell geometry add and query capture getter-backed inputs exactly once", () => {
  const reads = {};
  const index = new RefinementCellGeometryIndex(1e-8);
  index.add(
    "candidate",
    readOnceGeometry(
      sampleGeometry("candidate"),
      reads,
      "candidate"
    )
  );

  assert.equal(
    index.uniqueMatch(
      readOnceGeometry(sampleGeometry("old"), reads, "query")
    ),
    "candidate"
  );
  assert.equal(
    Object.values(reads).every((count) => count === 1),
    true
  );
});

test("snapshotRefinementCellGeometry returns a deep copy and stable match errors", () => {
  const sourcePoints = sampleGeometry("e1").points.map((point) => [
    ...point
  ]);
  const cell = {
    id: "e1",
    kind: "H1",
    level: 2,
    role: "selected",
    element: [1, 2, 3, 4, 5, 6, 7, 8]
  };
  const session = {
    nodes: sourcePoints,
    cells: new Map([["e1", cell]])
  };
  const snapshot = snapshotRefinementCellGeometry(session, "e1");

  assert.deepEqual(snapshot, {
    originalCellId: "e1",
    kind: "H1",
    level: 2,
    role: "selected",
    points: sampleGeometry("e1").points
  });
  assert.notStrictEqual(snapshot.points, sourcePoints);
  assert.notStrictEqual(snapshot.points[0], sourcePoints[0]);
  sourcePoints[0][0] = 99;
  cell.element.reverse();
  assert.equal(snapshot.points[0][0], 0);

  const assertSnapshotError = (action, message, cellIds) => {
    assert.throws(action, (error) => {
      assert.equal(
        error instanceof RefinementCellGeometryMatchError,
        true
      );
      assert.equal(error.message, message);
      assert.deepEqual(error.cellIds, cellIds);
      assert.equal(Object.isFrozen(error.cellIds), true);
      return true;
    });
  };
  assertSnapshotError(
    () => snapshotRefinementCellGeometry(session, "missing"),
    "cannot snapshot missing cell missing",
    ["missing"]
  );

  const missingNodeSession = {
    nodes: sourcePoints.slice(0, 7),
    cells: new Map([["e1", {
      ...cell,
      element: [1, 2, 3, 4, 5, 6, 7, 8]
    }]])
  };
  assertSnapshotError(
    () => snapshotRefinementCellGeometry(missingNodeSession, "e1"),
    "cell e1 references missing node 8",
    ["e1"]
  );

  const invalidPointSession = {
    nodes: [
      [Number.NaN, 0, 0],
      ...sampleGeometry("e1").points.slice(1)
    ],
    cells: new Map([["e1", {
      ...cell,
      element: [1, 2, 3, 4, 5, 6, 7, 8]
    }]])
  };
  assertSnapshotError(
    () => snapshotRefinementCellGeometry(invalidPointSession, "e1"),
    "cell e1 point 1 coordinates must be finite",
    ["e1"]
  );

  const invalidPointShapeSession = {
    nodes: [
      null,
      ...sampleGeometry("e1").points.slice(1)
    ],
    cells: new Map([["e1", {
      ...cell,
      element: [1, 2, 3, 4, 5, 6, 7, 8]
    }]])
  };
  assertSnapshotError(
    () => snapshotRefinementCellGeometry(
      invalidPointShapeSession,
      "e1"
    ),
    "cell e1 point 1 must be an array",
    ["e1"]
  );
});

test("snapshotRefinementCellGeometry captures session, cell, element, and point getters once", () => {
  const reads = {};
  const source = sampleGeometry("e1");
  const nodes = readOnceArray(
    source.points.map((point, pointIndex) =>
      readOnceArray(
        point,
        reads,
        `nodes[${pointIndex}]`
      )
    ),
    reads,
    "nodes"
  );
  const element = readOnceArray(
    [1, 2, 3, 4, 5, 6, 7, 8],
    reads,
    "element"
  );
  const cell = {};
  for (const [key, value] of Object.entries({
    element,
    kind: "H1",
    level: 2,
    role: "selected"
  })) {
    defineReadOnce(cell, key, value, reads, "cell");
  }
  const cells = new Map([["e1", cell]]);
  const session = {};
  defineReadOnce(session, "nodes", nodes, reads, "session");
  defineReadOnce(session, "cells", cells, reads, "session");

  assert.deepEqual(snapshotRefinementCellGeometry(session, "e1"), {
    originalCellId: "e1",
    kind: "H1",
    level: 2,
    role: "selected",
    points: source.points
  });
  assert.equal(
    Object.values(reads).every((count) => count === 1),
    true
  );
});

test("cell geometry rejects prototype-supplied point, coordinate, node, and element holes", () => {
  const inheritedPoint = sampleGeometry("inherited-point");
  supplyArrayIndexFromPrototype(
    inheritedPoint.points,
    0,
    inheritedPoint.points[0]
  );
  assert.throws(
    () => new RefinementCellGeometryIndex(0).add(
      "inherited-point",
      inheritedPoint
    ),
    (error) =>
      error instanceof RefinementCellGeometryMatchError
      && /points must be dense/.test(error.message)
  );

  const inheritedCoordinate = sampleGeometry(
    "inherited-coordinate"
  );
  supplyArrayIndexFromPrototype(
    inheritedCoordinate.points[0],
    1,
    inheritedCoordinate.points[0][1]
  );
  assert.throws(
    () => new RefinementCellGeometryIndex(0).add(
      "inherited-coordinate",
      inheritedCoordinate
    ),
    (error) =>
      error instanceof RefinementCellGeometryMatchError
      && /coordinates must be dense/.test(error.message)
  );

  const inheritedElement = [1, 2, 3, 4, 5, 6, 7, 8];
  supplyArrayIndexFromPrototype(inheritedElement, 0, 1);
  assert.throws(
    () => snapshotRefinementCellGeometry({
      nodes: sampleGeometry("e1").points,
      cells: new Map([["e1", {
        kind: "H1",
        level: 0,
        role: "base",
        element: inheritedElement
      }]])
    }, "e1"),
    (error) =>
      error instanceof RefinementCellGeometryMatchError
      && error.cellIds.join(",") === "e1"
      && /element must be dense/.test(error.message)
  );

  const inheritedNodes = sampleGeometry("e1").points;
  supplyArrayIndexFromPrototype(
    inheritedNodes,
    0,
    inheritedNodes[0]
  );
  assert.throws(
    () => snapshotRefinementCellGeometry({
      nodes: inheritedNodes,
      cells: new Map([["e1", {
        kind: "H1",
        level: 0,
        role: "base",
        element: [1, 2, 3, 4, 5, 6, 7, 8]
      }]])
    }, "e1"),
    (error) =>
      error instanceof RefinementCellGeometryMatchError
      && error.cellIds.join(",") === "e1"
      && /references missing node 1/.test(error.message)
  );
});

test("cell geometry tolerance matching avoids squared-distance overflow and underflow", () => {
  const scaleGeometry = (cellId, scale) => ({
    ...sampleGeometry(cellId),
    points: sampleGeometry(cellId).points.map((point) =>
      point.map((coordinate) => coordinate * scale)
    )
  });

  const overflowIndex = new RefinementCellGeometryIndex(2e190);
  overflowIndex.add(
    "overflow-candidate",
    scaleGeometry("overflow-candidate", 1e200)
  );
  const overflowQuery = scaleGeometry("overflow-old", 1e200);
  overflowQuery.points = overflowQuery.points.map((point) =>
    point.map((coordinate) => coordinate + 1e190)
  );
  assert.equal(
    overflowIndex.uniqueMatch(overflowQuery),
    "overflow-candidate"
  );

  const underflowIndex = new RefinementCellGeometryIndex(2e-210);
  underflowIndex.add(
    "underflow-candidate",
    scaleGeometry("underflow-candidate", 1e-200)
  );
  const underflowQuery = scaleGeometry("underflow-old", 1e-200);
  underflowQuery.points = underflowQuery.points.map(([x, y, z]) => [
    x + 3e-210,
    y,
    z
  ]);
  assert.equal(underflowIndex.uniqueMatch(underflowQuery), undefined);
});

test("cell geometry tolerance matching rejects two MIN_VALUE deltas at MIN_VALUE tolerance", () => {
  const candidate = q1GeometryInDimension("candidate", 4);
  const query = structuredClone(candidate);
  query.originalCellId = "old";
  query.points[0][2] = Number.MIN_VALUE;
  query.points[0][3] = Number.MIN_VALUE;
  const index = new RefinementCellGeometryIndex(Number.MIN_VALUE);
  index.add("candidate", candidate);

  assert.equal(index.uniqueMatch(query), undefined);
});

test("cell geometry tolerance matching retains 125k small components after a boundary component", () => {
  const dimension = 125_000;
  const tolerance = 1e-8;
  const candidate = q1GeometryInDimension(
    "candidate",
    dimension
  );
  const query = structuredClone(candidate);
  query.originalCellId = "old";
  query.points[0].fill(1e-16, 2);
  query.points[0][2] = tolerance;
  const index = new RefinementCellGeometryIndex(tolerance);
  index.add("candidate", candidate);

  assert.equal(index.uniqueMatch(query), undefined);
});

test("cell geometry tolerance matching accepts one boundary component and zero remainder", () => {
  const tolerance = 1e-8;
  const candidate = q1GeometryInDimension("candidate", 32);
  const query = structuredClone(candidate);
  query.originalCellId = "old";
  query.points[0][2] = tolerance;
  const index = new RefinementCellGeometryIndex(tolerance);
  index.add("candidate", candidate);

  assert.equal(index.uniqueMatch(query), "candidate");
});

test("cell geometry compensated squared norm distinguishes sums just below and above one", () => {
  const componentCount = 16;
  const candidate = q1GeometryInDimension(
    "candidate",
    componentCount + 2
  );
  const index = new RefinementCellGeometryIndex(1);
  index.add("candidate", candidate);

  const queryAt = (lastComponent) => {
    const query = structuredClone(candidate);
    query.originalCellId = "old";
    query.points[0].fill(0.25, 2);
    query.points[0][componentCount + 1] = lastComponent;
    return query;
  };

  assert.equal(
    index.uniqueMatch(queryAt(0.25 - 1e-12)),
    "candidate"
  );
  assert.equal(
    index.uniqueMatch(queryAt(0.25 + 1e-12)),
    undefined
  );
});

test("cell geometry matching finds an augmenting path when query-order greedy would fail", () => {
  const candidate = {
    originalCellId: "candidate",
    kind: "Q1",
    level: 0,
    role: "base",
    points: [
      [0, 0],
      [1.5, 0],
      [0, 10],
      [20, 20]
    ]
  };
  const query = {
    ...candidate,
    originalCellId: "old",
    points: [
      [0.75, 0],
      [0, 0],
      [0, 10.1],
      [20, 20]
    ]
  };
  const index = new RefinementCellGeometryIndex(1);
  index.add("candidate", candidate);

  assert.equal(index.uniqueMatch(query), "candidate");
});

test("cell geometry validation rejects Q1 and H1 point counts before matching", () => {
  const invalid = [
    {
      ...sampleGeometry("q1-three"),
      kind: "Q1",
      points: [
        [0, 0],
        [1, 0],
        [0, 1]
      ]
    },
    {
      ...sampleGeometry("q1-nine"),
      kind: "Q1",
      points: Array.from(
        { length: 9 },
        (_, index) => [index, index * index]
      )
    },
    {
      ...sampleGeometry("q1-nine-thousand"),
      kind: "Q1",
      points: Array.from(
        { length: 9_000 },
        (_, index) => [index, index * index]
      )
    },
    {
      ...sampleGeometry("h1-nine"),
      points: [
        ...sampleGeometry("h1-nine").points,
        [2, 2, 2]
      ]
    }
  ];

  for (const geometry of invalid) {
    assert.throws(
      () => new RefinementCellGeometryIndex(1).add(
        geometry.originalCellId,
        geometry
      ),
      (error) =>
        error instanceof RefinementCellGeometryMatchError
        && error.cellIds.join(",") === geometry.originalCellId
        && /must contain exactly (4|8) points/.test(error.message)
    );
  }
});
