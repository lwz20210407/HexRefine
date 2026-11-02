import os
from pathlib import Path
import unittest
import numpy as np
from tools.bolthex.cad_mesh import MeshSeeds
from tools.bolthex.cad_runout import NutRunoutMap


class RunoutOptionGuards(unittest.TestCase):
    def test_smoke_fixture_selects_only_a_few_local_columns(self):
        from tools.bolthex.dev_smoke import local_section,MAX_PATCH_H8
        from tools.bolthex.mesh_core import build_nut_section
        section=local_section(build_nut_section(48,3,8,13),dict(refA=290,refB=291.25),288)
        self.assertEqual(len(section.quads),15)
        self.assertLess(len(section.quads)*8,MAX_PATCH_H8)

    def test_unknown_mapping_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'boundary_mapping'):
            MeshSeeds(boundary_mapping='silently-fallback').validate()
        MeshSeeds(boundary_mapping='runout').validate()

    def test_undersampled_runout_is_rejected_before_cad_calls(self):
        with self.assertRaisesRegex(ValueError,'96 circumferential'):
            NutRunoutMap(None,48,1.25)


@unittest.skipUnless(os.environ.get('HEXREFINE_CAD_FIXTURES'),'saved independent STEP not selected')
class SavedRunoutCadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from build123d import import_step
        from tools.bolthex.cad_mesh import RadialCad
        cls.sampler=RadialCad(import_step(Path(os.environ['HEXREFINE_CAD_FIXTURES'])/'nut-M8/model.step'),True)
        cls.mapping=NutRunoutMap(cls.sampler,288,1.25)

    def test_original_caps_and_noncollapsing_one_sided_threshold(self):
        self.assertEqual(len(self.mapping.caps),2)
        cap=min(self.mapping.caps,key=lambda c:c['zmin'])
        self.assertAlmostEqual(cap['theta'],270,places=5)
        root=next(z for z in self.mapping.axial_features() if .27<z<.29)
        outer,inner=self.mapping.boundaries(root)
        ia=round(cap['refA']*288/360)%288
        ib=round(cap['refB']*288/360)%288
        self.assertGreater(np.linalg.norm(inner[ia]),3.99)
        self.assertLess(np.linalg.norm(inner[ib]),3.99)
        self.assertGreater(np.linalg.norm(inner[ia]-inner[ib]),.0249)
        self.assertLess(self.mapping.maximum_snapped_distance,2e-6)

    def test_cap_axial_support_does_not_move_distant_sections(self):
        outer,inner=self.mapping.boundaries(3.4)
        for i in range(0,288,23):
            theta=i*360/288
            r=self.sampler.radii(theta,3.4)[0]
            expected=r*np.array([np.cos(np.radians(theta)),np.sin(np.radians(theta))])
            np.testing.assert_allclose(inner[i],expected,atol=1e-12)


if __name__=='__main__':unittest.main()
