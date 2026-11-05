"""Reconstruct ONLY mathematical NURBS supports captured by the public SDK.

The native UV rectangle is a parameter bound, NOT a trimmed face. No face,
wire, solid, native-HM acceptance or source/native entity pairing is created.
Optional extra samples use {"uv": [u,v], "point": [x,y,z]} records, supplied
explicitly by the caller; points are never synthesized as native evidence.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path


SAMPLE_LIMIT = 1e-10
MAX_FACES = 1024
MAX_POLES = 65536
MAX_CAPTURE_POLES = 262144
MAX_CAPTURE_BYTES = 16*1024**2
MAX_SAMPLES = 4096
MAX_TOTAL_SAMPLES = 65536


def _number(value, name, maximum=1e12):
    if type(value) not in (int, float) or abs(value) > maximum or not math.isfinite(value):
        raise ValueError(f'{name} must be a bounded finite number, not a Boolean or string')
    return float(value)


def _integer(value, low, high, name):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f'{name} must be an integer in [{low},{high}]')
    return value


def _vector(value, length, name):
    if not isinstance(value, (list, tuple)) or len(value) != length:
        raise ValueError(f'{name} must contain exactly {length} values')
    return tuple(_number(v, name) for v in value)


def _knots(raw, count, degree, name):
    values = _vector(raw, count+degree+1, name)
    unique, multiplicities = [], []
    for k in values:
        if unique and k < unique[-1]:
            raise ValueError(f'{name} must be nondecreasing')
        if unique and k == unique[-1]:
            multiplicities[-1] += 1
        else:
            unique.append(k);multiplicities.append(1)
    if (len(unique) < 2 or multiplicities[0] != degree+1 or multiplicities[-1] != degree+1
            or any(m > degree for m in multiplicities[1:-1])):
        raise ValueError(f'{name} must be standard clamped knots with valid interior multiplicities')
    return values, tuple(unique), tuple(multiplicities)


@dataclass(frozen=True)
class NurbsDefinition:
    index: int
    degree: tuple[int, int]
    shape: tuple[int, int]
    rational: tuple[bool, bool]
    uv: tuple[float, float, float, float]
    normal_sense: bool
    midpoint: tuple[float, float, float]
    poles_u_fast: tuple[tuple[float, float, float], ...]
    compact_weights: tuple[float, ...]
    u_expanded: tuple[float, ...]
    v_expanded: tuple[float, ...]
    u_knots: tuple[float, ...]
    v_knots: tuple[float, ...]
    u_mults: tuple[int, ...]
    v_mults: tuple[int, ...]
    native_samples: tuple = ()

    def weight(self, u, v):
        """Zero-based pole indices, using the SDK's compact rational layouts."""
        if not any(self.rational):return 1.
        if all(self.rational):return self.compact_weights[v*self.shape[0]+u]
        return self.compact_weights[u if self.rational[0] else v]


