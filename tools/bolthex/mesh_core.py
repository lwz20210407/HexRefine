"""全六面体网格核心
思路: 每个垂直于轴线的截面采用结构化四边形拓扑(蝶形/O-grid),
沿轴向(z)分层扫掠生成 C3D8 单元; 螺纹通过外边界半径的螺旋函数
R(z, theta) 实现真实三维螺旋牙型。

截面每个点保存:
  theta    极角(度)
  rho_ref  参考半径
  alpha    外边界跟随系数: rho += alpha * (Rout(z,th) - rout_ref)
  beta     内边界跟随系数: rho += beta  * (Rin(z,th)  - rin_ref)
"""
import math, numpy as np
DEG60 = 60.0

class Section:
    """带参数化径向映射的二维截面四边形网格"""

    def __init__(self, rin_ref=0.0):
        self.x = []
        self.y = []
        self.theta = []
        self.rho = []
        self.alpha = []
        self.beta = []
        self.rout_ref = []
        self.rin_ref = rin_ref
        self.quads = []
        self.qband = []
        self.qj = []
        self.qjmax = []
        self._key = {}
        self.n = 0
        self.nr1 = 0
        self.nr2 = 0
        self.topo = ''

    def node(self, key, x, y, alpha, beta, rout_ref):
        key = self._canon(key)
        idx = self._key.get(key)
        if idx is not None:
            return idx
        idx = len(self.x)
        self.x.append(x)
        self.y.append(y)
        self.theta.append(math.degrees(math.atan2(y, x)) % 360.0 if x or y else 0.0)
        self.rho.append(math.hypot(x, y))
        self.alpha.append(alpha)
        self.beta.append(beta)
        self.rout_ref.append(rout_ref)
        self._key[key] = idx
        return idx

    def add_quad(self, q, band, j, jmax):
        self.quads.append(tuple(q))
        self.qband.append(band)
        self.qj.append(j)
        self.qjmax.append(jmax)

    def _canon(self, key):
        for _ in range(8):
            k2 = self._canon1(key)
            if k2 == key:
                None
                return key
            key = k2
        return key

    def _canon1(self, key):
        t = key[0]
        nr2 = self.nr2
        nr1 = self.nr1
        n = self.n
        if t in ('O', 'V'):
            return key
        elif t == 'diag':
            _, k, m = key
            if m == 0:
                return ('O',)
            elif m == n:
                return ('V', k)
            return key
        elif t == 'he':
            _, k, i = key
            if i == 0:
                return ('V', k)
            elif i == n:
                return ('V', (k + 1) % 6)
            return key
        elif t == 'secb':
            _, k, j = key
            if j == 0:
                return ('V', k)
            elif j == nr1:
                return ('c1b', k)
            return key
        elif t == 'sec1':
            _, k, i, j = key
            if i == 0:
                return ('secb', k, j)
            elif i == n:
                return ('secb', (k + 1) % 6, j)
            elif j == 0:
                return ('he', k, i)
            elif j == nr1:
                return ('c1', k, i)
            return key
        elif t == 'c1':
            _, k, i = key
            if i == 0:
                return ('c1b', k)
            elif i == n:
                return ('c1b', (k + 1) % 6)
            return key
        elif t == 'secb2':
            _, k, j = key
            if j == 0:
                return ('c1b', k)
            elif j == nr2:
                return ('outb', k)
            return key
        elif t == 'sec2':
            _, k, i, j = key
            if i == 0:
                return ('secb2', k, j)
            elif i == n:
                return ('secb2', (k + 1) % 6, j)
            elif j == 0:
                return ('c1', k, i)
            elif j == nr2:
                return ('out', k, i)
            return key
        elif t == 'out':
            _, k, i = key
            if i == 0:
                return ('outb', k)
            elif i == n:
                return ('outb', (k + 1) % 6)
            return key
        elif t == 'nsec':
            _, k, i, j = key
            if i == 0:
                return ('nsecb', k, j)
            elif i == n:
                return ('nsecb', (k + 1) % 6, j)
            elif j == 0:
                return ('nin', k, i)
            elif j == nr1:
                return ('nout', k, i)
            return key
        elif t == 'nsecb':
            _, k, j = key
            if j == 0:
                return ('ninb', k)
            elif j == nr1:
                return ('noutb', k)
            return key
        elif t == 'nin':
            _, k, i = key
            if i == 0:
                return ('ninb', k)
            elif i == n:
                return ('ninb', (k + 1) % 6)
            return key
        elif t == 'nout':
            _, k, i = key
            if i == 0:
                return ('noutb', k)
            elif i == n:
                return ('noutb', (k + 1) % 6)
            return key
        elif t == 'pring':
            _, k, i, j = key
            if i == 0:
                return ('prb', k, j)
            elif i == n:
                return ('prb', (k + 1) % 4, j)
            elif j == 0:
                return ('pin', k, i)
            elif j == nr1:
                return ('psq', k, i)
            return key
        elif t == 'prb':
            _, k, j = key
            if j == 0:
                return ('pinb', k)
            elif j == nr1:
                return ('psqb', k)
            return key
        elif t == 'pin':
            _, k, i = key
            if i == 0:
                return ('pinb', k)
            elif i == n:
                return ('pinb', (k + 1) % 4)
            return key
        elif t == 'psq':
            _, k, i = key
            if i == 0:
                return ('psqb', k)
            elif i == n:
                return ('psqb', (k + 1) % 4)
            return key
        elif t == 'ps':
            _, k, i, m = key
            if m == 0:
                return ('psq', k, i)
            elif i == 0:
                return ('psb0', k, m)
            elif i == n:
                return ('psb1', k, m)
            return key
        elif t == 'pc':
            _, c, i, j, mr, mt = key
            if j == 0:
                return ('psb1', c, i)
            elif i == 0:
                return ('psb0', (c + 1) % 4, j)
            return key
        elif t == 'hsec':
            _, k, i, j = key
            if i == 0:
                return ('hsecb', k, j)
            elif i == n:
                return ('hsecb', (k + 1) % 6, j)
            return key
        elif t == 'rsec':
            _, k, i, j = key
            if i == 0:
                return ('rsecb', k, j)
            elif i == n:
                return ('rsecb', (k + 1) % 6, j)
        return key

