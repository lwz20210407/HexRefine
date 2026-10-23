# Python to Node native mesh jobs

`tools/hexrefine_jobs.py` provides `NativeMeshJob` using only the Python standard
library. It calls the built TypeScript/Node concentric generator. It is **not** a
pure-Python mesher and does not require MATLAB, TrueGrid, PyDYNA or a web server.
Only the native concentric version-1 request is supported by this first job adapter.

```python
from hexrefine_jobs import NativeMeshJob

job = NativeMeshJob(repository_path, node_executable, native_request, new_job_directory)
status = job.snapshot()  # thread-safe; poll this from a GUI event loop
status = job.wait(timeout=0.1)  # running if not finished; no implicit cancellation
job.cancel()  # only this job's process; returns False after terminal state
status = job.wait()  # returns after process reaping and cleanup/publication
```

The caller supplies existing repository, Node executable and parent directory.
No shell concatenation, executable discovery/download, silent environment install or
project dependency synchronization occurs. Windows child windows are hidden.
Build with `npm run build` before use. Example synchronous CLI:

```text
python -B tools/hexrefine_jobs.py --repository REPOSITORY --node NODE_EXECUTABLE --request request.json --job-directory NEW_JOB_DIRECTORY
```

## Protocol and ownership

The constructor exclusively creates the job directory; existing directories/symlinks
are refused. Requests above64KiB, NaN and unsupported envelopes are rejected before
creation. Native validation handles the geometry and count/quality contracts.
`status.json` is atomically replaced, and `events.jsonl` records real native messages.
States are `running`, `succeeded`, `failed`, `cancelled`; output is null unless success.
Stages are prepare, audit-complete, node writing, element writing, readback and complete.
Counts refer to actual records in each stage, not estimated overall percentages.
The audit-complete count is the audited periodic motif, not a claim that every
repeated full-model cell was expanded and independently audited at that stage.
Synchronous topology preparation has a stage marker but no invented internal percent.
The Node CLI emits these NDJSON events to stderr only when
`HEXREFINE_PROGRESS_JSONL=1`; its normal single-result CLI contract stays intact.

Output is initially private `working/`. Success requires a zero child exit status,
positive terminal result, full native readback certificate and matching file size/hash
metadata, then publishes the directory as `result/`. Both status output paths point to
this final directory. K remains NODE+SOLID geometry only. This adapter trusts its
known native generator's hash certificate; independent K auditing is still separate.

Cancel terminates and reaps only the direct native process. There are no child shell
processes. Cancellation during audit/write/readback never publishes partial output.
After reaping, cleanup verifies the exact exclusively owned staging path, rejects
symlinks/unknown entries, and removes only the four known generated files there.
Unexpected contents are preserved with `cleanupWarning`; user-adjacent files and
all completed jobs are untouched. Request/status/events remain as small diagnostics.
The task is not a durable restartable scheduler: externally killed Python or a machine
crash can leave working data, which must not be treated as a finished model.

Browser progress/cancellation, general GUI61/old-K jobs and pure-Python topology remain
future work. Standard tests invoke six real-process Python cases through
`test/native-job-bridge.test.mjs`; set `HEXREFINE_PYTHON` to override its interpreter.
