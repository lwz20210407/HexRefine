# GUI61 Port: Verified Scope and Remaining Work

Checkpoint: 2026-10-11. This reports actual native implementations and measured
oracle coverage, not a claim of complete GUI_tg 6.1 equivalence. Native runtime
is TypeScript/Node. Python can call the versioned CLI; a pure-Python kernel and
new GUI wiring have NOT been implemented.

## Feature Matrix

| Feature | Recovered GUI source | Native status | Evidence / remaining scope |
| --- | --- | --- | --- |
| F01 independent axes | GUI_tg.m 252/277/302, 978+ | Implemented for rectangular generation | 36 single-band ratio/thickness/fraction cases; not general imported-Hex anisotropy |
| F02 double bands | 894, 1076/1129+, Creat_A/B/C/D | Implemented for rectangles | 16 cases, 0.618 allocation and count alignment; exactly two transitions |
| F03 tilt | 984+, 994, 1200+ | Rectangular single/double implemented | Positive/negative TG probes; circular nonzero tilt pending |
| F04 fractions | Each generator's vi branch | Explicit coverage for ported generators | Corrected circular quarter and cylinder full; no automatic solver BC |
| F05 curved solids | Code_Creat2/3, 2482+, 3249+ | Initial circular/cylindrical subsets implemented | Cylinder radial switch and separated physical layers; circular tilt/element-budget search pending |
| F06 reinforcement | Code_Creat4/5, 3577+, 3951+ | Pending | Bar layout/cover rounding, beam mesh, PID/IDs, shared/embedded semantics and mixed export |
| F07 2D | Code_Creat7/6, 2199+, 2386+ | Implemented under source-specific contracts | 12 rectangle and 3 circle TG cases; Q1/SHELL export, geometric sets |
| F08 interfaces | repair chain, v15/v16/vv15/vv16 | Direct conformity for ported generators; baseline replay verified | General imported-K repair is NOT implemented |

Implementation guides: [rectangle](GUI61_NATIVE_RECTANGLE.md),
[circular solid](GUI61_NATIVE_CIRCLE.md), [Q1](GUI61_NATIVE_QUAD.md),
[cylinder](GUI61_NATIVE_CYLINDER.md).

## Bugs and Differences Are Not Copied Blindly

| Finding | Decision and regression protection |
| --- | --- |
| Rectangular thickness-off depends on previous GUI state | Resolve effective Z=1 before count alignment; deterministic calls; disclose differences |
| Original rectangular outer counts can be fractional | Reject incompatible inputs, no silent geometry change |
| Circular solid vi=1 duplicates vi=2 half-disk | Native quarter is a literal quarter disk; report the difference |
| Cylinder vi=3 emits half circumference | Native full is full circumference and full axial length; corrected TG copy confirms omitted reflection |
| TG transition-created curved boundary nodes can miss exact radius | Native analytic mapping, then re-audit geometry/volume/quality; do not simply enlarge merge tolerance |
| TG coarse/fine interface partitions can disagree | Direct conforming native topology; separately verified raw/fixed reference baselines |
| Source 2D circle has NODE constraint flags | Mesh-only output omits solver constraints explicitly and returns geometry sets |
| Uniform RC assigns X counts to Y beams and Y counts to X beams | Confirmed on a nonsquare oracle; corrected TG copy fixes counts and lengths; native RC port still pending |

Original recovered files remain read-only evidence. Corrections to oracle code
or TG decks are made in isolated copies and recorded separately from raw replay.
Recovered source archives are not included in this repository.

## Verification and Honest Limits

- Latest completed integrated full run, including the cylinder addition:
  **664/664 passing**, with type checks and build also passing.
- Cylinder addition: **9/9 focused tests passing**, plus CLI output coverage.
- TrueGrid batch invocation is established (`i=... g=nogui s=...`), with
  dedicated output/session paths. Process success is separate from mesh validity.
- Rectangular raw/repaired baseline replay is byte-identical to the supplied
  user files. Native alternatives need not use the same topology or numbering.
- Independent audits use NumPy topology/Gauss checks and PyDYNA K read-back,
  not only the native generator's own reported quality.
- Some double-band meshes have minimum corner SJ around 0.147-0.165 and emit
  warnings below 0.2. Positive Jacobians are not a universal engineering-quality
  guarantee. Quality optimization and user-specific acceptance remain open.
- Curved native/reference coordinates can differ materially. Analytic surface
  error, discrete volume closure and analytic volume approximation are different
  metrics and remain separately reported.
- Allocation guards are not performance certification. Large realistic meshes,
  extreme aspect ratios and a wider parameter matrix still need coverage.
- Existing session refinement/GUI operations have not gained all generator
  controls merely because the standalone native CLI supports them.

## Next Work

The initial uniform-RC oracle is now recorded in `rebar_oracle`. For a 20x12x8
body with unit mesh size, the original expected 420 beams but generated 444
(Y segments of length 0.6, X segments of length 1.666667). Correcting directional
counts in a TG copy produced 420 beams, all unit length. Hiding Z bars actually
removes them: expected 324, original 348, corrected 324. The original/corrected
outputs both have distinct beam and solid node IDs, PID 2 and 3, no coupling
cards, and collinear/repeated beam N3 data. The applicable beam formulation,
orientation needs and coupling policy must be resolved before native mixed
output is advertised; no unconditional node merge has been performed.

1. Reinforced uniform/graded concrete: recover callback inputs; run small TG
   oracles; determine actual bar-node coupling and hidden-Z-bar behavior.
2. Add explicit mixed NODE/SOLID/BEAM output with PID and ID contracts; never
   run the original solid-only repair writer as a faithful mixed-deck exporter.
3. Circular tilt and count-budget adjustment, followed by broader curved tests.
4. Supported imported-interface repair patterns, UI integration, documentation,
   engineering-scale cases and review before publication.

Local evidence is retained at
`F:/PythonWoking/temp/20261011-hexrefine-gui61-validation` for reproducibility.
The earlier committed/pushed baseline is 5486d9e. The validated GUI61 batch is
recorded in scoped local checkpoint commits. Remote publication is tracked
separately and is not implied by a local commit or this feature matrix.
