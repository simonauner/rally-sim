"""
The body shell: the lower part and the cabin are built from cross-sections, merged into one mesh, given
wheel arches and colour fields, and then split into panels (doors, bumpers, boot lid) that dent separately
in the game.
"""

import math

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from common import GROUND, M, MATERIALS, TRACK, WHEELS, apply_all, box, clamp01, lerp, piecewise, set_materials, to_blender, to_car  # noqa: F401
from simplify import SHARP

# --- Lower body: bonnet, sides, bumpers and boot lid ----------------------------------------

# Front and rear outline seen from the side: how far forward/back the panel reaches at height y.
# Front: the bumper sticks out with a step at its top edge, the headlights and grille are set back under the bonnet.
FRONT = [(-0.26, 1.93), (-0.225, 1.975), (-0.10, 1.995), (0.05, 1.99), (0.07, 1.955), (0.19, 1.94), (0.215, 1.9)]
# Rear: the bumper sticks out below the lights, which end in a step; above that the boot lid leans in.
REAR = [(-0.27, -2.30), (-0.2, -2.355), (0.0, -2.365), (0.13, -2.36), (0.16, -2.325), (0.3, -2.315), (0.46, -2.3), (0.51, -2.285), (0.53, -2.255)]


# The heights are measured from a side photo of the rally version, which sits lower than the standard car:
# the roof 1.30 m above the ground, the side windows' lower edge 0.85–0.88 m and the boot lid 0.95 m.


def body_top(z):
    """Top centreline: bonnet, belt line below the cabin and a low boot lid."""
    if z >= 0.51:
        s = (z - 0.51) / (1.9 - 0.51)
        return 0.37 - 0.17 * clamp01(s) ** 1.8
    if z >= -1.0:
        return belt_y(z) + 0.01
    if z >= -1.62:
        return lerp(belt_y(-1.0) + 0.01, 0.465, clamp01((-1.0 - z) / 0.62))
    return lerp(0.465, 0.44, (-1.62 - z) / 0.63)


def belt_y(z):
    """The side windows' lower edge (the BELT plane) at z: rises slightly towards the rear."""
    return 0.36 - 0.022 * z


def hood_crown(z):
    """Camber of the top: the bonnet lies a little lower than the wings' top edge, the boot lid curves upwards."""
    return lerp(0.03, -0.02, clamp01((z - 0.5) / 0.4))


def body_bottom(z):
    return piecewise([(-2.36, -0.27), (-1.9, -0.32), (1.6, -0.32), (1.99, -0.26)], z)


def body_halfwidth(z):
    """Half width seen from above: rounded corners front and rear."""
    # The wings bulge out a little around the wheels; the doors are narrower.
    flare = max(clamp01(1 - abs(z - zw) / 0.6) for zw, _ in WHEELS)
    w = 0.83 + 0.015 * flare ** 0.5
    if z > 1.5:
        w *= 1 - 0.28 * clamp01((z - 1.5) / 0.49) ** 2.4
    if z < -1.95:
        w *= 1 - 0.15 * clamp01((-1.95 - z) / 0.41) ** 2
    return w


