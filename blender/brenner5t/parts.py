"""
The Brenner's loose parts, each an object of its own: spoiler, exhaust, wheels, mirrors, spot lamps,
number plate and mud flaps. The parts are built in car coordinates round their own origin.
"""

import math

import bmesh
from mathutils import Vector

from common import TRACK, WHEELS, box, face, hexa, new_object, prism, revolve, vert


# --- Spoiler --------------------------------------------------------------------------------

# A painted blade on the deck behind the rear screen, its rear edge turned up, carried by two feet.
WING_AT = (0, 0.5, -2.13)
WING_SPAN = 1.36


def wing():
    """The spoiler in one piece (falls off whole): a thin blade with an upturned rear edge, a black underside
    and two feet down to the deck."""
    bm = bmesh.new()
    half = WING_SPAN / 2
    blade = [(0.14, -0.012), (0.12, 0.004), (-0.1, 0.018), (-0.145, 0.04), (-0.155, 0.032), (-0.12, 0.0), (0.1, -0.022)]
    prism(bm, blade, -half, half, 'paint', side_mat='paint')
    box(bm, (0, -0.02, 0.0), (WING_SPAN - 0.02, 0.004, 0.22), 'black')
    foot = [(0.06, -0.06), (0.06, -0.01), (-0.06, -0.0), (-0.06, -0.07)]
    for s in (1, -1):
        prism(bm, foot, s * (half - 0.05), s * (half - 0.09), 'black')
    return new_object('wing', bm, WING_AT)


# --- Exhaust --------------------------------------------------------------------------------

EXHAUST_AT = (0.33, -0.3, -2.38)


def exhaust():
    """Two tailpipes side by side (left side), the pipe forward under the bumper and the silencer under the
    floor. Origin at the mouth of the inner tailpipe."""
    bm = bmesh.new()
    for dx in (0.0, 0.08):
        tip(bm, dx)
    revolve(bm, [(0.2, 0.033, 'dark'), (0.75, 0.033, 'dark'), (0.75, 0.002, 'dark'), (0.2, 0.002, 'dark')], 'z', 16, center=(0.04, 0, 0))
    muffler = [(0.75, 0.095, 'dark'), (1.15, 0.095, 'dark'), (1.17, 0.07, 'dark'), (1.17, 0.002, 'dark'), (0.73, 0.002, 'dark'), (0.73, 0.07, 'dark')]
    revolve(bm, muffler, 'z', 20, center=(0.0, 0, 0))
    box(bm, (0.0, 0.13, 0.95), (0.03, 0.08, 0.03), 'black')  # hanger
    return new_object('exhaust', bm, EXHAUST_AT, smooth=True)


def tip(bm, dx):
    """A tailpipe with a rolled edge and a dark inside, its mouth at z = 0."""
    profile = [
        (0.05, 0.05, 'chrome'),
        (-0.12, 0.055, 'chrome'),
        (-0.15, 0.06, 'chrome'),  # the edge rolls outwards
        (-0.158, 0.057, 'chrome'),
        (-0.155, 0.049, 'black'),  # the inside
        (-0.01, 0.047, 'black'),
        (0.05, 0.03, 'chrome'),
    ]
    revolve(bm, [(a + 0.16, r * 0.8, m) for a, r, m in profile], 'z', 24, center=(dx, 0, 0))


# --- Wheels ---------------------------------------------------------------------------------

TYRE_W = 0.215
RIM_R = 0.1905  # 15 inch


def tyre_profile():
    """The tyre section (x, r): 215/60 R15 with a tall sidewall, round shoulders and three tread grooves; closed in the rim seat."""
    half = [
        (0.098, RIM_R),
        (0.106, 0.215),
        (0.11, 0.25),  # the sidewall bulges
        (0.105, 0.285),
        (0.092, 0.302),
        (0.075, 0.309),
        (0.054, 0.31),
        (0.05, 0.302),  # groove
        (0.046, 0.31),
        (0.017, 0.31),
        (0.013, 0.302),
        (0.009, 0.31),
    ]
    outer = half + [(-a, r) for a, r in reversed(half)]
    return [(a, r, 'rubber') for a, r in outer] + [(-0.098, RIM_R - 0.003, 'rubber'), (0.098, RIM_R - 0.003, 'rubber')]