def hexagon_R(theta_deg, s):
    a = s / 2.0
    loc = (theta_deg + 30.0) % 60.0 - 30.0
    return a / math.cos(math.radians(loc))

def thread_R(z, theta_deg, P, Rmaj, Rmin, phase0=0.0):
    ph = (z / P - theta_deg / 360.0 + phase0) % 1.0
    d = min(ph, 1.0 - ph)
    t = (d - 0.0625) / 0.3125
    if t < 0.0:
        t = 0.0
    elif t > 1.0:
        t = 1.0
    return Rmaj + (Rmin - Rmaj) * t

def build_bolt_section(n, nr1, nr2, d, s, ref_circle=False):
    sec = Section(rin_ref=0.0)
    sec.n, sec.nr1, sec.nr2, sec.topo = (n, nr1, nr2, 'bolt')
    R = d / 2.0
    r_mid = 0.6 * R
    rc = 0.55 * r_mid
    V = [(rc * math.cos(math.radians(60 * k)), rc * math.sin(math.radians(60 * k))) for k in range(6)]
    rhombi = [(0, 1, 2), (2, 3, 4), (4, 5, 0)]
    for a, b, c in rhombi:
        C = V[c]
        A = V[a]
        for i in range(n):
            for j in range(n):
                q = [_core_pt(sec, V, a, b, c, i, j), _core_pt(sec, V, a, b, c, i + 1, j), _core_pt(sec, V, a, b, c, i + 1, j + 1), _core_pt(sec, V, a, b, c, i, j + 1)]
                sec.add_quad(q, 'core', 0, 1)
            None
    for k in range(6):
        for i in range(n):
            for j in range(nr1):
                q = [_sec1_pt(sec, V, r_mid, k, i, j), _sec1_pt(sec, V, r_mid, k, i, j + 1), _sec1_pt(sec, V, r_mid, k, i + 1, j + 1), _sec1_pt(sec, V, r_mid, k, i + 1, j)]
                sec.add_quad(q, 'ring1', j, nr1)
            None
    for k in range(6):
        for i in range(n):
            for j in range(nr2):
                q = [_sec2_pt(sec, r_mid, s, k, i, j, ref_circle), _sec2_pt(sec, r_mid, s, k, i, j + 1, ref_circle), _sec2_pt(sec, r_mid, s, k, i + 1, j + 1, ref_circle), _sec2_pt(sec, r_mid, s, k, i + 1, j, ref_circle)]
                sec.add_quad(q, 'ring2', j, nr2)
            None
    return sec
    k = None

