"""Exact source-OCP math/topology payload for native SDK face construction.

Samples are SOURCE observations, never native SDK capture. No meshing, fitting,
coordinate welding, source healing or native-host acceptance is performed.
Only planes/spheres/cylinders/cones/nonperiodic clamped NURBS are supported.
Trimmed hyperbolic pcurves use exact rational conversion with an explicit
nonlinear source-parameter map, not a same-parameter or fitted spline claim.
"""
import argparse
from collections import Counter,defaultdict
import hashlib
import io
import json
import math
import os
from pathlib import Path

import numpy as np

MAX_BYTES=16*1024*1024
MAX_FACES=1024
MAX_COEDGES=8192
MAX_POLES=65536
MAX_TOTAL_POLES=262144
MATH_LIMIT=1e-10


def _sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _brep_sha(shape):
    from OCP.BRepTools import BRepTools
    stream=io.BytesIO();BRepTools.Write_s(shape,stream)
    return hashlib.sha256(stream.getvalue()).hexdigest()


def _xyz(point):
    return [float(point.X()),float(point.Y()),float(point.Z())]


def _xy(point):return [float(point.X()),float(point.Y()),0.]


def _vector(value,n):
    if not isinstance(value,(list,tuple)) or len(value)!=n or any(not isinstance(v,(int,float,np.integer,np.floating)) or isinstance(v,(bool,np.bool_)) or not math.isfinite(v) or abs(v)>1e12 for v in value):
        raise ValueError('Expected bounded finite numeric vector')
    return np.array(value,float)


def _number(value):return float(_vector([value],1)[0])


def _reserve_poles(budget,count):
    if count>MAX_TOTAL_POLES or (budget is not None and budget['poles']+count>MAX_TOTAL_POLES):
        raise ValueError('Payload control-pole budget exceeded before allocation')
    if budget is not None:budget['poles']+=count


def _curve_counts(bs):
    n,degree=bs.NbPoles(),bs.Degree()
    if not 1<=degree<=25 or not degree<n<=MAX_POLES:
        raise ValueError('Invalid bounded source curve degree/poles before allocation')
    return n,degree


def _surface_counts(s):
    nu,nv=s.NbUPoles(),s.NbVPoles();degrees=[s.UDegree(),s.VDegree()]
    if (not all(1<=d<=25 for d in degrees) or not all(2<=n<=512 for n in (nu,nv))
            or nu*nv>MAX_POLES or any(n<=d for n,d in zip((nu,nv),degrees))):
        raise ValueError('Invalid source surface allocation')
    return nu,nv,degrees


def _knots(bs,axis=''):
    count=getattr(bs,'Nb'+axis+'Knots')() if axis else bs.NbKnots()
    poles=getattr(bs,'Nb'+axis+'Poles')() if axis else bs.NbPoles()
    degree=getattr(bs,axis+'Degree')() if axis else bs.Degree()
    if not 1<=degree<=25 or not degree<poles<=MAX_POLES or not 2<=count<=poles+degree+1:
        raise ValueError('Invalid knot counts before expansion')
    knot=getattr(bs,axis+'Knot') if axis else bs.Knot
    mult=getattr(bs,axis+'Multiplicity') if axis else bs.Multiplicity
    multiplicities=[];total=0
    for i in range(1,count+1):
        m=mult(i)
        if not 1<=m<=degree+1:raise ValueError('Invalid knot multiplicity before expansion')
        total+=m
        if total>poles+degree+1:raise ValueError('Expanded knot budget exceeded')
        multiplicities.append(m)
    if total!=poles+degree+1:raise ValueError('Expanded knot count differs from source poles/degree')
    return [float(knot(i)) for i,m in enumerate(multiplicities,1) for _ in range(m)]


def _curve_nurbs(bs,budget=None):
    if bs.IsPeriodic():raise ValueError('Periodic pcurve requires an explicit exact decomposition')
    n,degree=_curve_counts(bs);_reserve_poles(budget,n)
    return dict(type=4,degree=degree,rational=bool(bs.IsRational()),knots=_knots(bs),
        poles=[_xy(bs.Pole(i)) for i in range(1,n+1)],
        weights=[float(bs.Weight(i)) for i in range(1,n+1)] if bs.IsRational() else [],supported=True)


def _curve_record(pc,budget=None):
    from OCP.GeomAbs import GeomAbs_Line,GeomAbs_Circle,GeomAbs_Ellipse,GeomAbs_BSplineCurve,GeomAbs_Hyperbola
    kind=pc.GetType();first,last=pc.FirstParameter(),pc.LastParameter()
    if kind==GeomAbs_Line:
        return dict(type=1,start=_xy(pc.Value(0.)),end=_xy(pc.Value(1.)),supported=True),first,last
    if kind in (GeomAbs_Circle,GeomAbs_Ellipse):
        c=pc.Circle() if kind==GeomAbs_Circle else pc.Ellipse()
        center=_xy(c.Location());radius=np.array(_xy(pc.Value(0.)))-center
        from OCP.gp import gp_Pnt2d,gp_Vec2d
        p=gp_Pnt2d();d=gp_Vec2d();pc.D1(0.,p,d)
        normal=[0.,0.,1. if np.cross(radius,np.array(_xy(d)))[2]>0 else -1.]
        if kind==GeomAbs_Circle:return dict(type=2,center=center,normal=normal,radiusVector=radius.tolist(),supported=True),first,last
        return dict(type=3,center=center,normal=normal,majorAxis=radius.tolist(),
            ratio=float(c.MinorRadius()/c.MajorRadius()),phase=0.,supported=True),first,last
    if kind==GeomAbs_BSplineCurve:return _curve_nurbs(pc.BSpline(),budget),first,last
    if kind==GeomAbs_Hyperbola:
        from OCP.Geom2d import Geom2d_TrimmedCurve
        from OCP.Geom2dConvert import Geom2dConvert
        from OCP.Geom2dAPI import Geom2dAPI_ProjectPointOnCurve
        bs=Geom2dConvert.CurveToBSplineCurve_s(Geom2d_TrimmedCurve(pc.Curve(),first,last))
        record=_curve_nurbs(bs,budget);hyperbola=pc.Hyperbola()
        record['sourceParameterMap']=dict(kind='hyperbola-asinh',center=_xy(hyperbola.Location()),
            yAxis=_xy(hyperbola.YAxis().Direction()),minorRadius=float(hyperbola.MinorRadius()))
        record['exactConversion']='trimmed conic to rational NURBS; geometric locus exact, parameterization remapped'
        forward=[];reverse=[]
        center=np.array(_xy(hyperbola.Location()));yaxis=np.array(_xy(hyperbola.YAxis().Direction()));minor=float(hyperbola.MinorRadius())
        def original_parameter(t):return math.asinh(float(np.dot(np.array(_xy(bs.Value(t)))-center,yaxis))/minor)
        for i in range(7):
            t=first if i==0 else last if i==6 else first+(last-first)*i/6
            witness=Geom2dAPI_ProjectPointOnCurve(pc.Value(t),bs,bs.FirstParameter(),bs.LastParameter())
            candidates=[pc.Value(t).Distance(bs.Value(bs.FirstParameter())),pc.Value(t).Distance(bs.Value(bs.LastParameter()))]
            if witness.NbPoints()>0:candidates.append(float(witness.LowerDistance()))
            if min(candidates)>MATH_LIMIT:
                from scipy.optimize import brentq
                native_t=brentq(lambda x:original_parameter(x)-t,bs.FirstParameter(),bs.LastParameter(),xtol=1e-14,rtol=1e-14)
                candidates.append(pc.Value(t).Distance(bs.Value(native_t)))
            forward.append(float(min(candidates)))
            s=bs.FirstParameter() if i==0 else bs.LastParameter() if i==6 else bs.FirstParameter()+(bs.LastParameter()-bs.FirstParameter())*i/6
            witness=Geom2dAPI_ProjectPointOnCurve(bs.Value(s),pc.Curve(),first,last)
            original_t=original_parameter(s)
            if not first-1e-12<=original_t<=last+1e-12:raise ValueError('Exact conic witness escaped original finite arc')
            bounded_t=min(max(original_t,first),last)
            candidates=[bs.Value(s).Distance(pc.Value(bounded_t)),bs.Value(s).Distance(pc.Value(first)),bs.Value(s).Distance(pc.Value(last))]
            if witness.NbPoints()>0:candidates.append(float(witness.LowerDistance()))
            reverse.append(float(min(candidates)))
        if max(forward+reverse)>MATH_LIMIT:raise ValueError('Exact conic locus conversion witness failed')
        record['exactLocusConversion']=dict(method='Geom2dConvert.CurveToBSplineCurve(trimmed original conic)',
            sourceOriginalParamRange=[float(first),float(last)],sourceToConvertedMaximumDistance=max(forward),
            convertedToSourceMaximumDistance=max(reverse),witnessesPerDirection=7,fittingPerformed=False,
            distanceStatistic='actual finite-curve witness upper bound, endpoints included')
        return record,bs.FirstParameter(),bs.LastParameter()
    raise ValueError('Unsupported source pcurve type, no fitting: '+str(kind))


