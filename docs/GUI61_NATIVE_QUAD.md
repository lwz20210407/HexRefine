# Native Q1 Generators

Status: experimental, validated on the cases below. These return planar Q1
meshes and write NODE + ELEMENT_SHELL, never zero-thickness solid elements.
Physical shell thickness, materials, loads and symmetry constraints are not
inferred. MATLAB and TrueGrid are development oracles only.

## Rectangle

`generateRectangularGradedQuadMesh` takes `positiveSize`, `fineRegionSize`,
`coarseCounts`, independent `reductions: {x, y}` (2 or 3), and `modelFraction`.
The size arguments are positive-side extents BEFORE mirror copies, unlike
the 3D rectangular generator's full dimensions. The selected fine boundary
snaps to the nearest coarse interval, ties downward. For a half-ratio transition,
the selected coarse count then rounds upward to even. At least two outer
coarse intervals must remain. The returned plan exposes the resolved geometry.

Twelve reference cases cover four ratio combinations and all three fractions.
Node/element counts and connectivity up to renumbering agree with recovered
MATLAB -> TG output. Maximum coordinate difference was 4.715e-7 in the
20-by-15 positive-side domain. Area, corner/Gauss Jacobians, conforming edges
and independent PyDYNA SHELL read-back passed.

## Circle

`generateCircularGradedQuadMesh` takes `radius`, `refinedRadius`, `fineSize`,
`coarseSize`, and `modelFraction`. This source branch has fixed 3:1 angular
transition, not independently selectable ratios. The inner disk uses a
three-block butterfly layout. The original rounded fine count is aligned to
six; the outer radial interval count is rounded. Successive radial spacings
grow by 1.1, confirmed in actual TG output. Unresolved tiny spacings are rejected.

At radius 20, refined radius 10, fine size 1 and coarse size 2:

| Fraction | Nodes | Quads |
| --- | ---: | ---: |
| Quarter | 160 | 140 |
| Half | 302 | 280 |
| Full | 569 | 560 |

These cases match reference connectivity after renumbering. Interior coordinates
are NOT an exact replay: maximum nearest-node difference is 0.085419 in these
examples. The native implementation uses explicit analytic/radial mapping.
Discrete polygonal area and analytic circle area are reported separately.

The original `plane ... symm` commands also write TC/RC node flags (35/52/69
flagged nodes in the three examples). Mesh-only output deliberately does not
copy solver constraints. `plane_x0` and `plane_y0` node sets are returned as
geometry information, not automatically activated boundary conditions.

## Invocation and Evidence

Use `scripts/generate-graded-mesh.mjs` with schemaVersion 1 and kind
`rectangular-quad` or `circular-quad`. Output contains `mesh.k`, `report.json`,
`lineage.json`, and applicable `node_sets.json`. Existing output directories
are not overwritten. The CLI verifies keyword read-back before reserving one.

Fixed native regression tests: `test/graded-quad.test.mjs` (13 cases) and
`test/graded-circle-quad.test.mjs` (5 cases). Local oracle evidence is in
`F:/PythonWoking/temp/20261011-hexrefine-gui61-validation/quad_oracle` and
`circle2d_oracle`, including original TG/K, native K and independent comparisons.

These generators do not add arbitrary imported-mesh anisotropic refinement,
general Q1 repair, a physical shell formulation, or GUI controls.
