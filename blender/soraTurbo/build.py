"""
Bygger Sora 2.0 Turbo i Blender och sparar soraTurbo.blend bredvid skriptet.

    blender -b --factory-startup -P blender/soraTurbo/build.py

Skriptet ger en första version. Därefter är .blend-filen källan: redigera den i Blender och kör
blender/export.py för att föra över den till spelet. Kör bara om det här skriptet om du vill börja om.

Koordinater: allt räknas i bilens koordinater (x = vänster, y = upp, z = framåt, origo i tyngdpunkten)
och läggs in i Blender som X = x, Y = -z, Z = y, så bilen pekar mot -Y som i Blenders framvy.
Marken ligger på y = -0,486 och hjulens centrum på y = -0,17 när bilen står still i spelet.

Måtten följer förebilden (tvådörrars coupé från 1999): 4,35 m lång, 1,69 m bred, 1,405 m hög,
hjulbas 2,52 m; höjder och lägen är uppmätta på sidofoton.
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

GROUND = -0.486
WHEELS = [(1.109, -0.169), (-1.411, -0.185)]  # (z, y) fram och bak
TRACK = [0.735, 0.73]
TYRE_R = 0.31

# Materialen, i samma ordning som paletten i src/render/models/model.ts.
MATERIALS = [
    ('paint', (0.12, 0.31, 0.71)),
    ('glass', (0.17, 0.23, 0.26)),
    ('black', (0.11, 0.11, 0.11)),
    ('dark', (0.23, 0.23, 0.23)),
    ('chrome', (0.73, 0.75, 0.76)),
    ('lamp', (0.95, 0.91, 0.63)),
    ('amber', (0.91, 0.56, 0.16)),
    ('tail', (0.63, 0.09, 0.09)),
    ('reverse', (0.85, 0.83, 0.8)),
    ('plate', (0.93, 0.93, 0.92)),
    ('shade', (0.08, 0.2, 0.47)),  # skarvar: lacken i skugga
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
    """Linjär interpolation i en lista (x, y) sorterad på x."""
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x <= x1:
            return lerp(y0, y1, (x - x0) / (x1 - x0))
    return points[-1][1]


# --- Karossens nedre del: huv, sidor, stötfångare och baklucka ------------------------------

# Främre och bakre konturen sett från sidan: hur långt fram/bak plåten går på höjden y.
# Fram: stötfångaren sticker ut med en avsats i överkanten, strålkastarna och grillen sitter indragna under huven.
FRONT = [(-0.30, 1.93), (-0.26, 1.975), (-0.10, 1.995), (0.02, 1.99), (0.04, 1.955), (0.15, 1.94), (0.21, 1.9)]
REAR = [(-0.27, -2.30), (-0.15, -2.36), (0.0, -2.355), (0.2, -2.335), (0.45, -2.30), (0.53, -2.24)]


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


def apply_all(obj):
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


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
TAIL_Y, TAIL_X, TAIL_CLEAR = (0.19, 0.35), (0.38, 0.75), 0.235
PLATE_Y, PLATE_X = (-0.13, 0.0), 0.26
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
BUMPER_SEAM = {'front': 0.03, 'rear': 0.06}
SIDE_ZONE = lambda c: abs(c[0]) > 0.7 and -0.3 < c[1] < 0.47  # noqa: E731

FRONT_ZONE = lambda c: c[2] > 1.55  # noqa: E731
REAR_ZONE = lambda c: c[2] < -2.0  # noqa: E731
CABIN_ZONE = lambda c: -1.6 < c[2] < 0.6 and c[1] > 0.38  # noqa: E731

CUTS = [
    (FRONT_ZONE, [Y(v) for v in (*LAMP_Y, *BLINK_Y, *FOG_Y, *INTAKE_Y, LIP_Y)]
     + [p for v in (*LAMP_X, *LAMP_DIV, GRILLE_X, *BLINK_X, *FOG_X, INTAKE_X, INTAKE_BAR) for p in mirrored(v)]),
    (REAR_ZONE, [Y(v) for v in (*TAIL_Y, TAIL_CLEAR, *PLATE_Y)] + [p for v in (*TAIL_X, PLATE_X) for p in mirrored(v)]),
    (CABIN_ZONE, [BELT, A_LINE, C_LINE, Y(ROOF_EDGE), Y(BACKLIGHT_Y), Z(DOOR_FRONT), Z(QUARTER_REAR), *(Z(v) for v in B_PILLAR),
                  SCREEN_SIDE, plane(-0.45, 0.09, 0, 0.3105), *mirrored(BACKLIGHT_X)]),
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
        if inside(TAIL_Y, y) and ax > TAIL_X[0] and (n.z < -0.25 or z < -2.18):
            return M['reverse'] if y < TAIL_CLEAR and ax < TAIL_X[1] else M['tail']
        if ax < PLATE_X and inside(PLATE_Y, y) and n.z < -0.5:
            return M['plate']
    if SIDE_ZONE(p) and y > -0.22 and any(abs(z - v) < SEAM_W / 2 for v in DOOR_SEAMS):
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


# --- Lösa detaljer: speglar, luftintag, vinge, extraljus, stänkskydd ------------------------


def part(name, build, mat, at):
    """Ett eget objekt med origo i `at` (bilens koordinater), byggt av build(bm)."""
    bm = bmesh.new()
    build(bm)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = to_blender(*at)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(bpy.data.materials[mat])
    return obj


def box(sx, sy, sz, off=(0, 0, 0)):
    """Låda med storlek och förskjutning i bilens koordinater."""
    def build(bm):
        r = bmesh.ops.create_cube(bm, size=1)
        bmesh.ops.scale(bm, vec=Vector((sx, sz, sy)), verts=r['verts'])
        bmesh.ops.translate(bm, vec=to_blender(*off), verts=r['verts'])
    return build


def cylinder_z(r, length, segs=20, off=0.0):
    """Cylinder längs bilens z (framåt)."""
    def build(bm):
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=length)
        bmesh.ops.rotate(bm, cent=Vector(), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'), verts=res['verts'])
        bmesh.ops.translate(bm, vec=to_blender(0, 0, off), verts=res['verts'])
    return build


def details():
    objs = []
    for s, side in ((1, 'L'), (-1, 'R')):
        objs.append(part(f'mirror_{side}', box(0.15, 0.09, 0.09), 'paint', (s * 0.86, 0.54, 0.36)))
        objs.append(part(f'mirrorstalk_{side}', box(0.14, 0.03, 0.05), 'paint', (s * 0.76, 0.5, 0.38)))
        for zw, nm in ((WHEELS[0][0], 'F'), (WHEELS[1][0], 'R')):
            objs.append(part(f'flap_{nm}{side}', box(0.2, 0.16, 0.015), 'black', (s * 0.715, -0.39, zw - 0.46)))
        objs.append(part(f'handle_{side}', box(0.02, 0.03, 0.13), 'black', (s * 0.85, 0.32, -0.47)))
        # Vingens fästen står på bakluckan, en bit in från kanten.
        objs.append(part(f'wingstay_{side}', box(0.05, 0.22, 0.16), 'paint', (s * 0.55, 0.64, -2.1)))
    objs.append(part('wing', box(1.48, 0.035, 0.26), 'paint', (0, 0.765, -2.12)))
    for s, side in ((1, 'L'), (-1, 'R')):
        objs.append(part(f'wingend_{side}', box(0.02, 0.12, 0.28), 'paint', (s * 0.74, 0.735, -2.12)))
    # Upphöjt intag till laddluftkylaren på huven, med svart öppning framåt.
    objs.append(part('scoop', box(0.6, 0.08, 0.38), 'paint', (0, 0.375, 1.12)))
    objs.append(part('scoop_mouth', box(0.5, 0.05, 0.01), 'black', (0, 0.385, 1.315)))
    objs.append(part('plate_front', box(0.34, 0.06, 0.02), 'plate', (0, 0.0, 1.995)))
    objs.append(part('exhaust', cylinder_z(0.05, 0.18), 'chrome', (-0.45, -0.3, -2.33)))
    # Extraljusrampen (klass 2): fyra lampor tätt i en lackad låda på huvens framkant.
    objs.append(part('pod_body', box(0.8, 0.1, 0.22), 'paint', (0, 0.22, 1.78)))
    for i, x in enumerate((0.3, 0.1, -0.1, -0.3)):
        objs.append(part(f'pod_lamp_{i}', cylinder_z(0.09, 0.1), 'paint', (x, 0.28, 1.86)))
        objs.append(part(f'pod_lens_{i}', cylinder_z(0.075, 0.01), 'lamp', (x, 0.28, 1.915)))
    return objs


def reference():
    """Hjul och mark att modellera mot. Exporteras inte."""
    coll = bpy.data.collections.new('Reference')
    bpy.context.scene.collection.children.link(coll)
    for (zw, yw), xw in zip(WHEELS, TRACK):
        for s in (1, -1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=TYRE_R, depth=0.205)
            w = bpy.context.active_object
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
    for obj in [body, *details()]:
        bpy.context.scene.collection.objects.unlink(obj)
        export.objects.link(obj)
    reference()
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'soraTurbo.blend')
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print('sparade', out, len(body.data.vertices), 'hörn')


main()
