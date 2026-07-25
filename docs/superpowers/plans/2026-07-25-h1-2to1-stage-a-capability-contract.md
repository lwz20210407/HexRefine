# H1 2:1 Stage A Capability Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an honest public 2:1 capability contract, bounded one-layer selection compensation, tolerance-aware session face identity, unambiguous previews, and three mesh-only LS-DYNA regression fixtures.

**Architecture:** Keep `two-to-one.ts` as the direct template solver and add `two-to-one-planner.ts` as the policy layer that attempts the original selection, evaluates bounded logical one-layer expansions, and returns either a capability report or a structured error. Route flat and session APIs through a classified plan object so previews, execution, and replay see the same effective selection. Isolate geometric face matching in a reusable spatial index and leave multi-command history rebuilding and copy-on-write session overlays for Stages B and C.

**Tech Stack:** TypeScript 5.9, ES modules, Node test runner, existing HexRefine H1 templates and quality/conformance audits, LS-DYNA keyword parser/exporter.

---

## File Map

### New Files

- `src/two-to-one-capability.ts`
  - Public compensation options, capability reports, structured errors, and
    option normalization.
- `src/two-to-one-planner.ts`
  - Direct-plan orchestration, bounded structured/mapped selection expansion,
    candidate scoring, and failure conversion.
- `src/geometric-face-index.ts`
  - Exact-first, tolerance-aware geometric face matching and ambiguity
    detection.
- `scripts/generate-lsdyna-regression-fixtures.mjs`
  - Deterministically writes the three mesh-only public regression fixtures
    and sidecar metadata without analysis keywords.
- `test/fixtures/lsdyna/tension-gauge-slab.k`
- `test/fixtures/lsdyna/compression-ogrid-ring.k`
- `test/fixtures/lsdyna/double-shear-contact-shell.k`
- `test/fixtures/lsdyna/tension-gauge-slab.json`
- `test/fixtures/lsdyna/compression-ogrid-ring.json`
- `test/fixtures/lsdyna/double-shear-contact-shell.json`

### Modified Files

- `src/types.ts`
  - Generic capability-bearing result and discriminated preview types.
- `src/two-to-one.ts`
  - Expose a direct plan with strategy/topology metadata and typed direct
    failures.
- `src/two-to-one-sweep.ts`
  - Replace compensable string-only failures with typed direct failures.
- `src/transitions.ts`
  - Return a classified H1 plan while preserving the replacement-only API.
- `src/refinement-planner.ts`
  - Return a classified default plan while preserving
    `buildDefaultRefinementReplacements`.
- `src/refinement-ops.ts`
  - Surface capability reports and required per-parent preview mode.
- `src/hex-core.ts`
  - Surface capability reports and required per-parent preview mode.
- `src/refinement-session.ts`
  - Normalize compensation policy, use geometric face identity, report
    direct/compensated results, and expose honest aggregate previews.
- `src/index.ts`
  - Export the capability contract and classified planning APIs.
- `test/refinement-kernel-suite.test.mjs`
  - Capability, preview, compensation, structured-error, session, and
    geometric-face tests.
- `test/comformhex.test.mjs`
  - Three LS-DYNA fixture refinement and mesh-only round-trip regressions.
- `test/fixtures/lsdyna/README.md`
  - Fixture provenance and acceptance metadata.
- `README.md`
  - Public behavior and support boundary.
- `docs/architecture.md`
  - Direct solver versus compensation policy boundary.
- `docs/implementation.md`
  - Diagnostics, preview narrowing, and K regression workflow.

## Task 1: Add the Public Capability Contract

**Files:**
- Create: `src/two-to-one-capability.ts`
- Modify: `src/types.ts`
- Modify: `src/index.ts`
- Test: `test/refinement-kernel-suite.test.mjs`

- [ ] **Step 1: Write failing normalization and structured-error tests**

Add `normalizeTwoToOneCompensation` and `TwoToOnePlanningError` to the API
destructuring near the top of `test/refinement-kernel-suite.test.mjs`, then add:

```js
test("Hex 2:1 compensation options have bounded deterministic defaults", () => {
  assert.deepEqual(normalizeTwoToOneCompensation(8, {}), {
    mode: "local-topology",
    maxAddedParentLayers: 1,
    maxAddedParentCount: 32
  });
  assert.deepEqual(normalizeTwoToOneCompensation(200, {
    hexTwoToOneCompensation: {
      mode: "selection",
      maxAddedParentLayers: 2,
      maxAddedParentCount: 17
    }
  }), {
    mode: "selection",
    maxAddedParentLayers: 2,
    maxAddedParentCount: 17
  });
  assert.equal(normalizeTwoToOneCompensation(8, {
    rebuildExistingTransitions: false
  }).mode, "none");
  assert.equal(normalizeTwoToOneCompensation(8, {
    rebuildExistingTransitions: true,
    hexTwoToOneCompensation: { mode: "selection" }
  }).mode, "selection");
});

test("Hex 2:1 structured planning errors retain machine-readable diagnostics", () => {
  const error = new TwoToOnePlanningError(
    "TWO_TO_ONE_UNSUPPORTED_PARITY",
    "odd periodic transition field",
    {
      conflictingCellIds: [11, 12],
      conflictingInterfaces: [],
      attemptedActions: [],
      suggestion: {
        kind: "expand-selection",
        axis: 1,
        side: 1,
        parentCellIds: [13]
      }
    }
  );

  assert.equal(error.name, "TwoToOnePlanningError");
  assert.equal(error.code, "TWO_TO_ONE_UNSUPPORTED_PARITY");
  assert.deepEqual(error.diagnostic.conflictingCellIds, [11, 12]);
  assert.equal(error.diagnostic.suggestion.axis, 1);
});
```

- [ ] **Step 2: Run the focused tests and verify missing exports**

Run:

```powershell
npm run build
node --test --test-name-pattern="compensation options|structured planning errors" test/refinement-kernel-suite.test.mjs
```

Expected: build or test failure because the capability module and exports do
not exist.

- [ ] **Step 3: Implement capability types, errors, and normalization**

Create `src/two-to-one-capability.ts` with:

```ts
export type TwoToOneEntityId = number | string;

export type TwoToOneCompensationMode =
  | "none"
  | "selection"
  | "local-topology";

export interface TwoToOneCompensationOptions {
  mode?: TwoToOneCompensationMode;
  maxAddedParentLayers?: number;
  maxAddedParentCount?: number;
}

export interface TwoToOneCompensationCarrier {
  hexTwoToOneCompensation?: TwoToOneCompensationOptions;
  rebuildExistingTransitions?: boolean;
}

export interface NormalizedTwoToOneCompensation {
  mode: TwoToOneCompensationMode;
  maxAddedParentLayers: number;
  maxAddedParentCount: number;
}

export type TwoToOnePlanningStatus = "direct" | "compensated";

export type TwoToOneTopologyClass =
  | "structured"
  | "mapped"
  | "periodic-ogrid"
  | "mixed-level"
  | "unstructured";

export interface TwoToOneCompensationAction<
  TId extends TwoToOneEntityId = number
> {
  kind:
    | "selection-expand"
    | "transition-shell-rebuild"
    | "local-template";
  reason: string;
  addedParentCellIds: TId[];
  replacedTransitionCellIds: TId[];
  templateId?: string;
}

export interface TwoToOneCapabilityReport<
  TId extends TwoToOneEntityId = number
> {
  status: TwoToOnePlanningStatus;
  topologyClass: TwoToOneTopologyClass;
  originalSelectedCellIds: TId[];
  effectiveSelectedCellIds: TId[];
  actions: Array<TwoToOneCompensationAction<TId>>;
  affectedComponentCellIds: TId[];
  preservedFarFieldCellCount: number;
}

export type TwoToOnePlanningErrorCode =
  | "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY"
  | "TWO_TO_ONE_UNSUPPORTED_PARITY"
  | "TWO_TO_ONE_UNSUPPORTED_VALENCE"
  | "TWO_TO_ONE_AMBIGUOUS_FACE"
  | "TWO_TO_ONE_COMPENSATION_LIMIT"
  | "TWO_TO_ONE_HISTORY_CONFLICT"
  | "TWO_TO_ONE_CONFORMANCE"
  | "TWO_TO_ONE_PARENT_JACOBIAN"
  | "TWO_TO_ONE_CHILD_JACOBIAN"
  | "TWO_TO_ONE_VOLUME";

export interface TwoToOnePlanningDiagnostic<
  TId extends TwoToOneEntityId = number
> {
  conflictingCellIds: TId[];
  conflictingInterfaces: Array<{
    firstCellId: TId;
    secondCellId?: TId;
    faceNodeIds: number[];
  }>;
  attemptedActions: Array<TwoToOneCompensationAction<TId>>;
  suggestion?: {
    kind: "expand-selection" | "reduce-level" | "remesh-source";
    axis?: 0 | 1 | 2;
    side?: -1 | 1;
    parentCellIds?: TId[];
  };
}

export class TwoToOnePlanningError<
  TId extends TwoToOneEntityId = number
> extends Error {
  constructor(
    readonly code: TwoToOnePlanningErrorCode,
    message: string,
    readonly diagnostic: TwoToOnePlanningDiagnostic<TId>
  ) {
    super(message);
    this.name = "TwoToOnePlanningError";
  }
}

export function normalizeTwoToOneCompensation(
  originalSelectedParentCount: number,
  options: TwoToOneCompensationCarrier
): NormalizedTwoToOneCompensation {
  const requested = options.hexTwoToOneCompensation;
  const requestedMode = requested?.mode ?? "local-topology";
  const mode = options.rebuildExistingTransitions === false
    ? "none"
    : requestedMode;
  const maxAddedParentLayers =
    requested?.maxAddedParentLayers ?? 1;
  const maxAddedParentCount =
    requested?.maxAddedParentCount
    ?? Math.max(32, Math.ceil(originalSelectedParentCount * 0.25));

  if (!Number.isInteger(maxAddedParentLayers) || maxAddedParentLayers < 0) {
    throw new RangeError("maxAddedParentLayers must be a non-negative integer");
  }
  if (!Number.isInteger(maxAddedParentCount) || maxAddedParentCount < 0) {
    throw new RangeError("maxAddedParentCount must be a non-negative integer");
  }
  return { mode, maxAddedParentLayers, maxAddedParentCount };
}
```

