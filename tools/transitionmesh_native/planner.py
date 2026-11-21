"""Abaqus-independent TransitionMesh planning contracts.

The original plug-in keeps these decisions separate from Abaqus geometry:
ratio/stage count chains, width allocation, hybrid 2:1+3:1 splitting, annular
angular fit, and mode capability checks.  This module reproduces those rules
without copying Abaqus objects or requiring third-party packages.
"""
from __future__ import division

import math
import re


class ModePlanError(ValueError):
    pass


MODES = (
    "PLANAR", "PLANAR_ANNULAR", "PLANAR_QUAD_FOUR",
    "ANNULAR_RADIAL", "AXIAL_SURFACE",
)


def _isfinite(value):
    """Keep the planner usable by Abaqus 2020's Python 2.7 runtime."""
    return not math.isnan(float(value)) and not math.isinf(float(value))


def _gcd(a, b):
    while b:
        a, b = b, a % b
    return abs(int(a))


def _finite_positive(value, name):
    value = float(value)
    if not _isfinite(value) or value <= 0.0:
        raise ModePlanError("%s must be finite and positive" % name)
    return value


def parse_sequence(value, converter=float):
    if value is None or value == "":
        return []
    if isinstance(value, str):
        value = [x for x in re.split(r"[,;\s]+", value.strip()) if x]
    return [converter(x) for x in value]


def normalize_ratio(value):
    text = str(value).strip()
    if ":" in text:
        left, right = text.split(":", 1)
        if right.strip() != "1":
            raise ModePlanError("Only 2:1 and 3:1 transitions are supported")
        text = left.strip()
    try:
        ratio = int(text)
    except Exception:
        raise ModePlanError("Ratio must be 2:1 or 3:1")
    if ratio not in (2, 3):
        raise ModePlanError("Ratio must be 2:1 or 3:1")
    return ratio


def _ratios(stages, ratio, ratio_sequence):
    stages = int(stages)
    if stages <= 0:
        raise ModePlanError("Transition stages must be positive")
    values = parse_sequence(ratio_sequence, normalize_ratio)
    if not values:
        values = [normalize_ratio(ratio)] * stages
    if len(values) != stages:
        raise ModePlanError("Ratio sequence needs exactly %d entries" % stages)
    return values


