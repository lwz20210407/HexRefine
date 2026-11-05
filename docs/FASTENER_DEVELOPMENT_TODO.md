# Fastener development TODO

Updated: 2026-11-05, Asia/Shanghai. Work branch: `codex/bolt-thread-native`.
Destination: `lwz20210407/HexRefine`, development branch only; no main/PR merge.

Status: DONE = scoped implementation and stated evidence; PARTIAL = only a
component; TODO = not implemented; WITHDRAWN = earlier acceptance corrected.
Reading a repository is not porting it. Writing a STEP is not independent CAD.

## Resumed, 2026-11-05

The user explicitly resumed parallel development. Preserve
[the historical pause handoff](FASTENER_HANDOFF_20261104.md).
Whole dome, real late-runout body and the COMPLETE saved M6 cap-nut now pass
independent CAD/H8/K/INP gates:333824 H8, minSJ0.21572946, volume error about
5.79e-5. See [scope and evidence](CAP_DOME_AND_UPPER.md). Original CAD is
unchanged;512 shared faces/1024 nodes are paired without welding. Exact source
STEP copy/reimport is distinguished from the failing whole BRep STEP writer.
Native cap HM/solver/wider families remain open. Screw interface and native socket CAD/HM remain open; corrected
analytic node/face gates do not certify an independent CAD or the original TG.

## User-request checklist

- [x] Preserve the main development baseline; isolate bolt/thread work.
- [x] Recover and compare the original mesh core and built-in demo.
- [x] Verify the original bounded size/shape matrix, not just one M16 model.
- [x] Produce real mesh K, INP and mesh-only native HM.
- [x] Open generated bolt/nut catalogues and profile pairs in actual LSPP.
- [x] Preserve source notices and distinguish adapted components from full ports.
- [x] Push completed code to the user's fork development branch, not main.
- [ ] Complete every original GUI option and the original GUI-to-output path.
- [ ] Reproduce all researched upstream complete examples (profiles alone are partial).
- [ ] Complete independent design CAD for all exposed standard/family cases.
- [ ] Mesh that CAD with matching H8 geometry, including recesses and blind ends.
- [x] Store true independent CAD plus matching H8 in HM for the stated M6/M8 cases.
- [ ] Cover every exposed fastener family/combination with the same CAD+H8+HM workflow.
- [ ] Complete GB/ISO/DIN/ASME coverage, tolerances and verified equivalences.
- [ ] Add local near-thread count coarsening and complete GUI integration.

Latest bounded increment: eight real CAD cases pass the user-approved CAD-only
STEP exchange policy (1e-7). M6 bolt and explicitly square-ended through-thread
M6 nut pass full-body CAD/H8/K/INP matching. Both also have real saved/reopened
CAD+mesh HM, including the 3.58-million-cell bolt and source PID preservation.
The original library-faded M8 nut now also passes via the explicit planar-cap
runout mapping. M6 circumferential 2:1 core grading cuts H8 count by 48.45%
without changing its fine ring. Daily development is now a separate 210-H8
smoke tier (about 70 KiB), not these heavy acceptance fixtures. Representative
complete-feature development is a separate medium tier: the M6 socket bolt
has 160,704 H8, a 21.65 MiB K and a 19.12 MiB INP. It is not represented by
the tiny smoke tier. A later explicit socket fidelity run now passes unchanged
CAD/H8/K/INP gates with mapped fillet blocks and a compact 2:1 core: 818,112 H8,
minimum SJ 0.272627, CAD-volume error 0.00872952%. It is not the daily default
and does not certify native HM geometry exchange. No mesh QA
threshold was relaxed; native host runtime budget is a separate option.
Canonical mm design dimensions and the ASME 1/4-20 socket case now also pass:
1,244,256 H8, minSJ 0.272627, CAD-volume error 0.00899857%. Production socket
generation rejects volume errors before 3D allocation and reuses CAD queries.
See SOCKET_INCH_AND_PREFLIGHT.md; all other unverified families remain open.

## Scope and evidence

