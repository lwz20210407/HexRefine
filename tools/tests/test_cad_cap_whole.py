"""Whole-cap guards plus an explicit saved-CAD/cache integration opt-in.

Set HEXREFINE_CAP_STEP, HEXREFINE_CAP_BODY_DELIVERY and
HEXREFINE_CAP_BODY_MESH to exercise real CAD without repeating body witnesses.
No test writes into the accepted delivery or invokes whole-cap publication.
"""
from contextlib import nullcontext
import importlib.util
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np

from tools.bolthex import cad_cap_whole as whole


def body_evidence():
    return dict(fullBody=True, bodyAccepted=True, maximumBoundaryNodeDistanceMm=0.,
                maximumBoundaryFaceCenterDistanceMm=0., relativeCadH8VolumeError=0.)


def cache_reports():
    quality=dict(nodes=8, elements=1, volume=1.)
    report=dict(body_evidence(), sourceStepSHA256='source', bodyMeshFileSHA256='mesh',
                interfaceFileSHA256='interface', kSHA256='keyword', quality=quality)
    independent=dict(reader='ansys-dyna-core', connectivityExact=True,
                     kSHA256='keyword', quality=quality.copy())
    return report, independent


def cache_hash(path):
    return {'source.step':'source', 'body.npz':'mesh', 'dome-interface.npz':'interface',
            'model.k':'keyword'}[Path(path).name]


class WholeCacheGuardTests(unittest.TestCase):
    def load_with(self, report, independent):
        return (patch.object(Path, 'read_text', side_effect=[json.dumps(report), json.dumps(independent)]),
                patch.object(whole, '_sha', side_effect=cache_hash))

    def test_each_source_mesh_interface_and_k_hash_is_bound_before_mesh_loading(self):
        for field in ('sourceStepSHA256', 'bodyMeshFileSHA256', 'interfaceFileSHA256', 'kSHA256'):
            report, independent=cache_reports()
            report[field]='mismatched'
            text_mock, hash_mock=self.load_with(report, independent)
            with self.subTest(field=field), text_mock, hash_mock, \
                    patch.object(whole.np, 'load') as load, patch.object(whole, 'audit_h8') as audit:
                with self.assertRaisesRegex(ValueError, 'bind source/mesh/interface/independent K'):
                    whole.load_body_delivery('unused-delivery', 'body.npz', 'source.step')
                load.assert_not_called();audit.assert_not_called()

    def test_independent_k_audit_cannot_be_missing_or_truthy_instead_of_exact(self):
        for changes in (dict(kSHA256='other'), dict(reader='native-parser'),
                        dict(connectivityExact=False), dict(connectivityExact=1),
                        dict(connectivityExact='true')):
            report, independent=cache_reports();independent.update(changes)
            text_mock, hash_mock=self.load_with(report, independent)
            with self.subTest(changes=changes), text_mock, hash_mock, patch.object(whole.np, 'load') as load:
                with self.assertRaisesRegex(ValueError, 'bind source/mesh/interface/independent K'):
                    whole.load_body_delivery('unused-delivery', 'body.npz', 'source.step')
                load.assert_not_called()

    def test_partial_or_unaccepted_body_is_rejected_before_array_loading(self):
        for field in ('fullBody', 'bodyAccepted'):
            for value in (False, 1, 'true', None):
                report, independent=cache_reports();report[field]=value
                text_mock, hash_mock=self.load_with(report, independent)
                with self.subTest(field=field, value=value), text_mock, hash_mock, patch.object(whole.np, 'load') as load:
                    with self.assertRaisesRegex(ValueError, 'accepted complete body'):
                        whole.load_body_delivery('unused-delivery', 'body.npz', 'source.step')
                    load.assert_not_called()

    def test_bound_hashes_do_not_replace_actual_mesh_count_and_volume_audits(self):
        arrays=dict(nodes=np.zeros((8,3)), elements=np.arange(8,dtype=np.int64)[None,:],
                    interface_node_rings=np.array([[0,1,2,3]]), interface_faces=np.array([[0,1,2,3]]))
        for change in ('nodes', 'elements', 'report-volume', 'independent-volume'):
            report, independent=cache_reports();actual=dict(report['quality'])
            if change in ('nodes', 'elements'):actual[change]+=1
            elif change=='report-volume':report['quality']['volume']=1.01
            else:independent['quality']['volume']=1.01
            text_mock, hash_mock=self.load_with(report, independent)
            with self.subTest(change=change), text_mock, hash_mock, \
                    patch.object(whole.np, 'load', return_value=nullcontext(arrays)) as load, \
                    patch.object(whole, 'audit_h8', return_value=(actual, np.empty((0,4),dtype=int))) as audit:
                with self.assertRaisesRegex(ValueError, 'actual mesh differs from its audits'):
                    whole.load_body_delivery('unused-delivery', 'body.npz', 'source.step')
                audit.assert_called_once()
                self.assertEqual(audit.call_args.args[2],0)
                self.assertEqual(load.call_count,1)


