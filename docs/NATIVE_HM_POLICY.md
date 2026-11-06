# Explicit Native HM Geometry Policy

`tools.hypermesh_native.export_hm` now accepts a validated
`CadAccuracyPolicy` through `accuracy_policy`. The default remains the strict
CAD regression profile. Engineering target size, critical target size, minimum
functional gap and minimum root radius are all forwarded to the independent
child audit; selecting the engineering profile does not change source CAD,
move mesh nodes, change seeds or waive mesh topology/volume checks.

The engineering path requires one explicit volume-carrier route and explicit
source CAD, a hash-bound reference set and the existing CAD Python runtime.
Use either `native_step_export=True` for direct STEP, or
`iges_sewing_tolerance=<declared mm value>` for a read-only reconstructed OCCT
BRep. Selecting both rejects; there is no automatic fallback or tolerance
escalation. Both require native IGES face/edge witnesses and an independently
read, valid closed BRep with volume evidence. The host's
approximate volume is not substituted for the independent BRep measurement.
Raw witness maxima and bounds are recomputed before publication, rather than
trusting a rounded summary or a producer success Boolean.

The native STEP uses the installed HyperMesh2022.3 writer's documented
`GeometryMode=Standard`, `TopologyMode=Solid/Shell`, AP214 and millimetres.
Optimization remains disabled. The export occurs after saving and reopening
the native HM, inside the existing read-only mesh snapshot/host-volume guards.
An exported carrier is not a replacement for source design geometry, and
finite samples are not a certified global Hausdorff bound.

## Observed Washer Comparison, 2026-11-07

The complete custom D12/d6.4/t1.6 washer has19008H8 and24192nodes, with the
same source STEP and K used in both experiments. Save/clear/reopen preserved
mesh IDs, connectivity, coordinates and PID; native HM contained one solid and
six surfaces. The source CAD/H8/K/INP checks passed independently.

The native IGES surface/edge comparison passed the declared engineering
distance budget0.0005mm. However, both native STEP export modes failed that
same distance budget:

| STEP writer | Maximum surface distance, mm | Relative BRep volume error |
| --- | ---: | ---: |
| BSpline | 0.001076298825216599 | 1.582479751758116e-5 |
| Standard | 0.0010664637556327945 | 1.5261172978075364e-5 |

Both candidates were valid one-solid BReps and their volume differences were
within1e-4, but the distance failures prevented an accepted HM result report.
This is an explicitly unresolved native exchange case, not a passed HM
delivery. Changing modes did not solve it. No tolerance was increased and no
STEP was substituted for the independent source. Earlier successful M6 native
SDK/capsule evidence remains a separately scoped route.

Evidence root:
`F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm`.
Failed exports remain in `flat-washer/native-balanced-v2` and
`resume-20261107/washer-native-standard-v1`; original artifacts are unchanged.
Focused policy/script tests: `tools.tests.test_native_hm_policy`, plus the
existing native export/capsule guards. These do not certify every CAD family.

Further work is to preserve the actual finite trim geometry across native
exchange or validate the native SDK BRep route, not relax the witness budget.
No solver is involved in this geometry/data workflow.

On an independent STEP audit failure, subsequent runs write `rejection.json`
with the failed stage, child exit code and finite diagnostic measurements.
An absent/invalid audit is not turned into zero error. The candidate HM is
retained for diagnosis; no accepted `report.json` is published. Existing
pre-change experiment folders are not rewritten to manufacture new evidence.

## Historical IGES Experiment

The2026-11-07 diagnostic recovered a closed solid from the actual exported
washer IGES faces, not from FE nodes or the source STEP. Sewing was tried at
1e-7,1e-6,1e-5and5e-5mm. The first three retained free edges; at5e-5mm the six
unchanged support surfaces formed one valid closed solid with zero free or
multiple edges and no deleted faces. The native HM was not edited.

The reconstructed analysis carrier then passed the existing full finite
source/forward/reverse/physical-edge/volume audit under the same engineering
policy: maximum surface distance1.11813e-5mm, maximum reverse-edge distance
2.09772e-5mm and relative independent volume error8.61176e-7. All source/HM/K
hashes remained unchanged. Evidence is in `resume-20261107/iges-solid-probe-v1`
and `resume-20261107/iges-solid-full-audit-v1` below the same local root.

