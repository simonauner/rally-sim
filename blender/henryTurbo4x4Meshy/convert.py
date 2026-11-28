"""
Converts an AI-generated mesh of the reference car (a GLB with baked PBR textures) into the Henry 2.0 Turbo
4x4 in the game's flat-colour format, and saves henryTurbo4x4.blend next to this script.

    blender -b --factory-startup -P blender/henryTurbo4x4Meshy/convert.py -- <model.glb>

The GLB is not in the repo: its textures carry real trademarks and a real number plate. Only its shape is
used. The textures are dropped and the colour fields (glass, lamps, plate, pillars) are bounded by planes
measured on the GLB's texture, so they get straight edges as on the other cars; everything else, the livery
included, is plain paint. After that the .blend file is the source, as for the other cars: edit it in Blender
and run blender/export.py.

The GLB is already in the game's frame (Blender X = x, Y = -z, Z = y, ground at y = -0.58) and about as long
as the game's car, but narrower, a little low and lumpy, with the wheels in the wrong places (wheelbase
2.48 m instead of 2.608 m). The body is smoothed, scaled across and up, and warped lengthways by a smooth
curve that moves the wheel arches onto the game's axles but keeps the nose and tail. The regions below are in
car coordinates (x left, y up, z forward) on the GLB, before the warp.

Parts as in blender/henryTurbo4x4/: the shell split into body, four doors, bumpers and boot lid, the lamps
lifted out as units of their own, mirrors and the front plate. The wheel, mud flaps, exhaust and spot lamp
pod come from the procedural model (the GLB's wheel is too coarse, its pod a lumpy blob, and it has no flaps
or pipe). The spoiler is moulded into the boot lid in the GLB, so there is no loose 'wing'.
"""

import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
PROCEDURAL = os.path.join(os.path.dirname(HERE), 'henryTurbo4x4')
sys.path.insert(0, PROCEDURAL)

from common import GROUND, MATERIALS, TRACK, WHEELS, M, set_materials, to_blender, to_car  # noqa: E402

# --- Fitting the GLB to the game's measurements -----------------------------------------------

HALF_X = (0.81, 0.8485)  # body side below the belt: GLB, game (width 1.697 m)
ROOF = (0.766, 0.779)  # GLB, game (height 1.359 m)
# Lengthways (z): GLB tail, rear axle, front axle, nose -> the game's.
Z_FIT = [(-2.575, -2.571), (-1.522, WHEELS[1][0]), (0.959, WHEELS[0][0]), (1.894, 1.897)]
Z_WARP = np.polyfit(*zip(*Z_FIT), 3)
assert (np.polyval(np.polyder(Z_WARP), np.linspace(-2.6, 1.9, 50)) > 0.5).all(), 'the warp must not fold the body'


def fit(v):
    """A GLB point (car coordinates) in the game's."""
    x, y, z = v
    return (x * HALF_X[1] / HALF_X[0], GROUND + (y - GROUND) * (ROOF[1] - GROUND) / (ROOF[0] - GROUND), float(np.polyval(Z_WARP, z)))


# --- Regions on the GLB ------------------------------------------------------------------------

# Front: headlamps with the blinkers outside them, round fog lamps in the bumper and a plate between them.
HEAD_Y, HEAD_X, BLINK_Y, BLINK_X = (-0.035, 0.125), (0.4, 0.655), 0.09, 0.75
# A black grille between the headlamps, over the scar where the GLB's spot lamp pod was cut off (z > NOSE_CAP).
GRILLE_X, NOSE_CAP = 0.38, 1.7
FOG = (0.592, -0.25, 0.075)  # x, y, radius of the octagon
OCTAGON = [Vector((np.cos(a), np.sin(a), 0)) for a in np.arange(8) * np.pi / 4 + np.pi / 8]
FRONT_PLATE_Y, FRONT_PLATE_X = (-0.283, -0.183), 0.167
# Rear: lamps with the reversing light innermost and the blinker outermost, the plate between them.
TAIL_Y, TAIL_X, TAIL_REVERSE, TAIL_BLINK = (0.0, 0.133), (0.275, 0.745), 0.36, 0.65
PLATE_Y, PLATE_X = (0.0, 0.1), 0.205
# The cabin: the side glass between the belt and its top edge, from the line along the front door glass's front
# edge to the line along the rear door glass's rear edge ((z, y) at the bottom and top), with the B pillar
# between them; the windscreen and rear screen between their base and top, narrowing upwards (|x| + k y < d).
# The screens' sides are a little inside the GLB's, where the surface still faces the plane at a steep angle;
# further out the plane runs almost along the lumpy pillars and the edge comes out ragged.
BELT, SIDE_TOP = 0.285, 0.665
FRONT_GLASS = ((0.25, 0.28), (-0.113, 0.66))
REAR_GLASS = ((-1.29, 0.283), (-1.083, 0.667))
B_PILLAR = (-0.592, -0.525)
SCREEN_Y, SCREEN_SIDE = (0.333, 0.69), (0.477, 0.785)
BACKLIGHT_Y, BACKLIGHT_SIDE = (0.417, 0.70), (0.44, 0.72)
# Panels: door seams below the belt (z), the sill, the bumper tops and the boot lid (z, y, half width of the
# deck and of the tail face above the lamps).
DOOR_SEAMS = (0.41, -0.558, -1.27)
SILL_Y = -0.33
BUMPER_FRONT = (1.36, -0.06)  # z ahead of which, y below which
BUMPER_REAR = (-1.92, -0.04)
DECK = (-1.9, 0.14, 0.62, 0.745)

