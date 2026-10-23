# Coupled Concentric Circular Generator

This native TypeScript module adds a filled circular core followed by explicit
concentric radial transition bands. Every transition halves the angular count
and doubles the axial spacing together (2:1 / 4-to-2). It does not cut a square
refinement boundary into a cylinder. Core mapping joins are internal structured
patch edges; the fine-region outer boundary is circular.

Status: API, bounded materialization, periodic streaming K CLI and measured
one-through-four-ring cases. Not a new GUI menu, arbitrary imported-Hex
refinement, a 3:1 ring family, tilt, or an automatic engineering optimizer.
Neither MATLAB nor TrueGrid nor Python is needed to generate the mesh.

## Example: R200, H600, Core R24

```ts
import {
  planConcentricCircularMesh, prepareConcentricCircularMesh,
  generateConcentricCircularMesh,
  iterateConcentricCircularNodes, iterateConcentricCircularElements
} from "hexrefine";

const spec = {
  radius: 200, height: 600, coreRadius: 24,
  radiusSegments: 48, arcSegments: 80, axialSegments: 1200,
  modelFraction: "quarter" as const,
  minimumCornerScaledJacobian: 0.2,
  rings: [
    {innerRadius: 24.5, outerRadius: 25.5},
    {innerRadius: 32.5, outerRadius: 34.5},
    {innerRadius: 64.5, outerRadius: 72.5}
  ]
};
const plan = planConcentricCircularMesh(spec); // Count validation only.
const periodic = prepareConcentricCircularMesh(spec); // Audited H8 motif.
// Native streaming consumers need not materialize the complete model:
for (const point of iterateConcentricCircularNodes(periodic)) { /* write node */ }
for (const cell of iterateConcentricCircularElements(periodic)) { /* write H8 */ }
// generateConcentricCircularMesh(spec) is limited to two million total H8s;
// this 3.31-million-cell example must use the periodic/streaming route.
```

The core has the same 2,240-quad mapped section as the previously accepted
R200/H600 case, extruded through all 1,200 fine layers without re-refinement:
2,688,000 core H8s. The complete model has 3,390,917 nodes and 3,310,500 H8s.
The periodic motif is H8 high, with 48,707 nodes and 44,140 H8s, repeated 75
times. No frozen `core_section.json` is read by the implementation.

| Region | Angular intervals per quadrant | Axial spacing | Radial rule |
| --- | --- | --- | --- |
| Core / inner collar | 80 | 0.5 | Mapped core; regular collar R24..24.5 |
| Ring R24.5..25.5 | 80 to 40 | 0.5 to 1 | Seven-Hex transition columns |
| Regular R25.5..32.5 | 40 | 1 | At most 1 radial spacing |
| Ring R32.5..34.5 | 40 to 20 | 1 to 2 | Seven-Hex transition columns |
| Regular R34.5..64.5 | 20 | 2 | At most 2 radial spacing |
| Ring R64.5..72.5 | 20 to 10 | 2 to 4 | Seven-Hex transition columns |
| Regular R72.5..200 | 10 | 4 | At most 4 radial spacing |

Outer circumferential edges are deliberately much larger than 4: this is not
an isotropic 4-mm far-field promise. All dimensions follow the input's chosen
consistent unit. Millimetres are used in the examples, not hard-coded by the API.

## Parameter Contract

- `radiusSegments` and `arcSegments` have the same meaning as the
  [mapped circular core](MAPPED_CIRCULAR_CORE.md): whole quadrant radius and
  whole 90-degree arc counts. They must satisfy the core's convexity/count rules.
- `axialSegments` is the whole-height fine-core layer count. Geometry is not
  silently scaled and counts are not automatically rounded.
- `rings` are ordered nonoverlapping `{innerRadius, outerRadius}` bands outside
  the core and inside `radius`. Touching rings are allowed if their final audit
  passes. This is not permission to overlap transition volumes.
- `radialSize` controls the maximum regular radial interval before the first
  transition, defaulting to the fine axial spacing. A ring's `radialSize`
  controls the regular annulus outside that ring, defaulting to its coarse
  axial spacing. Counts use `ceil(width/radialSize)`; the endpoints stay fixed.
- For L rings, the angular count must be divisible by 2^L. The axial fine count
  must be divisible by 2^(L+1): this implementation uses a two-coarse-layer
  repeating checker pattern. This is a supported-template contract, NOT a
  proof that every other odd-count all-Hex mesh is mathematically impossible.
- `quarter`: X>=0/Y>=0; `half`: Y>=0 with both X signs; `full`: all quadrants.
  Exact topological sharing across reflected axes replaces coordinate welding.
  No physical symmetry BC is generated automatically.
- One to eight rings are accepted syntactically; budgets and final quality can
  reject them. One, two, three and four rings have measured coverage. This is
  not a claim that eight rings fit the bounded motif budget for any seed count.
- Default full-model limit is 8,000,000 H8s; explicit maximum is 20,000,000.
  The motif limit is at most 200,000 H8s. Materialization additionally has a
  2,000,000-H8 limit. Streaming avoids expanding copies in RAM but still stores
  and audits the motif; it is not an unbounded-memory/performance guarantee.
