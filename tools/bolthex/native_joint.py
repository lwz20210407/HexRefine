"""Bounded analytical H8 joint using repository templates, not BoltPro runtime.

Shared-node assembly is a bonded mesh. No independent CAD, contact/friction,
standard tolerance or count-transition certification is implied.
"""
import argparse,csv,json,math,subprocess,tempfile
from dataclasses import asdict,dataclass,field,fields
from pathlib import Path
import numpy as np
from .joint_seed_plan import JointAxialSpec,plan_joint_axial
from .axial_envelope import AxialEnvelope
from .mesh_core import Mesh3D,build_bolt_section,build_head_ring_section,build_ring_section,hexagon_R,thread_R
from .cad_mesh import _sweep,_join_exact
from .mesh_audit import audit_h8
from .inp_writer import write_inp


@dataclass(frozen=True)
class NativeJointSpec:
    axial:JointAxialSpec=field(default_factory=JointAxialSpec)
    diameter:float=16.
    across_flats:float=24.
    head_height:float=10.
    plate_x:float=40.
    plate_y:float=40.
    sector:int=4
    core_rings:int=2
    radial:int=3
    nut_radial:int=4
    plate_outer_radial:int=2
    head_layers:int=5
    taper_length:float|None=None
    handedness:str='right'
    connection_mode:str='shared'
    element_limit:int=200000

    @classmethod
    def parse(cls,data):
        if not isinstance(data,dict) or set(data)-{f.name for f in fields(cls)}:raise ValueError('Unknown native joint parameters')
        data=dict(data)
        if 'axial' in data:
            if not isinstance(data['axial'],dict) or set(data['axial'])-{f.name for f in fields(JointAxialSpec)}:raise ValueError('Unknown axial parameters')
            data['axial']=JointAxialSpec(**data['axial'])
        return cls(**data)


def _annulus(sector,radial,inner_ref,outer_ref):
    return build_ring_section(sector,radial,inner_ref,outer_ref)


def _merge_boundaries(parts,boundaries):
    nodes=[];cells=[];pids=[];registry={};shared=0
    for pid,(part,boundary) in enumerate(zip(parts,boundaries),1):
        skin=set(map(int,np.unique(boundary)));mapping=[]
        for index,point in enumerate(part.nodes):
            key=tuple(np.round(point,10)) if index in skin else None
            existing=registry.get(key) if key is not None else None
            if existing is None:
                existing=len(nodes);nodes.append(point)
                if key is not None:registry[key]=existing
            else:
                if np.max(abs(nodes[existing]-point))>1e-9:raise ValueError('Canonical interface coordinates disagree')
                shared+=1
            mapping.append(existing)
        cells.extend(np.asarray(mapping)[part.elems]);pids.extend([pid]*len(part.elems))
    return np.asarray(nodes),np.asarray(cells,dtype=np.int64),np.asarray(pids,dtype=np.int32),shared


def _separate_parts(parts):
    offset=0;nodes=[];cells=[];pids=[]
    for pid,part in enumerate(parts,1):
        nodes.append(part.nodes);cells.append(part.elems+offset)
        pids.extend([pid]*len(part.elems));offset+=len(part.nodes)
    return np.concatenate(nodes),np.concatenate(cells),np.asarray(pids,dtype=np.int32),0


def _node_ownership(cells,pids,names):
    inventories=[np.unique(cells[pids==pid]) for pid in range(1,len(names)+1)]
    pairs=[]
    for i,a in enumerate(inventories):
        for j in range(i+1,len(inventories)):
            common=np.intersect1d(a,inventories[j],assume_unique=True)
            if len(common):pairs.append(dict(parts=[names[i],names[j]],nodes=len(common)))
    return dict(componentNodeSetsDisjoint=not pairs,sharedNodePairs=pairs)


