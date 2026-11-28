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

# --- Lower body: bonnet, sides, aprons and tail -------------------------------------------
#
# The measurements are taken from a straight side photo, scaled to the wheelbase (2.40 m) and placed on the
# wheel centres: 1 px = 6.2 mm. The widths come from pictures straight from the front and the rear.

# Front and rear outline seen from the side: how far forward/back the panel reaches at height y.
# Front: a flat face with the grille and lamps, a sharp edge to the bonnet and an apron that slopes back
# below the bumpers (which are loose parts).
FRONT = [(-0.24, 1.6), (-0.18, 1.67), (-0.05, 1.712), (0.24, 1.722), (0.28, 1.705), (0.31, 1.665)]
# Rear: a valance under the bumper, an upright tail panel with the lamps and the boot lid edge above it.
REAR = [(-0.19, -2.0), (-0.12, -2.10), (-0.02, -2.15), (0.40, -2.165), (0.42, -2.152), (0.44, -2.125)]

# The waist crease: the panel is upright below the crease and leans in towards the belt line above it.
CREASE = 0.3
SHOULDER_W = 0.75


def hood_top(z):
    return piecewise([(0.594, 0.467), (0.966, 0.448), (1.276, 0.405), (1.586, 0.343), (1.722, 0.315)], z)


def body_top(z):
    """Centre line of the top: bonnet, belt line under the cabin and the boot lid."""
    if z >= 0.594:
        return hood_top(z)
    if z >= -1.45:
        return belt_y(z) + 0.01
    return piecewise([(-2.165, 0.42), (-2.134, 0.435), (-1.6, 0.49), (-1.45, belt_y(-1.45) + 0.01)], z)


def belt_y(z):
    """Bottom edge of the side windows (the plane BELT): level along the car."""
    return 0.455


def hood_crown(z):
    """The bonnet and boot lid are slightly crowned."""
    return 0.02


def body_bottom(z):
    return piecewise([(-2.165, -0.19), (-1.9, -0.27), (1.45, -0.277), (1.722, -0.24)], z)


def body_halfwidth(z):
    """Half width below the waist crease seen from above: straight sides, slightly rounded corners."""
    w = 0.785
    if z > 1.5:
        w *= 1 - 0.04 * clamp01((z - 1.5) / 0.222) ** 2
    if z < -1.95:
        w *= 1 - 0.04 * clamp01((-1.95 - z) / 0.215) ** 2
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
# outline, so the steps become even surfaces instead of stairs.
NOSE, TAIL = 1.722, -2.165
FRONT_FROM, REAR_FROM = 1.5, -1.95
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
    zs |= {-2.134, -1.6, -1.45, 0.594, 0.966, 1.276}
    zs |= {zw + d for zw, _ in WHEELS for d in (-0.3, 0, 0.3)}
    rings = []
    for zn in fill([z for z in zs if TAIL <= z <= NOSE], 0.2):
        top, bottom = body_top(zn), body_bottom(zn)
        hw = body_halfwidth(zn)
        ring = section(hw, bottom, top, 0.04, 0.05, PROFILE_ROWS, shoulder(hw, top), crown=hood_crown(zn))

        def z_at(y, zn=zn):
            if zn > FRONT_FROM:
                return lerp(FRONT_FROM, piecewise(FRONT, y), (zn - FRONT_FROM) / (NOSE - FRONT_FROM))
            if zn < REAR_FROM:
                return lerp(REAR_FROM, piecewise(REAR, y), (zn - REAR_FROM) / (TAIL - REAR_FROM))
            return zn

        rings.append([(x, y, z_at(y)) for x, y in ring])
    return loft('lower', rings)


# --- Cabin: windscreen, roof, rear screen and side windows ----------------------------------

# The roof line seen from the side: foot of the rear screen on the boot, rear and front edge of the roof and
# foot of the windscreen. An upright glasshouse: steep screens front and rear and a long, slightly curved roof.
ROOF = [(-1.495, 0.516), (-1.06, 0.826), (-0.9, 0.86), (-0.4, 0.875), (0.036, 0.875), (0.594, 0.467)]


def greenhouse():
    rings = []
    # The roof, the narrowing of the cabin and the slope of the glass are straight between the break points,
    # so the sections go there. The ends continue down into the body, so the union cuts cleanly at the bonnet and boot.
    for z in fill([-1.55, *(z for z, _ in ROOF), 0.65], 0.3):
        base = belt_y(z) - 0.05
        top = piecewise(ROOF, z) if ROOF[0][0] <= z <= ROOF[-1][0] else body_top(z) - 0.03
        # Narrower at the top (the side windows lean in) and towards the windscreen.
        front = clamp01((z - 0.036) / 0.558)
        wb = lerp(0.72, 0.68, front)
        wt = 0.55
        squeeze = lambda y, b=base, t=top, wb=wb, wt=wt: lerp(1, wt / wb, clamp01((y - b) / (t - b)))  # noqa: E731
        rings.append([(x, y, z) for x, y in section(wb, base, top, 0.05, 0.0, (), squeeze, crown=0.02, n_rb=1)])
    return loft('greenhouse', rings)


