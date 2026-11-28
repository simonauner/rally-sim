"""
Builds the Ljung 1600 S in Blender and saves ljung1600.blend next to the script.

    blender -b --factory-startup -P blender/ljung1600/build.py
    blender -b --factory-startup -P blender/ljung1600/build.py -- ljung2000   # blender/ljung2000/ljung2000.blend

The Ljung 2000 16V is the kit car on the same body and wheelbase: widened so the wheel arches sit over its
wider track (1.51 m instead of 1.43 m), 3 cm lower, with larger wheel arches and flares, one large yellow
light per side instead of two, a grille across the whole front, a black bumper with holes and a painted
spoiler with air intakes, painted mirrors, dark rims with five holes and an air intake on the roof. The
differences are controlled by KIT below.

The script produces a first version. After that the .blend file is the source: edit it in Blender and run
blender/export.py to transfer it to the game. Only rerun this script if you want to start over.

Coordinates: everything is computed in car coordinates (x = left, y = up, z = forward, origin at the
centre of mass) and placed in Blender as X = x, Y = -z, Z = y, so the car points towards -Y as in
Blender's front view. The ground is at y = -0.503 and the wheel centres at y ≈ -0.21 when the car is at
rest in the game.

The original is a small three-door hatchback from the 80s: short bonnet sloping towards the front, long
door, wide C-pillar and a nearly vertical tailgate. Lengths and heights are measured from a straight side
view, scaled by a wheelbase of 2.40 m, so it came out 3.74 m long over the bumpers and 1.61 m wide. Last,
real_size() stretches it to the original's size: wheelbase 2.475 m, 3.985 m long, 1.69 m wide over the flares. The body is the shell; lights, grille, bumpers and rims are
parts of their own.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from simplify import SHARP  # noqa: E402

GROUND = -0.503
WHEELS = [(0.912, -0.203), (-1.488, -0.229)]  # (z, y) front and rear
TRACK = [0.70, 0.69]
TYRE_R = 0.29

# Ljung 2000 16V (the kit car). main() turns on KIT and swaps the wheel arch and rim dimensions in KIT_OVERRIDES.
KIT = False
KIT_DROP = 0.03  # how much lower the body sits over the wheels
KIT_LAMP = (0.6, 0.1)  # (x, radius) of the single light per side

# The materials, in the same order as the palette in src/render/models/model.ts.
MATERIALS = [
    ('paint', (0.2, 0.24, 0.36)),
    ('glass', (0.17, 0.23, 0.26)),
    ('black', (0.11, 0.11, 0.11)),
    ('dark', (0.23, 0.23, 0.23)),
    ('chrome', (0.73, 0.75, 0.76)),
    ('lamp', (0.95, 0.91, 0.63)),
    ('amber', (0.91, 0.56, 0.16)),
    ('tail', (0.63, 0.09, 0.09)),
    ('reverse', (0.85, 0.83, 0.8)),
    ('plate', (0.93, 0.93, 0.92)),
    ('shade', (0.14, 0.17, 0.26)),  # seams: paint in shadow
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


# --- The shell: bonnet, sides, tail ----------------------------------------------------------

# The panel's front and rear outline seen from the side (y, z). The front is nearly vertical below the bonnet's front edge,
# with the lights and grille in a black panel; the bumper (a part of its own) sits outside at the bottom. At the rear
# the rear panel is vertical below the tailgate's knee.
FRONT = [(-0.15, 1.46), (-0.08, 1.53), (0.0, 1.55), (0.2, 1.552), (0.235, 1.54), (0.25, 1.52)]
REAR = [(-0.15, -1.93), (-0.08, -2.03), (0.0, -2.062), (0.3, -2.068), (0.47, -2.068)]
NOSE, TAIL = 1.552, -2.068

COWL = 0.454  # windscreen foot (z)
BELT_REAR = -1.565  # the belt line's rear end, where the tailgate takes over


def belt(z):
    """The belt line rises slightly towards the rear (wedge shape)."""
    return lerp(0.425, 0.458, clamp01((COWL - z) / (COWL - BELT_REAR)))


def body_top(z):
    """Top centreline: the bonnet curves down towards the front, behind the windscreen the belt line."""
    if z >= COWL:
        return piecewise([(COWL, 0.425), (0.627, 0.39), (1.108, 0.319), (1.45, 0.262), (NOSE, 0.235)], z)
    return belt(z)


def body_bottom(z):
    return piecewise([(TAIL, -0.10), (-1.95, -0.17), (-1.8, -0.23), (1.3, -0.23), (NOSE, -0.12)], z)


def body_halfwidth(z):
    """Half width seen from above: straight sides, the nose and tail pull in slightly."""
    w = 0.805
    if z > 1.35:
        w *= 1 - 0.07 * clamp01((z - 1.35) / (NOSE - 1.35)) ** 2
    if z < -1.85:
        w *= 1 - 0.05 * clamp01((-1.85 - z) / (-1.85 - TAIL)) ** 2
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
# side outline, so the hood's leading edge, the front panel and the rear panel become smooth surfaces
# instead of steps. Sections are densest where the corners round off seen from above.
FRONT_FROM, REAR_FROM = 1.35, -1.85
END_STEPS = (0, 0.3, 0.5, 0.65, 0.76, 0.85, 0.91, 0.95, 0.98, 1)
# The outlines' break points become rows along the whole side, so the front and rear panel get their
# shapes; merge_flat joins them up again in the middle.
PROFILE_ROWS = sorted({y for y, _ in FRONT + REAR})


def lower_body():
    zs = {lerp(REAR_FROM, TAIL, s) for s in END_STEPS} | {lerp(FRONT_FROM, NOSE, s) for s in END_STEPS}
    zs |= {-1.95, -1.8, BELT_REAR, COWL, 0.627, 1.108, 1.3}
    rings = []
    for zn in fill([z for z in zs if TAIL <= z <= NOSE], 0.25):

        def z_at(y, zn=zn):
            if zn > FRONT_FROM:
                return lerp(FRONT_FROM, piecewise(FRONT, y), (zn - FRONT_FROM) / (NOSE - FRONT_FROM))
            if zn < REAR_FROM:
                return lerp(REAR_FROM, piecewise(REAR, y), (zn - REAR_FROM) / (TAIL - REAR_FROM))
            return zn

        # Top and bottom where those vertices end up after bending, not at the section's own z; otherwise
        # the underside rises too early under the rear panel.
        top, bottom = body_top(zn), body_bottom(zn)
        top, bottom = body_top(z_at(top)), body_bottom(z_at(bottom))
        # The sides are nearly vertical; the shoulder above the side strip pulls in towards the bonnet and belt line.
        shoulder = lambda y, t=top: 1 - 0.03 * clamp01((y - (t - 0.14)) / 0.14)  # noqa: E731
        ring = section(body_halfwidth(zn), bottom, top, 0.05, 0.06, (top - 0.14, *PROFILE_ROWS), shoulder,
                       crown=0.015, n_top=3, n_rt=4)
        rings.append([(x, y, z_at(y)) for x, y in ring])
    return loft('lower', rings)


# --- Cabin: sloping windscreen, flat roof, wide C-pillar and steep tailgate ------------------

# The outline of the roof and tailgate (z, y): the windscreen from the belt line up to the roof, the roof nearly flat,
# the tailgate steeply down to the knee above the tail lights and then vertical.
ROOF = [(TAIL, 0.462), (-2.02, 0.52), (-1.969, 0.56), (-1.75, 0.706), (-1.62, 0.8), (-1.546, 0.835), (-1.45, 0.85),
        (-0.623, 0.858), (-0.15, 0.85), (-0.06, 0.838), (0.0, 0.81), (COWL, 0.425)]
ROOF_FRONT, ROOF_REAR = -0.036, -1.546


def greenhouse():
    rings = []
    # The roof, the cabin's taper and the windows' slope are straight between the break points, so the
    # sections go there. The front end continues down into the hood, so the union cuts cleanly there; the
    # rear end stops just inside the tail, since end caps in the same plane break the union.
    for z in fill([TAIL + 0.003, *(z for z, _ in ROOF[1:]), -2.0, -1.5, -0.1, COWL + 0.04], 0.3):
        base = body_top(z) - 0.04
        top = piecewise(ROOF, z) if z <= COWL else body_top(z) - 0.015
        if top - base < 0.02:
            top = base + 0.02
        # The side windows clearly lean inwards; the cabin narrows a little towards the windscreen but widens at the tailgate, so
        # the rear window is nearly as wide as the body.
        front = clamp01((z + 0.1) / 0.55)
        rear = clamp01((-1.5 - z) / 0.5)
        wb = 0.75 - 0.03 * front + 0.03 * rear
        wt = 0.62 - 0.04 * front + 0.07 * rear
        squeeze = lambda y, b=base, t=top, wb=wb, wt=wt: lerp(1, wt / wb, clamp01((y - b) / (t - b)))  # noqa: E731
        rings.append([(x, y, z) for x, y in section(wb, base, top, 0.07, 0.0, (), squeeze, crown=0.015, n_top=3, n_rt=4, n_rb=1)])
    return loft('greenhouse', rings)


ARCH_R = 0.335  # the wheel arch opening; the plastic flare around it is black out to FLARE_R
FLARE_R = 0.4


def arch_cutters():
    cutters = []
    for zw, yw in WHEELS:
        for s in (1, -1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=ARCH_R, depth=0.5)
            c = bpy.context.active_object
            c.rotation_euler = (0, math.pi / 2, 0)
            c.location = to_blender(s * 0.81, yw, zw)
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
    # The wheel arches and the tail lamps' pockets are cut afterwards, so their edges are clean.
    for c in [*arch_cutters(), *tail_pockets()]:
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


def flip_x(pl):
    return plane(-pl[0].x, pl[0].y, pl[0].z, pl[1])


Y = lambda y: plane(0, 1, 0, y)  # noqa: E731
Z = lambda z: plane(0, 0, 1, z)  # noqa: E731

# The cabin: the windows' lower edge follows the belt line; the roof edge, the edges of the windscreen and rear window, and the pillars.
BELT = line_plane((COWL, 0.432), (BELT_REAR, 0.466))
WINDOW_TOP = 0.79
# The A-pillar is painted, with a black rubber seal against the door window; the door window's front edge is parallel to the windscreen.
A_LINE = line_plane((0.339, 0.432), (-0.087, WINDOW_TOP))
A_FRAME = line_plane((0.357, 0.432), (-0.069, WINDOW_TOP))
# The wide C-pillar: the quarter window's rear edge leans forward going up.
C_LINE = line_plane((-1.56, 0.47), (-1.24, WINDOW_TOP))
C_GLASS = line_plane((-1.545, 0.47), (-1.225, WINDOW_TOP))
B_PILLAR, B_FRAME = (-0.72, -0.637), (-0.734, -0.623)
# The windscreen's side edge follows the cabin's corner at a fixed distance, so the A-pillar is equally wide all the way.
SCREEN_SIDE = plane(1, 0, 0.0714, 0.5524)
SCREEN_FRAME = plane(1, 0, 0.0714, 0.5684)
# The rear window in the tailgate, narrower at the top, with a black strip all around; painted panel below it.
BACKLIGHT_SIDE = line_plane((0.66, 0.58), (0.56, 0.83), x_axis=True)
BACKLIGHT_FRAME = line_plane((0.675, 0.58), (0.575, 0.83), x_axis=True)
BACKLIGHT_Y = (0.585, 0.83)
# Seams: the doors, the bonnet and the tailgate.
SEAM_W = 0.01
DOOR_SEAMS = (0.477, -0.676)
HOOD_SEAM_X = 0.7
COWL_PANEL = 0.5  # black plastic panel between the bonnet and the windscreen
# The tailgate's side seams follow the tail lights' sloping inner edge down to the horizontal seam at the bottom.
HATCH_IN = line_plane((0.518, 0.27), (0.603, 0.456), x_axis=True)
HATCH_OUT = line_plane((0.518 + SEAM_W, 0.27), (0.603 + SEAM_W, 0.456), x_axis=True)
HATCH_SEAM_Y = 0.07
# The side: a shaded crease line, a black rubbing strip and black sills.
CREASE_Y = (0.214, 0.222)
MOLDING_Y = (-0.028, 0.049)
SILL_Y = -0.153
# The front: black panel behind the lights and grille, below the bonnet's front edge.
PANEL_Y, PANEL_X = (0.03, 0.232), 0.76

FRONT_ZONE = lambda c: c[2] > 1.4  # noqa: E731
REAR_ZONE = lambda c: c[2] < -1.95  # noqa: E731
CABIN_ZONE = lambda c: -2.1 < c[2] < 0.55 and c[1] > 0.4  # noqa: E731
SIDE_ZONE = lambda c: abs(c[0]) > 0.68 and c[1] < 0.45  # noqa: E731
HOOD_ZONE = lambda c: c[2] > 0.43 and c[1] > 0.2  # noqa: E731
SIDE_GLASS_ZONE = lambda c: CABIN_ZONE(c) and abs(c[0]) > 0.45  # noqa: E731
SCREEN_ZONE = lambda c: CABIN_ZONE(c) and c[2] > ROOF_FRONT - 0.12  # noqa: E731
BACKLIGHT_ZONE = lambda c: CABIN_ZONE(c) and c[2] < ROOF_REAR + 0.02  # noqa: E731

CUTS = [
    # The window planes cut only where the windows are: planes that continue over the roof leave thin
    # slivers.
    (CABIN_ZONE, [BELT, Z(ROOF_FRONT), Z(ROOF_REAR)]),
    (SIDE_GLASS_ZONE, [Y(WINDOW_TOP), Y(WINDOW_TOP + 0.012), A_LINE, A_FRAME, C_LINE, C_GLASS, *(Z(v) for v in (*B_PILLAR, *B_FRAME))]),
    (SCREEN_ZONE, [pl for sc in (SCREEN_SIDE, SCREEN_FRAME) for pl in (sc, flip_x(sc))]),
    (BACKLIGHT_ZONE, [*(pl for sc in (BACKLIGHT_SIDE, BACKLIGHT_FRAME) for pl in (sc, flip_x(sc))),
                      *(Y(v) for v in (*BACKLIGHT_Y, BACKLIGHT_Y[0] - 0.015, BACKLIGHT_Y[1] + 0.012))]),
    (SIDE_ZONE, [Z(v + d) for v in DOOR_SEAMS for d in (-SEAM_W / 2, SEAM_W / 2)] + [Y(v) for v in (*CREASE_Y, *MOLDING_Y, SILL_Y)]),
    (HOOD_ZONE, [p for d in (0, SEAM_W) for p in mirrored(HOOD_SEAM_X + d)] + [Z(COWL_PANEL)]),
    (REAR_ZONE, [p for pl in (HATCH_IN, HATCH_OUT) for p in (pl, flip_x(pl))] + [Y(HATCH_SEAM_Y), Y(HATCH_SEAM_Y + SEAM_W), Y(0.0)]),
    (FRONT_ZONE, [Y(PANEL_Y[0]), Y(PANEL_Y[1]), *mirrored(PANEL_X)]),
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
    """The cabin: windows with black strips, painted pillars and roof."""
    x, y, z = p
    ax = abs(x)
    q = (ax, y, z)
    if not above(p, BELT):
        return None
    # The windscreen and rear window are bounded only by the planes, so the edges against the pillars become straight.
    if z > ROOF_FRONT and not above(q, SCREEN_SIDE):
        return M['glass']
    if z < ROOF_REAR and not above(q, BACKLIGHT_FRAME):
        if BACKLIGHT_Y[0] < y < BACKLIGHT_Y[1] and not above(q, BACKLIGHT_SIDE):
            return M['glass']
        if BACKLIGHT_Y[0] - 0.015 < y < BACKLIGHT_Y[1] + 0.012:
            return M['black']
        return M['paint']
    # The sides: the windows below the roof edge with black strips; the roof and the pillars painted.
    if y > WINDOW_TOP + 0.012:
        return M['paint']
    if z > ROOF_FRONT - 0.1 and not above(q, SCREEN_FRAME):
        return M['black']
    if above(p, A_FRAME):
        return M['paint']
    if y > WINDOW_TOP or above(p, A_LINE):
        return M['black']
    if B_PILLAR[0] <= z <= B_PILLAR[1]:
        return M['paint']
    if B_FRAME[0] <= z <= B_FRAME[1]:
        return M['black']
    if above(p, C_LINE):
        return M['paint']
    if above(p, C_GLASS):
        return M['black']
    return M['glass']


def face_material(p, n):
    x, y, z = p
    ax = abs(x)
    # The wheel arches.
    for zw, yw in WHEELS:
        if 0.45 < ax < 0.83 and math.hypot(z - zw, y - yw) < ARCH_R + 0.02 and abs(n.x) < 0.8:
            return M['black']
    if CABIN_ZONE(p):
        pane = pane_material(p, n)
        if pane is not None:
            return pane
    # The black panel in the front behind the lights and grille.
    if FRONT_ZONE(p) and z > 1.5 and PANEL_Y[0] < y < PANEL_Y[1] and ax < PANEL_X and n.z > 0.7:
        return M['black']
    if SIDE_ZONE(p) and abs(n.x) > 0.4:
        if y < SILL_Y:
            return M['black']
        if MOLDING_Y[0] < y < MOLDING_Y[1]:
            return M['dark']
        if CREASE_Y[0] < y < CREASE_Y[1]:
            return M['shade']
        if any(abs(z - v) < SEAM_W / 2 for v in DOOR_SEAMS):
            return M['shade']
    if HOOD_ZONE(p) and n.y > 0.5:
        if z < COWL_PANEL:
            return M['black']
        if HOOD_SEAM_X < ax < HOOD_SEAM_X + SEAM_W:
            return M['shade']
    if REAR_ZONE(p) and n.z < -0.5:
        if y < 0.0:
            return M['black']
        q = (ax, y, z)
        if y > HATCH_SEAM_Y and above(q, HATCH_OUT) and not above(q, HATCH_IN):
            return M['shade']
        if HATCH_SEAM_Y < y < HATCH_SEAM_Y + SEAM_W and above(q, HATCH_OUT):
            return M['shade']
    if REAR_ZONE(p) and y < -0.05:
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


def assembly(name, at, boxes, prisms=(), discs=()):
    """A part made of boxes [(material, (x0, x1), (y0, y1), (z0, z1))], prisms [(material, [(x, z), ...], (y0, y1))]
    with a convex base seen from above (or [(material, [(x, y), ...], (z0, z1), 'z')] seen from behind) and
    round discs along z [(material, (x, y), r, (z0, z1))], in car coordinates, with its origin at `at`."""
    mats = []
    bm = bmesh.new()

    def mat_index(mat):
        if mat not in mats:
            mats.append(mat)
        return mats.index(mat)

    for mat, poly, (w0, w1), *axis in prisms:
        m = mat_index(mat)
        pt = (lambda u, v, w: (u, v, w)) if axis == ['z'] else (lambda u, v, w: (u, w, v))  # noqa: E731
        lo = [bm.verts.new(to_blender(*(c - a for c, a in zip(pt(u, v, w0), at)))) for u, v in poly]
        hi = [bm.verts.new(to_blender(*(c - a for c, a in zip(pt(u, v, w1), at)))) for u, v in poly]
        faces = [bm.faces.new(lo), bm.faces.new(list(reversed(hi)))]
        for i in range(len(poly)):
            j = (i + 1) % len(poly)
            faces.append(bm.faces.new((lo[i], lo[j], hi[j], hi[i])))
        for f in faces:
            f.material_index = m
    for mat, xs, ys, zs in boxes:
        m = mat_index(mat)
        r = bmesh.ops.create_cube(bm, size=1)
        size = (xs[1] - xs[0], ys[1] - ys[0], zs[1] - zs[0])
        mid = (sum(xs) / 2 - at[0], sum(ys) / 2 - at[1], sum(zs) / 2 - at[2])
        bmesh.ops.scale(bm, vec=Vector((size[0], size[2], size[1])), verts=r['verts'])
        bmesh.ops.translate(bm, vec=to_blender(*mid), verts=r['verts'])
        for f in {f for v in r['verts'] for f in v.link_faces}:
            f.material_index = m
    for mat, (x, y), r, (z0, z1) in discs:
        m = mat_index(mat)
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=r, radius2=r, depth=z1 - z0)
        bmesh.ops.rotate(bm, cent=Vector(), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'), verts=res['verts'])
        bmesh.ops.translate(bm, vec=to_blender(x - at[0], y - at[1], (z0 + z1) / 2 - at[2]), verts=res['verts'])
        for f in {f for v in res['verts'] for f in v.link_faces}:
            f.material_index = m
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


# The headlights: two round lights per side in the black panel, a large one outermost and a smaller one inside it,
# each in a black ring. The grille with dense horizontal slats runs between the outer lights, behind the
# inner ones. Measured from a straight front view.
LAMP_Y = 0.132
LAMPS = [(0.584, 0.098), (0.358, 0.074)]  # (x, radius)
LAMP_FACE = 1.566
GRILLE_X, GRILLE_Y = 0.48, (0.05, 0.212)


def headlamp(s, side):
    if KIT:
        # A large light with a yellow cover; the bulb is faintly visible inside at the bottom.
        x, r = KIT_LAMP
        discs = [('black', (s * x, LAMP_Y), r + 0.01, (1.52, LAMP_FACE - 0.004)), ('amber', (s * x, LAMP_Y), r, (1.52, LAMP_FACE)),
                 ('lamp', (s * (x - 0.03), LAMP_Y - 0.02), 0.035, (1.52, LAMP_FACE + 0.003))]
        return assembly(f'headlamp_{side}', (s * x, LAMP_Y, 1.55), [], discs=discs)
    discs = []
    for x, r in LAMPS:
        discs.append(('black', (s * x, LAMP_Y), r + 0.013, (1.52, LAMP_FACE - 0.004)))
        discs.append(('lamp', (s * x, LAMP_Y), r, (1.52, LAMP_FACE)))
    return assembly(f'headlamp_{side}', (s * 0.48, LAMP_Y, 1.55), [], discs=discs)


def grille():
    y0, y1 = GRILLE_Y
    face = 1.562
    # The kit car has a grille across the whole front between the lights, with denser slats and no badge.
    gx = KIT_LAMP[0] - KIT_LAMP[1] - 0.012 if KIT else GRILLE_X
    boxes = [('black', (-gx, gx), (y0, y1), (1.52, face - 0.01))]
    # Horizontal slats.
    n = 9 if KIT else 6
    for i in range(n):
        y = lerp(y0 + 0.015, y1 - 0.015, i / (n - 1))
        t = 0.006 if KIT else 0.007
        boxes.append(('dark', (-gx + 0.01, gx - 0.01), (y - t, y + t), (1.52, face - 0.004)))
    # The badge in the middle of the grille: a simple round chrome plaque.
    discs = [] if KIT else [('chrome', (0, (y0 + y1) / 2), 0.04, (1.52, face + 0.004))]
    return assembly('grille', (0, (y0 + y1) / 2, 1.55), boxes, discs=discs)


# The bumpers: black, straight across the front and rear panel and wrapped around the corners back (forward) to
# the wheel arches, with a dark grey rubbing strip in the middle of the face. The rear one sits higher than the front one.
BUMPER_HALF, BUMPER_DEPTH, BUMPER_R = 0.815, 0.075, 0.09
FRONT_BUMPER_Y, REAR_BUMPER_Y = (-0.128, 0.017), (-0.032, 0.107)
FRONT_SPOILER_Y, FRONT_LIP_Y = (-0.245, -0.125), (-0.33, -0.24)


def bumper(name, z_face, z_end, ys, half=BUMPER_HALF, colours=('black', 'dark')):
    """A U-shaped bumper: the face at z_face, the sides back to z_end."""
    d = 1 if z_face > z_end else -1
    h, r = half, BUMPER_R
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
    y0, y1 = ys
    hh = y1 - y0
    # The cross-section (outwards, y): the bottom edge pulls in, the face with a strip, the top leans in towards the panel.
    sec = [(-0.02, y0), (0, y0 + 0.2 * hh), (0, y0 + 0.62 * hh), (0.004, y0 + 0.7 * hh), (0, y0 + 0.86 * hh), (-0.015, y1),
           (-BUMPER_DEPTH, y1), (-BUMPER_DEPTH, y0)]
    mats = [0, 0, 0, 1, 0, 0, 0, 0]  # black, dark
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
    return new_object(name, bm, list(colours), at)


# The tail lights: trapezoids in the tail's corners below the tailgate's knee, in a black frame. The inner edge leans
# inwards going down (the tailgate goes down between them). Top row: reversing light inside and yellow indicator outermost;
# bottom row three red fields. Measured from close-ups straight from behind. The light sits in a pocket cut out of the body's
# corner (tail_pockets) and fills it, so it wraps around the corner and the side is glass up to the pocket's edge.
TAIL_Y = (0.27, 0.456)
TAIL_SPLIT, TAIL_FACE = 0.366, -2.07
TAIL_POCKET = -2.0  # the pocket's front edge (z): as far forward along the side as the light reaches
TAIL_TOP_SPLIT = 0.656  # between the reversing light and the indicator (x)
TAIL_BOTTOM_SPLITS = (0.618, 0.706)  # between the red fields
TAIL_GAP, TAIL_RIM = 0.004, 0.007


def tail_inner(y):
    """The light's inner edge (x) at height y: 0.53 at the bottom, 0.615 at the top."""
    return lerp(0.53, 0.615, (y - TAIL_Y[0]) / (TAIL_Y[1] - TAIL_Y[0]))


