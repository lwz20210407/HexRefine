# H1 2:1 Capability Closure Design

## Status

Approved design direction for the next HexRefine 2:1 development stage.

This document extends, rather than replaces,
`docs/superpowers/specs/2026-07-23-h1-2to1-refinement-design.md`.
The earlier document defines the complete target architecture. This document
closes the most important gaps found while exercising the implementation on
nested refinements and real LS-DYNA meshes.

## Objective

Make H1 `2:1` (`4:2`) refinement honest, deterministic, and usable beyond the
current synthetic examples:

- perform direct conforming refinement when the selected topology supports it;
- automatically apply bounded, reported compensation when a conforming result
  can be obtained with known templates;
- reject the operation atomically with structured diagnostics when the
  requested topology is unsupported or mathematically incompatible;
- preserve the coarse far field, exact `1 -> 8` core refinement, session
  history, and mesh-only LS-DYNA output.

HexRefine will not promise that every arbitrary Hex mesh can be transformed
into a conforming 2:1 mesh. General all-hexahedral cavity remeshing is outside
this contribution.

## Current Baseline

The branch already provides:

- selectable `2:1` and `3:1` H1 refinement;
- a TrueGrid-derived Seven-Hex 2:1 transition template and deterministic
  template planning;
- exact `1 -> 8` core refinement;
- no-hanging, volume, and oriented scaled-Jacobian validation;
- atomic single-level and nested local refinement;
- transactional rebuilding of one untouched existing 2:1 support shell;
- exact undo, redo, and command replay for that supported nested case;
- mesh-only LS-DYNA K import and export;
- one anonymized real O-grid regression fixture.

The remaining gaps are:

1. aggregate previews use a shape that can be mistaken for per-parent data;
2. transition-shell contact discovery uses exact coordinate keys;
3. compound preview clones and replans the complete session;
4. support-shell rebuilding assumes one untouched support command;
5. automatic compensation is not exposed as an explicit capability contract;
6. engineering coverage is represented by only one compact public K fixture.

## Capability Contract

Every 2:1 planning request has exactly one of three outcomes.

### Direct

The original selected parent set admits a conforming template field without
changing the selection or rebuilding earlier topology.

### Compensated

The original request is not directly feasible, but a conforming result is
available through one or more bounded actions:

- add a minimum number of face-connected parent cells to complete parity or a
  known template signature;
- rebuild only the existing transition component that physically conflicts
  with the new patch;
- use a committed and independently audited local topology template, such as
  a valence-3 absorber, when its complete neighborhood signature matches.

Every action is reported before execution. Compensation may not silently
promote an entire old transition shell to uniform core and may not cross an
unrelated support component.

### Rejected

Planning fails before session mutation when:

- a recoverable logical or mapped topology cannot be established where the
  selected algorithm requires one;
- parity, periodicity, odd-valence, or face-partition constraints have no
  solution in the committed template vocabulary;
- the minimum compensation exceeds configured limits;
- the affected history cannot yet be reconstructed without changing an
  unrelated region;
- conformance, volume, or oriented scaled-Jacobian validation fails;
- geometric face matching is ambiguous within tolerance.

The rejection includes a stable code, the conflicting cells or interfaces,
the attempted compensation actions, and a deterministic corrective suggestion
when one exists.

## Public Types

### Compensation Options

`RefinementSessionPatchOptions` gains:

```ts
export type TwoToOneCompensationMode =
  | "none"
  | "selection"
  | "local-topology";

export interface TwoToOneCompensationOptions {
  mode?: TwoToOneCompensationMode;
  maxAddedParentLayers?: number;
  maxAddedParentCount?: number;
}

export interface RefinementSessionPatchOptions {
  // Existing fields remain.
  hexTwoToOneCompensation?: TwoToOneCompensationOptions;
}
```

Defaults for local 2:1 refinement are:

- `mode: "local-topology"`;
- `maxAddedParentLayers: 1`;
- `maxAddedParentCount:
  max(32, ceil(originalSelectedParentCount * 0.25))`.

`mode: "selection"` permits selection completion but not rebuilding prior
transition topology. `mode: "none"` is strict.

`rebuildExistingTransitions` remains as a deprecated compatibility switch:

- `false` narrows the effective mode to `"none"`;
- `true` does not widen an explicitly stricter
  `hexTwoToOneCompensation.mode`;
- when neither field is present, the defaults above apply.

### Capability Report

Successful previews and commands expose:

