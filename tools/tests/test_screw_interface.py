"""Exact shared-face skin, geometric constraints and measured helical phase."""
from contextlib import redirect_stdout
from dataclasses import replace
from io import StringIO
import json
import os
from pathlib import Path
import tempfile
import unittest

import numpy as np

from tools.bolthex.screw_interface import (attachment_probe, axial_phase_constraints,
    extract_cavity, face_geometry, face_owners, main, skin_topology, trace_interface_strip,
    small_segment_cavity, solid_segment_candidate, phase_extent_chart, separating_plane_witness,
    candidate_neighbour_assembly)
from tools.bolthex.truegrid_screw import ImportedSolids, read_keyword


def pair():
    cube=np.array([[0,0,0],[1,0,0],[1,1,0],[0,1,0],
                   [0,0,1],[1,0,1],[1,1,1],[0,1,1]],float)
    points=[];lookup={};cells=[]
    for coords in (cube,cube+[1,0,0]):
        cell=[]
        for point in coords:
            key=tuple(point)
            if key not in lookup:lookup[key]=len(points);points.append(point)
            cell.append(lookup[key])
        cells.append(cell)
    return ImportedSolids(np.array(points),np.array(cells),np.arange(11,23),
        np.array([101,202]),np.array([7,8]),{'*ELEMENT_SOLID':2},'synthetic')


class IncidenceTests(unittest.TestCase):
    def test_selected_retained_bindings_and_full_cube_boundary(self):
        mesh=pair(); spec=extract_cavity(mesh,[101])
        self.assertEqual(len(spec['boundary']),6)
        self.assertEqual(len(spec['interface']),1)
        face=spec['interface'][0]
        self.assertEqual(face['selected']['eid'],101)
        self.assertEqual(face['selected']['pid'],7)
        self.assertEqual(face['selected']['localFace'],4)
        self.assertEqual(face['retained']['eid'],202)
        self.assertEqual(face['retained']['localFace'],6)
        self.assertEqual(set(face['selected']['nodeIDs']),set(face['retained']['nodeIDs']))
        self.assertEqual(spec['topology']['euler'],2)
        self.assertTrue(spec['topology']['closed'])
        self.assertTrue(spec['topology']['idManifold'])
        self.assertEqual(spec['topology']['edgeIncidenceHistogram'],{2:12})
        self.assertAlmostEqual(spec['signedSkinVolume'],1)
        self.assertLess(spec['relativeSourceSkinVolumeError'],1e-12)

    def test_interface_is_open_quad_not_assumed_periodic(self):
        spec=extract_cavity(pair(),[101])
        topology=spec['interfaceTopology']
        self.assertFalse(topology['closed'])
        self.assertEqual(len(topology['boundaryLoops']),1)
        self.assertEqual(len(topology['boundaryLoops'][0]),4)
        self.assertEqual(topology['euler'],1)

    def test_all_cells_cavity_removes_internal_face_from_skin_only(self):
        spec=extract_cavity(pair(),[101,202])
        self.assertEqual(len(spec['boundary']),10)
        self.assertEqual(spec['internalSelectedFaces'],1)
        self.assertEqual(spec['interface'],[])
        self.assertEqual(spec['sourceElementCount'],2)
        self.assertEqual(spec['deletedElements'],0)
        self.assertAlmostEqual(spec['signedSkinVolume'],2)

    def test_bad_selection_rejects(self):
        for ids in ([],[999],[101,999]):
            with self.subTest(ids=ids),self.assertRaises(ValueError):extract_cavity(pair(),ids)

    def test_three_face_owners_reject(self):
        m=pair()
        bad=replace(m,elements=np.vstack((m.elements,m.elements[:1])),
                    element_ids=np.array([101,202,303]),part_ids=np.array([7,8,9]))
        with self.assertRaisesRegex(ValueError,'nonmanifold'):
            extract_cavity(bad,[101])

    def test_crossed_shared_quad_is_not_identical_to_cyclic_face(self):
        m=pair();cells=m.elements.copy()
        cells[1,[0,3]]=cells[1,[3,0]]
        with self.assertRaisesRegex(ValueError,'cyclic edge order'):face_owners(replace(m,elements=cells))


