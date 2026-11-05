"""Bounded one-solid design STEP export through a detached geometry deep copy.

This is an exchange check, not mesh, solver or all-CAD acceptance. Nonidentity
assembly ancestors are rejected: their world transforms are never guessed.
"""
import copy
import hashlib
import io
import math
import os
from pathlib import Path
import stat
import tempfile

MAX_STEP_BYTES=16*1024*1024
BOUNDS_LIMIT_MM=1e-7


def _sha(path):
    result=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1048576),b''):result.update(block)
    return result.hexdigest()


def _brep_sha(shape):
    from OCP.BRepTools import BRepTools
    stream=io.BytesIO();BRepTools.Write_s(shape.wrapped,stream)
    return hashlib.sha256(stream.getvalue()).hexdigest()


def _location(shape):
    transform=shape.location.wrapped.Transformation()
    return tuple(transform.Value(i,j) for i in range(1,4) for j in range(1,5))


def _tree_state(shape):
    ancestors=[];root=shape
    while root.parent is not None:
        root=root.parent;ancestors.append(root)
        if len(ancestors)>16:raise ValueError('STEP assembly ancestor budget exceeded')
    identity=(1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.,0.)
    if any(_location(parent)!=identity for parent in ancestors):
        raise ValueError('Nonidentity assembly ancestor transform is unsupported; world placement is not guessed')
    stack=[root];records=[]
    while stack:
        node=stack.pop();children=tuple(node.children)
        records.append((id(node),id(node.parent),tuple(map(id,children)),node.label,
                        repr(node.color),_location(node)))
        if len(records)>64:raise ValueError('STEP assembly metadata budget exceeded')
        stack.extend(reversed(children))
    return tuple(records)


def _topology(shape):
    return {name:len(getattr(shape,name)()) for name in
            ('solids','shells','faces','wires','edges','vertices')}


def _geometry(shape):
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib
    from .standard_cad import _mass
    topology=_topology(shape)
    if topology['solids']!=1 or not shape.is_valid:
        raise ValueError('Design STEP export requires one valid solid')
    if topology['faces']>1024 or topology['edges']>8192 or topology['vertices']>8192:
        raise ValueError('Design STEP topology budget exceeded')
    if topology!=_topology(shape.solids()[0]):
        raise ValueError('Selected shape contains geometry outside its one solid')
    volume=_mass(shape)
    box=Bnd_Box();BRepBndLib.AddOptimal_s(shape.wrapped,box,False,False)
    bounds=list(box.Get())
    if (not math.isfinite(volume) or volume<=0 or not all(math.isfinite(v) for v in bounds)
            or any(bounds[i]>=bounds[i+3] for i in range(3))):
        raise ValueError('Invalid design STEP volume or bounds')
    return dict(topology=topology,volume=volume,bounds=bounds)


def export_step_detached(shape,output,*,source_step=None,write_pcurves=True):
    """Export selected geometry only, then independently reimport before publication.

    Caller geometry, labels, locations and assembly membership are checked for
    preservation on success and failure. No parent/root or sibling is exported.
    Requires same-directory hard links for exclusive, non-overwriting publication.
    """
    if type(write_pcurves) is not bool:raise ValueError('write_pcurves must be boolean')
    output=Path(output).absolute();output=output.parent.resolve()/output.name
    if output.suffix.lower() not in ('.step','.stp') or not output.parent.is_dir() or os.path.lexists(output):
        raise ValueError('Require a new STEP path in an existing directory')
    source_step=None if source_step is None else Path(source_step).resolve()
    if source_step is not None and (not source_step.is_file() or not 0<source_step.stat().st_size<=MAX_STEP_BYTES):
        raise ValueError('Source STEP must be an existing file within 16 MiB')
    source_hash=None if source_step is None else _sha(source_step)
    original_brep=_brep_sha(shape);original_tree=_tree_state(shape)

    def unchanged():
        if _brep_sha(shape)!=original_brep or _tree_state(shape)!=original_tree:
            raise ValueError('Design STEP export changed caller geometry or assembly metadata')
        if source_step is not None and _sha(source_step)!=source_hash:
            raise ValueError('Source STEP changed during detached export')

    from build123d import export_step,import_step
    from .standard_cad import CAD_ROUNDTRIP_VOLUME_LIMIT
    publication=None;completed=False
    try:
        # Exclude the external ancestor graph from deepcopy as well as export;
        # otherwise copying a selected child can recursively copy its siblings.
        memo={} if shape.parent is None else {id(shape.parent):None}
        clone=copy.deepcopy(shape,memo);clone.parent=None
        if clone is shape or clone.wrapped.IsPartner(shape.wrapped):
            raise ValueError('Detached STEP clone still shares caller topology')
        before=_geometry(clone)
        if _location(clone)!=_location(shape):raise ValueError('Deep clone changed selected placement')
        unchanged()
        with tempfile.TemporaryDirectory(prefix='cad-step-',dir=output.parent) as folder:
            staged=Path(folder)/'design.step'
            export_step(clone,staged,write_pcurves=write_pcurves)
            if not staged.is_file() or not 0<staged.stat().st_size<=MAX_STEP_BYTES:
                raise ValueError('Regenerated STEP is missing or exceeds 16 MiB')
            after=_geometry(import_step(staged))
            if after['topology']!=before['topology']:
                raise ValueError('Design STEP roundtrip topology differs')
            volume_error=abs(after['volume']-before['volume'])/before['volume']
            bounds_error=max(abs(a-b) for a,b in zip(before['bounds'],after['bounds']))
            if not math.isfinite(volume_error) or volume_error>CAD_ROUNDTRIP_VOLUME_LIMIT:
                raise ValueError('Design STEP roundtrip volume exceeds 1e-7')
            if not math.isfinite(bounds_error) or bounds_error>BOUNDS_LIMIT_MM:
                raise ValueError('Design STEP roundtrip bounds differ beyond 1e-7 mm')
            unchanged()
            report=dict(schemaVersion=1,method='detached-deep-clone-BRep-STEP-export-and-reimport',
                outputStep=str(output),stepSHA256=_sha(staged),writePcurves=write_pcurves,
                topology=after['topology'],sourceVolume=before['volume'],roundtripVolume=after['volume'],
                relativeVolumeError=volume_error,sourceBounds=before['bounds'],roundtripBounds=after['bounds'],
                maximumBoundsDifferenceMm=bounds_error,sourceBrepSHA256=original_brep,
                sourceShapeUnmodified=True,sourceAssemblyUnmodified=True,selectedPlacementUnmodified=True,
                sourceStepSHA256=source_hash,sourceFileUnmodified=True if source_step is not None else None,
                cadExchangeVerified=True,fullModelAcceptance=False,
                limitations=['One selected solid only; nonidentity ancestor transforms are rejected',
                             'Topology counts/bounds/volume are bounded exchange checks, not global BRep identity',
                             'No FE mesh, standards, native-HM or solver acceptance'])
            identity=staged.stat()
            os.link(staged,output)
            publication=(identity.st_dev,identity.st_ino,report['stepSHA256'])
        unchanged()
        completed=True
        return report
    finally:
        try:
            unchanged()
        except BaseException:
            completed=False
            raise
        finally:
            if not completed and publication is not None:
                # A late guard failure may roll back only our unchanged link,
                # never a replacement or content edited by another writer.
                try:
                    current=output.lstat()
                    if (stat.S_ISREG(current.st_mode)
                            and (current.st_dev,current.st_ino)==publication[:2]
                            and _sha(output)==publication[2]):
                        output.unlink()
                except FileNotFoundError:
                    pass
