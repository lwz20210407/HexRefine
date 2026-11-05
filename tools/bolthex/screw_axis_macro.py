"""Bounded original-Screw multi-height axis closure experiment.

The accepted Screw modules are read-only dependencies. This module constructs
a real 9-H8 chart and a local retained-neighbour assembly, but rejects them:
fixed frontier corners already invalidate the proposed one-hex closure.
Neither a restored corner nor positive volume implies source-domain repair.
"""
from __future__ import annotations

import argparse
from dataclasses import replace
import hashlib
from itertools import product
import json
import math
from pathlib import Path

import numpy as np

from .mesh_audit import FACES, SIGNS
from .screw_axis_core import ORIGINAL_SCREW_SHA256
from .screw_interface import (extract_cavity, trace_interface_strip, axial_phase_constraints,
    small_segment_cavity, solid_segment_candidate, candidate_neighbour_assembly,
    face_owners, _cycle, _face_key, _write_mesh_pair)
from .truegrid_screw import ImportedSolids, read_keyword, audit_import

MAX_MACRO_CELLS = 64
MINIMUM_SJ = .15
FROZEN_PATHS = ('tools/bolthex/truegrid_screw.py','tools/bolthex/screw_axis_core.py',
    'tools/bolthex/screw_interface.py','tools/tests/test_truegrid_screw.py',
    'tools/tests/test_screw_axis_core.py','tools/tests/test_screw_interface.py',
    'docs/TRUEGRID_SCREW_REPLAY.md')


def _corner_neighbours():
    lookup={tuple(sign):i for i,sign in enumerate(SIGNS)}
    neighbours=[]
    for sign in SIGNS:
        row=[]
        for axis in range(3):
            other=sign.copy();other[axis]*=-1
            row.append(lookup[tuple(other)])
        neighbours.append(row)
    return neighbours


NEIGHBOURS=_corner_neighbours()


def fixed_corner_constraints(slots, coordinates):
    """A corner and its three neighbours fix SJ regardless of other vertices."""
    if len(slots)!=8:
        raise ValueError('Require eight slots, with None for unassigned vertices')
    result=[]
    for corner,neighbours in enumerate(NEIGHBOURS):
        indices=[corner,*neighbours]
        if any(slots[i] is None for i in indices):continue
        points=np.array([coordinates[int(slots[i])] for i in indices],dtype=float)
        edges=(points[1:]-points[0])*(-SIGNS[corner,:,None])
        denominator=float(np.prod(np.linalg.norm(edges,axis=1)))
        sj=float(np.linalg.det(edges.T)/denominator) if denominator else 0.
        result.append(dict(cornerSlot1Based=corner+1,nodeID=int(slots[corner]),
            neighbourNodeIDs=[int(slots[i]) for i in neighbours],
            scaledJacobian=sj,allThreeEdgesFixed=True,passesSJ=sj>=MINIMUM_SJ))
    return result


