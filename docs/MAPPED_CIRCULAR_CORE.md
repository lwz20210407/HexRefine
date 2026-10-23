# Native Structured Mapped Circular Core

Status: a bounded TypeScript geometry module, not a claim that the concentric
grading workflow or its GUI is complete. It creates a filled circular section
with three conforming mapped quadrilateral patches per quadrant. Uniform +Z
extrusion produces H8 solids. No optimization, frozen case template, Python,
Gmsh, MATLAB or TrueGrid runtime is needed by these entry points.

## API

```ts
import {
  planMappedCircularCore,
  generateMappedCircularCore,
  generateMappedCircularPrism
} from "hexrefine";

const section = {
  radius: 24,
  radiusSegments: 48,
  arcSegments: 80,
  modelFraction: "quarter" as const
};
const plan = planMappedCircularCore(section);
const quad = generateMappedCircularCore(section);
const hex = generateMappedCircularPrism({
  ...section, height: 8, axialSegments: 16
});
```

`radiusSegments` counts each entire radius of a quadrant. `arcSegments` counts
the entire 90-degree arc and defaults to `radiusSegments`. These are boundary
counts, not per-patch counts and not refinement ratios. There is no hidden
rounding, automatic seed repair, or edge-length uniformization.

For `N = radiusSegments`, `A = arcSegments`, define `n = A/2`, `m = N-n`.
The central patch has `n*n` cells; each wing has `m*n` cells. Thus a quadrant
has `n*n + 2*m*n` quads and `quads + N + n + 1` nodes. The API requires:

- Finite positive radius, safe positive integer counts, and an even `A`.
- `N > A/2`, leaving at least one radial wing interval.
- A valid `quarter`, `half` or `full` fraction.
- A strictly convex internal central patch with its join inside the circle.
- An explicit/default element budget no greater than 2,000,000 cells. Prism
  budgeting checks the complete extruded count before constructing the mesh.

The central axis extent is `radius*n/N`. Its symmetric join defaults to
`min(0.84*axisExtent, 0.625*radius)`. `innerCornerFraction`, when supplied,
sets each join coordinate divided by radius; invalid joins are rejected.
The internal join is a mesh-mapping feature, not a square fine-region boundary.
The exposed circular boundary remains a single fixed-radius curve.

The R24/48/80 example produces 2,329 nodes and 2,240 quads, a central axis extent
of 20 and join `(15,15)`. Its minimum corner SJ is about 0.800. Edge lengths are
about 0.34835..0.62862: a nominal 0.5 radius-edge pitch is not a promise of
identical 0.5-by-0.5 quads. The 16-layer example produces 35,840 H8 cells and
39,593 nodes with exact 0.5 axial spacing. Its entire section is uniform in Z;
it does not generate annular transition bands.

## Geometry, Topology And Quality

- Quarter means X>=0/Y>=0, half means Y>=0 with both X signs, and full means
  all quadrants. Reflections share exact topological axis/origin nodes and
  reverse local connectivity as needed to preserve positive orientation.
- `patchElementIds` identifies center/x-wing/y-wing elements across copies.
- Section node sets are `plane_x0`, `plane_y0`, `circular_boundary`; prism sets
  are `plane_x0`, `plane_y0`, `outer_cylinder`, `bottom`, `top`.
- These are geometric sets. In a full model, coordinate planes are internal
  planes, not automatically solver symmetry boundary conditions.
- The section audit checks duplicate cells, edge manifoldness, allowed external
  boundaries, all quad corner SJ values, four Gauss determinants, signed area
  and hanging interfaces. It additionally reports angles and actual edge sizes.
- Prism quality uses exact straight-extrusion identities from the audited XY
  section. The tests separately recompute all corner/8-Gauss H8 Jacobians,
  signed volumes and allowed boundary faces on small quarter/half/full solids.
- Discrete faceted area/volume conservation and error from the analytic circle
  are reported separately. Neither positive SJ nor successful export certifies
  engineering quality, timestep, convergence or a penetration simulation.

## Versioned Node CLI

