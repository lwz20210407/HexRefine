# Native CAD query calibration

Date:2026-11-04. This is calibration and guarded measurement work, not an
accepted whole socket HM or a completion claim for the fastener project.

## Actual findings

The saved original M6 socket STEP and original native HM were left unchanged.
Using the same241 on-surface points and4 original distant controls:

| Query | Maximum surface residual, mm | Failed surface witnesses |
| --- | --- | --- |
| `hm_findclosestpointonsurface` | 3.33991e-5 | 10 |
| Coordinates from `hm_getcoordinatesfromnearestsurface` | 3.33991e-5 | 10 |
| `hm_getdistancefromnearestsurface` | 1.91473e-6 | 0 |

The last row is NOT a fix. Independent trimmed-source-CAD offset controls
expose a false acceptance: a point at source distance1.88708e-4mm was reported
at effectively zero by the distance-only query.124-control experiments had a
maximum control error1.88708e-4mm. Tighter isolated query tolerances and three
STEP reader variants did not fix the discrepancy; none became a product default.

The repeatable source-reference tool now adds134 independently positive local
controls for the stated ten difficult witnesses. The final reference has241
surface witnesses and138 controls. Original distances were independently
rechecked against saved trimmed CAD, maximum difference4.44e-16mm. Tangential
offsets that do not leave the source surface are counted and excluded as negative
controls, not misrepresented as positive-distance counterexamples.

## Repository interfaces

```powershell
python -B -m tools.hypermesh_probe_reference SOURCE_STEP BASE_REFERENCE NEW_REFERENCE --focus 3 33 36 39 66 78 111 117 123 141
python -B -m tools.hypermesh_geometry_probe INPUT_HM SOURCE_STEP NEW_REFERENCE NEW_OUTPUT --hmbatch HMBATCH_EXE --cross-check
```

The first command requires the existing build123d/OCP environment, never an FE
mesh. It checks source hashes, finite coordinates, sample budgets and real
trimmed-face distances. The second runs the installed host read-only and rejects
failed witnesses, controls or disagreement between the two query methods.
It never selects the most favorable query result. The witness gate remains
2e-6mm. A negative diagnostic is deliberately not a mesh-generation success.

## Independent geometry exchange is a separate check

Unoptimized native IGES export, independently read by OCCT, gave forward
surface residual3.89e-9mm, reverse face-interior residual2.97e-8mm and control
error1.13e-6mm. Those good face-interior samples do not cover boundary curves:
edge sampling then found about1.21e-4mm and face-only bounds differed by about
1.62e-5mm. Auxiliary IGES support curves also extend far outside the body and
must not be used as physical body bounds. The experimental independent native
audit therefore rejects this case, rather than dropping edge/bounds checks.

These observations concern the exported representation; they do not on their
own establish whether import, storage, export or query approximation caused a
particular residual. IGES solid reconstruction is not certified. It is a
trimmed-surface measurement carrier, not a newly claimed solid STEP.

## Primary documentation

- [HyperMesh closest-point query](https://2022.help.altair.com/2022.3/hwdesktop/hwd/topics/reference/hm/hm_findclosestpointonsurface.htm)
- [HyperMesh distance query](https://2022.help.altair.com/2022.3/hwdesktop/hwd/topics/reference/hm/hm_getdistancefromnearestsurface.htm)
- [Bounding-box entity definitions](https://2022.help.altair.com/2022.3/hwdesktop/hwd/topics/reference/hm/hm_getboudingbox_supported_entities.htm): surface bounds use a faceted representation; not an exact BRep certificate.
- [IGES writer](https://2022.help.altair.com/2022.3/hwdesktop/hm/topics/pre_processing/geometry/cad_writer_iges_r.htm): geometry export optimization can modify geometry, so isolated audit export disables it explicitly and checks measured volume and mesh snapshots.

Local reproducible evidence remains at
`F:/PythonWoking/temp/20261104-native-cad-precision`. Original user/study
models are read-only; no several-hundred-MB development mesh was regenerated.
