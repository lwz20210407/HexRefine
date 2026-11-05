"""Exact affine reparameterization of finite, analysis-only curve records.

No native CAD range/flag is edited. The returned pair is (pure_math, trace).
The trace hashes canonical JSON, not the original capture file's byte stream.
Positive affine maps preserve NURBS basis functions over their entire support;
the 17 floating-point witnesses are not a complete Hausdorff certificate.
"""
from collections import Counter
import hashlib
import json
import math
from fractions import Fraction

from .cad_native_payload import evaluate_curve


MAX_CONTROL_POLES = 65536
MAX_DEGREE = 25
MAX_ABSOLUTE_VALUE = 1e12
MAX_DESCRIPTOR_BYTES = 16 * 1024 * 1024
MAX_DESCRIPTOR_ITEMS = 1000000
MAX_DESCRIPTOR_DEPTH = 32
MAX_TEXT_CHARACTERS = 1024 * 1024
MATH_LIMIT = 1e-10
WITNESS_COUNT = 17


class UnsupportedCurveRangeTransfer(ValueError):
    """The requested map has no supported exact mathematical representation."""


def _number(value):
    if (type(value) not in (int, float) or abs(value) > MAX_ABSOLUTE_VALUE
            or not math.isfinite(value)):
        raise ValueError('Require bounded finite numbers, never numeric booleans')
    return float(value)


def _interval(value):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError('Require a two-number finite ascending range')
    a, b = map(_number, value)
    if not a < b:
        raise ValueError('Curve ranges must be strictly ascending')
    return a, b


def _point(value):
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError('Curve coordinates must be three-component JSON vectors')
    for coordinate in value:
        _number(coordinate)
    return list(value)


def _preflight_counts(record):
    if not isinstance(record, dict) or type(record.get('type')) is not int:
        raise ValueError('Require a mathematical curve descriptor with integer type')
    kind = record['type']
    if kind not in (1, 2, 4):
        raise UnsupportedCurveRangeTransfer('Only segments, circles and clamped NURBS are supported')
    if record.get('supported') is not True:
        raise ValueError('Require an explicitly supported mathematical curve')
    if kind == 4:
        degree, poles = record.get('degree'), record.get('poles')
        if (type(degree) is not int or not 1 <= degree <= MAX_DEGREE
                or not isinstance(poles, list) or not degree < len(poles) <= MAX_CONTROL_POLES):
            raise ValueError('NURBS degree/pole budget exceeded before materialization')
        knots, weights = record.get('knots'), record.get('weights')
        if not isinstance(knots, list) or len(knots) != len(poles) + degree + 1:
            raise ValueError('Expanded knot count differs from degree and control poles')
        if type(record.get('rational')) is not bool or not isinstance(weights, list):
            raise ValueError('Require a Boolean rational flag and explicit weight list')
        if len(weights) != (len(poles) if record['rational'] else 0):
            raise ValueError('Rational weight count differs from control poles')
    return kind


def _descriptor_sha256(record):
    items = 0
    text_characters = 0
    active = set()

    def visit(value, depth):
        nonlocal items, text_characters
        items += 1
        if items > MAX_DESCRIPTOR_ITEMS or depth > MAX_DESCRIPTOR_DEPTH:
            raise ValueError('Descriptor structure budget exceeded')
        if value is None or type(value) is bool:
            return
        if type(value) is int:
            if value.bit_length() > 128:
                raise ValueError('Descriptor integer budget exceeded')
            return
        if type(value) is float:
            if not math.isfinite(value):
                raise ValueError('Nonfinite descriptor value')
            return
        if type(value) is str:
            text_characters += len(value)
            if len(value) > MAX_TEXT_CHARACTERS or text_characters > MAX_DESCRIPTOR_BYTES:
                raise ValueError('Descriptor text budget exceeded')
            return
        if type(value) not in (dict, list):
            raise ValueError('Descriptor must contain only JSON-compatible values')
        if len(value) > MAX_DESCRIPTOR_ITEMS or id(value) in active:
            raise ValueError('Oversized or cyclic descriptor container')
        active.add(id(value))
        try:
            if type(value) is dict:
                for key, child in value.items():
                    if type(key) is not str:
                        raise ValueError('Descriptor JSON keys must be strings')
                    visit(key, depth + 1)
                    visit(child, depth + 1)
            else:
                for child in value:
                    visit(child, depth + 1)
        finally:
            active.remove(id(value))

    visit(record, 0)
    encoder = json.JSONEncoder(sort_keys=True, separators=(',', ':'),
                               ensure_ascii=True, allow_nan=False)
    digest = hashlib.sha256()
    size = 0
    for chunk in encoder.iterencode(record):
        encoded = chunk.encode('utf-8')
        size += len(encoded)
        if size > MAX_DESCRIPTOR_BYTES:
            raise ValueError('Canonical descriptor byte budget exceeded')
        digest.update(encoded)
    return digest.hexdigest()


