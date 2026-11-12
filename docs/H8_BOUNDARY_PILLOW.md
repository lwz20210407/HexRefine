# Experimental Boundary Pillow

`tools.bolthex.h8_boundary_pillow` provides a small native topology and initial
geometry primitive, independent of template databases, external executables,
SciPy and NetworkX. It is not a general hex mesher or a quality acceptance API.

`native_three_prism_seed()` constructs three extruded quad sectors of a
hexagon. `match_native_three_prism(boundary_faces)` matches a literal oriented
12-Q4/14-vertex boundary against its typed vertex/edge/face incidence graph.
The bounded matcher verifies every final face cycle; equal counts alone do
not pass, and consistent global reflection is supported. Search exhaustion
is not proof that the cavity has no hexahedral fill.

`pillow_boundary(boundary_node_ids, boundary_nodes, boundary_faces, seed)`
wraps a boundary-only seed in a complete boundary layer. It preserves each
outer Q4 and coordinate, creates one inner copy per boundary vertex, and
initializes inner positions by a graph-Laplacian solve. A cube yields seven
H8; the three-prism seed yields fifteen H8. This is whole-boundary pillowing,
not independent seven-cell replacement of each possibly degenerate seed.

Connectivity inputs use literal integer identities; output uses local
indices with explicit boundary bindings. Global NID/EID allocation, source
scope, material IDs and final installation remain the caller's responsibility.
Use the full-source installer to check attachment partitions and protected
neighbours, and independently validate Jacobians, geometry and volume.

## Limitations

- Initial harmonic geometry can be poor or inverted for a difficult cavity.
  The actual head macro required separate geometry optimization after this
  construction. The primitive does not silently run an optimizer or waive a
  failed shape check.
- Every returned contract leaves continuous-Jacobian, global-overlap, shape,
  engineering and whole-model acceptance false. Correct surface topology does
  not certify a valid interior geometric embedding.
- Coincident coordinates with different IDs remain distinct. Protected XYZ
  must be exactly representable in float64; large integers are not rounded.
- The matcher is specifically a three-prism matcher. Other 14-Q4 or larger
  cavities need their own verified seed; counts are not a substitute.

Twenty-five focused tests include exact-positive-J cube7, regular prism15,
orientation/reflection, typed-graph counterexamples, explicit search budgets,
literal-ID/precision preservation and rejected malformed inputs. The actual
head12Q check is opt-in via `H8_BOUNDARY_PILLOW_ACTUAL_HEAD`, with optional
`H8_BOUNDARY_PILLOW_ACTUAL_SHA256`; it regenerates topology from the actual
boundary rather than reading cached solver connectivity. A missing actual
fixture is visibly skipped, never described as a real-model pass.
