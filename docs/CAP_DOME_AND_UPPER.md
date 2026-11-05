# Complete Dome And Upper-Cap Integration

Date:2026-11-05. Complete hemispherical dome, upper crop and the saved M6
WHOLE cap-nut CAD/H8/K/INP assembly verified. Native-HM, solver and wider-family
acceptance remain separate. Earlier crop-only results below retain their scope.

## Whole Saved M6 Increment

`cad_cap_body.py` uses the actual nonuniform dome seeds and a nonuniform
planar-runout chart. It covers original material Z=0..5, including the true
bore, both runout caps, external hex and bevels. No R3.1 bore crop is retained.
Both end charts return to their original angular directions. The accepted
body has 284,672 H8, SJ0.21572946, CAD-volume error5.18523e-5. All146,432
physical boundary nodes and145,920 face centers were checked against original
trimmed CAD faces with separate2e-6mm/.02mm gates (distance witness upper
bounds, not an exhaustive nearest-face claim).

`cad_cap_whole.py` explicitly pairs the512 actual H8 boundary faces and1024
unchanged nodes with the complete dome. Actual owner cycles must match, each
component must contribute one owner, and paired ring IDs must equal the face
vertex set exactly. No extra off-interface nodes may be welded.

Actual whole result:333,824 H8,456,194 nodes, minimum SJ0.21572946, positive
Gauss determinants, boundary Euler2, no nonmanifold faces/edges. Source CAD
volume426.91720762mm3 versus integrated FE426.89249779mm3 gives about5.79e-5
relative error; component FE/CAD sums and zero free join faces are separately
verified. Dome coordinates/connectivity are retained as the original prefix.

Actual K is53,042,950bytes and INP48,579,626bytes, not default huge test cases.
The bounded native Node readback cap remains200k cells. This larger case uses
the explicit independent PyDYNA interpreter instead, checking exact IDs/PID,
connectivity, coordinate loss, SJ/Gauss/Euler and volume. meshio independently
reads INP. Extra keyword cards, including indented cards, reject rather than
being silently ignored. No material/contact/preload certification is implied.

The WHOLE source CAD is unchanged, so model.step preserves the original STEP
bytes, verifies the SHA and independently reimports it. This is deliberately
reported as `unchanged-source-STEP-byte-copy-and-independent-reimport`, NOT a
successful BRep writer round-trip: both tested BRep STEP writer settings failed
on this whole source. Crop exports remain independently written geometries.
No FE-to-STEP approximation or lowered gate was substituted.

Follow-up diagnosis found an exchange-wrapper defect: the imported single
solid retains an external assembly parent, leaving zero XDE free shapes when
passed directly to the writer. `cad_step_export.export_step_detached` now
exports a deep isolated selected-solid copy, excluding parent/sibling geometry.
Nonidentity ancestor transforms explicitly reject rather than guessing world
placement. It checks original geometry/assembly preservation and reopened
topology/bounds/volume before exclusive publication. Real regenerated M6 STEP
geometry passes about8.16e-14 volume error. The earlier whole delivery retains
its truthful original-byte-copy method; separate regenerated-design evidence
does not retroactively relabel that file. Cap crop publication now uses this
guarded exporter, with a tiny actual STEP/K/INP pipeline regression.

Final integration:66 targeted cap/body/outer/interface tests with actual saved
CAD and ports passed, no skips;20 whole-cache/assembly/independent-K tests also
passed with the genuine333824-H8 case enabled. These are scoped suites, not a
claim that every slow CAD family or the whole repository was retested.
The later configured Python tools discovery ran390 tests with real cap source,
ports, body cache, original Screw K and independent readback enabled:
367 passed,23 explicit opt-ins skipped,0 failures. This snapshot includes the
bounded rejected-axis reproducer, not subsequent unvalidated cap research.

```powershell
python -B -m tools.bolthex.cad_cap_whole SOURCE_STEP NEW_OUTPUT --node NODE_EXECUTABLE --validation-python PYDYNA_PYTHON
```

The default reconstructs and validates the CAD body live. Optional
`--body-delivery DIR --body-mesh BODY_NPZ` reuses this builder's local evidence
only after source/mesh/interface/K hashes and actual mesh audits agree; this
is a reproducibility cache, not a signed third-party acceptance certificate.
Whole files and actual LS-PrePost full/cut views live in the dated evidence
directory, cases `whole-cap-M6` and `lspp-whole`. The original source and previous
accepted cases were not modified. Half-display K is inspection-only.

`cad_cap_outer.py` additionally supports a local shoulder exterior band using
the actual4096 shared faces/4608 nodes;8192 H8, SJ0.173661 and volume error
5.916e-5. Its184 support-switch faces are NOT exact CAD-crease partitions
(`cadCreaseConforming=false`). This band overlaps the complete body and must
NOT be added to the whole assembly again. It remains a separately scoped
local-macro experiment, not universal CAD partitioning.

