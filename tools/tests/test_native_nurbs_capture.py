import copy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools.bolthex.native_nurbs_capture import (
    MAX_FACES,
    reconstruct_capture, reconstruct_nurbs, validate_native_samples,
    validate_nurbs_record, verify_capture,
)


CAD = importlib.util.find_spec('OCP') is not None


def bezier_record(rational=(False,False)):
    nu,nv=3,4
    poles=[[i*i+.3*j,2*j+.2*i, i*j+.7*i-.4*j*j] for j in range(nv) for i in range(nu)]
    weights=([1.+.2*i+.3*j for j in range(nv) for i in range(nu)] if all(rational)
             else [1.,2.,.5] if rational[0] else [1.,.6,2.,1.5] if rational[1] else [])
    row=dict(index=0,type=6,degree=[2,3],shape=[nu,nv],rational=list(rational),normalSense=False,
             uv=[2.,7.,-3.,9.],uKnots=[2.]*3+[7.]*3,vKnots=[-3.]*4+[9.]*4,
             polesUFast=poles,weights=weights)
    row['untrimmedMidpoint']=bezier_value(row,4.5,3.)
    return row


def bezier_value(row,u,v):
    """Independent Bernstein test oracle, not a production NURBS evaluator."""
    a,b,c,d=row['uv'];s=(u-a)/(b-a);t=(v-c)/(d-c)
    p,q=row['degree'];nu,nv=row['shape'];ur,vr=row['rational']
    numerator=[0.,0.,0.];denominator=0.
    for j in range(nv):
        for i in range(nu):
            weights=row['weights']
            w=weights[j*nu+i] if ur and vr else weights[i] if ur else weights[j] if vr else 1.
            coefficient=math.comb(p,i)*s**i*(1-s)**(p-i)*math.comb(q,j)*t**j*(1-t)**(q-j)*w
            denominator+=coefficient
            for k in range(3):numerator[k]+=coefficient*row['polesUFast'][j*nu+i][k]
    return [x/denominator for x in numerator]


def document(row=None):
    return dict(complete=True,faceCount=1,faces=[bezier_record() if row is None else row])


