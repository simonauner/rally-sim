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
target = Vector((0, 0, 0.1))
# Vinkel runt bilen i grader: 0 = rakt framifrån (bilen pekar mot -Y), 90 = vänster sida.
for name, yaw, pitch in (('front34', 35, 8), ('side', 90, 1), ('rear34', 150, 8), ('front', 0, 4), ('rear', 180, 4), ('top', 90, 89)):
    d = 11
    a, p = math.radians(yaw), math.radians(pitch)
    cam.location = target + Vector((math.sin(a) * math.cos(p) * d, -math.cos(a) * math.cos(p) * d, math.sin(p) * d))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(out, f'{name}.png')
    bpy.ops.render.render(write_still=True)
