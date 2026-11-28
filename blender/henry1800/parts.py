"""
The Henry's loose parts, each an object of its own: headlamps, bumpers, spoiler, exhaust, wheels,
mirrors, spot lamps, number plates and mud flaps. The parts are built in car coordinates round their own origin.
"""

import math

import bmesh
from mathutils import Vector

from common import TRACK, WHEELS, box, hexa, new_object, prism, revolve


# --- Spoiler --------------------------------------------------------------------------------

# A black rubber lip along the trailing edge of the boot lid.
WING_AT = (0, 0.44, -2.1)
WING_SPAN = 1.44


def wing():
    """The lip spoiler in one piece (falls off whole): a wedge that rises towards the rear edge of the boot."""
    bm = bmesh.new()
    lip = [(0.09, -0.012), (0.09, 0.0), (-0.05, 0.03), (-0.07, 0.03), (-0.07, -0.012)]
    prism(bm, lip, -WING_SPAN / 2, WING_SPAN / 2, 'black')
    return new_object('wing', bm, WING_AT)


# --- Bumpers --------------------------------------------------------------------------------

# Thin black bars: two at the front, either side of the middle, and one across the rear; all wrap round the
# corners. (x0, x1) is the inner and outer end, z the face, y the bottom and top edge.
FRONT_BUMPER = ((0.3, 0.8), 1.8, (-0.03, 0.06))
REAR_BUMPER = ((0.0, 0.8), -2.24, (-0.017, 0.064))


def bar(bm, x0, x1, z, ys, wrap):
    """A black bar from x0 to x1 with its face at z, wrapping `wrap` m back along the side at each end that
    reaches the corner (|x| = 0.8)."""
    y0, y1 = ys
    h, depth = y1 - y0, 0.07
    zc = z - math.copysign(depth / 2, z)
    box(bm, ((x0 + x1) / 2, (y0 + y1) / 2, zc), (abs(x1 - x0), h, depth), 'black')
    for xe in (x0, x1):
        if abs(xe) >= 0.8:
            box(bm, (xe - math.copysign(0.035, xe), (y0 + y1) / 2, z - math.copysign(wrap / 2, z)), (0.07, h, wrap), 'black')


def centred(name, bm):
    """An object of bm (built in car coordinates) with its origin in the middle of its vertices, so a loose part
    falls from where it sits."""
    lo = Vector(tuple(min(v.co[i] for v in bm.verts) for i in range(3)))
    hi = Vector(tuple(max(v.co[i] for v in bm.verts) for i in range(3)))
    c = (lo + hi) / 2
    for v in bm.verts:
        v.co -= c
    return new_object(name, bm, (c.x, c.z, -c.y))


def bumpers():
    """The two front halves (each with an amber blinker in its face) and the rear bar, each its own part."""
    objs = []
    (x0, x1), z, (y0, y1) = FRONT_BUMPER
    for s, side in ((1, 'L'), (-1, 'R')):
        bm = bmesh.new()
        bar(bm, s * x0, s * x1, z, (y0, y1), 0.25)
        box(bm, (s * 0.625, (y0 + y1) / 2 - 0.005, z + 0.004), (0.13, 0.04, 0.01), 'amber')
        objs.append(centred(f'bumper_front_{side}', bm))
    (x0, x1), z, ys = REAR_BUMPER
    bm = bmesh.new()
    bar(bm, -x1, x1, z, ys, 0.25)
    objs.append(centred('bumper_rear', bm))
    return objs


# --- Arch extensions ------------------------------------------------------------------------

# Bolt-on, painted: a band FLARE_W wide round each arch, its lip FLARE_OUT proud of the side, so the rally
# track fits under the body.
ARCH_R, FLARE_W, FLARE_OUT = 0.345, 0.1, 0.055
SILL_Y = -0.27


