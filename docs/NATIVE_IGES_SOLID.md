# Native IGES Solid Carrier

`tools.bolthex.native_iges_solid.reconstruct_iges_solid` constructs an analysis
carrier from actual exported IGES faces. It does not open or modify the native
HM database, construct from source STEP, or construct from an FE mesh. It does
not run a GUI, host application, solver, or physical analysis.

## API and Inputs

```python
from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy
from tools.bolthex.native_iges_solid import reconstruct_iges_solid

report = reconstruct_iges_solid(
    manifest_file,
    output_dir,
    geometry_policy=CadAccuracyPolicy(),
    sewing_tolerance=1e-6,
)
```

Both keyword arguments are explicit. Units are millimeters. The OCCT minimum
sewing tolerance is `1e-7` mm; the maximum is
`geometry_policy.distance_budget_mm(critical=True)`. Nonfinite values, booleans,
out-of-budget values, and values below the kernel minimum are rejected. There
is no silent tolerance floor, escalation, retry, or alternate construction.

The output directory must not exist, including as a file, and its parent must
already exist. Existing output is never overwritten or adopted as fresh output.

The JSON manifest requires:

| Field | Contract |
| --- | --- |
| `nativeHmPath` | Existing bound `.hm` file, read only |
| `nativeHmSHA256` | SHA-256 of that exact file |
| `igesPath` | Existing `.iges` or `.igs` file |
| `igesSHA256` | SHA-256 of that exact file |
| `nativeFaces` | Integer from 1 through 256; must match imported physical faces |
| `solids` | Integer `1`, not boolean |
| `optimizationDisabled` | Boolean `true` |
| `nativeVolumeBefore`, `nativeVolumeAfter` | Finite positive host volume evidence, unchanged |

An optional `sourceStepSHA256` is provenance only, never a geometry input.
Unknown or duplicate fields are rejected. Input caps are 64 KiB for the manifest
and 32 MiB for the IGES. The manifest and both source files are hash-bound and
checked again before publishing success. A native HM hash binds bytes; it does
not prove that the file is a valid HM database or that its faces match the IGES.

## Reconstruction Gates

Every imported face must survive sewing exactly once with its mathematical
support unchanged. Face deletion, splitting, many-to-one correspondence, free
edges of the sewn physical shell, multiple edges, disconnected shells, and
multiple solids are rejected.
The candidate must be exactly one valid closed solid with bounded finite
tolerances and valid manifold ownership.

Auxiliary free curves and standalone vertices in IGES are allowed, matching the
existing native CAD audit: only physical trimmed faces define the solid.
`auxiliaryGeometry.freeEdgesExcluded` and `freeVerticesExcluded` record their
counts. Edge endpoints are not standalone free vertices. The report requires
`physicalFacesExcluded: 0` and `wholeIgesFileHashBound: true`; the SHA-256 binds
the entire IGES, including auxiliary geometry. No extra physical face may be
ignored, even if another subset already forms a valid closed solid.

Independent adaptive closed-BRep volume integration runs at two accuracies.
The written full-precision BRep is reimported, checked for solid and face ownership,
validated with exact BRep checks, and integrated again. Readback mathematical
geometry and tolerance metadata are checked with the committed `_reopen_math`
and `_reopen_tolerances` checks. Its relative volume change must satisfy the recorded
BRep roundtrip limit. Approximate host volume is not substituted for independent
mass and is not a candidate acceptance test.

## Outputs and Authority

Success produces `reconstructed.brep` and `reconstruction.json`. The returned
dictionary matches the saved JSON. Required report fields include:

- `carrierFile: "reconstructed.brep"`, `carrierFormat: "occt-brep"`, `carrierBrepSHA256`
- `sourceHmSHA256`, `igesSHA256`, `manifestSHA256`, `nativeFaces`
- `geometryAccuracyPolicy`, `sewingToleranceMM`, `sourceInputsUnchanged`
- `faceCorrespondence` with `sourceFace`, `carrierFace`, `supportSHA256`
- `sewing`, `solidState`, `readbackSolidState`
- `auxiliaryGeometry` with explicit excluded auxiliary counts and zero excluded faces
- `volumeIntegrations`, `readbackVolumeIntegrations`
- `relativeBrepRoundtripVolumeError`, `brepRoundtripVolumeLimit`

