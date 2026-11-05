"""Finite solid axis core and shared thread band; NOT an original TG repair.

Uses the repository six-sector and compact 2:1 quad templates. The analytical
profile is independently expressed from the public XYZ Screw example's root,
crest, pitch and flank proportions; no proprietary command stream is copied.
The original head, index-sheared core and x-only tip taper are not reproduced.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import hashlib
from itertools import product
import json
import math
from pathlib import Path

import numpy as np

from .graded_core import paired_quad_patch
from .mesh_audit import audit_h8
from .mesh_core import Mesh3D, build_bolt_section

MAX_H8 = 100_000
VOLUME_LIMIT = 1e-4
MINIMUM_SJ = .15
NODE_DISTANCE_LIMIT = 2e-6
FACE_CENTRE_DISTANCE_LIMIT = .02
ORIGINAL_SCREW_SHA256 = '09c9ce96a5df2d8cf900be8fa716d6a0daf7e80d6cc26955e76e623d45182628'


@dataclass(frozen=True)
class ScrewAxisSpec:
    root_radius: float = .9
    crest_radius: float = 1.3
    pitch: float = .4
    turns: int = 1
    base_sector: int = 2
    refinement_levels: int = 5
    axial_per_pitch: int = 64
    thread_radial: int = 1
    axial_distribution: str = 'uniform'
    angular_offset_fraction: float = .5
    handedness: str = 'right'
    element_limit: int = MAX_H8


def plan(spec=ScrewAxisSpec()):
    if not isinstance(spec, ScrewAxisSpec):
        raise ValueError('Expected ScrewAxisSpec')
    for name in ('root_radius', 'crest_radius', 'pitch'):
        value = getattr(spec, name)
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= 1000:
            raise ValueError(name + ' must be finite, positive and bounded')
    if spec.crest_radius <= spec.root_radius:
        raise ValueError('Crest must be outside the root cylinder')
    offset = spec.angular_offset_fraction
    if type(offset) not in (int, float) or not math.isfinite(offset) or not 0 <= offset < 1:
        raise ValueError('Angular seed offset must be in [0,1) of a fine sector')
    for name, lo, hi in (('turns', 1, 8), ('base_sector', 1, 12),
                         ('refinement_levels', 0, 6), ('axial_per_pitch', 4, 1024),
                         ('thread_radial', 1, 16), ('element_limit', 1, MAX_H8)):
        if type(getattr(spec, name)) is not int or not lo <= getattr(spec, name) <= hi:
            raise ValueError('Invalid bounded integer: ' + name)
    if spec.axial_distribution not in ('uniform', 'arc_length'):
        raise ValueError('Unknown axial distribution')
    if spec.handedness not in ('right', 'left'):
        raise ValueError('Unknown handedness')
    coarse = 6 * spec.base_sector
    fine = coarse * 2 ** spec.refinement_levels
    core = 3 * spec.base_sector ** 2 + 2 * coarse
    transition = 3 * coarse * (2 ** spec.refinement_levels - 1)
    per_layer = core + transition + fine * spec.thread_radial
    layers = spec.turns * spec.axial_per_pitch
    count = per_layer * layers
    if count > spec.element_limit:
        raise ValueError(f'Before allocation: {count} H8 exceeds element budget {spec.element_limit}')
    # Every section is a quadrangulated disk: V = Q + boundary_edges/2 + 1.
    points = per_layer + fine // 2 + 1
    if points * (layers + 1) * 160 + count * 160 > 48 * 1024 * 1024:
        raise ValueError('Before allocation: K+INP estimated artifact budget exceeds 48 MiB')
    mean_r2 = .5 * spec.root_radius ** 2 + .05 * spec.crest_radius ** 2
    mean_r2 += .45 * (spec.root_radius ** 2 + spec.root_radius * spec.crest_radius
                       + spec.crest_radius ** 2) / 3
    return dict(elements=count, nodes=points * (layers + 1), sectionQuads=per_layer,
                coreQuads=core + transition, angularSegments=fine,
                coarseAngularSegments=coarse, axialIntervals=layers,
                height=spec.turns * spec.pitch, innerCoreRadius=.2 * spec.root_radius,
                sharedSupportRadius=.6 * spec.root_radius,
                angularSeedRotation=math.tau * offset / fine,
                analyticVolume=math.pi * spec.turns * spec.pitch * mean_r2)


def profile_radius(phase, spec=ScrewAxisSpec()):
    """Original untapered tooth: flanks 0..9/40 and 11/40..1/2.

    This is a continuous helical radial field, not the original x-only tip
    modulation or an independent CAD surface.
    """
    phase = np.remainder(phase, 1.)
    height = np.minimum(phase / .225, (.5 - phase) / .225)
    return spec.root_radius + (spec.crest_radius - spec.root_radius) * np.clip(height, 0, 1)


def axial_stations(theta, spec=ScrewAxisSpec()):
    """Fixed planar ends, monotone per-column stations; no axis winding.

    Arc-length equidistribution refines the real flank rather than changing it.
    The interior core keeps planar layers; only the finite outer band is warped.
    """
    info = plan(spec)
    theta = np.asarray(theta, dtype=float)
    flat = np.linspace(0., info['height'], info['axialIntervals'] + 1)
    if spec.axial_distribution == 'uniform':
        return np.broadcast_to(flat[:, None], (len(flat), len(theta))).copy()
    sign = 1 if spec.handedness == 'right' else -1
    slope = (spec.crest_radius - spec.root_radius) / (.225 * spec.pitch)
    flank_weight = math.hypot(1, slope)
    result = np.empty((len(flat), len(theta)))
    for column, angle in enumerate(theta):
        offset = sign * angle / math.tau
        knots = [0., info['height']]
        for turn in range(-2, spec.turns + 3):
            for phase in (0., .225, .275, .5):
                z = spec.pitch * (turn + phase + offset)
                if 1e-13 < z < info['height'] - 1e-13:
                    knots.append(z)
        knots = np.array(sorted(set(knots)))
        phase = np.remainder((knots[:-1] + knots[1:]) / (2 * spec.pitch) - offset, 1)
        weights = np.where(((phase > 0) & (phase < .225))
                           | ((phase > .275) & (phase < .5)), flank_weight, 1.)
        cumulative = np.r_[0., np.cumsum(np.diff(knots) * weights)]
        result[:, column] = np.interp(np.linspace(0, cumulative[-1], len(flat)), cumulative, knots)
    return result


def _outer_grid(spec, info):
    theta = math.tau * (np.arange(info['angularSegments']) + spec.angular_offset_fraction) / info['angularSegments']
    z = axial_stations(theta, spec)
    sign = 1 if spec.handedness == 'right' else -1
    r = profile_radius(z / spec.pitch - sign * theta / math.tau, spec)
    return np.stack((r * np.cos(theta), r * np.sin(theta), z), axis=2)


def boundary_volume(grid):
    """Independent Q4 skin integral of div(0,0,z)=1, plus planar top cap.

    Exact for the bilinear FE boundary, irrespective of the interior fill.
    This is not a tetrahedralized-quad or CAD volume approximation.
    """
    n = grid.shape[1]
    xy = grid[-1, :, :2]
    area = .5 * np.sum(xy[:, 0] * np.roll(xy[:, 1], -1) - xy[:, 1] * np.roll(xy[:, 0], -1))
    result = float(grid[-1, 0, 2] * area)
    faces = np.stack((grid[:-1], np.roll(grid[:-1], -1, axis=1),
                      np.roll(grid[1:], -1, axis=1), grid[1:]), axis=2).reshape(-1, 4, 3)
    signs = np.array([[-1, -1], [1, -1], [1, 1], [-1, 1]])
    for u, v in product((-1 / math.sqrt(3), 1 / math.sqrt(3)), repeat=2):
        shape = (1 + signs[:, 0] * u) * (1 + signs[:, 1] * v) / 4
        du = signs[:, 0] * (1 + signs[:, 1] * v) / 4
        dv = signs[:, 1] * (1 + signs[:, 0] * u) / 4
        positions = np.einsum('fnd,n->fd', faces, shape)
        a = np.einsum('fnd,n->fd', faces, du)
        b = np.einsum('fnd,n->fd', faces, dv)
        result += float(np.sum(positions[:, 2] * (a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0])))
    return result


def surface_witnesses(grid, spec):
    """Nodal/face radial residuals and an exact inward root-chord distance.

    A radial residual on a flank is not its Euclidean closest distance. On a
    root face the field radius is globally >= root_radius, so a root-profile
    centre strictly inside that cylinder has the stated exact side distance.
    Node distances and interpolated face-centre bounds have DIFFERENT limits.
    This is an analytical-field certificate, not an independent CAD certificate.
    """
    faces = np.stack((grid[:-1], np.roll(grid[:-1], -1, axis=1),
                      np.roll(grid[1:], -1, axis=1), grid[1:]), axis=2).reshape(-1, 4, 3)
    centres = faces.mean(axis=1)
    sign = 1 if spec.handedness == 'right' else -1
    theta = np.arctan2(centres[:, 1], centres[:, 0])
    actual = np.linalg.norm(centres[:, :2], axis=1)
    field = profile_radius(centres[:, 2] / spec.pitch - sign * theta / math.tau, spec)
    node_theta = np.arctan2(grid[:, :, 1], grid[:, :, 0])
    node_error = float(np.max(np.abs(np.linalg.norm(grid[:, :, :2], axis=2)
        - profile_radius(grid[:, :, 2] / spec.pitch - sign * node_theta / math.tau, spec))))
    face_bound = float(np.max(np.abs(actual - field)))
    root = (np.max(np.abs(np.linalg.norm(faces[:, :, :2], axis=2) - spec.root_radius), axis=1) < 1e-12)
    root &= np.abs(field - spec.root_radius) < 1e-12
    distances = np.minimum.reduce((spec.root_radius - actual, centres[:, 2], spec.turns * spec.pitch - centres[:, 2]))
    witness = None
    if np.any(root):
        i = np.flatnonzero(root)[np.argmax(distances[root])]
        witness = dict(point=centres[i].tolist(), distance=float(distances[i]),
                       reference='exact root-cylinder field/cap distance, not CAD', face=int(i))
    return dict(reference='continuous analytical radial field; not independent CAD',
                maximumNodeDistanceUpperBound=node_error,
                maximumFaceCentreRadialFieldResidual=face_bound,
                maximumFaceCentreDistanceUpperBound=face_bound,
                exactRootChordWitness=witness, nodeLimitMM=NODE_DISTANCE_LIMIT,
                interpolatedFaceCentreLimitMM=FACE_CENTRE_DISTANCE_LIMIT,
                fieldNodesAccepted=node_error <= NODE_DISTANCE_LIMIT,
                fieldFaceCentresAccepted=face_bound <= FACE_CENTRE_DISTANCE_LIMIT,
                analyticFieldBoundaryAccepted=node_error <= NODE_DISTANCE_LIMIT and face_bound <= FACE_CENTRE_DISTANCE_LIMIT,
                independentCadVerified=False)


def volume_plan(spec=ScrewAxisSpec()):
    info = plan(spec)
    volume = boundary_volume(_outer_grid(spec, info))
    return dict(**info, discreteBoundaryVolume=volume,
                relativeAnalyticVolumeError=abs(volume - info['analyticVolume']) / info['analyticVolume'],
                volumeLimit=VOLUME_LIMIT, independentCadVerified=False)


def build_axis_section(spec=ScrewAxisSpec()):
    """Three finite rhombus cores and 2:1 rings; one logical ID per interface.

    Patch connectivity is reused from graded_core, not a collapsed cylinder.
    All transition nodes remain strictly inside the fixed support cylinder.
    """
    info = plan(spec)
    inner, support = info['innerCoreRadius'], info['sharedSupportRadius']
    section = build_bolt_section(spec.base_sector, 1, 1, 2 * inner, 2 * inner, True)
    core_points = list(zip(section.x, section.y))
    quads = list(section.quads)
    coarse = info['coarseAngularSegments']
    ring = [section._key[section._canon(('out', k, i))]
            for k in range(6) for i in range(spec.base_sector)]
    weights = .5 ** np.arange(spec.refinement_levels)
    if len(weights):
        weights /= weights.sum()
    patch_points, patch_quads = paired_quad_patch(compact=True)
    low = inner
    for level, weight in enumerate(weights):
        high = support if level == len(weights) - 1 else low + (support - inner) * weight
        high_ring = []
        for j in range(2 * coarse):
            angle = j * math.tau / (2 * coarse)
            high_ring.append(len(core_points))
            core_points.append((high * math.cos(angle), high * math.sin(angle)))
        for column in range(0, coarse, 2):
            ids = [ring[column], ring[(column + 1) % coarse], ring[(column + 2) % coarse],
                   high_ring[(2 * column + 4) % (2 * coarse)],
                   high_ring[(2 * column + 3) % (2 * coarse)],
                   high_ring[(2 * column + 2) % (2 * coarse)],
                   high_ring[(2 * column + 1) % (2 * coarse)], high_ring[2 * column]]
            for u, v in patch_points[8:]:
                angle = (column + u) * math.tau / coarse
                radius = low + v * (high - low)
                ids.append(len(core_points))
                core_points.append((radius * math.cos(angle), radius * math.sin(angle)))
            for a, b, c, d in patch_quads:
                quads.append((ids[a], ids[d], ids[c], ids[b]))
        ring, coarse, low = high_ring, 2 * coarse, high
    if not len(weights):
        # A no-transition section still has a well-defined finite support.
        factor = support / inner
        core_points = [(x * factor, y * factor) for x, y in core_points]
    core_quads = len(quads)
    alpha = [0.] * len(core_points)
    previous = ring
    for j in range(1, spec.thread_radial + 1):
        fraction = j / spec.thread_radial
        radius = support + fraction * (spec.root_radius - support)
        following = []
        for i in range(coarse):
            angle = i * math.tau / coarse
            following.append(len(core_points))
            core_points.append((radius * math.cos(angle), radius * math.sin(angle)))
            alpha.append(fraction)
        for i in range(coarse):
            nxt = (i + 1) % coarse
            quads.append((previous[i], following[i], following[nxt], previous[nxt]))
        previous = following
    if len(quads) != info['sectionQuads'] or len(core_points) != info['nodes'] // (info['axialIntervals'] + 1):
        raise ValueError('Section allocation count differs from plan')
    rotation = info['angularSeedRotation']
    xy = np.asarray(core_points) @ np.array([[math.cos(rotation), math.sin(rotation)],
                                           [-math.sin(rotation), math.cos(rotation)]])
    return dict(xy=xy, quads=np.asarray(quads, dtype=np.int64),
                alpha=np.asarray(alpha), supportIDs=np.asarray(ring), surfaceIDs=np.asarray(previous),
                coreQuads=core_quads)


def require_matching_interface(source_points, source_quads, target_points, target_quads):
    """Exact topology/coordinate compatibility only; never weld or guess seeds.

    Returns target-local indices for source vertices. Rejecting a near-boundary
    quantization case is conservative; this is not a nearest-point repair.
    """
    a, b = np.asarray(source_points), np.asarray(target_points)
    qa, qb = np.asarray(source_quads), np.asarray(target_quads)
    if a.shape != b.shape or qa.shape != qb.shape:
        raise ValueError(f'Template wall / seed mismatch: nodes {a.shape} vs {b.shape}, faces {qa.shape} vs {qb.shape}')
    if a.ndim != 2 or a.shape[1] != 3 or not len(a) or not np.isfinite(a).all() or not np.isfinite(b).all():
        raise ValueError('Invalid interface coordinates')
    for q in (qa, qb):
        if q.ndim != 2 or q.shape[1] != 4 or not np.issubdtype(q.dtype, np.integer) or not len(q) or q.min() < 0 or q.max() >= len(a):
            raise ValueError('Invalid interface quad connectivity')
        if np.any(np.diff(np.sort(q, axis=1), axis=1) <= 0) or len(np.unique(np.sort(q, axis=1), axis=0)) != len(q):
            raise ValueError('Repeated interface vertex/face')
    keys_a = [tuple(p) for p in np.round(a, 10)]
    keys_b = [tuple(p) for p in np.round(b, 10)]
    if len(set(keys_a)) != len(a) or len(set(keys_b)) != len(b):
        raise ValueError('Collapsed/duplicate interface positions')
    lookup = {key: i for i, key in enumerate(keys_b)}
    try:
        mapping = np.array([lookup[key] for key in keys_a], dtype=np.int64)
    except KeyError as error:
        raise ValueError('Template wall: interface coordinates/axial stations differ') from error
    if np.max(np.abs(a - b[mapping])) > 1e-10:
        raise ValueError('Template wall: interface coordinates differ')
    def canonical(quads):
        faces = []
        for quad in quads:
            forward = tuple(map(int, quad))
            reverse = forward[::-1]
            faces.append(min(sequence[i:] + sequence[:i]
                             for sequence in (forward, reverse) for i in range(4)))
        return sorted(faces)
    if canonical(mapping[qa]) != canonical(qb):
        raise ValueError('Template wall: interface quad topology differs')
    return mapping


def build_periodic_axis_core(rings, *, base_sector=6, refinement_levels=0):
    """Fill supplied planar, periodic cylinder rings without changing the wall.

    rings[L+1,N+1,3] explicitly repeats the seam vertex. An unwrapped helical
    strip is NOT a periodic ring: never close its seam or delete its last cells.
    This component conserves its supplied polygonal domain, not smooth CAD.
    """
    rings = np.asarray(rings, dtype=float)
    if rings.ndim != 3 or rings.shape[2] != 3 or rings.shape[0] < 2 or rings.shape[1] < 7 or not np.isfinite(rings).all():
        raise ValueError('Require finite [layers+1, angular+1, 3] interface rings')
    if np.max(np.linalg.norm(rings[:, 0] - rings[:, -1], axis=1)) > 1e-10:
        raise ValueError('Template wall: nonperiodic helical seam; pitch-offset bridge required')
    n, layers = rings.shape[1] - 1, rings.shape[0] - 1
    radius = float(np.mean(np.linalg.norm(rings[0, :-1, :2], axis=1)))
    if not 0 < radius <= 600:
        raise ValueError('Invalid bounded support radius')
    spec = ScrewAxisSpec(root_radius=radius / .6, crest_radius=radius / .6 * 1.1,
                         base_sector=base_sector, refinement_levels=refinement_levels,
                         axial_per_pitch=4, angular_offset_fraction=0)
    info = plan(spec)
    if n != info['angularSegments']:
        raise ValueError('Template wall / seed mismatch: supplied circumferential count differs')
    if info['coreQuads'] * layers > MAX_H8:
        raise ValueError('Core exceeds 100000 H8 before allocation')
    zs = rings[:, 0, 2]
    if np.any(np.diff(zs) <= 0) or np.max(np.abs(rings[:, :, 2] - zs[:, None])) > 1e-10:
        raise ValueError('Template wall: nonplanar/descending axial stations need a 3D bridge')
    if np.max(np.abs(rings[:, :-1, :2] - rings[0, :-1, :2])) > 1e-10:
        raise ValueError('Template wall: varying wall geometry needs a 3D transition')
    theta0 = math.atan2(rings[0, 0, 1], rings[0, 0, 0])
    angles = theta0 + math.tau * np.arange(n) / n
    ideal = radius * np.column_stack((np.cos(angles), np.sin(angles)))
    if np.max(np.linalg.norm(rings[0, :-1, :2] - ideal, axis=1)) > NODE_DISTANCE_LIMIT:
        raise ValueError('Template wall: wall is not the supported ordered circular ring')
    section = build_axis_section(spec)
    q = section['quads'][:section['coreQuads']]
    used = np.unique(q)
    q = np.searchsorted(used, q)
    support = np.searchsorted(used, section['supportIDs'])
    xy = section['xy'][used] @ np.array([[math.cos(theta0), math.sin(theta0)],
                                       [-math.sin(theta0), math.cos(theta0)]])
    points = np.empty((layers + 1, len(xy), 3))
    points[:, :, :2] = xy
    points[:, :, 2] = zs[:, None]
    points[:, support] = rings[:, :-1]  # Exact supplied coordinates; no welding.
    cells = np.concatenate([np.column_stack((q + k * len(xy), q + (k + 1) * len(xy))) for k in range(layers)])
    mesh = Mesh3D('PERIODIC_FINITE_AXIS_CORE')
    mesh.nodes, mesh.elems = points.reshape(-1, 3), cells
    mesh.regions, mesh.region_names = ['FINITE_CORE'] * len(cells), ['FINITE_CORE']
    quality, _ = audit_h8(mesh.nodes, cells, 2)
    xy = rings[0, :-1, :2]
    expected = .5 * np.sum(xy[:, 0] * np.roll(xy[:, 1], -1) - xy[:, 1] * np.roll(xy[:, 0], -1)) * (zs[-1] - zs[0])
    error = abs(quality['volume'] - expected) / expected
    if error > 1e-10:
        raise ValueError('Core changed supplied polygonal-wall volume')
    return dict(mesh=mesh, interfaceNodeIDs=np.arange(len(mesh.nodes)).reshape(layers + 1, -1)[:, support],
                quality=quality, expectedPolygonalVolume=float(expected), relativeVolumeError=error,
                scope='finite core component with supplied planar periodic wall, not original Screw repair')


def original_screw_interface_audit(mesh):
    """Audit the pinned measured oracle, excluding head and degree-mode tip.

    EID ranges are specific to the hash-pinned 2026-11-04 original replay:
    2816 head + 72 neck + 3*1080 thread solids. Never infer these for other K.
    """
    from .truegrid_screw import audit_import
    if mesh.source_sha256 != ORIGINAL_SCREW_SHA256 or len(mesh.elements) != 6128:
        raise ValueError('Require the reviewed original Screw K hash; unknown oracle layout')
    offset = np.flatnonzero(mesh.element_ids == 2889)
    if len(offset) != 1:
        raise ValueError('Reviewed original body EID is missing')
    start = int(offset[0])
    first = mesh.elements[start:start + 36]
    # Actual first helical phase strip, including its distinct end-of-turn seam.
    lower = np.r_[first[:, 1], first[-1, 2]]
    upper = np.r_[first[:, 5], first[-1, 6]]
    strip = mesh.nodes[np.stack((lower, upper))]
    body = (mesh.element_ids >= 2889) & (mesh.element_ids <= 6128)
    nodes = mesh.nodes[np.unique(mesh.elements[body])]
    # First pitch is below 90/12.4=7.258...; no tip inversion or rescaling.
    stable = (nodes[:, 2] >= -1e-12) & (nodes[:, 2] <= .4 + 1e-12)
    stable &= np.cos(np.radians(12.4 * nodes[:, 2])) > 1e-6
    stable &= np.abs(np.linalg.norm(nodes[:, :2], axis=1) - .9) <= NODE_DISTANCE_LIMIT
    selected = nodes[stable]
    if not len(selected):
        raise ValueError('No verified untapered first-pitch root samples')
    angles = np.degrees(np.arctan2(selected[:, 1], selected[:, 0])) % 360
    bins = np.rint(angles / 10).astype(int) % 36
    residual = np.abs((angles - bins * 10 + 180) % 360 - 180)
    if residual.max() > .001:
        raise ValueError('Unexpected untapered seed drift; refusing a guessed angle count')
    # Root node on the first inner phase of each turn independently resolves
    # degrees vs radians in this measured command stream (not a CLI assumption).
    sample = mesh.nodes[mesh.elements[start + 36 * np.arange(30), 1]]
    degree_x = .9 * np.minimum(1 + np.cos(np.radians(12.4 * sample[:, 2])), 1)
    radian_x = .9 * np.minimum(1 + np.cos(12.4 * sample[:, 2]), 1)
    degree_error = float(np.max(np.abs(sample[:, 0] - degree_x)))
    if degree_error > 2e-5:
        raise ValueError('Measured taper no longer agrees with the reviewed degree-mode interpretation')
    old = audit_import(mesh)
    remaining = sorted(set(old['badCornerElementIDs']) - set(old['axisCollapsedElementIDs']))
    try:
        build_periodic_axis_core(strip)
    except ValueError as error:
        wall = str(error)
    else:
        raise ValueError('Original helical strip was unexpectedly treated as a periodic cylinder')
    return dict(schemaVersion=1, sourceSHA256=mesh.source_sha256, selection='thread body only; root .9; z in [0,.4]; no head/tip',
                untaperedRootNodes=len(selected), angularSeedClasses=len(np.unique(bins)),
                seedSpacingDegrees=10, maximumAngularDriftDegrees=float(residual.max()),
                measuredTaperAngleUnits='degrees', maximumDegreePredictionError=degree_error,
                maximumRadianPredictionError=float(np.max(np.abs(sample[:, 0] - radian_x))),
                helicalStrip=strip.tolist(), seamDisplacements=(strip[:, -1] - strip[:, 0]).tolist(),
                compatible=False, templateWall=wall, nativeRodSupportRadius=.54, originalRootWallRadius=.9,
                originalSolids=len(mesh.elements), originalBadCornerCount=len(old['badCornerElementIDs']),
                axisCollapsedElementIDs=old['axisCollapsedElementIDs'],
                remainingNoncollapsedBadElementIDs=remaining, remainingNoncollapsedBadCount=len(remaining),
                deletedElements=0, repairApplied=False, originalScrewAccepted=False)


def build_rod(spec=ScrewAxisSpec()):
    info = volume_plan(spec)
    if not math.isfinite(info['relativeAnalyticVolumeError']) or info['relativeAnalyticVolumeError'] > VOLUME_LIMIT:
        raise ValueError(f"Before 3D allocation: analytical-field volume error {info['relativeAnalyticVolumeError']:.9g} exceeds 1e-4")
    section = build_axis_section(spec)
    xy, alpha = section['xy'], section['alpha']
    theta = np.arctan2(xy[:, 1], xy[:, 0]) % math.tau
    theta[alpha == 0] = 0  # Fixed interior does not participate in the helical field.
    target_z = axial_stations(theta, spec)
    sign = 1 if spec.handedness == 'right' else -1
    radii = profile_radius(target_z / spec.pitch - sign * theta / math.tau, spec)
    flat_z = np.linspace(0, info['height'], info['axialIntervals'] + 1)[:, None]
    reference = np.linalg.norm(xy, axis=1)
    warped_r = reference + alpha * (radii - spec.root_radius)
    points = np.empty((len(flat_z), len(xy), 3))
    points[:, :, :2] = xy
    active = alpha > 0
    actual_angles = np.arctan2(xy[active, 1], xy[active, 0])
    points[:, active, 0] = warped_r[:, active] * np.cos(actual_angles)
    points[:, active, 1] = warped_r[:, active] * np.sin(actual_angles)
    points[:, :, 2] = flat_z + alpha * (target_z - flat_z)
    layers = info['axialIntervals']
    q = section['quads']
    elements = np.concatenate([np.column_stack((q + k * len(xy), q + (k + 1) * len(xy)))
                               for k in range(layers)])
    mesh = Mesh3D('SCREW_AXIS_CORE_ROD')
    mesh.nodes, mesh.elems = points.reshape(-1, 3), elements
    is_core = np.tile(np.arange(len(q)) < section['coreQuads'], layers)
    if len(np.unique(mesh.nodes, axis=0)) != len(mesh.nodes):
        raise ValueError('Duplicate geometric node positions; no welding is allowed')
    quality, boundary = audit_h8(mesh.nodes, elements, 2, minimum_sj=MINIMUM_SJ)
    core, core_boundary = audit_h8(mesh.nodes, elements[is_core], 2)
    band, band_boundary = audit_h8(mesh.nodes, elements[~is_core], 0)
    interface = set(map(tuple, np.sort(core_boundary, axis=1))) & set(map(tuple, np.sort(band_boundary, axis=1)))
    expected = info['angularSegments'] * layers
    if len(interface) != expected:
        raise ValueError('Core/band interface is not entirely shared by node ID')
    for reference_volume in (info['discreteBoundaryVolume'], core['volume'] + band['volume']):
        if abs(quality['volume'] - reference_volume) / quality['volume'] > 1e-10:
            raise ValueError('Interior/core+band volume disagrees with unchanged boundary integral')
    support_volume = .5 * info['angularSegments'] * math.sin(math.tau / info['angularSegments'])
    support_volume *= info['sharedSupportRadius'] ** 2 * info['height']
    if abs(core['volume'] - support_volume) / support_volume > 1e-10:
        raise ValueError('Finite core does not fill its entire polygonal support cylinder')
    ids = section['supportIDs']
    interface_quads = np.concatenate([np.column_stack((ids + k * len(xy),
        np.roll(ids, -1) + k * len(xy), np.roll(ids, -1) + (k + 1) * len(xy),
        ids + (k + 1) * len(xy))) for k in range(layers)])
    mesh.regions = ['FINITE_CORE' if flag else 'THREAD_BAND' for flag in is_core]
    mesh.region_names = ['FINITE_CORE', 'THREAD_BAND']
    surface = points[:, section['surfaceIDs']]
    surface_theta = np.arctan2(surface[:, :, 1], surface[:, :, 0])
    node_error = float(np.max(np.abs(np.linalg.norm(surface[:, :, :2], axis=2)
        - profile_radius(surface[:, :, 2] / spec.pitch - sign * surface_theta / math.tau, spec))))
    witnesses = surface_witnesses(surface, spec)
    # End-plane interior nodes/quad centres belong to the finite field's disks,
    # not its helical side surface. Radial excess bounds distance to those disks.
    def end_plane_excess(values):
        angle = np.arctan2(values[..., 1], values[..., 0])
        target = profile_radius(values[..., 2] / spec.pitch - sign * angle / math.tau, spec)
        return float(np.maximum(np.linalg.norm(values[..., :2], axis=-1) - target, 0).max())
    ends = points[[0, -1]]
    cap_node = end_plane_excess(ends)
    cap_face = end_plane_excess(ends[:, section['quads']].mean(axis=2))
    witnesses.update(maximumEndPlaneNodeDistanceUpperBound=cap_node,
                     maximumEndPlaneFaceCentreDistanceUpperBound=cap_face,
                     maximumNodeDistanceUpperBound=max(witnesses['maximumNodeDistanceUpperBound'], cap_node),
                     maximumFaceCentreDistanceUpperBound=max(witnesses['maximumFaceCentreDistanceUpperBound'], cap_face))
    witnesses['fieldNodesAccepted'] = witnesses['maximumNodeDistanceUpperBound'] <= NODE_DISTANCE_LIMIT
    witnesses['fieldFaceCentresAccepted'] = witnesses['maximumFaceCentreDistanceUpperBound'] <= FACE_CENTRE_DISTANCE_LIMIT
    witnesses['analyticFieldBoundaryAccepted'] = witnesses['fieldNodesAccepted'] and witnesses['fieldFaceCentresAccepted']
    if not witnesses['analyticFieldBoundaryAccepted']:
        raise ValueError('Analytical field boundary rejected: node 2e-6 / face-centre .02 mm gates')
    report = dict(schemaVersion=2, scope='complete finite one-piece analytical threaded rod, not original TG repair',
                  spec=asdict(spec), plan=info, quality=quality,
                  coreVolume=core['volume'], bandVolume=band['volume'], supportCylinderVolume=support_volume,
                  volumeConservationError=abs(quality['volume'] - info['discreteBoundaryVolume']) / quality['volume'],
                  sharedInterfaceFaces=len(interface), sharedInterfaceNodes=(layers + 1) * len(ids),
                  nodalFieldRadiusError=node_error, minimumEightDistinctNodes=True,
                  surfaceWitnesses=witnesses, analyticFieldAccepted=True,
                  minimumEightDistinctPositions=True, allNodePositionsUnique=True,
                  boundedRodMeshAccepted=True, originalScrewRepaired=False,
                  independentCadAccepted=False,
                  independentCadVerified=False, nodeDistanceLimitMM=NODE_DISTANCE_LIMIT,
                  interpolatedFaceCentreLimitMM=FACE_CENTRE_DISTANCE_LIMIT, cadExchangeLimit=1e-7,
                  minimumAllowedSJ=MINIMUM_SJ, volumeLimit=VOLUME_LIMIT,
                  originalInterface=dict(compatible=False, reason='Original 36-angle index-sheared helical interface is not this planar-layer refined support; no insertion was attempted.'),
                  limitations=['No original head, x-only tip modulation or full 30-turn original-domain coverage.',
                               'Analytical tooth proportions only; no independent CAD/solver/standards certification.',
                               'Fine circumferential surface; selected axial distribution, not isotropic 3D grading.',
                               '8 corner/8 Gauss Jacobian sampling, not a proof of positivity everywhere.'])
    if node_error > NODE_DISTANCE_LIMIT:
        raise ValueError('Boundary nodes departed from the specified original-proportion field')
    return dict(mesh=mesh, report=report, coreMask=is_core, interfaceQuads=interface_quads,
                surfaceNodeIDs=np.arange(len(mesh.nodes)).reshape(len(points), len(xy))[:, section['surfaceIDs']])


def generate(spec, output, original_keyword=None):
    """New bounded K/INP bundle, with independent readers; never launch TG/HM."""
    output = Path(output).resolve()
    if output.exists() or not output.parent.is_dir():
        raise FileExistsError('Require a new output directory with an existing parent')
    oracle = None
    if original_keyword is not None:
        from .truegrid_screw import read_keyword
        oracle = original_screw_interface_audit(read_keyword(original_keyword))
    result = build_rod(spec)
    mesh, report = result['mesh'], result['report']
    if oracle is not None:
        report['originalOracleAudit'] = oracle
    output.mkdir()
    with (output / 'model.k').open('x', encoding='ascii') as stream:
        stream.write('*KEYWORD\n$ Finite solid analytical rod; not original TrueGrid repair\n*NODE\n')
        for i, xyz in enumerate(mesh.nodes, 1):
            stream.write(str(i) + ',' + ','.join(format(float(v), '.17g') for v in xyz) + '\n')
        stream.write('*ELEMENT_SOLID\n')
        for i, (cell, core) in enumerate(zip(mesh.elems, result['coreMask']), 1):
            stream.write(f'{i},{1 if core else 2},' + ','.join(str(int(n) + 1) for n in cell) + '\n')
        stream.write('*END\n')
    with (output / 'model.inp').open('x', encoding='ascii') as stream:
        stream.write('*HEADING\nFinite analytical threaded rod; NOT original TG repair or CAD acceptance\n*NODE\n')
        for i, xyz in enumerate(mesh.nodes, 1):
            stream.write(str(i) + ',' + ','.join(format(float(v), '.17g') for v in xyz) + '\n')
        for label, flag in (('FINITE_CORE', True), ('THREAD_BAND', False)):
            stream.write(f'*ELEMENT, TYPE=C3D8, ELSET={label}\n')
            for i in np.flatnonzero(result['coreMask'] == flag):
                stream.write(str(i + 1) + ',' + ','.join(str(int(n) + 1) for n in mesh.elems[i]) + '\n')
    from .truegrid_screw import read_keyword, require_nondegenerate_h8
    reopened = read_keyword(output / 'model.k')
    if (not np.array_equal(reopened.nodes, mesh.nodes)
            or not np.array_equal(reopened.elements, mesh.elems)
            or not np.array_equal(reopened.part_ids, np.where(result['coreMask'], 1, 2))):
        raise ValueError('K readback changed nodes/connectivity')
    report['kReadback'] = require_nondegenerate_h8(reopened)
    import meshio
    inp = meshio.read(output / 'model.inp', file_format='abaqus')
    # The two explicit element sets are grouped in the INP; restore original EID order.
    order = np.r_[np.flatnonzero(result['coreMask']), np.flatnonzero(~result['coreMask'])]
    if not np.array_equal(inp.points, mesh.nodes) or not np.array_equal(inp.get_cells_type('hexahedron'), mesh.elems[order]):
        raise ValueError('Independent INP readback changed nodes/connectivity')
    core_count = int(result['coreMask'].sum())
    for label, expected in (('FINITE_CORE', np.arange(core_count)),
                            ('THREAD_BAND', np.arange(core_count, len(mesh.elems)))):
        if not np.array_equal(inp.cell_sets_dict.get(label, {}).get('hexahedron'), expected):
            raise ValueError('Independent INP readback changed component ownership')
    report['inpReadback'] = dict(reader='meshio', exactCoordinates=True, exactGroupedConnectivity=True,
                                exactComponentOwnership=True)
    report['hashes'] = {name: hashlib.sha256((output / name).read_bytes()).hexdigest()
                        for name in ('model.k', 'model.inp')}
    if sum(p.stat().st_size for p in output.iterdir()) > 48 * 1024 * 1024:
        raise ValueError('Export artifact budget exceeded')
    (output / 'report.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n', encoding='ascii')
    (output / 'result.txt').write_text(
        'BOUNDED ANALYTICAL ROD MESH ACCEPTED; ORIGINAL SCREW NOT REPAIRED\n'
        + 'ANALYTIC FIELD NODE 2e-6 / INTERPOLATED FACE CENTRE .02 mm ACCEPTED; NOT INDEPENDENT CAD\n'
        + json.dumps({k: report[k] for k in ('quality', 'coreVolume', 'bandVolume', 'volumeConservationError',
                                           'sharedInterfaceFaces', 'sharedInterfaceNodes', 'surfaceWitnesses', 'originalInterface')}, indent=2)
        + '\n', encoding='ascii')
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--spec', type=Path, help='Optional bounded ScrewAxisSpec JSON')
    parser.add_argument('--original-keyword', type=Path, help='Optional read-only hash-pinned original Screw K audit')
    args = parser.parse_args(argv)
    spec = ScrewAxisSpec(**json.loads(args.spec.read_text())) if args.spec else ScrewAxisSpec()
    print(json.dumps(generate(spec, args.output, args.original_keyword), indent=2, allow_nan=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
