"""Landmarks along the stages from OpenStreetMap -> src/physics/real/landmarks.ts.
Usage: python3 -I tools/stages/landmarks.py > src/physics/real/landmarks.ts
Fetches OSM objects around each route via Overpass into <stage>/features.json (once) and gives
the landmarks as spans along the road, so they land right even where the route deviates from the map."""
import json, math, os, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ANDERS = [['Storberget', 0, 5100], ['Hösjöälven', 5000, 10300], ['Röjmyrberget', 10200, 15600], ['Flarkån', 15500, 20860]]
STAGES = ['varmskog', 'gardsjo', 'colins', 'bygdsiljum', 'back', 'andersvattnet', 'royalforest', 'angebackstorp', 'olme']
KEYS = ['natural', 'waterway', 'landuse', 'building', 'power', 'place']

def fetch(route, out):
    lats = [p['lat'] for p in route]; lons = [p['lon'] for p in route]
    bb = f'{min(lats)-0.004:.4f},{min(lons)-0.008:.4f},{max(lats)+0.004:.4f},{max(lons)+0.008:.4f}'
    q = '[out:json][timeout:120];(' + ''.join(f'nwr["{k}"]({bb});' for k in KEYS) + ');out tags geom;'
    for url in ('https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'):
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': 'rally-sim-research/0.1'})
            data = urllib.request.urlopen(req, timeout=200).read(); open(out, 'wb').write(data); return
        except Exception as e: print('overpass', url, e, file=sys.stderr); time.sleep(5)
    raise SystemExit('Overpass is not responding')

def inside(x, z, pts):
    c = False
    for (x1, z1), (x2, z2) in zip(pts, pts[1:]):
        if (z1 > z) != (z2 > z) and x < x1 + (z - z1) * (x2 - x1) / (z2 - z1): c = not c
    return c

def cross(a, b, c, d):
    """The intersection of segments ab and cd as a fraction along ab, or None."""
    r = (b[0]-a[0], b[1]-a[1]); s = (d[0]-c[0], d[1]-c[1]); den = r[0]*s[1] - r[1]*s[0]
    if abs(den) < 1e-9: return None
    t = ((c[0]-a[0])*s[1] - (c[1]-a[1])*s[0]) / den; u = ((c[0]-a[0])*r[1] - (c[1]-a[1])*r[0]) / den
    return t if 0 <= t <= 1 and 0 <= u <= 1 else None

