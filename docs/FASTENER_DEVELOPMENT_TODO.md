# Fastener development TODO

Updated: 2026-11-12, Asia/Shanghai. Work branch: `codex/bolt-thread-native`.
Destination: `lwz20210407/HexRefine`, development branch only; no main/PR merge.

Status: DONE = scoped implementation and stated evidence; PARTIAL = only a
component; TODO = not implemented; WITHDRAWN = earlier acceptance corrected.
Reading a repository is not porting it. Writing a STEP is not independent CAD.

## 2026-11-12 Interface Continuation

- IMPLEMENTED, NOT WHOLE-MESH ACCEPTANCE: [full-source patch assembly and
  K/INP candidate IO](VOLUME_PATCH_ASSEMBLY.md). New interior-node macro
  connectivity can be installed into all source rows, with protected
  attachments, moved-neighbour checks, stable identities and byte-bound IO.
  Thirteen targeted tests pass, including the actual6128-row rejection case.
  The actual head macro itself still has no accepted fill. A snapshot-bound
  readback closes the real269-to700001 EID publication fault found in review.

- DONE, BOUNDED: [bilinear interface mapping](BILINEAR_INTERFACE_MAP.md)
  uniquely accounts for all2160source corewall supports in the actual2318-face
  neck/core union.2145are direct four-corner planning candidates;15retain
  explicit trim/edge-chain obligations. All physical faces remain accounted
  for; support identity does NOT certify trim identity or mesh installation.
  Ten tests, zero skips, including actual full-source mapping and adversarial
  input controls. No engineering distance tolerance replaces source binding.
  Combined with the earlier real6128-cell local face-compensation checks,
  the selected17test methods passed with zero skips (20.076seconds); not a
  full repository suite or whole-model acceptance.
- DONE, NARROW GEOMETRY BACKEND: [source-defined ring BRep](SOURCE_RING_BREP.md)
  generates the actual full2160-parent radial0.6..1ring in the repository,
  without MATLAB/TG or an absolute-path scratch dependency. All4396physical
  faces,4282internal source-side pairs and1080retained outer owners are
  verified. One valid closed solid, volume14.089699692691264mm^3, matches the
  actual source-slice integral; cold read preserves all4396control nets/trims.
  The22-test suite passed with zero skips against a fixed-version real CLI
  result (main14.099seconds). This is source-derived geometry, not independent
  design CAD, a completed material partition, a volume mesh or accepted K.
- REJECTED EXPERIMENTS: head-cycle harmonic morphing on the full6128-row
  source produced new negative corner Jacobians (3cells in the224-cell scope;
  9in the244-cell alternative). Volume and Gauss positivity did not override
  these failures; neither candidate was exported as a successful K/INP.
  Fixed-boundary prechecks show local topology changes are necessary for the
  tested mappings, not further weight tuning. Head exterior/thread unchanged.
  Further actual top-pair flips, four-layer connectivity propagation and XY
  propagation also failed3Dcorner/Gauss/neighbor gates. A small no-new-node
  corner-star H8fill family was infeasible, not a general impossibility proof.
  Next required capability: a local3Dmacro with interior nodes and unchanged
  side/bottom interface obligations, rather than further unconstrained morphs.
- MATERIAL PARTITION OBLIGATION: E2924has27strict neck-interior samples,
  including20in the open source face, confirmed by exact rational source-column
  preimages. Restoring its entire old root square as an exterior face is wrong.
  The other14blocked interfaces remain separately unresolved; sampled OUT is
  not a whole-face exclusion proof. No whole-Screw acceptance is granted.

Evidence and current figures:
`F:/PythonWoking/temp/20261112-screw-interface-continuation/`.
Next closures: source-consistent neck/collar partition, local head connectivity
patches and full assembled H8/geometry/K/INP validation. These are not release
cleanup tasks and must not be silently marked complete.

## Verified Bounded Closures, 2026-11-07

### Approved Contact Compensation Continuation

The user now permits only necessary local head-contact topology compensation:
head exterior, distant mesh and thread stay unchanged; original files are
read-only. Determine actual source-bound parents/node stars, not an entire
332-face contact set or bounding-box expansion.

- DONE, BOUNDED: [explicit boundary-budget audit](SCREW_BOUNDARY_BUDGET.md),
  all76end groups/308annular Q4s against both raw and phase.22targeted tests
  passed with0skips in the main rerun. Maximum sampled raw distance0.000312829mm
  is within the unchanged0.0005mm budget. The existing exact planner/default
  is untouched; finite samples do not certify continuous Hausdorff distance.
