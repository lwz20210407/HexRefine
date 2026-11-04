import json,os,subprocess,tempfile,unittest
from pathlib import Path
import numpy as np


@unittest.skipUnless(os.environ.get('HEXREFINE_NODE'),'explicit Node executable not selected')
class GeometryProvenanceTests(unittest.TestCase):
    def run_writer(self,root,kind=None):
        points=np.array([[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]],dtype='<f8')
        points.tofile(root/'nodes.f64');np.arange(8,dtype='<i4').tofile(root/'elements.i32')
        manifest=dict(schemaVersion=1,nodes=8,elements=1)
        if kind is not None:manifest['geometryReference']=kind
        (root/'mesh-binary.json').write_text(json.dumps(manifest))
        project=Path(__file__).resolve().parents[2]
        return subprocess.run([os.environ['HEXREFINE_NODE'],str(project/'scripts/export-cad-h8-binary.mjs'),str(root)],
                              cwd=project,text=True,capture_output=True,timeout=20)

    def test_analytic_band_cannot_claim_an_independent_step(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as temporary:
            root=Path(temporary);result=self.run_writer(root,'analytic-thread-field')
            self.assertEqual(result.returncode,0,result.stderr)
            text=(root/'model.k').read_text()
            self.assertIn('continuous radius field, not independent CAD',text)
            self.assertNotIn('mapped from independent design STEP',text)

    def test_existing_cad_default_and_unknown_kind_guard(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as temporary:
            root=Path(temporary);result=self.run_writer(root)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertIn('mapped from independent design STEP',(root/'model.k').read_text())
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as temporary:
            root=Path(temporary);result=self.run_writer(root,'unverified')
            self.assertNotEqual(result.returncode,0)
            self.assertFalse((root/'model.k').exists());self.assertFalse((root/'model.partial.k').exists())


if __name__=='__main__':unittest.main()