In `src/types.ts`, import `TwoToOneCompensationOptions` and
`TwoToOneCapabilityReport` as types, add
`hexTwoToOneCompensation?: TwoToOneCompensationOptions` to `RefineOptions`, and
add `twoToOne?: TwoToOneCapabilityReport<number>` to `RefinementResult`.

Export the new module from `src/index.ts`:

```ts
export * from "./two-to-one-capability.js";
```

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```powershell
npm run typecheck
npm run build
node --test --test-name-pattern="compensation options|structured planning errors" test/refinement-kernel-suite.test.mjs
```

Expected: all commands pass.

- [ ] **Step 5: Commit the capability contract**

```powershell
git add src/two-to-one-capability.ts src/types.ts src/index.ts test/refinement-kernel-suite.test.mjs
git commit -m "feat(refinement): define 2:1 capability contract"
```

## Task 2: Make Preview Shapes Honest and Discriminated

**Files:**
- Modify: `src/types.ts`
- Modify: `src/refinement-ops.ts`
- Modify: `src/hex-core.ts`
- Modify: `src/refinement-session.ts`
- Test: `test/refinement-kernel-suite.test.mjs`

- [ ] **Step 1: Change preview tests to require both union branches**

Update the existing normal preview assertions:

```js
assert.equal(preview.planMode, "per-parent");
assert.ok(preview.plan.length > 0);
assert.equal(preview.summary.estimatedOutputElementCount, result.mesh.elements.length);
```

Replace the aggregate shell-rebuild assertions with:

```js
assert.equal(preview.planMode, "aggregate");
assert.deepEqual(preview.plan, []);
assert.deepEqual(preview.compound, {
  kind: "transition-shell-rebuild"
});
assert.deepEqual(preview.summary, {
  inputElementCount: firstRefined.mesh.elements.length,
  changedInputElementCount: command.hiddenCellIds.length,
  preservedInputElementCount:
    firstRefined.mesh.elements.length - command.hiddenCellIds.length,
  outputElementCount: twiceRefined.elements.length
});
assert.equal("selectedElementCount" in preview.summary, false);
assert.equal("faceTransitionElementCount" in preview.summary, false);
```

- [ ] **Step 2: Run preview tests and verify the old aggregate shape fails**

Run:

```powershell
npm run build
node --test --test-name-pattern="preview|transition-shell rebuilding" test/refinement-kernel-suite.test.mjs
```

Expected: failures because per-parent previews omit `planMode` and aggregate
previews still expose fake zero role counts.

- [ ] **Step 3: Replace `RefinementPreview` with a generic discriminated union**

In `src/types.ts`, replace the current preview interface with:

```ts
export interface PerParentRefinementPreview<
  TId extends TwoToOneEntityId = number
> {
  kind: ElementKind;
  planMode: "per-parent";
  plan: RefinementPlanItem[];
  summary: RefinementPlanSummary;
  quality?: HexRefinementQualitySummary;
  regularization?: RegularizedHexSelection;
  twoToOne?: TwoToOneCapabilityReport<TId>;
}

export interface AggregateRefinementPlanSummary {
  inputElementCount: number;
  changedInputElementCount: number;
  preservedInputElementCount: number;
  outputElementCount: number;
}

export interface AggregateRefinementPreview<
  TId extends TwoToOneEntityId = number
> {
  kind: ElementKind;
  planMode: "aggregate";
  plan: [];
  summary: AggregateRefinementPlanSummary;
  compound: {
    kind: "transition-shell-rebuild";
  };
  quality?: HexRefinementQualitySummary;
  regularization?: RegularizedHexSelection;
  twoToOne: TwoToOneCapabilityReport<TId>;
}

export type RefinementPreview<
  TId extends TwoToOneEntityId = number
> =
  | PerParentRefinementPreview<TId>
  | AggregateRefinementPreview<TId>;
```

Import `TwoToOneEntityId` and `TwoToOneCapabilityReport` from
`two-to-one-capability.ts`.

Change the session preview return signatures to preserve cell-id typing:

```ts
export function previewSessionPatch(
  session: RefinementSession,
  cellIds: CellId[],
  options: RefinementSessionPatchOptions = {}
): RefinementPreview<CellId>
```

and:

```ts
function previewSessionPatchWithRebuiltTransitionShell(
  session: RefinementSession,
  cellIds: readonly CellId[],
  options: RefinementSessionPatchOptions,
  sourceActive: ActiveMeshBuildResult
): RefinementPreview<CellId>
```

- [ ] **Step 4: Update every preview constructor**

In `buildRefinementPreview()` in `src/refinement-ops.ts` and
`buildHexRefinementPreview()` in `src/hex-core.ts`, add:

```ts
planMode: "per-parent",
```

In the direct branch of `previewSessionPatch()` add the same field.

In `previewSessionPatchWithRebuiltTransitionShell()`, replace the aggregate
return shape with:

```ts
return {
  kind: session.kind,
  planMode: "aggregate",
  plan: [],
  compound: {
    kind: "transition-shell-rebuild"
  },
  summary: {
    inputElementCount: sourceActive.mesh.elements.length,
    changedInputElementCount,
    preservedInputElementCount:
      sourceActive.mesh.elements.length - changedInputElementCount,
    outputElementCount: finalActive.mesh.elements.length
  },
  twoToOne: command.twoToOne!,
  ...(command.quality ? { quality: command.quality } : {})
};
```

Temporarily populate `command.twoToOne` in the compound rebuild with the
existing before/after cell sets:

```ts
twoToOne: {
  status: "compensated",
  topologyClass: "mixed-level",
  originalSelectedCellIds: [...cellIds].sort(compareCellIds),
  effectiveSelectedCellIds: [...remappedCellIds].sort(compareCellIds),
  actions: [{
    kind: "transition-shell-rebuild",
    reason: "the nested core reached an existing 2:1 transition component",
    addedParentCellIds: rebuiltCoreParentIds.filter(
      (cellId) => !previousCoreParentIds.includes(cellId)
    ),
    replacedTransitionCellIds: collidingTransitionParentIds
  }],
  affectedComponentCellIds: [...new Set([
    ...hiddenCellIds,
    ...activeCreatedCellIds,
    ...reactivatedCellIds
  ])].sort(compareCellIds),
  preservedFarFieldCellCount:
    originalActiveLeafIds.size - hiddenCellIds.length
}
```

Add `twoToOne?: TwoToOneCapabilityReport<CellId>` to
`RefinementSessionCommand`.

- [ ] **Step 5: Run all preview and session tests**

Run:

```powershell
npm run typecheck
npm run build
node --test --test-name-pattern="preview|transition-shell rebuilding" test/refinement-kernel-suite.test.mjs
```

Expected: all selected tests pass and TypeScript requires callers to narrow
aggregate summaries.

- [ ] **Step 6: Commit the preview union**

```powershell
git add src/types.ts src/refinement-ops.ts src/hex-core.ts src/refinement-session.ts test/refinement-kernel-suite.test.mjs
git commit -m "fix(refinement): distinguish aggregate 2:1 previews"
```

## Task 3: Return Classified Direct 2:1 Plans

**Files:**
- Modify: `src/two-to-one-capability.ts`
- Modify: `src/two-to-one.ts`
- Modify: `src/two-to-one-sweep.ts`
- Modify: `src/transitions.ts`
- Modify: `src/refinement-planner.ts`
- Modify: `src/refinement-ops.ts`
- Modify: `src/hex-core.ts`
- Modify: `src/refinement-session.ts`
- Modify: `src/index.ts`
- Test: `test/refinement-kernel-suite.test.mjs`

- [ ] **Step 1: Write direct capability-report tests**

Add:

```js
test("Hex 2:1 direct flat plan reports its effective core and far field", () => {
  const mesh = createHexUnitCubeMesh(5, 5, 5);
  const selected = [elementIdAt(5, 5, 5, 2, 2, 2)];
  const preview = previewRefinementByElementIds(mesh, selected, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    regularizeHexSelection: false
  });

  assert.equal(preview.planMode, "per-parent");
  assert.equal(preview.twoToOne.status, "direct");
  assert.equal(preview.twoToOne.topologyClass, "mapped");
  assert.deepEqual(preview.twoToOne.originalSelectedCellIds, selected);
  assert.deepEqual(preview.twoToOne.effectiveSelectedCellIds, selected);
  assert.deepEqual(preview.twoToOne.actions, []);
  assert.equal(
    preview.twoToOne.preservedFarFieldCellCount,
    mesh.elements.length - new Set(preview.plan.map(
      (item) => item.parentElementId
    )).size
  );
});

test("Hex 2:1 O-grid direct plan reports the seven-hex strategy", () => {
  const mesh = createButterflyOgridBar(6);
  const selected = Array.from({ length: 24 }, (_, index) => 25 + index);
  const result = refineByElementIdsWithReport(mesh, selected, {
    hexRefinementRatio: 2,
    regularizeHexSelection: false
  });

  assert.equal(result.twoToOne.status, "direct");
  assert.equal(result.twoToOne.topologyClass, "periodic-ogrid");
  assert.deepEqual(result.twoToOne.effectiveSelectedCellIds, selected);
});
```

- [ ] **Step 2: Run focused tests and verify capability data is absent**

Run:

```powershell
npm run build
node --test --test-name-pattern="direct flat plan|O-grid direct plan" test/refinement-kernel-suite.test.mjs
```

Expected: failures because direct planning still returns replacements only.

- [ ] **Step 3: Refactor the direct solver to return strategy metadata**

In `src/two-to-one.ts`, add:

```ts
export type DirectTwoToOneStrategy = "local-sweep" | "seven-hex";

export interface DirectTwoToOnePlan {
  replacements: TwoToOneReplacement[];
  strategy: DirectTwoToOneStrategy;
}
```

