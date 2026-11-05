"""Independent finite native-CAD checks via unoptimized IGES trimmed surfaces.

IGES is a measurement carrier, not a certified reconstructed solid or STEP.
No HyperMesh closest-point query is used to certify geometry here.
"""
import argparse,json,math
from pathlib import Path
from tools.hypermesh_geometry_probe import sha,validate_reference
from tools.hypermesh_probe_reference import TrimmedFaceDistances
from .standard_cad import CAD_ROUNDTRIP_VOLUME_LIMIT,_mass
from .geometry_accuracy_policy import CadAccuracyPolicy


SURFACE_METRICS=('maximumSurfaceDistance','maximumSourceFaceDistance','maximumControlDistanceError',
                 'maximumReverseDistance','maximumReverseEdgeDistance','maximumCadBoundsDifference',
                 'maximumSourceReferenceError')


def _policy(accuracy_policy):
    if accuracy_policy is None:return CadAccuracyPolicy()
    if not isinstance(accuracy_policy,CadAccuracyPolicy):raise ValueError('Require a validated CAD accuracy policy')
    return accuracy_policy


def surface_acceptance(metrics,accuracy_policy=None):
    """Finite surface/bounds result only; host volume is not independent BRep."""
    limits=_policy(accuracy_policy).carrier_limits(all_surfaces_critical=True)
    for key in SURFACE_METRICS:
        value=metrics.get(key)
        if type(value) not in (int,float) or not math.isfinite(value) or value<0:
            raise ValueError('Invalid native CAD surface metric: '+key)
    return all(metrics[key]<=limits[key] for key in SURFACE_METRICS)


def acceptance(metrics):
    limits={'maximumSurfaceDistance':2e-6,'maximumSourceFaceDistance':2e-6,'maximumControlDistanceError':2e-6,
            'maximumReverseDistance':2e-6,'maximumReverseEdgeDistance':2e-6,'maximumCadBoundsDifference':1e-5,
            'relativeNativeVolumeError':CAD_ROUNDTRIP_VOLUME_LIMIT}
    for key in limits:
        value=metrics.get(key)
        if type(value) not in (int,float) or not math.isfinite(value) or value<0:raise ValueError('Invalid native CAD metric: '+key)
    return all(metrics[key]<=limit for key,limit in limits.items())


def _interior_point(face):
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.BRepClass import BRepClass_FaceClassifier
    from OCP.TopAbs import TopAbs_IN
    from OCP.gp import gp_Pnt2d
    surface=BRepAdaptor_Surface(face.wrapped,True)
    u0,u1=surface.FirstUParameter(),surface.LastUParameter();v0,v1=surface.FirstVParameter(),surface.LastVParameter()
    if not all(math.isfinite(v) for v in (u0,u1,v0,v1)) or u0>=u1 or v0>=v1:raise ValueError('Unbounded or empty CAD face cannot be sampled')
    def verified(u,v):
        if not math.isfinite(u) or not math.isfinite(v):return None
        if BRepClass_FaceClassifier(face.wrapped,gp_Pnt2d(u,v),1e-9).State()!=TopAbs_IN:return None
        point=surface.Value(u,v);xyz=[point.X(),point.Y(),point.Z()]
        return xyz if all(math.isfinite(value) for value in xyz) else None
    for a,b in ((.5,.5),(.25,.5),(.75,.5),(.5,.25),(.5,.75),(.25,.25),(.75,.75)):
        u=u0+(u1-u0)*a;v=v0+(v1-v0)*b
        xyz=verified(u,v)
        if xyz is not None:return xyz
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.BRep import BRep_Tool
    from OCP.TopLoc import TopLoc_Location
    from OCP.TopoDS import TopoDS
    # Mesh only a deep geometry copy. In particular, never add/replace cached
    # triangulation on a caller's shared face. UV triangles propose points;
    # the ORIGINAL trimmed face must independently classify each one as IN.
    isolated=TopoDS.Face_s(BRepBuilderAPI_Copy(face.wrapped,True,False).Shape())
    if isolated.IsPartner(face.wrapped):raise ValueError('CAD witness requires an isolated face copy')
    # Coarse chords can fall inside a narrow annular hole. Refine candidate
    # geometry only, never the fixed classification tolerance; at most four
    # serial meshes and 4096 triangle candidates are examined.
    for deflection in (.01,.001,.0001,.00001):
        mesher=BRepMesh_IncrementalMesh(isolated,deflection,True,.2,False)
        if not mesher.IsDone():raise ValueError('CAD witness triangulation did not finish')
        triangulation=BRep_Tool.Triangulation_s(isolated,TopLoc_Location())
        if triangulation is None or not triangulation.HasUVNodes():raise ValueError('CAD witness triangulation lacks UV nodes')
        count=triangulation.NbTriangles();budget=min(count,1024)
        for i in range(budget):
            index=1 if budget==1 else 1+i*(count-1)//(budget-1)
            uv=[triangulation.UVNode(j) for j in triangulation.Triangle(index).Get()]
            xyz=verified(sum(p.X() for p in uv)/3,sum(p.Y() for p in uv)/3)
            if xyz is not None:return xyz
    raise ValueError('No trimmed-interior witness for a CAD face')


