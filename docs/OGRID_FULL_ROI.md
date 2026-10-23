# Full-Section O-grid Refinement

Alternative original-parent entry: [native macro fields](OGRID_NATIVE_MACRO_FIELD.md)
compile and install whole-parent candidates directly, including explicitly budgeted
32+7 layered shells. [Full real-ROI evidence](OGRID_MACRO_FIELD_VALIDATION.md) and an
external-ID-preserving CLI are available. This does not change this API's defaults,
or imply arbitrary3D weak-balance, multi-front or solver-state support.

## Scope

`refineExtrudedOgrid(mesh, options)` is a native TypeScript path for complete
axial bands of an H8 extrusion. It does not invoke Python, MATLAB or TrueGrid.
It does not substitute an easy local patch for a requested full section.

- Core cells are uniform8 once per level, with exact finest tensor descendants.
- Existing seven-Hex face fields are solved with exact shared-face partitions.
- Explicit lateral symmetry cuts can be excluded from exposed-ring **phase**
  matching. This does not exempt a single face from conformance checking.
- Odd open chords may request bounded topological sheet insertion on a
  **straight, constant, full circular section**. Harmonic interior and uniform
  angular boundary redistribution avoid exporting a near-zero-width sheet.
- Axial weak level requests may be conservatively expanded into separated
  strong-balance support. Original requested layers, effective layers and every
  promoted layer are reported. This is not direct CinoLib WB scheme coverage.

This is an opt-in API/CLI, not a newly connected GUI control. Existing local
closure/session paths are unchanged. No arbitrary valence-3/5 macro coverage,
partial-section weak-balance coverage or solver-state migration is claimed.

## Interface

```ts
const result = refineExtrudedOgrid(mesh, {
  axis: 2,
  bands: [{ min: 4, max: 16, level: 1 }],
  completion: "circular-sheet",
  maxAddedSectionColumns: 128,
  maxPromotedSourceLayers: 8,
  maxOutputElements: 1000000,
  minimumEdgeFraction: 0.1
});
```

Bands select original axial layers by their centroids. Overlapping targets take
the maximum requested level (1, 2 or 3). Full-section support must exist; the
planner may reject the request, never silently crop the ROI. A circular-sheet
permission does not mean every section admits the bounded sheet construction.
Closed odd chords, branched/interior-ended sheets, holes, excessive null-space
or budgets, noncircular/tapered completion, inverted redistributed quads, small
edges, unsupported phase fields, lost coarse far field and failed quality or
conformance checks are rejected.

`fullSelectedOriginalParentsCovered` certifies the selected imported parent
identities, **not spatial containment of the original physical band/domain**.
`selectedLayerIntervals` shows the actual centroid-selected parent intervals;
unaligned requested band ends are not silently declared exact physical cuts.
`originalPhysicalRoiCoverageVerified` is false without an independent geometric
certificate. Circular resampling may leave some original polygon vertices
outside the new polygon even when its total volume increases. The analytic
circle, original discrete polygon and completed coarse domain are distinct.
Target levels are minimum resolution requests: lower-level bands may provide
finer transition support; only the finest core has exact tensor child counts.
`promotedSourceLayerIndices` describes target-field promotions, not the entire
changed support footprint; each stage separately reports changed source layers.
Exact planned output counts, including all transition children, are checked
before mesh assembly. These are output-count budgets, not hard peak-memory or
planner-time limits. There is no public arbitrary-explicit-macro apply gate.

For a quarter cylinder cut on X=0 and Y=0, use `completion: "none"` and
`symmetryPlanes: [{axis:0,coordinate:0},{axis:1,coordinate:0}]`. These must be
lateral exterior coordinate planes, not cuts through the specimen interior.
Slightly mapped source columns may be refined unchanged; circular-sheet
redistribution itself requires constant straight columns.

```json
{
  "schemaVersion": 1,
  "kind": "extruded-ogrid",
  "meshFile": "specimen.json",
  "partId": 1,
  "options": {
    "axis": 2,
    "bands": [{"min":4,"max":16,"level":1}],
    "completion": "circular-sheet"
  }
}
```

Run `node scripts/refine-ogrid.mjs request.json NEW_OUTPUT_DIRECTORY` after
`npm run build`. Relative source paths resolve against the request. The CLI
refuses an existing output directory and writes `mesh.k`, `completed.k`,
`lineage.json`, `request.json`, `report.json`. Output has only NODE/SOLID mesh
cards and an explicit single specimen PID. Extract platens and other parts
before supplying the mesh. Original IDs may be normalized; source PID/material,
sets, loads, contacts, integration-point state and analysis cards are not
inferred or migrated. K connectivity/coordinates are checked after readback.

## Geometry And Provenance

`completedParentIds` index the compensated coarse mesh, not directly the
original source. `sourceParentProvenance` maps each compensated parent to
original imported parents; inserted columns can have two source parents.
Original requested parent IDs remain separately recorded.

Circular compensation moves original section nodes as well as adding columns.
Its coordinate displacement, circle residual and edge fraction are explicit.
Changing polygonal boundary sampling can change the source's discrete volume:
this is reported **separately** from refinement conservation relative to the
completed coarse mesh. It is not hidden by widening the `1e-8` refinement
volume tolerance. Fine boundary nodes subdivide the resulting Q1 faces; they
are not automatically reprojected onto an analytic cylinder.