```json
{
  "schemaVersion": 1,
  "mode": "prism",
  "parameters": {
    "radius": 24,
    "radiusSegments": 48,
    "arcSegments": 80,
    "modelFraction": "quarter",
    "height": 8,
    "axialSegments": 16
  }
}
```

After `npm run build`, run:

```sh
node scripts/generate-mapped-circle.mjs request.json NEW_OUTPUT_DIRECTORY
```

`mode` is `section` or `prism`; unknown schema/options are rejected. The output
parent must exist, and an existing output directory is never overwritten.
The CLI writes `mesh.k`, `mesh.inp`, `report.json` after native K/INP readback.
The report retains the request, plan, quality, patch IDs and geometric sets.
INP also receives these sets. K is mesh-only: NODE plus SHELL for sections,
NODE plus SOLID for prisms. No materials, loads, contact or physical BCs are
inferred. A Python GUI may invoke this Node CLI; it is not a pure-Python kernel,
and cancellation/progress integration is not implemented by this module.

## Compatibility And Remaining Work

The coordinate helper is shared with the existing GUI61 circular Q1 generator.
That generator keeps its fixed 3:1 contract, count policy and node ordering;
quarter/half/full geometry/connectivity SHA-256 regression tests guard this.
No existing GUI menu or imported-mesh refinement policy is changed.

Still separate: a production parameterized multi-ring angular/axial grading
generator, its GUI, industrial-scale streaming extrusion, and arbitrary
O-grid/weak-balance template installation. The successful R200/H600 case
scripts are not silently promoted to general support by this core module.

## Independent Case Checks (2026-10-23)

Four native CLI results were imported independently with PyDYNA and audited
using NumPy geometry calculations, not only the native reported quality:

| Case | Nodes / elements | Minimum corner SJ | Independent check |
| --- | --- | --- | --- |
| R24 quarter, radius/arc 48/80 | 2,329 / 2,240 Q1 | 0.800 | Area 452.360274292876; previous successful core connectivity matches |
| Same section, H8, 16 layers | 39,593 / 35,840 H8 | 0.800 | Volume 3618.88219434301; minimum 8-Gauss determinant 0.00785377439 |
| R6 full, radius/arc 12/16, H2, 4 layers | 2,725 / 2,048 H8 | 0.82693 | Volume 225.831491319308; minimum 8-Gauss determinant 0.00757044488 |
| R24 quarter, radius/arc 48/48 | 1,801 / 1,728 Q1 | 0.82693 | Area 452.308600928233 |

The previous successful core comparison is numbering-independent: all node
positions match within 6.6e-8 mm and the geometric cell connectivity is identical.
No frozen geometry fixture is required by the generator. These core-only tests
do not re-certify the complete earlier R200/H600 graded target.

Actual LS-PrePost views and a desktop/mobile-checked review page are retained
under `F:/PythonWoking/temp/20261023-mapped-circular-core-module/REVIEW.html`,
alongside inputs, K/INP outputs, independent JSON results and the audit script.
Source-level regression coverage is in `test/mapped-circular-core.test.mjs`
and `test/mapped-circular-cli.test.mjs`; the public API type contract is checked
by `test/types/mapped-circular-core.contract.ts`.

Final integrated validation passes 986/986 tests, with zero failures, skips or
pending tests, including 70 added module/CLI cases, type checking and a rebuilt
standalone embedded runtime. The first full run had one stale standalone-bundle
failure; rebuilding the bundle and rerunning the entire suite resolved it.

## Method And Sources

Implementation reuses the repository's circular three-patch mapping and existing
quality/export machinery. The new code provides independent boundary counts,
topological seam sharing, symmetry copies, budgets and a reusable API.
It does not redistribute recovered MATLAB sources or proprietary mesher code.

- [TrueGrid tutorial: butterfly topology and cylinder projection](https://truegrid.com/Data/TGTUT22-min.pdf).
- [HyperMesh: partitioning mappable solids and solid-map workflow](https://www.help.altair.com/2021/hwdesktop/hwx/topics/pre_processing/meshing/meshing_solid_map_unity_c.htm).

Verification details and remaining scope are tracked in
[GUI61_PORT_TODO.md](GUI61_PORT_TODO.md). Source/reference demonstrations do not
replace the native tests or certify every possible seed/shape combination.
