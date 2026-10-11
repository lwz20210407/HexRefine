# Embedded Reinforcement: R11 Design Checkpoint

Status: source/contract investigation only. No embedded keyword exporter,
host-element locator, solver proof or GUI control is claimed implemented here.
Current generators support independent endpoints and strictly matched shared
endpoints; neither is an embedded-coupling implementation.

## Verified Local Primary Reference

LS-DYNA R11 Keyword Manual Vol. I, PDF pages 682-685, printed CONSTRAINED
10-4 through 10-7, `*CONSTRAINED_BEAM_IN_SOLID`:
`D:/Program Files/LS-DYNA R11/manual/LS-DYNA_manual_Vol1.pdf`.
The manual was read locally, not inferred from a later PyDYNA class version.

- Constraint and PENALTY forms are separate choices.
- SLAVE identifies beam parts/part sets; MASTER identifies solid/tshell parts.
- SSTYP/MSTYP=1 mean individual part IDs; zero means part sets.
- Card1 fields are SLAVE, MASTER, SSTYP, MSTYP, blank, blank, NCOUP, CDIR.
- Card2 fields are START, END, blank, AXFOR, blank, PSSF, blank, XINT.
- NCOUP=0 couples at nodes only; positive values add points within beam elements.
- CDIR=0 constrains all directions; CDIR=1 releases axial constraint. CDIR and
  axial-force behavior do not apply to the penalty form.
- A rigid solid master is disallowed. Constraint coupling also has a caveat
  for solids sharing rigid-body nodes, which cannot be checked from a mesh-only K.

These are interface facts, not a recommendation of one physical interaction
for every reinforced-concrete model. AXFOR-dependent debonding is a separate
constitutive feature; it must not be invented from geometry.

## Implementation Sequence

1. Define explicit coupling form/direction/point-count and part selection.
   Preserve the current mesh-only K default; emit an opt-in companion coupling
   include and manifest instead of silently adding solver cards to every mesh.
2. Require independent beam endpoints for the initial embedded route, avoiding
   simultaneous shared-node and embedded constraints. Check the selected PID
   types and enumerate beam endpoints/interior sample points requiring hosts.
3. Validate containment in the generated concrete, with a deterministic host
   search and explicit tolerance/boundary rules. A closest-node match is NOT
   containment. Gaps/multilayers/rigid hosts need separate scope and checks.
4. Use R11 card layout, then parse independently with the installed PyDYNA.
   Verify fields against the manual; newer optional fields are not automatically
   compatible with R11. Do not weaken the mesh-only reader's unknown-card rejection.
5. Run tiny coupled and uncoupled solver controls in isolated folders. Use
   explicit test-only elastic parts, sections and imposed motion; check nodal
   histories/force transfer, not just successful parsing or exit code. Repeat
   for nonmatching steel/solid nodes and points on interfaces. Record license
   or solver limitations honestly.
6. Only after this proof, expose the option through CLI and GUI with its physical
   assumptions, required external model information and diagnostics.

## Acceptance Gates

- No coupling to a wrong PID or an unused node; no implicit body/part merging.
- No unreported unmatched beam points or silently enlarged containment tolerance.
- Preserve IDs/sets and distinguish mesh validation from physical solver proof.
- Generated model material/rigidness is not known merely because its mesh exists.
- The initial perfect-constraint/penalty scope must not claim bond-slip support.
- Existing separate/shared behavior and mesh-only output remain regression-tested.
