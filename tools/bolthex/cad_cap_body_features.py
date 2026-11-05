"""Opt-in six-corner reanchor of an accepted cached Body's OUTERMOST ring.

No planner, new cells, inner-ring smoothing or CAD modification. The unchanged
physical boundary inherits hash-bound accepted witnesses; only boundary faces
touching changed nodes receive fresh CAD witnesses. This is not cone/plane
crease-conforming meshing or a complete cap/HM/solver certificate.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np

from .cad_cap_outer import anchor_outer_angles
from .mesh_audit import audit_h8
from .mesh_core import Mesh3D


def _sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _accepted_boundary_evidence(report):
    if report.get('bodyAccepted') is not True or report.get('fullBody') is not True:
        raise ValueError('Inherited evidence requires strict fullBody/bodyAccepted True')
    result=[]
    for name,limit in (('maximumBoundaryNodeDistanceMm',2e-6),('maximumBoundaryFaceCenterDistanceMm',.02)):
        value=report.get(name)
        if type(value) not in (int,float) or not math.isfinite(value) or value<0:
            raise ValueError(f'Inherited {name} must be a finite nonnegative nonboolean number')
        if value>limit:raise ValueError(f'Inherited {name} exceeds its unchanged gate')
        result.append(value)
    return tuple(result)


def hex_corner_edges(shape, fixed_radius=4.75):
    """Recognize six actual vertical CAD edges outside the frozen cylinder."""
    normals = []
    for face in shape.faces():
        if face.geom_type.name != 'PLANE':
            continue
        n, p = face.normal_at(), face.center()
        d = n.X*p.X+n.Y*p.Y
        if abs(n.Z) < 1e-8 and d > fixed_radius+1e-4:
            normals.append((math.atan2(n.Y,n.X)%math.tau, d))
    normals = np.array(sorted(normals))
    if (normals.shape != (6,2) or np.ptp(normals[:,1]) > 1e-7
            or np.max(abs(np.diff(np.r_[normals[:,0],normals[0,0]+math.tau])-math.tau/6)) > 1e-7):
        raise ValueError('Require six regular source hex planes')
    radius = float(normals[:,1].mean()/math.cos(math.pi/6))
    found = []
    for i, edge in enumerate(shape.edges()):
        if edge.geom_type.name != 'LINE':
            continue
        vertices = list(edge.vertices())
        if len(vertices) != 2:
            continue
        a,b = np.array(tuple(vertices[0])),np.array(tuple(vertices[1]))
        if (np.linalg.norm(a[:2]-b[:2]) > 1e-8 or abs(a[2]-b[2]) < 1e-3
                or abs(np.linalg.norm(a[:2])-radius) > 2e-6):
            continue
        theta = math.atan2(a[1],a[0])%math.tau
        if abs(theta-math.tau) < 1e-10:theta=0.
        found.append((theta,edge,dict(edge=i,xyMm=a[:2].tolist(),
            zRangeMm=[float(min(a[2],b[2])),float(max(a[2],b[2]))])))
    found.sort(key=lambda item:item[0])
    if len(found) != 6:
        raise ValueError('Require six actual straight hex corner edges')
    return found


def reanchor_outer_ring(nodes, theta_deg, radial_rings, corner_rays, radius_at, *, progress=None):
    """Copy nodes, changing only the last radial ring at its original Z.

    radius_at(theta_degrees,z) must query the original CAD, not rotate a cached
    old radius. All other rings and all node IDs remain bitwise unchanged.
    """
    theta = np.asarray(theta_deg,dtype=float)
    if (type(radial_rings) is not int or radial_rings < 2 or theta.ndim != 1
            or len(theta)<96 or not np.isfinite(theta).all() or np.any(np.diff(theta)<=0)):
        raise ValueError('Invalid indexed body rings/angles')
    source = np.asarray(nodes)
    if (source.ndim!=2 or source.shape[1]!=3 or source.dtype!=np.float64
            or not np.isfinite(source).all() or len(source)%(radial_rings*len(theta))):
        raise ValueError('Require finite float64 indexed body nodes')
    grid=source.reshape(-1,radial_rings,len(theta),3)
    if len(grid)<2 or np.any(np.diff(grid[:,0,0,2])<=0):
        raise ValueError('Body axial levels must increase')
    if np.max(abs(grid[:,:,:,2]-grid[:,0,0,2,None,None]))>1e-12:
        raise ValueError('Body node layout does not retain axial planes')
    if (np.max(np.linalg.norm(grid[:,:-1,:,:2],axis=3))>4.75+1e-10
            or np.min(np.linalg.norm(grid[:,-1,:,:2],axis=2))<=4.75+1e-8):
        raise ValueError('Only one outer ring outside R=4.75 is supported')
    actual=np.arctan2(grid[:,-1,:,1],grid[:,-1,:,0])
    angles=np.radians(theta)
    if np.max(abs((actual-angles[None,:]+math.pi)%math.tau-math.pi))>1e-10:
        raise ValueError('Cached exterior angles disagree with the source reference grid')
    mapped,indices,targets=anchor_outer_angles(angles,corner_rays)
    active=np.flatnonzero(abs(mapped-angles)>1e-12)
    result=source.copy();out=result.reshape(grid.shape)
    for k,z in enumerate(grid[:,0,0,2]):
        for i in active:
            r=float(radius_at(float(np.rad2deg(mapped[i])%360),float(z)))
            if not math.isfinite(r) or r<=4.75:
                raise ValueError('Original CAD returned an invalid exterior radius')
            out[k,-1,i,:2]=r*np.array([math.cos(mapped[i]),math.sin(mapped[i])])
        if progress is not None:progress('outer-CAD-rays',k+1,len(grid),0.)
    changed=np.flatnonzero(np.any(result!=source,axis=1))
    frozen=np.arange(len(source)).reshape(grid.shape[:3])[:,:-1].ravel()
    if not np.array_equal(result[frozen].view(np.uint64),source[frozen].view(np.uint64)):
        raise ValueError('Reanchor moved frozen inner nodes')
    if not np.array_equal(result[:,2],source[:,2]):raise ValueError('Reanchor moved axial levels')
    return result,changed,dict(anchorIndices=indices.tolist(),cornerRaysDeg=np.rad2deg(targets).tolist(),
        outerThetaDeg=np.rad2deg(mapped).tolist(),maximumAngleShiftDeg=float(np.rad2deg(abs(mapped-angles)).max()),
        frozenNodes=len(frozen),changedNodes=len(changed),needsReanchor=bool(len(active)))


def _edge_witnesses(nodes, rings, theta, edges):
    grid=nodes.reshape(-1,rings,len(theta),3)
    _,indices,_=anchor_outer_angles(np.radians(theta),[e[0] for e in edges])
    result=[]
    for index,(_,edge,data) in zip(indices,edges):
        low,high=data['zRangeMm'];z=grid[:,0,0,2]
        points=grid[(z>=low-1e-9)&(z<=high+1e-9),-1,index]
        if not len(points):raise ValueError('No cached stations intersect a real hex corner line')
        result.append(dict(data,index=int(index),samples=len(points),
            maximumDistanceToActualEdgeMm=max(edge.distance_to(tuple(p)) for p in points),
            maximumXYColumnSpreadMm=float(np.linalg.norm(points[:,:2]-points[:1,:2],axis=1).max())))
    return result


def reanchor_cached_body(directory, *, progress=None):
    """Reuse a verified immutable body cache; full QA, only changed CAD probes."""
    directory=Path(directory).resolve()
    source_report=json.loads((directory/'report.json').read_text())
    manifest=json.loads((directory/'cache-manifest.json').read_text())
    _accepted_boundary_evidence(source_report)
    if (manifest.get('schemaVersion')!=1
            or manifest.get('shapeCacheReconstructedFromIdenticalIndependentCrop') is not True):
        raise ValueError('Require the trusted accepted independent-crop cache contract')
    before={name:_sha(directory/name) for name in manifest['hashes']}
    if before!=manifest['hashes']:raise ValueError('Body cache hashes do not match manifest')
    evidence_hashes=dict(cacheManifest=_sha(directory/'cache-manifest.json'),
                        acceptedReport=_sha(directory/'report.json'),**before)
    independent_path=directory/'independent-k-audit.json'
    independent=json.loads(independent_path.read_text())
    source_k_hash=_sha(directory/'model.k')
    flags=[independent[key] for key in ('connectivityExact','exactConnectivity') if key in independent]
    if (not flags or any(flag is not True for flag in flags)
            or independent.get('kSHA256')!=source_report.get('kSHA256')
            or source_k_hash!=independent.get('kSHA256')
            or independent.get('quality',{}).get('nodes')!=source_report['quality']['nodes']
            or independent.get('quality',{}).get('elements')!=source_report['quality']['elements']):
        raise ValueError('Independent source K evidence does not match the accepted cache')
    evidence_hashes.update(independentSourceKReport=_sha(independent_path),sourceK=source_k_hash)
    step=Path(source_report['sourceStep'])
    if _sha(step)!=source_report['sourceStepSHA256'] or manifest['sourceStepSHA256']!=source_report['sourceStepSHA256']:
        raise ValueError('Original source CAD hash differs')
    nodes=np.fromfile(directory/'nodes.f64','<f8').reshape(-1,3)
    cells=np.fromfile(directory/'elements.i32','<i4').reshape(-1,8)
    if len(cells)>300000 or len(nodes)!=source_report['quality']['nodes'] or len(cells)!=source_report['quality']['elements']:
        raise ValueError('Body cache count/budget mismatch')
    plan=source_report['plan'];count=len(source_report['thetaDeg']);rings=plan['radialLayers']+1
    if (plan.get('spec',{}).get('outer_layers',1)!=1
            or len(nodes)!=(plan['axialLayers']+1)*rings*count):
        raise ValueError('Only the accepted single outer-layer indexed body cache is supported')
    from build123d import import_step,import_brep
    from .cad_mesh import RadialCad
    from .cad_cap_body import _source_distances
    from .standard_cad import _mass
    shape=import_step(step);local=import_brep(directory/'body.brep')
    cad_volume=_mass(local)
    if not local.is_valid or len(local.solids())!=1 or abs(cad_volume-source_report['sourceCadPartitionVolume'])/cad_volume>1e-10:
        raise ValueError('Independent cached body BRep does not match accepted volume')
    edges=hex_corner_edges(shape)
    baseline=_edge_witnesses(nodes,rings,source_report['thetaDeg'],edges)
    if all(e['maximumDistanceToActualEdgeMm']<=2e-6 for e in baseline):
        return None,local,dict(purpose='body-exterior-feature-inspection',needsReanchor=False,
            noNewMeshRequired=True,actualCornerEdges=baseline,sourceEvidenceSHA256=evidence_hashes)
    sampler=RadialCad(shape,True)
    new,changed,feature=reanchor_outer_ring(nodes,source_report['thetaDeg'],rings,[e[0] for e in edges],
        lambda theta,z:sampler.radii(theta,z)[1],progress=progress)
    quality,boundary=audit_h8(new,cells,0)
    error=abs(quality['volume']-cad_volume)/cad_volume
    if error>1e-4:raise ValueError(f'Feature body CAD/H8 volume error {error} exceeds 1e-4')
    eq=np.load(directory/'dome-interface.npz')
    np.testing.assert_array_equal(nodes[eq['nodeRings']],eq['coordinates'])
    np.testing.assert_array_equal(new[eq['nodeRings']],eq['coordinates'])
    interface_keys={tuple(sorted(f)) for f in eq['faces']}
    physical=np.array([f for f in boundary if tuple(sorted(f)) not in interface_keys])
    physical_ids=np.unique(physical)
    if (len(physical_ids)!=source_report['sourceBoundaryNodesChecked']
            or len(physical)!=source_report['sourceBoundaryFacesChecked']):
        raise ValueError('Accepted witness coverage does not cover this exact cached boundary')
    moved=np.zeros(len(nodes),dtype=bool);moved[changed]=True
    touched=moved[physical].any(axis=1)
    fresh_faces=physical[touched];fresh_ids=np.unique(fresh_faces)
    node_error=_source_distances(shape,new[fresh_ids],2e-6,progress,'changed-boundary-nodes')
    face_error=_source_distances(shape,new[fresh_faces].mean(axis=1),.02,progress,'changed-boundary-face-centers')
    actual_edges=_edge_witnesses(new,rings,source_report['thetaDeg'],edges)
    if any(e['maximumDistanceToActualEdgeMm']>2e-6 for e in actual_edges):
        raise ValueError('Feature body did not align actual straight hex corner lines')
    frozen=np.flatnonzero(np.linalg.norm(nodes[:,:2],axis=1)<=4.75+1e-10)
    old_frozen=hashlib.sha256(nodes[frozen].tobytes()).hexdigest()
    new_frozen=hashlib.sha256(new[frozen].tobytes()).hexdigest()
    if old_frozen!=new_frozen:raise ValueError('Frozen cylinder/core hash changed')
    if any(_sha(directory/name)!=digest for name,digest in before.items()):
        raise ValueError('Immutable source cache changed during operation')
    if (_sha(directory/'report.json')!=evidence_hashes['acceptedReport']
            or _sha(directory/'cache-manifest.json')!=evidence_hashes['cacheManifest']
            or _sha(independent_path)!=evidence_hashes['independentSourceKReport']
            or _sha(directory/'model.k')!=source_k_hash or _sha(step)!=source_report['sourceStepSHA256']):
        raise ValueError('Source report/CAD changed during operation')
    # Whitelist geometry/interface fields: never accidentally publish old output
    # hashes/readbacks as evidence for the newly modified mesh.
    keep=('schemaVersion','thetaDeg','equatorRadiiMm','plan','sourceCadUnmodified',
          'partitionIndependentOfMeshSeeds','artificialInterfaces','domainZMm','runoutMapping',
          'boundaryNodeLimitMm','boundaryFaceCenterLimitMm','sourceStep','sourceStepSHA256','unit',
          'equatorialInterfaceFaces','equatorialInterfaceNodes','interfaceEveryFaceOneActualH8Owner',
          'interfaceCyclesMatchActualH8Boundary')
    report={key:source_report[key] for key in keep if key in source_report}
    report.update(purpose='opt-in-complete-body-exterior-corner-reanchor',quality=quality,
        relativeCadH8VolumeError=error,sourceCadPartitionVolume=cad_volume,fullBody=True,fullCapNut=False,
        fullModelAcceptance=False,bodyAccepted=True,cadCreaseConforming=False,exteriorFeatureAccepted=True,
        outerFeature=feature,baselineCornerEdges=baseline,actualCornerEdges=actual_edges,
        fixedRadiusMm=4.75,frozenNodeCount=len(frozen),frozenSourceSHA256=old_frozen,frozenResultSHA256=new_frozen,
        unchangedConnectivitySHA256=before['elements.i32'],inheritedWitnessEvidence=dict(
            method='unchanged boundary coordinates/connectivity; hash-bound accepted witness upper bounds',
            sourceCache=str(directory),sourceEvidenceSHA256=evidence_hashes,
            inheritedPhysicalBoundaryNodes=len(physical_ids)-len(fresh_ids),
            inheritedPhysicalBoundaryFaces=int((~touched).sum()),
            maximumInheritedNodeDistanceBoundMm=source_report['maximumBoundaryNodeDistanceMm'],
            maximumInheritedFaceCenterDistanceBoundMm=source_report['maximumBoundaryFaceCenterDistanceMm'],
            unchangedBoreWitnessesRerun=False),
        cacheValidationContract='immutable accepted independent-crop cache + manifest hashes + independent PyDYNA source K evidence',
        independentSourceKReportLoaded=True,
        sourceOutputEvidence=dict(sourceKSHA256=source_report.get('kSHA256'),
            sourceInpSHA256=source_report.get('inpSHA256'),sourceBodyMeshFileSHA256=source_report.get('bodyMeshFileSHA256')),
        freshBoundaryWitnesses=dict(nodes=len(fresh_ids),faces=len(fresh_faces),
            maximumNodeDistanceMm=node_error,maximumFaceCenterDistanceMm=face_error,
            nodeLimitMm=2e-6,faceCenterLimitMm=.02),
        maximumBoundaryNodeDistanceMm=max(node_error,source_report['maximumBoundaryNodeDistanceMm']),
        maximumBoundaryFaceCenterDistanceMm=max(face_error,source_report['maximumBoundaryFaceCenterDistanceMm']),
        sourceBoundaryNodesChecked=len(fresh_ids),sourceBoundaryFacesChecked=len(fresh_faces),
        sourceBoundaryNodesInherited=len(physical_ids)-len(fresh_ids),sourceBoundaryFacesInherited=int((~touched).sum()),
        sourceBoundaryNodesCovered=len(physical_ids),sourceBoundaryFacesCovered=len(physical),
        surfaceWitnessMethod='hash-bound inherited unchanged boundary + fresh trimmed-source changed-boundary witnesses; separate node/face-center gates, not a full rerun',
        witnessCoverageMode='fresh changed-boundary plus inherited unchanged-boundary evidence',
        interfaceCoordinatesBitwiseEqual=True,sourceCadUnmodified=True,
        limitations=['Exterior corner rays/straight lines only, not all cone-plane crease partitions',
                     'One unchanged saved M6 Body domain; not the full cap nut or a new BodySpec/planner',
                     'Inner/bore witness evidence is inherited, not a fresh full-boundary rerun',
                     'No native-HM, material/contact/preload, solver or general standards certification'])
    mesh=Mesh3D('CAD_CAP_BODY_EXTERIOR_FEATURES');mesh.nodes=new;mesh.elems=cells
    mesh.regions=['BODY']*len(cells);mesh.region_names=['BODY'];mesh.dims=report
    mesh.body_equatorial_rings=eq['nodeRings'].copy()
    mesh.surfaces={'dome-equator':eq['faces'].copy()}
    return mesh,local,report
