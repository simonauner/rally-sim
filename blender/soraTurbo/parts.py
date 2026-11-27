"""
Soras lösa delar, var och en sitt eget objekt: vinge, avgassystem, hjul, speglar, luftintag, extraljus,
nummerplåt och stänkskydd. Delarna byggs i bilens koordinater kring sitt eget origo.
"""

import math

import bmesh
from mathutils import Vector

from common import TRACK, WHEELS, box, hexa, new_object, prism, revolve


# --- Vinge -----------------------------------------------------------------------------------

WING_AT = (0, 0.85, -2.17)
WING_SPAN = 1.5
WING_CHORD = 0.32
WING_AOA = 0.14  # radianer; bakkanten upp


def aerofoil(chord, thickness=0.12, camber=0.04, peak=0.4, n=14):
    """Vingprofil (NACA 4-siffrig) i (z, y), välvd nedåt så den ger marktryck, framkanten åt +z och
    lutad WING_AOA. Punkterna går runt profilen från bakkanten över ovansidan och tillbaka."""

    def at(xc, upper):
        yt = 5 * thickness * (0.2969 * math.sqrt(xc) - 0.126 * xc - 0.3516 * xc**2 + 0.2843 * xc**3 - 0.1036 * xc**4)
        yc = camber / peak**2 * (2 * peak * xc - xc**2) if xc < peak else camber / (1 - peak) ** 2 * (1 - 2 * peak + 2 * peak * xc - xc**2)
        y = -yc + (yt if upper else -yt)  # välvd nedåt
        z, y = chord * (0.5 - xc), chord * y
        c, s = math.cos(WING_AOA), math.sin(WING_AOA)
        return z * c + y * s, y * c - z * s

    xs = [(1 - math.cos(math.pi * i / n)) / 2 for i in range(n + 1)]  # tätt vid fram- och bakkant
    return [at(x, True) for x in reversed(xs)] + [at(x, False) for x in xs[1:-1]]


def wing():
    """Vingen i ett stycke (ramlar av hel): profilerat blad, svart list längs bakkanten, ändplattor och
    två fenor som lutar bakåt ner till bakluckan."""
    bm = bmesh.new()
    half = WING_SPAN / 2
    prism(bm, aerofoil(WING_CHORD), -half, half, 'paint')
    # Gurneylist: en smal svart kant uppåt längs bakkanten.
    te = aerofoil(WING_CHORD)[0]
    box(bm, (0, te[1] + 0.01, te[0] + 0.003), (WING_SPAN, 0.02, 0.006), 'black')
    # Ändplattorna: lutande sexhörningar som sticker ut under och bakom bladet.
    c = WING_CHORD / 2
    plate = [(c + 0.03, -0.075), (c + 0.05, 0.02), (c - 0.03, 0.065), (-c - 0.02, 0.105), (-c - 0.06, 0.04), (-c - 0.03, -0.085)]
    for s in (1, -1):
        prism(bm, plate, s * half, s * (half + 0.012), 'paint')
    # Fenorna: breda vid foten på bakluckan (som ligger 0,31–0,33 under bladet), smala och bakåtlutade upptill.
    fin = [(0.21, -0.335), (0.07, -0.005), (-0.09, 0.015), (-0.07, -0.345)]
    for s in (1, -1):
        prism(bm, fin, s * 0.485, s * 0.515, 'paint')
    return new_object('wing', bm, WING_AT)


# --- Avgassystem -----------------------------------------------------------------------------

EXHAUST_AT = (-0.42, -0.27, -2.36)