def tail_pockets():
    """Cutters for the tail lights' pockets: the light's shape with frame, from the inner edge out past the side."""
    cutters = []
    y0, y1 = TAIL_Y[0] - TAIL_RIM, TAIL_Y[1] + TAIL_RIM
    for s in (1, -1):
        poly = [(s * (tail_inner(y0) - TAIL_RIM), y0), (s * 1.0, y0), (s * 1.0, y1), (s * (tail_inner(y1) - TAIL_RIM), y1)]
        bm = bmesh.new()
        lo = [bm.verts.new(to_blender(x, y, -2.3)) for x, y in poly]
        hi = [bm.verts.new(to_blender(x, y, TAIL_POCKET)) for x, y in poly]
        bm.faces.new(lo)
        bm.faces.new(list(reversed(hi)))
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new('pocket')
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new('pocket', mesh)
        bpy.context.scene.collection.objects.link(obj)
        cutters.append(obj)
    return cutters


def taillamp(body, s, side):
    y0, y1, sp, g = *TAIL_Y, TAIL_SPLIT, TAIL_GAP
    # The outer edge follows the side where the pocket starts, so the light's side is flush with the panel in front.
    ox0, ox1 = (surface_x(body, y, TAIL_POCKET + 0.005) for y in (y0, y1))
    outer = lambda y: lerp(ox0, ox1, (y - y0) / (y1 - y0))  # noqa: E731

    def cell(mat, x0, x1, ya, yb, z0=TAIL_FACE):
        """A field between x0 and x1 (numbers, or functions of y for the sloping edges)."""
        at = lambda e, y: e(y) if callable(e) else e  # noqa: E731
        poly = [(s * at(x0, ya), ya), (s * at(x1, ya), ya), (s * at(x1, yb), yb), (s * at(x0, yb), yb)]
        return (mat, poly, (z0, TAIL_POCKET + 0.003), 'z')

    inner = lambda y: tail_inner(y) + g  # noqa: E731
    frame_in = lambda y: tail_inner(y) - TAIL_RIM  # noqa: E731
    frame_out = lambda y: outer(y) - 0.001  # noqa: E731
    b0, b1 = TAIL_BOTTOM_SPLITS
    prisms = [
        cell('black', frame_in, frame_out, y0 - TAIL_RIM, y1 + TAIL_RIM, TAIL_FACE + 0.002),
        cell('reverse', inner, TAIL_TOP_SPLIT - g / 2, sp + g / 2, y1 - g),
        cell('amber', TAIL_TOP_SPLIT + g / 2, outer, sp + g / 2, y1 - g),
        cell('tail', inner, b0 - g / 2, y0 + g, sp - g / 2),
        cell('tail', b0 + g / 2, b1 - g / 2, y0 + g, sp - g / 2),
        cell('tail', b1 + g / 2, outer, y0 + g, sp - g / 2),
    ]
    return assembly(f'taillamp_{side}', (s * 0.65, sum(TAIL_Y) / 2, -2.04), [], prisms)


