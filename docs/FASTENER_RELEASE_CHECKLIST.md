# Bounded Fastener Release Acceptance

This is a source-tree checkpoint, not full-feature release certification.
FASTENER_DEVELOPMENT_TODO.md currently identifies eight pending workstreams.
An intact M6 report does not repair the original Screw or certify contact,
preload, manufacturing tolerances, arbitrary CAD, or every exposed GUI option.

## Mesh-First Acceptance

Mesh development and mesh delivery do **not** require an FE solver. P0 quality
means geometry, H8 conformance, Jacobians, volume and IO. The policy
`mesh-first-2026-11-06-v1` separates three reported tracks:

- `source_tree_smoke_integrity`: bounded runtime/test/integrity checks only.
- `mesh_delivery`: required checks plus CAD/HM/GUI/Screw evidence and the
  remaining core workstreams. This determines the top-level status/exit code.
- `supplemental_solver`: OPTIONAL R11, independent-engine and contact/preload
  evidence. Its states are visible but do not gate mesh-only acceptance.

Missing optional evidence stays `not_run`, never becomes `pass`. Artifacts
referenced exclusively by optional oracles belong to the supplemental track;
shared or unclassified artifacts remain required. Even optional failures stay
visible without turning this mesh checkpoint into a solver-release gate.
Required failures still fail, and the eight current core pending workstreams
still make mesh delivery partial. The P0 labels describe required quality scope,
not a claim that these bounded smoke tests independently rechecked all gates.

ANSYS 2022 R2 and LS-Run are available for future optional checks per the user.
R11 licensing is not a mesh-release blocker. No solver runtime or solver Python
package is a product dependency; scikit-fem's 53592-H8 linear patch is supplemental
evidence only. `full_feature_release` remains false.

## Contract (schema_version 1)

`tools/verify_fastener_release.py` validates JSON without extra dependencies.
Unknown keys, duplicate JSON keys, arbitrary commands and external oracle
`pass` declarations are rejected. Required fields:

| Field | Contract |
| --- | --- |
| schema_version | Integer 1 |
| scope | `source-tree-bounded` |
| environment | Exact `python` and `node` version stdout strings |
| artifacts | 1-32 objects: `path`, lowercase `sha256`, `bytes`, `counts` |
| artifact_count | Exact number of declared artifacts |
| commands | Unique fixed IDs: `python_dimensions`, `node_threaded` |
| oracles | Exactly `cad`, `hm`, `gui`, `r11`, `independent_engine`, `contact_preload`, `screw` |
| pending_workstreams | Explicit list of remaining scoped work |

Each oracle has `status`, nonempty `reason`, and `evidence` (declared artifact
paths). `partial` requires hash-bound evidence. Historical external evidence
is deliberately partial even when that historical report records a pass.
No external executable, argv, environment override or shell is accepted from
the manifest. Runtime paths are explicit trusted CLI arguments.

Artifact paths are relative to the explicit read-only evidence root. Absolute
paths, traversal and symlink escapes are rejected. `counts` maps JSON pointers
to exact nonnegative integer fields, e.g. `{ "/H8": 333824 }`. These are report
counts, NOT independent recounts of H8 in a binary/mesh. Unlisted transitive
references are not verified. A 16 MiB per-artifact limit excludes large cases;
JSON is capped at 2 MiB. Missing evidence is `not_run`; changed hash/size/count
is `fail`. File integrity `pass` never means an engineering oracle passed.
Repeated separators, dot components and case-insensitive aliases are duplicate
manifest identities. With an evidence root, resolved aliases and existing
hardlinks are also rejected before creating output. Resolution is restricted
to declared paths under that root, never the caller's working directory.
Windows-ambiguous trailing dots/spaces, reserved device names and invalid
filename characters are rejected on every platform before file inspection.
In-root link aliases cannot inflate the artifact count; resolved out-of-root
targets are rejected before inspecting their files.

## Running

Create an explicit output root outside the repository. Each run name must be
fresh; the harness never overwrites or deletes an existing run directory.

```powershell
& 'D:\AI_Tools\conda-envs\text-to-cad\Scripts\python.exe' -B tools/verify_fastener_release.py `
  --manifest MANIFEST.json --evidence-root F:\PythonWoking `
  --output-root F:\PythonWoking\temp\20261105-cap-integration\continued-screw-hm\release-harness `
  --run-name smoke-001 --python 'D:\AI_Tools\conda-envs\text-to-cad\Scripts\python.exe' `
  --node 'E:\Program Files\nodejs\node.exe' --execute-smoke
```

The fixed commands run existing dimension unit tests and Node threaded-solid
tests. Node uses the existing `dist` build; this harness does not rebuild or
certify source/build equivalence. Declare relevant source/build artifacts if
that provenance is required. Each command has a 60-second timeout, version
probes 10 seconds. No broad suites, CAD regeneration, host launches, installs,
venvs or solver launches occur. Child output is hashed, not copied into reports;
the controlled test suites are trusted code, not sandboxed untrusted programs.
Temporary/output paths and bytecode suppression are set for child tests.
Capture buffers depend on the fixed tests remaining bounded; this is not a
general adversarial process sandbox. Do not add unreviewed commands.

