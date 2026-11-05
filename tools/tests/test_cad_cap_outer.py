"""Unchanged-port outer band, source CAD gates and explicit crease limitations."""
import importlib.util
import json
import math
import os
from pathlib import Path
import unittest

import numpy as np

from tools.bolthex.cad_cap_outer import (
    _assert_boundary_cycles, anchor_outer_angles, build_cad_outer, outer_wall_interface,
)
from tools.bolthex.mesh_core import Mesh3D
from tools.bolthex.mesh_audit import FACES, audit_h8


def synthetic_port():
    base = np.arctan(np.linspace(-1,1,129)[:-1])
    theta = np.sort(np.mod(np.concatenate([base+k*math.pi/2 for k in range(4)]),math.tau))
    xyz = np.zeros((9,512,3))
    xyz[:,:,0] = 4.75*np.cos(theta)
    xyz[:,:,1] = 4.75*np.sin(theta)
    xyz[:,:,2] = np.linspace(4.9,5,9)[:,None]
    rings = np.arange(9*512).reshape(9,512)
    faces = np.array([[rings[k,i],rings[k,(i+1)%512],rings[k+1,(i+1)%512],rings[k+1,i]]
                      for k in range(8) for i in range(512)])
    return dict(thetaDeg=np.rad2deg(theta),nodeRings=rings,coordinates=xyz,faces=faces)


def synthetic_mesh():
    port=synthetic_port();mesh=Mesh3D('PORT')
    outer=port['coordinates'].reshape(-1,3)
    inner=outer.copy();inner[:,:2]*=4.5/4.75
    width=len(outer)
    mesh.nodes=np.vstack((outer,inner))
    mesh.elems=np.array([[width+k*512+i,k*512+i,k*512+(i+1)%512,width+k*512+(i+1)%512,
                         width+(k+1)*512+i,(k+1)*512+i,(k+1)*512+(i+1)%512,width+(k+1)*512+(i+1)%512]
                        for k in range(8) for i in range(512)],dtype=np.int64)
    mesh.surfaces={'outer-cut':port['faces']}
    mesh.dims=dict(thetaDeg=port['thetaDeg'])
    return mesh,port


class PortAndAngleGuards(unittest.TestCase):
    def test_extraction_retains_coordinates_ids_and_faces(self):
        mesh,expected = synthetic_mesh()
        actual = outer_wall_interface(mesh)
        np.testing.assert_array_equal(actual['nodeRings'],expected['nodeRings'])
        np.testing.assert_array_equal(actual['coordinates'],expected['coordinates'])
        np.testing.assert_array_equal(actual['faces'],expected['faces'])
        np.testing.assert_array_equal(actual['thetaDeg'],expected['thetaDeg'])
        self.assertTrue(actual['actualBoundaryCyclesVerified'])
        self.assertTrue(actual['exactlyOneOwnerPerComponent'])
        self.assertEqual(len(actual['faceOwners']),len(actual['faces']))
        for face,eid in zip(actual['faces'],actual['faceOwners']):
            self.assertIn(set(face),[set(f) for f in mesh.elems[eid][FACES]])

    def test_same_node_set_with_fake_face_cycles_is_rejected(self):
        for order in ([0,3,2,1],[0,2,1,3]):
            mesh,port=synthetic_mesh()
            bad=port['faces'].copy();bad[0]=bad[0,order]
            with self.subTest(order=order),self.assertRaisesRegex(ValueError,'actual outward H8 face cycle'):
                outer_wall_interface(mesh,faces=bad)

    def test_duplicate_records_and_nonboundary_double_owners_are_rejected(self):
        mesh,port=synthetic_mesh()
        faces=port['faces']
        with self.assertRaisesRegex(ValueError,'Duplicate'):
            _assert_boundary_cycles(mesh,np.vstack((faces,faces[:1])))
        mesh.elems=np.vstack((mesh.elems,mesh.elems[:1]))
        with self.assertRaisesRegex(ValueError,'exactly one boundary owner'):
            outer_wall_interface(mesh)

    def test_outer_anchor_is_monotone_small_and_exact_not_index_uniform(self):
        port = synthetic_port()
        angles = np.radians(port['thetaDeg'])
        mapped, ids, target = anchor_outer_angles(angles,np.arange(6)*math.pi/3)
        np.testing.assert_allclose(mapped[ids],target,atol=1e-14,rtol=0)
        self.assertTrue(np.all(np.diff(np.r_[mapped,mapped[0]+math.tau])>0))
        self.assertLess(np.rad2deg(abs(mapped-angles)).max(),.5)
        self.assertGreater(np.ptp(np.diff(mapped)),.001)

    def test_bad_port_or_budget_rejects_before_cad_loading(self):
        for radial in (True,0,9,2.5):
            with self.subTest(radial=radial),self.assertRaises(ValueError):
                build_cad_outer(None,synthetic_port(),radial=radial)
        port=synthetic_port()
        port['coordinates'][2,8,0]+=.001
        with self.assertRaisesRegex(ValueError,'exact axial|cylinder'):
            build_cad_outer(None,port)
        port=synthetic_port();port['nodeRings'][1]=port['nodeRings'][0]
        with self.assertRaisesRegex(ValueError,'unique source'):
            build_cad_outer(None,port)

    def test_missing_port_face_rejects_extraction(self):
        port=synthetic_port();mesh=Mesh3D('BROKEN')
        mesh.nodes=port['coordinates'].reshape(-1,3)
        mesh.surfaces={'outer-cut':port['faces'][:-1]}
        mesh.dims=dict(thetaDeg=port['thetaDeg'])
        with self.assertRaisesRegex(ValueError,'ordered grid'):
            outer_wall_interface(mesh)

    def test_zero_margin_rejects_rather_than_collapsing_outer_columns(self):
        for margin in (0,True,float('nan'),.03):
            with self.subTest(margin=margin),self.assertRaisesRegex(ValueError,'margin'):
                build_cad_outer(None,synthetic_port(),crease_margin=margin)


