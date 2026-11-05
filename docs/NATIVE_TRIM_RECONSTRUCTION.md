# Native Trim Reconstruction

`tools.bolthex.native_trim_brep` is a bounded, analysis-only bridge from an
explicitly labelled installed-HyperMesh SDK capture to native mathematical
supports and real trim domains in OCCT. It does not invoke MATLAB or TrueGrid.
It does not create an HM, fit source STEP surfaces, or issue a product
certificate. A reconstructed trim domain is not a reconstructed closed solid.

## Interface

1. `load_conventions(control_json, source_label=..., expected_sha256=...)`
   infers orientation/endpoint flag meaning from captured quarter-point and
   endpoint controls. A source-OCP producer uses different conventions; its
   similarly named fields must not be silently treated as SDK data.
2. `load_capture(capture_json, source_label=..., conventions=...,
   expected_sha256=...)` reads bounded JSON with duplicate-key/nonfinite/count
   checks before creating kernel geometry. Hashes bind bytes, not external
   authenticity. Application callers must keep input acquisition traceable.
3. `reconstruct_trim(capture)` reconstructs captured mathematics and actual
   PCurve loops. Hole loops and natural collapsed sphere-pole chart edges are
   distinguished from a rectangular UV search box and physical3Dedges.
4. `model.query(point, preferred_face=None)` returns verified finite witnesses,
   explicit failures/unsupported coverage and query warnings. It does not
   prove a globally nearest point or a continuum Hausdorff distance.

The module deliberately limits supported analytic parameterizations and curve
types; unsupported faces are recorded, not dropped from whole-face coverage.
No unrestricted source healing, node merging or surface replacement is allowed.
`native_curve_range.transfer_curve_range` provides mathematical affine range
normalization without relabelling analysis curves as original capture data.

## Tests And Actual Case

- `tools.tests.test_native_trim_brep`: small calibrated controls, input
  budgets, actual trim holes, inconsistent/missing evidence and query failures.
- `tools.tests.test_native_trim_actual`: optional real saved-M6 full capture,
 94trim domains, native support/PCurve sample agreement, two collapsed natural
 pole-chart transitions and real pole/bore queries. Requires
 `HEXREFINE_NATIVE_FULL_CAPTURE` and `HEXREFINE_NATIVE_CONVENTIONS`; skipped
 source-dependent tests are not acceptance evidence.
- `tools.tests.test_native_trim_integrity`: independent mutations of producer
  origin, endpoint identity/coordinates and canonical3Dcurves. Contradictory
  evidence is rejected or explicitly marked inconsistent; missing canonical
  proof is not silently promoted to a topology certificate.

The three modules have24passing tests with real local evidence and no skips.
The full94-face capture was also compared at1053queries, including641boundary
node controls, against the frozen local native-trim implementation. Reported
distances match exactly. Every queried face's warning is retained, including
nonwinning candidates:13206warnings across queries, versus4warnings attached
to the winning witnesses. No failed query or unsupported face is dropped.
These warning counts are observations, not additional failed physical faces.

Available ordinary endpoints, shared identities and canonical-curve endpoint
evidence are checked separately from PCurve mathematics. Interior canonical3D
locus/host topology are not certified by endpoint agreement; their verification
flags remain false. The explicit input-evidence status must accompany coverage.

The real capture byte hash is
`23cf0300af1cb9485978f1ae64b6c53b432b20550a892af6e5fb76ef6692a7b3`.
Evidence remains under the dated task root documented in
[the completed bounded M6 bundle](NATIVE_CAP_ENGINEERING_BUNDLE.md).

## Scope Of The Solid Result

The saved M6 accepted bundle has a separately reconstructed, independently
validated closed BRep and mass audit. That local result is not automatically
equivalent to this module's `completeNativeFaceCoverage`. Reusable native-edge
assembly, whole-component sewing/validity and independent solid integration
must be separately implemented and tested before exposing that as a general
API. Full mesh/solver/contact/manufacturing acceptance always remains separate.
