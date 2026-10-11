# Native Rectangular Grading

Status: experimental, independently implemented and validated on the stated
cases. MATLAB and TrueGrid are development oracles, not runtime dependencies.
This is a new-mesh generator for one rectangular solid. It does not add arbitrary
anisotropic refinement to every imported Hex mesh or to the existing session UI.

## Supported Contract

- Independent X/Y/Z reductions: 2 (4-to-2) or 3 (3-to-1).
- `thicknessTransition: false` makes the effective Z reduction 1 at every stage.
- One or two transition bands, using the measured D/B/C/A partition rules and
  the original rounded/aligned 0.618 intermediate-band allocation.
- Quarter: X>=0,Y>=0; half: both X signs,Y>=0; full: both X/Y signs.
  Z runs from 0 to the supplied thickness. These are geometry choices, not
  solver symmetry boundary conditions.
- Single- and double-band tilt: the core shifts by H*tan(angle) across its
  thickness; outer X faces stay fixed. Double bands use the measured intermediate
  offset, with a continuous piecewise mapping. Quarter mode forces angle zero,
  following the rectangular branch's contract.
- Mesh-only LS-DYNA K output: NODE and ELEMENT_SOLID with KEYWORD/END framing.
  PID defaults to 1. No material, contact, load, or boundary-condition cards.

`angleCorrection: true` explicitly opts into reducing an excessive tilt toward
zero on a 0.1-degree grid until every planned X band retains positive width.
The requested angle stays in `plan.spec.angleDegrees`; the actual angle and a
warning are returned separately. Default false still rejects invalid widths.
This is a native improvement: the source rectangular `correction` checkbox is
guarded by a literal `b8=0` and cannot reach its adjustment loop. It is not a
quality optimizer: every corrected mesh still undergoes Jacobian/volume audits
and can have low-SJ warnings near the geometric limit. Angles at/outside 90
degrees remain rejected even with correction enabled.

Unsupported or invalid inputs are rejected: fractional outer counts, collapsed
bands, incompatible 4-to-2 interface counts, nonpositive Jacobians, internal free
faces, hanging interfaces, and an estimated output above the experimental
two-million-cell allocation limit. This is not a guaranteed performance bound.
Angles must be finite and strictly between -90 and 90, and each deformed band
must retain positive width. All dimensions use the caller's consistent units.

The requested target size can change after count alignment. The returned plan
contains actual counts and component spacings. A 4-to-2 stage halves a count;
two stages reduce it by four, even when the input count must be divisible by 16.

## API

```javascript
import { generateRectangularGradedMesh } from './dist/index.js';

const result = generateRectangularGradedMesh({
  fullSize: [80, 80, 16],
  refinedSize: [32, 32],
  fineSize: 1,
  coarseSize: 2,
  reductions: { x: 2, y: 3, z: 3 },
  thicknessTransition: true,
  transitionStages: 1,
  modelFraction: 'half',
  angleDegrees: 0
});
```

`planRectangularGrading` is also exported for parameter-only inspection. The
generator returns the mesh, resolved plan, coarsest base mesh, original-parent
lineage, fine-core parent IDs, and quality metrics. For two stages the expected
core child count is `(rx*ry*rz)^2` relative to that coarsest base. Core descendants
must lie on the requested tensor grid; this prevents unnoticed extra refinement.

Each pass may change only its selected block and adjacent support. The second
pass receives the first pass's Cartesian interior, never its transition shell.
Untouched far-field parents retain their connectivity and geometry (or their
corresponding mapped geometry when tilted).

## Python GUI Bridge

Build TypeScript once with `npm run build`. A versioned JSON request is:

```json
{
  "schemaVersion": 1,
  "kind": "rectangular-solid",
  "parameters": {
    "fullSize": [80, 80, 16],
    "refinedSize": [32, 32],
    "fineSize": 1,
    "coarseSize": 2,
    "reductions": { "x": 2, "y": 3, "z": 3 },
    "thicknessTransition": false,
    "transitionStages": 1,
    "modelFraction": "half"
  }
}
```

```text
node scripts/generate-graded-rectangle.mjs request.json NEW_OUTPUT_DIRECTORY
```

Python can invoke that command with `subprocess.run(..., check=True,
capture_output=True, text=True)` and parse stdout as JSON. This is explicitly
**Python calling the Node kernel**, not a pure-Python mesher. The output includes
`mesh.k`, `report.json`, and `lineage.json`. Existing output directories are not
overwritten. Invalid generation does not create an output directory.

The CLI opts into compact high-precision numbers within 16-column NODE fields and
checks K read-back coordinate error against the mesh edge scale. Existing K
export calls retain their previous precision unless `coordinatePrecision` or
`coordinateFormat` is specified. This avoids changing established output snapshots globally.

## Evidence and Limits

- 36 single-band reference cases: 4 X/Y combinations x 3 Z modes x 3 model
  fractions. All produced native conforming meshes, positive corner/Gauss
  Jacobians, preserved volume, exact tensor-core ratios, and coarse far fields.
- 16 double-band reference cases: all 12 ratio modes on a quarter model plus
  half/full 2/2/2 and 3/3/3. Independent Python topology/quality auditing also
  passed. Four thickness-off cases intentionally differ from the original GUI's
  state-dependent first-call Z alignment (16 layers instead of 18).
- In the single-band thickness-off cases, native and TG topologies match up to
  node numbering. In other cases, native topology may differ; the raw TG meshes
  contain unmatched interfaces that the native generator closes directly.
- A 10-degree single-band comparison maps all 5566 original nodes uniquely to
  native nodes, with maximum coordinate difference about 0.000603 in the
  4000-wide example, due to the original command/writer rounding.
- Double-band TG experiments at -10, 0, and +10 degrees confirm the continuous
  intermediate-offset profile; maximum profile discrepancy is about 3.82e-5
  in the 80-wide reference. Positive/negative native tilt has fixed regression
  coverage. These samples do not prove every extreme angle is well-conditioned.
- Some double-band samples have minimum corner SJ near 0.147-0.165. They are
  positive but not high-quality by default; values below 0.2 produce an explicit
  warning. No quality threshold or merge tolerance was relaxed to hide defects.

The local evidence directory is
`F:/PythonWoking/temp/20261011-hexrefine-gui61-validation`:
`matrix_f01`, `matrix_f02`, `double_tilt_probe`, `native_directional`, and
`cli_examples`. It retains reference TG/K, native K, lineage, quality results,
section images, and source instrumentation manifests. Recovered proprietary
source is not copied into this repository.

Still outside this rectangular API: circular targets, cylindrical/multilayer solids, rebar
and BEAM semantics, 2D generators, general imported-mesh repair, and GUI wiring.
The separate [initial circular generator](GUI61_NATIVE_CIRCLE.md) has its own
restricted contract; it must not be assumed to inherit every rectangular option.
The [Q1 generators](GUI61_NATIVE_QUAD.md) and [solid cylinder generator](GUI61_NATIVE_CYLINDER.md)
are now also implemented under separate, explicitly limited contracts.
