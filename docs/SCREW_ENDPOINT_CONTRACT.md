# Original Screw Endpoint Patch Contract

2026-11-07. Bounded extraction and feasibility rejection, NOT an endpoint repair
or an accepted whole Screw. No production IGES/HM code is involved.

## Post-Review Binding Guards

Before candidate construction, every ordered inner corner NID must resolve to
the radial-quarter-4 support of the corresponding original outer macro NID.
This is checked both on frozen loading and at the candidate entry point;
matching report hashes alone does not establish geometric support identity.
An actual 2889/2890 inner-corner swap with a consistently rehashed report now
rejects. Empty or degenerate interface partitions cannot be a shared match.
The updated actual-source endpoint/collar selection passed 57 tests with zero
skips on 2026-11-07 (83.239 seconds), including these regression controls.
The prior closure artifacts below retain their original producer hashes and
are historical diagnostics, not regenerated repaired meshes.

## Bounded 114-To-256 Closure

The next closure run uses an explicit planning scope of114, not112: the
previous112scope plus2926and3971. It executed72complete protected-boundary CSP rounds at
114,116,...,256parents. Every round rejected on shared partitions; none
exhausted its CSP search budget. The deterministic local extension rule never
expanded a retained original region or relaxed a protected cut in the solve.

`next_collar_scope_obligation(result, max_parents=256)` now returns only a
machine-bound adjacent-collar obligation. It checks BODY_IDS, excludes already
selected/retained IDs, refuses limits above256, and does not partially apply
an obligation that would cross the cap. It returns separate statuses for a
matched protected partition, search limitation, no evidenced extension and
parent-budget exhaustion. It does not itself mutate or mesh anything.

The scratch `closure_driver.py` reuses immutable source/template/local-shape
computations but reconstructs and solves every scope's complete protected
graph. Input and producer hashes are checked during the run. Each round has
only a small summary; one complete final contract is retained, not72large
copies. The file budget remains2MiB. A separate fresh process replays the last
full scope without installing any of these caches and compares the entire
JSON-equivalent contract, not just its headline counts.

### Actual Propagation And Stop

- Round1,114parents:3970--3971 on edge6147--6218; next2927,3972.
- Round34,180parents:4003--4004 on edge6213--6284; next2960,4005.
- Round72,256parents:4041--4042 on edge6289--6360; next2998,4043.
- The256parent set is2889..2997,3933..4042,5012..5048, entirely inside BODY_IDS.
- At the last round, all256parents have local candidates (2234total), but the
  complete436-shared-interface CSP rejects. Protected faces:145tooth,
  111valley and268unchanged-collar cuts,524in total. There remain76original
  end obligations; no added external free-end faces.

The next smallest local obligation along this propagation path adds2998and
4043, making258parents. It is recorded but NOT executed. The proposed
orientation replans4042using pattern4 and binds8actual protected cut Q4s and
their opposite collar owners. It is not evidence that258will solve. The
largest actually tested scope is256; a nearest globally solvable scope is
unknown. This is one deterministic obligation path in the35-configuration
library, not an exhaustive search over every possible subset below256, and
not a mathematical impossibility result for general all-hexahedral meshes.

The final readback is concrete:4041has four surviving orientations with
1,2,2,2Q4s on the blocked side, while4042is forced to `two_way7_a` with3Q4s
on that side. Their full oriented support partitions have zero compatible
pairs. This preserved witness is a useful next template-development input;
matching counts alone would still not establish NID/support/cycle conformity.

No protected closure occurred, so no replacement connectivity, new node
allocation or success K was emitted. `protectedPartitionPlan` remains null,
`replacementPatchExported=False`, and `coreFilled=False`. The final1792cells
and node table in the contract are the frozen inspection patch, not a repair.
Its volume sum is1.6614759158278014; the source-parametric macro sum is
1.6614789414486757. Raw local-candidate minimum corner/centre SJ is
0.05322950771007365 and maximum relative macro-integral discrepancy is
0.0005172520277432917. These are not assembled-plan acceptance values; no
.15gate or volume-tolerance relaxation was introduced.

