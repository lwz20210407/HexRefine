# Conservative Mapped Faces And Complete Hierarchical Shells

## What Was Fixed

The TC4 central60% level2 request was blocked while building its **level1
expanded support**, before level2 started. The seven-Hex field's irregular
quad partitions are not tensor-product restrictions of a warped Q1 parent
surface. Trilinearly mapping their nodes therefore does not imply conservation
of that parent's Q1 surface flux. A source parent in the fixed fixture has
relative volume error2.2958e-5; the full expanded patch accumulates1.3531e-8,
above the unchanged1e-8 gate. This is not cured by a larger merge tolerance.

`transition-face-flux.ts` provides an **explicit opt-in** mapping:

1. Recover canonical original-face corners and the trusted template's complete
   boundary partition. Adjacent parents must have the same partition.
2. Integrate the original and subdivided bilinear faces using2x2 Gauss
   quadrature of the oriented volume flux, relative to a local origin.
3. If needed, move one **new face-interior node** along the common face normal.
   The flux is affine in this one node's displacement, so solve that scalar
   correction directly. Choose the largest derivative to minimize displacement.
4. Apply the identical result to all occurrences on the shared face. Source
   vertices, parent edges, coarse interfaces and tensor fine interfaces stay
   fixed. Certify the face residual and retain all existing final gates.

This preserves the integral flux, **not exact pointwise equality to the old
bilinear surface**. Changing a Q1 subdivision of a warped surface is a geometry
choice and must not be hidden. The normal correction has an explicit budget
(default0.001 of the shortest parent-face edge), and its actual displacement
is reported. This budget is not a widened Jacobian, volume or merge threshold.
Planar faces remain unchanged. No global volume tuning or specimen scaling is
performed. Default `trilinear` behavior remains unchanged and can still refuse
the TC4 level2 request.

Tensor-product face partitions are explicitly excluded from correction: they
are exact Q1 restrictions. Keeping the fine core interface fixed is therefore
a structural guard, not merely a test for a small floating-point residual.

```ts
refineExtrudedOgrid(mesh, {
  axis: 2,
  bands: [{min:-0.27,max:0.27,level:2}],
  completion: "none",
  symmetryPlanes: [{axis:0,coordinate:0},{axis:1,coordinate:0}],
  transitionGeometry: "conservative-face-flux",
  maximumFaceDisplacementFraction: 0.001
});
```

## Direct Complete31-Hex Shells

`balanceMode: "direct-macro"` handles one contiguous full-section level2 band
without uniformly promoting entire neighboring source-parent layers. The mode
requires explicit conservative-face geometry and currently refuses other
target patterns/depths.

- Core descendants are frozen uniform8 per level:64 cells/125 quarter-grid
  nodes per original finest parent.
- Two compatible seven-Hex fields construct an intermediate shell. Exact
  interpolation supports are carried through the **authoritative merge map**;
  conflicting supports are rejected, not guessed from geometry.
- Collect **all31 descendants** of each original shell parent. This is a
  complete original-parent macro, not a sample of cells touching a singular
  line. Its coarse face is1x1; its fine face is4x4 after two2:1 levels.
- Reparameterize NEW axial stations within those original parents. Original
  planes, original vertices and the uniform core grid stay fixed. One common
  exponent is used for the entire interface field, so neighboring walls do not
  get independent phase shifts. Seven bounded exponents are tried and the
  positive candidate with the highest minimum cornerSJ is chosen.
- Reapply canonical face-flux conservation at original-parent macro boundaries,
  then audit the complete source-parent patch and final conforming mesh.

The axial station redistribution is **separate from the small normal face
correction budget**. The former changes the grading of new nodes within the
transition layer; it does not move original parent planes or source nodes.
The report records the exponent, candidate qualities and the maximum possible
station shift as a fraction of parent height.

This is a direct **full-band two-level shell** construction. It is not a claim
that CinoLib's five direct weak-balance edge/vertex schemes or arbitrary
nonstructured weak requests have been implemented. Standard strong-support
completion remains the default. A source field that cannot satisfy the initial
seven-Hex compatibility/closed-phase constraints is explicitly refused.

## Actual Complete TC4 Verification

Both outputs use all135 section columns and all2970 selected original parents
in the same central band. Neither uses an easy local substitute.

| Mode | H8 | Min cornerSJ | Unchanged coarse parents | Max root-parent volume error |
| --- | ---: | ---: | ---: | ---: |
| Strong support + conservative faces |201960|0.201494|1350|4.23e-13|
| Direct complete31 shells |200070|0.169402|1620|2.37e-13|

