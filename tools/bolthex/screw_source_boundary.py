"""Measured original-Screw 12-cell ID frontier and bounded Q4 queries.

``analyse`` recognizes only the exact reviewed source SHA. Its union-volume
proof is conditional on verified radial maps, disjoint angular sectors and
matching axial intervals; signed flux alone is never a general union proof.
No source cell, coordinate or ID is changed, deleted or welded.
"""
import argparse
from collections import Counter,defaultdict
from dataclasses import replace
import hashlib
import json
import math
import os
from pathlib import Path

import numpy as np

from .truegrid_screw import read_keyword,audit_import,MAX_BYTES
from .screw_interface import face_owners,face_geometry,skin_topology

KNOWN_SOURCE_SHA256='09c9ce96a5df2d8cf900be8fa716d6a0daf7e80d6cc26955e76e623d45182628'
SELECTED=tuple(range(2889,2895))+tuple(range(3969,3975))
MAX_OUTPUT_BYTES=64*1024*1024
MAX_QUERY_QUADS=64


def _sha(path):
    result=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1048576),b''):result.update(block)
    return result.hexdigest()


def _array(value,shape,label):
    raw=np.asarray(value)
    if raw.shape!=shape or raw.dtype.kind not in 'fiu':raise ValueError(f'Invalid numeric {label}')
    result=raw.astype(float)
    if not np.isfinite(result).all():raise ValueError(f'Nonfinite {label}')
    return result


def _quads(value):
    raw=np.asarray(value)
    if raw.ndim!=3 or raw.shape[1:]!=(4,3) or not 1<=len(raw)<=MAX_QUERY_QUADS:
        raise ValueError('Require 1..64 bounded Q4 faces')
    return _array(raw,raw.shape,'Q4 faces')


def q4_point(quad,uv):
    """Actual bilinear Q4 point; finite numeric u,v must lie in [0,1]."""
    quad=_array(quad,(4,3),'Q4');uv=_array(uv,(2,),'Q4 parameters')
    if np.any(uv<0) or np.any(uv>1):raise ValueError('Q4 parameters must lie in [0,1]')
    u,v=uv
    result=np.array([(1-u)*(1-v),u*(1-v),u*v,(1-u)*v])@quad
    if not np.isfinite(result).all():raise ValueError('Nonfinite Q4 point')
    return result


def project_q4(point,quads):
    """Five-start bounded Q4 witness, NOT a certified global closest point."""
    from scipy.optimize import minimize
    point=_array(point,(3,),'projection point');quads=_quads(quads);best=None
    for index,quad in enumerate(quads):
        for seed in ([.5,.5],[.1,.1],[.1,.9],[.9,.1],[.9,.9]):
            opt=minimize(lambda uv:float(np.sum((q4_point(quad,uv)-point)**2)),seed,
                method='L-BFGS-B',bounds=[(0,1),(0,1)],
                options=dict(ftol=1e-15,gtol=1e-12,maxiter=100,maxfun=500))
            xyz=q4_point(quad,opt.x);distance=float(np.linalg.norm(xyz-point))
            if not math.isfinite(distance):raise ValueError('Nonfinite projection witness')
            if best is None or distance<best['distance']:
                best=dict(faceIndex=index,uv=opt.x.tolist(),point=xyz.tolist(),distance=distance)
    return best


def project_source_free_point(point,ledger):
    """Legacy ID-unmatched Q4 witness, NOT proof of a globally free surface."""
    free=ledger['editableFreeFaces']
    witness=project_q4(point,[r['xyz'] for r in free])
    return dict(witness,binding=free[witness['faceIndex']]['binding'],
                method='source-ID-unmatched-Q4 multistart witness upper bound',
                exhaustiveNearestDistanceCertified=False)


