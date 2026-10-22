# TC4 Transition Shape Review

2026-10-22. Conformance, conserved volume and positive sampled Jacobians did
**not** certify that the earlier compact-shell layout was a suitable mesh.

## Actual Shape Concern

The complete31-Hex shell compressed two successive2:1 transitions into one
original parent layer. Its actual H8 surface contains long fine columns and
a crowded coarse-side fan. Arbitrary LSPP section-intersection outlines can
obscure this, but the issue remains on actual element faces, not just cuts.

Independent reread found3240 transition cells with an edge shorter than the
part-wide finest-core minimum edge, min ratio0.76973, max edge aspect8.1364
and max center-Jacobian condition8.2271. These results are compatible with
positive125-point samples and correct volume/conformance. Those checks do not
negate the shape tradeoff or prove positivity everywhere.

The compact layout is **not recommended for this TC4 delivery**. Historical
K/evidence remain research comparisons; this corrects their interpretation.

## Stepwise Support Instead Of A Compressed Shell

`strongSupportLayers` controls original-parent support width per intermediate
level, integer1..8, strong-support mode only. Default1 preserves prior behavior;
direct-macro plus this option is explicitly rejected. Completion budgets and
coarse-far-field guards remain active; promoted layers are reported.

```ts
refineExtrudedOgrid(mesh, {
  axis: 2, bands: [{min:-0.27,max:0.27,level:2}],
  completion: "none",
  symmetryPlanes: [{axis:0,coordinate:0},{axis:1,coordinate:0}],
  transitionGeometry: "conservative-face-flux",
  balanceMode: "strong-support", strongSupportLayers: 2,
  maxPromotedSourceLayers: 4
});
```

The new candidate keeps all135 columns and2970 original core parents, each64
children/125 exact quarter-grid nodes. It adds270 uniform intermediate parents,
retains1080 coarse parents, and has203850 H8/212377 nodes. Independent audit:
minSJ0.201494, min8-Gauss determinant6.323e-9, max parent volume error5.022e-13,
no unexpected internal free faces, one closed boundary/Euler2. Source vertices
and core grid stay fixed. Explicit bounded face-flux mapping remains necessary;
old bilinear surfaces are not retained pointwise. No threshold was widened.

Actual surface-edge counts on the same strip are7->28 for the compact layout
and7->14->14->28 for the stepwise candidate. Each step is2:1, with cumulative
one-quarter core edge size, not an unrelated added fine band.

| Layout | H8 | Min transition/core edge ratio | Short-edge transition cells | Max edge aspect |
| --- | --- | --- | --- | --- |
| Earlier compact31 |200070|0.76973|3240|8.1364|
| Earlier strong-support1 |201960|1.00000|0|4.2339|
| New strong-support2 |203850|1.00000|0|4.2339|

New spacing separates the stages; it does **not** improve each local template
relative to strong-support1, whose shape statistics are essentially identical.
Fewer cells do not establish a faster explicit solve.

`quality.sizeDistribution` reports minimum core/transition edges, their ratio,
max transition edge aspect and transition count. Short-edge warnings supplement
low-SJ warnings. `engineeringAcceptanceVerified` is explicitly false. Part-wide
edge statistics do not replace adjacent-cell grading or solver validation.

## Shared-Shell Research Is Not The Corrective Delivery

Full-section zero-target parents between two bands can use two virtual axial
half-shells meeting on one coarse quad. Whole original parents are finally
reassembled. Original provenance and core grids remain; no uniform halo is
promoted. Two-sided counts are `(2*4^lowDepth-1)+(2*4^highDepth-1)`.
Equal/unequal depths1..3 and mapped physical-axis/reflected/reversed-frame cases
have fixed tests. Each accepted station trial also checks8 Gauss samples with
scaled arithmetic. A finite rational internal-interface search is reported.

The TC4 research prototype has205605 H8,135 complete38-cell shared parents,
2970 depth2/540 depth1 exact tensor cores, parent volume error1.483e-12 and no
unexpected internal free faces. **Its minSJ0.13514 remains inadequate for the
present recommendation.** Interface-placement search did not improve it. It is
not the corrective candidate above, nor an engineering-ready generic WB claim.

Enriched isolated3/5 corners, adjacent different positive target levels and
arbitrary multidirectional CinoLib WB edge/vertex schemes remain open.

## Evidence

`F:/PythonWoking/temp/20261022-hexrefine-shared-shells/TC4_TRANSITION_SHAPE_REVIEW.html`
puts actual H8 faces first, then full-model/interior cuts. Local blocks are exact
extracts with node/element ID maps, not regenerated toy meshes. Diagnostic PID
coloring does not alter full K. Candidate SHA-256:
`1d01f987e8fe016d8f371bcb295ecb28a06ea40a9951a085e9b2fa7bcf8ff8a1`.
Frozen-source replay matches K and lineage exactly. Final typecheck, standalone
and **900/900** tests passed (no skips/xfails, about533seconds, concurrency4).
An earlier interrupted run is retained but is not counted as a pass.
