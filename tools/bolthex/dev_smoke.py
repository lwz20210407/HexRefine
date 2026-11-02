"""Small saved-CAD runout regressions; never a complete-model acceptance job."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import numpy as np
from .cad_mesh import RadialCad,_sweep
from .cad_runout import NutRunoutMap
from .mesh_core import build_nut_section
from .mesh_audit import audit_h8
from .cad_mesh_pipeline import _write_inp

MAX_PATCH_H8=256
MAX_ARTIFACT_BYTES=1024*1024


def local_section(section,cap,count):
    step=360/count
    quads=np.array(section.quads,dtype=np.int64)
    theta=np.array(section.theta)[quads[:,0]]
    middle=(cap['refA']+cap['refB'])/2
    offset=(theta-middle+180)%360-180
    selected_ids=np.flatnonzero((offset>=-2.5*step-1e-8)&(offset<2.5*step-1e-8))
    selected=quads[selected_ids]
    used,remap=np.unique(selected,return_inverse=True)
    result=copy.copy(section)
    for name in ('x','y','rho','theta','alpha','beta','rout_ref'):
        setattr(result,name,np.array(getattr(section,name))[used].tolist())
    result.quads=remap.reshape(-1,4).tolist()
    for name in ('qband','qj','qjmax'):
        setattr(result,name,np.array(getattr(section,name))[selected_ids].tolist())
    result._key={('local',i):i for i in range(len(used))}
    return result


def generate(fixtures,output,node):
    fixtures,output,node=map(lambda p:Path(p).resolve(),(fixtures,output,node))
    if output.exists() or not output.parent.is_dir() or not node.is_file():
        raise ValueError('Require a new output directory and explicit Node executable')
    source=fixtures/'nut-M8'
    certificate=json.loads((source/'cad-report.json').read_text())
    request=certificate.get('request',{})
    if request.get('family')!='hex_nut' or request.get('size')!='M8-1.25' or request.get('thread_ends','library')!='library':
        raise ValueError('Select the original library-faded M8-1.25 CAD fixture')
    step=source/'model.step'
    sha=hashlib.sha256(step.read_bytes()).hexdigest()
    if sha!=certificate['stepSHA256'] or not certificate.get('geometryIndependentOfMesh') or not certificate.get('acceptedAsIndependentCad'):
        raise ValueError('Saved independent CAD fixture/hash is invalid')
    from build123d import import_step
    shape=import_step(step)
    if not shape.is_valid or len(shape.solids())!=1:
        raise ValueError('Development fixture must be one valid CAD solid')
    cad=RadialCad(shape,True)
    mapping=NutRunoutMap(cad,288,1.25)
    if len(mapping.caps)!=2:
        raise ValueError('This bounded development fixture expects two M8 runout caps')
    import meshio
    project=Path(__file__).resolve().parents[2]
    records=[]
    with tempfile.TemporaryDirectory(prefix='fastener-dev-',dir=output.parent) as temporary:
        stage=Path(temporary)/'result';stage.mkdir()
        for index,cap in enumerate(mapping.caps):
            section=local_section(build_nut_section(48,3,8,13),cap,288)
            features=[z for z in mapping.axial_features() if cap['zmin']<=z<=cap['zmax']]
            zs=sorted(set([cap['zmin']-.01,cap['zmax']+.01]+features))
            cell_count=len(section.quads)*(len(zs)-1)
            if not 0<cell_count<=MAX_PATCH_H8:
                raise ValueError(f'Development patch exceeds {MAX_PATCH_H8} H8: {cell_count}')
            mesh=_sweep(section,zs,None,name=f'DEV_RUNOUT_{index}',xy_map=mapping.section_xy)
            report,_=audit_h8(mesh.nodes,mesh.elems,2)
            patch=stage/f'cap-{index}';patch.mkdir()
            mesh.nodes.astype('<f8').tofile(patch/'nodes.f64')
            mesh.elems.astype('<i4').tofile(patch/'elements.i32')
            (patch/'mesh-binary.json').write_text(json.dumps(dict(schemaVersion=1,nodes=len(mesh.nodes),elements=len(mesh.elems),inspectionOnly=True)))
            subprocess.run([str(node),str(project/'scripts/export-cad-h8-binary.mjs'),str(patch)],cwd=project,capture_output=True,check=True,timeout=30)
            _write_inp(mesh,patch/'model.inp')
            reread=meshio.read(patch/'model.inp',file_format='abaqus')
            if not np.array_equal(reread.get_cells_type('hexahedron'),mesh.elems) or np.max(abs(reread.points-mesh.nodes))>1e-8:
                raise ValueError('Small development INP read-back failed')
            for name in ('nodes.f64','elements.i32','mesh-binary.json'):(patch/name).unlink()
            report.update(purpose='development-local-regression',notFullModelAcceptance=True,sourceStepSHA256=sha,
                          capIndex=index,circumferentialReferenceSeeds=288,actualPatchH8=cell_count)
            (patch/'report.json').write_text(json.dumps(report,indent=2))
            records.append(report)
        total=sum(p.stat().st_size for p in stage.rglob('*') if p.is_file())
        if total>MAX_ARTIFACT_BYTES:
            raise ValueError('Development artifacts exceeded the one-MiB output budget')
        result=dict(purpose='development-local-regression',notFullModelAcceptance=True,
                    totalH8=sum(r['elements'] for r in records),artifactBytes=None,
                    maximumH8PerPatch=MAX_PATCH_H8,maximumArtifactBytes=MAX_ARTIFACT_BYTES,
                    largeModelsGenerated=False,patches=records)
        for _ in range(4):
            (stage/'report.json').write_text(json.dumps(result,indent=2))
            final_total=sum(p.stat().st_size for p in stage.rglob('*') if p.is_file())
            if final_total>MAX_ARTIFACT_BYTES:
                raise ValueError('Development artifacts including manifest exceeded one MiB')
            if result['artifactBytes']==final_total:
                break
            result['artifactBytes']=final_total
        else:
            raise ValueError('Development artifact byte accounting did not stabilize')
        stage.rename(output)
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fixtures',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--node',required=True,type=Path)
    args=parser.parse_args();print(json.dumps(generate(args.fixtures,args.output,args.node),indent=2))