FRONT_ZONE = lambda c: c[2] > 1.5  # noqa: E731
REAR_ZONE = lambda c: c[2] < -2.2  # noqa: E731
CABIN_ZONE = lambda c: c[1] > 0.2 and -2.1 < c[2] < 0.9  # noqa: E731
SIDE_ZONE = lambda c: abs(c[0]) > 0.5  # noqa: E731


def ahead(c, line):
    """How far the point (car coordinates) is ahead of the line through two (z, y) points, along its normal."""
    (z0, y0), (z1, y1) = line
    n = Vector((y0 - y1, z1 - z0)).normalized()
    if n.x < 0:
        n = -n
    return (c[2] - z0) * n.x + (c[1] - y0) * n.y


def in_fog(c):
    return all((abs(c[0]) - FOG[0]) * d.x + (c[1] - FOG[1]) * d.y < FOG[2] for d in OCTAGON)


def body_material(c, n):
    """The palette material of a body face from its centre and normal (car coordinates)."""
    x, y, z = c
    ax = abs(x)
    if z > 1.5 and n.z > -0.5 and HEAD_Y[0] < y < BLINK_Y and HEAD_X[1] < ax < BLINK_X:
        return 'amber'
    if z > 1.55 and n.z > 0.3:
        if HEAD_Y[0] < y < HEAD_Y[1]:
            if HEAD_X[0] < ax < HEAD_X[1]:
                return 'lamp'
            if ax < GRILLE_X:
                return 'black'
        if in_fog(c):
            return 'lamp'
    if z < -2.25 and n.z < -0.3:
        if TAIL_Y[0] < y < TAIL_Y[1] and TAIL_X[0] < ax < TAIL_X[1]:
            return 'reverse' if ax < TAIL_REVERSE else 'amber' if ax > TAIL_BLINK else 'tail'
        if PLATE_Y[0] < y < PLATE_Y[1] and ax < PLATE_X:
            return 'plate'
    if abs(n.x) > 0.5 and BELT < y < SIDE_TOP and ahead(c, FRONT_GLASS) < 0 and ahead(c, REAR_GLASS) > 0:
        return 'black' if B_PILLAR[0] < z < B_PILLAR[1] else 'glass'
    if n.z > 0.1 and z > -0.4 and SCREEN_Y[0] < y < SCREEN_Y[1] and ax + SCREEN_SIDE[0] * y < SCREEN_SIDE[1]:
        return 'glass'
    if n.z < 0.05 and z < -0.9 and BACKLIGHT_Y[0] < y < BACKLIGHT_Y[1] and ax + BACKLIGHT_SIDE[0] * y < BACKLIGHT_SIDE[1]:
        return 'glass'
    return 'paint'


# --- Reading and preparing the GLB --------------------------------------------------------------


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = {}
    for o in list(bpy.data.objects):
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        objs[o.name] = o
    return objs


def untextured(obj):
    """Indices of the faces whose material has no texture: the GLB's wheel arch liners and cut faces."""
    slots = {i for i, m in enumerate(obj.data.materials) if not (m.node_tree and any(nd.type == 'TEX_IMAGE' for nd in m.node_tree.nodes))}
    return {p.index for p in obj.data.polygons if p.material_index in slots}


