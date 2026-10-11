# Native Graded Solid Cylinders

Status: experimental, validated on small single/two-physical-layer cases.
`generateCylindricalGradedMesh` is a new-mesh generator. It does not refine an
arbitrary imported cylindrical K deck and does not generate shell elements.
It has no MATLAB or TrueGrid runtime dependency.

## Contract

```javascript
generateCylindricalGradedMesh({
  outerRadius: 20, thickness: 3, length: 40,
  coreArcLength: 12, coreLength: 12,
  fineSize: 1, radialSize: 1, coarseSize: 3,
  thicknessTransition: true, layers: 2, modelFraction: 'quarter'
});
```

The cylinder axis is Y. The circumferential quarter-domain angle is pi/2;
the core angular half-span is coreArcLength/(2*outerRadius). Axial half-spans
are length/2 and coreLength/2. Fine circumferential/axial counts are rounded
then aligned to three. Radial count uses radialSize and is also aligned to
three even with thickness transition disabled, matching this source branch.
Outer circumferential/axial counts are rounded independently; no outer size
is silently resized to force divisibility.

This branch has fixed 3:1 circumferential and axial transitions. Radial reduction
is 3 or 1. Unknown ratio, tilt and multi-transition-stage options are rejected;
the rectangular generator's broader options do not implicitly apply here.

Physical layer i has outer radius R-i*(thickness+fineSize), inner radius one
thickness smaller. The gap is fineSize, as in the recovered generator. All
layers must stay strictly away from the axis. Each layer's symmetry copies
are merged separately; nodes are NEVER merged between physical layers.
Layer node and element sets are returned. Mesh-only K currently uses PID 1,
as do the reference samples; these sets are not material/contact definitions.

## Corrected Behavior

| Mode | Native coverage |
| --- | --- |
| Quarter | X>=0, Y>=0, both Z signs (half circumference, half length) |
| Half | Full circumference, Y>=0 (half length) |
| Full | Full circumference and both Y signs |

The source vi=3 branch reflects X and Y but not Z, so its output covers only
half the circumference. Six recovered-callback experiments confirmed this
behavior. A corrected TG copy using all three reflection planes produced
2788 nodes/1776 hex in the full reference example instead of 1424/888. The
original recovered source and original reference artifacts were not modified.
Native full mode implements the corrected coverage and reports the deviation.

The native engine builds a conforming logical mesh first, then maps angular,
axial and radial coordinates. All inner/outer cylinder boundary nodes are
placed on their analytic surfaces. This improves on unprojected interpolated
trbb nodes; it changes the discrete boundary and is NOT a byte/coordinate-exact
replay. Surface nodes on a circle do not make linear hex faces exactly curved.

## Validation

Six initial oracle cases: all source vi values; thickness transition on/off;
one/two physical layers. Independent PyDYNA and NumPy auditing found:

| Native example | Nodes | Hex | Minimum corner SJ |
| --- | ---: | ---: | ---: |
| Quarter, radial transition | 784 | 452 | 0.2709 |
| Half, radial transition | 1488 | 904 | 0.2709 |
| Corrected full, radial transition | 2804 | 1808 | 0.2709 |
| Quarter, no radial transition | 1056 | 684 | 0.5188 |
| Quarter, two physical layers, radial transition | 1568 | 904 | 0.2414 |
| Quarter, two physical layers, no radial transition | 2112 | 1368 | 0.4209 |

Native output: no hanging incidences, no unexpected internal free faces,
no duplicate/nonmanifold cells, positive corner and Gauss Jacobians. Original
radial-transition references have 20/40 unmatched internal faces in the
quarter/half cases after accounting for unprojected outer skin nodes. Native
templates close these directly. Nearest source/native node correspondence is
injective in the compared domains; this is a diagnostic correspondence, not
a relaxed merge tolerance.

Native radius error is below 4e-15 in these examples. Sum of element volumes
matches independently integrated bilinear exterior-face flux to roundoff.
Analytic cylinder volume differs by approximately 0.379%, the reported
piecewise-linear geometric approximation error; it is not treated as a failed
conservation check or silently set to zero. Every mapped element is re-audited.

The core is exactly 27 descendants per coarsest logical parent when radial
transition is on, 9 when off. Native tests also cover true full coverage,
disconnected layers, coarse far-field preservation, invalid parameters and K
read-back. Broader angles/counts/extreme aspect ratios and engineering-scale
performance remain to be tested. No solver validation is claimed.

CLI kind: `cylindrical-solid`. Outputs additionally include `node_sets.json`
and `cell_sets.json`, using output IDs. Local evidence:
`F:/PythonWoking/temp/20261011-hexrefine-gui61-validation/cylinder_oracle`.
