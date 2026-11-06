# Native Trim Solid Reconstruction

`tools.bolthex.native_trim_solid` is an analysis-only closed-BRep bridge for the
bounded native capture schema supported by `native_trim_brep`. It is not a
general CAD healing engine, native-HM product certificate, or mesh/solver-quality
certificate. No source STEP surface is used in construction.

## API

```python
from tools.bolthex.native_trim_brep import load_conventions, load_capture
from tools.bolthex.native_trim_solid import (
    assemble_native_solid, audit_physical_edges,
    compare_against_source, write_brep,
)
from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy

conventions = load_conventions(control_path, source_label="actual SDK control")
capture = load_capture(capture_path, source_label="saved native CAD capture",
                       conventions=conventions,
                       expected_sha256=expected_capture_hash)
policy = CadAccuracyPolicy.engineering(.04)  # explicitly declared source target
result = assemble_native_solid(
    capture, geometry_policy=policy,
    construction_tolerance=1e-4, metadata_quantum=1e-6,
)
comparison = compare_against_source(
    result, source_step, full_reference_json, geometry_policy=policy,
    expected_source_sha256=expected_source_hash,
)
saved = write_brep(result, new_brep_path)
```

No path is selected implicitly. Output must be new and have an existing parent.
Units are millimetres under the explicit policy. Policy subclasses are rebuilt
from base fields; overridden budget methods are not trusted. Construction
tolerance must not exceed the policy distance budget. A caller-supplied
`metadata_quantum` authorizes only measured, bounded edge-tolerance bookkeeping.
It does not change a source curve, a product gate, or an original native file.
With `metadata_quantum=None`, under-recorded tolerances reject instead of being
silently raised.

Dependencies are the existing NumPy/OCP/build123d runtime and repository trim,
range, policy and CAD witness helpers. No HM, SDK executable, new environment,
GUI or FE solver is launched.

## Construction Contract

1. Reconstruct all actual supports and PCurve trim domains from the immutable
   labelled capture. Incomplete/contradictory evidence or missing C3 rejects.
2. Verify native endpoint directions, including complete-circle tangent
   checks. SDK conventions are calibrated; source-OCP flag meanings are not
   substituted.
3. Derive logical vertices only through shared physical edges and verified loop
   adjacency. Check complete classes against the explicit construction budget.
   No global coordinate-nearest weld is used.
4. Preserve bounded curve images while normalizing SameRange. The committed
   descriptor utility maps segment/NURBS knots and equal-span circles. Native
   circle reversal uses negative intervals without lossy added-period endpoints.
   If an angular map is not affine, exact OCCT conic-to-rational conversion is
   separately labelled and checked bidirectionally as a finite locus.
5. Construct isolated faces with all hole-wire orientations preserved. Only
   proved natural sphere-pole chart transitions are added, never physical C3
   edges. UV rectangles never stand in for trims.
6. Sew within the explicit budget; reject dropped/split faces, ambiguous physical
   edge identity, changed support definitions, changed face-edge adjacency,
   unrelated logical-vertex merging, free/multiple edges or multiple shells.
7. Check every physical edge/face occurrence with the public OCCT maximum
   curve-on-surface checker. A measured metadata correction is allowed only
   within the caller's construction budget. Full support/curve/PCurve/range/
   vertex fingerprints must be identical across that bookkeeping-only step.
8. Run a fresh exact BRepCheck, MakeSolid and orientation check. Compute adaptive
   `OnlyClosed` volume only after the actual solid is valid. Two integration
   settings must agree. Signed skin flux or approximate host mass is not a
   substitute.

`SolidReconstructionError.report` retains the failed stage and evidence. A
successful `NativeSolid` is caller-owned; mutating its OCCT objects invalidates
previous evidence. Saved output is actually reopened and independently checked.

## Bound Result And Save/Comparison Guards

Construction now retains an immutable internal binding to the capture hash,
geometry fingerprint, complete version-3 BRep state digest, original CAD
distance budget and independently integrated volume. The state digest includes
root ownership, orientations, topology occurrences and tolerance metadata;
the deduplicated geometry fingerprint alone is not a mutation guard. Editing
the public report does not authorize a different shape or a larger budget.

Both `write_brep` and `compare_against_source` recheck that binding before use:

- The root must itself be a solid, not a compound containing a solid and an
  auxiliary face, even when the face shares an existing TShape.
- Exactly one closed shell must own every face once. Each physical edge must
  have two oppositely oriented coedge uses; legitimate degenerate chart edges
  remain present in the bound full state.
- Current face, edge and vertex tolerances must be finite, nonnegative and
  within the original policy. Comparison also honors a stricter caller policy;
  a looser comparison policy cannot enlarge the construction binding's budget.
- Geometry and full BRep state must still match construction. Metadata changes
  after binding reject even if they happen to remain inside the numeric budget.

Writing still uses an exclusive new file and the64MiB cap. The saved bytes must
match the strictly bound original state. The live object retains its exact
geometry/full-state hash checks before and after output; its immutable binding
is never replaced with a canonical readback object.

