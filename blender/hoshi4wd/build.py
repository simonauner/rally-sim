"""
Bygger Hoshi 2.0 4WD i Blender och sparar hoshi4wd.blend bredvid skriptet.

    blender -b --factory-startup -P blender/hoshi4wd/build.py

Skriptet ger en första version. Därefter är .blend-filen källan: redigera den i Blender och kör
blender/export.py för att föra över den till spelet. Kör bara om det här skriptet om du vill börja om.

Koordinater: allt räknas i bilens koordinater (x = vänster, y = upp, z = framåt, origo i tyngdpunkten)
och läggs in i Blender som X = x, Y = -z, Z = y, så bilen pekar mot -Y som i Blenders framvy.
Marken ligger på y = -0,496 och hjulens centrum på y ≈ -0,18 när bilen står still i spelet.

Måtten följer förebilden (tredörrars liftback-coupé från 1991 med breda skärmar): 4,41 m lång,
1,745 m bred, 1,305 m hög, hjulbas 2,525 m; höjder och lägen är uppmätta på sidobilder. Strålkastarna
fälls upp ur huven och är uppfällda på modellen.
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

GROUND = -0.496
WHEELS = [(1.06, -0.179), (-1.465, -0.195)]  # (z, y) fram och bak
TRACK = [0.755, 0.755]
TYRE_R = 0.31

# Materialen, i samma ordning som paletten i src/render/models/model.ts.
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
    ('shade', (0.67, 0.67, 0.66)),  # skarvar: lacken i skugga
    ('white', (0.95, 0.95, 0.93)),  # fälgarna
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

# Främre och bakre konturen sett från sidan: hur långt fram/bak plåten går på höjden y. Nosen är låg och
# rund; huvens framkant ligger lägre än stötfångarens mest framskjutande del.
FRONT = [(-0.24, 1.94), (-0.16, 2.01), (-0.05, 2.04), (0.05, 2.045), (0.12, 2.03), (0.18, 1.99), (0.22, 1.92), (0.25, 1.84)]
REAR = [(-0.22, -2.29), (-0.12, -2.355), (0.05, -2.37), (0.25, -2.365), (0.38, -2.345), (0.45, -2.30), (0.48, -2.24)]

COWL = 0.53  # vindrutans fot (z)
HOOD_FRONT = 1.97


def hood_y(z):
    """Huvens mittlinje: lång och sluttande, rundad mot nosen."""
    s = clamp01((z - COWL) / (HOOD_FRONT - COWL))
    return 0.44 - 0.2 * s ** 1.5


def body_top(z):
    """Ovansidans mittlinje: huv, gördellinje under kupén och baklucka."""
    if z >= COWL:
        return hood_y(z)
    if z >= -1.9:
        return lerp(0.44, 0.465, (COWL - z) / (COWL + 1.9))
    return lerp(0.465, 0.445, (-1.9 - z) / 0.47)


def body_bottom(z):
    return piecewise([(-2.37, -0.2), (-1.95, -0.215), (1.65, -0.215), (2.04, -0.22)], z)


def flare(z):
    """Breda skärmar: hur mycket karossen sväller ut kring hjulen (0..1)."""
    return max(clamp01(1 - abs(z - zw) / 0.62) ** 0.7 for zw, _ in WHEELS)


def body_halfwidth(z):
    """Halva bredden sett ovanifrån: breda skärmar och rundade hörn fram och bak."""
    w = 0.83 + 0.045 * flare(z)
    if z > 1.55:
        w *= 1 - 0.26 * clamp01((z - 1.5) / 0.545) ** 2
    if z < -1.95:
        w *= 1 - 0.2 * clamp01((-1.95 - z) / 0.42) ** 2
    return w


def section(hw, bottom, top, rt, rb, side_ys=(), squeeze=lambda y: 1.0, crown=0.0, n_top=4, n_rt=5, n_rb=3):
    """Slutet tvärsnitt: rak ovansida, sida och undersida med rundade hörn (radie rt upptill, rb nertill).

    Punkterna läggs bara där formen kräver dem: n_top på ovansidan, n_rt och n_rb per hörnbåge och på
    sidan bara höjderna i side_ys, där sidan böjer sig. Lika många punkter i varje snitt, spegelvända
    kring x = 0 och med start mitt på ovansidan. squeeze(y) skalar x på höjden y, crown välver ovansidan.
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
    """Fyller ut snitten så inget mellanrum är större än step; plåten behöver hörn för bucklorna."""
    zs = sorted(zs)
    out = [zs[0]]
    for z in zs[1:]:
        n = math.ceil((z - out[-1]) / step - 1e-9)
        out += [lerp(out[-1], z, i / n) for i in range(1, n + 1)]
    return out