| ID | Requirement | Status | Evidence / remaining boundary |
| --- | --- | --- | --- |
| BASE-01 | Preserve original worktree and isolate development | DONE | Dedicated worktree/branch; unrelated CAD/flange edits preserved |
| BASE-02 | Stage local Git backups | DONE | c438c7f, 9b5a55f, 4c4a93a; subsequent fixes separate |
| BASE-03 | Push validated development to user's fork | DONE, INCREMENTS | `fork/codex/bolt-thread-native`; staged increments are pushed/verified separately, not merged into main |
| REC-01 | Recover readable Python mesh/part/INP core | DONE | Authorized recovered `tools/bolthex`, no EXE/bytecode runtime needed |
| REC-02 | Replay original built-in assembly | DONE | M16 bolt/nut/threaded plate INP byte-identical |
| REC-03 | Catalogue replay across original shapes/sizes | DONE, BOUNDED | 224 fixed-seed cases, 14 sizes; not arbitrary parameters or 224 GUI runs |
| REC-04 | Same-parameter actual original GUI export | PARTIAL | One M16 bolt GUI INP byte-identical; all GUI combinations not replayed |
| REC-05 | Recover and integrate original complete GUI | TODO | Raw GUI decompilation is not certified runnable |
| REC-06 | BoltPro portable application recovery | PARTIAL | Private bolthex_core source compiles and passes 15 bytecode-oracle cases including byte-identical INP. app/viewer/mesh_job source recovery and complete product integration remain pending |
| RES-01 | Research scripts, repositories, issues and PRs | DONE, BOUNDED | Three reports; platforms/access/version limits recorded |
| RES-02 | Research CAD/standards libraries | PARTIAL | bd_warehouse pinned adapter implemented; cq_warehouse and FreeCAD Fasteners are identified, not integrated |
| UP-01 | femssc four-point tooth construction | DONE, BOUNDED | MIT preserved; independent host-free profile, generic full-body K/INP |
| UP-02 | Complete femssc upstream self-drilling case | TODO | Drill tip, washer, Abaqus partitions, original Tie model not reproduced |
| UP-03 | sunwhale rounded external/internal scalar profiles | DONE, BOUNDED | Independent maths; original 64+64 samples match ~3.6e-15 |
| UP-04 | Complete sunwhale mesh workflows | PARTIAL, BAND IMPLEMENTATION REVIEWED | Seven-script/ten-case band replay work has been reviewed; current ten-case counts/quality/discrete volume rechecked before submission. Historical exact-source comparisons include explicit cyclic-label repairs. Complete fasteners/CAD/GUI remain pending; see HELICAL_BAND_REPLAY.md |
| UP-05 | TrueGrid Screw source/example | PARTIAL | Original TG audit rejects collapsed/bad cells; actual3D cavity/phase bindings and independent finite rod are implemented. Original finite axis replacement remains incomplete; see TRUEGRID_SCREW_REPLAY.md |
| UP-06 | Coreform helical/endpoint partition methods | TODO | Reproduce referenced journals or document/validate open-kernel equivalent |
| MESH-01 | Recovered solid bolt/nut/plate H8 generation | DONE, BOUNDED | Original demo and fixed catalogue; eight distinct-node checks in export |
| MESH-02 | Independent TypeScript shaft/nut foundation | PARTIAL | Separate experimental API, not equivalent full Python port |
| MESH-03 | Whole bodies around adapted profiles | DONE, BOUNDED | Two 36,528-H8 pairs; no upstream full-product or GB conformity claim |
| MESH-04 | CAD-driven automatic multi-block planning | PARTIAL | Saved-STEP radial intersections and shared shaft/head H8 mapping for bounded external-hex/open-nut cases; arbitrary CAD, terminating features and non-star runouts pending |
| MESH-05 | Near-thread 2:1 / 3:1 count reduction | PARTIAL | M6 external-hex case retained. New socket case uses compact 6-quad paired patches and 48->96->192->384 circumferential grading, preserving fine ring in tests. Axial/isotropic 3D and 3:1 thread grading remain pending |
| MESH-06 | General corners, weak balance and multiple fronts | TODO | Existing broader mesh-project gaps are not resolved by profile mapping |
| MESH-07 | Native joint generation, axial planning and physical taper | PARTIAL, BOUNDED BACKEND VERIFIED | Repository-native six-sector generator builds complete hex-bolt/open-nut/rectangle stacks without private restored code. K/merged INP/Part-Instance INP and local browser dispatch pass. Selection/offset variants, CAD pairing and count-transition support remain pending; see NATIVE_JOINT_BACKEND.md and NATIVE_JOINT_GUI.md |
| CAD-01 | Independent unmeshed design geometry | PARTIAL | Design-only `standard_cad.py`: eight real cases pass without FE input under approved CAD exchange policy; broader family cases remain |
| CAD-02 | Earlier FE-station ruled STEP | WITHDRAWN | Valid BRep, but grid-derived and not accepted design CAD; diagnostic flag only |
| CAD-03 | Earlier CAD-plus-mesh HM product acceptance | WITHDRAWN | Transfer mechanism worked; supplied geometry did not meet CAD-01 |
| CAD-04 | Real smooth helical geometry library backend | DONE, BOUNDED | bd_warehouse v0.3/build123d0.11.1; eight CAD regressions pass at user-approved 1e-7 exchange limit; old 1e-8 rejections retained as history |
| CAD-05 | Real driver recess and blind cap geometry | PARTIAL, SAVED M6 CAP COMPLETE | M6 and ASME 1/4-20 sockets retained. Whole saved M6 hemispherical cap nut now passes original CAD/H8/K/INP gates with real bore/runouts and exact dome/body interface. Cap HM, solver and wider sizes/families remain pending |
| CAD-06 | CAD/FE boundary matching | PARTIAL | Original faded M8 now passes unchanged STEP/H8/K/INP/HM using opt-in planar-cap mapping, including 7,144 extra surface probes. M6 and through-nut cases retained; arbitrary runouts/recesses still unsupported |
| IO-01 | Mesh-only LS-DYNA K | DONE | Existing writer/read-back, distinct PIDs, NODE/SOLID |
| IO-02 | Abaqus INP with bodies/regions/surfaces | DONE, BOUNDED | Demo STEEL defaults are not material calibration; explicit material selection pending |
| IO-03 | Real native mesh-only HM | DONE | HyperMesh2022.3 save/clear/reopen; not renamed Tcl/CMF |
| IO-04 | STEP+mesh native HM transfer | DONE, BOUNDED | Through-nut 385,920 H8/117 surfaces/1 solid and bolt 3,579,648 H8/173 surfaces/1 solid; native save/clear/reopen, unchanged mesh SHA, verified CAD bounds and source PID1. General families/performance remain limited |
| IO-05 | No-motion CAD association | NOT VERIFIED | Tested host moved ~1e-7 despite no-snap; strict gate rejected, not loosened |
| IO-06 | Direct native-CAD witness diagnostic | DONE, BOUNDED | `hypermesh_geometry_probe`: read-only HM, hash-bound STEP reference, finite surface probes plus off-surface trim controls. Actual socket HM: 10/241 surface witnesses exceed unchanged 2e-6 mm; diagnostic rejects, does not certify exact CAD or change production gates |
| STD-01 | Versioned GB/ISO/DIN/ASME catalogue | PARTIAL | Pinned CAD tables plus canonical mm design diameter/pitch; actual ASME 1/4-20 mapping verified. No certified editions/GB crosswalk or universal tolerance coverage |
| STD-02 | Internal/external limits and tolerance classes | TODO | Nominal/limit models; radial clearance is not a 6g/6H model |
| STD-03 | Validate cross-standard mappings | TODO | Similar ISO/DIN data must not automatically be relabelled GB/EN |
| FAM-01 | Rod/stud, partial/full thread, hands/fine pitch | PARTIAL | Profile hand/phase tests done; complete family/request coverage pending |
| FAM-02 | Flange, socket, blind/cap, insert/slot families | PARTIAL | M6 socket full H8/K/INP matching now passes; native HM geometry verification and other families pending |
| VAL-01 | Corner/Gauss/volume and boundary checks | PARTIAL | Existing case audits passed; not a proof for arbitrary imported CAD |
| VAL-02 | Independent CAD acceptance | PARTIAL | Eight opt-in real CAD regressions pass at explicitly approved 1e-7 exchange limit. CAD/H8 QA stays volume<=1e-4, cornerSJ>=.15, nodal witness<=2e-6 mm and face-centre distance<=.02 mm |
| VAL-03 | LSPP inspection of generated catalogue | DONE | 168-case board, M16 12-case board, two profile windows actually opened |
| VAL-04 | Extreme/odd seeds, tolerance/clearance, invalid inputs | PARTIAL | Limited guards; complete product-family validation matrix pending |
| VAL-05 | Regression coverage after current changes | PARTIAL, STATED SCOPE | Socket floor/void and discrete volume tests run against saved CAD; development budget/quality guards added. Full slow eight-case CAD construction and full TS suite not rerun in this iteration; exact current test totals recorded in socket development notes |
| UI-01 | Unified request/schema and GUI integration | PARTIAL, NATIVE JOINT FLOW VERIFIED | Existing workbench dispatches the repository-native analytical joint through a loopback Python host: allocation-free count/parameter preflight, shared/separate K+INP modes, audited preview/download, explicit failure/cancel, hash-bound completed-job recovery after page/host restart. Not the packaged desktop app or integration of recovered/CAD backends; batch queues, interrupted-job continuation and all original options remain pending |
| DOC-01 | Screenshots/HTML track honest acceptance | PARTIAL | Latest CAD/H8 review shows both complete M6 models, independent CAD and actual LSPP screenshots, K/INP/STEP/HM links, and original M8 runout rejection; broader cases pending |
| CLEAN-01 | Keep exports on F, runtimes on D, clean duplicates | ONGOING | Do not delete active LSPP models; logs/licences/large models excluded from Git |
| DEV-01 | Small default development regressions | DONE, BOUNDED | Two original-CAD runout patches, 105 H8 each; each K about 19 KiB, combined artifacts about 70 KiB. Hard caps 256 H8/patch and 1 MiB; slow CAD requires explicit opt-in. Not full-model acceptance |
| DEV-02 | Representative complete-feature development | DONE, BOUNDED | `socket_dev` defaults to feature profile, 72 circumferential segments and 16 axial intervals/pitch. Measured pitch, tooth crest and recess dimensions; strict CAD-volume test fails and is explicitly labelled, not waived |
| DEV-03 | Preflight counts and volume before 3D allocation | DONE, BOUNDED | `socket_plan` CLI plus mandatory production socket volume preflight/cache reuse. Excessive/nonfinite errors reject before `_sweep`; fixed 1e-4 gate not relaxed. Counts/budgets and final whole-body QA remain separate |