Append the direct-solver failure type to
`src/two-to-one-capability.ts` so `two-to-one.ts` and
`two-to-one-sweep.ts` do not create an ES-module import cycle:

```ts
export type DirectTwoToOneFailureKind =
  | "selection-signature"
  | "parity"
  | "valence"
  | "topology";

export class DirectTwoToOnePlanningError extends Error {
  constructor(
    readonly kind: DirectTwoToOneFailureKind,
    message: string,
    readonly conflictingElementIds: number[] = []
  ) {
    super(message);
  }
}
```

Rename the current implementation body to:

```ts
export function buildDirectTwoToOneHexPlan(
  mesh: Mesh,
  selectedElementIds: readonly number[]
): DirectTwoToOnePlan
```

Return:

```ts
const localReplacements =
  tryBuildLocalTwoToOneHexReplacements(mesh, selected);
if (localReplacements) {
  return {
    replacements: localReplacements,
    strategy: "local-sweep"
  };
}
```

and after the Seven-Hex solution:

```ts
return {
  replacements,
  strategy: "seven-hex"
};
```

Keep the replacement-only compatibility function:

```ts
export function buildTwoToOneHexReplacements(
  mesh: Mesh,
  selectedElementIds: readonly number[]
): TwoToOneReplacement[] {
  return buildDirectTwoToOneHexPlan(mesh, selectedElementIds).replacements;
}
```

Convert the existing no-solution throw to:

```ts
throw new DirectTwoToOnePlanningError(
  "parity",
  "no level-closed 2:1 seven-hex transition field exists",
  variables
);
```

Convert overlapping transition columns to `"valence"` and invalid/nonmanifold
topology to `"topology"`. Convert both
`"transition layer must cover a full section or end on a model boundary"` and
`"reaches a free boundary on its coarse side"` to
`"selection-signature"`; these are the two direct failures that one-layer
selection expansion is allowed to retry.

In `src/two-to-one.ts` and `src/two-to-one-sweep.ts`, import the class from
`two-to-one-capability.ts`. Convert only compensable marked-corner and
unpaired pattern-3 failures to
`new DirectTwoToOnePlanningError("selection-signature", message, parentIds)`.
Leave invariant violations as ordinary errors.

- [ ] **Step 4: Add classified H1 and default planner results**

In `src/transitions.ts`, add:

```ts
export interface ClassifiedHexPlan {
  replacements: ClassifiedHexReplacement[];
  twoToOne?: TwoToOneCapabilityReport<number>;
}

export function buildHexClassifiedPlan(
  mesh: Mesh,
  selected: readonly number[],
  options: RefineOptions = {}
): ClassifiedHexPlan {
  const ratio = options.hexRefinementRatio ?? 3;
  if (ratio !== 2) {
    return {
      replacements: buildThreeToOneHexClassifiedReplacements(
        mesh,
        selected,
        options
      )
    };
  }
  if (!(options.includeTransitions ?? true)) {
    const replacements = selected.map((elementId) => ({
      elementId,
      refinement: refineHexTo8Hex(
        elementVertices(mesh, mesh.elements[elementId - 1]!)
      ),
      role: "selected" as const,
      templateCode: 8
    }));
    return {
      replacements,
      twoToOne: directCapabilityReport(
        mesh,
        selected,
        replacements,
        "mapped"
      )
    };
  }
  const direct = buildDirectTwoToOneHexPlan(mesh, selected);
  return {
    replacements: direct.replacements,
    twoToOne: directCapabilityReport(
      mesh,
      selected,
      direct.replacements,
      direct.strategy === "local-sweep" ? "mapped" : "periodic-ogrid"
    )
  };
}

export function buildHexClassifiedReplacements(
  mesh: Mesh,
  selected: readonly number[],
  options: RefineOptions = {}
): ClassifiedHexReplacement[] {
  return buildHexClassifiedPlan(mesh, selected, options).replacements;
}
```

Extract the existing 3:1 body to
`buildThreeToOneHexClassifiedReplacements()` without changing it.

Define the report helper in the same module:

```ts
function directCapabilityReport(
  mesh: Mesh,
  originalSelectedElementIds: readonly number[],
  replacements: readonly ClassifiedHexReplacement[],
  topologyClass: TwoToOneTopologyClass
): TwoToOneCapabilityReport<number> {
  const affectedComponentCellIds = uniqueSorted(
    replacements.map((replacement) => replacement.elementId)
  );
  return {
    status: "direct",
    topologyClass,
    originalSelectedCellIds: uniqueSorted(originalSelectedElementIds),
    effectiveSelectedCellIds: uniqueSorted(originalSelectedElementIds),
    actions: [],
    affectedComponentCellIds,
    preservedFarFieldCellCount:
      mesh.elements.length - affectedComponentCellIds.length
  };
}
```

In `src/refinement-planner.ts`, add:

```ts
export interface ClassifiedRefinementPlan {
  replacements: ClassifiedReplacement[];
  twoToOne?: TwoToOneCapabilityReport<number>;
}

export function buildDefaultRefinementPlan(
  mesh: Mesh,
  selectedElementIds: readonly number[],
  options: RefineOptions = {}
): ClassifiedRefinementPlan
```

For H1, return `buildHexClassifiedPlan()`. For Q1, return the existing
replacements in `{ replacements }`. Preserve:

```ts
export function buildDefaultRefinementReplacements(
  mesh: Mesh,
  selectedElementIds: readonly number[],
  options: RefineOptions = {}
): ClassifiedReplacement[] {
  return buildDefaultRefinementPlan(
    mesh,
    selectedElementIds,
    options
  ).replacements;
}
```

- [ ] **Step 5: Route flat preview and execution through classified plans**

In `src/refinement-ops.ts` and `src/hex-core.ts`, replace calls that need result
metadata with `buildDefaultRefinementPlan()` or `buildHexClassifiedPlan()`.
Pass `plan.twoToOne` into preview/result constructors:

```ts
return {
  mesh,
  cellData,
  summary,
  ...(quality ? { quality } : {}),
  ...(classified.twoToOne ? { twoToOne: classified.twoToOne } : {})
};
```

and:

```ts
return {
  kind,
  planMode: "per-parent",
  plan,
  summary,
  ...(quality ? { quality } : {}),
  ...(classified.twoToOne ? { twoToOne: classified.twoToOne } : {})
};
```

In `src/refinement-session.ts`, add
`twoToOne?: TwoToOneCapabilityReport<number>` to
`RefinementSessionPatchPlan`, use `buildDefaultRefinementPlan()`, and map its
active element ids to `CellId` before storing the command/report.

Export `buildDefaultRefinementPlan` and `buildHexClassifiedPlan` from
`src/index.ts`.

- [ ] **Step 6: Run direct, O-grid, 3:1, and Q1 regressions**

Run:

```powershell
npm run typecheck
npm run build
node --test --test-name-pattern="direct flat plan|O-grid direct plan|3:1|Q1" test/refinement-kernel-suite.test.mjs
```

Expected: all selected tests pass and unchanged Q1/3:1 previews have no
`twoToOne` report.

- [ ] **Step 7: Commit classified planning**

```powershell
git add src/two-to-one-capability.ts src/two-to-one.ts src/two-to-one-sweep.ts src/transitions.ts src/refinement-planner.ts src/refinement-ops.ts src/hex-core.ts src/refinement-session.ts src/index.ts test/refinement-kernel-suite.test.mjs
git commit -m "refactor(refinement): return classified 2:1 plans"
```

## Task 4: Add Exact-First Tolerance-Aware Face Identity

**Files:**
- Create: `src/geometric-face-index.ts`
- Test: `test/refinement-kernel-suite.test.mjs`

- [ ] **Step 1: Write geometric face-index tests**

Import `GeometricFaceIndex` directly from
`../dist/geometric-face-index.js` and add:

```js
test("geometric face identity prefers exact ids and tolerates duplicate nodes", () => {
  const index = new GeometricFaceIndex(1e-8);
  index.add({
    owner: "a",
    nodeIds: [1, 2, 3, 4],
    points: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0]
    ]
  });

  assert.deepEqual(index.matches({
    owner: "b",
    nodeIds: [1, 2, 3, 4],
    points: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0]
    ]
  }).map((face) => face.owner), ["a"]);

  assert.deepEqual(index.matches({
    owner: "c",
    nodeIds: [11, 12, 13, 14],
    points: [
      [0, 0, 3e-9],
      [1, 0, -2e-9],
      [1, 1, 1e-9],
      [0, 1, -1e-9]
    ]
  }).map((face) => face.owner), ["a"]);
});

test("geometric face identity rejects near and ambiguous faces", () => {
  const index = new GeometricFaceIndex(1e-8);
  const square = (owner, z, offset = 0) => ({
    owner,
    nodeIds: [1, 2, 3, 4].map((id) => id + offset),
    points: [
      [0, 0, z],
      [1, 0, z],
      [1, 1, z],
      [0, 1, z]
    ]
  });
  index.add(square("a", 0));
  assert.deepEqual(index.matches(square("outside", 2e-8, 10)), []);
  index.add(square("duplicate", 0, 20));
  assert.throws(
    () => index.uniqueMatch(square("query", 0, 30)),
    (error) => error.code === "TWO_TO_ONE_AMBIGUOUS_FACE"
  );
});
```

- [ ] **Step 2: Run the focused tests and verify the module is missing**

Run:

```powershell
npm run build
node --test --test-name-pattern="geometric face identity" test/refinement-kernel-suite.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the spatial face index**

Create `src/geometric-face-index.ts` with these public shapes:

```ts
import {
  TwoToOnePlanningError,
  type TwoToOneEntityId
} from "./two-to-one-capability.js";
import type { Point } from "./types.js";

export interface GeometricFace<T> {
  owner: T;
  nodeIds: readonly number[];
  points: readonly Point[];
}

export class GeometricFaceIndex<T extends TwoToOneEntityId> {
  private readonly exact = new Map<string, Array<GeometricFace<T>>>();
  private readonly buckets = new Map<string, Array<GeometricFace<T>>>();

  constructor(readonly tolerance: number) {
    if (!(tolerance > 0)) {
      throw new RangeError("geometric face tolerance must be positive");
    }
  }

