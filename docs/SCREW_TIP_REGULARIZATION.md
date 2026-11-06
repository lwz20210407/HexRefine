# Screw Tip Regularization Target

## Frozen V2 Scope

`tools.bolthex.screw_tip_regularization` prepares a small additive **geometry
target candidate**, not a repaired mesh or independent design CAD. It uses
the actual raw/phase Screw's EID 5048 and actual binary64 coordinates, with
NID 9384 as P. Source nodes, elements, original K files and retained/thread
geometry are not moved or deleted. No solver, installation or CAD host runs.

The v2 definition is:

```text
H = conv(eight images of the small source parameter box)
C = orthogonal octant box based at P
H_prime = conv(H union C), at most 16 input support points
Omega_prime = original source solid-image domain union H_prime
```

**Never append H_prime or either witness to the old K as overlapping volume
elements.** The JSON is input to later actual BRep/mesh and union-boundary
checks. Complete core/end/interface remeshing is not implemented here.

Reports explicitly set `independentDesignCad=False`,
`sourceMeshDefinesGeometry=True`, `wholeScrewAccepted=False`, `coreMeshed=False`,
`repairCompleted=False`, `boundaryDistanceCertified=False` and
`engineeringGeometryAccepted=False`.

## Existing Policy, Not A New Tip Policy

The actual `screw-phase-compensated-v2/report.json` is read and SHA-256 bound.
Its approved policy is `CadAccuracyPolicy.engineering(0.2)`, with critical
distance budget **0.0005 mm**. The entire policy manifest and raw/phase source
hash bindings must match. Strict, looser, or newly inferred tip-size policies
are rejected. No incidental shortest edge or radius-derived 0.00486 mm target
is used.

Before scale selection, the existing budget is allocated as:

- Geometry target, including floating output error: **0.00025 mm**.
- Reserved future mesh approximation: **0.00025 mm**, not yet consumed or
  verified by a produced mesh.

**Scope distinction:** the proved distance is closed **solid-domain
Hausdorff distance** for the additive union. It does not prove boundary
Hausdorff distance and cannot establish the policy's `maximumSurfaceDistance`
acceptance. Actual union-boundary comparison remains mandatory, including
the distance from original faces covered by H_prime to the new boundary.
The numerical budget is a candidate screening allocation, not a declaration
that engineering geometry acceptance is complete.

## Construction And Proofs

The local source axes are identified from E5048 at P: one radial axis s and
two downward axes t,w, ordered by their axial increment. For these sources
they correspond to original u, reversed v, reversed w. Source vertices are
converted with `Fraction.from_float`; the real trilinear polynomial on those
binary64 values is the geometry definition.

The immutable finite search grid is:

```text
lambda = 2^-i, i=2..9
tau    = 2^-j, j=2..9
omega  = 2^-k, k=4..10
```

Candidates are ordered by decreasing parameter-box volume, then lambda,
tau, omega. The first candidate satisfying every unchanged bound is used.
All 448 possible candidates are fixed before search. No threshold is fitted
to a failed candidate.

For any convex combination of F at the eight box corners, choose the mean
reference parameters. Constant/linear terms cancel in the deviation from
F(mean). Each pair covariance is at most `range_i*range_j/4`; the triple
moment difference is at most `lambda*tau*omega`. Coefficient L1 norms give
a strict Euclidean-distance upper bound B for the entire base hull H.

The added box has edges along the exact original radial direction, its
negative tangent, and downward Z. Its nominal edge is **5e-5 mm**. Edges are
exact rational, mutually orthogonal, with positive determinant. The two
horizontal lengths are equal; the vertical length differs only by the
binary64 normalization step. It is reported as an **orthogonal near-cube**,
not an exactly equal-sided cube. Its farthest-corner radius has a rational
square-root ceiling d, checked by exact squared inequalities.

For any extended-hull point `q=(1-a)h+a(P+e)`, the point
`q0=(1-a)h+aP` lies in H, and `|q-q0|<=d`. Thus `dist(q,source)<=B+d`.
The maximum exact L1 conversion error over the 16 float output support
points is also added. Matching convex weights bound the float-hull error.

Supporting planes are found by exhaustive triples among at most 16 points.
Coplanar faces use exact projected 2D monotone chains, then outward triangle
fans. All input points satisfy every supporting halfspace; closed/oppositely
paired triangle edges and Euler characteristic are checked. Volumes from
an interior point and the global origin agree exactly. **No Qhull tolerance
or floating coplanarity decision is used as a proof.**

Both exact and float hulls must lie strictly above `Pz-gap/2`, where gap is
computed over every vertex of the other **6127** source elements. H8 images
lie in their eight-vertex convex hulls, so this excludes their complete
images, including all **3968 retained outside-body** cells. Both hulls also
stay below one quarter of the original s=1 root-face radial-projection
minimum. Linear halfspace bounds apply to every hull point, not just samples.