## BoltPro increment, not whole-product completion

Subsequent native increment: the repository now has a bounded complete assembly
backend independent of the private restoration experiment below. Default and
preserved-dimension cases pass, including 53,592 H8/SJ0.40948 and independent
K/INP audits. It uses repository six-sector templates and its own analytical
field, not BoltPro node parity or independent CAD. Current regression114 tests,
103 pass/11 skips at that CLI milestone. The subsequent bounded browser GUI is
now verified; unified desktop deployment is still not complete. See
NATIVE_JOINT_GUI.md for exact scope and repeatable GUI acceptance.

GUI acceptance on 2026-11-04 generated the preserved-dimension 53,592-H8 case
from the actual form, checked K/INP SHA-256 downloads, read-only model counts,
70,095 rendered blue model pixels, invalid rectangle rejection, cancellation
before the POST response returns, no modal overflow at 390px, and zero native
API requests when the backend capability is absent. No console/page errors.
This closes a bounded integration path, not the other family/CAD/3D/standards
rows above. Evidence: temp/20261104-native-joint-gui/acceptance-v2.

- Source restoration is distinct from product integration. Core parity: 15/15;
  full reference joint INP also byte-identical under ordinary Python 3.11.
- A resampled joint initially failed SJ=0.1198. A grid-independent physical
  taper field resolves that stated case at SJ=0.37165, 45,660 H8, preserving
  axial dimensions16.1/13.1/8.2 and explicitly reporting the 0.2 head/plate gap.
