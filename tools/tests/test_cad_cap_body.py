import importlib.util
import math
import os
import unittest
from types import SimpleNamespace

import numpy as np

from tools.bolthex.cad_cap_body import (
    BodySpec, NonuniformNutRunoutMap, _connect, _equator, _source_distances,
    body_equatorial_interface, body_preflight, body_rings,
)
from tools.bolthex.mesh_audit import audit_h8
from tools.bolthex.mesh_core import Mesh3D


def equator(count=128):
    # Gnomonic-like nonuniform spacing without building the complete dome.
    xy=[]
    for i in range(count):
        angle=math.tau*i/count+.09*math.sin(4*math.tau*i/count)
        xy.append((math.cos(angle), math.sin(angle)))
    directions=np.array(xy)
    angles=np.rad2deg(np.unwrap(np.arctan2(directions[:,1], directions[:,0])))
    coordinates=np.zeros((2,count,3))
    coordinates[:,:,:2]=np.array([3.75,4.75])[:,None,None]*directions
    coordinates[:,:,2]=5.
    return dict(thetaDeg=angles.tolist(), coordinates=coordinates,
                centerMm=[0.,0.,5.], radiiMm=[3.75,4.75])


class FakeCad:
    zmin=0.
    zmax=5.

    def __init__(self, theta=270.):
        self.theta=theta
        a=math.radians(theta)
        face=SimpleNamespace(
            geom_type=SimpleNamespace(name='PLANE'),
            normal_at=lambda:SimpleNamespace(X=-math.sin(a),Y=math.cos(a),Z=0.),
            center=lambda:SimpleNamespace(X=3*math.cos(a),Y=3*math.sin(a)),
            vertices=lambda:[SimpleNamespace(Z=z) for z in (.21,.24,.26,.29)],
        )
        self.faces=[(face,None)]

    def radii(self,theta,z):
        jump=.05*min(1.,max(0.,(z-.21)/.03),max(0.,(.29-z)/.03))
        return (3.-(jump if (theta-self.theta+180)%360-180>0 else 0.),6.)

    def surface_witness_distance(self,point,tolerance=2e-6):
        return 0.


