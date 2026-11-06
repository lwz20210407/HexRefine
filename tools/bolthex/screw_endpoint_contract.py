"""Bounded, fail-closed endpoint contracts for the actual frozen Screw collar.

This extracts real patch bindings and tests necessary source-surface and fixed
interface conditions. It neither repairs a volume nor authorizes scope growth.
"""
import argparse
from collections import Counter, defaultdict
from fractions import Fraction
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

import numpy as np

from . import screw_inward_collar as collar
from .h8_quality_report import measure_h8
from .mesh_audit import FACES, SIGNS
from .screw_interface import extract_cavity, face_owners
from .truegrid_screw import ImportedSolids

MAX_REPORT_BYTES = 2 * 1024**2
MAX_NPZ_EXPANDED_BYTES = 32 * 1024**2
MAX_PATCH_PARENTS = 256
ENDPOINT_PARENTS = frozenset((*range(2889, 2925), 3969, 3968, *range(5013, 5049)))
EXPANSION_112 = (2925, *range(3933, 3968), 3970, 5012)


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _cycle(values):
    values = tuple(values)
    return min(values[i:] + values[:i] for i in range(len(values)))


def _key(values):
    return tuple(sorted(values))


def _edges(face):
    return [tuple(sorted((a, b))) for a, b in zip(face, face[1:] + face[:1])]


def q4_parameter_identity(uv):
    """Exact rational polynomial test, not a sampled closest-point tolerance.

For a nonsingular bilinear source a+b*u+c*v+d*u*v, a child Q4 formed by
interpolating four source points stays on the support iff U*V=W identically.
U,V,W are the child bilinear interpolants of u,v,u*v, respectively.
"""
    data = np.asarray(uv)
    _require(data.shape == (4, 2) and data.dtype.kind in 'fiu', 'Require numeric 4x2 UV')
    _require(np.isfinite(data).all() and np.all((data >= 0) & (data <= 1)), 'UV outside [0,1]')
    points = [[Fraction(float(x)) for x in row] for row in data]

    def coefficients(values):
        a, b, c, d = values
        return {(0, 0): a, (1, 0): b-a, (0, 1): d-a, (1, 1): a-b+c-d}

    u = coefficients([p[0] for p in points])
    v = coefficients([p[1] for p in points])
    w = coefficients([p[0]*p[1] for p in points])
    residual = defaultdict(Fraction)
    for (i, j), a in u.items():
        for (k, l), b in v.items():
            residual[i+k, j+l] += a*b
    for power, value in w.items():
        residual[power] -= value
    nonzero = [dict(power=list(power), numerator=value.numerator, denominator=value.denominator)
               for power, value in sorted(residual.items()) if value]
    return dict(exactIdentity=not nonzero, nonzeroCoefficients=nonzero)


def _nonplanar_exact(quad):
    q = [[Fraction(float(x)) for x in row] for row in quad]
    b = [q[1][i]-q[0][i] for i in range(3)]
    c = [q[3][i]-q[0][i] for i in range(3)]
    d = [q[0][i]-q[1][i]+q[2][i]-q[3][i] for i in range(3)]
    determinant = sum(b[i]*(c[(i+1)%3]*d[(i+2)%3]-c[(i+2)%3]*d[(i+1)%3]) for i in range(3))
    return determinant != 0, str(determinant)


def quad_patch_topology(faces):
    """Do not infer a 2x2 grid from four faces and nine vertices alone."""
    edges = Counter(e for face in faces for e in _edges(face))
    incidence = Counter(n for face in faces for n in face)
    histogram = dict(Counter(incidence.values()))
    regular = (len(faces) == 4 and len(incidence) == 9 and len(edges) == 12
               and dict(Counter(edges.values())) == {1: 8, 2: 4}
               and histogram == {1: 4, 2: 4, 4: 1})
    return dict(faces=len(faces), vertices=len(incidence), edges=len(edges),
                vertexFaceIncidence=histogram, regularTwoByTwo=regular)


def assembly_counts(include_neck):
    _require(type(include_neck) is bool, 'include_neck must be bool')
    return dict(originalSource=6128, sourceBody=2160, selectedSourceDomain=2232 if include_neck else 2160,
                frozenOutsideRows=3968, futureRetainedOutside=3896 if include_neck else 3968,
                neckEIDsToReplaceInFuture=list(range(2817, 2889)) if include_neck else [],
                neckIncludedInFutureReplacement=include_neck, neckMeshedByThisAPI=False,
                endpointParents=74, endpointCollarChildren=518)


def validate_expanded_parents(expanded_collar_parent_ids):
    _require(isinstance(expanded_collar_parent_ids, (list, tuple, set, frozenset)),
             'Expanded collar parents must be an explicit integer collection')
    values = list(expanded_collar_parent_ids)
    _require(all(type(n) is int for n in values), 'Expanded collar parent IDs must be integers, not booleans')
    _require(len(values) == len(set(values)), 'Duplicate expanded collar parents')
    _require(not set(values) & ENDPOINT_PARENTS, 'Expansion must not repeat the original endpoint parents')
    _require(set(values) <= set(collar.BODY_IDS), 'Expansion outside BODY_IDS or into retained source cells is forbidden')
    _require(len(values)+74 <= MAX_PATCH_PARENTS, 'Explicit patch parent budget exceeded')
    return tuple(sorted(values))


def next_collar_scope_obligation(result, *, max_parents=MAX_PATCH_PARENTS):
    """Propose only an evidenced adjacent collar extension; never run or relax a CSP."""
    _require(type(max_parents) is int and 74 <= max_parents <= MAX_PATCH_PARENTS, 'Invalid closure parent limit')
    selected = set(result['summary']['selectedCollarParentIDs'])
    _require(ENDPOINT_PARENTS <= selected <= set(collar.BODY_IDS) and len(selected) <= max_parents,
             'Current closure scope escapes BODY_IDS or budget')
    check = result['protectedBoundaryCheck']
    if check['allProtectedPartitionsMatched']:
        return dict(status='protected-partitions-matched', additionalParentIDs=[])
    if check['status'] == 'search-budget-exhausted':
        return dict(status='search-limited', additionalParentIDs=[])
    alternatives = []
    for witness in check['blockingInterfaces']:
        for option in witness['localExpansionAlternatives']:
            alternatives.append(dict(additionalParentIDs=option['requiredAdditionalCollarParentIDs'],
                interface=witness['interface'], replanParentEID=option['replanParentEID'],
                template=option['template'], protectedCuts=option['blockingProtectedCuts']))
    if not alternatives:
        fixed = {(r['binding']['eid'], r['binding']['localFace']): r for r in result['fixedInterfaces']}
        for row in result['parents']:
            if row['eligibleTemplates']:
                continue
            for candidate in row['candidates']:
                if not (candidate['sourceSupportPreservedByConstruction'] and candidate['sampledPositiveJacobians']
                        and candidate['corePortSupportIdentity']):
                    continue
                cuts = [fixed[tuple(ref)] for ref in candidate['missingProtectedBindingRefs']]
                if not cuts or any(r['role'] != 'unchanged-collar' for r in cuts):
                    continue
                neighbours = sorted({p for r in cuts for p in r['oppositeCollarParentIDs']})
                alternatives.append(dict(additionalParentIDs=neighbours, interface=None,
                    replanParentEID=row['parentEID'], template=candidate['template'], protectedCuts=cuts))
    if not alternatives:
        return dict(status='no-evidenced-local-extension', additionalParentIDs=[],
                    candidateLibraryLimitation=True, generalHexImpossibilityProven=False)
    for option in alternatives:
        added = set(option['additionalParentIDs'])
        _require(added and not added & selected and added <= set(collar.BODY_IDS),
                 'Closure obligation includes retained, already selected or unknown parents')
    alternatives.sort(key=lambda r: (len(r['additionalParentIDs']), len(r['protectedCuts']),
                                     r['additionalParentIDs'], r['replanParentEID'], r['template']))
    chosen = alternatives[0]
    proposal = sorted(selected | set(chosen['additionalParentIDs']))
    return dict(status='expand' if len(proposal) <= max_parents else 'parent-budget',
                currentParentCount=len(selected), proposedParentCount=len(proposal), maxParents=max_parents,
                nextSelectedParentIDs=proposal, **chosen,
                retainedOriginalRegionExpanded=False, nextScopeSolved=False,
                globallyNearestSolvableScopeProven=False)


