"""Independent axial joint planning; no BoltPro code or target runtime needed.

This plans axial interface coordinates, not full radial/face compatibility.
Geometry is preserved by default; bounded seed compensation is explicit.
"""
from dataclasses import asdict,dataclass
from fractions import Fraction
import math


@dataclass(frozen=True)
class JointAxialSpec:
    pitch:float=2.
    thread_length:float=16.
    nut_height:float=13.
    shank_length:float=8.
    plate_thickness:float=4.
    plate_count:int=2
    axial_per_pitch:int=4
    axial_per_plate:int=2
    seed_limit:int=256
    layer_limit:int=20000


def _decimal(value,name,zero=False):
    if type(value) not in (int,float) or not math.isfinite(value) or value<0 or (not zero and value==0):
        raise ValueError(f'{name} must be finite and '+('nonnegative' if zero else 'positive'))
    return Fraction(str(value))


def _common_step(*values):
    values=[v for v in values if v>0]
    denominator=math.lcm(*(v.denominator for v in values))
    numerator=math.gcd(*(v.numerator*(denominator//v.denominator) for v in values))
    return Fraction(numerator,denominator)


def plan_joint_axial(spec=JointAxialSpec(),policy='preserve_geometry'):
    if not isinstance(spec,JointAxialSpec):raise ValueError('Expected JointAxialSpec')
    if policy not in ('preserve_geometry','snap_dimensions'):
        raise ValueError('Unknown axial planning policy')
    for name,lo,hi in [('plate_count',0,64),('axial_per_pitch',2,256),('axial_per_plate',1,256),
                       ('seed_limit',2,256),('layer_limit',1,20000)]:
        value=getattr(spec,name)
        if type(value) is not int or not lo<=value<=hi:raise ValueError(f'{name} must be an integer in [{lo},{hi}]')
    p,b,m,l,t=[_decimal(getattr(spec,name),name,name=='shank_length')
               for name in ('pitch','thread_length','nut_height','shank_length','plate_thickness')]
    thread_step=p/spec.axial_per_pitch
    plate_step=t/spec.axial_per_plate
    if policy=='preserve_geometry':
        thread_step=_common_step(thread_step,b,m)
        if spec.plate_count:plate_step=_common_step(plate_step,l)
        effective=dict(thread_length=b,nut_height=m,shank_length=l)
    else:
        # Exact decimal ties-to-even, not a silent binary-float approximation.
        effective=dict(thread_length=max(1,round(b/thread_step))*thread_step,
                       nut_height=max(1,round(m/thread_step))*thread_step,
                       shank_length=0 if l==0 else max(1,round(l/plate_step))*plate_step)
    per_pitch=p/thread_step;per_plate=t/plate_step
    if per_pitch.denominator!=1 or per_plate.denominator!=1:raise ValueError('Incompatible axial seed arithmetic')
    if max(per_pitch,per_plate)>spec.seed_limit:raise ValueError('Exact geometry-preserving alignment exceeds the seed limit')
    eb,em,el=[effective[n] for n in ('thread_length','nut_height','shank_length')]
    if em>eb:raise ValueError('Nut extends beyond the threaded axial interval')
    if spec.plate_count*t>el:raise ValueError('Plate stack extends beyond the shank interval')
    shank_step=plate_step if spec.plate_count or el==0 else _common_step(plate_step,el)
    counts=dict(thread=int(eb/thread_step),nut=int(em/thread_step),
                shank=int(el/shank_step),plate=int(per_plate))
    if counts['thread']+counts['nut']+counts['shank']+spec.plate_count*counts['plate']>spec.layer_limit:
        raise ValueError('Joint axial layout exceeds the layer budget')
    changes={name:float(effective[name]-value) for name,value in [('thread_length',b),('nut_height',m),('shank_length',l)]}
    plates=[[float(eb+i*t),float(eb+(i+1)*t)] for i in range(spec.plate_count)]
    return dict(schemaVersion=1,policy=policy,requested=asdict(spec),effective={k:float(v) for k,v in effective.items()},
                geometryChanged=any(v!=0 for v in changes.values()),axialDimensionsChanged=any(v!=0 for v in changes.values()),
                boundaryGeometryVerified=False,dimensionChanges=changes,counts=counts,
                headToPlateAxialGap=float(el-spec.plate_count*t) if spec.plate_count else None,
                seeds=dict(axialPerPitch=int(per_pitch),axialPerPlate=int(per_plate)),
                spacing=dict(thread=float(thread_step),shank=float(shank_step),plate=float(plate_step)),
                intervals=dict(thread=[0.,float(eb)],nut=[float(eb-em),float(eb)],
                               shank=[float(eb),float(eb+el)],plates=plates),
                fullMeshVerified=False,radialInterfaceVerified=False,
                scope='Axial allocation/interface plan only; no CAD mutation, H8 mesh or solver certificate')
