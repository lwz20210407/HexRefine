# Complete Dome And Upper-Cap Integration

Date:2026-11-05. Complete hemispherical dome and conformal upper CAD crop
verified, NOT a complete cap-nut, native-HM or solver acceptance.

## Implementation

`cad_cap_plan.py` recognizes the actual blind-bore end and concentric complete
hemispheres. `cad_cap.py` retains the earlier local polar macro.
`cad_cap_dome.py` now fills the ENTIRE hemispherical material with five
cubed-sphere charts. The pole is ordinary; exact integer-direction entities
share seams without tolerance welding. `equatorial_interface(mesh)` returns
ordered gnomonic angles, original node rings/coordinates and oriented faces.

`cad_cap_shoulder.py` maps the real late-runout bore at Z4.9..5, without the
former R3.1 inner truncation. `cad_cap_upper.py` joins it to the whole dome by
explicit paired IDs. Opposite face orientations, two owners, disjoint axial
domains, unchanged coordinates and independent CAD volume are mandatory.

## Real Saved M6 Results

| Metric | Whole dome | Dome + late-runout shoulder |
| --- | --- | --- |
| H8 / nodes | 49,152 /98,818 | 61,440 /116,226 |
| Minimum corner SJ | 0.866013535 | 0.497758615 |
| CAD/H8 relative volume error | 7.44230e-5 | 7.23808e-5 |
| STEP volume round-trip error | 8.20e-14 | 4.18e-11 |

Both have positive Gauss determinants, Euler2 and zero nonmanifold faces/edges.
The join shares1024 exact nodes and512 two-owner faces, with zero internal free
interface faces. The dome nodes/connectivity are unchanged in the composite.
FE volume equals the component sum; their CAD sum separately matches the
independently cropped original source. No overlapping domains were accepted.

Actual K files were independently read/re-audited by PyDYNA. meshio/OCCT read
actual INP and CAD, checking257 boundary nodes and257 material centroids.
Interior nodes were not incorrectly required to lie on the boundary.
Reference CAD is source BRep cropped by seed-independent geometric tools,
NOT mesh-to-STEP. Source SHA256:
`f05d88d746926363dd2266eb88a243e8edf9e9e8baf24ab6aaf13c9b1c711902`.
The legacy parent lacks a current origin certificate; these checks verify the
saved geometry/partition/exchange, not standards-edition compliance.

## Use And Boundaries

```powershell
python -B -m tools.bolthex.cad_cap_dome SOURCE_STEP NEW_DOME_OUTPUT --node NODE_EXECUTABLE
python -B -m tools.bolthex.cad_cap_upper SOURCE_STEP NEW_UPPER_OUTPUT --node NODE_EXECUTABLE
```

Use configured build123d/OCP/meshio Python and compiled `dist/`. No BoltPro,
MATLAB or TrueGrid runtime. K is NODE/SOLID; INP has no material/contact/preload.
The STEP output is unmeshed cropped design geometry, not fitted FE geometry.

The dome annulus at Z5 is a partition interface. The combined accepted domain
is original material in Z>=4.9 and R<=4.75mm: it contains the whole dome but
excludes the outer hex/chamfer shoulder and lower threaded body. Neighboring
blocks must respect the512 gnomonic seeds. FullCapNut remains false.

Limits unchanged: SJ>=.15; CAD/H8 volume<=1e-4; boundary nodes<=2e-6mm;
face centers<=.02mm; CAD exchange<=1e-7. Coarse seeds fail volume, excessive
counts reject before allocation. This is topology/mapping/interface work,
not new certified2:1/3:1 three-dimensional thread grading.

## Evidence And Remaining Work

All49 targeted cap tests passed with saved CAD/interface selected, no skips.
The binary writer/read-back47 tests passed separately, not a full-repo claim.
Actual K/INP/STEP, independent audits and LS-PrePost images:
`F:/PythonWoking/temp/20261105-cap-integration`, cases `dome-M6-final` and
`upper-cap-M6`. Half-mesh renderings are inspection-only; primary K is complete
for its stated domain. Cut-facing views show the cavity/thickness.

Still open: outer hex/chamfer shoulder, lower radial runout termination,
threaded body, whole-nut CAD/volume/interface/K/INP/HM and wider families.
Local or upper-crop success is not promoted to whole cap-nut acceptance.