def _standard_knots(knots,degree,count):
    values=_vector(knots,count+degree+1)
    if (np.any(np.diff(values)<0) or not values[0]<values[-1]
            or not np.all(values[:degree+1]==values[0]) or not np.all(values[-degree-1:]==values[-1])):
        raise ValueError('SDK NURBS requires expanded standard clamped knots')
    return values


def _check_knot_parameter(t,knots,degree):
    lo,hi=knots[degree],knots[-degree-1]
    # Imported STEP can place a trim endpoint a few rounding ulps outside a
    # printed knot. Preserve t and evaluate the endpoint polynomial span,
    # exactly as OCP does; never clamp or move the source parameter/geometry.
    if min(t-lo,hi-t)<-1e-12*max(1.,abs(lo),abs(hi)):
        raise ValueError(f'Curve/surface parameter outside knot support: {t}, {(lo,hi)}')


def _nurbs_curve_value(record,t):
    from scipy.interpolate import BSpline
    degree=record.get('degree');poles=record.get('poles')
    if type(degree) is not int or not 1<=degree<=25 or not isinstance(poles,list) or not degree<len(poles)<=MAX_POLES:
        raise ValueError('Invalid bounded curve degree/poles')
    p=np.array([_vector(v,3) for v in poles]);knots=_standard_knots(record['knots'],degree,len(p))
    if type(record.get('rational')) is not bool:raise ValueError('Curve rational flag must be Boolean')
    weights=_vector(record['weights'],len(p)) if record['rational'] else np.ones(len(p))
    if (not record['rational'] and record['weights']!=[]) or np.any(weights<=0):raise ValueError('Invalid curve weights')
    _check_knot_parameter(t,knots,degree)
    return BSpline(knots,p*weights[:,None],degree)(t)/BSpline(knots,weights,degree)(t)


def evaluate_curve(record,t):
    """SDK curve equations, including exact SOURCE pcurve parameterization."""
    t=_number(t);kind=record.get('type')
    if type(kind) is not int or record.get('supported') is not True:raise ValueError('Unsupported curve record')
    if kind==1:
        start=_vector(record['start'],3);return start*(1-t)+_vector(record['end'],3)*t
    if kind in (2,3):
        center=_vector(record['center'],3);normal=_vector(record['normal'],3)
        radius=_vector(record['radiusVector'] if kind==2 else record['majorAxis'],3)
        if abs(np.linalg.norm(normal)-1)>1e-12 or abs(np.dot(radius,normal))>1e-10:raise ValueError('Invalid curve axes')
        angle=t if kind==2 else t-_number(record['phase'])
        ratio=1. if kind==2 else _number(record['ratio'])
        return center+radius*math.cos(angle)+ratio*np.cross(normal,radius)*math.sin(angle)
    if kind==4:return _nurbs_curve_value(record,t)
    raise ValueError('Unsupported curve math type')


def source_curve_parameter(record,t):
    """Original OCP parameter corresponding to a payload pcurve parameter."""
    t=_number(t);mapping=record.get('sourceParameterMap')
    if mapping is None:
        if record.get('exactLocusConversion') is not None:raise ValueError('Exact conic conversion requires its source parameter map')
        return t
    if not isinstance(mapping,dict) or mapping.get('kind')!='hyperbola-asinh' or record.get('type')!=4:
        raise ValueError('Unsupported exact parameter map')
    r=_number(mapping.get('minorRadius'))
    axis=_vector(mapping.get('yAxis'),3)
    if r<=0 or abs(np.linalg.norm(axis)-1)>1e-12:raise ValueError('Invalid hyperbola parameter-map axis/radius')
    return math.asinh(float(np.dot(evaluate_curve(record,t)-_vector(mapping.get('center'),3),axis))/r)


def curve_parameter_from_source(record,source_parameter,first,last):
    """Invert the exact conic map to cross-check independent original samples."""
    source_parameter=_number(source_parameter)
    a,b=source_curve_parameter(record,first),source_curve_parameter(record,last)
    if abs(source_parameter-a)<=1e-12:t=first
    elif abs(source_parameter-b)<=1e-12:t=last
    elif record.get('sourceParameterMap') is None:t=source_parameter
    else:
        from scipy.optimize import brentq
        if not min(a,b)<source_parameter<max(a,b):raise ValueError('Source witness outside converted finite arc')
        t=brentq(lambda x:source_curve_parameter(record,x)-source_parameter,first,last,xtol=1e-14,rtol=1e-14)
    if not first-1e-12<=t<=last+1e-12 or abs(source_curve_parameter(record,t)-source_parameter)>MATH_LIMIT:
        raise ValueError('Exact source parameter inverse differs')
    return t