# The mirror: a black triangular foot in the door window's front corner, a short arm and a rounded housing that
# tapers towards the front, with the mirror glass facing back.
MIRROR_FOOT = (0.33, 0.2)  # the foot's front and rear edge (z) on the belt line
MIRROR_HOUSING = ((0.79, 0.925), (0.44, 0.535), (0.2, 0.275))  # x, y, z (rear, front)


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
    by = belt((zf + zb) / 2)
    root = surface_x(body, by - 0.03, (zf + zb) / 2) - 0.015
    tri = lambda x: [v(x, by - 0.01, zf), v(x, by + 0.08, zf), v(x, by - 0.01, zb)]  # noqa: E731
    faces([tri(root), tri(root + 0.035)], [0, 0, 0])
    # The arm out to the housing.
    ay, az = by + 0.035, hz0 + 0.04
    arm = lambda x: [v(x, ay, az + 0.015), v(x, ay + 0.025, az + 0.015), v(x, ay + 0.025, az - 0.015), v(x, ay, az - 0.015)]  # noqa: E731
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
    return new_object(f'mirror_{side}', bm, ['paint' if KIT else 'black', 'dark'], at)


def flare(body, zw, yw, s, name):
    """Black plastic flare around the wheel arch: an arc from the sill over the wheel, sticking out from the side."""
    bm = bmesh.new()
    at = (s * 0.8, yw, zw)
    rings = []
    n = 24
    for i in range(n + 1):
        a = math.radians(lerp(-8, 188, i / n))
        c, sn = math.cos(a), math.sin(a)
        # Below the sill there is no side to measure against; there the arc follows the sill's side.
        x0 = surface_x(body, max(yw + (FLARE_R - 0.012) * sn, -0.14), zw + (FLARE_R - 0.012) * c) - 0.006
        x1 = x0 + (0.045 if KIT else 0.03)
        ring = [(x0, ARCH_R - 0.004), (x1, ARCH_R + 0.006), (x1, FLARE_R - 0.012), (x0, FLARE_R)]
        rings.append([bm.verts.new(to_blender(s * x - at[0], r * sn, r * c)) for x, r in ring])
    for a, b in zip(rings, rings[1:]):
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    return new_object(name, bm, ['black'], at)


