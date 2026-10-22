# Face-Local Grading Review

`auditHexFaceGrading(mesh, options)` measures exact node-ID shared H8 quads.
It does not merge coordinates or classify unmatched faces as physical boundaries.
Crossed cycles and third face owners are rejected, including outside a reviewed
subset. `reviewElementIds` uses one-based element IDs and includes pairs incident
to either selected element. All topology is still inspected.

The normal is the normalized integrated bilinear area vector. For each side,
`d = abs(dot(vertexCentroid - faceCenter, normal))`. The normal-size proxy is
`max(d1,d2)/min(d1,d2)`; nonorthogonality is the acute angle between the centroid
line and this normal. These are **not** nominal refinement ratios, exact cell
thicknesses, overlap proofs or engineering-acceptance certificates. Warped/concave
geometry especially needs other checks. Undefined measurements and same-side
centroids are reported rather than converted to reassuring zeros.

```ts
const report = auditHexFaceGrading(mesh, {
  reviewElementIds: transitionElementIds,
  maximumNormalSizeRatio: 2,
  maximumWitnesses: 8,
});
```

The optional limit is strict, with no hidden tolerance. Empty reviewed pair sets,
undefined measurements, same-side centroids or any above-limit pair prevent
`requestedLimitVerified`. Without a limit that field is null, not true.
`engineeringAcceptanceVerified` is always false. Witnesses include both element
IDs, local faces and source node IDs; summaries remain null without measurements.

`refineExtrudedOgrid` always reports transition-incident pairs under
`report.quality.adjacencyGrading`. Its optional
`maximumAdjacentNormalSizeRatio` rejects an unverified limit before export.
`scripts/refine-ogrid.mjs` also repeats an explicitly requested limit on K
readback before reserving its output directory. This option is API/CLI only;
it is not a new GUI checkbox or a change to geometric refinement.

## Complete TC4 Evidence, 2026-10-23

The same complete original ROI was replayed, not a smaller local patch. The
203850-H8 spaced candidate K and lineage were identical to the previous result;
all2970 focus parents retain their64 exact quarter-grid children. No geometry,
Jacobian threshold, volume tolerance or node-merging tolerance was changed.

| Layout | Reviewed pairs | Max normal-size proxy | Max nonorthogonality |
| --- | ---: | ---: | ---: |
| Compact31, not recommended |27040|6.285214|68.5524 degrees|
| Strong support1 |31276|2.166105|61.8126 degrees|
| Strong support2, spaced |31276|2.166105|61.8126 degrees|

Support2 improves the visible plateau/spacing, **not** these worst template-shape
values relative to support1. A requested proxy limit2 rejects the real complete
case, exit1, without an output directory. It was not raised to2.17. The strict
above2 count is rounding-sensitive near exactly2 and is not an engineering
defect count. Nominal2:1 does not imply this geometric proxy is everywhere<=2.

Independent PyDYNA/NumPy processing groups faces afresh and uses2x2 bilinear
normal integration. All16 worst witnesses per case agree; input K hashes are
unchanged. Four actual two-cell LSPP views identify the worst positions. They
are diagnostic subsets with colors, not replacement analysis decks.

Evidence remains at
`F:/PythonWoking/temp/20261023-hexrefine-local-grading/`:
`TC4_LOCAL_GRADING_REVIEW.html`, `manifest.json`, native/independent reports,
strict rejection, current908/908 full regression and desktop/mobile browser
checks. Four images,22 links and all three filters pass with no horizontal
overflow. The candidate is **not automatically engineering accepted**.

## Weak-Balance Boundary Work

Pinned MIT CinoLib primal schemes were matched with an adjacent primal block
using exact rational cyclic face partitions, then jointly dualized. Five WB
families produce reference boxes of35/39/47/51/55 H8, with positive sampled
Jacobians and volume2. These are not raw primal polyhedra mislabeled as H8.
They still lack original coarse/fine boundary, fixed-core and far-field
installation contracts. Reference evidence is not production WB coverage.