Evidence is retained under
`screw-study/closure-114-256-20261107`: `closure-summary.json`, the72small
`round-*.json` records, `final-contract.json` (1936799bytes), the driver and
fresh-process verifier. Older fixed/replan/112evidence and APIs remain intact.
`uncached-final-verification.json` confirms that a new uncached256-parent run
is equal to the complete final contract, with all72scope transitions verified
and unchanged input/producer hashes. Cached local calculations therefore do
not substitute for the final full protected-CSP replay.
The final combined run in `tests-closure-final.log` passed54tests with0skips,
including old fixed/replan/112controls, closure-budget/retained guards and
the complete propagation evidence. The single full contract is1936799bytes;
the72small round summaries and other evidence are retained for audit. No
replacement patch, source edit, retained-region expansion or commit occurred.

## Explicit 112-Parent Protected-Boundary Result

The explicit112-parent planning scope was executed, not inferred from the
earlier74-parent conditional solution. The protected112-parent CSP is **rejected**.
All112parents have local candidates (236total), but the full148-interface
constraint graph has no assignment in the current35-configuration library.
This is a partition conflict, not search-budget exhaustion, and no replacement
patch or new node allocation is delivered for this rejected scope.

The new optional API argument is `expanded_collar_parent_ids=()`. Default
empty preserves the old74-parent fixed/replan tests. The explicit112case is:

```python
from tools.bolthex.screw_endpoint_contract import EXPANSION_112, build_endpoint_contract

result = build_endpoint_contract(
    original_k, phase_k, frozen_collar_directory,
    core_port_policy='replan', include_neck=True,
    expanded_collar_parent_ids=EXPANSION_112,
)
```

The38additional IDs are2925,3933..3967,3970,5012. They must be distinct native
integer IDs in BODY_IDS, must not repeat the original74endpoint parents, and
the explicit patch is bounded at256parents. Retained/tooth/head/neck IDs,
booleans, duplicate or nonintegral IDs reject before source loading. No
adjacent parent is silently added. The CLI accepts the same additional IDs
after `--expanded-collar-parent-ids`.

The112scope contains784frozen collar H8. Its1136skin faces are classified as:

- 380protected:73retained-tooth,39external-valley,268unchanged-collar cut Q4s.
- 448replannable internal core-port Q4s.
- 308variable annular endpoint Q4s, still bound to the ORIGINAL76source end
  obligations from74parents. The extra38parents have zero added end faces.

### Concrete Failure Witness

Arc propagation rejects the shared macro interface between parents3969and3970,
on source root edge NIDs6145--6216. At that point3969has four remaining
pattern2/pattern4 alternatives, whereas3970has only `two_way7_a`. Independent
oriented-support-face readback finds **zero compatible pairs**. The machine
contract includes both sides' full oriented support partitions, rather than
only an empty-domain flag.

One smallest local recovery alternative changes3970to an oriented pattern4
and requires the additional COLLAR parents2926and3971. Its8blocking existing
cut Q4s are listed by EID/PID/local-face/NID with opposite owners and their
collar-parent IDs. For example3970/F5, nodes6147,14867,14872,6218, is opposite
3971/F3. This is a local alternative for that exact failed interface, NOT
proof that114parents will solve the entire graph. Both additional IDs remain
outside the selected112scope; retained source regions are never proposed as
an expansion. `automaticScopeExpansion=False` and `expansionAuthorized=False`
are explicit.

For an explicitly expanded scope, the old globally relaxed conditional solver
is deliberately not run. `protectedBoundaryCheck` is the primary result;
`collarExpansionDiagnostic.status` is
`not-run-explicit-expanded-scope-protected-only`. Local cut alternatives are
still inspectable, but no conditional assignment or changed-port plan is
substituted for a failed protected solve. `protectedPartitionPlan` is null.

### Geometry, Volume And Identity

