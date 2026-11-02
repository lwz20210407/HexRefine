# Fastener development TODO

Updated: 2026-11-02, Asia/Shanghai. Work branch: `codex/bolt-thread-native`.
Destination: `lwz20210407/HexRefine`, development branch only; no main/PR merge.

Status: DONE = scoped implementation and stated evidence; PARTIAL = only a
component; TODO = not implemented; WITHDRAWN = earlier acceptance corrected.
Reading a repository is not porting it. Writing a STEP is not independent CAD.

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
- [ ] Store true design CAD plus its corresponding mesh in a native HM model.
- [ ] Complete GB/ISO/DIN/ASME coverage, tolerances and verified equivalences.
- [ ] Add local near-thread count coarsening and complete GUI integration.

Latest bounded increment: eight real CAD cases pass the user-approved CAD-only
STEP exchange policy (1e-7). M6 bolt and explicitly square-ended through-thread
M6 nut pass full-body CAD/H8/K/INP matching. Both also have real saved/reopened
CAD+mesh HM, including the 3.58-million-cell bolt and source PID preservation.
The original library-faded M8 nut is still rejected locally. No mesh QA
threshold was relaxed; native host runtime budget is a separate option.

## Scope and evidence

| ID | Requirement | Status | Evidence / remaining boundary |
| --- | --- | --- | --- |
| BASE-01 | Preserve original worktree and isolate development | DONE | Dedicated worktree/branch; unrelated CAD/flange edits preserved |
| BASE-02 | Stage local Git backups | DONE | c438c7f, 9b5a55f, 4c4a93a; subsequent fixes separate |
| BASE-03 | Push validated development to user's fork | DONE | `fork/codex/bolt-thread-native`, b0c5086 remotely verified; further validated increments use the same branch |
| REC-01 | Recover readable Python mesh/part/INP core | DONE | Authorized recovered `tools/bolthex`, no EXE/bytecode runtime needed |
| REC-02 | Replay original built-in assembly | DONE | M16 bolt/nut/threaded plate INP byte-identical |
| REC-03 | Catalogue replay across original shapes/sizes | DONE, BOUNDED | 224 fixed-seed cases, 14 sizes; not arbitrary parameters or 224 GUI runs |
| REC-04 | Same-parameter actual original GUI export | PARTIAL | One M16 bolt GUI INP byte-identical; all GUI combinations not replayed |
| REC-05 | Recover and integrate original complete GUI | TODO | Raw GUI decompilation is not certified runnable |
| RES-01 | Research scripts, repositories, issues and PRs | DONE, BOUNDED | Three reports; platforms/access/version limits recorded |
| RES-02 | Research CAD/standards libraries | PARTIAL | bd_warehouse pinned adapter implemented; cq_warehouse and FreeCAD Fasteners are identified, not integrated |
| UP-01 | femssc four-point tooth construction | DONE, BOUNDED | MIT preserved; independent host-free profile, generic full-body K/INP |
| UP-02 | Complete femssc upstream self-drilling case | TODO | Drill tip, washer, Abaqus partitions, original Tie model not reproduced |
| UP-03 | sunwhale rounded external/internal scalar profiles | DONE, BOUNDED | Independent maths; original 64+64 samples match ~3.6e-15 |
| UP-04 | Complete sunwhale mesh workflows | TODO | Replay full legacy mesh, multi-pitch/boundary-layer cases; not just scalar loops |
| UP-05 | TrueGrid Screw source/example | TODO | Real TG run, element-type/Jacobian audit, remove/reject axis degeneracy |
| UP-06 | Coreform helical/endpoint partition methods | TODO | Reproduce referenced journals or document/validate open-kernel equivalent |
| MESH-01 | Recovered solid bolt/nut/plate H8 generation | DONE, BOUNDED | Original demo and fixed catalogue; eight distinct-node checks in export |
| MESH-02 | Independent TypeScript shaft/nut foundation | PARTIAL | Separate experimental API, not equivalent full Python port |
| MESH-03 | Whole bodies around adapted profiles | DONE, BOUNDED | Two 36,528-H8 pairs; no upstream full-product or GB conformity claim |
| MESH-04 | CAD-driven automatic multi-block planning | PARTIAL | Saved-STEP radial intersections and shared shaft/head H8 mapping for bounded external-hex/open-nut cases; arbitrary CAD, terminating features and non-star runouts pending |
| MESH-05 | Near-thread 2:1 / 3:1 count reduction | TODO | Preserve tooth focus, core and far-field; no substitute uniform over-refinement |
| MESH-06 | General corners, weak balance and multiple fronts | TODO | Existing broader mesh-project gaps are not resolved by profile mapping |
| CAD-01 | Independent unmeshed design geometry | PARTIAL | Design-only `standard_cad.py`: eight real cases pass without FE input under approved CAD exchange policy; broader family cases remain |
| CAD-02 | Earlier FE-station ruled STEP | WITHDRAWN | Valid BRep, but grid-derived and not accepted design CAD; diagnostic flag only |
| CAD-03 | Earlier CAD-plus-mesh HM product acceptance | WITHDRAWN | Transfer mechanism worked; supplied geometry did not meet CAD-01 |
| CAD-04 | Real smooth helical geometry library backend | DONE, BOUNDED | bd_warehouse v0.3/build123d0.11.1; eight CAD regressions pass at user-approved 1e-7 exchange limit; old 1e-8 rejections retained as history |
| CAD-05 | Real driver recess and blind cap geometry | PARTIAL | Socket and closed-cap CAD accepted; matching H8 recess/cap topology is not implemented |
| CAD-06 | CAD/FE boundary matching | PARTIAL | M6 bolt + separately designed square-ended M6 nut pass complete H8, CAD volume, all face-centre checks, node witnesses, K and INP audits; original faded M8 runout still rejected |
| IO-01 | Mesh-only LS-DYNA K | DONE | Existing writer/read-back, distinct PIDs, NODE/SOLID |
| IO-02 | Abaqus INP with bodies/regions/surfaces | DONE, BOUNDED | Demo STEEL defaults are not material calibration; explicit material selection pending |
| IO-03 | Real native mesh-only HM | DONE | HyperMesh2022.3 save/clear/reopen; not renamed Tcl/CMF |
| IO-04 | STEP+mesh native HM transfer | DONE, BOUNDED | Through-nut 385,920 H8/117 surfaces/1 solid and bolt 3,579,648 H8/173 surfaces/1 solid; native save/clear/reopen, unchanged mesh SHA, verified CAD bounds and source PID1. General families/performance remain limited |
| IO-05 | No-motion CAD association | NOT VERIFIED | Tested host moved ~1e-7 despite no-snap; strict gate rejected, not loosened |
| STD-01 | Versioned GB/ISO/DIN/ASME catalogue | PARTIAL | Pinned CAD tables enumerable for selected ISO/DIN/ASME families; no certified edition/GB crosswalk; recovered 14-size table is not authoritative |
| STD-02 | Internal/external limits and tolerance classes | TODO | Nominal/limit models; radial clearance is not a 6g/6H model |
| STD-03 | Validate cross-standard mappings | TODO | Similar ISO/DIN data must not automatically be relabelled GB/EN |
| FAM-01 | Rod/stud, partial/full thread, hands/fine pitch | PARTIAL | Profile hand/phase tests done; complete family/request coverage pending |
| FAM-02 | Flange, socket, blind/cap, insert/slot families | TODO | Each needs appropriate CAD and H8 topology; not just added table rows |
| VAL-01 | Corner/Gauss/volume and boundary checks | PARTIAL | Existing case audits passed; not a proof for arbitrary imported CAD |
| VAL-02 | Independent CAD acceptance | PARTIAL | Eight opt-in real CAD regressions pass at explicitly approved 1e-7 exchange limit. CAD/H8 QA stays volume<=1e-4, cornerSJ>=.15, nodal witness<=2e-6 mm and face-centre distance<=.02 mm |
| VAL-03 | LSPP inspection of generated catalogue | DONE | 168-case board, M16 12-case board, two profile windows actually opened |
| VAL-04 | Extreme/odd seeds, tolerance/clearance, invalid inputs | PARTIAL | Limited guards; complete product-family validation matrix pending |
| VAL-05 | Regression coverage after current changes | PARTIAL, STATED SCOPE | This increment: Python 41 pass/3 optional skips, all three optional methods rerun in CAD runtime (eight CAD cases plus two saved-STEP tests); Node CLI 4/4 and typecheck pass. Prior full TS baseline 1204 pass/2 skips; full TS suite not rerun for this increment |
| UI-01 | Unified request/schema and GUI integration | TODO | Clearly distinguish Node, recovered Python and optional CAD/host backends |
| DOC-01 | Screenshots/HTML track honest acceptance | PARTIAL | Latest CAD/H8 review shows both complete M6 models, independent CAD and actual LSPP screenshots, K/INP/STEP/HM links, and original M8 runout rejection; broader cases pending |
| CLEAN-01 | Keep exports on F, runtimes on D, clean duplicates | ONGOING | Do not delete active LSPP models; logs/licences/large models excluded from Git |

## Next execution sequence

1. DONE: publish this TODO and reject the earlier grid-derived CAD acceptance.
2. DONE, BOUNDED: independent stock CAD via a pinned optional backend; eight
   cases pass the explicitly approved CAD-only 1e-7 exchange policy. Retain
   former 1e-8 rejection evidence as history, not as current failures.
3. PARTIAL: full-body external-hex bolt and square-ended through-nut matching
   plus actual native HM validated. Next: original faded runout topology and
   interior/near-thread count reduction; do not replace failed CAD cases silently.
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
- The original faded M8 nut still has a local runout face-distance failure;
  passing global volume and SJ does not accept it. The square-ended through-nut
  is a distinct requested design, not the original case repaired.
- The current M6 bolt fidelity model has 3.58 million H8 cells. It now passes
  full K/INP/CAD/native-HM audits, with a 900-second host processing budget.
  It is still overly dense for many production uses; count reduction is pending.
- The recovered cylindrical head has no internal socket and its dome nut has
  an open bore. New independent socket CAD does not fix the corresponding H8
  mesh automatically: new topology/partition planning is still required.
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
