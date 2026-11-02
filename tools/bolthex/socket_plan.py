"""Preflight socket H8 counts and discrete volume without allocating 3D cells."""
import argparse
import json
import math
from pathlib import Path
from types import SimpleNamespace
import numpy as np
from .cad_mesh import MeshSeeds,RadialCad,_z_layers,estimate_mesh_volume
from .cad_mesh_pipeline import _sha
from .cad_socket import socket_floor,socket_features


def topology_counts(shape,request,seeds):
    seeds.validate()
    if request.get('family')!='socket_bolt' or seeds.boundary_mapping!='radial' or seeds.z_features:
        raise ValueError('Socket preflight requires socket CAD and supported radial mapping')
    from .mesh_core import build_bolt_section
    floor=socket_floor(shape);height=max(v.Z for v in shape.vertices())
    diameter=float(request['size'].split('-')[0][1:]);pitch=float(request['size'].split('-')[1])
    length=request['length']
    if (type(length) not in (int,float) or not math.isfinite(length) or length<=0
            or not all(math.isfinite(v) and v>0 for v in (diameter,pitch))):
        raise ValueError('Socket design length, diameter and pitch must be finite and positive')
    count=6*seeds.sector
    if seeds.head_mapping=='fillet_blocks':
        from .cad_fillet import head_fillet,head_layers
        fillet=head_fillet(shape,floor)
        head,lower=head_layers(SimpleNamespace(zmax=height),floor,seeds,fillet)
        n=seeds.head_curve_segments
        head_elements=count*(seeds.radial*(len(head)-1)+n*(len(lower)-1)+3*(n//2)**2)
    else:
        features,_=socket_features(shape,floor,seeds.head_curve_segments)
        head=_z_layers(0,height,height/seeds.head,features)
        head_elements=count*seeds.radial*(len(head)-1)
    shaft_layers=max(1,math.ceil(length/(pitch/seeds.per_pitch)))
    core_layers=shaft_layers+int(np.sum((head>0)&(head<=floor['z'])))
    uniform=build_bolt_section(seeds.sector,seeds.core_rings,seeds.radial,diameter,diameter,ref_circle=True)
    if seeds.core_mapping.startswith('graded_2to1'):
        from .graded_core import build_graded_bolt_section
        core=build_graded_bolt_section(seeds.sector,seeds.core_rings,seeds.radial,diameter,
                                       compact=seeds.core_mapping=='graded_2to1_compact')
    else:
        core=uniform
    core_elements=len(core.quads)*core_layers
    return dict(elements=core_elements+head_elements,coreElements=core_elements,headElements=head_elements,
                coreSectionQuads=len(core.quads),coreLayers=core_layers,
                equivalentUniformCoreElements=len(uniform.quads)*core_layers,
                coreGrading=getattr(core,'grading',None))


def plan(cad_directory,seeds,maximum_elements=1_000_000):
    if type(maximum_elements) is not int or not 1<=maximum_elements<=5_000_000:
        raise ValueError('Preflight element limit must be an integer in [1,5000000]')
    seeds.validate()
    directory=Path(cad_directory).resolve()
    certificate=json.loads((directory/'cad-report.json').read_text())
    if (not certificate.get('acceptedAsIndependentCad') or not certificate.get('geometryIndependentOfMesh')
            or _sha(directory/'model.step')!=certificate.get('stepSHA256')):
        raise ValueError('Preflight requires hash-verified independent CAD')
    if not math.isfinite(certificate.get('reopenedVolume',float('nan'))) or certificate['reopenedVolume']<=0:
        raise ValueError('Invalid source CAD volume')
    from build123d import import_step
    shape=import_step(directory/'model.step')
    if not shape.is_valid or len(shape.solids())!=1:
        raise ValueError('Preflight requires one valid CAD solid')
    counts=topology_counts(shape,certificate['request'],seeds)
    result=dict(schemaVersion=1,purpose='socket-allocation-preflight',sourceStepSHA256=certificate['stepSHA256'],
                request=certificate['request'],seeds=seeds.__dict__,counts=counts,maximumElements=maximum_elements,
                fullModelAcceptance=False,cornerAndGaussAudited=False,nodeAndFaceMatchingAudited=False,
                volumeLimit=1e-4,relativeCadVolumeError=None,estimatedDiscreteVolume=None,acceptedForAllocation=False)
    if counts['elements']>maximum_elements:
        result['rejection']='element-budget'
        return result
    floor=socket_floor(shape)
    sampler=RadialCad(shape,hole=lambda z:z>floor['z']+1e-9)
    volume=estimate_mesh_volume(sampler,certificate['request'],seeds)
    error=abs(volume-certificate['reopenedVolume'])/certificate['reopenedVolume']
    result.update(estimatedDiscreteVolume=volume,relativeCadVolumeError=error,
                  acceptedForAllocation=math.isfinite(error) and error<=1e-4)
    result['rejection']=None if result['acceptedForAllocation'] else 'cad-volume'
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cad_directory',type=Path);parser.add_argument('--seeds',type=Path,required=True)
    parser.add_argument('--maximum-elements',type=int,default=1_000_000)
    args=parser.parse_args()
    report=plan(args.cad_directory,MeshSeeds(**json.loads(args.seeds.read_text())),args.maximum_elements)
    print(json.dumps(report,indent=2))
    raise SystemExit(0 if report['acceptedForAllocation'] else 2)
