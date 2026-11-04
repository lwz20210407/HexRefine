# Repository-native analytical joint backend

Date: 2026-11-04. This is a bounded source-tree backend, not completion of the
whole fastener project or desktop distribution. The bounded browser integration
is documented separately in [NATIVE_JOINT_GUI.md](NATIVE_JOINT_GUI.md).

## Runtime and scope

`tools.bolthex.native_joint` assembles existing repository six-sector templates
with a shared physical thread radius field and axial envelope. It does not
load BoltPro/BoltHex EXEs, PYZ/marshal, private restored modules or task folders.
The old repository template source/provenance is retained; this is not a claim
that the entire low-level template library was newly authored here.

Supported: coaxial hex head, open hex nut and zero or multiple rectangular
plates; right/left analytical thread field; bounded shared-node or separate-node assembly.
`connection_mode="shared"` preserves the previous bonded-node default.
`connection_mode="separate"` retains disjoint node IDs across every component
in both K and the assembly INP. Node-ownership intersections are audited and
reported, not inferred from equal coordinates. Separate INP has Part/Instance records but no
cross-part coupling, material, preload, contact or friction model.

This is NOT an independent STEP/BRep matching workflow or standards/tolerance
certification. Its physical-angle thread law and six-sector topology differ
from BoltPro, so original-node parity is not claimed. It supplies no new
2:1/3:1 element-count transition or arbitrary CAD partitioning capability.

## Source-tree interface

```python
from tools.bolthex.native_joint import NativeJointSpec, build_native_joint
from tools.bolthex.joint_seed_plan import JointAxialSpec

result = build_native_joint(NativeJointSpec(axial=JointAxialSpec(
    thread_length=16.1, nut_height=13.1, shank_length=8.2)))
```

CLI request:

```json
{"schemaVersion":1,"parameters":{"axial":{
  "thread_length":16.1,"nut_height":13.1,"shank_length":8.2
}}}
```

```powershell
python -B -m tools.bolthex.native_joint request.json NEW_OUTPUT --node NODE_EXECUTABLE
```

The CLI requires a fresh output directory and a compiled repository `dist/`
for the existing Node keyword formatter. Python needs NumPy; INP read-back
also needs meshio. CAD kernels, MATLAB, TrueGrid and proprietary applications
are not runtime dependencies. The local browser host now supports dispatch,
indeterminate progress, cancellation and audited preview/download. Desktop
packaging and integration with the other fastener backends remain pending.

## Contracts

- Unknown parameters, invalid dimensions/seeds, unsupported handedness and
  incompatible plate footprints reject. Angular sector count must retain exact
  rectangular corners. Root radius must not cross the fixed template core.
- Axial planning preserves requested dimensions through bounded seed
  compensation. Physical taper support is independent of axial seed count.
  A requested 0.2 head/plate gap is reported, never silently closed.
- Element counts are computed and budget-checked before 3D allocation. Default
  budget is 200,000 H8; explicit upper bound is one million. This is not proof
  that every combination inside those bounds has acceptable shape quality.
- Components and merged assembly both pass corner SJ>=0.15, positive Gauss
  Jacobians and boundary checks. Only component boundary nodes are candidates
  for canonical coordinate merging; interior nodes are not globally welded.
- Assembly/component volume difference must be <=1e-10. Four/six PID cases
  are tested. Mesh validity does not establish physical contact equivalence.
- Separate mode concatenates component nodes without coordinate welding and
  rejects any cross-component node-ID intersection. Shared mode reports every
  node-sharing pair. Neither mode defines engineering contact or preload.
- K is mesh-only and read back with the native parser. Merged INP connectivity
  and component ELSETs are verified. Separate INP part blocks are individually
  read back with meshio, and identity Instances are written explicitly.
- INP writer precision is optional; its previous six-decimal default remains.
  This backend uses twelve decimals, hashes outputs and publishes the staged
  directory only after checks. No intermediate JSON transport is retained.

## Actual validation

| Complete case | H8 / nodes | Min corner SJ | Min Gauss determinant |
| --- | --- | --- | --- |
| Default M16-sized analytical design | 10,440 / 11,298 | 0.469421460 | 0.023577542 |
| Preserved dimensions16.1/13.1/8.2 | 53,592 / 56,704 | 0.409479482 | 0.004715508 |

Both have Euler2, zero nonmanifold faces/edges and four PIDs. Independent PyDYNA
K re-audits pass with relative volume differences about 1.5e-15. Twelve-decimal
K/INP coordinate losses are about 5e-13 mm. Four separate part blocks retain
their local connectivity and IDs; the merged component ELSETs retain ownership.
Additional tests cover a smaller M6-sized design, a four-plate stack, left hand,
no plates, incompatible input and allocation budgets. Finite cases are not a
universal meshing guarantee. INPs were not run in an Abaqus solver.

A fresh `python -I` run imports only repository modules and normal dependencies;
none of bolthex_core/mesh_job/app/viewer appears in sys.modules. The native
source-tree path is thus independent of the private restoration experiment.

Local evidence: F:/PythonWoking/temp/20261104-native-joint-backend, including
verified-parts, reference-final, independent-k.log, isolated-import.log, native-joint.png
and REVIEW.html. Cases are modest development models (~7.6 MB K), not repeated
hundreds-of-MB fixtures. Recovered private sources are neither needed nor shipped.

Full current-worktree Python regression:114 tests,103 passed/11 optional skips.
This run included then-uncommitted helical-band tests. That work was subsequently
reviewed and submitted separately; see HELICAL_BAND_REPLAY.md. Full TS and slow
eight-CAD reconstruction suites were not rerun.

## Remaining work

Unified GUI/runtime dispatch and desktop packaging; part selection/offsets and all original
export options; more head/nut/washer families; independent CAD pairing;
standards and tolerances; axial/3D/3:1 count grading; wider failure/performance
coverage. The existing CAD-first mapper remains a separate backend and is not
silently replaced by this analytical generator.
