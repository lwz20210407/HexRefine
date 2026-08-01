# H1 2:1 Stage C1 Component Overlay Design

**Date:** 2026-08-01

**Status:** Proposed

**Scope:** Replace full-session cloning in replayable H1 2:1 history
transactions with a component-scoped copy-on-write overlay. Preserve the
public `RefinementSession` API and every Stage B correctness guarantee.

## Context

Stage B can rebuild a replayable history closure when a nested local H1 2:1
request reaches an existing transition shell. The implementation is correct
and atomic, but it reaches that result by cloning the complete session several
times:

- preliminary downstream-history reversal;
- the main history transaction;
- the current-request planning checkpoint;
- the untouched-shell compatibility path.

`cloneRefinementSession()` deep-copies the base mesh, every node, every cell,
the active-leaf indexes, and both command stacks. The copied amount therefore
scales with the complete model even when the affected transition component is
small. Preview pays the same cost as execution and then discards the clone.

Stage B already computes the affected history closure and preserves far-field
cell ids and connectivity. Stage C1 makes the storage and validation work obey
that same component boundary.

## Goals

1. After one baseline certification, make history-transaction preview memory
   proportional to the affected component, referenced nodes, one boundary
   ring, and affected history.
2. Make history-transaction execution mutate only the verified delta.
3. Preserve preview/execution topology, numbering, and diagnostic identity.
4. Preserve exact undo, redo, replay, compensation, quality, and conformance
   behavior from Stage B.
5. Preserve far-field cell object identity as well as ids and connectivity.
6. Keep the public `RefinementSession` interface and command-script format
   backward compatible.
7. Prove locality with structural counters rather than fragile wall-clock
   thresholds.

## Non-Goals

- arbitrary all-Hex cavity filling;
- new odd-parity or odd-valence transition templates;
- automatic splitting of a historical command across components;
- public persistent-session or transaction APIs;
- asynchronous or multi-writer transaction isolation;
- detecting arbitrary external mutation performed by casting away the public
  read-only session contract outside the affected context;
- changing the established 3:1 implementation;
- changing LS-DYNA mesh-only export semantics;
- replacing every ordinary refinement path with an overlay in this stage.

## Invariants

Stage C1 must retain these invariants:

1. Core parents are refined exactly once to eight children.
2. Transition cells are not reclassified as uniform core cells.
3. Unsupported topology is rejected before the real session changes.
4. Every compensation remains reported and bounded.
5. Every successful transaction preserves signed volume and positive oriented
   corner scaled Jacobians.
6. Every successful transaction is conforming.
7. Undo restores the exact pre-command active leaves.
8. Redo restores the exact post-command active leaves.
9. Replay reconstructs equivalent recipes, connectivity, roles, and numbering.
10. Far-field cells outside the authorized component retain ids, connectivity,
    and object identity.
11. Failure leaves nodes, cells, active indexes, history stacks, counters, and
    revision unchanged.

## Considered Approaches

### Chosen: Explicit Sparse State Access

Introduce an internal read/write state-access interface. A direct adapter
operates on a real session; a copy-on-write adapter stores only overrides and
additions.

Advantages:

- mutation sites are explicit and reviewable;
- cell values are cloned only at the first write;
- node ids remain deterministic through an append-only overlay tail;
- no public API change is required;
- structural counters can prove that far-field objects were not copied.

Cost:

- low-level mutation and build helpers must stop casting a read-only session
  directly to `MutableRefinementSession`;
- the history path needs a component-local active-mesh builder before it can
  eliminate all full-model work.

### Rejected: One Large SessionView Rewrite

Changing every planner, builder, quality audit, conformance audit, and ordinary
refinement path to a new public session abstraction would produce a cleaner
end state in one step, but it combines too many ownership boundaries in one
review. A regression would be difficult to localize.

### Rejected: Mutation Journal Beside the Session

Recording imperative undo actions while running the existing mutable code
looks smaller initially, but it creates a second undo/redo/replay mechanism.
It also makes read-after-write behavior and derived indexes difficult to prove.

### Rejected: JavaScript Proxy Collections

Proxying arrays, maps, cells, and numeric node indexes would reduce call-site
changes, but array methods, iteration, structured clone, identity checks, and
runtime tampering would become implicit. Stage C1 uses explicit accessors and
ordinary collections instead.

## Architecture

### State Access Boundary

The internal transaction path consumes a state facade rather than mutating a
`RefinementSession` through unchecked casts.

