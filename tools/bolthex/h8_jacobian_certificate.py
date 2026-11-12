"""Exact-binary64 polynomial positivity certificate for trilinear H8 cells."""
from fractions import Fraction
from itertools import product
import numpy as np

from .screw_tip_regularization import coefficients, jacobian_polynomial, bernstein_coefficients


def _split_axis(values, axis):
    columns=np.moveaxis(values,axis,0)
    degree=len(columns)-1
    levels=[columns]
    for _ in range(degree): levels.append((levels[-1][:-1]+levels[-1][1:])/2)
    left=np.stack([levels[i][0] for i in range(degree+1)])
    right=np.stack([levels[degree-i][-1] for i in range(degree+1)])
    return np.moveaxis(left,0,axis),np.moveaxis(right,0,axis)


def certify_cell(points, *, maximum_depth=3, maximum_boxes=4096):
    """Convex-hull Bernstein bounds with exact rational de Casteljau splits.

    A failure to certify is NOT automatically proof of an invalid cell. Only
    a nonpositive exact parameter-corner value is labelled a rejection witness.
    The proof concerns real interpolation of stored binary64 coordinates, not
    rounded floating-point evaluations or shape-quality/solver acceptance.
    """
    p=np.asarray(points)
    if p.shape!=(8,3) or p.dtype.kind not in 'fiu' or not np.isfinite(p).all():
        raise ValueError('Require finite real 8x3 H8 points')
    if type(maximum_depth) is not int or not 0<=maximum_depth<=5:
        raise ValueError('Invalid subdivision depth')
    if type(maximum_boxes) is not int or not 1<=maximum_boxes<=32768:
        raise ValueError('Invalid box budget')
    exact=[tuple(Fraction.from_float(float(v)) for v in row) for row in p]
    poly=jacobian_polynomial(coefficients(exact))
    if not poly:
        return dict(certified=False,status='identically-zero',boxesVisited=0)
    degree,flat=bernstein_coefficients(poly)
    grid=np.array(flat,dtype=object).reshape(tuple(d+1 for d in degree))
    queue=[(grid,0)];visited=0;leaves=0;lower=None
    while queue:
        if visited>=maximum_boxes:
            return dict(certified=False,status='inconclusive-box-budget',boxesVisited=visited)
        values,depth=queue.pop();visited+=1
        corners=[values[i] for i in product(*[(0,d) if d else (0,) for d in degree])]
        if min(corners)<=0:
            return dict(certified=False,status='exact-nonpositive-parameter-corner',boxesVisited=visited,
                        witnessValueExact=str(min(corners)),subdivisionDepth=depth)
        minimum=min(values.flat)
        if minimum>0:
            lower=minimum if lower is None else min(lower,minimum);leaves+=1
            continue
        if depth==maximum_depth:
            return dict(certified=False,status='inconclusive-depth-budget',boxesVisited=visited)
        children=[values]
        for axis in range(3):
            if degree[axis]>0:children=[part for child in children for part in _split_axis(child,axis)]
        queue.extend((child,depth+1) for child in children)
    return dict(certified=True,status='strictly-positive-on-closed-reference-cube',boxesVisited=visited,
                certifiedLeafBoxes=leaves,determinantLowerBoundExact=str(lower),
                arithmetic='exact rationals of stored binary64 XYZ',referenceCoordinates='[0,1]^3',
                geometricOverlapCertified=False,engineeringQualityAccepted=False)
