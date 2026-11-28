"""
Builds the Sora 2.0 Turbo in Blender and saves soraTurbo.blend next to the script.

    blender -b --factory-startup -P blender/soraTurbo/build.py

Each part is built separately: the shell (shell.py) is split into body, doors, bumpers and boot lid that
dent separately, the lights are lifted out as units of their own, and the wing, exhaust, wheels and other
details (parts.py) are objects of their own. The script produces a first version. After that the .blend
file is the source: edit it in Blender and run blender/export.py to transfer it to the game. Only rerun
this script if you want to start over.

Coordinates: everything is computed in car coordinates (x = left, y = up, z = forward, origin at the
centre of mass) and placed in Blender as X = x, Y = -z, Z = y, so the car points towards -Y as in
Blender's front view. The ground is at y = -0.486 and the wheel centres at y = -0.17 when the car is at
rest in the game.

The dimensions follow the original (a two-door coupé from 1999): 4.35 m long, 1.69 m wide, wheelbase
2.52 m. The heights are measured from a side photo of the rally version, which is lower than the standard
car's 1.405 m: roof at 1.30 m.
"""

import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import parts  # noqa: E402
import shell  # noqa: E402
from common import GROUND, TRACK, WHEELS, to_blender, to_car  # noqa: E402


def reference(wheel):
    """Ground and the other three wheels (copies of the modelled one, mirrored on the right side) to model
    against. Not exported."""
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


def surface(parts):
    """surface(s, y, z): the body surface (x) on side s, with a ray cast in from the side towards the parts."""
    import bmesh
    from mathutils.bvhtree import BVHTree

    bm = bmesh.new()
    for obj in parts:
        mesh = obj.data.copy()
        mesh.transform(obj.matrix_world)
        bm.from_mesh(mesh)
        bpy.data.meshes.remove(mesh)
    tree = BVHTree.FromBMesh(bm)

    def at(s, y, z):
        hit = tree.ray_cast(to_blender(s * 2.0, y, z), to_blender(-s, 0, 0))[0]
        if hit is None:
            raise RuntimeError(f'no body at y={y}, z={z}')
        return to_car(hit)[0]

    return at


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    export = bpy.data.collections.new('Export')
    bpy.context.scene.collection.children.link(export)
    body = shell.build_body()
    shell.cut_planes(body)
    shell.assign_materials(body, shell.face_material)
    lamps = shell.lamps(body)
    panels = shell.panels(body)
    for obj in [body, *panels]:
        shell.flare(obj)
    shell.body_side(body)
    for obj in [body, *lamps, *panels]:
        shell.merge_flat(obj)
        shell.mark_sharp(obj)
    objs = [body, *lamps, *panels, *parts.details(surface([body, *panels]))]
    shell.mark_sharp(next(o for o in objs if o.name == 'pod'))
    for obj in objs:
        for c in obj.users_collection:
            c.objects.unlink(obj)
        export.objects.link(obj)
    reference(next(o for o in objs if o.name == 'wheel'))
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'soraTurbo.blend')
    bpy.ops.wm.save_as_mainfile(filepath=out)
    for obj in objs:
        print(f'{obj.name}: {len(obj.data.vertices)} vertices')


main()
