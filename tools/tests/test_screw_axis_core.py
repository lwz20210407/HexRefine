"""Finite-core, original-profile, interface and strict-volume regressions."""
from dataclasses import replace
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from tools.bolthex.screw_axis_core import (
    ScrewAxisSpec, axial_stations, boundary_volume, build_axis_section, build_rod,
    generate, plan, profile_radius, require_matching_interface, volume_plan,
    build_periodic_axis_core, original_screw_interface_audit, surface_witnesses, _outer_grid,
)
from tools.bolthex.mesh_audit import FACES
from tools.bolthex.truegrid_screw import ImportedSolids, read_keyword, require_nondegenerate_h8


class PlanningTests(unittest.TestCase):
    def test_exact_bounded_default_counts_before_any_3d_allocation(self):
        info = plan()
        self.assertEqual(info['elements'], 98304)
        self.assertEqual(info['nodes'], 112385)
        self.assertEqual(info['angularSegments'], 384)
        self.assertEqual(info['coarseAngularSegments'], 12)
        self.assertEqual(info['height'], .4)
        self.assertLessEqual(info['elements'], 100000)

    def test_long_original_and_extra_radial_layers_cannot_bypass_budget(self):
        for spec in (ScrewAxisSpec(turns=2), ScrewAxisSpec(thread_radial=2),
                     ScrewAxisSpec(element_limit=90000)):
            with self.subTest(spec=spec), patch('tools.bolthex.screw_axis_core.build_axis_section') as allocation:
                with self.assertRaisesRegex(ValueError, 'Before allocation'):
                    build_rod(spec)
                allocation.assert_not_called()

    def test_invalid_parameters_do_not_allocate(self):
        for key, value in (('pitch', float('nan')), ('root_radius', 0), ('crest_radius', .5),
                           ('turns', True), ('base_sector', 0), ('element_limit', 100001),
                           ('refinement_levels', 7), ('handedness', 'unknown'),
                           ('axial_distribution', 'magic'), ('angular_offset_fraction', 1)):
            with self.subTest(key=key), self.assertRaises(ValueError):
                plan(replace(ScrewAxisSpec(), **{key: value}))

    def test_original_proportions_and_true_helical_phase(self):
        phase = np.array([0, .225, .25, .275, .5, .75, 1.])
        np.testing.assert_allclose(profile_radius(phase), [.9, 1.3, 1.3, 1.3, .9, .9, .9])
        theta = np.linspace(0, 2 * np.pi, 37)
        z = .123
        np.testing.assert_allclose(profile_radius(z / .4 - theta / (2 * np.pi)),
                                   profile_radius((z + .1) / .4 - (theta + np.pi / 2) / (2 * np.pi)))

    def test_seed_phase_not_geometry_change_and_negative_is_not_waived(self):
        positive = volume_plan()
        aligned = volume_plan(ScrewAxisSpec(angular_offset_fraction=0))
        arc = volume_plan(ScrewAxisSpec(angular_offset_fraction=0, axial_distribution='arc_length'))
        self.assertLessEqual(positive['relativeAnalyticVolumeError'], 1e-4)
        self.assertGreater(aligned['relativeAnalyticVolumeError'], 1e-4)
        self.assertGreater(arc['relativeAnalyticVolumeError'], 1e-4)
        self.assertEqual(positive['analyticVolume'], aligned['analyticVolume'])
        self.assertEqual(positive['analyticVolume'], arc['analyticVolume'])
        with patch('tools.bolthex.screw_axis_core.build_axis_section') as allocation:
            with self.assertRaisesRegex(ValueError, 'Before 3D allocation'):
                build_rod(ScrewAxisSpec(angular_offset_fraction=0))
            allocation.assert_not_called()

    def test_axial_redistribution_keeps_planar_ends_and_positive_layers(self):
        theta = np.linspace(0, 2 * np.pi, 73, endpoint=False)
        for distribution in ('uniform', 'arc_length'):
            spec = ScrewAxisSpec(axial_distribution=distribution)
            z = axial_stations(theta, spec)
            np.testing.assert_array_equal(z[0], 0)
            np.testing.assert_array_equal(z[-1], .4)
            self.assertGreater(np.diff(z, axis=0).min(), 0)
            left = axial_stations(-theta, replace(spec, handedness='left'))
            np.testing.assert_allclose(z, left, atol=1e-14)

    def test_independent_skin_integral_of_a_polygonal_cylinder(self):
        theta = np.arange(24) * 2 * np.pi / 24
        levels = np.linspace(0, 2.5, 7)
        grid = np.stack((np.broadcast_to(3 * np.cos(theta), (7, 24)),
                         np.broadcast_to(3 * np.sin(theta), (7, 24)),
                         np.broadcast_to(levels[:, None], (7, 24))), axis=2)
        expected = 24 / 2 * np.sin(2 * np.pi / 24) * 9 * 2.5
        self.assertAlmostEqual(boundary_volume(grid), expected, places=12)

    def test_section_is_finite_filled_disk_with_one_axis_node(self):
        section = build_axis_section()
        xy, q = section['xy'], section['quads']
        self.assertEqual(len(xy), 1729)
        self.assertEqual(len(q), 1536)
        self.assertEqual(np.count_nonzero(np.linalg.norm(xy, axis=1) < 1e-14), 1)
        self.assertEqual(len(np.unique(xy, axis=0)), len(xy))
        self.assertTrue(np.all(np.diff(np.sort(q, axis=1), axis=1) > 0))
        np.testing.assert_allclose(np.linalg.norm(xy[section['supportIDs']], axis=1), .54, atol=1e-14)
        self.assertEqual(len(section['supportIDs']), 384)


