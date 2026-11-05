"""Exact source CAD payload math, topology, provenance and preservation."""
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
import unittest

import numpy as np

from tools.bolthex import cad_native_payload as payload


class SourcePayloadMathTests(unittest.TestCase):
    def test_actual_transformed_cube_has_exact_planes_and_shared_edge_identity(self):
        from build123d import Box,Location
        source=Box(1,2,3).moved(Location((2,3,4),(10,20,30)))
        before=payload._brep_sha(source.wrapped)
        result=payload.build_payload(source)
        report=payload.validate_payload(result)
        self.assertEqual(report['faceCount'],6);self.assertEqual(report['edgeCount'],12)
        self.assertEqual(report['coedges'],24);self.assertLessEqual(report['maximumMathSampleError'],1e-10)
        self.assertEqual(payload._brep_sha(source.wrapped),before)
        self.assertEqual({f['type'] for f in result['faces']},{1})
        self.assertTrue(all(len(e['owners'])==2 for e in result['sourceEdges']))
        self.assertEqual(result['origin'],'source-OCP');self.assertFalse(result['coordinateWeldingPerformed'])
        self.assertFalse(result['nativeHostVerified'])

    def test_actual_sphere_cylinder_and_cone_match_sdk_equations_without_fitting(self):
        from build123d import Sphere,Cylinder,Cone
        for source,kind in [(Sphere(2),2),(Cylinder(2,3),3),(Cone(3,2,4),4)]:
            before=payload._brep_sha(source.wrapped)
            with self.subTest(kind=kind):
                result=payload.build_payload(source)
                self.assertIn(kind,{f['type'] for f in result['faces']})
                self.assertLessEqual(payload.validate_payload(result)['maximumMathSampleError'],1e-10)
                self.assertEqual(payload._brep_sha(source.wrapped),before)

    def test_sphere_poles_are_explicit_single_owner_edges_not_coordinate_welding(self):
        from build123d import Sphere
        result=payload.build_payload(Sphere(2))
        poles=[e for e in result['sourceEdges'] if e['degenerated3dEdge']]
        self.assertEqual(len(poles),2)
        for edge in poles:
            self.assertEqual(len(edge['owners']),1);self.assertEqual(edge['sourceCurve3dSamples'],[])
            owner=edge['owners'][0]
            c=result['faces'][owner['faceIndex']]['loops'][owner['loopIndex']]['coedges'][owner['coedgeIndex']]
            self.assertIs(c['degenerated3dEdge'],True)
            self.assertLessEqual(c['sourceWorldSampleSpan'],1e-10)

    def test_unsupported_torus_is_not_approximated_or_mutated(self):
        from build123d import Torus
        source=Torus(3,1);before=payload._brep_sha(source.wrapped)
        with self.assertRaisesRegex(ValueError,'Unsupported source surface'):
            payload.build_payload(source)
        self.assertEqual(payload._brep_sha(source.wrapped),before)

    def test_exact_hyperbola_conversion_has_bidirectional_finite_witnesses(self):
        from OCP.Geom2d import Geom2d_Hyperbola
        from OCP.Geom2dAdaptor import Geom2dAdaptor_Curve
        from OCP.gp import gp_Ax22d,gp_Pnt2d,gp_Dir2d,gp_Hypr2d
        original=Geom2d_Hyperbola(gp_Hypr2d(gp_Ax22d(gp_Pnt2d(0,0),gp_Dir2d(1,0),gp_Dir2d(0,1)),2.,1.))
        source=Geom2dAdaptor_Curve(original,-.55,.2)
        record,lo,hi=payload._curve_record(source)
        self.assertEqual(record['type'],4);self.assertTrue(record['rational'])
        conversion=record['exactLocusConversion']
        self.assertFalse(conversion['fittingPerformed'])
        self.assertLessEqual(conversion['sourceToConvertedMaximumDistance'],1e-10)
        self.assertLessEqual(conversion['convertedToSourceMaximumDistance'],1e-10)
        for t in np.linspace(lo,hi,11):
            s=payload.source_curve_parameter(record,t);p=source.Value(s)
            np.testing.assert_allclose(payload.evaluate_curve(record,t),[p.X(),p.Y(),0],atol=1e-10,rtol=0)

    def test_exact_two_pole_homogeneous_extension_preserves_rational_math(self):
        from OCP.Geom import Geom_BSplineSurface
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
        from OCP.BRepAdaptor import BRepAdaptor_Surface
        from OCP.TColgp import TColgp_Array2OfPnt
        from OCP.TColStd import TColStd_Array1OfReal,TColStd_Array1OfInteger,TColStd_Array2OfReal
        from OCP.gp import gp_Pnt
        for weights in ([[1.,2.],[1.,2.]],[[1.,1.],[2.,2.]]):
            poles=TColgp_Array2OfPnt(1,2,1,2);w=TColStd_Array2OfReal(1,2,1,2)
            for j in range(2):
                for i in range(2):poles.SetValue(i+1,j+1,gp_Pnt(i,j,.2*i*j));w.SetValue(i+1,j+1,weights[j][i])
            knots=TColStd_Array1OfReal(1,2);knots.SetValue(1,0.);knots.SetValue(2,1.)
            mults=TColStd_Array1OfInteger(1,2);mults.SetValue(1,2);mults.SetValue(2,2)
            surface=Geom_BSplineSurface(poles,w,knots,knots,mults,mults,1,1)
            face=BRepBuilderAPI_MakeFace(surface,1e-9).Face();adaptor=BRepAdaptor_Surface(face,False)
            record=payload._surface_record(adaptor)
            self.assertEqual(record['rational'],[True,True]);self.assertEqual(len(record['weights']),4)
            payload._extend_u_support(record,[-1e-7,1+2e-7,0.,1.],adaptor)
            self.assertFalse(record['exactSupportExtension']['fittingPerformed'])
            for u in (-1e-7,0.,.3,1.,1+2e-7):
                for v in (0.,.4,1.):
                    p=adaptor.Value(u,v)
                    np.testing.assert_allclose(payload.evaluate_surface(record,u,v),[p.X(),p.Y(),p.Z()],atol=1e-10,rtol=0)
            with self.assertRaisesRegex(ValueError,'V trim'):
                payload._extend_u_support(record,[-1e-7,1+2e-7,-1e-5,1.],adaptor)


class SourcePayloadGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from build123d import Box
        cls.document=payload.build_payload(Box(1,1,1))

    def test_changed_samples_unsupported_types_and_missing_owner_links_reject(self):
        for kind in ('sample','type','owner','provenance','pole'):
            d=copy.deepcopy(self.document)
            if kind=='sample':d['faces'][0]['sourceSamples'][0]['point'][0]+=.001
            elif kind=='type':d['faces'][0]['type']=99
            elif kind=='owner':d['sourceEdges'][0]['owners']=[]
            elif kind=='provenance':d['faces'][0]['nativeSamples']=d['faces'][0]['sourceSamples']
            else:d['faces'][0]['loops'][0]['coedges'][0]['degenerated3dEdge']=True
            with self.subTest(kind=kind),self.assertRaises(ValueError):payload.validate_payload(d)

    def test_existing_payload_path_rejects_without_overwriting(self):
        if not os.environ.get('BOLTHEX_TEST_ROOT'):self.skipTest('Explicit task scratch root required')
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as folder:
            root=Path(folder);target=root/'old.json';target.write_bytes(b'OLD PAYLOAD')
            source=root/'input.step';source.write_bytes(b'not imported')
            with self.assertRaisesRegex(ValueError,'new payload'):payload.extract_payload(source,target)
            self.assertEqual(target.read_bytes(),b'OLD PAYLOAD')

    def test_knot_multiplicity_budget_precedes_expanded_values(self):
        from unittest.mock import Mock
        bs=Mock();bs.NbKnots.return_value=2;bs.NbPoles.return_value=2;bs.Degree.return_value=1
        bs.Multiplicity.side_effect=[2,1000000000]
        bs.Knot.side_effect=AssertionError('Knot values accessed before counts were checked')
        with self.assertRaises(ValueError):payload._knots(bs)
        bs.Knot.assert_not_called()

    def test_complete_source_pole_budget_precedes_any_materialization(self):
        from build123d import Box
        from OCP.BRepBuilderAPI import BRepBuilderAPI_NurbsConvert
        from unittest.mock import patch
        source=BRepBuilderAPI_NurbsConvert(Box(1,1,1).wrapped,True).Shape()
        document=payload.build_payload(source);limit=payload._preflight_payload(document)-1
        with patch.object(payload,'MAX_TOTAL_POLES',limit),patch.object(payload,'_knots',side_effect=AssertionError('late whole-source budget')) as knots:
            with self.assertRaises(ValueError):payload.build_payload(source)
            knots.assert_not_called()

    def test_missing_or_inconsistent_global_vertex_inventory_rejects(self):
        for corruption in ('count','same_id_point','coedge_copy'):
            d=json.loads(json.dumps(self.document))
            if corruption=='count':d['sourceVertexCount']+=1
            elif corruption=='same_id_point':d['sourceEdges'][0]['vertices'][0]['point'][0]+=1e-8
            else:d['faces'][0]['loops'][0]['coedges'][0]['vertices'][0]['nativeVertexId']=999999
            with self.subTest(corruption=corruption),self.assertRaises(ValueError):payload.validate_payload(d)