```ts
export type TwoToOnePlanningStatus =
  | "direct"
  | "compensated";

export type TwoToOneTopologyClass =
  | "structured"
  | "mapped"
  | "periodic-ogrid"
  | "mixed-level"
  | "unstructured";

export interface TwoToOneCompensationAction {
  kind:
    | "selection-expand"
    | "transition-shell-rebuild"
    | "local-template";
  reason: string;
  addedParentCellIds: CellId[];
  replacedTransitionCellIds: CellId[];
  templateId?: string;
}

export interface TwoToOneCapabilityReport {
  status: TwoToOnePlanningStatus;
  topologyClass: TwoToOneTopologyClass;
  originalSelectedCellIds: CellId[];
  effectiveSelectedCellIds: CellId[];
  actions: TwoToOneCompensationAction[];
  affectedComponentCellIds: CellId[];
  preservedFarFieldCellCount: number;
}
```

Flat mesh APIs use element ids in the corresponding report instead of session
cell ids. The report describes the effective operation; it is not reconstructed
from output counts after execution.

### Structured Rejection

The planner exports one error type:

```ts
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

export interface TwoToOnePlanningDiagnostic {
  conflictingCellIds: CellId[];
  conflictingInterfaces: Array<{
    firstCellId: CellId;
    secondCellId?: CellId;
    faceNodeIds: number[];
  }>;
  attemptedActions: TwoToOneCompensationAction[];
  suggestion?: {
    kind: "expand-selection" | "reduce-level" | "remesh-source";
    axis?: 0 | 1 | 2;
    side?: -1 | 1;
    parentCellIds?: CellId[];
  };
}

export class TwoToOnePlanningError extends Error {
  readonly code: TwoToOnePlanningErrorCode;
  readonly diagnostic: TwoToOnePlanningDiagnostic;
}
```

Existing internal error codes are mapped to this public error at the API
boundary. Rejected operations return no partial mesh and append no session
command.

## Honest Preview Model

`RefinementPreview` becomes a discriminated union. `planMode` is required.

```ts
export interface PerParentRefinementPreview {
  kind: ElementKind;
  planMode: "per-parent";
  plan: RefinementPlanItem[];
  summary: RefinementPlanSummary;
  quality?: HexRefinementQualitySummary;
  regularization?: RegularizedHexSelection;
  twoToOne?: TwoToOneCapabilityReport;
}

export interface AggregateRefinementPlanSummary {
  inputElementCount: number;
  changedInputElementCount: number;
  preservedInputElementCount: number;
  outputElementCount: number;
}

export interface AggregateRefinementPreview {
  kind: ElementKind;
  planMode: "aggregate";
  plan: [];
  summary: AggregateRefinementPlanSummary;
  compound: {
    kind: "transition-shell-rebuild";
  };
  quality?: HexRefinementQualitySummary;
  regularization?: RegularizedHexSelection;
  twoToOne: TwoToOneCapabilityReport;
}

export type RefinementPreview =
  | PerParentRefinementPreview
  | AggregateRefinementPreview;
```

Aggregate previews do not publish zero transition counts, fabricated template
codes, or averaged output counts. Consumers must narrow on `planMode`.

## Geometric Face Identity

Session topology must prefer exact connectivity but tolerate duplicate imported
nodes whose coordinates agree within the requested merge tolerance.

A shared `GeometricFaceIndex` will replace direct use of
`exactActiveMergeKey()` for support-component discovery:

1. Try the canonical sorted four-node-id key.
2. If node ids differ, place face bounding boxes in a tolerance-sized spatial
   bucket index.
3. Compare candidates with a one-to-one four-corner assignment.
4. Require every matched corner distance to be within tolerance.
5. Require compatible face area, plane distance, and normal direction.
6. Reject the interface as ambiguous when more than one candidate passes.

The effective tolerance is:

```ts
max(
  requestedMergeTolerance ?? 0,
  minimumAffectedEdgeLength * 1e-8,
  coordinateScale * Number.EPSILON * 64
)
```

This index is used for:

- selection-to-transition collision detection;
- connected support-component discovery;
- replacement-interface ownership checks;
- local conformance seed discovery.

It is not used to merge output nodes. Node merging remains a separate,
explicit operation.

## Bounded Compensation Planner

### Stage 1: Classify

The planner recovers the best available topology class in this order:

1. exact shared-connectivity structured lattice;
2. geometric shared-face mapped lattice;
3. periodic O-grid with recoverable chord and vertex-valence data;
4. mixed-level session component with complete command provenance;
5. unstructured face-adjacency graph.

Classification does not imply feasibility. It selects the smallest applicable
planning vocabulary.

