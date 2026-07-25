# HexRefine Implementation Notes

This document describes the implementation choices behind the public features.

## Mesh and Connectivity

`Mesh` is deliberately small:

- `nodes` is an array of coordinate arrays.
- `elements` is an array of 1-based node id arrays.
- `kind` is optional and can be inferred from element arity.

The 1-based connectivity is an intentional compatibility choice. It matches the
historical notebook representation and downstream INP files. Internal helpers
convert with `nodeId - 1` when accessing `mesh.nodes`.

## Local Templates

Templates live in `src/templates.ts`. They are pure functions:

```ts
type LocalRefinementFactory = (vertices: Point[]) => LocalRefinement;
```

Each template receives parent vertices in a known orientation and returns local
nodes/elements. The local refinement object uses node ids relative to its own
node list. Replacement code offsets those ids when inserting the refinement into
a larger mesh or session.

The template source string and numeric template codes are used by reports and
visualization:

```txt
Q1 selected     -> 9
Q1 edge         -> 4
Q1 corner       -> 5
H1 selected     -> 27
H1 face         -> 13
H1 edge/corner  -> 5 or derived transition blocks
unchanged       -> 0
```

## Topology Alignment

Transition templates need a stable orientation. `src/topology.ts` provides:

- Boundary lists for Q1 edges and H1 faces.
- Boundary keys based on sorted node ids.
- Quad edge/corner alignment helpers.
- Hex face/edge alignment helpers based on known H1 permutations.

The planner uses these helpers to rotate a neighbor element into the expected
template orientation before instantiating a transition.

## Replacement Planning

`src/refinement-planner.ts` chooses the replacement strategy.

For Q1:

1. Selected elements get `refineQ1To3x3`.
2. Boundary neighbors get edge or corner transition templates.

For H1:

1. Selected elements get `refineHexTo27Hex`.
2. Face neighbors get `refineHexTo13Hex`.
3. Edge transition replacements are added when required by the boundary
   pattern.

When `hexRefinementRatio` is `2`, `src/two-to-one.ts` dispatches between two
strategies:

1. A full-section path uses a uniform eight-Hex core and globally compatible
   orientations of the TrueGrid-derived seven-Hex transition column.
2. A local-box path infers a mapped logical lattice and performs three
   Owen/Shih directional sweeps. Canonical pattern 1, 2, 4, and uniform-8
   templates are rotated over all proper cube orientations. Nodes are shared
   by their source topological entity, and original-parent lineage is carried
   through every temporary sweep so the selected core finishes with exactly
   eight children rather than being recursively over-refined.

The local sweep also supports compatible non-rectangular logical-cell unions.
Each logical cell line is split into contiguous runs so separate runs keep
their own alternating mark phase. Isolated three-corner signatures are handled
by paired pattern-3 halves across their shared marked face. Their temporary
edge and face nodes are merged at the prescribed barycenters after each pass,
which seals the pillow interface without expanding an L-shaped core to its
bounding box. Unpaired pattern-3 signatures are rejected atomically.

Repeated local `2:1` refinement does not run the planner over the mixed active
mesh. The session layer extracts active, refinable cells at the selected level
and excludes all existing transition-role cells. Preview and execution call the
same session patch planner. Before any hierarchy mutation, the planned
replacements are mapped back onto the complete active mesh and passed through
`checkNoHangingNodes`; a nested core that reaches an existing transition layer
is therefore rejected without creating nodes, cells, or undo history.

The planner returns classified replacements with:

- Parent element id.
- Local refinement result.
- Role.
- Template code.

Preview APIs use the same planner but do not mutate or replace the mesh.

## Hex Quality Validation

`src/hex-quality.ts` provides the runtime H1 checks used by hierarchical
refinement:

- Signed Hex volume integrated with a `2 x 2 x 2` Gauss rule.
- Minimum oriented corner scaled Jacobian over all eight Hex corners.
- Relative parent/child volume error.

The session validates the complete requested operation before adding nodes,
children, or undo history. A non-positive parent or child scaled Jacobian, or a
volume error above the runtime tolerance, rejects the operation atomically.
`refineSessionCell` and `refineSessionCells` require each parent's children to
conserve that parent's volume.