def stage(name):
    D = os.path.join(HERE, name); route = json.load(open(D + '/route.json'))
    parts = ANDERS if name == 'andersvattnet' else json.load(open(D + '/config.json'))['parts']
    if not os.path.exists(D + '/features.json'): fetch(route, D + '/features.json'); time.sleep(2)
    feat = json.load(open(D + '/features.json'))['elements']
    LAT0, LON0 = route[0]['lat'], route[0]['lon']; KX = 111320 * math.cos(math.radians(LAT0)); KY = 110540
    m = lambda g: ((g['lon'] - LON0) * KX, (g['lat'] - LAT0) * KY)  # east, north
    P = [m(p) for p in route]; S = [0.0]
    for a, b in zip(P, P[1:]): S.append(S[-1] + math.hypot(b[0]-a[0], b[1]-a[1]))
    # The route every 10 m with the normal pointing left in the direction of travel.
    R = []; i = 0
    for d in range(0, int(S[-1]), 10):
        while S[i+1] < d: i += 1
        t = (d - S[i]) / ((S[i+1] - S[i]) or 1); hx, hz = P[i+1][0]-P[i][0], P[i+1][1]-P[i][1]; L = math.hypot(hx, hz) or 1
        R.append((d, P[i][0] + hx*t, P[i][1] + hz*t, -hz/L, hx/L))
    def kind(t):
        if t.get('landuse') in ('farmland', 'meadow', 'grass') or t.get('natural') == 'grassland': return 'field'
        if t.get('landuse') in ('residential', 'farmyard'): return 'farm'
        if t.get('natural') == 'water': return 'lake'
        if t.get('natural') == 'wetland': return 'bog'
        if t.get('natural') in ('scrub', 'heath') or t.get('landuse') == 'clearcut': return 'clearcut'
    polys = []
    for e in feat:
        k = kind(e.get('tags', {}))
        if not k: continue
        rings = [e['geometry']] if e['type'] == 'way' and e.get('geometry') else [mm['geometry'] for mm in e.get('members', []) if mm.get('role') == 'outer' and mm.get('geometry')]
        for r in rings:
            if r[0] != r[-1]: continue
            pts = [m(g) for g in r]; xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
            polys.append((k, pts, (min(xs), min(zs), max(xs), max(zs))))
    OFFSETS = {'field': (20, 35), 'farm': (20, 35), 'lake': (25, 40), 'bog': (20, 35), 'clearcut': (20, 35)}
    hits = {}  # (kind, side) -> [s]
    for d, x, z, nx, nz in R:
        for side in (1, -1):
            for k, pts, (x0, z0, x1, z1) in polys:
                if d in hits.get((k, side), [])[-1:]: continue
                for off in OFFSETS[k]:
                    px, pz = x + nx * off * side, z + nz * off * side
                    if x0 <= px <= x1 and z0 <= pz <= z1 and inside(px, pz, pts): hits.setdefault((k, side), []).append(d); break
    # Houses near the road become farms even where OSM has no residential area (like the village in Valsfäboda).
    grid = {}
    for d, x, z, nx, nz in R: grid.setdefault((int(x // 50), int(z // 50)), []).append((d, x, z, nx, nz))
    for e in feat:
        if 'building' not in e.get('tags', {}) or not e.get('geometry'): continue
        g = e['geometry']; cx = sum(m(p)[0] for p in g) / len(g); cz = sum(m(p)[1] for p in g) / len(g)
        best = None
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for d, x, z, nx, nz in grid.get((int(cx // 50) + dx, int(cz // 50) + dz), []):
                    dist = math.hypot(cx - x, cz - z)
                    if best is None or dist < best[0]: best = (dist, d, 1 if (cx - x) * nx + (cz - z) * nz > 0 else -1)
        if best and 5 <= best[0] <= 45: hits.setdefault(('farm', best[2]), []).extend(range(best[1] - 20, best[1] + 21, 10))
    spans = []
    for (k, side), ds in hits.items():
        ds = sorted(set(ds)); cur = None
        for d in ds:
            if cur and d - cur[1] <= 30: cur[1] = d
            else:
                if cur: spans.append((k, side, *cur))
                cur = [d, d]
        if cur: spans.append((k, side, *cur))
    spans = [sp for sp in spans if sp[3] - sp[2] >= (40 if sp[0] == 'lake' else 50)]
    # Points where the route crosses a power line or a stream, and named crests.
    points = []
    for e in feat:
        t = e.get('tags', {}); g = e.get('geometry')
        k = 'power' if t.get('power') == 'line' else 'bridge' if t.get('waterway') == 'river' or (t.get('waterway') == 'stream' and t.get('name')) else None
        if k and g and e['type'] == 'way':
            L = [m(p) for p in g]
            for j in range(len(P) - 1):
                for c, dd in zip(L, L[1:]):
                    u = cross(P[j], P[j+1], c, dd)
                    if u is not None: points.append((k, S[j] + u * (S[j+1] - S[j])))
        if t.get('place') and 'Crest' in t.get('name', '') and 'lat' in e:
            x, z = m(e); d = min(R, key=lambda r: math.hypot(r[1]-x, r[2]-z))
            if math.hypot(d[1]-x, d[2]-z) < 40: points.append(('crest', d[0]))
    # A power line with several parallel wires, or a meandering stream, gives several crossings close together.
    points.sort(key=lambda p: p[1]); merged = []
    for k, s in points:
        if not any(k == k2 and abs(s - s2) < 60 for k2, s2 in merged): merged.append((k, s))
    points = merged
    out = {}
    for pn, a, b in parts:
        lm = [(k, side, max(f, a) - a, min(t, b) - a) for k, side, f, t in spans if f < b and t > a and min(t, b) - max(f, a) >= 50]
        lm += [(k, 0, s - a, s - a) for k, s in points if a + 30 < s < b - 30]
        out[pn] = sorted(lm, key=lambda x: x[2])
        print(name, pn, [(k, sd, round(f), round(t)) for k, sd, f, t in out[pn]], file=sys.stderr)
    return out

all_ = {}
for n in STAGES: all_.update(stage(n))
print('''/**
 * Landmarks along the stages from OpenStreetMap: fields, farms, lakes, bogs, clear-cuts, power lines,
 * bridges and crests, as stretches along the road (m from the stage start). side 1 = left in the driving
 * direction, -1 = right, 0 = across. Generated by tools/stages/landmarks.py.
 *
 * Map data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
 */

import type { Landmark } from '../stage';

export const LANDMARKS: Record<string, Landmark[]> = {''')
for pn, lm in all_.items():
    if not lm: continue
    print(f"  '{pn}': [")
    for k, side, f, t in lm: print(f"    {{ kind: '{k}', side: {side}, from: {round(f)}, to: {round(t)} }},")
    print('  ],')
print('};')
