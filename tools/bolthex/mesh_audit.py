"""Chunked H8 corner/Gauss audit and explicit boundary-complex checks."""
from itertools import product
import numpy as np

SIGNS = np.array([[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]])
FACES = np.array([[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]])


def audit_h8(nodes, elements, expected_euler=None, minimum_sj=0.15):
    if nodes.ndim != 2 or nodes.shape[1] != 3 or not np.isfinite(nodes).all():
        raise ValueError('Invalid node coordinates')
    if elements.ndim != 2 or elements.shape[1] != 8 or not np.issubdtype(elements.dtype, np.integer) or not len(elements):
        raise ValueError('Require nonempty integer H8 connectivity')
    if elements.min() < 0 or elements.max() >= len(nodes) or np.any(np.diff(np.sort(elements,axis=1),axis=1) <= 0):
        raise ValueError('Invalid/repeated H8 node reference')
    if len(np.unique(np.sort(elements,axis=1),axis=0)) != len(elements):
        raise ValueError('Duplicate elements')
    min_corner = min_gauss = float('inf')
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
            min_corner=min(min_corner,float((np.linalg.det(j)/np.linalg.norm(j,axis=1).prod(axis=1)).min()))
        chunk_volumes=np.zeros(len(xyz))
        for q in product((-1/np.sqrt(3),1/np.sqrt(3)),repeat=3):
            d=np.linalg.det(jac(q))
            min_gauss=min(min_gauss,float(d.min()))
            chunk_volumes+=d
        if np.any(chunk_volumes<=0):
            raise ValueError('Nonpositive element volume')
        volume+=float(chunk_volumes.sum())
    if not np.isfinite(min_corner) or min_corner < minimum_sj or min_gauss <= 0:
        raise ValueError(f'H8 quality rejected: minSJ={min_corner}, minGauss={min_gauss}')
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
                nonmanifoldFaces=0,nonmanifoldBoundaryEdges=0),boundary
