"""Validate/export an entire implicit-field thread band as mesh-only K/INP."""
import argparse,json,math,subprocess,tempfile
from pathlib import Path
import numpy as np
from .helical_band import HelicalBandSpec,generate_band,volume_plan
from .mesh_audit import audit_h8
from .cad_mesh_pipeline import _write_inp,_sha


def field_witnesses(mesh,spec):
    n=4*spec.quadrant_segments;s=spec.radial_segments
    nodes=mesh.nodes.reshape(-1,s+1,n,3);thread=nodes[:,-1]
    profile=spec.profile();fn=profile.radius if spec.family=='external' else profile.internal_radius
    def errors(points):
        xyz=points.reshape(-1,3)
        radii=np.hypot(xyz[:,0],xyz[:,1]);angles=np.degrees(np.arctan2(xyz[:,1],xyz[:,0]))
        exact=np.array([fn(float(p[2]),float(theta)) for p,theta in zip(xyz,angles)])
        return float(np.max(abs(radii-exact)))
    centers=(thread[:-1]+np.roll(thread[:-1],-1,axis=1)+thread[1:]+np.roll(thread[1:],-1,axis=1))/4
    node_error=errors(thread);face_error=errors(centers)
    rim=spec.diameter/2+(-1 if spec.family=='external' else 1)*spec.rim_offset_pitches*spec.pitch
    rim_error=rim*(1-math.cos(math.pi/n))
    if node_error>2e-6 or max(face_error,rim_error)>.02:
        raise ValueError(f'Implicit-field boundary rejected: nodes={node_error}, face bound={max(face_error,rim_error)}')
    return dict(threadNodes=thread.shape[0]*n,threadFaces=centers.shape[0]*n,
                maximumNodalFieldRadiusError=node_error,maximumThreadFaceRadialDistanceBound=face_error,
                maximumRimFaceRadialDistanceBound=rim_error,nodeLimit=2e-6,faceLimit=.02,
                reference='continuous mathematical radius field, not independent CAD/BRep')


def generate(spec,output,node):
    plan=volume_plan(spec)
    if not math.isfinite(plan['relativeAnalyticVolumeError']) or plan['relativeAnalyticVolumeError']>1e-4:
        raise ValueError('Analytic-field volume error exceeds 1e-4 before 3D allocation; refine seeds')
    # Conservative fixed-format K plus decimal INP upper bound.
    if plan['nodes']*160+plan['elements']*220>128*1024*1024:
        raise ValueError('Development bundle exceeds its 128 MiB pre-allocation artifact budget')
    output,node=Path(output).resolve(),Path(node).resolve()
    if output.exists() or not output.parent.is_dir() or not node.is_file():
        raise ValueError('Require an explicit Node executable and new output directory')
    mesh=generate_band(spec);report,boundary=audit_h8(mesh.nodes,mesh.elems,0)
    if abs(report['volume']-plan['estimatedDiscreteVolume'])/report['volume']>1e-10:
        raise ValueError('H8 volume disagrees with independent swept-boundary integration')
    witnesses=field_witnesses(mesh,spec)
    import meshio
    project=Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix='helical-band-',dir=output.parent) as temporary:
        stage=Path(temporary)/'accepted';stage.mkdir()
        mesh.nodes.astype('<f8').tofile(stage/'nodes.f64');mesh.elems.astype('<i4').tofile(stage/'elements.i32')
        (stage/'mesh-binary.json').write_text(json.dumps(dict(schemaVersion=1,nodes=len(mesh.nodes),elements=len(mesh.elems),geometryReference='analytic-thread-field')))
        exported=subprocess.run([str(node),str(project/'scripts/export-cad-h8-binary.mjs'),str(stage)],
                                cwd=project,text=True,capture_output=True,timeout=60,check=True)
        summary=json.loads(exported.stdout)
        _write_inp(mesh,stage/'model.inp')
        reopened=meshio.read(stage/'model.inp',file_format='abaqus')
        if not np.array_equal(reopened.get_cells_type('hexahedron'),mesh.elems) or np.max(abs(reopened.points-mesh.nodes))>1e-8:
            raise ValueError('Helical band INP round trip changed the mesh')
        report.update(schemaVersion=1,purpose='analytic-field-thread-band',generator='indexed-helical-band',
                      spec=spec.__dict__,plan=plan,fieldWitnesses=witnesses,
                      analyticFieldMatched=True,independentCadVerified=False,matchedMeshVerified=False,
                      fullFastener=False,notFullModelAcceptance=True,
                      acceptanceScope='positive conforming H8 and continuous analytic-field geometry only',
                      kSHA256=summary['kSHA256'],inpSHA256=_sha(stage/'model.inp'),
                      volumeLimit=1e-4,minimumAllowedCornerSJ=.15,
                      limitations=['This is the entire upstream-style hollow thread band, not a full bolt/nut.',
                                   'No mesh-derived STEP, independent CAD or HM geometry is supplied.',
                                   'No GB/GJB edition/tolerance or solver convergence certification.'])
        (stage/'report.json').write_text(json.dumps(report,indent=2))
        for name in ('nodes.f64','elements.i32','mesh-binary.json'):(stage/name).unlink()
        if sum(p.stat().st_size for p in stage.iterdir())>128*1024*1024:raise ValueError('Bundle exceeded byte budget')
        stage.rename(output)
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('spec',type=Path);p.add_argument('output',type=Path)
    p.add_argument('--node',type=Path,required=True);a=p.parse_args()
    print(json.dumps(generate(HelicalBandSpec(**json.loads(a.spec.read_text())),a.output,a.node),indent=2))
