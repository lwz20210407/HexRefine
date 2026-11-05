# TrueGrid Screw Replay (UP-05)

Date: 2026-11-04. Status: **PARTIAL: original replay and rejection adapter
verified; full nondegenerate-H8 Screw acceptance FAILED**. This document does
not close UP-05 or change FASTENER_DEVELOPMENT_TODO.md.
Follow-up: 2026-11-05, analytical-field gates corrected and bounded finite-core
components verified; the original Screw remains rejected, as detailed below.

## Source And Boundaries

- No Screw/thread example was found in the installed `C:/TrueGrid/Examples`,
  `EXTRAS`, or `keyword` inventory/text search. Existing local research identified
  the official [Examples Manual, PDF pages 82-83](https://truegrid.com/TGEXAMPLES.pdf#page=82),
  section IX.4, Screw. Both pages were extracted and visually checked.
- Original author/publisher: XYZ Scientific Applications, Inc.; Copyright 1999,
  All Rights Reserved; manual date October 30, 2001. No open-source license was
  found. The original script/PDF stay local for authorized research replay;
  neither is vendored or relicensed. New repository code is an original adapter.
- PDF: 17,449,346 bytes, SHA-256
  `ec3cf20ddc641632047636496f42f5252391ab8e749a89dba254e8941de07115`.
- Original extracted command body SHA-256:
  `299800d1f4b74af522eacf37571a96695c7223daed12fef42ed5c3743dd7b568`.
- All original dimensions, domains, head projection, 30 turns, pitch increment
  and tip taper were preserved. Only a case-local `mof`, `lsdyna keyword`,
  `write`, `exit` trailer was appended. The conservative pre-deletion bound is
  `24*24*8 + 1*36*2 + 2*1080*2 = 9000` solids, below 100,000.
- No HyperMesh, solver or CAD construction was started. No environment was
  created, package installed, existing module edited, commit made or push made.

## Real Host Results

TrueGrid 3.1.3 (banner date May 23, 2016), `C:/TrueGrid/tg.exe`, was run twice.
Both returned 0, no captured diagnostics, and byte-identical raw K. First run:
3.437 seconds; confirmation: 1.094 seconds. These are execution successes, NOT
mesh acceptance. The output has only `*ELEMENT_SOLID`, all in PID 1.

| Measurement | Actual original output |
|---|---:|
| Nodes / eight-slot solids | 12,627 / 6,128 |
| Eight distinct node IDs | 6,128 solids |
| Eight distinct positions | 6,092 solids |
| Seven distinct positions | 36 solids, all on global Z axis |
| Repeated node IDs within a solid | 0 |
| Corner-gate failures, including those 36 | 2,364 solids |
| Minimum corner scaled Jacobian / determinant | 0 / 0 |
| Minimum 2x2x2 Gauss determinant | 8.089462571327299e-7 |
| Nonpositive Gauss / integrated-volume cells | 0 / 0 |
| Minimum integrated cell volume | 4.790897868835799e-5 |
| Integrated total volume | 40.745844970663846 |

Volume is in original coordinate units cubed; the teaching source does not
certify a dimensional standard or unit system. No CAD-volume comparison was
performed. Fixed production limits remain SJ 0.15, CAD-H8 relative volume 1e-4,
surface 2e-6 mm, CAD exchange 1e-7; no limit was relaxed or claimed to pass.

**This actual collapse is not a standard six-node wedge.** For example, EID
2817 has eight distinct IDs, but slots 1 and 4 both occupy `(0,0,-0.2)`.
Its two upper axis vertices have different Z coordinates, leaving seven
positions. Blindly converting it to C3D6 would change the element. Positive
Gauss Jacobians and volume do not cure its zero corner Jacobian.

Deleting the 36 collapsed solids would leave 2,328 other corner-gate failures
and change the solid domain. No deletion, node welding, hollow-core replacement,
orientation reversal or unverified repair was applied. Topology acceptance was
not attempted after local quality rejection. There is no accepted full mesh.

Independent meshio 5.3.5 Abaqus readback preserved every coordinate and every
eight-slot connectivity entry exactly. Its `hexahedron` label is only the
declared connectivity type, not a geometric certificate. Independently assembled
3x3x3 Gauss quadrature gave volume 40.74584497066387, relative difference
5.23e-16. This confirms diagnostic data transfer and FE integration, not CAD
fidelity, nondegeneracy, mesh completeness or solver validity.

## Adapter And Tests

`tools/bolthex/truegrid_screw.py` has no TG dependency and no generation path:

- `read_keyword`: bounded 32 MiB / 100,000-element basic NODE/SOLID importer;
  preserves node/EID/PID identity and all eight slots. Handles TG free/fixed
  formats and D exponents. Rejects duplicate/missing IDs, nonfinite coordinates,
  includes, transformations, parameterized/alternate mesh encodings and missing
  END. Non-solid element cards are counted and reject mesh acceptance.
- `audit_import`: separate ID/position histograms, global-Z axis coincidence,
  all failing EIDs, 8-corner SJ/determinants, 8-Gauss determinants and integrated
  volume. Coincidence uses a 1e-10 mm numerical tolerance without modifying nodes.
- `require_nondegenerate_h8`: raises on rejection; otherwise also uses the
  existing `mesh_audit.audit_h8` duplicate/topological-boundary checks. Sampling
  does not prove Jacobian positivity everywhere or global non-overlap.
- Diagnostic INP preserves even rejected eight-slot data, with an explicit
  `REJECTED H8 NEGATIVE CONTROL` heading. It is not a solver-ready model or an
  accepted C3D8 conversion. CLI exit 2 means mesh rejection, not host failure.
  Evidence directories/files are exclusive-create, not overwritten.

Actual command below ran **24 tests, all passed**: 18 new adapter tests and 6
existing launcher tests. Coverage includes a positive cube, synthetic six-node
axis wedge with positive volume/Gauss Jacobians, measured seven-position EID
2817, coincident coordinates with distinct IDs, inversion, positive-volume low
SJ, duplicate cells, mixed types, formats, budgets and diagnostic INP roundtrip.
No full repository/HM regression suite was run in this task.

## Reproduction And Local Evidence

All task products are retained below, including original negative controls:

`F:/PythonWoking/temp/20261104-native-cad-precision/agent-truegrid/`

- `manual-source.json`, extracted page text/PNGs and PDF: provenance.
- `extract_screw.py`: PDF extraction only (existing Python 3.11/PyMuPDF).
- `run_original.py`: local-only, hash-pinned reviewed command-body replay;
  derives the original script from the manual, checks a new child-directory
  name, enforces the 9,000 bound, uses a hidden console and 120-second timeout,
  terminates only its own timed-out process, captures hashes/logs and never
  marks a mesh validated. No untrusted script sandbox is claimed.
- `original-screw/reference.tg`, `run.json`, `truegrid.log`, session/history:
  actual commands and execution evidence; `raw.k` is 748,976 bytes.
- `original-screw/final-audit/{audit.json,result.txt,diagnostic.inp}`:
  final rejection and full EID lists. INP is 1,005,824 bytes.
- `original-screw/independent-readback.json`, `independent_readback.py`:
  exact INP readback, independent volume and actual collapsed-cell coordinates.
- `replay-confirmation/`: second real TG run, byte-identical raw K.
- `unit-tests-final.txt`: scoped test transcript. Earlier test/audit iterations
  remain as clearly named intermediates, not additional accepted cases.

Raw K SHA-256:
`09c9ce96a5df2d8cf900be8fa716d6a0daf7e80d6cc26955e76e623d45182628`.
Diagnostic INP SHA-256:
`d956371216cc3403b84121760cef6d0439354bb4c2c227ce866145e42674318c`.

Run from that scratch directory, not the workspace root:

```powershell
$py = 'D:\AI_Tools\conda-envs\text-to-cad\Scripts\python.exe'
$env:PYTHONPATH = 'F:\PythonWoking\worktrees\HexRefine\bolt-thread-native'
$env:BOLTHEX_TEST_ROOT = $PWD.Path
$env:TEMP = $PWD.Path
$env:TMP = $PWD.Path
& $py -B -m unittest tools.tests.test_truegrid_screw tools.tests.test_truegrid_oracle -v
# New child names required; this example has not been pre-created.
& $py -B run_original.py replay-next
& $py -B -m tools.bolthex.truegrid_screw replay-next/raw.k replay-next/audit
# Expected audit exit code: 2. Do not count it as mesh acceptance.
```

The replay wrapper uses only the already verified host invocation pattern:

```text
C:\TrueGrid\tg.exe i=<absolute-case>/reference.tg g=nogui s=<absolute-case>/truegrid-session.tg
```

The existing `tools/run-truegrid-oracle.py` whitelist is rectangular-only and
was NOT broadened or bypassed. The separate local Screw replay reviewed/pinned
the full original body before reusing the established invocation/safety pattern.

## Remaining Work

An independent nondegenerate core/transition topology and quality improvement
are still required. Neither a repaired full Screw nor a general thread kernel,
paired nut, original-domain coverage, independent CAD comparison, global
Jacobian proof, host transfer or solver validation is delivered here. TG stays
a development oracle, not a production runtime dependency.

## 2026-11-05: Field Gates And Finite Core

The November 4 axis-core handoff incorrectly applied the **node** 2e-6 mm
limit to an **interpolated face centre**. That failure interpretation is
withdrawn, not a relaxed limit. The correct analytical-field gates are:

- Node-to-field distance upper bound <= 2e-6 mm.
- Interpolated face-centre-to-field distance upper bound <= .02 mm.
- Relative analytical-field volume error <= 1e-4; minimum corner SJ >= .15.

The independent one-pitch rod has 98,304 H8 / 112,385 nodes, SJ
0.20896114378285977, volume 1.3067725841736766, relative field-volume error
9.944101821884402e-5, and core+band/skin volume difference about 1.7e-16.
Its node residual is about 6.7e-16 mm and maximum face-centre radial residual
0.0069111384731772585 mm. A same-angle/same-Z field point makes the latter a
conservative Euclidean-distance upper bound, NOT an exact CAD distance. The
root-cylinder chord witness 3.0119474339174168e-5 mm is a face-centre quantity:
it is below .02 mm and says nothing adverse about node acceptance.

These are **analytic-field** results, not independent CAD acceptance. The
ambiguous `strictGeometryAccepted`/`strictSurfaceAccepted` fields were removed;
the new report separates `analyticFieldAccepted`, `fieldNodesAccepted`,
`fieldFaceCentresAccepted` and `independentCadAccepted: false`. No STEP, HM,
solver, head or original tip acceptance follows. Seed-half-step placement
preserves the continuous field; the aligned-seed negative still exceeds 1e-4.
Volume acceptance is narrow and specific to this case, not arbitrary seeds.

### Measured Original Interface

`original_screw_interface_audit` is restricted to the hash-pinned original K;
unknown K cannot use the original EID layout. It selects only the threaded
body (EIDs 2889-6128), root radius .9, and first pitch Z in [0,.4]. The head
and modulated tip are excluded. The result is 57 root samples, **36 angular
seed classes at 10 degrees**, maximum measured drift 8.9113e-5 degrees.
No rounding is used to weld or change the mesh.

Readback resolves another old diagnostic error: the original taper expression
agrees with **degree-mode** cosine, not radians. Its first unscaled-to-scaled
boundary is Z=90/12.4, about 7.2581. Across 30 observed root samples the maximum
degree-model X residual is 6.09e-7; the radian model is wrong by up to .88815.
The old mixed-angle statistic 638 included tip/head and coordinate drift and
is not an angular seed count. No inverse taper division is attempted.

The measured first phase strip has two 37-vertex rows. Each returns after a
turn with Z displacement **.4**, plus Y drift 9.149333e-7. It is an unwrapped
helical strip, NOT a closed periodic circular layer. The new finite-core
adapter explicitly rejects it with `nonperiodic helical seam; pitch-offset
bridge required`. Even the radii differ from the independent rod support:
original root wall .9 versus native support .54; original 36 versus native
384 circumferential segments. These are separate, retained template walls.

### Reusable Component And Limits

`build_periodic_axis_core` now fills supplied, planar, periodic rings with a
finite six-sector disk and preserves all wall coordinates exactly. A 36-seed,
radius-.9, two-interval example produces **360 nondegenerate H8**, not a
collapsed cylinder. Its integrated volume conserves the supplied polygonal
wall domain; this component is NOT a smooth-cylinder CAD-volume certificate.
Count mismatch, pitch-offset seams, nonplanar/varying walls and bad SJ reject.
A wide single-level 2:1 patch remains a tested SJ failure, not a waived repair.

All **2,328 other noncollapsed corner failures** in the original are still
listed, in addition to 36 collapsed cells; all 6,128 source solids are retained.
No insertion, deletion, hollow-core substitution or original Screw acceptance
is claimed. A conforming helical seam/axial-offset transition, head/tip closure
and a separate quality strategy for those remaining cells are still required.

Today's output root is exclusively
`F:/PythonWoking/temp/20261105-cap-integration/agent-screw/`; November 4 evidence
is read-only. Exact current tests and readback results live in that directory.
From it, using the same existing interpreter and environment variables above:

```powershell
$env:SCREW_ORACLE_K = 'F:\PythonWoking\temp\20261104-native-cad-precision\agent-truegrid\original-screw\raw.k'
& $py -B -m tools.bolthex.screw_axis_core rod-verified --original-keyword $env:SCREW_ORACLE_K
& $py -B -m unittest tools.tests.test_screw_axis_core tools.tests.test_truegrid_screw tools.tests.test_truegrid_oracle -v
```

Output directories must be fresh; the listed measured case is not overwritten.

The final follow-up ran **50 scoped tests, all passed**, including both opt-in
tests against the actual original K (no skips), all current axis-core tests and
the pre-existing TG importer/launcher tests. No full repository regression was
run. `rod-verified/independent-check.json` records exact saved K/INP readback,
unchanged K/INP SHA-256 compared with November 4, independent 3x3x3 volume
integration (relative difference 5.10e-16), and minimum 27-point determinant
3.31858e-8. End-plane nodes and quad centres are also checked against the
finite analytical end disks, not incorrectly against the helical side surface.

The separate `core-36-component` K/INP has 597 nodes / 360 H8, minSJ
0.866025403784438, and polygonal-domain volume 1.0127161721535376 with zero
measured conservation error. It is a component example, NOT the complete rod
and NOT an insertion into the original mesh. The complete independent rod is
only `rod-verified`, and still is NOT the full original Screw.

## 2026-11-05: Actual 3D Interface And Phase Contract

`screw_interface.py` now extracts the original **actual shared-face** graph,
not an assumed first-pitch periodic cylinder. It does not modify the previous
validated rod, the original K or the source core's other bad elements.

The hash-pinned source selection is EIDs 2817-5048: 72 neck cells and 2,160
thread-axis cells. All 2,232 selected and 3,896 retained source EIDs remain
explicit obligations, not deleted cells. The actual core/tooth interface is
**1,080 shared quads** (selected local face 4 / retained local face 6, with
oriented original NIDs). The complete selected-cell boundary has 6,704 quads,
6,708 vertices and 13,408 edges, all edge incidences two, with two components
and Euler characteristic four. Vertex-link and orientation checks also pass
in ID topology. This is NOT a valid geometric embedding certificate: **2,232
boundary quads have zero area** on the collapsed axis. The two ID components
must not be silently merged by coordinate proximity.

The actual shared-interface skin is an open disk: 2,162 vertices, 3,241 edges,
1,080 faces, Euler one, and one 2,162-edge boundary loop. Source EID/PID/local
face, oriented NIDs, edge owners, component lists, vertex-link failures, face
areas and fixed-face corner-angle bounds are machine-readable. The selected
source FE signed volume 23.027703001268478 agrees with independently integrated
Q4 skin volume to about 3.09e-16 relative; this verifies extraction, not CAD
fidelity or absence of geometric self contacts.

### Cross-Turn Connection

Following real shared edges produces the full 1,080-face tooth strip and its
actual adjacent valley wall: **three axial phase rows by 1,081 columns**.
The measured successor at theta+360 is column +36 and **phase row +2**, not
the same row. First correspondence: same-row distance about .4, next-phase
distance 9.149333e-7. This relation is discovered from the strip and readback,
not imposed by a planar closure test.

The contract lists 1,045 node candidates and 1,044 corresponding source cap
face pairs, each with actual EID/local-face bindings, node permutation and
coordinate gaps. All face pairs have opposite cyclic orientation, but **zero
are actually ID-shared**. Only 24 node pairs / 21 face pairs meet the 2e-6 mm
coordinate-gap diagnostic; maximum node gap is about 3.12828e-4 mm. This is
not permission to weld. Later source tip modulation and trigonometric drift
are retained in these measured distances; angular seed counting remains the
separate untapered-only procedure above.

### Bounded Attempt, Not A Completed Macro

The first six actual tooth-interface faces and their actual adjacent upper
phase select EIDs 2889-2894 and 3969-3974. This is a **12-cell, 40-face**
three-dimensional cavity with eight real retained-owner faces, not a planar
ring. Twelve of its boundary quads are zero area. A literal frozen-Q4 fill
cannot meet SJ .15: at an H8 corner, SJ is bounded above by the sine between
the two fixed face edges. Those collinear faces have bound zero, regardless
of the new interior node. This rejects only that literal fixed-connectivity
attempt. It is **not proof that the physical original domain is irreparable**;
a new axis connectivity/3D macro can replace the nonphysical collapsed sheet.

A separate **six-H8 attachment probe**, minSJ 0.9863481723135026, preserves the
actual retained tooth face NIDs and coordinates exactly. Its K and INP round
trips pass. This proves that the retained interface can host finite H8, not
that the central cavity has been filled: its inner boundary is explicitly
unfilled and its retained core cut faces are not matched. File headings and
JSON say `ATTACHMENT PROBE ONLY`; it must never replace the solid core.

No conforming finite-segment axis macro or global replacement is claimed.
The 2,328 other bad source EIDs are all listed and retained. The next macro
must handle offset phase-row incidence, replace collapsed-axis connectivity,
match retained core cut faces and neck/head/tip transitions, and audit every
remaining bad source cell. The old .4 periodic-core rejection is not used as
an impossibility proof.

### Interface Artifacts And Reproducer

Under today's `agent-screw/interface-skin/measured-interface-final/`:

- `cavity-interface.json`: complete 3D selected skin, shared interface and
  every source EID/NID/local-face/edge binding. Face-list indices are zero-based;
  source IDs and local face/slot labels are one-based with the slot map included.
- `root-wall-strip.json`, `axial-phase-links.json`: full strip, valley ownership,
  cross-turn node and cap-face correspondences, permutations and measured gaps.
- `small-cavity.json`, `small-frozen-boundary-attempt.json`: the actual bounded
  coordinate-fixed attempt, face constraints and explicit rejection scope.
- `attachment-probe.{k,inp,json}`: finite attachment diagnostic, NOT core repair.
- `summary.json`, `result.txt`: unresolved macro, all retained bad-cell EIDs and
  zero source deletions/moved coordinates/global replacements.

```powershell
& $py -B -m tools.bolthex.screw_interface $env:SCREW_ORACLE_K measured-interface-final
# Expected exit 2: the finite core macro is incomplete; not a software crash.
& $py -B -m unittest tools.tests.test_screw_interface tools.tests.test_screw_axis_core tools.tests.test_truegrid_screw tools.tests.test_truegrid_oracle -v
```

Use a fresh output name when replaying. The module accepts no unknown oracle
layout by default and launches no TrueGrid, HyperMesh, Node or other host.
Final scoped regression: **65 tests passed, no skips**, including 15 new
interface tests and the previous 50 tests, with real-source opt-ins enabled.
The extraction CLI returned the expected 2 because the finite core macro is
incomplete; neither that negative result nor the positive attachment probe is
counted as a complete original-mesh acceptance.
