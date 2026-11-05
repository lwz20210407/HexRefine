"""Complete hemispherical cap-shell H8 partition using five cubed-sphere charts.

Not a whole cap nut: the equatorial annulus still needs a body/shoulder interface.
Chart seams share exact integer direction keys, not coordinate-tolerance welding.
"""
import argparse,json,math,subprocess,tempfile
from pathlib import Path
import numpy as np
from .mesh_core import Mesh3D
from .mesh_audit import audit_h8


def _seed_counts(divisions,radial_layers,element_limit):
    if type(divisions) is not int or not 4<=divisions<=256 or divisions%2:raise ValueError('Dome divisions must be even and in [4,256]')
    if type(radial_layers) is not int or not 1<=radial_layers<=8:raise ValueError('Dome radial layers must be in [1,8]')
    if type(element_limit) is not int or not 1<=element_limit<=200000:raise ValueError('Dome H8 budget must be in [1,200000]')
    count=3*divisions**2*radial_layers
    if count>element_limit:raise ValueError(f'Dome needs {count} H8, above the allocation budget')
    return count


def build_shell(center,inner,outer,divisions=128,radial_layers=1,element_limit=100000):
    if not isinstance(center,(list,tuple)) or len(center)!=3 or any(type(v) not in (int,float) or not math.isfinite(v) for v in center):raise ValueError('Finite sphere center required')
    if any(type(v) not in (int,float) or not math.isfinite(v) for v in (inner,outer)) or not 0<inner<outer:raise ValueError('Require positive concentric inner/outer radii')
    count=_seed_counts(divisions,radial_layers,element_limit)
    half=divisions//2;directions=[];indices={};quads=[];partitions=[]
    def node(key):
        if key not in indices:indices[key]=len(directions);directions.append(key)
        return indices[key]
    for name,vertical,reverse in [('top',False,False),('x+',True,False),('x-',True,True),('y+',True,True),('y-',True,False)]:
        begin=len(quads)
        us=range(-half,half);vs=range(0,half) if vertical else range(-half,half)
        def key(u,v):
            if name=='top':return (u,v,half)
            if name=='x+':return (half,u,v)
            if name=='x-':return (-half,u,v)
            if name=='y+':return (u,half,v)
            return (u,-half,v)
        for v in vs:
            for u in us:
                keys=[key(u,v),key(u+1,v),key(u+1,v+1),key(u,v+1)]
                if reverse:keys=[keys[0],keys[3],keys[2],keys[1]]
                quads.append([node(k) for k in keys])
        partitions.append(dict(name=name,firstQuad=begin,quads=len(quads)-begin))
    directions=np.asarray(directions,dtype=float)
    directions/=np.linalg.norm(directions,axis=1)[:,None]
    surface_size=len(directions);radii=np.linspace(inner,outer,radial_layers+1)
    nodes=np.concatenate([np.asarray(center)+radius*directions for radius in radii])
    quads=np.asarray(quads,dtype=np.int64)
    cells=np.concatenate([np.column_stack((quads+k*surface_size,quads+(k+1)*surface_size)) for k in range(radial_layers)])
    if len(cells)!=count or surface_size!=3*divisions**2+2*divisions+1:raise ValueError('Dome chart ownership/count mismatch')
    quality,boundary=audit_h8(nodes,cells,expected_euler=2)
    exact=2*math.pi*(outer-inner)*(outer**2+outer*inner+inner**2)/3
    error=abs(quality['volume']-exact)/exact
    if error>1e-4:raise ValueError(f'Whole dome volume error {error} exceeds 1e-4; refine angular seeds')
    residual=max(float(np.max(abs(np.linalg.norm(nodes[:surface_size]-center,axis=1)-inner))),
                 float(np.max(abs(np.linalg.norm(nodes[-surface_size:]-center,axis=1)-outer))))
    if residual>2e-6:raise ValueError('Dome spherical boundary residual exceeds 2e-6 mm')
    mesh=Mesh3D('CAD_CAP_DOME');mesh.nodes=nodes;mesh.elems=cells
    mesh.regions=['DOME']*len(cells);mesh.region_names=['DOME']
    report=dict(schemaVersion=1,purpose='whole-hemispherical-shell-partition',fullDome=True,fullCapNut=False,fullModelAcceptance=False,
                quality=quality,divisions=divisions,radialLayers=radial_layers,chartCount=5,charts=partitions,
                centerMm=list(center),innerRadiusMm=inner,outerRadiusMm=outer,
                sharedSeams='exact integer direction entities',surfaceNodesPerRadius=surface_size,equatorialSegments=4*divisions,
                analyticVolume=exact,relativeAnalyticVolumeError=error,maximumSphereNodeDistance=residual,
                axisCollapse=False,eightDistinctNodesPerElement=True,artificialInterfaces=['equatorial-annulus'],
                limitations=['Complete dome partition only; not the shoulder/threaded body or whole cap nut',
                             'Equatorial angular seeds require a compatible body/shoulder interface',
                             'Not a 2:1 or 3:1 count-transition implementation'])
    mesh.dims=report
    layers=boundary//surface_size
    equator=np.all(abs(nodes[boundary,2]-center[2])<1e-10,axis=1)
    if not np.all(np.all(layers==0,axis=1)|np.all(layers==radial_layers,axis=1)|equator):raise ValueError('Dome has unexpected free faces at chart seams')
    if int(equator.sum())!=4*divisions*radial_layers:raise ValueError('Dome equatorial interface is incomplete')
    report['equatorialBoundaryFaces']=int(equator.sum())
    centroids=nodes[cells].mean(axis=1)-np.asarray(center)
    centroid_radii=np.linalg.norm(centroids,axis=1)
    if np.any(centroid_radii<inner-1e-9) or np.any(centroid_radii>outer+1e-9) or np.any(centroids[:,2]<-1e-9):
        raise ValueError('Dome cell centroid is outside the source spherical-shell material')
    face_centers=nodes[boundary].mean(axis=1)-np.asarray(center)
    face_radii=np.linalg.norm(face_centers,axis=1);plane_radial=np.hypot(face_centers[:,0],face_centers[:,1])
    plane_distance=np.hypot(face_centers[:,2],np.maximum(np.maximum(inner-plane_radial,plane_radial-outer),0))
    distances=np.where(np.all(layers==0,axis=1),abs(face_radii-inner),
                       np.where(np.all(layers==radial_layers,axis=1),abs(face_radii-outer),plane_distance))
    if float(distances.max())>.02:raise ValueError('Dome boundary face-center distance exceeds .02 mm')
    report.update(allElementCentroidsInMaterial=True,maximumBoundaryFaceCenterDistance=float(distances.max()))
    return mesh,boundary,report


