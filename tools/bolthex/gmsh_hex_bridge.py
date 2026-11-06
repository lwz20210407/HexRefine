"""Conforming tetra-to-H8 bridge using the installed optional Gmsh engine.

This does not fill a cavity or repair a Screw. It preserves a supplied linear
tet domain, tracks exact topological barycentre supports, and exposes its
three-quad subdivision of each boundary triangle for a separately verified
attachment. No nearest-coordinate welding of output meshes is performed.
"""
from collections import Counter, defaultdict
from itertools import combinations

import numpy as np

from .mesh_audit import SIGNS,audit_h8
from .h8_quality_report import measure_h8,summarize_h8


MAX_TETS=50000
MAX_NODES=100000
TET_FACES=((0,2,1),(0,1,3),(1,2,3),(2,0,3))


def _cycle(values):
    values=tuple(map(int,values))
    return min(values[i:]+values[:i] for i in range(len(values)))


def _volumes(nodes,elements):
    result=np.zeros(len(elements))
    for start in range(0,len(elements),32768):
        xyz=nodes[elements[start:start+32768]];xyz=xyz-xyz[:,:1]
        for u in (-1/np.sqrt(3),1/np.sqrt(3)):
            for v in (-1/np.sqrt(3),1/np.sqrt(3)):
                for w in (-1/np.sqrt(3),1/np.sqrt(3)):
                    d=np.column_stack((SIGNS[:,0]*(1+SIGNS[:,1]*v)*(1+SIGNS[:,2]*w),
                        SIGNS[:,1]*(1+SIGNS[:,0]*u)*(1+SIGNS[:,2]*w),
                        SIGNS[:,2]*(1+SIGNS[:,0]*u)*(1+SIGNS[:,1]*v)))/8
                    result[start:start+len(xyz)]+=np.linalg.det(np.einsum('eni,nj->eij',xyz,d))
    return result


def _input(nodes,tetrahedra,node_ids):
    p=np.asarray(nodes)
    t=np.asarray(tetrahedra)
    if (p.ndim!=2 or p.shape[1]!=3 or not 4<=len(p)<=MAX_NODES
            or not np.issubdtype(p.dtype,np.number) or np.iscomplexobj(p)
            or not np.isfinite(p).all() or np.max(abs(p))>1e9):
        raise ValueError('Require bounded finite real XYZ nodes')
    if (t.ndim!=2 or t.shape[1]!=4 or not 1<=len(t)<=MAX_TETS
            or not np.issubdtype(t.dtype,np.integer) or t.min()<0 or t.max()>=len(p)
            or np.any(np.diff(np.sort(t,axis=1),axis=1)<=0)):
        raise ValueError('Require bounded nondegenerate integer TET4 references')
    if len(np.unique(np.sort(t,axis=1),axis=0))!=len(t):
        raise ValueError('Duplicate tetrahedra')
    if len(np.unique(t))!=len(p):raise ValueError('Remove unused core nodes before conversion')
    ids=np.arange(1,len(p)+1,dtype=np.int64) if node_ids is None else np.asarray(node_ids)
    if (ids.shape!=(len(p),) or not np.issubdtype(ids.dtype,np.integer)
            or ids.min()<=0 or ids.max()>2**53-1 or len(np.unique(ids))!=len(ids)):
        raise ValueError('Require unique positive bounded original node IDs')
    p=np.array(p,dtype=float,copy=True);t=np.array(t,dtype=np.int64,copy=True);ids=np.array(ids,dtype=np.int64,copy=True)
    xyz=p[t];volumes=np.linalg.det(np.stack((xyz[:,1]-xyz[:,0],xyz[:,2]-xyz[:,0],xyz[:,3]-xyz[:,0]),axis=2))/6
    if not np.isfinite(volumes).all() or np.any(volumes<=0):
        raise ValueError('Nonpositive tetrahedron; no automatic orientation repair')
    faces=defaultdict(list)
    for index,cell in enumerate(t):
        for local in TET_FACES:
            face=tuple(map(int,ids[cell[list(local)]]))
            faces[tuple(sorted(face))].append((index,face))
    if any(len(owners)>2 for owners in faces.values()):raise ValueError('Nonmanifold input triangle')
    if any(_cycle(v[0][1])!=_cycle(v[1][1][::-1]) for v in faces.values() if len(v)==2):
        raise ValueError('Misoriented shared input triangle')
    boundary=[v[0][1] for v in faces.values() if len(v)==1]
    edges=Counter(tuple(sorted((q[i],q[(i+1)%3]))) for q in boundary for i in range(3))
    if any(count!=2 for count in edges.values()):raise ValueError('Open or nonmanifold input boundary')
    return p,t,ids,volumes,boundary