def _load(original_path, phase_path, folder):
    raw, phase, live_parents = collar.read_parents(original_path, phase_path)
    folder = Path(folder).resolve()
    names = ('handoff.json', 'report.json', 'composite.npz', 'node-supports.json')
    hashes = {str(folder/name): collar._sha(folder/name) for name in names}
    handoff = json.loads((folder/'handoff.json').read_bytes())
    for name in names[1:]:
        _require(hashes[str(folder/name)] == handoff['artifacts'][name]['sha256'], 'Frozen artifact hash mismatch: '+name)
    report = json.loads((folder/'report.json').read_bytes())
    _require(report['rawSHA256'] == raw.source_sha256 and report['phaseSHA256'] == phase.source_sha256,
             'Frozen source provenance differs')
    _require(report['radialRatio'] == .6, 'This contract requires the frozen ratio .6 collar')
    with zipfile.ZipFile(folder/'composite.npz') as archive:
        _require(sum(x.file_size for x in archive.infolist()) <= MAX_NPZ_EXPANDED_BYTES, 'NPZ expanded byte budget exceeded')
    with np.load(folder/'composite.npz', allow_pickle=False) as archive:
        a = {k: archive[k] for k in ('nodes', 'elements', 'node_ids', 'element_ids', 'part_ids')}
    _require(a['nodes'].ndim == 2 and a['nodes'].shape[1] == 3 and len(a['nodes']) <= 50000
             and np.isfinite(a['nodes']).all(), 'Invalid frozen nodes')
    _require(a['elements'].shape == (19088, 8) and a['elements'].dtype.kind in 'iu'
             and a['elements'].min() >= 0 and a['elements'].max() < len(a['nodes']), 'Invalid frozen connectivity')
    for field, count in (('node_ids', len(a['nodes'])), ('element_ids', 19088), ('part_ids', 19088)):
        _require(a[field].shape == (count,) and a[field].dtype.kind in 'iu' and a[field].min() > 0, 'Invalid '+field)
    _require(len(np.unique(a['node_ids'])) == len(a['nodes']) and len(np.unique(a['element_ids'])) == 19088,
             'Duplicate frozen identities')
    mesh = ImportedSolids(a['nodes'], a['elements'], a['node_ids'], a['element_ids'], a['part_ids'], {}, '')
    for field in ('nodes', 'node_ids'):
        _require(np.array_equal(getattr(mesh, field)[:len(getattr(raw, field))], getattr(raw, field)), 'Original rows changed: '+field)
    outside = ~np.isin(raw.element_ids, collar.BODY_IDS)
    for field in ('elements', 'element_ids', 'part_ids'):
        _require(np.array_equal(getattr(mesh, field)[:6128][outside], getattr(raw, field)[outside]), 'Outside source changed: '+field)
    parents = report['parentRecords']
    _require(len(parents) == 2160 and len({r['eid'] for r in parents}) == 2160, 'Incomplete parent ledger')
    expected = {r['eid']: r for r in live_parents}
    for r in parents:
        _require(r['eid'] in expected and all(r[k] == expected[r['eid']][k]
                 for k in ('pid', 'macro', 'nodeIDs', 'localFace', 'band', 'column', 'retained')), 'Parent source binding mismatch')
        _require(len(r['childEids']) == 7, 'Parent must own seven collar children')
    child_parent = {e: r['eid'] for r in parents for e in r['childEids']}
    _require(len(child_parent) == 15120 and set(child_parent) <= set(map(int, mesh.element_ids)), 'Invalid collar child ownership')
    supports = json.loads((folder/'node-supports.json').read_bytes())
    coordinates = {int(n): p for n, p in zip(mesh.node_ids, mesh.nodes)}
    source_coords = {int(n): p for n, p in zip(phase.node_ids, phase.nodes)}
    nid_support = {n: (0, ((n, 4),)) for n in source_coords}
    for record in supports:
        n = record['nodeID']
        key = (record['radialQuarter'], tuple(tuple(x) for x in record['outerWeightsNumerator4']))
        _require(n in coordinates and n not in nid_support, 'Invalid support identity')
        _require(sum(w for _, w in key[1]) == 4 and key[0] in (1, 2, 3, 4), 'Invalid support weights')
        nid_support[n] = key
    _require(set(nid_support) == set(coordinates) and len(set(nid_support.values())) == len(nid_support),
             'Incomplete or duplicate support entities')
    support_nid = {key: n for n, key in nid_support.items()}
    for record in supports:
        n = record['nodeID']
        w4, support = nid_support[n]
        _require(len({w for _, w in support}) == 1, 'Unexpected unequal collar support weights')
        if w4 == 4 and len(support) == 1:
            expected_point = source_coords[support[0][0]].copy()
            expected_point[:2] *= .6
        else:
            inner_ids = sorted(support_nid[(4, ((v, 4),))] for v, _ in support)
            inner_mean = np.mean([coordinates[v] for v in inner_ids], axis=0)
            outer_mean = np.mean([source_coords[v] for v, _ in support], axis=0)
            expected_point = inner_mean if w4 == 4 else (1-w4/4)*outer_mean+(w4/4)*inner_mean
        _require(np.array_equal(coordinates[n], expected_point), 'Frozen support coordinates differ')
    for parent in parents:
        _validate_parent_support_binding(parent, nid_support)
    hashes.update({str(Path(original_path).resolve()): raw.source_sha256, str(Path(phase_path).resolve()): phase.source_sha256})
    return mesh, phase, parents, child_parent, nid_support, hashes


def _validate_parent_support_binding(parent, nid_support):
    outer, inner = parent['macro'], parent['innerCoarseCorners']
    _require(len(outer) == len(inner) == 4 and len(set(outer)) == len(set(inner)) == 4,
             'Invalid collar macro corners')
    _require(all(nid_support.get(n) == (0, ((n, 4),)) for n in outer),
             'Outer macro corner is not an original source support')
    _require(all(nid_support.get(n) == (4, ((v, 4),)) for v, n in zip(outer, inner)),
             'Inner corner does not match its ordered outer source support')


