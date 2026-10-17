# Bounded GUI61 Interface Repair

Date: 2026-10-18. The five-Hex subset is now supplemented by a separately
validated 15-node/four-Hex corner family and a GUI JSON repair entry. This is
not a general hex repair engine or completion of every v15/v16/vv15/vv16 case.

## Corner Family and GUI

`repairGui61Interfaces(mesh, options)` matches either the existing five-Hex
family or the corner-four family. `repairGui61FiveHexInterfaces` retains its
original restricted behavior for compatibility. Each result includes a
`repairs` array identifying the actual template and child count per parent.

The corner pattern uses 15 nodes, not the 16-node `refineHexTo4Hex` slab.
Its two bottom-edge cut fractions may independently be 1/3, 1/2 or 2/3, with
a half-height intermediate sheet. These fractions are local cut locations,
not a claim of arbitrary mixed refinement ratios. One-wall repair treats the
detected split wall as the primary bottom face, matching the v15 contract;
two/three-wall cases must match all detected face partitions. Other fractions,
cap heights and adjacent damaged-parent joint replacements remain unsupported.

The recovered MATLAB v15 function was actually executed for all nine fraction
pairs. All four native cells match the MATLAB cells by geometric node sets;
minimum corner SJ matches (approximately 0.371 to 0.577), with volume error
below 2e-16. Runtime cases were saved separately; recovered MATLAB source was
not modified or copied into the repository. Native coordinate construction
uses trilinear reference mapping instead of physical offset addition.

`generateGui61Repair(request)` is the shared browser/CLI adapter. The workbench
has an `接口修复 JSON` entry accepting the versioned request below, or its exported
report archive. It previews and downloads validated NODE/SOLID K, including
inherited PIDs. It does not directly import arbitrary full K decks. GUI request
size is limited to 25 MiB; larger requests use the CLI.

Repair snapshots cannot transfer into the ordinary geometry-only refinement
session because that would drop their explicit part metadata. Failure leaves
the old displayed geometry untouched and disables stale downloads. HTTP worker
mode, archive replay, rejection, mobile layout, K download and offline standalone
mode were exercised in a real browser. The ISO fit was corrected to use projected
box extents so rotated small models remain fully framed.

New evidence: `corner4_oracle.m`, `corner4_oracle/*.json`,
`corner4_comparison.json`, `repair_gui/browser-results.json`, and
`GUI61_CORNER_REPAIR_REVIEW.html` in the same 2026-10-18 validation directory.
Full suite: 784/784 passed before the final camera-fit correction. After that
correction and its regression test, repair/browser targeted tests passed 28/28
and the actual HTTP/offline/mobile browser checks were repeated successfully.

## Five-Hex Contract

```ts
import {repairGui61FiveHexInterfaces} from "hexrefine";
const result = repairGui61FiveHexInterfaces(mesh, {
  parentElementIds: [3965, 4055, 4154, 4244],
  tolerance: 1e-4,
  // partIds: one positive part ID for each input element, when available
});
```

- Input is an H1 `Mesh` with dense one-based node/connectivity IDs. Parent IDs
  are array indices + 1, NOT arbitrary source K EIDs. The API is mesh-level;
  it does not parse or preserve a full solver deck, sets or sparse K numbering.
- Each selected coarse parent must have exactly two subdivided interface
  faces matching the existing `refineHexTo5Hex` template. All 48 axis frames
  (including reflection with connectivity reorientation) are considered.
- Matching uses complete face partitions and actual node identities, not
  proximity alone or just total face area. Distinct valid template solutions
  are rejected as ambiguous; unsupported patterns are not silently altered.
- The absolute tolerance is explicit and capped at 0.001 of the smallest mesh
  edge. It is never increased automatically. Final conformance uses the same
  tolerance; do not choose a tolerance larger than a physical gap.
- Existing nodes remain in the same positions and array slots, including
  unused nodes. Reuse is limited to the selected parent's corners and nodes
  belonging to its detected fine interface faces. No global node merge.
- Unselected element connectivity is unchanged. Replaced parents produce
  five children each. Output `parentElementIds` maps every output cell back
  to an input dense ID, allowing a caller to transfer PIDs explicitly.
