"""Canonical source-3D curve extension of the frozen source-OCP 2D payload.

No pcurve, surface, source identity, tolerance or original sample is changed.
Finite hyperbolas use an exact rational locus conversion and explicit parameter
remap. Degenerate poles have no constructed 3D curve; their faces retain the
frozen 2D construction path. This is input data, not native-CAD acceptance.
"""
import argparse
from collections import Counter
import copy
import hashlib
import json
import math
import os
from pathlib import Path

import numpy as np

from . import cad_native_payload as base

MAX_BYTES=16*1024*1024
MATH_LIMIT=1e-10
SAMPLE_ORIGIN='source-OCP BRepAdaptor_Curve evaluated at sourceParameter; not native SDK capture'


def _samples(adaptor,record,a,b):
    rows=[]
    for i in range(7):
        t=a if i==0 else b if i==6 else a+(b-a)*i/6
        s=base.source_curve_parameter(record,t);p=base._xyz(adaptor.Value(s))
        error=base._error(base.evaluate_curve(record,t),p)
        rows.append(dict(parameter=float(t),sourceParameter=float(s),point=p,sourceMathError=error))
    return rows


def _nurbs_record(bs,budget=None,copies=1):
    n=bs.NbPoles();degree=bs.Degree()
    if bs.IsPeriodic() or not 1<=degree<=25 or not degree<n<=base.MAX_POLES:
        raise ValueError('Unsupported periodic/oversized canonical source 3D NURBS')
    base._reserve_poles(budget,n*copies)
    return dict(type=4,degree=degree,rational=bool(bs.IsRational()),knots=base._knots(bs),
        poles=[base._xyz(bs.Pole(i)) for i in range(1,n+1)],
        weights=[float(bs.Weight(i)) for i in range(1,n+1)] if bs.IsRational() else [],supported=True)