def _readback_part_blocks(path,parts):
    import meshio
    blocks={};name=None;lines=[]
    for line in path.read_text().splitlines():
        tokens=next(csv.reader([line])) if line.strip().upper().startswith('*PART,') else []
        if tokens:
            if name is not None:raise ValueError('Nested INP part')
            attrs=dict(t.strip().split('=',1) for t in tokens[1:])
            name=attrs['NAME'];lines=[]
        elif line.strip().upper()=='*END PART':
            if name is None or name in blocks:raise ValueError('Invalid/duplicate INP part')
            blocks[name]='\n'.join(lines)+'\n';name=None
        elif name is not None:lines.append(line)
    if name is not None or set(blocks)!={p.name for p in parts}:raise ValueError('INP part inventory changed')
    checks=[]
    with tempfile.TemporaryDirectory(prefix='part-readback-',dir=path.parent) as directory:
        for part in parts:
            source=Path(directory)/(part.name+'.inp');source.write_text(blocks[part.name])
            read=meshio.read(source,file_format='abaqus')
            error=float(np.max(abs(read.points-part.nodes)))
            if not np.array_equal(read.get_cells_type('hexahedron'),part.elems) or error>1e-10:raise ValueError('Part-scoped INP readback differs')
            checks.append(dict(name=part.name,nodes=len(read.points),elements=len(part.elems),coordinateError=error))
    return checks