class SkinTests(unittest.TestCase):
    def test_vertex_pinch_is_not_edge_manifold_enough(self):
        skin=skin_topology([[1,2,3,4],[1,5,6,7]])
        self.assertFalse(skin['idManifold'])
        self.assertIn(1,skin['nonmanifoldVertices'])
        self.assertEqual(skin['nonmanifoldEdges'],[])

    def test_nonmanifold_edge_and_wrong_orientation_reject(self):
        nonmanifold=skin_topology([[1,2,3,4],[2,1,5,6],[1,2,7,8]])
        self.assertIn([1,2],nonmanifold['nonmanifoldEdges'])
        orientation=skin_topology([[1,2,3,4],[1,2,5,6]])
        self.assertIn([1,2],orientation['orientationErrors'])
        self.assertFalse(orientation['idManifold'])

    def test_sj_upper_bound_from_fixed_face_is_necessary_not_sufficient(self):
        points={1:np.array([0,0,0]),2:np.array([1,0,0]),3:np.array([11,1,0]),4:np.array([10,1,0])}
        geometry=face_geometry([1,2,3,4],points)
        self.assertGreater(geometry['q4Area'],0)
        self.assertLess(geometry['minimumPossibleCornerSJUpperBound'],.15)
        points={i:np.array([0,0,i]) for i in range(1,5)}
        collapsed=face_geometry([1,2,3,4],points)
        self.assertEqual(collapsed['q4Area'],0)
        self.assertEqual(collapsed['minimumPossibleCornerSJUpperBound'],0)

    def test_separating_halfspace_bounds_every_trilinear_cell(self):
        nodes=pair().nodes+np.array([2,0,0])
        witness=separating_plane_witness([0,0,0],nodes,[1,0,0])
        self.assertAlmostEqual(witness['minimumDistanceLowerBound'],2,places=10)
        scaled=separating_plane_witness([0,0,0],nodes,[10,0,0])
        self.assertEqual(witness['minimumDistanceLowerBound'],scaled['minimumDistanceLowerBound'])
        self.assertEqual(separating_plane_witness([3,0,0],nodes,[1,0,0])['minimumDistanceLowerBound'],0)

    def test_invalid_halfspace_inputs_reject(self):
        for point,nodes,normal in (([0,0],np.zeros((8,3)),[1,0,0]),
            ([0,0,0],np.zeros((8,3)),[0,0,0]),([0,0,0],np.zeros((8,3)),[np.nan,0,0])):
            with self.subTest(normal=normal),self.assertRaises(ValueError):
                separating_plane_witness(point,nodes,normal)


