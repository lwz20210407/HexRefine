"""Abaqus INP 文件导出 (mm-t-N-s 单位制)"""
from .version import APP_NAME, APP_VERSION

def write_inp(meshes, path, elem_type='C3D8R', with_material=True):
    lines = []
    lines.append('*HEADING')
    lines.append(f'** {APP_NAME!s} v{APP_VERSION!s} (all-hexahedral bolt connection mesh)')
    lines.append('** Units: mm, N, t, s, MPa')
    if with_material:
        lines.append('**')
        lines.append('*MATERIAL, NAME=STEEL')
        lines.append('*ELASTIC')
        lines.append('206000., 0.3')
        lines.append('*DENSITY')
        lines.append('7.85E-9')
    for mesh in meshes:
        lines.append('**------------------------------------------------------------')
        lines.append('*PART, NAME=%s' % mesh.name)
        lines.append('*NODE')
        for i, (x, y, z) in enumerate(mesh.nodes, start=1):
            lines.append('%d, %.6f, %.6f, %.6f' % (i, x, y, z))
        None
        lines.append('*ELEMENT, TYPE=%s, ELSET=EALL' % elem_type)
        for i, e in enumerate(mesh.elems, start=1):
            lines.append('%d, %s' % (i, ', '.join((str(int(n) + 1) for n in e))))
        for reg in mesh.region_names:
            ids = [i + 1 for i, r in enumerate(mesh.regions) if r == reg]
            lines.extend(_fmt_set('ELSET', 'E_%s' % reg, ids))
        if with_material:
            lines.append('*SOLID SECTION, ELSET=EALL, MATERIAL=STEEL')
        for sname, faces in mesh.surfaces.items():
            if not faces:
                continue
            lines.append('*SURFACE, TYPE=ELEMENT, NAME=%s' % sname)
            for eid, face in faces:
                lines.append('%d, %s' % (eid, face))
        lines.append('*END PART')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    return path
    r = None
    i = None
    return path

def _fmt_set(kind, name, ids, per_line=8):
    out = [f'*{kind!s}, {kind!s}={name!s}']
    for i in range(0, len(ids), per_line):
        out.append(', '.join((str(v) for v in ids[i:i + per_line])))
    return out