```ts
interface RefinementSessionStateReader {
  readonly baseSession: RefinementSession;
  readonly revision: number;
  readonly kind: ElementKind;
  readonly nodeCount: number;
  readonly cellCount: number;
  readonly activeLeafCount: number;
  readonly nextCommandId: number;
  readonly nextCellOrdinal: number;
  readonly sortedActiveLeafIdsDirty: boolean;

  node(nodeId: number): Point | undefined;
  cell(cellId: CellId): RefinementSessionCell | undefined;
  hasActiveLeaf(cellId: CellId): boolean;
  activeLeafIds(): Iterable<CellId>;
  activeOwnersByNodeKey(key: string): readonly CellId[];
  undoCommands(): Iterable<RefinementSessionCommand>;
  redoCommands(): Iterable<RefinementSessionCommand>;
}

interface RefinementSessionStateWriter
  extends RefinementSessionStateReader {
  mutableCell(cellId: CellId): MutableRefinementSessionCell;
  appendNode(point: Point): number;
  setCell(cell: MutableRefinementSessionCell): void;
  addActiveLeaf(cellId: CellId): void;
  removeActiveLeaf(cellId: CellId): void;
  allocateCellOrdinal(): number;
  appendUndoCommand(command: RefinementSessionCommand): void;
  clearRedoCommands(): void;
  setNextCommandId(value: number): void;
}
```

The exact names may change during implementation, but the separation between
read access and explicit mutation is mandatory.

Active-leaf membership and its derived state form one invariant boundary.
Every real-session or overlay writer must reject unknown cell ids, validate
all referenced nodes before an actual membership change, and update active
membership, per-node owner indexes, and sorted-active-leaf cache invalidation
as one operation. Adding an already active cell or removing a known inactive
cell is an idempotent no-op; neither case may dirty caches or duplicate owner
ids. A real-session change sets `sortedActiveLeafIdsDirty`; an overlay records
the equivalent sparse owner overrides and its guarded commit sets the real
session dirty exactly when the effective active membership changes.

Ordinal allocation also preserves the current runtime compatibility rule. The
effective starting value is
`session.nextCellOrdinal ?? session.cells.size + 1`, including when an overlay
is created from a legacy-shaped session that lacks the counter.

### Direct Adapter

`DirectRefinementSessionState` wraps the current real session. It centralizes
the mutable casts that are currently spread across `refinement-session.ts`.
Ordinary refinement behavior remains unchanged while the low-level helpers are
migrated.

The direct adapter is not a clone. It is used only after public validation or
when committing an already verified overlay delta.

The direct adapter receives the exact active-node-key function as an injected
callback from `refinement-session.ts`. The state module may import session
types with `import type`, but it must not import a runtime helper back from
`refinement-session.ts`; that would create a cycle. If the key function is
later shared by import instead, it must move to a neutral leaf internal module
used by both files.

### Copy-on-Write Overlay

`RefinementSessionOverlay` references one immutable base session and stores:

```ts
interface RefinementSessionOverlayStorage {
  readonly cellOverrides: Map<CellId, MutableRefinementSessionCell>;
  readonly createdCells: Map<CellId, MutableRefinementSessionCell>;
  readonly appendedNodes: Point[];
  readonly activeLeafAdditions: Set<CellId>;
  readonly activeLeafRemovals: Set<CellId>;
  readonly ownerOverridesByNodeKey: Map<string, CellId[]>;
  readonly historyEdit: RefinementSessionHistoryEdit;
  nextCommandId: number;
  nextCellOrdinal: number;
  sortedActiveLeafIdsDirty: boolean;
}

interface RefinementSessionHistoryEdit {
  readonly appendedUndoCommands: readonly RefinementSessionCommand[];
  readonly removedUndoCommandIds: ReadonlySet<string>;
  readonly appendedRedoCommands: readonly RefinementSessionCommand[];
  readonly removedRedoCommandIds: ReadonlySet<string>;
  readonly clearRedo: boolean;
}
```

Read order is deterministic:

1. created cell;
2. overridden base cell;
3. base-session cell.

`mutableCell(id)` clones a base cell on first write and returns the same
override on later writes. Pure reads never clone cells.

New node ids are
`baseSession.nodes.length + appendedNodes.length + 1`. Existing node points are
never copied. Created elements may reference both base node ids and appended
node ids.

Active-leaf membership is resolved as:

```text
added => active
removed => inactive
otherwise => base membership
```

Adding and removing the same id cancels the opposite delta. Per-node owner
indexes are copied only for keys touched by an active-leaf change. Overlay
active methods obey the same validation and idempotence rules as the direct
adapter. Guarded commit installs membership, prepared owner lists, and sorted
cache invalidation once; it must not also invoke direct active methods and
thereby apply the owner transition twice.

