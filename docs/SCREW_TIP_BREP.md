# Local Screw Tip Diagnostic BRep

## Scope

`tools.bolthex.screw_tip_brep` materializes the reviewed local E5048 source
image and regularization H-prime as BReps, computes their Boolean union,
saves/reopens it and performs bounded actual-boundary checks. It follows the
measured Laplace prototype and its dense local-patch/readback v2 evidence.

This is **source-mesh-derived local diagnostic geometry**, not independent
design CAD, the full Screw, an accepted mesh or a successful K file. A report
may have `localBrepChecksPassed=True` while all of these remain false:
`wholeScrewAccepted`, `meshAccepted`, `coreMeshed`, `independentDesignCAD`,
`engineeringGeometryAccepted`, `globalHausdorffCertified` and
`boundaryDistanceCertified`. `scopedLocalChecks` names only the completed
local checks. No K/INP/STEP design substitute or solver output is emitted.

## API And Runtime

```python
from tools.bolthex.screw_tip_brep import materialize

report = materialize(source_k, phase_report, target_file, new_output_directory)
```

Run with the existing CAD runtime, without installing anything:

```powershell
Set-Location F:/PythonWoking/worktrees/HexRefine/bolt-thread-native
& D:/AI_Tools/conda-envs/text-to-cad/Scripts/python.exe -B -m tools.bolthex.screw_tip_brep `
  $sourceK $actualPhaseReport $frozenTargetJson $freshScratchDirectory
