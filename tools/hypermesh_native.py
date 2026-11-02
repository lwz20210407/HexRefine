"""Save/reopen a real native HM using an installed, licensed HyperMesh host."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def make_tcl(mesh, cad, output, template, nodes, elements, solids, associate, tolerance, boundary):
    source = Path(__file__).with_suffix('.tcl').read_text(encoding='utf-8')
    values = dict(MESH=str(mesh).encode().hex(), CAD=('' if cad is None else str(cad)).encode().hex(),
                  DATABASE=str(output / 'model.hm').encode().hex(), AUDIT=str(output / 'host-audit.txt').encode().hex(),
                  TEMPLATE=str(template).encode().hex(), ROUNDTRIP=str(output / 'roundtrip.k').encode().hex(),
                  NODES=str(nodes), ELEMENTS=str(elements), SOLIDS=str(solids),
                  ASSOCIATE=str(int(associate)), TOLERANCE=format(tolerance, '.17g'),
                  BOUNDARY=' '.join(str(int(n)) for n in boundary))
    for key, value in values.items():
        source = source.replace('@' + key + '@', value)
    return source


def export_hm(mesh, source_report, executable, output, cad=None, cad_report=None,
              associate=False, tolerance=1e-7, debug_discrete_cad=False):
    mesh, source_report, executable, output = [Path(p).resolve() for p in [mesh, source_report, executable, output]]
    if output.exists() or not output.parent.is_dir():
        raise ValueError('Require a new output directory with an existing parent')
    if not executable.is_file() or executable.name.lower() != 'hmbatch.exe':
        raise ValueError('An installed hmbatch.exe must be selected explicitly')
    if mesh.suffix.lower() not in ('.k', '.key'):
        raise ValueError('This bounded adapter imports mesh-only LS-DYNA K')
    report = json.loads(source_report.read_text())
    if _sha(mesh) != report['kSHA256'] or not all(type(report[k]) is int and report[k] > 0 for k in ['nodes', 'elements']):
        raise ValueError('Source mesh certificate does not match the K file')
    if not math.isfinite(tolerance) or not 0 < tolerance <= 1e-5:
        raise ValueError('Association tolerance must be positive and no more than 1e-5; snapping is disabled')
    solids = 0
    if cad is not None:
        cad = Path(cad).resolve()
        if cad_report is None or cad.suffix.lower() not in ('.step', '.stp'):
            raise ValueError('CAD mode requires STEP and its generation certificate')
        cr = json.loads(Path(cad_report).read_text())
        if not debug_discrete_cad and not cr.get('geometryIndependentOfMesh', False):
            raise ValueError('Independent design CAD is required; FE-station geometry is diagnostic only')
        if _sha(cad) != cr['stepSHA256'] or type(cr['solids']) is not int or cr['solids'] < 1:
            raise ValueError('CAD certificate does not match STEP')
        if cr['relativeMeshVolumeError'] is None or cr['relativeMeshVolumeError'] > 1e-4:
            raise ValueError('CAD has not been checked against this discrete mesh volume')
        if abs(cr['meshVolume'] - report['volume']) / report['volume'] > 1e-10:
            raise ValueError('CAD certificate refers to a different mesh volume')
        solids = cr['solids']
    elif associate:
        raise ValueError('Association requires CAD')
    template = executable.parents[3] / 'templates/feoutput/ls-dyna971/dyna971_R112.key'
    if not template.is_file():
        raise ValueError('Matching LS-DYNA R11 output template is unavailable')
    from ansys.dyna.core import Deck
    import numpy as np
    deck = Deck(); deck.import_file(str(mesh))
    nd = next(deck.get_kwds_by_type('NODE')).nodes
    ed = next(deck.get_kwds_by_full_type('ELEMENT', 'SOLID')).elements
    ids = nd['nid'].to_numpy(np.int64)
    elements = ed[[f'n{i}' for i in range(1, 9)]].to_numpy(np.int64)
    if len(ids) != report['nodes'] or len(elements) != report['elements'] or not np.array_equal(ids, np.arange(1, len(ids) + 1)):
        raise ValueError('K certificate/count/ID mismatch')
    if elements.min() < 1 or elements.max() > len(ids) or not np.all(np.diff(np.sort(elements, axis=1), axis=1) > 0):
        raise ValueError('Invalid H8 connectivity')
    faces = elements[:, [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]].reshape(-1,4)
    _, first, counts = np.unique(np.sort(faces, axis=1), axis=0, return_index=True, return_counts=True)
    if np.any(counts > 2):
        raise ValueError('Nonmanifold input faces')
    boundary = np.unique(faces[first[counts == 1]])
    output.mkdir()
    tcl = output / 'export.tcl'
    tcl.write_text(make_tcl(mesh, cad, output, template, report['nodes'], report['elements'], solids, associate, tolerance, boundary), encoding='utf-8')
    startup = None
    if hasattr(subprocess, 'STARTUPINFO'):
        startup = subprocess.STARTUPINFO();startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = subprocess.SW_HIDE
    with (output / 'host.stdout.log').open('w', encoding='utf-8') as stdout, (output / 'host.stderr.log').open('w', encoding='utf-8') as stderr:
        process = subprocess.Popen([str(executable), '-tcl', str(tcl), '-nocommand'], cwd=output,
                                   stdout=stdout, stderr=stderr, startupinfo=startup)
        try:
            process.wait(timeout=300)
        except subprocess.TimeoutExpired:
            # hmbatch is a launcher on Windows; terminate only this owned tree.
            if process.poll() is None:
                if hasattr(subprocess, 'STARTUPINFO'):
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                   stdout=stderr, stderr=stderr, startupinfo=startup, timeout=30)
                else:
                    process.kill()
                process.wait(timeout=30)
            raise
    audit = output / 'host-audit.txt'
    stats = dict(line.split(' ', 1) for line in audit.read_text().splitlines() if ' ' in line) if audit.exists() else {}
    if process.returncode != 0 or stats.get('status') != 'complete' or stats.get('meshUnchanged') != '1':
        raise RuntimeError('HyperMesh export/reopen did not pass; inspect retained host logs')
    if _sha(mesh) != report['kSHA256']:
        raise RuntimeError('Source K changed during native export')
    database = output / 'model.hm'
    result = dict(schemaVersion=1, mode='cad-and-mesh' if cad else 'mesh-only',
        host=str(executable), nativeHm=True, hmSHA256=_sha(database), sourceKSHA256=_sha(mesh),
        sourceStepSHA256=None if cad is None else _sha(cad), hostExitCode=process.returncode,
        **{key:int(stats[key]) for key in ['nodes', 'elements', 'surfaces', 'solids', 'associatedNodes', 'boundaryNodes']},
        savedAndReopened=True, meshDataUnchanged=True, nodeSnapping=False,
        associationTolerance=tolerance if associate else None,
        limitations=['Native HM requires installed HyperMesh; K/INP do not.',
          'CAD mode retains the supplied STEP representation; it does not manufacture missing CAD.',
          'Association is not a certificate of analytical-helix or standard compliance.'])
    (output / 'report.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('mesh');p.add_argument('source_report');p.add_argument('output')
    p.add_argument('--hmbatch', required=True);p.add_argument('--cad');p.add_argument('--cad-report')
    p.add_argument('--associate', action='store_true');p.add_argument('--tolerance', type=float, default=1e-7)
    p.add_argument('--debug-discrete-cad', action='store_true')
    a = p.parse_args()
    print(json.dumps(export_hm(a.mesh, a.source_report, a.hmbatch, a.output, a.cad, a.cad_report, a.associate, a.tolerance, a.debug_discrete_cad), indent=2))
