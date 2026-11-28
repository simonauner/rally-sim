"""
Builds the Hoshi 2.0 4WD in Blender and saves hoshi4wd.blend next to the script.

    blender -b --factory-startup -P blender/hoshi4wd/build.py

The script produces a first version. After that the .blend file is the source: edit it in Blender and run
blender/export.py to transfer it to the game. Only rerun this script if you want to start over.

Coordinates: everything is computed in car coordinates (x = left, y = up, z = forward, origin at the
centre of mass) and placed in Blender as X = x, Y = -z, Z = y, so the car points towards -Y as in
Blender's front view. The ground is at y = -0.496 and the wheel centres at y ≈ -0.18 when the car is at
rest in the game.

The dimensions follow the original (a three-door liftback coupé from 1991 with wide wings): 4.41 m long,
1.745 m wide, 1.305 m high, wheelbase 2.525 m; heights and positions are measured from side views. The
headlights pop up out of the bonnet and are raised on the model.
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

GROUND = -0.496
WHEELS = [(1.06, -0.179), (-1.465, -0.195)]  # (z, y) front and rear
TRACK = [0.755, 0.755]
TYRE_R = 0.31

# The materials, in the same order as the palette in src/render/models/model.ts.
MATERIALS = [
    ('paint', (0.93, 0.93, 0.91)),
    ('glass', (0.17, 0.23, 0.26)),
    ('black', (0.11, 0.11, 0.11)),
    ('dark', (0.23, 0.23, 0.23)),
    ('chrome', (0.73, 0.75, 0.76)),
    ('lamp', (0.95, 0.91, 0.63)),
    ('amber', (0.91, 0.56, 0.16)),
    ('tail', (0.63, 0.09, 0.09)),
    ('reverse', (0.85, 0.83, 0.8)),
    ('plate', (0.93, 0.93, 0.92)),
    ('shade', (0.67, 0.67, 0.66)),  # seams: paint in shadow
    ('white', (0.95, 0.95, 0.93)),  # the rims
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


# --- Lower body: bonnet, sides, bumpers and boot lid ----------------------------------------

# Front and rear outline seen from the side: how far forward/back the panel reaches at height y. The nose is
# low and round; the bonnet's front edge lies lower than the bumper's most protruding part.
FRONT = [(-0.24, 1.94), (-0.16, 2.01), (-0.05, 2.04), (0.05, 2.045), (0.12, 2.03), (0.18, 1.99), (0.22, 1.92), (0.25, 1.84)]
REAR = [(-0.22, -2.29), (-0.12, -2.355), (0.05, -2.37), (0.25, -2.365), (0.38, -2.345), (0.45, -2.30), (0.48, -2.24)]

COWL = 0.53  # windscreen foot (z)
HOOD_FRONT = 1.97


def hood_y(z):
    """The bonnet's centreline: long and sloping, rounded towards the nose."""
    s = clamp01((z - COWL) / (HOOD_FRONT - COWL))
    return 0.44 - 0.2 * s ** 1.5


def body_top(z):
    """Top centreline: bonnet, belt line below the cabin and boot lid."""
    if z >= COWL:
        return hood_y(z)
    if z >= -1.9:
        return lerp(0.44, 0.465, (COWL - z) / (COWL + 1.9))
    return lerp(0.465, 0.445, (-1.9 - z) / 0.47)


def body_bottom(z):
    return piecewise([(-2.37, -0.2), (-1.95, -0.215), (1.65, -0.215), (2.04, -0.22)], z)


def flare(z):
    """Wide wings: how much the body swells out around the wheels (0..1)."""
    return max(clamp01(1 - abs(z - zw) / 0.62) ** 0.7 for zw, _ in WHEELS)


