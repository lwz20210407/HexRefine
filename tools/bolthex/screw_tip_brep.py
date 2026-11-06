"""Materialize a source-derived LOCAL diagnostic BRep, never a whole Screw."""
from __future__ import annotations

import argparse
from collections import Counter
from fractions import Fraction as Q
from functools import lru_cache
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace

import numpy as np

from . import screw_tip_regularization as target_api
from .mesh_audit import FACES
from .native_cad_conditioning import _finite, _interior_point
from . import native_trim_solid as solid_tools

CONSTRUCTION_TOLERANCE_MM = 1e-7
CLASSIFICATION_TOLERANCE_MM = 1e-9
VOLUME_RELATIVE_LIMIT = 1e-7
MAX_FILE_BYTES = 2*1024*1024
MAX_BREP_BYTES = 4*1024*1024


def _require(ok,message):
    if not ok: raise ValueError(message)


def _sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _json(path):
    _require(path.is_file() and path.stat().st_size<=MAX_FILE_BYTES,'Missing/oversized JSON input')
    def pairs(items):
        result={}
        for key,value in items:
            _require(key not in result,'Duplicate JSON key');result[key]=value
        return result
    result=json.loads(path.read_bytes(),object_pairs_hook=pairs)
    _require(isinstance(result,dict),'JSON root must be an object')
    json.dumps(result,allow_nan=False)
    return result


def _canonical(value): return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)


def validate_target(source_k,phase_report,target_file,owned_directory):
    """Recompute the complete frozen target, not merely its declared pass flags."""
    target=_json(target_file)
    recomputed_path=Path(owned_directory)/'recomputed-target.json'
    recomputed=target_api.prepare_target(source_k,phase_report,recomputed_path)
    _require(_canonical(target)==_canonical(recomputed),
             'Target differs from deterministic source/policy reconstruction (including hull, float points, facets and flags)')
    return target,recomputed_path


@lru_cache(maxsize=1)
def _kernel():
    base=solid_tools._kernel()
    from OCP.gp import gp_Pnt,gp_Pnt2d
    from OCP.TColgp import TColgp_Array2OfPnt
    from OCP.Geom import Geom_BezierSurface
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace,BRepBuilderAPI_MakePolygon,BRepBuilderAPI_MakeVertex
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse,BRepAlgoAPI_Cut
    from OCP.BRepExtrema import BRepExtrema_DistShapeShape
    from OCP.BRepAdaptor import BRepAdaptor_Surface,BRepAdaptor_Curve
    from OCP.BRepClass import BRepClass_FaceClassifier
    from OCP.BRepClass3d import BRepClass3d_SolidClassifier
    from OCP.TopTools import TopTools_ListOfShape
    from OCP.TopoDS import TopoDS_Compound
    from OCP.TopAbs import TopAbs_IN,TopAbs_ON,TopAbs_OUT,TopAbs_COMPOUND
    return SimpleNamespace(**(vars(base)|locals()))


def _entities(shape,kind): return solid_tools._mapped(shape,kind)


def _volume(shape):
    k=_kernel();props=k.GProp_GProps()
    estimate=k.BRepGProp.VolumeProperties_s(shape,props,1e-10,True,False)
    value=float(props.Mass())
    _require(_finite(value) and _finite(float(estimate)),'Nonfinite BRep volume integration')
    return value,float(estimate)


def _one_solid(shape):
    k=_kernel()
    while shape.ShapeType()==k.TopAbs_COMPOUND:
        iterator=k.TopoDS_Iterator(shape);children=[]
        while iterator.More(): children.append(iterator.Value());iterator.Next()
        _require(len(children)==1,'Compound contains auxiliary or multiple shapes')
        shape=children[0]
    _require(shape.ShapeType()==k.TopAbs_SOLID,'Expected one solid, not an auxiliary shell/compound')
    return shape


