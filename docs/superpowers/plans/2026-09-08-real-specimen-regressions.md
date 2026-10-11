# Real-specimen regressions: logical frames and transition geometry

## September 9: affine field preflight

The 2:1 field search now recognizes exact affine support tables after arc
consistency. Affine hulls are accepted only when they contain exactly the
allowed relation; non-affine tables retain the original search. Binary rows
use a parity disjoint-set forest with replayable conflict paths. General affine
rows use bounded GF(2) elimination (at most 4,096 variable bits and 8,192 rows).
Easy satisfiable searches retain their existing traversal; an exactly verified
affine witness is available after 512 decisions. No geometric gate is relaxed.

The two private cases that previously timed out after 240 seconds now return
the existing unsupported-field error in approximately 0.42 and 1.33 seconds.
Contradictory interfaces are carried through the public diagnostic and mapped
back to original element/node IDs by the private adapter. A reported conflict
path is a witness under the restricted candidate domains, not a claim to list
every defect or to prove all-hex meshing impossible.

Tests include 120 exhaustive small-system comparisons, non-affine rejection,
singleton/self constraints and a 30,000-variable odd cycle. The final complete
run passed 555/555; log: `release/affine-sparse-final-test.log` (258 seconds).

Further empirical findings:

- A failed shear candidate is conforming and has positive SJ (0.1463 minimum),
  but its relative volume error is 6.4287e-6. All net error was localized to 88
  refined free faces. Varying stair heights and free-face interior nodes did not
  produce an accepted candidate. The 1e-8 volume gate remains unchanged.
- The rectilinear TrueGrid nine-cell sample is on a reentrant boundary edge
  with two free faces, not an internal three-valent edge. It is not a direct
  replacement for the observed internal conflict.
- The closed TrueGrid bar has 512 standard seven-cell columns and 992 exact
  compatible column interfaces. Its 64 exterior side faces share phase [0.25].
  The native TS engine also accepts a five-layer calibration built from that
  section (12,288 output cells, zero hanging items, zero volume error).
- Three local coarse 3-to-2 column reconnections and a closed pillow with
  local harmonic redistribution passed coarse-patch quality and preservation
  checks but still failed the 2:1 field. These are rejected experiments, not
  production compensation capabilities.

No additional qualified private 2:1 specimen was produced in this iteration.

## Scope

The private validation batch contains 31 distinct source meshes and 62 ratio
combinations. Its initial result was 38 generated candidates, including 11
quality warnings, and 24 rejected attempts. These numbers are not a claim of
solver readiness. Specimen data and generated K files remain outside this repo.

## Implemented

1. Coordinate-free cube-frame transport across shared faces. It recovers logical
   coordinates on curved mapped meshes whose local corner orientations differ.
   It validates shared vertices, unit cube frames, unique cell locations, face
   incidence and connectedness. Singular or inconsistent topology is rejected;
   missing cells are not filled. Production integration accepts complete
   recovered blocks only. Partial charts remain diagnostic until their use in
   compound-history support is bounded. It is a local-sweep fallback only; shared
   regularization and history axis conventions remain unchanged. The first
   integration changed those conventions and failed three history regressions,
   which is why the integration was narrowed before acceptance.
2. Trilinear mapping of the 3:1 four-, five-, and thirteen-hex templates from the
   original parent. Previously, physical edge-vector translations and repeated
   subcell construction could place new nodes off the parent reference map.
   The reference topology and unit-cube coordinates are unchanged. The legacy
   vector construction is now used only to build the reference template.
3. Private-data diagnostic scripts accept external specimen folder arguments.
   The topology-aligned ROI probe writes a separate experimental folder; it is
   not an automatic public-planner compensation policy.

## Measured results

- Three new warped-template node-placement tests failed before the mapping fix
  and pass after it. Three tapered-prism volume tests also pass.
- Four frame-recovery tests cover rotations/reflections, a curved local 2:1
  box, incomplete domains and singular/nonmanifold rejection. Core parents
  remain exactly 1-to-8 and unchanged far-field cells retain their connectivity.
- Five angular compression/shear 3:1 candidates improved their minimum corner
  scaled Jacobian, with no source-node movement or far-field changes:

  | Angle | Before | After |
  | --- | ---: | ---: |
  | 15 | 0.015499 | 0.034880 |
  | 30 | 0.013899 | 0.033397 |
  | 45 | 0.013420 | 0.033768 |
  | 60 | 0.003486 | 0.016559 |
  | 75 | 0.013789 | 0.034120 |

  All five still carry the batch's SJ < 0.05 warning. Other notch candidates
  are limited by pre-existing poor source cells and were not promoted.
- A separate double-shear ROI probe completed coordinate-cut shoulder stairs
  to source-topology blocks: 1,560 to 1,728 attention parents, adding 168.
  Its 3:1 result has 69,472 cells, with 1,296 core parents split into 34,992
  children, 5,616 transition cells and 28,864 unchanged far-field cells.
  The mapping fix removed a newly introduced negative SJ (-0.002585).
  The remaining minimum SJ is 0.008884, already present in the source shoulder.
  This is a quality-warning experimental candidate, not an accepted specimen.

## Unresolved

- Retrying 22 previous non-timeout failures produced no additional accepted
  results. The main 31-case acceptance counts therefore remain unchanged.
- The 2:1 seven-hex template on several warped shear interfaces fails the
  existing 1e-8 volume gate. This is not caused by repeated local sweeps:
  direct-plan diagnostics identify the single-layer seven-hex strategy.
  Changing parent corner order did not eliminate the error. Do not relax the
  gate or claim geometric impossibility from these experiments.
- Intersecting shells, unsupported phase fields and planning timeouts remain.
  Frame recovery does not supply missing transition templates.
- The double-shear aligned ROI must be visually reviewed, and its original
  poor shoulder cells require a separate quality-improvement plan. Do not
  promote it just because its topology and volume now pass.

## Verification

Targeted kernel regressions: 58 passed. Entry/real-fixture round trips and
incremental-conformance tests: 37 passed. New tests: 10 passed.
After narrowing frame recovery to complete local-sweep fallback charts, the
complete `npm test` run passed 550/550 with zero skips or cancellations.
Standalone was refreshed from the same sources. The local full-run log is
`release/real-specimen-fixes-final-test.log` (304 seconds). The earlier failing
run is retained separately in `release/real-specimen-fixes-test.log`.
