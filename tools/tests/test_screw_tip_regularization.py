"""Exact hull/target regression; actual source tests require explicit fixture paths."""
from dataclasses import replace
from fractions import Fraction as Q
from itertools import product
import json
import os
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from tools.bolthex import screw_tip_regularization as tip


def qpoints(values):
    return [tuple(Q(x) for x in p) for p in values]


def independent_map(points,parameters):
    weights=[Q(1) for _ in tip.BITS]
    for i,bits in enumerate(tip.BITS):
        for b,x in zip(bits,parameters): weights[i]*=x if b else 1-x
    return tuple(sum(w*p[k] for w,p in zip(weights,points)) for k in range(3))


class ExactHullTests(unittest.TestCase):
    def test_unit_cube_orientation_volume_and_all_corners(self):
        points=qpoints(tip.BITS);h=tip.exact_convex_hull(points)
        self.assertEqual(h['volume'],1)
        self.assertEqual(len(h['faces']),6)
        self.assertEqual(len(h['triangles']),12)
        self.assertTrue(all(tip.contains(h,p) for p in points))
        self.assertFalse(tip.contains(h,(Q(2),Q(0),Q(0))))

    def test_tetrahedron_and_redundant_collinear_points(self):
        points=qpoints([(0,0,0),(1,0,0),(0,1,0),(0,0,1)])
        points.extend([(Q(1,2),0,0),(Q(1,4),0,0),points[0],(Q(1,4),)*3])
        h=tip.exact_convex_hull(points)
        self.assertEqual(h['volume'],Q(1,6))
        self.assertEqual(len(h['vertexIndices']),4)
        self.assertTrue(all(tip.contains(h,p) for p in points))

    def test_sixteen_point_bound_and_planar_rejection(self):
        self.assertEqual(tip.exact_convex_hull(qpoints(tip.BITS)*2)['volume'],1)
        with self.assertRaisesRegex(ValueError,'4..16'):
            tip.exact_convex_hull(qpoints(tip.BITS)*2+[(Q(0),)*3])
        with self.assertRaisesRegex(ValueError,'full dimensional'):
            tip.exact_convex_hull(qpoints([(0,0,0),(1,0,0),(0,1,0),(1,1,0)]))

    def test_small_rational_hull_has_no_qhull_precision_floor(self):
        size=Q(1,2**100)
        points=[tuple(Q(x)*size for x in b) for b in tip.BITS]
        self.assertEqual(tip.exact_convex_hull(points)['volume'],size**3)

    def test_exact_sqrt_upper_and_orthogonal_box(self):
        value=Q(17,31);upper=tip._sqrt_upper(value)
        self.assertGreaterEqual(upper**2,value)
        self.assertLess((upper-Q(1,2**80))**2,value)
        box=tip.orthogonal_box((Q(0),)*3,(Q(3,5),Q(4,5)))
        self.assertEqual(box['determinant']**2,np.prod(box['edgeSquares']))
        self.assertGreater(box['determinant'],0)
        self.assertTrue(all(tip.dot(box['edges'][i],box['edges'][j])==0 for i,j in ((0,1),(0,2),(1,2))))
        self.assertGreaterEqual(box['radiusBound']**2,sum(box['edgeSquares']))


ACTUAL_READY=all(os.environ.get(k) for k in ('SCREW_TIP_RAW_K','SCREW_TIP_PHASE_K','SCREW_TIP_POLICY_REPORT','SCREW_TIP_TEST_ROOT'))