def curve_record(adaptor,original_curve=None,budget=None,copies=1):
    """Return (exact SDK curve math, canonical payload first, last)."""
    from OCP.GeomAbs import GeomAbs_Line,GeomAbs_Circle,GeomAbs_Ellipse,GeomAbs_BSplineCurve,GeomAbs_Hyperbola
    kind=adaptor.GetType();first,last=float(adaptor.FirstParameter()),float(adaptor.LastParameter())
    if not math.isfinite(first) or not math.isfinite(last) or not -1e12<first<last<1e12:
        raise ValueError('Require a finite canonical source 3D edge range')
    if kind==GeomAbs_Line:
        return dict(type=1,start=base._xyz(adaptor.Value(0.)),end=base._xyz(adaptor.Value(1.)),supported=True),first,last
    if kind in (GeomAbs_Circle,GeomAbs_Ellipse):
        from OCP.gp import gp_Pnt,gp_Vec
        conic=adaptor.Circle() if kind==GeomAbs_Circle else adaptor.Ellipse()
        center=np.array(base._xyz(conic.Location()));radius=np.array(base._xyz(adaptor.Value(0.)))-center
        p=gp_Pnt();d=gp_Vec();adaptor.D1(0.,p,d)
        normal=np.cross(radius,np.array(base._xyz(d)));normal/=np.linalg.norm(normal)
        if kind==GeomAbs_Circle:return dict(type=2,center=center.tolist(),normal=normal.tolist(),radiusVector=radius.tolist(),supported=True),first,last
        return dict(type=3,center=center.tolist(),normal=normal.tolist(),majorAxis=radius.tolist(),
            ratio=float(conic.MinorRadius()/conic.MajorRadius()),phase=0.,supported=True),first,last
    if kind==GeomAbs_BSplineCurve:return _nurbs_record(adaptor.BSpline(),budget,copies),first,last
    if kind!=GeomAbs_Hyperbola or original_curve is None:
        raise ValueError('Unsupported canonical source 3D curve, no fitting: '+str(kind))
    from OCP.Geom import Geom_TrimmedCurve
    from OCP.GeomConvert import GeomConvert
    from OCP.GeomAPI import GeomAPI_ProjectPointOnCurve
    bs=GeomConvert.CurveToBSplineCurve_s(Geom_TrimmedCurve(original_curve,first,last))
    record=_nurbs_record(bs,budget,copies);hyperbola=adaptor.Hyperbola()
    record['sourceParameterMap']=dict(kind='hyperbola-asinh',center=base._xyz(hyperbola.Location()),
        yAxis=base._xyz(hyperbola.YAxis().Direction()),minorRadius=float(hyperbola.MinorRadius()))
    a,b=float(bs.FirstParameter()),float(bs.LastParameter());forward=[];reverse=[]
    for i in range(7):
        s=first if i==0 else last if i==6 else first+(last-first)*i/6
        p=adaptor.Value(s);projector=GeomAPI_ProjectPointOnCurve(p,bs,a,b)
        witnesses=[p.Distance(bs.Value(a)),p.Distance(bs.Value(b))]
        for j in range(1,projector.NbPoints()+1):witnesses.append(p.Distance(projector.Point(j)))
        if min(witnesses)>MATH_LIMIT:
            from scipy.optimize import brentq
            t=brentq(lambda t:base.source_curve_parameter(record,t)-s,a,b,xtol=1e-14,rtol=1e-14)
            witnesses.append(p.Distance(bs.Value(t)))
        forward.append(float(min(witnesses)))
        t=a if i==0 else b if i==6 else a+(b-a)*i/6
        p=bs.Value(t);s=base.source_curve_parameter(record,t)
        if not first-1e-12<=s<=last+1e-12:raise ValueError('Exact 3D conic witness escaped its original finite arc')
        witnesses=[p.Distance(adaptor.Value(min(max(s,first),last))),p.Distance(adaptor.Value(first)),p.Distance(adaptor.Value(last))]
        projector=GeomAPI_ProjectPointOnCurve(p,original_curve,first,last)
        for j in range(1,projector.NbPoints()+1):witnesses.append(p.Distance(projector.Point(j)))
        reverse.append(float(min(witnesses)))
    if max(forward+reverse)>MATH_LIMIT:raise ValueError('Exact finite 3D hyperbola locus witnesses exceed 1e-10')
    record['exactLocusConversion']=dict(method='GeomConvert.CurveToBSplineCurve(Geom_TrimmedCurve(original finite hyperbola))',
        sourceOriginalParamRange=[first,last],native3dParamRange=[a,b],
        sourceToConvertedMaximumDistance=max(forward),convertedToSourceMaximumDistance=max(reverse),
        witnessesPerDirection=7,fittingPerformed=False,
        distanceStatistic='finite source/converted curve witness upper bound; endpoints always included')
    return record,a,b


def _preflight_source_curves(shape,document):
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.GeomAbs import GeomAbs_BSplineCurve,GeomAbs_Hyperbola
    from OCP.Geom import Geom_TrimmedCurve
    from OCP.GeomConvert import GeomConvert
    from OCP.TopAbs import TopAbs_EDGE,TopAbs_FORWARD
    from OCP.TopExp import TopExp
    from OCP.TopTools import TopTools_IndexedMapOfShape
    from OCP.TopoDS import TopoDS
    budget={'poles':base._preflight_payload(document)};edges=TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(getattr(shape,'wrapped',shape),TopAbs_EDGE,edges)
    if edges.Extent()!=len(document['sourceEdges']):raise ValueError('Canonical source 3D edge inventory differs')
    for i,row in enumerate(document['sourceEdges']):
        if not isinstance(row,dict) or not isinstance(row.get('owners'),list) or not 1<=len(row['owners'])<=2:
            raise ValueError('Invalid canonical source owner inventory')
        edge=TopoDS.Edge_s(edges.FindKey(i+1));edge=TopoDS.Edge_s(edge.Oriented(TopAbs_FORWARD))
        if BRep_Tool.Degenerated_s(edge):continue
        adaptor=BRepAdaptor_Curve(edge);kind=adaptor.GetType()
        if kind==GeomAbs_BSplineCurve:bs=adaptor.BSpline()
        elif kind==GeomAbs_Hyperbola:
            original=BRep_Tool.Curve_s(edge,0.,0.)
            if original is None:raise ValueError('Canonical source 3D curve unavailable')
            bs=GeomConvert.CurveToBSplineCurve_s(Geom_TrimmedCurve(original,adaptor.FirstParameter(),adaptor.LastParameter()))
        else:bs=None
        if bs is not None:
            n,_=base._curve_counts(bs);base._reserve_poles(budget,n*(1+len(row['owners'])))


