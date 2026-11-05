import copy,json,math,os,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from tools.bolthex.native_cad_audit import acceptance
from tools.bolthex import native_cad_audit as audit
from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy


class IndependentNativeCadTests(unittest.TestCase):
    good=dict(maximumSurfaceDistance=1e-8,maximumSourceFaceDistance=1e-8,maximumControlDistanceError=1e-6,maximumReverseDistance=1e-8,maximumReverseEdgeDistance=1e-8,
              maximumCadBoundsDifference=1e-7,relativeNativeVolumeError=5e-8)

    def test_all_original_limits_are_required_together(self):
        self.assertTrue(acceptance(self.good))
        for key,value in [('maximumSurfaceDistance',2.01e-6),('maximumSourceFaceDistance',2.01e-6),('maximumControlDistanceError',2.01e-6),
                          ('maximumReverseDistance',2.01e-6),('maximumReverseEdgeDistance',2.01e-6),('maximumCadBoundsDifference',1.01e-5),('relativeNativeVolumeError',1.01e-7)]:
            with self.subTest(key=key):self.assertFalse(acceptance(dict(self.good,**{key:value})))

    def test_missing_nonfinite_and_negative_metrics_are_not_waived(self):
        for value in (math.nan,math.inf,-1,True,None):
            with self.subTest(value=value),self.assertRaises(ValueError):acceptance(dict(self.good,maximumSurfaceDistance=value))
        with self.assertRaises(ValueError):acceptance({})


class NativeCadSurfacePolicyTests(unittest.TestCase):
    good=dict(IndependentNativeCadTests.good,maximumSourceReferenceError=0.)

    def test_policy_subclass_cannot_relax_surface_or_source_evidence_limits(self):
        class Unbounded(CadAccuracyPolicy):
            def carrier_limits(self,**kwargs):return {key:1. for key in super().carrier_limits(**kwargs)}
            def manifest(self,**kwargs):return {'forged':True}
        policy=Unbounded.engineering(.1)
        for key in ('maximumReverseEdgeDistance','maximumSourceReferenceError'):
            with self.subTest(key=key):
                self.assertFalse(audit.surface_acceptance(dict(self.good,**{key:.01}),policy))
        normalized=audit._policy(policy)
        self.assertIs(type(normalized),CadAccuracyPolicy)
        self.assertEqual(normalized.manifest(),CadAccuracyPolicy.engineering(.1).manifest())

    def test_policy_fields_are_revalidated_before_native_surface_measurements(self):
        class Unchecked(CadAccuracyPolicy):
            def __post_init__(self):pass
        for policy in (Unchecked.engineering(True),Unchecked.engineering(float('nan')),
                       Unchecked.engineering(.1,units='in')):
            with self.subTest(policy=policy):
                with self.assertRaises(ValueError):audit.surface_acceptance(self.good,policy)
                with patch.object(audit,'Path',side_effect=AssertionError('path before policy')):
                    with self.assertRaises(ValueError):audit.audit_exchange('missing','missing','missing','missing',accuracy_policy=policy)

    def test_selected_surface_policy_does_not_change_legacy_acceptance(self):
        changed=dict(self.good,maximumReverseEdgeDistance=2e-5,maximumCadBoundsDifference=2e-5)
        self.assertFalse(acceptance(changed))
        self.assertFalse(audit.surface_acceptance(changed))
        self.assertTrue(audit.surface_acceptance(changed,CadAccuracyPolicy.engineering(.1)))
        self.assertFalse(audit.surface_acceptance(changed,CadAccuracyPolicy.engineering(.1,minimum_root_radius_mm=.001)))

    def test_every_surface_metric_is_required_and_source_recheck_stays_strict(self):
        policy=CadAccuracyPolicy.engineering(.1)
        for key in audit.SURFACE_METRICS:
            limits=policy.carrier_limits()
            with self.subTest(metric=key):
                self.assertFalse(audit.surface_acceptance(dict(self.good,**{key:limits[key]*1.01}),policy))
            for value in (None,True,-1.,math.inf,math.nan,'0'):
                with self.subTest(metric=key,value=value),self.assertRaises(ValueError):
                    audit.surface_acceptance(dict(self.good,**{key:value}),policy)
            missing=dict(self.good);del missing[key]
            with self.assertRaises(ValueError):audit.surface_acceptance(missing,policy)
        self.assertEqual(policy.carrier_limits()['maximumSourceReferenceError'],2e-6)

    def test_host_volume_is_not_an_independent_geometry_volume_gate(self):
        changed=dict(self.good,relativeNativeVolumeError=.01)
        self.assertFalse(acceptance(changed))
        self.assertTrue(audit.surface_acceptance(changed,CadAccuracyPolicy.engineering(.1)))

    def test_invalid_policy_and_invalid_cli_budgets_reject_before_measurement(self):
        with patch.object(audit,'TrimmedFaceDistances',side_effect=AssertionError('bad policy reached measurement')) as measure:
            with self.assertRaises(ValueError):audit.audit_exchange('missing','missing','missing','missing',accuracy_policy='engineering')
            measure.assert_not_called()
        for options in (['--accuracy-profile','engineering'],
                        ['--accuracy-profile','engineering','--target-size-mm','nan'],
                        ['--accuracy-profile','strict','--target-size-mm','.1']):
            with self.subTest(options=options),patch.object(audit,'audit_exchange') as exchange:
                with self.assertRaises(ValueError):audit.main(['manifest','step','reference','output']+options)
                exchange.assert_not_called()


