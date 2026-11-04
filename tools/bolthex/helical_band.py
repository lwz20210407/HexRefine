"""Indexed helical H8 bands, independently implemented from mathematical fields.

Research workflow reference: sunwhale/thread at 582da3d. No upstream program
code is vendored. A thread band is not a complete bolt/nut or independent CAD.
"""
from dataclasses import dataclass,asdict
import math
import numpy as np
from .rounded_profile import RoundedResearchThreadProfile
from .mesh_core import Mesh3D


@dataclass(frozen=True)
class HelicalBandSpec:
    diameter:float=12.
    pitch:float=1.5
    cycles:float=1.
    family:str='external'
    quadrant_segments:int=16
    axial_per_pitch:int=16
    radial_segments:int=5
    radial_scheme:str='uniform'
    boundary_layers:int=1
    thread_offset_fraction:float|None=None
    rim_offset_pitches:float=1.
    external_rounding_ratio:float=math.sqrt(3)/12
    internal_rounding_ratio:float=math.sqrt(3)/24
    crest_height_fraction:float=.125
    female_flat_fraction:float=5/16
    handedness:str='right'
    element_limit:int=200000

    def validate(self):
        for key in ('diameter','pitch','cycles','rim_offset_pitches'):
            value=getattr(self,key)
            if type(value) not in (int,float) or not math.isfinite(value) or not 0<value<=1e6:
                raise ValueError(key+' must be finite, positive and bounded')
        for key in ('quadrant_segments','axial_per_pitch','radial_segments','boundary_layers'):
            value=getattr(self,key)
            if type(value) is not int or not 1<=value<=1024:raise ValueError(key+' must be an integer in [1,1024]')
        if self.family not in ('external','internal'):raise ValueError('family must be external or internal')
        if self.radial_scheme not in ('uniform','boundary_count','thread_offset'):raise ValueError('Unknown radial scheme')
        if self.boundary_layers>self.radial_segments:raise ValueError('Boundary layers cannot exceed radial segments')
        if self.radial_scheme!='boundary_count' and self.boundary_layers!=1:
            raise ValueError('boundary_layers is active only in boundary_count mode')
        if self.radial_scheme=='thread_offset':
            if type(self.thread_offset_fraction) not in (int,float) or not math.isfinite(self.thread_offset_fraction) or self.thread_offset_fraction<=0:
                raise ValueError('thread_offset requires a positive finite offset fraction')
            if self.radial_segments<2:raise ValueError('thread_offset needs at least two radial segments')
        elif self.thread_offset_fraction is not None:raise ValueError('Offset fraction is active only in thread_offset mode')
        if 4*self.quadrant_segments%self.axial_per_pitch:
            raise ValueError('Reference-compatible circumferential count must be divisible by axial_per_pitch')
        layers=self.cycles*self.axial_per_pitch
        if abs(layers-round(layers))>1e-9 or layers<1 or layers>100000:
            raise ValueError('cycles*axial_per_pitch must be a bounded positive integer; geometry is not rounded')
        if type(self.element_limit) is not int or not 1<=self.element_limit<=2000000:
            raise ValueError('Element limit must be an integer in [1,2000000]')
        count=round(layers)*4*self.quadrant_segments*self.radial_segments
        if count>self.element_limit:raise ValueError('Helical band exceeds element budget before allocation')
        self.profile()

    def profile(self):
        return RoundedResearchThreadProfile(self.diameter,self.pitch,self.handedness,1,
            self.external_rounding_ratio,self.internal_rounding_ratio,self.crest_height_fraction,self.female_flat_fraction)


def radial_stations(spec):
    spec.validate();profile=spec.profile();n=4*spec.quadrant_segments
    fn=profile.radius if spec.family=='external' else profile.internal_radius
    thread=np.array([fn(0,360*i/n) for i in range(n)])
    direction=1 if spec.family=='external' else -1
    rim=spec.diameter/2-direction*spec.rim_offset_pitches*spec.pitch
    if rim<=0 or np.any(direction*(thread-rim)<=0):raise ValueError('Thread band crosses its reference cylinder or axis')
    s=spec.radial_segments
    if spec.radial_scheme=='thread_offset':
        near=thread-direction*spec.pitch*spec.thread_offset_fraction
        if np.any(direction*(near-rim)<=0):raise ValueError('Thread offset consumes the whole radial band')
        result=np.vstack((rim+(near-rim)*np.linspace(0,1,s)[:,None],thread))
    else:
        if spec.radial_scheme=='uniform':weights=np.linspace(0,1,s+1)
        else:
            coarse=s-spec.boundary_layers
            start=coarse/(coarse+1)
            weights=np.concatenate((np.arange(coarse+1)/(coarse+1),
                                    np.linspace(start,1,spec.boundary_layers+1)[1:]))
        result=rim+(thread-rim)*weights[:,None]
    if np.any(direction*np.diff(result,axis=0)<=1e-12*spec.diameter):raise ValueError('Degenerate radial layer')
    return result