- DONE, BOUNDED: [exact local face compensation](EXACT_FACE_COMPENSATION.md).
  Four complete head interfaces joined by eight exact node-alias pairs:
  16element rows/24slots changed, no coordinate movement, K/INP readback passed.
  Seven targeted test methods passed with actual-case checks. Global axis repair,
  remaining head seams and the neck footprint are NOT claimed complete.
- IN PROGRESS: a complete2160-parent core CAD was built and checked, but a
  BODY-only meshing attempt rejected overlapping lower facets. Actual source
  E2889/F1 is a real neck interface, not a free end. Correct the joint material
  domain rather than flatten the lower cap or raise tolerances.

These increments close specific missing interfaces, not the entire workstream
or all source-application options. The remaining-work table below still applies.

### Latest Native Washer And Screw Status

- DONE, BOUNDED: explicit unoptimized native IGES to exact-valid BRep carrier
  is integrated in the production HM exporter (cb3ae6a). No automatic fallback,
  STEP renaming or tolerance escalation. Direct native STEP remains rejected.
- DONE, BOUNDED: the complete D12/d6.4/t1.6 washer has a saved/reopened native
  HM with 24,192 nodes, 19,008 H8, six surfaces and one solid. Full-boundary
  geometry and independent native K/source K/INP identity checks passed
  (436e58c). All 9,792 boundary nodes, 9,792 boundary face centres and 19,008
  cell centres were tested. Mesh/carrier relative volume error is 8.018667e-5
  against the unchanged 1e-4 limit. CAD association and physics are NOT certified.
- DONE: source-bundle-driven washer references, outside immutable source input,
  with actual STEP/K/report hashes and real NIDs (d7fbc74). Two sizes are tested;
  the generated reference was rechecked against actual existing native carriers.
  The 134-test CAD/HM/reference selection and separate 37-test IO selection
  passed with zero skips; these are not the full repository suite.
- IN PROGRESS: original Screw. The protected endpoint template solve remains
  rejected after a bounded 114-to-256-parent diagnostic search. No successful
  replacement or whole Screw K/INP was produced. This finite-library result is
  not a general impossibility theorem for hex meshes.
- AUTHORIZED, NOT YET ACCEPTED: the user approved local engineering-budget
  regularization of the actual upper axis cusp on 2026-11-07. Original files,
  threads and retained regions must remain unchanged; output is separate and
  Jacobian checks are not relaxed. The lower neck interface is a different
  geometry and must not receive the same treatment without evidence. A local
  repaired geometry target will not count as a meshed or accepted whole Screw.
- DONE AS A CANDIDATE GENERATOR, NOT A REPAIR: the hash-bound upper-tip target
  implements that approved local regularization for the reviewed raw/phase
  source pair. It reuses declared target0.2mm / critical budget0.0005mm,
  allocates half to geometry and reserves half for future mesh approximation.
  Exact solid-domain deviation bound is0.000224751mm; conservative relative
  added-volume bound is4.49411e-5. Thirty actual-source/helper/readback tests
  passed with zero skips. Boundary-distance acceptance, actual core meshing,
  global interfaces and complete K/INP remain open. A tiny SJ=1 witness is not
  an engineering mesh or mandatory seed. See [target scope](SCREW_TIP_REGULARIZATION.md).
- DONE, LOCAL ONLY: [actual tip BRep construction](SCREW_TIP_BREP.md) now
  reconstructs the reviewed source cell, materializes the target and performs
  a configured zero-fuzzy/non-destructive union, save/readback and real boundary
  checks for both source variants. The union has14faces/one positive closed
  solid; complete original F1/F3/F4 support/trim/topology remain unchanged.
  Dense local source patches and reverse faces/edges/vertices are checked,
  not only the whole-face grids that miss the tiny changed region. Measured
  maxima are0.000146410mm and0.000154623mm. Nineteen targeted tests pass,
  including post-readback/pre-publication artifact corruption rejection.
  This is not independent design CAD, a whole Screw mesh, a global boundary
  Hausdorff certificate or K/INP acceptance. Core/end interfaces remain open.

The latest combined endpoint/collar/target/independent-readback/local-BRep
selection passed106tests with zero skips in113.395seconds. Evidence:
`iges-production-screw-20261107/screw-study/combined-main-106-tests.log`.
This remains a scoped actual-source selection, not the full repository suite.

Current native delivery and VTK readback views:
`F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm/iges-production-screw-20261107/REVIEW.html`.
The older snapshots below describe their original checkpoints, not the latest
washer acceptance. Screenshots are explicitly VTK data renders, not HM/LSPP UI.