def _core_pt(sec, V, a, b, c, i, j):
    n = sec.n
    if i == 0 and j == 0:
        key = ('O',)
    elif j == 0:
        key = ('diag', a, i)
    elif i == 0:
        key = ('diag', c, j)
    elif i == n and j == n:
        key = ('V', b)
    elif j == n:
        key = ('he', (a + 1) % 6, n - i)
    elif i == n:
        key = ('he', a, j)
    else:
        key = ('rh', a, i, j)
    x = V[a][0] * i / n + V[c][0] * j / n
    y = V[a][1] * i / n + V[c][1] * j / n
    return sec.node(key, x, y, 0.0, 0.0, 0.0)

def _sec1_pt(sec, V, r_mid, k, i, j):
    nr1 = sec.nr1
    n = sec.n
    key = ('sec1', k, i, j)
    th = math.radians(60.0 * (k + i / n))
    x0 = V[k][0] + (V[(k + 1) % 6][0] - V[k][0]) * i / n
    y0 = V[k][1] + (V[(k + 1) % 6][1] - V[k][1]) * i / n
    y1 = r_mid * math.sin(th)
    x1 = r_mid * math.cos(th)
    t = j / nr1
    return sec.node(key, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.0, 0.0, 0.0)

def _sec2_pt(sec, r_mid, s, k, i, j, ref_circle=False):
    nr2 = sec.nr2
    n = sec.n
    key = ('sec2', k, i, j)
    thd = 60.0 * (k + i / n)
    th = math.radians(thd)
    Ro = 0.5 * s if ref_circle else hexagon_R(thd, s)
    y0 = r_mid * math.sin(th)
    x0 = r_mid * math.cos(th)
    y1 = Ro * math.sin(th)
    x1 = Ro * math.cos(th)
    t = (j / nr2) ** 0.75
    y = y0 + (y1 - y0) * t
    x = x0 + (x1 - x0) * t
    alpha = 0.0 if j == 0 else (math.hypot(x, y) - r_mid) / (Ro - r_mid)
    return sec.node(key, x, y, alpha, 0.0, Ro)

def build_head_ring_section(n, nr, R, s_ref):
    sec = Section(rin_ref=R)
    sec.n, sec.nr1, sec.nr2, sec.topo = (n, nr, 0, 'headring')
    ref = s_ref / 2.0
    for k in range(6):
        for i in range(n):
            for j in range(nr):
                q = [_hsec_pt(sec, R, ref, k, i, j), _hsec_pt(sec, R, ref, k, i, j + 1), _hsec_pt(sec, R, ref, k, i + 1, j + 1), _hsec_pt(sec, R, ref, k, i + 1, j)]
                sec.add_quad(q, 'ring', j, nr)
            None
    return sec

def _hsec_pt(sec, R, ref, k, i, j):
    nr = sec.nr1
    n = sec.n
    key = ('hsec', k, i, j)
    thd = 60.0 * (k + i / n)
    th = math.radians(thd)
    t = j / nr
    r = R + (ref - R) * t
    return sec.node(key, r * math.cos(th), r * math.sin(th), t, 0.0, ref)

