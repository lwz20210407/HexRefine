"""New-file-only actual axis closure; no accepted dependency edits."""
from contextlib import redirect_stdout
from dataclasses import replace
from io import StringIO
import json
import os
from pathlib import Path
import tempfile
import unittest

import numpy as np

from tools.bolthex.mesh_audit import FACES
from tools.bolthex.truegrid_screw import ImportedSolids, read_keyword
from tools.bolthex.screw_axis_macro import (enumerate_adjacent_face_completions,
    fixed_corner_constraints, original_context, build_one_hex_closure, overlap_guard,
    main, _shape, _source_digest, survey_free_frontiers)


CUBE=np.array([[0,0,0],[1,0,0],[1,1,0],[0,1,0],
               [0,0,1],[1,0,1],[1,1,1],[0,1,1]],float)


def cubes(offset):
    nodes=np.vstack((CUBE,CUBE+np.asarray(offset)))
    return ImportedSolids(nodes,np.arange(16).reshape(2,8),np.arange(1,17),
        np.array([101,202]),np.array([1,2]),{'*ELEMENT_SOLID':2},'synthetic')


def l_shape():
    nodes=[];lookup={};cells=[]
    for offset in ([0,0,0],[1,0,0],[0,1,0]):
        cell=[]
        for point in CUBE+offset:
            key=tuple(point)
            if key not in lookup:lookup[key]=len(nodes);nodes.append(point)
            cell.append(lookup[key])
        cells.append(cell)
    return ImportedSolids(np.array(nodes),np.array(cells),np.arange(1,len(nodes)+1),
        np.arange(101,104),np.ones(3,dtype=np.int64),{'*ELEMENT_SOLID':3},'synthetic')


class CompletionTests(unittest.TestCase):
    def test_unit_cube_has_24_viable_oriented_face_placements(self):
        ids=np.arange(101,109);coordinates={int(n):p for n,p in zip(ids,CUBE)}
        result=enumerate_adjacent_face_completions(ids[FACES[0]],ids[FACES[5]],coordinates)
        self.assertEqual(result['chartCount'],24)
        self.assertFalse(result['allOneHexCompletionsBlocked'])
        self.assertAlmostEqual(result['bestFixedCornerSJ'],1)
        for chart in result['charts']:
            self.assertEqual(len(chart['fixedCorners']),2)
            self.assertEqual(len(chart['freeSlots1Based']),2)

    def test_fixed_corner_does_not_depend_on_free_vertices(self):
        coords={int(n):p for n,p in zip(range(8),CUBE)}
        slots=[0,1,2,3,4,None,None,7]
        fixed=fixed_corner_constraints(slots,coords)
        self.assertEqual(len(fixed),2)
        coords[99]=np.array([100.,-40.,-30.]);coords[98]=np.array([-30.,80.,40.])
        complete=fixed_corner_constraints([0,1,2,3,4,99,98,7],coords)
        by_node={r['nodeID']:r['scaledJacobian'] for r in complete}
        for row in fixed:self.assertEqual(row['scaledJacobian'],by_node[row['nodeID']])

    def test_opposite_or_inconsistently_oriented_faces_reject(self):
        ids=np.arange(8);coords=dict(enumerate(CUBE))
        with self.assertRaisesRegex(ValueError,'share exactly one edge'):
            enumerate_adjacent_face_completions(ids[FACES[0]],ids[FACES[1]],coords)
        with self.assertRaisesRegex(ValueError,'consistently oriented'):
            enumerate_adjacent_face_completions(ids[FACES[0]],ids[FACES[5]][::-1],coords)

    def test_shape_partition_and_derivative_sum(self):
        for q in ([-1,-1,-1],[0,0,0],[.2,-.3,.7]):
            shape,d=_shape(q)
            self.assertAlmostEqual(float(shape.sum()),1)
            self.assertGreaterEqual(shape.min(),0)
            np.testing.assert_allclose(d.sum(axis=0),0,atol=1e-15)

    def test_concave_l_shape_has_a_feasible_fixed_corner_frontier(self):
        result=survey_free_frontiers(l_shape())
        self.assertFalse(result['allSurveyedOneHexAppendsBlocked'])
        self.assertAlmostEqual(result['bestSurveyedFixedCornerSJ'],1)
        self.assertFalse(result['fullMacroAccepted'])


