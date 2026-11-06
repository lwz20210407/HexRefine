"""Optional installed-Gmsh integration; no fake original-Screw acceptance."""
import importlib.util
import unittest
from unittest.mock import patch
import numpy as np

from tools.bolthex import gmsh_hex_bridge as bridge


REGULAR=np.array([[0.,0.,0.],[1.,0.,0.],[.5,np.sqrt(3)/2,0.],[.5,np.sqrt(3)/6,np.sqrt(2/3)]])


class GuardTests(unittest.TestCase):
    def test_bad_cells_are_rejected_before_loading_an_engine(self):
        for t in ([[0,2,1,3]],[[0,0,2,3]],[[0,1,2,4]],[[0,1,2,3],[0,1,2,3]],[[0.,1.,2.,3.]]):
            with self.subTest(t=t),self.assertRaises(ValueError):bridge._input(REGULAR,np.array(t),None)
        with patch.object(bridge,'MAX_TETS',0),self.assertRaises(ValueError):bridge._input(REGULAR,np.array([[0,1,2,3]]),None)

    def test_invalid_node_identity_and_unused_nodes_reject(self):
        for ids in ([1,1,2,3],[0,1,2,3],[True]*4,[1,2,3,2**53]):
            with self.subTest(ids=ids),self.assertRaises(ValueError):bridge._input(REGULAR,np.array([[0,1,2,3]]),ids)
        with self.assertRaises(ValueError):bridge._input(np.vstack((REGULAR,[9,9,9])),np.array([[0,1,2,3]]),None)


@unittest.skipUnless(importlib.util.find_spec('gmsh'),'Optional existing Gmsh runtime required')
class InstalledGmshTests(unittest.TestCase):
    def test_regular_tet_has_four_positive_hexes_and_twelve_boundary_quads(self):
        p=REGULAR.copy();t=np.array([[0,1,2,3]]);ids=np.array([4,10,22,30])
        p0,t0=p.copy(),t.copy()
        out=bridge.subdivide_tetrahedra(p,t,node_ids=ids)
        np.testing.assert_array_equal(p,p0);np.testing.assert_array_equal(t,t0)
        self.assertEqual(out['elements'].shape,(4,8));self.assertEqual(len(out['nodes']),15)
        self.assertAlmostEqual(out['report']['quality']['minimumCornerScaledJacobian'],np.sqrt(.5))
        self.assertEqual(out['report']['boundaryQuads'],12)
        self.assertLess(out['report']['relativeVolumeChange'],1e-12)
        self.assertLess(out['report']['maximumParentRelativeVolumeChange'],1e-12)
        self.assertTrue(out['report']['boundaryOrientationExact'])
        self.assertFalse(out['report']['originalScrewRepaired'])
        self.assertFalse(out['report']['wholeSourceAttachmentVerified'])
        for key in ('nodes','elements','node_ids'):self.assertFalse(out[key].flags.writeable)

    def test_adjacent_tets_share_subdivision_and_preserve_every_parent(self):
        p=np.vstack((REGULAR,[.5,np.sqrt(3)/6,-np.sqrt(2/3)]))
        t=np.array([[0,1,2,3],[0,2,1,4]])
        out=bridge.subdivide_tetrahedra(p,t)
        self.assertEqual(out['elements'].shape,(8,8));self.assertEqual(out['report']['boundaryQuads'],18)
        self.assertEqual(np.bincount(out['child_parent']).tolist(),[4,4])
        self.assertEqual(out['node_supports'].count((1,2,3)),1)

    def test_caller_reserves_the_full_external_node_namespace(self):
        out=bridge.subdivide_tetrahedra(REGULAR,np.array([[0,1,2,3]]),
            node_ids=np.array([4,10,22,30]),new_node_id_start=1000)
        self.assertEqual(set(out['node_ids']),{4,10,22,30,*range(1000,1011)})
        self.assertFalse(out['report']['externalNamespaceCollisionChecked'])
        for start in (4,True,2**53):
            with self.subTest(start=start),self.assertRaises(ValueError):
                bridge.subdivide_tetrahedra(REGULAR,np.array([[0,1,2,3]]),new_node_id_start=start)

    def test_does_not_clear_an_existing_gmsh_model(self):
        import gmsh
        gmsh.initialize(['test','-nopopup'])
        try:
            gmsh.model.add('leave-this-model-alone')
            with self.assertRaises(ValueError):bridge.subdivide_tetrahedra(REGULAR,np.array([[0,1,2,3]]))
            self.assertEqual(gmsh.model.getCurrent(),'leave-this-model-alone')
        finally:gmsh.finalize()

    def test_valid_conversion_is_not_engineering_acceptance_or_an_implicit_point15_rule(self):
        p=REGULAR*[100,1,1]
        out=bridge.subdivide_tetrahedra(p,np.array([[0,1,2,3]]))
        self.assertIsNone(out['report']['callerQualityScreen'])
        self.assertFalse(out['report']['engineeringQualityAccepted'])
        self.assertLess(out['report']['quality']['minimumCornerAndCenterScaledJacobian'],.15)
        self.assertGreater(out['report']['qualityMetricReport']['referenceComparisons']['verdictScaledJacobian']['belowCount'],0)
        with self.assertRaisesRegex(ValueError,'quality rejected'):
            bridge.subdivide_tetrahedra(p,np.array([[0,1,2,3]]),minimum_sj=.15)


if __name__=='__main__':unittest.main()
