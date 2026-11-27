"""
För över en bilmodell från Blender till spelet: skriver src/render/models/<fil>.ts.

    blender -b blender/soraTurbo/soraTurbo.blend -P blender/export.py

Objekten i samlingen Export blir bilens delar. Objektet 'body' är karossen som bucklas; övriga är lösa
detaljer som ramlar av vid krockar, med origo i objektets origo. Namn som börjar med 'flap' är stänkskydd
och 'pod' extraljusrampen (bara klass 2). Materialens namn är färgerna i src/render/models/model.ts.

Blenders axlar blir bilens: x = X, y = Z, z = -Y (bilen pekar mot -Y). Positioner sparas i millimeter.
"""

import base64
import os
import struct

import bpy


def to_car(v):
    return v.x, v.z, -v.y


def b64(fmt, values):
    return base64.b64encode(struct.pack('<%d%s' % (len(values), fmt), *values)).decode()


def export_object(obj, depsgraph, materials):
    mesh = obj.evaluated_get(depsgraph).to_mesh()
    mesh.calc_loop_triangles()
    mw = obj.matrix_world
    at = to_car(mw.translation)
    slots = [s.material.name if s.material else 'paint' for s in obj.material_slots] or ['paint']
    # Ett hörn per (hörn, material), så färgkanterna blir skarpa.
    keys, pos, mat, index = {}, [], [], []
    for tri in mesh.loop_triangles:
        name = slots[min(tri.material_index, len(slots) - 1)]
        if name not in materials:
            materials.append(name)
        m = materials.index(name)
        for v in tri.vertices:
            key = (v, m)
            if key not in keys:
                keys[key] = len(keys)
                p = to_car(mw @ mesh.vertices[v].co)
                pos.extend(round((p[i] - at[i]) * 1000) for i in range(3))
                mat.append(m)
            index.append(keys[key])
    obj.evaluated_get(depsgraph).to_mesh_clear()
    assert len(keys) < 65536, f'{obj.name}: för många hörn ({len(keys)})'
    assert all(-32768 <= c < 32768 for c in pos), f'{obj.name}: utanför ±32 m'
    return {
        'name': obj.name,
        'at': [round(c, 4) for c in at],
        'pos': b64('h', pos),
        'mat': b64('B', mat),
        'index': b64('H', index),
    }, len(keys), len(index) // 3


def main():
    blend = bpy.data.filepath
    name = os.path.splitext(os.path.basename(blend))[0]
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(blend))))
    out = os.path.join(root, 'src', 'render', 'models', f'{name}.ts')
    depsgraph = bpy.context.evaluated_depsgraph_get()
    materials, parts = [], []
    objs = sorted(bpy.data.collections['Export'].objects, key=lambda o: (o.name != 'body', o.name))
    for obj in objs:
        if obj.type != 'MESH':
            continue
        part, verts, tris = export_object(obj, depsgraph, materials)
        parts.append(part)
        print(f'{obj.name}: {verts} hörn, {tris} trianglar')
    lines = [
        f'// Genererad av blender/export.py från blender/{name}/{name}.blend. Redigera modellen i Blender, inte den här filen.',
        "import type { ModelData } from './model';",
        '',
        f'export const {name}: ModelData = {{',
        f'  materials: {materials!r},',
        '  parts: [',
    ]
    for p in parts:
        lines.append(f"    {{ name: '{p['name']}', at: {p['at']}, pos: '{p['pos']}', mat: '{p['mat']}', index: '{p['index']}' }},")
    lines += ['  ],', '};', '']
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w') as f:
        f.write('\n'.join(lines))
    print('skrev', out, os.path.getsize(out) // 1024, 'kB')


main()
