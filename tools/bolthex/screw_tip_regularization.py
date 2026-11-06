"""Bounded additive tip target from the actual Screw mesh, never a mesh export."""
from __future__ import annotations

import argparse
from collections import Counter
from fractions import Fraction as Q
from itertools import combinations, product
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile

from .geometry_accuracy_policy import CadAccuracyPolicy
from .truegrid_screw import read_keyword

BITS = ((0,0,0),(1,0,0),(1,1,0),(0,1,0),(0,0,1),(1,0,1),(1,1,1),(0,1,1))
RAW_SHA = '09c9ce96a5df2d8cf900be8fa716d6a0daf7e80d6cc26955e76e623d45182628'
PHASE_SHA = 'fa9aefa9ca2dcf5a06c6f2c0588864c4375fa490b37a85944c01640f8bcd5a8d'
MAX_BYTES = 32*1024*1024


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def sub(a,b): return tuple(x-y for x,y in zip(a,b))
def add(a,b): return tuple(x+y for x,y in zip(a,b))
def scale(a,s): return tuple(x*s for x in a)
def dot(a,b): return sum(x*y for x,y in zip(a,b))
def cross(a,b): return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def det(a,b,c): return dot(a,cross(b,c))
def l1(a): return sum(abs(x) for x in a)
def number(x): return dict(exact=str(x),value=float(x))
def point_json(p): return [str(x) for x in p]


def _require(ok,message):
    if not ok: raise ValueError(message)


def coefficients(points):
    values=dict(zip(BITS,points));result={}
    for power in product((0,1),repeat=3):
        total=(Q(0),)*3
        for bit in product(*[range(k+1) for k in power]):
            total=add(total,scale(values[bit],(-1)**(sum(power)-sum(bit))))
        result[power]=total
    return result


def evaluate(coeff,parameters):
    out=(Q(0),)*3
    for powers,value in coeff.items():
        multiplier=math.prod(parameters[i] for i in range(3) if powers[i])
        out=add(out,scale(value,multiplier))
    return out


def _pa(a,b):
    out=dict(a)
    for k,v in b.items(): out[k]=out.get(k,Q(0))+v
    return {k:v for k,v in out.items() if v}


def _pm(a,b):
    out={}
    for i,x in a.items():
        for j,y in b.items():
            k=tuple(u+v for u,v in zip(i,j));out[k]=out.get(k,Q(0))+x*y
    return {k:v for k,v in out.items() if v}


def _ps(a,s): return {k:v*s for k,v in a.items() if v*s}


def _derivative(poly,axis):
    out={}
    for k,v in poly.items():
        if k[axis]:
            j=list(k);j[axis]-=1;out[tuple(j)]=v*k[axis]
    return out


def jacobian_polynomial(coeff):
    components=[{k:v[i] for k,v in coeff.items() if v[i]} for i in range(3)]
    columns=[[_derivative(p,j) for p in components] for j in range(3)]
    a,b,c=columns
    return _pa(_pa(_pm(a[0],_pa(_pm(b[1],c[2]),_ps(_pm(b[2],c[1]),-1))),
                   _ps(_pm(a[1],_pa(_pm(b[0],c[2]),_ps(_pm(b[2],c[0]),-1))),-1)),
               _pm(a[2],_pa(_pm(b[0],c[1]),_ps(_pm(b[1],c[0]),-1))))


def bernstein_coefficients(poly):
    degree=tuple(max(k[i] for k in poly) for i in range(3))
    result=[]
    for index in product(*[range(d+1) for d in degree]):
        value=sum(v*math.prod(Q(math.comb(index[i],k[i]),math.comb(degree[i],k[i])) for i in range(3))
                  for k,v in poly.items() if all(k[i]<=index[i] for i in range(3)))
        result.append(value)
    return degree,result


