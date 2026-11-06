"""Save/reopen a real native HM using an installed, licensed HyperMesh host."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys


def _sha(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1048576),b''):
            digest.update(block)
    return digest.hexdigest()


def _cached_boundary_count(report, validated):
    integer_fields=('nodes','elements','boundaryFaces','boundaryEuler')
    if (any(type(validated.get(key)) is not int for key in integer_fields)
            or validated.get('kSHA256')!=report['kSHA256'] or validated.get('reader')!='ansys-dyna-core'
            or validated['nodes']!=report['nodes'] or validated['elements']!=report['elements']
            or not math.isfinite(validated.get('volume',float('nan')))
            or not math.isfinite(validated.get('minimumCornerScaledJacobian',float('nan')))
            or abs(validated['volume']-report['volume'])/report['volume']>1e-10
            or validated['minimumCornerScaledJacobian']<.15
            or validated.get('nonmanifoldFaces')!=0 or validated.get('nonmanifoldBoundaryEdges')!=0):
        raise ValueError('Existing independent K audit does not certify this mesh')
    count=validated['boundaryFaces']+validated['boundaryEuler']
    if not 0<count<=report['nodes']:
        raise ValueError('Invalid certified boundary node count')
    return count


def _check_development_profile(report,cad_report,mesh_bytes):
    if report.get('notFullModelAcceptance') is not True or cad_report.get('developmentOnly') is not True:
        raise ValueError('Development HM requires explicitly labelled development certificates')
    profile=report.get('developmentProfile','smoke')
    profiles={'smoke':(10000,20000,2*1024*1024),'feature':(200000,300000,32*1024*1024)}
    if profile not in profiles or cad_report.get('developmentProfile','smoke')!=profile:
        raise ValueError('Unknown or inconsistent development profile')
    maximum_h8,maximum_nodes,maximum_bytes=profiles[profile]
    if report['elements']>maximum_h8 or report['nodes']>maximum_nodes or mesh_bytes>maximum_bytes:
        raise ValueError('Development HM exceeds its small-mesh budget')
    if cad_report.get('developmentKSHA256')!=report['kSHA256'] or cad_report.get('stepSHA256')!=report.get('sourceStepSHA256'):
        raise ValueError('Development CAD/K bindings do not match')
    if not cad_report.get('acceptedAsIndependentCad'):
        raise ValueError('Development CAD must still be valid independently generated geometry')
    for field,limit in [('minimumCornerScaledJacobian',.15),('minimumGaussJacobian',0)]:
        value=report.get(field,float('nan'))
        if not math.isfinite(value) or value<limit or (field=='minimumGaussJacobian' and value==0):
            raise ValueError('Development mode does not waive H8 validity/quality')


def make_tcl(mesh, cad, output, template, nodes, elements, solids, associate, tolerance, boundary, boundary_count=None,native_k_export=False,source_pids=(1,),native_cad_exchange=False,*,native_cad_database=None,native_step_export=False):
    """Build the owned host job; an optional native CAD capsule must be CAD-only.

    The STEP remains the independent geometry reference, not a replacement by
    FE-derived geometry. This low-level command builder issues no acceptance
    certificate; the caller must bind hashes and independently audit geometry.
    """
    if type(native_step_export) is not bool or native_step_export and (cad is None or not native_cad_exchange):
        raise ValueError('Native STEP carrier requires explicit CAD exchange')
    native=''
    if native_cad_database is not None:
        native_path=Path(native_cad_database).resolve()
        if cad is None or native_path.suffix.lower()!='.hm':
            raise ValueError('Native CAD input requires .hm and an independent CAD reference')
        if native_path==(Path(output)/'model.hm').resolve():
            raise ValueError('Native CAD input must not be the output database')
        native=str(native_path)
    source = Path(__file__).with_suffix('.tcl').read_text(encoding='utf-8')
    values = dict(MESH=str(mesh).encode().hex(), CAD=('' if cad is None else str(cad)).encode().hex(),
                  NATIVECADDB=native.encode().hex(),
                  DATABASE=str(output / 'model.hm').encode().hex(), AUDIT=str(output / 'host-audit.txt').encode().hex(),
                  TEMPLATE=str(template).encode().hex(), ROUNDTRIP=str(output / 'roundtrip.k').encode().hex(),
                  NODES=str(nodes), ELEMENTS=str(elements), SOLIDS=str(solids),
                  ASSOCIATE=str(int(associate)), TOLERANCE=format(tolerance, '.17g'),
                  PYTHON=sys.executable.encode().hex(),
                  BOUNDARYCOUNT=str(len(boundary) if boundary_count is None else boundary_count),
                  NATIVEKEXPORT=str(int(native_k_export)),
                  NATIVECADEXCHANGE=str(int(native_cad_exchange)),NATIVEIGES=str(output/'native-cad.iges').encode().hex(),
                  NATIVESTEPEXPORT=str(int(native_step_export)),NATIVESTEP=str(output/'native-cad.step').encode().hex(),
                  GEOCOMPSTART=str(max(source_pids)+1000),SOURCEPIDS=' '.join(str(int(pid)) for pid in source_pids),
                  BOUNDARY=' '.join(str(int(n)) for n in boundary))
    for key, value in values.items():
        source = source.replace('@' + key + '@', value)
    return source


def _accuracy_arguments(policy):
    args=['--accuracy-profile','engineering' if policy.profile=='engineering-cad-transfer' else 'strict']
    for attribute,flag in (('target_size_mm','--target-size-mm'),('critical_target_size_mm','--critical-target-size-mm'),
                           ('minimum_functional_gap_mm','--minimum-functional-gap-mm'),('minimum_root_radius_mm','--minimum-root-radius-mm')):
        value=getattr(policy,attribute)
        if value is not None:args.extend((flag,repr(value)))
    return args


def export_hm(mesh, source_report, executable, output, cad=None, cad_report=None,
              associate=False, tolerance=1e-7, debug_discrete_cad=False,native_k_export=False,host_timeout=300,development_only=False,
              cad_reference=None,cad_python=None,*,accuracy_policy=None,native_step_export=False):
    if type(host_timeout) is not int or not 1<=host_timeout<=3600:
        raise ValueError('Host timeout must be an integer in [1,3600] seconds')
    from tools.bolthex.geometry_accuracy_policy import validated_policy
    policy=validated_policy(accuracy_policy)
    if type(native_step_export) is not bool:raise ValueError('Native STEP export flag must be boolean')
    if (accuracy_policy is not None or native_step_export) and (cad is None or cad_reference is None or cad_python is None):
        raise ValueError('Explicit geometry policy/STEP carrier requires source CAD, references and CAD runtime')
    if policy.profile=='engineering-cad-transfer' and not native_step_export:
        raise ValueError('Engineering native verification requires independent STEP BRep volume evidence')
    mesh, source_report, executable, output = [Path(p).resolve() for p in [mesh, source_report, executable, output]]
    if output.exists() or not output.parent.is_dir():
        raise ValueError('Require a new output directory with an existing parent')
    if not executable.is_file() or executable.name.lower() != 'hmbatch.exe':
        raise ValueError('An installed hmbatch.exe must be selected explicitly')
    if mesh.suffix.lower() not in ('.k', '.key'):
        raise ValueError('This bounded adapter imports mesh-only LS-DYNA K')
    reference_hash=None
    if cad_reference is not None or cad_python is not None:
        if cad is None or cad_reference is None or cad_python is None or debug_discrete_cad:
            raise ValueError('Independent native CAD audit requires source CAD, reference and explicit CAD Python')
        cad_reference,cad_python=Path(cad_reference).resolve(),Path(cad_python).resolve()
        if not cad_python.is_file() or cad_reference.stat().st_size>2097152:raise ValueError('Invalid CAD audit runtime or reference')
        from tools.hypermesh_geometry_probe import validate_reference
        reference=json.loads(cad_reference.read_text());validate_reference(reference)
        if reference.get('sourceStepSHA256')!=_sha(Path(cad).resolve()):raise ValueError('CAD audit reference hash differs from source STEP')
        if sum(row['role']=='control' and 4e-6<row['sourceDistance']<.001 for row in reference['points'])<6:
            raise ValueError('Native CAD audit requires at least six near-boundary controls')
        reference_hash=_sha(cad_reference)
    report = json.loads(source_report.read_text())
    if _sha(mesh) != report['kSHA256'] or not all(type(report[k]) is int and report[k] > 0 for k in ['nodes', 'elements']):
        raise ValueError('Source mesh certificate does not match the K file')
    if not math.isfinite(report.get('volume',float('nan'))) or report['volume']<=0:
        raise ValueError('Source mesh certificate must have positive finite volume')
    if not math.isfinite(tolerance) or not 0 < tolerance <= 1e-5:
        raise ValueError('Association tolerance must be positive and no more than 1e-5; snapping is disabled')
    if development_only and (cad is None or associate or debug_discrete_cad):
        raise ValueError('Development HM requires independent CAD without association or discrete-CAD override')
    solids = 0
    if cad is not None:
        cad = Path(cad).resolve()
        if cad_report is None or cad.suffix.lower() not in ('.step', '.stp'):
            raise ValueError('CAD mode requires STEP and its generation certificate')
        cr = json.loads(Path(cad_report).read_text())
        if not debug_discrete_cad and not cr.get('geometryIndependentOfMesh', False):
            raise ValueError('Independent design CAD is required; FE-station geometry is diagnostic only')
        if _sha(cad) != cr['stepSHA256'] or type(cr['solids']) is not int or cr['solids'] < 1:
            raise ValueError('CAD certificate does not match STEP')
        if development_only:
            _check_development_profile(report,cr,mesh.stat().st_size)
        elif not debug_discrete_cad and (not cr.get('matchedMeshVerified') or cr.get('matchedKSHA256') != report['kSHA256']):
            raise ValueError('CAD boundary matching must be certified for this exact K file')
        error=cr.get('relativeMeshVolumeError')
        if error is None or not math.isfinite(error) or error<0 or (not development_only and error>1e-4):
            raise ValueError('CAD has not been checked against this discrete mesh volume')
        if abs(cr['meshVolume'] - report['volume']) / report['volume'] > 1e-10:
            raise ValueError('CAD certificate refers to a different mesh volume')
        solids = cr['solids']
    elif associate:
        raise ValueError('Association requires CAD')
    template = executable.parents[3] / 'templates/feoutput/ls-dyna971/dyna971_R112.key'
    if native_k_export and not template.is_file():
        raise ValueError('Matching LS-DYNA R11 output template is unavailable')
    baseline=mesh.parent/'independent-k-audit.json'
    reused_audit=False
    if not associate and baseline.is_file():
        validated=json.loads(baseline.read_text())
        # A closed quad boundary has E=2F, hence V=F+Euler. IDs are only
        # required by the explicitly requested node-to-CAD association path.
        boundary_count=_cached_boundary_count(report,validated)
        source_pids=[1]  # validate_cad_k certifies the bounded single-PID recipe.
        boundary=[]
        reused_audit=True
    else:
        from ansys.dyna.core import Deck
        import numpy as np
        deck = Deck(); deck.import_file(str(mesh))
        nd = next(deck.get_kwds_by_type('NODE')).nodes
        ed = next(deck.get_kwds_by_full_type('ELEMENT', 'SOLID')).elements
        source_pids=sorted(int(pid) for pid in ed['pid'].unique())
        ids = nd['nid'].to_numpy(np.int64)
        elements = ed[[f'n{i}' for i in range(1, 9)]].to_numpy(np.int64)
        if len(ids) != report['nodes'] or len(elements) != report['elements'] or not np.array_equal(ids, np.arange(1, len(ids) + 1)):
            raise ValueError('K certificate/count/ID mismatch')
        if elements.min() < 1 or elements.max() > len(ids) or not np.all(np.diff(np.sort(elements, axis=1), axis=1) > 0):
            raise ValueError('Invalid H8 connectivity')
        faces = elements[:, [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]].reshape(-1,4)
        _, first, counts = np.unique(np.sort(faces, axis=1), axis=0, return_index=True, return_counts=True)
        if np.any(counts > 2):
            raise ValueError('Nonmanifold input faces')
        boundary = np.unique(faces[first[counts == 1]])
        boundary_count=len(boundary)
    output.mkdir()
    tcl = output / 'export.tcl'
    tcl.write_text(make_tcl(mesh, cad, output, template, report['nodes'], report['elements'], solids, associate, tolerance, boundary,boundary_count,native_k_export,source_pids,cad_reference is not None,native_step_export=native_step_export), encoding='utf-8')
    startup = None
    if hasattr(subprocess, 'STARTUPINFO'):
        startup = subprocess.STARTUPINFO();startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = subprocess.SW_HIDE
    with (output / 'host.stdout.log').open('w', encoding='utf-8') as stdout, (output / 'host.stderr.log').open('w', encoding='utf-8') as stderr:
        process = subprocess.Popen([str(executable), '-tcl', str(tcl), '-nocommand'], cwd=output,
                                   stdout=stdout, stderr=stderr, startupinfo=startup)
        try:
            process.wait(timeout=host_timeout)
        except subprocess.TimeoutExpired:
            # hmbatch is a launcher on Windows; terminate only this owned tree.
            if process.poll() is None:
                if hasattr(subprocess, 'STARTUPINFO'):
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                   stdout=stderr, stderr=stderr, startupinfo=startup, timeout=30)
                else:
                    process.kill()
                process.wait(timeout=30)
            raise
    audit = output / 'host-audit.txt'
    stats = dict(line.split(' ', 1) for line in audit.read_text().splitlines() if ' ' in line) if audit.exists() else {}
    if process.returncode != 0 or stats.get('status') != 'complete' or stats.get('meshUnchanged') != '1':
        raise RuntimeError('HyperMesh export/reopen did not pass; inspect retained host logs')
    if _sha(mesh) != report['kSHA256']:
        raise RuntimeError('Source K changed during native export')
    if cad is not None and _sha(cad)!=cr['stepSHA256']:
        raise RuntimeError('Source CAD changed during native export')
    database=output/'model.hm';native_audit=None;step_audit=None
    if cad_reference is not None:
        if _sha(cad_reference)!=reference_hash:raise RuntimeError('CAD audit reference changed during native export')
        manifest=dict(nativeHmPath=str(database),nativeHmSHA256=_sha(database),sourceStepSHA256=_sha(cad),
                      igesPath=str(output/'native-cad.iges'),igesSHA256=_sha(output/'native-cad.iges'),
                      solids=int(stats['solids']),optimizationDisabled=True,
                      nativeVolumeBefore=float(stats['nativeCadVolumeBefore']),nativeVolumeAfter=float(stats['nativeCadVolumeAfter']))
        manifest_file=output/'native-cad-manifest.json';manifest_file.write_text(json.dumps(manifest,indent=2))
        with (output/'native-cad-audit.log').open('w') as log:
            done=subprocess.run([str(cad_python),'-B','-m','tools.bolthex.native_cad_audit',str(manifest_file),str(cad),str(cad_reference),str(output/'native-cad-audit.json'),*_accuracy_arguments(policy)],
                                cwd=Path(__file__).resolve().parents[1],env={**os.environ,'TEMP':str(output),'TMP':str(output),'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'},
                                stdout=log,stderr=subprocess.STDOUT,startupinfo=startup,timeout=600,check=False)
        if done.returncode!=0 or not (output/'native-cad-audit.json').is_file():raise RuntimeError('Independent native CAD audit failed; inspect retained audit log')
        native_audit=json.loads((output/'native-cad-audit.json').read_text())
        selected_flag='sampledNativeCadVerified' if policy.profile=='strict-cad-regression' else 'selectedGeometryPolicyVerified'
        if (native_audit.get(selected_flag) is not True or native_audit.get('geometryAccuracyPolicy')!=policy.manifest()
                or native_audit.get('sourceHmSHA256')!=_sha(database)
                or native_audit.get('sourceStepSHA256')!=cr['stepSHA256'] or native_audit.get('referenceSHA256')!=reference_hash
                or native_audit.get('igesSHA256')!=_sha(output/'native-cad.iges') or native_audit.get('manifestSHA256')!=_sha(manifest_file)):
            raise RuntimeError('Independent native CAD audit does not bind this HM/STEP/reference')
        for field in ('nativeBounds','sourceBounds'):
            values=native_audit.get(field)
            if (not isinstance(values,list) or len(values)!=6
                    or any(type(v) not in (int,float) or not math.isfinite(v) for v in values)
                    or any(values[i]>=values[i+3] for i in range(3))):
                raise RuntimeError('Independent native CAD geometry bounds are invalid')
        from tools.bolthex.native_cad_audit import acceptance,surface_policy_acceptance
        if not surface_policy_acceptance(native_audit,reference,policy):raise RuntimeError('Raw independent native geometry witnesses exceed the selected policy')
        if policy.profile=='strict-cad-regression' and not acceptance(native_audit):raise RuntimeError('Independent native CAD measurements exceed strict diagnostic limits')
        if abs(native_audit['nativeVolume']-manifest['nativeVolumeBefore'])/manifest['nativeVolumeBefore']>1e-12:
            raise RuntimeError('Independent native CAD volume does not bind the host measurement')
        measured_bounds=max(abs(a-b) for a,b in zip(native_audit['nativeBounds'],native_audit['sourceBounds']))
        if abs(measured_bounds-native_audit['maximumCadBoundsDifference'])>1e-12:
            raise RuntimeError('Independent native CAD geometry bounds differ from declared measurements')
        if _sha(mesh)!=report['kSHA256'] or _sha(cad)!=cr['stepSHA256'] or _sha(cad_reference)!=reference_hash:
            raise RuntimeError('Source mesh/CAD/reference changed during independent native audit')
        if native_step_export:
            carrier=output/'native-cad.step';carrier_hash=_sha(carrier)
            with (output/'native-step-audit.log').open('w') as log:
                done=subprocess.run([str(cad_python),'-B','-m','tools.bolthex.native_cad_conditioning',str(cad),str(carrier),
                    str(cad_reference),str(output/'native-step-audit.json'),*_accuracy_arguments(policy)],
                    cwd=Path(__file__).resolve().parents[1],env={**os.environ,'TEMP':str(output),'TMP':str(output),'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'},
                    stdout=log,stderr=subprocess.STDOUT,startupinfo=startup,timeout=600,check=False)
            if done.returncode!=0 or not (output/'native-step-audit.json').is_file():
                raise RuntimeError('Independent native STEP BRep geometry/volume audit failed')
            step_audit=json.loads((output/'native-step-audit.json').read_text())
            from tools.bolthex.native_cad_conditioning import step_carrier_acceptance
            if (step_audit.get('selectedGeometryPolicyVerified') is not True or step_audit.get('geometryAccuracyPolicy')!=policy.manifest()
                    or not step_carrier_acceptance(step_audit,policy)
                    or step_audit.get('sourceStepSHA256')!=cr['stepSHA256'] or step_audit.get('carrierStepSHA256')!=carrier_hash
                    or step_audit.get('referenceSHA256')!=reference_hash or _sha(carrier)!=carrier_hash
                    or _sha(database)!=manifest['nativeHmSHA256'] or _sha(mesh)!=report['kSHA256']):
                raise RuntimeError('Native STEP audit does not bind the unchanged HM/source inputs')
    cad_bounds = None
    bounds_verified=False
    bounds_error=None
    if cad is not None and not debug_discrete_cad:
        cad_bounds=[float(value) for value in stats.get('cadBounds','').split()]
        expected=cr['bbox']['min']+cr['bbox']['max']
        if len(cad_bounds)!=6 or not all(math.isfinite(value) for value in cad_bounds):
            raise RuntimeError('Native HM geometry bounds are invalid')
        facet_bounds=list(cad_bounds);facet_error=max(abs(a-b) for a,b in zip(facet_bounds,expected))
        if native_audit is not None:cad_bounds=native_audit['nativeBounds']
        bounds_error=max(abs(a-b) for a,b in zip(cad_bounds,expected))
        bounds_verified=bounds_error<=policy.carrier_limits()['maximumCadBoundsDifference']
        if not bounds_verified and not development_only:
            raise RuntimeError('Native HM geometry bounds differ from the independent CAD')
        if development_only:
            scale=max(expected[i+3]-expected[i] for i in range(3))
            if not math.isfinite(scale) or scale<=0 or bounds_error>scale*.01:
                raise RuntimeError('Development CAD appears grossly shifted or scaled')
    result = dict(schemaVersion=1, mode='development-cad-and-mesh' if development_only else 'cad-and-mesh' if cad else 'mesh-only',
        host=str(executable), nativeHm=True, hmSHA256=_sha(database), sourceKSHA256=_sha(mesh),
        sourceStepSHA256=None if cad is None else _sha(cad), hostExitCode=process.returncode,
        **{key:int(stats[key]) for key in ['nodes', 'elements', 'surfaces', 'solids', 'boundaryNodes']},
        associatedNodes=None if stats['associatedNodes']=='-1' else int(stats['associatedNodes']),
        associationAudited=stats['associatedNodes']!='-1',
        reusedExactIndependentKAudit=reused_audit,
        nativeKeywordRoundtrip=native_k_export,
        sourcePartIds=source_pids,geometryComponentStart=max(source_pids)+1000,
        sourcePartIdsVerified=True,diagnosticOnly=bool(debug_discrete_cad or development_only),
        notFullModelAcceptance=development_only,
        strictCadMeshMatchingVerified=cad is not None and not debug_discrete_cad and not development_only,
        measuredCadMeshVolumeError=None if cad is None else cr.get('relativeMeshVolumeError'),
        independentCadVerified=cad is not None and not debug_discrete_cad,
        hostTimeoutSeconds=host_timeout,
        savedAndReopened=True, meshDataUnchanged=True, nodeSnapping=False,
        cadBounds=cad_bounds,cadBoundsVerified=bounds_verified,maximumCadBoundsDifference=bounds_error,
        cadBoundsMethod='independent-native-IGES-BRep' if native_audit is not None else 'native-faceted-bounds',
        nativeFacetCadBounds=None if cad is None or debug_discrete_cad else facet_bounds,
        maximumNativeFacetBoundsDifference=None if cad is None or debug_discrete_cad else facet_error,
        sampledNativeCadVerified=native_audit is not None and native_audit.get('sampledNativeCadVerified') is True,
        selectedNativeCadGeometryVerified=native_audit is not None,
        geometryAccuracyPolicy=policy.manifest(),nativeBrepVolumeVerified=step_audit is not None,
        nativeStepCarrierSHA256=None if step_audit is None else _sha(output/'native-cad.step'),
        nativeStepAuditSHA256=None if step_audit is None else _sha(output/'native-step-audit.json'),
        nativeBrepVolumeMethod=None if step_audit is None else 'independent exported STEP BRep; not approximate host volume',
        nativeCadVerificationMethod=None if native_audit is None else 'read-only carriers exported after reopening saved HM; finite geometry comparison',
        exactNativeCadCertified=False,engineeringAnalysisVerified=False,
        nativeCadAuditSHA256=None if native_audit is None else _sha(output/'native-cad-audit.json'),
        associationTolerance=tolerance if associate else None,
        limitations=['Native HM requires installed HyperMesh; K/INP do not.',
          'CAD mode retains the supplied STEP representation; it does not manufacture missing CAD.',
          'Association is not a certificate of analytical-helix or standard compliance.'])
    (output / 'report.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('mesh');p.add_argument('source_report');p.add_argument('output')
    p.add_argument('--hmbatch', required=True);p.add_argument('--cad');p.add_argument('--cad-report')
    p.add_argument('--associate', action='store_true');p.add_argument('--tolerance', type=float, default=1e-7)
    p.add_argument('--debug-discrete-cad', action='store_true')
    p.add_argument('--native-k-export', action='store_true')
    p.add_argument('--host-timeout',type=int,default=300)
    p.add_argument('--development-only',action='store_true')
    p.add_argument('--cad-reference');p.add_argument('--cad-python')
    p.add_argument('--accuracy-profile',choices=('strict','engineering'))
    p.add_argument('--target-size-mm',type=float);p.add_argument('--critical-target-size-mm',type=float)
    p.add_argument('--minimum-functional-gap-mm',type=float);p.add_argument('--minimum-root-radius-mm',type=float)
    p.add_argument('--native-step-export',action='store_true',help='Independent native STEP BRep geometry/volume check; required by engineering profile')
    a = p.parse_args()
    policy=None
    options=dict(target_size_mm=a.target_size_mm,critical_target_size_mm=a.critical_target_size_mm,
        minimum_functional_gap_mm=a.minimum_functional_gap_mm,minimum_root_radius_mm=a.minimum_root_radius_mm)
    if a.accuracy_profile is not None or any(v is not None for v in options.values()):
        from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy
        policy=CadAccuracyPolicy('engineering-cad-transfer' if a.accuracy_profile=='engineering' else 'strict-cad-regression',**options)
    print(json.dumps(export_hm(a.mesh, a.source_report, a.hmbatch, a.output, a.cad, a.cad_report, a.associate, a.tolerance, a.debug_discrete_cad,a.native_k_export,a.host_timeout,a.development_only,a.cad_reference,a.cad_python,
        accuracy_policy=policy,native_step_export=a.native_step_export), indent=2))
