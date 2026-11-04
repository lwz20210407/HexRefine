from dataclasses import replace
import json,os,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from tools.bolthex.native_joint import NativeJointSpec,plan_native_joint
from tools.bolthex.joint_seed_plan import JointAxialSpec


class NativeJointPlanTests(unittest.TestCase):
    def test_count_and_compensation_do_not_construct_meshes(self):
        with patch('tools.bolthex.native_joint._sweep',side_effect=AssertionError('Must not sweep')),patch('tools.bolthex.native_joint.build_bolt_section',side_effect=AssertionError('Must not build section')):
            self.assertEqual(plan_native_joint()['estimatedElements'],10440)
            plan=plan_native_joint(NativeJointSpec(axial=JointAxialSpec(thread_length=16.1,nut_height=13.1,shank_length=8.2)))
        self.assertEqual(plan['estimatedElements'],53592)
        self.assertEqual(plan['axial']['seeds']['axialPerPitch'],20)
        self.assertFalse(plan['qualityVerified']);self.assertFalse(plan['fullMeshVerified'])
        self.assertFalse(plan['axial']['axialDimensionsChanged'])
        self.assertEqual(sum(p['elements'] for p in plan['parts']),53592)
        json.dumps(plan,allow_nan=False)

    def test_incompatible_dimensions_and_budgets_reject_during_plan(self):
        for kwargs in (dict(element_limit=1),dict(plate_x=20),dict(sector=5),dict(connection_mode='auto')):
            with self.subTest(kwargs=kwargs),self.assertRaises(ValueError):plan_native_joint(replace(NativeJointSpec(),**kwargs))

    @unittest.skipUnless(os.environ.get('BOLTHEX_TEST_ROOT'),'Explicit task output root required')
    def test_cli_plan_needs_no_node_or_output_directory(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as directory:
            source=Path(directory)/'request.json';source.write_text(json.dumps(dict(schemaVersion=1,parameters={})))
            result=subprocess.run([sys.executable,'-B','-m','tools.bolthex.native_joint',str(source),'--plan-only'],
                                  cwd=Path(__file__).resolve().parents[2],capture_output=True,text=True,check=True,timeout=30)
            self.assertEqual(json.loads(result.stdout)['estimatedElements'],10440)
            self.assertEqual(list(Path(directory).iterdir()),[source])
