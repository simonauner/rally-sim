"""
Karossens skal: nedre delen och kupén byggs ur tvärsnitt, slås ihop till ett nät, får hjulhus och färgfält,
och delas sedan upp i paneler (dörrar, stötfångare, baklucka) som bucklas var för sig i spelet.
"""

import math

import bmesh
import bpy
from mathutils import Vector

from common import GROUND, M, MATERIALS, TRACK, WHEELS, apply_all, box, clamp01, lerp, piecewise, set_materials, to_blender, to_car  # noqa: F401

# --- Karossens nedre del: huv, sidor, stötfångare och baklucka ------------------------------

# Främre och bakre konturen sett från sidan: hur långt fram/bak plåten går på höjden y.
# Fram: stötfångaren sticker ut med en avsats i överkanten, strålkastarna och grillen sitter indragna under huven.
FRONT = [(-0.30, 1.93), (-0.26, 1.975), (-0.10, 1.995), (0.02, 1.99), (0.04, 1.955), (0.15, 1.94), (0.21, 1.9)]
# Bak: stötfångaren sticker ut under lyktorna, som slutar i en avsats; ovanför lutar bakluckan in.
REAR = [(-0.27, -2.30), (-0.2, -2.355), (0.0, -2.365), (0.13, -2.36), (0.16, -2.325), (0.3, -2.315), (0.46, -2.3), (0.51, -2.285), (0.53, -2.255)]


def body_top(z):
    """Ovansidans mittlinje: huv, gördellinje under kupén och baklucka."""
    if z >= 0.51:
        s = (z - 0.51) / (1.9 - 0.51)
        return 0.43 - 0.22 * clamp01(s) ** 1.6
    if z >= -1.0:
        return lerp(0.44, 0.47, (0.51 - z) / 1.51)
    if z >= -1.49:
        return lerp(0.47, 0.57, ((-1.0 - z) / 0.49) ** 1.5)
    return lerp(0.57, 0.53, (-1.49 - z) / 0.76)


def hood_crown(z):
    """Ovansidans välvning: huven ligger lite lägre än skärmarnas överkant, bakluckan välvs uppåt."""
    return lerp(0.03, -0.02, clamp01((z - 0.5) / 0.4))


def body_bottom(z):
    return piecewise([(-2.36, -0.27), (-1.9, -0.32), (1.6, -0.32), (1.99, -0.30)], z)


def body_halfwidth(z):
    """Halva bredden sett ovanifrån: rundade hörn fram och bak."""
    # Skärmarna buktar ut lite kring hjulen; dörrarna är smalare.
    flare = max(clamp01(1 - abs(z - zw) / 0.6) for zw, _ in WHEELS)
    w = 0.83 + 0.015 * flare ** 0.5
    if z > 1.5:
        w *= 1 - 0.28 * clamp01((z - 1.5) / 0.49) ** 2.4
    if z < -1.95:
        w *= 1 - 0.15 * clamp01((-1.95 - z) / 0.41) ** 2
    return w


def clip_range(profile, z, front):
    """Höjdintervallet där plåten når fram (bak) till z, ur sidokonturen."""
    ys = [y / 200 for y in range(-70, 120)]
    inside = [y for y in ys if (piecewise(profile, y) >= z if front else piecewise(profile, y) <= z)]
    return (min(inside), max(inside)) if inside else None