### Stage 2: Direct Solve

The original selection is planned without modification. If its template field
is conforming and passes quality gates, the status is `"direct"`.

### Stage 3: Selection Compensation

When the direct solver reports a parity, partner, or marked-corner failure:

1. extract the minimal conflicting interfaces from the solver;
2. generate only face-connected one-row or one-column expansions adjacent to
   those interfaces;
3. reject candidates that cross a model boundary illegally, another support
   component, a different refinement level, or the configured limits;
4. solve every remaining candidate;
5. rank successful candidates by:
   - fewest added parents;
   - fewest changed far-field parents;
   - highest minimum predicted/reference Jacobian;
   - lexicographic cell-id order.

The winning selection is deterministic. A logical bounding box is a fallback
candidate, not the default completion rule.

### Stage 4: Local Topology Compensation

If selection expansion is insufficient, the planner may:

- transactionally rebuild the actually colliding existing support component;
- instantiate an audited local defect template whose complete face-partition
  signature matches the neighborhood;
- choose a proper rotation or reflected orientation only when the resulting
  H1 connectivity is reoriented to positive volume.

No free-form cavity filler, unconstrained node insertion, external TrueGrid
runtime, or global remeshing is permitted. TrueGrid and GridPro remain design
and regression references, not runtime dependencies.

Periodic odd loops that cannot be resolved by an audited local template are
rejected with `TWO_TO_ONE_UNSUPPORTED_PARITY`. An odd-valence location without
a matching absorber is rejected with `TWO_TO_ONE_UNSUPPORTED_VALENCE`.

### Stage 5: Validate and Commit

Before mutating a session:

- core parents have exactly eight children at the next level;
- core child nodes lie on the expected half-coordinate support in reference
  space;
- every shared interface has identical partitions;
- no hanging entity exists;
- all H1 elements have eight distinct valid node ids;
- no duplicate or non-manifold H1 element exists;
- oriented volume is conserved;
- minimum oriented corner scaled Jacobian is positive;
- the preserved far-field cell set has unchanged ids and connectivity;
- compensation is within the configured limits.

Only then is one atomic command appended.

## Multi-History Transition Rebuilding

### Provenance

`RefinementSessionCell` gains `createdByCommandId`. Each command gains
`dependencyCommandIds`, containing commands that created cells hidden,
reactivated, or used as rebuilt support by that command.

Existing sessions without explicit provenance are upgraded deterministically
from parent/child membership and command `createdCellIds`.

### Affected History Closure

For a nested selection:

1. discover the geometric collision component;
2. find commands that created active leaves in that component;
3. walk dependencies only until all cells required at the rebuild parent level
   are available;
4. exclude disconnected commands and unaffected cells from every included
   command;
5. restore the minimum parent frontier needed for planning;
6. plan the effective core and shell;
7. encode the complete before/after active-leaf delta in one compound command.

Partially refined old shells are supported only when their active descendants
can be rolled back to one unambiguous parent frontier. Otherwise the operation
is rejected with `TWO_TO_ONE_HISTORY_CONFLICT`; it must not guess.

Undo restores the exact pre-command active leaves. Redo restores the exact
post-command leaves. Replay rebuilds the same provenance and produces identical
mesh connectivity and numbering.

## Component-Scoped Preview

Compound preview must stop cloning and rebuilding the complete session.

`TransitionRebuildContext` contains:

- selected cells;
- affected support cells and their ancestors;
- one geometric face-neighbor boundary ring;
- referenced node ids;
- relevant history commands;
- immutable boundary face partitions.

A copy-on-write `RefinementSessionOverlay` reads untouched data from the base
session and stores only:

- overridden existing cells;
- new cells and nodes;
- active-leaf additions and removals;
- temporary command deltas.

The planner, mesh builder, quality audit, and conformance audit consume a
read-only session view implemented by both the real session and the overlay.
Preview discards the overlay. Execution applies the same verified delta to the
real session.

This preserves preview/execution identity while making preview cost proportional
to the affected component plus one boundary ring, rather than total model size.

## LS-DYNA Regression Fixtures

Three compact, anonymized, mesh-only fixtures will be committed:

- `test/fixtures/lsdyna/tension-gauge-slab.k`;
- `test/fixtures/lsdyna/compression-ogrid-ring.k`;
- `test/fixtures/lsdyna/double-shear-contact-shell.k`.

Each fixture contains only:

```text
*KEYWORD
*NODE
*ELEMENT_SOLID
*END
```

Identifiers, dimensions, units, material data, loads, contacts, parts, and
proprietary metadata are removed. Coordinates are normalized and all elements
use a synthetic part id.