def signed_q4_skin_volume(quads,axis=2):
    """Exact Q4 flux for div(e_axis*x_axis)=1, not an arbitrary union volume.

    The caller supplies a closed, consistently oriented physical boundary.
    Reversing the boundary reverses this signed result.
    """
    if type(axis) is not int or axis not in (0,1,2):raise ValueError('Flux axis must be 0, 1 or 2')
    quads=_quads(quads);signs=np.array([[-1,-1],[1,-1],[1,1],[-1,1]])
    volume=0.
    for u in (-1/math.sqrt(3),1/math.sqrt(3)):
        for v in (-1/math.sqrt(3),1/math.sqrt(3)):
            n=(1+signs[:,0]*u)*(1+signs[:,1]*v)/4
            du=signs[:,0]*(1+signs[:,1]*v)/4;dv=signs[:,1]*(1+signs[:,0]*u)/4
            xyz=np.einsum('fni,n->fi',quads,n)
            a=np.einsum('fni,n->fi',quads,du);b=np.einsum('fni,n->fi',quads,dv)
            volume+=float(np.sum(xyz[:,axis]*np.cross(a,b)[:,axis]))
    if not math.isfinite(volume):raise ValueError('Nonfinite signed Q4 flux')
    return volume


def radial_cell_certificate(vertices):
    """Verify one special radial cell, NOT an arbitrary H8 or cell-set union.

    In [0,1]^3, XY=r*((1-s)*A+s*B), Z=(1-t)*bottom(s)+t*top(s).
    det(dXYZ/d(r,s,t))=r*cross(A,B)*(top(s)-bottom(s)). At r>0 the
    verified map is injective/positive; its r=0 face is singular.
    """
    p=_array(vertices,(8,3),'radial cell')
    if (not np.array_equal(p[[0,3,4,7],:2],np.zeros((4,2)))
            or not np.array_equal(p[[1,2],:2],p[[5,6],:2])
            or not np.array_equal(p[[0,3,4,7],2],p[[1,2,5,6],2])):
        raise ValueError('Source cell is not the measured radial/axial special case')
    a,b=p[1,:2],p[2,:2];cross=float(a[0]*b[1]-a[1]*b[0])
    heights=p[[5,6],2]-p[[1,2],2];volume=float(cross*heights.sum()/4)
    if not math.isfinite(cross) or not math.isfinite(volume) or cross<=0 or np.any(heights<=0):
        raise ValueError('Nonpositive/nonfinite radial source interval')
    return dict(rootXY=[a.tolist(),b.tolist()],
        angleDegrees=np.rad2deg(np.arctan2([a[1],b[1]],[a[0],b[0]])).tolist(),
        bottomZ=p[[1,2],2].tolist(),topZ=p[[5,6],2].tolist(),
        radialAngularCross=cross,endpointHeights=heights.tolist(),exactUnsignedUnionVolume=volume,
        openCellJacobianPositive=True,axisSingularOnly=True)


def source_z_intervals(xy,certificates):
    """Closed Z occupancy of 1..12 verified radial certificates, not ID welding.

    Axis results are closure intervals, not open interior. This query merges
    actual geometric intervals; it makes no cell-set union-volume claim.
    """
    xy=_array(xy,(2,),'query XY')
    rows=list(certificates.values()) if isinstance(certificates,dict) else list(certificates)
    if not 1<=len(rows)<=12:raise ValueError('Require 1..12 bounded radial certificates')
    intervals=[]
    for row in rows:
        try:
            root=_array(row['rootXY'],(2,2),'radial root XY')
            bottom=_array(row['bottomZ'],(2,),'radial bottom Z')
            top=_array(row['topZ'],(2,),'radial top Z')
        except (KeyError,TypeError) as exc:raise ValueError('Invalid radial certificate') from exc
        cross=float(root[0,0]*root[1,1]-root[0,1]*root[1,0])
        if not math.isfinite(cross) or cross<=0 or np.any(top<=bottom):
            raise ValueError('Nonpositive radial certificate')
        if np.array_equal(xy,[0,0]):intervals.append([float(bottom.min()),float(top.max())]);continue
        a,b=np.linalg.solve(root.T,xy);radius=a+b
        if min(a,b)<-1e-12 or radius<=0 or radius>1+1e-12:continue
        s=float(b/radius)
        intervals.append([float((1-s)*bottom[0]+s*bottom[1]),float((1-s)*top[0]+s*top[1])])
    merged=[]
    for low,high in sorted(intervals):
        if merged and low<=merged[-1][1]+1e-12:merged[-1][1]=max(merged[-1][1],high)
        else:merged.append([low,high])
    return merged