- DONE: mesh-only joint quality diagnostics, overall and per PID, with exported
  global element IDs, separately named SJ/determinant-ratio/angle measures and
  advisory references. Commit8767ca8. Region classification and optimization
  remain open; a solver is not required to generate or publish a mesh.
- DONE, BOUNDED: seven pinned nominal catalogue entries with explicit unknown
  standards editions and unsupported tolerance-class requirements. Commitbc68dc5.
  This is not complete GB/ISO/DIN/ASME coverage or an equivalence table.
- DONE: interrupted-job fresh regeneration through HTTP and the workbench,
  immutable saved request, new UUID, parent lineage, cancellation and recovery.
  Commit9dbcb7d. This is not continuation of an old process or partial mesh.
- DONE, BOUNDED: release evidence/allowlisted-test harness separates required
  mesh delivery from optional physical analysis and refuses ambiguous duplicate
  artifacts. Commit0eb955f;28tests passed. Full-feature release remains false.
- DONE, BOUNDED: custom unchamfered annular washer independently generates
  design CAD plus H8, STEP, K and INP. The complete19008-H8/24192-node case has
  exact K/INP connectivity, source geometry preserved and volume error7.93256e-5.
  Commited76bc0. This is not a standards-certified washer, graded washer or
  complete native-HM acceptance.
- PARTIAL: high-level HM export now propagates the explicit engineering CAD
  profile and checks raw native geometry plus independent closed BRep volume.
  Commit38ad5a9. The real washer's native save/reopen retained all mesh data,
  but exported STEP distances0.001076/0.001066mm exceeded the unchanged0.0005mm
  policy in BSpline/Standard modes. Both failures remain recorded. See
  [native HM policy](NATIVE_HM_POLICY.md).
- OPTIONAL, NOT A MESH GATE: previously developed affine-verification tooling
  is isolated in commite4b8941, without adding runtime solver dependencies to
  mesh generation. No commercial solver was needed in this continuation.
- DONE: workbench overall/per-PID quality foldouts, formula-specific values,
  undefined-field handling and global element IDs; old reports stay compatible.
  Six formatter tests and a complete actual10440-H8 production-handler GUI
  generation/readback/recovery/mobile run passed. This is a diagnostic viewer,
  not automated shape optimization or focus-region classification.
- DONE: failed native STEP audits explicitly produce a rejection record rather
  than treating the retained candidate `.hm` as an accepted delivery. Commit992eb0a;
  eight policy tests passed, including missing and nonfinite audit evidence.
- DONE, BOUNDED: reusable native-capture closed-BRep assembly and save/comparison
  guards. Root ownership, full state, current tolerances and true geometry
  mutations are checked.29tests passed, including five actual complete-M6
  construction/save/reopen checks; the earlier full source sweep was not rerun.
  Only observed codec normalization is accepted on readback, not relaxed CAD
  accuracy. This analysis BRep bridge is not generic CAD healing or a native-HM
  product certificate. See [scope](NATIVE_TRIM_SOLID.md).

Final deduplicated bounded regression:190Python tests, zero skips, excluding
the separately tested native-solid module and optional analysis tooling.
Evidence: `resume-20261107/final-bounded-regression-v1/result.json`. This remains
a selected fastener regression, not the entire TypeScript/Python repository.

Current regression evidence:
`F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm/resume-20261107`.
The82-test core/HTTP selection passed with zero skips; TypeScript source,
public types and build passed. A later35-test washer/HM selection passed with
zero skips. These overlap and are not advertised as a sum or full project suite.
The separate optional verifier selection passed10tests.

Current mesh screenshots and independent readback evidence:
`../flat-washer/review-20261107/evidence-v1/index.html` relative to that evidence
directory. The HTML explicitly marks the native STEP/HM case as not accepted.
No original source models, previous evidence or user GUI sessions were replaced.

## Current Remaining Work, 2026-11-06

This section supersedes stale status descriptions in the historical increments
below. The branch is not only awaiting release cleanup. No overall completion
percentage is certified: families, parameter combinations and solver workflows
have different scopes and costs.

