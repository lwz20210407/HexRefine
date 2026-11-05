# Geometry Accuracy Policy

Approved by the user on2026-11-05. Engineering CAD transfer and strict CAD
regression are different tests. Historical strict failures are retained.

## Primary Documentation

- [HyperMesh geometry/mesh options](https://2022.help.altair.com/2022/hwdesktop/hm/topics/panels/help022.htm)
  distinguishes geometry cleanup tolerance from node coincidence tolerance.
  [Import parameter settings](https://help.altair.com/hwdesktop/hwx/topics/pre_processing/meshing/meshing_parameter_settings_r.htm)
  recommends automatic import tolerance based on model type and dimensions.
- [Abaqus mesh API](https://docs.software.vt.edu/abaqusv2025/English/SIMACAEKERRefMap/simaker-c-partmgnpyc.htm)
  defines curvature/deviation control as chordal deviation divided by the
  associated element edge length, rather than a universal absolute length.
- [Abaqus precision](https://docs.software.vt.edu/abaqusv2025/English/SIMACAECAERefMap/simacae-c-impconcprecision.htm)
  describes ACIS1e-6 geometric-entity precision. This is NOT a universal
  mesh-to-CAD error tolerance. Tolerant geometry and healing are separate issues.
- [ANSYS Mesh Defeaturing](https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/wb_msh/msh_auto_defeat.html)
  allows defeature size to depend on mesh sizing, with local overrides.
- [SpaceClaim blocking](https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/spaceclaim/Discovery/user_manual/options/r_mesh_options_blocking.html)
  distinguishes relative triangulation tolerance and true-BSpline projection.
  Its0.001 relative triangulation setting is NOT0.001mm CAD accuracy.

These sources support separating tolerances and considering model/mesh scale.
They do not prescribe a single universal distance or volume acceptance value
for all H8 meshes. The defaults below are explicit PROJECT engineering choices,
not claims that a vendor mandates them.

## Profiles

`tools.bolthex.geometry_accuracy_policy.CadAccuracyPolicy` is the shared,
immutable, millimeter-only policy. Engineering requires an explicit target seed
size; booleans, nonfinite/nonpositive inputs and unknown profiles reject.

| Check | Strict CAD Regression | Engineering CAD Transfer |
| --- | --- | --- |
| Ordinary candidate distance |2e-6mm|min(0.001mm,1% declared local target size)|
| Critical candidate distance |2e-6mm|min(0.0005mm,1% critical target size)|
| Optional critical feature budgets |not used|also<=5% minimum positive functional gap and<=1% minimum root radius|
| CAD carrier relative BRep-volume error |1e-7|1e-4, or0.01%|
| Immutable source-reference recheck |2e-6mm|unchanged2e-6mm|

All surfaces are treated as critical by default when a per-feature scope map
has not been provided. Unknown mating clearances are NOT certified by omitting
the optional gap argument. Nominal zero-clearance contact is not a positive gap
and must have a separate contact/penetration budget, not an invented tolerance.

The target size must come from the requested/pre-existing meshing recipe or
explicit local seed settings, not be increased after viewing a failed error.
An incidental tiny axial edge is not automatically the associated curved-edge
target used for chordal error. Such thin layers remain visible as separate
aspect-ratio/resource/time-step problems; selecting a CAD policy does not repair
or approve them.

## Unchanged Requirements

- Source mathematics/identity validation is not relaxed. Source payload math
  witnesses still use1e-10mm, with frozen observations and real topology checks.
- No coordinate welding across parts, removal of real material or omitted
  physical faces. Invalid/nonclosed carriers and incomplete evidence reject.
- Mesh connectivity, hanging interfaces, overlap, positive Jacobians and the
  stated minimum SJ requirement remain independent hard checks.
- Pure refinement preserving an existing discrete domain must retain its
  original volume rule. Engineering CAD-transfer volume is not permission to
  change the old mesh domain or cancel overlapping/lost material by signed mass.
- CAD file same-kernel write/read regression retains its original strict
  diagnostic. A useful cross-kernel engineering transfer need not reproduce a
  file's native parameterization or meet that much tighter regression test.

## Implementation And Reports

`native_cad_conditioning` accepts an explicit `accuracy_policy` and records
both `strictStepCarrierVerified` and `engineeringStepCarrierVerified`. Raw
face/edge/node/control coverage, independent BRep mass and validity are still
recomputed. The legacy function default remains strict for backwards-compatible
regression calls. New engineering jobs select their profile explicitly:

```text
python -B -m tools.bolthex.native_cad_conditioning SOURCE.step CARRIER.step REFERENCE.json NEW-AUDIT.json --accuracy-profile engineering --target-size-mm 0.04
```

The report includes units, declared sizes, effective thresholds, policy version
and primary references. It never turns a carrier audit into a complete native
HM/mesh/contact/solver or manufacturing-standards certificate.

## Actual M6 Comparison

The pre-existing `agent-body/check_body.py` recipe specifies
`BodySpec(spacing=.04)` before the new error measurements. Thus the current
all-critical CAD transfer distance is0.0004mm; it is not chosen by fitting to
the observed maximum.

The first fresh engineering carrier audit covers540 reference observations,
including128 actual body-boundary nodes, all94 source faces,101 carrier faces
and254 physical carrier edges. Maximum node distance is0.000126932mm;
maximum reverse-edge distance is0.000394394mm; relative independent BRep-volume
error is4.44119e-5(0.00444119%). The engineering carrier passes; the strict
carrier fails. No old report is rewritten, and no whole-HM/solver certificate
is issued from these finite observations alone.

The saved94-face native database was reopened/captured in an independent SDK
session. Native math-trim observations and STEP-export observations remain
distinct; the completed native result below does not accept the STEP writer.
Native math-trim observations and STEP-export observations remain distinct.

The subsequently completed native CAD+H8 file contains456194nodes and333824
H8 with94native faces/one solid. Actual save/clear/reopen preserves the whole
FE snapshot. Fresh K/INP reload has exact connectivity, about5e-13mm coordinate
roundoff, SJ0.215729 and unchanged original discrete volume.
Expanding the carrier reference to1053observations(641boundary nodes) finds a
new bottom-bore point at0.000433191mm, above0.0004mm. That full carrier rejects;
the earlier540-point pass is not promoted to whole-model geometry acceptance.
The threshold is not increased. The separately completed native trim/edge and
independently closed BRep measurements distinguish stored native geometry from
the STEP writer's approximation. A successful host I/O operation alone is not
a full geometry certificate.

The actual native-HM engineering bundle now passes for this saved M6 case.
An independently reconstructed valid one-solid BRep has volume426.917199823mm3
versus source426.917207618mm3 (relative1.825842e-8). The FE/native-BRep volume
error is5.2412604e-5. Maximum native reverse-witness error is4.2790203e-5mm
over17196witnesses;1053reference observations and3318PCurve/36921stored3D
math observations were rechecked. Four projection-query warnings retain
verified fallback witnesses; query failures and unsupported queries are zero.
This is finite engineering evidence, not a continuum Hausdorff theorem,
node-CAD association, contact, preload, solver or standards certification.
See [the completed bundle](NATIVE_CAP_ENGINEERING_BUNDLE.md).

The128-node shortest-incident-edge diagnostic finds a0.000227259mm axial end
layer. At the worst sampled point its curved circumferential edges are about
0.04687mm and radial edge0.375mm. The tiny layer originates from runout-warp
support termination. It is explicitly tracked for mesh planning/performance;
using it blindly as every geometric-deviation denominator would mix directions.

Evidence remains under
`F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm`.