def enumerate_adjacent_face_completions(first, second, coordinates):
    """All cube face placements for two prescribed outward cyclic quads.

    The two vertices not in their union remain free. This is a finite topology
    enumeration, NOT a continuous search over all possible axis macros.
    """
    first,second=list(map(int,first)),list(map(int,second))
    if len(first)!=4 or len(second)!=4 or len(set(first))!=4 or len(set(second))!=4:
        raise ValueError('Require two distinct-vertex quads')
    common=set(first)&set(second)
    if len(common)!=2:
        raise ValueError('Two completion faces must share exactly one edge')
    for face in (first,second):
        if not any({face[i],face[(i+1)%4]}==common for i in range(4)):
            raise ValueError('Shared vertices are not a cyclic edge')
    charts=[];seen=set()
    for a,fa in enumerate(FACES):
        for b,fb in enumerate(FACES):
            if len(set(map(int,fa))&set(map(int,fb)))!=2:continue
            for ra in range(4):
                qa=first[ra:]+first[:ra]
                for rb in range(4):
                    qb=second[rb:]+second[:rb]
                    slots=[None]*8;valid=True
                    for face,values in ((fa,qa),(fb,qb)):
                        for index,value in zip(face,values):
                            if slots[index] is not None and slots[index]!=value:valid=False;break
                            slots[index]=value
                        if not valid:break
                    fixed=[v for v in slots if v is not None]
                    key=tuple(-1 if v is None else v for v in slots)
                    if not valid or len(set(fixed))!=6 or key in seen:continue
                    seen.add(key)
                    corners=fixed_corner_constraints(slots,coordinates)
                    charts.append(dict(fixedSlots=slots,freeSlots1Based=[i+1 for i,v in enumerate(slots) if v is None],
                        firstFace=a+1,secondFace=b+1,fixedCorners=corners,
                        minimumFixedCornerSJ=min(r['scaledJacobian'] for r in corners)))
    if not charts:
        raise ValueError('No consistently oriented adjacent-face completion')
    return dict(charts=charts,chartCount=len(charts),
        allOneHexCompletionsBlocked=all(c['minimumFixedCornerSJ']<MINIMUM_SJ for c in charts),
        bestFixedCornerSJ=max(c['minimumFixedCornerSJ'] for c in charts),
        scope='Only one additional H8 retaining these two exact frontier faces.',
        doesNotProveOriginalDomainIrreparable=True)


def source_axis_contract(source, small, phase):
    coordinates={int(n):p for n,p in zip(source.node_ids,source.nodes)}
    all_axis=sorted({r['id'] for r in small['boundaryNodes']
                     if np.linalg.norm(coordinates[r['id']][:2])<=1e-12},key=lambda n:coordinates[n][2])
    physical_faces=[f for f in small['boundary'] if f['geometry']['q4Area']>1e-14]
    physical_axis=sorted({n for f in physical_faces for n in f['selected']['nodeIDs']
                          if np.linalg.norm(coordinates[n][:2])<=1e-12},key=lambda n:coordinates[n][2])
    hard_axis=sorted({n for f in small['interface'] for n in f['selected']['nodeIDs']
                     if np.linalg.norm(coordinates[n][:2])<=1e-12},key=lambda n:coordinates[n][2])
    if len(physical_axis)<2 or len(hard_axis)<2:
        raise ValueError('Measured cavity has no supported multi-height physical axis')
    return dict(sourceSHA256=source.source_sha256,sourceEIDObligations=small['selectedEIDs'],
        hardFaces=small['interface'],hardAxisNodeIDs=hard_axis,
        physicalAxisStations=[dict(nodeID=n,xyz=coordinates[n].tolist(),hardRetained=n in hard_axis,
            nondegeneratePhysicalFaceBindings=[f['selected'] for f in physical_faces if n in f['selected']['nodeIDs']])
            for n in physical_axis],
        allAxisStations=[dict(nodeID=n,xyz=coordinates[n].tolist()) for n in all_axis],
        zeroAreaOnlyAxisNodeIDs=sorted(set(all_axis)-set(physical_axis)),
        axisIDClassification='Nonzero-area face ownership only; zero-area-only IDs may have coordinates on physical edges.',
        minimumSourceAxisPointNodeID=physical_axis[0],maximumSourceAxisPointNodeID=physical_axis[-1],
        phaseRelation=dict(turnOffsetColumns=phase['turnOffsetColumns'],phaseRowShift=phase['phaseRowShift'],
            measuredTurnAdvanceZ=phase['measuredTurnAdvanceZ'],sameLayerClosureApplied=False,
            firstMeasuredCorrespondence=phase['candidateLinks'][0]),
        warning='Source physical axis samples are not all mandatory mesh vertices; retained face identities are hard constraints.')