def arch_extension(zw, yw, s, name, surface):
    """An arch extension: an arc from the sill over the wheel, thick at the opening and thinning to the body
    at its outer edge. Its inside follows the body (surface(s, y, z) gives x there). Origin at the wheel."""
    bm = bmesh.new()
    at = (s * 0.8, yw, zw)
    r0, r1 = ARCH_R - 0.004, ARCH_R + FLARE_W
    # From the sill in front of the wheel over the top to the sill behind it.
    a0 = math.asin(max(-1.0, (SILL_Y - yw) / r1))
    rings = []
    n = 28
    for i in range(n + 1):
        a = (math.pi - a0) + (2 * a0 - math.pi) * i / n
        c, sn = math.cos(a), math.sin(a)
        # Low down the apron slopes away, so the side is measured a little higher there.
        x0 = s * surface(s, max(yw + (r1 - 0.01) * sn, SILL_Y + 0.07), zw + (r1 - 0.01) * c) - 0.004
        ring = [(x0, r0), (x0 + FLARE_OUT, r0 + 0.008), (x0 + FLARE_OUT - 0.01, r0 + 0.04), (x0, r1)]
        rings.append([bm.verts.new(Vector((s * x - at[0], -(r * c), r * sn))) for x, r in ring])
    for ra, rb in zip(rings, rings[1:]):
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((ra[i], ra[j], rb[j], rb[i])).material_index = 0
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    return new_object(name, bm, at)


# --- Headlamps ------------------------------------------------------------------------------

HEAD_AT = (0.63, 0.17, 1.722)
HEAD_R = 0.09


def headlamp(s, side):
    """A round headlamp on the grille: a chrome rim and a domed glass, as its own part so it can break."""
    bm = bmesh.new()
    profile = [(-0.03, 0.002, 'chrome'), (-0.03, HEAD_R + 0.012, 'chrome'), (0.012, HEAD_R + 0.012, 'chrome'),
               (0.014, HEAD_R, 'lamp'), (0.026, HEAD_R * 0.6, 'lamp'), (0.03, 0.002, 'lamp')]
    revolve(bm, profile, 'z', 28)
    return new_object(f'headlight_{side}', bm, (s * HEAD_AT[0], HEAD_AT[1], HEAD_AT[2]), smooth=True)


# --- Exhaust --------------------------------------------------------------------------------

# One pipe out under the left of the rear valance.
EXHAUST_AT = (0.36, -0.25, -2.2)


def exhaust():
    """The tailpipe, the pipe forward under the valance and the silencer under the floor. Origin at the mouth."""
    bm = bmesh.new()
    tip(bm, 0.0)
    revolve(bm, [(0.2, 0.026, 'dark'), (0.75, 0.026, 'dark'), (0.75, 0.002, 'dark'), (0.2, 0.002, 'dark')], 'z', 16)
    muffler = [(0.75, 0.085, 'dark'), (1.15, 0.085, 'dark'), (1.17, 0.06, 'dark'), (1.17, 0.002, 'dark'), (0.73, 0.002, 'dark'), (0.73, 0.06, 'dark')]
    revolve(bm, muffler, 'z', 20, center=(-0.1, 0.02, 0))
    box(bm, (-0.1, 0.12, 0.95), (0.03, 0.07, 0.03), 'black')  # hanger
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
RIM_R = 0.1651  # 13 inch


def tyre_profile():
    """The tyre section (x, r): 205/70 R13 with a tall sidewall, round shoulders and three tread grooves; closed in the rim seat."""
    half = [
        (0.094, RIM_R),
        (0.102, 0.195),
        (0.106, 0.24),  # the sidewall bulges
        (0.101, 0.28),
        (0.089, 0.302),
        (0.072, 0.309),
        (0.052, 0.31),
        (0.048, 0.302),  # groove
        (0.044, 0.31),
        (0.016, 0.31),
        (0.012, 0.302),
        (0.008, 0.31),
    ]
    outer = half + [(-a, r) for a, r in reversed(half)]
    return [(a, r, 'rubber') for a, r in outer] + [(-0.094, RIM_R - 0.003, 'rubber'), (0.094, RIM_R - 0.003, 'rubber')]


