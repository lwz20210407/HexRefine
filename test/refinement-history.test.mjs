import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

import {
  buildRefinementHistoryClosure,
  buildRefinementHistoryIndex,
  cloneRefinementSessionCommandRecipe,
  freezeRefinementSessionCommandRecipe,
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
  assert.deepEqual(closure.preservedCommandIds, []);
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

test("reactivated state retains identity creator without old active consumers", () => {
  const commands = [
    command("c1", ["root"], ["a"]),
    command("c2", ["a"], ["old"]),
    command("c3", [], ["w"], {
      reactivatedCellIds: ["a"]
    }),
    command("c4", ["a"], ["q"])
  ];
  const knownCellIds = ["root", "a", "old", "w", "q"];
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const closure = buildRefinementHistoryClosure(index, {
    seedCellIds: ["w"],
    componentCellIds: new Set(knownCellIds)
  });

  assert.deepEqual(closure.supportCommandIds, ["c1"]);
  assert.deepEqual(closure.downstreamCommandIds, ["c3", "c4"]);
  assert.deepEqual(closure.preservedCommandIds, ["c2"]);
});

test("identity restoration backedges do not activate the creator output", () => {
  const commands = [
    command("p0", ["root"], ["x"]),
    command("c1", ["x"], ["a"]),
    command("c2", ["a"], ["old"]),
    command("c3", [], ["w"], {
      reactivatedCellIds: ["a"]
    }),
    command("c4", ["a"], ["q"]),
    command("far", ["far-root"], ["far-cell"])
  ];
  const knownCellIds = [
    "root",
    "x",
    "a",
    "old",
    "w",
    "q",
    "far-root",
    "far-cell"
  ];
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const closure = buildRefinementHistoryClosure(index, {
    seedCellIds: ["w"],
    componentCellIds: new Set([
      "root",
      "x",
      "a",
      "old",
      "w",
      "q"
    ])
  });

  assert.deepEqual(closure.supportCommandIds, ["p0"]);
  assert.deepEqual(
    closure.downstreamCommandIds,
    ["c1", "c3", "c4"]
  );
  assert.deepEqual(closure.preservedCommandIds, ["c2", "far"]);
});

test("identity restoration preserves a deeper active predecessor chain", () => {
  const commands = [
    command("p-2", ["root"], ["u"]),
    command("p-1", ["u"], ["x"]),
    command("creator", ["x"], ["a"]),
    command("old", ["a"], ["old-cell"]),
    command("reactivate", [], ["w"], {
      reactivatedCellIds: ["a"]
    }),
    command("consume", ["a"], ["q"]),
    command("far", ["far-root"], ["far-cell"])
  ];
  const knownCellIds = [
    "root",
    "u",
    "x",
    "a",
    "old-cell",
    "w",
    "q",
    "far-root",
    "far-cell"
  ];
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const closure = buildRefinementHistoryClosure(index, {
    seedCellIds: ["w"],
    componentCellIds: new Set([
      "root",
      "u",
      "x",
      "a",
      "old-cell",
      "w",
      "q"
    ])
  });

  assert.deepEqual(closure.supportCommandIds, ["p-2"]);
  assert.deepEqual(
    closure.downstreamCommandIds,
    ["p-1", "creator", "reactivate", "consume"]
  );
  assert.deepEqual(closure.preservedCommandIds, ["old", "far"]);
});

test("shared identity upstream is stable under reversed seed order", () => {
  const commands = [
    command("p0", ["root"], ["x", "y"]),
    command("creator-a", ["x"], ["a"]),
    command("creator-b", ["y"], ["b"]),
    command("old-a", ["a"], ["old-a-cell"]),
    command("old-b", ["b"], ["old-b-cell"]),
    command("reactivate-a", [], ["wa"], {
      reactivatedCellIds: ["a"]
    }),
    command("reactivate-b", [], ["wb"], {
      reactivatedCellIds: ["b"]
    }),
    command("consume-a", ["a"], ["qa"]),
    command("consume-b", ["b"], ["qb"]),
    command("far", ["far-root"], ["far-cell"])
  ];
  const knownCellIds = [
    "root",
    "x",
    "y",
    "a",
    "b",
    "old-a-cell",
    "old-b-cell",
    "wa",
    "wb",
    "qa",
    "qb",
    "far-root",
    "far-cell"
  ];
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const componentCellIds = new Set(
    knownCellIds.filter((cellId) => !cellId.startsWith("far"))
  );
  const forward = buildRefinementHistoryClosure(index, {
    seedCellIds: ["wa", "wb"],
    componentCellIds
  });
  const reverse = buildRefinementHistoryClosure(index, {
    seedCellIds: ["wb", "wa"],
    componentCellIds
  });

  assert.deepEqual(forward.supportCommandIds, ["p0"]);
  assert.deepEqual(
    forward.downstreamCommandIds,
    [
      "creator-a",
      "creator-b",
      "reactivate-a",
      "reactivate-b",
      "consume-a",
      "consume-b"
    ]
  );
  assert.deepEqual(
    forward.preservedCommandIds,
    ["old-a", "old-b", "far"]
  );
  assert.deepEqual(reverse, forward);
});

test("independent producer paths activate an identity-restored command", () => {
  const commands = [
    command("p", ["root-p"], ["x", "z"]),
    command("creator", ["x"], ["a"]),
    command("old", ["a"], ["old-cell"]),
    command("q", ["root-q"], ["t", "u"]),
    command("reactivate", ["t"], ["w"], {
      reactivatedCellIds: ["a"]
    }),
    command("seed-p", ["z"], ["sp"]),
    command("seed-q", ["u"], ["sq"]),
    command("new", ["a"], ["new-cell"]),
    command("far", ["far-root"], ["far-cell"])
  ];
  const knownCellIds = [
    "root-p",
    "x",
    "z",
    "a",
    "old-cell",
    "root-q",
    "t",
    "u",
    "w",
    "sp",
    "sq",
    "new-cell",
    "far-root",
    "far-cell"
  ];
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const componentCellIds = new Set(
    knownCellIds.filter((cellId) => !cellId.startsWith("far"))
  );
  const forward = buildRefinementHistoryClosure(index, {
    seedCellIds: ["sp", "sq"],
    componentCellIds
  });
  const reverse = buildRefinementHistoryClosure(index, {
    seedCellIds: ["sq", "sp"],
    componentCellIds
  });

  assert.deepEqual(forward.supportCommandIds, ["p", "q"]);
  assert.deepEqual(
    forward.downstreamCommandIds,
    [
      "creator",
      "old",
      "reactivate",
      "seed-p",
      "seed-q",
      "new"
    ]
  );
  assert.deepEqual(forward.preservedCommandIds, ["far"]);
  assert.deepEqual(reverse, forward);
});

test("diamond producer paths activate an identity creator once", () => {
  const commands = [
    command("p1", ["root-1"], ["x", "z1"]),
    command("p2", ["root-2"], ["y", "z2"]),
    command("creator", ["x", "y"], ["a"]),
    command("old", ["a"], ["old-cell"]),
    command("reactivate", [], ["w"], {
      reactivatedCellIds: ["a"]
    }),
    command("seed-1", ["z1"], ["s1"]),
    command("seed-2", ["z2"], ["s2"]),
    command("new", ["a"], ["new-cell"])
  ];
  const knownCellIds = [
    "root-1",
    "root-2",
    "x",
    "y",
    "z1",
    "z2",
    "a",
    "old-cell",
    "w",
    "s1",
    "s2",
    "new-cell"
  ];
  const index = buildRefinementHistoryIndex(commands, knownCellIds);
  const componentCellIds = new Set(knownCellIds);
  const forward = buildRefinementHistoryClosure(index, {
    seedCellIds: ["w", "s1", "s2"],
    componentCellIds
  });
  const reverse = buildRefinementHistoryClosure(index, {
    seedCellIds: ["s2", "s1", "w"],
    componentCellIds
  });

  assert.deepEqual(forward.supportCommandIds, ["p1", "p2"]);
  assert.deepEqual(
    forward.downstreamCommandIds,
    [
      "creator",
      "old",
      "reactivate",
      "seed-1",
      "seed-2",
      "new"
    ]
  );
  assert.deepEqual(reverse, forward);
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

test("history closure completes a deep dependency chain", () => {
  const commandCount = 1_200;
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