The frozen/source loader still checks all original coordinate/NID rows,3968
retained rows and exact collar support coordinates. There are18304unchanged
frozen composite cells, including14336unselected collar cells. Source files
and the frozen collar are never modified or welded.

`frozenPatchAudit` measures all784frozen cells and all112source-parametric
macros, and records per-parent integral differences. Frozen sum:
0.3651987717142206; macro sum:0.36520179069467906. The236locally admissible
candidate records retain their raw corner/centre/Gauss metrics and macro
integral differences. Their minimum corner/centre SJ is0.05322950771007365
and maximum relative macro-integral difference is0.0005172520277432917.
These are NOT assembled-plan quality numbers. No .15cutoff is imposed, no
volume discrepancy is waived, and `protectedPlanMetrics` remains null because
the protected plan does not exist. A positive local Jacobian is insufficient.

Evidence belongs to the new `screw-study/expanded-112-20261107` descendant.
Primary output: `expanded-112-final.json` (973528bytes), with source/producer
hashes, oriented conflict partitions and explicit cut bindings. Final combined
regression:49passed,0skipped in `tests-112-final.log`, covering the old74fixed
and replan modes, all112expanded parents, invalid/retained expansion rejection,
geometry/volume evidence and independent zero-compatible-pair readback.
The initial expanded-v1/protected files are retained as intermediate evidence,
not replacement plans. The old74-parent evidence below remains historical and
reproducible. No source file, frozen collar, retained region or old NID changed;
no commit, solver or K export was performed.

## Explicit Core-Port Replanning

`core_port_policy='fixed'|'replan'` now separates a frozen candidate interface
from user-retained original mesh. Default `fixed` preserves the original
604-face contract. Only `replan` releases the296inner-core-port quads for
repartitioning. The37tooth,37valley and234patch-to-unchanged-collar faces remain
protected, giving308protected faces. Source NIDs and coordinates are never
merged or moved. Proposed port partitions must also preserve the coarse
bilinear core-port support, not just its corners.

The module exports `regularSweepTemplateLibrary()` through Node from the
existing `dist/two-to-one-sweep-templates.js`, with source/runtime hashes.
It uses all8pattern1,12pattern2,6pattern4and1uniform8orientations exactly as
returned, plus the8existing seven-H8 variants. No connectivity table is copied
into Python. Every library reference is checked for bounded connectivity,
positive sampled Jacobians and cube-integral volume. Pattern2 has3H8 and
face-partition counts1,1,2,2,3,3; its two coarse faces are available in all
exported directions.

For the present source and library the minimum-cut conditional configuration
is37pattern4 +36pattern1 +1pattern2 parents /221prospectiveH8, with minimum
corner/centre SJ0.28112189765969436 and minimum Gauss determinant5.3268268919e-6.
All72shared macro interfaces produce144exact oppositely oriented shared Q4
pairs. The proposed core port changes296quads to147; the external annular end
portion changes308quads to117source-parametric quads. This is an endpoint-collar
configuration, not a core fill or a protected-boundary replacement ready to
attach to the frozen remainder.

Its explicit next collar scope is the original74parents plus these38neighbours:
EID2925,3933..3967,3970,5012. Thus112collar parents would be the next
expanded-domain study, with new outer cuts requiring fresh validation. These
are collar parents only, not the37retained tooth cells discussed in the older
outer-refinement alternative. Their unchanged children are not modified here.
The result records the full cut bindings and expansion options; this chosen
scope is not claimed globally minimal or sufficient for the expanded solve.
An earlier first-feasible configuration used74pattern4,148H8and72neighbours;
it is retained as history, not the preferred current scope. The current actual
pattern2 placement is parent3969, orientation `-1,-1,1|1,-1,1`.

Both policies are compared for every actual parent,2590configurations in all:

- Fixed:0nonempty parent domains,0local candidates.
- Replan:36nonempty parent domains,42local candidates. The other38parents
  still have no candidate with all protected cuts held fixed.
