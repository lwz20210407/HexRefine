"""Structural witness-lineage guards; synthetic measurements are test stubs."""
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest

import numpy as np

from tools.bolthex.cad_cap_whole import _body_boundary_coverage
from tools.bolthex.mesh_audit import FACES
from tools.bolthex.mesh_core import Mesh3D


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@unittest.skipUnless(os.environ.get('BOLTHEX_TEST_ROOT'),'Explicit scratch directory required')
class BoundaryLineageTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT'])
        self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.old=np.array([[4.5,0,4],[5.5,0,4],[5.5,1,4],[4.5,1,4],
                           [4.5,0,5],[5.5,0,5],[5.5,1,5],[4.5,1,5]],dtype='<f8')
        self.cells=np.arange(8,dtype='<i4')[None,:]
        self.old.tofile(self.root/'nodes.f64');self.cells.tofile(self.root/'elements.i32')
        self.body=Mesh3D('TEST_LINEAGE_ONLY');self.body.nodes=self.old.copy()
        self.body.nodes[1,0]+=.00001;self.body.elems=self.cells.copy()
        self.body.body_equatorial_rings=np.array([[4,5,6,7]])
        self.body.surfaces={'dome-equator':FACES[[1]].copy()}
        np.savez(self.root/'dome-interface.npz',nodeRings=self.body.body_equatorial_rings,
                 faces=self.body.surfaces['dome-equator'],coordinates=self.old[[[4,5,6,7]]])
        self.physical=FACES[[0,2,3,4,5]].copy()
        (self.root/'model.k').write_text('*KEYWORD\n$ Synthetic lineage fixture, not CAD acceptance\n*END\n')
        self.source=dict(fullBody=True,bodyAccepted=True,sourceStepSHA256='synthetic-source',
                         kSHA256=sha(self.root/'model.k'),sourceBoundaryNodesChecked=8,sourceBoundaryFacesChecked=5,
                         maximumBoundaryNodeDistanceMm=1e-8,maximumBoundaryFaceCenterDistanceMm=.01)
        (self.root/'report.json').write_text(json.dumps(self.source))
        (self.root/'independent-k-audit.json').write_text(json.dumps(dict(reader='ansys-dyna-core',
            exactConnectivity=True,kSHA256=self.source['kSHA256'],syntheticTestStub=True)))
        (self.root/'cache-manifest.json').write_text(json.dumps(dict(hashes={
            name:sha(self.root/name) for name in ('nodes.f64','elements.i32','dome-interface.npz')})))
        names={'report.json':'acceptedReport','cache-manifest.json':'cacheManifest','nodes.f64':'nodes.f64',
               'elements.i32':'elements.i32','dome-interface.npz':'dome-interface.npz',
               'independent-k-audit.json':'independentSourceKReport','model.k':'sourceK'}
        frozen=np.linalg.norm(self.old[:,:2],axis=1)<=4.75+1e-10
        bound=hashlib.sha256(self.old[frozen].tobytes()).hexdigest()
        self.body.dims=dict(purpose='opt-in-complete-body-exterior-corner-reanchor',exteriorFeatureAccepted=True,
            fixedRadiusMm=4.75,sourceStepSHA256='synthetic-source',thetaDeg=[0,90,180,270],equatorRadiiMm=[4.75],
            maximumBoundaryNodeDistanceMm=1e-8,maximumBoundaryFaceCenterDistanceMm=.01,
            frozenNodeCount=int(frozen.sum()),frozenSourceSHA256=bound,frozenResultSHA256=bound,
            inheritedWitnessEvidence=dict(sourceCache=str(self.root),sourceEvidenceSHA256={
                key:sha(self.root/name) for name,key in names.items()},
                maximumInheritedNodeDistanceBoundMm=1e-8,maximumInheritedFaceCenterDistanceBoundMm=.01),
            freshBoundaryWitnesses=dict(maximumNodeDistanceMm=1e-8,maximumFaceCenterDistanceMm=.01))
        self.refresh_counts()

    def refresh_counts(self):
        changed=np.any(self.old.view(np.uint64)!=self.body.nodes.view(np.uint64),axis=1)
        touched=changed[self.physical].any(axis=1);fresh_ids=np.unique(self.physical[touched])
        r=self.body.dims
        r.update(sourceBoundaryNodesChecked=len(fresh_ids),sourceBoundaryFacesChecked=int(touched.sum()),
            sourceBoundaryNodesInherited=8-len(fresh_ids),sourceBoundaryFacesInherited=int((~touched).sum()),
            sourceBoundaryNodesCovered=8,sourceBoundaryFacesCovered=5)
        r['freshBoundaryWitnesses'].update(nodes=len(fresh_ids),faces=int(touched.sum()))
        r['inheritedWitnessEvidence'].update(inheritedPhysicalBoundaryNodes=8-len(fresh_ids),
                                            inheritedPhysicalBoundaryFaces=int((~touched).sum()))

    def test_valid_coordinate_partition_covers_every_physical_face(self):
        result=_body_boundary_coverage(self.body,self.physical)
        self.assertEqual(result['faces'],5);self.assertEqual(result['nodes'],8)
        self.assertEqual(result['freshFaces'],3);self.assertEqual(result['inheritedFaces'],2)
        self.assertTrue(result['coreCoordinatesUnchanged'])

    def test_plausible_sum_cannot_replace_actual_changed_face_counts(self):
        r=self.body.dims;r['sourceBoundaryFacesChecked']-=1;r['sourceBoundaryFacesInherited']+=1
        r['freshBoundaryWitnesses']['faces']-=1
        r['inheritedWitnessEvidence']['inheritedPhysicalBoundaryFaces']+=1
        with self.assertRaisesRegex(ValueError,'actual node changes'):_body_boundary_coverage(self.body,self.physical)

    def test_another_changed_node_cannot_inherit_old_witnesses(self):
        self.body.nodes[2,0]+=.00001
        with self.assertRaisesRegex(ValueError,'actual node changes'):_body_boundary_coverage(self.body,self.physical)

    def test_core_motion_rejects_even_when_all_counts_and_hash_claims_are_updated(self):
        self.body.nodes[0,0]+=.00001;self.refresh_counts()
        frozen=np.linalg.norm(self.old[:,:2],axis=1)<=4.75+1e-10
        self.body.dims['frozenResultSHA256']=hashlib.sha256(self.body.nodes[frozen].tobytes()).hexdigest()
        with self.assertRaisesRegex(ValueError,'core/fixed cylinder changed'):_body_boundary_coverage(self.body,self.physical)

    def test_source_hash_connectivity_and_interface_tampering_reject(self):
        old=self.body.elems.copy();self.body.elems[0,[0,1]]=self.body.elems[0,[1,0]]
        with self.assertRaisesRegex(ValueError,'connectivity'):_body_boundary_coverage(self.body,self.physical)
        self.body.elems=old
        self.body.surfaces['dome-equator']=self.body.surfaces['dome-equator'][:,[0,2,1,3]]
        with self.assertRaisesRegex(ValueError,'interface differs'):_body_boundary_coverage(self.body,self.physical)
        self.body.surfaces['dome-equator']=FACES[[1]].copy()
        (self.root/'report.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'cache hash differs'):_body_boundary_coverage(self.body,self.physical)

    def test_nonfinite_or_truthy_distance_claims_never_pass(self):
        original=copy.deepcopy(self.body.dims['freshBoundaryWitnesses'])
        for value in (True,float('nan'),float('inf'),-1.,2.00001e-6):
            self.body.dims['freshBoundaryWitnesses']=dict(original,maximumNodeDistanceMm=value)
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'distance bounds'):
                _body_boundary_coverage(self.body,self.physical)


if __name__=='__main__':unittest.main()
