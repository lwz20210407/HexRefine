"""Explicit ring-shoulder connectivity, conservation and real saved-CAD QA.

Select the existing M6 cap with HEXREFINE_CAP_STEP; no warehouse generation.
Actual mesh-only K/INP delivery/read-back is exercised by the task's scratch
driver, using the existing repository formatters rather than a new API.
"""
from dataclasses import replace
import importlib.util
import math
import os
import unittest

import numpy as np

from tools.bolthex.cad_cap_shoulder import (
    ShoulderSpec, _interface_audit, build_m6_shoulder, build_step_ring,
    shoulder_equatorial_interface,
)


class ShoulderInputGuards(unittest.TestCase):
    def test_invalid_angles_directions_and_exact_equator_reject(self):
        spec = replace(ShoulderSpec(), circumferential=384)
        for theta in (np.zeros(384), np.arange(383), np.arange(384)[::-1],
                      np.full(384, float('nan')), np.ones(384, dtype=bool)):
            with self.subTest(theta=theta[:3]), self.assertRaises(ValueError):
                build_step_ring(spec, theta_deg=theta)
        with self.assertRaisesRegex(ValueError, 'directions_xy'):
            build_step_ring(spec, directions_xy=np.zeros((384, 2)))
        with self.assertRaisesRegex(ValueError, 'equator_coordinates'):
            build_step_ring(spec, equator_coordinates=np.zeros((3, 384, 3)))
        with self.assertRaisesRegex(ValueError, 'boolean'):
            build_step_ring(spec, include_upper=1)

    def test_invalid_lower_bore_fields_are_not_silently_clipped(self):
        for field in (np.ones((2, 384)), np.zeros((3, 384)), np.full((3, 384), 4),
                      np.full((3, 384), float('nan')), np.full((3, 384), 2.9)):
            with self.subTest(shape=field.shape), self.assertRaisesRegex(ValueError, 'lower inner-radius'):
                build_step_ring(lower_inner_radii=field)

    def test_invalid_dimensions_and_counts_reject_before_cad(self):
        for changes in (dict(lower_inner=0), dict(outer=3.5), dict(bottom=5), dict(top=4),
                        dict(step=float('nan')), dict(outer=True), dict(circumferential=True),
                        dict(upper_layers=0), dict(wall_radial=1.5), dict(circumferential=1025),
                        dict(circumferential=1024, wall_radial=64)):
            spec = replace(ShoulderSpec(), **changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                build_m6_shoulder(None, spec)

    def test_bad_or_nonmatching_upper_profile_rejects(self):
        for profile in ([3.75], [3.6] * 9, [float('nan')] * 9, [4.5] * 9, [0] * 9):
            with self.subTest(profile=profile), self.assertRaisesRegex(ValueError, 'profile'):
                build_step_ring(upper_inner_radii=profile)

    def test_coarse_circle_rejects_unchanged_volume_gate(self):
        with self.assertRaisesRegex(ValueError, 'exceeds 1e-4'):
            build_step_ring(replace(ShoulderSpec(), circumferential=32))


class AnalyticSteppedAnnulus(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = ShoulderSpec()
        cls.mesh, cls.report = build_step_ring(cls.spec)

    def test_exact_discrete_and_continuum_volumes_are_distinguished(self):
        s, report = self.spec, self.report
        circular = math.pi * ((s.outer**2 - s.lower_inner**2) * (s.step - s.bottom)
                             + (s.outer**2 - s.step_inner**2) * (s.top - s.step))
        polygonal = circular * math.sin(math.tau / s.circumferential) / (math.tau / s.circumferential)
        self.assertAlmostEqual(report['quality']['volume'], polygonal, places=10)
        self.assertAlmostEqual(report['analyticCircularVolumeMm3'], circular, places=10)
        self.assertLess(report['relativeDiscreteVolumeError'], 1e-10)
        self.assertLessEqual(report['relativeAnalyticCircularVolumeError'], 1e-4)

    def test_h8_quality_nondegeneracy_and_periodic_seam(self):
        q = self.report['quality']
        self.assertEqual(q['elements'], 9216)
        self.assertGreaterEqual(q['minimumCornerScaledJacobian'], .15)
        self.assertGreater(q['minimumGaussJacobian'], 0)
        self.assertEqual(q['boundaryEuler'], 0)
        self.assertEqual(q['nonmanifoldFaces'], 0)
        self.assertEqual(q['nonmanifoldBoundaryEdges'], 0)
        self.assertEqual(len(np.unique(self.mesh.nodes, axis=0)), len(self.mesh.nodes))
        self.assertTrue(np.all(np.diff(np.sort(self.mesh.elems, axis=1), axis=1) > 0))

    def test_three_blocks_share_actual_face_ids_and_cell_owners(self):
        expected = {'ledge_to_lower_wall': ({'LEDGE', 'LOWER_WALL'}, 768),
                    'lower_to_upper_wall': ({'LOWER_WALL', 'UPPER_WALL'}, 768)}
        boundary_keys = {tuple(sorted(f)) for faces in self.mesh.surfaces.values() for f in faces}
        for name, (regions, count) in expected.items():
            faces = self.mesh.interface_faces[name]
            self.assertEqual(len(faces), count)
            self.assertEqual(self.report['interfaces'][name]['sharedNodes'], 1152)
            for face, owners in zip(faces, self.mesh.interface_owners[name]):
                self.assertNotIn(tuple(sorted(face)), boundary_keys)
                common = set(self.mesh.elems[owners[0]]) & set(self.mesh.elems[owners[1]])
                self.assertEqual(common, set(face))
                self.assertEqual({self.mesh.regions[i] for i in owners}, regions)

    def test_unshared_interface_is_rejected_not_welded(self):
        from copy import copy

        broken = copy(self.mesh)
        broken.nodes = np.vstack((self.mesh.nodes, self.mesh.nodes))
        broken.elems = self.mesh.elems.copy()
        upper = np.array(self.mesh.regions) == 'UPPER_WALL'
        broken.elems[upper] += len(self.mesh.nodes)
        with self.assertRaisesRegex(ValueError, 'Nonconformal'):
            _interface_audit(broken, broken.interface_faces,
                dict(ledge_to_lower_wall={'LEDGE', 'LOWER_WALL'},
                     lower_to_upper_wall={'LOWER_WALL', 'UPPER_WALL'}))

    def test_artificial_and_physical_boundary_labels_cover_every_free_face(self):
        self.assertEqual(set(self.mesh.surfaces),
                         {'bottom-cut', 'top-cut', 'outer-cut', 'lower-bore', 'ledge', 'upper-bore'})
        self.assertEqual(sum(len(f) for f in self.mesh.surfaces.values()), self.report['quality']['boundaryFaces'])
        self.assertFalse(self.report['fullModelAcceptance'])
        self.assertFalse(self.report['curvedCadMatchingAudited'])

    def test_overlap_output_is_not_exposed_as_a_free_dome_interface(self):
        with self.assertRaisesRegex(ValueError, 'avoid overlap'):
            shoulder_equatorial_interface(self.mesh)


class NonuniformInterface(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        base = np.arctan(np.linspace(-1, 1, 129)[:-1])
        cls.theta = np.rad2deg(np.sort(np.mod(np.concatenate([base + k*math.pi/2 for k in range(4)]), math.tau)))
        cls.spec = replace(ShoulderSpec(), circumferential=512, wall_radial=1, outer=4.75, lower_layers=4)
        directions = np.column_stack((np.cos(np.radians(cls.theta)), np.sin(np.radians(cls.theta))))
        cls.xyz = np.zeros((2, 512, 3))
        cls.xyz[:, :, :2] = np.array([3.75, 4.75])[:, None, None] * directions
        cls.xyz[:, :, 2] = 5
        cls.mesh, cls.report = build_step_ring(cls.spec, theta_deg=cls.theta, directions_xy=directions,
                                               include_upper=False, equator_coordinates=cls.xyz)

    def test_gnomonic_seeds_and_coordinates_are_retained_exactly(self):
        interface = shoulder_equatorial_interface(self.mesh)
        self.assertGreater(np.ptp(np.diff(self.theta)), .1)
        np.testing.assert_array_equal(interface['thetaDeg'], self.theta)
        np.testing.assert_array_equal(interface['coordinates'], self.xyz)
        self.assertEqual(interface['nodeRings'].shape, (2, 512))
        self.assertEqual(interface['faces'].shape, (512, 4))
        self.assertEqual(self.mesh.nodes[:, 2].max(), 5)
        self.assertNotIn('UPPER_WALL', self.mesh.regions)

    def test_free_equator_has_positive_z_normals_and_single_ownership(self):
        interface = shoulder_equatorial_interface(self.mesh)
        xyz = self.mesh.nodes[interface['faces']]
        self.assertTrue(np.all(np.cross(xyz[:, 1]-xyz[:, 0], xyz[:, 2]-xyz[:, 0])[:, 2] > 0))
        keys = {tuple(sorted(f)) for f in self.mesh.surfaces['dome-equator']}
        counts = {k:0 for k in keys}
        from tools.bolthex.mesh_audit import FACES
        for e in self.mesh.elems:
            for face in e[FACES]:
                key = tuple(sorted(face))
                if key in counts:
                    counts[key] += 1
        self.assertEqual(set(counts.values()), {1})

    def test_nonuniform_discrete_volume_and_cyclic_order(self):
        self.assertLess(self.report['relativeDiscreteVolumeError'], 1e-10)
        self.assertLessEqual(self.report['relativeAnalyticCircularVolumeError'], 1e-4)
        rotated = np.roll(self.theta, 73)
        mesh, _ = build_step_ring(self.spec, theta_deg=rotated, include_upper=False)
        np.testing.assert_array_equal(shoulder_equatorial_interface(mesh)['thetaDeg'], rotated)

    def test_theta_z_dependent_bore_preserves_discrete_volume(self):
        field = np.array([3 + .02*(1-k/self.spec.lower_layers)*np.cos(np.radians(self.theta))
                          for k in range(self.spec.lower_layers+1)])
        mesh, report = build_step_ring(self.spec, theta_deg=self.theta, include_upper=False,
                                       lower_inner_radii=field, equator_coordinates=self.xyz)
        self.assertLess(report['relativeDiscreteVolumeError'], 1e-10)
        self.assertGreaterEqual(report['quality']['minimumCornerScaledJacobian'], .15)
        np.testing.assert_array_equal(shoulder_equatorial_interface(mesh)['coordinates'], self.xyz)


@unittest.skipUnless(importlib.util.find_spec('build123d') and os.environ.get('HEXREFINE_CAP_STEP'),
                     'select the real saved M6 cap STEP')
class SavedM6Shoulder(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from build123d import import_step

        cls.shape = import_step(os.environ['HEXREFINE_CAP_STEP'])
        cls.mesh, cls.local, cls.report = build_m6_shoulder(cls.shape,
                replace(ShoulderSpec(), lower_inner=3.1), lower_boundary='artificial-cut')

    def test_source_cad_volume_and_all_boundary_roles(self):
        report = self.report
        self.assertTrue(report['localCadPatchAccepted'])
        self.assertFalse(report['fullModelAcceptance'])
        self.assertLessEqual(report['relativeCadH8VolumeError'], 1e-4)
        self.assertTrue(report['allElementCentroidsInCadCrop'])
        for name, role in report['boundaryMatching'].items():
            self.assertEqual(role['originalCadSurface'], name in ('ledge', 'upper-bore'))
            self.assertLessEqual(role['maximumNodeDistanceMm'], 2e-6)
            self.assertLessEqual(role['maximumFaceCenterDistanceMm'], .02)
        for item in report['artificialCutInteriorWitnesses'].values():
            self.assertGreater(item['distanceToOriginalCadMm'], 2e-6)

    def test_actual_ledge_and_both_shared_interfaces_survive_curved_mapping(self):
        ledge = self.mesh.nodes[self.mesh.surfaces['ledge']]
        self.assertTrue(np.all(ledge[:, :, 2] == 5))
        self.assertAlmostEqual(np.linalg.norm(ledge[:, :, :2], axis=2).min(), 3.1)
        self.assertAlmostEqual(np.linalg.norm(ledge[:, :, :2], axis=2).max(), 3.75)
        self.assertEqual(self.report['interfaces']['lower_to_upper_wall']['sharedFaces'], 768)
        self.assertGreaterEqual(self.report['quality']['minimumCornerScaledJacobian'], .15)

    def test_thread_overlap_crop_fails_with_explicit_matching_gap(self):
        # This wider crop includes the real helical runout. An unthreaded
        # cylinder/shoulder template must not quietly certify that interface.
        spec = replace(ShoulderSpec(), bottom=4.0, lower_layers=4)
        with self.assertRaisesRegex(ValueError, 'Matching gap'):
            build_m6_shoulder(self.shape, spec)

    def test_nominal_cylinder_still_misses_the_real_faded_thread_trim(self):
        distance = min(shell.distance_to((3, 0, 4.9)) for shell in self.shape.shells())
        self.assertGreater(distance, 2e-6)


@unittest.skipUnless(importlib.util.find_spec('build123d') and os.environ.get('HEXREFINE_CAP_STEP')
                     and os.environ.get('HEXREFINE_DOME_EQUATOR'), 'select saved CAD and actual dome-helper equator')
class SavedM6RealRunout(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from build123d import import_step
        cls.eq = np.load(os.environ['HEXREFINE_DOME_EQUATOR'])
        cls.xyz, cls.theta = cls.eq['coordinates'], cls.eq['thetaDeg']
        directions = (cls.xyz[0, :, :2] - cls.eq['centerMm'][:2]) / cls.eq['radiiMm'][0]
        cls.spec = replace(ShoulderSpec(), circumferential=len(cls.theta), outer=4.75,
                           wall_radial=1, lower_layers=8)
        cls.mesh, cls.local, cls.report = build_m6_shoulder(import_step(os.environ['HEXREFINE_CAP_STEP']),
            cls.spec, theta_deg=cls.theta, directions_xy=directions, include_upper=False,
            equator_coordinates=cls.xyz)

    def test_actual_r3_runout_is_followed_not_artificially_cut(self):
        report = self.report
        self.assertTrue(report['originalRunoutFollowed'])
        self.assertEqual(report['lowerBoundaryMode'], 'original-bore')
        self.assertNotIn('lower-cut', self.mesh.surfaces)
        self.assertLess(report['lowerBoreRadiusRangeMm'][0], 2.94)
        self.assertEqual(report['lowerBoreRadiusRangeMm'][1], 3)
        self.assertLessEqual(report['relativeCadH8VolumeError'], 1e-4)
        matching = report['boundaryMatching']['lower-bore']
        self.assertTrue(matching['originalCadSurface'])
        self.assertLessEqual(matching['maximumNodeDistanceMm'], 2e-6)
        self.assertLessEqual(matching['maximumFaceCenterDistanceMm'], .02)
        self.assertEqual(matching['nodeDistanceLimitMm'], 2e-6)
        self.assertEqual(matching['faceCenterDistanceLimitMm'], .02)

    def test_actual_dome_interface_has_exact_coordinates_and_reversed_faces(self):
        interface = shoulder_equatorial_interface(self.mesh)
        np.testing.assert_array_equal(interface['coordinates'], self.xyz)
        np.testing.assert_array_equal(interface['thetaDeg'], self.theta)
        dome_rings = self.eq['nodeRings']
        node_map = dict(zip(dome_rings.ravel(), interface['nodeRings'].ravel()))
        mapped = np.array([[node_map[n] for n in face] for face in self.eq['faces']])
        np.testing.assert_array_equal(mapped[:, [0, 3, 2, 1]], interface['faces'])
        self.assertLessEqual(self.mesh.nodes[:, 2].max(), 5)
        self.assertEqual(len(self.mesh.elems), 12288)
        self.assertGreaterEqual(self.report['quality']['minimumCornerScaledJacobian'], .15)
        self.assertFalse(self.report['fullModelAcceptance'])


if __name__ == '__main__':
    unittest.main()
