from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import unittest
import numpy as np

from tools.bolthex.exact_face_compensation import compensate_faces
from tools.bolthex.truegrid_screw import ImportedSolids, read_keyword
from tools.bolthex.mesh_audit import SIGNS


def fixture():
    a = (SIGNS+1)/2
    b = a+np.array([1., 0., 0.])
    return ImportedSolids(np.vstack((a, b)), np.arange(16).reshape(2, 8),
        np.arange(1, 17), np.array([10, 20]), np.ones(2, dtype=int), {}, '')


class ExactCompensationTests(unittest.TestCase):
    def test_full_opposite_faces_join_without_coordinate_or_id_changes(self):
        mesh = fixture()
        new, r = compensate_faces(mesh, [((10, 4), (20, 6))], allowed_element_ids=[10, 20])
        self.assertEqual(r['pairedFaces'], 1)
        self.assertEqual(r['facePairsAfter']-r['facePairsBefore'], 1)
        self.assertEqual(len(r['aliases']), 4)
        np.testing.assert_array_equal(mesh.nodes[new.elements], mesh.nodes[mesh.elements])
        np.testing.assert_array_equal(mesh.nodes, new.nodes)
        np.testing.assert_array_equal(mesh.elements, np.arange(16).reshape(2, 8))
        self.assertFalse(r['wholeMeshAccepted'])
        self.assertFalse(r['globalManifoldCertified'])
        new.element_cards['test'] = 1
        self.assertNotIn('test', mesh.element_cards)

    def test_near_points_are_not_exact_equivalence(self):
        mesh = fixture()
        mesh.nodes[8:, 0] += 1e-12
        with self.assertRaisesRegex(ValueError, 'exact opposite'):
            compensate_faces(mesh, [((10, 4), (20, 6))], allowed_element_ids=[10, 20])

    def test_scope_and_face_binding_errors(self):
        for pairs, scope in (([((10, 4), (20, 6))], [10]),
                             ([((10, 4), (10, 4))], [10]),
                             ([((10, 0), (20, 6))], [10, 20]),
                             ([], [10]), ([((10, 4), (20, 6))]*2, [10, 20])):
            with self.subTest(pairs=pairs, scope=scope), self.assertRaises(ValueError):
                compensate_faces(fixture(), pairs, allowed_element_ids=scope)

    def test_protected_master_is_preserved(self):
        mesh = fixture()
        nodes = np.vstack((mesh.nodes, mesh.nodes[:8]+[0., 0., -1.]))
        # Third cell references first-cell interface nodes; it is protected.
        cell = np.array([[16, 17, 18, 19, 0, 1, 2, 3]])
        mesh = replace(mesh, nodes=nodes, node_ids=np.arange(1, 25),
            elements=np.vstack((mesh.elements, cell)), element_ids=np.array([10, 20, 30]),
            part_ids=np.ones(3, dtype=int))
        original = mesh.elements.copy()
        new, r = compensate_faces(mesh, [((10, 4), (20, 6))], allowed_element_ids=[10, 20])
        np.testing.assert_array_equal(new.elements[2], original[2])
        self.assertTrue(r['protectedConnectivityUnchanged'])
        np.testing.assert_array_equal(mesh.elements, original)

    def test_bad_arrays_reject(self):
        mesh = fixture()
        for bad in (replace(mesh, elements=mesh.elements[:, :7]),
                    replace(mesh, nodes=np.full_like(mesh.nodes, np.nan)),
                    replace(mesh, node_ids=np.ones(16, dtype=int))):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                compensate_faces(bad, [((10, 4), (20, 6))], allowed_element_ids=[10, 20])

    def test_two_protected_node_owners_cannot_be_renumbered(self):
        mesh = fixture()
        nodes = np.vstack((mesh.nodes, mesh.nodes[:4]-[0., 0., 1.],
                           mesh.nodes[8:12]-[0., 0., 1.]))
        extra = np.array([[16, 17, 18, 19, 0, 1, 2, 3],
                          [20, 21, 22, 23, 8, 9, 10, 11]])
        mesh = replace(mesh, nodes=nodes, node_ids=np.arange(1, 25),
                       elements=np.vstack((mesh.elements, extra)),
                       element_ids=np.array([10, 20, 30, 40]), part_ids=np.ones(4, dtype=int))
        original = mesh.elements.copy()
        with self.assertRaisesRegex(ValueError, 'Both equivalent nodes'):
            compensate_faces(mesh, [((10, 4), (20, 6))], allowed_element_ids=[10, 20])
        np.testing.assert_array_equal(mesh.elements, original)


@unittest.skipUnless(os.environ.get('HEAD_COMPENSATION_CASE'), 'Explicit actual case receipt required')
class ActualHeadCompensationTests(unittest.TestCase):
    def test_real_6128_cell_case_roundtrip_and_scope(self):
        root = Path(os.environ['HEAD_COMPENSATION_CASE'])
        r = json.loads((root/'report.json').read_bytes())
        for path, digest in r['inputSHA256'].items():
            self.assertEqual(hashlib.sha256(Path(path).read_bytes()).hexdigest(), digest)
        for name, metadata in r['artifacts'].items():
            content = (root/name).read_bytes()
            self.assertEqual(len(content), metadata['bytes'])
            self.assertEqual(hashlib.sha256(content).hexdigest(), metadata['sha256'])
        source = read_keyword(next(Path(p) for p in r['inputSHA256'] if p.endswith('phase-compensated-source.k')))
        candidate = read_keyword(root/'head-compensated-phase-source.k')
        pairs = [(tuple(a), tuple(b)) for a, b in r['selectedFacePairs']]
        new, actual = compensate_faces(source, pairs, allowed_element_ids=r['allowedElementIDs'])
        self.assertEqual(len(new.elements), 6128)
        self.assertEqual(len(actual['changedElementIDs']), 16)
        self.assertEqual(actual['changedSlots'], 24)
        self.assertEqual(actual['facePairsAfter']-actual['facePairsBefore'], 4)
        np.testing.assert_array_equal(new.elements, candidate.elements)
        np.testing.assert_array_equal(new.nodes, candidate.nodes)
        np.testing.assert_array_equal(new.node_ids, candidate.node_ids)
        np.testing.assert_array_equal(new.element_ids, candidate.element_ids)
        np.testing.assert_array_equal(new.part_ids, candidate.part_ids)
        import meshio
        inp = meshio.read(root/'head-compensated-phase-source.inp', file_format='abaqus')
        np.testing.assert_array_equal(inp.points, new.nodes)
        np.testing.assert_array_equal(inp.get_cells_type('hexahedron'), new.elements)
        protected = ~np.isin(source.element_ids, actual['changedElementIDs'])
        np.testing.assert_array_equal(source.elements[protected], new.elements[protected])
        self.assertEqual(r['closedCycleEdges'], 68)
        self.assertTrue(r['ioRoundtrip']['k'] and r['ioRoundtrip']['inp'])
        self.assertFalse(r['axisRepairCompleted'])


if __name__ == '__main__':
    unittest.main()
