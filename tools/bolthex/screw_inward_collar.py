"""Mapped inward seven-Hex collar for the reviewed phase-compensated Screw.

Only the repository's built two-to-one template function supplies connectivity.
No vendor JSON, coordinate-nearest weld, cavity filler or axis acceptance is
implemented. The historical .15 SJ project floor is not a vendor-universal rule.
"""
from collections import Counter, defaultdict, deque
from dataclasses import replace
import hashlib
from itertools import product
import json
import math
from pathlib import Path
import shutil
import subprocess

import numpy as np

from .mesh_audit import FACES, SIGNS
from .screw_axis_core import ORIGINAL_SCREW_SHA256
from .screw_phase_compensation import BODY_IDS
from .screw_interface import extract_cavity, trace_interface_strip, face_owners, skin_topology, _write_mesh_pair
from .truegrid_screw import ImportedSolids, read_keyword, audit_import
from .h8_quality_report import measure_h8, summarize_h8

KNOWN_PHASE_SHA256 = 'fa9aefa9ca2dcf5a06c6f2c0588864c4375fa490b37a85944c01640f8bcd5a8d'
MAX_OUTPUT_BYTES = 64*1024**2
MAX_INPUT_BYTES = 32*1024**2
MAX_SEARCH = 10000


def _sha(path):
    path=Path(path)
    if not path.is_file() or not 0<path.stat().st_size<=MAX_INPUT_BYTES:
        raise ValueError('Missing or oversized source/template input')
    digest=hashlib.sha256();total=0
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024**2),b''):
            total+=len(chunk)
            if total>MAX_INPUT_BYTES:raise ValueError('Input grew beyond its byte budget')
            digest.update(chunk)
    return digest.hexdigest()


def _cycle(q):
    q = tuple(q)
    return min(q[i:]+q[:i] for i in range(len(q)))


def _key(q):
    return min(_cycle(q), _cycle(tuple(q)[::-1]))


def load_repository_templates(node_executable=None):
    """Export the existing repo dist module, never vendored connectivity data."""
    repo = Path(__file__).resolve().parents[2]
    module, source = repo/'dist/two-to-one-templates.js', repo/'src/two-to-one-templates.ts'
    if not module.is_file() or not source.is_file() or module.stat().st_size > 65536:
        raise ValueError('Build the existing repository two-to-one templates first')
    node = node_executable or shutil.which('node')
    if not node:raise ValueError('Existing Node runtime is required; no installation attempted')
    program = "import {pathToFileURL} from 'node:url';const m=await import(pathToFileURL(process.argv[1]).href);console.log(JSON.stringify({templates:m.twoWay7ReferenceTemplates(),rotations:m.properCubeRotations()}));"
    completed = subprocess.run([str(node), '--input-type=module', '-e', program, str(module)], cwd=repo,
        capture_output=True, text=True, timeout=30, check=True)
    if len(completed.stdout) > 1024**2:raise ValueError('Template export exceeds budget')
    data = json.loads(completed.stdout)
    if len(data.get('templates', [])) != 8 or len(data.get('rotations', [])) != 24:
        raise ValueError('Require the existing eight seven-Hex variants and proper cube rotations')
    for t in data['templates']:
        nodes, cells = np.asarray(t['nodes']), np.asarray(t['elements'])
        if nodes.shape != (23, 3) or cells.shape != (7, 8) or not np.isfinite(nodes).all():
            raise ValueError('Unexpected seven-Hex template shape')
        if cells.dtype.kind not in 'iu' or cells.min() < 0 or cells.max() >= 23:
            raise ValueError('Invalid template connectivity')
        if np.any(np.diff(np.sort(cells, axis=1), axis=1) <= 0):raise ValueError('Repeated template corner')
        if not np.array_equal(np.rint((nodes+1)*2), (nodes+1)*2) or np.max(abs(nodes)) > 1:
            raise ValueError('Template is not on the bounded quarter reference lattice')
        if not np.array_equal(np.rint(nodes[:,:2]+1),nodes[:,:2]+1):
            raise ValueError('In-plane template coordinates must use the half-grid required by exact tuple supports')
        owners = defaultdict(list)
        for ei, cell in enumerate(cells):
            for fi, slots in enumerate(FACES):owners[tuple(sorted(cell[slots]))].append((ei, fi, cell[slots]))
        if any(len(v) > 2 for v in owners.values()):raise ValueError('Nonmanifold template')
        boundary = [v[0] for v in owners.values() if len(v) == 1]
        t['boundary'] = [(int(e), int(f), q.tolist()) for e, f, q in boundary]
        t['coarse'] = [(e, f, q) for e, f, q in t['boundary'] if np.all(nodes[q, 2] == -1)]
        t['fine'] = [(e, f, q) for e, f, q in t['boundary'] if np.all(nodes[q, 2] == 1)]
        if len(t['coarse']) != 1 or len(t['fine']) != 4:raise ValueError('Wrong coarse/fine template face partition')
    data['provenance'] = dict(sourcePath=str(source), sourceSHA256=_sha(source), modulePath=str(module),
                              moduleSHA256=_sha(module), origin='existing repository runtime export; no external template table')
    return data