def section(hw, bottom, top, rt, rb, side_ys=(), squeeze=lambda y: 1.0, crown=0.0, n_top=4, n_rt=5, n_rb=3):
    """Closed cross-section: straight top, side and bottom with rounded corners (radius rt at the top, rb at the
    bottom).

    Points are placed only where the shape needs them: n_top on the top, n_rt and n_rb per corner arc, and
    on the side only the heights in side_ys, where the side bends. The same number of points in every
    section, mirrored about x = 0 and starting in the middle of the top. squeeze(y) scales x at height y,
    crown cambers the top.
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
    """Fills in the sections so that no gap is larger than step; the panel needs vertices for the dents."""
    zs = sorted(zs)
    out = [zs[0]]
    for z in zs[1:]:
        n = math.ceil((z - out[-1]) / step - 1e-9)
        out += [lerp(out[-1], z, i / n) for i in range(1, n + 1)]
    return out


def loft(name, rings):
    """A closed shell from rings [(x, y, z), ...] (the same number of points, mirrored as in section).

    The end caps are built from horizontal bands between the points and their mirror points, so they follow
    a curved front instead of becoming a flat n-gon. Duplicate points (squeezed sections) are merged."""
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


# The front and the tail: the last sections bend forward (backward) from FRONT_FROM (REAR_FROM) out to
# the side outline, so the bumper's steps and the rounding of the nose become smooth surfaces instead of stairs.
NOSE, TAIL = 1.985, -2.355
FRONT_FROM, REAR_FROM = 1.5, -1.95
END_STEPS = (0, 0.3, 0.5, 0.65, 0.76, 0.85, 0.91, 0.95, 0.98, 1)
# The outlines' break points become rows along the whole side, so the front and the tail get their steps;
# in the middle merge_flat merges them again.
PROFILE_ROWS = sorted({y for y, _ in FRONT + REAR})


def lower_body():
    zs = {lerp(REAR_FROM, TAIL, s) for s in END_STEPS} | {lerp(FRONT_FROM, NOSE, s) for s in END_STEPS}
    zs |= {-1.9, -1.62, -1.0, 0.5, 0.51, 0.9, 1.6}
    # The wings bulge out around the wheels (body_halfwidth); denser sections there.
    zs |= {zw + d * 0.15 for zw, _ in WHEELS for d in range(-4, 5)}
    rings = []
    for zn in fill([z for z in zs if TAIL <= z <= NOSE], 0.2):
        top, bottom = body_top(zn), body_bottom(zn)
        # Vertical sides, a rounded shoulder that leans in towards the bonnet and rounded sills.
        shoulder = lambda y, t=top: 1 - 0.06 * clamp01((y - (t - 0.2)) / 0.2)  # noqa: E731
        ring = section(body_halfwidth(zn), bottom, top, 0.12, 0.06, (top - 0.2, *PROFILE_ROWS), shoulder, crown=hood_crown(zn))

        def z_at(y, zn=zn):
            if zn > FRONT_FROM:
                return lerp(FRONT_FROM, piecewise(FRONT, y), (zn - FRONT_FROM) / (NOSE - FRONT_FROM))
            if zn < REAR_FROM:
                return lerp(REAR_FROM, piecewise(REAR, y), (zn - REAR_FROM) / (TAIL - REAR_FROM))
            return zn

        rings.append([(x, y, z_at(y)) for x, y in ring])
    return loft('lower', rings)


# --- Cabin: windscreen, roof, rear window and side windows -----------------------------------

# The roofline seen from the side: windscreen foot, roof front edge, roof rear edge and rear window foot.
# Long rear window from the boot lid to the roof, short flat roof and a windscreen at a straight angle.
ROOF = [(-1.62, 0.46), (-1.5, 0.525), (-1.3, 0.66), (-1.1, 0.77), (-0.95, 0.805), (-0.8, 0.815), (-0.15, 0.815),
        (-0.05, 0.8), (0.51, 0.44)]


def greenhouse():
    rings = []
    # The roof, the cabin's taper and the windows' slope are straight between the break points, so the sections go there.
    # The ends continue down into the body, so the merge gets a clean intersection at the bonnet and boot lid.
    for z in fill([-1.68, *(z for z, _ in ROOF), -0.2, 0.57], 0.3):
        base = belt_y(z) - 0.05
        top = piecewise(ROOF, z) if ROOF[0][0] <= z <= ROOF[-1][0] else body_top(z) - 0.03
        # Narrower at the top (the side windows lean inwards) and towards the windscreen.
        front = clamp01((z + 0.2) / 0.71)
        wb = lerp(0.80, 0.74, front)
        wt = lerp(0.60, 0.56, front)
        # Straight side windows that lean in towards the roof, rounded roof edges.
        squeeze = lambda y, b=base, t=top, wb=wb, wt=wt: lerp(1, wt / wb, clamp01((y - b) / (t - b)))  # noqa: E731
        rings.append([(x, y, z) for x, y in section(wb, base, top, 0.1, 0.0, (), squeeze, crown=0.02, n_rb=1)])
    return loft('greenhouse', rings)


def arch_cutters():
    cutters = []
    for (zw, yw), xw in zip(WHEELS, TRACK):
        for s in (1, -1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.375, depth=0.5)
            c = bpy.context.active_object
            c.rotation_euler = (0, math.pi / 2, 0)
            c.location = to_blender(s * (0.55 + 0.25 + 0.03), yw + 0.035, zw)
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
    # The wheel arches are cut out afterwards, so the edges become clean circles.
    for c in arch_cutters():
        boolean(body, c, 'DIFFERENCE')
    return body


def mark_sharp(obj):
    """Smooth shading, but the creases (edges steeper than SHARP) sharp, like pressed sheet metal. export.py
    gives the vertices on a crease their own points, so the game doesn't round them off."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle() <= SHARP
    bm.to_mesh(obj.data)
    bm.free()


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


