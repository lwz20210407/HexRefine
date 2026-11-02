"""Independent K-node comparison for the unchanged fine ring of a graded core."""
import argparse
import json
from pathlib import Path
import numpy as np
from ansys.dyna.core import Deck
from .cad_mesh_pipeline import _sha


def _focused(directory,minimum_radius):
    directory=Path(directory)
    report=json.loads((directory/'report.json').read_text())
    if _sha(directory/'model.k')!=report['kSHA256']:
        raise ValueError('K hash differs from its generation certificate')
    deck=Deck();deck.import_file(str(directory/'model.k'))
    frame=next(deck.get_kwds_by_type('NODE')).nodes
    xyz=frame[['x','y','z']].to_numpy(float)
    focused=xyz[np.hypot(xyz[:,0],xyz[:,1])>=minimum_radius-1e-10].copy()
    angles=np.round(np.degrees(np.arctan2(focused[:,1],focused[:,0]))%360,8)%360
    radius=np.round(np.hypot(focused[:,0],focused[:,1]),8)
    return focused[np.lexsort((radius,angles,focused[:,2]))],report


def compare(original,graded):
    graded=Path(graded)
    report=json.loads((graded/'report.json').read_text())
    minimum=report['coreGrading']['transitionOuterRadius']
    old,old_report=_focused(original,minimum)
    new,new_report=_focused(graded,minimum)
    ca=json.loads((Path(original)/'cad-report.json').read_text())
    cb=json.loads((graded/'cad-report.json').read_text())
    if ca['stepSHA256']!=cb['stepSHA256']:
        raise ValueError('Different design CAD cannot be called preserved focus')
    if old.shape!=new.shape:
        raise ValueError(f'Fine-focus node count changed: {old.shape} -> {new.shape}')
    error=float(np.max(np.abs(old-new)))
    if error>1e-9:
        raise ValueError(f'Fine-focus geometry changed: {error}')
    result=dict(originalKSHA256=old_report['kSHA256'],gradedKSHA256=new_report['kSHA256'],
                stepSHA256=ca['stepSHA256'],matchedNodes=len(old),minimumRadius=minimum,
                maximumCoordinateDifference=error,unchangedFineFocus=True,
                originalElements=old_report['elements'],gradedElements=new_report['elements'],
                elementReductionFraction=1-new_report['elements']/old_report['elements'],
                scope='Unordered node geometry in fine outer ring and head; IDs are regenerated, not preserved')
    (graded/'fine-focus-comparison.json').write_text(json.dumps(result,indent=2))
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('original',type=Path);p.add_argument('graded',type=Path)
    args=p.parse_args();print(json.dumps(compare(args.original,args.graded),indent=2))
