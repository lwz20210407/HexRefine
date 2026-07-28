# HexRefine Architecture

HexRefine is organized as a small TypeScript mesh-refinement library plus a
browser workbench. The runtime entry is `src/index.ts`, which re-exports the
kernel, refinement, session, replay, and export APIs.

## Goals

- Keep the mesh kernel independent from UI code.
- Keep refinement logic deterministic and testable from Node.
- Preserve enough hierarchy to support undo/redo, command replay, and named set
  remapping.
- Export flat conforming meshes for downstream tools.

## Layer Map

```txt
Browser workbench
  examples/browser/refinement-gui.html
  examples/browser/refinement-worker.js

Public API
  src/index.ts

Workflow APIs
  src/refinement-ops.ts
  src/hex-core.ts
  src/refinement-session.ts
  src/command-script.ts
  src/export.ts

Planning and algorithms
  src/refinement-planner.ts
  src/transitions.ts
  src/regularization.ts
  src/session-regularization.ts
  src/two-to-one.ts
  src/two-to-one-templates.ts
  src/two-to-one-sweep.ts
  src/two-to-one-sweep-templates.ts
  src/conformance.ts
  src/hex-quality.ts

Mesh kernel
  src/types.ts
  src/grid.ts
  src/mesh.ts
  src/topology.ts
  src/templates.ts
  src/mesh-selection.ts
  src/distance.ts
  src/vector.ts
```

## Data Model

The core data shape is `Mesh`:

```ts
interface Mesh {
  nodes: Point[];
  elements: Element[];
  kind?: "Q1" | "H1";
}
```

Nodes are stored in normal JavaScript array order. Element connectivity uses
1-based node ids. This mirrors legacy notebook data and INP-style files, and it
keeps exported connectivity easy to inspect.

`Q1` elements are four-node quads. `H1` elements are eight-node hexes. Most
functions infer `kind` from the first element when `mesh.kind` is missing.

## Refinement Flow

Flat refinement follows this path:

```mermaid
flowchart LR
  A["Input Mesh"] --> B["Select Element Ids"]
  B --> C["Regularize Hex Selection"]
  C --> D["Build Replacement Plan"]
  D --> E["Instantiate Local Templates"]
  E --> F["Replace Parent Elements"]
  F --> G["Merge Coincident Nodes"]
  G --> H["Conformance Check / Export"]
```

The replacement plan classifies each parent as:

- `selected`: the user-selected refinement core.
- `face-transition`: a hex face transition template.
- `edge-transition`: a Q1 edge transition or hex edge transition template.
- `corner-transition`: a Q1 corner transition template.
- `unchanged`: existing cells copied into the output mesh.

H1 `2:1` dispatch has two native strategies. Full-section and even O-grid
interfaces use the globally oriented seven-Hex transition-column field in
`two-to-one.ts`. Rectangular local cores on mapped Hex lattices use
`two-to-one-sweep.ts`: logical node planes are marked in three directions,
regular Owen templates are applied with topological node sharing, and temporary
children retain original-parent lineage before they are regrouped into normal
replacement records.

The public 2:1 capability path is:

```text
selection
  -> direct two-to-one solver
  -> bounded compensation planner
  -> classified replacement plan
  -> conformance and quality gates
  -> flat result or atomic session command
```

The direct solver is always attempted first. Compensation may change the
effective selected parent set or rebuild one authorized transition component,
but it never bypasses the final conformance and quality gates.

For repeated local `2:1`, `refinement-session.ts` builds a planning mesh from
same-level active cells that are not transition cells. `previewSessionPatch`
and `refineSessionPatch` share this plan. The plan is remapped to the complete
active mesh and checked for hanging nodes before the hierarchy is mutated, so a
new local shell cannot silently cut through an older transition layer.

H1 session plans also pass through `hex-quality.ts` before mutation. Every
parent and generated child must have a positive oriented corner scaled
Jacobian. Ordinary replacement batches conserve signed volume for each parent.
Transition macros may redistribute volume among their participating parents,
so patch plans use aggregate signed-volume conservation across the complete
macro instead. Preview and execution share these checks because they share the
same immutable patch plan. The resulting quality summary is attached to the
preview and successful session command; command replay carries successful H1
summaries into offline export manifests without rescanning the complete output
mesh.

## Session Flow

`RefinementSession` keeps a hierarchy of cells instead of immediately discarding
parent/child relationships. This is the path used by the browser workbench:

```mermaid
flowchart LR
  A["Base Mesh"] --> B["createRefinementSession"]
  B --> C["buildActiveMeshWithMap"]
  C --> D["refineSessionPatch"]
  D --> E["Hide Parent Cells"]
  E --> F["Create Child Cells"]
  F --> G["Undo / Redo Stack"]
  F --> H["Active Mesh + Set Remap"]
  H --> I["VTK / INP Export"]
```

The active mesh is a flat view of active leaf cells. The build result also
contains maps between active element ids, session cell ids, output node ids, and
session node ids. Those maps are what make named cell/node sets stable across
export.

## Browser Workbench

The GUI is intentionally a thin client around the same runtime modules:

- `refinement-gui.html` imports `../../dist/index.js`.
- `refinement-worker.js` imports `../../dist/index.js` and handles heavier
  conformance/export work off the UI thread.
- The GUI records command scripts that can be replayed through
  `replayHexRefineCommandScript`.

The browser path does not use any project-external source code.

## Build Artifacts

`npm run build` compiles `src/**/*.ts` into `dist/`. Browser examples and tests
import the generated `dist/index.js`, so a build step is required before runtime
tests or manual browser use.
