"""Synthetic linear-elastic affine patch verification for complete H8 meshes.

This is not a fastener contact/preload/material validation. R11 definitions:
Vol.I CONTROL12-284/312, BOUNDARY5-47, DATABASE14-5/86. The original mesh is
read-only; all synthetic physics and solver output live in a fresh case folder.
"""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import time

import numpy as np

from .truegrid_screw import read_keyword
from .mesh_audit import audit_h8
from .h8_quality_report import measure_h8,summarize_h8

MAX_ELEMENTS=100000
MAX_OUTPUT_BYTES=128*1024**2
DEFAULT_STRAIN=np.array([[2e-6,3e-7,-2e-7],[3e-7,-1e-6,4e-7],[-2e-7,4e-7,1.5e-6]])


def _sha(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024**2),b''):digest.update(chunk)
    return digest.hexdigest()


def _id_rows(values):
    values=list(map(int,values))
    return '\n'.join(','.join(map(str,values[i:i+8])) for i in range(0,len(values),8))+'\n'


def _history_cards(keyword,values):
    values=list(map(int,values))
    for i in range(0,len(values),8):
        yield keyword+'\n'+_id_rows(values[i:i+8])


def _artifact_sizes(case):
    sizes=[]
    for path in case.iterdir():
        try:
            if path.is_file():sizes.append(path.stat().st_size)
        except FileNotFoundError:
            # The licensed solver removes short-lived status files during startup.
            continue
    return sizes


def _stop_owned(process):
    if process.poll() is None:
        process.terminate()
        try:process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill();process.wait(timeout=10)


