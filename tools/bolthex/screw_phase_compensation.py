"""Measured original-Screw periodic-interface compensation, NOT axis remeshing.

Only the reviewed source SHA is supported. Correspondences come from actual
strip/phase face incidence, never a global coordinate-nearest-node weld.
All retained cells and the entire original coordinate table remain unchanged.
Redirected selected-cell references have a bounded trilinear image change.
The original invalid axis cells remain; exported research output is rejected
as a completed H8 mesh and must not be presented as an axis repair.
"""
from dataclasses import fields,replace
from pathlib import Path
import argparse
import hashlib
import json
import math
import os
import numpy as np

from .geometry_accuracy_policy import CadAccuracyPolicy
from .mesh_audit import FACES,SIGNS
from .screw_axis_core import ORIGINAL_SCREW_SHA256
from .screw_interface import extract_cavity,trace_interface_strip,axial_phase_constraints,face_owners,_write_mesh_pair
from .truegrid_screw import MAX_BYTES,read_keyword,audit_import

BODY_IDS=tuple(range(2889,5049))
MAX_OUTPUT_BYTES=16*1024*1024


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _cycle(nodes):
    nodes=list(map(int,nodes))
    return min(tuple(nodes[i:]+nodes[:i]) for i in range(4))


def _validated_policy(value):
    if not isinstance(value,CadAccuracyPolicy):raise ValueError('Require an explicit validated geometry policy')
    # Rebuild the base policy so subclass overrides cannot bypass field/budget validation.
    policy=CadAccuracyPolicy(**{field.name:getattr(value,field.name) for field in fields(CadAccuracyPolicy)})
    budget=policy.distance_budget_mm(critical=True)
    if not math.isfinite(budget) or budget<=0:raise ValueError('Critical budget must be finite, positive and representable')
    return policy


def _check_quality_regression(before,after,old_corner,new_corner):
    for key,label in (('badGaussElementIDs','nonpositive Gauss cell'),
                      ('nonpositiveVolumeElementIDs','nonpositive cell volume'),
                      ('badCornerElementIDs','corner quality failure'),
                      ('badCenterElementIDs','center quality failure')):
        if not set(after.get(key,[]))<=set(before.get(key,[])):raise ValueError('Compensation introduced a new '+label)
    if (old_corner.shape!=new_corner.shape or not np.isfinite(old_corner).all()
            or not np.isfinite(new_corner).all()):raise ValueError('Invalid corner regression measurements')
    if np.any((old_corner>0)&(new_corner<=0)) or np.any((old_corner>=0)&(new_corner<0)):
        raise ValueError('Compensation introduced a nonpositive or negative corner')
    if np.any(new_corner<old_corner-1e-12):raise ValueError('Selected minimum corner SJ became worse')


def _check_face_regression(old_faces,new_faces):
    def defective(owners):
        return (len(owners)>2 or len(owners)==2
                and _cycle(owners[0]['nodeIDs'])!=_cycle(owners[1]['nodeIDs'][::-1]))
    def bindings(owners):
        return {(owner['eid'],owner['pid'],owner['localFace']) for owner in owners}
    for key,owners in new_faces.items():
        if not defective(owners):continue
        original=old_faces.get(key,[])
        if (not defective(original) or len(owners)>len(original)
                or not bindings(owners)<=bindings(original)):
            raise ValueError('New nonmanifold or inconsistently oriented face ownership introduced')


def _corner_minimum(mesh,mask):
    p=mesh.nodes[mesh.elements[mask]];p=p-p[:,:1]
    result=np.full(len(p),np.inf)
    for u in (-1,1):
        for v in (-1,1):
            for w in (-1,1):
                d=np.column_stack((SIGNS[:,0]*(1+SIGNS[:,1]*v)*(1+SIGNS[:,2]*w),
                    SIGNS[:,1]*(1+SIGNS[:,0]*u)*(1+SIGNS[:,2]*w),
                    SIGNS[:,2]*(1+SIGNS[:,0]*u)*(1+SIGNS[:,1]*v)))/8
                j=np.einsum('eni,nj->eij',p,d);norm=np.linalg.norm(j,axis=1).prod(axis=1)
                value=np.divide(np.linalg.det(j),norm,out=np.zeros(len(p)),where=norm>0)
                result=np.minimum(result,value)
    return result