def load_sweep_templates(node_executable=None):
    """Export oriented production-library entries; never copy connectivity tables."""
    repo = Path(__file__).resolve().parents[2]
    source, module = repo/'src/two-to-one-sweep-templates.ts', repo/'dist/two-to-one-sweep-templates.js'
    provenance = dict(sourcePath=str(source), sourceSHA256=collar._sha(source),
                      modulePath=str(module), moduleSHA256=collar._sha(module))
    node = node_executable or shutil.which('node')
    _require(node is not None, 'Existing Node runtime required')
    program = "import {pathToFileURL} from 'node:url';const m=await import(pathToFileURL(process.argv[1]).href);console.log(JSON.stringify([...m.regularSweepTemplateLibrary()].map(([signature,t])=>({...t,signature}))));"
    run = subprocess.run([str(node), '--input-type=module', '-e', program, str(module)],
                         cwd=repo, capture_output=True, text=True, timeout=30, check=True)
    _require(len(run.stdout) < 1024**2, 'Sweep export exceeds budget')
    templates = json.loads(run.stdout)
    _require(Counter(t['name'] for t in templates) == {'pattern1': 8, 'pattern2': 12, 'pattern4': 6, 'uniform8': 1},
             'Unexpected oriented regular sweep library')
    _require(len({t['signature'] for t in templates}) == 27, 'Duplicate sweep orientation')
    for t in templates:
        refs, cells = np.asarray(t['nodes']), np.asarray(t['elements'])
        _require(refs.ndim == 2 and refs.shape[1] == 3 and 8 <= len(refs) <= 27
                 and np.isfinite(refs).all() and np.isin(refs, [-1, 0, 1]).all(), 'Invalid sweep reference lattice')
        expected = {'pattern1': 4, 'pattern2': 3, 'pattern4': 2, 'uniform8': 8}[t['name']]
        _require(cells.shape == (expected, 8) and cells.dtype.kind in 'iu' and cells.min() >= 0
                 and cells.max() < len(refs) and np.all(np.diff(np.sort(cells, axis=1), axis=1) > 0),
                 'Invalid sweep connectivity')
        metrics = measure_h8(refs, cells)
        _require(metrics['sampledPositiveJacobians'].all(), 'Sweep reference has invalid Jacobians')
        _require(abs(metrics['integratedVolume'].sum()-8) < 1e-12, 'Sweep reference does not fill the cube')
        t['family'] = t['name']
        if t['name'] != 'uniform8':
            t['name'] += '@' + t['signature']
    _require(collar._sha(source) == provenance['sourceSHA256'] and collar._sha(module) == provenance['moduleSHA256'],
             'Sweep library changed during export')
    return dict(templates=templates, provenance=provenance)


def _template_faces(template):
    owners = defaultdict(list)
    for cell in template['elements']:
        for face in np.asarray(cell)[FACES]:
            owners[_key(face)].append(face.tolist())
    return [rows[0] for rows in owners.values() if len(rows) == 1]


def _uv_on_side(ref, side):
    p = (np.asarray(ref)+1)/2
    axis, value = ((1, 0.), (0, 1.), (1, 1.), (0, 0.))[side]
    if not np.all(p[:, axis] == value):
        return None
    t = (p[:, 0], p[:, 1], 1-p[:, 0], 1-p[:, 1])[side]
    return np.column_stack((t, p[:, 2]))


def _candidate(parent, template, fixed, ends, coordinates, nid_support, *, core_port_policy='fixed', core_indices=()):
    _validate_parent_support_binding(parent, nid_support)
    refs = np.array(template['nodes'])
    keys = [collar._node_support(ref, parent['macro']) for ref in refs]
    outer = np.array([coordinates[n] for n in parent['macro']])
    inner = np.array([coordinates[n] for n in parent['innerCoarseCorners']])
    macro = np.vstack((outer, inner))
    weights = np.prod(1+refs[:, None, :]*SIGNS[None, :, :], axis=2)/8
    points = weights @ macro
    boundary = _template_faces(template)
    actual = {_key([keys[i] for i in face]): _cycle([keys[i] for i in face]) for face in boundary}
    missing = []
    for index, binding in enumerate(fixed):
        expected = [nid_support[n] for n in binding['nodeIDs']]
        if actual.get(_key(expected)) != _cycle(expected):
            missing.append(index)
    core_indices = set(core_indices)
    protected_missing = [i for i in missing if i not in core_indices]
    active_missing = missing if core_port_policy == 'fixed' else protected_missing
    active_count = len(fixed) if core_port_policy == 'fixed' else len(fixed)-len(core_indices)
    defects = []
    end_face_count = 0
    for end in ends:
        for face in boundary:
            uv = _uv_on_side(refs[face], end['macroSide'])
            if uv is None:
                continue
            end_face_count += 1
            identity = q4_parameter_identity(uv)
            if end['nonplanarSource'] and not identity['exactIdentity']:
                defects.append(dict(sourceFace=end['source']['localFace'], childUV=uv.tolist(), **identity))
    metrics = measure_h8(points, np.array(template['elements']))
    _require(np.isfinite(metrics['cornerScaledJacobian']).all(), 'Nonfinite candidate quality')
    reasons = []
    if active_missing:
        reasons.append('FIXED_FACE_PARTITION_MISMATCH')
    if defects:
        reasons.append('SOURCE_Q4_POLYNOMIAL_IDENTITY_FAILED')
    # Positivity is a prerequisite, not engineering acceptance or a proof over the cell.
    sj = float(metrics['cornerAndCenterScaledJacobian'].min())
    positive = bool(metrics['sampledPositiveJacobians'].all())
    if not positive:
        reasons.append('NONPOSITIVE_SAMPLED_JACOBIAN')
    macro_volume = float(measure_h8(macro, np.arange(8).reshape(1, 8))['integratedVolume'][0])
    _require(macro_volume > 0, 'Nonpositive source-parametric collar macro')
    port_faces = [face for face in boundary if np.all(refs[face, 2] == 1)]
    inner_nonplanar = _nonplanar_exact(inner)[0]
    port_identity = not inner_nonplanar or all(q4_parameter_identity((refs[f, :2]+1)/2)['exactIdentity'] for f in port_faces)
    if not port_identity:
        reasons.append('CORE_PORT_SUPPORT_IDENTITY_FAILED')
    common_pass = not defects and positive and port_identity
    return dict(template=template['name'], h8=len(template['elements']), endpointFaces=end_face_count,
                family=template.get('family', 'two_way7'),
                fixedFacesMatched=active_count-len(active_missing), fixedFacesRequired=active_count,
                firstMissingFixedBinding=fixed[active_missing[0]] if active_missing else None,
                missingProtectedBindingRefs=[[fixed[i]['eid'], fixed[i]['localFace']] for i in protected_missing],
                fixedPolicyPassed=common_pass and not missing,
                replanPolicyPassed=common_pass and not protected_missing,
                corePortFaces=len(port_faces), corePortSupportIdentity=port_identity,
                sourceSupportPreservedByConstruction=not defects,
                firstSourcePolynomialConflict=defects[0] if defects else None,
                cornerCenterMinimumSJ=sj, minimumGaussDeterminant=float(metrics['minimumGaussDeterminant'].min()),
                sampledPositiveJacobians=positive,
                relativeMacroIntegralDifference=float(abs(metrics['integratedVolume'].sum()-macro_volume)/macro_volume),
                boundaryNecessaryConditionsPassed=not reasons,
                rejectionCodes=reasons, engineeringAccepted=False)


def _partition(parent, template, edge):
    refs = np.array(template['nodes'])
    keys = [collar._node_support(ref, parent['macro']) for ref in refs]
    edge = set(edge)
    faces = [[keys[i] for i in face] for face in _template_faces(template)
             if all({n for n, _ in keys[i][1]} <= edge for i in face)]
    _require(faces, 'Missing macro-side partition')
    return {_key(f): _cycle(f) for f in faces}


