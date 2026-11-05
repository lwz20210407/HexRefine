"""Whole saved M6 cap-nut CAD/H8 assembly, not all-family or solver acceptance."""
import argparse,hashlib,json,math
from pathlib import Path
import numpy as np
from .mesh_core import Mesh3D
from .mesh_audit import audit_h8
from .cad_cap_dome import build_cad_dome,equatorial_interface,_publish_partition
from .cad_cap_body import BodySpec,body_preflight,build_cad_body,body_equatorial_interface
from .cad_cap_upper import join_interfaces
from .cad_mesh_pipeline import _sha


def _finite(value):
    return type(value) in (int,float) and math.isfinite(value)


def _connectivity_exact(audit):
    flags=[audit[name] for name in ('connectivityExact','exactConnectivity') if name in audit]
    return audit.get('reader')=='ansys-dyna-core' and bool(flags) and all(v is True for v in flags)


def _body_boundary_coverage(body,physical):
    """Verify actual unchanged/fresh partitions, not a sum of claimed counts.

    Accepted local source witnesses are inherited only across bitwise identical
    coordinates and identical connectivity, bound to the original source cache.
    This remains a reproducibility cache, not a third-party attestation format.
    """
    report=body.dims;ids=np.unique(physical)
    if 'inheritedWitnessEvidence' not in report:
        if report.get('sourceBoundaryNodesChecked')!=len(ids) or report.get('sourceBoundaryFacesChecked')!=len(physical):
            raise ValueError('Body evidence does not cover its entire physical boundary')
        return dict(method='all physical boundary witnesses checked',nodes=len(ids),faces=len(physical))
    inherited=report['inheritedWitnessEvidence']
    if (report.get('purpose')!='opt-in-complete-body-exterior-corner-reanchor'
            or report.get('exteriorFeatureAccepted') is not True or report.get('fixedRadiusMm')!=4.75):
        raise ValueError('Unsupported inherited body boundary evidence')
    directory=Path(inherited['sourceCache']).resolve();expected=inherited['sourceEvidenceSHA256']
    names={'report.json':'acceptedReport','cache-manifest.json':'cacheManifest',
           'nodes.f64':'nodes.f64','elements.i32':'elements.i32','dome-interface.npz':'dome-interface.npz',
           'independent-k-audit.json':'independentSourceKReport','model.k':'sourceK'}
    hashes={}
    for name,key in names.items():
        path=directory/name
        if not path.is_file() or path.is_symlink() or path.stat().st_size>67108864:
            raise ValueError('Invalid inherited source cache file')
        hashes[name]=_sha(path)
        if hashes[name]!=expected.get(key):raise ValueError('Inherited source cache hash differs')
    source=json.loads((directory/'report.json').read_text())
    manifest=json.loads((directory/'cache-manifest.json').read_text())
    audit=json.loads((directory/'independent-k-audit.json').read_text())
    if (source.get('bodyAccepted') is not True or source.get('fullBody') is not True
            or source.get('sourceStepSHA256')!=report.get('sourceStepSHA256')
            or source.get('sourceBoundaryNodesChecked')!=len(ids) or source.get('sourceBoundaryFacesChecked')!=len(physical)
            or not _connectivity_exact(audit) or audit.get('kSHA256')!=hashes['model.k']
            or source.get('kSHA256')!=hashes['model.k']):
        raise ValueError('Inherited source cache is not complete accepted body evidence')
    for name in ('nodes.f64','elements.i32','dome-interface.npz'):
        if manifest.get('hashes',{}).get(name)!=hashes[name]:raise ValueError('Inherited source manifest differs')
    if ((directory/'nodes.f64').stat().st_size!=len(body.nodes)*24
            or (directory/'elements.i32').stat().st_size!=len(body.elems)*32):
        raise ValueError('Inherited source mesh length differs')
    old=np.fromfile(directory/'nodes.f64',dtype='<f8').reshape(-1,3)
    old_cells=np.fromfile(directory/'elements.i32',dtype='<i4').reshape(-1,8)
    if not np.isfinite(old).all() or not np.array_equal(old_cells,body.elems):
        raise ValueError('Inherited source connectivity or coordinates differ')
    with np.load(directory/'dome-interface.npz',allow_pickle=False) as port:
        current=body_equatorial_interface(body)
        if (not np.array_equal(port['nodeRings'],current['nodeRings']) or not np.array_equal(port['faces'],current['faces'])
                or not np.array_equal(port['coordinates'],current['coordinates'])):
            raise ValueError('Inherited source interface differs')
    changed=np.any(old.view(np.uint64)!=np.asarray(body.nodes,dtype='<f8').view(np.uint64),axis=1)
    touched=changed[physical].any(axis=1);fresh_ids=np.unique(physical[touched])
    fresh=report['freshBoundaryWitnesses']
    counts={'sourceBoundaryNodesChecked':len(fresh_ids),'sourceBoundaryFacesChecked':int(touched.sum()),
            'sourceBoundaryNodesInherited':len(ids)-len(fresh_ids),'sourceBoundaryFacesInherited':int((~touched).sum()),
            'sourceBoundaryNodesCovered':len(ids),'sourceBoundaryFacesCovered':len(physical)}
    if (any(type(report.get(key)) is not int or report[key]!=value for key,value in counts.items())
            or fresh.get('nodes')!=len(fresh_ids) or fresh.get('faces')!=int(touched.sum())
            or inherited.get('inheritedPhysicalBoundaryNodes')!=counts['sourceBoundaryNodesInherited']
            or inherited.get('inheritedPhysicalBoundaryFaces')!=counts['sourceBoundaryFacesInherited']):
        raise ValueError('Fresh/inherited boundary counts differ from actual node changes')
    for old_key,inherited_key,fresh_key,limit in (
            ('maximumBoundaryNodeDistanceMm','maximumInheritedNodeDistanceBoundMm','maximumNodeDistanceMm',2e-6),
            ('maximumBoundaryFaceCenterDistanceMm','maximumInheritedFaceCenterDistanceBoundMm','maximumFaceCenterDistanceMm',.02)):
        values=[source.get(old_key),inherited.get(inherited_key),fresh.get(fresh_key),report.get(old_key)]
        if (any(not _finite(v) or not 0<=v<=limit for v in values)
                or values[0]!=values[1] or values[3]!=max(values[0],values[2])):
            raise ValueError('Invalid inherited/fresh boundary distance bounds')
    frozen=np.linalg.norm(old[:,:2],axis=1)<=4.75+1e-10
    old_hash=hashlib.sha256(old[frozen].tobytes()).hexdigest()
    new_hash=hashlib.sha256(body.nodes[frozen].tobytes()).hexdigest()
    if (changed[frozen].any() or report.get('frozenNodeCount')!=int(frozen.sum())
            or report.get('frozenSourceSHA256')!=old_hash or report.get('frozenResultSHA256')!=new_hash):
        raise ValueError('Inherited body core/fixed cylinder changed')
    if any(_sha(directory/name)!=digest for name,digest in hashes.items()):
        raise ValueError('Inherited source cache changed during validation')
    return dict(method='hash-bound coordinate/connectivity identity plus fresh changed-boundary witnesses',
                nodes=len(ids),faces=len(physical),freshNodes=len(fresh_ids),freshFaces=int(touched.sum()),
                inheritedNodes=counts['sourceBoundaryNodesInherited'],inheritedFaces=counts['sourceBoundaryFacesInherited'],
                sourceReportSHA256=hashes['report.json'],coreCoordinatesUnchanged=True)


