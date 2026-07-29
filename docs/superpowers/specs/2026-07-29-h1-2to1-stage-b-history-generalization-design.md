# H1 2:1 Stage B History Generalization Design

**Status:** Approved direction, design specification

**Branch:** `codex/h1-2to1-stage-b-history`

**Base:** `ac65df7` (`docs(refinement): describe bounded 2:1 capability`)

## Goal

Generalize nested H1 2:1 transition-shell rebuilding from one untouched support
command to a bounded, component-local closure of multiple refinement commands.
The operation must preserve unaffected history and far-field cell identity,
support exact undo/redo/replay, and reject non-local or non-replayable history
before mutating the public session.

Stage B does not add new 2:1 transition templates. It reuses the verified Stage
A template vocabulary and quality/conformance gates.

## Required Stage A.1 Closure

The final Stage A review found four correctness gaps and two fixture/reporting
gaps. Stage B starts only after these are fixed on this branch.

### Compensation Limits Apply to Every Compensation Action

`maxAddedParentLayers` and `maxAddedParentCount` describe the total parent
expansion permitted by compensation. A transition-shell rebuild that promotes
colliding transition parents to the rebuilt core consumes one added parent
layer and the number of unique promoted parents.

Before a shell transaction is committed:

- `maxAddedParentLayers === 0` rejects any non-empty promoted-parent set;
- a promoted-parent count greater than `maxAddedParentCount` rejects;
- the error code is `TWO_TO_ONE_COMPENSATION_LIMIT`;
- the diagnostic contains the attempted shell-rebuild action;
- preview, execution, and replay return equivalent diagnostics;
- the mesh, session, revision, command stacks, nodes, and cells remain unchanged.

### Raw Uniform Refinement Is Not a Successful 2:1 Capability

`hexRefinementRatio: 2` with `includeTransitions: false` remains a supported raw
`1 -> 8` operation for callers that intentionally manage conformity elsewhere.
It must not return a `twoToOne` report because it has not produced or audited a
conforming 2:1 transition.

The operation still returns replacement metadata and quality data. Callers can
run conformance checks explicitly. The public `direct` and `compensated`
statuses remain reserved for conforming 2:1 planning outcomes.

### Node Merge Identity Includes Dimension and Every Coordinate

Every node passed to a merge path is validated before bucket construction:

- the point is a non-empty coordinate array;
- every coordinate is finite;
- exact identity includes point length and every coordinate;
- an exact-key hit still verifies full point equality;
- points of different dimensions never merge;
- unreferenced invalid nodes are rejected instead of bypassing element checks.

Finite higher-dimensional points remain representable because `Point` is a
general coordinate array. Mesh-kind-specific dimensional constraints are not
introduced in this closure.

### Known History Failures Use the Public History Code

Known provenance and replayability checks produce
`TWO_TO_ONE_HISTORY_CONFLICT`, including:

- no unique supporting history can be identified;
- support completion would cross the authorized component;
- a replacement would cross command provenance;
- the support layer is partially modified but has no replay recipe;
- a downstream command affects cells outside the selected history component;
- a recorded selection cannot be remapped after the support rebuild.

Unknown invariant and programming errors continue to propagate unchanged.

### Fixture Assertions Match Their Documentation

The three public LS-DYNA fixture tests assert:

- `result.quality.ok === true`;
- relative volume error is at or below a manifest maximum;
- every selected parent has exactly eight selected-role children;
- the existing Jacobian, conformance, count, keyword, and round-trip checks.

The generator writes the audited maximum-volume-error contract into each
manifest.

### Capability Report Lifetimes

Aggregate shell-rebuild reports keep the existing public fields for Stage B
compatibility, but their semantics are made explicit:

- `originalSelectedCellIds` are active input cells before the transaction;
- `effectiveSelectedCellIds` are active output cells representing the remapped
  user selection;
- `affectedComponentCellIds` contains every input or output cell touched by the
  transaction;
- `preservedFarFieldCellCount` counts original active inputs not hidden by the
  transaction.

Intermediate cells created and hidden inside the transaction are not reported
as the effective selection.

## Scope

Stage B supports a history closure when all of the following are true:

1. The collision belongs to one face-connected transition component.
2. Every command in the closure is a refinement command with a replay recipe.
3. Every affected downstream command is wholly contained in that component.
4. Recorded selections can be remapped to equivalent active cells after earlier
   commands are rebuilt.
5. The rebuilt result passes existing conformance, volume, and positive
   oriented scaled-Jacobian gates.
6. Compensation remains within the configured parent-layer and parent-count
   limits.

Supported histories include:

