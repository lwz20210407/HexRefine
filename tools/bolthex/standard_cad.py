"""Optional, mesh-independent standard fastener CAD using bd_warehouse.

No finite-element nodes, seeds or connectivity are accepted by this interface.
The upstream CAD library remains an optional Apache-2.0 dependency, not vendored
or part of the recovered BoltHex kernel. Nominal geometry is not tolerance
class or standards-edition certification.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import hashlib
from importlib.metadata import version
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile


WAREHOUSE_COMMIT = '28696f9b4c765c3b0385ccef1d41f45de245e8ad'
CAD_ROUNDTRIP_VOLUME_LIMIT = 1e-7  # User-approved CAD file exchange policy, 2026-11-02.
FAMILIES = {
    'hex_bolt': ('HexHeadScrew', ('iso4017',)),
    'hex_nut': ('HexNut', ('iso4032', 'iso4033', 'iso4035')),
    'socket_bolt': ('SocketHeadCapScrew', ('iso4762', 'asme_b18.3')),
    'cap_nut': ('DomedCapNut', ('din1587',)),
}


@dataclass(frozen=True)
class CadRequest:
    family: str
    standard: str
    size: str
    hand: str = 'right'
    length: float | None = None
    thread_ends: str = 'library'

    @classmethod
    def parse(cls, data):
        if not isinstance(data, dict):
            raise ValueError('CAD request must be an object')
        allowed = set(cls.__dataclass_fields__)
        unknown = set(data) - allowed
        if unknown:
            raise ValueError(f'Unknown design fields (mesh input is forbidden): {sorted(unknown)}')
        for key in ('family', 'standard', 'size'):
            if not isinstance(data.get(key), str) or not data[key].strip():
                raise ValueError(f'{key} must be a nonempty string')
        result = cls(**data)
        if result.family not in FAMILIES:
            raise ValueError(f'Unsupported family: {result.family}')
        if result.standard not in FAMILIES[result.family][1]:
            raise ValueError(f'Unsupported standard for {result.family}: {result.standard}')
        if result.hand not in ('right', 'left'):
            raise ValueError('hand must be right or left')
        if result.thread_ends not in ('library','square') or (result.thread_ends=='square' and result.family!='hex_nut'):
            raise ValueError('square thread ends are only exposed for open hex nuts')
        if result.family.endswith('bolt'):
            if type(result.length) not in (int, float) or not math.isfinite(result.length) or result.length <= 0:
                raise ValueError('Bolt length must be a positive finite number in mm')
        elif result.length is not None:
            raise ValueError('Nut height comes from the selected table; do not provide length')
        if ('M' if result.standard != 'asme_b18.3' else '-') not in result.size:
            raise ValueError('Size must use the library size-pitch or size-TPI notation')
        return result


def _load_backend(source=None):
    if source is not None:
        source = Path(source).resolve()
        sha = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
        dirty = subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain', '--', 'src'], text=True)
        if sha != WAREHOUSE_COMMIT or dirty:
            raise ValueError('Require clean bd_warehouse v0.3.0 pinned source')
        loaded = sys.modules.get('bd_warehouse')
        if loaded is not None and not Path(loaded.__file__).resolve().is_relative_to(source / 'src'):
            raise ValueError('A different bd_warehouse source is already imported')
        if loaded is None:
            sys.path.insert(0, str(source / 'src'))
        provenance = dict(version='0.3.0', commit=sha, mode='pinned-source')
    else:
        if version('bd_warehouse') != '0.3.0':
            raise ValueError('This adapter is tested with bd_warehouse==0.3.0 only')
        provenance = dict(version='0.3.0', commit=WAREHOUSE_COMMIT, mode='installed-package')
    if version('build123d') != '0.11.1':
        raise ValueError('This adapter is tested with build123d==0.11.1 only')
    from bd_warehouse import fastener
    return fastener, provenance


def catalogue(source=None):
    backend, provenance = _load_backend(source)
    return dict(backend=provenance, unit='mm', standardsEditionVerified=False, gbCrosswalkVerified=False,
                families={name: {standard: getattr(backend, item[0]).sizes(standard)
                                 for standard in item[1]}
                          for name, item in FAMILIES.items()})


def _mass(shape):
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    props = GProp_GProps()
    # Span-aware quadrature avoids treating helical BSpline faces as polynomials.
    error = BRepGProp.VolumePropertiesGK_s(shape.wrapped, props, 1e-12, True, True)
    if not 0 <= error < 1e-9 or props.Mass() <= 0:
        raise ValueError(f'CAD volume integration failed: estimated error={error}')
    return props.Mass()


def _thread_check(shape, part, request):
    pitch, radius = part.thread_pitch, part.thread_diameter / 2
    is_bolt = request.family.endswith('bolt')
    height = request.length if is_bolt else part.nut_data['m']
    if height < 3 * pitch:
        raise ValueError('Validation currently requires at least three pitches of threaded length')
    z = -height * 0.57 if is_bolt else height * 0.37
    sample_radius = radius - pitch * (0.30 if is_bolt else 0.25)
    if sample_radius <= 0:
        raise ValueError('Invalid nominal diameter/pitch relationship')
    def mask(dz):
        return [shape.is_inside((sample_radius * math.cos(a), sample_radius * math.sin(a), z + dz))
                for a in (0.113 + i * math.tau / 32 for i in range(32))]
    base, period, shifted = mask(0), mask(pitch), mask(pitch / 2)
    if not any(base) or all(base) or base != period or shifted == base:
        raise ValueError('Real periodic helical flank occupancy check failed')
    return dict(samples=32, pitchMm=pitch, radiusMm=sample_radius, samplingRadiusMm=sample_radius, zMm=z,
                onePitchPeriodic=True, halfPitchChanges=True, occupancy=base)


def _feature_check(shape, part, request):
    checks = {}
    if request.family == 'socket_bolt':
        height = part.head_height
        checks['socketIsVoid'] = not shape.is_inside((0, 0, height * 0.8))
        checks['socketFloorIsMaterial'] = shape.is_inside((0, 0, height * 0.05))
    elif request.family == 'cap_nut':
        height = shape.bounding_box().max.Z
        checks['entryBoreIsVoid'] = not shape.is_inside((0, 0, part.nut_data['m'] * 0.3))
        checks['capIsClosedMaterial'] = shape.is_inside((0, 0, height - 0.5))
    if not all(checks.values()):
        raise ValueError(f'CAD feature check failed: {checks}')
    return checks


def generate(request, output, source=None):
    request = CadRequest.parse(request)
    output = Path(output).resolve()
    if output.exists() or not output.parent.is_dir():
        raise ValueError('Require a new output directory under an existing parent')
    backend, provenance = _load_backend(source)
    factory = getattr(backend, FAMILIES[request.family][0])
    if request.size not in factory.sizes(request.standard):
        raise ValueError('Size/pitch is absent from the selected standard table')
    kwargs = dict(size=request.size, fastener_type=request.standard, hand=request.hand, simple=False)
    if request.length is not None:
        kwargs['length'] = request.length
    if request.thread_ends=='square':
        # This is a separately requested through-thread CAD design, not a
        # modification of an existing faded-runout STEP to pass a mesh audit.
        from bd_warehouse.thread import IsoThread
        kwargs['simple']=True
        part=factory(**kwargs)
        thread=IsoThread(major_diameter=part.thread_diameter,pitch=part.thread_pitch,length=part.nut_data['m'],
                         external=False,hand=request.hand,end_finishes=('square','square'),simple=False)
        raw=list(part.solids())+list(thread.solids())
    else:
        part = factory(**kwargs)
        raw = list(part.solids())
    if not raw:
        raise ValueError('CAD backend returned no material')
    # Never discard thread solids by selecting the largest body of a compound.
    shape = raw[0].fuse(*raw[1:]).clean() if len(raw) > 1 else raw[0]
    if not shape.is_valid or len(shape.solids()) != 1:
        raise ValueError('All body/thread solids must fuse into one valid solid')
    shape.label = f'{request.standard} {request.size} {request.family}'
    mass = _mass(shape)
    thread = _thread_check(shape, part, request)
    features = _feature_check(shape, part, request)
    bounds = shape.bounding_box()
    z0 = -request.length if request.length is not None else 0
    if abs(bounds.min.Z - z0) > 1e-5:
        raise ValueError('Design datum or under-head length changed')
    from build123d import export_step, import_step
    with tempfile.TemporaryDirectory(prefix='cad-build-', dir=output.parent) as temporary:
        stage = Path(temporary) / 'accepted'
        stage.mkdir()
        target = stage / 'model.step'
        export_step(shape, target)
        reopened = import_step(target)
        if not reopened.is_valid or len(reopened.solids()) != 1:
            raise ValueError('STEP read-back lost a valid single material solid')
        reopened_mass = _mass(reopened)
        relative_error = abs(reopened_mass - mass) / mass
        if relative_error > CAD_ROUNDTRIP_VOLUME_LIMIT:
            raise ValueError(f'STEP mass changed: {relative_error}')
        _thread_check(reopened, part, request)
        _feature_check(reopened, part, request)
        report = dict(schemaVersion=1, request=asdict(request), unit='mm', geometryIndependentOfMesh=True,
                      acceptedAsIndependentCad=True, matchedMeshVerified=False, helicalCad=True,
                      backend=dict(name='bd_warehouse', license='Apache-2.0', **provenance),
                      build123dVersion='0.11.1', solids=1, rawSolids=len(raw), faces=len(shape.faces()),
                      stepSHA256=hashlib.sha256(target.read_bytes()).hexdigest(), volume=mass,
                      reopenedVolume=reopened_mass, relativeReopenVolumeError=relative_error,
                      cadRoundtripVolumeLimit=CAD_ROUNDTRIP_VOLUME_LIMIT,
                      bbox=dict(min=list(bounds.min), max=list(bounds.max)), thread=thread, features=features,
                      designThread=dict(unit='mm',majorDiameterMm=part.thread_diameter,pitchMm=part.thread_pitch),
                      meshVolume=None, relativeMeshVolumeError=None,
                      limitations=['Nominal library geometry, not certified tolerance-class limits',
                                   'No verified GB/EN equivalence or standards edition',
                                   'No corresponding H8 mesh yet; no implicit CAD/mesh matching'])
        (stage / 'cad-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        stage.rename(output)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--warehouse-source', type=Path)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('catalogue')
    make = sub.add_parser('generate')
    make.add_argument('request', type=Path)
    make.add_argument('output', type=Path)
    args = parser.parse_args()
    result = (catalogue(args.warehouse_source) if args.command == 'catalogue' else
              generate(json.loads(args.request.read_text(encoding='utf-8')), args.output, args.warehouse_source))
    print(json.dumps(result, indent=2))
