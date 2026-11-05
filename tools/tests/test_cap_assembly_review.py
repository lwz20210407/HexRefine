"""Adversarial contracts for explicit cap assembly, not whole-nut acceptance."""
import hashlib
import math
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from tools.bolthex.mesh_core import Mesh3D
from tools.bolthex.mesh_audit import audit_h8
from tools.bolthex.cad_cap_upper import join_interfaces,build_upper,generate
from tools.bolthex.cad_cap_dome import build_cad_dome
from tools.bolthex.cad_cap_shoulder import ShoulderSpec,_interface_audit,build_step_ring


def cube(name,offset=(0.,0.,0.)):
    mesh=Mesh3D(name)
    mesh.nodes=np.array([[0,0,0],[1,0,0],[1,1,0],[0,1,0],
                         [0,0,1],[1,0,1],[1,1,1],[0,1,1]],dtype=float)+offset
    mesh.elems=np.arange(8,dtype=np.int64)[None,:]
    mesh.regions=[name]
    return mesh


def paired_cubes():
    first,second=cube('DOME'),cube('SHOULDER',(0,0,-1))
    a=dict(nodeRings=np.array([[0,1,2,3]]),faces=np.array([[0,3,2,1]]))
    b=dict(nodeRings=np.array([[4,5,6,7]]),faces=np.array([[4,5,6,7]]))
    return first,second,a,b


