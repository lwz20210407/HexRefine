import os
import unittest
import numpy as np

from tools.bolthex.mixed_cell_face_audit import audit_faces


class MixedFacesTests(unittest.TestCase):
    def setUp(self):
        self.nodes = np.array([[0.,0.,0.], [1.,0.,0.], [1.,1.,0.], [0.,1.,0.], [.5,.5,1.], [.5,-.5,.2]])
        self.ids = np.arange(1,7)
        self.pyramid = (np.array([10]), np.array([[1,2,3,4,5]]))

    def test_conforming_pyramid_and_tet_are_directed_face_valid(self):
        r = audit_faces(self.nodes, self.ids, {7:self.pyramid, 4:(np.array([20]),np.array([[1,2,5,6]]))})
        self.assertTrue(r['faceChecksPassed'])
        self.assertEqual(r['misorientedInternalFaceCount'],0)
        self.assertEqual(r['badDirectedSkinEdgeCount'],0)
        self.assertAlmostEqual(r['directedSkinFluxVolume'],1/3+.6/6)
        self.assertFalse(r['globalOverlapCertified'])

    def test_positive_volume_cells_on_same_side_are_rejected(self):
        p = self.nodes.copy()
        p[5] = [.5,.3,.2]
        cell = np.array([[1,5,2,6]])
        q = p[cell[0]-1]
        self.assertGreater(np.linalg.det((q[1:]-q[0]).T),0)
        r = audit_faces(p,self.ids,{7:self.pyramid,4:(np.array([20]),cell)})
        self.assertFalse(r['faceChecksPassed'])
        self.assertEqual(r['misorientedInternalFaceCount'],1)
        self.assertEqual(r['nonmanifoldFaceCount'],0)

    def test_duplicate_cells_and_nonmanifold_faces_do_not_pass(self):
        p = (np.array([10,11,12]), np.tile([[1,2,3,4,5]],(3,1)))
        r = audit_faces(self.nodes,self.ids,{7:p})
        self.assertFalse(r['faceChecksPassed'])
        self.assertEqual(r['duplicateCells'],2)
        self.assertEqual(r['nonmanifoldFaceCount'],5)

    def test_translation_preserves_valid_closed_skin_volume(self):
        blocks={7:self.pyramid,4:(np.array([20]),np.array([[1,2,5,6]]))}
        a=audit_faces(self.nodes,self.ids,blocks)
        b=audit_faces(self.nodes+[1000.,-3000.,5000.],self.ids,blocks)
        self.assertTrue(b['faceChecksPassed'])
        self.assertAlmostEqual(a['directedSkinFluxVolume'],b['directedSkinFluxVolume'],places=11)

    def test_invalid_input_cannot_alias_missing_or_fractional_ids(self):
        with self.assertRaises(ValueError):audit_faces(self.nodes,self.ids.astype(float),{7:self.pyramid})
        with self.assertRaises(ValueError):audit_faces(self.nodes,self.ids,{5:self.pyramid})
        with self.assertRaises(ValueError):audit_faces(self.nodes,self.ids,{4:(np.array([10]),np.array([[1,2,3,99]]))})
        with self.assertRaises(ValueError):audit_faces(self.nodes,self.ids,{4:(np.array([10]),np.array([[1,2,3,4]])),7:self.pyramid})
        with self.assertRaises(ValueError):audit_faces(np.full_like(self.nodes,1e308),self.ids,{7:self.pyramid})

    @unittest.skipUnless(os.environ.get('ACTUAL_MIXED_CORE_NPZ'),'Explicit actual Screw mixed core required')
    def test_actual_full_screw_core_wrong_faces_cannot_be_hidden_by_volume(self):
        with np.load(os.environ['ACTUAL_MIXED_CORE_NPZ'],allow_pickle=False) as z:
            r=audit_faces(z['nodes'],z['node_tags'],{kind:(z['eids'+str(kind)],z['type'+str(kind)]) for kind in (4,7)})
        self.assertEqual(r['cells'],50971)
        self.assertEqual(r['nonmanifoldFaceCount'],0)
        self.assertEqual(r['misorientedInternalFaceCount'],492)
        self.assertFalse(r['faceChecksPassed'])
        self.assertAlmostEqual(r['directedSkinFluxVolume'],8.684993327409584,places=10)
        self.assertAlmostEqual(r['internalUncancelledFlux'],.020057840317073146,places=10)


if __name__=='__main__':unittest.main()
