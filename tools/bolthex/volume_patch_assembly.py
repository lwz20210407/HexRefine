"""Full-source H8 patch assembly; local success never implies whole-model acceptance."""
from collections import Counter
from dataclasses import replace
from itertools import product
import hashlib
import json
import os
from pathlib import Path
import tempfile
import numpy as np

from .mesh_audit import FACES
from .h8_quality_report import measure_h8
from .screw_interface import face_owners, _face_key, _cycle


def _require(ok, message):
    if not ok:
        raise ValueError(message)


def boundary_volume(faces, coordinates):
    """Exact-degree 2x2 quadrature of divergence flux on bilinear Q4s."""
    origin = np.mean([coordinates[n] for face in faces for n in face], axis=0)
    total = 0.
    for face in faces:
        q = np.array([coordinates[n] for n in face])-origin
        for a,b in product((-1/np.sqrt(3),1/np.sqrt(3)),repeat=2):
            u,v=(a+1)/2,(b+1)/2
            p=(1-u)*(1-v)*q[0]+u*(1-v)*q[1]+u*v*q[2]+(1-u)*v*q[3]
            du=(1-v)*(q[1]-q[0])+v*(q[2]-q[3])
            dv=(1-u)*(q[3]-q[0])+u*(q[2]-q[1])
            total += np.dot(p,np.cross(du,dv))/12
    return float(total)


