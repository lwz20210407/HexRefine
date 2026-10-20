# Native Transition Bands

These APIs construct new isolated transition bands. They do not refine an
arbitrary existing Hex mesh, preserve a CAD partition history, or replace
the GUI61 target generators. Research motivation and provenance are in
[TRANSITIONMESH_ASSESSMENT.md](TRANSITIONMESH_ASSESSMENT.md).

## API

```ts
const planar = generatePlanarTransitionBand({
  length: 24, depth: 6, fineSegments: 24,
  ratios: [2, 3], stageDepths: [2, 4],
  rotationDegrees: 30, origin: [0, 0], fineSide: "bottom"
});
const annulus = generateAnnularTransitionBand({
  innerRadius: 10, outerRadius: 18, fineSegments: 64,
  ratios: [2, 2], fineSide: "inner",
  startAngleDegrees: 0, sweepAngleDegrees: 360
});
const solid = extrudeTransitionBand(annulus, 4, 3);
```

All four functions (`planTransitionBand` included) are exported by `index.ts`.
Planar `fineSide` is bottom/top in its local frame; annular is inner/outer.
Planar rotation is in XY, not the GUI61 thickness-dependent tilt. Annuli can be
full circles or positive sectors up to 360 degrees; inner radius must be positive.
Extrusion is straight +Z with constant cross-section and uniform layer heights.

## Counts, Widths and Identity

- Ratios are ordered fine-to-coarse. `[2,3]` means two stages, with cumulative
  count reduction 6, not side-by-side mixed blocks in one stage.
- Each 2:1 stage uses paired 4-to-2 ports; each 3:1 stage uses 3-to-1 ports.
  The planner derives the required initial multiple backwards across stages.
- `TransitionBandCountError` supplies the exact required multiple and nearby
  counts. Invalid counts are never rounded silently. There is no claim that
  these template constraints prove impossibility for all possible meshes.
- `stageDepths`, when supplied, must contain one positive width per stage and
  sum to the total depth. Otherwise widths follow successive fine-side pitches.
- Scope limits: 1..8 stages, at most 200000 initial fine segments, and extrusion
  limits of one million hexes/two million nodes. These are allocation guards,
  not industrial-scale performance certification.
- Coarse angular intervals must not exceed 90 degrees; final geometry/quality
  can still reject a thin or distorted ring even after counts pass.
- Node IDs are shared using integer fine-grid indices and stage boundary keys.
  Full-circle seam closure uses the same IDs, never a growing merge tolerance.
- Node sets identify fine/coarse sides, each stage interface and sector ends.
  `stageIds` is per cell. Extrusion propagates these sets and adds top/bottom.

## Geometry and Quality

`plan.geometryChecked` is deliberately false: the count plan alone does not
certify geometry. Successful generation performs corner/Gauss Jacobian,
boundary, non-manifold, duplicate-cell, measure and hanging-interface checks.
Low positive SJ produces a warning; negative/zero Jacobians are not accepted.

Annular boundary **nodes** lie on their analytic circles. Q1/H8 edges remain
straight chords. `relativeAreaError` measures agreement with the expected
discrete polygon boundary, whereas `relativeAnalyticAreaError` compares to
the analytic annulus/sector. These are different errors and neither replaces
the other. Extrusion conserves that discrete area times height. It is not an
exact curved/high-order boundary representation.

The 2:1 band is derived by projecting and pairing the repository's existing
Owen pattern2, and the 3:1 band reuses `refineQ1To4Q1`. No upstream TransitionMesh
Python source or literal template table is included in this implementation.

## CLI

```json
{
  "schemaVersion": 1,
  "mode": "annular",
  "parameters": {
    "innerRadius": 10, "outerRadius": 18,
    "fineSegments": 64, "ratios": [2, 2]
  },
  "extrusion": {"height": 4, "layers": 3}
}
```

Run `node scripts/generate-transition-band.mjs request.json NEW_OUTPUT_DIRECTORY`.
Omit `extrusion` for Q1. Use mode `planar` with the first API's parameters for
a straight band. Unknown top-level/geometry options are refused.

Output: `mesh.k`, `mesh.inp`, `request.json`, `sets.json`, `report.json`.
Both mesh files are read back for connectivity and coordinate precision before
writing. Existing output directories are never overwritten. K is mesh-only
NODE/SHELL or NODE/SOLID, with no inferred material/load/coupling cards. INP uses
the existing native Q4/H8 exporter and stage/node sets; it does not silently
choose the source plugin's reduced-integration solver formulation.

This API/CLI is not yet a new GUI mode. Same-stage hybrid blocks, rectangle
corner/collar rings, axial cylinder bands, arbitrary spatial planes and curved
sweep paths remain explicitly outside this first integration milestone.

Validation checkpoint (2026-10-20): full suite 801/801, including 16 new
band/CLI tests; five actual Abaqus 2020 planar source cases matched native
geometry/connectivity. Eight separately audited native cases were opened in
LS-PrePost and rendered to 16 views. This does not certify every continuous
parameter combination or high-count performance.
