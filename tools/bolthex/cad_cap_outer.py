"""Source-CAD outer shoulder band with an unchanged cylindrical inner port.

The inner port is copied exactly from the late-runout shoulder. Outer ray
angles are monotonically anchored to six hex-corner rays; only the OUTER
axial stations are warped toward the cone/plane intersection. This avoids
collapsing two angular columns at a tangent termination. Small support-switch
faces remain and are explicitly counted, not certified as crease-conformal.
"""
from __future__ import annotations

import math
import numpy as np

from .mesh_audit import FACES, audit_h8
from .mesh_core import Mesh3D

MAX_H8 = 30_000


def _cycle(face):
    values = tuple(int(n) for n in face)
    return min(values[i:]+values[:i] for i in range(4))


def _assert_boundary_cycles(mesh, faces):
    """Each record must be an actual outward H8 face with ONE boundary owner."""
    if mesh.elems is None or mesh.elems.ndim != 2 or mesh.elems.shape[1] != 8:
        raise ValueError('Boundary contract requires actual H8 connectivity')
    keys = [tuple(sorted(f)) for f in faces]
    if len(set(keys)) != len(keys) or any(len(set(f)) != 4 for f in faces):
        raise ValueError('Duplicate or degenerate boundary face records')
    owners = {key:[] for key in keys}
    for eid, e in enumerate(mesh.elems):
        for face in e[FACES]:
            key = tuple(sorted(face))
            if key in owners:
                owners[key].append((eid, _cycle(face)))
    result = []
    for key, face in zip(keys, faces):
        actual = owners[key]
        if len(actual) != 1:
            raise ValueError('Each component side must have exactly one boundary owner')
        if _cycle(face) != actual[0][1]:
            raise ValueError('Boundary metadata must follow the actual outward H8 face cycle')
        result.append(actual[0][0])
    return np.array(result, dtype=np.int64)


def outer_wall_interface(mesh, faces=None, theta_deg=None):
    """Extract a radial-major +R port, preserving all source IDs/coordinates.

    Rings are axial-major, unlike the Dome equator's radial-major rings.
    Pass explicit free faces when extracting from an already assembled model.
    No tolerance weld, closest-node search or coordinate projection is used.
    """
    faces = np.asarray(mesh.surfaces['outer-cut'] if faces is None else faces)
    if faces.ndim != 2 or faces.shape[1] != 4 or not len(faces) or faces.dtype.kind not in 'iu':
        raise ValueError('Require nonempty source outer-wall quads')
    if faces.min() < 0 or faces.max() >= len(mesh.nodes):
        raise ValueError('Invalid source outer-wall node IDs')
    ids = np.unique(faces)
    levels = np.unique(mesh.nodes[ids, 2])
    supplied = theta_deg if theta_deg is not None else getattr(mesh, 'dims', {}).get('thetaDeg')
    start = math.radians(supplied[0]) if supplied is not None else 0.0
    rows = []
    for z in levels:
        row = ids[mesh.nodes[ids, 2] == z]
        angles = np.mod(np.arctan2(mesh.nodes[row, 1], mesh.nodes[row, 0]) - start, math.tau)
        # Numerical signed zero at the cyclic start must not rotate one row.
        angles[np.abs(angles-math.tau) < 1e-12] = 0
        rows.append(row[np.argsort(angles)])
    if len(rows) < 3 or len({len(r) for r in rows}) != 1:
        raise ValueError('Source outer-wall port is not a rectangular axial/angular grid')
    rings = np.array(rows, dtype=np.int64)
    count = rings.shape[1]
    ordered = np.array([[rings[k, i], rings[k, (i+1)%count], rings[k+1, (i+1)%count], rings[k+1, i]]
                        for k in range(len(rows)-1) for i in range(count)])
    if (len(ordered) != len(faces)
            or {tuple(sorted(f)) for f in ordered} != {tuple(sorted(f)) for f in faces}):
        raise ValueError('Source outer-wall quads do not match the ordered grid')
    _assert_boundary_cycles(mesh,faces)
    # Reordering records is allowed, changing their directed cycles is not.
    source_owners = _assert_boundary_cycles(mesh,ordered)
    theta = (np.rad2deg(np.mod(np.arctan2(mesh.nodes[rings[0], 1], mesh.nodes[rings[0], 0]), math.tau))
             if supplied is None else np.asarray(supplied, dtype=float))
    result = dict(thetaDeg=theta.tolist(), nodeRings=rings, coordinates=mesh.nodes[rings].copy(),
                  faces=ordered, zLevelsMm=levels.tolist(), outwardNormal='+R', indexBase=0,
                  faceOwners=source_owners,
                  actualBoundaryCyclesVerified=True, exactlyOneOwnerPerComponent=True)
    _validate_port(result, 2)
    return result