## Real Full-ROI Evidence (2026-10-21)

Evidence root: `F:/PythonWoking/temp/20261021-hexrefine-ogrid-full-roi/`.

| Specimen / requested region | Result |
| --- | --- |
| TC4 quarter compression, central60%, all135 columns | 4860 -> 27270 H8;2970 original core parents, each8 tensor children;1620 unchanged coarse parents;min cornerSJ0.20975;volume error3.62e-9;no compensation |
| Original iron full cylinder, Z4..16, all1116 source columns | 66960 -> 69120 compensated -> 373248 H8;36 inserted columns;41472 completed core parents each8 children;minSJ0.17598;separate source-to-completed volume change+0.003071% |
| Same iron full central60% level1 plus full-section Z9.5..10.5 level2 | 686592 H8;4608 deepest completed core parents each64 exact quarter-grid children;25344 coarse parents remain;minSJ0.17598;independent8-Gauss/face/volume audit passed. Existing outer level1 provides support, so this is not a real weak-gap promotion benchmark. |
| TC4 same complete region requested at level2 | **Rejected**, patch volume error1.353e-8 exceeds1e-8; no level2 K exported. Do not claim all mapped multi-level requests work. |

Subsequent opt-in fix: [MAPPED_TRANSITION_CONSERVATION.md](MAPPED_TRANSITION_CONSERVATION.md)
documents the warped-face flux defect and two complete TC4 level2 outputs.
Default trilinear mapping still rejects the old request; explicit conservative
face geometry passes without a widened gate. The new full-band direct31 mode
does not imply arbitrary weak-balance/corner coverage.

### Separated Direct Bands (2026-10-22)

The opt-in direct mode now accepts separated full-section bands of constant
level1,2 or3. Each original shell parent contains respectively7,31 or127 H8;
each core parent has exactly8,64 or512 tensor descendants. No whole-parent
uniform halo is promoted. Disjoint one-parent shells need at least two
zero-target source layers; three zero layers leave a whole unchanged coarse
layer between shells. A subsequent research extension permits one zero-target
layer to host two virtual half-shells reassembled as whole original parents.
That is not general edge/vertex coverage: its TC4 minSJ0.135 example is not the
recommended delivery. Adjacent different positive levels remain rejected.

Full-section planning bypasses the local-box sweep route, including when the
selected set has several disconnected axial intervals. Exact seven-Hex wall
partitions and closed exterior phases remain enforced. The single-level,
single-band path has not been replaced with an unrelated template family.

`macroFinalization.shellGroups` lists depth, number of shell parents and actual
children per parent. `childrenPerShellParent` stays31 for the old level2 case;
it is null for mixed-depth shells, rather than reporting a fictitious common
count. The common axial station exponent still applies to the entire field.
The conservative geometry policy must remain explicit. No new GUI controls,
multi-direction CinoLib schemes or unbounded arbitrary-valence contract is
implied by this extension.

For the user's subsequent TC4 shape review, compare stepwise support instead
of compressing two transitions into one parent. `strongSupportLayers:2` retains
an intermediate-size plateau. Actual H8 face comparison and size statistics
are documented in [TC4_TRANSITION_SHAPE_REVIEW.md](TC4_TRANSITION_SHAPE_REVIEW.md).
This does not automatically engineering-qualify every input with this setting.

Fixed tests include exact core counts, unchanged far field/input, axis
permutations, K roundtrip, explicit odd-sheet consent/budgets, full-band
weak-to-strong completion and the quarter-section symmetry-phase regression.
Independent PyDYNA/NumPy audit checks source/parent identity, duplicate and
nonmanifold faces, all original requested parents, exact finest tensor nodes,
positive corner/8-Gauss Jacobians and unexpected internal free faces. Native
LS-PrePost axial/transverse/full-model views are kept beside candidate K files.
`OGRID_FULL_ROI_REVIEW.html` contains all three audited outputs and9 LSPP views;
desktop1440x1000/mobile390x844, image/link completeness and the model filter were
checked. Initial full suite:881/881 passed; after interface hardening the full
suite passed883/883. New regressions distinguish parent coverage from
physical-domain coverage, remove the accidental public arbitrary-plan apply
entry and check exact output counts before assembly. Older original iron run
reports are retained with separate coverage-semantics corrections; metadata
correction is not represented as a new mesh-generation run. No new GUI integration is implied by the
standalone runtime rebuild.

## Harvested Nine-Hex Sample Is Not A Complete Macro

`docs/trbb_evidence/trbb_valence3_absorber_rectilinear.json` is preserved as a
local TrueGrid sample, **not registered as a complete three-parent template**.
Independent rational audit found positive local Jacobians but only
`7875/128 = 61.5234375` summed volume versus `375/4 = 93.75` for the three
natural complete parent columns:65.625%. Its fine top has3 quads rather than
12 and15 sampled free faces lie inside that parent macro. Those faces may
legitimately connect to omitted TrueGrid cells; the finding is about the
incomplete extraction, not evidence that the original full TG mesh is broken.

The audit ledger is in `research/audit.md` and `research/sources.json` under
the evidence root. Completing a true corner macro still requires full parent
coverage, all outer face signatures and real original-parent provenance.
Good SJ and a closed sampled boundary alone are insufficient.