def extend_payload(shape,document):
    """Return a new document; do not modify the source shape or frozen 2D data."""
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.TopAbs import TopAbs_EDGE,TopAbs_FORWARD
    from OCP.TopExp import TopExp
    from OCP.TopTools import TopTools_IndexedMapOfShape
    from OCP.TopoDS import TopoDS
    _preflight_source_curves(shape,document)
    base.validate_payload(document)
    original_document_hash=hashlib.sha256(json.dumps(document,sort_keys=True,allow_nan=False).encode()).hexdigest()
    wrapped=getattr(shape,'wrapped',shape);before=base._brep_sha(wrapped)
    if before!=document.get('sourceBrepSHA256'):raise ValueError('3D extension source BRep differs from frozen source payload')
    base.validate_source_topology(wrapped,document)
    result=copy.deepcopy(document);edges=TopTools_IndexedMapOfShape();TopExp.MapShapes_s(wrapped,TopAbs_EDGE,edges)
    if edges.Extent()!=len(result['sourceEdges']):raise ValueError('Canonical 3D source edge inventory differs')
    maximum=0.;nondegenerate=0;types=Counter();total_poles=0;budget={'poles':base._preflight_payload(document)}
    for row in result['sourceEdges']:
        eid=row['sourceEdgeId'];edge=TopoDS.Edge_s(edges.FindKey(eid+1));edge=TopoDS.Edge_s(edge.Oriented(TopAbs_FORWARD))
        if bool(BRep_Tool.Degenerated_s(edge)) is not row['degenerated3dEdge']:
            raise ValueError('Canonical 3D source degenerate identity differs')
        if float(BRep_Tool.Tolerance_s(edge))!=row['sourceEdgeToleranceMm']:
            raise ValueError('Canonical source 3D edge tolerance differs')
        if row['degenerated3dEdge']:
            row.update(curve3d=None,native3dParamRange=None,sourceOriginal3dParamRange=None,source3dMathSamples=[])
        else:
            adaptor=BRepAdaptor_Curve(edge);original=BRep_Tool.Curve_s(edge,0.,0.)
            if original is None:raise ValueError('Nondegenerate source edge has no canonical 3D curve; no rebuilding permitted')
            first,last=float(adaptor.FirstParameter()),float(adaptor.LastParameter())
            if row['edgeRange']!=[first,last]:raise ValueError('Canonical source 3D parameter range differs from frozen data')
            for sample in row['sourceCurve3dSamples']:
                base._error(base._xyz(adaptor.Value(sample['parameter'])),sample['point'])
            record,a,b=curve_record(adaptor,original,budget,1+len(row['owners']));samples=_samples(adaptor,record,a,b)
            if record['type']==4:total_poles+=len(record['poles'])
            if total_poles>base.MAX_TOTAL_POLES:raise ValueError('Canonical source 3D control-pole budget exceeded')
            maximum=max(maximum,max(s['sourceMathError'] for s in samples));types[record['type']]+=1;nondegenerate+=1
            row.update(curve3d=record,native3dParamRange=[a,b],sourceOriginal3dParamRange=[first,last],source3dMathSamples=samples)
        row['source3dMathSamplesOrigin']=SAMPLE_ORIGIN
        for owner in row['owners']:
            c=result['faces'][owner['faceIndex']]['loops'][owner['loopIndex']]['coedges'][owner['coedgeIndex']]
            reverse=c['edgeSenseRaw'];c['curve3d']=row['curve3d']
            c['native3dParamRange']=row['native3dParamRange']
            c['source3dRange']=None if row['curve3d'] is None else row['native3dParamRange'][::-1] if reverse else row['native3dParamRange'][:]
            c['sourceOriginal3dParamRange']=None if row['curve3d'] is None else row['sourceOriginal3dParamRange'][::-1] if reverse else row['sourceOriginal3dParamRange'][:]
            c['source3dMathSamples']=row['source3dMathSamples'][::-1] if reverse else row['source3dMathSamples'][:]
            c['source3dMathSamplesOrigin']=SAMPLE_ORIGIN
    for face in result['faces']:
        face['source3dFaceConstructionAvailable']=not any(c['degenerated3dEdge'] for w in face['loops'] for c in w['coedges'])
        face['sourcePoleFallback']='use frozen exact 2D face path' if not face['source3dFaceConstructionAvailable'] else None
    if base._brep_sha(wrapped)!=before:raise ValueError('Canonical 3D extraction changed the source BRep')
    if hashlib.sha256(json.dumps(document,sort_keys=True,allow_nan=False).encode()).hexdigest()!=original_document_hash:
        raise ValueError('Canonical 3D extension changed the frozen 2D input document')
    result.update(payloadVariant='canonical-source-3D-curves',source3dOrigin='source-OCP',
        sourceCanonical3dNondegenerateEdges=nondegenerate,sourceCanonical3dCurveTypes=dict(types),
        source3dMathMaximumSampleError=maximum,source3dSourceBrepUnmodified=True,
        frozen2dDocumentUnmodified=True,source3dGeometryFittingPerformed=False,nativeHostVerified=False)
    validate_payload(result)
    return result