Y = lambda y: plane(0, 1, 0, y)  # noqa: E731
Z = lambda z: plane(0, 0, 1, z)  # noqa: E731

# The front (measured from a front photo): wide headlights with two lamps and a clear outer corner, a wide
# dark grille between them, indicators in the bumper's outer corners with orange reflector slats below,
# recessed fog light covers inside them, a large dark intake behind the number plate and a black lip.
LAMP_Y, LAMP_X, LAMP_DIV = (0.08, 0.19), (0.34, 0.78), (0.655, 0.668)
# The headlights' inner edge leans out towards the top, and the grille beside it is a trapezoid parallel to
# it, its top a little below the lamps'. The top edge is level and falls only over the clear corner.
HEAD_IN = plane(1, -0.418, 0, 0.3146)  # for |x|: the lamp is above it
GRILLE_EDGE, GRILLE_TOP = plane(1, -0.389, 0, 0.2739), 0.17  # for |x|: the grille is below it
HEAD_TOP = plane(0.2, 1, 0, 0.321)  # for |x|
BLINK_Y, BLINK_X = (-0.064, -0.007), (0.64, 0.76)
SLAT_Y, SLAT_X = (-0.165, -0.1), (0.628, 0.728)
FOG_Y, FOG_X = (-0.183, 0.0), (0.428, 0.6)
# The intake, with a painted bar across it behind the number plate.
INTAKE_Y, INTAKE_X, INTAKE_BAR = (-0.171, -0.014), 0.343, (-0.1, -0.074)
# Two small vents on the bonnet beside the scoop's front, on each side.
VENT_Z, VENT_X = (1.1, 1.18), ((0.38, 0.47), (0.49, 0.58))
BONNET_ZONE = lambda c: 1.0 < c[2] < 1.3 and c[1] > 0.2 and abs(c[0]) < 0.7  # noqa: E731
LIP_Y = -0.232
# Rear: lights (clear at the bottom) and number plate.
# Rear: wide lights directly on top of the bumper, red at the top and orange at the bottom with the reversing
# light innermost, the number plate up on the bumper and a dark lower edge.
TAIL_Y, TAIL_X, TAIL_AMBER, TAIL_REVERSE = (0.175, 0.34), (0.4, 0.76), 0.225, 0.52
PLATE_Y, PLATE_X = (-0.04, 0.08), 0.26
REAR_LIP_Y = -0.2
# The lights' top edge slopes down inwards, from 0.34 at the corner to 0.30 at the inner edge.
TAIL_TOP = plane(-0.111, 1, 0, 0.2556)  # for |x|
# The cabin: the windows' lower edge, the door window's front edge (A-pillar), the B-pillar, the quarter
# window's top edge (C-pillar), the roof edge, the sides of the windscreen and rear window.
BELT = plane(0, 1, 0.022, 0.36)
A_LINE = plane(0, 0.56, 0.36, 0.3708)  # parallel to the windscreen, through (z 0.47, y 0.36)
C_LINE = plane(0, 1, -1.54, 2.469)  # the quarter window's rear edge, from (z −1.35, y 0.39) to (−1.11, 0.76)
B_PILLAR = (-0.66, -0.61)
DOOR_FRONT, QUARTER_REAR = 0.47, -1.36
ROOF_EDGE = 0.755
SCREEN_SIDE = plane(0.45, 0.09, 0, 0.3105)  # for |x|
BACKLIGHT_X, BACKLIGHT_Y = 0.52, 0.5
# Seams: the doors' front and rear edges and the bumpers' top edges front and rear.
SEAM_W = 0.012
DOOR_SEAMS = (0.78, -0.68)
BUMPER_SEAM = {'front': 0.06, 'rear': 0.155}
SIDE_ZONE = lambda c: abs(c[0]) > 0.7 and -0.3 < c[1] < 0.37  # noqa: E731
# The side: a faint line along the doors and wings, and the sill (side skirt) below the doors.
CREASE_Y, SKIRT_Y = 0.2, -0.17
# The flare around the wheel arches: a ring from the arch's edge and FLARE_W outwards.
ARCH_R, FLARE_W, FLARE_OUT = 0.375, 0.11, 0.022
FLARE_GRID = 0.04
FLARE_TOP = (0.22, 0.32)
# The boot lid's seams: along the top and down between the lights and the lid to the bumper.
LID_X = (0.62, 0.39)
DECK_ZONE = lambda c: c[2] < -1.62 and c[1] > 0.15  # noqa: E731