class WholeAssemblyGuardTests(unittest.TestCase):
    def test_preserving_original_step_for_partial_or_modified_domains_rejects_before_staging(self):
        from tools.bolthex import cad_cap_dome
        for report in ({}, dict(fullDome=True,fullCapNut=False,sourceCadUnmodified=True),
                       dict(fullCapNut=1,sourceCadUnmodified=True),
                       dict(fullCapNut=True,sourceCadUnmodified=False),
                       dict(fullCapNut=True,sourceCadUnmodified=1)):
            importer,exporter=Mock(),Mock()
            # Exercise the actual publication preflight without optional CAD
            # runtime access, staging files, invoking Node, or exporting STEP.
            with self.subTest(report=report), \
                    patch.dict(sys.modules,{'build123d':SimpleNamespace(import_step=importer,export_step=exporter)}), \
                    patch.object(Path,'exists',return_value=False), patch.object(Path,'is_dir',return_value=True), \
                    patch.object(Path,'is_file',return_value=True), \
                    patch.object(Path,'stat',return_value=SimpleNamespace(st_size=1)), \
                    patch('tools.bolthex.cad_mesh_pipeline._sha',return_value='source-digest'), \
                    patch.object(cad_cap_dome.tempfile,'TemporaryDirectory') as stage, \
                    patch.object(cad_cap_dome.subprocess,'run') as run:
                with self.assertRaisesRegex(ValueError,'unchanged complete source domain'):
                    whole._publish_partition('unread-source.step','unused-output','unused-node.exe',
                                             SimpleNamespace(elems=np.zeros((1,8),dtype=int)),
                                             None,report,'source-digest',preserve_source_step=True)
                stage.assert_not_called();run.assert_not_called()
                importer.assert_not_called();exporter.assert_not_called()

    def test_acceptance_flags_are_strict_and_precede_geometry_access(self):
        for side, field in (('dome','fullDome'), ('body','fullBody'), ('body','bodyAccepted')):
            for value in (False, 1, 'true', None):
                dome=SimpleNamespace(dims=dict(fullDome=True))
                body=SimpleNamespace(dims=body_evidence())
                (dome if side=='dome' else body).dims[field]=value
                with self.subTest(side=side, field=field, value=value), patch.object(whole,'equatorial_interface') as eq:
                    with self.assertRaisesRegex(ValueError,'validated complete dome and body'):
                        whole.assemble_whole(None,dome,body)
                    eq.assert_not_called()

    def test_all_three_source_matching_gates_reject_invalid_or_missing_evidence(self):
        for field,limit in (('maximumBoundaryNodeDistanceMm',2e-6),
                            ('maximumBoundaryFaceCenterDistanceMm',.02),
                            ('relativeCadH8VolumeError',1e-4)):
            for value in (None, True, '0', -1e-12, float('nan'), float('inf'), limit*1.000001):
                body=SimpleNamespace(dims=body_evidence())
                if value is None:body.dims.pop(field)
                else:body.dims[field]=value
                with self.subTest(field=field,value=value), patch.object(whole,'equatorial_interface') as eq:
                    with self.assertRaisesRegex(ValueError,'source CAD matching evidence'):
                        whole.assemble_whole(None,SimpleNamespace(dims=dict(fullDome=True)),body)
                    eq.assert_not_called()

    def test_component_overlap_or_body_outside_source_interval_rejects_before_audit(self):
        for bottom,top,dome_bottom in ((-.001,5.,5.), (0.,5.001,5.), (0.,5.,4.999)):
            body=SimpleNamespace(dims=body_evidence(), nodes=np.array([[0.,0.,bottom],[0.,0.,top]]))
            dome=SimpleNamespace(dims=dict(fullDome=True),nodes=np.array([[0.,0.,dome_bottom]]))
            with self.subTest(bottom=bottom,top=top,dome_bottom=dome_bottom), \
                    patch.object(whole,'equatorial_interface',return_value=dict(centerMm=[0.,0.,5.])), \
                    patch.object(whole,'body_equatorial_interface',return_value={}), patch.object(whole,'audit_h8') as audit:
                with self.assertRaisesRegex(ValueError,'component domains overlap'):
                    whole.assemble_whole(None,dome,body)
                audit.assert_not_called()

    def test_sparse_body_counts_cannot_impersonate_complete_boundary_evidence(self):
        for nodes_checked,faces_checked in ((3,1),(4,0)):
            evidence=dict(body_evidence(),sourceBoundaryNodesChecked=nodes_checked,sourceBoundaryFacesChecked=faces_checked)
            body=SimpleNamespace(dims=evidence,nodes=np.zeros((4,3)),elems=np.arange(8)[None,:])
            dome=SimpleNamespace(dims=dict(fullDome=True),nodes=np.array([[0.,0.,5.]]))
            with self.subTest(nodes=nodes_checked,faces=faces_checked), \
                    patch.object(whole,'equatorial_interface',return_value=dict(centerMm=[0.,0.,5.])), \
                    patch.object(whole,'body_equatorial_interface',return_value=dict(faces=np.empty((0,4),dtype=int))), \
                    patch.object(whole,'audit_h8',return_value=({},np.array([[0,1,2,3]]))), \
                    patch.object(whole,'join_interfaces') as join:
                with self.assertRaisesRegex(ValueError,'entire physical boundary'):
                    whole.assemble_whole(None,dome,body)
                join.assert_not_called()

    def test_combined_budget_rejects_before_live_body_allocation(self):
        dome=SimpleNamespace(elems=np.zeros((1,8),dtype=int))
        with patch.object(whole,'build_cad_dome',return_value=(dome,None,{})), \
                patch.object(whole,'equatorial_interface',return_value={}), \
                patch.object(whole,'body_preflight',return_value=(None,None,None,dict(elements=400000))), \
                patch.object(whole,'build_cad_body') as build, patch.object(whole,'assemble_whole') as assemble:
            with self.assertRaisesRegex(ValueError,'preflight allocation exceeds budget'):
                whole.build_whole(None)
            build.assert_not_called();assemble.assert_not_called()


