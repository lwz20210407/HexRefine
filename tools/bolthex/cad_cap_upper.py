"""Explicitly join a complete dome to its real-bore late-runout shoulder.

The upper cylindrical CAD crop is complete, NOT the full hex/threaded cap nut.
Only paired interface node IDs are shared; no proximity welding is used.
"""
import argparse,json,math
from collections import Counter
from dataclasses import replace
from pathlib import Path
import numpy as np
from .mesh_core import Mesh3D
from .mesh_audit import audit_h8,FACES
from .cad_cap_dome import build_cad_dome,equatorial_interface,_seed_counts,_publish_partition
from .cad_cap_shoulder import ShoulderSpec,build_m6_shoulder,shoulder_equatorial_interface


def _cycle(face):
    values=tuple(map(int,face));return min(values[i:]+values[:i] for i in range(4))


def join_interfaces(first,second,a,b):
    """Return combined nodes/cells, mapping and a shared-face ownership audit."""
    x,y=np.asarray(a['nodeRings']),np.asarray(b['nodeRings'])
    if x.ndim!=2 or x.shape!=y.shape or not np.issubdtype(x.dtype,np.integer) or not np.issubdtype(y.dtype,np.integer):raise ValueError('Interface node-ring dimensions differ')
    x,y=x.ravel(),y.ravel()
    if (not len(x) or len(np.unique(x))!=len(x) or len(np.unique(y))!=len(y)
            or x.min()<0 or x.max()>=len(first.nodes) or y.min()<0 or y.max()>=len(second.nodes)):
        raise ValueError('Invalid or duplicate interface node ownership')
    if not np.array_equal(first.nodes[x],second.nodes[y]):raise ValueError('Interface coordinates differ; no tolerance welding permitted')
    mapping=np.full(len(second.nodes),-1,dtype=np.int64);mapping[y]=x
    rest=np.flatnonzero(mapping<0);mapping[rest]=np.arange(len(first.nodes),len(first.nodes)+len(rest))
    nodes=np.concatenate((first.nodes,second.nodes[rest]));cells=np.concatenate((first.elems,mapping[second.elems]))
    inventories=[]
    for item,ids,remap in ((a,x,None),(b,y,mapping)):
        faces=np.asarray(item['faces'])
        if faces.ndim!=2 or faces.shape[1]!=4 or not np.issubdtype(faces.dtype,np.integer) or not np.isin(faces,ids).all():raise ValueError('Invalid interface face partition')
        if remap is not None:faces=remap[faces]
        inventory={tuple(sorted(map(int,f))):_cycle(f) for f in faces}
        if len(inventory)!=len(faces):raise ValueError('Duplicate interface faces')
        inventories.append(inventory)
    left,right=inventories
    if not left or left.keys()!=right.keys() or any(right[k]!=_cycle(left[k][::-1]) for k in left):raise ValueError('Shared face partitions or orientations differ')
    faces=cells[:,FACES].reshape(-1,4)
    touching=faces[np.isin(faces,x).all(axis=1)]
    ownership=Counter(tuple(sorted(map(int,f))) for f in touching)
    if ownership.keys()!=left.keys() or any(n!=2 for n in ownership.values()):raise ValueError('Interface must have exactly two owners per face')
    return nodes,cells,mapping,dict(sharedNodes=len(x),sharedFaces=len(left),twoOwnersEveryFace=True,coordinatesUnmodified=True)