class TinyRealIgesSurfacePolicyTests(unittest.TestCase):
    """Real OCC carriers and subprocesses, never a genuine native-HM fixture."""
    def setUp(self):
        from build123d import Box,export_step
        from tools.tests.test_native_cad_integration import cube_reference,sha,write_json
        self.sha=sha;self.write_json=write_json
        self.temporary=tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT'))
        self.addCleanup(self.temporary.cleanup);self.root=Path(self.temporary.name)
        self.shape=Box(2,2,2);self.step=self.root/'source.step';export_step(self.shape,self.step)
        self.reference=self.root/'reference.json';write_json(self.reference,cube_reference(self.step))
        self.hm=self.root/'fixture.hm';self.hm.write_bytes(b'provenance fixture only; not real HM')
        self.iges=self.root/'faces.iges';self.manifest=self.root/'manifest.json';self.output=self.root/'audit.json'
        self.write_iges(self.shape.translate((2e-5,0,0)))
        self.bind()

    def write_iges(self,*shapes):
        from OCP.IGESControl import IGESControl_Writer
        writer=IGESControl_Writer('MM',0)
        for shape in shapes:self.assertTrue(writer.AddShape(shape.wrapped))
        writer.ComputeModel();self.assertTrue(writer.Write(str(self.iges)))

    def bind(self,host_volume=8.):
        self.write_json(self.manifest,dict(nativeHmPath=str(self.hm),nativeHmSHA256=self.sha(self.hm),
            sourceStepSHA256=self.sha(self.step),igesPath=str(self.iges),igesSHA256=self.sha(self.iges),
            solids=1,optimizationDisabled=True,nativeVolumeBefore=host_volume,nativeVolumeAfter=host_volume))

    def run_cli(self,*options):
        command=[sys.executable,'-B','-m','tools.bolthex.native_cad_audit',
                 str(self.manifest),str(self.step),str(self.reference),str(self.output),*options]
        return subprocess.run(command,cwd=Path(__file__).resolve().parents[2],capture_output=True,text=True,timeout=90,
            env={**os.environ,'TEMP':str(self.root),'TMP':str(self.root),'PYTHONDONTWRITEBYTECODE':'1',
                 'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'})

    def test_engineering_cli_reports_finite_geometry_not_solid_acceptance(self):
        paths=(self.step,self.iges,self.hm,self.reference,self.manifest);before={p:self.sha(p) for p in paths}
        process=self.run_cli('--accuracy-profile','engineering','--target-size-mm','.1',
            '--critical-target-size-mm','.08','--minimum-functional-gap-mm','.002','--minimum-root-radius-mm','.02')
        self.assertEqual(process.returncode,0,process.stdout+process.stderr)
        result=json.loads(self.output.read_text())
        self.assertFalse(result['sampledNativeCadVerified'])
        self.assertTrue(result['engineeringCadGeometryVerified']);self.assertTrue(result['selectedGeometryPolicyVerified'])
        self.assertEqual(result['geometryAccuracyPolicy'],CadAccuracyPolicy.engineering(.1,
            critical_target_size_mm=.08,minimum_functional_gap_mm=.002,minimum_root_radius_mm=.02).manifest())
        self.assertEqual((result['sourceFaces'],len(result['sourceFaceWitnesses'])),(6,6))
        self.assertEqual({r['face'] for r in result['sourceFaceWitnesses']},set(range(6)))
        self.assertGreater(result['maximumCadBoundsDifference'],1e-5)
        self.assertLess(result['maximumCadBoundsDifference'],.0005)
        for key in ('fullModelAcceptance','exactNativeCadCertified','igesSolidReconstructionVerified',
                    'independentNativeBrepVolumeVerified','nativeApproxVolumeUsedForGeometryAcceptance'):
            self.assertIs(result[key],False,key)
        self.assertNotIn('relativeStepBrepVolumeError',result)
        self.assertIn('relativeStepBrepVolumeError',result['geometryPolicyUnmeasuredMetrics'])
        self.assertEqual(before,{p:self.sha(p) for p in paths})

    def test_default_cli_retains_strict_failure_for_same_carrier(self):
        process=self.run_cli()
        self.assertEqual(process.returncode,2,process.stdout+process.stderr)
        result=json.loads(self.output.read_text())
        self.assertFalse(result['sampledNativeCadVerified']);self.assertFalse(result['selectedGeometryPolicyVerified'])
        self.assertIsNone(result['engineeringCadGeometryVerified'])
        self.assertEqual(result['geometryAccuracyPolicy'],CadAccuracyPolicy().manifest())

    def test_engineering_feature_bound_rejects_same_carrier(self):
        process=self.run_cli('--accuracy-profile','engineering','--target-size-mm','.1','--minimum-root-radius-mm','.001')
        self.assertEqual(process.returncode,2,process.stdout+process.stderr)
        self.assertFalse(json.loads(self.output.read_text())['selectedGeometryPolicyVerified'])

    def test_host_volume_remains_explicit_host_diagnostic_only(self):
        self.write_iges(self.shape);self.bind(host_volume=8.08)
        result=audit.audit_exchange(self.manifest,self.step,self.reference,self.output,accuracy_policy=CadAccuracyPolicy.engineering(.1))
        self.assertFalse(result['sampledNativeCadVerified']);self.assertTrue(result['engineeringCadGeometryVerified'])
        self.assertGreater(result['relativeNativeVolumeError'],.009)
        self.assertIn('host',result['nativeVolumeMethod'])
        self.assertFalse(result['independentNativeBrepVolumeVerified'])

    def test_actual_iges_audit_uses_base_policy_limits_and_manifest(self):
        class Untrusted(CadAccuracyPolicy):
            def carrier_limits(self,**kwargs):raise AssertionError('subclass limits executed')
            def manifest(self,**kwargs):raise AssertionError('subclass manifest executed')
        result=audit.audit_exchange(self.manifest,self.step,self.reference,self.output,
            accuracy_policy=Untrusted.engineering(.001))
        self.assertEqual(result['geometryAccuracyPolicy'],CadAccuracyPolicy.engineering(.001).manifest())
        self.assertFalse(result['selectedGeometryPolicyVerified'])
        self.assertFalse(result['engineeringCadGeometryVerified'])
        self.assertFalse(result['fullModelAcceptance']);self.assertFalse(result['exactNativeCadCertified'])

    def test_engineering_cannot_relax_source_reference_recheck(self):
        reference=json.loads(self.reference.read_text());reference['points'][1]['sourceDistance']+=.0001
        self.write_json(self.reference,reference)
        with self.assertRaisesRegex(ValueError,'Source witness failed'):
            audit.audit_exchange(self.manifest,self.step,self.reference,self.output,accuracy_policy=CadAccuracyPolicy.engineering(.1))
        self.assertFalse(self.output.exists())

    def test_engineering_sparse_reference_does_not_skip_missing_source_face(self):
        faces=[face for face in self.shape.faces() if face.center().X<.9];self.write_iges(*faces);self.bind()
        points=[dict(point=[0.,0.,1.],role='surface',sourceDistance=0.),dict(point=[0.,0.,2.],role='control',sourceDistance=1.)]
        points.extend(dict(point=[x,y,1.00002],role='control',sourceDistance=.00002)
                      for x,y in ((-.5,-.5),(-.5,0),(-.5,.5),(.5,-.5),(.5,0),(.5,.5)))
        reference=dict(sourceStepSHA256=self.sha(self.step),points=points);self.write_json(self.reference,reference)
        result=audit.audit_exchange(self.manifest,self.step,self.reference,self.output,accuracy_policy=CadAccuracyPolicy.engineering(.1))
        self.assertEqual((result['sourceFaces'],len(result['sourceFaceWitnesses'])),(6,6))
        self.assertEqual(result['nativeFaces'],5)
        self.assertFalse(result['selectedGeometryPolicyVerified'])
        self.assertGreater(result['maximumSourceFaceDistance'],.0005)

    def test_reported_source_recheck_maximum_is_bound_to_raw_rows(self):
        result=audit.audit_exchange(self.manifest,self.step,self.reference,self.output,accuracy_policy=CadAccuracyPolicy.engineering(.1))
        changed=copy.deepcopy(result);changed['maximumSourceReferenceError']+=1e-5
        with self.assertRaisesRegex(ValueError,'maximum contradicts'):
            audit.validate_samples(changed,json.loads(self.reference.read_text()))
