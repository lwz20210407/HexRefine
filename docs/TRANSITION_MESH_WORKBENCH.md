# Transition Mesh Workbench

The browser entry is `examples/browser/refinement-gui.html`; the rebuilt
`examples/browser/hexrefine-standalone.html` works offline. `过渡带参数` opens
a separate form while the original seven GUI61 modes retain their contracts.

| Mode | Main controls | Output |
| --- | --- | --- |
| Planar | length/depth, fine count, stage ratios/widths, reversal, rotation | Q1 or straight H8 extrusion |
| Annular | radii, arc extent/phase, counts/stages, inner/outer fine side | Q1 ring/sector or radial-transition hollow H8 body |
| Hybrid | fine/coarse counts, grouped/interleaved/explicit pair/single blocks | Q1 or H8 |
| Rectangular rings | exact inner Nx/Ny, 2:1/3:1, stages, core fill, corner optimization, rotation | Q1 or H8 |
| Axial tube | radii, length, circumferential counts/stages, radial layers, fine end, spatial axis | H8 |

Each mode keeps its own draft. Controls preserve every stage ratio and explicit
width. The rectangle planner shows derived outer dimensions and regular collars.
The 3:1 rectangle corner is regular, so corner-node optimization is disabled.

`检查计数` reports read-only planning with geometryUnchecked. `试生成` runs
the actual native generator and audits in a worker while preserving the active
displayed mesh. `应用试生成网格` displays the validated trial. Parameter edits,
mode changes, reset and accepted imports invalidate it. `生成预览` combines
generation and display. Failed generation cannot export an invalid result.

K and INP downloads use the existing output panel. INP is enabled only when the
snapshot contains it; RC/repair workflows do not gain a lossy exporter. The
GUI61 K checkbox retains its own semantics and does not disable K for these
separate transition modes. Report archives replay in the transition form.
The same strict adapter serves CLI, HTTP worker and offline runtime.

Core/stage/node sets and lineage are saved with the archive/INP. No materials,
loads, physical shell thickness or coupling is inferred. Transfer to ordinary
refinement uses that engine's existing geometry/set semantics, not full-deck
migration.

## Verified Flows

`使用建议计数` explicitly applies template-compatible counts. Geometry and
specified block order are retained. Its change list is displayed; it does not
silently truncate floats or import numeric strings as numbers. A changed count
invalidates the trial just like any other parameter edit.

2026-10-20 evidence:
`F:/PythonWoking/temp/20261020-transitionmesh-assessment/followup_gui`.

- Five default modes generated and downloaded K/INP.
- Three-stage mixed-ratio solid, explicit hybrid order, filled 3:1 ring with
  collars, oblique axial sector and reversed annular sector generated.
- Invalid width sum failed and disabled stale downloads.
- Trial preserved the active report; an edit disabled apply; a new trial applied.
- Archive replay, mobile layout and offline generation passed with no page
  errors; all seven original GUI61 modes were tested after adding these controls.

Runtime is native TypeScript/Node. MATLAB, TrueGrid and Abaqus are development
references, not runtime dependencies. Continuous geometry combinations and
industrial-scale performance require application-specific validation.
