# H1 2:1 Stage B History Generalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Stage A correctness gaps, then support atomic component-local rebuilding of 2:1 transition shells affected by multiple replayable refinement commands.

**Architecture:** Keep the verified Stage A transition templates and planners unchanged. Add immutable refinement-command recipes, build a pure provenance/closure index, remap historical selections by exact-first geometry, and execute reversal/rebuild/replay in a cloned session that is committed as one compound command only after all existing conformance and quality gates pass.

**Tech Stack:** TypeScript 5.9, ES modules, Node test runner, existing HexRefine session hierarchy, geometric face matching, H1 quality/conformance audits, and LS-DYNA mesh-only parser/exporter.

---

## File Map

**Create**

- `src/refinement-history.ts`
  - Public immutable recipe types.
  - Recipe cloning/freezing.
  - Pure history index and command-closure construction.
- `src/refinement-cell-geometry.ts`
  - Finite cell-geometry snapshots.
  - Exact-first and tolerance-aware active-cell remapping.
- `test/refinement-history.test.mjs`
  - Pure recipe, provenance, closure, and geometry-remapping tests.

**Modify**

- `src/mesh.ts`
  - Validate every merge input point.
  - Include dimension and every coordinate in exact merge identity.
- `src/transitions-internal.ts`
  - Stop claiming a conforming 2:1 capability for raw `1 -> 8`.
- `src/two-to-one-capability.ts`
  - Add optional history command IDs to diagnostics.
- `src/refinement-session.ts`
  - Store command recipes.
  - Normalize known history errors.
  - Enforce compensation limits on shell rebuilding.
  - Build and execute multi-command history transactions.
- `src/command-script.ts`
  - Preserve Stage B structured diagnostics and deterministic replay.
- `src/index.ts`
  - Export public recipe and geometry-snapshot types.
- `test/refinement-kernel-suite.test.mjs`
  - Stage A.1, session integration, state-machine, and regression tests.
- `scripts/generate-lsdyna-regression-fixtures.mjs`
  - Record the maximum accepted relative volume error.
- `test/comformhex.test.mjs`
  - Assert fixture quality and volume.
- `test/fixtures/lsdyna/*.json`
  - Deterministically generated volume-error contracts.
- `examples/browser/hexrefine-standalone.html`
  - Regenerated embedded runtime after source changes.
- `README.md`
- `docs/architecture.md`
- `docs/implementation.md`
- `CHANGELOG.md`

## Task 1: Close Raw 1 -> 8 and Node-Merge Correctness Gaps

**Files:**

- Modify: `src/transitions-internal.ts`
- Modify: `src/mesh.ts`
- Test: `test/refinement-kernel-suite.test.mjs`

- [ ] **Step 1: Change the existing raw-ratio test to require no 2:1 report**

Replace the capability assertions in
`"Hex 2:1 direct flat plan without transitions deduplicates selected ids"` with:

```js
assert.equal(hexPlan.twoToOne, undefined);
assert.equal(defaultPlan.twoToOne, undefined);
assert.equal(preview.twoToOne, undefined);
assert.equal(result.twoToOne, undefined);
assert.equal(
  checkNoHangingNodes(result.mesh, 1e-9).ok,
  false
);
```

Keep the selected-ID deduplication and replacement-count assertions unchanged.

- [ ] **Step 2: Add exact-merge dimension and finite-node failures**

Add these tests to `test/refinement-kernel-suite.test.mjs`:

```js
test("exact node merging preserves every finite point dimension", () => {
  const mesh = {
    kind: "Q1",
    nodes: [
      [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
      [0, 0, 0, 7], [1, 0, 0, 7],
      [1, 1, 0, 7], [0, 1, 0, 7]
    ],
    elements: [
      [1, 2, 3, 4],
      [5, 6, 7, 8]
    ]
  };

  const merged = mergeCoincidentNodesWithMap(mesh, 0);

  assert.equal(merged.mesh.nodes.length, 8);
  assert.deepEqual(merged.mesh.elements, mesh.elements);
});

for (const coordinate of [Number.NaN, Infinity, -Infinity]) {
  test(`node merging rejects unreferenced nonfinite coordinate ${String(coordinate)}`, () => {
    const mesh = {
      kind: "Q1",
      nodes: [
        [0, 0], [1, 0], [1, 1], [0, 1],
        [coordinate, 2]
      ],
      elements: [[1, 2, 3, 4]]
    };

    assert.throws(
      () => mergeCoincidentNodesWithMap(mesh, 0),
      /node 5 coordinate 0 must be finite/
    );
  });
}
```

Import `mergeCoincidentNodesWithMap` from `../dist/index.js` if it is not
already imported.

- [ ] **Step 3: Run the focused tests and verify the old behavior fails**

Run:

```powershell
npm run build
node --test --test-name-pattern="without transitions|point dimension|unreferenced nonfinite" test/refinement-kernel-suite.test.mjs
```

Expected: the raw operation still has a `twoToOne` report, 3D/4D exact nodes
merge, and at least one non-finite case is not rejected.

- [ ] **Step 4: Remove the false capability report**

Change the `includeTransitions === false` branch in
`buildHexClassifiedPlanFromNormalizedSelection()` to:

```ts
if (!(options.includeTransitions ?? true)) {
  return {
    replacements: selected.map((elementId) =>
      classifyHexReplacement(
        instantiateOnElement(mesh, elementId, refineHexTo8Hex),
        "selected",
        8
      )
    )
  };
}
```

Delete `buildDirectReport()` if it has no remaining callers. Do not add a new
`raw` value to `TwoToOnePlanningStatus`.

- [ ] **Step 5: Validate and key every merge coordinate**

In `src/mesh.ts`, add:

```ts
function assertFiniteMergeNodes(nodes: readonly Readonly<Point>[]): void {
  nodes.forEach((node, nodeIndex) => {
    if (node.length === 0) {
      throw new RangeError(`node ${nodeIndex + 1} must contain coordinates`);
    }
    node.forEach((coordinate, axis) => {
      if (!Number.isFinite(coordinate)) {
        throw new RangeError(
          `node ${nodeIndex + 1} coordinate ${axis} must be finite`
        );
      }
    });
  });
}

function exactMergeKey(node: Readonly<Point>): string {
  return `${node.length}|${node.map((coordinate) =>
    Object.is(coordinate, -0) ? "0" : coordinate.toString()
  ).join(":")}`;
}
```