- Consequently no protected-boundary74-parent plan exists in this finite
  library. This is stronger than repeating the old fixed-port rejection, but
  not an impossibility claim for other hex templates or a larger collar scope.

An additional **conditional collar-expansion diagnostic** keeps tooth/valley
and exact source-end geometry fixed while allowing the current collar cut
partitions to change. A finite arc-consistency/backtracking solve couples all
74parents through all72actual shared macro interfaces. Every selected shared
quad is independently read back for equal support identities and opposite
orientation. A local positive candidate alone never becomes a plan.

`collarExpansionDiagnostic` reports the chosen template per parent, all
changed cut bindings and the exact opposite collar parent EIDs needed for that
configuration. Only existing body/collar parents can appear, never retained
tooth/head source cells. It is labelled `protectedBoundaryPlan=False` and
`scopeExpansionAuthorized=False`: the neighbouring cells are identified, not
silently edited. The actual shared graph is checked to be a forest. Dynamic
programming then exactly minimizes the additive objective
`10000 * changed cut Q4 count + H8` on that graph and finite template library;
the H8 total is below10000, so cut changes have strict priority. The optimum
has128changed existing cut Q4s and221H8, cost1280221. This is not a proof of
minimum distinct neighbour union or minimum expansion for arbitrary templates.
Nonforest graphs retain bounded arc-consistency/backtracking without an
optimality claim. A unit test distinguishes this global objective from a
locally greedy choice.

`changedCorePortObligations` supplies actual replaced port bindings and proposed
collar/core outward Q4 cycles using existing frozen NIDs. Each record states
whether it belongs to a protected plan or only the conditional expansion
diagnostic. The core is still unfilled. No K/INP or all-Screw success is emitted.

The public API retains ordinary candidate dictionaries. To stay below the
unchanged2MiBJSON budget, the file writer losslessly pools repeated candidate
columns. Decode with `expand_contract(json.loads(path.read_text()))`; tests
compare every reconstructed candidate with the API result. This is storage
encoding only: no candidate or failure evidence is dropped.

## Actual Scope

`tools.bolthex.screw_endpoint_contract` reads the reviewed original and phase
K pair through `screw_inward_collar.read_parents`, the frozen whole-ratio060-v2
collar, and the existing repository transition-template API. It verifies source
hashes, original coordinate/NID rows, all 3968 outside source rows, parent
bindings, unique child ownership, and exact frozen support coordinates.
It derives endpoints from the actual phase-source cavity, not from a rod model
or from a list of invented free surfaces.

The complete selected patch is 74 parents / 518 existing collar H8:

- Lower: 2889..2924 and 3969.
- Upper: 3968 and 5013..5048.
- 76 source end-face obligations, 308 annular endpoint faces.
- Patch skin: 912 faces, of which 604 are fixed and 308 variable.
- Fixed roles: 37 retained tooth interfaces, 234 interfaces with unchanged
  collar, 296 inner core-port quads, and 37 external valley faces.

The contract includes actual EID/PID/local-face/NID cycles and opposite owners,
the 518 frozen cell connectivities, and their node coordinates. These are
inspection data, explicitly NOT replacement elements. The inner core port is
fixed only under the default policy. External valley geometry is always held
fixed; replan additionally permits only the candidate inner-port partition.

Upper annular faces are external-end candidates. Lower annular faces are
neck-contact obligations, not automatically free surfaces. Neither is certified
globally free by one-owner ID incidence. No coordinate weld or old NID merge is
performed. Changes to a variable end must still preserve the actual source
support. Current lower [0,0.4] and upper [12,12.4] helical loops are not flattened.

## API

```python
from tools.bolthex.screw_endpoint_contract import build_endpoint_contract, write_contract

result = build_endpoint_contract(
    original_k, phase_k, frozen_collar_directory,
    include_neck=True,
    core_port_policy='replan',  # Default is 'fixed'.
)
write_contract(result, fresh_json_path)
```