The direct mode has270 whole shell parents of31 cells, no whole-parent target
promotions, and2970 finest parents of64 cells. Its unoptimized intermediate
shell had minSJ0.055935; that was a construction probe, not the delivered K.
The selected exponent0.25 improves final minSJ to0.169402 without lowering any
quality threshold. This is a disclosed quality tradeoff, not automatic
engineering acceptance of every low-SJ case.

Independent edge checks give transition/core minimum-edge ratios1.0000
(strong support) and0.7697 (direct), with maximum transition edge-length
ratios4.234 and8.136. The direct case saves about0.94% cells but has a smaller
minimum edge; **do not infer a faster explicit solve from cell count alone**.
Strong support remains the default. Time-step/solver performance is not yet
benchmarked by these mesh-only checks.

Independent PyDYNA/NumPy readback checks:

- All2970 original core parents,64 children and125 exact tensor nodes each.
- Source coordinates preserved to keyword rounding, exact far-field
  connectivity, no duplicate/nonmanifold cells or unexpected internal free
  faces, a single closed boundary with Euler2.
- Positive corner and all8 Gauss-point Jacobians; root-parent and total volume
  conservation below the original1e-8 threshold.
- Every original external face has the expected ancestry and conserved flux.
  Original-surface deviation is **measured separately**, not called zero:
  about3.0474e-6 for strong support and1.1518e-6 for direct shells, in source
  coordinate units. Both are below their explicit geometric budgets.

The independent boundary-flux residual is below3.2e-13 normalized by face edge
length cubed. The final source coordinates' readback difference is about6.2e-33.
No source polygon redistribution is used in these TC4 cases.

Evidence: `F:/PythonWoking/temp/20261021-hexrefine-tc4-warped-transition/`.
`TC4_CONSERVATIVE_REVIEW.html` links both K files, reports, audits and8 native
LS-PrePost views. The direct case is replayed through `scripts/refine-ogrid.mjs`.
These are mesh-only NODE+SOLID outputs, not migrated solver analyses.

A fresh read-only PyDYNA import also checked the current actual
`Cylindrical_Compression_noFrac_TrueSmoothVelocity.k` in the user's original
LS-DYNA batch directory, not just the cached JSON. Its specimen PID1 has the
same4860 H8 and5809 nodes: exact connectivity match and coordinate difference
about6.2e-33. The original deck SHA-256 is
`496990d021e08ccec5e4d8c7d86473f19336ee0e9c2ee3e99dea1bea917ea999`;
the original file was not changed. Details are retained in
`original-source-verification.json` beside the evidence.

After the tensor-interface guard, **both** complete cases were replayed through
the formal CLI. Their K hashes and all lineage arrays match the independently
audited outputs exactly; redundant replay meshes were removed with aliases
recorded in `replay-verification.json`. Final full regression:891/891 passed.
The mapped-face family covers192 rotation/reflection frames; direct macro
probes also cover all three physical axes with and without reflection. Desktop
and mobile report filtering, all8 images and all local links were checked.

## Complete Reference Data And Remaining Limits

Run after building:

```sh
node scripts/generate-hierarchical-macro-references.mjs NEW_DIRECTORY
```

The checked-in `test/fixtures/lsdyna/hierarchical-macros/` contains:

- A complete31-cell/63-node original-parent reference.
- A complete93-cell/155-node trivalent-star reference spanning **three whole
  original parents** in the butterfly grid. Every original macro boundary face
  has complete area coverage, all8 Gauss Jacobians are positive, and the macro
  boundary has Euler2. This reference's minSJ is about0.105: it is a topology
  example with a quality warning, not an engineering-approved mesh.

These are **two-level** shells, not replacements for the historical
**single-level** nine-Hex sample. Their boundary contracts differ. The reference
coordinates use the generated model's world frame; `parents` supplies the full
parent vertices, and indices are explicitly zero-based. Neighbor wall
compatibility still requires a field solve; do not install an isolated example
as a universal corner template.

The full butterfly regression includes all four trivalent corners. Isolated
three-/five-valent star fields that lack an admissible level-closed seven-Hex
field remain explicit negative tests. They are **not proofs of mathematical
impossibility**. Missing enriched corner vocabularies, arbitrary weak edge/corner
patterns, multi-direction fronts, mixed levels/ratios and GUI controls remain
TODO. No formal Jacobian-positivity proof throughout every distorted H8 or
solver integration-point state migration is claimed.
