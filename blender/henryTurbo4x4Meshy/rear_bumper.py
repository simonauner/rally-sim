"""
Irons the lumps out of the rear bumper in henryTurbo4x4.blend, which convert.py left from the AI-generated
mesh, and saves the file. Run once; the .blend is the source after that.

    blender -b blender/henryTurbo4x4Meshy/henryTurbo4x4.blend -P blender/henryTurbo4x4Meshy/rear_bumper.py

A clean bumper surface is swept from a plan outline (gently bowed rear face, rounded corners, straight sides)
and a profile (rounded top, flat face, the lower edge curling under), both measured on the old bumper. Every
bumper vertex is moved onto it and the vertices are spread out evenly over it; the seam vertices move with
the body's, so no gap opens. The GLB's custom normals are dropped, or the old lumps would still shade.
"""

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

# Plan outline of the face (x, z), from the middle round the corner and forward along the side.
PLAN = [(-0.3, -2.560), (0, -2.570), (0.3, -2.560), (0.55, -2.540), (0.70, -2.515), (0.78, -2.46), (0.805, -2.38),
        (0.82, -2.25), (0.835, -2.05), (0.85, -1.80)]
# Profile (inset from the face, y), from above the top seam round the lower edge and under.
PROFILE = [(0.05, 0.0), (0.045, -0.035), (0.012, -0.065), (0.0, -0.10), (0.0, -0.20), (0.02, -0.245),
           (0.06, -0.285), (0.13, -0.315), (0.24, -0.34), (0.40, -0.355), (0.55, -0.36)]


def chaikin(p, n=4):
    p = np.array(p, float)
    for _ in range(n):
        q = [p[0]]
        for a, b in zip(p, p[1:]):
            q += [0.75 * a + 0.25 * b, 0.25 * a + 0.75 * b]
        p = np.array(q + [p[-1]])
    return p


def resample(p, n):
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
    t = np.linspace(0, d[-1], n)
    return np.stack([np.interp(t, d, p[:, i]) for i in range(p.shape[1])], 1)


def surface():
    plan = resample(chaikin(PLAN), 160)
    plan = plan[plan[:, 0] >= 0]
    plan = np.vstack([plan[::-1] * [-1, 1], plan])
    prof = resample(chaikin(PROFILE), 60)
    t = np.gradient(plan, axis=0)
    t /= np.linalg.norm(t, axis=1)[:, None]
    n = np.stack([-t[:, 1], t[:, 0]], 1)
    if n[len(n) // 2][1] < 0:  # inward: +z at the middle of the rear face
        n = -n
    verts = [Vector((px + nx * s, -(pz + nz * s), y)) for (px, pz), (nx, nz) in zip(plan, n) for s, y in prof]
    nv = len(prof)
    faces = [(i * nv + j, (i + 1) * nv + j, (i + 1) * nv + j + 1, i * nv + j + 1)
             for i in range(len(plan) - 1) for j in range(nv - 1)]
    return BVHTree.FromPolygons(verts, faces)


def main():
    tree = surface()
    bump = bpy.data.objects['body_bumper_rear'].data
    body = bpy.data.objects['body'].data
    kd = KDTree(len(body.vertices))
    for v in body.vertices:
        kd.insert(v.co, v.index)
    kd.balance()
    twin = {v.index: bi for v in bump.vertices for _, bi, d in [kd.find(v.co)] if d < 1e-4}
    bm = bmesh.new()
    bm.from_mesh(bump)
    bm.verts.ensure_lookup_table()
    seam = [v.is_boundary for v in bm.verts]
    nb = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
    p = [tree.find_nearest(v.co)[0] for v in bm.verts]
    bm.free()
    # Spread the decimated triangles evenly over the surface instead of crowding into slivers.
    for _ in range(15):
        p = [c if seam[i] else tree.find_nearest(c.lerp(sum((p[j] for j in nb[i]), Vector()) / len(nb[i]), 0.5))[0]
             for i, c in enumerate(p)]
    for i, c in enumerate(p):
        bump.vertices[i].co = c
        if i in twin:
            body.vertices[twin[i]].co = c
    if bump.has_custom_normals:
        bump.attributes.remove(bump.attributes['custom_normal'])
    for me in (bump, body):
        me.update()
        me.set_sharp_from_angle(angle=0.7)
    bpy.ops.wm.save_mainfile()


main()