# The floor is flat up to z ≈ -1.72 and then rises towards the tail, so the silencer sits in front of that.
MUFFLER_X, MUFFLER_Z, MUFFLER_R = 0.42, (-1.44, -1.70), 0.075
PIPE_R, PIPE_END = 0.027, -2.15


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


def kit_front():
    """The kit car's front below the lights: a row of holes and two meshed intakes in the black bumper, a painted
    spoiler with four intakes and round holes outermost, and a black lip at the very bottom."""
    yb = sum(FRONT_BUMPER_Y) / 2
    holes = [('dark', (x, yb), 0.028, (1.606, 1.616)) for x in (lerp(-0.34, 0.34, i / 8) for i in range(9))]
    nets = [('dark', xs, (yb - 0.025, yb + 0.025), (1.606, 1.615)) for xs in ((-0.62, -0.42), (0.42, 0.62))]
    ys = (-0.27, -0.125)
    vents = [('black', xs, (-0.24, -0.185), (1.586, 1.596)) for xs in ((-0.5, -0.29), (-0.26, -0.03), (0.03, 0.26), (0.29, 0.5))]
    fogs = [('black', (x, -0.21), 0.035, (1.586, 1.597)) for x in (-0.62, 0.62)]
    return [
        assembly('bumper_holes', (0, yb, 1.612), nets, discs=holes),
        bumper('spoiler_front', 1.592, 1.27, ys, colours=('paint', 'paint')),
        assembly('spoiler_vents', (0, -0.21, 1.59), vents, discs=fogs),
        bumper('spoiler_lip', 1.585, 1.35, (-0.33, -0.265), half=0.74),
    ]