def build_native_joint(spec=NativeJointSpec()):
    if not isinstance(spec,NativeJointSpec):raise ValueError('Expected NativeJointSpec')
    plan=plan_joint_axial(spec.axial)
    for name in ('diameter','across_flats','head_height','plate_x','plate_y'):
        value=getattr(spec,name)
        if type(value) not in (int,float) or not math.isfinite(value) or value<=0:raise ValueError(f'{name} must be finite and positive')
    for name,lo,hi in [('sector',4,32),('core_rings',1,16),('radial',1,16),('nut_radial',1,16),
                       ('plate_outer_radial',1,32),('head_layers',1,64),('element_limit',1,1000000)]:
        value=getattr(spec,name)
        if type(value) is not int or not lo<=value<=hi:raise ValueError(f'Invalid {name}')
    if spec.sector%4:raise ValueError('sector must be divisible by four to retain exact rectangle corners')
    if spec.handedness not in ('right','left'):raise ValueError('Unknown thread handedness')
    if spec.connection_mode not in ('shared','separate'):raise ValueError('Unknown joint connection mode')
    n=6*spec.sector;r=spec.diameter/2;p=spec.axial.pitch
    if spec.across_flats<=spec.diameter:raise ValueError('Head/nut flats must exceed shaft diameter')
    if r-.541266*p<=.6*r:raise ValueError('Thread root intersects the fixed core support')
    def hex_radius(theta,z):return hexagon_R(theta,spec.across_flats)
    def rectangle(theta,z):
        a=math.radians(theta);c,s=abs(math.cos(a)),abs(math.sin(a))
        return min(spec.plate_x/(2*c) if c>1e-12 else float('inf'),spec.plate_y/(2*s) if s>1e-12 else float('inf'))
    if spec.axial.plate_count and any(rectangle(i*360/n,0)<=hex_radius(i*360/n,0)+1e-8 for i in range(n)):
        raise ValueError('Rectangle does not cover the nut/head footprint')
    b=spec.axial.thread_length;m=spec.axial.nut_height;l=spec.axial.shank_length
    taper=p if spec.taper_length is None else spec.taper_length
    if type(taper) not in (int,float) or not math.isfinite(taper) or not 0<taper<b:
        raise ValueError('Physical taper length must be positive and shorter than thread length')
    envelope=AxialEnvelope(((0.,1.),(b-taper,1.),(b,0.)))
    def radius(theta,z):
        if z>=b:return r
        sign=1 if spec.handedness=='right' else -1
        target=thread_R(z,sign*theta,p,r,r-.541266*p)
        return r+envelope.value(float(z))*(target-r)
    q=3*spec.sector**2+n*(spec.core_rings+spec.radial)
    count=q*(plan['counts']['thread']+plan['counts']['shank']+spec.head_layers)
    count+=n*spec.nut_radial*(spec.head_layers+plan['counts']['nut'])
    count+=spec.axial.plate_count*n*(spec.nut_radial+spec.plate_outer_radial)*plan['counts']['plate']
    if count>spec.element_limit:raise ValueError(f'Native joint requires {count} H8, exceeding element budget')
    head_z=np.linspace(b+l,b+l+spec.head_height,spec.head_layers+1)
    body_z=np.concatenate((np.linspace(0,b,plan['counts']['thread']+1),
                           np.linspace(b,b+l,plan['counts']['shank']+1)[1:],head_z[1:]))
    body=_sweep(build_bolt_section(spec.sector,spec.core_rings,spec.radial,2*r,2*r,True),body_z,radius,name='BOLT_CORE')
    head_section=build_head_ring_section(spec.sector,spec.nut_radial,r,spec.across_flats)
    head_section.beta=[1-a for a in head_section.alpha]
    head=_sweep(head_section,head_z,hex_radius,lambda t,z:r,'HEAD_RING')
    bolt=_join_exact(body,head,'BOLT')
    ring=_annulus(spec.sector,spec.nut_radial,r,spec.across_flats/2)
    nut=_sweep(ring,np.linspace(b-m,b,plan['counts']['nut']+1),hex_radius,radius,'NUT')
    parts=[bolt]
    for index,(lo,hi) in enumerate(plan['intervals']['plates'],1):
        zs=np.linspace(lo,hi,plan['counts']['plate']+1)
        inner=_sweep(ring,zs,hex_radius,lambda t,z:r,'PLATE_INNER')
        outer_section=_annulus(spec.sector,spec.plate_outer_radial,spec.across_flats/2,min(spec.plate_x,spec.plate_y)/2)
        outer=_sweep(outer_section,zs,rectangle,hex_radius,'PLATE_OUTER')
        parts.append(_join_exact(inner,outer,f'PLATE_{index}'))
    parts.append(nut);boundaries=[];part_reports=[]
    for part in parts:
        part.regions=[part.name]*len(part.elems);part.region_names=[part.name]
        quality,boundary=audit_h8(part.nodes,part.elems,2 if part.name=='BOLT' else 0)
        boundaries.append(boundary);part_reports.append(dict(name=part.name,**quality))
    nodes,cells,pids,shared=(_merge_boundaries(parts,boundaries) if spec.connection_mode=='shared' else _separate_parts(parts))
    expected_euler=2 if spec.connection_mode=='shared' else sum(p['boundaryEuler'] for p in part_reports)
    quality,boundary=audit_h8(nodes,cells,expected_euler)
    ownership=_node_ownership(cells,pids,[part.name for part in parts])
    if spec.connection_mode=='separate' and (shared or not ownership['componentNodeSetsDisjoint']):
        raise ValueError('Separate components unexpectedly share node IDs')
    if len(cells)!=count:raise ValueError('Native joint allocation count mismatch')
    relative=abs(sum(row['volume'] for row in part_reports)-quality['volume'])/quality['volume']
    if relative>1e-10:raise ValueError('Assembly changed summed component volume')
    report=dict(schemaVersion=1,kernel='repository-six-sector-analytical-joint',parameters=asdict(spec),plan=plan,
                quality=quality,parts=part_reports,sharedNodes=shared,estimatedElements=count,
                relativeAssemblyVolumeError=relative,physicalEnvelope=envelope.knots,
                geometryReference='analytical-thread-field',independentCadVerified=False,solverVerified=False,
                connectionMode=spec.connection_mode,nodeOwnership=ownership,
                connection='shared-nodes-bonded' if spec.connection_mode=='shared' else 'separate-nodes-no-coupling',externalApplicationRequired=False,
                limitations=['Bounded axis-aligned hex bolt/open hex nut/rectangle stack only',
                             'Not independent CAD or standards/tolerance certification',
                             'No friction/contact/preload model or count-transition templates'])
    return dict(nodes=nodes,elements=cells,partIds=pids,parts=parts,report=report)