def equatorial_interface(mesh):
    """Ordered, zero-based node rings and outward -Z faces of the annular cut.

    The gnomonic angles are deliberately not replaced with uniform angles.
    Consumers can reuse these exact points instead of reprojecting a seam.
    """
    report=mesh.dims;size=report['surfaceNodesPerRadius'];center=np.asarray(report['centerMm'])
    ids=np.flatnonzero(abs(mesh.nodes[:size,2]-center[2])<1e-10)
    points=mesh.nodes[ids]-center
    angles=np.mod(np.arctan2(points[:,1],points[:,0]),2*math.pi)
    order=np.argsort(angles);ids=ids[order];angles=angles[order]
    if len(ids)!=report['equatorialSegments'] or np.any(np.diff(angles)<=0):raise ValueError('Dome equatorial angle ownership mismatch')
    rings=np.asarray([ids+k*size for k in range(report['radialLayers']+1)])
    faces=[]
    for k in range(report['radialLayers']):
        for i in range(len(ids)):
            j=(i+1)%len(ids);faces.append([rings[k,i],rings[k,j],rings[k+1,j],rings[k+1,i]])
    return dict(thetaDeg=np.rad2deg(angles).tolist(),nodeRings=rings,faces=np.asarray(faces,dtype=np.int64),
                coordinates=mesh.nodes[rings].copy(),centerMm=report['centerMm'],
                radiiMm=np.linspace(report['innerRadiusMm'],report['outerRadiusMm'],report['radialLayers']+1).tolist())


