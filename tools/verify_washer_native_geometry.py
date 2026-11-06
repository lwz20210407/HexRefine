"""Complete custom-washer boundary checks against the saved HM's bound carriers.

This does not launch a mesher/solver or edit source CAD, HM, K or INP. It is
separate from the native keyword readback and does not certify CAD association.
"""
import argparse
import json
import math
from pathlib import Path
import time

import numpy as np

from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy,validated_policy
from tools.bolthex.native_iges_solid import sha,validate_reconstruction
from tools.bolthex.native_cad_conditioning import carrier_acceptance
from tools.bolthex.flat_washer import WasherDesign,WasherSeeds,audit_mesh,NODE_LIMIT_MM,FACE_LIMIT_MM,VOLUME_LIMIT
from tools.bolthex.mesh_core import Mesh3D
from tools.bolthex.truegrid_screw import read_keyword
from tools.bolthex.mesh_audit import audit_h8
from tools.bolthex.standard_cad import _mass


def check_native_identity(host,construction,manifest,bindings,native):
    """A valid reconstruction for another HM is not evidence for this bundle."""
    native=Path(native).resolve();hm=native/'model.hm';iges=native/'native-cad.iges';mf=native/'native-cad-manifest.json'
    if (Path(manifest.get('nativeHmPath','')).resolve()!=hm or Path(manifest.get('igesPath','')).resolve()!=iges
            or host.get('hmSHA256')!=bindings[str(hm)] or manifest.get('nativeHmSHA256')!=bindings[str(hm)]
            or construction.get('sourceHmSHA256')!=bindings[str(hm)]
            or manifest.get('igesSHA256')!=bindings[str(iges)] or construction.get('igesSHA256')!=bindings[str(iges)]
            or construction.get('manifestSHA256')!=bindings[str(mf)]):
        raise ValueError('Native HM/IGES/manifest/reconstruction identity mismatch')


def measure_points(points,source_distance,native_distance,carrier_distance,source_limit,transfer_limit):
    """Separate linear-FE discretization from the independently declared CAD-transfer budget."""
    if any(type(v) not in (int,float) or not math.isfinite(v) or v<0 for v in (source_limit,transfer_limit)):
        raise ValueError('Require finite nonnegative independent distance limits')
    points=np.asarray(points,dtype=float)
    if points.ndim!=2 or points.shape[1]!=3 or not len(points) or not np.isfinite(points).all():
        raise ValueError('Require nonempty finite three-dimensional points')
    rows=[]
    for index,point in enumerate(points):
        a,b,c=(float(fn(point)) for fn in (source_distance,native_distance,carrier_distance))
        if not all(math.isfinite(v) and v>=0 for v in (a,b,c)):raise ValueError('Nonfinite or negative geometric measurement')
        rows.append(dict(index=index,sourceDistance=a,nativeIgesDistance=b,carrierDistance=c,
            nativeTransferError=abs(b-a),carrierTransferError=abs(c-a)))
    if not rows:raise ValueError('Require nonempty physical boundary samples')
    maxima={key:max(row[key] for row in rows) for key in rows[0] if key!='index'}
    return dict(count=len(rows),rows=rows,maxima=maxima,
        passed=maxima['sourceDistance']<=source_limit and max(maxima['nativeTransferError'],maxima['carrierTransferError'])<=transfer_limit,
        sourceDiscretizationLimitMM=source_limit,nativeGeometryTransferLimitMM=transfer_limit)


