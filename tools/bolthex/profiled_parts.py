"""Bounded full-body assembly using the adapted profile and recovered O-grid core."""
from dataclasses import asdict
import math
import numpy as np
from .femssc_profile import TrapezoidThreadProfile
from .mesh_core import (build_bolt_section, build_head_ring_section, build_nut_section,
                       revolve, add_surface, hexagon_R, merge_by_coords)

SOURCE = 'https://github.com/kycai/femssc/blob/6cdd6226f701add64af03a36121a0499249b006d/src/prepp.py#L418'


def _sections(layers, count, inner=False, offset=(0., 0., 0.)):
    contours = []
    for z, outer, hole in layers:
        fn = hole if inner else outer
        contours.append([[fn(360.0 * i / count) * math.cos(2 * math.pi * i / count) + offset[0],
                          fn(360.0 * i / count) * math.sin(2 * math.pi * i / count) + offset[1],
                          z + offset[2]] for i in range(count)])
    return contours


def profiled_demo_meshes(threaded=True, handedness='right', profile_kind='femssc'):
    # Literal tooth dimensions from femssc screwC profile 1; generic full bodies
    # below do not claim to reproduce its drill tip, washer or GB product class.
    if profile_kind == 'femssc':
        profile = TrapezoidThreadProfile(4.71, 3.51, 1.60, .15, handedness)
        length, threaded_length, height, flats, chamfer = 8.7, 6.4, 4.05, 7.89, .3
        source = SOURCE
    elif profile_kind == 'rounded':
        from .rounded_profile import RoundedResearchThreadProfile
        profile = RoundedResearchThreadProfile(12., 1.5, handedness)
        length, threaded_length, height, flats, chamfer = 12., 6., 7.5, 18., .3
        source = 'https://github.com/sunwhale/thread/tree/582da3d8c9ec5ddc7e7d14aa2e32493b7a768a8c'
    else:
        raise ValueError('unsupported profile kind')
    n, nr1, nr2, lp, nshank, nhead = 8, 2, 5, 12, 3, 5
    R = profile.major_radius
    nt = math.ceil(threaded_length / profile.pitch * lp)
    core = build_bolt_section(n, nr1, nr2, profile.major_diameter, profile.major_diameter, ref_circle=True)
    layers, regions = [], []
    for i in range(nt + 1):
        z = threaded_length * i / nt
        f = (lambda theta, z=z: profile.radius(z, theta)) if threaded else (lambda theta: R)
        layers.append((z, f, None))
        if i < nt:
            regions.append('THREAD' if threaded else 'PLAIN')
    for i in range(1, nshank + 1):
        z = threaded_length + (length - threaded_length) * i / nshank
        layers.append((z, lambda theta: R, None)); regions.append('SHANK')
    shaft_layers = list(layers)
    head_layers = []
    for i in range(nhead + 1):
        z = length + height * i / nhead
        se = flats - 2.0 * chamfer if i == nhead else flats
        head_layers.append((z, lambda theta, se=se: hexagon_R(theta, se), None))
        if i:
            layers.append((z, lambda theta: R, None)); regions.append('HEAD')
    bolt_core, quads = revolve(core, layers, regions, 'BOLT_CORE')
    add_surface(bolt_core, quads, core, len(layers), 'S_THREAD', 'ring2', 'THREAD', 'S4', 'outer')
    head = build_head_ring_section(n, nr2, R, flats / 2.0)
    bolt_head, hquads = revolve(head, head_layers, ['HEAD'] * nhead, 'BOLT_HEAD')
    add_surface(bolt_head, hquads, head, len(head_layers), 'S_BEAR', 'ring', None, 'S1', None)
    bolt = merge_by_coords([bolt_core, bolt_head], 'PROFILE_BOLT')
    bolt.dims = dict(d=profile.major_diameter, P=profile.pitch, L=length, b=threaded_length,
                     k=height, s=flats, threaded=threaded)

    thickness, clearance = 2 * profile.pitch, .05
    offset = (12., 0., 0.) if profile_kind == 'femssc' else (27., 0., 0.)
    hole_ref = (2 * profile.female_min_radius if profile_kind == 'rounded' else profile.minor_diameter) if threaded else profile.major_diameter
    nut_section = build_nut_section(n, nr2, hole_ref, flats)
    nz = math.ceil(thickness / profile.pitch * lp)
    nut_layers = []
    for i in range(nz + 1):
        z = thickness * i / nz
        if threaded:
            inner_fn = profile.internal_radius if profile_kind == 'rounded' else profile.radius
            inner = lambda theta, z=z: inner_fn(z, theta) + clearance
        else:
            inner = lambda theta: R + clearance
        se = flats if 0 < i < nz else flats - 2.0 * chamfer
        nut_layers.append((z, lambda theta, se=se: hexagon_R(theta, se), inner))
    nut, nquads = revolve(nut_section, nut_layers, ['NUT'] * nz, 'PROFILE_NUT')
    add_surface(nut, nquads, nut_section, len(nut_layers), 'S_NTHREAD', 'ring', 'NUT', 'S6', 'inner')
    nut.nodes += np.array(offset)
    nut.dims = dict(d=profile.major_diameter, P=profile.pitch, m=thickness, s=flats,
                    radialClearance=clearance, offset=offset, threaded=threaded)
    geometry = dict(schemaVersion=1, representation='parameter-section-ruled-brep',
        analyticHelix=False, source=source, profile=asdict(profile), threaded=threaded,
        parts=[dict(partId=1, name=bolt.name, operation='fuse', blocks=[
            dict(outer=_sections(shaft_layers, 6*n)), dict(outer=_sections(head_layers, 6*n))]),
            dict(partId=2, name=nut.name, operation='cut', blocks=[
                dict(outer=_sections(nut_layers, 6*n, offset=offset)),
                dict(outer=_sections(nut_layers, 6*n, inner=True, offset=offset))])],
        limitations=['Piecewise ruled BRep at the same parametric stations as the FE boundary, not an exact smooth analytical helix.',
          'Generic full bodies around the selected research tooth profile; not a complete upstream fastener or certified GB/GJB geometry.',
          'Radial clearance is not a thread tolerance class; no near-thread element-count coarsening yet.'])
    return [bolt, nut], geometry