class NonuniformBodyTests(unittest.TestCase):
    def test_invalid_seeds_reject_before_cad(self):
        for angles in ([0.]*128, np.linspace(0,360,128), [False]*128, [0.,1.,float('nan')], [0.,1.]):
            with self.subTest(angles=str(angles)[:40]), self.assertRaises(ValueError):
                NonuniformNutRunoutMap(None,angles)
        for kwargs in (dict(spacing=False),dict(spacing=float('inf')),dict(element_limit=300001),
                       dict(inner_layers=0),dict(lead_degrees=50.,half_window=45.)):
            with self.subTest(kwargs=kwargs),self.assertRaises(ValueError):
                body_preflight(None,None,BodySpec(**kwargs))

    def test_nonuniform_pair_owns_actual_seed_ids_and_single_sided_limits(self):
        eq=equator()
        mapping=NonuniformNutRunoutMap(FakeCad(),eq['thetaDeg'])
        cap=mapping.caps[0]
        self.assertEqual(cap['indexB'],cap['indexA']+1)
        self.assertEqual(cap['refA'],mapping.angles[cap['indexA']])
        self.assertEqual(cap['refB'],mapping.angles[cap['indexB']])
        self.assertLessEqual(cap['refA'],280.)
        self.assertGreater(cap['refB'],280.)
        _,inner=mapping.boundaries(.25)
        a,b=inner[[cap['indexA'],cap['indexB']]]
        np.testing.assert_allclose(np.linalg.norm([a,b],axis=1),[3.,2.95],atol=1e-12)
        self.assertLess(abs(a[0]*b[1]-a[1]*b[0]),1e-12)
        self.assertGreater(np.linalg.norm(a-b),.0499)
        self.assertTrue(mapping.report()['legacyM8PathUnmodified'])
        with self.assertRaisesRegex(ValueError,'uniform-angle'):
            mapping.section_xy(None,.25)

    def test_end_angles_recover_identity_even_with_caps_near_end(self):
        eq=equator()
        mapping=NonuniformNutRunoutMap(FakeCad(),eq['thetaDeg'])
        direction=eq['coordinates'][0,:,:2]/3.75
        for z in (0.,5.):
            _,inner=mapping.boundaries(z)
            np.testing.assert_allclose(inner,3.*direction,atol=2e-14)
            self.assertEqual(mapping._weight(mapping.caps[0],z),0.)

    def test_wrap_pair_does_not_use_uniform_rounding(self):
        eq=equator()
        mapping=NonuniformNutRunoutMap(FakeCad(theta=349.),eq['thetaDeg'])
        cap=mapping.caps[0]
        _,inner=mapping.boundaries(.25)
        np.testing.assert_allclose(np.linalg.norm(inner[[cap['indexA'],cap['indexB']]],axis=1),[3.,2.95])
        self.assertTrue(0<=cap['indexA']<128)
        self.assertEqual(cap['indexB'],0)
        self.assertGreater(cap['refA'],349.)

    def test_radial_bands_restore_reference_and_exact_top_dome_coordinates(self):
        eq=equator()
        mapping=NonuniformNutRunoutMap(FakeCad(),eq['thetaDeg'])
        middle=body_rings(mapping,.25,eq)
        top=body_rings(mapping,5.,eq)
        self.assertEqual(top.shape,(5,128,3))
        np.testing.assert_array_equal(top[2:4],eq['coordinates'])
        np.testing.assert_array_equal(middle[2:4,:,:2],eq['coordinates'][:,:,:2])
        self.assertGreater(np.max(abs(middle[0,:,:2]-3.*eq['coordinates'][0,:,:2]/3.75)),.1)

    def test_interface_extractor_gives_outward_plus_z_faces(self):
        eq=equator();count=len(eq['thetaDeg'])
        mesh=Mesh3D('TEST')
        top=eq['coordinates'].reshape(-1,3)
        bottom=top.copy();bottom[:,2]=0.
        mesh.nodes=np.concatenate((bottom,top))
        mesh.elems=_connect(count,2,1)
        mesh.body_equatorial_rings=np.arange(2*count,4*count).reshape(2,count)
        mesh.surfaces={'dome-equator':np.column_stack((np.arange(count),np.arange(count)+count,
                                                      np.roll(np.arange(count),-1)+count,np.roll(np.arange(count),-1)))+2*count}
        mesh.dims=dict(thetaDeg=eq['thetaDeg'],equatorRadiiMm=eq['radiiMm'])
        out=body_equatorial_interface(mesh)
        points=mesh.nodes[out['faces']]
        self.assertTrue(np.all(np.cross(points[:,1]-points[:,0],points[:,2]-points[:,0])[:,2]>0))
        np.testing.assert_array_equal(out['coordinates'],eq['coordinates'])
        from tools.bolthex.mesh_audit import FACES
        actual=mesh.elems[:,FACES].reshape(-1,4)
        def cycle(face):
            f=tuple(map(int,face));return min(f[i:]+f[:i] for i in range(4))
        for face in out['faces']:
            owners=actual[np.all(np.sort(actual,axis=1)==np.sort(face),axis=1)]
            self.assertEqual(len(owners),1)
            self.assertEqual(cycle(owners[0]),cycle(face))

    def test_connectivity_has_positive_h8_and_closed_torus_boundary(self):
        eq=equator();angles=np.deg2rad(eq['thetaDeg'])
        rings=np.linspace(3.,6.,5)
        nodes=np.array([[[r*math.cos(a),r*math.sin(a),z] for a in angles] for z in (0.,.1) for r in rings]).reshape(-1,3)
        cells=_connect(len(angles),len(rings),1)
        quality,_=audit_h8(nodes,cells,expected_euler=0)
        self.assertGreater(quality['minimumCornerScaledJacobian'],.98)
        self.assertEqual(quality['elements'],512)

    def test_equator_rejects_invented_circular_interface(self):
        for key,value in (('centerMm',[0.,0.,4.9]),('radiiMm',[3.1,4.75])):
            invalid=dict(equator(),**{key:value})
            with self.subTest(key=key),self.assertRaisesRegex(ValueError,'actual centered M6'):
                _equator(invalid)
        invalid=equator();invalid['coordinates']=invalid['coordinates'].copy();invalid['coordinates'][0,0,0]+=.00001
        with self.assertRaisesRegex(ValueError,'disagree'):_equator(invalid)

    def test_real_source_face_node_and_face_center_gates_are_distinct(self):
        calls=[]
        face=SimpleNamespace(bounding_box=lambda:SimpleNamespace(min=(0.,0.,0.),max=(1.,1.,0.)),
                             distance_to=lambda p:calls.append(p) or abs(p[2]))
        source=SimpleNamespace(faces=lambda:[face])
        points=np.array([[.5,.5,.01]])
        self.assertAlmostEqual(_source_distances(source,points,.02,kind='face-centers'),.01)
        with self.assertRaisesRegex(ValueError,'nodes distance'):
            _source_distances(source,points,2e-6,kind='nodes')
        self.assertTrue(calls)


