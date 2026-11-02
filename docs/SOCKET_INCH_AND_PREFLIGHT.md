# Canonical inch socket dimensions and early volume checks

Updated: 2026-11-03, Asia/Shanghai. This continues the 2026-11-02 task and its
existing dated scratch directory; it does not certify every ASME size/family.

## Dimension semantics

The CAD producer now emits explicit, mesh-independent design metadata:

```json
"designThread": {"unit": "mm", "majorDiameterMm": 6.35, "pitchMm": 1.27}
```

These values come from the pinned CAD backend's `thread_diameter` and
`thread_pitch`, not from FE nodes or the occupancy test. Legacy
`thread.radiusMm` is the occupancy *sampling* radius (2.794 mm for this case),
not the nominal major radius (3.175 mm). It remains a compatibility alias;
new producer output also names it `samplingRadiusMm`.

`thread_dimensions.dimensions_for` validates canonical finite positive mm
dimensions and checks agreement with metric M labels. Legacy metric
certificates remain usable. Nonmetric socket CAD requires explicit design
metadata and the supported ASME B18.3 branch; a legacy inch certificate without
that metadata rejects before optional CAD loading. It must be regenerated,
not silently interpreted as 20 mm pitch or a 2.794 mm nominal radius.

This is a nominal design-data adapter. It does not add tolerance classes,
standards-edition verification, GB equivalences or all inch fastener families.

## Verified real ASME case

Request: `socket_bolt`, `asme_b18.3`, `1/4-20`, right hand, length 19.05 mm.
The independent CAD was regenerated through the design-only producer and its
original 1e-7 STEP exchange policy; its source geometry was not scaled or
modified to pass mesh gates.

The first 24-interval-per-pitch preflight had relative volume error
0.0001146001664 and rejected. Its formal large mesh was not allocated.
The 32-interval case passes unchanged limits:

```json
{
  "sector": 64, "core_rings": 2, "radial": 2, "per_pitch": 32,
  "head": 12, "head_curve_segments": 16,
  "core_mapping": "graded_2to1_compact", "head_mapping": "fillet_blocks"
}
```

| Whole-body result | Measured value |
| --- | --- |
| Nodes / H8 | 1,352,552 / 1,244,256 |
| CAD-volume relative error | 8.998573681e-5, below unchanged 1e-4 |
| Corner SJ minimum / Gauss Jacobian minimum | 0.2726273979 / 4.966470898e-6 |
| Boundary face centres checked | 215,232 |
| Maximum checked face-centre distance bound | 0.0174059405 mm, below 0.02 mm |
| 256 independent nearest-face node probes | maximum 3.6247001e-8 mm, below 2e-6 mm |
| Boundary Euler / nonmanifold faces / edges | 2 / 0 / 0 |
| Actual mesh axial pitch / crest width at zero degrees | 1.27 / 0.15875 mm |
| Actual socket across flats / depth | 4.7625 / 3.048 mm |
| Sampled actual mesh major diameter | 6.350627994 mm, not a standards-tolerance certificate |
| K / INP bytes | 177,880,294 / 167,959,812 |
| INP read-back coordinate maximum | 5.00044e-13 mm, connectivity unchanged |

PyDYNA independently reread and re-audited the complete K. Actual LSPP full
and head images and an actual INP meridian section were produced. This is
one explicit fidelity reference, not the daily test default. The 22 MB medium
M6 development tier remains; small smoke tests are not representative models.

No new exact-geometry HM, loading/contact/material model, stress convergence,
left-hand inch case or universal family coverage is claimed.

## Mandatory production pre-allocation check

`cad_mesh_pipeline.generate` now requests an early 1e-4 socket-volume check.
`map_socket_bolt` computes swept-boundary volume before 3D H8 allocation,
rejects invalid/nonfinite estimates and excessive error, then reuses that
same CAD sampler/cache during allocation. Its report records
`volumePreflight.before3DAllocation` and `cadQueriesReused`.

The actual US result had preflight volume 857.6690788525596 mm^3 and actual
H8 volume 857.6690788525593 mm^3. Final quality, topology, CAD distances and
file read-back remain mandatory: this is not a preflight-only acceptance.
The optional low-level `map_saved_cad(..., socket_volume_limit=None)` remains
available for explicitly labelled coarse development/testing; it does not
produce a production matching certificate. A supplied limit cannot exceed
1e-4. Saved M6 rejection tests prove `_sweep` is never invoked on a coarse
volume failure; a pure test checks nonfinite estimates likewise reject.

## Evidence and tests

Local task evidence remains under:
`F:/PythonWoking/temp/20261102-bolthex-thread-study/socket-local/fidelity`.
See `US_REVIEW.html`, `us-socket-source`, `us-socket-fidelity-model`,
`us-preflight.json`, `us-tests.log`, `early-volume-tests.log` and
`nov03-unit-release.log`. Large data is not committed to Git. Temporary head
inspection K copies are cleaned after screenshots; source hashes and global
element IDs remain, and the inspection script can reconstruct them.

Latest fast suite: 84 tests, 73 passed / 11 optional skips. Actual US saved-CAD
mapping, source design regeneration and whole-body validation ran separately.
Five early-volume guard tests (including a real saved-M6 rejection) pass.
The eight-case slow CAD reconstruction suite and full TypeScript suite were
not rerun in this increment. Existing notices/backend pins remain unchanged.

## Still open

Native HM CAD fidelity, other sizes and recessed/capped/flanged/self-drilling
families, axial/3D/3:1 thread grading, complete upstream examples, tolerances
and GUI integration remain in FASTENER_DEVELOPMENT_TODO.md. Do not promote
this bounded case to completion of those items.