| Priority | Workstream | Implemented scope | Required next closure |
| --- | --- | --- | --- |
| P0 | Original Screw finite axis and endpoints | Full6128-cell phase compensation;1044face pairs;3968outside cells unchanged. Whole2160-parent mapped collar produces15120H8 and8640inner quads | Fill the actual core, close both nonplanar end loops and neck/head interfaces, verify no void/overlap, domain volume and complete K/INP. The19088-cell hollow composite is NOT a repaired Screw |
| P0 | Quality and acceptance | Explicit corner/center/Gauss metrics; VTK/Verdict comparison; center-collapse rejection; whole-M6 reassessment; mesh-only whole-joint/per-PID diagnostics | Focus/transition-region classification, shape optimization and geometry/mesh/IO acceptance. Solver/convergence checks are optional analysis verification and MUST NOT block mesh generation or mesh-only publication. Historical SJ0.15is NOT a universal vendor standard |
| P1 | CAD/HM fidelity and reusable geometry bridge | Saved M6 hemisphere cap native94faces/one solid +333824unchangedH8 verified for geometry/data. Real trim query module verifies94faces/1053queries | General reusable closed-BRep assembly, broader socket/cap/runout coverage, engineering-profile recheck of prior socket failures, CAD associations without unauthorized FE motion, robust STEP carrier export |
| P1 | Complete fastener structures | Bounded hex bolts/open nuts, original faded M8, M6 and1/4-20sockets, saved M6 complete cap | Shoulder/actual bore-wall late-runout variants; wider caps/blind ends; flanges,washers,self-drilling tips,slots,inserts; consistent independent CAD+H8+K/INP/HM for exposed combinations |
| P1 | Three-dimensional local grading | Bounded circumferential2:1core grading and paired patches | Axial and joint3D grading, near-thread3:1/multilevel transitions, general O-grid corners/weak-balance/multiple fronts while preserving the focus region and retained exterior |
| P1 | Assembly, GUI and batching | Native complete hex-bolt/open-nut/rectangular plate stack; shared/separate node K/INP; browser preflight,preview,cancel and completed-job recovery | CAD-matched assembly variants, offsets/hole selections and all generators in one request schema; original GUI options; desktop packaging,batch queues and interrupted-job continuation |
| P2 | Standards and source-project coverage | Pinned nominal libraries and bounded original/upstream profile/catalogue cases | Versioned GB/ISO/DIN/ASME dimensions and crosswalks, internal/external tolerance classes, complete upstream self-drill/washer and fastener workflows, cq_warehouse/FreeCAD adapters where useful |
| P2 | Regression and release | Scoped real-case evidence, separate small/medium/large tiers, local/fork increments | Complete declared support matrix, parameter/boundary/performance regressions, repeatable deployment and API docs. Contact/preload/physical solver validation are a separate declared layer, not automatically certified by mesh export |

### Immediate Execution Order

1. Close original Screw core/endpoints using the existing whole interface data;
   do not replace this with another isolated positive box or analytic rod.
2. Validate a whole-model candidate and its region-level quality; preserve the
   original files and explicitly distinguish old defects from newly generated
   cells. Nonstructured ALL-H8 is user-authorized; intermediate TET/PYR is not
   a permitted final element mix.
3. Consolidate the verified native-CAD/HM mechanisms, then close remaining
   shoulder/bore-runout and exposed structure combinations in parallel.
4. Integrate verified generators into the GUI/batch workflow and execute the
   declared release matrix. Standard-library expansion remains separately
   tracked instead of silently changing the definition of completion.

### Evidence And Important Qualifications

- Quality-policy checkpoint:9c12e08; subsequent increments are verified against
  the fork separately, on the development branch only.
- Whole M6 geometry/data pass remains valid. Quality reassessment finds36290
  of333824cells below the Verdict/Cubit SJ0.5reference and8below the separate
  HyperMesh-style Gauss determinant-ratio0.7reference. These are advisory
  comparisons, not interchangeable standards or automatic solver acceptance.
  See [metric policy](H8_QUALITY_METRIC_POLICY.md).
- The whole Screw collar has exact hard tooth/lateral matches, but two76-node
  nonplanar inner end loops and308annular faces remain unresolved. Its raw
  minimum SJ is0.14476584, with27cells below the historical0.15screen; the
  failed quality-constrained template solve is retained. Neither that number
  nor positive samples certify the unfilled model.
- Optional Gmsh TET-to-H8 and mixed-pyramid controls are prerequisites under
  development, not a completed full-source repair. No third-party GPL template
  table is silently incorporated into this repository.

## Historical Increments

## Resumed, 2026-11-05

