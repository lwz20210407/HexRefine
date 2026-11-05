"""Cap preflight tests; real saved CAD is selected with HEXREFINE_CAP_STEP.

No slow warehouse construction suite is required. BOLTHEX_TEST_ROOT must point
at the caller's scratch directory for tests which write temporary certificates.
"""
import importlib.util
import json
import math
import os
from pathlib import Path
import tempfile
import unittest

from tools.bolthex.cad_cap_plan import blind_end, plan, preflight_shape, spherical_cap


CAD_AVAILABLE = importlib.util.find_spec('build123d') is not None


class InputGuards(unittest.TestCase):
    def test_polar_invalid_or_excessive_inputs_allocate_nothing(self):
        from tools.bolthex.cad_cap import build_polar_patch

        for params in (dict(divisions=True), dict(divisions=3), dict(divisions=66),
                       dict(slope=float('nan')), dict(slope=.01), dict(slope=True),
                       dict(radial_layers=0), dict(radial_layers=True),
                       dict(divisions=64, radial_layers=2)):
            with self.subTest(params=params), self.assertRaises(ValueError):
                build_polar_patch(None, **params)

    def test_invalid_request_never_loads_cad(self):
        for request, unit in ((dict(family='hex_nut', standard='iso4032', size='M6-1'), 'mm'),
                              (dict(family='cap_nut', standard='din1587', size='M6-1'), 'inch')):
            with self.subTest(request=request, unit=unit), self.assertRaisesRegex(ValueError, 'cap_nut'):
                plan(None, request, unit=unit)

    def test_bad_sample_budget_rejects_before_loading_cad(self):
        for count in (True, 5, 73, 12.0):
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, 'Angular samples'):
                preflight_shape(None, count)
            with self.assertRaisesRegex(ValueError, 'Angular samples'):
                plan(None, dict(family='cap_nut', standard='din1587', size='M6-1'), angular_samples=count)

    @unittest.skipUnless(os.environ.get('BOLTHEX_TEST_ROOT'), 'explicit scratch directory required')
    def test_mismatched_certificate_is_not_promoted(self):
        request = dict(family='cap_nut', standard='din1587', size='M6-1')
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as temporary:
            root = Path(temporary)
            step, certificate = root / 'model.step', root / 'cad-report.json'
            step.write_bytes(b'not CAD; hash mismatch must fail before CAD import')
            certificate.write_text(json.dumps(dict(request=request, stepSHA256='incorrect',
                acceptedAsIndependentCad=True, geometryIndependentOfMesh=True, unit='mm',
                relativeReopenVolumeError=0)))
            with self.assertRaisesRegex(ValueError, 'hash-verified'):
                plan(step, request, certificate=certificate)


