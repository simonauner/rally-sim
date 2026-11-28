"""
Builds the Kvarn 240 in Blender and saves kvarn240.blend next to the script.

    blender -b --factory-startup -P blender/kvarn240/build.py

The script produces a first version. After that the .blend file is the source: edit it in Blender and run
blender/export.py to transfer it to the game. Only rerun this script if you want to start over.

Coordinates: everything is computed in car coordinates (x = left, y = up, z = forward, origin at the
centre of mass) and placed in Blender as X = x, Y = -z, Z = y, so the car points towards -Y as in
Blender's front view. The ground is at y = -0.55 and the wheel centres at y ≈ -0.23 when the car is at
rest in the game.

The dimensions follow the original (a boxy Swedish four-door saloon from the 80s): wheelbase 2.64 m,
4.64 m long over the bumpers, 1.71 m wide, 1.39 m high. Lengths and heights are measured from a straight
side view, scaled by the wheelbase. The body is the shell; lights, grille, bumpers and rims are parts of
their own.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from simplify import SHARP  # noqa: E402

GROUND = -0.55
WHEELS = [(1.188, -0.225), (-1.452, -0.24)]  # (z, y) front and rear
TRACK = [0.715, 0.72]
TYRE_R = 0.32

# The materials, in the same order as the palette in src/render/models/model.ts.
MATERIALS = [
    ('paint', (0.77, 0.33, 0.23)),
    ('glass', (0.17, 0.23, 0.26)),
    ('black', (0.11, 0.11, 0.11)),
    ('dark', (0.23, 0.23, 0.23)),
    ('chrome', (0.73, 0.75, 0.76)),
    ('lamp', (0.95, 0.91, 0.63)),
    ('amber', (0.91, 0.56, 0.16)),
    ('tail', (0.63, 0.09, 0.09)),
    ('reverse', (0.85, 0.83, 0.8)),
    ('plate', (0.93, 0.93, 0.92)),
    ('shade', (0.55, 0.24, 0.17)),  # seams: paint in shadow
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
    """Linear interpolation in a list of (x, y) sorted by x."""
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x <= x1:
            return lerp(y0, y1, (x - x0) / (x1 - x0))
    return points[-1][1]


# --- The shell: bonnet, sides, boot lid ------------------------------------------------------

# The panel's front and rear outline seen from the side (y, z). The front is nearly vertical: the lights and
# grille sit in a flat front below the bonnet's front edge, and the bumper (a part of its own) sits outside at
# the bottom. At the rear the rear panel is vertical and the boot lid's edge sticks out slightly over the lights.
FRONT = [(-0.29, 1.84), (-0.2, 1.92), (-0.02, 1.94), (0.02, 1.96), (0.27, 1.96), (0.3, 1.93)]
REAR = [(-0.26, -2.4), (-0.17, -2.5), (0.0, -2.535), (0.25, -2.545), (0.34, -2.555), (0.37, -2.545), (0.39, -2.515)]
NOSE, TAIL = 1.96, -2.555

COWL = 0.608  # windscreen foot (z)
HOOD_FRONT = 1.93
DECK_FRONT = -1.735  # rear window foot


def body_top(z):
    """Top centreline: flat bonnet sloping slightly forward, straight belt line and flat boot lid."""
    if z >= COWL:
        return lerp(0.385, 0.297, clamp01((z - COWL) / (HOOD_FRONT - COWL)))
    if z >= DECK_FRONT:
        return lerp(0.385, 0.39, (COWL - z) / (COWL - DECK_FRONT))
    return lerp(0.39, 0.38, (DECK_FRONT - z) / (DECK_FRONT - TAIL))


def body_bottom(z):
    return piecewise([(-2.555, -0.24), (-2.3, -0.3), (-1.95, -0.31), (1.6, -0.31), (1.96, -0.27)], z)


def body_halfwidth(z):
    """Half width seen from above: straight sides with small rounded corners front and rear."""
    w = 0.855
    if z > 1.82:
        w *= 1 - 0.11 * clamp01((z - 1.82) / 0.14) ** 2  # rounded corner behind the corner lights
    if z < -2.4:
        w *= 1 - 0.06 * clamp01((-2.4 - z) / 0.155) ** 2
    return w


def section(hw, bottom, top, rt, rb, side_ys=(), squeeze=lambda y: 1.0, crown=0.0, n_top=4, n_rt=5, n_rb=3):
    """Closed cross-section: straight top, side and bottom with rounded corners (radius rt at the top, rb
    at the bottom).

    Points go only where the shape needs them: n_top on the top, n_rt and n_rb per corner arc, and on the
    side only the heights in side_ys, where the side bends. Every section has the same number of points,
    mirrored about x = 0 and starting at the middle of the top. squeeze(y) scales x at height y, crown
    arches the top.
    """
    h = top - bottom
    rt, rb = min(rt, h / 2, hw), min(rb, h / 2, hw)
    lo, hi = bottom + rb, top - rt
    right = [((hw - rt) * i / n_top, top) for i in range(n_top)]
    right += [(hw - rt + rt * math.cos(a), hi + rt * math.sin(a)) for a in (math.pi / 2 * (1 - i / n_rt) for i in range(n_rt))]
    right += [(hw, y) for y in sorted((min(hi, max(lo, y)) for y in (hi, *side_ys)), reverse=True)]
    right += [(hw - rb + rb * math.cos(a), lo + rb * math.sin(a)) for a in (-math.pi / 2 * i / n_rb for i in range(n_rb))]
    right += [(hw - rb, bottom), (0, bottom)]
    pts = []
    for x, y in right:
        y += crown * max(0.0, 1 - (x / hw) ** 2) * clamp01((y - (top - 0.05)) / 0.05)
        pts.append((x * squeeze(y), y))
    return pts + [(-x, y) for x, y in reversed(pts[1:-1])]


def fill(zs, step):
    """Fills in sections so no gap is larger than step; the panels need vertices for the dents."""
    zs = sorted(zs)
    out = [zs[0]]
    for z in zs[1:]:
        n = math.ceil((z - out[-1]) / step - 1e-9)
        out += [lerp(out[-1], z, i / n) for i in range(1, n + 1)]
    return out


def loft(name, rings):
    """A closed shell of rings [(x, y, z), ...] (same number of points, mirrored as in section).

    The end caps are built from horizontal bands between the points and their mirror points, so they
    follow a curved front instead of becoming one flat n-gon. Coincident points (squeezed sections) are
    merged."""
    bm = bmesh.new()
    loops = [[bm.verts.new(to_blender(*p)) for p in ring] for ring in rings]
    k = len(loops[0])
    for a, b in zip(loops, loops[1:]):
        for i in range(k):
            j = (i + 1) % k
            bm.faces.new((a[i], a[j], b[j], b[i]))
    for ring in (loops[0], loops[-1]):
        for i in range(k // 2):
            vs = [ring[i], ring[i + 1], ring[(k - i - 1) % k], ring[(k - i) % k]]
            bm.faces.new([v for n, v in enumerate(vs) if v not in vs[:n]])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=0.001)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


# Front and rear panel: the last sections bend forward (back) from FRONT_FROM (REAR_FROM) out to the
# side outline, so the hood's leading edge, the front and the rear panel become smooth surfaces instead
# of steps. Sections are densest where the corners round off seen from above.
FRONT_FROM, REAR_FROM = 1.75, -2.35
END_STEPS = (0, 0.3, 0.5, 0.65, 0.76, 0.85, 0.91, 0.95, 0.98, 1)
# The outlines' break points become rows along the whole side, so the front and rear panel get their
# shapes; merge_flat joins them up again in the middle.
PROFILE_ROWS = sorted({y for y, _ in FRONT + REAR})


def lower_body():
    zs = {lerp(REAR_FROM, TAIL, s) for s in END_STEPS} | {lerp(FRONT_FROM, NOSE, s) for s in END_STEPS}
    zs |= {-2.3, -1.95, DECK_FRONT, COWL, 1.6}
    rings = []
    for zn in fill([z for z in zs if TAIL <= z <= NOSE], 0.25):
        top, bottom = body_top(zn), body_bottom(zn)
        # The sides are nearly vertical; the shoulder pulls in slightly towards the bonnet and boot lid.
        shoulder = lambda y, t=top: 1 - 0.025 * clamp01((y - (t - 0.12)) / 0.12)  # noqa: E731
        ring = section(body_halfwidth(zn), bottom, top, 0.05, 0.07, (top - 0.12, *PROFILE_ROWS), shoulder,
                       crown=0.012, n_top=3, n_rt=4)

        def z_at(y, zn=zn):
            if zn > FRONT_FROM:
                return lerp(FRONT_FROM, piecewise(FRONT, y), (zn - FRONT_FROM) / (NOSE - FRONT_FROM))
            if zn < REAR_FROM:
                return lerp(REAR_FROM, piecewise(REAR, y), (zn - REAR_FROM) / (TAIL - REAR_FROM))
            return zn

        rings.append([(x, y, z_at(y)) for x, y in ring])
    return loft('lower', rings)


# --- Cabin: upright windscreen, flat roof and nearly vertical rear window --------------------

ROOF = [(DECK_FRONT, 0.39), (-1.324, 0.815), (-1.22, 0.835), (-0.6, 0.84), (0.05, 0.835), (0.149, 0.815), (COWL, 0.385)]
ROOF_FRONT, ROOF_REAR = 0.149, -1.324


def greenhouse():
    rings = []
    # The roof, the cabin's taper and the windows' slope are straight between the break points, so the
    # sections go there. The ends continue down into the body, so the union cuts cleanly at the hood and
    # the boot lid.
    for z in fill([DECK_FRONT - 0.04, *(z for z, _ in ROOF), -1.2, 0.0, COWL + 0.04], 0.3):
        base = body_top(z) - 0.04
        top = piecewise(ROOF, z) if DECK_FRONT < z < COWL else body_top(z) - 0.015
        # The side windows lean inwards; the cabin narrows a little towards the windscreen and rear window.
        front = clamp01((z - 0.0) / 0.6)
        rear = clamp01((-1.2 - z) / 0.53)
        wb = 0.8 - 0.03 * front - 0.03 * rear
        wt = 0.68 - 0.04 * front - 0.04 * rear
        squeeze = lambda y, b=base, t=top, wb=wb, wt=wt: lerp(1, wt / wb, clamp01((y - b) / (t - b)))  # noqa: E731
        rings.append([(x, y, z) for x, y in section(wb, base, top, 0.06, 0.0, (), squeeze, crown=0.012, n_top=3, n_rt=4, n_rb=1)])
    return loft('greenhouse', rings)


ARCH_R = 0.37


def arch_cutters():
    cutters = []
    for zw, yw in WHEELS:
        for s in (1, -1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=ARCH_R, depth=0.5)
            c = bpy.context.active_object
            c.rotation_euler = (0, math.pi / 2, 0)
            c.location = to_blender(s * 0.86, yw, zw)
            cutters.append(c)
    return cutters


def apply_all(obj):
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def boolean(obj, other, op):
    mod = obj.modifiers.new(op.lower(), 'BOOLEAN')
    mod.operation = op
    mod.solver = 'EXACT'
    mod.object = other
    apply_all(obj)
    bpy.data.objects.remove(other)


def build_body():
    body = lower_body()
    body.name = 'body'
    boolean(body, greenhouse(), 'UNION')
    # The wheel arches are cut afterwards, so their edges are clean circles.
    for c in arch_cutters():
        boolean(body, c, 'DIFFERENCE')
    return body


# --- Colours: material per face --------------------------------------------------------------
#
# The colour fields are bounded by planes. The mesh is first cut along the planes (cut_planes), so each face
# ends up entirely on one side and the edges become straight; then the material is chosen from the face's centre and normal.


def plane(nx, ny, nz, d):
    """The plane n·p = d in car coordinates, normalised."""
    n = Vector((nx, ny, nz))
    return n.normalized(), d / n.length


def above(p, pl):
    return Vector(p).dot(pl[0]) > pl[1]


def mirrored(x):
    return [plane(1, 0, 0, x), plane(-1, 0, 0, x)]


def line_plane(a, b, x_axis=False):
    """The plane through the line a–b in (z, y) (or (|x|, y) with x_axis), normal up-forward (outwards)."""
    (u0, y0), (u1, y1) = a, b
    nu, ny = y1 - y0, u0 - u1
    if ny < 0:
        nu, ny = -nu, -ny
    return plane(nu, ny, 0, nu * u0 + ny * y0) if x_axis else plane(0, ny, nu, nu * u0 + ny * y0)


Y = lambda y: plane(0, 1, 0, y)  # noqa: E731
Z = lambda z: plane(0, 0, 1, z)  # noqa: E731

# The cabin: the belt line, the roof edge, the edges of the windscreen and rear window, the pillars (z) and the side windows.
BELT_Y, WINDOW_TOP = 0.405, 0.785
# The A-pillar is painted and equally wide all the way, with a black rubber seal against the windscreen and door window.
A_LINE = line_plane((COWL - 0.075, BELT_Y), (ROOF_FRONT - 0.04, WINDOW_TOP))  # the door window's front edge
A_FRAME = line_plane((COWL - 0.057, BELT_Y), (ROOF_FRONT - 0.022, WINDOW_TOP))
C_LINE = line_plane((-1.508, BELT_Y), (-1.30, WINDOW_TOP))  # the quarter window's rear edge
B_PILLAR = (-0.40, -0.33)
REAR_FRAME = (-1.225, -1.19)  # the rear door's frame between the door window and the quarter window
# The windscreen's side edge follows the cabin's corner (|x| = 0.68 − 0.0667·z, see greenhouse) at a fixed distance, so
# the A-pillar is equally wide all the way; the rubber seal lies between the glass and the pillar.
SCREEN_SIDE = plane(1, 0, 0.0667, 0.68 - 0.05)
SCREEN_FRAME = plane(1, 0, 0.0667, 0.68 - 0.034)
BACKLIGHT_SIDE = line_plane((0.67, 0.44), (0.55, 0.79), x_axis=True)
BACKLIGHT_Y = (0.45, 0.79)
# Seams: the doors, the bonnet and the boot lid.
SEAM_W = 0.01
DOOR_SEAMS = (0.541, -0.372, -1.194)
HOOD_SEAM_X, TRUNK_SEAM_X = 0.735, 0.725
TRUNK_SEAM_Z, TRUNK_LIP_Y = -1.79, 0.235
# The side: a black strip along the whole car and black sills and door bottoms.
CREASE_Y = (0.225, 0.25)
SILL_Y = -0.16

FRONT_ZONE = lambda c: c[2] > 1.6  # noqa: E731
REAR_ZONE = lambda c: c[2] < -2.1  # noqa: E731
CABIN_ZONE = lambda c: -1.9 < c[2] < 0.72 and c[1] > 0.36  # noqa: E731
SIDE_ZONE = lambda c: abs(c[0]) > 0.7 and c[1] < 0.42  # noqa: E731
HOOD_ZONE = lambda c: c[2] > 0.62 and c[1] > 0.26  # noqa: E731
TRUNK_ZONE = lambda c: c[2] < -1.7 and c[1] > 0.2  # noqa: E731

CUTS = [
    (CABIN_ZONE, [Y(BELT_Y), Y(WINDOW_TOP), Y(WINDOW_TOP + 0.015), A_LINE, A_FRAME, C_LINE, Z(ROOF_FRONT), Z(ROOF_REAR),
                  *(Z(v) for v in (*B_PILLAR, *REAR_FRAME)), *(pl for sc in (SCREEN_SIDE, SCREEN_FRAME) for pl in (sc, plane(-sc[0].x, sc[0].y, sc[0].z, sc[1]))),
                  BACKLIGHT_SIDE, plane(-BACKLIGHT_SIDE[0].x, BACKLIGHT_SIDE[0].y, 0, BACKLIGHT_SIDE[1]), *(Y(v) for v in BACKLIGHT_Y)]),
    (SIDE_ZONE, [Z(v + d) for v in DOOR_SEAMS for d in (-SEAM_W / 2, SEAM_W / 2)] + [Y(v) for v in (*CREASE_Y, SILL_Y)]),
    (HOOD_ZONE, [p for d in (0, SEAM_W) for p in mirrored(HOOD_SEAM_X + d)]),
    (TRUNK_ZONE, [p for d in (0, SEAM_W) for p in mirrored(TRUNK_SEAM_X + d)] + [Z(TRUNK_SEAM_Z), Z(TRUNK_SEAM_Z - SEAM_W),
                                                                              Y(TRUNK_LIP_Y), Y(TRUNK_LIP_Y + SEAM_W)]),
    (FRONT_ZONE, [Y(-0.16), Y(0.0), Y(0.255), *mirrored(0.86)]),
]


def cut_planes(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for zone, planes in CUTS:
        for n, d in planes:
            faces = [f for f in bm.faces if zone(to_car(f.calc_center_median()))]
            edges = list({e for f in faces for e in f.edges})
            verts = list({v for f in faces for v in f.verts})
            bmesh.ops.bisect_plane(bm, geom=faces + edges + verts, plane_co=to_blender(*(n * d)), plane_no=to_blender(*n))
    bm.to_mesh(obj.data)
    bm.free()


def pane_material(p, n):
    """The cabin: windows with black frames and pillars, painted roof and C-pillar."""
    x, y, z = p
    ax = abs(x)
    if y < BELT_Y:
        return None
    # The windscreen and rear window are bounded only by the planes, so the edges against the pillars become straight.
    if z > ROOF_FRONT and not above((ax, y, z), SCREEN_SIDE):
        return M['glass']
    if z < ROOF_REAR and not above((ax, y, z), BACKLIGHT_SIDE):
        return M['glass'] if BACKLIGHT_Y[0] < y < BACKLIGHT_Y[1] else M['black']
    # The sides: the windows below the roof edge, with black frame and pillars; the roof and the C-pillar painted.
    if y > WINDOW_TOP + 0.015:
        return M['paint']
    if z > ROOF_FRONT - 0.1 and not above((ax, y, z), SCREEN_FRAME):
        return M['black']
    if above(p, A_FRAME):
        return M['paint']
    if y > WINDOW_TOP or above(p, A_LINE):
        return M['black']
    if B_PILLAR[0] <= z <= B_PILLAR[1] or REAR_FRAME[0] <= z <= REAR_FRAME[1]:
        return M['black']
    if above(p, C_LINE):
        return M['paint']
    return M['glass']


def face_material(p, n):
    x, y, z = p
    ax = abs(x)
    # The wheel arches.
    for zw, yw in WHEELS:
        if 0.45 < ax < 0.87 and math.hypot(z - zw, y - yw) < ARCH_R + 0.02 and abs(n.x) < 0.8:
            return M['black']
    if CABIN_ZONE(p):
        pane = pane_material(p, n)
        if pane is not None:
            return pane
    # The front behind the lights and grille; the paint goes down to the lights' top edge and below the bumper.
    if FRONT_ZONE(p) and z > 1.9 and 0.0 < y < 0.255 and n.z > 0.5:
        return M['black']
    if SIDE_ZONE(p) and abs(n.x) > 0.4:
        # The sill ends in the front wheel arch; the apron under the front bumper is painted.
        if y < SILL_Y and z < WHEELS[0][0]:
            return M['black']
        if CREASE_Y[0] < y < CREASE_Y[1]:
            return M['black']
        if any(abs(z - v) < SEAM_W / 2 for v in DOOR_SEAMS) and y > -0.2:
            return M['shade']
    if HOOD_ZONE(p) and n.y > 0.5 and HOOD_SEAM_X < ax < HOOD_SEAM_X + SEAM_W:
        return M['shade']
    if TRUNK_ZONE(p):
        if n.y > 0.5 and (TRUNK_SEAM_X < ax < TRUNK_SEAM_X + SEAM_W and z < TRUNK_SEAM_Z or TRUNK_SEAM_Z - SEAM_W < z < TRUNK_SEAM_Z and ax < TRUNK_SEAM_X + SEAM_W):
            return M['shade']
        if n.z < -0.5 and TRUNK_LIP_Y < y < TRUNK_LIP_Y + SEAM_W:
            return M['shade']
    if REAR_ZONE(p) and y < -0.16:
        return M['black']
    return M['paint']


def assign_materials(obj, rule):
    obj.data.materials.clear()
    for name, rgb in MATERIALS:
        mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        mat.diffuse_color = (*rgb, 1)
        obj.data.materials.append(mat)
    mw = obj.matrix_world
    for poly in obj.data.polygons:
        c = to_car(mw @ poly.center)
        n = Vector(to_car(mw.to_3x3() @ poly.normal))
        poly.material_index = rule(c, n)


def merge_flat(obj):
    """Merges faces that lie in one plane and share a colour. The colour-field cuts (cut_planes) and the
    outline rows (PROFILE_ROWS) run through whole zones and otherwise leave rows of vertices where
    neither colour nor shape changes."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    # Two cuts in the same plane (e.g. two colour fields ending at the same height) leave doubled
    # vertices with flat strips between them, which split the surface in the shading.
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=0.0001)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1), verts=bm.verts, edges=bm.edges, delimit={'MATERIAL'})
    bm.to_mesh(obj.data)
    bm.free()


