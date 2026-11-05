"""Read-only blind-end and concentric hemispherical cap topology preflight.

This is not a mesher or a CAD certificate generator. Coordinates must be mm,
with the entry on XY and the cap on +Z, as in standard_cad's DIN1587 design.
An uncertified saved STEP can be inspected, but is never promoted to certified
independent CAD. Face indices below belong only to the hashed source revision.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

SURFACE_LIMIT_MM = 2e-6


def _ray_hits(shape, origin, direction, length):
    from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
    from OCP.gp import gp_Dir, gp_Lin, gp_Pnt

    ray = IntCurvesFace_ShapeIntersector()
    ray.Load(shape.wrapped, 1e-9)
    ray.Perform(gp_Lin(gp_Pnt(*origin), gp_Dir(*direction)), 0, length)
    if not ray.IsDone():
        raise ValueError('Blind-end CAD line intersection did not finish')
    hits = sorted(ray.WParameter(i) for i in range(1, ray.NbPnt() + 1))
    unique = []
    for hit in hits:
        if not unique or hit - unique[-1] > 1e-7:
            unique.append(hit)
    return unique


def blind_end(shape):
    """Require a void entry, then exactly one material interval on the axis.

    No planar floor is presumed. Intersections and one-sided solid occupancy
    are independent evidence; a through nut, filled bore or extra axial cavity
    fails rather than acquiring an invented termination.
    """
    if not shape.is_valid or len(shape.solids()) != 1:
        raise ValueError('Blind-end preflight requires one valid material solid')
    bounds = shape.bounding_box()
    low, high = bounds.min.Z, bounds.max.Z
    height = high - low
    if height <= 1e-3 or abs(low) > SURFACE_LIMIT_MM:
        raise ValueError('Require a positive-height nut with entry datum Z=0 mm')
    margin = max(1.0, height * .1)
    start, stop = low - margin, high + margin
    hits = _ray_hits(shape, (0, 0, start), (0, 0, 1), stop - start)
    levels = [start + hit for hit in hits]
    intervals = []
    for a, b in zip([start] + levels, levels + [stop]):
        if b - a > 1e-7:
            intervals.append(dict(zMinMm=a, zMaxMm=b,
                                  material=bool(shape.is_inside((0, 0, (a + b) / 2)))))
    material = [item for item in intervals if item['material']]
    if len(levels) != 2 or len(material) != 1:
        raise ValueError('Require one blind axial material interval, not a through bore or extra cavity')
    end, top = levels
    delta = min(1e-4, (top - end) / 10, (end - low) / 10)
    if delta <= 1e-6 or abs(top - high) > SURFACE_LIMIT_MM:
        raise ValueError('Require a blind axial void entry and an end strictly below the exposed axis top')
    checks = dict(entryIsVoid=not shape.is_inside((0, 0, low + delta)),
                  belowEndIsVoid=not shape.is_inside((0, 0, end - delta)),
                  aboveEndIsMaterial=bool(shape.is_inside((0, 0, end + delta))),
                  belowTopIsMaterial=bool(shape.is_inside((0, 0, top - delta))),
                  aboveTopIsVoid=not shape.is_inside((0, 0, top + delta)))
    if not all(checks.values()):
        raise ValueError(f'Blind-end one-sided material checks failed: {checks}')
    faces = list(shape.faces())
    witnesses = []
    for z in (end, top):
        distances = [(face.distance_to((0, 0, z)), i) for i, face in enumerate(faces)]
        distance, index = min(distances)
        if distance > SURFACE_LIMIT_MM:
            raise ValueError('Axial termination is not on the original trimmed CAD boundary')
        witnesses.append(dict(zMm=z, face=index, surfaceType=faces[index].geom_type.name,
                              distanceMm=distance))
    return dict(boreEndZMm=end, outerTopZMm=top, axialRoofThicknessMm=top - end,
                checks=checks, oneSidedOffsetMm=delta, axialIntervals=intervals,
                boundaryWitnesses=witnesses)


def spherical_cap(shape, end=None):
    """Recognize two complete, concentric +Z hemispheres, not arbitrary caps."""
    from OCP.BRepAdaptor import BRepAdaptor_Surface

    end = blind_end(shape) if end is None else end
    spheres = []
    for index, face in enumerate(shape.faces()):
        if face.geom_type.name != 'SPHERE':
            continue
        sphere = BRepAdaptor_Surface(face.wrapped).Sphere()
        center, radius = sphere.Location(), sphere.Radius()
        bounds = face.bounding_box()
        if (abs(center.X()) > SURFACE_LIMIT_MM or abs(center.Y()) > SURFACE_LIMIT_MM
                or abs(bounds.min.Z - center.Z()) > SURFACE_LIMIT_MM
                or abs(bounds.max.Z - center.Z() - radius) > SURFACE_LIMIT_MM
                or abs(face.area - 2 * math.pi * radius**2) / (2 * math.pi * radius**2) > 1e-7):
            raise ValueError('Cap planner requires complete coaxial +Z hemispherical trimmed faces')
        spheres.append(dict(face=index, radiusMm=radius,
                            centerMm=[center.X(), center.Y(), center.Z()], areaMm2=face.area))
    if len(spheres) != 2:
        raise ValueError('Cap planner requires exactly two concentric hemispheres; new topology needed')
    inner, outer = sorted(spheres, key=lambda item: item['radiusMm'])
    if math.dist(inner['centerMm'], outer['centerMm']) > 1e-7:
        raise ValueError('Nonconcentric cap needs a different H8 macro')
    thickness = outer['radiusMm'] - inner['radiusMm']
    join = inner['centerMm'][2]
    if (thickness <= SURFACE_LIMIT_MM or join <= 0
            or abs(join + inner['radiusMm'] - end['boreEndZMm']) > SURFACE_LIMIT_MM
            or abs(join + outer['radiusMm'] - end['outerTopZMm']) > SURFACE_LIMIT_MM):
        raise ValueError('Spherical cap does not explain the actual blind termination and roof')
    return dict(inner=inner, outer=outer, joinZMm=join,
                normalShellThicknessMm=thickness, closureSurface='SPHERE', planarFloor=False)


def _section(shape, sampler, z, angles):
    from build123d import Compound, Wire
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Section
    from OCP.gp import gp_Dir, gp_Pln, gp_Pnt

    cut = BRepAlgoAPI_Section(shape.wrapped, gp_Pln(gp_Pnt(0, 0, z), gp_Dir(0, 0, 1)), False)
    cut.Build()
    if not cut.IsDone():
        raise ValueError('CAD cross-section failed')
    edges = list(Compound.cast(cut.Shape()).edges())
    wires = Wire.combine(edges, tol=1e-7)
    hole = bool(sampler.hole(z))
    if not edges or len(wires) != (2 if hole else 1) or not all(w.is_closed for w in wires):
        raise ValueError('Section is not a closed annulus/disk; additional partition topology needed')
    samples = []
    for theta in angles:
        inner, outer = sampler.radii(theta, z)
        if outer <= inner or (hole and inner <= 0) or (not hole and inner != 0):
            raise ValueError('Section has incompatible radial material intervals')
        residual = 0.0
        for radius in ((inner, outer) if hole else (outer,)):
            angle = math.radians(theta)
            residual = max(residual, sampler.surface_witness_distance(
                (radius * math.cos(angle), radius * math.sin(angle), z)))
        samples.append(dict(thetaDeg=theta, innerRadiusMm=inner, outerRadiusMm=outer,
                            boundaryDistanceMm=residual))
    return dict(zMm=z, topology='annulus' if hole else 'disk', closedWires=len(wires),
                sectionEdges=len(edges), perimeterMm=sum(edge.length for edge in edges), samples=samples)


def preflight_shape(shape, angular_samples=12):
    """Inspect actual sections on both sides of the shoulder and blind pole."""
    if type(angular_samples) is not int or not 6 <= angular_samples <= 72:
        raise ValueError('Angular samples must be an integer in [6,72]')
    from .cad_mesh import RadialCad

    end = blind_end(shape)
    cap = spherical_cap(shape, end)
    join, termination, top = cap['joinZMm'], end['boreEndZMm'], end['outerTopZMm']
    delta = min(1e-4, join / 100, (top - termination) / 100)
    zs = (join / 2, join - delta, join + delta, (join + termination) / 2,
          termination - delta, termination + delta, (termination + top) / 2)
    sampler = RadialCad(shape, hole=lambda z: z < termination)
    angles = [.137 + i * 360 / angular_samples for i in range(angular_samples)]
    sections = [_section(shape, sampler, z, angles) for z in zs]
    below, above = sections[1:3]
    inner_step = min(b['innerRadiusMm'] - a['innerRadiusMm']
                     for a, b in zip(below['samples'], above['samples']))
    if inner_step <= SURFACE_LIMIT_MM:
        raise ValueError('Expected a positive bore-to-dome inner shoulder; new join topology needed')
    horizontal = []
    for i, face in enumerate(shape.faces()):
        if face.geom_type.name == 'PLANE' and abs(abs(face.normal_at().Z) - 1) <= 1e-8:
            if abs(face.center().Z - join) <= 1e-7:
                horizontal.append(dict(face=i, areaMm2=face.area))
    if not horizontal:
        raise ValueError('No real horizontal shoulder face at the dome join')
    return dict(blindEnd=end, cap=cap, sections=sections,
                shoulder=dict(zMm=join, horizontalFaces=horizontal,
                              minimumSampledInnerRadiusJumpMm=inner_step),
                partitions=[
                    dict(region='threaded-entry', zRangeMm=[0, join],
                         topology='annulus', status='existing-radial-and-runout-primitives-only'),
                    dict(region='inner-and-outer-shoulders', zRangeMm=[join - delta, join + delta],
                         topology='stepped-annulus', status='new-conformal-shoulder-macro-required'),
                    dict(region='curved-hollow-dome', zRangeMm=[join, termination],
                         topology='annulus-with-shrinking-cavity', status='new-dome-side-macros-required'),
                    dict(region='blind-pole-and-roof', zRangeMm=[termination, top],
                         topology='annulus-to-disk', status='new-noncollapsed-pole-and-interface-macros-required')],
                preflightPassed=True, fullModelAcceptance=False, h8Generated=False,
                acceptedForFullH8Allocation=False, cornerAndGaussAudited=False,
                nodeAndFaceMatchingAudited=False,
                limitations=['Bounded concentric hemispherical DIN1587-style topology only',
                             'Finite sections and witnesses, not exhaustive CAD volume decomposition',
                             'Socket floor cannot represent a spherical blind end',
                             'Do not collapse a swept annulus onto the axis; eight distinct nodes required',
                             'No full H8/K/INP/HM or shared-face interface acceptance'])


def plan(step, request, *, unit='mm', certificate=None, angular_samples=12):
    """Bind a saved-STEP preflight to its hash; optional certificate is checked."""
    from .standard_cad import CadRequest, _mass, _thread_check
    from .thread_dimensions import dimensions_for

    request = CadRequest.parse(request)
    if request.family != 'cap_nut' or unit != 'mm':
        raise ValueError('Cap preflight requires a cap_nut request and explicit mm coordinates')
    if type(angular_samples) is not int or not 6 <= angular_samples <= 72:
        raise ValueError('Angular samples must be an integer in [6,72]')
    diameter, pitch = dimensions_for(request.__dict__)
    step = Path(step).resolve()
    if not 0 < step.stat().st_size <= 16 * 1024**2:
        raise ValueError('Cap preflight STEP budget is 16 MiB')
    digest = hashlib.sha256(step.read_bytes()).hexdigest()
    certified = certificate is not None
    if certified:
        record = json.loads(Path(certificate).read_text(encoding='utf-8'))
        recorded_request = CadRequest.parse(record['request'])
        error = record.get('relativeReopenVolumeError', float('nan'))
        if (record.get('stepSHA256') != digest or record.get('acceptedAsIndependentCad') is not True
                or record.get('geometryIndependentOfMesh') is not True or record.get('unit') != 'mm'
                or recorded_request != request or type(error) not in (int, float)
                or not math.isfinite(error) or not 0 <= error <= 1e-7):
            raise ValueError('Require hash-verified independent CAD certificate at exchange limit 1e-7')
    from build123d import import_step

    shape = import_step(step)
    result = preflight_shape(shape, angular_samples)
    from types import SimpleNamespace

    thread = _thread_check(shape, SimpleNamespace(thread_diameter=diameter, thread_pitch=pitch,
                           nut_data=dict(m=result['cap']['joinZMm'])), request)
    bounds = shape.bounding_box()
    result.update(schemaVersion=1, purpose='blind-cap-topology-preflight', unit='mm',
                  sourceStep=str(step), sourceStepSHA256=digest, sourceStepBytes=step.stat().st_size,
                  request=request.__dict__, sourceIndependentCadCertified=certified,
                  sourceCadVolumeMm3=_mass(shape),
                  bboxMm=dict(min=list(bounds.min), max=list(bounds.max)),
                  nominalThreadMm=dict(majorDiameter=diameter, pitch=pitch), threadOccupancy=thread,
                  gates=dict(minimumCornerScaledJacobian=.15, cadH8VolumeRelative=1e-4,
                             surfaceDistanceMm=SURFACE_LIMIT_MM, cadExchangeVolumeRelative=1e-7))
    if not certified:
        result['limitations'].append('No supplied CAD certificate: design provenance and exchange not re-certified')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('step', type=Path)
    parser.add_argument('--size', required=True)
    parser.add_argument('--unit', required=True, choices=['mm'])
    parser.add_argument('--certificate', type=Path)
    parser.add_argument('--angular-samples', type=int, default=12)
    args = parser.parse_args()
    report = plan(args.step, dict(family='cap_nut', standard='din1587', size=args.size),
                  unit=args.unit, certificate=args.certificate, angular_samples=args.angular_samples)
    print(json.dumps(report, indent=2, allow_nan=False))
