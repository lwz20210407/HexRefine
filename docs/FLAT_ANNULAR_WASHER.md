# Custom flat annular washer

`tools/bolthex/flat_washer.py` implements a complete **parameter-defined,
unchamfered annular washer**: independent analytic CAD, conforming mapped H8,
STEP, native LS-DYNA K and Abaqus INP. This is not labeled ISO7089 or any other
standard. No pinned washer table, standards edition or tolerance class has
been verified. There is no implicit chamfer, fillet, coating or clearance.

## Geometry and scope

The three design inputs are `outer_diameter_mm`, `inner_diameter_mm` and
`thickness_mm`. The origin is the bore axis at the bottom plane; material spans
`z=0..thickness_mm`. `build_cad()` accepts **only** these dimensions. build123d
subtracts concentric analytic cylinders, with no access to FE nodes, topology,
seeds or mesh error. The original dimensions are never adjusted for polygonal
volume loss. STEP export/reimport uses the existing `standard_cad._mass` and
CAD-only `1e-7` relative volume exchange limit.

`build_mesh()` reuses `mesh_core.build_ring_section` and `cad_mesh._sweep` with
canonical seam node identities. There is no proximity welding. Angular edges
are straight chords. Radial and thickness coordinates are independently
parameterized from the same three design dimensions; the saved STEP is then
the actual independent geometry used to audit the mesh, not a mesh-derived CAD.

## Bounded example

| Quantity | Value |
| --- | --- |
| Outer / inner diameter | 12 / 6.4 mm |
| Thickness | 1.6 mm |
| Circumferential / radial / thickness divisions | 288 / 6 / 4 |
| H8 / nodes | 6,912 / 10,080 |
| Source analytic volume | 129.4838828103569 mm3 |
| Linear mesh volume | approximately 129.4736114281638 mm3 |
| Relative volume difference | approximately 7.93256e-5 |
| Maximum outer chord sag | approximately 0.000356970 mm |
| Physical boundary Q4 faces | 5,760 |
| Boundary Euler characteristic | 0 (one annular solid) |

The exact polygonal volume factor is `sin(2*pi/n)/(2*pi/n)`. Planning rejects
insufficient angular resolution before CAD construction or mesh allocation.
No empirical universal scaled-Jacobian cutoff is introduced. Raw corner,
center and Gauss determinants and named SJ/ratio metrics are reported using
the existing quality module; its advisory bands are not acceptance standards.

All three dimensions must be finite non-Boolean numbers in `[.001,1000] mm`.
Radial material width must be at least `.001 mm`. These are explicit numerical
scope bounds, not manufacturing recommendations. Angular counts must be
divisible by six, as required by the reused ring topology (288 and 324 work;
320 is explicitly rejected). Radial/layer counts are at most 64. Limits are
20,000 H8, 50,000 nodes and 16 MiB for the whole published bundle. Some extreme
geometries require different seeds or fail these bounded capabilities.

## API and generation

```python
from tools.bolthex.flat_washer import WasherDesign, WasherSeeds, generate

report = generate(
    WasherDesign(outer_diameter_mm=12, inner_diameter_mm=6.4, thickness_mm=1.6),
    new_output_directory,
    WasherSeeds(circumferential=288, radial=6, layers=4),
)
```

`plan`, `build_cad`, `build_mesh` and `audit_mesh` are also available. A bare
mesh audit without a CAD shape explicitly returns `geometryVerified=False`.
Dataclass inputs are reconstructed into base records and revalidated; an
inherited `validate` method cannot override the guards. Dictionary design/seed
inputs must contain exactly their respective record fields.

```powershell
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:TEMP = '<existing-task-scratch>'
$env:TMP = $env:TEMP
$env:BOLTHEX_TEST_ROOT = $env:TEMP
python -B -m tools.bolthex.flat_washer '<new-output-directory>' --outer-diameter-mm 12 --inner-diameter-mm 6.4 --thickness-mm 1.6
python -B -m unittest tools.tests.test_flat_washer -v
```

Use the existing CAD Python runtime with build123d and meshio, plus the existing
Node runtime and built repository exporter. `--node` can specify its executable.
No package installation, HM launch or solver launch is performed. Output must
not exist and its parent must already exist. A staging directory is cleaned on
failure; the bundle is published only after all checks. Existing output is never
intentionally replaced. Do not concurrently target the same destination.

## Actual checks

1. One valid BRep solid, exactly two concentric cylindrical faces and two
   horizontal annular planes, with actual radii/datums and positive CAD mass
   matching the prescribed dimensions. Recheck after STEP import.
2. Nonduplicate H8, eight distinct references, unique node positions, positive
   determinants at all eight corners, center and eight Gauss points. Integrate
   mesh volume by Gauss quadrature and compare to the exact polygonal annulus.
3. Every boundary face classified exactly once as bottom, top, inner or outer;
   exact expected face counts; closed manifold boundary with Euler zero. The
   canonical tensor-product construction shares whole Q4 interfaces, with no
   hanging nodes or unmatched interior faces.
4. **Every** boundary node and **every** boundary face center measured against
   its associated actual trimmed STEP face. Limits remain node `2e-6 mm`, face
   center `.02 mm`, relative source-BRep/mesh volume `1e-4`. Every cell center
   must be inside actual CAD material and the axial bore must remain void.
5. Native K writer and native parser roundtrip; separate Python K readback;
   independent meshio Abaqus readback. Exact connectivity/ownership is checked,
   coordinate difference is at most `1e-10 mm`, and positive Jacobian/topology
   and source-volume gates are rerun on readback coordinates. Source-distance
   upper bounds include coordinate serialization error.

Finite samples are not a whole-element positive-Jacobian certificate or a full
Hausdorff proof. Chordal inner faces extend slightly into the analytic bore;
that is measured linear discretization, not a silently enlarged bore or altered
design. The mesh has no solver material, section, loads, boundary conditions,
preload or contact definitions. K/INP are mesh-only interchange, not runnable
analysis decks or convergence evidence.

## Deliverables and native handoff

The bundle has only `model.step`, `model.k`, `model.inp`, `cad-report.json` and
`report.json`. JSON records retain dimensions, seeds, raw metrics, per-face
association distances, volume checks, native/independent readback results and
SHA256 hashes. `cad-report.json` binds `matchedMeshVerified` to this exact
`matchedKSHA256` and its readback volume. This flag describes the explicitly
listed geometry checks, not native HM verification or solver acceptance.

`nativeHmVerified`, `solverVerified` and `engineeringQualityAccepted` remain
false. Main can independently import/save/reopen the STEP and K in HM using
these reports; this worker does not run that step. No other fastener family or
original Screw completion is implied by this complete custom washer geometry.

The additional288/11/6seed case has19008H8/24192nodes. The2026-11-07 native
HM comparison retained those mesh entities but failed the separate exported
STEP geometry budget in both tested writer modes. See
[native HM policy and measured failures](NATIVE_HM_POLICY.md). Neither the
source CAD/H8 success nor IGES surface success promotes that HM to complete
geometry/volume acceptance.
