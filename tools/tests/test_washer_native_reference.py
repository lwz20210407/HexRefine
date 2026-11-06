"""Real CAD reference construction with small fixtures and optional saved sources."""

import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from tools.bolthex import flat_washer as washer
from tools.bolthex import washer_native_reference as reference


class WasherNativeReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = os.environ.get("WASHER_REFERENCE_TEST_ROOT")
        if not root or not Path(root).is_dir():
            raise RuntimeError("Set WASHER_REFERENCE_TEST_ROOT to an existing task scratch directory")
        cls.scratch = tempfile.TemporaryDirectory(prefix="reference-tests-", dir=root)
        cls.addClassCleanup(cls.scratch.cleanup)
        cls.root = Path(cls.scratch.name)
        cls.sources = []
        for i, (env, design, seeds) in enumerate((
            ("WASHER_REFERENCE_SOURCE", washer.WasherDesign(10., 4., 1.1), washer.WasherSeeds(258, 1, 1)),
            ("WASHER_REFERENCE_SMALL_SOURCE", washer.WasherDesign(18., 9., 2.3), washer.WasherSeeds(264, 2, 2)),
        )):
            value = os.environ.get(env)
            source = Path(value) if value else cls.root / f"generated-{i}"
            if not value:
                washer.generate(design, source, seeds)
            cls.sources.append(source)

    def setUp(self):
        self.scratch_case = tempfile.TemporaryDirectory(dir=self.root)
        self.addCleanup(self.scratch_case.cleanup)
        self.case = Path(self.scratch_case.name)
        self.output = self.case / "native-reference.json"

    @staticmethod
    def hashes(source):
        return {p.name: reference.sha(p) for p in source.iterdir() if p.is_file()}

    def prepare(self, source=None, **kwargs):
        source = self.sources[1] if source is None else source
        before = self.hashes(source)
        try:
            return reference.prepare_reference(source, self.output, **kwargs)
        finally:
            self.assertEqual(self.hashes(source), before)

    def clone(self, name="copy"):
        source = self.case / name
        source.mkdir()
        for file in ("model.k", "model.step", "report.json", "cad-report.json"):
            shutil.copyfile(self.sources[1] / file, source / file)
        return source

    @staticmethod
    def update(source, filename, change):
        path = source / filename
        document = json.loads(path.read_text())
        change(document)
        path.write_text(json.dumps(document), encoding="utf-8")

    def rebind_k(self, source):
        digest = reference.sha(source / "model.k")
        self.update(source, "report.json", lambda d: d.update(kSHA256=digest, hashes={**d["hashes"], "model.k": digest}))
        self.update(source, "cad-report.json", lambda d: d.update(matchedKSHA256=digest))

    def test_two_dimensions_and_seeds_use_actual_source_data(self):
        designs, seeds = [], []
        for i, source in enumerate(self.sources):
            self.output = self.case / f"reference-{i}.json"
            result = self.prepare(source, maximum_boundary_nodes=17)
            original = json.loads((source / "report.json").read_text())
            self.assertEqual(result["design"], original["design"])
            self.assertEqual(result["seeds"], original["seeds"])
            self.assertEqual(result["sourceStepSHA256"], reference.sha(source / "model.step"))
            self.assertEqual(result["sourceKSHA256"], reference.sha(source / "model.k"))
            self.assertEqual(json.loads(self.output.read_text()), result)
            self.assertEqual(result["sampling"]["sampledBoundaryNodes"], 17)
            self.assertLessEqual(len(result["points"]), 4096)
            self.assertLessEqual(self.output.stat().st_size, 2 * 1024 * 1024)
            self.assertFalse(result["fullModelAcceptance"])
            self.assertFalse(result["exactNativeCadCertified"])
            reference.validate_reference(result)
            designs.append(result["design"])
            seeds.append(result["seeds"])
        self.assertNotEqual(designs[0], designs[1])
        self.assertNotEqual(seeds[0], seeds[1])

    def test_witnesses_are_inside_each_physical_face_and_avoid_seams(self):
        result = self.prepare(maximum_boundary_nodes=4)
        d = result["design"]
        ri, ro, height = d["inner_diameter_mm"]/2, d["outer_diameter_mm"]/2, d["thickness_mm"]
        seen = set()
        for row in result["points"]:
            if row["role"] != "source-face-interior":
                continue
            name = row["physicalFace"]
            x, y, z = row["point"]
            radius = math.hypot(x, y)
            seen.add(name)
            if name in ("INNER", "OUTER"):
                self.assertGreater(z, 0)
                self.assertLess(z, height)
                self.assertAlmostEqual(radius, ri if name == "INNER" else ro)
                self.assertGreater(abs(math.atan2(y, x)), 1e-6)
            else:
                self.assertGreater(radius, ri)
                self.assertLess(radius, ro)
                self.assertEqual(z, 0 if name == "BOTTOM" else height)
        self.assertEqual(seen, set(reference.PHYSICAL_FACES))

    def test_actual_node_ids_coordinates_and_free_face_membership(self):
        result = self.prepare(maximum_boundary_nodes=1024)
        mesh = reference._source_mesh((self.sources[1]/"model.k").read_bytes())
        boundary, _, _ = reference._boundary(mesh, washer.plan(result["design"], result["seeds"]))
        ids = set(mesh.node_ids[boundary])
        rows = [p for p in result["points"] if p["role"] == "mesh-boundary-node"]
        self.assertEqual(len(rows), min(1024, len(ids)))
        self.assertEqual(len({p["nodeID"] for p in rows}), len(rows))
        for row in rows:
            self.assertIn(row["nodeID"], ids)
            np.testing.assert_array_equal(row["point"], mesh.nodes[np.searchsorted(mesh.node_ids, row["nodeID"])])

    def test_reordered_noncontiguous_real_nids_survive(self):
        source = self.clone()
        mesh = reference._source_mesh((source/"model.k").read_bytes())
        remap = lambda n: int(n)*3+17
        lines = ["*KEYWORD", "*NODE"]
        for nid, point in zip(mesh.node_ids[::-1], mesh.nodes[::-1]):
            lines.append(",".join([str(remap(nid)), *(format(v, ".17g") for v in point)]))
        lines.append("*ELEMENT_SOLID")
        for eid, pid, conn in zip(mesh.element_ids[::-1], mesh.part_ids[::-1], mesh.elements[::-1]):
            lines.extend([f"{int(eid)},{int(pid)}", ",".join(str(remap(n)) for n in conn)])
        (source/"model.k").write_text("\n".join(lines+["*END", ""]), encoding="ascii")
        self.rebind_k(source)
        result = self.prepare(source, maximum_boundary_nodes=19)
        selected = [p["nodeID"] for p in result["points"] if p["role"] == "mesh-boundary-node"]
        self.assertTrue(all(n > 17 and (n-17) % 3 == 0 for n in selected))
        self.assertEqual(selected, sorted(selected))

    def test_controls_recomputed_to_trimmed_cad_not_displacement(self):
        from build123d import import_step
        result = self.prepare(maximum_boundary_nodes=1)
        distance = reference.TrimmedFaceDistances(import_step(self.sources[1]/"model.step"))
        controls = [p for p in result["points"] if p["role"] == "control"]
        near = [p for p in controls if p["controlClass"] == "near"]
        self.assertGreaterEqual(len(near), 6)
        self.assertTrue(all(4e-6 < p["sourceDistance"] < .001 for p in near))
        for row in controls:
            self.assertAlmostEqual(row["sourceDistance"], distance(row["point"]), delta=1e-12)
        bore = next(p for p in controls if p["controlClass"] == "trim-bore")
        self.assertAlmostEqual(bore["sourceDistance"], result["design"]["inner_diameter_mm"]/2, delta=1e-10)
        self.assertTrue(any(p["sourceDistance"] > .02 for p in controls))

    def test_measured_control_distance_is_not_replaced_by_offset(self):
        original = reference.TrimmedFaceDistances

        def calibrated(shape):
            distance = original(shape)
            def measure(point):
                value = distance(point)
                return value + 1e-7 if value > 4e-6 else value
            return measure

        with patch.object(reference, "TrimmedFaceDistances", side_effect=calibrated):
            result = self.prepare(maximum_boundary_nodes=1)
        near = [p for p in result["points"] if p.get("controlClass") == "near"]
        self.assertTrue(all(abs(p["sourceDistance"] - abs(p["offsetMM"])) > 5e-8 for p in near))

    def test_existing_output_and_source_directory_are_immutable(self):
        self.output.write_text("owned by someone else")
        with self.assertRaisesRegex(ValueError, "new reference"):
            self.prepare()
        self.assertEqual(self.output.read_text(), "owned by someone else")
        source = self.clone()
        with self.assertRaisesRegex(ValueError, "outside the immutable"):
            reference.prepare_reference(source, source/"another-reference.json")
        self.assertFalse((source/"another-reference.json").exists())

    def test_invalid_budget_rejected_before_source_read(self):
        for budget in (True, False, 0, -1, 1025, 2.5, "12", None, math.nan, math.inf):
            with self.subTest(budget=budget), patch.object(reference, "_read_bounded") as reader:
                with self.assertRaisesRegex(ValueError, "maximum_boundary_nodes"):
                    reference.prepare_reference(self.sources[1], self.output, maximum_boundary_nodes=budget)
                reader.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_forged_hash_bindings_rejected(self):
        cases = [("report.json", "kSHA256"), ("report.json", "sourceStepSHA256"),
                 ("cad-report.json", "stepSHA256"), ("cad-report.json", "matchedKSHA256")]
        for i, (file, key) in enumerate(cases):
            source = self.clone(str(i))
            self.update(source, file, lambda d: d.update({key: "0"*64}))
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "hash mismatch"):
                self.prepare(source)
        source = self.clone("hashes")
        self.update(source, "report.json", lambda d: d["hashes"].update({"model.step": "f"*64}))
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            self.prepare(source)
        self.assertFalse(self.output.exists())

    def test_certificate_design_flags_counts_and_volume_must_match(self):
        cases = [("cad-report.json", lambda d: d["request"].update(thickness_mm=4.)),
                 ("cad-report.json", lambda d: d.update(geometryIndependentOfMesh=False)),
                 ("report.json", lambda d: d.update(nodes=d["nodes"]+1)),
                 ("cad-report.json", lambda d: d.update(meshVolume=d["meshVolume"]*1.01)),
                 ("cad-report.json", lambda d: d.update(relativeMeshVolumeError=0.)),
                 ("cad-report.json", lambda d: d.update(solids=True)),
                 ("report.json", lambda d: d.update(plan=[])),
                 ("report.json", lambda d: d["plan"]["seeds"].update(radial=3))]
        for i, (file, change) in enumerate(cases):
            source = self.clone(str(i))
            self.update(source, file, change)
            with self.subTest(i=i), self.assertRaises(ValueError):
                self.prepare(source)
        self.assertFalse(self.output.exists())

    def test_nonfinite_certificate_and_node_fields_rejected(self):
        for i, value in enumerate((math.nan, math.inf, -math.inf)):
            source = self.clone(str(i))
            self.update(source, "report.json", lambda d: d["design"].update(thickness_mm=value))
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "Nonfinite"):
                self.prepare(source)
        source = self.clone("node")
        lines = (source/"model.k").read_text().splitlines()
        index = next(i+1 for i, line in enumerate(lines) if line == "*NODE")
        while lines[index].startswith("$"):
            index += 1
        lines[index] = lines[index][:8] + f"{'nan':>16}" + lines[index][24:]
        (source/"model.k").write_text("\n".join(lines)+"\n")
        self.rebind_k(source)
        with self.assertRaisesRegex(ValueError, "finite coordinate"):
            self.prepare(source)
        self.assertFalse(self.output.exists())

    def test_nonfinite_measured_distance_rejected(self):
        with patch.object(reference, "TrimmedFaceDistances", return_value=lambda p: math.nan):
            with self.assertRaisesRegex(ValueError, "Nonfinite"):
                self.prepare(maximum_boundary_nodes=1)
        self.assertFalse(self.output.exists())

    def test_source_boundary_sample_over_fixed_limit_rejected(self):
        source = self.sources[1]
        mesh = reference._source_mesh((source/"model.k").read_bytes())
        node_points = {tuple(p) for p in mesh.nodes}
        original = reference.TrimmedFaceDistances

        def off_cad_nodes(shape):
            distance = original(shape)
            return lambda p: 3e-6 if tuple(p) in node_points else distance(p)

        with patch.object(reference, "TrimmedFaceDistances", side_effect=off_cad_nodes):
            with self.assertRaisesRegex(ValueError, "boundary-node sample exceeds 2e-6"):
                self.prepare(maximum_boundary_nodes=1)
        self.assertFalse(self.output.exists())

    def test_wrong_actual_step_rejected_even_with_rebound_hash(self):
        source = self.clone()
        shutil.copyfile(self.sources[0]/"model.step", source/"model.step")
        digest = reference.sha(source/"model.step")
        self.update(source, "report.json", lambda d: d.update(sourceStepSHA256=digest, hashes={**d["hashes"], "model.step": digest}))
        self.update(source, "cad-report.json", lambda d: d.update(stepSHA256=digest))
        with self.assertRaises(ValueError):
            self.prepare(source, maximum_boundary_nodes=1)
        self.assertFalse(self.output.exists())

    def test_reference_output_byte_limit_is_enforced(self):
        with patch.object(reference, "MAX_REFERENCE_BYTES", 65536):
            with self.assertRaisesRegex(ValueError, "Reference exceeds 2 MiB"):
                self.prepare(maximum_boundary_nodes=1024)
        self.assertFalse(self.output.exists())

    def test_input_change_during_publication_leaves_no_reference(self):
        source = self.clone()
        original = reference.os.fsync

        def mutate(fd):
            original(fd)
            path = source/"report.json"
            path.write_bytes(path.read_bytes()+b"\n")

        with patch.object(reference.os, "fsync", side_effect=mutate), patch.object(reference.os, "link") as publish:
            with self.assertRaisesRegex(ValueError, "Source changed"):
                reference.prepare_reference(source, self.output, maximum_boundary_nodes=1)
            publish.assert_not_called()
        self.assertFalse(self.output.exists())
        self.assertFalse(list(self.case.glob(".washer-reference-*")))

    def test_cli_success_then_existing_output_rejection(self):
        repo = Path(__file__).resolve().parents[2]
        command = [sys.executable, "-B", "-m", "tools.bolthex.washer_native_reference",
                   str(self.sources[1]), str(self.output), "--maximum-boundary-nodes", "5"]
        first = subprocess.run(command, cwd=repo, capture_output=True, text=True, timeout=120)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(json.loads(first.stdout)["sampledBoundaryNodes"], 5)
        before = self.output.read_bytes()
        second = subprocess.run(command, cwd=repo, capture_output=True, text=True, timeout=120)
        self.assertEqual(second.returncode, 1)
        self.assertFalse(json.loads(second.stderr)["prepared"])
        self.assertEqual(self.output.read_bytes(), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
