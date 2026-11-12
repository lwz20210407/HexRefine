# Reviewed Source Ring BRep

## Scope

`tools.bolthex.source_ring_brep` builds the reviewed phase Screw's complete
radial **0.6..1 BODY ring**, using all2160 source parents EIDs2889..5048.
It is a narrowly scoped source-mesh-derived BRep certificate, not a general
CAD generator, independent design CAD, neck partition, accepted mesh, solver
deck or complete Screw. No Boolean is performed by this API.

One macro H8 per source parent defines the ring geometry. The frozen15120
seven-H8 transition mesh is read for provenance and comparison, **not used
as the exact ring volume/domain**. Their true geometry/integrated volumes
are different. No source or retained head/thread coordinate/connectivity is
rewritten, and no K/INP is emitted.

## Public API

```python
from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy
from tools.bolthex.source_ring_brep import build_source_ring

report = build_source_ring(
    original_k, phase_k, frozen_collar_directory, fresh_output_directory,
    geometry_policy=CadAccuracyPolicy.engineering(0.2),
    phase_report=None,
)
```

`phase_report` defaults to `phase_k.parent / "report.json"`; it can be passed
explicitly. All other arguments identify caller-selected existing inputs or
the fresh output. There is no implicit absolute scratch/runtime dependency.
The kernel and source helpers come from the repository and installed runtime.

Only the reviewed raw/phase SHA pair and ratio0.6 frozen collar are supported.
The caller must explicitly supply the existing engineering policy with
declared target **0.2 mm / critical distance0.0005 mm**. Changed target sizes,
strict profiles or feature-budget variants reject; geometry tolerance is not
derived from a short edge. Construction sewing is fixed **1e-7 mm**,
minimum=maximum, with no tolerance retry or healing threshold increase.

The output must be a new directory with an existing parent, outside all
original/phase/policy/frozen input bundles. Existing files, directories or
symlinks are never overwritten. Outputs stay in the task's sanctioned scratch.
`ValueError` indicates validation/check rejection; filesystem errors can
raise `OSError`. The CLI exits1 on rejection,0 on publication,2 on usage errors.

## Provenance And Pre-Kernel Guards

Every input file is inventoried before hashing/parsing: raw/phase and frozen
handoff/report/composite/support files are capped at32 MiB/file; the phase
policy report at2 MiB. `_sha` streams with a32 MiB byte counter, rejecting
growth beyond the cap. Policy JSON uses bounded `limit+1` reading and rejects
duplicate keys and nonfinite values.

The existing `screw_endpoint_contract._load` verifies the actual original and
phase pair, frozen handoff artifact hashes, original node rows, all3968
outside source rows, every parent binding, all15120 child identities and the
complete support-coordinate ledger. No vendor templates or scratch scripts
are imported. The frozen NPZ retains the loader's32 MiB expanded-data limit.

The ring assembler reconstructs the identity1-equivalent macro solely from
phase source cells and the ordered frozen inner corner supports. It checks:

- All2160 parents; consistent source-to-inner mapping and exact stored inner
  corner coordinates, with no NID welding.
- **4282 internal face pairs**, using actual NID keys and opposite cycles.
- **2160 outer F4 source faces**, preserving their exact original phase cycles;
  all1080 retained-tooth opposite owners remain source-bound.
- **2160 inner faces**, with cycles opposite the frozen cavity/core interface.
- **76 actual annular source-end restrictions**, not fabricated planar caps.
- All-parent positive Gauss determinants, actual radial-slice control nets
  within fixed binary64 codec bounds, and per-parent integral agreement.

Unordered endpoint keys and cyclic source-owner keys are normalized explicitly;
they are not silently interchanged. Invalid source hashes, corners, outer
protection or internal orientation reject before CAD construction.

## Geometry And Cold Readback

All **4396** physical faces are nonrational degree-(1,1) Bezier patches of
their source/frozen corner coordinates. `cad._sew` constructs one closed shell
at1e-7. Existing `_solid_state` verifies single-solid ownership, full face
inventory, opposite physical coedges, finite policy-bounded tolerance metadata
and BRep validity. Source poles are matched exactly; every actual trim must
be one complete **unsplit** unit-square PCurve chain under the existing
interface helper's fixed codec-roundoff checks.

`cad._save_reopen` writes and cold-reads the unique BRep, verifies topology,
direct codec math, tolerance encoding and positive volume. Every one of4396
source pole/trim bindings is checked again after cold read and compared to
the live binding. Live and cold masses must be within relative1e-7 of the
all2160 actual source radial-slice integral. No neck/cut/Common/fuse operation
is included, and no sub-resolution intersection is declared resolved.

