"""Source-labelled native trim reconstruction, not HM/product certification."""
import copy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools.bolthex import native_trim_brep as native
from tools.bolthex.cad_native_payload import evaluate_curve

CAD = importlib.util.find_spec('OCP') is not None
SCRATCH = os.environ.get('BOLTHEX_TEST_ROOT')


def annulus():
    points = [[-2., -2., 0.], [2., -2., 0.], [2., 2., 0.], [-2., 2., 0.]]
    loops = [dict(index=0, coedges=[]), dict(index=1, coedges=[])]
    for i in range(5):
        desc = (dict(type=1, start=points[i], end=points[(i+1) % 4], supported=True) if i < 4 else
                dict(type=2, center=[0., 0., 0.], normal=[0., 0., -1.], radiusVector=[1., 0., 0.], supported=True))
        a, b = (0., 1.) if i < 4 else (0., 2*math.pi)
        start, end = evaluate_curve(desc, a).tolist(), evaluate_curve(desc, b).tolist()
        c = dict(nativeEdgeId=i, edgeSenseRaw=True, loopSense=True, edgeRange=[a, b], coedgeRange=[a, b],
                 curve2d=copy.deepcopy(desc), curve3d=copy.deepcopy(desc),
                 vertices=[dict(nativeVertexId=i if i < 4 else 4, available=True, atEndRaw=False, point=start),
                           dict(nativeVertexId=(i+1) % 4 if i < 4 else 4, available=True, atEndRaw=True, point=end)],
                 onSurfaceSamples=[])
        for j in range(5):
            t = a+(b-a)*j/4; p = evaluate_curve(desc, t).tolist()
            c['onSurfaceSamples'].append(dict(parameter=t, available=True, uv=p, point=p))
        loops[i == 4]['coedges'].append(c)
    f = dict(index=0, type=1, component='synthetic-annulus', normalSense=True, uv=[-2., 2., -2., 2.],
             planeBase=[0., 0., 0.], planeU=[1., 0., 0.], planeV=[0., 1., 0.],
             untrimmedMidpoint=[0., 0., 0.], nativeSamples=[dict(uv=[u, v], point=[u, v, 0.]) for u in (-1., 0., 1.) for v in (-1., 0., 1.)],
             loops=loops, loopCaptureComplete=True)
    return dict(complete=True, faceCount=1, faces=[f], modelToleranceAfter=1e-5)


def calibration():
    rows = []
    for c in annulus()['faces'][0]['loops'][0]['coedges']:
        rows.append(dict(edgeSenseRaw=True, samples=[dict(fraction=j/4, available=True,
            coedgeWorld=evaluate_curve(c['curve3d'], j/4).tolist(), edgeWorld=evaluate_curve(c['curve3d'], j/4).tolist()) for j in range(5)],
            vertices=[dict(v, xyz=v['point']) for v in c['vertices']]))
    return dict(completed=True, faces=[dict(coedges=rows)])


class TempCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=SCRATCH); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def write(self, name, doc):
        p = self.root/name; p.write_text(json.dumps(doc)); return p

    def capture(self, doc=None):
        conv = native.load_conventions(self.write('control.json', calibration()), source_label='synthetic actual control')
        return native.load_capture(self.write('capture.json', doc or annulus()), source_label='synthetic annulus capture', conventions=conv)


