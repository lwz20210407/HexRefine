"""Independent PyDYNA read-back of a CAD-mapped mesh-only K bundle."""
import argparse
import json
from pathlib import Path
import numpy as np
from ansys.dyna.core import Deck
from .cad_mesh_pipeline import _sha
from .mesh_audit import audit_h8


def validate(directory):
    directory=Path(directory).resolve()
    source=json.loads((directory/'report.json').read_text())
    if _sha(directory/'model.k')!=source['kSHA256']:
        raise ValueError('K does not match its generation certificate')
    deck=Deck();deck.import_file(str(directory/'model.k'))
    nd=next(deck.get_kwds_by_type('NODE')).nodes
    ed=next(deck.get_kwds_by_full_type('ELEMENT','SOLID')).elements
    ids=nd['nid'].to_numpy(np.int64)
    if not np.array_equal(ids,np.arange(1,len(ids)+1)) or not np.all(ed['pid'].to_numpy()==1):
        raise ValueError('K IDs/PIDs changed')
    nodes=nd[['x','y','z']].to_numpy(float)
    elements=ed[[f'n{i}' for i in range(1,9)]].to_numpy(np.int64)-1
    actual,boundary=audit_h8(nodes,elements,source['boundaryEuler'])
    if actual['nodes']!=source['nodes'] or actual['elements']!=source['elements'] or abs(actual['volume']-source['volume'])/source['volume']>1e-10:
        raise ValueError('Independent K counts/volume audit disagrees with generated mesh')
    actual.update(kSHA256=source['kSHA256'],reader='ansys-dyna-core',matchedGenerationCertificate=True,
                  sourcePurpose=source.get('purpose','full-model-acceptance'),notFullModelAcceptance=source.get('notFullModelAcceptance',False))
    (directory/'independent-k-audit.json').write_text(json.dumps(actual,indent=2))
    return actual


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('directory',type=Path)
    print(json.dumps(validate(p.parse_args().directory),indent=2))