def _math_record(record, kind):
    if kind == 1:
        return dict(type=1, start=_point(record.get('start')),
                    end=_point(record.get('end')), supported=True)
    if kind == 2:
        center = _point(record.get('center'))
        normal = _point(record.get('normal'))
        radius = _point(record.get('radiusVector'))
        radius_length = math.hypot(*radius)
        if (abs(math.hypot(*normal) - 1.) > 1e-12 or radius_length == 0.
                or abs(sum(a * b for a, b in zip(normal, radius))) > 1e-12 * radius_length):
            raise ValueError('Circle requires a unit normal and nonzero perpendicular radius vector')
        return dict(type=2, center=center, normal=normal, radiusVector=radius, supported=True)
    degree = record['degree']
    knots = [_number(k) for k in record['knots']]
    if (any(a > b for a, b in zip(knots, knots[1:])) or not knots[0] < knots[-1]
            or any(k != knots[0] for k in knots[:degree + 1])
            or any(k != knots[-1] for k in knots[-degree - 1:])
            or any(m > degree + 1 for m in Counter(knots).values())):
        raise ValueError('Require a standard expanded, clamped NURBS knot vector')
    weights = list(record['weights'])
    if any(_number(w) <= 0. for w in weights):
        raise ValueError('Rational NURBS weights must be positive')
    return dict(type=4, degree=degree, rational=record['rational'], knots=knots,
                poles=[_point(p) for p in record['poles']], weights=weights, supported=True)


def _affine(value, old, new, scale):
    if value == old[0]:
        return new[0]
    if value == old[1]:
        return new[1]
    return _number(new[0] + (value - old[0]) * scale)


def _cross_validate(original, result, old, new):
    parameters = []
    for i in range(WITNESS_COUNT):
        t = new[0] if i == 0 else new[1] if i == WITNESS_COUNT - 1 else (
            new[0] + (new[1] - new[0]) * i / (WITNESS_COUNT - 1))
        s = old[0] if i == 0 else old[1] if i == WITNESS_COUNT - 1 else (
            old[0] + (t - new[0]) / (new[1] - new[0]) * (old[1] - old[0]))
        parameters.append((s, t))
    if any(a >= c or b >= d for (a, b), (c, d) in zip(parameters, parameters[1:])):
        raise ValueError('Floating-point range cannot provide 17 distinct ordered witnesses')
    rows = []
    maximum = 0.
    for s, t in parameters:
        before = _point(evaluate_curve(original, s).tolist())
        after = _point(evaluate_curve(result, t).tolist())
        error = math.dist(before, after)
        if not math.isfinite(error) or error > MATH_LIMIT:
            raise ValueError('Affine range transfer failed its 1e-10 cross-evaluation limit')
        maximum = max(maximum, error)
        rows.append(dict(oldParameter=s, newParameter=t, originalPoint=before,
                         transferredPoint=after, error=error))
    return rows, maximum