def assemble_patch(source, removed_element_ids, replacement_nids, replacement_pids, *,
                   target_boundary_nids, new_nodes=(), moved_nodes=(),
                   allowed_geometry_change_ids=(), minimum_sj=None, require_continuous_jacobian=False):
    """Install explicit connectivity into the complete input, preserving protected rows.

    All targets use literal NIDs, not coordinate welding. Geometry changes are
    explicit (NID,X,Y,Z) records. Existing cells touched by a moved node are
    checked as part of the new region, even when not being replaced. No default
    engineering SJ floor is invented: strict positive sampled Jacobians always
    apply, plus an optional explicit caller floor. Geometry/overlap remain
    separate gates; this function does not claim final engineering acceptance.
    """
    _require(source.node_ids.shape==(len(source.nodes),) and source.element_ids.shape==source.part_ids.shape==(len(source.elements),),
             'Invalid source identity dimensions')
    _require(type(require_continuous_jacobian) is bool,'Continuous-certificate option must be boolean')
    _require(all(card=='*ELEMENT_SOLID' or count==0 for card,count in source.element_cards.items()),
             'This H8 assembly cannot preserve other element types')
    _require(source.element_cards.get('*ELEMENT_SOLID',len(source.elements))==len(source.elements),
             'Source solid-card count differs from source cells')
    _require(all(a.dtype.kind in 'iu' and np.all(a>0) for a in (source.node_ids,source.element_ids,source.part_ids))
             and len(np.unique(source.node_ids))==len(source.node_ids)
             and len(np.unique(source.element_ids))==len(source.element_ids), 'Duplicate or invalid source identities')
    removed = list(removed_element_ids); allowed = set(allowed_geometry_change_ids)
    _require(removed and len(removed)==len(set(removed)) and all(type(e) is int for e in removed),
             'Require distinct explicit removed EIDs')
    _require(all(type(e) is int for e in allowed), 'Require explicit geometry scope EIDs')
    eid_index={int(e):i for i,e in enumerate(source.element_ids)}
    _require(set(removed)|allowed <= eid_index.keys(), 'Unknown source EID')
    if minimum_sj is not None:
        _require(type(minimum_sj) in (int,float) and np.isfinite(minimum_sj) and 0<=minimum_sj<=1,
                 'Invalid explicit SJ policy')
    h=np.asarray(replacement_nids); pids=np.asarray(replacement_pids)
    _require(h.ndim==2 and h.shape[1]==8 and 0<len(h)<=500000 and h.dtype.kind in 'iu',
             'Replacement must be bounded integer H8 NIDs')
    _require(pids.shape==(len(h),) and pids.dtype.kind in 'iu' and np.all(pids>0), 'Invalid replacement PIDs')
    _require(source.nodes.ndim==2 and source.nodes.shape[1]==3 and source.nodes.dtype.kind in 'fiu'
             and np.isfinite(source.nodes).all(), 'Require finite real source coordinates')
    xyz=source.nodes.astype(float,copy=True); ids=source.node_ids.copy(); lookup={int(n):i for i,n in enumerate(ids)}
    def records(values, existing):
        seen=set(); result=[]
        for row in values:
            _require(len(row)==4 and type(row[0]) is int and row[0]>0, 'Invalid node identity')
            n=row[0]; point=np.asarray(row[1:])
            _require(n not in seen and ((n in lookup)==existing), 'Duplicate or colliding node record')
            _require(point.shape==(3,) and point.dtype.kind in 'fiu' and np.isfinite(point).all(), 'Invalid node point')
            seen.add(n); result.append((n,point.astype(float)))
        return result
    changed=records(moved_nodes,True); added=records(new_nodes,False)
    _require(len(added)<=100000 and len(changed)<=len(source.nodes), 'Patch node-count budget exceeded')
    _require(all(n>int(ids.max()) for n,_ in added), 'New NIDs must exceed original range')
    moved_set={n for n,point in changed if not np.array_equal(source.nodes[lookup[n]],point)}
    touched=np.any(np.isin(source.node_ids[source.elements],list(moved_set)),axis=1)
    touched_ids=set(map(int,source.element_ids[touched]))
    _require(touched_ids <= allowed|set(removed), 'Moved node reaches protected source cells')
    for n,point in changed: xyz[lookup[n]]=point
    if added:
        offset=len(xyz)
        lookup.update({n:offset+i for i,(n,_) in enumerate(added)})
        xyz=np.vstack((xyz,np.array([point for _,point in added])))
        ids=np.concatenate((ids,np.array([n for n,_ in added],dtype=np.int64)))
    _require(set(map(int,h.flat)) <= lookup.keys(), 'Replacement references missing NID')
    _require({n for n,_ in added} <= set(map(int,h.flat)), 'Unused generated node records')
    elements=np.array([[lookup[int(n)] for n in row] for row in h],dtype=np.int64)
    _require(all(len(set(row))==8 for row in elements), 'Repeated H8 node reference')
    local_ids=np.arange(1,len(h)+1)
    patch=replace(source,nodes=xyz,node_ids=ids,elements=elements,element_ids=local_ids,part_ids=pids)
    own=face_owners(patch)
    _require(all(len(v)<=2 for v in own.values()), 'Nonmanifold patch face')
    boundary={key:rows[0]['nodeIDs'] for key,rows in own.items() if len(rows)==1}
    target={}
    for face in target_boundary_nids:
        _require(len(face)==4 and all(type(n) is int for n in face) and len(set(face))==4,
                 'Invalid target boundary Q4')
        key=_face_key(face)
        _require(key not in target and set(face)<=lookup.keys(), 'Duplicate or unknown target boundary')
        target[key]=face
    _require(boundary.keys()==target.keys() and all(_cycle(boundary[k])==_cycle(target[k]) for k in target),
             'Replacement does not match complete prescribed boundary')
    edge_count=Counter(tuple(sorted((a,b))) for face in target.values() for a,b in zip(face,face[1:]+face[:1]))
    _require(edge_count and all(c==2 for c in edge_count.values()), 'Target boundary not closed edge-manifold')
    old_owners=face_owners(source)
    for key,rows in old_owners.items():
        inside=[r for r in rows if r['eid'] in removed]
        outside=[r for r in rows if r['eid'] not in removed]
        if inside and outside:
            _require(key in boundary and _cycle(boundary[key])==_cycle(inside[0]['nodeIDs']),
                     'Patch breaks protected attachment partition')
    keep=~np.isin(source.element_ids,removed)
    reusable=sorted(removed)[:len(h)]
    new_eids=reusable+list(range(int(source.element_ids.max())+1,
                               int(source.element_ids.max())+1+len(h)-len(reusable)))
    output=replace(source,nodes=xyz,node_ids=ids,
        elements=np.vstack((source.elements[keep],elements)),
        element_ids=np.concatenate((source.element_ids[keep],new_eids)),
        part_ids=np.concatenate((source.part_ids[keep],pids)),element_cards=dict(source.element_cards))
    output.element_cards['*ELEMENT_SOLID']=len(output.elements)
    _require(len(np.unique(np.sort(output.elements,axis=1),axis=0))==len(output.elements),'Duplicate output H8')
    all_owners=face_owners(output)
    _require(all(len(v)<=2 for v in all_owners.values()), 'Assembly creates nonmanifold face')
    for rows in all_owners.values():
        if len(rows)==2:
            _require(_cycle(rows[0]['nodeIDs'])==_cycle(rows[1]['nodeIDs'][::-1]), 'Shared face orientation mismatch')
    new_mask=np.isin(output.element_ids,list(touched_ids-set(removed))+new_eids)
    quality=measure_h8(output.nodes,output.elements[new_mask])
    _require(quality['sampledPositiveJacobians'].all(), 'Nonpositive new-region or moved-neighbour Jacobian')
    sj=float(quality['cornerAndCenterScaledJacobian'].min())
    _require(minimum_sj is None or sj>=minimum_sj, 'Explicit caller SJ floor failed')
    certificates=[]
    if require_continuous_jacobian:
        from .h8_jacobian_certificate import certify_cell
        for eid,cell in zip(output.element_ids[new_mask],output.elements[new_mask]):
            certificate=certify_cell(output.nodes[cell])
            _require(certificate['certified'],'Continuous Jacobian not certified for EID '+str(eid)+': '+certificate['status'])
            certificates.append(dict(eid=int(eid),certificate=certificate))
    coordinate_map={int(n):point for n,point in zip(ids,xyz)}
    expected=boundary_volume(list(target.values()),coordinate_map)
    actual=float(measure_h8(xyz,elements)['integratedVolume'].sum())
    _require(expected>0 and abs(actual-expected)/expected<=1e-4, 'Patch boundary/cell volume mismatch')
    protected=~np.isin(source.element_ids,list(touched_ids|set(removed)))
    _require(np.array_equal(xyz[source.elements[protected]],source.nodes[source.elements[protected]]),
             'Protected element geometry changed')
    return output,dict(schema='full-source-volume-patch.v1',sourceElements=len(source.elements),
        outputElements=len(output.elements),removedElementIDs=sorted(removed),replacementElementIDs=new_eids,
        movedExistingElementIDs=sorted(touched_ids-set(removed)),checkedNewRegionElements=int(new_mask.sum()),
        newRegionMinimumCornerCenterSJ=sj,newRegionMinimumGaussDeterminant=float(quality['minimumGaussDeterminant'].min()),
        prescribedBoundaryFaces=len(target),attachmentPartitionsPreserved=True,protectedCoordinatesAndRowsUnchanged=True,
        patchVolume=actual,boundaryFluxVolume=expected,relativePatchVolumeError=abs(actual-expected)/expected,
        newRegionContinuousJacobianCertified=require_continuous_jacobian,
        newRegionCertificates=certificates,
        assemblyChecksPassed=True,globalOverlapCertified=False,globalGeometricConformityCertified=False,
        continuousJacobianCertified=False,wholeScrewAccepted=False,engineeringQualityAccepted=False)