@unittest.skipUnless(SCRATCH, 'Explicit dated BOLTHEX_TEST_ROOT required')
class InputTests(TempCase):

    def test_native_calibration_inferred_from_actual_points(self):
        c = self.capture()
        self.assertTrue(c.conventions.true_means_same); self.assertTrue(c.conventions.true_means_end)
        self.assertEqual(c.sha256, hashlib.sha256(c.path.read_bytes()).hexdigest())

    def test_control_contradiction_or_missing_quarters_rejects(self):
        for change in ('contradict', 'quarter', 'endpoint'):
            d = calibration()
            if change == 'contradict': d['faces'][0]['coedges'][0]['edgeSenseRaw'] = False
            elif change == 'quarter': d['faces'][0]['coedges'][0]['samples'].pop(1)
            else: d['faces'][0]['coedges'][0]['vertices'][0]['atEndRaw'] = True
            with self.subTest(change=change), self.assertRaises(ValueError):
                native.load_conventions(self.write('bad.json', d), source_label='bad actual control')

    def test_labels_hashes_and_source_ocp_semantics_not_silently_defaulted(self):
        c = self.capture()
        for kwargs in (dict(source_label=''), dict(expected_sha256='0'*64),
                       dict(conventions=native.NativeConventions('ocp', '0'*64, False, True, 4, 'source-ocp'))):
            args = dict(source_label='explicit capture', conventions=c.conventions); args.update(kwargs)
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):native.load_capture(c.path, **args)

    def test_missing_ids_incomplete_faces_and_mixed_components_reject(self):
        for mode in ('negative', 'missing', 'duplicate', 'mixed'):
            d = annulus()
            if mode == 'negative': d['faces'][0]['loops'][0]['coedges'][0]['vertices'][0]['nativeVertexId'] = -1
            elif mode == 'missing': d['faces'][0]['loops'][0]['coedges'][0]['vertices'][0]['available'] = False
            else:
                d['faces'].append(copy.deepcopy(d['faces'][0])); d['faceCount'] = 2
                if mode == 'mixed': d['faces'][1].update(index=1, component='another part')
            with self.subTest(mode=mode), self.assertRaises(ValueError):self.capture(d)

    def test_preflight_budget_before_kernel(self):
        c = self.capture()
        with patch.object(native, 'MAX_POINTS', 1), patch.object(native, '_kernel', side_effect=AssertionError('OCCT must not be allocated')):
            d = annulus(); d['faces'][0]['loops'][0]['coedges'][0]['curve3d']['points'] = [[0., 0., 0.]]*2
            with self.assertRaisesRegex(ValueError, 'budget'):self.capture(d)
        with patch.object(native, 'MAX_BYTES', 10), self.assertRaises(ValueError):
            native.load_capture(c.path, source_label='small budget', conventions=c.conventions)

    def test_duplicate_keys_nonfinite_values_and_numeric_boolean_reject(self):
        c = self.capture()
        for raw in ('{"complete":true,"complete":false}', '{"x":NaN}'):
            c.path.write_text(raw)
            with self.assertRaises(ValueError):native.load_capture(c.path, source_label='bad json', conventions=c.conventions)
        d = annulus(); d['faces'][0]['uv'][0] = True
        with self.assertRaises(ValueError):self.capture(d)

    def test_explicit_source_ocp_markers_are_not_native_sdk_evidence(self):
        for key in ('origin', 'dataOrigin', 'idNamespace'):
            d = annulus(); d[key] = 'source-OCP'
            with self.subTest(key=key), self.assertRaises(ValueError):self.capture(d)