def compensate(keyword,geometry_policy):
    """Return a full-source derived mesh and scoped PREPROCESSOR evidence."""
    geometry_policy=_validated_policy(geometry_policy)
    keyword=Path(keyword).resolve()
    if not keyword.is_file() or not 0<keyword.stat().st_size<=MAX_BYTES:raise ValueError('Missing or oversized original source')
    digest=_sha(keyword)
    if digest!=ORIGINAL_SCREW_SHA256:raise ValueError('Only the reviewed original Screw source is supported')
    source=read_keyword(keyword)
    if source.source_sha256!=digest:raise ValueError('Source changed while parsing')
    for name in ('nodes','elements','node_ids','element_ids','part_ids'):getattr(source,name).setflags(write=False)
    mask=np.isin(source.element_ids,BODY_IDS)
    if np.count_nonzero(mask)!=2160:raise ValueError('Original body scope differs')
    cavity=extract_cavity(source,BODY_IDS);strip=trace_interface_strip(cavity)
    phase=axial_phase_constraints(cavity,strip)
    if phase['turnOffsetColumns']!=36 or phase['phaseRowShift']!=2:raise ValueError('Unexpected actual helical phase')
    budget=geometry_policy.distance_budget_mm(critical=True)
    coords={int(n):p for n,p in zip(source.node_ids,source.nodes)}
    outside_nodes=set(map(int,source.node_ids[source.elements[~mask]].flat))
    parent={};preferred=[];pair_count=0;maximum_pair_gap=0.

    def root(n):
        parent.setdefault(n,n)
        while parent[n]!=n:
            parent[n]=parent[parent[n]];n=parent[n]
        return n

    def join(a,b,pid_a,pid_b):
        nonlocal pair_count,maximum_pair_gap
        if pid_a!=pid_b:raise ValueError('Measured correspondence crosses source parts')
        a,b=int(a),int(b)
        gap=float(np.linalg.norm(coords[a]-coords[b]));maximum_pair_gap=max(maximum_pair_gap,gap)
        if gap>budget:raise ValueError('Measured periodic-interface gap exceeds the explicit engineering budget')
        if (np.all(coords[a][:2]==0))!=(np.all(coords[b][:2]==0)):raise ValueError('Axis and wall vertices cannot be identified')
        ra,rb=root(a),root(b)
        if ra!=rb:parent[rb]=ra
        preferred.append(a);pair_count+=1

    for row in phase['candidateLinks']:
        join(row['advancedNodeID'],row['nextPhaseNodeID'],row['advancedBinding']['pid'],row['nextPhaseBinding']['pid'])
    for row in phase['phaseCapFaceCandidates']:
        if not row['oppositeCyclicOrientation']:raise ValueError('Source phase-cap cyclic orientation is incompatible')
        for a,b in zip(row['advancedBinding']['nodeIDs'],row['nextNodeIDsInAdvancedFaceOrder']):
            join(a,b,row['advancedBinding']['pid'],row['nextPhaseBinding']['pid'])
    groups={}
    for n in list(parent):groups.setdefault(root(n),set()).add(n)
    order={n:i for i,n in reversed(list(enumerate(preferred)))}
    aliases={};records=[]
    for group in groups.values():
        if len(group)<2:continue
        pinned=group & outside_nodes
        if len(pinned)>1:raise ValueError('Alias class has multiple immutable outside anchors')
        canonical=next(iter(pinned)) if pinned else min(group,key=lambda n:(order.get(n,10**9),n))
        distance=max(float(np.linalg.norm(coords[n]-coords[canonical])) for n in group)
        if distance>budget:raise ValueError('Transitive alias class exceeds its bounded source displacement')
        for n in group:aliases[n]=canonical
        records.append(dict(sourceNodeIDs=sorted(group),canonicalOriginalNodeID=canonical,
            retainedOutsideAnchor=bool(pinned),maximumReferenceDisplacementMm=distance))
    lookup={int(n):i for i,n in enumerate(source.node_ids)}
    redirect=np.array([lookup[aliases.get(int(n),int(n))] for n in source.node_ids])
    cells=source.elements.copy();cells[mask]=redirect[cells[mask]]
    if not np.array_equal(cells[~mask],source.elements[~mask]):raise ValueError('Retained outside connectivity changed')
    if np.any(np.diff(np.sort(cells[mask],axis=1),axis=1)<=0):raise ValueError('Identification collapsed a selected element ID reference')
    result=replace(source,elements=cells,source_sha256='')
    eid_index={int(e):i for i,e in enumerate(source.element_ids)}
    matched=[]
    for row in phase['phaseCapFaceCandidates']:
        a,b=row['advancedBinding'],row['nextPhaseBinding']
        left=source.node_ids[cells[eid_index[a['eid']],FACES[a['localFace']-1]]]
        right=source.node_ids[cells[eid_index[b['eid']],FACES[b['localFace']-1]]]
        if set(left)!=set(right) or _cycle(left)!=_cycle(right[::-1]):raise ValueError('Redirected phase faces do not cancel exactly')
        matched.append(dict(firstOriginalEID=a['eid'],firstLocalFace=a['localFace'],secondOriginalEID=b['eid'],
            secondLocalFace=b['localFace'],sharedOriginalNodeIDs=list(map(int,left))))
    before=audit_import(source);after=audit_import(result)
    after['repairApplied']=True
    after['repairScope']='Measured periodic-interface reference compensation only; original invalid axis remains'
    after['limitations']=[v for v in after['limitations'] if not v.startswith('No welding, orientation repair')]
    after['limitations'].append('Measured same-part phase correspondences were identified before this audit; no global nearest-coordinate weld or finite-axis repair.')
    old_corner,new_corner=_corner_minimum(source,mask),_corner_minimum(result,mask)
    _check_quality_regression(before,after,old_corner,new_corner)
    old_faces,new_faces=face_owners(source),face_owners(result)
    _check_face_regression(old_faces,new_faces)
    displacement=np.linalg.norm(source.nodes[cells]-source.nodes[source.elements],axis=2)
    maximum=float(displacement.max())
    if maximum>budget or np.any(displacement[~mask]!=0):raise ValueError('Compensation moved immutable source geometry')
    volume_error=abs(after['integratedVolume']-before['integratedVolume'])/abs(before['integratedVolume'])
    if volume_error>geometry_policy.carrier_limits()['relativeStepBrepVolumeError']:raise ValueError('Tolerance-bounded compensation volume discrepancy is excessive')
    if _sha(keyword)!=digest:raise ValueError('Readonly original K changed')
    report=dict(schemaVersion=1,purpose='Periodic source-interface preprocessing; NOT a finite-axis H8 repair',
        sourceSHA256=digest,sourceFileUnchanged=True,geometryAccuracyPolicy=geometry_policy.manifest(),
        originalSolids=len(cells),selectedSourceSolids=int(mask.sum()),retainedOutsideSolids=int((~mask).sum()),
        sourceNodeCoordinateRowsChanged=0,originalNodeIDsPreserved=True,originalElementIDsAndPIDsPreserved=True,
        outsideElementsExactlyUnchanged=True,outsideGeometryExactlyUnchanged=True,
        measuredTurnColumns=36,measuredPhaseRowShift=2,measuredTurnAdvanceZ=phase['measuredTurnAdvanceZ'],
        measuredRootCorrespondences=len(phase['candidateLinks']),measuredPhaseFacePairs=len(matched),
        nodePairChecks=pair_count,aliasClasses=records,redirectedNodeReferences=int(np.count_nonzero(cells!=source.elements)),
        maximumMeasuredPairGapMm=maximum_pair_gap,maximumSelectedTrilinearImageDisplacementBoundMm=maximum,
        imageDisplacementProof='Each new point minus its original trilinear point is a convex combination of the eight redirected-corner displacements on the reference cube. Both image sets therefore lie within this bound; this is not a global overlap or validity proof.',
        globalCoordinateNearestWeldUsed=False,phaseFacesSharedByExactIDs=True,matchedPhaseFaces=matched,
        measuredTopologicalIdentificationsApplied=True,
        unmatchedIDFacesBefore=sum(len(v)==1 for v in old_faces.values()),
        unmatchedIDFacesAfter=sum(len(v)==1 for v in new_faces.values()),
        originalIntegratedCellVolume=before['integratedVolume'],derivedIntegratedCellVolume=after['integratedVolume'],
        relativeIntegratedCellVolumeChange=volume_error,
        volumeSemantics='Sum of per-cell trilinear Gauss integrals, NOT a material union or overlap certificate',
        selectedMinimumCornerSJBefore=float(old_corner.min()),selectedMinimumCornerSJAfter=float(new_corner.min()),
        newNonpositiveGaussCells=[],newNonpositiveVolumeCells=[],newNonpositiveCornerCells=[],newNegativeCornerCells=[],
        newBadCornerCells=[],newNonmanifoldOrMisorientedFaces=[],remainingBadCornerSolids=len(after['badCornerElementIDs']),
        phaseCompensationValidated=True,axisRepaired=False,finiteAxisCoreInserted=False,
        completeSourceMeshAccepted=False,globalOverlapCertified=False,quality=after,
        scope='Known original source only. Head/neck geometric interfaces, finite axis, endpoint regularization and full quality remain unresolved.')
    return result,report


