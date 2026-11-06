"""Discretization and native transfer are different distances, not one adjustable gate."""
import unittest
import copy
from pathlib import Path
from tools.verify_washer_native_geometry import measure_points,check_native_identity


class CompleteBoundaryMeasurements(unittest.TestCase):
    points=[[1.,0.,0.],[0.,1.,0.]]

    def test_chord_discretization_is_not_mislabelled_native_transfer_error(self):
        result=measure_points(self.points,lambda p:.01,lambda p:.0103,lambda p:.0102,.02,.0005)
        self.assertTrue(result['passed']);self.assertEqual(result['count'],2)
        self.assertAlmostEqual(result['maxima']['nativeTransferError'],.0003)

    def test_bad_source_node_cannot_use_the_larger_transfer_budget(self):
        result=measure_points(self.points,lambda p:1e-4,lambda p:1e-4,lambda p:1e-4,2e-6,.0005)
        self.assertFalse(result['passed'])

    def test_both_raw_native_and_reconstructed_geometry_must_pass(self):
        for native,carrier in ((.000501,0.),(0.,.000501)):
            result=measure_points(self.points,lambda p:0.,lambda p:native,lambda p:carrier,2e-6,.0005)
            self.assertFalse(result['passed'])

    def test_missing_nonfinite_measurements_and_unbounded_limits_reject(self):
        for value in (float('nan'),float('inf'),-.1):
            with self.assertRaises(ValueError):measure_points(self.points,lambda p:0.,lambda p:value,lambda p:0.,2e-6,.0005)
            with self.assertRaises(ValueError):measure_points(self.points,lambda p:0.,lambda p:0.,lambda p:0.,2e-6,value)
        with self.assertRaises(ValueError):measure_points([],lambda p:0.,lambda p:0.,lambda p:0.,2e-6,.0005)

    def test_threshold_boundary_does_not_receive_extra_numeric_budget(self):
        self.assertTrue(measure_points(self.points,lambda p:0.,lambda p:.0005,lambda p:.0005,2e-6,.0005)['passed'])
        self.assertFalse(measure_points(self.points,lambda p:0.,lambda p:.0005+1e-14,lambda p:0.,2e-6,.0005)['passed'])

    def test_each_point_is_measured_and_input_is_unchanged(self):
        calls=[];points=[p.copy() for p in self.points]
        def distance(point):calls.append(tuple(point));return 0.
        result=measure_points(points,distance,distance,distance,2e-6,.0005)
        self.assertEqual(len(calls),6);self.assertEqual(points,self.points)
        self.assertEqual([r['index'] for r in result['rows']],[0,1])


class NativeIdentityTests(unittest.TestCase):
    def setUp(self):
        self.root=(Path.cwd()/'virtual-native-bundle').resolve()
        self.bindings={str(self.root/name):value for name,value in (('model.hm','hm-A'),('native-cad.iges','iges-A'),('native-cad-manifest.json','manifest-A'))}
        self.host=dict(hmSHA256='hm-A')
        self.manifest=dict(nativeHmPath=str(self.root/'model.hm'),igesPath=str(self.root/'native-cad.iges'),nativeHmSHA256='hm-A',igesSHA256='iges-A')
        self.construction=dict(sourceHmSHA256='hm-A',igesSHA256='iges-A',manifestSHA256='manifest-A')

    def test_matching_bundle_identity_passes_without_mutation(self):
        before=copy.deepcopy((self.host,self.manifest,self.construction))
        check_native_identity(self.host,self.construction,self.manifest,self.bindings,self.root)
        self.assertEqual(before,(self.host,self.manifest,self.construction))

    def test_other_hm_certificate_cannot_bind_current_host(self):
        self.manifest.update(nativeHmPath=str(self.root.parent/'other'/'model.hm'),nativeHmSHA256='hm-B')
        self.construction.update(sourceHmSHA256='hm-B')
        with self.assertRaisesRegex(ValueError,'identity mismatch'):
            check_native_identity(self.host,self.construction,self.manifest,self.bindings,self.root)

    def test_each_native_source_hash_and_path_is_cross_bound(self):
        cases=[('manifest','igesPath',str(self.root.parent/'other'/'native-cad.iges')),
               ('manifest','nativeHmSHA256','changed'),('construction','sourceHmSHA256','changed'),
               ('construction','igesSHA256','changed'),('construction','manifestSHA256','changed')]
        for owner,key,value in cases:
            manifest,construction=copy.deepcopy(self.manifest),copy.deepcopy(self.construction)
            (manifest if owner=='manifest' else construction)[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):
                check_native_identity(self.host,construction,manifest,self.bindings,self.root)


if __name__=='__main__':unittest.main()
