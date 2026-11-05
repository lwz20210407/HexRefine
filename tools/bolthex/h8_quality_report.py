"""Read-only H8 metric definitions and reference bands, NOT solver acceptance.

The historical0.15 corner-SJ screen is a project value, not a vendor standard.
Verdict's linear-H8 scaled Jacobian includes corners AND center. Determinant
min/max ratios are different measures and cannot reuse an SJ threshold.
"""
from itertools import product
import numpy as np

from .mesh_audit import SIGNS


REFERENCES={
    'verdict':'https://raw.githubusercontent.com/sandialabs/verdict/master/SAND2007-2853p.pdf',
    'cubit':'https://coreform.com/cubit_help/latest/mesh_generation/mesh_quality_assessment/hexahedral_metrics.htm',
    'hypermesh':'https://2024.help.altair.com/2024.1/hwdesktop/hwx/topics/pre_processing/meshing/element_quality_calculations_hypermesh_r.htm',
    'ansys':'https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/wb_msh/msh_jacobian_ratio.html',
}
EDGES=np.array(((0,1),(1,2),(2,3),(3,0),(4,5),(5,6),(6,7),(7,4),(0,4),(1,5),(2,6),(3,7)))


def measure_h8(nodes,elements):
    """Return per-cell arrays, including invalid samples without hiding them."""
    p=np.asarray(nodes);e=np.asarray(elements)
    if (p.ndim!=2 or p.shape[1]!=3 or not np.issubdtype(p.dtype,np.number)
            or np.iscomplexobj(p) or not np.isfinite(p).all()):
        raise ValueError('Require finite real XYZ nodes')
    if (e.ndim!=2 or e.shape[1]!=8 or not len(e) or len(e)>2000000
            or not np.issubdtype(e.dtype,np.integer) or e.min()<0 or e.max()>=len(p)
            or np.any(np.diff(np.sort(e,axis=1),axis=1)<=0)):
        raise ValueError('Require bounded distinct H8 node references')
    names=('cornerScaledJacobian','cornerAndCenterScaledJacobian','minimumCornerDeterminant',
           'centerDeterminant','minimumGaussDeterminant','positiveCornerDetRatio',
           'positiveGaussDetRatio','integratedVolume','maxEdgeOverMinEdge')
    result={name:np.empty(len(e)) for name in names}
    for start in range(0,len(e),32768):
        xyz=np.asarray(p[e[start:start+32768]],dtype=float);xyz=xyz-xyz[:,:1]
        def evaluate(q):
            u,v,w=q
            d=np.column_stack((SIGNS[:,0]*(1+SIGNS[:,1]*v)*(1+SIGNS[:,2]*w),
                SIGNS[:,1]*(1+SIGNS[:,0]*u)*(1+SIGNS[:,2]*w),
                SIGNS[:,2]*(1+SIGNS[:,0]*u)*(1+SIGNS[:,1]*v)))/8
            j=np.einsum('eni,nj->eij',xyz,d);det=np.linalg.det(j)
            denominator=np.linalg.norm(j,axis=1).prod(axis=1)
            scaled=np.divide(det,denominator,out=np.full(len(xyz),np.nan),where=denominator>0)
            return det,scaled
        corners=[evaluate(q) for q in product((-1.,1.),repeat=3)]
        cd=np.column_stack([v[0] for v in corners]);cs=np.column_stack([v[1] for v in corners])
        centre,centre_sj=evaluate((0.,0.,0.))
        gauss=np.column_stack([evaluate(q)[0] for q in product((-1/np.sqrt(3),1/np.sqrt(3)),repeat=3)])
        def ratio(values):
            lo,hi=values.min(axis=1),values.max(axis=1)
            return np.divide(lo,hi,out=np.full(len(xyz),np.nan),where=(lo>0)&np.isfinite(lo)&np.isfinite(hi))
        edge_lengths=np.linalg.norm(xyz[:,EDGES[:,1]]-xyz[:,EDGES[:,0]],axis=2)
        lo=edge_lengths.min(axis=1)
        values=dict(cornerScaledJacobian=cs.min(axis=1),
            cornerAndCenterScaledJacobian=np.minimum(cs.min(axis=1),centre_sj),
            minimumCornerDeterminant=cd.min(axis=1),centerDeterminant=centre,
            minimumGaussDeterminant=gauss.min(axis=1),positiveCornerDetRatio=ratio(cd),
            positiveGaussDetRatio=ratio(gauss),integratedVolume=gauss.sum(axis=1),
            maxEdgeOverMinEdge=np.divide(edge_lengths.max(axis=1),lo,out=np.full(len(xyz),np.nan),where=lo>0))
        for name,value in values.items():result[name][start:start+len(xyz)]=value
    result['sampledPositiveJacobians']=np.logical_and.reduce([
        np.isfinite(result[k])&(result[k]>0) for k in
        ('minimumCornerDeterminant','centerDeterminant','minimumGaussDeterminant','integratedVolume')])
    for array in result.values():array.setflags(write=False)
    return result