class CaptureSchemaTests(unittest.TestCase):
    def test_bad_degrees_counts_flags_or_bounds_reject_before_occt(self):
        changes=[('degree',[True,3]),('degree',[0,3]),('degree',[26,3]),('degree',[3,3]),
                 ('shape',[513,4]),('shape',[512,512]),('shape',[2,4]),
                 ('rational',[1,False]),('normalSense',1),('type',3),('index',-1),
                 ('uv',[7.,2.,-3.,9.]),('uv',[2.,7.,3.,3.]),('uv',[1.,7.,-3.,9.])]
        for key,value in changes:
            row=bezier_record();row[key]=value
            with self.subTest(key=key,value=value),patch('tools.bolthex.native_nurbs_capture._build') as build:
                with self.assertRaises(ValueError):reconstruct_nurbs(row)
                build.assert_not_called()

    def test_nonfinite_strings_booleans_huge_values_and_wrong_counts_reject(self):
        for value in (math.nan,math.inf,-math.inf,True,'1',10**1000):
            row=bezier_record();row['polesUFast'][0][0]=value
            with self.subTest(value=str(value)[:30]),self.assertRaises(ValueError):validate_nurbs_record(row)
        for key in ('polesUFast','uKnots','vKnots','uv','untrimmedMidpoint'):
            row=bezier_record();row[key]=row[key][:-1]
            with self.subTest(key=key),self.assertRaises(ValueError):validate_nurbs_record(row)

    def test_compact_rational_weights_have_exact_required_sizes_and_positive_values(self):
        for flags,count in (((False,False),0),((True,False),3),((False,True),4),((True,True),12)):
            row=bezier_record(flags);self.assertEqual(len(validate_nurbs_record(row).compact_weights),count)
            for replacement in ([1.]*(count+1),[0.]*count if count else [1.],[-1.]*count if count else [False]):
                invalid=copy.deepcopy(row);invalid['weights']=replacement
                with self.subTest(flags=flags,weights=replacement),self.assertRaises(ValueError):validate_nurbs_record(invalid)
        for value in (math.nan,True,1e-13,1e13):
            row=bezier_record((True,False));row['weights'][0]=value
            with self.subTest(value=value),self.assertRaises(ValueError):validate_nurbs_record(row)

    def test_expanded_knots_must_be_sorted_clamped_and_count_consistent(self):
        for replacement in ([2.,2.,3.,7.,7.,7.],[2.,2.,2.,7.,6.,7.],[2.]*6,[2.,2.,2.,7.,7.],
                            [2.,2.,2.,math.nan,7.,7.]):
            row=bezier_record();row['uKnots']=replacement
            with self.subTest(knots=replacement),self.assertRaises(ValueError):validate_nurbs_record(row)

    def test_capture_must_be_complete_unique_and_not_silently_skip_bad_nurbs(self):
        for update in (dict(complete=1),dict(complete=False),dict(faceCount=True),dict(faceCount=2),dict(faceCount=MAX_FACES+1)):
            raw=document();raw.update(update)
            with self.subTest(update=update),self.assertRaises(ValueError):reconstruct_capture(raw)
        raw=dict(complete=True,faceCount=2,faces=[bezier_record(),bezier_record()])
        with self.assertRaisesRegex(ValueError,'unique'):reconstruct_capture(raw)
        raw=document();raw['faces'][0]['type']=True
        with self.assertRaises(ValueError):reconstruct_capture(raw)

    def test_all_records_preflight_before_any_occt_allocation(self):
        first=bezier_record();second=bezier_record();second['index']=1;second['weights']=[1.]
        raw=dict(complete=True,faceCount=2,faces=[first,second])
        with patch('tools.bolthex.native_nurbs_capture._build') as build:
            with self.assertRaises(ValueError):reconstruct_capture(raw)
            build.assert_not_called()
        with patch('tools.bolthex.native_nurbs_capture.MAX_CAPTURE_POLES',1), \
                patch('tools.bolthex.native_nurbs_capture._build') as build:
            with self.assertRaisesRegex(ValueError,'total control-pole'):reconstruct_capture(document())
            build.assert_not_called()

    def test_embedded_native_samples_are_bounded_and_validated_before_allocation(self):
        for samples in ([],None,[dict(uv=[1.,3.],point=[0.,0.,0.])],
                        [dict(uv=[4.,3.],point=[0.,math.nan,0.])]):
            row=bezier_record();row['nativeSamples']=samples
            with self.subTest(samples=samples),patch('tools.bolthex.native_nurbs_capture._build') as build:
                with self.assertRaises(ValueError):reconstruct_capture(document(row))
                build.assert_not_called()
        row=bezier_record();row['nativeSamples']=[dict(uv=[4.5,3.],point=row['untrimmedMidpoint'])]
        with patch('tools.bolthex.native_nurbs_capture.MAX_TOTAL_SAMPLES',0), \
                patch('tools.bolthex.native_nurbs_capture._build') as build:
            with self.assertRaisesRegex(ValueError,'embedded native sample budget'):reconstruct_capture(document(row))
            build.assert_not_called()