Committed extraction metadata records:

- the retained topological neighborhood;
- normalization and renumbering steps;
- selected parent ids used by the regression;
- expected capability status and compensation actions;
- expected element counts and quality thresholds.

The private full engineering decks remain outside the repository and continue
to serve as local acceptance cases.

## Tests

### Preview and Diagnostics

- every per-parent preview has `planMode: "per-parent"`;
- aggregate preview narrows to the aggregate summary and exposes no role counts;
- direct, compensated, and rejected requests are distinguishable;
- each rejection code preserves session nodes, leaves, and history exactly.

### Geometric Identity

- exact shared node ids;
- duplicate ids with coincident coordinates;
- lightly warped mapped faces within tolerance;
- near but distinct faces outside tolerance;
- ambiguous coincident faces rejected deterministically.

### Compensation

- odd logical selection expanded by the minimum one-row candidate;
- no expansion when the direct solution exists;
- compensation limit rejection;
- no crossing into a disconnected component;
- no whole-shell promotion;
- far-field ids and connectivity unchanged;
- periodic unsupported parity rejected rather than partially meshed;
- audited local absorber accepted only for an exact neighborhood signature.

### History

- two different prior commands contributing to one affected shell;
- partially refined old shell with a unique parent frontier;
- ambiguous mixed-level frontier rejection;
- three nested levels;
- two disjoint historical components;
- repeated undo/redo and command replay identity;
- named-set behavior remains the documented active-cell-id behavior.

### Performance

On a large structured test mesh with a fixed local affected component:

- preview result equals execution result;
- affected-component cell count remains constant as far-field size grows;
- the overlay stores no far-field cell copies;
- runtime and peak memory are recorded for at least two far-field sizes.

The test uses structural counters rather than a fragile wall-clock threshold as
its required assertion.

### K Files

For all three public fixtures:

- import only `*NODE` and `*ELEMENT_SOLID`;
- plan and execute the expected 2:1 operation;
- export mesh-only K;
- re-import and compare coordinates and connectivity;
- verify exact core `1 -> 8`, far-field preservation, zero hanging entities,
  volume conservation, positive Jacobian, and deterministic rerun output.

The three private tensile, compression, and double-shear files receive the same
local audit plus visual review in LS-PrePost.

## Delivery Stages

### Stage A: Contract and Correctness

- discriminated preview union;
- public capability report and structured planning error;
- explicit compensation policy;
- tolerance-aware geometric face identity;
- minimum deterministic selection compensation;
- three anonymized K fixtures.

Stage A is independently shippable and fixes gaps 1, 2, 5, and 6.

### Stage B: History Generalization

- command and cell provenance;
- affected history closure;
- multiple-command and partially refined shell rebuilding;
- exact undo, redo, replay, and rejection tests.

Stage B fixes gap 4 without changing the transition-template vocabulary.

### Stage C: Component-Scoped Planning and Topology Extensions

- copy-on-write session overlay;
- affected-component preview and execution;
- audited odd-valence or parity templates when available;
- capability classification for recoverable O-grid and unstructured inputs;
- explicit rejection for unsupported topology.

Stage C fixes gap 3 and broadens gap 5 only where a verified construction
exists.

Each stage receives its own implementation plan and reviewable commits. Stage C
does not block shipping the correctness and diagnostic improvements from Stage
A or the history support from Stage B.

## Acceptance

The capability-closure work is complete when:

1. all existing tests and type checks pass;
2. the new tests above pass;
3. no unsupported topology silently returns a mesh;
4. every compensation is reported and bounded;
5. core parents are refined exactly once to eight children;
6. transition cells are never counted as uniform core;
7. far-field cells outside the affected component retain ids and connectivity;
8. all successful results pass conformance, volume, and positive-Jacobian gates;
9. rejection is atomic;
10. preview and execution produce the same effective selection and topology;
11. mesh-only K round trips for all three public fixtures;
12. the private tensile, compression, and double-shear cases pass local audits
    and LS-PrePost review;
13. no Python, TrueGrid, GridPro, or proprietary runtime is required.

## Explicit Non-Goals

- guaranteed 2:1 refinement for every arbitrary all-Hex mesh;
- automatic generation of an unconstrained all-Hex cavity fill;
- preserving LS-DYNA analysis keywords in mesh-only export;
- changing the established 3:1 algorithms;
- migrating inactive set members to descendants in this contribution;
- silently accepting zero or negative scaled Jacobian elements;
- silently expanding a local request into global uniform refinement.
