# Bounded Concentric Ring Width Planning

`planConcentricRingWidths` adds an explicit width-only search around the native
coupled2:1 circular generator. It fixes the circular core, all ring inner radii,
outer geometry, height, fraction, seeds, radial-spacing policies and count
budgets. Only ring outer radii change. The requested SJ gate can be tightened
but is never reduced. It is not an arbitrary old-K repair or a global optimizer.

## Request And Acceptance

```ts
import {planConcentricRingWidths} from "hexrefine";
const result = planConcentricRingWidths({
  schemaVersion: 1,
  parameters: {
    radius: 48, height: 16, coreRadius: 16,
    radiusSegments: 40, arcSegments: 64, axialSegments: 32,
    modelFraction: "quarter",
    rings: [
      {innerRadius: 16.5, outerRadius: 17},
      {innerRadius: 18.5, outerRadius: 19.5},
      {innerRadius: 22.5, outerRadius: 24.5},
      {innerRadius: 30.5, outerRadius: 34.5}
    ]
  },
  criteria: {
    minimumCornerScaledJacobian: 0.25,
    maximumTransitionEdgeAspectRatio: 6,
    minimumTransitionEdgeToCoreRatio: 1
  }
});
// result.resolvedRequest is directly accepted by the native streaming K CLI.
```

The required criteria are global minimum corner SJ, maximum per-transition-cell
longest/shortest edge ratio, and minimum transition edge divided by the frozen
core's shortest edge. These are defined edge metrics, not an imported vendor's
aspect-ratio definition or a physical timestep certification.

`minimumRegularEdgeToCoreRatio` optionally sets the corresponding floor for all
regular annular cells. It defaults to the transition-edge floor. This prevents
a wider transition ring from leaving a very thin ordinary strip behind it.
No regular cell is created in a zero-width gap, so touching bands remain legal.
A fixed core-to-first-ring collar that already violates this floor is refused;
its geometry is not silently enlarged.

Node/element identifiers and ordinary radial partitions may change in the new
mesh. This is not an ID-preserving patch of an imported solver K file.

The source minimum SJ and requested minimum SJ are combined with `max`, never
`min`. The final full native audit still enforces all corners/eight Gauss points,
conformity, allowed exterior faces and the unchanged1e-8 discrete-volume limit.
Additional edge criteria are checked against the actual complete motif, using
the actual3D core minimum edge. Local screening values are not certificates.

The baseline must already satisfy native geometry, seed, period and allocation
contracts. This module does not change odd counts or rescue a baseline that
already exceeds its count budget. Candidate count increases are refused and
alternative candidates may be searched; limits are never silently raised.

## Finite Search And Diagnostics

Default `search.widthScales` is `[0.5,0.75,1,1.25,1.5,2,3,4]`, multiplying each
ring's coarse axial spacing. Original widths are always included. Proposals
outside the fixed window before the next ring's inner radius (or outer model
radius) are rejected. Input dimensions and radii are not rounded to a lattice.

Four checker parities are screened using the existing seven-Hex templates and
physical circular mapping. Uniform-angle rotational equivalence makes these
representative, but every returned candidate is separately prepared/audited by
the complete native generator. Screening also checks the following regular
annulus's radial, chord and axial minimum lengths.

Eligible per-ring candidates are ranked by screened SJ, then edge aspect and
width. Bounded combination search tries good-ranked combinations, skips failed
count plans, and returns the first complete audited solution. It does NOT claim
global optimality, minimum element count, or non-regression of every metric.
Even an already acceptable original mesh may receive a different recommendation;
this is an opt-in planning operation, not a background automatic modification.

Search controls and hard bounds:

| Control | Default | Maximum |
| --- | --- | --- |
| Width scales | 8 values | 16 values, plus original widths |
| `maximumLocalEvaluations` | 128 | 512 |
| `maximumPlanChecks` | 32 | 256 |
| `maximumFullAudits` | 4 | 16 |

The report retains every screened candidate's metrics/reasons, count failures,
audit attempts, criteria, actual edge ratios and old/new widths/counts. Budget
stops retain `not-evaluated` / `not-audited` states instead of fabricating a
rejection or a successful certificate.

