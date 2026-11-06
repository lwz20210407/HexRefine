"""Custom annular design, topology, actual trimmed CAD and native IO guards."""
from dataclasses import asdict
import importlib.util
import json
import math
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from tools.bolthex import flat_washer as washer


class WasherPlanTests(unittest.TestCase):
    def test_example_is_bounded_and_dimensions_are_not_compensated(self):
        design = dict(outer_diameter_mm=12., inner_diameter_mm=6.4, thickness_mm=1.6)
        result = washer.plan(design)
        self.assertEqual(result['design'], design)
        self.assertEqual(result['elements'], 6912)
        self.assertEqual(result['nodes'], 10080)
        self.assertLess(result['predictedRelativeVolumeError'], 1e-4)
        self.assertGreater(result['predictedRelativeVolumeError'], 7e-5)
        self.assertAlmostEqual(result['analyticVolume'], math.pi * (6**2 - 3.2**2) * 1.6)

    def test_bad_dimensions_units_and_standard_claims_reject(self):
        for key in asdict(washer.WasherDesign()):
            for value in (True, False, math.nan, math.inf, 0, -1, '12', 1e6, 10**1000):
                with self.subTest(key=key, value=str(value)[:40]), self.assertRaises(ValueError):
                    washer.plan({**asdict(washer.WasherDesign()), key: value})
        for extra in ('standard', 'tolerance_class', 'radial_clearance', 'unit', 'nodes', 'chamfer'):
            with self.assertRaises(ValueError):
                washer.plan({**asdict(washer.WasherDesign()), extra: 'ISO7089'})
        for inner in (12., 13., 11.9999):
            with self.assertRaises(ValueError):
                washer.plan(washer.WasherDesign(inner_diameter_mm=inner))
        with self.assertRaises(ValueError):
            washer.plan({'outer_diameter_mm': 12})

    def test_seed_range_type_and_preallocation_guards(self):
        for seeds in (washer.WasherSeeds(True, 6, 4), washer.WasherSeeds(320, 6, 4),
                      washer.WasherSeeds(288, 0, 4), washer.WasherSeeds(288, 6, 1.5),
                      washer.WasherSeeds(1536, 64, 64), washer.WasherSeeds(288, 65, 1)):
            with self.subTest(seeds=seeds), patch.object(washer, 'build_ring_section') as allocation:
                with self.assertRaises(ValueError):
                    washer.build_mesh(seeds=seeds)
                allocation.assert_not_called()

    def test_insufficient_resolution_fails_before_allocation(self):
        with patch.object(washer, 'build_ring_section') as allocation:
            with self.assertRaisesRegex(ValueError, 'fixed volume'):
                washer.build_mesh(seeds=washer.WasherSeeds(48, 6, 4))
            allocation.assert_not_called()
        with self.assertRaisesRegex(ValueError, 'face-distance'):
            washer.plan(washer.WasherDesign(1000, 500, 5))

    def test_subclass_validation_cannot_bypass_base_guards(self):
        class Forged(washer.WasherSeeds):
            def validate(self):
                return True
        with self.assertRaises(ValueError):
            washer.plan(seeds=Forged(1536, 64, 64))
        class ForgedDesign(washer.WasherDesign):
            def validate(self):
                return True
        with self.assertRaises(ValueError):
            washer.build_cad(ForgedDesign(12, 14, 1.6))

    def test_cad_api_rejects_mesh_fields_before_optional_import(self):
        with self.assertRaises(ValueError):
            washer.build_cad({**asdict(washer.WasherDesign()), 'seeds': [1, 2, 3]})


class WasherMeshTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mesh = washer.build_mesh()
        cls.report = washer.audit_mesh(cls.mesh)

    def test_ring_is_closed_all_h8_and_positive_at_all_sample_sets(self):
        report = self.report
        self.assertEqual(self.mesh.elems.shape, (6912, 8))
        self.assertEqual(report['boundaryCounts'], dict(BOTTOM=1728, TOP=1728, INNER=1152, OUTER=1152))
        self.assertEqual(report['topology']['boundaryEuler'], 0)
        self.assertEqual(report['topology']['nonmanifoldBoundaryEdges'], 0)
        self.assertEqual(report['topology']['projectScaledJacobianFloor'], 0)
        self.assertTrue(report['metrics']['sampledPositiveJacobians'])
        self.assertFalse(report['metrics']['engineeringQualityAccepted'])
        for name in ('minimumCornerDeterminant', 'centerDeterminant', 'minimumGaussDeterminant'):
            self.assertGreater(report['metrics']['metrics'][name]['minimum'], 0)
        self.assertFalse(report['geometryVerified'])
        self.assertIsNone(report['boundaryAssociation'])

    def test_exact_structured_faces_have_no_hanging_or_unmatched_interior_faces(self):
        from tools.bolthex.mesh_audit import FACES
        faces = self.mesh.elems[:, FACES].reshape(-1, 4)
        _, counts = np.unique(np.sort(faces, axis=1), axis=0, return_counts=True)
        self.assertEqual(int((counts == 1).sum()), 5760)
        self.assertTrue(np.all((counts == 1) | (counts == 2)))
        self.assertEqual(len(np.unique(self.mesh.nodes, axis=0)), len(self.mesh.nodes))

    def test_seeds_change_only_discretization_not_geometry_dimensions(self):
        refined = washer.build_mesh(seeds=washer.WasherSeeds(324, 6, 4))
        for mesh in (self.mesh, refined):
            self.assertEqual(mesh.dims['design'], asdict(washer.WasherDesign()))
            radii = np.hypot(mesh.nodes[:, 0], mesh.nodes[:, 1])
            self.assertAlmostEqual(radii.min(), 3.2)
            self.assertAlmostEqual(radii.max(), 6)
            self.assertEqual(mesh.nodes[:, 2].min(), 0)
            self.assertEqual(mesh.nodes[:, 2].max(), 1.6)
        self.assertNotEqual(len(refined.elems), len(self.mesh.elems))

    def test_reversed_duplicate_and_degenerate_cells_reject(self):
        for mutation in ('reverse', 'duplicate', 'collapse'):
            mesh = washer.build_mesh()
            if mutation == 'reverse':
                mesh.elems[0] = mesh.elems[0, [1, 0, 3, 2, 5, 4, 7, 6]]
            elif mutation == 'duplicate':
                mesh.elems[0] = mesh.elems[1]
            else:
                mesh.elems[0, 1] = mesh.elems[0, 0]
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                washer.audit_mesh(mesh)

    def test_geometry_shift_and_duplicate_coordinates_reject(self):
        for mutation in ('shift', 'alias'):
            mesh = washer.build_mesh()
            if mutation == 'shift':
                mesh.nodes[:, 0] += .1
            else:
                mesh.nodes[0] = mesh.nodes[1]
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                washer.audit_mesh(mesh)


