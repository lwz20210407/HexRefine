import importlib.util,os,unittest
import numpy as np
from tools.bolthex.mesh_core import Mesh3D
from tools.bolthex.mesh_audit import audit_h8
from tools.bolthex.cad_cap_upper import join_interfaces,build_upper


class UpperInterfaceTests(unittest.TestCase):
    def parts(self):
        a=Mesh3D('DOME');b=Mesh3D('SHOULDER')
        a.nodes=np.array([[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]],dtype=float)
        b.nodes=a.nodes-[0,0,1]
        a.elems=b.elems=np.arange(8,dtype=np.int64)[None,:]
        x=dict(nodeRings=np.array([[0,1,2,3]]),faces=np.array([[0,3,2,1]]))
        y=dict(nodeRings=np.array([[4,5,6,7]]),faces=np.array([[4,5,6,7]]))
        return a,b,x,y

    def test_exact_interface_pairing_preserves_coordinates_and_closes_faces(self):
        a,b,x,y=self.parts();nodes,cells,mapping,report=join_interfaces(a,b,x,y)
        np.testing.assert_array_equal(nodes[:len(a.nodes)],a.nodes)
        np.testing.assert_array_equal(nodes[mapping],b.nodes)
        self.assertEqual(report['sharedFaces'],1);self.assertEqual(report['sharedNodes'],4)
        quality,_=audit_h8(nodes,cells,2);self.assertAlmostEqual(quality['volume'],2.)

    def test_coordinate_mismatch_is_not_hidden_by_tolerance_welding(self):
        a,b,x,y=self.parts();b.nodes[4,0]+=1e-8
        with self.assertRaisesRegex(ValueError,'coordinates differ'):join_interfaces(a,b,x,y)

    def test_same_orientation_or_duplicate_pairing_reject(self):
        a,b,x,y=self.parts();y['faces']=y['faces'][:,::-1]
        with self.assertRaisesRegex(ValueError,'orientations'):join_interfaces(a,b,x,y)
        a,b,x,y=self.parts();y['nodeRings'][0,1]=4
        with self.assertRaises(ValueError):join_interfaces(a,b,x,y)

    def test_excessive_depth_rejects_before_loading_cad(self):
        for depth in (True,0,-1,.3,float('nan')):
            with self.subTest(depth=depth),self.assertRaises(ValueError):build_upper(None,lower_depth=depth)


@unittest.skipUnless(os.environ.get('HEXREFINE_CAP_STEP') and importlib.util.find_spec('build123d'),'Explicit saved cap CAD required')
class SavedUpperCapTests(unittest.TestCase):
    def test_real_upper_cap_has_no_overlap_and_exact_shared_faces(self):
        from build123d import import_step
        mesh,local,r=build_upper(import_step(os.environ['HEXREFINE_CAP_STEP']))
        self.assertEqual(len(mesh.elems),61440);self.assertEqual(r['interface']['sharedFaces'],512)
        self.assertTrue(r['componentDomainsDisjoint']);self.assertFalse(r['fullCapNut'])
        self.assertEqual(r['quality']['boundaryEuler'],2)
        self.assertLessEqual(r['relativeCadH8VolumeError'],1e-4)
        self.assertLessEqual(r['relativeComponentCadPartitionError'],1e-7)
        self.assertTrue(local.is_valid)
