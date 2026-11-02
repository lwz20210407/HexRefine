# Independent standard fastener CAD

This optional Python adapter generates unmeshed BRep geometry directly from
design parameters. It never reads an FE mesh or its section/seed counts. It is
separate from both the recovered BoltHex mesh kernel and the TypeScript kernel.
It does **not** yet generate a matching H8 mesh.

## Backend and provenance

- Backend: [gumyr/bd_warehouse](https://github.com/gumyr/bd_warehouse), Apache-2.0.
- Tested pin: v0.3.0, `28696f9b4c765c3b0385ccef1d41f45de245e8ad`.
- Tested CAD kernel: build123d 0.11.1. No MATLAB/TrueGrid/Abaqus dependency.
- This adapter imports the upstream library; it does not copy its source into
  the recovered directory or remove upstream notices.
- Newer upstream releases have different dependency requirements. They are not
  implicitly supported and must not upgrade a shared runtime without testing.

Use either the optional installed `bd_warehouse==0.3.0` dependency or a clean
checkout at the pinned commit via `--warehouse-source`. The source option is
for development/reproduction and verifies the commit and source-tree status.

Related CAD sources researched but **not integrated** here:
[cq_warehouse](https://github.com/gumyr/cq_warehouse) and
[FreeCAD Fasteners](https://github.com/shaise/FreeCAD_FastenersWB).
Their available standards, versions and licences must be checked separately.

## Interface

Entry: `tools/bolthex/standard_cad.py`.

```json
{
  "family": "hex_bolt",
  "standard": "iso4017",
  "size": "M6-1",
  "length": 12,
  "hand": "right"
}
```

Length and exported coordinates are in millimetres, including ASME cases.
Metric size uses diameter-pitch; inch size uses the upstream diameter-TPI key.
No mesh fields, simplified-thread switch or unknown fields are accepted.

```powershell
python -B -m tools.bolthex.standard_cad --warehouse-source <pinned-checkout> catalogue
python -B -m tools.bolthex.standard_cad --warehouse-source <pinned-checkout> generate request.json <new-output-dir>
```

The parent output directory must already exist. Existing output directories
are refused. `model.step` and `cad-report.json` are published together only
after STEP read-back passes. Failed staging files are removed automatically.

| Family | Exposed table keys | Current scope |
| --- | --- | --- |
| `hex_bolt` | `iso4017` | Full-thread hex head; no ISO4014 partial-shank claim |
| `hex_nut` | `iso4032`, `iso4033`, `iso4035` | Open-bore hex nut, subject to validation restrictions |
| `socket_bolt` | `iso4762`, `asme_b18.3` | Real internal hex recess, not a smooth cylindrical head |
| `cap_nut` | `din1587` | Actual closed dome and entry bore |

Use `catalogue` to enumerate actual size keys. A table entry is not a promise
that every extreme or short geometry passes Boolean/STEP validation.

## Acceptance

1. Force `simple=False`: a smooth nominal cylinder is not a thread.
2. Fuse **all** body/thread solids; never select only the largest solid.
3. Require one valid positive-volume material solid.
4. Check design Z datum/under-head length to 1e-5 mm.
5. At a flank radius, sample 32 angular material-occupancy points. Occupancy
   must be nonconstant, repeat one pitch later and change half a pitch later.
   Repeat this check on reopened STEP, not only the in-memory shape.
6. Check socket void/floor and cap bore/closed material where applicable.
7. Use span-aware Gauss-Kronrod mass integration on helical BSpline surfaces;
   require the estimated integration error below 1e-9 and STEP relative
   volume change no greater than 1e-7. The CAD-only exchange limit was explicitly
   approved by the user on 2026-11-02; mesh quality/distance/volume gates did not change.
8. CAD/mesh matching remains false. This certificate alone cannot satisfy the
   native HM workflow's separate matching-mesh volume gate.

## Current limitations

- Nominal upstream geometry is not certified GB/EN correspondence, a specific
  standards edition, or manufacturing tolerance-class limit geometry (6g/6H).
- Multi-start, arbitrary tooth profiles and independent shank lengths are not
  exposed by this adapter. Those are separate mesh/research capabilities.
- At least three thread pitches are required by the current occupancy probe;
  some thin nuts/short screws are therefore explicitly rejected.
- H8 geometry association, socket/cap H8 partitioning and near-thread 2:1/3:1
  reduction are unfinished. Do not combine old mismatched mesh with this CAD.
- M6 ISO4032 (~1.43e-8) and DIN1587 (~1.10e-8) failed the former 1e-8 CAD
  exchange policy. Both pass the user-approved 1e-7 policy in the new regression.
  The old evidence file retains the earlier rejected results as historical data.
  CAD acceptance alone does not imply these families have a matching H8 mesh.
- Upstream tables themselves still need standards verification. For example,
  this pin supplies ISO4017 M6 head height 4.24 mm. The adapter reproduces that
  value, not an independently certified nominal/limit dimension.

## Recorded regression

`docs/validation/fastener-standard-cad-20261102.json` records the historical five
accepted/two rejected cases under 1e-8. The current optional regression has eight
accepted cases under the approved CAD-only 1e-7 policy, including an explicitly
requested square-ended through-thread M6 nut. Reproduce with:

```powershell
$env:HEXREFINE_CAD_SOURCE = '<pinned-checkout>'
$env:BOLTHEX_TEST_ROOT = '<existing-task-directory>'
python -B -m unittest discover -s tools/tests -p test_standard_cad_integration.py -v
```

Use the CAD interpreter. The design-only request guards need no CAD installation.

For open hex nuts, `thread_ends: "square"` is a separately requested full-through
CAD design; the default `"library"` preserves the upstream faded runout. This
option does not alter an existing STEP or fix the original faded-runout H8 case.
See `CAD_MAPPED_FASTENERS.md` for matching mesh and native HM semantics.

See `FASTENER_DEVELOPMENT_TODO.md` for all remaining fastener requirements.
