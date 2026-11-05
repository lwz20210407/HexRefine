# Complete M6 Hemisphere Cap Nut

Status: **implemented and verified for the saved M6 case**,2026-11-05.
This is not all fastener families or completion of the Screw repair.

Quality clarification: the saved bundle verifies native geometry/data transfer
and the historical mesh screen, not solver-ready engineering quality. The
subsequent complete333824-cell metric reassessment retains minimum SJ0.215729
but identifies36290cells below the Verdict/Cubit0.5reference and8cells below
the HyperMesh-style Gauss determinant-ratio0.7reference (minimum0.605334).
Sampled Jacobians remain positive. These are separate advisory metrics, not
interchangeable thresholds. See [the corrected metric policy](H8_QUALITY_METRIC_POLICY.md).
The previous local evidence is not rewritten or upgraded to solver acceptance.

## Product And Verification

The actual native HyperMesh database contains94CADfaces/one solid plus
456194nodes/333824H8. The repository adapter loads a CAD-only native database,
imports the matching K without snapping, saves, clears and reopens the result.
Whole-mesh IDs,coordinates,connectivity and PIDs remain unchanged.
Geometry and FE coexist; attached CAD associations are NOT certified.

| Independent check | Observed result |
| --- | --- |
| K/INP connectivity | exact match |
| Coordinate serialization difference | 5.009327e-13mm |
| Minimum corner SJ |0.2157294604|
| Minimum Gauss determinant |2.5827984e-7|
| Mesh volume |426.894823981mm3|
| Independent valid native BRep volume |426.917199823mm3|
| Source design volume |426.917207618mm3|
| Relative native/source CAD volume error |1.825842e-8|
| Relative FE/native CAD volume error |5.2412604e-5, below1e-4|
| Native reverse witness error |4.2790203e-5mm, below0.0004mm|
| Nonmanifold faces / boundary edges |0/0|

The explicit engineering recipe declares0.04mm seed size and treats every
surface as critical. It was not increased after observing the errors.
1053reference observations,641boundary-node controls and17196reverse witnesses
are covered. Fresh native-math evaluation checks3318PCurve and36921stored3D
observations. Four warnings have separately checked fallback witnesses and
remain in the evidence; queryFailures=0 and unsupportedQueries=0.

Independent reconstruction retains94faces and237physical edges with474owner
representations. Two natural sphere-pole chart edges collapse in world space;
they are not extra physical surfaces. Analysis-only edge tolerance metadata
on two edges is adjusted to1.2e-5mm from measured error around1.133e-5mm.
No geometry, FE coordinates or source file is moved by that metadata change.

## API And Reproduction

`tools.hypermesh_native.make_tcl(..., native_cad_database=...)` supports the
CAD-only native input. It requires a CAD reference, rejects an existing FE
payload in that input and does not permit input/output aliasing. The previous
STEP input path is retained. Native payload construction and independent
trim reconstruction remain bounded research tooling, not a universally
validated CAD importer.

Local evidence root (not distributed binaries):
`F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm`.

- `whole-cap-engineering-hm-native-api/model.hm`
- `whole-cap-engineering-hm-native-api/VERIFIED_ENGINEERING_BUNDLE_V2.json`
- `hm-writer/native-trim/full-model/analysis-valid-native.brep`
- `verify_complete_cap_bundle.py`: fresh hashes, OCCT validity/mass and
  captured-math checks; uses the existing CAD runtime.
- `recheck_complete_cap_k.py` and `recheck_complete_cap_inp.py`: independent
  format reloads, run in their documented existing runtimes.

The native HM SHA256 is
`3b661a5c700960f057ad2bb9fdf82f1c233d2db1202988421c2d401f7eb31887`.
The unchanged K SHA256 is
`a461759ff9cc18c5a8fc54e01e855aade0276c38cc1a86b3581599fd6509fe07`.
Independent API/manual native captures are byte-identical, but the saved HM
files themselves need not be byte-identical.

## Remaining Limitations

- Altair's separate STEP writer still fails the full reference set:
  maximum0.000433191mm exceeds0.0004mm. It is NOT accepted by this bundle.
- Finite witnesses and valid BRep mass are not a continuum distance proof.
- A0.000227259mm runout end layer remains a performance/time-step TODO.
- Solver loading, contact, preload and standards-edition certification remain
  separate work; this is geometric and FE-data verification.
- Original Screw axis degeneration, broader families and unified capsule GUI
  are not closed by this case.
