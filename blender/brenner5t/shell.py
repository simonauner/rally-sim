"""
The body shell: the lower body and the cabin are built from cross-sections, joined into one mesh, given
wheel arches and colour fields, and then split into panels (doors, bumpers, hatch) that dent separately in the game.
"""

import math

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from common import GROUND, M, MATERIALS, TRACK, WHEELS, apply_all, box, clamp01, lerp, piecewise, set_materials, to_blender, to_car  # noqa: F401
from simplify import SHARP

# --- Lower body: bonnet, sides, bumpers and tail ------------------------------------------
#
# The measurements are taken from a straight side drawing, scaled to the wheelbase (2.52 m) and placed on
# the wheel centres: 1 px = 3.128 mm. The widths come from pictures straight from the front and the rear.

# Front and rear outline seen from the side: how far forward/back the panel reaches at height y.
# Front: a low spoiler with intakes, the bumper furthest forward, the lamps and grille in a flat band above
# it and the front edge of the bonnet rounding off backwards.
FRONT = [(-0.32, 1.80), (-0.29, 1.85), (-0.2, 1.875), (-0.15, 1.9), (-0.02, 1.905), (0.0, 1.895), (0.012, 1.862),
         (0.175, 1.855), (0.2, 1.835), (0.215, 1.79)]
# Rear: the bumper with a step at its top edge, an upright tail panel with the lamps, and the deck above it
# rounding off towards the spoiler.
REAR = [(-0.30, -2.30), (-0.27, -2.35), (-0.16, -2.405), (0.0, -2.415), (0.045, -2.41), (0.054, -2.33), (0.065, -2.315),
        (0.40, -2.305), (0.43, -2.29), (0.45, -2.26)]

# The shoulder line: the panel is upright below the crease and leans in towards the belt line above it.
CREASE = 0.17
SHOULDER_W = 0.785


def hood_top(z):
    return piecewise([(0.55, 0.372), (0.708, 0.367), (0.896, 0.355), (1.21, 0.323), (1.52, 0.28), (1.74, 0.236),
                      (1.86, 0.212), (1.905, 0.2)], z)


def body_top(z):
    """Centre line of the top: bonnet, belt line under the cabin, the deck under the rear screen and the spoiler."""
    if z >= 0.55:
        return hood_top(z)
    if z >= -1.6:
        return belt_y(z) + 0.01
    return piecewise([(-2.415, 0.45), (-2.27, 0.455), (-2.0, 0.5), (-1.6, belt_y(-1.6) + 0.01)], z)


def belt_y(z):
    """Bottom edge of the side windows (the plane BELT) at z: rises slightly towards the rear."""
    return 0.335 - 0.02 * z


def hood_crown(z):
    """The bonnet is nearly flat; the rear deck is slightly crowned."""
    return 0.012


def body_bottom(z):
    return piecewise([(-2.415, -0.29), (-2.3, -0.3), (1.6, -0.305), (1.905, -0.31)], z)


def flare_at(z):
    """0–1: how much the box flares bulge out at z. The flares stay wide all the way to the doors and the
    doors are flat; the step sits in the door seam."""
    front, rear = DOOR_SEAMS
    return clamp01((z - front + 0.03) / 0.06) + clamp01((rear - z + 0.03) / 0.06)


def body_halfwidth(z):
    """Half width below the shoulder line seen from above: box flares round the wheels, nearly square
    corners front and rear."""
    w = 0.83 + 0.035 * flare_at(z)
    if z > 1.6:
        w *= 1 - 0.05 * clamp01((z - 1.6) / 0.305) ** 2
    if z < -2.2:
        w *= 1 - 0.03 * clamp01((-2.2 - z) / 0.215) ** 2
    return w


