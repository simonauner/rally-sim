"""
Shared by the Strand 2.0 Turbo 4x4's build scripts: measurements, materials, coordinates and small mesh tools.

Everything is in the car's frame (x = left, y = up, z = forward, origin at the centre of gravity) and goes
into Blender as X = x, Y = -z, Z = y, so the car points to -Y as in Blender's front view.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

GROUND = -0.58
WHEELS = [(1.095, -0.252), (-1.513, -0.271)]  # (z, y) front and rear
TRACK = [0.734, 0.734]
TYRE_R = 0.32

# The materials; the names are the colours in the game's palette (src/render/carMesh.ts).
MATERIALS = [
    ('paint', (0.75, 0.76, 0.77)),
    ('glass', (0.17, 0.23, 0.26)),
    ('black', (0.11, 0.11, 0.11)),
    ('dark', (0.23, 0.23, 0.23)),
    ('chrome', (0.73, 0.75, 0.76)),
    ('lamp', (0.95, 0.91, 0.63)),
    ('amber', (0.91, 0.56, 0.16)),
    ('tail', (0.63, 0.09, 0.09)),
    ('reverse', (0.85, 0.83, 0.8)),
    ('plate', (0.93, 0.93, 0.92)),
    ('shade', (0.45, 0.46, 0.47)),  # seams: the paint in shadow
    ('gold', (0.79, 0.64, 0.26)),
    ('rubber', (0.14, 0.14, 0.14)),  # the tyres
]
M = {name: i for i, (name, _) in enumerate(MATERIALS)}


def to_blender(x, y, z):
    return Vector((x, -z, y))


def to_car(v):
    return v.x, v.z, -v.y


def lerp(a, b, t):
    return a + (b - a) * t


def clamp01(t):
    return max(0.0, min(1.0, t))


def piecewise(points, x):
    """Linear interpolation in a list of (x, y) sorted on x."""
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x <= x1:
            return lerp(y0, y1, (x - x0) / (x1 - x0))
    return points[-1][1]


def apply_all(obj):
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def set_materials(obj):
    """Gives the object every material in the palette, in the same order, so material index = M[name]."""
    obj.data.materials.clear()
    for name, rgb in MATERIALS:
        mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        mat.diffuse_color = (*rgb, 1)
        obj.data.materials.append(mat)


def new_object(name, bm, at=(0, 0, 0), tilt=0.0, smooth=False):
    """An object from bm (vertices in car coordinates relative to `at`), tilted `tilt` radians about x
    (positive lifts the rear edge)."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = to_blender(*at)
    obj.rotation_euler = (tilt, 0, 0)
    bpy.context.scene.collection.objects.link(obj)
    mats = [p.material_index for p in mesh.polygons]
    set_materials(obj)
    for p, m in zip(mesh.polygons, mats):
        p.material_index = m
    for p in mesh.polygons:
        p.use_smooth = smooth
    return obj


def vert(bm, p):
    return bm.verts.new(to_blender(*p))


def face(bm, verts, mat):
    f = bm.faces.new(verts)
    f.material_index = M[mat]
    return f


def hexa(bm, corners, mat, side_mat=None):
    """Six-sided solid from eight corners: four at one end (going round) and four at the other, in the same order."""
    v = [vert(bm, c) for c in corners]
    a, b = v[:4], v[4:]
    face(bm, list(reversed(a)), mat)
    face(bm, b, mat)
    for i in range(4):
        j = (i + 1) % 4
        face(bm, [a[i], a[j], b[j], b[i]], side_mat or mat)


def box(bm, center, size, mat, rot=None, side_mat=None):
    """Box in car coordinates: centre, size (x, y, z) and an optional rotation matrix (3x3)."""
    sx, sy, sz = (s / 2 for s in size)
    rot = rot or Matrix.Identity(3)
    c = Vector(center)
    end = lambda z: [c + rot @ Vector(p) for p in ((-sx, -sy, z), (sx, -sy, z), (sx, sy, z), (-sx, sy, z))]  # noqa: E731
    hexa(bm, end(-sz) + end(sz), mat, side_mat)


def revolve(bm, profile, axis, segs, center=(0, 0, 0), start=0.0, closed=True):
    """Solid of revolution: profile = [(a, r, material)] along the axis ('x' or 'z'); the material holds
    for the stretch to the next point. A closed profile (the last point joins the first) gives a closed solid,
    so the normals can be worked out."""
    c = Vector(center)

    def point(a, r, t):
        if axis == 'x':
            return c + Vector((a, r * math.cos(t), r * math.sin(t)))
        return c + Vector((r * math.cos(t), r * math.sin(t), a))

    rings = []
    for i in range(segs):
        t = start + 2 * math.pi * i / segs
        rings.append([vert(bm, point(a, r, t)) for a, r, _ in profile])
    for i in range(segs):
        a, b = rings[i], rings[(i + 1) % segs]
        n = len(profile)
        for k in range(n if closed else n - 1):
            k1 = (k + 1) % n
            face(bm, [a[k], a[k1], b[k1], b[k]], profile[k][2])
    return rings


def prism(bm, outline, x0, x1, mat, side_mat=None):
    """The polygon outline = [(z, y)] extruded along x from x0 to x1 (convex or nearly convex)."""
    a = [vert(bm, (x0, y, z)) for z, y in outline]
    b = [vert(bm, (x1, y, z)) for z, y in outline]
    face(bm, list(reversed(a)), mat)
    face(bm, b, mat)
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        face(bm, [a[i], a[j], b[j], b[i]], side_mat or mat)
