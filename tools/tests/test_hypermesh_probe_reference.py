import hashlib,json,os,tempfile,unittest
from pathlib import Path
from tools.hypermesh_probe_reference import offset_points,build_reference


class ProbeReferenceTests(unittest.TestCase):
    def test_local_offsets_are_explicit_and_keep_other_coordinates(self):
        result=list(offset_points([1,2,3],[.00002,.0002,.02]))
        self.assertEqual(len(result),18)
        for point,axis,offset in result:
            self.assertAlmostEqual(point[axis]-[1,2,3][axis],offset)
            self.assertTrue(all(point[i]==[1,2,3][i] for i in range(3) if i!=axis))

    def test_invalid_or_excessive_offsets_reject(self):
        for steps in ([],[True],[float('nan')],[0],[2],[.01]*7):
            with self.subTest(steps=steps),self.assertRaises(ValueError):list(offset_points([0,0,0],steps))

    @unittest.skipUnless(os.environ.get('BOLTHEX_TEST_ROOT'),'Explicit task output root required')
    def test_stale_hash_and_invalid_focus_do_not_create_outputs(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as directory:
            root=Path(directory);step=root/'source.step';step.write_text('Not parsed in rejected preflight')
            source=root/'source.json';output=root/'result.json'
            reference=dict(sourceStepSHA256='stale',points=[dict(point=[0,0,0],role='surface',sourceDistance=0),dict(point=[0,0,1],role='control',sourceDistance=1)])
            source.write_text(json.dumps(reference))
            with self.assertRaisesRegex(ValueError,'hash differs'):build_reference(step,source,output,[0])
            reference['sourceStepSHA256']=hashlib.sha256(step.read_bytes()).hexdigest();source.write_text(json.dumps(reference))
            for focus in ([],[True],[[0]],[0,0],[1],[2]):
                with self.subTest(focus=focus),self.assertRaises(ValueError):build_reference(step,source,output,focus)
            self.assertFalse(output.exists())
