# Optional Elastic Patch Verification

This is supplemental developer verification. It is NOT required for mesh
generation, CAD/HM export, GUI retry or mesh-only release. Commercial solver
licensing cannot be used as a reason to block those features.

## Scope

`tools.bolthex.r11_affine_patch.build_case` prepares a fresh synthetic
linear-elastic constant-strain case from a complete mesh-only K file. It does
not alter the original or replace existing physical cards. All external
boundary DOFs are prescribed from the affine field; interior DOFs remain
free. Synthetic elastic constants/density are explicitly not material
calibration, real fastener contact, friction or preload.

R11 keyword fields were checked against the local manual: CONTROL12-284/312,
BOUNDARY5-47 and DATABASE14-5/86. PyDYNA independently reads prepared geometry,
motion/history fields and the declared physics cards. `run_case` is an opt-in
Windows process diagnostic with scoped licensing/time/memory/disk controls.
A normal process exit alone never marks the numerical patch verified.

`tools.bolthex.skfem_affine_patch.verify_case` uses the optional
[scikit-fem](https://github.com/kinnala/scikit-fem)12.0.2 backend and SciPy.
No private or commercial mesher is used. Backend local vertex order is derived
from its actual Hex1 reference coordinates. The full source geometry and
reference hashes are checked, and the boundary/interior split is recomputed
rather than trusting a supplied all-fixed-node mask.

Only boundary values enter the prescribed vector. Interior initial values
are zero; the stiffness system actually solves those unknowns. All nodal
displacements, all Gauss-point stresses, elastic energy, free-DOF equilibrium
and stiffness symmetry are compared with the analytical field. The1e-8
relative tolerance is a declared double-precision benchmark tolerance, not a
mesh-quality, manufacturing or vendor standard.

## Actual Complete Case

The saved analytical shared joint, not a cut-out patch, has53592H8,
56704nodes and152754free interior DOFs. The independent backend completed in
about119seconds (about136seconds including preparation), with approximately
4.00GB peak resident memory for the bounded worker.

| Comparison | Relative error |
| --- | --- |
| Maximum nodal displacement |4.44e-14|
| Free-DOF equilibrium |9.08e-14|
| Elastic energy |3.98e-15|
| All Gauss-point stresses |8.94e-13|
| Stiffness symmetry |1.58e-16|

The original K remains unchanged. Independent meshio readback of the paired
full INP retains exact connectivity and has maximum coordinate serialization
difference5.01e-13mm. That readback is not an Abaqus solve.

The attempted local R11 process did not reach model analysis because of its
license startup problem. It is NOT marked passed. The user's installed
ANSYS2022R2/LS-Run is the preferred future commercial-solver route; it was not
needed or used to generate these meshes. No licensing service was modified.

Local evidence stays under
`F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm/r11-quality`.
`complete-joint53592-v1/skfem-result.json` and `full-joint-run-v1.json` bind
the measured result and resource use. Failed startup/early development runs
remain clearly separate from the successful independent-engine result.

The optional backend installation added only scikit-fem; existing NumPy,
SciPy,Pydantic,MCP and HTTPX versions were unchanged. No new virtual environment
or mandatory product dependency was introduced.