def build_cad_dome(shape,divisions=128,radial_layers=1,element_limit=100000):
    _seed_counts(divisions,radial_layers,element_limit)
    from .cad_cap_plan import spherical_cap
    from .standard_cad import _mass
    from build123d import Solid
    cap=spherical_cap(shape);center=cap['outer']['centerMm'];inner=cap['inner']['radiusMm'];outer=cap['outer']['radiusMm']
    mesh,boundary,report=build_shell(center,inner,outer,divisions,radial_layers,element_limit)
    cut=Solid.make_box(4*outer,4*outer,2*outer).translate((center[0]-2*outer,center[1]-2*outer,center[2]))
    local=shape&cut
    if local is None or not local.is_valid or len(local.solids())!=1:raise ValueError('Source dome partition did not produce one valid CAD solid')
    cad_volume=_mass(local);analytic_error=abs(cad_volume-report['analyticVolume'])/cad_volume
    error=abs(cad_volume-report['quality']['volume'])/cad_volume
    if analytic_error>1e-7 or error>1e-4:raise ValueError('Source CAD dome/analytic/H8 volume gates failed')
    # The planner independently verifies complete trimmed hemispheres, so the
    # sphere equations certify all curved nodes; the cut annulus is planar.
    report.update(sourceCap=cap,sourceCadPartitionVolume=cad_volume,relativeCadAnalyticVolumeError=analytic_error,
                  relativeCadH8VolumeError=error,
                  surfaceWitnessMethod='analytic membership on independently recognized complete trimmed hemispheres',
                  sourceCadUnmodified=True,partitionIndependentOfMeshSeeds=True)
    return mesh,local,report


