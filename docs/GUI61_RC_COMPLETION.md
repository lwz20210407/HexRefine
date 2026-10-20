# RC Completion And Remaining Scope

2026-10-20. Both original GUI61 reinforced-concrete families have native
TypeScript generators and browser controls. Neither is a complete analysis deck.
The final native regression suite passes **855/855**, including type checks,
standalone-runtime parity and the new RC state/archive cases.
The original source uses independent steel nodes without embedding constraints;
adding embedded coupling is explicitly deferred, not a prerequisite for claiming
that those original controls have been migrated.

## Implemented And Tested

- Uniform concrete: mesh-aligned spacing/cover, three steel families, Z gating,
  bounded quantity optimization, explicit dimension-change policy, separate/shared
  endpoints and NODE/SOLID/BEAM mesh-only output.
- Graded concrete: original single-band subset and separately labeled native
  fraction/tilt/thickness/two-band extensions. Source half-steel assumptions and
  undefined Z-alignment variable are not copied as desired behavior.
- An additional 144 small-mesh states cover one/two stages, three fractions,
  four XY ratio combinations, effective Z=1/2/3 and Z bars on/off. Every state
  actually generates a mesh. Tests verify tensor-core descendants, conforming
  far field, volume/Jacobians, steel counts and total lengths by axis, IDs/sets,
  and mixed K connectivity read-back. This is finite-state coverage at one
  geometry, not exhaustive continuous-parameter or source replay coverage.
- Another 12 uniform states cover zero cover, minimum two position rows and
  nonsquare 6/4/5 position counts with both endpoint policies and Z states.
- Both generators report per-axis beam counts, minimum/maximum lengths and
  total length, global orientation sine and endpoint identity. The report
  explicitly says `couplingVerified: false`: positive geometry is not a bond law.
- Named sets use dense node IDs and globally explicit solid/beam EIDs. Their
  references and duplicate membership are checked before output. No SET,
  section, material or coupling cards are invented in mesh-only K files.

## A Source Defect Confirmed With MATLAB And TrueGrid

The recovered rectangular parameter callback computes B1/C1 using roughly
0.618 of each outer-band count, aligning by the numeric reduction 2. A second
4-to-2 interface requires complete pairs: its fine count must be a multiple
of 4, not just 2. For full size48x48x8, refined8x8, fineSize2/coarseSize2,
two stages and reductions2/2/2, the raw intermediate count is6.

Actual recovered MATLAB-generated TG yields four `requires even number of
elements` warnings in TrueGrid. In a research copy, aligning those two
intermediate counts to8 removes the warnings. Independent inspection still
finds **192 internal unmatched faces** in that TG result, down from432 in the
raw one. Warning-free output is therefore NOT a conformance certificate.

The native planner now aligns those bands to4 and reserves at least one outer
cell; if upward alignment consumes the whole outer band it uses the largest
legal count below that boundary. No complete paired band means explicit
rejection. The adjustment affects the intermediate partition only; original
outer dimensions, fine-core extent and thickness stay fixed. Warnings disclose
the old/new counts. Existing valid source-count cases remain unchanged.

Native output for the48 case has13928 solids and276 independent beam segments,
zero unmatched internal faces, positive Gauss determinants, volume9216 and
152 unchanged far-field parents. The concrete core has8192 cells and minSJ1.
The transition region has minSJ about0.108465, equal to the sampled minimum
of the raw/corrected TG mesh. It remains visibly flagged below0.2, not silently
treated as engineering approval or covered by earlier0.18-case acceptance.
The native extra cells versus13856 in corrected TG repair the remaining
interfaces rather than merely merge nearby nodes.

## Versioned Parameter Archives

`createGui61ParameterArchive`, `parseGui61ParameterFile`, and
`verifyGui61ParameterReplay` are exported native APIs. Archive version1 stores
the exact request and named-set/lineage JSON alongside reports. A regenerated
result is verified before it is displayed or made downloadable. Missing RC
sets, changed membership, stale requests and malformed typed controls are
explicit errors. Legacy parameter bundles are still accepted, with any saved
sets checked. Valid minimal API requests keep kernel defaults, not GUI demo
values or invented element budgets. Optional budgets can remain blank.

This is deterministic parameter replay, not serialization of arbitrary edits
to imported decks. K text remains a separate download; regeneration preserves
the mixed geometry. Parameter edits discard the archived comparison contract
and start a new declared generation request.

Browser checks exercise six RC variants, actual K byte comparisons, saved
sets, tamper rejection before display, numeric-string rejection, mobile and
single-file offline operation. Twelve generated meshes also pass independent
PyDYNA/NumPy inspection. Eight have four actual LS-PrePost views each: mixed,
steel, concrete, and a concrete-only thickness section. The old LSPP mixed
beam/solid section crash is avoided and disclosed, not declared fixed.

## Still Not Complete

- Extreme angles, very thin/slender dimensions, large engineering meshes and
  performance/solver acceptance beyond the recorded cases.
- Three or more successive transitions, and uniform independent six-face
  covers: new capabilities rather than undiscovered original checkbox behavior.
- General imported solver-deck ID/set migration and user-edited-set replay.
- Embedded/bond-slip coupling and physical sections/materials: deferred by user.
- Other GUI61 TODO items, including extreme circular tilt, broader cylinder
  layers, generalized local repairs and the Python GUI/Node protocol.

Local evidence (compact, no proprietary source committed):
`F:/PythonWoking/temp/20261020-hexrefine-rc-and-mesh-research/`.
`RC_COMPLETION_REVIEW.html` links exact requests, raw/corrected TG, native K,
independent audits, GUI screenshots and native LS-PrePost views.

The paired two-stage request is also committed at
[`examples/gui61/reinforced-paired-double.json`](../examples/gui61/reinforced-paired-double.json).
It can be imported into the GUI or passed to `scripts/generate-graded-mesh.mjs`
with a new output directory. Read its low-SJ warning rather than treating a
successful export as solver acceptance.