def read_parents(original_path, phase_path):
    """Only the reviewed original/phase pair; preserve all original row identities."""
    original_path, phase_path = Path(original_path).resolve(), Path(phase_path).resolve()
    if _sha(original_path) != ORIGINAL_SCREW_SHA256 or _sha(phase_path) != KNOWN_PHASE_SHA256:
        raise ValueError('Require the exact reviewed original and phase-compensated sources')
    raw, phase = read_keyword(original_path), read_keyword(phase_path)
    mask = np.isin(raw.element_ids, BODY_IDS)
    if len(raw.elements) != 6128 or mask.sum() != 2160:raise ValueError('Unexpected original body scope')
    for field in ('nodes', 'node_ids', 'element_ids', 'part_ids'):
        if not np.array_equal(getattr(raw, field), getattr(phase, field)):raise ValueError('Phase input changed original '+field)
    if not np.array_equal(raw.elements[~mask], phase.elements[~mask]):raise ValueError('Outside source changed')
    redirect = {}
    for a, b in zip(raw.node_ids[raw.elements[mask]].flat, phase.node_ids[phase.elements[mask]].flat):
        if int(a) in redirect and redirect[int(a)] != int(b):raise ValueError('Inconsistent phase node identity mapping')
        redirect[int(a)] = int(b)
    cavity = extract_cavity(raw, BODY_IDS); strip = trace_interface_strip(cavity)
    grid = np.array([[redirect.get(n, n) for n in row] for row in strip['rootWallNodeIDs']], dtype=np.int64)
    if grid.shape != (3, 1081) or not np.array_equal(grid[0, 36:], grid[2, :-36]):
        raise ValueError('Actual 36-column/+2-phase identities differ')
    owners = face_owners(phase)
    root_map = {_key(phase.node_ids[cell[FACES[3]]]): (int(eid), int(pid), phase.node_ids[cell[FACES[3]]].tolist())
                for eid, pid, cell in zip(phase.element_ids[mask], phase.part_ids[mask], phase.elements[mask])}
    raw_index = {int(e):i for i, e in enumerate(raw.element_ids)}
    parents = []
    for j in range(1080):
        for band in (0, 1):
            q = [int(grid[band, j]), int(grid[band, j+1]), int(grid[band+1, j+1]), int(grid[band+1, j])]
            eid, pid, actual = root_map[_key(q)]
            if _cycle(actual) != _cycle(q):raise ValueError('Root-wall orientation inconsistent with chart')
            outside = [o for o in owners[_key(actual)] if o['eid'] not in BODY_IDS]
            if len(outside) != (1 if band == 0 else 0):raise ValueError('Hard tooth/free valley classification differs')
            if outside and actual != raw.node_ids[raw.elements[raw_index[eid], FACES[3]]].tolist():
                raise ValueError('Phase compensation changed a hard outer-face node binding')
            parents.append(dict(eid=eid, pid=pid, localFace=4, nodeIDs=actual, macro=[q[0], q[3], q[2], q[1]],
                                band=band, column=j, retained=outside[0] if outside else None))
    if len({r['eid'] for r in parents}) != 2160:raise ValueError('Root chart omits or duplicates source cells')
    return raw, phase, parents


def quality_matrix(phase, parents, templates, ratio):
    if type(ratio) not in (int, float) or not math.isfinite(ratio) or not .3 <= ratio <= .9:
        raise ValueError('Bounded diagnostic radial ratio must be in [.3,.9]')
    lookup = {int(n):i for i,n in enumerate(phase.node_ids)}
    outer = phase.nodes[np.array([[lookup[n] for n in r['macro']] for r in parents])]
    inner = outer.copy(); inner[:, :, :2] *= ratio
    macro = np.concatenate((outer, inner), axis=1); scores = []; gauss = []
    for t in templates:
        ref = np.array(t['nodes']); weights = np.prod(1+ref[:, None, :]*SIGNS[None, :, :], axis=2)/8
        nodes = np.einsum('ni,pic->pnc', weights, macro)
        xyz = nodes[:, np.array(t['elements'])].reshape(-1, 8, 3); xyz = xyz-xyz[:, :1]
        sj = np.full(len(xyz), np.inf); g = np.full(len(xyz), np.inf)
        for values, scaled in (((-1., 1.), True), ((-1/math.sqrt(3), 1/math.sqrt(3)), False)):
            for u, v, w in product(values, repeat=3):
                d = np.column_stack((SIGNS[:, 0]*(1+SIGNS[:, 1]*v)*(1+SIGNS[:, 2]*w),
                    SIGNS[:, 1]*(1+SIGNS[:, 0]*u)*(1+SIGNS[:, 2]*w), SIGNS[:, 2]*(1+SIGNS[:, 0]*u)*(1+SIGNS[:, 1]*v)))/8
                jac = np.einsum('eni,nj->eij', xyz, d); det = np.linalg.det(jac)
                if scaled:
                    denominator = np.linalg.norm(jac, axis=1).prod(axis=1)
                    sj = np.minimum(sj, np.divide(det, denominator, out=np.full(len(det), -np.inf), where=denominator > 0))
                else:g = np.minimum(g, det)
        scores.append(sj.reshape(-1, 7).min(1)); gauss.append(g.reshape(-1, 7).min(1))
    return np.array(scores), np.array(gauss)


