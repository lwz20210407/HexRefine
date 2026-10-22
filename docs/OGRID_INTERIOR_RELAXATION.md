# Guarded O-grid Interior Relaxation

The opt-in O-grid API/CLI option is
`transitionInteriorRelaxation: "guarded-laplacian"` (default `"none"`).
It changes only new internal transition vertices, not transition topology,
requested refinement, original node positions or solver state. It is not a
GUI checkbox or a general weak-balance installer.

The internal `transition-interior-relaxation.ts` postprocess freezes original
nodes, all uniform-cell nodes, transition-union boundary nodes and every
multi-parent interface node. A movable node must belong to one source parent
and have no exterior incidence. Parent boundary flux is fixed, not corrected
using a global volume fudge.

Edge-neighbour Laplacian proposals are limited to25% of each vertex's shortest
incident edge. Seven deterministic steps are tested. Nodes in any cell that
would lower the affected minimum corner SJ are reverted, for at most12 passes.
Candidates must not lower the minimum Gauss determinant/minimum edge, increase
maximum edge aspect or maximum normal-standoff size proxy, or violate the
existing1e-8 parent-volume bound. Undefined/same-side metrics cannot pass.
Acceptance requires strictly improved maximum transition-incident nonorthogonality.
No improvement returns the original mesh with an explicit no-op report.
Connectivity and lineage remain unchanged; final O-grid conformance and quality
gates still run. This heuristic is not a global optimizer or Jacobian proof.
It performs several full adjacency audits and is intentionally not a hover UI.

## Complete TC4 Verification

The 2026-10-23 result uses all135 columns and all2970 original focus parents,
each retaining64 children and125 exact quarter-grid points. Total203850 H8 and
212377 nodes remain unchanged;1080 coarse far-field parents retain their
original connectivity. All uniform/core and exterior nodes are fixed.

Maximum nonorthogonality improves61.812581 ->61.558207 degrees. The maximum
normal-size proxy remains2.166105; minimum corner SJ remains0.20149371194.
Independent min8-Gauss determinant is6.501321354e-9 and maximum source-parent
relative volume error5.022e-13, with no threshold change. Selected step is0.3;
larger steps do not bypass the strict guards. The native report counts2767
moved nodes, while compact K rounding leaves2763 observably changed records.

The original candidate is unchanged. The new candidate SHA256 is
`85737c3f8bf468f63d0e0c45300863abc2c2905284dd9fd722e7bda1ab05ae0f`.
PyDYNA/NumPy independently checks source/core/uniform/exterior nodes, all
connectivity, every parent volume, all2970 core125-point grids, corner/Gauss
samples and shared-face grading. Final916/916 full regression, typecheck,
48-frame tests, four actual LSPP views and desktop/mobile HTML checks pass.

This is a small interior improvement, NOT a correction of the visible layout
or exterior pattern. Engineering acceptance remains false. Simple axial
redistribution and its volume projection failed other shape gates and were
not installed. Evidence and the single complete new K are retained at
`F:/PythonWoking/temp/20261023-hexrefine-wb-install/TC4_INTERIOR_AND_UPSTREAM_REVIEW.html`.

## Weak-Balance Installation Still Open

A complete9-cubed primal field with four WB primitives was assembled. Face
matching alone admitted a bad dual; excluding its specific incident state gave
a full positive sampled dual. Cropping the regular half-cell halo produced
six64-quad walls matching an8-cubed old coarse block, with8 children/27 half-grid
points possible in one mapped core. However, this synthetic result uses512
parents around one core and has minSJ about0.0258. It is NOT a real specimen
result or production installer, and is not registered in the planner.

Smaller support, geometric quality, material/identity-aware installation and
complete real-ROI verification remain unfinished. The TC4 interior relaxation
does not establish completion of this separate weak-balance installation path.