def exhaust():
    """Ändröret med vikt kant och mörk insida, röret framåt under stötfångaren och ljuddämparen under
    golvet. Origo i ändrörets mynning."""
    bm = bmesh.new()
    tip = [
        (0.05, 0.05, 'chrome'),
        (-0.12, 0.055, 'chrome'),
        (-0.15, 0.06, 'chrome'),  # kanten viks utåt
        (-0.158, 0.057, 'chrome'),
        (-0.155, 0.049, 'black'),  # insidan
        (-0.01, 0.047, 'black'),
        (0.05, 0.03, 'chrome'),
    ]
    revolve(bm, [(a + 0.16, r, m) for a, r, m in tip], 'z', 24)
    revolve(bm, [(0.2, 0.033, 'dark'), (0.75, 0.033, 'dark'), (0.75, 0.002, 'dark'), (0.2, 0.002, 'dark')], 'z', 16)
    muffler = [(0.75, 0.095, 'dark'), (1.15, 0.095, 'dark'), (1.17, 0.07, 'dark'), (1.17, 0.002, 'dark'), (0.73, 0.002, 'dark'), (0.73, 0.07, 'dark')]
    revolve(bm, muffler, 'z', 20, center=(0.05, 0, 0))
    box(bm, (0.05, 0.13, 0.95), (0.03, 0.08, 0.03), 'black')  # upphängning
    return new_object('exhaust', bm, EXHAUST_AT, smooth=True)


# --- Hjul ------------------------------------------------------------------------------------

TYRE_W = 0.205
RIM_R = 0.2032  # 16 tum


def tyre_profile():
    """Däckets snitt (x, r): 205/50 R16 med rundade axlar och tre spår i slitbanan; slutet i fälgsätet."""
    half = [
        (0.092, RIM_R),
        (0.101, 0.225),
        (0.104, 0.255),  # sidan buktar ut
        (0.099, 0.285),
        (0.086, 0.302),
        (0.07, 0.309),
        (0.05, 0.31),
        (0.046, 0.302),  # spår
        (0.042, 0.31),
        (0.016, 0.31),
        (0.012, 0.302),
        (0.008, 0.31),
    ]
    outer = half + [(-a, r) for a, r in reversed(half)]
    return [(a, r, 'rubber') for a, r in outer] + [(-0.092, RIM_R - 0.003, 'rubber'), (0.092, RIM_R - 0.003, 'rubber')]


def wheel():
    """Ett hjul med utsidan åt +x (vänster sida; spelet speglar det på höger sida). Origo i navet, och
    objektet står på vänster framhjuls plats så det syns på bilen i Blender."""
    bm = bmesh.new()
    revolve(bm, tyre_profile(), 'x', 48)
    # Fälgen: guldläpp ytterst, mörk insida bakom ekrarna.
    rim = [
        (0.096, 0.2, 'gold'),
        (0.1, 0.212, 'gold'),
        (0.09, 0.215, 'gold'),
        (0.084, 0.203, 'gold'),
        (0.07, 0.19, 'dark'),
        (-0.08, 0.19, 'dark'),
        (-0.096, 0.204, 'gold'),
        (-0.1, 0.198, 'gold'),
        (-0.09, 0.195, 'gold'),
        (0.09, 0.195, 'gold'),
    ]
    revolve(bm, rim, 'x', 48)
    # Bakplåt och bromsskiva bakom ekrarna, så man inte ser igenom hjulet.
    revolve(bm, [(-0.06, 0.002, 'black'), (-0.06, 0.19, 'black'), (-0.07, 0.19, 'black'), (-0.07, 0.002, 'black')], 'x', 24)
    revolve(bm, [(-0.005, 0.08, 'chrome'), (-0.005, 0.165, 'chrome'), (-0.025, 0.165, 'chrome'), (-0.025, 0.08, 'chrome')], 'x', 32)
    # Nav och centrumhatt, med fem muttrar.
    revolve(bm, [(0.05, 0.02, 'gold'), (0.05, 0.072, 'gold'), (0.03, 0.072, 'gold'), (0.03, 0.02, 'gold')], 'x', 24)
    revolve(bm, [(0.064, 0.002, 'dark'), (0.064, 0.022, 'dark'), (0.045, 0.026, 'dark'), (0.045, 0.002, 'dark')], 'x', 16)
    for i in range(5):
        t = 2 * math.pi * i / 5
        nut = [(0.064, 0.002, 'chrome'), (0.064, 0.008, 'chrome'), (0.05, 0.009, 'chrome'), (0.05, 0.002, 'chrome')]
        revolve(bm, nut, 'x', 6, center=(0, 0.046 * math.cos(t), 0.046 * math.sin(t)))
    # Sexton tunna ekrar som lutar in mot navet (fälgen är skålad), bredare vid navet.
    for i in range(16):
        t = 2 * math.pi * (i + 0.5) / 16
        radial = Vector((0, math.cos(t), math.sin(t)))
        tangent = Vector((0, -math.sin(t), math.cos(t)))
        axial = Vector((1, 0, 0))

        def end(r, x, w, d=0.016):
            p = radial * r + axial * x
            return [p - tangent * w / 2 - axial * d / 2, p + tangent * w / 2 - axial * d / 2, p + tangent * w / 2 + axial * d / 2, p - tangent * w / 2 + axial * d / 2]

        hexa(bm, end(0.066, 0.042, 0.024) + end(0.192, 0.078, 0.014), 'gold')
    return new_object('wheel', bm, (TRACK[0], WHEELS[0][1], WHEELS[0][0]), smooth=True)