_SAVED_CACHE = all(os.environ.get(key) for key in
                  ('HEXREFINE_CAP_STEP','HEXREFINE_CAP_BODY_DELIVERY','HEXREFINE_CAP_BODY_MESH'))
_SAVED_REASON = 'Explicit source STEP plus accepted body delivery/NPZ required; no full body rebuild'


@unittest.skipUnless(_SAVED_CACHE, _SAVED_REASON)
class SavedWholeCacheBindingTests(unittest.TestCase):
    def test_genuine_files_reject_a_different_source_or_mesh_before_arrays_are_opened(self):
        directory=Path(os.environ['HEXREFINE_CAP_BODY_DELIVERY'])
        mesh=Path(os.environ['HEXREFINE_CAP_BODY_MESH']);step=Path(os.environ['HEXREFINE_CAP_STEP'])
        # Existing unrelated bytes provide REAL hash mismatches without editing
        # or copying any accepted source/cache artifact, and without fake hashes.
        for wrong_mesh,wrong_source in ((directory/'dome-interface.npz',step),(mesh,mesh)):
            with self.subTest(mesh=str(wrong_mesh),source=str(wrong_source)), \
                    patch.object(whole.np,'load') as load, patch.object(whole,'audit_h8') as audit:
                with self.assertRaisesRegex(ValueError,'bind source/mesh/interface/independent K'):
                    whole.load_body_delivery(directory,wrong_mesh,wrong_source)
                load.assert_not_called();audit.assert_not_called()


