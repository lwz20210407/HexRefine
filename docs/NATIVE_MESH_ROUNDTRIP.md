# Native Mesh Roundtrip IO Acceptance

`tools/verify_native_mesh_roundtrip.py` compares a source mesh-only LS-DYNA K
with an **actual native-application re-export K**, optionally checking an
independent source Abaqus INP with meshio. This is a bounded serialization
acceptance module, not a CAD, geometry-quality, material, or solver certificate.
The caller is responsible for supplying the genuine native export and mm units.

## Contract

- Hard limits, with no CLI/API override: **64 MiB per input** and **200,000 H8
  elements per K**. The same limits apply to optional INP. Byte bounds are
  checked before decoding; syntax/count guards run before structured readers.
- Coordinates must be finite. Compare every XYZ component with
  `abs(source - candidate) <= 1e-10 mm`, relative tolerance zero. No centering,
  rounding, rescaling, fitting, tolerance widening, or coordinate adjustment.
- NIDs and EIDs are preserved, not regenerated. Canonically sort nodes by NID
  and elements by EID. Node/element ID sets, PID, and ordered H8 slots n1..n8
  must match exactly. Do not sort the eight nodes within an element.
- Positive integer IDs only. Reject duplicates, missing required fields,
  missing referenced nodes, empty meshes, and collapsed/non-H8 connectivity.
  Gaps in IDs and unused but valid nodes are allowed; geometric degeneracy and
  Jacobian quality are outside this module.
- PyDYNA structured NODE/SOLID tables are concatenated across **all** cards.
  Both standard one-line SOLID and native two-line SOLID are supported.
  Optional PyDYNA n9/n10 columns must be entirely missing/NA. Any explicit
  value, including zero, is rejected. Report actual topology as **H8**, not H10
  merely because PyDYNA exposes n9/n10 columns.
- Original input files are opened read-only. Parse bounded byte snapshots and
  rehash inputs after comparison (including failure paths), then again after
  the temporary report is flushed/fsynced and immediately before `os.link`.
  A change detected at either checkpoint rejects the run without publication.
  SHA checks detect changes at checkpoints, not a
  filesystem lock against later writes or changes restored between checkpoints.
- Publish a success-only, SHA-256-bound JSON report at a **fresh** path.
  The parent must exist. A temporary file in that parent is written completely,
  then hard-linked exclusively to the report name and removed. Existing paths
  are never overwritten; the filesystem must support same-directory hard links
  (verified on this Windows NTFS deployment). A failed comparison writes no
  report and returns diagnostic numbers in the exception/CLI stderr.
  Cleanup of only this invocation's owned temporary file is best effort:
  an unlink error may leave that file in the report directory, but cannot
  turn a successfully published certificate into an apparent API/CLI failure
  or mask an existing rejection. No other temporary files are swept.

## Supported Formats

K supports ASCII, exact uppercase `*KEYWORD`, optional single-line `*TITLE`,
`*NODE`, `*ELEMENT_SOLID`, and terminal `*END`; comments begin with `$`.
NODE uses standard 8/16/16/16/8/8 fields or comma-separated fields. SOLID uses
standard eight-character ID fields or comma-separated fields. Layout is
uniform within a SOLID card, but different cards can use different layouts.
The two-line discriminator follows PyDYNA 0.12: first noncomment record's
stripped length is at most 16 characters. Ambiguous comma records, long-field
extensions, extra fields, nonzero NODE TC/RC, unknown keywords, mixed element
types, includes, transformations, and parameter expressions fail closed.
Required numeric fields are checked before reading; parsed IDs/PID/slots must
also match the preflight labels exactly. Reader warnings or unprocessed
keywords are rejection conditions. The TrueGrid basic reader is not used.

INP supports one global ID namespace/single part, exactly one NODE block,
and one or more C3D8/C3D8R ELEMENT blocks. Nodes precede elements; each element
is one complete comma-separated EID+8-node row. Meshio independently reads XYZ
and connectivity. Since meshio's Abaqus reader discards original labels, a
strict label sidecar retains NIDs/EIDs and verifies the reconstructed slot IDs.
Duplicate IDs are rejected before meshio can overwrite dictionary entries.
Metadata-only HEADING/PART/END PART/ELSET/NSET blocks are ignored, not certified;
only the original NODE/ELEMENT numerical records are passed to meshio.
Other blocks/options, includes, assemblies, transforms, multiple NODE blocks,
and higher-order/mixed elements are rejected rather than silently flattened.
INP has no LS-DYNA PID: report NID/EID/XYZ/slots parity only, never imply PID
or material certification from INP. Both K-to-INP comparisons are reported.

## Python API

```python
from tools.verify_native_mesh_roundtrip import (
    AcceptanceError, verify_native_mesh_roundtrip,
)

report = verify_native_mesh_roundtrip(
    source_k, native_k,
    report_path=fresh_report_path,
    source_inp=optional_source_inp,
    meshio_package=optional_existing_meshio_package_directory,
)
```

