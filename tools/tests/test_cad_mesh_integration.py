"""Opt-in saved-STEP regression; CAD cases are inputs, never derived from mesh."""
import json
import os
from pathlib import Path
import tempfile
import unittest
import numpy as np
from tools.bolthex.cad_mesh import RadialCad,MeshSeeds,map_saved_cad,estimate_mesh_volume
from tools.bolthex.mesh_audit import audit_h8


@unittest.skipUnless(os.environ.get('HEXREFINE_CAD_FIXTURES'),'saved independent CAD fixtures not selected')
class SavedCadMappingTests(unittest.TestCase):
    def test_saved_bolt_and_nut_are_conforming_and_boundary_volume_is_independent(self):
        root=Path(os.environ['HEXREFINE_CAD_FIXTURES'])
        for case,euler in [('hex-M6',2),('nut-M8',0)]:
            with self.subTest(case=case):
                base=root/case
                mesh,shape,sampler=map_saved_cad(base/'model.step',base/'cad-report.json',MeshSeeds(sector=4,radial=3,per_pitch=6,head=8))
                report,boundary=audit_h8(mesh.nodes,mesh.elems,euler)
                request=json.loads((base/'cad-report.json').read_text())['request']
                estimate=estimate_mesh_volume(sampler,request,MeshSeeds(sector=4,radial=3,per_pitch=6,head=8))
                self.assertLess(abs(estimate-report['volume'])/report['volume'],1e-10)

    def test_trimmed_brep_seam_has_classifier_fallback(self):
        from build123d import import_step
        base=Path(os.environ['HEXREFINE_CAD_FIXTURES'])/'hex-M6'
        shape=import_step(base/'model.step')
        sampler=RadialCad(shape)
        inner,outer=sampler.radii(253.125,-10.421875)
        self.assertEqual(inner,0)
        self.assertGreater(outer,2.4)
        self.assertLess(outer,3.01)
        self.assertGreater(sampler.seam_fallbacks,0)
        self.assertLess(sampler.max_fallback_distance,2e-6)
