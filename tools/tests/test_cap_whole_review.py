"""Real file-level counterexamples for whole-cap delivery validation.

The local body cache is a reproducibility aid, not a signed attestation.
These cases do not invent CAD acceptance reports or rebuild a large model.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import numpy as np


@unittest.skipUnless(os.environ.get('HEXREFINE_VALIDATION_PYTHON') and os.environ.get('BOLTHEX_TEST_ROOT'),
                     'Select the installed PyDYNA interpreter and task scratch root')
class WholeBinarySubsetReview(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT'])
        self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name)
        self.nodes=np.array([[0,0,0],[1,0,0],[1,1,0],[0,1,0],
                             [0,0,1],[1,0,1],[1,1,1],[0,1,1]],dtype='<f8')
        self.nodes.tofile(self.root/'nodes.f64')
        np.arange(8,dtype='<i4').reshape(1,8).tofile(self.root/'elements.i32')
        (self.root/'mesh-binary.json').write_text(json.dumps(dict(schemaVersion=1,nodes=8,
            elements=1,expectedVolume=1.,expectedEuler=2)))
        self.keyword='*KEYWORD\n*NODE\n'+''.join(
            f'{i},'+','.join(map(str,p))+'\n' for i,p in enumerate(self.nodes,1))
        self.keyword+='*ELEMENT_SOLID\n1,1,1,2,3,4,5,6,7,8\n*END\n'
        self.k=self.root/'model.k'
        self.k.write_text(self.keyword)

    def run_reader(self):
        return subprocess.run([os.environ['HEXREFINE_VALIDATION_PYTHON'],'-B','-m',
            'tools.bolthex.validate_binary_k',str(self.root)],
            cwd=Path(__file__).resolve().parents[2],capture_output=True,text=True,timeout=90,
            env={**os.environ,'TEMP':str(self.root),'TMP':str(self.root),
                 'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'})

    def test_real_pydyna_positive_control(self):
        result=self.run_reader()
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        report=json.loads((self.root/'independent-k-audit.json').read_text())
        self.assertTrue(report['exactConnectivity'])
        self.assertEqual(report['nodes'],8);self.assertEqual(report['elements'],1)
        self.assertAlmostEqual(report['quality']['volume'],1.)
        self.assertFalse(report['independentCadVerified'])

    def test_column_one_extra_card_is_rejected(self):
        self.k.write_text(self.keyword.replace('*END','*ELEMENT_BEAM\n2,1,1,2,3\n*END'))
        result=self.run_reader()
        self.assertNotEqual(result.returncode,0)
        self.assertIn('native mesh-only subset',result.stderr)
        self.assertFalse((self.root/'independent-k-audit.json').exists())

    def test_indented_extra_beam_cannot_pass_mesh_only_validation(self):
        self.k.write_text(self.keyword.replace('*END','   *ELEMENT_BEAM\n2,1,1,2,3\n*END'))
        result=self.run_reader()
        self.assertNotEqual(result.returncode,0,
            'A real K with an extra indented beam was certified as native H8-only: '+result.stdout)
        self.assertFalse((self.root/'independent-k-audit.json').exists())

    def test_indented_solver_material_cannot_pass_mesh_only_validation(self):
        self.k.write_text(self.keyword.replace('*END','\t*MAT_ELASTIC\n1,1,100,.3\n*END'))
        result=self.run_reader()
        self.assertNotEqual(result.returncode,0,
            'An indented material card was ignored by the H8-only whitelist: '+result.stdout)
        self.assertFalse((self.root/'independent-k-audit.json').exists())

    def test_changed_coordinate_still_rejects_without_publishing(self):
        self.k.write_text(self.keyword.replace('2,1.0,0.0,0.0','2,1.000001,0.0,0.0'))
        result=self.run_reader()
        self.assertNotEqual(result.returncode,0)
        self.assertIn('coordinates or connectivity differ',result.stderr)
        self.assertFalse((self.root/'independent-k-audit.json').exists())


if __name__=='__main__':unittest.main()