Call `assertFiniteMergeNodes(mesh.nodes)` immediately after tolerance
validation in `mergeCoincidentNodesWithMap()`. When an exact key hits, verify:

```ts
const exactIndex = exactNodeIndexByKey.get(exactKey);
const verifiedExactIndex = exactIndex !== undefined
  && pointEquals(nodes[exactIndex]!, node, 0)
    ? exactIndex
    : undefined;
const existingIndex = verifiedExactIndex ?? findCoincidentNodeIndex(
  node,
  nodes,
  buckets,
  bucketLayout,
  tolerance
);
```

- [ ] **Step 6: Run focused and legacy mesh tests**

Run:

```powershell
npm run build
node --test --test-name-pattern="without transitions|node merging|merge buckets|point dimension|nonfinite" test/refinement-kernel-suite.test.mjs
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit Task 1**

```powershell
git add src/transitions-internal.ts src/mesh.ts test/refinement-kernel-suite.test.mjs
git commit -m "fix(refinement): distinguish raw ratio-two refinement"
```

## Task 2: Enforce Shell Bounds and Stable History Errors

**Files:**

- Modify: `src/two-to-one-capability.ts`
- Modify: `src/refinement-session.ts`
- Modify: `src/command-script.ts`
- Modify: `scripts/generate-lsdyna-regression-fixtures.mjs`
- Modify: `test/comformhex.test.mjs`
- Modify: `test/fixtures/lsdyna/*.json`
- Test: `test/refinement-kernel-suite.test.mjs`

- [ ] **Step 1: Add zero-limit shell tests**

Using `createTransitionShellRegressionFixture()`, add:

```js
for (const limitCase of [
  { maxAddedParentLayers: 0, maxAddedParentCount: 32 },
  { maxAddedParentLayers: 1, maxAddedParentCount: 0 }
]) {
  test(`shell rebuild obeys compensation bounds ${JSON.stringify(limitCase)}`, () => {
    const { session, firstRefined, candidate } =
      createTransitionShellRegressionFixture();
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

    for (const operation of [
      () => previewSessionPatch(session, [candidate], options),
      () => refineSessionPatch(session, [candidate], options)
    ]) {
      const error = captureError(operation);
      assert.equal(error instanceof TwoToOnePlanningError, true);
      assert.equal(error.code, "TWO_TO_ONE_COMPENSATION_LIMIT");
      assert.equal(
        error.diagnostic.attemptedActions[0]?.kind,
        "transition-shell-rebuild"
      );
      assert.deepEqual(session, before);
    }
  });
}
```

- [ ] **Step 2: Add known-history error tests**

Extend the existing synthetic support/provenance tests so each known history
failure asserts:

```js
assert.equal(error instanceof TwoToOnePlanningError, true);
assert.equal(error.code, "TWO_TO_ONE_HISTORY_CONFLICT");
assert.deepEqual(error.diagnostic.historyCommandIds, expectedCommandIds);
assert.deepEqual(session, before);
```

Cover these messages:

```js
[
  /cannot trace cell .* to a refinement command/,
  /requires cells from one supporting refinement command/,
  /cross the authorized support component/,
  /cross refinement-command provenance/,
  /requires an untouched supporting layer/
]
```

Unknown injected `Error("planner invariant probe")` must remain the same object
after both preview and execution.

- [ ] **Step 3: Add diagnostic history IDs**

In `src/two-to-one-capability.ts`, extend the diagnostic:

```ts
export interface TwoToOnePlanningDiagnostic<
  TId extends TwoToOneEntityId = number
> {
  conflictingCellIds: TId[];
  conflictingInterfaces: Array<{
    firstCellId: TId;
    secondCellId?: TId;
    faceNodeIds: number[];
  }>;
  attemptedActions: TwoToOneCompensationAction<TId>[];
  historyCommandIds?: string[];
  suggestion?: {
    kind: "expand-selection" | "reduce-level" | "remesh-source";
    axis?: 0 | 1 | 2;
    side?: -1 | 1;
    parentCellIds?: TId[];
  };
}
```

Clone, freeze, serialize, numeric-ID mapping, worker transfer, and command
snapshot paths must copy and sort `historyCommandIds`.

- [ ] **Step 4: Add structured helper constructors**

In `src/refinement-session.ts`, add:

```ts
function historyConflict(
  message: string,
  conflictingCellIds: readonly CellId[],
  historyCommandIds: readonly string[] = []
): TwoToOnePlanningError<CellId> {
  return new TwoToOnePlanningError(
    "TWO_TO_ONE_HISTORY_CONFLICT",
    message,
    {
      conflictingCellIds: stableCellIds(conflictingCellIds),
      conflictingInterfaces: [],
      attemptedActions: [],
      historyCommandIds: [...new Set(historyCommandIds)].sort(),
      suggestion: { kind: "reduce-level" }
    }
  );
}

function compensationLimitError(
  selectedCellIds: readonly CellId[],
  action: TwoToOneCompensationAction<CellId>,
  compensation: NormalizedTwoToOneCompensation
): TwoToOnePlanningError<CellId> {
  return new TwoToOnePlanningError(
    "TWO_TO_ONE_COMPENSATION_LIMIT",
    `transition-shell compensation exceeds parent limits `
      + `(layers ${compensation.maxAddedParentLayers}, `
      + `parents ${compensation.maxAddedParentCount})`,
    {
      conflictingCellIds: stableCellIds(selectedCellIds),
      conflictingInterfaces: [],
      attemptedActions: [action],
      suggestion: {
        kind: "expand-selection",
        parentCellIds: [...action.addedParentCellIds]
      }
    }
  );
}
```

Import `NormalizedTwoToOneCompensation` and
`TwoToOneCompensationAction`.

- [ ] **Step 5: Enforce bounds before the cloned shell changes**

Normalize compensation once at the start of
`refineSessionPatchWithRebuiltTransitionShell()`. After computing
`rebuiltCoreParentIds`, create:

```ts
const previousCoreParentIdSet = new Set(previousCoreParentIds);
const addedParentCellIds = rebuiltCoreParentIds
  .filter((cellId) => !previousCoreParentIdSet.has(cellId));
const attemptedAction: TwoToOneCompensationAction<CellId> = {
  kind: "transition-shell-rebuild",
  reason: "the nested core reached an existing 2:1 transition component",
  addedParentCellIds,
  replacedTransitionCellIds: [...collidingTransitionParentIds]
};
if (
  addedParentCellIds.length > 0
  && (
    compensation.maxAddedParentLayers < 1
    || addedParentCellIds.length > compensation.maxAddedParentCount
  )
) {
  throw compensationLimitError(
    validation.cellIds,
    attemptedAction,
    compensation
  );
}
```

Reuse `attemptedAction` in the final capability report. Replace only known
history/provenance `Error` sites with `historyConflict()`. Do not add a
message-based catch-all mapper.

- [ ] **Step 6: Strengthen fixture manifests and tests**

In the generator manifest, add:

```js
maximumRelativeVolumeError: 1e-12
```

Before writing, also require:

```js
if (
  !result.quality?.ok
  || result.quality.relativeVolumeError > 1e-12
) {
  throw new Error(`${fixture.name} failed volume conservation`);
}
```

In the table-driven fixture test, add:

```js
assert.equal(result.quality.ok, true);
assert.ok(
  result.quality.relativeVolumeError
    <= manifest.maximumRelativeVolumeError
);
```

Regenerate manifests:

```powershell
npm run build
node scripts/generate-lsdyna-regression-fixtures.mjs
```

- [ ] **Step 7: Run the Stage A.1 gate**

Run:

```powershell
npm run typecheck
npm test
node scripts/generate-lsdyna-regression-fixtures.mjs
$first = Get-ChildItem test/fixtures/lsdyna -File |
  Sort-Object Name |
  ForEach-Object { (Get-FileHash $_.FullName -Algorithm SHA256).Hash }
node scripts/generate-lsdyna-regression-fixtures.mjs
$second = Get-ChildItem test/fixtures/lsdyna -File |
  Sort-Object Name |
  ForEach-Object { (Get-FileHash $_.FullName -Algorithm SHA256).Hash }
if (Compare-Object $first $second) {
  throw "fixture generator is not deterministic"
}
git diff --check
```

Expected: all tests pass and two consecutive fixture generations have identical
SHA-256 hashes.

- [ ] **Step 8: Commit and independently review Stage A.1**

```powershell
git add src/two-to-one-capability.ts src/refinement-session.ts src/command-script.ts scripts/generate-lsdyna-regression-fixtures.mjs test/comformhex.test.mjs test/refinement-kernel-suite.test.mjs test/fixtures/lsdyna
git commit -m "fix(refinement): close Stage A capability gaps"
```

Run a spec-compliance review and a quality review. Fix every Critical or
Important finding with a new test and separate commit.

- [ ] **Step 9: Fast-forward the Stage A remote after review**

Run:

```powershell
git push fork HEAD:codex/h1-2to1-refinement
git ls-remote --heads fork codex/h1-2to1-refinement
```

Expected: the remote SHA equals the reviewed Stage A.1 commit.

## Task 3: Add Immutable Refinement Replay Recipes

**Files:**

- Create: `src/refinement-history.ts`
- Modify: `src/refinement-session.ts`
- Modify: `src/index.ts`
- Create: `test/refinement-history.test.mjs`
- Test: `test/refinement-kernel-suite.test.mjs`

- [ ] **Step 1: Write recipe clone/freeze tests**

Create `test/refinement-history.test.mjs` with:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  cloneRefinementSessionCommandRecipe,
  freezeRefinementSessionCommandRecipe
} from "../dist/refinement-history.js";

function sampleGeometry(cellId = "e1") {
  return {
    originalCellId: cellId,
    kind: "H1",
    level: 0,
    role: "base",
    points: [
      [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
    ]
  };
}

test("refinement command recipes are deeply immutable clones", () => {
  const source = {
    version: 1,
    selectedCellIds: ["e1"],
    selectedCellGeometry: [sampleGeometry()],
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
      rebuildExistingTransitions: true,
      mergeTolerance: 1e-9
    }
  };

  const frozen = freezeRefinementSessionCommandRecipe(source);
  const cloned = cloneRefinementSessionCommandRecipe(frozen);
  source.selectedCellIds[0] = "changed";
  source.selectedCellGeometry[0].points[0][0] = 99;

  assert.equal(frozen.selectedCellIds[0], "e1");
  assert.equal(frozen.selectedCellGeometry[0].points[0][0], 0);
  assert.deepEqual(cloned, frozen);
  assert.notEqual(cloned, frozen);
  assert.equal(Object.isFrozen(frozen.options), true);
  assert.equal(Object.isFrozen(frozen.selectedCellGeometry[0].points[0]), true);
});
```

- [ ] **Step 2: Add a session command recipe test**

In `test/refinement-kernel-suite.test.mjs`, refine a `3 x 3 x 3` H1 mesh and
assert:

```js
const command = refineSessionPatch(session, selectedCellIds, {
  hexRefinementRatio: 2,
  hexTwoToOneSelectionMode: "local",
  includeTransitions: true,
  hexTwoToOneCompensation: {
    mode: "local-topology",
    maxAddedParentLayers: 1,
    maxAddedParentCount: 32
  },
  mergeTolerance: 1e-9
});

assert.equal(command.recipe?.version, 1);
assert.deepEqual(command.recipe?.selectedCellIds, selectedCellIds);
assert.equal(command.recipe?.selectedCellGeometry.length, selectedCellIds.length);
assert.equal("activeBuild" in command.recipe.options, false);
assert.equal(Object.isFrozen(command.recipe), true);
```

Mutate all caller-owned option arrays after the command and assert the recipe is
unchanged. Verify command clone, session clone, undo, and redo retain the recipe.

- [ ] **Step 3: Run tests and verify the module/types are missing**

Run:

```powershell
npm run build
node --test test/refinement-history.test.mjs
node --test --test-name-pattern="command recipe" test/refinement-kernel-suite.test.mjs
```

Expected: module/type failures.

- [ ] **Step 4: Implement recipe and geometry snapshot types**

Create `src/refinement-history.ts` with the public types from the approved
design:

```ts
import type {
  CellId,
  RefinementSessionCellRole
} from "./refinement-session.js";
import type { ElementKind, Point } from "./types.js";
import type {
  NormalizedTwoToOneCompensation
} from "./two-to-one-capability.js";

export interface RefinementCellGeometrySnapshot {
  readonly originalCellId: CellId;
  readonly kind: ElementKind;
  readonly level: number;
  readonly role: RefinementSessionCellRole;
  readonly points: readonly (readonly number[])[];
}

export interface RefinementSessionReplayOptionsV1 {
  readonly includeTransitions: boolean;
  readonly hexRefinementRatio: 2 | 3;
  readonly hexTwoToOneSelectionMode: "section" | "local";
  readonly hexTwoToOneCompensation:
    Readonly<NormalizedTwoToOneCompensation>;
  readonly rebuildExistingTransitions: boolean;
  readonly mergeTolerance?: number;
}

export interface RefinementSessionCommandRecipeV1 {
  readonly version: 1;
  readonly selectedCellIds: readonly CellId[];
  readonly selectedCellGeometry:
    readonly RefinementCellGeometrySnapshot[];
  readonly transitionSupportCellIds: readonly CellId[];
  readonly transitionSupportCellGeometry:
    readonly RefinementCellGeometrySnapshot[];
  readonly options: RefinementSessionReplayOptionsV1;
}
```

Implement exported `cloneRefinementSessionCommandRecipe()` and
`freezeRefinementSessionCommandRecipe()` by cloning every array, point, and
nested compensation object. Reject non-finite snapshot coordinates.

- [ ] **Step 5: Snapshot recipes before applying a normal plan**

Add optional `recipe` to `RefinementSessionCommand`. Before
`applyRefinementSessionPatchPlan()` mutates cells, build the recipe from the
validated source selection and transition support selection:

```ts
function snapshotRefinementCommandRecipe(
  session: RefinementSession,
  selectedCellIds: readonly CellId[],
  options: ResolvedRefinementSessionPatchOptions
): RefinementSessionCommandRecipeV1 {
  const snapshot = (cellId: CellId): RefinementCellGeometrySnapshot => {
    const cell = requiredCell(session, cellId);
    return {
      originalCellId: cellId,
      kind: cell.kind,
      level: cell.level,
      role: cell.role,
      points: cell.element.map((nodeId) => {
        const point = session.nodes[nodeId - 1];
        if (!point) {
          throw new Error(`cell ${cellId} references missing node ${nodeId}`);
        }
        return [...point];
      })
    };
  };
  const compensation = normalizeTwoToOneCompensation(
    new Set(selectedCellIds).size,
    options
  );
  const supportIds = stableCellIds(options.transitionSupportCellIds ?? []);
  return freezeRefinementSessionCommandRecipe({
    version: 1,
    selectedCellIds: stableCellIds(selectedCellIds),
    selectedCellGeometry: stableCellIds(selectedCellIds).map(snapshot),
    transitionSupportCellIds: supportIds,
    transitionSupportCellGeometry: supportIds.map(snapshot),
    options: {
      includeTransitions: options.includeTransitions ?? true,
      hexRefinementRatio: options.hexRefinementRatio ?? 3,
      hexTwoToOneSelectionMode:
        options.hexTwoToOneSelectionMode ?? "section",
      hexTwoToOneCompensation: compensation,
      rebuildExistingTransitions:
        compensation.mode === "local-topology",
      mergeTolerance: options.mergeTolerance
    }
  });
}
```

Pass the recipe through `RefinementSessionPatchPlan`, command freezing,
cloning, structured clone, undo, and redo. Do not attach recipes to the generic
factory overload that cannot be replayed through `refineSessionPatch`.

- [ ] **Step 6: Export and verify recipe behavior**

Export recipe types/functions from `src/index.ts`. Run:

```powershell
npm run typecheck
npm run build
node --test test/refinement-history.test.mjs
node --test --test-name-pattern="command recipe|undo redo" test/refinement-kernel-suite.test.mjs
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit Task 3**

```powershell
git add src/refinement-history.ts src/refinement-session.ts src/index.ts test/refinement-history.test.mjs test/refinement-kernel-suite.test.mjs
git commit -m "feat(refinement): snapshot replayable command recipes"
```

## Task 4: Build the Pure History Index and Closure Planner

**Files:**

- Modify: `src/refinement-history.ts`
- Test: `test/refinement-history.test.mjs`

- [ ] **Step 1: Add synthetic history-index tests**

Add pure command views:

```js
function command(id, hidden, created, recipe = true) {
  return {
    id,
    kind: "refine",
    hiddenCellIds: hidden,
    createdCellIds: created,
    createdNodeIds: [],
    ...(recipe ? {
      recipe: {
        version: 1,
        selectedCellIds: hidden,
        selectedCellGeometry: hidden.map(sampleGeometry),
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
    } : {})
  };
}
```

Test:

```js
test("history closure includes only dependent commands", () => {
  const commands = [
    command("cmd-1", ["e1"], ["e1/1", "e1/2"]),
    command("cmd-2", ["e1/1"], ["e1/1/1"]),
    command("cmd-3", ["e9"], ["e9/1"])
  ];
  const index = buildRefinementHistoryIndex(commands, [
    "e1", "e1/1", "e1/2", "e1/1/1", "e9", "e9/1"
  ]);
  const closure = buildRefinementHistoryClosure(index, {
    seedCellIds: ["e1/1"],
    componentCellIds: new Set(["e1", "e1/1", "e1/2", "e1/1/1"])
  });

  assert.deepEqual(closure.supportCommandIds, ["cmd-1"]);
  assert.deepEqual(closure.downstreamCommandIds, ["cmd-2"]);
  assert.deepEqual(closure.preservedCommandIds, ["cmd-3"]);
});
```

Also test duplicate creators, missing referenced cells, a command crossing two
components, a missing recipe, and deterministic output under reversed seed
order.

- [ ] **Step 2: Run tests and verify exports are missing**

Run:

```powershell
npm run build
node --test --test-name-pattern="history closure|history index" test/refinement-history.test.mjs
```

Expected: missing export failures.

- [ ] **Step 3: Add history index types and construction**

Add:

```ts
export interface RefinementHistoryIndex {
  readonly commands: readonly RefinementSessionCommand[];
  readonly commandById:
    ReadonlyMap<string, RefinementSessionCommand>;
  readonly creatorCommandIdByCellId:
    ReadonlyMap<CellId, string>;
  readonly consumerCommandIdsByCellId:
    ReadonlyMap<CellId, readonly string[]>;
  readonly commandOrdinalById: ReadonlyMap<string, number>;
}

export function buildRefinementHistoryIndex(
  commands: readonly RefinementSessionCommand[],
  knownCellIds: readonly CellId[]
): RefinementHistoryIndex
```

Construction rules:

```ts
function appendSortedUnique(
  map: Map<CellId, string[]>,
  cellId: CellId,
  commandId: string
): void {
  const values = map.get(cellId) ?? [];
  if (!values.includes(commandId)) {
    values.push(commandId);
    values.sort();
  }
  map.set(cellId, values);
}

const knownCells = new Set(knownCellIds);
for (const [ordinal, command] of commands.entries()) {
  if (commandById.has(command.id)) {
    throw new Error(`duplicate refinement command id ${command.id}`);
  }
  commandById.set(command.id, command);
  commandOrdinalById.set(command.id, ordinal);
  for (const cellId of command.createdCellIds) {
    const existing = creatorCommandIdByCellId.get(cellId);
    if (existing !== undefined) {
      throw new Error(
        `cell ${cellId} has multiple creators: ${existing}, ${command.id}`
      );
    }
    creatorCommandIdByCellId.set(cellId, command.id);
  }
  for (const cellId of [
    ...command.hiddenCellIds,
    ...(command.reactivatedCellIds ?? [])
  ]) {
    if (!knownCells.has(cellId)) {
      throw new Error(
        `command ${command.id} references missing cell ${cellId}`
      );
    }
    appendSortedUnique(
      consumerCommandIdsByCellId,
      cellId,
      command.id
    );
  }
}
```

Freeze returned arrays and wrap maps as read-only public values.

- [ ] **Step 4: Implement fixed-point closure**

Add:

```ts
export interface BuildHistoryClosureInput {
  readonly seedCellIds: readonly CellId[];
  readonly componentCellIds: ReadonlySet<CellId>;
}

export interface RefinementHistoryClosure {
  readonly supportCommandIds: readonly string[];
  readonly downstreamCommandIds: readonly string[];
  readonly affectedInputCellIds: readonly CellId[];
  readonly preservedCommandIds: readonly string[];
  readonly boundaryCellIds: readonly CellId[];
}
```

Implement the closure by:

1. seeding creator and consumer commands for all seed cells;
2. adding the creator of every hidden input needed by an included command;
3. adding consumers of every cell created by an included command;
4. repeating until no command is added;
5. rejecting an included command whose affected cells are outside
   `componentCellIds`;
6. rejecting commands without `recipe`;
7. sorting by `commandOrdinalById`.

Throw `RefinementHistoryClosureError` with `commandIds` and `cellIds`. The
session layer maps this internal error to `TWO_TO_ONE_HISTORY_CONFLICT`.

Use this concrete error:

```ts
export class RefinementHistoryClosureError extends Error {
  readonly commandIds: readonly string[];
  readonly cellIds: readonly CellId[];

  constructor(
    message: string,
    commandIds: readonly string[],
    cellIds: readonly CellId[]
  ) {
    super(message);
    this.name = "RefinementHistoryClosureError";
    this.commandIds = Object.freeze([...new Set(commandIds)].sort());
    this.cellIds = Object.freeze([...new Set(cellIds)].sort());
  }
}
```

- [ ] **Step 5: Run pure closure tests**

Run:

```powershell
npm run typecheck
npm run build
node --test test/refinement-history.test.mjs
```

Expected: all recipe and closure tests pass.

- [ ] **Step 6: Commit Task 4**

```powershell
git add src/refinement-history.ts test/refinement-history.test.mjs
git commit -m "feat(refinement): compute component history closures"
```

## Task 5: Add Exact-First Cell Geometry Remapping

**Files:**

- Create: `src/refinement-cell-geometry.ts`
- Modify: `src/index.ts`
- Test: `test/refinement-history.test.mjs`

- [ ] **Step 1: Add remapping tests**

Add tests for:

```js
test("cell geometry remapping prefers the original active id", () => {
  const index = new RefinementCellGeometryIndex(1e-8);
  index.add("e1", sampleGeometry("e1"));
  assert.equal(index.uniqueMatch(sampleGeometry("e1")), "e1");
});

test("cell geometry remapping tolerates duplicate node ids and noise", () => {
  const index = new RefinementCellGeometryIndex(1e-8);
  index.add("replacement", sampleGeometry("replacement"));
  const query = sampleGeometry("old");
  query.points = query.points.map(([x, y, z], pointIndex) => [
    x + (pointIndex % 2 ? 2e-10 : -2e-10),
    y,
    z
  ]);
  assert.equal(index.uniqueMatch(query), "replacement");
});

test("cell geometry remapping rejects ambiguity and incompatible metadata", () => {
  const index = new RefinementCellGeometryIndex(1e-8);
  index.add("a", sampleGeometry("a"));
  index.add("b", sampleGeometry("b"));
  assert.throws(
    () => index.uniqueMatch(sampleGeometry("old")),
    (error) =>
      error.name === "RefinementCellGeometryMatchError"
      && error.cellIds.join(",") === "a,b"
  );
});
```

Also cover level, role, kind, over-tolerance, collapsed Hex, and non-finite
snapshots.

- [ ] **Step 2: Run tests and verify the module is absent**

Run:

```powershell
npm run build
node --test --test-name-pattern="cell geometry remapping" test/refinement-history.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement finite snapshots**

Create `src/refinement-cell-geometry.ts`:

```ts
export class RefinementCellGeometryMatchError extends Error {
  readonly cellIds: readonly CellId[];

  constructor(message: string, cellIds: readonly CellId[]) {
    super(message);
    this.name = "RefinementCellGeometryMatchError";
    this.cellIds = Object.freeze([...new Set(cellIds)].sort());
  }
}

export function snapshotRefinementCellGeometry(
  session: RefinementSession,
  cellId: CellId
): RefinementCellGeometrySnapshot {
  const cell = session.cells.get(cellId);
  if (cell === undefined) {
    throw new RefinementCellGeometryMatchError(
      `cannot snapshot missing cell ${cellId}`,
      [cellId]
    );
  }
  const points = cell.element.map((nodeId) => {
    const point = session.nodes[nodeId - 1];
    if (point === undefined) {
      throw new RefinementCellGeometryMatchError(
        `cell ${cellId} references missing node ${nodeId}`,
        [cellId]
      );
    }
    if (point.length === 0 || point.some((value) => !Number.isFinite(value))) {
      throw new RefinementCellGeometryMatchError(
        `cell ${cellId} contains non-finite geometry`,
        [cellId]
      );
    }
    return [...point];
  });
  return {
    originalCellId: cellId,
    kind: cell.kind,
    level: cell.level,
    role: cell.role,
    points
  };
}
```

- [ ] **Step 4: Implement the cell index**

Use exact keys containing kind, level, role, dimension, and all sorted corner
coordinates. For tolerance fallback:

- require equal point counts and dimensions;
- require metadata compatibility;
- compare corner sets independent of local node order;
- construct a tolerance bipartite graph and require one complete point matching;
- scale coordinates before distance comparison to avoid overflow/underflow;
- reject collapsed or non-finite geometry;
- return a unique CellId or throw
  `RefinementCellGeometryMatchError`.

The complete point matching uses deterministic backtracking:

```ts
function hasCompletePointMatching(
  candidatesByQueryPoint: readonly (readonly number[])[],
  candidateCount: number
): boolean {
  const order = candidatesByQueryPoint
    .map((candidates, queryIndex) => ({
      queryIndex,
      candidates: [...candidates].sort((a, b) => a - b)
    }))
    .sort((a, b) =>
      a.candidates.length - b.candidates.length
      || a.queryIndex - b.queryIndex
    );
  const used = new Set<number>();
  const visit = (depth: number): boolean => {
    if (depth === order.length) {
      return used.size === candidateCount;
    }
    for (const candidateIndex of order[depth]!.candidates) {
      if (used.has(candidateIndex)) {
        continue;
      }
      used.add(candidateIndex);
      if (visit(depth + 1)) {
        return true;
      }
      used.delete(candidateIndex);
    }
    return false;
  };
  return visit(0);
}
```

Expose:

```ts
export class RefinementCellGeometryIndex {
  constructor(readonly tolerance: number);
  add(cellId: CellId, geometry: RefinementCellGeometrySnapshot): void;
  uniqueMatch(
    geometry: RefinementCellGeometrySnapshot
  ): CellId | undefined;
}
```

- [ ] **Step 5: Export and run tests**

Export snapshot types/index/error from `src/index.ts`. Run:

```powershell
npm run typecheck
npm run build
node --test test/refinement-history.test.mjs
node --test --test-name-pattern="geometric face identity|cell geometry remapping" test/refinement-kernel-suite.test.mjs test/refinement-history.test.mjs
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit Task 5**

```powershell
git add src/refinement-cell-geometry.ts src/index.ts test/refinement-history.test.mjs
git commit -m "feat(refinement): remap historical cell geometry"
```

## Task 6: Plan and Simulate Multi-Command History Transactions

**Files:**

- Modify: `src/refinement-session.ts`
- Modify: `src/refinement-history.ts`
- Test: `test/refinement-kernel-suite.test.mjs`

- [ ] **Step 1: Add a two-command partial-shell failure test**

Build a `7 x 7 x 7` session:

1. refine the `[2..4]^3` core at local 2:1;
2. choose an interior selected-role child and refine it with a replayable
   command so part of the original support layer becomes inactive;
3. select a boundary core child whose requested refinement collides with that
   partially refined shell.

Before implementation, assert the request rejects with
`TWO_TO_ONE_HISTORY_CONFLICT` and the session is unchanged. Record the active
far-field CellIds for later success assertions.

- [ ] **Step 2: Add an internal transaction-plan test hook**

Export directly from `src/refinement-session.ts`, but do not re-export from the
public `src/index.ts`. Tests import it from `../dist/refinement-session.js`:

```ts
export interface RefinementSessionHistoryTransactionPlan {
  readonly historyClosure: RefinementHistoryClosure;
  readonly command: RefinementSessionCommand;
  readonly finalSession: RefinementSession;
  readonly preview: RefinementPreview<CellId>;
}

export function planRefinementSessionHistoryTransaction(
  session: RefinementSession,
  cellIds: readonly CellId[],
  options: ResolvedRefinementSessionPatchOptions,
  faceResolution: SessionFaceResolution
): RefinementSessionHistoryTransactionPlan
```

The public `src/index.ts` must not export this planner.

- [ ] **Step 3: Build the component and history closure**

Refactor Stage A shell discovery into:

```ts
interface TransitionHistoryComponent {
  readonly selectedCellIds: readonly CellId[];
  readonly supportCellIds: readonly CellId[];
  readonly collidingTransitionParentIds: readonly CellId[];
  readonly componentCellIds: ReadonlySet<CellId>;
  readonly boundaryCellIds: readonly CellId[];
}
```

Use existing exact-first face resolution and connected support traversal.
Include inactive descendants of active component cells when they belong to
commands in `undoStack`. Build the history index and closure:

```ts
const historyIndex = buildRefinementHistoryIndex(
  session.undoStack,
  [...session.cells.keys()]
);
const historyClosure = buildRefinementHistoryClosure(historyIndex, {
  seedCellIds: [
    ...component.supportCellIds,
    ...component.collidingTransitionParentIds
  ],
  componentCellIds: component.componentCellIds
});
```

Map `RefinementHistoryClosureError` to `historyConflict()` with deterministic
command IDs.

- [ ] **Step 4: Add explicit reverse helpers**

Add internal helpers that do not require the command to be the top public undo:

```ts
function reverseRefinementCommandState(
  session: MutableRefinementSession,
  command: RefinementSessionCommand
): void {
  for (const cellId of command.activeCreatedCellIds ?? command.createdCellIds) {
    const cell = requiredCell(session, cellId);
    cell.active = false;
    cell.hidden = true;
    removeActiveLeafCellId(session, cellId);
  }
  for (const cellId of command.hiddenCellIds) {
    const cell = requiredCell(session, cellId);
    cell.active = true;
    cell.hidden = false;
    addActiveLeafCellId(session, cellId);
  }
  for (const cellId of command.reactivatedCellIds ?? []) {
    const cell = requiredCell(session, cellId);
    cell.active = false;
    cell.hidden = true;
    removeActiveLeafCellId(session, cellId);
  }
}
```

Reverse closure commands in descending history ordinal. Verify after every
reverse that no active cell has an active descendant.

- [ ] **Step 5: Rebuild support and replay downstream recipes**

On the cloned session:

1. preserve `originalUndoStack`, `originalRedoStack`, and counters;
2. reverse the closure;
3. rebuild the support root with Stage A compensation;
4. create a `RefinementCellGeometryIndex` over current active cells;
5. remap recipe selected/support snapshots;
6. call `refineSessionPatch()` with fresh active metadata and
   `rebuildExistingTransitions: false`;
7. repeat in original command order;
8. remap and apply the new user request.

Convert normalized replay options to a fresh patch option object:

```ts
function replayRecipeOptions(
  recipe: RefinementSessionCommandRecipeV1,
  selectedCellIds: readonly CellId[],
  transitionSupportCellIds: readonly CellId[]
): RefinementSessionPatchOptions {
  return {
    includeTransitions: recipe.options.includeTransitions,
    hexRefinementRatio: recipe.options.hexRefinementRatio,
    hexTwoToOneSelectionMode:
      recipe.options.hexTwoToOneSelectionMode,
    hexTwoToOneCompensation: {
      ...recipe.options.hexTwoToOneCompensation
    },
    rebuildExistingTransitions: false,
    transitionSupportCellIds: [...transitionSupportCellIds],
    ...(recipe.options.mergeTolerance === undefined
      ? {}
      : { mergeTolerance: recipe.options.mergeTolerance })
  };
}
```

If any snapshot maps to zero or multiple active cells, throw
`historyConflict()` and include that command ID.

- [ ] **Step 6: Construct the compound delta and reset temporary history**

Compare original and cloned active state exactly as Stage A does. Before
returning:

```ts
working.undoStack = [
  ...originalUndoStack.map(cloneRefinementSessionCommand),
  compoundCommand
];
working.redoStack = [];
working.nextCommandId = session.nextCommandId + 1;
```

Temporary replay commands must not appear in the public stack. The compound
command contains the final active-created and reactivated sets, recipe for the
new user request, quality, and capability report.

- [ ] **Step 7: Run focused transaction tests**

Run:

```powershell
npm run typecheck
npm run build
node --test --test-name-pattern="history transaction|partially refined shell|far-field" test/refinement-kernel-suite.test.mjs
```

Expected: the internal planner succeeds in the supported two-command case,
leaves the source session unchanged, and preserves recorded far-field IDs.

- [ ] **Step 8: Commit Task 6**

```powershell
git add src/refinement-session.ts src/refinement-history.ts test/refinement-kernel-suite.test.mjs
git commit -m "feat(refinement): plan multi-command shell transactions"
```

## Task 7: Integrate Aggregate Preview and Atomic Execution

**Files:**

- Modify: `src/refinement-session.ts`
- Modify: `src/command-script.ts`
- Modify: `examples/browser/hexrefine-standalone.html`
- Test: `test/refinement-kernel-suite.test.mjs`
- Test: `test/browser-gui.test.mjs`

- [ ] **Step 1: Add preview/execution equivalence tests**

For the supported two-command fixture:

```js
const before = structuredClone(session);
const preview = previewSessionPatch(session, [candidate], options);
assert.equal(preview.planMode, "aggregate");
assert.equal(preview.compound.kind, "transition-shell-rebuild");
assert.deepEqual(session, before);

const command = refineSessionPatch(session, [candidate], options);
assert.deepEqual(command.twoToOne, preview.twoToOne);
assert.deepEqual(command.quality, preview.quality);
assert.equal(
  buildActiveMesh(session).elements.length,
  preview.summary.outputElementCount
);
```

Assert `effectiveSelectedCellIds` are active after execution and no intermediate
created-hidden cell is present in that field.

- [ ] **Step 2: Add crossing-command atomic rejection**

Create two disjoint refined components. Add one replayable command whose
selection contains one cell from each component. A later shell rebuild in only
one component must:

```js
assert.equal(error.code, "TWO_TO_ONE_HISTORY_CONFLICT");
assert.deepEqual(error.diagnostic.historyCommandIds, [crossingCommand.id]);
assert.deepEqual(session, before);
```

Preview, execution, strict replay, and warning replay must carry the same code.

- [ ] **Step 3: Route preview and execution through the shared planner**

Replace direct calls to
`refineSessionPatchWithRebuiltTransitionShell()` and
`previewSessionPatchWithRebuiltTransitionShell()` with:

```ts
const transaction = planRefinementSessionHistoryTransaction(
  session,
  cellIds,
  resolvedOptions,
  faceResolution
);
```

Execution commits:

```ts
replaceRefinementSessionState(session, transaction.finalSession);
return transaction.command;
```

Preview returns a deep clone of `transaction.preview`. It never rebuilds a
second time.

- [ ] **Step 4: Preserve ordinary one-command behavior**

Keep the Stage A one-command case as the smallest possible history closure.
Existing preview counts, undo/redo behavior, and performance probes must remain
unchanged. Add an assertion that the one-command closure contains exactly one
support command and zero downstream commands.

- [ ] **Step 5: Preserve command-script behavior**

In `src/command-script.ts`, ensure:

- strict replay throws structured history errors;
- non-strict replay records:

```ts
`refine.patch skipped after ${error.code}: ${error.message}`
```

- replay-created commands receive recipes;
- history command IDs survive serialization and browser worker cloning.

- [ ] **Step 6: Regenerate standalone and run browser tests**

Run:

```powershell
npm run standalone:build
node --test test/browser-gui.test.mjs
```

Expected: standalone embedded modules match `dist`, and all browser tests pass.

- [ ] **Step 7: Commit Task 7**

```powershell
git add src/refinement-session.ts src/command-script.ts test/refinement-kernel-suite.test.mjs test/browser-gui.test.mjs examples/browser/hexrefine-standalone.html
git commit -m "feat(refinement): execute atomic history rebuilds"
```

## Task 8: Complete Multi-History State-Machine Coverage

**Files:**

- Modify: `test/refinement-kernel-suite.test.mjs`
- Modify: `test/refinement-history.test.mjs`

- [ ] **Step 1: Add three-level replay coverage**

Create three nested local 2:1 commands where the third reaches a shell modified
by the second. Assert:

```js
function snapshotCells(session, cellIds) {
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

const affectedBefore = new Set(preview.twoToOne.affectedComponentCellIds);
const farFieldIds = [...session.activeLeafIds]
  .filter((cellId) => !affectedBefore.has(cellId));
const farFieldBefore = snapshotCells(session, farFieldIds);
const command = refineSessionPatch(session, thirdSelection, options);
const finalMesh = buildActiveMesh(session);

assert.equal(command.twoToOne.status, "compensated");
assert.equal(checkNoHangingNodes(finalMesh, 1e-8).ok, true);
assert.equal(command.quality.ok, true);
assert.deepEqual(snapshotCells(session, farFieldIds), farFieldBefore);
```

- [ ] **Step 2: Add exact undo/redo cycles**

Add:

```js
function snapshotActiveSessionState(session) {
  return {
    nodes: session.nodes.map((point) => [...point]),
    activeCells: snapshotCells(session, session.activeLeafIds),
    commandRecipes: session.undoStack.map((command) => ({
      id: command.id,
      recipe: command.recipe === undefined
        ? undefined
        : structuredClone(command.recipe)
    }))
  };
}

const baseState = snapshotActiveSessionState(session);
const baseUndoIds = session.undoStack.map((command) => command.id);
const command = refineSessionPatch(session, thirdSelection, options);
const finalState = snapshotActiveSessionState(session);
const finalUndoIds = session.undoStack.map((entry) => entry.id);

undoRefinementSession(session);
assert.deepEqual(snapshotActiveSessionState(session), baseState);
assert.deepEqual(
  session.undoStack.map((entry) => entry.id),
  baseUndoIds
);
assert.equal(session.redoStack.at(-1)?.id, command.id);

redoRefinementSession(session);
assert.deepEqual(snapshotActiveSessionState(session), finalState);
assert.deepEqual(
  session.undoStack.map((entry) => entry.id),
  finalUndoIds
);
assert.equal(session.redoStack.length, 0);

undoRefinementSession(session);
redoRefinementSession(session);
assert.deepEqual(snapshotActiveSessionState(session), finalState);
```

Assert the session revision increases exactly once for each refine, undo, or
redo call rather than expecting a reverted numeric revision.

- [ ] **Step 3: Add command-script deterministic replay**

Serialize the three commands as a HexRefine command script, replay twice, and
assert:

```js
assert.deepEqual(first.mesh, second.mesh);
assert.deepEqual(first.session.undoStack, second.session.undoStack);
assert.deepEqual(first.warnings, []);
assert.equal(checkNoHangingNodes(first.mesh, 1e-8).ok, true);
```

- [ ] **Step 4: Add ambiguity and missing-recipe rejection**

Use duplicate coincident active cells to force two geometry candidates and
remove a recipe from one synthetic historical command. Each case must produce
`TWO_TO_ONE_HISTORY_CONFLICT` with deterministic cells/command IDs and no
mutation.

- [ ] **Step 5: Add Stage B compound-as-support coverage**

After one Stage B compound rebuild, perform another nested refinement that uses
the compound command as history support. Assert the second compound command has
a recipe and its closure includes the first compound command exactly once.

- [ ] **Step 6: Run focused and full tests**

Run:

```powershell
npm run typecheck
node --test test/refinement-history.test.mjs
node --test --test-name-pattern="multi-command|three-level|history closure|undo redo|command script" test/refinement-kernel-suite.test.mjs
npm test
git diff --check
```

Expected: all tests pass.

- [ ] **Step 7: Commit Task 8**

```powershell
git add test/refinement-history.test.mjs test/refinement-kernel-suite.test.mjs
git commit -m "test(refinement): cover Stage B history state machines"
```

## Task 9: Document, Review, and Publish Stage B

**Files:**

- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/implementation.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update the public capability boundary**

Document:

- one or more replayable commands may form a local history closure;
- a downstream command must be wholly inside the affected component;
- missing recipes, ambiguous remapping, and crossing commands reject with
  `TWO_TO_ONE_HISTORY_CONFLICT`;
- far-field IDs/connectivity remain stable;
- arbitrary cavity filling and command splitting remain unsupported.

Do not claim arbitrary Hex topology support.

- [ ] **Step 2: Document the call sequence**

Add to `docs/architecture.md`:

```text
selection
  -> direct 2:1 solver
  -> bounded compensation
  -> transition component discovery
  -> provenance index and history closure
  -> cloned reverse / rebuild / replay transaction
  -> conformance and quality gates
  -> aggregate preview or one compound session command
```

- [ ] **Step 3: Document recipe and error semantics**

In `docs/implementation.md`, document:

- recipe version 1 fields;
- original-ID, exact-geometry, tolerance-geometry remap priority;
- temporary replay commands never enter public history;
- new edits clear the redo stack;
- raw `includeTransitions: false` has no 2:1 capability report;
- compensation limits apply to every action;
- stable history diagnostic command IDs.

- [ ] **Step 4: Add the changelog entry**

Under Unreleased:

```md
- Added replayable refinement-command recipes and component-local history closure planning.
- Added atomic multi-command and partially refined 2:1 transition-shell rebuilding.
- Preserved far-field cell identity across Stage B history transactions.
- Added stable history-conflict diagnostics and shell compensation-limit enforcement.
- Stopped reporting raw transition-disabled 1-to-8 refinement as a conforming 2:1 result.
```

- [ ] **Step 5: Run reproducibility and maturity gates**

Run:

```powershell
npm run typecheck
npm test
npm run standalone:build
node scripts/generate-lsdyna-regression-fixtures.mjs
git diff --exit-code -- test/fixtures/lsdyna
git diff --check
git status --short
```

Expected: all tests pass, fixtures are reproducible, standalone is current, and
only intentional documentation/generated changes remain.

- [ ] **Step 6: Commit documentation**

```powershell
git add README.md docs/architecture.md docs/implementation.md CHANGELOG.md examples/browser/hexrefine-standalone.html
git commit -m "docs(refinement): describe Stage B history support"
```

- [ ] **Step 7: Run final spec and quality reviews**

Use fresh reviewers. The quality review must explicitly probe:

- silent far-field growth;
- command closure crossing components;
- recipe mutation or stale IDs;
- preview/execution divergence;
- compensation-limit bypass;
- structured-error atomicity;
- non-finite and mixed-dimensional node merges;
- old 3:1/Q1 behavior;
- K fixture privacy and reproducibility.

Fix every Critical or Important finding with test-first commits.

- [ ] **Step 8: Push the Stage B branch**

Run:

```powershell
git push -u fork codex/h1-2to1-stage-b-history
git ls-remote --heads fork codex/h1-2to1-stage-b-history
git status --short
```

Expected: remote and local HEAD SHAs match and the working tree is clean.