def loft(name, rings):
    """Ett slutet skal av ringar [(x, y, z), ...] (lika många punkter, spegelvända som i section).

    Locken i ändarna byggs av vågräta band mellan punkterna och deras spegelpunkter, så de följer en
    välvd front i stället för att bli en platt n-hörning. Dubbla punkter (hopklämda snitt) slås ihop."""
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


# Fronten och bakpartiet: de sista snitten böjs framåt (bakåt) från FRONT_FROM (REAR_FROM) ut till
# sidokonturen, så nosens rundning och stötfångarna blir jämna ytor i stället för trappsteg. Snitten
# ligger tätast där bredden sett ovanifrån svänger in mest.
NOSE, TAIL = 2.045, -2.37
FRONT_FROM, REAR_FROM = 1.55, -1.95
END_STEPS = (0, 0.3, 0.5, 0.65, 0.76, 0.85, 0.91, 0.95, 0.98, 1)
# Konturernas brytpunkter blir rader längs hela sidan, så fronten och bakpartiet får sina former;
# i mitten slår merge_flat ihop dem igen.
PROFILE_ROWS = sorted({y for y, _ in FRONT + REAR})


def lower_body():
    zs = {lerp(REAR_FROM, TAIL, s) for s in END_STEPS} | {lerp(FRONT_FROM, NOSE, s) for s in END_STEPS}
    zs |= {-1.9, COWL, 1.65}
    # De breda skärmarna sväller ut kring hjulen (flare); snitt tätare där.
    zs |= {zw + d * 0.155 for zw, _ in WHEELS for d in range(-4, 5)}
    rings = []
    for zn in fill([z for z in zs if TAIL <= z <= NOSE], 0.2):
        top, bottom = body_top(zn), body_bottom(zn)
        # Skärmarna sväller ut nertill; axeln upptill hålls smal, så sidan rundas in mot huven.
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


# --- Kupén: vindruta, tak, bakruta och sidorutor ---------------------------------------------

# Taklinjen sett från sidan: bakrutans fot, takets bakkant, takets framkant och vindrutans fot. Bakrutan
# är lång och flack (liftback), vindrutan kraftigt lutad.
ROOF = [(-1.9, 0.445), (-1.6, 0.55), (-1.3, 0.655), (-1.05, 0.74), (-0.85, 0.79), (-0.55, 0.81), (-0.25, 0.805),
        (-0.08, 0.78), (0.1, 0.705), (0.32, 0.585), (COWL, 0.44)]
ROOF_FRONT, ROOF_REAR = -0.1, -0.92