After actual reopen, root/ownership and orientation/occurrence topology must
match exactly. Each face/edge/vertex tolerance must either be unchanged or equal
the exact15-significant-digit encoding of its original value, as observed in
the installed BRep writer. This is a codec rule, not an added geometric error
budget. The actual M6 differences were about1e-22..5e-21mm; any other metadata
change rejects, and the original CAD budget still applies to every read value.
Raw tolerance hashes and every permitted rounding change are recorded separately.
Original in-memory mathematics
is directly compared against the first readback: support samples, every physical
C3, every PCurve occurrence including seams/poles, and every vertex. This is
not canonical-versus-canonical self-comparison. Only recognized circle codec
normalization is allowed: integer-period changes of intrinsic trimmed-circle
domains and machine-precision numeric normalization. Topological edge ranges
must be unchanged or exactly their15-significant-digit writer encoding; both
old/new interval endpoints and corresponding interior samples are compared in
world coordinates. Numeric geometry changes and world distances are bounded by64ULP at their
scale and capped by the existing `MATH_LIMIT`; CAD policy budgets are unchanged.
Other geometry changes fail closed. These finite direct readback checks are not
a continuous Hausdorff certificate.

The M6 diagnostic found11changed lines in6622serialized lines: intrinsic circle
trim domains shifted by2pi, near-zero parameter normalization, and two circle
direction components changing by1ULP. There was no entity reordering. Two
independent reads of the same bytes, and a further serialization/read cycle,
were stable. Consequently the observed reopened state/geometry digests can
differ from the original live binding; they are recorded separately rather than
silently relaxing that binding.

`GeomTools.Write_s` with its default stream precision is NOT an exact geometry
fingerprint: circle radii2 and2.0000001 produced the same text. Geometry hashes
now use full-double-precision BRep serialization of temporary geometric wrappers.
The wrappers do not modify source geometry. Regressions preserve that1e-7
counterexample and independently exercise world checks with the descriptor-rule
shortcut disabled. A change cannot be accepted solely because a coarse hash
matches.

The independent positive-volume comparison and final source/live binding checks
still run. A reopen failure returns no successful certificate; its newly written
diagnostic file may remain and is never overwritten on retry. Returned topology,
tolerance/state/geometry digests and `readbackMath` identify the distinct checks.
Hand-assembled `NativeSolid` containers without a construction binding are not
accepted at these public boundaries.

Regression controls include copied orphan faces, shared orphan faces that leave
the old geometry digest unchanged, excessive and within-budget metadata edits,
and an independently substituted reopened compound. These are guard checks,
not additional CAD product or continuum-fidelity claims.

## Separate Fidelity Check

`compare_against_source` reimports a hash-bound independent source STEP solely
for measurement. It checks every supplied reference, all captured on-surface
samples, all native physical C3 edges (including every finite polyline breakpoint
and segment midpoint), all analysis physical edges, and a strict-IN witness on
every analysis face. It also compares source physical edges, face-only bounds
and independent BRep volumes. No auxiliary curves are included as physical
boundary geometry.

Every native query warning survives, including warnings from checked non-best
faces. Unsupported or failed queries prevent a passing finite comparison.
Intentional off-surface controls compare distances, not against zero.
`finiteGeometryChecksPassed` describes only the explicitly recorded finite
witness coverage and policy; it is not a continuous Hausdorff theorem or a
manufacturing/mating certificate. All product, native-HM and mesh-quality
acceptance flags remain false. The separate STEP writer failure is not waived.

## Actual M6 Regression

Tests use caller-selected paths, not copied CAD/vendor assets:

```powershell
$env:BOLTHEX_TEST_ROOT = '<fresh dated scratch directory>'
$env:HEXREFINE_NATIVE_FULL_CAPTURE = '<actual native-surfaces.json>'
$env:HEXREFINE_NATIVE_CONVENTIONS = '<actual SDK control result.json>'
$env:HEXREFINE_NATIVE_SOLID_SOURCE = '<unchanged source model.step>'
$env:HEXREFINE_NATIVE_SOLID_REFERENCE = '<full-cap-reference.json>'
& '<existing OCP Python>' -B -m unittest tools.tests.test_native_trim_solid -v
```

The actual saved-M6 capture has SHA256
`23cf0300af1cb9485978f1ae64b6c53b432b20550a892af6e5fb76ef6692a7b3`.
Its scoped reference is94faces,237physical edges,148logical vertices and one
closed valid solid, with volume approximately426.917199822743mm^3. This pinned
case does not certify other sizes, unsupported analytic parameterizations,
multi-component assemblies or all CAD translators.

Absent optional actual files, those tests are explicitly skipped, never counted
as actual-data evidence. Small controls cover a cube, open annulus rejection,
source changes, incomplete C3 evidence, failed owner checks, policy bounds,
exact circle range handling and saved-output protection.

## Verified Guard Closure, 2026-11-07

The29-test selection in
`F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm/resume-20261107/native-solid-final-v2`
passed with zero skips. It includes all small guards and five actual complete-M6
tests: all94faces/237physical edges/148vertices, independent mass, every owner,
warning preservation and real save/reopen. The full source-distance sweep was
not rerun in that selection; its earlier evidence remains separately scoped.

The saved-M6 tolerance probe confirmed unchanged topology and exact15-digit
metadata encoding, not a physical tolerance increase. Its earlier failed
strict-digest checks and radius counterexample are retained. These tests reject
both copied and shared orphan faces, post-construction metadata mutation,
altered readback roots, and true same-volume geometry changes. No engineering
CAD budget, source geometry or mesh threshold was enlarged to pass them.