def _sew(faces,policy_budget):
    k=_kernel();tol=CONSTRUCTION_TOLERANCE_MM
    sewing=k.BRepBuilderAPI_Sewing(tol,True,True,True,False)
    sewing.SetMinTolerance(tol);sewing.SetMaxTolerance(tol)
    for face in faces: sewing.Add(face)
    sewing.Perform();shape=sewing.SewedShape();shells=_entities(shape,k.TopAbs_SHELL)
    info=dict(inputFaces=len(faces),outputFaces=len(_entities(shape,k.TopAbs_FACE)),shells=len(shells),
              freeEdges=sewing.NbFreeEdges(),multipleEdges=sewing.NbMultipleEdges(),deletedFaces=sewing.NbDeletedFaces())
    _require(len(shells)==1 and info['inputFaces']==info['outputFaces'] and
             not any(info[v] for v in ('freeEdges','multipleEdges','deletedFaces')),
             'Sewing did not preserve one complete closed manifold shell')
    result=k.BRepBuilderAPI_MakeSolid(k.TopoDS.Shell_s(shells[0])).Solid()
    _require(k.BRepLib.OrientClosedSolid_s(result),'Cannot orient closed solid')
    solid_tools._solid_state(result,policy_budget)
    return result,info


def _source_shape(mesh,policy_budget):
    k=_kernel();index=int(np.flatnonzero(mesh.element_ids==5048)[0]);points=mesh.nodes[mesh.elements[index]]
    faces=[]
    for fi,slots in enumerate(FACES):
        q=points[slots]
        if fi==5:
            _require(np.all(q[:,:2]==0),'Omitted source F6 is not the one-dimensional axis image')
            continue
        poles=k.TColgp_Array2OfPnt(1,2,1,2)
        for (u,v),point in zip(((1,1),(2,1),(2,2),(1,2)),q): poles.SetValue(u,v,k.gp_Pnt(*point))
        surface=k.Geom_BezierSurface(poles)
        maker=k.BRepBuilderAPI_MakeFace(surface,0.,1.,0.,1.,CONSTRUCTION_TOLERANCE_MM)
        _require(maker.IsDone(),'Source Q4 MakeFace failed');faces.append(maker.Face())
    shape,sewing=_sew(faces,policy_budget)
    return shape,sewing,points


def _hull_shape(target,policy_budget):
    k=_kernel();hull=target['exactHull'];points=hull['pointsFloat'];faces=[]
    for row in hull['faces']:
        polygon=k.BRepBuilderAPI_MakePolygon()
        for index in row['outwardPolygon']: polygon.Add(k.gp_Pnt(*points[index]))
        polygon.Close();maker=k.BRepBuilderAPI_MakeFace(polygon.Wire(),True)
        _require(maker.IsDone(),'Rounded exact-hull polygon MakeFace failed');faces.append(maker.Face())
    return _sew(faces,policy_budget)


def _boolean(operation,left,right):
    """Never use the two-shape constructor: it can build before flags are set."""
    k=_kernel();op=operation();arguments=k.TopTools_ListOfShape();arguments.Append(left)
    tools=k.TopTools_ListOfShape();tools.Append(right)
    op.SetArguments(arguments);op.SetTools(tools)
    op.SetNonDestructive(True);op.SetFuzzyValue(0.);op.SetRunParallel(False)
    op.Build();_require(op.IsDone(),'Configured zero-fuzzy Boolean failed')
    return op.Shape()


def _state(shape,budget):
    state,data=solid_tools._solid_state(shape,budget)
    volume,estimate=_volume(shape);_require(volume>0,'Solid has nonpositive volume')
    state.update(volume=volume,volumeIntegrationEstimate=estimate,integrationEstimateIsNotCertifiedErrorBound=True)
    return state,data


