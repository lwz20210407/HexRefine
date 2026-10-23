# Native whole-parent O-grid macro fields

`refineOgridMacroField(mesh, options)` installs trusted complete H8 macros into an
existing mesh. This is a public bounded installation entry, not the experimental CinoLib
reference generator and not an arbitrary external replacement-plan loader.
It is a bounded **axial face-field** installer, not general3D edge/vertex WB coverage.

## Contracts

- `mesh` is a conforming H1 mesh with finite3D nodes and positive sampled source
  Jacobians. `targets` explicitly names one-based imported parent indices and
  exact levels1/2/3. These receive respectively8/64/512 tensor children, once.
- Every shell parent has one fine interface perpendicular to the declared
  physical `axis`0/1/2. Non-axial interfaces, colliding/two-front shells and
  adjacent unequal exact tensor cores are refused, not silently promoted.
- Existing vertices never move. Untouched parent connectivity is checked exactly.
  No circular-sheet coarse topology compensation or Cartesian bounding-box fill
  occurs. New transition-face nodes can use the existing explicit bounded
  conservative-flux policy; that is not pointwise retention of the old Q1 face.
- Default `shellLayers:1` is compact. `shellLayers:2/3` spreads level drops over
  additional original parents, reached only across the opposite axial face.
  `maxAdditionalShellParents` defaults0: expansion therefore needs explicit consent
  and a count budget. Every added transition parent is reported. No outside parent
  is silently made a uniform core/support parent; the remaining declared far field
  stays exact. This does not promise to retain all coarse cells of a compact plan.

`maxOutputElements` defaults2M (also the supported upper bound), `maxShellParents`
4096 (upper8192), and `maximumSearchDecisions`4096 (upper100000). Counts include
all tensor cores and complete shell macros before allocating them.

## Complete templates, not harvested samples

The native compiler runs trusted seven-Hex fields on a small reference support
block, carries exact dyadic interpolation supports and extracts **all** children
of each source parent. The cached tables are immutable. It supports fine level
`d` and coarse level `c`, `0 <= c < d <= 3`:

```text
children = 8^c + 4^c * (2 * 4^(d-c) - 2)
```

| d / c | Fine face quads | Coarse face quads | Complete parent H8 |
|---|---:|---:|---:|
|1 /0|4|1|7|
|2 /0|16|1|31|
|3 /0|64|1|127|
|2 /1|16|4|32|
|3 /1|64|4|128|
|3 /2|64|16|160|

For example, a two-parent level2-to0 shell contains32+7 cells. It is not the
experimental CinoLib39-cell dual just because the cell counts coincide. The outer
contracts, parent ownership and reference geometries differ.

Oriented candidates require exact original-node interpolation-weight face
partitions, without rounding deep coordinates to a1/64 weight grid. CSP propagation,
recognized affine support solving or bounded backtracking select a complete field.
A shared-face witness is verified before physical mapping. Three-/five-valent
source-edge groups are certified only as parts of that compatible field, never
inserted independently with unverified side walls. The incomplete9-Hex harvest is
not used. Reflections are represented by the compiled/checker families: a separate
audit finds48/48 boundary variants for7/31/127, and6/6 for the symmetric32/128/160
families. This is boundary-vocabulary closure, not exhaustive interior optimization.

## Shape And Quality

Finite axial power maps and bounded monotone station proposals keep original
planes and tensor core coordinates fixed. The station planner uses edge lower-bound
difference constraints and earliest/latest blends; on tapered/warped cells it is
only a proposal, not a physical quality proof. A1% stricter proposal may be tried
first; fallback changes only the proposal, never the requested acceptance floor.

Acceptance always checks positive corner/eight-Gauss samples, exact count and
lineage, interface conformance, core precision and every original-parent volume
at the unchanged1e-8 bound. `minimumCornerScaledJacobian` optionally gates the whole
result. `minimumTransitionToCoreEdgeRatio` optionally gates actual merged edge
lengths, not just the proposed stations. No gate is lowered to rescue a candidate.
Sampled Jacobians are not a proof of positivity everywhere or nonlocal nonoverlap.

`exteriorPhasePolicy` defaults `level-closed`: non-axis diagonal **endpoint** station
patterns agree across a connected exterior field. Lateral `symmetryPlanes` must
be actual exterior coordinate planes; they exempt only phase comparisons, never
shared-face conformity. Explicit `unconstrained` mode can admit valid free-surface
stars without claiming a level-closed ring. The certificate is normalized-reference
closure; physical end-height variation and disclosed normal corrections are checked
separately in the real K audit. Periodic staircase traces are not a single perfectly
horizontal line.

## Output And Limits

Output includes source-parent lineage, uniform/role flags, exact far-field parent
indices, expansion IDs, corner groups, trial diagnostics, per-parent errors and
actual core/transition edge statistics. `quality` is the changed-patch summary;
`minimumOverallCornerSJ` additionally includes untouched far-field cells.
All topology indices in this API/report are import-ordinal, not external K IDs.

Finite-vocabulary failure is not a theorem that no hexahedral fill exists. The error
records encountered shared-face/phase conflicts, explicitly not a minimal core.
The general CinoLib edge/vertex schemes, non-axial/multi-front transitions, material
interfaces, arbitrary valences and solver-state migration remain open. No new GUI
parameter controls are implied. See [CLI](OGRID_MACRO_FIELD_CLI.md) and
[full-ROI validation](OGRID_MACRO_FIELD_VALIDATION.md).
