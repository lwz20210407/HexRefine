# LS-DYNA Regression Fixtures

All committed K files in this directory are mesh-only fixtures. They contain
only `*NODE` and `*ELEMENT_SOLID` data under one synthetic part id, wrapped by
`*KEYWORD` and `*END`.

`real-ogrid-gauge-slab.k` is an anonymized topology extracted from a real
engineering keyword deck. `tension-gauge-slab.k` retains that same six-layer
O-grid neighborhood in a normalized, deterministically exported form. The
extraction removed material, load, contact, section, part metadata, original
identifiers, dimensions, and units; its coordinates were uniformly scaled.

`compression-ogrid-ring.k` and `double-shear-contact-shell.k` are deterministic
topology-only models generated from public constructors. They do not reproduce
private specimen dimensions, identifiers, units, or analysis metadata.

The full private engineering decks remain local acceptance data and are not
committed. The three public fixture manifests verify `1 -> 8` selected
refinement, conforming 2:1 transition support, positive scaled Jacobian, volume
conservation, no hanging nodes, and mesh-only LS-DYNA round trips.

Regenerate the public fixtures with:

```powershell
npm run build
node scripts/generate-lsdyna-regression-fixtures.mjs
```