def _cold_math(original,reopened):
    """Scoped direct codec samples, not a new generic BRep identity certificate."""
    k=_kernel();errors=[]
    def check(a,b):
        aa=(a.X(),a.Y(),a.Z());bb=(b.X(),b.Y(),b.Z());error=math.dist(aa,bb)
        _require(math.isfinite(error) and error<=solid_tools._roundoff_bound(*aa,*bb),'Cold BRep world-coordinate sample changed beyond codec roundoff')
        errors.append(error)
    for a,b in zip(_entities(original,k.TopAbs_FACE),_entities(reopened,k.TopAbs_FACE)):
        a,b=k.TopoDS.Face_s(a),k.TopoDS.Face_s(b)
        sa,sb=k.BRep_Tool.Surface_s(a),k.BRep_Tool.Surface_s(b)
        _require(sa.DynamicType().Name()==sb.DynamicType().Name(),'Cold support surface type changed')
        u0,u1,v0,v1=k.BRepTools.UVBounds_s(a)
        for u in np.linspace(u0,u1,3):
            for v in np.linspace(v0,v1,3): check(sa.Value(float(u),float(v)),sb.Value(float(u),float(v)))
        for ea,eb in zip(_entities(a,k.TopAbs_EDGE),_entities(b,k.TopAbs_EDGE)):
            ea,eb=k.TopoDS.Edge_s(ea),k.TopoDS.Edge_s(eb)
            pa,pb=k.BRep_Tool.CurveOnSurface_s(ea,a,0.,0.),k.BRep_Tool.CurveOnSurface_s(eb,b,0.,0.)
            old=k.BRep_Tool.Range_s(ea,a);new=solid_tools._readback_interval(old,k.BRep_Tool.Range_s(eb,b))
            for x,y in zip(np.linspace(*old,17),np.linspace(*new,17)):
                ua,ub=pa.Value(float(x)),pb.Value(float(y));check(sa.Value(ua.X(),ua.Y()),sb.Value(ub.X(),ub.Y()))
    for a,b in zip(_entities(original,k.TopAbs_EDGE),_entities(reopened,k.TopAbs_EDGE)):
        a,b=k.TopoDS.Edge_s(a),k.TopoDS.Edge_s(b)
        ca,cb=k.BRep_Tool.Curve_s(a,0.,0.),k.BRep_Tool.Curve_s(b,0.,0.)
        _require((ca is None)==(cb is None),'Cold 3D edge representation disappeared')
        if ca is None: continue
        old=k.BRep_Tool.Range_s(a);new=solid_tools._readback_interval(old,k.BRep_Tool.Range_s(b))
        for x,y in zip(np.linspace(*old,17),np.linspace(*new,17)): check(ca.Value(float(x)),cb.Value(float(y)))
    for a,b in zip(_entities(original,k.TopAbs_VERTEX),_entities(reopened,k.TopAbs_VERTEX)):
        check(k.BRep_Tool.Pnt_s(k.TopoDS.Vertex_s(a)),k.BRep_Tool.Pnt_s(k.TopoDS.Vertex_s(b)))
    return dict(sampleCount=len(errors),maximumWorldDifference=max(errors),roundoffULPMultiplier=64,
                finiteDirectMathChecksOnly=True,globalGeometryIdentityCertified=False)


def _save_reopen(shape,path,budget):
    k=_kernel();before,data=_state(shape,budget)
    _require(len(data)<=MAX_BREP_BYTES,'BRep file exceeds bounded output size')
    with path.open('xb') as stream: stream.write(data)
    fresh=k.TopoDS_Shape()
    _require(k.BRepTools.Read_s(fresh,str(path),k.BRep_Builder()),'BRep readback failed')
    after,_=_state(fresh,budget)
    _require(before['topologySHA256']==after['topologySHA256'],'Readback changed topology')
    math_check=_cold_math(shape,fresh)
    tolerance_check=solid_tools._reopen_tolerances(shape,fresh)
    relative=abs(after['volume']-before['volume'])/before['volume']
    _require(relative<=VOLUME_RELATIVE_LIMIT,'Readback changed positive solid volume')
    _require(_sha(path)==before['stateSHA256'],'Saved BRep bytes differ from inspected state')
    return fresh,dict(before=before,after=after,relativeVolumeChange=relative,mathReadback=math_check,
                      toleranceReadback=tolerance_check,sha256=before['stateSHA256'],bytes=len(data),path=path.name)


def _support_check(source,original_points):
    k=_kernel();rows=[]
    for face in _entities(source,k.TopAbs_FACE):
        surface=k.BRep_Tool.Surface_s(k.TopoDS.Face_s(face))
        _require(surface.DynamicType().Name()=='Geom_BezierSurface' and surface.UDegree()==surface.VDegree()==1,
                 'Cold source support is not the actual bilinear Bezier surface')
        poles=np.array([[surface.Pole(u,v).X(),surface.Pole(u,v).Y(),surface.Pole(u,v).Z()]
                        for u,v in ((1,1),(2,1),(2,2),(1,2))])
        matches=[i+1 for i in range(5) if np.array_equal(poles,original_points[FACES[i]])]
        _require(len(matches)==1,'Cold source pole coordinates differ from actual source Q4')
        rows.append(dict(originalFace=matches[0],degree=[1,1],binary64PolesExactlyMatched=True))
    _require({r['originalFace'] for r in rows}==set(range(1,6)),'Cold source lost a physical face')
    return rows