def opposite_partitions(a, b):
    return bool(a) and bool(b) and set(a) == set(b) and all(
        len(a[k]) == len(b[k]) == 4 and len(set(a[k])) == len(set(b[k])) == 4
        and _key(a[k]) == k and _key(b[k]) == k
        and _cycle(a[k]) == _cycle(b[k][::-1]) for k in a)


def solve_shared_partitions(domains, interfaces, partitions, *, max_search=10000, candidate_costs=None):
    """Bounded arc consistency + search, followed by independent all-edge readback."""
    _require(bool(domains), 'An empty mesh task is not a partition plan')
    _require(type(max_search) is int and max_search > 0, 'Positive search budget required')
    adjacency = defaultdict(list)
    allowed = {}
    for i, row in enumerate(interfaces):
        a, b = row['parents']
        adjacency[a].append((b, i)); adjacency[b].append((a, i))
        for p, q in ((a, b), (b, a)):
            allowed[p, q, i] = {t: {u for u in domains[q] if opposite_partitions(partitions[p, t, i], partitions[q, u, i])}
                                for t in domains[p]}
    empty = [p for p, d in domains.items() if not d]
    statistics = dict(searchNodes=0, domainPrunes=0)
    failures = []
    root_arc_domains = {}
    optimization = dict(forestObjectiveOptimized=False, minimumAdditiveCost=None)

    def forest_optimum(state):
        predecessors, children, order, roots = {}, defaultdict(list), [], []
        for root in sorted(state):
            if root in predecessors:
                continue
            roots.append(root); predecessors[root] = None; stack = [root]
            while stack:
                p = stack.pop(); order.append(p)
                for q, i in adjacency[p]:
                    if predecessors[p] == (q, i):
                        continue
                    if q in predecessors:
                        return False, None
                    predecessors[q] = (p, i); children[p].append((q, i)); stack.append(q)
        costs, choices = {}, {}
        for p in reversed(order):
            costs[p] = {}
            for t in state[p]:
                value = candidate_costs[p][t]
                _require(type(value) is int and value >= 0, 'Nonnegative integral candidate cost required')
                selected_children = []
                for q, i in children[p]:
                    eligible = allowed[p, q, i][t] & costs[q].keys()
                    if not eligible:
                        break
                    u = min(eligible, key=lambda k: (costs[q][k], k))
                    value += costs[q][u]; selected_children.append((q, u))
                else:
                    costs[p][t] = value; choices[p, t] = selected_children
        optimization['forestObjectiveOptimized'] = True
        if any(not costs[p] for p in roots):
            return True, None
        selected_roots = [(p, min(costs[p], key=lambda t: (costs[p][t], t))) for p in roots]
        optimization['minimumAdditiveCost'] = sum(costs[p][t] for p, t in selected_roots)
        assignment = {}; stack = selected_roots.copy()
        while stack:
            p, t = stack.pop(); assignment[p] = t; stack.extend(choices[p, t])
        return True, assignment

    def search(state):
        statistics['searchNodes'] += 1
        if statistics['searchNodes'] > max_search:
            raise RuntimeError('shared-partition search budget exhausted')
        changed = True
        while changed:
            changed = False
            for (p, q, i), compatibility in allowed.items():
                kept = [t for t in state[p] if compatibility[t] & set(state[q])]
                if len(kept) != len(state[p]):
                    statistics['domainPrunes'] += len(state[p])-len(kept)
                    if not kept:
                        if len(failures) < 8:
                            failures.append(dict(interface=interfaces[i], rejectedParent=p,
                                                 oldDomain=state[p], neighbourDomain=state[q]))
                        return None
                    state[p] = kept; changed = True
        if statistics['searchNodes'] == 1:
            root_arc_domains.update({p: d.copy() for p, d in state.items()})
            if candidate_costs is not None:
                is_forest, assignment = forest_optimum(state)
                if is_forest:
                    return assignment
        undecided = [p for p, d in state.items() if len(d) > 1]
        if not undecided:
            return {p: d[0] for p, d in state.items()}
        p = min(undecided, key=lambda n: (len(state[n]), -len(adjacency[n]), n))
        for t in state[p]:
            child = {n: d.copy() for n, d in state.items()}; child[p] = [t]
            result = search(child)
            if result is not None:
                return result
        return None

    exhausted = False
    try:
        assignment = None if empty else search({p: list(d) for p, d in domains.items()})
    except RuntimeError:
        assignment = None; exhausted = True
    pairs = 0
    if assignment is not None:
        for i, row in enumerate(interfaces):
            a, b = row['parents']; pa, pb = partitions[a, assignment[a], i], partitions[b, assignment[b], i]
            _require(opposite_partitions(pa, pb), 'Assignment failed shared partition readback')
            pairs += len(pa)
    return dict(solved=assignment is not None, assignment=assignment, initialEmptyParents=empty,
                sharedMacroInterfaces=len(interfaces), matchedOrientedSharedQuadPairs=pairs,
                rootArcDomains=root_arc_domains,
                failureWitnesses=failures, searchBudgetExhausted=exhausted, **statistics, **optimization)


def _blocking_readback(solve, by_eid, templates, relaxed_domains, per_parent, fixed_records, child_parent, selected):
    """Read the actual conflicting face partitions and explicit outside cut obligations."""
    candidates = {r['parentEID']: r['candidates'] for r in per_parent}
    witnesses = []
    for failure in solve['failureWitnesses']:
        p = failure['rejectedParent']
        q = next(n for n in failure['interface']['parents'] if n != p)
        edge = failure['interface']['edgeNodeIDs']
        old = {p: failure['oldDomain'], q: failure['neighbourDomain']}
        partitions = {(n, t): _partition(by_eid[n], templates[t], edge) for n in (p, q) for t in old[n]}
        pairs = sum(opposite_partitions(partitions[p, a], partitions[q, b]) for a in old[p] for b in old[q])
        _require(pairs == 0, 'Reported protected conflict still has a compatible pair')
        details = []
        for n in (p, q):
            for t in old[n]:
                details.append(dict(parentEID=n, template=templates[t]['name'],
                    orientedSupportQuads=[[[w, [list(s) for s in support]] for w, support in face]
                                          for face in partitions[n, t].values()]))
        alternatives = []
        for n, other in ((p, q), (q, p)):
            for t in relaxed_domains[n]:
                matches = [u for u in old[other] if opposite_partitions(
                    _partition(by_eid[n], templates[t], edge), partitions[other, u])]
                if not matches:
                    continue
                cuts = [fixed_records[tuple(ref)] for ref in candidates[n][t]['missingProtectedBindingRefs']]
                if not cuts:
                    continue  # This candidate was removed by another internal arc, not an outside cut.
                _require(all(r['role'] == 'unchanged-collar' for r in cuts), 'Conflict relaxation must change only collar cuts')
                neighbours = sorted({child_parent[b['eid']] for r in cuts for b in r['oppositeOwners']})
                _require(not set(neighbours) & selected and set(neighbours) <= set(collar.BODY_IDS),
                         'Conflict extension escaped unselected BODY_IDS collar')
                alternatives.append(dict(replanParentEID=n, template=templates[t]['name'],
                    compatibleOtherTemplates=[templates[u]['name'] for u in matches],
                    requiredAdditionalCollarParentIDs=neighbours,
                    blockingProtectedCuts=[dict(binding=r['binding'], oppositeOwners=r['oppositeOwners'],
                        oppositeCollarParentIDs=[child_parent[b['eid']] for b in r['oppositeOwners']]) for r in cuts],
                    expansionAuthorized=False, localInterfaceOnly=True))
        alternatives.sort(key=lambda r: (len(r['requiredAdditionalCollarParentIDs']), len(r['blockingProtectedCuts']), r['template']))
        witnesses.append(dict(interface=failure['interface'], protectedCompatiblePairCount=pairs,
            candidatePartitions=details, localExpansionAlternatives=alternatives,
            smallestLocalAlternative=alternatives[0] if alternatives else None,
            globallySufficientExpansionProven=False))
    return witnesses


