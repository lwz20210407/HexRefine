# Explicit Native HM Geometry Policy

`tools.hypermesh_native.export_hm` now accepts a validated
`CadAccuracyPolicy` through `accuracy_policy`. The default remains the strict
CAD regression profile. Engineering target size, critical target size, minimum
functional gap and minimum root radius are all forwarded to the independent
child audit; selecting the engineering profile does not change source CAD,
move mesh nodes, change seeds or waive mesh topology/volume checks.

The engineering path requires `native_step_export=True` and explicit source
CAD, a hash-bound reference set and the existing CAD Python runtime. This
bounded implementation requires both native IGES face/edge witnesses and an
independently read, valid closed STEP BRep with volume evidence. The host's
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