def _surface_record(surface,budget=None):
    from OCP.GeomAbs import GeomAbs_Plane,GeomAbs_Sphere,GeomAbs_Cylinder,GeomAbs_Cone,GeomAbs_BSplineSurface
    kind=surface.GetType()
    if kind==GeomAbs_Plane:
        plane=surface.Plane();axes=plane.Position()
        return dict(type=1,planeBase=_xyz(plane.Location()),planeU=_xyz(axes.XDirection()),planeV=_xyz(axes.YDirection()))
    if kind==GeomAbs_Sphere:
        s=surface.Sphere();a=s.Position()
        return dict(type=2,sphereCenter=_xyz(s.Location()),sphereNorth=_xyz(a.Direction()),
            sphereOrigin=_xyz(a.XDirection()),sphereRadius=float(s.Radius()),sphereReverseU=False)
    if kind==GeomAbs_Cylinder:
        s=surface.Cylinder();a=s.Position()
        return dict(type=3,cylinderCenter=_xyz(s.Location()),cylinderAxis=_xyz(a.Direction()),
            cylinderOrigin=_xyz(a.XDirection()),cylinderRadius=float(s.Radius()),cylinderVFactor=1.)
    if kind==GeomAbs_Cone:
        s=surface.Cone();r=float(s.RefRadius());angle=float(s.SemiAngle());a=s.Position()
        if r<=0:raise ValueError('Zero reference-radius cone is unsupported, no refitting')
        return dict(type=4,coneCenter=_xyz(s.Location()),coneAxis=_xyz(a.Direction()),
            coneMajor=(r*np.array(_xyz(a.XDirection()))).tolist(),coneRatio=1.,conePhase=0.,coneVParam=0.,
            coneVFactor=math.sin(angle)/r,coneAxisVFactor=math.cos(angle))
    if kind==GeomAbs_BSplineSurface:
        s=surface.BSpline()
        if s.IsUPeriodic() or s.IsVPeriodic():raise ValueError('Periodic support requires an explicit exact decomposition')
        nu,nv,degrees=_surface_counts(s);rational=bool(s.IsURational() or s.IsVRational())
        _reserve_poles(budget,nu*nv)
        return dict(type=6,degree=degrees,shape=[nu,nv],rational=[rational,rational],
            uKnots=_knots(s,'U'),vKnots=_knots(s,'V'),
            polesUFast=[_xyz(s.Pole(i,j)) for j in range(1,nv+1) for i in range(1,nu+1)],
            weights=[float(s.Weight(i,j)) for j in range(1,nv+1) for i in range(1,nu+1)] if rational else [])
    raise ValueError('Unsupported source surface type, no fitting: '+str(kind))


def _extend_u_support(record,uv,surface):
    """Exact homogeneous continuation for the measured two-U-pole surfaces."""
    if record['type']!=6:return
    uk,vk=record['uKnots'],record['vKnots'];a,b=uk[0],uk[-1]
    if uv[2]<vk[0]-1e-12 or uv[3]>vk[-1]+1e-12:
        raise ValueError('V trim exceeds source support; exact V extension not implemented')
    lo,hi=min(a,uv[0]),max(b,uv[1])
    if a-lo<=1e-12 and hi-b<=1e-12:return
    if record['degree'][0]!=1 or record['shape'][0]!=2 or uk!=[a,a,b,b]:
        raise ValueError('Out-of-support U trim requires the exact degree-1/two-pole extension case')
    nv=record['shape'][1];p=np.array(record['polesUFast']).reshape(nv,2,3)
    rational=record['rational'][0];w=np.array(record['weights']).reshape(nv,2) if rational else np.ones((nv,2))
    h=np.concatenate((p*w[:,:,None],w[:,:,None]),axis=2)
    t0,t1=(lo-a)/(b-a),(hi-a)/(b-a)
    extended=np.stack(((1-t0)*h[:,0]+t0*h[:,1],(1-t1)*h[:,0]+t1*h[:,1]),axis=1)
    if np.any(extended[:,:,3]<=0):raise ValueError('Exact support continuation produced nonpositive weights')
    record['polesUFast']=(extended[:,:,:3]/extended[:,:,3,None]).reshape(-1,3).tolist()
    record['weights']=extended[:,:,3].ravel().tolist() if rational else []
    record['uKnots']=[float(lo),float(lo),float(hi),float(hi)]
    error=0.
    for u in (lo,a,(a+b)/2,b,hi):
        for v in (uv[2],(uv[2]+uv[3])/2,uv[3]):
            error=max(error,_error(evaluate_surface(record,u,v),_xyz(surface.Value(u,v))))
    record['exactSupportExtension']=dict(axis='U',method='degree-1 two-pole homogeneous endpoint continuation',
        originalKnots=uk,extendedKnots=record['uKnots'],originalGlobalParameterizationPreserved=True,
        fittingPerformed=False,sourceTrimUnchanged=True,maximumSourceOCPAgreementError=error)


def _pcurve_uv_bounds(face):
    from OCP.Bnd import Bnd_Box2d
    from OCP.BndLib import BndLib_Add2dCurve
    from OCP.BRepAdaptor import BRepAdaptor_Curve2d
    from OCP.TopAbs import TopAbs_WIRE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    from OCP.BRepTools import BRepTools_WireExplorer
    box=Bnd_Box2d();wires=TopExp_Explorer(face,TopAbs_WIRE)
    while wires.More():
        walk=BRepTools_WireExplorer(TopoDS.Wire_s(wires.Current()),face)
        while walk.More():
            pc=BRepAdaptor_Curve2d(TopoDS.Edge_s(walk.Current()),face)
            BndLib_Add2dCurve.AddOptimal_s(pc.Curve(),pc.FirstParameter(),pc.LastParameter(),0.,box)
            walk.Next()
        wires.Next()
    a,b,c,d=box.Get()
    return [float(a),float(c),float(b),float(d)]


def evaluate_surface(record,u,v):
    """Evaluate the documented SDK surface equations, not sampled geometry."""
    u,v=_number(u),_number(v);kind=record.get('type')
    if type(kind) is not int:raise ValueError('Surface type must be an integer')
    if kind==1:return _vector(record['planeBase'],3)+u*_vector(record['planeU'],3)+v*_vector(record['planeV'],3)
    if kind==2:
        c=_vector(record['sphereCenter'],3);n=_vector(record['sphereNorth'],3);p=_vector(record['sphereOrigin'],3)
        if type(record['sphereReverseU']) is not bool:raise ValueError('Sphere reverse flag must be Boolean')
        sign=-1 if record['sphereReverseU'] else 1;r=_number(record['sphereRadius'])
        return c+r*n*math.sin(v)+r*math.cos(v)*(p*math.cos(u)+sign*np.cross(n,p)*math.sin(u))
    if kind==3:
        n=_vector(record['cylinderAxis'],3);p=_vector(record['cylinderOrigin'],3)
        return (_vector(record['cylinderCenter'],3)+_number(record['cylinderRadius'])*(p*math.cos(u)+np.cross(n,p)*math.sin(u))
                +v*_number(record['cylinderVFactor'])*n)
    if kind==4:
        n=_vector(record['coneAxis'],3);p=_vector(record['coneMajor'],3);angle=u-_number(record['conePhase'])
        ellipse=p*math.cos(angle)+_number(record['coneRatio'])*np.cross(n,p)*math.sin(angle)
        dv=v-_number(record['coneVParam'])
        return _vector(record['coneCenter'],3)+ellipse*(1+_number(record['coneVFactor'])*dv)+_number(record['coneAxisVFactor'])*dv*n
    if kind==6:
        from scipy.interpolate import BSpline
        degree=record['degree'];shape=record['shape'];rational=record['rational']
        if (not isinstance(degree,list) or not isinstance(shape,list) or len(degree)!=2 or len(shape)!=2
                or any(type(n) is not int or not 1<=n<=25 for n in degree)
                or any(type(n) is not int or not 2<=n<=512 for n in shape)
                or shape[0]*shape[1]>MAX_POLES or any(n<=d for n,d in zip(shape,degree))):raise ValueError('Invalid NURBS surface allocation')
        if rational not in ([False,False],[True,True]) or any(type(x) is not bool for x in rational):raise ValueError('Source NURBS uses full tensor rational flags')
        nu,nv=shape;uk=_standard_knots(record['uKnots'],degree[0],nu);vk=_standard_knots(record['vKnots'],degree[1],nv)
        poles=record['polesUFast']
        if len(poles)!=nu*nv:raise ValueError('U-fast surface pole count differs')
        p=np.array([_vector(x,3) for x in poles]).reshape(nv,nu,3)
        w=_vector(record['weights'],nu*nv).reshape(nv,nu) if rational[0] else np.ones((nv,nu))
        if (not rational[0] and record['weights']!=[]) or np.any(w<=0):raise ValueError('Invalid surface weights')
        _check_knot_parameter(u,uk,degree[0]);_check_knot_parameter(v,vk,degree[1])
        bu=BSpline(uk,np.eye(nu),degree[0])(u);bv=BSpline(vk,np.eye(nv),degree[1])(v)
        result=np.einsum('i,j,ji,jik->k',bu,bv,w,p)/np.einsum('i,j,ji->',bu,bv,w)
        if not np.isfinite(result).all():raise ValueError('Surface evaluation outside NURBS domain')
        return result
    raise ValueError('Unsupported surface math type')


