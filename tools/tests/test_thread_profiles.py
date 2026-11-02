import math
import unittest
import numpy as np
from tools.bolthex.femssc_profile import TrapezoidThreadProfile
from tools.bolthex.rounded_profile import RoundedResearchThreadProfile
from tools.bolthex.profiled_parts import profiled_demo_meshes


class ProfileTests(unittest.TestCase):
    def test_femssc_vertices_and_period(self):
        p=TrapezoidThreadProfile(4.71,3.51,1.6,.15)
        f=.6/math.sqrt(3)
        expected=[(0.,1.755),(-f,2.355),(-f-.15,2.355),(-2*f-.15,1.755)]
        for a,b in zip(p.section_vertices(),expected):np.testing.assert_allclose(a,b,atol=1e-14)
        for z,r in p.section_vertices():self.assertAlmostEqual(p.radius(z,0),r)

    def test_hands_starts_and_arbitrary_many_turns_do_not_use_one_subtraction_wrap(self):
        for cls,args in [(TrapezoidThreadProfile,(4.71,3.51,1.6,.15)),(RoundedResearchThreadProfile,(12.,1.5))]:
            for hand in ['left','right']:
                for starts in [1,2,3]:
                    p=cls(*args,handedness=hand,starts=starts)
                    for i in range(-20,21):
                        z,theta=i*.113,i*17.31
                        self.assertAlmostEqual(p.radius(z,theta),p.radius(z+32*p.pitch,theta),places=11)
                        self.assertAlmostEqual(p.radius(z,theta),p.radius(z,theta+360),places=11)
                        shift=(1 if hand=='right' else -1)*p.lead*11/360
                        self.assertAlmostEqual(p.radius(z,theta),p.radius(z+shift,theta+11),places=11)

    def test_rounded_external_and_internal_are_distinct_and_tangent(self):
        p=RoundedResearchThreadProfile(12.,1.5)
        self.assertAlmostEqual(p.radius(0,0),p.root_radius)
        self.assertAlmostEqual(p.radius(p.pitch/2,0),6.)
        self.assertAlmostEqual(p.internal_radius(0,0),p.female_min_radius)
        self.assertGreater(p.internal_radius(p.pitch/2,0),6.)
        for fn,angles in [(p.radius,[45.]),(p.internal_radius,[157.5])]:
            for angle in angles:
                epsilon=1e-5
                left=(fn(0,angle)-fn(0,angle-epsilon))/epsilon
                right=(fn(0,angle+epsilon)-fn(0,angle))/epsilon
                self.assertAlmostEqual(left,right,places=6)
        # Truncated tooth crests intentionally have sharp, continuous corners.
        for fn,angle in [(p.radius,157.5),(p.internal_radius,56.25)]:
            epsilon=1e-5
            self.assertLess(abs(fn(0,angle-epsilon)-fn(0,angle+epsilon)),1e-6)
            left=(fn(0,angle)-fn(0,angle-epsilon))/epsilon
            right=(fn(0,angle+epsilon)-fn(0,angle))/epsilon
            self.assertGreater(abs(left-right),1e-3)

    def test_profiled_bodies_have_stable_topology_and_no_axis_collapse(self):
        for kind in ['femssc','rounded']:
            meshes,geometry=profiled_demo_meshes(profile_kind=kind)
            self.assertEqual([len(m.elems) for m in meshes],[30768,5760])
            self.assertTrue(geometry['threaded']);self.assertFalse(geometry['analyticHelix'])
            for m in meshes:
                self.assertTrue(np.isfinite(m.nodes).all())
                self.assertTrue(np.all(np.diff(np.sort(m.elems,axis=1),axis=1)>0))
                self.assertEqual(len(np.unique(np.sort(m.elems,axis=1),axis=0)),len(m.elems))
            plain,pg=profiled_demo_meshes(threaded=False,profile_kind=kind)
            self.assertFalse(pg['threaded'])
            self.assertEqual(len(plain[0].elems),len(meshes[0].elems))

    def test_invalid_profiles_fail_before_allocation(self):
        for args in [(1.,2.,1.,.1),(4.,3.,.2,.1),(float('nan'),3.,1.,.1)]:
            with self.assertRaises(ValueError):TrapezoidThreadProfile(*args)
        for kwargs in [dict(starts=0),dict(starts=1.5),dict(handedness='auto')]:
            with self.assertRaises(ValueError):RoundedResearchThreadProfile(12.,1.5,**kwargs)
        with self.assertRaises(ValueError):RoundedResearchThreadProfile(1.,2.)
        with self.assertRaises(ValueError):profiled_demo_meshes(profile_kind='unknown')


if __name__=='__main__':unittest.main()
