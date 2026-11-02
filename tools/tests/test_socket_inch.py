import os
from pathlib import Path
import unittest


@unittest.skipUnless(os.environ.get('HEXREFINE_INCH_SOCKET_FIXTURE'),'saved canonical inch socket CAD not selected')
class InchSocketCadTests(unittest.TestCase):
    def test_real_inch_cad_uses_mm_pitch_and_retains_socket_void(self):
        from tools.bolthex.cad_mesh import map_saved_cad,MeshSeeds,estimate_mesh_volume
        from tools.bolthex.socket_dev import check_features
        from tools.bolthex.mesh_audit import audit_h8
        from tools.bolthex.socket_plan import topology_counts
        import json
        root=Path(os.environ['HEXREFINE_INCH_SOCKET_FIXTURE'])
        certificate=json.loads((root/'cad-report.json').read_text())
        seeds=MeshSeeds(sector=16,core_rings=2,radial=2,per_pitch=4,head=4,
                        core_mapping='graded_2to1_compact',head_mapping='fillet_blocks',head_curve_segments=8)
        mesh,shape,cad=map_saved_cad(root/'model.step',root/'cad-report.json',seeds)
        self.assertEqual(cad.thread_dimensions,(6.35,1.27))
        self.assertAlmostEqual(mesh.nodes[:,2].min(),-19.05)
        report,boundary=audit_h8(mesh.nodes,mesh.elems,2)
        self.assertTrue(check_features(mesh,shape,boundary)['recessNotFilled'])
        self.assertAlmostEqual(estimate_mesh_volume(cad,certificate['request'],seeds),report['volume'],places=9)
        count=topology_counts(shape,certificate['request'],seeds,certificate['designThread'])
        self.assertEqual(count['elements'],len(mesh.elems))
