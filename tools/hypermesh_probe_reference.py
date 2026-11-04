"""Build independent trimmed-CAD local controls; no host or mesh generation."""
import argparse,json,math
from pathlib import Path
from tools.hypermesh_geometry_probe import sha,validate_reference


def offset_points(point,steps):
    if len(point)!=3 or any(type(v) not in (int,float) or not math.isfinite(v) for v in point):raise ValueError('Finite 3D point required')
    if not isinstance(steps,(tuple,list)) or not 1<=len(steps)<=6 or any(type(v) not in (int,float) or not math.isfinite(v) or not 0<v<=1 for v in steps):raise ValueError('Require 1..6 positive offsets at most 1 mm')
    for axis in range(3):
        for step in steps:
            for sign in (-1,1):
                candidate=list(point);candidate[axis]+=sign*step
                yield candidate,axis,sign*step


class TrimmedFaceDistances:
    def __init__(self,shape):
        import numpy as np
        self.np=np;self.faces=[]
        for face in shape.faces():
            bounds=face.bounding_box()
            self.faces.append((face,np.array(tuple(bounds.min)),np.array(tuple(bounds.max))))
        if not self.faces or not shape.is_valid:raise ValueError('Require valid source CAD with trimmed faces')

    def __call__(self,point):
        np=self.np;xyz=np.asarray(point)
        candidates=sorted((float(np.linalg.norm(np.maximum(np.maximum(lo-xyz,xyz-hi),0))),i)
                          for i,(_,lo,hi) in enumerate(self.faces))
        best=float('inf')
        for lower,i in candidates:
            if lower>best+1e-10:break
            best=min(best,self.faces[i][0].distance_to(tuple(point)))
        if not math.isfinite(best):raise ValueError('Source trimmed-face distance failed')
        return best


def build_reference(step,base_reference,output,focus,steps=(.00002,.0002,.02)):
    step,base_reference,output=map(lambda p:Path(p).resolve(),(step,base_reference,output))
    if output.exists() or not output.parent.is_dir():raise ValueError('Require a new reference file in an existing output directory')
    if base_reference.stat().st_size>2097152:raise ValueError('Reference exceeds 2 MiB')
    base_hash=sha(base_reference)
    reference=json.loads(base_reference.read_text());validate_reference(reference)
    if sha(step)!=reference.get('sourceStepSHA256'):raise ValueError('Source CAD hash differs')
    points=reference['points']
    if not isinstance(focus,(tuple,list)) or not 1<=len(focus)<=16 or any(type(i) is not int for i in focus) or len(set(focus))!=len(focus):raise ValueError('Require 1..16 unique focus indices')
    for index in focus:
        if type(index) is not int or not 0<=index<len(points) or points[index]['role']=='control':raise ValueError('Focus must identify source surface witnesses')
    candidates=[(index,p,axis,offset) for index in focus for p,axis,offset in offset_points(points[index]['point'],steps)]
    if len(points)+len(candidates)>4096:raise ValueError('Expanded reference exceeds the 4096-point probe budget')
    from build123d import import_step
    distance=TrimmedFaceDistances(import_step(step));expanded=[];excluded=0;maximum_recheck=0.
    for row in points:
        measured=distance(row['point']);error=abs(measured-row['sourceDistance'])
        maximum_recheck=max(maximum_recheck,error)
        if error>2e-6 or (row['role']!='control' and measured>2e-6):raise ValueError('Base witness does not match the saved trimmed CAD')
        expanded.append(dict(row,sourceDistance=measured))
    for index,point,axis,offset in candidates:
        d=distance(point)
        if d<=4e-6:excluded+=1;continue
        expanded.append(dict(point=point,role='control',sourceDistance=d,originIndex=index,offsetAxis=axis,offset=offset))
    if len(expanded)==len(points):raise ValueError('No independently positive local controls were produced')
    result=dict(schemaVersion=2,sourceStepSHA256=reference['sourceStepSHA256'],baseReferenceSHA256=base_hash,points=expanded,
                calibration=dict(kind='axis-offsets-to-trimmed-source-faces',focusIndices=focus,stepsMm=steps,
                                 addedControls=len(expanded)-len(points),excludedTangentOffsets=excluded,maximumBaseDistanceRecheckError=maximum_recheck),
                exactNativeCadCertified=False)
    validate_reference(result)
    if sha(step)!=reference['sourceStepSHA256'] or sha(base_reference)!=base_hash:raise ValueError('Source CAD or base reference changed during reference construction')
    with output.open('x',encoding='utf8') as stream:json.dump(result,stream,indent=2,allow_nan=False)
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('step',type=Path)
    parser.add_argument('base_reference',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--focus',type=int,nargs='+',required=True)
    args=parser.parse_args();result=build_reference(args.step,args.base_reference,args.output,args.focus)
    print(json.dumps(result['calibration']))
