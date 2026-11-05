"""Small exterior-only proofs before the opt-in accepted full-cache experiment."""
import importlib.util
import json
import math
import os
from pathlib import Path
import tempfile
import unittest

import numpy as np

from tools.bolthex.cad_cap_body_features import (
    _accepted_boundary_evidence,_sha,hex_corner_edges,reanchor_outer_ring,reanchor_cached_body,
)
from tools.bolthex.cad_cap_body import _connect
from tools.bolthex.mesh_audit import audit_h8


def angles(gnomonic=True):
    if not gnomonic:return np.arange(96)*360/96
    base=np.arctan(np.linspace(-1,1,25)[:-1])
    return np.rad2deg(np.sort(np.mod(np.concatenate([base+k*math.pi/2 for k in range(4)]),math.tau)))


def patch_nodes(theta,query):
    nodes=[]
    for z in (1.,2.,3.):
        for radius in (4.75,None):
            for t in theta:
                r=query(float(t),z) if radius is None else radius
                a=math.radians(t);nodes.append((r*math.cos(a),r*math.sin(a),z))
    return np.array(nodes)


def hex_radius(theta,z):
    a=math.radians(theta)
    return min(5/math.cos(a-n) for n in (math.pi/6+k*math.pi/3 for k in range(6)) if math.cos(a-n)>0)