def survey_free_frontiers(mesh, hard_bindings=()):
    """Bound every adjacent two-free-face one-H8 append chart on this mesh.

    Fixed-corner feasibility is necessary, never sufficient, for a complete
    macro. Even an exhaustive negative here does not exclude re-tessellation.
    """
    if len(mesh.elements)>MAX_MACRO_CELLS:raise ValueError('Frontier survey exceeds bounded macro size')
    coordinates={int(n):p for n,p in zip(mesh.node_ids,mesh.nodes)}
    hard={_face_key(r['sourceSelected']['nodeIDs']) for r in hard_bindings}
    free=[owners[0] for key,owners in face_owners(mesh).items() if len(owners)==1 and key not in hard]
    pairs=[]
    for i,first in enumerate(free):
        for second in free[i+1:]:
            if len(set(first['nodeIDs'])&set(second['nodeIDs']))!=2:continue
            result=enumerate_adjacent_face_completions(first['nodeIDs'][::-1],second['nodeIDs'][::-1],coordinates)
            pairs.append(dict(frontierBindings=[first,second],completionEnumeration=result))
    return dict(freeFaceCount=len(free),adjacentPairCount=len(pairs),pairs=pairs,
        allSurveyedOneHexAppendsBlocked=bool(pairs) and all(p['completionEnumeration']['allOneHexCompletionsBlocked'] for p in pairs),
        bestSurveyedFixedCornerSJ=max((p['completionEnumeration']['bestFixedCornerSJ'] for p in pairs),default=None),
        scope='Only this fixed mesh, excluding all hard retained faces, with one new H8 glued to two entire adjacent free faces.',
        fullMacroAccepted=False,doesNotProveOriginalDomainIrreparable=True)


def original_context(source):
    if source.source_sha256!=ORIGINAL_SCREW_SHA256:
        raise ValueError('Require the reviewed actual original Screw K, not an analytic rod')
    selected=source.element_ids[(source.element_ids>=2817)&(source.element_ids<=5048)]
    cavity=extract_cavity(source,selected)
    strip=trace_interface_strip(cavity)
    phase=axial_phase_constraints(cavity,strip)
    small=small_segment_cavity(source,cavity,strip)
    base,base_report=solid_segment_candidate(source,cavity,strip,small)
    return dict(cavity=cavity,strip=strip,phase=phase,small=small,base=base,baseReport=base_report,
                axisContract=source_axis_contract(source,small,phase))