def validate_payload(document):
    """Validate the frozen 2D contract and exact canonical 3D extension."""
    base._preflight_payload(document,include3d=True)
    report=base.validate_payload(document)
    if document.get('payloadVariant')!='canonical-source-3D-curves' or document.get('source3dOrigin')!='source-OCP':
        raise ValueError('Require canonical source-3D extension with source provenance')
    maximum=0.;poles=0
    for row in document['sourceEdges']:
        curve=row.get('curve3d');samples=row.get('source3dMathSamples')
        if row.get('source3dMathSamplesOrigin')!=SAMPLE_ORIGIN:raise ValueError('Invalid canonical 3D sample provenance')
        if row['degenerated3dEdge']:
            if curve is not None or samples!=[] or row.get('native3dParamRange') is not None:
                raise ValueError('Degenerate source poles have no constructed 3D curve')
        else:
            if not isinstance(curve,dict) or not isinstance(samples,list) or len(samples)!=7:raise ValueError('Missing canonical 3D curve math/samples')
            a,b=base._vector(row['native3dParamRange'],2);first,last=base._vector(row['sourceOriginal3dParamRange'],2)
            if not a<b or not first<last or row['edgeRange']!=row['sourceOriginal3dParamRange']:raise ValueError('Invalid canonical/original 3D ranges')
            if curve.get('type')==4:poles+=len(curve.get('poles',[]))
            conversion=curve.get('exactLocusConversion')
            if conversion is not None:
                if conversion.get('fittingPerformed') is not False or any(not 0<=base._number(conversion[k])<=MATH_LIMIT for k in
                    ('sourceToConvertedMaximumDistance','convertedToSourceMaximumDistance')):
                    raise ValueError('Invalid exact 3D conic locus conversion witnesses')
                if (conversion.get('sourceOriginalParamRange')!=[first,last]
                        or conversion.get('native3dParamRange')!=[a,b]):
                    raise ValueError('Exact 3D conversion original/native finite ranges differ')
            elif curve.get('sourceParameterMap') is not None:
                raise ValueError('Source 3D parameter map lacks exact conic conversion evidence')
            # Original OCP observations remain an independent anchor even if a
            # new curve and all of its newly added math samples change together.
            for source_sample in row['sourceCurve3dSamples']:
                t=base.curve_parameter_from_source(curve,source_sample['parameter'],a,b)
                maximum=max(maximum,base._error(base.evaluate_curve(curve,t),source_sample['point']))
            for i,sample in enumerate(samples):
                t=a if i==0 else b if i==6 else a+(b-a)*i/6
                if abs(base._number(sample['parameter'])-t)>1e-12:raise ValueError('Unexpected canonical 3D sample parameter')
                source_t=base.source_curve_parameter(curve,t)
                if abs(base._number(sample['sourceParameter'])-source_t)>1e-10 or not first-1e-12<=source_t<=last+1e-12:
                    raise ValueError('Canonical 3D sample source-parameter remap differs')
                maximum=max(maximum,base._error(base.evaluate_curve(curve,t),sample['point']))
        for owner in row['owners']:
            c=document['faces'][owner['faceIndex']]['loops'][owner['loopIndex']]['coedges'][owner['coedgeIndex']]
            reverse=c['edgeSenseRaw']
            if (c.get('curve3d')!=curve or c.get('native3dParamRange')!=row.get('native3dParamRange')
                    or c.get('source3dMathSamplesOrigin')!=SAMPLE_ORIGIN
                    or c.get('source3dMathSamples')!=(samples[::-1] if reverse else samples)):
                raise ValueError('Coedge does not use its exact canonical source 3D edge data')
            expected=None if curve is None else row['native3dParamRange'][::-1] if reverse else row['native3dParamRange']
            original=None if curve is None else row['sourceOriginal3dParamRange'][::-1] if reverse else row['sourceOriginal3dParamRange']
            if c.get('source3dRange')!=expected or c.get('sourceOriginal3dParamRange')!=original:
                raise ValueError('3D construction range lost actual coedge loop orientation')
    if poles>base.MAX_TOTAL_POLES:raise ValueError('Canonical 3D control-pole budget exceeded')
    report.update(canonical3dCurves=sum(not r['degenerated3dEdge'] for r in document['sourceEdges']),
        canonical3dControlPoles=poles,maximumSource3dMathSampleError=maximum)
    return report