def details(body):
    objs = [grille()]
    for s, side in ((1, 'L'), (-1, 'R')):
        objs.append(headlamp(s, side))
        objs.append(taillamp(body, s, side))
        objs.append(mirror(body, s, side))
        z = -0.522
        x = surface_x(body, 0.32, z)
        objs.append(assembly(f'handle_{side}', (s * x, 0.32, z), [('black', mirror_x((x - 0.01, x + 0.012), s), (0.305, 0.335), (z - 0.1, z + 0.1))]))
        # Side indicators on the front wing behind the wheel arch.
        x = surface_x(body, 0.169, 0.541)
        objs.append(assembly(f'sidemarker_{side}', (s * x, 0.169, 0.541), [('amber', mirror_x((x - 0.01, x + 0.006), s), (0.16, 0.178), (0.52, 0.56))]))
        if not KIT:
            # Indicators in the front bumper, outermost.
            objs.append(assembly(f'blinker_{side}', (s * 0.66, -0.02, 1.61), [('amber', mirror_x((0.58, 0.74), s), (-0.04, 0.0), (1.58, 1.616))]))
        for (zw, yw), nm in zip(WHEELS, 'FR'):
            objs.append(flare(body, zw, yw, s, f'flare_{nm}{side}'))
            # Mud flaps behind the wheel, about 12 cm above the ground.
            objs.append(assembly(f'flap_{nm}{side}', (s * 0.7, -0.3, zw - 0.37), [('black', mirror_x((0.62, 0.78), s), (-0.38, -0.22), (zw - 0.38, zw - 0.366))]))
    objs.append(bumper('bumper_front', 1.612, 1.26, FRONT_BUMPER_Y))
    objs.append(bumper('bumper_rear', -2.132, -1.835, REAR_BUMPER_Y))
    if KIT:
        objs.extend(kit_front())
    else:
        # The front spoiler below the bumper: black plastic across the full width that wraps around the corners back to
        # the wheel arches, and below it a narrower lip that reaches down to about 17 cm above the ground.
        objs.append(bumper('spoiler_front', 1.592, 1.27, FRONT_SPOILER_Y))
        objs.append(bumper('spoiler_lip', 1.585, 1.45, FRONT_LIP_Y, half=0.62))
        objs.append(assembly('plate_front', (0, -0.1, 1.615), [('plate', (-0.24, 0.24), (-0.16, -0.04), (1.605, 1.617))]))
    # The rear plate sits high in the tailgate between the tail lights, in a black recess.
    objs.append(assembly('plate_rear', (0, 0.37, -2.072), [('black', (-0.285, 0.285), (0.3, 0.44), (-2.074, -2.06)),
                                                          ('plate', (-0.25, 0.25), (0.315, 0.425), (-2.078, -2.066))]))
    # The silencer under the floor in front of the rear bumper; the exhaust pipe exits below the bumper.
    # The pipe follows the floor up towards the rear and ends just below the bumper.
    # The kit car has an oval, wider silencer and twin tailpipes side by side.
    rx, ry = (0.11, 0.06) if KIT else (MUFFLER_R, MUFFLER_R)
    pipe_r, pipes_x = (0.023, (-0.045, 0.045)) if KIT else (PIPE_R, (0.0,))
    top = min(floor_y(body, MUFFLER_X, z) for z in MUFFLER_Z)
    y = top - ry + 0.005
    muffler = cylinder_z('muffler', 'dark', (MUFFLER_X, y, sum(MUFFLER_Z) / 2), MUFFLER_R, MUFFLER_Z[0] - MUFFLER_Z[1], 16)
    muffler.data.transform(Matrix.Diagonal((rx / MUFFLER_R, 1, ry / MUFFLER_R, 1)))
    objs.append(muffler)
    y0, z0 = top - pipe_r - 0.005, MUFFLER_Z[1]
    y1 = floor_y(body, MUFFLER_X, -2.05) - pipe_r - 0.035
    length = math.hypot(y1 - y0, z0 - PIPE_END)
    tilt = math.atan2(y1 - y0, z0 - PIPE_END)
    bm = bmesh.new()
    for dx in pipes_x:
        verts = tube_z(bm, pipe_r, length)
        bmesh.ops.rotate(bm, cent=Vector(), matrix=Matrix.Rotation(tilt, 3, 'X'), verts=verts)
        bmesh.ops.translate(bm, vec=Vector((dx, 0, 0)), verts=verts)
    objs.append(new_object('exhaust', bm, ['chrome', 'black'], (MUFFLER_X, (y0 + y1) / 2, (z0 + PIPE_END) / 2)))
    if KIT:
        # Air intake at the front of the roof.
        objs.append(assembly('scoop', (0, 0.9, -0.25), [('dark', (-0.14, 0.14), (0.84, 0.92), (-0.38, -0.12)),
                                                         ('black', (-0.12, 0.12), (0.855, 0.912), (-0.118, -0.11))]))
    return objs