def _side_partition(template, side):
    nodes = (np.array(template['nodes'])+1)/2
    axis, value = ((1, 0.), (0, 1.), (1, 1.), (0, 0.))[side]
    result = []
    for _, _, q in template['boundary']:
        p = nodes[q]
        if np.all(p[:, axis] == value):
            t = (p[:, 0], p[:, 1], 1-p[:, 0], 1-p[:, 1])[side]
            result.append(tuple(sorted((int(round(4*a)), int(round(4*w))) for a, w in zip(t, p[:, 2]))))
    return tuple(sorted(result))


def _lateral_graph(parents, templates):
    edges = defaultdict(list)
    for pi, r in enumerate(parents):
        q = r['macro']
        for side in range(4):edges[tuple(sorted((q[side], q[(side+1)%4])))].append((pi, side, q[side], q[(side+1)%4]))
    if any(len(v) > 2 for v in edges.values()):raise ValueError('Nonmanifold actual root-wall edge')
    signatures = [[_side_partition(t, side) for side in range(4)] for t in templates]
    compatibility = {}
    for a in range(4):
        for b in range(4):
            compatibility[a, b] = [sum(1 << j for j in range(8) if signatures[i][a] ==
                tuple(sorted(tuple(sorted((4-t, w) for t, w in q)) for q in signatures[j][b]))) for i in range(8)]
    graph = [[] for _ in parents]; pairs = []; boundary = []
    for edge, owners in edges.items():
        if len(owners) == 1:boundary.append((edge, owners[0])); continue
        a, b = owners
        if a[2:] != b[2:][::-1]:raise ValueError('Actual root macro edges do not have opposite cycles')
        p, sa, _, _ = a; q, sb, _, _ = b
        graph[p].append((q, compatibility[sa, sb])); graph[q].append((p, compatibility[sb, sa]))
        pairs.append(dict(edge=list(edge), parents=[p, q], sides=[sa, sb]))
    return graph, pairs, boundary


def _validate_search_floor(minimum_sj):
    if type(minimum_sj) not in (int, float) or not math.isfinite(minimum_sj) or not 0 < minimum_sj <= 1:
        raise ValueError('Explicit positive project SJ floor required')


def solve_partitions(parents, templates, scores, gauss, minimum_sj=.15):
    """Finite AC-3/backtracking over actual lateral partitions, not coordinate welding."""
    _validate_search_floor(minimum_sj)
    graph, pairs, boundary = _lateral_graph(parents, templates)
    domains = [sum(1 << t for t in range(8) if scores[t, p] >= minimum_sj and gauss[t, p] > 0) for p in range(len(parents))]
    impossible = [parents[p]['eid'] for p, d in enumerate(domains) if not d]
    stats = dict(searchNodes=0, domainPrunes=0, localImpossibleParentEids=impossible, qualityConstrained=True)
    if impossible:return None, dict(stats, solved=False, reason='Local shape quality rejected before CSP'), pairs, boundary
    def propagate(state):
        queue = deque(range(len(state))); queued = set(queue)
        while queue:
            p = queue.popleft(); queued.discard(p)
            for q, compatibility in graph[p]:
                allowed = sum(1 << t for t in range(8) if state[p] & (1 << t) and compatibility[t] & state[q])
                if allowed != state[p]:
                    stats['domainPrunes'] += 1; state[p] = allowed
                    if not allowed:return False
                    for neighbour, _ in graph[p]:
                        if neighbour not in queued:queue.append(neighbour); queued.add(neighbour)
        return True
    def search(state):
        stats['searchNodes'] += 1
        if stats['searchNodes'] > MAX_SEARCH:raise ValueError('Bounded template CSP search exhausted')
        if not propagate(state):return None
        uncertain = [p for p,d in enumerate(state) if d.bit_count() > 1]
        if not uncertain:return [d.bit_length()-1 for d in state]
        p = min(uncertain, key=lambda q:(state[q].bit_count(), -len(graph[q]), q))
        for t in sorted((t for t in range(8) if state[p] & (1 << t)), key=lambda t:-scores[t, p]):
            child = state.copy(); child[p] = 1 << t; result = search(child)
            if result is not None:return result
        return None
    result = search(domains)
    return result, dict(stats, solved=result is not None, reason=None if result is not None else 'Global lateral partition/quality constraints conflict'), pairs, boundary


