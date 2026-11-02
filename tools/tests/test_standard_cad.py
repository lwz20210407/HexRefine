"""Pure request guards: no optional CAD installation is required."""
import math
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from tools.bolthex.standard_cad import CadRequest, _load_backend, generate


class StandardCadRequestTests(unittest.TestCase):
    def test_design_only_request(self):
        result = CadRequest.parse(dict(family='hex_bolt', standard='iso4017', size='M6-1', length=12))
        self.assertEqual(result.length, 12)
        self.assertEqual(result.hand, 'right')

    def test_mesh_fields_are_forbidden(self):
        for name in ('nodes', 'elements', 'radialSeeds', 'sections', 'simple'):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'Unknown design fields'):
                CadRequest.parse(dict(family='hex_nut', standard='iso4032', size='M6-1', **{name: 8}))

    def test_invalid_length_and_cross_standard_alias(self):
        for length in (None, False, 0, -1, math.inf, math.nan, '12'):
            with self.subTest(length=length), self.assertRaises(ValueError):
                CadRequest.parse(dict(family='hex_bolt', standard='iso4017', size='M6-1', length=length))
        with self.assertRaises(ValueError):
            CadRequest.parse(dict(family='hex_bolt', standard='GB5783', size='M6-1', length=12))

    def test_family_semantics(self):
        with self.assertRaises(ValueError):
            CadRequest.parse(dict(family='cap_nut', standard='din1587', size='M6-1', length=6))
        with self.assertRaises(ValueError):
            CadRequest.parse(dict(family='socket_bolt', standard='iso4762', size='M6-1', length=12, hand='both'))
        with self.assertRaises(ValueError):
            CadRequest.parse([])

    def test_wrong_source_pin_is_rejected_before_import(self):
        with patch('tools.bolthex.standard_cad.subprocess.check_output', side_effect=['wrong-sha', '']):
            with self.assertRaisesRegex(ValueError, 'pinned source'):
                _load_backend(Path('untrusted-source'))

    def test_existing_output_is_not_overwritten(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as temporary:
            target = Path(temporary)
            sentinel = target / 'user.txt'
            sentinel.write_text('preserve')
            with self.assertRaisesRegex(ValueError, 'new output directory'):
                generate(dict(family='hex_bolt', standard='iso4017', size='M6-1', length=12), target)
            self.assertEqual(sentinel.read_text(), 'preserve')


if __name__ == '__main__':
    unittest.main()
