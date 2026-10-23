# HexRefine

HexRefine is a standalone TypeScript project for conforming Q1/Hex local
refinement. It provides a small mesh kernel, local refinement templates,
automatic transition layers, no-hanging-node validation, hierarchical refinement
sessions, VTK/INP export, command replay, and a browser workbench.

Use this project when the goal is to refine structured quadrilateral or
hexahedral meshes locally while keeping the exported mesh conforming.

Online workbench:

```txt
https://hl-ren.github.io/HexRefine/
```

## Refinement Examples

| Q1 local refinement | H1 local refinement |
| --- | --- |
| <img src="./Q1-refine3.png" alt="Q1 local refinement example" width="420"> | <img src="./H1-refine2.png" alt="H1 local refinement example" width="420"> |

## Status

The current focus is a practical, inspectable mesh workflow that is easy to
customize for research, engineering experiments, and selected project work:

- Browser GUI for workflow design, coarse-model inspection, selection, sets,
  materials, and export setup.
- Shared TypeScript refinement kernel used by both GUI and offline replay.
- Offline replay for larger meshes so heavy generation/export work can run
  outside the browser.
- WebGL surface/edge cache for million-cell visualization experiments.
- Spatial indexes for large GUI selection and stream-based offline VTK/INP
  writing to reduce interactive and export memory pressure.
- Selectable Hex refinement ratios: the established `3:1` transition and an
  experimental `2:1` (`4:2`) transition with a uniform `1 -> 8` core.
- Automatic `2:1` completion of a local structured-Hex pick to an even,
  level-closed transverse section for box, preview, and GUI session workflows.
- Optional local-box `2:1` mode for mapped structured Hex meshes. It keeps the
  core local and closes face, edge, and corner fronts through three Owen/Shih
  directional sweeps. Paired pattern-3 templates support L-shaped and other
  compatible concave unions, and disjoint cores can be refined together.
- Optional logical `U`, `V`, or `W` transition-axis override in the API, command
  script, and browser GUI; `Auto` remains the default.
- Repeated `2:1` refinement inside a sufficiently deep, same-level refined core;
  each level again uses one uniform core pass and one transition-parent layer.
  When a nested local patch reaches an existing transition shell, the session
  discovers the affected component and computes its replayable history closure.
  One or more refinement commands can be reversed, rebuilt, and replayed on a
  sparse overlay when every affected downstream command stays wholly inside that
  component. The exact irregular core is tried first; minimum logical-block
  completion is only a parity fallback. Preview, execution, and command replay
  share the transactional planner; undo and redo apply the recorded compound
  delta without replanning. Set `rebuildExistingTransitions: false` to keep
  strict atomic rejection instead.
- Atomic H1 session quality gates reject inverted children and volume loss
  before nodes, cells, or undo history are mutated. Single-parent refinements
  conserve volume per parent; multi-parent transition macros conserve the
  aggregate patch volume while every generated Hex retains a positive oriented
  corner scaled Jacobian.
- H1 preview and execution reports expose the audited parent/child counts,
  minimum oriented corner scaled Jacobians, oriented volumes, and relative
  volume error for the planned patch. Browser reports and offline job manifests
  retain the same shared-kernel summary.
- Mesh-only LS-DYNA keyword export containing `*NODE` and `*ELEMENT_SOLID`.
- Bounded native [structured circular-core mapping](docs/MAPPED_CIRCULAR_CORE.md):
  explicit radius/arc seeds, conforming quarter/half/full sections, uniform H8
  extrusion, geometric sets, angle/edge quality and a versioned JSON Node CLI.
  This is a filled-core primitive, not the complete concentric-ring generator
  or a new GUI menu. Mapped edge sizes are reported, not forced to be equal.