# --- The rim: silver-painted steel rim with a ring of round holes and a black hubcap -----------
#
# Built around the wheel's axle (the car's x) with its origin at the wheel centre and looks the same from both
# sides, so the same rim fits all four wheels. The game puts it in a hollow tyre with inner radius 0.205 m.

RIM_R, LIP_W, RIM_FACE = 0.215, 0.02, 0.105
DISH = (0.07, 0.08)  # depth (x) of the rim's dish inside the edge
HOLES, HOLE_R, HOLE_AT = 16, 0.016, 0.142
CAP_R = 0.06


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

    def disc(r, a0, a1, mat, segs=24, c=(0, 0)):
        ring = lambda a: [v(a, c[0] + r * math.cos(2 * math.pi * i / segs), c[1] + r * math.sin(2 * math.pi * i / segs)) for i in range(segs)]  # noqa: E731
        f, b = ring(a1), ring(a0)
        bm.faces.new(f).material_index = mat
        bm.faces.new(list(reversed(b))).material_index = mat
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((f[i], b[i], b[j], f[j])).material_index = mat

    tube(RIM_R - 0.024, RIM_R - 0.017, -RIM_FACE + 0.01, RIM_FACE - 0.01, D)  # the drum behind the dish
    for s in (1, -1):
        a0, a1 = sorted((s * (RIM_FACE - LIP_W), s * RIM_FACE))
        tube(RIM_R - LIP_W, RIM_R, a0, a1, C)
        # The dish: a silver disc a little inside the edge, with the holes as black discs just outside it.
        d0, d1 = sorted((s * DISH[0], s * DISH[1]))
        disc(RIM_R - 0.018, d0, d1, D if KIT else C, 32)
        h0, h1 = sorted((s * DISH[1], s * (DISH[1] + 0.002)))
        for k in range(HOLES):
            phi = 2 * math.pi * k / HOLES
            disc(HOLE_R, h0, h1, B, 10, (HOLE_AT * math.cos(phi), HOLE_AT * math.sin(phi)))
        # The hubcap: a black dome (low disc) in the middle of the dish.
        c0, c1 = sorted((s * DISH[1], s * (DISH[1] + 0.02)))
        disc(CAP_R, c0, c1, B)
        m0, m1 = sorted((s * (DISH[1] + 0.02), s * (DISH[1] + 0.026)))
        disc(0.03, m0, m1, D, 16)
    return new_object('rim', bm, mats, (TRACK[0], WHEELS[0][1], WHEELS[0][0]))