def _face_signature(face):
    k=_kernel()
    def children(shape):
        iterator=k.TopoDS_Iterator(shape);result=[]
        while iterator.More(): result.append(iterator.Value());iterator.Next()
        return result
    wires=[]
    for wire in children(face):
        uses=[]
        for edge in children(wire):
            vertices=[]
            for vertex in children(edge):
                p=k.BRep_Tool.Pnt_s(k.TopoDS.Vertex_s(vertex))
                vertices.append([str(vertex.Orientation()),p.X(),p.Y(),p.Z()])
            uses.append([str(edge.Orientation()),k.BRep_Tool.Degenerated_s(k.TopoDS.Edge_s(edge)),vertices])
        wires.append([str(wire.Orientation()),uses])
    topology=_canonical([str(face.Orientation()),wires])
    return dict(supportTrimWorldSHA256=solid_tools._shape_geometry(face),
                orientedTopologySHA256=hashlib.sha256(topology.encode()).hexdigest())


def _protected_faces(source,union,original_points,live_bindings=None):
    """Only the three actual unmodified source faces; no generic CAD matching."""
    k=_kernel();sources=_entities(source,k.TopAbs_FACE);candidates=_entities(union,k.TopAbs_FACE)
    labels=_support_check(source,original_points);rows=[]
    for index,label in enumerate(labels):
        original_face=label['originalFace']
        if original_face not in (1,3,4): continue
        face=sources[index];signature=_face_signature(face)
        same=[i for i,candidate in enumerate(candidates) if candidate.IsSame(face)]
        if live_bindings is None:
            matches=same or [i for i,candidate in enumerate(candidates) if _face_signature(candidate)==signature]
        else:
            matches=[r['unionFaceIndex'] for r in live_bindings if r['originalSourceFace']==original_face]
        _require(len(matches)==1,'Protected source face lost or ambiguous in union')
        chosen=candidates[matches[0]];actual=_face_signature(chosen)
        _require(signature==actual,'Protected union face support/trim/topology differs from complete source face')
        rows.append(dict(originalSourceFace=original_face,sourceFaceIndex=index,unionFaceIndex=matches[0],
                         liveIsSame=bool(chosen.IsSame(face)),liveIsEqual=bool(chosen.IsEqual(face)),
                         sourceSignature=signature,unionSignature=actual,completeFaceSignatureMatched=True))
    _require({r['originalSourceFace'] for r in rows}=={1,3,4},'Protected face inventory incomplete')
    return rows


def _boundary(shape):
    k=_kernel();builder=k.BRep_Builder();out=k.TopoDS_Compound();builder.MakeCompound(out)
    for face in _entities(shape,k.TopAbs_FACE): builder.Add(out,face)
    return out


def _distance(point,boundary):
    k=_kernel();vertex=k.BRepBuilderAPI_MakeVertex(k.gp_Pnt(*map(float,point))).Vertex()
    query=k.BRepExtrema_DistShapeShape(vertex,boundary);query.Perform()
    _require(query.IsDone() and query.NbSolution()>0,'Trimmed boundary distance query failed')
    distance=float(query.Value());_require(_finite(distance) and distance>=0,'Invalid boundary distance')
    return distance


def _point(q,r):
    bits=np.asarray(target_api.BITS);r=np.asarray(r)
    return np.prod(np.where(bits,r,1-r),axis=1)@q


