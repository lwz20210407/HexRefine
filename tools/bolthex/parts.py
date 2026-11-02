"""Recovered BoltHex generators, corrected against shipped bytecode."""
import math
import numpy as np
from .standards import THREAD_DEPTH_COEF, DEDUCT_COEF
from .mesh_core import build_bolt_section, build_head_ring_section, build_nut_section, build_plate_section, build_ring_section, revolve, add_surface, hexagon_R, thread_R, merge_by_coords

def _hex_fn(s):
    return lambda th: hexagon_R(th, s)

def build_bolt(d, P, L, b, k, s, chamfer=0.7, threaded=True, head_type='hex', dk=None, n=8, nr1=2, nr2=3, lp=6, n_shank=3, n_head=3, offset=(0.0, 0.0, 0.0), name='BOLT'):
    R = d / 2.0
    Rmaj, Rmin = (R, R - THREAD_DEPTH_COEF * P)
    if head_type == 'round':
        dk = dk or 1.75 * d
        ref_out = dk / 2.0
    elif head_type == 'cyl':
        dk = dk or 1.5 * d
        ref_out = dk / 2.0
    else:
        ref_out = s / 2.0
    if ref_out <= R * 1.02:
        raise ValueError('头部外形半径 %.3f 必须大于杆半径 %.3f' % (ref_out, R))
    n_head = max(1, int(n_head))
    secA = build_bolt_section(n, nr1, nr2, d, d, ref_circle=True)
    layA, regA = ([], [])
    b_use = min(b, L)
    if b_use > 0:
        nt = max(2, int(math.ceil(b_use / P * lp)))
        for i in range(nt + 1):
            z = b_use * i / nt
            amp = min(1.0, z / P) if threaded else 0.0

            def f(th, z=z, amp=amp):
                if amp == 0.0 and (not threaded):
                    return Rmaj
                prof = thread_R(z, th, P, Rmaj, Rmin)
                return Rmin + amp * (prof - Rmin)
            layA.append((z, f, None))
            if i < nt:
                regA.append('THREAD')
    else:
        layA.append((0.0, lambda th: Rmaj, None))
    if L > b_use:
        for i in range(1, n_shank + 1):
            z = b_use + (L - b_use) * i / n_shank
            layA.append((z, lambda th: Rmaj, None))
            regA.append('SHANK')
    head_zs = [L + k * i / n_head for i in range(n_head + 1)]
    for z in head_zs[1:]:
        layA.append((z, lambda th: Rmaj, None))
        regA.append('HEAD')
    mA, qA = revolve(secA, layA, regA, name + '_CORE')
    nlA = len(layA)
    add_surface(mA, qA, secA, nlA, 'S_THREAD', 'ring2', 'THREAD', 'S4', 'outer')
    add_surface(mA, qA, secA, nlA, 'S_SHANK', 'ring2', 'SHANK', 'S4', 'outer')
    if head_type == 'round':
        Rh = dk / 2.0
        Rtop = min(max(0.75 * Rh, 1.25 * R), 0.92 * Rh)
        if Rtop <= R * 1.02:
            raise ValueError('圆头尺寸过小: 顶部半径 %.3f 必须大于杆半径 %.3f' % (Rtop, R))
        c = (Rtop ** 2 - Rh ** 2 + k ** 2) / (2.0 * k)
        Rs = math.sqrt(Rh ** 2 + c ** 2)
        zc = L + c
    elif head_type == 'hex' and s - 2.0 * chamfer <= d:
        raise ValueError('头顶倒角过大: 顶部对边距 %.3f 必须大于杆径 %.3f' % (s - 2.0 * chamfer, d))
    layB = []
    for i, z in enumerate(head_zs):
        if head_type == 'hex':
            se = s - 2.0 * chamfer if i == n_head else s
            f = lambda th, se=se: hexagon_R(th, se)
        elif head_type == 'round':
            Rr = math.sqrt(max(Rs ** 2 - (z - zc) ** 2, Rtop ** 2))
            f = lambda th, Rr=Rr: Rr
        else:
            f = lambda th, Rh=dk / 2.0: Rh
        layB.append((z, f, None))
    secB = build_head_ring_section(n, nr2, R, ref_out)
    mB, qB = revolve(secB, layB, ['HEAD'] * n_head, name + '_HEADRING')
    nlB = len(layB)
    add_surface(mB, qB, secB, nlB, 'S_BEAR', 'ring', None, 'S1', None)
    add_surface(mB, qB, secB, nlB, 'S_HEAD', 'ring', None, 'S4', 'outer')
    mesh = merge_by_coords([mA, mB], name)
    if offset != (0.0, 0.0, 0.0):
        mesh.nodes += np.array(offset)
    mesh.dims = dict(d=d, P=P, L=L, b=b_use, k=k, s=s)
    return mesh

