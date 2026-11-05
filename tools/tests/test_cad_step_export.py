"""Actual detached STEP exports, including assembly and source preservation."""
import hashlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools.bolthex.cad_step_export import export_step_detached


def brep_sha(shape):
    from OCP.BRepTools import BRepTools
    data=io.BytesIO();BRepTools.Write_s(shape.wrapped,data)
    return hashlib.sha256(data.getvalue()).hexdigest()


class DetachedStepTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT'))
        self.addCleanup(self.temporary.cleanup);self.root=Path(self.temporary.name)

    def test_selected_translated_rotated_child_excludes_sibling_and_preserves_source_tree(self):
        from build123d import Box,Compound,Location,import_step
        from tools.bolthex.standard_cad import _mass
        selected=Box(1,2,3).moved(Location((3,4,5),(10,20,30)));selected.label='selected_cap'
        sibling=Box(10,10,10).translate((40,0,0));sibling.label='do_not_export'
        parent=Compound(children=[selected,sibling]);parent.label='assembly'
        children=parent.children;before=brep_sha(selected);sibling_before=brep_sha(sibling)
        location=tuple(selected.location)
        report=export_step_detached(selected,self.root/'selected.step')
        reopened=import_step(self.root/'selected.step')
        self.assertEqual(len(reopened.solids()),1);self.assertEqual(len(reopened.faces()),6)
        self.assertAlmostEqual(_mass(reopened),6.,places=10)
        self.assertEqual(reopened.label,'selected_cap')
        self.assertEqual(brep_sha(selected),before);self.assertEqual(brep_sha(sibling),sibling_before)
        self.assertEqual(parent.children,children);self.assertIs(selected.parent,parent)
        self.assertIs(sibling.parent,parent);self.assertEqual(parent.label,'assembly')
        self.assertEqual(selected.label,'selected_cap');self.assertEqual(sibling.label,'do_not_export')
        self.assertEqual(tuple(selected.location),location)
        self.assertLessEqual(report['maximumBoundsDifferenceMm'],1e-7)
        self.assertTrue(report['sourceShapeUnmodified']);self.assertTrue(report['selectedPlacementUnmodified'])

    def test_transformed_ancestor_rejects_without_guessing_world_placement(self):
        from build123d import Box,Compound,Location
        for transform in (Location((10,0,0)),Location((0,0,0),(0,0,90))):
            selected=Box(1,2,3);selected.label='child'
            sibling=Box(1,1,1).translate((20,0,0));parent=Compound(children=[selected,sibling])
            parent.location=transform
            before=brep_sha(selected);children=parent.children;parent_location=tuple(parent.location)
            with self.subTest(transform=str(transform)),self.assertRaisesRegex(ValueError,'ancestor transform'):
                export_step_detached(selected,self.root/'unsupported.step')
            self.assertEqual(brep_sha(selected),before);self.assertEqual(parent.children,children)
            self.assertEqual(tuple(parent.location),parent_location);self.assertIs(selected.parent,parent)
            self.assertFalse((self.root/'unsupported.step').exists())

    def test_existing_output_is_preserved(self):
        from build123d import Box
        target=self.root/'old.step';target.write_bytes(b'EXISTING DESIGN')
        with self.assertRaisesRegex(ValueError,'new STEP'):export_step_detached(Box(1,1,1),target)
        self.assertEqual(target.read_bytes(),b'EXISTING DESIGN')

    def test_nonboolean_option_and_extra_selected_geometry_reject(self):
        from build123d import Box,Compound,Edge
        for value in (None,1,'true'):
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'boolean'):
                export_step_detached(Box(1,1,1),self.root/'bad.step',write_pcurves=value)
        selected=Compound(children=[Box(1,1,1),Edge.make_line((20,0,0),(21,0,0))])
        with self.assertRaisesRegex(ValueError,'outside its one solid'):
            export_step_detached(selected,self.root/'bad.step')
        self.assertFalse((self.root/'bad.step').exists())

    def test_multiple_solids_reject(self):
        from build123d import Box,Compound
        selected=Compound(children=[Box(1,1,1),Box(1,1,1).translate((3,0,0))])
        with self.assertRaisesRegex(ValueError,'one valid solid'):
            export_step_detached(selected,self.root/'bad.step')
        self.assertFalse((self.root/'bad.step').exists())

    def test_writer_failure_does_not_publish_or_change_original(self):
        from build123d import Box,Compound
        selected=Box(1,1,1);parent=Compound(children=[selected]);before=brep_sha(selected)
        def fail(clone,target,**options):
            self.assertIsNot(clone,selected);self.assertIsNone(clone.parent)
            target.write_bytes(b'partial STEP')
            raise RuntimeError('injected writer failure')
        with patch('build123d.export_step',side_effect=fail):
            with self.assertRaisesRegex(RuntimeError,'injected writer'):
                export_step_detached(selected,self.root/'bad.step')
        self.assertIs(selected.parent,parent);self.assertEqual(brep_sha(selected),before)
        self.assertEqual(list(self.root.iterdir()),[])

    def test_output_created_during_export_is_not_overwritten(self):
        from build123d import Box,export_step
        selected=Box(1,1,1);before=brep_sha(selected);target=self.root/'racing.step'
        def racing(clone,stage,**options):
            export_step(clone,stage,**options)
            target.write_bytes(b'OTHER WRITER DESIGN')
        with patch('build123d.export_step',side_effect=racing):
            with self.assertRaises(FileExistsError):export_step_detached(selected,target)
        self.assertEqual(target.read_bytes(),b'OTHER WRITER DESIGN')
        self.assertEqual(brep_sha(selected),before)
        self.assertEqual(list(self.root.iterdir()),[target])

    def test_source_mutation_during_link_rolls_back_only_this_published_file(self):
        from build123d import Box,Compound
        from tools.bolthex import cad_step_export
        selected=Box(1,1,1);selected.label='before'
        parent=Compound(children=[selected]);children=parent.children
        link=cad_step_export.os.link;target=self.root/'late-failure.step'
        def mutate_after_link(stage,destination):
            link(stage,destination)
            selected.label='external edit'
        with patch.object(cad_step_export.os,'link',side_effect=mutate_after_link):
            with self.assertRaisesRegex(ValueError,'changed caller'):
                export_step_detached(selected,target)
        self.assertFalse(target.exists());self.assertEqual(list(self.root.iterdir()),[])
        self.assertEqual(selected.label,'external edit')
        self.assertIs(selected.parent,parent);self.assertEqual(parent.children,children)

    def test_late_guard_failure_preserves_a_replacement_output(self):
        from build123d import Box
        from tools.bolthex import cad_step_export
        selected=Box(1,1,1);link=cad_step_export.os.link;target=self.root/'replacement.step'
        winner=b'COLLISION WINNER: do not delete'
        def replace_after_link(stage,destination):
            link(stage,destination)
            # A new inode containing identical bytes is still not our link.
            replacement=self.root/'other-writer.step'
            replacement.write_bytes(Path(destination).read_bytes())
            os.replace(replacement,destination)
            selected.label='external edit'
        with patch.object(cad_step_export.os,'link',side_effect=replace_after_link):
            with self.assertRaisesRegex(ValueError,'changed caller'):
                export_step_detached(selected,target)
        self.assertTrue(target.is_file())
        self.assertTrue(target.read_bytes().startswith(b'ISO-10303-21'))
        self.assertEqual(selected.label,'external edit')
        self.assertEqual(list(self.root.iterdir()),[target])

    def test_late_guard_failure_preserves_same_inode_with_foreign_content(self):
        from build123d import Box
        from tools.bolthex import cad_step_export
        selected=Box(1,1,1);link=cad_step_export.os.link;target=self.root/'foreign-content.step'
        winner=b'OTHER WRITER CONTENT: do not delete'
        def edit_after_link(stage,destination):
            link(stage,destination)
            Path(destination).write_bytes(winner)
            selected.label='external edit'
        with patch.object(cad_step_export.os,'link',side_effect=edit_after_link):
            with self.assertRaisesRegex(ValueError,'changed caller'):
                export_step_detached(selected,target)
        self.assertEqual(target.read_bytes(),winner)
        self.assertEqual(selected.label,'external edit')
        self.assertEqual(list(self.root.iterdir()),[target])

    def test_actual_wrong_topology_volume_and_placement_exports_are_rejected(self):
        from build123d import Box,Cylinder,export_step
        for kind,wrong in [('topology',Cylinder(1,1)),('volume',Box(2,1,1)),
                           ('bounds',Box(1,1,1).translate((.001,0,0)))]:
            selected=Box(1,1,1);before=brep_sha(selected)
            def substitute(clone,target,**options):return export_step(wrong,target,**options)
            with self.subTest(kind=kind),patch('build123d.export_step',side_effect=substitute):
                with self.assertRaisesRegex(ValueError,kind):
                    export_step_detached(selected,self.root/'bad.step')
                self.assertFalse((self.root/'bad.step').exists())
                self.assertEqual(brep_sha(selected),before)