class OverlapTests(unittest.TestCase):
    def test_disjoint_boxes_have_a_sufficient_hull_certificate(self):
        result=overlap_guard(cubes([2,0,0]))
        self.assertTrue(result['absenceCertified'])
        self.assertTrue(result['overlapGuardPassed'])
        self.assertEqual(result['aabbSeparatedPairs'],1)

    def test_overlapping_regular_h8_get_a_real_two_reference_point_witness(self):
        result=overlap_guard(cubes([.5,0,0]))
        self.assertEqual(result['status'],'overlap-detected')
        self.assertFalse(result['absenceCertified'])
        self.assertFalse(result['overlapGuardPassed'])
        witness=result['witnesses'][0]
        self.assertEqual({witness['firstEID'],witness['secondEID']},{101,202})
        self.assertTrue(all(abs(v)<1 for v in witness['firstReference']))
        self.assertTrue(all(abs(v)<1 for v in witness['secondReference']))

    def test_invalid_h8_cannot_skip_to_a_fake_overlap_pass(self):
        mesh=cubes([2,0,0]);mesh.nodes[:8,0]*=-1
        result=overlap_guard(mesh)
        self.assertEqual(result['status'],'blocked-invalid-H8')
        self.assertFalse(result['absenceCertified'])
        self.assertFalse(result['overlapGuardPassed'])

    def test_oversized_pairwise_search_rejects_before_sampling(self):
        mesh=cubes([2,0,0])
        with self.assertRaisesRegex(ValueError,'64'):
            overlap_guard(replace(mesh,elements=np.tile(mesh.elements[:1],(65,1))))