def _boundary_audit(source,union,target,original_points):
    k=_kernel();sb,ub=_boundary(source),_boundary(union)
    faces=_entities(union,k.TopAbs_FACE);edges=_entities(union,k.TopAbs_EDGE);vertices=_entities(union,k.TopAbs_VERTEX)
    _require(len(faces)*81+len(edges)*17+len(vertices)+789<=4096,'Boundary witness budget exceeded')
    forward=[]
    for fi in range(5):
        q=original_points[FACES[fi]]
        for u,v in product_grid(7):
            p=(1-u)*(1-v)*q[0]+u*(1-v)*q[1]+u*v*q[2]+(1-u)*v*q[3]
            forward.append(dict(group='source-whole-face',face=fi+1,uv=[u,v],point=p.tolist(),
                                ownSourceBoundaryResidual=_distance(p,sb),toUnionBoundary=_distance(p,ub)))
    local_q=np.array([[float(Q(x)) for x in p] for p in target['sourceLocalCoordinatesExact']])
    lam,tau,omega=[float(Q(target['parameterBox'][key])) for key in ('lambdaMax','tauMax','omegaMax')]
    local=[]
    for name,maximum in (('local-t=0',omega),('local-w=0',tau)):
        for s in np.linspace(0,lam,17)[1:]:
            for other in np.linspace(0,maximum,17):
                r=[float(s),0.,float(other)] if name=='local-t=0' else [float(s),float(other),0.]
                p=_point(local_q,r)
                local.append(dict(group=name,stw=r,point=p.tolist(),ownSourceBoundaryResidual=_distance(p,sb),
                                  toUnionBoundary=_distance(p,ub)))
    reverse=[];coverage=[]
    for index,raw in enumerate(faces):
        face=k.TopoDS.Face_s(raw);surface=k.BRepAdaptor_Surface(face,True);u0,u1,v0,v1=k.BRepTools.UVBounds_s(face)
        _require(all(math.isfinite(x) for x in (u0,u1,v0,v1)),'Unbounded union surface')
        points=[]
        for u in np.linspace(u0,u1,9):
            for v in np.linspace(v0,v1,9):
                if k.BRepClass_FaceClassifier(face,k.gp_Pnt2d(float(u),float(v)),CONSTRUCTION_TOLERANCE_MM).State() not in (k.TopAbs_IN,k.TopAbs_ON): continue
                p=surface.Value(float(u),float(v));points.append([p.X(),p.Y(),p.Z()])
        if not points:
            from build123d import Face
            points=[_interior_point(Face(face))]
        for p in points: reverse.append(dict(face=index,point=p,toSourceBoundary=_distance(p,sb)))
        coverage.append(dict(face=index,samples=len(points)))
    edge_rows=[]
    for index,raw in enumerate(edges):
        edge=k.TopoDS.Edge_s(raw)
        if k.BRep_Tool.Degenerated_s(edge): continue
        curve=k.BRepAdaptor_Curve(edge);interval=(curve.FirstParameter(),curve.LastParameter())
        _require(all(math.isfinite(x) for x in interval),'Unbounded union curve')
        for t in np.linspace(*interval,17):
            p=curve.Value(float(t));xyz=[p.X(),p.Y(),p.Z()]
            edge_rows.append(dict(edge=index,parameter=float(t),point=xyz,ownUnionBoundaryResidual=_distance(xyz,ub),
                                  toSourceBoundary=_distance(xyz,sb)))
    for index,raw in enumerate(vertices):
        p=k.BRep_Tool.Pnt_s(k.TopoDS.Vertex_s(raw));xyz=[p.X(),p.Y(),p.Z()]
        edge_rows.append(dict(vertex=index,point=xyz,ownUnionBoundaryResidual=_distance(xyz,ub),toSourceBoundary=_distance(xyz,sb)))
    groups={name:dict(count=sum(r['group']==name for r in local),
                     maximum=max(r['toUnionBoundary'] for r in local if r['group']==name),
                     worst=max((r for r in local if r['group']==name),key=lambda r:r['toUnionBoundary']))
            for name in ('local-t=0','local-w=0')}
    summary=dict(wholeSourceFaceSamples=len(forward),localSourceSamples=len(local),localGroups=groups,
        localRequestedGrid=[17,17],axisS0Excluded=True,reverseFaceSamples=len(reverse),reverseEdgeVertexSamples=len(edge_rows),
        reverseFaceCoverage=coverage,forwardMaximum=max(r['toUnionBoundary'] for r in forward+local),
        reverseFaceMaximum=max(r['toSourceBoundary'] for r in reverse),reverseEdgeVertexMaximum=max(r['toSourceBoundary'] for r in edge_rows),
        maximumOwnSourceResidual=max(r['ownSourceBoundaryResidual'] for r in forward+local),
        maximumOwnUnionEdgeResidual=max(r['ownUnionBoundaryResidual'] for r in edge_rows),
        boundaryCompoundNotSolidUsed=True,finiteSamplesOnly=True,globalHausdorffCertified=False)
    summary['reverseMaximum']=max(summary['reverseFaceMaximum'],summary['reverseEdgeVertexMaximum'])
    return summary,dict(sourceWholeFaces=forward,sourceLocalPatches=local,reverseFaces=reverse,reverseEdgesAndVertices=edge_rows)


