# Joint Weak-Balance Reference Kernel

This is an experimental **reference generator**, not an existing-mesh installer.
It is deliberately not exported through `src/index.ts`, registered in the
production planner, or exposed as a GUI option. No real specimen has been
converted using this new module. Complete TC4 verification remains separate.

## Data And Native Implementation

`src/experimental/cinolib-primal-data.ts` contains thirteen mechanically
translated **primal polyhedral** tables, not H8 connectivity. Upstream is
[CinoLib's schemes](https://github.com/mlivesu/cinolib/blob/151dc5c46309affedadb9b45619cc137fb7326ed/include/cinolib/hex_transition_schemes.h),
commit `151dc5c46309affedadb9b45619cc137fb7326ed`, header SHA256
`ef2df0d02b885e92bb497c98c5649e55b13808719f9895b8b89e6a31280476b5`.
The full MIT notice, copyright2016 Marco Livesu, is retained in generated data.
`tools/import-cinolib-reference.py HEADER LICENSE OUTPUT` checks the pinned
hash and translates initializer literals using `ast.literal_eval`, never eval.
Every source coordinate must lie exactly on an integer-twentieth grid. A new
upstream version requires a new audit, not silent acceptance of unknown data.

`src/experimental/weak-balance-reference.ts` implements native assembly and
clipped dual construction. It accepts one unit brick or two X-adjacent bricks,
each with a named primal scheme and one of48 cube frames. Reflections reverse
winding; internal primal faces require exact cyclic partition matches and
opposite outward orientation. Incompatible neighbours are refused.

The native generator uses no Python, MATLAB, TrueGrid, CinoLib binary or
optimization package. Python is a development-time importer and independent
validation implementation, not a runtime dependency.

```js
import {buildWeakBalanceReference} from './dist/experimental/weak-balance-reference.js';
const result = buildWeakBalanceReference([
  {scheme: 'Edge_WB', frame: 0},
  {scheme: 'Flat', frame: 8},
]);
```

Frame order is the lexicographic six axis permutations, then signs in
`[+,-]` order on X/Y/Z. Primal point and face identity uses exact integers,
not rounded geometric coordinates. Dual vertices have distinct source
polyhedron/face/sharp-edge/corner identities. Their positions are vertex
means with reduced rational keys. H8 ordering is recovered from the cubic
dual graph and checked geometrically, not inferred from arbitrary eight IDs.

Each result includes exact rational six-plane boundary partitions. Checks
include cubic dual graphs, distinct nodes, cyclic shared faces, at most two
face owners, no unexpected internal free surface, closed quad-sphere boundary,
volume1/2, positive corner and8-Gauss determinants, and the existing conformance
checker. Two-brick H8 cells must actually cross the old primal interface;
independently clipped bricks are not simply welded together afterwards.
Sampled positivity does not prove a positive Jacobian everywhere.

## Verified Reference Coverage

All thirteen primitives pass all48 frames. Five independently matched pairs
have native geometry/connectivity fingerprints identical to the Python research
implementation, modulo cell ordering and coordinate fingerprint rounding used
only for comparison. Assembly itself remains exact-entity based.

| WB left primitive | Right primitive/frame | H8 | Nodes | Min corner SJ |
| --- | --- | ---: | ---: | ---: |
| Edge_WB | Flat/8 |39|88|0.24262|
| Vert_center_WB_1 | Vert_side/24 |47|101|0.18334|
| Vert_center_WB_2 | Vert_side/24 |51|109|0.19660|
| Vert_center_WB_3 | Vert_side/24 |55|117|0.20901|
| Vert_side_WB | Convex_2/1 |35|81|0.20589|

K output uses existing compact fixed16-column coordinate fields to satisfy
the unchanged scale-relative roundtrip bound. Default8-digit scientific output
was insufficient for this test; the test was corrected to request precision,
not to loosen the bound. Independent PyDYNA/NumPy K audits reproduce volumes,
boundary ownership and positive corner/Gauss samples. Five native LSPP views
and browser-checked HTML accompany the evidence directory:
`F:/PythonWoking/temp/20261023-hexrefine-local-grading/`.

See `NATIVE_WEAK_BALANCE_REVIEW.html`, `research/native-wb-summary.json`,
`research/native-wb-independent.json` and `test/weak-balance-reference.test.mjs`.
The small fixture stores independent canonical mesh fingerprints, not temporary
paths or complete duplicated K files.

## Remaining Installation Work

The six outer partitions are generally NOT the existing coarse1x1/fine2x2
contract. An exact reduced-rational comparison against all eight production
seven-Hex face families found no matching faces for the five isolated WB
primitives, and none of the thirteen isolated primitives has a one-quad coarse
face. Some non-WB primitives do match individual fine faces, but that does not
certify all six walls. `research/native-wb-outer-contracts.json` preserves this
negative result. It is not a non-existence claim for larger macros.
Internal reference conformance is insufficient. In particular:

- Plan a complete original-mesh primal neighbourhood before clipping the dual,
  or derive bounded replacement macros with exactly the required outer walls.
- Certify protected core children remain exactly8 per2:1 parent, not merely
  equal total volume or a positive minimum quality.
- Preserve original far-field IDs/geometry and expose any authorised support
  expansion. No silent whole-layer/core promotion.
- Handle physical mapping, curved boundaries and materials separately, with
  post-map local/whole volume and Jacobian checks.
- Add actual complete-ROI K validation before registering production candidates.

Every certificate therefore retains `readyForOriginalMeshInstaller:false` and
`engineeringAcceptanceVerified:false`. This module does not resolve the TC4
nonorthogonality or certify a universal O-grid/weak-balance installer.

Typecheck and the complete912/912 regression passed after this module was added;
the preceding face-grading checkpoint separately passed908/908. No skipped or
expected-failure cases are counted as passes. The data importer reproduces the
committed generated source byte-for-byte.
