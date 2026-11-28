"""
The Sora's loose parts, each its own object: wing, exhaust, wheels, mirrors, air intakes, auxiliary
lights, number plate and mud flaps. The parts are built in car coordinates around their own origin.
"""

import math

import bmesh
from mathutils import Vector

from common import TRACK, WHEELS, box, face, hexa, new_object, prism, revolve, vert


# --- Wing ------------------------------------------------------------------------------------

# A low blade just above the boot lid's rear edge, steeply tilted: top edge 1.15 m above the ground.
WING_AT = (0, 0.55, -1.98)
WING_SPAN = 1.42
WING_CHORD = 0.3
WING_AOA = 0.32  # radians; rear edge up


def aerofoil(chord, thickness=0.12, camber=0.04, peak=0.4, n=14):
    """Wing profile (NACA 4-digit) in (z, y), cambered downwards so it gives downforce, leading edge towards
    +z and tilted WING_AOA. The points run around the profile from the trailing edge over the top and back."""

    def at(xc, upper):
        yt = 5 * thickness * (0.2969 * math.sqrt(xc) - 0.126 * xc - 0.3516 * xc**2 + 0.2843 * xc**3 - 0.1036 * xc**4)
        yc = camber / peak**2 * (2 * peak * xc - xc**2) if xc < peak else camber / (1 - peak) ** 2 * (1 - 2 * peak + 2 * peak * xc - xc**2)
        y = -yc + (yt if upper else -yt)  # cambered downwards
        z, y = chord * (0.5 - xc), chord * y
        c, s = math.cos(WING_AOA), math.sin(WING_AOA)
        return z * c + y * s, y * c - z * s

    xs = [(1 - math.cos(math.pi * i / n)) / 2 for i in range(n + 1)]  # dense near the leading and trailing edges
    return [at(x, True) for x in reversed(xs)] + [at(x, False) for x in xs[1:-1]]


def wing():
    """The wing in one piece (falls off whole): profiled blade, black strip along the trailing edge, end
    plates and two fins that lean back down to the boot lid."""
    bm = bmesh.new()
    half = WING_SPAN / 2
    prism(bm, aerofoil(WING_CHORD), -half, half, 'paint')
    # Gurney flap: a narrow black lip pointing up along the trailing edge.
    te = aerofoil(WING_CHORD)[0]
    box(bm, (0, te[1] + 0.01, te[0] + 0.003), (WING_SPAN, 0.02, 0.006), 'black')
    # The end plates: tilted hexagons that stick out below and behind the blade.
    c = WING_CHORD / 2
    plate = [(c + 0.03, -0.075), (c + 0.05, 0.02), (c - 0.03, 0.065), (-c - 0.02, 0.105), (-c - 0.06, 0.04), (-c - 0.03, -0.085)]
    for s in (1, -1):
        prism(bm, plate, s * half, s * (half + 0.012), 'paint')
    # The fins: wide at the foot on the boot lid (which lies 0.1 below the blade), narrower at the top.
    fin = [(0.12, -0.11), (0.07, -0.0), (-0.1, 0.03), (-0.08, -0.12)]
    for s in (1, -1):
        prism(bm, fin, s * 0.485, s * 0.515, 'paint')
    return new_object('wing', bm, WING_AT)


# --- Exhaust ---------------------------------------------------------------------------------

EXHAUST_AT = (-0.42, -0.27, -2.36)


def exhaust():
    """The tailpipe with a rolled edge and dark inside, the pipe forward under the bumper and the silencer
    under the floor. Origin at the tailpipe's mouth."""
    bm = bmesh.new()
    tip = [
        (0.05, 0.05, 'chrome'),
        (-0.12, 0.055, 'chrome'),
        (-0.15, 0.06, 'chrome'),  # the edge rolls outwards
        (-0.158, 0.057, 'chrome'),
        (-0.155, 0.049, 'black'),  # the inside
        (-0.01, 0.047, 'black'),
        (0.05, 0.03, 'chrome'),
    ]
    revolve(bm, [(a + 0.16, r, m) for a, r, m in tip], 'z', 24)
    revolve(bm, [(0.2, 0.033, 'dark'), (0.75, 0.033, 'dark'), (0.75, 0.002, 'dark'), (0.2, 0.002, 'dark')], 'z', 16)
    muffler = [(0.75, 0.095, 'dark'), (1.15, 0.095, 'dark'), (1.17, 0.07, 'dark'), (1.17, 0.002, 'dark'), (0.73, 0.002, 'dark'), (0.73, 0.07, 'dark')]
    revolve(bm, muffler, 'z', 20, center=(0.05, 0, 0))
    box(bm, (0.05, 0.13, 0.95), (0.03, 0.08, 0.03), 'black')  # hanger
    return new_object('exhaust', bm, EXHAUST_AT, smooth=True)