def build_ring_section(n, nr, Rin, Rout):
    sec = Section(rin_ref=Rin)
    sec.n, sec.nr1, sec.nr2, sec.topo = (n, nr, 0, 'ring')
    for k in range(6):
        for i in range(n):
            for j in range(nr):
                q = [_rsec_pt(sec, Rin, Rout, k, i, j), _rsec_pt(sec, Rin, Rout, k, i, j + 1), _rsec_pt(sec, Rin, Rout, k, i + 1, j + 1), _rsec_pt(sec, Rin, Rout, k, i + 1, j)]
                sec.add_quad(q, 'ring', j, nr)
            None
    return sec

def _rsec_pt(sec, Rin, Rout, k, i, j):
    nr = sec.nr1
    n = sec.n
    key = ('rsec', k, i, j)
    thd = 60.0 * (k + i / n)
    th = math.radians(thd)
    t = j / nr
    r = Rin + (Rout - Rin) * t
    return sec.node(key, r * math.cos(th), r * math.sin(th), t, 1.0 - t, Rout)

def build_nut_section(n, nr, D1, s):
    sec = Section(rin_ref=D1 / 2.0)
    sec.n, sec.nr1, sec.nr2, sec.topo = (n, nr, 0, 'nut')
    Rin = D1 / 2.0
    for k in range(6):
        for i in range(n):
            for j in range(nr):
                q = [_nsec_pt(sec, Rin, s, k, i, j), _nsec_pt(sec, Rin, s, k, i, j + 1), _nsec_pt(sec, Rin, s, k, i + 1, j + 1), _nsec_pt(sec, Rin, s, k, i + 1, j)]
                sec.add_quad(q, 'ring', j, nr)
            None
    return sec

def _nsec_pt(sec, Rin, s, k, i, j):
    nr = sec.nr1
    n = sec.n
    key = ('nsec', k, i, j)
    thd = 60.0 * (k + i / n)
    th = math.radians(thd)
    Ro = hexagon_R(thd, s)
    y0 = Rin * math.sin(th)
    x0 = Rin * math.cos(th)
    y1 = Ro * math.sin(th)
    x1 = Ro * math.cos(th)
    t = j / nr
    y = y0 + (y1 - y0) * t
    x = x0 + (x1 - x0) * t
    alpha = t
    beta = 1.0 - t
    return sec.node(key, x, y, alpha, beta, Ro)

def build_plate_section(n, nr, mr, mt, Lx, Ly, dhole):
    rh = dhole / 2.0
    a = max(1.3 * rh, rh + mr * 0.5)
    a = min(a, 0.45 * min(Lx, Ly))
    sec = Section(rin_ref=rh)
    sec.n, sec.nr1, sec.nr2, sec.topo = (n, nr, 0, 'plate')
    for k in range(4):
        for i in range(n):
            for j in range(nr):
                q = [_pring_pt(sec, rh, a, k, i, j), _pring_pt(sec, rh, a, k, i, j + 1), _pring_pt(sec, rh, a, k, i + 1, j + 1), _pring_pt(sec, rh, a, k, i + 1, j)]
                sec.add_quad(q, 'pring', j, nr)
            None
    Ly2 = Ly / 2.0
    Lx2 = Lx / 2.0
    for k in range(4):
        for i in range(n):
            for m in range(mr):
                q = [_pside_pt(sec, a, Lx2, Ly2, k, i, m, mr), _pside_pt(sec, a, Lx2, Ly2, k, i, m + 1, mr), _pside_pt(sec, a, Lx2, Ly2, k, i + 1, m + 1, mr), _pside_pt(sec, a, Lx2, Ly2, k, i + 1, m, mr)]
                sec.add_quad(q, 'pside', 0, 1)
            None
    for c in range(4):
        for i in range(mr):
            for j in range(mt):
                q = [_pcor_pt(sec, a, Lx2, Ly2, c, i, j, mr, mt), _pcor_pt(sec, a, Lx2, Ly2, c, i + 1, j, mr, mt), _pcor_pt(sec, a, Lx2, Ly2, c, i + 1, j + 1, mr, mt), _pcor_pt(sec, a, Lx2, Ly2, c, i, j + 1, mr, mt)]
                sec.add_quad(q, 'pcor', 0, 1)
            None
    return sec

