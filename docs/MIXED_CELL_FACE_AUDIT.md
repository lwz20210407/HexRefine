# Directed Mixed-Cell Face Gate

`tools.bolthex.mixed_cell_face_audit.audit_faces(nodes, node_ids, blocks)`
audits literal T4/P5 incidences before optional all-H8 subdivision. Gmsh type
4 and 7 blocks contain `(element_ids, literal_nid_connectivity)` arrays. It
does not import Gmsh, change geometry, merge nodes or write output files.

Every interior face must have exactly two opposite directed cycles. A face
with two owners but equal direction is rejected even when both cells have
positive sampled determinants. Duplicate cells, more than two face owners
and unmatched/directionally inconsistent outer-skin edges are also reported.
All identity/reference validation happens before coordinate indexing.

The diagnostic integrates triangular and bilinear-Q4 divergence flux with a
single common origin. It reports skin flux and the internal flux that fails
to cancel. A small *sum* of internal flux does not waive any incorrect face:
opposite local errors can cancel numerically. These are directed-face checks,
not vertex-link, global intersection, continuous Jacobian or engineering
acceptance certificates.

## Actual Screw Rejection

The 2026-11-12 full upper-core trial had 48,477 tetrahedra and 2,494 pyramids.
It had no face with more than two owners and its sampled determinants were
positive, but 492 interior triangles had equal rather than opposite cycles.
The cell-flux sum was `8.7050511677 mm^3`; its actual directed outer skin
enclosed `8.6849933274 mm^3`. The uncancelled interior flux `0.0200578403 mm^3`
explains their difference. The independently read CAD reference was
`8.6849931700 mm^3`. Subsequent all-H8 conversion did not repair this defect.
That mesh was rejected, not delivered as an accepted Screw K/INP.

This is a measured failure of that constrained input/run, not a claim that
every Gmsh hybrid mesh or pyramid subdivision has the same problem. Disabling
the automatic optimizer removed a separate nonmanifold defect in this trial,
but did not fix these directed-face conflicts or establish material validity.

The opt-in actual-file regression uses `ACTUAL_MIXED_CORE_NPZ`. It must name
the retained initial hybrid NPZ containing `nodes`, `node_tags`, `type4`,
`eids4`, `type7`, `eids7`. Without that explicit fixture the actual-file test
is visibly skipped; fixed tests still exercise a valid pyramid/tet attachment,
positive-volume overlap, duplicate/nonmanifold cells, identity rejection and
translation invariance. No mesh-quality threshold is introduced.
