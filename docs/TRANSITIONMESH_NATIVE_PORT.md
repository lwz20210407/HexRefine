# TransitionMesh Native Port Checkpoint

Date: 2026-11-20

## Source Provenance

The public `IY724/TransitionMesh` repository was downloaded into the dated
research directory:

```text
F:/PythonWoking/temp/20261120-transitionmesh-port/TransitionMesh
```

Frozen source commit:

```text
38850881db802e6d49e34905e81430cdbbc78107
```

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

The `AXIAL_SURFACE` check passes with a half-ring-prepartitioned cylinder, but
its Apply path still fails in the plug-in's axial column generation with a
`NoneType` result. No CAE/INP is marked successful for that mode. The failure
is retained rather than replaced by the earlier planning-only pass.

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
3. Port the pure rectangular-ring and annular-sector topology constructors,
   including corner templates, into the offline HexRefine path.
4. Add the cylindrical radial and axial frame planners without Abaqus
   geometry dependencies, then compare their plans against the CAE runs.
5. Only after those checks, connect the pure planner to the HexRefine GUI and
   existing LS-DYNA K writer.

No claim is made yet that the five Abaqus modes have been fully reproduced or
that the new pure planner can independently generate all five final meshes.