def greenhouse():
    rings = []
    # Taket och kupéns avsmalning är raka mellan brytpunkterna, så snitten läggs där. Ändarna fortsätter
    # ner i karossen, så sammanfogningen får en ren skärning vid huven och bakluckan.
    for z in fill([-1.96, *(z for z, _ in ROOF), -1.1, -0.2, COWL + 0.06], 0.3):
        base = body_top(z) - 0.06
        top = piecewise(ROOF, z) if ROOF[0][0] <= z <= ROOF[-1][0] else body_top(z) - 0.03
        # Smalare upptill (sidorutorna lutar inåt), mot vindrutan och mot bakrutans fot.
        front = clamp01((z + 0.2) / 0.73)
        rear = clamp01((-1.1 - z) / 0.8)
        wb = lerp(0.79, 0.74, front) - 0.06 * rear
        wt = lerp(0.6, 0.55, front) - 0.06 * rear
        squeeze = lambda y, b=base, t=top, wb=wb, wt=wt: lerp(1, wt / wb, clamp01((y - b) / (t - b)) ** 1.2)  # noqa: E731
        sides = [lerp(base, top, i / 3) for i in (1, 2)]  # sidorutorna böjer sig svagt (** 1.2)
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
    # Hjulhusen fräses ut efteråt, så kanterna blir rena cirklar.
    for c in arch_cutters():
        boolean(body, c, 'DIFFERENCE')
    # Urgröpningen längs nosens överkant, som strålkastarna fälls upp ur.
    bpy.ops.mesh.primitive_cube_add(size=1)
    c = bpy.context.active_object
    c.scale = (2 * RECESS_X, 0.4, 0.3)
    c.location = to_blender(0, RECESS_Y + 0.15, RECESS_Z + 0.2)
    boolean(body, c, 'DIFFERENCE')
    return body


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

