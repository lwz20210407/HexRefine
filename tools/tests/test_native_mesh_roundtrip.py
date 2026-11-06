"""Small read-only IO acceptance fixtures; set NATIVE_MESH_TEST_ROOT explicitly."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import numpy as np

from tools import verify_native_mesh_roundtrip as verifier


POINTS = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0),
          (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]
NODE_IDS = [11, 23, 35, 47, 59, 61, 73, 89]
ROWS = [[101, 7, *NODE_IDS], [305, 9, *NODE_IDS]]


def deck(*, two_line=False, reverse=False, split=False, points=None, rows=None, ids=None):
    points = POINTS if points is None else points
    ids = NODE_IDS if ids is None else ids
    nodes = [f"{nid:8d}" + "".join(f"{v:16.12g}" for v in xyz) for nid, xyz in zip(ids, points)]
    rows = list(ROWS if rows is None else rows)
    if reverse:
        nodes.reverse()
        rows.reverse()
    lines = ["*KEYWORD", "*NODE"]
    for i, line in enumerate(nodes):
        if split and i:
            lines.append("*NODE")
        lines.append(line)
    for i, row in enumerate(rows):
        if not i or split:
            lines.append("*ELEMENT_SOLID")
        if two_line:
            lines.extend(["".join(f"{v:8d}" for v in row[:2]), "".join(f"{v:8d}" for v in row[2:])])
        else:
            lines.append("".join(f"{v:8d}" for v in row))
    return "\n".join(lines + ["*END", ""])


def inp(*, reverse=False, rows=None, ids=None, points=None):
    ids = NODE_IDS if ids is None else ids
    points = POINTS if points is None else points
    nodes = [f"{nid}," + ",".join(str(v) for v in xyz) for nid, xyz in zip(ids, points)]
    rows = list(ROWS if rows is None else rows)
    if reverse:
        nodes.reverse()
        rows.reverse()
    lines = ["*HEADING", "Independent mesh", "*PART,NAME=BLOCK", "*NODE", *nodes]
    for row in rows:
        lines.extend(["*ELEMENT,TYPE=C3D8", ",".join(str(v) for v in [row[0], *row[2:]])])
    return "\n".join(lines + ["*END PART", ""])


class NativeMeshRoundtripTests(unittest.TestCase):
    def setUp(self):
        root = os.environ.get("NATIVE_MESH_TEST_ROOT")
        if not root or not Path(root).is_dir():
            self.fail("Set NATIVE_MESH_TEST_ROOT to an existing task scratch directory")
        self.directory = tempfile.TemporaryDirectory(prefix="fixture-", dir=root)
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / "source.k"
        self.native = self.root / "native.k"
        self.report = self.root / "report.json"
        self.source.write_text(deck(), encoding="ascii")
        self.native.write_text(deck(two_line=True), encoding="ascii")

    def hashes(self):
        return {str(p): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in self.root.iterdir() if p.suffix in {".k", ".inp"}}

    def verify(self, **kwargs):
        before = self.hashes()
        try:
            return verifier.verify_native_mesh_roundtrip(self.source, self.native,
                                                         report_path=self.report, **kwargs)
        finally:
            self.assertEqual(before, self.hashes())

    def reject(self, pattern, **kwargs):
        with self.assertRaisesRegex(verifier.AcceptanceError, pattern) as raised:
            self.verify(**kwargs)
        self.assertFalse(self.report.exists(), "Failure must not publish an acceptance report")
        return raised.exception

    def test_equivalent_one_line_and_two_line(self):
        report = self.verify()
        self.assertTrue(report["passed"])
        self.assertEqual(report["meshes"]["native_k"]["actual_element_type"], "H8")
        self.assertEqual(report["meshes"]["native_k"]["empty_optional_columns"], ["n9", "n10"])
        self.assertEqual(report["comparisons"][0]["max_coordinate_difference_mm"], 0)
        self.assertEqual(report["inputs"]["native_k"]["sha256"], self.hashes()[str(self.native)])
        self.assertEqual(json.loads(self.report.read_text()), report)

    def test_reordered_rows_and_multiple_node_solid_cards(self):
        self.native.write_text(deck(two_line=True, reverse=True, split=True), encoding="ascii")
        report = self.verify()
        self.assertEqual(report["meshes"]["native_k"]["node_cards"], 8)
        self.assertEqual(report["meshes"]["native_k"]["solid_cards"], 2)
        snap = verifier.Snapshot.read(self.native)
        mesh = verifier.load_k(snap, verifier.preflight_k(snap.text()))
        np.testing.assert_array_equal(mesh.node_ids, NODE_IDS)
        np.testing.assert_array_equal(mesh.element_ids, [101, 305])
        np.testing.assert_array_equal(mesh.part_ids, [7, 9])
        np.testing.assert_array_equal(mesh.elements, [NODE_IDS, NODE_IDS])

    def test_fixed_absolute_tolerance_accepts_boundary(self):
        points = list(POINTS)
        points[0] = (1e-10, 0, 0)
        self.native.write_text(deck(two_line=True, points=points), encoding="ascii")
        self.assertEqual(self.verify()["comparisons"][0]["max_coordinate_difference_mm"], 1e-10)

    def test_changed_coordinates_reports_numbers_no_output(self):
        points = list(POINTS)
        points[0] = (1.01e-10, 0, 0)
        self.native.write_text(deck(two_line=True, points=points), encoding="ascii")
        exc = self.reject("acceptance failed")
        comparison = exc.details["comparisons"][0]
        self.assertGreater(comparison["max_coordinate_difference_mm"], 1e-10)
        self.assertEqual(comparison["coordinates_over_tolerance"], 1)

    def test_no_relative_tolerance_at_large_coordinates(self):
        source = list(POINTS)
        source[0] = (1000000, 0, 0)
        native = list(source)
        native[0] = (1000000.001, 0, 0)
        self.source.write_text(deck(points=source), encoding="ascii")
        self.native.write_text(deck(two_line=True, points=native), encoding="ascii")
        self.reject("acceptance failed")

    def test_coordinate_subtraction_overflow_rejected(self):
        source = list(POINTS)
        native = list(POINTS)
        source[0], native[0] = (1e308, 0, 0), (-1e308, 0, 0)
        self.source.write_text(deck(points=source), encoding="ascii")
        self.native.write_text(deck(two_line=True, points=native), encoding="ascii")
        exc = self.reject("acceptance failed")
        self.assertEqual(exc.details["comparisons"][0]["max_coordinate_difference_mm"], "overflow")
        json.dumps(exc.details, allow_nan=False)

    def test_changed_slot_connectivity(self):
        rows = [list(row) for row in ROWS]
        rows[0][2], rows[0][3] = rows[0][3], rows[0][2]
        self.native.write_text(deck(two_line=True, rows=rows), encoding="ascii")
        exc = self.reject("acceptance failed")
        self.assertEqual(exc.details["comparisons"][0]["connectivity_slot_mismatches"], 2)

    def test_changed_pid(self):
        rows = [list(row) for row in ROWS]
        rows[0][1] = 8
        self.native.write_text(deck(two_line=True, rows=rows), encoding="ascii")
        exc = self.reject("acceptance failed")
        self.assertEqual(exc.details["comparisons"][0]["part_id_mismatches"], 1)

    def test_changed_eid(self):
        rows = [list(row) for row in ROWS]
        rows[0][0] = 102
        self.native.write_text(deck(two_line=True, rows=rows), encoding="ascii")
        self.reject("acceptance failed")

    def test_duplicate_node_across_cards(self):
        ids = NODE_IDS[:-1] + [NODE_IDS[0]]
        self.native.write_text(deck(two_line=True, split=True, ids=ids), encoding="ascii")
        self.reject("Duplicate node IDs")

    def test_duplicate_element_across_cards(self):
        self.native.write_text(deck(two_line=True, split=True, rows=[ROWS[0], ROWS[0]]), encoding="ascii")
        self.reject("Duplicate element IDs")

    def test_missing_node_reference(self):
        rows = [list(row) for row in ROWS]
        rows[0][2] = 999
        self.native.write_text(deck(two_line=True, rows=rows), encoding="ascii")
        self.reject("Missing node references")

    def test_missing_node_or_element_id(self):
        for needle in (f"{11:8d}", f"{101:8d}"):
            with self.subTest(needle=needle):
                self.native.write_text(deck(two_line=True).replace(needle, " " * 8, 1), encoding="ascii")
                self.reject("Missing/malformed positive integer ID")

    def test_non_finite_and_missing_coordinate(self):
        for value in ("nan", "inf", "-inf", ""):
            with self.subTest(value=value):
                text = deck(two_line=True).replace(f"{11:8d}{0:16.12g}", f"{11:8d}{value:>16}", 1)
                self.native.write_text(text, encoding="ascii")
                self.reject("coordinate")

    def test_actual_higher_order_nodes_rejected_including_zero(self):
        for extra in (0, 123):
            with self.subTest(extra=extra):
                text = deck(two_line=True).replace("".join(f"{v:8d}" for v in NODE_IDS),
                                                    "".join(f"{v:8d}" for v in NODE_IDS) + f"{extra:8d}", 1)
                self.native.write_text(text, encoding="ascii")
                self.reject("Nonempty n9/n10")

    def test_collapsed_non_h8_rejected(self):
        rows = [list(row) for row in ROWS]
        rows[0][-1] = rows[0][-2]
        self.native.write_text(deck(two_line=True, rows=rows), encoding="ascii")
        self.reject("Non-H8")

    def test_unsupported_keywords_before_pydyna(self):
        for keyword in ("*INCLUDE", "*INCLUDE_TRANSFORM", "*NODE_TRANSFORM", "*ELEMENT_SHELL",
                        "*PARAMETER", "*MAT_ELASTIC", "*KEYWORD LONG=Y"):
            with self.subTest(keyword=keyword), mock.patch.object(verifier, "load_k") as loader:
                self.native.write_text(deck(two_line=True).replace("*END", keyword + "\n*END"), encoding="ascii")
                self.reject("Unsupported keyword")
                loader.assert_not_called()

    def test_malformed_two_line_and_missing_end(self):
        for text in (deck(two_line=True).replace("*END", ""),
                     deck(two_line=True).replace("*END", "     306       1\n*END"),
                     deck(two_line=True) + "*NODE\n1,0,0,0\n"):
            with self.subTest(text=text[-60:]):
                self.native.write_text(text, encoding="ascii")
                self.reject("Missing|Incomplete|after")

    def test_byte_limit_before_reader(self):
        with self.native.open("wb") as stream:
            stream.truncate(verifier.MAX_K_BYTES + 1)
        with mock.patch.object(verifier, "load_k") as loader:
            self.reject("64 MiB")
            loader.assert_not_called()

    def test_element_limit_before_reader(self):
        text = "*KEYWORD\n*NODE\n1,0,0,0\n*ELEMENT_SOLID\n" + (
            "       1       1       1       2       3       4       5       6       7       8\n" * (verifier.MAX_H8 + 1)) + "*END\n"
        self.native.write_text(text, encoding="ascii")
        with mock.patch.object(verifier, "load_k") as loader:
            self.reject("200000")
            loader.assert_not_called()

    def test_existing_output_is_not_overwritten(self):
        self.report.write_text("other worker report", encoding="ascii")
        with self.assertRaisesRegex(verifier.AcceptanceError, "fresh path"):
            self.verify()
        self.assertEqual(self.report.read_text(), "other worker report")

    def test_publication_error_leaves_no_output_or_temporary(self):
        with mock.patch.object(verifier.os, "link", side_effect=OSError("fixture publication failure")):
            self.reject("Cannot exclusively create report")
        self.assertFalse(list(self.root.glob(".roundtrip-*")))

    def test_source_changes_during_temporary_write_blocks_publication(self):
        original_fsync = verifier.os.fsync

        def fsync_and_mutate_source(fd):
            original_fsync(fd)
            temporary = list(self.root.glob(".roundtrip-*"))
            self.assertEqual(len(temporary), 1)
            self.assertTrue(json.loads(temporary[0].read_text())["passed"])
            self.assertFalse(self.report.exists())
            self.source.write_bytes(self.source.read_bytes() + b"$ changed while writing report\n")

        with mock.patch.object(verifier.os, "fsync", side_effect=fsync_and_mutate_source), \
                mock.patch.object(verifier.os, "link", wraps=verifier.os.link) as publish:
            with self.assertRaisesRegex(verifier.AcceptanceError, "Input changed"):
                verifier.verify_native_mesh_roundtrip(self.source, self.native, report_path=self.report)
            publish.assert_not_called()
        self.assertFalse(self.report.exists())
        self.assertFalse(list(self.root.glob(".roundtrip-*")))

    def test_published_report_survives_owned_temporary_unlink_failure(self):
        original_unlink = Path.unlink
        retained = []

        def fail_owned_temporary_unlink(path, *args, **kwargs):
            if path.parent == self.root and path.name.startswith(".roundtrip-"):
                self.assertTrue(self.report.exists())
                retained.append(path)
                raise PermissionError("fixture temporary file is busy")
            return original_unlink(path, *args, **kwargs)

        with mock.patch.object(Path, "unlink", autospec=True, side_effect=fail_owned_temporary_unlink):
            report = self.verify()
        self.assertTrue(report["passed"])
        self.assertEqual(json.loads(self.report.read_text()), report)
        self.assertEqual(len(retained), 1)
        self.assertEqual(list(self.root.glob(".roundtrip-*")), retained)
        self.assertTrue(retained[0].samefile(self.report))
        self.assertEqual(retained[0].read_bytes(), self.report.read_bytes())

    def test_reader_exception_does_not_touch_files(self):
        with mock.patch.object(verifier, "load_k", side_effect=RuntimeError("fixture reader error")):
            self.reject("Unsupported/malformed input")

    def test_missing_node_row_and_element_row(self):
        self.native.write_text(deck(two_line=True, rows=ROWS[:1]), encoding="ascii")
        exc = self.reject("acceptance failed")
        self.assertEqual(exc.details["comparisons"][0]["element_id_difference"]["missing_sample"], [305])
        self.native.write_text(deck(two_line=True, points=POINTS[:-1], ids=NODE_IDS[:-1]), encoding="ascii")
        self.reject("Missing node references")

    def test_mixed_one_line_two_line_cards_and_comma_format(self):
        text = deck(two_line=True, split=True)
        pair = "".join(f"{v:8d}" for v in ROWS[0][:2]) + "\n" + "".join(f"{v:8d}" for v in ROWS[0][2:])
        text = text.replace(pair, ",".join(str(v) for v in ROWS[0]), 1)
        self.native.write_text(text, encoding="ascii")
        self.assertEqual(self.verify()["meshes"]["native_k"]["solid_layouts"], ["one-line", "two-line"])

    def test_mixed_layout_within_one_card_rejected(self):
        text = deck(two_line=True)
        pair = "".join(f"{v:8d}" for v in ROWS[0][:2]) + "\n" + "".join(f"{v:8d}" for v in ROWS[0][2:])
        self.native.write_text(text.replace(pair, "".join(f"{v:8d}" for v in ROWS[0]), 1), encoding="ascii")
        self.reject("Missing/malformed")

    def test_missing_file_and_non_ascii_rejected(self):
        with self.assertRaises(verifier.AcceptanceError):
            verifier.verify_native_mesh_roundtrip(self.root / "missing.k", self.native, report_path=self.report)
        self.assertFalse(self.report.exists())
        self.native.write_bytes(b"\xff" + deck(two_line=True).encode("ascii"))
        self.reject("non-ASCII")

    def test_large_exact_ids_are_preserved(self):
        ids = [1000001 + n for n in NODE_IDS]
        rows = [[7000001, 1000001, *ids]]
        self.source.write_text(deck(ids=ids, rows=rows), encoding="ascii")
        self.native.write_text(deck(two_line=True, ids=ids, rows=rows), encoding="ascii")
        self.assertTrue(self.verify()["passed"])

    def test_same_source_native_file_rejected(self):
        with self.assertRaisesRegex(verifier.AcceptanceError, "distinct files"):
            verifier.verify_native_mesh_roundtrip(self.source, self.source, report_path=self.report)
        self.assertFalse(self.report.exists())

    def test_mutation_detected_before_publication(self):
        original = verifier.compare

        def mutate(*args):
            self.native.write_bytes(self.native.read_bytes() + b"$ concurrent change\n")
            return original(*args)

        with mock.patch.object(verifier, "compare", side_effect=mutate):
            with self.assertRaisesRegex(verifier.AcceptanceError, "Input changed"):
                verifier.verify_native_mesh_roundtrip(self.source, self.native, report_path=self.report)
        self.assertFalse(self.report.exists())

    def test_input_disappears_before_publication(self):
        original = verifier.compare

        def remove_fixture(*args):
            self.native.unlink()
            return original(*args)

        with mock.patch.object(verifier, "compare", side_effect=remove_fixture):
            with self.assertRaisesRegex(verifier.AcceptanceError, "Input changed or became unreadable"):
                verifier.verify_native_mesh_roundtrip(self.source, self.native, report_path=self.report)
        self.assertFalse(self.report.exists())

    def test_pydyna_warning_rejected(self):
        from ansys.dyna.core import Deck
        original = Deck.loads

        def load_warning(instance, text):
            result = original(instance, text)
            result.add_warning("fixture warning")
            return result

        with mock.patch.object(Deck, "loads", load_warning):
            self.reject("PyDYNA load warnings")

    def test_independent_inp_reordered_labels_and_blocks(self):
        source_inp = self.root / "source.inp"
        source_inp.write_text(inp(reverse=True), encoding="ascii")
        report = self.verify(source_inp=source_inp, meshio_package=os.environ.get("NATIVE_MESH_MESHIO_PACKAGE"))
        self.assertEqual(len(report["comparisons"]), 3)
        self.assertTrue(all(c["passed"] for c in report["comparisons"]))
        self.assertNotIn("part_ids_equal", report["comparisons"][1])

    def test_independent_inp_bad_data_no_report(self):
        path = self.root / "source.inp"
        bad = [inp(ids=NODE_IDS[:-1] + [11]), inp(rows=[ROWS[0], ROWS[0]]),
               inp().replace("C3D8", "C3D4"), inp().replace("*END PART", "*INCLUDE,INPUT=other.inp"),
               inp().replace("*END PART", "*SYSTEM\n0,0,0"),
               inp().replace("11,0,0,0", "11,0.01,0,0"),
               inp().replace("101,11,23", "101,23,11"), inp().replace("101,11", "101,999")]
        for text in bad:
            with self.subTest(text=text[-80:]):
                path.write_text(text, encoding="ascii")
                self.reject("Duplicate|Unsupported|Only|acceptance failed|unavailable reader",
                            source_inp=path, meshio_package=os.environ.get("NATIVE_MESH_MESHIO_PACKAGE"))

    def test_cli_failure_nonzero_without_report(self):
        self.native.write_text("*INCLUDE\nelsewhere.k\n", encoding="ascii")
        result = subprocess.run([sys.executable, "-B", str(Path(verifier.__file__).resolve()),
                                 "--source-k", str(self.source), "--native-k", str(self.native),
                                 "--report", str(self.report)], capture_output=True, text=True, cwd=self.root)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(json.loads(result.stderr)["passed"])
        self.assertFalse(self.report.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