CAD_READY = importlib.util.find_spec('build123d') is not None
ROOT_READY = bool(os.environ.get('BOLTHEX_TEST_ROOT'))


@unittest.skipUnless(CAD_READY and ROOT_READY and shutil.which('node'),
                     'Existing CAD/Node runtimes and explicit BOLTHEX_TEST_ROOT required')
class ActualWasherTests(unittest.TestCase):
    def test_real_cad_step_native_k_and_independent_inp_readback(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as folder:
            output = Path(folder) / 'bundle'
            report = washer.generate(washer.WasherDesign(), output)
            cad = json.loads((output / 'cad-report.json').read_text())
            self.assertTrue(cad['geometryIndependentOfMesh'])
            self.assertTrue(cad['matchedMeshVerified'])
            self.assertEqual(cad['matchedKSHA256'], report['kSHA256'])
            self.assertIsNone(cad['standard'])
            self.assertEqual(cad['faces'], 4)
            self.assertLessEqual(cad['relativeReopenVolumeError'], 1e-7)
            self.assertLessEqual(report['relativeMeshVolumeError'], 1e-4)
            self.assertTrue(report['boundaryAssociation']['allBoundaryNodesChecked'])
            self.assertLessEqual(report['boundaryAssociation']['maximumNodeDistanceMM'], 2e-6)
            self.assertLessEqual(report['boundaryAssociation']['maximumFaceCentreDistanceMM'], .02)
            self.assertTrue(report['boundaryAssociation']['boreIsVoid'])
            self.assertFalse(report['nativeHmVerified'])
            self.assertFalse(report['solverVerified'])
            self.assertFalse(report['engineeringQualityAccepted'])
            for name in ('k', 'inp'):
                self.assertTrue(report['readbacks'][name]['sampledPositiveJacobians'])
                self.assertTrue(report['readbacks'][name]['exactConnectivity'])
                self.assertLessEqual(report['readbacks'][name]['relativeCadVolumeError'], 1e-4)
                self.assertLessEqual(report['readbacks'][name]['maximumCadNodeDistanceBoundMM'], 2e-6)
            self.assertEqual(set(p.name for p in output.iterdir()),
                             {'model.step', 'model.k', 'model.inp', 'cad-report.json', 'report.json'})
            self.assertLess(sum(p.stat().st_size for p in output.iterdir()), 4 * 1024 * 1024)
            before = {p.name: p.read_bytes() for p in output.iterdir()}
            with patch.object(washer, 'build_cad') as build:
                with self.assertRaisesRegex(ValueError, 'new output'):
                    washer.generate(washer.WasherDesign(), output)
                build.assert_not_called()
            self.assertEqual(before, {p.name: p.read_bytes() for p in output.iterdir()})

    def test_actual_wrong_cad_volume_shape_or_location_cannot_pass(self):
        from build123d import Cylinder
        shape = washer.build_cad()
        for altered in (shape.translate((.1, 0, 0)), Cylinder(6, 1.6),
                        washer.build_cad(washer.WasherDesign(12, 6.5, 1.6))):
            with self.assertRaises(ValueError):
                washer._cad_faces(altered, washer.WasherDesign())

    def test_failure_does_not_publish_output_or_leave_staging(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as folder:
            output = Path(folder) / 'failed'
            with patch.object(washer, 'audit_mesh', side_effect=ValueError('forced audit failure')):
                with self.assertRaisesRegex(ValueError, 'forced audit failure'):
                    washer.generate(washer.WasherDesign(), output)
            self.assertFalse(output.exists())
            self.assertEqual(list(Path(folder).iterdir()), [])


if __name__ == '__main__':
    unittest.main()