def _sq_edge_pt(k, phi_deg, a):
    nk = math.radians(90 * k)
    t = math.tan(math.radians(phi_deg))
    ny = math.sin(nk)
    nx = math.cos(nk)
    ty = math.cos(nk)
    tx = -math.sin(nk)
    return (a * nx + a * t * tx, a * ny + a * t * ty)

def _pring_pt(sec, rh, a, k, i, j):
    nr = sec.nr1
    n = sec.n
    key = ('pring', k, i, j)
    phi = -45.0 + 90.0 * i / n
    thd = 90.0 * k + phi
    th = math.radians(thd)
    xe, ye = _sq_edge_pt(k, phi, a)
    y0 = rh * math.sin(th)
    x0 = rh * math.cos(th)
    t = j / nr
    y = y0 + (ye - y0) * t
    x = x0 + (xe - x0) * t
    return sec.node(key, x, y, 0.0, 1.0 - t, 0.0)

def _pside_pt(sec, a, Lx2, Ly2, k, i, m, mr):
    n = sec.n
    key = ('ps', k, i, m)
    phi = -45.0 + 90.0 * i / n
    xe, ye = _sq_edge_pt(k, phi, a)
    nk = math.radians(90 * k)
    ny = math.sin(nk)
    nx = math.cos(nk)
    Rout = Lx2 if k in (0, 2) else Ly2
    xo = xe + (Rout - a) * nx
    yo = ye + (Rout - a) * ny
    t = m / mr
    y = ye + (yo - ye) * t
    x = xe + (xo - xe) * t
    return sec.node(key, x, y, 0.0, 0.0, 0.0)

def _pcor_pt(sec, a, Lx2, Ly2, c, i, j, mr, mt):
    key = ('pc', c, i, j, mr, mt)
    nk = math.radians(90 * c)
    Rout_y = Ly2
    Rout_x = Lx2
    x = a + (Rout_x - a) * i / mr
    y = a + (Rout_y - a) * j / mt
    sn = math.sin(nk)
    cn = math.cos(nk)
    yr = x * sn + y * cn
    xr = x * cn - y * sn
    return sec.node(key, xr, yr, 0.0, 0.0, 0.0)

class Mesh3D:

    def __init__(self, name):
        self.name = name
        self.nodes = None
        self.elems = None
        self.regions = []
        self.surfaces = {}
        self.region_names = []

    def to_pyvista(self):
        import pyvista as pv, vtk
        m = self.elems.shape[0]
        cells = np.empty((m, 9), dtype=np.int64)
        cells[:, 0] = 8
        cells[:, 1:] = self.elems
        celltypes = np.full(m, vtk.VTK_HEXAHEDRON)
        grid = pv.UnstructuredGrid(cells.ravel(), celltypes, self.nodes)
        rids = np.array([self.region_names.index(r) for r in self.regions])
        grid.cell_data['region'] = rids
        return grid
        r = None