def rounded_rect_ring(hw, bottom, top, rt, rb, k, squeeze=lambda y: 1.0, crown=0.0):
    """Sluten ring i ett tvärsnitt: rak ovansida och sida med rundade hörn (radie rt upptill, rb nertill).

    squeeze(y) skalar x på höjden y (sidorna lutar inåt), crown välver ovansidan. Punkterna fördelas
    jämnt längs omkretsen, k st, med start mitt på ovansidan.
    """
    h = top - bottom
    rt, rb = min(rt, h / 2, hw), min(rb, h / 2, hw)
    # Högra halvan som en kedja av räta linjer och kvartsbågar.
    segs = []
    segs.append(('line', (0, top), (hw - rt, top)))
    segs.append(('arc', (hw - rt, top - rt), rt, math.pi / 2, 0))
    segs.append(('line', (hw, top - rt), (hw, bottom + rb)))
    segs.append(('arc', (hw - rb, bottom + rb), rb, 0, -math.pi / 2))
    segs.append(('line', (hw - rb, bottom), (0, bottom)))
    lens = [math.dist(sg[1], sg[2]) if sg[0] == 'line' else sg[2] * math.pi / 2 for sg in segs]
    total = sum(lens)
    half = k // 2

    def at(d):
        for sg, ln in zip(segs, lens):
            if d <= ln or sg is segs[-1]:
                t = d / ln if ln > 0 else 0
                if sg[0] == 'line':
                    return lerp(sg[1][0], sg[2][0], t), lerp(sg[1][1], sg[2][1], t)
                a = lerp(sg[3], sg[4], t)
                return sg[1][0] + sg[2] * math.cos(a), sg[1][1] + sg[2] * math.sin(a)
            d -= ln
        return segs[-1][2]

    right = [at(total * i / half) for i in range(half + 1)]
    left = [(-x, y) for x, y in reversed(right[1:-1])]
    pts = []
    for x, y in right + left:
        if hw > 0:
            y += crown * max(0.0, 1 - (x / hw) ** 2) * clamp01((y - (top - 0.05)) / 0.05)
        pts.append((x * squeeze(y), y))
    return pts


def stations(z0, z1, fine_ends):
    """Snitt längs bilen, tätare nära ändarna där formen ändras snabbt."""
    zs = []
    z = z0
    while z < z1:
        zs.append(z)
        near = min(z - z0, z1 - z)
        z += 0.012 if near < fine_ends else 0.05
    zs.append(z1)
    return zs