def load_body_delivery(directory,mesh_file,step):
    """Reuse own builder evidence, bound to exact mesh/K/source hashes.

    This is a reproducible local cache, not a signed attestation of arbitrary
    third-party reports. Default generation reconstructs and validates CAD live.
    """
    directory,mesh_file,step=map(lambda p:Path(p).resolve(),(directory,mesh_file,step))
    report=json.loads((directory/'report.json').read_text());independent=json.loads((directory/'independent-k-audit.json').read_text())
    if (report.get('sourceStepSHA256')!=_sha(step) or report.get('bodyMeshFileSHA256')!=_sha(mesh_file)
            or report.get('interfaceFileSHA256')!=_sha(directory/'dome-interface.npz')
            or report.get('kSHA256')!=_sha(directory/'model.k') or report.get('kSHA256')!=independent.get('kSHA256')
            or not _connectivity_exact(independent)):
        raise ValueError('Body cache does not bind source/mesh/interface/independent K')
    if report.get('bodyAccepted') is not True or report.get('fullBody') is not True:raise ValueError('Body cache is not an accepted complete body')
    with np.load(mesh_file,allow_pickle=False) as data:
        nodes=data['nodes'].copy();cells=data['elements'].copy();rings=data['interface_node_rings'].copy();faces=data['interface_faces'].copy()
    q,boundary=audit_h8(nodes,cells,0)
    if (q['nodes']!=report['quality']['nodes'] or q['elements']!=report['quality']['elements']
            or abs(q['volume']-report['quality']['volume'])/q['volume']>1e-10
            or abs(q['volume']-independent['quality']['volume'])/q['volume']>1e-10):raise ValueError('Body cache actual mesh differs from its audits')
    with np.load(directory/'dome-interface.npz',allow_pickle=False) as port:
        if not np.array_equal(port['nodeRings'],rings) or not np.array_equal(port['faces'],faces) or not np.array_equal(port['coordinates'],nodes[rings]):
            raise ValueError('Body cache interface differs from actual nodes')
    mesh=Mesh3D('CAD_CAP_BODY');mesh.nodes=nodes;mesh.elems=cells;mesh.regions=['BODY']*len(cells);mesh.region_names=['BODY']
    mesh.dims=dict(report);mesh.body_equatorial_rings=rings;mesh.surfaces={'dome-equator':faces}
    mesh.dims['cacheEvidence']=dict(reportSHA256=_sha(directory/'report.json'),independentAuditSHA256=_sha(directory/'independent-k-audit.json'),
                                   bodyMeshSHA256=_sha(mesh_file),bodyKSHA256=report['kSHA256'])
    return mesh


