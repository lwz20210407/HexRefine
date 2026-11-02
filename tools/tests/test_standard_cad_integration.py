"""Opt-in real CAD regression, including strict rejected round-trip cases.

Set HEXREFINE_RUN_SLOW_CAD=1, HEXREFINE_CAD_SOURCE to the pinned checkout and
BOLTHEX_TEST_ROOT to an existing task directory; use the CAD interpreter.
"""
import os
from pathlib import Path
import tempfile
import unittest
from tools.bolthex.standard_cad import generate


@unittest.skipUnless(os.environ.get('HEXREFINE_CAD_SOURCE') and os.environ.get('HEXREFINE_RUN_SLOW_CAD')=='1', 'slow CAD construction suite requires explicit HEXREFINE_RUN_SLOW_CAD=1')
class StandardCadIntegrationTests(unittest.TestCase):
    def test_real_nominal_design_geometry(self):
        source = Path(os.environ['HEXREFINE_CAD_SOURCE'])
        parent = os.environ.get('BOLTHEX_TEST_ROOT')
        if not parent:
            self.fail('Set BOLTHEX_TEST_ROOT; do not scatter CAD test outputs in system temp')
        cases = [
            ('hex-M6', dict(family='hex_bolt', standard='iso4017', size='M6-1', length=12), True),
            ('nut-M8', dict(family='hex_nut', standard='iso4032', size='M8-1.25'), True),
            ('hex-left', dict(family='hex_bolt', standard='iso4017', size='M8-1.25', length=16, hand='left'), True),
            ('socket-M6', dict(family='socket_bolt', standard='iso4762', size='M6-1', length=12), True),
            ('socket-US', dict(family='socket_bolt', standard='asme_b18.3', size='1/4-20', length=19.05), True),
            ('nut-M6', dict(family='hex_nut', standard='iso4032', size='M6-1'), True),
            ('cap-M6', dict(family='cap_nut', standard='din1587', size='M6-1'), True),
            ('through-nut-M6', dict(family='hex_nut', standard='iso4032', size='M6-1',thread_ends='square'), True),
        ]
        with tempfile.TemporaryDirectory(prefix='standard-cad-tests-', dir=parent) as temporary:
            for name, request, accepted in cases:
                with self.subTest(name=name):
                    target = Path(temporary) / name
                    if accepted:
                        result = generate(request, target, source)
                        self.assertTrue(result['geometryIndependentOfMesh'])
                        self.assertFalse(result['matchedMeshVerified'])
                        self.assertEqual(result['solids'], 1)
                        self.assertTrue(result['thread']['onePitchPeriodic'])
                        self.assertLessEqual(result['relativeReopenVolumeError'], 1e-7)
                        self.assertTrue((target / 'model.step').is_file())
                    else:
                        with self.assertRaisesRegex(ValueError, 'STEP mass changed'):
                            generate(request, target, source)
                        self.assertFalse(target.exists(), 'Rejected geometry must not be published')


if __name__ == '__main__':
    unittest.main()