def product_grid(n):
    for u in np.linspace(0,1,n):
        for v in np.linspace(0,1,n): yield float(u),float(v)


def _witness_audit(union,target,maximum_stored_tolerance):
    k=_kernel();boundary=_boundary(union)
    corners=[tuple(Q(x) for x in p) for p in target['affineH8Witness']['verticesExact']]
    points=[(f'corner-{i}',p) for i,p in enumerate(corners)]
    points.append(('centre',tuple(sum(p[j] for p in corners)/8 for j in range(3))))
    for i in range(8):
        for j in range(i+1,8):
            if sum(a!=b for a,b in zip(target_api.BITS[i],target_api.BITS[j]))==1:
                points.append((f'edge-{i}-{j}',tuple((a+b)/2 for a,b in zip(corners[i],corners[j]))))
    _require(len(points)==21,'Witness membership inventory incomplete')
    rows=[];names={k.TopAbs_IN:'IN',k.TopAbs_ON:'ON',k.TopAbs_OUT:'OUT'}
    classifier=k.BRepClass3d_SolidClassifier(union)
    for label,exact in points:
        p=[float(x) for x in exact];classifier.Perform(k.gp_Pnt(*p),CLASSIFICATION_TOLERANCE_MM)
        state=names.get(classifier.State(),'UNKNOWN')
        rows.append(dict(label=label,point=p,classification=state,boundaryDistance=_distance(p,boundary),
                         pointRoundingL1Error=float(sum(abs(Q.from_float(v)-q) for v,q in zip(p,exact)))))
    return dict(count=21,classificationToleranceMM=CLASSIFICATION_TOLERANCE_MM,
                rows=rows,allSampledPointsInOrOn=all(r['classification'] in ('IN','ON') for r in rows),
                classificationCounts=dict(Counter(r['classification'] for r in rows)),
                maximumStoredToleranceMM=maximum_stored_tolerance,
                clearlyInsideBeyondStoredTolerance=sum(r['classification']=='IN' and r['boundaryDistance']>maximum_stored_tolerance for r in rows),
                insideWithinStoredTolerance=sum(r['classification']=='IN' and r['boundaryDistance']<=maximum_stored_tolerance for r in rows),
                requestedClassificationToleranceDoesNotEraseBRepMetadata=True,
                maximumBoundaryDistance=max(r['boundaryDistance'] for r in rows),
                worstByBoundaryDistance=max(rows,key=lambda r:r['boundaryDistance']),
                finiteMembershipOnly=True,wholeBoxContainmentCertified=False,mandatoryFinalMeshSeed=False)


