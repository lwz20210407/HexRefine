import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np

from tools.bolthex.mesh_audit import FACES,SIGNS
from tools.bolthex.truegrid_screw import ImportedSolids,read_keyword
from tools.bolthex.volume_patch_assembly import assemble_patch,boundary_volume,write_candidate_pair


def cube_source():
    p=(SIGNS.astype(float)+1)/2
    return ImportedSolids(p,np.arange(8).reshape(1,8),np.arange(1,9),np.array([101]),np.array([3]),{},'')


class AssemblyTests(unittest.TestCase):
    def test_complete_source_replacement_ids_volume_and_immutability(self):
        m=cube_source(); faces=m.node_ids[m.elements[0,FACES]].tolist()
        out,r=assemble_patch(m,[101],[[1,2,3,4,5,6,7,8]],[3],target_boundary_nids=faces)
        self.assertEqual(out.element_ids.tolist(),[101])
        self.assertAlmostEqual(r['patchVolume'],1.)
        self.assertAlmostEqual(r['boundaryFluxVolume'],1.)
        self.assertAlmostEqual(r['newRegionMinimumCornerCenterSJ'],1.)
        self.assertFalse(r['wholeScrewAccepted'])
        np.testing.assert_array_equal(m.nodes,(SIGNS+1)/2)

    def test_boundary_flux_translation_independent(self):
        p=(SIGNS+1)/2+[1000.,-3000.,2000.]
        self.assertAlmostEqual(boundary_volume((np.arange(8)[FACES]+1).tolist(),dict(zip(range(1,9),p))),1.)

    def test_integer_source_does_not_truncate_requested_fractional_motion(self):
        from dataclasses import replace
        m=cube_source();m=replace(m,nodes=m.nodes.astype(int),element_cards={'*ELEMENT_SOLID':1})
        faces=m.node_ids[m.elements[0,FACES]].tolist()
        out,r=assemble_patch(m,[101],[[1,2,3,4,5,6,7,8]],[3],target_boundary_nids=faces,
                             moved_nodes=[(1,.1,0.,0.)])
        self.assertEqual(out.nodes[0,0],.1)
        self.assertEqual(m.nodes[0,0],0)

    def test_interior_node_macro_installs_with_unsplit_outer_faces(self):
        m=cube_source(); faces=m.node_ids[m.elements[0,FACES]].tolist()
        inner=m.nodes*.5+.25
        cells=[]
        for face in faces:
            bottom=[face[i] for i in (0,3,2,1)]
            cells.append(bottom+[n+8 for n in bottom])
        cells.append(list(range(9,17)))
        new=[(n,*p.tolist()) for n,p in zip(range(9,17),inner)]
        output,r=assemble_patch(m,[101],cells,[3]*7,target_boundary_nids=faces,new_nodes=new,minimum_sj=.3,
                               require_continuous_jacobian=True)
        self.assertEqual(len(output.elements),7)
        self.assertEqual(len(output.nodes),16)
        self.assertEqual(r['replacementElementIDs'],[101,102,103,104,105,106,107])
        self.assertEqual(r['prescribedBoundaryFaces'],6)
        self.assertTrue(r['newRegionContinuousJacobianCertified'])
        self.assertEqual(len(r['newRegionCertificates']),7)
        self.assertFalse(r['continuousJacobianCertified'])
        self.assertEqual(output.element_cards['*ELEMENT_SOLID'],7)
        self.assertGreater(r['newRegionMinimumCornerCenterSJ'],.3)
        self.assertAlmostEqual(r['patchVolume'],1.)

    def test_changed_neighbour_must_be_in_explicit_scope(self):
        m=cube_source()
        from dataclasses import replace
        p=np.vstack((m.nodes,m.nodes+[1.,0.,0.]))
        # Use shared existing NIDs on the touching faces, not a coordinate weld.
        e=np.array([[0,1,2,3,4,5,6,7],[1,9,10,2,5,13,14,6]])
        m=replace(m,nodes=p,node_ids=np.arange(1,17),elements=e,element_ids=np.array([101,102]),part_ids=np.array([3,3]))
        faces=m.node_ids[m.elements[0,FACES]].tolist()
        with self.assertRaisesRegex(ValueError,'protected source'):
            assemble_patch(m,[101],[m.node_ids[m.elements[0]].tolist()],[3],target_boundary_nids=faces,
                           moved_nodes=[(2,1.,0.,2.)])
        with self.assertRaisesRegex(ValueError,'new-region or moved-neighbour'):
            assemble_patch(m,[101],[m.node_ids[m.elements[0]].tolist()],[3],target_boundary_nids=faces,
                           moved_nodes=[(2,1.,0.,2.)],allowed_geometry_change_ids=[102])

    def test_missing_boundary_and_wrong_cycle_reject(self):
        m=cube_source(); faces=m.node_ids[m.elements[0,FACES]].tolist()
        for target in (faces[:-1],[faces[0][::-1]]+faces[1:]):
            with self.subTest(target=target),self.assertRaises(ValueError):
                assemble_patch(m,[101],[[1,2,3,4,5,6,7,8]],[3],target_boundary_nids=target)

    def test_full_source_keeps_untouched_neighbour_and_literal_attachment(self):
        from dataclasses import replace
        m=cube_source();p=np.vstack((m.nodes,m.nodes+[1.,0.,0.]))
        e=np.array([[0,1,2,3,4,5,6,7],[1,9,10,2,5,13,14,6]])
        m=replace(m,nodes=p,node_ids=np.arange(1,17),elements=e,
                  element_ids=np.array([101,102]),part_ids=np.array([3,4]))
        faces=m.node_ids[e[0,FACES]].tolist();inner=m.nodes[:8]*.5+.25
        cells=[]
        for face in faces:
            b=[face[i] for i in (0,3,2,1)]
            cells.append(b+[n+16 for n in b])
        cells.append(list(range(17,25)))
        output,r=assemble_patch(m,[101],cells,[3]*7,target_boundary_nids=faces,
            new_nodes=[(n,*q.tolist()) for n,q in zip(range(17,25),inner)])
        kept=int(np.flatnonzero(output.element_ids==102)[0])
        np.testing.assert_array_equal(output.elements[kept],e[1])
        self.assertEqual(output.part_ids[kept],4)
        self.assertEqual(len(output.elements),8)
        self.assertEqual(r['checkedNewRegionElements'],7)

    def test_invalid_quality_and_new_ids_reject(self):
        m=cube_source(); faces=m.node_ids[m.elements[0,FACES]].tolist()
        for settings in (dict(minimum_sj=float('nan')),dict(new_nodes=[(1,0.,0.,0.)]),
                         dict(new_nodes=[(10,float('nan'),0.,0.)]),dict(new_nodes=[(10,.5,.5,.5)])):
            with self.subTest(settings=settings),self.assertRaises(ValueError):
                assemble_patch(m,[101],[[1,2,3,4,5,6,7,8]],[3],target_boundary_nids=faces,**settings)

    def test_other_element_cards_cannot_be_silently_dropped(self):
        from dataclasses import replace
        m=cube_source(); faces=m.node_ids[m.elements[0,FACES]].tolist()
        for cards in ({'*ELEMENT_SOLID':1,'*ELEMENT_BEAM':2},{'*ELEMENT_SOLID':7}):
            with self.subTest(cards=cards),self.assertRaises(ValueError):
                assemble_patch(replace(m,element_cards=cards),[101],[[1,2,3,4,5,6,7,8]],[3],target_boundary_nids=faces)

    @unittest.skipUnless(os.environ.get('VOLUME_PATCH_TEST_ROOT'),'Explicit task scratch required')
    def test_candidate_k_inp_roundtrip_cannot_promote_final_acceptance(self):
        m=cube_source();faces=m.node_ids[m.elements[0,FACES]].tolist()
        with tempfile.TemporaryDirectory(dir=os.environ['VOLUME_PATCH_TEST_ROOT']) as temp:
            out=Path(temp)/'pair'
            mesh,r=write_candidate_pair(m,[101],[[1,2,3,4,5,6,7,8]],[3],out,target_boundary_nids=faces)
            self.assertTrue(r['ioRoundtrip']['k'] and r['ioRoundtrip']['independentInp'])
            self.assertFalse(r['wholeScrewAccepted'])
            self.assertTrue(r['wholeMeshIsCandidateOnly'])
            self.assertIn('NOT ENGINEERING-ACCEPTED',(out/'assembled-candidate.k').read_text())
            with self.assertRaises(ValueError):
                write_candidate_pair(m,[101],[[1,2,3,4,5,6,7,8]],[3],out,target_boundary_nids=faces)

    @unittest.skipUnless(os.environ.get('VOLUME_PATCH_TEST_ROOT'),'Explicit task scratch required')
    def test_changed_output_cannot_publish_pass_receipt(self):
        m=cube_source();faces=m.node_ids[m.elements[0,FACES]].tolist()
        with tempfile.TemporaryDirectory(dir=os.environ['VOLUME_PATCH_TEST_ROOT']) as temp:
            out=Path(temp)/'pair';actual_fsync=os.fsync
            def mutate(fd):
                actual_fsync(fd)
                (out/'assembled-candidate.k').write_text('CORRUPTED')
            with patch('tools.bolthex.volume_patch_assembly.os.fsync',side_effect=mutate):
                with self.assertRaisesRegex(ValueError,'changed before publication'):
                    write_candidate_pair(m,[101],[[1,2,3,4,5,6,7,8]],[3],out,target_boundary_nids=faces)
            self.assertFalse((out/'report.json').exists())
            self.assertFalse(json.loads((out/'rejection.json').read_bytes())['assemblyChecksPassed'])

    @unittest.skipUnless(os.environ.get('VOLUME_PATCH_TEST_ROOT'),'Explicit task scratch required')
    def test_after_writer_before_first_hash_mutation_is_not_blessed(self):
        from tools.bolthex import screw_interface
        m=cube_source();faces=m.node_ids[m.elements[0,FACES]].tolist()
        with tempfile.TemporaryDirectory(dir=os.environ['VOLUME_PATCH_TEST_ROOT']) as temp:
            out=Path(temp)/'pair';original=screw_interface._write_mesh_pair
            def mutate(*args):
                original(*args)
                p=out/'assembled-candidate.k'
                p.write_text(p.read_text().replace('101,3,','999,3,',1))
            with patch.object(screw_interface,'_write_mesh_pair',side_effect=mutate):
                with self.assertRaisesRegex(ValueError,'Captured candidate K differs'):
                    write_candidate_pair(m,[101],[[1,2,3,4,5,6,7,8]],[3],out,target_boundary_nids=faces)
            self.assertFalse((out/'report.json').exists())