def _error(a,b):
    value=math.dist(a,b)
    if not math.isfinite(value) or value>MATH_LIMIT:raise ValueError(f'Source/SDK mathematical sample mismatch: {value}')
    return value


def _preflight_payload(payload,include3d=False):
    """Count bounded containers before any knot expansion or sample math."""
    faces=payload.get('faces');count=payload.get('faceCount')
    if type(count) is not int or not 1<=count<=MAX_FACES or not isinstance(faces,list) or len(faces)!=count:
        raise ValueError('Invalid payload face count')
    budget={'poles':0};coedges=0
    def curve(record):
        if not isinstance(record,dict):raise ValueError('Invalid curve record')
        if record.get('type')==4:
            poles=record.get('poles');degree=record.get('degree')
            if not isinstance(poles,list) or type(degree) is not int or not 1<=degree<=25 or not degree<len(poles)<=MAX_POLES:
                raise ValueError('Invalid bounded curve allocation')
            _reserve_poles(budget,len(poles))
    for face in faces:
        if not isinstance(face,dict):raise ValueError('Invalid face record')
        if face.get('type')==6:
            poles=face.get('polesUFast');shape=face.get('shape')
            if (not isinstance(poles,list) or not isinstance(shape,list) or len(shape)!=2
                    or any(type(n) is not int or not 2<=n<=512 for n in shape)
                    or shape[0]*shape[1]!=len(poles) or len(poles)>MAX_POLES):
                raise ValueError('Invalid NURBS surface allocation')
            _reserve_poles(budget,len(poles))
        loops=face.get('loops')
        if not isinstance(loops,list) or not 1<=len(loops)<=64:raise ValueError('Invalid source loop count')
        for loop in loops:
            if not isinstance(loop,dict) or not isinstance(loop.get('coedges'),list) or not loop['coedges']:
                raise ValueError('Invalid source loop')
            coedges+=len(loop['coedges'])
            if coedges>MAX_COEDGES:raise ValueError('Payload coedge budget exceeded before sample math')
            for c in loop['coedges']:
                if not isinstance(c,dict):raise ValueError('Invalid source coedge')
                curve(c.get('curve2d'))
                if include3d and c.get('curve3d') is not None:curve(c['curve3d'])
    edges=payload.get('sourceEdges')
    if not isinstance(edges,list) or not 1<=len(edges)<=MAX_COEDGES:raise ValueError('Invalid source edge inventory')
    if include3d:
        for edge in edges:
            if edge.get('curve3d') is not None:curve(edge['curve3d'])
    return budget['poles']


def _preflight_source(maps):
    from OCP.BRepAdaptor import BRepAdaptor_Surface,BRepAdaptor_Curve2d
    from OCP.BRepTools import BRepTools_WireExplorer
    from OCP.GeomAbs import GeomAbs_BSplineSurface,GeomAbs_BSplineCurve,GeomAbs_Hyperbola
    from OCP.Geom2d import Geom2d_TrimmedCurve
    from OCP.Geom2dConvert import Geom2dConvert
    from OCP.TopAbs import TopAbs_WIRE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    budget={'poles':0};coedges=0
    for fi in range(maps['faces'].Extent()):
        face=TopoDS.Face_s(maps['faces'].FindKey(fi+1));surface=BRepAdaptor_Surface(face,False)
        if surface.GetType()==GeomAbs_BSplineSurface:
            nu,nv,_=_surface_counts(surface.BSpline());_reserve_poles(budget,nu*nv)
        ex=TopExp_Explorer(face,TopAbs_WIRE);wires=0
        while ex.More():
            wires+=1
            if wires>64:raise ValueError('Source wire count exceeds budget before extraction')
            walk=BRepTools_WireExplorer(TopoDS.Wire_s(ex.Current()),face)
            while walk.More():
                coedges+=1
                if coedges>MAX_COEDGES:raise ValueError('Source coedge budget exceeded before extraction')
                pc=BRepAdaptor_Curve2d(TopoDS.Edge_s(walk.Current()),face);kind=pc.GetType()
                if kind==GeomAbs_BSplineCurve:bs=pc.BSpline()
                elif kind==GeomAbs_Hyperbola:
                    bs=Geom2dConvert.CurveToBSplineCurve_s(Geom2d_TrimmedCurve(pc.Curve(),pc.FirstParameter(),pc.LastParameter()))
                else:bs=None
                if bs is not None:
                    n,_=_curve_counts(bs);_reserve_poles(budget,n)
                walk.Next()
            ex.Next()