Planned transition patches use a deliberately different volume scope. Paired
and other multi-parent macros can move an internal partition across the
original parent boundary, so an individual replacement record need not preserve
its parent's volume. Every generated child must still remain positively
oriented, while signed volume is conserved across the complete patch. This
distinction is required by the paired pattern-3 construction and must not be
replaced with per-parent macro validation.

The shared patch summary contains the audited parent and generated-child
counts, minimum oriented corner scaled Jacobians, oriented parent/child volumes,
and relative volume error. `RefinementPreview`, `RefinementResult`, and
successful H1 `RefinementSessionCommand` objects expose this same structure.
The browser report displays it before and after execution, while command replay
collects successful summaries for the offline job manifest. These are
operation-local metrics; the runtime does not rescan every unchanged Hex in a
large output mesh for each preview.

## Replacing Elements and Merging Nodes

`replaceElements` in `src/mesh.ts` builds a flat output mesh:

1. Copy all elements that are not replaced.
2. Append refinement nodes for each replacement.
3. Append replacement elements with node-id offsets.
4. Merge coincident nodes within a tolerance.

Node merging uses spatial buckets for performance. Exact-coordinate hits are
fast-pathed, and nearby buckets are searched when tolerance is non-zero.

The default merge tolerance is based on the minimum element edge length for
flat refinement, or on command-script grid bounds for replay.

## Conformance Checking

`checkNoHangingNodes` in `src/conformance.ts` checks unmatched element
boundaries:

1. Collect all Q1 edges or H1 faces.
2. Remove exact matched interior boundaries.
3. Bucket the remaining boundaries by bounding box.
4. Compare nearby unmatched pairs for overlap.
5. Report node-on-edge, node-on-face, overlapping-edge, or overlapping-face
   issues.

This check is intentionally geometric rather than tied to a specific refinement
history, which lets it validate arbitrary meshes.

## Hex Regularization

Hex regularization lives in `src/regularization.ts`.

The goal is to turn a candidate set into a complete uvw block. The code first
tries topology-based lattice inference from shared faces. If local Hex corner
orientations differ, it next estimates three independent logical directions
from shared-face neighbor-center vectors and propagates integer cell indices.
Only then does it fall back to coordinate-center lattice inference. The
direction-based path keeps repeated refinement available on moderately warped
mapped cores whose physical coordinates do not form separable x/y/z ranks.
The regularizer then crops the candidate bounding range until it finds a
complete block.

The regularizer also supports a boundary-shell mode. In this mode the crop only
requires the outer one-layer uvw shell to be complete in the candidate set; the
interior may be sparse or arranged differently. The returned regularized block
still contains the full rectangular uvw range, so the bounded core can be
refined with the normal 3x3x3 Hex template while the shell supplies the required
transition buffer. If one side of the range lies on the model boundary, that
side is not considered a required transition shell because there is no outside
neighbor to conform to. Session refine preparation enables this mode by default
for Hex refinement because GUI/offline box selections often describe the
transition layer more reliably than the exact interior.

Session refine preparation uses a two-stage strategy for stability. It first
checks the original selection as a possible uvw shell, which supports hollow,
partially-filled, or solid support selections. For example, a regular 3x3x3 Hex
selection can act as one support layer and refine only the middle cell. If the
original selection cannot form the required shell, the prep layer grows one
topology layer outward and regularizes again.

Session regularization in `src/session-regularization.ts` works at the active
cell level. It can restrict candidates to same-level refinable cells and expand
by a local topology layer before block cropping.

For disconnected selections, the shared session-selection prep layer splits the
selection into face-connected components and regularizes each component
independently. Components from the same refinement level reuse one
`HexSessionRegularizationDomain`, so the same-level submesh is not rebuilt for
every island. `regularization.ts` also caches successful topology lattice
inference per mesh object with a `WeakMap`, which avoids repeated face-topology
indexing when several components share one domain.

## Hierarchical Sessions

`RefinementSession` stores:

- The base mesh.
- A global session node list.
- A map of `CellId` to cell records.
- The active leaf cell ids.
- Undo and redo stacks.

Refining a cell does not delete the parent. Instead, the parent is hidden and
child cells are created with ids such as `e1/1`, `e1/2`, and so on. Undo hides
children and reactivates parents; redo reverses that operation.

`buildActiveMeshWithMap` flattens active leaves into a normal `Mesh` and
returns remap tables:

