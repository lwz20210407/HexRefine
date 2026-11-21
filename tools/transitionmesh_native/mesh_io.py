"""Small dependency-free writers for native TransitionMesh evidence meshes."""
from __future__ import division


def write_ls_dyna_solid(path, mesh, title):
    """Write a mesh-only LS-DYNA keyword deck containing NODE/SOLID only."""
    with open(str(path), 'w') as stream:
        stream.write('*KEYWORD\n*TITLE\n%s\n*NODE\n' % title)
        for nid, point in enumerate(mesh['nodes'], 1):
            stream.write('%d, %.15g, %.15g, %.15g\n' %
                         (nid, point[0], point[1], point[2]))
        stream.write('*ELEMENT_SOLID\n')
        for eid, conn in enumerate(mesh['elements'], 1):
            stream.write('%d, 1, %s\n' % (eid, ', '.join(str(n) for n in conn)))
        stream.write('*END\n')


def write_abaqus_inp(path, mesh, title):
    """Write a mesh-only C3D8R or CPS4R INP for import and comparison."""
    n = _uniform_arity(mesh)
    with open(str(path), 'w') as stream:
        stream.write('*Heading\n%s\n' % title)
        stream.write('*Node\n')
        for nid, point in enumerate(mesh['nodes'], 1):
            stream.write('%d, %.15g, %.15g, %.15g\n' %
                         (nid, point[0], point[1], point[2]))
        stream.write('*Element, type=%s\n' % ('C3D8R' if n == 8 else 'CPS4R'))
        for eid, conn in enumerate(mesh['elements'], 1):
            stream.write('%d, %s\n' % (eid, ', '.join(str(n) for n in conn)))
        stream.write('*Nset, nset=ALL_NODES, generate\n1, %d, 1\n' %
                     len(mesh['nodes']))
        stream.write('*Elset, elset=ALL_ELEMENTS, generate\n1, %d, 1\n' %
                     len(mesh['elements']))


def _uniform_arity(mesh):
    counts = {len(conn) for conn in mesh['elements']}
    if counts == {8}:
        return 8
    if counts == {4}:
        return 4
    raise ValueError('Expected a nonempty homogeneous H8 or Q4 mesh')


def write_ls_dyna_mesh(path, mesh, title):
    """Write homogeneous solid or shell mesh cards, without solver data."""
    if _uniform_arity(mesh) == 8:
        return write_ls_dyna_solid(path, mesh, title)
    with open(str(path), 'w') as stream:
        stream.write('*KEYWORD\n*TITLE\n%s\n*NODE\n' % title)
        for nid, (x, y, z) in enumerate(mesh['nodes'], 1):
            stream.write('%d, %.15g, %.15g, %.15g\n' % (nid, x, y, z))
        stream.write('*ELEMENT_SHELL\n')
        for eid, conn in enumerate(mesh['elements'], 1):
            stream.write('%d, 1, %s\n' % (eid, ', '.join(str(n) for n in conn)))
        stream.write('*END\n')

