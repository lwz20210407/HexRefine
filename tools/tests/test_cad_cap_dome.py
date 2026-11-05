import importlib.util,os,unittest
from unittest.mock import patch
import numpy as np
from tools.bolthex.cad_cap_dome import build_shell,build_cad_dome,equatorial_interface


class DomeKernelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mesh,cls.boundary,cls.report=build_shell([0.,0.,5.],3.75,4.75)

    def test_complete_five_chart_shell_has_no_axis_collapse(self):
        mesh,r=self.mesh,self.report
        self.assertEqual(r['chartCount'],5);self.assertTrue(r['fullDome']);self.assertFalse(r['fullCapNut'])
        self.assertEqual(len(mesh.elems),49152);self.assertEqual(len(mesh.nodes),98818)
        self.assertEqual(len(np.unique(mesh.nodes,axis=0)),len(mesh.nodes))
        self.assertTrue(np.all(np.diff(np.sort(mesh.elems,axis=1),axis=1)>0))
        self.assertGreaterEqual(r['quality']['minimumCornerScaledJacobian'],.15)
        self.assertEqual(r['quality']['boundaryEuler'],2)
        self.assertLessEqual(r['relativeAnalyticVolumeError'],1e-4)
        self.assertEqual(r['equatorialBoundaryFaces'],512)
        self.assertTrue(r['allElementCentroidsInMaterial'])
        self.assertLessEqual(r['maximumBoundaryFaceCenterDistance'],.02)

    def test_interface_is_actual_boundary_with_exact_original_coordinates(self):
        interface=equatorial_interface(self.mesh)
        self.assertEqual(interface['nodeRings'].shape,(2,512))
        np.testing.assert_array_equal(interface['coordinates'],self.mesh.nodes[interface['nodeRings']])
        self.assertTrue(np.all(interface['coordinates'][:,:,2]==5.))
        boundary={tuple(sorted(face)) for face in self.boundary}
        self.assertTrue(all(tuple(sorted(face)) in boundary for face in interface['faces']))
        theta=np.array(interface['thetaDeg']);self.assertTrue(np.all(np.diff(theta)>0))
        self.assertGreater(np.ptp(np.diff(theta)),.1)

    def test_refinement_cannot_waive_volume_gate(self):
        with self.assertRaisesRegex(ValueError,'volume error'):build_shell([0,0,5],3.75,4.75,divisions=16)

    def test_seed_budget_rejects_before_auditing_or_cad(self):
        for kwargs in (dict(divisions=True),dict(divisions=5),dict(radial_layers=0),dict(element_limit=10)):
            with self.subTest(kwargs=kwargs),patch('tools.bolthex.cad_cap_dome.audit_h8') as audit:
                with self.assertRaises(ValueError):build_shell([0,0,5],3.75,4.75,**kwargs)
                audit.assert_not_called()
                with self.assertRaises(ValueError):build_cad_dome(None,**kwargs)

    def test_invalid_radii_or_center_reject(self):
        for center,inner,outer in (([0,0,float('nan')],1,2),([0,0,0],0,2),([0,0,0],2,1),([0,0,0],True,2)):
            with self.subTest(center=center,inner=inner,outer=outer),self.assertRaises(ValueError):build_shell(center,inner,outer)

    def test_too_thin_shell_cannot_pass_by_scaled_jacobian_alone(self):
        with self.assertRaisesRegex(ValueError,'centroid'):build_shell([0,0,5],3.75,3.750001)


@unittest.skipUnless(os.environ.get('HEXREFINE_CAP_STEP') and importlib.util.find_spec('build123d'),'Explicit saved cap CAD required')
class SavedCadDomeTests(unittest.TestCase):
    def test_actual_whole_cad_dome_partition_and_interfaces(self):
        from build123d import import_step
        from tools.bolthex.standard_cad import _mass
        mesh,local,report=build_cad_dome(import_step(os.environ['HEXREFINE_CAP_STEP']))
        self.assertTrue(local.is_valid);self.assertEqual(len(local.solids()),1)
        self.assertLessEqual(report['relativeCadH8VolumeError'],1e-4)
        self.assertLessEqual(report['relativeCadAnalyticVolumeError'],1e-7)
        self.assertLessEqual(report['maximumBoundaryFaceCenterDistance'],.02)
        self.assertAlmostEqual(_mass(local),report['sourceCadPartitionVolume'],places=8)
        self.assertTrue(report['sourceCadUnmodified']);self.assertFalse(report['fullCapNut'])
        self.assertEqual(equatorial_interface(mesh)['faces'].shape,(512,4))