# Fronten: en svart urgröpning tvärs över nosens överkant, mellan huven och stötfångaren, som
# strålkastarna fälls upp ur. I stötfångaren smala klara lampor ytterst under urgröpningen, blinkers nere
# i hörnen och ett brett luftintag med vågräta lameller.
RECESS_X, RECESS_Y, RECESS_Z, RECESS_TOP = 0.69, 0.1, 1.92, 0.23
CLEAR_Y, CLEAR_X = (0.03, 0.075), (0.42, 0.68)
BLINK_Y, BLINK_X = (-0.07, -0.02), (0.58, 0.74)
INTAKE_Y, INTAKE_X = (-0.15, -0.02), 0.5
SLATS = [-0.15 + 0.026 * i for i in range(6)]
# Bak: ett lyktband över hela bredden. Mitt på ett rött list upptill och under den en svart nisch med
# nummerplåten; på sidorna röda lyktor med ett klart backljus upptill och gula blinkers runt hörnen.
TAIL_Y, TAIL_WRAP = (0.195, 0.345), -2.2
GARNISH_X, GARNISH_Y, LAMP_IN, BLINK_OUT = 0.35, 0.29, 0.37, 0.64
NICHE_Y, PLATE_Y, PLATE_X = 0.14, (0.165, 0.265), 0.25
REVERSE_X, REVERSE_Y = (0.44, 0.59), (0.25, 0.295)
# Kupén: rutornas nederkant, dörrutans framkant (A-stolpen), B-stolpen, kvartsrutans bakkant
# (C-stolpen), takkanten, vindrutans och bakrutans sidor.
BELT = plane(0, 1, 0.015, 0.428)
A_LINE = plane(0, 0.63, 0.36, 0.43)
C_LINE = plane(0, 0.95, -0.35, 1.0)
B_PILLAR = (-0.72, -0.66)
DOOR_FRONT, QUARTER_REAR = 0.5, -1.5
ROOF_EDGE = 0.745
SCREEN_SIDE = plane(0.34, 0.16, 0, 0.29)  # för |x|
BACKLIGHT_X, BACKLIGHT_Y = 0.55, 0.49
# Skarvar: dörrarnas fram- och bakkant och stötfångarnas överkant fram och bak.
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
    """Kupén: rutor, svarta stolpar och lackat tak."""
    x, y, z = p
    ax = abs(x)
    if not above(p, BELT):
        return None
    if abs(n.x) < 0.55:
        # Ovansidan: vindrutan med svart ram, taket och den långa bakrutan.
        if z > ROOF_FRONT:
            return M['black'] if above((ax, y, z), SCREEN_SIDE) else M['glass']
        if z > ROOF_REAR:
            return M['paint']
    # Bakrutan avgränsas bara av planen, så kanten mot C-stolpen blir rak.
    if z < ROOF_REAR and ax < BACKLIGHT_X and y > BACKLIGHT_Y and n.y > 0.3:
        return M['glass']
    if abs(n.x) < 0.55 or z < QUARTER_REAR:
        return M['paint']
    # Sidorna: svart list upptill, svart B-stolpe, kvartsrutan framför C-stolpen.
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
    # Hjulhusen och underredet.
    for (zw, yw), _ in zip(WHEELS, TRACK):
        if 0.45 < ax < 0.87 and math.hypot(z - zw, y - yw - 0.035) < 0.395 and abs(n.x) < 0.8:
            return M['black']
    if CABIN_ZONE(p):
        pane = pane_material(p, n)
        if pane is not None:
            return pane
    # Urgröpningens golv och väggar; skärmens utsida strax utanför väggen förblir lackad.
    if FRONT_ZONE(p) and ax < RECESS_X + 0.005 and RECESS_Y - 0.005 < y < RECESS_TOP and z > RECESS_Z - 0.005 and n.x * math.copysign(1, x) < 0.3:
        return M['black']
    if FRONT_ZONE(p) and n.z > 0.25:
        if inside(CLEAR_X, ax) and inside(CLEAR_Y, y):
            return M['lamp']
        if inside(BLINK_X, ax) and inside(BLINK_Y, y):
            return M['amber']
        if ax < INTAKE_X and inside(INTAKE_Y, y):
            # Lamellerna: varannan rand mörkgrå.
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
    """Slår ihop ytor som ligger i samma plan och har samma färg. Snitten längs färgfälten (cut_planes)
    och konturernas rader (PROFILE_ROWS) går genom hela zonen och lämnar annars rader av hörn där inget
    byter färg eller form."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    # Två snitt i samma plan (t.ex. två färgfält som slutar på samma höjd) ger dubbla hörn och platta
    # remsor emellan, som delar ytan i skuggningen.
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=0.0001)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1), verts=bm.verts, edges=bm.edges, delimit={'MATERIAL'})
    bm.to_mesh(obj.data)
    bm.free()


# Vecken: Hoshin är rundad, så nosens och bakpartiets hörn (där sidan möter fronten, omkring 52°) ska
# skuggas mjukt; gördellinjen och kanterna kring urgröpningen är brantare.
SHARP = math.radians(60)


def mark_sharp(obj):
    """Mjuk skuggning, men vecken (kanter brantare än SHARP) skarpa, som pressad plåt. export.py ger
    hörnen på ett veck egna punkter, så spelet inte rundar av dem."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle() <= SHARP
    bm.to_mesh(obj.data)
    bm.free()


# --- Lösa detaljer: lyktor, speglar, luftintag, vinge, extraljus, stänkskydd ----------------


def part(name, build, mat, at, tilt=0.0):
    """Ett eget objekt med origo i `at` (bilens koordinater), byggt av build(bm) med materialet eller listan `mat`, lutat `tilt` rad framåt-nedåt."""
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


def tube_z(bm, r, length, segs=20, wall=0.004):
    """Öppet rör längs bilens z med centrum i origo: utsidan och mynningens kant får material 0, insidan 1.
    Ger rörets hörn."""
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


# Strålkastarnas kil sett från sidan (z, y): de reser sig ur urgröpningen längst fram, så foten står på
# dess botten, glaset sitter i nosen och ovansidan sluttar bakåt ner i huven.
POPUP_FRONT, POPUP_REAR, POPUP_W, POPUP_X = 1.95, 1.57, 0.32, 0.5
POPUP_BASE, POPUP_TOP = RECESS_Y, 0.345
POPUP_LENS = (POPUP_FRONT + 0.035, 0.265)


