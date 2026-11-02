"""Bounded complete socket-bolt feature/IO fixtures, not strict CAD acceptance."""
import argparse,json,subprocess,tempfile
from dataclasses import asdict
from pathlib import Path
import numpy as np
from .cad_mesh import MeshSeeds,map_saved_cad,estimate_mesh_volume
from .mesh_audit import audit_h8
from .cad_mesh_pipeline import _write_inp,_sha

PROFILES={
    'smoke':dict(seeds=dict(sector=4,core_rings=2,radial=2,per_pitch=2,head=4),maximumH8=10000,maximumBytes=2*1024*1024),
    'feature':dict(seeds=dict(sector=12,core_rings=2,radial=3,per_pitch=16,head=12),maximumH8=200000,maximumBytes=64*1024*1024),
}


def check_features(mesh,shape,boundary):
    from OCP.BRepClass3d import BRepClass3d_SolidClassifier
    from OCP.gp import gp_Pnt
    from OCP.TopAbs import TopAbs_IN,TopAbs_ON
    classifier=BRepClass3d_SolidClassifier(shape.wrapped)
    def inside(point):
        classifier.Perform(gp_Pnt(*point),1e-8)
        return classifier.State() in (TopAbs_IN,TopAbs_ON)
    floor=mesh.dims['socket']['floor']
    faces=mesh.nodes[boundary]
    patch=faces[np.all(abs(faces[:,:,2]-floor['z'])<1e-8,axis=1)]
    areas=.5*np.sum(patch[:,:,0]*np.roll(patch[:,:,1],-1,axis=1)-patch[:,:,1]*np.roll(patch[:,:,0],-1,axis=1),axis=1)
    area=float(abs(areas.sum()))
    relative=abs(area-floor['area'])/floor['area']
    centres=mesh.nodes[mesh.elems].mean(axis=1)
    above=centres[centres[:,2]>floor['z']+1e-6]
    outside=sum(not inside(tuple(p)) for p in above)
    if len(patch)!=mesh.dims['socket']['coreTopFaceCount'] or relative>1e-9 or outside:
        raise ValueError('Socket floor partition or recess material placement failed')
    if inside((0,0,(floor['z']+max(v.Z for v in shape.vertices()))/2)):
        raise ValueError('Source socket has no axial void')
    return dict(floorZ=floor['z'],floorFaces=len(patch),floorArea=area,cadFloorArea=floor['area'],
                relativeFloorAreaError=relative,aboveFloorCells=len(above),outsideCadHeadCellCentres=outside,
                coreStopsAtFloor=True,recessNotFilled=True)


