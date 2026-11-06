"""Optional numerical-verification tools cannot promote mocks or altered inputs."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import numpy as np

from tools.bolthex import r11_affine_patch as r11
from tools.bolthex import skfem_affine_patch as independent

SCRATCH=os.environ.get('BOLTHEX_TEST_ROOT')
try:PYDYNA=importlib.util.find_spec('ansys.dyna.core') is not None
except ModuleNotFoundError:PYDYNA=False
SKFEM=importlib.util.find_spec('skfem') is not None


def cube(path,warped=False):
    def nid(i,j,k):return 1+i+4*j+16*k
    points=np.array([[i/3,j/3,k/3] for k in range(4) for j in range(4) for i in range(4)])
    if warped:points[nid(1,1,1)-1]+=[.025,-.015,.02]
    with path.open('x') as f:
        f.write('*KEYWORD\n*NODE\n')
        for n,p in enumerate(points,1):f.write(str(n)+','+','.join(format(v,'.17g') for v in p)+'\n')
        f.write('*ELEMENT_SOLID\n');eid=0
        for k in range(3):
            for j in range(3):
                for i in range(3):
                    eid+=1;nodes=[nid(i,j,k),nid(i+1,j,k),nid(i+1,j+1,k),nid(i,j+1,k),
                        nid(i,j,k+1),nid(i+1,j,k+1),nid(i+1,j+1,k+1),nid(i,j+1,k+1)]
                    f.write(f'{eid},1,'+','.join(map(str,nodes))+'\n')
        f.write('*END\n')


class MonitorTests(unittest.TestCase):
    def test_disappearing_solver_temporary_file_is_not_a_runner_crash(self):
        vanished=SimpleNamespace(is_file=lambda:True,stat=lambda:(_ for _ in ()).throw(FileNotFoundError()))
        present=SimpleNamespace(is_file=lambda:True,stat=lambda:SimpleNamespace(st_size=12))
        self.assertEqual(r11._artifact_sizes(SimpleNamespace(iterdir=lambda:iter((vanished,present)))),[12])

    def test_cleanup_only_uses_the_owned_process_handle(self):
        class Owned:
            state=None;terminated=False;killed=False
            def poll(self):return self.state
            def terminate(self):self.terminated=True;self.state=-15
            def kill(self):self.killed=True;self.state=-9
            def wait(self,timeout):return self.state
        p=Owned();r11._stop_owned(p);self.assertTrue(p.terminated);self.assertFalse(p.killed)
        q=Owned();q.state=0;r11._stop_owned(q);self.assertFalse(q.terminated)


class PatchFixture(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=SCRATCH);self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.source=self.root/'source.k';cube(self.source)

    def prepare(self,name='case'):
        out=self.root/name;r11.build_case(self.source,out);return out


@unittest.skipUnless(SCRATCH and PYDYNA,'Explicit scratch and optional PyDYNA required')
class PreparedCaseTests(PatchFixture):

    def test_source_stays_readonly_and_has_free_interior_nodes(self):
        before=self.source.read_bytes();case=self.prepare();meta=json.loads((case/'case.json').read_text())
        self.assertEqual((meta['nodes'],meta['H8'],meta['freeInteriorNodes']),(64,27,8))
        self.assertEqual(self.source.read_bytes(),before)
        self.assertFalse(meta['solverRun']);self.assertFalse(meta['syntheticPatchPassed'])
        self.assertFalse(meta['engineeringFastenerAnalysisVerified'])
        with self.assertRaises(ValueError):r11.build_case(self.source,case)

    def test_physics_and_unrepresentable_reference_reject_before_publication(self):
        for i,kwargs in enumerate((dict(young=-1),dict(poisson=.5),dict(strain=np.zeros((3,3))),dict(strain=np.eye(3)*1e-300))):
            out=self.root/f'bad{i}'
            with self.subTest(kwargs=kwargs),self.assertRaises(ValueError):r11.build_case(self.source,out,**kwargs)
            self.assertFalse(out.exists())
        self.source.write_text(self.source.read_text().replace('*END','*MAT_ELASTIC\n1,1,1000,.25\n*END'))
        with self.assertRaises(ValueError):self.prepare('physical')

    def test_actual_pydyna_reads_all_geometry_history_and_dirichlet_cards(self):
        result=r11.verify_input_deck(self.prepare())
        self.assertTrue(result['inputParseVerified']);self.assertTrue(result['syntheticPhysicsInputParsed'])
        self.assertEqual(result['prescribedDOFs'],168);self.assertEqual(result['H8'],27)
        self.assertFalse(result['r11SolverVerified'])

    @unittest.skipUnless(os.name=='nt','Windows runner')
    def test_runner_exception_terminates_only_its_owned_child(self):
        case=self.prepare();exe=self.root/'ls-dyna_fake.exe';exe.write_bytes(b'fixture-never-executed')
        class Owned:
            pid=999999;state=None;terminated=False
            def poll(self):return self.state
            def terminate(self):self.terminated=True;self.state=-15
            def wait(self,timeout):return self.state
        owned=Owned()
        with patch.object(r11.subprocess,'Popen',return_value=owned),patch.object(r11,'_artifact_sizes',side_effect=RuntimeError('monitor failed')):
            with self.assertRaisesRegex(RuntimeError,'monitor failed'):r11.run_case(case,exe)
        self.assertTrue(owned.terminated);self.assertFalse((case/'run.json').exists())


@unittest.skipUnless(SCRATCH and PYDYNA and SKFEM,'Explicit scratch and optional numerical backends required')
class IndependentPatchTests(PatchFixture):
    def test_warped_complete_patch_solves_interior_and_is_not_r11_or_contact_acceptance(self):
        self.source.unlink();cube(self.source,warped=True)
        case=self.prepare();report=independent.verify_case(case)
        self.assertTrue(report['syntheticLinearPatchVerified']);self.assertEqual(report['freeInteriorDOFs'],24)
        self.assertFalse(report['interiorInitialGuessWasAnalytical'])
        self.assertFalse(report['r11Verified']);self.assertFalse(report['engineeringFastenerAnalysisVerified'])
        self.assertFalse(report['contactPreloadOrMaterialCalibrationVerified'])
        self.assertLess(max(report['relativeErrors'].values()),1e-8)
        with self.assertRaises(ValueError):independent.verify_case(case)

    def test_all_prescribed_nodes_cannot_forge_an_interior_test(self):
        case=self.prepare();path=case/'reference.npz'
        with np.load(path,allow_pickle=False) as r:data={key:r[key].copy() for key in r.files}
        data['boundary_rows']=np.arange(64);data['interior_rows']=np.array([],dtype=int)
        np.savez_compressed(path,**data)
        meta=json.loads((case/'case.json').read_text());meta['referenceSHA256']=hashlib.sha256(path.read_bytes()).hexdigest()
        (case/'case.json').write_text(json.dumps(meta))
        with self.assertRaisesRegex(ValueError,'boundary_rows'):independent.verify_case(case)
        self.assertFalse((case/'skfem-result.json').exists())

    def test_altered_analytical_reference_is_not_trusted(self):
        case=self.prepare();path=case/'case.json';meta=json.loads(path.read_text());meta['expectedElasticEnergy']*=2
        path.write_text(json.dumps(meta))
        with self.assertRaisesRegex(ValueError,'recomputation'):independent.verify_case(case)
        self.assertFalse((case/'skfem-result.json').exists())

    def test_mutated_source_during_solve_prevents_result_publication(self):
        import skfem
        case=self.prepare();solve=skfem.solve
        def mutation(*args,**kwargs):
            result=solve(*args,**kwargs);self.source.write_text(self.source.read_text()+'$ changed\n');return result
        with patch.object(skfem,'solve',side_effect=mutation),self.assertRaisesRegex(ValueError,'Readonly inputs changed'):
            independent.verify_case(case)
        self.assertFalse((case/'skfem-result.json').exists())


if __name__=='__main__':unittest.main()