def materialize(source_k,phase_report,target_file,new_output):
    """Create a fresh bounded diagnostic directory; no whole-model acceptance."""
    inputs=[Path(p).resolve(strict=True) for p in (source_k,phase_report,target_file)]
    source_k,phase_report,target_file=inputs;output=Path(new_output).absolute()
    _require(not output.exists() and not output.is_symlink() and output.parent.is_dir(),'Require a new output directory with existing parent')
    _require(not any(output.resolve().is_relative_to(p.parent) for p in inputs),'Output must be outside every immutable input bundle')
    for path,limit in zip(inputs,(target_api.MAX_BYTES,MAX_FILE_BYTES,MAX_FILE_BYTES)):
        _require(path.is_file() and path.stat().st_size<=limit,'Missing or oversized input before hashing: '+str(path))
    hashes={str(p):_sha(p) for p in inputs}
    def unchanged(): _require(all(_sha(p)==h for p,h in hashes.items()),'Source, policy or target changed during BRep work')
    with tempfile.TemporaryDirectory(prefix='tip-brep-validate-',dir=output.parent) as temporary:
        target,recomputed=validate_target(source_k,phase_report,target_file,temporary)
        unchanged();output.mkdir()
        recomputed_data=recomputed.read_bytes()
        with (output/'recomputed-target.json').open('xb') as f: f.write(recomputed_data)
        recomputed_artifact=dict(path='recomputed-target.json',bytes=len(recomputed_data),
                                 sha256=hashlib.sha256(recomputed_data).hexdigest())
    report=dict(schema='source-derived-local-tip-brep.v1',inputSHA256=hashes,sourceEID=5048,
        targetSHA256=hashes[str(target_file)],policyReportSHA256=hashes[str(phase_report)],
        independentDesignCAD=False,sourceMeshDefinesGeometry=True,sourceModified=False,
        wholeScrewAccepted=False,meshAccepted=False,coreMeshed=False,engineeringGeometryAccepted=False,
        globalHausdorffCertified=False,boundaryDistanceCertified=False,localBrepChecksPassed=False,
        constructionToleranceMM=CONSTRUCTION_TOLERANCE_MM,booleanFuzzyToleranceMM=0.,
        booleanNonDestructive=True,booleanRunParallel=False,stages={})
    try:
        budget=target['budget']['geometryTargetIncludingFloatMM']['value'];k=_kernel()
        mesh=target_api.read_keyword(source_k)
        source,source_sewing,original_points=_source_shape(mesh,budget)
        hull,hull_sewing=_hull_shape(target,budget)
        source,sr=_save_reopen(source,output/'source-e5048.brep',budget)
        hull,hr=_save_reopen(hull,output/'hull-approximation.brep',budget)
        report['stages'].update(sourceSewing=source_sewing,hullSewing=hull_sewing,sourceReadback=sr,hullReadback=hr)
        source_volume=sr['after']['volume'];hull_volume=hr['after']['volume']
        _require(abs(source_volume-target['volume']['sourceCellImageVolume']['value'])/source_volume<=VOLUME_RELATIVE_LIMIT,'Source BRep volume differs from exact source image')
        _require(abs(hull_volume-target['exactHull']['volume']['value'])/hull_volume<=VOLUME_RELATIVE_LIMIT,'Hull BRep volume differs from rational target')
        source_before,_=_state(source,budget);hull_before,_=_state(hull,budget)
        union=_one_solid(_boolean(k.BRepAlgoAPI_Fuse,source,hull))
        source_after,_=_state(source,budget);hull_after,_=_state(hull,budget)
        keys=('geometrySHA256','topologySHA256','tolerancesSHA256','stateSHA256')
        _require(all(source_before[x]==source_after[x] and hull_before[x]==hull_after[x] for x in keys),
                 'Boolean modified in-memory source/hull geometry, topology or tolerances')
        report['booleanInputSignatures']=dict(sourceBefore=source_before,sourceAfter=source_after,hullBefore=hull_before,hullAfter=hull_after,unchanged=True)
        protected_live=_protected_faces(source,union,original_points)
        union,ur=_save_reopen(union,output/'union-diagnostic.brep',budget);report['stages']['unionReadback']=ur
        protected_cold=_protected_faces(source,union,original_points,protected_live)
        report['protectedOutputFaces']=dict(originalSourceFaces=[1,3,4],outerRootFace=4,
            live=protected_live,coldReadback=protected_cold,completeSupportTrimTopologySignaturesMatched=True,
            modifiedTipFacesExcludedFromThisClaim=[2,5])
        source_support=_support_check(source,original_points)
        added=ur['after']['volume']-source_volume
        _require(0<added<=target['volume']['includingFloatHullUpperBound']['value'],'Measured Boolean added volume exceeds target bound or is nonpositive')
        lost=_boolean(k.BRepAlgoAPI_Cut,source,union)
        _require(not _entities(lost,k.TopAbs_SOLID) and not _entities(lost,k.TopAbs_FACE),'Kernel source-minus-union is not empty')
        summary,rows=_boundary_audit(source,union,target,original_points)
        witness=_witness_audit(union,target,ur['after']['maximumOutputTolerance'])
        witness_data=json.dumps(rows,separators=(',',':'),allow_nan=False).encode('utf8')
        with (output/'boundary-witnesses.json').open('xb') as f: f.write(witness_data)
        witness_artifact=dict(path='boundary-witnesses.json',bytes=len(witness_data),
                              sha256=hashlib.sha256(witness_data).hexdigest())
        report.update(sourceSupportReadback=source_support,boundarySamples=summary,orthogonalWitnessSamples=witness,
            measuredAddedVolume=added,measuredAddedVolumeRelativeToSourceCell=added/source_volume,
            sourceMinusUnionEmptyByKernel=True,measuredVolumeNotExactUnionCertificate=True,
            sampleDistanceLimitMM=budget,maximumActualUnionToleranceMM=ur['after']['maximumOutputTolerance'],
            kernelGeneratedToleranceGrowth=ur['after']['maximumOutputTolerance']>CONSTRUCTION_TOLERANCE_MM,
            toleranceGrowthNotManuallyApplied=True,inputsUnchanged=True)
        _require(summary['maximumOwnSourceResidual']<=CONSTRUCTION_TOLERANCE_MM,'Source witnesses do not lie on cold source boundary')
        _require(summary['maximumOwnUnionEdgeResidual']<=ur['after']['maximumOutputTolerance'],'Union curve residual exceeds actual tolerance metadata')
        _require(max(summary['forwardMaximum'],summary['reverseMaximum'])<=budget,'Finite boundary witnesses exceed fixed local budget')
        _require(witness['allSampledPointsInOrOn'],'A cold-union orthogonal witness point is OUT/UNKNOWN')
        unchanged()
        report.update(localBrepChecksPassed=True,scopedLocalChecks=dict(targetRecomputedExactly=True,
            zeroFuzzyConfiguredBeforeBuild=True,booleanInputsUnchanged=True,positiveClosedSingleSolidsReadBack=True,
            sourceQ4PolesUnchanged=True,localSourcePatchSamples=544,reverseFaceAndEdgeVertexSamples=True,
            protectedSourceFacesF1F3F4PreservedInOutput=True,
            finiteBoundarySamplesWithinBudget=True,orthogonalWitness21PointsInOrOn=True),
            builderSHA256=_sha(Path(__file__)),limitations=[
                'Source-derived local diagnostic BRep only: neither independent design CAD nor whole Screw.',
                'Actual boundary compounds are sampled; no global or continuous boundary Hausdorff certificate.',
                'The 21 witness points do not certify the whole box, mesh quality or explicit time-step quality.',
                'Kernel-generated union tolerances are reported; zero fuzzy does not mean unchanged output tolerance metadata.',
                'No K, assembled mesh, STEP design substitute or solver output is produced.'])
        # Bind to the bytes actually constructed/read back, never bless a later rewrite.
        report['artifacts']=[recomputed_artifact,witness_artifact]+[
            {key:row[key] for key in ('path','bytes','sha256')} for row in (sr,hr,ur)]
        with (output/'report.pending.json').open('x',encoding='utf8') as f:
            json.dump(report,f,indent=2,allow_nan=False);f.flush();os.fsync(f.fileno())
        unchanged()
        for artifact in report['artifacts']:
            path=output/artifact['path']
            _require(path.is_file() and not path.is_symlink() and path.stat().st_size==artifact['bytes']
                     and _sha(path)==artifact['sha256'],'Produced artifact changed before publication: '+artifact['path'])
        os.link(output/'report.pending.json',output/'report.json')
        try: (output/'report.pending.json').unlink()
        except OSError: pass
        return report
    except Exception as exc:
        report.update(localBrepChecksPassed=False,error=dict(type=type(exc).__name__,message=str(exc)))
        with (output/'rejection.json').open('x',encoding='utf8') as f: json.dump(report,f,indent=2,allow_nan=False)
        raise


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('source_k','phase_report','target_file','new_output'): parser.add_argument(name,type=Path)
    args=parser.parse_args(argv)
    try: r=materialize(args.source_k,args.phase_report,args.target_file,args.new_output)
    except (ValueError,OSError,RuntimeError,KeyError,TypeError) as exc: parser.exit(1,json.dumps(dict(localBrepChecksPassed=False,error=str(exc)))+'\n')
    print(json.dumps(dict(output=str(args.new_output.absolute()),localBrepChecksPassed=r['localBrepChecksPassed'],
        unionFaces=r['stages']['unionReadback']['after']['topology']['faces'],addedVolume=r['measuredAddedVolume'],
        forwardBoundarySampleMaximum=r['boundarySamples']['forwardMaximum'],reverseBoundarySampleMaximum=r['boundarySamples']['reverseMaximum'],
        witnessPoints=r['orthogonalWitnessSamples']['count'],wholeScrewAccepted=False),indent=2))
    return 0


if __name__=='__main__':raise SystemExit(main())