def _frozen_patch_audit(mesh, by_eid, selected, selected_children, coordinates, per_parent, policy):
    mask = np.isin(mesh.element_ids, list(selected_children))
    cells = mesh.elements[mask]; eids = mesh.element_ids[mask]
    quality = measure_h8(mesh.nodes, cells)
    cell_volume = dict(zip(map(int, eids), quality['integratedVolume']))
    rows = []
    for p in sorted(selected):
        record = by_eid[p]
        macro = np.array([coordinates[n] for n in record['macro']+record['innerCoarseCorners']])
        volume = float(measure_h8(macro, np.arange(8).reshape(1, 8))['integratedVolume'][0])
        frozen_volume = float(sum(cell_volume[e] for e in record['childEids']))
        rows.append(dict(parentEID=p, macroIntegralVolume=volume, frozenH8IntegralVolume=frozen_volume,
                         relativeDifference=abs(frozen_volume-volume)/volume))
    eligible = [c for r in per_parent for c in r['candidates'] if c[policy+'PolicyPassed']]
    return dict(frozenCells=len(cells), unchangedFrozenCompositeCells=len(mesh.elements)-len(cells),
        unchangedCollarCells=15120-len(cells), originalRetainedCells=3968,
        sourceAndFrozenCoordinateChecks='bitwise verified by source/collar loader; no coordinate welding',
        frozenMinimumCornerCenterSJ=float(quality['cornerAndCenterScaledJacobian'].min()),
        frozenMinimumGaussDeterminant=float(quality['minimumGaussDeterminant'].min()),
        frozenSampledPositiveJacobians=bool(quality['sampledPositiveJacobians'].all()),
        frozenVolume=float(quality['integratedVolume'].sum()), macroVolume=sum(r['macroIntegralVolume'] for r in rows),
        perParentVolumeComparison=rows,
        localCandidateRawMetrics=dict(count=len(eligible),
            minimumCornerCenterSJ=min((c['cornerCenterMinimumSJ'] for c in eligible), default=None),
            minimumGaussDeterminant=min((c['minimumGaussDeterminant'] for c in eligible), default=None),
            maximumRelativeMacroIntegralDifference=max((c['relativeMacroIntegralDifference'] for c in eligible), default=None),
            isAssembledPlanQuality=False),
        protectedPlanMetrics=None, geometryOrVolumeToleranceRelaxed=False, fullScrewAccepted=False)