  add(face: GeometricFace<T>): void {
    assertQuad(face);
    append(this.exact, exactNodeKey(face.nodeIds), face);
    append(this.buckets, bucketKey(face.points, this.tolerance), face);
  }

  matches(face: GeometricFace<T>): Array<GeometricFace<T>> {
    assertQuad(face);
    const exact = this.exact.get(exactNodeKey(face.nodeIds)) ?? [];
    if (exact.length > 0) {
      return [...exact];
    }
    return uniqueFaces(candidateBucketKeys(face.points, this.tolerance)
      .flatMap((key) => this.buckets.get(key) ?? [])
      .filter((candidate) =>
        geometricallySameFace(face, candidate, this.tolerance)
      ));
  }

  uniqueMatch(face: GeometricFace<T>): GeometricFace<T> | undefined {
    const matches = this.matches(face);
    if (matches.length > 1) {
      throw new TwoToOnePlanningError(
        "TWO_TO_ONE_AMBIGUOUS_FACE",
        `face owned by ${String(face.owner)} has ${matches.length} matches`,
        {
          conflictingCellIds: [
            face.owner,
            ...matches.map((candidate) => candidate.owner)
          ],
          conflictingInterfaces: [],
          attemptedActions: []
        }
      );
    }
    return matches[0];
  }
}

const QUAD_PERMUTATIONS: readonly (readonly number[])[] = [
  [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 2, 3, 1],
  [0, 3, 1, 2], [0, 3, 2, 1], [1, 0, 2, 3], [1, 0, 3, 2],
  [1, 2, 0, 3], [1, 2, 3, 0], [1, 3, 0, 2], [1, 3, 2, 0],
  [2, 0, 1, 3], [2, 0, 3, 1], [2, 1, 0, 3], [2, 1, 3, 0],
  [2, 3, 0, 1], [2, 3, 1, 0], [3, 0, 1, 2], [3, 0, 2, 1],
  [3, 1, 0, 2], [3, 1, 2, 0], [3, 2, 0, 1], [3, 2, 1, 0]
];

function assertQuad<T>(face: GeometricFace<T>): void {
  if (face.nodeIds.length !== 4 || face.points.length !== 4) {
    throw new Error("geometric face identity requires four-node faces");
  }
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function exactNodeKey(nodeIds: readonly number[]): string {
  return [...nodeIds].sort((a, b) => a - b).join(":");
}

function bucketKey(points: readonly Point[], tolerance: number): string {
  const min = [0, 1, 2].map((axis) =>
    Math.min(...points.map((point) => point[axis] ?? 0))
  );
  return min.map((value) => Math.floor(value / tolerance)).join(":");
}

function candidateBucketKeys(
  points: readonly Point[],
  tolerance: number
): string[] {
  const base = bucketKey(points, tolerance).split(":").map(Number);
  const keys: string[] = [];
  for (let i = -1; i <= 1; i += 1) {
    for (let j = -1; j <= 1; j += 1) {
      for (let k = -1; k <= 1; k += 1) {
        keys.push(
          `${base[0]! + i}:${base[1]! + j}:${base[2]! + k}`
        );
      }
    }
  }
  return keys;
}

function geometricallySameFace<T>(
  first: GeometricFace<T>,
  second: GeometricFace<T>,
  tolerance: number
): boolean {
  const toleranceSquared = tolerance * tolerance;
  const cornerMatch = QUAD_PERMUTATIONS.some((permutation) =>
    permutation.every((secondIndex, firstIndex) =>
      squaredDistance(
        first.points[firstIndex]!,
        second.points[secondIndex]!
      ) <= toleranceSquared
    )
  );
  if (!cornerMatch) {
    return false;
  }
  const firstNormal = newellNormal(first.points);
  const secondNormal = newellNormal(second.points);
  const firstLength = vectorLength(firstNormal);
  const secondLength = vectorLength(secondNormal);
  if (
    firstLength <= toleranceSquared
    || secondLength <= toleranceSquared
  ) {
    return false;
  }
  const normalAgreement = Math.abs(
    dot(firstNormal, secondNormal) / (firstLength * secondLength)
  );
  if (normalAgreement < 1 - 1e-8) {
    return false;
  }
  const areaTolerance =
    tolerance * Math.max(facePerimeter(first.points), 1);
  if (Math.abs(firstLength - secondLength) > areaTolerance) {
    return false;
  }
  return [...first.points, ...second.points].every((point) =>
    pointPlaneDistance(
      point,
      first.points[0]!,
      firstNormal,
      firstLength
    ) <= tolerance
  );
}

function newellNormal(points: readonly Point[]): [number, number, number] {
  const normal: [number, number, number] = [0, 0, 0];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    normal[0] += ((current[1] ?? 0) - (next[1] ?? 0))
      * ((current[2] ?? 0) + (next[2] ?? 0));
    normal[1] += ((current[2] ?? 0) - (next[2] ?? 0))
      * ((current[0] ?? 0) + (next[0] ?? 0));
    normal[2] += ((current[0] ?? 0) - (next[0] ?? 0))
      * ((current[1] ?? 0) + (next[1] ?? 0));
  }
  return normal;
}

function squaredDistance(first: Point, second: Point): number {
  return [0, 1, 2].reduce((sum, axis) => {
    const delta = (first[axis] ?? 0) - (second[axis] ?? 0);
    return sum + delta * delta;
  }, 0);
}

function dot(
  first: readonly number[],
  second: readonly number[]
): number {
  return [0, 1, 2].reduce(
    (sum, axis) => sum + (first[axis] ?? 0) * (second[axis] ?? 0),
    0
  );
}

function vectorLength(vector: readonly number[]): number {
  return Math.sqrt(dot(vector, vector));
}

function pointPlaneDistance(
  point: Point,
  origin: Point,
  normal: readonly number[],
  normalLength: number
): number {
  const delta = [0, 1, 2].map(
    (axis) => (point[axis] ?? 0) - (origin[axis] ?? 0)
  );
  return Math.abs(dot(delta, normal)) / normalLength;
}

function facePerimeter(points: readonly Point[]): number {
  return points.reduce((total, point, index) =>
    total + Math.sqrt(squaredDistance(
      point,
      points[(index + 1) % points.length]!
    )),
  0);
}

function uniqueFaces<T>(
  faces: readonly GeometricFace<T>[]
): Array<GeometricFace<T>> {
  return [...new Set(faces)];
}
```

The private helpers above provide:

- exact sorted node-id keys;
- minimum-coordinate bucket keys and all `3 x 3 x 3` neighboring buckets;
- one-to-one corner assignment by testing all 24 four-corner permutations;
- squared corner distance `<= tolerance ** 2`;
- Newell face normal and area comparison;
- maximum point-to-plane distance `<= tolerance`;
- normal compatibility by absolute normalized dot product `>= 1 - 1e-8`;
- deduplication by object identity.

Do not merge or rewrite node ids in this module.

- [ ] **Step 4: Run geometric tests and typecheck**

Run:

```powershell
npm run typecheck
npm run build
node --test --test-name-pattern="geometric face identity" test/refinement-kernel-suite.test.mjs
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit geometric face identity**

```powershell
git add src/geometric-face-index.ts test/refinement-kernel-suite.test.mjs
git commit -m "feat(mesh): add tolerance-aware face identity"
```

## Task 5: Use Geometric Face Identity in Session Shell Discovery

**Files:**
- Modify: `src/refinement-session.ts`
- Test: `test/refinement-kernel-suite.test.mjs`

- [ ] **Step 1: Write a duplicate-node shell-rebuild regression**

Add helpers that duplicate the four session node ids on one selected-to-shell
interface and translate the duplicate face by less than the merge tolerance:

```js
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

function firstActiveBoundaryCoreCell(session) {
  return [...session.activeLeafIds]
    .map((cellId) => {
      const cell = session.cells.get(cellId);
      if (cell?.level !== 1 || cell.role !== "selected") {
        return undefined;
      }
      const centerTotal = cell.element.reduce(
        (total, nodeId) =>
          total + session.nodes[nodeId - 1].reduce(
            (sum, coordinate) => sum + coordinate,
            0
          ),
        0
      ) / cell.element.length;
      return { cellId, centerTotal };
    })
    .filter(Boolean)
    .sort((a, b) => a.centerTotal - b.centerTotal)[0].cellId;
}

function duplicateOneNearCoincidentNeighborFace(
  session,
  selectedCellId
) {
  const selected = session.cells.get(selectedCellId);
  const selectedFaces = new Map(H1_TEST_FACES.map((face) => [
    testFaceCoordinateKey(session, selected, face),
    face
  ]));
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
      if (!selectedFaces.has(
        testFaceCoordinateKey(session, neighbor, face)
      )) {
        continue;
      }
      for (const localIndex of face) {
        const sourceNodeId = neighbor.element[localIndex];
        const source = session.nodes[sourceNodeId - 1];
        session.nodes.push([
          source[0] + 2e-10,
          source[1] - 1e-10,
          source[2] + 1e-10
        ]);
        neighbor.element[localIndex] = session.nodes.length;
      }
      return neighbor.id;
    }
  }
  throw new Error("selected core cell has no transition-face neighbor");
}
```

Then add:

```js
test("Hex 2:1 shell rebuilding recognizes near-coincident duplicate interface nodes", () => {
  const mesh = createHexUnitCubeMesh(7, 7, 7);
  const session = createRefinementSession(mesh);
  const initial = buildActiveMeshWithMap(session);
  const firstCore = idsInIndexBlock(
    7, 7, 7, [2, 2, 2], [4, 4, 4]
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
  const candidate = firstActiveBoundaryCoreCell(session);
  duplicateOneNearCoincidentNeighborFace(session, candidate);
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
  assert.equal(checkNoHangingNodes(refined, 1e-8).ok, true);
  assert.ok(minimumCornerScaledJacobian(refined) > 0);
});
```

The perturbation is one fiftieth of the requested `1e-8` merge tolerance, so
the interface is geometrically shared but no longer has an exact coordinate
string key.

- [ ] **Step 2: Run the regression and verify exact coordinate-key discovery fails**