FRONT_ZONE = lambda c: c[2] > 1.55  # noqa: E731
REAR_ZONE = lambda c: c[2] < -2.0  # noqa: E731
CABIN_ZONE = lambda c: -1.7 < c[2] < 0.6 and c[1] > 0.3  # noqa: E731

CUTS = [
    (FRONT_ZONE, [Y(v) for v in (*LAMP_Y, GRILLE_TOP, *BLINK_Y, *SLAT_Y, *FOG_Y, *INTAKE_Y, *INTAKE_BAR, LIP_Y)]
     + [p for v in (LAMP_X[1], *LAMP_DIV, *BLINK_X, *SLAT_X, *FOG_X, INTAKE_X) for p in mirrored(v)]
     + [q for n, d in (HEAD_IN, GRILLE_EDGE, HEAD_TOP) for q in ((n, d), (Vector((-n.x, n.y, n.z)), d))]),
    (BONNET_ZONE, [Z(v) for v in VENT_Z] + [p for xs in VENT_X for v in xs for p in mirrored(v)]),
    (REAR_ZONE, [Y(v) for v in (*TAIL_Y, TAIL_AMBER, TAIL_AMBER + 0.008, *PLATE_Y, REAR_LIP_Y)] + [p for v in (*TAIL_X, TAIL_REVERSE, PLATE_X) for p in mirrored(v)]
     + [TAIL_TOP, plane(0.111, 1, 0, 0.2556)]),
    (CABIN_ZONE, [BELT, A_LINE, C_LINE, Y(ROOF_EDGE), Y(BACKLIGHT_Y), Z(DOOR_FRONT), Z(QUARTER_REAR), *(Z(v) for v in B_PILLAR),
                  SCREEN_SIDE, plane(-0.45, 0.09, 0, 0.3105), *mirrored(BACKLIGHT_X)]),
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
    """The cabin: windows, black pillars and a painted roof."""
    x, y, z = p
    ax = abs(x)
    if not above(p, BELT):
        return None
    if n.y > 0.75 and y > ROOF_EDGE:
        return M['paint']
    if n.z > 0.35:  # the windscreen, with a black frame
        return M['black'] if above((ax, y, z), SCREEN_SIDE) else M['glass']
    if n.z < -0.35:  # the rear window
        return M['glass'] if ax < BACKLIGHT_X and y > BACKLIGHT_Y else M['paint']
    # The sides: black strip at the top, black B-pillar, the quarter window below the C-pillar.
    if y > ROOF_EDGE:
        return M['black']
    if B_PILLAR[1] <= z <= DOOR_FRONT:
        return M['black'] if above(p, A_LINE) else M['glass']
    if QUARTER_REAR <= z <= B_PILLAR[0]:
        return M['paint'] if above(p, C_LINE) else M['glass']
    return M['black'] if z > B_PILLAR[0] else M['paint']


def arch_distance(z, y):
    """The distance from the nearest wheel arch's centre, seen from the side."""
    return min(math.hypot(z - zw, y - yw - 0.035) for zw, yw in WHEELS)


def face_material(p, n):
    x, y, z = p
    ax = abs(x)
    inside = lambda lo_hi, v: lo_hi[0] < v < lo_hi[1]  # noqa: E731
    # The wheel arches and the underbody.
    for (zw, yw), _ in zip(WHEELS, TRACK):
        if 0.45 < ax < 0.84 and math.hypot(z - zw, y - yw - 0.035) < 0.395 and abs(n.x) < 0.8:
            return M['black']
    if n.y < -0.6 and y < -0.2:
        return M['black']
    if CABIN_ZONE(p):
        pane = pane_material(p, n)
        if pane is not None:
            return pane
    # The headlights and indicators follow the corner a little way onto the wing.
    if FRONT_ZONE(p) and n.z > 0.05 and z > 1.75 and ax > 0.6:
        if inside(LAMP_Y, y) and ax < LAMP_X[1] and not above((ax, y, z), HEAD_TOP):
            return M['black'] if inside(LAMP_DIV, ax) else M['lamp']
        if inside(BLINK_Y, y) and ax < BLINK_X[1]:
            return M['amber']
    if FRONT_ZONE(p) and n.z > 0.25:
        if ax < LAMP_X[1] and above((ax, y, z), HEAD_IN) and inside(LAMP_Y, y) and not above((ax, y, z), HEAD_TOP):
            return M['black'] if inside(LAMP_DIV, ax) else M['lamp']  # a black slot before the clear corner
        if not above((ax, y, z), GRILLE_EDGE) and LAMP_Y[0] < y < GRILLE_TOP:
            return M['black']
        if inside(BLINK_X, ax) and inside(BLINK_Y, y) or inside(SLAT_X, ax) and inside(SLAT_Y, y):
            return M['amber']
        if y < LIP_Y:
            return M['black']
        if ax < INTAKE_X and inside(INTAKE_Y, y):
            return M['paint'] if inside(INTAKE_BAR, y) else M['dark']
        if inside(FOG_X, ax) and inside(FOG_Y, y):
            return M['shade']
    if BONNET_ZONE(p) and n.y > 0.8 and inside(VENT_Z, z) and any(inside(v, ax) for v in VENT_X):
        return M['black']
    if REAR_ZONE(p) and (n.z < -0.25 or abs(n.x) > 0.5):
        if inside(TAIL_Y, y) and not above((ax, y, z), TAIL_TOP) and ax > TAIL_X[0] and (n.z < -0.25 or z < -2.15):
            if TAIL_AMBER < y < TAIL_AMBER + 0.008:
                return M['black']  # strip between red and orange
            if y < TAIL_AMBER and ax < TAIL_X[1]:
                return M['reverse'] if ax < TAIL_REVERSE else M['amber']
            return M['tail']
        if ax < PLATE_X and inside(PLATE_Y, y) and n.z < -0.5:
            return M['plate']
        if y < REAR_LIP_Y and n.z < -0.25:
            return M['black']
    if SIDE_ZONE(p) and y > -0.22 and any(abs(z - v) < SEAM_W / 2 for v in DOOR_SEAMS):
        return M['shade']
    if SIDE_ZONE(p) and abs(n.x) > 0.6 and CREASE_Y < y < CREASE_Y + 0.008 and arch_distance(z, y) > ARCH_R + FLARE_W:
        return M['shade']
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
    (cut_planes), the outlines' rows (PROFILE_ROWS) and the grid around the wheel arches (flare) run through
    the whole zone and would otherwise leave rows of vertices where nothing changes colour or shape. Runs
    last: the sill and the doors are selected from the cuts."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    # Two cuts in the same plane (e.g. two colour fields ending at the same height) give duplicate vertices and flat
    # strips between them, which split the surface in the shading.
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=0.0001)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1), verts=bm.verts, edges=bm.edges, delimit={'MATERIAL'})
    bm.to_mesh(obj.data)
    bm.free()


