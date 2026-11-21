# TransitionMesh Native Port Checkpoint

## V1.1 Three-Stage CAE Validation

All five modes were generated in Abaqus/CAE 2020 with the V1.1 Python 2
compatibility adapter and independently in the native Python backend.
Both reference and native K geometry were read back. Abaqus INP
coordinates and connectivity were also checked against the CAE part.

| Validated fixture | Fine to coarse ports | Abaqus 2020 / Python cells |
| --- | --- | --- |
| AXIAL 2:1 x3 | 64 / 32 / 16 / 8 | 688 / 736 H8 |
| AXIAL 3:1 x3 | 108 / 36 / 12 / 4 | 1504 / 1504 H8 |
| PLANAR 2:1 x3 | 48 / 24 / 12 / 6 | 126 / 126 Q4 |
| PLANAR_ANNULAR 2:1 x3 | 128 / 64 / 32 / 16 | 336 / 336 Q4 |
| PLANAR_QUAD_FOUR 2:1 x3 | 16x12 / 10x8 / 8x6 / 6x6 | 260 / 260 Q4 |
| ANNULAR_RADIAL 2:1 x3 | 128 / 64 / 32 / 16 | 672 / 672 H8 |

The two axial references use four azimuthal quadrants, radii 4 and 7,
two wall layers, length 12, and transition planes at z = 2, 3, 5, 8.
The shared H8 face counts at the four planes are 128/64/32/16 and
216/72/24/8. Each shared face has one cell on each side. The minimum
corner scaled Jacobians are 0.30619/0.44474 (Abaqus/Python) for 2:1
and 0.26852/0.27046 for 3:1. All sampled determinants are positive.
The 2:1 Abaqus free sweep uses a different internal cell layout; its
faceted volume differs by 0.36422% from the native mesh.

The first half-ring axial attempts exported inverted corner samples
(10 and 20 H8 respectively) even though the interface counts matched.
They were rejected and kept as diagnostics, not accepted by relaxing a
threshold. A supplemental three-stage rectangular 3:1 CAE free-quad
fixture also has a zero corner Jacobian and is not a passing reference;
its native counterpart has positive samples and matching interface counts.

Local CAE, INP/K, rendered mesh views and measurements:
`F:/PythonWoking/temp/20261121-transitionmesh-three-stage/review/REVIEW.html`.

## V1.1 Multistage Geometry

The native constructors now generate multiple conforming stages:

- `build_axial_cylinder(..., stages=2, stage_widths=[...])` retains regular
  end regions and sweeps through the wall. Its cascade 2:1 motif has six
  Q4 per sector (one axial seam interval), unlike the standalone 2:1 motif
  with eight Q4. The audit reports the measured shared-face count at
  every level plus center, corner and Gauss minima by region.
- `build_planar_band` and `build_annular_band` accept stages, stage widths
  and ratio sequences. Within-stage hybrid remains single-stage only.
- `build_radial_band` takes explicit stage radii and an independent
  through-length layer count, with identical port node IDs across stages.
- `build_rectangular_ring` supports repeated 2:1 with parity collars and
  repeated 3:1 with inherited corner segments. The 3:1 construction is
  a conforming alternative to the upstream Abaqus free-quad interior.

| Two-stage fixture | Level counts | Abaqus 2020 / Python cells |
| --- | --- | --- |
| AXIAL 2:1 twice | 48 / 24 / 12 | 432 / 432 H8 |
| AXIAL 3:1 twice | 54 / 18 / 6 | 420 / 420 H8 |
| PLANAR | 24 / 12 / 6 | 54 / 54 Q4 |
| PLANAR_ANNULAR | 48 / 24 / 12 | 108 / 108 Q4 |
| PLANAR_QUAD_FOUR 2:1 twice | 16x12 / 10x8 / 8x6 | 184 / 184 Q4 |
| PLANAR_QUAD_FOUR 3:1 twice | 18x18 / 8x8 / 4x4 | 201 / 140 Q4 |
| ANNULAR_RADIAL | 64 / 32 / 16 | 288 / 288 H8 |

All seven comparisons check facet incidence at each stage, reject
unmatched interior facets, and sample Jacobians in each band. Both
axial cases have two wall layers, with shared face counts 96/48/24 and
108/36/12. The older single-stage radial side-wall screenshot differed
because the preview sorted by global Z instead of camera depth: the
two decks have identical reindexed boundary and H8 connectivity and
maximum node displacement below 6.9e-7 model units.

