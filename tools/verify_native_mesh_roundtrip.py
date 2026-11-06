"""Bounded, read-only H8 serialization acceptance; not a solver/geometry check."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import importlib
import importlib.metadata
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import warnings

import numpy as np


MAX_K_BYTES = 64 * 1024 * 1024
MAX_H8 = 200_000
COORDINATE_ATOL_MM = 1e-10
SLOTS = [f"n{i}" for i in range(1, 9)]


class AcceptanceError(ValueError):
    """Rejected input/comparison. No acceptance report has been written."""

    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message)
        self.details = details or {}


@dataclass
class Snapshot:
    path: Path
    data: bytes
    sha256: str

    @classmethod
    def read(cls, path: str | Path) -> "Snapshot":
        path = Path(path).resolve(strict=True)
        if not path.is_file() or path.stat().st_size > MAX_K_BYTES:
            raise AcceptanceError(f"Input exceeds 64 MiB or is not a file: {path}")
        with path.open("rb") as stream:
            data = stream.read(MAX_K_BYTES + 1)
        if len(data) > MAX_K_BYTES:
            raise AcceptanceError(f"Input exceeds 64 MiB: {path}")
        return cls(path, data, hashlib.sha256(data).hexdigest())

    def text(self) -> str:
        try:
            return self.data.decode("ascii")
        except UnicodeDecodeError as exc:
            raise AcceptanceError(f"Unsupported non-ASCII input: {self.path}") from exc

    def unchanged(self) -> None:
        try:
            current = Snapshot.read(self.path)
        except (OSError, AcceptanceError) as exc:
            raise AcceptanceError(f"Input changed or became unreadable during verification: {self.path}") from exc
        if current.sha256 != self.sha256:
            raise AcceptanceError(f"Input changed during verification: {self.path}")

    def receipt(self) -> dict:
        return {"path": str(self.path), "bytes": len(self.data), "sha256": self.sha256}


@dataclass
class Mesh:
    """Canonical arrays: ascending NID/EID, connectivity retains NIDs and slots."""

    node_ids: np.ndarray
    nodes: np.ndarray
    element_ids: np.ndarray
    elements: np.ndarray
    part_ids: np.ndarray | None
    metadata: dict


def _integer(token: str) -> int:
    if not re.fullmatch(r"\+?[0-9]+", token.strip()):
        raise AcceptanceError(f"Missing/malformed positive integer ID: {token!r}")
    value = int(token)
    if not 0 < value <= np.iinfo(np.int64).max:
        raise AcceptanceError(f"ID outside positive int64 range: {token!r}")
    return value


def _coordinate(token: str) -> None:
    try:
        value = float(token)
    except ValueError as exc:
        raise AcceptanceError(f"Missing/malformed coordinate: {token!r}") from exc
    if not np.isfinite(value):
        raise AcceptanceError(f"Non-finite coordinate: {token!r}")


def _fields(line: str, widths: list[int]) -> list[str]:
    if "," in line:
        fields = line.split(",")
        if len(fields) > len(widths):
            raise AcceptanceError("Unsupported extra fields")
        return [v.strip() for v in fields] + [""] * (len(widths) - len(fields))
    if line[sum(widths):].strip():
        raise AcceptanceError("Unsupported long format/extra fields")
    fields, offset = [], 0
    for width in widths:
        fields.append(line[offset:offset + width].strip())
        offset += width
    return fields


def _unique(values: np.ndarray, label: str) -> None:
    ids, counts = np.unique(values, return_counts=True)
    duplicates = ids[counts > 1]
    if len(duplicates):
        raise AcceptanceError(f"Duplicate {label}: {duplicates[:10].tolist()}")


def _canonical(node_ids, nodes, element_rows, metadata, *, has_pid=True) -> Mesh:
    node_ids = np.asarray(node_ids, dtype=np.int64)
    nodes = np.asarray(nodes, dtype=float)
    rows = np.asarray(element_rows, dtype=np.int64)
    if not len(node_ids) or not len(rows):
        raise AcceptanceError("Missing NODE or H8 element records")
    if len(rows) > MAX_H8:
        raise AcceptanceError("H8 scope exceeds 200000 elements")
    if nodes.shape != (len(node_ids), 3) or not np.isfinite(nodes).all():
        raise AcceptanceError("Missing or non-finite XYZ coordinates")
    _unique(node_ids, "node IDs")
    _unique(rows[:, 0], "element IDs")
    conn = rows[:, 2:] if has_pid else rows[:, 1:]
    if conn.shape != (len(rows), 8):
        raise AcceptanceError("Only H8 (eight slots) is supported")
    if np.any(np.diff(np.sort(conn, axis=1), axis=1) == 0):
        raise AcceptanceError("Non-H8 collapsed/mixed solid: repeated connectivity slots")
    missing = np.setdiff1d(conn, node_ids)
    if len(missing):
        raise AcceptanceError(f"Missing node references: {missing[:10].tolist()}")
    ni, ei = np.argsort(node_ids), np.argsort(rows[:, 0])
    return Mesh(node_ids[ni], nodes[ni], rows[ei, 0], conn[ei],
                rows[ei, 1] if has_pid else None, metadata)


def preflight_k(text: str) -> dict:
    """Strict syntax/scope guard BEFORE PyDYNA; never follows includes."""
    blocks, current, started, ended = [], None, False, False
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("$"):
            continue
        if ended:
            raise AcceptanceError(f"Data after *END at line {number}")
        if line.startswith("*"):
            if line not in {"*KEYWORD", "*TITLE", "*NODE", "*ELEMENT_SOLID", "*END"}:
                raise AcceptanceError(f"Unsupported keyword/format at line {number}: {line}")
            if line == "*KEYWORD":
                if started:
                    raise AcceptanceError("Repeated *KEYWORD")
                started = True
            elif not started:
                raise AcceptanceError("Missing initial *KEYWORD")
            ended = line == "*END"
            current = (line, [])
            blocks.append(current)
        elif current is None or current[0] in {"*KEYWORD", "*END"}:
            raise AcceptanceError(f"Unexpected data at line {number}")
        else:
            current[1].append(line)
    if not started or not ended:
        raise AcceptanceError("Missing *KEYWORD or *END")
    node_ids, elements, formats = [], [], []
    counts = {"node_cards": 0, "solid_cards": 0}
    for keyword, lines in blocks:
        if keyword == "*TITLE" and len(lines) != 1:
            raise AcceptanceError("*TITLE must contain exactly one line")
        if keyword == "*NODE":
            counts["node_cards"] += 1
            if not lines:
                raise AcceptanceError("Empty *NODE card")
            for line in lines:
                fields = _fields(line, [8, 16, 16, 16, 8, 8])
                node_ids.append(_integer(fields[0]))
                for value in fields[1:4]:
                    _coordinate(value)
                if any(v not in {"", "0"} for v in fields[4:]):
                    raise AcceptanceError("Nonzero NODE TC/RC is outside mesh-only scope")
        elif keyword == "*ELEMENT_SOLID":
            counts["solid_cards"] += 1
            if not lines:
                raise AcceptanceError("Empty *ELEMENT_SOLID card")
            # This is PyDYNA 0.12's documented card layout discriminator.
            two_line = len(lines[0].strip()) <= 16
            stride = 2 if two_line else 1
            formats.append("two-line" if two_line else "one-line")
            if len(lines) % stride:
                raise AcceptanceError("Incomplete two-line *ELEMENT_SOLID")
            if len(elements) + len(lines) // stride > MAX_H8:
                raise AcceptanceError("H8 scope exceeds 200000 elements before parsing")
            for i in range(0, len(lines), stride):
                if two_line:
                    head = _fields(lines[i], [8, 8])
                    tail = _fields(lines[i + 1], [8] * 10)
                    if any(tail[8:]):
                        raise AcceptanceError("Nonempty n9/n10: higher-order solid is not H8")
                    fields = head + tail[:8]
                else:
                    fields = _fields(lines[i], [8] * 10)
                elements.append([_integer(v) for v in fields])
    if not node_ids or not elements:
        raise AcceptanceError("Missing NODE or H8 element records")
    _unique(np.asarray(node_ids), "node IDs")
    _unique(np.asarray(elements)[:, 0], "element IDs")
    return {**counts, "node_ids": node_ids, "elements": elements,
            "solid_layouts": sorted(set(formats))}


def load_k(snapshot: Snapshot, layout: dict) -> Mesh:
    """Load a preflighted immutable snapshot through structured PyDYNA tables."""
    import pandas as pd
    from ansys.dyna.core import Deck

    deck = Deck()
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        result = deck.loads(snapshot.text())
    if caught or result.warnings or result.get_summary():
        raise AcceptanceError("PyDYNA load warnings/unprocessed keywords", {
            "warnings": [str(w.message) for w in caught] + list(result.warnings),
            "unprocessed": result.get_summary()})
    node_cards = list(deck.get_kwds_by_type("NODE"))
    solid_cards = list(deck.get_kwds_by_full_type("ELEMENT", "SOLID"))
    if len(node_cards) != layout["node_cards"] or len(solid_cards) != layout["solid_cards"]:
        raise AcceptanceError("PyDYNA card count differs from preflight")
    nodes = pd.concat([card.nodes for card in node_cards], ignore_index=True)
    solids = pd.concat([card.elements for card in solid_cards], ignore_index=True)
    extras = [c for c in solids.columns if c not in ["eid", "pid", *SLOTS]]
    if any(c not in {"n9", "n10"} for c in extras):
        raise AcceptanceError(f"Unsupported PyDYNA solid columns: {extras}")
    if extras and solids[extras].notna().any().any():
        raise AcceptanceError("Nonempty n9/n10: higher-order solid is not H8")
    rows = solids[["eid", "pid", *SLOTS]].to_numpy()
    if not np.array_equal(nodes["nid"].to_numpy(), layout["node_ids"]):
        raise AcceptanceError("PyDYNA lost or changed node IDs")
    if not np.array_equal(rows, layout["elements"]):
        raise AcceptanceError("PyDYNA lost or changed EID/PID/H8 slots")
    metadata = {k: layout[k] for k in ("node_cards", "solid_cards", "solid_layouts")}
    metadata.update(actual_element_type="H8", empty_optional_columns=extras)
    return _canonical(nodes["nid"], nodes[["x", "y", "z"]], rows, metadata)


def _meshio(package: str | Path | None):
    if package is None:
        try:
            return importlib.import_module("meshio")
        except ImportError as exc:
            raise AcceptanceError("meshio unavailable; supply an EXISTING --meshio-package directory") from exc
    package = Path(package).resolve(strict=True)
    existing = sys.modules.get("meshio")
    if existing is not None:
        if Path(existing.__file__).resolve().parent != package:
            raise AcceptanceError("A different meshio package is already loaded")
        return existing
    spec = importlib.util.spec_from_file_location(
        "meshio", package / "__init__.py", submodule_search_locations=[str(package)])
    if spec is None or spec.loader is None:
        raise AcceptanceError("Invalid existing meshio package")
    module = importlib.util.module_from_spec(spec)
    sys.modules["meshio"] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop("meshio", None)
        raise
    return module


def load_inp(snapshot: Snapshot, package: str | Path | None = None) -> Mesh:
    """meshio supplies geometry; a strict label sidecar retains discarded NIDs/EIDs."""
    blocks, current, parts = [], None, 0
    for raw in snapshot.text().splitlines():
        line = raw.strip()
        if not line or line.startswith("**"):
            continue
        if line.startswith("*"):
            tokens = [s.strip().upper() for s in line.split(",")]
            kind = tokens[0]
            allowed = {"*HEADING": set(), "*PART": {"NAME"}, "*END PART": set(),
                       "*NODE": {"NSET"}, "*ELEMENT": {"TYPE", "ELSET"},
                       "*ELSET": {"ELSET", "GENERATE"}, "*NSET": {"NSET", "GENERATE"}}
            if kind not in allowed:
                raise AcceptanceError(f"Unsupported INP keyword (includes/transforms forbidden): {line}")
            params = {}
            for token in tokens[1:]:
                key, _, value = token.partition("=")
                if key not in allowed[kind] or key in params:
                    raise AcceptanceError(f"Unsupported INP option: {line}")
                params[key] = value
            if kind == "*PART":
                parts += 1
                if parts > 1:
                    raise AcceptanceError("Only a single INP part/global ID namespace is supported")
            if kind == "*ELEMENT" and params.get("TYPE") not in {"C3D8", "C3D8R"}:
                raise AcceptanceError("Only INP C3D8/C3D8R H8 elements are supported")
            current = (kind, params, [])
            blocks.append(current)
        elif current is None:
            raise AcceptanceError("INP data without a keyword")
        else:
            current[2].append(line)
    node_blocks = [b for b in blocks if b[0] == "*NODE"]
    element_blocks = [b for b in blocks if b[0] == "*ELEMENT"]
    if len(node_blocks) != 1 or not element_blocks:
        raise AcceptanceError("INP requires exactly one NODE block and at least one ELEMENT block")
    if sum(len(b[2]) for b in element_blocks) > MAX_H8:
        raise AcceptanceError("INP H8 scope exceeds 200000 elements before meshio parsing")
    node_ids, rows, normalized = [], [], []
    for kind, params, lines in blocks:
        if kind == "*NODE":
            normalized.append("*NODE")
            for line in lines:
                fields = [s.strip() for s in line.split(",")]
                if len(fields) != 4:
                    raise AcceptanceError("INP NODE requires NID,X,Y,Z")
                node_ids.append(_integer(fields[0]))
                for v in fields[1:]:
                    _coordinate(v)
                normalized.append(line)
        elif kind == "*ELEMENT":
            if not node_ids:
                raise AcceptanceError("INP NODE must precede ELEMENT")
            normalized.append(f"*ELEMENT,TYPE={params['TYPE']}")
            for line in lines:
                fields = line.split(",")
                if len(fields) != 9:
                    raise AcceptanceError("INP H8 requires one complete EID+8-node row")
                rows.append([_integer(v) for v in fields])
                normalized.append(line)
    if not node_ids or not rows:
        raise AcceptanceError("Empty INP mesh")
    _unique(np.asarray(node_ids), "INP node IDs")
    _unique(np.asarray(rows)[:, 0], "INP element IDs")
    module = _meshio(package)
    # meshio drops labels; no coordinate/connectivity values are reconstructed here.
    # Metadata-only blocks are omitted, so no unverified include can be followed.
    mesh = module.read(io.StringIO("\n".join(normalized) + "\n"), file_format="abaqus")
    if any(c.type != "hexahedron" for c in mesh.cells):
        raise AcceptanceError("meshio returned non-H8 cells")
    conn = np.asarray(node_ids)[np.concatenate([c.data for c in mesh.cells])]
    expected = np.asarray(rows, dtype=np.int64)
    if not np.array_equal(conn, expected[:, 1:]):
        raise AcceptanceError("meshio connectivity/label sidecar mismatch")
    version = module.__version__
    if version == "unknown":
        distributions = importlib.metadata.distributions(path=[str(Path(module.__file__).parent.parent)])
        version = next((d.version for d in distributions if d.metadata["Name"] == "meshio"), version)
    return _canonical(node_ids, mesh.points, np.column_stack((expected[:, 0], conn)), {
        "actual_element_type": "H8", "abaqus_types": sorted({b[1]["TYPE"] for b in element_blocks}),
        "meshio_version": version, "meshio_package": str(Path(module.__file__).resolve()),
        "pid_comparison": "not applicable: INP has no LS-DYNA PID",
        "ignored_metadata": "HEADING, PART, END PART, ELSET, NSET; no material/solver certification",
    }, has_pid=False)


def compare(source: Mesh, candidate: Mesh, label: str) -> dict:
    same_nodes = np.array_equal(source.node_ids, candidate.node_ids)
    same_elements = np.array_equal(source.element_ids, candidate.element_ids)
    result = {"comparison": label, "node_ids_equal": same_nodes, "element_ids_equal": same_elements,
              "coordinate_atol_mm": COORDINATE_ATOL_MM, "coordinate_rtol": 0.0}
    for name, original, other in (("node", source.node_ids, candidate.node_ids),
                                  ("element", source.element_ids, candidate.element_ids)):
        if not np.array_equal(original, other):
            missing, added = np.setdiff1d(original, other), np.setdiff1d(other, original)
            result[f"{name}_id_difference"] = {
                "missing_count": len(missing), "added_count": len(added),
                "missing_sample": missing[:10].tolist(), "added_sample": added[:10].tolist()}
    if same_nodes:
        with np.errstate(over="ignore", invalid="ignore"):
            delta = np.abs(source.nodes - candidate.nodes)
        index = np.unravel_index(int(np.argmax(delta)), delta.shape)
        maximum = float(delta[index])
        result.update(max_coordinate_difference_mm=maximum if np.isfinite(maximum) else "overflow",
                      coordinates_equal=bool(np.all(delta <= COORDINATE_ATOL_MM)),
                      coordinates_over_tolerance=int(np.count_nonzero(delta > COORDINATE_ATOL_MM)),
                      worst_coordinate={"node_id": int(source.node_ids[index[0]]), "axis": "xyz"[index[1]],
                                        "source": float(source.nodes[index]), "candidate": float(candidate.nodes[index])})
    if same_elements:
        result["h8_slots_equal"] = bool(np.array_equal(source.elements, candidate.elements))
        result["connectivity_slot_mismatches"] = int(np.count_nonzero(source.elements != candidate.elements))
        if source.part_ids is not None and candidate.part_ids is not None:
            result["part_ids_equal"] = bool(np.array_equal(source.part_ids, candidate.part_ids))
            result["part_id_mismatches"] = int(np.count_nonzero(source.part_ids != candidate.part_ids))
    keys = ["node_ids_equal", "element_ids_equal", "coordinates_equal", "h8_slots_equal"]
    if source.part_ids is not None and candidate.part_ids is not None:
        keys.append("part_ids_equal")
    result["passed"] = all(result.get(k, False) for k in keys)
    return result


def verify_native_mesh_roundtrip(source_k: str | Path, native_k: str | Path, *,
                                 report_path: str | Path, source_inp: str | Path | None = None,
                                 meshio_package: str | Path | None = None) -> dict:
    """Write a fresh success-only JSON receipt; raise AcceptanceError on rejection.

    Hard limits: 64 MiB/input, 200000 H8/K, absolute XYZ tolerance 1e-10 mm.
    No normalization, renumbering, coordinate adjustment, or input writes.
    """
    output = Path(report_path).absolute()
    snapshots = []
    try:
        if output.exists() or output.is_symlink():
            raise AcceptanceError(f"Report must be a fresh path: {output}")
        if not output.parent.is_dir():
            raise AcceptanceError(f"Report parent must already exist: {output.parent}")
        for path in [source_k, native_k] + ([source_inp] if source_inp is not None else []):
            snapshots.append(Snapshot.read(path))
        if snapshots[0].path.samefile(snapshots[1].path):
            raise AcceptanceError("Source and native K must be distinct files")
        layouts = [preflight_k(s.text()) for s in snapshots[:2]]
        source, native = [load_k(s, layout) for s, layout in zip(snapshots, layouts)]
        comparisons = [compare(source, native, "source K vs actual native K")]
        inp = load_inp(snapshots[2], meshio_package) if source_inp is not None else None
        if inp is not None:
            comparisons.append(compare(source, inp, "source K vs independent source INP"))
            comparisons.append(compare(native, inp, "actual native K vs independent source INP"))
        if not all(c["passed"] for c in comparisons):
            raise AcceptanceError("Mesh serialization acceptance failed", {"comparisons": comparisons})
        import ansys.dyna.core
        report = {
            "schema": "native-mesh-roundtrip/v1", "passed": True,
            "created_utc": datetime.now(timezone.utc).isoformat(),
            "scope": {"max_bytes_per_input": MAX_K_BYTES, "max_h8_per_k": MAX_H8,
                      "coordinate_atol_mm": COORDINATE_ATOL_MM, "coordinate_rtol": 0.0,
                      "units": "mm (caller contract; not inferred)",
                      "certification": "mesh serialization only; not solver, material, geometry quality or CAD provenance"},
            "runtime": {"python": sys.version, "executable": sys.executable,
                        "pydyna": ansys.dyna.core.__version__, "numpy": np.__version__},
            "tool_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "inputs": dict(zip(["source_k", "native_k", "source_inp"], [s.receipt() for s in snapshots])),
            "meshes": {name: {"nodes": len(m.node_ids), "elements": len(m.element_ids), **m.metadata}
                       for name, m in [("source_k", source), ("native_k", native), ("source_inp", inp)] if m is not None},
            "comparisons": comparisons, "inputs_unchanged": True,
        }
    except AcceptanceError:
        raise
    except Exception as exc:
        raise AcceptanceError(f"Unsupported/malformed input or unavailable reader: {type(exc).__name__}: {exc}") from exc
    finally:
        for snapshot in snapshots:
            snapshot.unchanged()
    payload = json.dumps(report, indent=2, allow_nan=False) + "\n"
    # Publish a complete file exclusively. A competing report is never overwritten,
    # and write failures leave no partial acceptance report at the requested path.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n",
                                         dir=output.parent, prefix=".roundtrip-", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        for snapshot in snapshots:
            snapshot.unchanged()
        os.link(temporary, output)
    except OSError as exc:
        raise AcceptanceError(f"Cannot exclusively create report: {output}: {exc}") from exc
    finally:
        if temporary is not None:
            try:
                temporary.unlink()
            except OSError:
                # Best effort for this invocation's own file; never turn a
                # published certificate into an apparent verification failure.
                pass
    return report


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-k", required=True)
    parser.add_argument("--native-k", required=True)
    parser.add_argument("--source-inp")
    parser.add_argument("--meshio-package", help="Existing pure-Python meshio package directory; no installation")
    parser.add_argument("--report", required=True)
    args = parser.parse_args(argv)
    try:
        report = verify_native_mesh_roundtrip(args.source_k, args.native_k, report_path=args.report,
                                              source_inp=args.source_inp, meshio_package=args.meshio_package)
    except (AcceptanceError, OSError) as exc:
        print(json.dumps({"passed": False, "error": str(exc), "details": getattr(exc, "details", {})},
                         indent=2, allow_nan=False), file=sys.stderr)
        return 1
    print(json.dumps({"passed": True, "report": str(Path(args.report).absolute()),
                      "comparisons": report["comparisons"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