The command objects are deeply immutable already. The overlay stores history
edits and reads unchanged commands directly from the base stack. It neither
copies the complete stack arrays nor clones recipes, quality summaries, or
capability reports that it never changes. The current Stage B history reversal
changes cell activity but not stack membership, so its preview requires no
stack copy.

### Forked Checkpoints

The Stage B implementation creates preliminary and current-request planning
checkpoints. Stage C1 supports an overlay fork whose base can be either a real
session or another frozen overlay snapshot.

Forking copies only the parent's changed-key collections, not the far field.
The initial implementation may flatten the parent delta into the child because
the copied amount is bounded by the affected component. It must not materialize
the complete base session.

### Structural Statistics

The overlay records internal counters:

```ts
interface RefinementSessionOverlayStats {
  readonly copiedBaseCellCount: number;
  readonly createdCellCount: number;
  readonly appendedNodeCount: number;
  readonly activeLeafAdditionCount: number;
  readonly activeLeafRemovalCount: number;
  readonly copiedNodeOwnerKeyCount: number;
  readonly referencedBaseCellCount: number;
  readonly referencedBaseNodeCount: number;
}
```

These counters are internal and imported directly by tests. They are not added
to the root runtime API or user-facing preview.

## Transition Rebuild Context

The component-local planner uses an immutable context:

```ts
interface TransitionRebuildContext {
  readonly selectedCellIds: readonly CellId[];
  readonly supportCellIds: readonly CellId[];
  readonly ancestorCellIds: readonly CellId[];
  readonly boundaryCellIds: readonly CellId[];
  readonly activeComponentCellIds: readonly CellId[];
  readonly referencedNodeIds: readonly number[];
  readonly supportCommandIds: readonly string[];
  readonly downstreamCommandIds: readonly string[];
  readonly boundaryFaces: readonly ImmutableBoundaryFacePartition[];
  readonly faceResolution: SessionFaceResolution;
}
```

The context contains the affected active component plus exactly one geometric
face-neighbor boundary ring. It does not include unrelated active cells from a
historical command. If one command crosses the authorized component and cannot
be split without changing its replay semantics, Stage C1 preserves the Stage B
`TWO_TO_ONE_HISTORY_CONFLICT` rejection.

## Component-Local Active Mesh

The current `resolveSessionPatchOptions()` creates or validates a full active
mesh before history collision recovery. Stage C1 separates global option
resolution from local history planning.

Option resolution is split into:

1. a side-effect-free scalar snapshot that validates getters and normalizes
   compensation without building a mesh;
2. geometry-resolution acquisition from a trusted caller build, a matching
   conformance certificate, or a one-time baseline scan;
3. route-specific active-mesh construction.

For an eligible nested local 2:1 request, a lightweight collision preflight
uses the selected level, active-leaf/node-key index, and certified face
tolerance to determine whether an existing transition component may be
involved. A positive preflight enters component discovery directly. It does
not first run the full direct planner merely to obtain the same collision
error. Ambiguous duplicate-node geometry escalates to the certified geometric
face matcher and retains the existing fail-closed behavior.

Ordinary direct requests may continue to use the full active build. C1's
locality promise applies to the replayable history-transaction route, not every
refinement operation in the library.

The local builder:

1. receives the `TransitionRebuildContext` cell ids;
2. resolves only their referenced nodes;
3. preserves deterministic element ordering by session cell ordinal;
4. merges duplicate geometry with the same effective tolerance;
5. retains local cell-to-element and node mappings;
6. includes immutable boundary-face partitions from the one-ring cells.

The global active build remains valid for ordinary direct refinement. History
rebuild preview no longer requires a second full build. When the caller already
provides a trusted full active build, the context may reuse its immutable
geometry-resolution metadata but must not copy its far-field mesh arrays.

Preview counts are computed from the source active count and the canceled,
verified active-leaf delta:

```text
output = input - active-leaf-removals + active-leaf-additions
```

No full final mesh is built merely to calculate a count.

## Incremental Conformance Certificate

Stage B performs a full final `checkNoHangingNodes()` audit. Stage C1 preserves
that guarantee through a baseline certificate plus an incremental proof.

### Baseline

A private `WeakMap<RefinementSession, ConformanceCertificate>` caches a
certificate for one session revision and one effective tolerance.