# --- Splitting into parts -------------------------------------------------------------------


def face_info(obj, f):
    """The face's centre and normal in car coordinates, and the material's name."""
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
    a recess. `top` changes the moved faces' material."""
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
    """Origin in the middle of the part, so the game knows which side a light is on and where a loose part
    falls from."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')


# --- Lights ----------------------------------------------------------------------------------


def lamp_unit(obj, bezel, depth, side=0):
    """A light as a unit of its own: the glass a little outside the panel, a frame around the edge and sides
    down into the light's cavity, so it has depth and isn't a painted surface. The headlights (side ±1) are
    chrome all over, like the reflectors behind clear glass."""

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

    edit(obj, fn)
    set_origin(obj)
    return obj


def lamps(body):
    """Headlights, indicators and tail lights are lifted out as units of their own; black holes remain in the
    shell."""
    units = []
    groups = [
        ('headlight', lambda c, n, m: c[2] > 1.55 and m in ('lamp', 'chrome') and c[1] > 0.03, 'chrome', 0.03),
        ('blinker', lambda c, n, m: c[2] > 1.55 and m == 'amber', 'black', 0.02),
        ('taillight', lambda c, n, m: c[2] < -2.0 and (m in ('tail', 'reverse', 'amber') or (m == 'black' and c[1] > 0.17)), 'black', 0.03),
    ]
    for name, test, bezel, depth in groups:
        for s, side in ((1, 'L'), (-1, 'R')):
            t = lambda c, n, m, s=s, test=test: test(c, n, m) and c[0] * s > 0  # noqa: E731
            units.append(lamp_unit(extract(body, f'{name}_{side}', t, keep=True), bezel, depth, s if name == 'headlight' else 0))
            recolor(body, t, 'black')
    return units


# --- Panels that dent separately -------------------------------------------------------------


def is_door(s):
    def test(c, n, m):
        x, y, z = c
        if x * s < 0.55 or abs(n.x) < 0.35:
            return False
        if y < belt_y(z):
            return SKIRT_Y < y and DOOR_SEAMS[1] < z < DOOR_SEAMS[0]
        # Frameless door window: from the B-pillar forward to the A-pillar, below the roof strip.
        return y < ROOF_EDGE and B_PILLAR[1] < z < DOOR_SEAMS[0] and not above(c, A_LINE)

    return test


def door_handle(obj, s):
    """Handle in a black recess, at the door's rear edge below the belt line."""

    def fn(bm, info):
        x = surface_x(bm, s, 0.27, -0.47)
        box(bm, (x + s * 0.002, 0.27, -0.47), (0.006, 0.055, 0.17), 'black')
        box(bm, (x + s * 0.01, 0.275, -0.47), (0.014, 0.024, 0.14), 'paint', side_mat='shade')

    edit(obj, fn)