def _validate_vertices(payload):
    count=payload.get('sourceVertexCount');inventory={}
    if type(count) is not int or not 1<=count<=2*MAX_COEDGES:raise ValueError('Invalid source vertex inventory count')
    for edge in payload['sourceEdges']:
        vertices=edge.get('vertices')
        if not isinstance(vertices,list) or len(vertices)!=2:raise ValueError('Missing source endpoint vertices')
        for index,vertex in enumerate(vertices):
            if (not isinstance(vertex,dict) or vertex.get('available') is not True
                    or vertex.get('atEndRaw') is not bool(index)):
                raise ValueError('Invalid source endpoint vertex availability/orientation')
            vid=vertex.get('nativeVertexId')
            if type(vid) is not int or not 0<=vid<count:raise ValueError('Source vertex ID outside inventory')
            point=_vector(vertex.get('point'),3);tol=_number(vertex.get('sourceVertexToleranceMm'))
            if not 0<=tol<=1.:raise ValueError('Invalid source vertex tolerance')
            previous=inventory.setdefault(vid,vertex)
            if previous!=vertex and (previous['point']!=vertex['point'] or previous['sourceVertexToleranceMm']!=tol):
                raise ValueError('Source vertex ID has inconsistent coordinates/tolerance')
            observations=edge.get('sourceCurve3dSamples',[])
            if observations:
                p=_vector(observations[0 if index==0 else -1]['point'],3)
                # This binds input topology to its declared SOURCE tolerance only.
                # It does not authorize any native/output precision waiver.
                if math.dist(point,p)>tol+MATH_LIMIT:raise ValueError('Source endpoint differs from its source vertex tolerance')
    if set(inventory)!=set(range(count)):raise ValueError('Incomplete global source vertex inventory')
    for face in payload['faces']:
        for loop in face['loops']:
            travel=[]
            for c in loop['coedges']:
                edge=payload['sourceEdges'][c['sourceEdgeId']]
                if c.get('vertices')!=edge['vertices']:raise ValueError('Coedge source endpoint vertices differ')
                vertices=edge['vertices'][::-1] if c['edgeSenseRaw'] else edge['vertices']
                for vertex,sample in zip(vertices,(c['onSurfaceSourceSamples'][0],c['onSurfaceSourceSamples'][-1])):
                    if math.dist(vertex['point'],sample['point'])>vertex['sourceVertexToleranceMm']+MATH_LIMIT:
                        raise ValueError('Source trim endpoint differs from its source vertex tolerance')
                travel.append([v['nativeVertexId'] for v in vertices])
            if any(ids[1]!=travel[(i+1)%len(travel)][0] for i,ids in enumerate(travel)):
                raise ValueError('Source wire is not a directed vertex-ID cycle')


def validate_source_topology(shape,payload):
    """Bind payload identities/order and observations to actual caller BRep."""
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Curve,BRepAdaptor_Curve2d
    from OCP.BRepTools import BRepTools,BRepTools_WireExplorer
    from OCP.TopAbs import TopAbs_FACE,TopAbs_EDGE,TopAbs_VERTEX,TopAbs_WIRE,TopAbs_FORWARD,TopAbs_REVERSED
    from OCP.TopExp import TopExp,TopExp_Explorer
    from OCP.TopTools import TopTools_IndexedMapOfShape
    from OCP.TopoDS import TopoDS
    wrapped=getattr(shape,'wrapped',shape);maps={}
    for name,kind in [('faces',TopAbs_FACE),('edges',TopAbs_EDGE),('vertices',TopAbs_VERTEX)]:
        maps[name]=TopTools_IndexedMapOfShape();TopExp.MapShapes_s(wrapped,kind,maps[name])
    if (maps['faces'].Extent()!=len(payload['faces']) or maps['edges'].Extent()!=len(payload['sourceEdges'])
            or maps['vertices'].Extent()!=payload['sourceVertexCount']):raise ValueError('Actual source topology inventory differs')
    for row in payload['sourceEdges']:
        edge=TopoDS.Edge_s(maps['edges'].FindKey(row['sourceEdgeId']+1));forward=TopoDS.Edge_s(edge.Oriented(TopAbs_FORWARD))
        if (bool(BRep_Tool.Degenerated_s(edge))!=row['degenerated3dEdge']
                or float(BRep_Tool.Tolerance_s(edge))!=row['sourceEdgeToleranceMm']
                or bool(BRep_Tool.SameParameter_s(edge)) is not row.get('sameParameter')
                or bool(BRep_Tool.SameRange_s(edge)) is not row.get('sameRange')):
            raise ValueError('Actual source edge identity/tolerance/flags differ')
        for record,v in zip(row['vertices'],(TopExp.FirstVertex_s(forward),TopExp.LastVertex_s(forward))):
            if (v.IsNull() or record['nativeVertexId']!=maps['vertices'].FindIndex(v)-1
                    or record['sourceVertexToleranceMm']!=float(BRep_Tool.Tolerance_s(v))):
                raise ValueError('Actual TopoDS endpoint vertex identity/tolerance differs')
            _error(_xyz(BRep_Tool.Pnt_s(v)),record['point'])
        if not row['degenerated3dEdge']:
            adaptor=BRepAdaptor_Curve(forward)
            if row['edgeRange']!=[float(adaptor.FirstParameter()),float(adaptor.LastParameter())]:
                raise ValueError('Actual source edge range differs')
            for sample in row['sourceCurve3dSamples']:_error(_xyz(adaptor.Value(sample['parameter'])),sample['point'])
    for fi,record in enumerate(payload['faces']):
        face=TopoDS.Face_s(maps['faces'].FindKey(fi+1));wires=[];explorer=TopExp_Explorer(face,TopAbs_WIRE)
        if (face.Orientation()==TopAbs_FORWARD) is not record['normalSense']:raise ValueError('Actual source face orientation differs')
        while explorer.More():wires.append(TopoDS.Wire_s(explorer.Current()));explorer.Next()
        ordered=sorted(enumerate(wires),key=lambda pair:not pair[1].IsSame(BRepTools.OuterWire_s(face)))
        if len(ordered)!=len(record['loops']):raise ValueError('Actual source wire count differs')
        for loop,(wi,wire) in zip(record['loops'],ordered):
            if loop.get('sourceWireIndex')!=wi or loop.get('isOuter') is not wire.IsSame(BRepTools.OuterWire_s(face)):
                raise ValueError('Actual source wire identity/order differs')
            walk=BRepTools_WireExplorer(wire,face)
            for c in loop['coedges']:
                if not walk.More():raise ValueError('Actual source wire is shorter')
                edge=TopoDS.Edge_s(walk.Current());reverse=edge.Orientation()==TopAbs_REVERSED
                if maps['edges'].FindIndex(edge)-1!=c['sourceEdgeId'] or reverse is not c['edgeSenseRaw'] or c.get('loopSense') is not True:
                    raise ValueError('Actual source wire/coedge order or orientation differs')
                pc=BRepAdaptor_Curve2d(edge,face)
                expected=[float(pc.LastParameter() if reverse else pc.FirstParameter()),float(pc.FirstParameter() if reverse else pc.LastParameter())]
                if c['sourcePCurveRange']!=expected:raise ValueError('Actual source pcurve finite range differs')
                for sample in c['onSurfaceSourceSamples']:
                    st=source_curve_parameter(c['curve2d'],sample['parameter'])
                    _error(_xy(pc.Value(st)),sample['uv'])
                walk.Next()
            if walk.More():raise ValueError('Actual source wire is longer')


