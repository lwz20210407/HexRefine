"""Independent rational readback of the published local target, not mesh acceptance."""
from collections import Counter
from fractions import Fraction as Q
from itertools import product
import hashlib
import json
import math
import os
from pathlib import Path
import unittest

from tools.bolthex import screw_tip_regularization as tip


def sub(a, b):
    return tuple(x-y for x, y in zip(a, b))


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def det(a, b, c):
    return dot(a, cross(b, c))


class IndependentHullControls(unittest.TestCase):
    def test_translated_rectangular_hull_volume_is_not_origin_dependent(self):
        points = [(Q(1000)+i*2, Q(-2000)+j*3, Q(3000)+k*5)
                  for i, j, k in product((0, 1), repeat=3)]
        hull = tip.exact_convex_hull(points)
        self.assertEqual(hull['volume'], 30)
        self.assertEqual(len(hull['faces']), 6)
        p = hull['points']
        volume = sum(det(sub(p[a], points[0]), sub(p[b], points[0]),
                         sub(p[c], points[0])) for a, b, c in hull['triangles'])/6
        self.assertEqual(volume, 30)

    def test_rank_two_input_is_not_a_solid(self):
        with self.assertRaises(ValueError):
            tip.exact_convex_hull([(Q(i), Q(j), Q(0)) for i, j in product((0, 1), repeat=2)])

    def test_covariance_bound_covers_nonuniform_convex_mixtures(self):
        # Independent tensor-product evaluation, without the producer's evaluator.
        bits = list(tip.BITS)
        corners = [(Q(i), Q(j), Q(k)+Q(i*j, 3)+Q(i*j*k, 5)) for i, j, k in bits]
        coefficients = tip.coefficients(corners)
        ranges = (Q(1, 4), Q(1, 3), Q(1, 2))
        bound = tip.deviation_bound(coefficients, ranges)['bound']

        def evaluate(uv):
            return tuple(sum(p[axis]*math.prod(
                uv[d] if b[d] else 1-uv[d] for d in range(3))
                for b, p in zip(bits, corners)) for axis in range(3))

        uv = [tuple(r*b for r, b in zip(ranges, bs)) for bs in bits]
        images = [evaluate(q) for q in uv]
        for weights in ([Q(1, 8)]*8, [Q(i, 36) for i in range(1, 9)],
                        [Q(1, 2), 0, 0, 0, 0, 0, Q(1, 2), 0]):
            mu = tuple(sum(w*p[d] for w, p in zip(weights, uv)) for d in range(3))
            h = tuple(sum(w*p[d] for w, p in zip(weights, images)) for d in range(3))
            self.assertLessEqual(sum(abs(x-y) for x, y in zip(h, evaluate(mu))), bound)


@unittest.skipUnless(os.environ.get('SCREW_TIP_TARGET'), 'Explicit actual target JSON required')
class ActualTargetReadback(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = json.loads(Path(os.environ['SCREW_TIP_TARGET']).read_bytes())

    def test_actual_source_and_policy_are_still_hash_bound(self):
        for path, record in self.report['sourceFiles'].items():
            content = Path(path).read_bytes()
            self.assertEqual(len(content), record['bytes'])
            self.assertEqual(hashlib.sha256(content).hexdigest(), record['sha256'])
        policy = self.report['approvedGeometryAccuracyPolicy']
        self.assertEqual(policy['declaredTargetSizeMm'], .2)
        self.assertEqual(policy['limits']['maximumSurfaceDistance'], .0005)

    def test_exact_hull_closed_volume_and_all_support_halfspaces(self):
        for name in ('exactHull', 'floatHull'):
            h = self.report[name]
            p = [tuple(map(Q, row)) for row in h['pointsExact']]
            triangles = h['outwardTriangles']
            edges = Counter((a, b) for t in triangles for a, b in zip(t, t[1:]+t[:1]))
            self.assertTrue(all(count == 1 and edges[b, a] == 1 for (a, b), count in edges.items()))
            volume = sum(det(sub(p[a], p[0]), sub(p[b], p[0]), sub(p[c], p[0]))
                         for a, b, c in triangles)/6
            self.assertGreater(volume, 0)
            self.assertEqual(volume, Q(h['volume']['exact']))
            for face in h['faces']:
                normal, offset = tuple(map(Q, face['normalExact'])), Q(face['offsetExact'])
                self.assertTrue(all(dot(normal, v)+offset <= 0 for v in p))

    def test_witness_orthogonality_and_containment_not_full_mesh(self):
        r = self.report
        witness = r['affineH8Witness']
        basis = [tuple(map(Q, v)) for v in witness['basisExact']]
        self.assertTrue(all(dot(basis[i], basis[j]) == 0 for i, j in ((0, 1), (0, 2), (1, 2))))
        self.assertGreater(det(*basis), 0)
        self.assertEqual(det(*basis), Q(witness['jacobianOnUnitCube']['exact']))
        self.assertEqual(det(*basis)**2, dot(basis[0], basis[0])*dot(basis[1], basis[1])*dot(basis[2], basis[2]))
        for v in map(lambda row: tuple(map(Q, row)), witness['verticesExact']):
            self.assertTrue(all(dot(tuple(map(Q, f['normalExact'])), v)+Q(f['offsetExact']) <= 0
                                for f in r['exactHull']['faces']))
        for flag in ('coreMeshed', 'wholeScrewAccepted', 'engineeringQualityAccepted', 'independentDesignCad'):
            self.assertIs(r[flag], False)
        self.assertIs(witness['wholeMeshQualityAccepted'], False)

    def test_geometry_and_volume_budgets_without_threshold_changes(self):
        r = self.report
        value = lambda obj: Q(obj['exact'])
        budget = r['budget']
        self.assertEqual(value(budget['geometryTargetIncludingFloatMM'])+
                         value(budget['reservedMeshApproximationMM']), value(budget['totalDistanceMM']))
        self.assertLessEqual(value(r['deviation']['includingFloatOutputMM']),
                             value(budget['geometryTargetIncludingFloatMM']))
        volume = r['volume']
        self.assertEqual(value(volume['relativeAddedVolumeUpperBound']),
                         value(volume['includingFloatHullUpperBound'])/value(volume['sourceCellImageVolume']))
        self.assertLessEqual(value(volume['relativeAddedVolumeUpperBound']), Q(1, 10000))
        self.assertGreater(value(r['protection']['minimumHullAndFloatZ']),
                           value(r['protection']['requiredLowerPlaneZ']))


if __name__ == '__main__':
    unittest.main()
