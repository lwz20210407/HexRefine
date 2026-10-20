# Native Uniform Reinforced Concrete

Status: initial uniform-grid subset of Code_Creat4. The graded Code_Creat5
subset has a [separate contract](GUI61_NATIVE_REINFORCED_GRADED.md). Neither is
a complete runnable LS-DYNA analysis deck. Production generation
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
Shared bar intersections may also share rotational degrees of freedom depending
on the beam formulation/releases; this is not automatically a sliding joint.

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

GUI integration, quantity optimization and named-set archive/replay are now
implemented. Still outside the uniform generator: asymmetric six-face covers,
embedded/bond-slip coupling, sections/materials, industrial-scale acceptance
and engineering solver validation. See [RC completion](GUI61_RC_COMPLETION.md)
for current coverage rather than interpreting this as an unimplemented family.

## Quantity Optimization

`elementLimit` caps solids plus active beams (excluding hidden Z bars).
Without `optimizeMeshSize: true`, exceeding it is an explicit error, not an
implicit size change. With optimization, the planner chooses the finest
feasible candidate on a bounded size lattice, without generating meshes for
every candidate. Dimension error is nonmonotone under count rounding, so the
planner enumerates bounded candidates rather than applying a monotone search
to all constraints.

```javascript
{
  // Other uniform reinforcement parameters as above.
  elementLimit: 1800,
  optimizeMeshSize: true,
  dimensionPolicy: 'source-aligned',
  maximumRelativeDimensionChange: 0.2,
  meshSizeSearch: {
    minimum: 0.5, maximum: 2, step: 0.001,
    maximumTotalRelativeDimensionChange: 0.2
  }
}
```

The default interval is [0.5,2] times the requested size. Default step is
`10^(trunc(log10(requestedSize))-3)`, based on the original initial-size
scale. The lattice is anchored at the requested size. It is limited to
100000 candidate indices; no feasible candidate means no output. This is
not a claim that no solution exists outside the declared interval.

Every candidate respects existing `dimensionPolicy`, an absolute per-axis
relative dimension bound, the sum of those absolute errors, valid bar spacing,
active-element limit and allocation guard. The total-error bound defaults to
`maximumRelativeDimensionChange`. `preserve` never relaxes its geometry rule
to satisfy an element budget. Counts, requested/effective mesh size, actual
dimensions/covers/spacings, errors, search domain and evaluations are returned.
Mesh generation and beam-length audits use the resolved size, not the request.

For requested size20x12x8, meshSize1, barCounts4/3/3, cover1, limit1800 and
per-axis/total error bounds0.2, the native size is **1.171**, dimensions
**19.907x11.71x9.368**, 1360 solids and 369 beams (273 with Z bars hidden).
Absolute relative error sum is about0.199817. This is a real dimension change,
not rounding noise, and requires explicit source-aligned consent. With strict
geometry preservation this particular budget/range is refused.

Original MATLAB optimizer probes exposed two limitations: exact equality at
the target reaches an undefined `T` in empty-list selection, and the 1800
target above reports no feasible candidate. Replaying its unchanged parameter
function at size1.171 succeeds and matches native dimensions/counts/covers.
TG generated from that resolved-size replay, after the already documented
X/Y beam-count correction in a copy, matches native beam geometry within
reference writer precision. This is not described as successful replay of
the original optimizer. The original raw failures remain evidence.

At target3000 the tested source/native optimizer retains size1; native handles
the exact2340 target without the source empty-list failure. Optimization-off
over-limit and strict-dimension cases explicitly refuse. Native search may
choose a different feasible candidate than other source inputs; it is a
documented deterministic bounded implementation, not bitwise source replay.

Validation: eight input states x separate/shared = twelve successful decks
and four refusals; fixed source-parameter replay for the two1800 cases.
Independent PyDYNA checks cover volumes, bounds, IDs, endpoint sharing,
orientation and beam lengths. `test/reinforced-uniform-budget.test.mjs`
checks both coupling choices, Z gating, exhaustive candidate agreement,
dimension bounds and malformed/oversized searches. No TG/MATLAB runtime is
required for the native tests or generator.

Evidence: `uniform_budget_oracle`, `uniform_budget_native`,
`uniform_budget_views`, `UNIFORM_REBAR_BUDGET.html` under the dated validation
directory. The HTML distinguishes raw optimizer failure, resolved-size
parameter replay, corrected TG and native results.
