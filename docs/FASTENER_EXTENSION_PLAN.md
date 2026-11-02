# Fastener family extension plan

Status: design, not an assertion that the following families already work.
Reference baseline: authorized recovered BoltHex kernel in `tools/bolthex`.

Implementation follow-up: two bounded profile integrations, K/INP, parameter-
section STEP and native mesh-only/CAD-plus-mesh HM adapters are described in
`FASTENER_EXPORT_ADAPTATION.md`. They do not complete this catalogue/family plan.

## Verified baseline

The built-in three-body M16 demo and 224 bounded size/shape/thread-switch cases
reproduce original INP bytes. An actual GUI M16 bolt export also matches the
packaged recovered source byte-for-byte. This is not GB conformance certification,
all GUI option coverage, or all input/mesh seed combinations.

## Four independent layers

1. Versioned standard catalogue: standard number, edition, provenance, valid
   diameter/pitch/length combinations, product dimensions, tolerances and limits.
   Missing data must be refused, not interpolated from a neighbouring size.
2. Thread geometry: separate internal/external design profiles, crest/root flats,
   root radius, nominal/limit geometry, pitch/lead/starts, handedness, runout and
   end treatment. Do not use a single radial clearance as a tolerance-class model.
3. Topology templates: nondegenerate core, tooth bands, shank, head, bearing
   flange, drive recess and blind-end closure. Templates own shared entity IDs,
   boundary face partitions and compatible seed constraints.
4. Mesh planning/audit: feature-aligned seeding, root-focused layers, selected
   2:1/3:1 coarsening, body-local conformity, positive corner/Gauss Jacobians,
   dimension/pitch/profile error, IDs, PIDs, surfaces and K/INP round trips.

Natural language should eventually populate a validated specification for these
layers, not generate unconstrained host commands as the meshing algorithm.

## Topology families

| Family | Reuse | New work |
| --- | --- | --- |
| Different sizes within a verified bolt/nut family | Existing logical topology and section sweep | Versioned dimensions, feature seeds, quality bounds |
| Coarse/fine metric, left hand | Profile and phase mapping | Correct internal/external limits, explicit hand and runout tests |
| Hex head, round head, flange, countersunk outer shape | Outer-envelope section mapping | Shoulder/fillet/bearing blocks and junction quality |
| Thin/thick/round/flanged through-nuts | Annular material topology | Versioned shape details and end treatments |
| Threaded rod and double-ended stud | Shaft/tooth bands | Explicit no-head and multi-thread-region plans; never zero-height head cells |
| Actual hex-socket/slot/recess head | Core, shank and exterior | Internal recess, bottom and terminating-hole closure topology |
| Actual closed cap nut | Annular threaded body | Blind thread termination and closed cap blocks |
| Insert/locking/slotted nuts | Existing outer body | Multiple bodies/materials, slots/deformation, interface semantics |
| Trapezoidal/pipe/taper/multistart thread | Logical phase infrastructure | Different profile, taper/lead definitions, starts and closure validation |
| Drill tip/flute/special cutout | Partial shaft reuse | Dedicated multi-block or CAD partition strategy |

The existing `cyl` bolt branch has a cylindrical exterior but does not create
the drive socket merely because its GUI label mentions an internal hexagon.
The existing `dome` nut branch retains a through-bore; it is not a certified
closed cap nut. Product names must not hide those geometric gaps.

## Standard version discipline

Official platform checks on 2026-11-02 show that GB/T 192-2003 has been replaced
by GB/T 192-2025 and GB/T 5782-2016 by GB/T 5782-2025. Do not treat the recovered
static tables as a current authoritative standards database. Product dimensions,
thread-profile standards and tolerance standards are different records.

Sources: [GB/T 192 replacement record](https://std.samr.gov.cn/gb/search/gbDetailed?id=71F772D79C25D3A7E05397BE0A0AB82A),
[GB/T 5782 replacement record](https://std.samr.gov.cn/gb/search/gbDetailed?id=5dLyf8uCEKs%3D&mode=p),
[GB/T 70.1 product record](https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=AA481BA038B2F9CE68879E6B087F4F73).

## Recommended implementation order

1. Freeze recovered-kernel regression evidence; expose its honest Python backend.
2. Build the versioned catalogue and independent metric thread-profile schema.
3. Complete size/length/pitch/hand coverage and add explicit rod/stud topology.
4. Add one verified family at a time: flange, actual hex socket, blind cap.
5. Add near-thread coarsening and host/GUI/MCP adapters after topology gates pass.

Each supported family needs small, middle and extreme valid sizes, fine/coarse
pitch, partial/full thread, length extremes, offsets, strict invalid-input cases,
boundary-conformity and geometry-error evidence. New topology cannot be replaced
by scaling a mesh or merely adding catalogue rows.
