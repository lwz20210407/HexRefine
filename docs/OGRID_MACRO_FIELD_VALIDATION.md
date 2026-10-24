# Whole original-mesh macro validation: 2026-10-23/24

Baseline198e7f3, initially clean `codex/h1-2to1-stage-c-overlay` worktree.
This checkpoint adds the public [macro-field installer](OGRID_NATIVE_MACRO_FIELD.md)
and [ID-preserving K CLI](OGRID_MACRO_FIELD_CLI.md). It does not mark arbitrary
CinoLib3D WB edge/vertex installation complete.

## Complete Real ROIs

Evidence: `F:/PythonWoking/temp/20261023-ogrid-native-macro-install/REVIEW.html`.
Sources are read-only mesh extracts from
`D:/AI_Tools/HexRefine_lsdyna/TC4_All_Specimens`:
`Cylindrical_Compression_noFrac` and `Smooth__Round-Bar_Tensile_noFrac`.
The saved legacy ROI lists use imported parent indices, not the original external
EIDs. Their requests now explicitly specify `targetIdSpace:"ordinal"`.

| Full output | H8 | Exact core parents / H8 | Transition parents / H8 | Retained coarse parents | Min cornerSJ |
|---|---:|---:|---:|---:|---:|
| TC4 compact comparison |200070|2970 /190080|270 /8370|1620|0.169402|
| TC4 layered32+7 |201960|2970 /190080|540 /10530|1350|0.236522|
| Quarter round-bar tension |109440|11520 /92160|192 /1344|15936|0.211051|

The complete TC4 centroid-selected band is Z[-0.27,0.27], with actual whole-parent
bounds[-0.275,0.275]. All135 section columns are included. Each core parent has
64 cells and125 quarter-grid nodes. The round-bar full reduced gauge is
X[-1.5,1.5], each parent has8 cells and27 half-grid nodes. These intervals use
the existing region files' cm convention; K itself does not encode units.
Independent centroid selection reproduces the complete target sets, not just their
counts. No small local box substitutes for either specimen's full attention region.

The recommended TC4 request explicitly authorizes270 additional transition parents.
They form complete32-cell inner parents followed by7-cell outer parents. The core
target set stays2970; no original parent is promoted to a uniform intermediate
core/support. The remaining1350 far-field parents retain their original external
EIDs, connectivity and nodes. This is not a claim that all1620 coarse parents of
the compact comparison remain coarse:270 are deliberately allocated to the wider
transition. Every ID is in the expansion report.

## Quality Tradeoffs, Not Threshold Relaxation

| TC4 metric | Compact31 | Layered32+7 |
|---|---:|---:|
| Min cornerSJ |0.169402|0.236522|
| Minimum transition/core edge |0.769731|1.000000|
| Maximum transition longest/shortest-edge ratio |8.13638|5.75329|
| Maximum adjacent normal-centroid size ratio |6.28521|3.41421|
| Maximum face nonorthogonality angle |70.3688 deg|61.1379 deg|

The layered case requires SJ>=0.15 and minimum transition/core edge>=1, including
after node merging. No threshold was reduced to pass it. Its cells increase1890
(approximately0.945%) over compact31. The centroid-size ratio still exceeds2 and
the nonorthogonality is not ideal. It is not an engineering acceptance certificate
or proof of superiority to every wider strong-support layout. Nominal2:1 tensor
refinement and the face-local centroid metric are different quantities.

The tension case has transition/core edge0.94519, maximum edge aspect5.26663,
normal-centroid ratio2.88115 and angle59.8742 deg. It is a complete-ROI topology/
conservation validation, not a case certified against the TC4 edge>=1 requirement.
Corner/Gauss samples do not prove global Jacobian positivity or nonlocal nonoverlap.

## Independent Checks On Complete K Files

`independent-audit.json` imports all three full Ks with PyDYNA and independently
recomputes all corners, eight Gauss determinants, element/parent/whole volumes,
face ownership, closed-boundary edge incidence and Euler2. All actual free faces
must associate with an original exterior parent face using its measured Q1 warp,
the disclosed normal correction and the unchanged K roundtrip precision bound.
This geometric classification is not relaxation of conformity or volume gates.

- All original node coordinates/IDs are exactly retained on readback. Untouched
  external EIDs and connectivity are exact; new children use fresh EIDs.
- Every full-ROI parent's node set and cell connectivity match the expected tensor
  grid, not merely8/64 total children. Maximum quarter-grid error is5.0e-14 cm.
- Largest independent per-parent relative error:2.09e-13 compact,6.35e-13 layered,
  2.49e-13 tension, all below the unchanged1e-8 limit. Whole-volume errors are at
  floating-point accumulation scale. No abnormal internal free/nonmanifold faces
  were found; boundary edges have two owners.
- `corner-group-audits.json` independently audits complete three-parent groups:
  compact93 children, layered96/21 children, tension21 children. Each covers every
  old parent, has a closed Euler2 quad boundary and the complete source-group volume.
  This is not the incomplete nine-cell TrueGrid harvest.