- Native [coupled concentric circular bands](docs/CONCENTRIC_CIRCULAR_GENERATOR.md):
  explicit multiple circular 2:1 bands coarsen angular and axial counts together,
  preserve the mapped core, and support quarter/half/full periodic streaming K
  export. Includes quality gates and a 3.31-million-H8 real-case validation;
  has a [bounded browser parameter panel](docs/GUI61_CONCENTRIC_WORKBENCH.md)
  and exact streaming-request export;
  does not imply mixed-ratio rings or arbitrary imported-mesh installation.
- Opt-in [bounded concentric ring-width planning](docs/CONCENTRIC_WIDTH_PLANNER.md):
  freezes the core, seeds and inner interfaces, screens finite widths against
  explicit SJ/edge limits, and fully audits accepted native plans. Reports all
  changes and search limits; not a global optimum or automatic seed optimizer.
- [Concentric seed proposals](docs/CONCENTRIC_SEED_PLANNER.md) resolve nominal-size
  targets into explicit compatible counts without hidden coarsening or budget changes.
  The [GUI width workflow](docs/GUI61_WIDTH_PLANNING.md) shows proposals before apply;
  [Python native jobs](docs/PYTHON_NATIVE_JOBS.md) provide real-process progress,
  cancellation and completed-output publication using the same Node kernel.
- [Existing-mesh O-grid macro fields](docs/OGRID_NATIVE_MACRO_FIELD.md) install
  complete hierarchical parent macros with exact tensor cores, bounded axial shell
  expansion and unchanged declared far field. An [ID-preserving K CLI](docs/OGRID_MACRO_FIELD_CLI.md)
  and [complete real-ROI verification](docs/OGRID_MACRO_FIELD_VALIDATION.md) are included.
  This is a bounded axial face-field path, not arbitrary3D CinoLib WB installation.
- LS-DYNA keyword import accepts comma/space records and standard fixed-field
  `*NODE` records whose blank coordinate fields represent zero. An anonymized
  real-deck O-grid gauge slab is exercised by the 2:1 regression suite.

### 2:1 capability outcomes

A 2:1 request is either direct, compensated, or rejected. HexRefine may add a
bounded face-connected parent layer or rebuild the colliding transition
component when the operation remains conforming. Every compensation is reported
in `twoToOne.actions`.

Stage B shell rebuilding permits one or more replayable refinement commands to
form a component-local history closure. Every downstream command in that closure
must be wholly inside the affected component. Missing recipes, ambiguous
selection remapping, or commands that cross the component reject the complete
transaction with `TWO_TO_ONE_HISTORY_CONFLICT`. Rejected previews and executions
leave the session unchanged; successful transactions preserve far-field cell
IDs and connectivity.

HexRefine does not promise a conforming 2:1 result for every arbitrary Hex
topology. Unsupported parity, valence, ambiguous geometry, history, or quality
conditions throw `TwoToOnePlanningError` before the mesh or session is changed.
Arbitrary cavity filling and splitting a replayed downstream command across
components are unsupported. The untouched-support fallback may preserve other
disconnected outputs owned by its root command; once downstream history replay
is required, every included command must remain inside the affected component.

Preview consumers must narrow on `planMode`. `"per-parent"` previews expose an
honest replacement entry for each changed parent; `"aggregate"` previews report
only exact transaction-level counts and quality because a shell rebuild has no
truthful one-template-per-input decomposition.

LS-DYNA export remains mesh-only: generated K files contain only `*NODE` and
`*ELEMENT_SOLID` data between `*KEYWORD` and `*END`. Materials, sections, loads,
contacts, and other analysis keywords remain the caller's responsibility.

Large-mesh workflows are still an active engineering area. The GUI can guide
large cases, but for production-size exports the recommended path is GUI first,
then offline replay.

History transactions use sparse overlays and component-scoped planning builds
for both untouched-support and replayed transition shells. Preview counts are
computed from active-leaf deltas. The first valid baseline is checked globally
and spatially indexed. Subsequent history checks query neighbors of changed
geometry and verify local conformance plus retained interface ownership; a
successful commit publishes the updated index for the new revision. Inputs
whose near-coincident interfaces require repair retain a full final audit.
Context discovery and public active-mesh preparation still have global costs.
Certificate reuse assumes callers honor the read-only session contract rather
than mutating session arrays or cells directly.

