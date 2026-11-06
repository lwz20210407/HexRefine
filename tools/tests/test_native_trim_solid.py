"""Isolated closed-BRep controls and opt-in actual saved-M6 regression."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from tools.bolthex import native_trim_brep as trim
from tools.bolthex import native_trim_solid as solid
from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy
from tools.tests.test_native_trim_brep import annulus, calibration

CAD=importlib.util.find_spec('OCP') is not None
SCRATCH=os.environ.get('BOLTHEX_TEST_ROOT')


def cube():
    points=np.array([[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]],dtype=float)
    cycles=((0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7))
    edge_ids={};faces=[];uvs=np.array([[0,0],[1,0],[1,1],[0,1]],dtype=float)
    for fi,q in enumerate(cycles):
        base=points[q[0]];u=points[q[1]]-base;v=points[q[3]]-base;coedges=[]
        for j in range(4):
            a,b=q[j],q[(j+1)%4];key=tuple(sorted((a,b)));edge_ids.setdefault(key,len(edge_ids))
            pc=dict(type=1,start=[*uvs[j],0.],end=[*uvs[(j+1)%4],0.],supported=True)
            c3=dict(type=1,start=points[key[0]].tolist(),end=points[key[1]].tolist(),supported=True)
            coedges.append(dict(nativeEdgeId=edge_ids[key],edgeSenseRaw=a==key[0],loopSense=True,
                coedgeRange=[0.,1.],edgeRange=[0.,1.],curve2d=pc,curve3d=c3,
                vertices=[dict(nativeVertexId=n+1,available=True,atEndRaw=bool(i),point=points[n].tolist()) for i,n in enumerate(key)],
                onSurfaceSamples=[dict(parameter=t,available=True,
                    uv=[*((1-t)*uvs[j]+t*uvs[(j+1)%4]),0.],point=((1-t)*points[a]+t*points[b]).tolist()) for t in (0.,.25,.5,.75,1.)]))
        faces.append(dict(index=fi,type=1,component='synthetic-cube',normalSense=True,
            uv=[0.,1.,0.,1.],planeBase=base.tolist(),planeU=u.tolist(),planeV=v.tolist(),
            untrimmedMidpoint=(base+.5*u+.5*v).tolist(),
            nativeSamples=[dict(uv=[a,b],point=(base+a*u+b*v).tolist()) for a in (0.,.5,1.) for b in (0.,.5,1.)],
            loopCaptureComplete=True,loops=[dict(index=0,coedges=coedges)]))
    return dict(complete=True,faceCount=6,faces=faces,modelToleranceAfter=1e-6)


class SolidOptionTests(unittest.TestCase):
    def test_metadata_requires_authorization_and_cannot_change_construction_budget(self):
        with self.assertRaisesRegex(ValueError,'explicit metadata'):
            solid._metadata_target(1.133e-5,1.125e-5,1e-4,None)
        self.assertAlmostEqual(solid._metadata_target(1.133e-5,1.125e-5,1e-4,1e-6),1.2e-5)
        with self.assertRaises(ValueError):solid._metadata_target(1.76,1e-5,1e-4,1e-6)
        with self.assertRaises(ValueError):solid._metadata_target(9e-5,1e-5,9.5e-5,2e-5)

    def test_invalid_options_fail_before_kernel(self):
        for kw in (dict(geometry_policy=None,construction_tolerance=1e-6),
                   dict(geometry_policy=CadAccuracyPolicy(),construction_tolerance=1e-4),
                   dict(geometry_policy=CadAccuracyPolicy(),construction_tolerance=True),
                   dict(geometry_policy=CadAccuracyPolicy(),construction_tolerance=float('nan')),
                   dict(geometry_policy=CadAccuracyPolicy(),construction_tolerance=1e-6,metadata_quantum=1e-4)):
            with self.subTest(kw=kw),patch.object(solid,'_kernel',side_effect=AssertionError('kernel before preflight')):
                with self.assertRaises(ValueError):solid.assemble_native_solid(None,**kw)


@unittest.skipUnless(CAD and SCRATCH,'OCCT and explicit dated scratch required')
class ClosedControls(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=SCRATCH);self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        c=self.root/'control.json';c.write_text(json.dumps(calibration()))
        self.conventions=trim.load_conventions(c,source_label='synthetic actual quarter-point calibration')

    def capture(self,doc):
        p=self.root/'capture.json';p.write_text(json.dumps(doc))
        return trim.load_capture(p,source_label='synthetic native CAD control',conventions=self.conventions)

    def build(self,capture):
        return solid.assemble_native_solid(capture,geometry_policy=CadAccuracyPolicy(),construction_tolerance=1e-6,metadata_quantum=1e-7)

    def test_cube_is_closed_valid_and_mass_is_not_a_flux_proxy(self):
        capture=self.capture(cube());before=capture.raw;result=self.build(capture);r=result.report
        self.assertTrue(r['validSolid']);self.assertEqual((r['faces'],r['physicalEdges'],r['vertices'],r['solids']),(6,12,8,1))
        self.assertAlmostEqual(r['independentVolume'],1.,places=12)
        self.assertFalse(r['productAcceptance']);self.assertFalse(r['meshQualityCertified'])
        self.assertFalse(r['geometryFidelityVerified']);self.assertTrue(r['postComparisonRequired'])
        self.assertEqual(capture.path.read_bytes(),before)
        self.assertEqual(r['physicalEdgeChecks']['coedgeOccurrences'],24)

    def test_open_annulus_is_not_promoted_to_a_solid(self):
        with self.assertRaises(solid.SolidReconstructionError) as caught:self.build(self.capture(annulus()))
        self.assertFalse(caught.exception.report['validSolid']);self.assertTrue(caught.exception.report['failures'])
        self.assertNotIn('independentVolume',caught.exception.report)

    def test_missing_c3_or_bad_vertex_fail_without_source_mutation(self):
        for change in ('missing','vertex'):
            doc=cube()
            if change=='missing':
                for f in doc['faces']:
                    for c in f['loops'][0]['coedges']:c.pop('curve3d')
            else:
                for f in doc['faces']:
                    for c in f['loops'][0]['coedges']:
                        for v in c['vertices']:
                            if v['nativeVertexId']==1:v['point']=[99.,99.,99.]
            capture=self.capture(doc);before=capture.raw
            with self.subTest(change=change),self.assertRaises(solid.SolidReconstructionError):self.build(capture)
            self.assertEqual(capture.path.read_bytes(),before)

    def test_failed_owner_check_is_retained_and_never_a_volume_pass(self):
        actual=solid.audit_physical_edges
        def fail(shape):
            r=actual(shape);r['failures'].append(dict(scope='synthetic owner-check failure'));return r
        with patch.object(solid,'audit_physical_edges',side_effect=fail),self.assertRaises(solid.SolidReconstructionError) as caught:
            self.build(self.capture(cube()))
        self.assertTrue(caught.exception.report['curveChecksBeforeMetadata']['failures'])
        self.assertNotIn('independentVolume',caught.exception.report)

    def test_source_changed_after_load_rejects(self):
        c=self.capture(cube());c.path.write_bytes(c.raw+b' ')
        with self.assertRaises(ValueError):self.build(c)

    def test_new_brep_output_roundtrips_but_existing_file_is_never_overwritten(self):
        r=self.build(self.capture(cube()));p=self.root/'result.brep';written=solid.write_brep(r,p)
        self.assertTrue(written['savedReopenedValid']);self.assertAlmostEqual(written['savedReopenedVolume'],1.)
        self.assertEqual(written['savedReopenedTopology'],r.report['outputTopology'])
        self.assertEqual(written['savedReopenedStateSHA256'],r.report['analysisStateSHA256'])
        before=p.read_bytes()
        with self.assertRaises(ValueError):solid.write_brep(r,p)
        self.assertEqual(p.read_bytes(),before)

    def test_valid_same_volume_but_moved_caller_shape_cannot_reuse_verification(self):
        from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
        from OCP.gp import gp_Trsf,gp_Vec
        r=self.build(self.capture(cube()));transform=gp_Trsf();transform.SetTranslation(gp_Vec(100.,0.,0.))
        r.shape=BRepBuilderAPI_Transform(r.shape,transform,True).Shape();target=self.root/'moved.brep'
        with self.assertRaisesRegex(ValueError,'geometry changed'):solid.write_brep(r,target)
        self.assertFalse(target.exists())

    def reject_at_public_boundaries(self,result,pattern):
        target=self.root/'rejected.brep';capture_bytes=result.native.capture.path.read_bytes()
        with self.assertRaisesRegex(ValueError,pattern):solid.write_brep(result,target)
        self.assertFalse(target.exists())
        # Invalidated candidates must reject before opening independent source inputs.
        with self.assertRaisesRegex(ValueError,pattern):
            solid.compare_against_source(result,self.root/'unused.step',self.root/'unused.json',geometry_policy=CadAccuracyPolicy())
        self.assertEqual(result.native.capture.path.read_bytes(),capture_bytes)

    def compound_with_face(self,result,copy_face):
        from OCP.TopoDS import TopoDS_Compound
        from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
        k=solid._kernel();compound=TopoDS_Compound();builder=k.BRep_Builder();builder.MakeCompound(compound)
        builder.Add(compound,result.shape);face=solid._mapped(result.shape,k.TopAbs_FACE)[0]
        if copy_face:face=BRepBuilderAPI_Copy(face,True,False).Shape()
        builder.Add(compound,face)
        return compound

    def test_copied_orphan_face_cannot_reuse_constructor_comparison_binding(self):
        result=self.build(self.capture(cube()));result.shape=self.compound_with_face(result,True)
        self.assertEqual(len(solid._mapped(result.shape,solid._kernel().TopAbs_FACE)),7)
        self.reject_at_public_boundaries(result,'root must be one solid')

    def test_shared_orphan_face_rejects_even_when_geometry_digest_is_unchanged(self):
        result=self.build(self.capture(cube()));result.shape=self.compound_with_face(result,False)
        self.assertEqual(solid._shape_geometry(result.shape),result.report['analysisGeometrySHA256'])
        self.reject_at_public_boundaries(result,'root must be one solid')

    def test_current_tolerance_and_metadata_are_bound_not_mutable_report_claims(self):
        k=solid._kernel()
        for tolerance,pattern in ((.1,'tolerance metadata exceeds'),(1.5e-6,'topology or metadata changed')):
            with self.subTest(tolerance=tolerance):
                result=self.build(self.capture(cube()))
                edge=k.TopoDS.Edge_s(solid._mapped(result.shape,k.TopAbs_EDGE)[0])
                k.BRep_Builder().UpdateEdge(edge,tolerance)
                self.assertEqual(solid._shape_geometry(result.shape),result.report['analysisGeometrySHA256'])
                result.report['maximumOutputTolerance']=tolerance
                result.report['geometryPolicy']['limits']['maximumSurfaceDistance']=1.
                self.reject_at_public_boundaries(result,pattern)

    def test_saved_reopen_rechecks_root_topology_not_only_validity_and_mass(self):
        from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
        result=self.build(self.capture(cube()));k=solid._kernel()
        independent=copy.copy(result);independent.shape=BRepBuilderAPI_Copy(result.shape,True,False).Shape()
        wrong=self.compound_with_face(independent,False);wrong_path=self.root/'wrong-root.brep'
        wrong_path.write_bytes(solid._serialized_shape(wrong));actual_read=k.BRepTools.Read_s
        def read_wrong(target,path,builder):return actual_read(target,str(wrong_path),builder)
        with patch.object(k.BRepTools,'Read_s',side_effect=read_wrong) as read:
            with self.assertRaisesRegex(ValueError,'root must be one solid'):
                solid.write_brep(result,self.root/'not-published.brep')
            read.assert_called_once()

    def test_saved_reopen_rejects_real_geometry_change_with_same_topology_and_mass(self):
        from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
        from OCP.gp import gp_Trsf,gp_Vec
        result=self.build(self.capture(cube()));k=solid._kernel()
        transform=gp_Trsf();transform.SetTranslation(gp_Vec(.01,0.,0.))
        moved=BRepBuilderAPI_Transform(result.shape,transform,True).Shape()
        wrong_path=self.root/'wrong-geometry.brep';wrong_path.write_bytes(solid._serialized_shape(moved))
        actual_read=k.BRepTools.Read_s
        with patch.object(k.BRepTools,'Read_s',side_effect=lambda target,path,builder:actual_read(target,str(wrong_path),builder)) as read:
            with self.assertRaisesRegex(ValueError,'readback geometry change'):
                solid.write_brep(result,self.root/'not-published.brep')
            read.assert_called_once()

    def test_saved_reopen_rejects_tolerance_changes_even_below_policy_budget(self):
        from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
        result=self.build(self.capture(cube()));k=solid._kernel()
        changed=BRepBuilderAPI_Copy(result.shape,True,False).Shape()
        k.BRep_Builder().UpdateEdge(k.TopoDS.Edge_s(solid._mapped(changed,k.TopAbs_EDGE)[0]),1.5e-6)
        wrong_path=self.root/'wrong-metadata.brep';wrong_path.write_bytes(solid._serialized_shape(changed))
        actual_read=k.BRepTools.Read_s
        with patch.object(k.BRepTools,'Read_s',side_effect=lambda target,path,builder:actual_read(target,str(wrong_path),builder)):
            with self.assertRaisesRegex(ValueError,'Readback tolerance'):
                solid.write_brep(result,self.root/'not-published.brep')

    def test_readback_circle_rule_allows_only_period_shift_and_machine_roundoff(self):
        k=solid._kernel();circle=k.Geom_Circle(k.gp_Ax2(k.gp_Pnt(0.,0.,0.),k.gp_Dir(0.,0.,1.)),2.)
        before=k.Geom_TrimmedCurve(circle,-np.pi/2,0.,True,False)
        after=k.Geom_TrimmedCurve(circle,3*np.pi/2,2*np.pi,True,False);changes=[]
        solid._readback_geometry_rule(before,after,changes)
        self.assertEqual(changes[-1]['periodShift'],1)
        for t in np.linspace(-np.pi/2,0.,17):
            self.assertLess(before.Value(float(t)).Distance(after.Value(float(t))),trim.MATH_LIMIT)
        shifted=k.Geom_TrimmedCurve(circle,3*np.pi/2+.01,2*np.pi+.01,True,False)
        with self.assertRaisesRegex(ValueError,'trimmed circle interval'):
            solid._readback_geometry_rule(before,shifted,[])
        changed=k.Geom_Circle(k.gp_Ax2(k.gp_Pnt(0.,0.,0.),k.gp_Dir(0.,0.,1.)),2.0000001)
        self.assertNotEqual(solid._fingerprint(circle),solid._fingerprint(changed))
        with self.assertRaisesRegex(ValueError,'machine roundoff'):
            solid._readback_geometry_rule(circle,changed,[])

    def test_world_readback_checks_do_not_depend_on_descriptor_hash_shortcut(self):
        from build123d import Cylinder
        before=Cylinder(2.,1.).wrapped;after=Cylinder(2.0000001,1.).wrapped
        # Simulate the old rounded-descriptor shortcut; actual world samples
        # must independently reject this unchanged1e-7 radius perturbation.
        with patch.object(solid,'_readback_geometry_rule',return_value=None):
            with self.assertRaisesRegex(ValueError,'Original-to-readback world math'):
                solid._reopen_math(before,after)

    def test_comparison_cannot_relax_construction_policy_or_ignore_tighter_policy(self):
        result=solid.assemble_native_solid(self.capture(cube()),geometry_policy=CadAccuracyPolicy.engineering(.04),
            construction_tolerance=1e-4)
        with self.assertRaisesRegex(ValueError,'tolerance metadata exceeds'):
            solid.compare_against_source(result,self.root/'unused.step',self.root/'unused.json',geometry_policy=CadAccuracyPolicy())

    def test_readback_parameter_intervals_only_accept_writer_rounding(self):
        original=(np.pi/6,np.pi/2);encoded=tuple(float(format(x,'.15g')) for x in original)
        self.assertEqual(solid._readback_interval(original,encoded),encoded)
        self.assertEqual(solid._readback_interval(original,original),original)
        for wrong in ((encoded[0],encoded[1]+1e-9),(0.,float('nan')),(1.,0.)):
            with self.assertRaises(ValueError):solid._readback_interval(original,wrong)

    def test_readback_tolerance_allows_exact_codec_rounding_not_arbitrary_budget(self):
        from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
        original=self.build(self.capture(cube())).shape;k=solid._kernel()
        original_edge=k.TopoDS.Edge_s(solid._mapped(original,k.TopAbs_EDGE)[0])
        value=1.2345678901234567e-6;k.BRep_Builder().UpdateEdge(original_edge,value)
        copied=BRepBuilderAPI_Copy(original,True,False).Shape()
        edge=k.TopoDS.Edge_s(solid._mapped(copied,k.TopAbs_EDGE)[0])
        k.BRep_Builder().UpdateEdge(edge,float(format(value,'.15g')))
        report=solid._reopen_tolerances(original,copied)
        self.assertEqual(len(report['changes']),1)
        self.assertEqual(report['changes'][0]['after'],float(format(value,'.15g')))
        k.BRep_Builder().UpdateEdge(edge,value+1e-12)
        with self.assertRaisesRegex(ValueError,'exact metadata encoding'):
            solid._reopen_tolerances(original,copied)

    def test_exact_circle_reversal_preserves_negative_parameter_interval(self):
        k=solid._kernel();c=k.Geom_Circle(k.gp_Ax2(k.gp_Pnt(0.,0.,0.),k.gp_Dir(0.,0.,1.)),2.)
        a,b=.5235987805870944,1.5707963207995528
        reversed_curve=k.Geom_TrimmedCurve(c.Reversed(),-b,-a,True,False)
        self.assertEqual((reversed_curve.FirstParameter(),reversed_curve.LastParameter()),(-b,-a))
        for t in np.linspace(-b,-a,17):self.assertLess(reversed_curve.Value(float(t)).Distance(c.Value(-float(t))),1e-12)

    def test_unequal_angle_circle_is_exact_conic_fallback_not_fake_affine(self):
        k=solid._kernel();surface=k.Geom_Plane(k.gp_Ax3(k.gp_Pnt(0.,0.,0.),k.gp_Dir(0.,0.,1.)))
        descriptor=dict(type=2,center=[0.,0.,0.],normal=[0.,0.,1.],radiusVector=[2.,0.,0.],supported=True)
        before=copy.deepcopy(descriptor)
        curve,trace=solid.normalize_pcurve(descriptor,[0.,np.pi/2],[2.,5.],surface)
        self.assertIn('conic',trace['method']);self.assertFalse(trace['sameParameterIdentityToOriginalClaimed'])
        self.assertLessEqual(trace['maximumWorldValidationError'],trim.MATH_LIMIT)
        self.assertEqual(descriptor,before)

    def test_independent_cube_source_fidelity_is_separate_and_hash_bound(self):
        from build123d import Box,Align,export_step
        result=self.build(self.capture(cube()));path=self.root/'independent-source.step'
        export_step(Box(1,1,1,align=(Align.MIN,Align.MIN,Align.MIN)),path)
        source_hash=hashlib.sha256(path.read_bytes()).hexdigest();ref=self.root/'reference.json'
        ref.write_text(json.dumps(dict(sourceStepSHA256=source_hash,points=[
            dict(role='source-face-interior',point=[.5,.5,0.],sourceDistance=0.),
            dict(role='mesh-boundary-node',point=[0.,0.,0.],sourceDistance=0.),
            dict(role='control',point=[2.,.5,.5],sourceDistance=1.)])))
        report=solid.compare_against_source(result,path,ref,geometry_policy=CadAccuracyPolicy(),expected_source_sha256=source_hash)
        self.assertTrue(report['completeWitnessCoverage']);self.assertTrue(report['finiteGeometryChecksPassed'])
        self.assertEqual(report['failures'],[]);self.assertFalse(report['productAcceptance'])
        self.assertEqual(len(report['nativeC3ToAnalysis']),12)
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),source_hash)
        with self.assertRaisesRegex(ValueError,'hash mismatch'):
            solid.compare_against_source(result,path,ref,geometry_policy=CadAccuracyPolicy(),expected_reference_sha256='0'*64)

    def test_oversized_owner_error_not_waived_by_the_looser_product_policy(self):
        actual=solid.audit_physical_edges
        def altered(shape):
            r=actual(shape);r['rows'][0].update(maximumSameParameterDistance=5e-7,edgeTolerance=1e-8,withinRecordedTolerance=False)
            # Use a larger measured maximum than the actual stored1e-6 below.
            r['rows'][0]['maximumSameParameterDistance']=2e-6
            return r
        with patch.object(solid,'audit_physical_edges',side_effect=altered),self.assertRaises(solid.SolidReconstructionError):
            solid.assemble_native_solid(self.capture(cube()),geometry_policy=CadAccuracyPolicy.engineering(.04),
                construction_tolerance=1e-6,metadata_quantum=None)


@unittest.skipUnless(CAD and SCRATCH and os.environ.get('HEXREFINE_NATIVE_FULL_CAPTURE') and os.environ.get('HEXREFINE_NATIVE_CONVENTIONS'),
                     'Explicit genuine M6 capture/control and scratch required')
class SavedM6SolidTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path=Path(os.environ['HEXREFINE_NATIVE_FULL_CAPTURE']);cls.raw=cls.path.read_bytes()
        conv=trim.load_conventions(os.environ['HEXREFINE_NATIVE_CONVENTIONS'],source_label='actual SDK convention control')
        cls.capture=trim.load_capture(cls.path,source_label='actual saved full M6 native capture',conventions=conv,
            expected_sha256='23cf0300af1cb9485978f1ae64b6c53b432b20550a892af6e5fb76ef6692a7b3')
        cls.result=solid.assemble_native_solid(cls.capture,geometry_policy=CadAccuracyPolicy.engineering(.04),
            construction_tolerance=1e-4,metadata_quantum=1e-6)

    @classmethod
    def tearDownClass(cls):
        if cls.path.read_bytes()!=cls.raw:raise AssertionError('Readonly genuine capture changed')

    def test_all_actual_faces_edges_and_closed_solid_are_present(self):
        r=self.result.report
        self.assertEqual((r['faces'],r['physicalEdges'],r['vertices'],r['shells'],r['solids']),(94,237,148,1,1))
        self.assertTrue(r['validSolid']);self.assertTrue(r['physicalAdjacencyPreserved'])
        self.assertEqual(r['sewing']['deletedFaces'],0);self.assertEqual(r['sewing']['freeEdges'],0)

    def test_independent_volume_matches_frozen_actual_reference(self):
        self.assertAlmostEqual(self.result.report['independentVolume'],426.9171998227429,places=8)
        relative=abs(self.result.report['independentVolume']-426.9172076176103)/426.9172076176103
        self.assertLess(relative,1e-7)

    def test_every_owner_checked_and_only_measured_metadata_corrected(self):
        r=self.result.report;a=r['physicalEdgeChecks']
        self.assertEqual((a['physicalEdges'],a['coedgeOccurrences']),(237,474))
        self.assertEqual(a['failures'],[]);self.assertEqual(a['ownerCountsNotTwo'],{})
        self.assertTrue(all(x['withinRecordedTolerance'] for x in a['rows']))
        self.assertLessEqual(a['maximumSameParameterDistance'],1e-4)
        self.assertEqual({x['nativeEdgeId'] for x in r['metadataUpdates']},{123,124})
        self.assertTrue(r['metadataUpdateGeometryUnchanged']);self.assertTrue(r['originalNativeSupportsUnchanged'])

    def test_query_warnings_and_partial_certificate_flags_survive(self):
        q=self.result.native.query([0.,0.,11.]);self.assertEqual(q['queryFailures'],[])
        self.assertTrue(q['queryWarnings']);self.assertAlmostEqual(q['witness']['distance'],1.25)
        self.assertFalse(self.result.report['productAcceptance']);self.assertFalse(self.result.report['meshQualityCertified'])

    def test_actual_saved_reopen_volume_and_exact_check(self):
        with tempfile.TemporaryDirectory(dir=SCRATCH) as folder:
            r=solid.write_brep(self.result,Path(folder)/'native.brep')
            self.assertTrue(r['savedReopenedValid']);self.assertLess(r['bytes'],64*1024**2)
            self.assertAlmostEqual(r['savedReopenedVolume'],426.9171998227429,places=8)
            self.assertEqual(r['savedReopenedTopology'],self.result.report['outputTopology'])
            self.assertEqual((r['savedReopenedTopology']['faces'],r['savedReopenedTopology']['physicalEdges'],
                r['savedReopenedTopology']['physicalCoedgeOccurrences'],r['savedReopenedTopology']['degenerateEdges']),
                (94,237,474,2))
            self.assertEqual(r['sha256'],self.result.report['analysisStateSHA256'])
            self.assertEqual(r['savedReopenedTopologySHA256'],self.result.report['analysisTopologySHA256'])
            metadata=r['readbackToleranceMetadata']
            self.assertEqual(metadata['entitiesChecked'],94+239+148)
            self.assertTrue(metadata['constructionAndEngineeringBudgetsUnchanged'])
            self.assertTrue(all(x['after']==float(format(x['before'],'.15g')) for x in metadata['changes']))
            self.assertLessEqual(r['readbackMath']['maximumWorldDifference'],trim.MATH_LIMIT)

    @unittest.skipUnless(os.environ.get('HEXREFINE_NATIVE_SOLID_SOURCE') and os.environ.get('HEXREFINE_NATIVE_SOLID_REFERENCE'),
                         'Explicit saved source STEP/full reference required for slow finite comparison')
    def test_full_actual_source_reference_and_every_physical_edge(self):
        report=solid.compare_against_source(self.result,os.environ['HEXREFINE_NATIVE_SOLID_SOURCE'],
            os.environ['HEXREFINE_NATIVE_SOLID_REFERENCE'],geometry_policy=CadAccuracyPolicy.engineering(.04),
            expected_source_sha256='f05d88d746926363dd2266eb88a243e8edf9e9e8baf24ab6aaf13c9b1c711902')
        self.assertTrue(report['finiteGeometryChecksPassed']);self.assertTrue(report['completeWitnessCoverage'])
        self.assertEqual(report['failures'],[]);self.assertEqual(len(report['reference']),1053)
        self.assertEqual(sum(r['role']=='mesh-boundary-node' for r in report['reference']),641)
        self.assertEqual(len(report['nativeC3ToAnalysis']),237)
        self.assertEqual(len(report['analysisEdgesToNative']),237)
        self.assertTrue(report['warnings']);self.assertFalse(report['productAcceptance'])
        out=Path(SCRATCH)/'actual-solid-fidelity-test.json'
        if out.exists():raise ValueError('Select a fresh explicit scratch folder for the full actual regression')
        out.write_text(json.dumps(report,indent=2,allow_nan=False))


if __name__=='__main__':unittest.main(verbosity=2)