ARCH_R = 0.345


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

# The front: a black grille in a chrome frame across the whole face (the round headlamps are loose parts on
# it); the bumpers are loose parts too.
GRILLE_Y, GRILLE_X, FRAME_W = (0.06, 0.28), 0.76, 0.012
# Rear: lamps in the corners (amber outermost, red, then reversing lights), a black panel between them with
# the number plate in the middle, and a painted panel above.
TAIL_Y, TAIL_X, TAIL_AMBER, TAIL_REVERSE = (0.10, 0.24), 0.52, 0.72, 0.58
PLATE_Y, PLATE_X = (0.11, 0.23), 0.26
# The cabin: bottom edge of the glass, front edge of the door glass (A pillar), B pillar, rear edge of the
# quarter window (C pillar), roof edge, sides of the windscreen and the rear screen.
BELT = plane(0, 1, 0, 0.455)
A_LINE = plane(0, 0.558, 0.408, 0.4866)  # parallel to the windscreen, 4 cm behind it
C_LINE = plane(0, 1, -0.872, 1.733)  # rear edge of the quarter window, from (z -1.452, y 0.467) to (-1.061, 0.808)
B_PILLAR = (-0.6, -0.54)
DOOR_FRONT, QUARTER_REAR = 0.56, -1.47
ROOF_EDGE = 0.82
SCREEN_SIDE = plane(1, 0.3, 0, 0.771)  # for |x|: the windscreen's black frame
BACKLIGHT_X, BACKLIGHT_Y = 0.56, 0.53
# Seams: front and rear edges of the doors and the top edges of the aprons front and rear.
SEAM_W = 0.012
DOOR_SEAMS = (0.594, -0.596)
BUMPER_SEAM = {'front': GRILLE_Y[0] - SEAM_W, 'rear': TAIL_Y[0] - SEAM_W}
SIDE_ZONE = lambda c: abs(c[0]) > 0.65 and -0.28 < c[1] < 0.45  # noqa: E731
SKIRT_Y = -0.215
# The boot lid: the deck between the rear screen and the tail.
LID_X = 0.7
DECK_ZONE = lambda c: c[2] < -1.5 and c[1] > 0.3  # noqa: E731

FRONT_ZONE = lambda c: c[2] > 1.45  # noqa: E731
REAR_ZONE = lambda c: c[2] < -1.95  # noqa: E731
CABIN_ZONE = lambda c: -1.6 < c[2] < 0.65 and c[1] > 0.4  # noqa: E731