def _publish_partition(step,output,node,mesh,local,report,source_hash,validation_python=None,*,preserve_source_step=False):
    from .cad_mesh_pipeline import _write_inp,_sha
    from .standard_cad import _mass,CAD_ROUNDTRIP_VOLUME_LIMIT
    from build123d import import_step
    step,output,node=map(lambda p:Path(p).resolve(),(step,output,node))
    if output.exists() or not output.parent.is_dir() or not node.is_file():raise ValueError('Require fresh output and explicit Node executable')
    if not 0<step.stat().st_size<=16777216:raise ValueError('Dome source STEP budget is 16 MiB')
    if _sha(step)!=source_hash:raise ValueError('Source cap CAD changed before publication')
    native_readback=len(mesh.elems)<=200000
    if validation_python is not None and not Path(validation_python).is_file():raise ValueError('Independent validation Python does not exist')
    if not native_readback and (validation_python is None or not Path(validation_python).is_file()):
        raise ValueError('Large cap partitions require explicit independent PyDYNA Python')
    if preserve_source_step and (report.get('fullCapNut') is not True or report.get('sourceCadUnmodified') is not True):
        raise ValueError('Only the unchanged complete source domain may retain the original STEP bytes')
    project=Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix='cap-dome-',dir=output.parent) as temporary:
        stage=Path(temporary)/'result';stage.mkdir()
        mesh.nodes.astype('<f8').tofile(stage/'nodes.f64');mesh.elems.astype('<i4').tofile(stage/'elements.i32')
        (stage/'mesh-binary.json').write_text(json.dumps(dict(schemaVersion=1,nodes=len(mesh.nodes),elements=len(mesh.elems),
            inspectionOnly=not report.get('fullCapNut',False),developmentOnly=report.get('developmentOnly',False),readback=native_readback,
            expectedVolume=report['quality']['volume'],expectedEuler=report['quality']['boundaryEuler'])))
        result=subprocess.run([str(node),str(project/'scripts/export-cad-h8-binary.mjs'),str(stage)],cwd=project,capture_output=True,text=True,check=True,timeout=120)
        exported=json.loads(result.stdout);_write_inp(mesh,stage/'model.inp')
        if validation_python is not None:
            checked=subprocess.run([str(validation_python),'-B','-m','tools.bolthex.validate_binary_k',str(stage)],cwd=project,
                                   capture_output=True,text=True,timeout=180,check=True)
            independent=json.loads(checked.stdout)
            if independent['kSHA256']!=exported['kSHA256']:raise ValueError('Independent K audit hash differs')
            report['independentKReadback']=independent
        import meshio
        reopened=meshio.read(stage/'model.inp',file_format='abaqus')
        loss=float(np.max(abs(reopened.points-mesh.nodes)))
        if loss>1e-10 or not np.array_equal(reopened.get_cells_type('hexahedron'),mesh.elems):raise ValueError('Dome INP readback differs')
        if preserve_source_step:
            import shutil
            shutil.copyfile(step,stage/'model.step')
            if _sha(stage/'model.step')!=source_hash:raise ValueError('Preserved source STEP copy differs')
            report['cadExchangeMethod']='unchanged-source-STEP-byte-copy-and-independent-reimport'
        else:
            from .cad_step_export import export_step_detached
            geometry_exchange=export_step_detached(local,stage/'model.step',source_step=step)
            geometry_exchange['outputStep']=str(output/'model.step')
            report['cadGeometryExchange']=geometry_exchange
            report['cadExchangeMethod']=geometry_exchange['method']
        roundtrip=_mass(import_step(stage/'model.step'))
        cad_exchange=abs(roundtrip-report['sourceCadPartitionVolume'])/report['sourceCadPartitionVolume']
        if cad_exchange>CAD_ROUNDTRIP_VOLUME_LIMIT:raise ValueError('Dome independent CAD exchange volume rejected')
        report.update(sourceStep=str(step),sourceStepSHA256=source_hash,kSHA256=exported['kSHA256'],
                      kReadback=exported.get('nativeReadback',report.get('independentKReadback')),
                      inpSHA256=_sha(stage/'model.inp'),inpReadbackCoordinateError=loss,partitionStepSHA256=_sha(stage/'model.step'),
                      cadExchangeRelativeVolumeError=cad_exchange,unit='mm')
        if _sha(step)!=source_hash:raise ValueError('Source cap CAD changed during generation')
        (stage/'report.json').write_text(json.dumps(report,indent=2,allow_nan=False))
        for name in ('nodes.f64','elements.i32','mesh-binary.json'):(stage/name).unlink()
        stage.rename(output)
    return report


def generate(step,output,node,divisions=128,radial_layers=1):
    _seed_counts(divisions,radial_layers,100000)
    from .cad_mesh_pipeline import _sha
    from build123d import import_step
    step,output,node=map(lambda p:Path(p).resolve(),(step,output,node))
    if output.exists() or not output.parent.is_dir() or not node.is_file():raise ValueError('Require fresh output and explicit Node executable')
    if not 0<step.stat().st_size<=16777216:raise ValueError('Dome source STEP budget is 16 MiB')
    source_hash=_sha(step);mesh,local,report=build_cad_dome(import_step(step),divisions,radial_layers)
    return _publish_partition(step,output,node,mesh,local,report,source_hash)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('step',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--node',type=Path,required=True);parser.add_argument('--divisions',type=int,default=128)
    parser.add_argument('--radial-layers',type=int,default=1)
    args=parser.parse_args();print(json.dumps(generate(args.step,args.output,args.node,args.divisions,args.radial_layers),indent=2))
