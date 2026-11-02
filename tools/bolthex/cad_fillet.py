"""Conforming meridian blocks for a coaxial, quarter-torus socket-head fillet."""
import math
import numpy as np


def quarter_disk(radius,segments):
    """Python equivalent of the native TS circularCorePoint three-patch map."""
    if not math.isfinite(radius) or radius<=0:
        raise ValueError('Fillet radius must be finite and positive')
    if type(segments) is not int or not 4<=segments<=256 or segments%2:
        raise ValueError('Fillet radius/arc segment count must be even and at least four')
    n=segments//2;extent=radius/2;join=.42*radius
    points=[];quads=[];registry={}
    def point(patch,i,j):
        u,v=i/n,j/n
        if patch=='center':
            xy=(extent*u+(join-extent)*u*v,extent*v+(join-extent)*u*v)
        else:
            t,s=(u,v) if patch=='y' else (v,u)
            inner=(join*t,extent+(join-extent)*t) if patch=='y' else (extent+(join-extent)*t,join*t)
            theta=(1-t/2 if patch=='y' else t/2)*math.pi/2
            outer=(radius*math.cos(theta),radius*math.sin(theta))
            xy=tuple(a*(1-s)+b*s for a,b in zip(inner,outer))
        key=tuple(round(x/radius,13) for x in xy)
        if key not in registry:
            registry[key]=len(points);points.append(xy)
        return registry[key]
    for patch in ('center','x','y'):
        for j in range(n):
            for i in range(n):
                quads.append([point(patch,i,j),point(patch,i+1,j),point(patch,i+1,j+1),point(patch,i,j+1)])
    return np.array(points),np.array(quads,dtype=np.int64)


def head_fillet(shape,floor):
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    candidates=[]
    for face in shape.faces():
        if face.geom_type.name!='TORUS':continue
        torus=BRepAdaptor_Surface(face.wrapped).Torus();axis=torus.Axis().Direction();location=torus.Location()
        major,minor=torus.MajorRadius(),torus.MinorRadius()
        zs=[v.Z for v in face.vertices()]
        if abs(abs(axis.Z())-1)>1e-9 or math.hypot(location.X(),location.Y())>1e-8:
            continue
        if min(zs)>floor['z'] and abs(min(zs)-location.Z())<1e-7 and abs(max(zs)-location.Z()-minor)<1e-7:
            candidates.append(dict(major=major,minor=minor,z=location.Z()))
    if len(candidates)!=1:
        raise ValueError('Fillet blocks require one coaxial quarter-torus above the socket floor')
    return candidates[0]


def head_layers(cad,floor,seeds,fillet):
    from .cad_mesh import _z_layers
    lower=_z_layers(0,fillet['z'],cad.zmax/seeds.head,[floor['z']])
    upper=fillet['z']+fillet['minor']*np.arange(1,seeds.head_curve_segments+1)/seeds.head_curve_segments
    return np.concatenate((lower,upper)),lower


def filleted_head(cad,floor,seeds,inner,fillet,reference_radius):
    from .cad_mesh import _sweep,_join_exact
    from .mesh_core import build_head_ring_section,Mesh3D
    major,minor,z0=fillet['major'],fillet['minor'],fillet['z']
    zs,lower=head_layers(cad,floor,seeds,fillet)
    count=6*seeds.sector
    curve=seeds.head_curve_segments
    expected=count*(seeds.radial*(len(zs)-1)+curve*(len(lower)-1)+3*(curve//2)**2)
    if expected>5_000_000:
        raise ValueError('Fillet head exceeds the bounded five-million H8 allocation limit')
    # A changing or chamfered recess requires another block vocabulary.
    for theta in np.arange(count)*360/count:
        values=[cad.radii(float(theta),z)[0] for z in (floor['z']+1e-6,z0,cad.zmax-1e-6)]
        if max(values)-min(values)>2e-6 or max(values)>=major:
            raise ValueError('Fillet blocks require a straight recess inside the fillet major radius')
    def annulus(nr,rin,rout):
        section=build_head_ring_section(seeds.sector,nr,rin,2*rout)
        section.beta=[1-a for a in section.alpha]
        return section
    inside=_sweep(annulus(seeds.radial,reference_radius,major),zs,lambda t,z:major,inner,'SOCKET_HEAD_INNER')
    outside=_sweep(annulus(seeds.head_curve_segments,major,major+minor),lower,
                   lambda t,z:major+minor,lambda t,z:major,'SOCKET_HEAD_LOWER_FILLET')
    head=_join_exact(inside,outside,'SOCKET_HEAD')
    meridian,quads=quarter_disk(minor,seeds.head_curve_segments)
    meridian=meridian+np.array([major,z0]);width=len(meridian)
    nodes=[];elems=[]
    for i in range(count):
        angle=math.tau*i/count
        nodes.extend((r*math.cos(angle),r*math.sin(angle),z) for r,z in meridian)
        bottom=quads[:,[0,3,2,1]]+i*width
        top=quads[:,[0,3,2,1]]+((i+1)%count)*width
        elems.extend(np.column_stack((bottom,top)))
    corner=Mesh3D('SOCKET_FILLET');corner.nodes=np.array(nodes);corner.elems=np.array(elems,dtype=np.int64)
    corner.regions=['CAD_MAPPED']*len(elems)
    return _join_exact(head,corner,'SOCKET_HEAD_FILLET'),zs


def discrete_head_volume(cad,floor,seeds,fillet):
    major,minor,z0=fillet['major'],fillet['minor'],fillet['z']
    count=6*seeds.sector;factor=count*math.sin(math.tau/count)
    angles=np.arange(count)*360/count
    holes=np.array([cad.radii(float(t),floor['z']+1e-6)[0] for t in angles])
    hole_area=.5*math.sin(math.tau/count)*sum(holes*np.roll(holes,-1))
    phi=np.linspace(0,math.pi/2,seeds.head_curve_segments+1)
    boundary=np.vstack(([0,0],np.column_stack((minor*np.cos(phi),minor*np.sin(phi)))))
    following=np.roll(boundary,-1,axis=0)
    cross=boundary[:,0]*following[:,1]-following[:,0]*boundary[:,1]
    area=.5*cross.sum();moment=(cross*(boundary[:,0]+following[:,0])).sum()/6
    return float(.5*factor*(major+minor)**2*z0-hole_area*(z0-floor['z'])
                 +(.5*factor*major**2-hole_area)*minor+factor*(major*area+moment))