def assemble_whole(shape,dome,body):
    d,b=dome.dims,body.dims
    if d.get('fullDome') is not True or b.get('fullBody') is not True or b.get('bodyAccepted') is not True:raise ValueError('Whole cap requires validated complete dome and body')
    for key,limit in [('maximumBoundaryNodeDistanceMm',2e-6),('maximumBoundaryFaceCenterDistanceMm',.02),('relativeCadH8VolumeError',1e-4)]:
        if not _finite(b.get(key)) or not 0<=b[key]<=limit:raise ValueError('Body source CAD matching evidence is missing or failed')
    eq=equatorial_interface(dome);port=body_equatorial_interface(body);join=float(eq['centerMm'][2])
    if np.min(body.nodes[:,2])<-1e-12 or np.max(body.nodes[:,2])>join+1e-12 or np.min(dome.nodes[:,2])<join-1e-12:raise ValueError('Whole cap component domains overlap or leave their intended interval')
    body_quality,body_boundary=audit_h8(body.nodes,body.elems,0)
    keys={tuple(sorted(map(int,f))) for f in port['faces']}
    physical=np.array([f for f in body_boundary if tuple(sorted(map(int,f))) not in keys])
    coverage=_body_boundary_coverage(body,physical)
    nodes,cells,mapping,interface=join_interfaces(dome,body,eq,port)
    if len(cells)>400000:raise ValueError('Whole cap exceeds its 400000 H8 budget')
    if len(np.unique(nodes,axis=0))!=len(nodes):raise ValueError('Unpaired coincident nodes remain in whole cap')
    quality,boundary=audit_h8(nodes,cells,2)
    from .standard_cad import _mass
    source_volume=_mass(shape);component_cad=d['sourceCadPartitionVolume']+b['sourceCadPartitionVolume']
    partition_error=abs(source_volume-component_cad)/source_volume
    cad_error=abs(quality['volume']-source_volume)/source_volume
    sum_error=abs(quality['volume']-d['quality']['volume']-body_quality['volume'])/quality['volume']
    if partition_error>1e-7 or cad_error>1e-4 or sum_error>1e-10:raise ValueError('Whole-cap independent CAD coverage or FE volume failed')
    joined_keys={tuple(sorted(map(int,f))) for f in eq['faces']}
    if any(tuple(sorted(map(int,f))) in joined_keys for f in boundary):raise ValueError('Whole cap retains free internal interface faces')
    # Global source witnesses are supplementary to complete component checks.
    from tools.hypermesh_probe_reference import TrimmedFaceDistances
    distance=TrimmedFaceDistances(shape);ids=np.unique(boundary);sample=ids[np.linspace(0,len(ids)-1,513,dtype=int)]
    worst=max(distance(nodes[i].tolist()) for i in sample)
    centers=nodes[cells[np.linspace(0,len(cells)-1,513,dtype=int)]].mean(axis=1)
    if worst>2e-6 or not all(shape.is_inside(tuple(p)) for p in centers):raise ValueError('Whole-cap independent source witnesses failed')
    mesh=Mesh3D('CAD_CAP_NUT');mesh.nodes=nodes;mesh.elems=cells;mesh.regions=['DOME']*len(dome.elems)+['BODY']*len(body.elems);mesh.region_names=['DOME','BODY']
    report=dict(schemaVersion=1,purpose='whole-saved-M6-cap-nut-CAD-H8',fullCapNut=True,fullCadMeshAccepted=True,
                fullWorkflowAcceptance=False,solverVerified=False,nativeHmVerified=False,standardsEditionVerified=False,developmentOnly=True,
                quality=quality,interface=interface,componentDomainsDisjoint=True,artificialInterfaces=[],bodyBoundaryCoverage=coverage,
                sourceCadPartitionVolume=source_volume,relativeCadH8VolumeError=cad_error,relativeComponentCadPartitionError=partition_error,
                relativeAssemblyVolumeError=sum_error,independentGlobalBoundaryNodeProbes=len(sample),maximumGlobalBoundaryNodeDistance=worst,
                materialCentroidProbes=len(centers),allSampledCentroidsInSourceMaterial=True,dome=d,body=b,
                reusedValidatedBody='cacheEvidence' in b,sourceCadUnmodified=True,
                limitations=['Only the stated saved concentric M6 geometry, not all cap-nut sizes/families',
                             'No engineering material/contact/preload or native-HM certification',
                             'Component source-boundary evidence is inherited by exact interface pairing, not replaced by sparse global samples'])
    mesh.dims=report
    return mesh,shape,report


