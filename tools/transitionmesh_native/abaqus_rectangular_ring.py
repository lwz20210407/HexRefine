"""Optional Abaqus/CAE bridge for an explicit rectangular-ring sketch plan.

The transition constructors do not depend on this module or on Abaqus.
Run this bridge inside CAE; it is also compatible with Abaqus 2020 Python 2.
"""


def mesh_partitioned_ring(model, name, frames, segments, expected_faces):
    """Create a CAD ring, partition into explicit four-sided faces and mesh.

    `frames` are the centered half-width/half-height pairs from
    build_rectangular_ring. `segments` are its internal partition segments.
    The Abaqus kernel creates the nodes and elements from the CAD faces.
    """
    from abaqusConstants import (
        CPS4R, DEFORMABLE_BODY, FIXED, FREE, QUAD, STANDARD, TWO_D_PLANAR,
    )
    import mesh

    size = 4 * max(frames[-1])
    outline = model.ConstrainedSketch(name=name + '_outline', sheetSize=size)
    for a, b in (frames[0], frames[-1]):
        outline.rectangle(point1=(-a, -b), point2=(a, b))
    part = model.Part(name=name, dimensionality=TWO_D_PLANAR, type=DEFORMABLE_BODY)
    part.BaseShell(sketch=outline)
    del model.sketches[outline.name]

    pattern = model.ConstrainedSketch(name=name + '_partitions', sheetSize=size)
    for a, b in segments:
        pattern.Line(point1=tuple(a), point2=tuple(b))
    part.PartitionFaceBySketch(faces=part.faces[:], sketch=pattern)
    del model.sketches[pattern.name]
    faces = part.faces[:]
    if len(faces) != expected_faces or any(len(face.getEdges()) != 4 for face in faces):
        raise ValueError('CAD partitions must yield exactly %d four-sided faces' % expected_faces)

    # FREE is local to each four-sided face, not to a whole transition
    # frame. The four fixed edge segments leave one Q4 per partition.
    part.setMeshControls(regions=faces, elemShape=QUAD, technique=FREE)
    part.seedEdgeByNumber(edges=tuple(part.edges), number=1, constraint=FIXED)
    part.setElementType(regions=(faces,),
                        elemTypes=(mesh.ElemType(elemCode=CPS4R, elemLibrary=STANDARD),))
    part.generateMesh(regions=tuple(faces))
    if len(part.elements) != expected_faces or any(
            len(face.getElements()) != 1 for face in faces):
        raise ValueError('Expected one Q4 per explicit CAD partition')
    for element in part.elements:
        points = [n.coordinates for n in element.getNodes()]
        if len(points) != 4:
            raise ValueError('Expected Q4 at element %d' % element.label)
        for i, (x, y, _) in enumerate(points):
            a, b = points[(i + 1) % 4], points[i - 1]
            det = (a[0] - x) * (b[1] - y) - (a[1] - y) * (b[0] - x)
            if not det > 0:
                raise ValueError('Non-positive corner Jacobian at element %d, corner %d'
                                 % (element.label, i + 1))
    return part