def build_one_hex_closure(source, context):
    """Restore the missing source corner via a real multi-height 9-H8 chart."""
    base,base_report=context['base'],context['baseReport']
    xyz={int(n):p for n,p in zip(base.node_ids,base.nodes)}
    original={int(n):p for n,p in zip(source.node_ids,source.nodes)}
    axis=int(base_report['axisNodeIDs'][0]);centre=int(base_report['newNodeIDs'][0])
    hard={_face_key(r['sourceSelected']['nodeIDs']) for r in base_report['matchedRetainedFaces']}
    frontier=[]
    for key,owners in face_owners(base).items():
        if len(owners)==1 and key not in hard and {axis,centre}<=set(owners[0]['nodeIDs']):
            frontier.append(owners[0])
    frontier.sort(key=lambda f:(f['eid'],f['localFace']))
    if len(frontier)!=2:
        raise ValueError('The measured chart no longer has two axis-end frontier faces')
    completions=enumerate_adjacent_face_completions(frontier[0]['nodeIDs'][::-1],frontier[1]['nodeIDs'][::-1],xyz)
    chosen=next((c for c in completions['charts'] if c['fixedSlots'][0]==centre and c['fixedSlots'][3]==axis),None)
    if chosen is None:raise ValueError('Expected original-frontier completion chart not found')
    available=[r['nodeID'] for r in context['axisContract']['physicalAxisStations'] if r['nodeID'] not in xyz]
    if len(available)<2:raise ValueError('Need two actual omitted source-axis heights')
    restored,other=available[:2]
    points=np.vstack((base.nodes,original[restored],original[other]))
    ids=np.r_[base.node_ids,restored,other]
    slots=list(chosen['fixedSlots']);free=[i for i,v in enumerate(slots) if v is None]
    for index,nid in zip(free,(restored,other)):slots[index]=int(nid)
    lookup={int(n):i for i,n in enumerate(ids)}
    extra=np.array([lookup[int(n)] for n in slots],dtype=np.int64)
    candidate=replace(base,nodes=points,node_ids=ids,elements=np.vstack((base.elements,extra)),
        element_ids=np.arange(1,len(base.elements)+2),part_ids=np.r_[base.part_ids,2],
        element_cards={'*ELEMENT_SOLID':len(base.elements)+1})
    if len(candidate.elements)>MAX_MACRO_CELLS:raise ValueError('Macro cell budget exceeded')
    owners=face_owners(candidate);frontier_owners=[]
    for face in frontier:
        pair=owners[_face_key(face['nodeIDs'])]
        if len(pair)!=2 or _cycle(pair[0]['nodeIDs'])!=_cycle(pair[1]['nodeIDs'][::-1]):
            raise ValueError('New macro did not share its two complete frontier faces')
        frontier_owners.append(pair)
    qa=audit_import(candidate)
    volume_error=abs(qa['integratedVolume']-context['small']['sourceSelectedAudit']['integratedVolume'])/abs(context['small']['sourceSelectedAudit']['integratedVolume'])
    existing_fixed=all(np.array_equal(p,original[int(n)]) for n,p in zip(ids,points) if int(n) in original)
    if not existing_fixed:raise ValueError('Macro changed an existing source coordinate')
    proof=dict(frontierBindings=frontier,completionEnumeration=completions,
        faceNodeSlots1Based=(FACES+1).tolist(),cornerSigns=SIGNS.tolist(),
        newFaceOrientationOpposesFrontier=True,
        chosenFixedSlots=chosen['fixedSlots'],chosenNodeIDs=slots,
        interpretation='Fixed corners block any single-H8 completion of this frontier, independent of the two free vertices.',
        limitedSubproblem='Retain this particular 8-H8 chart and attach exactly one hex to these two free end faces.',
        doesNotProveOriginalDomainIrreparable=True)
    report=dict(scope='rejected real-source-constrained 9-H8 multi-height axis chart',
        quality=qa,sourceEIDObligations=context['small']['selectedEIDs'],
        sourcePhaseRelation=context['axisContract']['phaseRelation'],
        localSectorColumns=6,crossTurnMacroTopologyCertified=False,
        restoredSourceAxisNodeIDs=[int(restored),int(other)],restoredOriginalCornerVertex=True,
        fullSourceDomainCoverageCertified=False,
        relativeSignedSourceVolumeError=volume_error,frontierActualOwners=frontier_owners,
        volumeLimit=1e-4,volumeGuardPassed=volume_error<=1e-4,
        nodeLimitMM=2e-6,interpolatedFaceCentreLimitMM=.02,
        distanceGatesEvaluated=False,
        allExistingSourceCoordinatesUnchanged=True,replacementAccepted=False,
        originalScrewAccepted=False,globalReplacementApplied=False,
        rejection='One-H8 axis closure has immutable negative fixed-corner Jacobians; restoring a vertex is not a repair.',
        nextSubproblem='Replace/re-tessellate the free-end frontier with a multi-H8 3D cap, while keeping all original retained faces and physical corner coverage.')
    return candidate,report,proof


def _shape(q):
    q=np.asarray(q,float)
    values=np.prod(1+SIGNS*q,axis=1)/8
    derivatives=np.column_stack([SIGNS[:,i]*np.prod(1+SIGNS[:,[j for j in range(3) if j!=i]]*q[[j for j in range(3) if j!=i]],axis=1)/8 for i in range(3)])
    return values,derivatives


