"""Finite demo bundle for the Node exporter, with separate bodies and source surfaces."""
import argparse
import json
from pathlib import Path
from .__main__ import demo_meshes
from .inp_writer import write_inp


def write_demo_bundle(directory, case='original'):
    directory = Path(directory).resolve()
    if not directory.is_dir() or any(directory.iterdir()):
        raise ValueError('Bridge requires an existing empty output directory')
    geometry = None
    if case == 'original':
        meshes = demo_meshes()
    elif case in ('femssc', 'femssc-left', 'plain', 'rounded', 'rounded-left'):
        from .profiled_parts import profiled_demo_meshes
        meshes, geometry = profiled_demo_meshes(threaded=case != 'plain', handedness='left' if case.endswith('-left') else 'right',
                                               profile_kind='rounded' if case.startswith('rounded') else 'femssc')
    else:
        raise ValueError('unsupported demo case')
    nodes, solids, parts = [], [], []
    noffset = eoffset = 0
    for pid, mesh in enumerate(meshes, 1):
        nodes.extend(mesh.nodes.tolist())
        for i, element in enumerate(mesh.elems, 1):
            solids.append(dict(id=eoffset + i, partId=pid,
                               nodes=[int(n) + noffset + 1 for n in element]))
        parts.append(dict(partId=pid, name=mesh.name, dimensions=mesh.dims,
            nodeRange=[noffset + 1, noffset + len(mesh.nodes)],
            elementRange=[eoffset + 1, eoffset + len(mesh.elems)],
            regionNames=mesh.region_names, regions=mesh.regions,
            abaqusSourceSurfaces={name: [[int(eid) + eoffset, face] for eid, face in faces]
                                  for name, faces in mesh.surfaces.items()}))
        noffset += len(mesh.nodes); eoffset += len(mesh.elems)
    write_inp(meshes, str(directory / 'model.inp'))
    data = dict(model=dict(nodes=nodes, solids=solids, beams=[]), parts=parts,
                sourceExecutableRequired=False, generator='authorized-recovered-python',
                geometry='original-built-in-M16-demo' if case == 'original' else ('rounded-research-profile-full-pair' if case.startswith('rounded') else 'femssc-profile-generic-full-pair'), guiPorted=False)
    if geometry is not None:
        (directory / 'geometry-sections.json').write_text(json.dumps(geometry, separators=(',', ':')), encoding='utf-8')
    (directory / 'bridge.json').write_text(json.dumps(data, separators=(',', ':')), encoding='utf-8')
    return data


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--case', choices=['original', 'femssc', 'femssc-left', 'plain', 'rounded', 'rounded-left'], default='original')
    args = parser.parse_args()
    result = write_demo_bundle(args.output, args.case)
    print(json.dumps(dict(nodes=len(result['model']['nodes']), solids=len(result['model']['solids']))))
