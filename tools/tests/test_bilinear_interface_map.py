from pathlib import Path
import json
import os
import unittest
import numpy as np

from tools.bolthex.bilinear_interface_map import match_supports, unit_square_chains


Q = np.array([[0.,0.,0.], [1.,0.,0.], [1.,1.,.1], [0.,1.,0.]])


def square_edges():
    uv = np.array([[0.,0.],[1.,0.],[1.,1.],[0.,1.]])
    return [dict(controls=[a,b],endpoints=[a,b]) for a,b in zip(uv,np.roll(uv,-1,axis=0))]


class InterfaceControls(unittest.TestCase):
    def test_all_eight_cyclic_control_frames(self):
        for q in (Q, Q[::-1]):
            for shift in range(4):
                result = match_supports({'source':Q},{12:np.roll(q,shift,axis=0)})
                self.assertEqual(result['source']['faceIndex'],12)

    def test_support_codec_roundoff_is_not_geometry_budget(self):
        near = Q.copy();near[2,2] = np.nextafter(near[2,2],1.)
        self.assertEqual(match_supports({1:Q},{2:near})[1]['faceIndex'],2)
        near[2,2] += 1e-8
        with self.assertRaises(ValueError): match_supports({1:Q},{2:near})

    def test_crossed_and_duplicate_supports_reject(self):
        for candidates in ({2:Q[[0,2,1,3]]},{2:Q,3:Q.copy()}):
            with self.assertRaises(ValueError): match_supports({1:Q},candidates)
        with self.assertRaises(ValueError): match_supports({1:Q,2:Q},{3:Q})

    def test_invalid_or_ambiguous_reference_input_rejects(self):
        for refs in ({1:Q,'1':Q}, {True:Q}, {1:np.full((4,3),np.nan)},
                     {1:Q.astype(complex)}, {1:Q.astype(str)}, {1:Q[:3]}):
            with self.subTest(refs=refs), self.assertRaises(ValueError):
                match_supports(refs,{2:Q})

    def test_complete_square(self):
        result=unit_square_chains(square_edges())
        self.assertTrue(result['complete'])
        self.assertFalse(result['requiresSplitEdgePlanning'])

    def test_split_side_retained_as_explicit_obligation(self):
        edges=square_edges()[1:]
        edges.extend([dict(controls=[[0.,0.],[.4,0.]],endpoints=[[0.,0.],[.4,0.]]),
                      dict(controls=[[.4,0.],[1.,0.]],endpoints=[[.4,0.],[1.,0.]])])
        self.assertTrue(unit_square_chains(edges)['complete'])
        self.assertTrue(unit_square_chains(edges)['requiresSplitEdgePlanning'])

    def test_trim_shift_gap_overlap_and_curved_side_reject(self):
        for kind in ('shift','gap','overlap','curve','empty'):
            edges=square_edges()
            if kind=='shift': edges[0]=dict(controls=[[0.,1e-8],[1.,1e-8]],endpoints=[[0.,1e-8],[1.,1e-8]])
            if kind=='gap': edges[0]=dict(controls=[[.01,0.],[1.,0.]],endpoints=[[.01,0.],[1.,0.]])
            if kind=='overlap': edges.append(edges[0])
            if kind=='curve': edges[0]['controls']=[[0.,0.],[.5,.01],[1.,0.]]
            if kind=='empty': edges=[]
            with self.subTest(kind=kind): self.assertFalse(unit_square_chains(edges)['complete'])

    def test_backtracking_polynomial_side_rejects(self):
        edges = square_edges()
        edges[0]['controls'] = [[0.,0.],[.8,0.],[.2,0.],[1.,0.]]
        self.assertFalse(unit_square_chains(edges)['complete'])

    def test_inconsistent_endpoint_and_control_claim_rejects(self):
        edges = square_edges()
        edges[0]['controls'] = [[.4,0.],[.6,0.]]
        self.assertFalse(unit_square_chains(edges)['complete'])


@unittest.skipUnless(os.environ.get('BILINEAR_INTERFACE_RECEIPT'),'Explicit actual 2160-face receipt required')
class ActualInterfaceReceipt(unittest.TestCase):
    def test_all_actual_source_interfaces_remain_accounted(self):
        import hashlib
        from tools.bolthex.bilinear_interface_map import inspect_brep
        from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy
        receipt=json.loads(Path(os.environ['BILINEAR_INTERFACE_RECEIPT']).read_bytes())
        for p,h in receipt['caseInputSHA256'].items():
            self.assertEqual(hashlib.sha256(Path(p).read_bytes()).hexdigest(),h)
        old=Path('F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm')
        with np.load(old/'inward-collar/whole-ratio060-v2/composite.npz',allow_pickle=False) as z:
            xyz={int(n):p.tolist() for n,p in zip(z['node_ids'],z['nodes'])}
        rows=json.loads((old/'iges-production-screw-20261107/screw-study/axis-end-geometry/full-body-core-prototype-20261107/physical-face-owners.json').read_bytes())
        refs={str(r['eid']):[xyz[n] for n in r['nodeIDs']] for r in rows if r['role']=='protected-corewall'}
        actual=inspect_brep(receipt['brepPath'],refs,geometry_policy=CadAccuracyPolicy.engineering(.2))
        self.assertEqual(actual['interfaces'],receipt['interfaces'])
        self.assertEqual(actual['matchedSupports'],2160)
        self.assertEqual(actual['unresolvedCount'],15)
        self.assertEqual(actual['directInstallCount'],2145)
        self.assertFalse(actual['meshInstalled'])
        self.assertFalse(actual['wholeMeshAccepted'])


if __name__=='__main__': unittest.main()