def section(hw, bottom, top, rt, rb, side_ys=(), squeeze=lambda y: 1.0, crown=0.0, n_top=4, n_rt=5, n_rb=3):
    """Closed cross-section: straight top, side and bottom with rounded corners (radius rt at the top, rb at the bottom).

    Points go only where the shape needs them: n_top on the top, n_rt and n_rb per corner arc and on the
    side only the heights in side_ys, where the side bends. The same number of points in every section,
    mirrored about x = 0 and starting in the middle of the top. squeeze(y) scales x at height y, crown crowns the top.
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
    """Fills in the sections so no gap is larger than step; the panels need vertices for the dents."""
    zs = sorted(zs)
    out = [zs[0]]
    for z in zs[1:]:
        n = math.ceil((z - out[-1]) / step - 1e-9)
        out += [lerp(out[-1], z, i / n) for i in range(1, n + 1)]
    return out


def loft(name, rings):
    """A closed shell from rings [(x, y, z), ...] (the same number of points, mirrored as in section).

    The caps at the ends are built from horizontal bands between the points and their mirror points, so they
    follow a curved front instead of becoming one flat n-gon. Doubled points (squeezed sections) are welded."""
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


# The front and the tail: the last sections bend forward (back) from FRONT_FROM (REAR_FROM) out to the side
# outline, so the steps in the bumpers become even surfaces instead of stairs.
NOSE, TAIL = 1.905, -2.415
FRONT_FROM, REAR_FROM = 1.62, -2.1
END_STEPS = (0, 0.3, 0.5, 0.65, 0.76, 0.85, 0.91, 0.95, 0.98, 1)
# The outlines' break points become rows along the whole side, so the front and tail get their steps;
# in the middle merge_flat joins them again.
PROFILE_ROWS = sorted({y for y, _ in FRONT + REAR} | {CREASE})


def shoulder(hw, top):
    """Scaling of x at height y: upright below the crease, then straight in towards SHOULDER_W at the top."""
    k = 1 - min(SHOULDER_W, hw) / hw
    return lambda y: 1 - k * clamp01((y - CREASE) / max(top - CREASE, 0.01))


def lower_body():
    zs = {lerp(REAR_FROM, TAIL, s) for s in END_STEPS} | {lerp(FRONT_FROM, NOSE, s) for s in END_STEPS}
    zs |= {-2.27, -2.0, -1.6, 0.55, 0.9, 1.21, 1.52}
    # The box flares start and stop sharply (flare_at); sections where their edges are.
    zs |= {v + d for v in DOOR_SEAMS for d in (-0.03, 0, 0.03)} | {zw + d for zw, _ in WHEELS for d in (-0.3, 0, 0.3)}
    rings = []
    for zn in fill([z for z in zs if TAIL <= z <= NOSE], 0.2):
        top, bottom = body_top(zn), body_bottom(zn)
        hw = body_halfwidth(zn)
        ring = section(hw, bottom, top, 0.05, 0.05, PROFILE_ROWS, shoulder(hw, top), crown=hood_crown(zn))

        def z_at(y, zn=zn):
            if zn > FRONT_FROM:
                return lerp(FRONT_FROM, piecewise(FRONT, y), (zn - FRONT_FROM) / (NOSE - FRONT_FROM))
            if zn < REAR_FROM:
                return lerp(REAR_FROM, piecewise(REAR, y), (zn - REAR_FROM) / (TAIL - REAR_FROM))
            return zn

        rings.append([(x, y, z_at(y)) for x, y in ring])
    return loft('lower', rings)


# --- Cabin: windscreen, roof, rear screen and side windows ----------------------------------

# The roof line seen from the side: foot of the rear screen on the deck, rear and front edge of the roof and
# foot of the windscreen. A long rear screen at a straight slope, a long flat roof and a steep windscreen.
ROOF = [(-2.03, 0.505), (-1.95, 0.535), (-1.3, 0.762), (-1.15, 0.772), (-0.15, 0.775), (-0.04, 0.755), (0.55, 0.37)]


def greenhouse():
    rings = []
    # The roof, the narrowing of the cabin and the slope of the glass are straight between the break points,
    # so the sections go there. The ends continue down into the body, so the union cuts cleanly at the bonnet and deck.
    for z in fill([-2.08, *(z for z, _ in ROOF), -1.6, -0.6, 0.6], 0.3):
        base = belt_y(z) - 0.05
        top = piecewise(ROOF, z) if ROOF[0][0] <= z <= ROOF[-1][0] else body_top(z) - 0.03
        # Narrower at the top (the side windows lean in), towards the windscreen and back along the rear screen.
        front = clamp01((z + 0.04) / 0.59)
        rear = clamp01((-1.3 - z) / 0.73)
        wb = lerp(0.75, 0.72, front) - 0.07 * rear
        wt = lerp(0.56, 0.53, front) - 0.05 * rear
        squeeze = lambda y, b=base, t=top, wb=wb, wt=wt: lerp(1, wt / wb, clamp01((y - b) / (t - b)))  # noqa: E731
        rings.append([(x, y, z) for x, y in section(wb, base, top, 0.06, 0.0, (), squeeze, crown=0.015, n_rb=1)])
    return loft('greenhouse', rings)


ARCH_R = 0.355


def arch_cutters():
    cutters = []
    for (zw, yw), xw in zip(WHEELS, TRACK):
        for s in (1, -1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=ARCH_R, depth=0.5)
            c = bpy.context.active_object
            c.rotation_euler = (0, math.pi / 2, 0)
            c.location = to_blender(s * (0.55 + 0.25 + 0.03), yw, zw)
            cutters.append(c)
    return cutters


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


def mark_sharp(obj):
    """Smooth shading, but the creases (edges steeper than SHARP, and the shoulder line) sharp, like pressed
    steel. export.py gives the vertices on a crease points of their own, so the game does not round them off."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    mw = obj.matrix_world
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        on_crease = all(abs(to_car(mw @ v.co)[1] - CREASE) < 0.002 and abs(to_car(mw @ v.co)[0]) > 0.7 for v in e.verts)
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle() <= SHARP and not on_crease
    bm.to_mesh(obj.data)
    bm.free()


