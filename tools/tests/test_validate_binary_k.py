import json,os,subprocess,tempfile,unittest
from pathlib import Path
import numpy as np
from tools.bolthex.validate_binary_k import validate


class BinaryReadbackGuards(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('BOLTHEX_TEST_ROOT'),'Explicit test output root required')
    def test_invalid_manifest_stops_before_loading_dyna(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as folder:
            root=Path(folder)
            for name in ('nodes.f64','elements.i32','model.k'):(root/name).write_bytes(b'')
            (root/'mesh-binary.json').write_text(json.dumps(dict(schemaVersion=1,nodes=True,elements=1,expectedVolume=1)))
            with self.assertRaisesRegex(ValueError,'manifest'):validate(root)


@unittest.skipUnless(os.environ.get('HEXREFINE_VALIDATION_PYTHON') and os.environ.get('BOLTHEX_TEST_ROOT'),'Explicit PyDYNA runtime and output root required')
class IndependentBinaryReadbackTests(unittest.TestCase):
    def fixture(self,root):
        nodes=np.array([[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]],dtype='<f8')
        nodes.tofile(root/'nodes.f64');np.arange(8,dtype='<i4').reshape(1,8).tofile(root/'elements.i32')
        (root/'mesh-binary.json').write_text(json.dumps(dict(schemaVersion=1,nodes=8,elements=1,expectedVolume=1,expectedEuler=2)))
        text='*KEYWORD\n*NODE\n'+''.join(f'{i},'+','.join(map(str,p))+'\n' for i,p in enumerate(nodes,1))+'*ELEMENT_SOLID\n1,1,1,2,3,4,5,6,7,8\n*END\n'
        (root/'model.k').write_text(text)

    def run_reader(self,root):
        return subprocess.run([os.environ['HEXREFINE_VALIDATION_PYTHON'],'-B','-m','tools.bolthex.validate_binary_k',str(root)],
                              cwd=Path(__file__).resolve().parents[2],capture_output=True,text=True,timeout=60)

    def test_actual_pydyna_cube_readback_and_audit(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as folder:
            root=Path(folder);self.fixture(root);run=self.run_reader(root)
            self.assertEqual(run.returncode,0,run.stdout+run.stderr)
            report=json.loads((root/'independent-k-audit.json').read_text())
            self.assertTrue(report['exactConnectivity']);self.assertAlmostEqual(report['quality']['volume'],1)
            self.assertFalse(report['independentCadVerified'])

    def test_wrong_coordinate_or_pid_does_not_publish_audit(self):
        for old,new in [('2,1.0,0.0,0.0','2,1.000001,0.0,0.0'),('1,1,1,2,3,4,5,6,7,8','1,2,1,2,3,4,5,6,7,8')]:
            with self.subTest(new=new),tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as folder:
                root=Path(folder);self.fixture(root)
                path=root/'model.k';text=path.read_text();self.assertIn(old,text);path.write_text(text.replace(old,new))
                run=self.run_reader(root);self.assertNotEqual(run.returncode,0)
                self.assertFalse((root/'independent-k-audit.json').exists())
