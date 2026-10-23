# Native Concentric Circular Workbench

The existing parameter panel now includes `同心圆环实体 · 原生2:1` as an explicit
native extension, after the original seven GUI_tg menu families. This is not a
claim that the recovered GUI61 circular-solid branch had these same controls.
Its geometry and numerical contracts are the native
[coupled concentric generator](CONCENTRIC_CIRCULAR_GENERATOR.md).

## Entry And Scope

- HTTP: `examples/browser/refinement-gui.html` through a local project server.
- Offline: `examples/browser/hexrefine-standalone.html`; no HTTP/MATLAB/TG runtime
  is needed. Rebuild with `npm run build` then `npm run standalone:build`.
- Open the existing GUI61 parameter panel and choose the labelled native menu.
  Radius, full height, circular-core radius, radius/arc/axial counts, mapping
  join, regular radial spacing, fraction and numerical limits are explicit.
- Each ring has structured inner/outer radius and optional outer regular radial
  spacing fields. The + / - buttons append/remove only the last ring. They do
  not adjust outer geometry, core or seeds to make incompatible data pass.
- Cheap live planning displays the actual full/core counts, angular sequence,
  axial spacings and browser limit. It does not allocate a preview motif while
  the user types. Generation and engineering quality checks still own acceptance.

The default is R16/H8/core-R4 with two rings: 9,284 nodes, 8,256 H8s, minimum
SJ about0.214614. Four-ring R48/H16/core-R16 import produces60,000 nodes and
56,648 H8s with minimum SJ0.293169. A generated preview is the complete model,
not an unnamed clipped or scaled proxy. The existing camera exposes quarter
cut faces and the existing read-only snapshot/export policy remains in force.

## Browser Limit And Streaming Handoff

This mode has a200,000-full-cell browser limit, enforced before native mesh
allocation by `generateGui61Concentric`. The native CLI's larger streaming
budget is unchanged. A user cannot silently lift the browser limit by editing
`elementLimit`; that option remains the requested full-model budget.

`导出流式参数` validates and saves the current unmodified parameters as:

The JSON has `schemaVersion: 1` and the complete unmodified `parameters` object,
without a GUI kind discriminator.
It can be passed to:

```sh
node scripts/generate-concentric-circle.mjs concentric-stream-request.json NEW_OUTPUT_DIRECTORY
```

The GUI can import either the versioned GUI request/archive or the version1
streaming CLI request (without a GUI kind). CLI import adds only the explicit
GUI discriminator and preserves all parameters, including absent optional
values. Parameter/report archives retain the export checkbox and replay the
same request. Successful snapshots also retain `concentric-stream-request.json`.

The R200/H600 request with3,310,500 H8s is measured and exported unchanged but
is refused for browser materialization. No440-MiB duplicate K was generated
to validate this handoff. Large streaming downloads inside the browser and
production job progress/cancellation are NOT implemented here.

## Failure Safety And Interfaces

Public helpers: `planGui61Concentric`, `resizeGui61ConcentricRings`,
`gui61ConcentricStreamRequest`, `GUI_CONCENTRIC_ELEMENT_LIMIT`.

The dispatcher reuses `generateConcentricCircularMesh`, standard mesh-only K
export, coordinate/connectivity readback and existing HTTP worker execution.
Offline mode runs the same embedded kernel inline. Ring operations are bounded
to1..8 entries; supported count/geometry/motif budgets still apply.

Drafts are isolated per algorithm. Editing parameters or failing generation
disables stale K/report exports. Optional values may remain absent; the GUI
does not insert unrelated demonstration defaults during import. K checkbox
state is independent of geometry generation. Transfer to ordinary refinement
invalidates snapshot downloads; it does not guarantee every subsequent
imported-Hex refinement request will be supported.

No fake3:1, independent anisotropic ratios or tilted-quarter switch is exposed
in this fixed2:1 mode. Existing recovered circle/cylinder controls remain
separate and unchanged. K remains NODE+SOLID with PID1 and no solver cards.

## Verification (2026-10-23)

- Final integrated suite1034/1034 passes, no skips:8 new helper/archive tests
  plus the new default dispatcher regression. Prior tests remain enabled.
- Actual HTTP worker ran8 times, including legacy-circle smoke and failure
  paths; offline default output is byte-identical to the HTTP output.
- Parameter edits, ring changes, menu drafts, archive replay/export checkbox,
  requested SJ rejection and full-model browser rejection are exercised.
- Desktop1440x1000 and mobile390x844 render without horizontal overflow; all
  generated canvases are nonblank and no page script errors are observed.
- Four downloaded full K files are imported with PyDYNA, all H8 corner/eight
  Gauss values and volumes are independently recomputed, and connectivity is
  exactly compared with the previously audited native cases. Browser/Node trig
  can differ by a few ulps; maximum coordinate differences are reported, not
  hidden by changing the production precision or1e-8 volume tolerance.
- Four actual LS-PrePost views and GUI screenshots accompany the local HTML.

Evidence (not bundled in Git):
`F:/PythonWoking/temp/20261023-concentric-gui-integration/REVIEW.html`.
Browser plugin was not available; shared local Chromium/Playwright APIs were
used for reproducible downloads, file imports, worker and mobile assertions.

Still separate: mixed/3:1 rings, automatic widths/seeds, nonperiodic heights,
tilt/offset, browser-scale streaming and arbitrary imported weak-balance/O-grid
template installation. This GUI addition is not completion of all GUI61 options.
