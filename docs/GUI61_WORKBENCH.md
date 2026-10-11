# GUI61 Parameter Workbench

The existing HexRefine workbench now has a parameter-generation panel for all
seven GUI_tg menu families. It calls the native TypeScript kernel, not MATLAB
or TG. This connects the implemented subsets; it does not turn unsupported
backend combinations into supported ones.

Entry: `examples/browser/refinement-gui.html`, through a local HTTP server.
Offline entry: `examples/browser/hexrefine-standalone.html`, rebuilt with
`npm run build` then `npm run standalone:build`.

## Controls and State

- Independent drafts per algorithm, numeric inputs, ratio/portion selects,
  thickness/two-stage/correction/optimization checkboxes and actual Z-bar hiding.
- Branch-specific controls only: e.g. circular-solid fixed Z3 has no fake
  thickness-off checkbox; cylinder ratios follow its existing source contract.
- Disabled rectangular Z-ratio is retained as a preference but effective Z is 1
  when thickness transition is off. Quarter-rectangle angle displays effective
  zero while retaining the request for restoration when the fraction changes.
- Source two transitions mean three mesh grades, not three transitions.
- Generate through an isolated worker in HTTP mode; standalone uses the native
  inline runtime. Large standalone calculations can block interaction, so this
  is not an industrial-size responsiveness certification.
- Successful generation displays the actual mesh and compact quality/parameter
  results. Failed generation does not enable stale snapshot downloads.
- Export checkbox controls K download, independently of geometry generation.
- Parameter/report archives can be re-imported. Unknown backend parameters are
  not silently stripped. Each algorithm retains its own draft when switching.

## Mesh and Export Semantics

Generated K is read back before being offered for download. Solid meshes use
NODE/SOLID, Q1 uses NODE/SHELL, and reinforcement uses NODE/SOLID/BEAM with
its native PID/ID contracts. Report archives retain request, resolved plan,
quality, sets and lineage when available. No solver materials/loads are inferred.

Generation snapshots are read-only in the refinement workbench. Pure solid/Q1
results may explicitly transfer into refinement; this invalidates snapshot
downloads. Mixed beam/solid snapshots do not transfer into the solid-only
refinement engine, preventing accidental beam loss. The ordinary importer also
refuses beam-bearing K instead of pretending it loaded the whole model.

The existing renderer is reused. Quarter/half camera faces the exposed cuts;
reinforcement has concrete, bar-only and bar-overlay views. Overlay is an
explicit wire overlay, not hidden-line occlusion. Active solid slice views
omit bar overlay; bar-only view displays the full reinforcement. Beam IDs or
coupling cannot be inferred from the picture alone; inspect the saved report.

## Verified Scope

`test/gui61-generators.test.mjs` covers seven native dispatchers, K round-trip,
field independence, draft isolation and unsupported-input rejection. Existing
browser smoke tests check standalone module parity and original operations.

Actual browser runs cover all seven generation/download routes, mixed exports,
mixed thickness ratios, two stages, positive/negative angles, rectangular
quarter zero-angle behavior, circle quarter-tilt refusal, cylinder layers,
uniform quantity optimization, hidden steel, parameter archive replay,
read-only guards, transfer to refinement, mobile form layout and offline mode.
Browser cases are not an exhaustive Cartesian product of continuous inputs.

Local reproducible scripts and PNG/K/JSON evidence:
`F:/PythonWoking/temp/20261011-hexrefine-gui61-validation/gui61_workbench`,
`test_gui61_workbench.py`, and `test_gui61_controls.py`.
The Browser plugin was unavailable; tests use the existing local Chromium and
Playwright installation without adding a new browser environment.

Still pending: remaining original repair patterns, circular quarter nonzero
tilt semantics, extreme circular quality and broader original control matrix
coverage. Embedded coupling is not part of this workbench milestone.
