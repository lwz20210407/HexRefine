# GUI61 Port: Verified Scope and Remaining Work

Latest existing-mesh checkpoint:2026-10-24. A public compiled macro-field API/CLI
now installs complete axial face-transition/corner fields into original H8 meshes,
including bounded32+7 layered fields without uniform parent promotion. Full TC4
and round-bar ROIs, external K identity preservation and exact core/far-field checks
are verified. This is not a new GUI61 menu or general3D CinoLib WB completion.
See [the exact scope and evidence](OGRID_MACRO_FIELD_VALIDATION.md).

Latest workflow checkpoint:2026-10-23. Three bounded additions provide upward-only
nominal-size seed proposals, an explicit GUI width-proposal/apply workflow, and a
standard-library Python job adapter to the built Node concentric kernel with real
progress/cancellation. These are not a pure-Python mesher, universal imported-mesh
installation or complete GUI61 job coverage. Full-scope limitations remain below.
See [the three-module validation](THREE_NATIVE_MODULES_VALIDATION.md).

Latest planning checkpoint:2026-10-23. Opt-in bounded concentric ring-width
planning now freezes the core, inner interfaces, geometry, seeds and count
budgets while selecting outer ring radii against explicit SJ/edge constraints.
Ordinary annuli receive an edge floor too, preventing thin leftover strips.
Final1073/1073 regression and four independently audited selected full K cases
pass. The accepted R48 four-ring reference improves0.293169→0.304802 minimum
SJ with49152 unchanged core cells. This is an API/CLI module; its resolved
requests import into the existing GUI, but a GUI auto-planning button, seed
optimization and global optimality are NOT implemented. See
[CONCENTRIC_WIDTH_PLANNER.md](CONCENTRIC_WIDTH_PLANNER.md).

Latest GUI checkpoint:2026-10-23. The explicitly labelled native concentric2:1
mode now joins the original seven parameter menus: structured ring editing,
cheap full-model planning, bounded complete preview/K export, archive replay,
offline execution and exact streaming CLI parameter handoff. The browser cap
is200,000 complete H8s; larger models are refused without rescaling/truncation.
Final1034/1034 regression, actual HTTP/offline/mobile interactions and four
independent downloaded-K audits pass; see
[GUI61_CONCENTRIC_WORKBENCH.md](GUI61_CONCENTRIC_WORKBENCH.md).

Newest checkpoint: 2026-10-23, coupled concentric generator. Native parameterized
2:1 bands now coarsen angular and axial counts together around a fixed circular
core, with periodic streaming mesh-only K export. One through four rings and
quarter/half/full cases are covered; the complete R200/H600 case has 3,310,500
H8s, 2,688,000 preserved fine-core cells and independently recomputed minimum
SJ 0.317993. Final regression: **1025/1025**, no skips. Five real K audits,
ten actual LS-PrePost views and desktop/mobile HTML accompany this checkpoint.
See [CONCENTRIC_CIRCULAR_GENERATOR.md](CONCENTRIC_CIRCULAR_GENERATOR.md).
Automatic band-width/seed optimization, nonperiodic ends and3:1/mixed
ring ratios remain separate. This does not complete arbitrary imported O-grid
or weak-balance installation, solver-state migration or all GUI61 options.

Latest additive checkpoint: 2026-10-23. The native structured circular-core
module now exposes quarter/half/full mapped sections, independent compatible
boundary counts, bounded uniform H8 extrusion and a versioned JSON CLI with
K/INP readback. Four independent PyDYNA case checks and actual LS-PrePost views
are complete; the final integrated suite passes **986/986**, without skips.
The legacy circular Q1 generator retains its three fraction geometry hashes.
See [MAPPED_CIRCULAR_CORE.md](MAPPED_CIRCULAR_CORE.md). This addition does not
complete the parameterized concentric-ring generator, its GUI, generic
weak-balance installation or industrial-scale streaming. The older checkpoint
and its historical test counts below are retained for traceability.

Checkpoint: 2026-10-18. This reports actual native implementations and measured
oracle coverage, not a claim of complete GUI_tg 6.1 equivalence. Native runtime
is TypeScript/Node. Python can call the versioned CLI; a pure-Python kernel has
NOT been implemented. All seven menu families now connect their implemented
subsets to the existing browser workbench; see GUI61_WORKBENCH.md. This is not
a claim that every original parameter combination has passed.

## Feature Matrix

