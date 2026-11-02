"""Circumferential 2:1 quad enrichment from a coarse solid core to a fine ring.

Each two-coarse/four-fine annular patch uses either twelve quads/nine interior
vertices or the opt-in compact six-quads/three-vertices chain. Extrusion
produces H8, not wedges or collapsed axis cells. This is
circumferential grading only; it does not claim isotropic 3D weak balancing.
"""
import math
import numpy as np
from .mesh_core import build_bolt_section


def paired_quad_patch(compact=False):
    boundary=np.array([[0,0],[1,0],[2,0],[2,1],[1.5,1],[1,1],[.5,1],[0,1]],dtype=float)
    if compact:
        # A three-node chain joins the two coarse edges to four fine edges.
        # The same eight boundary vertices make this interchangeable locally.
        points=np.vstack((boundary,[[.4,.45],[1.,.5],[1.6,.45]]))
        quads=[[0,1,9,8],[1,2,10,9],[2,3,4,10],
               [4,5,9,10],[5,6,8,9],[6,7,0,8]]
        return points,np.array(quads,dtype=np.int64)
    centre=np.array([1.,.5])
    direction=boundary-centre
    ring=centre+.25*direction/np.linalg.norm(direction,axis=1)[:,None]
    points=np.vstack((boundary,ring,centre))
    quads=[[i,(i+1)%8,8+(i+1)%8,8+i] for i in range(8)]
    quads.extend([[16,8+i,8+(i+1)%8,8+(i+2)%8] for i in range(0,8,2)])
    return points,np.array(quads,dtype=np.int64)


def build_graded_bolt_section(sector,core_rings,radial,diameter,compact=False):
    base=sector
    levels=0
    while base>12 and base%2==0:
        base//=2;levels+=1
    if levels==0 or base>12:
        raise ValueError('Graded core requires a sector count reducible by 2 to at most 12')
    radius=diameter/2
    inner=.4*radius;mid=.6*radius
    section=build_bolt_section(base,core_rings,3,2*inner,2*inner,ref_circle=True)
    section.alpha=[0.0]*len(section.alpha)
    section.qband=['coarse_core']*len(section.quads)
    lookup={tuple(np.round([x,y],12)):i for i,(x,y) in enumerate(zip(section.x,section.y))}
    def node(theta,r,alpha=0):
        a=math.radians(theta)
        point=(r*math.cos(a),r*math.sin(a))
        key=tuple(np.round(point,12))
        if key in lookup:
            return lookup[key]
        result=section.node(('graded_core',len(section.x)),*point,alpha,0,radius)
        lookup[key]=result
        return result
    reference,quads=paired_quad_patch(compact)
    weights=np.array([.5**i for i in range(levels)]);weights/=weights.sum()
    coarse=6*base
    low=inner
    for level,weight in enumerate(weights):
        high=low+(mid-inner)*weight
        if level==levels-1:high=mid
        for column in range(0,coarse,2):
            mapped=[node((column+u)*360/coarse,low+v*(high-low)) for u,v in reference]
            for q in quads:
                section.add_quad([mapped[q[0]],mapped[q[3]],mapped[q[2]],mapped[q[1]]],'graded_2to1',level,levels)
        low=high;coarse*=2
    for column in range(coarse):
        for j in range(radial):
            def p(i,k):
                t=(k/radial)**.75
                return node(i*360/coarse,mid+t*(radius-mid),t)
            section.add_quad([p(column,j),p(column,j+1),p(column+1,j+1),p(column+1,j)],'ring2',j,radial)
    section.n=sector
    section.grading=dict(mode='circumferential-2to1',levels=levels,coreCircumferentialSeeds=6*base,
                         threadCircumferentialSeeds=6*sector,transitionInnerRadius=inner,transitionOuterRadius=mid,
                         fineOuterRingPreserved=True,axialGrading=False,patchQuads=len(quads))
    return section
