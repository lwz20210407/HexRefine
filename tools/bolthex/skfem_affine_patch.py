"""Independent optional H8 linear-elastic patch check via scikit-fem.

Only external boundary DOFs are prescribed. Interior DOFs are solved from the
assembled stiffness matrix, then compared with the analytical affine field.
This is a numerical patch verification, not contact/preload or R11 acceptance.
"""
from pathlib import Path
import hashlib
import importlib.metadata
import json
import time
import warnings

import numpy as np

from .mesh_audit import audit_h8,SIGNS
from .truegrid_screw import read_keyword

MAX_ELEMENTS=100000
PATCH_RELATIVE_TOLERANCE=1e-8


def _sha(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024**2),b''):digest.update(chunk)
    return digest.hexdigest()


def verify_case(case):
    """Verify a prepared case without modifying its mesh or R11 run evidence."""
    case=Path(case).resolve();target_file=case/'skfem-result.json'
    if target_file.exists():raise ValueError('Independent verification output already exists')
    metadata_file=case/'case.json'
    if not metadata_file.is_file() or metadata_file.stat().st_size>2*1024**2:raise ValueError('Invalid case metadata budget')
    metadata_hash=_sha(metadata_file);meta=json.loads(metadata_file.read_text())
    reference=case/'reference.npz'
    if not reference.is_file() or reference.stat().st_size>32*1024**2 or _sha(reference)!=meta['referenceSHA256']:
        raise ValueError('Independent reference binding changed')
    mesh=read_keyword(meta['sourceMesh'])
    if mesh.source_sha256!=meta['sourceSHA256'] or len(mesh.elements)>MAX_ELEMENTS:
        raise ValueError('Source changed or full-case budget exceeded')
    qa,boundary=audit_h8(mesh.nodes,mesh.elements,minimum_sj=0.)
    boundary_rows=np.unique(boundary);interior=np.setdiff1d(np.arange(len(mesh.nodes)),boundary_rows)
    if not len(interior):raise ValueError('No free interior nodes: this is not an interior patch test')
    young,nu=meta['young'],meta['poisson'];strain=np.asarray(meta['strainTensor'],dtype=float)
    if (type(young) not in (int,float) or not np.isfinite(young) or young<=0
            or type(nu) not in (int,float) or not np.isfinite(nu) or not -1<nu<.5
            or strain.shape!=(3,3) or not np.isfinite(strain).all() or not np.array_equal(strain,strain.T)
            or not 0<float(abs(strain).max())<=1e-3):raise ValueError('Invalid declared synthetic physics')
    origin=(mesh.nodes.min(0)+mesh.nodes.max(0))/2
    expected=(mesh.nodes-origin)@strain.T
    lam=young*nu/((1+nu)*(1-2*nu));mu=young/(2*(1+nu))
    sigma=2*mu*strain+lam*np.trace(strain)*np.eye(3)
    energy=.5*float(np.sum(sigma*strain))*qa['volume']
    with np.load(reference,allow_pickle=False) as r:
        for key,value in (('nodes',mesh.nodes),('elements',mesh.elements),('node_ids',mesh.node_ids),
                          ('element_ids',mesh.element_ids),('boundary_rows',boundary_rows),('interior_rows',interior),
                          ('target_displacements',expected)):
            if not np.array_equal(r[key],value):raise ValueError('Prepared reference differs: '+key)
    if not np.array_equal(np.asarray(meta['expectedStressTensor']),sigma) or meta['expectedElasticEnergy']!=energy:
        raise ValueError('Analytical stress/energy metadata differs from recomputation')

    from skfem import MeshHex,ElementHex1,ElementVector,Basis,asm,condense,solve
    from skfem.models.elasticity import linear_elasticity
    from scipy.sparse.linalg import MatrixRankWarning
    start=time.monotonic()
    reference_points=(SIGNS+1)/2
    element=ElementHex1()
    permutation=[]
    for point in element.doflocs:
        match=np.flatnonzero(np.all(reference_points==point,axis=1))
        if len(match)!=1:raise ValueError('Unsupported backend Hex1 reference ordering')
        permutation.append(int(match[0]))
    topology=np.ascontiguousarray(mesh.elements[:,permutation].T)
    backend_mesh=MeshHex(np.ascontiguousarray(mesh.nodes.T),topology,sort_t=False)
    if not np.array_equal(backend_mesh.t,topology):raise ValueError('Backend reordered source elements')
    basis=Basis(backend_mesh,ElementVector(element),intorder=2)
    determinant=basis.mapping.detDF(basis.X)
    if not np.isfinite(determinant).all() or np.any(determinant<=0):raise ValueError('Backend mapping is not positively oriented')
    backend_volume=float(basis.dx.sum())
    if abs(backend_volume-qa['volume'])/qa['volume']>1e-12:raise ValueError('Independent quadrature volume mismatch')
    fixed=np.sort(basis.nodal_dofs[:,boundary_rows].ravel())
    free=np.setdiff1d(np.arange(basis.N),fixed)
    if len(free)!=3*len(interior):raise ValueError('Backend interior DOF inventory differs')
    exact=np.zeros(basis.N);exact[basis.nodal_dofs]=expected.T
    prescribed=np.zeros(basis.N);prescribed[fixed]=exact[fixed]
    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter('always');warnings.simplefilter('error',MatrixRankWarning)
        stiffness=asm(linear_elasticity(lam,mu),basis)
        solution=solve(*condense(stiffness,np.zeros(basis.N),x=prescribed,D=fixed))
    if not np.isfinite(solution).all():raise ValueError('Nonfinite solved displacement')
    displacement=solution[basis.nodal_dofs].T
    displacement_error=float(abs(displacement-expected).max())/float(abs(expected).max())
    reaction=stiffness@solution
    residual=float(abs(reaction[free]).max())/max(float(abs(reaction[fixed]).max()),np.finfo(float).tiny)
    computed_energy=.5*float(solution@reaction)
    energy_error=abs(computed_energy-energy)/energy
    field=basis.interpolate(solution)
    eps=.5*(field.grad+field.grad.swapaxes(0,1))
    trace=np.einsum('iien->en',eps)
    stresses=2*mu*eps+lam*np.eye(3)[:,:,None,None]*trace[None,None,:,:]
    stress_error=float(abs(stresses-sigma[:,:,None,None]).max())/float(abs(sigma).max())
    symmetry=stiffness-stiffness.T
    symmetry_error=(float(abs(symmetry.data).max()) if symmetry.nnz else 0.)/max(float(abs(stiffness.data).max()),np.finfo(float).tiny)
    errors=dict(displacement=displacement_error,freeDOFEquilibrium=residual,
                elasticEnergy=energy_error,allGaussStress=stress_error,stiffnessSymmetry=symmetry_error)
    if not all(np.isfinite(v) for v in errors.values()):raise ValueError('Nonfinite independent verification statistic')
    if _sha(meta['sourceMesh'])!=meta['sourceSHA256'] or _sha(reference)!=meta['referenceSHA256'] or _sha(metadata_file)!=metadata_hash:
        raise ValueError('Readonly inputs changed during verification')
    result=dict(schemaVersion=1,engine='scikit-fem',engineVersion=importlib.metadata.version('scikit-fem'),
        purpose='Synthetic constant-strain linear-elastic H8 patch on the complete supplied mesh',
        sourceSHA256=meta['sourceSHA256'],caseMetadataSHA256=metadata_hash,referenceSHA256=meta['referenceSHA256'],
        nodes=len(mesh.nodes),H8=len(mesh.elements),degreesOfFreedom=int(basis.N),freeInteriorDOFs=len(free),
        prescribedBoundaryDOFs=len(fixed),quadraturePointsPerCell=len(basis.W),
        sourceToBackendLocalOrder=permutation,sourceUnchanged=True,interiorInitialGuessWasAnalytical=False,
        referenceVolume=qa['volume'],backendVolume=backend_volume,expectedElasticEnergy=energy,
        computedElasticEnergy=computed_energy,relativeErrors=errors,relativeNumericalTolerance=PATCH_RELATIVE_TOLERANCE,
        toleranceScope='declared double-precision linear benchmark tolerance, not a mesh-quality or vendor standard',
        syntheticLinearPatchVerified=all(v<=PATCH_RELATIVE_TOLERANCE for v in errors.values()),
        r11Verified=False,engineeringFastenerAnalysisVerified=False,contactPreloadOrMaterialCalibrationVerified=False,
        seconds=time.monotonic()-start,warnings=[str(w.message) for w in captured])
    json.dumps(result,allow_nan=False)  # Validate metadata before publishing any result artifact.
    with (case/'skfem-displacements.npz').open('xb') as stream:
        np.savez_compressed(stream,node_ids=mesh.node_ids,displacements=displacement)
    result['displacementsSHA256']=_sha(case/'skfem-displacements.npz')
    serialized=json.dumps(result,indent=2,allow_nan=False)
    with target_file.open('x') as stream:stream.write(serialized)
    return result
