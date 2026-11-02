"""Boundary reparameterization of planar radial thread-runout caps.

The original STEP is unchanged. Two inner-loop vertices describe a radial cap
edge; the corresponding outer vertices lie on its material side. Outside the
cap's axial neighbourhood the ordinary angular parameterization is recovered.
"""
from __future__ import annotations

import math
import numpy as np


class NutRunoutMap:
    def __init__(self, sampler, count, pitch, lead_degrees=20.0, half_window=55.0):
        if count<96:
            raise ValueError('Runout mapping requires at least 96 circumferential seeds')
        self.sampler=sampler
        self.count=count
        self.pitch=pitch
        self.angles=np.arange(count)*360/count
        self.caps=[]
        self.cache={}
        self.snapped_nodes=0
        self.maximum_snapped_distance=0.0
        self.snap_height=.025
        for index,(face,_) in enumerate(sampler.faces):
            if face.geom_type.name!='PLANE':
                continue
            normal=face.normal_at();point=face.center()
            if abs(normal.Z)>1e-8 or abs(normal.X*point.X+normal.Y*point.Y)>1e-6:
                continue
            vertices=list(face.vertices())
            low,high=min(v.Z for v in vertices),max(v.Z for v in vertices)
            if high-low<1e-6:
                continue
            theta=math.degrees(math.atan2(point.Y,point.X))%360
            values=[]
            for t in (.15,.35,.5,.65,.85):
                z=low+t*(high-low)
                before=sampler.radii(theta-1e-5,z)[0]
                after=sampler.radii(theta+1e-5,z)[0]
                values.append((abs(after-before),after-before))
            peak,jump=max(values)
            if peak<1e-5:
                continue
            shift=math.copysign(lead_degrees,-jump)
            spacing=360/count
            first=math.floor((theta+shift)/spacing)*spacing
            cap=dict(face=index,theta=theta,zmin=low,zmax=high,jumpSign=math.copysign(1,jump),
                     refA=first,refB=first+spacing,window=half_window,
                     verticesZ=sorted(set(v.Z for v in vertices)),peakSampledJump=peak)
            self.caps.append(cap)
        for i,cap in enumerate(self.caps):
            for other in self.caps[:i]:
                angular=abs((cap['theta']-other['theta']+180)%360-180)
                axial=max(cap['zmin']-pitch,other['zmin']-pitch)<min(cap['zmax']+pitch,other['zmax']+pitch)
                if angular<2*(half_window+lead_degrees) and axial:
                    raise ValueError('Overlapping runout-cap mapping supports require a coupled planner')

    def _jump(self,cap,z):
        before=self.sampler.radii(cap['theta']-1e-5,z)[0]
        after=self.sampler.radii(cap['theta']+1e-5,z)[0]
        return before,after

    def axial_features(self):
        features=[]
        for cap in self.caps:
            stops=cap['verticesZ']
            features.extend(stops)
            features.extend((max(self.sampler.zmin,cap['zmin']-self.pitch),
                             min(self.sampler.zmax,cap['zmax']+self.pitch)))
            for a,b in zip(stops,stops[1:]):
                fa=abs(self._jump(cap,a)[1]-self._jump(cap,a)[0])-self.snap_height
                fb=abs(self._jump(cap,b)[1]-self._jump(cap,b)[0])-self.snap_height
                if fa*fb<0:
                    for _ in range(22):
                        mid=(a+b)/2
                        before,after=self._jump(cap,mid)
                        fm=abs(after-before)-self.snap_height
                        if fm*fa>0:a,fa=mid,fm
                        else:b=mid
                    features.append((a+b)/2)
        return sorted(set(features))

    def _weight(self,cap,z):
        distance=max(cap['zmin']-z,z-cap['zmax'],0)
        t=max(0,min(1,1-distance/self.pitch))
        return t*t*(3-2*t)

    def boundaries(self,z):
        key=round(float(z),11)
        if key in self.cache:
            return self.cache[key]
        physical=self.angles.copy()
        prescribed={}
        for cap in self.caps:
            weight=self._weight(cap,z)
            if weight==0:
                continue
            before,after=self._jump(cap,z)
            snap=min(1,abs(after-before)/self.snap_height)
            # Resolve the two one-sided cap limits before angular separation
            # falls inside the BRep seam tolerance; otherwise both queries can
            # land on the same endpoint and create a spurious axial jump.
            if 180/self.count*(1-snap)<1e-5:
                snap=1.0
            delta=180/self.count*(1-snap)
            c=cap['theta'];a=cap['refA'];b=cap['refB'];window=cap['window']
            refs=c+(self.angles-c+180)%360-180
            mask=(refs>=a-window)&(refs<=b+window)
            mapped=np.interp(refs[mask],[a-window,a,b,b+window],[a-window,c-delta,c+delta,b+window])
            physical[mask]+=weight*(mapped-refs[mask])
            if snap>=1-1e-10 and weight>=1-1e-10:
                prescribed[round(a*self.count/360)%self.count]=(c,before)
                prescribed[round(b*self.count/360)%self.count]=(c,after)
        inner=[];outer=[]
        for i,theta in enumerate(self.angles):
            angle=math.radians(theta)
            r=self.sampler.radii(float(theta),z)[1]
            outer.append((r*math.cos(angle),r*math.sin(angle)))
            if i in prescribed:
                theta,r=prescribed[i]
                angle=math.radians(theta)
                point=(r*math.cos(angle),r*math.sin(angle))
                distance=self.sampler.surface_witness_distance((*point,z))
                self.maximum_snapped_distance=max(self.maximum_snapped_distance,distance)
                self.snapped_nodes+=1
            else:
                theta=physical[i]
                angle=math.radians(theta)
                r=self.sampler.radii(float(theta),z)[0]
                point=(r*math.cos(angle),r*math.sin(angle))
            inner.append(point)
        result=np.array(outer),np.array(inner)
        self.cache[key]=result
        return result

    def section_xy(self,section,z):
        outer,inner=self.boundaries(z)
        index=np.rint(np.asarray(section.theta)*self.count/360).astype(int)%self.count
        t=np.asarray(section.alpha)[:,None]
        return t*outer[index]+(1-t)*inner[index]

    def report(self):
        return dict(mode='planar-radial-cap-reparameterization',caps=self.caps,
                    snapHeight=self.snap_height,snappedBoundaryNodes=self.snapped_nodes,
                    maximumSnappedNodeDistance=self.maximum_snapped_distance,
                    originalCadUnchanged=True)