def build_case(source_mesh,output,*,strain=None,young=1000.,poisson=.25):
    """Prepare an explicit synthetic test, without starting a solver."""
    source_mesh=Path(source_mesh).resolve();output=Path(output).resolve()
    if output.exists() or not output.parent.is_dir():raise ValueError('Require a fresh case under an existing output root')
    for value,name in ((young,'Young modulus'),(poisson,'Poisson ratio')):
        if type(value) not in (int,float) or not np.isfinite(value):raise ValueError('Invalid '+name)
    if not young>0 or not -1<poisson<.5:raise ValueError('Invalid isotropic elastic constants')
    eps=np.array(DEFAULT_STRAIN if strain is None else strain,dtype=float,copy=True)
    if eps.shape!=(3,3) or not np.isfinite(eps).all() or not np.array_equal(eps,eps.T) or not 0<float(abs(eps).max())<=1e-3:
        raise ValueError('Require a finite small symmetric nonzero strain tensor')
    mesh=read_keyword(source_mesh)
    if len(mesh.elements)>MAX_ELEMENTS:raise ValueError('Synthetic solver case exceeds100000H8 budget')
    if len(np.unique(mesh.elements))!=len(mesh.nodes):raise ValueError('Unused nodes must be diagnosed before solver verification')
    text=source_mesh.read_text(encoding='ascii')
    cards={line.split('$',1)[0].strip().upper() for line in text.splitlines() if line.lstrip().startswith('*')}
    if not cards<={'*KEYWORD','*END','*NODE','*ELEMENT_SOLID','*TITLE'}:
        raise ValueError('Require mesh-only source; never override original physical cards')
    qa,boundary=audit_h8(mesh.nodes,mesh.elements,minimum_sj=0.)
    metrics=measure_h8(mesh.nodes,mesh.elements)
    boundary_rows=np.unique(boundary);all_rows=np.arange(len(mesh.nodes));interior_rows=np.setdiff1d(all_rows,boundary_rows)
    if not len(interior_rows):raise ValueError('A solver patch needs unconstrained interior nodes')
    origin=(mesh.nodes.min(0)+mesh.nodes.max(0))/2
    target=(mesh.nodes-origin)@eps.T
    mu=young/(2*(1+poisson));lam=young*poisson/((1+poisson)*(1-2*poisson))
    stress=2*mu*eps+lam*np.trace(eps)*np.eye(3)
    expected_energy=.5*float(np.sum(stress*eps))*qa['volume']
    if not np.isfinite(stress).all() or not np.isfinite(expected_energy) or expected_energy<=np.finfo(float).tiny:
        raise ValueError('Synthetic reference is not representable in floating-point arithmetic')
    sample=set(map(int,np.argsort(metrics['cornerAndCenterScaledJacobian'],kind='stable')[:32]))
    sample.update(map(int,np.random.default_rng(20261106).choice(len(mesh.elements),min(128,len(mesh.elements)),replace=False)))
    for pid in np.unique(mesh.part_ids):sample.add(int(np.flatnonzero(mesh.part_ids==pid)[0]))
    sample=np.array(sorted(sample),dtype=np.int64)

    from ansys.dyna.core import keywords as kw
    import pandas as pd
    controls=[kw.ControlTermination(endtim=1.),kw.ControlImplicitGeneral(imflag=1,dt0=1.),
        kw.ControlImplicitSolution(nsolvr=1),kw.SectionSolid(secid=1,elform=2),
        kw.MatElastic(mid=1,ro=1e-9,e=young,pr=poisson),
        kw.DatabaseNodout(dt=1.,binary=2),kw.DatabaseElout(dt=1.,binary=2),kw.DatabaseGlstat(dt=1.,binary=2)]
    parts=kw.Part();parts.parts=pd.DataFrame([dict(heading='SYNTHETIC PATCH PID '+str(int(pid)),pid=int(pid),secid=1,mid=1) for pid in np.unique(mesh.part_ids)])
    controls.append(parts)
    curve=kw.DefineCurve(lcid=1);curve.curves=pd.DataFrame({'a1':[0.,1.],'o1':[0.,1.]});controls.append(curve)
    output.mkdir()
    # Preserve source numerical rows; strip only outer file delimiters for include.
    include='\n'.join(line for line in text.splitlines() if line.split('$',1)[0].strip().upper() not in ('*KEYWORD','*END'))+'\n'
    (output/'geometry.inc').write_text(include,encoding='ascii')
    deck=output/'patch.k'
    with deck.open('x',encoding='ascii') as stream:
        stream.write('*KEYWORD\n*TITLE\nSYNTHETIC AFFINE ELASTIC PATCH; NOT FASTENER LOAD CERTIFICATION\n')
        for card in controls:stream.write(str(card)+'\n')
        for card in _history_cards('*DATABASE_HISTORY_NODE',mesh.node_ids):stream.write(card)
        for card in _history_cards('*DATABASE_HISTORY_SOLID',mesh.element_ids[sample]):stream.write(card)
        for row in boundary_rows:
            for dof in range(3):
                stream.write('*BOUNDARY_PRESCRIBED_MOTION_NODE\n')
                stream.write(f'{int(mesh.node_ids[row])},{dof+1},2,1,{target[row,dof]:.17g},0\n')
        stream.write('*INCLUDE\ngeometry.inc\n*END\n')
    with (output/'reference.npz').open('xb') as stream:
        np.savez_compressed(stream,node_ids=mesh.node_ids,element_ids=mesh.element_ids,
            nodes=mesh.nodes,elements=mesh.elements,target_displacements=target,
            boundary_rows=boundary_rows,interior_rows=interior_rows,sampled_element_rows=sample)
    report=dict(schemaVersion=1,purpose='Complete supplied-mesh synthetic affine linear-elastic patch',
        sourceMesh=str(source_mesh),sourceSHA256=mesh.source_sha256,sourceUnchanged=_sha(source_mesh)==mesh.source_sha256,
        inputDeckSHA256=_sha(deck),geometryIncludeSHA256=_sha(output/'geometry.inc'),referenceSHA256=_sha(output/'reference.npz'),
        nodes=len(mesh.nodes),H8=len(mesh.elements),boundaryNodes=len(boundary_rows),freeInteriorNodes=len(interior_rows),
        originalPIDs=sorted(map(int,np.unique(mesh.part_ids))),sampledStressElements=len(sample),
        units='mm,N,s,tonne; synthetic E and density are NOT material calibration',
        young=young,poisson=poisson,density=1e-9,strainTensor=eps.tolist(),referenceOrigin=origin.tolist(),
        expectedStressTensor=stress.tolist(),expectedElasticEnergy=expected_energy,
        expectedStressOrder=['xx','yy','zz','xy','yz','zx'],
        expectedStressVector=[float(stress[i,j]) for i,j in ((0,0),(1,1),(2,2),(0,1),(1,2),(2,0))],
        geometryQuality=summarize_h8(metrics,mesh.element_ids),solverRun=False,
        syntheticPatchPassed=False,engineeringFastenerAnalysisVerified=False,
        noContactOrPreloadValidation=True,sourcePhysicsOverridden=False)
    if not report['sourceUnchanged']:raise ValueError('Readonly source changed')
    with (output/'case.json').open('x') as stream:json.dump(report,stream,indent=2,allow_nan=False)
    return report


