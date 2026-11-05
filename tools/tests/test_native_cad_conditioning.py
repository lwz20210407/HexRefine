import importlib.util
import json
import math
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tools.bolthex.native_cad_conditioning import LIMITS, audit_step_carrier, step_carrier_acceptance


def measured_fixture():
    forward=[]
    for role, distance in [('surface',0.),('mesh-boundary-node',0.)]+[('control',.00002)]*6+[('control',.1)]:
        forward.append(dict(index=len(forward),point=[1.,0.,0.],role=role,sourceDistance=distance,
                            referenceDistance=distance,candidateDistance=distance))
    return dict(completeWitnessCoverage=True,sourceValid=True,candidateValid=True,inputsUnchanged=True,
        allCandidateFacesOwnedBySingleSolid=True,sourceSolids=1,candidateSolids=1,
        nativeApproxVolumeUsedForAcceptance=False,failedWitnesses=[],sourceVolume=1.,stepBrepVolume=1.,
        sourceFaces=1,candidateFaces=1,candidateEdges=1,referencePoints=len(forward),boundaryNodeControls=1,
        sourceBounds=[-1.,-1.,-1.,1.,1.,1.],candidateBounds=[-1.,-1.,-1.,1.,1.,1.],forward=forward,
        sourceFaceWitnesses=[dict(face=0,point=[1.,0.,0.],candidateDistance=0.)],
        reverse=[dict(face=0,point=[1.,0.,0.],sourceDistance=0.)],
        edgeReverse=[dict(edge=0,point=[1.,0.,0.],sourceDistance=0.)],**{k:0. for k in LIMITS})


class StepCarrierGateTests(unittest.TestCase):
    def test_complete_consistent_measurements_pass_but_boolean_claims_are_not_enough(self):
        self.assertTrue(step_carrier_acceptance(measured_fixture()))
        self.assertFalse(step_carrier_acceptance(dict(strictStepCarrierVerified=True)))
        for key in ('completeWitnessCoverage','sourceValid','candidateValid','inputsUnchanged','allCandidateFacesOwnedBySingleSolid'):
            for value in (False,1,'true',None):
                r=measured_fixture();r[key]=value
                with self.subTest(key=key,value=value):self.assertFalse(step_carrier_acceptance(r))

    def test_every_numeric_gate_is_required_and_cannot_be_relaxed(self):
        for key,limit in LIMITS.items():
            for value in (None,math.nan,math.inf,-1.,True,limit*1.01):
                r=measured_fixture();r[key]=value
                with self.subTest(key=key,value=value):self.assertFalse(step_carrier_acceptance(r))
            r=measured_fixture();r.pop(key)
            with self.subTest(missing=key):self.assertFalse(step_carrier_acceptance(r))

    def test_raw_witnesses_cannot_be_hidden_by_passing_maxima(self):
        for group,field in (('forward','candidateDistance'),('sourceFaceWitnesses','candidateDistance'),
                            ('reverse','sourceDistance'),('edgeReverse','sourceDistance')):
            r=measured_fixture();r[group][0][field]=.001
            with self.subTest(group=group):self.assertFalse(step_carrier_acceptance(r))
        r=measured_fixture();r['forward'][2]['candidateDistance']=math.nan
        self.assertFalse(step_carrier_acceptance(r))

    def test_incomplete_faces_edges_nodes_or_controls_reject(self):
        for field in ('sourceFaceWitnesses','reverse','edgeReverse'):
            r=measured_fixture();r[field]=[]
            with self.subTest(field=field):self.assertFalse(step_carrier_acceptance(r))
        for role in ('control','mesh-boundary-node'):
            r=measured_fixture();r['forward']=[p for p in r['forward'] if p['role']!=role]
            r['referencePoints']=len(r['forward'])
            for i,p in enumerate(r['forward']):p['index']=i
            with self.subTest(role=role):self.assertFalse(step_carrier_acceptance(r))
        r=measured_fixture();r['failedWitnesses']=[dict(kind='candidate-face',index=0,error='No strict IN point')]
        self.assertFalse(step_carrier_acceptance(r))

    def test_approximate_host_mass_cannot_replace_independent_brep_mass(self):
        r=measured_fixture();r['nativeApproxVolumeUsedForAcceptance']=True
        self.assertFalse(step_carrier_acceptance(r))
        r=measured_fixture();r['nativeHostVolume']=1.;r['stepBrepVolume']=1.01
        self.assertFalse(step_carrier_acceptance(r))
        r=measured_fixture();r['stepBrepVolume']=None
        self.assertFalse(step_carrier_acceptance(r))

    def test_actual_bounds_and_entity_indices_must_match_summary(self):
        r=measured_fixture();r['candidateBounds'][5]+=.000001
        self.assertFalse(step_carrier_acceptance(r))
        r=measured_fixture();r['reverse'][0]['face']=False
        self.assertFalse(step_carrier_acceptance(r))
        r=measured_fixture();r['forward'][0]['index']=False
        self.assertFalse(step_carrier_acceptance(r))


@unittest.skipUnless(importlib.util.find_spec('build123d') and os.environ.get('BOLTHEX_TEST_ROOT'),
                     'Explicit CAD runtime and dated BOLTHEX_TEST_ROOT required')