class InterfaceTests(unittest.TestCase):
    def setUp(self):
        self.points = np.array([[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], float)
        self.quads = np.array([[0, 1, 2, 3]])

    def test_permuted_ids_and_opposite_face_orientation_can_match(self):
        order = [2, 0, 3, 1]
        inverse = np.argsort(order)
        actual = require_matching_interface(self.points, self.quads,
            self.points[order], inverse[self.quads[:, ::-1]])
        np.testing.assert_array_equal(actual, inverse)

    def test_seed_mismatch_is_an_explicit_template_wall(self):
        with self.assertRaisesRegex(ValueError, 'Template wall / seed mismatch'):
            require_matching_interface(self.points, self.quads, self.points[:3], self.quads)

    def test_axial_or_radial_difference_never_triggers_nearest_point_welding(self):
        for displacement in ([0, 0, .4 / 36], [.36, 0, 0]):
            with self.subTest(displacement=displacement), self.assertRaisesRegex(ValueError, 'Template wall'):
                require_matching_interface(self.points, self.quads, self.points + displacement, self.quads)

    def test_bad_topology_or_coincident_nodes_are_rejected(self):
        for points, q in ((self.points.copy(), np.array([[0, 2, 1, 3]])),
                          (self.points.copy(), np.array([[0, 0, 2, 3]])),
                          (self.points[[0, 0, 2, 3]], self.quads)):
            with self.subTest(q=q.tolist()), self.assertRaises(ValueError):
                require_matching_interface(self.points, self.quads, points, q)

    def rings(self, n=36):
        theta = np.linspace(0, 2 * np.pi, n + 1)
        rings = np.empty((3, n + 1, 3))
        rings[:, :, 0] = .9 * np.cos(theta)
        rings[:, :, 1] = .9 * np.sin(theta)
        rings[:, :, 2] = np.array([0., .2, .4])[:, None]
        rings[:, -1] = rings[:, 0]
        return rings

    def test_finite_core_exactly_preserves_supplied_36_seed_wall(self):
        rings = self.rings()
        core = build_periodic_axis_core(rings)
        self.assertEqual(len(core['mesh'].elems), 360)
        self.assertGreaterEqual(core['quality']['minimumCornerScaledJacobian'], .15)
        self.assertLess(core['relativeVolumeError'], 1e-12)
        np.testing.assert_array_equal(core['mesh'].nodes[core['interfaceNodeIDs']], rings[:, :-1])
        self.assertEqual(len(np.unique(core['mesh'].nodes, axis=0)), len(core['mesh'].nodes))

    def test_wide_single_transition_cannot_relax_sj_gate(self):
        with self.assertRaisesRegex(ValueError, 'H8 quality rejected'):
            build_periodic_axis_core(self.rings(), base_sector=3, refinement_levels=1)

    def test_pitch_offset_seam_is_rejected_not_closed_or_welded(self):
        rings = self.rings()
        rings[:, :, 2] += np.linspace(0, .4, 37)
        with self.assertRaisesRegex(ValueError, 'nonperiodic helical seam'):
            build_periodic_axis_core(rings)

    def test_nonplanar_or_wrong_seed_wall_needs_explicit_transition(self):
        with self.assertRaisesRegex(ValueError, 'seed mismatch'):
            build_periodic_axis_core(self.rings(24))
        rings = self.rings()
        rings[:, 2, 2] += .01
        with self.assertRaisesRegex(ValueError, 'nonplanar'):
            build_periodic_axis_core(rings)

    def test_unknown_original_hash_cannot_use_pinned_eid_layout(self):
        with self.assertRaisesRegex(ValueError, 'reviewed original Screw K hash'):
            original_screw_interface_audit(ImportedSolids(np.zeros((8, 3)), np.arange(8).reshape(1, 8),
                np.arange(8), np.array([1]), np.array([1]), {'*ELEMENT_SOLID': 1}, 'unknown'))


class FieldGateTests(unittest.TestCase):
    def test_node_and_face_limits_are_distinct(self):
        spec = ScrewAxisSpec()
        grid = _outer_grid(spec, plan(spec))
        original = surface_witnesses(grid, spec)
        self.assertEqual(original['nodeLimitMM'], 2e-6)
        self.assertEqual(original['interpolatedFaceCentreLimitMM'], .02)
        self.assertTrue(original['analyticFieldBoundaryAccepted'])
        altered = grid.copy()
        direction = altered[0, 0, :2] / np.linalg.norm(altered[0, 0, :2])
        altered[0, 0, :2] += 3e-6 * direction
        wrong_node = surface_witnesses(altered, spec)
        self.assertFalse(wrong_node['fieldNodesAccepted'])
        self.assertTrue(wrong_node['fieldFaceCentresAccepted'])
        # One entire turn in one axial interval: all nodes exact, faces wrong.
        wrong_faces = surface_witnesses(grid[[0, -1]], spec)
        self.assertTrue(wrong_faces['fieldNodesAccepted'])
        self.assertFalse(wrong_faces['fieldFaceCentresAccepted'])


class CompleteRodTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = build_rod()

    def test_full_bounded_rod_quality_and_actual_nondegeneracy(self):
        mesh, report = self.result['mesh'], self.result['report']
        imported = ImportedSolids(mesh.nodes, mesh.elems, np.arange(1, len(mesh.nodes) + 1),
            np.arange(1, len(mesh.elems) + 1), np.where(self.result['coreMask'], 1, 2),
            {'*ELEMENT_SOLID': len(mesh.elems)}, '')
        actual = require_nondegenerate_h8(imported)
        self.assertEqual(actual['uniqueNodeIDHistogram'], {8: 98304})
        self.assertEqual(actual['uniquePositionHistogram'], {8: 98304})
        self.assertEqual(actual['axisCollapsedElementIDs'], [])
        self.assertGreaterEqual(actual['minimumCornerScaledJacobian'], .15)
        self.assertEqual(report['quality']['boundaryEuler'], 2)
        self.assertFalse(report['originalScrewRepaired'])
        self.assertFalse(report['independentCadVerified'])

    def test_chord_face_witness_is_not_a_nodal_failure_or_cad_certificate(self):
        report = self.result['report']
        witness = report['surfaceWitnesses']['exactRootChordWitness']
        self.assertGreater(witness['distance'], 2e-6)
        self.assertAlmostEqual(witness['distance'], .9 * (1 - np.cos(np.pi / 384)), places=12)
        self.assertLess(witness['distance'], .02)
        self.assertTrue(report['surfaceWitnesses']['fieldNodesAccepted'])
        self.assertTrue(report['surfaceWitnesses']['fieldFaceCentresAccepted'])
        self.assertTrue(report['analyticFieldAccepted'])
        self.assertFalse(report['independentCadAccepted'])
        self.assertLessEqual(report['surfaceWitnesses']['maximumEndPlaneNodeDistanceUpperBound'], 2e-6)
        self.assertLessEqual(report['surfaceWitnesses']['maximumEndPlaneFaceCentreDistanceUpperBound'], .02)

    def test_filled_core_and_volume_conservation_without_hollow_substitution(self):
        report = self.result['report']
        self.assertLess(report['volumeConservationError'], 1e-12)
        self.assertLessEqual(report['plan']['relativeAnalyticVolumeError'], 1e-4)
        self.assertAlmostEqual(report['coreVolume'], report['supportCylinderVolume'], places=12)
        self.assertAlmostEqual(report['coreVolume'] + report['bandVolume'], report['quality']['volume'], places=12)
        mesh = self.result['mesh']
        axis = np.flatnonzero(np.linalg.norm(mesh.nodes[:, :2], axis=1) < 1e-14)
        self.assertEqual(len(axis), 65)
        self.assertTrue(np.all(np.isin(axis, mesh.elems[self.result['coreMask']])))

    def test_every_core_band_interface_face_has_two_owners_and_same_ids(self):
        cells = self.result['mesh'].elems
        expected = set(map(tuple, np.sort(self.result['interfaceQuads'], axis=1)))
        self.assertEqual(len(expected), 24576)
        for selection in (self.result['coreMask'], ~self.result['coreMask']):
            faces = cells[selection][:, FACES].reshape(-1, 4)
            unique, counts = np.unique(np.sort(faces, axis=1), axis=0, return_counts=True)
            boundary = set(map(tuple, unique[counts == 1]))
            self.assertTrue(expected <= boundary)
        self.assertEqual(self.result['report']['sharedInterfaceNodes'], 24960)

    def test_real_surface_nodes_follow_original_tooth_and_have_planar_end_caps(self):
        result = self.result
        points = result['mesh'].nodes[result['surfaceNodeIDs']]
        theta = np.arctan2(points[:, :, 1], points[:, :, 0])
        error = np.max(np.abs(np.linalg.norm(points[:, :, :2], axis=2)
                             - profile_radius(points[:, :, 2] / .4 - theta / (2 * np.pi))))
        self.assertLess(error, 1e-12)
        self.assertEqual(points[:, :, 2].min(), 0)
        self.assertEqual(points[:, :, 2].max(), .4)
        np.testing.assert_array_equal(points[0, :, 2], 0)
        np.testing.assert_array_equal(points[-1, :, 2], .4)

    def test_real_k_inp_export_and_refusal_to_overwrite(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get('BOLTHEX_TEST_ROOT'), prefix='axis-export-') as directory:
            output = Path(directory) / 'rod'
            with patch('tools.bolthex.screw_axis_core.build_rod', return_value=self.result):
                report = generate(ScrewAxisSpec(), output)
            self.assertTrue(report['kReadback']['meshOnlyAccepted'])
            self.assertTrue(report['inpReadback']['exactCoordinates'])
            self.assertTrue(report['inpReadback']['exactComponentOwnership'])
            self.assertTrue((output / 'model.k').stat().st_size < 16 * 1024 ** 2)
            self.assertTrue((output / 'model.inp').stat().st_size < 16 * 1024 ** 2)
            self.assertIn('ORIGINAL SCREW NOT REPAIRED', (output / 'result.txt').read_text())
            with patch('tools.bolthex.screw_axis_core.build_rod') as build:
                with self.assertRaises(FileExistsError):
                    generate(ScrewAxisSpec(), output)
                build.assert_not_called()


@unittest.skipUnless(os.environ.get('SCREW_ORACLE_K'), 'Opt-in read-only original Screw K')
class OriginalOracleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = original_screw_interface_audit(read_keyword(Path(os.environ['SCREW_ORACLE_K'])))

    def test_first_pitch_statistics_exclude_head_and_modulated_tip(self):
        report = self.report
        self.assertEqual(report['angularSeedClasses'], 36)
        self.assertEqual(report['untaperedRootNodes'], 57)
        self.assertLess(report['maximumAngularDriftDegrees'], .001)
        self.assertEqual(report['measuredTaperAngleUnits'], 'degrees')
        self.assertLess(report['maximumDegreePredictionError'], 2e-5)
        self.assertGreater(report['maximumRadianPredictionError'], .1)

    def test_original_is_rejected_with_all_other_bad_cells_retained(self):
        report = self.report
        self.assertFalse(report['compatible'])
        self.assertIn('nonperiodic helical seam', report['templateWall'])
        self.assertEqual(report['originalBadCornerCount'], 2364)
        self.assertEqual(len(report['axisCollapsedElementIDs']), 36)
        self.assertEqual(report['remainingNoncollapsedBadCount'], 2328)
        self.assertEqual(report['deletedElements'], 0)
        self.assertFalse(report['originalScrewAccepted'])
        np.testing.assert_allclose(np.asarray(report['seamDisplacements'])[:, 2], .4)


if __name__ == '__main__':
    unittest.main()
