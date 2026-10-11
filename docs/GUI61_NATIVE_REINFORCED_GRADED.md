# Native Graded Reinforcement: Initial Half-Model Subset

`generateGradedReinforcedMesh` and `planGradedReinforcement` implement a bounded
subset of recovered Code_Creat5. Runtime is TypeScript/Node, without MATLAB/TG.
This is not a complete port of all reinforcement controls or a solver-ready deck.

```javascript
generateGradedReinforcedMesh({
  concrete: {
    fullSize: [40, 32, 12], refinedSize: [16, 12],
    fineSize: 1, coarseSize: 2, reductions: {x: 3, y: 3, z: 3},
    modelFraction: 'half', transitionStages: 1, thicknessTransition: true
  },
  rebarMeshSize: 2, barCounts: [4, 5, 3],
  cover: [2, 2, 0, 0, 2, 2], includeZBars: true,
  connectivity: 'separate'
});
```

CLI kind: `reinforced-graded`. It writes NODE/SOLID/BEAM, reports, geometric
sets and concrete-only parent lineage. Beam records do not have fictitious
solid parent IDs. Concrete PID defaults to 3 and beam PID to 2; both are
explicitly configurable and distinct. Source Code_Creat5 defaults to solid
PID 1 / beam PID 2, so default native PID is a deliberate difference.

## Parameter and Coupling Contract

The initial supported domain is a zero-tilt half-body, X in [-L/2,L/2],
Y in [0,W/2], Z in [0,H]. X/Y reductions may independently be 2 or 3;
thickness transition is on with reduction 3 and exactly one transition stage.
Quarter/full, nonzero tilt, multiple stages and shared-node reinforcement
are explicitly rejected while their source inconsistencies are resolved.

`barCounts` describes full-body positions, not segment counts. `cover` is
X low/high, Y low/high, Z low/high. Y must be symmetric and its full-body bar
count odd, retaining a central row. The actual beam subdivision size is
dimension / round(dimension / rebarMeshSize); outer dimensions do not change.
Full-body Y segment count must be even. Z-bar hiding removes the Z family.

Following the source, cover counts round to these intervals; spacing is
made integral by decreasing high/low covers alternately. Y additionally
requires even spacing in interval counts. Negative covers, an off-center Y
row, unsafe allocations or zero spacing are rejected. Resolved covers,
spacing and positions are returned. Bars extend across their axial domain;
cover locates the orthogonal families, not the ends of every straight bar.

Independent nodes are retained per bar, including bar intersections. No
coordinate merge, embedding, contact, bond-slip, material or section is
inferred. Noncollinear helper N3 nodes are generated. Mechanical coupling
must be supplied by the analyst; this mesh alone does not define reinforced
concrete interaction. Common concrete/beam nodes cannot be assumed on a
graded mesh merely because the uniform generator supports them.

## Source Bug and Independent Evidence

Source Code_Creat5's Z alignment loop references undefined `n(1,3)` and
`n(2,3)`. A [4,5,4]-bar-count input reproduces the MATLAB error. Only an
isolated corrected copy changes those two expressions to `n1`. The original
recovered file is untouched. Native bounded arithmetic implements the
corrected alternating-cover rule without a potentially unbounded loop.

Eight cases (four XY ratios x Z-bars on/off) plus one corrected Z-alignment
case were executed through recovered MATLAB -> TG and independently through
the native CLI. All physical beam segments, resolved subdivision counts,
covers and spacing match the respective reference, independent of numbering.

| XY reductions | Native solid count | Beam count on/off |
| --- | ---: | ---: |
| 2/2 | 2672 | 348 / 276 |
| 2/3 | 2128 | 348 / 276 |
| 3/2 | 2856 | 348 / 276 |
| 3/3 | 2264 | 348 / 276 |

The Z-alignment correction case has 440 beams and Z covers reduced from 2/2
to 0/0, explicitly reported rather than concealed. Native audit checks
volume 7680, positive sampled corner/Gauss Jacobians, no unexpected internal
free faces, distinct IDs, no shared endpoint IDs, length 2 and noncollinear N3.
Core/transition/far-field SJ are reported separately.

Raw TG outputs have disconnected coincident solid interfaces. Even identifying
exact-equal coordinates for diagnostic counting leaves 112 unmatched internal
solid faces in each measured case. This diagnostic does not edit the deck or
merge reinforcement nodes. Native concrete is generated directly conforming;
its solid counts therefore need not equal raw TG counts. Source TG also emits
beam-material warnings, retained in logs; a successful process is not solver
validation of the reference. No source material cards are silently imported.

Tests: `test/reinforced-graded.test.mjs`. Local evidence lives under
`F:/PythonWoking/temp/20261011-hexrefine-gui61-validation` in
`graded_rebar_oracle`, `graded_rebar_native`, and `graded_rebar_views`.
The nine native mixed meshes have whole-model, reinforcement-only,
concrete-only and thickness-section PNGs. LSPP beams are hidden for concrete
section projection because mixed projection remains a known viewer issue.

Pending: nonzero tilt, corrected model fractions, broader Y cover/count
semantics, shared/embedded coupling interfaces, multi-stage reinforcement,
GUI wiring and engineering-scale validation. See `GUI61_PORT_TODO.md`.