# --- Övriga detaljer -------------------------------------------------------------------------


def simple(name, at, parts):
    """En detalj av några lådor: parts = [(mitt relativt at, storlek, material)]."""
    bm = bmesh.new()
    for c, size, mat in parts:
        box(bm, c, size, mat)
    return new_object(name, bm, at)


def details():
    objs = [wing(), exhaust(), wheel()]
    for s, side in ((1, 'L'), (-1, 'R')):
        # Lackad spegel på en kort fot från dörrens framkant, med svart glas bakåt.
        objs.append(simple(f'mirror_{side}', (s * 0.8, 0.52, 0.43), [
            ((s * 0.03, 0.02, 0), (0.15, 0.09, 0.09), 'paint'),
            ((s * 0.03, 0.02, -0.046), (0.13, 0.072, 0.004), 'black'),
            ((-s * 0.05, -0.01, 0.01), (0.08, 0.03, 0.05), 'paint'),
        ]))
        for zw, nm in ((WHEELS[0][0], 'F'), (WHEELS[1][0], 'R')):
            objs.append(simple(f'flap_{nm}{side}', (s * 0.715, -0.39, zw - 0.46), [((0, 0, 0), (0.2, 0.16, 0.015), 'black')]))
    # Upphöjt intag till laddluftkylaren på huven, med svart öppning framåt.
    objs.append(simple('scoop', (0, 0.375, 1.12), [((0, 0, 0), (0.6, 0.08, 0.38), 'paint'), ((0, 0.01, 0.195), (0.5, 0.05, 0.01), 'black')]))
    objs.append(simple('plate_front', (0, 0.0, 1.995), [((0, 0, 0), (0.34, 0.06, 0.02), 'plate')]))
    # Extraljusrampen (klass 2): fyra lampor tätt i en lackad låda på huvens framkant.
    objs.append(simple('pod_body', (0, 0.22, 1.78), [((0, 0, 0), (0.8, 0.1, 0.22), 'paint')]))
    for i, x in enumerate((0.3, 0.1, -0.1, -0.3)):
        bm = bmesh.new()
        revolve(bm, [(-0.05, 0.002, 'paint'), (-0.05, 0.09, 'paint'), (0.05, 0.09, 'paint'), (0.05, 0.002, 'paint')], 'z', 20)
        objs.append(new_object(f'pod_lamp_{i}', bm, (x, 0.28, 1.86)))
        bm = bmesh.new()
        revolve(bm, [(-0.005, 0.002, 'lamp'), (-0.005, 0.075, 'lamp'), (0.005, 0.075, 'lamp'), (0.005, 0.002, 'lamp')], 'z', 20)
        objs.append(new_object(f'pod_lens_{i}', bm, (x, 0.28, 1.915)))
    return objs