The CAE, K, INP, depth-buffer renders and measured checks are retained in
`F:/PythonWoking/temp/20261121-transitionmesh-multistage/review/REVIEW.html`.
The 2:1 radial fixture uses four 90-degree sectors and 64 initial segments
so each quadrant contains whole 4-to-2 periods at *both* stages. A
48-segment attempt is preserved as a negative CAE test, not a pass.
Regression tests also build three-stage native geometry; arbitrary CAD
selection, prior-mesh preservation, and the full CAE option matrix are
outside this validation.

## V1.1 Rebuild And Differential Check

2026-11-21. This section supersedes the AXIAL results and the native
coverage claims in the historical checkpoint below. The [V1.1 release
asset](https://github.com/IY724/TransitionMesh/releases/tag/v1.1), not its
source tag or the V1.0 README image, was unpacked afresh. Its SHA-256 is
`a7b80554bf5a4ef1e1388d796fdd2706be6367d91604e8ae3cdb706e3542a221`.
The author package and the temporary Python 2 compatibility adapters are
not vendored. HexRefine's implementation requires neither Abaqus nor the
author package.

| Mode | V1.1 application path | Native single-stage equivalent | Abaqus / native elements |
| --- | --- | --- | --- |
| PLANAR | GUI dispatcher and planar sketch partition | `build_planar_band` | 24 Q4 |
| PLANAR hybrid, both orders | V1.1 block splitter and one-sketch partition | `hybrid_split` and `build_planar_band` | 20 Q4 each |
| PLANAR_ANNULAR | `apply_planar_annular_transition` | `build_annular_band` | 48 Q4 |
| PLANAR_QUAD_FOUR | `transition_mesh_quad2_cae.apply`, corner wedges | `build_rectangular_ring` | 96 Q4 |
| ANNULAR_RADIAL | `apply_annular_radial_transition` | `build_annular_band` then `extrude_band` | 72 H8 |
| AXIAL_SURFACE | `apply_cylindrical_axial_transition`, radial sweep | `build_axial_cylinder` | 672 / 252 / 19,440 H8 for the three count pairs below |

The 48-to-24 axial case uses eight Q4 per four-fine/two-coarse sector, not
the six Q4 from the planar template. The 36-to-12 and 180-to-60 cases use
four Q4 per three-fine/one-coarse sector. The first-sector boundary-anchored
graphs match the Abaqus reference. Both shared axial interfaces are counted
from H8 connectivity, and missing interior faces are rejected. Center,
eight corner and eight Gauss point Jacobians are sampled, not inferred from
a count or an application success flag.

The unmodified geometry audit in Abaqus 2020 rejects 180-to-60 because it
reads one exactly seeded three-segment arc as 3.00000170623. The experiment
retained that failure and then used a separate 0.0001-degree arc-angle
roundoff allowance, retaining exact integer seed and mesh node checks.
That exported Abaqus mesh has 24 H8 with non-positive corner Jacobians,
so it is **not** an accepted reference mesh. The native fixture has
positive sampled Jacobians with minimum corner scaled Jacobian 0.269.
This finding is scoped to the locally constructed Abaqus 2020 fixture.

Side-by-side renders, input files, CAE snapshots, implementation route
mapping, and machine-readable verdicts are in the dated local evidence:

```text
F:/PythonWoking/temp/20261121-transitionmesh-v11-rebuild/review/REVIEW.html
F:/PythonWoking/temp/20261121-transitionmesh-v11-rebuild/review/comparison.json
```

CAD picks and edge Sets, arbitrary CAD partitioning and preservation of
existing Abaqus controls are not claimed. This historical section covers
the one-stage fixtures; see the multistage section for later validation.

## Historical Checkpoint

Date: 2026-11-20

## Source Provenance

The public `IY724/TransitionMesh` repository and its V1.1 release package
were downloaded into the dated research directory:

```text
F:/PythonWoking/temp/20261120-transitionmesh-port/TransitionMesh
```

Frozen source commit:

```text
38850881db802e6d49e34905e81430cdbbc78107
```

V1.1 release asset checked during this task:

```text
TransitionMesh-v1.1.zip
SHA256 A7B80554BF5A4EF1E1388D796FDD2706BE6367D91604E8AE3CDB706E3542A221
```

The repository tag still points to the same commit, while the V1.1 release
package carries the newly published behavior. The latest CAE probes below
use the extracted V1.1 package.

The upstream plug-in is an Abaqus/CAE Python plug-in. Its planning modules
are pure Python, while its geometry and mesh application modules depend on
Abaqus objects. The HexRefine port therefore starts with an independent,
small pure-Python planning implementation rather than copying Abaqus code or
pretending that Abaqus objects are available offline.

## Implemented In HexRefine

`tools/transitionmesh_native/planner.py` currently implements:

- 2:1 and 3:1 count chains;
- repeated and mixed ratio sequences;
- multi-layer divisibility and nearby-count rejection;
- stage-width allocation and cumulative boundaries;
- rectangular four-side count chains with corner contributions;
- PLANAR-only hybrid 2:1-pair and 3:1 group splitting;
- cylindrical angular seam-fit diagnostics;
- single-period 2:1 and 3:1 Q4 transition templates, tiled-strip generation,
  positive-area and area-conservation audits;
- a structured pure-Python cylindrical `AXIAL_SURFACE` H8 generator with
  explicit fine/transition/coarse regions, 4-to-2 and 3-to-1 angular template
  tiling, and radial extrusion;
- mesh-only LS-DYNA `*NODE`/`*ELEMENT_SOLID` and Abaqus C3D8R writers in
  `tools/transitionmesh_native/mesh_io.py`;
- capability and precondition reporting for all five upstream modes:
  `PLANAR`, `PLANAR_ANNULAR`, `PLANAR_QUAD_FOUR`, `ANNULAR_RADIAL`, and
  `AXIAL_SURFACE`.

The module uses only the Python standard library and is written to remain
compatible with Abaqus 2020's Python 2.7 as well as normal Python 3. The
focused test suite is in `tools/tests/test_transitionmesh_native.py`.

The pure planner was differentially compared with the frozen upstream
`transition_mesh_plan.py` and `transition_mesh_rules.py` for repeated 2:1 and
3:1 chains, four-side chains, and valid/invalid hybrid cases. The normalized
planning results were identical for all cases in
`F:/PythonWoking/temp/20261120-transitionmesh-port/planner-differential.json`.

## Abaqus Runtime Probe

The local machine currently exposes only:

```text
E:/SIMULIA/Commands/abq2020.bat
Abaqus 2020
```

No `abq2022.bat` or `abq2025.bat` was found in the inspected installation
locations. The probe
`F:/PythonWoking/temp/20261120-transitionmesh-port/abaqus_plan_probe.py`
loaded the HexRefine pure planner inside the Abaqus 2020 `cae noGUI` runtime
and produced:

```text
F:/PythonWoking/temp/20261120-transitionmesh-port/abaqus2020-planning-probe.json
```

All five mode planning cases passed. This is an interpreter-compatibility and
rule-planning result only. It does not certify Abaqus partition, seed, sweep,
or final element generation.

## Abaqus 2020 CAE Apply Probe

After a local Python-2.7 compatibility shim in the research copy (without
changing the upstream download), fresh Abaqus Part objects were used for
`CHECK_ONLY` and `PARTITION_SEED_MESH` attempts. The current apply receipt is:

```text
F:/PythonWoking/temp/20261120-transitionmesh-port/applied/abaqus2020-apply-probe.json
```

The following modes completed real Abaqus partition/seed/mesh operations and
saved CAE snapshots:

- `PLANAR` 2:1, two layers;
- `PLANAR_ANNULAR` 3:1;
- `PLANAR_QUAD_FOUR` 2:1;
- `ANNULAR_RADIAL` 2:1 on a half-ring-prepartitioned hollow cylinder.

The V1.1 `AXIAL_SURFACE` Apply path now passes on a half-ring-prepartitioned
hollow cylinder after supplying the correct radial end-face sweep path. The
verified case uses 2:1, `Seeds=48`, coarse-side 24 segments, and 12 axial
slice sectors. The earlier `Generated 0 elements` result was caused by using
longitudinal generator edges as the sweep path and is retained as a negative
diagnostic, not as the final result.

The four successful V1.1 INPs and the HTML/PNG overview are in:

```text
F:/PythonWoking/temp/20261120-transitionmesh-port/Job_APPLY_*.inp
F:/PythonWoking/temp/20261120-transitionmesh-port/review/REVIEW.html
F:/PythonWoking/temp/20261120-transitionmesh-port/review/overview.png
```

The current INP counts are 118/90 for PLANAR, 96/64 for PLANAR_ANNULAR,
340/228 for PLANAR_QUAD_FOUR, and 112/36 for ANNULAR_RADIAL (nodes/elements).
The first Abaqus AXIAL fixture (1296/792) is retained as a rejected diagnostic:
it was readable, but its z-layer distribution and mapped transition shape did
not match the intended fine/transition/coarse axial workflow. It is not a
passing result merely because the counters matched.

The corrected pure-Python axial evidence is in:

```text
F:/PythonWoking/temp/20261120-transitionmesh-port/review/
  AXIAL_SURFACE_native_2to1.k/.inp/.png
  AXIAL_SURFACE_native_3to1_author_counts.k/.inp/.png
  AXIAL_NATIVE_COMPARE.html
  lspp-native-axial-receipts.json
  lspp-native-axial-gui-receipts.json
```

The 2:1 case uses 48 fine circumferential segments and 24 coarse segments.
The 3:1 case mirrors the author documentation parameters (`Seeds=180`,
`Layers=1`, `Ratio=3:1`) with 60 coarse segments. Both cases use the same
single-period axial strip templates, and both have fine/transition/coarse
interfaces with no face incidence above two. Their nodes/elements are
1620/1008 and 3960/2400 respectively. The LS-PrePost 4.13 MCP receipts show
that both K files opened successfully with those counts.

The author image `docs/images/axial-result.png` is explicitly labelled in the
HTML as a V1.0 documentation asset retained by the V1.1 release; it is not
claimed to be a V1.1 screenshot or a byte-identical reference mesh.

Mesh-only LS-DYNA K files were also generated from the same native
connectivity. The native axial files use `*ELEMENT_SOLID`; they are mesh
exchange files and intentionally do not claim material/section solver
completeness.

The five generated K files were also opened through the local
`lwz20210407/LS-PrePost-MCP` CFILE route on LS-PrePost 4.13. The prepared and
executed job receipts are retained at:

```text
F:/PythonWoking/temp/20261120-transitionmesh-port/lspp-open-receipts.json
```

All five jobs completed with declared node/element counts matching the
corresponding INP-derived K files. The HTML review links this receipt. This is
an LS-PrePost native open/count verification, not solver execution.

## CAE Compatibility Finding

The full plug-in import was also attempted under the only installed CAE
runtime, Abaqus 2020. It fails before model creation because the current
upstream cylindrical kernel contains Python 3-only syntax (`print = ...`),
which Abaqus 2020's Python 2.7 parser rejects. The failure is retained in the
CAE probe log; it is not converted into a mesh failure or hidden by a fallback.
The repository README requires Abaqus/CAE 2024 or later and reports
verification on Abaqus 2025. A real 2022/2025 CAE run therefore remains
blocked by the missing local installations, not by an invented successful
probe.

## Remaining Work

1. Build deterministic Abaqus CAE fixtures for the five modes and invoke the
   public kernel entry points with real Part/Face/Edge/Cell objects.
2. Export the resulting Abaqus INP files and audit element types, counts,
   interface node correspondence, hanging faces, and Jacobian/angle metrics.
3. Port the full rectangular-ring and annular-sector topology constructors,
   including participating corner templates, into the offline HexRefine path.
4. Extend the structured cylindrical H8 generator to full corner and
   multi-layer contracts, then compare its plans and connectivity against CAE.
5. Only after those checks, connect the pure planner to the HexRefine GUI and
   existing LS-DYNA K writer.

The V1.1 CAE probe has five actual Apply+Mesh fixtures and five real INP/K
outputs; the HTML/PNG review is generated from those files. This validates the
author's Abaqus workflow on the local compatibility fixture, not byte-level
identity with the author's private/reference models. The pure offline port is
still partial: rules, one-period Q4 templates, and a corrected one-stage
structured axial H8 generator are complete; full corner-ring and multi-layer
cylindrical geometry generation remain open.