- one untouched support command, preserving Stage A behavior;
- several commands that refine the same local component in sequence;
- a support shell whose cells were refined by one or more later commands;
- independent commands in other components that remain untouched;
- multiple nested levels when each affected command is replayable.

## Non-Goals

- splitting one historical command into independently replayed subcommands;
- replaying a command that crosses the affected component boundary;
- arbitrary all-Hex cavity remeshing;
- new odd-parity, odd-valence, or unstructured transition templates;
- component-scoped copy-on-write overlays for unrelated editing operations;
- preserving arbitrary external object identity for mutable internal objects;
- migrating inactive named-set members to replacement descendants;
- preserving LS-DYNA analysis keywords in mesh-only export;
- changing the established 3:1 implementation.

These remain Stage C or separate contributions.

## Considered Approaches

### Chosen: Component-Local History Closure and Replay

Build an immutable provenance index, compute the smallest command closure that
contains the collision, simulate reversal in a cloned session, rebuild the
support component, and replay downstream commands from immutable recipes.

Advantages:

- unaffected history and far-field IDs remain stable;
- work is proportional to the affected history component;
- preview and execution can share one planner;
- failure remains atomic;
- the existing session clone and compound-command model can be reused.

Cost:

- commands need replay recipes;
- selection remapping needs a strict geometric and lineage contract;
- closure computation requires explicit cross-component conflict detection.

### Rejected: Replay the Entire Session from the Base Mesh

Replaying every command is conceptually simple but scales with total history,
can renumber unrelated cells, weakens far-field identity guarantees, and makes a
local failure depend on unrelated commands.

### Deferred: Persistent Copy-on-Write Session Overlay

A persistent component overlay is the long-term Stage C architecture. Building
it now would combine history generalization with a session-storage rewrite and
make Stage B difficult to review independently.

## Public Data Model

### Replay Recipe

Every new refinement command stores an immutable versioned recipe:

```ts
export interface RefinementSessionCommandRecipeV1 {
  readonly version: 1;
  readonly selectedCellIds: readonly CellId[];
  readonly selectedCellGeometry: readonly RefinementCellGeometrySnapshot[];
  readonly transitionSupportCellIds: readonly CellId[];
  readonly transitionSupportCellGeometry:
    readonly RefinementCellGeometrySnapshot[];
  readonly options: RefinementSessionReplayOptionsV1;
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
```

`selectedCellIds` preserve the ordinary undo/redo path. Geometry snapshots are
used only when an earlier rebuilt command replaces those IDs.

The options snapshot contains only replay-relevant scalar and array values:

- `includeTransitions`;
- `hexRefinementRatio`;
- `hexTwoToOneSelectionMode`;
- normalized `hexTwoToOneCompensation`;
- `rebuildExistingTransitions`;
- `mergeTolerance`.

It never stores `activeBuild`; a replay builds fresh trusted active metadata.
Selected cells and transition-support cells both have ID and geometry snapshots,
so neither role depends on stale IDs after an earlier command is rebuilt. All
arrays and nested objects are cloned and frozen.

Commands without a recipe remain valid for ordinary undo/redo. They are not
eligible for Stage B history rebuilding and produce
`TWO_TO_ONE_HISTORY_CONFLICT` when encountered in an affected closure.

### Geometry Snapshot

```ts
export interface RefinementCellGeometrySnapshot {
  readonly originalCellId: CellId;
  readonly kind: ElementKind;
  readonly level: number;
  readonly role: RefinementSessionCellRole;
  readonly points: readonly (readonly number[])[];
}
```

The points are stored in element-local order for exact lineage matching and are
also indexed by order-independent corner geometry for imported duplicate-node
cases. Snapshots contain finite coordinates only.

### History Index

An internal `RefinementHistoryIndex` is built from the immutable command stacks
and cell hierarchy:

```ts
interface RefinementHistoryIndex {
  readonly commandById: ReadonlyMap<string, RefinementSessionCommand>;
  readonly creatorCommandIdByCellId: ReadonlyMap<CellId, string>;
  readonly consumerCommandIdsByCellId: ReadonlyMap<CellId, readonly string[]>;
  readonly commandOrdinalById: ReadonlyMap<string, number>;
}
```

The index validates that each created cell has one creator, command ordering is
acyclic, and every hidden/reactivated cell reference exists.

### History Closure

```ts
interface RefinementHistoryClosure {
  readonly supportCommandIds: readonly string[];
  readonly downstreamCommandIds: readonly string[];
  readonly affectedInputCellIds: readonly CellId[];
  readonly preservedCommandIds: readonly string[];
  readonly boundaryCellIds: readonly CellId[];
}
```

