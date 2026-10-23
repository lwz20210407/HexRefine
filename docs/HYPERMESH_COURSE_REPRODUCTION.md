# Local HyperMesh Course Reproduction Matrix

## Evidence Scope

2026-10-24 inventory:10 local videos,8 HM databases,23 archive attachments.
Original videos/archive remain read-only under the user's Baidu download folder.
Only this capability matrix and our implementation are public; course videos,
HM databases, extracted geometry/connectivity, screenshots and derived reference
Ks stay in the private dated validation directory. No course asset is added to Git.

HyperMesh2022.3 batch read all8 HM databases. The built-in LS-DYNA export template
silently omits some unsupported legacy element/card configurations and returns
warnings. Those partial exports are **not** our reference. A separate Tcl API
extraction obtains original IDs, component IDs, coordinates, configurations and
all element connectivity. Local mesh-only Ks are written from those records,
then imported independently with PyDYNA. H8 and six-node wedges are counted
separately; temporary2D construction elements are exported separately, not
mistaken for missing solids or silently mixed into the solid model.

These are geometry/connectivity references, not solver-deck conversions preserving
materials, contact, sets and analysis state. A successful reference export is not
a native HexRefine reproduction or an engineering acceptance certificate.

## Attachment Matrix

| Lesson / local HM | H8 | Wedge6 | Auxiliary2D | Native status / main gap |
|---|---:|---:|---:|---|
| Plate /pingban |8880|0|151|Readable pure-H8 reference; exact multi-block reproduction not yet certified|
| Flange /lesson2 |65216|704|388|Mixed topology; partitions/sweep and wedge semantics not covered by H8 refinement|
| Bracket /lesson4 |4386|192|714|Mixed topology plus CAD partition/sweep planning|
| Cylinder /lesson5-yuanzhu |7100|0|284|First independent exterior-dense native prototype validated below|
| Bolt /lesson6 |238068|2480|2234|Mixed topology, thread geometry and swept-block decomposition|
| Cavity /lesson7 |20015|2235|1116|Mixed topology and interacting sweep regions|
| Helical gear /lesson8.1 |10160|40|1181|Twisted sweep/geometry and mixed-cell interfaces|
| Pipe /temp02 |51576|1352|0|Branch/intersection partitions and mixed topology|

All8 references complete PyDYNA readback and type-count checks. Positive integrated
volume is not sufficient: the flange's original H8 minimum cornerSJ is about-0.35
despite positive integrated volumes. It is an explicitly defective reference, not
a topology/quality truth to copy blindly. Wedge corner degeneracies are not treated
as negative H8 Jacobians; they require their own element convention and tests.

## Cylinder Video And First Native Prototype

The14:34 cylinder video states exterior-dense/center-coarse intent near00:19-01:44,
chooses a3:1 in-plane transition near07:24-09:28, and extrudes50 units in25 uniform
layers near12:21-13:22. Frames at09:50 and12:30 confirm the annular transition and
coarse center. At13:19 the instructor explicitly calls it single-direction grading;
it does not demonstrate simultaneous axial grading. ASR timestamps are approximate,
and numeric geometry is cross-checked against the actual attachment.

The HM solid reference is R20/H50,25 layers,284 section quads,7100 H8, minSJ0.63097,
with a closed Euler2 boundary. It is not the same refinement orientation as our
existing center-dense/outward-coarsening concentric generator.

An independent Node prototype now combines the native mapped core with the existing
Q1 four-cell3:1 transition, **radially reversed with positive cell orientation**,
an exterior regular annulus, and uniform H8 extrusion. It needs neither HyperMesh,
MATLAB nor TrueGrid at generation time. R20/H50, R15-18 transition,6->18 angular
intervals per quadrant and25 axial layers produce8700 H8, minSJ0.643016. Independent
PyDYNA/NumPy checks cover all corners/eight Gauss points, volume, closed face/edge
incidence and expected exterior location. Different348-vs284 section cell counts
and connectivity are disclosed; this is not byte-identical or topology-identical
course replay, nor evidence that8700 cells are preferable to7100.

The fixed native example is reproducible from the repository:

```text
npm run build
node scripts/generate-exterior-cylinder-example.mjs NEW_OUTPUT_DIRECTORY
```

It writes a readback-checked mesh-only K and report, refuses overwrites, and requires
a1GiB disk reserve. Two example tests exercise full generation/counts/hash/conformity,
overwrite protection and invalid destinations. These run in addition to the1130-test
macro/kernel checkpoint. A **general parameterized** exterior-dense generator/API,
seed/width planning,2:1 variants, axial coupling and GUI remain incomplete. One fixed
example does not mean every geometry or course case is integrated.

## Next Work

- [x] Read-only inventory, actual batch extraction, independent K/type verification.
- [x] Inspect cylinder video plus reference K, classify reverse-density requirement.
- [x] Independent full-solid cylinder prototype, not only surface mesh.
- [x] Repository-native fixed example CLI, roundtrip/hash/overwrite/refusal tests.
- [ ] General exterior-dense circular/prism interface, parameter validation and test matrix.
- [ ] Complete plate/full-attention-region native reproduction, not just local boxes.
- [ ] Video/mesh partition study for flange, bracket, bolt, cavity, gear and pipe.
- [ ] Mixed wedge retention/refusal contracts and source-quality repair policy.
- [ ] CAD block decomposition, generalized curved/twisted sweeps and intersections.
- [ ] Simultaneous axial/radial density changes where required, without confusing
  a uniform extrusion with an axial transition.

Local evidence: `F:/PythonWoking/temp/20261024-r1-shared-face/REVIEW.html`.
R1 is tracked separately in [R1 correction](R1_SHARED_FACE_CORRECTION.md); this
course work does not silently close generic3D WB/multi-front TODOs.