@unittest.skipUnless(os.environ.get('SCREW_ORACLE_K'),'Opt-in original measured K')
class MeasuredTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=read_keyword(Path(os.environ['SCREW_ORACLE_K']))
        selected=cls.source.element_ids[(cls.source.element_ids>=2817)&(cls.source.element_ids<=5048)]
        cls.cavity=extract_cavity(cls.source,selected)
        cls.strip=trace_interface_strip(cls.cavity)
        cls.phase=axial_phase_constraints(cls.cavity,cls.strip)
        cls.small=small_segment_cavity(cls.source,cls.cavity,cls.strip)
        cls.solid,cls.solid_report=solid_segment_candidate(cls.source,cls.cavity,cls.strip,cls.small)

    def test_complete_source_cavity_and_actual_tooth_interface(self):
        c=self.cavity
        self.assertEqual(c['selectedElementCount'],2232)
        self.assertEqual(len(c['retainedEIDs']),3896)
        self.assertEqual(len(c['boundary']),6704)
        self.assertEqual(len(c['interface']),1080)
        self.assertEqual(len(c['zeroAreaBoundaryFaceIndices']),2232)
        self.assertLess(c['relativeSourceSkinVolumeError'],1e-12)
        self.assertTrue(all(r['selected']['localFace']==4 and r['retained']['localFace']==6 for r in c['interface']))
        self.assertEqual(c['deletedElements'],0)

    def test_manifold_id_skin_does_not_certify_geometric_embedding(self):
        c=self.cavity
        self.assertTrue(c['topology']['idManifold'])
        self.assertTrue(c['topology']['closed'])
        self.assertEqual(c['topology']['euler'],4)
        self.assertEqual(len(c['topology']['components']),2)
        self.assertFalse(c['geometricEmbeddingAccepted'])
        self.assertTrue(c['interfaceTopology']['idManifold'])
        self.assertEqual(c['interfaceTopology']['euler'],1)
        self.assertEqual(len(c['interfaceTopology']['boundaryLoops'][0]),2162)

    def test_three_phase_rows_are_bound_to_actual_shared_edge_chain(self):
        strip=self.strip
        self.assertEqual(np.shape(strip['rootWallNodeIDs']),(3,1081))
        self.assertEqual(len(set(strip['interfaceFaceOrder'])),1080)
        self.assertEqual(len(set(strip['valleyBoundaryFaceOrder'])),1080)

    def test_full_turn_advances_two_axial_rows_not_same_row(self):
        phase=self.phase
        self.assertEqual(phase['turnOffsetColumns'],36)
        self.assertEqual(phase['phaseRowShift'],2)
        self.assertAlmostEqual(phase['measuredTurnAdvanceZ'],.4)
        self.assertGreater(phase['sameLayerDistance'],.39)
        self.assertLess(phase['nextPhaseDistance'],2e-6)
        self.assertEqual(len(phase['candidateLinks']),1045)
        self.assertEqual(phase['actualIDSharedLinks'],0)
        self.assertEqual(phase['linksWithin2e6'],24)
        self.assertFalse(phase['allLinksWithin2e6'])
        for pair in phase['candidateLinks']:
            self.assertIn(pair['advancedNodeID'],pair['advancedBinding']['nodeIDs'])
            self.assertIn(pair['nextPhaseNodeID'],pair['nextPhaseBinding']['nodeIDs'])
        self.assertEqual(len(phase['phaseCapFaceCandidates']),1044)
        self.assertTrue(all(r['oppositeCyclicOrientation'] for r in phase['phaseCapFaceCandidates']))
        self.assertEqual(phase['actualIDSharedCapFaces'],0)
        for face in phase['phaseCapFaceCandidates']:
            self.assertEqual(set(face['nextNodeIDsInAdvancedFaceOrder']),set(face['nextPhaseBinding']['nodeIDs']))

    def test_fixed_real_interface_supports_good_attachment_but_not_hollow_core_acceptance(self):
        original=self.source.nodes.copy()
        probe,report=attachment_probe(self.source,self.cavity,self.strip)
        self.assertEqual(len(probe.elements),6)
        self.assertGreaterEqual(report['quality']['minimumCornerScaledJacobian'],.15)
        self.assertTrue(report['innerCavityUnfilled'])
        self.assertFalse(report['adjacentSourceCoreCutFacesMatched'])
        self.assertFalse(report['originalScrewAccepted'])
        np.testing.assert_array_equal(self.source.nodes,original)
        lookup={int(n):xyz for n,xyz in zip(probe.node_ids,probe.nodes)}
        source_lookup={int(n):xyz for n,xyz in zip(self.source.node_ids,self.source.nodes)}
        for binding in report['sourceInterfaceBindings']:
            for n in binding['selected']['nodeIDs']:
                np.testing.assert_array_equal(lookup[n],source_lookup[n])

    def test_solid_candidate_fills_axis_and_matches_all_eight_hard_faces(self):
        solid,report=self.solid,self.solid_report
        self.assertEqual(len(solid.elements),8)
        self.assertTrue(report['candidateH8Audit']['meshOnlyAccepted'])
        self.assertEqual(report['candidateH8Audit']['uniquePositionHistogram'],{8:8})
        self.assertGreaterEqual(report['candidateH8Audit']['minimumCornerScaledJacobian'],.15)
        self.assertTrue(report['innerCoreFilled'])
        self.assertEqual(len(report['matchedRetainedFaces']),8)
        self.assertLess(report['relativeSourceVolumeError'],1e-4)
        source={int(n):point for n,point in zip(self.source.node_ids,self.source.nodes)}
        for n,point in zip(solid.node_ids,solid.nodes):
            if int(n) in source:np.testing.assert_array_equal(point,source[int(n)])

    def test_volume_and_hard_faces_do_not_hide_a_changed_free_end_domain(self):
        report=self.solid_report;witness=report['sourceCornerCoverageWitness']
        self.assertEqual(witness['sourceNodeID'],3980)
        self.assertGreater(witness['minimumDistanceLowerBound'],.02)
        self.assertGreaterEqual(len(witness['sourcePhysicalFaceBindings']),2)
        self.assertTrue(np.all(self.solid.nodes@np.array(witness['unitNormal'])>=witness['offset']))
        self.assertIn(3980,report['omittedSelectedBoundaryNodeIDs'])
        self.assertFalse(report['sourceDomainPreserved'])
        self.assertFalse(report['sourceDomainAccepted'])
        self.assertFalse(report['replacementAccepted'])
        self.assertFalse(report['globalReplacementApplied'])

    def test_phase_extent_search_is_not_macro_acceptance(self):
        chart=phase_extent_chart(self.source,self.strip)
        self.assertEqual([r['phaseAligned'] for r in chart['windows']],[False,True,True])
        self.assertEqual([r['nearestHalfPhaseShift'] for r in chart['windows']],[0,1,2])
        self.assertTrue(all(not r['coreMacroVerified'] for r in chart['windows']))
        json.dumps(chart,allow_nan=False)
        json.dumps(self.solid_report,allow_nan=False)

    def test_solid_candidate_really_shares_faces_with_retained_neighbours(self):
        assembly,report=candidate_neighbour_assembly(self.source,self.solid,self.solid_report['matchedRetainedFaces'])
        self.assertEqual(len(assembly.elements),16)
        self.assertEqual(report['exactSharedFaceCount'],8)
        self.assertEqual(len(report['retainedOriginalEIDs']),8)
        self.assertFalse(report['quality']['meshOnlyAccepted'])
        self.assertTrue({2895,3975}<=set(report['quality']['badCornerElementIDs']))
        self.assertFalse(report['globalReplacementApplied'])
        for face in report['sharedHardFaces']:
            self.assertEqual(len(face['actualOwners']),2)
            self.assertEqual(set(face['actualOwners'][0]['nodeIDs']),set(face['actualOwners'][1]['nodeIDs']))

    def test_local_coupling_rejects_moved_existing_node(self):
        points=self.solid.nodes.copy();points[0,0]+=1e-5
        with self.assertRaisesRegex(ValueError,'retained source node'):
            candidate_neighbour_assembly(self.source,replace(self.solid,nodes=points),self.solid_report['matchedRetainedFaces'])

    def test_invalid_fan_and_segment_inputs_reject(self):
        for value in (0,1,float('nan')):
            with self.subTest(value=value),self.assertRaises(ValueError):
                solid_segment_candidate(self.source,self.cavity,self.strip,self.small,value)
        with self.assertRaises(ValueError):small_segment_cavity(self.source,self.cavity,self.strip,0)
        with self.assertRaises(ValueError):small_segment_cavity(self.source,self.cavity,self.strip,37)

    def test_cli_exit_two_retains_other_2328_bad_cells_and_machine_bindings(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT'),prefix='interface-test-') as directory:
            output=Path(directory)/'case'
            with redirect_stdout(StringIO()):
                self.assertEqual(main([os.environ['SCREW_ORACLE_K'],str(output)]),2)
            summary=json.loads((output/'summary.json').read_text())
            self.assertEqual(summary['originalNoncollapsedBadCount'],2328)
            self.assertEqual(len(summary['originalNoncollapsedBadEIDs']),2328)
            self.assertFalse(summary['finiteConformingAxisCoreCompleted'])
            self.assertFalse(summary['globalReplacementApplied'])
            small=json.loads((output/'small-cavity.json').read_text())
            self.assertEqual(small['selectedElementCount'],12)
            self.assertEqual(len(small['boundary']),40)
            self.assertEqual(len(small['zeroAreaBoundaryFaceIndices']),12)
            self.assertTrue((output/'attachment-probe.k').is_file())
            self.assertTrue((output/'attachment-probe.inp').is_file())
            self.assertIn('INNER CORE UNFILLED',(output/'attachment-probe.inp').read_text())
            solid=json.loads((output/'solid-segment-candidate.json').read_text())
            self.assertTrue(solid['innerCoreFilled'])
            self.assertFalse(solid['replacementAccepted'])
            self.assertIn('REJECTED SOURCE-DOMAIN CANDIDATE',(output/'solid-segment-candidate.inp').read_text())
            self.assertEqual(summary['solidCandidateH8'],8)
            self.assertFalse(summary['solidCandidateSourceDomainAccepted'])
            self.assertEqual(summary['localAssemblyH8'],16)
            self.assertEqual(summary['localAssemblySharedHardFaces'],8)
            self.assertFalse(summary['localAssemblyAccepted'])


if __name__=='__main__':unittest.main()
