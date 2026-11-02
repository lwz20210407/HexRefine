import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from tools.hypermesh_native import make_tcl, export_hm, _cached_boundary_count, _check_development_profile
from tools.bolthex.export_step import export_sections


class NativeExportGuards(unittest.TestCase):
    def test_feature_profile_keeps_medium_complete_mesh_but_rejects_mismatched_profiles(self):
        report=dict(nodes=169939,elements=160704,kSHA256='mesh',sourceStepSHA256='cad',
                    notFullModelAcceptance=True,developmentProfile='feature',
                    minimumCornerScaledJacobian=.2884,minimumGaussJacobian=.00004)
        cad=dict(developmentOnly=True,developmentProfile='feature',developmentKSHA256='mesh',
                 stepSHA256='cad',acceptedAsIndependentCad=True)
        _check_development_profile(report,cad,22703695)
        for field,value in [('elements',200001),('nodes',300001),
                            ('minimumCornerScaledJacobian',float('nan')),
                            ('minimumGaussJacobian',float('inf'))]:
            with self.subTest(field=field),self.assertRaises(ValueError):
                _check_development_profile(dict(report,**{field:value}),cad,22703695)
        with self.assertRaisesRegex(ValueError,'inconsistent'):
            _check_development_profile(report,dict(cad,developmentProfile='smoke'),22703695)
        with self.assertRaisesRegex(ValueError,'budget'):
            _check_development_profile(report,cad,32*1024*1024+1)

    def test_small_development_profile_is_explicit_and_cannot_disable_h8_quality(self):
        report=dict(nodes=100,elements=80,kSHA256='mesh',sourceStepSHA256='cad',notFullModelAcceptance=True,
                    minimumCornerScaledJacobian=.3,minimumGaussJacobian=.01)
        cad=dict(developmentOnly=True,developmentKSHA256='mesh',stepSHA256='cad',acceptedAsIndependentCad=True)
        _check_development_profile(report,cad,1000)
        for field,value in [('notFullModelAcceptance',False),('elements',10001),('minimumCornerScaledJacobian',.149),('minimumGaussJacobian',0)]:
            with self.subTest(field=field),self.assertRaises(ValueError):
                _check_development_profile(dict(report,**{field:value}),cad,1000)
        with self.assertRaisesRegex(ValueError,'budget'):
            _check_development_profile(report,cad,2*1024*1024+1)

    def test_native_layout_reserves_geometry_ids_and_keeps_duplicate_k_optional(self):
        text=make_tcl(Path('F:/in.k'),Path('F:/in.step'),Path('F:/out'),Path('F:/template'),8,1,1,False,1e-7,[1,2,3,4,5,6,7,8])
        self.assertIn('*renumber components 1 1001 1 0 0',text)
        self.assertIn('Native import changed source part IDs',text)
        self.assertIn('if {0} {\n                *feoutputmergeincludefiles',text)
        self.assertIn('sha256',text)

    def test_invalid_host_timeout_is_not_an_unbounded_background_job(self):
        for value in [False,0,3601,1.5]:
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'Host timeout'):
                export_hm(None,None,None,None,host_timeout=value)

    def test_exact_audit_cache_rejects_nonfinite_and_stale_quality(self):
        report=dict(kSHA256='same',nodes=8,elements=1,volume=1)
        baseline=dict(report,reader='ansys-dyna-core',minimumCornerScaledJacobian=1,
                      nonmanifoldFaces=0,nonmanifoldBoundaryEdges=0,boundaryFaces=6,boundaryEuler=2)
        self.assertEqual(_cached_boundary_count(report,baseline),8)
        for key,value in [('kSHA256','changed'),('volume',float('nan')),('minimumCornerScaledJacobian',float('nan')),
                          ('minimumCornerScaledJacobian',.149),('boundaryFaces',99),('nodes',True)]:
            with self.subTest(key=key),self.assertRaises(ValueError):
                _cached_boundary_count(report,dict(baseline,**{key:value}))

    def test_equal_volume_without_exact_k_binding_is_not_matching_cad(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as temporary:
            root=Path(temporary);exe=root/'hmbatch.exe';exe.write_bytes(b'not executed')
            mesh=root/'model.k';mesh.write_text('*KEYWORD\n*END\n')
            report=root/'source.json'
            report.write_text(json.dumps(dict(kSHA256=hashlib.sha256(mesh.read_bytes()).hexdigest(),nodes=8,elements=1,volume=1)))
            cad=root/'model.step';cad.write_text('not imported')
            certificate=root/'cad.json'
            certificate.write_text(json.dumps(dict(stepSHA256=hashlib.sha256(cad.read_bytes()).hexdigest(),solids=1,
                meshVolume=1,relativeMeshVolumeError=0,geometryIndependentOfMesh=True,matchedMeshVerified=True,matchedKSHA256='another-mesh')))
            with self.assertRaisesRegex(ValueError,'this exact K'):
                export_hm(mesh,report,exe,root/'result',cad,certificate)
            self.assertFalse((root/'result').exists())

    def test_fe_station_brep_cannot_be_promoted_as_design_cad(self):
        with self.assertRaisesRegex(ValueError,'not an accepted independent CAD'):
            export_sections(None,None)

    def test_native_cad_mode_rejects_old_discrete_certificate(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as temporary:
            root=Path(temporary);exe=root/'hmbatch.exe';exe.write_bytes(b'not executed')
            mesh=root/'model.k';mesh.write_text('*KEYWORD\n*END\n')
            report=root/'source.json'
            report.write_text(json.dumps(dict(kSHA256=hashlib.sha256(mesh.read_bytes()).hexdigest(),nodes=8,elements=1,volume=1)))
            cad=root/'model.step';cad.write_text('diagnostic placeholder')
            certificate=root/'cad.json'
            certificate.write_text(json.dumps(dict(stepSHA256=hashlib.sha256(cad.read_bytes()).hexdigest(),solids=1,
                meshVolume=1,relativeMeshVolumeError=0,geometryIndependentOfMesh=False)))
            with self.assertRaisesRegex(ValueError,'Independent design CAD'):
                export_hm(mesh,report,exe,root/'result',cad,certificate)
            self.assertFalse((root/'result').exists())

    def test_paths_are_encoded_not_executable_tcl(self):
        output=Path('F:/case with spaces')
        malicious=Path('F:/part}; error injected; #.k')
        text=make_tcl(malicious,None,output,Path('F:/template.key'),8,1,0,False,1e-7,[1,2,3,4])
        self.assertNotIn(str(malicious),text)
        self.assertIn(str(malicious).encode().hex(),text)
        self.assertNotIn('@MESH@',text);self.assertNotIn('@BOUNDARY@',text)
        self.assertIn('snap_nodes=0',text)
        self.assertIn('same_snapshot $original [snapshot]',text)
        self.assertIn('set boundary {1 2 3 4}',text)
        self.assertIn('set cad [decode {}]',text)

    def test_invalid_or_stale_inputs_publish_nothing(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as temporary:
            root=Path(temporary);exe=root/'hmbatch.exe';exe.write_bytes(b'not executed')
            mesh=root/'model.k';mesh.write_text('*KEYWORD\n*END\n')
            report=root/'source.json';out=root/'result'
            report.write_text(json.dumps(dict(kSHA256='stale',nodes=8,elements=1)))
            with self.assertRaises(ValueError):export_hm(mesh,report,exe,out)
            self.assertFalse(out.exists())
            report.write_text(json.dumps(dict(kSHA256=hashlib.sha256(mesh.read_bytes()).hexdigest(),nodes=8,elements=1)))
            with self.assertRaises(ValueError):export_hm(mesh,report,exe,out,associate=True)
            self.assertFalse(out.exists())
            with self.assertRaises(ValueError):export_hm(mesh,report,exe,out,tolerance=.01)
            self.assertFalse(out.exists())
            out.mkdir()
            with self.assertRaises(ValueError):export_hm(mesh,report,exe,out)


if __name__=='__main__':unittest.main()
