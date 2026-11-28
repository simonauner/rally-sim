"""
The Strand 2.0 Turbo 4x4's loose parts, each an object of its own: boot spoiler, exhaust, wheels, mirrors,
spot lamps, number plate and mud flaps. The parts are built in car coordinates round their own origin.
"""

import math

import bmesh
from mathutils import Vector

from common import TRACK, WHEELS, box, hexa, new_object, prism, revolve


# --- Spoiler --------------------------------------------------------------------------------

# A black blade just above the rear edge of the boot lid, its ends turned down onto the lid.
WING_AT = (0, 0.42, -2.42)
WING_SPAN = 1.48


def wing():
    """The spoiler in one piece (falls off whole): a thin blade with a slightly upturned rear edge and
    two end plates down to the boot lid."""
    bm = bmesh.new()
    half = WING_SPAN / 2
    blade = [(0.08, 0.0), (0.06, 0.012), (-0.06, 0.022), (-0.085, 0.034), (-0.09, 0.026), (-0.06, 0.008), (0.06, -0.008)]
    prism(bm, blade, -half, half, 'black')
    end = [(0.08, 0.0), (-0.09, 0.026), (-0.09, -0.05), (0.06, -0.04)]
    for s in (1, -1):
        prism(bm, end, s * half, s * (half - 0.03), 'black')
    return new_object('wing', bm, WING_AT)


# --- Exhaust --------------------------------------------------------------------------------

# One pipe out under the left corner of the rear bumper.
EXHAUST_AT = (0.55, -0.33, -2.56)


def exhaust():
    """The tailpipe, the pipe forward under the bumper and the silencer under the floor. Origin at the mouth."""
    bm = bmesh.new()
    tip(bm, 0.0)
    revolve(bm, [(0.2, 0.03, 'dark'), (0.75, 0.03, 'dark'), (0.75, 0.002, 'dark'), (0.2, 0.002, 'dark')], 'z', 16)
    muffler = [(0.75, 0.09, 'dark'), (1.2, 0.09, 'dark'), (1.22, 0.065, 'dark'), (1.22, 0.002, 'dark'), (0.73, 0.002, 'dark'), (0.73, 0.065, 'dark')]
    revolve(bm, muffler, 'z', 20, center=(-0.1, 0.03, 0))
    box(bm, (-0.1, 0.13, 1.0), (0.03, 0.07, 0.03), 'black')  # hanger
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

TYRE_W = 0.205
RIM_R = 0.1905  # 15 inch


def tyre_profile():
    """The tyre section (x, r): 205/65 R15 with a tall sidewall, round shoulders and three tread grooves; closed in the rim seat."""
    half = [
        (0.094, RIM_R),
        (0.102, 0.215),
        (0.106, 0.255),  # the sidewall bulges
        (0.101, 0.29),
        (0.089, 0.312),
        (0.072, 0.319),
        (0.052, 0.32),
        (0.048, 0.312),  # groove
        (0.044, 0.32),
        (0.016, 0.32),
        (0.012, 0.312),
        (0.008, 0.32),
    ]
    outer = half + [(-a, r) for a, r in reversed(half)]
    return [(a, r, 'rubber') for a, r in outer] + [(-0.094, RIM_R - 0.003, 'rubber'), (0.094, RIM_R - 0.003, 'rubber')]