The experimental `2:1` path supports two strategies. `section` mode uses
TrueGrid-derived seven-Hex columns for one-direction, level-closed transition
sections, including even O-grid sections with trivalent lines. `local` mode
uses regular Owen templates plus a paired pattern-3 construction to close all
directions around mapped-lattice cores. Rectangular, L-shaped, and disjoint
logical-cell selections are covered by regression tests. Highly irregular
selections that leave an unpaired pattern-3 face, refinement across existing
transition components whose command closure crosses into the far field,
irregular mixed-level domains, and automatic odd-section topology completion
are not yet part of the TypeScript runtime.
Repeated local refinement reconstructs a same-level, non-transition planning
domain from the hierarchy. A shared-face center-direction fallback recovers
logical axes when earlier sweeps changed local corner orientation, including
moderately warped mapped cores.
Transition-shell rebuilding uses an aggregate preview because its compound
coarsen/rebuild/refine transaction has no honest one-template-per-input
decomposition. The final element count, changed-input count, and net quality
summary are exact; the per-parent `plan` is empty in this mode.
Structured section completion selects a logical transition axis whose other two
grid dimensions are even. The GUI `2:1 axis` control and the
`hexTransitionAxis: 0 | 1 | 2` option can override that choice; unsupported
transverse odd sections fail with an explicit diagnostic instead of producing a
nonconforming mesh.

The current 2:1 scope is intentionally limited to structured or recoverable
mapped lattices and even full-section O-grid interfaces. Arbitrary unstructured
Hex topology, odd-section topology compensation, arbitrary cavity remeshing,
and splitting downstream commands that cross an affected history component
remain outside the supported scope.

Set `hexTwoToOneSelectionMode: "local"` or choose `2:1 domain -> Local box` in
the browser to retain a local core. Disable regularization when an explicit
non-rectangular logical-cell selection must be preserved. The default remains
`"section"` for compatibility.

## Copyright And Version

Copyright (c) 2026 Huilong Ren.

软件按“现状”提供，不附带任何明示或暗示担保。

## Documentation

- [Native transition meshes](docs/TRANSITION_BANDS.md): straight/annular bands,
  same-stage hybrid blocks, 2:1/3:1 rectangular rings, axial tubes and Hex extrusion.
- [Transition mesh workbench](docs/TRANSITION_MESH_WORKBENCH.md): five-mode
  GUI, count checks, trial/apply, parameter replay and K/INP downloads.
- [TransitionMesh source assessment and Abaqus 2020 experiments](docs/TRANSITIONMESH_ASSESSMENT.md):
  implementation comparison, verified cases, provenance and remaining gaps.
- [Reinforced concrete completion](docs/GUI61_RC_COMPLETION.md): original controls,
  paired-band source defect, mixed beam/solid audits and verified set replay.
- [Other open-source transition implementations](docs/OPEN_SOURCE_TRANSITION_SURVEY.md):
  13 deduplicated GitHub/GitLab/Gitee projects, code evidence and reuse boundaries.
- [Bounded Hex corner closure and multilevel refinement](docs/HEX_TRANSITION_CLOSURE.md):
  opt-in 2:1/3:1 completion, explicit support redistribution, target levels and mesh-only K CLI.
- [Conservative mapped faces and complete two-level shells](docs/MAPPED_TRANSITION_CONSERVATION.md):
  opt-in warped-face flux conservation, full-section 31-Hex parent macros,
  actual TC4 verification and explicit remaining weak-balance/corner limits.

- [Architecture](docs/architecture.md): module boundaries and data flow
- [Features](docs/features.md): supported workflows and user-facing behavior
- [Mesh Import](docs/import-mesh.md): supported JSON and VTK starting-mesh formats
- [Implementation](docs/implementation.md): algorithms, invariants, and tradeoffs
- [Edition Strategy](docs/edition-strategy.md): community vs private/custom edition plan
- [Positioning](docs/positioning.md): how it compares with professional preprocessors
- [GitHub Pages](docs/github-pages.md): deploy the browser workbench as a static site
- [Windows Desktop](docs/windows-desktop.md): build a portable Windows test app
- [macOS Desktop](docs/macos-desktop.md): build portable macOS test apps