def _validate_port(port, radial):
    if type(radial) is not int or not 1 <= radial <= 8:
        raise ValueError('Outer radial cells must be an integer in [1,8]')
    xyz = np.asarray(port['coordinates'], dtype=float)
    theta = np.asarray(port['thetaDeg'], dtype=float)
    if (xyz.ndim != 3 or xyz.shape[2] != 3 or xyz.shape[0] < 3 or xyz.shape[0] > 65
            or not 96 <= xyz.shape[1] <= 1024 or theta.shape != (xyz.shape[1],)
            or not np.isfinite(xyz).all() or not np.isfinite(theta).all()):
        raise ValueError('Require a finite axial/angular cylindrical port')
    rings = np.asarray(port['nodeRings'])
    faces = np.asarray(port['faces'])
    if (rings.shape != xyz.shape[:2] or rings.dtype.kind not in 'iu' or rings.min() < 0
            or len(np.unique(rings)) != rings.size or faces.dtype.kind not in 'iu'
            or faces.shape != ((xyz.shape[0]-1)*xyz.shape[1],4)):
        raise ValueError('Require unique source node IDs and a complete quadrilateral port')
    count = (xyz.shape[0]-1)*xyz.shape[1]*radial
    if count > MAX_H8:
        raise ValueError(f'Outer band budget {count} exceeds {MAX_H8} H8')
    angles = np.unwrap(np.radians(theta))
    gaps = np.diff(np.r_[angles, angles[0]+math.tau])
    if np.any(gaps <= 1e-12) or np.any(gaps >= math.pi):
        raise ValueError('Port angles must be unique cyclic CCW seeds')
    levels = xyz[:, 0, 2]
    radius = np.linalg.norm(xyz[:, :, :2], axis=2)
    inner = float(radius.mean())
    if (np.any(np.diff(levels) <= 1e-8) or np.max(abs(xyz[:, :, 2]-levels[:, None])) > 1e-12
            or inner <= 0 or np.max(abs(radius-inner)) > 1e-10):
        raise ValueError('Port must retain exact axial levels and one inner cylinder')
    actual = np.arctan2(xyz[:, :, 1], xyz[:, :, 0])
    if np.max(abs((actual-angles[None, :]+math.pi)%math.tau-math.pi)) > 1e-10:
        raise ValueError('Port angles disagree with original coordinates')
    return xyz, angles, levels, inner


def anchor_outer_angles(angles, corner_rays):
    """Small periodic monotone map, linear in ANGLE, never in node index."""
    angles = np.asarray(angles, dtype=float)
    rays = np.asarray(corner_rays, dtype=float)
    indices = np.array([np.argmin(abs((angles-ray+math.pi)%math.tau-math.pi)) for ray in rays])
    if len(np.unique(indices)) != len(indices):
        raise ValueError('Hex ray anchors collide; a different outer chart is required')
    targets = angles[indices]+(rays-angles[indices]+math.pi)%math.tau-math.pi
    order = np.argsort(indices)
    indices, targets = indices[order], targets[order]
    xp = np.r_[angles[indices[-1]]-math.tau, angles[indices], angles[indices[0]]+math.tau]
    fp = np.r_[targets[-1]-math.tau, targets, targets[0]+math.tau]
    if np.any(np.diff(xp) <= 0) or np.any(np.diff(fp) <= 0):
        raise ValueError('Hex anchor order is not monotone')
    mapped = np.interp(angles, xp, fp)
    if np.any(np.diff(np.r_[mapped, mapped[0]+math.tau]) <= 1e-12):
        raise ValueError('Outer angle reparameterization folded')
    return mapped, indices, targets