Exit codes: 0 scoped mesh pass, 1 failed required check, 2 invalid input, 3
incomplete required checks (`partial`, `not_run`, `unsupported`). Required failed
checks dominate; mixed required success and gaps is partial. Optional solver
states do not determine this exit code. Skipped/empty suites cannot pass.
A report always retains
`full_feature_release: false` and `engineering_contact_preload_certified: false`.

## Release Review

- Pin manifest hashes before running; do not refresh hashes merely to accept drift.
- Record runtime versions and preserve the manifest/report outside Git.
- Review the eight current TODO workstreams; no completion percentage is implied.
- Keep actual M6 geometry/data evidence separate from quality-policy acceptance.
- R11 license blockage before model parsing is optional `not_run`, not a
  successful solve and not a mesh-development or mesh-release blocker.
- scikit-fem 12.0.2 installation is not a test result. Hash-bound independent
  engine evidence may be recorded as partial; it never satisfies R11 or
  engineering fastener contact/preload. Optional numerical verification is a
  separate module, not a mesh-generator dependency.
- Original Screw core, nonplanar endpoints and whole-domain validation remain
  separate from the complete saved M6 cap result.
- Missing live CAD/HM/GUI oracles remain not_run or historical partial. Use
  unsupported only for an explicitly unsupported workflow, not a missing tool.
- No keys, licenses, private binaries or large case files belong in commits.
- Review and commit only verified source changes; keep large case evidence local.

Unit tests: `python -B -m unittest tools.tests.test_fastener_release -v`, with
`BOLTHEX_TEST_ROOT`, `TEMP`, `TMP` under the explicit output root.
Fixture tests skip before allocating anything unless `BOLTHEX_TEST_ROOT` is an
existing absolute `temp/YYYYMMDD-task` directory or descendant. There is no OS
temporary-directory fallback, and skips are not acceptance passes.

## Machine Run, 2026-11-06

`F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm/release-harness/smoke-001/report.json`
records a real **partial** checkpoint using Python 3.12.13 and Node v24.13.0.
Both fixed smoke commands passed without skips. Three evidence artifacts
matched declared sizes/hashes, including the saved M6 report (333824 H8,
456194 nodes, 94 native CAD faces, one solid), independent K/INP recheck and
current TODO. The adjacent manifest is the exact declaration used. No large
CAD/HM/mesh file was copied or regenerated. These artifacts remain outside Git
for main's integration review, not as a claim of full product readiness.

The later `release-harness/smoke-003-independent53592/report.json` reruns the
same bounded commands with a fourth hash-bound artifact:
`r11-quality/complete-joint53592-v1/skfem-result.json`. This historical
scikit-fem 12.0.2 synthetic linear-elastic patch verifies the complete supplied
53592-H8 joint with 152754 free interior DOFs. Its recorded relative errors
are displacement 4.43982e-14, all-Gauss stress 8.93883e-13 and elastic energy
3.97893e-15. The harness verified this report's hash and declared integer counts;
it did not run the independent solve. The independent-engine oracle remains
historical `partial`, R11 remains license-blocked `not_run`, and the overall
release remains `partial`. This adds no CAD fidelity or engineering fastener
contact/preload certification. Earlier manifests/reports are retained unchanged.

Following the user's mesh-first clarification, the first separated-track run is
`release-harness/smoke-004-mesh-first/report.json`. It uses the same pinned
manifest with separate required mesh and optional solver tracks. Both smoke
commands and all four artifact checks pass; source-tree smoke/integrity is
`pass`, mesh delivery is `partial` due to core scope gaps, and supplemental
solver evidence is `partial`. R11's `not_run` does not cause mesh incompleteness.
All eight pending workstreams remain explicit; no solver dependency was added.

## Revalidation, 2026-11-07

Latest evidence is under `release-harness/20261107-validation-v1/`:
`unit-tests.json` records 28 passing tests with no failures/errors/skips, and
`current-mesh-first/report.json` records the real bounded smoke run. Four
artifact checks and both fixed commands pass; mesh delivery remains partial,
with eight workstreams pending and full-feature release false.

The old pinned TODO hash correctly fails in `prior-manifest-check/report.json`.
Main's reviewed TODO change adds mesh-only whole-joint/per-PID diagnostics and
clarifies optional solver verification. `evidence-update.json` records the old
hash, new immutable TODO snapshot and reason for the new declaration; the
other evidence hashes are unchanged. Old reports/manifests are not overwritten.
Canonical/case/link rejection and optional-evidence missing/corrupt cases now
have additional regressions. No solver was run or added as a dependency.