Run:

```powershell
npm run build
node --test --test-name-pattern="near-coincident duplicate interface nodes" test/refinement-kernel-suite.test.mjs
```

Expected: failure in collision/support-component discovery before the
geometric index is integrated.

- [ ] **Step 3: Add session face-record helpers**

In `src/refinement-session.ts`, add:

```ts
function effectiveSessionFaceTolerance(
  session: RefinementSession,
  cellIds: readonly CellId[],
  requested?: number
): number {
  const mesh = buildActiveMeshForCellIdsWithMap(session, cellIds).mesh;
  const edge = minElementEdgeLength(mesh);
  const scale = Math.max(
    1,
    ...mesh.nodes.flatMap((point) => point.map(Math.abs))
  );
  return Math.max(
    requested ?? 0,
    edge * 1e-8,
    scale * Number.EPSILON * 64
  );
}

function refinementCellFaces(
  session: RefinementSession,
  cell: RefinementSessionCell
): Array<GeometricFace<CellId>> {
  return H1_FACES.map((face) => {
    const nodeIds = face.map((localNodeId) => {
      const nodeId = cell.element[localNodeId - 1];
      if (nodeId === undefined || !session.nodes[nodeId - 1]) {
        throw new Error(`cell ${cell.id} has an invalid Hex face`);
      }
      return nodeId;
    });
    return {
      owner: cell.id,
      nodeIds,
      points: nodeIds.map((nodeId) => session.nodes[nodeId - 1]!)
    };
  });
}
```

- [ ] **Step 4: Replace exact face-key comparisons**

Use `GeometricFaceIndex` in these functions:

- `selectionTouchesActiveTransitionCell`;
- `findCollidingTransitionParentIds`;
- `collectConnectedSupportLayerCells`;
- `collectAuthorizedCompletionParentIds`;
- replacement-interface ownership validation.

For connected components, index every support-cell face, then add an adjacency
edge only when `uniqueMatch()` returns another owner. For collision tests,
index one side and query the other side.

Retain `refinementCellGeometryKey()` for exact selected-geometry remapping in
Stage A; it is not a face-adjacency decision.

- [ ] **Step 5: Run exact, duplicate-node, warped, and ambiguous tests**

Run:

```powershell
npm run typecheck
npm run build
node --test --test-name-pattern="transition-shell rebuilding|duplicate coincident|warped mapped|ambiguous faces" test/refinement-kernel-suite.test.mjs
```

Expected: all selected tests pass. The existing exact-node path remains green.

- [ ] **Step 6: Commit session face matching**

```powershell
git add src/refinement-session.ts test/refinement-kernel-suite.test.mjs
git commit -m "fix(refinement): match rebuilt shell faces by tolerance"
```

## Task 6: Add Bounded One-Layer Selection Compensation

**Files:**
- Create: `src/two-to-one-planner.ts`
- Modify: `src/transitions.ts`
- Modify: `src/refinement-planner.ts`
- Modify: `src/refinement-ops.ts`
- Modify: `src/hex-core.ts`
- Modify: `src/refinement-session.ts`
- Modify: `src/index.ts`
- Test: `test/refinement-kernel-suite.test.mjs`

- [ ] **Step 1: Write direct, compensated, limit, and strict-mode tests**

Add:

```js
test("Hex 2:1 planner minimally expands a compensable logical core", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  const original = idsInIndexBlock(2, 2, 5, [0, 0, 1], [1, 1, 1]);
  const result = refineByElementIdsWithReport(mesh, original, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    regularizeHexSelection: false,
    hexTwoToOneCompensation: {
      mode: "selection",
      maxAddedParentLayers: 1,
      maxAddedParentCount: 32
    }
  });

  assert.equal(result.twoToOne.status, "compensated");
  assert.equal(result.twoToOne.actions.length, 1);
  assert.equal(result.twoToOne.actions[0].kind, "selection-expand");
  assert.deepEqual(
    result.twoToOne.actions[0].addedParentCellIds,
    idsInIndexBlock(2, 2, 5, [0, 0, 0], [1, 1, 0])
  );
  assert.equal(result.twoToOne.preservedFarFieldCellCount, 8);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
  assert.ok(minimumCornerScaledJacobian(result.mesh) > 0);
});

test("Hex 2:1 compensation never changes an already direct core", () => {
  const mesh = createHexUnitCubeMesh(5, 5, 5);
  const selected = [elementIdAt(5, 5, 5, 2, 2, 2)];
  const result = refineByElementIdsWithReport(mesh, selected, {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    regularizeHexSelection: false
  });
  assert.equal(result.twoToOne.status, "direct");
  assert.deepEqual(result.twoToOne.actions, []);
  assert.deepEqual(result.twoToOne.effectiveSelectedCellIds, selected);
});

test("Hex 2:1 compensation limit rejects atomically", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  const selected = idsInIndexBlock(2, 2, 5, [0, 0, 1], [1, 1, 1]);
  assert.throws(
    () => refineByElementIdsWithReport(mesh, selected, {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      regularizeHexSelection: false,
      hexTwoToOneCompensation: {
        mode: "selection",
        maxAddedParentLayers: 1,
        maxAddedParentCount: 0
      }
    }),
    (error) =>
      error.code === "TWO_TO_ONE_COMPENSATION_LIMIT"
      && error.diagnostic.attemptedActions.length > 0
  );
  assert.equal(mesh.elements.length, 20);
});

test("Hex 2:1 strict mode rejects instead of expanding", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 5);
  const selected = idsInIndexBlock(2, 2, 5, [0, 0, 1], [1, 1, 1]);
  assert.throws(
    () => refineByElementIdsWithReport(mesh, selected, {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      regularizeHexSelection: false,
      hexTwoToOneCompensation: { mode: "none" }
    }),
    (error) => error instanceof TwoToOnePlanningError
  );
});
```

The `2 x 2 x 5` case is fixed regression data verified against the current
direct solver: the single full-section layer at logical `k = 1` fails, while
adding the adjacent model-boundary layer at `k = 0` succeeds and leaves eight
far-field parents unchanged.

- [ ] **Step 2: Run focused tests and verify no compensation policy exists**

Run:

```powershell
npm run build
node --test --test-name-pattern="minimally expands|compensation limit|strict mode|already direct core" test/refinement-kernel-suite.test.mjs
```

Expected: failures because the direct solver error is not retried.

- [ ] **Step 3: Implement candidate generation and deterministic scoring**

Create `src/two-to-one-planner.ts` with:

