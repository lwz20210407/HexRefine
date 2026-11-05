"""Opt-in actual source boundary facts, without welding or a new cap mesh."""
from collections import defaultdict
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from tools.bolthex.truegrid_screw import read_keyword
from tools.bolthex.screw_interface import extract_cavity,skin_topology,_signed_skin_volume
from tools.bolthex import screw_source_boundary as boundary


class SourceQueryGuards(unittest.TestCase):
    quad=np.array([[0,0,0],[1,0,0],[1,1,0],[0,1,0]],dtype=float)
    radial=np.array([[0,0,0],[1,0,0],[0,1,.1],[0,0,.1],
                     [0,0,1],[1,0,1],[0,1,1.1],[0,0,1.1]],dtype=float)

    def test_q4_is_bounded_and_does_not_extrapolate(self):
        np.testing.assert_array_equal(boundary.q4_point(self.quad,[.25,.5]),[.25,.5,0])
        for uv in ([True,False],[-1e-6,.5],[.5,1.000001],[float('nan'),0],[0],['0','1']):
            with self.subTest(uv=uv),self.assertRaises(ValueError):boundary.q4_point(self.quad,uv)
        with self.assertRaises(ValueError):boundary.q4_point(np.zeros((3,3)),[0,0])

    def test_projection_is_an_actual_bounded_witness_not_a_zero_distance_mock(self):
        witness=boundary.project_q4([.3,.6,3e-6],[self.quad])
        self.assertEqual(witness['faceIndex'],0)
        self.assertGreater(witness['distance'],2e-6)
        np.testing.assert_array_equal(boundary.q4_point(self.quad,witness['uv']),witness['point'])
        for point,quads in [([0,0,float('inf')],[self.quad]),([0,0,0],[]),
                             ([0,0,0],[self.quad]*65)]:
            with self.subTest(size=len(quads)),self.assertRaises(ValueError):boundary.project_q4(point,quads)

    def test_radial_certificate_rejects_nonmatching_or_nonfinite_h8(self):
        self.assertAlmostEqual(boundary.radial_cell_certificate(self.radial)['exactUnsignedUnionVolume'],.5)
        for index,axis,value in ((0,0,.1),(5,0,2),(5,2,-1),(0,2,float('nan'))):
            points=self.radial.copy();points[index,axis]=value
            with self.subTest(index=index,axis=axis),self.assertRaises(ValueError):boundary.radial_cell_certificate(points)
        with self.assertRaises(ValueError):boundary.radial_cell_certificate(np.zeros((7,3)))

    def test_signed_flux_is_not_an_arbitrary_open_surface_union_certificate(self):
        open_quad=self.quad+[0,0,1]
        self.assertAlmostEqual(boundary.signed_q4_skin_volume([open_quad],2),1.)
        self.assertEqual(boundary.signed_q4_skin_volume([open_quad],0),0.)
        self.assertAlmostEqual(boundary.signed_q4_skin_volume([open_quad[::-1]],2),-1.)
        for axis in (True,-1,3,'2'):
            with self.subTest(axis=axis),self.assertRaises(ValueError):boundary.signed_q4_skin_volume([open_quad],axis)
        with self.assertRaises(ValueError):boundary.signed_q4_skin_volume([])

    def test_axis_intervals_do_not_fill_real_gaps_or_claim_id_equivalence(self):
        first=boundary.radial_cell_certificate(self.radial)
        second=boundary.radial_cell_certificate(self.radial+[0,0,3])
        self.assertEqual(boundary.source_z_intervals([0,0],[first,second]),[[0.,1.1],[3.,4.1]])
        np.testing.assert_allclose(boundary.source_z_intervals([.2,.2],[first]),[[.05,1.05]],atol=1e-14)
        self.assertEqual(boundary.source_z_intervals([2,2],[first]),[])
        for rows in ([],[first]*13,[dict(first,rootXY=[[0,0],[0,0]])]):
            with self.subTest(count=len(rows)),self.assertRaises(ValueError):boundary.source_z_intervals([0,0],rows)