def run_case(case,solver,*,timeout_seconds=120,memory_megawords=50):
    """Run only this fresh owned case, with bounded CPU/time/disk and scoped license."""
    case=Path(case).resolve();solver=Path(solver).resolve()
    metadata=json.loads((case/'case.json').read_text())
    if not solver.is_file() or not solver.name.lower().startswith('ls-dyna_'):raise ValueError('Explicit LS-DYNA executable required')
    if type(timeout_seconds) not in (int,float) or not 0<timeout_seconds<=600:raise ValueError('Bounded solver timeout required')
    if type(memory_megawords) is not int or not 1<=memory_megawords<=100:raise ValueError('Bounded solver memory required')
    for name,key in (('patch.k','inputDeckSHA256'),('geometry.inc','geometryIncludeSHA256'),('reference.npz','referenceSHA256')):
        if _sha(case/name)!=metadata[key]:raise ValueError('Prepared solver input changed')
    log=case/'solver.log'
    if log.exists() or (case/'run.json').exists():raise ValueError('Solver case already used; prepare a fresh case')
    startup=subprocess.STARTUPINFO();startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW;startup.wShowWindow=subprocess.SW_HIDE
    command=[str(solver),'i=patch.k','ncpu=1',f'memory={memory_megawords}m']
    start=time.monotonic();reason=None
    with log.open('xb') as stream:
        process=subprocess.Popen(command,cwd=case,stdin=subprocess.DEVNULL,stdout=stream,stderr=subprocess.STDOUT,
            startupinfo=startup,creationflags=subprocess.CREATE_NEW_CONSOLE,
            env={**os.environ,'LSTC_LICENSE':'ANSYS','TEMP':str(case),'TMP':str(case)})
        try:
            with (case/'started.json').open('x') as state:
                json.dump(dict(pid=process.pid,command=command,case=str(case),startedEpoch=time.time(),
                    storedPidIsNotPermissionToAdoptOrKillAProcess=True),state,indent=2)
            while process.poll() is None:
                sizes=_artifact_sizes(case)
                if time.monotonic()-start>timeout_seconds:reason='wall-time budget exceeded'
                elif max(sizes,default=0)>MAX_OUTPUT_BYTES or sum(sizes)>2*MAX_OUTPUT_BYTES:reason='artifact byte budget exceeded'
                if reason:
                    _stop_owned(process);break
                time.sleep(.2)
            code=process.wait(timeout=10)
        finally:
            _stop_owned(process)
    text=log.read_text(errors='replace')
    normal='normaltermination' in ''.join(text.lower().split())
    result=dict(command=command,solverSHA256=_sha(solver),exitCode=code,seconds=time.monotonic()-start,
        budgetFailure=reason,normalTerminationObserved=normal,
        sourceUnchanged=_sha(metadata['sourceMesh'])==metadata['sourceSHA256'],
        solverRun=True,syntheticPatchPassed=False,engineeringFastenerAnalysisVerified=False)
    with (case/'run.json').open('x') as stream:json.dump(result,stream,indent=2)
    return result


