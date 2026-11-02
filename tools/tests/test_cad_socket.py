import os
from pathlib import Path
from types import SimpleNamespace as Obj
import unittest
from tools.bolthex.cad_socket import socket_floor,socket_features


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

    def test_legacy_fillet_heights_retain_bounded_uniform_sampling(self):
        face=Obj(geom_type=Obj(name='TORUS'),vertices=lambda:[Obj(Z=5.55),Obj(Z=6)])
        shape=Obj(faces=lambda:[face])
        levels,bands=socket_features(shape,dict(z=3),24)
        self.assertEqual(bands,[[5.55,6]])
        self.assertEqual(len(levels),26)
        self.assertAlmostEqual(levels[-1],6)
        self.assertAlmostEqual(levels[-1]-levels[-2],levels[2]-levels[1])

    def test_nonfinite_preflight_never_allocates_cells(self):
        from unittest.mock import patch
        from tools.bolthex.cad_socket import map_socket_bolt
        from tools.bolthex.cad_mesh import MeshSeeds
        with patch('tools.bolthex.cad_socket.socket_floor',return_value=dict(z=3)), \
             patch('tools.bolthex.cad_socket.socket_features',return_value=([],[])), \
             patch('tools.bolthex.cad_mesh.RadialCad',return_value=Obj()), \
             patch('tools.bolthex.cad_socket.estimate_socket_volume',return_value=float('nan')), \
             patch('tools.bolthex.cad_mesh._sweep') as sweep:
            with self.assertRaisesRegex(ValueError,'finite and positive'):
                map_socket_bolt(None,dict(size='M6-1'),MeshSeeds(),(6,1),700,1e-4)
            sweep.assert_not_called()


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

    def test_coarse_production_volume_rejection_precedes_any_3d_allocation(self):
        from tools.bolthex.cad_mesh import map_saved_cad
        from unittest.mock import patch
        base=Path(os.environ['HEXREFINE_CAD_FIXTURES'])/'socket-M6'
        with patch('tools.bolthex.cad_mesh._sweep') as sweep:
            with self.assertRaisesRegex(ValueError,'no 3D cells allocated'):
                map_saved_cad(base/'model.step',base/'cad-report.json',self.seeds,socket_volume_limit=1e-4)
            sweep.assert_not_called()

    def test_kernel_detects_solid_to_annulus_and_conserves_discrete_volume(self):
        from tools.bolthex.mesh_audit import audit_h8
        from tools.bolthex.cad_mesh import estimate_mesh_volume
        self.assertEqual(self.cad.radii(0,2)[0],0)
        self.assertGreater(self.cad.radii(0,4)[0],0)
        report,_=audit_h8(self.mesh.nodes,self.mesh.elems,2)
        estimate=estimate_mesh_volume(self.cad,self.mesh.dims['request'],self.seeds)
        self.assertLess(abs(estimate-report['volume'])/report['volume'],1e-10)

    def test_compact_core_reaches_the_same_floor_without_changing_fine_boundary(self):
        import numpy as np
        from tools.bolthex.cad_mesh import map_saved_cad,MeshSeeds
        from tools.bolthex.mesh_audit import audit_h8
        from tools.bolthex.socket_dev import check_features
        base=Path(os.environ['HEXREFINE_CAD_FIXTURES'])/'socket-M6'
        coarse=MeshSeeds(sector=16,core_rings=2,radial=2,per_pitch=2,head=4,core_mapping='graded_2to1_compact')
        mesh,shape,_=map_saved_cad(base/'model.step',base/'cad-report.json',coarse)
        quality,boundary=audit_h8(mesh.nodes,mesh.elems,2)
        self.assertTrue(check_features(mesh,shape,boundary)['recessNotFilled'])
        self.assertEqual(mesh.dims['coreGrading']['patchQuads'],6)
        self.assertGreaterEqual(quality['minimumCornerScaledJacobian'],.15)
        fine=MeshSeeds(sector=16,core_rings=2,radial=2,per_pitch=2,head=4)
        baseline,_,_=map_saved_cad(base/'model.step',base/'cad-report.json',fine)
        baseline_quality,baseline_boundary=audit_h8(baseline.nodes,baseline.elems,2)
        # The recess floor has interior boundary nodes that legitimately differ;
        # compare exterior shaft/head side nodes, not the re-tessellated floor.
        def side(m,b):
            xyz=m.nodes[b]
            ids=np.unique(b[np.ptp(xyz[:,:,2],axis=1)>1e-9])
            return np.array(sorted(map(tuple,np.round(m.nodes[ids],9))))
        np.testing.assert_array_equal(side(mesh,boundary),side(baseline,baseline_boundary))
        self.assertAlmostEqual(quality['volume'],baseline_quality['volume'],places=10)
        self.assertLess(len(mesh.elems),len(baseline.elems))
        from tools.bolthex.socket_plan import topology_counts
        self.assertEqual(topology_counts(shape,mesh.dims['request'],coarse)['elements'],len(mesh.elems))

    def test_fillet_blocks_close_the_actual_complete_socket_without_a_flat_tangent_sliver(self):
        from tools.bolthex.cad_mesh import map_saved_cad,MeshSeeds,estimate_mesh_volume
        from tools.bolthex.mesh_audit import audit_h8
        from tools.bolthex.socket_dev import check_features
        base=Path(os.environ['HEXREFINE_CAD_FIXTURES'])/'socket-M6'
        seeds=MeshSeeds(sector=16,core_rings=2,radial=2,per_pitch=2,head=4,
                        core_mapping='graded_2to1_compact',head_mapping='fillet_blocks',head_curve_segments=8)
        mesh,shape,sampler=map_saved_cad(base/'model.step',base/'cad-report.json',seeds)
        report,boundary=audit_h8(mesh.nodes,mesh.elems,2)
        self.assertTrue(check_features(mesh,shape,boundary)['recessNotFilled'])
        estimate=estimate_mesh_volume(sampler,mesh.dims['request'],seeds)
        self.assertLess(abs(estimate-report['volume'])/report['volume'],1e-10)
        self.assertIn('filletBlocks',mesh.dims['socket'])
        from tools.bolthex.socket_plan import topology_counts
        self.assertEqual(topology_counts(shape,mesh.dims['request'],seeds)['elements'],len(mesh.elems))


if __name__=='__main__':unittest.main()
