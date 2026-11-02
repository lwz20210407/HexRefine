"""Generate and verify a bounded independent-CAD/mapped-H8 delivery bundle."""
from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile

import numpy as np
from .cad_mesh import MeshSeeds, map_saved_cad, estimate_mesh_volume
from .mesh_audit import audit_h8


def _sha(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024),b''):
            digest.update(block)
    return digest.hexdigest()


def _write_inp(mesh, path):
    with path.open('w',encoding='ascii',newline='\n') as stream:
        stream.write('*HEADING\n** Independent CAD mapped H8; mesh only, coordinates in mm\n*PART, NAME='+mesh.name+'\n*NODE\n')
        for i,p in enumerate(mesh.nodes,1):
            stream.write(f'{i}, {p[0]:.12f}, {p[1]:.12f}, {p[2]:.12f}\n')
        stream.write('*ELEMENT, TYPE=C3D8R, ELSET=EALL\n')
        for i,e in enumerate(mesh.elems,1):
            stream.write(str(i)+', '+', '.join(str(int(n)+1) for n in e)+'\n')
        stream.write('*END PART\n')


def _face_worker_init(step,request):
    global _FACE_SAMPLER,_FACE_REQUEST
    from build123d import import_step
    from .cad_mesh import RadialCad
    _FACE_SAMPLER=RadialCad(import_step(step),request['family']=='hex_nut')
    _FACE_REQUEST=request


def _face_worker(block):
    sampler,request=_FACE_SAMPLER,_FACE_REQUEST
    maximum=radial_maximum=0.0
    exact=planes=radials=0
    for x,y,z,planar in block:
        theta=math.degrees(math.atan2(y,x))%360
        radius=math.hypot(x,y)
        if planar:
            allowed=[sampler.zmin,sampler.zmax]+([0] if request['family']=='hex_bolt' else [])
            plane_error=min(abs(z-p) for p in allowed)
            if plane_error>1e-8:
                raise ValueError('Unexpected interior free planar face')
            if request['family']=='hex_bolt' and abs(z)<1e-10:
                inner=sampler.radii(theta,-1e-8)[1]
                outer=sampler.radii(theta,1e-8)[1]
            else:
                inner,outer=sampler.radii(theta,z)
            error=max(plane_error,inner-radius,radius-outer,0)
            planes+=1
        else:
            inner,outer=sampler.radii(theta,z)
            error=min(abs(radius-r) for r in [outer]+([inner] if inner else []))
            radials+=1
        radial_maximum=max(radial_maximum,error)
        if error>.02:
            error=sampler.surface_witness_distance((x,y,z),tolerance=.02)
            exact+=1
        maximum=max(maximum,error)
    return dict(maximum=maximum,radialMaximum=radial_maximum,exact=exact,planes=planes,radials=radials,
                seamFallbacks=sampler.seam_fallbacks,maxFallback=sampler.max_fallback_distance)


def _cad_boundary_check(mesh, boundary, shape, sampler, request, step):
    """Test every boundary face centre against its actual CAD radial/plane map.

    Nodes originate from kernel intersections; face-centre error measures the
    additional straight-H8 discretization, not just nodal projection quality.
    """
    faces=mesh.nodes[boundary]
    blocks=np.column_stack((faces.mean(axis=1),np.ptp(faces[:,:,2],axis=1)<1e-10))
    del faces
    jobs=[blocks[i:i+4096] for i in range(0,len(blocks),4096)]
    with ProcessPoolExecutor(max_workers=2,initializer=_face_worker_init,initargs=(str(step),request)) as pool:
        results=list(pool.map(_face_worker,jobs))
    max_face_error=max(r['maximum'] for r in results)
    max_radial_error=max(r['radialMaximum'] for r in results)
    exact_face_queries=sum(r['exact'] for r in results)
    plane_count=sum(r['planes'] for r in results)
    radial_count=sum(r['radials'] for r in results)
    if max_face_error>0.02 or sampler.max_fallback_distance>2e-6:
        raise ValueError(f'CAD boundary matching rejected: distance bound={max_face_error}')
    # Independent nearest-shell checks include seams, end planes, and regular
    # surfaces. All remaining side nodes retain exact CAD intersection witnesses.
    ids=np.unique(boundary)
    probe_ids=ids[np.linspace(0,len(ids)-1,min(256,len(ids)),dtype=int)]
    maximum=max(sampler.surface_witness_distance(tuple(mesh.nodes[i])) for i in probe_ids)
    if maximum>2e-6:
        raise ValueError(f'CAD boundary node distance rejected: {maximum}')
    return dict(allBoundaryFacesChecked=True,boundaryNodes=len(ids),nearestShellProbeNodes=len(probe_ids),
                maximumProbedNodeDistance=maximum,maximumFaceCentreDistanceBound=max_face_error,
                maximumFaceCentreRadialError=max_radial_error,exactFaceDistanceQueries=exact_face_queries,
                radialFaces=radial_count,planarFaces=plane_count,rayIntersections=sampler.queries,
                maximumIntersectionLineResidual=sampler.max_hit_residual,
                seamFallbacks=sampler.seam_fallbacks,maximumSeamFallbackDistance=sampler.max_fallback_distance,
                nodeDistanceLimit=2e-6,faceCentreDistanceLimit=.02,
                scope='All face centres; CAD ray witnesses for side nodes; 256 independent nearest-shell node probes')