def build_payload(shape,source_sha256=None):
    """Extract one caller-owned solid, preserving its BRep serialization.

    IDs use TopTools_IndexedMapOfShape/IsSame (orientation ignored, location
    retained), NEVER coordinate equivalencing. Samples are untrimmed source
    math or actual source pcurve observations, not SDK/native observations.
    """
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Surface,BRepAdaptor_Curve,BRepAdaptor_Curve2d
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.BRepTools import BRepTools,BRepTools_WireExplorer
    from OCP.TopAbs import TopAbs_FACE,TopAbs_EDGE,TopAbs_VERTEX,TopAbs_WIRE,TopAbs_FORWARD,TopAbs_REVERSED,TopAbs_SOLID
    from OCP.TopExp import TopExp,TopExp_Explorer
    from OCP.TopTools import TopTools_IndexedMapOfShape
    from OCP.TopoDS import TopoDS
    wrapped=getattr(shape,'wrapped',shape)
    parent=getattr(shape,'parent',None)
    while parent is not None:
        transform=parent.location.wrapped.Transformation()
        if any(transform.Value(i,j)!=(1. if i==j else 0.) for i in range(1,4) for j in range(1,5)):
            raise ValueError('Nonidentity ancestor placement is unsupported')
        parent=parent.parent
    maps={}
    for name,kind in [('faces',TopAbs_FACE),('edges',TopAbs_EDGE),('vertices',TopAbs_VERTEX),('solids',TopAbs_SOLID)]:
        maps[name]=TopTools_IndexedMapOfShape();TopExp.MapShapes_s(wrapped,kind,maps[name])
    if maps['solids'].Extent()!=1 or not BRepCheck_Analyzer(wrapped).IsValid():raise ValueError('Payload requires one valid source solid')
    if not 1<=maps['faces'].Extent()<=MAX_FACES or maps['edges'].Extent()>MAX_COEDGES:raise ValueError('Source topology budget exceeded')
    _preflight_source(maps);before=_brep_sha(wrapped)
    owners=defaultdict(list);edge_records={};faces=[];coedge_id=0;max_math=0.;max_source_edge=0.;max_endpoint=0.;budget={'poles':0}
    for fi in range(maps['faces'].Extent()):
        face=TopoDS.Face_s(maps['faces'].FindKey(fi+1));surface=BRepAdaptor_Surface(face,False)
        if face.Orientation() not in (TopAbs_FORWARD,TopAbs_REVERSED):raise ValueError('Unsupported face orientation')
        uv=list(map(float,BRepTools.UVBounds_s(face)))
        if not all(math.isfinite(x) and abs(x)<1e12 for x in uv) or not uv[0]<uv[1] or not uv[2]<uv[3]:raise ValueError('Unbounded source UV rectangle')
        record=dict(index=fi,nativeFaceId=fi,sourceFaceId=fi,component=getattr(shape,'label','') or 'source-solid',
            uv=uv,normalSense=face.Orientation()==TopAbs_FORWARD,**_surface_record(surface,budget))
        if record['type']==6:
            record['sourceTrimParameterExcursions']=[max(record['uKnots'][0]-uv[0],0.),max(uv[1]-record['uKnots'][-1],0.),
                max(record['vKnots'][0]-uv[2],0.),max(uv[3]-record['vKnots'][-1],0.)]
            record['parameterPolicy']='Stored OCP trim parameters preserved; endpoint polynomial spans evaluated without clamping'
            pcuv=_pcurve_uv_bounds(face);record['sourcePCurveUVBounds']=pcuv
            coverage=[min(uv[0],pcuv[0]),max(uv[1],pcuv[1]),uv[2],uv[3]]
            _extend_u_support(record,coverage,surface)
        midpoint=surface.Value((uv[0]+uv[1])/2,(uv[2]+uv[3])/2);record['untrimmedMidpoint']=_xyz(midpoint)
        samples=[]
        for fu in (.125,.5,.875):
            for fv in (.125,.5,.875):
                u=uv[0]+(uv[1]-uv[0])*fu;v=uv[2]+(uv[3]-uv[2])*fv;p=_xyz(surface.Value(u,v))
                max_math=max(max_math,_error(evaluate_surface(record,u,v),p));samples.append(dict(uv=[u,v],point=p))
        record['sourceSamples']=samples;wires=[];explorer=TopExp_Explorer(face,TopAbs_WIRE)
        while explorer.More():wires.append(TopoDS.Wire_s(explorer.Current()));explorer.Next()
        outer=BRepTools.OuterWire_s(face)
        ordered=sorted(enumerate(wires),key=lambda x:not x[1].IsSame(outer));loops=[]
        for wi,(source_wi,wire) in enumerate(ordered):
            walk=BRepTools_WireExplorer(wire,face);coedges=[]
            while walk.More():
                if coedge_id>=MAX_COEDGES:raise ValueError('Coedge budget exceeded before extraction')
                edge=TopoDS.Edge_s(walk.Current());eid=maps['edges'].FindIndex(edge)-1
                if edge.Orientation() not in (TopAbs_FORWARD,TopAbs_REVERSED):raise ValueError('Unsupported coedge orientation')
                reverse=edge.Orientation()==TopAbs_REVERSED;pc=BRepAdaptor_Curve2d(edge,face)
                curve,a,b=_curve_record(pc,budget)
                if reverse:a,b=b,a
                degenerate=bool(BRep_Tool.Degenerated_s(edge));forward=TopoDS.Edge_s(edge.Oriented(TopAbs_FORWARD))
                if eid not in edge_records:
                    er=dict(nativeEdgeId=eid,sourceEdgeId=eid,degenerate=degenerate,
                        degenerated3dEdge=degenerate,
                        sourceEdgeToleranceMm=float(BRep_Tool.Tolerance_s(edge)),
                        sameParameter=bool(BRep_Tool.SameParameter_s(edge)),sameRange=bool(BRep_Tool.SameRange_s(edge)))
                    vertices=[]
                    for end,vertex in [(False,TopExp.FirstVertex_s(forward)),(True,TopExp.LastVertex_s(forward))]:
                        available=not vertex.IsNull()
                        vertices.append(dict(nativeVertexId=maps['vertices'].FindIndex(vertex)-1 if available else -1,
                            atEndRaw=end,available=available,point=_xyz(BRep_Tool.Pnt_s(vertex)) if available else None,
                            sourceVertexToleranceMm=float(BRep_Tool.Tolerance_s(vertex)) if available else None))
                    er['vertices']=vertices
                    if not degenerate:
                        c3=BRepAdaptor_Curve(forward);lo,hi=c3.FirstParameter(),c3.LastParameter()
                        er.update(edgeRange=[float(lo),float(hi)],sourceCurve3dType=str(c3.GetType()),
                            sourceCurve3dSamples=[dict(parameter=float(lo if i==0 else hi if i==6 else lo+(hi-lo)*i/6),
                                point=_xyz(c3.Value(lo if i==0 else hi if i==6 else lo+(hi-lo)*i/6))) for i in range(7)])
                    else:er.update(edgeRange=[float(pc.FirstParameter()),float(pc.LastParameter())],sourceCurve3dType=None,sourceCurve3dSamples=[])
                    edge_records[eid]=er
                er=edge_records[eid]
                row=dict(nativeEdgeId=eid,sourceEdgeId=eid,sourceCoedgeId=coedge_id,loopSense=True,edgeSenseRaw=reverse,
                    coedgeRange=[float(a),float(b)],edgeRange=er['edgeRange'],curve2d=curve,vertices=er['vertices'],
                    sourcePCurveRange=[float(pc.LastParameter() if reverse else pc.FirstParameter()),float(pc.FirstParameter() if reverse else pc.LastParameter())],
                    degenerate=degenerate,seam=bool(BRep_Tool.IsClosed_s(edge,face)),edgeGeometryAvailable=not degenerate)
                row['degenerated3dEdge']=degenerate
                row['sourceEdgeToleranceMm']=er['sourceEdgeToleranceMm']
                row['source3dSamples']=er['sourceCurve3dSamples']
                row['source3dSamplesOrigin']='source-OCP BRepAdaptor_Curve on canonical forward source TopoDS edge'
                row['source3dParameterRange']=er['edgeRange']
                row['sourceOriginalParamRange']=row['sourcePCurveRange']
                observations=[]
                for i in range(7):
                    t=a if i==0 else b if i==6 else a+(b-a)*i/6
                    q=evaluate_curve(curve,t);st=source_curve_parameter(curve,t);expected=_xy(pc.Value(st))
                    max_math=max(max_math,_error(q,expected));p=_xyz(surface.Value(expected[0],expected[1]))
                    max_math=max(max_math,_error(evaluate_surface(record,q[0],q[1]),p))
                    observation=dict(parameter=float(t),available=True,uv=q.tolist(),point=p,sourceParameter=st)
                    if not degenerate and er['sameParameter']:
                        cp=_xyz(BRepAdaptor_Curve(forward).Value(st));observation['sourceCurve3dPoint']=cp
                        max_source_edge=max(max_source_edge,math.dist(cp,p))
                    observations.append(observation)
                row['onSurfaceSourceSamples']=observations
                row['sourceWorldSampleSpan']=max(math.dist(a['point'],b['point']) for a in observations for b in observations)
                if degenerate and row['sourceWorldSampleSpan']>MATH_LIMIT:raise ValueError('Source degenerate edge has nonzero world span')
                canonical=er['vertices'][1 if reverse else 0]
                if canonical['available']:max_endpoint=max(max_endpoint,math.dist(observations[0]['point'],canonical['point']))
                owners[eid].append(dict(faceIndex=fi,loopIndex=wi,coedgeIndex=len(coedges),sourceCoedgeId=coedge_id,reversed=reverse))
                coedges.append(row);coedge_id+=1
                if coedge_id>MAX_COEDGES:raise ValueError('Coedge budget exceeded')
                walk.Next()
            if not coedges:raise ValueError('Empty source wire')
            loops.append(dict(index=wi,sourceWireIndex=source_wi,isOuter=wire.IsSame(outer),coedges=coedges))
        record.update(loops=loops,loopCaptureComplete=True);faces.append(record)
    edges=[]
    for eid in range(maps['edges'].Extent()):
        er=edge_records.get(eid)
        if er is None:raise ValueError('Source edge missing from face wires')
        uses=owners[eid]
        if (er['degenerate'] and len(uses)!=1) or (not er['degenerate'] and (len(uses)!=2 or uses[0]['reversed']==uses[1]['reversed'])):
            raise ValueError('Nonmanifold or inconsistently oriented source edge identity')
        edges.append(dict(er,owners=uses))
    if _brep_sha(wrapped)!=before:raise ValueError('Source BRep changed during extraction')
    payload=dict(schemaVersion=1,origin='source-OCP',dataOrigin='source-OCP',idNamespace='source-TopoDS-IsSame-zero-based',
        purpose='exact-math-direct-native-construction-input',components=1,faceCount=len(faces),faces=faces,sourceEdges=edges,
        complete=True,sourceStepSHA256=source_sha256,sourceBrepSHA256=before,sourceBrepUnmodified=True,
        sourceVertexCount=maps['vertices'].Extent(),sourceEdgeCount=len(edges),sourceCoedgeCount=coedge_id,
        sourceTolerancePolicy='actual source TopoDS identity tolerances only; not a native or final acceptance waiver',
        sourceMathMaximumSampleError=max_math,sourceSameParameterCurveDiscrepancy=max_source_edge,
        sourceMaximumEndpointDiscrepancy=max_endpoint,coordinateWeldingPerformed=False,nativeHostVerified=False,
        limitations=['Source samples are OCP observations, not native SDK capture',
            'Exact conic conversion may change pcurve parameterization; explicit source maps are retained',
            'Source edge coherence is reported separately; payload extraction is not native stitching acceptance'])
    validate_payload(payload)
    return payload