@unittest.skipUnless(os.environ.get('HEXREFINE_CAP_STEP') and importlib.util.find_spec('build123d'),
                     'Explicit saved M6 source CAD required; not the all-CAD suite')
class SavedBodyCadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from build123d import import_step
        from tools.bolthex.cad_cap_dome import build_cad_dome,equatorial_interface
        cls.shape=import_step(os.environ['HEXREFINE_CAP_STEP'])
        cls.eq=equatorial_interface(build_cad_dome(cls.shape)[0])

    def test_real_m6_cap_detection_ends_and_local_only_patches(self):
        local,mapping,zs,plan=body_preflight(self.shape,self.eq)
        self.assertTrue(local.is_valid)
        self.assertEqual(plan['circumferential'],512)
        self.assertLessEqual(plan['elements'],300000)
        self.assertEqual(len(mapping.caps),2)
        self.assertGreater(plan['sourceCadPartitionVolume'],300.)
        for cap in mapping.caps:
            self.assertAlmostEqual((cap['zmin']+cap['zmax'])/2,.25 if cap['theta']>180 else 4.75,places=6)
            self.assertGreater(cap['peakSampledJump'],.049)
            ids=np.flatnonzero(abs((mapping.angles-cap['refA']+180)%360-180)<5)
            low=cap['zmin']-cap['supportBelow'];high=cap['zmax']+cap['supportAbove']
            levels=np.unique(np.r_[low,high,zs[(zs>low)&(zs<high)]])
            rings=np.array([body_rings(mapping,float(z),self.eq)[:,ids] for z in levels])
            n,r=len(ids),rings.shape[1]
            cells=_connect(n,r,len(levels)-1).reshape(len(levels)-1,r-1,n,8)[:,:,:-1].reshape(-1,8)
            quality,_=audit_h8(rings.reshape(-1,3),cells,expected_euler=2)
            self.assertLess(len(cells),2000)
            self.assertGreaterEqual(quality['minimumCornerScaledJacobian'],.15)
        for z in (0.,5.):
            _,inner=mapping.boundaries(z)
            np.testing.assert_allclose(np.mod(np.rad2deg(np.arctan2(inner[:,1],inner[:,0])),360),self.eq['thetaDeg'],atol=1e-10)
        np.testing.assert_array_equal(body_rings(mapping,5.,self.eq)[2:4],self.eq['coordinates'])


if __name__=='__main__':
    unittest.main()
