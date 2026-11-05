"""Real-bore M6 cap body below the dome, with nonuniform runout charts.

Only the dome equator is an artificial boundary. No R=3.1 bore crop, source
CAD deformation, proximity welding, or extension above the join is performed.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import math
import numpy as np

from .cad_runout import NutRunoutMap
from .mesh_audit import audit_h8
from .mesh_core import Mesh3D

MAX_H8 = 300_000


@dataclass(frozen=True)
class BodySpec:
    spacing: float = .04
    lead_degrees: float = 10.
    half_window: float = 45.
    axial_support: float = .21
    inner_layers: int = 2
    outer_layers: int = 1
    element_limit: int = MAX_H8

    def validate(self):
        for name in ('spacing', 'lead_degrees', 'half_window', 'axial_support'):
            value = getattr(self, name)
            if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
                raise ValueError(f'Positive finite body parameter required: {name}')
        if not self.lead_degrees < self.half_window < 90:
            raise ValueError('Require lead_degrees < half_window < 90')
        for name in ('inner_layers', 'outer_layers', 'element_limit'):
            if type(getattr(self, name)) is not int or getattr(self, name) < 1:
                raise ValueError(f'Positive integer body parameter required: {name}')
        if self.inner_layers > 8 or self.outer_layers > 8 or self.element_limit > MAX_H8:
            raise ValueError('Body allocation budget exceeded')


def _angles(theta_deg):
    raw = np.asarray(theta_deg)
    if raw.ndim != 1 or len(raw) < 96 or raw.dtype.kind not in 'fiu' or not np.isfinite(raw).all():
        raise ValueError('Require at least 96 finite nonuniform reference angles')
    raw = raw.astype(float)
    if raw[0] < 0 or raw[-1] >= 360 or np.any(np.diff(raw) <= 1e-10):
        raise ValueError('Angles must be unique increasing degrees in [0,360)')
    if np.max(np.diff(np.r_[raw, raw[0]+360])) >= 180:
        raise ValueError('Reference angles must cover a complete revolution')
    return raw.copy()


class NonuniformNutRunoutMap(NutRunoutMap):
    """Reuse original CAD cap detection/jump/features, not uniform indexing.

    Each cap owns an actual pair of adjacent reference seeds. Local spacing
    controls unsnapping; the angular chart returns to identity at BOTH body
    ends even when a cap lies less than one pitch from an end.
    """

    def __init__(self, sampler, theta_deg, pitch=1., *, lead_degrees=10.,
                 half_window=45., axial_support=.21):
        angles = _angles(theta_deg)
        spec = BodySpec(lead_degrees=lead_degrees, half_window=half_window,
                        axial_support=axial_support)
        spec.validate()
        if type(pitch) not in (int, float) or not math.isfinite(pitch) or pitch <= 0:
            raise ValueError('Positive finite runout pitch required')
        super().__init__(sampler, len(angles), pitch, lead_degrees, half_window)
        self.angles = angles
        self.axial_support = axial_support
        for cap in self.caps:
            c = cap['theta']
            refs = c+(angles-c+180) % 360-180
            order = np.argsort(refs)
            ordered = refs[order]
            target = c-math.copysign(lead_degrees, cap['jumpSign'])
            right = int(np.searchsorted(ordered, target, side='right'))
            if right == 0 or right == len(ordered):
                raise ValueError('Runout reference pair cannot be bracketed')
            ia, ib = map(int, order[right-1:right+1])
            cap.update(refA=float(refs[ia]), refB=float(refs[ib]), indexA=ia, indexB=ib,
                       supportBelow=min(axial_support, cap['zmin']-sampler.zmin),
                       supportAbove=min(axial_support, sampler.zmax-cap['zmax']))
            if min(cap['supportBelow'], cap['supportAbove']) <= 1e-8:
                raise ValueError('Runout cap must lie strictly inside the body ends')

    def _weight(self, cap, z):
        if z < cap['zmin']:
            t = 1-(cap['zmin']-z)/cap['supportBelow']
        elif z > cap['zmax']:
            t = 1-(z-cap['zmax'])/cap['supportAbove']
        else:
            return 1.
        t = max(0., min(1., t))
        return t*t*(3-2*t)

    def axial_features(self):
        # Parent detects actual cap vertex levels and the one-sided snap roots.
        features = super().axial_features()
        for cap in self.caps:
            features.extend((cap['zmin']-cap['supportBelow'], cap['zmax']+cap['supportAbove']))
        return sorted(set(features))

    def boundaries(self, z):
        key = round(float(z), 11)
        if key in self.cache:
            return self.cache[key]
        physical = self.angles.copy()
        prescribed = {}
        for cap in self.caps:
            weight = self._weight(cap, z)
            if weight == 0:
                continue
            before, after = self._jump(cap, z)
            snap = min(1., abs(after-before)/self.snap_height)
            half_gap = (cap['refB']-cap['refA'])/2
            if half_gap*(1-snap) < 1e-5:
                snap = 1.
            delta = half_gap*(1-snap)
            c, a, b, window = (cap[k] for k in ('theta', 'refA', 'refB', 'window'))
            refs = c+(self.angles-c+180) % 360-180
            selected = (refs >= a-window) & (refs <= b+window)
            mapped = np.interp(refs[selected], [a-window, a, b, b+window],
                               [a-window, c-delta, c+delta, b+window])
            physical[selected] += weight*(mapped-refs[selected])
            if snap >= 1-1e-10 and weight >= 1-1e-10:
                prescribed[cap['indexA']] = (c, before)
                prescribed[cap['indexB']] = (c, after)
        outer, inner = [], []
        for i, theta in enumerate(self.angles):
            a = math.radians(theta)
            r = self.sampler.radii(float(theta), z)[1]
            outer.append((r*math.cos(a), r*math.sin(a)))
            if i in prescribed:
                theta, r = prescribed[i]
            else:
                theta = physical[i]
                r = self.sampler.radii(float(theta), z)[0]
            a = math.radians(theta)
            point = (r*math.cos(a), r*math.sin(a))
            if i in prescribed:
                distance = self.sampler.surface_witness_distance((*point, z))
                self.maximum_snapped_distance = max(self.maximum_snapped_distance, distance)
                self.snapped_nodes += 1
            inner.append(point)
        result = np.array(outer), np.array(inner)
        self.cache[key] = result
        return result

    def section_xy(self, section, z):
        raise ValueError('Use indexed rings; uniform-angle section lookup is not supported')

    def report(self):
        return dict(super().report(), mode='nonuniform-planar-radial-cap-reparameterization',
                    thetaDeg=self.angles.tolist(), axialSupportMm=self.axial_support,
                    endAnglesIdentity=True, legacyM8PathUnmodified=True)


def _equator(interface):
    angles = _angles(interface['thetaDeg'])
    coordinates = np.asarray(interface['coordinates'], dtype=float)
    radii = np.asarray(interface['radiiMm'], dtype=float)
    center = np.asarray(interface['centerMm'], dtype=float)
    if (center.shape != (3,) or not np.isfinite(center).all() or np.max(abs(center[:2])) > 1e-12
            or abs(center[2]-5.) > 1e-10 or radii.ndim != 1 or len(radii) < 2
            or not np.isfinite(radii).all() or np.any(np.diff(radii) <= 0)
            or abs(radii[0]-3.75) > 1e-10 or abs(radii[-1]-4.75) > 1e-10
            or coordinates.shape != (len(radii), len(angles), 3) or not np.isfinite(coordinates).all()):
        raise ValueError('Require the actual centered M6 dome equatorial rings at Z=5')
    expected = radii[:, None, None]*np.stack((np.cos(np.deg2rad(angles)), np.sin(np.deg2rad(angles))), axis=1)
    if np.max(abs(coordinates[:, :, :2]-expected)) > 1e-12 or np.max(abs(coordinates[:, :, 2]-5.)) > 1e-12:
        raise ValueError('Dome coordinates disagree with equatorial reference angles/radii')
    return angles, coordinates.copy(), radii.copy()


def body_rings(mapping, z, interface, spec=BodySpec()):
    """Reference-theta fixed outside the two-layer warped bore band."""
    spec.validate()
    angles, eq, radii = _equator(interface)
    if not np.array_equal(angles, mapping.angles):
        raise ValueError('Body and dome angle ownership differ')
    outer, inner = mapping.boundaries(z)
    fixed = eq[:, :, :2]
    rings = [inner+(fixed[0]-inner)*(j/spec.inner_layers) for j in range(spec.inner_layers)]
    rings.extend(fixed)
    rings.extend(fixed[-1]+(outer-fixed[-1])*(j/spec.outer_layers) for j in range(1, spec.outer_layers+1))
    result = np.zeros((len(rings), len(angles), 3))
    result[:, :, :2] = rings
    result[:, :, 2] = z
    if z == 5.:
        result[spec.inner_layers:spec.inner_layers+len(eq)] = eq
    return result


def body_equatorial_interface(mesh):
    """Exact +Z node rings/faces, directly consumable by join_interfaces."""
    rings = mesh.body_equatorial_rings.copy()
    return dict(thetaDeg=mesh.dims['thetaDeg'], nodeRings=rings,
                coordinates=mesh.nodes[rings].copy(), faces=mesh.surfaces['dome-equator'].copy(),
                radiiMm=mesh.dims['equatorRadiiMm'], centerMm=[0., 0., 5.],
                outwardNormal='+Z', indexBase=0)


def body_preflight(shape, interface, spec=BodySpec()):
    """CAD crop and seed plan, before full-body H8 allocation."""
    spec.validate()
    angles, _, radii = _equator(interface)
    from build123d import Solid
    from .cad_mesh import RadialCad, _z_layers
    from .standard_cad import _mass
    if not shape.is_valid or len(shape.solids()) != 1:
        raise ValueError('Require one valid source CAD solid')
    b = shape.bounding_box()
    if abs(min(v.Z for v in shape.vertices())) > 2e-6:
        raise ValueError('Body entry must be source CAD Z=0')
    extent = 2*max(abs(b.min.X), abs(b.max.X), abs(b.min.Y), abs(b.max.Y), 10.)
    local = shape & Solid.make_box(2*extent, 2*extent, 5.).translate((-extent, -extent, 0.))
    if local is None or not local.is_valid or len(local.solids()) != 1:
        raise ValueError('Body CAD partition is not one valid solid')
    sampler = RadialCad(local, True)
    mapping = NonuniformNutRunoutMap(sampler, angles, lead_degrees=spec.lead_degrees,
                                    half_window=spec.half_window, axial_support=spec.axial_support)
    if len(mapping.caps) != 2:
        raise ValueError('M6 body expects two independently detected faded radial caps')
    # Include the actual outer bevel extrema, not a mesh-dependent CAD trim.
    features = list(mapping.axial_features())
    for face in local.faces():
        if face.geom_type.name == 'CONE':
            features.extend(v.Z for v in face.vertices())
    zs = _z_layers(0., 5., spec.spacing, features)
    layers = spec.inner_layers+len(radii)-1+spec.outer_layers
    count = len(angles)*layers*(len(zs)-1)
    if count > spec.element_limit:
        raise ValueError(f'Body needs {count} H8, above {spec.element_limit}')
    plan = dict(elements=count, axialLayers=len(zs)-1, radialLayers=layers,
                circumferential=len(angles), sourceCadPartitionVolume=_mass(local),
                zPlanesMm=zs.tolist(), capMapping=mapping.report(),
                domainZMm=[0., 5.], artificialBoreCrop=False, spec=asdict(spec))
    return local, mapping, zs, plan


def _connect(count, rings, layers):
    i = np.arange(count)
    j = (i+1) % count
    # Radial then CCW makes the swept H8 orientation positive.
    quads = np.concatenate([np.column_stack((i+k*count, i+(k+1)*count,
                                             j+(k+1)*count, j+k*count)) for k in range(rings-1)])
    size = count*rings
    return np.concatenate([np.column_stack((quads+k*size, quads+(k+1)*size)) for k in range(layers)])


def _source_distances(shape, points, tolerance, progress=None, kind='nodes'):
    """Trimmed-face witnesses, with vectorized bounding-box rejection only."""
    faces = list(shape.faces())
    boxes = [f.bounding_box() for f in faces]
    low = np.array([tuple(b.min) for b in boxes])
    high = np.array([tuple(b.max) for b in boxes])
    sizes = np.prod(np.maximum(high-low, 1e-10), axis=1)
    maximum = 0.
    for begin in range(0, len(points), 2048):
        chunk = points[begin:begin+2048]
        lower = np.maximum(np.maximum(low-chunk[:, None, :], chunk[:, None, :]-high), 0.)
        near = np.linalg.norm(lower, axis=2) <= tolerance
        for point, candidates in zip(chunk, near):
            ids = np.flatnonzero(candidates)
            distance = float('inf')
            for i in ids[np.argsort(sizes[ids])]:
                distance = min(distance, faces[i].distance_to(tuple(point)))
                if distance <= tolerance:
                    break
            if distance > tolerance:
                # Resolve the actual negative distance even when no nearby
                # bounding box survived; a failed query is never a pass.
                distance = min(f.distance_to(tuple(point)) for f in faces)
                if distance > tolerance:
                    raise ValueError(f'Body source CAD {kind} distance {distance} exceeds {tolerance} mm at {point.tolist()}')
            maximum = max(maximum, distance)
        if progress is not None:
            progress(kind, min(begin+len(chunk), len(points)), len(points), maximum)
    return maximum


def build_cad_body(shape, interface, spec=BodySpec(), *, prepared=None, progress=None):
    """Build and gate the complete open annular body; failures are not passes.

    Pass equatorial_interface(build_cad_dome(shape)[0]) as ``interface``.
    ``prepared`` may reuse body_preflight's live CAD sampler and sample cache;
    it is not a serialized geometry certificate. The returned mesh exposes
    body_equatorial_interface(mesh) for an exact, oppositely oriented join.
    """
    local, mapping, zs, plan = body_preflight(shape, interface, spec) if prepared is None else prepared
    spec.validate()
    angles, eq, radii = _equator(interface)
    count = len(angles)
    ring_count = spec.inner_layers+len(radii)+spec.outer_layers
    allocation = count*(ring_count-1)*(len(zs)-1)
    if (allocation != plan['elements'] or allocation > spec.element_limit
            or not np.array_equal(angles, mapping.angles) or zs[0] != 0. or zs[-1] != 5.
            or not np.isfinite(zs).all() or np.any(np.diff(zs) <= 0)):
        raise ValueError('Body prepared allocation mismatch')
    nodes = np.concatenate([body_rings(mapping, float(z), interface, spec).reshape(-1, 3) for z in zs])
    cells = _connect(count, ring_count, len(zs)-1)
    quality, boundary = audit_h8(nodes, cells, expected_euler=0)
    cad_volume = plan['sourceCadPartitionVolume']
    volume_error = abs(quality['volume']-cad_volume)/cad_volume
    if volume_error > 1e-4:
        raise ValueError(f'Body CAD/H8 volume error {volume_error} exceeds 1e-4')
    mesh = Mesh3D('CAD_CAP_BODY')
    mesh.nodes, mesh.elems = nodes, cells
    mesh.regions = ['BODY']*len(cells)
    mesh.region_names = ['BODY']
    top = (len(zs)-1)*count*ring_count
    rings = top+np.arange(spec.inner_layers*count, (spec.inner_layers+len(radii))*count).reshape(len(radii), count)
    faces = np.concatenate([np.column_stack((rings[k], rings[k+1], np.roll(rings[k+1], -1), np.roll(rings[k], -1)))
                            for k in range(len(rings)-1)])
    mesh.body_equatorial_rings = rings
    mesh.surfaces = {'dome-equator': faces}
    report = dict(schemaVersion=1, purpose='complete-real-bore-cap-body', fullBody=True,
                  fullCapNut=False, fullModelAcceptance=False, quality=quality,
                  sourceCadPartitionVolume=cad_volume, relativeCadH8VolumeError=volume_error,
                  thetaDeg=angles.tolist(), equatorRadiiMm=radii.tolist(), plan=plan,
                  sourceCadUnmodified=True, partitionIndependentOfMeshSeeds=True,
                  artificialInterfaces=['dome-equator'], domainZMm=[0., 5.],
                  interfaceCoordinatesBitwiseEqual=bool(np.array_equal(nodes[rings], eq)))
    mesh.dims = report
    if not report['interfaceCoordinatesBitwiseEqual']:
        raise ValueError('Body changed the actual dome equator')
    interface_keys = {tuple(sorted(f)) for f in faces}
    boundary_keys = {tuple(sorted(f)) for f in boundary}
    if len(interface_keys) != len(faces) or not interface_keys <= boundary_keys:
        raise ValueError('Body equator is not a free boundary')
    def cycle(face):
        f = tuple(map(int, face))
        return min(f[i:]+f[:i] for i in range(4))
    actual = {tuple(sorted(f)): cycle(f) for f in boundary if tuple(sorted(f)) in interface_keys}
    if any(actual[tuple(sorted(f))] != cycle(f) for f in faces):
        raise ValueError('Body interface cycle differs from actual outward H8 boundary')
    report.update(equatorialInterfaceFaces=len(faces), equatorialInterfaceNodes=int(rings.size),
                  interfaceEveryFaceOneActualH8Owner=True, interfaceCyclesMatchActualH8Boundary=True)
    physical = np.asarray([f for f in boundary if tuple(sorted(f)) not in interface_keys])
    # These are separate gates against actual trimmed SOURCE faces. The
    # artificial equatorial cut is intentionally excluded from source QA.
    node_distance = _source_distances(shape, nodes[np.unique(physical)], 2e-6, progress, 'nodes')
    face_distance = _source_distances(shape, nodes[physical].mean(axis=1), .02, progress, 'face-centers')
    report.update(maximumBoundaryNodeDistanceMm=node_distance,
                  maximumBoundaryFaceCenterDistanceMm=face_distance,
                  boundaryNodeLimitMm=2e-6, boundaryFaceCenterLimitMm=.02,
                  sourceBoundaryNodesChecked=len(np.unique(physical)), sourceBoundaryFacesChecked=len(physical),
                  surfaceWitnessMethod='trimmed source CAD face witness upper bound, not exhaustive nearest; separate node/face-center gates',
                  runoutMapping=mapping.report(), bodyAccepted=True)
    return mesh, local, report
