# Custom Washer Native Workflow

This workflow starts with independent design STEP and an unchanged source H8
mesh, prepares finite source references, saves/reopens native HyperMesh,
checks its geometry carriers, and independently checks the actual K re-export.
The reference builder itself does **not** launch HyperMesh, TrueGrid, a mesher,
or a solver. No new package or environment is required on this host.

## Public Reference API

```python
from tools.bolthex.washer_native_reference import prepare_reference

reference = prepare_reference(
    source_bundle,             # existing flat_washer.generate() directory
    new_output,                # NEW JSON FILE, outside the source bundle
    maximum_boundary_nodes=1024,
)
```

The output parent must already exist. Existing files, directories and symlinks
are rejected, never overwritten. Output inside the immutable source bundle is
rejected, even if its name is new. The return value is the JSON-compatible
reference object written to `new_output`. `ValueError` signals invalid input,
certificate, budget or measurements; filesystem errors can raise `OSError`.
The CLI returns 0 on publication, 1 on a rejected run, and 2 on usage errors.

Required inputs are `report.json`, `cad-report.json`, `model.step`, `model.k`.
No `native-reference.json`, HM installation, PyDYNA installation or TrueGrid
reader is needed by this builder. The source INP is not read or certified by
reference preparation; the final IO verifier handles it separately.

The builder:

- Reads dimensions and seeds from the actual report, revalidates the bounded
  `flat_washer.plan`, and checks design, unit, seed/count and independent-CAD
  certificate fields. It checks all relevant STEP/K hash aliases, including
  `matchedKSHA256`, plus actual STEP volume/bounds and matched mesh-volume
  certificate consistency. It is scoped to the four-face, unchamfered custom
  annulus; it does not claim a standard washer/tolerance class.
- Reads the original mesh-only K using the existing bounded IO syntax/ID
  guard, then the standard NODE numeric fields and validated SOLID labels.
  Both one-line/two-line SOLID and multiple NODE/SOLID cards are handled.
  It does not use the TrueGrid basic reader, run PyDYNA in the CAD runtime,
  regenerate a mesh, renumber NIDs, or change coordinates. Other K grammar is
  rejected by the shared IO guard; this is not the final independent IO audit.
- Finds actual exposed H8 faces, checks their physical-face counts against
  seeds, and samples ascending actual boundary NIDs deterministically.
  `maximum_boundary_nodes` must be an integer in **[1,1024]**, not a Boolean.
  It is a cap: fewer nodes are emitted when the actual boundary is smaller.
  Each sample contains its real `nodeID`, exact parsed XYZ and physical faces.
- Creates interior witnesses on all four physical CAD faces, with seed-aware
  bounded station counts. Cylinder witnesses use interior thickness levels
  and offset angles away from the generated STEP seam. Plane witnesses use
  radii strictly inside the annulus. Dimensions are never hard-coded to D12.
- Uses `TrimmedFaceDistances` on the actual imported STEP for **every**
  `sourceDistance`, and also checks each face-interior witness against its
  named trimmed face. On-surface witnesses and sampled source boundary nodes
  must be within the unchanged **2e-6 mm** limit.
- Measures 48 near controls generated at signed 0.00002/0.0002 mm offsets.
  Every near control must actually measure between 4e-6 and 0.001 mm; at
  least six are required downstream. Far and trim-disambiguation controls
  include the bore and an exterior corner. Distances are measured to trimmed
  CAD, **not assigned from offset magnitude or infinite support surfaces**.
- Calls `validate_reference`, enforces **4096 points / 2 MiB** on the complete
  UTF-8 JSON, and binds STEP, K and both certificate SHA-256 values. Source
  JSON is limited to 2 MiB/file, STEP and K to 16 MiB/file; the washer plan
  retains its 20,000 H8 / 50,000 node caps.
- Rehashes all four inputs after construction and again after temporary-file
  fsync immediately before exclusive hard-link publication. Only its own
  temporary file is cleaned, best effort. This requires same-directory hard
  link support (NTFS here); SHA checkpoints are not a filesystem write lock.

The schema is compatible with `validate_reference`, `export_hm(cad_reference=...)`
and the downstream audits. Additional fields retain `sourceKSHA256`, source
certificate hashes, design/seeds, sample counts, measured calibration data,
runtime and builder hash. `fullModelAcceptance`, `exactNativeCadCertified`,
`nativeHmVerified` and `solverVerified` are explicitly false. Finite reference
success must not be promoted into complete-boundary or native-model acceptance.

## Runtime Split

