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

Latest bounded increment: an optional independent CAD adapter passed five real
design cases; two strict STEP round-trip cases are explicitly rejected.
This does not close the CAD-to-H8 or complete standards-library requirements.

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
| MESH-04 | CAD-driven automatic multi-block planning | TODO | Source/target/path, shared seed compatibility and terminating features |
| MESH-05 | Near-thread 2:1 / 3:1 count reduction | TODO | Preserve tooth focus, core and far-field; no substitute uniform over-refinement |
| MESH-06 | General corners, weak balance and multiple fronts | TODO | Existing broader mesh-project gaps are not resolved by profile mapping |
| CAD-01 | Independent unmeshed design geometry | PARTIAL | Design-only `standard_cad.py`: five cases pass without FE input; broader family cases remain |
| CAD-02 | Earlier FE-station ruled STEP | WITHDRAWN | Valid BRep, but grid-derived and not accepted design CAD; diagnostic flag only |
| CAD-03 | Earlier CAD-plus-mesh HM product acceptance | WITHDRAWN | Transfer mechanism worked; supplied geometry did not meet CAD-01 |
| CAD-04 | Real smooth helical geometry library backend | DONE, BOUNDED | bd_warehouse v0.3/build123d0.11.1, simple=False, all material solids fused; five accepted cases, two explicitly rejected |
| CAD-05 | Real driver recess and blind cap geometry | PARTIAL | Two real socket CAD cases accepted; M6 closed cap fails strict STEP round-trip. Matching H8 recess/cap topology is not implemented |
| CAD-06 | CAD/FE boundary matching | TODO | Do not pair new standard CAD with old incompatible mesh and call it matched |
| IO-01 | Mesh-only LS-DYNA K | DONE | Existing writer/read-back, distinct PIDs, NODE/SOLID |
| IO-02 | Abaqus INP with bodies/regions/surfaces | DONE, BOUNDED | Demo STEEL defaults are not material calibration; explicit material selection pending |
| IO-03 | Real native mesh-only HM | DONE | HyperMesh2022.3 save/clear/reopen; not renamed Tcl/CMF |
| IO-04 | STEP+mesh native HM transfer | PARTIAL | Infrastructure tested; requires accepted independent CAD for product delivery |
| IO-05 | No-motion CAD association | NOT VERIFIED | Tested host moved ~1e-7 despite no-snap; strict gate rejected, not loosened |
| STD-01 | Versioned GB/ISO/DIN/ASME catalogue | PARTIAL | Pinned CAD tables enumerable for selected ISO/DIN/ASME families; no certified edition/GB crosswalk; recovered 14-size table is not authoritative |
| STD-02 | Internal/external limits and tolerance classes | TODO | Nominal/limit models; radial clearance is not a 6g/6H model |
| STD-03 | Validate cross-standard mappings | TODO | Similar ISO/DIN data must not automatically be relabelled GB/EN |
| FAM-01 | Rod/stud, partial/full thread, hands/fine pitch | PARTIAL | Profile hand/phase tests done; complete family/request coverage pending |
| FAM-02 | Flange, socket, blind/cap, insert/slot families | TODO | Each needs appropriate CAD and H8 topology; not just added table rows |
| VAL-01 | Corner/Gauss/volume and boundary checks | PARTIAL | Existing case audits passed; not a proof for arbitrary imported CAD |
| VAL-02 | Independent CAD acceptance | PARTIAL | Seven opt-in real CAD regressions: five accepted, two rejected without publishing output; periodic flank/material/socket checks and STEP read-back |
| VAL-03 | LSPP inspection of generated catalogue | DONE | 168-case board, M16 12-case board, two profile windows actually opened |
| VAL-04 | Extreme/odd seeds, tolerance/clearance, invalid inputs | PARTIAL | Limited guards; complete product-family validation matrix pending |
| VAL-05 | Full project regression after current changes | DONE, STATED SCOPE | Typecheck + TS suite: 1204 pass/0 fail/2 optional bridge skips; bridge CLI rerun separately 3/3 pass. Python units 20/20; opt-in CAD test covers five accepted and two rejected cases |
| UI-01 | Unified request/schema and GUI integration | TODO | Clearly distinguish Node, recovered Python and optional CAD/host backends |
| DOC-01 | Screenshots/HTML track honest acceptance | PARTIAL | Old CAD page withdrawn; new CAD-first review includes five accepted snapshots and both rejection reasons; broader cases pending |
| CLEAN-01 | Keep exports on F, runtimes on D, clean duplicates | ONGOING | Do not delete active LSPP models; logs/licences/large models excluded from Git |

## Next execution sequence

1. DONE: publish this TODO and reject the earlier grid-derived CAD acceptance.
2. DONE, BOUNDED: independent stock CAD via a pinned optional backend; keep the
   two rejected mass round-trip cases open, not silently accepted.
3. NEXT: match H8 generation to accepted design geometry, beginning with the
   simplest full-thread external and open-nut topology. Check boundaries against
   CAD; do not associate a different pre-existing mesh and call it a match.
4. Replay full upstream mesh cases and implement remaining source-specific
   methods: femssc drill-tip/washer, sunwhale full meshes, TrueGrid Screw and
   Coreform open-kernel partition equivalents.
5. Verify dimensions, editions and limits for ISO/DIN/ASME and GB mappings.
   Upstream CSV availability alone does not certify a standards implementation.
6. Extend recess/cap/runout families, near-thread 2:1/3:1 count reduction and GUI.

## Current concrete blockers

- Independent M6 ISO4032 and DIN1587 STEP mass round-trip errors are about
  1.43e-8 and 1.10e-8 respectively, above the current 1e-8 gate. Both remain
  rejected; no threshold increase was used. The M8 open nut passes.
- The recovered cylindrical head has no internal socket and its dome nut has
  an open bore. New independent socket CAD does not fix the corresponding H8
  mesh automatically: new topology/partition planning is still required.
- Current profile-pair meshes and standard-library CAD are different designs.
  Their combination is not accepted as matched CAD+mesh HM.
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