def popup(name, x):
    """En uppfälld strålkastare: en svart kil."""
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


# Vingen växer ur bakluckan: längs luckans kanter går två fenor som börjar platt vid bakrutans fot och
# stiger bakåt till bladet, som ligger högt över luckan med uppvikt bakkant.
WING_AT = (0, 0.5, -2.2)
FIN_START, BLADE_Z = -1.72, (-2.06, -2.32)
BLADE_TOP, BLADE_T, FIN_W = (0.535, 0.575), 0.03, 0.05


def fin_x(z):
    """Fenans ytterkant: följer luckans rundade kant inåt bakåt."""
    return body_halfwidth(z) * 0.86 - 0.02


def edge_y(z):
    """Luckans yta vid kanten, där den rundas av lägre än i mitten."""
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
        # Bladet mellan fenorna; bakkanten smalare, som luckan.
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
    objs = []
    for s, side in ((1, 'L'), (-1, 'R')):
        # Uppfällda strålkastare: en kil som står upp vid huvens framkant, med lackat lock som sluttar
        # bakåt ner i huven, svarta sidor och glaset framåt.
        x = s * POPUP_X
        objs.append(popup(f'popup_{side}', x))
        objs.append(part(f'popuplens_{side}', box(0.27, 0.11, 0.012), 'lamp', (x, POPUP_LENS[1], POPUP_LENS[0]), -0.12))
        # Backspegeln sitter på dörrens överkant vid rutans framhörn; armen går in i plåten.
        root = surface_x(body, MIRROR_ARM[0], MIRROR_ARM[1]) - 0.02
        objs.append(part(f'mirrorstalk_{side}', box(0.86 - root, 0.04, 0.06), 'black', (s * (root + 0.86) / 2, *MIRROR_ARM)))
        objs.append(part(f'mirror_{side}', box(0.14, 0.09, 0.08), 'black', (s * 0.89, MIRROR_ARM[0] + 0.05, MIRROR_ARM[1] - 0.01)))
        for zw, nm in ((WHEELS[0][0], 'F'), (WHEELS[1][0], 'R')):
            objs.append(part(f'flap_{nm}{side}', box(0.2, 0.2, 0.015), 'black', (s * 0.74, -0.31, zw - 0.47)))
        objs.append(part(f'handle_{side}', box(0.02, 0.03, 0.13), 'black', (s * 0.835, 0.33, -0.5)))
        # Vingen på bakluckan: fästen en bit in från kanten och gavlar i ändarna.
    objs.append(part('wing', wing(), 'paint', WING_AT))
    objs.append(part('wingstay', box(0.05, 0.09, 0.08), 'paint', (0, 0.48, -2.19)))
    # Luftintag mitt på huven, lutat efter huven, med svart öppning framåt.
    z = 1.35
    objs.append(part('scoop', box(0.4, 0.06, 0.3), 'paint', (0, hood_y(z) + 0.02, z), hood_slope(z)))
    objs.append(part('scoop_mouth', box(0.34, 0.035, 0.01), 'black', (0, hood_y(z + 0.15) + 0.035, z + 0.155), hood_slope(z)))
    # Rallyintaget framtill på taket.
    objs.append(part('roofvent', box(0.3, 0.045, 0.2), 'paint', (0, 0.82, -0.32)))
    objs.append(part('roofvent_mouth', box(0.24, 0.028, 0.01), 'black', (0, 0.825, -0.215)))
    objs.append(part('plate_front', box(0.46, 0.11, 0.02), 'plate', (0, -0.085, 2.05)))
    # Ljuddämparen hänger under golvet framför bakstötfångaren; avgasröret går ur den bakåt.
    top = min(floor_y(body, MUFFLER_X, z) for z in (MUFFLER_Z[0], MUFFLER_Z[1]))
    y = top - MUFFLER_R + 0.01
    objs.append(part('muffler', cylinder_z(MUFFLER_R, MUFFLER_Z[0] - MUFFLER_Z[1], 16), 'dark', (MUFFLER_X, y, sum(MUFFLER_Z) / 2)))
    objs.append(part('exhaust', lambda bm: tube_z(bm, 0.04, MUFFLER_Z[1] + 2.42), ['chrome', 'black'], (MUFFLER_X, y - 0.02, (MUFFLER_Z[1] - 2.42) / 2)))
    # Extraljusrampen (klass 2): fyra lampor i en lackad låda på huvens framkant, mellan strålkastarna.
    objs.append(part('pod_body', box(0.6, 0.1, 0.2), 'paint', (0, 0.27, 1.84)))
    for i, x in enumerate((0.225, 0.075, -0.075, -0.225)):
        objs.append(part(f'pod_lamp_{i}', cylinder_z(0.07, 0.1), 'paint', (x, 0.32, 1.91)))
        objs.append(part(f'pod_lens_{i}', cylinder_z(0.058, 0.01), 'lamp', (x, 0.32, 1.965)))
    return objs


