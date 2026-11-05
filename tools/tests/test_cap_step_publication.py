"""Actual bounded STEP/K/INP publication; no large fidelity mesh allocation."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

import numpy as np

from tools.bolthex.cad_cap_dome import _publish_partition
from tools.bolthex.cad_mesh_pipeline import _sha
from tools.bolthex.mesh_audit import audit_h8
from tools.bolthex.mesh_core import Mesh3D


@unittest.skipUnless(importlib.util.find_spec('build123d') and os.environ.get('BOLTHEX_TEST_ROOT')
                     and os.environ.get('HEXREFINE_NODE'),'Explicit CAD/Node runtimes and scratch root required')
class CapPublicationTests(unittest.TestCase):
    def test_actual_small_design_step_k_inp_and_parent_preservation(self):
        from build123d import Compound,Solid,export_step,import_step
        from tools.bolthex.standard_cad import _mass
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as folder:
            root=Path(folder)
            selected=Solid.make_box(1,1,1)
            sibling=Solid.make_box(2,2,2).translate((10,0,0))
            parent=Compound(children=[selected,sibling])
            source=root/'source.step'
            # The input file contains just the selected independent design solid.
            export_step(Solid.make_box(1,1,1),source)
            digest=_sha(source);children=tuple(parent.children)
            mesh=Mesh3D('CAP_PUBLICATION_SMOKE')
            mesh.nodes=np.array([[0,0,0],[1,0,0],[1,1,0],[0,1,0],
                                 [0,0,1],[1,0,1],[1,1,1],[0,1,1]],dtype=float)
            mesh.elems=np.arange(8,dtype=np.int64)[None,:]
            quality,_=audit_h8(mesh.nodes,mesh.elems,2)
            report=dict(quality=quality,sourceCadPartitionVolume=1.,fullCapNut=False,
                        sourceCadUnmodified=True,developmentOnly=True)
            output=root/'accepted'
            result=_publish_partition(source,output,Path(os.environ['HEXREFINE_NODE']),
                                      mesh,selected,report,digest)
            self.assertEqual(result['cadExchangeMethod'],'detached-deep-clone-BRep-STEP-export-and-reimport')
            self.assertEqual(result['cadGeometryExchange']['outputStep'],str(output/'model.step'))
            self.assertTrue(result['cadGeometryExchange']['sourceAssemblyUnmodified'])
            self.assertIs(selected.parent,parent)
            self.assertEqual(tuple(parent.children),children)
            self.assertEqual(_sha(source),digest)
            reopened=import_step(output/'model.step')
            self.assertEqual(len(reopened.solids()),1)
            self.assertAlmostEqual(_mass(reopened),1.,places=10)
            self.assertLess(reopened.bounding_box().max.X,1.000001)
            for name in ('model.k','model.inp','model.step','report.json'):
                self.assertTrue((output/name).is_file())
            self.assertFalse((output/'nodes.f64').exists())


if __name__=='__main__':unittest.main()
