"""
Renderar en bilmodell från några vinklar, för att jämföra med foton utan att starta spelet.

    blender -b blender/soraTurbo/soraTurbo.blend -P blender/render.py -- <utmapp>
"""

import math
import os
import sys

import bpy
from mathutils import Vector

out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '/tmp'
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_object_outline = True
scene.display.shading.show_cavity = True
scene.render.resolution_x = 1200
scene.render.resolution_y = 700
scene.render.film_transparent = False
for o in bpy.data.collections['Reference'].objects:
    o.hide_render = o.name.startswith('ground')

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.lens = 70
scene.collection.objects.link(cam)
scene.camera = cam
# Vyer: namn, vinkel runt bilen i grader (0 = rakt framifrån, bilen pekar mot -Y; 90 = vänster sida),
# höjdvinkel, avstånd och punkt att titta på i bilens koordinater (x vänster, y upp, z fram).
VIEWS = [
    ('front34', 35, 8, 11, (0, 0.1, 0)),
    ('side', 90, 1, 11, (0, 0.1, 0)),
    ('rear34', 150, 8, 11, (0, 0.1, 0)),
    ('front', 0, 4, 11, (0, 0.1, 0)),
    ('rear', 180, 4, 11, (0, 0.1, 0)),
    ('top', 90, 89, 11, (0, 0.1, 0)),
    # Närbilder av delarna.
    ('wheel', 80, 4, 2.6, (0.74, -0.17, 1.11)),
    ('wing', 140, 18, 3.4, (0, 0.72, -2.1)),
    ('headlight', 30, 6, 2.4, (0.45, 0.05, 1.9)),
    ('taillight', 155, 6, 2.4, (0.5, 0.15, -2.3)),
    ('door', 75, 4, 4.2, (0.84, 0.3, 0.05)),
    ('exhaust', 200, 4, 2.0, (-0.4, -0.25, -2.3)),
    ('mirror', 40, 12, 2.0, (0.75, 0.42, 0.45)),
]
for name, yaw, pitch, d, (tx, ty, tz) in VIEWS:
    target = Vector((tx, -tz, ty))
    a, p = math.radians(yaw), math.radians(pitch)
    cam.location = target + Vector((math.sin(a) * math.cos(p) * d, -math.cos(a) * math.cos(p) * d, math.sin(p) * d))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(out, f'{name}.png')
    bpy.ops.render.render(write_still=True)