If no matching certificate exists, the first history preview performs one full
baseline conformance audit. A failing baseline rejects the operation without
creating a certificate. This first certification is intentionally O(total
active mesh); the component-local guarantee applies to later transactions that
inherit a valid certificate. A successful commit derives the next-revision
certificate from the previous baseline plus its local proof, so normal forward
editing does not repeat the global scan.

### Incremental Proof

After applying the delta to an overlay, the checker builds only:

- changed active leaves;
- all active cells sharing a geometric face with them;
- the immutable boundary ring from the context.

It verifies local manifold ownership, exact or tolerance-aware face
partitions, hanging entities, and every interface between the changed
component and unchanged boundary cells. Because the far field is unchanged and
the baseline is certified, a passing local proof certifies the complete final
state.

### Invalidation

The certificate key includes:

- real session identity;
- revision;
- effective merge tolerance;
- geometry resolution;
- references to the node, cell, and active-leaf collections.

Undo, redo, replay, external state replacement, or a different tolerance makes
the certificate unusable. Successful commit publishes a new certificate only
after every delta operation completes.

The certificate relies on the documented read-only `RefinementSession`
contract. Official mutation APIs always advance revision. Runtime code that
casts away read-only types and mutates an unrelated far-field point without a
revision change is outside this contract. Touched and boundary cells and nodes
are still fingerprinted before commit, and collection identity, length, or
trusted-build guard changes force rejection or full recertification.

## Planning Flow

### Preview

1. Validate the request and normalize scalar options exactly once.
2. Resolve geometry metadata from a caller build, certificate, or one-time
   baseline scan.
3. Route ordinary requests to the direct planner; route eligible existing-shell
   collisions directly to component discovery.
4. Create `TransitionRebuildContext` for the history route.
5. Obtain or create the baseline conformance certificate.
6. Create the overlay.
7. Reverse affected downstream and support commands in the overlay.
8. Rebuild the support shell and replay downstream commands.
9. Apply the current request in the overlay.
10. Run quality, history-equivalence, boundary, and incremental conformance
   audits.
11. Produce the aggregate preview and discard the overlay.

### Execution

Execution performs the same planning steps and receives a verified overlay
delta. It then:

1. verifies that base session identity and revision still match;
2. verifies fingerprints of every overridden base cell and referenced base
   node;
3. verifies next command and cell ordinal counters;
4. prepares immutable command and index updates;
5. commits the delta without invoking a planner;
6. increments revision once;
7. publishes the new conformance certificate.

Preview and execution are separate public calls and may plan separately, but
the same deterministic engine and delta representation serve both. Execution
never commits a delta produced for an older revision.

## Delta Commit

All operations that can reasonably fail occur before commit. The commit phase
uses the existing real collections and applies only bounded updates:

1. append prepared node point arrays;
2. replace overridden cells and insert created cells;
3. install the prepared active-leaf membership, touched node-owner keys, and
   `sortedActiveLeafIdsDirty` state as one atomic active-state update;
4. apply the prepared history edit, reusing unaffected immutable command
   objects and appending the compound command without cloning the full stack;
5. update counters;
6. increment revision;
7. publish the new certificate.

No planner, geometry matcher, quality calculation, user callback, property
getter, or formatter runs during commit.

The implementation validates that the session uses the project's ordinary
Map, Set, and Array storage before applying an overlay. A structurally forged
session with hostile collection methods is rejected before commit rather than
risk a partial mutation.

## Error Handling

- Overlay creation errors leave the base untouched.
- Planning, history, geometry, quality, or conformance errors discard the
  overlay.
- A stale revision or changed touched-cell fingerprint raises
  `TWO_TO_ONE_HISTORY_CONFLICT`.
- Unsupported topology retains its existing structured error code.
- Compensation-limit failures retain all attempted actions.
- A baseline conformance failure reports `TWO_TO_ONE_CONFORMANCE` and does not
  certify the session.

Stage C1 must not convert programming errors into planning diagnostics. The
existing error-boundary rules remain in force.

## File Ownership

Expected new modules:

- `src/refinement-session-state-internal.ts`
  - direct state adapter;
  - shared read/write contracts;
  - explicit mutable-cell and append-node primitives.
- `src/refinement-session-overlay-internal.ts`
  - sparse overlay and fork support;
  - delta snapshot and structural stats;
  - guarded commit.
- `src/refinement-conformance-certificate-internal.ts`
  - baseline cache;
  - component-local conformance proof.

Expected modifications:

- `src/refinement-session.ts`
  - route history transactions through state access;
  - construct component rebuild contexts;
  - remove full-session clones from the history path;
  - compute aggregate counts from the delta.
