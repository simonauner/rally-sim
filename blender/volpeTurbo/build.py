"""
Bygger Volpe 2.0 Turbo 16V i Blender och sparar volpeTurbo.blend bredvid skriptet.

    blender -b --factory-startup -P blender/volpeTurbo/build.py

Skriptet ger en första version. Därefter är .blend-filen källan: redigera den i Blender och kör
blender/export.py för att föra över den till spelet. Kör bara om det här skriptet om du vill börja om.

Koordinater: allt räknas i bilens koordinater (x = vänster, y = upp, z = framåt, origo i tyngdpunkten)
och läggs in i Blender som X = x, Y = -z, Z = y, så bilen pekar mot -Y som i Blenders framvy.
Marken ligger på y = -0,52 och hjulens centrum på y ≈ -0,21 när bilen står still i spelet.

Måtten följer förebilden (kantig italiensk femdörrars halvkombi från sent 80-tal med fyrhjulsdrift):
hjulbas 2,48 m, 3,82 m lång över stötfångarna, 1,77 m bred över de lådformade skärmarna, 1,34 m hög.
Längder och höjder är uppmätta på en bild rakt från sidan, skalad efter hjulbasen. Karossen är skalet;
lyktor, grill, stötfångare, takspoiler, huvventiler, extraljus och fälgar är egna delar.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from simplify import SHARP  # noqa: E402

GROUND = -0.52
WHEELS = [(1.066, -0.205), (-1.414, -0.215)]  # (z, y) fram och bak
TRACK = [0.75, 0.76]
TYRE_R = 0.31

# Materialen, i samma ordning som paletten i src/render/models/model.ts.
MATERIALS = [
    ('paint', (0.72, 0.06, 0.05)),
    ('glass', (0.17, 0.23, 0.26)),
    ('black', (0.11, 0.11, 0.11)),
    ('dark', (0.23, 0.23, 0.23)),
    ('chrome', (0.73, 0.75, 0.76)),
    ('lamp', (0.95, 0.91, 0.63)),
    ('amber', (0.91, 0.56, 0.16)),
    ('tail', (0.63, 0.09, 0.09)),
    ('reverse', (0.85, 0.83, 0.8)),
    ('plate', (0.93, 0.93, 0.92)),
    ('white', (0.95, 0.95, 0.93)),
    ('shade', (0.52, 0.04, 0.03)),  # skarvar: lacken i skugga
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


def smooth(t):
    t = clamp01(t)
    return t * t * (3 - 2 * t)


def piecewise(points, x):
    """Linjär interpolation i en lista (x, y) sorterad på x."""
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x <= x1:
            return lerp(y0, y1, (x - x0) / (x1 - x0))
    return points[-1][1]


# --- Skalet: huv, sidor med lådformade skärmar, baklucka --------------------------------------

# Plåtens främre och bakre kontur sett från sidan (y, z). Fronten är en lodrät panel för lyktorna och
# grillen under huvens framkant; den lackade stötfångaren (egen del) ligger utanpå nertill. Bak är
# bakpanelen nästan lodrät under bakrutan.
FRONT = [(-0.27, 1.6), (-0.12, 1.67), (0.07, 1.7), (0.25, 1.705), (0.29, 1.685)]
REAR = [(-0.24, -1.88), (-0.14, -1.94), (0.05, -1.965), (0.42, -1.975), (0.47, -1.965), (0.5, -1.93)]
NOSE, TAIL = 1.705, -1.975

COWL = 0.564  # vindrutans fot (z)
HOOD_FRONT = 1.69
DECK_FRONT = -1.88  # bakrutans fot


def body_top(z):
    """Ovansidans mittlinje: huven sluttar ner mot fronten, rak gördellinje, kort bakparti under bakrutan."""
    if z >= COWL:
        return lerp(0.44, 0.29, clamp01((z - COWL) / (HOOD_FRONT - COWL)) ** 1.15)
    if z >= -1.2:
        return lerp(0.44, 0.42, (COWL - z) / (COWL + 1.2))
    if z >= DECK_FRONT:
        return lerp(0.42, 0.47, (-1.2 - z) / (-1.2 - DECK_FRONT))
    return lerp(0.47, 0.45, (DECK_FRONT - z) / (DECK_FRONT - TAIL))


def body_bottom(z):
    return piecewise([(TAIL, -0.22), (-1.85, -0.27), (-1.7, -0.29), (1.5, -0.29), (NOSE, -0.25)], z)


# Skärmarna: sidan är 0,81 bred (halva), utbyggd till 0,885 kring hjulen under en hylla strax under
# gördellinjen. Den främre skärmen går från framdörren till fronten, den bakre från bakdörren bakåt.
BODY_HW, FLARE_HW = 0.81, 0.885
SHELF_Y = (0.19, 0.24)
FLARE_Z = [(0.64, NOSE + 0.1), (TAIL - 0.1, -0.98)]
FLARE_RAMP = 0.09


def flare_amount(z):
    return max(smooth((z - z0) / FLARE_RAMP) * smooth((z1 - z) / FLARE_RAMP) for z0, z1 in FLARE_Z)


def corner(z):
    """Rundade hörn sett ovanifrån, fram och bak."""
    k = 1.0
    if z > NOSE - 0.16:
        k *= 1 - 0.07 * clamp01((z - (NOSE - 0.16)) / 0.16) ** 2
    if z < TAIL + 0.12:
        k *= 1 - 0.05 * clamp01((TAIL + 0.12 - z) / 0.12) ** 2
    return k


def section(hw, bottom, top, rt, rb, side_ys=(), squeeze=lambda y: 1.0, crown=0.0, n_top=3, n_rt=4, n_rb=3):
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


# Fronten och bakpanelen: de sista snitten böjs bakåt (framåt) från FRONT_FROM (REAR_FROM) ut till
# sidokonturen, så nosens lutande panel och huvens framkant blir en jämn yta i stället för trappsteg.
FRONT_FROM, REAR_FROM = 1.45, -1.7
END_STEPS = (0, 0.35, 0.6, 0.78, 0.9, 0.97, 1)


def lower_body():
    zs = {lerp(REAR_FROM, TAIL, s) for s in END_STEPS} | {lerp(FRONT_FROM, NOSE, s) for s in END_STEPS}
    zs |= {DECK_FRONT, -1.85, -1.2, COWL}
    # Skärmarnas utbyggnad tonas in över FLARE_RAMP; fem snitt per ramp följer smooth().
    zs |= {z for z0, z1 in FLARE_Z for t in range(5) for z in (z0 + FLARE_RAMP * t / 4, z1 - FLARE_RAMP * t / 4)}
    rings = []
    for zn in fill([z for z in zs if TAIL <= z <= NOSE], 0.25):
        top, bottom = body_top(zn), body_bottom(zn)
        f = flare_amount(zn)
        hw = lerp(BODY_HW, FLARE_HW, f) * corner(zn)
        inner = BODY_HW * corner(zn) / hw

        # Under hyllan är skärmen utbyggd; över den drar sidan in till karossens bredd och lutar lite inåt.
        def squeeze(y, t=top, inner=inner):
            k = lerp(1, inner, smooth((y - SHELF_Y[0]) / (SHELF_Y[1] - SHELF_Y[0])))
            return k * (1 - 0.03 * clamp01((y - (t - 0.12)) / 0.12))

        shelf = [lerp(*SHELF_Y, t / 4) for t in range(5)]
        ring = section(hw, bottom, top, 0.05, 0.06, (top - 0.12, *shelf), squeeze, crown=0.012)

        def z_at(y, zn=zn):
            if zn > FRONT_FROM:
                return lerp(FRONT_FROM, piecewise(FRONT, y), (zn - FRONT_FROM) / (NOSE - FRONT_FROM))
            if zn < REAR_FROM:
                return lerp(REAR_FROM, piecewise(REAR, y), (zn - REAR_FROM) / (TAIL - REAR_FROM))
            return zn

        rings.append([(x, y, z_at(y)) for x, y in ring])
    return loft('lower', rings)


# --- Kupén: lutande vindruta, platt tak och sluttande bakruta ----------------------------------

ROOF = [(DECK_FRONT, 0.47), (-1.3, 0.8), (-1.22, 0.818), (-0.5, 0.826), (0.0, 0.818), (0.09, 0.8), (COWL, 0.44)]
ROOF_FRONT, ROOF_REAR = 0.09, -1.3
# Kupéns halva bredd vid gördellinjen och taket; den smalnar mot vindrutan med lutningen CAB_TAPER.
CAB_BASE, CAB_TOP, CAB_TAPER = 0.78, 0.66, 0.04 / 0.56


def greenhouse():
    rings = []
    # Taket, kupéns avsmalning och rutornas lutning är raka mellan brytpunkterna, så snitten läggs där.
    # Ändarna sticker ner i karossen, så sammanfogningen får en ren skärning vid huven och bakluckan.
    for z in fill([DECK_FRONT, *(z for z, _ in ROOF[1:-1]), -1.2, COWL, COWL + 0.04], 0.3):
        base = body_top(z) - 0.04
        top = piecewise(ROOF, z) if DECK_FRONT < z <= COWL else body_top(z) - 0.015
        # Sidorutorna lutar inåt; kupén smalnar mot vindrutan och lite mot bakrutan.
        front = clamp01(z / 0.56)
        rear = clamp01((-1.2 - z) / 0.68)
        wb = CAB_BASE - 0.03 * front - 0.03 * rear
        wt = CAB_TOP - 0.04 * front - 0.05 * rear
        squeeze = lambda y, b=base, t=top, wb=wb, wt=wt: lerp(1, wt / wb, clamp01((y - b) / (t - b)))  # noqa: E731
        rings.append([(x, y, z) for x, y in section(wb, base, top, 0.06, 0.0, (), squeeze, crown=0.012, n_rb=1)])
    return loft('greenhouse', rings)


ARCH_R = 0.37


def arch_cutters():
    cutters = []
    for zw, yw in WHEELS:
        for s in (1, -1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=ARCH_R, depth=0.56)
            c = bpy.context.active_object
            c.rotation_euler = (0, math.pi / 2, 0)
            c.location = to_blender(s * 0.9, yw, zw)
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
    return body


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


Y = lambda y: plane(0, 1, 0, y)  # noqa: E731
Z = lambda z: plane(0, 0, 1, z)  # noqa: E731

# Kupén: gördellinjen, takkanten, vindrutans och bakrutans kanter, stolparna (z) och sidorutorna.
BELT_Y, WINDOW_TOP = 0.425, 0.77
# A-stolpen är lackad och lika bred hela vägen, med svart gummilist mot vindrutan och dörrutan.
A_LINE = line_plane((COWL - 0.075, BELT_Y), (ROOF_FRONT - 0.04, WINDOW_TOP))  # dörrutans framkant
A_FRAME = line_plane((COWL - 0.057, BELT_Y), (ROOF_FRONT - 0.022, WINDOW_TOP))
# Kvartsrutans bakkant: C-stolpen lutar framåt upptill.
C_LINE = line_plane((-1.21, BELT_Y), (-1.06, WINDOW_TOP))
B_PILLAR = (-0.47, -0.41)
REAR_FRAME = (-0.95, -0.925)  # ramen mellan bakdörrens ruta och den fasta kvartsrutan
# Vindrutans sidokant följer kupéns hörn på ett fast avstånd, så A-stolpen blir lika bred hela vägen.
SCREEN_SIDE = plane(1, 0, CAB_TAPER, CAB_TOP - 0.05)
SCREEN_FRAME = plane(1, 0, CAB_TAPER, CAB_TOP - 0.034)
BACKLIGHT_SIDE = line_plane((0.64, 0.49), (0.54, 0.77), x_axis=True)
BACKLIGHT_Y = (0.5, 0.77)
# Skarvar: dörrarna (bakdörrens bakkant bara ovanför hjulhuset), huven och bakluckan.
SEAM_W = 0.01
DOOR_SEAMS = (0.6, -0.44, -1.36)
REAR_SEAM_Y = 0.17
HOOD_SEAM_X = 0.7
HATCH_SEAM_Y = 0.04
# Bakluckans sidoskarv följer baklyktornas lutande innerkant (se TAIL_X0) och fortsätter upp till bakrutan.
HATCH_SEAM = [line_plane((0.595 - 0.004 - d, 0.05), (0.63 - 0.004 - d, 0.42), x_axis=True) for d in (SEAM_W, 0)]
# Svarta trösklar längs sidan.
SILL_Y = -0.17
# Den svarta panelen bakom lyktorna slutar strax utanför de yttre lyktorna; skärmarna viker runt hörnet.
FRONT_PANEL_X = 0.75

FRONT_ZONE = lambda c: c[2] > 1.6  # noqa: E731
REAR_ZONE = lambda c: c[2] < -1.86  # noqa: E731
CABIN_ZONE = lambda c: -1.95 < c[2] < 0.68 and c[1] > 0.38  # noqa: E731
SIDE_ZONE = lambda c: abs(c[0]) > 0.7 and c[1] < 0.44  # noqa: E731
HOOD_ZONE = lambda c: c[2] > 0.6 and c[1] > 0.25  # noqa: E731

CUTS = [
    (CABIN_ZONE, [Y(BELT_Y), Y(WINDOW_TOP), Y(WINDOW_TOP + 0.015), A_LINE, A_FRAME, C_LINE, Z(ROOF_FRONT), Z(ROOF_REAR),
                  *(Z(v) for v in (*B_PILLAR, *REAR_FRAME)), *(pl for sc in (SCREEN_SIDE, SCREEN_FRAME) for pl in (sc, plane(-sc[0].x, sc[0].y, sc[0].z, sc[1]))),
                  BACKLIGHT_SIDE, plane(-BACKLIGHT_SIDE[0].x, BACKLIGHT_SIDE[0].y, 0, BACKLIGHT_SIDE[1]), *(Y(v) for v in BACKLIGHT_Y)]),
    (SIDE_ZONE, [Z(v + d) for v in DOOR_SEAMS for d in (-SEAM_W / 2, SEAM_W / 2)] + [Y(SILL_Y), Y(REAR_SEAM_Y)]),
    (HOOD_ZONE, [p for d in (0, SEAM_W) for p in mirrored(HOOD_SEAM_X + d)]),
    (REAR_ZONE, [pl for sm in HATCH_SEAM for pl in (sm, plane(-sm[0].x, sm[0].y, sm[0].z, sm[1]))] + [Y(HATCH_SEAM_Y), Y(HATCH_SEAM_Y + SEAM_W)]),
    (FRONT_ZONE, [Y(0.07), Y(0.27), *mirrored(FRONT_PANEL_X)]),
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
    """Kupén: rutor med svarta ramar och B-stolpe, lackat tak och lackade A- och C-stolpar."""
    x, y, z = p
    ax = abs(x)
    if y < BELT_Y:
        return None
    # Vindrutan och bakrutan avgränsas bara av planen, så kanterna mot stolparna blir raka.
    if z > ROOF_FRONT and not above((ax, y, z), SCREEN_SIDE):
        return M['glass']
    if z < ROOF_REAR and not above((ax, y, z), BACKLIGHT_SIDE):
        return M['glass'] if BACKLIGHT_Y[0] < y < BACKLIGHT_Y[1] else M['black']
    # Sidorna: rutorna under takkanten, med svart ram och stolpar; taket och C-stolpen lackade.
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
    # Hjulhusen.
    for zw, yw in WHEELS:
        if 0.45 < ax < 0.9 and math.hypot(z - zw, y - yw) < ARCH_R + 0.02 and abs(n.x) < 0.8:
            return M['black']
    if CABIN_ZONE(p):
        pane = pane_material(p, n)
        if pane is not None:
            return pane
    # Panelen bakom lyktorna och grillen, och plåten bakom stötfångaren.
    if FRONT_ZONE(p) and z > 1.66 and y < 0.27 and ax < FRONT_PANEL_X and n.z > 0.7:
        return M['black']
    if SIDE_ZONE(p) and abs(n.x) > 0.4:
        if y < SILL_Y:
            return M['black']
        for i, v in enumerate(DOOR_SEAMS):
            if abs(z - v) < SEAM_W / 2 and y > SILL_Y and (i < 2 or y > REAR_SEAM_Y):
                return M['shade']
    if HOOD_ZONE(p) and n.y > 0.5 and HOOD_SEAM_X < ax < HOOD_SEAM_X + SEAM_W:
        return M['shade']
    if REAR_ZONE(p) and n.z < -0.5:
        if y < HATCH_SEAM_Y - 0.02:
            return M['black']
        # Planens normal pekar inåt: innanför skarvens yttre plan och utanför dess inre.
        inside = above((ax, y, z), HATCH_SEAM[1])
        if inside and not above((ax, y, z), HATCH_SEAM[0]) and HATCH_SEAM_Y < y < 0.47:
            return M['shade']
        if HATCH_SEAM_Y < y < HATCH_SEAM_Y + SEAM_W and inside:
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
    """En del av lådor [(material, (x0, x1), (y0, y1), (z0, z1))], lodräta prismor [(material, [(x, z), ...],
    (y0, y1))] med en konvex grundyta sett ovanifrån och skivor längs z [(material, (x, y), r, (z0, z1))],
    i bilens koordinater, med origo i `at`."""
    mats = []
    bm = bmesh.new()

    def mat_index(mat):
        if mat not in mats:
            mats.append(mat)
        return mats.index(mat)

    for mat, poly, (y0, y1) in prisms:
        m = mat_index(mat)
        lo = [bm.verts.new(to_blender(x - at[0], y0 - at[1], z - at[2])) for x, z in poly]
        hi = [bm.verts.new(to_blender(x - at[0], y1 - at[1], z - at[2])) for x, z in poly]
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
        # Konen ligger längs Blenders Z; vrid den till bilens z (Blenders -Y).
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


def surface_x(body, y, z):
    """Var karossens sida ligger (x) på höjden y vid z, mätt med en stråle utifrån."""
    hit, loc, _, _ = body.ray_cast(to_blender(2, y, z), Vector((-1, 0, 0)))
    assert hit, f'ingen kaross vid y={y}, z={z}'
    return loc.x


def surface_y(body, x, z):
    """Var karossens ovansida ligger (y) vid x, z, mätt med en stråle uppifrån."""
    hit, loc, _, _ = body.ray_cast(to_blender(x, 2, z), Vector((0, 0, -1)))
    assert hit, f'ingen kaross vid x={x}, z={z}'
    return loc.z


def floor_y(body, x, z):
    """Var golvet ligger (y) under x, z, mätt med en stråle nerifrån."""
    hit, loc, _, _ = body.ray_cast(to_blender(x, -1, z), Vector((0, 0, 1)))
    assert hit, f'inget golv vid x={x}, z={z}'
    return loc.z


# Fronten: fyra runda strålkastare i en svart panel, de yttre större, med kromringar. Grillen mellan de
# inre lyktorna har en kromram och en kromad mittlist som delar den i två halvor.
LAMP_CY, LAMP_FACE = 0.17, 1.715
HEADLAMPS = [(0.64, 0.088), (0.455, 0.07)]  # (x, radie)
GRILLE_X, GRILLE_Y = 0.355, (0.09, 0.255)


def headlamp(s, side):
    discs = []
    for x, r in HEADLAMPS:
        discs.append(('chrome', (s * x, LAMP_CY), r + 0.012, (1.68, LAMP_FACE - 0.004)))
        discs.append(('lamp', (s * x, LAMP_CY), r, (1.68, LAMP_FACE)))
    return assembly(f'headlamp_{side}', (s * 0.55, LAMP_CY, 1.7), [], discs=discs)


def grille():
    y0, y1 = GRILLE_Y
    face = 1.716
    boxes = [
        ('black', (-GRILLE_X, GRILLE_X), (y0, y1), (1.68, face - 0.012)),
        ('chrome', (-GRILLE_X - 0.008, GRILLE_X + 0.008), (y1 - 0.01, y1 + 0.008), (1.68, face)),
        ('chrome', (-GRILLE_X - 0.008, GRILLE_X + 0.008), (y0 - 0.008, y0 + 0.01), (1.68, face)),
        ('chrome', (GRILLE_X - 0.01, GRILLE_X + 0.008), (y0, y1), (1.68, face)),
        ('chrome', (-GRILLE_X - 0.008, -GRILLE_X + 0.01), (y0, y1), (1.68, face)),
        # Mittlisten, som går upp i en spets över märket.
        ('chrome', (-0.012, 0.012), (y0, y1), (1.68, face)),
    ]
    # Märket: en kromad rund bricka överst på mittlisten.
    discs = [('chrome', (0, y1 - 0.035), 0.03, (1.68, face + 0.006))]
    # Fint galler: täta vågräta lameller i båda halvorna.
    n = 8
    for i in range(n):
        y = lerp(y0 + 0.02, y1 - 0.02, i / (n - 1))
        for s in (1, -1):
            boxes.append(('dark', mirror_x((0.02, GRILLE_X - 0.015), s), (y - 0.005, y + 0.005), (1.68, face - 0.005)))
    return assembly('grille', (0, sum(GRILLE_Y) / 2, 1.7), boxes, discs=discs)


# Stötfångarna: lackade, raka över fronten och bakpanelen och vikta runt hörnen bakåt (framåt) till
# hjulhusen, med svart underkant.
FRONT_BUMPER_Y, REAR_BUMPER_Y = (-0.29, 0.07), (-0.25, 0.04)
BUMPER_HALF, BUMPER_DEPTH, BUMPER_R = 0.875, 0.09, 0.14


def bumper(name, z_face, z_end, ys):
    """En U-formad stötfångare: framsidan i z_face, sidorna bakåt till z_end."""
    d = 1 if z_face > z_end else -1
    h, r = BUMPER_HALF, BUMPER_R
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
    # Tvärsnittet (utåt, y): svart underkant som drar in, lackad framsida som lutar in upptill.
    sec = [(-0.03, y0), (-0.005, y0 + 0.04), (0, y0 + 0.05), (0, y1 - 0.04), (-0.012, y1),
           (-BUMPER_DEPTH, y1), (-BUMPER_DEPTH, y0)]
    mats = [1, 1, 0, 0, 0, 0, 1]  # paint, black
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
    return new_object(name, bm, ['paint', 'black'], at)


def front_openings(face):
    """Stötfångarens öppningar: tre intag mitt fram, ett brett galler nertill och blinkers ytterst."""
    boxes = []
    for x0, x1 in ((-0.3, -0.1), (-0.09, 0.09), (0.1, 0.3)):
        boxes.append(('black', (x0, x1), (-0.06, 0.02), (face - 0.02, face + 0.004)))
    boxes.append(('black', (-0.62, 0.62), (-0.22, -0.13), (face - 0.02, face + 0.004)))
    for i in range(3):
        y = lerp(-0.205, -0.145, i / 2)
        boxes.append(('dark', (-0.6, 0.6), (y - 0.004, y + 0.004), (face - 0.01, face + 0.006)))
    return assembly('intakes', (0, -0.1, face), boxes)


def indicator(s, side, face):
    return assembly(f'indicator_{side}', (s * 0.67, 0.0, face), [
        ('amber', mirror_x((0.56, 0.78), s), (-0.03, 0.035), (face - 0.02, face + 0.005)),
        ('black', mirror_x((0.38, 0.5), s), (-0.03, 0.035), (face - 0.02, face + 0.004)),
    ])


# Baklyktorna: höga lyktor i hörnen från stötfångaren upp till strax under bakrutan, som viker runt hörnet
# in på sidan. Innerkanten mot bakluckan lutar, så lyktan är smalare upptill. Tre fält uppifrån: rött, ett
# gult blinkersband och ett högre rött fält nertill med en reflex innerst, skilda av smala svarta lister.
# Glaset ligger i plåtens yta: konturen mäts med strålar mot karossen på flera höjder.
TAIL_X0 = ((0.05, 0.595), (0.42, 0.63))  # innerkanten (y, x) nertill och upptill
TAIL_BACK = -1.85  # bakkanten på sidan
TAIL_CORNER = (0.72, -1.9)  # (x, z) innanför hörnet, som strålarna runt hörnet utgår från
TAIL_BANDS = [('tail', (0.332, 0.42)), ('amber', (0.2, 0.325)), ('tail', (0.05, 0.193))]
TAIL_Y = (TAIL_BANDS[-1][1][0], TAIL_BANDS[0][1][1])
REFLEX_W = 0.08  # reflexen innerst i det nedre fältet


def tail_x0(y):
    (y0, x0), (y1, x1) = TAIL_X0
    return lerp(x0, x1, (y - y0) / (y1 - y0))


def surface_out(body, y, x, z, dx, dz):
    """Där en stråle utifrån längs (-dx, -dz) mot (x, z) på höjden y först träffar karossen."""
    hit, loc, _, _ = body.ray_cast(to_blender(x + dx, y, z + dz), to_blender(-dx, 0, -dz))
    assert hit, f'ingen kaross vid y={y}, x={x}, z={z}'
    return to_car(loc)


def taillamp(body, s, side):
    cx, cz = TAIL_CORNER

    def outline(y, grow, x_in, x_out=None):
        """Lyktan sett ovanifrån på höjden y, `grow` utanför plåten: bakpanelen från x_in, och utan x_out
        även hörnet och sidan bakåt."""
        if x_out is not None:
            rays = [(lerp(x_in, x_out, t / 2), cz, 0, -1) for t in range(3)]
        else:
            rays = [(lerp(x_in, cx, t / 3), cz, 0, -1) for t in range(3)]
            rays += [(cx, cz, math.sin(a), -math.cos(a)) for a in (math.pi / 2 * i / 10 for i in range(11))]
            rays += [(cx, z, 1, 0) for z in (lerp(cz, TAIL_BACK, t / 3) for t in (1, 2, 3))]
        pts = []
        for x, z, dx, dz in rays:
            px, _, pz = surface_out(body, y, x, z, dx, dz)
            pts.append((px + dx * grow, pz + dz * grow))
        # Baksidan, inne i plåten.
        if x_out is None:
            pts += [(pts[-1][0] - 0.05, TAIL_BACK), (x_in, pts[0][1] + 0.05)]
        else:
            pts += [(x_out, pts[-1][1] + 0.04), (x_in, pts[0][1] + 0.04)]
        return [(s * x, z) for x, z in pts]

    bm = bmesh.new()
    at = (s * 0.76, sum(TAIL_Y) / 2, -1.93)
    mats = ['black', 'tail', 'amber']

    def field(mat, y0, y1, grow, x_in, x_out=None):
        """Ett fält som följer plåten: konturer på flera höjder, sammanbundna, med lock över och under."""
        n = max(2, math.ceil((y1 - y0) / 0.01) + 1)  # tätt, så glaset följer skärmens hylla
        rings = []
        for i in range(n):
            y = lerp(y0, y1, i / (n - 1))
            xi = x_in(y)
            rings.append([bm.verts.new(to_blender(x - at[0], y - at[1], z - at[2])) for x, z in outline(y, grow, xi, x_out and x_out(y))])
        m = mats.index(mat)
        k = len(rings[0])
        for a, b in zip(rings, rings[1:]):
            for i in range(k):
                j = (i + 1) % k
                bm.faces.new((a[i], a[j], b[j], b[i])).material_index = m
        bm.faces.new(rings[0]).material_index = m
        bm.faces.new(list(reversed(rings[-1]))).material_index = m

    for idx, (mat, (y0, y1)) in enumerate(TAIL_BANDS):
        # Den svarta ramen bakom syns som smala lister mellan fälten och runt om.
        field('black', y0 - 0.004, y1 + 0.004, 0.003, lambda y: tail_x0(y) - 0.004)
        if idx == len(TAIL_BANDS) - 1:
            # Reflexen innerst, skild från lyktan av en svart list.
            field(mat, y0, y1, 0.007, tail_x0, lambda y: tail_x0(y) + REFLEX_W)
            field(mat, y0, y1, 0.007, lambda y: tail_x0(y) + REFLEX_W + 0.006)
        else:
            field(mat, y0, y1, 0.007, tail_x0)
    return new_object(f'taillamp_{side}', bm, mats, at)


# Takspoilern: ett lackat blad över bakrutans överkant som stiger bakåt, på två ben.
SPOILER_SEC = [(-1.12, 0.832), (-1.2, 0.858), (-1.47, 0.885), (-1.48, 0.872), (-1.25, 0.845), (-1.14, 0.824)]
SPOILER_HW = 0.62


def spoiler():
    bm = bmesh.new()
    at = (0, 0.85, -1.3)
    rings = [[bm.verts.new(to_blender(x - at[0], y - at[1], z - at[2])) for z, y in SPOILER_SEC] for x in (-SPOILER_HW, SPOILER_HW)]
    k = len(SPOILER_SEC)
    for i in range(k):
        j = (i + 1) % k
        bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[1])))
    for s in (1, -1):
        for x0, x1 in ((0.56, 0.6),):
            r = bmesh.ops.create_cube(bm, size=1)
            xs = mirror_x((x0, x1), s)
            mid = (sum(xs) / 2 - at[0], 0.82 - at[1], -1.36 - at[2])
            bmesh.ops.scale(bm, vec=Vector((xs[1] - xs[0], 0.12, 0.08)), verts=r['verts'])
            bmesh.ops.translate(bm, vec=to_blender(*mid), verts=r['verts'])
    return new_object('spoiler', bm, ['paint'], at)


# Ventilerna i huven: två fält av svarta lameller ute vid sidorna, så startnumret får plats emellan.
VENT_X, VENT_Z = (0.3, 0.58), (1.18, 1.46)


def vents(body, s, side):
    boxes = []
    n = 7
    for i in range(n):
        z = lerp(VENT_Z[0], VENT_Z[1], i / (n - 1))
        y = surface_y(body, s * sum(VENT_X) / 2, z)
        boxes.append(('black', mirror_x(VENT_X, s), (y - 0.01, y + 0.004), (z - 0.014, z + 0.014)))
    y = surface_y(body, s * sum(VENT_X) / 2, sum(VENT_Z) / 2)
    return assembly(f'vents_{side}', (s * sum(VENT_X) / 2, y, sum(VENT_Z) / 2), boxes)


# Backspegeln: en svart triangulär fot i dörrutans framhörn, en kort arm och ett rundat hus som smalnar
# av framåt, med spegelglaset bakåt.
MIRROR_FOOT = (0.53, 0.41)  # fotens fram- och bakkant (z) på gördellinjen
MIRROR_HOUSING = ((0.8, 0.92), (0.46, 0.545), (0.43, 0.485))  # x, y, z (bak, fram)


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
    root = surface_x(body, BELT_Y + 0.02, (zf + zb) / 2) - 0.015
    tri = lambda x: [v(x, BELT_Y - 0.005, zf), v(x, BELT_Y + 0.085, zf), v(x, BELT_Y - 0.005, zb)]  # noqa: E731
    faces([tri(root), tri(root + 0.035)], [0, 0, 0])
    # Armen ut till huset.
    ay, az = BELT_Y + 0.05, (hz0 + hz1) / 2
    arm = lambda x: [v(x, ay, az + 0.015), v(x, ay + 0.025, az + 0.015), v(x, ay + 0.025, az - 0.015), v(x, ay, az - 0.015)]  # noqa: E731
    faces([arm(root + 0.03), arm(hx0 + 0.03)], [0, 0, 0])

    # Huset: rundad rektangel sett bakifrån (x, y), smalare och lägre framtill.
    def outline(shrink):
        cx, cy = (hx0 + hx1) / 2, (hy0 + hy1) / 2
        w, h, r = (hx1 - hx0) / 2 - shrink, (hy1 - hy0) / 2 - shrink * 0.6, 0.03
        pts = []
        for cxs, cys, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
            rr = r if cxs > 0 else 0.012
            for i in range(5):
                a = math.radians(a0 + 90 * i / 4)
                pts.append((cx + cxs * (w - rr) + rr * math.cos(a), cy + cys * (h - rr) + rr * math.sin(a)))
        return pts

    rings = [[v(x, y, z) for x, y in outline(sh)] for z, sh in ((hz0, 0.0), (hz0 + 0.03, 0.0), (hz1, 0.022))]
    glass = [v(x, y, hz0 - 0.004) for x, y in outline(0.012)]
    faces([*rings], [0, 0, 0, 0])
    bm.faces.new(list(reversed(glass))).material_index = 1
    return new_object(f'mirror_{side}', bm, ['black', 'dark'], at)


# Extraljusrampen (klass 2): fyra runda lampor tätt i en rad framför grillen och strålkastarna, på en
# lackad bygel. Samma x som podX i src/render/bodies/volpeTurbo.ts.
POD_X, POD_Y, POD_Z, POD_R = (0.285, 0.095, -0.095, -0.285), 0.2, 1.8, 0.085


def pod():
    boxes = [('paint', (-0.4, 0.4), (POD_Y - 0.11, POD_Y - 0.07), (POD_Z - 0.1, POD_Z - 0.03))]
    discs = []
    for x in POD_X:
        discs.append(('black', (x, POD_Y), POD_R, (POD_Z - 0.07, POD_Z + 0.03)))
        discs.append(('chrome', (x, POD_Y), POD_R - 0.004, (POD_Z + 0.03, POD_Z + 0.04)))
        discs.append(('lamp', (x, POD_Y), POD_R - 0.016, (POD_Z + 0.03, POD_Z + 0.046)))
    return assembly('pod', (0, POD_Y, POD_Z), boxes, discs=discs)


MUFFLER_X, MUFFLER_Z, MUFFLER_R = -0.42, (-1.45, -1.8), 0.08


def details(body):
    objs = [grille(), spoiler(), pod(), front_openings(1.786)]
    for s, side in ((1, 'L'), (-1, 'R')):
        objs.append(headlamp(s, side))
        objs.append(taillamp(body, s, side))
        objs.append(mirror(body, s, side))
        objs.append(vents(body, s, side))
        objs.append(indicator(s, side, 1.786))
        for i, z in enumerate((-0.3, -1.24)):
            x = surface_x(body, 0.33, z)
            objs.append(assembly(f'handle_{side}{i}', (s * x, 0.33, z), [('black', mirror_x((x - 0.01, x + 0.012), s), (0.315, 0.345), (z - 0.07, z + 0.07))]))
        # Sidoblinkers på framskärmen bakom hjulhuset.
        x = surface_x(body, 0.27, 0.72)
        objs.append(assembly(f'sidemarker_{side}', (s * x, 0.27, 0.72), [('amber', mirror_x((x - 0.01, x + 0.006), s), (0.26, 0.28), (0.69, 0.75))]))
        for zw, nm in ((WHEELS[0][0], 'F'), (WHEELS[1][0], 'R')):
            objs.append(assembly(f'flap_{nm}{side}', (s * 0.75, -0.38, zw - 0.43), [('black', mirror_x((0.65, 0.85), s), (-0.48, -0.28), (zw - 0.44, zw - 0.425))]))
    objs.append(bumper('bumper_front', 1.786, 1.45, FRONT_BUMPER_Y))
    objs.append(bumper('bumper_rear', -2.03, -1.76, REAR_BUMPER_Y))
    objs.append(assembly('plate_front', (0, -0.1, 1.795), [('plate', (-0.26, 0.26), (-0.125, -0.065), (1.785, 1.797))]))
    # Bakre nummerplåten i en svart nisch mellan baklyktorna.
    objs.append(assembly('plate_rear', (0, 0.15, -1.98), [
        ('black', (-0.3, 0.3), (0.085, 0.215), (-1.982, -1.96)),
        ('plate', (-0.26, 0.26), (0.095, 0.205), (-1.988, -1.97)),
    ]))
    # Ljuddämparen under golvet framför bakstötfångaren; avgasröret går ut under stötfångaren.
    top = min(floor_y(body, MUFFLER_X, z) for z in MUFFLER_Z)
    y = top - MUFFLER_R + 0.01
    objs.append(cylinder_z('muffler', 'dark', (MUFFLER_X, y, sum(MUFFLER_Z) / 2), MUFFLER_R, MUFFLER_Z[0] - MUFFLER_Z[1], 16))
    objs.append(cylinder_z('exhaust', 'chrome', (MUFFLER_X, y - 0.02, (MUFFLER_Z[1] - 2.07) / 2), 0.035, MUFFLER_Z[1] + 2.07))
    return objs


# --- Fälgen: vit rallyfälg med en tät krans av raka ekrar -----------------------------------
#
# Byggs runt hjulets axel (bilens x) med origo i hjulets centrum och ser likadan ut från båda sidor, så
# samma fälg passar alla fyra hjul. Spelet sätter den i ett ihåligt däck med innerradien 0,205 m.

RIM_R, LIP_W, RIM_FACE = 0.215, 0.02, 0.105
SPOKE_COUNT, SPOKE_R = 16, (0.06, 0.197)
SPOKE_W = (0.008, 0.017)  # halv bredd vid navet och vid kanten
SPOKE_FACE, SPOKE_T = (0.088, 0.098), 0.022
CAP_R = 0.06


def rim():
    mats = ['white', 'dark', 'black']
    W, D, B = range(3)
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
        bm.faces.new(front).material_index = W
        bm.faces.new(list(reversed(back))).material_index = W
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((front[i], back[i], back[j], front[j])).material_index = W

    tube(RIM_R - 0.024, RIM_R - 0.017, -RIM_FACE + 0.01, RIM_FACE - 0.01, D)  # trumman bakom ekrarna
    disc(RIM_R - 0.022, -0.04, 0.04, B)  # svart botten, så springorna mellan ekrarna blir mörka
    for s in (1, -1):
        a0, a1 = sorted((s * (RIM_FACE - LIP_W), s * RIM_FACE))
        tube(RIM_R - LIP_W, RIM_R, a0, a1, W)
        for k in range(SPOKE_COUNT):
            spoke(2 * math.pi * k / SPOKE_COUNT, s)
        # Navet: en vit skiva med en mörk centrummutter.
        c0, c1 = sorted((s * 0.05, s * (SPOKE_FACE[0] + 0.004)))
        disc(CAP_R, c0, c1, W)
        m0, m1 = sorted((s * (SPOKE_FACE[0] + 0.004), s * (SPOKE_FACE[0] + 0.012)))
        disc(0.028, m0, m1, D, 16)
    return new_object('rim', bm, mats, (TRACK[0], WHEELS[0][1], WHEELS[0][0]))


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
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'volpeTurbo.blend')
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print('sparade', out, len(body.data.vertices), 'hörn')


main()
