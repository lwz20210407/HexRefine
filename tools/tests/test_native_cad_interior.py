"""Strict trimmed-IN witnesses without changing source CAD triangulation."""
import importlib.util
import math
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tools.bolthex.native_cad_audit import _interior_point


CAD_AVAILABLE=importlib.util.find_spec('build123d') is not None


def legacy_hits(face):
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.BRepClass import BRepClass_FaceClassifier
    from OCP.TopAbs import TopAbs_IN
    from OCP.gp import gp_Pnt2d
    s=BRepAdaptor_Surface(face.wrapped,True)
    u0,u1=s.FirstUParameter(),s.LastUParameter();v0,v1=s.FirstVParameter(),s.LastVParameter()
    return [BRepClass_FaceClassifier(face.wrapped,gp_Pnt2d(u0+(u1-u0)*a,v0+(v1-v0)*b),1e-9).State()==TopAbs_IN
            for a,b in ((.5,.5),(.25,.5),(.75,.5),(.5,.25),(.5,.75),(.25,.25),(.75,.75))]


def triangulation_signature(face):
    from OCP.BRep import BRep_Tool
    from OCP.TopLoc import TopLoc_Location
    tri=BRep_Tool.Triangulation_s(face.wrapped,TopLoc_Location())
    if tri is None:return None
    return (tri.Deflection(),
            tuple(tuple(tri.Node(i).Coord()) for i in range(1,tri.NbNodes()+1)),
            tuple(tri.Triangle(i).Get() for i in range(1,tri.NbTriangles()+1)),
            tuple(tuple(tri.UVNode(i).Coord()) for i in range(1,tri.NbNodes()+1)) if tri.HasUVNodes() else None)


@unittest.skipUnless(CAD_AVAILABLE,'Optional build123d/OCP runtime required')
class StrictInteriorTests(unittest.TestCase):
    def ring(self):
        from build123d import Face,Wire
        return Face(Wire.make_circle(2.),[Wire.make_circle(1.9999)])

    def assert_strict_in(self,face,point):
        from OCP.BRepClass import BRepClass_FaceClassifier
        from OCP.TopAbs import TopAbs_IN
        from OCP.gp import gp_Pnt
        self.assertEqual(len(point),3)
        self.assertTrue(all(type(v) is float and math.isfinite(v) for v in point))
        self.assertEqual(BRepClass_FaceClassifier(face.wrapped,gp_Pnt(*point),1e-9).State(),TopAbs_IN)
        self.assertLessEqual(face.distance_to(tuple(point)),2e-6)

    def test_thin_trimmed_ring_misses_every_legacy_seed_but_fallback_is_strict_in(self):
        from OCP.BRepMesh import BRepMesh_IncrementalMesh
        face=self.ring();before=triangulation_signature(face)
        self.assertFalse(any(legacy_hits(face)))
        with patch('OCP.BRepMesh.BRepMesh_IncrementalMesh',wraps=BRepMesh_IncrementalMesh) as mesh:
            point=_interior_point(face)
        self.assert_strict_in(face,point)
        self.assertGreaterEqual(mesh.call_count,1)
        self.assertLessEqual(mesh.call_count,4)
        for call in mesh.call_args_list:
            self.assertFalse(call.args[0].IsPartner(face.wrapped))
            self.assertFalse(call.args[-1])
        self.assertEqual(triangulation_signature(face),before)
        self.assertEqual(_interior_point(face),point)
        self.assertGreater(math.hypot(*point[:2]),1.9999)
        self.assertLess(math.hypot(*point[:2]),2.)

    def test_existing_caller_triangulation_and_geometry_are_not_modified(self):
        from OCP.BRepMesh import BRepMesh_IncrementalMesh
        face=self.ring()
        BRepMesh_IncrementalMesh(face.wrapped,.0001,False,.08,False)
        before=triangulation_signature(face);area=face.area
        self.assertIsNotNone(before)
        self.assert_strict_in(face,_interior_point(face))
        self.assertEqual(triangulation_signature(face),before)
        self.assertEqual(face.area,area)

    def test_fast_path_never_meshes_a_regular_trimmed_face(self):
        from build123d import Face,Wire
        face=Face(Wire.make_polygon([(0,0,0),(1,0,0),(1,1,0),(0,1,0)],close=True))
        with patch('OCP.BRepMesh.BRepMesh_IncrementalMesh') as mesh:
            self.assert_strict_in(face,_interior_point(face))
            mesh.assert_not_called()

    def test_on_classification_is_never_accepted_and_search_is_bounded(self):
        from OCP.TopAbs import TopAbs_ON
        face=self.ring();before=triangulation_signature(face)
        classifier=lambda *a:SimpleNamespace(State=lambda:TopAbs_ON)
        with patch('OCP.BRepClass.BRepClass_FaceClassifier',side_effect=classifier) as classify:
            with self.assertRaisesRegex(ValueError,'No trimmed-interior witness'):_interior_point(face)
            self.assertGreater(classify.call_count,7)
            self.assertLessEqual(classify.call_count,7+4096)
            self.assertTrue(all(call.args[2]==1e-9 for call in classify.call_args_list))
        self.assertEqual(triangulation_signature(face),before)

    def test_nonfinite_evaluated_points_cannot_pass_even_when_uv_is_in(self):
        from OCP.BRepAdaptor import BRepAdaptor_Surface
        face=self.ring();actual=BRepAdaptor_Surface(face.wrapped,True)
        fake=SimpleNamespace(FirstUParameter=actual.FirstUParameter,LastUParameter=actual.LastUParameter,
                             FirstVParameter=actual.FirstVParameter,LastVParameter=actual.LastVParameter,
                             Value=lambda u,v:SimpleNamespace(X=lambda:float('nan'),Y=lambda:0.,Z=lambda:0.))
        with patch('OCP.BRepAdaptor.BRepAdaptor_Surface',return_value=fake):
            with self.assertRaisesRegex(ValueError,'No trimmed-interior witness'):_interior_point(face)

    def test_copy_that_shares_source_topology_rejects_before_meshing(self):
        face=self.ring()
        with patch('OCP.BRepBuilderAPI.BRepBuilderAPI_Copy',return_value=SimpleNamespace(Shape=lambda:face.wrapped)), \
                patch('OCP.BRepMesh.BRepMesh_IncrementalMesh') as mesh:
            with self.assertRaisesRegex(ValueError,'isolated face copy'):_interior_point(face)
            mesh.assert_not_called()

    def test_failed_triangulation_cannot_supply_an_unverified_witness(self):
        with patch('OCP.BRepMesh.BRepMesh_IncrementalMesh',return_value=SimpleNamespace(IsDone=lambda:False)):
            with self.assertRaisesRegex(ValueError,'triangulation did not finish'):_interior_point(self.ring())

    def test_unbounded_or_empty_uv_domain_rejects_before_copying(self):
        for low,high in ((-math.inf,1.),(0.,math.nan),(1.,1.),(2.,1.)):
            fake=SimpleNamespace(FirstUParameter=lambda:low,LastUParameter=lambda:high,
                                 FirstVParameter=lambda:0.,LastVParameter=lambda:1.)
            with self.subTest(low=low,high=high), patch('OCP.BRepAdaptor.BRepAdaptor_Surface',return_value=fake), \
                    patch('OCP.BRepBuilderAPI.BRepBuilderAPI_Copy') as copy:
                with self.assertRaisesRegex(ValueError,'Unbounded or empty'):_interior_point(SimpleNamespace(wrapped=None))
                copy.assert_not_called()