def summarize_h8(metrics,element_ids=None):
    """JSON-safe statistics; no universal pass from a single quality number."""
    size=len(metrics['cornerScaledJacobian'])
    ids=np.arange(1,size+1) if element_ids is None else np.asarray(element_ids)
    if ids.shape!=(size,) or not np.issubdtype(ids.dtype,np.integer) or len(np.unique(ids))!=size:
        raise ValueError('Require matching unique integer element IDs')
    def stats(values):
        values=np.asarray(values);good=np.isfinite(values);finite=values[good]
        worst=np.flatnonzero(good)[np.argsort(finite,kind='stable')[:20]]
        return dict(finiteCount=int(good.sum()),undefinedCount=int((~good).sum()),
            minimum=float(finite.min()) if len(finite) else None,
            maximum=float(finite.max()) if len(finite) else None,
            mean=float(finite.mean()) if len(finite) else None,
            percentiles={str(q):float(np.percentile(finite,q)) for q in (1,5,50,95,99)} if len(finite) else {},
            lowestElementIDs=ids[worst].tolist())
    rows={key:stats(value) for key,value in metrics.items() if key!='sampledPositiveJacobians'}
    sj=metrics['cornerAndCenterScaledJacobian'];ratio=metrics['positiveGaussDetRatio']
    return dict(schemaVersion=1,elements=size,metrics=rows,
        sampledInvalidElementCount=int((~metrics['sampledPositiveJacobians']).sum()),
        sampledPositiveJacobians=bool(metrics['sampledPositiveJacobians'].all()),
        sampling='8corners+center for scaled Jacobian;8corners and8Gauss points for separate determinant ratios',
        metricDefinitions=dict(scaledJacobian='det(J)/(norm(column1)*norm(column2)*norm(column3))',
            positiveDetRatio='min(det(J))/max(det(J)) within one element and one sampling set, only when all samples positive',
            maxEdgeOverMinEdge='12edge length ratio, not every vendor-specific aspect-ratio formula'),
        referenceComparisons=dict(
            verdictScaledJacobian=dict(referenceLowerBound=.5,belowCount=int((np.isfinite(sj)&(sj<.5)).sum()),
                undefinedCount=int((~np.isfinite(sj)).sum()),source=REFERENCES['verdict'],advisoryOnly=True),
            hypermeshGaussDetRatio=dict(referenceLowerBound=.7,belowCount=int((np.isfinite(ratio)&(ratio<.7)).sum()),
                undefinedCount=int((~np.isfinite(ratio)).sum()),source=REFERENCES['hypermesh'],advisoryOnly=True)),
        historicalProjectScreen=dict(cornerSJFloor=.15,officialVendorStandard=False,
            belowCount=int((np.isfinite(metrics['cornerScaledJacobian'])&(metrics['cornerScaledJacobian']<.15)).sum()),
            retainedForHistoricalComparisonOnly=True),
        fullJacobianPositivityCertified=False,solverQualityVerified=False,engineeringQualityAccepted=False,
        acceptanceStatus='not-assessed-by-this-metric-report',sources=REFERENCES,
        limitations=['Finite sampling is not a global positive-Jacobian proof.',
            'No single shape metric proves analysis accuracy or mesh convergence.',
            'Core,transition,retained regions and formulation/load-dependent checks must be reviewed separately.',
            'No equivalence to every vendor implementation is claimed from formula agreement alone.'])