def _supports(shape, low, high, inner):
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    if not shape.is_valid or len(shape.solids()) != 1:
        raise ValueError('Outer band requires one valid source CAD solid')
    planes, cones, dome_radii = [], [], []
    for face in shape.faces():
        if face.geom_type.name == 'SPHERE':
            sphere = BRepAdaptor_Surface(face.wrapped).Sphere()
            p = sphere.Location()
            if math.hypot(p.X(),p.Y()) < 1e-7 and abs(p.Z()-high) < 1e-7:
                dome_radii.append(sphere.Radius())
        if face.geom_type.name == 'PLANE':
            normal, point = face.normal_at(), face.center()
            d = normal.X*point.X+normal.Y*point.Y
            if abs(normal.Z) < 1e-8 and d > inner+1e-4:
                item = (math.atan2(normal.Y, normal.X)%math.tau, float(d))
                if not any(abs((item[0]-p[0]+math.pi)%math.tau-math.pi) < 1e-8 for p in planes):
                    planes.append(item)
        if face.geom_type.name == 'CONE':
            bounds = face.bounding_box()
            if bounds.min.Z > low+1e-7 or bounds.max.Z < high-1e-7:
                continue
            cone = BRepAdaptor_Surface(face.wrapped).Cone()
            axis, p = cone.Axis().Direction(), cone.Location()
            if abs(abs(axis.Z())-1) > 1e-9 or math.hypot(p.X(), p.Y()) > 1e-7:
                continue
            item = np.array([cone.RefRadius(), p.Z(), axis.Z()*math.tan(cone.SemiAngle())])
            if not any(np.max(abs(item-c)) < 1e-7 for c in cones):
                cones.append(item)
    if len(planes) != 6 or len(cones) != 1:
        raise ValueError('Matching gap: need six regular hex planes and one coaxial top-chamfer cone')
    planes.sort()
    normals, offsets = np.array(planes).T
    if (np.ptp(offsets) > 1e-7 or
            np.max(abs(np.diff(np.r_[normals, normals[0]+math.tau])-math.tau/6)) > 1e-7):
        raise ValueError('Matching gap: source hex planes are not a regular centered hexagon')
    if not dome_radii or abs(max(dome_radii)-inner) > 1e-10:
        raise ValueError('Matching gap: inner port does not match the original dome outer radius')
    ref, zref, slope = cones[0]
    apothem = float(offsets.mean())
    def cone_radius(z):
        return ref+slope*(z-zref)
    if (slope >= 0 or abs(cone_radius(high)-apothem) > 1e-7
            or not inner < apothem < cone_radius(low) < apothem/math.cos(math.pi/6)-1e-7):
        raise ValueError('Matching gap: port is not inside the bounded upper mixed cone/hex band')
    return dict(normals=normals, offsets=offsets, domeOuterRadiusMm=float(max(dome_radii)),
                coneReferenceRadiusMm=float(ref),
                coneReferenceZMm=float(zref), coneSlope=float(slope), apothemMm=apothem)


def _nearest_trimmed(shape):
    faces = list(shape.faces())
    bounds = [f.bounding_box() for f in faces]
    lo, hi = np.array([tuple(b.min) for b in bounds]), np.array([tuple(b.max) for b in bounds])
    def distance(point, limit):
        point = np.asarray(point)
        lower = np.linalg.norm(np.maximum(np.maximum(lo-point, point-hi), 0), axis=1)
        best = float('inf')
        for i in np.argsort(lower):
            if lower[i] > min(limit, best)+1e-12:
                break
            best = min(best, faces[int(i)].distance_to(tuple(point)))
            if best < 1e-11:
                break
        if best > limit:
            raise ValueError(f'Matching gap: original trimmed CAD distance {best} exceeds {limit}')
        return best
    return distance


