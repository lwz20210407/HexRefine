import unittest
import numpy as np
from tools.bolthex.graded_core import paired_quad_patch,build_graded_bolt_section
from tools.bolthex.mesh_core import build_bolt_section
from tools.bolthex.cad_mesh import _sweep,MeshSeeds
from tools.bolthex.mesh_audit import audit_h8


class GradedCoreTests(unittest.TestCase):
    def test_paired_patch_has_complete_even_boundary_and_positive_area(self):
        points,quads=paired_quad_patch()
        self.assertEqual((len(points),len(quads)),(17,12))
        cells=points[quads]
        areas=.5*np.sum(cells[:,:,0]*np.roll(cells[:,:,1],-1,axis=1)-cells[:,:,1]*np.roll(cells[:,:,0],-1,axis=1),axis=1)
        self.assertTrue(np.all(areas>0));self.assertAlmostEqual(float(areas.sum()),2)

    def test_real_section_reduces_core_and_keeps_fine_outer_ring(self):
        old=build_bolt_section(32,2,5,6,6,ref_circle=True)
        new=build_graded_bolt_section(32,2,5,6)
        def focused(section):
            ids=np.unique(np.array(section.quads)[np.array(section.qband)=='ring2'])
            xy=np.column_stack((section.x,section.y))[ids]
            return np.array(sorted(map(tuple,np.round(xy,11))))
        np.testing.assert_array_equal(focused(old),focused(new))
        self.assertEqual(new.grading['coreCircumferentialSeeds'],48)
        self.assertEqual(new.grading['threadCircumferentialSeeds'],192)
        self.assertEqual(len(new.quads),2256)
        self.assertLess(len(new.quads),len(old.quads)*.52)
        coarse=_sweep(new,[0,.1],lambda t,z:3)
        fine=_sweep(old,[0,.1],lambda t,z:3)
        a,_=audit_h8(coarse.nodes,coarse.elems,2)
        b,_=audit_h8(fine.nodes,fine.elems,2)
        self.assertAlmostEqual(a['volume'],b['volume'],places=12)

    def test_unavailable_counts_and_mode_are_rejected(self):
        with self.assertRaises(ValueError):build_graded_bolt_section(17,2,5,6)
        with self.assertRaises(ValueError):MeshSeeds(core_mapping='3d-isotropic').validate()


if __name__=='__main__':unittest.main()
