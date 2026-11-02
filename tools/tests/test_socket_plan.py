import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from tools.bolthex.cad_mesh import MeshSeeds
from tools.bolthex.socket_plan import plan


class SocketPlanningGuards(unittest.TestCase):
    def test_bad_budget_rejects_before_any_files_or_cad_are_loaded(self):
        for limit in (True,0,1.5,5000001):
            with self.subTest(limit=limit),self.assertRaisesRegex(ValueError,'element limit'):
                plan(None,MeshSeeds(),limit)

    def test_changed_source_rejects_before_cad_loading(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as directory:
            root=Path(directory)
            (root/'model.step').write_bytes(b'not a CAD model')
            (root/'cad-report.json').write_text(json.dumps(dict(acceptedAsIndependentCad=True,
                geometryIndependentOfMesh=True,stepSHA256=hashlib.sha256(b'original').hexdigest())))
            with self.assertRaisesRegex(ValueError,'hash-verified'):
                plan(root,MeshSeeds())


if __name__=='__main__':unittest.main()