@unittest.skipUnless(os.environ.get('BOLTHEX_TEST_ROOT'),'Explicit task scratch root required for filesystem guards')
class SourceFileGuards(unittest.TestCase):
    def test_unknown_source_rejects_before_parsing_and_publishes_nothing(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as folder:
            root=Path(folder);source=root/'unknown.k';source.write_text('*KEYWORD\n*END\n')
            before=source.read_bytes()
            with patch.object(boundary,'read_keyword') as reader:
                with self.assertRaisesRegex(ValueError,'SHA256'):boundary.write_contract(source,root/'out')
                reader.assert_not_called()
            self.assertFalse((root/'out').exists());self.assertEqual(source.read_bytes(),before)

    def test_input_budget_rejects_before_hash_or_reader(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as folder:
            source=Path(folder)/'too-big.k';source.write_bytes(b'bounded guard input')
            # Tighten only the test's resource budget; no large file is created.
            with patch.object(boundary,'MAX_BYTES',4),patch.object(boundary,'_sha') as hasher:
                with self.assertRaisesRegex(ValueError,'input budget'):boundary.analyse(source)
                hasher.assert_not_called()

    def test_existing_output_rejects_before_analysis_without_deleting_old_files(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as folder:
            root=Path(folder);out=root/'existing';out.mkdir();old=out/'old.txt';old.write_bytes(b'KEEP')
            with patch.object(boundary,'analyse') as analyse:
                with self.assertRaisesRegex(ValueError,'fresh output'):boundary.write_contract(root/'unused.k',out)
                analyse.assert_not_called()
            self.assertEqual(old.read_bytes(),b'KEEP')


@unittest.skipUnless(os.environ.get('SCREW_ORACLE_K'),'Select the measured readonly original Screw K')
class OriginalSourceBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path=Path(os.environ['SCREW_ORACLE_K'])
        cls.digest=hashlib.sha256(cls.path.read_bytes()).hexdigest()
        cls.mesh=read_keyword(cls.path)
        cls.selected=list(range(2889,2895))+list(range(3969,3975))
        cls.cavity=extract_cavity(cls.mesh,cls.selected)
        cls.coords=dict(zip(map(int,cls.mesh.node_ids),cls.mesh.nodes))
        cls.physical=[r for r in cls.cavity['boundary'] if r['geometry']['q4Area']>1e-14]
        cls.summary,cls.ledger=boundary.analyse(cls.path)

    @classmethod
    def tearDownClass(cls):
        if hashlib.sha256(cls.path.read_bytes()).hexdigest()!=cls.digest:
            raise AssertionError('Read-only original source changed')

    def test_measured_physical_faces_not_artificial_chart_constraints(self):
        self.assertEqual(self.digest,'09c9ce96a5df2d8cf900be8fa716d6a0daf7e80d6cc26955e76e623d45182628')
        self.assertEqual(len(self.cavity['boundary']),40)
        self.assertEqual(len(self.cavity['zeroAreaBoundaryFaceIndices']),12)
        self.assertEqual(len(self.physical),28)
        hard=[r for r in self.physical if r['retained'] is not None]
        self.assertEqual(len(hard),8)
        expected={(eid,4) for eid in range(2889,2895)}|{(2894,5),(3974,5)}
        self.assertEqual({(r['selected']['eid'],r['selected']['localFace']) for r in hard},expected)
        self.assertEqual(len(self.physical)-len(hard),20)
        self.assertEqual(self.summary['actualRetainedFaces'],8)
        self.assertEqual(self.summary['actualEditableFreeFaces'],20)

    def test_nonzero_id_skin_is_open_but_axis_geometric_interval_owners_cancel(self):
        faces=[r['selected']['nodeIDs'] for r in self.physical]
        self.assertFalse(skin_topology(faces)['closed'])
        edges=[];levels=set();nonaxis=defaultdict(list)
        for face_index,f in enumerate(faces):
            for a,b in zip(f,f[1:]+f[:1]):
                p,q=self.coords[a],self.coords[b]
                if np.array_equal(p[:2],[0,0]) and np.array_equal(q[:2],[0,0]):
                    edges.append((float(p[2]),float(q[2]),face_index));levels.update((float(p[2]),float(q[2])))
                else:nonaxis[tuple(sorted((a,b)))].append(face_index)
        self.assertEqual({len(v) for v in nonaxis.values()},{2})
        # Insert even the zero-area-only original station coordinates; this is
        # a diagnostic partition of segments, not an actual mesh-ID mutation.
        for row in self.cavity['boundaryNodes']:
            if row['xyz'][:2]==[0.,0.]:levels.add(row['xyz'][2])
        levels=sorted(levels);self.assertEqual(len(levels)-1,20)
        for low,high in zip(levels,levels[1:]):
            mid=(low+high)/2
            owners=[1 if b>a else -1 for a,b,_ in edges if min(a,b)<mid<max(a,b)]
            with self.subTest(interval=(low,high)):
                self.assertEqual(len(owners),2);self.assertEqual(sum(owners),0)

    def test_source_positive_open_cell_map_gives_actual_unsigned_union_volume(self):
        volume=0.;cells={int(eid):self.mesh.nodes[e] for eid,e in zip(self.mesh.element_ids,self.mesh.elements)}
        for eid in self.selected:
            p=cells[eid]
            np.testing.assert_array_equal(p[[0,3,4,7],:2],np.zeros((4,2)))
            np.testing.assert_array_equal(p[[1,2],:2],p[[5,6],:2])
            np.testing.assert_array_equal(p[[0,3,4,7],2],p[[1,2,5,6],2])
            a,b=p[1,:2],p[2,:2];cross=a[0]*b[1]-a[1]*b[0]
            heights=p[[5,6],2]-p[[1,2],2]
            self.assertGreater(cross,0.);self.assertTrue(np.all(heights>0))
            volume+=float(cross*heights.sum()/4)
        for j in range(6):
            np.testing.assert_array_equal(cells[2889+j][[4,5,6,7]],cells[3969+j][[0,1,2,3]])
        self.assertAlmostEqual(volume,.1687860196548786,places=14)
        self.assertAlmostEqual(volume,self.cavity['sourceSelectedAudit']['integratedVolume'],places=14)
        self.assertAlmostEqual(volume,_signed_skin_volume([r['selected']['nodeIDs'] for r in self.physical],self.coords),places=14)

    def test_original_corner_coincidences_do_not_authorize_id_welding(self):
        np.testing.assert_array_equal(self.coords[3980],[0,0,0])
        coincident=[int(n) for n,p in zip(self.mesh.node_ids,self.mesh.nodes) if np.array_equal(p,self.coords[3980])]
        self.assertEqual(coincident,[3795,3906,3980])
        bindings=[r['selected'] for r in self.physical if 3980 in r['selected']['nodeIDs']]
        self.assertEqual({(r['eid'],r['localFace']) for r in bindings},{(2889,1),(2889,3)})
        self.assertNotIn(3795,{n for r in self.physical for n in r['selected']['nodeIDs']})
        self.assertNotIn(3906,{n for r in self.physical for n in r['selected']['nodeIDs']})

    def test_hard_axis_ids_and_zero_area_only_nodes_are_different_constraints(self):
        axis=lambda n:np.array_equal(self.coords[n][:2],[0,0])
        all_ids={n for r in self.cavity['boundary'] for n in r['selected']['nodeIDs'] if axis(n)}
        physical={n for r in self.physical for n in r['selected']['nodeIDs'] if axis(n)}
        hard={n for r in self.cavity['interface'] for n in r['selected']['nodeIDs'] if axis(n)}
        self.assertEqual(hard,{3992,3993,8310})
        self.assertEqual(all_ids-physical,{3983,3985,3987,3989,3991})
        self.assertEqual([self.coords[n][2] for n in (3980,3992,3993,8310)],
                         [0.,.06666667,.2666667,.4666667])

    def test_repository_source_query_api_and_immutable_producer_trace(self):
        quad=self.ledger['editableFreeFaces'][0]['xyz']
        point=boundary.q4_point(quad,[.3,.6])
        witness=boundary.project_source_free_point(point,self.ledger)
        self.assertLessEqual(witness['distance'],2e-6)
        self.assertFalse(witness['exhaustiveNearestDistanceCertified'])
        self.assertIn(witness['binding'],[r['binding'] for r in self.ledger['editableFreeFaces']])
        intervals=boundary.source_z_intervals(point[:2],self.ledger['radialCellCertificates'])
        self.assertTrue(any(low-1e-12<=point[2]<=high+1e-12 for low,high in intervals))
        self.assertEqual(boundary.source_z_intervals([0,0],self.ledger['radialCellCertificates']),[[0.,.4666667]])
        quads=[r['xyz'] for r in self.ledger['nonzeroPhysicalFaces']]
        for axis in range(3):self.assertAlmostEqual(boundary.signed_q4_skin_volume(quads,axis),.1687860196548786,places=14)
        trace=self.summary['producerTrace']
        self.assertTrue(trace['sourceArraysUnchanged']);self.assertTrue(trace['sourceFileUnchanged'])
        self.assertEqual(trace['sourceArraysSHA256Before'],trace['sourceArraysSHA256After'])

    def test_parser_bytes_must_match_the_hash_checked_before_parsing(self):
        from dataclasses import replace
        with patch.object(boundary,'read_keyword',return_value=replace(self.mesh,source_sha256='different snapshot')):
            with self.assertRaisesRegex(ValueError,'while parsing'):boundary.analyse(self.path)

    @unittest.skipUnless(os.environ.get('BOLTHEX_TEST_ROOT'),'Explicit output root required')
    def test_cli_reproduces_actual_contract_and_refuses_existing_output(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as folder:
            root=Path(folder);out=root/'contract'
            command=[sys.executable,'-B','-m','tools.bolthex.screw_source_boundary',str(self.path),str(out)]
            env={**os.environ,'TEMP':str(root),'TMP':str(root),'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'}
            run=subprocess.run(command,cwd=Path(__file__).resolve().parents[2],env=env,capture_output=True,text=True,timeout=60)
            self.assertEqual(run.returncode,0,run.stdout+run.stderr)
            contract=json.loads((out/'fillable-cavity-contract.json').read_text())
            trace=json.loads((out/'producer-trace.json').read_text())
            self.assertEqual(len(contract['hardFaces']),8)
            self.assertEqual(sum(map(len,contract['editableFreeFaceGroups'].values())),20)
            self.assertTrue(trace['complete']);self.assertEqual(trace['sourceSHA256'],self.digest)
            hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.iterdir()}
            for name,record in trace['outputs'].items():
                self.assertEqual(record['sha256'],hashes[name]);self.assertEqual(record['bytes'],(out/name).stat().st_size)
            self.assertLessEqual(sum(p.stat().st_size for p in out.iterdir()),64*1024*1024)
            run=subprocess.run(command,cwd=Path(__file__).resolve().parents[2],env=env,capture_output=True,text=True,timeout=60)
            self.assertNotEqual(run.returncode,0);self.assertIn('fresh output',run.stderr)
            self.assertEqual(hashes,{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.iterdir()})

    @unittest.skipUnless(os.environ.get('BOLTHEX_TEST_ROOT'),'Explicit output root required')
    def test_output_budget_rejects_before_directory_creation(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as folder:
            out=Path(folder)/'too-large'
            with patch.object(boundary,'MAX_OUTPUT_BYTES',1024):
                with self.assertRaisesRegex(ValueError,'64 MiB'):boundary.write_contract(self.path,out)
            self.assertFalse(out.exists())


if __name__=='__main__':unittest.main()