## Project Layout

```txt
hexrefine/
  src/       source code
  dist/      generated runtime build output
  examples/ examples, browser workbench, and generated meshes
  docs/     project documents
  test/      node:test coverage
```

## Quick Start

```bash
npm install
npm test
```

Build only:

```bash
npm run build
```

Type-check without emitting files:

```bash
npm run typecheck
```

Generate example VTK files:

```bash
npm run examples:vtk
```

Create a release bundle:

```bash
npm run release
```

See [Release Guide](RELEASE.md) for generated artifacts and static web hosting.
See [GitHub Pages Deployment](docs/github-pages.md) for publishing the browser
workbench to GitHub Pages.

Create a portable Windows desktop test app:

```bash
npm run desktop:win
```

Create portable macOS desktop test apps:

```bash
npm run desktop:mac
```

## Runtime Entry

The compiled browser/runtime entry is generated by the project build:

```ts
import { createHexUnitCubeMesh, createRefinementSession } from "./dist/index.js";
```

Minimal mesh refinement example:

```ts
import {
  checkNoHangingNodes,
  createHexUnitCubeMesh,
  refineByBoxWithReport
} from "./dist/index.js";

const mesh = createHexUnitCubeMesh(10, 10, 10);
const result = refineByBoxWithReport(mesh, {
  min: [0.25, 0.25, 0.25],
  max: [0.75, 0.75, 0.75],
  hexRefinementRatio: 2
});

console.log(result.summary);
console.log(checkNoHangingNodes(result.mesh).ok);
```

Browser workbench:

```txt
examples/browser/hexrefine.html
```

Offline replay for larger cases:

```bash
npm run build
node scripts/run-offline-auto.mjs workflow.json --nx 128 --ny 64 --nz 64 --selection replay --vtk output/refined.vtk
```

`run-offline-auto.mjs` auto-selects a Node.js heap limit from the machine RAM
before launching the dense replay. Override it only when needed:

```bash
HEXREFINE_OFFLINE_MAX_OLD_SPACE_MB=48g node scripts/run-offline-auto.mjs workflow.json --nx 256 --ny 128 --nz 128 --selection replay --vtk output/refined.vtk
```

This mode is meant for a lighter workflow:

- Use the GUI to explore the workflow on a coarse mesh.
- Export the recorded command script.
- Replay the same workflow offline with denser `nx/ny/nz`.
- Let the browser guide the process, but keep the heavy export run out of the GUI.

Offline replay is strongest when the script contains mesh-space selection
commands such as `select.coordinate-box`, `select.all`, `select.invert`,
`select.clear`, `view.hide-selected`, and `view.show-hidden`. The GUI also
records screen-rectangle and screen-circle selections with mesh-space replay
metadata when possible, which improves coverage for density-upscaled offline
jobs.

Current generated output:

```txt
examples/output/
```

## Type Check

```bash
npm run typecheck
```

## Build

```bash
npm run build
```

## Test

```bash
npm test
```

## Install

```bash
npm install
```

The project declares its own TypeScript toolchain, so it can be developed and
tested outside the workspace it was originally split from.

## Core Concepts

- A `Mesh` stores points in array order and element connectivity as 1-based
  node ids.
- `Q1` means a four-node quadrilateral element.
- `H1` means an eight-node hexahedral element.
- A refinement can return a flat mesh result, or it can be applied to a
  hierarchical `RefinementSession` that preserves parent/child ids, undo/redo,
  and set remapping.
- Transition templates are inserted around selected elements so adjacent
  coarse/fine regions do not create hanging nodes.
- Export helpers write legacy VTK, Abaqus-style INP, and mesh-only LS-DYNA
  keyword text.
