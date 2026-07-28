# Changelog

## Unreleased

Private/custom performance edition.

- Added explicit direct/compensated/rejected H1 2:1 planning outcomes.
- Added bounded one-layer selection compensation and structured planning errors.
- Made aggregate shell-rebuild previews unambiguous.
- Added tolerance-aware geometric interface discovery for imported duplicate
  nodes.
- Added tensile, compression O-grid, and double-shear mesh-only K regressions.
- Added repeated local H1 `2:1` refinement inside same-level uniform cores,
  including warped mapped cores with differing child corner orientations.
- Added a shared session patch planner for preview and execution, plus an
  atomic full-mesh conformance gate before nested `2:1` hierarchy mutation.
- Added exact command replay, undo/redo, and cell/node set-remap regression
  coverage for second-level local `2:1` refinement.
- Added transactional rebuilding for a nested local `2:1` patch that reaches
  one untouched existing transition shell. Only the connected support
  component and directly colliding transition parents are promoted; logical
  block completion is a parity fallback rather than the default. The rebuild
  is committed with the new level as one replayable undo command, with an
  aggregate preview and net before/after quality audit. Affine and lightly
  warped mapped-block collisions are covered. Strict rejection remains
  available through `rebuildExistingTransitions: false`.
- Added provenance and one-ring authorization guards for rebuilt support plans,
  structured collision/quality error codes, and a final net-quality transaction
  gate. Negative-orientation Hexes now use the shared per-corner oriented
  Jacobian calculation.
- Added atomic H1 session quality validation for positive oriented corner
  scaled Jacobians and signed-volume conservation before hierarchy mutation.
- Added aggregate volume validation for multi-parent transition macros, while
  preserving per-parent validation for ordinary Hex replacement batches.
- Exposed shared H1 patch-quality summaries through previews, refinement
  results, session commands, browser reports, command replay, and offline job
  manifests.
- Added LS-DYNA fixed-field node import with blank-zero coordinate support.
- Added an anonymized real-deck O-grid gauge-slab 2:1 regression, and strengthened
  the synthetic trivalent O-grid test with volume and scaled-Jacobian checks.
- Added shared-kernel support for disconnected Hex selection regions, with
  per-region uvw regularization before refinement.
- Improved large-mesh GUI rendering with cached WebGL surface/edge paths.
- Added element-center spatial indexes for large coordinate-box and screen
  center selection.
- Improved heavy GUI operations with chunked selection and lean active-mesh
  remaps.
- Improved large export stability with streaming VTK/INP line generation.
- Added native Q4/H8 session-stream export for offline jobs, avoiding full flat
  element-array materialization on the default export path.
- Added an offline launcher that reads system RAM and auto-selects Node.js
  `--max-old-space-size` for dense replay jobs.
- Reused same-level Hex regularization domains and cached topology lattice
  inference across disconnected refinement components.
- Added boundary-shell Hex regularization so a complete one-layer uvw transition
  shell can define the block while interior cells are filled for 3x3x3 core
  refinement.
- Boundary-shell regularization now omits transition-shell requirements on
  model-boundary sides.
- Hex session refine preparation now tries the original selection as a uvw
  shell first, then grows outward by one topology layer only when needed.
- A regular 3x3x3 Hex selection can now act as a transition-support layer and
  refine only the middle cell.
- Added a topology-neighborhood uvw support fallback for folded imported Hex
  blocks, so box selections can keep the user-selected core separate from the
  transition support shell and avoid hanging nodes around folded corners.
- Made Hex uvw regularization use the selected region's same-level connected
  domain instead of every same-level active Hex, so distant refinements no
  longer perturb local uvw boundary inference.
- Reduced successful irregular-refine messages by hiding internal lattice
  fallback diagnostics from user-facing warnings.
- Refine replay now records and reuses explicit transition-support cell ids, so
  GUI and offline command replay follow the same core/support split.
- Added a GUI BC Face overlay for all boundary/unmatched faces and
  hanging-report faces, useful for inspecting internal transition support and
  hanging-node surfaces.
- Added single-cell viewport picking and a continuous Hide Pick mode, so users
  can click cells to select them or keep clicking cells to hide them after
  pressing Hide.
- Added GUI-to-offline workflow helpers for density-upscaled replay.
- Added edition strategy documentation for separating the free community
  baseline from the private/custom performance edition.

## 0.1.0 - 2026-04-21

Initial standalone release.

- Added conforming Q1/Hex local refinement APIs.
- Added Q1 and H1 structured grid generation.
- Added Q1 and H1 local refinement templates.
- Added automatic transition-layer planning.
- Added Hex selection regularization.
- Added hierarchical refinement sessions with undo/redo.
- Added active mesh remapping for cell/node sets.
- Added hanging-node and overlapping-boundary checks.
- Added VTK and INP export.
- Added command-script replay.
- Added browser workbench and worker-based export/check tasks.
- Added standalone package metadata, docs, tests, and release packaging.