- If `partIds` is supplied, a detected cross-part repair is rejected. Without
  it the caller asserts that all selected interfaces are within one material
  domain. Beam/shell/solver metadata is outside this mesh-level contract.
- Validation rejects invalid/duplicate connectivity, faces with more than
  two owners, nonpositive corner/Gauss Jacobians, changed parent volume and
  unresolved hanging interfaces anywhere in the output. No partial result
  is returned and input arrays are not mutated on success or failure.

Positive sampled Jacobians and face matching are not a formal global
non-intersection proof for arbitrarily warped hexes. Only the stated supported
templates and tested geometries are certified; this is not mesh untangling.

## Versioned CLI

`node scripts/repair-gui61-interface.mjs request.json NEW_OUTPUT_DIRECTORY`
accepts `{schemaVersion:1, mesh, repair}` with the mesh and options above.
It outputs `mesh.k`, `mesh.json`, `lineage.json` and `report.json` only after
validation, and refuses an existing output directory. It does not accept a
full K deck. Unknown solver metadata is rejected instead of discarded.
Dense original node IDs remain unchanged; output EIDs are dense, with lineage
to input dense EIDs. Optional PIDs are inherited through that lineage; if absent,
the report explicitly records PID 1. K is read back for connectivity/PID,
coordinate precision and conformance before any output is written.

## Source and Evidence

The recovered GUI61 chain `EliminateTrBB -> EliminateCoupledArea2 -> v16`
replaces local coarse cells at incompatible TG interfaces. This implementation
reuses HexRefine's existing five-Hex template and adds explicit partition
matching, identity-safe assembly and independent validation. Recovered source
or proprietary runtime code is not copied into the repository.

The supplied rectangular benchmark `C:/TrueGrid/keyword/juxingbaban.k` and
`OutPut.k` are read-only reference artifacts. The native test repairs four
selected coarse cells, with these results:

| Measure | Original | Native repaired |
| --- | ---: | ---: |
| Nodes | 5566 | 5574 |
| Hexes | 4324 | 4340 |
| Unexpected internal free faces (independent NumPy count) | 40 | 0 |
| Minimum corner scaled Jacobian | 0.3084217122 | 0.3084217122 |
| Volume | 1.8e9 | 1.8e9 |

All original coordinates are unchanged. After a unique coordinate mapping at
1e-4 tolerance, all 4340 hex node sets equal the MATLAB repaired reference.
This is connectivity agreement, not byte-identical K replay. Element order and
the new node numbers may differ. The evidence K is a mesh-only diagnostic copy;
it is not a preserved full analysis deck.

`test/gui61-interface-repair.test.mjs` creates an independent defective seam
by extruding the template's two fine walls and retaining a coarse center.
It covers 48 axis frames, affine skew, lineage, immutable inputs, material
isolation, orphan coincident nodes, invalid selection and incomplete repairs.

Local evidence and reproducible scripts:
`F:/PythonWoking/temp/20261018-hexrefine-repair-validation/`
contains `validate_repair.mjs`, `audit_and_render.py`, `comparison.json`,
`independent_audit.json`, `candidate.k`, and `GUI61_REPAIR_REVIEW.html`.
MATLAB/TrueGrid are not called by the repair API. LS-PrePost is only used to
inspect the reference and candidate meshes.

Validation checkpoint: full TypeScript suite 771/771 passed. The subsequently
added CLI guard/round-trip test and the repair tests passed 7/7 together.
LS-PrePost opened all three models and generated six ISO/section images;
the candidate views were visually inspected. Independent NumPy checking found
2336 expected exterior faces, zero unexpected interior free faces and no
duplicate elements/non-manifold faces after repair. The relative box-volume
error was approximately 3.97e-16.

## Still Open

Other cut fractions/cap heights and parameterized repair patterns, damaged
adjacent-parent joint solving, full-deck ID/set migration and automatic parent
selection are not yet implemented by this entry point. GUI repair accepts a
prepared mesh/parent JSON request, not arbitrary full K files.
It must not be enabled automatically by the ordinary importer.
