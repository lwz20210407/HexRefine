# Independent native CAD exchange audit

Date:2026-11-05. Status: guarded opt-in measurement path implemented; real M6
socket native-HM case still REJECTED. This is not a fix/completion announcement.

## Narrow Trimmed-Face Witness Follow-up

The saved M6 cap source has94 faces. Two narrow planar trims (zero-based0 and47)
miss all seven old UV seeds; skipping them would invalidate source-face coverage.
`_interior_point` now keeps the fast path but only accepts strict `TopAbs_IN`,
never a boundary `ON` result. When needed, a deep isolated face copy is meshed;
up to4096 evenly selected triangle-UV barycenters propose points. The ORIGINAL
trimmed face must independently classify the UV as IN and evaluate finite XYZ.
No candidate means rejection, not a larger tolerance or an omitted face.

Actual94/94 source faces now yield strict interior witnesses. Caller geometry,
volume, file hashes and existing triangulation remain unchanged. A separate
thin annulus regression misses every legacy seed but passes the new strict
check. NaN coordinates, ON-only classifications, nonisolated copies, failed
meshing and unbounded/empty UV domains reject. This improves measurement
coverage only; it does not certify HM precision, CAD provenance or repair the
previous socket exchange failures. The accepted whole M6 CAD/H8/K/INP case and
the ongoing native transfer remain separately scoped.

Actual cap transfer follow-up: the333824-H8 mesh was saved/reopened in HM
unchanged with one native solid, but the original-STEP diagnostic FAILED.
Measured source/native volume difference is0.0029899257 relative, source-face
distance1.88965e-5mm, reverse-edge distance3.85890e-4mm and bounds difference
1.91236e-5mm. The independent IGES check remains false. A regenerated-STEP
control is recorded separately; native host save/reopen and geometric fidelity
must not be conflated. These are source-CAD transfer diagnostics, not retroactive
standards/origin certificates for the older saved STEP.

## Why another check is needed

Native closest-point APIs disagree near trimmed edges, and a favorable
distance-only answer can fail independent near-boundary controls. See
[query calibration](NATIVE_CAD_QUERY_CALIBRATION.md). Surface-interior points
alone also missed exported boundary-curve deviations. A native faceted bounding
box is not an exact CAD boundary certificate.

The opt-in path exports native geometry to an IGES measurement carrier with
optimization disabled. Independent OCCT measurements check the actual trimmed
faces, every source/native face, native boundary edges and near/far controls.
Free auxiliary curves are excluded from physical body bounds; extra actual
faces are NOT discarded. A missing source face is detected even with a sparse
user reference. The IGES is not advertised as a reconstructed closed solid STEP.

## Mandatory contracts

- Source STEP, HM, IGES, manifest and reference hashes bind the result. The
  source inputs must remain unchanged throughout measurement.
- Original mesh IDs, node coordinates, connectivity and PIDs survive native
  save/clear/reopen and IGES export; no snapping, coordinate welding or K
  regeneration is performed by this adapter.
- One native/source solid; positive finite measured native volume; native
  volume before/after export agrees within1e-12 relative. This conservative
  guard can reject a host with changing volume/cache results; it does not
  assert which kernel operation caused that change.
- Surface, source-face, reverse-face, reverse-edge and control limits remain
  2e-6mm; independent bounds1e-5mm; native/source CAD volume1e-7 relative.
  Existing FE/CAD volume1e-4 and SJ>=.15 are unchanged.
- Original references are independently rechecked against trimmed source CAD;
  at least six positive near-boundary controls are required, not just distant
  controls. No face can be silently skipped in either direction.
- The parent adapter verifies hashes, finite six-value bounds, all numerical
  gates, entity coverage and raw witnesses versus declared maxima. A positive
  boolean, malformed bounds or fabricated summary does not publish success.

## Interfaces

```powershell
python -B -m tools.hypermesh_native SOURCE_K SOURCE_REPORT NEW_OUTPUT --hmbatch HMBATCH_EXE --cad SOURCE_STEP --cad-report MATCHED_CAD_REPORT --cad-reference CALIBRATED_REFERENCE --cad-python CONFIGURED_CAD_PYTHON
```

Use the existing build123d/OCP runtime for the independent audit. The main
adapter still uses its configured PyDYNA runtime or an exact previously
validated K audit. No new environment or installed translator settings are
created. The native host and CAD child have separate bounded timeouts.

Without both opt-in arguments, existing strict behavior remains; native
faceted-bounds rejection is not silently bypassed. With opt-in, independent
IGES bounds may replace that gate ONLY after all independent measurements pass.
Both original native-facet bounds and independent bounds are reported. A source
CAD certificate or good mesh alone does not certify the native CAD transfer.

## Actual evidence and limits

| Saved M6 socket HM / native exported representation | Measurement |
| --- | --- |
| Source surface points | 241 |
| Near/far controls | 138 |
| Native face-interior witnesses | 173 |
| Native edge witnesses | 5190 |
| Maximum forward surface distance | 3.89e-9mm |
| Maximum control error | 1.13e-6mm |
| Maximum reverse face-interior distance | 2.97e-8mm |
| Maximum reverse boundary-edge distance | 1.20578e-4mm: FAIL |
| Independent face-only bounds difference | 1.61656e-5mm: FAIL |
| Native/source volume difference | 5.47e-8 relative |

Changing the export outer-loop option, isolated session precision, the
third-party conversion option or the tested reader modes did not yield an
accepted case. Source STEP to OCCT IGES BRep preserves volume to3.14e-11
relative, but subsequent tested HM import either lost the native solid or
drifted; that route was rejected too. None became a new product default.

The adapter unit tests simulate process boundaries and therefore do NOT certify
HyperMesh. Separate tiny real OCCT STEP/IGES tests cover positive measurement,
displaced/extra/missing faces, auxiliary curves, negative mass, changed inputs
and report inconsistencies. These are not full socket HM acceptance.

Local actual host evidence:
`F:/PythonWoking/temp/20261104-native-cad-precision`. Existing original K/INP,
STEP and native HM were not overwritten. No new large fidelity mesh was needed
to expose these failures. Native socket CAD/HM and broader family TODOs remain
open; a failed audit is never labelled a finished mesh.
