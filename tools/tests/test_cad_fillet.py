import math
import unittest
from types import SimpleNamespace
import numpy as np
from tools.bolthex.cad_fillet import quarter_disk,filleted_head
from tools.bolthex.cad_mesh import MeshSeeds
from tools.bolthex.mesh_audit import audit_h8


class MeridianFilletTests(unittest.TestCase):
    def test_invalid_radius_and_incompatible_counts_reject(self):
        for n in (True,2,5,258):
            with self.subTest(n=n),self.assertRaises(ValueError):quarter_disk(.45,n)
        for r in (-1,0,float('nan')):
            with self.subTest(r=r),self.assertRaises(ValueError):quarter_disk(r,8)

    def test_three_patches_remain_valid_when_curve_resolution_increases(self):
        for n in (4,8,12,24):
            with self.subTest(n=n):
                points,quads=quarter_disk(.45,n)
                self.assertEqual(len(quads),3*(n//2)**2)
                width=len(points);points=points+np.array([4.66,5.55])
                # One angular wedge of the actual head, not a flat reference box.
                a=.03
                nodes=np.vstack((np.column_stack((points[:,0],np.zeros(width),points[:,1])),
                                 np.column_stack((points[:,0]*math.cos(a),points[:,0]*math.sin(a),points[:,1]))))
                qs=quads[:,[0,3,2,1]]
                report,_=audit_h8(nodes,np.column_stack((qs,qs+width)),2)
                self.assertGreaterEqual(report['minimumCornerScaledJacobian'],.15)
                self.assertGreater(report['minimumGaussJacobian'],0)

    def test_small_physical_radius_does_not_merge_distinct_reference_nodes(self):
        points,quads=quarter_disk(1e-9,8)
        self.assertEqual(len(points),61)
        self.assertEqual(len(np.unique(points,axis=0)),61)
        self.assertEqual(len(quads),48)

    def test_oversized_head_rejects_before_queries_or_volume_allocation(self):
        cad=SimpleNamespace(zmax=6)
        seeds=MeshSeeds(sector=256,head_curve_segments=256,head_mapping='fillet_blocks')
        with self.assertRaisesRegex(ValueError,'allocation limit'):
            filleted_head(cad,dict(z=3),seeds,None,dict(major=4.66,minor=.45,z=5.55),3)


if __name__=='__main__':unittest.main()