# --- Colours: material per face -------------------------------------------------------------
#
# The colour fields are bounded by planes. The mesh is first cut along the planes (cut_planes), so each face
# lies wholly on one side and the edges are straight; then the material is chosen from the face centre and normal.


def plane(nx, ny, nz, d):
    """The plane n·p = d in car coordinates, normalised."""
    n = Vector((nx, ny, nz))
    return n.normalized(), d / n.length


def above(p, pl):
    return Vector(p).dot(pl[0]) > pl[1]


def mirrored(x):
    return [plane(1, 0, 0, x), plane(-1, 0, 0, x)]


Y = lambda y: plane(0, 1, 0, y)  # noqa: E731
Z = lambda z: plane(0, 0, 1, z)  # noqa: E731

# The front: a band of two rectangular headlamps with a black grille between them, the bumper below with
# amber blinkers and clear fog lamps in the corners, and three intakes with two slots each in the spoiler.
LAMP_Y, LAMP_X, LAMP_DIV, GRILLE_X = (0.025, 0.175), (0.39, 0.775), (0.555, 0.565), 0.39
BLINK_Y, BLINK_X = (-0.15, -0.065), (0.68, 0.8)
FOG_Y, FOG_X = BLINK_Y, (0.5, 0.68)
INTAKE_Y, INTAKE_X, INTAKE_BARS, INTAKE_MID = (-0.275, -0.205), 0.78, (0.37, 0.41), (-0.244, -0.236)
LIP_Y = -1.0  # no black lip: the spoiler is painted
# Rear: smoked lamps in the corners, a black ribbed panel between them with the number plate in the middle,
# and red reflectors in the bumper.
TAIL_Y, TAIL_X, TAIL_AMBER, TAIL_REVERSE = (0.11, 0.345), (0.675, 0.86), 0.17, 0.74
PLATE_Y, PLATE_X = (0.205, 0.325), 0.26
REFLEX_Y, REFLEX_X = (-0.02, 0.02), (0.66, 0.8)
REAR_LIP_Y = -1.0
TAIL_TOP = plane(0, 1, 0, TAIL_Y[1])
# The cabin: bottom edge of the glass, front edge of the door glass (A pillar), B pillar, rear edge of the
# quarter window (C pillar), roof edge, sides of the windscreen and the rear screen.
BELT = plane(0, 1, 0.02, 0.335)
A_LINE = plane(0, 0.578, 0.384, 0.3955)  # parallel to the windscreen, 4 cm behind it
C_LINE = plane(0, 1, -0.874, 1.798)  # rear edge of the quarter window, from (z -1.60, y 0.40) to (-1.226, 0.727)
B_PILLAR = (-0.66, -0.59)
DOOR_FRONT, QUARTER_REAR = 0.5, -1.62
ROOF_EDGE = 0.735
SCREEN_SIDE = plane(1, 0.447, 0, 0.825)  # for |x|: the windscreen's black frame
BACKLIGHT_X, BACKLIGHT_Y = 0.5, 0.535
# Seams: front and rear edges of the doors and the top edges of the bumpers front and rear.
SEAM_W = 0.012
DOOR_SEAMS = (0.589, -0.593)
BUMPER_SEAM = {'front': 0.0, 'rear': 0.054}
SIDE_ZONE = lambda c: abs(c[0]) > 0.7 and -0.3 < c[1] < 0.33  # noqa: E731
# The side: a black strip along the whole car at the height of the bumper tops, and the sill below the doors.
CREASE_Y, SKIRT_Y = -0.004, -0.235
FLARE_W, FLARE_OUT = 0.08, 0.012
FLARE_GRID = 0.04
FLARE_TOP = (0.08, CREASE)
# The hatch seams: along the deck and down between the lamps and the hatch to the bumper.
LID_X = (0.66, TAIL_X[0])
DECK_ZONE = lambda c: c[2] < -1.95 and c[1] > 0.1  # noqa: E731