- Actual K/INP and LSPP image are retained locally. This is a sampled-profile
  design, not independent CAD fidelity or solver validation.
- Native job status persistence now retries bounded transient Windows errors;
  persistent permissions failures are not waived. See BOLTPRO_ABSORPTION.md.
- Full Python regression:106 tests,95 passed/11 optional skips, including
  pre-existing uncommitted band tests. Those unrelated changes remain untouched.

## Next execution sequence

2026-11-04 native GUI follow-up: shared/separate node modes and completed-job
recovery are now verified. Actual K/INP ownership checks distinguish 56,704
shared nodes from 61,120 separate nodes at the same 53,592 H8/SJ0.40948.
128 Python tests:117 passed/11 optional skips;22 targeted Node tests passed.
See NATIVE_JOINT_GUI.md. This does not close CAD/standards/3D/family TODOs.
The allocation-free preflight follow-up exposes the same count planner to CLI,
HTTP and GUI and rejects invalid input before spawning a mesh job. Current
regression132 tests:121 passed/11 optional skips, plus22 targeted Node tests.

1. DONE: publish this TODO and reject the earlier grid-derived CAD acceptance.
2. DONE, BOUNDED: independent stock CAD via a pinned optional backend; eight
   cases pass the explicitly approved CAD-only 1e-7 exchange policy. Retain
   former 1e-8 rejection evidence as history, not as current failures.