def validate_samples(report,reference):
    """Recompute reported maxima; a passing boolean cannot replace raw evidence."""
    def number(value):
        if type(value) not in (int,float) or not math.isfinite(value) or value<0:raise ValueError('Invalid native CAD witness distance')
        return value
    def declared(key,actual):
        if abs(number(report.get(key))-actual)>1e-12:raise ValueError('Native CAD witness maximum contradicts '+key)
    def point(row):
        if not isinstance(row,dict):raise ValueError('Invalid native CAD witness row')
        xyz=row.get('point')
        if not isinstance(xyz,list) or len(xyz)!=3 or any(type(v) not in (int,float) or not math.isfinite(v) for v in xyz):raise ValueError('Invalid native CAD witness coordinate')
    forward=report.get('forward')
    if not isinstance(forward,list) or len(forward)!=len(reference['points']):raise ValueError('Incomplete forward witnesses')
    surface=[];controls=[];source_errors=[]
    for index,(row,expected) in enumerate(zip(forward,reference['points'])):
        point(row)
        if row.get('index')!=index or row.get('point')!=expected['point'] or row.get('role')!=expected['role']:raise ValueError('Forward witness identity changed')
        source=number(row.get('sourceDistance'));native=number(row.get('nativeDistance'))
        if abs(source-expected['sourceDistance'])>2e-6:raise ValueError('Forward source witness changed')
        source_errors.append(abs(source-expected['sourceDistance']))
        (controls if row['role']=='control' else surface).append(abs(native-source) if row['role']=='control' else native)
    if report.get('surfaceWitnesses')!=len(surface) or report.get('controls')!=len(controls):raise ValueError('Forward witness count changed')
    declared('maximumSurfaceDistance',max(surface));declared('maximumControlDistanceError',max(controls))
    if 'maximumSourceReferenceError' in report:declared('maximumSourceReferenceError',max(source_errors))
    for field,count_key,index_key,distance_key,metric in (
        ('sourceFaceWitnesses','sourceFaces','face','nativeDistance','maximumSourceFaceDistance'),
        ('reverse','nativeFaces','face','sourceDistance','maximumReverseDistance'),
        ('edgeReverse','nativeEdges','edge','sourceDistance','maximumReverseEdgeDistance')):
        rows=report.get(field);count=report.get(count_key)
        if type(count) is not int or count<1 or not isinstance(rows,list) or not rows:raise ValueError('Incomplete '+field)
        for row in rows:point(row)
        indices=[row.get(index_key) for row in rows]
        if any(type(i) is not int for i in indices) or set(indices)!=set(range(count)):raise ValueError('Missing CAD entity witnesses: '+field)
        if field!='edgeReverse' and len(rows)!=count:raise ValueError('Duplicate face witnesses')
        declared(metric,max(number(row.get(distance_key)) for row in rows))
    if report.get('reverseWitnesses')!=len(report['reverse']) or report.get('edgeWitnesses')!=len(report['edgeReverse']):raise ValueError('Reverse witness count changed')
    source_volume=number(report.get('sourceVolume'));native_volume=number(report.get('nativeVolume'))
    if min(source_volume,native_volume)<=0:raise ValueError('Invalid native/source CAD volume')
    declared('relativeNativeVolumeError',abs(source_volume-native_volume)/source_volume)


def _bounds(shape):
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib
    box=Bnd_Box();BRepBndLib.AddOptimal_s(shape.wrapped,box,False,False)
    values=list(box.Get())
    if not all(math.isfinite(v) for v in values):raise ValueError('Invalid exact CAD bounds')
    return values


