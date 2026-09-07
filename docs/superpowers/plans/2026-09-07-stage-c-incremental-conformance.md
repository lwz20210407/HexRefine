# Stage C Task 12: incremental history conformance

## Implementation

The history transaction has two final-audit modes:

- `incremental`: a conforming baseline is available or is checked once, then
  only changed cells and their spatially relevant neighbors are audited.
- `full-repair`: the baseline is nonconforming, as can occur in the existing
  near-coincident-interface repair workflow. The entire repaired output is
  checked before acceptance. An invalid baseline is never cached as valid.

The index is an immutable AVL tree keyed by stable cell ordinal, augmented with
subtree axis-aligned bounds. It is initially constructed from active cells;
removal and insertion path-copy nodes rather than cloning the entire index.
Spatial queries use bounds of both removed and added cells. Four face-tolerance
units of padding conservatively include nearby candidates after coordinate
merging and face comparison. The local mesh uses the existing merge kernel.

Checking the local mesh alone is insufficient because a missing neighbor can
appear to be a valid free surface. Before replacement, the auditor records
paired faces between removed and retained cells. After replacement, the same
retained faces must still have exactly two distinct owners. Nonmanifold face
ownership is rejected separately. Newly refined physical free surfaces are
allowed; they do not require an artificial coarse neighbor.

Baseline preparation does not publish a cache entry. A successful plan may
cache its valid source baseline. The public execution path publishes the
updated index and a next-revision certificate only after guarded overlay commit
succeeds. Coordinate scale and minimum-edge metadata are updated conservatively
from the audited output. Ordinary edits, undo/redo, collection replacement,
counts and tolerance changes invalidate reuse through the existing guards.

## Important boundaries

- Callers must honor the read-only session contract. Arbitrary in-place writes
  made by casting away readonly types are not a supported cache-invalidation API.
- Initial certification, context discovery, and public active-mesh preparation
  can still scan global data. This change does not promise that the complete UI
  request has cost independent of total mesh size.
- The ordinal-keyed spatial tree prunes by subtree bounds; it is not a claim of
  optimal BVH performance for adversarially scattered cell numbering.
- Conformance is one gate. Existing positive Jacobian and volume checks remain
  responsible for the generated elements' quality and replacement volume.
- General arbitrary-topology and odd-section completion remain out of scope.

## Verification cases

- Unchanged interface accepted with and without a disconnected far field.
- Missing output cell rejected by interface ownership even when no faces overlap.
- Uniform fine cells next to an unrefined coarse neighbor rejected; independently
  checked against the full-mesh hanging-node checker.
- Duplicate/nonmanifold ownership rejected.
- Near-coincident coordinates find the same interface within tolerance.
- Bulk removals/insertions preserve older index snapshots.
- Baseline preparation does not publish; repeated successful reads reuse it.
- Failed baseline checks publish nothing.
- Official refinement, undo and redo invalidate prior certificates.
- Public history preview leaves the session unchanged and reuses its baseline.
- Public commit publishes a derived index; a subsequent baseline request invokes
  neither a full checker nor a full index builder.
- Rejected public preview/execution preserve the session and certificate.
- Existing near-coincident-interface repair remains supported by `full-repair`.

Regression discovery also caught a mutable sorting-cache update in the first
baseline builder. It was replaced with the read-only state builder, retaining
the pre-existing preview atomicity contract and parent-count-limit behavior.

Final grouped verification passed: history transactions 20/20, transition-shell
cases 22/22, remaining history/overlay/incremental cases 97/97, and other cases
396/396. The standalone incremental module also passed all 10 focused tests.
Type checking, compilation and standalone regeneration passed. Counts are
reported per run because empty test-file entries can appear in filtered runs.

## Next tasks

Task 13 retains its final fault-injection review: stale/hostile commit state,
replacement references and touched data, ownership corruption, quality failure,
and consistency of certificate publication through rollback/history operations.
Task 14 must update the final package and perform engineering-scale time/memory
measurements, separating first certification, repeated planning, and export.
