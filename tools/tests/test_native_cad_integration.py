"""Host-free adapter guards and tiny real OCC exchange, not HM/mesh acceptance."""
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from tools.hypermesh_native import export_hm


NATIVE_LIMITS=dict(maximumSurfaceDistance=2e-6,maximumControlDistanceError=2e-6,
                   maximumReverseDistance=2e-6,maximumReverseEdgeDistance=2e-6,
                   maximumSourceFaceDistance=2e-6,
                   maximumCadBoundsDifference=1e-5,relativeNativeVolumeError=1e-7)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path,value):
    path.write_text(json.dumps(value),encoding='utf8')


def cube_reference(step):
    # A centered 2 mm cube: six face centres, six local offsets and a trim control.
    points=[]
    for axis in range(3):
        for sign in (-1,1):
            p=[0.,0.,0.];p[axis]=sign
            points.append(dict(point=p,role='surface',sourceDistance=0.))
            p=p.copy();p[axis]=sign*1.00002
            points.append(dict(point=p,role='control',sourceDistance=.00002))
    points.append(dict(point=[2.,0.,0.],role='control',sourceDistance=1.))
    return dict(sourceStepSHA256=sha(step),points=points)


class NativeCadAdapterTests(unittest.TestCase):
    """Only process boundaries are simulated; input validation/reporting is real."""
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT'))
        self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name)
        self.exe=self.root/'host'/'2022'/'hm'/'bin'/'hmbatch.exe'
        self.exe.parent.mkdir(parents=True);self.exe.write_bytes(b'never executed')
        self.mesh=self.root/'cube.k'
        self.mesh.write_text('*KEYWORD\n*NODE\n'+''.join(
            f'{i},{x},{y},{z}\n' for i,(x,y,z) in enumerate(
                [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),
                 (-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)],1))+
            '*ELEMENT_SOLID\n1,1,1,2,3,4,5,6,7,8\n*END\n')
        self.report=self.root/'source.json'
        report=dict(kSHA256=sha(self.mesh),nodes=8,elements=1,volume=8.)
        write_json(self.report,report)
        write_json(self.root/'independent-k-audit.json',dict(report,reader='ansys-dyna-core',
            minimumCornerScaledJacobian=1.,nonmanifoldFaces=0,nonmanifoldBoundaryEdges=0,
            boundaryFaces=6,boundaryEuler=2))
        self.step=self.root/'cube.step';self.step.write_bytes(b'adapter-only STEP placeholder')
        self.certificate=self.root/'cad.json'
        write_json(self.certificate,dict(stepSHA256=sha(self.step),solids=1,meshVolume=8.,
            relativeMeshVolumeError=0.,geometryIndependentOfMesh=True,matchedMeshVerified=True,
            matchedKSHA256=sha(self.mesh),bbox=dict(min=[-1.]*3,max=[1.]*3)))
        self.reference=self.root/'reference.json';write_json(self.reference,cube_reference(self.step))
        self.output=self.root/'result'
        self.facet_bounds=[-1.]*3+[1.]*3

    def invoke(self,opt_in=True,**overrides):
        kwargs=dict(cad=self.step,cad_report=self.certificate)
        if opt_in:kwargs.update(cad_reference=self.reference,cad_python=sys.executable)
        kwargs.update(overrides)
        return export_hm(self.mesh,self.report,self.exe,self.output,**kwargs)

    def host(self,*args,**kwargs):
        self.assertEqual(Path(kwargs['cwd']),self.output)
        (self.output/'model.hm').write_bytes(b'simulated HM process boundary')
        (self.output/'native-cad.iges').write_bytes(b'simulated IGES process boundary')
        (self.output/'host-audit.txt').write_text(
            'status complete\nmeshUnchanged 1\nnodes 8\nelements 1\nsurfaces 6\n'
            'solids 1\nboundaryNodes 8\nassociatedNodes -1\n'
            'nativeCadVolumeBefore 8\nnativeCadVolumeAfter 8\ncadBounds '+
            ' '.join(map(str,self.facet_bounds))+'\n')
        class CompletedHost:
            returncode=0
            def wait(self,timeout):return 0
        return CompletedHost()

    def audit(self,command,**kwargs):
        self.assertEqual(command[:4],[str(Path(sys.executable).resolve()),'-B','-m',
                                      'tools.bolthex.native_cad_audit'])
        self.assertEqual(kwargs['timeout'],600)
        self.assertEqual(kwargs['env']['TEMP'],str(self.output))
        manifest_path=Path(command[4]);manifest=json.loads(manifest_path.read_text())
        for file,key in [(self.output/'model.hm','nativeHmSHA256'),
                         (self.output/'native-cad.iges','igesSHA256'),(self.step,'sourceStepSHA256')]:
            self.assertEqual(manifest[key],sha(file))
        self.assertIs(manifest['optimizationDisabled'],True)
        ref=json.loads(self.reference.read_text())
        rows=[dict(row,nativeDistance=row['sourceDistance'],index=i) for i,row in enumerate(ref['points'])]
        edge_rows=[]
        for axis in range(3):
            for a,b in ((-1,-1),(-1,1),(1,-1),(1,1)):
                edge=len(edge_rows)//5
                for t in (-1.,-.5,0.,.5,1.):
                    point=[a,b];point.insert(axis,t)
                    edge_rows.append(dict(edge=edge,point=point,sourceDistance=0.))
        result=dict(schemaVersion=1,purpose='independent-native-cad-surface-audit',
            sampledNativeCadVerified=True,exactNativeCadCertified=False,fullModelAcceptance=False,
            igesSolidReconstructionVerified=False,sourceHmSHA256=manifest['nativeHmSHA256'],
            sourceStepSHA256=manifest['sourceStepSHA256'],referenceSHA256=sha(self.reference),
            igesSHA256=manifest['igesSHA256'],manifestSHA256=sha(manifest_path),
            nativeBounds=[-1.]*3+[1.]*3,sourceBounds=[-1.]*3+[1.]*3,
            sourceVolume=8.,nativeVolume=8.,maximumSurfaceDistance=0.,maximumControlDistanceError=0.,
            maximumReverseDistance=0.,maximumReverseEdgeDistance=0.,maximumSourceFaceDistance=0.,
            maximumCadBoundsDifference=0.,relativeNativeVolumeError=0.,
            nativeFaces=6,nativeEdges=12,surfaceWitnesses=6,controls=7,nearBoundaryControls=6,reverseWitnesses=6,
            sourceFaces=6,sourceFaceWitnesses=[dict(face=i,point=row['point'],nativeDistance=0.)
                for i,row in enumerate(r for r in rows if r['role']=='surface')],
            edgeWitnesses=len(edge_rows),edgeReverse=edge_rows,
            forward=rows,reverse=[dict(face=i,point=row['point'],sourceDistance=0.)
                                  for i,row in enumerate(r for r in rows if r['role']=='surface')])
        result=self.transform(result)
        if result is not None:write_json(Path(command[7]),result)
        return subprocess.CompletedProcess(command,self.audit_exit)

    def simulate(self,transform=lambda report:report,exit_code=0):
        self.transform=transform;self.audit_exit=exit_code
        self.host_patch=patch('tools.hypermesh_native.subprocess.Popen',side_effect=self.host)
        self.audit_patch=patch('tools.hypermesh_native.subprocess.run',side_effect=self.audit)
        self.addCleanup(self.host_patch.stop);self.addCleanup(self.audit_patch.stop)
        return self.host_patch.start(),self.audit_patch.start()

    def test_incomplete_or_conflicting_opt_in_rejects_before_host_or_output(self):
        cases=[dict(cad_reference=None),dict(cad_python=None),dict(cad=None),
               dict(debug_discrete_cad=True),dict(cad_python=self.root/'missing-python')]
        with patch('tools.hypermesh_native.subprocess.Popen') as host:
            for kwargs in cases:
                with self.subTest(kwargs=kwargs),self.assertRaises(ValueError):self.invoke(**kwargs)
                self.assertFalse(self.output.exists())
            host.assert_not_called()

    def test_far_control_or_fewer_than_six_local_controls_is_not_enough(self):
        original=json.loads(self.reference.read_text())
        for count in (0,5):
            ref=copy.deepcopy(original)
            local=[r for r in ref['points'] if r['role']=='control' and r['sourceDistance']<.001]
            ref['points']=[r for r in ref['points'] if r not in local]+local[:count]
            write_json(self.reference,ref)
            with self.subTest(count=count),patch('tools.hypermesh_native.subprocess.Popen') as host:
                with self.assertRaisesRegex(ValueError,'six near-boundary'):self.invoke()
                host.assert_not_called();self.assertFalse(self.output.exists())

    def test_stale_source_reference_rejects_before_output(self):
        ref=json.loads(self.reference.read_text());ref['sourceStepSHA256']='0'*64
        write_json(self.reference,ref)
        with patch('tools.hypermesh_native.subprocess.Popen') as host:
            with self.assertRaisesRegex(ValueError,'reference hash'):self.invoke()
            host.assert_not_called();self.assertFalse(self.output.exists())

    def test_default_keeps_strict_faceted_bounds_without_spawning_auditor(self):
        self.facet_bounds[-1]+=.00002
        _,auditor=self.simulate()
        with self.assertRaisesRegex(RuntimeError,'geometry bounds differ'):self.invoke(opt_in=False)
        auditor.assert_not_called();self.assertFalse((self.output/'report.json').exists())
        self.assertIn('if {0} {\n                set volumeBefore',(self.output/'export.tcl').read_text())

    def test_bound_positive_report_selects_independent_bounds_not_relaxed_facets(self):
        self.facet_bounds[-1]+=.1
        _,auditor=self.simulate()
        result=self.invoke()
        auditor.assert_called_once()
        self.assertTrue(result['sampledNativeCadVerified'])
        self.assertFalse(result['exactNativeCadCertified'])
        self.assertEqual(result['cadBoundsMethod'],'independent-native-IGES-BRep')
        self.assertEqual(result['maximumCadBoundsDifference'],0.)
        self.assertGreater(result['maximumNativeFacetBoundsDifference'],.09)

    def test_independent_bounds_still_reject_even_if_facets_match(self):
        def shifted(report):
            report['nativeBounds'][-1]+=.00002
            return report
        self.simulate(shifted)
        with self.assertRaisesRegex(RuntimeError,'geometry bounds differ'):self.invoke()
        self.assertFalse((self.output/'report.json').exists())

    def test_truncated_independent_bounds_cannot_publish_success(self):
        self.simulate(lambda r:dict(r,nativeBounds=r['nativeBounds'][:-1]))
        with self.assertRaises((ValueError,RuntimeError)):self.invoke()
        self.assertFalse((self.output/'report.json').exists())

    def test_nonfinite_independent_bounds_cannot_publish_success(self):
        self.simulate(lambda r:dict(r,nativeBounds=[-1.,-1.,-1.,1.,1.,float('nan')]))
        with self.assertRaises((ValueError,RuntimeError)):self.invoke()
        self.assertFalse((self.output/'report.json').exists())

    def test_negative_audit_cannot_publish_success(self):
        self.simulate(lambda r:dict(r,sampledNativeCadVerified=False))
        with self.assertRaises(RuntimeError):self.invoke()
        self.assertFalse((self.output/'report.json').exists())

    def test_positive_flag_alone_is_not_provenance(self):
        self.simulate(lambda r:dict(sampledNativeCadVerified=True))
        with self.assertRaisesRegex(RuntimeError,'does not bind'):self.invoke()
        self.assertFalse((self.output/'report.json').exists())

    def test_positive_flag_cannot_waive_any_missing_metric(self):
        def missing(report):
            del report[self.metric]
            return report
        self.simulate(missing)
        for key in NATIVE_LIMITS:
            self.metric=key;self.output=self.root/('missing-'+key)
            with self.subTest(metric=key):
                with self.assertRaises((ValueError,RuntimeError)):self.invoke()
                self.assertFalse((self.output/'report.json').exists())

    def test_missing_source_face_distance_rejects_positive_flag(self):
        def missing(report):
            del report['maximumSourceFaceDistance']
            return report
        self.simulate(missing)
        with self.assertRaises((ValueError,RuntimeError)):self.invoke()
        self.assertFalse((self.output/'report.json').exists())

    def test_exceeded_source_face_distance_rejects_positive_flag(self):
        self.simulate(lambda r:dict(r,maximumSourceFaceDistance=2.01e-6))
        with self.assertRaises((ValueError,RuntimeError)):self.invoke()
        self.assertFalse((self.output/'report.json').exists())

    def test_positive_flag_cannot_waive_any_exceeded_metric(self):
        self.simulate(lambda r:dict(r,**{self.metric:self.metric_value}))
        for key,limit in NATIVE_LIMITS.items():
            self.metric=key;self.metric_value=limit*1.01;self.output=self.root/('over-'+key)
            with self.subTest(metric=key):
                with self.assertRaises((ValueError,RuntimeError)):self.invoke()
                self.assertFalse((self.output/'report.json').exists())

    def test_positive_flag_cannot_waive_invalid_numeric_metrics(self):
        self.simulate(lambda r:dict(r,**{self.metric:self.metric_value}))
        for key in NATIVE_LIMITS:
            for index,value in enumerate((float('nan'),float('inf'),-1.,True,None,'0')):
                self.metric=key;self.metric_value=value;self.output=self.root/f'invalid-{key}-{index}'
                with self.subTest(metric=key,value=value):
                    with self.assertRaises((ValueError,RuntimeError)):self.invoke()
                    self.assertFalse((self.output/'report.json').exists())

    def test_claimed_zero_bounds_error_does_not_override_measured_difference(self):
        def inconsistent(report):
            report['sourceBounds'][-1]+=1e-6
            return report
        self.simulate(inconsistent)
        with self.assertRaisesRegex((ValueError,RuntimeError),'geometry bounds differ'):self.invoke()
        self.assertFalse((self.output/'report.json').exists())

    def test_declared_passing_maxima_cannot_hide_failed_raw_witnesses(self):
        def failed_witness(report):
            if self.witness_kind=='surface':report['forward'][0]['nativeDistance']=.001
            elif self.witness_kind=='control':report['forward'][1]['nativeDistance']=.001
            elif self.witness_kind=='reverse':report['reverse'][0]['sourceDistance']=.001
            else:report['edgeReverse'][0]['sourceDistance']=.001
            return report
        self.simulate(failed_witness)
        for kind in ('surface','control','reverse','edge'):
            self.witness_kind=kind;self.output=self.root/('witness-'+kind)
            with self.subTest(kind=kind):
                with self.assertRaises((ValueError,RuntimeError)):self.invoke()
                self.assertFalse((self.output/'report.json').exists())

    def test_reference_changed_during_host_rejects_before_auditor(self):
        host,auditor=self.simulate()
        def changed_reference(*args,**kwargs):
            process=self.host(*args,**kwargs)
            with self.reference.open('a') as stream:stream.write('\n')
            return process
        host.side_effect=changed_reference
        with self.assertRaisesRegex(RuntimeError,'reference changed'):self.invoke()
        auditor.assert_not_called();self.assertFalse((self.output/'report.json').exists())

    def test_nonzero_auditor_exit_rejects_even_with_positive_report(self):
        self.simulate(exit_code=2)
        with self.assertRaisesRegex(RuntimeError,'audit failed'):self.invoke()
        self.assertFalse((self.output/'report.json').exists())

    def test_missing_auditor_report_rejects_zero_exit(self):
        self.simulate(lambda r:None)
        with self.assertRaisesRegex(RuntimeError,'audit failed'):self.invoke()
        self.assertFalse((self.output/'report.json').exists())

    def check_stale_binding(self,key):
        self.simulate(lambda r:dict(r,**{key:'0'*64}))
        with self.assertRaisesRegex(RuntimeError,'does not bind'):self.invoke()
        self.assertFalse((self.output/'report.json').exists())

    def test_stale_hm_binding_rejects(self):self.check_stale_binding('sourceHmSHA256')
    def test_stale_step_binding_rejects(self):self.check_stale_binding('sourceStepSHA256')
    def test_stale_reference_binding_rejects(self):self.check_stale_binding('referenceSHA256')
    def test_stale_iges_binding_rejects(self):self.check_stale_binding('igesSHA256')
    def test_stale_manifest_binding_rejects(self):self.check_stale_binding('manifestSHA256')


