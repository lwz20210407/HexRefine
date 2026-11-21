"""Pure-Python planning core derived from the public TransitionMesh behavior.

This package intentionally contains no Abaqus imports.  Abaqus adapters and
HexRefine adapters can consume the same count and geometry-plan contracts.
"""

from .planner import (
    ModePlanError,
    capability,
    plan_transition,
    plan_counts,
    plan_quad_counts,
    allocate_widths,
    hybrid_split,
    angular_fit,
)
from .templates import (
    TemplateError,
    audit_tiled_strip,
    build_transition_patch,
    expected_transition_elements,
    tile_strip_quads,
)
from .cylindrical_axial import audit_axial_cylinder, build_axial_cylinder
from .mesh_io import write_abaqus_inp, write_ls_dyna_solid, write_ls_dyna_mesh
from .bands import (
    build_planar_band, build_annular_band, build_rectangular_ring,
    build_radial_band, extrude_band, rectangular_ring_partition_segments,
)

__all__ = [
    "ModePlanError", "capability", "plan_transition", "plan_counts",
    "plan_quad_counts", "allocate_widths", "hybrid_split", "angular_fit",
    "TemplateError", "audit_tiled_strip", "build_transition_patch",
    "expected_transition_elements", "tile_strip_quads",
    "build_axial_cylinder", "audit_axial_cylinder",
    "write_abaqus_inp", "write_ls_dyna_solid", "write_ls_dyna_mesh",
    "build_planar_band", "build_annular_band", "build_rectangular_ring",
    "build_radial_band", "extrude_band", "rectangular_ring_partition_segments",
]
