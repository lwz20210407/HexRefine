# Native Transition Bands

For volume-mesh reproductions and adjacent regular solid regions, see
[Native Solid Transition Domains](TRANSITION_SOLID_MODES.md). This includes
multi-stage radial-cut compatibility, GUI fields and actual Abaqus comparisons.

These APIs construct new transition meshes. They do not refine an
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

Additional modes:

```ts
const mixed = generateHybridTransitionBand({
  length: 14, depth: 2, fineSegments: 14, coarseSegments: 6,
  blocks: ["pair2", "single3", "pair2", "single3"]
});
const rectangle = generateRectangularTransitionRings({
  innerSize: [12, 8], fineSegments: [12, 8], stages: 2,
  ratio: 2, includeCore: true
});
const axial = generateAxialTransitionTube({
  innerRadius: 10, outerRadius: 12, length: 6,
  radialLayers: 2, fineSegments: 72, ratios: [2, 2],
  fineEnd: "end", axis: [1, 2, 3], origin: [0, 0, 0]
});
```

Hybrid blocks occupy one stage: `single3` consumes 3 fine and 1 coarse port,
`pair2` consumes 4 fine and 2 coarse ports. Counts must satisfy port balance,
including paired 2:1 columns. Grouped/interleaved orders or explicit blocks
are accepted. Coarse widths are 2h or 3h; a uniform coarse pitch is not implied.

Rectangular rings include dedicated three-quad 2:1 corners; 3:1 corners are
regular quads. Optional core fill is exactly the requested Nx by Ny grid.
Before a subsequent stage, regular collars pad the prior interface by whole
cells until the next template tiles exactly. All previous interfaces remain
shared. `plan.outerSize` is derived, not a fixed external-size input. For the
3:1 two-stage 9x9 example, explicit collars produce outer size 45x45, unlike
the source plugin's 33x33 FREE-meshed branch. This is a different construction
with its own reported geometry, not an identical replay.

Axial tubes reduce circumferential counts along the cylinder axis. Radial wall
layers are independent. Full-circle seams share IDs at every axial interface;
sectors expose separate side sets. `axis` defines an arbitrary spatial frame,
while `fineEnd` chooses the axial start or end. Positive corner and Gauss
Jacobians, expected boundary faces, and volume from bilinear boundary
integration are checked against the Hex Gauss integral. Analytic-cylinder
volume error is recorded separately from discrete conservation.

All functions shown above, including the count planners, are exported by `index.ts`.
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

The versioned CLI accepts `planar`, `annular`, `hybrid`, `rectangular-rings`
and `axial` through `generateTransitionMeshRequest`. Optional `extrusion`
applies to the first four modes; axial already generates Hexes and rejects
a second extrusion. Core cells have a `core` set; transition cells retain
stage sets and lineage.

The browser/offline workbench exposes these modes under `过渡带参数`; see
[TRANSITION_MESH_WORKBENCH.md](TRANSITION_MESH_WORKBENCH.md). CAD partition/seed
preservation, re-location of arbitrary existing model regions and curved
sweep paths remain outside these independent generators.

Validation checkpoint (2026-10-20): full suite 801/801, including 16 new
band/CLI tests; five actual Abaqus 2020 planar source cases matched native
geometry/connectivity. Eight separately audited native cases were opened in
LS-PrePost and rendered to 16 views. This does not certify every continuous
parameter combination or high-count performance.

Continuation checkpoint: final full suite 837/837; axial interface
height/count assertions passed in the 12-case axial suite. Five follow-up
source cases (two hybrid orders, 2:1 rings L2/L3, 3:1 ring L1) matched native
cell geometry after normalizing the picked fine-edge direction. Twelve GUI
generations plus the rejected-width case passed; count/trial/apply, stale
trial invalidation, archive replay, mobile and offline paths were exercised.
Independent NumPy auditing passed every downloaded mesh, with selected models
also opened/rendered in LS-PrePost.

`suggestTransitionMeshCounts` returns an explicit count adjustment plus a new
request. It preserves geometry and explicit block order, rejects noninteger
data and does not mutate the original request. The workbench's suggestion
button applies that adjustment and invalidates a stale trial. Committed
requests are in [examples/transition-mesh](../examples/transition-mesh/README.md).