That experiment did not fix the direct native STEP writer and was not a
production fallback. At that checkpoint the reusable topology/provenance
contract, negative-case regressions and high-level integration were still open.
Its reports intentionally keep `nativeHmVerified` and `productAcceptance` false.

## Production IGES Route, 2026-11-07

The previously investigated route is now implemented by
`tools.bolthex.native_iges_solid` and selected explicitly in `export_hm`:

```python
export_hm(mesh, source_report, hmbatch, new_output,
    cad=source_step, cad_report=cad_report,
    cad_reference=reference_json, cad_python=cad_python,
    accuracy_policy=CadAccuracyPolicy.engineering(declared_target_mm),
    iges_sewing_tolerance=5e-5, native_k_export=True)
```

The tolerance above is the tested washer's declared reconstruction setting,
not a recommended default for other models. It must lie between1e-7mm and the
policy's critical distance budget. No input or existing failed output is edited.

The direct STEP writer failures remain failures. A further exact BRepCheck
found that converting the reconstructed solid to STEP also loses curve
parameter consistency in this example. Therefore the formal analysis carrier
is `iges-reconstruction/reconstructed.brep`, **not a renamed STEP**. It is
saved/reopened with strict root/ownership, full-precision geometry and explicit
codec checks. The independently supplied original design STEP stays unchanged.

The source CAD audit now has explicit `audit_brep_carrier` /
`carrier_acceptance` entry points. BRep reports use `carrierFormat=occt-brep`,
`carrierBrepSHA256`, `carrierBrepVolume` and `relativeCarrierVolumeError`; they
must pass exact BRepCheck as well as the existing complete finite witness and
volume gates. The existing STEP API and report fields remain compatible.

Reconstruction is only an intermediate certificate. High-level publication also
requires the raw native-face audit, source-CAD comparison, current source/HM/
carrier hashes and unchanged FE snapshots. The final report's
`nativeCadAndMeshVerified` refers to that bounded geometry/data workflow, not
CAD-node association, exact native topology, manufacturing tolerance classes or
engineering analysis. `nativeTopologyReconstructed` explicitly records the
recovery method; `exactNativeCadCertified` remains false.

Physical faces may never be omitted. Separately exported auxiliary construction
curves/points are inventoried and excluded only from the physical solid; the
entire IGES file remains hash-bound. Partial certificate writes cannot create a
successful `reconstruction.json`: publication is atomic and exclusive, and
failures reset the verification flags in a separate rejection record.

Actual complete washer runs are retained under
`continued-screw-hm/iges-production-screw-20261107/washer-native-iges-v2`.
See the complete-boundary and independent keyword-roundtrip receipts there;
those additional checks are not implied by host process exit alone.

The complete-boundary check in `tools.verify_washer_native_geometry` separately
checks all9792boundary nodes,9792boundary face centres and19008cell centres in
this case. Linear-mesh discretization error against the original CAD and the
native CAD transfer error are measured separately; the latter does not excuse
a failed source-node gate. Actual maximum native-carrier node transfer error
is1.11813e-5mm, and mesh-to-native-carrier volume error is8.01867e-5 (limit1e-4).
The bore remains void. Cross-bindings prevent using another HM's reconstruction.

Independent `tools.verify_native_mesh_roundtrip` handles both one-line source
and two-line native ELEMENT_SOLID cards through PyDYNA, with independent INP
readback. The actual NID/EID/PID/eight-slot connectivity is identical; maximum
source/native coordinate difference is5.00045e-13mm against the unchanged1e-10mm
serialization limit. `nativeKeywordExportPerformed` records export only;
the separate hash-bound IO receipt is required to claim readback verification.
See [IO scope](NATIVE_MESH_ROUNDTRIP.md).

Final local receipts are
`iges-production-screw-20261107/complete-washer-geometry-v2.json` and
`iges-production-screw-20261107/io-check/actual-roundtrip-publication-guard.json`.
The source STEP, K and INP remain unchanged. There is no CAD snapping, solver
run or geometry association claim.
