"""Exact-sign separation, including nonplanar shared Q4s and genuine overlap."""
from fractions import Fraction as Q
from itertools import product
import os
from pathlib import Path
import unittest

import numpy as np

from tools.bolthex.mesh_audit import FACES
from tools.bolthex.hex_pair_separation import (tensor_bernstein, face_separator,
    mapped_face_bernstein, pair_separation, determinant_certificate,
    cell_embedding_certificate, mesh_pair_separations, bernstein_sign_certificate,
    boundary_degree_certificate)


CUBE = np.array([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
                 [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], dtype=float)


def warped_pair():
    a, b = CUBE.copy(), CUBE.copy()
    a[:, 0] *= 1+.25*a[:, 1]*a[:, 2]
    b[:, 0] += 1+.25*b[:, 1]*b[:, 2]
    return a, b


class ExactPolynomialTests(unittest.TestCase):
    def test_exact_subdivision_can_certify_a_mixed_coefficient_tensor(self):
        c = np.empty((3, 3, 3), dtype=object)
        c[0] = Q(26, 100); c[1] = Q(-24, 100); c[2] = Q(26, 100)
        self.assertFalse(bernstein_sign_certificate(c, 1, strict=True, max_depth=0)['certified'])
        self.assertTrue(bernstein_sign_certificate(c, 1, strict=True, max_depth=1)['certified'])

    def test_structural_boundary_zero_is_allowed_only_in_weak_mode(self):
        c = mapped_face_bernstein(CUBE[FACES[5]], CUBE)
        sign = 1 if sum(c.flat) > 0 else -1
        self.assertTrue(bernstein_sign_certificate(c, sign)['certified'])
        self.assertFalse(bernstein_sign_certificate(c, sign, strict=True)['certified'])
        with self.assertRaises(ValueError):
            bernstein_sign_certificate(np.ones((3, 3, 3)), 1)

    def test_subdivision_interface_zero_does_not_prove_strict_interior_sign(self):
        c = np.empty((3, 3, 3), dtype=object)
        c[0] = Q(1, 4); c[1] = Q(-1, 4); c[2] = Q(1, 4)
        self.assertFalse(bernstein_sign_certificate(c, 1, max_depth=6)['certified'])

    def test_tensor_transform_recovers_quadratic_exactly(self):
        grid = (Q(0), Q(1, 2), Q(1))
        values = np.array([r*r+2*s+t for r, s, t in product(grid, repeat=3)], dtype=object).reshape(3, 3, 3)
        result = tensor_bernstein(values)
        for i, j, k in product(range(3), repeat=3):
            self.assertEqual(result[i, j, k], (1 if i == 2 else 0)+j+Q(k, 2))

    def test_integer_samples_do_not_truncate_half_coefficients(self):
        values = np.zeros((3, 3, 3), dtype=int)
        values[2] = 1
        self.assertEqual(tensor_bernstein(values)[1, 0, 0], -.5)

    def test_cube_plane_quotient_is_exact(self):
        c = mapped_face_bernstein(CUBE[FACES[5]], CUBE)
        self.assertTrue(all(v == 0 for v in c[0].flat))
        self.assertTrue(all(v != 0 for v in c[2].flat))
        self.assertEqual(face_separator(CUBE[FACES[5]])['kind'], 'plane')

    def test_warped_shared_face_has_structural_zeros_without_epsilon(self):
        a, b = warped_pair()
        face = a[FACES[3]]
        self.assertEqual(face_separator(face)['kind'], 'quadric')
        ca, cb = mapped_face_bernstein(face, a), mapped_face_bernstein(face, b)
        self.assertTrue(all(v == 0 for v in ca[2].flat))
        self.assertTrue(all(v == 0 for v in cb[0].flat))
        self.assertLess(min(ca.flat), 0)
        self.assertEqual(max(ca.flat), 0)
        self.assertGreater(max(cb.flat), 0)
        self.assertEqual(min(cb.flat), 0)

    def test_reversed_face_cycle_does_not_break_exact_separation(self):
        a, b = warped_pair()
        for face in (a[FACES[3]], a[FACES[3]][::-1]):
            ca, cb = mapped_face_bernstein(face, a), mapped_face_bernstein(face, b)
            self.assertTrue((min(ca.flat) >= 0 and max(cb.flat) <= 0) or
                            (max(ca.flat) <= 0 and min(cb.flat) >= 0))


class SeparationTests(unittest.TestCase):
    def test_disjoint_cubes_get_exact_plane(self):
        result = pair_separation(CUBE, CUBE+[2, 0, 0])
        self.assertTrue(result['certified'])
        self.assertEqual(result['method'], 'exact-hull-plane')

    def test_shared_planar_face_is_allowed(self):
        self.assertTrue(pair_separation(CUBE, CUBE+[1, 0, 0])['certified'])

    def test_shared_edge_and_vertex_are_allowed(self):
        for offset in ([1, 1, 0], [1, 1, 1]):
            self.assertTrue(pair_separation(CUBE, CUBE+offset)['certified'])

    def test_quadric_separates_nonplanar_face_neighbours(self):
        result = pair_separation(*warped_pair())
        self.assertTrue(result['certified'])
        self.assertEqual(result['method'], 'exact-face-polynomial')
        self.assertEqual(result['polynomialKind'], 'quadric')

    def test_real_interior_overlap_is_not_certified(self):
        for a, b in ((CUBE, CUBE+[.5, 0, 0]), (CUBE, CUBE.copy()),
                     (warped_pair()[0], warped_pair()[1]-[.1, 0, 0])):
            result = pair_separation(a, b)
            self.assertFalse(result['certified'])
            self.assertEqual(result['method'], 'inconclusive')

    def test_binary64_sign_not_decimal_rounding(self):
        b = CUBE.copy()+[1, 0, 0]
        b[:, 0] -= 2**-48
        self.assertFalse(pair_separation(CUBE, b, float_screen=False)['certified'])


class EmbeddingTests(unittest.TestCase):
    def test_public_mesh_entries_reject_empty_float_boolean_and_out_of_range_indices(self):
        invalid = (np.empty((0, 8), dtype=int), np.zeros((1, 8)),
                   np.zeros((1, 8), dtype=bool), np.full((1, 8), -1),
                   np.full((1, 8), 8), np.zeros((1, 7), dtype=int),
                   np.zeros((65, 8), dtype=int))
        for entry in (boundary_degree_certificate, mesh_pair_separations):
            for cells in invalid:
                with self.subTest(entry=entry.__name__, shape=cells.shape, dtype=cells.dtype):
                    with self.assertRaises(ValueError):
                        entry(CUBE, cells)

    def test_public_mesh_entries_hard_limit_includes_unused_nodes(self):
        cells = np.arange(8).reshape(1, 8)
        for entry in (boundary_degree_certificate, mesh_pair_separations):
            for nodes in (np.empty((0, 3)), np.full((8, 3), np.inf),
                          np.full((8, 3), np.nan), np.zeros((8, 2)),
                          np.vstack((CUBE, np.zeros((505, 3))))):
                with self.assertRaises(ValueError):
                    entry(nodes, cells)

    def test_budget_cannot_override_hard_limit_or_use_bool_float(self):
        for budget in (True, np.bool_(True), False, 0, -1, 65, 1000000, 64., None):
            with self.subTest(budget=budget):
                with self.assertRaises(ValueError):
                    mesh_pair_separations(CUBE, np.arange(8).reshape(1, 8), max_cells=budget)

    def test_element_ids_are_not_silently_truncated(self):
        for ids in ([1.5], [1.], [True], [np.bool_(False)], [[1]], [], ['1']):
            with self.subTest(ids=ids):
                with self.assertRaises(ValueError):
                    mesh_pair_separations(CUBE, np.arange(8).reshape(1, 8), ids)
        self.assertTrue(mesh_pair_separations(CUBE, np.arange(8).reshape(1, 8),
                        np.array([7], dtype=np.int64), max_cells=np.int64(1))['internalMaterialNonoverlapCertified'])

    def test_cube_has_positive_exact_determinant_and_embedding(self):
        d = determinant_certificate(CUBE)
        self.assertTrue(d['certified'])
        self.assertEqual(Q(d['minimum']), 1)
        self.assertTrue(cell_embedding_certificate(CUBE)['certified'])

    def test_warped_cells_have_own_face_factor_certificates(self):
        for p in warped_pair():
            result = cell_embedding_certificate(p)
            self.assertTrue(result['certified'])
            self.assertTrue(all(f['structuralFaceZero'] and f['quotientStrictSign'] for f in result['faces']))

    def test_negative_or_zero_determinant_never_passes(self):
        for p in (CUBE*[-1, 1, 1], CUBE*[0, 1, 1]):
            self.assertFalse(determinant_certificate(p)['certified'])
            self.assertFalse(cell_embedding_certificate(p)['certified'])

    def test_pairwise_mesh_certificate_does_not_imply_source_acceptance(self):
        a, b = warped_pair()
        result = mesh_pair_separations(np.vstack((a, b)), np.arange(16).reshape(2, 8), [37, 91])
        self.assertEqual(result['certifiedPairs'], 1)
        self.assertTrue(result['internalMaterialNonoverlapCertified'])
        self.assertFalse(result['sourceAccepted'])

    def test_cube_degree_certificate(self):
        result = boundary_degree_certificate(CUBE, np.arange(8).reshape(1, 8))
        self.assertTrue(result['certified'])
        self.assertEqual(result['boundaryEuler'], 2)
        self.assertEqual(len(result['boundaryPairCertificates']), 15)

    def test_coincident_geometry_without_shared_ids_is_not_embedded_skin(self):
        result = boundary_degree_certificate(np.vstack((CUBE, CUBE+[1, 0, 0])), np.arange(16).reshape(2, 8))
        self.assertFalse(result['certified'])

    def test_invalid_inputs_and_budget(self):
        with self.assertRaises(ValueError):
            pair_separation(np.zeros((7, 3)), CUBE)
        with self.assertRaises(ValueError):
            pair_separation(np.full((8, 3), np.inf), CUBE)
        for cells in (np.zeros((65, 8), dtype=int), np.full((1, 8), 99), np.zeros((1, 8))):
            with self.assertRaises(ValueError):
                mesh_pair_separations(CUBE, cells)
        with self.assertRaises(ValueError):
            mesh_pair_separations(np.vstack((CUBE, CUBE)), np.arange(16).reshape(2, 8), [1, 1])


@unittest.skipUnless(os.environ.get('SCREW_WALL22_K'), 'Set actual read-back wall22 K')
class ActualWall22Tests(unittest.TestCase):
    def test_actual_candidate_exact_pair_certificates(self):
        from tools.bolthex.truegrid_screw import read_keyword
        mesh = read_keyword(Path(os.environ['SCREW_WALL22_K']))
        self.assertEqual(len(mesh.elements), 22)
        result = mesh_pair_separations(mesh.nodes, mesh.elements, mesh.element_ids)
        self.assertEqual(result['pairs'], 231)
        self.assertGreaterEqual(result['certifiedPairs'], 212)
        self.assertTrue(result['internalMaterialNonoverlapCertified'])
        self.assertTrue(result['boundaryDegreeCertificate']['certified'])
        self.assertFalse(result['sourceAccepted'])


if __name__ == '__main__':
    unittest.main()