class TinyRealCadExchangeTests(unittest.TestCase):
    """Real OCC STEP/IGES and auditor subprocess, no HyperMesh or FE meshing."""
    def setUp(self):
        from build123d import Box,export_step
        self.temporary=tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT'))
        self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name)
        self.shape=Box(2,2,2)
        self.step=self.root/'cube.step';export_step(self.shape,self.step)
        self.iges=self.root/'cube.iges'
        self.write_iges(self.shape)
        self.hm=self.root/'model.hm';self.hm.write_bytes(b'host provenance fixture, not actual HM')
        self.reference=self.root/'reference.json';write_json(self.reference,cube_reference(self.step))
        self.manifest=self.root/'manifest.json'
        write_json(self.manifest,dict(nativeHmPath=str(self.hm),nativeHmSHA256=sha(self.hm),
            sourceStepSHA256=sha(self.step),igesPath=str(self.iges),igesSHA256=sha(self.iges),
            solids=1,optimizationDisabled=True,nativeVolumeBefore=8.,nativeVolumeAfter=8.))
        self.output=self.root/'audit.json'

    def write_iges(self,*shapes):
        from OCP.IGESControl import IGESControl_Writer
        writer=IGESControl_Writer('MM',0)
        for shape in shapes:self.assertTrue(writer.AddShape(shape.wrapped))
        writer.ComputeModel();self.assertTrue(writer.Write(str(self.iges)))

    def bind_current_iges(self):
        manifest=json.loads(self.manifest.read_text());manifest['igesSHA256']=sha(self.iges)
        write_json(self.manifest,manifest)

    def run_audit(self):
        return subprocess.run([sys.executable,'-B','-m','tools.bolthex.native_cad_audit',
            str(self.manifest),str(self.step),str(self.reference),str(self.output)],
            cwd=Path(__file__).resolve().parents[2],capture_output=True,text=True,timeout=90,
            env={**os.environ,'TEMP':str(self.root),'TMP':str(self.root),
                 'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'})

    def test_real_tiny_exchange_measures_trimmed_surfaces_and_binds_all_inputs(self):
        process=self.run_audit()
        self.assertEqual(process.returncode,0,process.stdout+process.stderr)
        result=json.loads(self.output.read_text())
        self.assertTrue(result['sampledNativeCadVerified'])
        self.assertFalse(result['exactNativeCadCertified']);self.assertFalse(result['fullModelAcceptance'])
        self.assertFalse(result['igesSolidReconstructionVerified'])
        self.assertEqual(result['nativeFaces'],6);self.assertEqual(result['reverseWitnesses'],6)
        self.assertEqual(result['nearBoundaryControls'],6)
        for path,key in [(self.hm,'sourceHmSHA256'),(self.step,'sourceStepSHA256'),
                         (self.iges,'igesSHA256'),(self.reference,'referenceSHA256'),
                         (self.manifest,'manifestSHA256')]:self.assertEqual(result[key],sha(path))
        self.assertLessEqual(result['maximumSurfaceDistance'],2e-6)
        self.assertLessEqual(result['maximumControlDistanceError'],2e-6)
        self.assertLessEqual(result['maximumReverseDistance'],2e-6)
        self.assertLessEqual(result['maximumReverseEdgeDistance'],2e-6)
        edges=result['edgeReverse']
        self.assertEqual(result['edgeWitnesses'],len(edges))
        self.assertGreaterEqual(len({row['edge'] for row in edges}),12)
        self.assertGreaterEqual(len(edges),60)
        for row in edges:
            self.assertTrue(math.isfinite(row['sourceDistance']))
            self.assertLessEqual(row['sourceDistance'],2e-6)
        self.assertEqual(result['maximumReverseEdgeDistance'],max(row['sourceDistance'] for row in edges))
        self.assertLessEqual(result['relativeNativeVolumeError'],1e-7)
        self.assertLess(sum(p.stat().st_size for p in self.root.iterdir()),1024*1024)

    def test_real_subprocess_negative_measurement_exits_nonzero(self):
        manifest=json.loads(self.manifest.read_text())
        manifest.update(nativeVolumeBefore=8.000008,nativeVolumeAfter=8.000008)
        write_json(self.manifest,manifest)
        process=self.run_audit()
        self.assertEqual(process.returncode,2,process.stdout+process.stderr)
        result=json.loads(self.output.read_text())
        self.assertFalse(result['sampledNativeCadVerified'])
        self.assertGreater(result['relativeNativeVolumeError'],1e-7)

    def test_real_subprocess_rejects_changed_iges_before_measurement(self):
        with self.iges.open('ab') as stream:stream.write(b'changed')
        process=self.run_audit()
        self.assertNotEqual(process.returncode,0)
        self.assertIn('hash mismatch',process.stderr)
        self.assertFalse(self.output.exists())

    def test_real_displaced_faces_reject_without_relaxing_surface_limit(self):
        self.write_iges(self.shape.translate((.00002,0,0)));self.bind_current_iges()
        process=self.run_audit()
        self.assertEqual(process.returncode,2,process.stdout+process.stderr)
        result=json.loads(self.output.read_text())
        self.assertFalse(result['sampledNativeCadVerified'])
        self.assertGreater(result['maximumSurfaceDistance'],2e-6)

    def test_auxiliary_curve_does_not_expand_face_only_bounds(self):
        from build123d import Edge
        self.write_iges(self.shape,Edge.make_line((100,0,0),(135,0,0)))
        self.bind_current_iges()
        process=self.run_audit()
        self.assertEqual(process.returncode,0,process.stdout+process.stderr)
        result=json.loads(self.output.read_text())
        self.assertTrue(result['sampledNativeCadVerified'])
        self.assertEqual(result['nativeFaces'],6)
        self.assertLessEqual(result['maximumCadBoundsDifference'],1e-5)
        self.assertLessEqual(max(map(abs,result['nativeBounds'])),1.00001)

    def test_manifest_guards_reject_before_any_geometry_measurement(self):
        from tools.bolthex.native_cad_audit import audit_exchange
        original=json.loads(self.manifest.read_text())
        cases=[dict(optimizationDisabled=False),dict(optimizationDisabled=1),
               dict(solids=True),dict(solids=2),dict(nativeVolumeBefore=float('nan')),
               dict(nativeVolumeBefore=-8.),dict(nativeVolumeAfter=8.000001),
               dict(igesSHA256='0'*64),dict(nativeHmSHA256='0'*64),
               dict(sourceStepSHA256='0'*64)]
        with patch('tools.bolthex.native_cad_audit.TrimmedFaceDistances',
                   side_effect=AssertionError('Invalid manifest reached geometry measurement')) as measure:
            for case in cases:
                write_json(self.manifest,dict(original,**case))
                with self.subTest(case=case),self.assertRaises(ValueError):
                    audit_exchange(self.manifest,self.step,self.reference,self.output)
                self.assertFalse(self.output.exists())
            measure.assert_not_called()

    def test_manifest_change_during_real_measurement_cannot_publish_report(self):
        from tools.bolthex.native_cad_audit import audit_exchange
        from tools.hypermesh_probe_reference import TrimmedFaceDistances
        def change_manifest(shape):
            with self.manifest.open('a') as stream:stream.write('\n')
            return TrimmedFaceDistances(shape)
        with patch('tools.bolthex.native_cad_audit.TrimmedFaceDistances',side_effect=change_manifest):
            with self.assertRaisesRegex(ValueError,'changed during measurement'):
                audit_exchange(self.manifest,self.step,self.reference,self.output)
        self.assertFalse(self.output.exists())

    def test_extra_geometric_face_is_not_discarded_as_auxiliary_curve(self):
        extra=self.shape.faces()[0].translate((10,0,0))
        self.write_iges(self.shape,extra);self.bind_current_iges()
        process=self.run_audit()
        self.assertEqual(process.returncode,2,process.stdout+process.stderr)
        result=json.loads(self.output.read_text())
        self.assertFalse(result['sampledNativeCadVerified'])
        self.assertGreater(result['maximumReverseDistance'],2e-6)

    def test_sparse_reference_cannot_certify_a_missing_source_face(self):
        # Remaining faces still span the full cube bbox; host volume alone cannot
        # establish that the IGES measurement carrier contains the missing face.
        faces=[face for face in self.shape.faces() if face.center().X<.9]
        self.assertEqual(len(faces),5)
        self.write_iges(*faces);self.bind_current_iges()
        points=[dict(point=[0.,0.,1.],role='surface',sourceDistance=0.),
                dict(point=[0.,0.,2.],role='control',sourceDistance=1.)]
        points.extend(dict(point=[x,y,1.00002],role='control',sourceDistance=.00002)
                      for x,y in ((-.5,-.5),(-.5,0),(-.5,.5),(.5,-.5),(.5,0),(.5,.5)))
        write_json(self.reference,dict(sourceStepSHA256=sha(self.step),points=points))
        process=self.run_audit()
        self.assertEqual(process.returncode,2,process.stdout+process.stderr)
        self.assertFalse(json.loads(self.output.read_text())['sampledNativeCadVerified'])


if __name__=='__main__':unittest.main()
