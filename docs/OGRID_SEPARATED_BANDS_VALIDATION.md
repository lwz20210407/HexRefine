# Separated Direct Bands And Five-Valent Reference

Verified 2026-10-22. Native TypeScript/Node runtime, no MATLAB/TrueGrid runtime
dependency. Core implementation commit: `5cffb48`.

## New Supported Contract

`refineExtrudedOgrid` with `balanceMode: "direct-macro"` and explicit
`transitionGeometry: "conservative-face-flux"` accepts separated full-section
constant-level1/2/3 bands. The target field is not promoted to a uniform halo.

| Target depth | Uniform core H8 / nodes per original parent | Shell H8 per original parent |
| --- | --- | --- |
|1|8 /27|7|
|2|64 /125|31|
|3|512 /729|127|

The shell recurrence is `S(0)=1; S(d)=3+4*S(d-1)=2*4^d-1` for the supported
compatible hierarchical field. A31/127-cell shell is a complete multi-level
original-parent construction, not a new single-step refinement ratio.

Two zero-target parent layers are the minimum separation: the two shells can
share a coarse face but never the same parent. Three zero layers preserve a
whole coarse layer between the shells. Shared two-sided shells and adjacent
different positive levels are refused before construction. Whole-section
planning explicitly bypasses local-box sweeps, which otherwise can misclassify
multiple separated intervals. The generic local-refinement API is unchanged.

The station exponent is common to the field. Original source vertices,
original axial planes and all core tensor grid nodes remain fixed. As before,
the explicit bounded normal face correction conserves volume flux, not exact
pointwise equality to the old warped bilinear surface. No audit threshold was
widened. `shellGroups` reports each actual depth/count; the legacy scalar
`childrenPerShellParent` is null for mixed depths, not an invented average.

## Real TC4 Verification

The original solver deck was freshly imported read-only through PyDYNA. Its
PID1 matches the normalized5809-node/4860-H8 input exactly in connectivity;
coordinate difference is6.2e-33. The original deck remains unchanged, SHA-256:
`496990d021e08ccec5e4d8c7d86473f19336ee0e9c2ee3e99dea1bea917ea999`.

The central60% uses **all135 section columns and all2970 original core
parents**, not a selected favorable subpatch. Centroid selection realizes
Z[-0.275,0.275] from the requested[-0.27,0.27]. The new case additionally
requests an independent level1 band at Z[-0.4,-0.35].

| Case | H8 / nodes | Min cornerSJ | Coarse parents retained | Max parent volume error |
| --- | --- | --- | --- | --- |
| Original complete level2 band replay |200070 /208341|0.169402|1620|2.365e-13|
| Same complete level2 band plus separate level1 band |203580 /212137|0.169402|1080|1.114e-12|

The latter has2970 parents each64 exact children/125 quarter-grid nodes and
270 parents each8 exact children/27 half-grid nodes. Its270 depth2 shell
parents each contain31 cells, and270 depth1 shell parents each contain7.
All changed parents lie inside the requested cores or their one-parent axial
shells. The135 parents at Z[-0.325,-0.3] stay wholly coarse with exact source
connectivity. There are zero whole-parent target promotions.

Independent NumPy/PyDYNA checks: positive corners and all8 Gauss samples
(minimum6.143e-9), exact core tensor nodes, per-parent/total volumes, source
vertices, far-field connectivity, no duplicate/nonmanifold cells, no unexpected
internal free faces, one boundary component and Euler2. The mixed case's total
relative volume error is4.37e-16; max normalized exterior face-flux residual
is3.51e-13. Its measured original-surface deviation is1.152e-6 source units,
reported separately, not described as zero.

The original complete level2 replay K is byte-identical to the prior audited
K, SHA-256 `2fa7913e79e2baea44083f4f4505303c070871584afc9618d131bb2a11ce54ad`.
The new mixed-band K SHA-256 is
`e0348cf1a70601a2c35aa5393462de92494103774be35d1df3b7cb985c68c0b7`.
The28.1MB duplicate replay K was removed only after hash verification; its
retained historical alias is explicit in the new evidence manifest/HTML.

## Corner Reference And Third-Level Checks

The generator `scripts/generate-hierarchical-macro-references.mjs` now also
emits `complete155-pentavalent-star.json`:155 cells/257 nodes spanning **five
whole source parents** at a five-valent corner with a surrounding support
ring. Per-parent volume, complete source exterior area coverage, all8 Gauss
samples and closed2-manifold Euler2 are checked. Macro minSJ is0.217835.

Its full20-column/8-layer reference extrusion produces3880 H8, minSJ0.206386;
all40 core parents each have64 tensor children. A separate third-level
reference produces5128 H8, minSJ0.167934, with8 core parents each512 children
and729 exact eighth-grid nodes. Both were formally exported/read back as K
and independently audited, not merely displayed from a template preview.

These are **reference models, not real TC4 geometries**. The fixed suite also
keeps isolated3/5-valent-star failures as negative cases. Adding a support ring
changes the boundary contract: this is not a universal155-cell corner plug-in.
No general mathematical impossibility follows from a refused isolated star.

## Reproduce And Inspect

Evidence directory:
`F:/PythonWoking/temp/20261022-hexrefine-corner-shells/`.

After `npm run build`, use the formal CLI with each request and a NEW output:

```text
node scripts/refine-ogrid.mjs <evidence>/tc4-separated-request.json NEW_DIRECTORY
node scripts/refine-ogrid.mjs <evidence>/pentavalent-request.json NEW_DIRECTORY
node scripts/refine-ogrid.mjs <evidence>/level3-request.json NEW_DIRECTORY
```

`OGRID_CORNER_REVIEW.html` has16 real LS-PrePost views, parameters, mesh-only
K files, lineage, reports and independent audit JSON. Desktop1440x1000 and
mobile390x844 filtering, all images/links and document overflow checks passed.
Full regression: **896/896**, no skips/xfails, about595seconds.

Two initial enhanced audit logs are intentionally retained: a local harness
variable shadowed output free-face ownership with original axial adjacency.
Only the harness variable name was corrected, and the unchanged K files were
rerun with the same tolerances in separate final logs. This was not a mesh
repair or a reason to relax conformance.

## Still Open

- Enriched isolated corner vocabulary and multi-direction fronts.
- Shared two-sided shells and arbitrary three-dimensional direct weak-balance
  edge/vertex schemes, including the CinoLib WB family.
- General adjacent mixed target fields/ratios and corresponding GUI controls.
- Solver-state/set migration and explicit time-step/performance validation.

The default remains strong-support. Fewer cells or positive sampled Jacobians
do not by themselves establish engineering acceptance or faster explicit solve.
