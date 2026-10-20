# Bounded Corner Closure And Multilevel Refinement

2026-10-21. This extends the native H8 planner; it is not an arbitrary-mesh
existence guarantee, a copy of CinoLib's polyhedral schemes, or a new solver.
Final generation requires Node/TypeScript only.
Final checkpoint: **876/876** native tests passed, including type checks and
standalone-runtime parity. New targeted tests also exercise48 frames, three
levels, support redistribution consent and mesh-only CLI PID roundtrip.

## What Changed

- `refineHexWithTransitionClosure`: explicit bounded completion of L, T,
  edge-touching, vertex-touching and concave selections using the existing
  native uniform8/27, face/edge and Owen template vocabulary.
- `classifyHexTransitionBoundary`: shared-node incidence taxonomy for face,
  edge, vertex and compound support. Names describe demands; classification
  alone does not certify that a template is applicable.
- `refineHexMultilevel`: target levels on original base parents, complete
  vertex-neighbor support first, then refine only certified uniform descendants.
  Existing transition cells are never silently treated as uniform tree leaves.
- Ordinary 3:1 flat previews/output now reject a nonconforming result with
  `HexTransitionConformanceError`, instead of returning a positive-volume but
  hanging mesh. `includeTransitions:false` remains an explicit nonconforming
  low-level choice. Session support-containment estimation uses a topology
  plan, not an unfinished mesh preview; final session auditing remains intact.

## Source Ideas Absorbed, Not Misrepresented

