# Scoped Exact Face Compensation

`tools.bolthex.exact_face_compensation.compensate_faces` joins explicitly
paired Q4 faces on an explicit allowed set of element IDs. This is not a
distance-based global node weld or a general nonmanifold-mesh repair tool.
The two faces must have four distinct, exactly coincident coordinates and
opposite cycles. Near-coincident points are rejected, even at1e-12mm.

Each equivalence class retains the node used by protected elements. If two
different members are required by protected elements, the operation rejects.
Otherwise the lowest NID is the deterministic master. Every reference change
must remain within the explicit allowed set. All coordinate rows, element
IDs and PIDs are preserved; unused slave node rows are intentionally retained.
The original mesh object is not modified.

Checks include eight distinct node references in changed H8s, unchanged
per-element geometry, no face with more than two owners, opposite shared
cycles, preservation of existing shared faces, and complete closure of the
requested pairs. These do not certify global vertex/edge links, continuous
Jacobians, or whole-model engineering validity. The report keeps those
acceptance flags false. Inputs require the existing valid basic H8 identity
and face-incidence conventions used by the repository importer.

```python
new_mesh, report = compensate_faces(
    mesh, [((eid_a, local_face_a), (eid_b, local_face_b))],
    allowed_element_ids=explicit_ids,
)
```

## Actual Screw Head Case

The user approved necessary local head-contact topology compensation while
preserving head shape, distant mesh, thread and the original files. The
actual68-edge geometric contact envelope had four split-NID junctions.
Selecting the narrower full coincident face at each junction, rather than
joining only the four top vertices, requires eight exact alias pairs.

The reviewed phase-preprocessed6128-cell source was tested:

- Four complete face pairs joined; shared-face count14115to14119.
- Only16element rows /24node slots changed, not all332contact elements.
- All coordinate rows and all per-element point coordinates remain unchanged.
- The top68-edge cycle is now NID-closed with68distinct nodes.
- The changed-region corner/centre minimum SJ remains0.5811964948958561;
  all geometry-based quality arrays are identical before/after.
- Actual K and independent INP roundtrips preserve geometry/connectivity.
- Original source files and protected rows remain unchanged.

This does NOT align the neck footprint, fill the axis, repair all inherited
head seams, or certify a whole Screw. The actual intermediate K/INP carry
an explicit NOT ACCEPTED WHOLE MODEL heading. They are IO/control artifacts,
not a successful final mesh.

Evidence and reproducible case script are under
`F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm/iges-production-screw-20261107/screw-study/`:
`head_contact_compensation_case.py` and `head-exact-face-compensation-v1/`.

Seven targeted test methods passed with the actual source case enabled:

```powershell
$env:HEAD_COMPENSATION_CASE = '<actual-case-directory>'
python -B -m unittest tools.tests.test_exact_face_compensation -v
```

Other tests cover exact versus near coincidence, explicit scope rejection,
orientation/binding errors, input immutability and protected-master selection.