- Active element id to session cell id.
- Session cell id to active element id.
- Session node id to active node id.
- Active node id to one or more session node ids.
- Optional active element ids by node id.

These maps are central to GUI selection, set export, command replay, and local
conformance checks.

## Export and Set Remapping

`buildRefinementSessionExport` builds a merged active mesh and remaps named
session sets to active output ids. Missing inactive cell/node ids are reported
instead of silently ignored.

`meshToLegacyVtk` writes:

- Points.
- Cells.
- VTK cell types.
- Optional cell scalar arrays.

`refinementSessionExportToInp` writes:

- Nodes.
- Elements.
- Node sets.
- Element sets.
- Solid sections and elastic materials for cell sets.

Large offline jobs should prefer the iterator-based export APIs:

- `iterateLegacyVtkLines`
- `iteratePreparedInpLines`
- `buildNativeSessionExportPlan`
- `iterateNativeSessionVtkLines`
- `iterateNativeSessionInpLines`

The offline scripts write these iterators directly to file streams, so VTK/INP
text is not assembled as one large JavaScript string. The native Q4/H8 export
path can now use `buildNativeSessionExportPlan`, which merges session nodes,
remaps sets, and streams active cell connectivity without materializing the full
flat `elements` array. Higher-order or triangle export still performs a
conversion step before streaming lines.

`scripts/run-offline-auto.mjs` is a small launcher: it reads system RAM,
reserves memory for the OS, then starts Node.js with an automatic
`--max-old-space-size` before running the dense replay. Set
`HEXREFINE_OFFLINE_MAX_OLD_SPACE_MB` to override the auto choice for special
runs.

The next deeper optimization target is fully incremental export setup:
reusing dirty-region merge/remap state across repeated exports instead of
rebuilding the native export plan from the whole active session each time.

## Command Replay

`src/command-script.ts` replays browser command logs. The replay state stores a
session, merge tolerance, sets, materials, warnings, and replay count.

Supported command groups include:

- Grid generation.
- Refinement patches.
- Element deletion.
- Undo and redo.
- Node/cell set save.
- Material assignment.
- Set deletion.

Selection and preview commands are accepted as no-ops because they affect GUI
state but not the final mesh/session state.

Replay returns the effective merge tolerance so callers can rebuild the active
mesh with the same tolerance used during replay.

## Browser Worker Boundary

The browser workbench keeps interactive drawing on the main thread and moves
heavier operations into `examples/browser/refinement-worker.js`:

- Hanging-node checks.
- VTK export.
- INP export.

Worker requests pass plain structured data: mesh/session snapshots, merge
tolerance, sets, materials, and optional cell metadata. The worker returns text
exports or conformance reports.

## Performance Notes

The code avoids global all-pairs checks in hot paths:

- Node merging uses spatial buckets.
- Conformance compares only nearby unmatched boundaries.
- Active mesh builds can merge directly while traversing active cells.
- Browser rendering caches projected elements, surface faces, topology
  neighbors, and slice information.
- Browser coordinate-box selection uses a cached uniform-grid spatial index over
  element centers for large meshes.
- Browser screen rectangle/circle selection caches a projected-center spatial
  index for the current view, so repeated picks in the same view avoid full
  reprojection.
- Disconnected Hex regularization reuses the same-level session domain and
  cached topology lattice across components.
- Offline VTK/INP file writers stream line iterators instead of creating one
  monolithic export string.
- Native Q4/H8 offline export can stream directly from active session cells
  without building a complete flat element array.
- The offline launcher auto-selects Node heap size from system RAM before
  starting dense replay jobs.

The project currently prioritizes deterministic behavior and clear reports over
aggressive memory optimization.

Likely next bottlenecks:

- `buildActiveMeshWithMap` when a GUI operation still forces global remapping.
- Regularization topology maps for very large active meshes when a new domain
  must be built after each mesh-changing operation.
- Export setup before streaming, especially high-order conversion and repeated
  native export plan rebuilds.
- Node/element selection when the query covers most of the model, where any
  index still returns nearly all ids.

## Important Invariants

- Element ids exposed by flat APIs are 1-based and refer to current mesh order.
- Session `CellId` values are stable across active mesh rebuilds.
- Only active, non-transition, same-level cells can be refined together in a
  session patch.
- Export set remapping should report missing inactive ids.
- GUI command replay must rebuild the same mesh state without relying on stale
  browser state.