`ConcentricWidthPlanningError` has structured `code` and `diagnostics`:

- `fixed-core-quality`: the frozen planar core is below the requested SJ.
- `fixed-collar-quality`: the fixed first regular collar violates its edge floor.
- `no-local-candidate`: no proposal for one ring passes this finite family.
- `search-budget-exhausted`: additional unvisited/unaudited combinations may exist.
- `no-validated-plan`: visited combinations fail the native count/audit checks.

None of these is a proof that general all-Hex meshing is mathematically
impossible. Invalid schema/geometry/control input is separately rejected before
planning. Expected native failures remain visible in attempt messages.

## CLI And Existing GUI Handoff

```sh
npm run build
node scripts/plan-concentric-widths.mjs planning.json NEW_PLAN_DIRECTORY
node scripts/generate-concentric-circle.mjs NEW_PLAN_DIRECTORY/resolved-request.json NEW_MESH_DIRECTORY
```

The planner CLI writes `resolved-request.json` and `planning-report.json` only.
It does not duplicate the K writer. Existing directories are never overwritten;
parents must exist, input is limited to64KiB, and failed planning creates no
output directory. The resolved request has the existing native schema and
persists the tightened minimum SJ gate. Extra edge criteria remain in the
planning report; re-editing the resolved parameters invalidates that report's
acceptance and requires re-planning or an equivalent complete edge audit.

Resolved requests can already be imported into the existing native concentric
GUI. This was tested with a complete56,640-cell preview and actual K download.
The subsequent [GUI width workflow](GUI61_WIDTH_PLANNING.md) now calculates and
displays a proposal before explicit apply/discard. Its HTTP path uses a worker;
browser cancellation remains open. GUI-selected K is checked separately for
round-trip accuracy. [Seed proposals](CONCENTRIC_SEED_PLANNER.md) can separately
resolve count constraints, but do not optimize inner radii or preserve old mesh nodes.

## Measured Evidence (2026-10-23)

R48/H16/core-R16 with all49,152 core cells frozen:

| Baseline / selected case | H8s | Min SJ | Min transition/core edge | Max transition edge ratio |
| --- | --- | --- | --- | --- |
| Deliberately thin diagnostic rings | 57,320 | 0.097774 | 0.53825 | 8.0000 |
| Previously accepted four-ring K (read-only reference) | 56,648 | 0.293169 | 1.07650 | 4.0940 |
| Automatically selected widths1.25/2.5/5/12 | 56,640 | 0.304802 | 1.34563 | 4.0000 |

Both starting layouts give the same recommendation in the default family. The
complete core coordinates/connectivity are exactly identical in independently
imported Node K files; core axial spacing stays0.5. All candidate H8 corner and
eight-Gauss values, volumes, internal free faces and edge ratios are independently
recomputed with PyDYNA/NumPy for quarter, half, full and four-ring complete models.
The thin diagnostic baseline is NOT accepted under the requested quality policy.

The R200/H600 request was also planned and its complete motif audited, without
writing another440-MiB K. The selected plan has3,312,000 H8s, minSJ0.304498 and
transition/core edge ratio1.07650. This is a deliberate trade-off: the previous
3,310,500-cell case has higher minSJ0.317993 but a transition edge below the core
minimum. Width planning meets the explicit combined policy; it does not promise
that every metric or the cell count decreases. No new full R200 K audit is claimed.

Local evidence: `F:/PythonWoking/temp/20261023-concentric-width-planner`.
Original case files remain read-only. K files, LSPP views, independent audits,
resolved requests and review HTML are not uploaded as large Git artifacts.

Final integrated regression:1073/1073, no skips, including39 new planner/CLI
tests and the public type contract. Four selected full K files receive
independent all-cell checks; the thin baseline is a negative quality example.
Seven actual LSPP views and existing-GUI import/preview/export evidence accompany
the desktop/mobile review HTML. The selected GUI K separately passes PyDYNA,
all-corner/eight-Gauss and native-connectivity/precision comparison.

Remaining: joint inner-radius/seed/count optimization,
nonperiodic end handling, mixed/3:1 bands, broader search families, arbitrary old
O-grid/weak-balance installation and solver-state migration. This native
extension is not a claim of full GUI_tg source-equivalence.
