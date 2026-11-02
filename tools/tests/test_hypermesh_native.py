import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from tools.hypermesh_native import make_tcl, export_hm


class NativeExportGuards(unittest.TestCase):
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
