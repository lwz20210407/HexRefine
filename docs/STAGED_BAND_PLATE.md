# Native Staged-Band Plate

`planStagedBandPlate` / `generateStagedBandPlate` create a new full rectangular H8
body with a centered Y-normal fine band and symmetric coarse outer regions.
One to four explicitly ordered transition stages independently increase X or Z
section counts by2 or3. No HM, MATLAB, TrueGrid, Python or reference connectivity
is needed at generation time. This is new parametric geometry, not an imported-mesh
refinement installer or a universal CAD mesher.

## Interface

```typescript
const result=generateStagedBandPlate({
  fullSize:[120,100,3], coreWidth:20, coreRows:20,
  coarseSectionCounts:[20,1], outerRows:5,
  minimumCornerScaledJacobian:0.55,
  stages:[
    {axis:2,reduction:3,width:3},
    {axis:0,reduction:2,width:6},
    {axis:0,reduction:3,width:2}
  ]
});
```

`coarseSectionCounts` means X/Z counts. `coreRows` and `outerRows` control normal
Y counts independently. Stages are ordered from coarse toward fine; a reduction2
thus generates twice the active transverse count. Combined example refinement is
6x in X and3x in Z, not a globally uniform6x or18x refinement. Normal cell spacing
is separately disclosed, not assumed equal to the section reduction.

Stage `middleFraction` is measured coarse-to-fine: default1/2 for2:1 and1/3 for3:1.
The2:1 symmetric-boundary family requires an even active coarse section count.
Unsupported odd families are refused, not called mathematically impossible.
Counts, geometry, stage widths and output budget are validated before allocation.
Maximum output is200000 H8; this is not an industrial-scale streaming generator.

## Native Topology

- 3:1 uses the existing four-quad native template, extruded through the other axis.
- 2:1 projects the complete wall of the audited3-Hex directional prism and alternates
  its mirror across paired section columns. A template's3/4 child cells are not its
  refinement ratio. No course connectivity is loaded as a fill template.
- Successive section planes are exact shared Cartesian partitions. Upper bands are
  mirrored with positive H8 orientation. The core is a clean tensor block, not a
  transition field or repeatedly refined sweep residue.
- All corners/eight Gauss samples, count, volume1e-8, exact face ownership, unexpected
  internal free faces, exterior edge ownership and Euler2 are checked. Optional SJ
  gates are never lowered. These are sampled checks, not solver certification or
  proofs of Jacobian positivity everywhere.

## CLI And Complete Course Plate

```text
npm run build
node scripts/generate-staged-band-plate.mjs examples/input/staged-band-plate.json NEW_OUTPUT_DIRECTORY
```

Outputs: mesh-only `mesh.k`, geometric `regions.json`, `report.json`, `request.json`.
Requested PID is retained; node/EIDs are new. No source material, constraints,
contact, solver sets or analysis state are migrated. Full K connectivity/precision,
corner/eight-Gauss samples and volume are rechecked before publication. Overwrites,
invalid input, budgets and insufficient disk including1GiB reserve are refused.

The complete120x100x3 course reproduction has12128 nodes/8880 H8, identical counts
to the HM reference. CoreY40..60 has7200 unit H8; far regions have200 coarse cells
of6x5.8x3. Each side has three bands:

| Lower Y interval | Operation | H8 per side | End-plane quads |
|---|---|---:|---:|
|29..32|Z1->3|80|20->60|
|32..38|X20->40|180|60->120|
|38..40|X40->120|480|120->360|

Upper intervals mirror atY50. All eight real interface planes have two face owners.
Independent PyDYNA/NumPy checks cover every H8, complete core/far geometry, all
corners/eight Gauss points, volume36000 and a closed Euler2 exterior. Minimum
cornerSJ is0.5547002, above the explicit0.55 gate; no internal free face is hidden.

A bijective nearest-reference-node pairing maps **all8880 cell node sets and
their six-face graphs** to the course mesh. The actual node positions are not
identical: maximum difference0.099523, mostly at interior transition points,
consistent with the visible HM smoothing controls. The second-match distance gap
is0.9054. This comparison does not merge/change native nodes or relax its1e-8
conformity tolerance. It certifies matching topology and density organization,
not byte-identical replay of the HM coordinate optimization or original IDs.

Nineteen targeted tests cover sixteen mixed axis/ratio combinations, whole-case
counts/core geometry, invalid inputs/odd counts/quality/budgets, and actual CLI K
generation/readback/overwrite/refusal. Full regression results accompany the local
evidence, not a claim that previous test totals included this new module.
The resulting complete suite passes1153/1153, without skips/xfails. The new type
contract is explicitly included in `test/types/tsconfig.json` and passes the
separate final typecheck as well.

Local private reference/audit, full LSPP views, explicitly display-only detail
windows and HTML: `F:/PythonWoking/temp/20261024-hypermesh-plate-native/REVIEW.html`.
Course assets/derived reference Ks are not committed.

## Remaining Scope

Normal axisY only; rectangular full bodies, not CAD/flange/gear/pipe geometry.
No W6 cells, arbitrary old-mesh 3D WB installation, colliding fronts, GUI, task
cancellation or solver validation are implied. Mixed H8/W6 course models remain
valid reproduction targets; their cell types are not reasons to abandon them.