@unittest.skipUnless(CAD and SCRATCH, 'OCCT and explicit dated scratch required')
class TrimTests(TempCase):
    def test_ordinary_vertex_or_canonical_c3_translation_cannot_claim_consistency(self):
        for mode in ('first-vertex', 'all-vertex-copies', 'c3-translation'):
            d = annulus()
            if mode == 'first-vertex':
                d['faces'][0]['loops'][0]['coedges'][0]['vertices'][0].update(nativeVertexId=999999, point=[99., 99., 99.])
            elif mode == 'all-vertex-copies':
                for loop in d['faces'][0]['loops']:
                    for c in loop['coedges']:
                        for v in c['vertices']:
                            if v['nativeVertexId'] == 0:v['point'] = [99., 99., 99.]
            else:
                c = d['faces'][0]['loops'][0]['coedges'][0]['curve3d']
                for key in ('start', 'end'):c[key][0] += 100.
            with self.subTest(mode=mode):
                try:m = native.reconstruct_trim(self.capture(d))
                except ValueError:continue
                self.assertFalse(m.report['inputEvidenceConsistent'])
                self.assertTrue(m.report['inputEvidenceFailures'])
                self.assertFalse(m.report['productAcceptance'])

    def test_missing_c3_is_partial_evidence_not_a_fabricated_closed_cad_pass(self):
        d = annulus(); del d['faces'][0]['loops'][0]['coedges'][0]['curve3d']
        model = native.reconstruct_trim(self.capture(d))
        self.assertTrue(model.report['completeNativeFaceCoverage'])
        self.assertFalse(model.report['canonical3dEvidenceVerified'])
        self.assertTrue(model.report['inputEvidenceMissing'])
        self.assertFalse(model.report['productAcceptance'])
        self.assertAlmostEqual(model.query([0., 0., 0.])['witness']['distance'], 1.)
    def test_warnings_from_nonbest_and_best_faces_both_survive(self):
        d = annulus(); other = copy.deepcopy(d['faces'][0]); other['index'] = 1
        other['planeBase'][2] = other['untrimmedMidpoint'][2] = 1.
        for s in other['nativeSamples']:s['point'][2] = 1.
        for loop in other['loops']:
            for c in loop['coedges']:
                c['nativeEdgeId'] += 10
                for v in c['vertices']:v['nativeVertexId'] += 10; v['point'][2] = 1.
                for s in c['onSurfaceSamples']:s['point'] = [s['point'][0], s['point'][1], 1.]
                for key in ('start', 'end', 'center'):
                    if key in c['curve3d']:c['curve3d'][key][2] = 1.
        d['faces'].append(other); d['faceCount'] = 2; m = native.reconstruct_trim(self.capture(d))
        self.assertEqual(m.report['unsupported'], [])
        def warnings(point, adaptor, a, b, ident):
            messages = ['best-warning'] if ident == 0 else ['nonbest-warning'] if ident == 10 else []
            return [a, b], messages
        with patch.object(native, '_boundary_parameters', side_effect=warnings):q = m.query([1.5, 0., 0.], preferred_face=1)
        self.assertEqual(q['witness']['nativeIndex'], 0)
        self.assertEqual(q['witness']['queryWarnings'], ['best-warning'])
        self.assertEqual(q['queryWarnings'], [dict(nativeIndex=1, message='nonbest-warning'), dict(nativeIndex=0, message='best-warning')])

    def test_hole_not_uv_rectangle_and_query_warnings_preserved(self):
        c = self.capture(); before = c.path.read_bytes(); model = native.reconstruct_trim(c)
        self.assertTrue(model.report['completeNativeFaceCoverage'])
        self.assertFalse(model.report['productAcceptance']); self.assertFalse(model.report['uvRectangleUsedAsTrim'])
        inside = model.query([1.5, 0., 0.]); hole = model.query([0., 0., 0.])
        self.assertLess(inside['witness']['distance'], 1e-12); self.assertAlmostEqual(hole['witness']['distance'], 1.)
        self.assertEqual(hole['queryFailures'], []); self.assertTrue(hole['witness']['queryWarnings'])
        self.assertEqual(c.path.read_bytes(), before)

    def test_bad_native_sample_unsupported_and_failed_query_not_hidden(self):
        d = annulus(); d['faces'][0]['nativeSamples'][0]['point'][0] += 1e-7
        m = native.reconstruct_trim(self.capture(d))
        self.assertFalse(m.report['completeNativeFaceCoverage']); self.assertEqual(len(m.report['unsupported']), 1)
        self.assertIsNone(m.query([0., 0., 0.])['witness']); self.assertEqual(m.query([0., 0., 0.])['unsupportedFaceCount'], 1)
        m = native.reconstruct_trim(self.capture())
        with patch.object(native, '_state', side_effect=ValueError('explicit query failure')):
            q = m.query([1.5, 0., 0.]); self.assertIsNone(q['witness']); self.assertTrue(q['queryFailures'])


if __name__ == '__main__':unittest.main()