def subdivide_tetrahedra(nodes,tetrahedra,*,node_ids=None,new_node_id_start=None,minimum_sj=None):
    """Return nodes,H8,node-supports and scoped evidence; never mutate inputs.

    Each returned support is the sorted original NID tuple whose equal-weight
    mean defines that output vertex (original,edge,triangle or tet centroid).
    Gmsh performs the domain subdivision. Support matching only identifies its
    known mathematical output; ambiguous coincident entities reject instead of
    being merged. Use in a dedicated worker, not an existing Gmsh session.
    For assembly, allocate new_node_id_start above ALL retained source and
    collar IDs; the local converter cannot infer the external ID namespace.
    No empirical quality floor is assumed. An optional explicit caller screen
    is separate from strictly positive sampled Jacobians and engineering use.
    """
    p,t,ids,old_volumes,boundary=_input(nodes,tetrahedra,node_ids)
    if minimum_sj is not None and (type(minimum_sj) not in (int,float)
            or not np.isfinite(minimum_sj) or not 0<=minimum_sj<=1):
        raise ValueError('Invalid explicit caller quality screen')
    next_id=int(ids.max())+1 if new_node_id_start is None else new_node_id_start
    if type(next_id) is not int or not int(ids.max())<next_id<=2**53-1:
        raise ValueError('New node IDs must start above every input ID')
    import gmsh
    from scipy.spatial import cKDTree
    if gmsh.isInitialized():raise ValueError('Require an isolated unused Gmsh session')
    supports={(int(n),) for n in ids}
    for cell in ids[t]:
        for count in (2,3,4):supports.update(tuple(sorted(map(int,q))) for q in combinations(cell,count))
    support_keys=sorted(supports,key=lambda k:(len(k),k))
    if next_id+len(support_keys)-len(ids)>2**53-1:raise ValueError('New node identity range overflows its budget')
    source={int(n):point for n,point in zip(ids,p)}
    expected=np.array([np.mean([source[n] for n in key],axis=0) for key in support_keys])
    scale=max(1.,float(abs(p).max()))
    arithmetic_budget=128*np.finfo(float).eps*scale
    tree=cKDTree(expected)
    separation,_=tree.query(expected,k=2)
    if np.any(separation[:,1]<=2*arithmetic_budget):
        raise ValueError('Coincident or unresolvable distinct barycentre entities; no welding')
    gmsh.initialize(['hexrefine-tet-bridge','-nopopup'],readConfigFiles=False)
    try:
        gmsh.option.setNumber('General.Terminal',0)
        gmsh.option.setNumber('General.NumThreads',1)
        gmsh.option.setNumber('Mesh.Renumber',0)
        gmsh.model.add('hexrefine-tet-bridge')
        entity=gmsh.model.addDiscreteEntity(3)
        gmsh.model.mesh.addNodes(3,entity,ids.tolist(),p.ravel().tolist())
        gmsh.model.mesh.addElementsByType(entity,4,list(range(1,len(t)+1)),ids[t].ravel().tolist())
        gmsh.option.setNumber('Mesh.SubdivisionAlgorithm',2)
        gmsh.model.mesh.refine()
        types,element_tags,connectivity=gmsh.model.mesh.getElements(3,entity)
        if list(types)!=[5] or len(element_tags[0])!=4*len(t):
            raise ValueError('Gmsh did not return exactly four H8 per original tet')
        output_ids,coords,_=gmsh.model.mesh.getNodes()
        output_ids=np.asarray(output_ids,dtype=np.int64)
        output_nodes=np.asarray(coords,dtype=float).reshape(-1,3)
        order=np.argsort(output_ids);output_ids=output_ids[order];output_nodes=output_nodes[order]
        lookup={int(n):i for i,n in enumerate(output_ids)}
        h8=np.array([[lookup[int(n)] for n in row] for row in np.asarray(connectivity[0]).reshape(-1,8)],dtype=np.int64)
        version=gmsh.__version__
    finally:
        gmsh.finalize()
    if len(output_nodes)!=len(expected) or not np.isfinite(output_nodes).all():
        raise ValueError('Unexpected subdivision node inventory')
    if not set(map(int,ids))<=set(map(int,output_ids)):
        raise ValueError('Gmsh removed an original node identity')
    np.testing.assert_array_equal(output_nodes[[lookup[int(n)] for n in ids]],p)
    distances,index=tree.query(output_nodes,k=1)
    if float(distances.max())>arithmetic_budget or len(np.unique(index))!=len(index):
        raise ValueError('Gmsh nodes do not bijectively match expected barycentre entities')
    output_supports=[support_keys[int(i)] for i in index]
    support_index={key:i for i,key in enumerate(output_supports)}
    parents={tuple(sorted(map(int,cell))):i for i,cell in enumerate(ids[t])}
    child_parent=[]
    for cell in h8:
        core=[output_supports[n] for n in cell if len(output_supports[n])==4]
        if len(core)!=1 or core[0] not in parents:raise ValueError('Child has no unique original tet centroid')
        parent=core[0]
        if any(not set(output_supports[n])<=set(parent) for n in cell):
            raise ValueError('A child crosses its original tetrahedron boundary')
        child_parent.append(parents[parent])
    if Counter(child_parent)!=Counter({i:4 for i in range(len(t))}):
        raise ValueError('Parent-child counts are not exactly four')
    qa,quad_boundary=audit_h8(output_nodes,h8,minimum_sj=0. if minimum_sj is None else minimum_sj)
    metric_report=summarize_h8(measure_h8(output_nodes,h8))
    parent_volumes=np.bincount(child_parent,weights=_volumes(output_nodes,h8),minlength=len(t))
    parent_relative=np.abs(parent_volumes-old_volumes)/old_volumes
    if float(parent_relative.max())>1e-12:raise ValueError('A parent volume changed despite possible total cancellation')
    relative=abs(qa['volume']-float(old_volumes.sum()))/float(old_volumes.sum())
    if relative>1e-12:raise ValueError('Domain-preserving conversion changed total volume')
    actual={tuple(sorted(map(int,q))):_cycle(q) for q in quad_boundary}
    expected_quads={};partitions=[]
    for triangle in boundary:
        q=[];centre=support_index[tuple(sorted(triangle))]
        for i,n in enumerate(triangle):
            before,after=triangle[i-1],triangle[(i+1)%3]
            row=[support_index[(n,)],support_index[tuple(sorted((n,after)))],centre,
                 support_index[tuple(sorted((before,n)))]]
            q.append(row);expected_quads[tuple(sorted(row))]=_cycle(row)
        partitions.append(dict(sourceTriangleNodeIDs=list(triangle),childQuadIndices=q))
    if actual!=expected_quads or len(actual)!=3*len(boundary):
        raise ValueError('Boundary triangles did not produce exactly the expected three quads')
    # Allocate caller-owned assembly identities only after the engine result is checked.
    new_indices=[i for i,key in enumerate(output_supports) if len(key)>1]
    output_ids[new_indices]=np.arange(next_id,next_id+len(new_indices),dtype=np.int64)
    if len(np.unique(output_ids))!=len(output_ids):raise ValueError('Output ID allocation collision')
    for array in (output_nodes,h8,output_ids):array.setflags(write=False)
    report=dict(engine='Gmsh',engineVersion=version,inputTetrahedra=len(t),outputH8=len(h8),
        originalNodeIDsUnchanged=True,originalCoordinatesUnchanged=True,childrenPerTet=4,
        newNodeIDStart=next_id,externalNamespaceCollisionChecked=False,
        boundaryTriangles=len(boundary),boundaryQuads=len(quad_boundary),boundaryPartitionExact=True,
        boundaryOrientationExact=True,maximumParentRelativeVolumeChange=float(parent_relative.max()),
        maximumBarycentreRoundoffMM=float(distances.max()),arithmeticMatchingBudgetMM=arithmetic_budget,
        matchingBudgetIsNotGeometryHealing=True,relativeVolumeChange=relative,quality=qa,
        callerQualityScreen=minimum_sj,qualityMetricReport=metric_report,engineeringQualityAccepted=False,
        inputOverlapCertified=False,wholeSourceAttachmentVerified=False,originalScrewRepaired=False,
        scope='Validated conversion of the supplied TET4 complex only; cavity meshing and retained-source attachment are separate')
    return dict(nodes=output_nodes,elements=h8,node_ids=output_ids,node_supports=output_supports,
                child_parent=np.array(child_parent,dtype=np.int64),boundary_partitions=partitions,report=report)
