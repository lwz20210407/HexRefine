"""Custom flat annular washer: independent design CAD and bounded mapped H8.

No standard, tolerance class, chamfer, material, load or native-HM claim.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from importlib.metadata import version
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile

import numpy as np

from .cad_mesh import _sweep
from .cad_mesh_pipeline import _sha
from .h8_quality_report import measure_h8, summarize_h8
from .inp_writer import write_inp
from .mesh_audit import audit_h8
from .mesh_core import build_ring_section
from .standard_cad import _mass, CAD_ROUNDTRIP_VOLUME_LIMIT

MAX_H8 = 20_000
MAX_NODES = 50_000
MAX_BYTES = 16 * 1024 * 1024
VOLUME_LIMIT = 1e-4
NODE_LIMIT_MM = 2e-6
FACE_LIMIT_MM = .02
IO_LIMIT_MM = 1e-10


@dataclass(frozen=True)
class WasherDesign:
    outer_diameter_mm: float = 12.
    inner_diameter_mm: float = 6.4
    thickness_mm: float = 1.6


@dataclass(frozen=True)
class WasherSeeds:
    circumferential: int = 288
    radial: int = 6
    layers: int = 4


def _validated(value, cls):
    # Reconstruct the base record; caller subclasses cannot override validation.
    if isinstance(value, cls):
        value = {key: getattr(value, key) for key in cls.__dataclass_fields__}
    if type(value) is not dict or set(value) != set(cls.__dataclass_fields__):
        raise ValueError('Require exactly the fields of ' + cls.__name__)
    if cls is WasherDesign:
        if any(type(v) not in (int, float) or not .001 <= v <= 1000
               or not math.isfinite(v) for v in value.values()):
            raise ValueError('Design dimensions must be finite numbers in [.001,1000] mm')
        design = WasherDesign(**value)
        if (design.outer_diameter_mm - design.inner_diameter_mm) / 2 < .001:
            raise ValueError('Require positive annular radial width of at least .001 mm')
        return design
    if any(type(v) is not int or not 1 <= v <= 1536 for v in value.values()):
        raise ValueError('Seeds must be bounded positive integers, not Booleans')
    seeds = WasherSeeds(**value)
    if seeds.circumferential < 6 or seeds.circumferential % 6:
        raise ValueError('Ring topology requires circumferential count divisible by six')
    if seeds.radial > 64 or seeds.layers > 64:
        raise ValueError('Radial and layer counts must not exceed 64')
    if (seeds.circumferential * seeds.radial * seeds.layers > MAX_H8
            or seeds.circumferential * (seeds.radial + 1) * (seeds.layers + 1) > MAX_NODES):
        raise ValueError('Washer preallocation element/node budget exceeded')
    return seeds


def plan(design=WasherDesign(), seeds=WasherSeeds()):
    design, seeds = _validated(design, WasherDesign), _validated(seeds, WasherSeeds)
    angle = math.tau / seeds.circumferential
    volume = math.pi / 4 * (design.outer_diameter_mm - design.inner_diameter_mm) * (
        design.outer_diameter_mm + design.inner_diameter_mm) * design.thickness_mm
    relative = 1 - math.sin(angle) / angle
    sag = design.outer_diameter_mm / 2 * (1 - math.cos(angle / 2))
    if relative > VOLUME_LIMIT or sag > FACE_LIMIT_MM:
        raise ValueError('Seeds fail fixed volume/face-distance limits; refine without changing design')
    return dict(design=asdict(design), seeds=asdict(seeds), analyticVolume=volume,
                predictedDiscreteVolume=volume * math.sin(angle) / angle,
                predictedRelativeVolumeError=relative, outerChordSagMM=sag,
                nodes=seeds.circumferential * (seeds.radial + 1) * (seeds.layers + 1),
                elements=seeds.circumferential * seeds.radial * seeds.layers)


def build_cad(design=WasherDesign()):
    """Only three design dimensions reach CAD; there is no mesh input."""
    design = _validated(design, WasherDesign)
    from build123d import Align, Cylinder
    align = (Align.CENTER, Align.CENTER, Align.MIN)
    shape = (Cylinder(design.outer_diameter_mm / 2, design.thickness_mm, align=align)
             - Cylinder(design.inner_diameter_mm / 2, design.thickness_mm, align=align))
    shape.label = 'CUSTOM_FLAT_ANNULAR_WASHER'
    _cad_faces(shape, design)
    return shape


def _cad_faces(shape, design):
    """Bind the four actual trimmed BRep faces, not merely nominal supports."""
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder
    if not shape.is_valid or len(shape.solids()) != 1 or len(shape.faces()) != 4:
        raise ValueError('Washer CAD must be one valid four-face annular solid')
    result = {}
    for face in shape.faces():
        surface = BRepAdaptor_Surface(face.wrapped)
        kind = surface.GetType()
        if kind == GeomAbs_Plane:
            plane = surface.Plane()
            normal = plane.Axis().Direction()
            z = plane.Location().Z()
            if abs(abs(normal.Z()) - 1) > 1e-12:
                raise ValueError('Washer end plane is tilted')
            label = 'BOTTOM' if abs(z) <= NODE_LIMIT_MM else 'TOP' if abs(z - design.thickness_mm) <= NODE_LIMIT_MM else None
        elif kind == GeomAbs_Cylinder:
            cylinder = surface.Cylinder()
            origin, axis = cylinder.Location(), cylinder.Axis().Direction()
            if math.hypot(origin.X(), origin.Y()) > NODE_LIMIT_MM or abs(abs(axis.Z()) - 1) > 1e-12:
                raise ValueError('Washer cylinder is displaced or tilted')
            radius = cylinder.Radius()
            label = 'INNER' if abs(radius - design.inner_diameter_mm / 2) <= NODE_LIMIT_MM else 'OUTER' if abs(radius - design.outer_diameter_mm / 2) <= NODE_LIMIT_MM else None
        else:
            label = None
        if label is None or label in result:
            raise ValueError('CAD face does not match the unchamfered annular design')
        result[label] = face
    if set(result) != {'BOTTOM', 'TOP', 'INNER', 'OUTER'}:
        raise ValueError('Missing annular CAD faces')
    expected = math.pi / 4 * (design.outer_diameter_mm - design.inner_diameter_mm) * (
        design.outer_diameter_mm + design.inner_diameter_mm) * design.thickness_mm
    mass = _mass(shape)
    if abs(mass - expected) / expected > CAD_ROUNDTRIP_VOLUME_LIMIT:
        raise ValueError('Actual BRep volume differs from design annulus')
    return result


def build_mesh(design=WasherDesign(), seeds=WasherSeeds()):
    info = plan(design, seeds)
    d, s = WasherDesign(**info['design']), WasherSeeds(**info['seeds'])
    section = build_ring_section(s.circumferential // 6, s.radial,
                                 d.inner_diameter_mm / 2, d.outer_diameter_mm / 2)
    mesh = _sweep(section, np.linspace(0, d.thickness_mm, s.layers + 1),
                  None, name='CUSTOM_FLAT_WASHER')
    mesh.dims = dict(design=info['design'], seeds=info['seeds'], unit='mm',
                     standard=None, toleranceClass=None, chamfer=0)
    if len(mesh.nodes) != info['nodes'] or len(mesh.elems) != info['elements']:
        raise ValueError('Mapped ring topology counts differ from the bounded plan')
    return mesh


def audit_mesh(mesh, design=WasherDesign(), seeds=WasherSeeds(), shape=None):
    """Actual Jacobians/topology and, if supplied, original trimmed CAD faces."""
    info = plan(design, seeds)
    d, s = WasherDesign(**info['design']), WasherSeeds(**info['seeds'])
    if len(mesh.nodes) != info['nodes'] or len(mesh.elems) != info['elements']:
        raise ValueError('Mesh counts differ from washer plan')
    if len(np.unique(mesh.nodes, axis=0)) != len(mesh.nodes):
        raise ValueError('Duplicate node positions; no implicit welding allowed')
    quality, boundary = audit_h8(mesh.nodes, mesh.elems, expected_euler=0, minimum_sj=0.)
    metric_report = summarize_h8(measure_h8(mesh.nodes, mesh.elems))
    if not metric_report['sampledPositiveJacobians']:
        raise ValueError('Nonpositive corner, center or Gauss determinant')
    p = mesh.nodes[boundary]
    radii = np.linalg.norm(p[:, :, :2], axis=2)
    masks = dict(BOTTOM=np.all(abs(p[:, :, 2]) <= NODE_LIMIT_MM, axis=1),
                 TOP=np.all(abs(p[:, :, 2] - d.thickness_mm) <= NODE_LIMIT_MM, axis=1),
                 INNER=np.all(abs(radii - d.inner_diameter_mm / 2) <= NODE_LIMIT_MM, axis=1),
                 OUTER=np.all(abs(radii - d.outer_diameter_mm / 2) <= NODE_LIMIT_MM, axis=1))
    if not np.all(sum(masks.values()) == 1):
        raise ValueError('Unclassified or ambiguous free face; internal free faces forbidden')
    counts = {name: int(mask.sum()) for name, mask in masks.items()}
    expected = dict(BOTTOM=s.circumferential * s.radial, TOP=s.circumferential * s.radial,
                    INNER=s.circumferential * s.layers, OUTER=s.circumferential * s.layers)
    if counts != expected:
        raise ValueError('Unexpected physical boundary coverage')
    if abs(quality['volume'] - info['predictedDiscreteVolume']) / info['predictedDiscreteVolume'] > 1e-10:
        raise ValueError('Integrated mesh volume differs from exact polygonal annulus')
    source_volume = info['analyticVolume'] if shape is None else _mass(shape)
    relative = abs(quality['volume'] - source_volume) / source_volume
    if relative > VOLUME_LIMIT:
        raise ValueError('Discrete mesh/source volume limit exceeded')
    association = None
    if shape is not None:
        faces = _cad_faces(shape, d)
        groups = {}
        for name, mask in masks.items():
            face = faces[name]
            ids = np.unique(boundary[mask])
            nodal = max(float(face.distance_to(tuple(mesh.nodes[i]))) for i in ids)
            centres = p[mask].mean(axis=1)
            centre = max(float(face.distance_to(tuple(point))) for point in centres)
            if not math.isfinite(nodal + centre) or nodal > NODE_LIMIT_MM or centre > FACE_LIMIT_MM:
                raise ValueError('Actual trimmed CAD boundary distances exceeded')
            groups[name] = dict(faces=counts[name], uniqueNodes=len(ids),
                                maximumNodeDistanceMM=nodal, maximumFaceCentreDistanceMM=centre)
        # All cell centres must remain material; the central bore is not filled.
        if any(not shape.is_inside(tuple(point)) for point in mesh.nodes[mesh.elems].mean(axis=1)):
            raise ValueError('Cell centre outside actual CAD material')
        if shape.is_inside((0, 0, d.thickness_mm / 2)):
            raise ValueError('Actual CAD bore is filled')
        association = dict(groups=groups, allBoundaryNodesChecked=True, allBoundaryFaceCentresChecked=True,
                           allCellCentresInside=True, boreIsVoid=True, source='actual trimmed STEP BRep faces',
                           maximumNodeDistanceMM=max(g['maximumNodeDistanceMM'] for g in groups.values()),
                           maximumFaceCentreDistanceMM=max(g['maximumFaceCentreDistanceMM'] for g in groups.values()),
                           fullHausdorffCertified=False)
    return dict(plan=info, topology=quality, metrics=metric_report, boundaryCounts=counts,
                sourceVolume=source_volume, relativeCadVolumeError=relative,
                boundaryAssociation=association, geometryVerified=shape is not None,
                limits=dict(relativeVolume=VOLUME_LIMIT, nodeMM=NODE_LIMIT_MM, faceCentreMM=FACE_LIMIT_MM,
                            sampledJacobian='strictly positive; no empirical SJ floor'))


def _readbacks(stage, mesh, geometry_report):
    from .truegrid_screw import read_keyword
    import meshio
    k = read_keyword(stage / 'model.k')
    inp = meshio.read(stage / 'model.inp', file_format='abaqus')
    reports = {}
    for name, points, cells in (('k', k.nodes, k.elements),
                                ('inp', inp.points, inp.get_cells_type('hexahedron'))):
        if points.shape != mesh.nodes.shape or not np.array_equal(cells, mesh.elems):
            raise ValueError(name + ' readback changed counts/connectivity')
        error = float(np.max(abs(points - mesh.nodes)))
        if not math.isfinite(error) or error > IO_LIMIT_MM:
            raise ValueError(name + ' readback coordinates differ')
        audit, _ = audit_h8(points, cells, expected_euler=0, minimum_sj=0.)
        relative = abs(audit['volume'] - geometry_report['sourceVolume']) / geometry_report['sourceVolume']
        association = geometry_report['boundaryAssociation']
        node_bound = association['maximumNodeDistanceMM'] + math.sqrt(3) * error
        face_bound = association['maximumFaceCentreDistanceMM'] + math.sqrt(3) * error
        if relative > VOLUME_LIMIT or node_bound > NODE_LIMIT_MM or face_bound > FACE_LIMIT_MM:
            raise ValueError(name + ' readback no longer satisfies source CAD limits')
        reports[name] = dict(reader='truegrid_screw.read_keyword' if name == 'k' else 'meshio',
                             maximumCoordinateDifferenceMM=error, exactConnectivity=True,
                             nodes=len(points), elements=len(cells), volume=audit['volume'],
                             relativeCadVolumeError=relative, maximumCadNodeDistanceBoundMM=node_bound,
                             maximumCadFaceCentreDistanceBoundMM=face_bound, sampledPositiveJacobians=True)
    if (not np.array_equal(k.node_ids, np.arange(1, len(mesh.nodes) + 1))
            or not np.array_equal(k.element_ids, np.arange(1, len(mesh.elems) + 1))
            or not np.all(k.part_ids == 1) or k.element_cards != {'*ELEMENT_SOLID': len(mesh.elems)}):
        raise ValueError('K readback lost H8 identity/part ownership')
    if sum(len(block.data) for block in inp.cells) != len(mesh.elems):
        raise ValueError('INP contains unexpected non-H8 cells')
    return reports


def generate(design, output, seeds=WasherSeeds(), *, node=None):
    """Publish only a fully checked new bundle; existing destinations are refused."""
    info = plan(design, seeds)
    design, seeds = WasherDesign(**info['design']), WasherSeeds(**info['seeds'])
    output = Path(output).absolute()
    if output.exists() or output.is_symlink() or not output.parent.is_dir():
        raise ValueError('Require new output directory under an existing parent')
    executable = node if node is not None else shutil.which('node')
    if executable is None or not Path(executable).is_file():
        raise ValueError('Require existing Node runtime for native K writer')
    project = Path(__file__).resolve().parents[2]
    from build123d import export_step, import_step
    shape = build_cad(design)
    original_mass = _mass(shape)
    with tempfile.TemporaryDirectory(prefix='flat-washer-', dir=output.parent) as temporary:
        stage = Path(temporary) / 'bundle'
        stage.mkdir()
        export_step(shape, stage / 'model.step')
        reopened = import_step(stage / 'model.step')
        _cad_faces(reopened, design)
        reopened_mass = _mass(reopened)
        reopen_error = abs(reopened_mass - original_mass) / original_mass
        if reopen_error > CAD_ROUNDTRIP_VOLUME_LIMIT:
            raise ValueError('STEP roundtrip volume changed')
        mesh = build_mesh(design, seeds)
        report = audit_mesh(mesh, design, seeds, reopened)
        mesh.nodes.astype('<f8').tofile(stage / 'nodes.f64')
        mesh.elems.astype('<i4').tofile(stage / 'elements.i32')
        (stage / 'mesh-binary.json').write_text(json.dumps(dict(schemaVersion=1,
            nodes=len(mesh.nodes), elements=len(mesh.elems), readback=True,
            geometryReference='independent-step')), encoding='ascii')
        exported = subprocess.run([str(executable), str(project / 'scripts/export-cad-h8-binary.mjs'), str(stage)],
                                  cwd=project, check=True, capture_output=True, text=True, timeout=60)
        native = json.loads(exported.stdout)
        write_inp([mesh], stage / 'model.inp', elem_type='C3D8', with_material=False, coordinate_precision=15)
        readbacks = _readbacks(stage, mesh, report)
        for name in ('nodes.f64', 'elements.i32', 'mesh-binary.json'):
            (stage / name).unlink()
        hashes = {name: _sha(stage / name) for name in ('model.step', 'model.k', 'model.inp')}
        if hashes['model.k'] != native['kSHA256']:
            raise ValueError('Native K export/hash mismatch')
        bounds=reopened.bounding_box()
        cad = dict(schemaVersion=1, family='custom_flat_annular_washer', request=asdict(design), unit='mm',
                   geometryIndependentOfMesh=True, acceptedAsIndependentCad=True,
                   standard=None, standardEdition=None, toleranceClass=None, chamferMM=0,
                   build123dVersion=version('build123d'), solids=1, faces=4,
                   bbox=dict(min=list(bounds.min),max=list(bounds.max)),bboxSource='reimported independent STEP',
                   volume=original_mass, reopenedVolume=reopened_mass,
                   relativeReopenVolumeError=reopen_error, cadRoundtripVolumeLimit=CAD_ROUNDTRIP_VOLUME_LIMIT,
                   stepSHA256=hashes['model.step'], matchedMeshVerified=True,
                   matchedKSHA256=hashes['model.k'], meshVolume=readbacks['k']['volume'],
                   relativeMeshVolumeError=readbacks['k']['relativeCadVolumeError'],
                   matchingScope='All boundary nodes/face centres and discrete volume; not native HM or solver acceptance',
                   nativeHmVerified=False)
        report.update(schemaVersion=1, family='custom_flat_annular_washer', unit='mm',
            design=asdict(design), seeds=asdict(seeds), kSHA256=hashes['model.k'],
            inpSHA256=hashes['model.inp'], sourceStepSHA256=hashes['model.step'], hashes=hashes,
            nodes=len(mesh.nodes), elements=len(mesh.elems), volume=report['topology']['volume'],
            boundaryEuler=report['topology']['boundaryEuler'], boundaryFaces=report['topology']['boundaryFaces'],
            relativeMeshVolumeError=report['relativeCadVolumeError'],
            meshGeometryChecksPassed=True, acceptedScope='custom washer CAD and mapped mesh geometry/IO only',
            nativeHmVerified=False, solverVerified=False, engineeringQualityAccepted=False,
            readbacks=readbacks, nativeWriterReadback=native['nativeReadback'],
            maximumH8=MAX_H8, maximumArtifactBytes=MAX_BYTES,
            limitations=['Not ISO7089, not a certified standard edition or tolerance class.',
                         'No chamfer, fillet, coating, preload, contact, material or solver deck.',
                         'Finite Jacobian samples are not a global positivity proof.',
                         'Linear chord faces approximate circular CAD; no dimension compensation.',
                         'Native HM import/save/reopen and FE convergence remain separate.'])
        (stage / 'cad-report.json').write_text(json.dumps(cad, indent=2, allow_nan=False) + '\n', encoding='ascii')
        (stage / 'report.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n', encoding='ascii')
        if sum(p.stat().st_size for p in stage.iterdir()) > MAX_BYTES:
            raise ValueError('Washer artifact byte budget exceeded')
        stage.rename(output)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--outer-diameter-mm', type=float, default=12.)
    parser.add_argument('--inner-diameter-mm', type=float, default=6.4)
    parser.add_argument('--thickness-mm', type=float, default=1.6)
    parser.add_argument('--circumferential', type=int, default=288)
    parser.add_argument('--radial', type=int, default=6)
    parser.add_argument('--layers', type=int, default=4)
    parser.add_argument('--node', type=Path)
    args = parser.parse_args(argv)
    design = WasherDesign(args.outer_diameter_mm, args.inner_diameter_mm, args.thickness_mm)
    seeds = WasherSeeds(args.circumferential, args.radial, args.layers)
    report = generate(design, args.output, seeds, node=args.node)
    print(json.dumps(report, indent=2, allow_nan=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