The source E5048 injectivity conditions are checked: positive radial
projection, positive axial derivatives and positive Bernstein coefficients
of the exact Jacobian factor `det(J)=s*J0(t,w)`. On an axial slice these give
strict angular-ratio monotonicity; radial scale is unique for s>0. The
collapsed axis has measure zero. Exact polynomial integration consequently
gives this cell's image volume, a conservative lower bound for the full
source union volume. Added volume is at most HullVolume; the ratio to this
cell volume must be at most **1e-4**. The unknown full-source union volume
and exact added-material volume are not fabricated.

The entire exact orthogonal box is an affine H8 inside H_prime: its corners
are included, and convexity contains every interior point. Its determinant
is a positive constant and scaled Jacobian is **exactly 1**. This witness
only establishes that the original tip no longer forces J=0 in this candidate
target. **Its 5e-5 mm size is not a mandatory final mesh seed, engineering
delivery, mesh-quality certificate, or explicit time-step-quality proof.**
No .15 acceptance threshold is introduced, lowered, or used.

## Actual Frozen Results

Raw and phase produce identical local geometry and certificates, with
different source hashes. The phase-policy report SHA is
`38c0bb9408d88ac7f14aa71217cf897d00b1dbf683bda939b9f85ab730aa9536`.

| Quantity | V2 actual result |
| --- | ---: |
| Parameter limits lambda, tau, omega | 1/8, 1/4, 1/128 |
| Total domain distance bound, including float output | 0.0002247506205753331 mm |
| Allocated geometry candidate budget | 0.00025 mm |
| Added-volume upper bound | 8.296605360549291e-9 mm^3 |
| Conservative source-cell volume denominator | 0.0001846106355464903 mm^3 |
| Relative added-volume upper bound | 4.494110177342192e-5 |
| Minimum exact/float hull Z | 12.39566 mm |
| Required isolation plane Z | 12.394445000000001 mm |
| Strict height margin | 0.0012149999999993 mm |
| Source root-face projection margin | 0.0074778480642156775 mm^2 |
| Exact orthogonal-witness scaled Jacobian | 1 |

The exact rational hull/witness is authoritative. The float hull is a
separately bounded approximation: it need not contain all exact source
corners, and the report says so rather than declaring a false inclusion.
All original eight source-box corners are contained in the exact hull.

The earlier v1 eight-corner-only candidate, including its low-SJ triple
witness, is retained as historical evidence. It is not the frozen v2 target
or a good-final-mesh claim.

## Public API And CLI

```python
from tools.bolthex.screw_tip_regularization import prepare_target

report = prepare_target(source_k, actual_phase_report, new_target_json)
```

`new_target_json` must be a fresh `.json` file in an existing directory,
outside **both** `source_k.parent` and `phase_report.parent`, including their
descendants and resolved symlinks. Existing paths are never overwritten.
Input hashes are rechecked after construction and after report fsync before
exclusive publication. No K/INP/STL/STEP/BRep output is provided by this API.
Only the exact reviewed raw/phase source SHA pair is supported.

Use existing Python 3.11 from the checkout:

```powershell
& C:/Users/yuguo/.conda/envs/py3.11env/python.exe -B -m tools.bolthex.screw_tip_regularization `
  $sourceK $actualPhaseReport $freshTargetJson
```

The report includes source/policy hashes, original NIDs and reference axes,
parameter limits, polynomial coefficients, exact and float hull vertices,
zero-based outward triangles/planes, full-source isolation, error/volume
bounds and exact affine witness. Consumers must honor the false acceptance
flags and must not treat triangle lists as a volume mesh.

## Verification And Handoff

Set `SCREW_TIP_RAW_K`, `SCREW_TIP_PHASE_K`, `SCREW_TIP_POLICY_REPORT` and
`SCREW_TIP_TEST_ROOT` to the actual existing inputs and a task-local scratch
directory, then run:

```powershell
& C:/Users/yuguo/.conda/envs/py3.11env/python.exe -B -m unittest tools.tests.test_screw_tip_regularization -v
```

The module suite has **23 passing tests** with these actual inputs: exact
cube/tetra hulls, tiny rational hulls, 16-point cap, raw/phase agreement,
coverage counterexample, wrong policies/hashes, no-write guards, source
preservation, publication mutation, all source-corner containment, two-origin
and numerical volume checks, protected-domain separation, exact constant
positive witness Jacobian, and random rational convex-combination diagnostics.
The random tests are cross-checks, not the proof of the whole-domain bound.

The independent target readback selection adds seven checks. The combined
endpoint/collar/target/readback run passed 87 tests with zero skips in 86.200
seconds. Log: `screw-study/combined-main-87-tests.log`. This is a scoped actual
source regression, not the whole repository suite or whole-model acceptance.

Final targets and logs remain under
`F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm/iges-production-screw-20261107/screw-study/axis-end-geometry/regularization-20261107-v1/`:

- `raw-target-v2-final.json`
- `phase-target-v2-final.json`
- `tests-final-v2.log` (23 passed; earlier colocated-policy-fixture failures
  are historical logs, fixed by separating fixture input/output directories)
- `freeze-manifest.json` binds the final three source files and target artifacts.

No CAD union implementation or boundary experiment is duplicated here. Actual
union-boundary auditing, complete core/end interfaces, conforming remeshing,
global Jacobian/overlap checks and engineering/time-step quality remain
separate downstream work. No commit is made by this task.
