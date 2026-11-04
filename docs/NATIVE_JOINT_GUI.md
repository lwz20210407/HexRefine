# Native joint browser integration

Date: 2026-11-04. Status: bounded source-tree GUI flow verified, not a desktop
release and not completion of the fastener TODO.

## Launch

Build `dist/` using the repository's existing TypeScript build. Use a Python
environment with NumPy and meshio and an explicit Node executable:

```powershell
python -B -m tools.hexrefine_joint_server --output-root EXISTING_OUTPUT_DIRECTORY --node NODE_EXECUTABLE --port 8797
```

Run from the repository. The output root must already exist, preferably the
task's dated F: scratch directory. The host binds only `127.0.0.1`. Open
`http://127.0.0.1:8797/`, then select the existing workbench's `装配参数` button.
The same generated mesh is installed into its existing renderer; no proprietary
application or private restored module is used at runtime.

This is a Python-hosted source-tree workbench, not deployment into the existing
Electron package. A static host without the capability flag leaves the button
disabled and makes no native API request. The upstream GitHub Pages workbench
does not serve this backend. This host does not implement the separate general
offline-export API of the existing Node/desktop hosts.

## Supported flow and semantics

- Parameter entry for coaxial hex-head bolt, open hex nut and rectangular
  plate stacks; right/left thread field, seed controls and explicit H8 budget.
- Effective compensated axial seeds, unchanged dimensions and head/plate gap
  are shown, not concealed behind requested input counts.
- Generate and audit asynchronously; progress is indeterminate, not an invented
  percentage. Closing the modal does not cancel the job. Cancel is explicit,
  including a click made before the POST response supplies a job ID.
- Preview verifies the generated K SHA-256 and node/H8 counts against the report
  before installing a read-only snapshot. Native PIDs remain in the model.
- Download `model.k`, `merged.inp`, `parts.inp` and `report.json` only after
  successful publication. Editing input invalidates old download links.
- `部件连接` selects shared bonded nodes or separate disjoint node IDs for K
  and assembly INP. The report shows actual ownership intersections. The
  `parts.inp` download always has separate Part/Instance records. No file
  defines contact, coupling, preload or material behavior.
- A successful job can be reopened from `任务记录` after page refresh or host
  restart without regenerating it. Original parameters, including API fields
  not exposed as controls, survive reopening/resubmission; reset clears them.
- Invalid dimensions, budget overflow and quality failure are reported as
  failures, never published as accepted output. Analytical geometry is labelled
  explicitly: this is not independent STEP/BRep matching or standard certification.

The backend's limits in [NATIVE_JOINT_BACKEND.md](NATIVE_JOINT_BACKEND.md) still
apply. No new 2:1/3:1 count transition, CAD family or tolerance implementation is
provided by this GUI adapter.

## Host limits

Loopback Host/same-origin checks; JSON requests at most 64 KiB; GUI budget at
most 200,000 H8; one active joint at a time; 32 jobs per server session; minimum
256 MiB free output disk; default child timeout 300 seconds. Output uses fresh
UUID directories under the explicit output root. A job executes only the fixed
repository module using the server's Python and the configured Node path.
Cancellation targets that child process tree, not unrelated applications.

Completed artifacts persist on disk and are not auto-deleted. Atomic `job.json`
records recover completed jobs after restart only if all four artifact hashes
still match. Each download checks its file hash again. An OS-held directory
lease rejects a second host using the same output root. Running records become
`interrupted` on restart, with no downloads and no automatic regeneration.
Recovery never adopts/kills a process from a stored PID. A hard-killed host may
leave a child requiring manual inspection; the interrupted record is never
promoted merely because that child's files later appear. Batch queues,
interrupted-job continuation and retention policies remain TODO.
Do not delete active artifact directories while clients use their links.
CAD/HyperMesh/solver tasks are not dispatched by this service.

## Repeatable verification

```powershell
$env:HEXREFINE_JOINT_HTTP='1'
$env:HEXREFINE_NODE='NODE_EXECUTABLE'
$env:BOLTHEX_TEST_ROOT='EXISTING_TASK_DIRECTORY'
python -B -m unittest tools.tests.test_joint_http -v
python -B -m tools.verify_joint_workbench --url http://127.0.0.1:8797/examples/browser/refinement-gui.html --output NEW_QA_DIRECTORY --browser EXISTING_CHROMIUM_EXECUTABLE
python -B -m tools.verify_joint_history --url http://127.0.0.1:8797/examples/browser/refinement-gui.html --output NEW_HISTORY_QA_DIRECTORY --browser EXISTING_CHROMIUM_EXECUTABLE --job COMPLETED_JOB_ID
```

The browser verifier requires existing Playwright, Pillow and NumPy. It uses an
isolated browser because the Browser plugin is unavailable in this environment;
it saves screenshots and downloads under the explicit new QA directory.

Actual GUI case: axial dimensions 16.1/13.1/8.2 mm, 56,704 nodes, 53,592 H8,
minimum corner SJ 0.409479482, positive Gauss determinants, four component PIDs.
Checks include output hashes, actual model pixels/counts, failure without stale
downloads, cancellation with a 1,500-ms delayed POST response, 390px modal width,
backend-unavailable behavior and absence of console/page errors. This does not
constitute an Abaqus/LS-DYNA solve or independent CAD acceptance.

Local evidence: `F:/PythonWoking/temp/20261104-native-joint-gui/acceptance-v2`,
plus the independently checked generated job under `jobs/`. The HTML review
remains local because its model and screenshot links refer to task artifacts.

Regression in this increment:117 Python tests,106 passed/11 optional skips,
with the real HTTP-generation tests enabled;22 targeted GUI61/import/archive
Node tests passed; source and public type-fixture TypeScript checks passed.
PyDYNA re-read the GUI K with relative volume error 1.46e-15; meshio re-read the
merged INP at 5.56e-15, retaining all four component sets. Four separate INP
part blocks had already been read back before publication. Full TS and slow
eight-CAD suites were not rerun in this increment.

## Modes and recovery increment

The same preserved-dimension case now has 56,704 nodes in shared mode and
61,120 in separate mode, both 53,592 H8/minSJ0.409479482. Independent PyDYNA
and meshio re-read both modes and reproduced node ownership: five sharing
pairs in shared mode, zero in separate mode. Geometry, element ordering and
volume remain unchanged. The INP reader also checked all four separate parts.

The actual host was restarted against the same output directory. GUI reopened
the separate result twice, with zero generation POSTs, zero console/page errors
and no 390px modal overflow. API/GUI history is limited to this native backend;
old folders without owned `job.json` records are not silently imported.

Regression:128 Python tests,117 passed/11 optional skips, with native HTTP and
recovery enabled;22 targeted Node tests passed; source/public type checks pass.
Failure tests cover corrupted artifacts on restart/download, stale running
records, duplicate host ownership, spawn failure, initial/terminal persistence
failure and bounded Windows atomic-replace retries. Local evidence:
`F:/PythonWoking/temp/20261104-joint-modes-recovery`. This remains a bounded
assembly/GUI feature, not completion of CAD/families/standards/3D grading.