def weld(obj):
    """Joins the vertices the GLB splits along its texture seams, so the surface is one piece again."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    bm.to_mesh(obj.data)
    bm.free()


def symmetrize(obj):
    """The GLB is lopsided; its left half (x > 0) is the cleaner one and is mirrored onto the right."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, 0), plane_no=(1, 0, 0), clear_inner=True)
    for v in bm.verts:
        if abs(v.co.x) < 1e-4:
            v.co.x = 0
    bmesh.ops.mirror(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], axis='X', merge_dist=0.0005)
    # Outward normals all round: the mirror leaves its copies' winding mixed, and the GLB has a few inside-out faces.
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(obj.data)
    bm.free()


def flatten_grille(obj):
    """Presses the scar of the GLB's pod flat into the plane of the grille."""
    for v in obj.data.vertices:
        x, y, z = to_car(v.co)
        if abs(x) < GRILLE_X + 0.02 and HEAD_Y[0] - 0.02 < y < HEAD_Y[1] + 0.02 and z > NOSE_CAP - 0.1:
            v.co = to_blender(x, y, NOSE_CAP + 0.075)


def smooth(obj):
    """Irons out the GLB's lumps but keeps the volume, and thins the mesh to the other cars' size (before the
    cuts, which add the edges of the colour fields and parts)."""
    mod = obj.modifiers.new('smooth', 'LAPLACIANSMOOTH')
    mod.lambda_factor = 0.5
    mod.iterations = 10
    mod.use_volume_preserve = True
    dec = obj.modifiers.new('decimate', 'DECIMATE')
    dec.ratio = 0.4
    dec.use_symmetry = True
    dec.symmetry_axis = 'X'
    dec.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    for m in (mod, dec):
        bpy.ops.object.modifier_apply(modifier=m.name)


def face_info(obj, f):
    """The face centre and normal in car coordinates (the objects have no transform until the end)."""
    return to_car(f.calc_center_median() if isinstance(f, bmesh.types.BMFace) else f.center), Vector(to_car(f.normal))


def colour(obj, rule, black):
    """Material per face from rule(centre, normal); the faces in `black` are black."""
    set_materials(obj)
    obj.data.polygons.foreach_set('material_index', [M['black'] if p.index in black else M[rule(*face_info(obj, p))] for p in obj.data.polygons])


# --- Splitting into parts ------------------------------------------------------------------------


def line_plane(line):
    (z0, y0), (z1, y1) = line
    n = Vector((0, z1 - z0, y0 - y1)).normalized()
    return n, n.dot(Vector((0, y0, z0)))


def cut(body):
    """Cuts the faces in each zone along the planes (normal, d in car coordinates), so the colour fields and the
    parts get straight edges."""
    Z = lambda z: ((0, 0, 1), z)  # noqa: E731
    Y = lambda y: ((0, 1, 0), y)  # noqa: E731
    X = lambda *xs: [p for x in xs for p in (((1, 0, 0), x), ((-1, 0, 0), x))]  # noqa: E731
    Xy = lambda k, d: [((1, k, 0), d), ((-1, k, 0), d)]  # noqa: E731  # |x| + k y = d
    cuts = [
        (FRONT_ZONE, [Y(v) for v in (*HEAD_Y, BLINK_Y, *FRONT_PLATE_Y, BUMPER_FRONT[1])] + X(*HEAD_X, BLINK_X, GRILLE_X, FRONT_PLATE_X)),
        (REAR_ZONE, [Y(v) for v in (*TAIL_Y, *PLATE_Y, BUMPER_REAR[1])] + X(*TAIL_X, TAIL_REVERSE, TAIL_BLINK, PLATE_X)),
        (CABIN_ZONE, [Y(v) for v in (BELT, SIDE_TOP, *SCREEN_Y, *BACKLIGHT_Y)] + [Z(v) for v in B_PILLAR]
         + [line_plane(FRONT_GLASS), line_plane(REAR_GLASS)] + Xy(*SCREEN_SIDE) + Xy(*BACKLIGHT_SIDE)),
        (lambda c: c[2] > 1.5 and Vector((abs(c[0]) - FOG[0], c[1] - FOG[1])).length < 2 * FOG[2],
         [p for d in OCTAGON for p in (((d.x, d.y, 0), FOG[0] * d.x + FOG[1] * d.y + FOG[2]),
                                       ((-d.x, d.y, 0), FOG[0] * d.x + FOG[1] * d.y + FOG[2]))]),
        (SIDE_ZONE, [Z(v) for v in DOOR_SEAMS] + [Y(SILL_Y)]),
        (lambda c: c[2] < DECK[0] + 0.05 and c[1] > DECK[1] - 0.05, X(DECK[2], DECK[3]) + [Y(DECK[1]), Z(DECK[0])]),
    ]
    bm = bmesh.new()
    bm.from_mesh(body.data)
    for zone, planes in cuts:
        for n, d in planes:
            n = Vector(n).normalized() if not isinstance(n, Vector) else n
            faces = [f for f in bm.faces if zone(to_car(f.calc_center_median()))]
            geom = faces + list({e for f in faces for e in f.edges}) + list({v for f in faces for v in f.verts})
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=to_blender(*(n * d)), plane_no=to_blender(*n))
    bm.to_mesh(body.data)
    bm.free()


