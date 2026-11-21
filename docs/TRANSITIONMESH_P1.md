# TransitionMesh P1: CAD Tube And Local H8 Replacement

These are bounded workflows. None imports arbitrary Abaqus selections,
plans general CAD blocking, nor silently installs nonconforming transition
meshes. The existing CAD frontend and experimental swept-block modules are
independent.

## STEP/BREP Hollow Tube To AXIAL_SURFACE

Use the optional pySMESH environment. From the HexRefine repository:

```text
python -B tools/plan_transitionmesh_tube.py inspect SOURCE.step
python -B tools/plan_transitionmesh_tube.py plan SOURCE.step --expected-sha256 HASH_FROM_INSPECT --fine-face CAP_ID --ratios 2 2 2 --target-arc-size 0.7
```

`inspect` returns measured radii, physical axis, cap IDs/centers, units, CAD
volume and source SHA-256. The contract is a single complete tube bounded by
two coaxial constant-radius walls and two perpendicular annular end caps.
Face areas and volume check the analytic interpretation. Partial/partitioned
tubes, multiple solids, CAD splines and arbitrary blocks are refused.

`plan` selects an end by ID and hash and emits the existing
`transitionmesh-v11` JSON request on stdout. Use one of `--fine-segments`
or `--target-arc-size`; the latter rounds up to a complete motif count
without making the nominal outer-circumference pitch larger. Optional
`--fine-regular-width/layers`, `--coarse-regular-width/layers`,
`--radial-layers` and `--stage-depths` place the stage planes within the
measured length. Geometry comes from the CAD model; ratios, near-field
extents and size targets remain user choices. The CAD file is never modified.

Pass the emitted JSON file to `npm run transitionmesh:generate -- REQUEST.json NEW_DIRECTORY`.
The resulting K/INP approximates the analytic cylinder by straight-sided H8;
the CAD volume and discrete mesh volume are not assumed equal.

## Replace A Face-Locked Cavity In A Mesh-Only K

```text
npm run transitionmesh:patch -- host.k candidate.k selection.json --preview
npm run transitionmesh:patch -- host.k candidate.k selection.json NEW_DIRECTORY
```

`selection.json` is either `{"schemaVersion":1,"replaceElementIds":[2495]}`
or `{"schemaVersion":1,"autoSelect":true}`. Both support optional
`expectedHostSha256` to detect changes since preview. Manual selection
uses **original external IDs**. In automatic mode, each candidate boundary
face must match an oriented face in the host. The program follows host
face adjacency without crossing the boundary; it rejects missing,
ambiguous or inconsistent matches without guessing by proximity.

The candidate may be a mesh-only K or a `transitionmesh-v11` JSON request
that generates H8. The candidate must already be in the host coordinate
frame. `--preview` executes the same safety checks as installation, prints
the original IDs and audit to stdout, and writes no files. This does not
search for translated copies or move the candidate.

The selected subset must be face-connected, have at least one
retained neighboring face and belong to a single PID. The candidate must also
be face-connected with exactly the same quadrilateral boundary and exact
coordinates; no tolerance-based node merge is performed. New elements inherit
the replaced PID. All original node records and all unselected element
records are preserved. New node and element IDs are allocated above the
corresponding original maximum; unused original node records remain.

This is a conservative mesh-only entry: plain one-line `*NODE` and H8
`*ELEMENT_SOLID` plus host `*SET_NODE_LIST` and `*SET_SOLID_LIST` are
supported. If a set names a deleted solid or a formerly used node that
would become orphaned, the whole request fails rather than guessing how to
transfer the set. Includes, contacts, loads, materials, keyword variants,
mixed elements and remeshing the exterior faces are not supported. Outputs
are published to a new directory only after the in-memory readback.

Rechecks include matching oriented shared faces, duplicate/nonmanifold
faces, hanging nodes, locked exterior faces, positive replacement corner
and Gauss Jacobians, and removed-versus-installed volume conservation.
This command uses the candidate boundary to locate the cavity. For bounded
inference from a host alone, use the axial command below.

## Infer And Rebuild A Pre-Existing Axial Band From K Alone

```text
npm run transitionmesh:infer-axial -- host.k --preview
npm run transitionmesh:infer-axial -- host.k NEW_DIRECTORY
```

The engine identifies complete annular H8 cross-sections normal to one global
axis, recovers the fine/coarse ports and detects one monotonic 2:1/3:1 band
between regular end regions. It infers the stage planes, widths, radii and
wall layers, then generates the candidate with the native TS axial templates.
No candidate file, CAD model or element-ID list is required.

It uses the existing K precision budget (minimum edge times 1e-8) only to
recognize analytically corresponding points. Candidate exterior points then
take the **original** coordinates; all quadrilateral face connectivity, source
IDs and set restrictions still pass the exact cavity and read-back checks
above. The original K is never overwritten. This does not introduce a band
into a uniform mesh or infer an engineering region of interest. Solid
O-grids, non-axis-aligned imported K, mixed layouts, nonmatching exposed
faces and ambiguous sections are rejected rather than enlarged or snapped.
Successful runs publish `mesh.k`, `candidate.k`, and `report.json`.

The 736-H8 verification fixture had three steps (64/32/16/8) and an
intentionally perturbed interior point. The band was generated anew,
retaining 384 fine-core and 16 coarse-end cells by original ID and
connectivity. Its four stations shared 128/64/32/16 faces.
The complete TC4 compression source has 4,860 H8, of which all 2,970 in
the annotated middle 60% were accounted for by original external IDs.
Its solid O-grid cap has one loop, not two; the axial rebuild refused it
and published no replacement. This is a coverage limit, not a completed
TC4 remesh. Local visual and numerical evidence is in
`F:/PythonWoking/temp/20261121-transitionmesh-infer-axial/REVIEW.html`.

## Verified Fixture

A tilted STEP tube with radii 4/7 and length 12 produced a three-stage
`64 -> 32 -> 16 -> 8` request and 736 H8. In that exported mesh, one stage-2
H8 with original ID 2495 was locally replaced by seven H8. The 735
unselected element records, all 1,212 original node records and both
host sets were retained. Five port faces and the patch's sixth exterior
face were locked. The replacement preserved volume to readback precision;
minimum corner SJ was 0.44224. This verifies local installation, not
automatic generation of a coarsening band on an arbitrary input mesh.

Automatic selection was also exercised on the tilted tube. A V1.1 JSON
request for the isolated band found all 336 original band H8, with 144
shared port faces, and preserved all 400 regular-end elements. A second
case inferred a two-cell cavity and installed eight H8 while retaining
734 original elements and both sets. The preview and written selections
agreed. Both cases had zero replacement volume error on readback.

The optional CAD test requires pySMESH plus a built TS runtime:

```text
npm run build
python -B -m unittest discover -s tools/tests -p test_transitionmesh_cad_tube.py
node --test test/transitionmesh-keyword-patch.test.mjs
node --test test/transitionmesh-infer-axial.test.mjs
```