- CAD/generator/reference/geometry: existing
  `D:/AI_Tools/conda-envs/text-to-cad/Scripts/python.exe`
  (Python 3.12, build123d 0.11.1, meshio 5.3.5).
- HM orchestration and independent PyDYNA IO:
  `C:/Users/yuguo/.conda/envs/py3.11env/python.exe` (PyDYNA 0.12.1).
- Existing Node writer: `E:/Program Files/nodejs/node.exe`.
- HM stage only: installed
  `F:/Program Files/Altair/2022.3/hwdesktop/hm/bin/win64/hmbatch.exe`.

The reference builder needs neither the last two runtimes nor the IO Python.
Generation uses Node; the separate native stage uses the explicitly selected
HM installation. Do not install packages into either environment for this route.

## Complete Python Chain

These calls run in the runtimes identified above, not all in one interpreter.
Use separate fresh paths; keep the same reference and policy throughout:

```python
# CAD Python: generate -> reference
from tools.bolthex.flat_washer import generate, WasherDesign, WasherSeeds
from tools.bolthex.washer_native_reference import prepare_reference
generate(WasherDesign(18., 9., 2.3), source, WasherSeeds(264, 2, 2), node=node_exe)
prepare_reference(source, reference_file, maximum_boundary_nodes=1024)

# IO Python: save/reopen native HM and explicitly reconstruct the IGES carrier
from tools.hypermesh_native import export_hm
from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy
policy = CadAccuracyPolicy.engineering(target_size_mm)
export_hm(source / "model.k", source / "report.json", hmbatch, native,
          cad=source / "model.step", cad_report=source / "cad-report.json",
          cad_reference=reference_file, cad_python=cad_python,
          associate=False, native_k_export=True, host_timeout=180,
          accuracy_policy=policy, iges_sewing_tolerance=sewing_tolerance_mm)

# CAD Python: complete bounded geometry check, using the SAME external reference
from tools.verify_washer_native_geometry import verify
verify(source, native, fresh_geometry_report, geometry_policy=policy,
       sewing_tolerance=sewing_tolerance_mm, reference_file=reference_file)

# IO Python: exact IDs/PID/H8 slots and fixed 1e-10 mm serialization tolerance
from tools.verify_native_mesh_roundtrip import verify_native_mesh_roundtrip
verify_native_mesh_roundtrip(source / "model.k", native / "roundtrip.k",
    source_inp=source / "model.inp", report_path=fresh_io_report,
    meshio_package=existing_meshio_package)
```

`source`, `native` and the other path variables above are `pathlib.Path`s.
The geometry verifier's default reference under the source directory exists
only for old examples. Always pass `reference_file` for new jobs. A new
reference cannot be substituted into an old native bundle: its audit receipt
must bind the exact reference hash used during that native export.

## Complete CLI Chain

This example is a recipe, not a claim that the HM stages ran in the reference
builder task. Run from the existing checkout; create only a fresh job under
the sanctioned task directory. To reuse an existing source bundle, set `$source`
to that directory and skip generation, never overwrite it.

```powershell
Set-Location F:/PythonWoking/worktrees/HexRefine/bolt-thread-native
$base = 'F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm/iges-production-screw-20261107/reference-builder'
$job = Join-Path $base ('workflow-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $job -ErrorAction Stop
$env:TEMP = $job; $env:TMP = $job
$env:OPENBLAS_NUM_THREADS = '1'; $env:OMP_NUM_THREADS = '1'
$cadPy = 'D:/AI_Tools/conda-envs/text-to-cad/Scripts/python.exe'
$ioPy = 'C:/Users/yuguo/.conda/envs/py3.11env/python.exe'
$node = 'E:/Program Files/nodejs/node.exe'
$hm = 'F:/Program Files/Altair/2022.3/hwdesktop/hm/bin/win64/hmbatch.exe'
$source = Join-Path $job 'source'
$reference = Join-Path $job 'native-reference.json'
$native = Join-Path $job 'native'

& $cadPy -B -m tools.bolthex.flat_washer $source --node $node `
  --outer-diameter-mm 18 --inner-diameter-mm 9 --thickness-mm 2.3 `
  --circumferential 264 --radial 2 --layers 2
if ($LASTEXITCODE) { throw 'Generation failed' }

& $cadPy -B -m tools.bolthex.washer_native_reference $source $reference `
  --maximum-boundary-nodes 1024
if ($LASTEXITCODE) { throw 'Reference preparation failed' }

