"""Andersvattnet, den första etappen: rutten (route.json) togs fram före pipeline.py. Användning: python3 -I parts.py"""
import json, math, sys, urllib.request, time, os
import xml.etree.ElementTree as ET
SP = os.path.dirname(os.path.abspath(__file__))
PARTS = [('Storberget', 0, 5100), ('Hösjöälven', 5000, 10300), ('Röjmyrberget', 10200, 15600), ('Flarkån', 15500, 20860)]
route = json.load(open(SP + '/route.json'))
LAT0, LON0 = route[0]['lat'], route[0]['lon']
KX = 111320 * math.cos(math.radians(LAT0)); KY = 110540
def en(lat, lon): return ((lon - LON0) * KX, (lat - LAT0) * KY)  # öster, norr
P = [en(p['lat'], p['lon']) for p in route]
s = [0.0]
for a, b in zip(P, P[1:]): s.append(s[-1] + math.hypot(b[0]-a[0], b[1]-a[1]))
TOTAL = s[-1]
def at(d):
    d = min(max(d, 0), TOTAL)
    for i in range(len(s) - 1):
        if s[i+1] >= d:
            t = (d - s[i]) / ((s[i+1] - s[i]) or 1); return (P[i][0] + (P[i+1][0]-P[i][0])*t, P[i][1] + (P[i+1][1]-P[i][1])*t)
STEP = 20
full = [at(d) for d in range(0, int(TOTAL) + 1, STEP)]
sm = [full[0]] + [((full[i-1][0]+2*full[i][0]+full[i+1][0])/4, (full[i-1][1]+2*full[i][1]+full[i+1][1])/4) for i in range(1, len(full)-1)] + [full[-1]]
cache = SP + '/elev_full.json'
if os.path.exists(cache): ys = json.load(open(cache))
else:
    lls = [(LAT0 + n / KY, LON0 + e / KX) for e, n in sm]; ys = []
    for k in range(0, len(lls), 100):
        q = '|'.join(f'{a:.6f},{b:.6f}' for a, b in lls[k:k+100])
        req = urllib.request.Request('https://api.opentopodata.org/v1/eudem25m?locations=' + q, headers={'User-Agent': 'rally-sim-research/0.1'})
        ys += [r['elevation'] for r in json.load(urllib.request.urlopen(req, timeout=60))['results']]
        time.sleep(1.1)
    json.dump(ys, open(cache, 'w'))
ys = [(ys[max(0,i-1)] + 2*ys[i] + ys[min(len(ys)-1,i+1)]) / 4 for i in range(len(ys))]
root = ET.parse(SP + '/map.osm').getroot()
nodes = {n.get('id'): (float(n.get('lat')), float(n.get('lon'))) for n in root.iter('node')}
roadways = []
for w in root.iter('way'):
    tags = {t.get('k'): t.get('v') for t in w.iter('tag')}
    if tags.get('highway') not in ('primary','secondary','tertiary','unclassified','residential','service','track','road'): continue
    roadways.append([r.get('ref') for r in w.iter('nd') if r.get('ref') in nodes])
routeidx = {(round(p['lat'], 7), round(p['lon'], 7)): i for i, p in enumerate(route)}
out = []
for name, a, b in PARTS:
    i0, i1 = a // STEP, min(len(sm) - 1, b // STEP)
    ox, oz = sm[i0]
    loc = lambda e, n: (-(e - ox), n - oz)  # x = väster, z = norr, origo i startpunkten
    pts = [(*loc(*sm[i]), ys[i] - ys[i0]) for i in range(i0, i1 + 1)]
    spurs = []
    for refs in roadways:
        for k, ref in enumerate(refs):
            ri = routeidx.get((round(nodes[ref][0], 7), round(nodes[ref][1], 7)))
            if ri is None or not (a + 40 < s[ri] < b - 60): continue
            for dirn in (1, -1):
                seq = [en(*nodes[refs[j]]) for j in range(k, len(refs) if dirn > 0 else -1, dirn)]
                if len(seq) < 2: continue
                ps = [seq[0]]; L = 0
                for pa, pb in zip(seq, seq[1:]):
                    d = math.hypot(pb[0]-pa[0], pb[1]-pa[1])
                    if L + d >= 80:
                        t = (80 - L) / d; ps.append((pa[0] + (pb[0]-pa[0])*t, pa[1] + (pb[1]-pa[1])*t)); L = 80; break
                    L += d; ps.append(pb)
                if L < 40: continue
                # Vägar som följer etappen (gafflar och parallella stickvägar) blir inga korsningar:
                # efter de första 15 m ska den korsande vägen vara minst 12 m från etappen.
                def segd(q, A, B):
                    vx, vy = B[0]-A[0], B[1]-A[1]; L2 = vx*vx + vy*vy or 1e-9
                    t = max(0, min(1, ((q[0]-A[0])*vx + (q[1]-A[1])*vy) / L2)); return math.hypot(A[0]+vx*t-q[0], A[1]+vy*t-q[1])
                road = sm[max(0, i0-2):i1+3]
                def droad(q): return min(segd(q, A, B) for A, B in zip(road, road[1:]))
                dense = []; acc = 0
                for pa, pb in zip(ps, ps[1:]):
                    d = math.hypot(pb[0]-pa[0], pb[1]-pa[1]); n = max(1, int(d // 5))
                    for kk in range(1, n + 1):
                        acc += d / n; dense.append((acc, (pa[0] + (pb[0]-pa[0])*kk/n, pa[1] + (pb[1]-pa[1])*kk/n)))
                if any(dd >= 15 and droad(q) < 12 for dd, q in dense): continue
                if any(math.hypot(ps[-1][0]-o[-1][0], ps[-1][1]-o[-1][1]) < 40 for o in spurs): continue
                spurs.append(ps)
    sep = min((math.hypot(pts[i][0]-pts[j][0], pts[i][1]-pts[j][1]), i*STEP, j*STEP) for i in range(len(pts)) for j in range(i+8, len(pts)))
    print(name, f'{(b-a)/1000:.1f} km', 'höjd', round(min(p[2] for p in pts)), round(max(p[2] for p in pts)), 'spurs', len(spurs), 'närmast', [round(v) for v in sep], file=sys.stderr)
    out.append({'name': name, 'road': [[round(x, 1), round(z, 1), round(y, 1)] for x, z, y in pts], 'spurs': [[{'x': round(loc(*q)[0]), 'z': round(loc(*q)[1])} for q in sp] for sp in spurs]})
json.dump(out, open(SP + '/parts.json', 'w'))
