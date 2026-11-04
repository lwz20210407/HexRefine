import os,tempfile,unittest
from pathlib import Path
import numpy as np
from tools.bolthex.mesh_core import Mesh3D
from tools.bolthex.inp_writer import write_inp


class InpPrecisionTests(unittest.TestCase):
    def test_legacy_default_and_explicit_precision(self):
        mesh=Mesh3D('TEST');mesh.nodes=np.array([[.1234567890123,0,0]])
        mesh.elems=np.empty((0,8),dtype=int)
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as directory:
            path=Path(directory)/'model.inp'
            write_inp([mesh],path,with_material=False)
            self.assertIn('1, 0.123457, 0.000000, 0.000000',path.read_text())
            write_inp([mesh],path,with_material=False,coordinate_precision=12)
            self.assertIn('1, 0.123456789012, 0.000000000000, 0.000000000000',path.read_text())

    def test_invalid_precision_does_not_touch_output(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as directory:
            path=Path(directory)/'model.inp';path.write_text('preserve')
            for precision in (True,2,16,6.5):
                with self.subTest(precision=precision),self.assertRaises(ValueError):
                    write_inp([],path,coordinate_precision=precision)
                self.assertEqual(path.read_text(),'preserve')
