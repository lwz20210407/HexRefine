import hashlib
import json
import os
from pathlib import Path
import unittest

import numpy as np

from tools.bolthex.h8_boundary_pillow import (
    match_native_three_prism, native_three_prism_seed,
    oriented_hex_boundary, pillow_boundary,
)
from tools.bolthex.h8_quality_report import measure_h8
from tools.bolthex.h8_jacobian_certificate import certify_cell
from tools.bolthex.mesh_audit import SIGNS
from tools.bolthex.volume_patch_assembly import boundary_volume


def cycle(q):
    q = tuple(map(int, q))
    return min(q[i:] + q[:i] for i in range(4))


def face_map(faces):
    return {tuple(sorted(map(int, q))): cycle(q) for q in faces}


def cube():
    ids = np.arange(101, 109, dtype=np.int64)
    points = (SIGNS.astype(float) + 1) / 2
    seed = ids.reshape(1, 8)
    return ids, points, oriented_hex_boundary(seed), seed


def prism_points():
    theta = np.arange(6) * np.pi / 3
    bottom = np.column_stack((np.cos(theta), np.sin(theta), np.zeros(6)))
    bottom = np.vstack((bottom, np.zeros(3)))
    return np.vstack((bottom, bottom + [0., 0., 1.]))


class NativePrismTests(unittest.TestCase):
    def test_native_sectors_extruded_not_a_cached_table(self):
        seed = native_three_prism_seed()
        np.testing.assert_array_equal(seed[:, :4], [[0, 1, 2, 6], [2, 3, 4, 6], [4, 5, 0, 6]])
        np.testing.assert_array_equal(seed[:, 4:], seed[:, :4] + 7)
        self.assertEqual(seed.shape, (3, 8))
        self.assertEqual(len(np.unique(seed)), 14)
        faces = oriented_hex_boundary(seed)
        self.assertEqual(faces.shape, (12, 4))
        self.assertTrue(measure_h8(prism_points(), seed)['sampledPositiveJacobians'].all())

    def test_native_seed_returns_independent_arrays(self):
        seed = native_three_prism_seed()
        seed[0, 0] = 999
        self.assertEqual(native_three_prism_seed()[0, 0], 0)

    def test_typed_graph_match_keeps_every_literal_cycle(self):
        seed = native_three_prism_seed()
        ids = np.array([91, 7, 130, 49, 2001, 5, 72, 18, 901, 360, 40, 111, 53, 622])
        faces = oriented_hex_boundary(ids[seed])
        faces = np.roll(faces[::-1], 1, axis=1)
        matched = match_native_three_prism(faces)
        self.assertEqual(face_map(oriented_hex_boundary(matched)), face_map(faces))
        self.assertEqual(set(map(int, matched.flat)), set(map(int, ids)))
        self.assertEqual(len(matched), 3)

    def test_consistent_global_reflection_preserves_requested_orientation(self):
        faces = oriented_hex_boundary(native_three_prism_seed())[:, ::-1]
        matched = match_native_three_prism(faces)
        self.assertEqual(face_map(oriented_hex_boundary(matched)), face_map(faces))

    def test_one_reversed_face_is_not_a_valid_oriented_shell(self):
        faces = oriented_hex_boundary(native_three_prism_seed())
        faces[0] = faces[0, ::-1]
        with self.assertRaisesRegex(ValueError, 'orientations'):
            match_native_three_prism(faces)

    def test_missing_face_and_duplicate_face_reject(self):
        faces = oriented_hex_boundary(native_three_prism_seed())
        for invalid in (faces[:-1], np.vstack((faces, faces[:1]))):
            with self.subTest(faces=len(invalid)), self.assertRaises(ValueError):
                match_native_three_prism(invalid)

    def test_wrong_native_boundary_counts_reject(self):
        with self.assertRaisesRegex(ValueError, '12 Q4'):
            match_native_three_prism(cube()[2])

    def test_same12q14v_counts_are_not_a_prism_isomorphism(self):
        # A tetrahedron's barycentrically quadrangulated surface has the same
        # counts, but a different typed face/edge/vertex incidence graph.
        triangles = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]]
        mids = {}
        for triangle in triangles:
            for j, a in enumerate(triangle):
                edge = tuple(sorted((a, triangle[(j + 1) % 3])))
                if edge not in mids:
                    mids[edge] = 4 + len(mids)
        quads = []
        for fi, triangle in enumerate(triangles):
            center = 10 + fi
            for j, a in enumerate(triangle):
                before, after = triangle[j - 1], triangle[(j + 1) % 3]
                quads.append([a, mids[tuple(sorted((a, after)))], center,
                              mids[tuple(sorted((before, a)))]])
        self.assertEqual(len(quads), 12)
        self.assertEqual(len(set(n for q in quads for n in q)), 14)
        with self.assertRaisesRegex(ValueError, 'incidence isomorphism'):
            match_native_three_prism(quads)

    def test_large_literal_ids_are_not_rounded_to_floats(self):
        ids = np.arange(14, dtype=np.int64) + (np.iinfo(np.int64).max - 13)
        faces = oriented_hex_boundary(ids[native_three_prism_seed()])
        matched = match_native_three_prism(faces)
        self.assertEqual(set(map(int, matched.flat)), set(map(int, ids)))
        self.assertEqual(face_map(oriented_hex_boundary(matched)), face_map(faces))

    def test_explicit_graph_budget_is_not_nonexistence_proof(self):
        faces = oriented_hex_boundary(native_three_prism_seed())
        with self.assertRaisesRegex(ValueError, 'budget exhausted; no nonexistence'):
            match_native_three_prism(faces, maximum_search_states=1)
        for bad in (0, -1, True, 3.5):
            with self.subTest(budget=bad), self.assertRaises(ValueError):
                match_native_three_prism(faces, maximum_search_states=bad)