**Size limitation:** this fixed case is3,940,764 bytes and fits the existing
readback helper's stricter **4 MiB** BRep limit. Although the output guard also
rejects any BRep above16 MiB and directory above32 MiB, the API does **not**
promise arbitrary16 MiB BRep support or change the shared helper's cap.

The macro inner coordinates are bitwise the verified frozen support values.
Evaluation of the original phase trilinear restriction has an observed
8.88e-16 mm codec difference; equality of distinct exact rational constructions
is not claimed beyond the explicitly recorded codec allowance.

## Actual Reference Values

| Check | Actual reviewed case |
| --- | ---: |
| Physical faces / single solid / closed shell | 4396 /1 /1 |
| Outer / inner / annular faces | 2160 /2160 /76 |
| Physical edges / coedge occurrences | 8792 /17584 |
| Sewing free / multiple / deleted faces | 0 /0 /0 |
| Phase BODY integral | 22.01515576983009 mm^3 |
| All2160 macro ring integral | 14.089699692691257 mm^3 |
| Actual phase radial0.6..1 integral | 14.089699692691259 mm^3 |
| Live/cold ring BRep volume | 14.089699692691264 mm^3 |
| Maximum per-parent slice relative difference | 1.3183278823182883e-15 |
| Maximum per-parent0.64-factor relative difference | 1.278242468921348e-15 |
| Maximum source restriction control-net codec gap | 8.881784197001252e-16 mm |
| Maximum live/cold kernel tolerance metadata | 1e-7 mm |
| Frozen15120 cell integral | 14.089699688497038 mm^3 |
| Frozen minus ring integral | -4.19421830599731e-9 mm^3 |

The0.64 relation is checked against actual2160 source integrals, not inferred
from an ideal cylinder. Gauss samples and mass agreement alone do not prove
global source injectivity, no-overlap, mesh quality or continuous Hausdorff
identity. The report explicitly keeps whole/mesh/engineering/global flags false.

## Publication And Artifacts

Success output contains exactly one `source-ring.brep`,
`source-face-bindings.json`, `internal-side-cycles.json`, and `report.json`.
The binding ledger retains original EID/PID/localFace/NIDs, protected outer
owners, opposite inner-core cycles, cold face indices and source support
hashes. The side ledger retains all4282 opposite source face pairs.

Source/frozen hashes are rechecked after pure-data assembly and after report
fsync before publication. Artifact hashes bind the **actual cold-read BRep
SHA/serialized byte count**, not a later recollection of changed bytes. JSON
artifacts bind their original written payloads. The pending report itself is
bound to its original payload bytes/SHA and rechecked before the exclusive
hard-link publication, including same-size mutations.

The producer file SHA is captured before construction and checked again
before publication. This is a producer-file change guard, **not Python loaded
bytecode/import attestation**. Frozen-case CLI/tests also record before/after
source-file SHA consistently. Earlier receipts from a code-editing window
remain development smoke, not final-producer evidence.

Failures after directory creation leave `rejection.json` and owned
intermediates, without a published passing `report.json`. Rejection safely
rechecks `sourceFilesUnchanged`; unreadable/oversized/changed inputs yield
false rather than retaining a stale success flag. No existing material is
deleted. Cleanup of this invocation's own pending link is best effort after
successful publication.

## CLI And Tests

Use existing CAD Python (no installation):

```powershell
Set-Location F:/PythonWoking/worktrees/HexRefine/bolt-thread-native
& D:/AI_Tools/conda-envs/text-to-cad/Scripts/python.exe -B -m tools.bolthex.source_ring_brep `
  $originalK $phaseK $frozenCollar $freshOutput --target-size-mm 0.2
```

For tests set `SOURCE_RING_TEST_ROOT`, `SOURCE_RING_ORIGINAL`,
`SOURCE_RING_PHASE`, `SOURCE_RING_FROZEN`, and `SOURCE_RING_ACTUAL_REPORT` to
the explicit reviewed paths and **one previously generated actual receipt**:

```powershell
& D:/AI_Tools/conda-envs/text-to-cad/Scripts/python.exe -B -m unittest tools.tests.test_source_ring_brep -v
```

The22-test suite uses one shared source-data load and reads that one real
4396-face CLI receipt. It does not rebuild the full CAD for each negative.
Negative hashes, corners, protected cycles and side orientations reject in
pre-kernel guards. Publication faults use clearly labelled synthetic mock
bytes solely to test rejection, never as geometry evidence. Controls include
pre-hash sizes, bounded JSON/hash streams, artifact changes after cold read,
fsync artifact mutation, same-size pending-report mutation, source mutation
without false unchanged claims, and producer mutation without editing repo.

Final CLI/receipt/test/freeze evidence is retained under the task's
`source-ring-module-v1` scratch directory; main may independently rerun/commit.
No neck partition, Gmsh volume mesh, full Screw or K delivery is certified.