def build_nut(d, P, s, m, chamfer=0.7, clearance=0.0, threaded=True, shape='hex', d_out=None, n=8, nr=4, lp=6, offset=(0.0, 0.0, 0.0), name='NUT'):
    D1 = d - DEDUCT_COEF * P
    if shape in ('round', 'dome'):
        d_out = d_out or s
        s_sec = d_out
    else:
        s_sec = s
    sec = build_nut_section(n, nr, D1, s_sec)
    Rin_crest = D1 / 2.0 + clearance
    Rin_root = d / 2.0 + clearance
    nt = max(3, int(math.ceil(m / P * lp)))
    if shape == 'dome':
        Ro0 = d_out / 2.0
        kd = min(0.3 * m, 0.35 * d_out)
        Rtop = max(0.55 * Ro0, Rin_root + 0.12 * Ro0)
        u = ((Ro0 ** 2 - Rtop ** 2) / kd + kd) / 2.0
        Rsq = Rtop ** 2 + u * u
        zc = m - u
    layers, regions = ([], [])
    for i in range(nt + 1):
        z = m * i / nt
        if shape == 'dome':
            Rr = math.sqrt(max(Rsq - (z - zc) ** 2, Rtop * Rtop)) if z > m - kd else d_out / 2.0
            if i == 0:
                Rr = d_out / 2.0 - chamfer
            fout = lambda th, Rr=Rr: Rr
        elif shape == 'round':
            Ro = d_out / 2.0 - (chamfer if i in (0, nt) else 0.0)
            fout = lambda th, Ro=Ro: Ro
        else:
            s_eff = s if 0 < i < nt else s - 2.0 * chamfer
            fout = _hex_fn(s_eff)
        if threaded:

            def fin(th, z=z):
                return thread_R(z, th, P, Rin_crest, Rin_root, phase0=0.5)
        else:
            fin = lambda th: Rin_crest
        layers.append((z, fout, fin))
        if i < nt:
            regions.append('NUT')
    mesh, quads = revolve(sec, layers, regions, name)
    nl = len(layers)
    add_surface(mesh, quads, sec, nl, 'S_NTHREAD', 'ring', 'NUT', 'S6', 'inner')
    add_surface(mesh, quads, sec, nl, 'S_NBEAR', 'ring', 'NUT', 'S1', None)
    add_surface(mesh, quads, sec, nl, 'S_NTOP', 'ring', 'NUT', 'S2', None)
    add_surface(mesh, quads, sec, nl, 'S_NOUT', 'ring', 'NUT', 'S4', 'outer')
    if offset != (0.0, 0.0, 0.0):
        mesh.nodes += np.array(offset)
    mesh.dims = dict(d=d, P=P, s=s, m=m)
    return mesh

def build_plate(Lx, Ly, t, dhole, threaded=False, d_thread=0.0, P=1.0, clearance=0.0, n=8, nr=3, mr=2, mt=2, nz=4, lp=6, cx=0.0, cy=0.0, offset=(0.0, 0.0, 0.0), name='PLATE', shape='rect', D_out=None, nr_disc=None):
    if shape == 'cyl':
        Ro = (D_out or 60.0) / 2.0
        if Ro <= dhole / 2.0 * 1.05:
            raise ValueError('圆盘外径 %.3f 必须明显大于孔径 %.3f' % (2.0 * Ro, dhole))
        nr_ring = max(1, int(nr_disc or nr))
        sec = build_ring_section(n, nr_ring, dhole / 2.0, Ro)
        band = 'ring'
    else:
        sec = build_plate_section(n, nr, mr, mt, Lx, Ly, dhole)
        band = 'pring'
    layers, regions = ([], [])
    if threaded:
        D1 = d_thread - DEDUCT_COEF * P
        Rin_crest = D1 / 2.0 + clearance
        Rin_root = d_thread / 2.0 + clearance
        nlay = max(3, int(math.ceil(t / P * lp)))
    else:
        nlay = nz
    for i in range(nlay + 1):
        z = t * i / nlay
        if threaded:

            def fin(th, z=z):
                return thread_R(z, th, P, Rin_crest, Rin_root, phase0=0.5)
        else:
            fin = None
        layers.append((z, None, fin))
        if i < nlay:
            regions.append('PLATE')
    mesh, quads = revolve(sec, layers, regions, name)
    nl = len(layers)
    add_surface(mesh, quads, sec, nl, 'S_HOLE', band, 'PLATE', 'S6', 'inner')
    add_surface(mesh, quads, sec, nl, 'S_PBOT', None, 'PLATE', 'S1', None)
    add_surface(mesh, quads, sec, nl, 'S_PTOP', None, 'PLATE', 'S2', None)
    if shape == 'cyl':
        add_surface(mesh, quads, sec, nl, 'S_POUT', 'ring', 'PLATE', 'S4', 'outer')
    if cx or cy:
        mesh.nodes[:, 0] += cx
        mesh.nodes[:, 1] += cy
    if offset != (0.0, 0.0, 0.0):
        mesh.nodes += np.array(offset)
    mesh.dims = dict(Lx=Lx, Ly=Ly, t=t, dhole=dhole, shape=shape, D_out=D_out)
    return mesh
