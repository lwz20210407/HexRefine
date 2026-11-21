"""Read a STEP/BREP constant hollow tube into a HexRefine axial-band request."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import numpy as np
from pysmesh import EntityKind, Session, read_step_xde


def discover_tube(source: Path) -> dict:
    source = source.resolve(strict=True)
    if source.suffix.lower() not in (".step", ".stp", ".brep") or source.stat().st_size > 64*1024**2:
        raise ValueError("expected a STEP or BREP file of at most 64 MiB")
    data = source.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    unit = None
    if source.suffix.lower() != ".brep":
        step = read_step_xde(source)
        data, unit = step.brep, step.unit_name
    session = Session()
    session.add_brep(data)
    solids = session.entities(EntityKind.SOLID)
    faces = session.entities(EntityKind.FACE)
    if len(solids) != 1 or len(faces) != 4 or session.check_shape():
        raise ValueError("requires one valid, unpartitioned hollow cylinder with four faces")
    table = session.surface_parameters(faces)
    planes = [i for i, kind in enumerate(table.types) if kind == "Plane"]
    walls = [i for i, kind in enumerate(table.types) if kind == "Cylinder"]
    if len(planes)!=2 or len(walls)!=2:
        raise ValueError("expected two coaxial cylindrical walls and two planar caps")
    i,j = sorted(walls,key=lambda idx: table.radius1[idx])
    ri,ro = float(table.radius1[i]),float(table.radius1[j])
    axis = table.axis[j]
    origin = table.origin[j]
    if not (0 < ri < ro and np.isfinite([ri,ro]).all()):
        raise ValueError("invalid tube radii")
    if any(abs(float(np.dot(table.axis[k],axis))) < 1-1.e-10 for k in [i] + planes):
        raise ValueError("tube walls are not parallel or end caps are not perpendicular")
    foot = table.origin[i]-origin
    if np.linalg.norm(foot-np.dot(foot,axis)*axis)>ro*1.e-8:
        raise ValueError("tube walls are not coaxial")
    levels = [(float(np.dot(table.origin[k]-origin,axis)),k) for k in planes]
    levels.sort()
    length = levels[1][0]-levels[0][0]
    if not math.isfinite(length) or length <= ro*1.e-10:
        raise ValueError("tube cap separation is not resolvable")
    cap_area = math.pi*(ro-ri)*(ro+ri)
    nominal = cap_area*length
    face_measure = session.mass_properties(faces,precision=1.e-9).measure
    solid_volume = float(session.mass_properties(solids,precision=1.e-9).measure[0])
    for k, target in [(i,2*math.pi*ri*length),(j,2*math.pi*ro*length)]+[(k,cap_area) for k in planes]:
        if not math.isclose(float(face_measure[k]),target,rel_tol=1.e-8):
            raise ValueError("trimmed/partial wall or cap does not cover a complete tube")
    if not math.isclose(solid_volume,nominal,rel_tol=1.e-8):
        raise ValueError("CAD volume does not match a complete tube")
    if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
        raise ValueError("CAD source changed while reading")
    return dict(sourceSha256=digest,unitName=unit,innerRadius=ri,outerRadius=ro,
                length=length,axis=axis.tolist(),cadVolume=solid_volume,
                caps=[dict(faceId=int(faces[k]),center=(origin+v*axis).tolist()) for v,k in levels])


def build_request(tube: dict, args: argparse.Namespace) -> dict:
    if args.expected_sha256 != tube["sourceSha256"]:
        raise ValueError("CAD hash mismatch; inspect again before selecting a cap")
    matches = [i for i, end in enumerate(tube["caps"]) if end["faceId"]==args.fine_face]
    if len(matches)!=1:
        raise ValueError("fine-face must be one of the two planar cap IDs from inspect")
    if not args.ratios or len(args.ratios)>8 or args.radial_layers not in range(1,1001):
        raise ValueError("provide 1-8 ratios and 1-1000 radial layers")
    if (args.fine_segments is None)==(args.target_arc_size is None):
        raise ValueError("choose exactly one of fine-segments and target-arc-size")
    multiple, divisor = 1, 1
    for ratio in args.ratios:
        multiple = math.lcm(multiple,divisor*(4 if ratio==2 else 3))
        divisor *= ratio
    if args.target_arc_size is not None:
        pitch=args.target_arc_size
        if not math.isfinite(pitch) or pitch<=0:
            raise ValueError("target arc size must be finite and positive")
        n = math.ceil(max(4*divisor,2*math.pi*tube["outerRadius"]/pitch)/multiple)*multiple
    else:
        n = args.fine_segments
    if not 4*divisor <= n <= 200000 or n%multiple:
        raise ValueError(f"fine count must be a multiple of {multiple}, at least {4*divisor}, and at most 200000")
    fine = matches[0]
    axis = np.array(tube["axis"])*(1 if fine==0 else -1)
    origin = np.array(tube["caps"][fine]["center"])
    regular = {}
    band_length=tube["length"]
    for side,width,layers in [
            ("fine",args.fine_regular_width,args.fine_regular_layers),
            ("coarse",args.coarse_regular_width,args.coarse_regular_layers)]:
        if not math.isfinite(width) or width<0 or layers not in range(1,1001):
            raise ValueError("invalid regular extension width or layer count")
        if width:
            band_length-=width
            regular[side] = dict(width=width,layers=layers)
            if side=="fine":
                origin+=axis*width
    if band_length<=tube["outerRadius"]*1.e-10:
        raise ValueError("regular regions leave no axial transition span")
    params=dict(innerRadius=tube["innerRadius"],outerRadius=tube["outerRadius"],
                axis=axis.tolist(),origin=origin.tolist(),length=band_length,
                fineSegments=n,radialLayers=args.radial_layers,ratios=args.ratios)
    if args.stage_depths:
        if (len(args.stage_depths)!=len(args.ratios)
            or not all(math.isfinite(x) and x>0 for x in args.stage_depths)
            or not math.isclose(sum(args.stage_depths),band_length,rel_tol=1.e-10)):
            raise ValueError("stage depths must be positive and sum to the remaining band length")
        params["stageDepths"]=args.stage_depths
    return dict(schemaVersion=1,kind="transitionmesh-v11",mode="AXIAL_SURFACE",
                parameters=params,**({"regularRegions":regular} if regular else {}))


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation",choices=("inspect","plan"))
    parser.add_argument("source",type=Path)
    parser.add_argument("--expected-sha256")
    parser.add_argument("--fine-face",type=int)
    parser.add_argument("--fine-segments",type=int)
    parser.add_argument("--target-arc-size",type=float)
    parser.add_argument("--ratios",type=int,choices=(2,3),nargs="+")
    parser.add_argument("--radial-layers",type=int,default=2)
    parser.add_argument("--stage-depths",nargs="+",type=float)
    for side in ("fine","coarse"):
        parser.add_argument(f"--{side}-regular-width",type=float,default=0.)
        parser.add_argument(f"--{side}-regular-layers",type=int,default=1)
    args=parser.parse_args()
    tube=discover_tube(args.source)
    print(json.dumps(tube if args.operation=="inspect" else build_request(tube,args),indent=2,allow_nan=False))


if __name__=="__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok":False,"error":str(error)}),file=sys.stderr)
        raise SystemExit(1)