Arrays use deterministic command order or stable CellId order.

## History Closure Algorithm

### 1. Validate the Current Request

Run the existing selection, active-build, face-resolution, quality-input, and
collision validation. Normalize compensation once. A direct plan still wins
before any history work.

### 2. Identify the Colliding Component

Starting from the selected cells and their matching transition faces:

1. collect the face-connected active transition component at the selected
   level;
2. collect parent cells that own those transition descendants;
3. record the geometric component boundary;
4. do not cross a face that has no unique exact-first geometric match.

Ambiguity remains `TWO_TO_ONE_AMBIGUOUS_FACE`.

### 3. Seed the Command Closure

For each active or inactive cell in the component:

- include the command that created it;
- include a command that hid, reactivated, or refined it;
- include ancestor commands required to restore the component's parent level.

The earliest included command is the support root. More than one support root is
allowed when their affected cells are connected and wholly inside the same
component.

### 4. Expand Through Downstream Dependencies

Process commands in history order. If an included command created a cell later
consumed by another command, include that consumer. Continue to a fixed point.

For every newly included command:

- every affected active cell must lie inside the component or its recorded
  descendant subtree;
- every selected geometry snapshot must be finite and replayable;
- the command must have a version-supported recipe.

If one command also affects an unrelated component, reject with
`TWO_TO_ONE_HISTORY_CONFLICT`. Stage B never splits a command.

### 5. Enforce Bounds Before Simulation

Estimate the promoted-parent action from the support roots and colliding
transition parents. Enforce compensation layer/count limits before performing
the cloned transaction. The exact rebuilt plan is checked again before commit.

### 6. Reverse the Closure in a Clone

Clone the session and undo included commands in strict reverse history order.
Unrelated later commands are not undone. The reversal API operates on explicit
command records rather than only the top of the public undo stack.

After reversal:

- affected support parents are active;
- unrelated active leaves are unchanged;
- no affected command remains partially active;
- original command records remain available for replay and final undo.

Temporary undo and replay commands exist only in the cloned planning session.
Before commit, its undo stack is reset to the original public undo stack plus
one new compound command; temporary command records never become public.

### 7. Rebuild the Support Component

Use the Stage A direct solver and bounded compensation planner on restored
parents:

- previous uniform core parents remain core;
- only genuinely colliding transition parents are promoted;
- logical block completion stays within the authorized component;
- no old core descendant is refined twice;
- the rebuilt support passes local conformance and patch quality gates.

### 8. Remap and Replay Downstream Commands

For each downstream command in original order:

1. build a fresh trusted active mesh;
2. map each recorded selected geometry snapshot to one unique active cell;
3. prefer original active CellId, then exact geometry, then tolerance-aware
   geometry;
4. require kind, level, role compatibility;
5. call the ordinary refinement planner with the frozen options recipe;
6. audit the result before processing the next command.

Zero or multiple matches produce `TWO_TO_ONE_HISTORY_CONFLICT`. Programming
errors from the ordinary planner are not wrapped.

### 9. Apply the New User Request

Remap the current request onto the replayed component and call the ordinary
refinement path with transition rebuilding disabled. This prevents recursive
history planning.

### 10. Build One Compound Command

Diff the original and cloned sessions to produce one immutable compound command:

- hidden original active cells;
- active created cells;
- reactivated original cells;
- all created cells and nodes;
- exact net quality;
- a compensated 2:1 report;
- an internal history-closure summary used for diagnostics and replay tests.

The original public session is replaced only after every gate succeeds.

## Preview, Execution, Undo, Redo, and Replay

### Shared Planner

Preview and execution call the same internal
`planRefinementSessionHistoryTransaction()` function. The planner returns an
immutable transaction result containing the cloned final session, aggregate
preview, capability report, and compound command.

Preview discards the cloned final session. Execution commits it.

### Undo and Redo

Undoing the compound command restores exactly the session state that existed
before Stage B planning, including the original command closure. Redo reapplies
the recorded cell/node delta without rerunning geometric planning.

Repeated `undo -> redo` cycles must preserve:

- active CellIds;
- connectivity;
- node coordinates;
- command recipes;
- revision progression;
- capability and quality summaries.

### Command-Script Replay

The public command script continues to store the user's requested selection and
options. Replaying the script reconstructs recipes deterministically as commands
execute. A replayed Stage B transaction must produce the same active mesh and
equivalent structured diagnostics, not necessarily the same process-local
object identities.

## Error Model

Known Stage B failures use:

