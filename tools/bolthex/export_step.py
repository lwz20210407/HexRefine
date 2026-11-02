"""Create explicit piecewise-ruled BRep bodies from shared parameter sections.

This is not an exact smooth analytical helix or reverse-engineered original CAD.
It deliberately matches the finite-element boundary stations of the generator.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path


def _value(value):
    return value() if callable(value) else value


def export_sections(source, output, mesh_report=None):
    from build123d import Solid, Wire, Compound, export_step, import_step
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    source, output = Path(source).resolve(), Path(output).resolve()
    if output.exists() or not output.parent.is_dir():
        raise ValueError('Require a new output directory and an existing parent')
    if source.stat().st_size > 8 * 1024 * 1024:
        raise ValueError('Section specification exceeds bounded input size')
    spec = json.loads(source.read_text(encoding='utf-8'))
    if spec.get('schemaVersion') != 1 or spec.get('representation') != 'parameter-section-ruled-brep':
        raise ValueError('Unsupported CAD section schema')
    if not 1 <= len(spec['parts']) <= 8:
        raise ValueError('Invalid part count')
    points_used = 0
    bodies, records = [], []
    def mass(shape):
        p = GProp_GProps()
        BRepGProp.VolumeProperties_s(shape.wrapped, p, 1e-10)
        return float(p.Mass())
    for part in spec['parts']:
        blocks = []
        for block in part['blocks']:
            contours = block['outer']
            if not 2 <= len(contours) <= 256:
                raise ValueError('Invalid station count')
            count = len(contours[0])
            if not 4 <= count <= 192 or any(len(c) != count for c in contours):
                raise ValueError('Incompatible contour seeds')
            points_used += len(contours) * count
            if points_used > 30000:
                raise ValueError('CAD section budget exceeded')
            previous_z = -math.inf
            wires = []
            for contour in contours:
                if any(len(p) != 3 or any(not math.isfinite(v) for v in p) for p in contour):
                    raise ValueError('Invalid contour coordinate')
                z = contour[0][2]
                if z <= previous_z or any(abs(p[2] - z) > 1e-10 for p in contour):
                    raise ValueError('Stations must be planar and strictly ordered')
                previous_z = z
                wires.append(Wire.make_polygon(contour, close=True))
            solid = Solid.make_loft(wires, ruled=True)
            if not _value(solid.is_valid) or mass(solid) <= 0:
                raise ValueError('Invalid or nonpositive loft block')
            blocks.append(solid)
        shape = blocks[0]
        for other in blocks[1:]:
            if part['operation'] == 'fuse':
                shape = shape.fuse(other)
            elif part['operation'] == 'cut':
                shape = shape.cut(other)
            else:
                raise ValueError('Unsupported block operation')
        if isinstance(shape, list):
            shape = Compound(children=shape)
        if not _value(shape.is_valid) or len(shape.solids()) != 1 or mass(shape) <= 0:
            raise ValueError('Each part must produce one valid positive solid')
        shape.label = part['name']
        bodies.append(shape)
        records.append(dict(partId=part['partId'], name=part['name'], solids=len(shape.solids()),
                            faces=len(shape.faces()), volume=mass(shape)))
    model = Compound(children=bodies)
    volume = sum(r['volume'] for r in records)
    expected = None
    if mesh_report is not None:
        expected = json.loads(Path(mesh_report).read_text())['volume']
        if abs(volume - expected) / expected > 1e-4:
            raise ValueError('CAD/FE discrete volume mismatch exceeds 1e-4')
    output.mkdir()
    target = output / 'model.step'
    if not export_step(model, target):
        raise RuntimeError('STEP writer failed')
    reopened = import_step(target)
    reopened_volume = mass(reopened)
    if not _value(reopened.is_valid) or len(reopened.solids()) != len(records) or abs(reopened_volume - volume) / volume > 1e-8:
        raise ValueError('STEP reopen changed solids, validity or volume')
    report = dict(schemaVersion=1, representation=spec['representation'], analyticHelix=False,
        stepSHA256=hashlib.sha256(target.read_bytes()).hexdigest(), sourceSHA256=hashlib.sha256(source.read_bytes()).hexdigest(),
        solids=len(records), parts=records, volume=volume, reopenedVolume=reopened_volume,
        meshVolume=expected, relativeMeshVolumeError=None if expected is None else abs(volume - expected) / expected,
        limitations=spec['limitations'], geometryIncludesThreads=spec.get('threaded', spec.get('profile') is not None))
    (output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--mesh-report', type=Path)
    a = parser.parse_args()
    print(json.dumps(export_sections(a.source, a.output, a.mesh_report), indent=2))