@unittest.skipUnless(_SAVED_CACHE and importlib.util.find_spec('build123d'), _SAVED_REASON)
class SavedWholeCapCadTests(unittest.TestCase):
    def test_entire_genuine_source_from_accepted_body_cache_without_repeating_body_witnesses(self):
        from build123d import import_step
        directory=Path(os.environ['HEXREFINE_CAP_BODY_DELIVERY'])
        mesh_file=Path(os.environ['HEXREFINE_CAP_BODY_MESH']);step=Path(os.environ['HEXREFINE_CAP_STEP'])
        watched=(step,mesh_file,directory/'report.json',directory/'model.k',directory/'dome-interface.npz')
        hashes={p:whole._sha(p) for p in watched}
        shape=import_step(step)
        # Fail loudly if a future cache path accidentally triggers 146k-node /
        # 146k-face body CAD checks. Real global CAD witnesses remain unmocked.
        with patch.object(whole,'build_cad_body',side_effect=AssertionError('Unexpected full body rebuild')) as build, \
                patch.object(whole,'body_preflight',side_effect=AssertionError('Unexpected live body preflight')) as preflight, \
                patch('tools.bolthex.cad_cap_body._source_distances',side_effect=AssertionError('Unexpected body witness rerun')) as distances:
            body=whole.load_body_delivery(directory,mesh_file,step)
            dome,_,_=whole.build_cad_dome(shape)
            port=whole.body_equatorial_interface(body);eq=whole.equatorial_interface(dome)
            np.testing.assert_array_equal(port['coordinates'],eq['coordinates'])
            original_port=port['coordinates'].copy()
            joined,local,report=whole.assemble_whole(shape,dome,body)
            build.assert_not_called();preflight.assert_not_called();distances.assert_not_called()
        self.assertIs(local,shape)
        self.assertEqual(report['quality']['elements'],333824)
        self.assertEqual(report['quality']['nodes'],len(dome.nodes)+len(body.nodes)-1024)
        self.assertEqual(report['quality']['boundaryEuler'],2)
        self.assertGreaterEqual(report['quality']['minimumCornerScaledJacobian'],.15)
        self.assertGreater(report['quality']['minimumGaussJacobian'],0.)
        self.assertEqual(report['quality']['nonmanifoldFaces'],0)
        self.assertEqual(report['quality']['nonmanifoldBoundaryEdges'],0)
        self.assertLessEqual(report['relativeCadH8VolumeError'],1e-4)
        self.assertLessEqual(report['relativeComponentCadPartitionError'],1e-7)
        self.assertLessEqual(report['relativeAssemblyVolumeError'],1e-10)
        self.assertEqual(report['interface']['sharedNodes'],1024)
        self.assertEqual(report['interface']['sharedFaces'],512)
        self.assertTrue(report['interface']['oneOwnerEachComponent'])
        self.assertTrue(report['interface']['twoOwnersEveryFace'])
        np.testing.assert_array_equal(joined.nodes[eq['nodeRings']],original_port)
        np.testing.assert_array_equal(body.nodes[port['nodeRings']],original_port)
        self.assertEqual(report['independentGlobalBoundaryNodeProbes'],513)
        self.assertLessEqual(report['maximumGlobalBoundaryNodeDistance'],2e-6)
        self.assertEqual(report['materialCentroidProbes'],513)
        self.assertTrue(report['allSampledCentroidsInSourceMaterial'])
        self.assertTrue(report['fullCapNut']);self.assertTrue(report['fullCadMeshAccepted'])
        self.assertTrue(report['reusedValidatedBody']);self.assertTrue(report['componentDomainsDisjoint'])
        self.assertEqual(report['artificialInterfaces'],[])
        self.assertFalse(report['fullWorkflowAcceptance']);self.assertFalse(report['solverVerified'])
        self.assertFalse(report['nativeHmVerified']);self.assertFalse(report['standardsEditionVerified'])
        self.assertTrue(report['developmentOnly'])
        for p in watched:self.assertEqual(whole._sha(p),hashes[p],f'Accepted input modified: {p}')


if __name__=='__main__':
    unittest.main()
