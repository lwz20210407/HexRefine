# Interrupted Native Joint: Fresh Regeneration

This bounded feature creates a new job from an interrupted job's saved request.
It is **not checkpoint continuation**, partial-mesh reuse, or process adoption.
Generation success means the existing publication/data checks completed; it is
not independent CAD, engineering quality, solver, contact or preload acceptance.
R11, scikit-fem and physical-analysis validation are not dependencies or
prerequisites for retry or mesh publication. Such analysis remains optional
and separate from parameter, geometry/mesh and IO checks.

## API

`POST /api/native-joint/jobs/{interruptedId}/retry` with Content-Type
`application/json` and body `{}` returns HTTP202 with a **fresh UUID**,
`parentJobId`, `parentRequestSHA256` and `retryMode: "fresh-regeneration"`.
No parameter overrides are accepted. The new request file is byte-identical to
the parent's validated request, including parameters not exposed in the form.

The capability flag is `retryInterruptedAvailable`. Inventory includes all job
states, per-job `retryAvailable`, a bounded request error where relevant, and
parent linkage. Only interrupted jobs can be regenerated. Other states return
409, unknown IDs404, request overrides/invalid saved input400. Existing
same-origin, request-size, preflight/budget, disk, session-count and one-active
job limits apply again. A retry does not overwrite an existing UUID directory.

New jobs persist their request digest. On restoration, an interrupted request
is validated and pinned in memory; digest-bearing records must match it. A
legacy record without a digest can only establish the current validated
recovery snapshot, not retrospective proof of its pre-crash contents. The
snapshot must still match immediately before retry. New child linkage and
digests persist across restart.

The retry action does not modify any file in the source job folder, including
request, record, logs and partial outputs. Ordinary server recovery still
performs the existing running-to-interrupted record transition once. Already
interrupted records are not rewritten merely by loading history. Stored PIDs
are neither adopted nor killed, and late artifacts in an interrupted directory
are not promoted. Cancellation only targets the new process owned by this host.

## Workbench

History lists generated, interrupted, failed, cancelled and running jobs.
`重新生成` is enabled only for a valid interrupted request on a capable host;
`打开结果` is enabled only for published results. Regeneration uses the saved
request, not any unrelated current form edits. Success installs the new model,
restores its full parameters, and displays its parent linkage.

Changing history/input, retry errors and cancellation clear stale download
links. Cancel before the POST response is remembered and sent once the new ID
arrives. If cancellation arrives after completion, the UI says so rather than
claiming the backend cancelled a completed result. A cancelled/failed retry
does not alter or consume the source interrupted record.

## Bounded Reproduction

Use the existing CAD Python, Node, compiled `dist/`, and Chromium installation.
Do not share an output root with another host. All outputs below belong in an
explicit dated scratch directory, not the repository.

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
$env:HEXREFINE_JOINT_HTTP='1'
$env:HEXREFINE_NODE='E:\Program Files\nodejs\node.exe'
$env:BOLTHEX_TEST_ROOT='EXISTING_DATED_SCRATCH'
& D:\AI_Tools\conda-envs\text-to-cad\Scripts\python.exe -B -m unittest tools.tests.test_joint_retry tools.tests.test_joint_http tools.tests.test_joint_recovery tools.tests.test_joint_session_store -v
```

Build with the existing `node_modules/typescript/bin/tsc -p tsconfig.build.json`.
Then, from the repo, prepare a new empty owned jobs root before starting its
host:

```powershell
python -B -m tools.verify_joint_retry prepare --jobs-root NEW_EMPTY_JOBS_ROOT
python -B -m tools.hexrefine_joint_server --output-root NEW_EMPTY_JOBS_ROOT --node NODE_EXECUTABLE --port UNUSED_PORT
python -B -m tools.verify_joint_retry verify --url http://127.0.0.1:UNUSED_PORT/examples/browser/refinement-gui.html --output NEW_QA_DIRECTORY --jobs-root NEW_EMPTY_JOBS_ROOT --job SOURCE_UUID --browser EXISTING_CHROMIUM --server-pid OWNED_SERVER_PID
```

The explicit fixture is a saved running record with no live old process. It
exercises real recovery-to-interrupted and a real new10440-H8 generation, not
a claimed crash/half-mesh resume experiment. The verifier downloads actual
K/INP, compares connectivity/coordinates, checks source-folder hashes and
timestamps, lineage, reload without regeneration, cancellation before response,
mobile layout and rendered model pixels. Its browser-only409 error injection
is labelled separately from real HTTP rejection tests. An isolated headless
browser is used; user CAD/LSPP windows are not touched. Local HTML/screenshots
and all artifacts remain under the chosen scratch output.

## Observed Verification, 2026-11-06

- HTTP/retry/recovery/session-store selection:25tests,0skips, all passed.
- Existing TypeScript source, public type fixtures and build passed.
- Real browser retry:12426nodes/10440H8/4PIDs; K/merged-INP connectivity exact,
  maximum coordinate serialization difference5.009326287108706e-13mm.
- Parent request bytes, source-folder file hashes and modification timestamps
  remained unchanged; a new UUID and persisted parent linkage were observed.
- Actual cancel issued before the retry POST response ended as `cancelled`.
  A separate simulated409 browser error verifies link clearing; real HTTP409
  concurrency and other rejection paths are covered by API tests.
- Page refresh reopens the new published result without regeneration.
  Desktop1440x1000 and mobile390x844 checks passed, including an unobscured
  mobile retry button and25930actual rendered model pixels.
- The optional overall/per-PID quality diagnostics added concurrently are
  retained in report JSON. K and both INP hashes stayed identical; no closed
  report-key assumption or physical-solver dependency was introduced.

Local evidence (not distributed models):
`F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm/joint-retry/`.
`http-tests-final.log` records the25-test run. The final browser evidence is
`final-run/browser-qa-diagnostics/REVIEW.html` with `retry-qa.json`, screenshots
and actual downloads. These are bounded GUI/mesh/IO checks, not a half-mesh
checkpoint continuation or engineering/physics certification.
