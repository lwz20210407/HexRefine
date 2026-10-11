# Native Uniform Reinforced Concrete

Status: initial uniform-grid subset of Code_Creat4, not the graded Code_Creat5
branch and not a complete runnable LS-DYNA analysis deck. Production generation
uses only TypeScript/Node. MATLAB/TG remain independent development oracles.

## Explicit Choices

```javascript
generateUniformReinforcedMesh({
  size: [20, 12, 8], meshSize: 1,
  barCounts: [4, 3, 3], cover: [1, 1, 1], includeZBars: true,
  connectivity: 'separate', dimensionPolicy: 'preserve',
  concretePartId: 3, rebarPartId: 2
});
```

`barCounts` gives bar-position counts along X/Y/Z, not beam subdivision counts.
Bars run across the full dimension parallel to their own axis, following the
source. Cover offsets locate the orthogonal bar families; they do not shorten
both ends of every bar. Hiding Z bars is represented explicitly by
`includeZBars: false` and actually removes that family.

X/Y covers and spacings round to mesh intervals; Z covers/spacings round upward,
following the source count rules. The plan reports all resolved values.
`dimensionPolicy: 'preserve'` rejects any non-roundoff outer-size change.
`'source-aligned'` permits changes only within an explicitly supplied
`maximumRelativeDimensionChange`; its default is zero. Both shrinkage and
growth are checked, repairing the source's signed-only distortion test.
Cover adjustments are reported with warnings, not silently called exact inputs.

Connectivity is mandatory, with no silent default:

- `separate`: each bar line retains independent endpoint nodes, including at
  bar crossings. No embedding/contact/bond coupling is generated.
- `shared`: mesh-aligned endpoints refer directly to the concrete grid node
  IDs, also sharing intersections. This imposes common translations and is an
  explicit modeling choice, not a general bond-slip law.

Orientation nodes are separate geometric helpers. NODE/SOLID/BEAM output uses
per-record PIDs, globally distinct element IDs, and noncollinear N3 nodes.
No material, section, steel diameter, load, or constraint cards are inferred.
The applicable beam formulation remains the analyst's responsibility.

## Mixed Keyword Contract

`meshToLsdynaMixedKeyword` accepts dense one-based nodes, explicit solid and beam
records, and fixed-field coordinate options. It rejects duplicate IDs,
invalid references, repeated connectivity, zero-length beams and collinear
orientation nodes. Beam fields follow LS-DYNA R11 Vol. I, ELEMENT 17-5 and 17-8:
EID/PID/N1/N2/N3/RT1/RR1/RT2/RR2/LOCAL. Native output uses zero releases and
LOCAL=2. N3 may be optional for some solver formulations, but this writer's
current contract deliberately requires an explicit valid orientation node.

`parseNativeLsdynaMixedKeyword` is a strict read-back for this native mesh-only
subset, NOT a general LS-DYNA parser. Unknown solver cards and release/local
overrides are rejected rather than silently lost. PyDYNA is used independently
for reference/native verification.

CLI kind: `reinforced-uniform`. Outputs are `mesh.k`, `report.json`,
`node_sets.json`, and `cell_sets.json`. No fictional refinement lineage is
created for this newly generated uniform mesh.

## Measured Results and Source Fix

For size 20x12x8 and mesh size 1, source X/Y beam subdivision counts were swapped.
The source reported 420 beams but TG produced 444; with Z bars hidden it reported
324 but produced 348. A count-corrected TG copy produced 420/324, with segment
length 1 in all directions. This bug was invisible in equal-X/Y examples.

Native separate/shared modes, each with Z bars on/off, passed independent
PyDYNA/NumPy audits: 1920 solid cells and 420/324 beams, no solid internal free
faces, corner SJ 1, positive Gauss determinants and volume 1920. Separate mode
has zero shared concrete/beam endpoint IDs. Shared mode has 381/309 shared
endpoint nodes. Ordinary beam orientation nodes are noncollinear.

Local evidence: `F:/PythonWoking/temp/20261011-hexrefine-gui61-validation/rebar_oracle`
and `rebar_native`. The raw reference has PID 3 for concrete and PID 2 for bars,
independent nodes and no coupling cards. Coincident coordinates alone do NOT
prove mechanical coupling. A repeated N3 is not automatically a solver error
for every formulation; native output avoids that ambiguity without claiming
solver validation of the raw or generated decks.

Pending: graded concrete reinforcement, asymmetric six-face covers, count-budget
optimization, embedded/bond-slip coupling, sections/materials, GUI integration,
large models and engineering solver validation.
