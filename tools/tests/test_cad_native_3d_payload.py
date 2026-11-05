"""Canonical 3D source curves extend, but never alter, the frozen 2D payload."""
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
import unittest

import numpy as np

from tools.bolthex import cad_native_payload as frozen
from tools.bolthex import cad_native_3d_payload as curves3d


class Canonical3dCurveTests(unittest.TestCase):
    def test_closed_wire_rotation_is_checked_against_actual_source_order(self):
        from build123d import Box
        source=Box(1,1,1);document=frozen.build_payload(source)
        changed=json.loads(json.dumps(document));loop=changed['faces'][0]['loops'][0]
        loop['coedges']=loop['coedges'][1:]+loop['coedges'][:1]
        indices={c['sourceCoedgeId']:i for i,c in enumerate(loop['coedges'])}
        for edge in changed['sourceEdges']:
            for owner in edge['owners']:
                if owner['faceIndex']==0 and owner['loopIndex']==0:
                    owner['coedgeIndex']=indices[owner['sourceCoedgeId']]
        frozen.validate_payload(changed)
        before=frozen._brep_sha(source.wrapped)
        with self.assertRaisesRegex(ValueError,'Actual source wire/coedge order'):
            curves3d.extend_payload(source,changed)
        self.assertEqual(frozen._brep_sha(source.wrapped),before)

    def test_actual_vertex_identity_and_coordinates_not_just_tolerance_are_checked(self):
        from build123d import Box
        source=Box(1,1,1);original=frozen.build_payload(source)
        for corruption in ('permuted_ids','within_source_tolerance'):
            changed=json.loads(json.dumps(original))
            for edge in changed['sourceEdges']:
                for v in edge['vertices']:
                    if corruption=='permuted_ids' and v['nativeVertexId'] in (0,1):
                        v['nativeVertexId']=1-v['nativeVertexId']
                    elif corruption=='within_source_tolerance':v['point'][0]+=2e-8
                for owner in edge['owners']:
                    c=changed['faces'][owner['faceIndex']]['loops'][owner['loopIndex']]['coedges'][owner['coedgeIndex']]
                    c['vertices']=copy.deepcopy(edge['vertices'])
            frozen.validate_payload(changed)
            with self.subTest(corruption=corruption),self.assertRaises(ValueError):
                curves3d.extend_payload(source,changed)

    def test_new_3d_poles_preflight_before_curve_sample_evaluation(self):
        from build123d import Box
        from OCP.BRepBuilderAPI import BRepBuilderAPI_NurbsConvert
        from unittest.mock import patch
        source=BRepBuilderAPI_NurbsConvert(Box(1,1,1).wrapped,True).Shape()
        result=curves3d.extend_payload(source,frozen.build_payload(source))
        limit=frozen._preflight_payload(result)+1
        with patch.object(frozen,'MAX_TOTAL_POLES',limit),patch.object(frozen,'evaluate_surface',side_effect=AssertionError('math before budget')) as evaluate:
            with self.assertRaises(ValueError):curves3d.validate_payload(result)
            evaluate.assert_not_called()

    def test_complete_3d_source_budget_precedes_record_materialization(self):
        from build123d import Box
        from OCP.BRepBuilderAPI import BRepBuilderAPI_NurbsConvert
        from unittest.mock import patch
        source=BRepBuilderAPI_NurbsConvert(Box(1,1,1).wrapped,True).Shape()
        document=frozen.build_payload(source);result=curves3d.extend_payload(source,document)
        limit=frozen._preflight_payload(result,include3d=True)-1
        with patch.object(frozen,'MAX_TOTAL_POLES',limit),patch.object(curves3d,'_nurbs_record',side_effect=AssertionError('late total 3D budget')) as record:
            with self.assertRaises(ValueError):curves3d.extend_payload(source,document)
            record.assert_not_called()

    def test_transformed_cube_preserves_input_math_identity_and_loop_ranges(self):
        from build123d import Box,Location
        source=Box(1,2,3).moved(Location((1,2,3),(10,20,30)))
        base=frozen.build_payload(source);previous=copy.deepcopy(base);brep=frozen._brep_sha(source.wrapped)
        result=curves3d.extend_payload(source,base);report=curves3d.validate_payload(result)
        self.assertEqual(report['canonical3dCurves'],12)
        self.assertLessEqual(report['maximumSource3dMathSampleError'],1e-10)
        self.assertEqual(base,previous);self.assertEqual(frozen._brep_sha(source.wrapped),brep)
        self.assertEqual({e['curve3d']['type'] for e in result['sourceEdges']},{1})
        for edge in result['sourceEdges']:
            for owner in edge['owners']:
                c=result['faces'][owner['faceIndex']]['loops'][owner['loopIndex']]['coedges'][owner['coedgeIndex']]
                expected=edge['native3dParamRange'][::-1] if c['edgeSenseRaw'] else edge['native3dParamRange']
                self.assertEqual(c['source3dRange'],expected)
                original=previous['faces'][owner['faceIndex']]['loops'][owner['loopIndex']]['coedges'][owner['coedgeIndex']]
                self.assertEqual(c['curve2d'],original['curve2d'])
                self.assertEqual(c['source3dSamples'],original['source3dSamples'])
        self.assertFalse(result['nativeHostVerified']);self.assertFalse(result['source3dGeometryFittingPerformed'])

    def test_degenerate_sphere_poles_have_no_constructed_3d_curve(self):
        from build123d import Sphere
        source=Sphere(2);base=frozen.build_payload(source);result=curves3d.extend_payload(source,base)
        poles=[e for e in result['sourceEdges'] if e['degenerated3dEdge']]
        self.assertEqual(len(poles),2)
        for edge in poles:
            self.assertIsNone(edge['curve3d']);self.assertIsNone(edge['native3dParamRange'])
            self.assertEqual(edge['source3dMathSamples'],[])
            for owner in edge['owners']:
                face=result['faces'][owner['faceIndex']];self.assertFalse(face['source3dFaceConstructionAvailable'])
                c=face['loops'][owner['loopIndex']]['coedges'][owner['coedgeIndex']]
                self.assertIsNone(c['curve3d']);self.assertIsNone(c['source3dRange'])

    def test_ellipse_and_finite_hyperbola_match_original_world_math(self):
        from OCP.Geom import Geom_Ellipse,Geom_Hyperbola
        from OCP.gp import gp_Ax2,gp_Pnt,gp_Dir,gp_Elips,gp_Hypr
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge
        from OCP.BRepAdaptor import BRepAdaptor_Curve
        axes=gp_Ax2(gp_Pnt(1,2,3),gp_Dir(1,1,1),gp_Dir(1,-1,0))
        for original,kind in [(Geom_Ellipse(gp_Elips(axes,2.,1.)),3),(Geom_Hyperbola(gp_Hypr(axes,2.,1.)),4)]:
            edge=BRepBuilderAPI_MakeEdge(original,-.55,.2).Edge();adaptor=BRepAdaptor_Curve(edge)
            record,a,b=curves3d.curve_record(adaptor,original)
            with self.subTest(kind=kind):
                self.assertEqual(record['type'],kind)
                for t in np.linspace(a,b,11):
                    s=frozen.source_curve_parameter(record,t);p=adaptor.Value(s)
                    self.assertLessEqual(math.dist(frozen.evaluate_curve(record,t),[p.X(),p.Y(),p.Z()]),1e-10)
                if kind==4:
                    witnesses=record['exactLocusConversion'];self.assertFalse(witnesses['fittingPerformed'])
                    self.assertLessEqual(witnesses['sourceToConvertedMaximumDistance'],1e-10)
                    self.assertLessEqual(witnesses['convertedToSourceMaximumDistance'],1e-10)

    def test_full_3d_rational_poles_are_not_flattened_or_fitted(self):
        from OCP.Geom import Geom_BSplineCurve
        from OCP.TColgp import TColgp_Array1OfPnt
        from OCP.TColStd import TColStd_Array1OfReal,TColStd_Array1OfInteger
        from OCP.gp import gp_Pnt
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge
        from OCP.BRepAdaptor import BRepAdaptor_Curve
        poles=TColgp_Array1OfPnt(1,3);weights=TColStd_Array1OfReal(1,3)
        for i,(point,w) in enumerate([((0,0,0),1.),((1,1,2),.5),((2,0,3),1.)],1):
            poles.SetValue(i,gp_Pnt(*point));weights.SetValue(i,w)
        knots=TColStd_Array1OfReal(1,2);mults=TColStd_Array1OfInteger(1,2)
        knots.SetValue(1,0.);knots.SetValue(2,1.);mults.SetValue(1,3);mults.SetValue(2,3)
        original=Geom_BSplineCurve(poles,weights,knots,mults,2)
        edge=BRepBuilderAPI_MakeEdge(original,0.,1.).Edge();adaptor=BRepAdaptor_Curve(edge)
        record,a,b=curves3d.curve_record(adaptor,original)
        self.assertTrue(record['rational']);self.assertEqual(record['poles'][1],[1.,1.,2.])
        for t in np.linspace(a,b,9):
            p=adaptor.Value(t);self.assertLessEqual(math.dist(frozen.evaluate_curve(record,t),[p.X(),p.Y(),p.Z()]),1e-10)

    def test_unsupported_parabola_rejects_without_approximation(self):
        from OCP.Geom import Geom_Parabola
        from OCP.gp import gp_Ax2,gp_Pnt,gp_Dir,gp_Parab
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge
        from OCP.BRepAdaptor import BRepAdaptor_Curve
        original=Geom_Parabola(gp_Parab(gp_Ax2(gp_Pnt(0,0,0),gp_Dir(0,0,1)),1.))
        adaptor=BRepAdaptor_Curve(BRepBuilderAPI_MakeEdge(original,-1.,1.).Edge())
        with self.assertRaisesRegex(ValueError,'Unsupported canonical'):curves3d.curve_record(adaptor,original)

    def test_changed_source_or_frozen_samples_reject(self):
        from build123d import Box
        source=Box(1,1,1);base=frozen.build_payload(source)
        with self.assertRaisesRegex(ValueError,'BRep differs'):curves3d.extend_payload(Box(2,1,1),base)
        changed=copy.deepcopy(base);changed['faces'][0]['sourceSamples'][0]['point'][0]+=.001
        with self.assertRaises(ValueError):curves3d.extend_payload(source,changed)

    def test_range_orientation_and_changed_math_samples_are_not_waived(self):
        from build123d import Box
        source=Box(1,1,1);result=curves3d.extend_payload(source,frozen.build_payload(source))
        for corruption in ('range','sample','curve'):
            changed=copy.deepcopy(result);edge=changed['sourceEdges'][0];owner=edge['owners'][0]
            c=changed['faces'][owner['faceIndex']]['loops'][owner['loopIndex']]['coedges'][owner['coedgeIndex']]
            if corruption=='range':c['source3dRange']=c['source3dRange'][::-1]
            elif corruption=='sample':edge['source3dMathSamples'][0]['point'][0]+=.001
            else:c['curve3d']=dict(c['curve3d'],type=99)
            with self.subTest(corruption=corruption),self.assertRaises(ValueError):curves3d.validate_payload(changed)

    def test_existing_output_is_preserved_without_reading_sources(self):
        if not os.environ.get('BOLTHEX_TEST_ROOT'):self.skipTest('Explicit scratch required')
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as folder:
            root=Path(folder);target=root/'existing.json';target.write_bytes(b'KEEP')
            with self.assertRaisesRegex(ValueError,'new 3D payload'):
                curves3d.extract_payload(root/'not-read.step',root/'not-read.json',target)
            self.assertEqual(target.read_bytes(),b'KEEP')


