# R1 Shared-Face Diagnosis Correction

## Verified Change

The original quarter specimen has X=0 and Z=0 symmetry cuts, with explicit solver
SPC node sets9101 and9103. The earlier requests omitted `symmetryPlanes`, causing
symmetry-cut traces to be compared with the physical free-surface phase contract.
That combined-constraint refusal was not proof that shared faces cannot match.

The corrected request retains every1680 original ROI parent at level2, strict
physical exterior phase, two original transition layers, and all source nodes.
The native compiler closes all shared faces, including the complete three-parent
96/21-cell corner groups. No wrap, topology compensation, copied TrueGrid macro,
core overrefinement, or uniform promotion of surrounding parents is used.

## Quality And Acceptance

| Quantity | Measured |
|---|---:|
| Original / resulting H8 |13692 /136626|
| Exact core parents / children |1680 /107520|
| Transition parents / children |924 /18018|
| Retained coarse parents |11088|
| Standard / extended shell minimum cornerSJ |0.144137 /0.174875|
| Original source / exact refined-core minimum cornerSJ |0.04523785 /0.04523785|
| Untouched far-field minimum cornerSJ |0.514404|
| Maximum independent per-parent relative volume error |5.05e-13|
| Core tensor coordinate error on K readback |4.88e-14|
| Unexpected internal free faces / boundary Euler |0 /2|

The extended search is a finite endpoint-fixed monotone axial geometry family,
not a different topological refinement. Eight-Gauss positivity, original-parent
volume1e-8, original-node and full-ROI tensor protections are unchanged.

The source's worst parent is imported ordinal72, external EID135, inside the
protected core. Keeping it geometrically exact cannot also make its sampled
cornerSJ>=0.15. The production global gate still rejects this request at
`diagnostics.stage="protected-region-quality"`, with `outputGenerated:false`.
The separately generated full inspection K is prominently labelled diagnostic;
it must not be advertised as a globally accepted engineering mesh.

Remaining user choice: preserve this source geometry and explicitly distinguish
new-transition acceptance from inherited quality, or authorize a separate source
geometry repair. Neither choice has been applied silently. No new solver-state
migration or guaranteed positivity everywhere is implied.

## Regression And Evidence

1130/1130 full TypeScript tests pass, no skips/xfails. Eighteen targeted profile,
macro/API and CLI tests pass. Public type contracts and embedded offline runtime
are synchronized. Regressions verify that diagnostics never accept a relaxed
field, and a good shell cannot hide a low-quality unchanged far field.

Local evidence: `F:/PythonWoking/temp/20261024-r1-shared-face/REVIEW.html`.
The full private candidate, original-plane proof, strict CLI refusal, independent
PyDYNA/NumPy audit and actual LSPP images remain there. No user original was
overwritten. Generic3D WB edge/vertex and multi-front installation remain open.
