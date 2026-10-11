# Native Graded Reinforcement

`generateGradedReinforcedMesh` and `planGradedReinforcement` implement a bounded
port of recovered Code_Creat5 with explicit native extensions. Runtime is TypeScript/Node, without MATLAB/TG.
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

Quarter uses X>=0,Y>=0; half both X signs and Y>=0; full both X/Y signs.
Z is [0,H]. Independent reductions, thickness on/off, one/two transitions
and half/full tilt reuse the rectangular kernel and its failure guards.
Quarter tilt follows its forced-zero rule with a warning. More than two
transitions and shared-node steel remain unsupported. Code_Creat5 itself
has single-stage Z3 grading; other combinations are native extensions,
recorded in `plan.sourceExtensions`.

`barCounts` describes full-body positions, not segment counts. `cover` is
X low/high, Y low/high, Z low/high in full-body coordinates. Positions are
resolved before clipping to the selected fraction; asymmetric covers and
even rows do not imply physical symmetry. The actual beam subdivision size is
dimension / round(dimension / rebarMeshSize); outer dimensions do not change.
Z-bar hiding removes the Z family. Odd segment counts are supported: only
the crossing segment is truncated at the cut, without redistributing others.
`axisCoordinates`, truncation warnings and geometric cut-node sets disclose this.

Following the source, cover counts round to these intervals; spacing is
made integral by decreasing high/low covers alternately. Y additionally
requires even spacing in interval counts. Negative covers, unsafe allocations
or zero spacing are rejected. Off-center rows are clipped, not recentered. Resolved covers,
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

## Additional Combination Matrix

Source vi=1 emits half concrete; vi=3 emits full concrete but only half steel.
These inconsistencies were reproduced with MATLAB/TG and are not copied.
Native steel is clipped from the resolved full-body layout, not mirrored with
duplicate center bars. Non-symmetric inputs are geometric partial models,
not automatically physically symmetric problems; no solver BC is inferred.

Concrete tilt shears its partitions, while steel stays straight in global
X/Y/Z, matching the source beam flow. Half +/-10-degree probes have the
same physical beam segments as TG. Native full tilt also keeps the zero-tilt
steel unchanged. Coupling is still the analyst's responsibility.

Fourteen additional cases in `graded_rebar_combinations_*`:

- Six fraction/Z-bar cases: solids 1132/2264/4528; beams on 174/348/612
  and off 138/276/492 (quarter/half/full).
- Four half/full +/-10-degree cases: minimum SJ about 0.28658, positive
  sampled Jacobians, no unexpected internal free faces, straight steel.
- Asymmetric covers/even rows/odd subdivisions: 3200 solids, 300 beams;
  cut segment length 1, unchanged interior length 2. Regression compares
  half steel against geometric clipping of the full layout.
- Three native two-stage extensions: quarter 2/2/2, half tilted 3/3/3,
  full tilted 2/3 with thickness off. Solids 7140/16360/38464, beams
  348/696/1240, minimum SJ about 0.21693/0.14433/0.31251 respectively.
  The low value is disclosed; Code_Creat5 has no two-stage replay counterpart.

`regions.transition` describes refined outside-core support, including uniform
intermediate cells in two-stage meshes. It is not a pure transition-cell mask.
These cases do not certify every real-valued combination. Tests live in
`test/reinforced-graded-combinations.test.mjs`; PyDYNA independently checks
the exported decks. Source incorrect-fraction cases remain failure evidence.

Pending: shared/embedded coupling, more than two transitions, broader parameter
coverage, GUI wiring, industrial-scale and solver validation. Uniform-RC
quantity optimization is separate. See `GUI61_PORT_TODO.md`.
