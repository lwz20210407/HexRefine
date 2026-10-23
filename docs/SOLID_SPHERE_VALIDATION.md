# Solid sphere: first complete 2:1 cap case

Validated2026-10-24. Entry and parameter semantics: [SOLID_SPHERE.md](SOLID_SPHERE.md).
This is a bounded generated full ball, **not** completion of general imported
O-grid/WB/multiple-front capabilities or the paid tutorial's exact topology.

## Reproduction

Build the project and use the version1 request in SOLID_SPHERE.md with R10,
faceSegments16, radialSegments8, capSegments8, capLayers2, cube fraction0.4,
minimum corner SJ0.2 and maximum face-interior displacement fraction0.002.

```shell
npm run build
node scripts/generate-solid-sphere.mjs request.json NEW_DIRECTORY
```

The +Z cap is a curved **block-coordinate rectangular footprint**, not a circular
geodesic radius selection. All selected128 original volume parents are refined
once in three directions. The center cube and other radial blocks remain solid
and coarse. This distinction is visible in the published full and section views.

## Complete K Evidence

| Metric | Result |
|---|---:|
| Full nodes / H8 cells |19139 /18168|
| Original coarse parents |16384|
| Selected core parents / children |128 /1024|
| Transition / unchanged far cells |1056 /16088|
| Whole / core minimum corner SJ |0.2178273569 /0.9695755657|
| Independent minimum eight-Gauss determinant |0.00357956817 mm^3|
| Maximum transition edge aspect |5.4742324|
| Exact original-coordinate prefix |preserved|
| Far-parent connectivity |preserved exactly|
| Core reference grid |27 points and8 exact tensor connections per parent|
| Complete-face-connected volume components |1|
| Exterior faces / surface Euler / volume Euler |1792 /2 /1|
| Exterior vertex links |each a single cycle|
| Independent K boundary radius error |7.3e-14 mm maximum|

The full K SHA256 is
`7bff5c000eacf9e98743daa54f194ec6d3b5713525870294d3e2cbfe04390831`.

PyDYNA imported both full candidate and coarse-reference files. NumPy/SciPy
then independently checked every corner and Gauss sample, node/cell validity,
duplicate elements/nodes, exact far connectivity, core expected nodes and cell
connections, all shared faces, exterior edge and vertex links, body connectivity,
surface and volume Euler characteristics. This is not a local-patch substitute.

## Volume And Geometry Are Different Checks

An initial pointwise Q1-mapped transition attempt closed globally but failed an
independent **unprojected parent** volume check. It was rejected, not presented as
the accepted K. The production path now uses the existing canonical face-flux
kernel through a separate generated-cap adapter that validates its reference
coordinates, local template families and initial physical Q1 coordinates. The
existing arbitrary-local-sweep strategy guard remains unchanged.

In the accepted case,100 transition faces are corrected, maximum node movement
0.00124884318mm, or0.153784% of the source face's shortest edge. The explicit
budget is0.2%; no SJ, volume, merge or displacement threshold was relaxed during
the accepted operation. Tensor core interfaces, old edge/corner points and coarse
far field are fixed. Maximum parent volume error after assembled-node sharing,
before sphere projection, is1.31e-15 against the unchanged1e-8 gate.

New external nodes are subsequently projected to the analytic sphere. This
deliberately changes the discrete exterior.96 original parents touch projected
nodes; the discrete volume increases by1.563898885mm^3. Other parents retain
volume to7.8e-14 relative error after K readback. No claim of exact old Q1 surface
retention is made on corrected faces.

The candidate's discrete volume is4170.489728272mm^3. Independent quadrilateral
boundary-flux integration agrees to2.2e-16 relative error. Analytic ball volume is
4188.790204786mm^3, a separate0.436892% approximation deficit. The latter is not
hidden by increasing the1e-8 discrete-conservation threshold.

## Regression And Presentation

- Final `npm test`: **1127/1127**, zero skipped, zero expected failures. Includes
  main and public-contract type checks, build, existing face-flux tests and23 new
  sphere/API/CLI tests. Lower-capacity seeds can be refused by the unchanged
  requested SJ or face-displacement budgets; legal counts are not a success promise.
- The first full run had one stale embedded-standalone-runtime mismatch. Rebuilt
  from the final dist and reran the entire suite; the original failed log is kept.
- Full R10 request replay produced byte-identical K, coarse baseline and lineage.
  Rejected and duplicated current-task outputs totaling10144193bytes were deleted
  after hash verification; failure summaries, replay hashes and the accepted K stay.
- Five actual LS-PrePost images: complete sphere top/ISO, body section/section ISO,
  and the **entire** core plus transition volume. Display subsets retain source
  element/node maps and are labelled as such, not new certified partial models.
- HTML checked at1440x1000 and390x844: all6 images loaded, links valid, no page
  exceptions or horizontal document overflow. Native PNGs remain unmodified.

Evidence root:
`F:/PythonWoking/temp/20261024-solid-sphere-native/`.
Review:`REVIEW.html`; accepted K:`sphere-r10-cap-2to1-conservative/mesh.k`;
independent audit:`independent-audit.json`; full tests:`full-tests-final.log`;
replay/cleanup:`replay-and-cleanup.json`; HTML QA:`review-qa.json`.

Mesh verification is not solver validation, global injectivity certification or
an engineering assessment for a particular material/contact/loading model.
Arbitrary oriented/circular caps, concentric spherical shells, multilevel/3:1
sphere transitions, block-seam refinement and GUI remain explicit TODOs. The R1
shared-face conflict and general WB/multi-front tasks are not marked complete.