def plan_counts(fine_seeds, stages=1, ratio=2, ratio_sequence=None):
    """Plan a straight/annular/cylindrical count chain.

    The required multiple follows the source rule: each stage contributes the
    current refinement product times the template period (4 for 2:1, 3 for
    3:1), combined with an LCM.  No silent rounding is performed.
    """
    n = int(fine_seeds)
    if n <= 0:
        raise ModePlanError("Fine count must be positive")
    ratios = _ratios(stages, ratio, ratio_sequence)
    product = 1
    required = 1
    for current in ratios:
        period = 4 if current == 2 else 3
        term = product * period
        required = required * term // _gcd(required, term)
        product *= current
    if n % required:
        lower = max(required, (n // required) * required)
        upper = max(required, ((n + required - 1) // required) * required)
        raise ModePlanError(
            "Fine count %d requires a multiple of %d; nearby counts: %d / %d"
            % (n, required, lower, upper)
        )
    counts = [n]
    for current in ratios:
        counts.append(counts[-1] // current)
    return {
        "kind": "count-chain", "stages": len(ratios), "ratios": ratios,
        "counts": counts, "required_multiple": required,
        "geometry_checked": False,
    }


def _quad_count_chain(fine_seeds, stages):
    n = int(fine_seeds)
    stages = int(stages)
    if n < 4 or n % 4:
        raise ModePlanError("Four-side 2:1 count must be a positive multiple of 4")
    counts, inputs, collars = [n], [], []
    for index in range(stages):
        pad = 0 if index == 0 else (counts[-1] % 4) // 2
        current = counts[-1] + 2 * pad
        inputs.append(current)
        collars.append(pad)
        counts.append(current // 2 + 2)
    return counts, inputs, collars


def plan_quad_counts(fine_seeds, stages=1, ratio=2, ratio_sequence=None):
    """Plan the rectangular four-side ring, including its two corner ports."""
    ratios = _ratios(stages, ratio, ratio_sequence)
    if all(current == 2 for current in ratios):
        counts, inputs, collars = _quad_count_chain(fine_seeds, stages)
        return {
            "kind": "quad-four-chain", "stages": int(stages), "ratios": ratios,
            "counts": counts, "inputs": inputs, "collars": collars,
            "required_multiple": 4, "corner_contribution": 2,
            "geometry_checked": False,
        }
    counts = [int(fine_seeds)]
    for index, current in enumerate(ratios):
        period = 4 if current == 2 else 3
        strip = counts[-1] if index == 0 else counts[-1] - 2
        if strip <= 0 or strip % period:
            raise ModePlanError(
                "Four-side stage %d strip count %d is not divisible by %d"
                % (index + 1, strip, period)
            )
        counts.append(strip // current + 2)
    return {
        "kind": "quad-four-chain", "stages": int(stages), "ratios": ratios,
        "counts": counts, "corner_contribution": 2,
        "geometry_checked": False,
    }


def allocate_widths(total, counts, widths=None):
    total = _finite_positive(total, "Transition width")
    values = parse_sequence(widths)
    stages = len(counts) - 1
    if values:
        if len(values) != stages or any(not _isfinite(x) or x <= 0 for x in values):
            raise ModePlanError("Provide one positive width per stage")
        if abs(sum(values) - total) > 1.0e-7 * max(total, 1.0):
            raise ModePlanError("Stage widths must sum to the selected width")
        return values
    weights = [1.0 / n for n in counts[:-1]]
    scale = total / sum(weights)
    return [scale * weight for weight in weights]


def stage_boundaries(total, counts, widths=None):
    values = allocate_widths(total, counts, widths)
    output = [0.0]
    for value in values:
        output.append(output[-1] + value)
    return output


def hybrid_split(fine_count, coarse_count, sequence=None, order=""):
    """Split N fine ports into 3:1 groups and paired 2:1 groups."""
    n, m = int(fine_count), int(coarse_count)
    result = {"N": n, "M": m, "ok": False, "mode": "invalid",
              "a": 0, "b": 0, "pairs": 0, "blocks": [], "ports": [],
              "coarse_ports": 0, "error": "", "order": ""}
    if n <= 0 or m <= 0:
        result["error"] = "Hybrid counts must be positive"
        return result
    lower = int(math.ceil(n / 3.0))
    upper = n // 2
    if m < lower or m > upper:
        result["error"] = "Hybrid coarse count must satisfy %d <= M <= %d" % (lower, upper)
        return result
    a, b = n - 2 * m, 3 * m - n
    result["a"], result["b"] = a, b
    if b % 2:
        result["error"] = "The number of 2:1 groups must be even"
        return result
    result["pairs"] = b // 2
    result["mode"] = "pure3" if b == 0 else ("pure2" if a == 0 else "hybrid")
    text = str(sequence or "").strip()
    if text:
        blocks = []
        for item in text.replace(";", ",").split(","):
            token = item.strip().replace(" ", "").lower()
            if token in ("3", "3:1"):
                blocks.append("3")
            elif token in ("22", "2:1,2:1", "22pair", "pair2"):
                blocks.append("22")
            else:
                result["error"] = "Invalid hybrid block %r" % item
                return result
        if sum(3 if x == "3" else 4 for x in blocks) != n or sum(1 if x == "3" else 2 for x in blocks) != m:
            result["error"] = "Hybrid block sequence does not match N/M"
            return result
        result["blocks"], result["order"] = blocks, "user"
    else:
        if str(order).lower() in ("interleave", "spread", "mix"):
            total = a + result["pairs"]
            blocks = []
            for index in range(total):
                before = index * result["pairs"] // total
                after = (index + 1) * result["pairs"] // total
                blocks.append("22" if after > before else "3")
            result["order"] = "interleave"
        elif order == "2-then-3":
            blocks = ["22"] * result["pairs"] + ["3"] * a
            result["order"] = order
        else:
            blocks = ["3"] * a + ["22"] * result["pairs"]
            result["order"] = "grouped"
        result["blocks"] = blocks
    result["ports"] = [3 if block == "3" else 4 for block in result["blocks"]]
    result["coarse_ports"] = sum(1 if block == "3" else 2 for block in result["blocks"])
    result["ok"] = True
    return result


def angular_fit(n_slices, seam_angles_deg=None, tolerance_deg=0.05):
    n = int(n_slices)
    if n < 1:
        raise ModePlanError("n_slices must be positive")
    spacing = 360.0 / n
    seams = sorted(set(round(float(value) % 360.0, 10) for value in (seam_angles_deg or [])))
    coincident, crossing = 0, []
    for angle in seams:
        distance = abs(angle - round(angle / spacing) * spacing)
        distance = min(distance, 360.0 - distance)
        if distance <= max(float(tolerance_deg), 1.0e-6):
            coincident += 1
        else:
            crossing.append(angle)
    verdict = "ok"
    reason = ""
    if seams and coincident == n:
        verdict = "no"
        reason = "All new slice planes coincide with existing radial seams"
    elif crossing:
        verdict = "warn"
        reason = "Existing seams cross %d generated sectors" % len(crossing)
    return {"n_slices": n, "spacing_deg": spacing, "seams": seams,
            "coincident": coincident, "new_planes": max(0, n - coincident),
            "crossing": crossing, "verdict": verdict, "reason": reason}


def capability(mode, ratio, layers=1, hybrid=False):
    mode = str(mode or "").upper()
    ratio = normalize_ratio(ratio) if not hybrid else "hybrid"
    layers = int(layers)
    if mode not in MODES:
        return {"status": "unknown", "mode": mode, "reason": "Unsupported mode"}
    if layers < 1:
        return {"status": "no", "mode": mode, "reason": "Layers must be positive"}
    if hybrid and (mode != "PLANAR" or layers != 1):
        return {"status": "no", "mode": mode, "ratio": "hybrid",
                "reason": "Hybrid is only supported by single-layer PLANAR"}
    if mode == "PLANAR_QUAD_FOUR" and ratio == 3 and layers > 1:
        return {"status": "warn", "mode": mode, "ratio": ratio, "layers": layers,
                "reason": "3:1 four-side multi-layer is constructible but has a high aspect-ratio row"}
    return {"status": "ok", "mode": mode, "ratio": ratio, "layers": layers,
            "bidirectional": mode not in ("PLANAR_QUAD_FOUR", "AXIAL_SURFACE")}


def plan_transition(mode, seeds, ratio=2, layers=1, width=None,
                    ratio_sequence=None, quad=False, coarse_seeds=None,
                    seam_angles_deg=None, hybrid=False):
    mode = str(mode or "").upper()
    verdict = capability(mode, ratio, layers, hybrid=hybrid)
    if verdict.get("status") in ("no", "unknown"):
        raise ModePlanError(verdict["reason"])
    if hybrid:
        if coarse_seeds is None:
            raise ModePlanError("Hybrid mode requires coarse_seeds")
        split = hybrid_split(seeds, coarse_seeds)
        if not split["ok"]:
            raise ModePlanError(split["error"])
        chain = {"kind": "hybrid", "split": split}
    else:
        chain = (plan_quad_counts(seeds, layers, ratio, ratio_sequence)
                 if quad or mode == "PLANAR_QUAD_FOUR"
                 else plan_counts(seeds, layers, ratio, ratio_sequence))
    counts = [seeds, coarse_seeds] if hybrid else chain["counts"]
    widths = allocate_widths(width, counts) if width is not None else None
    result = {"mode": mode, "ratio": ratio if not hybrid else "hybrid",
              "layers": int(layers), "chain": chain, "widths": widths,
              "capability": verdict, "geometry_checked": False}
    if seam_angles_deg is not None and mode in ("ANNULAR_RADIAL", "AXIAL_SURFACE"):
        coarse = chain["counts"][-1] if not hybrid else coarse_seeds
        nslices = coarse // 2 if int(ratio) == 2 else coarse
        result["angular_fit"] = angular_fit(nslices, seam_angles_deg)
    return result
