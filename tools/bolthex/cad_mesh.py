"""CAD-first mapped H8 meshes for star-shaped hex bolts and open hex nuts.

The STEP is generated independently. Radial intersections of that saved BRep,
not the legacy thread formulas, define the external and internal boundaries.
Socket bolts use a separate floor-aware block mapper. Blind-cap topologies
remain unsupported.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from .mesh_core import Mesh3D, build_bolt_section, build_nut_section, build_head_ring_section


@dataclass(frozen=True)
class MeshSeeds:
    sector: int = 16
    core_rings: int = 2
    radial: int = 6
    per_pitch: int = 24
    head: int = 12
    z_features: tuple[float,...] = ()
    boundary_mapping: str = 'radial'
    core_mapping: str = 'uniform'
    head_curve_segments: int = 6
    head_mapping: str = 'radial'

    def validate(self):
        for name, value in self.__dict__.items():
            if name=='head_mapping':
                if value not in ('radial','fillet_blocks'):
                    raise ValueError('head_mapping must be radial or fillet_blocks')
                continue
            if name=='core_mapping':
                if value not in ('uniform','graded_2to1','graded_2to1_compact'):
                    raise ValueError('core_mapping must be uniform, graded_2to1 or graded_2to1_compact')
                continue
            if name=='boundary_mapping':
                if value not in ('radial','runout'):
                    raise ValueError('boundary_mapping must be radial or runout')
                continue
            if name=='z_features':
                if not isinstance(value,(list,tuple)) or len(value)>128 or any(type(v) not in (int,float) or not math.isfinite(v) for v in value):
                    raise ValueError('z_features must contain at most 128 finite design-axis positions')
                continue
            if type(value) is not int or value < 2 or value > 256:
                raise ValueError(f'{name} seed must be an integer in [2,256]')
        if self.head_mapping=='fillet_blocks' and (self.head_curve_segments<4 or self.head_curve_segments%2):
            raise ValueError('Fillet-block curve count must be even and at least four')


class RadialCad:
    def __init__(self, shape, hole=False):
        from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
        from OCP.BRepClass3d import BRepClass3d_SolidClassifier
        self.shape = shape
        self.bounds = shape.bounding_box()
        vertices = list(shape.vertices())
        self.zmin = min(v.Z for v in vertices)
        self.zmax = max(v.Z for v in vertices)
        self.limit = self.bounds.size.length * 2
        self.intersector = IntCurvesFace_ShapeIntersector()
        self.intersector.Load(shape.wrapped, 1e-9)
        self.hole = hole
        self.faces = [(face, face.bounding_box()) for face in shape.faces()]
        self.loaded_z = None
        self.classifier = BRepClass3d_SolidClassifier(shape.wrapped)
        self.cache = {}
        self.queries = 0
        self.max_hit_residual = 0.0
        self.seam_fallbacks = 0
        self.max_fallback_distance = 0.0

    def surface_witness_distance(self, point, tolerance=2e-6):
        """Distance to an actual nearby trimmed CAD face, not its support plane."""
        xyz=np.asarray(point)
        candidates=[]
        for face,b in self.faces:
            lo,hi=np.array(tuple(b.min)),np.array(tuple(b.max))
            lower=np.maximum(np.maximum(lo-xyz,xyz-hi),0)
            if np.linalg.norm(lower)<=tolerance:
                candidates.append((np.prod(np.maximum(hi-lo,1e-10)),face))
        minimum=float('inf')
        for _,face in sorted(candidates,key=lambda item:item[0]):
            minimum=min(minimum,face.distance_to(tuple(xyz)))
            if minimum<=tolerance:
                return minimum
        raise ValueError(f'No CAD face within boundary tolerance at {point}: distance={minimum}')

    def radii(self, theta, z, _retry=True):
        z = min(self.zmax, max(self.zmin, z))
        expected_hole=bool(self.hole(z)) if callable(self.hole) else self.hole
        key = (round(theta % 360, 10), round(z, 11))
        if key in self.cache:
            return self.cache[key]
        from OCP.gp import gp_Lin, gp_Pnt, gp_Dir
        if self.loaded_z != key[1]:
            from OCP.BRep import BRep_Builder
            from OCP.TopoDS import TopoDS_Compound
            from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
            compound=TopoDS_Compound()
            builder=BRep_Builder();builder.MakeCompound(compound)
            for face, bounds in self.faces:
                if bounds.min.Z-1e-6 <= z <= bounds.max.Z+1e-6:
                    builder.Add(compound,face.wrapped)
            self.intersector = IntCurvesFace_ShapeIntersector()
            self.intersector.Load(compound,1e-9)
            self.loaded_z=key[1]
        a = math.radians(key[0])
        self.intersector.Perform(gp_Lin(gp_Pnt(0, 0, z), gp_Dir(math.cos(a), math.sin(a), 0)), 0, self.limit)
        if not self.intersector.IsDone():
            raise ValueError('CAD radial intersection did not finish')
        hits = []
        for i in range(1, self.intersector.NbPnt() + 1):
            t = self.intersector.WParameter(i)
            # Adjacent BRep faces can report the same seam twice within their
            # geometric tolerance. This deduplicates ray roots, not mesh nodes.
            if t > 1e-7 and not any(abs(t - old) < 1e-6 for old in hits):
                hits.append(t)
            point = self.intersector.Pnt(i)
            self.max_hit_residual = max(self.max_hit_residual, abs(point.X()-t*math.cos(a)), abs(point.Y()-t*math.sin(a)))
        hits.sort()
        if len(hits) == (2 if expected_hole else 1):
            result = tuple(hits) if expected_hole else (0.0,hits[0])
            self.cache[key]=result
            self.queries+=1
            return result
        from OCP.TopAbs import TopAbs_IN, TopAbs_ON
        material = []
        for a0, b0 in zip([0.0]+hits, hits+[self.limit]):
            if b0-a0 < 1e-7:
                continue
            mid = (a0+b0)/2
            self.classifier.Perform(gp_Pnt(mid*math.cos(a), mid*math.sin(a), z), 1e-8)
            if self.classifier.State() in (TopAbs_IN, TopAbs_ON):
                if material and abs(material[-1][1]-a0) < 1e-6:
                    material[-1] = (material[-1][0], b0)
                else:
                    material.append((a0,b0))
        if len(material) != 1 or material[0][1] == self.limit:
            if _retry:
                # OCCT's curve/face solver can miss a trimmed helical seam.
                # Bracket the actual material using the independent solid
                # classifier, then bisect and verify against the original shell.
                def inside(r):
                    self.classifier.Perform(gp_Pnt(r*math.cos(a),r*math.sin(a),z),1e-9)
                    return self.classifier.State() in (TopAbs_IN,TopAbs_ON)
                stations=np.linspace(0,self.limit,65)
                occupied=[inside(r) for r in stations]
                indices=[i for i,v in enumerate(occupied) if v]
                if not indices or indices[-1]==64 or indices!=list(range(indices[0],indices[-1]+1)) or (indices[0]==0)==expected_hole:
                    raise ValueError('Classifier cannot bracket one valid radial material interval')
                def bisect(lo,hi,state):
                    for _ in range(40):
                        mid=(lo+hi)/2
                        if inside(mid)==state:
                            lo=mid
                        else:
                            hi=mid
                    return (lo+hi)/2
                result=(0.0 if not expected_hole else bisect(stations[indices[0]-1],stations[indices[0]],False),
                        bisect(stations[indices[-1]],stations[indices[-1]+1],True))
                for r in result:
                    if r==0:
                        continue
                    distance=self.surface_witness_distance((r*math.cos(a),r*math.sin(a),z))
                    if distance > 2e-6:
                        raise ValueError('CAD seam retry does not lie on the original boundary')
                    self.max_fallback_distance=max(self.max_fallback_distance,distance)
                self.seam_fallbacks+=1
                self.cache[key]=result
                return result
            raise ValueError(f'Unsupported non-star CAD section: theta={theta}, z={z}, intervals={material}')
        result = material[0]
        self.cache[key] = result
        self.queries += 1
        return result


def _sweep(section, zs, outer, inner=None, name='CAD_H8',xy_map=None):
    rho = np.asarray(section.rho)
    theta = np.asarray(section.theta)
    alpha, beta = np.asarray(section.alpha), np.asarray(section.beta)
    reference = np.asarray(section.rout_ref)
    points = len(rho)
    if len(section.quads)*(len(zs)-1)>5_000_000:
        raise ValueError('Mapped block exceeds the bounded five-million H8 allocation limit')
    nodes = np.empty((len(zs) * points, 3))
    angles = np.radians(theta)
    for layer, z in enumerate(zs):
        if xy_map is not None:
            sl=slice(layer*points,(layer+1)*points)
            nodes[sl,:2]=xy_map(section,z)
            nodes[sl,2]=z
            continue
        radius = rho.copy()
        for ids, fn, weights, base in [(alpha > 0, outer, alpha, reference),
                                      (beta > 0, inner, beta, section.rin_ref)]:
            if fn is not None:
                values = np.array([fn(float(t), z) for t in theta[ids]])
                radius[ids] += weights[ids] * (values - (base[ids] if isinstance(base, np.ndarray) else base))
        sl = slice(layer * points, (layer+1) * points)
        nodes[sl] = np.column_stack((radius * np.cos(angles), radius * np.sin(angles), np.full(points, z)))
    quads = np.asarray(section.quads, dtype=np.int64)
    elements = np.concatenate([np.column_stack((quads+i*points, quads+(i+1)*points)) for i in range(len(zs)-1)])
    mesh = Mesh3D(name)
    mesh.nodes, mesh.elems = nodes, elements
    mesh.regions = ['CAD_MAPPED'] * len(elements)
    mesh.region_names = ['CAD_MAPPED']
    return mesh


def _z_layers(start, end, spacing, features=()):
    stops = sorted(set([start, end] + [float(z) for z in features if start < z < end]))
    values = []
    for a, b in zip(stops, stops[1:]):
        count = max(1, math.ceil((b-a)/spacing))
        values.extend(np.linspace(a, b, count+1)[:-1])
    return np.array(values + [end])


def estimate_mesh_volume(sampler, request, seeds):
    """Exact swept-linear boundary volume before allocating interior H8 cells."""
    if request['family']=='socket_bolt':
        from .cad_socket import estimate_socket_volume
        return estimate_socket_volume(sampler,request,seeds)
    pitch=float(request['size'].split('-')[1])
    flats=2*max(abs(sampler.bounds.min.Y),abs(sampler.bounds.max.Y))
    bevel=(flats/math.cos(math.pi/6)-flats)*math.tan(math.pi/12)/2
    if request['family']=='hex_nut':
        runout=None
        if seeds.boundary_mapping=='runout':
            from .cad_runout import NutRunoutMap
            runout=NutRunoutMap(sampler,6*seeds.sector,pitch)
        features=[] if runout is None else runout.axial_features()
        bands=[_z_layers(sampler.zmin,sampler.zmax,pitch/seeds.per_pitch,(sampler.zmin+bevel,sampler.zmax-bevel,*seeds.z_features,*features))]
    else:
        bands=[_z_layers(-request['length'],0,pitch/seeds.per_pitch),
               _z_layers(0,sampler.zmax,sampler.zmax/seeds.head,
                         [sampler.zmax-bevel+bevel*i/12 for i in range(12)])]
    angles=np.arange(6*seeds.sector)*60/seeds.sector
    sine=math.sin(math.tau/len(angles))
    def area(rs):
        return .5*sine*np.sum(rs*np.roll(rs,-1))
    volume=0.0
    for b,zs in enumerate(bands):
        previous=None
        for z in zs:
            if request['family']=='hex_nut' and runout is not None:
                outer,inner=runout.boundaries(z)
                polygons=np.stack((inner,outer),axis=1)
                def polygon_area(points):
                    return .5*np.sum(points[:,0]*np.roll(points[:,1],-1)-points[:,1]*np.roll(points[:,0],-1))
                if previous is not None:
                    before,z0=previous;mid=(before+polygons)/2
                    volume+=(z-z0)/6*sum(weight*(polygon_area(p[:,1])-polygon_area(p[:,0])) for weight,p in [(1,before),(4,mid),(1,polygons)])
                previous=polygons,z
                continue
            rz=max(z,1e-8) if len(bands)>1 and b==1 else min(z,-1e-8) if len(bands)>1 else z
            radii=np.array([sampler.radii(float(t),rz) for t in angles])
            if request['family']=='hex_bolt':
                radii[:,0]=0
            if previous is not None:
                before,z0=previous
                mid=(before+radii)/2
                volume+=(z-z0)/6*sum(weight*(area(r[:,1])-area(r[:,0])) for weight,r in [(1,before),(4,mid),(1,radii)])
            previous=(radii,z)
    return float(volume)


def _join_exact(first, second, name):
    # Only canonical interface coordinates are merged; no proximity welding.
    zmin,zmax=second.nodes[:,2].min(),second.nodes[:,2].max()
    candidates=np.flatnonzero((first.nodes[:,2]>=zmin-1e-10)&(first.nodes[:,2]<=zmax+1e-10))
    lookup = {tuple(np.round(first.nodes[i], 10)): int(i) for i in candidates}
    remap, fresh = [], []
    for point in second.nodes:
        key = tuple(np.round(point, 10))
        index = lookup.get(key)
        if index is None:
            index = len(first.nodes)+len(fresh)
            lookup[key] = index
            fresh.append(point)
        elif np.max(np.abs((first.nodes[index] if index < len(first.nodes) else fresh[index-len(first.nodes)])-point)) > 1e-9:
            raise ValueError('Canonical interface coordinates disagree')
        remap.append(index)
    result = Mesh3D(name)
    result.nodes = np.vstack((first.nodes, fresh))
    result.elems = np.vstack((first.elems, np.array(remap)[second.elems]))
    result.regions = first.regions + second.regions
    result.region_names = ['CAD_MAPPED']
    return result


def map_saved_cad(step, certificate, seeds=MeshSeeds(),*,socket_volume_limit=None):
    seeds.validate()
    if socket_volume_limit is not None and (type(socket_volume_limit) not in (int,float) or not math.isfinite(socket_volume_limit) or not 0<socket_volume_limit<=1e-4):
        raise ValueError('Early socket volume limit must be finite, positive and no more than 1e-4')
    step = Path(step).resolve()
    certificate = json.loads(Path(certificate).read_text(encoding='utf-8'))
    if not certificate.get('geometryIndependentOfMesh') or not certificate.get('acceptedAsIndependentCad'):
        raise ValueError('Require an accepted independent design CAD certificate')
    if hashlib.sha256(step.read_bytes()).hexdigest() != certificate['stepSHA256']:
        raise ValueError('STEP certificate/hash mismatch')
    request = certificate['request']
    family = request['family']
    nonmetric_socket=family=='socket_bolt' and request.get('standard')=='asme_b18.3'
    if family not in ('hex_bolt', 'hex_nut','socket_bolt') or (not request['size'].startswith('M') and not nonmetric_socket):
        raise ValueError('Mapped topology supports metric hex bolts/open nuts and metric or certified ASME socket bolts')
    socket_dimensions=None
    if family=='socket_bolt':
        from .thread_dimensions import dimensions_for
        if certificate.get('unit')!='mm':raise ValueError('Mapped socket CAD coordinates must be certified in mm')
        socket_dimensions=dimensions_for(request,certificate.get('designThread'))
    from build123d import import_step
    shape = import_step(step)
    if not shape.is_valid or len(shape.solids()) != 1:
        raise ValueError('CAD must be one valid solid')
    if family=='socket_bolt':
        if seeds.boundary_mapping!='radial' or seeds.z_features:
            raise ValueError('Socket mapping currently requires radial seeds without additional feature overrides')
        from .cad_socket import map_socket_bolt
        return map_socket_bolt(shape,request,seeds,socket_dimensions,
                               certificate.get('reopenedVolume'),socket_volume_limit)
    if seeds.head_mapping!='radial':
        raise ValueError('Fillet-block head mapping is exposed only for socket bolts')
    sampler = RadialCad(shape, hole=family=='hex_nut')
    if seeds.core_mapping.startswith('graded_2to1') and family!='hex_bolt':
        raise ValueError('Graded solid-core mapping is currently exposed for external-hex bolts only')
    if seeds.boundary_mapping=='runout' and family!='hex_nut':
        raise ValueError('Runout-cap mapping is currently exposed for open nuts only')
    if seeds.z_features and family!='hex_nut':
        raise ValueError('Additional axial feature planes are currently exposed for open nuts only')
    if any(z<sampler.zmin or z>sampler.zmax for z in seeds.z_features):
        raise ValueError('Axial feature planes must lie inside the saved CAD bounds')
    diameter = float(request['size'].split('-')[0][1:])
    pitch = float(request['size'].split('-')[1])
    radius = diameter/2
    bounds = sampler.bounds
    flats = 2 * max(abs(bounds.min.Y), abs(bounds.max.Y))
    bevel = (flats/math.cos(math.pi/6)-flats)*math.tan(math.pi/12)/2
    if family == 'hex_nut':
        section = build_nut_section(seeds.sector, seeds.radial, diameter, flats)
        if seeds.boundary_mapping=='runout':
            from .cad_runout import NutRunoutMap
            runout=NutRunoutMap(sampler,6*seeds.sector,pitch)
            zs=_z_layers(sampler.zmin,sampler.zmax,pitch/seeds.per_pitch,
                         (sampler.zmin+bevel,sampler.zmax-bevel,*seeds.z_features,*runout.axial_features()))
            mesh=_sweep(section,zs,None,name='CAD_RUNOUT_NUT',xy_map=runout.section_xy)
            mesh.dims=dict(request=request,seeds=seeds.__dict__,source='saved-independent-STEP',runoutMapping=runout.report())
            return mesh,shape,sampler
        zs = _z_layers(sampler.zmin, sampler.zmax, pitch/seeds.per_pitch,
                       (sampler.zmin+bevel, sampler.zmax-bevel,*seeds.z_features))
        mesh = _sweep(section, zs, lambda t,z: sampler.radii(t,z)[1],
                      lambda t,z: sampler.radii(t,z)[0], 'CAD_HEX_NUT')
    else:
        shaft_top = {i: sampler.radii(i*60/seeds.sector, -1e-8)[1] for i in range(6*seeds.sector)}
        def core_outer(t, z):
            if z < 0:
                return sampler.radii(t, z)[1]
            base = shaft_top[round((t%360)*seeds.sector/60) % (6*seeds.sector)]
            return base + min(1, z/(sampler.zmax/seeds.head))*(radius-base)
        shaft_zs = _z_layers(-request['length'], 0, pitch/seeds.per_pitch)
        head_zs = _z_layers(0, sampler.zmax, sampler.zmax/seeds.head,
                            [sampler.zmax-bevel+bevel*i/12 for i in range(12)])
        if seeds.core_mapping.startswith('graded_2to1'):
            from .graded_core import build_graded_bolt_section
            section=build_graded_bolt_section(seeds.sector,seeds.core_rings,seeds.radial,diameter,
                                             compact=seeds.core_mapping=='graded_2to1_compact')
        else:
            section = build_bolt_section(seeds.sector, seeds.core_rings, seeds.radial, diameter, diameter, ref_circle=True)
        body = _sweep(section, np.concatenate((shaft_zs, head_zs[1:])), core_outer, name='CAD_BOLT_CORE')
        ring = build_head_ring_section(seeds.sector, seeds.radial, radius, flats)
        ring.beta = [1-a for a in ring.alpha]
        head = _sweep(ring, head_zs, lambda t,z: sampler.radii(t,max(1e-8,z))[1], core_outer, 'CAD_BOLT_HEAD')
        mesh = _join_exact(body, head, 'CAD_HEX_BOLT')
    mesh.dims = dict(request=request, seeds=seeds.__dict__, source='saved-independent-STEP')
    if seeds.core_mapping.startswith('graded_2to1'):
        mesh.dims['coreGrading']=section.grading
    return mesh, shape, sampler