## Implementation

`cad_cap_plan.py` recognizes the actual blind-bore end and concentric complete
hemispheres. `cad_cap.py` retains the earlier local polar macro.
`cad_cap_dome.py` now fills the ENTIRE hemispherical material with five
cubed-sphere charts. The pole is ordinary; exact integer-direction entities
share seams without tolerance welding. `equatorial_interface(mesh)` returns
ordered gnomonic angles, original node rings/coordinates and oriented faces.

`cad_cap_shoulder.py` maps the real late-runout bore at Z4.9..5, without the
former R3.1 inner truncation. `cad_cap_upper.py` joins it to the whole dome by
explicit paired IDs. Opposite face orientations, two owners, disjoint axial
domains, unchanged coordinates and independent CAD volume are mandatory.

## Real Saved M6 Results

| Metric | Whole dome | Dome + late-runout shoulder |
| --- | --- | --- |
| H8 / nodes | 49,152 /98,818 | 61,440 /116,226 |
| Minimum corner SJ | 0.866013535 | 0.497758615 |
| CAD/H8 relative volume error | 7.44230e-5 | 7.23808e-5 |
| STEP volume round-trip error | 8.20e-14 | 4.18e-11 |

Both have positive Gauss determinants, Euler2 and zero nonmanifold faces/edges.
The join shares1024 exact nodes and512 two-owner faces, with zero internal free
interface faces. The dome nodes/connectivity are unchanged in the composite.
FE volume equals the component sum; their CAD sum separately matches the
independently cropped original source. No overlapping domains were accepted.

Actual K files were independently read/re-audited by PyDYNA. meshio/OCCT read
actual INP and CAD, checking257 boundary nodes and257 material centroids.
Interior nodes were not incorrectly required to lie on the boundary.
Reference CAD is source BRep cropped by seed-independent geometric tools,
NOT mesh-to-STEP. Source SHA256:
`f05d88d746926363dd2266eb88a243e8edf9e9e8baf24ab6aaf13c9b1c711902`.
The legacy parent lacks a current origin certificate; these checks verify the
saved geometry/partition/exchange, not standards-edition compliance.

## Use And Boundaries

```powershell
python -B -m tools.bolthex.cad_cap_dome SOURCE_STEP NEW_DOME_OUTPUT --node NODE_EXECUTABLE
python -B -m tools.bolthex.cad_cap_upper SOURCE_STEP NEW_UPPER_OUTPUT --node NODE_EXECUTABLE
```

Use configured build123d/OCP/meshio Python and compiled `dist/`. No BoltPro,
MATLAB or TrueGrid runtime. K is NODE/SOLID; INP has no material/contact/preload.
The STEP output is unmeshed cropped design geometry, not fitted FE geometry.

The dome annulus at Z5 is a partition interface. The combined accepted domain
is original material in Z>=4.9 and R<=4.75mm: it contains the whole dome but
excludes the outer hex/chamfer shoulder and lower threaded body. Neighboring
blocks must respect the512 gnomonic seeds. FullCapNut remains false.

Limits unchanged: SJ>=.15; CAD/H8 volume<=1e-4; boundary nodes<=2e-6mm;
face centers<=.02mm; CAD exchange<=1e-7. Coarse seeds fail volume, excessive
counts reject before allocation. This is topology/mapping/interface work,
not new certified2:1/3:1 three-dimensional thread grading.

## Evidence And Remaining Work

All49 targeted cap tests passed with saved CAD/interface selected, no skips.
The binary writer/read-back47 tests passed separately, not a full-repo claim.
An adversarial follow-up found metadata-cycle/ownership and duplicate-record
false positives in the public helpers. These were fixed: each declared face
must match its ACTUAL H8 boundary cycle and have exactly one owner on EACH
component, not merely two owners in total. Duplicate shoulder face records
reject, and invalid generation arguments reject before CAD loading. All47
follow-up tests (including14 adversarial contracts and saved CAD) passed.
Actual K/INP/STEP, independent audits and LS-PrePost images:
`F:/PythonWoking/temp/20261105-cap-integration`, cases `dome-M6-final` and
`upper-cap-M6`. Half-mesh renderings are inspection-only; primary K is complete
for its stated domain. Cut-facing views show the cavity/thickness.

The saved M6 whole body/volume/interface/K/INP gap is now closed by the increment
above, not by promoting the earlier upper crop. Still open: whole-cap native
HM, solver behavior, general families/standards, generalized CAD-crease
partitioning and the original Screw-axis replacement. No new2:1/3:1 thread
count-grading capability is claimed by this CAD-driven cap construction.