def wheel():
    """A wheel with its outside to +x (left side; the game mirrors it on the right). Origin at the hub, and
    the object stands at the left front wheel so it shows on the car in Blender. Gold eight-spoke rally rim."""
    bm = bmesh.new()
    revolve(bm, tyre_profile(), 'x', 32)
    # The rim: lip outermost, dark inside behind the spokes.
    rim = [
        (0.098, 0.187, 'gold'),
        (0.102, 0.199, 'gold'),
        (0.092, 0.202, 'gold'),
        (0.086, 0.19, 'gold'),
        (0.072, 0.178, 'dark'),
        (-0.082, 0.178, 'dark'),
        (-0.098, 0.191, 'gold'),
        (-0.102, 0.186, 'gold'),
        (-0.092, 0.183, 'gold'),
        (0.092, 0.183, 'gold'),
    ]
    revolve(bm, rim, 'x', 32)
    # Back plate and brake disc behind the spokes, so you cannot see through the wheel.
    revolve(bm, [(-0.06, 0.002, 'black'), (-0.06, 0.178, 'black'), (-0.07, 0.178, 'black'), (-0.07, 0.002, 'black')], 'x', 24)
    revolve(bm, [(-0.005, 0.07, 'dark'), (-0.005, 0.155, 'dark'), (-0.025, 0.155, 'dark'), (-0.025, 0.07, 'dark')], 'x', 32)
    # Hub with four nuts.
    revolve(bm, [(0.06, 0.002, 'gold'), (0.06, 0.06, 'gold'), (0.035, 0.066, 'gold'), (0.035, 0.002, 'gold')], 'x', 24)
    for i in range(4):
        t = 2 * math.pi * (i + 0.5) / 4
        nut = [(0.072, 0.002, 'chrome'), (0.072, 0.009, 'chrome'), (0.058, 0.01, 'chrome'), (0.058, 0.002, 'chrome')]
        revolve(bm, nut, 'x', 6, center=(0, 0.04 * math.cos(t), 0.04 * math.sin(t)))
    # Eight broad spokes, wide at the rim and narrowing to the hub, the rim dished behind them.
    for i in range(8):
        t = 2 * math.pi * i / 8
        radial = Vector((0, math.cos(t), math.sin(t)))
        tangent = Vector((0, -math.sin(t), math.cos(t)))
        axial = Vector((1, 0, 0))

        def end(r, x, w, d=0.02):
            p = radial * r + axial * x
            return [p - tangent * w / 2 - axial * d / 2, p + tangent * w / 2 - axial * d / 2, p + tangent * w / 2 + axial * d / 2, p - tangent * w / 2 + axial * d / 2]

        hexa(bm, end(0.06, 0.05, 0.035) + end(0.18, 0.08, 0.055), 'gold')
    return new_object('wheel', bm, (TRACK[0], WHEELS[0][1], WHEELS[0][0]), smooth=True)


# --- Other details --------------------------------------------------------------------------


def simple(name, at, parts):
    """A detail made of a few boxes: parts = [(centre relative to at, size, material)]."""
    bm = bmesh.new()
    for c, size, mat in parts:
        box(bm, c, size, mat)
    return new_object(name, bm, at)


MIRROR_AT = (0.37, 0.5)  # (y, z) of the mirror foot in the front corner of the front door glass


def mirror(s, side, surface):
    """Painted door mirror: a foot in the front corner of the side window, a short arm and a rounded-off
    housing with the glass to the rear. The foot follows the body surface (surface(s, y, z) gives x
    there), so the mirror stays attached however the shape changes. Origin at the foot."""
    y0, z0 = MIRROR_AT
    x0 = surface(s, y0, z0)
    bm = bmesh.new()
    box(bm, (s * 0.01, 0, 0), (0.025, 0.07, 0.1), 'black')
    box(bm, (s * 0.04, 0.01, -0.03), (0.05, 0.03, 0.04), 'paint')
    box(bm, (s * 0.12, 0.02, -0.07), (0.13, 0.1, 0.09), 'paint')
    box(bm, (s * 0.12, 0.02, -0.117), (0.115, 0.085, 0.004), 'dark')
    return new_object(f'mirror_{side}', bm, (x0, y0, z0))


def details(surface):
    """The loose parts. surface(s, y, z) gives the body surface (x) on side s, for parts mounted on it."""
    objs = [wing(), exhaust(), wheel()]
    for s, side in ((1, 'L'), (-1, 'R')):
        objs.append(mirror(s, side, surface))
        for zw, nm in ((WHEELS[0][0], 'F'), (WHEELS[1][0], 'R')):
            objs.append(simple(f'flap_{nm}{side}', (s * 0.72, -0.44, zw - 0.45), [((0, 0, 0), (0.2, 0.2, 0.015), 'black')]))
    # The front number plate in the middle of the bumper, between the fog lamps.
    objs.append(simple('plate_front', (0, -0.11, 1.902), [((0, 0, 0), (0.52, 0.11, 0.012), 'plate')]))
    # The spot lamp pod (class 2): four lamps close together in a painted box on the front edge of the bonnet.
    objs.append(simple('pod_body', (0, 0.24, 1.68), [((0, 0, 0), (0.8, 0.1, 0.22), 'paint')]))
    for i, x in enumerate((0.3, 0.1, -0.1, -0.3)):
        bm = bmesh.new()
        revolve(bm, [(-0.05, 0.002, 'paint'), (-0.05, 0.09, 'paint'), (0.05, 0.09, 'paint'), (0.05, 0.002, 'paint')], 'z', 20)
        objs.append(new_object(f'pod_lamp_{i}', bm, (x, 0.3, 1.76)))
        bm = bmesh.new()
        revolve(bm, [(-0.005, 0.002, 'lamp'), (-0.005, 0.075, 'lamp'), (0.005, 0.075, 'lamp'), (0.005, 0.002, 'lamp')], 'z', 20)
        objs.append(new_object(f'pod_lens_{i}', bm, (x, 0.3, 1.815)))
    return objs