def body_halfwidth(z):
    """Half width seen from above: wide wings and rounded corners front and rear."""
    w = 0.83 + 0.045 * flare(z)
    if z > 1.55:
        w *= 1 - 0.26 * clamp01((z - 1.5) / 0.545) ** 2
    if z < -1.95:
        w *= 1 - 0.2 * clamp01((-1.95 - z) / 0.42) ** 2
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
# the side outline, so the rounding of the nose and the bumpers become smooth surfaces instead of stairs. The
# sections are densest where the width seen from above curves in the most.
NOSE, TAIL = 2.045, -2.37
FRONT_FROM, REAR_FROM = 1.55, -1.95
END_STEPS = (0, 0.3, 0.5, 0.65, 0.76, 0.85, 0.91, 0.95, 0.98, 1)
# The outlines' break points become rows along the whole side, so the front and the tail get their shapes;
# in the middle merge_flat merges them again.
PROFILE_ROWS = sorted({y for y, _ in FRONT + REAR})


def lower_body():
    zs = {lerp(REAR_FROM, TAIL, s) for s in END_STEPS} | {lerp(FRONT_FROM, NOSE, s) for s in END_STEPS}
    zs |= {-1.9, COWL, 1.65}
    # The wide wings swell out around the wheels (flare); denser sections there.
    zs |= {zw + d * 0.155 for zw, _ in WHEELS for d in range(-4, 5)}
    rings = []
    for zn in fill([z for z in zs if TAIL <= z <= NOSE], 0.2):
        top, bottom = body_top(zn), body_bottom(zn)
        # The wings swell out at the bottom; the shoulder at the top is kept narrow, so the side rounds in towards the bonnet.
        pull = 1 - 0.8 / (0.83 + 0.045 * flare(zn)) if zn > -2.0 else 0.06
        shoulder = lambda y, t=top, k=max(pull, 0.05): 1 - k * clamp01((y - (t - 0.26)) / 0.26) ** 1.3  # noqa: E731
        shoulder_ys = [top - 0.26 + 0.26 * i / 4 for i in range(4)]
        ring = section(body_halfwidth(zn), bottom, top, 0.14, 0.1, (*shoulder_ys, *PROFILE_ROWS), shoulder, crown=0.03)

        def z_at(y, zn=zn):
            if zn > FRONT_FROM:
                return lerp(FRONT_FROM, piecewise(FRONT, y), (zn - FRONT_FROM) / (NOSE - FRONT_FROM))
            if zn < REAR_FROM:
                return lerp(REAR_FROM, piecewise(REAR, y), (zn - REAR_FROM) / (TAIL - REAR_FROM))
            return zn

        rings.append([(x, y, z_at(y)) for x, y in ring])
    return loft('lower', rings)


# --- Cabin: windscreen, roof, rear window and side windows -----------------------------------

# The roofline seen from the side: rear window foot, roof rear edge, roof front edge and windscreen foot. The
# rear window is long and flat (liftback), the windscreen steeply raked.
ROOF = [(-1.9, 0.445), (-1.6, 0.55), (-1.3, 0.655), (-1.05, 0.74), (-0.85, 0.79), (-0.55, 0.81), (-0.25, 0.805),
        (-0.08, 0.78), (0.1, 0.705), (0.32, 0.585), (COWL, 0.44)]
ROOF_FRONT, ROOF_REAR = -0.1, -0.92


def greenhouse():
    rings = []
    # The roof and the cabin's taper are straight between the break points, so the sections go there. The ends
    # continue down into the body, so the merge gets a clean intersection at the bonnet and boot lid.
    for z in fill([-1.96, *(z for z, _ in ROOF), -1.1, -0.2, COWL + 0.06], 0.3):
        base = body_top(z) - 0.06
        top = piecewise(ROOF, z) if ROOF[0][0] <= z <= ROOF[-1][0] else body_top(z) - 0.03
        # Narrower at the top (the side windows lean inwards), towards the windscreen and towards the rear window's foot.
        front = clamp01((z + 0.2) / 0.73)
        rear = clamp01((-1.1 - z) / 0.8)
        wb = lerp(0.79, 0.74, front) - 0.06 * rear
        wt = lerp(0.6, 0.55, front) - 0.06 * rear
        squeeze = lambda y, b=base, t=top, wb=wb, wt=wt: lerp(1, wt / wb, clamp01((y - b) / (t - b)) ** 1.2)  # noqa: E731
        sides = [lerp(base, top, i / 3) for i in (1, 2)]  # the side windows curve slightly (** 1.2)
        rings.append([(x, y, z) for x, y in section(wb, base, top, 0.12, 0.0, sides, squeeze, crown=0.02, n_rb=1)])
    return loft('greenhouse', rings)