def verify_input_deck(case):
    """Independent PyDYNA parsing of all prepared geometry and imposed DOFs."""
    case=Path(case).resolve();out=case/'pydyna-deck-readback.json'
    if out.exists():raise ValueError('Readback evidence already exists')
    meta=json.loads((case/'case.json').read_text());deck_path=case/'patch.k'
    for path,key in ((deck_path,'inputDeckSHA256'),(case/'geometry.inc','geometryIncludeSHA256'),(case/'reference.npz','referenceSHA256')):
        if _sha(path)!=meta[key]:raise ValueError('Prepared input binding changed')
    from ansys.dyna.core import Deck
    deck=Deck();deck.import_file(str(deck_path));deck=deck.expand(cwd=str(case),recurse=True,strict=True)
    nodes=list(deck.get_kwds_by_type('NODE'));solids=list(deck.get_kwds_by_full_type('ELEMENT','SOLID'))
    if len(nodes)!=1 or len(solids)!=1:raise ValueError('Unexpected parsed mesh-card inventory')
    n,e=nodes[0].nodes,solids[0].elements
    with np.load(case/'reference.npz',allow_pickle=False) as r:
        coordinate_error=float(abs(n[['x','y','z']].to_numpy(float)-r['nodes']).max())
        coordinate_roundoff=64*np.finfo(float).eps*max(1.,float(abs(r['nodes']).max()))
        if not np.array_equal(n['nid'].to_numpy(np.int64),r['node_ids']) or coordinate_error>coordinate_roundoff:
            raise ValueError('Parsed source node identity/geometry differs beyond arithmetic roundoff')
        if not np.array_equal(e['eid'].to_numpy(np.int64),r['element_ids']):raise ValueError('Parsed element IDs changed')
        expected=r['node_ids'][r['elements']]
        if not np.array_equal(e[[f'n{i}' for i in range(1,9)]].to_numpy(np.int64),expected):raise ValueError('Parsed H8 connectivity changed')
        boundary=r['boundary_rows'];target=r['target_displacements']
        prescribed={(int(r['node_ids'][row]),dof+1):float(target[row,dof]) for row in boundary for dof in range(3)}
        observed={}
        for motion in deck.get_kwds_by_full_type('BOUNDARY','PRESCRIBED_MOTION_NODE'):
            key=(motion.nid,motion.dof)
            if key in observed or motion.vad!=2 or motion.lcid!=1:raise ValueError('Unexpected imposed motion')
            observed[key]=motion.sf
        motion_roundoff=64*np.finfo(float).eps*max(max(map(abs,prescribed.values())),np.finfo(float).tiny)
        if observed.keys()!=prescribed.keys():raise ValueError('Parsed Dirichlet DOF inventory differs')
        motion_error=max(abs(observed[key]-value) for key,value in prescribed.items())
        if not np.isfinite(motion_error) or motion_error>motion_roundoff:
            raise ValueError('Parsed Dirichlet field differs beyond arithmetic roundoff')
        def history(kind):
            return [int(v) for card in deck.get_kwds_by_full_type('DATABASE',kind)
                    for v in [getattr(card,f'id{i}') for i in range(1,9)] if v is not None and v>0]
        if sorted(history('HISTORY_NODE'))!=sorted(map(int,r['node_ids'])):raise ValueError('Parsed nodal history coverage differs')
        if sorted(history('HISTORY_SOLID'))!=sorted(map(int,r['element_ids'][r['sampled_element_rows']])):
            raise ValueError('Parsed solid history coverage differs')
    if _sha(meta['sourceMesh'])!=meta['sourceSHA256']:raise ValueError('Readonly original source changed')
    original=read_keyword(meta['sourceMesh'])
    if not np.array_equal(e['pid'].to_numpy(np.int64),original.part_ids):raise ValueError('Parsed source part assignment changed')
    def single(kind,subkind):
        values=list(deck.get_kwds_by_full_type(kind,subkind))
        if len(values)!=1:raise ValueError('Unexpected physics card inventory: '+kind+'_'+subkind)
        return values[0]
    general=single('CONTROL','IMPLICIT_GENERAL');solution=single('CONTROL','IMPLICIT_SOLUTION')
    termination=single('CONTROL','TERMINATION');section=single('SECTION','SOLID')
    if general.imflag!=1 or general.dt0!=1 or general.igs!=2 or solution.nsolvr!=1 or termination.endtim!=1:
        raise ValueError('Parsed synthetic linear-static controls differ')
    if section.secid!=1 or section.elform!=2:raise ValueError('Parsed synthetic solid formulation differs')
    mats=list(deck.get_kwds_by_type('MAT'))
    if len(mats)!=1 or mats[0].mid!=1 or mats[0].e!=meta['young'] or mats[0].pr!=meta['poisson'] or mats[0].ro!=meta['density']:
        raise ValueError('Parsed synthetic material differs')
    part_ids=[]
    for card in deck.get_kwds_by_type('PART'):
        for _,part in card.parts.iterrows():
            if part['secid']!=1 or part['mid']!=1:raise ValueError('Parsed synthetic part assignment differs')
            part_ids.append(int(part['pid']))
    if sorted(part_ids)!=meta['originalPIDs']:raise ValueError('Parsed part inventory differs')
    curve=single('DEFINE','CURVE')
    if curve.lcid!=1 or not np.array_equal(curve.curves[['a1','o1']].to_numpy(float),[[0.,0.],[1.,1.]]):
        raise ValueError('Parsed synthetic ramp differs')
    report=dict(reader='ansys-dyna-core Deck',sourceSHA256=meta['sourceSHA256'],inputDeckSHA256=meta['inputDeckSHA256'],
        nodes=len(n),H8=len(e),prescribedDOFs=len(observed),allNodeAndElementIdentitiesPreserved=True,
        maximumCoordinateReadbackDifference=coordinate_error,coordinateArithmeticBound=coordinate_roundoff,
        maximumMotionReadbackDifference=motion_error,motionArithmeticBound=motion_roundoff,
        syntheticPhysicsInputParsed=True,
        fullMotionAndHistoryCoverageVerified=True,sourceUnchanged=True,inputParseVerified=True,
        r11SolverVerified=False,syntheticPatchPassed=False,engineeringFastenerAnalysisVerified=False)
    with out.open('x') as stream:json.dump(report,stream,indent=2)
    return report
