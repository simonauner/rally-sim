"""
Bygger Sora 2.0 Turbo i Blender och sparar soraTurbo.blend bredvid skriptet.

    blender -b --factory-startup -P blender/soraTurbo/build.py

Varje del byggs för sig: skalet (shell.py) delas upp i kaross, dörrar, stötfångare och baklucka som
bucklas var för sig, lyktorna lyfts ut som egna enheter, och vinge, avgassystem, hjul och övriga
detaljer (parts.py) är egna objekt. Skriptet ger en första version. Därefter är .blend-filen källan: redigera den i Blender och kör
blender/export.py för att föra över den till spelet. Kör bara om det här skriptet om du vill börja om.

Koordinater: allt räknas i bilens koordinater (x = vänster, y = upp, z = framåt, origo i tyngdpunkten)
och läggs in i Blender som X = x, Y = -z, Z = y, så bilen pekar mot -Y som i Blenders framvy.
Marken ligger på y = -0,486 och hjulens centrum på y = -0,17 när bilen står still i spelet.

Måtten följer förebilden (tvådörrars coupé från 1999): 4,35 m lång, 1,69 m bred, 1,405 m hög,
hjulbas 2,52 m; höjder och lägen är uppmätta på sidofoton.
"""

import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import parts  # noqa: E402
import shell  # noqa: E402
from common import GROUND, TRACK, WHEELS, to_blender  # noqa: E402


def reference(wheel):
    """Mark och de tre andra hjulen (kopior av det modellerade, speglade på höger sida) att modellera mot.
    Exporteras inte."""
    coll = bpy.data.collections.new('Reference')
    bpy.context.scene.collection.children.link(coll)
    for (zw, yw), xw in zip(WHEELS, TRACK):
        for s in (1, -1):
            if (zw, s) == (WHEELS[0][0], 1):
                continue
            w = wheel.copy()
            w.name = 'wheel_ref'
            w.location = to_blender(s * xw, yw, zw)
            w.scale.x = s
            coll.objects.link(w)
    bpy.ops.mesh.primitive_plane_add(size=8, location=to_blender(0, GROUND, 0))
    g = bpy.context.active_object
    g.name = 'ground'
    bpy.context.scene.collection.objects.unlink(g)
    coll.objects.link(g)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    export = bpy.data.collections.new('Export')
    bpy.context.scene.collection.children.link(export)
    body = shell.build_body()
    shell.cut_planes(body)
    shell.assign_materials(body, shell.face_material)
    objs = [body, *shell.lamps(body), *shell.panels(body), *parts.details()]
    for obj in objs:
        for c in obj.users_collection:
            c.objects.unlink(obj)
        export.objects.link(obj)
    reference(next(o for o in objs if o.name == 'wheel'))
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'soraTurbo.blend')
    bpy.ops.wm.save_as_mainfile(filepath=out)
    for obj in objs:
        print(f'{obj.name}: {len(obj.data.vertices)} hörn')


main()