3. PARTIAL: full-body bolt, square-ended nut and original faded M8 runout now
   validated with native HM. Circumferential core grading is implemented. Next:
   broader runout/recess families and axial/3D thread-region grading. Iterate
   using the small development tier, not repeated million-cell exports.
4. Replay full upstream mesh cases and implement remaining source-specific
   methods: femssc drill-tip/washer, sunwhale full meshes, TrueGrid Screw and
   Coreform open-kernel partition equivalents.
5. Verify dimensions, editions and limits for ISO/DIN/ASME and GB mappings.
   Upstream CSV availability alone does not certify a standards implementation.
6. Extend recess/cap/runout families, near-thread 2:1/3:1 count reduction and GUI.

## Current concrete blockers

- The CAD-only exchange policy changed from 1e-8 to 1e-7 with explicit user
  approval on 2026-11-02. Earlier M6 ISO4032/DIN1587 rejections are historical;
  eight CAD cases pass the current policy. No FE/CAD or SJ gate changed.
- The old constant-angle radial mapper still fails the faded M8 cap, retained
  as a negative control. The new planar-cap-aware mode passes the original
  unchanged STEP. Other caps/overlapping supports need separate coverage.
- The current M6 bolt fidelity model has 3.58 million H8 cells. It now passes
  full K/INP/CAD/native-HM audits, with a 900-second host processing budget.
  A 1.85-million-H8 core-graded counterpart now preserves the fine ring and passes
  full audits. Both are optional high-fidelity references, not daily test defaults.
- The recovered cylindrical head has no internal socket and its dome nut has
  an open bore. The new independent socket mapper now stops its solid core at
  the actual CAD floor and continues a head annulus above it. The representative
  medium M6 development model retains measured CAD-volume error 0.16266% as
  history. The new fillet-block fidelity case passes at 0.00872952%, below
  the unchanged 0.01% production limit. Native HM geometry still remains
  unverified: turning CAD export optimization off did not fix drift, and tight
  import cleanup lost closed-solid topology on STEP re-export. Neither was
  promoted to the production adapter. Direct internal native volume is within
  about 5.47e-8 relative of source, but 10/241 point queries still exceed 2e-6 mm;
  geometry vs host projection accuracy remains to be separated. A reusable
  diagnostic now detects this instead of accepting on volume alone.
  See SOCKET_DEVELOPMENT.md.
- Old profile-pair meshes and standard-library CAD are different designs; their
  combination remains withdrawn. New matched bundles bind exact K/STEP hashes.
- No complete GB/US/European universal family/tolerance catalogue exists in this
  implementation. Do not infer this from a few library standard labels.

## Acceptance rules

- "All completed" is prohibited until applicable TODO rows are actually closed.
- Separate formula tests, mesh generation, unmeshed CAD, host transfer, GUI and
  solver validation. Do not use one category as evidence for another.
- Do not reduce quality thresholds or change geometry to force an acceptance.
- Preserve original notices and licences; never commit keys, host licensing logs,
  credentials, private application binaries or large review-board model files.
- Partial implementations remain labelled partial, with a reproducer and gap.
- Current flags and repository coverage are updated as work completes, not only
  at the end. Remote completion requires `ls-remote` comparison, not a push claim.