def arch_cutters():
    cutters = []
    for (zw, yw), _ in zip(WHEELS, TRACK):
        for s in (1, -1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.375, depth=0.5)
            c = bpy.context.active_object
            c.rotation_euler = (0, math.pi / 2, 0)
            c.location = to_blender(s * 0.86, yw + 0.035, zw)
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
    # The wheel arches are cut out afterwards, so the edges become clean circles.
    for c in arch_cutters():
        boolean(body, c, 'DIFFERENCE')
    # The recess along the top of the nose, which the headlights pop up out of.
    bpy.ops.mesh.primitive_cube_add(size=1)
    c = bpy.context.active_object
    c.scale = (2 * RECESS_X, 0.4, 0.3)
    c.location = to_blender(0, RECESS_Y + 0.15, RECESS_Z + 0.2)
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


Y = lambda y: plane(0, 1, 0, y)  # noqa: E731
Z = lambda z: plane(0, 0, 1, z)  # noqa: E731

# The front: a black recess across the top of the nose, between the bonnet and the bumper, which the
# headlights pop up out of. In the bumper narrow clear lamps outermost below the recess, indicators down
# in the corners and a wide air intake with horizontal slats.
RECESS_X, RECESS_Y, RECESS_Z, RECESS_TOP = 0.69, 0.1, 1.92, 0.23
CLEAR_Y, CLEAR_X = (0.03, 0.075), (0.42, 0.68)
BLINK_Y, BLINK_X = (-0.07, -0.02), (0.58, 0.74)
INTAKE_Y, INTAKE_X = (-0.15, -0.02), 0.5
SLATS = [-0.15 + 0.026 * i for i in range(6)]
# Rear: a light band across the whole width. In the middle a red strip at the top and below it a black
# niche with the number plate; at the sides red lights with a clear reversing light at the top and yellow indicators around the corners.
TAIL_Y, TAIL_WRAP = (0.195, 0.345), -2.2
GARNISH_X, GARNISH_Y, LAMP_IN, BLINK_OUT = 0.35, 0.29, 0.37, 0.64
NICHE_Y, PLATE_Y, PLATE_X = 0.14, (0.165, 0.265), 0.25
REVERSE_X, REVERSE_Y = (0.44, 0.59), (0.25, 0.295)
# The cabin: the windows' lower edge, the door window's front edge (A-pillar), the B-pillar, the quarter
# window's rear edge (C-pillar), the roof edge, the sides of the windscreen and rear window.
BELT = plane(0, 1, 0.015, 0.428)
A_LINE = plane(0, 0.63, 0.36, 0.43)
C_LINE = plane(0, 0.95, -0.35, 1.0)
B_PILLAR = (-0.72, -0.66)
DOOR_FRONT, QUARTER_REAR = 0.5, -1.5
ROOF_EDGE = 0.745
SCREEN_SIDE = plane(0.34, 0.16, 0, 0.29)  # for |x|
BACKLIGHT_X, BACKLIGHT_Y = 0.55, 0.49
# Seams: the doors' front and rear edges and the bumpers' top edges front and rear.
SEAM_W = 0.012
DOOR_SEAMS = (0.5, -0.69)
BUMPER_SEAM = {'front': 0.035, 'rear': 0.08}
SIDE_ZONE = lambda c: abs(c[0]) > 0.7 and -0.2 < c[1] < 0.43  # noqa: E731

FRONT_ZONE = lambda c: c[2] > 1.6  # noqa: E731
REAR_ZONE = lambda c: c[2] < -2.1  # noqa: E731
CABIN_ZONE = lambda c: -2.0 < c[2] < 0.62 and c[1] > 0.36  # noqa: E731

