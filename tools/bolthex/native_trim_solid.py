"""Source-labelled native trim -> isolated closed OCCT analysis BRep.

No source STEP is used in construction. No ShapeFix, BuildCurves3d, native-HM
mutation, solver or mesh-quality certificate is provided. Construction tolerance
is explicit and distinct from the caller's CAD accuracy policy. Unsupported
geometry, topology, ranges or incomplete owner checks fail closed.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from functools import lru_cache
import hashlib
import io
import json
import math
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from . import native_trim_brep as trim
from .native_curve_range import transfer_curve_range, UnsupportedCurveRangeTransfer
from .geometry_accuracy_policy import validated_policy

MAX_OUTPUT_BYTES = 64*1024**2
MAX_QUERIES = 65536


@lru_cache(maxsize=1)
def _kernel():
    from OCP.BRep import BRep_Builder, BRep_Tool
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Sewing, BRepBuilderAPI_MakeSolid
    from OCP.BRepTools import BRepTools
    from OCP.BRepLib import BRepLib
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    from OCP.Geom import Geom_TrimmedCurve, Geom_Surface, Geom_Curve
    from OCP.Geom2d import Geom2d_TrimmedCurve, Geom2d_Curve
    from OCP.Geom2dConvert import Geom2dConvert
    from OCP.Geom2dAPI import Geom2dAPI_ProjectPointOnCurve
    from OCP.GeomTools import GeomTools
    from OCP.GeomLib import GeomLib_CheckCurveOnSurface
    from OCP.TopoDS import TopoDS_Face, TopoDS_Wire, TopoDS_Edge, TopoDS_Vertex, TopoDS_Shape, TopoDS_Iterator
    from OCP.TopAbs import TopAbs_FORWARD, TopAbs_REVERSED, TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX, TopAbs_WIRE, TopAbs_SHELL, TopAbs_SOLID
    from OCP.TopExp import TopExp, TopExp_Explorer
    from OCP.TopTools import TopTools_IndexedMapOfShape, TopTools_FormatVersion_VERSION_3
    imports = dict(locals())
    return SimpleNamespace(**(vars(trim._kernel()) | imports))


class SolidReconstructionError(ValueError):
    def __init__(self, message, report):
        super().__init__(message)
        self.report = report


@dataclass
class NativeSolid:
    shape: object
    native: trim.NativeTrimModel
    report: dict
    _binding: _SolidBinding | None = None


@dataclass(frozen=True)
class _SolidBinding:
    capture_sha256: str
    geometry_sha256: str
    state_sha256: str
    topology_sha256: str
    tolerances_sha256: str
    distance_budget: float
    volume: float


def _metadata_target(measured, stored, construction, quantum):
    if measured > construction:raise ValueError('Measured surface/C3 error exceeds declared construction budget')
    if measured <= stored:return stored
    if quantum is None:raise ValueError('Measured error not covered by metadata; explicit metadata quantum required')
    chosen=math.ceil(measured/quantum)*quantum
    if chosen < measured or chosen > construction:raise ValueError('Measured metadata ceiling exceeds construction budget or does not cover error')
    return chosen


def _mapped(shape, kind):
    k = _kernel(); m = k.TopTools_IndexedMapOfShape(); k.TopExp.MapShapes_s(shape, kind, m)
    return [m.FindKey(i) for i in range(1, m.Extent()+1)]


def _fingerprint(geometry):
    if geometry is None:return None
    return hashlib.sha256(_geometry_bytes(geometry)).hexdigest()


def _geometry_bytes(geometry):
    # GeomTools' default stream precision loses sub-micro changes. BRepTools
    # writes full double precision; the temporary wrapper never edits geometry.
    k=_kernel();builder=k.BRep_Builder()
    if isinstance(geometry,k.Geom_Surface):
        shape=k.TopoDS_Face();builder.MakeFace(shape,geometry,0.)
    elif isinstance(geometry,k.Geom_Curve):
        shape=k.TopoDS_Edge();builder.MakeEdge(shape,geometry,0.)
    elif isinstance(geometry,k.Geom2d_Curve):
        face=k.TopoDS_Face();builder.MakeFace(face,k.Geom_Plane(k.gp_Ax3(k.gp_Pnt(0.,0.,0.),k.gp_Dir(0.,0.,1.))),0.)
        shape=k.TopoDS_Edge();builder.MakeEdge(shape);builder.UpdateEdge(shape,geometry,face,0.)
    else:raise ValueError('Unsupported geometry fingerprint type')
    return _serialized_shape(shape)


def _shape_geometry(shape):
    """Includes both seam PCurves, finite ranges, supports and vertex positions."""
    k = _kernel(); values = []
    for f in _mapped(shape, k.TopAbs_FACE):
        f = k.TopoDS.Face_s(f); values.append(_fingerprint(k.BRep_Tool.Surface_s(f)))
        for edge in _mapped(f, k.TopAbs_EDGE):
            e = k.TopoDS.Edge_s(edge)
            values += [_fingerprint(k.BRep_Tool.Curve_s(e, 0., 0.)), list(k.BRep_Tool.Range_s(e)),
                       _fingerprint(k.BRep_Tool.CurveOnSurface_s(e, f, 0., 0.)),
                       _fingerprint(k.BRep_Tool.CurveOnSurface_s(k.TopoDS.Edge_s(e.Reversed()), f, 0., 0.)),
                       list(k.BRep_Tool.Range_s(e, f))]
    for v in _mapped(shape, k.TopAbs_VERTEX):values.append(trim._xyz(k.BRep_Tool.Pnt_s(k.TopoDS.Vertex_s(v))))
    return hashlib.sha256(json.dumps(values, separators=(',', ':')).encode()).hexdigest()


def _serialized_shape(shape):
    stream=io.BytesIO();k=_kernel()
    k.BRepTools.Write_s(shape,stream,False,False,k.TopTools_FormatVersion_VERSION_3)
    data=stream.getvalue()
    if len(data)>MAX_OUTPUT_BYTES:raise ValueError('BRep output exceeds64MiB')
    return data


def _solid_state(shape, budget):
    """Inspect actual root ownership and metadata, not deduplicated geometry alone."""
    k=_kernel()
    if shape.IsNull() or shape.ShapeType()!=k.TopAbs_SOLID:
        raise ValueError('Candidate root must be one solid, without auxiliary shapes')
    def children(parent):
        iterator=k.TopoDS_Iterator(parent);items=[]
        while iterator.More():items.append(iterator.Value());iterator.Next()
        return items
    shells=children(shape)
    if len(shells)!=1 or shells[0].ShapeType()!=k.TopAbs_SHELL or not k.BRep_Tool.IsClosed_s(shells[0]):
        raise ValueError('Solid must own exactly one closed shell')
    faces=_mapped(shape,k.TopAbs_FACE);owned=children(shells[0])
    if (not faces or len(owned)!=len(faces) or any(f.ShapeType()!=k.TopAbs_FACE for f in owned)
            or any(sum(f.IsSame(g) for g in owned)!=1 for f in faces)):
        raise ValueError('Every physical face must have exactly one shell owner')
    edges=_mapped(shape,k.TopAbs_EDGE);vertices=_mapped(shape,k.TopAbs_VERTEX)
    edge_map=k.TopTools_IndexedMapOfShape();k.TopExp.MapShapes_s(shape,k.TopAbs_EDGE,edge_map)
    vertex_map=k.TopTools_IndexedMapOfShape();k.TopExp.MapShapes_s(shape,k.TopAbs_VERTEX,vertex_map)
    incidence=[str(shape.Orientation()),str(shells[0].Orientation())]
    for face in owned:
        wires=children(face);wire_rows=[]
        if not wires or any(w.ShapeType()!=k.TopAbs_WIRE for w in wires):raise ValueError('Unexpected face child ownership')
        for wire in wires:
            uses=[]
            for edge in children(wire):
                if edge.ShapeType()!=k.TopAbs_EDGE:raise ValueError('Unexpected wire child ownership')
                endpoints=children(edge)
                if any(v.ShapeType()!=k.TopAbs_VERTEX for v in endpoints):raise ValueError('Unexpected edge child ownership')
                uses.append([edge_map.FindIndex(edge)-1,str(edge.Orientation()),
                    k.BRep_Tool.Degenerated_s(k.TopoDS.Edge_s(edge)),
                    [[vertex_map.FindIndex(v)-1,str(v.Orientation())] for v in endpoints]])
            wire_rows.append([str(wire.Orientation()),uses])
        incidence.append([str(face.Orientation()),wire_rows])
    physical={i for i,e in enumerate(edges) if not k.BRep_Tool.Degenerated_s(k.TopoDS.Edge_s(e))}
    owners=defaultdict(list)
    for face in faces:
        explorer=k.TopExp_Explorer(face,k.TopAbs_EDGE)
        while explorer.More():
            edge=k.TopoDS.Edge_s(explorer.Current());explorer.Next()
            index=edge_map.FindIndex(edge)-1
            if index in physical:owners[index].append(edge.Orientation())
    expected=Counter((k.TopAbs_FORWARD,k.TopAbs_REVERSED))
    if set(owners)!=physical or any(Counter(uses)!=expected for uses in owners.values()):
        raise ValueError('Physical edges must have two opposite coedge owners')
    tolerances=[k.BRep_Tool.Tolerance_s(k.TopoDS.Face_s(f)) for f in faces]
    tolerances += [k.BRep_Tool.Tolerance_s(k.TopoDS.Edge_s(e)) for e in edges]
    tolerances += [k.BRep_Tool.Tolerance_s(k.TopoDS.Vertex_s(v)) for v in vertices]
    if not all(math.isfinite(t) and 0<=t<=budget for t in tolerances):
        raise ValueError('Current tolerance metadata exceeds the bound CAD policy budget')
    if not k.BRepCheck_Analyzer(shape,True,False,True).IsValid():raise ValueError('Candidate is not a valid BRep')
    data=_serialized_shape(shape)
    return dict(geometrySHA256=_shape_geometry(shape),stateSHA256=hashlib.sha256(data).hexdigest(),
        topologySHA256=hashlib.sha256(json.dumps(incidence,separators=(',',':')).encode()).hexdigest(),
        tolerancesSHA256=hashlib.sha256(json.dumps(tolerances,separators=(',',':')).encode()).hexdigest(),
        maximumOutputTolerance=max(tolerances),topology=dict(rootType='solid',solids=1,shells=1,
            faces=len(faces),edges=len(edges),vertices=len(vertices),physicalEdges=len(physical),
            physicalCoedgeOccurrences=sum(map(len,owners.values())),degenerateEdges=len(edges)-len(physical))),data


def _validate_bound_result(result, *, geometry_policy=None):
    if (not isinstance(result,NativeSolid) or not isinstance(result._binding,_SolidBinding)
            or result.report.get('validSolid') is not True):raise ValueError('No bound validated solid')
    binding=result._binding
    if result.native.capture.sha256!=binding.capture_sha256 or not result.native.capture.unchanged():
        raise ValueError('Native source changed after reconstruction')
    budget=binding.distance_budget
    if geometry_policy is not None:
        budget=min(budget,validated_policy(geometry_policy).distance_budget_mm(critical=True))
    state,data=_solid_state(result.shape,budget)
    if state['geometrySHA256']!=binding.geometry_sha256:
        raise ValueError('Caller-owned result geometry changed after reconstruction')
    if state['stateSHA256']!=binding.state_sha256:
        raise ValueError('Caller-owned result topology or metadata changed after reconstruction')
    return state,data


def _roundoff_bound(*values):
    # Floating-point codec allowance only, capped by the existing native math gate.
    return min(trim.MATH_LIMIT,64*math.ulp(max(1.,*(abs(float(v)) for v in values))))


def _reopen_tolerances(original,reopened):
    """Only the observed 15-significant-digit BRep metadata encoding may differ."""
    k=_kernel();changes=[];count=0
    for kind,cast in ((k.TopAbs_FACE,k.TopoDS.Face_s),(k.TopAbs_EDGE,k.TopoDS.Edge_s),
                      (k.TopAbs_VERTEX,k.TopoDS.Vertex_s)):
        old,new=_mapped(original,kind),_mapped(reopened,kind)
        if len(old)!=len(new):raise ValueError('Readback tolerance entity inventory changed')
        for index,(a,b) in enumerate(zip(old,new)):
            before,after=k.BRep_Tool.Tolerance_s(cast(a)),k.BRep_Tool.Tolerance_s(cast(b))
            encoded=float(format(before,'.15g'))
            if after!=before and after!=encoded:
                raise ValueError('Readback tolerance changed beyond the exact metadata encoding')
            count+=1
            if after!=before:changes.append(dict(kind=str(kind),index=index,before=before,after=after,
                encodedExpected=encoded,difference=abs(after-before)))
    return dict(entitiesChecked=count,decimalSignificantDigits=15,changes=changes,
        maximumDifference=max((r['difference'] for r in changes),default=0.),
        constructionAndEngineeringBudgetsUnchanged=True)


def _readback_interval(before,after):
    if (len(before)!=2 or len(after)!=2 or not all(math.isfinite(v) for v in (*before,*after))
            or before[0]>=before[1] or after[0]>=after[1]):
        raise ValueError('Invalid finite readback parameter interval')
    if any(new!=old and new!=float(format(old,'.15g')) for old,new in zip(before,after)):
        raise ValueError('Readback parameter range changed beyond the exact metadata encoding')
    return tuple(after)


def _readback_geometry_rule(before,after,changes):
    """Allow only observed OCCT circle normalization, never general geometry edits."""
    if _fingerprint(before)==_fingerprint(after):return
    if before is None or after is None:raise ValueError('Readback removed a geometric representation')
    name=before.DynamicType().Name()
    if name!=after.DynamicType().Name():raise ValueError('Readback changed a geometry type')
    if name in ('Geom_TrimmedCurve','Geom2d_TrimmedCurve'):
        a,b=before.FirstParameter(),before.LastParameter();c,d=after.FirstParameter(),after.LastParameter()
        old,new=before.BasisCurve(),after.BasisCurve()
        if old.DynamicType().Name() not in ('Geom_Circle','Geom2d_Circle') or not old.IsPeriodic() or not new.IsPeriodic():
            raise ValueError('Unrecognized readback trim normalization')
        period=old.Period();shift=round((c-a)/period)
        error=max(abs(new.Period()-period),abs(c-a-shift*period),abs(d-b-shift*period))
        if error>_roundoff_bound(a,b,c,d,period):raise ValueError('Readback changed the trimmed circle interval')
        _readback_geometry_rule(old,new,changes)
        changes.append(dict(kind=name,rule='circle trim shifted by an integer period plus roundoff',
                            oldRange=[a,b],newRange=[c,d],period=period,periodShift=shift,residual=error))
        return
    if name not in ('Geom_Circle','Geom2d_Circle'):
        raise ValueError('Unrecognized readback geometry change: '+name)
    def tokens(curve):return _geometry_bytes(curve).decode('ascii').split()
    old,new=tokens(before),tokens(after)
    if len(old)!=len(new):raise ValueError('Readback circle representation changed')
    count=0;maximum=0.
    for a,b in zip(old,new):
        if a==b:continue
        try:x,y=float(a),float(b)
        except ValueError as error:raise ValueError('Readback circle syntax changed') from error
        if not math.isfinite(x) or not math.isfinite(y) or abs(x-y)>_roundoff_bound(x,y):
            raise ValueError('Readback circle change exceeds machine roundoff')
        count+=1;maximum=max(maximum,abs(x-y))
    changes.append(dict(kind=name,rule='machine-precision circle normalization',changedNumericTokens=count,maximumNumericDifference=maximum))


def _reopen_math(original,reopened):
    """Direct original-to-readback math; no closest-distance/source-CAD sweep."""
    k=_kernel();changes=[];errors=[];counts=Counter()
    def check(a,b,kind):
        x,y=trim._xyz(a),trim._xyz(b);distance=math.dist(x,y)
        if not math.isfinite(distance) or distance>_roundoff_bound(*x,*y):
            raise ValueError('Original-to-readback world math exceeds machine roundoff')
        errors.append(distance);counts[kind]+=1
    def occurrences(face):
        explorer=k.TopExp_Explorer(face,k.TopAbs_EDGE);items=[]
        while explorer.More():items.append(k.TopoDS.Edge_s(explorer.Current()));explorer.Next()
        return items
    for old,new in zip(_mapped(original,k.TopAbs_FACE),_mapped(reopened,k.TopAbs_FACE)):
        old,new=k.TopoDS.Face_s(old),k.TopoDS.Face_s(new)
        a,b=k.BRep_Tool.Surface_s(old),k.BRep_Tool.Surface_s(new)
        _readback_geometry_rule(a,b,changes)
        u0,u1,v0,v1=k.BRepTools.UVBounds_s(old)
        if not all(math.isfinite(t) for t in (u0,u1,v0,v1)):raise ValueError('Unbounded readback face math')
        for u in np.linspace(u0,u1,3):
            for v in np.linspace(v0,v1,3):check(a.Value(float(u),float(v)),b.Value(float(u),float(v)),'surfaceSamples')
        for e,f in zip(occurrences(old),occurrences(new)):
            p,q=k.BRep_Tool.CurveOnSurface_s(e,old,0.,0.),k.BRep_Tool.CurveOnSurface_s(f,new,0.,0.)
            _readback_geometry_rule(p,q,changes)
            interval=k.BRep_Tool.Range_s(e,old)
            new_interval=_readback_interval(interval,k.BRep_Tool.Range_s(f,new))
            if interval!=new_interval:changes.append(dict(kind='PCurve-edge-range',rule='exact15-digit metadata encoding',oldRange=interval,newRange=new_interval))
            for t,s in zip(np.linspace(*interval,17),np.linspace(*new_interval,17)):
                uv,xy=p.Value(float(t)),q.Value(float(s))
                check(a.Value(uv.X(),uv.Y()),b.Value(xy.X(),xy.Y()),'pcurveWorldSamples')
    for old,new in zip(_mapped(original,k.TopAbs_EDGE),_mapped(reopened,k.TopAbs_EDGE)):
        old,new=k.TopoDS.Edge_s(old),k.TopoDS.Edge_s(new)
        a,b=k.BRep_Tool.Curve_s(old,0.,0.),k.BRep_Tool.Curve_s(new,0.,0.)
        _readback_geometry_rule(a,b,changes)
        if a is None:continue
        interval=k.BRep_Tool.Range_s(old)
        new_interval=_readback_interval(interval,k.BRep_Tool.Range_s(new))
        if interval!=new_interval:changes.append(dict(kind='C3-edge-range',rule='exact15-digit metadata encoding',oldRange=interval,newRange=new_interval))
        for t,s in zip(np.linspace(*interval,17),np.linspace(*new_interval,17)):
            check(a.Value(float(t)),b.Value(float(s)),'curve3dSamples')
    for a,b in zip(_mapped(original,k.TopAbs_VERTEX),_mapped(reopened,k.TopAbs_VERTEX)):
        check(k.BRep_Tool.Pnt_s(k.TopoDS.Vertex_s(a)),k.BRep_Tool.Pnt_s(k.TopoDS.Vertex_s(b)),'vertexSamples')
    return dict(maximumWorldDifference=max(errors,default=0.),sampleCounts=dict(counts),
        recognizedNormalization=changes,roundoffULPMultiplier=64,hardNativeMathLimit=trim.MATH_LIMIT,
        finiteDirectMathChecksNotHausdorffProof=True)


def _nurbs2_descriptor(curve):
    knots = [curve.Knot(i) for i in range(1, curve.NbKnots()+1) for _ in range(curve.Multiplicity(i))]
    rational = curve.IsRational()
    return dict(type=4, degree=curve.Degree(), rational=rational, knots=knots,
        poles=[[curve.Pole(i).X(), curve.Pole(i).Y(), 0.] for i in range(1, curve.NbPoles()+1)],
        weights=[curve.Weight(i) for i in range(1, curve.NbPoles()+1)] if rational else [], supported=True)


def normalize_pcurve(descriptor, old_range, new_range, surface):
    """Fresh SameRange geometry using the committed descriptor transfer.

    Unequal-angle circles are never falsely labelled affine. The optional exact
    OCCT conic conversion changes parameterization and is checked as a locus.
    """
    k = _kernel(); a, b = trim._interval(old_range); ea, eb = trim._interval(new_range)
    old = trim._curve(descriptor, (a, b), 2); before = _fingerprint(old)
    conic = False
    try:
        record, trace = transfer_curve_range(descriptor, [a, b], [ea, eb])
    except UnsupportedCurveRangeTransfer as error:
        if descriptor.get('type') != 2:raise
        bs = k.Geom2dConvert.CurveToBSplineCurve_s(k.Geom2d_TrimmedCurve(old, a, b, True, False))
        record, trace = transfer_curve_range(_nurbs2_descriptor(bs), [bs.FirstParameter(), bs.LastParameter()], [ea, eb])
        trace = dict(trace, method='exact-OCCT-conic-image-then-affine-knots', originalTransferRejection=str(error),
                     nativeObservationsCopied=False, sameParameterIdentityToOriginalClaimed=False)
        conic = True
    new = trim._curve(record, (ea, eb), 2); errors = []
    def point(c, t):
        uv = c.Value(float(t)); return trim._xyz(surface.Value(uv.X(), uv.Y()))
    if not conic:
        for t in np.linspace(a, b, 65):
            s = ea+(float(t)-a)*(eb-ea)/(b-a)
            errors.append(math.dist(point(old, t), point(new, s)))
    else:
        for src, lo, hi, dst, low, high in ((old, a, b, new, ea, eb), (new, ea, eb, old, a, b)):
            for t in np.linspace(lo, hi, 65):
                p = src.Value(float(t)); projection = k.Geom2dAPI_ProjectPointOnCurve(p, dst, low, high)
                parameters = [low, high]+[projection.Parameter(i) for i in range(1, projection.NbPoints()+1)]
                best = min(parameters, key=lambda s:p.Distance(dst.Value(s)))
                errors.append(math.dist(point(src, t), point(dst, best)))
    if not all(math.isfinite(e) for e in errors) or max(errors) > trim.MATH_LIMIT:
        raise ValueError('SameRange reconstruction failed fixed native math limit')
    if _fingerprint(old) != before:raise ValueError('Original mathematical PCurve mutated')
    trace.update(maximumWorldValidationError=max(errors), worldValidationSamples=len(errors),
                 finiteWitnessesNotHausdorffProof=True)
    return new, trace


def _topology(model, tolerance):
    """Equivalence only through actual shared edge endpoints and loop adjacency."""
    k = _kernel(); curves = {}; tokens = {}; parent = {}; observations = {}; directions = {}; owners = defaultdict(list)
    def find(a):
        while parent[a] != a:parent[a] = parent[parent[a]]; a = parent[a]
        return a
    def union(a, b):
        a, b = find(a), find(b)
        if a != b:parent[max(a,b)] = min(a,b)
    periodic = []; relations = []; closed_directions = []
    for index, f in sorted(model.faces.items()):
        loops = defaultdict(list)
        for c in f.coedges:
            r = c.raw; eid = r['nativeEdgeId']; ea, eb = trim._interval(r['edgeRange'])
            if eid not in curves:curves[eid] = trim._curve(r['curve3d'], (ea, eb), 3)
            curve = curves[eid]; endpoints = [trim._xyz(curve.Value(t)) for t in (ea, eb)]
            pc_ends = [trim._xyz(f.surface.Value(c.pc.Value(t).X(), c.pc.Value(t).Y())) for t in (c.a, c.b)]
            same = r['edgeSenseRaw'] == model.capture.conventions.true_means_same
            closed = math.dist(*endpoints) <= trim.MATH_LIMIT
            if closed:
                if r['curve3d']['type'] != 2 or abs((eb-ea)-2*math.pi) > 1e-12 or math.dist(*pc_ends) > trim.MATH_LIMIT:
                    raise ValueError('Unsupported closed edge without complete analytic circle proof')
                q2 = k.gp_Pnt2d(); v2 = k.gp_Vec2d(); c.pc.D1(c.a, q2, v2)
                q = k.gp_Pnt(); su = k.gp_Vec(); sv = k.gp_Vec(); f.surface.D1(q2.X(), q2.Y(), q, su, sv)
                p = k.gp_Pnt(); tangent = k.gp_Vec(); curve.D1(ea, p, tangent)
                a = np.array(trim._xyz(su))*v2.X()+np.array(trim._xyz(sv))*v2.Y(); b = np.array(trim._xyz(tangent))
                norm = np.linalg.norm(a)*np.linalg.norm(b)
                if norm == 0 or abs(float(a@b))/norm < .5:raise ValueError('Closed-edge direction is not determined')
                if (float(a@b) > 0) != same:raise ValueError('Closed-circle tangent contradicts native calibration')
                closed_directions.append(dict(nativeFace=index, nativeEdgeId=eid, normalizedTangentDot=float(a@b)/norm))
            expected = endpoints if same else endpoints[::-1]
            if max(math.dist(a,b) for a,b in zip(pc_ends, expected)) > tolerance:
                raise ValueError('Native PCurve/C3 endpoint mismatch exceeds explicit construction tolerance')
            for end, point in enumerate(endpoints):
                token = (eid, end); parent.setdefault(token, token); tokens.setdefault(token, point)
                v = next(v for v in r['vertices'] if (v['atEndRaw'] == model.capture.conventions.true_means_end) == bool(end))
                if math.dist(v['point'], point) > tolerance:raise ValueError('Native vertex does not bind its C3 endpoint')
                observations.setdefault(token, v)
            if closed:
                union((eid,0), (eid,1)); periodic.append(dict(nativeFace=index, nativeEdgeId=eid, worldClosureGap=math.dist(*endpoints)))
            directed = [(eid,0), (eid,1)] if same else [(eid,1), (eid,0)]
            if not r['loopSense']:directed.reverse()
            directions[index, c.loop, c.ordinal] = not same
            loops[c.loop].append((c, directed)); owners[eid].append(index)
        for loop, rows in loops.items():
            for i, (c, d) in enumerate(rows):
                following, e = rows[(i+1)%len(rows)]
                gap = math.dist(tokens[d[1]], tokens[e[0]])
                world_gap = math.dist(trim._xyz(f.surface.Value(*c.end)), trim._xyz(f.surface.Value(*following.start)))
                if max(gap, world_gap) > tolerance:raise ValueError('Loop endpoint gap exceeds construction tolerance')
                union(d[1], e[0]); relations.append(dict(nativeFace=index, loop=loop, left=list(d[1]), right=list(e[0]),
                    c3EndpointGap=gap, pcWorldGap=world_gap))
    if any(len(v) != 2 for v in owners.values()):raise ValueError('Every physical native edge needs exactly two coedge uses')
    classes = defaultdict(list)
    for token in tokens:classes[find(token)].append(token)
    positions = {}; observed_to_class = {}; records = []
    for root, members in sorted(classes.items()):
        if len(members) > 128:raise ValueError('Logical endpoint class exceeds bounded valence scope')
        point = observations[root]['point']; diameter = max(math.dist(tokens[a],tokens[b]) for a in members for b in members)
        radius = max(math.dist(point,tokens[t]) for t in members)
        if max(radius, diameter) > tolerance:raise ValueError('Transitive endpoint class exceeds construction tolerance')
        positions[root] = point
        for token in members:
            ident = observations[token]['nativeVertexId']
            if ident in observed_to_class and observed_to_class[ident] != root:raise ValueError('Observed vertex spans disconnected logical classes')
            observed_to_class[ident] = root
        records.append(dict(key=list(root), members=[list(t) for t in members], point=point, diameter=diameter, radius=radius))
    return SimpleNamespace(curves=curves, directions=directions, positions=positions, observed=observed_to_class,
        owners=owners, token_class={t:find(t) for t in tokens},
        report=dict(classes=records, loopRelations=relations, periodicCircleRelations=periodic,
                    closedDirectionChecks=closed_directions, globalCoordinateWeldUsed=False))


def _build_faces(model, topology, tolerance):
    k = _kernel(); builder = k.BRep_Builder(); vertices = {}; faces = []; edge_bindings = []; traces = []
    for key, point in topology.positions.items():
        v = k.TopoDS_Vertex(); builder.MakeVertex(v, k.gp_Pnt(*point), tolerance); vertices[key] = v
    for index, f in sorted(model.faces.items()):
        surface = f.surface.Copy(); face = k.TopoDS_Face(); builder.MakeFace(face, surface, tolerance)
        loops = defaultdict(list)
        for c in f.coedges:loops[c.loop].append(c)
        wires = []
        for loop, coedges in loops.items():
            wire = k.TopoDS_Wire(); builder.MakeWire(wire)
            for c in coedges:
                for proof in f.transitions:
                    if proof['loop'] == loop and proof['beforeOrdinal'] == c.ordinal:
                        desc = dict(type=1, start=[*proof['startUv'],0.], end=[*proof['endUv'],0.], supported=True)
                        pc = trim._curve(desc,(0.,1.),2); edge = k.TopoDS_Edge(); builder.MakeEdge(edge); builder.Degenerated(edge,True)
                        builder.UpdateEdge(edge,pc,face,tolerance); builder.Range(edge,face,0.,1.)
                        v = vertices[topology.observed[proof['nativeVertexId']]]
                        for t, orientation in ((0.,k.TopAbs_FORWARD),(1.,k.TopAbs_REVERSED)):
                            oriented = k.TopoDS.Vertex_s(v.Oriented(orientation)); builder.Add(edge,oriented); builder.UpdateVertex(oriented,t,edge,face,tolerance)
                        builder.SameParameter(edge,False); builder.SameRange(edge,False); builder.Add(wire,edge)
                r = c.raw; eid = r['nativeEdgeId']; a,b = trim._interval(r['edgeRange']); curve = topology.curves[eid].Copy()
                reverse = topology.directions[index,c.loop,c.ordinal]
                if reverse and r['curve3d']['type'] == 2:
                    # Negative bounds avoid lossy +2pi endpoint normalization.
                    curve = curve.Reversed(); a,b = -b,-a
                    curve = k.Geom_TrimmedCurve(curve,a,b,True,False)
                else:
                    curve = k.Geom_TrimmedCurve(curve,a,b,True,False)
                    if reverse:curve = curve.Reversed()
                a,b = curve.FirstParameter(),curve.LastParameter()
                pc, trace = normalize_pcurve(r['curve2d'],[c.a,c.b],[a,b],surface)
                trace.update(nativeFace=index,loop=c.loop,coedgeOrdinal=c.ordinal,nativeEdgeId=eid); traces.append(trace)
                edge = k.TopoDS_Edge(); builder.MakeEdge(edge,curve,tolerance)
                builder.SameParameter(edge,False); builder.SameRange(edge,False); builder.Range(edge,a,b,True)
                ends = (1,0) if reverse else (0,1)
                for end, t, orientation in zip(ends,(a,b),(k.TopAbs_FORWARD,k.TopAbs_REVERSED)):
                    v = k.TopoDS.Vertex_s(vertices[topology.token_class[eid,end]].Oriented(orientation))
                    builder.Add(edge,v); builder.UpdateVertex(v,t,edge,tolerance)
                builder.UpdateEdge(edge,pc,face,tolerance); builder.Range(edge,face,a,b)
                for end,t,orientation in zip(ends,(a,b),(k.TopAbs_FORWARD,k.TopAbs_REVERSED)):
                    v=k.TopoDS.Vertex_s(vertices[topology.token_class[eid,end]].Oriented(orientation)); builder.UpdateVertex(v,t,edge,face,tolerance)
                errors=[]
                for t in np.linspace(a,b,33):
                    uv=pc.Value(float(t)); errors.append(curve.Value(float(t)).Distance(surface.Value(uv.X(),uv.Y())))
                builder.SameRange(edge,True); builder.SameParameter(edge,max(errors)<=tolerance)
                builder.Add(wire,edge if r['loopSense'] else edge.Reversed())
                edge_bindings.append((edge,eid,index))
            if not k.BRep_Tool.IsClosed_s(wire):raise ValueError('Logical vertex reconstruction left an open wire')
            wire.Closed(True); wires.append(k.TopoDS.Wire_s(wire.Reversed()) if not f.raw['normalSense'] else wire)
        maker=k.BRepBuilderAPI_MakeFace(surface,wires[0],True)
        for wire in wires[1:]:maker.Add(wire)
        face=maker.Face()
        if not f.raw['normalSense']:face=k.TopoDS.Face_s(face.Reversed())
        faces.append((index,face))
    return faces,edge_bindings,traces


def audit_physical_edges(shape):
    """All physical coedge occurrences, including both uses of seam edges."""
    k=_kernel(); edges=_mapped(shape,k.TopAbs_EDGE); rows=[]; degenerate=[]; failures=[]
    for fi,face in enumerate(_mapped(shape,k.TopAbs_FACE)):
        face=k.TopoDS.Face_s(face); explorer=k.TopExp_Explorer(face,k.TopAbs_EDGE); ordinal=0
        while explorer.More():
            edge=k.TopoDS.Edge_s(explorer.Current()); explorer.Next(); ordinal+=1
            ei=next(i for i,e in enumerate(edges) if e.IsSame(edge))
            if k.BRep_Tool.Degenerated_s(edge):degenerate.append(dict(face=fi,edge=ei)); continue
            row=dict(face=fi,edge=ei,coedgeOrdinal=ordinal,orientation=str(edge.Orientation()),edgeTolerance=k.BRep_Tool.Tolerance_s(edge))
            try:
                c3=k.BRep_Tool.Curve_s(edge,0.,0.); pc=k.BRep_Tool.CurveOnSurface_s(edge,face,0.,0.); surface=k.BRep_Tool.Surface_s(face)
                a,b=k.BRep_Tool.Range_s(edge); pa,pb=k.BRep_Tool.Range_s(edge,face)
                if (a,b)!=(pa,pb):raise ValueError('Finite PCurve/C3 ranges differ after normalization')
                check=k.GeomLib_CheckCurveOnSurface(k.GeomAdaptor_Curve(c3,a,b),1e-12)
                check.Perform(k.Adaptor3d_CurveOnSurface(k.Geom2dAdaptor_Curve(pc,pa,pb),k.GeomAdaptor_Surface(surface)))
                row.update(done=check.IsDone(),errorStatus=check.ErrorStatus(),range=[a,b])
                if not check.IsDone():raise ValueError('Public curve-on-surface maximum checker did not finish')
                distance=check.MaxDistance()
                if not math.isfinite(distance) or distance<0:raise ValueError('Invalid surface/C3 maximum')
                row.update(maximumSameParameterDistance=distance,worstParameter=check.MaxParameter(),withinRecordedTolerance=distance<=row['edgeTolerance'])
            except Exception as error:row['failure']=str(error); failures.append(dict(row))
            rows.append(row)
    counts=Counter(r['edge'] for r in rows)
    return dict(rows=rows,failures=failures,physicalEdges=len(counts),coedgeOccurrences=len(rows),
        ownerCountsNotTwo={str(e):n for e,n in counts.items() if n!=2},degenerateChartOccurrences=degenerate,
        maximumSameParameterDistance=max((r.get('maximumSameParameterDistance',0.) for r in rows),default=0.),
        sameParameterMetricIsNotClosestLocusDistance=True)


def assemble_native_solid(capture, *, geometry_policy, construction_tolerance, metadata_quantum=None):
    """Build one isolated closed solid. This alone is NOT a fidelity certificate.

    Explicit policy/construction budget and optional measurement-derived metadata
    quantum are validated before OCCT allocation. The returned trim model keeps
    its complete query warnings; comparison evidence is a separate step.
    """
    if geometry_policy is None:raise ValueError('Explicit geometry accuracy policy required')
    policy=validated_policy(geometry_policy); tolerance=trim._number(construction_tolerance)
    budget=policy.distance_budget_mm(critical=True)
    if not 1e-7<=tolerance<=min(1e-3,budget):raise ValueError('Construction tolerance exceeds explicit CAD policy/bounded kernel scope')
    if metadata_quantum is not None:
        metadata_quantum=trim._number(metadata_quantum)
        if not 0<metadata_quantum<=tolerance:raise ValueError('Invalid explicit tolerance-metadata quantum')
    if not isinstance(capture,trim.NativeCapture) or not capture.unchanged():raise ValueError('A fresh source-labelled native capture is required')
    report=dict(scope='isolated native-capture closed-BRep reconstruction, not native-HM/product acceptance',
        sourceLabel=capture.source_label,captureSHA256=capture.sha256,calibrationSHA256=capture.conventions.calibration_sha256,
        geometryPolicy=policy.manifest(),constructionTolerance=tolerance,metadataQuantum=metadata_quantum,
        validSolid=False,geometryFidelityVerified=False,meshQualityCertified=False,productAcceptance=False,
        sourceSurfaceSubstitution=False,shapeFixUsed=False,buildCurves3dUsed=False,failures=[])
    try:
        model=trim.reconstruct_trim(capture); report['trimReport']=model.report
        if not model.report['completeNativeFaceCoverage'] or model.report['inputEvidenceConsistent'] is not True or model.report['inputEvidenceMissing']:
            raise ValueError('Incomplete or contradictory native input evidence cannot form a certified closed BRep')
        k=_kernel(); before={i:_fingerprint(f.surface) for i,f in model.faces.items()}
        topology=_topology(model,tolerance); report['topology']=topology.report
        faces,edge_bindings,traces=_build_faces(model,topology,tolerance); report['rangeTransfers']=traces
        sew=k.BRepBuilderAPI_Sewing(tolerance,True,True,True,False)
        sew.SetMinTolerance(1e-7);sew.SetMaxTolerance(tolerance);sew.SetSameParameterMode(False)
        for _,f in faces:sew.Add(f)
        sew.Perform();shape=sew.SewedShape();output_faces=_mapped(shape,k.TopAbs_FACE);shells=_mapped(shape,k.TopAbs_SHELL)
        report['sewing']=dict(faces=len(output_faces),shells=len(shells),freeEdges=sew.NbFreeEdges(),
            multipleEdges=sew.NbMultipleEdges(),deletedFaces=sew.NbDeletedFaces(),modifiedFaces=[],modifiedEdges=[])
        if len(output_faces)!=len(faces) or len(shells)!=1 or sew.NbFreeEdges() or sew.NbMultipleEdges() or sew.NbDeletedFaces() or not k.BRep_Tool.IsClosed_s(shells[0]):
            raise ValueError('Sew did not preserve every physical face in one closed manifold shell')
        native_to_output={}
        for index,face in faces:
            changed=sew.Modified(face) if sew.IsModified(face) else face
            mapped=_mapped(changed,k.TopAbs_FACE)
            if len(mapped)!=1:raise ValueError('A native face was split or lost')
            output=next((i for i,f in enumerate(output_faces) if mapped[0].IsSame(f)),None)
            if output is None or output in native_to_output.values():raise ValueError('Native face correspondence is not bijective')
            native_to_output[index]=output
            if _fingerprint(k.BRep_Tool.Surface_s(k.TopoDS.Face_s(mapped[0])))!=before[index]:raise ValueError('Sew changed a native support definition')
            report['sewing']['modifiedFaces'].append(dict(nativeFace=index,outputFace=output,topologyModified=sew.IsModified(face),supportDefinitionUnchanged=True))
        edges=_mapped(shape,k.TopAbs_EDGE); edge_native=defaultdict(set)
        for edge,eid,fi in edge_bindings:
            changed=sew.ModifiedSubShape(edge) if sew.IsModifiedSubShape(edge) else edge
            candidates=_mapped(changed,k.TopAbs_EDGE)
            if len(candidates)!=1:raise ValueError('A physical native edge was split or removed')
            output=next((i for i,e in enumerate(edges) if candidates[0].IsSame(e)),None)
            if output is None:raise ValueError('Missing physical edge correspondence')
            edge_native[output].add(eid)
            report['sewing']['modifiedEdges'].append(dict(nativeFace=fi,nativeEdgeId=eid,outputEdge=output,
                topologyModified=sew.IsModifiedSubShape(edge)))
        if len(edge_native)!=len(topology.curves) or any(len(v)!=1 for v in edge_native.values()):raise ValueError('Native physical edges were merged/split ambiguously')
        audit=audit_physical_edges(shape); report['curveChecksBeforeMetadata']=audit
        if audit['failures'] or audit['ownerCountsNotTwo'] or audit['physicalEdges']!=len(topology.curves):raise ValueError('Physical-edge audit incomplete')
        inverse={v:k for k,v in native_to_output.items()};actual_owners=defaultdict(list)
        for r in audit['rows']:actual_owners[next(iter(edge_native[r['edge']]))].append(inverse[r['face']])
        if any(Counter(actual_owners[e])!=Counter(v) for e,v in topology.owners.items()):raise ValueError('Physical face-edge adjacency changed')
        if len(_mapped(shape,k.TopAbs_VERTEX))!=len(topology.positions):raise ValueError('Sew merged distinct logical vertices')
        geometry_signature=_shape_geometry(shape);updates=[];builder=k.BRep_Builder()
        maxima=defaultdict(float)
        for r in audit['rows']:maxima[r['edge']]=max(maxima[r['edge']],r['maximumSameParameterDistance'])
        for ei,distance in maxima.items():
            edge=k.TopoDS.Edge_s(edges[ei]);old=k.BRep_Tool.Tolerance_s(edge)
            chosen=_metadata_target(distance,old,tolerance,metadata_quantum)
            if distance>old:
                builder.UpdateEdge(edge,chosen); updates.append(dict(nativeEdgeId=next(iter(edge_native[ei])),outputEdge=ei,
                    before=old,after=k.BRep_Tool.Tolerance_s(edge),measuredMaximum=distance))
        if _shape_geometry(shape)!=geometry_signature:raise ValueError('Metadata-only update changed geometry')
        report.update(metadataUpdates=updates,metadataUpdateGeometryUnchanged=True)
        audit=audit_physical_edges(shape);report['physicalEdgeChecks']=audit
        if audit['failures'] or any(not r['withinRecordedTolerance'] for r in audit['rows']):raise ValueError('Recorded tolerances do not cover all owner representations')
        if not k.BRepCheck_Analyzer(shape,True,False,True).IsValid():raise ValueError('Closed shell is geometrically invalid')
        solid=k.BRepBuilderAPI_MakeSolid(k.TopoDS.Shell_s(shells[0])).Solid()
        if not k.BRepLib.OrientClosedSolid_s(solid) or not k.BRepCheck_Analyzer(solid,True,False,True).IsValid():raise ValueError('MakeSolid is not an orientable valid solid')
        tolerances=[k.BRep_Tool.Tolerance_s(k.TopoDS.Edge_s(e)) for e in edges]+[k.BRep_Tool.Tolerance_s(k.TopoDS.Vertex_s(v)) for v in _mapped(solid,k.TopAbs_VERTEX)]
        if max(tolerances)>budget:raise ValueError('Output tolerance metadata exceeds the CAD distance budget')
        volumes=[]
        for eps in (1e-8,1e-10):
            props=k.GProp_GProps();error=k.BRepGProp.VolumeProperties_s(solid,props,eps,True,False)
            volumes.append(dict(volume=props.Mass(),requestedRelativeError=eps,estimatedRelativeError=error))
        if not all(math.isfinite(r['volume']) and r['volume']>0 and math.isfinite(r['estimatedRelativeError'])
                   and 0<=r['estimatedRelativeError']<=r['requestedRelativeError'] for r in volumes):
            raise ValueError('Nonpositive/nonfinite or unconverged independent solid mass')
        if abs(volumes[0]['volume']-volumes[1]['volume'])/volumes[1]['volume']>1e-8:raise ValueError('Independent volume integration did not converge')
        if any(_fingerprint(f.surface)!=before[i] for i,f in model.faces.items()) or not capture.unchanged():raise ValueError('Original native capture mathematics mutated')
        state,_=_solid_state(solid,budget)
        report.update(validSolid=True,faces=len(faces),physicalEdges=len(topology.curves),vertices=len(topology.positions),
            shells=1,solids=1,independentVolume=volumes[-1]['volume'],volumeIntegrations=volumes,
            maximumOutputTolerance=max(tolerances),physicalAdjacencyPreserved=True,sourceInputsUnchanged=True,
            originalNativeSupportsUnchanged=True,postComparisonRequired=True,
            analysisGeometrySHA256=state['geometrySHA256'],analysisStateSHA256=state['stateSHA256'],
            outputTopology=state['topology'],analysisTopologySHA256=state['topologySHA256'],
            analysisTolerancesSHA256=state['tolerancesSHA256'])
        binding=_SolidBinding(capture.sha256,state['geometrySHA256'],state['stateSHA256'],
                              state['topologySHA256'],state['tolerancesSHA256'],budget,volumes[-1]['volume'])
        return NativeSolid(solid,model,report,binding)
    except Exception as error:
        report['failures'].append(dict(stage='native-solid-construction',error=str(error)))
        raise SolidReconstructionError(str(error),report) from error


def write_brep(result, path):
    """Write a NEW caller-selected file, then actually reopen and validate it."""
    path=Path(path).resolve();k=_kernel()
    if path.exists() or not path.parent.is_dir():raise ValueError('Require a new output under an existing caller-selected directory')
    state,data=_validate_bound_result(result)
    with path.open('xb') as output:output.write(data)
    reopened=k.TopoDS_Shape()
    if not k.BRepTools.Read_s(reopened,str(path),k.BRep_Builder()):raise ValueError('Saved BRep could not be read')
    reopened_state,_=_solid_state(reopened,result._binding.distance_budget)
    if reopened_state['topologySHA256']!=result._binding.topology_sha256:
        raise ValueError('Readback topology changed')
    readback_metadata=_reopen_tolerances(result.shape,reopened)
    readback_math=_reopen_math(result.shape,reopened)
    props=k.GProp_GProps();k.BRepGProp.VolumeProperties_s(reopened,props,1e-10,True,False)
    if not math.isfinite(props.Mass()) or props.Mass()<=0 or abs(props.Mass()-result._binding.volume)>1e-9*max(1.,props.Mass()):raise ValueError('Saved BRep volume changed')
    _validate_bound_result(result)
    if path.read_bytes()!=data:raise ValueError('Saved BRep bytes changed during verification')
    return dict(path=str(path),sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),savedReopenedValid=True,
                savedReopenedVolume=props.Mass(),savedReopenedTopology=reopened_state['topology'],
                savedReopenedStateSHA256=reopened_state['stateSHA256'],
                savedReopenedTopologySHA256=reopened_state['topologySHA256'],
                savedReopenedTolerancesSHA256=reopened_state['tolerancesSHA256'],
                savedReopenedGeometrySHA256=reopened_state['geometrySHA256'],readbackMath=readback_math,
                readbackToleranceMetadata=readback_metadata,
                savedBytesMatchBoundState=True,productAcceptance=False)


def compare_against_source(result, source_step, reference_path, *, geometry_policy,
                           expected_source_sha256=None, expected_reference_sha256=None):
    """Bounded full stated witness sets, not a continuum Hausdorff theorem.

    Source STEP supplies ONLY independent comparison data. It is never used to
    replace a captured support/curve. Actual native polyline breakpoints and
    segment midpoints are included; no physical edge/face is silently omitted.
    All query warnings/failures survive, including checked non-winning faces.
    """
    if geometry_policy is None:raise ValueError('Explicit comparison policy required')
    policy=validated_policy(geometry_policy);limits=policy.carrier_limits()
    state,_=_validate_bound_result(result,geometry_policy=policy)
    source_step=Path(source_step).resolve()
    if not source_step.is_file() or not 0<source_step.stat().st_size<=trim.MAX_BYTES:raise ValueError('Source STEP byte budget exceeded')
    source_raw=source_step.read_bytes();source_hash=hashlib.sha256(source_raw).hexdigest()
    reference_path,reference_raw,reference=trim._read(reference_path,4*1024**2)
    reference_hash=hashlib.sha256(reference_raw).hexdigest()
    if expected_source_sha256 is not None and source_hash!=expected_source_sha256:raise ValueError('Source STEP hash mismatch')
    if expected_reference_sha256 is not None and reference_hash!=expected_reference_sha256:raise ValueError('Reference hash mismatch')
    if reference.get('sourceStepSHA256')!=source_hash:raise ValueError('Reference does not bind the source STEP')
    points=reference.get('points')
    if not isinstance(points,list) or not 1<=len(points)<=4096:raise ValueError('Require1..4096 explicit source reference points')
    for r in points:
        trim._vec(r.get('point'));trim._number(r.get('sourceDistance'))
        if r['sourceDistance']<0 or r.get('role') not in ('control','mesh-boundary-node','source-face-interior','source-vertex'):
            raise ValueError('Invalid source reference role/distance')
    k=_kernel()
    signature=state['geometrySHA256']
    model=trim.reconstruct_trim(result.native.capture)
    if not model.report['completeNativeFaceCoverage'] or model.report['inputEvidenceConsistent'] is not True:
        raise ValueError('Native comparison domains incomplete or inconsistent')
    native_edges={}
    for f in model.faces.values():
        for c in f.coedges:native_edges.setdefault(c.raw['nativeEdgeId'],c)
    edge_plan=[]
    for eid,c in sorted(native_edges.items()):
        a,b=trim._interval(c.raw['edgeRange']);descriptor=c.raw['curve3d']
        if descriptor['type']==5:
            params=[]
            for low,high in zip(descriptor['parameters'],descriptor['parameters'][1:]):
                lo,hi=max(a,low),min(b,high)
                if lo<=hi:params.extend((lo,(lo+hi)/2,hi))
        else:
            params=list(np.linspace(a,b,17))
            if descriptor['type']==4:params.extend(t for t in descriptor['knots'] if a<=t<=b)
        edge_plan.append((eid,c,sorted(set(map(float,params)))))
    planned=len(points)+sum(len(p) for _,_,p in edge_plan)+sum(len(c.raw['onSurfaceSamples']) for f in model.faces.values() for c in f.coedges)
    if planned+34*len(native_edges)+20*len(model.faces)>MAX_QUERIES:raise ValueError('Comparison sample budget exceeded before geometry queries')
    from build123d import Face,Edge,import_step
    from .native_cad_audit import _interior_point
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.BRepBndLib import BRepBndLib
    from OCP.Bnd import Bnd_Box
    source=import_step(source_step)
    if not source.is_valid or len(source.solids())!=1:raise ValueError('Independent source STEP is not a default-valid one-solid CAD')
    source_faces=list(source.faces());analysis_faces=[Face(k.TopoDS.Face_s(f)) for f in _mapped(result.shape,k.TopAbs_FACE)]
    source_edges=[Edge(k.TopoDS.Edge_s(e)) for e in _mapped(source.wrapped,k.TopAbs_EDGE) if not k.BRep_Tool.Degenerated_s(k.TopoDS.Edge_s(e))]
    analysis_edges=[Edge(k.TopoDS.Edge_s(e)) for e in _mapped(result.shape,k.TopAbs_EDGE) if not k.BRep_Tool.Degenerated_s(k.TopoDS.Edge_s(e))]
    if max(len(source_faces),len(analysis_faces))>trim.MAX_FACES or len(source_edges)>trim.MAX_COEDGES:raise ValueError('Source geometry count budget exceeded')
    class Index:
        def __init__(self,shapes):
            self.shapes=shapes;self.boxes=[]
            for sh in shapes:
                box=sh.bounding_box();self.boxes.append((np.array(tuple(box.min)),np.array(tuple(box.max))))
        def distance(self,point):
            p=np.asarray(point);best=float('inf');winner=None
            order=sorted((float(np.linalg.norm(np.maximum(np.maximum(lo-p,p-hi),0.))),i) for i,(lo,hi) in enumerate(self.boxes))
            for lower,i in order:
                if lower>best+1e-10:break
                d=self.shapes[i].distance_to(tuple(point))
                if d<best:best=d;winner=i
            if not math.isfinite(best):raise ValueError('No finite physical-shape distance')
            return dict(distance=best,shapeIndex=winner)
    sf,af,se,ae=map(Index,(source_faces,analysis_faces,source_edges,analysis_edges))
    failures=[];warnings=[];reference_rows=[];native_pc=[];native_c3=[];reverse_faces=[];reverse_edges=[];source_edge_rows=[]
    def native_query(point,scope,identity):
        q=model.query(point)
        warnings.extend(dict(scope=scope,identity=identity,**w) for w in q['queryWarnings'])
        if q['queryFailures'] or q['unsupportedFaceCount'] or q['witness'] is None:
            failures.append(dict(scope=scope,identity=identity,query=q))
        return q
    for i,r in enumerate(points):
        try:
            d=sf.distance(r['point'])['distance'];candidate=af.distance(r['point']);q=native_query(r['point'],'reference',i)
            error=abs(d-r['sourceDistance'])
            if error>limits['maximumSourceReferenceError'] or r['role']!='control' and d>limits['maximumSourceReferenceError']:
                failures.append(dict(scope='source-reference-recheck',index=i,distance=d,error=error))
            reference_rows.append(dict(index=i,role=r['role'],point=r['point'],sourceDistance=d,sourceReferenceError=error,
                candidateDistance=candidate['distance'],analysisFace=candidate['shapeIndex'],nativeQuery=q,
                sourceCandidateDistanceError=abs(candidate['distance']-d)))
        except Exception as error:failures.append(dict(scope='reference',index=i,error=str(error)))
    for fi,f in sorted(model.faces.items()):
        for c in f.coedges:
            for ordinal,s in enumerate(c.raw['onSurfaceSamples']):
                try:native_pc.append(dict(nativeFace=fi,nativeEdgeId=c.raw['nativeEdgeId'],sample=ordinal,point=s['point'],**af.distance(s['point'])))
                except Exception as error:failures.append(dict(scope='native-PCurve-to-analysis',nativeFace=fi,nativeEdgeId=c.raw['nativeEdgeId'],sample=ordinal,error=str(error)))
    for eid,c,params in edge_plan:
        curve=trim._curve(c.raw['curve3d'],trim._interval(c.raw['edgeRange']),3);samples=[]
        for t in params:
            p=trim._xyz(curve.Value(t))
            try:samples.append(dict(parameter=t,point=p,analysisFaceDistance=af.distance(p)['distance'],
                sourcePhysicalEdgeDistance=se.distance(p)['distance']))
            except Exception as error:failures.append(dict(scope='native-C3',nativeEdgeId=eid,parameter=t,error=str(error)))
        native_c3.append(dict(nativeEdgeId=eid,samples=samples))
    for fi,face in enumerate(analysis_faces):
        try:
            p=_interior_point(face);q=native_query(p,'analysis-face',fi)
            reverse_faces.append(dict(face=fi,point=p,nativeQuery=q,sourceFaceDistance=sf.distance(p)['distance']))
        except Exception as error:failures.append(dict(scope='analysis-face',face=fi,error=str(error)))
    for ei,edge in enumerate(analysis_edges):
        adaptor=BRepAdaptor_Curve(edge.wrapped);samples=[]
        for t in np.linspace(adaptor.FirstParameter(),adaptor.LastParameter(),17):
            p=trim._xyz(adaptor.Value(float(t)));q=native_query(p,'analysis-edge',[ei,float(t)])
            try:samples.append(dict(parameter=float(t),point=p,nativeQuery=q,sourcePhysicalEdgeDistance=se.distance(p)['distance']))
            except Exception as error:failures.append(dict(scope='analysis-edge',edge=ei,parameter=float(t),error=str(error)))
        reverse_edges.append(dict(edge=ei,samples=samples))
    for ei,edge in enumerate(source_edges):
        adaptor=BRepAdaptor_Curve(edge.wrapped);samples=[]
        for t in np.linspace(adaptor.FirstParameter(),adaptor.LastParameter(),17):
            p=trim._xyz(adaptor.Value(float(t)))
            try:samples.append(dict(parameter=float(t),point=p,**ae.distance(p)))
            except Exception as error:failures.append(dict(scope='source-edge',edge=ei,parameter=float(t),error=str(error)))
        source_edge_rows.append(dict(edge=ei,samples=samples))
    def bounds(shapes):
        box=Bnd_Box()
        for sh in shapes:BRepBndLib.AddOptimal_s(sh.wrapped,box,False,False)
        return list(box.Get())
    source_bounds,analysis_bounds=bounds(source_faces),bounds(analysis_faces)
    sp,ap=k.GProp_GProps(),k.GProp_GProps()
    k.BRepGProp.VolumeProperties_s(source.wrapped,sp,1e-10,True,False)
    k.BRepGProp.VolumeProperties_s(result.shape,ap,1e-10,True,False)
    if sp.Mass()<=0 or ap.Mass()<=0:raise ValueError('Nonpositive independent volume')
    def maximum(values):return max(values,default=0.)
    def query_distance(q):return q['witness']['distance'] if q['witness'] is not None else 0.
    metrics=dict(maximumSurfaceDistance=maximum(r['candidateDistance'] for r in reference_rows if r['role']!='control'),
        maximumBoundaryNodeControlDistance=maximum(r['candidateDistance'] for r in reference_rows if r['role']=='mesh-boundary-node'),
        maximumSourceFaceDistance=maximum(r['candidateDistance'] for r in reference_rows if r['role']=='source-face-interior'),
        maximumControlDistanceError=maximum(r['sourceCandidateDistanceError'] for r in reference_rows if r['role']=='control'),
        maximumSourceReferenceError=maximum(r['sourceReferenceError'] for r in reference_rows),
        maximumNativePcToAnalysisDistance=maximum(r['distance'] for r in native_pc),
        maximumNativeC3ToAnalysisDistance=maximum(s['analysisFaceDistance'] for r in native_c3 for s in r['samples']),
        maximumAnalysisFaceToNativeDistance=maximum(query_distance(r['nativeQuery']) for r in reverse_faces),
        maximumAnalysisEdgeToNativeDistance=maximum(query_distance(s['nativeQuery']) for r in reverse_edges for s in r['samples']),
        maximumNativeC3ToSourceEdgeDistance=maximum(s['sourcePhysicalEdgeDistance'] for r in native_c3 for s in r['samples']),
        maximumReverseDistance=maximum(r['sourceFaceDistance'] for r in reverse_faces),
        maximumReverseEdgeDistance=maximum(s['sourcePhysicalEdgeDistance'] for r in reverse_edges for s in r['samples']),
        maximumSourceToAnalysisEdgeDistance=maximum(s['distance'] for r in source_edge_rows for s in r['samples']),
        maximumCadBoundsDifference=max(abs(a-b) for a,b in zip(source_bounds,analysis_bounds)),
        relativeStepBrepVolumeError=abs(ap.Mass()-sp.Mass())/sp.Mass())
    expected_pc=sum(len(c.raw['onSurfaceSamples']) for f in model.faces.values() for c in f.coedges)
    complete=(len(reference_rows)==len(points) and len(native_pc)==expected_pc and
        len(reverse_faces)==len(analysis_faces) and sum(len(r['samples']) for r in native_c3)==sum(len(p) for _,_,p in edge_plan) and
        sum(len(r['samples']) for r in reverse_edges)==17*len(analysis_edges) and
        sum(len(r['samples']) for r in source_edge_rows)==17*len(source_edges))
    distance_budget=policy.distance_budget_mm(critical=True)
    passed=complete and not failures and all(v<=limits.get(name,distance_budget) for name,v in metrics.items())
    _validate_bound_result(result,geometry_policy=policy)
    if source_step.read_bytes()!=source_raw or reference_path.read_bytes()!=reference_raw or not model.capture.unchanged():
        raise ValueError('Input or analysis geometry changed during comparison')
    return dict(scope='bounded finite source/native/analysis comparison; not continuous Hausdorff or solver certification',
        captureSHA256=model.capture.sha256,sourceStepSHA256=source_hash,referenceSHA256=reference_hash,
        analysisGeometrySHA256=signature,
        geometryPolicy=policy.manifest(),metrics=metrics,completeWitnessCoverage=complete,failures=failures,
        warnings=warnings,reference=reference_rows,nativePcToAnalysis=native_pc,nativeC3ToAnalysis=native_c3,
        analysisFacesToNative=reverse_faces,analysisEdgesToNative=reverse_edges,sourceEdgesToAnalysis=source_edge_rows,
        sourcePhysicalFaceBounds=source_bounds,analysisPhysicalFaceBounds=analysis_bounds,
        sourceVolume=sp.Mass(),independentAnalysisVolume=ap.Mass(),
        sourceDefaultBrepValid=bool(source.is_valid),sourceExactBrepCheck=bool(k.BRepCheck_Analyzer(source.wrapped,True,False,True).IsValid()),
        finiteGeometryChecksPassed=bool(passed),legacySourceOriginUncertified=True,
        inputsUnchanged=True,meshQualityCertified=False,nativeHmProductAccepted=False,productAcceptance=False)
