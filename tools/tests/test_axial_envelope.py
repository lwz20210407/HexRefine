import unittest
from tools.bolthex.axial_envelope import AxialEnvelope


class AxialEnvelopeTests(unittest.TestCase):
    def test_control_points_and_clamped_extensions(self):
        f=AxialEnvelope(((0,1),(15,1),(15.5,2/3),(16,0)))
        self.assertEqual(f.value(-1),1);self.assertEqual(f.value(17),0)
        self.assertAlmostEqual(f.value(15.5),2/3)
        self.assertAlmostEqual(f.value(15.75),1/3)

    def test_resampling_does_not_change_the_physical_field(self):
        f=AxialEnvelope(((0,1),(15,1),(15.5,2/3),(16,0)))
        controls=f.knots
        for step in (.5,.1,.025):
            samples=[(i*step,f.value(i*step)) for i in range(int(16/step)+1)]
            self.assertEqual(samples[-1][1],0)
            self.assertAlmostEqual(f.value(15.75),1/3)
        self.assertEqual(f.knots,controls)

    def test_invalid_controls_and_queries_reject(self):
        for knots in ((),((0,1),),((1,1),(0,0)),((0,1),(0,0)),((0,1),(1,2)),((0,True),(1,0))):
            with self.subTest(knots=knots),self.assertRaises(ValueError):AxialEnvelope(knots)
        f=AxialEnvelope(((0,1),(1,0)))
        for z in (True,float('nan'),float('inf')):
            with self.assertRaises(ValueError):f.value(z)
