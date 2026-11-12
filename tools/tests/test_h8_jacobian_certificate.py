import unittest
import os
import numpy as np
from tools.bolthex.mesh_audit import SIGNS
from tools.bolthex.h8_jacobian_certificate import certify_cell,_split_axis
from fractions import Fraction as F


class CertificateTests(unittest.TestCase):
    def test_affine_cube_and_translated_shear_are_certified(self):
        p=(SIGNS+1)/2
        for q in (p,p@np.array([[1.,.3,0.],[0.,2.,.1],[0.,0.,.5]])+[1000.,-3.,8.]):
            r=certify_cell(q)
            self.assertTrue(r['certified'])
            self.assertGreater(F(r['determinantLowerBoundExact']),0)
            self.assertFalse(r['geometricOverlapCertified'])

    def test_reversed_and_collapsed_cells_are_not_certified(self):
        p=(SIGNS+1)/2
        for q in (p*np.array([-1.,1.,1.]),p*np.array([1.,1.,0.])):
            self.assertFalse(certify_cell(q)['certified'])

    def test_exact_de_casteljau_midpoint(self):
        a=np.array([F(1),F(-1),F(1)],dtype=object).reshape(3,1,1)
        left,right=_split_axis(a,0)
        self.assertEqual(left.ravel().tolist(),[F(1),F(0),F(0)])
        self.assertEqual(right.ravel().tolist(),[F(0),F(0),F(1)])

    def test_positive_twist_requires_subdivision_not_false_rejection(self):
        p=SIGNS.astype(float)
        c,s=np.cos(2*np.pi/3),np.sin(2*np.pi/3)
        p[4:,:2]=p[4:,:2]@np.array([[c,s],[-s,c]])
        first=certify_cell(p,maximum_depth=0)
        self.assertFalse(first['certified'])
        self.assertEqual(first['status'],'inconclusive-depth-budget')
        result=certify_cell(p,maximum_depth=2)
        self.assertTrue(result['certified'])
        self.assertGreater(result['boxesVisited'],1)
        self.assertEqual(certify_cell(p,maximum_boxes=1)['status'],'inconclusive-box-budget')

    def test_internal_collapse_not_hidden_by_positive_outer_corners(self):
        p=(SIGNS+1)/2;p[4:,:2]=1-p[4:,:2]
        r=certify_cell(p)
        self.assertFalse(r['certified'])
        self.assertEqual(r['status'],'exact-nonpositive-parameter-corner')
        self.assertEqual(F(r['witnessValueExact']),0)

    def test_invalid_input_and_budget_reject(self):
        p=(SIGNS+1)/2
        for options in (dict(maximum_depth=6),dict(maximum_depth=True),dict(maximum_boxes=0)):
            with self.subTest(options=options),self.assertRaises(ValueError):certify_cell(p,**options)
        with self.assertRaises(ValueError):certify_cell(np.zeros((7,3)))

    @unittest.skipUnless(os.environ.get('ACTUAL_MACRO_CERTIFICATE_NPZ'),'Explicit actual head macro required')
    def test_actual_fifteen_hex_head_macro_closed_domain(self):
        with np.load(os.environ['ACTUAL_MACRO_CERTIFICATE_NPZ'],allow_pickle=False) as z:
            points,cells=z['nodes'],z['elements']
        self.assertEqual(cells.shape,(15,8))
        proofs=[certify_cell(points[c]) for c in cells]
        self.assertTrue(all(p['certified'] for p in proofs))
        self.assertTrue(all(F(p['determinantLowerBoundExact'])>0 for p in proofs))


if __name__=='__main__': unittest.main()