CUTS = [
    (FRONT_ZONE, [Y(v) for v in (*GRILLE_Y, GRILLE_Y[0] + FRAME_W, GRILLE_Y[1] - FRAME_W)] + [p for v in (GRILLE_X, GRILLE_X - FRAME_W) for p in mirrored(v)]),
    (REAR_ZONE, [Y(v) for v in (*TAIL_Y, *PLATE_Y)] + [p for v in (TAIL_X, TAIL_AMBER, TAIL_REVERSE, PLATE_X) for p in mirrored(v)]),
    (CABIN_ZONE, [BELT, A_LINE, C_LINE, Y(ROOF_EDGE), Y(BACKLIGHT_Y), Z(DOOR_FRONT), Z(QUARTER_REAR), *(Z(v) for v in B_PILLAR),
                  SCREEN_SIDE, plane(-1, 0.3, 0, 0.771), *mirrored(BACKLIGHT_X)]),
    (SIDE_ZONE, [Z(v + d) for v in DOOR_SEAMS for d in (-SEAM_W / 2, SEAM_W / 2)] + [Y(SKIRT_Y)]),
    (FRONT_ZONE, [Y(BUMPER_SEAM['front'] + d) for d in (0, SEAM_W)]),
    (REAR_ZONE, [Y(BUMPER_SEAM['rear'] + d) for d in (0, SEAM_W)]),
    (DECK_ZONE, [p for d in (0, SEAM_W) for p in mirrored(LID_X + d)]),
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
    if z < -1.0 and n.z < -0.3 and n.y > 0.3:  # the rear screen
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
        if 0.4 < ax < 0.9 and math.hypot(z - zw, y - yw) < ARCH_R + 0.02 and abs(n.x) < 0.8:
            return M['black']
    if n.y < -0.6 and y < -0.2:
        return M['black']
    if CABIN_ZONE(p):
        pane = pane_material(p, n)
        if pane is not None:
            return pane
    if FRONT_ZONE(p) and n.z > 0.5 and inside(GRILLE_Y, y) and ax < GRILLE_X:
        frame = ax > GRILLE_X - FRAME_W or not inside((GRILLE_Y[0] + FRAME_W, GRILLE_Y[1] - FRAME_W), y)
        return M['chrome'] if frame else M['black']
    if REAR_ZONE(p) and n.z < -0.5 and inside(TAIL_Y, y):
        if ax > TAIL_X:
            return M['amber'] if ax > TAIL_AMBER else M['tail'] if ax > TAIL_REVERSE else M['reverse']
        return M['plate'] if ax < PLATE_X and inside(PLATE_Y, y) else M['black']
    if SIDE_ZONE(p) and y > SKIRT_Y and any(abs(z - v) < SEAM_W / 2 for v in DOOR_SEAMS):
        return M['shade']
    if DECK_ZONE(p) and n.y > 0.5 and 0 < ax - LID_X < SEAM_W:
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


def lamp_unit(obj, bezel, depth):
    """A lamp as a unit of its own: the glass a little outside the panel, a bezel round the edge and sides down
    into the lamp's recess, so it has depth and is not a painted face."""

    def fn(bm, info):
        normal = sum((f.normal for f in bm.faces), Vector()).normalized()
        for v in bm.verts:
            v.co += normal * 0.006
        ring = bmesh.ops.inset_region(bm, faces=list(bm.faces), thickness=0.008, depth=0.002, use_even_offset=True)['faces']
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
    """The tail lamps are lifted out as units of their own; black holes stay in the shell. The headlamps are
    loose parts (parts.py)."""
    units = []
    test = lambda c, n, m: REAR_ZONE(c) and m in ('tail', 'reverse', 'amber')  # noqa: E731
    for s, side in ((1, 'L'), (-1, 'R')):
        t = lambda c, n, m, s=s: test(c, n, m) and c[0] * s > 0  # noqa: E731
        units.append(lamp_unit(extract(body, f'taillight_{side}', t, keep=True), 'chrome', 0.03))
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
    """A flush chrome handle in a black recess, at the rear of the door on the waist crease."""

    def fn(bm, info):
        x = surface_x(bm, s, 0.355, -0.476)
        box(bm, (x + s * 0.002, 0.355, -0.476), (0.006, 0.04, 0.19), 'black')
        box(bm, (x + s * 0.008, 0.358, -0.476), (0.01, 0.018, 0.16), 'chrome')

    edit(obj, fn)


def panels(body):
    """Doors, aprons and boot lid as parts of their own; in the game each part dents on its own."""
    parts = []
    for s, side in ((1, 'L'), (-1, 'R')):
        door = extract(body, f'body_door_{side}', is_door(s))
        door_handle(door, s)
        parts.append(door)
    front = extract(body, 'body_apron_front', lambda c, n, m: c[2] > 1.42 and c[1] < BUMPER_SEAM['front'] + SEAM_W)
    rear = extract(body, 'body_valance_rear', lambda c, n, m: c[2] < -1.6 and c[1] < BUMPER_SEAM['rear'] + SEAM_W)
    lid = extract(body, 'body_bootlid', lambda c, n, m: DECK_ZONE(c) and n.y > 0.5 and m != 'glass' and abs(c[0]) < LID_X)
    return parts + [front, rear, lid]


# --- The side: sill, side markers, fuel cap, grille and rear plate ---------------------------


def surface_x(bm, s, y, z):
    """The panel's x at (y, z) on side s, with a ray in from the side (the mesh is in the car's position)."""
    hit = BVHTree.FromBMesh(bm).ray_cast(to_blender(s * 2.0, y, z), to_blender(-s, 0, 0))[0]
    if hit is None:
        raise RuntimeError(f'no panel at y={y}, z={z}')
    return to_car(hit)[0]


def body_side(body):
    """The sill stands out a little between the wheels, an amber marker sits on each front wing, the fuel cap
    on the right rear wing, the grille gets slats and a chrome bar, and the rear plate sits in a shallow recess."""
    front_arch, rear_arch = WHEELS[0][0] - ARCH_R - 0.1, WHEELS[1][0] + ARCH_R + 0.1

    def fn(bm, info):
        plate = [f for f in bm.faces if info(f)[2] == 'plate']
        push(bm, plate, (0, 0, 0.008), wall='black')
        for s in (1, -1):
            skirt = []
            for f in bm.faces:
                c, n, m = info(f)
                if c[0] * s > 0.6 and n.x * s > 0.6 and -0.3 < c[1] < SKIRT_Y and rear_arch < c[2] < front_arch:
                    skirt.append(f)
            push(bm, skirt, (s * 0.01, 0, 0), wall='shade')
            x = surface_x(bm, s, 0.167, 1.513)
            box(bm, (x + s * 0.004, 0.167, 1.513), (0.008, 0.03, 0.03), 'amber')
        x = surface_x(bm, -1, 0.343, -1.78)
        box(bm, (x - 0.004, 0.343, -1.78), (0.008, 0.07, 0.07), 'chrome')
        # The grille: fine horizontal slats and one chrome bar across the middle, in front of the black.
        for k in range(6):
            box(bm, (0, GRILLE_Y[0] + 0.035 + k * 0.03, NOSE + 0.002), (2 * (GRILLE_X - FRAME_W), 0.006, 0.006), 'dark')
        box(bm, (0, 0.17, NOSE + 0.006), (1.0, 0.012, 0.01), 'chrome')

    edit(body, fn)