@unittest.skipUnless(os.environ.get('HEXREFINE_CAP_STEP') and os.environ.get('CAD_NATIVE_BASE_PAYLOAD'),
                     'Select the readonly saved source STEP and immutable v9 2D payload')
class ActualM6Canonical3dTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from build123d import import_step
        cls.source=Path(os.environ['HEXREFINE_CAP_STEP']);cls.path=Path(os.environ['CAD_NATIVE_BASE_PAYLOAD'])
        cls.source_sha=frozen._sha(cls.source);cls.payload_sha=frozen._sha(cls.path)
        cls.shape=import_step(cls.source);cls.brep=frozen._brep_sha(cls.shape.wrapped)
        cls.base=json.loads(cls.path.read_bytes());cls.extended=curves3d.extend_payload(cls.shape,cls.base)

    @classmethod
    def tearDownClass(cls):
        if frozen._sha(cls.source)!=cls.source_sha or frozen._sha(cls.path)!=cls.payload_sha or frozen._brep_sha(cls.shape.wrapped)!=cls.brep:
            raise AssertionError('Source STEP/BRep or frozen 2D JSON was changed')

    def test_all_canonical_curves_owner_links_and_explicit_pole_fallback(self):
        result=self.extended;report=curves3d.validate_payload(result)
        self.assertEqual((report['faceCount'],report['edgeCount'],report['canonical3dCurves']),(94,239,237))
        self.assertLessEqual(report['maximumSource3dMathSampleError'],1e-10)
        self.assertEqual(result['sourceCanonical3dCurveTypes'],{1:14,2:18,4:205})
        self.assertEqual(sum(not f['source3dFaceConstructionAvailable'] for f in result['faces']),2)
        self.assertFalse(result['nativeHostVerified'])

    def test_actual_hyperbola_arc_conversions_and_source_identity_preservation(self):
        conversions=[e['curve3d']['exactLocusConversion'] for e in self.extended['sourceEdges']
                     if e['curve3d'] is not None and 'exactLocusConversion' in e['curve3d']]
        self.assertEqual(len(conversions),24)
        for row in conversions:
            self.assertLessEqual(row['sourceToConvertedMaximumDistance'],1e-10)
            self.assertLessEqual(row['convertedToSourceMaximumDistance'],1e-10)
        for old,new in zip(self.base['sourceEdges'],self.extended['sourceEdges']):
            self.assertEqual(old['owners'],new['owners']);self.assertEqual(old['vertices'],new['vertices'])
            self.assertEqual(old['sourceEdgeToleranceMm'],new['sourceEdgeToleranceMm'])
        for f,g in zip(self.base['faces'],self.extended['faces']):
            self.assertEqual(f['normalSense'],g['normalSense'])
            for w,z in zip(f['loops'],g['loops']):
                for c,d in zip(w['coedges'],z['coedges']):
                    for key,value in c.items():self.assertEqual(d[key],value)


if __name__=='__main__':unittest.main()
