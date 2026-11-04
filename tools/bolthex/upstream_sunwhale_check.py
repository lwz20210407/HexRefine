"""Opt-in local upstream oracle. Original programs are never vendored.

Requires an external checkout at the documented pin and Python with lib2to3
(3.11/3.12). Private reference CMFs/logs go only to the explicit new output.
"""
import argparse,ast,contextlib,hashlib,json,math,os
from pathlib import Path
import subprocess
import numpy as np
from .helical_band import HelicalBandSpec,generate_band,volume_plan
from .mesh_audit import audit_h8

PIN='582da3d8c9ec5ddc7e7d14aa2e32493b7a768a8c'
FILES=('thread.py','thread_external.py','thread_internal.py','thread_external_GJB3.1.py',
       'thread_internal_GJB3.1.py','thread_external_GJB3.1_boundary_layer.py','thread_internal_GJB3.1_boundary_layer.py')


def prepare(source,name,overrides,repair):
    from lib2to3.refactor import RefactoringTool
    converted=str(RefactoringTool(['lib2to3.fixes.fix_print']).refactor_string(source+'\n',name))
    tree=ast.parse(converted);body=[];last_close=None
    for node in tree.body:
        if isinstance(node,(ast.Import,ast.ImportFrom)):
            modules=([v.name for v in node.names] if isinstance(node,ast.Import) else [node.module or ''])
            if any(m.startswith(('matplotlib','mpl_toolkits')) for m in modules):continue
        if isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name):
            key=node.targets[0].id
            if key in overrides:node.value=ast.Constant(overrides[key])
            if key=='node_list':
                capture="__spec_inputs__={key:globals()[key] for key in ('d','P','rho','n','m','segment','boundary_layer','H1P','theta1','r_in_list','z_list') if key in globals()}"
                body.append(ast.parse(capture).body[0])
        body.append(node)
        if isinstance(node,ast.Expr) and isinstance(node.value,ast.Call):
            fn=node.value.func
            if isinstance(fn,ast.Attribute) and isinstance(fn.value,ast.Name) and fn.value.id=='outfile' and fn.attr=='close':
                last_close=len(body)
    if last_close is None:raise ValueError('Upstream writer boundary not found; refuse to run arbitrary tail')
    tree.body=body[:last_close]
    if repair:
        class CyclicLabels(ast.NodeTransformer):
            def visit_Assign(self,node):
                if len(node.targets)==1 and isinstance(node.targets[0],ast.Name):
                    key=node.targets[0].id
                    if key=='theta' and isinstance(node.value,ast.BinOp) and isinstance(node.value.op,ast.Add):
                        node.value=ast.BinOp(left=node.value,op=ast.Mod(),right=ast.parse('2*np.pi',mode='eval').body)
                    if key=='number_in_layer' and isinstance(node.value,ast.Call):
                        node.value=ast.parse('seg*(4*m)+((i+k*((4*m)//n))%(4*m))+1',mode='eval').body
                return self.generic_visit(node)
        tree=CyclicLabels().visit(tree)
    return compile(ast.fix_missing_locations(tree),name,'exec')


def run_reference(source,name,directory,overrides,repair):
    directory.mkdir();namespace={'__name__':'_private_reference_oracle_'}
    previous=Path.cwd()
    try:
        os.chdir(directory)
        with (directory/'stdout.log').open('w') as log,contextlib.redirect_stdout(log):
            exec(prepare(source,name,overrides,repair),namespace)
    finally:os.chdir(previous)
    rows=namespace['node_list_sort']
    nodes=np.array([[r['x'],r['y'],r['z']] for r in rows])
    elements=np.array([r['element_node_order'] for r in namespace['element_list']],dtype=np.int64)-1
    labels=np.array([r['node_number'] for r in rows])
    diagnostics=dict(nodes=len(nodes),elements=len(elements),duplicateDeclaredNodeIds=len(labels)-len(np.unique(labels)),
                     repeatedElementNodes=int(np.sum(np.any(np.diff(np.sort(elements,axis=1),axis=1)==0,axis=1))),
                     invalidNodeReferences=int(np.sum((elements<0)|(elements>=len(nodes)))))
    try:diagnostics['rawH8Quality']=audit_h8(nodes,elements,0)[0]
    except ValueError as exc:diagnostics['rawH8Rejection']=str(exc)
    return namespace,nodes,elements,diagnostics