FRONT_ZONE = lambda c: c[2] > 1.55  # noqa: E731
REAR_ZONE = lambda c: c[2] < -2.1  # noqa: E731
CABIN_ZONE = lambda c: -2.1 < c[2] < 0.6 and c[1] > 0.29  # noqa: E731

CUTS = [
    (FRONT_ZONE, [Y(v) for v in (*LAMP_Y, *BLINK_Y, *INTAKE_Y, *INTAKE_MID)]
     + [p for v in (*LAMP_X, *LAMP_DIV, *BLINK_X, *FOG_X, INTAKE_X, *INTAKE_BARS) for p in mirrored(v)]),
    (REAR_ZONE, [Y(v) for v in (*TAIL_Y, TAIL_AMBER, *PLATE_Y, *REFLEX_Y)] + [p for v in (TAIL_X[0], TAIL_REVERSE, PLATE_X, *REFLEX_X) for p in mirrored(v)]),
    (CABIN_ZONE, [BELT, A_LINE, C_LINE, Y(ROOF_EDGE), Y(BACKLIGHT_Y), Z(DOOR_FRONT), Z(QUARTER_REAR), *(Z(v) for v in B_PILLAR),
                  SCREEN_SIDE, plane(-1, 0.447, 0, 0.825), *mirrored(BACKLIGHT_X)]),
    (SIDE_ZONE, [Z(v + d) for v in DOOR_SEAMS for d in (-SEAM_W / 2, SEAM_W / 2)] + [Y(CREASE_Y), Y(CREASE_Y + 0.008), Y(SKIRT_Y)]),
    (FRONT_ZONE, [Y(BUMPER_SEAM['front'] + d) for d in (0, SEAM_W)]),
    (REAR_ZONE, [Y(BUMPER_SEAM['rear'] + d) for d in (0, SEAM_W)]),
    (DECK_ZONE, [p for v in LID_X for d in (0, SEAM_W) for p in mirrored(v + d)]),
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
    """The cabin: glass, black pillars and a painted roof."""
    x, y, z = p
    ax = abs(x)
    if not above(p, BELT):
        return None
    if z < -1.25 and n.z < -0.15 and n.y > 0.3:  # the rear screen, flat like a hatchback's
        return M['glass'] if ax < BACKLIGHT_X and y > BACKLIGHT_Y else M['paint']
    if n.y > 0.75 and y > ROOF_EDGE:
        return M['paint']
    if n.z > 0.35:  # the windscreen, with a black frame
        return M['black'] if above((ax, y, z), SCREEN_SIDE) else M['glass']
    # The sides: black strip at the top, black B pillar, the quarter window below the C pillar.
    if y > ROOF_EDGE:
        return M['black']
    if B_PILLAR[1] <= z <= DOOR_FRONT:
        return M['black'] if above(p, A_LINE) else M['glass']
    if QUARTER_REAR <= z <= B_PILLAR[0]:
        return M['paint'] if above(p, C_LINE) else M['glass']
    return M['black'] if z > B_PILLAR[0] else M['paint']


def arch_distance(z, y):
    """Distance from the nearest wheel arch centre, seen from the side."""
    return min(math.hypot(z - zw, y - yw) for zw, yw in WHEELS)


def face_material(p, n):
    x, y, z = p
    ax = abs(x)
    inside = lambda lo_hi, v: lo_hi[0] < v < lo_hi[1]  # noqa: E731
    # The wheel arches and the underbody.
    for zw, yw in WHEELS:
        if 0.45 < ax < 0.85 and math.hypot(z - zw, y - yw) < ARCH_R + 0.02 and abs(n.x) < 0.8:
            return M['black']
    if n.y < -0.6 and y < -0.2:
        return M['black']
    if CABIN_ZONE(p):
        pane = pane_material(p, n)
        if pane is not None:
            return pane
    # The blinkers follow the bumper corner a little way onto the side.
    if FRONT_ZONE(p) and n.z > 0.05 and z > 1.75 and ax > 0.72 and inside(BLINK_Y, y):
        return M['amber']
    if FRONT_ZONE(p) and n.z > 0.25:
        if inside(LAMP_X, ax) and inside(LAMP_Y, y):
            return M['chrome'] if inside(LAMP_DIV, ax) else M['lamp']
        if ax < GRILLE_X and inside(LAMP_Y, y):
            return M['black']
        if inside(BLINK_X, ax) and inside(BLINK_Y, y):
            return M['amber']
        if inside(FOG_X, ax) and inside(FOG_Y, y):
            return M['lamp']
        if ax < INTAKE_X and inside(INTAKE_Y, y):
            return M['paint'] if inside(INTAKE_BARS, ax) or inside(INTAKE_MID, y) else M['dark']
    if REAR_ZONE(p) and (n.z < -0.25 or abs(n.x) > 0.5):
        if inside(TAIL_Y, y) and ax > TAIL_X[0] and (n.z < -0.25 or z < -2.2):
            return M['reverse'] if y < TAIL_AMBER and ax < TAIL_REVERSE else M['tail']
        if inside(TAIL_Y, y) and n.z < -0.5:
            return M['plate'] if ax < PLATE_X and inside(PLATE_Y, y) else M['dark']
        if inside(REFLEX_X, ax) and inside(REFLEX_Y, y) and n.z < -0.5:
            return M['tail']
    if SIDE_ZONE(p) and y > SKIRT_Y and any(abs(z - v) < SEAM_W / 2 for v in DOOR_SEAMS):
        return M['shade']
    if abs(x) > 0.7 and abs(n.x) > 0.5 and CREASE_Y < y < CREASE_Y + 0.008 and arch_distance(z, y) > ARCH_R + 0.01:
        return M['black']
    if DECK_ZONE(p) and y > BUMPER_SEAM['rear']:
        lid = LID_X[0] if n.y > 0.5 else LID_X[1] if n.z < -0.5 else None
        if lid and 0 < ax - lid < SEAM_W:
            return M['shade']
    for zone, key in ((FRONT_ZONE, 'front'), (REAR_ZONE, 'rear')):
        if zone(p) and 0 < y - BUMPER_SEAM[key] < SEAM_W and abs(n.y) < 0.7:
            return M['shade']
    return M['paint']


def assign_materials(obj, rule):
    set_materials(obj)
    mw = obj.matrix_world
    for poly in obj.data.polygons:
        c = to_car(mw @ poly.center)
        n = Vector(to_car(mw.to_3x3() @ poly.normal))
        poly.material_index = rule(c, n)


def merge_flat(obj):
    """Merges faces that lie in the same plane and have the same colour. The cuts along the colour fields
    (cut_planes), the outline rows (PROFILE_ROWS) and the grid round the wheel arches (flare) run through the
    whole zone and otherwise leave rows of vertices where nothing changes colour or shape. Runs last: the sill
    and the doors are picked from the cuts."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    # Two cuts in the same plane (e.g. two colour fields ending at the same height) leave doubled vertices and
    # flat strips between them, which split the surface in the shading.
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=0.0001)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1), verts=bm.verts, edges=bm.edges, delimit={'MATERIAL'})
    bm.to_mesh(obj.data)
    bm.free()


# --- Splitting into parts -------------------------------------------------------------------


def face_info(obj, f):
    """The face centre and normal in car coordinates, and the material name."""
    mw = obj.matrix_world
    c = to_car(mw @ f.calc_center_median())
    n = Vector(to_car(mw.to_3x3() @ f.normal))
    return c, n, MATERIALS[f.material_index][0]


def extract(obj, name, test, keep=False):
    """Moves (or copies, keep) the faces where test(centre, normal, material) is true to a new object."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type='FACE')
    bpy.ops.mesh.select_all(action='DESELECT')
    bm = bmesh.from_edit_mesh(obj.data)
    hits = [f for f in bm.faces if test(*face_info(obj, f))]
    for f in hits:
        f.select_set(True)
    bmesh.update_edit_mesh(obj.data)
    if not hits:
        bpy.ops.object.mode_set(mode='OBJECT')
        raise RuntimeError(f'{name}: no faces')
    if keep:
        bpy.ops.mesh.duplicate()
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    new = next(o for o in bpy.context.selected_objects if o is not obj)
    new.name = new.data.name = name
    return new


def recolor(obj, test, mat):
    for p in obj.data.polygons:
        c = to_car(obj.matrix_world @ p.center)
        n = Vector(to_car(obj.matrix_world.to_3x3() @ p.normal))
        if test(c, n, MATERIALS[p.material_index][0]):
            p.material_index = M[mat]


def push(bm, faces, offset, top=None, wall='black'):
    """Extrudes the faces by `offset` (car coordinates) and builds walls between: a raised area or, inwards,
    a recess. `top` changes the material of the moved faces."""
    if not faces:
        return
    ret = bmesh.ops.extrude_face_region(bm, geom=faces)
    verts = {e for e in ret['geom'] if isinstance(e, bmesh.types.BMVert)}
    made = [e for e in ret['geom'] if isinstance(e, bmesh.types.BMFace)]
    bmesh.ops.translate(bm, vec=to_blender(*offset), verts=list(verts))
    bmesh.ops.delete(bm, geom=faces, context='FACES')
    for f in made:
        if all(v in verts for v in f.verts):
            if top:
                f.material_index = M[top]
        else:
            f.material_index = M[wall]


def edit(obj, fn):
    """Runs fn(bm, info) on the object's mesh; info(f) gives centre, normal and material."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    fn(bm, lambda f: face_info(obj, f))
    bm.normal_update()
    bm.to_mesh(obj.data)
    bm.free()


def set_origin(obj):
    """Origin in the middle of the part, so the game knows which side a lamp is on and where a loose part falls from."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')


# --- Lamps ----------------------------------------------------------------------------------


# The headlamps' two lamps behind the glass: (x, y, radius) on the left side, mirrored to the right.
HEAD_BULBS = [(0.47, 0.1, 0.055), (0.66, 0.1, 0.058)]


def bulbs(bm, s, normal):
    """Round lit lamps on the headlamp's chrome housing, placed on its glass."""
    front = max(to_car(v.co)[2] for v in bm.verts)
    for x, y, r in HEAD_BULBS:
        c = to_blender(s * x, y, front) + normal * 0.004
        # A thin disc perpendicular to the glass normal.
        u = normal.cross(Vector((0, 0, 1))).normalized()
        w = normal.cross(u).normalized()
        ring = [bm.verts.new(c + (u * math.cos(t) + w * math.sin(t)) * r) for t in (2 * math.pi * i / 20 for i in range(20))]
        back = [bm.verts.new(v.co - normal * 0.02) for v in ring]
        top = bm.faces.new(ring)
        top.material_index = M['lamp']
        for i in range(20):
            j = (i + 1) % 20
            bm.faces.new([ring[i], back[i], back[j], ring[j]]).material_index = M['chrome']


def lamp_unit(obj, bezel, depth, side=0):
    """A lamp as a unit of its own: the glass a little outside the panel, a bezel round the edge and sides down
    into the lamp's recess, so it has depth and is not a painted face. The headlamps (side ±1) get a chrome
    housing with two round lamps, as behind clear glass."""

    def fn(bm, info):
        normal = sum((f.normal for f in bm.faces), Vector()).normalized()
        for v in bm.verts:
            v.co += normal * 0.006
        if side:
            for f in bm.faces:
                f.material_index = M['chrome']
        ring = bmesh.ops.inset_region(bm, faces=list(bm.faces), thickness=0.011, depth=0.002, use_even_offset=True)['faces']
        for f in ring:
            f.material_index = M[bezel]
        edges = [e for e in bm.edges if e.is_boundary]
        ret = bmesh.ops.extrude_edge_only(bm, edges=edges)
        verts = [e for e in ret['geom'] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, vec=-normal * depth, verts=verts)
        for f in (e for e in ret['geom'] if isinstance(e, bmesh.types.BMFace)):
            f.material_index = M['black']
        if side:
            bulbs(bm, side, normal)

    edit(obj, fn)
    set_origin(obj)
    return obj


def lamps(body):
    """Headlamps, blinkers, fog lamps and tail lamps are lifted out as units of their own; black holes stay in the shell."""
    units = []
    groups = [
        ('headlight', lambda c, n, m: c[2] > 1.55 and m in ('lamp', 'chrome') and c[1] > 0.0, 'chrome', 0.03),
        ('blinker', lambda c, n, m: c[2] > 1.55 and m == 'amber', 'black', 0.02),
        ('foglight', lambda c, n, m: c[2] > 1.55 and m == 'lamp' and c[1] < 0.0, 'black', 0.02),
        ('taillight', lambda c, n, m: c[2] < -2.1 and m in ('tail', 'reverse') and c[1] > TAIL_Y[0] - 0.01, 'black', 0.03),
    ]
    for name, test, bezel, depth in groups:
        for s, side in ((1, 'L'), (-1, 'R')):
            t = lambda c, n, m, s=s, test=test: test(c, n, m) and c[0] * s > 0  # noqa: E731
            units.append(lamp_unit(extract(body, f'{name}_{side}', t, keep=True), bezel, depth, s if name == 'headlight' else 0))
            recolor(body, t, 'black')
    return units


# --- Panels that dent separately ------------------------------------------------------------


def is_door(s):
    def test(c, n, m):
        x, y, z = c
        if x * s < 0.55 or abs(n.x) < 0.35:
            return False
        if y < belt_y(z):
            return SKIRT_Y < y and DOOR_SEAMS[1] < z < DOOR_SEAMS[0]
        # The door glass: from the B pillar forward to the A pillar, below the roof strip.
        return y < ROOF_EDGE and B_PILLAR[1] < z < DOOR_SEAMS[0] and not above(c, A_LINE)

    return test


def door_handle(obj, s):
    """A handle in a black recess, at the rear of the door below the belt line."""

    def fn(bm, info):
        x = surface_x(bm, s, 0.258, -0.43)
        box(bm, (x + s * 0.002, 0.258, -0.43), (0.006, 0.05, 0.2), 'black')
        box(bm, (x + s * 0.01, 0.262, -0.43), (0.014, 0.022, 0.17), 'chrome')

    edit(obj, fn)


def front_bumper(obj):
    """The slots in the spoiler recessed."""

    def fn(bm, info):
        intake = [f for f in bm.faces if info(f)[2] == 'dark' and abs(info(f)[0][0]) < INTAKE_X]
        push(bm, intake, (0, 0, -0.04), wall='black', top='black')

    edit(obj, fn)


def rear_bumper(obj):
    """The reflectors raised slightly."""

    def fn(bm, info):
        reflex = [f for f in bm.faces if info(f)[2] == 'tail']
        push(bm, reflex, (0, 0, -0.005), wall='black')

    edit(obj, fn)


def panels(body):
    """Doors, bumpers and hatch as parts of their own; in the game each part dents on its own."""
    parts = []
    for s, side in ((1, 'L'), (-1, 'R')):
        door = extract(body, f'body_door_{side}', is_door(s))
        door_handle(door, s)
        parts.append(door)
    front = extract(body, 'body_bumper_front', lambda c, n, m: c[2] > 1.42 and c[1] < BUMPER_SEAM['front'] + SEAM_W)
    front_bumper(front)
    rear = extract(body, 'body_bumper_rear', lambda c, n, m: c[2] < -1.83 and c[1] < BUMPER_SEAM['rear'] + SEAM_W)
    rear_bumper(rear)
    lid = extract(
        body,
        'body_bootlid',
        lambda c, n, m: c[2] < -1.95 and c[1] > BUMPER_SEAM['rear'] + SEAM_W and m != 'glass'
        and abs(c[0]) < (LID_X[0] if n.y > 0.5 else LID_X[1]),
    )
    tail_panel(lid)
    return parts + [front, rear, lid]


def tail_panel(obj):
    """The black panel between the tail lamps: horizontal ribs, and the number plate in a shallow recess."""

    def fn(bm, info):
        plate = [f for f in bm.faces if info(f)[2] == 'plate']
        push(bm, plate, (0, 0, 0.008), wall='black')
        z = min(info(f)[0][2] for f in bm.faces if info(f)[2] == 'dark')
        for i in range(6):
            y = TAIL_Y[0] + 0.03 + i * 0.035
            for s in (1, -1):
                box(bm, (s * (PLATE_X + TAIL_X[0]) / 2, y, z - 0.004), (TAIL_X[0] - PLATE_X - 0.03, 0.008, 0.01), 'black')

    edit(obj, fn)


# --- The side: flared arches, sill, C-pillar vent and fuel flap -----------------------------


def flare(obj):
    """The wings bulge out round the arches: the panel nearest the opening is pushed out and levels off
    towards FLARE_W, so the edge at the opening becomes a clear lip. The offset is worked out per vertex from
    its position, so it is the same in every part (wing, door, bumper) and the seams meet."""
    mw = obj.matrix_world

    def grid(bm, info):
        # A sparse mesh gives a straight edge when only a few vertices move: cut the panel round the arches in
        # a grid with FLARE_GRID between the lines, so the lip follows the arch. merge_flat then removes the
        # cells outside the ring, which do not move.
        for zw, yw in WHEELS:
            def near(f, zw=zw):
                return any(abs(c[0]) > 0.55 and c[1] < 0.34 and abs(c[2] - zw) < ARCH_R + FLARE_W + 0.02
                           for c in (to_car(mw @ v.co) for v in f.verts))

            r = ARCH_R + FLARE_W
            cuts = [Z(zw + i * FLARE_GRID) for i in range(-int(r / FLARE_GRID), int(r / FLARE_GRID) + 1)]
            cuts += [Y(yw + 0.035 + i * FLARE_GRID) for i in range(-int(r / FLARE_GRID), int(r / FLARE_GRID) + 1)]
            for n, d in cuts:
                faces = [f for f in bm.faces if near(f)]
                geom = faces + list({e for f in faces for e in f.edges}) + list({v for f in faces for v in f.verts})
                bmesh.ops.bisect_plane(bm, geom=geom, plane_co=mw.inverted() @ to_blender(*(n * d)), plane_no=to_blender(*n))

    edit(obj, grid)
    inv = mw.inverted()
    for v in obj.data.vertices:
        x, y, z = to_car(mw @ v.co)
        if abs(x) < 0.6 or y > FLARE_TOP[1]:
            continue
        d = arch_distance(z, y) - ARCH_R
        if d < -0.01 or d > FLARE_W:
            continue
        k = (1 - clamp01(d / FLARE_W)) ** 1.5 * clamp01((abs(x) - 0.6) / 0.15)
        # At the top the bulge fades out towards the shoulder, so it does not end in an edge.
        k *= clamp01((FLARE_TOP[1] - y) / (FLARE_TOP[1] - FLARE_TOP[0]))
        p = to_blender(x + math.copysign(FLARE_OUT * k, x), y, z)
        v.co = inv @ p


def surface_x(bm, s, y, z):
    """The panel's x at (y, z) on side s, with a ray in from the side (the mesh is in the car's position)."""
    hit = BVHTree.FromBMesh(bm).ray_cast(to_blender(s * 2.0, y, z), to_blender(-s, 0, 0))[0]
    if hit is None:
        raise RuntimeError(f'no panel at y={y}, z={z}')
    return to_car(hit)[0]


def body_side(body):
    """The sill stands out a little between the wheels, a black grille (the cabin vent) sits on the C pillar
    behind the quarter window, the grille gets slats and the fuel flap sits on the right rear wing."""
    front_arch, rear_arch = WHEELS[0][0] - ARCH_R - 0.02, WHEELS[1][0] + ARCH_R + 0.02

    def fn(bm, info):
        for s in (1, -1):
            skirt = []
            for f in bm.faces:
                c, n, m = info(f)
                if c[0] * s > 0.6 and n.x * s > 0.6 and -0.31 < c[1] < SKIRT_Y and rear_arch < c[2] < front_arch:
                    skirt.append(f)
            push(bm, skirt, (s * 0.01, 0, 0), wall='shade')
            # The vent: a black strip with dark slots, along the belt line from the quarter window to the corner.
            y, z0, z1 = 0.387, -1.69, -2.25
            for k in range(6):
                z = lerp(z0, z1, (k + 0.5) / 6)
                x = surface_x(bm, s, y, z)
                box(bm, (x - s * 0.002, y, z), (0.012, 0.04, abs(z1 - z0) / 6 + 0.002), 'black')
                box(bm, (x + s * 0.004, y, z), (0.003, 0.004, abs(z1 - z0) / 6 - 0.01), 'dark')
        # The grille between the headlamps: horizontal slats in front of the black.
        for k in range(5):
            box(bm, (0, LAMP_Y[0] + 0.02 + k * 0.0275, NOSE - 0.045), (2 * GRILLE_X - 0.02, 0.008, 0.012), 'dark')
        x = surface_x(bm, -1, 0.22, -1.95)
        box(bm, (x - 0.002, 0.22, -1.95), (0.004, 0.12, 0.12), 'paint', side_mat='shade')

    edit(body, fn)