def build_endpoint_contract(original_path, phase_path, collar_directory, *, include_neck=False,
                            core_port_policy='fixed', expanded_collar_parent_ids=(), node_executable=None):
    """Extract all 74 parents and compare fixed/replan domains and shared partitions.

    Fixed boundaries include original hard teeth, unchanged collar cuts, the
    external valley. Only replan permits the candidate inner port to change.
    Lower endpoint faces are NOT declared physically free just because they
    have one ID-owner. include_neck changes future assembly accounting only.
    """
    _require(core_port_policy in ('fixed', 'replan'), 'core_port_policy must be fixed or replan')
    expanded = validate_expanded_parents(expanded_collar_parent_ids)
    counts = assembly_counts(include_neck)
    counts.update(patchParents=74+len(expanded), expandedCollarParents=len(expanded),
                  patchCollarChildren=7*(74+len(expanded)))
    mesh, phase, parents, child_parent, nid_support, hashes = _load(original_path, phase_path, collar_directory)
    export = collar.load_repository_templates(node_executable)
    sweep = load_sweep_templates(node_executable)
    templates = export['templates'] + sweep['templates']
    coordinates = {int(n): p for n, p in zip(mesh.node_ids, mesh.nodes)}
    phase_coords = {int(n): p for n, p in zip(phase.node_ids, phase.nodes)}
    owners = face_owners(mesh)
    by_eid = {r['eid']: r for r in parents}
    phase_boundary = extract_cavity(phase, collar.BODY_IDS)['boundary']
    source_ends = [r['selected'] for r in phase_boundary
                   if r['selected']['localFace'] != 4 and r['geometry']['q4Area'] > 1e-14]
    endpoint_selected = {r['eid'] for r in source_ends}
    _require(endpoint_selected == ENDPOINT_PARENTS and len(source_ends) == 76, 'Actual endpoint scope differs from 74 parents/76 obligations')
    selected = endpoint_selected | set(expanded)
    selected_children = {e for p in selected for e in by_eid[p]['childEids']}
    _require(len(selected_children) == 7*len(selected), 'Incomplete collar child patch')
    all_faces = [row for rows in owners.values() for row in rows]
    parent_boundary = defaultdict(list)
    patch_skin = []
    for rows in owners.values():
        _require(len(rows) <= 2, 'Nonmanifold composite face')
        for row in rows:
            p = child_parent.get(row['eid'])
            if p not in selected:
                continue
            if sum(child_parent.get(o['eid']) == p for o in rows) == 1:
                parent_boundary[p].append(row)
        own = [r for r in rows if r['eid'] in selected_children]
        if len(own) == 1:
            patch_skin.append((own[0], [r for r in rows if r['eid'] not in selected_children]))
    end_records = []
    variable_keys = set()
    for source in source_ends:
        p = by_eid[source['eid']]
        root = set(source['nodeIDs']) & set(p['macro'])
        _require(len(root) == 2, 'End source must have one actual outer root edge')
        side = next(i for i in range(4) if {p['macro'][i], p['macro'][(i+1)%4]} == root)
        faces = [r for r in parent_boundary[p['eid']] if all(
            {n for n, _ in nid_support[v][1]} <= root for v in r['nodeIDs'])]
        _require(len(faces) in (4, 5), 'Unexpected actual annular partition')
        nonplanar, determinant = _nonplanar_exact([phase_coords[n] for n in source['nodeIDs']])
        # Verify that radial restriction is the actual source parameter map,
        # rather than just assuming every end is a planar/constant-Z cap.
        source_edges = _edges(source['nodeIDs'])
        for n in root:
            axis = [v for edge in source_edges if n in edge for v in edge if v != n
                    and np.all(phase_coords[v][:2] == 0)]
            _require(len(axis) == 1 and phase_coords[n][2] == phase_coords[axis[0]][2],
                     'Endpoint radial source-parameter restriction is not valid')
        edge_counts = Counter(e for f in faces for e in _edges(f['nodeIDs']))
        boundary_edges = [e for e, count in edge_counts.items() if count == 1]
        outer = [list(e) for e in boundary_edges if all(nid_support[n][0] == 0 for n in e)]
        inner = [list(e) for e in boundary_edges if all(nid_support[n][0] == 4 for n in e)]
        _require(len(outer) == 1 and len(inner) == 2, 'Actual endpoint edge counts differ')
        end = 'lower' if np.mean([phase_coords[n][2] for n in source['nodeIDs']]) < 6 else 'upper'
        record = dict(source=source, sourceXYZ=[phase_coords[n].tolist() for n in source['nodeIDs']],
                      end=end, macroSide=side, nonplanarSource=nonplanar, exactBilinearBasisDeterminant=determinant,
                      annularFaces=faces, topology=quad_patch_topology([r['nodeIDs'] for r in faces]),
                      outerBoundaryEdges=outer, innerBoundaryEdges=inner,
                      role='variable-external-end' if end == 'upper' else 'variable-neck-contact-obligation',
                      externalFreeEndCandidate=end == 'upper', certifiedPhysicalFree=False,
                      sourceRadialRestriction=[.6, 1.], radialSourceParameterMapVerified=True,
                      sourceSupportMustRemainExact=True)
        end_records.append(record)
        variable_keys.update(_key(r['nodeIDs']) for r in faces)
    _require(len(variable_keys) == 308, 'Incomplete annular end face inventory')
    fixed = []
    for binding, other in patch_skin:
        key = _key(binding['nodeIDs'])
        if key in variable_keys:
            _require(not other, 'Endpoint annulus unexpectedly has a retained ID-owner')
            continue
        parent = by_eid[child_parent[binding['eid']]]
        if other:
            role = 'unchanged-collar' if other[0]['eid'] in child_parent else 'retained-tooth'
            _require(_cycle(binding['nodeIDs']) == _cycle(other[0]['nodeIDs'][::-1]), 'Fixed interface orientation differs')
        elif key in {_key(q) for q in parent['fine4CollarOutwardQuads']}:
            role = 'inner-core-port'
        elif key == _key(parent['nodeIDs']) and parent['retained'] is None:
            role = 'external-valley'
        else:
            raise ValueError('Unclassified patch boundary; do not assume free')
        fixed.append(dict(role=role, binding=binding, oppositeOwners=other, parentEID=parent['eid'],
                          oppositeCollarParentIDs=[child_parent[r['eid']] for r in other if r['eid'] in child_parent]))
    _require(len(fixed)+308 == len(patch_skin), 'Patch boundary not fully partitioned')
    fixed_by_parent = defaultdict(list)
    core_indices = defaultdict(list)
    fixed_record_by_binding = {}
    for r in fixed:
        fixed_record_by_binding[r['binding']['eid'], r['binding']['localFace']] = r
        if r['role'] == 'inner-core-port':
            core_indices[r['parentEID']].append(len(fixed_by_parent[r['parentEID']]))
        fixed_by_parent[r['parentEID']].append(r['binding'])
    ends_by_parent = defaultdict(list)
    for r in end_records:
        ends_by_parent[r['source']['eid']].append(r)
    edge_faces = defaultdict(list)
    for binding in all_faces:
        if _key(binding['nodeIDs']) not in variable_keys:
            for edge in _edges(binding['nodeIDs']):
                edge_faces[edge].append(binding)
    conflicts = []
    for end in end_records:
        if not end['nonplanarSource']:
            continue
        options = []
        for kind, edges in (('REFINE_OUTER_1_TO_2', end['outerBoundaryEdges']),
                            ('RETESSELLATE_INNER_2_TO_1', end['innerBoundaryEdges'])):
            incident = {(b['eid'], b['localFace']): b for edge in edges for b in edge_faces[tuple(edge)]}
            _require(incident, 'Missing fixed edge-star obligations')
            options.append(dict(action=kind, chainEdges=edges, mustChangeFaceBindings=list(incident.values()),
                requiredOutsidePatchEIDs=sorted({b['eid'] for b in incident.values() if b['eid'] not in selected_children}),
                requiredCollarParentEIDs=sorted({child_parent[b['eid']] for b in incident.values() if b['eid'] in child_parent}),
                authorized=core_port_policy == 'replan' and kind == 'RETESSELLATE_INNER_2_TO_1'))
        conflicts.append(dict(code='NONPLANAR_Q4_RULING_COUNT_CONFLICT', source=end['source'],
            end=end['end'], fixedOppositeEdgeCounts=[1, 2],
            assumptions=['nondegenerate exact bilinear Q4 faces', 'conforming straight edges without T-junctions',
                         'same rectangular source-parametric annulus', 'no source NID identification'],
            minimumChangedBoundaryChains=1, localNecessaryScopeAlternatives=options,
            blocksSelectedPolicy=core_port_policy == 'fixed',
            globalMinimumExpansionProven=False, propagationBeyondListedEdgeStarUnresolved=True))
    per_parent = []
    for eid in sorted(selected):
        p = by_eid[eid]
        choices = [_candidate(p, t, fixed_by_parent[eid], ends_by_parent[eid], coordinates, nid_support,
                              core_port_policy=core_port_policy, core_indices=core_indices[eid]) for t in templates]
        per_parent.append(dict(parentEID=eid, childEIDs=p['childEids'], sourceRootBinding=dict(
            eid=eid, pid=p['pid'], localFace=4, nodeIDs=p['nodeIDs']),
            innerFineQuads=p['fine4CollarOutwardQuads'], candidates=choices,
            eligibleTemplates=[r['template'] for r in choices if r['boundaryNecessaryConditionsPassed']],
            fixedPolicyEligibleTemplates=[r['template'] for r in choices if r['fixedPolicyPassed']],
            replanPolicyEligibleTemplates=[r['template'] for r in choices if r['replanPolicyPassed']]))
    macro_edges = defaultdict(list)
    for p in parents:
        for edge in _edges(p['macro']):
            macro_edges[edge].append(p['eid'])
    interfaces = [dict(edgeNodeIDs=list(edge), parents=pair) for edge, pair in sorted(macro_edges.items())
                  if len(pair) == 2 and set(pair) <= selected]
    partitions = {(p, ti, i): _partition(by_eid[p], t, row['edgeNodeIDs'])
                  for i, row in enumerate(interfaces) for p in row['parents'] for ti, t in enumerate(templates)}
    domains = {policy: {r['parentEID']: [i for i, c in enumerate(r['candidates']) if c[policy+'PolicyPassed']]
                        for r in per_parent} for policy in ('fixed', 'replan')}
    shared = {policy: solve_shared_partitions(d, interfaces, partitions) for policy, d in domains.items()}
    # A second, explicitly conditional solve identifies collider-neighbour scope;
    # it never relaxes tooth/valley and never counts as a protected-boundary plan.
    relaxed_domains = {}
    expansion_options = []
    for row in per_parent:
        eid = row['parentEID']; possible = []
        for i, c in enumerate(row['candidates']):
            missing = [fixed_record_by_binding[tuple(ref)] for ref in c['missingProtectedBindingRefs']]
            if (c['sourceSupportPreservedByConstruction'] and c['sampledPositiveJacobians'] and c['corePortSupportIdentity']
                    and all(r['role'] == 'unchanged-collar' for r in missing)):
                possible.append(i)
                neighbours = sorted({child_parent[b['eid']] for r in missing for b in r['oppositeOwners']})
                _require(not set(neighbours) & selected and set(neighbours) <= set(collar.BODY_IDS),
                         'Expansion must only name unchanged collar parents')
                expansion_options.append(dict(parentEID=eid, template=c['template'],
                    neighbourCollarParentEIDs=neighbours,
                    changedCutBindings=[dict(binding=r['binding'], oppositeOwners=r['oppositeOwners']) for r in missing]))
        relaxed_domains[eid] = sorted(possible, key=lambda i: (len(row['candidates'][i]['missingProtectedBindingRefs']),
                                                            row['candidates'][i]['h8'],
                                                            -row['candidates'][i]['cornerCenterMinimumSJ'], i))
    costs = {r['parentEID']: {i: 10000*len(c['missingProtectedBindingRefs'])+c['h8']
                            for i, c in enumerate(r['candidates'])} for r in per_parent}
    if expanded:
        conditional = dict(solved=False, assignment=None, minimumAdditiveCost=None, rootArcDomains={},
                           status='not-run-explicit-expanded-scope-protected-only')
    else:
        conditional = solve_shared_partitions(relaxed_domains, interfaces, partitions, candidate_costs=costs)
    conditional['protectedBoundaryPlan'] = False
    conditional['scopeExpansionAuthorized'] = False
    conditional['sourceRetainedRegionExpansion'] = False
    conditional['selectionObjective'] = '10000 * changed cut Q4 count + H8; exact forest objective, not minimum neighbour union'
    conditional['corePortPolicy'] = 'replan'
    if conditional['minimumAdditiveCost'] is not None:
        conditional['minimumChangedCutQuads'] = conditional['minimumAdditiveCost']//10000
    conditional['candidateLocalDomainSizes'] = {str(p): len(d) for p, d in relaxed_domains.items()}
    conditional['arcSurvivingTemplateFamilies'] = dict(Counter(templates[i].get('family', 'two_way7')
        for domain in conditional['rootArcDomains'].values() for i in domain))
    chosen_expansion = []
    if conditional['solved']:
        for p, index in conditional['assignment'].items():
            chosen_expansion.append(next(r for r in expansion_options if r['parentEID'] == p and r['template'] == templates[index]['name']))
    conditional['requiredNeighbourCollarParentEIDs'] = sorted({n for r in chosen_expansion for n in r['neighbourCollarParentEIDs']})
    conditional['selectedCutChanges'] = chosen_expansion
    if conditional['solved']:
        chosen_candidates = [next(r for r in per_parent if r['parentEID'] == p)['candidates'][i]
                             for p, i in conditional['assignment'].items()]
        conditional['prospectiveH8'] = sum(c['h8'] for c in chosen_candidates)
        conditional['templateFamilies'] = dict(Counter(c['family'] for c in chosen_candidates))
        conditional['minimumCornerCenterSJ'] = min(c['cornerCenterMinimumSJ'] for c in chosen_candidates)
        conditional['minimumGaussDeterminant'] = min(c['minimumGaussDeterminant'] for c in chosen_candidates)
        conditional['prospectiveCorePortQuads'] = sum(c['corePortFaces'] for c in chosen_candidates)
        conditional['prospectiveAnnularEndQuads'] = sum(c['endpointFaces'] for c in chosen_candidates)
        conditional['protectedToothAndValleyFaces'] = len(selected)
    protected = [r for r in fixed if core_port_policy == 'fixed' or r['role'] != 'inner-core-port']
    selected_solve = shared[core_port_policy]
    blocked_interfaces = _blocking_readback(selected_solve, by_eid, templates, relaxed_domains,
                                            per_parent, fixed_record_by_binding, child_parent, selected)
    frozen_audit = _frozen_patch_audit(mesh, by_eid, selected, selected_children, coordinates, per_parent, core_port_policy)
    _require({r['source']['eid'] for r in end_records} == ENDPOINT_PARENTS, 'Expansion added external end obligations')
    protected_check = dict(scopeParentCount=len(selected), protectedFaceCount=len(protected),
        allProtectedPartitionsMatched=selected_solve['solved'],
        status='matched-partitions' if selected_solve['solved'] else
               'search-budget-exhausted' if selected_solve['searchBudgetExhausted'] else 'rejected',
        failureCode=None if selected_solve['solved'] else
            'EMPTY_PROTECTED_LOCAL_DOMAIN' if selected_solve['initialEmptyParents'] else
            'SEARCH_BUDGET_EXHAUSTED' if selected_solve['searchBudgetExhausted'] else 'PROTECTED_SHARED_PARTITION_CONFLICT',
        blockingInterfaces=blocked_interfaces, expandedParentIDs=list(expanded),
        extraParentExternalEndFaces=0, originalEndObligations=76,
        nextLocalCollarParentAlternatives=[w['smallestLocalAlternative']['requiredAdditionalCollarParentIDs']
                                         for w in blocked_interfaces if w['smallestLocalAlternative']],
        automaticScopeExpansion=False, replacementPatchExported=False)
    plan = None
    obligations = []
    scenario = 'protected-boundary-plan' if selected_solve['solved'] else 'conditional-collar-expansion-diagnostic'
    selected_assignment = selected_solve['assignment'] if selected_solve['solved'] else conditional['assignment']
    if core_port_policy == 'replan' and selected_assignment is not None:
        support_nid = {key: n for n, key in nid_support.items()}
        for p, ti in sorted(selected_assignment.items()):
            t = templates[ti]; refs = np.array(t['nodes'])
            keys = [collar._node_support(ref, by_eid[p]['macro']) for ref in refs]
            new_quads = [[support_nid[keys[n]] for n in f] for f in _template_faces(t) if np.all(refs[f, 2] == 1)]
            old_bindings = [r['binding'] for r in fixed if r['parentEID'] == p and r['role'] == 'inner-core-port']
            if {_key(f) for f in new_quads} != {_key(r['nodeIDs']) for r in old_bindings}:
                obligations.append(dict(parentEID=p, template=t['name'], scenario=scenario,
                    replacedCorePortBindings=old_bindings, proposedCollarOutwardQuads=new_quads,
                    proposedCoreOutwardQuads=[q[::-1] for q in new_quads],
                    usesExistingFrozenNIDsOnly=True, originalNIDsMerged=False, coreFilled=False))
        if selected_solve['solved']:
            plan = dict(status='partition-plan-only', coreFilled=False, engineeringAccepted=False,
                        sharedPartitionReadback=selected_solve,
                        parentTemplates={str(p): templates[i]['name'] for p, i in selected_assignment.items()})
    empty = [r['parentEID'] for r in per_parent if not r['eligibleTemplates']]
    uniform = [r['candidates'][-1] for r in per_parent]
    all_candidates = [c for r in per_parent for c in r['candidates']]
    expansion = {}
    for option_index, name in enumerate(('outerRefinement', 'innerRetessellation')):
        options = [r['localNecessaryScopeAlternatives'][option_index] for r in conflicts]
        outside_eids = sorted({e for r in options for e in r['requiredOutsidePatchEIDs']})
        changed_parents = sorted({e for r in options for e in r['requiredCollarParentEIDs']} - selected)
        expansion[name] = dict(directOutsidePatchEIDs=outside_eids,
            directUnchangedCollarParentEIDs=changed_parents,
            globalMinimalOrSufficient=False,
            authorized=core_port_policy == 'replan' and name == 'innerRetessellation')
    patch_cells = [[int(e), int(pid), *mesh.node_ids[cell].tolist()]
                   for e, pid, cell in zip(mesh.element_ids, mesh.part_ids, mesh.elements) if int(e) in selected_children]
    used_nodes = sorted({n for cell in patch_cells for n in cell[2:]})
    summary = dict(counts=counts, corePortPolicy=core_port_policy,
        expandedCollarParentIDs=list(expanded), selectedCollarParentIDs=sorted(selected),
        patchSkinFaces=len(patch_skin), fixedFaces=len(protected), frozenBaselineFixedFaces=len(fixed), variableAnnularFaces=308,
        replannableCorePortFaces=4*len(selected) if core_port_policy == 'replan' else 0,
        fixedRoles=dict(Counter(r['role'] for r in protected)), sourceEndObligations=76,
        nonplanarRulingConflicts=len(conflicts), regularTwoByTwoAnnularPatches=sum(r['topology']['regularTwoByTwo'] for r in end_records),
        activeFixedPortRulingConflicts=len(conflicts) if core_port_policy == 'fixed' else 0,
        configurationsTested=len(all_candidates), emptyLocalTemplateDomains=empty,
        uniform8=dict(parentsTested=len(selected), prospectiveH8=8*len(selected),
                      exactSourceSupportParents=sum(c['sourceSupportPreservedByConstruction'] for c in uniform),
                      fixedBoundaryPassParents=sum(c['fixedFacesMatched'] == c['fixedFacesRequired'] for c in uniform),
                      minimumCornerCenterSJ=min(c['cornerCenterMinimumSJ'] for c in uniform),
                      minimumGaussDeterminant=min(c['minimumGaussDeterminant'] for c in uniform),
                      maximumRelativeMacroIntegralDifference=max(c['relativeMacroIntegralDifference'] for c in uniform)),
        localNecessaryScopeAlternatives=expansion,
        policyComparison={policy: dict(localNonemptyParents=sum(bool(d) for d in domains[policy].values()),
            totalLocalCandidates=sum(map(len, domains[policy].values())), sharedPartitionSolve=shared[policy]) for policy in domains},
        changedCorePortObligationParents=len(obligations),
        globallyCompatibleConfigurationFound=selected_solve['solved'],
        globalSearchStatus=('protected-shared-partitions-verified' if selected_solve['solved'] else
                            'rejected-before-search-empty-local-domains' if empty else 'shared-partition-conflict-or-budget'),
        protectedBoundaryStatus=protected_check['status'], protectedBoundaryFailureCode=protected_check['failureCode'],
        feasibility='partition-plan-only' if selected_solve['solved'] else 'rejected' if not selected_solve['searchBudgetExhausted'] else 'unverified',
        reasonCodes=sorted({code for c in all_candidates for code in c['rejectionCodes']} |
                          ({r['code'] for r in conflicts} if core_port_policy == 'fixed' else set())),
        sourceNodesMoved=False, sourceNIDsMerged=False, sourceDomainRelaxed=False, minimumSJThresholdRelaxed=False,
        allH8RepairAccepted=False, wholeScrewAccepted=False)
    result = dict(schema='hexrefine.screw-endpoint-contract.v2', summary=summary, inputSHA256=hashes,
        producerSHA256=collar._sha(Path(__file__)),
        templateProvenance=export['provenance'], sweepTemplateProvenance=sweep['provenance'],
        templateCatalogue=[dict(name=t['name'], family=t.get('family', 'two_way7'),
                                orientation=t.get('signature'), h8=len(t['elements'])) for t in templates],
        fixedInterfaces=protected, variableEndpoints=end_records,
        originalCorePortBindings=[r for r in fixed if r['role'] == 'inner-core-port'],
        changedCorePortObligations=obligations, protectedPartitionPlan=plan,
        protectedBoundaryCheck=protected_check, frozenPatchAudit=frozen_audit,
        sharedMacroInterfaces=interfaces, collarExpansionDiagnostic=conditional,
        collarExpansionOptions=expansion_options if not expanded else [],
        patchCellColumns=['EID', 'PID', 'NID1', 'NID2', 'NID3', 'NID4', 'NID5', 'NID6', 'NID7', 'NID8'],
        patchCells=patch_cells, patchNodeColumns=['NID', 'X', 'Y', 'Z'],
        patchNodes=[[n, *coordinates[n].tolist()] for n in used_nodes],
        parents=per_parent, conflicts=conflicts,
        limits=dict(noVolumeFill=True, noOverlapCertificate=True, noContinuumJacobianCertificate=True,
                    noRetainedHeadContactCertificate=True, noKOrINPExport=True))
    _require(all(collar._sha(p) == h for p, h in hashes.items()), 'Input changed during extraction')
    return result