- A supported five-valent old O-grid with its complete support ring is exercised by
  the API test:160 old H8 ->4160,40 full-ROI parents each64 children, no promotions,
  strict trace closure and two complete five-parent160-cell inner groups. It is a
  synthetic old-mesh regression, not a user-specimen five-valence K certification.

The layered TC4 physical exterior audit compares72 old exterior faces across four
axial transition bands. Actual diagonal endpoint Z spread is7.75e-10 cm, versus
minimum retained diagonal Z step0.00517767 cm. Reference-horizontal edges perturbed
by the disclosed conservative mapping are classified using that recorded geometry/
readback bound, with more than100-fold separation from retained diagonal steps
(transverse classification separation1283). Trace counts/endpoints agree within
that bound. The periodic staircase is closed; no one-cell-high spiral step is hidden.
This is not a claim of a perfectly horizontal zero-zigzag line.

`replay-validation.json` confirms byte-identical full preferred K and lineage from
the native replay. Its duplicate mesh/lineage were removed after hashing, saving
35353920 bytes; the distinct primary mesh and small replay report remain. Request
files explicitly normalize ID space and relative source paths. A final CLI test
also replays the saved request from its new directory with noncontiguous source IDs.
Raw development reports are retained; saved requests explicitly normalize their
ID space and relative source paths for the final CLI.

## Deliberate Refusal And Remaining Work

The initial R1 requests omitted the two original symmetry planes. Their combined
shared-face/exterior-phase failure was incorrectly summarized as shared-face-only
incompatibility. Three encountered constraints are not a minimal unsatisfiable core,
and a failure-only exact shared-face witness now disproves that earlier diagnosis.

The corrected quarter R1 request declares X=0 and Z=0, confirmed by original SPC
sets9101/9103 (1318/1317 nodes), not guessed from an arbitrary flat exterior.
With both planes and two source-parent shell layers, the complete1680-parent
level2 ROI has a compatible strict field. Standard station search gives shell
SJ0.144137; explicit extended search improves it to0.174875 with p0.85/b0.6.
No phase constraint is removed from the physical exterior; symmetry exemptions
never remove shared-face conformity.

An independent full-K inspection candidate has136626 H8:107520 exact tensor-core
children,18018 transition children over924 original parents, and11088 unchanged
coarse parents. All original nodes/external far-field connections stay unchanged;
maximum per-parent readback volume error is5.05e-13, with zero unexpected internal
free faces and a closed Euler2 boundary. This is an inspection candidate, **not a
globally SJ>=0.15 accepted output**. The original core already has SJ0.04523785
(import parent72, external EID135); its exact tensor children retain that minimum.
The unchanged far field is0.514404. The production CLI still rejects the explicit
global0.15 request and creates no output. Neither changing the gate nor moving
protected source/core nodes has been silently substituted for acceptance.

Evidence and private candidate: `F:/PythonWoking/temp/20261024-r1-shared-face`.
The user subsequently confirmed preserving inherited source quality while requiring
new transitionSJ>=0.15. The explicit `minimumTransitionCornerScaledJacobian` contract
now checks every original core parent for nonregression and the transition floor
again after K readback. The formal scoped-accepted R1 K is136626 H8 with the same
geometry and retained source/far identities; independent maximum per-core-parent
SJ loss is1.45e-13 (fixed arithmetic allowance9.09e-13). All1680 parents, physical
outer traces, volumes and closed boundaries pass. This does not change or claim to
pass an explicit global0.15 gate. Full updated regression1134/1134, no skips.
Current evidence: `F:/PythonWoking/temp/20261024-r1-source-preserving-acceptance`.
See [R1 correction](R1_SHARED_FACE_CORRECTION.md) for the exact acceptance scope.

Remaining: genuinely general3D CinoLib edge/vertex WB installation, compatible
multi-front/colliding shells, broader non-axial/odd-valence boundary contracts,
material/solver-state migration, GUI controls and industrial-scale performance.
The new bounded face-field path is usable on existing K; these limits remain open.

## Regression And Visual Evidence

Full suite passed1103/1103 before the added complete five-valence case, then
1104/1104 with no skips. Fifteen targeted macro/API/CLI tests pass, including48
actual source frames. Final namespace/report/path/disk-publication guards also pass
the CLI test.
The standalone embedded runtime and public type contract are synchronized.

Nine actual LSPP images cover the original specimen, both complete TC4 Ks, complete
tension K and two diagnostic corner/context subsets. Symmetry cuts face the camera.
The subsets include complete original-parent groups and are explicitly display-only;
they do not replace full-model verification. Desktop/mobile HTML image/link checks
are retained beside the data. No old user benchmark or workspace-root entry is
changed. This task's dated directory intentionally retains distinct K/audit/replay
evidence, not large solver results or duplicate generated candidates.