@unittest.skipUnless(os.environ.get('HEAD_PATCH_CAVITY'),'Actual fixed-top cavity required')
class ActualRejectedPatch(unittest.TestCase):
    def test_actual6128_source_scope_not_just_positive_macro(self):
        root=Path(os.environ['HEAD_PATCH_CAVITY'])
        spec=json.loads(root.read_bytes())
        old=Path('F:/PythonWoking/temp/20261105-cap-integration/continued-screw-hm')
        raw=read_keyword(old/'screw-phase-compensated-v2/phase-compensated-source.k')
        receipt=json.loads((old/'iges-production-screw-20261107/screw-study/head-exact-face-compensation-v1/report.json').read_bytes())
        from tools.bolthex.exact_face_compensation import compensate_faces
        source,_=compensate_faces(raw,[(tuple(a),tuple(b)) for a,b in receipt['selectedFacePairs']],allowed_element_ids=receipt['allowedElementIDs'])
        # The old morph touches224actual cells. It is not hidden by a2-cell patch.
        parent=root.parents[1]
        with np.load(parent/'bounded-morph-candidate.npz',allow_pickle=False) as z:
            moved=[(int(n),*p.tolist()) for n,p in zip(z['node_ids'],z['after'])]
            allowed=list(map(int,z['affected_element_ids']))
        # Reinstalling the existing two cells still must detect the other bad neighbours.
        idx={int(e):i for i,e in enumerate(source.element_ids)}
        nids=source.node_ids[source.elements[[idx[277],idx[269]]]].tolist()
        from tools.bolthex.screw_interface import face_owners
        patch=ImportedSolids(source.nodes,source.elements[[idx[277],idx[269]]],source.node_ids,
                             np.array([277,269]),np.array([1,1]),{},'')
        faces=[r[0]['nodeIDs'] for r in face_owners(patch).values() if len(r)==1]
        with self.assertRaisesRegex(ValueError,'new-region or moved-neighbour'):
            assemble_patch(source,[277,269],nids,[1,1],target_boundary_nids=faces,
                           moved_nodes=moved,allowed_geometry_change_ids=allowed)
        self.assertEqual(len(source.elements),6128)
        self.assertFalse(any(np.isnan(source.nodes.flat)))


if __name__=='__main__': unittest.main()
