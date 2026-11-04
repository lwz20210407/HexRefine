"""Grid-independent piecewise-linear axial weights, not count-transition cells."""
from bisect import bisect_right
from dataclasses import dataclass
import math


@dataclass(frozen=True)
class AxialEnvelope:
    knots:tuple[tuple[float,float],...]

    def __post_init__(self):
        if not isinstance(self.knots,(tuple,list)) or not 2<=len(self.knots)<=256:
            raise ValueError('Envelope requires 2..256 physical control points')
        normalized=[]
        for pair in self.knots:
            if not isinstance(pair,(tuple,list)) or len(pair)!=2:
                raise ValueError('Envelope controls must be (position,weight) pairs')
            x,w=pair
            if any(type(v) not in (int,float) or not math.isfinite(v) for v in pair) or not 0<=w<=1:
                raise ValueError('Envelope controls must be finite, weights in [0,1]')
            if normalized and x<=normalized[-1][0]:raise ValueError('Envelope positions must strictly increase')
            normalized.append((float(x),float(w)))
        object.__setattr__(self,'knots',tuple(normalized))

    def value(self,z):
        if type(z) not in (int,float) or not math.isfinite(z):raise ValueError('Envelope query must be finite')
        if z<=self.knots[0][0]:return self.knots[0][1]
        if z>=self.knots[-1][0]:return self.knots[-1][1]
        index=bisect_right(self.knots,(z,float('inf')))-1
        a,wa=self.knots[index];b,wb=self.knots[index+1]
        return wa+(wb-wa)*((z-a)/(b-a))
