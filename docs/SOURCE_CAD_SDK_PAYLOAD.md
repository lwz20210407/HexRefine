# Source CAD Construction Payloads

2026-11-05. These repository interfaces extract source CAD mathematics and
topological identities for a future host adapter. They do not call HyperMesh,
generate FE, repair source geometry, or certify a native HM file. The installed
public SDK client is still a quarantined research prototype, not a dependency
of either module. No vendor SDK/header/binary is redistributed.

## Interfaces

```text
python -B -m tools.bolthex.cad_native_payload source.step new-source-2d.json
python -B -m tools.bolthex.cad_native_3d_payload source.step new-source-2d.json new-source-3d.json
```

Use the existing CAD-capable runtime. Output parents must already exist and
outputs must be fresh paths. Input/output files are bounded to16MiB each.
The second interface binds the original STEP SHA and frozen2D payload SHA,
verifies the exact source BRep identity and does not mutate either input.

`build_payload` / `validate_payload` expose the2D data interface;
`extend_payload` / `validate_payload` expose the canonical3D extension.
No silent unit conversion, geometry fitting or coordinate-based node welding
is performed. The current real reference uses millimeters.

## Supported Data

- Plane, sphere, cylinder, circular cone and bounded nonperiodic BSpline
  surfaces, preserving source parameterization/control nets and actual poles.
- Segment, circle, ellipse and BSpline PCurves. Finite hyperbolas use exact
  rational conversion, with explicit source-parameter remapping and independent
  bidirectional finite-locus witnesses. Endpoints participate in projection
  checks even when the stationary projector finds no interior solution.
- Source face/wire/coedge orientation, actual TopoDS edge/vertex identities,
  source-declared tolerances, seam and explicit degenerate-pole classification.
- The3D extension adds canonical finite source edge curves/ranges, including
  exact hyperbola conversion. Loop-travel ranges are separate from the
  original canonical forward-edge ranges. Degenerate poles do not acquire
  invented3D curves.
- The measured degree1/two-U-pole out-of-support trim case uses exact
  homogeneous continuation. Other unsupported extensions are rejected.

Other surface/curve classes, periodic supports and excessive degrees/pole
allocations reject explicitly. This is not universal STEP import support.

## Provenance And Limits

`sourceSamples`, `onSurfaceSourceSamples` and `source3dMathSamples` are source
OCP observations. They are never relabelled as native SDK samples. Actual
native captures use separate `nativeSamples` / `onSurfaceSamples` fields.
The `nativeHostVerified` flag remains false in both source producers.

Source tolerances are measured topology metadata, not permission to weaken
the final2e-6mm geometric-distance or1e-7 CAD-exchange volume gates. A shared
source edge identity does not imply its stored3D curve and both PCurves are
pointwise identical at the same parameter. Finite witness agreement is not a
global Hausdorff bound. Exact primitive conversion is distinct from native
trim construction, full source-boundary correspondence and final acceptance.

## Actual Verification

The readonly M6 reference has94faces,239 edge identities and476 coedges:
237 ordinary two-owner edges and2 explicit degenerate sphere-pole edges.
The2D payload measures all actual surfaces/PCurves to about2.03e-14mm at its
recorded witnesses. The canonical3D extension covers all237 finite ordinary
edges without fitting; its source file and frozen2D document remain unchanged.

Twenty-nine extraction tests and16 independent integrity tests pass with the
actual saved M6 source and base payload supplied. Integrity checks reject
jointly moved new curves/samples against frozen observations, reordered wires,
forged source vertices and altered parameter maps. Source counts are checked
before pole/knot traversal and the3D extension verifies actual source ordering.
Together with the source-boundary and native-support/carrier regressions, the
run passes92tests with0skips. These totals are scoped to those modules, not
the full repository or solver acceptance.

The historical strict native prototype constructs and reopens a94-face/one-solid
diagnostic HM from this source. It fails strict constructor preservation
and independent strict carrier checks, and is NOT a strict product delivery:
STEP-writer readback has101faces, maximum reverse-edge distance about3.94e-4mm
and relative BRep-volume error about4.44e-5. The subsequently user-approved
engineering profile is documented separately in GEOMETRY_TOLERANCE_POLICY_REVIEW.md.
The engineering constructor and full CAD-plus-mesh HM save/reopen now work;
complete geometry verification is still in progress. No source producer sets
nativeHostVerified based on these separate host experiments.

Native3D-led construction also rejects observed endpoint extension and short
edge absorption. Splitting exact PCurve intervals is a bounded experiment,
not a demonstrated precision fix. No GUI capability flag may be enabled from
source-payload extraction or a merely sealed solid alone.

Evidence and isolated SDK programs remain under
`F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm`.
The current original Screw and cap/native-HM gaps remain tracked in
`FASTENER_DEVELOPMENT_TODO.md` and `SCREW_HM_CONTINUATION.md`.