```

Use the actual raw or phase K, actual `screw-phase-compensated-v2/report.json`,
and its matching `raw-target-v2-final.json` or `phase-target-v2-final.json`.
The output parent must exist and the new directory must not. Resolved output
must be outside all three input bundles, including descendants of the K,
phase-report and target directories. Existing output is never overwritten.
Use the sanctioned task scratch directory for actual runs.

Source K size is checked against the frozen target API's 32 MiB cap before
hashing. Policy/target JSON is checked against 2 MiB before hashing; duplicate
JSON fields and nonfinite JSON values reject. The frozen `prepare_target`
is rerun into an owned temporary directory and its **complete canonical JSON**
is compared with the supplied target. This checks actual source bindings,
policy, coefficients, exact/float points, triangles, outward polygons,
halfspaces, budgets and scope flags, not just self-declared hashes or pass
flags. Both source variants must bind their own source file even though their
local geometry is the same. The frozen regularization module is not changed.

## Construction And Non-Destructive Boolean

- Construct the five physical source Q4s as degree-(1,1) Bezier surfaces from
  the original source nodes. F6 is explicitly checked to be the one-dimensional
  axis image before omitting it as a surface. It is not a removed physical face.
- Construct the target's exact-hull polygon partition using its validated
  binary64 point conversion. This is an approximate kernel materialization
  of an exact rational target, not an assertion that the float hull equals it.
- Sewing is fixed at `1e-7 mm`, with the same minimum and maximum. No
  ShapeFix, adaptive healing or tolerance retry is used.
- Boolean uses the **empty** `BRepAlgoAPI_Fuse` constructor and explicit
  `TopTools_ListOfShape` arguments/tools. `NonDestructive=True`,
  `FuzzyValue=0`, and `RunParallel=False` are set **before** its first Build.
- Source and hull geometry, oriented topology, tolerance and serialized-state
  signatures must be exactly unchanged across Fuse. Original K hashes alone
  are not used as a substitute for this in-memory check.
- The result must normalize to one solid without auxiliary shapes. Existing
  native trim helpers check one closed shell, face ownership, opposite physical
  coedges, finite tolerance metadata and actual BRep validity.

Construction tolerance, query tolerance and output metadata are distinct.
Actual union metadata reaches about `5e-6 mm` on edges and `5.000001e-6 mm`
on vertices even with zero fuzzy. No entity tolerance is manually increased.
Actual metadata is reported and checked against the unchanged, hash-bound
`0.00025 mm` local geometry allocation, not falsely declared equal to the
`1e-7 mm` sewing input. Initial source/hull metadata may differ from the latter
by a single floating-point ULP. No geometric threshold is fitted to that value.

## Saved Geometry And Protected Output Faces

All three solids are actually written and independently read back. They must
remain valid, closed, positive-volume single solids with unchanged topology.
The roundtrip relative-volume limit is fixed at `1e-7`. Direct world-coordinate
support/PCurve/C3/vertex samples use the existing 64-ULP codec bound; tolerance
metadata permits only the existing exact 15-significant-digit encoding rule.
These finite codec checks are not a global geometric identity theorem.

This scoped diagnostic does not reuse the strict carrier acceptance flags
intended for independent STEP/native-CAD transfer. OCCT can normalize a
`Geom2d_Line` during serialization. Shared strict carrier rules are left
unchanged; the local module reports direct cold-math samples explicitly.

The cold source must still have exactly the original degree-(1,1) Bezier
poles for all five source Q4s. **Output** protection is separate from unchanged
Boolean inputs: original F1, F3 and F4 (the outer root face) must exist intact
in the union. Live matching first uses `IsSame`/`IsEqual`; if the kernel copied
the face, it requires the real geometry signature instead. Complete support,
trim world-coordinate/range signatures and oriented topology must match the
source, then match again after cold union readback. The intentionally changed
near-tip F2/F5 portions are not included in this untouched-face claim.

Actual source BRep volume is checked against the exact source-image volume;
hull BRep volume against the rational hull volume, each at relative `1e-7`.
Measured added union volume must be positive and no larger than the certified
target hull upper bound. A zero-fuzzy non-destructive source-minus-union kernel
check must have no remaining faces/solids. Numerical integration estimates
and measured delta volume are not promoted into exact Boolean-volume proofs.

## Actual Boundary And Witness Checks

Distance targets are **compounds of the actual trimmed faces**, not the solid
interior. Sampling is bounded before queries and retains the full point rows:

1. Whole-source coarse controls: 7x7 on each of five Q4s.
2. True small source patches from validated local s,t,w: requested 17x17 on
   t=0 and w=0, excluding s=0 but including the other boundaries. This gives
   **272+272=544** points and detects the covered-source region missed by a
   coarse whole-face grid.
3. Reverse union face controls: 9x9 UV candidates classified against each trim;
   every face must be represented, using the existing interior-point helper
   if a face has no accepted grid candidate.
4. Reverse union C3 edges: 17 points on each nondegenerate edge, plus every
   vertex. Face and edge/vertex maxima remain separate; the overall reverse
   result is their maximum. Counts follow the actual cold BRep inventory,
   not a forced prototype count.

Source own-boundary residuals are checked at `1e-7`; union edge own-boundary
residuals must be covered by actual tolerance metadata. Sampled forward and
reverse distances must stay within the fixed local half-budget. Passing
samples is **not** boundary Hausdorff certification or engineering acceptance.

The actual cold union also classifies the orthogonal witness's 8 corners,
centre and 12 edge midpoints: **21 points** at explicit `1e-9 mm` classification
tolerance. Every point must be IN or ON, otherwise no passing local report is
published. Coordinates, rounding errors, classifications and distances to the
actual boundary are retained. The report distinguishes IN points farther
than the global stored-tolerance band from IN points near that band. A small
requested classifier tolerance does not erase BRep metadata.

This finite inclusion check does not certify the entire box or any global
mesh. The `5e-5 mm` witness remains existence-only: not a mandatory final seed,
engineering quality certificate or explicit time-step-quality result.

## Actual Results And Artifacts

Actual raw/phase runs produce source 5 faces, hull 12 faces and union 14 faces,
each one closed positive solid. Representative values:

| Check | Result |
| --- | ---: |
| Source volume | 0.00018461063554649101 mm^3 |
| Union volume | 0.00018461274568853822 mm^3 |
| Measured added volume | 2.110142047206942e-9 mm^3 |
| Dense forward boundary sample maximum | 0.00014640952214412813 mm |
| Reverse face sample maximum | 0.00015336632233099316 mm |
| Reverse edge/vertex maximum | 0.00015462307965215886 mm |
| Witness classifications at 1e-9 | 5 IN, 16 ON, 0 OUT |
| Centre boundary distance | about 2.5e-5 mm |
| Clearly internal / IN within metadata band | 3 / 2 |

The formal no-tessellation run has 510 reverse edge/vertex witnesses; the
prototype's later readback reported 493. The measured maxima agree. The module
does not discard actual nondegenerate edges to force the earlier count.

Successful output contains `recomputed-target.json`, `source-e5048.brep`,
`hull-approximation.brep`, `union-diagnostic.brep`, `boundary-witnesses.json`
and `report.json`. Each report binds input and artifact hashes. After report
fsync and before exclusive `report.json` publication, every artifact's bytes
and SHA are rechecked, as are inputs. A source or BRep publication-window
mutation rejects success. Failure after construction retains only this owned
directory's intermediates and `rejection.json`; pending/rejection files are
not passing receipts. No pre-existing directory is cleaned or overwritten.
The BRep artifact entries use the serialized byte count and SHA verified at
cold readback, not hashes newly sampled at the end. The target snapshot and
witness rows likewise bind their written payload bytes. A rewrite between
cold readback and initial artifact-list construction cannot be blessed by a
late checksum; it also rejects publication.

## Tests And Remaining Work

Use the existing CAD Python and set `SCREW_TIP_RAW_K`, `SCREW_TIP_PHASE_K`,
`SCREW_TIP_POLICY_REPORT`, `SCREW_TIP_RAW_TARGET`, `SCREW_TIP_PHASE_TARGET`, and
`SCREW_TIP_BREP_TEST_ROOT` to the actual inputs and task-local test directory:

```powershell
& D:/AI_Tools/conda-envs/text-to-cad/Scripts/python.exe -B -m unittest tools.tests.test_screw_tip_brep -v
```

Directed tests cover actual raw/phase cold solids, Boolean configuration order,
in-memory input corruption, protected output-face corruption, dense forward
and both reverse groups, the 21 witness points, full target tampering (including
pointsFloat/triangles/outwardPolygon), incorrect source binding, duplicate JSON,
immutable/output paths, pre-hash size guards and fsync artifact mutation.

Final evidence is retained in the task's
`screw-study/axis-end-geometry/brep-module-20261107-v1/` directory. Early rejected
runs document the distinction between construction and policy metadata budgets
and the strict-carrier-versus-scoped-codec readback rule. They are not pass
evidence. Final raw/phase outputs and the freeze manifest are separate.

Complete core/end interfaces, full source Boolean assembly, conforming H8
remeshing, whole-model overlap/Jacobian checks and engineering acceptance remain
downstream. No other repository module is modified by this implementation.