```ts
import {
  DirectTwoToOnePlanningError,
  normalizeTwoToOneCompensation,
  TwoToOnePlanningError,
  type TwoToOneCapabilityReport,
  type TwoToOneCompensationAction,
  type TwoToOnePlanningErrorCode
} from "./two-to-one-capability.js";
import { auditHexRefinementPatchQuality } from "./hex-quality.js";
import { minElementEdgeLength } from "./mesh.js";
import { inferHexElementLattice } from "./regularization.js";
import {
  buildDirectTwoToOneHexPlan,
  type DirectTwoToOnePlan,
  type TwoToOneReplacement
} from "./two-to-one.js";
import type { Mesh, RefineOptions } from "./types.js";

export interface PlannedTwoToOneHexRefinement {
  replacements: TwoToOneReplacement[];
  report: TwoToOneCapabilityReport<number>;
}

interface ExpansionCandidate {
  effective: number[];
  added: number[];
}

interface SuccessfulExpansion {
  candidate: ExpansionCandidate;
  direct: DirectTwoToOnePlan;
  childMinimumOrientedScaledJacobian: number;
}

export function planTwoToOneHexRefinement(
  mesh: Mesh,
  selectedElementIds: readonly number[],
  options: RefineOptions
): PlannedTwoToOneHexRefinement {
  const original = uniqueSorted(selectedElementIds);
  const policy = normalizeTwoToOneCompensation(original.length, options);
  try {
    return directPlan(mesh, original);
  } catch (error) {
    if (!(error instanceof DirectTwoToOnePlanningError)) {
      throw publicTopologyError(error, original);
    }
    if (policy.mode === "none") {
      throw publicDirectFailure(error, original, []);
    }
    const generatedCandidates =
      oneLayerLogicalExpansionCandidates(mesh, original)
      .map((effective) => ({
        effective,
        added: effective.filter((id) => !original.includes(id))
      }));
    const attempted = generatedCandidates.map(({ added }) =>
      selectionExpansionAction(error.message, added)
    );
    const candidates = generatedCandidates
      .filter(({ added }) =>
        policy.maxAddedParentLayers >= 1
        && added.length <= policy.maxAddedParentCount
      );
    const successful = candidates.flatMap((candidate) => {
      try {
        const direct = buildDirectTwoToOneHexPlan(
          mesh,
          candidate.effective
        );
        const quality = auditHexRefinementPatchQuality(
          mesh,
          direct.replacements
        );
        return [{
          candidate,
          direct,
          childMinimumOrientedScaledJacobian:
            quality.childMinimumOrientedScaledJacobian
        }];
      } catch (candidateError) {
        if (candidateError instanceof DirectTwoToOnePlanningError) {
          return [];
        }
        throw candidateError;
      }
    });
    if (successful.length === 0) {
      const code =
        generatedCandidates.length > 0 && candidates.length === 0
        ? "TWO_TO_ONE_COMPENSATION_LIMIT"
        : publicCodeForDirectFailure(error);
      throw planningError(code, error.message, original, attempted);
    }
    successful.sort(compareSuccessfulCandidates);
    return compensatedPlan(mesh, original, successful[0]!);
  }
}

function directPlan(
  mesh: Mesh,
  selected: readonly number[]
): PlannedTwoToOneHexRefinement {
  const direct = buildDirectTwoToOneHexPlan(mesh, selected);
  const affected = uniqueSorted(
    direct.replacements.map((replacement) => replacement.elementId)
  );
  return {
    replacements: direct.replacements,
    report: {
      status: "direct",
      topologyClass:
        direct.strategy === "local-sweep"
          ? "mapped"
          : "periodic-ogrid",
      originalSelectedCellIds: [...selected],
      effectiveSelectedCellIds: [...selected],
      actions: [],
      affectedComponentCellIds: affected,
      preservedFarFieldCellCount: mesh.elements.length - affected.length
    }
  };
}

function selectionExpansionAction(
  reason: string,
  added: readonly number[]
): TwoToOneCompensationAction<number> {
  return {
    kind: "selection-expand",
    reason,
    addedParentCellIds: [...added],
    replacedTransitionCellIds: []
  };
}

function compensatedPlan(
  mesh: Mesh,
  original: readonly number[],
  successful: SuccessfulExpansion
): PlannedTwoToOneHexRefinement {
  const { candidate, direct } = successful;
  const affected = uniqueSorted(
    direct.replacements.map((replacement) => replacement.elementId)
  );
  return {
    replacements: direct.replacements,
    report: {
      status: "compensated",
      topologyClass:
        direct.strategy === "local-sweep"
          ? "mapped"
          : "periodic-ogrid",
      originalSelectedCellIds: [...original],
      effectiveSelectedCellIds: [...candidate.effective],
      actions: [selectionExpansionAction(
        "completed a conforming one-layer 2:1 template field",
        candidate.added
      )],
      affectedComponentCellIds: affected,
      preservedFarFieldCellCount: mesh.elements.length - affected.length
    }
  };
}

function compareSuccessfulCandidates(
  first: SuccessfulExpansion,
  second: SuccessfulExpansion
): number {
  return first.candidate.added.length - second.candidate.added.length
    || first.direct.replacements.length - second.direct.replacements.length
    || second.childMinimumOrientedScaledJacobian
      - first.childMinimumOrientedScaledJacobian
    || compareNumberLists(
      first.candidate.effective,
      second.candidate.effective
    );
}

function compareNumberLists(
  first: readonly number[],
  second: readonly number[]
): number {
  for (let index = 0; index < Math.min(first.length, second.length); index += 1) {
    const difference = first[index]! - second[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return first.length - second.length;
}

function publicCodeForDirectFailure(
  error: DirectTwoToOnePlanningError
): TwoToOnePlanningErrorCode {
  if (error.kind === "parity") {
    return "TWO_TO_ONE_UNSUPPORTED_PARITY";
  }
  if (error.kind === "valence") {
    return "TWO_TO_ONE_UNSUPPORTED_VALENCE";
  }
  return "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY";
}

function planningError(
  code: TwoToOnePlanningErrorCode,
  message: string,
  selected: readonly number[],
  attemptedActions: Array<TwoToOneCompensationAction<number>>
): TwoToOnePlanningError<number> {
  return new TwoToOnePlanningError(code, message, {
    conflictingCellIds: [...selected],
    conflictingInterfaces: [],
    attemptedActions,
    suggestion: attemptedActions.length === 0
      ? { kind: "remesh-source" }
      : { kind: "expand-selection" }
  });
}

function publicDirectFailure(
  error: DirectTwoToOnePlanningError,
  selected: readonly number[],
  attemptedActions: Array<TwoToOneCompensationAction<number>>
): TwoToOnePlanningError<number> {
  return planningError(
    publicCodeForDirectFailure(error),
    error.message,
    selected,
    attemptedActions
  );
}

function publicTopologyError(
  error: unknown,
  selected: readonly number[]
): TwoToOnePlanningError<number> {
  return planningError(
    "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY",
    error instanceof Error ? error.message : String(error),
    selected,
    []
  );
}

function oneLayerLogicalExpansionCandidates(
  mesh: Mesh,
  selected: readonly number[]
): number[][] {
  const tolerance = Math.max(
    minElementEdgeLength(mesh) * 1e-8,
    Number.EPSILON * 64
  );
  const lattice = inferHexElementLattice(mesh, tolerance);
  const indices = selected.map((elementId) =>
    lattice.indicesByElementId.get(elementId)
  );
  if (indices.some((index) => index === undefined)) {
    return [];
  }
  const typed = indices as Array<[number, number, number]>;
  const min = [0, 1, 2].map((axis) =>
    Math.min(...typed.map((index) => index[axis]!))
  ) as [number, number, number];
  const max = [0, 1, 2].map((axis) =>
    Math.max(...typed.map((index) => index[axis]!))
  ) as [number, number, number];
  const selectedSet = new Set(selected);
  const originalBlock = idsInLogicalRange(lattice, min, max);
  if (
    originalBlock.length !== selected.length
    || originalBlock.some((elementId) => !selectedSet.has(elementId))
  ) {
    return [];
  }

  const candidates = new Map<string, number[]>();
  for (const axis of [0, 1, 2] as const) {
    for (const side of [-1, 1] as const) {
      const nextMin = [...min] as [number, number, number];
      const nextMax = [...max] as [number, number, number];
      if (side < 0) {
        if (nextMin[axis] === 0) {
          continue;
        }
        nextMin[axis] -= 1;
      } else {
        if (nextMax[axis] === lattice.dimensions[axis] - 1) {
          continue;
        }
        nextMax[axis] += 1;
      }
      const ids = idsInLogicalRange(lattice, nextMin, nextMax);
      if (ids.length > 0) {
        candidates.set(ids.join(":"), ids);
      }
    }
  }
  return [...candidates.values()].sort(compareNumberLists);
}

function idsInLogicalRange(
  lattice: ReturnType<typeof inferHexElementLattice>,
  min: readonly [number, number, number],
  max: readonly [number, number, number]
): number[] {
  const ids: number[] = [];
  for (let k = min[2]; k <= max[2]; k += 1) {
    for (let j = min[1]; j <= max[1]; j += 1) {
      for (let i = min[0]; i <= max[0]; i += 1) {
        const elementId = lattice.elementIdByKey.get(`${i}:${j}:${k}`);
        if (elementId === undefined) {
          return [];
        }
        ids.push(elementId);
      }
    }
  }
  return ids.sort((a, b) => a - b);
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}
```

The implementation above enforces:

1. infer the lattice with
   `max(minElementEdgeLength(mesh) * 1e-8, Number.EPSILON * 64)`;
2. require every selected id to have an index;
3. require the selected ids to exactly fill their bounding index range;
4. create at most six candidates by extending one min or max side by one;
5. reject out-of-grid candidates;
6. return the complete ids in each expanded range;
7. deduplicate candidates by sorted id signature.

`compareSuccessfulCandidates()` sorts by:

1. `added.length`;
2. number of replacement parents;
3. descending minimum reference child Jacobian from
   `auditHexRefinementPatchQuality`;
4. lexicographic effective id list.

Do not catch ordinary invariant errors from the direct solver as compensable.

- [ ] **Step 4: Route all H1 2:1 planning through the policy layer**

In `src/transitions.ts`, call `planTwoToOneHexRefinement()` instead of
`buildDirectTwoToOneHexPlan()` for ratio 2 with transitions enabled.

In `src/refinement-session.ts`, pass through:

```ts
hexTwoToOneCompensation: options.hexTwoToOneCompensation
```

and add the same field to `RefinementSessionPatchOptions`.

Map report numeric active element ids to session `CellId` using the planning
and source active maps before storing it in the plan/command.

Update `shouldRebuildExistingTransitionShell()` to normalize the same policy
and return `false` unless the effective mode is `"local-topology"`:

```ts
const compensation = normalizeTwoToOneCompensation(
  validation.cellIds.length,
  options
);
if (compensation.mode !== "local-topology") {
  return false;
}
```

This makes `"selection"` permit only logical selection expansion and makes
`"none"` strict for both flat and session APIs.

Export `planTwoToOneHexRefinement` from `src/index.ts`.

- [ ] **Step 5: Add a far-field preservation assertion**

For the compensated flat test, snapshot every element outside
`affectedComponentCellIds` before refinement and assert its connectivity still
appears unchanged in the result's unchanged `cellData` parents:

```js
const affected = new Set(
  result.twoToOne.affectedComponentCellIds
);
const expectedFarField = mesh.elements
  .map((element, index) => ({
    parentElementId: index + 1,
    element
  }))
  .filter(({ parentElementId }) => !affected.has(parentElementId));
assert.equal(
  expectedFarField.every(({ parentElementId }) =>
    result.cellData.some((cell) =>
      cell.parentElementId === parentElementId
      && cell.role === "unchanged"
    )
  ),
  true
);
```

- [ ] **Step 6: Run compensation, conformance, and quality tests**

Run:

```powershell
npm run typecheck
npm run build
node --test --test-name-pattern="Hex 2:1" test/refinement-kernel-suite.test.mjs
```

Expected: all 2:1 tests pass, direct cases remain direct, and only the
deliberately compensable case expands.

- [ ] **Step 7: Commit bounded compensation**

```powershell
git add src/two-to-one-planner.ts src/transitions.ts src/refinement-planner.ts src/refinement-ops.ts src/hex-core.ts src/refinement-session.ts src/index.ts test/refinement-kernel-suite.test.mjs
git commit -m "feat(refinement): compensate bounded 2:1 selections"
```

## Task 7: Map Session and Quality Failures to Structured Rejections

**Files:**
- Modify: `src/refinement-session.ts`
- Modify: `src/hex-core.ts`
- Modify: `src/refinement-ops.ts`
- Test: `test/refinement-kernel-suite.test.mjs`

- [ ] **Step 1: Write atomic structured-rejection tests**

Update the strict collision test to require:

```js
assert.throws(
  () => refineSessionPatch(session, [boundaryCandidate.cellId], {
    hexRefinementRatio: 2,
    hexTwoToOneSelectionMode: "local",
    includeTransitions: true,
    hexTwoToOneCompensation: { mode: "none" },
    activeBuild: firstRefined
  }),
  (error) =>
    error.code === "TWO_TO_ONE_CONFORMANCE"
    && error.diagnostic.conflictingCellIds.includes(
      boundaryCandidate.cellId
    )
);
```

Add snapshots for `nodes.length`, `activeLeafIds`, `undoStack`, and
`redoStack`, and assert they are identical after:

- parent Jacobian rejection;
- child Jacobian rejection;
- volume rejection;
- ambiguous geometric face rejection;
- compensation-limit rejection.