def audit_exchange(manifest_file,step,reference_file,output,*,accuracy_policy=None):
    policy=_policy(accuracy_policy)
    manifest_file,step,reference_file,output=map(lambda p:Path(p).resolve(),(manifest_file,step,reference_file,output))
    if output.exists() or not output.parent.is_dir():raise ValueError('Require a new audit file in an existing directory')
    if manifest_file.stat().st_size>65536 or reference_file.stat().st_size>2097152:raise ValueError('Oversized native CAD audit input')
    manifest=json.loads(manifest_file.read_text());reference=json.loads(reference_file.read_text());validate_reference(reference)
    database=Path(manifest['nativeHmPath']).resolve();iges=Path(manifest['igesPath']).resolve()
    bindings=[(database,manifest['nativeHmSHA256']),(iges,manifest['igesSHA256']),
              (step,manifest['sourceStepSHA256']),(reference_file,sha(reference_file)),(manifest_file,sha(manifest_file))]
    if any(sha(path)!=digest for path,digest in bindings) or manifest['sourceStepSHA256']!=reference.get('sourceStepSHA256'):
        raise ValueError('Native CAD audit hash mismatch')
    if manifest.get('optimizationDisabled') is not True or type(manifest.get('solids')) is not int or manifest['solids']!=1:raise ValueError('Require one native solid and disabled export optimization')
    before,after=manifest['nativeVolumeBefore'],manifest['nativeVolumeAfter']
    if any(type(v) not in (int,float) or not math.isfinite(v) or v<=0 for v in (before,after)) or abs(before-after)/before>1e-12:
        raise ValueError('CAD export changed the native measured volume')
    if iges.stat().st_size>33554432:raise ValueError('Native IGES exceeds the 32 MiB audit budget')
    near=[row for row in reference['points'] if row['role']=='control' and 4e-6<row['sourceDistance']<.001]
    if len(near)<6:raise ValueError('Require at least six independently witnessed near-boundary controls')
    from build123d import Compound,import_step
    from OCP.BRep import BRep_Builder
    from OCP.TopoDS import TopoDS_Compound
    from OCP.IGESControl import IGESControl_Reader
    from OCP.IFSelect import IFSelect_RetDone
    reader=IGESControl_Reader()
    if reader.ReadFile(str(iges))!=IFSelect_RetDone or reader.TransferRoots()<=0:raise ValueError('Native IGES could not be read')
    imported=Compound(reader.OneShape());source=import_step(step)
    native_faces=list(imported.faces())
    if not 1<=len(native_faces)<=1024 or not 1<=len(source.faces())<=1024 or len(source.solids())!=1:
        raise ValueError('Native CAD audit is bounded to one source solid and at most 1024 faces')
    # IGES roots can also contain auxiliary support curves outside the body.
    # Bound/measure actual trimmed faces, never those free construction curves.
    builder=BRep_Builder();face_complex=TopoDS_Compound();builder.MakeCompound(face_complex)
    for face in native_faces:builder.Add(face_complex,face.wrapped)
    native=Compound(face_complex)
    source_distance=TrimmedFaceDistances(source);native_distance=TrimmedFaceDistances(native)
    forward=[]
    for index,row in enumerate(reference['points']):
        actual=source_distance(row['point'])
        if abs(actual-row['sourceDistance'])>2e-6 or (row['role']!='control' and actual>2e-6):raise ValueError('Source witness failed independent trimmed-CAD recheck')
        forward.append(dict(row,index=index,sourceDistance=actual,nativeDistance=native_distance(row['point'])))
    source_faces=list(source.faces())
    source_witnesses=[]
    for index,face in enumerate(source_faces):
        point=_interior_point(face)
        source_witnesses.append(dict(face=index,point=point,nativeDistance=native_distance(point)))
    reverse=[]
    for index,face in enumerate(native_faces):
        xyz=_interior_point(face);reverse.append(dict(face=index,point=xyz,sourceDistance=source_distance(xyz)))
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    edges=list(native.edges())
    if len(edges)>2048:raise ValueError('Native CAD audit exceeds its 2048-edge budget')
    edge_reverse=[]
    for index,edge in enumerate(edges):
        if BRep_Tool.Degenerated_s(edge.wrapped):
            points=[[v.X,v.Y,v.Z] for v in edge.vertices()]
            if not points:raise ValueError('Degenerate CAD edge has no pole vertex')
        else:
            curve=BRepAdaptor_Curve(edge.wrapped);a,b=curve.FirstParameter(),curve.LastParameter()
            if not math.isfinite(a) or not math.isfinite(b):raise ValueError('Unbounded native CAD edge')
            points=[]
            for t in (0.,.25,.5,.75,1.):
                point=curve.Value(a+(b-a)*t);points.append([point.X(),point.Y(),point.Z()])
        for point in points:edge_reverse.append(dict(edge=index,point=point,sourceDistance=source_distance(point)))
    if not edge_reverse:raise ValueError('Native CAD audit has no boundary-edge witnesses')
    sb,nb=_bounds(source),_bounds(native);source_volume=_mass(source)
    metrics=dict(maximumSurfaceDistance=max(row['nativeDistance'] for row in forward if row['role']!='control'),
                 maximumSourceFaceDistance=max(row['nativeDistance'] for row in source_witnesses),
                 maximumControlDistanceError=max(abs(row['nativeDistance']-row['sourceDistance']) for row in forward if row['role']=='control'),
                 maximumReverseDistance=max(row['sourceDistance'] for row in reverse),
                 maximumReverseEdgeDistance=max(row['sourceDistance'] for row in edge_reverse),
                 maximumCadBoundsDifference=max(abs(a-b) for a,b in zip(sb,nb)),
                 maximumSourceReferenceError=max(abs(row['sourceDistance']-expected['sourceDistance'])
                    for row,expected in zip(forward,reference['points'])),
                 relativeNativeVolumeError=abs(before-source_volume)/source_volume)
    selected=surface_acceptance(metrics,policy)
    result=dict(schemaVersion=1,purpose='independent-native-cad-surface-audit',**metrics,
                sampledNativeCadVerified=acceptance(metrics),exactNativeCadCertified=False,fullModelAcceptance=False,
                geometryAccuracyPolicy=policy.manifest(all_surfaces_critical=True),
                selectedGeometryPolicyVerified=selected,
                engineeringCadGeometryVerified=selected if policy.profile=='engineering-cad-transfer' else None,
                geometryVerificationScope='finite trimmed-surface/edge witnesses and independent face-only bounds; not solid/HM/FE certification',
                geometryPolicyAppliedMetrics=list(SURFACE_METRICS),
                geometryPolicyUnmeasuredMetrics=['maximumBoundaryNodeControlDistance','relativeStepBrepVolumeError'],
                independentNativeBrepVolumeVerified=False,nativeApproxVolumeUsedForGeometryAcceptance=False,
                nativeVolumeMethod='host nativeVolumeBefore/After measurement, not independent reconstructed BRep volume',
                igesSolidReconstructionVerified=False,igesRole='trimmed-surface measurement carrier, not a reconstructed solid STEP',
                sourceVolume=source_volume,nativeVolume=before,sourceBounds=sb,nativeBounds=nb,nativeFaces=len(native_faces),nativeEdges=len(edges),
                sourceFaces=len(source_faces),sourceFaceWitnesses=source_witnesses,
                surfaceWitnesses=sum(row['role']!='control' for row in forward),controls=sum(row['role']=='control' for row in forward),
                nearBoundaryControls=len(near),reverseWitnesses=len(reverse),edgeWitnesses=len(edge_reverse),forward=forward,reverse=reverse,edgeReverse=edge_reverse,
                sourceStepSHA256=manifest['sourceStepSHA256'],sourceHmSHA256=manifest['nativeHmSHA256'],igesSHA256=manifest['igesSHA256'],
                referenceSHA256=bindings[3][1],manifestSHA256=bindings[4][1],
                limitations=['Finite samples do not prove global BRep identity.',
                             'IGES solid topology is not certified; native solid count/volume remain separate host measurements.',
                             'Selected geometry policy verification excludes independent native BRep volume; legacy sampledNativeCadVerified remains strict.',
                             'No separate FE boundary-node coverage or full geometry coupling is certified by this surface carrier.',
                             'This audit does not certify an FE mesh, contact, material or standards/tolerance class.'])
    validate_samples(result,reference)
    if any(sha(path)!=digest for path,digest in bindings):raise ValueError('Native CAD audit source changed during measurement')
    with output.open('x',encoding='utf8') as stream:json.dump(result,stream,indent=2,allow_nan=False)
    return result


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('manifest','step','reference','output'):parser.add_argument(name,type=Path)
    parser.add_argument('--accuracy-profile',choices=('strict','engineering'),default='strict')
    parser.add_argument('--target-size-mm',type=float)
    parser.add_argument('--critical-target-size-mm',type=float)
    parser.add_argument('--minimum-functional-gap-mm',type=float)
    parser.add_argument('--minimum-root-radius-mm',type=float)
    args=parser.parse_args(argv)
    policy=CadAccuracyPolicy('engineering-cad-transfer' if args.accuracy_profile=='engineering' else 'strict-cad-regression',
        target_size_mm=args.target_size_mm,critical_target_size_mm=args.critical_target_size_mm,
        minimum_functional_gap_mm=args.minimum_functional_gap_mm,minimum_root_radius_mm=args.minimum_root_radius_mm)
    result=audit_exchange(args.manifest,args.step,args.reference,args.output,accuracy_policy=policy)
    print(json.dumps({key:value for key,value in result.items() if key not in ('forward','reverse','edgeReverse','sourceFaceWitnesses')},indent=2))
    # Keep the legacy default exit status, including its host-volume diagnostic.
    passed=result['sampledNativeCadVerified'] if args.accuracy_profile=='strict' else result['selectedGeometryPolicyVerified']
    return 0 if passed else 2


if __name__=='__main__':raise SystemExit(main())