def generate(keyword,output,geometry_policy):
    output=Path(output).absolute();output=output.parent.resolve()/output.name
    if not output.parent.is_dir() or os.path.lexists(output):raise ValueError('Require a fresh existing-parent output')
    mesh,report=compensate(keyword,geometry_policy)
    raw=(json.dumps(report,indent=2,allow_nan=False)+'\n').encode()
    if len(raw)>MAX_OUTPUT_BYTES:raise ValueError('Evidence exceeds the bounded output budget')
    output.mkdir()
    _write_mesh_pair(mesh,output,'phase-compensated-source','PARTIAL PERIODIC PREPROCESSOR; AXIS NOT REPAIRED; NOT AN ACCEPTED H8 MODEL')
    report.update(outputKSHA256=_sha(output/'phase-compensated-source.k'),outputINPSHA256=_sha(output/'phase-compensated-source.inp'))
    with (output/'report.json').open('x') as stream:json.dump(report,stream,indent=2,allow_nan=False)
    return report


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('keyword',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--target-size-mm',type=float,required=True)
    args=parser.parse_args(argv);report=generate(args.keyword,args.output,CadAccuracyPolicy.engineering(args.target_size_mm))
    print(json.dumps({k:v for k,v in report.items() if not isinstance(v,(list,dict))},allow_nan=False))
    return 3


if __name__=='__main__':raise SystemExit(main())