def compact_contract(result):
    """Lossless column pools keep all oriented candidate evidence below 2 MiB."""
    if 'parents' not in result or not result['parents']:
        return result
    candidates = [c for p in result['parents'] for c in p['candidates']]
    columns = list(candidates[0])
    _require(all(list(c) == columns for c in candidates), 'Candidate columns differ')
    pools, codes = {}, {}
    for column in columns:
        values = [c[column] for c in candidates]
        unique, indices, lookup = [], [], {}
        for v in values:
            key = json.dumps(v, separators=(',', ':'), sort_keys=True, allow_nan=False)
            if key not in lookup:
                lookup[key] = len(unique); unique.append(v)
            indices.append(lookup[key])
        if len(json.dumps([unique, indices])) < len(json.dumps(values)):
            pools[column] = unique; codes[column] = indices
    packed = dict(result, candidateEncoding='column-pools-v1', candidateColumns=columns, candidateColumnPools=pools)
    packed['parents'] = []; cursor = 0
    for parent in result['parents']:
        row = {k: v for k, v in parent.items() if k != 'candidates'}
        row['candidateValues'] = [[codes[k][cursor+i] if k in pools else c[k] for k in columns]
                                  for i, c in enumerate(parent['candidates'])]
        cursor += len(parent['candidates']); packed['parents'].append(row)
    return packed


