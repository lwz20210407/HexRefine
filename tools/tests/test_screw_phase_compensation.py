"""Whole original-source periodic compensation, never a false axis acceptance."""
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
import numpy as np

from tools.bolthex import screw_phase_compensation as phase
from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy
from tools.bolthex.truegrid_screw import read_keyword


class PhaseCompensationGuards(unittest.TestCase):
    def test_requires_explicit_validated_policy_before_touching_input(self):
        for value in (None,False,'engineering',{}):
            with self.subTest(value=value),self.assertRaises(ValueError):phase.compensate('missing.k',value)

    def test_policy_subclass_overrides_are_removed_by_base_field_validation(self):
        class Overridden(CadAccuracyPolicy):
            def distance_budget_mm(self,**kwargs):return float('nan')
            def carrier_limits(self,**kwargs):return {'relativeStepBrepVolumeError':float('inf')}
            def manifest(self,**kwargs):return {'completeSourceMeshAccepted':True}
        value=Overridden.engineering(.001)
        policy=phase._validated_policy(value)
        self.assertIs(type(policy),CadAccuracyPolicy)
        self.assertEqual(policy.distance_budget_mm(critical=True),1e-5)
        self.assertEqual(policy.carrier_limits()['relativeStepBrepVolumeError'],1e-4)
        self.assertNotIn('completeSourceMeshAccepted',policy.manifest())

    def test_corrupted_or_unrepresentable_policy_rejects_before_source_paths(self):
        for field,value in (('units','in'),('target_size_mm',True),('target_size_mm',float('nan')),
                            ('target_size_mm',float.fromhex('0x0.0000000000001p-1022'))):
            policy=CadAccuracyPolicy.engineering(.2)
            object.__setattr__(policy,field,value)
            with self.subTest(field=field,value=value),patch.object(phase,'Path',side_effect=AssertionError('input before policy')):
                with self.assertRaises(ValueError):phase.compensate('missing.k',policy)

    def test_new_corner_gauss_or_volume_failures_cannot_hide_in_an_existing_bad_set(self):
        keys=('badCornerElementIDs','badCenterElementIDs','badGaussElementIDs','nonpositiveVolumeElementIDs')
        for key in keys:
            before={k:[1] for k in keys};after={k:[1] for k in keys};after[key]=[1,2]
            with self.subTest(key=key),self.assertRaises(ValueError):
                phase._check_quality_regression(before,after,np.array([.2]),np.array([.2]))

    def test_corner_sign_regression_is_not_waived_by_the_sj_epsilon(self):
        audit={key:[] for key in ('badCornerElementIDs','badGaussElementIDs','nonpositiveVolumeElementIDs')}
        for old,new in ((5e-13,0.),(0.,-5e-13),(5e-13,-5e-13),(.2,.1),(.2,float('nan'))):
            with self.subTest(old=old,new=new),self.assertRaises(ValueError):
                phase._check_quality_regression(audit,audit,np.array([old]),np.array([new]))
        phase._check_quality_regression(audit,audit,np.array([0.,.2]),np.array([0.,.2]))

    def test_new_nonmanifold_face_cannot_hide_below_an_existing_global_maximum(self):
        def owners(ids,node_ids):
            return [dict(eid=eid,pid=1,localFace=1,nodeIDs=node_ids) for eid in ids]
        old={(1,2,3,4):owners((1,2,3),[1,2,3,4])}
        new=dict(old);new[(5,6,7,8)]=owners((4,5,6),[5,6,7,8])
        self.assertEqual(max(map(len,old.values())),max(map(len,new.values())))
        with self.assertRaisesRegex(ValueError,'nonmanifold'):phase._check_face_regression(old,new)
        phase._check_face_regression(old,dict(old))

    def test_new_two_owner_face_requires_opposite_cyclic_orientation(self):
        first=dict(eid=1,pid=1,localFace=1,nodeIDs=[1,2,3,4])
        same=dict(eid=2,pid=1,localFace=2,nodeIDs=[2,3,4,1])
        opposite=dict(same,nodeIDs=[4,3,2,1])
        with self.assertRaisesRegex(ValueError,'oriented'):phase._check_face_regression({}, {(1,2,3,4):[first,same]})
        phase._check_face_regression({}, {(1,2,3,4):[first,opposite]})

    @unittest.skipUnless(os.environ.get('BOLTHEX_TEST_ROOT'),'Explicit scratch required')
    def test_unknown_source_rejects_before_reader_and_existing_output_is_preserved(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as folder:
            root=Path(folder);source=root/'unknown.k';source.write_bytes(b'NOT ORIGINAL')
            policy=CadAccuracyPolicy.engineering(.2)
            with patch.object(phase,'read_keyword') as reader,self.assertRaises(ValueError):phase.compensate(source,policy)
            reader.assert_not_called();target=root/'existing';target.mkdir();sentinel=target/'keep.txt';sentinel.write_text('KEEP')
            with patch.object(phase,'compensate') as operation,self.assertRaises(ValueError):phase.generate(source,target,policy)
            operation.assert_not_called();self.assertEqual(sentinel.read_text(),'KEEP')


@unittest.skipUnless(os.environ.get('SCREW_ORACLE_K'),'Actual readonly original K required')
class OriginalPhaseCompensationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path=Path(os.environ['SCREW_ORACLE_K']);cls.digest=hashlib.sha256(cls.path.read_bytes()).hexdigest()
        cls.source=read_keyword(cls.path)
        cls.mesh,cls.report=phase.compensate(cls.path,CadAccuracyPolicy.engineering(.2))
        cls.mask=np.isin(cls.source.element_ids,phase.BODY_IDS)

    @classmethod
    def tearDownClass(cls):
        if hashlib.sha256(cls.path.read_bytes()).hexdigest()!=cls.digest:raise AssertionError('Original source changed')

    def test_entire_known_body_not_a_small_patch_is_processed(self):
        r=self.report
        self.assertEqual((r['originalSolids'],r['selectedSourceSolids'],r['retainedOutsideSolids']),(6128,2160,3968))
        self.assertEqual((r['measuredTurnColumns'],r['measuredPhaseRowShift'],r['measuredTurnAdvanceZ']),(36,2,.4))
        self.assertEqual((r['measuredRootCorrespondences'],r['measuredPhaseFacePairs']),(1045,1044))
        self.assertTrue(r['phaseCompensationValidated'])

    def test_all_original_coordinate_rows_ids_and_retained_elements_are_exact(self):
        for field in ('nodes','node_ids','element_ids','part_ids'):
            np.testing.assert_array_equal(getattr(self.mesh,field),getattr(self.source,field))
        np.testing.assert_array_equal(self.mesh.elements[~self.mask],self.source.elements[~self.mask])
        self.assertGreater(self.report['redirectedNodeReferences'],0)
        self.assertEqual(self.report['sourceNodeCoordinateRowsChanged'],0)
        self.assertTrue(self.report['outsideElementsExactlyUnchanged'])

    def test_exact_shared_faces_replace_internal_id_gaps_without_nearest_coordinate_welding(self):
        r=self.report
        self.assertTrue(r['phaseFacesSharedByExactIDs'])
        self.assertEqual(len(r['matchedPhaseFaces']),1044)
        self.assertEqual(r['unmatchedIDFacesBefore']-r['unmatchedIDFacesAfter'],2088)
        self.assertFalse(r['globalCoordinateNearestWeldUsed'])
        self.assertTrue(r['measuredTopologicalIdentificationsApplied'])
        for group in r['aliasClasses']:
            self.assertIn(group['canonicalOriginalNodeID'],group['sourceNodeIDs'])
            self.assertLessEqual(group['maximumReferenceDisplacementMm'],.0005)

    def test_whole_trilinear_image_displacement_is_bounded_but_volume_is_not_falsely_exact(self):
        r=self.report;delta=np.linalg.norm(self.mesh.nodes[self.mesh.elements]-self.source.nodes[self.source.elements],axis=2)
        self.assertEqual(float(delta.max()),r['maximumSelectedTrilinearImageDisplacementBoundMm'])
        self.assertAlmostEqual(r['maximumMeasuredPairGapMm'],.0003128283839313748)
        self.assertLessEqual(float(delta.max()),.0005)
        self.assertTrue(np.all(delta[~self.mask]==0))
        self.assertGreater(r['relativeIntegratedCellVolumeChange'],0)
        self.assertLessEqual(r['relativeIntegratedCellVolumeChange'],1e-4)
        self.assertEqual(r['newNonpositiveGaussCells'],[]);self.assertEqual(r['newNonpositiveVolumeCells'],[])

    def test_axis_quality_failure_cannot_be_relabelled_as_completed(self):
        r=self.report
        self.assertEqual(r['selectedMinimumCornerSJBefore'],0.)
        self.assertEqual(r['selectedMinimumCornerSJAfter'],0.)
        self.assertGreater(r['remainingBadCornerSolids'],0)
        for key in ('axisRepaired','finiteAxisCoreInserted','completeSourceMeshAccepted','globalOverlapCertified'):
            self.assertIs(r[key],False)
        self.assertFalse(r['quality']['meshOnlyAccepted'])

    def test_original_strict_budget_rejects_the_measured_gap(self):
        with self.assertRaisesRegex(ValueError,'gap exceeds'):phase.compensate(self.path,CadAccuracyPolicy())

    def test_policy_subclass_cannot_bypass_the_actual_fine_geometry_budget(self):
        class Unbounded(CadAccuracyPolicy):
            def distance_budget_mm(self,**kwargs):return float('nan')
        with self.assertRaisesRegex(ValueError,'gap exceeds'):
            phase.compensate(self.path,Unbounded.engineering(.001))

    def test_aliases_pin_every_outside_anchor_and_leave_source_arrays_readonly(self):
        outside=set(map(int,self.source.node_ids[self.source.elements[~self.mask]].flat))
        for group in self.report['aliasClasses']:
            pinned=outside.intersection(group['sourceNodeIDs'])
            self.assertLessEqual(len(pinned),1)
            if pinned:self.assertEqual(pinned,{group['canonicalOriginalNodeID']})
            self.assertEqual(group['retainedOutsideAnchor'],bool(pinned))
        for field in ('nodes','node_ids','element_ids','part_ids'):
            self.assertFalse(getattr(self.mesh,field).flags.writeable)
        for key in ('newNonpositiveCornerCells','newNegativeCornerCells','newBadCornerCells',
                    'newNonmanifoldOrMisorientedFaces'):
            self.assertEqual(self.report[key],[])

    @unittest.skipUnless(os.environ.get('BOLTHEX_TEST_ROOT'),'Explicit scratch required')
    def test_real_whole_k_inp_roundtrip_and_cli_exit_are_explicitly_partial(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as folder:
            output=Path(folder)/'compensated'
            with redirect_stdout(io.StringIO()):status=phase.main([str(self.path),str(output),'--target-size-mm','.2'])
            self.assertEqual(status,3)
            report=json.loads((output/'report.json').read_text())
            self.assertTrue(report['phaseCompensationValidated']);self.assertFalse(report['completeSourceMeshAccepted'])
            reopened=read_keyword(output/'phase-compensated-source.k')
            np.testing.assert_array_equal(reopened.elements,self.mesh.elements)
            np.testing.assert_array_equal(reopened.nodes,self.source.nodes)
            self.assertIn('AXIS NOT REPAIRED',(output/'phase-compensated-source.k').read_text())
            for name in ('phase-compensated-source.k','phase-compensated-source.inp'):
                self.assertLess((output/name).stat().st_size,16*1024**2)