@unittest.skipUnless(CAD,'Optional OCCT runtime required')
class NurbsMathTests(unittest.TestCase):
    def test_nonuniform_parameter_bezier_and_all_four_rational_layouts_match_independent_grid(self):
        for flags in ((False,False),(True,False),(False,True),(True,True)):
            with self.subTest(flags=flags):
                row=bezier_record(flags);before=copy.deepcopy(row);support=reconstruct_nurbs(row)
                samples=[dict(uv=[u,v],point=bezier_value(row,u,v))
                         for u in (2.,2.3,3.1,4.5,6.8,7.) for v in (-3.,-1.2,0.,3.,8.1,9.)]
                result=validate_native_samples(support,samples)
                self.assertLessEqual(result['maximumSampleError'],1e-10)
                self.assertEqual(support.definition.uv,tuple(row['uv']))
                self.assertEqual(row,before)
                self.assertFalse(result['trimmedCadVerified']);self.assertFalse(result['nativeHmVerified'])
                for j in range(4):
                    for i in range(3):
                        self.assertEqual(tuple(support.surface.Pole(i+1,j+1).Coord()),tuple(row['polesUFast'][j*3+i]))
                        self.assertEqual(support.surface.Weight(i+1,j+1),support.definition.weight(i,j))

    def test_normal_sense_is_metadata_not_a_parameter_reversal(self):
        row=bezier_record();a=reconstruct_nurbs(row);row['normalSense']=True;b=reconstruct_nurbs(row)
        for u,v in ((2.,-3.),(3.1,8.),(7.,9.)):
            self.assertEqual(a.value(u,v),b.value(u,v))

    def test_piecewise_nonuniform_knots_preserve_unique_values_and_multiplicities(self):
        row=dict(index=0,type=6,shape=[3,2],degree=[1,1],rational=[False,False],normalSense=True,
            uv=[2.,5.,-7.,4.],uKnots=[2.,2.,3.,5.,5.],vKnots=[-7.,-7.,4.,4.],weights=[],
            polesUFast=[[x,2.*j,x+j] for j in range(2) for x in (0.,1.,3.)],untrimmedMidpoint=[1.5,1.,2.])
        support=reconstruct_nurbs(row)
        self.assertEqual(support.definition.u_knots,(2.,3.,5.));self.assertEqual(support.definition.u_mults,(2,1,2))
        for u,x in ((2.,0.),(2.5,.5),(3.,1.),(4.,2.),(5.,3.)):
            for v,t in ((-7.,0.),(-1.5,.5),(4.,1.)):
                self.assertLessEqual(math.dist(support.value(u,v),(x,2*t,x+t)),1e-12)

    def test_bad_native_midpoint_or_grid_sample_cannot_pass(self):
        row=bezier_record();row['untrimmedMidpoint'][0]+=1e-8
        with self.assertRaisesRegex(ValueError,'midpoint mismatch'):reconstruct_nurbs(row)
        row=bezier_record();support=reconstruct_nurbs(row)
        for samples in ([],[dict(uv=[4.,3.],point=[0.,0.,0.])],
                        [dict(uv=[4.,3.],point=[math.nan,0.,0.])],
                        [dict(uv=[1.,3.],point=[0.,0.,0.])]):
            with self.subTest(samples=samples),self.assertRaises(ValueError):validate_native_samples(support,samples)
        with self.assertRaises(ValueError):support.value(True,3.)

    def test_only_nurbs_are_built_and_native_indices_do_not_imply_source_face_ids(self):
        row=bezier_record();row['index']=1
        result=reconstruct_capture(dict(complete=True,faceCount=2,faces=[dict(index=0,type=3),row]))
        self.assertEqual(list(result),[1]);self.assertEqual(result[1].definition.index,1)

    def test_embedded_non_midpoint_mismatch_cannot_hide_behind_good_midpoint(self):
        row=bezier_record();p=bezier_value(row,3.,5.)
        row['nativeSamples']=[dict(uv=[3.,5.],point=p)]
        reconstruct_nurbs(row)
        row['nativeSamples'][0]['point'][0]+=1e-8
        with self.assertRaisesRegex(ValueError,'Native sample mismatch'):reconstruct_nurbs(row)