def front_bumper(obj):
    """The intake recessed with a mesh grille, the covers over the fog lights recessed, the lip extended forward."""

    def fn(bm, info):
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
        intake = [f for f in bm.faces if info(f)[2] == 'dark' and abs(info(f)[0][0]) < INTAKE_X]
        push(bm, intake, (0, 0, -0.05), wall='black', top='black')
        for i in range(3):
            y = INTAKE_Y[0] + 0.03 + i * 0.045
            box(bm, (0, y, 1.955), (2 * INTAKE_X - 0.02, 0.01, 0.012), 'dark')
        fog = [f for f in bm.faces if info(f)[2] == 'shade' and info(f)[1].z > 0.25 and FOG_Y[0] < info(f)[0][1] < FOG_Y[1]]
        # A black frame around each cover, so they read as housings and not as paint.
        frame = bmesh.ops.inset_region(bm, faces=fog, thickness=0.012, depth=0, use_even_offset=True)['faces']
        for f in frame:
            f.material_index = M['black']
        push(bm, fog, (0, 0, -0.015), top='shade', wall='black')
        lip = [f for f in bm.faces if info(f)[2] == 'black' and info(f)[0][1] < LIP_Y and info(f)[1].z > 0.25]
        push(bm, lip, (0, -0.005, 0.03), wall='black')

    edit(obj, fn)


