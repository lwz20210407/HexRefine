"""Conformal three-block H8 inner shoulder ring, not a complete cap nut.

The inner ledge below the step joins a lower load-bearing annulus; that
annulus joins the upper wall. All interfaces share logical node IDs. There
are no hanging nodes, tolerance welds, axis collapses or wedge substitutions.
The bounded CAD adapter follows the actual late M6 helical runout, excluding
the lower planar thread-termination cap and outer hex/dome ledge. The former
R=3.1 artificial inner crop remains a separately labelled optional diagnostic.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import math

import numpy as np

from .mesh_audit import FACES, audit_h8
from .mesh_core import Mesh3D

MAX_H8 = 30_000


@dataclass(frozen=True)
class ShoulderSpec:
    lower_inner: float = 3.0
    step_inner: float = 3.75
    outer: float = 4.5
    bottom: float = 4.9
    step: float = 5.0
    top: float = 5.4
    circumferential: int = 384
    ledge_radial: int = 2
    wall_radial: int = 2
    lower_layers: int = 2
    upper_layers: int = 8

    def validate(self, include_upper=True):
        if type(include_upper) is not bool:
            raise ValueError('include_upper must be boolean')
        for name in ('lower_inner', 'step_inner', 'outer', 'bottom', 'step', 'top'):
            value = getattr(self, name)
            if type(value) not in (int, float) or not math.isfinite(value):
                raise ValueError(f'Finite real shoulder dimension required: {name}')
        if not 0 < self.lower_inner < self.step_inner < self.outer:
            raise ValueError('Require positive ordered lower/step/outer radii')
        if not self.bottom < self.step < self.top:
            raise ValueError('Require bottom < step < top')
        for name in ('circumferential', 'ledge_radial', 'wall_radial', 'lower_layers', 'upper_layers'):
            value = getattr(self, name)
            if type(value) is not int or value < (8 if name == 'circumferential' else 1):
                raise ValueError(f'Positive integer shoulder seed required: {name}')
        if self.circumferential > 1024 or any(getattr(self, n) > 64 for n in
                ('ledge_radial', 'wall_radial', 'lower_layers', 'upper_layers')):
            raise ValueError('Shoulder seed limit exceeded')
        count = self.circumferential * (self.ledge_radial * self.lower_layers
                + self.wall_radial * (self.lower_layers + (self.upper_layers if include_upper else 0)))
        if count > MAX_H8:
            raise ValueError(f'Shoulder local budget {count} exceeds {MAX_H8} H8')
        return count


def angular_seeds(spec, theta_deg=None, directions_xy=None):
    """Preserve a cyclic CCW angle order, including nonuniform gnomonic seeds."""
    raw = np.arange(spec.circumferential) * 360 / spec.circumferential if theta_deg is None else np.asarray(theta_deg)
    if (raw.shape != (spec.circumferential,) or raw.dtype.kind not in 'fiu'
            or not np.isfinite(raw).all()):
        raise ValueError('Require one finite numeric theta_deg per circumferential node')
    angles = np.unwrap(np.radians(raw.astype(float)))
    gaps = np.diff(np.r_[angles, angles[0] + math.tau])
    if np.any(gaps <= 1e-12) or np.any(gaps >= math.pi):
        raise ValueError('theta_deg must be unique cyclic CCW seeds spanning one revolution')
    directions = np.column_stack((np.cos(angles), np.sin(angles)))
    if directions_xy is not None:
        supplied = np.asarray(directions_xy, dtype=float)
        if (supplied.shape != directions.shape or not np.isfinite(supplied).all()
                or np.max(np.abs(supplied - directions)) > 1e-12):
            raise ValueError('directions_xy must agree with theta_deg unit directions')
        directions = supplied.copy()
    return raw.astype(float).copy(), directions, gaps


def shoulder_equatorial_interface(mesh):
    """Free +Z interface of a lower-only shoulder, in the supplied seed order.

    Node rings are radial-major and zero-based. The face order is the reverse
    of cad_cap_dome.equatorial_interface's outward -Z convention. No spatial
    search, resampling, cyclic sorting or tolerance weld is performed.
    """
    if mesh.dims['includeUpper']:
        raise ValueError('Dome interface extraction requires include_upper=False to avoid overlap')
    rings = mesh.shoulder_node_rings.copy()
    return dict(thetaDeg=mesh.dims['thetaDeg'], nodeRings=rings,
                coordinates=mesh.nodes[rings].copy(), faces=mesh.surfaces['dome-equator'].copy(),
                radiiMm=mesh.dims['equatorRadiiMm'], centerMm=[0.0, 0.0, mesh.dims['spec']['step']],
                outwardNormal='+Z', indexBase=0)


def _interface_audit(mesh, interfaces, expected_regions):
    def cycle(face):
        values=tuple(map(int,face))
        return min(values[i:]+values[:i] for i in range(4))
    seen=set()
    for name,faces in interfaces.items():
        keys=[tuple(sorted(map(int,face))) for face in faces]
        if len(keys)!=len(set(keys)) or any(key in seen for key in keys):raise ValueError('Duplicate shoulder interface face records')
        seen.update(keys)
    targets = {tuple(sorted(face)): [] for faces in interfaces.values() for face in faces}
    for eid, element in enumerate(mesh.elems):
        for face in element[FACES]:
            key = tuple(sorted(face))
            if key in targets:
                targets[key].append((eid,cycle(face)))
    result, owners = {}, {}
    for name, faces in interfaces.items():
        pairs = []
        for face in faces:
            records = targets[tuple(sorted(face))]
            adjacent = [eid for eid,_ in records]
            if len(adjacent) != 2 or {mesh.regions[e] for e in adjacent} != expected_regions[name]:
                raise ValueError(f'Nonconformal shoulder interface: {name}')
            declared=cycle(face)
            if declared not in {oriented for _,oriented in records} or records[0][1]!=cycle(records[1][1][::-1]):
                raise ValueError(f'Invalid shoulder interface face cycle: {name}')
            pairs.append(adjacent)
        owners[name] = np.array(pairs, dtype=np.int64)
        result[name] = dict(sharedFaces=len(faces), sharedNodes=len(np.unique(faces)),
                            twoOwnersEveryFace=True, regionPair=sorted(expected_regions[name]))
    return result, owners


def build_step_ring(spec=ShoulderSpec(), upper_inner_radii=None, *, theta_deg=None,
                    directions_xy=None, lower_inner_radii=None, include_upper=True,
                    equator_coordinates=None):
    """Build explicit H8 connectivity and labelled boundary/interface faces.

    With no profile this is an independent analytic stepped circular annulus.
    Its polygonal volume is conserved exactly; circle discretization error is
    separately limited to 1e-4. A supplied profile is P1 between axial stations;
    its exact discrete volume is audited, but needs separate curved-CAD QA.
    """
    spec.validate(include_upper)
    s = spec
    angles, directions, gaps = angular_seeds(s, theta_deg, directions_xy)
    zlow = np.linspace(s.bottom, s.step, s.lower_layers + 1)
    zupper = np.linspace(s.step, s.top, s.upper_layers + 1)
    flat = upper_inner_radii is None and lower_inner_radii is None
    inner = np.full(len(zupper), s.step_inner) if upper_inner_radii is None else np.asarray(upper_inner_radii, dtype=float)
    if (inner.shape != zupper.shape or not np.isfinite(inner).all()
            or abs(inner[0] - s.step_inner) > 1e-12
            or np.any(inner <= 0) or np.any(inner >= s.outer)):
        raise ValueError('Invalid upper inner-radius profile or nonmatching step interface')
    lower_field = (np.full((len(zlow), s.circumferential), s.lower_inner) if lower_inner_radii is None
             else np.asarray(lower_inner_radii, dtype=float))
    if (lower_field.shape != (len(zlow), s.circumferential) or not np.isfinite(lower_field).all()
            or np.any(lower_field <= 0) or np.any(lower_field >= s.step_inner)
            or np.max(abs(lower_field[-1] - s.lower_inner)) > 1e-9):
        raise ValueError('Invalid lower inner-radius field or nonmatching shoulder ledge')
    equator_radii = np.linspace(s.step_inner, s.outer, s.wall_radial + 1)
    exact_equator = None
    if equator_coordinates is not None:
        exact_equator = np.asarray(equator_coordinates, dtype=float)
        expected = np.zeros((s.wall_radial + 1, s.circumferential, 3))
        expected[:, :, :2] = equator_radii[:, None, None] * directions
        expected[:, :, 2] = s.step
        if (exact_equator.shape != expected.shape or not np.isfinite(exact_equator).all()
                or np.max(abs(exact_equator - expected)) > 1e-12):
            raise ValueError('equator_coordinates must match the ordered shoulder radii/directions/Z')
    nr = s.ledge_radial + s.wall_radial
    lower_r = np.r_[np.linspace(s.lower_inner, s.step_inner, s.ledge_radial + 1),
                    np.linspace(s.step_inner, s.outer, s.wall_radial + 1)[1:]]
    zs = np.r_[zlow, zupper[1:]] if include_upper else zlow
    points, lookup = [], {}
    for k, z in enumerate(zs):
        indices = range(nr + 1) if k <= s.lower_layers else range(s.ledge_radial, nr + 1)
        for j in indices:
            for i in range(s.circumferential):
                if k <= s.lower_layers:
                    radius = (lower_field[k, i] + (s.step_inner - lower_field[k, i]) * j / s.ledge_radial
                              if j <= s.ledge_radial else lower_r[j])
                else:
                    radius = inner[k - s.lower_layers] + (s.outer - inner[k - s.lower_layers]) * (j - s.ledge_radial) / s.wall_radial
                point = (radius * directions[i, 0], radius * directions[i, 1], z)
                if k == s.lower_layers and j >= s.ledge_radial and exact_equator is not None:
                    point = exact_equator[j - s.ledge_radial, i]
                lookup[k, j, i] = len(points)
                points.append(point)

    def node(k, j, i):
        return lookup[k, j, i % s.circumferential]

    surfaces = {name: [] for name in ('bottom-cut', 'top-cut', 'outer-cut',
                                      'lower-bore', 'ledge', 'upper-bore', 'dome-equator')}
    interfaces = dict(ledge_to_lower_wall=[])
    if include_upper:
        interfaces['lower_to_upper_wall'] = []
    elements, regions = [], []
    for k in range(len(zs) - 1):
        lower = k < s.lower_layers
        for j in range(0 if lower else s.ledge_radial, nr):
            for i in range(s.circumferential):
                e = np.array([node(k, j, i), node(k, j + 1, i), node(k, j + 1, i + 1), node(k, j, i + 1),
                              node(k + 1, j, i), node(k + 1, j + 1, i),
                              node(k + 1, j + 1, i + 1), node(k + 1, j, i + 1)], dtype=np.int64)
                elements.append(e)
                regions.append('LEDGE' if j < s.ledge_radial else 'LOWER_WALL' if lower else 'UPPER_WALL')
                if k == 0:
                    surfaces['bottom-cut'].append(e[FACES[0]])
                if include_upper and k == len(zs) - 2:
                    surfaces['top-cut'].append(e[FACES[1]])
                if j == nr - 1:
                    surfaces['outer-cut'].append(e[FACES[3]])
                if lower and j == 0:
                    surfaces['lower-bore'].append(e[FACES[5]])
                if not lower and j == s.ledge_radial:
                    surfaces['upper-bore'].append(e[FACES[5]])
                if k == s.lower_layers - 1 and j < s.ledge_radial:
                    surfaces['ledge'].append(e[FACES[1]])
                if not include_upper and k == s.lower_layers - 1 and j >= s.ledge_radial:
                    surfaces['dome-equator'].append(e[FACES[1]])
                if lower and j == s.ledge_radial - 1:
                    interfaces['ledge_to_lower_wall'].append(e[FACES[3]])
                if include_upper and k == s.lower_layers - 1 and j >= s.ledge_radial:
                    interfaces['lower_to_upper_wall'].append(e[FACES[1]])
    mesh = Mesh3D('CAP_INNER_SHOULDER_LOCAL')
    mesh.nodes, mesh.elems = np.array(points), np.array(elements)
    mesh.regions, mesh.region_names = regions, sorted(set(regions))
    mesh.surfaces = {name: np.array(faces, dtype=np.int64) for name, faces in surfaces.items() if faces}
    mesh.shoulder_node_rings = np.array([[node(s.lower_layers, j, i) for i in range(s.circumferential)]
                                       for j in range(s.ledge_radial, nr + 1)])
    mesh.interface_faces = {name: np.array(faces, dtype=np.int64) for name, faces in interfaces.items()}
    quality, boundary = audit_h8(mesh.nodes, mesh.elems, expected_euler=0)
    labelled = np.concatenate(list(mesh.surfaces.values()))
    if {tuple(sorted(f)) for f in labelled} != {tuple(sorted(f)) for f in boundary} or len(labelled) != len(boundary):
        raise ValueError('Shoulder boundary labels do not exactly cover the free-face complex')
    interface_report, mesh.interface_owners = _interface_audit(mesh, mesh.interface_faces,
        dict(ledge_to_lower_wall={'LEDGE', 'LOWER_WALL'}, lower_to_upper_wall={'LOWER_WALL', 'UPPER_WALL'}))
    # Independent P1 boundary-loop integration, valid for nonuniform angles
    # and a theta/Z-dependent bore. Simpson is exact for these quadratic areas.
    def area(radius):
        xy = np.asarray(radius)[..., None] * directions
        after = np.roll(xy, -1, axis=0)
        return .5 * float(np.sum(xy[:, 0] * after[:, 1] - xy[:, 1] * after[:, 0]))

    outer_area = area(np.full(s.circumferential, s.outer))
    discrete_volume = 0.0
    bands = [(zlow, lower_field)]
    if include_upper:
        bands.append((zupper, np.repeat(inner[:, None], s.circumferential, axis=1)))
    for levels, bore in bands:
        for k, height in enumerate(np.diff(levels)):
            discrete_volume += height * (outer_area - (area(bore[k])
                + 4 * area((bore[k] + bore[k + 1]) / 2) + area(bore[k + 1])) / 6)
    conservation = abs(quality['volume'] - discrete_volume) / discrete_volume
    if conservation > 1e-10:
        raise ValueError(f'Shoulder discrete volume conservation failed: {conservation}')
    radial_integral = (s.outer**2 - s.lower_inner**2) * (s.step - s.bottom)
    if include_upper:
        radial_integral += (s.outer**2 - s.step_inner**2) * (s.top - s.step)
    circle_volume = float(math.pi * radial_integral) if flat else None
    circle_error = abs(quality['volume'] - circle_volume) / circle_volume if flat else None
    if flat and circle_error > 1e-4:
        raise ValueError(f'Analytic stepped-annulus volume error {circle_error} exceeds 1e-4')
    report = dict(schemaVersion=1, purpose='inner-shoulder-local-H8', spec=asdict(s),
                  quality=quality, interfaces=interface_report, angularSeamSharesNodeIds=True,
                  exactDiscreteReferenceVolumeMm3=discrete_volume, relativeDiscreteVolumeError=conservation,
                  analyticCircularVolumeMm3=circle_volume, relativeAnalyticCircularVolumeError=circle_error,
                  includeUpper=include_upper, thetaDeg=angles.tolist(), equatorRadiiMm=equator_radii.tolist(),
                  maximumAngularGapDeg=float(np.rad2deg(gaps).max()),
                  lowerBoreRadiusRangeMm=[float(lower_field.min()), float(lower_field.max())],
                  fullModelAcceptance=False, localConnectivityAccepted=True,
                  curvedCadMatchingAudited=False,
                  artificialCuts=['bottom-cut', 'top-cut' if include_upper else 'dome-equator', 'outer-cut'])
    mesh.dims = report
    return mesh, report


def build_m6_shoulder(shape, spec=ShoulderSpec(), *, lower_boundary='original-bore',
                      theta_deg=None, directions_xy=None, include_upper=True,
                      equator_coordinates=None):
    """Compare the actual source-CAD clipped domain, including the real ledge.

    Refuses helical/outer-ledge overlap instead of smoothing or filling it.
    Original surfaces: actual trimmed runout bore, ledge and inner dome sphere.
    The original-bore mode queries the saved BRep, never a nominal cylinder.
    An explicit artificial-cut mode clips an inner cylinder as well, so that
    successful local delivery never implies a matching original thread wall.
    """
    spec.validate(include_upper)
    angles, directions, _ = angular_seeds(spec, theta_deg, directions_xy)
    if lower_boundary not in ('original-bore', 'artificial-cut'):
        raise ValueError('Choose original-bore or artificial-cut lower boundary')
    s = spec
    from build123d import Align, Cylinder, Pos
    from OCP.BRepClass3d import BRepClass3d_SolidClassifier
    from OCP.gp import gp_Pnt
    from OCP.TopAbs import TopAbs_IN
    from .cad_cap_plan import spherical_cap
    from .cad_mesh import RadialCad
    from .standard_cad import _mass

    cap = spherical_cap(shape)
    if (abs(cap['joinZMm'] - s.step) > 1e-7 or abs(cap['inner']['radiusMm'] - s.step_inner) > 1e-7
            or s.top - s.step >= s.step_inner):
        raise ValueError('Matching gap: selected step/inner sphere does not match the actual CAD')
    faces = list(shape.faces())
    sampler = None
    lower_field = None
    if lower_boundary == 'original-bore':
        if abs(s.lower_inner - 3.0) > 1e-9:
            raise ValueError('Matching gap: original M6 runout requires nominal R=3, not an artificial cutoff')
        # A fixed-angle P1 chart cannot cover the lower radial planar thread
        # cap. Reject that topology before sampling/allocation, not by SJ waiver.
        termination_caps = []
        for f in faces:
            if f.geom_type.name != 'PLANE' or abs(f.normal_at().Z) > 1e-8:
                continue
            normal, point = f.normal_at(), f.center()
            if abs(normal.X * point.X + normal.Y * point.Y) < 1e-6:
                termination_caps.append(f.bounding_box().max.Z)
        if termination_caps and s.bottom <= max(termination_caps) + 1e-6:
            raise ValueError('Matching gap: crop crosses planar thread-termination cap; coupled runout planner needed')
        sampler = RadialCad(shape, hole=True)
        lower_field = np.array([[sampler.radii(float(theta), float(z))[0] for theta in angles]
                                for z in np.linspace(s.bottom, s.step, s.lower_layers + 1)[:-1]]
                               + [[s.lower_inner] * s.circumferential])
    zs = np.linspace(s.step, s.top, s.upper_layers + 1)
    profile = np.sqrt(s.step_inner**2 - (zs - s.step)**2)
    try:
        mesh, report = build_step_ring(s, profile, theta_deg=angles, directions_xy=directions,
            lower_inner_radii=lower_field, include_upper=include_upper, equator_coordinates=equator_coordinates)
    except ValueError as exc:
        raise ValueError(f'Matching gap: {exc}') from exc
    crop_top = s.top if include_upper else s.step
    tool = Pos(0, 0, s.bottom) * Cylinder(s.outer, crop_top - s.bottom,
                                       align=(Align.CENTER, Align.CENTER, Align.MIN))
    if lower_boundary == 'artificial-cut':
        tool = tool - Pos(0, 0, s.bottom) * Cylinder(s.lower_inner, crop_top - s.bottom,
                                        align=(Align.CENTER, Align.CENTER, Align.MIN))
    local = shape & tool
    if local is None or not local.is_valid or len(local.solids()) != 1:
        raise ValueError('Matching gap: source-CAD shoulder crop is not one valid solid')
    cad_volume = _mass(local)
    error = abs(report['quality']['volume'] - cad_volume) / cad_volume
    if error > 1e-4:
        raise ValueError(f'Matching gap: shoulder CAD/H8 volume error {error} exceeds 1e-4; '
                         'crop may include helical runout or outer-ledge topology')
    candidates = [i for i, f in enumerate(faces) if f.geom_type.name == 'PLANE']
    point = ((s.lower_inner + s.step_inner) / 2, 0, s.step)
    if not candidates:
        raise ValueError('Matching gap: no actual shoulder plane')
    ledge_id = min(candidates, key=lambda i: faces[i].distance_to(point))
    original = {'ledge': ledge_id, 'upper-bore': cap['inner']['face']}
    if lower_boundary == 'original-bore':
        original['lower-bore'] = None
    else:
        mesh.surfaces['lower-cut'] = mesh.surfaces.pop('lower-bore')
        report['artificialCuts'].append('lower-cut')
    matching = {}
    for name, quads in mesh.surfaces.items():
        ids = np.unique(quads)
        centers = mesh.nodes[quads].mean(axis=1)
        if name == 'lower-bore' and sampler is not None:
            # These are DIFFERENT gates: exact boundary nodes versus straight
            # H8 face-center approximation. Never test nodes with the .02 gate.
            node_error = max(sampler.surface_witness_distance(p, tolerance=2e-6) for p in mesh.nodes[ids])
            face_error = max(sampler.surface_witness_distance(p, tolerance=.02) for p in centers)
            matching[name] = dict(originalCadSurface=True, originalFace=None,
                method='saved-trimmed-BRep-runout', nodes=len(ids), faces=len(quads),
                maximumNodeDistanceMm=node_error, maximumFaceCenterDistanceMm=face_error,
                distanceStatistic='trimmed-face witness upper bound, not exhaustive nearest distance',
                nodeDistanceLimitMm=2e-6, faceCenterDistanceLimitMm=.02)
            continue
        if name in original:
            face = faces[original[name]]
            distance = lambda p: face.distance_to(tuple(p))
        elif name in ('outer-cut', 'lower-cut'):
            radius = s.outer if name == 'outer-cut' else s.lower_inner
            distance = lambda p: abs(math.hypot(p[0], p[1]) - radius)
        else:
            z = s.bottom if name == 'bottom-cut' else crop_top
            distance = lambda p: abs(p[2] - z)
        node_error = max(distance(p) for p in mesh.nodes[ids])
        face_error = max(distance(p) for p in centers)
        if node_error > 2e-6 or face_error > .02:
            raise ValueError(f'Matching gap: {name}: node={node_error}, faceCenter={face_error}')
        matching[name] = dict(originalCadSurface=name in original, originalFace=original.get(name),
                              nodes=len(ids), faces=len(quads), maximumNodeDistanceMm=node_error,
                              maximumFaceCenterDistanceMm=face_error)
    classifier = BRepClass3d_SolidClassifier(local.wrapped)
    for p in mesh.nodes[mesh.elems].mean(axis=1):
        classifier.Perform(gp_Pnt(*p), 1e-9)
        if classifier.State() != TopAbs_IN:
            raise ValueError('Matching gap: H8 centroid outside the exact source-CAD crop')
    source_shells = shape.shells()
    witnesses = {'bottom-cut': ((s.lower_inner + s.outer) / 2, 0, s.bottom),
                 'top-cut' if include_upper else 'dome-equator':
                    (((profile[-1] if include_upper else s.step_inner) + s.outer) / 2, 0, crop_top),
                 'outer-cut': (s.outer, 0, (s.bottom + crop_top) / 2)}
    if lower_boundary == 'artificial-cut':
        witnesses['lower-cut'] = (s.lower_inner, 0, (s.bottom + s.step) / 2)
    artificial = {name: dict(pointMm=list(p), distanceToOriginalCadMm=min(sh.distance_to(p) for sh in source_shells))
                  for name, p in witnesses.items()}
    if any(item['distanceToOriginalCadMm'] <= 2e-6 for item in artificial.values()):
        raise ValueError('Matching gap: a declared artificial cut overlaps original CAD at its interior witness')
    report.update(sourceCadPartitionVolumeMm3=cad_volume, relativeCadH8VolumeError=error,
                  curvedCadMatchingAudited=True, localCadPatchAccepted=True, boundaryMatching=matching,
                  artificialCutInteriorWitnesses=artificial, allElementCentroidsInCadCrop=True,
                  lowerBoundaryMode=lower_boundary,
                  originalRunoutFollowed=lower_boundary == 'original-bore',
                  gates=dict(minimumCornerScaledJacobian=.15, cadH8VolumeRelative=1e-4,
                             nodeDistanceMm=2e-6, faceCenterDistanceMm=.02),
                  limitations=['Inner shoulder crop only, not the whole Z=5 outer hex/dome ledge',
                               'Only the late runout above the lower planar termination cap is mapped',
                               'Artificial inner cutoff is used ONLY when lowerBoundaryMode=artificial-cut',
                               'Bottom/outer cuts and any upper cut need neighboring macros; full cap not joined',
                               'No complete cap nut, solver model or native-HM acceptance'])
    return mesh, local, report
