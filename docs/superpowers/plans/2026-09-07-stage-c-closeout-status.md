# Stage C closeout status, 2026-09-07

## Verified starting point

The Stage A PR branch (`cf170de`) and Stage B history branch (`efdee51`)
were present on `lwz20210407/HexRefine`. Stage C was not present remotely;
its committed baseline through Task 10 (`22110d4`) was pushed today.

The initial Stage C working-tree test run had 519 tests: 517 passed and two
failed. Type checking and compilation passed. Failures were stale embedded
standalone modules and history overlay reads growing with a disconnected far
field. These were not evidence that all 2:1 topology configurations are supported.

## Task 11 implementation

- Scope history option resolution, active builds, same-level builds, recipe
  geometry lookup, and plan rebasing to the transition context.
- Preserve the full shared-node halo for a patch, including edge/corner
  neighbors. Truncating that halo to face-neighbor context alone was rejected
  by the retained final conformance check during development.
- Include one shared-node ring around restored ancestors for compound and
  third-level history. Do not recursively flood from the added ring.
- Plan replay recipes from overlay geometry, not the unmodified base session.
- Build collision candidates from the restored supporting layer.
- Apply the same scoped planning to untouched-support and replay transactions.
- Derive final preview counts from canceled active-leaf deltas.
- Keep a full final conformance audit on a separate overlay fork. Its reads
  are deliberately outside the transaction delta statistics.

The locality regression exercises both untouched-support and consumed-support
history. Adding a disconnected 7x7x7 far field must leave local mesh size,
overlay statistics and changed-input counts unchanged. Total output must grow
by exactly 343 unchanged far-field cells; no far-field cell may be removed.

Both locality cases passed. An intermediate focused history run passed 54/54
tests. The standalone/Pages build passed and regenerated the embedded runtime.
After the boundary fixes, the final verification covered the complete test-file
set in two complementary runs:

- `node --test --test-name-pattern='history|transition-shell|overlay' test/*.test.mjs`:
  127 passed, zero failures.
- `node --test --test-skip-pattern='history|transition-shell|overlay' test/*.test.mjs`:
  395 passed, zero failures.
- Type checking, compilation and standalone generation passed. Pages generation
  also passed; its release copy should be regenerated at final packaging after
  the last source/documentation changes.

The preceding unsplit final run was interrupted without a result summary and
is not counted as a passing run. Per-run Node counts are reported separately.

An intermediate complete run exposed three regressions after the first locality
fix: missing neighbors in third-level/compound history and premature rejection
of boundary ancestry before the existing ownership diagnostic. The subsequent
targeted five-case run passed all five, retaining the original rejection
diagnostic and leaving the session unchanged on rejection.

## Remaining work

- Task 12: replace the full final audit with a verified local-plus-boundary
  conformance proof and publish a next-revision certificate only after commit.
- Task 13: test certificate invalidation, malformed boundary partitions,
  rollback, undo/redo and replay with the incremental proof in place.
- Task 14: finish release documentation, measure global versus local costs on
  engineering-sized inputs, and prepare the final dependency-ordered release.

Task 11 does not make whole-request cost independent of global mesh size.
Context discovery, first baseline certification, and the retained final audit
still have global costs. Local ordinal lookup arrays also remain indexed by
the maximum participating ordinal; sparse high ordinals need separate memory
measurement. Passing overlay-count tests must not be described as a complete
industrial-scale performance result.

Arbitrary unstructured Hex input, general odd-section topology compensation,
arbitrary cavity filling, and splitting history commands across affected
components remain outside the supported TypeScript capability contract.
An unsupported input is not, by itself, a proof of mathematical impossibility.

### Concrete questions for the incremental proof

1. How is every potentially changed face, edge and corner interface enumerated
   with the same geometric tolerance as the baseline, including duplicate-node
   imports and restored multi-level ancestors? An exact node-id halo alone is
   insufficient for tolerance-matched interfaces.
2. How is each external boundary partition compared before and after the
   transaction so that omitting a neighbor cannot turn an internal mismatch
   into an apparently valid free surface?
3. Which revision and mutation guards justify reusing a certificate through
   commit, undo/redo and replay? A cached result must not silently survive a
   geometry/topology change that its validity checks cannot observe.

Validate the incremental implementation against the retained full audit on
the same generated meshes, including deliberately broken interfaces. Vendor
templates answer geometric partition questions; they do not by themselves
answer these application-specific history/caching questions.

## References and intended use

These are research/design references, not newly integrated runtime dependencies.

- [TrueGrid transition block boundaries](https://truegrid.com/resources/frequently-asked-questions/software-questions/what-is-a-transition-block-boundary):
  replacement interface layers for 2-to-4 and 1-to-3 all-Hex transitions.
  Use generated small grids to verify proposed wall partitions and macro cells.
- [TrueGrid examples manual](https://truegrid.com/TGEXAMPLES.pdf):
  reproducible `bb`/`trbb` examples. Local runtime remains `C:\TrueGrid`.
- [GridPro Compact Enrichment](https://gridpro.com/product/gridpro):
  local enrichment without affecting the far field. This motivates bounded
  influence regions; a product description does not provide a portable Hex
  connectivity table or prove arbitrary input support.
- [GridPro GUI manual v9.1](https://22821077.fs1.hubspotusercontent-na1.net/hubfs/22821077/GridPro%20Documentations/WS_GUI_Manual_v9.1.pdf):
  describes compact enrichment using a local buffer/internal wrap. The current
  official documentation entry redirects to sign-in; this public manual is an
  older version, not a claim about the latest implementation.
- [p4est source](https://github.com/cburstedde/p4est) and
  [p8est API](https://p4est.github.io/api/p4est-latest/p8est_8h.html):
  adaptive hierarchy, neighbor-size balance and localized neighborhood work.
  A 2:1 balanced octree is not itself a conforming transition-Hex mesh.
- [CinoLib](https://github.com/mlivesu/cinolib) and
  [Optimal Dual Schemes for Adaptive Grid Based Hexmeshing](https://arxiv.org/abs/2103.07745):
  candidate sources for future transition configurations and dual schemes.
  Adapting them must preserve geometry, shared faces and cell lineage.
- [MFEM nonconforming refinement paper](https://arxiv.org/abs/1905.04033):
  hierarchy and interface constraints are useful references, but allowing
  hanging nodes through finite-element constraints does not meet our mesh-only
  LS-DYNA all-Hex conformance requirement.

No TrueGrid or GridPro executable experiment was performed in this checkpoint.
New topology claims still require a reproducible mesh and independent auditing.