def volume_plan(spec):
    radial=radial_stations(spec);n=radial.shape[1]
    step=n//spec.axial_per_pitch
    def area(inner,outer):return .5*math.sin(math.tau/n)*np.sum(outer*np.roll(outer,-1)-inner*np.roll(inner,-1))
    inner,outer=(radial[0],radial[-1]) if spec.family=='external' else (radial[-1],radial[0])
    midpoint_inner=(inner+np.roll(inner,step))/2;midpoint_outer=(outer+np.roll(outer,step))/2
    height=spec.cycles*spec.pitch
    discrete=height*(area(inner,outer)+2*area(midpoint_inner,midpoint_outer))/3
    profile=spec.profile();fn=profile.radius if spec.family=='external' else profile.internal_radius
    if spec.family=='external':breaks=[0,math.sqrt(3)*math.pi*spec.external_rounding_ratio,(1-spec.crest_height_fraction)*math.pi,math.pi]
    else:breaks=[0,spec.female_flat_fraction*math.pi,math.pi*(1-math.sqrt(3)*spec.internal_rounding_ratio),math.pi]
    q,w=np.polynomial.legendre.leggauss(48);integral=0.
    for a,b in zip(breaks,breaks[1:]):
        phi=(a+b)/2+(b-a)*q/2
        values=np.array([fn(0,math.degrees(t))**2 for t in phi])
        integral+=(b-a)/2*float(w@values)
    rim=radial[0,0]
    analytic=height*(integral-math.pi*rim**2)*(1 if spec.family=='external' else -1)
    cells=round(spec.cycles*spec.axial_per_pitch)*n*spec.radial_segments
    return dict(elements=cells,nodes=(round(spec.cycles*spec.axial_per_pitch)+1)*n*(spec.radial_segments+1),
                height=height,estimatedDiscreteVolume=float(discrete),analyticFieldVolume=float(analytic),
                relativeAnalyticVolumeError=abs(discrete-analytic)/analytic,
                independentCadVerified=False,fullFastener=False)


def generate_band(spec):
    radial=radial_stations(spec)
    n=4*spec.quadrant_segments;s=spec.radial_segments;layers=round(spec.cycles*spec.axial_per_pitch)
    sign=1 if spec.handedness=='right' else -1
    indices=(np.arange(n)[None,:]-sign*np.arange(layers+1)[:,None]*(n//spec.axial_per_pitch))%n
    radii=radial[:,indices].transpose(1,0,2)
    angles=math.tau*np.arange(n)/n
    zs=np.arange(layers+1)*spec.pitch/spec.axial_per_pitch
    nodes=np.stack((radii*np.cos(angles),radii*np.sin(angles),np.broadcast_to(zs[:,None,None],radii.shape)),axis=-1).reshape(-1,3)
    k,row,column=np.indices((layers,s,n));base=(k*(s+1)+row)*n
    a=(base+column).ravel();b=(base+(column+1)%n).ravel();c=b+n;d=a+n
    quads=np.column_stack((a,d,c,b)) if spec.family=='external' else np.column_stack((a,b,c,d))
    mesh=Mesh3D('HELICAL_'+spec.family.upper()+'_BAND')
    mesh.nodes=nodes;mesh.elems=np.column_stack((quads,quads+(s+1)*n))
    mesh.regions=['THREAD_BAND']*len(mesh.elems);mesh.region_names=['THREAD_BAND']
    mesh.dims=dict(spec=asdict(spec),role='hollow-thread-band-not-full-fastener',
                   rotationalIndexing='exact-integer-cyclic',sourceReference='sunwhale/thread@582da3d')
    return mesh