class ExplicitPairingReview(unittest.TestCase):
    def test_real_exact_pairing_preserves_both_coordinate_arrays_and_volume(self):
        first,second,a,b=paired_cubes()
        original_a=first.nodes.copy();original_b=second.nodes.copy()
        nodes,cells,mapping,report=join_interfaces(first,second,a,b)
        np.testing.assert_array_equal(first.nodes,original_a)
        np.testing.assert_array_equal(second.nodes,original_b)
        np.testing.assert_array_equal(nodes[:8],original_a)
        np.testing.assert_array_equal(nodes[mapping],original_b)
        quality,boundary=audit_h8(nodes,cells,2)
        self.assertEqual(report['sharedFaces'],1)
        self.assertEqual(report['sharedNodes'],4)
        self.assertTrue(report['oneOwnerEachComponent'])
        self.assertAlmostEqual(quality['volume'],2.)
        self.assertNotIn(tuple(sorted(a['faces'][0])),{tuple(sorted(f)) for f in boundary})

    def test_metadata_coordinates_cannot_hide_drift_in_real_node_storage(self):
        first,second,a,b=paired_cubes()
        a['coordinates']=first.nodes[a['nodeRings']].copy()
        b['coordinates']=a['coordinates'].copy()
        second.nodes[4,0]=1e-12
        with self.assertRaisesRegex(ValueError,'coordinates differ'):
            join_interfaces(first,second,a,b)

    def test_unshared_actual_face_cannot_be_replaced_by_four_unused_paired_nodes(self):
        first,second,a,b=paired_cubes()
        second.nodes=np.vstack((second.nodes,second.nodes[4:8]))
        b['nodeRings']=np.array([[8,9,10,11]])
        b['faces']=np.array([[8,9,10,11]])
        with self.assertRaisesRegex(ValueError,'owners'):
            join_interfaces(first,second,a,b)

    def test_two_owners_in_one_component_are_not_one_owner_on_each_side(self):
        first=cube('DOME')
        first.nodes=np.vstack((first.nodes,first.nodes[4:8]+[0,0,1]))
        first.elems=np.vstack((first.elems,[4,5,6,7,8,9,10,11]))
        second=cube('SHOULDER',(10,0,0))
        second.nodes=np.vstack((second.nodes,first.nodes[4:8]))
        a=dict(nodeRings=np.array([[4,5,6,7]]),faces=np.array([[4,5,6,7]]))
        b=dict(nodeRings=np.array([[8,9,10,11]]),faces=np.array([[8,11,10,9]]))
        audit_h8(first.nodes,first.elems,2);audit_h8(second.nodes,second.elems,2)
        try:_,_,_,report=join_interfaces(first,second,a,b)
        except ValueError:return
        self.fail(f'First-side owners=2, second-side owners=0 was accepted: {report}')

    def test_metadata_opposite_normals_cannot_hide_overlapping_actual_cubes(self):
        first,second=cube('DOME'),cube('SHOULDER')
        a=dict(nodeRings=np.array([[0,1,2,3]]),faces=np.array([[0,3,2,1]]))
        # The actual second cell has the SAME outward face; only metadata is reversed.
        b=dict(nodeRings=np.array([[0,1,2,3]]),faces=np.array([[0,1,2,3]]))
        audit_h8(first.nodes,first.elems,2);audit_h8(second.nodes,second.elems,2)
        try:nodes,cells,_,report=join_interfaces(first,second,a,b)
        except ValueError:return
        quality,_=audit_h8(nodes,cells,2)
        self.fail(f'Coincident unit cubes accepted: {report}; minSJ={quality["minimumCornerScaledJacobian"]}, '
                  f'FE volume={quality["volume"]}, geometric union volume=1, Euler={quality["boundaryEuler"]}')

    def test_bow_tie_metadata_must_match_the_actual_h8_face_cycle(self):
        first,second,a,b=paired_cubes()
        a['faces']=np.array([[0,2,1,3]])
        b['faces']=np.array([[4,7,5,6]])
        try:_,_,_,report=join_interfaces(first,second,a,b)
        except ValueError:return
        self.fail(f'Non-H8 bow-tie face cycles accepted: {report}')

    def test_same_orientation_duplicate_ids_and_empty_faces_still_reject(self):
        for corruption in ('same-orientation','duplicate-node','empty-faces'):
            first,second,a,b=paired_cubes()
            if corruption=='same-orientation':b['faces']=b['faces'][:,::-1]
            elif corruption=='duplicate-node':b['nodeRings'][0,1]=4
            else:a['faces']=np.empty((0,4),dtype=np.int64);b['faces']=np.empty((0,4),dtype=np.int64)
            with self.subTest(corruption=corruption),self.assertRaises(ValueError):
                join_interfaces(first,second,a,b)

    def test_duplicate_shoulder_interface_rows_do_not_inflate_shared_face_count(self):
        first,second,a,b=paired_cubes()
        nodes,cells,_,_=join_interfaces(first,second,a,b)
        mesh=Mesh3D('PAIR');mesh.nodes=nodes;mesh.elems=cells;mesh.regions=['DOME','SHOULDER']
        face=a['faces'][0]
        try:report,_=_interface_audit(mesh,{'seam':np.array([face,face])},{'seam':{'DOME','SHOULDER'}})
        except ValueError:return
        self.fail(f'One actual shared face was counted twice: {report}')

    def test_paired_rings_cannot_weld_nodes_not_in_the_declared_interface_faces(self):
        first,second,a,b=paired_cubes()
        # Node 4 is a real non-interface first-side vertex. Its counterpart is
        # an unused second-side vertex, not part of any paired boundary face.
        second.nodes=np.vstack((second.nodes,first.nodes[4]))
        a['nodeRings']=np.array([[0,1,2,3,4]])
        b['nodeRings']=np.array([[4,5,6,7,8]])
        audit_h8(first.nodes,first.elems,2);audit_h8(second.nodes,second.elems,2)
        try:_,_,_,report=join_interfaces(first,second,a,b)
        except ValueError:return
        self.fail(f'Only four actual face vertices, but a fifth non-interface node was merged: {report}')

    def test_shoulder_interface_bow_tie_must_match_an_actual_h8_face_cycle(self):
        first,second,a,b=paired_cubes()
        nodes,cells,_,_=join_interfaces(first,second,a,b)
        mesh=Mesh3D('PAIR');mesh.nodes=nodes;mesh.elems=cells;mesh.regions=['DOME','SHOULDER']
        face=a['faces'][0][[0,2,1,3]]
        try:report,_=_interface_audit(mesh,{'seam':np.array([face])},{'seam':{'DOME','SHOULDER'}})
        except ValueError:return
        self.fail(f'Shoulder audit accepted a non-H8 bow-tie interface cycle: {report}')

    def test_duplicate_face_under_different_interface_names_rejects(self):
        first,second,a,b=paired_cubes()
        nodes,cells,_,_=join_interfaces(first,second,a,b)
        mesh=Mesh3D('PAIR');mesh.nodes=nodes;mesh.elems=cells;mesh.regions=['DOME','SHOULDER']
        interfaces={'seam':a['faces'],'alias':a['faces'][:,::-1]}
        with self.assertRaisesRegex(ValueError,'Duplicate'):
            _interface_audit(mesh,interfaces,{'seam':{'DOME','SHOULDER'},'alias':{'DOME','SHOULDER'}})

    def test_actual_oriented_face_cycles_allow_cyclic_rotations(self):
        for shift in range(4):
            first,second,a,b=paired_cubes()
            a['faces']=np.roll(a['faces'],shift,axis=1)
            b['faces']=np.roll(b['faces'],(shift+1)%4,axis=1)
            with self.subTest(shift=shift):
                nodes,cells,_,report=join_interfaces(first,second,a,b)
                quality,_=audit_h8(nodes,cells,2)
                self.assertTrue(report['oneOwnerEachComponent'])
                self.assertEqual(report['sharedFaces'],1)
                self.assertAlmostEqual(quality['volume'],2.)

    def test_h8_audit_alone_does_not_establish_geometric_nonoverlap(self):
        # This documents a limitation, not a passing assembly acceptance test.
        first,second=cube('DOME'),cube('SHOULDER')
        mapping=np.r_[np.arange(4),np.arange(8,12)]
        nodes=np.vstack((first.nodes,second.nodes[4:]))
        cells=np.vstack((first.elems,mapping[second.elems]))
        quality,_=audit_h8(nodes,cells,2)
        self.assertAlmostEqual(quality['volume'],2.)
        self.assertGreaterEqual(quality['minimumCornerScaledJacobian'],.15)
        np.testing.assert_array_equal(nodes[cells[0]],nodes[cells[1]])
        # Actual geometric union is one unit cube despite a topological Euler=2.
        self.assertNotEqual(quality['volume'],1.)


