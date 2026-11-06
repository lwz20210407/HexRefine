"""Metric semantics, invalid-cell visibility and optional independent Verdict."""
import importlib.util
import json
import unittest
import numpy as np

from tools.bolthex.h8_quality_report import measure_h8,summarize_h8
from tools.bolthex.mesh_audit import audit_h8
from tools.bolthex.truegrid_screw import ImportedSolids,audit_import

CUBE=np.array([[0.,0.,0.],[1.,0.,0.],[1.,1.,0.],[0.,1.,0.],
               [0.,0.,1.],[1.,0.,1.],[1.,1.,1.],[0.,1.,1.]])
CELL=np.arange(8).reshape(1,8)


class DefinitionTests(unittest.TestCase):
    def test_cube_and_elongated_box_have_unit_sj_but_different_aspect_ratio(self):
        a=measure_h8(CUBE,CELL);b=measure_h8(CUBE*[100,1,1],CELL)
        for k in ('cornerScaledJacobian','cornerAndCenterScaledJacobian','positiveCornerDetRatio','positiveGaussDetRatio'):
            self.assertAlmostEqual(a[k][0],1.);self.assertAlmostEqual(b[k][0],1.)
        self.assertAlmostEqual(b['maxEdgeOverMinEdge'][0],100.)
        self.assertAlmostEqual(a['integratedVolume'][0],1.)
        self.assertAlmostEqual(a['minimumFaceCornerAngleDegrees'][0],90.)
        self.assertAlmostEqual(a['maximumFaceCornerAngleDegrees'][0],90.)
        self.assertAlmostEqual(a['maximumFaceDiagonalNormalAngleDegrees'][0],0.)

    def test_affine_shear_distinguishes_sj_from_constant_determinant_ratio(self):
        p=CUBE.copy();p[:,0]+=4*p[:,1]
        m=measure_h8(p,CELL)
        self.assertAlmostEqual(m['cornerAndCenterScaledJacobian'][0],1/np.sqrt(17))
        self.assertAlmostEqual(m['positiveCornerDetRatio'][0],1.)
        self.assertAlmostEqual(m['positiveGaussDetRatio'][0],1.)
        self.assertAlmostEqual(m['minimumFaceCornerAngleDegrees'][0],np.degrees(np.arctan(.25)))
        self.assertAlmostEqual(m['maximumFaceCornerAngleDegrees'][0],180-np.degrees(np.arctan(.25)))
        self.assertAlmostEqual(m['maximumFaceDiagonalNormalAngleDegrees'][0],0.)
        r=summarize_h8(m,np.array([42]))
        self.assertEqual(r['referenceComparisons']['verdictScaledJacobian']['belowCount'],1)
        self.assertEqual(r['referenceComparisons']['hypermeshGaussDetRatio']['belowCount'],0)
        self.assertFalse(r['engineeringQualityAccepted'])
        self.assertFalse(r['historicalProjectScreen']['officialVendorStandard'])
        self.assertEqual(r['metrics']['maxEdgeOverMinEdge']['highestElementIDs'],[42])

    def test_warped_face_is_detected_and_shapes_are_scale_translation_invariant(self):
        p=CUBE.copy();p[6,2]+=.2
        a=measure_h8(p,CELL);b=measure_h8(p*3+[100,-20,10],CELL)
        self.assertGreater(a['maximumFaceDiagonalNormalAngleDegrees'][0],0.)
        for key in ('minimumFaceCornerAngleDegrees','maximumFaceCornerAngleDegrees','maximumFaceDiagonalNormalAngleDegrees','maxEdgeOverMinEdge'):
            self.assertAlmostEqual(a[key][0],b[key][0],places=10)

    def test_inverted_and_collapsed_cells_are_reported_not_hidden_by_a_ratio(self):
        for scale in ([-1,1,1],[1,1,0]):
            m=measure_h8(CUBE*scale,CELL);r=summarize_h8(m)
            self.assertEqual(r['sampledInvalidElementCount'],1)
            self.assertFalse(r['sampledPositiveJacobians'])
            self.assertTrue(np.isnan(m['positiveCornerDetRatio'][0]))
            json.dumps(r,allow_nan=False)

    def test_input_is_immutable_and_repeated_node_references_reject(self):
        p=CUBE.copy();t=CELL.copy();m=measure_h8(p,t)
        np.testing.assert_array_equal(p,CUBE);np.testing.assert_array_equal(t,CELL)
        self.assertFalse(m['cornerAndCenterScaledJacobian'].flags.writeable)
        t[0,1]=0
        with self.assertRaises(ValueError):measure_h8(p,t)

    def test_middle_collapse_is_not_hidden_by_positive_corners_and_gauss(self):
        p=CUBE.copy();p[4:,:2]=1-p[4:,:2]
        m=measure_h8(p,CELL)
        self.assertGreater(m['cornerScaledJacobian'][0],.5)
        self.assertGreater(m['minimumGaussDeterminant'][0],0.)
        self.assertGreater(m['integratedVolume'][0],0.)
        self.assertEqual(m['centerDeterminant'][0],0.)
        self.assertFalse(m['sampledPositiveJacobians'][0])
        with self.assertRaisesRegex(ValueError,'center Jacobian'):audit_h8(p,CELL)
        imported=ImportedSolids(p,CELL,np.arange(1,9),np.array([19]),np.array([1]),{'*ELEMENT_SOLID':1},'')
        diagnostic=audit_import(imported)
        self.assertEqual(diagnostic['badCenterElementIDs'],[19])
        self.assertEqual(diagnostic['badCornerElementIDs'],[])
        self.assertEqual(diagnostic['badGaussElementIDs'],[])
        self.assertFalse(diagnostic['meshOnlyAccepted'])
        self.assertFalse(diagnostic['engineeringQualityAccepted'])

    def test_project_floor_cannot_waive_positive_jacobians_or_claim_a_standard(self):
        report,_=audit_h8(CUBE,CELL,minimum_sj=0.)
        self.assertFalse(report['engineeringQualityAccepted'])
        self.assertIn('not-vendor-standard',report['qualityScreenBasis'])
        self.assertAlmostEqual(report['minimumCornerAndCenterScaledJacobian'],1.)
        for value in (float('nan'),True,-1.,1.1):
            with self.subTest(value=value),self.assertRaises(ValueError):audit_h8(CUBE,CELL,minimum_sj=value)


@unittest.skipUnless(importlib.util.find_spec('vtkmodules'),'Existing VTK/Verdict runtime required')
class VerdictTests(unittest.TestCase):
    def test_matches_installed_verdict_for_real_non_degenerate_shapes(self):
        from vtkmodules.vtkCommonDataModel import vtkHexahedron
        from vtkmodules.vtkFiltersVerdict import vtkMeshQuality
        variants=[CUBE,CUBE*[5,.2,3]]
        shear=CUBE.copy();shear[:,0]+=4*shear[:,1];variants.append(shear)
        warped=CUBE.copy();warped[6]+=[.15,-.12,.3];variants.append(warped)
        for p in variants:
            with self.subTest(p=p.tolist()):
                h=vtkHexahedron()
                for i,point in enumerate(p):h.GetPoints().SetPoint(i,*point)
                expected=vtkMeshQuality.HexScaledJacobian(h)
                actual=measure_h8(p,CELL)['cornerAndCenterScaledJacobian'][0]
                self.assertAlmostEqual(float(actual),float(expected),places=12)


if __name__=='__main__':unittest.main()
