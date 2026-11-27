"""
Bygger Ljung 1600 S i Blender och sparar ljung1600.blend bredvid skriptet.

    blender -b --factory-startup -P blender/ljung1600/build.py
    blender -b --factory-startup -P blender/ljung1600/build.py -- ljung2000   # blender/ljung2000/ljung2000.blend

Ljung 2000 16V är samma kaross och hjulbas, breddad så att hjulhusen hamnar över dess bredare spårvidd
(1,48 m i stället för 1,40 m); fälgen flyttas men behåller sin form.

Skriptet ger en första version. Därefter är .blend-filen källan: redigera den i Blender och kör
blender/export.py för att föra över den till spelet. Kör bara om det här skriptet om du vill börja om.

Koordinater: allt räknas i bilens koordinater (x = vänster, y = upp, z = framåt, origo i tyngdpunkten)
och läggs in i Blender som X = x, Y = -z, Z = y, så bilen pekar mot -Y som i Blenders framvy.
Marken ligger på y = -0,503 och hjulens centrum på y ≈ -0,21 när bilen står still i spelet.

Förebilden är en liten tredörrars halvkombi från 80-talet: kort huv som sluttar mot fronten, lång dörr,
bred C-stolpe och nästan lodrät baklucka. Längder och höjder är uppmätta på en bild rakt från sidan,
skalad efter spelets hjulbas på 2,40 m (en aning kortare än förebildens), så bilen blir 3,74 m lång
över stötfångarna och 1,61 m bred. Karossen är skalet; lyktor, grill, stötfångare och fälgar är egna delar.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from simplify import simplify  # noqa: E402

GROUND = -0.503
WHEELS = [(0.912, -0.203), (-1.488, -0.229)]  # (z, y) fram och bak
TRACK = [0.70, 0.69]
TYRE_R = 0.29

# Materialen, i samma ordning som paletten i src/render/models/model.ts.
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
    ('shade', (0.14, 0.17, 0.26)),  # skarvar: lacken i skugga
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


# --- Skalet: huv, sidor, bakparti ------------------------------------------------------------

# Plåtens främre och bakre kontur sett från sidan (y, z). Fronten är nästan lodrät under huvens framkant,
# med lyktorna och grillen i en svart panel; stötfångaren (egen del) ligger utanpå nertill. Bak är
# bakpanelen lodrät under bakluckans knä.
FRONT = [(-0.15, 1.46), (-0.08, 1.53), (0.0, 1.55), (0.2, 1.552), (0.235, 1.54), (0.25, 1.52)]
REAR = [(-0.15, -1.93), (-0.08, -2.03), (0.0, -2.062), (0.3, -2.068), (0.47, -2.068)]
NOSE, TAIL = 1.552, -2.068

COWL = 0.454  # vindrutans fot (z)
BELT_REAR = -1.565  # gördellinjens bakände, där bakluckan tar vid


def belt(z):
    """Gördellinjen stiger en aning bakåt (kilform)."""
    return lerp(0.425, 0.458, clamp01((COWL - z) / (COWL - BELT_REAR)))


def body_top(z):
    """Ovansidans mittlinje: huven välver ner mot fronten, bakom vindrutan gördellinjen."""
    if z >= COWL:
        return piecewise([(COWL, 0.425), (0.627, 0.39), (1.108, 0.319), (1.45, 0.262), (NOSE, 0.235)], z)
    return belt(z)


def body_bottom(z):
    return piecewise([(TAIL, -0.10), (-1.95, -0.17), (-1.8, -0.23), (1.3, -0.23), (NOSE, -0.12)], z)


def body_halfwidth(z):
    """Halva bredden sett ovanifrån: raka sidor, nosen och bakpartiet drar in en aning."""
    w = 0.805
    if z > 1.35:
        w *= 1 - 0.07 * clamp01((z - 1.35) / (NOSE - 1.35)) ** 2
    if z < -1.85:
        w *= 1 - 0.05 * clamp01((-1.85 - z) / (-1.85 - TAIL)) ** 2
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
    segs = [
        ('line', (0, top), (hw - rt, top)),
        ('arc', (hw - rt, top - rt), rt, math.pi / 2, 0),
        ('line', (hw, top - rt), (hw, bottom + rb)),
        ('arc', (hw - rb, bottom + rb), rb, 0, -math.pi / 2),
        ('line', (hw - rb, bottom), (0, bottom)),
    ]
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
    for z in stations(TAIL, NOSE, 0.16):
        top, bottom = body_top(z), body_bottom(z)
        r = clip_range(FRONT, z, True) if z > 1.45 else clip_range(REAR, z, False) if z < -1.92 else None
        if r:
            bottom, top = max(bottom, r[0]), min(top, r[1])
        if top - bottom < 0.01:
            mid = (top + bottom) / 2
            top, bottom = mid + 0.005, mid - 0.005
        # Sidorna är nästan lodräta; axeln över sidolisten drar in mot huven och gördellinjen.
        shoulder = lambda y, t=top: 1 - 0.03 * clamp01((y - (t - 0.14)) / 0.14)  # noqa: E731
        rings.append((z, rounded_rect_ring(body_halfwidth(z), bottom, top, 0.05, 0.06, 64, shoulder, crown=0.015)))
    return loft('lower', rings)


# --- Kupén: sluttande vindruta, platt tak, bred C-stolpe och brant baklucka ------------------

# Takets och bakluckans kontur (z, y): vindrutan från gördellinjen upp till taket, taket nästan platt,
# bakluckan brant ner till knät ovanför baklyktorna och sedan lodrät.
ROOF = [(TAIL, 0.462), (-2.02, 0.52), (-1.969, 0.56), (-1.75, 0.706), (-1.62, 0.8), (-1.546, 0.835), (-1.45, 0.85),
        (-0.623, 0.858), (-0.15, 0.85), (-0.06, 0.838), (0.0, 0.81), (COWL, 0.425)]
ROOF_FRONT, ROOF_REAR = -0.036, -1.546


def greenhouse():
    rings = []
    for z in stations(TAIL, COWL, 0.0):
        base = body_top(z) - 0.04
        top = piecewise(ROOF, z)
        if top - base < 0.02:
            top = base + 0.02
        # Sidorutorna lutar tydligt inåt; kupén smalnar lite mot vindrutan men breddas i bakluckan, så
        # bakrutan blir nästan lika bred som karossen.
        front = clamp01((z + 0.1) / 0.55)
        rear = clamp01((-1.5 - z) / 0.5)
        wb = 0.75 - 0.03 * front + 0.03 * rear
        wt = 0.62 - 0.04 * front + 0.07 * rear
        squeeze = lambda y, b=base, t=top, wb=wb, wt=wt: lerp(1, wt / wb, clamp01((y - b) / (t - b)))  # noqa: E731
        rings.append((z, rounded_rect_ring(wb, base, top, 0.07, 0.0, 48, squeeze, crown=0.015)))
    return loft('greenhouse', rings)


ARCH_R = 0.335  # hjulhusets öppning; plastbreddaren runt den är svart ut till FLARE_R
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
    rem.voxel_size = 0.02
    dec = lower.modifiers.new('decimate', 'DECIMATE')
    dec.ratio = 0.16
    apply_all(lower)
    # Hjulhusen och baklyktornas fickor fräses ut efter omformningen, så kanterna blir rena.
    for c in [*arch_cutters(), *tail_pockets()]:
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


def line_plane(a, b, x_axis=False):
    """Planet genom linjen a–b i (z, y) (eller (|x|, y) med x_axis), normal uppåt-framåt (utåt)."""
    (u0, y0), (u1, y1) = a, b
    nu, ny = y1 - y0, u0 - u1
    if ny < 0:
        nu, ny = -nu, -ny
    return plane(nu, ny, 0, nu * u0 + ny * y0) if x_axis else plane(0, ny, nu, nu * u0 + ny * y0)


def flip_x(pl):
    return plane(-pl[0].x, pl[0].y, pl[0].z, pl[1])


Y = lambda y: plane(0, 1, 0, y)  # noqa: E731
Z = lambda z: plane(0, 0, 1, z)  # noqa: E731

# Kupén: rutornas underkant följer gördellinjen; takkanten, vindrutans och bakrutans kanter och stolparna.
BELT = line_plane((COWL, 0.432), (BELT_REAR, 0.466))
WINDOW_TOP = 0.79
# A-stolpen är lackad, med svart gummilist mot dörrutan; dörrutans framkant är parallell med vindrutan.
A_LINE = line_plane((0.339, 0.432), (-0.087, WINDOW_TOP))
A_FRAME = line_plane((0.357, 0.432), (-0.069, WINDOW_TOP))
# Den breda C-stolpen: kvartsrutans bakkant lutar framåt uppåt.
C_LINE = line_plane((-1.56, 0.47), (-1.24, WINDOW_TOP))
C_GLASS = line_plane((-1.545, 0.47), (-1.225, WINDOW_TOP))
B_PILLAR, B_FRAME = (-0.72, -0.637), (-0.734, -0.623)
# Vindrutans sidokant följer kupéns hörn på ett fast avstånd, så A-stolpen blir lika bred hela vägen.
SCREEN_SIDE = plane(1, 0, 0.0714, 0.5524)
SCREEN_FRAME = plane(1, 0, 0.0714, 0.5684)
# Bakrutan i bakluckan, smalare upptill, med svart list runt om; under den lackad plåt.
BACKLIGHT_SIDE = line_plane((0.66, 0.58), (0.56, 0.83), x_axis=True)
BACKLIGHT_FRAME = line_plane((0.675, 0.58), (0.575, 0.83), x_axis=True)
BACKLIGHT_Y = (0.585, 0.83)
# Skarvar: dörrarna, huven och bakluckan.
SEAM_W = 0.01
DOOR_SEAMS = (0.477, -0.676)
HOOD_SEAM_X = 0.7
COWL_PANEL = 0.5  # svart plastpanel mellan huven och vindrutan
# Bakluckans sidoskarvar följer baklyktornas lutande innerkant ner till den vågräta skarven nertill.
HATCH_IN = line_plane((0.518, 0.27), (0.603, 0.456), x_axis=True)
HATCH_OUT = line_plane((0.518 + SEAM_W, 0.27), (0.603 + SEAM_W, 0.456), x_axis=True)
HATCH_SEAM_Y = 0.07
# Sidan: en skuggad veckad linje, en svart skyddslist och svarta trösklar.
CREASE_Y = (0.214, 0.222)
MOLDING_Y = (-0.028, 0.049)
SILL_Y = -0.153
# Fronten: svart panel bakom lyktorna och grillen, under huvens framkant.
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
    # Rutornas plan skär bara där rutorna finns: plan som fortsätter över taket ger smala flisor som
    # gallringen (simplify) slår ihop till spetsar.
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
    """Kupén: rutor med svarta lister, lackade stolpar och tak."""
    x, y, z = p
    ax = abs(x)
    q = (ax, y, z)
    if not above(p, BELT):
        return None
    # Vindrutan och bakrutan avgränsas bara av planen, så kanterna mot stolparna blir raka.
    if z > ROOF_FRONT and not above(q, SCREEN_SIDE):
        return M['glass']
    if z < ROOF_REAR and not above(q, BACKLIGHT_FRAME):
        if BACKLIGHT_Y[0] < y < BACKLIGHT_Y[1] and not above(q, BACKLIGHT_SIDE):
            return M['glass']
        if BACKLIGHT_Y[0] - 0.015 < y < BACKLIGHT_Y[1] + 0.012:
            return M['black']
        return M['paint']
    # Sidorna: rutorna under takkanten med svarta lister; taket och stolparna lackade.
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
    # Hjulhusen.
    for zw, yw in WHEELS:
        if 0.45 < ax < 0.83 and math.hypot(z - zw, y - yw) < ARCH_R + 0.02 and abs(n.x) < 0.8:
            return M['black']
    if CABIN_ZONE(p):
        pane = pane_material(p, n)
        if pane is not None:
            return pane
    # Den svarta panelen i fronten bakom lyktorna och grillen.
    if FRONT_ZONE(p) and z > 1.5 and PANEL_Y[0] < y < PANEL_Y[1] and ax < PANEL_X and n.z > 0.5:
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


# --- Lösa detaljer ---------------------------------------------------------------------------


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
    """En del av lådor [(material, (x0, x1), (y0, y1), (z0, z1))], prismor [(material, [(x, z), ...], (y0, y1))]
    med en konvex grundyta sett ovanifrån (eller [(material, [(x, y), ...], (z0, z1), 'z')] sedda bakifrån) och
    runda skivor längs z [(material, (x, y), r, (z0, z1))], i bilens koordinater, med origo i `at`."""
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
    """Cylinder längs bilens z (framåt) med centrum i `at`."""
    bm = bmesh.new()
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=length)
    bmesh.ops.rotate(bm, cent=Vector(), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'), verts=res['verts'])
    return new_object(name, bm, [mat], at)


# Strålkastarna: två runda lyktor per sida i den svarta panelen, en stor ytterst och en mindre innanför,
# var och en i en svart ring. Grillen med täta vågräta lameller går mellan de yttre lyktorna, bakom de
# inre. Mätt på en bild rakt framifrån.
LAMP_Y = 0.132
LAMPS = [(0.584, 0.098), (0.358, 0.074)]  # (x, radie)
LAMP_FACE = 1.566
GRILLE_X, GRILLE_Y = 0.48, (0.05, 0.212)


def headlamp(s, side):
    discs = []
    for x, r in LAMPS:
        discs.append(('black', (s * x, LAMP_Y), r + 0.013, (1.52, LAMP_FACE - 0.004)))
        discs.append(('lamp', (s * x, LAMP_Y), r, (1.52, LAMP_FACE)))
    return assembly(f'headlamp_{side}', (s * 0.48, LAMP_Y, 1.55), [], discs=discs)


def grille():
    y0, y1 = GRILLE_Y
    face = 1.562
    boxes = [('black', (-GRILLE_X, GRILLE_X), (y0, y1), (1.52, face - 0.01))]
    # Vågräta lameller.
    n = 6
    for i in range(n):
        y = lerp(y0 + 0.015, y1 - 0.015, i / (n - 1))
        boxes.append(('dark', (-GRILLE_X + 0.01, GRILLE_X - 0.01), (y - 0.007, y + 0.007), (1.52, face - 0.004)))
    # Märket mitt i grillen: en enkel rund kromad bricka.
    discs = [('chrome', (0, (y0 + y1) / 2), 0.04, (1.52, face + 0.004))]
    return assembly('grille', (0, (y0 + y1) / 2, 1.55), boxes, discs=discs)


# Stötfångarna: svarta, raka över fronten och bakpanelen och vikta runt hörnen bakåt (framåt) till
# hjulhusen, med en mörkgrå skyddslist i mitten av framsidan. Bakre sitter högre än den främre.
BUMPER_HALF, BUMPER_DEPTH, BUMPER_R = 0.815, 0.075, 0.09
FRONT_BUMPER_Y, REAR_BUMPER_Y = (-0.128, 0.017), (-0.032, 0.107)
FRONT_SPOILER_Y, FRONT_LIP_Y = (-0.245, -0.125), (-0.33, -0.24)


def bumper(name, z_face, z_end, ys, half=BUMPER_HALF):
    """En U-formad stötfångare: framsidan i z_face, sidorna bakåt till z_end."""
    d = 1 if z_face > z_end else -1
    h, r = half, BUMPER_R
    # Banan sett ovanifrån (x, z) med utåtriktad normal, från höger sida runt till vänster.
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
    # Tvärsnittet (utåt, y): nederkanten drar in, framsidan med list, ovansidan lutar in mot plåten.
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
    return new_object(name, bm, ['black', 'dark'], at)


# Baklyktorna: trapetser i bakpartiets hörn under bakluckans knä, i en svart ram. Innerkanten lutar inåt
# nedåt (bakluckan går ner mellan dem). Övre raden: backljus innanför och gul blinkers ytterst; nedre raden
# tre röda fält. Mätt på närbilder rakt bakifrån. Lyktan sitter i en ficka som fräses ur karossens hörn
# (tail_pockets) och fyller den, så att den viker runt hörnet och sidan blir glas fram till fickans kant.
TAIL_Y = (0.27, 0.456)
TAIL_SPLIT, TAIL_FACE = 0.366, -2.07
TAIL_POCKET = -2.0  # fickans framkant (z): så långt fram längs sidan som lyktan når
TAIL_TOP_SPLIT = 0.656  # mellan backljuset och blinkersen (x)
TAIL_BOTTOM_SPLITS = (0.618, 0.706)  # mellan de röda fälten
TAIL_GAP, TAIL_RIM = 0.004, 0.007


def tail_inner(y):
    """Lyktans innerkant (x) på höjden y: 0,53 nertill, 0,615 upptill."""
    return lerp(0.53, 0.615, (y - TAIL_Y[0]) / (TAIL_Y[1] - TAIL_Y[0]))


def tail_pockets():
    """Fräsar för baklyktornas fickor: lyktans form med ram, från innerkanten ut förbi sidan."""
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
    # Ytterkanten följer sidan där fickan börjar, så lyktans sida ligger i jämnhöjd med plåten framför.
    ox0, ox1 = (surface_x(body, y, TAIL_POCKET + 0.005) for y in (y0, y1))
    outer = lambda y: lerp(ox0, ox1, (y - y0) / (y1 - y0))  # noqa: E731

    def cell(mat, x0, x1, ya, yb, z0=TAIL_FACE):
        """Ett fält mellan x0 och x1 (tal, eller funktioner av y för de lutande kanterna)."""
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


# Backspegeln: en svart triangulär fot i dörrutans framhörn, en kort arm och ett rundat hus som smalnar
# av framåt, med spegelglaset bakåt.
MIRROR_FOOT = (0.33, 0.2)  # fotens fram- och bakkant (z) på gördellinjen
MIRROR_HOUSING = ((0.79, 0.925), (0.44, 0.535), (0.2, 0.275))  # x, y, z (bak, fram)


def mirror(body, s, side):
    bm = bmesh.new()
    (hx0, hx1), (hy0, hy1), (hz0, hz1) = MIRROR_HOUSING
    at = (s * (hx0 + hx1) / 2, (hy0 + hy1) / 2, (hz0 + hz1) / 2)

    def v(x, y, z):
        return bm.verts.new(to_blender(s * x - at[0], y - at[1], z - at[2]))

    def faces(rings, mats):
        """Ringar i ordning (lika många punkter); lock i båda ändar med första och sista materialet."""
        k = len(rings[0])
        for a, b, m in zip(rings, rings[1:], mats[1:-1]):
            for i in range(k):
                j = (i + 1) % k
                bm.faces.new((a[i], a[j], b[j], b[i])).material_index = m
        bm.faces.new(rings[0]).material_index = mats[0]
        bm.faces.new(list(reversed(rings[-1]))).material_index = mats[-1]

    # Foten: en tresidig kil som står på dörren, högst framtill mot A-stolpen.
    zf, zb = MIRROR_FOOT
    by = belt((zf + zb) / 2)
    root = surface_x(body, by - 0.03, (zf + zb) / 2) - 0.015
    tri = lambda x: [v(x, by - 0.01, zf), v(x, by + 0.08, zf), v(x, by - 0.01, zb)]  # noqa: E731
    faces([tri(root), tri(root + 0.035)], [0, 0, 0])
    # Armen ut till huset.
    ay, az = by + 0.035, hz0 + 0.04
    arm = lambda x: [v(x, ay, az + 0.015), v(x, ay + 0.025, az + 0.015), v(x, ay + 0.025, az - 0.015), v(x, ay, az - 0.015)]  # noqa: E731
    faces([arm(root + 0.03), arm(hx0 + 0.03)], [0, 0, 0])

    # Huset: rundad rektangel sett bakifrån (x, y), smalare och lägre framtill.
    def outline(shrink):
        cx, cy = (hx0 + hx1) / 2, (hy0 + hy1) / 2
        w, h, r = (hx1 - hx0) / 2 - shrink, (hy1 - hy0) / 2 - shrink * 0.6, 0.03
        pts = []
        for cxs, cys, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
            # Innerhörnet mot dörren är skarpare än det yttre.
            rr = r if cxs > 0 else 0.012
            for i in range(5):
                a = math.radians(a0 + 90 * i / 4)
                pts.append((cx + cxs * (w - rr) + rr * math.cos(a), cy + cys * (h - rr) + rr * math.sin(a)))
        return pts

    rings = [[v(x, y, z) for x, y in outline(sh)] for z, sh in ((hz0, 0.0), (hz0 + 0.03, 0.0), (hz1, 0.022))]
    glass = [v(x, y, hz0 - 0.004) for x, y in outline(0.012)]
    faces([*rings], [0, 0, 0, 0])
    # Spegelglaset bakåt, en aning innanför husets kant.
    bm.faces.new(list(reversed(glass))).material_index = 1
    return new_object(f'mirror_{side}', bm, ['black', 'dark'], at)


def flare(body, zw, yw, s, name):
    """Svart plastbreddare runt hjulhuset: en båge från tröskeln över hjulet, som sticker ut från sidan."""
    bm = bmesh.new()
    at = (s * 0.8, yw, zw)
    rings = []
    n = 24
    for i in range(n + 1):
        a = math.radians(lerp(-8, 188, i / n))
        c, sn = math.cos(a), math.sin(a)
        # Under tröskeln finns ingen sida att mäta mot; där följer bågen tröskelns sida.
        x0 = surface_x(body, max(yw + (FLARE_R - 0.012) * sn, -0.14), zw + (FLARE_R - 0.012) * c) - 0.006
        x1 = x0 + 0.03
        ring = [(x0, ARCH_R - 0.004), (x1, ARCH_R + 0.006), (x1, FLARE_R - 0.012), (x0, FLARE_R)]
        rings.append([bm.verts.new(to_blender(s * x - at[0], r * sn, r * c)) for x, r in ring])
    for a, b in zip(rings, rings[1:]):
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    return new_object(name, bm, ['black'], at)


MUFFLER_X, MUFFLER_Z, MUFFLER_R = 0.42, (-1.72, -1.98), 0.075


def surface_x(body, y, z):
    """Var karossens sida ligger (x) på höjden y vid z, mätt med en stråle utifrån."""
    hit, loc, _, _ = body.ray_cast(to_blender(2, y, z), Vector((-1, 0, 0)))
    assert hit, f'ingen kaross vid y={y}, z={z}'
    return loc.x


def floor_y(body, x, z):
    """Var golvet ligger (y) under x, z, mätt med en stråle nerifrån."""
    hit, loc, _, _ = body.ray_cast(to_blender(x, -1, z), Vector((0, 0, 1)))
    assert hit, f'inget golv vid x={x}, z={z}'
    return loc.z


def details(body):
    objs = [grille()]
    for s, side in ((1, 'L'), (-1, 'R')):
        objs.append(headlamp(s, side))
        objs.append(taillamp(body, s, side))
        objs.append(mirror(body, s, side))
        z = -0.522
        x = surface_x(body, 0.32, z)
        objs.append(assembly(f'handle_{side}', (s * x, 0.32, z), [('black', mirror_x((x - 0.01, x + 0.012), s), (0.305, 0.335), (z - 0.1, z + 0.1))]))
        # Sidoblinkers på framskärmen bakom hjulhuset.
        x = surface_x(body, 0.169, 0.541)
        objs.append(assembly(f'sidemarker_{side}', (s * x, 0.169, 0.541), [('amber', mirror_x((x - 0.01, x + 0.006), s), (0.16, 0.178), (0.52, 0.56))]))
        # Blinkers i den främre stötfångaren, ytterst.
        objs.append(assembly(f'blinker_{side}', (s * 0.66, -0.02, 1.61), [('amber', mirror_x((0.58, 0.74), s), (-0.04, 0.0), (1.58, 1.616))]))
        for (zw, yw), nm in zip(WHEELS, 'FR'):
            objs.append(flare(body, zw, yw, s, f'flare_{nm}{side}'))
            # Stänkskydd bakom hjulet, ungefär 12 cm över marken.
            objs.append(assembly(f'flap_{nm}{side}', (s * 0.7, -0.3, zw - 0.37), [('black', mirror_x((0.62, 0.78), s), (-0.38, -0.22), (zw - 0.38, zw - 0.366))]))
    objs.append(bumper('bumper_front', 1.612, 1.26, FRONT_BUMPER_Y))
    objs.append(bumper('bumper_rear', -2.132, -1.835, REAR_BUMPER_Y))
    # Spoilerläppen under den främre stötfångaren.
    # Frontspoilern under stötfångaren: svart plast i full bredd som viker runt hörnen bakåt till
    # hjulhusen, och under den en smalare läpp som går ner till ungefär 17 cm över marken.
    objs.append(bumper('spoiler_front', 1.592, 1.27, FRONT_SPOILER_Y))
    objs.append(bumper('spoiler_lip', 1.585, 1.45, FRONT_LIP_Y, half=0.62))
    objs.append(assembly('plate_front', (0, -0.1, 1.615), [('plate', (-0.24, 0.24), (-0.16, -0.04), (1.605, 1.617))]))
    # Bakre skylten sitter högt i bakluckan mellan baklyktorna, i en svart nedsänkning.
    objs.append(assembly('plate_rear', (0, 0.37, -2.072), [('black', (-0.285, 0.285), (0.3, 0.44), (-2.074, -2.06)),
                                                          ('plate', (-0.25, 0.25), (0.315, 0.425), (-2.078, -2.066))]))
    # Ljuddämparen under golvet framför bakstötfångaren; avgasröret går ut under stötfångaren.
    top = min(floor_y(body, MUFFLER_X, z) for z in MUFFLER_Z)
    y = top - MUFFLER_R + 0.01
    objs.append(cylinder_z('muffler', 'dark', (MUFFLER_X, y, sum(MUFFLER_Z) / 2), MUFFLER_R, MUFFLER_Z[0] - MUFFLER_Z[1], 16))
    objs.append(cylinder_z('exhaust', 'chrome', (MUFFLER_X, y - 0.02, (MUFFLER_Z[1] - 2.15) / 2), 0.027, MUFFLER_Z[1] + 2.15))
    return objs


# --- Fälgen: silverlackerad stålfälg med en ring av runda hål och svart navkapsel --------------
#
# Byggs runt hjulets axel (bilens x) med origo i hjulets centrum och ser likadan ut från båda sidor, så
# samma fälg passar alla fyra hjul. Spelet sätter den i ett ihåligt däck med innerradien 0,205 m.

RIM_R, LIP_W, RIM_FACE = 0.215, 0.02, 0.105
DISH = (0.07, 0.08)  # fälgskålens djup (x) innanför kanten
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

    tube(RIM_R - 0.024, RIM_R - 0.017, -RIM_FACE + 0.01, RIM_FACE - 0.01, D)  # trumman bakom skålen
    for s in (1, -1):
        a0, a1 = sorted((s * (RIM_FACE - LIP_W), s * RIM_FACE))
        tube(RIM_R - LIP_W, RIM_R, a0, a1, C)
        # Skålen: en silverskiva en bit innanför kanten, med hålen som svarta brickor strax utanpå.
        d0, d1 = sorted((s * DISH[0], s * DISH[1]))
        disc(RIM_R - 0.018, d0, d1, C, 32)
        h0, h1 = sorted((s * DISH[1], s * (DISH[1] + 0.002)))
        for k in range(HOLES):
            phi = 2 * math.pi * k / HOLES
            disc(HOLE_R, h0, h1, B, 10, (HOLE_AT * math.cos(phi), HOLE_AT * math.sin(phi)))
        # Navkapseln: en svart kupol (låg skiva) mitt på skålen.
        c0, c1 = sorted((s * DISH[1], s * (DISH[1] + 0.02)))
        disc(CAP_R, c0, c1, B)
        m0, m1 = sorted((s * (DISH[1] + 0.02), s * (DISH[1] + 0.026)))
        disc(0.03, m0, m1, D, 16)
    return new_object('rim', bm, mats, (TRACK[0], WHEELS[0][1], WHEELS[0][0]))


def reference(wheels, track, tyre_r, ground):
    """Hjul och mark att modellera mot. Exporteras inte."""
    coll = bpy.data.collections.new('Reference')
    bpy.context.scene.collection.children.link(coll)
    for (zw, yw), xw in zip(wheels, track):
        for s in (1, -1):
            # Ihåligt däck, så fälgen syns i det.
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


# Ljung 2000 16V: hjulens läge i vila i spelet (z, y), spårvidd, däckets radie och marken.
VARIANTS = {
    'ljung1600': (WHEELS, TRACK, TYRE_R, GROUND),
    'ljung2000': ([(0.936, -0.205), (-1.464, -0.222)], [0.74, 0.73], 0.3, -0.512),
}


def warp(wheels, track):
    """Avbildningen (bilens koordinater) som flyttar Ljung 1600:s hjul till `wheels`/`track`: längs bilen
    förskjuten (och skalad efter hjulbasen, om den skiljer), i sidled skalad efter spårvidden och i höjd så
    att båda axlarna hamnar rätt."""
    (zf, yf), (zr, yr) = WHEELS
    (zf2, yf2), (zr2, yr2) = wheels
    a = (zf2 - zr2) / (zf - zr)
    b = track[0] / TRACK[0]
    dyf, dyr = yf2 - yf, yr2 - yr

    def f(p):
        x, y, z = p
        return Vector((b * x, y + lerp(dyr, dyf, (z - zr) / (zf - zr)), zf2 + (z - zf) * a))
    return f


def apply_warp(objs, f):
    """Töjer delarnas nät; panelerna (body) behåller origo i bilens origo, övriga delar flyttas med."""
    # matrix_world räknas om först när scenen uppdateras; annars står nyss skapade delar kvar i origo.
    bpy.context.view_layer.update()
    for obj in objs:
        mw = obj.matrix_world.copy()
        at = Vector((0, 0, 0)) if obj.name == 'body' else f(to_car(mw.translation))
        for v in obj.data.vertices:
            v.co = to_blender(*(f(to_car(mw @ v.co)) - at))
        obj.matrix_world = Matrix.Translation(to_blender(*at))


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    name = args[0] if args else 'ljung1600'
    wheels, track, tyre_r, ground = VARIANTS[name]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    export = bpy.data.collections.new('Export')
    bpy.context.scene.collection.children.link(export)
    body = build_body()
    cut_planes(body)
    assign_materials(body, face_material)
    simplify(body, 0.3)
    wheel_rim = rim()
    parts = [body, *details(body)]
    if name != 'ljung1600':
        apply_warp(parts, warp(wheels, track))
        wheel_rim.location = to_blender(track[0], wheels[0][1], wheels[0][0])
    for obj in [*parts, wheel_rim]:
        bpy.context.scene.collection.objects.unlink(obj)
        export.objects.link(obj)
    reference(wheels, track, tyre_r, ground)
    # Fälgen även på de tre andra hjulen, bara att titta på (samma nät).
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
    print('sparade', out, len(body.data.vertices), 'hörn')


main()