def measure_feature_resolution(mesh,boundary,cad,request,seeds):
    """Measure actual represented features; file size is not a resolution metric."""
    pitch=float(request['size'].split('-')[1]);length=request['length']
    points=mesh.nodes[boundary]
    side=(np.ptp(points[:,:,2],axis=1)>1e-9)&(points[:,:,2].max(axis=1)<=-pitch)
    ids=np.unique(boundary[side])
    surface=mesh.nodes[ids]
    middle=surface[(surface[:,2]>=-length+2*pitch)&(surface[:,2]<=-2*pitch)]
    radii=np.hypot(middle[:,0],middle[:,1])
    start=-length/2-pitch/2
    reference_z=np.linspace(start,start+pitch,257)
    curves=[];errors=[]
    for theta in (0,30,60,90):
        angles=np.degrees(np.arctan2(middle[:,1],middle[:,0]))%360
        selected=middle[abs((angles-theta+180)%360-180)<1e-6]
        selected=selected[np.argsort(selected[:,2])]
        if len(selected)<seeds.per_pitch+1:
            raise ValueError('Feature model has insufficient axial profile samples')
        actual=np.array([cad.radii(theta,float(z))[1] for z in reference_z])
        represented=np.interp(reference_z,selected[:,2],np.hypot(selected[:,0],selected[:,1]))
        errors.append(float(np.max(abs(actual-represented))))
        if theta==0:
            r=np.hypot(selected[:,0],selected[:,1]);high=float(r.max())
            crest=np.flatnonzero(r>=high-1e-6)
            groups=np.split(crest,np.flatnonzero(np.diff(crest)>1)+1)
            groups=[g for g in groups if len(g) and g[0]>0 and g[-1]<len(r)-1]
            centres=np.array([selected[g,2].mean() for g in groups])
            widths=[float(selected[g[-1],2]-selected[g[0],2]) for g in groups]
            measured_pitch=float(np.median(np.diff(centres))) if len(centres)>1 else None
            crest_width=float(np.median(widths)) if widths else None
        curves.append(dict(angleDegrees=theta,maximumRadialPolylineError=float(np.max(abs(actual-represented)))))
    floor=mesh.dims['socket']['floor']['z']
    cap=boundary[np.all(abs(points[:,:,2]-floor)<1e-8,axis=1)]
    edges=np.sort(np.stack((cap,np.roll(cap,-1,axis=1)),axis=-1).reshape(-1,2),axis=1)
    unique,counts=np.unique(edges,axis=0,return_counts=True)
    perimeter=mesh.nodes[np.unique(unique[counts==1])]
    opening=np.hypot(perimeter[:,0],perimeter[:,1])
    return dict(axialSpacingInThread=pitch/seeds.per_pitch,samplesPerPitch=seeds.per_pitch,
                circumferentialSegments=6*seeds.sector,meshMajorDiameter=2*float(radii.max()),
                meshRootDiameter=2*float(radii.min()),meshRadialThreadDepth=float(radii.max()-radii.min()),
                measuredAxialPitch=measured_pitch,measuredCrestWidthAtZeroDegrees=crest_width,
                expectedNominalCrestWidth=pitch/8,maximumSampledAxialPolylineRadialError=max(errors),profiles=curves,
                socketAcrossFlats=2*float(opening.min()),socketAcrossCorners=2*float(opening.max()),
                socketDepth=cad.zmax-floor,headCircumferentialChordSagBound=max(abs(cad.bounds.max.X),abs(cad.bounds.max.Y))*(1-np.cos(np.pi/(6*seeds.sector))),
                stressConvergenceCertified=False,scope='Geometry representation measurements, not a loaded FE convergence study')


def generate(fixtures,output,node,profile='feature'):
    if profile not in PROFILES:
        raise ValueError('Select smoke or feature development profile')
    limits=PROFILES[profile]
    fixtures,output,node=map(lambda p:Path(p).resolve(),(fixtures,output,node))
    if output.exists() or not output.parent.is_dir() or not node.is_file():
        raise ValueError('Require a new development output and explicit Node executable')
    source=fixtures/'socket-M6'
    certificate=json.loads((source/'cad-report.json').read_text())
    request=certificate['request']
    if request.get('family')!='socket_bolt' or request.get('size')!='M6-1' or request.get('length')!=12:
        raise ValueError('This development fixture expects the saved M6-1 L12 socket CAD')
    seeds=MeshSeeds(**limits['seeds'])
    mesh,shape,sampler=map_saved_cad(source/'model.step',source/'cad-report.json',seeds)
    if len(mesh.elems)>limits['maximumH8']:
        raise ValueError('Development socket exceeded its profile element budget')
    report,boundary=audit_h8(mesh.nodes,mesh.elems,2)
    features=check_features(mesh,shape,boundary)
    estimate=estimate_mesh_volume(sampler,request,seeds)
    if abs(estimate-report['volume'])/report['volume']>1e-10:
        raise ValueError('Socket block volume and independent boundary integral disagree')
    relative=abs(report['volume']-certificate['reopenedVolume'])/certificate['reopenedVolume']
    resolution=measure_feature_resolution(mesh,boundary,sampler,request,seeds) if profile=='feature' else None
    project=Path(__file__).resolve().parents[2]
    import meshio
    with tempfile.TemporaryDirectory(prefix='socket-dev-',dir=output.parent) as temporary:
        stage=Path(temporary)/'result';stage.mkdir()
        mesh.nodes.astype('<f8').tofile(stage/'nodes.f64')
        mesh.elems.astype('<i4').tofile(stage/'elements.i32')
        (stage/'mesh-binary.json').write_text(json.dumps(dict(schemaVersion=1,nodes=len(mesh.nodes),elements=len(mesh.elems),developmentOnly=True)))
        result=subprocess.run([str(node),str(project/'scripts/export-cad-h8-binary.mjs'),str(stage)],cwd=project,text=True,capture_output=True,check=True,timeout=30)
        exported=json.loads(result.stdout)
        _write_inp(mesh,stage/'model.inp')
        parsed=meshio.read(stage/'model.inp',file_format='abaqus')
        if not np.array_equal(parsed.get_cells_type('hexahedron'),mesh.elems) or np.max(abs(parsed.points-mesh.nodes))>1e-8:
            raise ValueError('Socket development INP read-back mismatch')
        for name in ('nodes.f64','elements.i32','mesh-binary.json'):(stage/name).unlink()
        report.update(schemaVersion=1,purpose='development-complete-'+profile+'-model',developmentProfile=profile,notFullModelAcceptance=True,
                      matchedMeshVerified=False,request=request,seeds=asdict(seeds),socket=features,
                      featureResolution=resolution,
                      discreteVolumeAgreement=abs(estimate-report['volume'])/report['volume'],
                      relativeCadVolumeErrorMeasured=relative,strictCadVolumeLimit=1e-4,
                      strictCadVolumePassed=relative<=1e-4,kSHA256=exported['kSHA256'],inpSHA256=_sha(stage/'model.inp'),
                      sourceStepSHA256=certificate['stepSHA256'],maximumH8=limits['maximumH8'],maximumArtifactBytes=limits['maximumBytes'])
        certificate.update(developmentOnly=True,developmentProfile=profile,developmentKSHA256=report['kSHA256'],matchedMeshVerified=False,
                           meshVolume=report['volume'],relativeMeshVolumeError=relative)
        (stage/'cad-report.json').write_text(json.dumps(certificate,indent=2))
        (stage/'report.json').write_text(json.dumps(report,indent=2))
        if sum(p.stat().st_size for p in stage.rglob('*') if p.is_file())>limits['maximumBytes']:
            raise ValueError('Socket development output exceeded its profile byte budget')
        stage.rename(output)
    return report


