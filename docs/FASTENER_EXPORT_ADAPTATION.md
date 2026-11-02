# Profile adaptation and native CAD/mesh export

Status: two bounded profile routes and native-format export adapters, not every
upstream feature or GB product family.

## Algorithms integrated

1. `tools/bolthex/femssc_profile.py`: the four-point R-Z tooth construction from
   `kycai/femssc`, pinned at `6cdd6226f701add64af03a36121a0499249b006d`, is adapted
   into a host-independent validated profile. The MIT notice is preserved under
   `vendor_notices/femssc-LICENSE.txt`. Radial phase evaluation and complete-body
   filling are local additions using the recovered O-grid kernel. This does not
   port its complete self-drilling tip, washer or Tie-based FE assembly.
2. `tools/bolthex/rounded_profile.py`: an independent implementation of the
   circular-root external/internal mathematical profiles studied in
   `sunwhale/thread` commit `582da3d8c9ec5ddc7e7d14aa2e32493b7a768a8c`.
   No upstream program is vendored without a confirmed licence. The two original
   scalar sample loops were privately compared: 64 external and 64 internal
   radii match to about 3.6e-15. This does not certify the examples' GB/GJB labels.

Both profile evaluators use true modulo for many-turn and negative phases, and
explicit handedness/starts. Full-body demo factories currently use one start.
They do not inherit the old script's single-subtraction wrap or rounded column
index lookup. The old recovered generator remains regression-tested unchanged.

TrueGrid/Coreform endpoint blocks and arbitrary CAD partition strategies remain
separate future work. Reading their examples is not counted as integration.

## K and INP

```powershell
node scripts/generate-bolthex-demo.mjs NEW_CASE --python PYTHON --case femssc
node scripts/generate-bolthex-demo.mjs NEW_CASE --python PYTHON --case rounded
```

Cases also accept `femssc-left`, `rounded-left`, `plain` and the existing
`original` demo. These are fixed regression cases, not a complete arbitrary
standard/product request interface. K uses the existing strict NODE/SOLID writer,
with separate part IDs and source surfaces in a sidecar. INP retains actual H8
parts, regions and surfaces. Neither path requires HyperMesh, MATLAB or Abaqus.
The INP currently retains the recovered writer's demonstration STEEL material
unless a caller disables it; these values are not a material calibration.

## STEP geometry

```powershell
python -B -m tools.bolthex.export_step CASE/geometry-sections.json NEW_CAD_DIR --mesh-report CASE/report.json
```

This optional backend uses an existing build123d/OpenCASCADE installation. It
constructs, fuses/cuts, checks and reopens actual BRep solid bodies from the same
parameter stations as the mesh. It is **piecewise ruled BRep**, not an exact
smooth analytical helix, not an original author CAD file, and not just an FE
geometry display. The discretization is explicit in the JSON certificate.

The full bolt and nut include thread-shaped boundaries. Solid validity,
positive CAD mass, body count, STEP reopen mass and the discrete mesh-volume
comparison are checked. CAD/FE volume tolerance remains 1e-4; it is not relaxed
after a failure. A smooth analytical-helix backend is still pending.

## Native HM

```powershell
python -B tools/hypermesh_native.py CASE/model.k CASE/report.json NEW_HM_DIR --hmbatch INSTALLED_HMBATCH
python -B tools/hypermesh_native.py CASE/model.k CASE/report.json NEW_HM_DIR --hmbatch INSTALLED_HMBATCH --cad CAD/model.step --cad-report CAD/report.json
```

- Without STEP: native HM contains the H8 mesh and no CAD surfaces/solids.
- With STEP: native HM contains both real CAD solids/surfaces and the matching
  FE mesh. Importing both does **not** automatically mean geometry association.
- Binary HM is written by an installed/licensed HyperMesh, not by renaming
  CMF/Tcl/INP. Tested host: HyperMesh 2022.3.0.24 on this machine.
- The database is saved, cleared and reopened. Bulk snapshots verify node IDs,
  coordinates, element IDs, configuration, connectivity and mesh collectors.
  Only H8 config 208 is accepted. The exported K is independently checked for
  connectivity and PID preservation.
- Source K/STEP hashes and certificates must match. Input models are not
  overwritten; output directories must be new. Runtime Tcl paths are UTF-8 hex
  encoded to prevent path characters becoming Tcl commands.
- Default export deliberately preserves coordinates and makes no associations.
  On the tested 2022.3 host, `--associate` shifted some coordinates by about
  1e-7 despite `snap_nodes=0`; strict snapshots rejected those runs. This option
  is diagnostic/conditional, not promoted as a verified no-motion feature.

Association only considers independently identified boundary nodes. There is no
implicit cross-part node merge, solver contact or material inference. Host logs
may contain vendor licensing diagnostics and must remain private, not be added
to Git or public review artefacts.

## Evidence and boundaries

The two complete demo pairs each have 36,528 H8s. Independently read-back
minimum corner SJ values are about 0.3111 (four-point) and 0.2939 (rounded), with
positive eight-point Gauss Jacobians and integrated volumes. Per-body boundary
manifold/Euler checks pass. These checks do not replace exhaustive hanging-node,
geometry-error, tolerance-fit or solver validation for arbitrary parameter sets.

Current tests cover profile vertices, mathematical sample agreement, circular
tangency versus intentionally sharp crest corners, both hands and many phases,
rejection, original-demo regression, CLI K/INP output and native-export guards.
Near-thread 2:1/3:1 element-count reduction, drill tips, actual driver recesses,
blind closures, complete GUI connection and a current standard catalogue remain
unimplemented; do not advertise them as covered by profile parameterization.
