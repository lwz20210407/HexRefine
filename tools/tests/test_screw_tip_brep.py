"""Scoped source-derived BRep controls; never whole-Screw acceptance tests."""
from collections import Counter
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tools.bolthex import screw_tip_brep as brep


class BooleanConfigurationTests(unittest.TestCase):
    def test_empty_constructor_configured_before_build(self):
        events=[]
        class ShapeList(list):
            def Append(self,value): self.append(value)
        class Operation:
            def __init__(self,*args):
                if args: raise AssertionError('Two-shape constructor can implicitly build')
                events.append(('constructor',args))
            def SetArguments(self,value): events.append(('arguments',value))
            def SetTools(self,value): events.append(('tools',value))
            def SetNonDestructive(self,value): events.append(('nonDestructive',value))
            def SetFuzzyValue(self,value): events.append(('fuzzy',value))
            def SetRunParallel(self,value): events.append(('parallel',value))
            def Build(self): events.append(('build',None))
            def IsDone(self): return True
            def Shape(self): return 'result'
        with patch.object(brep,'_kernel',return_value=SimpleNamespace(TopTools_ListOfShape=ShapeList)):
            self.assertEqual(brep._boolean(Operation,'source','hull'),'result')
        self.assertEqual([e[0] for e in events],['constructor','arguments','tools','nonDestructive','fuzzy','parallel','build'])
        self.assertEqual(events[3:6],[('nonDestructive',True),('fuzzy',0.),('parallel',False)])

    def test_fixed_constructor_and_classifier_tolerances(self):
        self.assertEqual(brep.CONSTRUCTION_TOLERANCE_MM,1e-7)
        self.assertEqual(brep.CLASSIFICATION_TOLERANCE_MM,1e-9)


ENV=('SCREW_TIP_RAW_K','SCREW_TIP_PHASE_K','SCREW_TIP_POLICY_REPORT',
     'SCREW_TIP_RAW_TARGET','SCREW_TIP_PHASE_TARGET','SCREW_TIP_BREP_TEST_ROOT')
READY=all(os.environ.get(k) for k in ENV) and importlib.util.find_spec('OCP') is not None


