"""Bounded read-only native IGES -> closed analysis carrier, never a source CAD replacement."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path

from .geometry_accuracy_policy import CadAccuracyPolicy,validated_policy
from .native_trim_solid import _kernel,_mapped,_fingerprint,_shape_geometry,_solid_state,_reopen_math,_reopen_tolerances
from .standard_cad import CAD_ROUNDTRIP_VOLUME_LIMIT

MAX_FACES=256
MAX_IGES_BYTES=32*1024*1024
MAX_CARRIER_BYTES=32*1024*1024


def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for part in iter(lambda:stream.read(1024*1024),b''):h.update(part)
    return h.hexdigest()


def _unchanged(bindings):
    try:return all(sha(path)==value for path,value in bindings.items())
    except OSError:return False


def _manifest(path):
    path=Path(path).resolve()
    if not path.is_file() or not 0<path.stat().st_size<=65536:raise ValueError('Invalid manifest budget')
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise ValueError('Duplicate manifest field')
            result[key]=value
        return result
    def nonfinite(value):raise ValueError('Nonfinite manifest value')
    raw=path.read_bytes()
    if not 0<len(raw)<=65536:raise ValueError('Invalid manifest budget')
    data=json.loads(raw,object_pairs_hook=unique,parse_constant=nonfinite)
    required={'nativeHmPath','nativeHmSHA256','igesPath','igesSHA256','nativeFaces','solids',
              'optimizationDisabled','nativeVolumeBefore','nativeVolumeAfter'}
    if not isinstance(data,dict) or not required<=set(data) or set(data)-required-{'sourceStepSHA256'}:
        raise ValueError('Missing or unknown native manifest fields')
    if (type(data['nativeFaces']) is not int or not 1<=data['nativeFaces']<=MAX_FACES
            or type(data['solids']) is not int or data['solids']!=1 or data['optimizationDisabled'] is not True):
        raise ValueError('Require one native solid, bounded face inventory and disabled optimization')
    before,after=data['nativeVolumeBefore'],data['nativeVolumeAfter']
    if any(type(v) not in (int,float) or not math.isfinite(v) or v<=0 for v in (before,after)) or abs(before-after)/before>1e-12:
        raise ValueError('Invalid or changed approximate host volume')
    hm,iges=Path(data['nativeHmPath']).resolve(),Path(data['igesPath']).resolve()
    if (not hm.is_file() or hm.suffix.lower()!='.hm' or not iges.is_file() or iges.suffix.lower() not in ('.igs','.iges')
            or not 0<iges.stat().st_size<=MAX_IGES_BYTES or len({path,hm,iges})!=3):
        raise ValueError('Invalid native HM/IGES input paths or IGES byte budget')
    for file,key in ((hm,'nativeHmSHA256'),(iges,'igesSHA256')):
        if sha(file)!=data[key]:raise ValueError('Native input hash mismatch')
    manifest_hash=hashlib.sha256(raw).hexdigest()
    if sha(path)!=manifest_hash:raise ValueError('Manifest changed during validation')
    return data,{path:manifest_hash,hm:data['nativeHmSHA256'],iges:data['igesSHA256']},hm,iges


def _volume(shape):
    k=_kernel();rows=[]
    for epsilon in (1e-8,1e-10):
        props=k.GProp_GProps();error=k.BRepGProp.VolumeProperties_s(shape,props,epsilon,True,False)
        value=props.Mass()
        if not math.isfinite(value) or value<=0 or not math.isfinite(error) or not 0<=error<=epsilon:
            raise ValueError('Independent closed BRep mass did not converge')
        rows.append(dict(volume=value,requestedRelativeError=epsilon,estimatedRelativeError=error))
    if abs(rows[0]['volume']-rows[1]['volume'])/rows[-1]['volume']>1e-8:
        raise ValueError('Independent mass integration disagrees')
    return rows


def _check_sewing_tolerance(value,policy):
    if type(value) not in (int,float) or not math.isfinite(value) or not 1e-7<=value<=policy.distance_budget_mm(critical=True):
        raise ValueError('Explicit sewing tolerance must be in [1e-7, policy distance budget] mm')


def reconstruct_iges_solid(manifest_file,output_dir,*,geometry_policy,sewing_tolerance):
    """All faces are retained; a source STEP/FE mesh is not an input to construction."""
    if geometry_policy is None:raise ValueError('Explicit geometry policy required')
    policy=validated_policy(geometry_policy);budget=policy.distance_budget_mm(critical=True)
    _check_sewing_tolerance(sewing_tolerance,policy)
    output=Path(output_dir).absolute()
    if os.path.lexists(output) or not output.parent.is_dir():raise ValueError('Require a fresh output directory under an existing parent')
    manifest,bindings,hm,iges=_manifest(manifest_file)
    output=output.parent.resolve()/output.name
    if any(file.is_relative_to(output) for file in bindings):raise ValueError('Output cannot contain source inputs')
    report=dict(schemaVersion=1,kernel='native-iges-single-solid-v1',
        sourceHmSHA256=bindings[hm],igesSHA256=bindings[iges],manifestSHA256=bindings[Path(manifest_file).resolve()],
        geometryAccuracyPolicy=policy.manifest(),sewingToleranceMM=float(sewing_tolerance),
        reconstructionVerified=False,nativeHmVerified=False,productAcceptance=False,
        sourceGeometryUsedInConstruction=False,meshUsedInConstruction=False,
        nativeTopologyReconstructed=True,approximateHostVolumeUsedForAcceptance=False)
    output.mkdir()
    try:
        from OCP.IGESControl import IGESControl_Reader
        from OCP.IFSelect import IFSelect_RetDone
        reader=IGESControl_Reader()
        if reader.ReadFile(str(iges))!=IFSelect_RetDone or reader.TransferRoots()<=0:
            raise ValueError('IGES reader failed')
        k=_kernel();source=reader.OneShape();faces=_mapped(source,k.TopAbs_FACE)
        if len(faces)!=manifest['nativeFaces']:raise ValueError('Native/IGES physical face count mismatch')
        edges=_mapped(source,k.TopAbs_EDGE);vertices=_mapped(source,k.TopAbs_VERTEX)
        if len(edges)>4096 or len(vertices)>8192:raise ValueError('IGES curve/vertex inventory budget exceeded')
        physical_edges=[e for f in faces for e in _mapped(f,k.TopAbs_EDGE)]
        edge_vertices=[v for e in edges for v in _mapped(e,k.TopAbs_VERTEX)]
        report['auxiliaryGeometry']=dict(
            freeEdgesExcluded=sum(not any(e.IsSame(p) for p in physical_edges) for e in edges),
            freeVerticesExcluded=sum(not any(v.IsSame(p) for p in edge_vertices) for v in vertices),
            physicalFacesExcluded=0,wholeIgesFileHashBound=True)
        original_signature=_shape_geometry(source)
        supports=[_fingerprint(k.BRep_Tool.Surface_s(k.TopoDS.Face_s(f))) for f in faces]
        sew=k.BRepBuilderAPI_Sewing(sewing_tolerance,True,True,True,False)
        sew.SetMinTolerance(1e-7);sew.SetMaxTolerance(sewing_tolerance);sew.SetSameParameterMode(False)
        for face in faces:sew.Add(face)
        sew.Perform();shell=sew.SewedShape();out_faces=_mapped(shell,k.TopAbs_FACE)
        topology=dict(sourceFaces=len(faces),faces=len(out_faces),freeEdges=sew.NbFreeEdges(),
            multipleEdges=sew.NbMultipleEdges(),deletedFaces=sew.NbDeletedFaces(),
            rootIsShell=shell.ShapeType()==k.TopAbs_SHELL)
        report['sewing']=topology
        if (not topology['rootIsShell'] or len(out_faces)!=len(faces) or topology['freeEdges']
                or topology['multipleEdges'] or topology['deletedFaces'] or not k.BRep_Tool.IsClosed_s(shell)):
            raise ValueError('IGES faces do not form exactly one closed manifold shell without losses')
        correspondence=[];used=set()
        for index,face in enumerate(faces):
            modified=sew.Modified(face) if sew.IsModified(face) else face
            children=_mapped(modified,k.TopAbs_FACE)
            if len(children)!=1:raise ValueError('Source face split or removed')
            matches=[i for i,f in enumerate(out_faces) if f.IsSame(children[0])]
            if len(matches)!=1 or matches[0] in used:raise ValueError('Source face correspondence is not bijective')
            target=matches[0];used.add(target)
            actual=_fingerprint(k.BRep_Tool.Surface_s(k.TopoDS.Face_s(out_faces[target])))
            if actual!=supports[index]:raise ValueError('Sew changed a mathematical support surface')
            correspondence.append(dict(sourceFace=index,carrierFace=target,supportSHA256=actual))
        if _shape_geometry(source)!=original_signature:raise ValueError('Input IGES geometry changed during reconstruction')
        solid=k.BRepBuilderAPI_MakeSolid(k.TopoDS.Shell_s(shell)).Solid()
        if not k.BRepLib.OrientClosedSolid_s(solid):raise ValueError('Closed solid orientation failed')
        state,data=_solid_state(solid,budget)
        mass=_volume(solid)
        carrier=output/'reconstructed.brep'
        with carrier.open('xb') as stream:stream.write(data)
        if not carrier.is_file() or not 0<carrier.stat().st_size<=MAX_CARRIER_BYTES:raise ValueError('Carrier byte budget exceeded')
        reopened=k.TopoDS_Shape()
        if not k.BRepTools.Read_s(reopened,str(carrier),k.BRep_Builder()):raise ValueError('Carrier BRep readback failed')
        read_state,_=_solid_state(reopened,budget);read_mass=_volume(reopened)
        if read_state['topologySHA256']!=state['topologySHA256']:raise ValueError('Carrier readback changed physical topology')
        readback_math=_reopen_math(solid,reopened);readback_tolerances=_reopen_tolerances(solid,reopened)
        error=abs(read_mass[-1]['volume']-mass[-1]['volume'])/mass[-1]['volume']
        if error>CAD_ROUNDTRIP_VOLUME_LIMIT:raise ValueError('Carrier BRep roundtrip changed independent mass')
        if sha(carrier)!=state['stateSHA256']:raise ValueError('Serialized carrier changed during readback')
        if not _unchanged(bindings):raise ValueError('Native source inputs changed during reconstruction')
        report.update(reconstructionVerified=True,nativeFaces=len(faces),carrierBrepSHA256=sha(carrier),
            carrierFile='reconstructed.brep',carrierFormat='occt-brep',sourceInputsUnchanged=True,supportsUnchanged=True,
            faceCorrespondence=correspondence,solidState=state,readbackSolidState=read_state,
            volumeIntegrations=mass,readbackVolumeIntegrations=read_mass,relativeBrepRoundtripVolumeError=error,
            brepRoundtripVolumeLimit=CAD_ROUNDTRIP_VOLUME_LIMIT,readbackMath=readback_math,readbackToleranceMetadata=readback_tolerances,
            limitations=['Topology is explicitly recovered from exported faces, not an exact native topology capture.',
                'Must independently compare raw native faces AND reconstructed carrier against source CAD before HM delivery.',
                'Finite witnesses are not a global Hausdorff certificate; no FE modification or physical analysis is performed.'])
        pending=output/'reconstruction.pending.json'
        with pending.open('x',encoding='utf8') as stream:
            json.dump(report,stream,indent=2,allow_nan=False);stream.flush();os.fsync(stream.fileno())
        if not _unchanged(bindings):raise ValueError('Native source changed before publication')
        # Hard-link publication is exclusive even if another writer races the final name.
        os.link(pending,output/'reconstruction.json')
        try:pending.unlink()
        except OSError:pass
        return report
    except Exception as error:
        report.update(status='rejected',error=str(error),reconstructionVerified=False,nativeHmVerified=False,
            productAcceptance=False,sourceInputsUnchanged=_unchanged(bindings))
        with (output/'rejection.json').open('x',encoding='utf8') as stream:json.dump(report,stream,indent=2,allow_nan=False)
        raise


def validate_reconstruction(report,manifest_file,output_dir,*,geometry_policy,sewing_tolerance):
    """Validate process evidence and file bindings; source-CAD audit remains mandatory."""
    if geometry_policy is None:raise ValueError('Explicit geometry policy required')
    policy=validated_policy(geometry_policy);_check_sewing_tolerance(sewing_tolerance,policy)
    manifest,bindings,hm,iges=_manifest(manifest_file)
    output=Path(output_dir).resolve();carrier=output/'reconstructed.brep';n=manifest['nativeFaces']
    if (not isinstance(report,dict) or type(report.get('schemaVersion')) is not int or report['schemaVersion']!=1
            or report.get('kernel')!='native-iges-single-solid-v1'
            or any(report.get(k) is not True for k in ('reconstructionVerified','sourceInputsUnchanged','supportsUnchanged','nativeTopologyReconstructed'))
            or any(report.get(k) is not False for k in ('nativeHmVerified','productAcceptance','sourceGeometryUsedInConstruction','meshUsedInConstruction','approximateHostVolumeUsedForAcceptance'))
            or report.get('geometryAccuracyPolicy')!=policy.manifest()
            or report.get('sewingToleranceMM')!=sewing_tolerance
            or type(report.get('nativeFaces')) is not int or report['nativeFaces']!=n
            or report.get('sourceHmSHA256')!=bindings[hm] or report.get('igesSHA256')!=bindings[iges]
            or report.get('manifestSHA256')!=bindings[Path(manifest_file).resolve()]
            or report.get('carrierFile')!='reconstructed.brep' or report.get('carrierFormat')!='occt-brep' or not carrier.is_file()
            or not 0<carrier.stat().st_size<=MAX_CARRIER_BYTES or sha(carrier)!=report.get('carrierBrepSHA256')):
        raise ValueError('Reconstruction evidence does not bind these native inputs/carrier/policy')
    sewing=report.get('sewing',{})
    if (sewing.get('rootIsShell') is not True or any(type(sewing.get(k)) is not int or sewing[k]!=v
            for k,v in (('sourceFaces',n),('faces',n),('freeEdges',0),('multipleEdges',0),('deletedFaces',0)))):
        raise ValueError('Incomplete reconstruction sewing evidence')
    auxiliary=report.get('auxiliaryGeometry',{})
    if (type(auxiliary.get('physicalFacesExcluded')) is not int or auxiliary['physicalFacesExcluded']!=0
            or auxiliary.get('wholeIgesFileHashBound') is not True
            or any(type(auxiliary.get(k)) is not int or not 0<=auxiliary[k]<=8192 for k in ('freeEdgesExcluded','freeVerticesExcluded'))):
        raise ValueError('Missing explicit auxiliary-geometry inventory')
    rows=report.get('faceCorrespondence',[])
    if (len(rows)!=n or any(type(r.get(k)) is not int for r in rows for k in ('sourceFace','carrierFace'))
            or sorted(r['sourceFace'] for r in rows)!=list(range(n)) or sorted(r['carrierFace'] for r in rows)!=list(range(n))
            or any(not isinstance(r.get('supportSHA256'),str) or len(r['supportSHA256'])!=64
                   or any(c not in '0123456789abcdef' for c in r['supportSHA256']) for r in rows)):
        raise ValueError('Reconstruction face correspondence is not a complete bijection')
    for field in ('solidState','readbackSolidState'):
        state=report.get(field,{});topology=state.get('topology',{})
        if (topology.get('rootType')!='solid' or any(type(topology.get(k)) is not int or topology[k]!=v for k,v in (('solids',1),('shells',1),('faces',n)))
                or type(state.get('maximumOutputTolerance')) not in (int,float)
                or not 0<=state['maximumOutputTolerance']<=policy.distance_budget_mm(critical=True)):
            raise ValueError('Invalid reconstructed solid ownership/tolerance evidence')
    values=[]
    for field in ('volumeIntegrations','readbackVolumeIntegrations'):
        integrations=report.get(field,[])
        if len(integrations)!=2:raise ValueError('Missing independent mass evidence')
        for row,epsilon in zip(integrations,(1e-8,1e-10)):
            if (type(row.get('volume')) not in (int,float) or not math.isfinite(row['volume']) or row['volume']<=0
                    or row.get('requestedRelativeError')!=epsilon or type(row.get('estimatedRelativeError')) not in (int,float)
                    or not 0<=row['estimatedRelativeError']<=epsilon):raise ValueError('Invalid independent mass evidence')
        if abs(integrations[0]['volume']-integrations[1]['volume'])/integrations[1]['volume']>1e-8:
            raise ValueError('Unconverged reconstructed volume')
        values.append(integrations[-1]['volume'])
    error=abs(values[1]-values[0])/values[0]
    if (error>CAD_ROUNDTRIP_VOLUME_LIMIT or report.get('relativeBrepRoundtripVolumeError')!=error
            or report.get('brepRoundtripVolumeLimit')!=CAD_ROUNDTRIP_VOLUME_LIMIT):
        raise ValueError('Reconstructed BRep volume roundtrip differs')
    return carrier


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--sewing-tolerance-mm',type=float,required=True)
    parser.add_argument('--accuracy-profile',choices=('strict','engineering'),default='strict')
    for name in ('target-size-mm','critical-target-size-mm','minimum-functional-gap-mm','minimum-root-radius-mm'):
        parser.add_argument('--'+name,type=float)
    a=parser.parse_args()
    policy=CadAccuracyPolicy('engineering-cad-transfer' if a.accuracy_profile=='engineering' else 'strict-cad-regression',
        target_size_mm=a.target_size_mm,critical_target_size_mm=a.critical_target_size_mm,
        minimum_functional_gap_mm=a.minimum_functional_gap_mm,minimum_root_radius_mm=a.minimum_root_radius_mm)
    report=reconstruct_iges_solid(a.manifest,a.output,geometry_policy=policy,sewing_tolerance=a.sewing_tolerance_mm)
    print(json.dumps({key:report[key] for key in ('reconstructionVerified','nativeFaces','carrierBrepSHA256','sourceInputsUnchanged')}))


if __name__=='__main__':main()
