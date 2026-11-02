# Runout matching and circumferential core grading

## Development scale comes first

Daily regression uses `tools.bolthex.dev_smoke`: two saved-CAD runout patches,
105 H8 each, about 19 KiB per K. The combined K/INP/reports are about 70 KiB.
The implementation rejects patches above 256 H8 or total output above 1 MiB.
It does not create a large model before cropping it. Slow CAD construction
requires `HEXREFINE_RUN_SLOW_CAD=1`; whole-model exports are separate, deliberate
acceptance jobs. See [testing tiers](FASTENER_TESTING.md).

## Original faded M8 nut

The previous constant-angle radial map bridged two real planar radial caps at
approximately 270 and 248.4 degrees. Material-classifier bisection confirmed
that the one-sided inner radii genuinely differ; this was not a ray precision
error and global reseeding alone did not fix the local geometry.

`cad_runout.py` discovers those planes from the unchanged STEP, uses distinct
vertices for their two one-sided limits, and reparameterizes neighbouring
inner-loop columns so their outer partners lie on the material side. Axial
support blends back to the ordinary map away from each end. Near a cap limit,
the two sides are resolved explicitly before they fall within the kernel seam
tolerance. No boundary vertex is collapsed, and the original CAD is not edited.

Select `boundary_mapping: "runout"` in mesh seeds. The ordinary `"radial"`
mapping remains the default. The tested slow-acceptance recipe uses sector=48,
radial=6, per_pitch=96. That is a fidelity fixture, not the development default.

Recorded full-body result:

- Original saved M8-1.25 library-faded STEP, byte-identical before/after.
- 917,568 H8; corner minSJ 0.17539165; positive eight-point Gauss determinants.
- Mesh/CAD relative volume error 1.23304e-5.
- All boundary-face centres plus 7,144 extra critical-cap surface probes passed.
- Independent K/INP read-back, native HM CAD+mesh save/clear/reopen and PID1 passed.

This is **not** the separate square-ended through nut being substituted for the
original case. Overlapping cap supports and other runout geometries remain
explicitly conditional/rejected; this is not arbitrary CAD paving.

## Coarse solid core, unchanged fine thread ring

`graded_core.py` supplies a two-coarse/four-fine annular quad patch: eight fixed
boundary vertices, nine interior vertices, twelve positive-area quads. Repeated
paired patches enrich circumferential count towards the outer fine ring. Their
extrusion is entirely H8, with no tetrahedra, wedges or collapsed axis cells.

Select `core_mapping: "graded_2to1"` for the bounded external-hex bolt mapper.
For the tested M6 recipe, the counts are 48 -> 96 -> 192 around successive rings.
The outer fine-ring node geometry is retained, while interior cell count falls.

- Same M6 CAD: 3,579,648 -> 1,845,168 H8, a 48.4539% reduction.
- Corner minSJ remains 0.22414392; mesh/CAD volume error remains 9.13086e-5.
- Independent K reads compare 960,768 fine-ring/head node positions: maximum
  coordinate difference about 1.00e-13 mm. IDs are regenerated, not preserved.
- Native HM contains the same real CAD and the reduced H8 mesh, with unchanged
  mesh-data fingerprint across save/reopen and source PID1 preserved.

This is **circumferential** enrichment only. Axial grading, general 3D weak
balance, 3:1 thread-region grading and existing-mesh installation are not claimed.
Fewer cells do not prove an explicit solver will be twice as fast: the fine
surface and axial spacing, hence potential time-step restrictions, are unchanged.

## Unchanged acceptance rules

The user-approved CAD STEP exchange limit remains 1e-7. Mesh/CAD volume <=1e-4,
corner SJ >=0.15, positive Gauss Jacobians, valid closed topology, <=2e-6 mm
nodal witnesses and <=0.02 mm surface probes were not relaxed. Full acceptance
files are retained references, not regenerated on each development edit.

These are CLI/Python backend additions. GUI binding, socket/cap/drill partitions,
standards/tolerance coverage and complete upstream ports remain separate TODOs.