def _inside_hex(point,xyz):
    q=np.zeros(3)
    for _ in range(24):
        values,derivatives=_shape(q);residual=values@xyz-point
        if np.linalg.norm(residual)<=1e-10:
            return q if np.max(abs(q))<1-1e-7 else None
        try:q-=np.linalg.solve(xyz.T@derivatives,residual)
        except np.linalg.LinAlgError:return None
        if not np.isfinite(q).all() or np.max(abs(q))>100:return None
    return None


def overlap_guard(mesh):
    """Bounded conservative hull separation plus positive overlap witnesses.

    A failure to find overlap is never treated as an absence certificate.
    Invalid charts fail closed before their geometric overlap can be certified.
    """
    if len(mesh.elements)>MAX_MACRO_CELLS:raise ValueError('Overlap guard is bounded to 64 macro cells')
    qa=audit_import(mesh)
    if not qa['meshOnlyAccepted']:
        return dict(status='blocked-invalid-H8',absenceCertified=False,overlapGuardPassed=False,
                    scope='inter-cell overlap only; no global injectivity certificate',intracellInjectivityCertified=False,
                    witnesses=[],reason='Invalid corner/Gauss/topology gate: no overlap-absence claim')
    cells=mesh.nodes[mesh.elements];witnesses=[];unresolved=[];separated=0
    sample=[np.zeros(3),*[np.array(q) for q in product((-1/math.sqrt(3),1/math.sqrt(3)),repeat=3)]]
    for i in range(len(cells)):
        for j in range(i+1,len(cells)):
            a,b=cells[i],cells[j]
            if any(a[:,k].max()<=b[:,k].min() or b[:,k].max()<=a[:,k].min() for k in range(3)):
                separated+=1;continue
            found=False
            for source,target,source_id,target_id in ((a,b,i,j),(b,a,j,i)):
                for q in sample:
                    point=_shape(q)[0]@source;other=_inside_hex(point,target)
                    if other is not None:
                        witnesses.append(dict(firstEID=int(mesh.element_ids[source_id]),secondEID=int(mesh.element_ids[target_id]),
                            xyz=point.tolist(),firstReference=q.tolist(),secondReference=other.tolist()))
                        found=True;break
                if found:break
            if not found:unresolved.append([int(mesh.element_ids[i]),int(mesh.element_ids[j])])
    certified=not witnesses and not unresolved
    return dict(status='overlap-detected' if witnesses else ('separated' if certified else 'unresolved'),
                scope='inter-cell overlap only; no global injectivity certificate',intracellInjectivityCertified=False,
                absenceCertified=certified,overlapGuardPassed=certified,witnesses=witnesses,
                unresolvedPairs=unresolved,aabbSeparatedPairs=separated)


def _source_digest(source, mask=None):
    if mask is None:
        mask=np.ones(len(source.elements),dtype=bool);used=np.arange(len(source.nodes))
    else:used=np.unique(source.elements[mask])
    data=[source.node_ids[used].astype('<i8'),source.nodes[used].astype('<f8'),
          source.element_ids[mask].astype('<i8'),source.part_ids[mask].astype('<i8'),
          source.node_ids[source.elements[mask]].astype('<i8')]
    digest=hashlib.sha256()
    for item in data:digest.update(item.tobytes())
    return digest.hexdigest()