def extract_payload(source,base_payload,output):
    """Extend an immutable 2D JSON using its exact source STEP, to a fresh file."""
    from build123d import import_step
    source=Path(source).resolve();base_payload=Path(base_payload).resolve()
    output=Path(output).absolute();output=output.parent.resolve()/output.name
    if not output.parent.is_dir() or os.path.lexists(output):raise ValueError('Require a new 3D payload path with existing parent')
    if any(not p.is_file() or not 0<p.stat().st_size<=MAX_BYTES for p in (source,base_payload)):
        raise ValueError('Canonical 3D source/base payload input budget is 16 MiB each')
    source_hash=base._sha(source);document_hash=base._sha(base_payload)
    def pairs(items):
        result={}
        for k,v in items:
            if k in result:raise ValueError('Duplicate base JSON key')
            result[k]=v
        return result
    def nonfinite(value):raise ValueError('Nonfinite base JSON value: '+value)
    document=json.loads(base_payload.read_bytes(),object_pairs_hook=pairs,parse_constant=nonfinite)
    if document.get('sourceStepSHA256')!=source_hash:raise ValueError('Canonical 3D source SHA differs from frozen 2D payload')
    shape=import_step(source);result=extend_payload(shape,document)
    result.update(basePayloadSHA256=document_hash,sourceFileUnmodified=True,basePayloadFileUnmodified=True)
    raw=(json.dumps(result,indent=2,allow_nan=False)+'\n').encode('utf8')
    if len(raw)>MAX_BYTES:raise ValueError('Canonical 3D payload exceeds 16 MiB')
    if base._sha(source)!=source_hash or base._sha(base_payload)!=document_hash:raise ValueError('Source or frozen payload changed during 3D extraction')
    with output.open('xb') as stream:stream.write(raw)
    return result


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path);parser.add_argument('base_payload',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args(argv);result=extract_payload(args.source,args.base_payload,args.output)
    print(json.dumps(dict(validate_payload(result),source3dCurveTypes=result['sourceCanonical3dCurveTypes'],
        origin=result['origin'],sourceSHA256=result['sourceStepSHA256'],fittingPerformed=False,nativeHostVerified=False)))
    return 0


if __name__=='__main__':raise SystemExit(main())