def validate_payload(payload):
    """Bounded schema, identity ownership and independent mathematical checks."""
    if (not isinstance(payload,dict) or payload.get('origin')!='source-OCP' or payload.get('dataOrigin')!='source-OCP'
            or payload.get('idNamespace')!='source-TopoDS-IsSame-zero-based' or payload.get('complete') is not True):
        raise ValueError('Require completed source-OCP payload with explicit source identity namespace')
    faces=payload.get('faces');count=payload.get('faceCount')
    if type(count) is not int or not 1<=count<=MAX_FACES or not isinstance(faces,list) or len(faces)!=count:raise ValueError('Invalid payload face count')
    total_poles=_preflight_payload(payload);uses=defaultdict(list);seen_coedges=set();max_error=0.
    for fi,f in enumerate(faces):
        if f.get('index')!=fi or f.get('nativeFaceId')!=fi or f.get('sourceFaceId')!=fi or type(f.get('normalSense')) is not bool or 'nativeSamples' in f:raise ValueError('Invalid source face identity/provenance')
        uv=_vector(f.get('uv'),4)
        if not uv[0]<uv[1] or not uv[2]<uv[3]:raise ValueError('Invalid face UV rectangle')
        max_error=max(max_error,_error(evaluate_surface(f,(uv[0]+uv[1])/2,(uv[2]+uv[3])/2),_vector(f['untrimmedMidpoint'],3)))
        samples=f.get('sourceSamples')
        if not isinstance(samples,list) or len(samples)!=9:raise ValueError('Require 3x3 source surface samples')
        for sample_index,s in enumerate(samples):
            u,v=_vector(s['uv'],2);max_error=max(max_error,_error(evaluate_surface(f,u,v),_vector(s['point'],3)))
            fu=(.125,.5,.875)[sample_index//3];fv=(.125,.5,.875)[sample_index%3]
            if max(abs(u-(uv[0]+(uv[1]-uv[0])*fu)),abs(v-(uv[2]+(uv[3]-uv[2])*fv)))>1e-12:
                raise ValueError('Source surface samples are not the complete 3x3 parameter grid')
        extension=f.get('exactSupportExtension')
        if extension is not None:
            if (extension.get('fittingPerformed') is not False or extension.get('originalGlobalParameterizationPreserved') is not True
                    or not 0<=_number(extension['maximumSourceOCPAgreementError'])<=MATH_LIMIT):
                raise ValueError('Invalid exact support-extension evidence')
        loops=f.get('loops')
        if not isinstance(loops,list) or not 1<=len(loops)<=64 or loops[0].get('isOuter') is not True:raise ValueError('Require source outer loop first')
        for wi,w in enumerate(loops):
            if w.get('index')!=wi or not isinstance(w.get('coedges'),list) or not w['coedges']:raise ValueError('Invalid source loop')
            for ci,c in enumerate(w['coedges']):
                eid=c.get('nativeEdgeId');cid=c.get('sourceCoedgeId')
                if type(eid) is not int or eid<0 or c.get('sourceEdgeId')!=eid or type(cid) is not int or cid in seen_coedges:raise ValueError('Invalid source coedge identity')
                if 'onSurfaceSamples' in c or type(c.get('edgeSenseRaw')) is not bool or c.get('loopSense') is not True:raise ValueError('Invalid source coedge provenance/direction')
                if type(c.get('degenerated3dEdge')) is not bool or c.get('degenerate') is not c['degenerated3dEdge']:
                    raise ValueError('Missing or inconsistent authoritative source degenerate flag')
                seen_coedges.add(cid);uses[eid].append(dict(faceIndex=fi,loopIndex=wi,coedgeIndex=ci,sourceCoedgeId=cid,reversed=c['edgeSenseRaw']))
                a,b=_vector(c['coedgeRange'],2)
                if a==b:raise ValueError('Empty coedge parameter range')
                curve=c['curve2d']
                conversion=curve.get('exactLocusConversion')
                source_range=_vector(c.get('sourcePCurveRange'),2)
                if c.get('sourceOriginalParamRange')!=c.get('sourcePCurveRange') or source_range[0]==source_range[1]:
                    raise ValueError('Invalid original source pcurve finite range')
                if conversion is not None:
                    if (conversion.get('fittingPerformed') is not False
                            or any(not 0<=_number(conversion[k])<=MATH_LIMIT for k in
                                   ('sourceToConvertedMaximumDistance','convertedToSourceMaximumDistance'))):
                        raise ValueError('Invalid exact source conic conversion witnesses')
                    original=_vector(conversion.get('sourceOriginalParamRange'),2)
                    if not original[0]<original[1] or max(abs(original-np.sort(source_range)))>1e-12:
                        raise ValueError('Exact conic original finite range differs')
                elif curve.get('sourceParameterMap') is not None:
                    raise ValueError('Source parameter map lacks exact conic conversion evidence')
                obs=c.get('onSurfaceSourceSamples')
                if not isinstance(obs,list) or len(obs)!=7:raise ValueError('Require seven actual source coedge samples')
                for i,s in enumerate(obs):
                    t=_number(s['parameter'])
                    if abs(t-(a+(b-a)*i/6))>1e-10:raise ValueError('Unexpected coedge sample parameter')
                    st=source_curve_parameter(curve,t)
                    if (abs(st-_number(s.get('sourceParameter')))>MATH_LIMIT
                            or not min(source_range)-1e-12<=st<=max(source_range)+1e-12):
                        raise ValueError('Source parameter map differs from frozen source observations/range')
                    if i in (0,6) and abs(st-source_range[0 if i==0 else 1])>MATH_LIMIT:
                        raise ValueError('Source parameter map changed original finite endpoints')
                    q=evaluate_curve(curve,t);max_error=max(max_error,_error(q,_vector(s['uv'],3)))
                    max_error=max(max_error,_error(evaluate_surface(f,q[0],q[1]),_vector(s['point'],3)))
                if c['degenerated3dEdge'] and max(math.dist(x['point'],y['point']) for x in obs for y in obs)>MATH_LIMIT:
                    raise ValueError('A source pole flag does not authorize a nonzero world edge')
    if total_poles>MAX_TOTAL_POLES or len(seen_coedges)>MAX_COEDGES:raise ValueError('Payload pole/sample budget exceeded')
    edges=payload.get('sourceEdges')
    if not isinstance(edges,list) or not edges or len(edges)>MAX_COEDGES or set(uses)!=set(range(len(edges))):raise ValueError('Incomplete source edge identity inventory')
    for eid,e in enumerate(edges):
        if e.get('sourceEdgeId')!=eid or e.get('nativeEdgeId')!=eid or e.get('owners')!=uses[eid] or type(e.get('degenerate')) is not bool or e.get('degenerated3dEdge') is not e['degenerate']:
            raise ValueError('Source edge ownership links differ')
        if (e['degenerate'] and len(uses[eid])!=1) or (not e['degenerate'] and (len(uses[eid])!=2 or uses[eid][0]['reversed']==uses[eid][1]['reversed'])):
            raise ValueError('Invalid source edge owner multiplicity/orientation')
        for owner in uses[eid]:
            c=faces[owner['faceIndex']]['loops'][owner['loopIndex']]['coedges'][owner['coedgeIndex']]
            if c['degenerated3dEdge'] is not e['degenerate']:raise ValueError('Coedge source pole flag differs from its actual edge')
            if not 0<=_number(e['sourceEdgeToleranceMm'])<=1. or c.get('sourceEdgeToleranceMm')!=e['sourceEdgeToleranceMm']:
                raise ValueError('Missing or inconsistent source topology edge tolerance')
            if (c.get('source3dSamples')!=e.get('sourceCurve3dSamples')
                    or c.get('source3dSamplesOrigin')!='source-OCP BRepAdaptor_Curve on canonical forward source TopoDS edge'
                    or c.get('source3dParameterRange')!=e.get('edgeRange')):
                raise ValueError('Coedge canonical source 3D observations differ from actual edge record')
        observations=e.get('sourceCurve3dSamples')
        if not isinstance(observations,list) or len(observations)!=(0 if e['degenerate'] else 7):
            raise ValueError('Require seven canonical source 3D samples or an explicit degenerate pole')
        if observations:
            lo,hi=_vector(e['edgeRange'],2)
            if not lo<hi:raise ValueError('Invalid canonical source 3D parameter range')
            for i,sample in enumerate(observations):
                expected=lo if i==0 else hi if i==6 else lo+(hi-lo)*i/6
                if abs(_number(sample['parameter'])-expected)>1e-12:raise ValueError('Incomplete canonical source 3D parameter samples')
                _vector(sample['point'],3)
    if (payload.get('sourceEdgeCount')!=len(edges) or payload.get('sourceCoedgeCount')!=len(seen_coedges)
            or seen_coedges!=set(range(len(seen_coedges)))):
        raise ValueError('Source topology totals differ from actual identity links')
    _validate_vertices(payload)
    return dict(faceCount=count,edgeCount=len(edges),coedges=len(seen_coedges),controlPoles=total_poles,maximumMathSampleError=max_error)


def extract_payload(source,output):
    """Read STEP, extract exact source math, validate, then exclusively publish JSON."""
    from build123d import import_step
    source=Path(source).resolve();output=Path(output).absolute();output=output.parent.resolve()/output.name
    if not source.is_file() or not 0<source.stat().st_size<=MAX_BYTES:raise ValueError('Source STEP budget is 16 MiB')
    if not output.parent.is_dir() or os.path.lexists(output):raise ValueError('Require a new payload path with existing parent')
    before=_sha(source);shape=import_step(source);payload=build_payload(shape,before)
    payload['sourceFileUnmodified']=_sha(source)==before
    if not payload['sourceFileUnmodified']:raise ValueError('Source STEP changed during extraction')
    raw=(json.dumps(payload,indent=2,allow_nan=False)+'\n').encode('utf8')
    if len(raw)>MAX_BYTES:raise ValueError('Source payload exceeds 16 MiB')
    with output.open('xb') as stream:stream.write(raw)
    return payload


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args(argv);p=extract_payload(args.source,args.output)
    print(json.dumps(dict(validate_payload(p),origin=p['origin'],sourceStepSHA256=p['sourceStepSHA256'],
        sourceBrepUnmodified=p['sourceBrepUnmodified'],sourceSameParameterCurveDiscrepancy=p['sourceSameParameterCurveDiscrepancy'])))
    return 0


if __name__=='__main__':raise SystemExit(main())
