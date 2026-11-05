"""Low-level native-CAD merge scripts retain immutable FE/reopen checks."""
from pathlib import Path
import unittest

from tools.hypermesh_native import make_tcl


class NativeCadCapsuleScriptTests(unittest.TestCase):
    def build(self,**options):
        return make_tcl(Path('input.k'),Path('design.step'),Path('new-output'),Path('template.key'),
            123,45,1,False,1e-7,[],120,source_pids=(1,),**options)

    def test_legacy_step_path_and_all_template_values_remain_available(self):
        source=self.build()
        self.assertIn('set nativeCadDatabase [decode {}]',source)
        self.assertIn('*feinputwithdata2 {#ct\\step_reader} $cad',source)
        self.assertNotIn('@NATIVECADDB@',source)
        self.assertNotIn('@NODES@',source)

    def test_native_capsule_is_loaded_before_k_and_rejected_if_it_contains_fe(self):
        path=Path('source CAD/model.hm').resolve()
        source=self.build(native_cad_database=path)
        self.assertIn('set nativeCadDatabase [decode {'+str(path).encode().hex()+'}]',source)
        self.assertLess(source.index('*readfile $nativeCadDatabase'),source.index('*feinputwithdata2 {#ls-dyna\\dynakey}'))
        self.assertIn('Native CAD capsule must not contain FE nodes or elements',source)
        self.assertIn('Native CAD capsule has no physical surfaces',source)
        self.assertIn('Unexpected imported CAD solid count',source)

    def test_save_reopen_full_snapshot_and_pid_guards_are_not_removed(self):
        source=self.build(native_cad_database='cad-only.hm')
        for command in ('*writefile $database 0','*deletemodel','*readfile $database',
                        'same_snapshot $original [snapshot] $log "HM reopen"',
                        'Native import changed source part IDs','snap_nodes=0',
                        'Only nondegenerate H8 config 208 is supported'):
            self.assertIn(command,source)

    def test_requires_hm_extension_reference_and_distinct_output(self):
        with self.assertRaises(ValueError):self.build(native_cad_database='not-native.step')
        with self.assertRaises(ValueError):self.build(native_cad_database=Path('new-output/model.hm'))
        with self.assertRaises(ValueError):
            make_tcl(Path('input.k'),None,Path('new-output'),Path('template.key'),1,1,0,
                     False,1e-7,[],native_cad_database='cad.hm')


if __name__=='__main__':unittest.main()
