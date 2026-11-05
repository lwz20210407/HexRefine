"""Bounded, noncollapsed H8 polar patch of an actual concentric CAD cap.

This is one local macro, NOT a complete cap nut or a general annulus-to-disk
mapper. The square cone sides are artificial interior partition interfaces.
The CAD partition depends on the angular slope, never mesh subdivisions.
No STEP is constructed from mesh nodes, and no large model is written.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np

from .cad_cap_plan import SURFACE_LIMIT_MM, spherical_cap


def _parameters(divisions, slope, radial_layers):
    if type(divisions) is not int or not 2 <= divisions <= 64 or divisions % 2:
        raise ValueError('Polar divisions must be even and in [2,64]')
    if type(slope) not in (int, float) or not math.isfinite(slope) or not .05 <= slope <= .5:
        raise ValueError('Polar cone slope must be finite and in [.05,.5]')
    if type(radial_layers) is not int or not 1 <= radial_layers <= 4:
        raise ValueError('Polar radial layers must be in [1,4]')
    if divisions**2 * radial_layers > 4096:
        raise ValueError('Local polar macro budget is 4096 H8')


def _polar_cad(shape, cap, slope):
    from build123d import Solid, Wire

    center = np.array(cap['outer']['centerMm'])
    inner, outer = cap['inner']['radiusMm'], cap['outer']['radiusMm']
    # Both wires have finite area. The lower plane is entirely inside the
    # existing cavity; no apex/axis collapse is introduced into CAD or H8.
    wires = []
    for h in (inner / 4, outer * 1.1):
        wires.append(Wire.make_polygon([tuple(center + (u * h, v * h, h))
                     for u, v in ((-slope, -slope), (slope, -slope),
                                  (slope, slope), (-slope, slope))]))
    cone = Solid.make_loft(wires, ruled=True)
    local = shape & cone
    if local is None or not local.is_valid or len(local.solids()) != 1:
        raise ValueError('Actual CAD polar partition did not produce one valid solid')
    return local


def build_polar_patch(shape, divisions=40, slope=.25, radial_layers=1):
    """Return (H8 mesh, exact source-CAD partition, local-only audit).

    The chart normalizes (u,v,1) rather than sweeping a shrinking circle to
    zero radius. The pole therefore remains an ordinary interior chart node.
    All quality and volume gates are mandatory, including for coarse inputs.
    """
    _parameters(divisions, slope, radial_layers)
    from .mesh_audit import audit_h8
    from .mesh_core import Mesh3D
    from .standard_cad import _mass

    cap = spherical_cap(shape)
    local = _polar_cad(shape, cap, slope)
    inner, outer = cap['inner']['radiusMm'], cap['outer']['radiusMm']
    center = np.array(cap['outer']['centerMm'])
    values = np.linspace(-slope, slope, divisions + 1)
    uu, vv = np.meshgrid(values, values, indexing='xy')
    chart = np.column_stack((uu.ravel(), vv.ravel(), np.ones(uu.size)))
    chart /= np.linalg.norm(chart, axis=1)[:, None]
    radii = np.linspace(inner, outer, radial_layers + 1)
    nodes = np.concatenate([center + radius * chart for radius in radii])
    stride = divisions + 1
    quads = np.array([[j * stride + i, j * stride + i + 1,
                       (j + 1) * stride + i + 1, (j + 1) * stride + i]
                      for j in range(divisions) for i in range(divisions)], dtype=np.int64)
    layer_size = stride**2
    elements = np.concatenate([np.column_stack((quads + k * layer_size,
                              quads + (k + 1) * layer_size)) for k in range(radial_layers)])
    quality, boundary = audit_h8(nodes, elements, expected_euler=2)
    cad_volume = _mass(local)
    solid_angle = 4 * math.atan(slope**2 / math.sqrt(1 + 2 * slope**2))
    analytic_volume = solid_angle * (outer**3 - inner**3) / 3
    analytic_error = abs(cad_volume - analytic_volume) / analytic_volume
    if analytic_error > 1e-7:
        raise ValueError('Polar source CAD differs from the exact spherical-sector volume')
    volume_error = abs(quality['volume'] - cad_volume) / cad_volume
    if not math.isfinite(volume_error) or volume_error > 1e-4:
        raise ValueError(f'Local polar CAD/H8 volume error {volume_error} exceeds 1e-4')
    faces = list(shape.faces())
    curved_node_distance = max(
        faces[cap[role]['face']].distance_to(tuple(point))
        for role, layer in (('inner', nodes[:layer_size]), ('outer', nodes[-layer_size:]))
        for point in layer)
    shells = local.shells()
    if len(shells) != 1:
        raise ValueError('Polar CAD partition must have one closed boundary shell')
    shell = shells[0]
    boundary_node_distance = max(shell.distance_to(tuple(nodes[i])) for i in np.unique(boundary))
    face_center_distance = max(shell.distance_to(tuple(point)) for point in nodes[boundary].mean(axis=1))
    if max(curved_node_distance, boundary_node_distance) > SURFACE_LIMIT_MM or face_center_distance > .02:
        raise ValueError('Local polar CAD boundary matching rejected')
    if not all(shape.is_inside(tuple(point)) for point in nodes[elements].mean(axis=1)):
        raise ValueError('Polar H8 centroid lies outside the original CAD material')
    mesh = Mesh3D('CAD_CAP_POLAR_LOCAL')
    mesh.nodes, mesh.elems = nodes, elements
    mesh.regions = ['CAP_POLAR_LOCAL'] * len(elements)
    mesh.region_names = ['CAP_POLAR_LOCAL']
    report = dict(schemaVersion=1, purpose='cap-polar-local-macro-audit',
                  localPatchAccepted=True, fullModelAcceptance=False, fullCapNut=False,
                  divisions=divisions, slope=slope, radialLayers=radial_layers,
                  arrayBytes=nodes.nbytes + elements.nbytes,
                  quality=quality, sourceCadPartitionVolumeMm3=cad_volume,
                  analyticSectorVolumeMm3=analytic_volume, relativeCadAnalyticVolumeError=analytic_error,
                  relativeCadH8VolumeError=volume_error,
                  maximumOriginalSphereNodeDistanceMm=curved_node_distance,
                  maximumPartitionBoundaryNodeDistanceMm=boundary_node_distance,
                  maximumPartitionFaceCenterDistanceMm=face_center_distance,
                  allElementCentroidsInOriginalMaterial=True,
                  eightDistinctNodesPerElement=True, axisCollapse=False,
                  originalCadBoundaryFaces=['inner-sphere', 'outer-sphere'],
                  artificialInterfaces=['u=-slope', 'u=+slope', 'v=-slope', 'v=+slope'],
                  gates=dict(minimumCornerScaledJacobian=.15, cadH8VolumeRelative=1e-4,
                             surfaceDistanceMm=SURFACE_LIMIT_MM, faceCenterDistanceMm=.02),
                  limitations=['Only the polar square-cone sector, not a closed full cap nut',
                               'Four artificial side interfaces have no adjoining dome blocks yet',
                               'No threaded annulus/shoulder macro or full-body volume validation',
                               'No K/INP/HM or CAD file exchange acceptance'])
    mesh.dims = report
    return mesh, local, report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('step', type=Path)
    parser.add_argument('--unit', required=True, choices=['mm'])
    parser.add_argument('--divisions', type=int, default=40)
    parser.add_argument('--slope', type=float, default=.25)
    parser.add_argument('--radial-layers', type=int, default=1)
    args = parser.parse_args()
    _parameters(args.divisions, args.slope, args.radial_layers)
    if not 0 < args.step.stat().st_size <= 16 * 1024**2:
        raise ValueError('Local polar STEP budget is 16 MiB')
    from build123d import import_step

    _, _, report = build_polar_patch(import_step(args.step), args.divisions, args.slope, args.radial_layers)
    report.update(sourceStep=str(args.step.resolve()),
                  sourceStepSHA256=hashlib.sha256(args.step.read_bytes()).hexdigest(), unit='mm')
    print(json.dumps(report, indent=2, allow_nan=False))
