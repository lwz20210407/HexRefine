# Native transition mesh requests

From a Git checkout, run `npm run build`, then:

```powershell
node scripts/generate-transition-band.mjs examples/transition-mesh/axial-tube.json examples/output/axial-tube-case
```

Choose a new output directory for each run; the CLI refuses to overwrite one.
Requests also load through the workbench's transition parameter JSON import.
The annular request is Q1; the other examples generate H8. `radial-tube.json`
and `axial-tube.json` illustrate different transition directions in a hollow
solid cylinder. These examples do not add solver materials or loads.

See [the API contract](../../docs/TRANSITION_BANDS.md) and
[the workbench](../../docs/TRANSITION_MESH_WORKBENCH.md) for controls and limits.