def _arrays_sha(mesh):
    result=hashlib.sha256()
    for name in ('nodes','elements','node_ids','element_ids','part_ids'):
        values=np.asarray(getattr(mesh,name))
        result.update(name.encode());result.update(str((values.dtype.str,values.shape)).encode())
        result.update(values.tobytes())
    result.update(json.dumps(mesh.element_cards,sort_keys=True).encode())
    return result.hexdigest()


def analyse(source):
    """Return (summary, ledger) ONLY for the exact reviewed source K.

    The recognized 12-cell union proof does not certify an H8 replacement,
    arbitrary source meshes, other original cells, or solver/CAD behavior.
    """
    source=Path(source).resolve()
    if not source.is_file() or not 0<source.stat().st_size<=MAX_BYTES:
        raise ValueError('Source K exceeds the bounded reader input budget or is missing')
    before=_sha(source)
    if before!=KNOWN_SOURCE_SHA256:raise ValueError('Require the exact known original Screw source SHA256')
    mesh=read_keyword(source)
    if mesh.source_sha256!=before:raise ValueError('Source K changed while parsing')
    arrays_before=_arrays_sha(mesh)
    selected=set(SELECTED);coords={int(n):p for n,p in zip(mesh.node_ids,mesh.nodes)}
    records=[]
    all_face_owners=face_owners(mesh)
    for owners in all_face_owners.values():
        inside=[o for o in owners if o['eid'] in selected];outside=[o for o in owners if o['eid'] not in selected]
        if len(inside)!=1:continue
        face=inside[0];geometry=face_geometry(face['nodeIDs'],coords)
        records.append(dict(binding=face,retained=outside[0] if outside else None,
            xyz=[coords[n].tolist() for n in face['nodeIDs']],**geometry))
    zero=[r for r in records if r['q4Area']<=1e-14]
    physical=[r for r in records if r['q4Area']>1e-14]
    hard=[r for r in physical if r['retained'] is not None];free=[r for r in physical if r['retained'] is None]
    if tuple(map(len,(records,zero,physical,hard,free)))!=(40,12,28,8,20):
        raise ValueError('Measured boundary no longer matches the bounded source case')
    # Equal coordinates with different IDs are a contact candidate, not a weld.
    # Cyclic/reversed corner agreement preserves a bilinear Q4's parametrization.
    outside_by_corners=defaultdict(list)
    for owners in all_face_owners.values():
        for owner in owners:
            if owner['eid'] not in selected:
                xyz=[tuple(coords[n]) for n in owner['nodeIDs']]
                outside_by_corners[tuple(sorted(xyz))].append((owner,xyz))
    contacts=[]
    for record in free:
        xyz=[tuple(p) for p in record['xyz']];matches=[]
        for owner,corners in outside_by_corners.get(tuple(sorted(xyz)),[]):
            aligned=None
            for reverse in (False,True):
                rows=list(zip(corners,owner['nodeIDs']))
                if reverse:rows=rows[::-1]
                for shift in range(4):
                    moved=rows[shift:]+rows[:shift]
                    if [p for p,n in moved]==xyz:
                        aligned=[int(n) for p,n in moved];break
                if aligned is not None:break
            if aligned is not None:
                matches.append(dict(outsideBinding=owner,outsideNodeIDsInSelectedOrder=aligned,
                    maximumCornerGapMm=0.,nodeIdentityShared=False,
                    sourcePartIDsEqual=owner['pid']==record['binding']['pid']))
        record['exactCoordinateCoincidentOutsideFaces']=matches
        record['globalFreeSkinVerified']=False
        record['retessellationAuthorized']=False
        if matches:contacts.append(dict(selectedBinding=record['binding'],outsideMatches=matches))
    edge_rows=defaultdict(list);geometric=defaultdict(list);axis_edges=[]
    for index,record in enumerate(physical):
        f=record['binding']['nodeIDs']
        for a,b in zip(f,f[1:]+f[:1]):
            row=dict(faceIndex=index,binding=record['binding'],edgeNodeIDs=[a,b],
                xyz=[coords[a].tolist(),coords[b].tolist()],retained=record['retained'] is not None)
            edge_rows[tuple(sorted((a,b)))].append(row)
            geometric[tuple(sorted((tuple(coords[a]),tuple(coords[b]))))].append(row)
            if np.array_equal(coords[a][:2],[0,0]) and np.array_equal(coords[b][:2],[0,0]):axis_edges.append(row)
    axis_ids=sorted({n for r in records for n in r['binding']['nodeIDs'] if np.array_equal(coords[n][:2],[0,0])},key=lambda n:(coords[n][2],n))
    physical_axis={n for r in physical for n in r['binding']['nodeIDs'] if np.array_equal(coords[n][:2],[0,0])}
    station_z=sorted({float(coords[n][2]) for n in axis_ids});atoms=[]
    for lo,hi in zip(station_z,station_z[1:]):
        mid=(lo+hi)/2;owners=[]
        for row in axis_edges:
            za,zb=[p[2] for p in row['xyz']]
            if min(za,zb)<mid<max(za,zb):
                owners.append(dict(faceIndex=row['faceIndex'],binding=row['binding'],edgeNodeIDs=row['edgeNodeIDs'],
                    sign=1 if zb>za else -1,retained=row['retained']))
        atoms.append(dict(zInterval=[lo,hi],owners=owners,ownerCount=len(owners),orientationSum=sum(r['sign'] for r in owners)))
    all_source_axis=defaultdict(list)
    for nid,p in zip(mesh.node_ids,mesh.nodes):
        if np.array_equal(p[:2],[0,0]):all_source_axis[tuple(p)].append(int(nid))
    node_usage=defaultdict(list)
    coincident_axis_ids={nid for n in axis_ids for nid in all_source_axis[tuple(coords[n])]}
    for eid,cell in zip(mesh.element_ids,mesh.elements):
        for slot,nid in enumerate(mesh.node_ids[cell],1):
            if int(nid) in coincident_axis_ids:node_usage[int(nid)].append(dict(eid=int(eid),slot=slot,selected=int(eid) in selected))
    stations=[dict(nodeID=n,xyz=coords[n].tolist(),isPhysicalFaceVertex=n in physical_axis,
        exactCoincidentGlobalSourceNodeIDs=all_source_axis[tuple(coords[n])],
        coincidentIDCellBindings={nid:node_usage[nid] for nid in all_source_axis[tuple(coords[n])]},
        incidentPhysicalFaces=[r['binding'] for r in physical if n in r['binding']['nodeIDs']]) for n in axis_ids]
    proofs={int(eid):radial_cell_certificate(mesh.nodes[e]) for eid,e in zip(mesh.element_ids,mesh.elements) if int(eid) in selected}
    sectors=[]
    for low,up in zip(range(2889,2895),range(3969,3975)):
        a,b=proofs[low],proofs[up]
        if a['rootXY']!=b['rootXY'] or a['topZ']!=b['bottomZ']:
            raise ValueError('Source axial pair has a real overlap/gap')
        sectors.append(dict(eids=[low,up],angles=a['angleDegrees'],axialIntervalsMeetExactly=True))
    for a,b in zip(sectors,sectors[1:]):
        if a['angles'][1]!=b['angles'][0]:raise ValueError('Source angular sectors overlap or leave a gap')
    mask=np.isin(mesh.element_ids,SELECTED)
    sub=replace(mesh,elements=mesh.elements[mask],element_ids=mesh.element_ids[mask],part_ids=mesh.part_ids[mask],element_cards={'*ELEMENT_SOLID':12})
    raw_audit=audit_import(sub);union_volume=sum(p['exactUnsignedUnionVolume'] for p in proofs.values())
    fluxes=[signed_q4_skin_volume([r['xyz'] for r in physical],axis) for axis in range(3)]
    nonaxis=[dict(edgeNodeIDs=list(k),owners=v) for k,v in edge_rows.items()
             if not (np.array_equal(coords[k[0]][:2],[0,0]) and np.array_equal(coords[k[1]][:2],[0,0]))]
    if (len(atoms)!=20 or any(a['ownerCount']!=2 or a['orientationSum']!=0 for a in atoms)
            or any(len(r['owners'])!=2 for r in nonaxis)):
        raise ValueError('Source physical edge ownership no longer matches the measured case')
    if any(abs(v-union_volume)>1e-12 for v in [raw_audit['integratedVolume'],*fluxes]):
        raise ValueError('Source conditional union, Gauss and skin volumes disagree')
    arrays_after=_arrays_sha(mesh)
    if _sha(source)!=before or arrays_after!=arrays_before:raise ValueError('Readonly source K or source arrays changed')
    result=dict(schemaVersion=1,sourceSHA256=before,selectedEIDs=list(SELECTED),selectedCells=12,
        allSourceCells=len(mesh.elements),sourceCellsDeleted=0,sourceCoordinatesMoved=0,sourceIDsWelded=0,
        rawBoundaryFaces=len(records),zeroAreaFaces=len(zero),nonzeroPhysicalFaces=len(physical),
        actualRetainedFaces=len(hard),actualEditableFreeFaces=len(free),
        idUnmatchedFaces=len(free),idUnmatchedFacesWithExactOutsideContacts=len(contacts),
        exactCoordinateContactPairs=sum(len(c['outsideMatches']) for c in contacts),
        freeFaceClassificationScope='Legacy editableFreeFaces means no shared-ID owner, not a global free skin',
        globalFreeSkinVerified=False,retessellationAuthorized=False,
        rawIDTopology=skin_topology([r['binding']['nodeIDs'] for r in records]),
        nonzeroIDTopology=skin_topology([r['binding']['nodeIDs'] for r in physical]),
        nonaxisEdgeIncidenceHistogram=dict(Counter(len(r['owners']) for r in nonaxis)),
        atomicAxisIncidenceHistogram=dict(Counter(r['ownerCount'] for r in atoms)),
        atomicAxisOrientationSums=sorted({r['orientationSum'] for r in atoms}),
        everyGeometricAxisIntervalHasTwoOppositeOwners=True,specialCaseUnionCertified=True,
        sourceUnionVolume=union_volume,sourceSignedGaussVolume=raw_audit['integratedVolume'],
        nonzeroSkinFluxVolumesXYZ=fluxes,sourceVolumeEqualsUnion=True,
        physicalAxisVertexNodeIDs=sorted(physical_axis),zeroAreaOnlyAxisNodeIDs=sorted(set(axis_ids)-physical_axis),
        retainedAxisNodeIDs=sorted({n for r in hard for n in r['binding']['nodeIDs'] if np.array_equal(coords[n][:2],[0,0])}),
        originalCorner=dict(nodeID=3980,xyz=coords[3980].tolist(),exactCoincidentGlobalSourceNodeIDs=all_source_axis[tuple(coords[3980])]),
        producerTrace=dict(module='tools.bolthex.screw_source_boundary',sourcePath=str(source),
            sourceFileUnchanged=True,sourceArraysUnchanged=True,sourceArraysSHA256Before=arrays_before,
            sourceArraysSHA256After=arrays_after,recognition='exact source SHA plus verified radial/axial cell case'),
        caveats=['Axis-edge atomization is diagnostic only; no ID welding or retained-face subdivision applied',
                 'Union proof is conditional on the verified radial maps and disjoint angular/axial interiors',
                 'Signed Q4 flux alone is not an arbitrary mesh union-volume certificate',
                 'ID-unmatched Q4s may contact outside cells under different IDs; retessellation is not authorized',
                 'Exact coordinate contacts are diagnostic, not an instruction to weld nodes or change parts',
                 'Q4 point witnesses do not certify an entire retessellated physical boundary',
                 'No original bad cell is deleted; this is not an accepted replacement'])
    ledger=dict(faces=records,nonzeroPhysicalFaces=physical,hardRetainedFaces=hard,editableFreeFaces=free,
        idUnmatchedFaces=free,exactCoordinateOutsideContacts=contacts,
        globalFreeSkinVerified=False,retessellationAuthorized=False,
        zeroAreaFaces=zero,edgeOwnersByIDs=[dict(edgeNodeIDs=list(k),owners=v) for k,v in edge_rows.items()],
        geometricExactEdgeGroups=[dict(endpoints=list(k),owners=v) for k,v in geometric.items()],
        axisEdgeIntervals=atoms,axisStations=stations,radialCellCertificates=proofs,sectors=sectors)
    return result,ledger


