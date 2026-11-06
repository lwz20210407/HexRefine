# Versioned nominal fastener catalog

`tools/bolthex/fastener_catalog.py` provides a bounded, JSON-compatible query
layer over selected existing `bd_warehouse` data. It generates no geometry and
changes no CAD, mesh, tolerance, solver or GUI acceptance gate.

Schema version: `1`. Catalog version: `2026-11-06.nominal-bounded.v1`.
Data provider: bd_warehouse `0.3.0`, Apache-2.0, commit
`28696f9b4c765c3b0385ccef1d41f45de245e8ad`.

## Supported matrix

These are literal upstream table keys, not independently certified standard
dimensions or editions. There are seven selected size records, covering five
standard keys. The existing adapter exposes seven standard keys in total.

| Family | Standard key | Snapshot size keys | Selected fields |
| --- | --- | --- | --- |
| `hex_bolt` | `iso4017` | `M6-1`, `M8-1.25` | `k`, `s` |
| `hex_nut` | `iso4032` | `M6-1`, `M8-1.25` | `m`, `s` |
| `hex_nut` | `iso4033` | None | Adapter exposed; outside this snapshot |
| `hex_nut` | `iso4035` | None | Adapter exposed; outside this snapshot |
| `socket_bolt` | `iso4762` | `M6-1` | `dk`, `k`, `s`, `t` |
| `socket_bolt` | `asme_b18.3` | `1/4-20` | `dk`, `k`, `s`, `t` |
| `cap_nut` | `din1587` | `M6-1` | `dk`, `m`, `s` |

ISO4017 M6 upstream `k=4.24 mm` is retained, not silently corrected to an
external nominal value. DIN1587 M6 `m=5 mm` is the hex body height in this
backend, not the overall domed height. No overall height is invented here.
ASME 1/4-20 is diameter `6.35 mm`, pitch `1.27 mm`; its socket across flats
and depth are `4.7625 mm` and `3.048 mm` respectively.

## API and schema

```python
from tools.bolthex.fastener_catalog import query_catalog

m6 = query_catalog({
    'family': 'hex_bolt', 'standard': 'iso4017',
    'size': 'M6', 'pitch': 1, 'units': 'mm',
})
quarter20 = query_catalog({
    'family': 'socket_bolt', 'standard': 'asme_b18.3',
    'size': '1/4-20', 'threads_per_inch': 20, 'units': 'inch',
})
```

All selectors are optional, allowing filtered enumeration. `size` is either
an exact adapter key or its diameter label (`M6`, `1/4`); it is not a numeric
unit-converted diameter. Family/standard are case-normalized; size is literal.
`pitch` is a linear distance in `units` (default `mm`). `threads_per_inch`
is an explicit reciprocal pitch; when both are supplied, they must agree.
The `1e-9 mm` comparison epsilon is a selector roundoff allowance, not a
manufacturing tolerance. Nonfinite, Boolean, nonpositive and excessive
numeric selectors raise `ValueError`, as do unknown fields.

- `query_catalog(request)`: response envelope described below.
- `catalogue()`: full bounded query plus matrix and snapshot provenance.
- `supported_matrix()`: adapter exposure versus selected snapshot sizes.
- `request_schema()` / `response_schema()`: JSON Schema draft 2020-12 objects.
  The response schema describes the query envelope, not the extended
  `catalogue()` or table-verification response, and is not a certificate verifier.
- `verify_source_tables(directory)`: bounded read-only exact byte/hash and
  selected-field validation against the four pinned CSV files.
- `verify_installed_tables()`: checks installed distribution version and CSVs
  without importing the optional CAD runtime.

The query response contains `schemaVersion`, `catalogVersion`, normalized
`query`, `status`, `supported`, `nominalDataAvailable`,
`requestedRequirementsSatisfied`, `selectionAmbiguous`,
`canPrepareNominalCadRequest`, `entries`, `reasons`, and explicit limitations.
Each entry has canonical-mm `designThread`, `nominalDimensionsMm`,
`upstreamParametersMm`, display-unit `displayDimensions`, source provenance,
adapter selectors, capability flags and bounded recorded verification examples.
Each provenance record identifies the pinned file, full-file SHA256, selected
literal fields and their canonical JSON SHA256. The latter is a subset hash,
not a full CSV row hash. Repeated calls return independent mutable records.

| Query status | Meaning |
| --- | --- |
| `matched` | Selected nominal data found; not geometry acceptance |
| `outside_snapshot` | No selected size/pitch row; backend support not disproved |
| `unsupported_family` | Family not exposed by the current adapter |
| `unsupported_standard` | Standard or family/standard combination not exposed |
| `requirements_not_verified` | Nominal data exists but requested edition or tolerance class is unverified |