def _checkerboard_diagnostic(parents, templates, scores, gauss):
    """Best of eight globally reflected layouts, without relabelling the .15 screen."""
    candidates = []
    for seed in templates:
        choices = []
        for p in parents:
            ref = np.array(seed['nodes'], dtype=float)
            if p['band'] % 2:ref[:,0] *= -1
            if p['column'] % 2:ref[:,1] *= -1
            choices.append(next(i for i,t in enumerate(templates) if np.array_equal(ref, t['nodes'])))
        value = float(min(scores[t,p] for p,t in enumerate(choices)))
        if value > 0 and all(gauss[t,p] > 0 for p,t in enumerate(choices)):
            candidates.append((value, seed['name'], choices))
    if not candidates:raise ValueError('No positive checkerboard diagnostic layout')
    return max(candidates, key=lambda x:x[0])


def raw_quality_metrics(mesh):
    """Trilinear derivative metrics; no assertion of an uncalibrated vendor identity."""
    xyz = mesh.nodes[mesh.elements]; xyz = xyz-xyz[:,:1]
    scaled, determinants = [], []
    for u,v,w in [*product((-1.,1.),repeat=3),(0.,0.,0.)]:
        d=np.column_stack((SIGNS[:,0]*(1+SIGNS[:,1]*v)*(1+SIGNS[:,2]*w),
            SIGNS[:,1]*(1+SIGNS[:,0]*u)*(1+SIGNS[:,2]*w),SIGNS[:,2]*(1+SIGNS[:,0]*u)*(1+SIGNS[:,1]*v)))/8
        j=np.einsum('eni,nj->eij',xyz,d); det=np.linalg.det(j)
        denom=np.linalg.norm(j,axis=1).prod(axis=1)
        scaled.append(np.divide(det,denom,out=np.zeros(len(det)),where=denom>0)); determinants.append(det)
    scaled,determinants=np.array(scaled),np.array(determinants)
    ratios=np.divide(determinants.min(0),determinants.max(0),out=np.zeros(len(mesh.elements)),where=determinants.max(0)>0)
    worst=int(np.argmin(scaled.min(0)))
    return dict(trilinearCorner8MinimumScaledJacobian=float(scaled[:8].min()),
        trilinearCornerAndCentre9MinimumScaledJacobian=float(scaled.min()),
        trilinearCentreScaledJacobianMinimum=float(scaled[8].min()),
        determinant9Minimum=float(determinants.min()),determinant9Maximum=float(determinants.max()),
        minimumPerCellDeterminant9MinMaxRatio=float(ratios.min()),worstElementID=int(mesh.element_ids[worst]),
        nonpositiveDeterminant9ElementIDs=mesh.element_ids[np.any(determinants<=0,axis=0)].tolist(),
        vendorVerdictEquivalenceClaimed=False,qualityAcceptancePolicyApplied=False)


def _node_support(ref, outer):
    u, v, w = (np.array(ref)+1)/2
    weights = [(1-u)*(1-v), u*(1-v), u*v, (1-u)*v]
    return int(round(4*w)), tuple(sorted((int(n), int(round(4*a))) for n,a in zip(outer, weights) if a))


def _preserve_outer_binding(cell, desired, rotations):
    for matrix in rotations:
        m = np.asarray(matrix)
        permutation = [int(np.flatnonzero(np.all(SIGNS == m@s, axis=1))[0]) for s in SIGNS]
        candidate = np.asarray(cell)[permutation]
        if candidate[FACES[3]].tolist() == desired:return candidate.tolist()
    raise ValueError('No proper H8 rotation preserves original root localFace4 cycle')