Returns the JSON-compatible report dict; `AcceptanceError` carries a readable
message and a `.details` dict (comparison values on parity failure). No
tolerance/limit arguments are exposed. Report fields include runtime/package
versions, verifier SHA, absolute input paths/bytes/SHA-256, observed mesh
types/counts/layouts, exact-match flags, maximum coordinate delta and worst
NID/axis/value pair, and the unchanged-input check. This API does not launch
HyperMesh, GUIs, or a solver and does not export or modify a K/INP file.

Lower-level helpers `Snapshot.read`, `preflight_k`, `load_k`, and `compare` are
available for task-local evidence scripts. `load_k(snapshot, layout)` expects
the layout from `preflight_k(snapshot.text())`. Its `Mesh.elements` stores
**original NIDs**, not zero-based indices; `node_ids` and `element_ids` are
sorted. Only the top-level API performs the complete unchanged-input and
success-only-report acceptance transaction.

## CLI And Existing Runtime

Use `C:/Users/yuguo/.conda/envs/py3.11env/python.exe -B` from this checkout.
Installed PyDYNA is 0.12.1. That interpreter has no installed meshio; this case
reuses the existing pure-Python meshio 5.3.5 package at
`C:/Users/yuguo/.conda/envs/py39env/Lib/site-packages/meshio` with
`--meshio-package`. Only that package is loaded; the Python 3.9 site-packages
directory is not added to `sys.path`, and numpy/other dependencies continue
to come from Python 3.11. No installation, environment, or cache is created.

```powershell
& C:/Users/yuguo/.conda/envs/py3.11env/python.exe -B tools/verify_native_mesh_roundtrip.py `
  --source-k $sourceK --native-k $actualNativeK --source-inp $sourceInp `
  --meshio-package C:/Users/yuguo/.conda/envs/py39env/Lib/site-packages/meshio `
  --report $freshReport
```

Exit 0 means acceptance report published. Exit 1 means input/reader/comparison
or publication rejection; stderr is JSON. Argparse usage errors exit 2.
Without INP, meshio is not imported. Missing meshio with INP is an error,
never a skipped/pass check.

## Test And Actual Evidence

Run only this module's tests, with explicit task-local output:

```powershell
$env:NATIVE_MESH_TEST_ROOT = $existingIoCheckDirectory
$env:NATIVE_MESH_MESHIO_PACKAGE = 'C:/Users/yuguo/.conda/envs/py39env/Lib/site-packages/meshio'
& C:/Users/yuguo/.conda/envs/py3.11env/python.exe -B -m unittest tools.tests.test_native_mesh_roundtrip -v
```

Tests create isolated temporary fixtures under that directory and remove only
their own fixtures. Coverage includes one-line/two-line equivalence, reordering,
multiple cards, independent INP, coordinate boundary/overflow rejection,
slot/PID/ID changes, duplicate/missing IDs, missing references, nonfinite
coordinates, nonempty higher-order slots, mixed/unsupported formats, include
and transform rejection, size/count bounds before PyDYNA, reader failure,
concurrent input mutation, fresh-path protection, publication failure, CLI
failure with no report, and hashes preserved on ordinary success/failure.
The publication-window regression tests additionally mutate the source during
temporary-report fsync (no link/report allowed) and inject a post-publication
temporary-unlink failure (successful return and intact certificate required).
The full suite now contains 37 tests. New freeze evidence uses
`tests-publication-guard.log` and `actual-roundtrip-publication-guard.json` in
the evidence directory below; earlier reports and the NPZ bridge are retained
unchanged, bound to their original reader code and still-valid native K hash.

Actual evidence is retained under:
`F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm/iges-production-screw-20261107/io-check/`.
Source files are `flat-washer/custom-balanced-v2/{model.k,model.inp}` under
`continued-screw-hm`; native is `washer-native-iges-v2/roundtrip.k` under
`iges-production-screw-20261107`.

Observed actual deltas (mm), all below the unchanged `1e-10` threshold:

| Comparison | Maximum absolute coordinate delta |
| --- | ---: |
| Source K vs native K | 5.000444502911705e-13 |
| Source K vs independent INP | 5.0182080713057076e-14 |
| Native K vs independent INP | 5.502265310042276e-13 |

The actual-case-only `export_native_arrays.py` in that evidence directory
produces `native-roundtrip.npz` from **native K only**, through the same
two-line-compatible PyDYNA reader. It contains sorted `node_ids`, sorted
`element_ids`, `part_ids`, XYZ `nodes`, and `elements` as zero-based indices
into sorted `nodes`. Its independent receipt binds NPZ SHA-256 to the real
native K SHA-256 and the acceptance-report SHA-256. Loading with
`numpy.load(path, allow_pickle=False)` requires no PyDYNA in a rendering
runtime. Reconstruct original slots as `node_ids[elements]`; no source K
coordinates or topology are substituted into that bridge.