def expand_contract(packed):
    """Decode file candidates back into the public API's ordinary dictionaries."""
    if 'candidateEncoding' not in packed:
        return packed
    _require(packed['candidateEncoding'] == 'column-pools-v1', 'Unknown candidate encoding')
    columns, pools = packed['candidateColumns'], packed['candidateColumnPools']
    result = {k: v for k, v in packed.items() if k not in ('candidateEncoding', 'candidateColumns', 'candidateColumnPools')}
    result['parents'] = []
    for parent in packed['parents']:
        row = {k: v for k, v in parent.items() if k != 'candidateValues'}
        _require(all(len(v) == len(columns) for v in parent['candidateValues']), 'Invalid candidate row width')
        row['candidates'] = [{k: pools[k][v] if k in pools else v for k, v in zip(columns, values)}
                             for values in parent['candidateValues']]
        result['parents'].append(row)
    return result


def write_contract(result, output):
    """Exclusive small JSON delivery; no input, source or old evidence overwrite."""
    output = Path(output).resolve()
    _require(output.parent.is_dir() and not output.exists(), 'Require a fresh JSON path in an existing output directory')
    text = json.dumps(compact_contract(result), separators=(',', ':'), allow_nan=False)
    _require(len(text.encode('utf-8')) <= MAX_REPORT_BYTES, 'Endpoint JSON byte budget exceeded')
    with output.open('x', encoding='utf-8') as stream:
        stream.write(text)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--original', required=True)
    parser.add_argument('--phase', required=True)
    parser.add_argument('--collar', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--include-neck', action='store_true')
    parser.add_argument('--core-port-policy', choices=('fixed', 'replan'), default='fixed')
    parser.add_argument('--expanded-collar-parent-ids', type=int, nargs='*', default=[])
    args = parser.parse_args()
    _require(not Path(args.output).exists() and Path(args.output).parent.is_dir(), 'Require fresh caller-selected output')
    result = build_endpoint_contract(args.original, args.phase, args.collar, include_neck=args.include_neck,
                                     core_port_policy=args.core_port_policy,
                                     expanded_collar_parent_ids=args.expanded_collar_parent_ids)
    write_contract(result, args.output)
    print(json.dumps(result['summary'], indent=2))


if __name__ == '__main__':
    main()