def build_cad_outer(shape, interface, radial=2, crease_margin=.005, axial_mapping='crease'):
    """Return (H8 outer band, independent source-CAD crop, local-only audit).

    The source port is unmodified. The outer Z map has strictly positive
    intervals, not merged angular columns. 'uniform' is exposed as a negative
    control and is subject to the SAME mandatory CAD/H8 volume gate.
    """
    inner_xyz, angles, levels, inner = _validate_port(interface, radial)
    if (type(crease_margin) not in (float, int) or not math.isfinite(crease_margin)
            or not 1e-4 <= crease_margin < (levels[-1]-levels[0])/4):
        raise ValueError('Crease margin must be finite and retain positive outer axial intervals')
    if axial_mapping not in ('crease', 'uniform'):
        raise ValueError('axial_mapping must be crease or uniform')
    support = _supports(shape, float(levels[0]), float(levels[-1]), inner)
    normals, offsets = support['normals'], support['offsets']
    outer_angles, anchor_ids, anchor_targets = anchor_outer_angles(angles, normals-math.pi/6)
    directions = np.column_stack((np.cos(outer_angles), np.sin(outer_angles)))
    dot = np.cos(outer_angles[:, None]-normals[None, :])
    hex_radius = np.min(np.where(dot > 1e-10, offsets[None, :]/np.maximum(dot, 1e-10), np.inf), axis=1)
    ref, zref, slope = support['coneReferenceRadiusMm'], support['coneReferenceZMm'], support['coneSlope']
    crease = zref+(hex_radius-ref)/slope
    star = np.clip(crease, levels[0]+crease_margin, levels[-1]-crease_margin)
    mid = (len(levels)-1)//2
    outer_z = np.repeat(levels[:, None], len(angles), axis=1)
    if axial_mapping == 'crease':
        for k in range(len(levels)):
            outer_z[k] = (levels[0]+(star-levels[0])*k/mid if k <= mid
                          else star+(levels[-1]-star)*(k-mid)/(len(levels)-1-mid))
    cone_radius = ref+slope*(outer_z-zref)
    radius = np.minimum(hex_radius[None, :], cone_radius)
    outer_xyz = np.concatenate((radius[:, :, None]*directions[None, :, :], outer_z[:, :, None]), axis=2)
    count, nz = len(angles), len(levels)
    nodes = np.array([(1-j/radial)*inner_xyz[k, i]+j/radial*outer_xyz[k, i]
                      for k in range(nz) for j in range(radial+1) for i in range(count)])
    def node(k, j, i):
        return (k*(radial+1)+j)*count+i%count
    elements = np.array([[node(k,j,i),node(k,j+1,i),node(k,j+1,i+1),node(k,j,i+1),
                          node(k+1,j,i),node(k+1,j+1,i),node(k+1,j+1,i+1),node(k+1,j,i+1)]
                         for k in range(nz-1) for j in range(radial) for i in range(count)], dtype=np.int64)
    mesh = Mesh3D('CAD_CAP_OUTER_BAND_LOCAL')
    mesh.nodes, mesh.elems = nodes, elements
    mesh.regions, mesh.region_names = ['OUTER_BAND']*len(elements), ['OUTER_BAND']
    quality, boundary = audit_h8(nodes, elements, expected_euler=0)
    rings = np.array([[node(k,0,i) for i in range(count)] for k in range(nz)])
    assert np.array_equal(nodes[rings], inner_xyz)
    mesh.inner_node_rings = rings
    mesh.source_node_pairs = np.column_stack((np.asarray(interface['nodeRings']).ravel(), rings.ravel()))
    inner_cells = np.array([k*radial*count+i for k in range(nz-1) for i in range(count)])
    # Extract the ACTUAL outward cell face; the cyclic rotation only chooses
    # the source port's first vertex. Reversal is checked, never fabricated.
    inner_faces = elements[inner_cells][:,FACES[5]][:,[1,2,3,0]]
    source_faces = np.asarray(interface['faces'])
    source_map = dict(mesh.source_node_pairs)
    mapped = np.array([[source_map[int(n)] for n in face] for face in source_faces])
    if not np.array_equal(inner_faces, mapped[:, [0,3,2,1]]):
        raise ValueError('Source interface face order/orientation does not match axial/angular port')
    mesh.surfaces = dict(shared_inner=inner_faces,
        cad_outer=np.array([[node(k,radial,i),node(k,radial,i+1),node(k+1,radial,i+1),node(k+1,radial,i)]
                            for k in range(nz-1) for i in range(count)]),
        cad_top=np.array([[node(nz-1,j,i),node(nz-1,j+1,i),node(nz-1,j+1,i+1),node(nz-1,j,i+1)]
                          for j in range(radial) for i in range(count)]),
        bottom_cut=np.array([[node(0,j,i),node(0,j,i+1),node(0,j+1,i+1),node(0,j+1,i)]
                             for j in range(radial) for i in range(count)]))
    tagged = np.concatenate(list(mesh.surfaces.values()))
    if len(tagged) != len(boundary) or {tuple(sorted(f)) for f in tagged} != {tuple(sorted(f)) for f in boundary}:
        raise ValueError('Outer band free-surface partition is incomplete')
    _assert_boundary_cycles(mesh,tagged)
    from build123d import Align, Cylinder, Pos
    from .standard_cad import _mass
    bounds = shape.bounding_box()
    extent = max(abs(bounds.min.X),abs(bounds.max.X),abs(bounds.min.Y),abs(bounds.max.Y))*2
    clip = Pos(0,0,float(levels[0]))*Cylinder(extent,float(levels[-1]-levels[0]),
                                           align=(Align.CENTER,Align.CENTER,Align.MIN))
    hole = Pos(0,0,float(levels[0]))*Cylinder(support['domeOuterRadiusMm'],float(levels[-1]-levels[0]),
                                           align=(Align.CENTER,Align.CENTER,Align.MIN))
    crop = (shape & clip)-hole
    if crop is None or not crop.is_valid or len(crop.solids()) != 1:
        raise ValueError('Matching gap: independent outer-band CAD crop is not one valid solid')
    cad_volume = _mass(crop)
    error = abs(quality['volume']-cad_volume)/cad_volume
    if error > 1e-4:
        raise ValueError(f'Matching gap: outer CAD/H8 volume error {error} exceeds 1e-4 ({axial_mapping})')
    distance = _nearest_trimmed(shape)
    witnesses = {}
    for name in ('cad_outer','cad_top'):
        quads = mesh.surfaces[name]
        node_error = max(distance(nodes[i],2e-6) for i in np.unique(quads))
        face_error = max(distance(p,.02) for p in nodes[quads].mean(axis=1))
        witnesses[name] = dict(originalCadSurface=True, maximumNodeDistanceMm=node_error,
                               maximumFaceCenterDistanceMm=face_error, nodes=len(np.unique(quads)), faces=len(quads))
    from OCP.BRepClass3d import BRepClass3d_SolidClassifier
    from OCP.gp import gp_Pnt
    from OCP.TopAbs import TopAbs_IN
    classifier = BRepClass3d_SolidClassifier(crop.wrapped)
    for p in nodes[elements].mean(axis=1):
        classifier.Perform(gp_Pnt(*p),1e-9)
        if classifier.State() != TopAbs_IN:
            raise ValueError('Matching gap: an outer H8 centroid lies outside the exact source CAD crop')
    signs = np.where(cone_radius-hex_radius[None,:] > 1e-7,1,
                     np.where(cone_radius-hex_radius[None,:] < -1e-7,-1,0))
    mixed = 0
    for k in range(nz-1):
        for i in range(count):
            values = signs[[k,k,k+1,k+1],[i,(i+1)%count,(i+1)%count,i]]
            mixed += int(np.any(values==1) and np.any(values==-1))
    # The axial lower bound and actual Gauss determinants explicitly distinguish
    # small but finite cells from an angular/axis collapse at a termination.
    report = dict(schemaVersion=1,purpose='source-CAD-outer-shoulder-band',localOnly=True,fullCapNut=False,
        fullModelAcceptance=False,localBandAccepted=True,quality=quality,sourceCadPartitionVolumeMm3=cad_volume,
        relativeCadH8VolumeError=error,zRangeMm=[float(levels[0]),float(levels[-1])],innerRadiusMm=inner,
        innerInterfaceFaces=len(inner_faces),innerInterfaceNodes=rings.size,innerCoordinatesUnchanged=True,
        reversedSourceInterfaceFaces=True,radialCells=radial,axialMapping=axial_mapping,creaseMarginMm=crease_margin,
        sourcePortActualBoundaryCyclesVerified=bool(interface.get('actualBoundaryCyclesVerified',False)),
        outputBoundaryCyclesVerified=True,exactlyOneOuterBoundaryOwnerPerRecord=True,
        minimumOuterAxialSpacingMm=float(np.diff(outer_z,axis=0).min()),
        maximumOuterAngleShiftDeg=float(np.rad2deg(abs(outer_angles-angles)).max()),
        hexCornerRayAnchorIndices=anchor_ids.tolist(),hexCornerRayAnglesDeg=np.rad2deg(anchor_targets).tolist(),
        mixedConePlaneFaces=mixed,cadCreaseConforming=False,
        creaseCountScope='outer-vertex support switches; not an exhaustive CAD-curve intersection audit',
        boundaryMatching=witnesses,
        allElementCentroidsInCadCrop=True,artificialSurfaces=['shared_inner','bottom_cut'],
        partitionIndependentOfAngularAndRadialSeeds=True,
        cadCropInnerRadiusFromOriginalSphereMm=support['domeOuterRadiusMm'],
        support=dict(normalsDeg=np.rad2deg(normals).tolist(),apothemMm=support['apothemMm'],
                     coneReferenceRadiusMm=ref,coneReferenceZMm=zref,coneSlope=slope),
        gates=dict(minimumCornerScaledJacobian=.15,cadH8VolumeRelative=1e-4,nodeDistanceMm=2e-6,faceCenterDistanceMm=.02),
        limitations=['Only the outer band at the supplied axial port; not a complete cap nut',
                     'Inner cylindrical port and bottom plane are artificial partition interfaces',
                     'Finite support-switch faces are geometrically audited, not exact CAD-crease partitions',
                     'Hex corner RAYS are anchored; actual lower hex-corner lines below this crop are not meshed',
                     'No complete thread-body/solver/native-HM acceptance'])
    mesh.dims = report
    return mesh,crop,report