class PreallocationReview(unittest.TestCase):
    def test_build_upper_rejects_budget_and_depth_before_component_construction(self):
        for kwargs in (dict(divisions=256),dict(divisions=128,radial_layers=2),
                       dict(divisions=True),dict(lower_depth=True),dict(lower_depth=.3)):
            with self.subTest(kwargs=kwargs),patch('tools.bolthex.cad_cap_upper.build_cad_dome') as builder:
                with self.assertRaises(ValueError):build_upper(None,**kwargs)
                builder.assert_not_called()

    def test_dome_and_shoulder_budget_reject_before_audit_or_angular_allocation(self):
        with patch('tools.bolthex.cad_cap_dome.audit_h8') as audit:
            with self.assertRaises(ValueError):build_cad_dome(None,divisions=256)
            audit.assert_not_called()
        from dataclasses import replace
        spec=replace(ShoulderSpec(),circumferential=1024,wall_radial=64)
        with patch('tools.bolthex.cad_cap_shoulder.angular_seeds') as angles:
            with self.assertRaises(ValueError):build_step_ring(spec)
            angles.assert_not_called()

    def test_generate_rejects_invalid_seed_or_depth_before_reading_cad(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT')) as temporary:
            root=Path(temporary);step=root/'not-loaded.step';node=root/'not-executed.exe'
            step.write_text('Preflight must reject before CAD import');node.write_bytes(b'not executed')
            for kwargs in (dict(divisions=256),dict(lower_depth=.3)):
                with self.subTest(kwargs=kwargs),patch('build123d.import_step',side_effect=RuntimeError('CAD read reached')) as reader:
                    try:generate(step,root/'result',node,**kwargs)
                    except (ValueError,RuntimeError):pass
                    else:self.fail('Invalid generation arguments were accepted')
                    reader.assert_not_called()


@unittest.skipUnless(os.environ.get('HEXREFINE_CAP_STEP'),'Select the existing source cap STEP; never copy or regenerate it')
class IndependentCadDomainReview(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from build123d import import_step,Solid
        from tools.bolthex.cad_cap_plan import spherical_cap
        cls.path=Path(os.environ['HEXREFINE_CAP_STEP'])
        cls.digest=hashlib.sha256(cls.path.read_bytes()).hexdigest()
        cls.shape=import_step(cls.path);cap=spherical_cap(cls.shape)
        cls.center=np.array(cap['outer']['centerMm']);cls.radius=cap['outer']['radiusMm']
        cls.inner=cap['inner']['radiusMm'];cx,cy,z=cls.center;r=cls.radius
        cls.dome=cls.shape&Solid.make_box(4*r,4*r,2*r).translate((cx-2*r,cy-2*r,z))
        cls.shoulder=cls.shape&Solid.make_cylinder(r,.1).translate((cx,cy,z-.1))
        cls.upper=cls.shape&Solid.make_cylinder(r,2*r).translate((cx,cy,z-.1))
        cls.inner_face=list(cls.shape.faces())[cap['inner']['face']]

    @classmethod
    def tearDownClass(cls):
        if hashlib.sha256(cls.path.read_bytes()).hexdigest()!=cls.digest:
            raise AssertionError('Read-only review source STEP changed')

    def test_real_cad_partition_union_volume_and_zero_material_overlap_are_independent(self):
        from tools.bolthex.standard_cad import _mass
        for shape in (self.dome,self.shoulder,self.upper):
            self.assertTrue(shape.is_valid);self.assertEqual(len(shape.solids()),1)
        common=self.dome&self.shoulder
        common_volume=0. if common is None or not common.solids() else _mass(common)
        self.assertLessEqual(abs(common_volume),1e-10)
        volume=_mass(self.upper)
        self.assertLessEqual(abs(_mass(self.dome)+_mass(self.shoulder)-volume)/volume,1e-7)
        self.assertGreaterEqual(self.dome.bounding_box().min.Z,self.center[2]-2e-6)
        self.assertLessEqual(self.shoulder.bounding_box().max.Z,self.center[2]+2e-6)

    def test_real_trimmed_sphere_nodes_and_chord_centres_need_different_gates(self):
        from tools.bolthex.cad_mesh import RadialCad
        angles=(-.01,.01)
        points=[self.center+self.inner*np.array([math.cos(a)/math.sqrt(2),math.sin(a)/math.sqrt(2),1/math.sqrt(2)]) for a in angles]
        for point in points:self.assertLessEqual(self.inner_face.distance_to(tuple(point)),2e-6)
        midpoint=np.mean(points,axis=0)
        sag=self.inner_face.distance_to(tuple(midpoint))
        self.assertGreater(sag,2e-6);self.assertLess(sag,.02)
        sampler=RadialCad(self.shape,hole=True)
        direction=(points[0]-self.center)/self.inner
        drift=points[0]+direction*3e-6
        self.assertGreater(self.inner_face.distance_to(tuple(drift)),2e-6)
        with self.assertRaisesRegex(ValueError,'tolerance'):
            sampler.surface_witness_distance(drift,tolerance=2e-6)
        self.assertLess(sampler.surface_witness_distance(drift,tolerance=.02),.02)


if __name__=='__main__':unittest.main()