- Optional `minimumCornerScaledJacobian` in (0,1] rejects output below that
  requested engineering gate. Strictly positive corner/eight-Gauss Jacobians,
  no internal unmatched faces, no hanging interfaces and 1e-8 relative discrete
  volume tolerance are mandatory regardless of this optional limit.

Unknown fields, inconsistent seeds, out-of-domain bands and unsafe count budgets
are refused. No template solver or optimizer expands the fine core or moves
the requested ring boundaries to make a failed case appear successful.

## Construction And Certification

The generator reuses the native three-patch mapped core and the repository's
existing eight square symmetries of the TrueGrid-derived seven-Hex template.
Neighbouring angular/axial columns use complementary checker orientations.
The chart is `(angle, Z, inward radius)`; physical element orientation is checked
and corrected. Both transverse fine-face counts reduce together at each ring.

Core/node entity keys, ring-boundary keys and integer finest angular/axial
indices share nodes exactly. Physical radii need not fall on a rounded global
coordinate lattice. Template quarter-steps affect the radial interior of a
band, not the uniform core. Only the motif's lower and upper plane partitions
are identified between copies. Their actual quadrilateral partitions, not just
their node coordinates, must match before export.

Quality includes minimum corner SJ, all eight Gauss determinants, H8 volumes,
per-region minimum/maximum edge and worst edge aspect ratio. Region ranges and
region element statistics refer to the motif; complete core/model counts are
separate plan fields. The report never claims engineering acceptance.

The expected discrete volume uses the final outer polygon, not the analytic
cylinder. Its conservation is checked independently of faceting error relative
to pi*R^2*H. A low angular count can preserve discrete volume perfectly while
approximating the analytic circle poorly. Periodic surface traces can be closed
zigzag patterns; a single horizontal surface phase is not promised.

## Versioned Streaming K CLI

```json
{
  "schemaVersion": 1,
  "parameters": {
    "radius": 200, "height": 600, "coreRadius": 24,
    "radiusSegments": 48, "arcSegments": 80, "axialSegments": 1200,
    "modelFraction": "quarter", "minimumCornerScaledJacobian": 0.2,
    "rings": [
      {"innerRadius": 24.5, "outerRadius": 25.5},
      {"innerRadius": 32.5, "outerRadius": 34.5},
      {"innerRadius": 64.5, "outerRadius": 72.5}
    ]
  }
}
```

```sh
npm run build
node scripts/generate-concentric-circle.mjs request.json NEW_OUTPUT_DIRECTORY
```

The parent must exist, and an existing output directory is never overwritten.
The CLI checks free disk with a 1-GiB reserve, writes fixed-format NODE/SOLID
records into `mesh.k.partial`, rereads every record against fresh iterators,
checks coordinate precision and computes SHA-256 before naming it `mesh.k`.
`motif.k` and `report.json` retain the smaller certificate and the parameters,
counts, region quality and full-stream verification. Interrupted/failed output
must not be mistaken for completed validation. PID is 1; materials, loads,
contacts, sets and solver boundary conditions are not inferred.

A Python GUI may call this Node CLI; there is no pure-Python production kernel
and no new GUI control integration in this change.

## Evidence And Remaining Work

Evidence directory:
`F:/PythonWoking/temp/20261023-concentric-coupled-generator`.
The R200/H600 K was independently parsed and every element's eight corner SJs
and eight Gauss determinants recalculated in Python. All expanded nodes and
connectivity were independently matched to the PyDYNA-imported motif, whose
actual boundary partitions and free faces were separately counted. The large
file itself was checked with bounded fixed-field parsing, not claimed to have
been imported in full with PyDYNA. Smaller quarter/half/full/two-ring and
four-ring full K files were also imported with PyDYNA.

Measured results: R200/H600 minSJ 0.3179931376 and relative discrete volume
error about 1.3e-15; all 2,688,000 core elements remain uniform in Z at 0.5.
Compared with the older successful core, geometric quad connectivity is
identical and maximum XY difference is 6.6e-8 mm. The new R48/H16/core-R16
four-ring case has 60,000 nodes, 56,648 H8s and minSJ 0.2931689924; axial sizes
are 0.5/1/2/4/8 and angular counts are 64/32/16/8/4.

Two deliberately poor ring/aspect layouts produced low positive SJs around
0.117 and 0.057. They are diagnostic negatives, not engineering deliveries.
The explicit quality-gate tests reject such failures; positivity and successful
K export alone are not used to claim good shape quality.

Final validation: **1025/1025** integrated tests pass with zero failures, skips
or pending tests, including 39 added core/CLI regressions, the public type
contract and synchronized standalone runtime. Five real cases have independent
all-cell corner/Gauss audits; ten actual LS-PrePost views are linked from the
desktop/mobile review HTML.

Still separate: GUI integration, automatic band-width/seed optimization,
additional ring counts and extreme shapes, 3:1/mixed-ratio ring templates,
nonperiodic end-height handling, tilt/offset, material/solver semantics and
arbitrary imported O-grid/weak-balance template installation.