class TinyActualStepCarrierTests(unittest.TestCase):
    def setUp(self):
        from build123d import Box,export_step
        from tools.hypermesh_geometry_probe import sha
        self.temp=tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']);self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.source=self.root/'source.step';self.carrier=self.root/'carrier.step'
        shape=Box(2,2,2);export_step(shape,self.source);export_step(shape,self.carrier)
        points=[]
        for axis in range(3):
            for sign in (-1,1):
                p=[0.,0.,0.];p[axis]=float(sign)
                points.append(dict(point=p,role='mesh-boundary-node',sourceDistance=0.))
                q=p.copy();q[axis]+=sign*.00002
                points.append(dict(point=q,role='control',sourceDistance=.00002))
        points.append(dict(point=[2.,0.,0.],role='control',sourceDistance=1.))
        self.ref=self.root/'reference.json';self.ref.write_text(json.dumps(dict(sourceStepSHA256=sha(self.source),points=points)))

    def test_real_closed_step_measures_every_physical_face_edge_and_controls(self):
        from tools.hypermesh_geometry_probe import sha
        before={p:sha(p) for p in (self.source,self.carrier,self.ref)}
        out=self.root/'audit.json';r=audit_step_carrier(self.source,self.carrier,self.ref,out)
        self.assertTrue(r['strictStepCarrierVerified']);self.assertTrue(r['completeWitnessCoverage'])
        self.assertEqual(r['candidateFaces'],6);self.assertEqual(r['candidateEdges'],12)
        self.assertEqual(len(r['sourceFaceWitnesses']),6);self.assertEqual(len(r['reverse']),6)
        self.assertEqual(len(r['edgeReverse']),60);self.assertEqual(r['boundaryNodeControls'],6)
        self.assertAlmostEqual(r['stepBrepVolume'],8.)
        self.assertFalse(r['nativeHmVerified']);self.assertFalse(r['fullModelAcceptance'])
        self.assertEqual(r,json.loads(out.read_text()))
        for p,h in before.items():self.assertEqual(sha(p),h)
        with self.assertRaisesRegex(ValueError,'fresh audit output'):audit_step_carrier(self.source,self.carrier,self.ref,out)

    def test_stale_reference_or_missing_calibrated_controls_rejects_before_cad(self):
        r=json.loads(self.ref.read_text());r['sourceStepSHA256']='0'*64;self.ref.write_text(json.dumps(r))
        with self.assertRaisesRegex(ValueError,'hash mismatch'):audit_step_carrier(self.source,self.carrier,self.ref)
        from tools.hypermesh_geometry_probe import sha
        r['sourceStepSHA256']=sha(self.source);r['points']=[p for p in r['points'] if p['role']!='mesh-boundary-node']
        r['points'].append(dict(point=[1.,0.,0.],role='surface',sourceDistance=0.));self.ref.write_text(json.dumps(r))
        with self.assertRaisesRegex(ValueError,'boundary-node controls'):audit_step_carrier(self.source,self.carrier,self.ref)

    def test_missing_verified_interior_fails_closed_but_still_audits_all_edges(self):
        with patch('tools.bolthex.native_cad_conditioning._interior_point',side_effect=ValueError('unverified interior')):
            r=audit_step_carrier(self.source,self.carrier,self.ref)
        self.assertFalse(r['strictStepCarrierVerified']);self.assertFalse(r['completeWitnessCoverage'])
        self.assertEqual(len(r['failedWitnesses']),12);self.assertEqual(len(r['edgeReverse']),60)
        self.assertEqual(r['maximumReverseEdgeDistance'],0.)

    def test_auxiliary_free_curve_does_not_pollute_physical_bounds_or_edges(self):
        from build123d import Box,Compound,Edge,export_step
        shape=Compound(children=[Box(2,2,2),Edge.make_line((100.,0.,0.),(101.,0.,0.))])
        export_step(shape,self.carrier)
        r=audit_step_carrier(self.source,self.carrier,self.ref)
        self.assertTrue(r['strictStepCarrierVerified']);self.assertEqual(r['maximumCadBoundsDifference'],0.)
        self.assertEqual(r['candidateEdges'],12)

    def test_extra_actual_face_cannot_be_discarded_even_with_equal_solid_mass(self):
        from build123d import Box,Compound,Face,Wire,export_step
        extra=Face(Wire.make_polygon([(5.,0.,0.),(6.,0.,0.),(6.,1.,0.),(5.,1.,0.)],close=True))
        export_step(Compound(children=[Box(2,2,2),extra]),self.carrier)
        r=audit_step_carrier(self.source,self.carrier,self.ref)
        self.assertFalse(r['strictStepCarrierVerified']);self.assertEqual(r['candidateFaces'],7)
        self.assertFalse(r['allCandidateFacesOwnedBySingleSolid'])
        self.assertEqual(r['relativeStepBrepVolumeError'],0.)
        self.assertGreater(r['maximumCadBoundsDifference'],1e-5)

    def test_invalid_carrier_gets_structured_rejection_without_fabricated_measurements(self):
        from build123d import import_step
        actual=import_step(self.carrier)
        invalid=SimpleNamespace(is_valid=False,faces=actual.faces,solids=actual.solids)
        def imported(path):return invalid if Path(path)==self.carrier else import_step(path)
        with patch('build123d.import_step',side_effect=imported), \
                patch('tools.bolthex.native_cad_conditioning._mass') as mass:
            r=audit_step_carrier(self.source,self.carrier,self.ref,self.root/'invalid-audit.json')
        self.assertFalse(r['strictStepCarrierVerified']);self.assertTrue(r['preflightRejected'])
        self.assertEqual(r['forward'],[]);self.assertIsNone(r['stepBrepVolume'])
        self.assertIsNone(r['maximumReverseEdgeDistance']);mass.assert_not_called()


if __name__=='__main__':unittest.main()
