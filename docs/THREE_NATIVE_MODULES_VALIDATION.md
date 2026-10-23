# Three bounded native modules: 2026-10-23

Baseline:3f4a0db, clean `codex/h1-2to1-stage-c-overlay` worktree. This checkpoint adds
three user-facing workflows without changing the seven original GUI61 generators,
transition templates or acceptance thresholds:

| Module | Implementation | Verification / remaining boundary |
|---|---|---|
| Seed proposals | `planConcentricSeeds`, seed CLI | Nominal targets, upward-only seed changes, core patch/arc/period compatibility, pre-allocation count caps; no old-mesh preservation or global optimum claim |
| GUI width proposals | GUI helper APIs, workbench panel, worker and standalone | Explicit criteria/differences/apply/discard, stale drafts, failure and K/archive replay; no browser cancel button |
| Python native jobs | `tools/hexrefine_jobs.py`, opt-in Node progress | Real-process success/failure/cancel/reaping, exclusive directories, owned partial cleanup; concentric requests only, not a Python mesh kernel or crash-recoverable scheduler |

Contracts: [seeds](CONCENTRIC_SEED_PLANNER.md),
[GUI](GUI61_WIDTH_PLANNING.md), [Python jobs](PYTHON_NATIVE_JOBS.md).

## Actual complete mesh evidence

Evidence root: `F:/PythonWoking/temp/20261023-three-native-modules`.
No earlier successful model, script or user benchmark was modified. Scratch outputs
remain here intentionally for replay, including small failure/cancellation diagnostics.
No new workspace-root entry was created; all task outputs are under existing temp/.

R48/H16/Rcore16 quarter example starts with incompatible seed counts39/63/31.
Nominal targets0.4/0.4/0.5 produce explicit40/64/32 counts. Four fixed ring inner
radii16.5/18.5/22.5/30.5 are retained. Explicit width criteria are SJ>=0.25,
transition longest/shortest-edge ratio<=6, and transition/regular shortest-edge
ratios to the core minimum>=1. The planner changes only outer ring radii to
17.75/21/27.5/42.5 and tightens the minimumSJ generation gate.

| Complete K | Nodes | H8 | Core H8 | Min cornerSJ | Relative discrete-volume error |
|---|---:|---:|---:|---:|---:|
| `width-job/result/mesh.k` | 59985 | 56640 | 49152 |0.304802127724|6.66e-16|
| `half-job/result/mesh.k` |17015|15488|11264|0.214613954518|8.88e-15|
| `full-job/result/mesh.k` |33185|30976|22528|0.214613954518|1.69e-14|

All three were generated through the Python-to-Node adapter, fully imported with
PyDYNA and independently recomputed with NumPy: references/unique nondegenerate
connectivity, cornerSJ, eight Gauss determinants and volume, complete shared-face
incidence, nonmanifold faces and unexpected internal free faces. No unexpected
internal free faces/nonmanifold faces were found. Independent topology checking is
not merely the native motif audit.

The quarter model has transition/core minimum-edge ratio1.345631 and maximum
transition edge aspect approximately4. Its49152 core cells match the previously
accepted four-ring K exactly in coordinates and connectivity. The seed advisor
is not credited with that frozen-core guarantee: it explicitly changes seeds;
the following width-planning stage preserves the resolved core. All cases use
NODE+SOLID PID1 only, not a solver-complete model. Analytic circular faceting error
is reported separately; geometric validity is not impact-solver certification.

Four actual LS-PrePost images are `four-iso.png`, `four-top.png`, `half-iso.png`,
`full-iso.png`; the quarter ISO exposes both symmetry cuts. A native cfile loaded
each complete K; these are not synthetic drawing substitutes.

## Browser / process evidence

`browser-results.json` records5 actual HTTP worker calls and no page script errors.
Standalone and390x844 mobile runs have no workers, nonblank canvases and no horizontal
overflow. All three modes download identical full56640-cell K bytes; replaying the
downloaded parameter archive also reproduces identical bytes. Those GUI nodes and
connectivity match the independent native K exactly. Report snapshots, rejection,
discard, explicit apply and old-output invalidation were exercised.

`jobs-evidence.json` records three complete generations, one invalid axial-count
failure, and cancellation at the start of writing3.18M nodes for a real3.10M-cell
request. No cancelled result is published and no large partial remains. Six Python
unit cases additionally verify adjacent sentinel preservation, terminal-state
idempotency, initial cancellation, progress endpoints and existing-file/directory
refusal. A final metadata fix ensures both returned output paths refer to published
`result/`, not native staging; the raw native events correctly retain their original
staging destination as execution history.

First full regression:1089/1089,0 skipped, including16 added top-level tests and6
real Python subprocess cases nested in the bridge test. The final repeat is recorded
in `full-tests-final.log` and also passes1089/1089. Final progress metadata uses the
audited motif count (not repeated full-cell count) and refuses symlink publication
targets;9 targeted native CLI/job tests pass after that correction. The6 Python
cases are also rerun independently in `python-final-tests.log`.
No quality threshold was relaxed. README/TODO updates distinguish completed bounded
features from mixed ratios, nonperiodic ends, general O-grid/weak-balance installation,
full solver-deck migration and broader GUI61 parameter combinations still open.

`REVIEW.html` links the actual K files, parameters, audits, progress/failure logs and
desktop/mobile screenshots. The browser test HTTP helper is stopped after verification;
the committed standalone HTML remains usable directly from the filesystem.
Three byte-identical GUI download copies from this task were removed after hashing;
`duplicate-downloads.json` retains their sizes/hashes and the retained `gui-http.k`.
This saves24021060 bytes without deleting a distinct native model or earlier task data.