`include_neck=False` means future source replacement2160 / retained3968.
`include_neck=True` means future source replacement2232 / retained3896 and
lists neck EIDs2817..2888 that must leave the derived retained set. Both modes
inspect the same 74-parent collar patch. This API does not mesh or remove neck
rows. The input frozen composite still has3968 outside rows in either mode.

The result has `summary`, `fixedInterfaces`, `variableEndpoints`, `patchCells`,
`patchNodes`, `parents`, `conflicts`, input hashes and template provenance.
Each parent has nine candidate results with exact fixed-partition comparison,
source-parameter polynomial witnesses, sampled quality and rejection codes.
`write_contract` requires a fresh file in an existing caller-selected folder,
uses exclusive creation, and rejects JSON over2MiB. No K/INP is generated.

The CLI is intentionally separate from the production dispatcher:

```powershell
python -B -m tools.bolthex.screw_endpoint_contract `
  --original <raw.k> --phase <phase-compensated-source.k> `
  --collar <whole-ratio060-v2> --include-neck --core-port-policy replan `
  --output <fresh-contract.json>
```

A successfully written diagnostic has exit0 even when `summary.feasibility`
is `rejected`. Never interpret CLI completion as mesh acceptance. Malformed,
changed, incomplete, oversized or unrecognized input raises before delivery.

## Exact Boundary Obstruction

Under the default fixed-port policy, every source obligation has one fixed
outer edge and two fixed inner edges. Replan explicitly releases the latter.
For a nonplanar bilinear source patch

`Q(u,v) = a + b*u + c*v + d*u*v`,

the vectors b,c,d are independent. A straight segment on that surface must
follow one of its two parameter rulings. A nondegenerate exact Q4 patch
therefore has alternating ruling edges. A conforming rectangular-parametric
quad tiling without T-junctions cannot terminate a ruling in the interior to
change the opposite boundary count from1to2. At least one of those two boundary
chains must change under these explicit assumptions.

This is a necessary local obstruction for source-parametric endpoint
replacement, not a proof that every imaginable global all-hex topology is
impossible. The API records these assumptions in each conflict. It does not
claim a globally minimal scope expansion or an overlapping-volume certificate.

The test is algebraic rather than a nearest-point tolerance: for each child
face, interpolate its source parameters as U,V, and interpolate their vertex
products as W. `q4_parameter_identity` computes the exact rational polynomial
coefficients of `U*V-W`; a nonzero coefficient rejects that child on a
nonplanar support. Source planarity is also tested with exact rational
arithmetic on the stored floating-point coordinates. The actual76source
faces contain75nonzero determinants, including nearly planar meridians.
No geometric healing tolerance is used to erase those small determinants.

All72four-face annular patches have two vertices incident to three faces,
not one central vertex incident to four faces. The remaining4patches have
five faces. None is a regular2x2grid despite the four-face patches having
nine vertices. The API checks the incidence pattern explicitly.

## Initial Fixed-Port Experiment (Historical)

For each of all74parents, eight existing seven-H8 transition templates and
one generated uniform8 template were mapped onto the actual annular macro.
There are666configurations. Only at most eight cells are evaluated at a time;
no assembled candidate volume file or large export is allocated.

- Uniform8 has source-parametric endpoint support identity for all74parents
  and prospective592H8. Its minimum corner/centre SJ is0.6560552162180685.
  Corner, centre, Gauss determinants and macro-volume integrals are recorded.
  Nevertheless every parent fails its fixed boundary partition: refining the
  coarse outer face and replacing lateral patterns is not authorized.
- Seven-H8 variants that match fixed boundaries fail source-Q4 polynomial
  identity; others additionally fail fixed partitions. No parent's finite
  candidate set contains a configuration satisfying all necessary conditions.
- The full search rejects before global template assignment because all74
  local domains are empty. This is not an exhaustive search over all possible
  hex meshes and is not labelled one.
- No pyramid control or SJ near0.001 is used as repair evidence. No quality
  threshold is lowered; positive sampled Jacobians are not acceptance.

## Minimum Required Change Contract

Each of the75fixed-port ruling conflicts lists two local necessary scope
alternatives. They block `fixed`, not the explicit `replan` planning policy:

1. `REFINE_OUTER_1_TO_2`: split the actual outer edge and its complete current
   incident face-star. Original retained tooth owners are included where
   applicable. Merely adding a cap midpoint while leaving that edge unsplit
   would introduce a hanging interface.
2. `RETESSELLATE_INNER_2_TO_1`: change the two-edge core-port chain and its
   incident faces. This changes the frozen inner interface; it does not mean
   identifying its two existing edges or merging their original node IDs.

`mustChangeFaceBindings`, `requiredOutsidePatchEIDs` and
`requiredCollarParentEIDs` are exact affected identities, not coordinate-near
guesses. Summary unions expose the direct scope beyond the518-child patch.
These are necessary local edge-star changes. Further propagation, geometry,
volume quality and a globally sufficient/minimal replacement remain unproved.
Outer/retained expansion remains excluded by this contract. Inner-port
repartition is permitted only under `replan`; the module still does not edit any input mesh.

On the full actual patch, the outer-refinement union directly touches37
outside source cells: EIDs5049..5084 and6128. The inner-retessellation
alternative has no direct outside-patch EID in its endpoint edge-stars, but
still changes the fixed core port. This makes it a narrower next feasibility
study, not a certified feasible alternative or permission to perform it.

The explicit `replan` policy permits the inner-port chain planning alternative.
If both chains remain fixed, repeat tetra filling or changing only endpoint
interior nodes cannot satisfy this source-parametric contract.
Keep the exact8640-inner-Q4 bridge data as a reference, but do not promise it
will remain unchanged after an explicitly planned core-port retessellation.

## Tests And Evidence

Run `python -B -m unittest tools.tests.test_screw_endpoint_contract -v` with:

- `SCREW_ORACLE_K`: actual reviewed original K.
- `SCREW_PHASE_K`: actual phase-compensated K.
- `SCREW_COLLAR_DIR`: frozen whole-ratio060-v2 directory.
- `BOLTHEX_TEST_ROOT`: explicit task scratch directory for tiny writer controls.

Without actual-source variables the complete-source class is explicitly
skipped, not replaced by synthetic success. Tests cover all74parents, actual
skin roles/orientations, source identities, 1:2conflict edge-stars, false2x2
recognition, uniform8 source/quality versus interface failure, neck accounting,
nonfinite inputs, output limits and overwrite rejection.

Current task evidence is under the existing authorized
`continued-screw-hm/iges-production-screw-20261107/screw-study/endpoint-contract-20261107`
scratch descendant. Early contract-v1 is retained as development history;
use `contract-final.json` (950714bytes) and `tests-final.log`. The combined
endpoint and original collar suite passed30tests with0skips, including the
actual whole-source collar controls. Uniform8 has minimum Gauss determinant
1.2799623614e-6 and maximum relative macro-integral discrepancy5.29e-15;
neither number excuses the rejected interfaces. Source,
frozen collar and other agents' files remain unchanged. No solver, physical
GUI, dependency install, source deletion or commit is involved.

The subsequent fixed/replan and sweep-library evidence is kept separately in
`screw-study/endpoint-replan-20261107`. The new tests cover27library orientations,
pattern2face counts, full-domain policy comparison, independent shared-face
readback, exact neighbouring collar IDs, changed port NID obligations and
lossless bounded JSON. Earlier evidence is retained, not overwritten.
The primary machine contract is `replan-mincut.json` (997110bytes), with
producer/input hashes and exact cut/core-port bindings. The all-pattern4
`replan-shared-final.json` is historical first-feasible evidence. Use
`tests-mincut-verified.log` for the final combined regression run; earlier logs
retain the intermediate output-budget rejection and corrected test-fixture
cycle-normalization failure rather than hiding them.
Final combined verification:41passed,0skipped (25endpoint-contract controls
and16existing collar controls), including both complete74-parent policies and
the original full-source collar. No source or producer hash changed.
