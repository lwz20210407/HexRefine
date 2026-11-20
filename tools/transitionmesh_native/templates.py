"""Pure quadrilateral transition templates used by the native port.

The local frame is ``u`` along the fine edge and ``v`` from fine to coarse.
The templates are geometric contracts only; Abaqus partitioning, HexRefine
node allocation, and final quality checks remain caller responsibilities.
"""
from __future__ import division


class TemplateError(ValueError):
    pass


def build_transition_patch(ratio, fine_spacing=1.0, depth=1.0):
    ratio = int(ratio)
    h = float(fine_spacing)
    depth = float(depth)
    if h <= 0 or depth <= 0:
        raise TemplateError("fine_spacing and depth must be positive")
    if ratio == 2:
        vertices = {
            "A0": (0.0, 0.0), "A1": (h, 0.0), "A2": (2*h, 0.0),
            "A3": (3*h, 0.0), "A4": (4*h, 0.0),
            "B1": (h, depth/2.0), "B2": (2*h, depth/2.0),
            "B3": (3*h, depth/2.0),
            "C0": (0.0, depth), "C2": (2*h, depth),
            "C4": (4*h, depth),
        }
        quads = [
            ("A0", "A1", "B1", "C0"),
            ("A1", "A2", "B2", "B1"),
            ("A2", "A3", "B3", "B2"),
            ("A3", "A4", "C4", "B3"),
            ("C0", "B1", "B2", "C2"),
            ("B2", "B3", "C4", "C2"),
        ]
        fine_segments, coarse_segments = 4, 2
    elif ratio == 3:
        vertices = {
            "A0": (0.0, 0.0), "A1": (h, 0.0), "A2": (2*h, 0.0),
            "A3": (3*h, 0.0), "B1": (h, depth/2.0),
            "B2": (2*h, depth/2.0), "C0": (0.0, depth),
            "C3": (3*h, depth),
        }
        quads = [
            ("A0", "A1", "B1", "C0"),
            ("A1", "A2", "B2", "B1"),
            ("A2", "A3", "C3", "B2"),
            ("C0", "B1", "B2", "C3"),
        ]
        fine_segments, coarse_segments = 3, 1
    else:
        raise TemplateError("ratio must be 2 or 3")
    return {
        "vertices": vertices, "quads": quads, "ratio": ratio,
        "fine_segments": fine_segments, "coarse_segments": coarse_segments,
        "faces": len(quads), "fine_spacing": h, "depth": depth,
    }


def patch_unique_edges(patch):
    seen, edges = set(), []
    for quad in patch["quads"]:
        for index, a in enumerate(quad):
            b = quad[(index + 1) % 4]
            key = tuple(sorted((a, b)))
            if key not in seen:
                seen.add(key)
                edges.append((a, b))
    return edges


def expected_transition_elements(ratio, fine_count):
    ratio, fine_count = int(ratio), int(fine_count)
    period = 4 if ratio == 2 else 3 if ratio == 3 else None
    if period is None or fine_count % period:
        raise TemplateError("fine_count is incompatible with ratio")
    return (fine_count // period) * (6 if ratio == 2 else 4)


def tile_strip_quads(ratio, fine_count, edge_length, depth, side=1.0):
    """Tile a straight transition strip and return global XY Q4 geometry."""
    ratio, fine_count = int(ratio), int(fine_count)
    patch = build_transition_patch(ratio, edge_length / fine_count, depth)
    if fine_count % patch["fine_segments"]:
        raise TemplateError("fine_count is not divisible by template period")
    result = []
    for period in range(fine_count // patch["fine_segments"]):
        offset = period * patch["fine_segments"] * patch["fine_spacing"]
        for quad in patch["quads"]:
            result.append(tuple(
                (offset + patch["vertices"][name][0],
                 side * patch["vertices"][name][1])
                for name in quad))
    return result


def quad_signed_area(quad):
    return 0.5 * sum(
        quad[i][0] * quad[(i+1) % 4][1]
        - quad[(i+1) % 4][0] * quad[i][1]
        for i in range(4)
    )


def audit_tiled_strip(quads, ratio, fine_count, edge_length, depth):
    expected = expected_transition_elements(ratio, fine_count)
    if len(quads) != expected:
        raise TemplateError("unexpected tiled quad count")
    if any(quad_signed_area(q) <= 0 for q in quads):
        raise TemplateError("tiled strip contains non-positive Q4")
    return {"ok": True, "quads": len(quads), "expected": expected,
            "area": sum(quad_signed_area(q) for q in quads),
            "target_area": edge_length * depth}
