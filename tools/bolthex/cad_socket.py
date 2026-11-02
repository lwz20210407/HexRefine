"""Solid socket-bolt blocks: shaft/lower-head core and a continuous head annulus."""
from __future__ import annotations
import math
import numpy as np


def socket_floor(shape):
    maximum=max(v.Z for v in shape.vertices())
    candidates=[]
    for index,face in enumerate(shape.faces()):
        if face.geom_type.name!='PLANE':
            continue
        normal=face.normal_at();point=face.center()
        if abs(abs(normal.Z)-1)>1e-8 or not 1e-6<point.Z<maximum-1e-6:
            continue
        if face.distance_to((0,0,point.Z))<=1e-7:
            candidates.append((point.Z,index,face.area))
    levels=sorted(set(round(item[0],9) for item in candidates))
    if len(levels)!=1:
        raise ValueError('Socket mapper requires one exposed planar floor crossing the axis')
    floor=min(candidates)
    return dict(z=floor[0],face=floor[1],area=sum(c[2] for c in candidates))


def socket_features(shape,floor,segments=6):
    result=[floor['z']]
    rounded=[]
    for face in shape.faces():
        if face.geom_type.name!='TORUS':
            continue
        zs=[v.Z for v in face.vertices()]
        if zs and min(zs)>floor['z']:
            low,high=min(zs),max(zs)
            if high-low>1e-6:
                result.extend(np.linspace(low,high,segments+1))
                rounded.append([low,high])
    return result,rounded


def map_socket_bolt(shape,request,seeds):
    from .cad_mesh import RadialCad,_sweep,_z_layers,_join_exact
    from .mesh_core import build_bolt_section,build_head_ring_section
    floor=socket_floor(shape)
    features,rounded=socket_features(shape,floor,seeds.head_curve_segments)
    cad=RadialCad(shape,hole=lambda z:z>floor['z']+1e-9)
    radius=float(request['size'].split('-')[0][1:])/2
    pitch=float(request['size'].split('-')[1])
    count=6*seeds.sector
    angles=np.arange(count)*360/count
    shaft_top={i:cad.radii(float(theta),-1e-7)[1] for i,theta in enumerate(angles)}
    opening={i:cad.radii(float(theta),floor['z']+1e-6)[0] for i,theta in enumerate(angles)}
    if min(opening.values())<=0:
        raise ValueError('CAD socket does not open above its floor')
    def core_outer(theta,z):
        if z<0:
            return cad.radii(theta,z)[1]
        i=round((theta%360)*count/360)%count
        t=min(1,max(0,z/floor['z']))
        return (1-t)*shaft_top[i]+t*opening[i]
    def annulus_inner(theta,z):
        if z<=floor['z']:
            return core_outer(theta,z)
        return cad.radii(theta,z)[0]
    fillet=None
    if seeds.head_mapping=='fillet_blocks':
        from .cad_fillet import head_fillet,head_layers
        fillet=head_fillet(shape,floor)
        head_zs,_=head_layers(cad,floor,seeds,fillet)
    else:
        head_zs=_z_layers(0,cad.zmax,cad.zmax/seeds.head,features)
    core_zs=np.concatenate((_z_layers(-request['length'],0,pitch/seeds.per_pitch),head_zs[(head_zs>0)&(head_zs<=floor['z'])]))
    if seeds.core_mapping.startswith('graded_2to1'):
        from .graded_core import build_graded_bolt_section
        core_section=build_graded_bolt_section(seeds.sector,seeds.core_rings,seeds.radial,2*radius,
                                              compact=seeds.core_mapping=='graded_2to1_compact')
    else:
        core_section=build_bolt_section(seeds.sector,seeds.core_rings,seeds.radial,2*radius,2*radius,ref_circle=True)
    core=_sweep(core_section,core_zs,core_outer,name='SOCKET_CORE')
    maximum=max(abs(cad.bounds.min.X),abs(cad.bounds.max.X),abs(cad.bounds.min.Y),abs(cad.bounds.max.Y))
    if fillet:
        from .cad_fillet import filleted_head
        head,head_zs=filleted_head(cad,floor,seeds,annulus_inner,fillet,radius)
    else:
        head_section=build_head_ring_section(seeds.sector,seeds.radial,radius,2*maximum)
        head_section.beta=[1-a for a in head_section.alpha]
        head=_sweep(head_section,head_zs,lambda t,z:cad.radii(t,max(z,1e-7))[1],annulus_inner,'SOCKET_HEAD')
    mesh=_join_exact(core,head,'CAD_SOCKET_BOLT')
    mesh.dims=dict(request=request,seeds=seeds.__dict__,source='saved-independent-STEP',
                   featurePlanes=dict(socketFloor=floor['z']),socket=dict(floor=floor,roundedHeadBands=rounded,
                   coreStopsAtFloor=True,recessIsVoid=True,coreTopFaceCount=len(core_section.quads)))
    if fillet:mesh.dims['socket']['filletBlocks']=fillet
    if seeds.core_mapping.startswith('graded_2to1'):
        mesh.dims['coreGrading']=core_section.grading
    return mesh,shape,cad


def estimate_socket_volume(cad,request,seeds):
    from .cad_mesh import _z_layers
    floor=socket_floor(cad.shape)
    features,_=socket_features(cad.shape,floor,seeds.head_curve_segments)
    pitch=float(request['size'].split('-')[1])
    angles=np.arange(6*seeds.sector)*60/seeds.sector
    head_zs=_z_layers(0,cad.zmax,cad.zmax/seeds.head,features)
    bands=[(_z_layers(-request['length'],0,pitch/seeds.per_pitch),False),
           (head_zs[head_zs<=floor['z']],False),(head_zs[head_zs>=floor['z']],True)]
    sine=math.sin(math.tau/len(angles))
    def area(r):return .5*sine*np.sum(r*np.roll(r,-1))
    volume=0.0
    for band,(zs,hole) in enumerate(bands):
        if seeds.head_mapping=='fillet_blocks' and band>0:
            continue
        previous=None
        for z in zs:
            query=min(z,-1e-7) if band==0 else max(z,floor['z']+1e-6) if hole else max(z,1e-7)
            radii=np.array([cad.radii(float(theta),query) for theta in angles])
            if not hole:radii[:,0]=0
            if previous is not None:
                before,z0=previous;mid=(before+radii)/2
                volume+=(z-z0)/6*sum(weight*(area(r[:,1])-area(r[:,0])) for weight,r in [(1,before),(4,mid),(1,radii)])
            previous=radii,z
    if seeds.head_mapping=='fillet_blocks':
        from .cad_fillet import head_fillet,discrete_head_volume
        volume+=discrete_head_volume(cad,floor,seeds,head_fillet(cad.shape,floor))
    return float(volume)
