# Bounded solid-sphere surface-cap generator

`generateSolidSphereGradedMesh(spec)` creates a filled, connected H8 ball without
MATLAB, TrueGrid, LS-PrePost, Abaqus or a downloaded reference mesh. It is a new
native construction, **not a reproduction of an unseen paid tutorial**.

## Geometry And Refinement

The base consists of one Cartesian center block and six cube-to-spherical-boundary
radial blocks. Every radial block interpolates from its inner cube face toward
the analytic sphere. Integer block-seed entity keys share interfaces exactly;
there is no pole collapsed into a degenerate hex and no tolerance-based joining
of unrelated blocks.

Only the central parameter rectangle of the +Z outer block is refined. Its
outermost `capLayers` original radial layers form the complete attention volume.
Existing Cartesian local-sweep templates split each selected parent once into
eight H8s. Face/edge/corner transitions occupy at most the neighboring original
parent layer. A two-parent lateral buffer and two-parent inner buffer keep all
seven-block seams coarse. The original center block and other five radial blocks
stay coarse. This is **real three-dimensional local 2:1 refinement**, not a quad
surface with no volume beneath it, nor a uniformly refined whole sphere.

New internal points start on their old physical parent's Q1 map. Non-tensor
transition faces use the existing canonical, shared-face flux kernel through a
separate certified generated-cap adapter; the existing public strategy guard
still rejects arbitrary local-sweep requests. Only face-interior points can move;
old corners, edges and tensor core interfaces stay fixed. The displacement budget
defaults0.002 of the source face's shortest edge (maximum configurable0.01), and
the actual displacement is reported. Every physical parent must conserve volume
at1e-8 **before** boundary projection, including after final node assembly.

Only new points on the outer sphere boundary are then normalized to the analytic
radius. Existing base vertices remain fixed. Projection changes the boundary and
its volume; it is reported, not hidden as a volume-conservation tolerance change.
The exact eight-cell/27-node cap test applies to reference coordinates, not to
equal physical edge lengths on a curved surface.

The footprint is a **block-coordinate rectangle**, curved by the sphere map,
not an arbitrary circular/geodesic cap. Nor does this entry make concentric
spherical-shell count transitions. Those are separate open TODO items. No GUI
controls, solver materials, contact, symmetry constraints or historical state
migration are implied. Full sphere only; partial display subsets are not partial
model generators. Units are caller-defined and consistent; the example uses mm.

## Request And CLI

```json
{
  "schemaVersion": 1,
  "kind": "solid-sphere-surface-cap",
  "partId": 1,
  "options": {
    "radius": 10,
    "faceSegments": 16,
    "radialSegments": 8,
    "capSegments": 8,
    "capLayers": 2,
    "cubeHalfWidthFraction": 0.4,
    "minimumCornerScaledJacobian": 0.2,
    "maximumFaceDisplacementFraction": 0.002
  }
}
```

```shell
npm run build
node scripts/generate-solid-sphere.mjs request.json NEW_OUTPUT_DIRECTORY
```

Output: mesh-only `mesh.k`, unchanged-coarse-reference `source-coarse.k`, ordinal
parent lineage and region lists, report and replayable request. K output contains
NODE+ELEMENT_SOLID and wrapper keywords only. The CLI validates all connectivity
and coordinates on readback, refuses existing output paths, checks disk reserve,
and renames the candidate K last. I/O failure can leave an unpublished partial
directory; it is not announced as a successful candidate.

Supported bounds: even `faceSegments`6..24, even `capSegments`2..n-4,
`radialSegments`4..24, `capLayers`1..m-2, cube half-width/radius0.25..0.5.
`elementLimit` defaults100000 and cannot exceed200000. A conservative support
allocation upper bound is checked before building; it may refuse a budget that
would fit the final exact count. Optional minimum corner SJ defaults0.2 and is
never lowered automatically. There is no guarantee that all legal seed/shape
combinations meet that quality gate.

## Acceptance

- Exact reference tensor core connectivity, once only; every original parent
  survives in lineage, unchanged far parents retain their eight original nodes.
- All original coordinates retained; no repeated cell or illegal H8 connection.
- All corner scaled Jacobians and eight Gauss-point determinants; explicit SJ
  threshold, minimum edge and edge-aspect report.
- Shared-face incidence at most two, no hanging faces, all exposed vertices on
  the sphere and a closed exterior quad two-manifold of Euler characteristic2.
- Volume from H8 integration agrees with independently integrated exterior Q1
  face flux at the unchanged1e-8 relative bound. This is **discrete** closure.
- Analytic ball volume deficit, spherical node error and projection volume
  change are separate reported quantities. A coarse Q1 sphere is not the exact
  analytic solid simply because its boundary nodes have exact radii.

Sampled Jacobians do not prove global injectivity or positivity everywhere.
Mesh verification does not certify a particular mechanics model or solver run.

## Research Status

The public course [球渐变网格划分](https://www.bilibili.com/cheese/play/ss537659138)
by [III天涯III](https://space.bilibili.com/85850308) lists1-to2 and1-to3 lessons.
The public high-resolution cover shows a fine visible pole-region pattern and
coarser surrounding surface. A surface image alone cannot establish internal H8
connectivity, radial count changes or an exact match to this independent method.
Only the public metadata/cover and authorized preview were inspected; protected
lesson content was not obtained or used.

The complete R10 K, independent audit, actual LS-PrePost section views and final
1127-test regression are recorded in [SOLID_SPHERE_VALIDATION.md](SOLID_SPHERE_VALIDATION.md).
