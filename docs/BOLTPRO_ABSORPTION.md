# BoltPro recovery and independently implemented planning primitives

Date: 2026-11-04. Branch: codex/bolt-thread-native.

Later on the same day, a separate repository-native assembly backend was
implemented and verified. It no longer needs the private recovered core used
in the historical experiment below. See NATIVE_JOINT_BACKEND.md for its bounded
scope, actual K/INP results and remaining GUI/CAD/family gaps.

## Proven recovery versus integration

The private recovered bolthex_core module now compiles and runs as ordinary
Python source, without the EXE/PYZ runtime. Fifteen comparisons against original
code objects pass: bolts, thread/fade/flare options, nuts, plates, aligned radial
interfaces, shared-node assembly, merged INP and Part/Instance INP. Coordinates,
connectivity, sets and metadata match; writer cases are byte-identical.
This does not mean the GUI, viewer and mesh_job source are fully restored.
The raw decompiler output is retained separately, including its known errors.

Recovered application source stays in the private task directory, not Git.
Only independent mathematical utilities and tests are integrated here.
The local experimental full-joint executor still uses that recovered core;
it is not advertised as a newly integrated universal joint backend.

## Public primitives

```python
from tools.bolthex import JointAxialSpec, plan_joint_axial, AxialEnvelope

plan = plan_joint_axial(JointAxialSpec(
    thread_length=16.1, nut_height=13.1, shank_length=8.2))
assert not plan["axialDimensionsChanged"]
assert plan["seeds"] == {"axialPerPitch": 20, "axialPerPlate": 20}
```

The default uses exact decimal-rational common steps, changes seeds within
explicit budgets and preserves supplied axial dimensions. Explicit
`snap_dimensions` instead reports every dimension change. It is not applied
to existing CAD or meshes automatically. Layer/seed overflow and incompatible
nut/shank/plate intervals explicitly reject before any mesh allocation.

Plans concern axial alignment only. `fullMeshVerified` and
`radialInterfaceVerified` remain false. The compatibility field
`geometryChanged` means axial dimension changes, not CAD boundary equivalence;
the explicit `axialDimensionsChanged`/`boundaryGeometryVerified` fields remove
that ambiguity. A retained 0.2 mm head/plate gap is reported, not silently filled.

`AxialEnvelope` is an immutable, bounded piecewise-linear physical-coordinate
weight. Sampling more layers does not shorten its physical support. It is an
end-profile/taper utility, NOT a 2:1/3:1 mesh count-transition template.

## Actual full-joint tests and rejection

The unchanged reference source joint has 9306 nodes / 8484 H8, minimum corner
SJ 0.455141848, positive Gauss determinants, Euler2 and no nonmanifold boundary.
Ordinary recovered-source INP is byte-identical to the bytecode writer output.

A naive preserved-dimension resampling failed at minSJ 0.119798353. Both bolt
and nut had their worst cell at z=16.0..16.1: a fixed two-layer taper became
physically shorter as axial seeds increased. That candidate is rejected, not
accepted with a lower SJ threshold. Default source recovery is not modified.

The experimental resampling uses a fixed physical envelope, sampled independently
of layer count: (0,1), (15.09375,1), (15.596875,2/3), (16.1,0). Input thread16.1,
nut13.1 and shank8.2 remain unchanged; the boundary field is stated explicitly.
This is a sampled-profile design, NOT an independent CAD fidelity claim.

Result: 48,640 nodes / 45,660 H8, minSJ 0.371646888, minGauss 0.0038253373,
positive volumes, Euler2, zero nonmanifold faces/edges, four PIDs and 4416 shared
nodes. Mesh-only K and both INP modes are exported; the K is about 6.47 MB.
Node K read-back preserves connectivity/PIDs and coordinates within 5e-13 mm;
PyDYNA performs a separate H8 audit. There is no contact/friction/load model,
stress-convergence or standards/tolerance certification.

## Related progress persistence fix

The full regression reproduced a pre-existing Windows access-denied error
replacing status.json. The narrow fix retries only Windows errors 5/32/33,
eight attempts with bounded backoff. It never deletes the old status first.
Tests cover atomic preservation, transient recovery, persistent rejection and
non-Windows/unclassified errors. This is not a general permissions workaround.

Full Python suite: 106 tests, 95 passed and 11 optional skips; no full TS or
slow eight-CAD rebuild was run. Earlier failed logs are retained. This run also
includes pre-existing uncommitted helical-band tests; those files are not staged
or claimed as newly implemented by this task.

## Local evidence

F:/PythonWoking/temp/20261104-boltpro-comparison holds recovered source, bytecode
evidence, 15-case matrix, rejected-case diagnostics, K/INP, actual LSPP PNG,
independent audit and REVIEW.html. The task preserves original EXEs, licences
and pre-existing Git changes. Raw recovered application code is not published.