class SmallFeatureTests(unittest.TestCase):
    def test_inherited_bounds_reject_bool_negative_nonfinite_and_flags(self):
        good=dict(fullBody=True,bodyAccepted=True,maximumBoundaryNodeDistanceMm=0.,maximumBoundaryFaceCenterDistanceMm=.01)
        self.assertEqual(_accepted_boundary_evidence(good),(0.,.01))
        for key in ('maximumBoundaryNodeDistanceMm','maximumBoundaryFaceCenterDistanceMm'):
            for value in (True,False,-1,float('nan'),float('inf'),'0'):
                with self.subTest(key=key,value=value),self.assertRaisesRegex(ValueError,'finite nonnegative'):
                    _accepted_boundary_evidence(dict(good,**{key:value}))
        for key in ('fullBody','bodyAccepted'):
            for value in (1,False,None):
                with self.subTest(key=key,value=value),self.assertRaisesRegex(ValueError,'strict'):
                    _accepted_boundary_evidence(dict(good,**{key:value}))

    def test_only_outer_ring_moves_without_changing_z_or_input(self):
        theta=angles();source=patch_nodes(theta,hex_radius);copy=source.copy()
        result,changed,report=reanchor_outer_ring(source,theta,2,np.arange(6)*math.pi/3,hex_radius)
        frozen=np.arange(len(source)).reshape(3,2,96)[:,0].ravel()
        np.testing.assert_array_equal(source,copy)
        np.testing.assert_array_equal(source[frozen].view(np.uint64),result[frozen].view(np.uint64))
        np.testing.assert_array_equal(source[:,2],result[:,2])
        self.assertTrue(report['needsReanchor']);self.assertGreater(len(changed),0)
        self.assertTrue(np.all(np.linalg.norm(source[changed,:2],axis=1)>4.75))
        q,_=audit_h8(result,_connect(96,2,2),0)
        self.assertGreaterEqual(q['minimumCornerScaledJacobian'],.15)

    def test_all_corner_rays_already_exact_requires_no_queries_or_changes(self):
        theta=angles(False);source=patch_nodes(theta,hex_radius)
        def forbidden(*args):raise AssertionError('Already aligned patch must not query or move')
        result,changed,report=reanchor_outer_ring(source,theta,2,np.arange(6)*math.pi/3,forbidden)
        self.assertFalse(report['needsReanchor']);self.assertEqual(len(changed),0)
        np.testing.assert_array_equal(result,source)

    def test_invalid_layout_angles_and_cad_radius_reject(self):
        theta=angles();source=patch_nodes(theta,hex_radius)
        with self.assertRaisesRegex(ValueError,'Invalid indexed'):
            reanchor_outer_ring(source,theta,True,np.arange(6)*math.pi/3,hex_radius)
        bad=source.copy();bad[0,0]=5
        with self.assertRaisesRegex(ValueError,'one outer ring'):
            reanchor_outer_ring(bad,theta,2,np.arange(6)*math.pi/3,hex_radius)
        for value in (float('nan'),4.75):
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'invalid exterior radius'):
                reanchor_outer_ring(source,theta,2,np.arange(6)*math.pi/3,lambda t,z:value)

    @unittest.skipUnless(os.environ.get('BOLTHEX_TEST_ROOT'),'explicit scratch required')
    def test_changed_cache_rejects_before_source_cad_load(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as temporary:
            root=Path(temporary)
            (root/'report.json').write_text(json.dumps(dict(bodyAccepted=True,fullBody=True,
                maximumBoundaryNodeDistanceMm=0.,maximumBoundaryFaceCenterDistanceMm=0.)))
            (root/'cache-manifest.json').write_text(json.dumps(dict(schemaVersion=1,
                shapeCacheReconstructedFromIdenticalIndependentCrop=True,hashes={'nodes.f64':'wrong'})))
            (root/'nodes.f64').write_bytes(b'not accepted nodes')
            with self.assertRaisesRegex(ValueError,'cache hashes'):
                reanchor_cached_body(root)


@unittest.skipUnless(importlib.util.find_spec('build123d') and os.environ.get('HEXREFINE_CAP_STEP'),
                     'select actual saved M6 STEP')
class SmallRealCadProof(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from build123d import import_step
        from tools.bolthex.cad_mesh import RadialCad
        cls.shape=import_step(os.environ['HEXREFINE_CAP_STEP']);cls.edges=hex_corner_edges(cls.shape)
        cls.cad=RadialCad(cls.shape,True);cls.theta=angles()
        query=lambda t,z:cls.cad.radii(t,z)[1]
        cls.source=patch_nodes(cls.theta,query)
        cls.result,cls.changed,cls.report=reanchor_outer_ring(cls.source,cls.theta,2,
            [e[0] for e in cls.edges],query)

    def test_actual_small_h8_patch_is_nondegenerate_and_frozen(self):
        q,_=audit_h8(self.result,_connect(96,2,2),0)
        self.assertEqual(q['elements'],192)
        self.assertGreaterEqual(q['minimumCornerScaledJacobian'],.15)
        np.testing.assert_array_equal(self.result.reshape(3,2,96,3)[:,0],self.source.reshape(3,2,96,3)[:,0])
        print(json.dumps(dict(smallRealCadH8=q['elements'],minimumSJ=q['minimumCornerScaledJacobian'],
            scope='exterior patch only, not continuum-volume or whole-body acceptance')))

    def test_six_actual_cad_corner_lines_and_changed_surface_nodes(self):
        grid=self.result.reshape(3,2,96,3)
        maximum=0.
        for index,(_,edge,_) in zip(self.report['anchorIndices'],self.edges):
            maximum=max(maximum,max(edge.distance_to(tuple(p)) for p in grid[:,-1,index]))
        self.assertLessEqual(maximum,2e-6)
        for p in self.result[self.changed]:
            self.assertLessEqual(self.cad.surface_witness_distance(p),2e-6)
        print(json.dumps(dict(sixActualCornerEdges=True,maximumEdgeDistanceMm=maximum)))


FEATURE_CACHE=os.environ.get('HEXREFINE_BODY_FEATURE_CACHE') or os.environ.get('HEXREFINE_BODY_FEATURE_DIR')


@unittest.skipUnless(FEATURE_CACHE and (Path(FEATURE_CACHE)/'boundary-coverage-proof.json').is_file(),
                     'select the delivered body feature cache; no CAD queries needed')
class DeliveredFeatureCacheTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root=Path(FEATURE_CACHE)
        cls.report=json.loads((cls.root/'report.json').read_text())
        cls.proof=json.loads((cls.root/'boundary-coverage-proof.json').read_text())
        cls.source=Path(cls.proof['sourceAcceptedCache'])
        data=np.load(cls.root/cls.report['bodyMeshFile'])
        cls.nodes,cls.cells=data['nodes'],data['elements']
        cls.old=np.fromfile(cls.source/'nodes.f64','<f8').reshape(-1,3)
        ids=np.load(cls.root/cls.proof['identitiesFile'])
        cls.ids={name:ids[name] for name in ids.files}

    def test_new_npz_port_and_independent_readbacks_are_hash_bound(self):
        r,p,root=self.report,self.proof,self.root
        self.assertEqual(r['bodyMeshFile'],'feature-body.npz')
        self.assertEqual(r['interfaceFile'],'dome-interface.npz')
        self.assertEqual(_sha(root/r['bodyMeshFile']),r['bodyMeshFileSHA256'])
        self.assertEqual(_sha(root/r['interfaceFile']),r['interfaceFileSHA256'])
        self.assertEqual(_sha(root/'report.json'),p['candidateReportSHA256'])
        self.assertEqual(_sha(root/'cache-manifest.json'),p['candidateCacheManifestSHA256'])
        self.assertEqual(_sha(root/p['identitiesFile']),p['identitiesSHA256'])
        self.assertEqual(_sha(self.source/'report.json'),p['sourceReportSHA256'])
        self.assertEqual(_sha(root/'elements.i32'),p['unchangedConnectivitySHA256'])
        k=json.loads((root/'independent-k-audit.json').read_text())
        self.assertIs(k['exactConnectivity'],True)
        self.assertEqual(_sha(root/'model.k'),k['kSHA256'])
        self.assertEqual(k['kSHA256'],r['kSHA256'])
        self.assertEqual(_sha(root/'model.inp'),r['inpSHA256'])
        self.assertEqual(self.nodes.dtype,np.dtype('float64'))
        eq=np.load(root/r['interfaceFile']);old_eq=np.load(self.source/'dome-interface.npz')
        for name in ('nodeRings','coordinates','faces','thetaDeg'):
            np.testing.assert_array_equal(eq[name],old_eq[name])
        np.testing.assert_array_equal(self.nodes[eq['nodeRings']],eq['coordinates'])

    def test_fresh_inherited_identities_partition_actual_physical_boundary(self):
        from tools.bolthex.mesh_audit import FACES
        c=self.ids
        all_faces=self.cells[:,FACES].reshape(-1,4)
        keys,counts=np.unique(np.sort(all_faces,axis=1),axis=0,return_counts=True)
        boundary=keys[counts==1]
        eq=np.load(self.root/'dome-interface.npz')
        interface={tuple(sorted(f)) for f in eq['faces']}
        physical=np.array([f for f in boundary if tuple(f) not in interface])
        np.testing.assert_array_equal(physical,c['physicalFaceKeys'])
        actual=self.cells[c['physicalFaceOwnerIds'][:,None],FACES[c['physicalFaceLocalIndices']]]
        np.testing.assert_array_equal(actual,c['physicalFaceCycles'])
        np.testing.assert_array_equal(np.sort(actual,axis=1),physical)
        changed=np.any(self.nodes!=self.old,axis=1)
        np.testing.assert_array_equal(np.flatnonzero(changed),c['changedNodeIds'])
        fresh=changed[actual].any(axis=1)
        np.testing.assert_array_equal(fresh,c['freshFaceMask'])
        np.testing.assert_array_equal(physical[fresh],c['freshFaceKeys'])
        np.testing.assert_array_equal(physical[~fresh],c['inheritedFaceKeys'])
        np.testing.assert_array_equal(np.unique(actual[fresh]),c['freshNodeIds'])
        np.testing.assert_array_equal(np.setdiff1d(np.unique(actual),c['freshNodeIds']),c['inheritedNodeIds'])
        np.testing.assert_array_equal(self.nodes[c['frozenNodeIds']].view(np.uint64),self.old[c['frozenNodeIds']].view(np.uint64))
        np.testing.assert_array_equal(self.nodes[actual[~fresh]].view(np.uint64),self.old[actual[~fresh]].view(np.uint64))

    def test_cached_full_qa_and_coverage_counts_are_scoped_not_requeried(self):
        r=self.report;c=self.ids
        self.assertEqual(r['quality']['elements'],len(self.cells))
        self.assertGreaterEqual(r['quality']['minimumCornerScaledJacobian'],.15)
        self.assertGreater(r['quality']['minimumGaussJacobian'],0)
        self.assertLessEqual(r['relativeCadH8VolumeError'],1e-4)
        self.assertEqual(r['sourceBoundaryNodesChecked'],len(c['freshNodeIds']))
        self.assertEqual(r['sourceBoundaryFacesChecked'],len(c['freshFaceKeys']))
        self.assertEqual(r['sourceBoundaryNodesInherited'],len(c['inheritedNodeIds']))
        self.assertEqual(r['sourceBoundaryFacesInherited'],len(c['inheritedFaceKeys']))
        self.assertIs(r['inheritedWitnessEvidence']['unchangedBoreWitnessesRerun'],False)
        self.assertFalse(r['cadCreaseConforming'])
        self.assertFalse(r['fullCapNut'])
        self.assertFalse(r['fullModelAcceptance'])
        for edge in r['actualCornerEdges']:
            self.assertLessEqual(edge['maximumDistanceToActualEdgeMm'],2e-6)
        self.assertIn('inherited',r['surfaceWitnessMethod'])


if __name__=='__main__':unittest.main()