def cavity_contract(summary,ledger):
    """Compact original-source constraints, never artificial chart constraints."""
    groups=defaultdict(list)
    for face in ledger['editableFreeFaces']:
        index=face['binding']['localFace']
        name={1:'bottom',2:'top',3:'theta-zero-side',4:'upper-outer-wall'}[index]
        groups[name].append(face)
    return dict(schemaVersion=1,sourceSHA256=summary['sourceSHA256'],originalEIDs=list(SELECTED),
        hardFaces=ledger['hardRetainedFaces'],editableFreeFaceGroups=groups,
        globalFreeSkinVerified=False,retessellationAuthorized=False,
        exactCoordinateOutsideContacts=ledger['exactCoordinateOutsideContacts'],
        roleScope='Selected 12-cell ID frontier only; preserve/check complete-source contacts before replacement',
        sourceUnionVolume=summary['sourceUnionVolume'],requiredOriginalCorner=summary['originalCorner'],
        hardAxisNodeIDs=summary['retainedAxisNodeIDs'],zeroAreaAxisFacesAreNotPhysicalSurfaces=True,
        noIDWeldingPerformed=True,originalSourceEdited=False,producerTrace=summary['producerTrace'])


def write_contract(source,output):
    """Analyse, then create a fresh output directory exclusively.

    Existing output is never overwritten or removed. I/O errors may retain
    this invocation's new directory for diagnosis; producer-trace.json is the
    last completion marker. Each output and their total are limited to 64 MiB.
    """
    output=Path(output).absolute();output=output.parent.resolve()/output.name
    if not output.parent.is_dir() or os.path.lexists(output):raise ValueError('Require fresh output with existing parent')
    summary,ledger=analyse(source)
    values={'summary.json':summary,'boundary-ledger.json':ledger,
            'fillable-cavity-contract.json':cavity_contract(summary,ledger)}
    payloads={name:(json.dumps(value,indent=2,allow_nan=False)+'\n').encode('utf8') for name,value in values.items()}
    trace=dict(summary['producerTrace'],sourceSHA256=summary['sourceSHA256'],complete=True,
        outputs={name:dict(bytes=len(data),sha256=hashlib.sha256(data).hexdigest()) for name,data in payloads.items()})
    payloads['producer-trace.json']=(json.dumps(trace,indent=2,allow_nan=False)+'\n').encode('utf8')
    if any(len(data)>MAX_OUTPUT_BYTES for data in payloads.values()) or sum(map(len,payloads.values()))>MAX_OUTPUT_BYTES:
        raise ValueError('Source-boundary output exceeds the 64 MiB budget')
    if _sha(source)!=summary['sourceSHA256']:raise ValueError('Source K changed before output creation')
    output.mkdir()
    for name,data in payloads.items():
        if name=='producer-trace.json' and _sha(source)!=summary['sourceSHA256']:
            raise ValueError('Source K changed before output completion')
        with (output/name).open('xb') as stream:
            if stream.write(data)!=len(data):raise OSError('Incomplete boundary-contract output write')
    return summary


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args(argv);summary=write_contract(args.source,args.output)
    print(json.dumps({k:v for k,v in summary.items() if k not in ('rawIDTopology','nonzeroIDTopology')},indent=2))
    return 0


if __name__=='__main__':raise SystemExit(main())