def generate(cad_directory, output, node, seeds=MeshSeeds()):
    cad_directory,output=Path(cad_directory).resolve(),Path(output).resolve()
    node=Path(node).resolve()
    if output.exists() or not output.parent.is_dir() or not node.is_file():
        raise ValueError('Require explicit Node executable and a new output directory')
    step=cad_directory/'model.step'
    source_certificate=cad_directory/'cad-report.json'
    certificate=json.loads(source_certificate.read_text(encoding='utf-8'))
    mesh,shape,sampler=map_saved_cad(step,source_certificate,seeds)
    request=certificate['request']
    print(f'Mapped {len(mesh.elems)} H8; auditing',flush=True)
    report,boundary=audit_h8(mesh.nodes,mesh.elems,0 if request['family']=='hex_nut' else 2)
    relative=abs(report['volume']-certificate['reopenedVolume'])/certificate['reopenedVolume']
    if relative>1e-4:
        raise ValueError(f'Mapped mesh CAD volume error {relative} exceeds 1e-4; refine seeds, do not change CAD')
    estimate=estimate_mesh_volume(sampler,request,seeds)
    if abs(estimate-report['volume'])/report['volume']>1e-10:
        raise ValueError('Interior cell volume disagrees with independent swept-boundary volume')
    print('Volume/SJ/topology accepted; checking CAD boundary',flush=True)
    matching=_cad_boundary_check(mesh,boundary,shape,sampler,request,step)
    project=Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix='cad-h8-',dir=output.parent) as temporary:
        stage=Path(temporary)/'accepted';stage.mkdir()
        mesh.nodes.astype('<f8').tofile(stage/'nodes.f64')
        mesh.elems.astype('<i4').tofile(stage/'elements.i32')
        (stage/'mesh-binary.json').write_text(json.dumps(dict(schemaVersion=1,nodes=len(mesh.nodes),elements=len(mesh.elems))))
        command=subprocess.run([str(node),str(project/'scripts/export-cad-h8-binary.mjs'),str(stage)],cwd=project,
                               text=True,capture_output=True,timeout=300,check=True)
        exported=json.loads(command.stdout)
        _write_inp(mesh,stage/'model.inp')
        import meshio
        reopened=meshio.read(stage/'model.inp',file_format='abaqus')
        cells=reopened.get_cells_type('hexahedron')
        error=float(np.max(np.abs(reopened.points-mesh.nodes)))
        if not np.array_equal(cells,mesh.elems) or error>1e-8 or len(reopened.cells)!=1:
            raise ValueError('Independent INP read-back changed mesh geometry or H8 connectivity')
        report.update(schemaVersion=1,generator='independent-STEP-mapped-H8',request=request,seeds=asdict(seeds),
                      matchedMeshVerified=True,matching=matching,relativeCadVolumeError=relative,
                      volumeLimit=1e-4,minimumAllowedCornerSJ=.15,inpReadbackCoordinateError=error,
                      kSHA256=exported['kSHA256'],inpSHA256=_sha(stage/'model.inp'),partId=1,
                      limitations=['Bounded metric external-hex bolt/open-nut topology only',
                                   'H8 approximates CAD curved faces; finite interpolation error is measured',
                                   'No socket/cap mesh or GB/tolerance-class certification'])
        certificate.update(meshVolume=report['volume'],relativeMeshVolumeError=relative,matchedMeshVerified=True,
                           matchedKSHA256=report['kSHA256'],matchedINPSHA256=report['inpSHA256'],matching=matching,
                           sourceCadCertificateSHA256=_sha(source_certificate))
        certificate['limitations']=[value for value in certificate.get('limitations',[]) if not value.startswith('No corresponding H8 mesh yet')]
        shutil.copyfile(step,stage/'model.step')
        (stage/'cad-report.json').write_text(json.dumps(certificate,indent=2),encoding='utf-8')
        (stage/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        for name in ['nodes.f64','elements.i32','mesh-binary.json']:
            (stage/name).unlink()
        stage.rename(output)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cad_directory',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--node',required=True,type=Path)
    parser.add_argument('--seeds',required=True,type=Path)
    args=parser.parse_args()
    print(json.dumps(generate(args.cad_directory,args.output,args.node,MeshSeeds(**json.loads(args.seeds.read_text()))),indent=2))
