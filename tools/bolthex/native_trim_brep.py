"""Increment 1: source-labelled native supports, real trim domains and queries.

Only the captured native mathematics is reconstructed. Source-OCP payload
conventions are NOT interchangeable with SDK conventions. UV rectangles bound
searches; actual PCurve loops define material. No HM, source STEP, ShapeFix,
BuildCurves3d or product/provenance certificate is invoked here. Physical-face
Sew/MakeSolid and independent solid volume are NOT implemented in this increment.

Dependencies: NumPy/OCP, native_nurbs_capture and native_curve_range. Supported
analytic parameterizations are deliberately limited; unsupported faces remain
explicit failures, never dropped from a whole-component result.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
import hashlib
import json
import math
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from .native_curve_range import transfer_curve_range
from .native_nurbs_capture import reconstruct_nurbs, validate_nurbs_record

MATH_LIMIT = 1e-10
MAX_BYTES = 16 * 1024**2
MAX_FACES = 1024
MAX_COEDGES = 8192
MAX_POINTS = 262144
MAX_SAMPLES = 65536
MAX_ENDPOINT_BINDING_TOLERANCE = 1e-4


class _EvidenceContradiction(ValueError):
    pass


def _number(x):
    if type(x) not in (int, float) or not math.isfinite(x) or abs(x) > 1e12:
        raise ValueError('Require bounded finite numbers, not numeric booleans')
    return float(x)


def _vec(x, n=3):
    if isinstance(x, np.ndarray):
        x = x.tolist()
    if not isinstance(x, (list, tuple)) or len(x) != n:
        raise ValueError('Invalid coordinate/count vector')
    return np.array([_number(v) for v in x])


def _integer(x, low=0, high=2**31-1):
    if type(x) is not int or not low <= x <= high:
        raise ValueError('Invalid bounded integer identity/count')
    return x


def _interval(x):
    a, b = _vec(x, 2)
    if not a < b:
        raise ValueError('Only finite ascending captured ranges are supported')
    return float(a), float(b)


def _label(x):
    if not isinstance(x, str) or not x.strip() or len(x) > 256:
        raise ValueError('An explicit bounded source label is required')
    return x


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _read(path, limit):
    path = Path(path).resolve()
    if not path.is_file() or not 0 < path.stat().st_size <= limit:
        raise ValueError('Input file byte budget exceeded or file missing')
    raw = path.read_bytes()
    if len(raw) > limit:
        raise ValueError('Input changed beyond byte budget')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON key: ' + key)
            result[key] = value
        return result
    def nonfinite(value):
        raise ValueError('Nonfinite JSON constant: ' + value)
    try:
        doc = json.loads(raw, object_pairs_hook=pairs, parse_constant=nonfinite)
    except (RecursionError, UnicodeError) as error:
        raise ValueError('Invalid bounded JSON') from error
    return path, raw, doc


@dataclass(frozen=True)
class NativeConventions:
    source_label: str
    calibration_sha256: str
    true_means_same: bool
    true_means_end: bool
    control_records: int
    capture_kind: str = 'hypermesh-extapi-native'


def load_conventions(path, *, source_label, expected_sha256=None):
    """Infer bool conventions from actual quarter-point/endpoint controls.

    This is a finite calibration, not a vendor-wide contract or provenance
    certificate. Both directions in the full capture are still checked in math.
    """
    _label(source_label)
    _, raw, doc = _read(path, 1024**2)
    if expected_sha256 is not None and _sha(raw) != expected_sha256:
        raise ValueError('Calibration byte hash mismatch')
    if doc.get('completed') is not True:
        raise ValueError('Require a completed convention control')
    senses, ends, records = set(), set(), 0
    for face in doc.get('faces', []):
        for c in face.get('coedges', []):
            if records >= 128 or type(c.get('edgeSenseRaw')) is not bool:
                raise ValueError('Invalid convention control budget/flag')
            samples = c.get('samples', [])
            if not 5 <= len(samples) <= 65:
                raise ValueError('Control requires bounded quarter samples')
            rows = {}
            for s in samples:
                t = _number(s.get('fraction'))
                if s.get('available') is not True or t in rows or not 0 <= t <= 1:
                    raise ValueError('Invalid actual control samples')
                rows[t] = (_vec(s.get('coedgeWorld')), _vec(s.get('edgeWorld')))
            if not {0., .25, .5, .75, 1.} <= set(rows):
                raise ValueError('Missing actual quarter samples')
            same = max(np.linalg.norm(a-b) for a, b in rows.values()) <= MATH_LIMIT
            reverse = max(np.linalg.norm(rows[t][0]-rows[1-t][1]) for t in (0., .25, .5, .75, 1.)) <= MATH_LIMIT
            if same == reverse:
                raise ValueError('Ambiguous control direction')
            senses.add(c['edgeSenseRaw'] == bool(same))
            if np.linalg.norm(rows[0.][1]-rows[1.][1]) > MATH_LIMIT:
                vertices = c.get('vertices', [])
                if len(vertices) != 2:
                    raise ValueError('Control endpoints are incomplete')
                for v in vertices:
                    if v.get('available') is not True or type(v.get('atEndRaw')) is not bool:
                        raise ValueError('Missing actual control vertex')
                    point = _vec(v.get('xyz'))
                    start, end = (np.linalg.norm(point-rows[t][1]) <= MATH_LIMIT for t in (0., 1.))
                    if start == end:
                        raise ValueError('Ambiguous control endpoint')
                    ends.add(v['atEndRaw'] == bool(end))
            records += 1
    if len(senses) != 1 or len(ends) != 1:
        raise ValueError('Missing or contradictory convention calibration')
    return NativeConventions(source_label, _sha(raw), senses.pop(), ends.pop(), records)


@dataclass(frozen=True)
class NativeCapture:
    path: Path
    raw: bytes
    source_label: str
    conventions: NativeConventions

    @property
    def sha256(self):
        return _sha(self.raw)

    def unchanged(self):
        return self.path.is_file() and self.path.read_bytes() == self.raw


def _preflight(doc):
    if not isinstance(doc, dict) or doc.get('complete') is not True:
        raise ValueError('Require a complete native capture')
    # Explicit namespace contradictions must not be laundered by a native
    # calibration supplied separately by the caller.
    stack, items = [(doc, 0)], 0
    marker_keys = {'origin', 'dataorigin', 'idnamespace', 'sourcenamespace', 'capturekind'}
    native_markers = {'native', 'hypermesh-extapi-native', 'native-sdk', 'native-sdk-capture'}
    while stack:
        value, depth = stack.pop(); items += 1
        if depth > 32 or items > 1000000: raise ValueError('Capture structure budget exceeded')
        if type(value) is float and not math.isfinite(value): raise ValueError('Nonfinite capture metadata')
        if isinstance(value, dict):
            for key, child in value.items():
                if key.lower() in marker_keys and (not isinstance(child, str) or child.lower() not in native_markers):
                    raise ValueError('Native source/namespace contradiction at '+key)
                stack.append((child, depth+1))
        elif isinstance(value, list):stack.extend((child, depth+1) for child in value)
    count = _integer(doc.get('faceCount'), 1, MAX_FACES)
    faces = doc.get('faces')
    if not isinstance(faces, list) or len(faces) != count:
        raise ValueError('Incomplete face inventory')
    components, indices, nedge, points, samples = set(), [], 0, 0, 0
    observed_vertices, shared_curves, shared_endpoints = {}, {}, {}
    binding_tolerance = _number(doc.get('modelToleranceAfter', MATH_LIMIT))
    if not 0 < binding_tolerance <= MAX_ENDPOINT_BINDING_TOLERANCE:
        raise ValueError('Native endpoint tolerance outside this bounded input scope')
    for f in faces:
        indices.append(_integer(f.get('index'), 0, count-1))
        components.add(_label(f.get('component')))
        _integer(f.get('type'), 1, 6)
        if type(f.get('normalSense')) is not bool or f.get('loopCaptureComplete') is not True:
            raise ValueError('Incomplete face orientation/loop capture')
        u0, u1, v0, v1 = _vec(f.get('uv'), 4)
        if not u0 < u1 or not v0 < v1:
            raise ValueError('Invalid native UV bounds')
        if f['type'] == 6:
            poles = f.get('polesUFast')
            if not isinstance(poles, list) or len(poles) > 65536:
                raise ValueError('Surface pole budget exceeded before OCCT')
            points += len(poles)
        native_samples = f.get('nativeSamples')
        loops = f.get('loops')
        if not isinstance(native_samples, list) or not 1 <= len(native_samples) <= 4096:
            raise ValueError('Native support samples are required')
        if not isinstance(loops, list) or not 1 <= len(loops) <= MAX_COEDGES:
            raise ValueError('Incomplete loop inventory')
        samples += len(native_samples)
        loop_ids = set()
        for loop in loops:
            ident = _integer(loop.get('index'))
            if ident in loop_ids:
                raise ValueError('Duplicate native loop index')
            loop_ids.add(ident)
            coedges = loop.get('coedges')
            if not isinstance(coedges, list) or not 1 <= len(coedges) <= MAX_COEDGES:
                raise ValueError('Invalid coedge inventory')
            nedge += len(coedges)
            for c in coedges:
                _integer(c.get('nativeEdgeId'))
                _interval(c.get('coedgeRange')); _interval(c.get('edgeRange'))
                if type(c.get('loopSense')) is not bool or type(c.get('edgeSenseRaw')) is not bool:
                    raise ValueError('Native senses must be actual booleans')
                vertices = c.get('vertices')
                if not isinstance(vertices, list) or len(vertices) != 2:
                    raise ValueError('Missing actual endpoints')
                for v in vertices:
                    _integer(v.get('nativeVertexId'))
                    if v.get('available') is not True or type(v.get('atEndRaw')) is not bool:
                        raise ValueError('Missing native endpoint identity; no sentinel welding')
                    _vec(v.get('point'))
                    ident, point = v['nativeVertexId'], v['point']
                    if ident in observed_vertices and math.dist(point, observed_vertices[ident]) > MATH_LIMIT:
                        raise ValueError('Contradictory observed vertex coordinates for ID '+str(ident))
                    observed_vertices.setdefault(ident, point)
                for name in ('curve2d', 'curve3d'):
                    curve = c.get(name)
                    if name == 'curve3d' and curve is None:
                        continue
                    if not isinstance(curve, dict) or curve.get('supported') is not True:
                        raise ValueError('Unsupported captured curve')
                    kind = _integer(curve.get('type'), 1, 5)
                    if kind not in ((1, 2, 4) if name == 'curve2d' else (1, 2, 4, 5)):
                        raise ValueError('Unsupported curve type')
                    for key in ('poles', 'points'):
                        if key in curve:
                            if not isinstance(curve[key], list) or len(curve[key]) > 65536:
                                raise ValueError('Curve point budget exceeded')
                            points += len(curve[key])
                if c.get('curve3d') is not None:
                    signature = json.dumps(dict(curve=c['curve3d'], range=c['edgeRange']), sort_keys=True, allow_nan=False)
                    ident = c['nativeEdgeId']
                    if ident in shared_curves and shared_curves[ident] != signature:
                        raise ValueError('Contradictory canonical C3D record for shared edge '+str(ident))
                    shared_curves.setdefault(ident, signature)
                    endpoints = sorted((v['atEndRaw'], v['nativeVertexId'], tuple(v['point'])) for v in c['vertices'])
                    if ident in shared_endpoints and shared_endpoints[ident] != endpoints:
                        raise ValueError('Contradictory captured endpoint identities for shared edge '+str(ident))
                    shared_endpoints.setdefault(ident, endpoints)
                on = c.get('onSurfaceSamples')
                if not isinstance(on, list) or not 2 <= len(on) <= 4096:
                    raise ValueError('Actual on-surface endpoint samples are required')
                samples += len(on)
        if nedge > MAX_COEDGES or points > MAX_POINTS or samples > MAX_SAMPLES:
            raise ValueError('Aggregate capture allocation budget exceeded before OCCT')
    if sorted(indices) != list(range(count)):
        raise ValueError('Native face indices must be unique and complete')
    if len(components) != 1:
        raise ValueError('One CAD component per reconstruction; no cross-component weld')
    return count, nedge


def load_capture(path, *, source_label, conventions, expected_sha256=None):
    _label(source_label)
    if not isinstance(conventions, NativeConventions) or conventions.capture_kind != 'hypermesh-extapi-native':
        raise ValueError('Explicit calibrated native SDK conventions required, not source-OCP semantics')
    if type(conventions.true_means_same) is not bool or type(conventions.true_means_end) is not bool:
        raise ValueError('Invalid convention flags')
    path, raw, doc = _read(path, MAX_BYTES)
    if expected_sha256 is not None and _sha(raw) != expected_sha256:
        raise ValueError('Capture byte hash mismatch')
    _preflight(doc)
    return NativeCapture(path, raw, source_label, conventions)


@lru_cache(maxsize=1)
def _kernel():
    from OCP.Geom import Geom_Plane, Geom_SphericalSurface, Geom_CylindricalSurface, Geom_ConicalSurface, Geom_BSplineCurve, Geom_Circle
    from OCP.Geom2d import Geom2d_Circle, Geom2d_BSplineCurve
    from OCP.GeomAPI import GeomAPI, GeomAPI_ProjectPointOnSurf, GeomAPI_ProjectPointOnCurve
    from OCP.GeomAdaptor import GeomAdaptor_Surface, GeomAdaptor_Curve
    from OCP.Geom2dAdaptor import Geom2dAdaptor_Curve
    from OCP.Adaptor3d import Adaptor3d_CurveOnSurface
    from OCP.Extrema import Extrema_ExtPC
    from OCP.Bnd import Bnd_Box2d
    from OCP.BndLib import BndLib_Add2dCurve
    from OCP.gp import gp_Pnt, gp_Dir, gp_Ax2, gp_Ax3, gp_Pln, gp_Ax2d, gp_Pnt2d, gp_Dir2d, gp_Vec, gp_Vec2d
    from OCP.TColgp import TColgp_Array1OfPnt, TColgp_Array1OfPnt2d
    from OCP.TColStd import TColStd_Array1OfReal, TColStd_Array1OfInteger
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire, BRepBuilderAPI_MakeFace
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.BRepClass import BRepClass_FaceClassifier
    from OCP.TopoDS import TopoDS
    from OCP.TopAbs import TopAbs_IN, TopAbs_ON
    return SimpleNamespace(**locals())


def _xyz(p):
    return [p.X(), p.Y(), p.Z()]


def _unit(v):
    v = _vec(v)
    if abs(np.linalg.norm(v)-1.) > 1e-12:
        raise ValueError('Unsupported non-unit native analytic basis')
    return v


def _axis(center, n, x):
    k = _kernel(); n, x = _unit(n), _unit(x)
    if abs(np.dot(n, x)) > 1e-12:
        raise ValueError('Nonorthogonal analytic axes')
    return k.gp_Ax3(k.gp_Pnt(*_vec(center)), k.gp_Dir(*n), k.gp_Dir(*x))


def _support(r):
    k = _kernel(); kind = r['type']
    if kind == 6:
        validate_nurbs_record(r)
        return reconstruct_nurbs(r).surface
    if kind == 1:
        u, v = _unit(r['planeU']), _unit(r['planeV'])
        if abs(np.dot(u, v)) > 1e-12:
            raise ValueError('Nonorthogonal native plane')
        return k.Geom_Plane(_axis(r['planeBase'], np.cross(u, v), u))
    if kind == 2:
        if r.get('sphereReverseU') is not False:
            raise ValueError('Reverse-U sphere not verified by this kernel')
        radius = _number(r['sphereRadius'])
        if radius <= 0: raise ValueError('Invalid sphere radius')
        return k.Geom_SphericalSurface(_axis(r['sphereCenter'], r['sphereNorth'], r['sphereOrigin']), radius)
    if kind == 3:
        if _number(r['cylinderVFactor']) != 1.:
            raise ValueError('Non-unit cylinder V parameterization unsupported')
        radius = _number(r['cylinderRadius'])
        if radius <= 0: raise ValueError('Invalid cylinder radius')
        return k.Geom_CylindricalSurface(_axis(r['cylinderCenter'], r['cylinderAxis'], r['cylinderOrigin']), radius)
    if kind == 4:
        if _number(r['coneRatio']) != 1. or _number(r['coneVParam']) != 0.:
            raise ValueError('Elliptic/offset cone parameterization unsupported')
        major, n = _vec(r['coneMajor']), _unit(r['coneAxis']); radius = np.linalg.norm(major)
        if radius <= 0: raise ValueError('Invalid cone radius')
        slope, axial = radius*_number(r['coneVFactor']), _number(r['coneAxisVFactor'])
        if abs(math.hypot(slope, axial)-1.) > 1e-12:
            raise ValueError('Non-arc-length cone V unsupported')
        phase = _number(r['conePhase']); x = major/radius
        x = x*math.cos(phase)-np.cross(n, x)*math.sin(phase)
        return k.Geom_ConicalSurface(_axis(r['coneCenter'], n, x), math.atan2(slope, axial), radius)
    raise ValueError('Unsupported native support')


def _array(values, integer=False):
    k = _kernel(); a = (k.TColStd_Array1OfInteger if integer else k.TColStd_Array1OfReal)(1, len(values))
    for i, x in enumerate(values, 1): a.SetValue(i, int(x) if integer else float(x))
    return a


def _curve(record, interval, dimension):
    k = _kernel(); a, b = interval
    if record['type'] == 5:
        ts, points = record.get('parameters'), record.get('points')
        if not isinstance(ts, list) or not isinstance(points, list) or len(ts) != len(points) or len(ts) < 2:
            raise ValueError('Incomplete finite native polyline')
        ts = [_number(t) for t in ts]
        if any(x >= y for x, y in zip(ts, ts[1:])) or not ts[0] <= a < b <= ts[-1]:
            raise ValueError('Invalid finite polyline parameter support')
        record = dict(type=4, degree=1, rational=False, knots=[ts[0], *ts, ts[-1]], poles=points, weights=[], supported=True)
    clean, _ = transfer_curve_range(record, [a, b], [a, b])
    if clean['type'] == 2:
        c, n, radius = (_vec(clean[x]) for x in ('center', 'normal', 'radiusVector'))
        if dimension == 3:
            return k.Geom_Circle(k.gp_Ax2(k.gp_Pnt(*c), k.gp_Dir(*n), k.gp_Dir(*radius)), float(np.linalg.norm(radius)))
        if abs(c[2])+abs(radius[2])+abs(n[0])+abs(n[1]) > 1e-12:
            raise ValueError('PCurve circle is not in UV plane')
        return k.Geom2d_Circle(k.gp_Ax2d(k.gp_Pnt2d(*c[:2]), k.gp_Dir2d(*radius[:2])), float(np.linalg.norm(radius)), bool(n[2] > 0))
    poles = clean['poles']; unique, mult = [], []
    for t in clean['knots']:
        if unique and t == unique[-1]: mult[-1] += 1
        else: unique.append(t); mult.append(1)
    p = (k.TColgp_Array1OfPnt2d if dimension == 2 else k.TColgp_Array1OfPnt)(1, len(poles))
    for i, q in enumerate(poles, 1):
        q = _vec(q)
        if dimension == 2 and abs(q[2]) > 1e-12: raise ValueError('PCurve pole outside UV plane')
        p.SetValue(i, k.gp_Pnt2d(*q[:2]) if dimension == 2 else k.gp_Pnt(*q))
    args = (_array(unique), _array(mult, True), clean['degree'], False)
    cls = k.Geom2d_BSplineCurve if dimension == 2 else k.Geom_BSplineCurve
    return cls(p, _array(clean['weights']), *args) if clean['rational'] else cls(p, *args)


def _state(face, u, v):
    k = _kernel()
    return k.BRepClass_FaceClassifier(face, k.gp_Pnt(u, v, 0.), 1e-12, False, 1e-12).State()


def _endpoint_binding(c, pc, surface, a, b, tolerance, conventions):
    """Validate ordinary endpoints without mistaking observed IDs for topology.

    The native model tolerance is a bounded input-consistency allowance, NOT
    MATH_LIMIT or an engineering/product gate. Literal excess from arithmetic
    is retained separately; no observation, interval or coordinate is clamped.
    Interior C3/PCurve correspondence remains outside this increment's claim.
    """
    k = _kernel(); vertices = [v['point'] for v in c['vertices']]
    uvs = [pc.Value(t) for t in (a, b)]
    world = [_xyz(surface.Value(p.X(), p.Y())) for p in uvs]
    def best_pair(points):
        choices = [(max(math.dist(points[i], vertices[j]) for i, j in enumerate(order)), order) for order in ((0, 1), (1, 0))]
        return min(choices)
    arithmetic = 64*max(math.ulp(float(x)) for p in world+vertices for x in p)
    if arithmetic > MATH_LIMIT:
        raise ValueError('Endpoint binding arithmetic exceeds the fixed math precision scope')
    pc_gap, pc_order = best_pair(world)
    if pc_gap > tolerance+arithmetic:
        raise ValueError('PCurve world endpoints contradict captured vertex coordinates')
    result = dict(pcEndpointBindingError=pc_gap, declaredNativeModelTolerance=tolerance,
        arithmeticComparisonBound=arithmetic, literalToleranceExceeded=pc_gap > tolerance,
        pcEndpointObservedIds=[c['vertices'][i]['nativeVertexId'] for i in pc_order],
        canonical3dEvidenceVerified=False, interiorCurveLocusVerified=False)
    if c.get('curve3d') is None:
        result['missing'] = 'No captured C3D descriptor; UV trim remains diagnostic only'
        return result
    ea, eb = _interval(c['edgeRange']); c3 = _curve(c['curve3d'], (ea, eb), 3)
    ends = [_xyz(c3.Value(t)) for t in (ea, eb)]
    arithmetic = max(arithmetic, 64*max(math.ulp(float(x)) for p in ends for x in p))
    if arithmetic > MATH_LIMIT:
        raise ValueError('C3D endpoint arithmetic exceeds the fixed math precision scope')
    gap, order = best_pair(ends)
    if gap > tolerance+arithmetic:
        raise ValueError('Canonical C3D endpoints contradict captured vertex coordinates')
    for v in c['vertices']:
        expected_end = v['atEndRaw'] == conventions.true_means_end
        if math.dist(v['point'], ends[int(expected_end)]) > tolerance+arithmetic:
            raise ValueError('Native endpoint flag contradicts calibrated actual C3D endpoints')
    same = c['edgeSenseRaw'] == conventions.true_means_same
    expected = ends if same else ends[::-1]
    direction_gap = max(math.dist(p, q) for p, q in zip(world, expected))
    if direction_gap > tolerance+arithmetic:
        raise ValueError('Coedge/C3D endpoint direction contradicts native calibration')
    result.update(c3EndpointBindingError=gap, pcC3EndpointBindingError=direction_gap,
                  arithmeticComparisonBound=arithmetic, capturedC3dEndpointBindingsChecked=True,
                  closedC3EndpointWorldGap=math.dist(*ends),
                  endpointDirectionDistinguishable=math.dist(*ends) > 2*(tolerance+arithmetic))
    return result


def _pole(r, surface, start, end, left, right):
    if r['type'] != 2 or start[1] != end[1] or abs(abs(start[1])-math.pi/2) > 1e-12:
        raise ValueError('Open UV loop; no unsupported chart completion')
    if abs(start[0]-end[0]) > 2*math.pi+1e-10:
        raise ValueError('Unsupported pole-chart winding')
    p, q = _xyz(surface.Value(*start)), _xyz(surface.Value(*end))
    def ids(c, point):
        return {v['nativeVertexId'] for v in c['vertices'] if math.dist(v['point'], point) <= MATH_LIMIT}
    common = ids(left, p) & ids(right, q)
    if len(common) != 1:
        raise ValueError('Pole transition lacks the same actual captured vertex')
    ident = common.pop(); vertex = next(v['point'] for v in left['vertices'] if v['nativeVertexId'] == ident)
    latitude = start[1]; sign = 1. if latitude > 0 else -1.; radius = r['sphereRadius']
    bound = math.dist(_vec(r['sphereCenter'])+sign*radius*_unit(r['sphereNorth']), vertex)+radius*abs(math.cos(latitude))+radius*abs(math.sin(latitude)-sign)
    if bound > MATH_LIMIT: raise ValueError('Whole pole chart does not collapse to captured world point')
    return dict(startUv=start, endUv=end, nativeVertexId=ident, analyticWorldDistanceBound=bound,
                physical3dEdgeAdded=False, capturedCoedgeClaimed=False)


def _support_box(r, uv):
    if r['type'] == 6:
        p = np.array(r['polesUFast']); return p.min(0), p.max(0)
    if r['type'] == 1:
        p = np.array([_vec(r['planeBase'])+u*_vec(r['planeU'])+v*_vec(r['planeV']) for u in uv[:2] for v in uv[2:]])
        return p.min(0), p.max(0)
    if r['type'] == 2:
        c, radius = _vec(r['sphereCenter']), r['sphereRadius']; return c-radius, c+radius
    if r['type'] == 3:
        c, axis, radius = _vec(r['cylinderCenter']), _vec(r['cylinderAxis']), r['cylinderRadius']
        p = np.array([c+v*axis for v in uv[2:]]); return p.min(0)-radius, p.max(0)+radius
    radius = np.linalg.norm(r['coneMajor']); v = [t-r['coneVParam'] for t in uv[2:]]
    width = max(abs(radius*(1+r['coneVFactor']*t)) for t in v)
    p = np.array([_vec(r['coneCenter'])+_vec(r['coneAxis'])*r['coneAxisVFactor']*t for t in v])
    return p.min(0)-width, p.max(0)+width


def _boundary_parameters(point, adaptor, a, b, edge_id):
    k = _kernel(); params, warnings = [a, b], []
    extrema = k.Extrema_ExtPC(k.gp_Pnt(*point), adaptor, a, b, 1e-13)
    if extrema.IsDone():
        params += [extrema.Point(j).Parameter() for j in range(1, extrema.NbExt()+1)]
    else:
        warnings.append('Boundary extrema did not finish on native edge '+str(edge_id))
    return params, warnings


@dataclass
class NativeTrimModel:
    capture: NativeCapture
    faces: dict
    report: dict

    def query(self, point, preferred_face=None):
        """Return verified finite witnesses, with every failed query/warning.

        No certified global-nearest or continuum Hausdorff claim follows from
        stationary projections. Incomplete face coverage always stays explicit.
        """
        k = _kernel(); point = _vec(point); best = None; failures = []; checked = 0; all_warnings = []
        order = sorted((float(np.linalg.norm(np.maximum(np.maximum(f.box[0]-point, point-f.box[1]), 0.))), i) for i, f in self.faces.items())
        if preferred_face in self.faces: order = [(-1., preferred_face)]+[(d, i) for d, i in order if i != preferred_face]
        for lower, index in order:
            if best is not None and lower > best['distance']+1e-11: continue
            f = self.faces[index]; candidates = []; warnings = []
            checked += 1
            try:
                projection = k.GeomAPI_ProjectPointOnSurf(k.gp_Pnt(*point), f.surface, *f.bounds, 1e-12)
                if projection.IsDone():
                    for j in range(1, projection.NbPoints()+1):
                        u, v = projection.Parameters(j); state = _state(f.uvface, u, v)
                        if state in (k.TopAbs_IN, k.TopAbs_ON):
                            q = _xyz(f.surface.Value(u, v)); candidates.append(dict(point=q, distance=math.dist(point, q), uv=[u, v], trimState=str(state), kind='trim-filtered-support-projection'))
                else: warnings.append('Support projection did not finish')
                for c in f.coedges:
                    adaptor = k.Adaptor3d_CurveOnSurface(k.Geom2dAdaptor_Curve(c.pc, c.a, c.b), k.GeomAdaptor_Surface(f.surface))
                    params, boundary_warnings = _boundary_parameters(point, adaptor, c.a, c.b, c.raw['nativeEdgeId'])
                    warnings.extend(boundary_warnings)
                    for t in params:
                        if c.a <= t <= c.b:
                            q = _xyz(adaptor.Value(t)); candidates.append(dict(point=q, distance=math.dist(point, q), parameter=t, nativeEdgeId=c.raw['nativeEdgeId'], kind='actual-CurveOnSurface-boundary'))
                if not candidates: raise ValueError('No verified trimmed witness')
                candidate = min(candidates, key=lambda x: x['distance'])
                if best is None or candidate['distance'] < best['distance']:
                    best = dict(candidate, nativeIndex=index, queryWarnings=warnings)
            except Exception as error:
                failures.append(dict(nativeIndex=index, error=str(error)))
            finally:
                all_warnings.extend(dict(nativeIndex=index, message=message) for message in warnings)
        return dict(witness=best, queryFailures=failures, queriedNativeFaces=checked,
                    queryWarnings=all_warnings,
                    inputEvidenceConsistent=self.report['inputEvidenceConsistent'],
                    unsupportedFaceCount=self.report['nativeFaces']-len(self.faces),
                    distanceStatistic='minimum verified finite trimmed-face witness; not certified global nearest')


def reconstruct_trim(capture):
    """Build exact native supports and real UV trim domains, no solid claim."""
    if not isinstance(capture, NativeCapture): raise ValueError('Use a labelled, calibrated capture')
    doc = json.loads(capture.raw); count, coedges = _preflight(doc); k = _kernel()
    plane = k.gp_Pln(k.gp_Ax3(k.gp_Pnt(0., 0., 0.), k.gp_Dir(0., 0., 1.)))
    built, records, unsupported, roundoff_samples = {}, [], [], []
    evidence_failures, evidence_missing, identity_aliases = [], [], []
    captured_edges = [c for f in doc['faces'] for loop in f['loops'] for c in loop['coedges']]
    edge_uses = Counter(c['nativeEdgeId'] for c in captured_edges)
    paired_edge_evidence = all(n == 2 for n in edge_uses.values()) and all(c.get('curve3d') is not None for c in captured_edges)
    for r in doc['faces']:
        record = dict(nativeIndex=r['index']); support_errors = []; curve_errors = []; bindings = []
        try:
            surface = _support(r); u0, u1, v0, v1 = r['uv']
            support_errors.append(math.dist(_xyz(surface.Value((u0+u1)/2, (v0+v1)/2)), _vec(r['untrimmedMidpoint'])))
            for s in r['nativeSamples']:
                u, v = _vec(s['uv'], 2)
                if not u0 <= u <= u1 or not v0 <= v <= v1: raise ValueError('Native sample outside bounds')
                support_errors.append(math.dist(_xyz(surface.Value(u, v)), _vec(s['point'])))
            if max(support_errors) > MATH_LIMIT: raise _EvidenceContradiction('Native support math sample mismatch')
            wires, parsed, transitions = [], [], []; box = k.Bnd_Box2d()
            for loop in r['loops']:
                local = []
                for ordinal, c in enumerate(loop['coedges']):
                    a, b = _interval(c['coedgeRange']); pc = _curve(c['curve2d'], (a, b), 2)
                    for s in c['onSurfaceSamples']:
                        if s.get('available') is not True: raise ValueError('Missing native sample')
                        t = _number(s['parameter'])
                        arithmetic_bound = 8*max(math.ulp(a), math.ulp(b), math.ulp(b-a))
                        if not a <= t <= b:
                            if min(abs(t-a), abs(t-b)) > arithmetic_bound:
                                raise ValueError('Native curve sample outside range')
                            roundoff_samples.append(dict(nativeIndex=r['index'], loop=loop['index'], coedgeOrdinal=ordinal,
                                parameter=t, finiteRange=[a, b], arithmeticBound=arithmetic_bound,
                                parameterClamped=False, note='Captured observation only; no new outside-trim sample generated'))
                        uv = pc.Value(t); curve_errors += [math.dist([uv.X(), uv.Y(), 0.], _vec(s['uv'])), math.dist(_xyz(surface.Value(uv.X(), uv.Y())), _vec(s['point']))]
                    if max(curve_errors) > MATH_LIMIT: raise _EvidenceContradiction('Native PCurve math mismatch')
                    if not all(any(abs(s['parameter']-t) <= arithmetic_bound and
                                   math.dist(_xyz(surface.Value(pc.Value(t).X(), pc.Value(t).Y())), s['point']) <= MATH_LIMIT
                                   for s in c['onSurfaceSamples']) for t in (a, b)):
                        raise ValueError('Native endpoints not sampled')
                    try:
                        binding = _endpoint_binding(c, pc, surface, a, b,
                            _number(doc.get('modelToleranceAfter', MATH_LIMIT)), capture.conventions)
                    except Exception as error:
                        evidence_failures.append(dict(nativeIndex=r['index'], loop=loop['index'], coedgeOrdinal=ordinal,
                            nativeEdgeId=c['nativeEdgeId'], scope='captured-native-ordinary-endpoint/C3D-binding', error=str(error)))
                        raise
                    binding.update(loop=loop['index'], coedgeOrdinal=ordinal, nativeEdgeId=c['nativeEdgeId'])
                    bindings.append(binding)
                    if 'missing' in binding:
                        evidence_missing.append(dict(nativeIndex=r['index'], **binding))
                    lo, hi = pc.Value(a), pc.Value(b); start, end = [lo.X(), lo.Y()], [hi.X(), hi.Y()]
                    if not c['loopSense']: start, end = end, start
                    local.append(SimpleNamespace(raw=c, pc=pc, a=a, b=b, start=start, end=end, loop=loop['index'], ordinal=ordinal, binding=binding))
                    k.BndLib_Add2dCurve.AddOptimal_s(pc, a, b, 0., box)
                wire = k.BRepBuilderAPI_MakeWire()
                for i, c in enumerate(local):
                    previous = local[i-1]
                    def oriented_ids(coedge):
                        ids = coedge.binding['pcEndpointObservedIds']
                        return ids if coedge.raw['loopSense'] else ids[::-1]
                    left, right = oriented_ids(previous)[1], oriented_ids(c)[0]
                    if left != right:
                        p, q = _xyz(surface.Value(*previous.end)), _xyz(surface.Value(*c.start))
                        gap = math.dist(p, q)
                        allowed = _number(doc.get('modelToleranceAfter', MATH_LIMIT))
                        arithmetic = max(previous.binding['arithmeticComparisonBound'], c.binding['arithmeticComparisonBound'])
                        alias = dict(nativeIndex=r['index'], loop=loop['index'], beforeOrdinal=i,
                            leftObservedId=left, rightObservedId=right, worldEndpointGap=gap,
                            sharedPairedEdgeEvidence=paired_edge_evidence, topologyCanonicalized=False)
                        if gap > allowed+arithmetic:
                            evidence_failures.append(dict(alias, scope='native-loop-endpoint-world-binding', error='Adjacent world endpoints disagree'))
                        elif paired_edge_evidence:
                            identity_aliases.append(alias)
                        else:
                            # An open capture cannot resolve a broken supplied
                            # identity cycle from coordinate proximity alone.
                            # This is insufficient identity evidence, NOT proof
                            # that distinct SDK handles mean invalid geometry.
                            evidence_failures.append(dict(alias, scope='unresolved-open-capture-endpoint-identity',
                                error='Observed ID cycle differs and no complete paired-edge evidence establishes an alias'))
                    if math.dist(previous.end, c.start) > 1e-7:
                        proof = _pole(r, surface, previous.end, c.start, previous.raw, c.raw)
                        proof.update(loop=loop['index'], beforeOrdinal=i); transitions.append(proof)
                        desc = dict(type=1, start=[*proof['startUv'], 0.], end=[*proof['endUv'], 0.], supported=True)
                        connector = _curve(desc, (0., 1.), 2)
                        wire.Add(k.BRepBuilderAPI_MakeEdge(k.GeomAPI.To3d_s(connector, plane), 0., 1.).Edge())
                    e = k.BRepBuilderAPI_MakeEdge(k.GeomAPI.To3d_s(c.pc, plane), c.a, c.b).Edge()
                    wire.Add(e if c.raw['loopSense'] else k.TopoDS.Edge_s(e.Reversed()))
                    if not wire.IsDone(): raise ValueError('Native UV wire construction failed')
                if not wire.Wire().Closed(): raise ValueError('Native UV loop open; no unsupported closure')
                wires.append(k.TopoDS.Wire_s(wire.Wire().Reversed()) if not r['normalSense'] else wire.Wire())
                parsed.extend(local)
            maker = k.BRepBuilderAPI_MakeFace(plane, wires[0], True)
            for wire in wires[1:]: maker.Add(wire)
            uvface = maker.Face()
            if not k.BRepCheck_Analyzer(uvface).IsValid(): raise ValueError('Actual UV trim domain invalid')
            x, y, X, Y = box.Get(); bounds = [x, X, y, Y]
            built[r['index']] = SimpleNamespace(raw=r, surface=surface, uvface=uvface, bounds=bounds,
                box=_support_box(r, bounds), coedges=parsed, transitions=transitions)
            record.update(nativeSupportSampleError=max(support_errors), nativePcSampleError=max(curve_errors),
                          naturalPoleChartTransitions=transitions, endpointBindings=bindings, reconstructed=True)
        except Exception as error:
            if isinstance(error, _EvidenceContradiction):
                evidence_failures.append(dict(nativeIndex=r['index'], scope='captured-native-record-sample-math', error=str(error)))
            unsupported.append(dict(nativeIndex=r['index'], error=str(error))); record.update(reconstructed=False, error=str(error))
        records.append(record)
    if not capture.unchanged(): raise ValueError('Capture file changed during reconstruction')
    report = dict(scope='native-support-and-real-PCurve-trim-domains-only',
        closedBrepImplemented=False, nativeHmVerified=False,
        sourceLabel=capture.source_label, captureSHA256=capture.sha256,
        calibrationSHA256=capture.conventions.calibration_sha256, nativeFaces=count, capturedCoedges=coedges,
        reconstructedTrimDomains=len(built), completeNativeFaceCoverage=len(built) == count,
        unsupported=unsupported, faces=records, uvRectangleUsedAsTrim=False, sourceSurfaceSubstitution=False,
        inputSampleParameterRoundoff=roundoff_samples,
        inputEvidenceConsistent=False if evidence_failures else None if unsupported else True,
        inputEvidenceFailures=evidence_failures,
        inputEvidenceMissing=evidence_missing, canonical3dEvidenceVerified=False,
        nativeEndpointIdentityAliases=identity_aliases, sharedPairedEdgeEvidence=paired_edge_evidence,
        canonical3dEvidenceScope='Available captured endpoint/descriptor consistency only; not interior locus, closed-edge direction, host topology or whole CAD',
        nativeTopologyCanonicalized=False,
        fullModelAcceptance=False, productAcceptance=False, finiteMathSampleLimit=MATH_LIMIT)
    return NativeTrimModel(capture, built, report)