def validate_nurbs_record(record):
    """Pure, bounded schema validation before allocating any OCCT arrays."""
    if not isinstance(record, dict) or type(record.get('type')) is not int or record['type'] != 6:
        raise ValueError('Only explicit SDK type 6 NURBS records may be reconstructed')
    index = _integer(record.get('index'), 0, MAX_FACES-1, 'index')
    degree, shape, rational = (record.get(k) for k in ('degree', 'shape', 'rational'))
    for name, value in (('degree', degree), ('shape', shape), ('rational', rational)):
        if not isinstance(value, (tuple, list)) or len(value) != 2:
            raise ValueError(f'{name} requires two axis values')
    degree = tuple(_integer(v, 1, 25, 'degree') for v in degree)
    shape = tuple(_integer(v, 2, 512, 'pole count') for v in shape)
    if shape[0]*shape[1] > MAX_POLES or any(n <= p for n,p in zip(shape, degree)):
        raise ValueError('Pole allocation or degree/pole relation exceeds limits')
    if any(type(v) is not bool for v in rational) or type(record.get('normalSense')) is not bool:
        raise ValueError('Rational flags and normalSense must be actual Booleans')
    uv = _vector(record.get('uv'), 4, 'uv')
    if not uv[0] < uv[1] or not uv[2] < uv[3]:
        raise ValueError('Require positive bounded U/V intervals')
    uk, u, um = _knots(record.get('uKnots'), shape[0], degree[0], 'uKnots')
    vk, v, vm = _knots(record.get('vKnots'), shape[1], degree[1], 'vKnots')
    if not u[0] <= uv[0] < uv[1] <= u[-1] or not v[0] <= uv[2] < uv[3] <= v[-1]:
        raise ValueError('Captured UV rectangle lies outside the mathematical knot domain')
    raw = record.get('polesUFast')
    if not isinstance(raw, (list, tuple)) or len(raw) != shape[0]*shape[1]:
        raise ValueError('U-fast pole count does not match the captured shape')
    poles = tuple(_vector(p, 3, 'pole') for p in raw)
    count = shape[0]*shape[1] if all(rational) else shape[0] if rational[0] else shape[1] if rational[1] else 0
    weights = _vector(record.get('weights'), count, 'weights')
    if any(not 1e-12 <= w <= 1e12 for w in weights):
        raise ValueError('Weights must be finite positive values in [1e-12,1e12]; no normalization is applied')
    samples = []
    if 'nativeSamples' in record:
        raw_samples = record['nativeSamples']
        if not isinstance(raw_samples, (list, tuple)) or not 1 <= len(raw_samples) <= MAX_SAMPLES:
            raise ValueError('nativeSamples requires 1..4096 explicitly captured samples')
        for sample in raw_samples:
            if not isinstance(sample, dict):raise ValueError('nativeSamples entries require uv and point')
            suv = _vector(sample.get('uv'), 2, 'native sample uv')
            xyz = _vector(sample.get('point'), 3, 'native sample point')
            if not uv[0] <= suv[0] <= uv[1] or not uv[2] <= suv[1] <= uv[3]:
                raise ValueError('Native sample lies outside captured parameter bounds')
            samples.append((suv, xyz))
    return NurbsDefinition(index, degree, shape, tuple(rational), uv, record['normalSense'],
        _vector(record.get('untrimmedMidpoint'), 3, 'untrimmedMidpoint'), poles, weights,
        uk, vk, u, v, um, vm, tuple(samples))


@dataclass(frozen=True)
class NurbsSupport:
    definition: NurbsDefinition
    surface: object
    native_midpoint_error: float

    def value(self, u, v):
        u, v = _number(u, 'u'), _number(v, 'v')
        bounds = self.definition.uv
        if not bounds[0] <= u <= bounds[1] or not bounds[2] <= v <= bounds[3]:
            raise ValueError('Evaluation outside captured parameter bounds is not allowed')
        p = self.surface.Value(u, v)
        return _vector((p.X(), p.Y(), p.Z()), 3, 'evaluated point')