def transfer_curve_range(curve_descriptor, old_range, new_range):
    """Return a fresh (math_descriptor, trace), never modifying capture data.

    Ranges must be finite and ascending. NURBS retain their complete support,
    poles and weights. A type-1 segment becomes a finite degree-1 NURBS, even
    when old_range extrapolates beyond [0,1]. Circles require exactly equal
    angular spans of the supplied binary floating-point endpoints; only their
    phase basis changes. Ellipses and angular scaling are explicitly unsupported.
    Source parameter maps, samples and other provenance are hashed, not copied
    into the new mathematical descriptor or relabelled as native observations.
    """
    old, new = _interval(old_range), _interval(new_range)
    kind = _preflight_counts(curve_descriptor)
    scale = (new[1] - new[0]) / (old[1] - old[0])
    inverse_scale = (old[1] - old[0]) / (new[1] - new[0])
    if not math.isfinite(scale) or not math.isfinite(inverse_scale) or scale <= 0. or inverse_scale <= 0.:
        raise ValueError('Range scaling is not representable by finite positive arithmetic')
    if kind == 2:
        old_span = Fraction(old[1]) - Fraction(old[0])
        new_span = Fraction(new[1]) - Fraction(new[0])
        if old_span != new_span:
            raise UnsupportedCurveRangeTransfer('Circle transfer requires equal angular spans, not angular scaling')
    original_hash = _descriptor_sha256(curve_descriptor)
    original = _math_record(curve_descriptor, kind)
    if kind == 4:
        support = original['knots'][0], original['knots'][-1]
        if not support[0] <= old[0] < old[1] <= support[1]:
            raise ValueError('Finite NURBS trim must lie within the original knot support')
        knots = [_affine(k, old, new, scale) for k in original['knots']]
        if any(a < b and not c < d for a, b, c, d in zip(
                original['knots'], original['knots'][1:], knots, knots[1:])):
            raise ValueError('Affine mapping collapsed distinct knots; no knot merging is authorized')
        result = dict(original, knots=knots)
        method = 'affine-expanded-NURBS-knots'
    elif kind == 1:
        poles = [_point(evaluate_curve(original, t).tolist()) for t in old]
        result = dict(type=4, degree=1, rational=False, knots=[new[0], new[0], new[1], new[1]],
                      poles=poles, weights=[], supported=True)
        method = 'finite-segment-to-degree-1-NURBS'
    else:
        phase = old[0] - new[0]
        normal, radius = original['normal'], original['radiusVector']
        cross = [normal[1] * radius[2] - normal[2] * radius[1],
                 normal[2] * radius[0] - normal[0] * radius[2],
                 normal[0] * radius[1] - normal[1] * radius[0]]
        rotated = [a * math.cos(phase) + b * math.sin(phase) for a, b in zip(radius, cross)]
        result = dict(original, radiusVector=_point(rotated))
        method = 'equal-angular-span-circle-phase-basis-rotation'
    witnesses, maximum = _cross_validate(original, result, old, new)
    if _descriptor_sha256(curve_descriptor) != original_hash:
        raise ValueError('Input descriptor changed during range transfer')
    trace = dict(schemaVersion=1, origin='analysis-only-affine-curve-range-transfer',
                 analysisOnly=True, nativeHostVerified=False, fittingPerformed=False,
                 originalDescriptorSHA256=original_hash,
                 originalDescriptorHashEncoding='canonical-JSON-sort-keys-ASCII-compact-v1; not capture-file bytes',
                 inputDescriptorUnmodified=True, oldRange=list(old), newRange=list(new), method=method,
                 parameterMap=dict(kind='affine-new-to-old', oldStart=old[0], newStart=new[0],
                                   scale=inverse_scale),
                 droppedInputFields=sorted(set(curve_descriptor) - set(original)),
                 sourceMetadataTransferred=False, sourceParameterMapTransferred=False,
                 exactLocusConversionTransferred=False, witnessCount=WITNESS_COUNT,
                 maximumCrossEvaluationError=maximum, witnesses=witnesses,
                 realArithmeticIdentity='Cnew(t) = Cold(a + (t-na)*(b-a)/(nb-na))',
                 identityAssumptions='Valid clamped NURBS or finite linear segment; '
                                     'circles additionally require a unit normal and perpendicular radius',
                 certificateScope='Real-arithmetic affine identity plus finite floating-point witnesses; '
                                  'not a complete Hausdorff, native-CAD or topology certificate')
    if kind == 4:
        trace.update(originalFullSupport=[original['knots'][0], original['knots'][-1]],
                     transferredFullSupport=[result['knots'][0], result['knots'][-1]],
                     controlPolesAndWeightsUnchanged=True, knotMergingPerformed=False)
    return result, trace
