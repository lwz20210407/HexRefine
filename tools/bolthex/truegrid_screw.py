"""Bounded TrueGrid K import and fail-closed H8 audit; no TG runtime required.

This is an original mesh-only research adapter, not a screw generator. In
particular, a collapsed eight-slot LS-DYNA solid is NOT a nondegenerate H8.
No upstream proprietary command stream is distributed by this module.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
import hashlib
from itertools import product
import json
from pathlib import Path

import numpy as np

from .mesh_audit import SIGNS, audit_h8

MAX_ELEMENTS = 100_000
MAX_BYTES = 32 * 1024 * 1024
MINIMUM_SJ = 0.15
COINCIDENCE_MM = 1e-10


@dataclass(frozen=True)
class ImportedSolids:
    nodes: np.ndarray
    elements: np.ndarray
    node_ids: np.ndarray
    element_ids: np.ndarray
    part_ids: np.ndarray
    element_cards: dict[str, int]
    source_sha256: str


def _fields(line, widths):
    if ',' in line:
        return [v.strip() for v in line.split(',')]
    values = line.split()
    if len(values) >= len(widths):
        return values
    result, offset = [], 0
    for width in widths:
        result.append(line[offset:offset + width].strip())
        offset += width
    return result


def read_keyword(path: Path) -> ImportedSolids:
    """Read TG's basic NODE/ELEMENT_SOLID subset without welding or reordering.

    Non-solid element cards are counted, never silently accepted as H8. Includes,
    transforms, alternate node/solid encodings and incomplete decks fail closed.
    Material/section cards are irrelevant to this mesh-only audit, not certified.
    """
    path = Path(path)
    if path.stat().st_size > MAX_BYTES:
        raise ValueError('K exceeds the 32 MiB research input budget')
    node_rows, solid_rows = [], []
    cards = Counter()
    node_ids, element_ids = set(), set()
    card, ended = '', False
    data = path.read_bytes()
    for number, raw in enumerate(data.decode('ascii').splitlines(), 1):
        content = raw.split('$', 1)[0].rstrip()
        line = content.strip()
        if not line:
            continue
        if ended:
            raise ValueError('Content after *END is not supported')
        if line.startswith('*'):
            card = line.upper()
            if (card.startswith(('*INCLUDE', '*DEFINE_TRANSFORMATION', '*PARAMETER'))
                    or card.startswith('*NODE') and card != '*NODE'
                    or card.startswith('*ELEMENT_SOLID') and card != '*ELEMENT_SOLID'):
                raise ValueError(f'Unsupported mesh-affecting card: {card}')
            if card.startswith('*ELEMENT'):
                cards.setdefault(card, 0)
            if card == '*END':
                ended = True
            continue
        try:
            if card == '*NODE':
                fields = _fields(content, (8, 16, 16, 16))
                nid = int(fields[0])
                xyz = tuple(float(v.replace('D', 'E').replace('d', 'e')) for v in fields[1:4])
                if nid <= 0 or nid in node_ids or len(xyz) != 3 or not np.isfinite(xyz).all():
                    raise ValueError('Invalid/duplicate node ID or nonfinite coordinate')
                node_ids.add(nid)
                node_rows.append((nid, *xyz))
                if len(node_rows) > 8 * MAX_ELEMENTS:
                    raise ValueError('Node budget exceeded')
            elif card.startswith('*ELEMENT'):
                cards[card] += 1
                if sum(cards.values()) > MAX_ELEMENTS:
                    raise ValueError('Element budget exceeds 100000')
                if card != '*ELEMENT_SOLID':
                    continue
                fields = _fields(content, (8,) * 10)
                if len(fields) != 10:
                    raise ValueError('Expected EID, PID and exactly eight solid node slots')
                row = tuple(int(v) for v in fields)
                if row[0] <= 0 or row[0] in element_ids or row[1] <= 0:
                    raise ValueError('Invalid/duplicate solid ID or part ID')
                element_ids.add(row[0])
                solid_rows.append(row)
        except (ValueError, IndexError) as error:
            raise ValueError(f'{path.name}:{number}: {error}') from error
    if not ended or not node_rows or not solid_rows:
        raise ValueError('Require *END, nodes and nonempty eight-slot solids')
    ids = np.array([r[0] for r in node_rows], dtype=np.int64)
    lookup = {int(n): i for i, n in enumerate(ids)}
    solids = np.array(solid_rows, dtype=np.int64)
    try:
        elements = np.array([[lookup[int(n)] for n in row[2:]] for row in solids], dtype=np.int64)
    except KeyError as error:
        raise ValueError(f'Missing solid node reference: {error.args[0]}') from error
    return ImportedSolids(np.array([r[1:] for r in node_rows], dtype=float), elements,
                          ids, solids[:, 0], solids[:, 1], dict(cards),
                          hashlib.sha256(data).hexdigest())


def audit_import(mesh: ImportedSolids) -> dict:
    """Diagnose rejected cells and apply the explicitly historical project screen.

    Volume is the exact 2x2x2 integration of each trilinear FE map, NOT CAD
    fidelity. Corner/center/Gauss sampling does not certify positivity everywhere.
    Axis below means the original Screw's global Z axis (x=y=0).
    """
    nodes, elements = np.asarray(mesh.nodes), np.asarray(mesh.elements)
    if (nodes.ndim != 2 or nodes.shape[1] != 3 or not np.isfinite(nodes).all()
            or elements.ndim != 2 or elements.shape[1] != 8 or not len(elements)
            or not np.issubdtype(elements.dtype, np.integer)
            or elements.min() < 0 or elements.max() >= len(nodes)):
        raise ValueError('Invalid finite nodes/integer eight-slot connectivity')
    if len(elements) > MAX_ELEMENTS:
        raise ValueError('Element budget exceeds 100000')
    if len(mesh.element_ids) != len(elements) or len(np.unique(mesh.element_ids)) != len(elements):
        raise ValueError('Invalid element IDs')
    id_hist, geometry_hist = Counter(), Counter()
    repeated, coincident, axis_collapsed, bad_corner, bad_gauss, bad_volume = ([] for _ in range(6))
    bad_center=[];min_center_det=min_center_sj=float('inf')
    min_sj, min_corner_det, min_gauss_det = float('inf'), float('inf'), float('inf')
    volume, min_volume = 0.0, float('inf')
    for start in range(0, len(elements), 4096):
        conn = elements[start:start + 4096]
        xyz = nodes[conn]
        ids = mesh.element_ids[start:start + len(conn)]
        unique_ids = 1 + np.count_nonzero(np.diff(np.sort(conn, axis=1), axis=1), axis=1)
        id_hist.update(map(int, unique_ids))
        distance = np.linalg.norm(xyz[:, :, None] - xyz[:, None, :], axis=3)
        close = distance <= COINCIDENCE_MM
        labels = np.broadcast_to(np.arange(8), (len(conn), 8)).copy()
        # Connected components of the per-cell coincidence graph, without welding.
        for _ in range(8):
            labels = np.where(close, labels[:, None, :], 8).min(axis=2)
        unique_xyz = 1 + np.count_nonzero(np.diff(np.sort(labels, axis=1), axis=1), axis=1)
        geometry_hist.update(map(int, unique_xyz))
        axis = np.hypot(xyz[:, :, 0], xyz[:, :, 1]) <= COINCIDENCE_MM
        collapse = np.any(close & axis[:, :, None] & axis[:, None, :]
                          & ~np.eye(8, dtype=bool), axis=(1, 2))
        repeated.extend(map(int, ids[unique_ids != 8]))
        coincident.extend(map(int, ids[unique_xyz != 8]))
        axis_collapsed.extend(map(int, ids[collapse]))
        xyz = xyz - xyz[:, :1]

        def jac(q):
            u, v, w = q
            derivatives = np.column_stack((
                SIGNS[:, 0] * (1 + SIGNS[:, 1] * v) * (1 + SIGNS[:, 2] * w),
                SIGNS[:, 1] * (1 + SIGNS[:, 0] * u) * (1 + SIGNS[:, 2] * w),
                SIGNS[:, 2] * (1 + SIGNS[:, 0] * u) * (1 + SIGNS[:, 1] * v))) / 8
            return np.einsum('eni,nj->eij', xyz, derivatives)

        corner_ok, gauss_ok = np.ones(len(conn), bool), np.ones(len(conn), bool)
        for q in product((-1, 1), repeat=3):
            j = jac(q)
            det = np.linalg.det(j)
            denominator = np.linalg.norm(j, axis=1).prod(axis=1)
            sj = np.divide(det, denominator, out=np.zeros_like(det), where=denominator > 0)
            min_sj = min(min_sj, float(sj.min()))
            min_corner_det = min(min_corner_det, float(det.min()))
            corner_ok &= (sj >= MINIMUM_SJ) & (det > 0) & np.isfinite(sj)
        j=jac((0.,0.,0.));det=np.linalg.det(j);denominator=np.linalg.norm(j,axis=1).prod(axis=1)
        sj=np.divide(det,denominator,out=np.zeros_like(det),where=denominator>0)
        min_center_det=min(min_center_det,float(det.min()));min_center_sj=min(min_center_sj,float(sj.min()))
        center_ok=(det>0)&np.isfinite(det)&np.isfinite(sj)&(sj>=MINIMUM_SJ)
        bad_center.extend(map(int,ids[~center_ok]))
        volumes = np.zeros(len(conn))
        for q in product((-1 / np.sqrt(3), 1 / np.sqrt(3)), repeat=3):
            det = np.linalg.det(jac(q))
            min_gauss_det = min(min_gauss_det, float(det.min()))
            gauss_ok &= (det > 0) & np.isfinite(det)
            volumes += det
        volume += float(volumes.sum())
        min_volume = min(min_volume, float(volumes.min()))
        bad_corner.extend(map(int, ids[~corner_ok]))
        bad_gauss.extend(map(int, ids[~gauss_ok]))
        bad_volume.extend(map(int, ids[(volumes <= 0) | ~np.isfinite(volumes)]))
    reasons = []
    other = {k: v for k, v in mesh.element_cards.items() if k != '*ELEMENT_SOLID'}
    for condition, message in (
        (bool(other), 'Non-H8/unsupported element cards present'),
        (bool(repeated), 'Repeated node IDs in eight-slot solids'),
        (bool(coincident), 'Geometrically collapsed solids; eight unique positions required'),
        (bool(axis_collapsed), 'Z-axis collapse (wedge-like solids are not H8)'),
        (bool(bad_corner), 'Legacy project corner SJ screen below 0.15 or nonpositive corner determinant; not a vendor standard'),
        (bool(bad_center), 'Legacy project center SJ screen below 0.15 or nonpositive center determinant; not a vendor standard'),
        (bool(bad_gauss), 'Nonpositive/nonfinite Gauss determinant'),
        (bool(bad_volume), 'Nonpositive/nonfinite integrated element volume'),
    ):
        if condition:
            reasons.append(message)
    topology = None
    if not reasons:
        try:
            topology, _ = audit_h8(nodes, elements, minimum_sj=MINIMUM_SJ)
        except ValueError as error:
            reasons.append(str(error))
    return dict(schemaVersion=1, purpose='TrueGrid research mesh-only audit',
                sourceSHA256=mesh.source_sha256, nodes=len(nodes), solids=len(elements),
                elementCards=mesh.element_cards, uniqueNodeIDHistogram=dict(sorted(id_hist.items())),
                uniquePositionHistogram=dict(sorted(geometry_hist.items())),
                repeatedNodeElementIDs=repeated, coincidentPositionElementIDs=coincident,
                axisCollapsedElementIDs=axis_collapsed, badCornerElementIDs=bad_corner,
                badGaussElementIDs=bad_gauss, nonpositiveVolumeElementIDs=bad_volume,
                minimumCornerScaledJacobian=min_sj, minimumCornerJacobian=min_corner_det,
                minimumCenterJacobian=min_center_det,minimumCornerAndCenterScaledJacobian=min(min_sj,min_center_sj),
                badCenterElementIDs=bad_center,
                minimumGaussJacobian=min_gauss_det, integratedVolume=volume,
                minimumElementVolume=min_volume, topology=topology, rejectionReasons=reasons,
                meshOnlyAccepted=not reasons, fullModelAccepted=False,
                legacyProjectScreenPassed=not reasons,engineeringQualityAccepted=False,
                qualityScreenBasis='historical-project-screen-not-vendor-standard',
                minimumAllowedCornerSJ=MINIMUM_SJ, coincidenceToleranceMM=COINCIDENCE_MM,
                cadVolumeLimit=1e-4, cadSurfaceLimitMM=2e-6, cadExchangeLimit=1e-7,
                cadVerified=False, jacobianScope='8 corners, center and 8 Gauss points; not a global positivity proof',
                limitations=['No CAD, solver, global overlap or complete screw coverage certification.',
                             'Six unique positions indicate collapse, not a certified C3D6 conversion.',
                             'No welding, orientation repair, axis deletion or hollow-core substitution.'],
                repairApplied=False)


def require_nondegenerate_h8(mesh: ImportedSolids) -> dict:
    report = audit_import(mesh)
    if not report['meshOnlyAccepted']:
        raise ValueError('H8 import rejected: ' + '; '.join(report['rejectionReasons']))
    return report


def write_diagnostic_inp(mesh: ImportedSolids, path: Path):
    """Preserve original IDs and all eight slots, even for a REJECTED negative.

    The diagnostic is intentionally not repaired or promoted to C3D6. It has no
    solver/material cards and must not be interpreted as an accepted FE model.
    """
    report = audit_import(mesh)
    status = 'LEGACY PROJECT SCREEN PASSED; ENGINEERING QUALITY NOT CERTIFIED' if report['meshOnlyAccepted'] else 'REJECTED H8 NEGATIVE CONTROL'
    with Path(path).open('x', encoding='ascii') as out:
        out.write(f'*HEADING\n{status}; NOT CAD OR SOLVER VALIDATION\n')
        out.write('** Eight-slot connectivity preserved without welding or repair.\n*NODE\n')
        for nid, xyz in zip(mesh.node_ids, mesh.nodes):
            out.write(str(int(nid)) + ', ' + ', '.join(format(float(v), '.17g') for v in xyz) + '\n')
        for pid in np.unique(mesh.part_ids):
            out.write(f'*ELEMENT, TYPE=C3D8, ELSET=TG_PART_{int(pid)}\n')
            for eid, conn in zip(mesh.element_ids[mesh.part_ids == pid], mesh.elements[mesh.part_ids == pid]):
                out.write(str(int(eid)) + ', ' + ', '.join(str(int(mesh.node_ids[i])) for i in conn) + '\n')
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('keyword', type=Path)
    parser.add_argument('output', type=Path, help='New evidence directory; never overwrite old evidence')
    args = parser.parse_args(argv)
    mesh = read_keyword(args.keyword)
    report = audit_import(mesh)
    args.output.mkdir(exist_ok=False)
    write_diagnostic_inp(mesh, args.output / 'diagnostic.inp')
    (args.output / 'audit.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n', encoding='ascii')
    (args.output / 'result.txt').write_text(
        ('LEGACY PROJECT SCREEN PASSED; ENGINEERING QUALITY NOT CERTIFIED' if report['meshOnlyAccepted'] else 'REJECTED')
        + '\nNot full screw/CAD/solver acceptance.\n'
        + f"Nodes: {report['nodes']}; eight-slot solids: {report['solids']}\n"
        + f"Unique node IDs per solid: {report['uniqueNodeIDHistogram']}\n"
        + f"Unique positions per solid: {report['uniquePositionHistogram']}\n"
        + f"Axis-collapsed solids: {len(report['axisCollapsedElementIDs'])}\n"
        + f"Corner-gate failures (including collapse): {len(report['badCornerElementIDs'])}\n"
        + f"Min corner SJ: {report['minimumCornerScaledJacobian']:.17g}\n"
        + f"Min Gauss determinant: {report['minimumGaussJacobian']:.17g}\n"
        + f"Integrated volume (input coordinate units cubed): {report['integratedVolume']:.17g}\n"
        + '\n'.join(report['rejectionReasons']) + '\n', encoding='ascii')
    print(json.dumps(report, indent=2, allow_nan=False))
    return 0 if report['meshOnlyAccepted'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