class BoundaryPillowTests(unittest.TestCase):
    def test_unit_cube_whole_boundary_pillow7_exact_positive(self):
        ids, points, faces, seed = cube()
        patch = pillow_boundary(ids, points, faces, seed)
        self.assertEqual(patch.nodes.shape, (16, 3))
        self.assertEqual(patch.elements.shape, (7, 8))
        np.testing.assert_array_equal(patch.nodes[:8], points)
        actual = oriented_hex_boundary(patch.elements)
        self.assertEqual(face_map(actual), face_map(patch.boundary_faces))
        literal = np.array(ids)[actual]
        self.assertEqual(face_map(literal), face_map(faces))
        metrics = measure_h8(patch.nodes, patch.elements)
        self.assertTrue(metrics['sampledPositiveJacobians'].all())
        self.assertAlmostEqual(float(metrics['integratedVolume'].sum()), 1.)
        self.assertAlmostEqual(boundary_volume(actual, dict(enumerate(patch.nodes))), 1.)
        self.assertTrue(all(certify_cell(patch.nodes[c])['certified'] for c in patch.elements))
        self.assertFalse(patch.to_contract()['continuousJacobianCertified'])

    def test_regular_native_prism_whole_boundary15(self):
        ids = np.arange(1000, 1014)
        faces = oriented_hex_boundary(ids[native_three_prism_seed()])
        matched = match_native_three_prism(faces)
        patch = pillow_boundary(ids, prism_points(), faces, matched)
        self.assertEqual(patch.elements.shape, (15, 8))
        self.assertEqual(patch.nodes.shape, (28, 3))
        self.assertEqual(len(oriented_hex_boundary(patch.elements)), 12)
        np.testing.assert_array_equal(patch.nodes[:14], prism_points())
        self.assertFalse(patch.to_contract()['shapeAccepted'])

    def test_literal_bindings_local_interior_ids_and_no_global_allocation(self):
        ids, points, faces, seed = cube()
        patch = pillow_boundary(ids[::-1], points[::-1], faces, seed)
        contract = patch.to_contract()
        self.assertEqual(patch.boundary_node_ids, tuple(map(int, ids[::-1])))
        self.assertEqual(contract['boundaryBindings'], [dict(nodeID=int(n), localIndex=i) for i, n in enumerate(ids[::-1])])
        self.assertEqual(patch.interior_node_indices, tuple(range(8, 16)))
        self.assertFalse(contract['globalNodeIDsAssigned'])
        self.assertEqual(int(patch.elements.max()), 15)

    def test_protected_arrays_and_inputs_are_not_changed(self):
        ids, points, faces, seed = cube()
        original = [a.copy() for a in (ids, points, faces, seed)]
        points[0, 0] = np.nextafter(0., 1.)
        original[1] = points.copy()
        patch = pillow_boundary(ids, points, faces, seed)
        for value, expected in zip((ids, points, faces, seed), original):
            np.testing.assert_array_equal(value, expected)
        np.testing.assert_array_equal(patch.nodes[:8], points)
        for array in (patch.nodes, patch.elements, patch.boundary_faces, patch.seed_elements):
            self.assertFalse(array.flags.writeable)

    def test_distinct_nids_are_not_welded_even_when_coordinates_coincide(self):
        ids, points, faces, seed = cube()
        points[1] = points[0]
        patch = pillow_boundary(ids, points, faces, seed)
        self.assertEqual(len(set(patch.boundary_node_ids)), 8)
        self.assertEqual(len(patch.nodes), 16)
        self.assertFalse(patch.to_contract()['shapeAccepted'])

    def test_no_geometry_or_engineering_acceptance_from_topology(self):
        patch = pillow_boundary(*cube())
        contract = patch.to_contract()
        for flag in ('shapeAccepted', 'engineeringQualityAccepted', 'continuousJacobianCertified',
                     'globalOverlapCertified', 'wholeModelAccepted'):
            self.assertFalse(contract[flag])
        contract['shapeAccepted'] = True
        self.assertFalse(patch.to_contract()['shapeAccepted'])
        json.dumps(patch.to_contract(), allow_nan=False)

    def test_duplicate_or_missing_boundary_bindings_reject(self):
        ids, points, faces, seed = cube()
        for bad in (np.r_[ids[:-1], ids[0]], ids + 1000):
            with self.subTest(ids=bad.tolist()), self.assertRaises(ValueError):
                pillow_boundary(bad, points, faces, seed)

    def test_seed_wrong_boundary_orientation_or_new_unbound_identity_reject(self):
        ids, points, faces, seed = cube()
        wrong = seed[:, [1, 0, 3, 2, 5, 4, 7, 6]]
        with self.assertRaisesRegex(ValueError, 'oriented boundary face'):
            pillow_boundary(ids, points, faces, wrong)
        wrong = seed.copy()
        wrong[0, 0] = 99999
        with self.assertRaisesRegex(ValueError, 'Seed must use exactly'):
            pillow_boundary(ids, points, faces, wrong)

    def test_nonfinite_or_complex_boundary_xyz_reject(self):
        ids, points, faces, seed = cube()
        for bad in (points * np.nan, points.astype(complex), points[:-1]):
            with self.subTest(shape=bad.shape), self.assertRaises(ValueError):
                pillow_boundary(ids, bad, faces, seed)

    def test_protected_integer_xyz_is_not_silently_rounded(self):
        ids, _, faces, seed = cube()
        points = np.zeros((8, 3), dtype=np.int64)
        points[0, 0] = 2**53 + 1
        with self.assertRaisesRegex(ValueError, 'exactly representable'):
            pillow_boundary(ids, points, faces, seed)

    def test_identity_types_and_repeated_q4_vertex_reject(self):
        ids, points, faces, seed = cube()
        for bad in (ids.astype(float), np.array([True] * 8), ids - 1000):
            with self.subTest(dtype=bad.dtype), self.assertRaises(ValueError):
                pillow_boundary(bad, points, faces, seed)
        faces[0, 0] = faces[0, 1]
        with self.assertRaisesRegex(ValueError, 'four distinct'):
            pillow_boundary(ids, points, faces, seed)

    def test_unsigned_identity_overflow_is_rejected_not_wrapped(self):
        ids, points, faces, seed = cube()
        overflow = ids.astype(np.uint64)
        overflow[0] = np.iinfo(np.uint64).max
        with self.assertRaisesRegex(ValueError, 'int64 identities'):
            pillow_boundary(overflow, points, faces, seed)

    def test_duplicate_and_nonmanifold_h8_faces_reject(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate H8'):
            oriented_hex_boundary(np.tile(np.arange(8), (2, 1)))
        cells = np.array([[0, 1, 2, 3, 4, 5, 6, 7],
                          [0, 1, 2, 3, 8, 9, 10, 11],
                          [0, 1, 2, 3, 12, 13, 14, 15]])
        with self.assertRaisesRegex(ValueError, 'Nonmanifold'):
            oriented_hex_boundary(cells)

    def test_disconnected_sphere_union_is_not_a_single_cavity(self):
        ids, points, faces, seed = cube()
        with self.assertRaisesRegex(ValueError, 'connected sphere'):
            pillow_boundary(np.r_[ids, ids + 1000], np.vstack((points, points + 2)),
                            np.vstack((faces, faces + 1000)), np.vstack((seed, seed + 1000)))


@unittest.skipUnless(os.environ.get('H8_BOUNDARY_PILLOW_ACTUAL_HEAD'), 'Explicit actual head12Q fixture required')
class ActualHeadPillowTests(unittest.TestCase):
    def test_actual_full12q_boundary_native15_and_literal_bindings(self):
        path = Path(os.environ['H8_BOUNDARY_PILLOW_ACTUAL_HEAD'])
        data = path.read_bytes()
        expected_sha = os.environ.get('H8_BOUNDARY_PILLOW_ACTUAL_SHA256')
        if expected_sha:
            self.assertEqual(hashlib.sha256(data).hexdigest(), expected_sha)
        fixture = json.loads(data)
        # Existing source-derived12Q fixture schema, not a template/connection table.
        ids = np.array(fixture['boundaryNIDs'], dtype=np.int64)
        points = np.array(fixture['boundaryXYZ'], dtype=float)
        literal_faces = ids[np.array(fixture['boundaryFaces'], dtype=np.int64)]
        self.assertEqual(ids.shape, (14,))
        self.assertEqual(literal_faces.shape, (12, 4))
        self.assertEqual(face_map(literal_faces), face_map(fixture['actualBoundaryQ4NIDs']))
        seed = match_native_three_prism(literal_faces)
        patch = pillow_boundary(ids, points, literal_faces, seed)
        self.assertEqual(patch.elements.shape, (15, 8))
        self.assertEqual(patch.nodes.shape, (28, 3))
        np.testing.assert_array_equal(patch.nodes[:14], points)
        self.assertEqual(face_map(ids[oriented_hex_boundary(patch.elements)]), face_map(literal_faces))
        self.assertEqual(len(patch.interior_node_indices), 14)
        self.assertFalse(patch.to_contract()['shapeAccepted'])
        self.assertFalse(patch.to_contract()['continuousJacobianCertified'])


if __name__ == '__main__':
    unittest.main()
