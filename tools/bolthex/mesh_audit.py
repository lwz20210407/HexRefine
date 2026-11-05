"""Chunked H8 legacy project screen and explicit boundary-complex checks.

The default0.15 is retained for historical regression, NOT a vendor standard
or sufficient engineering acceptance. See h8_quality_report for explicitly
named corner+center SJ and determinant-ratio reference comparisons.
"""
from itertools import product
import numpy as np

SIGNS = np.array([[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]])
FACES = np.array([[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]])


def audit_h8(nodes, elements, expected_euler=None, minimum_sj=0.15):
    if type(minimum_sj) not in (int,float) or not np.isfinite(minimum_sj) or not 0<=minimum_sj<=1:
        raise ValueError('Invalid explicit project SJ screen')
    if nodes.ndim != 2 or nodes.shape[1] != 3 or not np.isfinite(nodes).all():
        raise ValueError('Invalid node coordinates')
    if elements.ndim != 2 or elements.shape[1] != 8 or not np.issubdtype(elements.dtype, np.integer) or not len(elements):
        raise ValueError('Require nonempty integer H8 connectivity')
    if elements.min() < 0 or elements.max() >= len(nodes) or np.any(np.diff(np.sort(elements,axis=1),axis=1) <= 0):
        raise ValueError('Invalid/repeated H8 node reference')
    if len(np.unique(np.sort(elements,axis=1),axis=0)) != len(elements):
        raise ValueError('Duplicate elements')
    min_corner = min_center_sj = min_center_det = min_gauss = float('inf')
    volume = 0.0
    for start in range(0,len(elements),32768):
        xyz = nodes[elements[start:start+32768]]
        xyz = xyz-xyz[:,:1]
        def jac(q):
            u,v,w=q
            derivatives=np.column_stack((SIGNS[:,0]*(1+SIGNS[:,1]*v)*(1+SIGNS[:,2]*w),
                                         SIGNS[:,1]*(1+SIGNS[:,0]*u)*(1+SIGNS[:,2]*w),
                                         SIGNS[:,2]*(1+SIGNS[:,0]*u)*(1+SIGNS[:,1]*v)))/8
            return np.einsum('eni,nj->eij',xyz,derivatives)
        for q in product((-1,1),repeat=3):
            j=jac(q)
            det=np.linalg.det(j);denominator=np.linalg.norm(j,axis=1).prod(axis=1)
            scaled=np.divide(det,denominator,out=np.full(len(xyz),np.nan),where=denominator>0)
            if not np.isfinite(scaled).all() or np.any(det<=0):
                raise ValueError('H8 quality rejected: nonpositive or undefined corner Jacobian')
            min_corner=min(min_corner,float(scaled.min()))
        j=jac((0.,0.,0.));det=np.linalg.det(j);denominator=np.linalg.norm(j,axis=1).prod(axis=1)
        scaled=np.divide(det,denominator,out=np.full(len(xyz),np.nan),where=denominator>0)
        if not np.isfinite(scaled).all() or np.any(det<=0):
            raise ValueError('H8 quality rejected: nonpositive or undefined center Jacobian')
        min_center_sj=min(min_center_sj,float(scaled.min()));min_center_det=min(min_center_det,float(det.min()))
        chunk_volumes=np.zeros(len(xyz))
        for q in product((-1/np.sqrt(3),1/np.sqrt(3)),repeat=3):
            d=np.linalg.det(jac(q))
            if not np.isfinite(d).all() or np.any(d<=0):
                raise ValueError('H8 quality rejected: nonpositive or undefined Gauss Jacobian')
            min_gauss=min(min_gauss,float(d.min()))
            chunk_volumes+=d
        if np.any(chunk_volumes<=0):
            raise ValueError('Nonpositive element volume')
        volume+=float(chunk_volumes.sum())
    min_sj=min(min_corner,min_center_sj)
    if not np.isfinite(min_sj) or min_sj < minimum_sj or min_gauss <= 0:
        raise ValueError(f'H8 quality rejected: minSJ={min_sj}, minGauss={min_gauss}')
    faces=elements[:,FACES].reshape(-1,4)
    _,first,counts=np.unique(np.sort(faces,axis=1),axis=0,return_index=True,return_counts=True)
    if np.any(counts>2):
        raise ValueError('Nonmanifold volume faces')
    boundary=faces[first[counts==1]]
    edges=np.sort(np.stack((boundary,np.roll(boundary,-1,axis=1)),axis=-1).reshape(-1,2),axis=1)
    unique_edges,edge_counts=np.unique(edges,axis=0,return_counts=True)
    if np.any(edge_counts!=2):
        raise ValueError('Open/nonmanifold boundary edges')
    euler=len(np.unique(boundary))-len(unique_edges)+len(boundary)
    if expected_euler is not None and euler != expected_euler:
        raise ValueError(f'Unexpected boundary Euler characteristic {euler}, expected {expected_euler}')
    return dict(nodes=len(nodes),elements=len(elements),volume=volume,minimumCornerScaledJacobian=min_corner,
                minimumGaussJacobian=min_gauss,boundaryFaces=len(boundary),boundaryEuler=int(euler),
                nonmanifoldFaces=0,nonmanifoldBoundaryEdges=0,
                minimumCenterJacobian=min_center_det,minimumCornerAndCenterScaledJacobian=min_sj,
                qualityScreenBasis='legacy-project-SJ-screen-not-vendor-standard',
                projectScaledJacobianFloor=minimum_sj,engineeringQualityAccepted=False,
                fullJacobianPositivityCertified=False),boundary