Only a complete successful reconstruction sets `reconstructionVerified: true`.
`nativeHmVerified` and `productAcceptance` remain **false**. The higher-level
workflow must independently audit the native faces and reconstructed carrier
against source CAD before native-HM delivery or product acceptance. This is not
an exact native topology capture or a global Hausdorff-distance certificate.

Preflight rejection need not create an output directory. Rejection after output
creation writes `rejection.json` and raises an exception; it must not publish a
success certificate. A partial BRep alone is not evidence of success, and a
rejected directory must not be reused as a fresh destination.

Certificate publication first writes `reconstruction.pending.json` exclusively,
flushes and syncs it, then uses `os.link` to publish `reconstruction.json`
atomically without overwriting an existing final name. Interrupted JSON writes
or link failures reset `reconstructionVerified` to false in `rejection.json`.
A remaining pending file, even if it contains a complete success-shaped report,
is not a published success certificate and must not be consumed as one.

The intermediate carrier is deliberately **BRep, not STEP**. An OCCT STEP
roundtrip can damage SameParameter metadata even when ordinary validity and
finite-sample geometry checks pass. The exact validity gate must not be relaxed
to accommodate that encoding. Downstream source-CAD comparison must explicitly
support the BRep format; changing the extension does not convert the carrier.

`validate_reconstruction(report, manifest_file, output_dir, *, geometry_policy,
sewing_tolerance)` checks the current file bindings and structured reconstruction
evidence, returning the bound carrier path. It rejects stale input/carrier hashes,
policy mismatch, incomplete or non-bijective face indices, invalid topology or
tolerance evidence, and inconsistent mass evidence. It is not an independent
source-CAD geometry audit and does not grant native-HM or product acceptance.

Use `native_cad_conditioning.audit_brep_carrier` for the separate source-STEP
comparison and `carrier_acceptance` for its format-aware evidence gate. BRep
audit reports require `candidateExactBrepCheck: true` and use `carrierBrepSHA256`,
`carrierBrepVolume`, and `relativeCarrierVolumeError`; they must not mix in
`carrierStepSHA256`, `stepBrepVolume`, or STEP-specific acceptance field names.

## Independent Tests

`tools/tests/test_native_iges_solid.py` generates small real IGES face sets using
OCCT directly, without the reconstruction helpers: a unit cube, missing and
duplicate faces, an extra open face, a single open face, and disjoint cubes.
An additional positive case includes one auxiliary free edge: its exclusion
count must be one while all six physical faces, supports, and solid state stay
unchanged. Extra physical faces and disjoint solids remain negative controls.
The bound HM fixture is deliberately opaque synthetic bytes, not a genuine host
database. The positive case independently reimports BRep through OCCT and
checks validity, face/edge counts, closure, volume, hashes, and certificate flags.

Negative controls cover explicit options, manifest typing and required fields,
hash/stale-input failures, in-flight input mutation, existing output, missing
parent, byte limits, mass/readback failures, interrupted success-report writes,
and atomic certificate-link failure.
Additional controls exercise report tampering and same-mass geometry substitution
on BRep readback. A real BRep-to-source-STEP audit reuses the existing
`TinyActualStepCarrierTests` fixture and checks canonical format-specific fields.
The oversized IGES guard uses a stat-only injected size, not a large file.
Temporary fixtures are removed by `TemporaryDirectory` cleanup.

Run from the repository using the existing interpreter, with an explicit scratch
root (create this exact root first if it does not exist):

```powershell
$env:BOLTHEX_TEST_ROOT = 'F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm/iges-production-screw-20261107/test-worker'
& 'D:/AI_Tools/conda-envs/text-to-cad/Scripts/python.exe' -B -m unittest tools.tests.test_native_iges_solid -v
```

No installation, new environment, GUI, host database load, solver, or large
geometry fixture is needed. Tests skip when OCCT or the explicit scratch root
setting is unavailable; a skipped run is not verification.