# --- Wheels ----------------------------------------------------------------------------------

TYRE_W = 0.205
RIM_R = 0.2032  # 16 inch


def tyre_profile():
    """The tyre's cross-section (x, r): 205/50 R16 with rounded shoulders and three tread grooves; closed in
    the rim seat."""
    half = [
        (0.092, RIM_R),
        (0.101, 0.225),
        (0.104, 0.255),  # the sidewall bulges out
        (0.099, 0.285),
        (0.086, 0.302),
        (0.07, 0.309),
        (0.05, 0.31),
        (0.046, 0.302),  # groove
        (0.042, 0.31),
        (0.016, 0.31),
        (0.012, 0.302),
        (0.008, 0.31),
    ]
    outer = half + [(-a, r) for a, r in reversed(half)]
    return [(a, r, 'rubber') for a, r in outer] + [(-0.092, RIM_R - 0.003, 'rubber'), (0.092, RIM_R - 0.003, 'rubber')]


def wheel():
    """A wheel with the outside towards +x (left side; the game mirrors it on the right side). Origin at the
    hub, and the object sits in the left front wheel's place so it shows on the car in Blender."""
    bm = bmesh.new()
    revolve(bm, tyre_profile(), 'x', 32)
    # The rim: gold lip on the outside, dark inside behind the spokes.
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
    revolve(bm, rim, 'x', 32)
    # Backing plate and brake disc behind the spokes, so you can't see through the wheel.
    revolve(bm, [(-0.06, 0.002, 'black'), (-0.06, 0.19, 'black'), (-0.07, 0.19, 'black'), (-0.07, 0.002, 'black')], 'x', 24)
    revolve(bm, [(-0.005, 0.08, 'chrome'), (-0.005, 0.165, 'chrome'), (-0.025, 0.165, 'chrome'), (-0.025, 0.08, 'chrome')], 'x', 32)
    # Hub and centre cap, with five nuts.
    revolve(bm, [(0.05, 0.02, 'gold'), (0.05, 0.072, 'gold'), (0.03, 0.072, 'gold'), (0.03, 0.02, 'gold')], 'x', 24)
    revolve(bm, [(0.064, 0.002, 'dark'), (0.064, 0.022, 'dark'), (0.045, 0.026, 'dark'), (0.045, 0.002, 'dark')], 'x', 16)
    for i in range(5):
        t = 2 * math.pi * i / 5
        nut = [(0.064, 0.002, 'chrome'), (0.064, 0.008, 'chrome'), (0.05, 0.009, 'chrome'), (0.05, 0.002, 'chrome')]
        revolve(bm, nut, 'x', 6, center=(0, 0.046 * math.cos(t), 0.046 * math.sin(t)))
    # Sixteen thin spokes that lean in towards the hub (the rim is dished), wider at the hub.
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


# --- Other details ---------------------------------------------------------------------------


def simple(name, at, parts):
    """A detail made of a few boxes: parts = [(centre relative to at, size, material)]."""
    bm = bmesh.new()
    for c, size, mat in parts:
        box(bm, c, size, mat)
    return new_object(name, bm, at)


MIRROR_AT = (0.39, 0.44)  # (y, z) of the mirror's foot in the side window's front corner