def measure_existing(fixtures,directory):
    """Measure an existing feature model without regenerating its mesh."""
    directory=Path(directory).resolve()
    report=json.loads((directory/'report.json').read_text())
    if report.get('developmentProfile')!='feature' or _sha(directory/'model.inp')!=report['inpSHA256']:
        raise ValueError('Select a hash-verified feature-profile development model')
    source=Path(fixtures).resolve()/'socket-M6/model.step'
    if _sha(source)!=report['sourceStepSHA256']:
        raise ValueError('Source CAD differs from the feature model')
    import meshio
    from build123d import import_step
    from .cad_mesh import RadialCad
    from .cad_socket import socket_floor
    from .mesh_core import Mesh3D
    data=meshio.read(directory/'model.inp',file_format='abaqus')
    mesh=Mesh3D('MEASURE_SOCKET');mesh.nodes=data.points;mesh.elems=data.get_cells_type('hexahedron')
    shape=import_step(source);floor=socket_floor(shape)
    mesh.dims=dict(socket=dict(floor=floor))
    sampler=RadialCad(shape,hole=lambda z:z>floor['z']+1e-9)
    _,boundary=audit_h8(mesh.nodes,mesh.elems,2)
    result=measure_feature_resolution(mesh,boundary,sampler,report['request'],MeshSeeds(**report['seeds']))
    result.update(sourceKSHA256=report['kSHA256'],sourceINPSHA256=report['inpSHA256'],
                  sourceStepSHA256=report['sourceStepSHA256'],notFullModelAcceptance=True)
    (directory/'feature-resolution.json').write_text(json.dumps(result,indent=2))
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('fixtures',type=Path);p.add_argument('output',type=Path)
    p.add_argument('--node',type=Path);p.add_argument('--profile',choices=PROFILES,default='feature')
    p.add_argument('--measure-only',action='store_true');a=p.parse_args()
    if not a.measure_only and a.node is None:p.error('--node is required for generation')
    result=measure_existing(a.fixtures,a.output) if a.measure_only else generate(a.fixtures,a.output,a.node,a.profile)
    print(json.dumps(result,indent=2))
