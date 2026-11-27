"""Lokal georeferering av en sträcka på översiktskartan: grov förskjutningssökning och ICP mot OSM."""
import json, math, sys, urllib.request
import os
cfgp = sys.argv[1]; cfg = json.load(open(cfgp)); D = os.path.dirname(os.path.abspath(cfgp)); R = os.path.join(D, cfg['royal'])
g = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'royal/global_affine.json')))
x0, y0, x1, y1 = cfg['crop']
inside = lambda p: x0 <= p[0] <= x1 and y0 <= p[1] <= y1
orange = [p for p in json.load(open(R + '/orange.json')) if inside(p)]
green = [p for p in json.load(open(R + '/green.json')) if inside(p)]
# Samma ram som pipeline.py: LAT0/LON0 = medel av ankarna i config.
lats = [a[2] for a in cfg['anchors']]; lons = [a[3] for a in cfg['anchors']]
LAT0, LON0 = sum(lats)/len(lats), sum(lons)/len(lons); KX = 111320*math.cos(math.radians(LAT0)); KY = 110540
m = lambda lat, lon: ((lon-LON0)*KX, (lat-LAT0)*KY)
gKX = 111320*math.cos(math.radians(g['LAT0']))
def glob(p):
    e = g['AX'][0]*p[0]+g['AX'][1]*p[1]+g['AX'][2]; n = g['AY'][0]*p[0]+g['AY'][1]*p[1]+g['AY'][2]
    return m(g['LAT0'] + n/110540, g['LON0'] + e/gKX)
# px -> lokala meter som affin: anpassa till globala transformen i tre punkter
pts3 = [(x0, y0), (x1, y0), (x0, y1)]
import itertools
def solve(P, Q):
    (xa, ya), (xb, yb), (xc, yc) = P
    det = xa*(yb-yc) - ya*(xb-xc) + (xb*yc-xc*yb)
    def coef(v):
        va, vb, vc = v
        a = (va*(yb-yc) - ya*(vb-vc) + (vb*yc-vc*yb)) / det
        b = (xa*(vb-vc) - va*(xb-xc) + (xb*vc-xc*vb)) / det
        c = (xa*(yb*vc-yc*vb) - ya*(xb*vc-xc*vb) + va*(xb*yc-xc*yb)) / det
        return [a, b, c]
    return coef([q[0] for q in Q]), coef([q[1] for q in Q])
AX, AY = solve(pts3, [glob(p) for p in pts3])
# OSM-vägar i området
corners = [glob(p) for p in [(x0, y0), (x1, y1)]]
lat_lo = LAT0 + min(c[1] for c in corners)/KY - 0.03; lat_hi = LAT0 + max(c[1] for c in corners)/KY + 0.03
lon_lo = LON0 + min(c[0] for c in corners)/KX - 0.06; lon_hi = LON0 + max(c[0] for c in corners)/KX + 0.06
q = f'[timeout:120];(way["highway"]({lat_lo:.4f},{lon_lo:.4f},{lat_hi:.4f},{lon_hi:.4f}););(._;>;);out meta;'
import urllib.parse
req = urllib.request.Request('https://maps.mail.ru/osm/tools/overpass/api/interpreter', data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': 'rally-sim-research/0.1'})
open(D + '/map.osm', 'wb').write(urllib.request.urlopen(req, timeout=200).read())
import xml.etree.ElementTree as ET
root = ET.parse(D + '/map.osm').getroot()
nodes = {n.get('id'): m(float(n.get('lat')), float(n.get('lon'))) for n in root.iter('node')}
segs = []
for w in root.iter('way'):
    refs = [r.get('ref') for r in w.iter('nd') if r.get('ref') in nodes]
    segs += [(nodes[a], nodes[b]) for a, b in zip(refs, refs[1:])]
print('osm segs', len(segs), file=sys.stderr)
G = 100.0; grid = {}
for i, (a, b) in enumerate(segs):
    for gx in range(int(min(a[0], b[0])//G), int(max(a[0], b[0])//G)+1):
        for gy in range(int(min(a[1], b[1])//G), int(max(a[1], b[1])//G)+1): grid.setdefault((gx, gy), []).append(i)
def near(p, r):
    best = (r*r, None); gx, gy = int(p[0]//G), int(p[1]//G); k = int(r//G) + 1
    for dx in range(-k, k+1):
        for dy in range(-k, k+1):
            for i in grid.get((gx+dx, gy+dy), []):
                a, b = segs[i]; vx, vy = b[0]-a[0], b[1]-a[1]; L = vx*vx+vy*vy or 1e-9
                t = max(0, min(1, ((p[0]-a[0])*vx+(p[1]-a[1])*vy)/L)); qq = (a[0]+t*vx, a[1]+t*vy)
                d = (qq[0]-p[0])**2 + (qq[1]-p[1])**2
                if d < best[0]: best = (d, qq)
    return best
sample = (orange + green)[::7]
tf = lambda p, AX, AY, dx=0, dy=0: (AX[0]*p[0]+AX[1]*p[1]+AX[2]+dx, AY[0]*p[0]+AY[1]*p[1]+AY[2]+dy)
best = (-1, 0, 0)
for dx in range(-3000, 3001, 100):
    for dy in range(-3000, 3001, 100):
        sc = sum(1 for p in sample[::3] if near(tf(p, AX, AY, dx, dy), 40)[1] is not None)
        if sc > best[0]: best = (sc, dx, dy)
print('coarse shift', best[1:], 'hits', best[0], 'of', len(sample[::3]), file=sys.stderr)
AX[2] += best[1]; AY[2] += best[2]
# fin: 100 m-steg -> 20 m
b2 = (-1, 0, 0)
for dx in range(-100, 101, 20):
    for dy in range(-100, 101, 20):
        sc = sum(1 for p in sample if near(tf(p, AX, AY, dx, dy), 25)[1] is not None)
        if sc > b2[0]: b2 = (sc, dx, dy)
AX[2] += b2[1]; AY[2] += b2[2]
def lstsq(P, Q):
    A = [[0]*3 for _ in range(3)]; bx = [0]*3; by = [0]*3
    for (x, y), (qx, qy) in zip(P, Q):
        v = (x, y, 1)
        for i in range(3):
            bx[i] += v[i]*qx; by[i] += v[i]*qy
            for j in range(3): A[i][j] += v[i]*v[j]
    def det(M): return M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1])-M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0])+M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0])
    def s3(y):
        Dt = det(A); out = []
        for c in range(3):
            M = [r[:] for r in A]
            for r in range(3): M[r][c] = y[r]
            out.append(det(M)/Dt)
        return out
    return s3(bx), s3(by)
for it, r in enumerate([120, 90, 60, 45, 45, 45]):
    P, Q = [], []
    for p in (orange + green)[::3]:
        d, qq = near(tf(p, AX, AY), r)
        if qq is not None: P.append(p); Q.append(qq)
    AX, AY = lstsq(P, Q)
ds = sorted(math.sqrt(near(tf(p, AX, AY), 200)[0]) for p in orange[::5])
print('fine shift', b2[1:], 'orange median m', round(ds[len(ds)//2], 1), 'p90', round(ds[int(len(ds)*.9)], 1), file=sys.stderr)
json.dump({'AX': AX, 'AY': AY}, open(D + '/affine.json', 'w')); json.dump(orange, open(D + '/red.json', 'w'))