def spec_from(namespace,name):
    namespace=namespace['__spec_inputs__']
    family='internal' if 'internal' in name else 'external'
    offset=name=='thread_internal_GJB3.1.py'
    counted='boundary_layer.py' in name
    parameters=dict(diameter=float(namespace['d']),pitch=float(namespace['P']),
                    cycles=(len(namespace['z_list'])-1)/namespace['n'],family=family,
                    quadrant_segments=int(namespace['m']),axial_per_pitch=int(namespace['n']),
                    radial_segments=int(namespace['segment']),
                    rim_offset_pitches=abs(namespace['r_in_list'][0]-namespace['d']/2)/namespace['P'],
                    radial_scheme='thread_offset' if offset else 'boundary_count' if counted else 'uniform',
                    crest_height_fraction=float(namespace.get('H1P',.125)))
    parameters['internal_rounding_ratio' if family=='internal' else 'external_rounding_ratio']=float(namespace['rho']/namespace['P'])
    if family=='internal':parameters['female_flat_fraction']=float(namespace['theta1']/np.pi)
    if offset:parameters['thread_offset_fraction']=.1
    if counted:parameters['boundary_layers']=int(namespace['boundary_layer'])
    return HelicalBandSpec(**parameters)


def check(checkout,output,start_case=0):
    checkout,output=map(lambda p:Path(p).resolve(),(checkout,output))
    if output.exists() or not output.parent.is_dir():raise ValueError('Require new output directory')
    actual=subprocess.check_output(['git','-C',str(checkout),'rev-parse','HEAD'],text=True).strip()
    dirty=subprocess.check_output(['git','-C',str(checkout),'status','--porcelain','--',*FILES],text=True)
    if actual!=PIN or dirty:raise ValueError('Require unmodified pinned upstream scripts')
    output.mkdir();records=[]
    cases=[(name,{},name.replace('.py','')) for name in FILES]
    cases.extend([('thread_external_GJB3.1_boundary_layer.py',dict(cycle=3),'external-three-turns'),
                  ('thread_internal_GJB3.1_boundary_layer.py',dict(cycle=3,boundary_layer=3),'internal-three-turns-three-layers'),
                  ('thread_external_GJB3.1_boundary_layer.py',dict(cycle=8),'external-eight-turns')])
    if type(start_case) is not int or not 0<=start_case<len(cases):raise ValueError('Invalid oracle starting case')
    for name,overrides,label in cases[start_case:]:
        root=output/label;root.mkdir();source=(checkout/name).read_text(encoding='utf-8-sig')
        _,_,_,original=run_reference(source,name,root/'raw',overrides,False)
        namespace,nodes,elements,corrected=run_reference(source,name,root/'cyclic-label-repair',overrides,True)
        spec=spec_from(namespace,name);mesh=generate_band(spec)
        if mesh.nodes.shape!=nodes.shape or mesh.elems.shape!=elements.shape:raise ValueError('Source count mismatch: '+name)
        normalization='identity'
        if not np.array_equal(elements,mesh.elems) and np.array_equal(elements[:,[0,3,2,1,4,7,6,5]],mesh.elems):
            elements=elements[:,[0,3,2,1,4,7,6,5]];normalization='base/top direction reversed to canonical positive H8'
        error=float(np.max(abs(nodes-mesh.nodes)))
        connection=bool(np.array_equal(elements,mesh.elems))
        if error>1e-10 or not connection:raise ValueError(f'Full source replay mismatch: {label}, coordinateError={error}, connectivity={connection}')
        quality,_=audit_h8(mesh.nodes,mesh.elems,0)
        plan=volume_plan(spec)
        if abs(plan['estimatedDiscreteVolume']-quality['volume'])/quality['volume']>1e-10:raise ValueError('Independent swept volume mismatch')
        record=dict(case=label,file=name,sourceSHA256=hashlib.sha256((checkout/name).read_bytes()).hexdigest(),upstreamCommit=PIN,
                    parameters=spec.__dict__,parameterOverrides=overrides,raw=original,cyclicLabelRepair=corrected,
                    coordinateMaximumError=error,normalizedConnectivityEqual=connection,quality=quality,fieldVolume=plan,
                    normalization=normalization,
                    scope='Whole upstream thread band; not complete fastener, independent CAD or production CAD acceptance')
        if name=='thread_internal_GJB3.1.py':record['upstreamUnusedBoundaryLayerParameter']=namespace['__spec_inputs__'].get('boundary_layer')
        records.append(record)
        (root/'comparison.json').write_text(json.dumps(record,indent=2))
        (output/'comparison.json').write_text(json.dumps(dict(upstreamCommit=PIN,startCase=start_case,cases=records),indent=2))
        print(json.dumps(dict(case=label,coordinateMaximumError=error,connectivity=connection,raw=original,quality=quality)),flush=True)
    return records


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('checkout',type=Path);p.add_argument('output',type=Path)
    p.add_argument('--start-case',type=int,default=0)
    a=p.parse_args();check(a.checkout,a.output,a.start_case)
