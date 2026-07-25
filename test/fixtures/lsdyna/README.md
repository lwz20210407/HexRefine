# LS-DYNA Regression Fixtures

`real-ogrid-gauge-slab.k` is a mesh-only, anonymized regression fixture derived
from a real engineering keyword deck. The fixture retains a six-layer O-grid
connectivity neighborhood needed to exercise the 2:1 section solver.

The extraction removed all material, load, contact, section, part metadata,
original identifiers, dimensions, and units. Coordinates were uniformly scaled.
The file contains only `*NODE` and `*ELEMENT_SOLID` mesh data under one synthetic
part id.

The regression selects the middle two layers and verifies:

- `1 -> 8` core refinement.
- Seven-Hex transition columns on both sides.
- Preserved far-field layers.
- Positive child scaled Jacobian.
- Exact patch-volume conservation.
- No hanging nodes.
