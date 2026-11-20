# TransitionMesh Native Port Checkpoint

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
340/228 for PLANAR_QUAD_FOUR, 112/36 for ANNULAR_RADIAL, and 1296/792 for
the rejected AXIAL_SURFACE diagnostic (nodes/elements). The HTML and PNG are
generated from these actual INP files, not from the planning reports. The
AXIAL candidate is rejected because its z-layer distribution and mapped
transition shape do not match the intended fine/transition/coarse axial
workflow, despite passing native count readback. Mesh-only LS-DYNA K files
were also generated from the same INP connectivity: Q4 cases use
`*ELEMENT_SHELL`, and C3D8 cases use `*ELEMENT_SOLID`; they are mesh exchange
files and intentionally do not claim material/section solver completeness.

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
4. Add a complete cylindrical radial/axial mapped H8 generator without Abaqus
   geometry dependencies, then compare its plans and element connectivity
   against the CAE runs.
5. Only after those checks, connect the pure planner to the HexRefine GUI and
   existing LS-DYNA K writer.

The V1.1 CAE probe now has five actual Apply+Mesh cases and five real INP/K
outputs; the HTML/PNG review is generated from those files. This validates the
author's Abaqus workflow on the local compatibility fixture, not byte-level
identity with the author's private/reference models. The pure offline port is
still partial: rules and one-period Q4 templates are complete, while full
corner-ring and cylindrical H8 geometry generation remain open.
