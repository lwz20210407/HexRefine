"""Original-Screw axis scope planner and exact endpoint obstruction evidence.

This is a research planner, NOT an implemented cap mesher or a TrueGrid kernel.
It never changes, welds or removes an original cell. A failed sufficient test
is inconclusive; an exact-domain endpoint obstruction is not a statement that
a separately authorized tolerance-bounded derived geometry is impossible.
"""
from __future__ import annotations

import argparse
from dataclasses import fields
from fractions import Fraction as Q
import hashlib
import json
import math
from pathlib import Path

import numpy as np

from .hex_pair_separation import determinant_certificate
from .geometry_accuracy_policy import CadAccuracyPolicy
from .screw_axis_core import ORIGINAL_SCREW_SHA256
from .screw_interface import face_owners, extract_cavity
from .truegrid_screw import read_keyword, audit_import


MAX_SOURCE_CELLS = 100000


def _q(value):
    return Q.from_float(float(value))


def upper_axis_endpoint_cone(vertices):
    """Exact necessary tangent-plane condition for an isolated tapered endpoint.

    Standard H8 has axis slots0,3,4,7. XY=r*R(s,w), where R is bilinear
    between the four possibly different (tapered) root corners. Z is bilinear
    in s,w. This handles the actual tip; it does not assume constant radius.
    """
    p = np.asarray(vertices, dtype=float)
    if p.shape != (8, 3) or not np.isfinite(p).all():
        raise ValueError('Require eight finite XYZ vertices')
    axis = [0, 3, 4, 7]
    roots = [1, 2, 5, 6]
    if (not np.array_equal(p[axis, :2], np.zeros((4, 2)))
            or not np.array_equal(p[axis, 2], p[roots, 2])):
        return dict(proved=False, reason='Not the verified tapered radial/axial H8 form')
    root = [[_q(x) for x in row] for row in p[roots, :2]]
    if min(r[0] for r in root) <= 0:
        return dict(proved=False, reason='Positive root-X chart not available')
    ba, bb, ta, tb = map(_q, p[axis, 2])
    if not tb > max(ba, bb, ta):
        return dict(proved=False, reason='No unique highest angular/axial endpoint')
    if min(ta-ba, tb-bb) <= 0:
        return dict(proved=False, reason='Nonpositive axial heights')
    c = min(tb-ta, tb-bb, (tb-ba)/2)
    z_coefficients = (Q(0), tb-ta-c, tb-bb-c, tb-ba-2*c)
    assert c > 0 and min(z_coefficients) >= 0
    b1 = root[-1]
    cross_values = [b1[0]*r[1]-b1[1]*r[0] for r in root]
    M = max(abs(v) for v in cross_values)
    xmin = min(r[0] for r in root)
    C = M/(xmin*c)
    return dict(proved=True, endpointXYZ=[0., 0., float(tb)],
        actualSourceVertices=p.tolist(),
        exactRootXY=[list(map(str, r)) for r in root], exactAxisZ=list(map(str, (ba, bb, ta, tb))),
        exactC=str(c), exactHeightDeficitBernsteinCoefficients=list(map(str, z_coefficients)),
        exactMinimumRootX=str(xmin), exactRootCrossValues=list(map(str, cross_values)),
        exactM=str(M), exactCuspBound=str(C), exactTangentPlaneNormal=[str(-b1[1]), str(b1[0]), '0'],
        inequality='h=Zmax-Z>=c*((1-s)+(1-w)); X>=xmin*r; |m(XY)|<=C*X*h, m=cross(B1,XY).',
        derivation='The four bilinear Bernstein coefficients of h-c*((1-s)+(1-w)) are nonnegative. Root-X is bounded below by xmin. cross(B1,R) is zero at(s,w)=(1,1) and bounded in magnitude by M*((1-s)+(1-w)). Multiplication by r gives the exact stated bound.',
        tangentConsequence='At P, X=h=0, so every tangent direction satisfies m(d)=0. The material tangent cone has zero 3D volume.',
        scope='Only this cell image until full-source isolation is independently established.')


def _components(ids, owners):
    ids = set(map(int, ids))
    graph = {e: set() for e in ids}
    for pair in owners.values():
        if len(pair) == 2:
            a, b = pair[0]['eid'], pair[1]['eid']
            if a in ids and b in ids:
                graph[a].add(b); graph[b].add(a)
    remaining = set(ids); components = []
    while remaining:
        stack = [min(remaining)]; group = set()
        while stack:
            e = stack.pop()
            if e not in remaining:
                continue
            remaining.remove(e); group.add(e); stack.extend(graph[e])
        components.append(sorted(group))
    return components