# --- Fälgen: vit med fem ekrar ---------------------------------------------------------------
#
# Byggs runt hjulets axel (bilens x) med origo i hjulets centrum och ser likadan ut från båda sidor, så
# samma fälg passar alla fyra hjul. Spelet sätter den i ett ihåligt däck med radien 0,31 m.

RIM_R, LIP_W, RIM_FACE = 0.215, 0.022, 0.113  # fälgkantens ytterradie och bredd; ytterkantens läge (x)
SPOKES = [(0.06, 0.042), (0.11, 0.039), (0.15, 0.042), (0.172, 0.05), (0.184, 0.064), (0.192, 0.08), (0.197, 0.095)]  # (radie, halv bredd)
SPOKE_FACE, SPOKE_T = (0.083, 0.104), 0.022  # ekrarnas framsida vid navet och vid kanten; tjocklek
HUB_R, NUT_R, NUT_AT = 0.072, 0.011, 0.042


def rim():
    mats = ['white', 'dark', 'chrome']
    W, D, C = range(3)
    bm = bmesh.new()

    def v(a, y, z):
        return bm.verts.new(to_blender(a, y, z))

    def tube(r_in, r_out, a0, a1, mat, segs=32):
        """Ett rör runt axeln: ytter- och innermantel och båda gavlarna."""
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

    tube(RIM_R - 0.024, RIM_R - 0.017, -RIM_FACE + 0.01, RIM_FACE - 0.01, D)  # trumman bakom ekrarna
    disc(RIM_R - 0.024, -0.012, 0.012, D)  # mörk botten, så hålen mellan ekrarna blir mörka
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
    # Står vid vänster framhjul i Blender, så den syns i renderingarna; spelet använder bara formen.
    obj.location = to_blender(TRACK[0], WHEELS[0][1], WHEELS[0][0])
    bpy.context.scene.collection.objects.link(obj)
    for name in mats:
        obj.data.materials.append(bpy.data.materials[name])
    return obj


def reference():
    """Hjul och mark att modellera mot. Exporteras inte."""
    coll = bpy.data.collections.new('Reference')
    bpy.context.scene.collection.children.link(coll)
    for (zw, yw), xw in zip(WHEELS, TRACK):
        for s in (1, -1):
            # Ihåligt däck, så fälgen syns i det.
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
    # Fälgen även på de tre andra hjulen, bara att titta på (samma nät).
    for (zw, yw), xw in zip(WHEELS, TRACK):
        for sx in (1, -1):
            if (zw, sx) != (WHEELS[0][0], 1):
                copy = wheel_rim.copy()
                copy.location = to_blender(sx * xw, yw, zw)
                bpy.data.collections['Reference'].objects.link(copy)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hoshi4wd.blend')
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print('sparade', out, len(body.data.vertices), 'hörn')


main()