- [ ] **Step 2: Run structured rejection tests and verify legacy errors leak**

Run:

```powershell
npm run build
node --test --test-name-pattern="reject|rejection|ambiguous" test/refinement-kernel-suite.test.mjs
```

Expected: strict collision and quality tests fail their new error-code
assertions.

- [ ] **Step 3: Add one API-boundary error mapper**

In `src/refinement-session.ts`, implement:

```ts
function asTwoToOneSessionPlanningError(
  error: unknown,
  selectedCellIds: readonly CellId[],
  active: ActiveMeshBuildResult
): TwoToOnePlanningError<CellId> {
  if (error instanceof TwoToOnePlanningError) {
    return mapNumericDiagnosticToCellIds(
      error,
      selectedCellIds,
      active
    );
  }
  if (error instanceof ExistingTransitionCollisionError) {
    return new TwoToOnePlanningError(
      "TWO_TO_ONE_CONFORMANCE",
      error.message,
      {
        conflictingCellIds: [...selectedCellIds],
        conflictingInterfaces: [],
        attemptedActions: [],
        suggestion: { kind: "expand-selection" }
      }
    );
  }
  if (error instanceof HexPatchQualityError) {
    const code = {
      HEX_PATCH_PARENT_JACOBIAN: "TWO_TO_ONE_PARENT_JACOBIAN",
      HEX_PATCH_CHILD_JACOBIAN: "TWO_TO_ONE_CHILD_JACOBIAN",
      HEX_PATCH_VOLUME: "TWO_TO_ONE_VOLUME"
    }[error.code];
    return new TwoToOnePlanningError(code, error.message, {
      conflictingCellIds: [...selectedCellIds],
      conflictingInterfaces: [],
      attemptedActions: []
    });
  }
  return new TwoToOnePlanningError(
    "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY",
    error instanceof Error ? error.message : String(error),
    {
      conflictingCellIds: [...selectedCellIds],
      conflictingInterfaces: [],
      attemptedActions: [],
      suggestion: { kind: "remesh-source" }
    }
  );
}

function mapNumericDiagnosticToCellIds(
  error: TwoToOnePlanningError<number>,
  selectedCellIds: readonly CellId[],
  active: ActiveMeshBuildResult
): TwoToOnePlanningError<CellId> {
  const mapId = (elementId: number): CellId | undefined =>
    activeBuildCellIdByElementId(active, elementId);
  const mapAction = (
    action: TwoToOneCompensationAction<number>
  ): TwoToOneCompensationAction<CellId> => ({
    ...action,
    addedParentCellIds:
      action.addedParentCellIds.map(mapId).filter(
        (cellId): cellId is CellId => cellId !== undefined
      ),
    replacedTransitionCellIds:
      action.replacedTransitionCellIds.map(mapId).filter(
        (cellId): cellId is CellId => cellId !== undefined
      )
  });
  const conflictingCellIds = error.diagnostic.conflictingCellIds
    .map(mapId)
    .filter((cellId): cellId is CellId => cellId !== undefined);
  return new TwoToOnePlanningError(error.code, error.message, {
    conflictingCellIds:
      conflictingCellIds.length > 0
        ? conflictingCellIds
        : [...selectedCellIds],
    conflictingInterfaces: error.diagnostic.conflictingInterfaces.flatMap(
      (item) => {
        const firstCellId = mapId(item.firstCellId);
        const secondCellId = item.secondCellId === undefined
          ? undefined
          : mapId(item.secondCellId);
        if (firstCellId === undefined) {
          return [];
        }
        return [{
          firstCellId,
          ...(secondCellId === undefined ? {} : { secondCellId }),
          faceNodeIds: [...item.faceNodeIds]
        }];
      }
    ),
    attemptedActions:
      error.diagnostic.attemptedActions.map(mapAction),
    ...(error.diagnostic.suggestion === undefined
      ? {}
      : {
          suggestion: {
            ...error.diagnostic.suggestion,
            ...(error.diagnostic.suggestion.parentCellIds === undefined
              ? {}
              : {
                  parentCellIds:
                    error.diagnostic.suggestion.parentCellIds
                      .map(mapId)
                      .filter(
                        (cellId): cellId is CellId =>
                          cellId !== undefined
                      )
                })
          }
        })
  });
}
```

Call this mapper only after the existing shell-rebuild retry decision. This
preserves automatic rebuilding but prevents internal error types from escaping
when the operation is rejected. Pass the same `sourceActive` used for the
failed plan so diagnostic ids are mapped in the correct id space.

Use the numeric equivalent at the flat API boundary.

- [ ] **Step 4: Verify no rejected operation mutates input or history**

Run:

```powershell
npm run typecheck
npm run build
node --test --test-name-pattern="reject|rejection|ambiguous|quality" test/refinement-kernel-suite.test.mjs
```

Expected: all selected tests pass and every rejection has a public error code.

- [ ] **Step 5: Commit structured rejection mapping**

```powershell
git add src/refinement-session.ts src/hex-core.ts src/refinement-ops.ts test/refinement-kernel-suite.test.mjs
git commit -m "fix(refinement): reject unsupported 2:1 topology atomically"
```

## Task 8: Generate Three Mesh-Only LS-DYNA Regression Fixtures

**Files:**
- Create: `scripts/generate-lsdyna-regression-fixtures.mjs`
- Create: `test/fixtures/lsdyna/tension-gauge-slab.k`
- Create: `test/fixtures/lsdyna/compression-ogrid-ring.k`
- Create: `test/fixtures/lsdyna/double-shear-contact-shell.k`
- Create: `test/fixtures/lsdyna/tension-gauge-slab.json`
- Create: `test/fixtures/lsdyna/compression-ogrid-ring.json`
- Create: `test/fixtures/lsdyna/double-shear-contact-shell.json`
- Modify: `test/fixtures/lsdyna/README.md`
- Modify: `test/comformhex.test.mjs`

- [ ] **Step 1: Add fixture manifest and round-trip test helpers**

In `test/comformhex.test.mjs`, add:

```js
function loadLsdynaRegressionFixture(name) {
  const root = new URL("./fixtures/lsdyna/", import.meta.url);
  const keyword = readFileSync(new URL(`${name}.k`, root), "utf8");
  const manifest = JSON.parse(
    readFileSync(new URL(`${name}.json`, root), "utf8")
  );
  return {
    keyword,
    manifest,
    mesh: parseMeshText(keyword, `${name}.k`)
  };
}

function assertMeshOnlyKeyword(keyword) {
  const keywords = keyword
    .split(/\r?\n/)
    .map((line) => line.trim().toUpperCase())
    .filter((line) => line.startsWith("*"));
  assert.deepEqual(keywords, [
    "*KEYWORD",
    "*NODE",
    "*ELEMENT_SOLID",
    "*END"
  ]);
}

function assertPoint(actual, expected, tolerance) {
  assert.equal(actual.length, expected.length);
  for (let axis = 0; axis < expected.length; axis += 1) {
    assert.ok(
      Math.abs(actual[axis] - expected[axis]) <= tolerance,
      `coordinate ${axis}: ${actual[axis]} != ${expected[axis]}`
    );
  }
}
```

Add a table-driven test:

```js
for (const name of [
  "tension-gauge-slab",
  "compression-ogrid-ring",
  "double-shear-contact-shell"
]) {
  test(`HexRefine refines and round-trips ${name}`, () => {
    const { keyword, manifest, mesh } =
      loadLsdynaRegressionFixture(name);
    assertMeshOnlyKeyword(keyword);
    const result = refinementOps.refineByElementIdsWithReport(
      mesh,
      manifest.selectedElementIds,
      manifest.options
    );
    assert.equal(result.twoToOne.status, manifest.expectedStatus);
    assert.equal(checkNoHangingNodes(result.mesh, 1e-8).ok, true);
    assert.ok(
      result.quality.childMinimumOrientedScaledJacobian
      >= manifest.minimumScaledJacobian
    );
    const output = meshToLsdynaKeyword(result.mesh, { partId: 1 });
    assertMeshOnlyKeyword(output);
    const reparsed = parseMeshText(output, `${name}-refined.k`);
    assert.deepEqual(reparsed.elements, result.mesh.elements);
    assert.equal(reparsed.nodes.length, result.mesh.nodes.length);
    for (let index = 0; index < reparsed.nodes.length; index += 1) {
      assertPoint(reparsed.nodes[index], result.mesh.nodes[index], 1e-8);
    }
  });
}
```

- [ ] **Step 2: Run the fixture tests and verify files are missing**

Run:

```powershell
npm run build
node --test --test-name-pattern="round-trips" test/comformhex.test.mjs
```

Expected: file-not-found failures for the new fixtures.

- [ ] **Step 3: Implement deterministic fixture generation**

Create `scripts/generate-lsdyna-regression-fixtures.mjs`.

The script imports built API functions from `../dist/index.js`, copies the
existing anonymized `real-ogrid-gauge-slab.k` topology into
`tension-gauge-slab.k`, and generates two compact topology-only meshes:

```js
import { readFileSync, writeFileSync } from "node:fs";
import {
  checkNoHangingNodes,
  createHexUnitCubeMesh,
  meshToLsdynaKeyword,
  parseMeshText,
  refineByElementIdsWithReport
} from "../dist/index.js";

const fixtures = [
  {
    name: "tension-gauge-slab",
    mesh: parseMeshText(
      readFileSync(
        new URL(
          "../test/fixtures/lsdyna/real-ogrid-gauge-slab.k",
          import.meta.url
        ),
        "utf8"
      ),
      "real-ogrid-gauge-slab.k"
    ),
    select: (mesh) => mesh.elements
      .map((element, index) => ({
        elementId: index + 1,
        y: averageCoordinate(mesh, element, 1)
      }))
      .filter(({ y }) => Math.abs(y) < 0.06)
      .map(({ elementId }) => elementId),
    options: {
      hexRefinementRatio: 2,
      regularizeHexSelection: false
    },
    expectedStatus: "direct",
    minimumScaledJacobian: 0.25
  },
  {
    name: "compression-ogrid-ring",
    mesh: createFixtureButterflyOgridBar(6),
    select: () => Array.from(
      { length: 24 },
      (_, index) => 25 + index
    ),
    options: {
      hexRefinementRatio: 2,
      regularizeHexSelection: false
    },
    expectedStatus: "direct",
    minimumScaledJacobian: 0.08
  },
  {
    name: "double-shear-contact-shell",
    mesh: createFixtureDoubleShearBlock(),
    select: () => [
      ...idsInIndexBlock(9, 7, 3, [2, 1, 1], [3, 2, 1]),
      ...idsInIndexBlock(9, 7, 3, [5, 4, 1], [6, 5, 1])
    ],
    options: {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      regularizeHexSelection: false
    },
    expectedStatus: "direct",
    minimumScaledJacobian: 0.12
  }
];
```