@unittest.skipUnless(ACTUAL_READY,'Explicit actual raw/phase/policy and task-local scratch paths required')
class ActualTipTargetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw=Path(os.environ['SCREW_TIP_RAW_K']);cls.phase=Path(os.environ['SCREW_TIP_PHASE_K'])
        cls.policy=Path(os.environ['SCREW_TIP_POLICY_REPORT'])
        cls.root=Path(os.environ['SCREW_TIP_TEST_ROOT'])
        cls.tmp=tempfile.TemporaryDirectory(prefix='tip-tests-',dir=cls.root)
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.work=Path(cls.tmp.name)
        cls.before={str(p):tip.sha(p) for p in (cls.raw,cls.phase,cls.policy)}
        cls.results=[tip.prepare_target(p,cls.policy,cls.work/f'{name}.json') for name,p in [('raw',cls.raw),('phase',cls.phase)]]
        cls.mesh=tip.read_keyword(cls.raw)
        cls.source=tip._source_geometry(cls.mesh)

    @classmethod
    def tearDownClass(cls):
        if any(tip.sha(p)!=h for p,h in cls.before.items()):
            raise AssertionError('Actual input modified by target tests')

    def setUp(self):
        self.tmp_case=tempfile.TemporaryDirectory(dir=self.work)
        self.addCleanup(self.tmp_case.cleanup)
        self.case=Path(self.tmp_case.name);self.output=self.case/'target.json'
        self.inputs=self.case/'inputs';self.inputs.mkdir()
        self.r=self.results[0]

    def test_raw_phase_actual_targets_identical_geometry(self):
        a,b=self.results
        for key in ('parameterBox','exactHull','floatHull','deviation','protection','volume','affineH8Witness'):
            self.assertEqual(a[key],b[key],key)
        self.assertEqual(a['sourceVariant'],'raw');self.assertEqual(b['sourceVariant'],'phase')
        self.assertEqual(a['policyReportSHA256'],tip.sha(self.policy))

    def test_existing_policy_and_half_budget_frozen(self):
        p=self.r['approvedGeometryAccuracyPolicy']
        self.assertEqual(p['declaredTargetSizeMm'],.2)
        self.assertEqual(p['limits']['maximumSurfaceDistance'],.0005)
        budget=self.r['budget'];total=Q(budget['totalDistanceMM']['exact'])
        self.assertEqual(Q(budget['geometryTargetIncludingFloatMM']['exact']),total/2)
        self.assertEqual(Q(budget['reservedMeshApproximationMM']['exact']),total/2)
        self.assertLessEqual(Q(self.r['deviation']['includingFloatOutputMM']['exact']),total/2)
        self.assertFalse(budget['incidentalEdgeTargetUsed'])
        self.assertEqual(self.r['search']['totalCandidates'],448)

    def test_all_source_corners_and_octant_corners_in_exact_hull(self):
        ranges=tuple(Q(self.r['parameterBox'][k]) for k in ('lambdaMax','tauMax','omegaMax'))
        candidate,reason=tip._candidate(self.source,ranges,Q(self.r['budget']['geometryTargetIncludingFloatMM']['exact']))
        self.assertIsNone(reason)
        self.assertEqual(len(candidate['points']),16)
        self.assertTrue(all(tip.contains(candidate['hull'],v) for v in candidate['points']))
        self.assertTrue(all(tip.contains(candidate['floatHull'],v) for v in candidate['roundedPoints']))
        for params,p in zip(candidate['parameters'],candidate['points'][:8]):
            self.assertEqual(p,independent_map(self.source['q'],params))

    def test_random_convex_combinations_obey_analytic_bound(self):
        # Diagnostics only; the certificate is the covariance + radius proof.
        points=qpoints(self.r['exactHull']['pointsExact'])
        mapped=[points[i] for i in self.r['exactHull']['inputCornerToPoint']]
        rounded=[tuple(Q.from_float(float(x)) for x in p) for p in mapped]
        params=qpoints(self.r['parameterBox']['cornersExact'])
        bound=Q(self.r['deviation']['includingFloatOutputMM']['exact'])
        base_bound=Q(self.r['deviation']['baseCornerHullToSourceMM']['exact'])
        rng=random.Random(20261107)
        for _ in range(48):
            weights=[rng.randrange(1,100) for _ in range(16)];total=sum(weights)
            weights=[Q(w,total) for w in weights]
            mean=tuple(sum(weights[i]*params[i][j] for i in range(8)) for j in range(3))
            source_point=independent_map(self.source['q'],mean)
            base_point=tuple(sum(weights[i]*mapped[i][j] for i in range(8))+sum(weights[8:])*self.source['p'][j] for j in range(3))
            self.assertLessEqual(tip.l1(tip.sub(base_point,source_point)),base_bound)
            for vertices in (mapped,rounded):
                point=tuple(sum(weights[i]*vertices[i][j] for i in range(16)) for j in range(3))
                error=tip.sub(point,source_point)
                self.assertLessEqual(tip.dot(error,error),bound**2)

    def test_whole_hull_protected_from_all_other_cells_and_root_face(self):
        protection=self.r['protection']
        self.assertEqual(protection['allOtherSourceCellsChecked'],6127)
        self.assertEqual(protection['allRetainedOutsideBodyCellsIncluded'],3968)
        plane=Q(protection['requiredLowerPlaneZ']['exact']);root_min=Q(protection['minimumOriginalRootFaceProjection']['exact'])
        radial=tuple(Q(x) for x in protection['radialProjection'])
        for key in ('exactHull','floatHull'):
            for point in qpoints(self.r[key]['pointsExact']):
                self.assertGreater(point[2],plane)
                self.assertLessEqual(tip.dot(radial,point[:2]),root_min/4)
        self.assertGreater(Q(protection['strictHeightMargin']['exact']),0)
        self.assertGreater(Q(protection['rootFaceProjectionMargin']['exact']),0)

    def test_covering_source_cell_counterexample_rejects(self):
        nodes=self.mesh.nodes.copy();nodes[0]=self.mesh.nodes[np.flatnonzero(self.mesh.node_ids==9384)[0]]
        with self.assertRaisesRegex(ValueError,'Maximum-Z|cover'):
            tip._source_geometry(replace(self.mesh,nodes=nodes))
        self.assertEqual(tip.sha(self.raw),self.before[str(self.raw)])

    def test_missing_source_cell_rejects(self):
        bad=replace(self.mesh,elements=self.mesh.elements[1:],element_ids=self.mesh.element_ids[1:],part_ids=self.mesh.part_ids[1:])
        with self.assertRaisesRegex(ValueError,'complete actual'):
            tip._source_geometry(bad)

    def test_source_injective_volume_and_gauss_crosscheck(self):
        volume=self.r['volume'];expected=Q(volume['sourceCellImageVolume']['exact'])
        self.assertTrue(all(Q(x)>0 for x in volume['sourceJacobianFactorBernsteinCoefficients']))
        q=np.array([[float(x) for x in p] for p in self.source['q']]);q-=q[0]
        bits=np.array(tip.BITS);measured=0.
        for r in product(((1-1/np.sqrt(3))/2,(1+1/np.sqrt(3))/2),repeat=3):
            r=np.array(r);derivative=np.empty((8,3))
            for axis in range(3):
                other=[k for k in range(3) if k!=axis]
                derivative[:,axis]=(2*bits[:,axis]-1)*np.prod(np.where(bits[:,other],r[other],1-r[other]),axis=1)
            measured+=np.linalg.det(q.T@derivative)/8
        self.assertAlmostEqual(measured/float(expected),1.,places=11)
        self.assertLessEqual(Q(volume['relativeAddedVolumeUpperBound']['exact']),Q(1,10000))
        self.assertFalse(volume['sourceUnionVolumeKnown'])

    def test_hull_vertex_volume_independent_numerical_readback(self):
        for name in ('exactHull','floatHull'):
            h=self.r[name];points=np.array([[float(Q(x)) for x in p] for p in h['pointsExact']])
            points-=points[0]
            value=sum(float(np.linalg.det(points[list(t)]))/6 for t in h['outwardTriangles'])
            self.assertAlmostEqual(value/h['volume']['value'],1.,places=10)

    def test_orthogonal_witness_all_corner_and_interior_jacobian(self):
        w=self.r['affineH8Witness'];vertices=qpoints(w['verticesExact']);basis=qpoints(w['basisExact'])
        determinant=tip.det(*basis)
        self.assertGreater(determinant,0)
        self.assertEqual(determinant,Q(w['jacobianOnUnitCube']['exact']))
        self.assertEqual(determinant**2,np.prod([tip.dot(v,v) for v in basis]))
        poly=tip.jacobian_polynomial(tip.coefficients(vertices))
        self.assertEqual(poly,{(0,0,0):determinant})
        self.assertEqual(w['scaledJacobianSquared']['exact'],'1')
        for point in vertices:
            for face in self.r['exactHull']['faces']:
                self.assertLessEqual(tip.dot(tuple(Q(x) for x in face['normalExact']),point)+Q(face['offsetExact']),0)
        self.assertFalse(w['mandatoryFinalMeshSeed'])
        self.assertFalse(w['engineeringQualityCertified'])
        self.assertFalse(w['explicitTimeStepQualityCertified'])

    def test_actual_material_added_outside_old_maximum_height_segment(self):
        w=self.r['addedMaterialWitness'];p=tuple(Q(x) for x in w['pointExact'])
        self.assertEqual(p[2],self.source['p'][2])
        a=self.source['radialProjection'];n=(-a[1],a[0])
        self.assertLess(tip.dot(n,p[:2]),0)
        self.assertTrue(tip.contains(tip.exact_convex_hull(qpoints(self.r['exactHull']['pointsExact'])),p))

    def test_scope_flags_do_not_promote_domain_bound_to_boundary_acceptance(self):
        for key in ('boundaryDistanceCertified','engineeringGeometryAccepted','repairCompleted','independentDesignCad',
                    'wholeScrewAccepted','coreMeshed','engineeringQualityAccepted','originalNodesMoved','originalElementsDeleted'):
            self.assertFalse(self.r[key],key)
        self.assertIn('solid-domain',self.r['deviation']['distanceSemantics'])
        self.assertTrue(self.r['floatHullIsApproximationNotAuthoritativeTarget'])

    def test_wrong_policy_reports_reject_without_output(self):
        original=json.loads(self.policy.read_text())
        for i,target in enumerate((.00486,.3)):
            report=dict(original,geometryAccuracyPolicy=tip.CadAccuracyPolicy.engineering(target).manifest())
            path=self.inputs/f'policy-{i}.json';path.write_text(json.dumps(report))
            with self.subTest(target=target),self.assertRaisesRegex(ValueError,'policy changes forbidden'):
                tip.prepare_target(self.raw,path,self.output)
            self.assertFalse(self.output.exists())
        report=dict(original,geometryAccuracyPolicy=tip.CadAccuracyPolicy().manifest())
        path=self.inputs/'strict.json';path.write_text(json.dumps(report))
        with self.assertRaisesRegex(ValueError,'policy changes forbidden'):
            tip.prepare_target(self.raw,path,self.output)

    def test_forged_policy_source_binding_rejects(self):
        report=json.loads(self.policy.read_text());report['sourceSHA256']='0'*64
        path=self.inputs/'forged.json';path.write_text(json.dumps(report))
        with self.assertRaisesRegex(ValueError,'bind the reviewed'):
            tip.prepare_target(self.raw,path,self.output)
        self.assertFalse(self.output.exists())

    def test_existing_output_and_wrong_format_reject_without_touching(self):
        self.output.write_text('existing user data')
        with self.assertRaisesRegex(ValueError,'fresh JSON'):
            tip.prepare_target(self.raw,self.policy,self.output)
        self.assertEqual(self.output.read_text(),'existing user data')
        with self.assertRaisesRegex(ValueError,'fresh JSON'):
            tip.prepare_target(self.raw,self.policy,self.case/'not-a-mesh.k')
        self.assertFalse((self.case/'not-a-mesh.k').exists())

    def test_raw_output_cannot_enter_immutable_phase_report_directory(self):
        path=self.policy.parent/f'{self.case.name}-forbidden-target.json'
        self.assertFalse(path.exists())
        with self.assertRaisesRegex(ValueError,'immutable source or phase-report'):
            tip.prepare_target(self.raw,self.policy,path)
        self.assertFalse(path.exists())

    def test_distance_and_volume_failure_do_not_relax_limits(self):
        candidate,reason=tip._candidate(self.source,(Q(1,4),Q(1,4),Q(1,16)),Q(0))
        self.assertIsNone(candidate);self.assertEqual(reason,'distance-budget')
        bad=dict(self.source,sourceVolume=self.source['sourceVolume']/1000)
        ranges=tuple(Q(self.r['parameterBox'][k]) for k in ('lambdaMax','tauMax','omegaMax'))
        candidate,reason=tip._candidate(bad,ranges,Q(self.r['budget']['geometryTargetIncludingFloatMM']['exact']))
        self.assertIsNone(candidate);self.assertEqual(reason,'volume-budget')

    def test_publication_change_detected_no_report(self):
        path=self.inputs/'policy.json';path.write_bytes(self.policy.read_bytes())
        original=tip.os.fsync
        def mutate(fd):
            original(fd);path.write_bytes(path.read_bytes()+b'\n')
        with patch.object(tip.os,'fsync',side_effect=mutate),patch.object(tip.os,'link') as publish:
            with self.assertRaisesRegex(ValueError,'policy report changed'):
                tip.prepare_target(self.raw,path,self.output)
            publish.assert_not_called()
        self.assertFalse(self.output.exists())
        self.assertFalse(list(self.case.glob('.tip-target-*')))


if __name__=='__main__':unittest.main(verbosity=2)