The user explicitly resumed parallel development. Preserve
[the historical pause handoff](FASTENER_HANDOFF_20261104.md).
Whole dome, real late-runout body and the COMPLETE saved M6 cap-nut now pass
independent CAD/H8/K/INP gates:333824 H8, minSJ0.21572946, volume error about
5.79e-5. See [scope and evidence](CAP_DOME_AND_UPPER.md). Original CAD is
unchanged;512 shared faces/1024 nodes are paired without welding. Exact source
STEP copy/reimport is distinguished from the failing whole BRep STEP writer.
At this historical checkpoint cap HM/solver/wider families were open; the
bounded cap native-HM geometry/data result is now closed as noted above.
Screw interface and native socket CAD/HM remain open; corrected
analytic node/face gates do not certify an independent CAD or the original TG.
The optional complete-body exterior alignment also passes: all six actual hex
corner lines are anchored,286720 inner nodes retained, then the whole333824-H8
cap reassembles with384514 unchanged inner nodes and identical connectivity.
Its CAD-volume error is5.24309e-5; actual K/INP and29 targeted tests pass. This
does not close general CAD-crease,3D thread grading, native-HM or Screw repair.
Continued Screw/HM work now has a verified actual-source boundary contract and
independent native-SDK/STEP-carrier validators;46 targeted tests pass. Original
Screw replacement and native-HM fidelity still remain open. See
[continuation evidence and limits](SCREW_HM_CONTINUATION.md); no diagnostic or
passing support-surface sample is a completed native-HM or core-repair claim.

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
| CAD-05 | Real driver recess and blind cap geometry | PARTIAL, SAVED M6 CAP GEOMETRY/DATA VERIFIED | M6 and ASME1/4-20sockets retained. Whole saved M6 cap has real bore/runouts, exact dome/body interface and verified native-HM geometry/data. Wider sizes/families and solver/quality assessment remain open |
| CAD-06 | CAD/FE boundary matching | PARTIAL | Original faded M8 and prior M6 cases retained. Saved M6 cap has bounded CAD/H8/K/INP/native-HM evidence; its separate Altair STEP writer still fails full reference coverage. Arbitrary runouts/recesses and general reusable closed-BRep transfer remain open |
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
| FAM-02 | Flange, socket, blind/cap, insert/slot families | PARTIAL | Saved M6 whole cap native-HM geometry/data is verified. Socket engineering-profile recheck, broader sizes and flange/insert/slot/self-drill/washer families remain pending |
| VAL-01 | Corner/Gauss/volume and boundary checks | PARTIAL | Existing case audits passed; not a proof for arbitrary imported CAD |
| VAL-02 | Independent CAD and mesh-quality acceptance | PARTIAL, POLICIES SEPARATED | Eight opt-in CAD regressions retain their stated exchange policy. Size-aware CAD-transfer profiles are now explicit; source math and mesh validity are separate. Historical cornerSJ0.15is not a vendor-wide standard or sufficient engineering acceptance; see H8_QUALITY_METRIC_POLICY.md |
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

- 2026-11-12 Screw continuation remains PARTIAL. Full 6,193-H8 head-stage
  K/INP candidates preserve all literal identities and 5,900 protected source
  cells under the explicitly bounded contact-compensation plan. All 293
  mandatory new/moved-neighbour cells have closed-reference-cube positive-J
  certificates. Shape improvement is ongoing; inherited head/neck/body axis
  defects are not promoted to accepted whole-model status. The actual upper
  core's first hybrid fill was rejected for directed internal-face conflicts
  and volume error, not waived by type-only all-H8 conversion. The actual
  334-Q contact field still needs fully filled irregular transition cavities;
  a boundary-only solution is not a completed buffer. See
  [mixed-cell gate](MIXED_CELL_FACE_AUDIT.md) and
  [full-source installer](VOLUME_PATCH_ASSEMBLY.md).

- 2026-11-05 accepted bounded milestone: the complete saved M6 hemisphere-cap
  nut now has verified94-face/one-solid native HM plus333824unchangedH8.
  Fresh independent CAD/FE evidence passes the explicit engineering policy;
  the separate STEP writer still rejects. See NATIVE_CAP_ENGINEERING_BUNDLE.md.
  This supersedes the earlier incomplete native-M6 status below, not the
  unresolved socket/family/association/solver work.
- Original Screw: measured phase compensation handles the whole2160-cell body
  within6128source cells, with3968outside cells unchanged and1044face pairs
  identified. Seventeen dedicated tests pass after independent review. Axis SJ remains zero, so this is
  preprocessing only and is NOT an accepted repair or completed product.

- 2026-11-05 continuation: immutable source-CAD2D/canonical3D payload interfaces
  now have22 focused passing regressions, and the combined source/native
  diagnostic suite has69passes/0skips. This is adapter input data, not native-HM
  precision acceptance. A direct public-SDK94-face solid saves/reopens, but its
  carrier still fails the unchanged geometric/volume gates. Source Screw
  contact detection now prevents ID-unmatched faces from being treated as
  globally free; the22-H8 replacement remains rejected for outside-source
  overlap. Full-source neighbors refute a zero-dimensional-space claim at W,
  so finite expanded-scope planning continues. See SOURCE_CAD_SDK_PAYLOAD.md.

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