@unittest.skipUnless(READY,'Explicit actual sources/targets, scratch root and existing CAD runtime required')
class ActualTipBrepTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw,cls.phase,cls.policy,cls.raw_target,cls.phase_target,cls.root=[Path(os.environ[k]) for k in ENV]
        cls.directory=tempfile.TemporaryDirectory(prefix='brep-tests-',dir=cls.root)
        cls.addClassCleanup(cls.directory.cleanup);cls.work=Path(cls.directory.name)
        cls.inputs=(cls.raw,cls.phase,cls.policy,cls.raw_target,cls.phase_target)
        cls.hashes={str(p):brep._sha(p) for p in cls.inputs}
        cls.outputs=[cls.work/'raw',cls.work/'phase']
        cls.reports=[brep.materialize(source,cls.policy,target,output)
                     for source,target,output in zip((cls.raw,cls.phase),(cls.raw_target,cls.phase_target),cls.outputs)]

    @classmethod
    def tearDownClass(cls):
        if any(brep._sha(p)!=digest for p,digest in cls.hashes.items()):
            raise AssertionError('Actual source/target inputs changed')

    def setUp(self):
        self.directory_case=tempfile.TemporaryDirectory(dir=self.work)
        self.addCleanup(self.directory_case.cleanup);self.case=Path(self.directory_case.name)
        self.inbox=self.case/'inputs';self.inbox.mkdir()
        self.output=self.case/'result'
        self.target=json.loads(self.raw_target.read_text())

    def test_actual_raw_phase_closed_solids_cold_readbacks(self):
        for report,output in zip(self.reports,self.outputs):
            self.assertTrue(report['localBrepChecksPassed'])
            self.assertEqual(report['targetSHA256'],report['inputSHA256'][str(self.raw_target if output.name=='raw' else self.phase_target)])
            self.assertEqual(report['policyReportSHA256'],brep._sha(self.policy))
            self.assertEqual(report['stages']['sourceReadback']['after']['topology']['faces'],5)
            self.assertEqual(report['stages']['hullReadback']['after']['topology']['faces'],12)
            self.assertEqual(report['stages']['unionReadback']['after']['topology']['faces'],14)
            for key in ('sourceReadback','hullReadback','unionReadback'):
                row=report['stages'][key]
                self.assertEqual(row['after']['topology']['solids'],1)
                self.assertEqual(row['after']['topology']['shells'],1)
                self.assertGreater(row['after']['volume'],0)
                self.assertEqual(row['before']['topologySHA256'],row['after']['topologySHA256'])
                self.assertLessEqual(row['relativeVolumeChange'],1e-7)
                self.assertEqual(brep._sha(output/row['path']),row['sha256'])
                artifact=next(a for a in report['artifacts'] if a['path']==row['path'])
                self.assertEqual(artifact['sha256'],row['before']['stateSHA256'])
                self.assertEqual(artifact['bytes'],row['bytes'])
        self.assertAlmostEqual(self.reports[0]['measuredAddedVolume'],self.reports[1]['measuredAddedVolume'],delta=1e-18)
        self.assertAlmostEqual(self.reports[0]['measuredAddedVolume'],2.110142047206942e-9,delta=1e-14)

    def test_boolean_input_geometry_topology_tolerances_are_unchanged(self):
        for r in self.reports:
            state=r['booleanInputSignatures'];self.assertTrue(state['unchanged'])
            for pair in ('source','hull'):
                for key in ('geometrySHA256','topologySHA256','tolerancesSHA256','stateSHA256'):
                    self.assertEqual(state[pair+'Before'][key],state[pair+'After'][key])
            self.assertEqual(r['booleanFuzzyToleranceMM'],0)
            self.assertTrue(r['booleanNonDestructive'])
            self.assertFalse(r['booleanRunParallel'])

    def test_protected_output_f1_f3_f4_entire_face_signatures(self):
        for r in self.reports:
            protected=r['protectedOutputFaces']
            self.assertTrue(protected['completeSupportTrimTopologySignaturesMatched'])
            for stage in ('live','coldReadback'):
                self.assertEqual({row['originalSourceFace'] for row in protected[stage]},{1,3,4})
                for row in protected[stage]:
                    self.assertEqual(row['sourceSignature'],row['unionSignature'])
                    self.assertTrue(row['completeFaceSignatureMatched'])

    def test_dense_local_source_patch_catches_covered_face(self):
        for r,output in zip(self.reports,self.outputs):
            s=r['boundarySamples'];rows=json.loads((output/'boundary-witnesses.json').read_text())
            self.assertEqual(s['localSourceSamples'],544)
            self.assertEqual(len(rows['sourceLocalPatches']),544)
            self.assertEqual(s['localGroups']['local-t=0']['count'],272)
            self.assertEqual(s['localGroups']['local-w=0']['count'],272)
            self.assertGreater(s['localGroups']['local-w=0']['maximum'],.0001)
            self.assertAlmostEqual(s['forwardMaximum'],.00014640952214412813,delta=1e-10)
            self.assertTrue(s['boundaryCompoundNotSolidUsed'])
            self.assertLessEqual(s['maximumOwnSourceResidual'],1e-7)

    def test_reverse_face_and_edge_vertex_maxima_both_retained(self):
        for r in self.reports:
            s=r['boundarySamples']
            self.assertEqual(len(s['reverseFaceCoverage']),14)
            self.assertTrue(all(row['samples']>0 for row in s['reverseFaceCoverage']))
            self.assertGreater(s['reverseEdgeVertexSamples'],400)
            self.assertGreater(s['reverseEdgeVertexMaximum'],s['reverseFaceMaximum'])
            self.assertEqual(s['reverseMaximum'],max(s['reverseFaceMaximum'],s['reverseEdgeVertexMaximum']))
            self.assertAlmostEqual(s['reverseMaximum'],.00015462307965215886,delta=1e-10)
            self.assertLess(s['reverseMaximum'],r['sampleDistanceLimitMM'])

    def test_actual_witness21_at_strict_classification_tolerance(self):
        for r in self.reports:
            witness=r['orthogonalWitnessSamples']
            self.assertEqual(witness['count'],21)
            self.assertEqual(witness['classificationToleranceMM'],1e-9)
            self.assertEqual(Counter(row['classification'] for row in witness['rows']),{'IN':5,'ON':16})
            centre=next(row for row in witness['rows'] if row['label']=='centre')
            self.assertEqual(centre['classification'],'IN')
            self.assertGreater(centre['boundaryDistance'],witness['maximumStoredToleranceMM'])
            self.assertAlmostEqual(centre['boundaryDistance'],2.5e-5,delta=1e-12)
            self.assertEqual(witness['clearlyInsideBeyondStoredTolerance'],3)
            self.assertEqual(witness['insideWithinStoredTolerance'],2)
            self.assertFalse(witness['wholeBoxContainmentCertified'])

    def test_scope_flags_and_real_metadata_growth_are_not_hidden(self):
        for r in self.reports:
            for name in ('wholeScrewAccepted','independentDesignCAD','meshAccepted','coreMeshed','engineeringGeometryAccepted',
                         'globalHausdorffCertified','boundaryDistanceCertified'):
                self.assertFalse(r[name],name)
            self.assertTrue(r['kernelGeneratedToleranceGrowth'])
            self.assertGreater(r['maximumActualUnionToleranceMM'],r['constructionToleranceMM'])
            self.assertLess(r['maximumActualUnionToleranceMM'],r['sampleDistanceLimitMM'])
            self.assertTrue(r['sourceMinusUnionEmptyByKernel'])

    def test_existing_output_preserved(self):
        self.output.mkdir();sentinel=self.output/'keep.txt';sentinel.write_text('preserve')
        with self.assertRaisesRegex(ValueError,'new output directory'):
            brep.materialize(self.raw,self.policy,self.raw_target,self.output)
        self.assertEqual(sentinel.read_text(),'preserve')

    def test_immutable_input_bundle_output_paths_rejected(self):
        for parent in (self.raw.parent,self.policy.parent,self.raw_target.parent):
            output=parent/f'{self.case.name}-forbidden-brep'
            self.assertFalse(output.exists())
            with self.assertRaisesRegex(ValueError,'outside every immutable'):
                brep.materialize(self.raw,self.policy,self.raw_target,output)
            self.assertFalse(output.exists())

    def test_full_target_tampering_rejected_before_kernel(self):
        changes=[lambda d:d['exactHull']['pointsFloat'][0].__setitem__(0,.01),
                 lambda d:d['exactHull']['pointsExact'][0].__setitem__(0,'1/100'),
                 lambda d:d['exactHull']['outwardTriangles'][0].reverse(),
                 lambda d:d['exactHull']['faces'][0]['outwardPolygon'].reverse(),
                 lambda d:d['floatHull']['pointsFloat'][0].__setitem__(0,.01),
                 lambda d:d['budget']['geometryTargetIncludingFloatMM'].__setitem__('value',.0005),
                 lambda d:d.__setitem__('boundaryDistanceCertified',True),
                 lambda d:d.__setitem__('policyReportSHA256','0'*64)]
        for i,change in enumerate(changes):
            target=json.loads(self.raw_target.read_text());change(target)
            file=self.inbox/f'bad-{i}.json';file.write_text(json.dumps(target))
            with self.subTest(i=i),patch.object(brep,'_kernel',side_effect=AssertionError('CAD must not start')):
                with self.assertRaisesRegex(ValueError,'deterministic source/policy'):
                    brep.materialize(self.raw,self.policy,file,self.output)
            self.assertFalse(self.output.exists())

    def test_same_geometry_wrong_source_binding_rejected(self):
        with patch.object(brep,'_kernel',side_effect=AssertionError('CAD must not start')):
            with self.assertRaisesRegex(ValueError,'deterministic source/policy'):
                brep.materialize(self.phase,self.policy,self.raw_target,self.output)
        self.assertFalse(self.output.exists())

    def test_duplicate_json_field_rejected(self):
        file=self.inbox/'duplicate.json';file.write_text('{"x":1,"x":2}')
        with self.assertRaisesRegex(ValueError,'Duplicate JSON key'):
            brep.materialize(self.raw,self.policy,file,self.output)
        self.assertFalse(self.output.exists())

    def test_all_input_size_bounds_precede_hashing(self):
        original=Path.stat
        for chosen,limit in ((self.raw,brep.target_api.MAX_BYTES),(self.policy,brep.MAX_FILE_BYTES),(self.raw_target,brep.MAX_FILE_BYTES)):
            def oversized(path,*args,**kwargs):
                value=original(path,*args,**kwargs)
                if path==chosen:
                    fields=list(value);fields[6]=limit+1;return os.stat_result(fields)
                return value
            with self.subTest(path=chosen),patch.object(Path,'stat',autospec=True,side_effect=oversized), \
                    patch.object(brep,'_sha',side_effect=AssertionError('Oversized input must not be hashed')):
                with self.assertRaisesRegex(ValueError,'oversized input before hashing'):
                    brep.materialize(self.raw,self.policy,self.raw_target,self.output)
            self.assertFalse(self.output.exists())

    def test_fsync_artifact_mutation_blocks_success_publication(self):
        original=brep.os.fsync;changed=[]
        def mutate(fd):
            original(fd)
            if (self.output/'report.pending.json').exists():
                artifact=self.output/'union-diagnostic.brep'
                artifact.write_bytes(artifact.read_bytes()+b'\n')
                changed.append(artifact)
        with patch.object(brep.os,'fsync',side_effect=mutate):
            with self.assertRaisesRegex(ValueError,'Produced artifact changed before publication'):
                brep.materialize(self.raw,self.policy,self.raw_target,self.output)
        self.assertEqual(len(changed),1)
        self.assertFalse((self.output/'report.json').exists())
        self.assertFalse(json.loads((self.output/'rejection.json').read_text())['localBrepChecksPassed'])

    def test_after_cold_read_mutation_cannot_be_blessed_by_late_hash(self):
        original=brep._witness_audit;changed=[]
        def mutate(*args):
            result=original(*args)
            artifact=self.output/'union-diagnostic.brep'
            artifact.write_bytes(artifact.read_bytes()+b'\n')
            changed.append(artifact)
            return result
        with patch.object(brep,'_witness_audit',side_effect=mutate):
            with self.assertRaisesRegex(ValueError,'Produced artifact changed before publication'):
                brep.materialize(self.raw,self.policy,self.raw_target,self.output)
        self.assertEqual(len(changed),1)
        self.assertFalse((self.output/'report.json').exists())
        rejected=json.loads((self.output/'rejection.json').read_text())
        artifact=next(a for a in rejected['artifacts'] if a['path']=='union-diagnostic.brep')
        self.assertEqual(artifact['sha256'],rejected['stages']['unionReadback']['sha256'])
        self.assertNotEqual(artifact['sha256'],brep._sha(changed[0]))

    def test_boolean_in_memory_input_mutation_cannot_pass(self):
        k=brep._kernel();original=brep._boolean
        def mutate(operation,left,right):
            result=original(operation,left,right)
            if operation is k.BRepAlgoAPI_Fuse:
                vertex=brep._entities(left,k.TopAbs_VERTEX)[0]
                k.BRep_Builder().UpdateVertex(k.TopoDS.Vertex_s(vertex),1e-6)
            return result
        with patch.object(brep,'_boolean',side_effect=mutate):
            with self.assertRaisesRegex(ValueError,'modified in-memory'):
                brep.materialize(self.raw,self.policy,self.raw_target,self.output)
        self.assertFalse((self.output/'report.json').exists())
        self.assertFalse(json.loads((self.output/'rejection.json').read_text())['localBrepChecksPassed'])

    def test_protected_geometry_signature_corruption_rejected(self):
        k=brep._kernel();source=k.TopoDS_Shape();union=k.TopoDS_Shape()
        self.assertTrue(k.BRepTools.Read_s(source,str(self.outputs[0]/'source-e5048.brep'),k.BRep_Builder()))
        self.assertTrue(k.BRepTools.Read_s(union,str(self.outputs[0]/'union-diagnostic.brep'),k.BRep_Builder()))
        mesh=brep.target_api.read_keyword(self.raw);points=mesh.nodes[mesh.elements[5047]]
        actual=brep._protected_faces(source,union,points)
        original=brep._face_signature;calls=[0]
        def corrupt(face):
            value=original(face);calls[0]+=1
            if calls[0]==2:value=dict(value,supportTrimWorldSHA256='0'*64)
            return value
        with patch.object(brep,'_face_signature',side_effect=corrupt):
            with self.assertRaisesRegex(ValueError,'Protected union face'):
                brep._protected_faces(source,union,points,actual)


if __name__=='__main__':unittest.main(verbosity=2)
