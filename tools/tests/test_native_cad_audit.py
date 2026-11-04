import math,unittest
from tools.bolthex.native_cad_audit import acceptance


class IndependentNativeCadTests(unittest.TestCase):
    good=dict(maximumSurfaceDistance=1e-8,maximumSourceFaceDistance=1e-8,maximumControlDistanceError=1e-6,maximumReverseDistance=1e-8,maximumReverseEdgeDistance=1e-8,
              maximumCadBoundsDifference=1e-7,relativeNativeVolumeError=5e-8)

    def test_all_original_limits_are_required_together(self):
        self.assertTrue(acceptance(self.good))
        for key,value in [('maximumSurfaceDistance',2.01e-6),('maximumSourceFaceDistance',2.01e-6),('maximumControlDistanceError',2.01e-6),
                          ('maximumReverseDistance',2.01e-6),('maximumReverseEdgeDistance',2.01e-6),('maximumCadBoundsDifference',1.01e-5),('relativeNativeVolumeError',1.01e-7)]:
            with self.subTest(key=key):self.assertFalse(acceptance(dict(self.good,**{key:value})))

    def test_missing_nonfinite_and_negative_metrics_are_not_waived(self):
        for value in (math.nan,math.inf,-1,True,None):
            with self.subTest(value=value),self.assertRaises(ValueError):acceptance(dict(self.good,maximumSurfaceDistance=value))
        with self.assertRaises(ValueError):acceptance({})
