"""Mapped-collar topology/identity controls; no whole-Screw acceptance."""
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace
import shutil
import tempfile
import unittest
from unittest.mock import patch
import numpy as np

from tools.bolthex import screw_inward_collar as collar
from tools.bolthex.mesh_audit import FACES
from tools.bolthex.screw_interface import face_owners


def chart(columns=72):
    def nid(k,j):return 1+100*(j%36)+2*(j//36)+k
    return [dict(eid=100+j*2+k,band=k,column=j,
                 macro=[nid(k,j),nid(k+1,j),nid(k+1,j+1),nid(k,j+1)]) for j in range(columns) for k in (0,1)]


class ExplicitSearchPolicyTests(unittest.TestCase):
    def test_public_api_does_not_invent_a_default_engineering_sj_standard(self):
        with self.assertRaises(TypeError):collar.build_collar('missing.k','missing-phase.k')
        with self.assertRaises(TypeError):collar.generate('missing.k','missing-phase.k','new-output')

    def test_bad_search_floor_rejects_before_reading_sources_or_invoking_node(self):
        for value in (True,0.,-1.,float('nan'),1.1):
            with self.subTest(value=value),patch.object(collar,'read_parents',side_effect=AssertionError('source read')):
                with self.assertRaises(ValueError):collar.build_collar('missing.k','missing-phase.k',minimum_sj=value)

    @unittest.skipUnless(os.environ.get('BOLTHEX_TEST_ROOT'),'Explicit scratch required')
    def test_oversized_input_rejects_before_reading_contents(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as directory:
            p=Path(directory)/'probe.k';p.write_bytes(b'x')
            with patch.object(collar,'MAX_INPUT_BYTES',0),patch.object(Path,'open',side_effect=AssertionError('file read')):
                with self.assertRaisesRegex(ValueError,'oversized'):collar._sha(p)


@unittest.skipUnless(shutil.which('node'),'Existing Node and built repository templates required')
class TemplateControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.export=collar.load_repository_templates();cls.templates=cls.export['templates']

    def test_existing_repo_export_not_vendor_json(self):
        self.assertEqual(len(self.templates),8)
        self.assertEqual(len(self.export['rotations']),24)
        for t in self.templates:
            self.assertEqual((len(t['nodes']),len(t['elements'])),(23,7))
            self.assertEqual((len(t['coarse']),len(t['fine'])),(1,4))
        p=self.export['provenance']
        self.assertEqual(hashlib.sha256(Path(p['modulePath']).read_bytes()).hexdigest(),p['moduleSHA256'])

    def test_in_plane_quarter_point_cannot_be_rounded_to_a_wrong_support(self):
        changed=json.loads(json.dumps(self.export));changed['templates'][0]['nodes'][9][0]=-.5
        with patch.object(collar.subprocess,'run',return_value=SimpleNamespace(stdout=json.dumps(changed))):
            with self.assertRaisesRegex(ValueError,'half-grid'):collar.load_repository_templates('existing-node')

    def test_actual_chart_constraint_36_and_plus2_parity(self):
        parents=chart();scores=np.full((8,len(parents)),.7);gauss=np.ones_like(scores)
        choices,report,pairs,boundary=collar.solve_partitions(parents,self.templates,scores,gauss)
        self.assertTrue(report['solved']);self.assertEqual(len(choices),len(parents))
        graph,_,_=collar._lateral_graph(parents,self.templates)
        for p,neighbours in enumerate(graph):
            for q,allowed in neighbours:self.assertTrue(allowed[choices[p]]&(1<<choices[q]))
        self.assertTrue(any(abs(a['parents'][0]-a['parents'][1])>2 for a in pairs))
        self.assertEqual(len(boundary),76)

    def test_local_bad_parent_rejects_before_csp_search(self):
        parents=chart(2);scores=np.full((8,len(parents)),.7);gauss=np.ones_like(scores);scores[:,1]=.149
        choice,report,_,_=collar.solve_partitions(parents,self.templates,scores,gauss)
        self.assertIsNone(choice);self.assertEqual(report['searchNodes'],0)
        self.assertEqual(report['localImpossibleParentEids'],[parents[1]['eid']])

    def test_shared_entity_keys_are_ids_not_coordinates(self):
        a=[10,20,30,40];b=[20,50,60,30]
        self.assertEqual(collar._node_support([1,0,1],a),collar._node_support([-1,0,1],b))
        self.assertNotEqual(collar._node_support([0,0,1],a),collar._node_support([0,0,1],[110,120,130,140]))

    def test_proper_rotation_preserves_literal_coarse_face_cycle_in_localface4(self):
        for t in self.templates:
            ci,fi,q=t['coarse'][0];cell=t['elements'][ci]
            rotated=collar._preserve_outer_binding(cell,q,self.export['rotations'])
            self.assertEqual(np.array(rotated)[FACES[3]].tolist(),q)
            self.assertEqual(set(rotated),set(cell))

    def test_wrong_shared_macro_orientation_rejects(self):
        parents=chart(2);parents[1]['macro']=parents[1]['macro'][::-1]
        with self.assertRaises(ValueError):collar._lateral_graph(parents,self.templates)

    def test_invalid_ratio_rejects_before_node_allocation(self):
        for value in (True,0.,.99,float('nan')):
            with self.subTest(value=value),self.assertRaises(ValueError):collar.quality_matrix(None,[],self.templates,value)


@unittest.skipUnless(os.environ.get('SCREW_ORACLE_K') and os.environ.get('SCREW_PHASE_K') and shutil.which('node'),
                     'Explicit actual original and phase-compensated sources required')
class WholeSourceCollarTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rawpath=Path(os.environ['SCREW_ORACLE_K']);cls.phasepath=Path(os.environ['SCREW_PHASE_K'])
        cls.hashes=[collar._sha(p) for p in (cls.rawpath,cls.phasepath)]
        cls.result=collar.build_collar(cls.rawpath,cls.phasepath,radial_ratio=.6,minimum_sj=.15)
        cls.raw=collar.read_keyword(cls.rawpath)

    @classmethod
    def tearDownClass(cls):
        for p,h in zip((cls.rawpath,cls.phasepath),cls.hashes):
            if collar._sha(p)!=h:raise AssertionError('Readonly source changed')

    def test_whole_count_and_exact_outside_rows_and_original_node_rows(self):
        r=self.result;mesh=r['mesh'];report=r['report'];outside=~np.isin(self.raw.element_ids,collar.BODY_IDS)
        self.assertEqual((report['parentCount'],report['collarH8'],report['compositeH8']),(2160,15120,19088))
        for field in ('elements','element_ids','part_ids'):
            np.testing.assert_array_equal(getattr(mesh,field)[:6128][outside],getattr(self.raw,field)[outside])
        np.testing.assert_array_equal(mesh.nodes[:len(self.raw.nodes)],self.raw.nodes)
        np.testing.assert_array_equal(mesh.node_ids[:len(self.raw.node_ids)],self.raw.node_ids)

    def test_actual_hard_face_owner_cycle_and_original_binding(self):
        mesh=self.result['mesh'];owners=face_owners(mesh)
        self.assertEqual(len(self.result['report']['hardFaceAudit']),1080)
        for p in self.result['report']['parentRecords']:
            pair=owners[collar._key(p['nodeIDs'])]
            expected=dict(eid=p['eid'],pid=p['pid'],localFace=4,nodeIDs=p['nodeIDs'])
            self.assertIn(expected,pair)
            if p['retained'] is not None:
                self.assertEqual(len(pair),2);self.assertIn(p['retained'],pair)
                self.assertEqual(collar._cycle(pair[0]['nodeIDs']),collar._cycle(pair[1]['nodeIDs'][::-1]))

    def test_all_fine9_equal_weight_keys_and_actual_fine4_boundary(self):
        mesh=self.result['mesh'];lookup={int(n):p for n,p in zip(mesh.node_ids,mesh.nodes)};owners=face_owners(mesh)
        self.assertEqual(len(self.result['inner']),8640)
        for p in self.result['report']['parentRecords']:
            self.assertEqual(len(p['fine4CavityOutwardQuads']),4)
            for n,key in zip(p['fine9NodeIDs'],p['fine9SupportOriginalNodeIDs']):
                np.testing.assert_array_equal(lookup[n],np.mean([lookup[x] for x in key],axis=0))
            for q in p['fine4CollarOutwardQuads']:
                pair=owners[collar._key(q)];self.assertEqual(len(pair),1)
                self.assertEqual(collar._cycle(pair[0]['nodeIDs']),collar._cycle(q))

    def test_positive_metrics_are_not_legacy_or_engineering_acceptance(self):
        r=self.result['report'];q=r['qualityMetricReport']
        self.assertTrue(q['sampledPositiveJacobians'])
        self.assertGreater(q['historicalProjectScreen']['belowCount'],0)
        self.assertFalse(r['collarMeetsLegacyCorner8Screen'])
        self.assertFalse(q['engineeringQualityAccepted']);self.assertFalse(r['wholeScrewAccepted'])
        self.assertAlmostEqual(r['rawQualityMetrics']['trilinearCornerAndCentre9MinimumScaledJacobian'],.14476584291234454)

    def test_nonplanar_end_loops_and_source_end_obligations_remain_explicit(self):
        r=self.result['report'];self.assertEqual(len(r['endBoundaryLoops']),2)
        self.assertEqual([len(x['innerFineLoopNodeIDs']) for x in r['endBoundaryLoops']],[76,76])
        self.assertEqual([x['zRange'] for x in r['endBoundaryLoops']],[[0.,.4],[12.,12.4]])
        self.assertEqual(len(r['phaseSourcePhysicalEndObligations']),76)
        self.assertEqual(len(r['unresolvedEndpointCollarFaces']),308)
        for key in ('topBottomSolved','innerCoreFilled','axisRepaired','globalOverlapCertified','sourceDomainVolumePreserved'):
            self.assertFalse(r[key])


if __name__=='__main__':unittest.main(verbosity=2)