[CinoLib's pinned installer](https://github.com/mlivesu/cinolib/blob/151dc5c46309affedadb9b45619cc137fb7326ed/include/cinolib/hex_transition_install.cpp)
prioritizes concave corner/edge dependencies before completing neighboring flat
states. Its schemes are primal polyhedra followed by dual construction, not
ready-made eight-node solids. We reuse the separation of incidence demands,
dependent closure, template installation and full-interface verification, not
its tables as H8 connectivity.

[Element-Saving Method1](https://github.com/CMU-CBML/Element-Saving-Hexahedral-3-Refinement-Templates/blob/7c68119139689682579aab7124f3194bd08ba8a2/src/removeHangingNodeMethod1.cpp)
and [Method4](https://github.com/CMU-CBML/Element-Saving-Hexahedral-3-Refinement-Templates/blob/7c68119139689682579aab7124f3194bd08ba8a2/src/removeHangingNodeMethod4.cpp)
propagate shared-entity demands and rebalance before installing transition
templates. Their ternary-tree probes, black-corner tables and physical-size
thresholds are NOT transplanted to arbitrary old Hex meshes. Our explicit
base-parent levels and uniform-descendant flags implement a conservative,
bounded support closure with native templates. No external C++ library or
proprietary runtime is required; no third-party connection table is copied.

## Single-Level API

```javascript
const result = refineHexWithTransitionClosure(mesh, selectedParentIds, {
  ratio: 2,                    // 2 or 3
  maxAddedParents: 8,           // default 16
  maxAddedLayers: 1,            // vertex-neighbor distance from original selection
  maxStates: 64,
  maxOutputElements: 100000,
  allowedParentIds: allowedSupportIds
});
```

The input must be a conforming H1 mesh with finite coordinates, positive
corner orientation, distinct H8 nodes, no duplicate cells and no nonmanifold
faces. Parent IDs are dense imported array indices, starting at1.

The planner tries the unchanged core first. Unsupported compound stars are
completed within the declared halo; bounded alternatives may be tried. This
is a deterministic finite strategy, **not a minimum-cardinality optimizer**.
There is no bounding-box selection or global-refinement fallback. Unknown
topology, failed quality, exhausted budgets or a protected support boundary
produce explicit failure without modifying the input.

The returned `closure` lists original/effective/added parents, attempts,
affected parents, maximum added layer and preserved far-field count. Each
effective core parent is refined once to8 or27 uniform children. Existing
node-array identity is checked; unchanged cell connectivity remains unchanged.
Coincident but disconnected nodes that require partition-aware identity are
not silently welded by this entry point.

### Paired Support Redistribution

An Owen paired macro may repartition the internal interface between support
parents, including in some non-box Cartesian selections. Thus its logical
parent attribution need not preserve each **support** parent's old volume.
This is distinct from loss of total volume, changed external shape or an
incorrect uniform core. The planner first tries to complete a strict field.

Default behavior rejects such a result. Explicit
`allowSupportRedistribution:true` permits it **only within a single material
support domain**; caller code must enforce material identity. The CLI refuses
this option on a multi-PID input. Every changed support parent's signed and
relative volume difference is reported. Each selected core parent's volume,
positive Jacobians, global volume and frozen patch-interface conformance are
still checked; those tolerances are not relaxed.

The cylinder validation measures a maximum base-support attribution change
about2.08e-5 (fraction, about0.00208%), while the requested core volume and
whole-specimen volume are conserved. Do not use this option to move material
interfaces, contact gaps, solver sets or historical state across boundaries.

## Multilevel API

```javascript
const result = refineHexMultilevel(mesh, [
  {parentId: 365, level: 3}
], {
  ratio: 3,
  maxLevel: 3,
  maxBalancedParents: 150,
  maxOutputElements: 100000,
  allowedBaseParentIds: allowedRootIds
});
```

Target levels are minimum demands on original parents, not inferred from
physical edge lengths. Missing parents start at level0. From deep to shallow,
vertex-neighbor support is raised to the preceding uniform level. Extra
compensation triggers bounded replanning from immutable input, not repeated
cutting of existing transition children. Uniform patches are extracted with
shared node identity and assembled back without global tolerance welding.

The current depth contract is1..4, default maximum3, subject to cell budgets.
The ratio is constant across stages; arbitrary 2/3 changes between levels are
not claimed. Balancing may promote already-requested shallower parents; the
report discloses all effective targets. A most-refined target must remain a
pure tensor core with exactly `ratio**(3*level)` descendants. At three 3:1
levels this is19683 cells, not27 or729. Its support can contain finer cells
than the original shallow demand, but may not invade protected parents.

## Mesh-Only K CLI

`node scripts/refine-hex-closure.mjs request.json NEW_OUTPUT_DIRECTORY`

Request fields: `schemaVersion:1`, `kind:"hex-transition-closure"`, exactly
one of `meshFile`/`mesh`, exactly one of `selection`/`targets`, and `options`.
An explicit single `partId` (default1) or a `parentPartIds` array sets PIDs.
Relative mesh paths resolve against the request file, not the shell cwd.

Output: `mesh.k`, `request.json`, `report.json`, `lineage.json`. K roundtrip
checks connectivity, PIDs and coordinate error. The output directory is
reserved only after generation/validation, and an existing directory is
never overwritten. The output is NODE+ELEMENT_SOLID only. Input solver IDs
may be normalized and output EIDs renumbered; source materials, loads,
contacts and solver sets are NOT migrated. Parent lineage is not a promise
that old material integration-point state can be transferred unchanged.

These new closure/multilevel controls currently have API/CLI interfaces;
they are not yet a new GUI checkbox. Existing GUI algorithms retain their
own supported scope. Three generic closure levels do not automatically mean
GUI61's rectangular/RC partition generator supports three transition bands.

## Verification And Limits

- L/T, face/edge/vertex and concave selections, both ratios, budgets/protection,
  unchanged input/far-field connectivity and exact core descendants.
- All48 cube frames including reflections for a vertex-star closure.
- Two-stage 2:1/3:1 and a three-stage 3:1 reference with19683 finest cells.
- Actual specimen K: cylinder central local 2:1 core and edge-touching pair;
  flat-notched tension local two-stage 3:1. These are **local kernel
  verification within the physical ROI**, not completion of every ROI on
  every specimen or the unresolved arbitrary O-grid ring problem.
- Independent PyDYNA/NumPy checks include oriented corners,8 Gauss points,
  whole/core/support volumes, original exterior-face ancestry, internal free
  faces, duplicate/nonmanifold faces and exact far-field connectivity.
  Support attribution changes are reported separately, not hidden by a
  widened volume tolerance.
- Native LS-PrePost global/local/near-core section views and an HTML ledger.
  `roles.k` is diagnostic coloring only, not a new material/PID analysis deck.

Unresolved: general valence3/5 O-grid macros, CinoLib weak-balance scheme
coverage, arbitrary concave polyhedral domains, mixed-stage ratios, general
multi-material redistribution, full solver-state migration and formal
Jacobian positivity throughout every distorted H8. Unknown cases are refused.

Evidence: `F:/PythonWoking/temp/20261021-hexrefine-corner-closure/`.
`CORNER_MULTILEVEL_REVIEW.html` links six audited models,18 native LSPP views,
actual K/CLI replays and the rejected attempts. All linked artifacts and
mesh hashes are checked; the page was opened on desktop/mobile and every
image loaded successfully. The real notched-tension transition has minimum
SJ about0.149, below its original0.622; it is disclosed as a quality warning,
not automatically accepted by earlier low-SJ engineering decisions.
