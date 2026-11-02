import unittest
import hashlib,json,os,tempfile
from pathlib import Path
from tools.bolthex.thread_dimensions import dimensions_for


class CanonicalThreadDimensionTests(unittest.TestCase):
    def test_legacy_metric_and_explicit_canonical_dimensions_agree(self):
        self.assertEqual(dimensions_for(dict(size='M6-1')),(6,1))
        self.assertEqual(dimensions_for(dict(size='M6-1'),dict(unit='mm',majorDiameterMm=6,pitchMm=1)),(6,1))

    def test_inch_marking_uses_explicit_mm_dimensions_not_tpi_as_mm(self):
        request=dict(size='1/4-20')
        with self.assertRaisesRegex(ValueError,'canonical'):dimensions_for(request)
        self.assertEqual(dimensions_for(request,dict(unit='mm',majorDiameterMm=6.35,pitchMm=1.27)),(6.35,1.27))

    def test_sampling_radius_or_wrong_units_cannot_be_promoted_to_design_diameter(self):
        for data in (dict(unit='mm',radiusMm=2.794,pitchMm=1.27),
                     dict(unit='inch',majorDiameterMm=.25,pitchMm=20),
                     dict(unit='mm',majorDiameterMm=True,pitchMm=1),
                     dict(unit='mm',majorDiameterMm=6,pitchMm=float('nan'))):
            with self.subTest(data=data),self.assertRaises(ValueError):dimensions_for(dict(size='1/4-20'),data)
        with self.assertRaisesRegex(ValueError,'disagree'):
            dimensions_for(dict(size='M6-1'),dict(unit='mm',majorDiameterMm=5.4,pitchMm=1))

    def test_unknown_input_shapes_reject_cleanly(self):
        for request,design in ((None,None),({},None),(dict(size='1/4-20'),[])):
            with self.subTest(request=request),self.assertRaises(ValueError):dimensions_for(request,design)

    def test_old_inch_certificate_is_rejected_before_optional_cad_loading(self):
        from tools.bolthex.cad_mesh import map_saved_cad
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as directory:
            root=Path(directory);step=root/'model.step';step.write_bytes(b'not loaded as CAD')
            certificate=root/'cad-report.json'
            certificate.write_text(json.dumps(dict(geometryIndependentOfMesh=True,acceptedAsIndependentCad=True,
                stepSHA256=hashlib.sha256(step.read_bytes()).hexdigest(),unit='mm',
                request=dict(family='socket_bolt',standard='asme_b18.3',size='1/4-20',length=19.05))))
            with self.assertRaisesRegex(ValueError,'canonical designThread'):
                map_saved_cad(step,certificate)


if __name__=='__main__':unittest.main()