def mark_sharp(obj):
    """Smooth shading, but creases (edges steeper than SHARP) sharp, like pressed sheet metal. export.py
    gives the corners on a crease their own vertices, so the game doesn't round them off."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle() <= SHARP
    bm.to_mesh(obj.data)
    bm.free()


# --- Loose details ---------------------------------------------------------------------------


def new_object(name, bm, mats, at):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = to_blender(*at)
    bpy.context.scene.collection.objects.link(obj)
    for m in mats:
        obj.data.materials.append(bpy.data.materials[m])
    return obj


def assembly(name, at, boxes, prisms=()):
    """A part made of boxes [(material, (x0, x1), (y0, y1), (z0, z1))] and vertical prisms [(material, [(x, z), ...],
    (y0, y1))] with a convex base seen from above, in car coordinates, with its origin at `at`."""
    mats = []
    bm = bmesh.new()
    for mat, poly, (y0, y1) in prisms:
        if mat not in mats:
            mats.append(mat)
        lo = [bm.verts.new(to_blender(x - at[0], y0 - at[1], z - at[2])) for x, z in poly]
        hi = [bm.verts.new(to_blender(x - at[0], y1 - at[1], z - at[2])) for x, z in poly]
        faces = [bm.faces.new(lo), bm.faces.new(list(reversed(hi)))]
        for i in range(len(poly)):
            j = (i + 1) % len(poly)
            faces.append(bm.faces.new((lo[i], lo[j], hi[j], hi[i])))
        for f in faces:
            f.material_index = mats.index(mat)
    for mat, xs, ys, zs in boxes:
        if mat not in mats:
            mats.append(mat)
        r = bmesh.ops.create_cube(bm, size=1)
        size = (xs[1] - xs[0], ys[1] - ys[0], zs[1] - zs[0])
        mid = (sum(xs) / 2 - at[0], sum(ys) / 2 - at[1], sum(zs) / 2 - at[2])
        bmesh.ops.scale(bm, vec=Vector((size[0], size[2], size[1])), verts=r['verts'])
        bmesh.ops.translate(bm, vec=to_blender(*mid), verts=r['verts'])
        for f in {f for v in r['verts'] for f in v.link_faces}:
            f.material_index = mats.index(mat)
    return new_object(name, bm, mats, at)


def mirror_x(xs, s):
    return tuple(sorted((s * xs[0], s * xs[1])))


def cylinder_z(name, mat, at, r, length, segs=20):
    """Cylinder along the car's z (forward) centred at `at`."""
    bm = bmesh.new()
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=length)
    bmesh.ops.rotate(bm, cent=Vector(), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'), verts=res['verts'])
    return new_object(name, bm, [mat], at)


def tube_z(bm, r, length, segs=20, wall=0.004):
    """Open tube along the car's z centred on the origin: the outside and the mouth's rim get material 0, the inside 1.
    Returns the tube's vertices."""
    prof = [(r, -length / 2), (r, length / 2), (r - wall, length / 2), (r - wall, -length / 2)]
    rings = [[bm.verts.new(to_blender(rad * math.cos(a), rad * math.sin(a), z))
              for a in (2 * math.pi * i / segs for i in range(segs))] for rad, z in prof]
    faces = []
    for k, (a, b) in enumerate(zip(rings, rings[1:] + rings[:1])):
        for i in range(segs):
            j = (i + 1) % segs
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = 1 if k == 2 else 0
            faces.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return [v for ring in rings for v in ring]


# The headlights: large rectangular glasses in a chrome frame, and corner lights that wrap around the corner, clear
# at the top and yellow at the bottom. The grille between them has the same height.
LAMP_Y = (0.03, 0.25)
HEAD_X, CORNER_X, LAMP_FACE = (0.272, 0.66), (0.667, 0.858), 1.975
CORNER_SPLIT, CORNER_BACK, CORNER_R = 0.135, 1.8, 0.13
GRILLE_X = 0.262


def headlamp(s, side):
    xs = lambda a, b: mirror_x((a, b), s)  # noqa: E731
    boxes = [
        ('chrome', xs(HEAD_X[0] - 0.008, HEAD_X[1] + 0.004), (LAMP_Y[0] - 0.008, LAMP_Y[1] + 0.008), (1.93, LAMP_FACE - 0.006)),
        ('lamp', xs(*HEAD_X), LAMP_Y, (1.93, LAMP_FACE)),
    ]
    # The corner light seen from above: the front wraps around the rounded outer corner back along the side.
    x0, x1, face, r = CORNER_X[0], CORNER_X[1], LAMP_FACE - 0.004, CORNER_R
    arc = [(x1 - r + r * math.sin(a), face - r + r * math.cos(a)) for a in (math.pi / 2 * i / 8 for i in range(9))]
    poly = [(s * x, z) for x, z in [(x0, face), *arc, (x1, CORNER_BACK), (x1 - 0.07, CORNER_BACK), (x0, 1.93)]]
    prisms = [('lamp', poly, (CORNER_SPLIT, LAMP_Y[1])), ('amber', poly, (LAMP_Y[0], CORNER_SPLIT))]
    return assembly(f'headlamp_{side}', (s * 0.53, sum(LAMP_Y) / 2, 1.95), boxes, prisms)


def grille():
    y0, y1 = LAMP_Y
    face = 1.972
    boxes = [
        ('black', (-GRILLE_X, GRILLE_X), (y0, y1), (1.93, face - 0.012)),
        # Chrome frame all around.
        ('chrome', (-GRILLE_X - 0.008, GRILLE_X + 0.008), (y1 - 0.012, y1 + 0.008), (1.93, face)),
        ('chrome', (-GRILLE_X - 0.008, GRILLE_X + 0.008), (y0 - 0.008, y0 + 0.012), (1.93, face)),
        ('chrome', (GRILLE_X - 0.012, GRILLE_X + 0.008), (y0, y1), (1.93, face)),
        ('chrome', (-GRILLE_X - 0.008, -GRILLE_X + 0.012), (y0, y1), (1.93, face)),
        # The badge in the middle of the grille: a simple chrome plaque.
        ('chrome', (-0.032, 0.032), (0.165, 0.215), (1.93, face + 0.006)),
    ]
    # Dense vertical slats.
    n = 17
    for i in range(n):
        x = lerp(-GRILLE_X + 0.03, GRILLE_X - 0.03, i / (n - 1))
        boxes.append(('dark', (x - 0.006, x + 0.006), (y0 + 0.012, y1 - 0.012), (1.93, face - 0.004)))
    return assembly('grille', (0, sum(LAMP_Y) / 2, 1.95), boxes)


# The bumpers: black, straight across the front and rear panel and wrapped around the corners back (forward) to
# the wheel arches, with a dark grey rubbing strip in the middle of the face.
BUMPER_Y = (-0.16, 0.0)
BUMPER_HALF, BUMPER_DEPTH, BUMPER_R = 0.88, 0.075, 0.1


def bumper(name, z_face, z_end):
    """A U-shaped bumper: the face at z_face, the sides back to z_end."""
    d = 1 if z_face > z_end else -1
    h, r = BUMPER_HALF, BUMPER_R
    # The path seen from above (x, z) with an outward normal, from the right side around to the left.
    path = []
    for i in range(6):
        path.append(((-h, lerp(z_end, z_face - d * r, i / 5)), (-1, 0)))
    for i in range(1, 8):
        a = math.pi / 2 * i / 8
        nx, nz = -math.cos(a), d * math.sin(a)
        path.append(((-h + r + r * nx, z_face - d * r + r * nz), (nx, nz)))
    for i in range(9):
        path.append(((lerp(-h + r, h - r, i / 8), z_face), (0, d)))
    for i in range(1, 8):
        a = math.pi / 2 * (1 - i / 8)
        nx, nz = math.cos(a), d * math.sin(a)
        path.append(((h - r + r * nx, z_face - d * r + r * nz), (nx, nz)))
    for i in range(6):
        path.append(((h, lerp(z_face - d * r, z_end, i / 5)), (1, 0)))
    y0, y1 = BUMPER_Y
    # The cross-section (outwards, y): the bottom edge pulls in, the face with a strip, the top leans in towards the panel.
    sec = [(-0.02, y0), (0, y0 + 0.035), (0, y0 + 0.065), (0.004, y0 + 0.095), (0, y0 + 0.125), (-0.015, y1),
           (-BUMPER_DEPTH, y1), (-BUMPER_DEPTH, y0)]
    mats = [0, 0, 1, 1, 0, 0, 0, 0]  # black, dark
    bm = bmesh.new()
    at = (0, (y0 + y1) / 2, z_face - d * 0.2)
    rings = [[bm.verts.new(to_blender(x + nx * o - at[0], y - at[1], z + nz * o - at[2])) for o, y in sec] for (x, z), (nx, nz) in path]
    k = len(sec)
    for a, b in zip(rings, rings[1:]):
        for i in range(k):
            j = (i + 1) % k
            bm.faces.new((a[i], a[j], b[j], b[i])).material_index = mats[i]
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    return new_object(name, bm, ['black', 'dark'], at)


# The tail lights: large rectangles below the boot lid's edge, three fields in two rows with chrome dividers:
# yellow indicator outermost and reversing light in the middle at the top, red otherwise. The outer edge wraps around the corner.
TAIL_Y = (0.035, 0.212)
TAIL_X = (0.44, 0.835)
TAIL_SPLIT, TAIL_FACE = 0.124, -2.565
TAIL_COLS = [(0.44, 0.568), (0.574, 0.7), (0.706, 0.835)]


def taillamp(s, side):
    xs = lambda a, b: mirror_x((a, b), s)  # noqa: E731
    back = (TAIL_FACE + 0.006, -2.5)
    boxes = [('chrome', xs(TAIL_X[0] - 0.008, 0.858), (TAIL_Y[0] - 0.008, TAIL_Y[1] + 0.008), back)]
    top = ['tail', 'reverse', 'amber']
    for (x0, x1), mat in zip(TAIL_COLS, top):
        boxes.append((mat, xs(x0, x1), (TAIL_SPLIT + 0.003, TAIL_Y[1]), (TAIL_FACE, -2.5)))
        boxes.append(('tail', xs(x0, x1), (TAIL_Y[0], TAIL_SPLIT - 0.003), (TAIL_FACE, -2.5)))
    # Around the corner: yellow at the top, red at the bottom.
    boxes.append(('amber', xs(0.835, 0.862), (TAIL_SPLIT + 0.003, TAIL_Y[1]), (TAIL_FACE + 0.006, -2.44)))
    boxes.append(('tail', xs(0.835, 0.862), (TAIL_Y[0], TAIL_SPLIT - 0.003), (TAIL_FACE + 0.006, -2.44)))
    return assembly(f'taillamp_{side}', (s * 0.64, sum(TAIL_Y) / 2, -2.53), boxes)


# The mirror: a black triangular foot in the door window's front corner, a short arm and a rounded housing that
# tapers towards the front, with the mirror glass facing back.
MIRROR_FOOT = (0.585, 0.455)  # the foot's front and rear edge (z) on the belt line
MIRROR_HOUSING = ((0.825, 0.975), (0.445, 0.56), (0.475, 0.535))  # x, y, z (rear, front)


def mirror(body, s, side):
    bm = bmesh.new()
    (hx0, hx1), (hy0, hy1), (hz0, hz1) = MIRROR_HOUSING
    at = (s * (hx0 + hx1) / 2, (hy0 + hy1) / 2, (hz0 + hz1) / 2)

    def v(x, y, z):
        return bm.verts.new(to_blender(s * x - at[0], y - at[1], z - at[2]))

    def faces(rings, mats):
        """Rings in order (the same number of points); caps at both ends with the first and last material."""
        k = len(rings[0])
        for a, b, m in zip(rings, rings[1:], mats[1:-1]):
            for i in range(k):
                j = (i + 1) % k
                bm.faces.new((a[i], a[j], b[j], b[i])).material_index = m
        bm.faces.new(rings[0]).material_index = mats[0]
        bm.faces.new(list(reversed(rings[-1]))).material_index = mats[-1]

    # The foot: a three-sided wedge standing on the door, highest at the front towards the A-pillar.
    zf, zb = MIRROR_FOOT
    root = surface_x(body, BELT_Y + 0.02, (zf + zb) / 2) - 0.015
    tri = lambda x: [v(x, BELT_Y - 0.005, zf), v(x, BELT_Y + 0.085, zf), v(x, BELT_Y - 0.005, zb)]  # noqa: E731
    faces([tri(root), tri(root + 0.035)], [0, 0, 0])
    # The arm out to the housing.
    arm = lambda x: [v(x, 0.47, 0.52), v(x, 0.495, 0.52), v(x, 0.495, 0.49), v(x, 0.47, 0.49)]  # noqa: E731
    faces([arm(root + 0.03), arm(hx0 + 0.03)], [0, 0, 0])
    # The housing: rounded rectangle seen from behind (x, y), narrower and lower at the front.
    def outline(shrink):
        cx, cy = (hx0 + hx1) / 2, (hy0 + hy1) / 2
        w, h, r = (hx1 - hx0) / 2 - shrink, (hy1 - hy0) / 2 - shrink * 0.6, 0.03
        pts = []
        for cxs, cys, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
            # The inner corner against the door is sharper than the outer one.
            rr = r if cxs > 0 else 0.012
            for i in range(5):
                a = math.radians(a0 + 90 * i / 4)
                pts.append((cx + cxs * (w - rr) + rr * math.cos(a), cy + cys * (h - rr) + rr * math.sin(a)))
        return pts

    rings = [[v(x, y, z) for x, y in outline(sh)] for z, sh in ((hz0, 0.0), (hz0 + 0.03, 0.0), (hz1, 0.022))]
    glass = [v(x, y, hz0 - 0.004) for x, y in outline(0.012)]
    faces([*rings], [0, 0, 0, 0])
    # The mirror glass facing back, slightly inside the housing's edge.
    bm.faces.new(list(reversed(glass))).material_index = 1
    return new_object(f'mirror_{side}', bm, ['black', 'dark'], at)
MUFFLER_X, MUFFLER_Z, MUFFLER_R = -0.42, (-1.8, -2.2), 0.08


def surface_x(body, y, z):
    """Where the body's side is (x) at height y at z, measured with a ray from the outside."""
    hit, loc, _, _ = body.ray_cast(to_blender(2, y, z), Vector((-1, 0, 0)))
    assert hit, f'no body at y={y}, z={z}'
    return loc.x


def floor_y(body, x, z):
    """Where the floor is (y) below x, z, measured with a ray from below."""
    hit, loc, _, _ = body.ray_cast(to_blender(x, -1, z), Vector((0, 0, 1)))
    assert hit, f'no floor at x={x}, z={z}'
    return loc.z


def details(body):
    objs = [grille()]
    for s, side in ((1, 'L'), (-1, 'R')):
        objs.append(headlamp(s, side))
        objs.append(taillamp(s, side))
        objs.append(mirror(body, s, side))
        for i, z in enumerate((-0.252, -1.08)):
            x = surface_x(body, 0.31, z)
            objs.append(assembly(f'handle_{side}{i}', (s * x, 0.31, z), [('black', mirror_x((x - 0.01, x + 0.012), s), (0.295, 0.325), (z - 0.07, z + 0.07))]))
        # Side indicators on the front wing behind the wheel arch.
        x = surface_x(body, 0.16, 0.66)
        objs.append(assembly(f'sidemarker_{side}', (s * x, 0.16, 0.66), [('amber', mirror_x((x - 0.01, x + 0.006), s), (0.15, 0.17), (0.63, 0.69))]))
        for zw, nm in ((WHEELS[0][0], 'F'), (WHEELS[1][0], 'R')):
            objs.append(assembly(f'flap_{nm}{side}', (s * 0.72, -0.37, zw - 0.43), [('black', mirror_x((0.62, 0.82), s), (-0.47, -0.27), (zw - 0.44, zw - 0.425))]))
    objs.append(bumper('bumper_front', 2.033, 1.6))
    objs.append(bumper('bumper_rear', -2.605, -2.15))
    objs.append(assembly('plate_front', (0, -0.08, 2.04), [('plate', (-0.26, 0.26), (-0.135, -0.025), (2.03, 2.042))]))
    objs.append(assembly('plate_rear', (0, 0.095, -2.55), [('plate', (-0.26, 0.26), (0.04, 0.15), (-2.556, -2.54))]))
    # The silencer under the floor in front of the rear bumper; the exhaust pipe exits below the bumper.
    top = min(floor_y(body, MUFFLER_X, z) for z in MUFFLER_Z)
    y = top - MUFFLER_R + 0.01
    objs.append(cylinder_z('muffler', 'dark', (MUFFLER_X, y, sum(MUFFLER_Z) / 2), MUFFLER_R, MUFFLER_Z[0] - MUFFLER_Z[1], 16))
    bm = bmesh.new()
    tube_z(bm, 0.03, MUFFLER_Z[1] + 2.58)
    objs.append(new_object('exhaust', bm, ['chrome', 'black'], (MUFFLER_X, y - 0.02, (MUFFLER_Z[1] - 2.58) / 2)))
    return objs


# --- The rim: silver alloy rim with a dense ring of straight spokes --------------------------
#
# Built around the wheel's axle (the car's x) with its origin at the wheel centre and looks the same from both
# sides, so the same rim fits all four wheels. The game puts it in a hollow tyre with inner radius 0.205 m.

RIM_R, LIP_W, RIM_FACE = 0.215, 0.02, 0.105
SPOKE_COUNT, SPOKE_R = 20, (0.07, 0.197)
SPOKE_W = (0.0075, 0.0135)  # half width at the hub and at the edge
SPOKE_FACE, SPOKE_T = (0.09, 0.098), 0.02
CAP_R = 0.07


def rim():
    mats = ['chrome', 'dark', 'black']
    C, D, B = range(3)
    bm = bmesh.new()

    def v(a, y, z):
        return bm.verts.new(to_blender(a, y, z))

    def tube(r_in, r_out, a0, a1, mat, segs=32):
        sec = [(r_out, a0), (r_out, a1), (r_in, a1), (r_in, a0)]
        loops = [[v(a, r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs)) for r, a in sec] for i in range(segs)]
        for i in range(segs):
            p, q = loops[i], loops[(i + 1) % segs]
            for k in range(4):
                bm.faces.new((p[k], p[(k + 1) % 4], q[(k + 1) % 4], q[k])).material_index = mat

    def disc(r, a0, a1, mat, segs=24):
        ring = lambda a: [v(a, r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs)) for i in range(segs)]  # noqa: E731
        f, b = ring(a1), ring(a0)
        bm.faces.new(f).material_index = mat
        bm.faces.new(list(reversed(b))).material_index = mat
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((f[i], b[i], b[j], f[j])).material_index = mat

    def spoke(phi, s):
        d, t = (math.cos(phi), math.sin(phi)), (-math.sin(phi), math.cos(phi))
        r0, r1 = SPOKE_R
        quad = [(r0, -SPOKE_W[0]), (r1, -SPOKE_W[1]), (r1, SPOKE_W[1]), (r0, SPOKE_W[0])]
        face = lambda u: lerp(*SPOKE_FACE, (u - r0) / (r1 - r0))  # noqa: E731
        pt = lambda u, w, a: v(s * a, u * d[0] + w * t[0], u * d[1] + w * t[1])  # noqa: E731
        front = [pt(u, w, face(u)) for u, w in quad]
        back = [pt(u, w, face(u) - SPOKE_T) for u, w in quad]
        bm.faces.new(front).material_index = C
        bm.faces.new(list(reversed(back))).material_index = C
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((front[i], back[i], back[j], front[j])).material_index = C

    tube(RIM_R - 0.024, RIM_R - 0.017, -RIM_FACE + 0.01, RIM_FACE - 0.01, D)  # the drum behind the spokes
    disc(RIM_R - 0.022, -0.04, 0.04, B)  # black bottom, so the gaps between the spokes look dark
    for s in (1, -1):
        a0, a1 = sorted((s * (RIM_FACE - LIP_W), s * RIM_FACE))
        tube(RIM_R - LIP_W, RIM_R, a0, a1, C)
        for k in range(SPOKE_COUNT):
            spoke(2 * math.pi * k / SPOKE_COUNT, s)
        # The hubcap: a flat disc with a dark centre.
        c0, c1 = sorted((s * 0.05, s * (SPOKE_FACE[0] + 0.006)))
        disc(CAP_R, c0, c1, C)
        m0, m1 = sorted((s * (SPOKE_FACE[0] + 0.006), s * (SPOKE_FACE[0] + 0.01)))
        disc(0.03, m0, m1, D, 16)
    obj = new_object('rim', bm, mats, (TRACK[0], WHEELS[0][1], WHEELS[0][0]))
    return obj