def _binding(mesh, index):
    return dict(eid=int(mesh.element_ids[index]), pid=int(mesh.part_ids[index]),
                nodeIDs=mesh.node_ids[mesh.elements[index]].tolist())


def _validated_policy(value):
    if value is None:
        return CadAccuracyPolicy()
    if not isinstance(value, CadAccuracyPolicy):
        raise ValueError('Require a validated CadAccuracyPolicy, not a dict or raw budget')
    # Revalidate fields and use base-class budget methods, not subclass overrides.
    policy = CadAccuracyPolicy(**{f.name: getattr(value, f.name) for f in fields(CadAccuracyPolicy)})
    budget = policy.distance_budget_mm(critical=True)
    if not math.isfinite(budget) or budget <= 0:
        raise ValueError('Critical geometry budget must be representable, finite and positive')
    return policy


def plan_axis_scope(keyword, validated_geometry_policy=None, *, geometry_policy=None):
    """Read-only scope plan; geometry_policy is the preferred optional policy.

    Retain the previous positional/keyword spelling for existing research
    callers. Neither spelling authorizes source mutation or accepts a mesh.
    """
    if geometry_policy is not None and validated_geometry_policy is not None:
        raise ValueError('Specify geometry_policy or validated_geometry_policy, not both')
    policy = _validated_policy(geometry_policy if geometry_policy is not None else validated_geometry_policy)
    keyword = Path(keyword)
    source = read_keyword(keyword)
    if source.source_sha256 != ORIGINAL_SCREW_SHA256:
        raise ValueError('Require the reviewed original Screw K, without edits')
    if len(source.elements) > MAX_SOURCE_CELLS:
        raise ValueError('Source exceeds100000-cell research budget')
    qa = audit_import(source)
    xyz = source.nodes[source.elements]
    axis_count = np.all(xyz[:, :, :2] == 0, axis=2).sum(axis=1)
    bad = set(qa['badCornerElementIDs'])
    axis_bad_indices = [i for i, e in enumerate(source.element_ids) if int(e) in bad and axis_count[i] >= 2]
    axis_seeds = {int(source.element_ids[i]) for i in axis_bad_indices}
    regular_axis_indices = [i for i, e in enumerate(source.element_ids) if int(e) not in bad and axis_count[i] >= 2]
    regular_ids = {int(source.element_ids[i]) for i in regular_axis_indices}
    owners = face_owners(source)
    components = [group for group in _components(bad, owners) if axis_seeds.intersection(group)]
    selected = {eid for group in components for eid in group}
    by_eid = {int(e): i for i, e in enumerate(source.element_ids)}
    component_rows = []
    for group in components:
        p = xyz[[by_eid[e] for e in group]]
        component_rows.append(dict(originalEIDs=group, sourceCells=len(group),
            bounds=[p.min(axis=(0, 1)).tolist(), p.max(axis=(0, 1)).tolist()],
            originalBindings=[_binding(source, by_eid[e]) for e in group]))
    cavity = extract_cavity(source, selected)
    endpoint = source.nodes[np.all(source.nodes[:, :2] == 0, axis=1)]
    zmax = float(endpoint[:, 2].max()); P = np.array([0., 0., zmax])
    possible = np.flatnonzero(np.all(xyz.min(axis=1) <= P, axis=1) & np.all(xyz.max(axis=1) >= P, axis=1))
    tip = dict(point=P.tolist(), aabbCandidateOriginalEIDs=source.element_ids[possible].tolist(),
               globalExteriorCuspConfirmed=False, independentlyCheckedSourceCells=len(source.elements))
    if len(possible) == 1:
        index = int(possible[0]); proof = upper_axis_endpoint_cone(xyz[index])
        other_max = max(_q(xyz[i, :, 2].max()) for i in range(len(xyz)) if i != index)
        gap = _q(zmax)-other_max
        tip.update(sourceBinding=_binding(source, index), cellConeCertificate=proof,
                   exactOtherCellsMaximumZ=str(other_max), exactIsolatingHeightGap=str(gap),
                   globalExteriorCuspConfirmed=bool(proof['proved'] and gap > 0))
    support = []
    for i in regular_axis_indices:
        proof = determinant_certificate(xyz[i])
        assert proof['certified']
        support.append(dict(**_binding(source, i), xyz=xyz[i].tolist(), exactPositiveJacobian=proof))
    extended = selected | regular_ids
    lower_z = min(float(xyz[by_eid[e], :, 2].min()) for e in regular_ids)
    bottom_point = np.array([0., 0., lower_z])
    bottom_possible = np.flatnonzero(np.all(xyz.min(axis=1) <= bottom_point, axis=1)
                                     & np.all(xyz.max(axis=1) >= bottom_point, axis=1))
    bottom_indices = set(map(int, bottom_possible))
    bottom_outside_gaps = [max(max(_q(xyz[i, :, j].min())-_q(bottom_point[j]),
                                   _q(bottom_point[j])-_q(xyz[i, :, j].max()), Q(0)) for j in range(3))
                          for i in range(len(xyz)) if i not in bottom_indices]
    bottom_gap = min(bottom_outside_gaps)
    regular_bottom = bool(bottom_gap > 0 and all(int(source.element_ids[i]) in regular_ids
                          and xyz[i, :, 2].min() == lower_z for i in bottom_possible))
    flat_cap = []
    for pair in owners.values():
        if len(pair) != 1 or pair[0]['eid'] not in regular_ids:
            continue
        face = pair[0]
        coordinates = [source.nodes[np.flatnonzero(source.node_ids == n)[0]].tolist() for n in face['nodeIDs']]
        if all(p[2] == lower_z for p in coordinates):
            flat_cap.append(dict(binding=face, xyz=coordinates, IDUnmatchedNotGlobalFreeCertificate=True))
    all_remaining_bad = sorted(bad-selected)
    exact_obstruction = tip['globalExteriorCuspConfirmed']
    engineering = policy.profile == 'engineering-cad-transfer'
    approximation_required = bool(engineering and exact_obstruction)
    selected_exact_obstruction = bool(exact_obstruction and not engineering)
    status = ('approximationRequiredNotYetSolved' if approximation_required else
              'strictExactDomainObstruction' if selected_exact_obstruction else 'scopePlanned')
    report = dict(schemaVersion=1, purpose='Read-only research selection planner; NOT a cap implementation',
        sourceKeyword=str(keyword.resolve()), sourceSHA256=source.source_sha256, originalSourceCells=len(source.elements),
        originalBadCornerCellCount=len(bad), originalNoncollapsedBadCount=len(bad-set(qa['axisCollapsedElementIDs'])),
        completeAxisBadCellCount=len(selected), originalSelectedAxisEIDs=sorted(selected),
        exactAxisBadSeedCellCount=len(axis_seeds),
        fullBadComponentExpansionAddedEIDs=sorted(selected-axis_seeds),
        selectionRule='Whole shared-ID bad-cell components seeded by corner-gate bad cells with at least two exact Z-axis vertices; no coordinate welding.',
        sharedIDCellComponents=component_rows, sharedIDComponentCount=len(components),
        contactConnectivity='Separate from shared-ID connectivity: body/neck have at least the measured exact2889/2853 and2890/2854 contacts. Such contact is not an ID weld.',
        actualRetainedSharedIDHardFaces=cavity['interface'], completeRawIDFrontier=[dict(selected=r['selected'], retained=r['retained'], geometry=r['geometry']) for r in cavity['boundary']],
        regularAxisSupportCellCount=len(support), regularAxisSupportCells=support,
        oneTimeLowerRegularCapExtendedSelection=sorted(extended), extendedSourceCellCount=len(extended),
        lowestSelectedAxisZ=float(xyz[axis_bad_indices, :, 2].min()), lowestRegularAxisSupportZ=lower_z,
        flatRegularBottomCapFaces=flat_cap,
        actualLowerEndpoint=dict(point=bottom_point.tolist(),
            aabbCandidateOriginalEIDs=source.element_ids[bottom_possible].tolist(),
            exactOtherAabbLInfinitySeparation=str(bottom_gap),
            locallyTrueExteriorFlatCap=regular_bottom,
            reason='Every whole-source AABB meeting this point belongs to an existing positive-J head support cell with the same flat minimum Z. All other source AABBs have strictly positive exact separation.'),
        lowerCapScope='These existing positive-J head cells reach a flat bottom. This is a regular axis cap option, not proof that the full neck disk and head partitions are conforming; retain exact/partial geometric contact ledgers.',
        fullSourceUpperEndpoint=tip,
        exactDomainTipCornerClosureBlocked=exact_obstruction,
        selectedPolicyExactObstruction=selected_exact_obstruction,
        approximationRequiredNotYetSolved=approximation_required, plannerStatus=status,
        validatedGeometryPolicy=policy.manifest(all_surfaces_critical=True),
        criticalGeometryBudgetMM=policy.distance_budget_mm(critical=True),
        targetSizeProvenance='Caller-declared original target seed size; never inferred from candidate quality or an incidental shortest edge. Bind original seed IDs in any candidate evidence.',
        targetSeedBindingRequiredBeforeCandidateAcceptance=True,
        exactObstructionRulesOutEngineeringApproximation=False,
        unchangedHardGates=dict(minimumCornerSJ=.15, positiveGauss=True,
            nondegenerateInterior=True, relativeMeshVolumeLimit=1e-4,
            immutableSourceMath=True, unchangedFarField=True, conformingInterfaces=True,
            noRetainedDomainCollision=True, noAutomaticIDWelding=True),
        remainingObligations=[
            'Construct an actual finite engineering candidate; a budget is not an implementation.',
            'Bind h to original seeds, and honor critical size, gap and root constraints.',
            'Audit both directions of the full physical boundary, not only candidate nodes.',
            'Keep all source coordinates outside the declared core and the far field unchanged.',
            'Complete the full-source head/phase interfaces, including the +36/+2 relation.',
            'Retain SJ>=.15, positive Gauss/global Jacobian, mesh volume1e-4 and no collisions/hanging faces.',
            'Track all original2328 noncollapsed bad cells; no whole-source quality claim.'],
        rejectionCondition='If the original highest axis endpoint must be covered as an exact nondegenerate H8 corner, its isolated zero-volume tangent cone contradicts three independent inward directions. Do not fix this by moving the same cusp to a different cut.',
        toleranceBoundedDerivedGeometryRuledOut=False, derivedGeometryRepairAuthorized=engineering,
        repairAuthorizationScope='Engineering candidates within the validated critical geometry budget only; no original source-file mutation, welding or mesh-validity waiver.',
        plannerExitCode=3 if approximation_required else 2 if selected_exact_obstruction else 0,
        plannerExitCodeMeaning='0=plan written;2=strict exact endpoint obstruction;3=engineering approximation required and not solved. No code certifies a mesh.',
        allOriginalCellsUnmodified=True, originalBadCellsOutsideAxisSelection=all_remaining_bad,
        originalBadCellsOutsideSelectionCount=len(all_remaining_bad),
        selectedNoncollapsedOriginalBadCount=len(selected-set(qa['axisCollapsedElementIDs'])),
        preservation='The original2328 noncollapsed bad cells stay in the source untouched. The plan tracks2196 inside the axis selection and132 outside; no subset success would certify their replacement or whole-model quality.',
        globalFreeSkinVerified=False, sourceIDsWelded=0, sourceCoordinatesMoved=0,
        actualReplacementApplied=False, positiveSourceAcceptedReplacementImplemented=False,
        independentCADVerified=False)
    if hashlib.sha256(keyword.read_bytes()).hexdigest() != source.source_sha256:
        raise ValueError('Read-only source changed during planning')
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('keyword', type=Path)
    parser.add_argument('output', type=Path, help='Fresh evidence directory, never overwrite')
    parser.add_argument('--accuracy-profile', '--geometry-profile', choices=('strict', 'engineering'), default=None)
    parser.add_argument('--h', '--target-size-mm', dest='target_size_mm', type=float,
                        help='Declared original source target seed size in mm, not candidate quality')
    parser.add_argument('--critical-h', '--critical-target-size-mm', dest='critical_target_size_mm', type=float)
    parser.add_argument('--minimum-functional-gap-mm', type=float)
    parser.add_argument('--minimum-root-radius-mm', type=float)
    args = parser.parse_args(argv)
    if args.output.exists() or not args.output.parent.is_dir():
        raise FileExistsError('Require a fresh output under an existing case directory')
    profile = args.accuracy_profile or ('engineering' if args.target_size_mm is not None else 'strict')
    policy = CadAccuracyPolicy('engineering-cad-transfer' if profile == 'engineering' else 'strict-cad-regression',
        target_size_mm=args.target_size_mm, critical_target_size_mm=args.critical_target_size_mm,
        minimum_functional_gap_mm=args.minimum_functional_gap_mm, minimum_root_radius_mm=args.minimum_root_radius_mm)
    report = plan_axis_scope(args.keyword, geometry_policy=policy)
    args.output.mkdir()
    (args.output / 'axis-scope-plan.json').write_text(json.dumps(report, indent=2, allow_nan=False)+'\n', encoding='ascii')
    brief = {k: report[k] for k in ('originalSourceCells', 'completeAxisBadCellCount',
        'sharedIDComponentCount', 'extendedSourceCellCount', 'lowestRegularAxisSupportZ',
        'originalBadCellsOutsideSelectionCount', 'exactDomainTipCornerClosureBlocked',
        'selectedPolicyExactObstruction', 'approximationRequiredNotYetSolved',
        'plannerStatus', 'criticalGeometryBudgetMM', 'positiveSourceAcceptedReplacementImplemented')}
    (args.output / 'result.txt').write_text(json.dumps(brief, indent=2)+'\n', encoding='ascii')
    print(json.dumps(brief, indent=2))
    return report['plannerExitCode']


if __name__ == '__main__':
    raise SystemExit(main())