def reference(wheels, track, tyre_r, ground):
    """Wheels and ground to model against. Not exported."""
    coll = bpy.data.collections.new('Reference')
    bpy.context.scene.collection.children.link(coll)
    for (zw, yw), xw in zip(wheels, track):
        for s in (1, -1):
            # Hollow tyre, so the rim shows inside it.
            bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=tyre_r, depth=0.205, end_fill_type='NOTHING')
            w = bpy.context.active_object
            sol = w.modifiers.new('wall', 'SOLIDIFY')
            sol.thickness, sol.offset = tyre_r - RIM_R + 0.01, -1
            w.rotation_euler = (0, math.pi / 2, 0)
            w.location = to_blender(s * xw, yw, zw)
            w.name = 'wheel'
            bpy.context.scene.collection.objects.unlink(w)
            coll.objects.link(w)
    bpy.ops.mesh.primitive_plane_add(size=8, location=to_blender(0, ground, 0))
    g = bpy.context.active_object
    g.name = 'ground'
    bpy.context.scene.collection.objects.unlink(g)
    coll.objects.link(g)


# Ljung 2000 16V: the wheels' resting position in the game (z, y), track, tyre radius and the ground.
VARIANTS = {
    'ljung1600': (WHEELS, TRACK, TYRE_R, GROUND),
    'ljung2000': ([(0.936, -0.205), (-1.464, -0.222)], [0.74, 0.73], 0.3, -0.512),
}