def revolve(sec, layers, regions, name):
    npts = len(sec.x)
    nl = len(layers)
    nodes = np.zeros((npts * nl, 3))
    th = np.array(sec.theta)
    rho = np.array(sec.rho)
    al = np.array(sec.alpha)
    be = np.array(sec.beta)
    rref = np.array(sec.rout_ref)
    for li, (z, Rout_fn, Rin_fn) in enumerate(layers):
        r = rho.copy()
        if Rout_fn is not None:
            Ro = np.array([Rout_fn(t) for t in th])
            r = r + al * (Ro - rref)
        if Rin_fn is not None:
            Ri = np.array([Rin_fn(t) for t in th])
            r = r + be * (Ri - sec.rin_ref)
        sl = slice(li * npts, (li + 1) * npts)
        nodes[sl, 0] = r * np.cos(np.radians(th))
        nodes[sl, 1] = r * np.sin(np.radians(th))
        nodes[sl, 2] = z
    quads = np.array(sec.quads, dtype=np.int64)
    nq = quads.shape[0]
    ne = nq * (nl - 1)
    elems = np.zeros((ne, 8), dtype=np.int64)
    regs = []
    for li in range(nl - 1):
        b0 = li * npts
        b1 = (li + 1) * npts
        sl = slice(li * nq, (li + 1) * nq)
        elems[sl, 0:4] = quads + b0
        elems[sl, 4:8] = quads + b1
        regs.extend([regions[li]] * nq)
    mesh = Mesh3D(name)
    mesh.nodes = nodes
    mesh.elems = elems
    mesh.regions = regs
    mesh.region_names = sorted(set(regs))
    return (mesh, quads)
    t = None
    t = None

def merge_by_coords(meshes, name, tol=1e-06):
    nodes = meshes[0].nodes
    elems = [meshes[0].elems]
    regs = list(meshes[0].regions)
    surfaces = {k: list(v) for k, v in meshes[0].surfaces.items()}
    nn = len(nodes)
    eoff = len(meshes[0].elems)
    for m in meshes[1:]:
        key = np.round(nodes / tol).astype(np.int64)
        lut = {}
        for idx, kt in enumerate(map(tuple, key)):
            lut.setdefault(kt, idx)
        nk = np.round(m.nodes / tol).astype(np.int64)
        remap = np.empty(len(m.nodes), dtype=np.int64)
        fresh = []
        for i, kt in enumerate(map(tuple, nk)):
            j = lut.get(kt)
            if j is None:
                j = nn + len(fresh)
                lut[kt] = j
                fresh.append(m.nodes[i])
            remap[i] = j
        if fresh:
            nodes = np.vstack([nodes, np.array(fresh)])
            nn += len(fresh)
        elems.append(remap[m.elems])
        regs.extend(m.regions)
        for sname, faces in m.surfaces.items():
            surfaces.setdefault(sname, []).extend([(eid + eoff, f) for eid, f in faces])
        eoff += len(m.elems)
    out = Mesh3D(name)
    out.nodes = nodes
    out.elems = np.vstack(elems)
    out.regions = regs
    out.region_names = sorted(set(regs))
    out.surfaces = surfaces
    return out
    v = None
    k = None
    f = None
    eid = None

def add_surface(mesh, quads, sec, nl, name, band, region, face, j_sel, layers=None, min_r=None):
    faces = []
    nq = quads.shape[0]
    if layers is not None:
        li_list = layers
    elif face == 'S1':
        li_list = [0]
    elif face == 'S2':
        li_list = [nl - 2]
    else:
        li_list = range(nl - 1)
    for li in li_list:
        for qi in range(nq):
            if band is not None and sec.qband[qi] != band:
                continue
            if j_sel == 'outer' and sec.qj[qi] != sec.qjmax[qi] - 1:
                continue
            if j_sel == 'inner' and sec.qj[qi] != 0:
                continue
            eid = li * nq + qi
            if region is not None and mesh.regions[eid] != region:
                continue
            if min_r is not None:
                nid = mesh.elems[eid][4:8]
                p = mesh.nodes[nid]
                if float(np.hypot(p[:, 0], p[:, 1]).min()) <= min_r:
                    continue
            faces.append((eid + 1, face))
        None
    mesh.surfaces[name] = faces

def min_scaled_volume(mesh):
    X = mesh.nodes[mesh.elems]
    signs = np.array([[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], dtype=float) / 8.0
    J = np.einsum('ib,mia->mab', signs, X)
    det = np.linalg.det(J)
    return (det.min() * 8.0, det.max() * 8.0, float(np.median(det) * 8.0))