@unittest.skipUnless(os.environ.get('HEXREFINE_CAP_STEP'),'Select the readonly saved source cap STEP')
class ActualM6PayloadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from build123d import import_step
        cls.path=Path(os.environ['HEXREFINE_CAP_STEP']);cls.file_hash=hashlib.sha256(cls.path.read_bytes()).hexdigest()
        cls.shape=import_step(cls.path);cls.before=payload._brep_sha(cls.shape.wrapped)
        cls.parent=cls.shape.parent;cls.children=cls.parent.children
        cls.document=payload.build_payload(cls.shape,cls.file_hash)

    @classmethod
    def tearDownClass(cls):
        if hashlib.sha256(cls.path.read_bytes()).hexdigest()!=cls.file_hash or payload._brep_sha(cls.shape.wrapped)!=cls.before:
            raise AssertionError('Readonly M6 source file or BRep changed')

    def test_all_source_faces_exact_math_topology_and_provenance(self):
        d=self.document;report=payload.validate_payload(d)
        self.assertEqual((report['faceCount'],report['edgeCount'],report['coedges']),(94,239,476))
        self.assertLessEqual(report['maximumMathSampleError'],1e-10)
        self.assertEqual({f['type'] for f in d['faces']},{1,2,3,4,6})
        self.assertEqual(sum(len(e['owners'])==2 for e in d['sourceEdges']),237)
        self.assertEqual(sum(e['degenerated3dEdge'] for e in d['sourceEdges']),2)
        self.assertIs(self.shape.parent,self.parent);self.assertEqual(self.parent.children,self.children)
        self.assertEqual(d['origin'],'source-OCP');self.assertTrue(d['sourceBrepUnmodified'])
        for f in d['faces']:
            self.assertNotIn('nativeSamples',f)
            for w in f['loops']:
                for c in w['coedges']:self.assertNotIn('onSurfaceSamples',c)

    def test_exact_support_extensions_and_hyperbola_remaps_are_witnessed(self):
        extensions=[f['exactSupportExtension'] for f in self.document['faces'] if 'exactSupportExtension' in f]
        self.assertTrue(extensions)
        for e in extensions:self.assertLessEqual(e['maximumSourceOCPAgreementError'],1e-10)
        conversions=[c['curve2d']['exactLocusConversion'] for f in self.document['faces'] for w in f['loops']
                     for c in w['coedges'] if 'exactLocusConversion' in c['curve2d']]
        self.assertEqual(len(conversions),24)
        for e in conversions:
            self.assertLessEqual(e['sourceToConvertedMaximumDistance'],1e-10)
            self.assertLessEqual(e['convertedToSourceMaximumDistance'],1e-10)

    def test_source_3d_curve_samples_are_actual_canonical_edge_observations(self):
        from OCP.BRepAdaptor import BRepAdaptor_Curve
        from OCP.TopAbs import TopAbs_EDGE
        from OCP.TopExp import TopExp
        from OCP.TopTools import TopTools_IndexedMapOfShape
        from OCP.TopoDS import TopoDS
        edges=TopTools_IndexedMapOfShape();TopExp.MapShapes_s(self.shape.wrapped,TopAbs_EDGE,edges)
        for row in self.document['sourceEdges']:
            if row['degenerated3dEdge']:
                self.assertEqual(row['sourceCurve3dSamples'],[]);continue
            curve=BRepAdaptor_Curve(TopoDS.Edge_s(edges.FindKey(row['sourceEdgeId']+1)))
            for sample in row['sourceCurve3dSamples']:
                p=curve.Value(sample['parameter'])
                self.assertLessEqual(math.dist([p.X(),p.Y(),p.Z()],sample['point']),1e-10)
            for owner in row['owners']:
                c=self.document['faces'][owner['faceIndex']]['loops'][owner['loopIndex']]['coedges'][owner['coedgeIndex']]
                self.assertEqual(c['source3dSamples'],row['sourceCurve3dSamples'])
                self.assertIn('source-OCP',c['source3dSamplesOrigin'])

    def test_source_tolerances_are_actual_topods_identity_data_not_a_qa_waiver(self):
        from OCP.BRep import BRep_Tool
        from OCP.TopAbs import TopAbs_EDGE,TopAbs_VERTEX
        from OCP.TopExp import TopExp
        from OCP.TopTools import TopTools_IndexedMapOfShape
        from OCP.TopoDS import TopoDS
        edges=TopTools_IndexedMapOfShape();vertices=TopTools_IndexedMapOfShape()
        TopExp.MapShapes_s(self.shape.wrapped,TopAbs_EDGE,edges)
        TopExp.MapShapes_s(self.shape.wrapped,TopAbs_VERTEX,vertices)
        for row in self.document['sourceEdges']:
            edge=TopoDS.Edge_s(edges.FindKey(row['sourceEdgeId']+1))
            self.assertEqual(row['sourceEdgeToleranceMm'],BRep_Tool.Tolerance_s(edge))
            for owner in row['owners']:
                c=self.document['faces'][owner['faceIndex']]['loops'][owner['loopIndex']]['coedges'][owner['coedgeIndex']]
                self.assertEqual(c['sourceEdgeToleranceMm'],row['sourceEdgeToleranceMm'])
            for v in row['vertices']:
                if v['available']:
                    vertex=TopoDS.Vertex_s(vertices.FindKey(v['nativeVertexId']+1))
                    self.assertEqual(v['sourceVertexToleranceMm'],BRep_Tool.Tolerance_s(vertex))
        self.assertEqual(self.document['sourceEdges'][44]['sourceEdgeToleranceMm'],3.414422940758113e-7)
        self.assertEqual(payload.MATH_LIMIT,1e-10)
        self.assertFalse(self.document['nativeHostVerified'])


if __name__=='__main__':unittest.main()