@unittest.skipUnless(CAD_AVAILABLE, 'optional build123d CAD runtime unavailable')
class GeometricGuards(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from build123d import Align, Box, Cylinder, Pos, Sphere

        bottom = (Align.CENTER, Align.CENTER, Align.MIN)
        cls.cylinder = Cylinder(5, 10, align=bottom)
        cls.through = cls.cylinder - Cylinder(2, 10, align=bottom)
        cls.flat_blind = cls.cylinder - Cylinder(2, 7, align=bottom)
        clip = Pos(0, 0, 5) * Box(12, 12, 6, align=bottom)
        outer = (Pos(0, 0, 5) * Sphere(4.75)) & clip
        inner = (Pos(0, 0, 5) * Sphere(3.75)) & clip
        cls.cap = ((Cylinder(5, 5, align=bottom) + outer)
                   - (Cylinder(3, 5, align=bottom) + inner)).clean()

    def test_real_flat_blind_end_not_confused_with_top(self):
        report = blind_end(self.flat_blind)
        self.assertAlmostEqual(report['boreEndZMm'], 7, places=7)
        self.assertAlmostEqual(report['axialRoofThicknessMm'], 3, places=7)
        self.assertEqual(report['boundaryWitnesses'][0]['surfaceType'], 'PLANE')

    def test_real_through_and_filled_bores_reject(self):
        for shape in (self.through, self.cylinder):
            with self.subTest(shape=shape), self.assertRaisesRegex(ValueError, 'blind axial'):
                blind_end(shape)

    def test_flat_blind_end_does_not_claim_spherical_support(self):
        with self.assertRaisesRegex(ValueError, 'exactly two'):
            spherical_cap(self.flat_blind)

    def test_disconnected_and_invalid_material_reject(self):
        from build123d import Compound, Pos

        with self.assertRaisesRegex(ValueError, 'one valid'):
            blind_end(Compound([self.flat_blind, Pos(20, 0, 0) * self.flat_blind]))

    def test_real_spherical_roof_and_shoulder(self):
        result = preflight_shape(self.cap, 6)
        self.assertAlmostEqual(result['blindEnd']['boreEndZMm'], 8.75, places=7)
        self.assertAlmostEqual(result['cap']['normalShellThicknessMm'], 1, places=7)
        self.assertFalse(result['cap']['planarFloor'])
        self.assertGreater(result['shoulder']['minimumSampledInnerRadiusJumpMm'], .749)
        self.assertEqual([s['closedWires'] for s in result['sections']], [2, 2, 2, 2, 2, 1, 1])
        self.assertTrue(result['preflightPassed'])
        self.assertFalse(result['fullModelAcceptance'])
        self.assertFalse(result['acceptedForFullH8Allocation'])
        self.assertFalse(result['h8Generated'])
        self.assertIn('new-conformal-shoulder-macro-required', [p['status'] for p in result['partitions']])

    def test_nonconcentric_dome_rejects_even_with_valid_axis_roof(self):
        from build123d import Align, Box, Cylinder, Pos, Sphere

        bottom = (Align.CENTER, Align.CENTER, Align.MIN)
        clip = Pos(0, 0, 5) * Box(12, 12, 6, align=bottom)
        outer = (Pos(0, 0, 5) * Sphere(4.75)) & clip
        inner = (Pos(.1, 0, 5) * Sphere(3.75)) & clip
        shape = ((Cylinder(5, 5, align=bottom) + outer) - (Cylinder(3, 5, align=bottom) + inner)).clean()
        with self.assertRaisesRegex(ValueError, 'coaxial|Nonconcentric'):
            preflight_shape(shape, 6)

    def test_additional_axial_cavity_is_not_ignored(self):
        from build123d import Align, Cylinder, Pos

        cavity = Pos(0, 0, 8) * Cylinder(.5, .5, align=(Align.CENTER, Align.CENTER, Align.MIN))
        with self.assertRaisesRegex(ValueError, 'blind axial'):
            blind_end(self.flat_blind - cavity)

    def test_polar_coarse_volume_error_is_rejected_not_waived(self):
        from tools.bolthex.cad_cap import build_polar_patch

        with self.assertRaisesRegex(ValueError, 'volume error'):
            build_polar_patch(self.cap, divisions=2)

    def test_polar_curved_cad_does_not_depend_on_mesh_resolution(self):
        from tools.bolthex.cad_cap import build_polar_patch

        _, _, a = build_polar_patch(self.cap, divisions=8, slope=.05)
        _, _, b = build_polar_patch(self.cap, divisions=16, slope=.05, radial_layers=2)
        self.assertAlmostEqual(a['sourceCadPartitionVolumeMm3'], b['sourceCadPartitionVolumeMm3'], places=9)
        self.assertEqual(b['quality']['elements'], 512)
        self.assertGreaterEqual(b['quality']['minimumCornerScaledJacobian'], .15)
        self.assertLessEqual(b['relativeCadH8VolumeError'], 1e-4)


@unittest.skipUnless(CAD_AVAILABLE and os.environ.get('HEXREFINE_CAP_STEP'), 'saved cap STEP not selected')
class SavedM6Cap(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = plan(os.environ['HEXREFINE_CAP_STEP'],
                          dict(family='cap_nut', standard='din1587', size='M6-1'))

    def test_original_m6_bore_ends_on_real_sphere(self):
        end, cap = self.report['blindEnd'], self.report['cap']
        self.assertTrue(all(end['checks'].values()))
        self.assertAlmostEqual(end['boreEndZMm'], 8.75, places=7)
        self.assertAlmostEqual(end['outerTopZMm'], 9.75, places=7)
        self.assertAlmostEqual(end['axialRoofThicknessMm'], 1, places=7)
        self.assertAlmostEqual(cap['inner']['radiusMm'], 3.75, places=7)
        self.assertAlmostEqual(cap['outer']['radiusMm'], 4.75, places=7)
        self.assertEqual(end['boundaryWitnesses'][0]['surfaceType'], 'SPHERE')
        self.assertTrue(self.report['threadOccupancy']['onePitchPeriodic'])
        self.assertTrue(self.report['threadOccupancy']['halfPitchChanges'])

    def test_actual_sections_and_pole_topology_are_not_h8_acceptance(self):
        report = self.report
        self.assertFalse(report['sourceIndependentCadCertified'])
        self.assertFalse(report['fullModelAcceptance'])
        self.assertFalse(report['cornerAndGaussAudited'])
        self.assertFalse(report['nodeAndFaceMatchingAudited'])
        self.assertEqual(len(report['sourceStepSHA256']), 64)
        self.assertEqual([s['topology'] for s in report['sections']], ['annulus'] * 5 + ['disk'] * 2)
        for section in report['sections'][2:]:
            z = section['zMm']
            for sample in section['samples']:
                self.assertAlmostEqual(sample['outerRadiusMm'], math.sqrt(4.75**2 - (z - 5)**2), places=7)
                inner = math.sqrt(max(0, 3.75**2 - (z - 5)**2))
                self.assertAlmostEqual(sample['innerRadiusMm'], inner, places=7)
                self.assertLessEqual(sample['boundaryDistanceMm'], 2e-6)


@unittest.skipUnless(CAD_AVAILABLE and os.environ.get('HEXREFINE_CAP_STEP'), 'saved cap STEP not selected')
class SavedM6Polar(unittest.TestCase):
    def test_actual_polar_h8_is_nondegenerate_and_local_only(self):
        import numpy as np
        from build123d import import_step
        from tools.bolthex.cad_cap import build_polar_patch

        mesh, _, report = build_polar_patch(import_step(os.environ['HEXREFINE_CAP_STEP']))
        self.assertTrue(report['localPatchAccepted'])
        self.assertFalse(report['fullModelAcceptance'])
        self.assertFalse(report['fullCapNut'])
        self.assertEqual(report['quality']['elements'], 1600)
        self.assertEqual(len(np.unique(mesh.nodes, axis=0)), len(mesh.nodes))
        self.assertTrue(np.all(np.diff(np.sort(mesh.elems, axis=1), axis=1) > 0))
        self.assertGreaterEqual(report['quality']['minimumCornerScaledJacobian'], .15)
        self.assertGreater(report['quality']['minimumGaussJacobian'], 0)
        self.assertEqual(report['quality']['boundaryEuler'], 2)
        self.assertLessEqual(report['relativeCadH8VolumeError'], 1e-4)
        self.assertLessEqual(report['maximumOriginalSphereNodeDistanceMm'], 2e-6)
        self.assertLessEqual(report['maximumPartitionBoundaryNodeDistanceMm'], 2e-6)
        self.assertLessEqual(report['maximumPartitionFaceCenterDistanceMm'], .02)
        self.assertLess(report['arrayBytes'], 1024**2)


if __name__ == '__main__':
    unittest.main()