@unittest.skipUnless(os.environ.get('SCREW_ORACLE_K'),'Opt-in actual original K')
class MeasuredMacroTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=read_keyword(Path(os.environ['SCREW_ORACLE_K']))
        cls.digest=_source_digest(cls.source)
        cls.context=original_context(cls.source)
        cls.candidate,cls.report,cls.proof=build_one_hex_closure(cls.source,cls.context)

    def test_actual_multiheight_axis_and_original_phase_are_used(self):
        contract=self.context['axisContract']
        self.assertEqual(len(contract['allAxisStations']),21)
        self.assertEqual(len(contract['physicalAxisStations']),16)
        self.assertEqual(len(contract['zeroAreaOnlyAxisNodeIDs']),5)
        self.assertEqual(len(contract['hardAxisNodeIDs']),3)
        self.assertEqual(contract['minimumSourceAxisPointNodeID'],3980)
        self.assertEqual(contract['phaseRelation']['turnOffsetColumns'],36)
        self.assertEqual(contract['phaseRelation']['phaseRowShift'],2)
        self.assertFalse(contract['phaseRelation']['sameLayerClosureApplied'])
        self.assertEqual(self.report['localSectorColumns'],6)
        self.assertFalse(self.report['crossTurnMacroTopologyCertified'])

    def test_real_nine_cell_macro_restores_corner_but_is_rejected(self):
        self.assertEqual(len(self.candidate.elements),9)
        self.assertIn(3980,self.candidate.node_ids)
        self.assertTrue(self.report['restoredOriginalCornerVertex'])
        self.assertFalse(self.report['replacementAccepted'])
        self.assertFalse(self.report['fullSourceDomainCoverageCertified'])
        self.assertFalse(self.report['quality']['meshOnlyAccepted'])
        self.assertLess(self.report['quality']['minimumCornerScaledJacobian'],0)
        self.assertGreater(self.report['relativeSignedSourceVolumeError'],1e-4)
        self.assertFalse(self.report['volumeGuardPassed'])

    def test_every_oriented_one_hex_completion_has_immutable_negative_corners(self):
        enumeration=self.proof['completionEnumeration']
        self.assertEqual(enumeration['chartCount'],24)
        self.assertTrue(enumeration['allOneHexCompletionsBlocked'])
        self.assertLess(enumeration['bestFixedCornerSJ'],-.08)
        expected={int(self.context['baseReport']['axisNodeIDs'][0]),int(self.context['baseReport']['newNodeIDs'][0])}
        for chart in enumeration['charts']:
            self.assertEqual({r['nodeID'] for r in chart['fixedCorners']},expected)
            self.assertTrue(all(not r['passesSJ'] for r in chart['fixedCorners']))
        self.assertTrue(enumeration['doesNotProveOriginalDomainIrreparable'])

    def test_all_actual_free_frontier_pairs_fail_without_changing_hard_faces(self):
        survey=survey_free_frontiers(self.context['base'],self.context['baseReport']['matchedRetainedFaces'])
        self.assertEqual(survey['freeFaceCount'],16)
        self.assertEqual(survey['adjacentPairCount'],23)
        self.assertTrue(survey['allSurveyedOneHexAppendsBlocked'])
        self.assertLess(survey['bestSurveyedFixedCornerSJ'],.15)
        self.assertFalse(survey['fullMacroAccepted'])
        self.assertTrue(survey['doesNotProveOriginalDomainIrreparable'])

    def test_two_frontiers_are_actual_complete_shared_faces(self):
        self.assertEqual(len(self.report['frontierActualOwners']),2)
        for pair in self.report['frontierActualOwners']:
            self.assertEqual(len(pair),2)
            self.assertIn(9,{row['eid'] for row in pair})
            self.assertEqual(set(pair[0]['nodeIDs']),set(pair[1]['nodeIDs']))

    def test_invalid_axis_chart_leaves_overlap_uncertified_and_source_unchanged(self):
        result=overlap_guard(self.candidate)
        self.assertFalse(result['overlapGuardPassed'])
        self.assertFalse(result['absenceCertified'])
        self.assertEqual(self.digest,_source_digest(self.source))
        original={int(n):p for n,p in zip(self.source.node_ids,self.source.nodes)}
        for nid,point in zip(self.candidate.node_ids,self.candidate.nodes):
            if int(nid) in original:np.testing.assert_array_equal(point,original[int(nid)])

    def test_cli_exports_real_rejected_macro_without_touching_frozen_dependencies(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT'),prefix='axis-macro-') as directory:
            output=Path(directory)/'case'
            with redirect_stdout(StringIO()):
                self.assertEqual(main([os.environ['SCREW_ORACLE_K'],str(output)]),2)
            summary=json.loads((output/'summary.json').read_text())
            self.assertEqual(summary['candidateH8'],9)
            self.assertEqual(summary['localAssemblyH8'],17)
            self.assertEqual(summary['exactRetainedInterfaceFaces'],8)
            self.assertEqual(summary['surveyedFreeFrontierPairs'],23)
            self.assertTrue(summary['allSurveyedOneHexAppendsBlocked'])
            self.assertEqual(summary['originalNoncollapsedBadCount'],2328)
            self.assertEqual(summary['sourceCellsDeleted'],0)
            self.assertTrue(summary['allSourceArraysUnchanged'])
            self.assertTrue(summary['frozenDependenciesUnchanged'])
            self.assertFalse(summary['replacementAccepted'])
            self.assertIn('REJECTED AXIS MACRO',(output/'axis-macro-candidate.inp').read_text())
            actual=read_keyword(output/'axis-macro-candidate.k')
            np.testing.assert_array_equal(actual.elements,self.candidate.elements)
            np.testing.assert_array_equal(actual.node_ids,self.candidate.node_ids)


if __name__=='__main__':unittest.main()
