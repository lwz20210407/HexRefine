# Screw Axis Reblocking: Professional References And Controls

2026-11-05. This records a tested topology direction, **not an implemented
repair of the complete original Screw**.

## What The Tools Actually Document

- [TrueGrid butterfly training](https://truegrid.com/Data/TGTRAIN22-min.pdf)
  contrasts simple radial/wedge topology with a finite butterfly core for
  curved objects. A cylindrical coordinate map with radius zero is not by
  itself a nondegenerate all-H8 construction.
- [HyperMesh HM-3220](https://2022.help.altair.com/2022.3/hwdesktop/hm/topics/tutorials/hm/hm_3220_creating_a_hexahedral_mesh_c.htm)
  uses subdivision into mappable volumes and source/target solid mapping.
  [Hex meshing](https://2023.help.altair.com/2023.1/hwdesktop/hwx/topics/pre_processing/meshing/meshing_hex_c.htm)
  distinguishes that from extrapolating an existing2Dsource mesh.
- [GridPro GUI manual](https://22821077.fs1.hubspotusercontent-na1.net/hubfs/22821077/GridPro%20Documentations/WS_GUI_Manual_v9.1.pdf)
  separates Wrap/O-grid creation from Heal/singularity treatment. These are
  topology operations, not a claim that a fixed helical FE frontier can always
  be filled by wrapping it once. No proprietary connectivity table is exposed
  or asserted to have been recovered from this manual.
  The manual's Heal dialog addresses three listed boundary-singularity
  classes with internal/external wraps, internal surfaces and optional buffer
  layers. This is not documentation of a universal fixed-FE-frontier filler.
- [ANSA2026.1 release](https://www.beta-cae.com/news/20260729_announcement_suite_2026.1.htm)
  reports volume decomposition and Hexa Fit as well as body-specific HEXA/PENTA
  meshing. Marketing capability is not evidence that the exact retained
  frontier in our source has been repaired, and HEXA/PENTA is not all-H8.
- [SimLab Screw Mesh](https://help.altair.com/simlab/help/en_us/topics/meshing/screwmesh.htm)
  accepts CAD/FE input and has an option to avoid spider wedges along the axis.
  It also describes simplification of threads to cylindrical surfaces in its
  thread-diameter handling. Therefore this feature alone cannot certify an
  unchanged true-helical-thread reconstruction. No SimLab experiment has yet
  been run in this task.

## Actual Local TrueGrid Controls

Two independently written small command streams ran in the installed TrueGrid,
with process exit0 and no captured warnings. Both outputs were independently
read and checked with the repository H8 auditor.

| Control | Cells | Result |
| --- | --- | --- |
| Radial cylinder including radius0 |576|288cells have only6unique positions; minimum SJ0; rejected as all-H8|
| Finite butterfly center plus circular wings |1536|8positions per cell; minimum SJ0.70710678; positive sampled Jacobians; boundary Euler2; nonmanifold0|

Both use radius0.9 and height0.4. Their different boundary discretizations
mean their volumes should NOT be compared as an exact same-domain refinement.
The butterfly result is mesh-only; it is not a CAD-distance/volume-certified
circle or the original Screw repair.

Local reproduction:
`F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm/run_axis_block_controls.py`.
Inputs,process commands,logs,K files and structured independent reports are in
`professional-axis-controls-v1` below the same root. No original input was
modified or vendor executable/library committed.

## Implications For The Original Source

The measured root-wall chart advances0.4mm axially per36angular columns and
identifies phase row0after one turn with phase row2before the turn. Treating it
as an ordinary same-level disk boundary is incorrect. A finite central block
is the right standard primitive; satisfying the original helical attachment,
neck/head boundaries and endpoints is the remaining construction problem.

Current `screw_phase_compensation` processes the whole2160-cell body inside
6128original cells. It redirects measured same-part phase identities while
preserving all3968outside cells and original coordinate rows. It fixes1044
face pairs but inserts NO finite core; minimum axis SJ remains zero.

Next construction must explicitly match the retained tooth faces, terminate
the phase slip in a three-dimensional cap/front, and preserve external
geometry under the declared engineering budget. Sampling positive Jacobians
in an isolated collar/cube is not full-domain acceptance. Pure refinement
volume and outside-region preservation cannot be replaced by CAD-transfer
tolerances. Existing rejected macros remain negative evidence, not proof that
every possible decomposition is impossible.
