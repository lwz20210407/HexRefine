import unittest
import numpy as np
from tools.bolthex.cad_mesh import MeshSeeds, _join_exact, _z_layers
from tools.bolthex.mesh_audit import audit_h8
from tools.bolthex.mesh_core import Mesh3D


CUBE=np.array([[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]],dtype=float)


class CadMeshGuards(unittest.TestCase):
    def test_seeds_reject_boolean_fraction_and_extreme(self):
        for value in [True,1,2.5,257]:
            with self.subTest(value=value),self.assertRaises(ValueError):
                MeshSeeds(sector=value).validate()

    def test_features_are_retained_exactly(self):
        result=_z_layers(0,1,.2,[.17,.87])
        self.assertIn(.17,result);self.assertIn(.87,result)
        self.assertTrue(np.all(np.diff(result)>0))

    def test_cube_audit_and_inversion_rejection(self):
        report,boundary=audit_h8(CUBE,np.arange(8).reshape(1,8),2)
        self.assertAlmostEqual(report['volume'],1)
        self.assertAlmostEqual(report['minimumCornerScaledJacobian'],1)
        self.assertEqual(len(boundary),6)
        with self.assertRaises(ValueError):
            audit_h8(CUBE,np.array([[1,0,3,2,5,4,7,6]]),2)

    def test_disconnected_or_duplicate_cells_are_not_conforming_delivery(self):
        with self.assertRaisesRegex(ValueError,'Duplicate'):
            audit_h8(CUBE,np.tile(np.arange(8),(2,1)),2)
        with self.assertRaisesRegex(ValueError,'Euler'):
            audit_h8(np.vstack((CUBE,CUBE+[2,0,0])),np.arange(16).reshape(2,8),2)

    def test_join_uses_shared_coordinates_not_nearby_welding(self):
        first=Mesh3D('first');first.nodes=CUBE;first.elems=np.arange(8).reshape(1,8)
        first.regions=['CAD_MAPPED']
        second=Mesh3D('second');second.nodes=CUBE+[0,0,1];second.elems=np.arange(8).reshape(1,8)
        second.regions=['CAD_MAPPED']
        merged=_join_exact(first,second,'joined')
        self.assertEqual(len(merged.nodes),12)
        audit_h8(merged.nodes,merged.elems,2)
        second.nodes=second.nodes+[0,0,1e-6]
        separate=_join_exact(first,second,'not-welded')
        self.assertEqual(len(separate.nodes),16)
        with self.assertRaises(ValueError):
            audit_h8(separate.nodes,separate.elems,2)


if __name__=='__main__':unittest.main()