def build_upper(shape,divisions=128,radial_layers=1,lower_depth=.1):
    if type(lower_depth) not in (int,float) or not math.isfinite(lower_depth) or not 0<lower_depth<=.2:raise ValueError('Late-runout depth must be in (0,.2] mm')
    count=_seed_counts(divisions,radial_layers,100000)+4*divisions*(2+radial_layers)*8
    if count>100000:raise ValueError('Combined upper-cap allocation exceeds 100000 H8')
    dome,_,dome_report=build_cad_dome(shape,divisions,radial_layers)
    eq=equatorial_interface(dome);center=np.asarray(eq['centerMm']);radii=eq['radiiMm']
    if max(abs(center[:2]))>1e-10:raise ValueError('Upper-cap shoulder currently requires a centered M6 axis')
    spec=replace(ShoulderSpec(),circumferential=len(eq['thetaDeg']),step_inner=radii[0],outer=radii[-1],
                 step=float(center[2]),bottom=float(center[2]-lower_depth),wall_radial=radial_layers,lower_layers=8)
    directions=(eq['coordinates'][0,:,:2]-center[:2])/radii[0]
    shoulder,shoulder_cad,shoulder_report=build_m6_shoulder(shape,spec,theta_deg=eq['thetaDeg'],directions_xy=directions,
                                                         equator_coordinates=eq['coordinates'],include_upper=False)
    out=shoulder_equatorial_interface(shoulder)
    if shoulder.nodes[:,2].max()>center[2]+1e-12 or dome.nodes[:,2].min()<center[2]-1e-12:raise ValueError('Upper-cap components overlap across the join plane')
    nodes,cells,mapping,interface=join_interfaces(dome,shoulder,eq,out)
    quality,boundary=audit_h8(nodes,cells,2)
    volume_sum=dome_report['quality']['volume']+shoulder_report['quality']['volume']
    conservation=abs(quality['volume']-volume_sum)/volume_sum
    if len(cells)!=count or conservation>1e-10:raise ValueError('Joined cap count or volume conservation failed')
    joined_faces={tuple(sorted(map(int,f))) for f in eq['faces']}
    if any(tuple(sorted(map(int,f))) in joined_faces for f in boundary):raise ValueError('Joined cap retains free interface faces')
    from build123d import Solid
    from .standard_cad import _mass
    extent=radii[-1]*2
    cylinder=Solid.make_cylinder(radii[-1],extent).translate((center[0],center[1],spec.bottom))
    local=shape&cylinder
    if local is None or not local.is_valid or len(local.solids())!=1:raise ValueError('Independent upper-cap CAD crop is not one solid')
    cad_volume=_mass(local)
    component_volume=dome_report['sourceCadPartitionVolume']+_mass(shoulder_cad)
    partition_error=abs(cad_volume-component_volume)/cad_volume
    error=abs(cad_volume-quality['volume'])/cad_volume
    if partition_error>1e-7 or error>1e-4:raise ValueError('Independent upper-cap CAD partition or H8 volume failed')
    mesh=Mesh3D('CAP_UPPER_CROP');mesh.nodes=nodes;mesh.elems=cells
    mesh.regions=['DOME']*len(dome.elems)+list(shoulder.regions);mesh.region_names=list(dict.fromkeys(mesh.regions))
    report=dict(schemaVersion=1,purpose='conformal-complete-upper-cap-crop',fullUpperCapCrop=True,fullDome=True,fullCapNut=False,fullModelAcceptance=False,
                quality=quality,interface=interface,regions=dict(Counter(mesh.regions)),sourceCadPartitionVolume=cad_volume,
                relativeCadH8VolumeError=error,relativeComponentCadPartitionError=partition_error,relativeAssemblyVolumeError=conservation,
                sourceCadUnmodified=True,partitionIndependentOfMeshSeeds=True,componentDomainsDisjoint=True,
                artificialInterfaces=['outer-cylinder-below-join','bottom-plane'],bottomZMm=spec.bottom,joinZMm=spec.step,
                outerCutRadiusMm=spec.outer,dome=dome_report,shoulder=shoulder_report,
                limitations=['Original outer hex shoulder and body below the cut are not included',
                             'This upper crop does not certify a complete threaded cap nut or native HM',
                             'Explicit node pairing preserves interfaces; no existing far field is expanded'])
    mesh.dims=report
    return mesh,local,report


def generate(step,output,node,divisions=128,lower_depth=.1):
    from build123d import import_step
    from .cad_mesh_pipeline import _sha
    step,output,node=map(lambda p:Path(p).resolve(),(step,output,node))
    if output.exists() or not output.parent.is_dir() or not node.is_file():raise ValueError('Require new upper-cap output and explicit Node')
    if not 0<step.stat().st_size<=16777216:raise ValueError('Upper-cap STEP budget is 16 MiB')
    digest=_sha(step);mesh,local,report=build_upper(import_step(step),divisions,lower_depth=lower_depth)
    return _publish_partition(step,output,node,mesh,local,report,digest)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('step',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--node',type=Path,required=True);parser.add_argument('--divisions',type=int,default=128)
    parser.add_argument('--lower-depth',type=float,default=.1)
    args=parser.parse_args();print(json.dumps(generate(args.step,args.output,args.node,args.divisions,args.lower_depth),indent=2))
