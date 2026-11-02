import os
from pathlib import Path
from types import SimpleNamespace as Obj
import unittest
from tools.bolthex.cad_socket import socket_floor


class SocketFloorGuards(unittest.TestCase):
    def shape(self,levels,axis_distance):
        faces=[]
        for z in levels:
            faces.append(Obj(geom_type=Obj(name='PLANE'),normal_at=lambda:Obj(Z=1),
                             center=lambda z=z:Obj(Z=z),distance_to=lambda p:axis_distance,area=1))
        return Obj(vertices=lambda:[Obj(Z=0),Obj(Z=1)],faces=lambda:faces)

    def test_does_not_invent_a_floor_for_an_annular_face(self):
        with self.assertRaisesRegex(ValueError,'one exposed planar floor'):
            socket_floor(self.shape([.5],.1))

    def test_multiple_internal_floor_levels_are_explicitly_rejected(self):
        with self.assertRaisesRegex(ValueError,'one exposed planar floor'):
            socket_floor(self.shape([.3,.7],0))


@unittest.skipUnless(os.environ.get('HEXREFINE_CAD_FIXTURES'),'saved socket CAD fixture not selected')
class SavedSocketCadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from tools.bolthex.cad_mesh import map_saved_cad,MeshSeeds
        base=Path(os.environ['HEXREFINE_CAD_FIXTURES'])/'socket-M6'
        cls.seeds=MeshSeeds(sector=4,core_rings=2,radial=2,per_pitch=2,head=4)
        cls.mesh,cls.shape,cls.cad=map_saved_cad(base/'model.step',base/'cad-report.json',cls.seeds)

    def test_small_complete_model_has_a_real_void_and_exact_floor_partition(self):
        from tools.bolthex.mesh_audit import audit_h8
        from tools.bolthex.socket_dev import check_features
        quality,boundary=audit_h8(self.mesh.nodes,self.mesh.elems,2)
        features=check_features(self.mesh,self.shape,boundary)
        self.assertEqual(quality['elements'],4224)
        self.assertGreaterEqual(quality['minimumCornerScaledJacobian'],.15)
        self.assertTrue(features['recessNotFilled'])
        self.assertLess(features['relativeFloorAreaError'],1e-9)

    def test_kernel_detects_solid_to_annulus_and_conserves_discrete_volume(self):
        from tools.bolthex.mesh_audit import audit_h8
        from tools.bolthex.cad_mesh import estimate_mesh_volume
        self.assertEqual(self.cad.radii(0,2)[0],0)
        self.assertGreater(self.cad.radii(0,4)[0],0)
        report,_=audit_h8(self.mesh.nodes,self.mesh.elems,2)
        estimate=estimate_mesh_volume(self.cad,self.mesh.dims['request'],self.seeds)
        self.assertLess(abs(estimate-report['volume'])/report['volume'],1e-10)


if __name__=='__main__':unittest.main()
