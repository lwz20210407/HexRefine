import unittest
from unittest.mock import patch
import numpy as np
import os,tempfile
from pathlib import Path
from tools.bolthex.helical_band import HelicalBandSpec,generate_band,radial_stations,volume_plan
from tools.bolthex.mesh_audit import audit_h8


class HelicalBandTests(unittest.TestCase):
    def test_multiple_turns_keep_ids_and_positive_h8(self):
        for family in ('external','internal'):
            with self.subTest(family=family):
                spec=HelicalBandSpec(cycles=3,family=family,radial_scheme='boundary_count',boundary_layers=3)
                mesh=generate_band(spec);plan=volume_plan(spec)
                quality,_=audit_h8(mesh.nodes,mesh.elems,0)
                self.assertEqual(len(mesh.elems),15360)
                self.assertEqual(len(np.unique(mesh.nodes,axis=0)),len(mesh.nodes))
                self.assertEqual(mesh.nodes[:,2].max(),4.5)
                self.assertGreaterEqual(quality['minimumCornerScaledJacobian'],.15)
                self.assertAlmostEqual(quality['volume'],plan['estimatedDiscreteVolume'],places=10)

    def test_boundary_count_means_finer_layers_next_to_thread(self):
        radial=radial_stations(HelicalBandSpec(radial_scheme='boundary_count',boundary_layers=3))
        widths=np.diff(radial[:,0])
        self.assertAlmostEqual(widths[-1]/widths[0],1/3)
        self.assertTrue(np.all(widths>0))

    def test_explicit_offset_and_layer_count_cannot_silently_mix(self):
        for family in ('external','internal'):
            spec=HelicalBandSpec(family=family,radial_scheme='thread_offset',thread_offset_fraction=.1,rim_offset_pitches=.75)
            radial=radial_stations(spec)
            np.testing.assert_allclose(abs(radial[-1]-radial[-2]),.15,atol=1e-14)
        with self.assertRaisesRegex(ValueError,'active only'):
            HelicalBandSpec(radial_scheme='thread_offset',thread_offset_fraction=.1,boundary_layers=3).validate()

    def test_unsupported_counts_and_budget_reject_before_allocating(self):
        with self.assertRaisesRegex(ValueError,'divisible'):
            HelicalBandSpec(axial_per_pitch=24).validate()
        with self.assertRaisesRegex(ValueError,'geometry is not rounded'):
            HelicalBandSpec(cycles=1.01).validate()
        with patch('tools.bolthex.helical_band.np.arange') as allocation:
            with self.assertRaisesRegex(ValueError,'element budget'):
                generate_band(HelicalBandSpec(cycles=3,element_limit=100))
            allocation.assert_not_called()

    def test_left_hand_is_a_geometric_mirror_with_equal_volume(self):
        right=generate_band(HelicalBandSpec());left=generate_band(HelicalBandSpec(handedness='left'))
        a=right.nodes.copy();a[:,1]*=-1
        np.testing.assert_allclose(np.array(sorted(map(tuple,np.round(a,10)))),
                                   np.array(sorted(map(tuple,np.round(left.nodes,10)))),atol=1e-10)
        self.assertAlmostEqual(audit_h8(right.nodes,right.elems,0)[0]['volume'],
                               audit_h8(left.nodes,left.elems,0)[0]['volume'],places=11)

    def test_coarse_upstream_defaults_cannot_bypass_production_field_gate(self):
        from tools.bolthex.helical_band_export import generate
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as directory:
            root=Path(directory)
            with self.assertRaisesRegex(ValueError,'before 3D allocation'):
                generate(HelicalBandSpec(),root/'not-created',root/'unused-node.exe')
            self.assertFalse((root/'not-created').exists())


if __name__=='__main__':unittest.main()