- `TWO_TO_ONE_COMPENSATION_LIMIT` for parent layer/count bounds;
- `TWO_TO_ONE_HISTORY_CONFLICT` for missing recipes, cross-component commands,
  unsupported recipe versions, non-unique selection remapping, or invalid
  command closure;
- existing parity, valence, ambiguous-face, conformance, Jacobian, and volume
  codes for their established domains.

Every structured history diagnostic includes:

- conflicting cells;
- attempted shell-rebuild action when available;
- the affected command IDs in deterministic order;
- a recovery suggestion to reduce the level, expand/remesh the source, or undo
  the crossing command.

Because the existing public diagnostic type has no command field, Stage B adds
an optional `historyCommandIds` array. Serialization, cloning, freezing, browser
worker transfer, and command replay preserve it.

## Atomicity and Far-Field Invariants

The transaction is accepted only if all invariants hold:

1. The source session is byte-for-byte structurally unchanged after preview or
   failure.
2. Every original active far-field cell outside the closure keeps its CellId,
   element connectivity, role, level, and coordinates.
3. No command outside the closure changes.
4. Core parents produce exactly eight selected children at their rebuilt level.
5. Transition cells are never promoted unless listed in the reported
   compensation action.
6. Net oriented volume is conserved.
7. Every generated H1 cell has positive oriented corner scaled Jacobian.
8. `checkNoHangingNodes` passes on the affected component and final active mesh.
9. The committed command is exactly reversible without replanning.

## Testing Strategy

### Stage A.1 Regression Tests

- zero layer/count limits reject a shell rebuild atomically;
- shell rebuild at exactly the configured count succeeds;
- raw `includeTransitions: false` has no 2:1 report and may be nonconforming;
- 2D, 3D, and finite 4D exact keys remain distinct;
- unreferenced NaN/Infinity nodes reject before merging;
- every known provenance failure serializes as
  `TWO_TO_ONE_HISTORY_CONFLICT`;
- fixture tests assert `quality.ok` and manifest volume limits.

### Provenance and Closure Unit Tests

- one creator per cell and deterministic command ordering;
- closure includes all and only dependent commands;
- two independent components produce disjoint closures;
- a command crossing two components rejects;
- missing or unsupported recipes reject;
- recipe snapshots are deeply immutable and structured-clone safe.

### Multi-History Integration Tests

- two nested commands rebuild one partially refined shell;
- three nested levels replay in original order;
- two support commands in one connected component rebuild together;
- an unrelated later command remains active and keeps IDs;
- a later command that crosses the component rejects atomically;
- exact and tolerance-aware geometry remapping both succeed;
- ambiguous remapping rejects with stable diagnostics;
- configured compensation bounds are enforced before commit.

### State-Machine Tests

- preview equals execution summary and does not mutate;
- execution, undo, redo, undo, redo preserve exact active mesh;
- command-script replay matches the final active mesh;
- rejection leaves revision, nodes, cells, undo, and redo unchanged;
- a Stage B compound command can itself support a later nested refinement.

### Existing Regression Gates

- all Stage A direct/compensated/rejected tests;
- all 3:1 and Q1 tests;
- the three mesh-only LS-DYNA fixtures and deterministic generator;
- typecheck, build, standalone parity, and `git diff --check`.

## Delivery Structure

The implementation is split into reviewable commits:

1. Stage A.1 compensation, raw-report, merge validation, history-code, and
   fixture assertion fixes.
2. Immutable command recipe snapshots.
3. Provenance index and history-closure planner.
4. Geometry remapping and cloned reverse/replay transaction.
5. Aggregate preview, compound execution, undo/redo/replay integration.
6. Multi-history and rejection regression matrix.
7. Stage B documentation, changelog, full maturity gate, and remote push.

Each implementation task uses test-first development and receives a
spec-compliance review followed by a quality review.

The first Stage A.1 closure commit is independently reviewable. After it passes
the full Stage A gate, `fork/codex/h1-2to1-refinement` is fast-forwarded to that
commit before Stage B-only commits continue on
`codex/h1-2to1-stage-b-history`.

## Success Criteria

Stage B is complete when:

1. all Stage A.1 review findings are closed;
2. multiple-command and partially refined shell histories succeed when fully
   local and replayable;
3. crossing or non-replayable histories reject with
   `TWO_TO_ONE_HISTORY_CONFLICT`;
4. preview and failure are atomic;
5. undo/redo/replay are exact;
6. far-field CellIds and connectivity are unchanged;
7. every successful mesh passes conformance, volume, and Jacobian gates;
8. all existing 3:1, Q1, browser, and LS-DYNA regressions pass;
9. no proprietary runtime is required;
10. the dedicated Stage B branch is review-clean before it is pushed.
