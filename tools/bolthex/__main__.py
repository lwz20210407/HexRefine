"""Reproduce the original built-in demo without the packaged executable."""
import argparse
from pathlib import Path
from .parts import build_bolt, build_nut, build_plate
from .inp_writer import write_inp
from .mesh_core import min_scaled_volume


def demo_meshes():
    return [build_bolt(d=16, P=2, L=50, b=18, k=10, s=24),
            build_nut(d=16, P=2, s=24, m=14.8, offset=(45, 0, 0)),
            build_plate(60, 60, 10, 17, threaded=True, d_thread=16, P=2,
                        offset=(105, -30, 0))]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--demo', type=Path, required=True, metavar='OUTPUT.inp')
    args = parser.parse_args()
    output = args.demo.resolve()
    if output.exists():
        parser.error('Refusing to overwrite an existing output')
    if not output.parent.is_dir() or output.suffix.lower() != '.inp':
        parser.error('An existing parent directory and .inp output are required')
    meshes = demo_meshes()
    for mesh in meshes:
        minimum, _, _ = min_scaled_volume(mesh)
        if not minimum > 0:
            raise ValueError('Original centre-volume check failed: ' + mesh.name)
        print(f'{mesh.name}: nodes={len(mesh.nodes)} H8={len(mesh.elems)}')
    write_inp(meshes, str(output))
    print(str(output))


if __name__ == '__main__':
    main()