$r = Get-Content (Join-Path $source 'report.json') -Raw | ConvertFrom-Json
$ri = $r.design.inner_diameter_mm / 2
$ro = $r.design.outer_diameter_mm / 2
$target = [Math]::Min(2*[Math]::PI*$ri/$r.seeds.circumferential, `
  [Math]::Min(($ro-$ri)/$r.seeds.radial, $r.design.thickness_mm/$r.seeds.layers))
$sew = 5e-5  # Explicit example choice, not an adaptive tolerance.

& $ioPy -B -m tools.hypermesh_native (Join-Path $source 'model.k') `
  (Join-Path $source 'report.json') $native --hmbatch $hm `
  --cad (Join-Path $source 'model.step') --cad-report (Join-Path $source 'cad-report.json') `
  --cad-reference $reference --cad-python $cadPy --native-k-export --host-timeout 180 `
  --accuracy-profile engineering --target-size-mm $target --iges-sewing-tolerance-mm $sew
if ($LASTEXITCODE) { throw 'Native export/audit failed; retain evidence' }

& $cadPy -B -m tools.verify_washer_native_geometry $source $native `
  (Join-Path $job 'geometry-report.json') --reference $reference `
  --target-size-mm $target --sewing-tolerance-mm $sew
if ($LASTEXITCODE) { throw 'Complete bounded geometry verification failed' }

& $ioPy -B -m tools.verify_native_mesh_roundtrip `
  --source-k (Join-Path $source 'model.k') --native-k (Join-Path $native 'roundtrip.k') `
  --source-inp (Join-Path $source 'model.inp') --report (Join-Path $job 'io-report.json') `
  --meshio-package C:/Users/yuguo/.conda/envs/py39env/Lib/site-packages/meshio
if ($LASTEXITCODE) { throw 'Native mesh IO acceptance failed' }
```

The declared target size is derived from the planned discretization, not the
shortest incidental edge. Sewing must stay within the selected policy budget;
failure is a rejection, not permission to loosen tolerance. Neither option
changes the fixed 2e-6 mm source-reference limit or 1e-10 mm IO tolerance.

## Original CAD Versus Carriers

`source/model.step` is the independent design reference. `native/model.hm` is
the saved/reopened native database. `native/native-cad.iges` is a read-only
measurement export from that database. Its
`native/iges-reconstruction/reconstructed.brep` is an intermediate closed
BRep reconstructed under an explicit sewing budget and hash-bound manifest.
It is **not** the original STEP, must not replace it, and is not a mesh-derived
design CAD. `native/roundtrip.k` is the actual native mesh re-export, not a
copy of source K. Geometry and IO reports certify different bounded scopes;
neither constitutes material, contact, preload, solver or analysis validation.

## Tests And Evidence

Set `WASHER_REFERENCE_TEST_ROOT` to an existing task-local directory, then run:

```powershell
& $cadPy -B -m unittest tools.tests.test_washer_native_reference -v
```

Optional `WASHER_REFERENCE_SOURCE` and `WASHER_REFERENCE_SMALL_SOURCE` point
to two existing read-only bundles with different dimensions/seeds. Without
them the suite generates two small fixtures within its own temporary directory.
Only owned fixtures are removed. Tests cover real CAD distances and boundary
NIDs, seam/interior placement, two sizes/seeds, noncontiguous/reordered IDs,
existing output, hash/certificate mismatches, bad budgets, nonfinite values,
the fixed source-distance and output-byte limits, publication-time mutation,
and CLI success/failure. No native host is launched by the suite.

This task retains its evidence in
`F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm/iges-production-screw-20261107/reference-builder/20261107-v1/`:
the existing v2 source is read-only, `small-source` is the new 18/9/2.3 mm,
264/2/2-seed fixture (2,376 nodes / 1,056 H8), and each newly prepared reference
is outside both source bundles. The earlier source `native-reference.json`
is deliberately untouched. No commit or HM launch is part of this task.

The generated1365-point actual reference was also checked against the saved
v2 HM's real IGES and reconstructed BRep in
`iges-production-screw-20261107/reference-carrier-compatibility-v1`.
Both finite geometry audits passed with all four source hashes verified. This
was a new-reference audit of an existing actual native model, not another
claimed host generation or a replacement of the original design STEP.

The exporter and full-boundary verifier honor the reference's optional
`sourceKSHA256`, `sourceReportSHA256` and `sourceCadReportSHA256` fields as well
as STEP identity. The verifier accepts an explicit external `--reference`;
references do not need to be written into immutable source bundles.
The source-tree recipe uses the generator's consecutive node IDs. Reference
preparation's sparse-ID tests do not extend other adapters' declared scope.
