# Optional Gmsh Tetrahedron Subdivision Bridge

This is an internal mesh-construction primitive, NOT a cavity filler, original
Screw repair or engineering-quality certificate. It uses the installed optional
Gmsh public API (`Mesh.SubdivisionAlgorithm=2`) rather than a copied proprietary
mesher or a vendored published pyramid connectivity table.

`tools.bolthex.gmsh_hex_bridge.subdivide_tetrahedra(nodes, tetrahedra,
node_ids=..., new_node_id_start=..., minimum_sj=...)` returns four H8 per supplied
TET4, original-ID barycentre supports, parent ownership and exact oriented
three-quad partitions of input boundary triangles. It verifies original-node
preservation, child counts, per-parent and total volume, positive sampled
corner/center/Gauss Jacobians and boundary topology.

The caller must reserve new IDs above ALL retained source/collar nodes. The
converter cannot infer an external namespace, prove the supplied tet complex
has no global overlap, or establish conformity to an unprovided old mesh.
Existing initialized Gmsh sessions are rejected rather than cleared.

No empirical SJ quality floor is implicit: omitted `minimum_sj` means sampled
validity plus explicit metric/reference reports, NOT engineering acceptance.
A caller may request an additional search screen; its value and basis remain
separate from software references and physical validation. The0.15legacy value
is not a universal rule. See H8_QUALITY_METRIC_POLICY.md.

Installed Gmsh4.15.2 is exercised by7tests, including nonconsecutive source IDs,
shared triangular interfaces, external-ID reservation, per-parent volumes,
caller-session preservation and valid-but-low-quality negative controls.

The separate `test_gmsh_pyramid_bridge` contains4installed-engine controls:
one pyramid plus one tetrahedron becomes88+4H8 with3shared interface quads.
Those tests are NOT a general mixed-cell production converter. Pyramid shape
quality, prescribed boundary-centroid rounding, endpoint closure and full-source
assembly remain separate work. No TET/PYR/WEDGE is allowed in the requested
final ALL-H8 result.

Runtime dependency/license information remains with Gmsh; neither its binary
nor external GPL mesh tables are distributed by this module. Public API:
https://gmsh.info/doc/texinfo/gmsh.html
