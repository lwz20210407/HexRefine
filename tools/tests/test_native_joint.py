from dataclasses import replace
import numpy as np
import unittest
from tools.bolthex.native_joint import NativeJointSpec,build_native_joint
from tools.bolthex.joint_seed_plan import JointAxialSpec


class NativeJointTests(unittest.TestCase):
    def test_full_joint_has_shared_interfaces_without_private_runtime(self):
        result=build_native_joint()
        report=result['report'];self.assertEqual(len(report['parts']),4)
        self.assertGreater(report['sharedNodes'],0)
        self.assertFalse(report['externalApplicationRequired'])
        self.assertGreaterEqual(report['quality']['minimumCornerScaledJacobian'],.15)
        self.assertLess(report['relativeAssemblyVolumeError'],1e-10)
        self.assertEqual(report['quality']['elements'],report['estimatedElements'])
        self.assertEqual(report['preflight']['estimatedElements'],report['quality']['elements'])
        self.assertEqual([p['elements'] for p in report['preflight']['parts']],[p['elements'] for p in report['parts']])

    def test_dimensions_preserved_with_compensated_layers(self):
        result=build_native_joint(NativeJointSpec(axial=JointAxialSpec(thread_length=16.1,nut_height=13.1,shank_length=8.2)))
        self.assertFalse(result['report']['plan']['axialDimensionsChanged'])
        self.assertAlmostEqual(result['nodes'][:,2].max(),34.3)
        self.assertGreaterEqual(result['report']['quality']['minimumCornerScaledJacobian'],.15)

    def test_budgets_and_incompatible_geometry_reject(self):
        for values in (dict(element_limit=1),dict(sector=5),dict(across_flats=12),dict(plate_x=20),dict(handedness='unknown'),dict(connection_mode='auto')):
            with self.subTest(values=values),self.assertRaises(ValueError):build_native_joint(replace(NativeJointSpec(),**values))

    def test_unknown_parameters_do_not_silently_disappear(self):
        with self.assertRaises(ValueError):NativeJointSpec.parse(dict(private_runtime='BoltPro.exe'))
        with self.assertRaises(ValueError):NativeJointSpec.parse(dict(axial=dict(unknown=1)))

    def test_left_hand_and_no_plate_paths_remain_valid(self):
        right=build_native_joint(NativeJointSpec(axial=JointAxialSpec(plate_count=0)))
        left=build_native_joint(NativeJointSpec(axial=JointAxialSpec(plate_count=0),handedness='left'))
        self.assertEqual(len(left['parts']),2)
        self.assertAlmostEqual(left['report']['quality']['volume'],right['report']['quality']['volume'],places=9)
        self.assertGreater(float(np.max(abs(left['nodes']-right['nodes']))),.1)

    def test_small_metric_design_and_four_plate_stack(self):
        small=NativeJointSpec(axial=JointAxialSpec(pitch=1,thread_length=8,nut_height=5,
            shank_length=4,plate_thickness=2,axial_per_pitch=8,axial_per_plate=4),
            diameter=6,across_flats=10,head_height=4,plate_x=20,plate_y=20)
        self.assertGreaterEqual(build_native_joint(small)['report']['quality']['minimumCornerScaledJacobian'],.15)
        stack=build_native_joint(NativeJointSpec(axial=JointAxialSpec(shank_length=16,plate_count=4)))
        self.assertEqual(len(stack['parts']),6)
        self.assertEqual(set(stack['partIds']),set(range(1,7)))

    def test_separate_nodes_preserve_geometry_without_bonding(self):
        shared=build_native_joint()
        separate=build_native_joint(NativeJointSpec(connection_mode='separate'))
        report=separate['report']
        self.assertEqual(report['connection'],'separate-nodes-no-coupling')
        self.assertEqual(report['sharedNodes'],0)
        self.assertTrue(report['nodeOwnership']['componentNodeSetsDisjoint'])
        self.assertEqual(report['nodeOwnership']['sharedNodePairs'],[])
        self.assertEqual(len(separate['nodes']),sum(len(p.nodes) for p in separate['parts']))
        self.assertGreater(len(separate['nodes']),len(shared['nodes']))
        self.assertTrue(shared['report']['nodeOwnership']['sharedNodePairs'])
        np.testing.assert_allclose(shared['nodes'][shared['elements']],separate['nodes'][separate['elements']],rtol=0,atol=1e-9)
        self.assertAlmostEqual(report['quality']['volume'],shared['report']['quality']['volume'],places=9)
        inventories=[set(separate['elements'][separate['partIds']==pid].ravel()) for pid in range(1,5)]
        for i,a in enumerate(inventories):
            for b in inventories[i+1:]:self.assertFalse(a&b)