def _frozen_hashes():
    repo=Path(__file__).resolve().parents[2]
    return {name:hashlib.sha256((repo/name).read_bytes()).hexdigest() for name in FROZEN_PATHS}


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('keyword',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args(argv)
    source=read_keyword(args.keyword)
    if args.output.exists() or not args.output.parent.is_dir():raise FileExistsError('Require fresh output directory')
    frozen_before=_frozen_hashes();source_before=_source_digest(source)
    context=original_context(source)
    outside=~np.isin(source.element_ids,context['small']['selectedEIDs'])
    outside_before=_source_digest(source,outside)
    candidate,report,proof=build_one_hex_closure(source,context)
    survey=survey_free_frontiers(context['base'],context['baseReport']['matchedRetainedFaces'])
    overlap=overlap_guard(candidate)
    assembly,assembly_report=candidate_neighbour_assembly(source,candidate,context['baseReport']['matchedRetainedFaces'])
    original=audit_import(source)
    remaining=sorted(set(original['badCornerElementIDs'])-set(original['axisCollapsedElementIDs']))
    if source_before!=_source_digest(source) or outside_before!=_source_digest(source,outside):
        raise ValueError('Source or outside-cavity coordinates/cells changed during the experiment')
    args.output.mkdir()
    for name,value in [('axis-contract.json',context['axisContract']),('macro-report.json',report),
                       ('fixed-frontier-proof.json',proof),('overlap-guard.json',overlap),
                       ('free-frontier-survey.json',survey),
                       ('local-assembly.json',assembly_report)]:
        (args.output/name).write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')
    _write_mesh_pair(candidate,args.output,'axis-macro-candidate','REJECTED AXIS MACRO; FIXED CORNER JACOBIAN FAILURE; NO SOURCE REPLACEMENT')
    _write_mesh_pair(assembly,args.output,'axis-macro-local-assembly','REJECTED LOCAL MACRO ASSEMBLY; BAD SOURCE CELLS RETAINED')
    frozen_after=_frozen_hashes()
    summary=dict(sourceSHA256=source.source_sha256,sourceSolids=len(source.elements),
        candidateH8=len(candidate.elements),candidateMinimumSJ=report['quality']['minimumCornerScaledJacobian'],
        candidateRestoresSourceCorner=report['restoredOriginalCornerVertex'],
        completionCharts=proof['completionEnumeration']['chartCount'],
        everyOneHexCompletionBlocked=proof['completionEnumeration']['allOneHexCompletionsBlocked'],
        bestFixedCornerSJ=proof['completionEnumeration']['bestFixedCornerSJ'],
        surveyedFreeFrontierPairs=survey['adjacentPairCount'],
        allSurveyedOneHexAppendsBlocked=survey['allSurveyedOneHexAppendsBlocked'],
        bestSurveyedFixedCornerSJ=survey['bestSurveyedFixedCornerSJ'],
        relativeSignedSourceVolumeError=report['relativeSignedSourceVolumeError'],
        phaseOffsetColumns=context['phase']['turnOffsetColumns'],phaseRowShift=context['phase']['phaseRowShift'],
        localAssemblyH8=len(assembly.elements),exactRetainedInterfaceFaces=assembly_report['exactSharedFaceCount'],
        overlapAbsenceCertified=overlap['absenceCertified'],fullSourceCoverageCertified=False,
        originalNoncollapsedBadEIDs=remaining,originalNoncollapsedBadCount=len(remaining),
        allSourceArraysUnchanged=source_before==_source_digest(source),
        outsideCavitySourceDigest=outside_before,sourceArrayDigest=source_before,
        frozenDependenciesUnchanged=frozen_before==frozen_after,
        replacementAccepted=False,originalScrewAccepted=False,sourceCellsDeleted=0,
        sourceCoordinatesMoved=0,globalReplacementApplied=False,
        blockedSubproblem=proof['limitedSubproblem'],nextSubproblem=report['nextSubproblem'])
    (args.output/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    (args.output/'frozen-dependencies.json').write_text(json.dumps(dict(before=frozen_before,after=frozen_after),indent=2)+'\n')
    concise={k:v for k,v in summary.items() if not k.endswith('EIDs')}
    (args.output/'result.txt').write_text(json.dumps(concise,indent=2)+'\n')
    print(json.dumps(concise,indent=2))
    return 2


if __name__=='__main__':raise SystemExit(main())
