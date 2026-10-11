import importlib.util
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location("oracle",Path(__file__).resolve().parents[1]/"run-truegrid-oracle.py")
oracle=importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)


class TestOraclePreflight(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="gui61-")
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.deck=self.root/"reference.tg"
        self.output=self.root/"reference.k"

    def write(self, mof=None, extra="", ending="write;\nexit;\n"):
        self.deck.write_text("block 1 3;1 3;1 3;0 2;0 2;0 2;\nendpart\nmerge\n"
            +extra+f"mof {mof or self.output.as_posix()};\nlsdyna keyword\n"+ending)

    def test_fresh_absolute_case(self):
        self.write()
        self.assertEqual(oracle.validate_deck(self.deck),(self.deck.resolve(),self.output.resolve()))

    def test_reject_relative_output(self):
        self.write("relative.k")
        with self.assertRaisesRegex(ValueError,"Relative"):
            oracle.validate_deck(self.deck)

    def test_reject_output_outside_case(self):
        self.write((self.root.parent/"elsewhere.k").as_posix())
        with self.assertRaisesRegex(ValueError,"case directory"):
            oracle.validate_deck(self.deck)

    def test_never_reuse_old_mesh(self):
        self.write(); self.output.write_text("old result")
        with self.assertRaises(FileExistsError):
            oracle.validate_deck(self.deck)

    def test_no_unreviewed_include(self):
        self.write(extra="include other.tg\n")
        with self.assertRaisesRegex(ValueError,"Unreviewed"):
            oracle.validate_deck(self.deck)

    def test_require_exit_and_fresh_session_files(self):
        self.write(ending="write;\n")
        with self.assertRaisesRegex(ValueError,"write and exit"):
            oracle.validate_deck(self.deck)
        self.write(); (self.root/"tsave").write_text("prior session")
        with self.assertRaises(FileExistsError):
            oracle.validate_deck(self.deck)


if __name__=="__main__":
    unittest.main()