- `src/refinement-history.ts`
  - expose immutable closure data needed by the context without changing the
    public API.
- `test/refinement-history.test.mjs`
  - overlay data-structure and closure tests.
- `test/refinement-kernel-suite.test.mjs`
  - end-to-end preview, execution, conformance, and locality tests.
- `docs/implementation.md`, `README.md`, and `CHANGELOG.md`
  - document component-scoped preview/execution and the unchanged capability
    boundary.

## Delivery Phases

### C1a: Sparse Overlay Foundation

- introduce state-reader/state-writer contracts;
- implement direct and overlay adapters;
- implement overlay fork, delta snapshot, and stats;
- add isolated tests for read precedence, first-write cloning, node ids,
  active-leaf cancellation, and stale-base rejection;
- do not change the public history path yet.

### C1b: History Transaction Migration

- migrate command reversal, shell rebuilding, replay, and current-request
  application to the state writer;
- use overlays for preliminary and main transaction checkpoints;
- preserve full final mesh validation temporarily;
- prove exact output equivalence against Stage B fixtures;
- remove `cloneRefinementSession()` calls from history preview/execution.

### C1c: Component-Local Build and Counts

- introduce `TransitionRebuildContext`;
- build planning and final audit meshes from the component plus boundary ring;
- derive output count from the delta;
- add structural far-field scaling tests.

### C1d: Incremental Conformance Certificate

- add one-time baseline certification;
- replace the temporary full final audit with local proof plus cached baseline;
- test certificate invalidation on refine, undo, redo, replay, tolerance change,
  and collection replacement;
- record structural memory counters for two far-field sizes.

Each phase must keep the complete test suite green and receive a separate
reviewable commit group.

## Tests

### Overlay Unit Tests

- base reads create no overrides;
- first cell write clones exactly one base cell;
- repeated writes reuse the override;
- created cells shadow no base cell;
- appended node ids are deterministic across forks;
- add/remove active-leaf deltas cancel correctly;
- only touched node-owner keys are copied;
- untouched command objects retain identity;
- fork cost depends on parent delta, not base size;
- stale revision and touched-cell changes reject commit.

### History Equivalence

- one untouched support command;
- multiple support roots in one connected component;
- partially consumed shell with replayable downstream commands;
- three nested levels;
- repeated undo/undo/redo/redo;
- command replay from serialized recipes;
- all existing Stage B rejection cases;
- preview and execution produce equivalent aggregate summary, capability
  report, quality summary, active leaves, connectivity, and numbering.

### Locality

For the same affected component embedded in at least two structured far-field
sizes:

- copied base cell count is identical;
- appended node and created cell counts are identical;
- copied owner-key count is identical;
- far-field cell object identity survives execution;
- preview does not change any base collection reference;
- execution reads no unrelated far-field cell after the context is complete.

### Conformance Certificate

- conforming baseline plus conforming local change succeeds;
- nonconforming baseline is rejected;
- a hanging interface inside the component is rejected;
- a hanging interface across the boundary ring is rejected;
- a far-field revision change invalidates the certificate;
- a merge-tolerance change invalidates the certificate;
- successful local proof publishes the next-revision certificate;
- failed local proof publishes nothing.

### Atomicity

Snapshot and compare after every injected failure point:

- nodes and node points;
- cells and cell object references;
- active-leaf ids;
- node-owner index;
- undo/redo stacks and command object references;
- next ids and revision;
- named enumerable extra properties;
- conformance-certificate cache.

## Acceptance Criteria

Stage C1 is complete when:

1. the full test and type-check suite passes;
2. browser and standalone builds pass;
3. history preview/execution no longer call `cloneRefinementSession()`;
4. fixed local work has constant overlay structural counts as far-field size
   grows;
5. preview changes no base-session data or object identity;
6. execution changes only cells, nodes, indexes, and commands represented by
   the verified delta;
7. all Stage B undo, redo, replay, compensation, far-field, quality, and
   conformance tests remain green;
8. output ids, roles, templates, connectivity, and quality summaries remain
   deterministic;
9. unsupported history and topology remain atomic structured rejections;
10. no Proxy, proprietary runtime, Python helper, or public API break is
    introduced.

## Follow-Up

After C1 ships, later Stage C contributions may add:

- command splitting where one replay recipe crosses independently editable
  components;
- capability classification for additional recoverable unstructured inputs;
- audited odd-valence or parity templates when a verified construction exists.

Those changes are independent of the overlay storage architecture and must not
be smuggled into C1.