def generate(spec,output,node):
    output=Path(output).resolve();node=Path(node).resolve()
    if output.exists() or not output.parent.is_dir() or not node.is_file():raise ValueError('Require new output directory and explicit Node executable')
    result=build_native_joint(spec);report=result['report']
    model=dict(nodes=result['nodes'].tolist(),solids=[dict(id=i+1,partId=int(pid),nodes=(cell+1).tolist())
               for i,(cell,pid) in enumerate(zip(result['elements'],result['partIds']))],beams=[])
    project=Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix='native-joint-',dir=output.parent) as temporary:
        stage=Path(temporary)/'result';stage.mkdir()
        (stage/'mesh.json').write_text(json.dumps(model,separators=(',',':')))
        done=subprocess.run([str(node),str(project/'scripts/export-native-joint.mjs'),str(stage)],cwd=project,
                             capture_output=True,text=True,check=True,timeout=120)
        report['kReadback']=json.loads(done.stdout)
        merged=Mesh3D('JOINT');merged.nodes=result['nodes'];merged.elems=result['elements']
        names=[part.name for part in result['parts']]
        merged.region_names=names;merged.regions=[names[int(pid)-1] for pid in result['partIds']]
        write_inp([merged],str(stage/'merged.inp'),with_material=False,coordinate_precision=12)
        write_inp(result['parts'],str(stage/'parts.inp'),with_material=False,coordinate_precision=12)
        with (stage/'parts.inp').open('a') as stream:
            stream.write('** Separate instances do not share nodes; no contact is defined.\n*ASSEMBLY, NAME=JOINT\n')
            for part in result['parts']:
                stream.write(f'*INSTANCE, NAME={part.name}_I, PART={part.name}\n*END INSTANCE\n')
            stream.write('*END ASSEMBLY\n')
        import meshio
        read=meshio.read(stage/'merged.inp',file_format='abaqus')
        error=float(np.max(abs(read.points-result['nodes'])))
        if not np.array_equal(read.get_cells_type('hexahedron'),result['elements']) or error>1e-10:raise ValueError('Merged INP readback differs')
        for pid,name in enumerate(names,1):
            actual=read.cell_sets.get('E_'+name)
            if actual is None or len(actual)!=1 or not np.array_equal(actual[0],np.flatnonzero(result['partIds']==pid)):
                raise ValueError('Merged INP element set changed')
        report['inpReadbackCoordinateError']=error
        report['partsInpReadback']=_readback_part_blocks(stage/'parts.inp',result['parts'])
        report['inpSemantics']=dict(merged=('shared-node' if spec.connection_mode=='shared' else 'disjoint-node')+' single part with component ELSETs',
                                    parts='separate Part/Instance records; no inter-part coupling defined')
        from .cad_mesh_pipeline import _sha
        report['inpSHA256']={name:_sha(stage/name) for name in ('merged.inp','parts.inp')}
        (stage/'report.json').write_text(json.dumps(report,indent=2))
        (stage/'mesh.json').unlink();stage.rename(output)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('request',type=Path)
    parser.add_argument('output',type=Path);parser.add_argument('--node',type=Path,required=True)
    args=parser.parse_args()
    if args.request.stat().st_size>65536:parser.error('Native joint request exceeds 64 KiB')
    request=json.loads(args.request.read_text())
    if not isinstance(request,dict) or set(request)!={'schemaVersion','parameters'} or type(request['schemaVersion']) is not int or request['schemaVersion']!=1:
        parser.error('Require a version-1 native joint request')
    print(json.dumps(generate(NativeJointSpec.parse(request['parameters']),args.output,args.node),indent=2))
