# Concentric seed proposals

`planConcentricSeeds(request)` is a count-only advisor for the native coupled 2:1
concentric generator, not an installer on an existing K mesh or a minimum-cell solver.

Version-1 input contains `parameters: ConcentricCircularSpec` and `targets`:
`maximumRadiusSpacing`, `maximumArcSpacing`, `maximumAxialSpacing`. These are positive
nominal intervals on a complete quadrant radius, its arc length, and core Z axis.
They do **not** bound every interior mapped edge; actual quality still needs generation.

The advisor never reduces an existing seed count. It rounds the requested arc count
up to a multiple of `2^L`, the axial count to `2^(L+1)`, and ensures
`radiusSegments > arcSegments/2`. The axial rule is the current periodic template
contract, not a theorem forbidding other end-layer constructions. Radius, height,
core radius, ring positions, radial policies, fraction and budgets remain unchanged.
New seed counts can change the mapped interior geometry, element numbering, effective
default patch join and core element count. This is an explicit new-generation proposal,
not a promise to preserve an existing mesh's nodes.

Both motif and full count budgets are checked before allocating a mesh. Budget failure
does not trigger hidden coarsening. The result records old/new counts, actual nominal
intervals, the full count plan and `topologyAndQualityAudited:false`. Planning success
is not mesh acceptance. Use the native generator or width planner for sampled-Jacobian,
conformity, volume and edge-quality audits, without lowering their existing gates.

```text
node scripts/plan-concentric-seeds.mjs seed-request.json NEW_PLAN_DIRECTORY
node scripts/plan-concentric-widths.mjs width-request.json NEW_WIDTH_DIRECTORY
node scripts/generate-concentric-circle.mjs resolved-request.json NEW_MESH_DIRECTORY
```

The seed CLI writes `resolved-request.json` and `seed-report.json`, refuses existing
destinations and inputs above64KiB. The resolved request imports directly into the GUI
or feeds the streaming generator. Width planning additionally needs explicit criteria.

Verification: `test/concentric-seed-planner.test.mjs`,
`test/concentric-seed-cli.test.mjs`, and `test/types/concentric-seeds.contract.ts`.
The R48/H16/Rcore16 example resolves seeds39/63/31 to40/64/32, retaining four rings.
Seed planning yields57320 cells; explicit width planning subsequently yields56640,
with49152 core cells and sampled minimumSJ0.304802. Full K evidence is separate from
the count proposal itself; see `THREE_NATIVE_MODULES_VALIDATION.md`.