def build_collar(original_path, phase_path, *, radial_ratio=.6, minimum_sj, node_executable=None):
    """Return a full-source PARTIAL composite, inner fine4 interface and audits.

    Selected source parent EIDs survive on their coarse child with localFace4
    unchanged. The other six children get fresh IDs. No core/cap is fabricated.
    """
    _validate_search_floor(minimum_sj)
    raw, phase, parents = read_parents(original_path, phase_path)
    export = load_repository_templates(node_executable); templates = export['templates']
    scores, gauss = quality_matrix(phase, parents, templates, radial_ratio)
    choices, csp, pairs, end_edges = solve_partitions(parents, templates, scores, gauss, minimum_sj)
    if choices is None and csp['localImpossibleParentEids']:
        return dict(mesh=None, report=dict(scope='mapped whole-body collar preflight', localBestMinSJ=float(scores.max(0).min()),
            csp=csp, radialRatio=radial_ratio, minimumSJProjectFloor=minimum_sj, axisRepaired=False, wholeScrewAccepted=False),
            localScores=scores, localGauss=gauss, parents=parents)
    if choices is None:
        value, seed, choices = _checkerboard_diagnostic(parents, templates, scores, gauss)
        csp.update(diagnosticFallback='positive checkerboard only; legacy project screen remains failed',
                   fallbackSeed=seed,fallbackMinimumSJ=value)
    nodes = phase.nodes.tolist(); ids = phase.node_ids.tolist(); lookup = {int(n):i for i,n in enumerate(ids)}
    coordinates = {int(n):p for n,p in zip(phase.node_ids, phase.nodes)}
    next_nid = int(phase.node_ids.max())+1; node_cache = {}; support_records = []
    inner_corners = {}
    # These are the ORIGINAL nodes of the downstream coarse inner-Q4 complex.
    # Midpoints/centres below use their sorted NID tuples and the exact same
    # equal-weight mean convention as the separate core bridge, not a weld.
    for outer_id in sorted({n for r in parents for n in r['macro']}):
        p=coordinates[outer_id].copy();p[:2]*=radial_ratio;nid=next_nid;next_nid+=1
        inner_corners[outer_id]=nid;node_cache[(4,((outer_id,4),))]=nid
        lookup[nid]=len(nodes);nodes.append(p.tolist());ids.append(nid)
        support_records.append(dict(nodeID=nid,radialQuarter=4,outerWeightsNumerator4=[[outer_id,4]],
            bridgeSupportOriginalNodeIDs=[nid],bridgeRole='inner-coarse-original-node'))
    def node(ref, outer):
        nonlocal next_nid
        key = _node_support(ref, outer); w4, support = key
        if w4 == 0:
            if len(support) != 1 or support[0][1] != 4:raise ValueError('Coarse outside face was subdivided')
            return support[0][0]
        if key not in node_cache:
            if len({weight for n,weight in support})!=1:raise ValueError('Unsupported nonequal Q4 support weights')
            bridge_support=sorted(inner_corners[n] for n,weight in support)
            outer_mean=np.mean([coordinates[n] for n,weight in support],axis=0)
            inner_mean=np.mean([nodes[lookup[n]] for n in bridge_support],axis=0)
            p=inner_mean if w4==4 else (1-w4/4)*outer_mean+(w4/4)*inner_mean
            if not np.isfinite(p).all():raise ValueError('Nonfinite mapped point')
            nid = next_nid; next_nid += 1; node_cache[key] = nid; lookup[nid] = len(nodes); nodes.append(p.tolist()); ids.append(nid)
            support_records.append(dict(nodeID=nid, radialQuarter=w4, outerWeightsNumerator4=[list(x) for x in support],
                bridgeSupportOriginalNodeIDs=bridge_support if w4==4 else None,
                bridgeRole=('inner-edge-midpoint' if len(support)==2 else 'inner-quad-centre') if w4==4 else 'collar-radial-interior'))
        return node_cache[key]
    cells = phase.node_ids[phase.elements].tolist(); eids = phase.element_ids.tolist(); pids = phase.part_ids.tolist()
    source_index = {int(e):i for i,e in enumerate(eids)}; next_eid = max(eids)+1
    parent_rows = []; collar_eids = []; inner = []; lateral = []
    for pi, (r, ti) in enumerate(zip(parents, choices)):
        t = templates[ti]; local_ids = [node(ref, r['macro']) for ref in t['nodes']]
        coarse_child = t['coarse'][0][0]; child_eids = []
        for ci, conn in enumerate(t['elements']):
            mapped = [local_ids[n] for n in conn]
            if ci == coarse_child:
                eid = r['eid']; mapped = _preserve_outer_binding(mapped, r['nodeIDs'], export['rotations'])
                cells[source_index[eid]] = mapped
            else:
                eid = next_eid; next_eid += 1; cells.append(mapped); eids.append(eid); pids.append(r['pid'])
            child_eids.append(eid); collar_eids.append(eid)
        fine_ids = [node((2*u-1, 2*v-1, 1.), r['macro']) for v in (0., .5, 1.) for u in (0., .5, 1.)]
        parent_inner = []
        for ci, fi, conn in t['fine']:
            q = [local_ids[n] for n in conn]; parent_inner.append(q)
            inner.append(dict(parentEid=r['eid'], nodeIDs=q, cavityOutwardNodeIDs=[q[0],q[3],q[2],q[1]],
                              eid=child_eids[ci], localFace=fi+1))
        for ci, fi, conn in t['boundary']:
            if (ci,fi,conn) not in t['coarse'] and (ci,fi,conn) not in t['fine']:
                lateral.append(dict(parentIndex=pi, eid=child_eids[ci], nodeIDs=[local_ids[n] for n in conn]))
        base=[fine_ids[i] for i in (0,2,8,6)]
        support9=[(base[0],),(base[0],base[1]),(base[1],),(base[0],base[3]),tuple(base),
                  (base[1],base[2]),(base[3],),(base[3],base[2]),(base[2],)]
        support9=[sorted(key) for key in support9]
        for nid,key in zip(fine_ids,support9):
            if not np.array_equal(nodes[lookup[nid]],np.mean([nodes[lookup[n]] for n in key],axis=0)):
                raise ValueError('Fine9 is not the exact sorted-NID mean of the coarse inner base')
        parent_rows.append(dict(r, template=t['name'], childEids=child_eids,
            innerCoarseCorners=base,innerCoarseCornersCollarOutward=base,
            innerCoarseCornersCavityOutward=[base[0],base[3],base[2],base[1]],fine9NodeIDs=fine_ids,
            fine9SupportOriginalNodeIDs=support9,
            fine9CavityUVGridNodeIDs=[fine_ids[i] for i in (0,3,6,1,4,7,2,5,8)],
            fine9GridOrder='v-major, u-minor in macro phase/angle chart; u,v=0,.5,1',
            fine4CollarOutwardQuads=parent_inner,
            fine4CavityOutwardQuads=[[q[0],q[3],q[2],q[1]] for q in parent_inner]))
    mesh = ImportedSolids(np.array(nodes), np.array([[lookup[n] for n in c] for c in cells]), np.array(ids,dtype=np.int64),
        np.array(eids,dtype=np.int64), np.array(pids,dtype=np.int64), {'*ELEMENT_SOLID':len(cells)}, '')
    original_count = len(raw.elements); outside = ~np.isin(raw.element_ids, BODY_IDS)
    if not np.array_equal(mesh.nodes[:len(raw.nodes)], raw.nodes) or not np.array_equal(mesh.node_ids[:len(raw.node_ids)], raw.node_ids):
        raise ValueError('Original coordinate/node-ID rows changed')
    for field in ('elements','element_ids','part_ids'):
        if not np.array_equal(getattr(mesh,field)[:original_count][outside],getattr(raw,field)[outside]):raise ValueError('Outside source row changed')
    all_owners = face_owners(mesh); collar_set = set(collar_eids)
    hard_audit = []
    for r in parents:
        pair = all_owners[_key(r['nodeIDs'])]; own = [p for p in pair if p['eid'] in collar_set]
        if len(own) != 1 or own[0] != dict(eid=r['eid'],pid=r['pid'],localFace=4,nodeIDs=r['nodeIDs']):
            raise ValueError('Original hard/coarse selected face binding changed')
        if r['retained'] is not None:
            if len(pair)!=2 or r['retained'] not in pair or _cycle(pair[0]['nodeIDs']) != _cycle(pair[1]['nodeIDs'][::-1]):
                raise ValueError('Hard tooth face is not exact opposite two-owner attachment')
            hard_audit.append(dict(parentEid=r['eid'], actualOwners=pair))
        elif len(pair)!=1:raise ValueError('Free valley face unexpectedly has another owner')
    for r in inner:
        pair = all_owners[_key(r['nodeIDs'])]
        if len(pair)!=1 or pair[0]['eid']!=r['eid'] or _cycle(pair[0]['nodeIDs'])!=_cycle(r['nodeIDs']):
            raise ValueError('Fine inner quad is not an actual one-owner boundary face')
    lateral_owners = defaultdict(list)
    for row in lateral:lateral_owners[_key(row['nodeIDs'])].append(row)
    open_lateral=[];joined=0
    for key, group in lateral_owners.items():
        if len(group)==2:
            if _cycle(group[0]['nodeIDs'])!=_cycle(group[1]['nodeIDs'][::-1]):raise ValueError('Lateral partition orientation mismatch')
            joined+=1
        elif len(group)==1:open_lateral.append(group[0])
        else:raise ValueError('Nonmanifold lateral partition')
    # Every expected shared macro side must match all actual child faces.
    lateral_by_parent=defaultdict(list)
    for row in lateral:lateral_by_parent[row['parentIndex']].append(row)
    for pair in pairs:
        a,b=pair['parents'];edge=set(pair['edge'])
        def side_faces(parent):
            found=[]
            for row in lateral_by_parent[parent]:
                supports=[]
                for nid in row['nodeIDs']:
                    if nid in coordinates:supports.append({nid})
                    else:
                        record=support_records[lookup[nid]-len(phase.nodes)]
                        supports.append({n for n,w in record['outerWeightsNumerator4']})
                if all(s<=edge for s in supports):found.append(_key(row['nodeIDs']))
            return set(found)
        if not side_faces(a) or side_faces(a)!=side_faces(b):raise ValueError('Actual shared parent-side partitions differ')
    selected_mask=np.isin(mesh.element_ids,collar_eids)
    collar=replace(mesh,elements=mesh.elements[selected_mask],element_ids=mesh.element_ids[selected_mask],
        part_ids=mesh.part_ids[selected_mask],element_cards={'*ELEMENT_SOLID':len(collar_eids)})
    quality=audit_import(collar);composite_quality=audit_import(mesh);raw_metrics=raw_quality_metrics(collar)
    metrics=measure_h8(collar.nodes,collar.elements)
    metric_report=summarize_h8(metrics,collar.element_ids)
    if quality['badGaussElementIDs'] or quality['nonpositiveVolumeElementIDs'] or quality['coincidentPositionElementIDs'] or raw_metrics['nonpositiveDeterminant9ElementIDs']:
        raise ValueError('Mapped collar has nonpositive/collapsed new H8')
    topology=skin_topology([q['cavityOutwardNodeIDs'] for q in inner])
    root_topology=skin_topology([r['nodeIDs'] for r in parents])
    if len(root_topology['boundaryLoops'])!=2 or len(topology['boundaryLoops'])!=2 or not topology['idManifold']:
        raise ValueError('Expected two actual nonplanar end loops of the inner tube')
    root_loops=sorted(root_topology['boundaryLoops'],key=lambda loop:float(np.mean([coordinates[n][2] for n in loop])))
    edge_end={tuple(sorted((a,b))):label for label,loop in zip(('lower','upper'),root_loops) for a,b in zip(loop,loop[1:]+loop[:1])}
    end_records=[]
    for row in open_lateral:
        support=set()
        for nid in row['nodeIDs']:
            if nid in coordinates:support.add(nid)
            else:support.update(n for n,w in support_records[lookup[nid]-len(phase.nodes)]['outerWeightsNumerator4'])
        key=tuple(sorted(support))
        if key not in edge_end:raise ValueError('Unmatched lateral face is not a genuine endpoint collar face')
        pair=all_owners[_key(row['nodeIDs'])]
        if len(pair)!=1:raise ValueError('Endpoint collar face has unexpected ownership')
        row.update(end=edge_end[key],rootBoundaryEdgeNodeIDs=list(key),actualBinding=pair[0])
    for label,loop in zip(('lower','upper'),root_loops):
        inner_set={inner_corners[n] for n in loop}
        matching=[q for q in topology['boundaryLoops'] if inner_set<=set(q)]
        if len(matching)!=1:raise ValueError('Inner fine end loop does not contain the exact coarse base corners')
        end_records.append(dict(end=label,outerRootLoopNodeIDs=loop,innerCoarseLoopNodeIDs=[inner_corners[n] for n in loop],
            innerFineLoopNodeIDs=matching[0],loopOrderIsUndirected=True,
            zRange=[float(min(nodes[lookup[n]][2] for n in matching[0])),float(max(nodes[lookup[n]][2] for n in matching[0]))],
            planarCapAssumed=False,sourceEndInterfaceSolved=False))
    phase_cavity=extract_cavity(phase,BODY_IDS)
    old_end_faces=[r for r in phase_cavity['boundary'] if r['selected']['localFace']!=4 and r['geometry']['q4Area']>1e-14]
    report=dict(scope='whole2160-parent mapped collar plus unchanged outside; finite core and endpoint matching still open',
        rawSHA256=raw.source_sha256,phaseSHA256=phase.source_sha256,templateProvenance=export['provenance'],
        radialRatio=radial_ratio,legacyCorner8ProjectScreen=minimum_sj,minimumSJIsVendorUniversal=False,
        parentCount=2160,hardToothParents=len(hard_audit),freeValleyParents=2160-len(hard_audit),
        collarH8=len(collar.elements),compositeH8=len(mesh.elements),outsideSourceCells=3968,
        originalCoordinateRowsExactlyPreserved=True,outsideRowsExactlyPreserved=True,hardRootBindingsExact=True,
        sourceParentEidAndLocalFace4Preserved=True,globalCoordinateWeldUsed=False,
        csp=csp,localBestWorstSJ=float(scores.max(0).min()),chosenTemplateWorstSJ=float(min(scores[t,p] for p,t in enumerate(choices))),
        rawQualityMetrics=raw_metrics,legacyProjectQualityAudit=quality,compositeLegacyQualityAudit=composite_quality,
        qualityMetricReport=metric_report,
        engineeringQualityAcceptanceDetermined=False,innerQuads=len(inner),innerTopology=topology,
        matchedLateralChildFacePairs=joined,unresolvedEndpointCollarFaces=open_lateral,
        endBoundaryLoops=end_records,phaseSourcePhysicalEndObligations=old_end_faces,
        downstreamFine9UsesExactSortedInnerCornerNidTupleMeans=True,
        parentRecords=parent_rows,hardFaceAudit=hard_audit,
        collarMeetsLegacyCorner8Screen=quality['minimumCornerScaledJacobian']>=minimum_sj,
        topologyInterfaceVerified=True,topBottomSolved=False,innerCoreFilled=False,axisRepaired=False,
        wholeScrewAccepted=False,globalOverlapCertified=False,sourceDomainVolumePreserved=False,
        volumeSemantics='Collar per-cell Gauss sum only; the intentionally unfilled cavity is not a volume-conservative replacement')
    if _sha(original_path)!=raw.source_sha256 or _sha(phase_path)!=phase.source_sha256:raise ValueError('Readonly source changed')
    return dict(mesh=mesh,collar=collar,report=report,inner=inner,nodeSupports=support_records,parents=parents,
                metricArrays=metrics,
                localScores=scores,localGauss=gauss)


