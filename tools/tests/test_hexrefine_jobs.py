from pathlib import Path
import hashlib
import json
import os
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hexrefine_jobs import NativeMeshJob

REPO = Path(__file__).resolve().parents[2]
NODE = os.environ["HEXREFINE_NODE"]
BASE = {"schemaVersion": 1, "parameters": {"radius": 16, "height": 8, "coreRadius": 4,
        "radiusSegments": 20, "arcSegments": 32, "axialSegments": 16, "modelFraction": "quarter",
        "rings": [{"innerRadius": 4.5, "outerRadius": 5.5}, {"innerRadius": 8.5, "outerRadius": 10.5}]}}


class Jobs(unittest.TestCase):
    def setUp(self):
        parent = Path(os.environ.get("HEXREFINE_TEST_OUTPUT", tempfile.gettempdir())).resolve()
        self.temp = tempfile.TemporaryDirectory(prefix="native-jobs-", dir=parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def job(self, request=None, name="job"):
        j = NativeMeshJob(REPO, NODE, request or BASE, self.root / name)
        self.addCleanup(lambda: (j.cancel(), j.wait(60)))
        return j

    def test_success_progress_and_certificate(self):
        j = self.job()
        status = j.wait(60)
        self.assertEqual(status["status"], "succeeded", status)
        result = Path(status["output"])
        self.assertEqual(status["result"]["output"], str(result))
        report = json.loads((result / "report.json").read_text())
        self.assertEqual(hashlib.sha256((result / "mesh.k").read_bytes()).hexdigest(), report["readback"]["sha256"])
        self.assertEqual(report["counts"]["elements"], 8256)
        self.assertFalse((j.directory / "working").exists())
        events = [json.loads(s) for s in (j.directory / "events.jsonl").read_text().splitlines()]
        stages = {e.get("stage") for e in events}
        self.assertTrue({"prepare", "audit-complete", "nodes", "elements", "readback", "complete"} <= stages)
        audited = next(e for e in events if e.get("stage") == "audit-complete")
        self.assertEqual(audited["completed"], report["motif"]["elements"])
        self.assertEqual(audited["total"], report["motif"]["elements"])
        for stage in ["nodes", "elements", "readback"]:
            rows = [e for e in events if e.get("stage") == stage]
            self.assertEqual(rows[0]["completed"], 0)
            self.assertEqual(rows[-1]["completed"], rows[-1]["total"])
            self.assertEqual([e["completed"] for e in rows], sorted(e["completed"] for e in rows))
        self.assertFalse(j.cancel())
        copy = j.snapshot()
        copy["status"] = "fake"
        self.assertEqual(j.snapshot()["status"], "succeeded")

    def test_failed_request_does_not_publish_output(self):
        request = json.loads(json.dumps(BASE))
        request["parameters"]["axialSegments"] = 15
        j = self.job(request)
        status = j.wait(60)
        self.assertEqual(status["status"], "failed")
        self.assertIn("divisible", status["error"])
        self.assertIsNone(status["output"])
        self.assertFalse((j.directory / "result").exists())
        self.assertFalse((j.directory / "working").exists())

    def test_cancel_during_prepare_reaps_native_process(self):
        j = self.job()
        j.cancel()
        status = j.wait(60)
        self.assertEqual(status["status"], "cancelled")
        self.assertIsNotNone(j._process.poll())
        self.assertFalse((j.directory / "working").exists())
        self.assertIsNone(status["output"])
        self.assertFalse(j.cancel())

    def test_cancel_during_real_stream_removes_only_own_payload(self):
        request = json.loads(json.dumps(BASE))
        request["parameters"]["height"] = 1600
        request["parameters"]["axialSegments"] = 3200
        sentinel = self.root / "user.k"
        sentinel.write_bytes(b"preserve me")
        j = self.job(request)
        deadline = time.monotonic() + 60
        while j.snapshot()["stage"] not in {"nodes", "elements", "readback"}:
            self.assertEqual(j.snapshot()["status"], "running")
            self.assertLess(time.monotonic(), deadline)
            time.sleep(.005)
        self.assertTrue(j.cancel())
        status = j.wait(60)
        self.assertEqual(status["status"], "cancelled", status)
        self.assertIsNone(status["cleanupWarning"])
        self.assertFalse((j.directory / "working").exists())
        self.assertFalse((j.directory / "result").exists())
        self.assertEqual(sentinel.read_bytes(), b"preserve me")

    def test_existing_file_and_directory_not_overwritten(self):
        directory = self.root / "existing"
        directory.mkdir()
        sentinel = directory / "mesh.k"
        sentinel.write_bytes(b"user")
        with self.assertRaises(FileExistsError):
            NativeMeshJob(REPO, NODE, BASE, directory)
        self.assertEqual(sentinel.read_bytes(), b"user")
        file = self.root / "existing-file"
        file.write_bytes(b"user file")
        with self.assertRaises(FileExistsError):
            NativeMeshJob(REPO, NODE, BASE, file)
        self.assertEqual(file.read_bytes(), b"user file")

    def test_invalid_envelope_and_nan_create_no_job(self):
        for request in [{}, {**BASE, "extra": 1}, {**BASE, "schemaVersion": 2}, {**BASE, "schemaVersion": True}, {**BASE, "parameters": {"bad": float("nan")}}]:
            with self.assertRaises(ValueError):
                NativeMeshJob(REPO, NODE, request, self.root / "invalid")
            self.assertFalse((self.root / "invalid").exists())


if __name__ == "__main__":
    unittest.main()
