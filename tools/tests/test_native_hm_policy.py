"""Explicit native-HM policy forwarding and independent raw witness checks."""
import copy
from pathlib import Path
import unittest

from tools.hypermesh_native import make_tcl,export_hm,_accuracy_arguments
from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy
from tools.bolthex.native_cad_audit import surface_acceptance,surface_policy_acceptance


def sample():
    surface=dict(point=[1.,0.,0.],role='source-face-interior',sourceDistance=0.)
    control=dict(point=[1.1,0.,0.],role='control',sourceDistance=.1)
    reference=dict(points=[surface,control])
    report=dict(forward=[dict(surface,index=0,nativeDistance=0.),dict(control,index=1,nativeDistance=.1)],
        sourceFaceWitnesses=[dict(face=0,point=[1.,0.,0.],nativeDistance=0.)],
        reverse=[dict(face=0,point=[1.,0.,0.],sourceDistance=0.)],
        edgeReverse=[dict(edge=0,point=[1.,0.,0.],sourceDistance=0.)],
        sourceFaces=1,nativeFaces=1,nativeEdges=1,surfaceWitnesses=1,controls=1,reverseWitnesses=1,edgeWitnesses=1,
        sourceVolume=1.,nativeVolume=1.,relativeNativeVolumeError=0.,sourceBounds=[-1.,-1.,-1.,1.,1.,1.],nativeBounds=[-1.,-1.,-1.,1.,1.,1.],
        maximumSurfaceDistance=0.,maximumSourceFaceDistance=0.,maximumControlDistanceError=0.,maximumSourceReferenceError=0.,
        maximumReverseDistance=0.,maximumReverseEdgeDistance=0.,maximumCadBoundsDifference=0.)
    return report,reference


class NativePolicyTests(unittest.TestCase):
    def test_all_engineering_constraints_reach_the_child_cli(self):
        p=CadAccuracyPolicy.engineering(.1,critical_target_size_mm=.04,minimum_functional_gap_mm=.004,minimum_root_radius_mm=.01)
        args=_accuracy_arguments(p)
        for flag,value in (('--accuracy-profile','engineering'),('--target-size-mm','0.1'),('--critical-target-size-mm','0.04'),
                           ('--minimum-functional-gap-mm','0.004'),('--minimum-root-radius-mm','0.01')):
            self.assertEqual(args[args.index(flag)+1],value)
        self.assertEqual(_accuracy_arguments(CadAccuracyPolicy()),['--accuracy-profile','strict'])

    def test_engineering_requires_independent_geometry_and_solid_volume_evidence(self):
        p=CadAccuracyPolicy.engineering(.1)
        with self.assertRaisesRegex(ValueError,'references'):export_hm(None,None,None,None,accuracy_policy=p)
        with self.assertRaisesRegex(ValueError,'BRep volume'):
            export_hm(None,None,None,None,cad='cad.step',cad_reference='refs.json',cad_python='python',accuracy_policy=p)

    def test_step_export_is_opt_in_and_within_readonly_export_guards(self):
        args=(Path('in.k'),Path('cad.step'),Path('out'),Path('template'),8,1,1,False,1e-7,[])
        default=make_tcl(*args,native_cad_exchange=True)
        enabled=make_tcl(*args,native_cad_exchange=True,native_step_export=True)
        self.assertIn('if {0} {\n                    *geomexport "step_ct"',default)
        self.assertIn('if {1} {\n                    *geomexport "step_ct"',enabled)
        self.assertIn('"GeometryMode=Standard"',enabled)
        self.assertNotIn('"GeometryMode=BSpline"',enabled)
        self.assertLess(enabled.index('*geomexport "step_ct"'),enabled.index('same_snapshot $original [snapshot] $log "Read-only native CAD export"'))
        self.assertNotRegex(enabled,r'@[A-Z]+@')
        with self.assertRaises(ValueError):make_tcl(*args,native_step_export=True)

    def test_raw_distances_cannot_use_summary_epsilon_as_extra_budget(self):
        report,reference=sample();p=CadAccuracyPolicy.engineering(.04)
        report['edgeReverse'][0]['sourceDistance']=.0004+5e-14
        report['maximumReverseEdgeDistance']=.0004
        self.assertTrue(surface_acceptance(report,p))
        self.assertFalse(surface_policy_acceptance(report,reference,p))

    def test_raw_bounds_cannot_hide_behind_the_declared_maximum(self):
        report,reference=sample();p=CadAccuracyPolicy.engineering(.04)
        report['nativeBounds'][5]+=.0004+5e-14;report['maximumCadBoundsDifference']=.0004
        self.assertFalse(surface_policy_acceptance(report,reference,p))

    def test_geometry_comparison_does_not_promote_approximate_host_mass(self):
        report,reference=sample();report['nativeVolume']=1.1;report['relativeNativeVolumeError']=.1
        self.assertTrue(surface_policy_acceptance(report,reference,CadAccuracyPolicy.engineering(.04)))
        changed=copy.deepcopy(report);changed['forward'][0]['sourceDistance']=1e-4
        with self.assertRaises(ValueError):surface_policy_acceptance(changed,reference,CadAccuracyPolicy.engineering(.04))


if __name__=='__main__':unittest.main()