def write_candidate_pair(source, removed_element_ids, replacement_nids, replacement_pids, new_output, **options):
    """Assemble ALL source rows and independently roundtrip K/INP, labelled candidate.

    This entry point deliberately has no option to turn its output into a final
    engineering acceptance certificate. Source object and existing paths stay
    untouched; failed own outputs remain with a rejection record.
    """
    from .screw_interface import _write_mesh_pair
    from .truegrid_screw import read_keyword
    from tools.verify_native_mesh_roundtrip import Snapshot, load_inp
    output=Path(new_output).absolute()
    _require(output.parent.is_dir() and not os.path.lexists(output), 'Require fresh candidate directory')
    mesh,report=assemble_patch(source,removed_element_ids,replacement_nids,replacement_pids,**options)
    _require(2*(160*len(mesh.nodes)+256*len(mesh.elements))<=64*1024**2,
             'Candidate IO preflight exceeds bounded delivery size')
    output.mkdir()
    try:
        _write_mesh_pair(mesh,output,'assembled-candidate',
                         'FULL SOURCE PATCH CANDIDATE; NOT ENGINEERING-ACCEPTED; NO SOLVER CERTIFICATION')
        snapshots=[Snapshot.read(output/name) for name in ('assembled-candidate.k','assembled-candidate.inp')]
        # Validate the exact bytes whose hashes will be published, not an earlier readback.
        with tempfile.TemporaryDirectory(prefix='io-snapshot-',dir=output) as temporary:
            path=Path(temporary)/'captured.k'
            with path.open('xb') as f:f.write(snapshots[0].data)
            reopened=read_keyword(path)
            _require(all(np.array_equal(getattr(reopened,k),getattr(mesh,k))
                         for k in ('nodes','node_ids','elements','element_ids','part_ids')),
                     'Captured candidate K differs from assembled full source')
        inp=load_inp(snapshots[1])
        ni,ei=np.argsort(mesh.node_ids),np.argsort(mesh.element_ids)
        _require(np.array_equal(inp.node_ids,mesh.node_ids[ni]) and np.array_equal(inp.nodes,mesh.nodes[ni])
                 and np.array_equal(inp.element_ids,mesh.element_ids[ei])
                 and np.array_equal(inp.elements,mesh.node_ids[mesh.elements[ei]]),
                 'Captured candidate INP labels or geometry differ from assembled full source')
        artifacts=[dict(path=s.path.name,bytes=len(s.data),sha256=s.sha256) for s in snapshots]
        _require(sum(a['bytes'] for a in artifacts)<=64*1024**2,'Candidate IO exceeds delivery size')
        report.update(ioRoundtrip=dict(k=True,independentInp=True),artifacts=artifacts,
                      wholeMeshIsCandidateOnly=True)
        payload=json.dumps(report,indent=2,allow_nan=False).encode()
        _require(len(payload)<=4*1024**2,'Candidate report exceeds byte budget')
        pending=output/'report.pending.json'
        with pending.open('xb') as f:
            f.write(payload);f.flush();os.fsync(f.fileno())
        for a in artifacts:
            p=output/a['path']
            _require(not p.is_symlink() and p.stat().st_size==a['bytes']
                     and hashlib.sha256(p.read_bytes()).hexdigest()==a['sha256'], 'Candidate changed before publication')
        _require(pending.read_bytes()==payload,'Candidate report changed before publication')
        os.link(pending,output/'report.json')
        try:
            pending.unlink()
        except OSError:
            pass
        return mesh,report
    except Exception as error:
        failure=dict(assemblyChecksPassed=False,wholeScrewAccepted=False,engineeringQualityAccepted=False,
                     error=dict(type=type(error).__name__,message=str(error)))
        with (output/'rejection.json').open('x') as f:json.dump(failure,f,indent=2)
        raise
