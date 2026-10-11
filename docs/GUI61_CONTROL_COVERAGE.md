# GUI Control Coverage, Not Blanket Completion

2026-10-11 checkpoint. "A generator is implemented" does not mean every GUI
option or every combination is ported. This ledger separates parameter-state
mapping, actual generation, numeric auditing, native-viewer opening/rendering,
and engineering acceptance.

## Rectangular Controls

| Source control | Native interpretation | Verified scope / limitation |
| --- | --- | --- |
| B ratio toggle | X reduction 3 or 2 | Both values |
| C ratio toggle | Y reduction 3 or 2 | Both values |
| Longitudinal ratio toggle | Z reduction 3 or 2 | Distinct from enabling thickness transition |
| Longitudinal transition checkbox | Effective Z=ratio or Z=1 | Both; source's inherited count-alignment bug corrected |
| Two-band toggle | One/two consecutive transitions | Both; not physical multilayers |
| 1/4, 1/2, 1 | Quarter/half/full rectangular geometry | All three; no solver BC inferred |
| Angle | Piecewise shear with fixed outer boundaries | Zero and selected positive/negative experiments, NOT every real angle |
| Correction checkbox | Explicit native angleCorrection | Source b8=0 branch is unreachable; native opt-in reduction is a documented improvement |
| K-file checkbox | Export enabled/disabled | Original callback probes confirm no mof output when disabled; native API and writer are separate |
| Offset display | Derived from thickness and angle | Not an independent eccentricity input |
| Repair-defects button | Separate postprocessing chain | Not the correction checkbox; only stated repair patterns/benchmark are certified |

Fixed geometry for the main rectangular matrix: full size 80x80x16, refined
full XY size 32x32, target fine size 1 and coarse size 2. Actual fine counts
can change under the disclosed divisibility rules; dimensions remain fixed.

Both stages x three fractions x two X ratios x two Y ratios x three effective
Z modes give **72 nonduplicate zero-angle mesh configurations**. All 72 now
have original MATLAB-generated TG/reference K, independent native K, numeric
audits and native LS-PrePost global/top/two mid-plane views. The additional
36 smaller single-band cases remain regression evidence; they are not used
to pretend a same-geometry single/double comparison.

Including the redundant disabled-thickness ratio state, correction state and
disabled-export state gives **384 GUI state mappings** at angle zero. This is
NOT a claim that every duplicate GUI state was separately replayed. Six
original-callback probes specifically check export gating, correction on/off
and the source thickness-off state dependence. Continuous angles cannot be
exhaustively enumerated. Selected +/-10-degree double-band and positive
single-band reference tests remain separately listed.

## Curved Controls

- Hollow cylindrical shell: thickness reduction on/off x three fractions x
  physical layers 1/2 gives **12 cases**. All generated, audited, and opened
  in LS-PrePost. Circumferential/axial reductions are fixed 3:1 in this branch.
  The native full cylinder fixes the source's missing reflection. Physical
  layers have gaps; this does not implement two successive transition bands.
- Filled circular target: X/Y ratios 2/3 x three fractions gives **12 zero-angle
  cases**, with fixed thickness reduction 3:1. Native quarter geometry repairs
  the source's half-disk output. Another **16 +/-15-degree half/full cases**
  exercise the independent native core-shear mapping with original TG oracles.
  Nonzero quarter tilt, circular angle correction and automatic element-budget
  optimization remain unsupported. See the circular contract for mapping differences.
- Shared UI controls cannot be assumed to affect every generator: the circle
  source fixes max_z=min_z/3; the cylinder has its own thickness switch and
  fixed other reductions. The 2D generators also have their own contracts.

## LS-PrePost Evidence

The local validation directory contains `RECTANGLE_CONTROL_MATRIX.html`,
`CIRCLE_CONTROL_MATRIX.html`, `CYLINDER_CONTROL_MATRIX.html`, a combined
`GUI61_OPTION_REVIEW.html`, and `lspp_reviews/manifest.json` with input hashes,
process IDs/exit codes, exported PNG hashes and per-view failures.

Each file is opened in its own LS-PrePost 4.10.1 process. Screenshots are native
PNG exports, not synthetic mesh drawings. Commands `splane dep0`,
`splane setbasept`, `splane drawcut`, `splane projectview` were recorded from
the actual GUI after a previously documented `splane create` route failed.
Fresh processes avoid stale section context when switching models.

Pixel checks reject empty outputs but do NOT certify mesh quality. Mid-plane
cuts are labeled by their plane, not all called fine-core cuts. Some planes
cross the outer transition band rather than the refined core. Numeric audits
and original-resolution visual inspection remain separate evidence.

106 existing half/quarter solid cases additionally have cut-face-facing ISO
and near-core thickness sections, embedded directly in the option tables.
`lspp_front_views/manifest.json` records camera quaternions and section points.
The new circular tilt page compares native/TG sections at Y=1.23 side by side.
The original views remain available; the corrected camera does not modify K files.

Mixed RC decks open, but combined beam/solid section projection crashes
4.10.1 with 0xC0000005. Temporarily hiding the beam PID makes concrete sections
work; reinforcement-only views also work for all four RC samples, without
changing their K files. The combined-projection limitation remains open.

Some double-band cases have corner SJ below 0.2 and are visibly/quantitatively
flagged, not declared universally engineering-ready. No solver analysis is
certified by a viewer opening successfully.

All local evidence remains under
`F:/PythonWoking/temp/20261011-hexrefine-gui61-validation`. Public commits do
not contain recovered MATLAB archives or installed commercial software.