| Feature | Recovered GUI source | Native status | Evidence / remaining scope |
| --- | --- | --- | --- |
| F01 independent axes | GUI_tg.m 252/277/302, 978+ | Implemented for rectangular generation | 36 single-band ratio/thickness/fraction cases; not general imported-Hex anisotropy |
| F02 double bands | 894, 1076/1129+, Creat_A/B/C/D | Implemented for rectangles | 16 cases, 0.618 allocation and count alignment; exactly two transitions |
| F03 tilt | 984+, 994, 1200+ | Rectangular single/double and circular half/full implemented | Positive/negative TG probes; circular uses documented alternate mapping; quarter nonzero tilt pending |
| F04 fractions | Each generator's vi branch | Explicit coverage for ported generators | Corrected circular quarter and cylinder full; no automatic solver BC |
| F05 curved solids | Code_Creat2/3, 2482+, 3249+ | Circular/cylindrical subsets plus circular correction/budget and GUI implemented | Cylinder radial switch/layers; circular quarter tilt and extreme-angle quality pending |
| F06 reinforcement | Code_Creat4/5, 3577+, 3951+ | Uniform budgets, graded fractions/tilt/two-stage, matched shared endpoints and GUI | Broader combinations pending; unmatched shared endpoints rejected; embedded coupling deferred |
| F07 2D | Code_Creat7/6, 2199+, 2386+ | Implemented under source-specific contracts | 12 rectangle and 3 circle TG cases; Q1/SHELL export, geometric sets |
| F08 interfaces | repair chain, v15/v16/vv15/vv16 | Direct conformity for ported generators; baseline replay verified | General imported-K repair is NOT implemented |

Implementation guides: [rectangle](GUI61_NATIVE_RECTANGLE.md),
[circular solid](GUI61_NATIVE_CIRCLE.md), [Q1](GUI61_NATIVE_QUAD.md),
[cylinder](GUI61_NATIVE_CYLINDER.md).

See the [control-by-control coverage ledger](GUI61_CONTROL_COVERAGE.md) before
calling any branch complete. Same-geometry rectangular zero-angle coverage is
now 72 combinations; the hollow-cylinder switch/fraction/physical-layer grid
has 12. These do not certify every angle or every other GUI branch.
The complete remaining checklist is [GUI61_PORT_TODO.md](GUI61_PORT_TODO.md).

## Bugs and Differences Are Not Copied Blindly

| Finding | Decision and regression protection |
| --- | --- |
| Rectangular thickness-off depends on previous GUI state | Resolve effective Z=1 before count alignment; deterministic calls; disclose differences |
| Original rectangular outer counts can be fractional | Reject incompatible inputs, no silent geometry change |
| Circular solid vi=1 duplicates vi=2 half-disk | Native quarter is a literal quarter disk; report the difference |
| Cylinder vi=3 emits half circumference | Native full is full circumference and full axial length; corrected TG copy confirms omitted reflection |
| TG transition-created curved boundary nodes can miss exact radius | Native analytic mapping, then re-audit geometry/volume/quality; do not simply enlarge merge tolerance |
| TG coarse/fine interface partitions can disagree | Direct conforming native topology; separately verified raw/fixed reference baselines |
| Source 2D circle has NODE constraint flags | Mesh-only output omits solver constraints explicitly and returns geometry sets |
| Uniform RC assigns X counts to Y beams and Y counts to X beams | Confirmed on a nonsquare oracle; corrected TG copy and native uniform kernel fix counts and lengths |
| Rectangular correction checkbox has unreachable b8=0 guard | Explicit native angleCorrection added; reduces either angle sign toward zero and reports the actual angle; not a quality optimizer |

Original recovered files remain read-only evidence. Corrections to oracle code
or TG decks are made in isolated copies and recorded separately from raw replay.
Recovered source archives are not included in this repository.

## Verification and Honest Limits

- Latest integrated full run: **755/755 passing** after strict graded shared
  endpoints and uniform quantity optimization, including type checks and build.
- Graded-reinforcement addition: initial full run **701/702 passing**, with only
  the stale embedded standalone bundle failing. After regeneration all seven
  browser smoke tests pass. Ten new graded tests and nine independent MATLAB/TG
  comparisons pass. The later 726/726 run includes these fixes.
- Cylinder addition: **9/9 focused tests passing**, plus CLI output coverage.
- TrueGrid batch invocation is established (`i=... g=nogui s=...`), with
  dedicated output/session paths. Process success is separate from mesh validity.
- Rectangular raw/repaired baseline replay is byte-identical to the supplied
  user files. Native alternatives need not use the same topology or numbering.
- Independent audits use NumPy topology/Gauss checks and PyDYNA K read-back,
  not only the native generator's own reported quality.
- Some double-band meshes have minimum corner SJ around 0.147-0.165 and emit
  warnings below 0.2. Positive Jacobians are not a universal engineering-quality
  guarantee. Quality optimization and user-specific acceptance remain open.
