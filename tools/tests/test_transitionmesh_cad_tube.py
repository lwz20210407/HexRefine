"""Requires the optional pySMESH CAD environment, Node and a TS build."""
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from pysmesh import Session, EntityKind

REPO = Path(__file__).resolve().parents[2]
PLAN = REPO / "tools" / "plan_transitionmesh_tube.py"


class TransitionTubeCADTest(unittest.TestCase):
    def test_tilted_step_to_real_hexahedra_and_stale_pick_rejection(self):
        with tempfile.TemporaryDirectory(prefix="tube-cad-",dir=os.environ.get("CAD_TEST_ROOT")) as d:
            root=Path(d)
            cad=Session()
            cad.add_cylinder(7,12,origin=(1,2,3),axis=(0,1,1))
            outer=cad.entities(EntityKind.SOLID)[0]
            cad.add_cylinder(4,12,origin=(1,2,3),axis=(0,1,1))
            inner=next(n for n in cad.entities(EntityKind.SOLID) if n!=outer)
            cad.cut([outer],[inner])
            file=root/"tube.step"
            file.write_bytes(cad.write_step(unit="MM",face_names={}))
            sha=hashlib.sha256(file.read_bytes()).hexdigest()

            def run(*args):
                return subprocess.run([sys.executable,"-B",str(PLAN),*args],
                                      cwd=root,capture_output=True,text=True,timeout=60)

            inspected=run("inspect",str(file))
            self.assertEqual(inspected.returncode,0,inspected.stderr)
            tube=json.loads(inspected.stdout)
            self.assertAlmostEqual(tube["cadVolume"],math.pi*33*12,8)
            self.assertAlmostEqual(abs(tube["axis"][1]),math.sqrt(.5),10)
            args=["plan",str(file),"--fine-face",str(tube["caps"][0]["faceId"]),
                  "--ratios","2","2","2","--target-arc-size","0.7","--fine-regular-width","2",
                  "--fine-regular-layers","3","--coarse-regular-width","4",
                  "--stage-depths","1","2","3"]
            self.assertNotEqual(run(*args,"--expected-sha256","0"*64).returncode,0)
            accepted=run(*args,"--expected-sha256",sha)
            self.assertEqual(accepted.returncode,0,accepted.stderr)
            (root/"request.json").write_text(accepted.stdout,encoding="utf-8")
            generated=subprocess.run(["node",str(REPO/"scripts"/"generate-transition-band.mjs"),
                                      "request.json","mesh"],cwd=root,capture_output=True,text=True,timeout=60)
            self.assertEqual(generated.returncode,0,generated.stderr)
            report=json.loads((root/"mesh"/"report.json").read_text())
            self.assertEqual(report["plan"]["counts"],[64,32,16,8])
            self.assertEqual(report["elements"],736)
            self.assertGreater(report["quality"]["minimumGaussDeterminant"],0)
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(),sha)


if __name__=="__main__":
    unittest.main()