def extract(obj, name, test, keep=False):
    """Moves (or copies, keep) the faces where test(centre, normal, material) holds to a new object."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    hits = {f.index for f in bm.faces if test(*face_info(obj, f), MATERIALS[f.material_index][0])}
    if not hits:
        raise RuntimeError(f'{name}: no faces')
    new = bm.copy()
    bmesh.ops.delete(new, geom=[f for f in new.faces if f.index not in hits], context='FACES')
    if not keep:
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index in hits], context='FACES')
        bm.to_mesh(obj.data)
    bm.free()
    mesh = bpy.data.meshes.new(name)
    new.to_mesh(mesh)
    new.free()
    for m in obj.data.materials:
        mesh.materials.append(m)
    part = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(part)
    return part


def recolor(obj, test, mat):
    for p in obj.data.polygons:
        if test(*face_info(obj, p), MATERIALS[p.material_index][0]):
            p.material_index = M[mat]


def lamp_unit(obj, mat=None):
    """A lamp lifted 5 mm out of the body along its normal, so it reads as a unit of its own."""
    normal = sum((p.normal * p.area for p in obj.data.polygons), Vector()).normalized()
    for v in obj.data.vertices:
        v.co += normal * 0.005
    if mat:
        for p in obj.data.polygons:
            p.material_index = M[mat]
    return obj


def lamps(body):
    """Headlamps, blinkers, fog lamps, tail lamps and the front plate as parts of their own; black holes stay in
    the body when they fall off."""
    front = lambda c, n: c[2] > 1.55 and n.z > 0.3  # noqa: E731
    groups = [
        ('headlight', lambda c, n, m: front(c, n) and m == 'lamp' and c[1] > HEAD_Y[0]),
        ('blinker', lambda c, n, m: front(c, n) and m == 'amber'),
        ('foglight', lambda c, n, m: front(c, n) and m == 'lamp' and c[1] < HEAD_Y[0]),
        ('taillight', lambda c, n, m: c[2] < -2.25 and m in ('tail', 'reverse', 'amber')),
    ]
    units = []
    for name, test in groups:
        for s, side in ((1, 'L'), (-1, 'R')):
            t = lambda c, n, m, s=s, test=test: test(c, n, m) and c[0] * s > 0  # noqa: E731
            units.append(lamp_unit(extract(body, f'{name}_{side}', t, keep=True)))
            recolor(body, t, 'black')
    plate = lambda c, n, m: front(c, n) and FRONT_PLATE_Y[0] < c[1] < FRONT_PLATE_Y[1] and abs(c[0]) < FRONT_PLATE_X  # noqa: E731
    units.append(lamp_unit(extract(body, 'plate_front', plate, keep=True), 'plate'))
    recolor(body, plate, 'black')
    return units


def mirrors(body):
    return [extract(body, f'mirror_{side}', lambda c, n, m, s=s: c[0] * s > 0.79 and c[1] > 0.24 and 0.1 < c[2] < 0.5)
            for s, side in ((1, 'L'), (-1, 'R'))]


def is_door(s, front):
    """The front or rear door on side s: the panel between its seams, and its glass up to the roof edge."""
    seam0, seam1 = (DOOR_SEAMS[0], DOOR_SEAMS[1]) if front else (DOOR_SEAMS[1], DOOR_SEAMS[2])

    def test(c, n, m):
        x, y, z = c
        if x * s < 0.55 or abs(n.x) < 0.35 or not (SILL_Y < y < SIDE_TOP and seam1 < z < seam0):
            return False
        return y < BELT or (ahead(c, FRONT_GLASS) < 0 if front else ahead(c, REAR_GLASS) > 0)

    return test


def panels(body):
    """Four doors, bumpers and boot lid as parts of their own; in the game each part dents on its own."""
    parts = [extract(body, f'body_door_{name}_{side}', is_door(s, front))
             for s, side in ((1, 'L'), (-1, 'R')) for front, name in ((True, 'front'), (False, 'rear'))]
    parts.append(extract(body, 'body_bumper_front', lambda c, n, m: c[2] > BUMPER_FRONT[0] and c[1] < BUMPER_FRONT[1]))
    parts.append(extract(body, 'body_bumper_rear', lambda c, n, m: c[2] < BUMPER_REAR[0] and c[1] < BUMPER_REAR[1]))
    parts.append(extract(body, 'body_bootlid', lambda c, n, m: c[2] < DECK[0] and c[1] > DECK[1] and m != 'glass'
                         and abs(c[0]) < (DECK[2] if n.y > 0.5 else DECK[3])))
    return parts


# --- The rest --------------------------------------------------------------------------------------


def borrowed():
    """Wheel, mud flaps, exhaust and spot lamp pod from the procedural model."""
    with bpy.data.libraries.load(os.path.join(PROCEDURAL, 'henryTurbo4x4.blend')) as (src, dst):
        dst.objects = [n for n in src.objects if n in ('wheel', 'exhaust') or n.startswith(('flap_', 'pod_'))]
    for o in dst.objects:
        bpy.context.scene.collection.objects.link(o)
        names = [m.name.split('.')[0] for m in o.data.materials]
        idx = [0] * len(o.data.polygons)
        o.data.polygons.foreach_get('material_index', idx)
        set_materials(o)
        o.data.polygons.foreach_set('material_index', [M[names[i]] for i in idx])
    return list(dst.objects)


def seat_pod(body, parts):
    """Moves the procedural pod down onto this bonnet, which drops steeply towards the nose: the lamps' lower
    edge (0.03 m under the box's origin) just clears the bonnet at their rear edge (0.03 m ahead of it), and the
    box's rear end sinks into the bonnet."""
    tree = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    x, y, z = to_car(next(o for o in parts if o.name == 'pod_body').location)
    top = max(to_car(tree.ray_cast(to_blender(cx, 2, z + 0.03), to_blender(0, -1, 0))[0])[1] for cx in (x - 0.39, x + 0.39))
    dy = top + 0.005 - (y - 0.03)
    for o in parts:
        if o.name.startswith('pod_'):
            o.location += to_blender(0, dy, 0)


def warp(obj):
    """Fits the object to the game's measurements."""
    for v in obj.data.vertices:
        v.co = to_blender(*fit(to_car(v.co)))


def origin_to_centre(obj):
    """Origin in the middle of the part, so the game knows which side a lamp is on and where a loose part falls from."""
    vs = obj.data.vertices
    c = (Vector([min(v.co[i] for v in vs) for i in range(3)]) + Vector([max(v.co[i] for v in vs) for i in range(3)])) / 2
    obj.data.transform(Matrix.Translation(-c))
    obj.location = c


def finish(obj):
    """Smooth shading with sharp edges over 40°, which the export turns into creases."""
    for p in obj.data.polygons:
        p.use_smooth = True
    obj.data.set_sharp_from_angle(angle=0.7)


def reference(wheel):
    """Ground and the other three wheels to model against. Not exported."""
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
    src = load(sys.argv[sys.argv.index('--') + 1])
    body = src.pop('body')
    for o in src.values():  # the GLB's wheels and spot lamp pod
        bpy.data.objects.remove(o)
    # The liners are marked black before the cut (the cut faces inherit it), the rest coloured after it; the
    # scar of the pod is coloured as the rest.
    colour(body, lambda c, n: 'paint', untextured(body))
    weld(body)
    symmetrize(body)
    flatten_grille(body)
    smooth(body)
    cut(body)
    colour(body, body_material, {p.index for p in body.data.polygons if p.material_index == M['black'] and to_car(p.center)[2] < NOSE_CAP})
    loose = lamps(body) + mirrors(body)
    shell = [body, *panels(body)]
    # Panels dent in car coordinates, so they keep the car's origin; loose parts get their own.
    for o in shell + loose:
        warp(o)
        finish(o)
    for o in loose:
        origin_to_centre(o)
    objs = shell + loose + borrowed()
    seat_pod(body, objs)
    # Nothing from the GLB's look is kept: no textures, no materials but the palette.
    for img in list(bpy.data.images):
        bpy.data.images.remove(img)
    for m in list(bpy.data.materials):
        if m.name not in M:
            bpy.data.materials.remove(m)
    export = bpy.data.collections.new('Export')
    bpy.context.scene.collection.children.link(export)
    for o in objs:
        for c in o.users_collection:
            c.objects.unlink(o)
        export.objects.link(o)
    reference(next(o for o in objs if o.name == 'wheel'))
    bpy.ops.outliner.orphans_purge(do_recursive=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'henryTurbo4x4.blend'))
    for o in objs:
        print(f'{o.name}: {len(o.data.polygons)} faces')


main()
