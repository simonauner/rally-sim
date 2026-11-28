"""Shared by the build scripts in blender/<car>/build.py."""

import math

import bmesh
import bpy


SHARP = math.radians(30)


def simplify(obj, ratio, keep=()):
    """Thins out the mesh after colouring: collapses edges inside the colour fields but locks the vertices on
    colour edges, sharp edges and open edges (seams against other panels), so the fields keep their
    straight edges and small details such as the handle recesses survive.
    0.3 keeps a whole body within ~4 mm; below ~0.24 the collapse starts tearing the surface. Small panels
    tolerate less. Dents become coarser creases on flat panels, which is good enough. Faces with a material
    in `keep` keep their mesh."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    # Shortest diagonal: the decimation's own triangulation (beauty) gives streaks on curved quads.
    bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='SHORT_EDGE', ngon_method='EAR_CLIP')
    bm.to_mesh(obj.data)
    lock = set()
    for e in bm.edges:
        fs = e.link_faces
        if len(fs) != 2 or fs[0].material_index != fs[1].material_index or e.calc_face_angle() > SHARP:
            lock.update(v.index for v in e.verts)
    kept = {i for i, m in enumerate(obj.material_slots) if m.material and m.material.name in keep}
    lock.update(v.index for f in bm.faces if f.material_index in kept for v in f.verts)
    bm.free()
    group = obj.vertex_groups.new(name='lock')
    group.add(list(lock), 1.0, 'REPLACE')
    dec = obj.modifiers.new('decimate', 'DECIMATE')
    dec.ratio = ratio
    dec.vertex_group = group.name
    dec.invert_vertex_group = True
    dec.vertex_group_factor = 1000
    dec.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=dec.name)
    obj.vertex_groups.remove(obj.vertex_groups['lock'])