def loft(name, rings):
    """Ett slutet skal av ringar (lika många punkter), med lock i båda ändar."""
    bm = bmesh.new()
    loops = [[bm.verts.new(to_blender(x, y, z)) for x, y in ring] for z, ring in rings]
    k = len(loops[0])
    for a, b in zip(loops, loops[1:]):
        for i in range(k):
            j = (i + 1) % k
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(loops[0])
    bm.faces.new(list(reversed(loops[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def lower_body():
    rings = []
    for z in stations(-2.355, 1.985, 0.14):
        top, bottom = body_top(z), body_bottom(z)
        r = clip_range(FRONT, z, True) if z > 1.89 else clip_range(REAR, z, False) if z < -2.23 else None
        if r:
            bottom, top = max(bottom, r[0]), min(top, r[1])
        if top - bottom < 0.01:
            mid = (top + bottom) / 2
            top, bottom = mid + 0.005, mid - 0.005
        # Lodräta sidor, en rundad axel som lutar inåt mot huven och rundade trösklar.
        shoulder = lambda y, t=top: 1 - 0.06 * clamp01((y - (t - 0.2)) / 0.2)  # noqa: E731
        rings.append((z, rounded_rect_ring(body_halfwidth(z), bottom, top, 0.12, 0.06, 64, shoulder, crown=hood_crown(z))))
    return loft('lower', rings)


# --- Kupén: vindruta, tak, bakruta och sidorutor ---------------------------------------------

# Taklinjen sett från sidan: vindrutans fot, takets framkant, takets bakkant och bakrutans fot.
ROOF = [(-1.49, 0.555), (-1.2, 0.76), (-0.91, 0.905), (-0.4, 0.92), (0.05, 0.915), (0.3, 0.68), (0.51, 0.44)]


def greenhouse():
    rings = []
    for z in stations(-1.49, 0.51, 0.0):
        base = lerp(0.44, 0.47, (0.51 - z) / 2.0) - 0.06
        top = piecewise(ROOF, z)
        if top - base < 0.02:
            top = base + 0.02
        # Smalare upptill (sidorutorna lutar inåt) och mot vindrutan.
        front = clamp01((z + 0.2) / 0.71)
        wb = lerp(0.80, 0.74, front)
        wt = lerp(0.60, 0.56, front)
        # Raka sidorutor som lutar in mot taket, rundade takkanter.
        squeeze = lambda y, b=base, t=top, wb=wb, wt=wt: lerp(1, wt / wb, clamp01((y - b) / (t - b)))  # noqa: E731
        rings.append((z, rounded_rect_ring(wb, base, top, 0.1, 0.0, 48, squeeze, crown=0.02)))
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


def build_body():
    lower = lower_body()
    cabin = greenhouse()
    bpy.ops.object.select_all(action='DESELECT')
    lower.select_set(True)
    cabin.select_set(True)
    bpy.context.view_layer.objects.active = lower
    bpy.ops.object.join()
    lower.name = 'body'
    rem = lower.modifiers.new('remesh', 'REMESH')
    rem.mode = 'VOXEL'
    rem.voxel_size = 0.03
    dec = lower.modifiers.new('decimate', 'DECIMATE')
    dec.ratio = 0.22
    apply_all(lower)
    # Hjulhusen fräses ut efter omformningen, så kanterna blir rena cirklar.
    for c in arch_cutters():
        mod = lower.modifiers.new('arch', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        mod.object = c
        apply_all(lower)
        bpy.data.objects.remove(c)
    bpy.ops.object.shade_smooth()
    return lower


# --- Färger: material per yta ----------------------------------------------------------------
#
# Färgfälten avgränsas av plan. Nätet skärs först längs planen (cut_planes), så varje yta hamnar helt
# på ena sidan och kanterna blir raka; sedan väljs material efter ytans mitt och normal.


def plane(nx, ny, nz, d):
    """Planet n·p = d i bilens koordinater, normerat."""
    n = Vector((nx, ny, nz))
    return n.normalized(), d / n.length


def above(p, pl):
    return Vector(p).dot(pl[0]) > pl[1]


def mirrored(x):
    return [plane(1, 0, 0, x), plane(-1, 0, 0, x)]


Y = lambda y: plane(0, 1, 0, y)  # noqa: E731
Z = lambda z: plane(0, 0, 1, z)  # noqa: E731

# Fronten: strålkastare med två reflektorer och en kromad mittlist, mörk grill emellan, blinkers högt i
# stötfångarens hörn, lackade kåpor över dimljusen, ett stort mörkt intag med en lackad mittstag och en
# svart läpp längst ner.
LAMP_Y, LAMP_X, LAMP_DIV, GRILLE_X = (0.085, 0.205), (0.25, 0.8), (0.45, 0.47), 0.23
BLINK_Y, BLINK_X = (-0.03, 0.012), (0.52, 0.8)
FOG_Y, FOG_X = (-0.2, -0.045), (0.4, 0.66)
INTAKE_Y, INTAKE_X, INTAKE_BAR = (-0.24, 0.0), 0.35, 0.025
LIP_Y = -0.265
# Bak: lyktor (klara nertill) och nummerplåt.
# Bak: breda lyktor direkt ovanpå stötfångaren, röda upptill och orange nertill med backljuset innerst,
# nummerplåten uppe på stötfångaren och en mörk nederkant.
TAIL_Y, TAIL_X, TAIL_AMBER, TAIL_REVERSE = (0.175, 0.34), (0.4, 0.76), 0.225, 0.52
PLATE_Y, PLATE_X = (-0.04, 0.08), 0.26
REAR_LIP_Y = -0.2
# Lyktornas överkant sluttar ner inåt, från 0,34 i hörnet till 0,30 vid innerkanten.
TAIL_TOP = plane(-0.111, 1, 0, 0.2556)  # för |x|
# Kupén: rutornas nederkant, dörrutans framkant (A-stolpen), B-stolpen, kvartsrutans överkant
# (C-stolpen), takkanten, vindrutans och bakrutans sidor.
BELT = plane(0, 1, 0.015, 0.47265)
A_LINE = plane(0, 0.45, 0.39, 0.3948)
C_LINE = plane(0, 0.36, -0.30, 0.5826)
B_PILLAR = (-0.66, -0.61)
DOOR_FRONT, QUARTER_REAR = 0.47, -1.27
ROOF_EDGE = 0.85
SCREEN_SIDE = plane(0.45, 0.09, 0, 0.3105)  # för |x|
BACKLIGHT_X, BACKLIGHT_Y = 0.52, 0.6
# Skarvar: dörrarnas fram- och bakkant och stötfångarnas överkant fram och bak.
SEAM_W = 0.012
DOOR_SEAMS = (0.78, -0.68)
BUMPER_SEAM = {'front': 0.03, 'rear': 0.155}
SIDE_ZONE = lambda c: abs(c[0]) > 0.7 and -0.3 < c[1] < 0.47  # noqa: E731
# Sidan: en svag linje längs dörrarna och skärmarna, och tröskeln (sidokjolen) under dörrarna.
CREASE_Y, SKIRT_Y = 0.2, -0.17
# Utbuktningen runt hjulhusen: en ring från hjulhusets kant och FLARE_W utåt.
ARCH_R, FLARE_W, FLARE_OUT = 0.375, 0.11, 0.022
# Bakluckans skarvar: längs ovansidan och ner mellan lyktorna och luckan till stötfångaren.
LID_X = (0.62, 0.39)
DECK_ZONE = lambda c: c[2] < -1.5 and c[1] > 0.15  # noqa: E731

FRONT_ZONE = lambda c: c[2] > 1.55  # noqa: E731
REAR_ZONE = lambda c: c[2] < -2.0  # noqa: E731
CABIN_ZONE = lambda c: -1.6 < c[2] < 0.6 and c[1] > 0.38  # noqa: E731

CUTS = [
    (FRONT_ZONE, [Y(v) for v in (*LAMP_Y, *BLINK_Y, *FOG_Y, *INTAKE_Y, LIP_Y)]
     + [p for v in (*LAMP_X, *LAMP_DIV, GRILLE_X, *BLINK_X, *FOG_X, INTAKE_X, INTAKE_BAR) for p in mirrored(v)]),
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
    """Kupén: rutor, svarta stolpar och lackat tak."""
    x, y, z = p
    ax = abs(x)
    if not above(p, BELT):
        return None
    if n.y > 0.75 and y > ROOF_EDGE:
        return M['paint']
    if n.z > 0.35:  # vindrutan, med svart ram
        return M['black'] if above((ax, y, z), SCREEN_SIDE) else M['glass']
    if n.z < -0.35:  # bakrutan
        return M['glass'] if ax < BACKLIGHT_X and y > BACKLIGHT_Y else M['paint']
    # Sidorna: svart list upptill, svart B-stolpe, kvartsrutan under C-stolpen.
    if y > ROOF_EDGE:
        return M['black']
    if B_PILLAR[1] <= z <= DOOR_FRONT:
        return M['black'] if above(p, A_LINE) else M['glass']
    if QUARTER_REAR <= z <= B_PILLAR[0]:
        return M['paint'] if above(p, C_LINE) else M['glass']
    return M['black'] if z > B_PILLAR[0] else M['paint']


def arch_distance(z, y):
    """Avståndet från närmaste hjulhus centrum, sett från sidan."""
    return min(math.hypot(z - zw, y - yw - 0.035) for zw, yw in WHEELS)


def face_material(p, n):
    x, y, z = p
    ax = abs(x)
    inside = lambda lo_hi, v: lo_hi[0] < v < lo_hi[1]  # noqa: E731
    # Hjulhusen och underredet.
    for (zw, yw), _ in zip(WHEELS, TRACK):
        if 0.45 < ax < 0.84 and math.hypot(z - zw, y - yw - 0.035) < 0.395 and abs(n.x) < 0.8:
            return M['black']
    if n.y < -0.6 and y < -0.2:
        return M['black']
    if CABIN_ZONE(p):
        pane = pane_material(p, n)
        if pane is not None:
            return pane
    # Strålkastarna och blinkersen följer hörnet en bit in på skärmen.
    if FRONT_ZONE(p) and n.z > 0.05 and z > 1.75 and ax > 0.6:
        if inside(LAMP_Y, y) and ax < 0.8:
            return M['lamp']
        if inside(BLINK_Y, y) and ax < 0.8:
            return M['amber']
    if FRONT_ZONE(p) and n.z > 0.25:
        if inside(LAMP_X, ax) and inside(LAMP_Y, y):
            return M['chrome'] if inside(LAMP_DIV, ax) else M['lamp']
        if ax < GRILLE_X and inside(LAMP_Y, y):
            return M['black']
        if inside(BLINK_X, ax) and inside(BLINK_Y, y):
            return M['amber']
        if y < LIP_Y:
            return M['black']
        if ax < INTAKE_X and inside(INTAKE_Y, y):
            return M['paint'] if ax < INTAKE_BAR else M['dark']
        if inside(FOG_X, ax) and inside(FOG_Y, y):
            return M['shade']
    if REAR_ZONE(p) and (n.z < -0.25 or abs(n.x) > 0.5):
        if inside(TAIL_Y, y) and not above((ax, y, z), TAIL_TOP) and ax > TAIL_X[0] and (n.z < -0.25 or z < -2.15):
            if TAIL_AMBER < y < TAIL_AMBER + 0.008:
                return M['black']  # list mellan rött och orange
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


# --- Uppdelning i delar ---------------------------------------------------------------------


def face_info(obj, f):
    """Ytans mitt och normal i bilens koordinater, och materialets namn."""
    mw = obj.matrix_world
    c = to_car(mw @ f.calc_center_median())
    n = Vector(to_car(mw.to_3x3() @ f.normal))
    return c, n, MATERIALS[f.material_index][0]


def extract(obj, name, test, keep=False):
    """Flyttar (eller kopierar, keep) ytorna där test(mitt, normal, material) är sant till ett nytt objekt."""
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
        raise RuntimeError(f'{name}: inga ytor')
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
    """Drar ut ytorna `offset` (bilens koordinater) och bygger väggar emellan: en upphöjning eller,
    inåt, en försänkning. `top` byter de flyttade ytornas material."""
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
    """Kör fn(bm, info) på objektets nät; info(f) ger mitt, normal och material."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    fn(bm, lambda f: face_info(obj, f))
    bm.normal_update()
    bm.to_mesh(obj.data)
    bm.free()


def set_origin(obj):
    """Origo mitt i delen, så spelet vet vilken sida en lykta sitter på och var en lös del faller ifrån."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')


# --- Lyktor ----------------------------------------------------------------------------------


# Strålkastarnas två lampor bakom glaset: (x, y, radie) på vänster sida, speglas till höger.
HEAD_BULBS = [(0.34, 0.145, 0.045), (0.6, 0.145, 0.052)]


def bulbs(bm, s, normal):
    """Runda lysande lampor på strålkastarens kromade hus, lagda på glaset där de sitter."""
    for x, y, r in HEAD_BULBS:
        target = to_blender(s * x, y, 2.0)
        near = min(bm.verts, key=lambda v: (v.co.x - target.x) ** 2 + (v.co.z - target.z) ** 2)
        normal = near.normal.normalized()  # glaset är böjt: lampan följer glaset där den sitter
        c = near.co + normal * 0.008
        # En tunn skiva vinkelrät mot glasets normal.
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
    """En lykta som egen enhet: glaset en bit utanför plåten, en ram runt kanten och sidor ner i
    lyktans hålighet, så den har djup och inte är en målad yta. Strålkastarna (side ±1) får ett kromat
    hus med två runda lampor, som bakom klart glas."""

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
    """Strålkastare, blinkers och baklyktor lyfts ut som egna enheter; kvar i skalet blir svarta hål."""
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


# --- Paneler som bucklas var för sig ---------------------------------------------------------


def belt_y(z):
    """Sidorutornas nederkant (planet BELT) på z."""
    return 0.47265 - 0.015 * z


def is_door(s):
    def test(c, n, m):
        x, y, z = c
        if x * s < 0.55 or abs(n.x) < 0.35:
            return False
        if y < belt_y(z):
            return SKIRT_Y < y and DOOR_SEAMS[1] < z < DOOR_SEAMS[0]
        # Ramlös dörruta: från B-stolpen fram till A-stolpen, under takets list.
        return y < ROOF_EDGE and B_PILLAR[1] < z < DOOR_SEAMS[0] and not above(c, A_LINE)

    return test


def door_handle(obj, s):
    """Handtag i en svart grop, i dörrens bakkant under gördellinjen."""

    def fn(bm, info):
        target = Vector(to_blender(s * 0.84, 0.32, -0.47))
        x = to_car(min(bm.verts, key=lambda v: (v.co - target).length).co)[0]
        box(bm, (x + s * 0.002, 0.32, -0.47), (0.006, 0.055, 0.17), 'black')
        box(bm, (x + s * 0.01, 0.325, -0.47), (0.014, 0.024, 0.14), 'paint', side_mat='shade')

    edit(obj, fn)


def front_bumper(obj):
    """Intaget försänkt med galler, kåporna över dimljusen upphöjda, läppen utdragen framåt."""

    def fn(bm, info):
        intake = [f for f in bm.faces if info(f)[2] == 'dark' and abs(info(f)[0][0]) < INTAKE_X]
        push(bm, intake, (0, 0, -0.05), wall='black', top='black')
        for i in range(5):
            y = INTAKE_Y[0] + 0.03 + i * 0.045
            box(bm, (0, y, 1.955), (2 * INTAKE_X - 0.02, 0.01, 0.012), 'dark')
        fog = [f for f in bm.faces if info(f)[2] == 'shade' and info(f)[1].z > 0.25 and FOG_Y[0] < info(f)[0][1] < FOG_Y[1]]
        push(bm, fog, (0, 0, 0.012), top='paint', wall='shade')
        lip = [f for f in bm.faces if info(f)[2] == 'black' and info(f)[0][1] < LIP_Y and info(f)[1].z > 0.25]
        push(bm, lip, (0, -0.005, 0.03), wall='black')

    edit(obj, fn)


def rear_bumper(obj):
    """Plåten i en grund grop, en mörk diffusor längst ner."""

    def fn(bm, info):
        plate = [f for f in bm.faces if info(f)[2] == 'plate']
        push(bm, plate, (0, 0, 0.008), wall='black')
        lip = [f for f in bm.faces if info(f)[2] == 'black' and info(f)[0][1] < REAR_LIP_Y and info(f)[1].z < -0.25]
        push(bm, lip, (0, 0, 0.02), wall='black')

    edit(obj, fn)


def panels(body):
    """Dörrar, stötfångare och baklucka som egna delar; i spelet bucklas varje del för sig."""
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
        lambda c, n, m: c[2] < -1.49 and c[1] > BUMPER_SEAM['rear'] + SEAM_W and m != 'glass'
        and (abs(c[0]) < LID_X[1] or (abs(c[0]) < LID_X[0] and n.y > 0.5)),
    )
    return parts + [front, rear, lid]


# --- Sidan: utbuktade hjulhus, tröskel, sidoblinkers och tanklock ---------------------------


def flare(obj):
    """Skärmarna buktar ut runt hjulhusen: plåten närmast hålet förskjuts utåt och planar ut mot
    FLARE_W, så kanten mot hålet blir en tydlig läpp. Förskjutningen räknas per hörn ur läget, så den
    blir lika i alla delar (skärm, dörr, stötfångare) och skarvarna möts."""
    mw = obj.matrix_world

    def densify(bm, info):
        # Glest nät ger spetsiga trianglar när bara några hörn flyttas: dela kanterna kring hjulhusen.
        for _ in range(2):
            near = []
            for e in bm.edges:
                if e.calc_length() < 0.035:
                    continue
                x, y, z = to_car(mw @ ((e.verts[0].co + e.verts[1].co) / 2))
                if abs(x) > 0.55 and y < 0.32 and arch_distance(z, y) < ARCH_R + FLARE_W + 0.05:
                    near.append(e)
            bmesh.ops.subdivide_edges(bm, edges=near, cuts=1, use_grid_fill=True)
            bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])

    edit(obj, densify)
    inv = mw.inverted()
    for v in obj.data.vertices:
        x, y, z = to_car(mw @ v.co)
        if abs(x) < 0.6 or y > 0.3:
            continue
        d = arch_distance(z, y) - ARCH_R
        if d < -0.01 or d > FLARE_W:
            continue
        k = (1 - clamp01(d / FLARE_W)) ** 1.5 * clamp01((abs(x) - 0.6) / 0.15)
        p = to_blender(x + math.copysign(FLARE_OUT * k, x), y, z)
        v.co = inv @ p


def surface_x(bm, s, y, z):
    """Plåtens x vid (y, z) på sidan s, från närmaste hörn."""
    target = Vector(to_blender(s * 0.84, y, z))
    return to_car(min(bm.verts, key=lambda v: (v.co - target).length).co)[0]


def body_side(body):
    """Tröskeln sticker ut lite mellan hjulen, en orange sidoblinkers sitter på framskärmen bakom
    hjulhuset och tanklocket på höger bakskärm."""
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
        x = surface_x(bm, -1, 0.33, -1.17)
        box(bm, (x - 0.002, 0.33, -1.17), (0.004, 0.11, 0.12), 'paint', side_mat='shade')

    edit(body, fn)
