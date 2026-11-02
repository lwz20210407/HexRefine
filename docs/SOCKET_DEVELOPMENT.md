# Socket bolt development evidence

Date: 2026-11-02. This is a bounded M6-1 L12 development implementation,
not a claim of stress convergence, standards compliance or full CAD acceptance.

## Implementation

- `tools/bolthex/cad_socket.py`: discover the real axis-crossing CAD floor;
  terminate the filled shaft/lower-head core there; continue a shared head
  annulus above the floor. The driver recess is a void, not filled material.
- `cad_mesh.py`: saved STEP intersections support height-dependent solid vs
  annular sections. Unverified socket/runout/graded-core combinations reject.
- `socket_dev.py`: complete feature fixture is the default. `smoke` is only
  a topology/IO regression, not the primary user-facing representative mesh.
- `hypermesh_native.py --development-only`: requires exact source hashes,
  bounded profile, independent CAD and positive quality. It explicitly does
  not certify strict CAD matching or CAD association. Production gates remain.

## Actual representative result

| Measurement | Result |
| --- | --- |
| H8 / nodes | 160,704 / 169,939 |
| K / INP | 22,703,695 / 20,047,857 bytes |
| Corner scaled Jacobian minimum | 0.2884003798 |
| Gauss Jacobian minimum | 0.000046049886 |
| Nonmanifold faces / boundary edges | 0 / 0 |
| Boundary Euler characteristic | 2 |
| Mesh volume / independent discrete boundary integral | relative difference 3.25e-16 |
| CAD/mesh volume difference | 0.00162662578 relative = 0.162662578%: FAIL strict 1e-4 limit |
| Axial intervals / pitch | 16, spacing 0.0625 mm |
| Measured axial pitch / crest width at zero degrees | 1 / 0.125 mm |
| Mesh sampled major / root diameter | 6.0005899903 / 4.9174682304 mm |
| Driver socket across flats / corners | 5 / 5.7735026919 mm |
| Driver socket depth | 3 mm |
| Recess floor area vs CAD | relative difference 1.18e-13 |
| Sampled axial tooth polyline radial error | maximum 0.0227343 mm at 0/30/60/90 degree probes |

Native HM contains 160,704 H8, 172 surfaces and one solid. Save/clear/reopen
preserves mesh coordinates, connectivity and source PID1. No CAD association
or solver validation is claimed. Its API CAD bounds differ by 0.00722474 mm,
so `cadBoundsVerified=false`, `strictCadMeshMatchingVerified=false`.

A separate native CAD STEP export shows that the host bounds API is not the
same as exact BRep bounds. Nevertheless, actual geometry exchange also drifts:
source volume 699.71961988 vs native-export volume 699.67152214 mm^3, about
6.87e-5 relative, and maximum BRep bounding-coordinate drift about 0.000483 mm.
Do not describe this as verified exact CAD preservation. Import/export accuracy
and strict socket FE fidelity remain open work, separate from H8 validity.

## Reproduction

Use the existing CAD Python environment with build123d/OCP and meshio and an
explicit Node executable. `fixtures/socket-M6` must contain independent
`model.step` and its hash-bound `cad-report.json`. Output must be a new directory.

```powershell
python -B -m tools.bolthex.socket_dev FIXTURES NEW_OUTPUT --node NODE --profile feature
python -B -m tools.bolthex.socket_dev FIXTURES EXISTING_OUTPUT --measure-only
```

`--measure-only` checks source hashes and reads the existing INP without a new
large generation. It writes separate `feature-resolution.json` evidence.
The feature profile caps generation at 200,000 H8 / 64 MiB artifacts; native
transfer caps its K at 32 MiB. Smoke caps at 10,000 H8 / 2 MiB. Neither mode
relaxes corner SJ >=0.15 or positive Gauss Jacobians. Fidelity acceptance
retains CAD-volume <=1e-4, node witness <=2e-6 mm and face probes <=0.02 mm.

Local evidence root (not versioned binary fixtures):
`F:/PythonWoking/temp/20261102-bolthex-thread-study/socket-local`.
It contains `socket-feature-model`, `socket-feature-hm`, actual LSPP PNGs,
native geometry diagnostics and REVIEW.html. Large meshes remain outside Git.

Tests for this increment: `unittest discover -s tools/tests -v` reports 58
tests, 51 passed and 7 optional skips (4.34 seconds). With saved CAD explicitly
selected, all four `tools.tests.test_cad_socket` tests pass (21.21 seconds).
An earlier whole-suite run encountered a Windows status-file rename access
error in the unrelated native-job test; two subsequent complete runs passed.
This intermittent host-file issue is retained in local logs, not described as
a socket-mesher failure or silently removed. Full TypeScript and slow eight-CAD
construction suites were not run during this socket increment.

## Remaining work

1. Improve local thread/fillet boundary representation without blanket extreme
   whole-body refinement, and rerun unchanged CAD fidelity gates.
2. Diagnose native CAD translation tolerances independently of coarse host
   bounding-box reporting; do not change global installed translator settings.
3. Extend tested sizes, runouts and recessed families, then blind caps and GUI.

No claim that the above closes the whole fastener TODO.
