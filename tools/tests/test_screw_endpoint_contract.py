"""Exact parameter controls and ALL 74 actual source endpoint parents."""
import json
import copy
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from tools.bolthex import screw_endpoint_contract as endpoint


class ParameterAndPolicyTests(unittest.TestCase):
    def test_parent_inner_geometry_must_match_ordered_source_support(self):
        parent = dict(macro=[1, 2, 3, 4], innerCoarseCorners=[11, 12, 13, 14])
        supports = {n: (0, ((n, 4),)) for n in parent['macro']}
        supports.update({n+10: (4, ((n, 4),)) for n in parent['macro']})
        endpoint._validate_parent_support_binding(parent, supports)
        for inner in ([12, 13, 14, 11], [11, 11, 13, 14], [11, 12, 13, 99]):
            with self.subTest(inner=inner), self.assertRaisesRegex(ValueError, 'corner'):
                endpoint._validate_parent_support_binding(dict(parent, innerCoarseCorners=inner), supports)

    def test_empty_or_degenerate_partitions_cannot_solve_shared_interface(self):
        self.assertFalse(endpoint.opposite_partitions({}, {}))
        invalid = {(1, 1, 2, 2): (1, 2, 1, 2)}
        self.assertFalse(endpoint.opposite_partitions(invalid, invalid))
        result = endpoint.solve_shared_partitions({10: [0], 20: [0]},
            [dict(parents=[10, 20], edgeNodeIDs=[1, 2])], {(10, 0, 0): {}, (20, 0, 0): {}})
        self.assertFalse(result['solved'])
        self.assertEqual(result['matchedOrientedSharedQuadPairs'], 0)

    def test_rectangle_identity_in_both_cycles(self):
        square = [[0, 0], [1, 0], [1, .5], [0, .5]]
        self.assertTrue(endpoint.q4_parameter_identity(square)['exactIdentity'])
        self.assertTrue(endpoint.q4_parameter_identity(square[::-1])['exactIdentity'])

    def test_diagonal_transition_edge_fails_exact_polynomial(self):
        result = endpoint.q4_parameter_identity([[0, 0], [1, 0], [.5, 1], [0, 1]])
        self.assertFalse(result['exactIdentity'])
        self.assertTrue(result['nonzeroCoefficients'])
        self.assertTrue(any(r['numerator'] != 0 for r in result['nonzeroCoefficients']))

    def test_exact_planarity_not_a_distance_tolerance(self):
        q = np.array([[0., 0., 0.], [1., 0., 0.], [1., 1., 0.], [0., 1., 0.]])
        self.assertFalse(endpoint._nonplanar_exact(q)[0])
        q[2, 2] = 1e-15
        self.assertTrue(endpoint._nonplanar_exact(q)[0])

    def test_invalid_uv_rejects(self):
        for uv in (np.zeros((3, 2)), np.full((4, 2), np.nan), np.full((4, 2), -1), [['x']*2]*4):
            with self.subTest(uv=uv), self.assertRaises(ValueError):
                endpoint.q4_parameter_identity(uv)

    def test_neck_accounting_does_not_claim_neck_meshed(self):
        a, b = endpoint.assembly_counts(False), endpoint.assembly_counts(True)
        self.assertEqual((a['futureRetainedOutside'], b['futureRetainedOutside']), (3968, 3896))
        self.assertEqual((a['selectedSourceDomain'], b['selectedSourceDomain']), (2160, 2232))
        self.assertEqual(b['neckEIDsToReplaceInFuture'], list(range(2817, 2889)))
        self.assertFalse(b['neckMeshedByThisAPI'])

    def test_invalid_neck_flag_precedes_source_read(self):
        with patch.object(endpoint, '_load', side_effect=AssertionError('source read')):
            with self.assertRaises(ValueError):
                endpoint.build_endpoint_contract('absent', 'absent', 'absent', include_neck=1)

    def test_invalid_core_policy_precedes_source_read(self):
        with patch.object(endpoint, '_load', side_effect=AssertionError('source read')):
            for value in ('approximate', None, True):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    endpoint.build_endpoint_contract('absent', 'absent', 'absent', core_port_policy=value)

    def test_retained_and_invalid_expansion_reject_before_source_read(self):
        bad = ([5049], [6128], [2817], [0], [True], [2925.0], [2925, 2925], [2889], None,
               '2925', list(range(2925, 3110)))
        with patch.object(endpoint, '_load', side_effect=AssertionError('source read')):
            for values in bad:
                with self.subTest(values=values), self.assertRaises(ValueError):
                    endpoint.build_endpoint_contract('absent', 'absent', 'absent', expanded_collar_parent_ids=values)

    def test_expansion_is_explicit_and_default_is_empty(self):
        self.assertEqual(endpoint.validate_expanded_parents(()), ())
        self.assertEqual(endpoint.validate_expanded_parents(list(endpoint.EXPANSION_112)), tuple(sorted(endpoint.EXPANSION_112)))
        self.assertEqual(len(endpoint.EXPANSION_112), 38)

    def test_closure_never_invents_or_partially_applies_an_obligation(self):
        selected = sorted(endpoint.ENDPOINT_PARENTS | set(endpoint.EXPANSION_112))
        result = dict(summary=dict(selectedCollarParentIDs=selected), parents=[], fixedInterfaces=[],
            protectedBoundaryCheck=dict(allProtectedPartitionsMatched=False, status='rejected',
                blockingInterfaces=[dict(interface=dict(parents=[3969, 3970], edgeNodeIDs=[6145, 6216]),
                    localExpansionAlternatives=[dict(requiredAdditionalCollarParentIDs=[2926, 3971],
                        replanParentEID=3970, template='policy-control', blockingProtectedCuts=[{}])])]))
        step = endpoint.next_collar_scope_obligation(result)
        self.assertEqual((step['status'], step['proposedParentCount']), ('expand', 114))
        limited = endpoint.next_collar_scope_obligation(result, max_parents=113)
        self.assertEqual(limited['status'], 'parent-budget')
        self.assertEqual(limited['additionalParentIDs'], [2926, 3971])
        self.assertFalse(limited['globallyNearestSolvableScopeProven'])
        self.assertEqual(len(result['summary']['selectedCollarParentIDs']), 112)
        result['protectedBoundaryCheck']['blockingInterfaces'] = []
        self.assertEqual(endpoint.next_collar_scope_obligation(result)['status'], 'no-evidenced-local-extension')

    def test_closure_rejects_retained_and_invalid_limits(self):
        selected = sorted(endpoint.ENDPOINT_PARENTS | set(endpoint.EXPANSION_112))
        result = dict(summary=dict(selectedCollarParentIDs=selected), parents=[], fixedInterfaces=[],
            protectedBoundaryCheck=dict(allProtectedPartitionsMatched=False, status='rejected',
                blockingInterfaces=[dict(interface={}, localExpansionAlternatives=[dict(
                    requiredAdditionalCollarParentIDs=[5049], replanParentEID=3970,
                    template='policy-control', blockingProtectedCuts=[{}])])]))
        with self.assertRaises(ValueError):
            endpoint.next_collar_scope_obligation(result)
        for limit in (257, 73, True):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                endpoint.next_collar_scope_obligation(result, max_parents=limit)

    def test_closure_stops_on_solved_or_search_limited_status(self):
        result = dict(summary=dict(selectedCollarParentIDs=sorted(endpoint.ENDPOINT_PARENTS)),
                      protectedBoundaryCheck=dict(allProtectedPartitionsMatched=True, status='matched-partitions'))
        self.assertEqual(endpoint.next_collar_scope_obligation(result)['status'], 'protected-partitions-matched')
        result['protectedBoundaryCheck'].update(allProtectedPartitionsMatched=False, status='search-budget-exhausted')
        self.assertEqual(endpoint.next_collar_scope_obligation(result)['status'], 'search-limited')

    def test_shared_solver_requires_opposite_full_partitions(self):
        interfaces = [dict(parents=[10, 20], edgeNodeIDs=[1, 2])]
        a = {(1, 2, 3, 4): (1, 2, 3, 4)}
        b = {(1, 2, 3, 4): (1, 4, 3, 2)}
        partitions = {(10, 0, 0): a, (20, 0, 0): a, (20, 1, 0): b}
        solved = endpoint.solve_shared_partitions({10: [0], 20: [0, 1]}, interfaces, partitions)
        self.assertTrue(solved['solved'])
        self.assertEqual(solved['assignment'], {10: 0, 20: 1})
        self.assertEqual(solved['matchedOrientedSharedQuadPairs'], 1)
        rejected = endpoint.solve_shared_partitions({10: [0], 20: [0]}, interfaces, partitions)
        self.assertFalse(rejected['solved'])
        self.assertTrue(rejected['failureWitnesses'])

    def test_shared_solver_empty_domain_cannot_be_a_plan(self):
        with self.assertRaisesRegex(ValueError, 'empty mesh task'):
            endpoint.solve_shared_partitions({}, [], {})
        result = endpoint.solve_shared_partitions({10: [], 20: [0]}, [], {})
        self.assertFalse(result['solved'])
        self.assertEqual(result['initialEmptyParents'], [10])
        self.assertEqual(result['searchNodes'], 0)

    def test_forest_objective_is_global_not_greedy(self):
        interfaces = [dict(parents=[10, 20], edgeNodeIDs=[1, 2])]
        a = {(1, 2, 3, 4): (1, 2, 3, 4)}
        b = {(5, 6, 7, 8): (5, 6, 7, 8)}
        partitions = {(10, 0, 0): a, (10, 1, 0): b,
                      (20, 0, 0): {k: endpoint._cycle(v[::-1]) for k, v in a.items()},
                      (20, 1, 0): {k: endpoint._cycle(v[::-1]) for k, v in b.items()}}
        result = endpoint.solve_shared_partitions({10: [0, 1], 20: [0, 1]}, interfaces, partitions,
            candidate_costs={10: {0: 0, 1: 2}, 20: {0: 10, 1: 0}})
        self.assertEqual(result['assignment'], {10: 1, 20: 1})
        self.assertTrue(result['forestObjectiveOptimized'])
        self.assertEqual(result['minimumAdditiveCost'], 2)

    @unittest.skipUnless(shutil.which('node'), 'Existing Node required')
    def test_production_sweep_library_orientations_and_pattern2_faces(self):
        library = endpoint.load_sweep_templates()
        self.assertEqual(len(library['templates']), 27)
        patterns = [t for t in library['templates'] if t['family'] == 'pattern2']
        self.assertEqual(len(patterns), 12)
        for t in patterns:
            refs = np.array(t['nodes']); faces = endpoint._template_faces(t)
            counts = [sum(np.all(refs[f, axis] == value) for f in faces)
                      for axis in range(3) for value in (-1, 1)]
            self.assertEqual(sorted(counts), [1, 1, 2, 2, 3, 3])
            self.assertEqual(len(t['elements']), 3)

    @unittest.skipUnless(os.environ.get('BOLTHEX_TEST_ROOT'), 'Explicit scratch required')
    def test_json_delivery_is_exclusive_and_bounded(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as folder:
            path = Path(folder)/'contract.json'
            endpoint.write_contract({'ok': True}, path)
            saved = path.read_bytes()
            with self.assertRaises(ValueError):
                endpoint.write_contract({'ok': False}, path)
            self.assertEqual(path.read_bytes(), saved)
            with patch.object(endpoint, 'MAX_REPORT_BYTES', 1):
                with self.assertRaises(ValueError):
                    endpoint.write_contract({'ok': True}, Path(folder)/'large.json')
            self.assertFalse((Path(folder)/'large.json').exists())


@unittest.skipUnless(all(os.environ.get(k) for k in ('SCREW_ORACLE_K', 'SCREW_PHASE_K', 'SCREW_COLLAR_DIR')),
                     'Explicit actual original, phase source and frozen collar required')
class ActualEndpointContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = endpoint.build_endpoint_contract(os.environ['SCREW_ORACLE_K'], os.environ['SCREW_PHASE_K'],
            os.environ['SCREW_COLLAR_DIR'], include_neck=True)
        cls.summary = cls.result['summary']
        cls.replan = endpoint.build_endpoint_contract(os.environ['SCREW_ORACLE_K'], os.environ['SCREW_PHASE_K'],
            os.environ['SCREW_COLLAR_DIR'], include_neck=True, core_port_policy='replan')

    @classmethod
    def tearDownClass(cls):
        for path, digest in cls.result['inputSHA256'].items():
            if endpoint.collar._sha(path) != digest:
                raise AssertionError('Read-only input changed: '+path)

    def test_complete_actual_patch_not_one_block(self):
        r = self.result
        self.assertEqual({p['parentEID'] for p in r['parents']}, endpoint.ENDPOINT_PARENTS)
        self.assertEqual(len(r['patchCells']), 518)
        self.assertEqual(len({c[0] for c in r['patchCells']}), 518)
        nodes = {p[0] for p in r['patchNodes']}
        self.assertTrue(all(set(c[2:]) <= nodes and len(set(c[2:])) == 8 for c in r['patchCells']))
        self.assertEqual(self.summary['configurationsTested'], 74*35)

    def test_rehashed_parent_report_cannot_swap_actual_inner_corners(self):
        folder = Path(os.environ['SCREW_COLLAR_DIR']).resolve()
        report_path, handoff_path = folder/'report.json', folder/'handoff.json'
        report = json.loads(report_path.read_bytes())
        changed = copy.deepcopy(report)
        parents = {p['eid']: p for p in changed['parentRecords']}
        parents[2889]['innerCoarseCorners'] = parents[2890]['innerCoarseCorners'][:]
        report_bytes = json.dumps(changed).encode()
        import hashlib
        digest = hashlib.sha256(report_bytes).hexdigest()
        handoff = json.loads(handoff_path.read_bytes())
        handoff['artifacts']['report.json']['sha256'] = digest
        handoff_bytes = json.dumps(handoff).encode()
        original_read, original_sha = Path.read_bytes, endpoint.collar._sha

        def read(path):
            return report_bytes if path == report_path else handoff_bytes if path == handoff_path else original_read(path)

        def sha(path):
            return digest if Path(path) == report_path else original_sha(path)

        with patch.object(Path, 'read_bytes', read), patch.object(endpoint.collar, '_sha', sha):
            with self.assertRaisesRegex(ValueError, 'Inner corner'):
                endpoint._load(os.environ['SCREW_ORACLE_K'], os.environ['SCREW_PHASE_K'], folder)

    def test_complete_patch_skin_partition(self):
        self.assertEqual(self.summary['patchSkinFaces'], 912)
        self.assertEqual(self.summary['fixedFaces'], 604)
        self.assertEqual(self.summary['variableAnnularFaces'], 308)
        self.assertEqual(self.summary['fixedRoles'], {'retained-tooth': 37, 'unchanged-collar': 234,
                                                    'external-valley': 37, 'inner-core-port': 296})
        for r in self.result['fixedInterfaces']:
            for other in r['oppositeOwners']:
                self.assertEqual(endpoint._cycle(r['binding']['nodeIDs']), endpoint._cycle(other['nodeIDs'][::-1]))

    def test_all_real_annular_patches_are_not_two_by_two(self):
        ends = self.result['variableEndpoints']
        self.assertEqual(len(ends), 76)
        self.assertEqual(sum(r['topology']['faces'] == 4 for r in ends), 72)
        self.assertEqual(sum(r['topology']['faces'] == 5 for r in ends), 4)
        self.assertTrue(all(not r['topology']['regularTwoByTwo'] for r in ends))
        self.assertTrue(all(len(r['outerBoundaryEdges']) == 1 and len(r['innerBoundaryEdges']) == 2 for r in ends))
        self.assertTrue(all(r['radialSourceParameterMapVerified'] for r in ends))

    def test_exact_source_ruling_obstructions_are_machine_bound(self):
        conflicts = self.result['conflicts']
        self.assertEqual(len(conflicts), 75)
        for c in conflicts:
            self.assertEqual(c['fixedOppositeEdgeCounts'], [1, 2])
            self.assertEqual(c['minimumChangedBoundaryChains'], 1)
            self.assertFalse(c['globalMinimumExpansionProven'])
            self.assertTrue(c['propagationBeyondListedEdgeStarUnresolved'])
            for option in c['localNecessaryScopeAlternatives']:
                self.assertTrue(option['mustChangeFaceBindings'])
                self.assertFalse(option['authorized'])
        lower = next(c for c in conflicts if c['source']['eid'] == 2912)
        self.assertTrue(lower['localNecessaryScopeAlternatives'][0]['requiredOutsidePatchEIDs'])

    def test_uniform8_actual_h8_quality_does_not_excuse_interface_changes(self):
        u = self.summary['uniform8']
        self.assertEqual((u['parentsTested'], u['prospectiveH8'], u['exactSourceSupportParents']), (74, 592, 74))
        self.assertEqual(u['fixedBoundaryPassParents'], 0)
        self.assertAlmostEqual(u['minimumCornerCenterSJ'], .6560552162180685, places=10)
        for parent in self.result['parents']:
            uniform = parent['candidates'][-1]
            self.assertEqual(uniform['template'], 'uniform8')
            self.assertTrue(uniform['sourceSupportPreservedByConstruction'])
            self.assertIn('FIXED_FACE_PARTITION_MISMATCH', uniform['rejectionCodes'])

    def test_transition_fixed_match_is_not_source_support_acceptance(self):
        candidates = [c for p in self.result['parents'] for c in p['candidates'][:-1]
                      if c['fixedFacesMatched'] == c['fixedFacesRequired']]
        self.assertTrue(candidates)
        self.assertTrue(all('SOURCE_Q4_POLYNOMIAL_IDENTITY_FAILED' in c['rejectionCodes'] for c in candidates))
        self.assertEqual(set(self.summary['emptyLocalTemplateDomains']), endpoint.ENDPOINT_PARENTS)
        self.assertEqual(self.summary['feasibility'], 'rejected')

    def test_contact_and_whole_repair_claims_are_withheld(self):
        for r in self.result['variableEndpoints']:
            self.assertFalse(r['certifiedPhysicalFree'])
            if r['end'] == 'lower':
                self.assertEqual(r['role'], 'variable-neck-contact-obligation')
        for key in ('sourceNodesMoved', 'sourceNIDsMerged', 'sourceDomainRelaxed', 'minimumSJThresholdRelaxed',
                    'allH8RepairAccepted', 'wholeScrewAccepted', 'globallyCompatibleConfigurationFound'):
            self.assertFalse(self.summary[key])

    def test_replan_relaxes_only_candidate_port(self):
        s = self.replan['summary']
        self.assertEqual(self.summary['corePortPolicy'], 'fixed')
        self.assertEqual(s['corePortPolicy'], 'replan')
        self.assertEqual(s['fixedFaces'], 308)
        self.assertEqual(s['replannableCorePortFaces'], 296)
        self.assertEqual(s['activeFixedPortRulingConflicts'], 0)
        self.assertEqual(len(self.replan['originalCorePortBindings']), 296)
        old = [r for r in self.result['fixedInterfaces'] if r['role'] != 'inner-core-port']
        self.assertEqual(old, self.replan['fixedInterfaces'])
        self.assertTrue(all(r['blocksSelectedPolicy'] is False for r in self.replan['conflicts']))

    def test_all_74_domains_are_compared_under_both_policies(self):
        self.assertEqual(self.summary['policyComparison'], self.replan['summary']['policyComparison'])
        for p in self.replan['parents']:
            self.assertTrue(set(p['fixedPolicyEligibleTemplates']) <= set(p['replanPolicyEligibleTemplates']))
        self.assertEqual({p['parentEID'] for p in self.replan['parents']}, endpoint.ENDPOINT_PARENTS)

    def test_conditional_assignment_never_claims_protected_plan(self):
        r = self.replan; c = r['collarExpansionDiagnostic']
        self.assertTrue(c['solved'])
        self.assertFalse(c['protectedBoundaryPlan'])
        self.assertFalse(c['scopeExpansionAuthorized'])
        self.assertFalse(c['sourceRetainedRegionExpansion'])
        self.assertEqual(set(c['assignment']), endpoint.ENDPOINT_PARENTS)
        self.assertGreater(c['matchedOrientedSharedQuadPairs'], 0)
        neighbours = set(c['requiredNeighbourCollarParentEIDs'])
        self.assertTrue(neighbours)
        self.assertTrue(neighbours <= set(endpoint.collar.BODY_IDS))
        self.assertFalse(neighbours & endpoint.ENDPOINT_PARENTS)
        self.assertTrue(c['forestObjectiveOptimized'])
        self.assertEqual(c['minimumAdditiveCost'], 10000*c['minimumChangedCutQuads']+c['prospectiveH8'])
        self.assertEqual(c['minimumChangedCutQuads'], 128)
        self.assertEqual(c['prospectiveH8'], 221)
        self.assertEqual(c['templateFamilies'], {'pattern4': 37, 'pattern1': 36, 'pattern2': 1})
        self.assertEqual(c['prospectiveCorePortQuads'], 147)
        self.assertEqual(c['prospectiveAnnularEndQuads'], 117)
        self.assertEqual(neighbours, {2925, 3970, 5012, *range(3933, 3968)})
        self.assertEqual(c['sharedMacroInterfaces'], 72)
        self.assertEqual(c['matchedOrientedSharedQuadPairs'], 144)
        for record in c['selectedCutChanges']:
            for cut in record['changedCutBindings']:
                self.assertTrue(cut['oppositeOwners'])
        self.assertFalse(r['summary']['allH8RepairAccepted'])
        self.assertFalse(r['summary']['wholeScrewAccepted'])

    def test_conditional_actual_shared_partitions_recomputed_independently(self):
        r = self.replan
        templates = endpoint.collar.load_repository_templates()['templates'] + endpoint.load_sweep_templates()['templates']
        frozen = json.loads((Path(os.environ['SCREW_COLLAR_DIR'])/'report.json').read_bytes())
        parents = {p['eid']: p for p in frozen['parentRecords']}
        assignment = r['collarExpansionDiagnostic']['assignment']; count = 0
        for row in r['sharedMacroInterfaces']:
            a, b = row['parents']
            pa = endpoint._partition(parents[a], templates[assignment[a]], row['edgeNodeIDs'])
            pb = endpoint._partition(parents[b], templates[assignment[b]], row['edgeNodeIDs'])
            self.assertTrue(endpoint.opposite_partitions(pa, pb)); count += len(pa)
        self.assertEqual(count, r['collarExpansionDiagnostic']['matchedOrientedSharedQuadPairs'])

    def test_changed_port_obligations_are_real_nids_not_a_fill(self):
        r = self.replan; nodes = {row[0] for row in r['patchNodes']}
        self.assertTrue(r['changedCorePortObligations'])
        for change in r['changedCorePortObligations']:
            self.assertFalse(change['coreFilled'])
            self.assertFalse(change['originalNIDsMerged'])
            self.assertTrue(all(set(q) <= nodes for q in change['proposedCollarOutwardQuads']))
            self.assertEqual([q[::-1] for q in change['proposedCollarOutwardQuads']], change['proposedCoreOutwardQuads'])

    def test_full_candidate_encoding_is_lossless_and_bounded(self):
        packed = endpoint.compact_contract(self.replan)
        self.assertEqual(endpoint.expand_contract(packed), self.replan)
        encoded = json.dumps(packed, separators=(',', ':'), allow_nan=False)
        self.assertLessEqual(len(encoded.encode()), endpoint.MAX_REPORT_BYTES)
        decoded = endpoint.expand_contract(json.loads(encoded))
        self.assertEqual(decoded['parents'], self.replan['parents'])


@unittest.skipUnless(all(os.environ.get(k) for k in ('SCREW_ORACLE_K', 'SCREW_PHASE_K', 'SCREW_COLLAR_DIR')),
                     'Explicit actual original, phase source and frozen collar required')
class ActualExpandedEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = endpoint.build_endpoint_contract(os.environ['SCREW_ORACLE_K'], os.environ['SCREW_PHASE_K'],
            os.environ['SCREW_COLLAR_DIR'], include_neck=True, core_port_policy='replan',
            expanded_collar_parent_ids=endpoint.EXPANSION_112)

    @classmethod
    def tearDownClass(cls):
        for path, digest in cls.result['inputSHA256'].items():
            if endpoint.collar._sha(path) != digest:
                raise AssertionError('Expanded study changed a source input')

    def test_exact_112_scope_without_added_free_ends(self):
        r = self.result; selected = endpoint.ENDPOINT_PARENTS | set(endpoint.EXPANSION_112)
        self.assertEqual(set(r['summary']['selectedCollarParentIDs']), selected)
        self.assertEqual({p['parentEID'] for p in r['parents']}, selected)
        self.assertEqual(len(r['patchCells']), 784)
        self.assertEqual(r['summary']['configurationsTested'], 112*35)
        self.assertEqual({e['source']['eid'] for e in r['variableEndpoints']}, endpoint.ENDPOINT_PARENTS)
        self.assertEqual(len(r['variableEndpoints']), 76)
        for p in r['parents']:
            if p['parentEID'] in endpoint.EXPANSION_112:
                self.assertTrue(all(c['endpointFaces'] == 0 for c in p['candidates']))
        self.assertEqual(r['protectedBoundaryCheck']['extraParentExternalEndFaces'], 0)

    def test_all_retained_and_unselected_collar_interfaces_protected(self):
        r = self.result
        self.assertEqual(r['summary']['fixedFaces'], 380)
        self.assertEqual(r['summary']['fixedRoles'], {'retained-tooth': 73, 'external-valley': 39, 'unchanged-collar': 268})
        self.assertEqual(r['summary']['replannableCorePortFaces'], 448)
        for record in r['fixedInterfaces']:
            for other in record['oppositeOwners']:
                self.assertEqual(endpoint._cycle(record['binding']['nodeIDs']), endpoint._cycle(other['nodeIDs'][::-1]))

    def test_112_positive_local_domains_do_not_make_a_plan(self):
        r = self.result; comparison = r['summary']['policyComparison']['replan']
        self.assertEqual(comparison['localNonemptyParents'], 112)
        self.assertEqual(comparison['totalLocalCandidates'], 236)
        solve = comparison['sharedPartitionSolve']
        self.assertEqual(solve['sharedMacroInterfaces'], 148)
        self.assertFalse(solve['solved']); self.assertFalse(solve['searchBudgetExhausted'])
        self.assertEqual(solve['initialEmptyParents'], [])
        self.assertEqual(r['protectedBoundaryCheck']['failureCode'], 'PROTECTED_SHARED_PARTITION_CONFLICT')
        self.assertFalse(r['protectedBoundaryCheck']['allProtectedPartitionsMatched'])
        self.assertFalse(r['protectedBoundaryCheck']['replacementPatchExported'])
        self.assertIsNone(r['protectedPartitionPlan'])
        self.assertEqual(r['changedCorePortObligations'], [])
        self.assertEqual(r['collarExpansionDiagnostic']['status'], 'not-run-explicit-expanded-scope-protected-only')

    def test_conflict_partitions_read_back_as_zero_compatible_pairs(self):
        witness = self.result['protectedBoundaryCheck']['blockingInterfaces'][0]
        self.assertEqual(witness['interface'], {'edgeNodeIDs': [6145, 6216], 'parents': [3969, 3970]})
        faces = {}
        for row in witness['candidatePartitions']:
            quads = [tuple((w, tuple(tuple(s) for s in support)) for w, support in q) for q in row['orientedSupportQuads']]
            faces[row['parentEID'], row['template']] = {endpoint._key(q): endpoint._cycle(q) for q in quads}
        left = [p for (eid, _), p in faces.items() if eid == 3969]
        right = [p for (eid, _), p in faces.items() if eid == 3970]
        self.assertEqual((len(left), len(right)), (4, 1))
        self.assertFalse(any(endpoint.opposite_partitions(a, b) for a in left for b in right))
        self.assertEqual(witness['protectedCompatiblePairCount'], 0)

    def test_next_scope_is_only_a_bound_local_alternative(self):
        r = self.result; selected = set(r['summary']['selectedCollarParentIDs'])
        check = r['protectedBoundaryCheck']; option = check['blockingInterfaces'][0]['smallestLocalAlternative']
        self.assertEqual(option['replanParentEID'], 3970)
        self.assertEqual(option['requiredAdditionalCollarParentIDs'], [2926, 3971])
        self.assertEqual(len(option['blockingProtectedCuts']), 8)
        self.assertFalse(option['expansionAuthorized']); self.assertTrue(option['localInterfaceOnly'])
        self.assertFalse(check['automaticScopeExpansion'])
        next_step = endpoint.next_collar_scope_obligation(r)
        self.assertEqual(next_step['status'], 'expand')
        self.assertEqual(next_step['additionalParentIDs'], [2926, 3971])
        self.assertEqual(next_step['proposedParentCount'], 114)
        for witness in check['blockingInterfaces']:
            self.assertFalse(witness['globallySufficientExpansionProven'])
            for candidate in witness['localExpansionAlternatives']:
                ids = set(candidate['requiredAdditionalCollarParentIDs'])
                self.assertTrue(ids <= set(endpoint.collar.BODY_IDS))
                self.assertFalse(ids & selected)
                for face in candidate['blockingProtectedCuts']:
                    self.assertTrue(face['oppositeOwners'])

    def test_full_scope_geometry_and_volume_are_not_plan_acceptance(self):
        audit = self.result['frozenPatchAudit']
        self.assertEqual(audit['frozenCells'], 784)
        self.assertEqual(audit['unchangedFrozenCompositeCells'], 18304)
        self.assertEqual(audit['unchangedCollarCells'], 14336)
        self.assertEqual(len(audit['perParentVolumeComparison']), 112)
        self.assertAlmostEqual(audit['macroVolume'], .36520179069467906, places=12)
        raw = audit['localCandidateRawMetrics']
        self.assertEqual(raw['count'], 236)
        self.assertGreater(raw['minimumCornerCenterSJ'], 0)
        self.assertLess(raw['minimumCornerCenterSJ'], .15)
        self.assertGreater(raw['maximumRelativeMacroIntegralDifference'], 1e-4)
        self.assertFalse(raw['isAssembledPlanQuality'])
        self.assertIsNone(audit['protectedPlanMetrics'])
        self.assertFalse(audit['geometryOrVolumeToleranceRelaxed'])
        self.assertFalse(self.result['summary']['wholeScrewAccepted'])


@unittest.skipUnless(os.environ.get('SCREW_CLOSURE_DIR'), 'Explicit bounded closure evidence required')
class ClosureEvidenceTests(unittest.TestCase):
    def test_every_round_is_monotone_body_only_and_protected(self):
        folder = Path(os.environ['SCREW_CLOSURE_DIR'])
        summary = json.loads((folder/'closure-summary.json').read_bytes())
        selected = endpoint.ENDPOINT_PARENTS | set(endpoint.EXPANSION_112) | {2926, 3971}
        previous = None; count = 0
        for path in sorted(folder.glob('round-*.json')):
            row = json.loads(path.read_bytes()); count += 1
            if previous is not None:
                self.assertEqual(previous['nextStep']['status'], 'expand')
                self.assertEqual(row['addedParentIDs'], previous['nextStep']['additionalParentIDs'])
                self.assertFalse(selected & set(row['addedParentIDs']))
                selected |= set(row['addedParentIDs'])
            self.assertEqual(row['parents'], len(selected))
            self.assertLessEqual(len(selected), 256)
            self.assertTrue(selected <= set(endpoint.collar.BODY_IDS))
            self.assertFalse(row['searchBudgetExhausted'])
            self.assertEqual(row['failureCode'], 'PROTECTED_SHARED_PARTITION_CONFLICT')
            previous = row
        self.assertEqual(count, summary['rounds'])
        self.assertEqual(sorted(selected), summary['selectedParentIDs'])
        self.assertEqual(summary['startParentCount'], 114)
        self.assertFalse(summary['originalRetainedRegionExpanded'])
        self.assertFalse(summary['generalHexImpossibilityProven'])

    def test_final_scope_replayed_without_caches_and_limit_not_waived(self):
        folder = Path(os.environ['SCREW_CLOSURE_DIR'])
        summary = json.loads((folder/'closure-summary.json').read_bytes())
        replay = json.loads((folder/'uncached-final-verification.json').read_bytes())
        self.assertTrue(replay['fullContractJsonEquivalent'])
        self.assertFalse(replay['replayUsedCaches'])
        self.assertTrue(replay['inputAndProducerHashesUnchanged'])
        self.assertEqual(summary['stopReason'], 'parent-budget')
        self.assertEqual(summary['actualLastParentCount'], 256)
        self.assertGreater(summary['nextUntestedObligation']['proposedParentCount'], 256)
        self.assertFalse(summary['nextUntestedObligation']['nextScopeSolved'])
        self.assertFalse(summary['globallyNearestSolvableScopeProven'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
