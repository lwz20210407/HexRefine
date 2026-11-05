"""Measured three-dimensional Screw cavity/interface, never a silent repair.

Exact source face incidence is authoritative. Geometrically close node pairs
are constraints/candidates only, not welded IDs. A collar probe is NOT a core.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from dataclasses import replace
from itertools import permutations
import json
import math
from pathlib import Path

import numpy as np

from .mesh_audit import FACES, audit_h8
from .screw_axis_core import ORIGINAL_SCREW_SHA256
from .truegrid_screw import ImportedSolids, audit_import, read_keyword, write_diagnostic_inp


def _cycle(nodes):
    seq = tuple(map(int, nodes))
    return min(seq[k:] + seq[:k] for k in range(len(seq)))


def _face_key(nodes):
    return min(_cycle(nodes), _cycle(nodes[::-1]))


def _edges(nodes):
    return [(int(a), int(b)) for a, b in zip(nodes, np.roll(nodes, -1))]


def face_owners(mesh):
    """Bindings include source EID, PID, local face and oriented source NIDs."""
    owners = defaultdict(list)
    node_sets = {}
    for eid, pid, cell in zip(mesh.element_ids, mesh.part_ids, mesh.elements):
        for index, slots in enumerate(FACES, 1):
            ids = mesh.node_ids[cell[slots]].tolist()
            if len(set(ids)) != 4:
                raise ValueError('Repeated face node IDs require a different element adapter')
            key=_face_key(ids); unordered=tuple(sorted(ids))
            if unordered in node_sets and node_sets[unordered]!=key:
                raise ValueError('Same face vertices have incompatible cyclic edge order')
            node_sets[unordered]=key
            owners[key].append(dict(eid=int(eid), pid=int(pid),
                localFace=index, nodeIDs=ids))
    return owners


def _coordinates(mesh):
    return {int(nid): xyz for nid, xyz in zip(mesh.node_ids, mesh.nodes)}


def face_geometry(node_ids, coordinates):
    xyz = np.array([coordinates[int(n)] for n in node_ids])
    a, b = np.roll(xyz, -1, axis=0) - xyz, np.roll(xyz, 1, axis=0) - xyz
    denominator = np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1)
    sine = np.divide(np.linalg.norm(np.cross(a, b), axis=1), denominator,
                     out=np.zeros(4), where=denominator > 0)
    # Integrated norm of Q4 tangents; exact zero diagnosis, not a CAD area claim.
    signs = np.array([[-1,-1],[1,-1],[1,1],[-1,1]])
    area = 0.
    for u in (-1 / math.sqrt(3), 1 / math.sqrt(3)):
        for v in (-1 / math.sqrt(3), 1 / math.sqrt(3)):
            du = signs[:, 0] * (1 + signs[:, 1] * v) / 4
            dv = signs[:, 1] * (1 + signs[:, 0] * u) / 4
            area += float(np.linalg.norm(np.cross(du @ xyz, dv @ xyz)))
    return dict(q4Area=area, cornerSines=sine.tolist(),
                minimumPossibleCornerSJUpperBound=float(sine.min()))


def _signed_skin_volume(quads, coordinates):
    xyz=np.array([[coordinates[int(n)] for n in face] for face in quads])
    signs=np.array([[-1,-1],[1,-1],[1,1],[-1,1]])
    volume=0.
    for u,v in ((a,b) for a in (-1/math.sqrt(3),1/math.sqrt(3)) for b in (-1/math.sqrt(3),1/math.sqrt(3))):
        shape=(1+signs[:,0]*u)*(1+signs[:,1]*v)/4
        du=signs[:,0]*(1+signs[:,1]*v)/4
        dv=signs[:,1]*(1+signs[:,0]*u)/4
        point=np.einsum('fnd,n->fd',xyz,shape)
        a=np.einsum('fnd,n->fd',xyz,du);b=np.einsum('fnd,n->fd',xyz,dv)
        volume+=float(np.sum(point[:,2]*np.cross(a,b)[:,2]))
    return volume


def skin_topology(quads):
    """ID topology, including edge owners, boundary loops and vertex links.

    A topological manifold can still have zero-area faces or self contacts.
    """
    edge_faces = defaultdict(list)
    vertex_links = defaultdict(list)
    for face, quad in enumerate(quads):
        if len(set(quad)) != 4:
            raise ValueError('Repeated skin vertex')
        for a, b in _edges(quad):
            edge_faces[tuple(sorted((a, b)))].append((face, a, b))
        for j, vertex in enumerate(quad):
            vertex_links[int(vertex)].append((int(quad[j-1]), int(quad[(j+1) % 4])))
    adjacency = [set() for _ in quads]
    orientation_errors = []
    for edge, owners in edge_faces.items():
        if len(owners) == 2:
            a, b = owners
            adjacency[a[0]].add(b[0]); adjacency[b[0]].add(a[0])
            if a[1:] != b[1:][::-1]:
                orientation_errors.append(list(edge))
    components, visited = [], set()
    for start in range(len(quads)):
        if start in visited:
            continue
        stack, component = [start], []
        visited.add(start)
        while stack:
            face = stack.pop(); component.append(face)
            for neighbour in adjacency[face] - visited:
                visited.add(neighbour); stack.append(neighbour)
        components.append(component)
    nonmanifold_vertices = []
    for vertex, links in vertex_links.items():
        graph = defaultdict(list)
        for a, b in links:
            graph[a].append(b); graph[b].append(a)
        seen, stack = set(), [next(iter(graph))]
        while stack:
            a = stack.pop()
            if a in seen: continue
            seen.add(a); stack.extend(graph[a])
        degrees = [len(edges) for edges in graph.values()]
        if (len(seen) != len(graph) or max(degrees) > 2
                or sum(d == 1 for d in degrees) not in (0, 2)):
            nonmanifold_vertices.append(vertex)
    boundary = [edge for edge, owners in edge_faces.items() if len(owners) == 1]
    boundary_graph = defaultdict(list)
    for a, b in boundary:
        boundary_graph[a].append(b); boundary_graph[b].append(a)
    loops, remaining = [], set(boundary)
    if all(len(neighbours) == 2 for neighbours in boundary_graph.values()):
        while remaining:
            a, b = min(remaining); loop = [a]; previous, current = a, b
            remaining.remove((a, b))
            while current != loop[0]:
                loop.append(current)
                nxt = next(n for n in boundary_graph[current] if n != previous)
                remaining.remove(tuple(sorted((current, nxt))))
                previous, current = current, nxt
            loops.append(loop)
    nonmanifold_edges = [list(edge) for edge, owners in edge_faces.items() if len(owners) > 2]
    return dict(vertices=len(vertex_links), edges=len(edge_faces), faces=len(quads),
                euler=len(vertex_links)-len(edge_faces)+len(quads), components=components,
                boundaryEdges=[list(e) for e in boundary], boundaryLoops=loops,
                edgeIncidenceHistogram=dict(Counter(len(v) for v in edge_faces.values())),
                nonmanifoldEdges=nonmanifold_edges, nonmanifoldVertices=nonmanifold_vertices,
                orientationErrors=orientation_errors,
                idManifold=not nonmanifold_edges and not nonmanifold_vertices and not orientation_errors,
                closed=not boundary,
                edgeOwners=[dict(nodeIDs=list(e), faces=[int(v[0]) for v in owners])
                            for e, owners in sorted(edge_faces.items())])


def extract_cavity(mesh, replace_eids):
    """Complete selected-cell skin and selected/retained shared faces, by IDs."""
    selected = set(map(int, replace_eids))
    if not selected or not selected <= set(map(int, mesh.element_ids)):
        raise ValueError('Require nonempty existing replacement EIDs')
    if len(mesh.elements) > 100000:
        raise ValueError('Research budget exceeds 100000 H8')
    owners = face_owners(mesh)
    boundary, interface, retained_free = [], [], []
    internal, orientation_errors, nonmanifold = 0, [], []
    coords = _coordinates(mesh)
    for key, pair in owners.items():
        if len(pair) > 2:
            nonmanifold.append(pair)
            continue
        if len(pair) == 2 and _cycle(pair[0]['nodeIDs']) != _cycle(pair[1]['nodeIDs'][::-1]):
            orientation_errors.append(pair)
        inside = [owner for owner in pair if owner['eid'] in selected]
        outside = [owner for owner in pair if owner['eid'] not in selected]
        if len(inside) == 2:
            internal += 1
        elif inside:
            owner = inside[0]
            record = dict(selected=owner, retained=outside[0] if outside else None,
                          geometry=face_geometry(owner['nodeIDs'], coords))
            boundary.append(record)
            if outside: interface.append(record)
        elif len(pair) == 1:
            retained_free.append(pair[0])
    if nonmanifold or orientation_errors:
        raise ValueError('Source has nonmanifold or incompatible face ownership')
    topology = skin_topology([r['selected']['nodeIDs'] for r in boundary])
    interface_topology = skin_topology([r['selected']['nodeIDs'] for r in interface])
    mask = np.isin(mesh.element_ids, list(selected))
    sub = replace(mesh, elements=mesh.elements[mask], element_ids=mesh.element_ids[mask],
                  part_ids=mesh.part_ids[mask], element_cards={'*ELEMENT_SOLID': int(mask.sum())})
    qa = audit_import(sub)
    skin_volume=_signed_skin_volume([r['selected']['nodeIDs'] for r in boundary],coords)
    volume_error=abs(skin_volume-qa['integratedVolume'])/abs(qa['integratedVolume'])
    if volume_error>1e-10:
        raise ValueError('Extracted skin signed volume disagrees with selected source FE cells')
    skin_ids = sorted({n for r in boundary for n in r['selected']['nodeIDs']})
    return dict(schemaVersion=1, sourceSHA256=mesh.source_sha256,
                indexConventions='Source EID/NID/PID unchanged; localFace and local slots are 1-based; JSON face-list/order indices are 0-based.',
                localFaceNodeSlots1Based=(FACES+1).tolist(), selectedEIDs=sorted(selected),
                retainedEIDs=sorted(set(map(int, mesh.element_ids))-selected),
                sourceElementCount=len(mesh.elements), selectedElementCount=len(selected),
                internalSelectedFaces=internal, boundary=boundary, interface=interface,
                topology=topology, interfaceTopology=interface_topology,
                boundaryNodes=[dict(id=n, xyz=coords[n].tolist()) for n in skin_ids],
                zeroAreaBoundaryFaceIndices=[i for i,r in enumerate(boundary) if r['geometry']['q4Area'] < 1e-14],
                frozenBoundaryFaceIndicesBelowSJ015=[i for i,r in enumerate(boundary)
                    if r['geometry']['minimumPossibleCornerSJUpperBound'] < .15],
                sourceSelectedAudit=qa, retainedFreeFaceCount=len(retained_free),
                signedSkinVolume=skin_volume,relativeSourceSkinVolumeError=volume_error,
                geometricEmbeddingAccepted=False,
                sourceChanged=False, deletedElements=0, replacementAccepted=False,
                warning='ID manifold is not a geometric embedding or successful core fill.')


def trace_interface_strip(cavity):
    """Discover strip order from actual shared-edge adjacency, not planar rings."""
    faces = cavity['interface']
    edge_faces = defaultdict(list)
    for index, face in enumerate(faces):
        for a, b in _edges(face['selected']['nodeIDs']):
            edge_faces[tuple(sorted((a,b)))].append(index)
    neighbours = [set() for _ in faces]
    for pair in edge_faces.values():
        if len(pair) == 2:
            neighbours[pair[0]].add(pair[1]); neighbours[pair[1]].add(pair[0])
    ends = [i for i,v in enumerate(neighbours) if len(v) == 1]
    if len(ends) != 2 or any(len(v) not in (1,2) for v in neighbours):
        raise ValueError('Actual interface is not a single unbranched quad strip')
    current = min(ends, key=lambda i:faces[i]['retained']['eid'])
    order, previous = [], None
    while True:
        order.append(current)
        nxt = neighbours[current] - ({previous} if previous is not None else set())
        if not nxt: break
        previous, current = current, next(iter(nxt))
    if len(order) != len(faces):
        raise ValueError('Disconnected interface strip')
    coordinates = {r['id']:r['xyz'] for r in cavity['boundaryNodes']}
    first = faces[order[0]]['selected']['nodeIDs']
    shared = set(first) & set(faces[order[1]]['selected']['nodeIDs'])
    incoming = [n for n in first if n not in shared]
    incoming.sort(key=lambda n:coordinates[n][2])
    columns = [incoming]
    for face in order:
        quad = faces[face]['selected']['nodeIDs']
        outgoing = [n for n in quad if n not in columns[-1]]
        outgoing.sort(key=lambda n:coordinates[n][2])
        if len(outgoing) != 2 or _face_key([*columns[-1][:1], outgoing[0], outgoing[1], columns[-1][1]]) != _face_key(quad):
            raise ValueError('Strip phase edge is not opposite its successor')
        columns.append(outgoing)
    phase01 = np.array(columns, dtype=np.int64).T
    # Grow the third row through the actual valley-wall face sharing each upper
    # strip edge. This face is free relative to retained teeth, not an include.
    all_edges = defaultdict(list)
    interface_keys = {_face_key(r['selected']['nodeIDs']) for r in faces}
    for index, record in enumerate(cavity['boundary']):
        if _face_key(record['selected']['nodeIDs']) not in interface_keys:
            for a,b in _edges(record['selected']['nodeIDs']):
                all_edges[tuple(sorted((a,b)))].append(index)
    row2, valley = [], []
    for j in range(phase01.shape[1]-1):
        edge = tuple(sorted(phase01[1,j:j+2]))
        candidates = all_edges[edge]
        if len(candidates) != 1:
            raise ValueError('Third phase row has ambiguous or missing actual wall ownership')
        index = candidates[0]; q = cavity['boundary'][index]['selected']['nodeIDs']
        other = [n for n in q if n not in edge]
        # Original helix is increasing in Z; ordering is observed, not welded.
        other.sort(key=lambda n:coordinates[n][2])
        if row2 and row2[-1] != other[0]:
            raise ValueError('Third phase row is not node-connected')
        if not row2: row2.append(other[0])
        row2.append(other[1]); valley.append(index)
    grid = np.vstack((phase01, row2))
    return dict(interfaceFaceOrder=order, valleyBoundaryFaceOrder=valley,
                rootWallNodeIDs=grid.tolist(), phaseRows=3, angularColumns=grid.shape[1],
                construction='exact face/edge incidence, no periodic closure assumed')


def axial_phase_constraints(cavity, strip):
    coords = {r['id']:np.array(r['xyz']) for r in cavity['boundaryNodes']}
    ids = np.array(strip['rootWallNodeIDs'])
    xyz = np.array([[coords[int(n)] for n in row] for row in ids])
    angles = np.unwrap(np.arctan2(xyz[0,:,1], xyz[0,:,0]))
    offset = int(np.argmin(abs(angles-angles[0]-math.tau)))
    if offset == 0 or abs(angles[offset]-angles[0]-math.tau) > math.radians(.001):
        raise ValueError('No measured unmodulated 360-degree successor')
    distances = np.linalg.norm(xyz[0,offset] - xyz[:,0], axis=1)
    shift = int(np.argmin(distances))
    links = []
    for j in range(ids.shape[1]-offset):
        a, b = int(ids[0,j+offset]), int(ids[shift,j])
        delta = coords[a]-coords[b]
        links.append(dict(advancedNodeID=a, nextPhaseNodeID=b, column=j,
                          advancedBinding=cavity['interface'][strip['interfaceFaceOrder'][min(j+offset,len(strip['interfaceFaceOrder'])-1)]]['selected'],
                          nextPhaseBinding=cavity['boundary'][strip['valleyBoundaryFaceOrder'][j]]['selected'],
                          deltaXYZ=delta.tolist(), distance=float(np.linalg.norm(delta)),
                          sameSourceNodeID=a==b))
    wall_keys={_face_key(r['selected']['nodeIDs']) for r in cavity['interface']}
    wall_keys.update(_face_key(cavity['boundary'][i]['selected']['nodeIDs'])
                     for i in strip['valleyBoundaryFaceOrder'])
    cap_edges=defaultdict(list)
    for i,face in enumerate(cavity['boundary']):
        if _face_key(face['selected']['nodeIDs']) not in wall_keys:
            for a,b in _edges(face['selected']['nodeIDs']):
                cap_edges[tuple(sorted((a,b)))].append(i)
    face_links=[]
    choices=np.array(list(permutations(range(4))))
    for j in range(ids.shape[1]-offset-1):
        edge_a=tuple(sorted(ids[0,j+offset:j+offset+2]))
        edge_b=tuple(sorted(ids[shift,j:j+2]))
        if len(cap_edges[edge_a])!=1 or len(cap_edges[edge_b])!=1:
            raise ValueError('Axial phase caps have ambiguous actual face owners')
        ia,ib=cap_edges[edge_a][0],cap_edges[edge_b][0]
        a,b=cavity['boundary'][ia]['selected'],cavity['boundary'][ib]['selected']
        pa=np.array([coords[n] for n in a['nodeIDs']]);pb=np.array([coords[n] for n in b['nodeIDs']])
        errors=np.linalg.norm(pa[None]-pb[choices],axis=2)
        best=int(np.argmin(errors.max(axis=1)))
        mapping=choices[best]
        face_links.append(dict(advancedBoundaryFaceIndex=ia,nextPhaseBoundaryFaceIndex=ib,
            advancedBinding=a,nextPhaseBinding=b,
            nextNodeIDsInAdvancedFaceOrder=[b['nodeIDs'][i] for i in mapping],
            maximumNodeGap=float(errors[best].max()),
            oppositeCyclicOrientation=_cycle(mapping)==_cycle([0,3,2,1]),
            actuallySharedSourceFace=_face_key(a['nodeIDs'])==_face_key(b['nodeIDs'])))
    return dict(turnOffsetColumns=offset, phaseRowShift=shift,
                measuredTurnAdvanceZ=float(xyz[0,offset,2]-xyz[0,0,2]),
                sameLayerDistance=float(distances[0]), nextPhaseDistance=float(distances[shift]),
                interpretation='theta+360 advances axial phase, not same-layer periodic closure',
                candidateLinks=links, actualIDSharedLinks=sum(r['sameSourceNodeID'] for r in links),
                linksWithin2e6=sum(r['distance']<=2e-6 for r in links),
                allLinksWithin2e6=all(r['distance']<=2e-6 for r in links),
                maximumLinkDistance=max(r['distance'] for r in links),
                phaseCapFaceCandidates=face_links,
                phaseCapFaceLinksWithin2e6=sum(r['maximumNodeGap']<=2e-6 for r in face_links),
                actualIDSharedCapFaces=sum(r['actuallySharedSourceFace'] for r in face_links),
                weldingApplied=False, reference='measured source coordinates including later tip modulation/drift')


def attachment_probe(mesh, cavity, strip, faces=6):
    """Finite H8 attachment to real retained faces; intentionally NOT a core.

    Provides a positive interface feasibility test and leaves the inner boundary
    explicitly unfilled. Never substitute this hollow collar for the axis.
    """
    if type(faces) is not int or not 1 <= faces <= 36:
        raise ValueError('Probe bound is 1..36 actual interface faces')
    bindings = [cavity['interface'][i] for i in strip['interfaceFaceOrder'][:faces]]
    outer_ids = sorted({n for r in bindings for n in r['selected']['nodeIDs']})
    xyz = _coordinates(mesh)
    points = np.array([xyz[n] for n in outer_ids])
    inner = points.copy(); inner[:,:2] *= .5
    nodes = np.vstack((inner, points))
    lookup = {nid:i for i,nid in enumerate(outer_ids)}
    inner_ids = np.arange(int(mesh.node_ids.max())+1, int(mesh.node_ids.max())+1+len(points))
    all_ids = np.r_[inner_ids, outer_ids]
    elements = []
    for binding in bindings:
        q = [lookup[n] for n in binding['selected']['nodeIDs']]
        elements.append(q+[n+len(points) for n in q])
    elements = np.array(elements,dtype=np.int64)
    quality,_ = audit_h8(nodes,elements,2)
    result = ImportedSolids(nodes,elements,all_ids,np.arange(1,len(elements)+1),
                            np.ones(len(elements),dtype=np.int64),{'*ELEMENT_SOLID':len(elements)},'')
    return result,dict(scope='interface attachment only; NOT finite axis core or source replacement',
                       quality=quality, sourceInterfaceBindings=bindings,
                       interfaceCoordinatesUnchanged=True, innerCavityUnfilled=True,
                       adjacentSourceCoreCutFacesMatched=False, originalScrewAccepted=False)


def small_segment_cavity(mesh, cavity, strip, faces=6):
    """Actual tooth-adjacent cells plus their shared upper axial neighbours."""
    if type(faces) is not int or not 1 <= faces <= 36:
        raise ValueError('Finite segment requires 1..36 interface faces')
    interface=[cavity['interface'][i] for i in strip['interfaceFaceOrder'][:faces]]
    selected={r['selected']['eid'] for r in interface}
    owners=face_owners(mesh); allowed=set(cavity['selectedEIDs'])
    for eid in list(selected):
        cell=mesh.elements[np.flatnonzero(mesh.element_ids==eid)[0]]
        pair=owners[_face_key(mesh.node_ids[cell[FACES[1]]].tolist())]
        selected.update(r['eid'] for r in pair if r['eid'] in allowed)
    return extract_cavity(mesh,selected)


def separating_plane_witness(point, nodes, normal):
    """Certified lower bound to every trilinear H8 in a vertex half-space.

    H8 shape functions are nonnegative in the reference cube. Hence every
    mapped point lies in its vertices' convex hull. This is a one-sided source
    domain exclusion proof, NOT a closest-surface distance or a CAD certificate.
    """
    point,nodes,normal=np.asarray(point,float),np.asarray(nodes,float),np.asarray(normal,float)
    if (point.shape!=(3,) or nodes.ndim!=2 or nodes.shape[1]!=3 or not len(nodes)
            or normal.shape!=(3,) or not all(np.isfinite(v).all() for v in (point,nodes,normal))
            or np.linalg.norm(normal)==0):
        raise ValueError('Require finite point, candidate vertices and nonzero plane normal')
    unit=normal/np.linalg.norm(normal)
    offset=float(np.min(nodes@unit))-1e-12
    projection=float(point@unit)
    return dict(unitNormal=unit.tolist(),offset=offset,sourcePoint=point.tolist(),
                sourceProjection=projection,minimumDistanceLowerBound=max(offset-projection,0.),
                roundoffMargin=1e-12,
                justification='Every H8 point is a convex combination of its eight vertices.')


def solid_segment_candidate(mesh, cavity, strip, small, centre_fraction=.4):
    """Filled 60-degree sector prototype matching eight actual hard faces.

    Four finite cross-section quads replace collapsed radial columns. This
    prototype deliberately undergoes a separate source-domain coverage test:
    quality, volume and hard-wall agreement alone cannot certify a replacement.
    """
    if not isinstance(centre_fraction,(int,float)) or not math.isfinite(centre_fraction) or not 0<centre_fraction<1:
        raise ValueError('Centre fraction must be finite and strictly inside the sector')
    root_ids=np.asarray(strip['rootWallNodeIDs'],dtype=np.int64)[:,:7]
    if root_ids.shape!=(3,7) or small['selectedElementCount']!=12 or len(small['interface'])!=8:
        raise ValueError('Prototype supports only the measured six-face/two-phase finite segment')
    xyz=_coordinates(mesh)
    end_roots=set(map(int,root_ids[:,-1]))
    axis_ids=set()
    for face in small['interface']:
        ids=face['selected']['nodeIDs']
        if len(end_roots & set(ids))>=2:
            axis_ids.update(n for n in ids if np.linalg.norm(xyz[n][:2])<=1e-12)
    axis_ids=sorted(axis_ids,key=lambda n:xyz[n][2])
    if len(axis_ids)!=3:
        raise ValueError('Actual retained core-cut faces do not provide three axis levels')
    if max(abs(xyz[n][2]-xyz[int(root_ids[k,-1])][2]) for k,n in enumerate(axis_ids))>1e-10:
        raise ValueError('Prototype retained-axis phase levels do not match the actual root wall')
    points=[];node_ids=[]
    for k in range(3):
        ids=[axis_ids[k],*map(int,root_ids[k])]
        points.extend(xyz[n] for n in ids);node_ids.extend(ids)
        centre=xyz[int(root_ids[k,3])].copy();centre[:2]*=centre_fraction
        points.append(centre);node_ids.append(int(mesh.node_ids.max())+k+1)
    q=np.array([[8,0,1,2],[8,2,3,4],[8,4,5,6],[8,6,7,0]],dtype=np.int64)
    cells=np.concatenate([np.column_stack((q+k*9,q+(k+1)*9)) for k in range(2)])
    candidate=ImportedSolids(np.asarray(points),cells,np.asarray(node_ids),np.arange(1,9),
                             np.ones(8,dtype=np.int64),{'*ELEMENT_SOLID':8},'')
    if len(set(node_ids))!=len(node_ids):
        raise ValueError('Candidate unexpectedly duplicates source node identity')
    qa=audit_import(candidate)
    owners=face_owners(candidate);hard=[]
    for binding in small['interface']:
        matches=owners.get(_face_key(binding['selected']['nodeIDs']),[])
        if len(matches)!=1 or _cycle(matches[0]['nodeIDs'])!=_cycle(binding['selected']['nodeIDs']):
            raise ValueError('Candidate lost a retained tooth/core-cut face or its orientation')
        hard.append(dict(sourceSelected=binding['selected'],retained=binding['retained'],candidate=matches[0]))
    for nid,point in zip(candidate.node_ids,candidate.nodes):
        if int(nid) in xyz and not np.array_equal(point,xyz[int(nid)]):
            raise ValueError('Candidate moved an existing source coordinate')
    source_volume=small['sourceSelectedAudit']['integratedVolume']
    relative=abs(qa['integratedVolume']-source_volume)/abs(source_volume)
    # The first axis endpoint is also on two nondegenerate physical boundary
    # faces, not merely on the discarded zero-area axis sheet.
    physical={n for face in small['boundary'] if face['geometry']['q4Area']>1e-14
              for n in face['selected']['nodeIDs'] if np.linalg.norm(xyz[n][:2])<=1e-12}
    first=min(physical,key=lambda n:xyz[n][2])
    radial=xyz[int(root_ids[0,0])][:2]
    rise=xyz[axis_ids[0]][2]-xyz[first][2]
    normal=np.r_[rise*radial/np.dot(radial,radial),1.]
    witness=separating_plane_witness(xyz[first],candidate.nodes,normal)
    witness.update(sourceNodeID=int(first),sourcePhysicalFaceBindings=[f['selected'] for f in small['boundary']
        if first in f['selected']['nodeIDs'] and f['geometry']['q4Area']>1e-14])
    return candidate,dict(scope='finite FILLED sector-core candidate; not a completed source-domain replacement',
        candidateH8Audit=qa,sourceEIDObligations=small['selectedEIDs'],matchedRetainedFaces=hard,
        sourceSignedVolume=source_volume,relativeSourceVolumeError=relative,
        allExistingCoordinatesUnchanged=True,innerCoreFilled=True,axisNodeIDs=axis_ids,
        omittedSelectedBoundaryNodeIDs=sorted({r['id'] for r in small['boundaryNodes']}-set(node_ids)),
        newNodeIDs=[int(n) for n in candidate.node_ids if int(n) not in xyz],
        sourceCornerCoverageWitness=witness,
        sourceDomainPreserved=witness['minimumDistanceLowerBound']<=1e-10,
        sourceDomainAccepted=False,replacementAccepted=False,globalReplacementApplied=False,
        rejection='Volume/SJ/hard-face agreement does not preserve the free-end domain: an original physical corner is outside every candidate H8.',
        nextConstraint='Need multiple axis heights and a 3D end/phase macro, rather than one axis vertex per phase slice.')


def phase_extent_chart(mesh, strip, extents=(6,18,36)):
    """Measured phase-aligned search windows, not claims of macro feasibility."""
    xyz=_coordinates(mesh);ids=np.asarray(strip['rootWallNodeIDs'])
    half=float(xyz[int(ids[1,0])][2]-xyz[int(ids[0,0])][2])
    rows=[]
    for count in extents:
        if type(count) is not int or not 1<=count<ids.shape[1]:
            raise ValueError('Invalid measured strip extent')
        advance=float(xyz[int(ids[0,count])][2]-xyz[int(ids[0,0])][2])
        shift=int(round(advance/half));residual=abs(advance-shift*half)
        rows.append(dict(interfaceFaces=count,sourceCoreCells=2*count,advanceZ=advance,
                         nearestHalfPhaseShift=shift,phaseResidual=residual,
                         phaseAligned=residual<=1e-10,coreMacroVerified=False))
    return dict(halfPhaseHeight=half,windows=rows,
                warning='Phase alignment is only a search constraint, not conforming-core acceptance.')


def candidate_neighbour_assembly(source, candidate, hard_bindings):
    """Actual node-shared local coupling, never a source-wide replacement.

    Retained neighbours keep original EIDs and coordinates. Candidate EIDs are
    shifted above the source range for this diagnostic. Existing bad neighbour
    cells remain bad and are reported, not removed to make the assembly pass.
    """
    retained=sorted({r['retained']['eid'] for r in hard_bindings})
    mask=np.isin(source.element_ids,retained)
    source_xyz=_coordinates(source)
    coordinates={int(n):point.copy() for n,point in zip(candidate.node_ids,candidate.nodes)}
    for n in source.node_ids[np.unique(source.elements[mask])]:
        n=int(n)
        if n in coordinates and not np.array_equal(coordinates[n],source_xyz[n]):
            raise ValueError('Local coupling would move a retained source node')
        coordinates[n]=source_xyz[n].copy()
    ids=np.array(sorted(coordinates),dtype=np.int64);lookup={int(n):i for i,n in enumerate(ids)}
    source_cells=source.node_ids[source.elements[mask]]
    candidate_cells=candidate.node_ids[candidate.elements]
    cells=np.array([[lookup[int(n)] for n in row] for row in np.vstack((source_cells,candidate_cells))],dtype=np.int64)
    new_eids=int(source.element_ids.max())+np.arange(1,len(candidate.elements)+1)
    eids=np.r_[source.element_ids[mask],new_eids]
    pids=np.r_[source.part_ids[mask],np.full(len(candidate.elements),int(source.part_ids.max())+1)]
    assembly=ImportedSolids(np.array([coordinates[int(n)] for n in ids]),cells,ids,eids,pids,
                             {'*ELEMENT_SOLID':len(cells)},'')
    owners=face_owners(assembly);coupling=[]
    mapping={int(old):int(new) for old,new in zip(candidate.element_ids,new_eids)}
    for binding in hard_bindings:
        pair=owners[_face_key(binding['sourceSelected']['nodeIDs'])]
        expected={binding['retained']['eid'],mapping[binding['candidate']['eid']]}
        if (len(pair)!=2 or {r['eid'] for r in pair}!=expected
                or _cycle(pair[0]['nodeIDs'])!=_cycle(pair[1]['nodeIDs'][::-1])):
            raise ValueError('Local assembly lost exact opposite shared-face ownership')
        coupling.append(dict(sourceSelectedObligation=binding['sourceSelected'],actualOwners=pair))
    report=dict(scope='local diagnostic: rejected source-domain candidate plus unmodified retained neighbours',
        candidateEIDMap=mapping,retainedOriginalEIDs=retained,sharedHardFaces=coupling,
        exactSharedFaceCount=len(coupling),retainedSourceCoordinatesUnchanged=True,
        quality=audit_import(assembly),globalReplacementApplied=False,sourceDomainAccepted=False)
    return assembly,report


def _write_mesh_pair(mesh,output,stem,heading):
    if not heading.isascii() or '\n' in heading:
        raise ValueError('Require one ASCII diagnostic heading')
    path=output/(stem+'.inp')
    write_diagnostic_inp(mesh,path)
    lines=path.read_text(encoding='ascii').splitlines();lines[1]=heading
    path.write_text('\n'.join(lines)+'\n',encoding='ascii')
    with (output/(stem+'.k')).open('x',encoding='ascii') as stream:
        stream.write('*KEYWORD\n$ '+heading+'\n*NODE\n')
        for nid,point in zip(mesh.node_ids,mesh.nodes):
            stream.write(str(int(nid))+','+','.join(format(float(v),'.17g') for v in point)+'\n')
        stream.write('*ELEMENT_SOLID\n')
        for eid,pid,cell in zip(mesh.element_ids,mesh.part_ids,mesh.elements):
            stream.write(f'{eid},{pid},'+','.join(str(int(mesh.node_ids[n])) for n in cell)+'\n')
        stream.write('*END\n')
    reopened=read_keyword(output/(stem+'.k'))
    if (not np.array_equal(reopened.node_ids,mesh.node_ids) or not np.array_equal(reopened.nodes,mesh.nodes)
            or not np.array_equal(reopened.elements,mesh.elements)
            or not np.array_equal(reopened.element_ids,mesh.element_ids)
            or not np.array_equal(reopened.part_ids,mesh.part_ids)):
        raise ValueError('Diagnostic K roundtrip changed source-fixed geometry')
    import meshio
    inp=meshio.read(path,file_format='abaqus')
    if not np.array_equal(inp.points,mesh.nodes) or not np.array_equal(inp.get_cells_type('hexahedron'),mesh.elements):
        raise ValueError('Independent diagnostic INP roundtrip changed source-fixed geometry')


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('keyword',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args(argv)
    source=read_keyword(args.keyword)
    if source.source_sha256!=ORIGINAL_SCREW_SHA256:
        raise ValueError('Default source layout requires the reviewed original K hash')
    if args.output.exists() or not args.output.parent.is_dir():
        raise FileExistsError('Require fresh case-local output directory')
    selected=source.element_ids[(source.element_ids>=2817)&(source.element_ids<=5048)]
    cavity=extract_cavity(source,selected)
    cavity['inputKeyword']=str(args.keyword.resolve())
    strip=trace_interface_strip(cavity)
    phase=axial_phase_constraints(cavity,strip)
    small=small_segment_cavity(source,cavity,strip)
    frozen=dict(selectedEIDs=small['selectedEIDs'], boundaryFaces=len(small['boundary']),
                zeroAreaBoundaryFaces=small['zeroAreaBoundaryFaceIndices'],
                incompatibleFrozenFaces=small['frozenBoundaryFaceIndicesBelowSJ015'],
                necessaryCondition='H8 corner SJ <= sine of the two fixed incident face edges',
                literalFrozenQuadBoundaryAccepted=False,
                conclusion='Need new axis connectivity/3D macro; this is NOT proof that the original physical domain is irreparable.')
    probe,probe_report=attachment_probe(source,cavity,strip)
    solid,solid_report=solid_segment_candidate(source,cavity,strip,small)
    assembly,assembly_report=candidate_neighbour_assembly(source,solid,solid_report['matchedRetainedFaces'])
    extents=phase_extent_chart(source,strip)
    original=audit_import(source)
    remaining=sorted(set(original['badCornerElementIDs'])-set(original['axisCollapsedElementIDs']))
    args.output.mkdir()
    for name,record in [('cavity-interface.json',cavity),('root-wall-strip.json',strip),
                        ('axial-phase-links.json',phase),('small-cavity.json',small),('small-frozen-boundary-attempt.json',frozen),
                        ('solid-segment-candidate.json',solid_report),('phase-extent-chart.json',extents),
                        ('solid-local-assembly.json',assembly_report),
                        ('attachment-probe.json',probe_report)]:
        (args.output/name).write_text(json.dumps(record,indent=2,allow_nan=False)+'\n')
    _write_mesh_pair(probe,args.output,'attachment-probe','ATTACHMENT PROBE ONLY; INNER CORE UNFILLED; NO ORIGINAL REPLACEMENT')
    _write_mesh_pair(solid,args.output,'solid-segment-candidate','REJECTED SOURCE-DOMAIN CANDIDATE; VOLUME/SJ/HARD FACES ONLY; NOT A REPLACEMENT')
    _write_mesh_pair(assembly,args.output,'solid-local-assembly','REJECTED LOCAL DIAGNOSTIC; RETAINED BAD CELLS PRESERVED; NO GLOBAL REPLACEMENT')
    summary=dict(sourceSHA256=source.source_sha256,sourceSolids=len(source.elements),
        selectedSolids=len(selected),retainedSolids=len(source.elements)-len(selected),
        actualSharedInterfaceFaces=len(cavity['interface']),cavityBoundaryFaces=len(cavity['boundary']),
        zeroAreaBoundaryFaces=len(cavity['zeroAreaBoundaryFaceIndices']),
        cavityIDManifold=cavity['topology']['idManifold'],cavityComponents=len(cavity['topology']['components']),
        interfaceIDManifold=cavity['interfaceTopology']['idManifold'],
        interfaceBoundaryLoops=len(cavity['interfaceTopology']['boundaryLoops']),
        turnOffsetColumns=phase['turnOffsetColumns'],phaseRowShift=phase['phaseRowShift'],
        actualIDSharedPhaseLinks=phase['actualIDSharedLinks'],phaseLinksWithin2e6=phase['linksWithin2e6'],
        attachmentProbeH8=len(probe.elements),attachmentProbeMinimumSJ=probe_report['quality']['minimumCornerScaledJacobian'],
        solidCandidateH8=len(solid.elements),solidCandidateMinimumSJ=solid_report['candidateH8Audit']['minimumCornerScaledJacobian'],
        solidCandidateRelativeVolumeError=solid_report['relativeSourceVolumeError'],
        solidCandidateMatchedHardFaces=len(solid_report['matchedRetainedFaces']),
        solidCandidateSourceDomainAccepted=solid_report['sourceDomainAccepted'],
        localAssemblyH8=len(assembly.elements),localAssemblySharedHardFaces=assembly_report['exactSharedFaceCount'],
        localAssemblyAccepted=assembly_report['quality']['meshOnlyAccepted'],
        excludedSourceCornerDistanceLowerBound=solid_report['sourceCornerCoverageWitness']['minimumDistanceLowerBound'],
        finiteConformingAxisCoreCompleted=False,originalBadCornerCount=len(original['badCornerElementIDs']),
        originalNoncollapsedBadEIDs=remaining,originalNoncollapsedBadCount=len(remaining),
        deletedElements=0,coordinatesMoved=0,globalReplacementApplied=False,
        nextMacroConstraints=['Offset phase-row identification across the angular seam, not same-layer closure.',
          'Remove/reparameterize only nonphysical collapsed-axis skin connectivity, retaining physical walls and all EID obligations.',
          'Match local retained core cut faces and neck/head/tip transitions, not only tooth attachment.',
          'Keep source free-end physical corner coverage; positive SJ/volume and hard faces alone do not preserve the domain.',
          'Repair or reject every other bad source cell; no source cell is silently dropped.'])
    (args.output/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    (args.output/'result.txt').write_text(json.dumps({k:v for k,v in summary.items() if not k.endswith('EIDs')},indent=2)+'\n')
    print(json.dumps({k:v for k,v in summary.items() if not k.endswith('EIDs')},indent=2))
    return 2  # The finite axis-core replacement is incomplete, even if probe H8 pass.


if __name__=='__main__':
    raise SystemExit(main())