@unittest.skipUnless(CAD_AVAILABLE and os.environ.get('HEXREFINE_CAP_STEP'),'Explicit saved source cap required')
class SavedCapInteriorTests(unittest.TestCase):
    assert_strict_in=StrictInteriorTests.assert_strict_in
    def test_all_94_real_source_faces_have_strict_finite_interior_without_source_changes(self):
        from build123d import import_step
        from OCP.BRepMesh import BRepMesh_IncrementalMesh
        from tools.hypermesh_geometry_probe import sha
        from tools.bolthex.standard_cad import _mass
        step=Path(os.environ['HEXREFINE_CAP_STEP'])
        digest=sha(step)
        self.assertEqual(digest,'f05d88d746926363dd2266eb88a243e8edf9e9e8baf24ab6aaf13c9b1c711902')
        source=import_step(step);faces=list(source.faces())
        self.assertEqual(len(faces),94)
        before=[triangulation_signature(f) for f in faces];volume=_mass(source)
        failed_legacy=[i for i,f in enumerate(faces) if not any(legacy_hits(f))]
        self.assertEqual(failed_legacy,[0,47])
        with patch('OCP.BRepMesh.BRepMesh_IncrementalMesh',wraps=BRepMesh_IncrementalMesh) as mesh:
            for i,face in enumerate(faces):
                with self.subTest(face=i,type=face.geom_type.name):self.assert_strict_in(face,_interior_point(face))
        self.assertEqual(mesh.call_count,2)
        for call in mesh.call_args_list:
            self.assertTrue(all(not call.args[0].IsPartner(f.wrapped) for f in faces))
        self.assertEqual([triangulation_signature(f) for f in faces],before)
        self.assertEqual(_mass(source),volume)
        self.assertTrue(source.is_valid)
        self.assertEqual(sha(step),digest)
        print('Saved cap strict interiors: 94/94; legacy failures: zero-based faces 0 and 47; source unchanged')


if __name__=='__main__':unittest.main()
