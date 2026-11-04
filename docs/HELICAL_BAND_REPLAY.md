# Reviewed helical-band implementation and upstream replay

Review date: 2026-11-04. These changes already existed uncommitted when the
native-joint task began. They were inspected and independently rechecked before
submission, not silently counted as newly authored work of that task.

## Scope

`helical_band.py` supplies indexed H8 annular thread bands, external/internal,
uniform radial layers, counted boundary layers and an explicit near-thread
offset variant. Node labels use exact integer cyclic indexing across turns.
This is a complete hollow band, not a filled bolt, complete nut, independent
CAD, mapped HM or standards/tolerance implementation.

`rounded_profile.py` adds validated curve fractions with unchanged defaults.
Production `helical_band_export.py` preflights count, analytic-field volume
(1e-4) and bundle size (128 MiB), audits H8 SJ>=0.15 and positive Gauss values,
checks continuous-field boundary distances, and verifies INP read-back.
The K formatter receives an explicit analytic-thread-field label. It must not
say the band was mapped from an independent STEP. Other CAD callers keep their
existing default label and behavior.

## Upstream evidence

Reference: sunwhale/thread commit
582da3d8c9ec5ddc7e7d14aa2e32493b7a768a8c. Original source programs are external,
not vendored. The optional oracle checks that pin and source cleanliness,
converts Python2 print syntax, omits plotting, and records two separate runs:
raw source and explicitly repaired cyclic labels. Output goes in a fresh caller-
selected case directory. Invoke this research oracle as an isolated CLI process,
not in a GUI/server thread: it executes the selected trusted source and changes
its own process working directory.

Seven script names plus three variants have previous successful comparison
records: thread, external/internal, GJB3.1 external/internal, their boundary-layer
versions, three-turn external, three-turn/three-boundary-layer internal and
eight-turn external. Source IDs can be invalid before repair. For example, raw
eight-turn external has 128 invalid node references; after recorded cyclic-label
repair its coordinates agree about 1.91e-13 and normalized connectivity matches.
Do not report that the untouched upstream programs all passed.

This review did NOT rerun original source programs or fetch a newer upstream.
It regenerated all ten stored parameter cases with the current owned module and
rechecked counts, corner/Gauss/boundary quality and independently integrated
discrete volume against their historical successful records. All ten passed:
5,120..40,960 H8, minimum SJ approximately 0.4959..0.4988, no topology failures.
That review does not replace the historical exact-coordinate oracle evidence.

Local records:
F:/PythonWoking/temp/20261103-fastener-upstream-replay and
F:/PythonWoking/temp/20261104-native-joint-backend/reviewed-band-cases.json.
The latter explicitly records originalSourceRerunThisIncrement=false.

## Reproduction

```powershell
python -B -m tools.bolthex.helical_band_export SPEC_JSON NEW_OUTPUT --node NODE_EXECUTABLE
python -B -m tools.bolthex.upstream_sunwhale_check PINNED_CHECKOUT NEW_OUTPUT
```

The oracle requires Python with lib2to3 (existing 3.11/3.12 environment).
The production band generator has no upstream script or proprietary-app runtime
dependency. Conservative seed/divisibility, geometry and allocation checks may
explicitly reject unsupported combinations; no claim of arbitrary H8 meshing.

## Still open

Full fasteners around these bands, mating geometry and runout/end treatment,
independent CAD, GUI, standards/tolerances and broader topology transitions.
The new repository-native analytical joint remains a separate bounded backend;
these rounded bands have not silently replaced its thread field.