def wheel():
    """A wheel with its outside to +x (left side; the game mirrors it on the right). Origin at the hub, and
    the object stands at the left front wheel so it shows on the car in Blender."""
    bm = bmesh.new()
    revolve(bm, tyre_profile(), 'x', 32)
    # The rim: lip outermost, dark inside behind the spokes.
    rim = [
        (0.102, 0.187, 'chrome'),
        (0.106, 0.199, 'chrome'),
        (0.096, 0.202, 'chrome'),
        (0.09, 0.19, 'chrome'),
        (0.076, 0.178, 'dark'),
        (-0.086, 0.178, 'dark'),
        (-0.102, 0.191, 'chrome'),
        (-0.106, 0.186, 'chrome'),
        (-0.096, 0.183, 'chrome'),
        (0.096, 0.183, 'chrome'),
    ]
    revolve(bm, rim, 'x', 32)
    # Back plate and brake disc behind the spokes, so you cannot see through the wheel.
    revolve(bm, [(-0.06, 0.002, 'black'), (-0.06, 0.178, 'black'), (-0.07, 0.178, 'black'), (-0.07, 0.002, 'black')], 'x', 24)
    revolve(bm, [(-0.005, 0.08, 'dark'), (-0.005, 0.155, 'dark'), (-0.025, 0.155, 'dark'), (-0.025, 0.08, 'dark')], 'x', 32)
    # Hub and centre cap, with five nuts.
    revolve(bm, [(0.05, 0.02, 'chrome'), (0.05, 0.072, 'chrome'), (0.03, 0.072, 'chrome'), (0.03, 0.02, 'chrome')], 'x', 24)
    revolve(bm, [(0.064, 0.002, 'dark'), (0.064, 0.022, 'dark'), (0.045, 0.026, 'dark'), (0.045, 0.002, 'dark')], 'x', 16)
    for i in range(5):
        t = 2 * math.pi * i / 5
        nut = [(0.064, 0.002, 'chrome'), (0.064, 0.008, 'chrome'), (0.05, 0.009, 'chrome'), (0.05, 0.002, 'chrome')]
        revolve(bm, nut, 'x', 6, center=(0, 0.046 * math.cos(t), 0.046 * math.sin(t)))
    # Twenty thin spokes leaning in towards the hub (the rim is dished), wider at the hub.
    for i in range(20):
        t = 2 * math.pi * (i + 0.5) / 20
        radial = Vector((0, math.cos(t), math.sin(t)))
        tangent = Vector((0, -math.sin(t), math.cos(t)))
        axial = Vector((1, 0, 0))

        def end(r, x, w, d=0.016):
            p = radial * r + axial * x
            return [p - tangent * w / 2 - axial * d / 2, p + tangent * w / 2 - axial * d / 2, p + tangent * w / 2 + axial * d / 2, p - tangent * w / 2 + axial * d / 2]

        hexa(bm, end(0.066, 0.046, 0.02) + end(0.176, 0.084, 0.012), 'chrome')
    return new_object('wheel', bm, (TRACK[0], WHEELS[0][1], WHEELS[0][0]), smooth=True)


# --- Other details --------------------------------------------------------------------------


def simple(name, at, parts):
    """A detail made of a few boxes: parts = [(centre relative to at, size, material)]."""
    bm = bmesh.new()
    for c, size, mat in parts:
        box(bm, c, size, mat)
    return new_object(name, bm, at)


MIRROR_AT = (0.37, 0.42)  # (y, z) of the mirror foot in the front corner of the side window


def mirror(s, side, surface):
    """Square black mirror: a foot in the front corner of the side window, a short arm and a rectangular
    housing with the glass to the rear. The foot follows the body surface (surface(s, y, z) gives x there), so
    the mirror stays attached however the shape changes. Origin at the foot."""
    y0, z0 = MIRROR_AT
    x0 = surface(s, y0, z0)
    bm = bmesh.new()
    box(bm, (s * 0.012, 0, 0), (0.03, 0.07, 0.09), 'black')
    box(bm, (s * 0.045, 0.0, -0.02), (0.05, 0.03, 0.04), 'black')
    # The housing: 15 cm out, 11 cm high, the glass a dark plate at its rear edge.
    box(bm, (s * 0.135, 0.02, -0.085), (0.14, 0.11, 0.09), 'black')
    box(bm, (s * 0.135, 0.02, -0.131), (0.125, 0.095, 0.004), 'dark')
    return new_object(f'mirror_{side}', bm, (x0, y0, z0))


def details(surface):
    """The loose parts. surface(s, y, z) gives the body surface (x) on side s, for parts mounted on it."""
    objs = [wing(), exhaust(), wheel()]
    for s, side in ((1, 'L'), (-1, 'R')):
        objs.append(mirror(s, side, surface))
        for zw, nm in ((WHEELS[0][0], 'F'), (WHEELS[1][0], 'R')):
            objs.append(simple(f'flap_{nm}{side}', (s * 0.72, -0.41, zw - 0.43), [((0, 0, 0), (0.2, 0.2, 0.015), 'black')]))
    # The number plate in the middle of the bumper, between the fog lamps.
    objs.append(simple('plate_front', (0, -0.11, 1.912), [((0, 0, 0), (0.52, 0.11, 0.012), 'plate')]))
    # The spot lamp pod (class 2): four lamps close together in a painted box on the front edge of the bonnet.
    objs.append(simple('pod_body', (0, 0.255, 1.72), [((0, 0, 0), (0.8, 0.1, 0.22), 'paint')]))
    for i, x in enumerate((0.3, 0.1, -0.1, -0.3)):
        bm = bmesh.new()
        revolve(bm, [(-0.05, 0.002, 'paint'), (-0.05, 0.09, 'paint'), (0.05, 0.09, 'paint'), (0.05, 0.002, 'paint')], 'z', 20)
        objs.append(new_object(f'pod_lamp_{i}', bm, (x, 0.315, 1.8)))
        bm = bmesh.new()
        revolve(bm, [(-0.005, 0.002, 'lamp'), (-0.005, 0.075, 'lamp'), (0.005, 0.075, 'lamp'), (0.005, 0.002, 'lamp')], 'z', 20)
        objs.append(new_object(f'pod_lens_{i}', bm, (x, 0.315, 1.855)))
    return objs