def generate(original_path,phase_path,output,*,radial_ratio=.6,minimum_sj,node_executable=None):
    output=Path(output).resolve()
    if output.exists() or not output.parent.is_dir():raise ValueError('Require a fresh output under an existing caller-selected directory')
    result=build_collar(original_path,phase_path,radial_ratio=radial_ratio,minimum_sj=minimum_sj,node_executable=node_executable)
    output.mkdir()
    report=result['report']
    if result['mesh'] is not None:
        mesh=result['mesh'];inner=result['inner'];ids=sorted({n for r in inner for n in r['nodeIDs']})
        lookup={int(n):i for i,n in enumerate(mesh.node_ids)};compact={n:i for i,n in enumerate(ids)}
        np.savez_compressed(output/'composite.npz',nodes=mesh.nodes,elements=mesh.elements,node_ids=mesh.node_ids,
            element_ids=mesh.element_ids,part_ids=mesh.part_ids)
        np.savez_compressed(output/'inner-boundary.npz',nodes=mesh.nodes[[lookup[n] for n in ids]],node_ids=np.array(ids),
            quads=np.array([[compact[n] for n in r['cavityOutwardNodeIDs']] for r in inner]),
            quad_node_ids=np.array([r['cavityOutwardNodeIDs'] for r in inner]),
            owner_eids=np.array([r['eid'] for r in inner]),parent_eids=np.array([r['parentEid'] for r in inner]),
            parent_coarse_corners=np.array([r['innerCoarseCorners'] for r in report['parentRecords']]),
            parent_fine9_node_ids=np.array([r['fine9NodeIDs'] for r in report['parentRecords']]),
            parent_coarse_cavity_outward=np.array([r['innerCoarseCornersCavityOutward'] for r in report['parentRecords']]),
            parent_eids_order=np.array([r['eid'] for r in report['parentRecords']]),
            parent_chart=np.array([[r['band'],r['column']] for r in report['parentRecords']]))
        _write_mesh_pair(mesh,output,'collar-composite','PARTIAL MAPPED COLLAR; CORE AND ENDS UNFILLED; NOT AN ACCEPTED WHOLE SCREW')
        (output/'node-supports.json').write_text(json.dumps(result['nodeSupports'],indent=2))
        child_parent={e:r for r in report['parentRecords'] for e in r['childEids']}
        collar=result['collar'];parent_rows=[child_parent[int(e)] for e in collar.element_ids]
        np.savez_compressed(output/'quality-cells.npz',**result['metricArrays'],element_ids=collar.element_ids,
            parent_eids=np.array([r['eid'] for r in parent_rows]),
            parent_chart=np.array([[r['band'],r['column']] for r in parent_rows]),
            centroids=np.mean(collar.nodes[collar.elements],axis=1))
        (output/'collar-quality.json').write_text(json.dumps(report['qualityMetricReport'],indent=2,allow_nan=False))
        (output/'inner-parent-bases.json').write_text(json.dumps(dict(scope='Exact inner coarse-Q4/fine4 attachment, not a filled core',
            parentRecords=report['parentRecords'],globalCoordinateWeldUsed=False,coreFilled=False),indent=2,allow_nan=False))
        (output/'caps.json').write_text(json.dumps(dict(endBoundaryLoops=report['endBoundaryLoops'],
            phaseSourcePhysicalEndObligations=report['phaseSourcePhysicalEndObligations'],
            collarAnnularFaces=report['unresolvedEndpointCollarFaces'],planarCapsAssumed=False,
            sourceEndInterfacesSolved=False),indent=2,allow_nan=False))
    np.savez_compressed(output/'local-quality.npz',scores=result['localScores'],minimumGauss=result['localGauss'],
        parentEids=np.array([r['eid'] for r in result['parents']]))
    raw=json.dumps(report,indent=2,allow_nan=False)
    if len(raw.encode())>MAX_OUTPUT_BYTES:raise ValueError('Report exceeds bounded file budget')
    (output/'report.json').write_text(raw)
    if any(p.stat().st_size>MAX_OUTPUT_BYTES for p in output.iterdir() if p.is_file()):raise ValueError('Output exceeds64MiB')
    return report
