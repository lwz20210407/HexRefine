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
    """Write a standalone C3D8R INP for Abaqus import and comparison."""
    with open(str(path), 'w') as stream:
        stream.write('*Heading\n%s\n' % title)
        stream.write('*Node\n')
        for nid, point in enumerate(mesh['nodes'], 1):
            stream.write('%d, %.15g, %.15g, %.15g\n' %
                         (nid, point[0], point[1], point[2]))
        stream.write('*Element, type=C3D8R\n')
        for eid, conn in enumerate(mesh['elements'], 1):
            stream.write('%d, %s\n' % (eid, ', '.join(str(n) for n in conn)))
        stream.write('*Nset, nset=ALL_NODES, generate\n1, %d, 1\n' %
                     len(mesh['nodes']))
        stream.write('*Elset, elset=ALL_ELEMENTS, generate\n1, %d, 1\n' %
                     len(mesh['elements']))