def reference():
    """Wheels and ground to model against. Not exported."""
    coll = bpy.data.collections.new('Reference')
    bpy.context.scene.collection.children.link(coll)
    for (zw, yw), xw in zip(WHEELS, TRACK):
        for s in (1, -1):
            # Hollow tyre, so the rim shows inside it.
            bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=TYRE_R, depth=0.205, end_fill_type='NOTHING')
            w = bpy.context.active_object
            sol = w.modifiers.new('wall', 'SOLIDIFY')
            sol.thickness, sol.offset = TYRE_R - RIM_R + 0.01, -1
            w.rotation_euler = (0, math.pi / 2, 0)
            w.location = to_blender(s * xw, yw, zw)
            w.name = 'wheel'
            bpy.context.scene.collection.objects.unlink(w)
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
    body = build_body()
    cut_planes(body)
    assign_materials(body, face_material)
    merge_flat(body)
    mark_sharp(body)
    wheel_rim = rim()
    for obj in [body, *details(body), wheel_rim]:
        bpy.context.scene.collection.objects.unlink(obj)
        export.objects.link(obj)
    reference()
    # The rim on the other three wheels too, just for looking at (the same mesh).
    for (zw, yw), xw in zip(WHEELS, TRACK):
        for sx in (1, -1):
            if (zw, sx) != (WHEELS[0][0], 1):
                copy = wheel_rim.copy()
                copy.location = to_blender(sx * xw, yw, zw)
                bpy.data.collections['Reference'].objects.link(copy)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'kvarn240.blend')
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print('saved', out, len(body.data.vertices), 'vertices')


main()