def wheel():
    """A wheel with its outside to +x (left side; the game mirrors it on the right). Origin at the hub, and
    the object stands at the left front wheel so it shows on the car in Blender. White eight-spoke rally rim."""
    bm = bmesh.new()
    revolve(bm, tyre_profile(), 'x', 32)
    # The rim: lip outermost, dark inside behind the spokes.
    rim = [
        (0.098, 0.162, 'white'),
        (0.102, 0.173, 'white'),
        (0.092, 0.176, 'white'),
        (0.086, 0.165, 'white'),
        (0.072, 0.154, 'dark'),
        (-0.082, 0.154, 'dark'),
        (-0.098, 0.166, 'white'),
        (-0.102, 0.161, 'white'),
        (-0.092, 0.158, 'white'),
        (0.092, 0.158, 'white'),
    ]
    revolve(bm, rim, 'x', 32)
    # Back plate and brake disc behind the spokes, so you cannot see through the wheel.
    revolve(bm, [(-0.06, 0.002, 'black'), (-0.06, 0.154, 'black'), (-0.07, 0.154, 'black'), (-0.07, 0.002, 'black')], 'x', 24)
    revolve(bm, [(-0.005, 0.07, 'dark'), (-0.005, 0.135, 'dark'), (-0.025, 0.135, 'dark'), (-0.025, 0.07, 'dark')], 'x', 32)
    # Hub with four nuts.
    revolve(bm, [(0.06, 0.002, 'white'), (0.06, 0.06, 'white'), (0.035, 0.066, 'white'), (0.035, 0.002, 'white')], 'x', 24)
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

        hexa(bm, end(0.06, 0.05, 0.035) + end(0.156, 0.08, 0.05), 'white')
    return new_object('wheel', bm, (TRACK[0], WHEELS[0][1], WHEELS[0][0]), smooth=True)


# --- Other details --------------------------------------------------------------------------


def simple(name, at, parts):
    """A detail made of a few boxes: parts = [(centre relative to at, size, material)]."""
    bm = bmesh.new()
    for c, size, mat in parts:
        box(bm, c, size, mat)
    return new_object(name, bm, at)


MIRROR_AT = (0.47, 0.5)  # (y, z) of the mirror foot in the front corner of the side window


def mirror(s, side, surface):
    """Black door mirror: a foot in the front corner of the side window, a short arm and a rounded-off
    rectangular housing with the glass to the rear. The foot follows the body surface (surface(s, y, z)
    gives x there), so the mirror stays attached however the shape changes. Origin at the foot."""
    y0, z0 = MIRROR_AT
    x0 = surface(s, y0, z0)
    bm = bmesh.new()
    box(bm, (s * 0.01, 0, 0), (0.025, 0.06, 0.08), 'black')
    box(bm, (s * 0.04, -0.01, -0.03), (0.05, 0.025, 0.035), 'black')
    box(bm, (s * 0.115, -0.0, -0.1), (0.12, 0.1, 0.08), 'black')
    box(bm, (s * 0.115, -0.0, -0.141), (0.105, 0.085, 0.004), 'dark')
    return new_object(f'mirror_{side}', bm, (x0, y0, z0))


def details(surface):
    """The loose parts. surface(s, y, z) gives the body surface (x) on side s, for parts mounted on it."""
    objs = [wing(), exhaust(), wheel(), *bumpers()]
    for s, side in ((1, 'L'), (-1, 'R')):
        objs.append(headlamp(s, side))
        objs.append(mirror(s, side, surface))
        for (zw, yw), nm in zip(WHEELS, 'FR'):
            objs.append(arch_extension(zw, yw, s, f'flare_{nm}{side}', surface))
        for zw, nm in ((WHEELS[0][0], 'F'), (WHEELS[1][0], 'R')):
            objs.append(simple(f'flap_{nm}{side}', (s * 0.72, -0.37, zw - 0.43), [((0, 0, 0), (0.2, 0.2, 0.015), 'black')]))
    # The front number plate on the apron, below the gap between the bumpers.
    objs.append(simple('plate_front', (0, -0.1, 1.712), [((0, 0, 0), (0.52, 0.11, 0.012), 'plate')]))
    # The spot lamp pod (class 2): four lamps close together in a painted box on the front edge of the bonnet.
    objs.append(simple('pod_body', (0, 0.36, 1.58), [((0, 0, 0), (0.8, 0.1, 0.22), 'paint')]))
    for i, x in enumerate((0.3, 0.1, -0.1, -0.3)):
        bm = bmesh.new()
        revolve(bm, [(-0.05, 0.002, 'paint'), (-0.05, 0.09, 'paint'), (0.05, 0.09, 'paint'), (0.05, 0.002, 'paint')], 'z', 20)
        objs.append(new_object(f'pod_lamp_{i}', bm, (x, 0.42, 1.66)))
        bm = bmesh.new()
        revolve(bm, [(-0.005, 0.002, 'lamp'), (-0.005, 0.075, 'lamp'), (0.005, 0.075, 'lamp'), (0.005, 0.002, 'lamp')], 'z', 20)
        objs.append(new_object(f'pod_lens_{i}', bm, (x, 0.42, 1.715)))
    return objs