def exact_convex_hull(points):
    """All supporting triples + exact planar monotone chains; no Qhull tolerance."""
    _require(4<=len(points)<=16,'Hull requires 4..16 rational points')
    unique=list(dict.fromkeys(tuple(Q(x) for x in p) for p in points))
    _require(all(len(p)==3 for p in unique),'Hull points must be 3D')
    planes={}
    for i,j,k in combinations(range(len(unique)),3):
        n=cross(sub(unique[j],unique[i]),sub(unique[k],unique[i]))
        if n==(0,0,0): continue
        d=-dot(n,unique[i]);sides=[dot(n,p)+d for p in unique]
        if min(sides)<0<max(sides): continue
        if min(sides)==max(sides)==0: continue
        if max(sides)>0: n=scale(n,-1);d=-d;sides=[-x for x in sides]
        on=tuple(t for t,v in enumerate(sides) if v==0)
        planes.setdefault(on,(n,d))
    _require(len(planes)>=4,'Hull is not full dimensional')
    faces=[];triangles=[]
    for on,(n,d) in sorted(planes.items()):
        drop=max(range(3),key=lambda i:abs(n[i]));axes=[i for i in range(3) if i!=drop]
        order=sorted(on,key=lambda i:tuple(unique[i][a] for a in axes))
        def turn(i,j,k):
            a,b,c=[tuple(unique[v][a] for a in axes) for v in (i,j,k)]
            return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
        def chain(ids):
            result=[]
            for i in ids:
                while len(result)>=2 and turn(result[-2],result[-1],i)<=0: result.pop()
                result.append(i)
            return result
        polygon=chain(order)[:-1]+chain(order[::-1])[:-1]
        _require(len(polygon)>=3,'Degenerate supporting polygon')
        if dot(cross(sub(unique[polygon[1]],unique[polygon[0]]),sub(unique[polygon[2]],unique[polygon[0]])),n)<0:
            polygon.reverse()
        faces.append(dict(normal=n,offset=d,on=on,polygon=polygon))
        triangles.extend((polygon[0],polygon[i],polygon[i+1]) for i in range(1,len(polygon)-1))
    edges=Counter((a,b) for tri in triangles for a,b in zip(tri,tri[1:]+tri[:1]))
    _require(all(v==1 and edges[b,a]==1 for (a,b),v in edges.items()),'Hull triangle edge orientation failed')
    vertices=sorted({i for tri in triangles for i in tri})
    _require(len(vertices)-len(edges)//2+len(triangles)==2,'Hull Euler check failed')
    center=tuple(sum(p[i] for p in unique)/len(unique) for i in range(3))
    tetra=[det(sub(unique[a],center),sub(unique[b],center),sub(unique[c],center))/6 for a,b,c in triangles]
    _require(min(tetra)>0,'Hull interior tetrahedra must have positive volume')
    volume=sum(tetra)
    origin_volume=sum(det(unique[a],unique[b],unique[c])/6 for a,b,c in triangles)
    _require(volume==origin_volume,'Independent hull volume origins disagree')
    hull=dict(points=unique,inputToPoint=[unique.index(tuple(p)) for p in points],faces=faces,triangles=triangles,
              vertexIndices=vertices,volume=volume)
    _require(all(contains(hull,p) for p in points),'A source box corner escaped its exact hull')
    return hull


def contains(hull,p):
    return all(dot(face['normal'],p)+face['offset']<=0 for face in hull['faces'])


def _source_geometry(mesh):
    nodes={int(n):tuple(Q.from_float(float(x)) for x in p) for n,p in zip(mesh.node_ids,mesh.nodes)}
    cells={int(e):(int(pid),tuple(map(int,mesh.node_ids[row]))) for e,pid,row in zip(mesh.element_ids,mesh.part_ids,mesh.elements)}
    _require(set(cells)==set(range(1,6129)),'Require complete actual 6128-cell source')
    p=nodes[9384];nids=cells[5048][1];corner=nids.index(9384);origin_bits=BITS[corner]
    neighbours=[]
    for axis in range(3):
        bit=list(origin_bits);bit[axis]=1-bit[axis];i=BITS.index(tuple(bit));delta=sub(nodes[nids[i]],p)
        neighbours.append((axis,i,delta))
    radial=[v for v in neighbours if v[2][:2]!=(0,0)]
    down=sorted([v for v in neighbours if v[2][:2]==(0,0)],key=lambda v:abs(v[2][2]))
    _require(len(radial)==1 and len(down)==2 and all(v[2][2]<0 for v in down),'Cannot identify radial s and downward t,w')
    axes=[radial[0][0],down[0][0],down[1][0]]
    local=[]
    for bits in BITS:
        ref=list(origin_bits)
        for a,b in zip(axes,bits):
            if b: ref[a]=1-ref[a]
        local.append(nids[BITS.index(tuple(ref))])
    q=[nodes[n] for n in local]
    _require(p[:2]==(0,0) and all(q[i][:2]==(0,0) for i in (0,3,4,7)),'Unexpected source axis')
    _require(all(q[i][2]==q[j][2] for i,j in ((0,1),(3,2),(4,5),(7,6))),'Source z is not radial-independent')
    maximum=max(x[2] for x in nodes.values())
    _require(p[2]==maximum and sorted(n for n,v in nodes.items() if v[2]==maximum)==[9384,10465],
             'Maximum-Z support changed or another cell covers the tip')
    other_max=max(nodes[n][2] for e,(_,ids) in cells.items() if e!=5048 for n in ids)
    gap=p[2]-other_max
    _require(gap>0,'Another source cell can cover the tip; strict height isolation failed')
    roots=[q[i][:2] for i in (1,2,5,6)];a=roots[0];amin=min(dot(a,r) for r in roots)
    T=[p[2]-q[i][2] for i in (0,3,4,7)]
    _require(amin>0 and min(T[1],T[3]-T[2],T[2],T[3]-T[1])>0,'Source injectivity projection/height conditions failed')
    coeff=coefficients(q);jac=jacobian_polynomial(coeff)
    _require(jac and all(k[0]==1 for k in jac),'Source Jacobian lacks expected radial factor')
    factor={(0,k[1],k[2]):v for k,v in jac.items()}
    degree,bern=bernstein_coefficients(factor)
    _require(min(bern)>0,'Source injectivity determinant factor is not strictly positive')
    volume=sum(v/math.prod(k[i]+1 for i in range(3)) for k,v in jac.items())
    _require(volume>0,'Source cell image volume is not positive')
    return dict(nodes=nodes,cells=cells,p=p,localNIDs=local,q=q,coeff=coeff,axes=axes,originBits=origin_bits,
                radialProjection=a,minimumOuterProjection=amin,gap=gap,otherMaxZ=other_max,sourceVolume=volume,
                jacobianFactorDegree=degree,jacobianFactorBernstein=bern)


def _policy(report,source_hash):
    _require(report.get('sourceSHA256')==RAW_SHA and report.get('outputKSHA256')==PHASE_SHA,
             'Phase report does not bind the reviewed raw/phase pair')
    _require(source_hash in (report['sourceSHA256'],report['outputKSHA256']),'Source hash not bound by phase report')
    policy=CadAccuracyPolicy.engineering(.2)
    _require(report.get('geometryAccuracyPolicy')==policy.manifest(),
             'Use existing declared target 0.2 / critical budget 0.0005; policy changes forbidden')
    return policy,Q.from_float(policy.distance_budget_mm(critical=True))


def deviation_bound(coeff,ranges):
    pair=[]
    for i,j in combinations(range(3),2):
        power=tuple(int(k in (i,j)) for k in range(3))
        pair.append(l1(coeff[power])*ranges[i]*ranges[j]/4)
    triple=l1(coeff[1,1,1])*math.prod(ranges)
    return dict(pairTerms=pair,tripleTerm=triple,bound=sum(pair)+triple)


def _sqrt_upper(value):
    """Dyadic ceiling of a rational square root; not a floating estimate."""
    denominator=2**80
    numerator=math.isqrt(value.numerator*denominator**2//value.denominator)
    if numerator*numerator*value.denominator<value.numerator*denominator**2: numerator+=1
    return Q(numerator,denominator)


def orthogonal_box(p,radial):
    nominal=Q(1,20000)
    multiplier=Q.from_float(float(nominal)/math.sqrt(float(dot(radial,radial))))
    edges=[(multiplier*radial[0],multiplier*radial[1],Q(0)),
           (multiplier*radial[1],-multiplier*radial[0],Q(0)),(Q(0),Q(0),-nominal)]
    _require(all(dot(edges[i],edges[j])==0 for i,j in combinations(range(3),2)),'Octant axes are not exactly orthogonal')
    determinant=det(*edges);squares=[dot(v,v) for v in edges]
    _require(determinant>0 and determinant**2==math.prod(squares),'Octant box is not a positive SJ=1 affine H8')
    points=[]
    for bits in BITS:
        point=p
        for bit,edge in zip(bits,edges):point=add(point,scale(edge,bit))
        points.append(point)
    return dict(points=points,edges=edges,nominal=nominal,edgeSquares=squares,determinant=determinant,
                radiusBound=_sqrt_upper(sum(squares)))


def _candidate(source,ranges,geometry_budget):
    corner_parameters=[tuple(Q(bit)*r for bit,r in zip(bits,ranges)) for bits in BITS]
    original_points=[evaluate(source['coeff'],r) for r in corner_parameters]
    box=orthogonal_box(source['p'],source['radialProjection'])
    points=original_points+box['points']
    floats=[tuple(Q.from_float(float(x)) for x in p) for p in points]
    rounding=max(l1(sub(a,b)) for a,b in zip(points,floats))
    bound=deviation_bound(source['coeff'],ranges)
    if bound['bound']+box['radiusBound']+rounding>geometry_budget:return None,'distance-budget'
    allpoints=points+floats
    plane=source['p'][2]-source['gap']/2
    if min(p[2] for p in allpoints)<=plane:return None,'height-isolation'
    max_projection=max(dot(source['radialProjection'],p[:2]) for p in allpoints)
    if max_projection>source['minimumOuterProjection']/4:return None,'root-face-isolation'
    hull=exact_convex_hull(points);rounded_hull=exact_convex_hull(floats)
    numerator=max(hull['volume'],rounded_hull['volume'])
    if numerator/source['sourceVolume']>Q(1,10000):return None,'volume-budget'
    return dict(ranges=ranges,parameters=corner_parameters,points=points,roundedPoints=floats,orthogonalBox=box,
                hull=hull,floatHull=rounded_hull,error=bound,rounding=rounding,
                minimumZ=min(p[2] for p in allpoints),isolationPlane=plane,maximumRadialProjection=max_projection,
                volumeRatioBound=numerator/source['sourceVolume']),None


def affine_witness(hull,p):
    best=None
    for ids in combinations([i for i in hull['vertexIndices'] if hull['points'][i]!=p],3):
        vectors=[sub(hull['points'][i],p) for i in ids];d=det(*vectors)
        if not d:continue
        score=d*d/math.prod(dot(v,v) for v in vectors)
        if best is None or score>best[0]:best=(score,ids,vectors,d)
    _require(best is not None,'Hull supplies no positive corner witness')
    score,ids,vectors,d=best;ids=list(ids)
    if d<0:ids[1],ids[2]=ids[2],ids[1];vectors[1],vectors[2]=vectors[2],vectors[1];d=-d
    epsilon=Q(1,4);edges=[scale(v,epsilon) for v in vectors]
    vertices=[]
    for bits in BITS:
        v=p
        for bit,edge in zip(bits,edges):v=add(v,scale(edge,bit))
        vertices.append(v)
    _require(all(contains(hull,v) for v in vertices),'Exact affine witness escaped H')
    return dict(selectedHullVertexIndices=ids,epsilon=number(epsilon),originExact=point_json(p),
                basisExact=[point_json(v) for v in edges],verticesExact=[point_json(v) for v in vertices],
                jacobianOnUnitCube=number(d*epsilon**3),scaledJacobianSquared=number(score),
                scaledJacobian=math.sqrt(float(score)),allCornersAndInteriorPositive=True,
                containmentProof='Every point is (1-epsilon*sum(u))*P + epsilon*sum(u_i*V_i); 3*epsilon<=1.',
                affineExactRationalWitness=True,floatMeshExported=False,wholeMeshQualityAccepted=False,
                empiricalPoint15ThresholdUsed=False)


def _hull_json(hull):
    return dict(pointsExact=[point_json(p) for p in hull['points']],pointsFloat=[[float(x) for x in p] for p in hull['points']],
                inputCornerToPoint=hull['inputToPoint'],hullVertexIndices=hull['vertexIndices'],
                outwardTriangles=[list(t) for t in hull['triangles']],
                faces=[dict(normalExact=point_json(f['normal']),offsetExact=str(f['offset']),
                            pointIndicesOnPlane=list(f['on']),outwardPolygon=f['polygon']) for f in hull['faces']],
                volume=number(hull['volume']),allInputCornersContained=True,closedOrientedBoundary=True,
                volumeCheckedFromTwoOrigins=True,indexBase=0)


def _box_witness(box,hull,p):
    _require(all(contains(hull,v) for v in box['points']),'Orthogonal box escaped the exact extended hull')
    return dict(originExact=point_json(p),basisExact=[point_json(v) for v in box['edges']],
                verticesExact=[point_json(v) for v in box['points']],
                jacobianOnUnitCube=number(box['determinant']),scaledJacobianSquared=number(Q(1)),scaledJacobian=1.,
                nominalEdgeMM=number(box['nominal']),edgeSquaredLengths=[number(v) for v in box['edgeSquares']],
                exactEqualEdgeLengths=len(set(box['edgeSquares']))==1,
                exactOrthogonalEdges=True,allCornersAndInteriorPositive=True,
                containmentProof='All eight exact affine-box corners are in convex H_prime; every affine H8 point is their convex combination.',
                affineExactRationalWitness=True,floatMeshExported=False,wholeMeshQualityAccepted=False,
                empiricalPoint15ThresholdUsed=False,
                mandatoryFinalMeshSeed=False,engineeringQualityCertified=False,explicitTimeStepQualityCertified=False,
                purpose='Existence witness only; 5e-5 mm is not a prescribed final mesh seed or engineering/time-step quality proof.',
                terminology='Exactly radial-aligned orthogonal near-cube; equal horizontal edges, vertical length differs only by normalization rounding, not claimed exactly cubic.')


def prepare_target(source_k, phase_report, new_output):
    """Publish a fresh additive geometry target JSON, never a K or assembled mesh."""
    source_k=Path(source_k).resolve(strict=True);phase_report=Path(phase_report).resolve(strict=True)
    output=Path(new_output).absolute()
    _require(output.suffix.lower()=='.json' and not output.exists() and not output.is_symlink()
             and output.parent.is_dir(),'Require a fresh JSON path with existing parent')
    _require(not any(output.resolve().is_relative_to(parent) for parent in (source_k.parent,phase_report.parent)),
             'Do not publish inside the immutable source or phase-report bundle')
    _require(source_k.stat().st_size<=MAX_BYTES and phase_report.stat().st_size<=2*1024*1024,'Oversized source/report')
    hashes={str(p):sha(p) for p in (source_k,phase_report)}
    _require(hashes[str(source_k)] in (RAW_SHA,PHASE_SHA),'Only the reviewed raw or phase source is supported')
    report=json.loads(phase_report.read_text())
    policy,budget=_policy(report,hashes[str(source_k)])
    geometry_budget=budget/2
    def unchanged():
        _require(all(sha(p)==v for p,v in hashes.items()),'Source or approved policy report changed')
    try:
        mesh=read_keyword(source_k);source=_source_geometry(mesh)
        grid=[(Q(1,2**i),Q(1,2**j),Q(1,2**k)) for i in range(2,10) for j in range(2,10) for k in range(4,11)]
        grid.sort(key=lambda r:(-math.prod(r),-r[0],-r[1],-r[2]))
        rejections=Counter();selected=None
        for index,ranges in enumerate(grid,1):
            selected,reason=_candidate(source,ranges,geometry_budget)
            if selected is not None:break
            rejections[reason]+=1
        _require(selected is not None,'Finite dyadic search exhausted without a certified target')
        c=selected;box=c['orthogonalBox'];witness=_box_witness(box,c['hull'],source['p'])
        tangent=(-source['radialProjection'][1],source['radialProjection'][0])
        added_point=add(source['p'],box['edges'][1])
        _require(added_point[2]==source['p'][2] and dot(tangent,added_point[:2])<0,'Added material witness is not outside the original maximum-Z segment')
        result=dict(schema='screw-tip-additive-target.v2',sourceFiles={str(p):dict(sha256=hashes[str(p)],bytes=p.stat().st_size) for p in (source_k,phase_report)},
            sourceVariant='raw' if hashes[str(source_k)]==RAW_SHA else 'phase',sourceEID=5048,sourcePID=source['cells'][5048][0],
            sourceOriginalNodeIDs=list(source['cells'][5048][1]),sourceLocalNodeIDs=source['localNIDs'],
            sourceLocalCoordinatesExact=[point_json(p) for p in source['q']],sourceParameterAxes=source['axes'],sourceOriginReferenceBits=list(source['originBits']),
            geometryDefinition='Omega_prime = union(original source domain, H_prime); H_prime = conv(eight exact source parameter-box corner images plus eight exact orthogonal-octant-box corners).',
            independentDesignCad=False,sourceMeshDefinesGeometry=True,originalNodesMoved=False,originalElementsDeleted=False,
            protectedSourceChanged=False,coreMeshed=False,wholeScrewAccepted=False,engineeringQualityAccepted=False,physicalSolverStarted=False,
            boundaryDistanceCertified=False,engineeringGeometryAccepted=False,repairCompleted=False,
            approvedGeometryAccuracyPolicy=policy.manifest(),policyReportSHA256=hashes[str(phase_report)],
            budget=dict(totalDistanceMM=number(budget),geometryTargetIncludingFloatMM=number(geometry_budget),
                        reservedMeshApproximationMM=number(budget/2),budgetFixedBeforeSearch=True,incidentalEdgeTargetUsed=False),
            search=dict(lambdaExponents=[2,9],tauExponents=[2,9],omegaExponents=[4,10],totalCandidates=len(grid),
                        candidatesVisited=index,rejections=dict(rejections),order='descending parameter-box volume, then lambda, tau, omega; first certified candidate'),
            parameterBox=dict(lambdaMax=str(c['ranges'][0]),tauMax=str(c['ranges'][1]),omegaMax=str(c['ranges'][2]),
                              cornersExact=[point_json(p) for p in c['parameters']]),
            sourcePolynomialCoefficients={''.join(map(str,k)):point_json(v) for k,v in source['coeff'].items()},
            exactHull=_hull_json(c['hull']),floatHull=_hull_json(c['floatHull']),
            hullInputSemantics='input indices 0..7: source parameter-box images; 8..15: orthogonal box corners; duplicate P deduplicated without modifying source IDs',
            maximumInputSupportPoints=16,
            floatHullIsApproximationNotAuthoritativeTarget=True,
            exactBoxCornersContainedInFloatHull=all(contains(c['floatHull'],p) for p in c['points']),
            deviation=dict(pairCovarianceBoundsMM=[number(v) for v in c['error']['pairTerms']],
                           tripleBoundMM=number(c['error']['tripleTerm']),baseCornerHullToSourceMM=number(c['error']['bound']),
                           orthogonalBoxRadiusBoundMM=number(box['radiusBound']),
                           exactHullToSourceMM=number(c['error']['bound']+box['radiusBound']),
                           floatCornerL1ErrorMM=number(c['rounding']),includingFloatOutputMM=number(c['error']['bound']+box['radiusBound']+c['rounding']),
                           distanceSemantics='Closed solid-domain Hausdorff bound for additive union; no independent bidirectional boundary-Hausdorff certificate.',
                           proof='Base H: mean parameters, pair covariance <= ranges product/4, triple difference <= lambda*tau*omega with coefficient L1 bounds. Extended point=(1-alpha)h+alpha(P+e); (1-alpha)h+alpha*P is in H and |e|<=d. Add d and the exact float-corner L1 error.'),
            protection=dict(allOtherSourceCellsChecked=6127,allRetainedOutsideBodyCellsIncluded=3968,
                            otherCellMaximumZ=number(source['otherMaxZ']),tipToOtherCellGap=number(source['gap']),
                            requiredLowerPlaneZ=number(c['isolationPlane']),minimumHullAndFloatZ=number(c['minimumZ']),
                            strictHeightMargin=number(c['minimumZ']-c['isolationPlane']),
                            radialProjection=point_json(source['radialProjection']),minimumOriginalRootFaceProjection=number(source['minimumOuterProjection']),
                            maximumHullAndFloatRadialProjection=number(c['maximumRadialProjection']),
                            rootFaceProjectionMargin=number(source['minimumOuterProjection']-c['maximumRadialProjection']),
                            heightAndRadialProof='Linear functionals bound every convex hull point. All other H8 images lie in their eight-node convex hulls. Hulls lie strictly above Pz-gap/2 and below one quarter of the root-face projection minimum.'),
            volume=dict(injectiveSourceCell=5048,sourceCellImageVolume=number(source['sourceVolume']),
                        sourceJacobianFactorBernsteinDegree=list(source['jacobianFactorDegree']),
                        sourceJacobianFactorBernsteinCoefficients=[str(v) for v in source['jacobianFactorBernstein']],
                        sourceInjectivityProof='Positive radial projection, strictly monotone axial derivatives and positive Jacobian factor imply strictly monotone angular ratio on each axial slice; radial scale is unique for s>0. Axis is measure zero.',
                        addedVolumeUpperBound=number(c['hull']['volume']),includingFloatHullUpperBound=number(max(c['hull']['volume'],c['floatHull']['volume'])),
                        relativeAddedVolumeUpperBound=number(c['volumeRatioBound']),relativeLimit=number(Q(1,10000)),
                        sourceUnionVolumeKnown=False,denominatorProof='Source union contains the injective cell image. Added material volume <= HullVolume. No source union volume or exact added volume is claimed.'),
            affineH8Witness=witness,
            addedMaterialWitness=dict(pointExact=point_json(added_point),heightEqualsSourceMaximum=True,
                                      originalMaximumZSegment=[9384,10465],tangentialProjection=number(dot(tangent,added_point[:2])),
                                      proof='Only source E5048 attains maximum Z, on P--R00 where this tangential projection is zero. This included box corner has strictly negative projection.'),
            localTargetBoundsVerified=True,jacobianRequirementsRelaxed=False,sourceFilesUnchanged=True,builderSHA256=sha(Path(__file__)),
            limitations=['This is an additive geometry target, NOT a mesh or independent design CAD.',
                         'Never append H or the witness as overlapping cells to the original K.',
                         'Exact rational hull/witness are authoritative; float hull is separately bounded approximation.',
                         'Closed-domain Hausdorff bounds do not certify policy maximumSurfaceDistance or boundary Hausdorff distance; actual union-boundary comparison remains required.',
                         'Covered original source faces have not been checked against the new union boundary.',
                         'The 5e-5 mm witness is existence-only, not a mandatory final seed or engineering/time-step quality certificate.',
                         'Future conforming remeshing, source-union overlap handling and global quality remain unperformed.'])
        payload=(json.dumps(result,indent=2,allow_nan=False)+'\n').encode('utf-8')
        _require(len(payload)<=2*1024*1024,'Target report exceeds 2 MiB')
    finally:unchanged()
    temporary=None
    try:
        with tempfile.NamedTemporaryFile(mode='wb',dir=output.parent,prefix='.tip-target-',delete=False) as stream:
            temporary=Path(stream.name);stream.write(payload);stream.flush();os.fsync(stream.fileno())
        unchanged();os.link(temporary,output)
    finally:
        if temporary is not None:
            try:temporary.unlink()
            except OSError:pass
    return result


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_k',type=Path);parser.add_argument('phase_report',type=Path);parser.add_argument('new_output',type=Path)
    args=parser.parse_args(argv)
    try:r=prepare_target(args.source_k,args.phase_report,args.new_output)
    except (ValueError,OSError,KeyError,TypeError) as exc:
        parser.exit(1,json.dumps(dict(prepared=False,error=str(exc)))+'\n')
    print(json.dumps(dict(prepared=True,output=str(args.new_output.absolute()),parameterBox=r['parameterBox'],
                         distanceBoundMM=r['deviation']['includingFloatOutputMM']['value'],
                         hullVolume=r['volume']['addedVolumeUpperBound']['value'],
                         relativeAddedVolumeBound=r['volume']['relativeAddedVolumeUpperBound']['value'],
                         witnessScaledJacobian=r['affineH8Witness']['scaledJacobian'],wholeScrewAccepted=False),indent=2))
    return 0


if __name__=='__main__':raise SystemExit(main())