def build_whole(shape,divisions=128,body_spec=BodySpec(),progress=None):
    dome,_,_=build_cad_dome(shape,divisions)
    eq=equatorial_interface(dome);prepared=body_preflight(shape,eq,body_spec)
    if len(dome.elems)+prepared[3]['elements']>400000:raise ValueError('Whole-cap preflight allocation exceeds budget')
    body,_,_=build_cad_body(shape,eq,body_spec,prepared=prepared,progress=progress)
    return assemble_whole(shape,dome,body)


def generate(step,output,node,validation_python,divisions=128,body_delivery=None,body_mesh=None):
    step,output,node,validation_python=map(lambda p:Path(p).resolve(),(step,output,node,validation_python))
    if output.exists() or not output.parent.is_dir() or not node.is_file() or not validation_python.is_file():raise ValueError('Require fresh output and explicit Node/PyDYNA runtimes')
    if (body_delivery is None)!=(body_mesh is None):raise ValueError('Body reuse requires both delivery and exact mesh cache')
    if not 0<step.stat().st_size<=16777216:raise ValueError('Source cap STEP exceeds 16 MiB')
    from build123d import import_step
    digest=_sha(step);shape=import_step(step)
    if body_delivery is None:mesh,local,report=build_whole(shape,divisions)
    else:
        dome,_,_=build_cad_dome(shape,divisions);body=load_body_delivery(body_delivery,body_mesh,step)
        mesh,local,report=assemble_whole(shape,dome,body)
    return _publish_partition(step,output,node,mesh,local,report,digest,validation_python,preserve_source_step=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('step',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--node',type=Path,required=True);parser.add_argument('--validation-python',type=Path,required=True)
    parser.add_argument('--divisions',type=int,default=128);parser.add_argument('--body-delivery',type=Path);parser.add_argument('--body-mesh',type=Path)
    args=parser.parse_args();r=generate(args.step,args.output,args.node,args.validation_python,args.divisions,args.body_delivery,args.body_mesh)
    print(json.dumps({k:v for k,v in r.items() if k not in ('body','dome')},indent=2))