def _build(definition):
    from OCP.Geom import Geom_BSplineSurface
    from OCP.TColgp import TColgp_Array2OfPnt
    from OCP.TColStd import TColStd_Array1OfInteger, TColStd_Array1OfReal, TColStd_Array2OfReal
    from OCP.gp import gp_Pnt
    nu, nv = definition.shape
    poles = TColgp_Array2OfPnt(1, nu, 1, nv)
    for j in range(nv):
        for i in range(nu):
            poles.SetValue(i+1, j+1, gp_Pnt(*definition.poles_u_fast[j*nu+i]))
    def real_array(values):
        result = TColStd_Array1OfReal(1, len(values))
        for i,x in enumerate(values, 1):result.SetValue(i, x)
        return result
    def multiplicities(values):
        result = TColStd_Array1OfInteger(1, len(values))
        for i,x in enumerate(values, 1):result.SetValue(i, x)
        return result
    args = (real_array(definition.u_knots), real_array(definition.v_knots),
            multiplicities(definition.u_mults), multiplicities(definition.v_mults),
            *definition.degree, False, False)
    try:
        if any(definition.rational):
            weights = TColStd_Array2OfReal(1, nu, 1, nv)
            for j in range(nv):
                for i in range(nu):weights.SetValue(i+1, j+1, definition.weight(i, j))
            surface = Geom_BSplineSurface(poles, weights, *args)
        else:surface = Geom_BSplineSurface(poles, *args)
    except Exception as error:
        raise ValueError(f'OCCT rejected captured NURBS index {definition.index}: {error}') from error
    bounds = definition.uv
    provisional = NurbsSupport(definition, surface, float('inf'))
    uv = ((bounds[0]+bounds[1])/2, (bounds[2]+bounds[3])/2)
    error = math.dist(provisional.value(*uv), definition.midpoint)
    if not math.isfinite(error) or error > SAMPLE_LIMIT:
        raise ValueError(f'Native midpoint mismatch at NURBS index {definition.index}: {error}')
    support = NurbsSupport(definition, surface, error)
    if definition.native_samples:
        validate_native_samples(support, [dict(uv=uv,point=point) for uv,point in definition.native_samples])
    return support


def reconstruct_nurbs(record):
    """Create one caller-owned OCCT support and verify its native midpoint."""
    return _build(validate_nurbs_record(record))


def reconstruct_capture(document):
    """Preflight all records/budgets before building any captured NURBS support."""
    if not isinstance(document, dict) or document.get('complete') is not True:
        raise ValueError('Require an explicitly completed native capture')
    count = _integer(document.get('faceCount'), 1, MAX_FACES, 'faceCount')
    faces = document.get('faces')
    if not isinstance(faces, list) or len(faces) != count:
        raise ValueError('Captured face count differs from actual records')
    ids, definitions = [], []
    for row in faces:
        if not isinstance(row, dict):raise ValueError('Each captured face must be a record')
        ids.append(_integer(row.get('index'), 0, count-1, 'face index'))
        _integer(row.get('type'), 1, 64, 'surface type')
        if row['type'] == 6:definitions.append(validate_nurbs_record(row))
    if sorted(ids) != list(range(count)):
        raise ValueError('Native face indices must be complete, unique and zero-based')
    if not definitions or sum(d.shape[0]*d.shape[1] for d in definitions) > MAX_CAPTURE_POLES:
        raise ValueError('No NURBS records or total control-pole budget exceeded')
    if sum(len(d.native_samples) for d in definitions) > MAX_TOTAL_SAMPLES:
        raise ValueError('Total embedded native sample budget exceeded')
    return {d.index: _build(d) for d in definitions}


def validate_native_samples(support, samples):
    """Compare explicitly captured points, without generating native evidence."""
    if not isinstance(support, NurbsSupport) or not isinstance(samples, (list, tuple)) or not 1 <= len(samples) <= MAX_SAMPLES:
        raise ValueError('Require a reconstructed support and 1..4096 actual native samples')
    rows = []
    for row in samples:
        if not isinstance(row, dict):raise ValueError('Native samples require explicit uv and point fields')
        uv, point = _vector(row.get('uv'), 2, 'sample uv'), _vector(row.get('point'), 3, 'native sample point')
        actual = support.value(*uv);error = math.dist(actual, point)
        if not math.isfinite(error) or error > SAMPLE_LIMIT:
            raise ValueError(f'Native sample mismatch at NURBS index {support.definition.index}, uv={uv}: {error}')
        rows.append(dict(uv=list(uv), nativePoint=list(point), reconstructedPoint=list(actual), error=error))
    return dict(index=support.definition.index, samples=len(rows), maximumSampleError=max(r['error'] for r in rows),
                sampleLimit=SAMPLE_LIMIT, observations=rows, mathematicalSupportOnly=True,
                trimmedCadVerified=False, nativeHmVerified=False)