def verify(source_bundle,native_bundle,output,*,geometry_policy,sewing_tolerance,reference_file=None):
    started=time.monotonic()
    policy=validated_policy(geometry_policy);source=Path(source_bundle).resolve();native=Path(native_bundle).resolve()
    reference_path=(source/'native-reference.json') if reference_file is None else Path(reference_file).resolve()
    output=Path(output).absolute()
    if output.exists() or output.is_symlink() or not output.parent.is_dir():raise ValueError('Require a fresh report path')
    paths=[source/name for name in ('model.k','model.inp','model.step','report.json','cad-report.json')]+[reference_path]
    paths += [native/name for name in ('model.hm','report.json','native-cad.iges','native-cad-manifest.json','native-cad-audit.json',
                                     'native-brep-audit.json','iges-reconstruction/reconstruction.json','iges-reconstruction/reconstructed.brep')]
    bindings={str(p):sha(p) for p in paths}
    original=json.loads((source/'report.json').read_text());host=json.loads((native/'report.json').read_text())
    if original.get('family')!='custom_flat_annular_washer':raise ValueError('This complete-boundary verifier is scoped to the custom annular washer')
    for key,file in (('kSHA256','model.k'),('inpSHA256','model.inp'),('sourceStepSHA256','model.step')):
        if original.get(key)!=bindings[str(source/file)]:raise ValueError('Source bundle hash mismatch')
    if (host.get('nativeCadAndMeshVerified') is not True or host.get('savedAndReopened') is not True
            or host.get('meshDataUnchanged') is not True or host.get('nodeSnapping') is not False
            or host.get('geometryAccuracyPolicy')!=policy.manifest() or host.get('hmSHA256')!=bindings[str(native/'model.hm')]
            or host.get('sourceKSHA256')!=original['kSHA256'] or host.get('sourceStepSHA256')!=original['sourceStepSHA256']):
        raise ValueError('Native bundle does not bind this source/policy')
    construction=json.loads((native/'iges-reconstruction/reconstruction.json').read_text())
    manifest=json.loads((native/'native-cad-manifest.json').read_text())
    check_native_identity(host,construction,manifest,bindings,native)
    raw=json.loads((native/'native-cad-audit.json').read_text())
    reference=json.loads(reference_path.read_text())
    from tools.hypermesh_geometry_probe import validate_reference
    expected_reference_hashes={'sourceStepSHA256':original['sourceStepSHA256'],'sourceKSHA256':original['kSHA256'],
        'sourceReportSHA256':bindings[str(source/'report.json')],'sourceCadReportSHA256':bindings[str(source/'cad-report.json')]}
    validate_reference(reference,expected_hashes={k:v for k,v in expected_reference_hashes.items() if k in reference})
    from tools.bolthex.native_cad_audit import surface_policy_acceptance
    if (host.get('nativeCadAuditSHA256')!=bindings[str(native/'native-cad-audit.json')]
            or raw.get('sourceHmSHA256')!=host['hmSHA256'] or raw.get('igesSHA256')!=bindings[str(native/'native-cad.iges')]
            or raw.get('manifestSHA256')!=bindings[str(native/'native-cad-manifest.json')]
            or raw.get('sourceStepSHA256')!=original['sourceStepSHA256']
            or raw.get('referenceSHA256')!=bindings[str(reference_path)]
            or raw.get('geometryAccuracyPolicy')!=policy.manifest() or not surface_policy_acceptance(raw,reference,policy)):
        raise ValueError('Raw native CAD audit does not bind this HM/IGES/source/reference')
    carrier=validate_reconstruction(construction,native/'native-cad-manifest.json',native/'iges-reconstruction',
        geometry_policy=policy,sewing_tolerance=sewing_tolerance)
    prior=json.loads((native/'native-brep-audit.json').read_text())
    if (not carrier_acceptance(prior,policy) or prior.get('carrierFormat')!='occt-brep'
            or host.get('nativeCarrierSHA256')!=sha(carrier) or prior.get('carrierBrepSHA256')!=sha(carrier)
            or prior.get('sourceStepSHA256')!=original['sourceStepSHA256']
            or prior.get('referenceSHA256')!=bindings[str(reference_path)]
            or prior.get('geometryAccuracyPolicy')!=policy.manifest()
            or host.get('nativeCarrierAuditSHA256')!=bindings[str(native/'native-brep-audit.json')]
            or host.get('nativeReconstructionSHA256')!=bindings[str(native/'iges-reconstruction/reconstruction.json')]):
        raise ValueError('Independent carrier audit binding is incomplete')
    from build123d import import_step,import_brep,Compound
    from OCP.IGESControl import IGESControl_Reader
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.TopoDS import TopoDS_Compound
    from OCP.BRep import BRep_Builder
    from tools.hypermesh_probe_reference import TrimmedFaceDistances
    from tools.bolthex.native_trim_solid import _solid_state
    source_shape=import_step(source/'model.step');carrier_shape=import_brep(carrier)
    _solid_state(carrier_shape.wrapped,policy.distance_budget_mm(critical=True))
    reader=IGESControl_Reader()
    if reader.ReadFile(str(native/'native-cad.iges'))!=IFSelect_RetDone or reader.TransferRoots()<=0:raise ValueError('Native IGES read failed')
    imported=Compound(reader.OneShape());faces=list(imported.faces())
    if len(faces)!=host['surfaces']:raise ValueError('Native physical face inventory changed')
    builder=BRep_Builder();physical=TopoDS_Compound();builder.MakeCompound(physical)
    for face in faces:builder.Add(physical,face.wrapped)
    native_shape=Compound(physical)
    mesh=read_keyword(source/'model.k')
    design=WasherDesign(**original['design']);seeds=WasherSeeds(**original['seeds'])
    wrapped=Mesh3D('readback-washer');wrapped.nodes=mesh.nodes;wrapped.elems=mesh.elements;wrapped.dims={}
    source_audit=audit_mesh(wrapped,design,seeds,source_shape)
    quality,boundary=audit_h8(mesh.nodes,mesh.elements,expected_euler=0,minimum_sj=0.)
    boundary_rows=np.unique(boundary);centres=mesh.nodes[boundary].mean(axis=1)
    distances=[TrimmedFaceDistances(shape) for shape in (source_shape,native_shape,carrier_shape)]
    budget=policy.distance_budget_mm(critical=True)
    nodes=measure_points(mesh.nodes[boundary_rows],*distances,NODE_LIMIT_MM,budget)
    face_centres=measure_points(centres,*distances,FACE_LIMIT_MM,budget)
    outside=[int(mesh.element_ids[i]) for i,point in enumerate(mesh.nodes[mesh.elements].mean(axis=1)) if not carrier_shape.is_inside(tuple(point))]
    bore_clear=not carrier_shape.is_inside((0,0,design.thickness_mm/2))
    volume=_mass(carrier_shape);relative=abs(quality['volume']-volume)/volume
    unchanged=all(sha(Path(p))==h for p,h in bindings.items())
    passed=nodes['passed'] and face_centres['passed'] and not outside and bore_clear and relative<=VOLUME_LIMIT and unchanged
    result=dict(schemaVersion=1,scope='complete bounded custom washer: source CAD/mesh plus native geometry carriers',
        passed=passed,seconds=time.monotonic()-started,sourceHashes=bindings,sourceInputsUnchanged=unchanged,geometryAccuracyPolicy=policy.manifest(),
        nodes=len(mesh.nodes),H8=len(mesh.elements),boundaryNodeIDs=mesh.node_ids[boundary_rows].tolist(),
        boundaryFaceNodeIDs=mesh.node_ids[boundary].tolist(),allBoundaryNodes=nodes,allBoundaryFaceCentres=face_centres,
        allCellCentresChecked=len(mesh.elements),outsideElementIDs=outside,boreIsVoid=bore_clear,
        sourceGeometryVerified=source_audit['geometryVerified'],quality=quality,carrierVolume=volume,
        relativeMeshToNativeCarrierVolumeError=relative,meshVolumeLimit=VOLUME_LIMIT,
        sourceCadDiscretizationAndNativeTransferErrorsSeparated=True,nativeAssociationVerified=False,
        nativeKeywordReadbackVerifiedByThisTool=False,physicalSolverStarted=False,
        fullHausdorffCertified=False,engineeringAnalysisVerified=False)
    with output.open('x',encoding='utf8') as stream:json.dump(result,stream,indent=2,allow_nan=False)
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('source','native','output'):p.add_argument(name,type=Path)
    p.add_argument('--target-size-mm',type=float,required=True);p.add_argument('--sewing-tolerance-mm',type=float,required=True)
    p.add_argument('--reference',type=Path,help='Explicit independent source-reference file; defaults to source/native-reference.json')
    a=p.parse_args();r=verify(a.source,a.native,a.output,geometry_policy=CadAccuracyPolicy.engineering(a.target_size_mm),sewing_tolerance=a.sewing_tolerance_mm,reference_file=a.reference)
    print(json.dumps({key:r[key] for key in ('passed','nodes','H8','allCellCentresChecked','relativeMeshToNativeCarrierVolumeError','sourceInputsUnchanged')}))
    raise SystemExit(0 if r['passed'] else 2)