def rear_bumper(obj):
    """The panel in a shallow recess, a dark diffuser at the very bottom."""

    def fn(bm, info):
        plate = [f for f in bm.faces if info(f)[2] == 'plate']
        push(bm, plate, (0, 0, 0.008), wall='black')
        lip = [f for f in bm.faces if info(f)[2] == 'black' and info(f)[0][1] < REAR_LIP_Y and info(f)[1].z < -0.25]
        push(bm, lip, (0, 0, 0.02), wall='black')

    edit(obj, fn)


def panels(body):
    """Doors, bumpers and boot lid as parts of their own; in the game each part dents separately."""
    parts = []
    for s, side in ((1, 'L'), (-1, 'R')):
        door = extract(body, f'body_door_{side}', is_door(s))
        door_handle(door, s)
        parts.append(door)
    front = extract(body, 'body_bumper_front', lambda c, n, m: c[2] > 1.48 and c[1] < BUMPER_SEAM['front'] + SEAM_W)
    front_bumper(front)
    rear = extract(body, 'body_bumper_rear', lambda c, n, m: c[2] < -1.79 and c[1] < BUMPER_SEAM['rear'] + SEAM_W)
    rear_bumper(rear)
    lid = extract(
        body,
        'body_bootlid',
        lambda c, n, m: c[2] < -1.62 and c[1] > BUMPER_SEAM['rear'] + SEAM_W and m != 'glass'
        and (abs(c[0]) < LID_X[1] or (abs(c[0]) < LID_X[0] and n.y > 0.5)),
    )
    return parts + [front, rear, lid]


# --- The side: flared wheel arches, sill, side indicators and fuel cap ----------------------


def flare(obj):
    """The wings flare out around the wheel arches: the panel nearest the hole is pushed outwards and levels
    out towards FLARE_W, so the edge against the hole becomes a clear lip. The offset is computed per vertex
    from its position, so it is the same in all parts (wing, door, bumper) and the seams meet."""
    mw = obj.matrix_world

    def grid(bm, info):
        # A sparse mesh gives a straight edge when only a few vertices move: cut the panel around the wheel arches
        # into a grid with FLARE_GRID between the lines, so the lip follows the arch's curve. merge_flat then removes
        # the cells outside the ring, which don't move.
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
        # At the top the flare fades out towards the shoulder, so it doesn't end in an edge.
        k *= clamp01((FLARE_TOP[1] - y) / (FLARE_TOP[1] - FLARE_TOP[0]))
        p = to_blender(x + math.copysign(FLARE_OUT * k, x), y, z)
        v.co = inv @ p


def surface_x(bm, s, y, z):
    """The panel's x at (y, z) on side s, with a ray cast in from the side (the mesh is in the car's position)."""
    hit = BVHTree.FromBMesh(bm).ray_cast(to_blender(s * 2.0, y, z), to_blender(-s, 0, 0))[0]
    if hit is None:
        raise RuntimeError(f'no panel at y={y}, z={z}')
    return to_car(hit)[0]


def body_side(body):
    """The sill sticks out a little between the wheels, an orange side indicator sits on the front wing behind
    the wheel arch and the fuel cap on the right rear wing."""
    front_arch, rear_arch = WHEELS[0][0] - ARCH_R - FLARE_W, WHEELS[1][0] + ARCH_R + FLARE_W

    def fn(bm, info):
        for s in (1, -1):
            skirt = []
            for f in bm.faces:
                c, n, m = info(f)
                if c[0] * s > 0.6 and n.x * s > 0.6 and -0.31 < c[1] < SKIRT_Y and rear_arch < c[2] < front_arch:
                    skirt.append(f)
            push(bm, skirt, (s * 0.014, 0, 0), wall='shade')
            x = surface_x(bm, s, 0.25, 0.9)
            box(bm, (x + s * 0.002, 0.25, 0.9), (0.006, 0.034, 0.08), 'black')
            box(bm, (x + s * 0.005, 0.25, 0.9), (0.004, 0.024, 0.066), 'amber')
        x = surface_x(bm, -1, 0.27, -1.17)
        box(bm, (x - 0.002, 0.27, -1.17), (0.004, 0.11, 0.12), 'paint', side_mat='shade')

    edit(body, fn)
