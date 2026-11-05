"""Independent source-payload tamper and preallocation regressions.

All geometry fixtures are actual, small OCP solids/curves. Negative cases must
raise ValueError, not pass through a matching set of corrupted JSON copies.
"""
import copy
import json
import math
import unittest
from unittest.mock import patch

from tools.bolthex import cad_native_payload as payload
from tools.bolthex import cad_native_3d_payload as curves3d


def _json_copy(document):
    return json.loads(json.dumps(document, allow_nan=False))


def _owner_coedge(document, owner):
    return document['faces'][owner['faceIndex']]['loops'][owner['loopIndex']][
        'coedges'][owner['coedgeIndex']]


def _shuffle_first_wire(document):
    coedges = document['faces'][0]['loops'][0]['coedges']
    coedges[1], coedges[2] = coedges[2], coedges[1]
    indices = {c['sourceCoedgeId']: i for i, c in enumerate(coedges)}
    for edge in document['sourceEdges']:
        for owner in edge['owners']:
            if owner['faceIndex'] == 0 and owner['loopIndex'] == 0:
                owner['coedgeIndex'] = indices[owner['sourceCoedgeId']]
    return coedges


def _change_vertex(document, vertex_id, **changes):
    # Keep every occurrence of this identity consistent, including JSON copies.
    for edge in document['sourceEdges']:
        for vertex in edge['vertices']:
            if vertex['nativeVertexId'] == vertex_id:
                vertex.update(copy.deepcopy(changes))
        for owner in edge['owners']:
            _owner_coedge(document, owner)['vertices'] = copy.deepcopy(edge['vertices'])


class SourcePayloadIntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from build123d import Box
        cls.source = Box(1, 1, 1)
        cls.before = payload._brep_sha(cls.source.wrapped)
        cls.base = payload.build_payload(cls.source)
        cls.extended = curves3d.extend_payload(cls.source, cls.base)

    def tearDown(self):
        self.assertEqual(payload._brep_sha(self.source.wrapped), self.before)

    def test_untampered_json_roundtrip_remains_valid(self):
        report = payload.validate_payload(_json_copy(self.base))
        self.assertEqual((report['faceCount'], report['edgeCount'], report['coedges']),
                         (6, 12, 24))
        report3d = curves3d.validate_payload(_json_copy(self.extended))
        self.assertEqual(report3d['canonical3dCurves'], 12)
        self.assertLessEqual(report3d['maximumSource3dMathSampleError'], 1e-10)

    def test_translated_3d_curve_and_new_samples_reject_against_frozen_samples(self):
        changed = _json_copy(self.extended)
        edge = changed['sourceEdges'][0]
        frozen_samples = copy.deepcopy(edge['sourceCurve3dSamples'])
        self.assertEqual(edge['curve3d']['type'], 1)
        for key in ('start', 'end'):
            edge['curve3d'][key][0] += 100.
        for sample in edge['source3dMathSamples']:
            sample['point'][0] += 100.
        for owner in edge['owners']:
            coedge = _owner_coedge(changed, owner)
            coedge['curve3d'] = copy.deepcopy(edge['curve3d'])
            samples = edge['source3dMathSamples']
            coedge['source3dMathSamples'] = copy.deepcopy(
                samples[::-1] if coedge['edgeSenseRaw'] else samples)
            self.assertEqual(coedge['source3dSamples'], frozen_samples)
        self.assertEqual(edge['sourceCurve3dSamples'], frozen_samples)
        for sample in edge['source3dMathSamples']:
            self.assertLessEqual(math.dist(
                payload.evaluate_curve(edge['curve3d'], sample['parameter']),
                sample['point']), 1e-10)
        with self.assertRaises(ValueError):
            curves3d.validate_payload(changed)

    def test_noncyclic_wire_rejects_with_consistent_owner_indices(self):
        changed = _json_copy(self.base)
        coedges = _shuffle_first_wire(changed)
        gaps = [math.dist(a['onSurfaceSourceSamples'][-1]['point'],
                          b['onSurfaceSourceSamples'][0]['point'])
                for a, b in zip(coedges, coedges[1:] + coedges[:1])]
        self.assertGreater(max(gaps), 1.)
        for edge in changed['sourceEdges']:
            for owner in edge['owners']:
                self.assertEqual(_owner_coedge(changed, owner)['sourceCoedgeId'],
                                 owner['sourceCoedgeId'])
        with self.assertRaises(ValueError):
            payload.validate_payload(changed)

    def test_extension_rejects_noncyclic_wire_against_actual_source(self):
        changed = _json_copy(self.base)
        _shuffle_first_wire(changed)
        with self.assertRaises(ValueError):
            curves3d.extend_payload(self.source, changed)

    def test_out_of_inventory_vertex_id_rejects_with_consistent_owner_copies(self):
        changed = _json_copy(self.base)
        vertex_id = changed['sourceEdges'][0]['vertices'][0]['nativeVertexId']
        _change_vertex(changed, vertex_id, nativeVertexId=999999)
        self.assertLess(changed['sourceVertexCount'], 999999)
        with self.assertRaises(ValueError):
            payload.validate_payload(changed)

    def test_displaced_vertex_rejects_with_consistent_identity_copies(self):
        changed = _json_copy(self.base)
        vertex_id = changed['sourceEdges'][0]['vertices'][0]['nativeVertexId']
        _change_vertex(changed, vertex_id, point=[123., 456., 789.])
        with self.assertRaises(ValueError):
            payload.validate_payload(changed)

    def test_extension_rejects_forged_vertex_against_actual_source(self):
        changed = _json_copy(self.base)
        vertex_id = changed['sourceEdges'][0]['vertices'][0]['nativeVertexId']
        _change_vertex(changed, vertex_id, nativeVertexId=999999,
                       point=[123., 456., 789.])
        with self.assertRaises(ValueError):
            curves3d.extend_payload(self.source, changed)


class SourceParameterMapIntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from build123d import Cone, Keep, Plane
        cls.source = Cone(3, 0, 4).split(Plane.YZ.offset(.5), Keep.TOP)
        cls.before = payload._brep_sha(cls.source.wrapped)
        cls.document = payload.build_payload(cls.source)

    def tearDown(self):
        self.assertEqual(payload._brep_sha(self.source.wrapped), self.before)

    def _case(self):
        changed = _json_copy(self.document)
        coedge = next(c for f in changed['faces'] for w in f['loops']
                      for c in w['coedges'] if 'sourceParameterMap' in c['curve2d'])
        return changed, coedge

    def test_actual_finite_hyperbola_source_map_is_a_valid_control(self):
        payload.validate_payload(_json_copy(self.document))
        _, coedge = self._case()
        self.assertEqual(coedge['curve2d']['sourceParameterMap']['kind'],
                         'hyperbola-asinh')
        for sample in coedge['onSurfaceSourceSamples']:
            self.assertLessEqual(abs(payload.source_curve_parameter(
                coedge['curve2d'], sample['parameter']) - sample['sourceParameter']),
                1e-10)

    def test_changed_hyperbola_radius_rejects_against_frozen_source_parameters(self):
        changed, coedge = self._case()
        coedge['curve2d']['sourceParameterMap']['minorRadius'] *= 2.
        discrepancy = max(abs(payload.source_curve_parameter(
            coedge['curve2d'], s['parameter']) - s['sourceParameter'])
            for s in coedge['onSurfaceSourceSamples'])
        self.assertGreater(discrepancy, 1e-4)
        with self.assertRaises(ValueError):
            payload.validate_payload(changed)

    def test_unsupported_source_parameter_map_rejects(self):
        changed, coedge = self._case()
        coedge['curve2d']['sourceParameterMap']['kind'] = 'invalid-map'
        with self.assertRaises(ValueError):
            payload.validate_payload(changed)

    def test_changed_stored_source_parameter_rejects(self):
        changed, coedge = self._case()
        coedge['onSurfaceSourceSamples'][1]['sourceParameter'] += .25
        with self.assertRaises(ValueError):
            payload.validate_payload(changed)

    def test_extension_rejects_changed_parameter_map_against_actual_source(self):
        changed, coedge = self._case()
        coedge['curve2d']['sourceParameterMap']['minorRadius'] *= 2.
        with self.assertRaises(ValueError):
            curves3d.extend_payload(self.source, changed)


class SourcePreallocationIntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from build123d import Box
        from OCP.BRepBuilderAPI import BRepBuilderAPI_NurbsConvert
        cls.box = payload.build_payload(Box(1, 1, 1))
        cls.nurbs_source = BRepBuilderAPI_NurbsConvert(Box(1, 1, 1).wrapped, True).Shape()
        cls.nurbs_document = payload.build_payload(cls.nurbs_source)

    def test_source_surface_count_rejects_before_knot_or_pole_materialization(self):
        self.assertEqual(self.nurbs_document['faces'][0]['shape'], [2, 2])
        with patch.object(payload, 'MAX_POLES', 3), patch.object(
                payload, '_knots', side_effect=AssertionError(
                    'Surface counts must reject before expanded knots')) as knots, patch.object(
                payload, '_xyz', side_effect=AssertionError(
                    'Surface counts must reject before pole coordinates')) as coordinates:
            with self.assertRaises(ValueError):
                payload.build_payload(self.nurbs_source)
            knots.assert_not_called()
            coordinates.assert_not_called()

    def test_source_pcurve_count_rejects_before_knot_or_pole_materialization(self):
        from OCP.Geom2d import Geom2d_BSplineCurve
        from OCP.Geom2dAdaptor import Geom2dAdaptor_Curve
        from OCP.TColgp import TColgp_Array1OfPnt2d
        from OCP.TColStd import TColStd_Array1OfInteger, TColStd_Array1OfReal
        from OCP.gp import gp_Pnt2d
        poles = TColgp_Array1OfPnt2d(1, 3)
        for i, point in enumerate(((0, 0), (1, 1), (2, 0)), 1):
            poles.SetValue(i, gp_Pnt2d(*point))
        knots = TColStd_Array1OfReal(1, 2)
        mults = TColStd_Array1OfInteger(1, 2)
        for i in (1, 2):
            knots.SetValue(i, float(i - 1))
            mults.SetValue(i, 3)
        curve = Geom2d_BSplineCurve(poles, knots, mults, 2)
        adaptor = Geom2dAdaptor_Curve(curve, 0., 1.)
        # This is the existing pcurve extraction seam, using a real OCP curve.
        with patch.object(payload, 'MAX_POLES', 2), patch.object(
                payload, '_knots', side_effect=AssertionError(
                    'Pcurve counts must reject before expanded knots')) as expanded, patch.object(
                payload, '_xy', side_effect=AssertionError(
                    'Pcurve counts must reject before pole coordinates')) as coordinates:
            with self.assertRaises(ValueError):
                payload._curve_record(adaptor)
            expanded.assert_not_called()
            coordinates.assert_not_called()

    def test_coedge_budget_rejects_before_any_mathematical_evaluation(self):
        changed = _json_copy(self.box)
        with patch.object(payload, 'MAX_COEDGES', 23), patch.object(
                payload, 'evaluate_surface', side_effect=AssertionError(
                    'Coedge preflight must precede surface evaluation')) as evaluate:
            with self.assertRaises(ValueError):
                payload.validate_payload(changed)
            evaluate.assert_not_called()

    def test_total_pole_budget_rejects_before_any_mathematical_evaluation(self):
        changed = _json_copy(self.nurbs_document)
        with patch.object(payload, 'MAX_TOTAL_POLES', 1), patch.object(
                payload, 'evaluate_surface', side_effect=AssertionError(
                    'Pole preflight must precede surface evaluation')) as evaluate:
            with self.assertRaises(ValueError):
                payload.validate_payload(changed)
            evaluate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
