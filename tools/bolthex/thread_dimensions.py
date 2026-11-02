"""Canonical design dimensions, never the thread-occupancy sampling radius."""
import math


def dimensions_for(request,design=None):
    if not isinstance(request,dict) or not isinstance(request.get('size'),str) or not request['size'].strip():
        raise ValueError('Thread size must be an explicit design string')
    if design is not None and not isinstance(design,dict):
        raise ValueError('Canonical thread metadata must be an object')
    metric=request['size'].startswith('M')
    if metric:
        diameter,pitch=map(float,request['size'][1:].split('-'))
    elif design is None:
        raise ValueError('Nonmetric CAD requires canonical designThread metadata; regenerate its certificate')
    if design is not None:
        if design.get('unit')!='mm':raise ValueError('Canonical thread dimensions must explicitly use mm')
        values=[design.get(k) for k in ('majorDiameterMm','pitchMm')]
        if any(type(v) not in (int,float) or not math.isfinite(v) or v<=0 for v in values):
            raise ValueError('Require positive finite majorDiameterMm and pitchMm; sample radius is not a design dimension')
        if metric and any(abs(a-b)>1e-9 for a,b in zip((diameter,pitch),values)):
            raise ValueError('Canonical design dimensions disagree with the metric size')
        diameter,pitch=values
    if not all(math.isfinite(v) and v>0 for v in (diameter,pitch)):
        raise ValueError('Thread diameter and pitch must be finite and positive')
    return diameter,pitch
