"""Gemensamt för byggskripten i blender/<bil>/build.py."""

import math

import bmesh
import bpy


SHARP = math.radians(30)


def simplify(obj, ratio, keep=()):
    """Glesar ut nätet efter färgsättningen: kollapsar kanter inne i färgfälten men låser hörnen på
    färgkanterna, skarpa kanter och öppna kanter (skarvar mot andra paneler), så fälten behåller sina
    raka kanter och små detaljer som handtagens urgröpningar finns kvar.
    0,3 håller en hel kaross inom ~4 mm; under ~0,24 börjar kollapsen slita sönder ytan. Små paneler
    tål mindre. Bucklorna blir grövre veck på plana paneler, vilket räcker. Ytor med material i `keep`
    behåller sitt nät."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    # Kortaste diagonalen: decimeringens egen triangulering (beauty) ger strimmor på välvda rutor.
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