Use the envelope's `supported` and `canPrepareNominalCadRequest` flags together;
an entry's conditional backend capability cannot override an unsatisfied query
requirement. `supported=True` means nominal lookup only. Multiple matches can
be supported but are not a single CAD selection. Preparing a nominal CAD request
requires a unique match and the same adapter source pin. Bolt length must still
be supplied in **mm**, regardless of display units. Optional runtime presence
is not checked by a lookup; construction, length/hand choices, Boolean validity,
thread occupancy and STEP roundtrip checks still belong to `standard_cad`.

## CLI

```powershell
python -B -m tools.bolthex.fastener_catalog schema
python -B -m tools.bolthex.fastener_catalog list
python -B -m tools.bolthex.fastener_catalog matrix
python -B -m tools.bolthex.fastener_catalog query --family hex_bolt --standard iso4017 --size M6 --pitch 1
python -B -m tools.bolthex.fastener_catalog query --family socket_bolt --standard asme_b18.3 --size 1/4-20 --units inch --threads-per-inch 20
python -B -m tools.bolthex.fastener_catalog verify-tables
```

Query exit status is `0` for a supported nominal lookup, `2` for an explicit
unsupported/unverified query. `schema` emits both request and response schemas.
Normal queries load no OCP, build123d or bd_warehouse module. The existing
`bolthex` package initializer still imports its NumPy-based mesh utilities;
this task does not change that package-wide behavior.

## Provenance and limits

On 2026-11-06 the following fixed-commit upstream files were compared byte for
byte by SHA256 with the installed 0.3.0 data. The module also verifies its
selected literal fields against these files.

| Source at pinned commit | SHA256 |
| --- | --- |
| [hex_head_parameters.csv](https://github.com/gumyr/bd_warehouse/blob/28696f9b4c765c3b0385ccef1d41f45de245e8ad/src/bd_warehouse/data/hex_head_parameters.csv) | `0004b9d7f7dbf7ec054ddc88439e64c293330813915b6e5caf57c7340b501c1c` |
| [hex_nut_parameters.csv](https://github.com/gumyr/bd_warehouse/blob/28696f9b4c765c3b0385ccef1d41f45de245e8ad/src/bd_warehouse/data/hex_nut_parameters.csv) | `d43fb52182ea302af0ac9e9ce102c2743abb84060e8f90a16c0e42d90c0388ea` |
| [socket_head_cap_parameters.csv](https://github.com/gumyr/bd_warehouse/blob/28696f9b4c765c3b0385ccef1d41f45de245e8ad/src/bd_warehouse/data/socket_head_cap_parameters.csv) | `3b98b4a4bc913ad25afdcef6d9937e2d45909deae8f0e5a68f800b1fc85579c6` |
| [domed_cap_nut_parameters.csv](https://github.com/gumyr/bd_warehouse/blob/28696f9b4c765c3b0385ccef1d41f45de245e8ad/src/bd_warehouse/data/domed_cap_nut_parameters.csv) | `58e46619c2f57011604413ef90295d39a69dbbdb5fd22c8563f7d8476096ed` |

The snapshots are selected factual parameter values from the attributed
Apache-2.0 provider, not copied standards documents. Exact CSV identity does
not establish executable package identity, a standards edition or dimensional
conformance to a purchased standard. No new GB/ISO/DIN/ASME equivalence is
asserted. Unknown edition requests remain explicitly unverified.

Tolerance classes such as `6g`, `6H` and ASME classes have no limit-geometry
implementation here. Requests for any tolerance class are not satisfied by
nominal data. Radial clearance is rejected as a catalog selector and must never
be relabeled as a fit/tolerance-class certificate. Mesh, sampling-radius and
diameter overrides are likewise forbidden selectors.

Recorded geometry examples refer to the bounded cases in
`test_standard_cad_integration.py`, `STANDARD_FASTENER_CAD.md`,
`SOCKET_INCH_AND_PREFLIGHT.md` and `CAD_MAPPED_FASTENERS.md`. They are historical
evidence references, not fresh execution results. This catalog does not certify
all lengths, hands, classes, editions, CAD builds, matched H8 meshes, native HM,
contact behavior or solver correctness. Original Screw remains separate.

## Tests

Run with the existing CAD interpreter and explicit scratch environment for the
actual installed-table and tamper tests; no package installation is required:

```powershell
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:BOLTHEX_TEST_ROOT = '<existing-task-scratch>'
$env:TEMP = $env:BOLTHEX_TEST_ROOT
$env:TMP = $env:BOLTHEX_TEST_ROOT
python -B -m unittest tools.tests.test_fastener_catalog tools.tests.test_standard_cad tools.tests.test_thread_dimensions -v
```

The two actual-table tests require the optional installed 0.3.0 distribution;
the mutation test additionally requires explicit scratch. Other tests exercise
the bounded snapshot without the optional CAD backend. This is not the slow
geometry-construction integration suite.