Move the existing deterministic butterfly constructor from test-only code into
the script as `createFixtureButterflyOgridBar()`. Define
`createFixtureDoubleShearBlock()` by starting from
`createHexUnitCubeMesh(9, 7, 3)` and applying this reversible mapped
deformation:

```js
function createFixtureDoubleShearBlock() {
  const base = createHexUnitCubeMesh(9, 7, 3);
  return {
    ...base,
    nodes: base.nodes.map(([x, y, z]) => [
      x + 0.08 * Math.sin(Math.PI * y) * (z - 0.5),
      y + 0.04 * Math.sin(2 * Math.PI * x),
      0.2 * z + 0.02 * x * y
    ])
  };
}

function averageCoordinate(mesh, element, axis) {
  return element.reduce(
    (total, nodeId) => total + mesh.nodes[nodeId - 1][axis],
    0
  ) / element.length;
}

function elementIdAt(nx, ny, i, j, k) {
  return k * nx * ny + j * nx + i + 1;
}

function idsInIndexBlock(nx, ny, _nz, min, max) {
  const ids = [];
  for (let k = min[2]; k <= max[2]; k += 1) {
    for (let j = min[1]; j <= max[1]; j += 1) {
      for (let i = min[0]; i <= max[0]; i += 1) {
        ids.push(elementIdAt(nx, ny, i, j, k));
      }
    }
  }
  return ids;
}

function assertMeshOnlyKeyword(keyword) {
  const keywords = keyword
    .split(/\r?\n/)
    .map((line) => line.trim().toUpperCase())
    .filter((line) => line.startsWith("*"));
  if (keywords.join("|") !==
    "*KEYWORD|*NODE|*ELEMENT_SOLID|*END") {
    throw new Error(`fixture contains non-mesh keywords: ${keywords}`);
  }
}
```

For every fixture:

1. run the planned operation;
2. require positive Jacobian, volume conservation, and no hanging nodes;
3. write K with `meshToLsdynaKeyword(mesh, { partId: 1 })`;
4. write a JSON manifest containing:
   - `selectedElementIds`;
   - `options`;
   - `expectedStatus`;
   - `expectedInputNodeCount`;
   - `expectedInputElementCount`;
   - `expectedOutputNodeCount`;
   - `expectedOutputElementCount`;
   - `minimumScaledJacobian`;
5. reject any generated K containing keywords other than the four allowed
   mesh-only keywords.

Use this exact generation loop:

```js
for (const fixture of fixtures) {
  const selectedElementIds = fixture.select(fixture.mesh);
  const result = refineByElementIdsWithReport(
    fixture.mesh,
    selectedElementIds,
    fixture.options
  );
  if (
    !result.quality?.ok
    || !checkNoHangingNodes(result.mesh, 1e-8).ok
    || result.twoToOne?.status !== fixture.expectedStatus
  ) {
    throw new Error(`${fixture.name} failed its generation audit`);
  }
  const keyword = meshToLsdynaKeyword(
    fixture.mesh,
    { partId: 1 }
  );
  assertMeshOnlyKeyword(keyword);
  const manifest = {
    selectedElementIds,
    options: fixture.options,
    expectedStatus: fixture.expectedStatus,
    expectedInputNodeCount: fixture.mesh.nodes.length,
    expectedInputElementCount: fixture.mesh.elements.length,
    expectedOutputNodeCount: result.mesh.nodes.length,
    expectedOutputElementCount: result.mesh.elements.length,
    minimumScaledJacobian: fixture.minimumScaledJacobian
  };
  writeFileSync(
    new URL(
      `../test/fixtures/lsdyna/${fixture.name}.k`,
      import.meta.url
    ),
    keyword
  );
  writeFileSync(
    new URL(
      `../test/fixtures/lsdyna/${fixture.name}.json`,
      import.meta.url
    ),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}
```

This produces public topological regression fixtures without copying private
geometry, identifiers, dimensions, units, or analysis metadata.

- [ ] **Step 4: Build and generate the fixtures**

Run:

```powershell
npm run build
node scripts/generate-lsdyna-regression-fixtures.mjs
```

Expected: six new fixture/manifest files and no modifications outside
`test/fixtures/lsdyna`.

- [ ] **Step 5: Strengthen fixture tests with manifest counts**

Add:

```js
assert.equal(mesh.nodes.length, manifest.expectedInputNodeCount);
assert.equal(mesh.elements.length, manifest.expectedInputElementCount);
assert.equal(result.mesh.nodes.length, manifest.expectedOutputNodeCount);
assert.equal(
  result.mesh.elements.length,
  manifest.expectedOutputElementCount
);
assert.equal(
  manifest.selectedElementIds.every((parentElementId) =>
    result.cellData.filter((cell) =>
      cell.parentElementId === parentElementId
      && cell.role === "selected"
    ).length === 8
  ),
  true
);
```

- [ ] **Step 6: Document fixture provenance**

Update `test/fixtures/lsdyna/README.md` to state:

- `tension-gauge-slab.k` retains the existing anonymized real O-grid slab;
- the compression and double-shear fixtures are deterministic topology-only
  models generated from public constructors;
- all three contain only `*NODE` and `*ELEMENT_SOLID`;
- the full private engineering decks are local acceptance data and are not
  committed;
- regenerate with:

```powershell
npm run build
node scripts/generate-lsdyna-regression-fixtures.mjs
```

- [ ] **Step 7: Run all import/export and fixture tests**

Run:

```powershell
npm run build
node --test test/comformhex.test.mjs
```

Expected: all `comformhex` tests pass.

- [ ] **Step 8: Commit fixture generation and regressions**

```powershell
git add scripts/generate-lsdyna-regression-fixtures.mjs test/fixtures/lsdyna test/comformhex.test.mjs
git commit -m "test(lsdyna): cover three 2:1 mesh fixtures"
```

## Task 9: Document Stage A and Run the Full Maturity Gate

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/implementation.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document the public support boundary**

Add a concise 2:1 capability section to `README.md`:

```md
### 2:1 capability outcomes

A 2:1 request is either direct, compensated, or rejected. HexRefine may add a
bounded face-connected parent layer or rebuild the colliding transition
component when the operation remains conforming. Every compensation is reported
in `twoToOne.actions`.

HexRefine does not promise a conforming 2:1 result for every arbitrary Hex
topology. Unsupported parity, valence, ambiguous geometry, history, or quality
conditions throw `TwoToOnePlanningError` before the mesh or session is changed.
```

Document `planMode` narrowing and mesh-only K output in the same section.

- [ ] **Step 2: Document architecture and implementation details**

In `docs/architecture.md`, add the call sequence:

```text
selection
  -> direct two-to-one solver
  -> bounded compensation planner
  -> classified replacement plan
  -> conformance and quality gates
  -> flat result or atomic session command
```

In `docs/implementation.md`, document:

- compensation defaults and limits;
- exact-first geometric face matching;
- aggregate preview summary fields;
- stable public rejection codes;
- fixture regeneration command;
- Stage A limitations:
  - one-layer rectangular structured/mapped selection expansion only;
  - one untouched support-command rebuild only;
  - no arbitrary cavity remeshing;
  - no component-scoped overlay yet.

- [ ] **Step 3: Add a changelog entry**

Under the unreleased section of `CHANGELOG.md`, add:

```md
- Added explicit direct/compensated/rejected H1 2:1 planning outcomes.
- Added bounded one-layer selection compensation and structured planning errors.
- Made aggregate shell-rebuild previews unambiguous.
- Added tolerance-aware geometric interface discovery for imported duplicate nodes.
- Added tensile, compression O-grid, and double-shear mesh-only K regressions.
```

- [ ] **Step 4: Verify generated files are reproducible**

Run:

```powershell
npm run build
node scripts/generate-lsdyna-regression-fixtures.mjs
git diff --exit-code -- test/fixtures/lsdyna
```

Expected: the generator produces no diff after the committed fixtures exist.

- [ ] **Step 5: Run the complete verification gate**

Run:

```powershell
npm run typecheck
npm test
git diff --check
```

Expected:

- typecheck passes;
- every Node test passes;
- no whitespace errors.

Do not run `npm run pages:build` in this stage because the working tree already
contains unrelated generated browser and VTK modifications. Run it only in a
clean release worktree before PR publication.

- [ ] **Step 6: Audit the final diff**

Run:

```powershell
git status --short
git diff --stat HEAD~9
git log --oneline --decorate -10
```

Confirm:

- no private engineering K file is staged;
- no unrelated existing browser/VTK modification is staged;
- all new K fixtures contain only the four allowed keyword lines;
- the old 3:1 and Q1 implementation was not behaviorally changed.

- [ ] **Step 7: Commit Stage A documentation**

```powershell
git add README.md docs/architecture.md docs/implementation.md CHANGELOG.md
git commit -m "docs(refinement): describe bounded 2:1 capability"
```

## Stage A Completion Review

After Task 9:

1. Request a code review focused on silent selection growth, public API
   ambiguity, tolerance false positives, error atomicity, and K fixture privacy.
2. Fix every Critical or Important finding with a failing regression first.
3. Re-run `npm run typecheck`, `npm test`, and `git diff --check`.
4. Push `codex/h1-2to1-refinement` only after the review is clean.
5. Start a separate Stage B spec/plan execution for multi-command provenance;
   do not extend this Stage A branch diff ad hoc while review is in progress.