@unittest.skipUnless(os.environ.get('HEXREFINE_CAP_STEP'),'Select the existing readonly source cap STEP')
class SavedDesignStepTests(unittest.TestCase):
    def test_actual_saved_cap_default_and_no_pcurves_preserve_original_brep_and_file(self):
        from build123d import import_step
        source=Path(os.environ['HEXREFINE_CAP_STEP']);file_hash=hashlib.sha256(source.read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as folder:
            root=Path(folder)
            for pcurves in (True,False):
                selected=import_step(source);before=brep_sha(selected);parent=selected.parent
                children=parent.children;label=selected.label;location=tuple(selected.location)
                with self.subTest(pcurves=pcurves):
                    report=export_step_detached(selected,root/f'cap-{pcurves}.step',
                                                source_step=source,write_pcurves=pcurves)
                    self.assertLessEqual(report['relativeVolumeError'],1e-7)
                    self.assertLessEqual(report['maximumBoundsDifferenceMm'],1e-7)
                    self.assertEqual(report['topology']['faces'],94)
                    self.assertEqual(report['topology']['solids'],1)
                    self.assertEqual(brep_sha(selected),before);self.assertIs(selected.parent,parent)
                    self.assertEqual(parent.children,children);self.assertEqual(selected.label,label)
                    self.assertEqual(tuple(selected.location),location)
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),file_hash)

    def test_actual_cap_after_geometry_only_booleans_preserves_source_brep(self):
        from build123d import import_step,Solid
        from tools.bolthex.cad_cap_plan import spherical_cap
        source=Path(os.environ['HEXREFINE_CAP_STEP']);file_hash=hashlib.sha256(source.read_bytes()).hexdigest()
        selected=import_step(source);cap=spherical_cap(selected)
        cx,cy,z=cap['outer']['centerMm'];r=cap['outer']['radiusMm']
        dome=selected&Solid.make_box(4*r,4*r,2*r).translate((cx-2*r,cy-2*r,z))
        body=selected&Solid.make_box(40,40,5).translate((-20,-20,0))
        self.assertTrue(dome.is_valid);self.assertTrue(body.is_valid)
        before=brep_sha(selected);parent=selected.parent;children=parent.children
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as folder:
            report=export_step_detached(selected,Path(folder)/'after-booleans.step',source_step=source)
            self.assertLessEqual(report['relativeVolumeError'],1e-7)
            self.assertEqual(brep_sha(selected),before);self.assertIs(selected.parent,parent)
            self.assertEqual(parent.children,children)
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),file_hash)


if __name__=='__main__':unittest.main()