def verify_capture(path, extra_samples_by_index=None):
    """Read a bounded capture and verify native midpoints plus optional real samples.

    Returns (supports_by_native_index, report). Extra samples must use integer
    native indices, NOT source STEP face indices; no entity mapping is inferred.
    """
    path = Path(path).resolve()
    with path.open('rb') as stream:raw = stream.read(MAX_CAPTURE_BYTES+1)
    if not 0 < len(raw) <= MAX_CAPTURE_BYTES:raise ValueError('Native capture exceeds 16 MiB or is empty')
    def pairs(items):
        result = {}
        for k,v in items:
            if k in result:raise ValueError('Duplicate JSON object key')
            result[k] = v
        return result
    def nonfinite(value):raise ValueError(f'Nonfinite JSON constant {value}')
    document = json.loads(raw, object_pairs_hook=pairs, parse_constant=nonfinite)
    supports = reconstruct_capture(document)
    extra = {} if extra_samples_by_index is None else extra_samples_by_index
    if not isinstance(extra, dict) or any(type(i) is not int or i not in supports for i in extra):
        raise ValueError('Extra native samples must identify captured NURBS indices')
    if any(not isinstance(v, (list, tuple)) for v in extra.values()) or sum(map(len, extra.values())) > MAX_TOTAL_SAMPLES:
        raise ValueError('Extra native sample budget exceeded')
    results = []
    for i,support in supports.items():
        bounds = support.definition.uv
        samples = [dict(uv=[(bounds[0]+bounds[1])/2, (bounds[2]+bounds[3])/2],point=list(support.definition.midpoint))]
        checked = validate_native_samples(support, samples)
        if support.definition.native_samples:
            checked['embeddedNativeSamples'] = validate_native_samples(support,
                [dict(uv=uv,point=point) for uv,point in support.definition.native_samples])
        if i in extra:checked['additionalSamples'] = validate_native_samples(support, extra[i])
        results.append(checked)
    embedded = [r['embeddedNativeSamples'] for r in results if 'embeddedNativeSamples' in r]
    if sum(r['samples'] for r in embedded)+sum(map(len, extra.values())) > MAX_TOTAL_SAMPLES:
        raise ValueError('Combined native sample budget exceeded')
    with path.open('rb') as stream:after = stream.read(MAX_CAPTURE_BYTES+1)
    if hashlib.sha256(after).hexdigest() != hashlib.sha256(raw).hexdigest():
        raise ValueError('Native capture changed during reconstruction')
    return supports, dict(schemaVersion=1, purpose='captured-mathematical-NURBS-reconstruction',
        captureSHA256=hashlib.sha256(raw).hexdigest(), nativeFaces=document['faceCount'], reconstructedNurbs=len(supports),
        skippedNonNurbs=document['faceCount']-len(supports), nativeMidpointsChecked=len(results),
        maximumNativeMidpointError=max(s.native_midpoint_error for s in supports.values()),
        embeddedNativeSampleFaces=len(embedded), embeddedNativeSamplesChecked=sum(r['samples'] for r in embedded),
        maximumEmbeddedNativeSampleError=max((r['maximumSampleError'] for r in embedded), default=None),
        embeddedSamplesOnEveryNurbs=len(embedded)==len(supports),
        additionalNativeSamples=sum(map(len, extra.values())), sampleLimit=SAMPLE_LIMIT,
        coordinateUnits='unchanged capture units; no unit conversion',
        parametersNormalized=False, weightsNormalized=False, knotToleranceMerging=False,
        poleOrder='U-fast: offset=v*nu+u', mathematicalSupportOnly=True,
        trimmedCadVerified=False, nativeHmVerified=False, fullModelAcceptance=False, results=results)