@unittest.skipUnless(CAD and os.environ.get('BOLTHEX_TEST_ROOT'),'Dated scratch output and OCCT required')
class CaptureFileTests(unittest.TestCase):
    def test_bounded_read_duplicate_keys_nonfinite_json_and_empty_data_reject(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as tmp:
            p=Path(tmp)/'capture.json'
            for raw in ('','{"complete":true,"complete":false}','{"value":NaN}'):
                p.write_text(raw)
                with self.subTest(raw=raw),self.assertRaises(ValueError):verify_capture(p)
            p.write_text(json.dumps(document()))
            with patch('tools.bolthex.native_nurbs_capture.MAX_CAPTURE_BYTES',16):
                with self.assertRaisesRegex(ValueError,'16 MiB'):verify_capture(p)

    def test_verified_file_keeps_hash_and_explicit_samples_separate(self):
        with tempfile.TemporaryDirectory(dir=os.environ['BOLTHEX_TEST_ROOT']) as tmp:
            p=Path(tmp)/'capture.json';row=bezier_record();p.write_text(json.dumps(document(row)))
            before=hashlib.sha256(p.read_bytes()).hexdigest()
            extra={0:[dict(uv=[2.,9.],point=bezier_value(row,2.,9.))]}
            supports,report=verify_capture(p,extra)
            self.assertEqual(report['captureSHA256'],before);self.assertEqual(report['reconstructedNurbs'],1)
            self.assertEqual(report['additionalNativeSamples'],1)
            self.assertFalse(report['fullModelAcceptance']);self.assertFalse(report['trimmedCadVerified'])
            self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),before)
            with self.assertRaises(ValueError):verify_capture(p,{1:extra[0]})
            with self.assertRaises(ValueError):verify_capture(p,{0:[]})


@unittest.skipUnless(CAD and os.environ.get('HEXREFINE_NATIVE_CAPTURE'),'Explicit actual SDK capture required')
class SavedNativeNurbsTests(unittest.TestCase):
    def test_all_64_genuine_supports_match_native_midpoints_without_trims_or_source_changes(self):
        p=Path(os.environ['HEXREFINE_NATIVE_CAPTURE']);before=hashlib.sha256(p.read_bytes()).hexdigest()
        supports,r=verify_capture(p)
        self.assertEqual(r['nativeFaces'],101);self.assertEqual(r['reconstructedNurbs'],64)
        self.assertEqual(r['skippedNonNurbs'],37);self.assertEqual(r['nativeMidpointsChecked'],64)
        self.assertLessEqual(r['maximumNativeMidpointError'],1e-10)
        self.assertEqual(r['additionalNativeSamples'],0)
        self.assertTrue(all(s.definition.rational==(False,False) for s in supports.values()))
        self.assertTrue(r['mathematicalSupportOnly']);self.assertFalse(r['trimmedCadVerified'])
        self.assertFalse(r['nativeHmVerified']);self.assertFalse(r['parametersNormalized'])
        self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),before)
        print(f"Genuine SDK capture: 64/64 native midpoints, maximum error {r['maximumNativeMidpointError']:.17g}; untrimmed supports only")


@unittest.skipUnless(CAD and os.environ.get('HEXREFINE_NATIVE_GRID_CAPTURE'),'Explicit actual SDK grid capture required')
class SavedNativeGridTests(unittest.TestCase):
    def test_all_576_actual_native_samples_match_without_parsing_trims(self):
        path=Path(os.environ['HEXREFINE_NATIVE_GRID_CAPTURE']);before=hashlib.sha256(path.read_bytes()).hexdigest()
        supports,r=verify_capture(path)
        self.assertEqual(len(supports),64);self.assertEqual(r['embeddedNativeSampleFaces'],64)
        self.assertEqual(r['embeddedNativeSamplesChecked'],576)
        self.assertTrue(r['embeddedSamplesOnEveryNurbs'])
        self.assertLessEqual(r['maximumEmbeddedNativeSampleError'],1e-10)
        self.assertFalse(r['trimmedCadVerified']);self.assertFalse(r['fullModelAcceptance'])
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),before)
        print(f"Genuine SDK grid: 576/576 points, maximum error {r['maximumEmbeddedNativeSampleError']:.17g}; no trim interpretation")


if __name__=='__main__':unittest.main()
