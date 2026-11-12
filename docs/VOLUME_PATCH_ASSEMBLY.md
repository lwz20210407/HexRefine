# Full-Source Volume Patch Assembly

`tools.bolthex.volume_patch_assembly` installs explicit H8 macro connectivity
into **all rows** of the supplied source mesh. It is not a reference-box-only
template audit and does not automatically certify engineering acceptance.

`assemble_patch` accepts removed EIDs, literal replacement NIDs/PIDs, new
interior nodes, explicitly moved old nodes and a complete prescribed outward
Q4 boundary. Existing cells touched by a moved node must belong to an explicit
allowed geometry scope. Every surviving touched neighbour is quality-checked,
even if it is not being replaced. This prevents hiding the known224-cell
head morph behind a2-cell macro.

The installer preserves all protected coordinate/reference rows, old EIDs
and PIDs. It reuses removed EIDs deterministically and allocates additional
EIDs above the original maximum. New NIDs cannot collide with old rows.
Complete old attachment partitions with surviving owners remain mandatory;
only caller-prescribed free/interface changes can alter the other boundaries.
No coordinate welding is performed. Non-H8 input cards reject, rather than
silently disappearing from the NODE/SOLID delivery.

Checks include target boundary equality and orientation, preserved attachment
faces, closed boundary edges, duplicate elements, face ownership/orientation,
positive corner/centre/Gauss Jacobians throughout the new and moved region,
and cell-volume sum against independent bilinear-boundary divergence flux
(relative error<=1e-4). An optional explicit caller SJ floor adds a check;
no arbitrary vendor-wide floor is invented. Positivity alone is not an
engineering quality standard. `require_continuous_jacobian=True` additionally
requires an exact-rational Bernstein certificate for every new/moved-region
cell. This is regional, not a certificate for inherited protected defects.
Geometric overlap and globally coincident/different-NID source interfaces
remain separate gates and are explicitly not certified by the installer.

`write_candidate_pair` runs that whole-source assembly and exports a bounded
K/INP pair to a fresh directory. The exact byte snapshots whose hashes will
be published are independently parsed: K preserves NID/EID/PID/eight slots;
INP retains labels through the existing meshio/label-sidecar reader. INP has
no LS-DYNA PID assertion. Output files and pending-report bytes are checked
again immediately before exclusive receipt publication. The files and receipt
remain **candidate-only**; there is no switch to call them accepted full Screw.

The integer-coordinate truncation and after-writer/before-first-hash fault
found in review have regression tests. Output card counts are recomputed.
Temporary parsing snapshots are task-owned and removed after verification.
Original source objects and existing output paths are never overwritten.

## Verification Scope

- An interior8-node /7-H8 macro preserving all6coarse boundary quads is
  assembled, with stable identities, positive samples and volume preservation.
- A surviving adjacent cell retains its literal connectivity and PID.
- The actual6128-row Screw input and224-cell rejected head morph are loaded:
  the installer rejects bad moved neighbours, not merely checks the two local
  replacement cells. No failing Screw K/INP is emitted by this test.
- Candidate K/INP snapshots, publication mutation, missing boundaries,
  forbidden geometry scope, integer input, invalid node records and other
  element-type loss are tested separately.

Run with the existing CAD Python and explicit task scratch:

```powershell
$env:VOLUME_PATCH_TEST_ROOT = '<existing dated task scratch>'
$env:HEAD_PATCH_CAVITY = '<actual ten-quad-cavity-spec.json>'
python -B -m unittest tools.tests.test_volume_patch_assembly -v
```

These controls establish the installation/IO path. They do NOT solve the
actual10Q interior-node macro, neck material partition or complete Screw
mesh by themselves. No reference-box result is advertised as a real Screw.
