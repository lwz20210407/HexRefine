# Original Screw Phase Compensation

Status: **bounded whole-source preprocessing implemented and tested**.
It is NOT a finite-axis repair, valid complete H8 mesh, or solver-ready deck.

## Supported Input And Interface

`tools.bolthex.screw_phase_compensation` accepts only the reviewed original
TrueGrid Screw source SHA256:
`09c9ce96a5df2d8cf900be8fa716d6a0daf7e80d6cc26955e76e623d45182628`.
Unknown inputs reject before the mesh reader. The Python API requires an
explicit `CadAccuracyPolicy`; fields are revalidated into the base class so
subclass method overrides cannot bypass the budget.

```text
python -B -m tools.bolthex.screw_phase_compensation ORIGINAL.k NEW_OUTPUT --target-size-mm 0.2
```

The output directory must be fresh. CLI status3 deliberately means **partial
research output**, including when its preprocessing checks pass. K/INP headings
and report flags state that the axis is NOT repaired. Existing source/output
paths are not overwritten.

## Whole-Model Evidence

The source has6128H8 records. The2160body cells EID2889..5048 are processed;
all3968other cells remain unchanged. Every original coordinate row,nodeID,
elementID and PID is retained. Only selected-cell references are redirected to
existing source-node identities, using measured strip/phase incidence, not a
global coordinate-nearest weld or a merge across parts.

-36angular columns per turn,0.4mm measured advance,2phase-row shift.
-1045root correspondences and1044whole-face pairs.
-4178selected corner references redirected; outside references unchanged.
-ID-unmatched faces10626to8538:2088faces cancel as1044shared pairs.
-Maximum selected trilinear image displacement bound0.000312828384mm,
  below the explicit all-critical engineering budget0.0005mm.
-Integrated per-cell volume40.745844971to40.746013739mm3;
  relative change4.141985e-6. This is NOT a union/overlap certificate or
  exact-domain pure-refinement conservation.
-Minimum selected corner SJ remains0; bad axis cells remain. Complete mesh
  acceptance and global overlap certification stay false.

For each alias class a retained outside anchor, if present, is immutable.
Multiple distinct outside anchors reject rather than changing retained cells.
New Gauss/volume/corner failures reject; positive-to-zero/negative corner sign
changes cannot hide inside a floating-point comparison allowance. Per-face
owner/orientation checks prevent a pre-existing bad global maximum from
hiding a new nonmanifold or misoriented face elsewhere.

The trilinear displacement bound follows from nonnegative reference-cube
shape weights summing to one. It bounds both image sets via corresponding
parametric points; it does not prove image injectivity or resolve overlaps.

## Tests And Remaining Work

`tools.tests.test_screw_phase_compensation`:17tests pass with the actual
readonly original input and explicit scratch root. They cover full scope,
outside preservation, alias anchors, strict-budget rejection, policy override
rejection, new quality defects, per-face topology defects, K/INP reload and
the mandatory partial CLI result. Tests requiring local source evidence use
`SCREW_ORACLE_K` and `BOLTHEX_TEST_ROOT` and must not be counted as passing
when skipped.

Actual output/evidence remains under the dated local task root:
`F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm/screw-phase-compensated-v2`.
No original/vendor binary or large mesh is distributed in Git.

Next is a finite positive-Jacobian axis construction that matches the actual
helical retained frontier and endpoint/head/neck geometry. A positive isolated
butterfly cylinder, small collar or endpoint anchor is not that construction.
See [professional references and actual controls](SCREW_PROFESSIONAL_REBLOCK_STRATEGY.md).
