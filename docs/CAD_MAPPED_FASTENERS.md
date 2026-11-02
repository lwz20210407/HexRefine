# Independent CAD to mapped H8 fasteners

The CAD is generated from design parameters and saved **before** finite-element
seeding. `tools/bolthex/cad_mesh.py` imports that STEP and intersects its actual
trimmed BRep faces. It does not reconstruct CAD from mesh sections or apply the
legacy thread formula to a different standard-library shape.

## Runtime boundaries

- Optional CAD runtime: build123d 0.11.1, bd_warehouse 0.3.0, meshio 5.3.5.
- Python H8 topology reuses the authorized recovered O-grid section primitives.
- Node export reuses the main project's strict fixed-field LS-DYNA formatters.
- Independent K read-back uses ansys-dyna-core and a separate H8 audit.
- Native HM requires installed/licensed HyperMesh. K/INP/STEP generation does not
  require HyperMesh, MATLAB, TrueGrid, Abaqus or the original BoltHex executable.
- This is a CLI/Python implementation, not a completed GUI or TypeScript port.

## Workflow

1. `python -B -m tools.bolthex.standard_cad generate request.json NEW_CAD_DIR`
2. `python -B -m tools.bolthex.cad_mesh_pipeline CAD_DIR NEW_MESH_DIR --node NODE_EXE --seeds seeds.json`
3. In the PyDYNA runtime:
   `python -B -m tools.bolthex.validate_cad_k MESH_DIR`
4. `python -B tools/hypermesh_native.py MESH_DIR/model.k MESH_DIR/report.json NEW_HM_DIR --hmbatch HMBATCH_EXE --cad MESH_DIR/model.step --cad-report MESH_DIR/cad-report.json`

Output parents must exist. Existing output directories are refused. Rejected
mesh/geometry candidates are not published as accepted bundles. The mesh bundle
contains `model.step`, mesh-only `model.k`, mesh-only `model.inp`, and certificates.
No materials, contacts, loads, tolerance-class fit or completed solver model are
invented by these mesh exporters.

## Supported construction

- Metric external-hex full-thread bolts: O-grid shaft plus a conforming head
  annulus. The head/shaft interface shares nodes by canonical coordinates.
- Metric open hex nuts: mapped radial quad section swept through CAD sections.
- `thread_ends: "library"` retains the original library design. For hex nuts,
  the optional **separate design** `thread_ends: "square"` creates a full-through
  thread from the same nominal dimensions. It is not a repair/replacement of an
  existing faded-end STEP and must not be presented as that case passing.
- `z_features` in mesh seeds retains additional explicit axial feature planes.
  It does not make a radial graph capable of arbitrary reentrant topology.

Example design and seeding for the accepted through-thread nut:

```json
{"family":"hex_nut","standard":"iso4032","size":"M6-1","thread_ends":"square"}
```

```json
{"sector":32,"core_rings":2,"radial":6,"per_pitch":64,"head":24}
```

The bolt validation uses ISO4017 M6-1, L12, right hand, and radial=5 with the
other seed values above. These dimensions are upstream nominal table values,
not independently certified ISO/GB limit dimensions.

## Acceptance contract

The **CAD exchange** relative volume tolerance is 1e-7, explicitly approved by
the user on 2026-11-02. This replaces the earlier 1e-8 CAD-only round-trip gate.
The following **mesh** requirements were not relaxed:

- Mesh/CAD relative volume error <=1e-4.
- Minimum corner scaled Jacobian >=0.15; positive Gauss determinants/volumes.
- Eight distinct referenced nodes per H8; no duplicate elements or nonmanifold
  faces/edges; expected closed boundary Euler characteristic.
- Side nodes use CAD intersection witnesses, with solid-classifier bisection
  and a <=2e-6 mm trimmed-face check when the curve/face solver misses a seam.
- Every boundary-face centre is checked. Radial discrepancy is a conservative
  distance bound; steep-flank exceptions use actual trimmed-face distance with
  the same 0.02 mm limit. Raw radial discrepancies remain recorded separately.
- 256 additional boundary-node trimmed-face distance witnesses <=2e-6 mm.
  These finite probes are not a rigorous whole-surface Hausdorff certificate.
- INP is independently re-read by meshio with connectivity equality and <=1e-8
  coordinate error. K is independently imported and audited by PyDYNA.

The mapped sweep boundary volume is independently integrated before/against
the interior H8 Gauss volume. A valid mesh alone does not prove the right CAD
or the right refinement pattern was generated.

## Native HM semantics

The HM must contain real CAD surfaces/solids plus H8 elements, not just a renamed
mesh file. The exporter binds matching to the exact K and STEP SHA-256 hashes,
checks geometric bounds, saves, clears and reopens the database, then compares
canonical complete mesh-data SHA-256 fingerprints. Selection marks are not part
of the FE data fingerprint. CAD bounds are compared numerically to 1e-5 mm,
not by floating-point string spelling.

Automatic association is disabled by default to avoid snapping. Its count is
reported as unknown/not audited in that mode, **not falsely reported as zero**.
Having matched CAD and mesh together is distinct from a certified no-motion
node/face association workflow. An exact, hash-bound previous PyDYNA audit can
be reused for preflight; it never substitutes a different K or lowers quality.

CAD component IDs are moved above the source FE PID range before K import.
This prevents geometry components from silently renumbering source PID 1 to 2.
The native fingerprint validates the allowed FE part IDs as well as complete
coordinates/connectivity. Native duplicate keyword export is optional via
`--native-k-export`: the already validated K bundle is the normal delivery,
and native save/reopen SHA checks do not require writing another giant K.

## Known gaps

- The original library-faded M8 nut still fails local face-distance validation
  around its runout. It is not accepted merely because volume and SJ pass.
- Socket recesses, blind domes, drill tips and arbitrary CAD require different
  block topology; this mapper refuses those families.
- Near-thread 2:1/3:1 count reduction and coarse interior planning are unfinished.
  The M6 bolt fidelity case currently has about 3.58 million H8 cells and is a
  heavy validation case, not an optimized production meshing recommendation.
- Large-HM transport performance must be tracked separately from K/INP/CAD
  matching. A small HM smoke test is never a substitute for the full specimen.
- GUI, complete upstream example ports, standards editions and fit tolerances
  remain tracked in `FASTENER_DEVELOPMENT_TODO.md`.
