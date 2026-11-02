"""Small public regressions; private 224-case differential evidence is separate."""
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
import numpy as np
from tools.bolthex import build_bolt, build_nut, build_plate, write_inp
from tools.bolthex.__main__ import demo_meshes
from tools.bolthex.mesh_core import thread_R, min_scaled_volume
from tools.bolthex.version import APP_COPYRIGHT


class RecoveredBoltTests(unittest.TestCase):
    def test_original_demo_byte_identical(self):
        meshes = demo_meshes()
        self.assertEqual([(len(m.nodes), len(m.elems)) for m in meshes],
                         [(28453, 26352), (11040, 8640), (6820, 5280)])
        for mesh in meshes:
            self.assertGreater(min_scaled_volume(mesh)[0], 0)
        parent = os.environ.get('BOLTHEX_TEST_ROOT')
        with tempfile.TemporaryDirectory(dir=parent) as temporary:
            file = Path(temporary) / 'demo.inp'
            write_inp(meshes, str(file))
            # Original Windows writer uses CRLF. Normalize only platform newlines.
            data = file.read_text(encoding='utf-8').replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8')
            self.assertEqual(hashlib.sha256(data).hexdigest(),
                             '7ff46daa0e757b0e46db305bdbdb5640cabb33a603fbfdc4d69df2aaa71af7e0')

    def test_recovered_profile_not_previous_independent_profile(self):
        self.assertEqual(thread_R(0, 0, 2, 8, 7), 8)
        self.assertEqual(thread_R(1, 0, 2, 8, 7), 7)
        for i in range(-20, 21):
            self.assertAlmostEqual(thread_R(i / 7, i * 3, 2, 8, 7),
                                   thread_R(i / 7 + 2, i * 3, 2, 8, 7))

    def test_three_head_shapes_and_plain_switch(self):
        for shape in ['hex', 'round', 'cyl']:
            for threaded in [True, False]:
                mesh = build_bolt(16, 2, 30, 18, 10, 24, n=2, head_type=shape,
                                  threaded=threaded, dk=28)
                self.assertTrue(np.isfinite(mesh.nodes).all())
                self.assertEqual(mesh.elems.shape[1], 8)
                self.assertGreater(min_scaled_volume(mesh)[0], 0)
                self.assertIn('S_BEAR', mesh.surfaces)

    def test_nut_shapes_and_plate_shapes(self):
        for shape in ['hex', 'round', 'dome']:
            mesh = build_nut(16, 2, 24, 14.8, shape=shape, n=2, d_out=24)
            self.assertGreater(min_scaled_volume(mesh)[0], 0)
            self.assertIn('S_NTHREAD', mesh.surfaces)
        for shape in ['rect', 'cyl']:
            mesh = build_plate(60, 60, 10, 17, shape=shape, D_out=60, n=2,
                               threaded=True, d_thread=16, P=2)
            self.assertGreater(min_scaled_volume(mesh)[0], 0)
            self.assertIn('S_HOLE', mesh.surfaces)

    def test_original_notice_and_no_packaged_runtime_dependency(self):
        self.assertEqual(APP_COPYRIGHT, '(c) 2026 BoltHex')
        folder = Path(__file__).resolve().parents[1] / 'bolthex'
        self.assertFalse((folder / 'license.key').exists())
        for file in folder.glob('*.py'):
            source = file.read_text(encoding='utf-8')
            self.assertNotIn('marshal.loads', source)
            self.assertNotIn('BoltHex.exe', source)


if __name__ == '__main__':
    unittest.main()