- Curved native/reference coordinates can differ materially. Analytic surface
  error, discrete volume closure and analytic volume approximation are different
  metrics and remain separately reported.
- Allocation guards are not performance certification. Large realistic meshes,
  extreme aspect ratios and a wider parameter matrix still need coverage.
- Existing session refinement/GUI operations have not gained all generator
  controls merely because the standalone native CLI supports them.
- The raw mixed reinforced decks open/render in LS-PrePost 4.10.1, but section
  projection currently crashes that viewer with exit code 0xC0000005. These
  four combined section checks are NOT passed. Beam-only display and
  concrete-only sections (beam PID hidden) have passed for all four cases;
  this is an inspection workaround, not a fix for combined projection.

## Next Work

The initial uniform-RC oracle is now recorded in `rebar_oracle`. For a 20x12x8
body with unit mesh size, the original expected 420 beams but generated 444
(Y segments of length 0.6, X segments of length 1.666667). Correcting directional
counts in a TG copy produced 420 beams, all unit length. Hiding Z bars actually
removes them: expected 324, original 348, corrected 324. The original/corrected
outputs both have distinct beam and solid node IDs, PID 2 and 3, no coupling
cards, and collinear/repeated beam N3 data. The applicable beam formulation,
orientation needs depend on the solver formulation. The native uniform subset
now requires an explicit separate/shared-node choice, uses noncollinear N3
nodes and does not generate physical solver cards or unconditional node merges.
See [the uniform RC contract](GUI61_NATIVE_REINFORCED.md).

1. Extend [graded reinforcement](GUI61_NATIVE_REINFORCED_GRADED.md): broader
   original combined inputs. Coupling extensions are deferred. Fractions, half/full +/-10
   tilt, asymmetric row clipping and three double-stage extensions now have
   an additional 14-case matrix, beyond the nine initial source comparisons.
2. Uniform reinforcement broader input coverage. Quantity
   optimization now has bounded native search, dimension-change guards and
   original/resolved-size source probes. Mixed NODE/SOLID/BEAM output is implemented; never use the original solid-only
   repair writer as a faithful mixed-deck exporter.
3. Circular quarter-tilt semantics and extreme-angle quality, followed by broader
   curved tests. Automatic angle correction and bounded count-budget search
   now have native implementations and source probes. Half/full tilt has 16
   original MATLAB/TG comparisons and region-specific quality records; low SJ
   in the measured transition band is accepted with a retained warning.
4. Supported imported-interface repair patterns, documentation,
   engineering-scale cases and review before publication.

Local evidence is retained at
`F:/PythonWoking/temp/20261011-hexrefine-gui61-validation` for reproducibility.
The earlier committed/pushed baseline is 5486d9e. The validated GUI61 batch is
recorded in scoped local checkpoint commits. Remote publication is tracked
separately and is not implied by a local commit or this feature matrix.

## Browser Workbench Checkpoint

This section records the 2026-10-11 checkpoint; development resumed on
2026-10-18 at the user's request. The first bounded native interface repair
is now implemented; see [its contract](GUI61_INTERFACE_REPAIR.md). It repairs
the four-parent rectangular benchmark with all original nodes unchanged and
all 4340 output hex node sets matching the MATLAB repaired reference. Other
repair families, full-deck migration and automatic selection remain open.
The four-Hex half-height corner family now also has nine MATLAB runtime
comparisons, and the bounded JSON repair workflow is connected to the GUI.
The new full-suite checkpoint is 784/784; after the final camera-fit correction,
28/28 targeted repair/browser tests and repeated browser runs passed. The user
requested a pause after this batch; further features await a new instruction.

The GUI batch full suite passed 764/764 before the final beam-import guard.
Targeted tests passed 17/17 after the final guard (including its new regression).
An actual beam-bearing K import was refused with the existing mesh unchanged.
Seven real browser generation/download paths and eleven combination attempts
(nine successful, two deliberately rejected) are recorded, along with mobile
layout and offline standalone generation. Ordinary solid-only import refuses
beam decks; mixed snapshots retain BEAM output and cannot silently enter the
solid-only refinement engine. Local evidence is in gui61_workbench and
GUI61_INTERACTIVE_WORKBENCH.html under the validation directory.

At the 2026-10-11 checkpoint, the original four-parent repair benchmark had a scratch native-template probe,
not a shipped repair API or a general repair certification. The 2026-10-18
bounded API and JSON CLI supersede that probe-only status, not the remaining
repair limitations. Remaining repair
patterns and circular limitations stay open. Per user instruction, stop after
this checkpoint and the requested push to the user's fork development branch,
then wait for further instructions. Do not merge the main branch automatically.
