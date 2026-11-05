"""TG-free regressions: eight slots and positive volume do not imply H8."""
from dataclasses import replace
import hashlib
import os
from pathlib import Path
import tempfile
import unittest

import numpy as np

from tools.bolthex.truegrid_screw import (
    ImportedSolids, MAX_ELEMENTS, audit_import, main, read_keyword,
    require_nondegenerate_h8, write_diagnostic_inp,
)


CUBE = np.array([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
                 [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], float)


def mesh(nodes=None, conn=None):
    return ImportedSolids(CUBE.copy() if nodes is None else nodes,
                          np.array([range(8) if conn is None else conn]),
                          np.arange(11, 19), np.array([101]), np.array([3]),
                          {'*ELEMENT_SOLID': 1}, '')


class AuditTests(unittest.TestCase):
    def test_unit_cube_passes_only_mesh_scope(self):
        report = require_nondegenerate_h8(mesh())
        self.assertTrue(report['meshOnlyAccepted'])
        self.assertFalse(report['fullModelAccepted'])
        self.assertFalse(report['cadVerified'])
        self.assertEqual(report['uniqueNodeIDHistogram'], {8: 1})
        self.assertEqual(report['uniquePositionHistogram'], {8: 1})
        self.assertAlmostEqual(report['minimumCornerScaledJacobian'], 1)
        self.assertAlmostEqual(report['minimumGaussJacobian'], .125)
        self.assertAlmostEqual(report['integratedVolume'], 1)
        self.assertEqual(report['topology']['boundaryEuler'], 2)

    def test_axis_wedge_positive_volume_and_gauss_still_rejected(self):
        # LS-DYNA collapsed-wedge slots: (0,1,2,2,4,5,6,6).
        wedge = mesh(conn=[0, 1, 2, 2, 4, 5, 6, 6])
        wedge.nodes[[2, 6], :2] = 0
        wedge.nodes[[0, 4], :2] = [1, 0]
        wedge.nodes[[1, 5], :2] = [0, 1]
        report = audit_import(wedge)
        self.assertGreater(report['integratedVolume'], 0)
        self.assertGreater(report['minimumGaussJacobian'], 0)
        self.assertEqual(report['uniqueNodeIDHistogram'], {6: 1})
        self.assertEqual(report['axisCollapsedElementIDs'], [101])
        self.assertEqual(report['minimumCornerScaledJacobian'], 0)
        with self.assertRaisesRegex(ValueError, 'Z-axis collapse'):
            require_nondegenerate_h8(wedge)

    def test_distinct_ids_cannot_hide_coincident_coordinates(self):
        nodes = CUBE.copy()
        nodes[[1, 5]] = nodes[[0, 4]]
        report = audit_import(mesh(nodes=nodes))
        self.assertEqual(report['uniqueNodeIDHistogram'], {8: 1})
        self.assertEqual(report['uniquePositionHistogram'], {6: 1})
        self.assertEqual(report['repeatedNodeElementIDs'], [])
        self.assertEqual(report['axisCollapsedElementIDs'], [101])
        self.assertFalse(report['meshOnlyAccepted'])

    def test_measured_tg_cell_2817_has_seven_positions_not_c3d6(self):
        # Generated output evidence, not the proprietary Screw command stream.
        nodes = np.array([[0, 0, -.2], [.9, 0, -.2], [.886327, .1562833, -.2],
                          [0, 0, -.2], [0, 0, -.1], [.9, 0, -.1],
                          [.886327, .1562833, -.09444445], [0, 0, -.09444445]])
        actual = replace(mesh(nodes=nodes), element_ids=np.array([2817]))
        report = audit_import(actual)
        self.assertEqual(report['uniqueNodeIDHistogram'], {8: 1})
        self.assertEqual(report['uniquePositionHistogram'], {7: 1})
        self.assertEqual(report['axisCollapsedElementIDs'], [2817])
        self.assertGreater(report['integratedVolume'], 0)
        self.assertGreater(report['minimumGaussJacobian'], 0)
        self.assertFalse(report['meshOnlyAccepted'])

    def test_near_coincidence_is_not_resolved_by_id_uniqueness(self):
        nodes = CUBE.copy()
        nodes[1] = nodes[0] + [1e-12, 0, 0]
        report = audit_import(mesh(nodes=nodes))
        self.assertEqual(report['coincidentPositionElementIDs'], [101])

    def test_translated_collapse_is_not_mislabelled_global_axis(self):
        nodes = CUBE.copy() + [12, 23, 0]
        nodes[[1, 5]] = nodes[[0, 4]]
        report = audit_import(mesh(nodes=nodes))
        self.assertEqual(report['coincidentPositionElementIDs'], [101])
        self.assertEqual(report['axisCollapsedElementIDs'], [])

    def test_inversion_is_not_repaired_with_absolute_volume(self):
        inverted = mesh(nodes=CUBE * [-1, 1, 1])
        report = audit_import(inverted)
        self.assertLess(report['integratedVolume'], 0)
        self.assertEqual(report['nonpositiveVolumeElementIDs'], [101])
        self.assertFalse(report['meshOnlyAccepted'])

    def test_positive_volume_low_sj_is_rejected_at_unchanged_gate(self):
        nodes = CUBE.copy()
        nodes[:, 0] += 10 * nodes[:, 1]
        report = audit_import(mesh(nodes=nodes))
        self.assertAlmostEqual(report['integratedVolume'], 1)
        self.assertLess(report['minimumCornerScaledJacobian'], .15)
        self.assertFalse(report['meshOnlyAccepted'])

    def test_extra_element_type_is_not_silently_dropped(self):
        report = audit_import(replace(mesh(), element_cards={'*ELEMENT_SOLID': 1, '*ELEMENT_SHELL': 1}))
        self.assertFalse(report['meshOnlyAccepted'])
        self.assertIn('Non-H8/unsupported element cards present', report['rejectionReasons'])

    def test_duplicate_hex_rejected_by_existing_topology_gate(self):
        m = mesh()
        report = audit_import(replace(m, elements=np.tile(m.elements, (2, 1)), element_ids=np.array([101, 202])))
        self.assertIn('Duplicate elements', report['rejectionReasons'])

    def test_bad_arrays_and_element_budget_fail_before_large_gathers(self):
        for bad in (np.array([[0.] * 8]), np.array([[0, 1, 2, 3, 4, 5, 6, 99]])):
            with self.assertRaisesRegex(ValueError, 'Invalid finite'):
                audit_import(replace(mesh(), elements=bad))
        with self.assertRaisesRegex(ValueError, '100000'):
            audit_import(replace(mesh(), elements=np.zeros((MAX_ELEMENTS + 1, 8), dtype=int)))


class KeywordTests(unittest.TestCase):
    def setUp(self):
        root = os.environ.get('BOLTHEX_TEST_ROOT')
        self.temp = tempfile.TemporaryDirectory(prefix='truegrid-test-', dir=root)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / 'reference.k'

    def deck(self, *, fixed=False, wedge=False, extra=''):
        rows = ['*KEYWORD', '*TITLE', 'Test source', '*NODE']
        for i, xyz in enumerate(CUBE, 11):
            rows.append((f'{i:8d}' + ''.join(f'{v:16.8E}' for v in xyz)) if fixed
                        else f'{i},' + ','.join(map(str, xyz)))
        conn = [11, 12, 13, 13, 15, 16, 17, 17] if wedge else list(range(11, 19))
        values = [101, 3, *conn]
        rows += ['*ELEMENT_SOLID', ''.join(f'{v:8d}' for v in values) if fixed
                 else ','.join(map(str, values)), extra, '*END']
        self.path.write_text('\n'.join(rows) + '\n', encoding='ascii')
        return read_keyword(self.path)

    def test_free_and_fixed_format_keep_ids_hash_and_volume(self):
        for fixed in (False, True):
            with self.subTest(fixed=fixed):
                m = self.deck(fixed=fixed)
                np.testing.assert_array_equal(m.node_ids, np.arange(11, 19))
                np.testing.assert_array_equal(m.element_ids, [101])
                np.testing.assert_array_equal(m.part_ids, [3])
                self.assertEqual(m.source_sha256, hashlib.sha256(self.path.read_bytes()).hexdigest())
                self.assertAlmostEqual(require_nondegenerate_h8(m)['integratedVolume'], 1)

    def test_diagnostic_preserves_bad_slots_and_refuses_overwrite(self):
        m = self.deck(wedge=True)
        out = self.root / 'diagnostic.inp'
        report = write_diagnostic_inp(m, out)
        self.assertFalse(report['meshOnlyAccepted'])
        self.assertIn('REJECTED H8 NEGATIVE CONTROL', out.read_text())
        self.assertIn('101, 11, 12, 13, 13, 15, 16, 17, 17', out.read_text())
        with self.assertRaises(FileExistsError):
            write_diagnostic_inp(m, out)

    def test_packed_fixed_width_ids_and_d_exponents(self):
        self.deck(fixed=True)
        text = self.path.read_text().replace('E+', 'D+')
        for i in range(11, 19):
            text = text.replace(f'{i:8d}', f'{10000000 + i:8d}')
        self.path.write_text(text)
        m = read_keyword(self.path)
        np.testing.assert_array_equal(m.node_ids, np.arange(10000011, 10000019))
        self.assertTrue(require_nondegenerate_h8(m)['meshOnlyAccepted'])

    def test_meshio_diagnostic_round_trip(self):
        import meshio
        for wedge in (False, True):
            with self.subTest(wedge=wedge):
                m = self.deck(wedge=wedge)
                out = self.root / f'roundtrip-{wedge}.inp'
                write_diagnostic_inp(m, out)
                reopened = meshio.read(out, file_format='abaqus')
                np.testing.assert_array_equal(reopened.points, m.nodes)
                np.testing.assert_array_equal(reopened.get_cells_type('hexahedron'), m.elements)

    def test_unknown_mesh_card_include_and_truncation_reject(self):
        self.deck()
        original = self.path.read_text()
        for card in ('*INCLUDE', '*NODE_TRANSFORM', '*ELEMENT_SOLID_T', '*DEFINE_TRANSFORMATION', '*PARAMETER'):
            self.path.write_text(original.replace('*END', card + '\n*END'))
            with self.subTest(card=card), self.assertRaisesRegex(ValueError, 'Unsupported'):
                read_keyword(self.path)
        self.path.write_text(original.replace('*END', ''))
        with self.assertRaisesRegex(ValueError, 'Require'):
            read_keyword(self.path)

    def test_duplicate_node_missing_reference_nonfinite_reject(self):
        self.deck()
        original = self.path.read_text()
        for old, new in (('12,1.0', '11,1.0'), ('101,3,11', '101,3,99'), ('11,0.0', '11,nan')):
            self.path.write_text(original.replace(old, new))
            with self.subTest(old=old), self.assertRaises(ValueError):
                read_keyword(self.path)

    def test_cli_rejected_exit_and_fresh_evidence(self):
        from contextlib import redirect_stdout
        from io import StringIO
        self.deck(wedge=True)
        output = self.root / 'audit'
        with redirect_stdout(StringIO()):
            self.assertEqual(main([str(self.path), str(output)]), 2)
        self.assertIn('REJECTED', (output / 'result.txt').read_text())
        self.assertTrue((output / 'diagnostic.inp').is_file())
        with self.assertRaises(FileExistsError):
            main([str(self.path), str(output)])


if __name__ == '__main__':
    unittest.main()
