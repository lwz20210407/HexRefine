"""Prepare bounded, hash-bound washer witnesses from immutable source CAD/K."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
from importlib.metadata import version
import json
import math
import os
from pathlib import Path
import sys
import tempfile

import numpy as np

from tools.hypermesh_geometry_probe import sha, validate_reference
from tools.hypermesh_probe_reference import TrimmedFaceDistances
from tools.verify_native_mesh_roundtrip import _canonical, _fields, preflight_k
from .flat_washer import MAX_BYTES, NODE_LIMIT_MM, WasherDesign, _cad_faces, plan
from .mesh_audit import FACES
from .standard_cad import CAD_ROUNDTRIP_VOLUME_LIMIT, _mass


MAX_REFERENCE_BYTES = 2 * 1024 * 1024
MAX_REFERENCE_POINTS = 4096
MAX_BOUNDARY_NODES = 1024
FAMILY = "custom_flat_annular_washer"
PHYSICAL_FACES = ("BOTTOM", "TOP", "INNER", "OUTER")


def _read_bounded(path, limit):
    if not path.is_file() or path.stat().st_size > limit:
        raise ValueError(f"Missing or oversized source file: {path}")
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"Source file exceeds {limit} bytes: {path}")
    return data


def _json(data):
    def finite(value):
        if isinstance(value, dict):
            for child in value.values():
                finite(child)
        elif isinstance(value, list):
            for child in value:
                finite(child)
        elif type(value) is float and not math.isfinite(value):
            raise ValueError("Nonfinite certificate number")

    result = json.loads(data)
    if not isinstance(result, dict):
        raise ValueError("Certificate must be an object")
    finite(result)
    return result


def _positive(value, name):
    if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
        raise ValueError("Require positive finite certificate field: " + name)
    return value


def _certificates(report, cad, hashes):
    info = plan(report.get("design"), report.get("seeds"))
    for certificate in (report, cad):
        if (type(certificate.get("schemaVersion")) is not int or certificate["schemaVersion"] != 1 or certificate.get("family") != FAMILY
                or certificate.get("unit") != "mm"):
            raise ValueError("Require mm custom flat-washer source certificates")
    if not isinstance(report.get("plan"), dict) or not isinstance(report.get("hashes"), dict):
        raise ValueError("Source plan and hash certificates must be objects")
    if (report.get("meshGeometryChecksPassed") is not True or report.get("geometryVerified") is not True
            or cad.get("geometryIndependentOfMesh") is not True
            or cad.get("acceptedAsIndependentCad") is not True or cad.get("matchedMeshVerified") is not True):
        raise ValueError("Source CAD/mesh certificates lack independent matched geometry checks")
    if (cad.get("request") != info["design"] or report.get("plan", {}).get("design") != info["design"]
            or report.get("plan", {}).get("seeds") != info["seeds"]
            or type(cad.get("solids")) is not int or cad["solids"] != 1
            or type(cad.get("faces")) is not int or cad["faces"] != 4 or cad.get("chamferMM") != 0):
        raise ValueError("CAD/mesh design, seed or face certificate mismatch")
    for key in ("nodes", "elements"):
        if type(report.get(key)) is not int or report[key] != info[key] or report["plan"].get(key) != info[key]:
            raise ValueError("Source count certificate differs from washer seeds")
    if (report.get("kSHA256") != hashes["model.k"]
            or report.get("sourceStepSHA256") != hashes["model.step"]
            or report.get("hashes", {}).get("model.k") != hashes["model.k"]
            or report.get("hashes", {}).get("model.step") != hashes["model.step"]
            or cad.get("stepSHA256") != hashes["model.step"]
            or cad.get("matchedKSHA256") != hashes["model.k"]):
        raise ValueError("Source STEP/K certificate hash mismatch")
    mesh_volume = _positive(report.get("volume"), "volume")
    if abs(_positive(cad.get("meshVolume"), "meshVolume") - mesh_volume) / mesh_volume > 1e-10:
        raise ValueError("CAD/mesh volume certificate mismatch")
    return info


def _source_mesh(data):
    # Reuse the bounded IO syntax/ID guard, not TrueGrid's single-card reader.
    # The CAD runtime needs no PyDYNA: NODE numeric fields are read from this
    # already-validated snapshot; SOLID labels come from the shared guard.
    text = data.decode("ascii")
    layout = preflight_k(text)
    points, in_nodes = [], False
    for line in text.splitlines():
        if line.startswith("*"):
            in_nodes = line.rstrip() == "*NODE"
        elif in_nodes and line.strip() and not line.lstrip().startswith("$"):
            fields = _fields(line, [8, 16, 16, 16, 8, 8])
            points.append([float(value) for value in fields[1:4]])
    return _canonical(layout["node_ids"], points, layout["elements"], {"actual_element_type": "H8"})


def _boundary(mesh, info):
    indices = np.searchsorted(mesh.node_ids, mesh.elements)
    faces = indices[:, FACES].reshape(-1, 4)
    _, first, count = np.unique(np.sort(faces, axis=1), axis=0, return_index=True, return_counts=True)
    if np.any(count > 2):
        raise ValueError("Nonmanifold source K faces")
    boundary = faces[first[count == 1]]
    if not len(boundary):
        raise ValueError("No source K boundary")
    xyz = mesh.nodes[boundary]
    radius = np.linalg.norm(xyz[:, :, :2], axis=2)
    design, seeds = info["design"], info["seeds"]
    ri, ro = design["inner_diameter_mm"] / 2, design["outer_diameter_mm"] / 2
    masks = {
        "BOTTOM": np.all(abs(xyz[:, :, 2]) <= NODE_LIMIT_MM, axis=1),
        "TOP": np.all(abs(xyz[:, :, 2] - design["thickness_mm"]) <= NODE_LIMIT_MM, axis=1),
        "INNER": np.all(abs(radius - ri) <= NODE_LIMIT_MM, axis=1),
        "OUTER": np.all(abs(radius - ro) <= NODE_LIMIT_MM, axis=1),
    }
    if not np.all(sum(masks.values()) == 1):
        raise ValueError("Source boundary is outside the 2e-6 mm washer physical-face bands")
    expected = {name: seeds["circumferential"] * seeds["radial" if name in ("BOTTOM", "TOP") else "layers"]
                for name in PHYSICAL_FACES}
    counts = {name: int(mask.sum()) for name, mask in masks.items()}
    if counts != expected:
        raise ValueError("Actual K boundary face counts differ from washer seeds")
    return np.unique(boundary), {name: set(np.unique(boundary[mask]).tolist()) for name, mask in masks.items()}, counts


def _witnesses(design, seeds):
    ri, ro, height = design["inner_diameter_mm"] / 2, design["outer_diameter_mm"] / 2, design["thickness_mm"]
    count = min(24, max(8, math.ceil(seeds["circumferential"] / 12)))
    # Half-open, offset angular stations never hit the standard cylinder seam.
    angles = [math.tau * (i + .375) / count for i in range(count)]
    axial = min(3, seeds["layers"])
    radial = min(3, seeds["radial"])
    for name, radius in (("INNER", ri), ("OUTER", ro)):
        for j in range(axial):
            z = height * (j + .5) / axial
            for theta in angles:
                yield name, [radius * math.cos(theta), radius * math.sin(theta), z]
    for name, z in (("BOTTOM", 0.), ("TOP", height)):
        for j in range(radial):
            radius = ri + (ro - ri) * (j + .5) / radial
            for theta in angles:
                yield name, [radius * math.cos(theta), radius * math.sin(theta), z]


def _controls(design):
    ri, ro, height = design["inner_diameter_mm"] / 2, design["outer_diameter_mm"] / 2, design["thickness_mm"]
    mid = (ri + ro) / 2
    for i in range(3):
        theta = math.tau * (i + .375) / 3
        c, s = math.cos(theta), math.sin(theta)
        for name, origin, normal in (
            ("INNER", [ri*c, ri*s, height/2], [-c, -s, 0]),
            ("OUTER", [ro*c, ro*s, height/2], [c, s, 0]),
            ("BOTTOM", [mid*c, mid*s, 0], [0, 0, -1]),
            ("TOP", [mid*c, mid*s, height], [0, 0, 1]),
        ):
            for delta in (-.0002, -.00002, .00002, .0002):
                yield [a + delta*b for a, b in zip(origin, normal)], {
                    "controlClass": "near", "physicalFace": name, "origin": origin, "offsetMM": delta}
    far = max(.05, .05 * max(ro - ri, height))
    theta = math.tau * .375
    c, s = math.cos(theta), math.sin(theta)
    for name, point in (("OUTER", [(ro+far)*c, (ro+far)*s, height/2]),
                        ("BOTTOM", [mid*c, mid*s, -far]), ("TOP", [mid*c, mid*s, height+far])):
        yield point, {"controlClass": "far", "physicalFace": name}
    # These distinguish trimmed faces from their infinite plane/cylinder supports.
    yield [0., 0., height/2], {"controlClass": "trim-bore"}
    yield [(ro+far)*c, (ro+far)*s, height+far], {"controlClass": "far-trim-corner"}


def prepare_reference(source_bundle, new_output, *, maximum_boundary_nodes=1024):
    """Write one new JSON reference; preserve all source files and actual NIDs.

    Requires a flat_washer bundle's report.json, cad-report.json, model.step,
    and model.k. new_output is a file outside that bundle, in an existing
    directory. No HM/TrueGrid process, meshing, native acceptance, or solver.
    """
    if type(maximum_boundary_nodes) is not int or not 1 <= maximum_boundary_nodes <= MAX_BOUNDARY_NODES:
        raise ValueError("maximum_boundary_nodes must be an integer in [1,1024]")
    source = Path(source_bundle).resolve(strict=True)
    output = Path(new_output).absolute()
    if not source.is_dir():
        raise ValueError("source_bundle must be a directory")
    if output.exists() or output.is_symlink() or not output.parent.is_dir():
        raise ValueError("Require a new reference file in an existing output directory")
    if output.resolve().is_relative_to(source):
        raise ValueError("Reference output must be outside the immutable source bundle")
    paths = {name: source / name for name in ("report.json", "cad-report.json", "model.step", "model.k")}
    data = {name: _read_bounded(path, MAX_REFERENCE_BYTES if name.endswith(".json") else MAX_BYTES)
            for name, path in paths.items()}
    hashes = {name: hashlib.sha256(value).hexdigest() for name, value in data.items()}

    def unchanged():
        for name, path in paths.items():
            if sha(path) != hashes[name]:
                raise ValueError("Source changed during reference preparation: " + name)

    try:
        report, cad = _json(data["report.json"]), _json(data["cad-report.json"])
        info = _certificates(report, cad, hashes)
        mesh = _source_mesh(data["model.k"])
        if len(mesh.node_ids) != info["nodes"] or len(mesh.element_ids) != info["elements"]:
            raise ValueError("Actual K counts do not match source certificate/seeds")
        boundary, groups, counts = _boundary(mesh, info)
        if counts != report.get("boundaryCounts"):
            raise ValueError("Source boundary count certificate mismatch")
        from build123d import import_step
        shape = import_step(paths["model.step"])
        faces = _cad_faces(shape, WasherDesign(**info["design"]))
        volume = _mass(shape)
        for value, label in ((cad.get("reopenedVolume"), "reopenedVolume"),
                             (report.get("sourceVolume"), "sourceVolume")):
            if abs(_positive(value, label) - volume) / volume > CAD_ROUNDTRIP_VOLUME_LIMIT:
                raise ValueError("Actual source CAD volume differs from certificate")
        relative = abs(report["volume"] - volume) / volume
        for certificate in (report, cad):
            stated = certificate.get("relativeMeshVolumeError")
            if (type(stated) not in (int, float) or not math.isfinite(stated)
                    or not 0 <= stated <= 1e-4 or abs(stated - relative) > 1e-10):
                raise ValueError("CAD/mesh relative-volume certificate mismatch")
        bounds = shape.bounding_box()
        actual_bounds = np.asarray([list(bounds.min), list(bounds.max)])
        stated_bounds = np.asarray([cad.get("bbox", {}).get("min"), cad.get("bbox", {}).get("max")], dtype=float)
        if stated_bounds.shape != (2, 3) or not np.isfinite(stated_bounds).all() or np.max(abs(stated_bounds-actual_bounds)) > NODE_LIMIT_MM:
            raise ValueError("Actual source CAD bounds differ from certificate")
        distance = TrimmedFaceDistances(shape)
        points = []

        def add(point, role, **extra):
            xyz = [float(value) for value in point]
            if len(xyz) != 3 or not all(math.isfinite(value) for value in xyz):
                raise ValueError("Nonfinite reference point")
            measured = float(distance(xyz))
            if not math.isfinite(measured) or measured < 0:
                raise ValueError("Nonfinite/negative trimmed source distance")
            if role != "control" and measured > NODE_LIMIT_MM:
                raise ValueError("Source witness/boundary-node sample exceeds 2e-6 mm")
            if role == "source-face-interior":
                own = float(faces[extra["physicalFace"]].distance_to(tuple(xyz)))
                if not math.isfinite(own) or own > NODE_LIMIT_MM:
                    raise ValueError("Witness is not on its named physical trimmed face")
            points.append(dict(point=xyz, role=role, sourceDistance=measured, **extra))

        for name, point in _witnesses(info["design"], info["seeds"]):
            add(point, "source-face-interior", physicalFace=name)
        selections = np.linspace(0, len(boundary)-1, min(maximum_boundary_nodes, len(boundary)), dtype=int)
        for index in boundary[selections]:
            add(mesh.nodes[index], "mesh-boundary-node", nodeID=int(mesh.node_ids[index]),
                physicalFaces=[name for name in PHYSICAL_FACES if int(index) in groups[name]])
        for point, extra in _controls(info["design"]):
            add(point, "control", **extra)
        near = [p for p in points if p.get("controlClass") == "near"]
        far = [p for p in points if p.get("controlClass", "").startswith("far")]
        if len(near) < 6 or any(not 4e-6 < p["sourceDistance"] < .001 for p in near):
            raise ValueError("Measured near controls do not satisfy native reference calibration")
        if not far or any(p["sourceDistance"] <= .02 for p in far):
            raise ValueError("Measured far controls do not distinguish trimmed CAD")
        reference = dict(
            schemaVersion=2, purpose="bounded-flat-washer-native-reference",
            createdUTC=datetime.now(timezone.utc).isoformat(), unit="mm",
            sourceStepSHA256=hashes["model.step"], sourceKSHA256=hashes["model.k"],
            sourceReportSHA256=hashes["report.json"], sourceCadReportSHA256=hashes["cad-report.json"],
            sourceFiles={name: dict(path=str(paths[name]), sha256=value, bytes=len(data[name])) for name, value in hashes.items()},
            design=info["design"], seeds=info["seeds"], points=points,
            sampling=dict(actualNodes=len(mesh.node_ids), actualH8=len(mesh.element_ids),
                          boundaryFaceCounts=counts, totalBoundaryNodes=len(boundary),
                          maximumBoundaryNodes=maximum_boundary_nodes, sampledBoundaryNodes=len(selections),
                          boundarySelection="evenly spaced ascending actual NIDs on exposed H8 faces",
                          faceInteriorWitnesses={name: sum(p.get("physicalFace") == name and p["role"] == "source-face-interior" for p in points) for name in PHYSICAL_FACES},
                          maximumSourceSurfaceDistanceMM=max(p["sourceDistance"] for p in points if p["role"] != "control")),
            calibration=dict(method="measured distance to actual trimmed STEP faces, not offset magnitude",
                             nearControls=len(near), farControls=len(far),
                             minimumNearDistanceMM=min(p["sourceDistance"] for p in near),
                             maximumNearDistanceMM=max(p["sourceDistance"] for p in near)),
            limits=dict(maximumPoints=MAX_REFERENCE_POINTS, maximumBytes=MAX_REFERENCE_BYTES,
                        sourceSurfaceDistanceMM=NODE_LIMIT_MM),
            sourceInputsUnchanged=True, exactNativeCadCertified=False, fullModelAcceptance=False,
            nativeHmVerified=False, solverVerified=False,
            runtime=dict(python=sys.version, executable=sys.executable, build123d=version("build123d")),
            builderSHA256=sha(Path(__file__)),
            limitations=["Finite reference points do not certify the full model or native geometry.",
                         "No full-boundary distance audit, association, material or solver certification.",
                         "The original STEP is the reference; native IGES/reconstructed BRep are later measurement carriers."])
        validate_reference(reference)
        if len(points) > MAX_REFERENCE_POINTS:
            raise ValueError("Reference exceeds 4096 points")
        payload = (json.dumps(reference, indent=2, allow_nan=False) + "\n").encode("utf-8")
        if len(payload) > MAX_REFERENCE_BYTES:
            raise ValueError("Reference exceeds 2 MiB")
    finally:
        unchanged()
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=output.parent, prefix=".washer-reference-", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        unchanged()
        os.link(temporary, output)
    finally:
        if temporary is not None:
            try:
                temporary.unlink()
            except OSError:
                pass
    return reference


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_bundle", type=Path)
    parser.add_argument("new_output", type=Path, help="New reference JSON file outside the source bundle")
    parser.add_argument("--maximum-boundary-nodes", type=int, default=1024)
    args = parser.parse_args(argv)
    try:
        result = prepare_reference(args.source_bundle, args.new_output, maximum_boundary_nodes=args.maximum_boundary_nodes)
    except (ValueError, OSError, KeyError, TypeError, RuntimeError) as exc:
        print(json.dumps(dict(prepared=False, error=str(exc))), file=sys.stderr)
        return 1
    print(json.dumps(dict(prepared=True, reference=str(args.new_output.absolute()), points=len(result["points"]),
                          sampledBoundaryNodes=result["sampling"]["sampledBoundaryNodes"],
                          sourceStepSHA256=result["sourceStepSHA256"], sourceKSHA256=result["sourceKSHA256"],
                          fullModelAcceptance=False)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
