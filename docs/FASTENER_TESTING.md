# Fastener development tests

Development smoke tests are not high-fidelity whole-model acceptance jobs.
Do not generate million-cell specimens or native HM files after every edit.

## Daily loop

1. Run pure NumPy/request/IO unit tests; set `BOLTHEX_TEST_ROOT`, `TEMP`, `TMP`,
   `HEXREFINE_TEST_OUTPUT` to the existing dated task directory and select Node
   through `HEXREFINE_NODE` when running the combined tools test suite.
2. For CAD changes, reuse saved STEP fixtures with verified source hashes. The
   runout smoke below creates two small actual-CAD patches, capped at 256 H8 each
   and one MiB of total artifacts, with real small K/INP read-back.
3. Use small complete/cropped integration fixtures for connectivity, orientation,
   positive Jacobian, discrete volume and API behaviour. A coarse CAD test does
   not claim to meet the stricter complete-model CAD delivery tolerance.
4. Run full-model acceptance only explicitly after a meaningful kernel change,
   or before release. Keep passing reference reports to avoid needless repeats.

```powershell
# General Python runtime; no CAD package is needed for ordinary unit tests.
python -B -m unittest discover -s tools/tests -v

# Existing CAD runtime; saved fixtures directory contains nut-M8/model.step.
python -B -m tools.bolthex.dev_smoke FIXTURES NEW_SMALL_OUTPUT --node NODE_EXE
```

The small output is labelled `development-local-regression` and
`notFullModelAcceptance=true`. Its K files carry an inspection-only comment.
It must not be shown as validation of the complete nut or exported as an
analysis-ready assembly. No giant intermediate model is generated first.

## Explicit slow tests

CAD construction tests do not run just because a source checkout is configured.
Enable both the source and a deliberate slow-test flag:

```powershell
$env:HEXREFINE_CAD_SOURCE = 'PINNED_WAREHOUSE_CHECKOUT'
$env:HEXREFINE_RUN_SLOW_CAD = '1'
python -B -m unittest discover -s tools/tests -p test_standard_cad_integration.py -v
```

The whole-model generator and native HM exporter remain explicit commands, not
default development tests. Their mesh/CAD volume, distance and Jacobian gates
are unchanged. Lower-resolution development output is not silently relabelled
as passing those delivery gates.
