# Mesh-Only Joint Quality Diagnostics

Native joint generation now includes `qualityDiagnostics` in its report.
No FE solver, PyDYNA or scikit-fem dependency is added to mesh generation.

The overall mesh and each PID report explicitly named corner-SJ,
corner-plus-center SJ, positive-only corner/Gauss determinant ratios, edge
aspect ratio, face corner angles and the worst Q4 diagonal-normal angle.
Counts,percentiles and both lowest/highest element IDs are reported. Region
IDs refer to the exported global K/merged-INP numbering, not ambiguous
part-local numbers.

PID grouping is not a focus/transition-region classifier. Raw shape formulas
are named; a worst-two-diagonals normal angle is not claimed identical to
every vendor's warpage option. Reference bands remain advisory and the old
0.15screen is not a vendor-wide rule. See H8_QUALITY_METRIC_POLICY.md.

The frozen53592-H8/56704-node shared joint was regenerated with diagnostics.
`model.k`, `merged.inp` and `parts.inp` remain byte-identical to the earlier
verified files. Four PID reports cover every element, and reported extrema
are checked against the actual owning PID. No geometry, spacing, interface
or solver card was altered to add quality metadata.

Local evidence:
`F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm/mesh-quality-joint53592-v1`.
`geometry-parity.json` binds the actual three artifact hashes. Diagnostics
are in `report.json`; subsequent metric additions remain read-only.

This closes a bounded reporting interface, not quality optimization, generic
region classification, engineering convergence or full fastener validation.
Mesh development/publication does not wait for optional physical-analysis tests.

## Workbench Summary

The native-joint dialog now reads `report.qualityDiagnostics` into a collapsible
overall/per-PID summary. Corner SJ and corner-plus-center SJ are separate;
Gauss determinant ratio, 12-edge length ratio, minimum/maximum face angles and
worst Q4 diagonal-normal angle retain their own formulas and units. Each row
shows its range, undefined count and expandable lowest/highest exported global
K/merged-INP EIDs. No part-local offset or new selection/backend API is used.
Reference bands are advisory, not engineering acceptance; no 0.15 gate is added.

Older reports without diagnostics retain the count/minSJ display. Partial
diagnostics show unavailable fields explicitly, never as zero. Parameter edits
and job changes clear stale summaries. Text is inserted using `textContent`.

2026-11-07 GUI evidence is in
`continued-screw-hm/resume-20261107/joint-quality-gui`: six Node formatter tests,
scratch-only TypeScript build, desktop/mobile screenshots and browser-checks.json.
The isolated real workbench module loads the saved 53592-H8 K with its real hash
and counts; current face-angle metrics are recomputed read-only from the same
saved merged INP. This tests presentation and compatibility, not the full
production server, 3D preview, new geometry, solver or engineering acceptance.

A separate full-workbench run then used the real production HTTP handler and
a fresh interrupted-record fixture:10440H8/12426nodes were actually generated,
downloaded and read back as K/INP. The real report displayed5quality sections
and35metric rows, with new face metrics present. Retry lineage, original-folder
immutability, cancellation, page reload, desktop/mobile rendering and canvas
pixel checks passed. No physical solver was started. Evidence is in
`resume-20261107/integrated-gui-v1/integrated-result.json`, with actual
workbench screenshots and the generated bundle in its `qa/` directory.
The fixture remains a saved interrupted record, not a claimed OS crash test.
