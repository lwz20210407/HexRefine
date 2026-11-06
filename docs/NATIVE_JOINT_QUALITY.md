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
