# H1 2:1 Local Box Sweep Implementation Plan

Date: 2026-07-25

## Objective

Add a native TypeScript path for a genuinely local, axis-aligned H1 2:1
refinement box. The selected core must be split exactly once into 2 x 2 x 2
children while the surrounding mesh receives a conforming multi-direction
transition field.

This milestone targets complete mapped Hex lattices and rectangular element
selections. The existing TrueGrid-derived seven-Hex column path remains the
preferred path for full-section and O-grid axial transitions.

## Acceptance Criteria

For a single central parent in a 5 x 5 x 5 structured Hex mesh:

- the selected parent has exactly eight children;
- all generated core nodes lie on parent half coordinates;
- the output has no hanging nodes;
- every output Hex has positive scaled Jacobian;
- total volume is conserved;
- unchanged far-field parents remain one-to-one;
- the operation is deterministic;
- the existing full-section and butterfly O-grid regressions remain unchanged.

The Python reference currently produces 283 output Hexes from 125 parents for
this case. That count is a regression oracle, not a public API guarantee.

## Architecture

1. Keep `buildTwoToOneHexReplacements()` as the public dispatcher.
2. Retain the existing seven-Hex section implementation as a specialized
   strategy.
3. Add a mapped-lattice local-box strategy based on the Owen/Shih directional
   sweep:
   - infer logical element and node coordinates;
   - mark alternating logical node planes around the selected box;
   - normalize markings on each plane;
   - apply independently audited pattern 1, 2, 4, and uniform-8 templates;
   - sweep in three logical directions while preserving original-parent
     lineage;
   - regroup final children into one replacement per original parent.
4. Use the local strategy only when the selected ids form a complete
   rectangular logical block and the support region fits the mesh. Unsupported
   topology reports a focused error or falls back to the existing section path.

## Tasks

### Task 1: Add the local-box regression

- Add a direct 5 x 5 x 5 center-cell 2:1 test.
- Assert exact core lineage, 283 output elements, zero hanging nodes, positive
  quality, and volume conservation.
- Run the focused test and confirm the current implementation fails because
  intersecting face-transition columns overlap.

### Task 2: Port the audited regular templates

- Add canonical pattern 1, pattern 2, pattern 4, and uniform-8 reference data.
- Generate all proper cube rotations deterministically.
- Validate node bounds, Hex connectivity, marked-corner signatures, positive
  orientation, and face partitions.
- Add unit regressions for canonical and rotated templates.

### Task 3: Expose mapped Hex lattice topology

- Extract reusable element-lattice inference from `regularization.ts`.
- Derive logical node coordinates from standard H1 corner ordering.
- Reject conflicting, incomplete, or non-mapped lattices with explicit errors.
- Keep current regularization behavior unchanged.

### Task 4: Port one directional sweep

- Port marked-node plane normalization and template selection.
- Preserve physical coordinates through trilinear interpolation.
- Preserve each temporary child cell's original-parent lineage.
- Add focused tests for a single marked node and adjacent marked-node cases.

### Task 5: Compose three sweeps

- Mark the local rectangular box in each logical direction.
- Apply the three sweeps in a deterministic axis order.
- Prevent any core descendant from being refined beyond the required eight
  children.
- Regroup temporary children by original parent as `ReplaceElement[]`.
- Classify non-core parents as face, edge, or corner transition parents.

### Task 6: Integrate and validate

- Dispatch rectangular local selections to the sweep strategy.
- Preserve the existing seven-Hex strategy for full-section/O-grid cases.
- Run focused, kernel, session, build, and full repository tests.
- Document the supported boundary and the next milestone.

## Deferred Follow-Up

- General unstructured shell CSP beyond mapped logical lattices.
- Browser control for explicitly choosing local-box versus full-section
  completion.

## Completion Update

The initial rectangular-box milestone was completed in commit `ea7df8c`.
The following phase also completed the first two deferred items:

- all 24 paired pattern-3 marked-face frames were ported;
- L-shaped core output matches the Python oracle at 328 Hexes and 473 nodes;
- multiple disjoint local cores are refined in the same three sweeps;
- explicit unpaired pattern-3 states fail before mesh replacement.

The browser now exposes the full-section/local-box choice. General unstructured
shell planning remains outside this mapped-lattice sweep implementation.