def mirror(s, side, surface):
    """Streamlined mirror: a painted triangular plate in the side window's front corner, a short painted arm
    and a housing that grows outwards, with black glass at the back. A black plate disappeared against the
    dark window, so the housing seemed to float. The plate's inside follows the body surface (surface(s, y,
    z) gives x there), so the mirror stays attached to the door however the shape changes. Origin in the
    plate."""
    y0, z0 = MIRROR_AT
    bm = bmesh.new()
    sail = [(0.08, -0.03), (-0.06, -0.03), (-0.06, 0.09)]
    # The inside 3 mm into the panel, the outside 20 mm out.
    inner = [surface(s, y0 + dy, z0 + dz) - s * 0.003 for dz, dy in sail]
    x0 = inner[0]
    a = [vert(bm, (x - x0, dy, dz)) for x, (dz, dy) in zip(inner, sail)]
    b = [vert(bm, (x - x0 + s * 0.023, dy, dz)) for x, (dz, dy) in zip(inner, sail)]
    face(bm, list(reversed(a)), 'paint')
    face(bm, b, 'paint')
    for k in range(3):
        k1 = (k + 1) % 3
        face(bm, [a[k], a[k1], b[k1], b[k]], 'paint')
    # The arm out from the lower part of the plate, and the housing at the far end.
    # The plate's outermost point: the window leans inwards, so the corners can lie inside x0 and must not count as outwards.
    out = s * (max(s * (x - x0) for x in inner) + 0.02)
    # The arm starts in the middle of the plate's thickness where it sits, otherwise there is a gap against the sloping window.
    arm_in = surface(s, y0 + 0.02, z0 - 0.03) - x0 + s * 0.012
    arm_out = out + s * 0.05
    box(bm, ((arm_in + arm_out) / 2, 0.02, -0.03), (abs(arm_out - arm_in), 0.025, 0.045), 'paint')

    def end(x, y0, y1, z0, z1):
        return [(out + s * x, y0, z0), (out + s * x, y1, z0), (out + s * x, y1, z1), (out + s * x, y0, z1)]

    # The housing: narrower inwards, larger outwards; the front painted, the glass a thin black disc behind.
    hexa(bm, end(0.045, -0.025, 0.055, -0.075, 0.02) + end(0.18, -0.035, 0.065, -0.07, 0.035), 'paint')
    hexa(bm, end(0.055, -0.02, 0.05, -0.08, -0.074) + end(0.17, -0.028, 0.058, -0.075, -0.069), 'black')
    return new_object(f'mirror_{side}', bm, (x0, y0, z0))


def details(surface):
    """The loose parts. surface(s, y, z) gives the body surface (x) on side s, for parts mounted on it."""
    objs = [wing(), exhaust(), wheel()]
    for s, side in ((1, 'L'), (-1, 'R')):
        objs.append(mirror(s, side, surface))
        for zw, nm in ((WHEELS[0][0], 'F'), (WHEELS[1][0], 'R')):
            objs.append(simple(f'flap_{nm}{side}', (s * 0.715, -0.39, zw - 0.46), [((0, 0, 0), (0.2, 0.16, 0.015), 'black')]))
    # Raised intercooler intake on the bonnet, with a black opening facing forward.
    objs.append(simple('scoop', (0, 0.34, 1.04), [((0, 0, 0), (0.6, 0.08, 0.32), 'paint'), ((0, 0.01, 0.165), (0.5, 0.05, 0.01), 'black')]))
    # Cabin air intake at the front of the roof, with a black opening facing forward.
    objs.append(simple('roofvent', (0, 0.835, -0.2), [((0, 0, 0), (0.34, 0.05, 0.3), 'paint'), ((0, 0.003, 0.152), (0.28, 0.03, 0.006), 'black')]))
    objs.append(simple('plate_front', (0, 0.0, 1.995), [((0, 0, 0), (0.34, 0.06, 0.02), 'plate')]))
    # The auxiliary light pod (class 2): four lamps close together in a painted box on the bonnet's front edge.
    objs.append(simple('pod_body', (0, 0.205, 1.78), [((0, 0, 0), (0.8, 0.1, 0.22), 'paint')]))
    for i, x in enumerate((0.3, 0.1, -0.1, -0.3)):
        bm = bmesh.new()
        revolve(bm, [(-0.05, 0.002, 'paint'), (-0.05, 0.09, 'paint'), (0.05, 0.09, 'paint'), (0.05, 0.002, 'paint')], 'z', 20)
        objs.append(new_object(f'pod_lamp_{i}', bm, (x, 0.265, 1.86)))
        bm = bmesh.new()
        revolve(bm, [(-0.005, 0.002, 'lamp'), (-0.005, 0.075, 'lamp'), (0.005, 0.075, 'lamp'), (0.005, 0.002, 'lamp')], 'z', 20)
        objs.append(new_object(f'pod_lens_{i}', bm, (x, 0.265, 1.915)))
    return objs