@unittest.skipUnless(importlib.util.find_spec('build123d') and os.environ.get('HEXREFINE_CAP_STEP')
                     and os.environ.get('HEXREFINE_SHOULDER_DIR'),'select saved CAD and accepted shoulder binary')
class SavedM6Outer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from build123d import import_step
        root=Path(os.environ['HEXREFINE_SHOULDER_DIR'])
        cls.shoulder=Mesh3D('ACCEPTED_SHOULDER')
        cls.shoulder.nodes=np.fromfile(root/'nodes.f64','<f8').reshape(-1,3)
        cls.shoulder.elems=np.fromfile(root/'elements.i32','<i4').reshape(-1,8)
        record=json.loads((root/'report.json').read_text())
        cls.shoulder.dims=record
        data=json.loads((root/'connectivity.json').read_text())
        cls.shoulder.surfaces={k:np.array(v,dtype=np.int64) for k,v in data['surfaces'].items()}
        cls.port=outer_wall_interface(cls.shoulder)
        cls.original_coordinates=cls.port['coordinates'].copy()
        cls.shape=import_step(os.environ['HEXREFINE_CAP_STEP'])
        cls.mesh,cls.crop,cls.report=build_cad_outer(cls.shape,cls.port)

    def test_exact_inner_coordinates_and_reversed_interface_faces(self):
        mesh,port=self.mesh,self.port
        self.assertEqual(mesh.inner_node_rings.shape,(9,512))
        np.testing.assert_array_equal(mesh.nodes[mesh.inner_node_rings],self.original_coordinates)
        np.testing.assert_array_equal(port['coordinates'],self.original_coordinates)
        mapping=dict(mesh.source_node_pairs)
        faces=np.array([[mapping[n] for n in f] for f in port['faces']])
        np.testing.assert_array_equal(mesh.surfaces['shared_inner'],faces[:,[0,3,2,1]])

    def test_real_cad_volume_node_face_and_nondegeneracy_gates(self):
        r=self.report;q=r['quality']
        self.assertEqual(q['elements'],8192)
        self.assertGreaterEqual(q['minimumCornerScaledJacobian'],.15)
        self.assertGreater(q['minimumGaussJacobian'],0)
        self.assertEqual(q['boundaryEuler'],0)
        self.assertEqual(q['nonmanifoldFaces'],0)
        self.assertLessEqual(r['relativeCadH8VolumeError'],1e-4)
        self.assertGreater(r['minimumOuterAxialSpacingMm'],1e-8)
        self.assertEqual(len(np.unique(self.mesh.nodes,axis=0)),len(self.mesh.nodes))
        self.assertLessEqual(self.mesh.nodes[:,2].max(),5)
        for witness in r['boundaryMatching'].values():
            self.assertLessEqual(witness['maximumNodeDistanceMm'],2e-6)
            self.assertLessEqual(witness['maximumFaceCenterDistanceMm'],.02)
        self.assertFalse(r['fullCapNut'])
        self.assertFalse(r['fullModelAcceptance'])
        self.assertEqual(r['cadCropInnerRadiusFromOriginalSphereMm'],4.75)

    def test_exact_node_merge_has_4096_shared_faces_and_closed_boundary(self):
        first,second=self.shoulder,self.mesh
        remap=np.full(len(second.nodes),-1,dtype=np.int64)
        remap[second.source_node_pairs[:,1]]=second.source_node_pairs[:,0]
        fresh=np.flatnonzero(remap<0)
        remap[fresh]=np.arange(len(first.nodes),len(first.nodes)+len(fresh))
        nodes=np.vstack((first.nodes,second.nodes[fresh]))
        cells=np.vstack((first.elems,remap[second.elems]))
        q,_=audit_h8(nodes,cells,expected_euler=0)
        self.assertEqual(q['elements'],20480)
        targets={tuple(sorted(f)):0 for f in self.port['faces']}
        for e in cells:
            for f in e[FACES]:
                key=tuple(sorted(f))
                if key in targets:targets[key]+=1
        self.assertEqual(len(targets),4096)
        self.assertEqual(set(targets.values()),{2})

    def test_uniform_axial_sweep_fails_unchanged_cad_volume_gate(self):
        with self.assertRaisesRegex(ValueError,'volume error .* exceeds 1e-4'):
            build_cad_outer(self.shape,self.port,axial_mapping='uniform')

    def test_support_switch_faces_are_not_claimed_as_exact_crease_partitions(self):
        self.assertGreater(self.report['mixedConePlaneFaces'],0)
        self.assertFalse(self.report['cadCreaseConforming'])
        self.assertEqual(set(self.report['artificialSurfaces']),{'shared_inner','bottom_cut'})


if __name__=='__main__':unittest.main()