def warp(wheels, track, drop=0.0):
    """The mapping (car coordinates) that moves the Ljung 1600's wheels to `wheels`/`track`: shifted along the
    car (and scaled by the wheelbase, if it differs), scaled sideways by the track and in height so that both
    axles end up right, `drop` lower."""
    (zf, yf), (zr, yr) = WHEELS
    (zf2, yf2), (zr2, yr2) = wheels
    a = (zf2 - zr2) / (zf - zr)
    b = track[0] / TRACK[0]
    dyf, dyr = yf2 - yf, yr2 - yr

    def f(p):
        x, y, z = p
        return Vector((b * x, y - drop + lerp(dyr, dyf, (z - zr) / (zf - zr)), zf2 + (z - zf) * a))
    return f


def apply_warp(objs, f):
    """Stretches the parts' meshes; the panels (body) keep their origin at the car's origin, other parts move along."""
    # matrix_world is only recomputed when the scene updates; otherwise newly created parts stay at the origin.
    bpy.context.view_layer.update()
    for obj in objs:
        mw = obj.matrix_world.copy()
        at = Vector((0, 0, 0)) if obj.name == 'body' else f(to_car(mw.translation))
        for v in obj.data.vertices:
            v.co = to_blender(*(f(to_car(mw @ v.co)) - at))
        obj.matrix_world = Matrix.Translation(to_blender(*at))


# The body above is drawn from a side view scaled by a 2.40 m wheelbase, which made it smaller than the original
# (wheelbase 2.475 m, 3.985 m long, 1.68 m wide over the arch flares, 1.40 m high). real_size() stretches it to
# that: the wheelbase by REAL_WHEELBASE, the overhangs beyond ARCH_ZONE from the axles by OVERHANG (so the wheel
# arches keep their shape), the width by WIDEN and the height above the ground by RAISE.
REAL_WHEELBASE = 2.475
ARCH_ZONE = 0.46
OVERHANG = 1.228
WIDEN = 1.019
RAISE = 1.015


def real_size(wheels, track, ground):
    """The mapping to the original's size, and the wheels and track it moves `wheels`/`track` to. The axles are
    scaled about the centre of mass, so they keep their share of the wheelbase."""
    (zf, yf), (zr, yr) = wheels
    a = REAL_WHEELBASE / (zf - zr)
    front, rear = zf + ARCH_ZONE, zr - ARCH_ZONE

    def g(z):
        if z > front:
            return a * front + (z - front) * OVERHANG
        if z < rear:
            return a * rear + (z - rear) * OVERHANG
        return a * z

    def f(p):
        x, y, z = p
        return Vector((WIDEN * x, ground + (y - ground) * RAISE, g(z)))
    return f, [(a * zf, yf), (a * zr, yr)], [WIDEN * t for t in track]


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    name = args[0] if args else 'ljung1600'
    wheels, track, tyre_r, ground = VARIANTS[name]
    if name == 'ljung2000':
        # Larger wheel arches and flares, so the tyres fit when the body sits lower, and rims with five holes.
        globals().update(KIT=True, ARCH_R=0.36, FLARE_R=0.44, HOLES=5, HOLE_R=0.045, HOLE_AT=0.115)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    export = bpy.data.collections.new('Export')
    bpy.context.scene.collection.children.link(export)
    body = build_body()
    cut_planes(body)
    assign_materials(body, face_material)
    merge_flat(body)
    mark_sharp(body)
    wheel_rim = rim()
    parts = [body, *details(body)]
    if name != 'ljung1600':
        apply_warp(parts, warp(wheels, track, KIT_DROP if KIT else 0.0))
    f, wheels, track = real_size(wheels, track, ground)
    apply_warp(parts, f)
    wheel_rim.location = to_blender(track[0], wheels[0][1], wheels[0][0])
    for obj in [*parts, wheel_rim]:
        bpy.context.scene.collection.objects.unlink(obj)
        export.objects.link(obj)
    reference(wheels, track, tyre_r, ground)
    # The rim on the other three wheels too, just for looking at (the same mesh).
    for (zw, yw), xw in zip(wheels, track):
        for sx in (1, -1):
            if (zw, sx) != (wheels[0][0], 1):
                copy = wheel_rim.copy()
                copy.location = to_blender(sx * xw, yw, zw)
                bpy.data.collections['Reference'].objects.link(copy)
    folder = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), name)
    os.makedirs(folder, exist_ok=True)
    out = os.path.join(folder, f'{name}.blend')
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print('saved', out, len(body.data.vertices), 'vertices')


main()
