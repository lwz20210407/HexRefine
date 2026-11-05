"""Bounded independent PyDYNA readback of a binary-bridge mesh-only K.

This certifies file transfer/mesh quality, not CAD, material or solver behavior.
It does not relax the Node parser's separate 200k readback budget.
"""
import argparse,json,math
from pathlib import Path
from tools.hypermesh_geometry_probe import sha


def validate(directory):
    directory=Path(directory).resolve();manifest=directory/'mesh-binary.json'
    paths=[directory/name for name in ('mesh-binary.json','nodes.f64','elements.i32','model.k')]
    if any(not p.is_file() or p.is_symlink() for p in paths):raise ValueError('Missing or linked readback input')
    if manifest.stat().st_size>65536 or paths[-1].stat().st_size>67108864:raise ValueError('Readback input exceeds budget')
    spec=json.loads(manifest.read_text())
    n,e=spec.get('nodes'),spec.get('elements');volume=spec.get('expectedVolume');euler=spec.get('expectedEuler',2)
    if (spec.get('schemaVersion')!=1 or type(n) is not int or not 8<=n<=3200000
            or type(e) is not int or not 1<=e<=400000 or type(euler) is not int or not -100<=euler<=100
            or type(volume) not in (int,float) or not math.isfinite(volume) or volume<=0):
        raise ValueError('Invalid independent K readback manifest')
    if paths[1].stat().st_size!=n*24 or paths[2].stat().st_size!=e*32:raise ValueError('Readback binary length mismatch')
    hashes={p.name:sha(p) for p in paths}
    with paths[-1].open(encoding='ascii') as stream:cards=[line.strip().upper() for line in stream if line.lstrip().startswith('*')]
    if cards!=['*KEYWORD','*NODE','*ELEMENT_SOLID','*END']:raise ValueError('Independent readback requires the native mesh-only subset')
    import numpy as np
    from ansys.dyna.core import Deck
    from .mesh_audit import audit_h8
    expected_nodes=np.fromfile(paths[1],dtype='<f8').reshape(n,3)
    expected_cells=np.fromfile(paths[2],dtype='<i4').reshape(e,8)
    deck=Deck();deck.import_file(str(paths[-1]))
    nd=next(deck.get_kwds_by_type('NODE')).nodes;ed=next(deck.get_kwds_by_full_type('ELEMENT','SOLID')).elements
    if len(nd)!=n or len(ed)!=e or not np.array_equal(nd['nid'].to_numpy(),np.arange(1,n+1)) or not np.array_equal(ed['eid'].to_numpy(),np.arange(1,e+1)):
        raise ValueError('Independent K count or dense IDs differ')
    if set(ed['pid'])!={1}:raise ValueError('Independent K part IDs differ')
    nodes=nd[['x','y','z']].to_numpy(float);cells=ed[[f'n{i}' for i in range(1,9)]].to_numpy(np.int64)-1
    loss=float(np.max(abs(nodes-expected_nodes)))
    if not np.isfinite(nodes).all() or not math.isfinite(loss) or loss>1e-10 or not np.array_equal(cells,expected_cells):
        raise ValueError('Independent K coordinates or connectivity differ')
    quality,_=audit_h8(nodes,cells,euler)
    relative=abs(quality['volume']-volume)/volume
    if relative>1e-10:raise ValueError('Independent K volume differs')
    if any(sha(p)!=hashes[p.name] for p in paths):raise ValueError('Readback inputs changed during validation')
    return dict(reader='ansys-dyna-core',kSHA256=hashes['model.k'],nodes=n,elements=e,
                maximumCoordinateDifference=loss,relativeVolumeDifference=relative,quality=quality,
                exactConnectivity=True,partIds=[1],independentCadVerified=False,solverVerified=False)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('directory',type=Path)
    args=parser.parse_args();result=validate(args.directory)
    target=args.directory/'independent-k-audit.json'
    with target.open('x',encoding='utf8') as stream:json.dump(result,stream,indent=2)
    print(json.dumps(result))