CUTS = [
    (FRONT_ZONE, [Y(v) for v in (*CLEAR_Y, *BLINK_Y, *INTAKE_Y, *SLATS)] + [p for v in (*CLEAR_X, *BLINK_X, INTAKE_X) for p in mirrored(v)]),
    (REAR_ZONE, [Y(v) for v in (*TAIL_Y, GARNISH_Y, NICHE_Y, *PLATE_Y, *REVERSE_Y)] + [Z(TAIL_WRAP)]
     + [p for v in (GARNISH_X, LAMP_IN, BLINK_OUT, PLATE_X, *REVERSE_X) for p in mirrored(v)]),
    (CABIN_ZONE, [BELT, A_LINE, C_LINE, Y(ROOF_EDGE), Y(BACKLIGHT_Y), Z(ROOF_FRONT), Z(ROOF_REAR), Z(DOOR_FRONT), Z(QUARTER_REAR),
                  *(Z(v) for v in B_PILLAR), SCREEN_SIDE, plane(-0.34, 0.16, 0, 0.29), *mirrored(BACKLIGHT_X)]),
    (SIDE_ZONE, [Z(v + d) for v in DOOR_SEAMS for d in (-SEAM_W / 2, SEAM_W / 2)]),
    (FRONT_ZONE, [Y(BUMPER_SEAM['front'] + d) for d in (0, SEAM_W)]),
    (REAR_ZONE, [Y(BUMPER_SEAM['rear'] + d) for d in (0, SEAM_W)]),
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
    if abs(n.x) < 0.55:
        # The top: the windscreen with a black frame, the roof and the long rear window.
        if z > ROOF_FRONT:
            return M['black'] if above((ax, y, z), SCREEN_SIDE) else M['glass']
        if z > ROOF_REAR:
            return M['paint']
    # The rear window is bounded only by the planes, so the edge against the C-pillar becomes straight.
    if z < ROOF_REAR and ax < BACKLIGHT_X and y > BACKLIGHT_Y and n.y > 0.3:
        return M['glass']
    if abs(n.x) < 0.55 or z < QUARTER_REAR:
        return M['paint']
    # The sides: black strip at the top, black B-pillar, the quarter window in front of the C-pillar.
    if y > ROOF_EDGE and z > ROOF_REAR:
        return M['black']
    if B_PILLAR[1] <= z <= DOOR_FRONT:
        return M['black'] if above(p, A_LINE) else M['glass']
    if QUARTER_REAR <= z <= B_PILLAR[0]:
        return M['paint'] if above(p, C_LINE) else M['glass']
    return M['black'] if z > B_PILLAR[0] else M['paint']


def face_material(p, n):
    x, y, z = p
    ax = abs(x)
    inside = lambda lo_hi, v: lo_hi[0] < v < lo_hi[1]  # noqa: E731
    # The wheel arches and the underbody.
    for (zw, yw), _ in zip(WHEELS, TRACK):
        if 0.45 < ax < 0.87 and math.hypot(z - zw, y - yw - 0.035) < 0.395 and abs(n.x) < 0.8:
            return M['black']
    if CABIN_ZONE(p):
        pane = pane_material(p, n)
        if pane is not None:
            return pane
    # The recess's floor and walls; the wing's outside just outside the wall stays painted.
    if FRONT_ZONE(p) and ax < RECESS_X + 0.005 and RECESS_Y - 0.005 < y < RECESS_TOP and z > RECESS_Z - 0.005 and n.x * math.copysign(1, x) < 0.3:
        return M['black']
    if FRONT_ZONE(p) and n.z > 0.25:
        if inside(CLEAR_X, ax) and inside(CLEAR_Y, y):
            return M['lamp']
        if inside(BLINK_X, ax) and inside(BLINK_Y, y):
            return M['amber']
        if ax < INTAKE_X and inside(INTAKE_Y, y):
            # The slats: every other stripe dark grey.
            return M['dark'] if sum(y > s for s in SLATS) % 2 else M['black']
    if REAR_ZONE(p) and (n.z < -0.25 or abs(n.x) > 0.5):
        if ax < GARNISH_X and NICHE_Y < y < TAIL_Y[1] and n.z < -0.5:
            if y > GARNISH_Y:
                return M['tail']
            return M['plate'] if ax < PLATE_X and inside(PLATE_Y, y) else M['black']
        if inside(TAIL_Y, y) and z < TAIL_WRAP and ax > GARNISH_X:
            if ax < LAMP_IN:
                return M['black']
            if ax > BLINK_OUT:
                return M['amber']
            return M['reverse'] if inside(REVERSE_X, ax) and inside(REVERSE_Y, y) else M['tail']
    if SIDE_ZONE(p) and y > -0.15 and any(abs(z - v) < SEAM_W / 2 for v in DOOR_SEAMS):
        return M['shade']
    for zone, key in ((FRONT_ZONE, 'front'), (REAR_ZONE, 'rear')):
        if zone(p) and 0 < y - BUMPER_SEAM[key] < SEAM_W and abs(n.y) < 0.7:
            return M['shade']
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
    """Merges faces that lie in the same plane and have the same colour. The cuts along the colour fields
    (cut_planes) and the outlines' rows (PROFILE_ROWS) run through the whole zone and would otherwise leave
    rows of vertices where nothing changes colour or shape."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    # Two cuts in the same plane (e.g. two colour fields ending at the same height) give duplicate vertices and flat
    # strips between them, which split the surface in the shading.
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=0.0001)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1), verts=bm.verts, edges=bm.edges, delimit={'MATERIAL'})
    bm.to_mesh(obj.data)
    bm.free()


# The creases: the Hoshi is rounded, so the corners of the nose and tail (where the side meets the front, around
# 52°) should be shaded smoothly; the belt line and the edges around the recess are steeper.
SHARP = math.radians(60)


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


# --- Loose details: lights, mirrors, air intakes, wing, auxiliary lights, mud flaps ----------


def part(name, build, mat, at, tilt=0.0):
    """An object of its own with its origin at `at` (car coordinates), built by build(bm) with the material or list `mat`, tilted `tilt` rad forward-down."""
    bm = bmesh.new()
    build(bm)
    if tilt:
        bmesh.ops.rotate(bm, cent=Vector(), matrix=Matrix.Rotation(tilt, 3, 'X'), verts=bm.verts)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = to_blender(*at)
    bpy.context.scene.collection.objects.link(obj)
    for m in [mat] if isinstance(mat, str) else mat:
        obj.data.materials.append(bpy.data.materials[m])
    return obj


def box(sx, sy, sz, off=(0, 0, 0)):
    """Box with size and offset in car coordinates."""
    def build(bm):
        r = bmesh.ops.create_cube(bm, size=1)
        bmesh.ops.scale(bm, vec=Vector((sx, sz, sy)), verts=r['verts'])
        bmesh.ops.translate(bm, vec=to_blender(*off), verts=r['verts'])
    return build


def cylinder_z(r, length, segs=20, off=0.0):
    """Cylinder along the car's z (forward)."""
    def build(bm):
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=length)
        bmesh.ops.rotate(bm, cent=Vector(), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'), verts=res['verts'])
        bmesh.ops.translate(bm, vec=to_blender(0, 0, off), verts=res['verts'])
    return build


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


def hood_slope(z):
    return math.atan2(hood_y(z - 0.05) - hood_y(z + 0.05), 0.1)


# The headlights' wedge seen from the side (z, y): they rise out of the recess at the very front, so the foot
# stands on its floor, the glass sits in the nose and the top slopes back down into the bonnet.
POPUP_FRONT, POPUP_REAR, POPUP_W, POPUP_X = 1.95, 1.57, 0.32, 0.5
POPUP_BASE, POPUP_TOP = RECESS_Y, 0.345
POPUP_LENS = (POPUP_FRONT + 0.035, 0.265)


def popup(name, x):
    """A raised pop-up headlight: a black wedge."""
    profile = [(POPUP_FRONT, POPUP_BASE), (POPUP_FRONT + 0.03, POPUP_TOP),
               (POPUP_REAR, hood_y(POPUP_REAR) + 0.008), (POPUP_REAR, hood_y(POPUP_REAR) - 0.03)]
    bm = bmesh.new()
    left = [bm.verts.new(to_blender(POPUP_W / 2, y, z)) for z, y in profile]
    right = [bm.verts.new(to_blender(-POPUP_W / 2, y, z)) for z, y in profile]
    bm.faces.new(left)
    bm.faces.new(list(reversed(right)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((left[j], left[i], right[i], right[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = to_blender(x, 0, 0)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(bpy.data.materials['black'])
    return obj


# The wing grows out of the boot lid: along the lid's edges run two fins that start flat at the rear window's
# foot and rise backwards to the blade, which sits high above the lid with an upturned trailing edge.
WING_AT = (0, 0.5, -2.2)
FIN_START, BLADE_Z = -1.72, (-2.06, -2.32)
BLADE_TOP, BLADE_T, FIN_W = (0.535, 0.575), 0.03, 0.05


def fin_x(z):
    """The fin's outer edge: follows the lid's rounded edge inwards towards the rear."""
    return body_halfwidth(z) * 0.86 - 0.02


def edge_y(z):
    """The lid's surface at the edge, where it rounds off lower than in the middle."""
    return body_top(z) - 0.035


def wing():
    def build(bm):
        def loft_quads(loops):
            vs = [[bm.verts.new(to_blender(x - WING_AT[0], y - WING_AT[1], z - WING_AT[2])) for x, y, z in lp] for lp in loops]
            for a, b in zip(vs, vs[1:]):
                for i in range(4):
                    j = (i + 1) % 4
                    bm.faces.new((a[i], a[j], b[j], b[i]))
            bm.faces.new(vs[0])
            bm.faces.new(list(reversed(vs[-1])))

        top = lambda z: piecewise([(BLADE_Z[1], BLADE_TOP[1]), (BLADE_Z[0], BLADE_TOP[0]), (FIN_START, edge_y(FIN_START) + 0.005)], z)  # noqa: E731
        for s in (1, -1):
            loops = []
            for i in range(15):
                z = lerp(FIN_START, BLADE_Z[1], i / 14)
                xo, low = fin_x(z), edge_y(z) - 0.03
                loops.append([(s * xo, low, z), (s * xo, top(z), z), (s * (xo - FIN_W), top(z), z), (s * (xo - FIN_W), low, z)])
            loft_quads(loops)
        # The blade between the fins; the trailing edge narrower, like the lid.
        loops = []
        for i in range(9):
            t = i / 8 * 2 - 1
            pts = [(BLADE_Z[0], BLADE_TOP[0] - BLADE_T), (BLADE_Z[0], BLADE_TOP[0]), (BLADE_Z[1], BLADE_TOP[1]), (BLADE_Z[1], BLADE_TOP[1] - BLADE_T * 0.6)]
            loops.append([(t * fin_x(z), y, z) for z, y in pts])
        loft_quads(loops)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return build


MIRROR_ARM = (0.46, 0.37)  # (y, z)
MUFFLER_X, MUFFLER_Z, MUFFLER_R = -0.45, (-1.72, -2.16), 0.08


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
    objs = []
    for s, side in ((1, 'L'), (-1, 'R')):
        # Raised pop-up headlights: a wedge standing up at the bonnet's front edge, with a painted lid sloping
        # back down into the bonnet, black sides and the glass facing forward.
        x = s * POPUP_X
        objs.append(popup(f'popup_{side}', x))
        objs.append(part(f'popuplens_{side}', box(0.27, 0.11, 0.012), 'lamp', (x, POPUP_LENS[1], POPUP_LENS[0]), -0.12))
        # The mirror sits on the door's top edge at the window's front corner; the arm goes into the panel.
        root = surface_x(body, MIRROR_ARM[0], MIRROR_ARM[1]) - 0.02
        objs.append(part(f'mirrorstalk_{side}', box(0.86 - root, 0.04, 0.06), 'black', (s * (root + 0.86) / 2, *MIRROR_ARM)))
        objs.append(part(f'mirror_{side}', box(0.14, 0.09, 0.08), 'black', (s * 0.89, MIRROR_ARM[0] + 0.05, MIRROR_ARM[1] - 0.01)))
        for zw, nm in ((WHEELS[0][0], 'F'), (WHEELS[1][0], 'R')):
            objs.append(part(f'flap_{nm}{side}', box(0.2, 0.2, 0.015), 'black', (s * 0.74, -0.31, zw - 0.47)))
        objs.append(part(f'handle_{side}', box(0.02, 0.03, 0.13), 'black', (s * 0.835, 0.33, -0.5)))
        # The wing on the boot lid: mounts a little in from the edge and end plates at the ends.
    objs.append(part('wing', wing(), 'paint', WING_AT))
    objs.append(part('wingstay', box(0.05, 0.09, 0.08), 'paint', (0, 0.48, -2.19)))
    # Air intake in the middle of the bonnet, tilted with the bonnet, with a black opening facing forward.
    z = 1.35
    objs.append(part('scoop', box(0.4, 0.06, 0.3), 'paint', (0, hood_y(z) + 0.02, z), hood_slope(z)))
    objs.append(part('scoop_mouth', box(0.34, 0.035, 0.01), 'black', (0, hood_y(z + 0.15) + 0.035, z + 0.155), hood_slope(z)))
    # The rally intake at the front of the roof.
    objs.append(part('roofvent', box(0.3, 0.045, 0.2), 'paint', (0, 0.82, -0.32)))
    objs.append(part('roofvent_mouth', box(0.24, 0.028, 0.01), 'black', (0, 0.825, -0.215)))
    objs.append(part('plate_front', box(0.46, 0.11, 0.02), 'plate', (0, -0.085, 2.05)))
    # The silencer hangs under the floor in front of the rear bumper; the exhaust pipe runs back out of it.
    top = min(floor_y(body, MUFFLER_X, z) for z in (MUFFLER_Z[0], MUFFLER_Z[1]))
    y = top - MUFFLER_R + 0.01
    objs.append(part('muffler', cylinder_z(MUFFLER_R, MUFFLER_Z[0] - MUFFLER_Z[1], 16), 'dark', (MUFFLER_X, y, sum(MUFFLER_Z) / 2)))
    objs.append(part('exhaust', lambda bm: tube_z(bm, 0.04, MUFFLER_Z[1] + 2.42), ['chrome', 'black'], (MUFFLER_X, y - 0.02, (MUFFLER_Z[1] - 2.42) / 2)))
    # The auxiliary light pod (class 2): four lamps in a painted box on the bonnet's front edge, between the headlights.
    objs.append(part('pod_body', box(0.6, 0.1, 0.2), 'paint', (0, 0.27, 1.84)))
    for i, x in enumerate((0.225, 0.075, -0.075, -0.225)):
        objs.append(part(f'pod_lamp_{i}', cylinder_z(0.07, 0.1), 'paint', (x, 0.32, 1.91)))
        objs.append(part(f'pod_lens_{i}', cylinder_z(0.058, 0.01), 'lamp', (x, 0.32, 1.965)))
    return objs


# --- The rim: white with five spokes ---------------------------------------------------------
#
# Built around the wheel's axle (the car's x) with its origin at the wheel centre and looks the same from both
# sides, so the same rim fits all four wheels. The game puts it in a hollow tyre with radius 0.31 m.

RIM_R, LIP_W, RIM_FACE = 0.215, 0.022, 0.113  # outer radius and width of the rim flange; position of the outer edge (x)
SPOKES = [(0.06, 0.042), (0.11, 0.039), (0.15, 0.042), (0.172, 0.05), (0.184, 0.064), (0.192, 0.08), (0.197, 0.095)]  # (radius, half width)
SPOKE_FACE, SPOKE_T = (0.083, 0.104), 0.022  # the spokes' front face at the hub and at the edge; thickness
HUB_R, NUT_R, NUT_AT = 0.072, 0.011, 0.042


def rim():
    mats = ['white', 'dark', 'chrome']
    W, D, C = range(3)
    bm = bmesh.new()

    def v(a, y, z):
        return bm.verts.new(to_blender(a, y, z))

    def tube(r_in, r_out, a0, a1, mat, segs=32):
        """A tube around the axle: outer and inner shell and both end faces."""
        sec = [(r_out, a0), (r_out, a1), (r_in, a1), (r_in, a0)]
        loops = [[v(a, r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs)) for r, a in sec] for i in range(segs)]
        for i in range(segs):
            p, q = loops[i], loops[(i + 1) % segs]
            for k in range(4):
                bm.faces.new((p[k], p[(k + 1) % 4], q[(k + 1) % 4], q[k])).material_index = mat

    def disc(r, a0, a1, mat, cy=0.0, cz=0.0, segs=24):
        ring = lambda a: [v(a, cy + r * math.cos(2 * math.pi * i / segs), cz + r * math.sin(2 * math.pi * i / segs)) for i in range(segs)]  # noqa: E731
        f, b = ring(a1), ring(a0)
        bm.faces.new(f).material_index = mat
        bm.faces.new(list(reversed(b))).material_index = mat
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((f[i], b[i], b[j], f[j])).material_index = mat

    def spoke(phi, s):
        d, t = (math.cos(phi), math.sin(phi)), (-math.sin(phi), math.cos(phi))
        side = [(u, w) for u, w in SPOKES] + [(u, -w) for u, w in reversed(SPOKES)]
        face = lambda u: lerp(*SPOKE_FACE, (u - SPOKES[0][0]) / (SPOKES[-1][0] - SPOKES[0][0]))  # noqa: E731
        pt = lambda u, w, a: v(s * a, u * d[0] + w * t[0], u * d[1] + w * t[1])  # noqa: E731
        front = [pt(u, w, face(u)) for u, w in side]
        back = [pt(u, w, face(u) - SPOKE_T) for u, w in side]
        bm.faces.new(front).material_index = W
        bm.faces.new(list(reversed(back))).material_index = W
        n = len(side)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((front[i], back[i], back[j], front[j])).material_index = W

    tube(RIM_R - 0.024, RIM_R - 0.017, -RIM_FACE + 0.01, RIM_FACE - 0.01, D)  # the drum behind the spokes
    disc(RIM_R - 0.024, -0.012, 0.012, D)  # dark bottom, so the holes between the spokes look dark
    for s in (1, -1):
        tube(RIM_R - LIP_W, RIM_R, s * RIM_FACE - LIP_W if s > 0 else -RIM_FACE, RIM_FACE if s > 0 else -RIM_FACE + LIP_W, W)
        for k in range(5):
            spoke(2 * math.pi * k / 5 + math.pi / 2, s)
        a0, a1 = sorted((s * 0.066, s * (SPOKE_FACE[0] + 0.006)))
        disc(HUB_R, a0, a1, W)
        for k in range(4):
            ang = 2 * math.pi * k / 4 + math.pi / 4
            n0, n1 = sorted((s * (SPOKE_FACE[0] + 0.004), s * (SPOKE_FACE[0] + 0.016)))
            disc(NUT_R, n0, n1, C, NUT_AT * math.cos(ang), NUT_AT * math.sin(ang), 8)
        c0, c1 = sorted((s * (SPOKE_FACE[0] + 0.004), s * (SPOKE_FACE[0] + 0.012)))
        disc(0.02, c0, c1, D)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new('rim')
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new('rim', mesh)
    # Sits at the left front wheel in Blender, so it shows in the renders; the game only uses the shape.
    obj.location = to_blender(TRACK[0], WHEELS[0][1], WHEELS[0][0])
    bpy.context.scene.collection.objects.link(obj)
    for name in mats:
        obj.data.materials.append(bpy.data.materials[name])
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
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hoshi4wd.blend')
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print('saved', out, len(body.data.vertices), 'vertices')


main()
