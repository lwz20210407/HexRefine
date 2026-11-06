"""Installed-engine mixed controls, not a production mixed-mesh converter.

No published/GPL connectivity table is embedded. Test geometry is generated
locally and subdivided through Gmsh's public API. Raw SJ values are empirical,
not a vendor-wide quality requirement or original-Screw acceptance.
"""
from collections import Counter, defaultdict
import importlib.util
import math
import os
import unittest
import numpy as np

from tools.bolthex.mesh_audit import audit_h8, FACES


def _cycle(face):
    face=list(map(int,face))
    return min(tuple(face[i:]+face[:i]) for i in range(4))


def _owners(cells):
    result=defaultdict(list)
    for index,cell in enumerate(cells):
        for face in cell[FACES]:result[tuple(sorted(map(int,face)))].append((index,face.tolist()))
    return result


def _control(width,depth,height,attached):
    import gmsh
    if gmsh.isInitialized():raise ValueError('An isolated Gmsh session is required')
    points=[[-width/2,-depth/2,0.],[width/2,-depth/2,0.],
            [width/2,depth/2,0.],[-width/2,depth/2,0.],[0.,0.,height]]
    sides=((0,1,4),(1,2,4),(2,3,4),(3,0,4));tets=[];planes=[]
    for face in sides[:attached]:
        a,b,c=np.array(points)[list(face)]
        normal=np.cross(b-a,c-a);normal/=np.linalg.norm(normal)
        length=(np.linalg.norm(a-b)+np.linalg.norm(b-c)+np.linalg.norm(c-a))/3
        exterior=(a+b+c)/3+math.sqrt(2/3)*length*normal
        tets.append([*face,len(points)]);points.append(exterior.tolist());planes.append((a,normal))
    original=np.array(points)
    gmsh.initialize(['mixed-pyramid-control','-nopopup'],readConfigFiles=False)
    try:
        gmsh.option.setNumber('General.Terminal',0);gmsh.option.setNumber('General.NumThreads',1)
        gmsh.option.setNumber('Mesh.Renumber',0);gmsh.model.add('mixed-pyramid-control')
        entity=gmsh.model.addDiscreteEntity(3)
        gmsh.model.mesh.addNodes(3,entity,list(range(1,len(points)+1)),original.ravel().tolist())
        gmsh.model.mesh.addElementsByType(entity,7,[1],[1,2,3,4,5])
        gmsh.model.mesh.addElementsByType(entity,4,list(range(2,2+attached)),
            (np.array(tets,dtype=np.int64)+1).ravel().tolist())
        gmsh.option.setNumber('Mesh.SubdivisionAlgorithm',2);gmsh.model.mesh.refine()
        types,_,connectivity=gmsh.model.mesh.getElements(3,entity)
        if list(types)!=[5]:raise ValueError('Residual TET/PYR or other non-H8 cells')
        ids,p,_=gmsh.model.mesh.getNodes();p=np.array(p).reshape(-1,3)
        lookup={int(n):i for i,n in enumerate(ids)}
        h=np.array([[lookup[int(n)] for n in cell] for cell in np.array(connectivity[0]).reshape(-1,8)])
        version=gmsh.__version__
    finally:gmsh.finalize()
    np.testing.assert_array_equal(p[[lookup[n] for n in range(1,len(points)+1)]],original)
    arithmetic=128*np.finfo(float).eps*max(1.,float(abs(original).max()))
    parent=np.zeros(len(h),np.int64)
    for i,(a,n) in enumerate(planes,1):parent[(p[h].mean(1)-a)@n>arithmetic]=i
    return p,h,parent,original,planes,arithmetic,version


@unittest.skipUnless(importlib.util.find_spec('gmsh') and os.environ.get('BOLTHEX_TEST_ROOT'),
                     'Existing Gmsh runtime and explicit scratch required')
class ActualMixedPyramidControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.canonical=_control(2.,2.,math.sqrt(2.),1)
        cls.rectangular=_control(.157,.2,.1,1)
        cls.all_sides=_control(2.,2.,math.sqrt(2.),4)

    def test_pyramid_plus_tet_is_92_h8_with_three_shared_oriented_quads(self):
        p,h,parent,original,planes,eps,version=self.canonical
        self.assertEqual(len(h),92);self.assertEqual(Counter(parent),{0:88,1:4})
        qa,boundary=audit_h8(p,h,expected_euler=2,minimum_sj=0.)
        self.assertEqual(len(boundary),22)
        owners=_owners(h)
        shared=[rows for rows in owners.values() if len(rows)==2 and parent[rows[0][0]]!=parent[rows[1][0]]]
        self.assertEqual(len(shared),3)
        shared_nodes=sorted({n for rows in shared for n in rows[0][1]})
        self.assertEqual(len(shared_nodes),7)
        for rows in shared:self.assertEqual(_cycle(rows[0][1]),_cycle(rows[1][1][::-1]))
        a,normal=planes[0]
        self.assertEqual(sum(max(abs((p[q]-a)@normal))<=eps for q in boundary),0)
        tri=original[[0,1,4]]
        expected=np.vstack((tri,(tri+np.roll(tri,-1,axis=0))/2,tri.mean(0)))
        distances=np.linalg.norm(expected[:,None]-p[shared_nodes][None],axis=2)
        self.assertLessEqual(float(distances.min(1).max()),eps)
        self.assertEqual(len(np.unique(distances.argmin(1))),7)
        self.assertGreater(qa['minimumGaussJacobian'],0.)

    def test_recorded_canonical_and_rectangular_raw_quality_are_distinct(self):
        if self.canonical[-1]!='4.15.2':self.skipTest('Rebaseline numerical control for this engine version')
        canonical=audit_h8(self.canonical[0],self.canonical[1],minimum_sj=0.)[0]
        rectangular=audit_h8(self.rectangular[0],self.rectangular[1],minimum_sj=0.)[0]
        self.assertAlmostEqual(canonical['minimumCornerScaledJacobian'],.16009187524041266,places=11)
        self.assertAlmostEqual(rectangular['minimumCornerScaledJacobian'],.11750720153996616,places=11)
        self.assertEqual(rectangular['elements'],92)
        self.assertGreater(rectangular['minimumGaussJacobian'],0.)

    def test_unshared_pyramid_face_centroids_are_not_reported_as_exact(self):
        if self.canonical[-1]!='4.15.2':self.skipTest('Rebaseline numerical control for this engine version')
        p,h,parent,original,_,eps,_=self.canonical
        pyramid=h[parent==0];owners=_owners(pyramid)
        boundary_nodes=sorted({n for rows in owners.values() if len(rows)==1 for n in rows[0][1]})
        side_centres=np.array([original[list(face)].mean(0) for face in ((0,1,4),(1,2,4),(2,3,4),(3,0,4))])
        gaps=np.linalg.norm(side_centres[:,None]-p[boundary_nodes][None],axis=2).min(1)
        self.assertLessEqual(gaps[0],eps)
        self.assertGreater(float(gaps[1:].max()),1e-8)
        self.assertLess(float(gaps.max()),1e-6)
        qa=audit_h8(p,pyramid,minimum_sj=0.)[0]
        expected=4*math.sqrt(2)/3
        self.assertGreater(abs(qa['volume']-expected)/expected,1e-12)

    def test_all_four_tet_neighbors_supply_exact_pyramid_side_centroids(self):
        p,h,parent,original,_,eps,_=self.all_sides
        self.assertEqual(Counter(parent),{0:88,1:4,2:4,3:4,4:4})
        total,boundary=audit_h8(p,h,expected_euler=2,minimum_sj=0.)
        self.assertEqual(total['elements'],104);self.assertEqual(len(boundary),40)
        pyramid=h[parent==0];qa=audit_h8(p,pyramid,minimum_sj=0.)[0]
        expected=4*math.sqrt(2)/3
        self.assertLess(abs(qa['volume']-expected)/expected,1e-12)
        for face in ((0,1,4),(1,2,4),(2,3,4),(3,0,4)):
            centre=original[list(face)].mean(0)
            self.assertLessEqual(float(np.linalg.norm(p-centre,axis=1).min()),eps)


if __name__=='__main__':unittest.main()
